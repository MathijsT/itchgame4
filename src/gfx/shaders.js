// GLSL sources for the HDR scene. Geometry is rendered camera-relative (the
// camera sits at the origin) to keep precision over a 40 km world. All
// shaders output linear radiance; exposure, tone mapping and grading happen
// in the post-processing composite.

import { ATMOS_GLSL } from './atmosphere.js';

export const COMMON = /* glsl */`
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform vec3 uSunDir;      // primary light (sun by day, moon by night)
uniform vec3 uSunColor;    // its illuminance after the atmosphere
uniform float uTime;
uniform vec4 uWind;        // xz wind (m/s), z gust, w unused
uniform vec3 uHeadPos;
uniform vec3 uHeadDir;
uniform float uHeadOn;
uniform sampler2D uSkyLUT;
uniform sampler2D uNoise;
uniform vec4 uCloud;       // x coverage, y base altitude, z thickness, w shadow strength
uniform vec2 uCloudOff;    // cloud drift (m)
uniform vec4 uMist;        // x valley mist density, y mist top altitude, z night factor, w horizon angle
uniform vec4 uLightAz;     // x light azimuth (rad), y moon factor, z unused, w unused
${ATMOS_GLSL}
#ifdef SHADOWS
uniform mat4 uShadowMat0;
uniform mat4 uShadowMat1;
uniform highp sampler2DShadow uShadow0;
uniform highp sampler2DShadow uShadow1;
uniform vec4 uShadowInfo;  // x cascades, y texel0, z texel1
#endif

const float PI = 3.14159265;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec4 noiseTex(vec2 p) { return texture(uNoise, p); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

// ---- sky-view LUT lookup (parameterisation mirrors atmosphere.js)
vec2 skyUV(vec3 dir) {
  float az = atan(dir.z, dir.x) - uLightAz.x;
  az = abs(mod(az + PI, 2.0 * PI) - PI);
  float elev = asin(clamp(dir.y, -1.0, 1.0));
  float h0 = uMist.w;
  float lat = elev >= h0 ? (elev - h0) / (1.0 - h0 / 1.5707963) : (elev - h0) / (1.0 + h0 / 1.5707963);
  float v = sign(lat) * sqrt(min(abs(lat) / 1.5707963, 1.0));
  return vec2(az / PI, v * 0.5 + 0.5);
}
vec3 skyRadiance(vec3 dir) { return texture(uSkyLUT, skyUV(dir)).rgb; }

// irradiance-like ambient from the sky dome for a surface normal
vec3 skyAmbient(vec3 n) {
  vec3 up = skyRadiance(vec3(0.0, 1.0, 0.0));
  vec3 side = skyRadiance(normalize(vec3(n.x, 0.12, n.z) + vec3(1e-4)));
  vec3 a = mix(side, up, clamp(n.y * 0.6 + 0.4, 0.0, 1.0));
  // light bounced off the ground for downward-facing surfaces
  vec3 ground = uSunColor * max(uSunDir.y, 0.0) * 0.25 / PI;
  return mix(ground + a * 0.3, a, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
}

// ---- clouds (shared by sky and cloud shadows)
float cloudCover(vec2 p) {
  vec2 q = (p + uCloudOff);
  float n = noiseTex(q / 11000.0).r * 0.62 + noiseTex(q / 3300.0 + 0.37).a * 0.28 + noiseTex(q / 900.0).r * 0.10;
  float c = uCloud.x;
  return smoothstep(1.0 - c, 1.0 - c + 0.28, n);
}
float cloudShadow(vec3 wp) {
  if (uCloud.x <= 0.0 || uSunDir.y <= 0.02) return 1.0;
  vec2 p = wp.xz + uSunDir.xz / uSunDir.y * (uCloud.y + uCloud.z * 0.4 - wp.y);
  return 1.0 - cloudCover(p) * uCloud.w;
}

// ---- aerial perspective: physically based extinction + sky in-scattering
float avgDensity(float h0, float h1, float H) {
  float dh = h1 - h0;
  if (abs(dh) < 1.0) return exp(-h0 / H);
  return H * (exp(-h0 / H) - exp(-h1 / H)) / dh;
}
vec3 aerial(vec3 col, vec3 rel) {
  float dist = length(rel);
  vec3 dir = rel / max(dist, 1e-3);
  float h0 = uCamPos.y, h1 = uCamPos.y + rel.y;
  float rR = avgDensity(h0, h1, 8000.0);
  float rM = avgDensity(h0, h1, 1200.0) * uAtmo.x;
  float rD = avgDensity(max(h0 - uAtmo.z, 0.0), max(h1 - uAtmo.z, 0.0), 900.0) * uAtmo.y;
  vec3 od = (BETA_R * rR + vec3(8.4e-6 * rM) + rD * (2.0e-4 + 1.6e-4 * uDustTint)) * dist;
  // low valley mist (Atlas mornings): white, thick, hugging the valley floors
  float mist = uMist.x * avgDensity(max(h0 - uMist.y + 400.0, 0.0), max(h1 - uMist.y + 400.0, 0.0), 120.0) * dist;
  vec3 T = exp(-od);
  vec3 sky = skyRadiance(normalize(vec3(dir.x, clamp(dir.y, 0.0, 0.08) + 0.01, dir.z)));
  vec3 c = col * T + sky * (1.0 - T);
  float Tm = exp(-mist);
  float ph = 0.3 + 0.7 * pow(max(dot(dir, uSunDir), 0.0), 6.0);
  vec3 mistCol = uSunColor * ph / PI * 0.8 + skyRadiance(vec3(0, 1, 0)) * 0.9;
  return c * Tm + mistCol * (1.0 - Tm);
}

#ifdef SHADOWS
float pcf(highp sampler2DShadow sm, vec3 c, float texel) {
  const vec2 P[8] = vec2[8](vec2(-0.94, -0.4), vec2(0.95, -0.77), vec2(-0.09, -0.93), vec2(0.34, 0.29),
                            vec2(-0.82, 0.54), vec2(0.54, 0.84), vec2(-0.26, 0.1), vec2(0.8, 0.05));
  float a = hash12(c.xy * 4096.0) * 6.283;
  mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
  float s = 0.0;
  for (int i = 0; i < 8; i++) s += texture(sm, vec3(c.xy + R * P[i] * texel * 1.8, c.z));
  return s / 8.0;
}
float shadowAt(vec3 rel, vec3 n) {
  vec3 p = rel + n * 0.06;
  vec4 a = uShadowMat0 * vec4(p, 1.0);
  vec3 c = a.xyz * 0.5 + 0.5;
  if (all(greaterThan(c.xy, vec2(0.02))) && all(lessThan(c.xy, vec2(0.98))) && c.z < 1.0) {
    return pcf(uShadow0, c - vec3(0, 0, 0.0006), uShadowInfo.y);
  }
  if (uShadowInfo.x > 1.5) {
    vec4 b2 = uShadowMat1 * vec4(rel + n * 0.5, 1.0);
    vec3 c2 = b2.xyz * 0.5 + 0.5;
    if (all(greaterThan(c2.xy, vec2(0.0))) && all(lessThan(c2.xy, vec2(1.0))) && c2.z < 1.0) {
      float edge = smoothstep(0.42, 0.5, max(abs(c2.x - 0.5), abs(c2.y - 0.5)));
      return mix(pcf(uShadow1, c2 - vec3(0, 0, 0.001), uShadowInfo.z), 1.0, edge);
    }
  }
  return 1.0;
}
#else
float shadowAt(vec3 rel, vec3 n) { return 1.0; }
#endif

// GGX specular
float ggx(vec3 n, vec3 v, vec3 l, float rough) {
  vec3 h = normalize(v + l);
  float a = rough * rough, a2 = a * a;
  float nh = max(dot(n, h), 0.0), nl = max(dot(n, l), 0.0), nv = max(dot(n, v), 1e-3);
  float d = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * d * d);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = (nl / (nl * (1.0 - k) + k)) * (nv / (nv * (1.0 - k) + k));
  return D * G / max(4.0 * nl * nv, 1e-3);
}

// Physically motivated lighting: Lambert sun + sky ambient + GGX + headlights.
vec3 shade(vec3 albedo, vec3 n, vec3 rel, float shadow, float ao, float rough, float f0) {
  vec3 v = -normalize(rel);
  vec3 wp = rel + uCamPos;
  float nl = max(dot(n, uSunDir), 0.0);
  float vis = shadow * cloudShadow(wp);
  vec3 c = albedo / PI * uSunColor * nl * vis;
  c += albedo * skyAmbient(n) * ao;
  if (f0 > 0.0) {
    float fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    c += uSunColor * ggx(n, v, uSunDir, rough) * nl * vis * fres;
    // sky reflection
    vec3 r = reflect(-v, n);
    c += skyRadiance(normalize(vec3(r.x, max(r.y, 0.02), r.z))) * fres * (1.0 - rough) * ao;
  }
  if (uHeadOn > 0.0) {
    vec3 L = uHeadPos - rel;
    float d = length(L);
    L /= d;
    float spot = smoothstep(0.74, 0.93, dot(-L, uHeadDir));
    c += albedo / PI * vec3(1.0, 0.92, 0.8) * uHeadOn * spot * max(dot(n, L), 0.0) * 260.0 / (d * d + 8.0);
  }
  return c;
}
`;

// ---------------- terrain ----------------
export const TERRAIN_VS = /* glsl */`
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec4 aCol;
layout(location=4) in vec4 aDetail;
uniform vec3 uOrigin; // chunk origin relative to camera
${COMMON}
out vec3 vRel; out vec3 vNrm; out vec4 vCol; out vec4 vDetail;
#ifdef DEPTH
uniform mat4 uLightMat;
#endif
void main() {
  vec3 rel = aPos + uOrigin;
#ifdef DEPTH
  gl_Position = uLightMat * vec4(rel, 1.0);
#else
  vRel = rel; vNrm = aNrm; vCol = aCol; vDetail = aDetail;
  gl_Position = uViewProj * vec4(rel, 1.0);
#endif
}`;

export const TERRAIN_FS = /* glsl */`
${COMMON}
uniform highp sampler2DArray uGround;
in vec3 vRel; in vec3 vNrm; in vec4 vCol; in vec4 vDetail;
out vec4 outColor;
vec4 layer(float l, vec2 p, float scale) { return texture(uGround, vec3(p / scale, l)); }
void main() {
#ifdef DEPTH
  outColor = vec4(1.0);
#else
  vec3 wp = vRel + uCamPos;
  vec3 ng = normalize(vNrm);
  float dist = length(vRel);
  vec3 albedo = toLinear(vCol.rgb);
  float ao = vCol.a;
  float sand = vDetail.x, rock = vDetail.y, snow = vDetail.z, veg = vDetail.w;
  float gravel = clamp(1.0 - sand - veg - snow - rock, 0.0, 1.0) + rock * 0.25 * (1.0 - smoothstep(0.6, 0.9, 1.0 - ng.y));
  float wsum = sand + rock + veg + snow + gravel + 1e-3;
  // ---- macro variation (breaks up tiling and flat vertex colour)
  vec4 nM = noiseTex(wp.xz / 520.0);
  vec4 nm = noiseTex(wp.xz / 47.0);
  albedo *= 0.8 + 0.4 * nM.r;
  albedo *= 0.88 + 0.24 * nm.a;
  // ---- material layers, each at two scales; rock is tri-planar on slopes
  vec2 p = wp.xz;
  vec4 Ls = layer(0.0, p, 3.1) * 0.6 + layer(0.0, p + 17.0, 13.0) * 0.4;
  vec3 tw = pow(abs(ng), vec3(4.0)); tw /= tw.x + tw.y + tw.z;
  vec4 Lr = (layer(1.0, wp.zy, 7.0) * tw.x + layer(1.0, wp.xy, 7.0) * tw.z + layer(1.0, p, 7.0) * tw.y) * 0.7 + layer(1.0, p + 5.0, 23.0) * 0.3;
  vec4 Lv = layer(2.0, p, 2.6) * 0.65 + layer(2.0, p + 3.0, 9.0) * 0.35;
  vec4 Lg = layer(3.0, p, 1.7) * 0.7 + layer(3.0, p + 9.0, 6.5) * 0.3;
  vec4 Lw = Ls * 0.4 + 0.3;
  vec4 M = (Ls * sand + Lr * rock + Lv * veg + Lg * gravel + Lw * snow) / wsum;
  float detailFade = 1.0 - smoothstep(60.0, 600.0, dist);
  albedo *= mix(1.0, M.r * 2.0, 0.85 * detailFade + 0.15);
  // sedimentary strata on big rock faces
  float strata = sin(wp.y * 1.1 + nm.r * 7.0 + nM.a * 4.0) * 0.5 + 0.5;
  albedo *= mix(1.0, 0.8 + 0.32 * strata, rock * (1.0 - ng.y * 0.5));
  // greener, lusher patches where there is vegetation
  albedo = mix(albedo, albedo * vec3(0.92, 1.06, 0.8), veg * smoothstep(0.4, 0.75, nm.r) * 0.5);
  // ---- bump from the material height (surface-gradient method)
  float amp = (sand * 0.006 + rock * 0.12 + veg * 0.02 + gravel * 0.035 + snow * 0.01) / wsum;
  float Hm = M.a * amp;
  vec3 dpdx = dFdx(vRel), dpdy = dFdy(vRel);
  float dhx = dFdx(Hm), dhy = dFdy(Hm);
  vec3 r1 = cross(dpdy, ng), r2 = cross(ng, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  vec3 n = normalize(abs(det) * ng - grad * (1.0 - smoothstep(30.0, 120.0, dist)));
  if (any(isnan(n))) n = ng;
  // ---- wind ripples in sand: crests perpendicular to the wind
  vec2 wd = normalize(uWind.xy + vec2(0.0001));
  float rp = dot(wp.xz, wd) * 17.0 + nm.r * 9.0 + nM.a * 5.0;
  float rippleFade = sand * (1.0 - smoothstep(4.0, 40.0, dist));
  n = normalize(n + vec3(wd.x, 0.0, wd.y) * cos(rp) * 0.18 * rippleFade);
  float rough = mix(0.92, 0.5, snow);
  float f0 = 0.02 + snow * 0.02;
  float sh = shadowAt(vRel, ng);
  vec3 c = shade(albedo, n, vRel, sh, ao, rough, f0);
  c = aerial(c, vRel);
  outColor = vec4(c, 1.0);
#endif
}`;

// ---------------- instanced objects (vegetation, fauna, buildings) ----------------
// Instance attributes:
//   I0 = (x, y, z, yaw)    world position
//   I1 = (scale, tint rgb)
//   I2 = (phase, amp, pitch/headDown, bank)
export const INST_VS = /* glsl */`
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aCol;
layout(location=3) in vec4 aLimb;
layout(location=4) in vec2 aUV;
layout(location=5) in vec4 iPos;
layout(location=6) in vec4 iScale;
layout(location=7) in vec4 iAnim;
uniform int uKind;      // 0 plant/static, 1 walker, 2 flyer
uniform float uSway;
uniform float uHeight;
${COMMON}
#ifdef DEPTH
uniform mat4 uLightMat;
#endif
out vec3 vRel; out vec3 vNrm; out vec3 vCol; out vec2 vUV; out float vH;

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1,0,0, 0,c,s, 0,-s,c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c,0,-s, 0,1,0, s,0,c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c,s,0, -s,c,0, 0,0,1); }

void main() {
  vec3 p = aPos;
  vec3 nr = aNrm;
  int limb = int(aLimb.x + 0.5);
  float phase = iAnim.x, amp = iAnim.y;
  if (uKind == 1) {
    if (limb == 1) {
      mat3 r = rotX(sin(phase + aLimb.y) * amp);
      vec3 piv = vec3(p.x, aLimb.z, aLimb.w);
      p = r * (p - piv) + piv; nr = r * nr;
    } else if (limb == 3) {
      mat3 r = rotX(iAnim.z * 0.9 + sin(phase * 2.0) * amp * 0.08);
      vec3 piv = vec3(0.0, aLimb.z, aLimb.w);
      p = r * (p - piv) + piv; nr = r * nr;
    } else if (limb == 4) {
      mat3 r = rotY(sin(uTime * 3.0 + phase) * 0.35);
      vec3 piv = vec3(0.0, aLimb.z, aLimb.w);
      p = r * (p - piv) + piv; nr = r * nr;
    }
  } else if (uKind == 2) {
    if (limb == 2) {
      float s = sign(p.x);
      mat3 r = rotZ(-s * (sin(phase) * amp + 0.06));
      vec3 piv = vec3(0.0, aLimb.z, p.z);
      p = r * (p - piv) + piv; nr = r * nr;
    } else if (limb == 1) {
      mat3 r = rotX(1.2);
      vec3 piv = vec3(p.x, aLimb.z, aLimb.w);
      p = r * (p - piv) + piv; nr = r * nr;
    }
  }
  float yaw = iPos.w;
  mat3 R = rotY(yaw);
  if (uKind == 2) R = rotY(yaw) * rotX(-iAnim.z) * rotZ(iAnim.w);
  else if (uKind == 1) R = rotY(yaw) * rotX(-iAnim.w);
  vec3 wp = R * (p * iScale.x);
  vec3 wn = R * nr;
  vec3 rel = wp + iPos.xyz - uCamPos;
  if (uKind == 0 && uSway > 0.0) {
    // wind: whole plant bends with height; leaves and fronds flutter
    float hgt = max(p.y, 0.0) / max(uHeight, 0.1);
    float gust = 0.6 + 0.4 * sin(uTime * 1.3 + iPos.x * 0.07 + iPos.z * 0.05) + uWind.z * sin(uTime * 4.1 + iPos.x);
    float flutter = (limb == 5 || aUV.x >= 0.0) ? (1.0 + 0.5 * sin(uTime * 7.0 + aLimb.y + iPos.z + p.x * 3.0)) : 1.0;
    vec2 w = uWind.xy * 0.02 * uSway * hgt * hgt * gust * flutter * iScale.x;
    rel.xz += w;
    rel.y -= dot(w, w) * 0.5;
  }
  vUV = aUV;
#ifdef DEPTH
  gl_Position = uLightMat * vec4(rel, 1.0);
#else
  vRel = rel; vNrm = wn; vCol = aCol * iScale.yzw; vH = clamp(p.y / max(uHeight, 0.1), 0.0, 1.0);
  gl_Position = uViewProj * vec4(rel, 1.0);
#endif
}`;

export const INST_FS = /* glsl */`
${COMMON}
in vec3 vRel; in vec3 vNrm; in vec3 vCol; in vec2 vUV; in float vH;
uniform float uSpec;
uniform int uKind;
uniform sampler2D uFoliage;
out vec4 outColor;
void main() {
  float alpha = 1.0;
  vec3 tex = vec3(1.0);
  if (vUV.x >= 0.0) {
    // foliage atlas: 8 tiles in a 4x2 grid
    float tile = floor(vUV.x);
    vec2 uv = vec2((mod(tile, 4.0) + fract(vUV.x)) / 4.0, (1.0 - floor(tile / 4.0) + clamp(vUV.y, 0.002, 0.998)) / 2.0);
    vec4 t = texture(uFoliage, uv);
    // keep alpha-tested edges crisp across mip levels
    alpha = (t.a - 0.45) / max(fwidth(t.a), 1e-4) + 0.5;
    if (alpha < 0.02) discard;
    tex = t.rgb;
  }
#ifdef DEPTH
  outColor = vec4(1.0);
#else
  if (uKind == 0) {
    float d = length(vRel);
    if (d < 4.5 && hash12(gl_FragCoord.xy) > smoothstep(1.5, 4.5, d)) discard;
  }
  vec3 n = normalize(vNrm);
  bool card = vUV.x >= 0.0;
  if (!gl_FrontFacing && !card) n = -n;
  vec3 albedo = toLinear(vCol * tex);
  float sh = shadowAt(vRel, n);
  // foliage self-occlusion: darker towards the base and inside the crown
  float ao = card ? mix(0.45, 1.0, vH) : 0.9;
  vec3 c = shade(albedo, n, vRel, sh, ao, 0.8, uSpec);
  if (card) {
    // light through leaves: thin foliage glows when backlit by the sun
    vec3 v = normalize(vRel);
    float back = pow(max(dot(v, uSunDir), 0.0), 3.0);
    c += albedo * uSunColor * (0.08 + back * 0.6) * sh * cloudShadow(vRel + uCamPos) * vec3(1.0, 1.1, 0.6) / PI;
  }
  c = aerial(c, vRel);
  outColor = vec4(c, clamp(alpha, 0.0, 1.0));
#endif
}`;

// ---------------- single objects (vehicle) ----------------
export const OBJ_VS = /* glsl */`
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aCol;
layout(location=3) in vec4 aLimb;
uniform mat4 uModel;
${COMMON}
#ifdef DEPTH
uniform mat4 uLightMat;
#endif
out vec3 vRel; out vec3 vNrm; out vec3 vCol; out vec3 vLocal; flat out int vMat;
void main() {
  vec4 rel = uModel * vec4(aPos, 1.0);
  vLocal = aPos;
  vMat = int(aLimb.x + 0.5);
#ifdef DEPTH
  gl_Position = uLightMat * rel;
#else
  vRel = rel.xyz; vNrm = mat3(uModel) * aNrm; vCol = aCol;
  gl_Position = uViewProj * rel;
#endif
}`;

export const OBJ_FS = /* glsl */`
${COMMON}
in vec3 vRel; in vec3 vNrm; in vec3 vCol; in vec3 vLocal; flat in int vMat;
uniform float uSpec;
uniform vec3 uDirt;
uniform vec3 uDirtColor;
uniform float uEmissive;
out vec4 outColor;
void main() {
#ifdef DEPTH
  outColor = vec4(1.0);
#else
  vec3 n = normalize(vNrm);
  vec3 albedo = toLinear(vCol);
  // dust: thick on sills, wheels and the rear, streaked by airflow, settled on top faces
  float streak = noiseTex(vec2(vLocal.z * 0.7, vLocal.y * 4.0) + vLocal.x * 0.5).r;
  float speck = noiseTex(vLocal.xz * 3.0 + vLocal.y).b;
  float dirt = uDirt.x * clamp((1.0 - smoothstep(-0.7, 0.75, vLocal.y)) * 1.15 + max(n.y, 0.0) * 0.3 + (streak - 0.5) * 0.6 + (speck - 0.5) * 0.4 + smoothstep(-1.2, -2.3, vLocal.z) * 0.3, 0.0, 1.0);
  float rough = 0.6, f0 = 0.04, metal = 0.0, emiss = 0.0;
  if (vMat == 0) { rough = 0.22; f0 = 0.05; }                   // clear-coat paint
  else if (vMat == 1) { rough = 0.04; f0 = 0.06; albedo *= 0.4; } // glass
  else if (vMat == 2) { rough = 0.88; f0 = 0.02; }               // rubber
  else if (vMat == 3) { rough = 0.65; f0 = 0.035; }              // plastic
  else if (vMat == 4) { rough = 0.08; f0 = 0.05; emiss = uEmissive * 40.0; }
  else if (vMat == 5) { rough = 0.35; metal = 0.85; }            // metal
  else if (vMat == 6) { rough = 0.15; emiss = uEmissive * 3.0; }
  else if (vMat == 7) { rough = 0.6; }
  if (vMat != 1) albedo = mix(albedo, toLinear(uDirtColor) * 0.75, dirt * 0.9);
  else albedo = mix(albedo, toLinear(uDirtColor) * 0.6, dirt * 0.35);
  rough = mix(rough, 0.95, dirt * (vMat == 1 ? 0.4 : 0.9));
  vec3 spec0 = mix(vec3(f0), albedo, metal);
  float sh = shadowAt(vRel, n);
  vec3 dif = albedo * (1.0 - metal);
  vec3 c = shade(dif, n, vRel, sh, 1.0, rough, 0.0);
  // specular (sun + sky reflection), Fresnel-weighted
  vec3 v = -normalize(vRel);
  float nv = max(dot(n, v), 0.0);
  vec3 F = spec0 + (1.0 - spec0) * pow(1.0 - nv, 5.0) * (1.0 - rough);
  float vis = sh * cloudShadow(vRel + uCamPos);
  c += uSunColor * ggx(n, v, uSunDir, max(rough, 0.05)) * max(dot(n, uSunDir), 0.0) * vis * F;
  vec3 r = reflect(-v, n);
  vec3 env = skyRadiance(normalize(vec3(r.x, max(r.y, 0.03), r.z)));
  // the ground reflects too: darker, warm lower hemisphere
  env = mix(skyAmbient(vec3(0, -1, 0)) * 0.8, env, smoothstep(-0.15, 0.1, r.y));
  c += env * F * (1.0 - rough * 0.85);
  c += albedo * emiss + vec3(1.0, 0.9, 0.75) * emiss * 0.2;
  c = aerial(c, vRel);
  outColor = vec4(c, 1.0);
#endif
}`;

// ---------------- sky (with raymarched clouds, sun, moon, stars) ----------------
export const SKY_VS = /* glsl */`
out vec2 vNdc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 0.99999, 1.0);
}`;

export const SKY_FS = /* glsl */`
${COMMON}
uniform mat4 uInvViewProj;
uniform float uStars;
uniform vec3 uSunDisk;    // radiance of the sun disk (transmitted), zero at night
uniform vec3 uMoonDir;
uniform int uCloudSteps;
in vec2 vNdc;
out vec4 outColor;
float hg(float c, float g) { return (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * c, 1.5)); }
void main() {
  vec4 w = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(w.xyz / w.w);
  vec3 c = skyRadiance(dir);
  // sun disk with limb darkening
  float sd = dot(dir, normalize(uSunDisk.x + uSunDisk.y + uSunDisk.z > 0.0 ? uSunDir : vec3(0, -1, 0)));
  float disk = smoothstep(0.999955, 0.99997, sd);
  if (disk > 0.0) {
    float r = clamp((1.0 - sd) / (1.0 - 0.99996), 0.0, 1.0);
    c += uSunDisk * disk * (0.6 + 0.4 * sqrt(1.0 - r));
  }
  // stars, Milky Way and moon
  if (uStars > 0.0 && dir.y > -0.02) {
    vec3 sp = dir * 420.0;
    vec2 g = sp.xz / (sp.y + 60.0) * 140.0;
    vec2 cell = floor(g);
    float h = hash12(cell);
    float star = step(0.9968, h) * (0.7 + 0.3 * sin(uTime * 2.5 + h * 300.0));
    star *= smoothstep(0.32, 0.0, length(fract(g) - 0.5));
    float bright = pow(hash12(cell + 7.0), 6.0) * 6.0 + 0.4;
    float band = exp(-pow(dot(dir, normalize(vec3(0.4, 0.5, -0.75))), 2.0) * 25.0) * (0.4 + 0.6 * noiseTex(dir.xz * 2.0).r);
    vec3 stars = vec3(star * bright) * vec3(0.9, 0.95, 1.0) + vec3(0.55, 0.6, 0.8) * band * 0.06;
    c += stars * 0.012 * uStars * smoothstep(-0.02, 0.2, dir.y);
    float md = dot(dir, uMoonDir);
    float moon = smoothstep(0.99985, 0.99992, md);
    float crater = 0.8 + 0.2 * noiseTex(dir.xz * 400.0).g;
    c += vec3(0.9, 0.92, 0.95) * moon * crater * 0.4 * uStars;
    c += vec3(0.5, 0.6, 0.8) * pow(max(md, 0.0), 300.0) * 0.0015 * uStars;
  }
  // clouds: march a slab between base and base + thickness
  if (uCloud.x > 0.0 && dir.y > 0.005) {
    float b0 = uCloud.y, b1 = uCloud.y + uCloud.z;
    float t0 = (b0 - uCamPos.y) / dir.y, t1 = (b1 - uCamPos.y) / dir.y;
    if (t0 > 0.0) {
      int N = uCloudSteps;
      float dt = (t1 - t0) / float(N);
      float T = 1.0;
      vec3 L = vec3(0.0);
      float cosT = dot(dir, uSunDir);
      float phase = mix(hg(cosT, 0.6), hg(cosT, -0.2), 0.3);
      vec3 amb = skyRadiance(vec3(0.0, 1.0, 0.0)) * 1.4;
      float jitter = hash12(gl_FragCoord.xy + fract(uTime));
      for (int i = 0; i < 24; i++) {
        if (i >= N) break;
        float t = t0 + (float(i) + jitter) * dt;
        vec3 p = uCamPos + dir * t;
        float hf = (p.y - b0) / uCloud.z;
        float profile = smoothstep(0.0, 0.2, hf) * smoothstep(1.0, 0.45, hf);
        float cov = cloudCover(p.xz);
        float erode = noiseTex(p.xz / 700.0 + p.y / 2000.0).g;
        float dens = max(cov * profile - erode * 0.35, 0.0) * 0.0045;
        if (dens <= 0.0) continue;
        // light toward the sun: one tap above for self-shadowing
        vec3 q = p + uSunDir * (uCloud.z * 0.35);
        float hq = (q.y - b0) / uCloud.z;
        float dl = max(cloudCover(q.xz) * smoothstep(1.0, 0.45, hq) - 0.15, 0.0) * 0.0045 * uCloud.z * 0.6;
        float beer = exp(-dl * 2.0);
        float powder = 1.0 - exp(-dens * dt * 4.0);
        vec3 S = (uSunColor * beer * phase * (0.5 + powder) * 2.2 + amb * (0.35 + 0.65 * hf)) * dens;
        float Ts = exp(-dens * dt);
        L += T * S * (1.0 - Ts) / dens;
        T *= Ts;
        if (T < 0.02) break;
      }
      // distant clouds melt into the haze
      float fade = exp(-t0 / 60000.0);
      c = mix(c, c * T + L, fade * smoothstep(0.005, 0.06, dir.y));
    }
  }
  outColor = vec4(c, 1.0);
}`;

// ---------------- water ----------------
export const WATER_VS = /* glsl */`
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aFlow;
uniform vec3 uOrigin;
${COMMON}
out vec3 vRel; out vec3 vFlow;
void main() {
  vec3 rel = aPos + uOrigin;
  vRel = rel; vFlow = aFlow;
  gl_Position = uViewProj * vec4(rel, 1.0);
}`;

export const WATER_FS = /* glsl */`
${COMMON}
uniform sampler2D uDepth;
uniform vec2 uViewport;
uniform vec2 uNearFar;
in vec3 vRel; in vec3 vFlow;
out vec4 outColor;
float linDepth(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x)); }
void main() {
  vec3 wp = vRel + uCamPos;
  vec2 fl = vFlow.xz;
  vec2 uv = wp.xz / 9.0 - fl * uTime * 0.04;
  vec2 uv2 = wp.xz / 3.1 - fl * uTime * 0.09 + 0.3;
  float e = 0.01;
  float h0 = noiseTex(uv).r + noiseTex(uv2).b * 0.5;
  float hx = noiseTex(uv + vec2(e, 0)).r + noiseTex(uv2 + vec2(e * 2.9, 0)).b * 0.5;
  float hz = noiseTex(uv + vec2(0, e)).r + noiseTex(uv2 + vec2(0, e * 2.9)).b * 0.5;
  vec3 n = normalize(vec3((h0 - hx) * 1.2, 1.0, (h0 - hz) * 1.2));
  vec3 v = -normalize(vRel);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 refl = skyRadiance(normalize(vec3(r.x, max(r.y, 0.01), r.z)));
  // depth of water under this pixel from the scene depth buffer
  float sceneD = linDepth(texture(uDepth, gl_FragCoord.xy / uViewport).r);
  float thick = max(sceneD - length(vRel), 0.0);
  vec3 murk = vec3(0.16, 0.13, 0.07) * (skyAmbient(vec3(0, 1, 0)) + uSunColor * max(uSunDir.y, 0.0) / PI);
  float sh = shadowAt(vRel, vec3(0, 1, 0)) * cloudShadow(wp);
  vec3 c = mix(murk, refl, fres);
  c += uSunColor * ggx(n, v, uSunDir, 0.08) * max(dot(n, uSunDir), 0.0) * sh * 0.6;
  float foam = smoothstep(0.8, 1.0, vFlow.y) * smoothstep(0.4, 0.7, noiseTex(wp.xz / 1.7 - fl * uTime * 0.12).r);
  c = mix(c, skyAmbient(vec3(0, 1, 0)) * 0.8 + uSunColor * max(uSunDir.y, 0.0) / PI * 0.7, foam * 0.5);
  c = aerial(c, vRel);
  float a = clamp(thick * 1.5, 0.0, 1.0) * mix(0.92, 0.75, vFlow.y);
  outColor = vec4(c, max(a, fres * 0.8));
}`;

// ---------------- road ribbon ----------------
export const ROAD_VS = /* glsl */`
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aUV;
uniform vec3 uOrigin;
${COMMON}
out vec3 vRel; out vec3 vNrm; out vec3 vUV;
void main() {
  vec3 rel = aPos + uOrigin;
  vRel = rel; vNrm = aNrm; vUV = aUV;
  gl_Position = uViewProj * vec4(rel, 1.0);
}`;

export const ROAD_FS = /* glsl */`
${COMMON}
in vec3 vRel; in vec3 vNrm; in vec3 vUV;
uniform vec3 uPisteColor;
out vec4 outColor;
void main() {
  vec3 wp = vRel + uCamPos;
  float u = vUV.x, v = vUV.y;
  float dist = length(vRel);
  vec3 n = normalize(vNrm);
  vec3 albedo;
  float alpha = 1.0, rough = 0.85, f0 = 0.0;
  vec4 nf = noiseTex(wp.xz / 2.1);
  vec4 nm = noiseTex(wp.xz / 23.0);
  if (vUV.z < 0.5) {
    // weathered asphalt: aggregate speckle, patches, bleached edges and paint
    albedo = toLinear(vec3(0.2, 0.2, 0.205)) * (0.75 + 0.35 * nf.r) * (0.85 + 0.3 * nm.a);
    albedo *= 1.0 + 0.5 * step(0.8, noiseTex(wp.xz / 0.3).b);
    float dash = step(abs(u), 0.022) * step(fract(v / 12.0), 0.45);
    float edge = step(0.9, abs(u)) * step(abs(u), 0.94);
    float paint = max(dash, edge) * (0.6 + 0.4 * smoothstep(0.25, 0.6, nf.a));
    albedo = mix(albedo, toLinear(vec3(0.8, 0.78, 0.68)), paint);
    alpha = 1.0 - smoothstep(0.95, 1.0, abs(u));
    albedo = mix(albedo, toLinear(uPisteColor), smoothstep(0.92, 1.0, abs(u)) * 0.7);
    rough = 0.75; f0 = 0.03;
  } else {
    // gravel piste: two packed wheel tracks, loose gravel crown and verges
    float rut = exp(-pow((abs(u) - 0.45) * 6.0, 2.0));
    albedo = toLinear(uPisteColor) * (0.85 + 0.25 * nf.r) * (0.9 + 0.2 * nm.r) * (1.0 - rut * 0.12);
    float stones = smoothstep(0.3, 0.1, noiseTex(wp.xz / 0.4).g) * (1.0 - rut);
    albedo *= 1.0 - stones * 0.25;
    alpha = (1.0 - smoothstep(0.55, 1.0, abs(u) + (nm.r - 0.5) * 0.25)) * 0.95;
  }
  float sh = shadowAt(vRel, n);
  vec3 c = shade(albedo, n, vRel, sh, 1.0, rough, f0);
  c = aerial(c, vRel);
  outColor = vec4(c, alpha * (1.0 - smoothstep(1400.0, 2000.0, dist)));
}`;

// ---------------- particles (soft, forward-scattering dust) ----------------
export const PART_VS = /* glsl */`
layout(location=0) in vec2 aCorner;
layout(location=5) in vec4 iPosSize;
layout(location=6) in vec4 iColor;
uniform vec3 uRight; uniform vec3 uUp;
${COMMON}
out vec2 vUV; out vec4 vColor; out vec3 vRel;
void main() {
  vec3 rel = iPosSize.xyz - uCamPos + (uRight * aCorner.x + uUp * aCorner.y) * iPosSize.w;
  vUV = aCorner; vColor = iColor; vRel = rel;
  gl_Position = uViewProj * vec4(rel, 1.0);
}`;

export const PART_FS = /* glsl */`
${COMMON}
uniform sampler2D uDepth;
uniform vec2 uViewport;
uniform vec2 uNearFar;
in vec2 vUV; in vec4 vColor; in vec3 vRel;
out vec4 outColor;
float linDepth(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x)); }
float hg(float c, float g) { return (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * c, 1.5)); }
void main() {
  float r = length(vUV);
  // billowy puff: noise-eroded disc
  float puff = noiseTex(vUV * 0.35 + vColor.rg * 3.0 + uTime * 0.01).r;
  float a = smoothstep(1.0, 0.1, r + (puff - 0.5) * 0.6) * vColor.a;
  // soft particles: fade where they meet geometry
  float sceneD = linDepth(texture(uDepth, gl_FragCoord.xy / uViewport).r);
  float dz = sceneD - length(vRel);
  a *= clamp(dz / 1.5, 0.0, 1.0) * smoothstep(0.3, 1.5, length(vRel));
  if (a < 0.003) discard;
  vec3 albedo = toLinear(vColor.rgb);
  vec3 v = normalize(vRel);
  float ph = hg(dot(v, uSunDir), 0.55) * 4.0 * PI;
  vec3 c = albedo * (uSunColor / PI * (0.35 + ph * 0.5) * cloudShadow(vRel + uCamPos) + skyAmbient(vec3(0, 1, 0)));
  c = aerial(c, vRel);
  outColor = vec4(c * a, a); // premultiplied
}`;
