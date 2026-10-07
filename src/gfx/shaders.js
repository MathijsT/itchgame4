// GLSL sources. All geometry is rendered camera-relative (the camera sits at
// the origin of the view matrix) to keep float precision over 40 km worlds.

export const COMMON = /* glsl */`
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uGroundAmb;
uniform vec4 uFog;        // x density, y height falloff, z fog base height, w dust storm
uniform vec3 uDustColor;
uniform float uTime;
uniform vec4 uWind;       // xz wind m/s, z gust, w turbulence
uniform float uExposure;
uniform vec3 uHeadPos;
uniform vec3 uHeadDir;
uniform float uHeadOn;
uniform vec3 uMoonColor;
#ifdef SHADOWS
uniform mat4 uShadowMat0;
uniform mat4 uShadowMat1;
uniform highp sampler2DShadow uShadow0;
uniform highp sampler2DShadow uShadow1;
uniform vec4 uShadowInfo; // x cascades, y texel0, z texel1
#endif

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm3(vec2 p) {
  return vnoise(p) * 0.5 + vnoise(p * 2.07 + 13.1) * 0.3 + vnoise(p * 4.13 + 7.7) * 0.2;
}
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 finalColor(vec3 c) {
  return pow(aces(c * uExposure), vec3(1.0 / 2.2));
}

vec3 skyColor(vec3 dir) {
  float y = max(dir.y, 0.0);
  float t = pow(1.0 - y, 4.0);
  vec3 c = mix(uSkyZenith, uSkyHorizon, t);
  float sd = max(dot(dir, uSunDir), 0.0);
  c += uSunColor * (pow(sd, 6.0) * 0.08 + pow(sd, 64.0) * 0.25) * (0.4 + 0.6 * t);
  c = mix(c, uDustColor * (uSunColor * 0.25 + uSkyHorizon * 0.8), uFog.w * 0.85);
  return c;
}

// Exponential height fog with sun in-scattering; rel = position - camera
vec3 applyFog(vec3 col, vec3 rel) {
  float dist = length(rel);
  vec3 dir = rel / max(dist, 0.001);
  float b = uFog.y;
  float h0 = uCamPos.y - uFog.z;
  float dy = dir.y * b;
  float od = uFog.x * exp(-h0 * b) * (abs(dy) > 1e-5 ? (1.0 - exp(-dist * dy)) / dy : dist);
  od += uFog.w * dist * 0.012;
  float f = 1.0 - exp(-max(od, 0.0));
  vec3 fc = skyColor(vec3(dir.x, max(dir.y, 0.0) * 0.3, dir.z));
  return mix(col, fc, f);
}

#ifdef SHADOWS
float sampleCascade(highp sampler2DShadow sm, vec3 c, float texel) {
  float s = 0.0;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
      s += texture(sm, vec3(c.xy + vec2(float(i), float(j)) * texel, c.z));
  return s / 9.0;
}
float shadowAt(vec3 rel, vec3 n) {
  vec3 p = rel + n * 0.08;
  vec4 a = uShadowMat0 * vec4(p, 1.0);
  vec3 c = a.xyz * 0.5 + 0.5;
  if (all(greaterThan(c.xy, vec2(0.02))) && all(lessThan(c.xy, vec2(0.98))) && c.z < 1.0) {
    return sampleCascade(uShadow0, c - vec3(0, 0, 0.0007), uShadowInfo.y);
  }
  if (uShadowInfo.x > 1.5) {
    vec4 b2 = uShadowMat1 * vec4(rel + n * 0.6, 1.0);
    vec3 c2 = b2.xyz * 0.5 + 0.5;
    if (all(greaterThan(c2.xy, vec2(0.0))) && all(lessThan(c2.xy, vec2(1.0))) && c2.z < 1.0) {
      float edge = smoothstep(0.42, 0.5, max(abs(c2.x - 0.5), abs(c2.y - 0.5)));
      return mix(sampleCascade(uShadow1, c2 - vec3(0, 0, 0.0012), uShadowInfo.z), 1.0, edge);
    }
  }
  return 1.0;
}
#else
float shadowAt(vec3 rel, vec3 n) { return 1.0; }
#endif

vec3 lighting(vec3 albedo, vec3 n, vec3 rel, float shadow, float ao, float spec) {
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 amb = mix(uGroundAmb, uSkyZenith * 1.6 + uSkyHorizon * 0.4, n.y * 0.5 + 0.5);
  vec3 moonDir = normalize(vec3(-uSunDir.x, abs(uSunDir.y) + 0.3, -uSunDir.z));
  vec3 c = albedo * (uSunColor * ndl * shadow + amb * ao + uMoonColor * max(dot(n, moonDir), 0.0));
  if (spec > 0.0) {
    vec3 v = -normalize(rel);
    vec3 h = normalize(uSunDir + v);
    c += uSunColor * pow(max(dot(n, h), 0.0), 60.0) * spec * shadow * ndl;
  }
  if (uHeadOn > 0.0) {
    vec3 L = uHeadPos - rel;
    float d = length(L);
    L /= d;
    float spot = smoothstep(0.72, 0.93, dot(-L, uHeadDir));
    c += albedo * vec3(1.0, 0.93, 0.8) * uHeadOn * spot * max(dot(n, L), 0.0) * 700.0 / (d * d + 60.0);
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
out vec3 vRel; out vec3 vNrm; out vec3 vCol; out vec4 vDetail;
#ifdef DEPTH
uniform mat4 uLightMat;
#endif
void main() {
  vec3 rel = aPos + uOrigin;
#ifdef DEPTH
  gl_Position = uLightMat * vec4(rel, 1.0);
#else
  vRel = rel; vNrm = aNrm; vCol = aCol.rgb; vDetail = aDetail;
  gl_Position = uViewProj * vec4(rel, 1.0);
#endif
}`;

export const TERRAIN_FS = /* glsl */`
${COMMON}
in vec3 vRel; in vec3 vNrm; in vec3 vCol; in vec4 vDetail;
out vec4 outColor;
void main() {
#ifdef DEPTH
  outColor = vec4(1.0);
#else
  vec3 wp = vRel + uCamPos;
  vec3 n = normalize(vNrm);
  float dist = length(vRel);
  vec3 albedo = toLinear(vCol);
  float sand = vDetail.x, rock = vDetail.y, snow = vDetail.z, veg = vDetail.w;
  // multi-scale albedo breakup
  float nB = fbm3(wp.xz * 0.05);
  float nM = vnoise(wp.xz * 0.6);
  float nF = vnoise(wp.xz * 3.1);
  float fadeNear = 1.0 - smoothstep(30.0, 140.0, dist);
  albedo *= 0.86 + 0.28 * nB;
  albedo *= mix(1.0, 0.88 + 0.24 * nM, fadeNear * (1.0 - sand * 0.5));
  albedo *= mix(1.0, 0.92 + 0.16 * nF, fadeNear * 0.8);
  // sedimentary strata in exposed rock (mesas and red Anti-Atlas cliffs)
  float strata = sin(wp.y * 1.7 + nB * 6.0) * 0.5 + 0.5;
  albedo *= mix(1.0, 0.82 + 0.3 * strata, rock * (1.0 - n.y * 0.6));
  // vegetation: greener and darker patches, dry tips
  albedo = mix(albedo, albedo * vec3(0.85, 1.05, 0.8), veg * (nM - 0.5) * 0.8);
  // wind ripples on sand: crests perpendicular to the wind, fading with distance
  vec2 wd = normalize(uWind.xy + vec2(0.0001));
  float rp = dot(wp.xz, wd) * 18.0 + vnoise(wp.xz * 0.4) * 6.0 + vnoise(wp.xz * 2.0) * 1.5;
  // fade before the ripples alias (wavelength ~35 cm)
  float rippleFade = sand * (1.0 - smoothstep(4.0, 32.0, dist));
  vec3 tilt = vec3(wd.x, 0.0, wd.y) * cos(rp) * 0.16 * rippleFade;
  n = normalize(n + tilt);
  albedo *= 1.0 - rippleFade * 0.06 * sin(rp);
  // snow glints
  float glint = snow * step(0.985, hash12(floor(wp.xz * 8.0))) * fadeNear;
  float sh = shadowAt(vRel, n);
  vec3 c = lighting(albedo, n, vRel, sh, 1.0, glint * 4.0 + snow * 0.15);
  c = applyFog(c, vRel);
  outColor = vec4(finalColor(c), 1.0);
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
out vec3 vRel; out vec3 vNrm; out vec3 vCol;

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1,0,0, 0,c,s, 0,-s,c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c,0,-s, 0,1,0, s,0,c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c,s,0, -s,c,0, 0,0,1); }

void main() {
  vec3 p = aPos;
  vec3 nr = aNrm;
  int limb = int(aLimb.x + 0.5);
  float phase = iAnim.x, amp = iAnim.y;
  if (uKind == 1) {
    if (limb == 1) { // leg swing about the hip
      mat3 r = rotX(sin(phase + aLimb.y) * amp);
      vec3 piv = vec3(p.x, aLimb.z, aLimb.w);
      p = r * (p - piv) + piv; nr = r * nr;
    } else if (limb == 3) { // head: graze (down) + bob
      mat3 r = rotX(iAnim.z * 0.9 + sin(phase * 2.0) * amp * 0.08);
      vec3 piv = vec3(0.0, aLimb.z, aLimb.w);
      p = r * (p - piv) + piv; nr = r * nr;
    } else if (limb == 4) { // tail flick
      mat3 r = rotY(sin(uTime * 3.0 + phase) * 0.35);
      vec3 piv = vec3(0.0, aLimb.z, aLimb.w);
      p = r * (p - piv) + piv; nr = r * nr;
    }
  } else if (uKind == 2) {
    if (limb == 2) { // wing flap about the shoulder line
      float s = sign(p.x);
      mat3 r = rotZ(-s * (sin(phase) * amp + 0.06));
      vec3 piv = vec3(0.0, aLimb.z, p.z);
      p = r * (p - piv) + piv; nr = r * nr;
    } else if (limb == 1) {
      mat3 r = rotX(1.2); // legs trail behind in flight
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
    // wind sway grows with height; fronds and grass blades flutter more
    float hgt = max(p.y, 0.0) / max(uHeight, 0.1);
    float gust = 0.6 + 0.4 * sin(uTime * 1.3 + iPos.x * 0.07 + iPos.z * 0.05) + uWind.z * sin(uTime * 4.1 + iPos.x);
    float flutter = limb == 5 ? (1.5 + sin(uTime * 6.0 + aLimb.y + iPos.z) * 0.6) : 1.0;
    vec2 w = uWind.xy * 0.02 * uSway * hgt * hgt * gust * flutter * iScale.x;
    rel.xz += w;
    rel.y -= dot(w, w) * 0.5;
  }
#ifdef DEPTH
  gl_Position = uLightMat * vec4(rel, 1.0);
#else
  vRel = rel; vNrm = wn; vCol = aCol * iScale.yzw;
  gl_Position = uViewProj * vec4(rel, 1.0);
#endif
}`;

export const INST_FS = /* glsl */`
${COMMON}
in vec3 vRel; in vec3 vNrm; in vec3 vCol;
uniform float uSpec;
uniform int uKind;
out vec4 outColor;
void main() {
#ifdef DEPTH
  outColor = vec4(1.0);
#else
  // screen-door fade for plants right in front of the camera
  if (uKind == 0) {
    float d = length(vRel);
    if (d < 4.5 && hash12(gl_FragCoord.xy) > smoothstep(1.5, 4.5, d)) discard;
  }
  vec3 n = normalize(vNrm);
  if (!gl_FrontFacing) n = -n;
  vec3 albedo = toLinear(vCol);
  float sh = shadowAt(vRel, n);
  vec3 c = lighting(albedo, n, vRel, sh, 0.9, uSpec);
  c = applyFog(c, vRel);
  outColor = vec4(finalColor(c), 1.0);
#endif
}`;

// ---------------- single objects (vehicle) ----------------
export const OBJ_VS = /* glsl */`
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aCol;
uniform mat4 uModel; // camera-relative model matrix
${COMMON}
#ifdef DEPTH
uniform mat4 uLightMat;
#endif
out vec3 vRel; out vec3 vNrm; out vec3 vCol;
void main() {
  vec4 rel = uModel * vec4(aPos, 1.0);
#ifdef DEPTH
  gl_Position = uLightMat * rel;
#else
  vRel = rel.xyz; vNrm = mat3(uModel) * aNrm; vCol = aCol;
  gl_Position = uViewProj * rel;
#endif
}`;

export const OBJ_FS = /* glsl */`
${COMMON}
in vec3 vRel; in vec3 vNrm; in vec3 vCol;
uniform float uSpec;
uniform vec3 uDirt; // x amount, rgb in uDirtColor
uniform vec3 uDirtColor;
uniform float uEmissive;
out vec4 outColor;
void main() {
#ifdef DEPTH
  outColor = vec4(1.0);
#else
  vec3 n = normalize(vNrm);
  vec3 albedo = toLinear(vCol);
  // dust accumulates on the lower body and on upward faces
  float dirt = uDirt.x * clamp(0.4 + 0.6 * (1.0 - smoothstep(-0.2, 0.9, vRel.y - uDirt.y)) + vnoise((vRel.xz + uCamPos.xz) * 4.0) * 0.3, 0.0, 1.0);
  albedo = mix(albedo, toLinear(uDirtColor), dirt * 0.75);
  float sh = shadowAt(vRel, n);
  vec3 c = lighting(albedo, n, vRel, sh, 1.0, uSpec * (1.0 - dirt * 0.8));
  // lamps: bright when emissive is on and the colour is near-white/yellow
  float lamp = step(0.97, vCol.r) * step(0.9, vCol.g) * step(vCol.b, 0.95);
  c += albedo * lamp * uEmissive * 30.0;
  c = applyFog(c, vRel);
  outColor = vec4(finalColor(c), 1.0);
#endif
}`;

// ---------------- sky ----------------
export const SKY_VS = /* glsl */`
out vec2 vNdc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 0.9999, 1.0);
}`;

export const SKY_FS = /* glsl */`
${COMMON}
uniform mat4 uInvViewProj;
uniform float uStars;
uniform float uClouds;
in vec2 vNdc;
out vec4 outColor;
void main() {
  vec4 w = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(w.xyz / w.w);
  vec3 c = skyColor(dir);
  // sun disk
  float sd = dot(dir, uSunDir);
  c += uSunColor * smoothstep(0.9997, 0.99985, sd) * 40.0 * (1.0 - uFog.w);
  // moon
  vec3 moonDir = normalize(vec3(-uSunDir.x, abs(uSunDir.y) + 0.3, -uSunDir.z));
  c += vec3(0.8, 0.85, 0.9) * smoothstep(0.99955, 0.9997, dot(dir, moonDir)) * uStars * 1.5;
  // stars: fixed in the sky dome, twinkling
  if (uStars > 0.0 && dir.y > 0.0) {
    vec3 sp = dir * 420.0;
    vec2 cell = floor(sp.xz / (sp.y + 60.0) * 120.0);
    float h = hash12(cell);
    float star = step(0.9975, h) * (0.6 + 0.4 * sin(uTime * 3.0 + h * 100.0));
    vec2 f = fract(sp.xz / (sp.y + 60.0) * 120.0) - 0.5;
    star *= smoothstep(0.25, 0.0, length(f));
    // the Milky Way: a faint band
    float band = exp(-pow(dot(dir, normalize(vec3(0.4, 0.5, -0.75))), 2.0) * 30.0) * fbm3(dir.xz * 8.0);
    c += (vec3(star) * 3.0 + vec3(0.6, 0.65, 0.8) * band * 0.08) * uStars * smoothstep(0.0, 0.15, dir.y) * (1.0 - uFog.w);
  }
  // high thin cloud
  if (uClouds > 0.0 && dir.y > 0.01) {
    vec2 uv = dir.xz / (dir.y + 0.08) * 1.2 + uWind.xy * uTime * 0.0004;
    float cl = smoothstep(1.0 - uClouds, 1.0, fbm3(uv * 1.3) * 0.8 + fbm3(uv * 5.0) * 0.35);
    vec3 cc = uSunColor * 0.35 + uSkyHorizon * 0.9;
    c = mix(c, cc, cl * 0.75 * smoothstep(0.01, 0.2, dir.y));
  }
  outColor = vec4(finalColor(c), 1.0);
}`;

// ---------------- water ----------------
export const WATER_VS = /* glsl */`
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aFlow; // xz flow direction * speed, y = edge (0 centre .. 1 bank)
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
in vec3 vRel; in vec3 vFlow;
out vec4 outColor;
void main() {
  vec3 wp = vRel + uCamPos;
  vec2 fl = vFlow.xz;
  vec2 uv = wp.xz * 0.35 - fl * uTime * 0.35;
  vec2 uv2 = wp.xz * 0.9 - fl * uTime * 0.6 + 4.0;
  float e = 0.05;
  float h0 = vnoise(uv) + vnoise(uv2) * 0.5;
  float hx = vnoise(uv + vec2(e, 0)) + vnoise(uv2 + vec2(e, 0)) * 0.5;
  float hz = vnoise(uv + vec2(0, e)) + vnoise(uv2 + vec2(0, e)) * 0.5;
  vec3 n = normalize(vec3((h0 - hx) * 2.5, 1.0, (h0 - hz) * 2.5));
  vec3 v = -normalize(vRel);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 refl = skyColor(normalize(vec3(r.x, abs(r.y), r.z)));
  vec3 base = toLinear(vec3(0.32, 0.27, 0.18)) * (uSunColor * max(uSunDir.y, 0.0) * 0.6 + uSkyZenith);
  float sh = shadowAt(vRel, vec3(0, 1, 0));
  vec3 c = mix(base, refl, fres);
  vec3 h = normalize(uSunDir + v);
  c += uSunColor * pow(max(dot(n, h), 0.0), 200.0) * 2.0 * sh;
  float foam = smoothstep(0.75, 1.0, vFlow.y) * (0.5 + 0.5 * vnoise(wp.xz * 2.0 - fl * uTime));
  c = mix(c, uSunColor * 0.5 + uSkyZenith, foam * 0.35);
  c = applyFog(c, vRel);
  outColor = vec4(finalColor(c), mix(0.88, 0.5, vFlow.y));
}`;

// ---------------- road ribbon ----------------
export const ROAD_VS = /* glsl */`
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aUV; // u across (-1..1), v along (m), w road type
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
  float alpha = 1.0;
  if (vUV.z < 0.5) {
    // asphalt with worn edges, centre dashes and edge lines
    albedo = toLinear(vec3(0.21, 0.21, 0.22)) * (0.85 + 0.3 * vnoise(wp.xz * 2.5));
    float dash = step(abs(u), 0.025) * step(fract(v / 12.0), 0.45);
    float edge = step(0.9, abs(u)) * step(abs(u), 0.95);
    albedo = mix(albedo, toLinear(vec3(0.85, 0.82, 0.7)), max(dash, edge) * 0.85);
    alpha = 1.0 - smoothstep(0.96, 1.0, abs(u));
    albedo = mix(albedo, toLinear(uPisteColor), smoothstep(0.93, 1.0, abs(u)));
  } else {
    // gravel piste: compacted wheel ruts and loose gravel in the middle
    float rut = exp(-pow((abs(u) - 0.45) * 7.0, 2.0));
    albedo = toLinear(uPisteColor) * (0.9 + 0.2 * vnoise(wp.xz * 3.0)) * (1.0 - rut * 0.18);
    alpha = (1.0 - smoothstep(0.7, 1.0, abs(u))) * 0.9;
  }
  float sh = shadowAt(vRel, n);
  vec3 c = lighting(albedo, n, vRel, sh, 1.0, vUV.z < 0.5 ? 0.05 : 0.0);
  c = applyFog(c, vRel);
  outColor = vec4(finalColor(c), alpha * (1.0 - smoothstep(1200.0, 1800.0, dist)));
}`;

// ---------------- particles ----------------
export const PART_VS = /* glsl */`
layout(location=0) in vec2 aCorner;
layout(location=5) in vec4 iPosSize;  // world pos, size
layout(location=6) in vec4 iColor;    // rgb, alpha
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
in vec2 vUV; in vec4 vColor; in vec3 vRel;
out vec4 outColor;
void main() {
  float r = length(vUV);
  float a = smoothstep(1.0, 0.2, r) * vColor.a;
  if (a < 0.003) discard;
  vec3 albedo = toLinear(vColor.rgb);
  vec3 c = albedo * (uSunColor * (0.45 + 0.35 * max(uSunDir.y, 0.0)) + uSkyZenith * 1.5 + uSkyHorizon * 0.5 + uMoonColor);
  c = applyFog(c, vRel);
  outColor = vec4(finalColor(c), a);
}`;
