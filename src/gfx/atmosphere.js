// Physically based atmosphere: Rayleigh + Mie + ozone single scattering with
// a multiple-scattering approximation, rendered into two small LUTs each
// frame (transmittance, sky-view). Scene shaders use the LUTs for sky colour,
// ambient light and aerial perspective. A matching CPU model gives the sun's
// transmitted colour at the camera.

import { Program } from './gl.js';

export const R_GROUND = 6360e3;
export const R_TOP = 6460e3;
export const BETA_R = [5.802e-6, 13.558e-6, 33.1e-6];
export const BETA_OZONE = [0.65e-6, 1.881e-6, 0.085e-6];
export const MIE_S = 3.996e-6, MIE_A = 4.4e-6;
export const H_R = 8000, H_M = 1200;

// GLSL shared by LUT passes and scene shaders
export const ATMOS_GLSL = /* glsl */`
const float RG = 6360e3;
const float RT = 6460e3;
const vec3 BETA_R = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const vec3 BETA_O = vec3(0.65e-6, 1.881e-6, 0.085e-6);
uniform vec4 uAtmo;      // x mie density scale (haze), y dust density, z ground altitude (m), w light intensity
uniform vec3 uDustTint;  // spectral extinction of airborne dust (more in blue)

float rayleighPhase(float c) { return 3.0 / (16.0 * 3.14159265) * (1.0 + c * c); }
float miePhase(float c) {
  const float g = 0.8;
  float k = 3.0 / (8.0 * 3.14159265) * ((1.0 - g * g) / (2.0 + g * g));
  return k * (1.0 + c * c) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
}
// scattering / extinction at altitude h (m above sea level)
void mediumAt(float h, out vec3 sR, out float sM, out vec3 ext) {
  float dR = exp(-h / 8000.0);
  float dM = exp(-h / 1200.0) * uAtmo.x;
  float dD = exp(-max(h - uAtmo.z, 0.0) / 900.0) * uAtmo.y;
  float dO = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0);
  sR = BETA_R * dR;
  sM = 3.996e-6 * dM + dD * 2.0e-4;
  ext = sR + vec3(sM) + vec3(4.4e-6 * dM) + BETA_O * dO + dD * 1.6e-4 * uDustTint;
}
// ray-sphere: distance to the sphere of radius r from height-radius ro along mu
float raySphere(float ro, float mu, float r) {
  float d = ro * ro * (mu * mu - 1.0) + r * r;
  if (d < 0.0) return -1.0;
  return -ro * mu + sqrt(d);
}
bool hitsGround(float ro, float mu) {
  float d = ro * ro * (mu * mu - 1.0) + RG * RG;
  return mu < 0.0 && d >= 0.0;
}
vec2 transUV(float h, float mu) {
  return vec2(clamp(mu * 0.5 + 0.5, 0.0, 1.0), sqrt(clamp(h / (RT - RG), 0.0, 1.0)));
}
`;

const QUAD_VS = /* glsl */`
out vec2 vUV;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vUV = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const TRANS_FS = /* glsl */`
${ATMOS_GLSL}
in vec2 vUV;
out vec4 o;
void main() {
  float mu = vUV.x * 2.0 - 1.0;
  float h = vUV.y * vUV.y * (RT - RG);
  float r = RG + h;
  if (hitsGround(r, mu)) { o = vec4(0.0); return; }
  float L = raySphere(r, mu, RT);
  const int N = 40;
  float ds = L / float(N);
  vec3 od = vec3(0.0);
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) * ds;
    float ri = sqrt(r * r + t * t + 2.0 * r * mu * t);
    vec3 sR; float sM; vec3 ext;
    mediumAt(ri - RG, sR, sM, ext);
    od += ext * ds;
  }
  o = vec4(exp(-od), 1.0);
}`;

// Sky-view LUT: x = azimuth relative to the light (0 = towards it), y = latitude
const SKY_FS = /* glsl */`
${ATMOS_GLSL}
uniform sampler2D uTrans;
uniform vec3 uLightDir;
uniform float uCamAlt;
in vec2 vUV;
out vec4 o;
vec3 transmittance(float h, float mu) { return texture(uTrans, transUV(h, mu)).rgb; }
void main() {
  float az = vUV.x * 3.14159265;
  float v = vUV.y * 2.0 - 1.0;
  float lat = sign(v) * v * v * 1.5707963;
  float r = RG + max(uCamAlt, 1.0);
  float horizon = -acos(clamp(RG / r, -1.0, 1.0));
  // remap so the horizon sits at v = 0
  float elev = lat + (lat < 0.0 ? horizon * (1.0 + lat / 1.5707963) : horizon * (1.0 - lat / 1.5707963));
  float ce = cos(elev);
  // light azimuth is +x in this local frame
  float le = asin(clamp(uLightDir.y, -1.0, 1.0));
  vec3 L = vec3(cos(le), sin(le), 0.0);
  vec3 dir = vec3(ce * cos(az), sin(elev), ce * sin(az));
  float mu = dir.y;
  float tMax = hitsGround(r, mu) ? -r * mu - sqrt(max(r * r * (mu * mu - 1.0) + RG * RG, 0.0)) : raySphere(r, mu, RT);
  tMax = min(tMax, 400e3);
  float cosT = dot(dir, L);
  float pR = rayleighPhase(cosT), pM = miePhase(cosT);
  const int N = 30;
  vec3 lum = vec3(0.0), T = vec3(1.0);
  float tPrev = 0.0;
  for (int i = 0; i < N; i++) {
    float f = (float(i) + 0.3) / float(N);
    float t = tMax * f * f;
    float dt = t - tPrev; tPrev = t;
    vec3 p = vec3(0.0, r, 0.0) + dir * t;
    float pr = length(p);
    float h = pr - RG;
    vec3 sR; float sM; vec3 ext;
    mediumAt(h, sR, sM, ext);
    float muL = dot(p / pr, L);
    vec3 Tl = transmittance(h, muL);
    // single scattering + a crude isotropic multiple-scattering term
    vec3 S = Tl * (sR * pR + sM * pM) + (sR + sM) * 0.06 * (0.2 + 0.8 * max(muL + 0.1, 0.0)) * vec3(0.7, 0.8, 1.0);
    vec3 Ts = exp(-ext * dt);
    lum += T * (S - S * Ts) / max(ext, vec3(1e-9));
    T *= Ts;
  }
  o = vec4(lum * uAtmo.w, 1.0);
}`;

export class Atmosphere {
  constructor(gl) {
    this.gl = gl;
    this.half = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.trans = this._target(256, 64);
    this.sky = this._target(192, 108);
    this.pTrans = new Program(gl, QUAD_VS, TRANS_FS, {}, 'atmoTrans');
    this.pSky = new Program(gl, QUAD_VS, SKY_FS, {}, 'atmoSky');
    this.vao = gl.createVertexArray();
    this.lastKey = '';
  }

  _target(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.half ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, this.half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  setAtmoUniforms(p, a) {
    p.set('uAtmo', [a.haze, a.dust, a.groundAlt, a.intensity]);
    p.set('uDustTint', a.dustTint);
  }

  update(a) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    const key = `${a.haze.toFixed(3)}|${a.dust.toFixed(3)}|${Math.round(a.groundAlt / 50)}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.trans.fbo);
      gl.viewport(0, 0, this.trans.w, this.trans.h);
      this.pTrans.use();
      this.setAtmoUniforms(this.pTrans, a);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sky.fbo);
    gl.viewport(0, 0, this.sky.w, this.sky.h);
    this.pSky.use();
    this.setAtmoUniforms(this.pSky, a);
    this.pSky.tex('uTrans', this.trans.tex);
    this.pSky.set('uLightDir', a.lightDir);
    this.pSky.set('uCamAlt', a.camAlt);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST);
  }
}

// CPU transmittance from altitude h (m) along direction with vertical cosine mu
export function cpuTransmittance(h, mu, haze, dust, groundAlt, dustTint) {
  const r = R_GROUND + Math.max(h, 1);
  const disc = r * r * (mu * mu - 1) + R_GROUND * R_GROUND;
  if (mu < 0 && disc >= 0) return [0, 0, 0];
  const d = r * r * (mu * mu - 1) + R_TOP * R_TOP;
  const L = -r * mu + Math.sqrt(Math.max(d, 0));
  const N = 24;
  const ds = L / N;
  const od = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) * ds;
    const hi = Math.sqrt(r * r + t * t + 2 * r * mu * t) - R_GROUND;
    const dR = Math.exp(-hi / H_R), dM = Math.exp(-hi / H_M) * haze;
    const dD = Math.exp(-Math.max(hi - groundAlt, 0) / 900) * dust;
    const dO = Math.max(0, 1 - Math.abs(hi - 25000) / 15000);
    for (let c = 0; c < 3; c++) {
      od[c] += (BETA_R[c] * dR + (MIE_S + MIE_A) * dM + BETA_OZONE[c] * dO + dD * (2e-4 + 1.6e-4 * dustTint[c])) * ds;
    }
  }
  return od.map((x) => Math.exp(-x));
}
