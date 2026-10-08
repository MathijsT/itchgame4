// HDR render target + post-processing: MSAA resolve, physically based bloom,
// god rays, eye adaptation, desert heat shimmer and mirage, filmic tone
// mapping with time-of-day grading, vignette and grain.

import { Program } from './gl.js';
import { ATMOS_GLSL } from './atmosphere.js';

const VS = /* glsl */`
out vec2 vUV;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vUV = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// 13-tap downsample (Jimenez 2014) with Karis average on the first pass
const DOWN_FS = /* glsl */`
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform int uFirst;
in vec2 vUV;
out vec4 o;
vec3 k(vec3 c) { return c / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)) * 0.25); }
void main() {
  vec2 t = uTexel;
  vec3 a = texture(uSrc, vUV + t * vec2(-2, -2)).rgb, b = texture(uSrc, vUV + t * vec2(0, -2)).rgb, c = texture(uSrc, vUV + t * vec2(2, -2)).rgb;
  vec3 d = texture(uSrc, vUV + t * vec2(-2, 0)).rgb, e = texture(uSrc, vUV).rgb, f = texture(uSrc, vUV + t * vec2(2, 0)).rgb;
  vec3 g = texture(uSrc, vUV + t * vec2(-2, 2)).rgb, h = texture(uSrc, vUV + t * vec2(0, 2)).rgb, i = texture(uSrc, vUV + t * vec2(2, 2)).rgb;
  vec3 j = texture(uSrc, vUV + t * vec2(-1, -1)).rgb, kk = texture(uSrc, vUV + t * vec2(1, -1)).rgb;
  vec3 l = texture(uSrc, vUV + t * vec2(-1, 1)).rgb, m = texture(uSrc, vUV + t * vec2(1, 1)).rgb;
  vec3 r;
  if (uFirst == 1) {
    r = (k(j) + k(kk) + k(l) + k(m)) * 0.125 + (k(a) + k(b) + k(d) + k(e)) * 0.03125 + (k(b) + k(c) + k(e) + k(f)) * 0.03125
      + (k(d) + k(e) + k(g) + k(h)) * 0.03125 + (k(e) + k(f) + k(h) + k(i)) * 0.03125;
  } else {
    r = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + kk + l + m) * 0.125;
  }
  o = vec4(max(r, vec3(0.0)), 1.0);
}`;

const UP_FS = /* glsl */`
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
in vec2 vUV;
out vec4 o;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = texture(uSrc, vUV + vec2(-t.x, -t.y)).rgb + texture(uSrc, vUV + vec2(t.x, -t.y)).rgb
         + texture(uSrc, vUV + vec2(-t.x, t.y)).rgb + texture(uSrc, vUV + vec2(t.x, t.y)).rgb;
  s += (texture(uSrc, vUV + vec2(0, -t.y)).rgb + texture(uSrc, vUV + vec2(0, t.y)).rgb
      + texture(uSrc, vUV + vec2(-t.x, 0)).rgb + texture(uSrc, vUV + vec2(t.x, 0)).rgb) * 2.0;
  s += texture(uSrc, vUV).rgb * 4.0;
  o = vec4(s / 16.0, 1.0);
}`;

// Radial light shafts from the sun across bright, unoccluded sky
const RAYS_FS = /* glsl */`
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform vec2 uSunUV;
uniform float uStrength;
in vec2 vUV;
out vec4 o;
void main() {
  const int N = 40;
  vec2 d = (uSunUV - vUV) / float(N) * 0.9;
  vec2 uv = vUV;
  float decay = 1.0, w = 0.0;
  vec3 acc = vec3(0.0);
  float jitter = fract(sin(dot(vUV, vec2(12.9898, 78.233))) * 43758.5453);
  uv += d * jitter;
  for (int i = 0; i < N; i++) {
    float sky = step(0.99999, texture(uDepth, uv).r);
    vec3 c = texture(uColor, uv).rgb * sky;
    acc += min(c, vec3(60.0)) * decay;
    w += decay;
    decay *= 0.965;
    uv += d;
  }
  float falloff = 1.0 - smoothstep(0.0, 0.9, length((vUV - uSunUV) * vec2(1.6, 1.0)));
  o = vec4(acc / w * uStrength * falloff, 1.0);
}`;

// Eye adaptation: log-average luminance of a small mip, smoothed over time
const LUM_FS = /* glsl */`
uniform sampler2D uSrc;
uniform sampler2D uPrev;
uniform vec2 uSize;
uniform float uDt;
uniform float uInit;
in vec2 vUV;
out vec4 o;
void main() {
  float s = 0.0, w = 0.0;
  for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++) {
    vec2 uv = (vec2(x, y) + 0.5) / 16.0;
    // centre-weighted metering
    float cw = 1.0 - 0.6 * length(uv - 0.5);
    // clamp very bright samples (sun, sky, lamps) so they don't darken the scene
    float l = min(dot(texture(uSrc, uv).rgb, vec3(0.2126, 0.7152, 0.0722)), 2.5);
    s += log(max(l, 1e-5)) * cw; w += cw;
  }
  float target = s / w;
  float prev = texture(uPrev, vec2(0.5)).r;
  float k = uInit > 0.5 ? 1.0 : 1.0 - exp(-uDt * (target > prev ? 2.2 : 1.1));
  o = vec4(mix(prev, target, k), 0.0, 0.0, 1.0);
}`;

const COMPOSITE_FS = /* glsl */`
${ATMOS_GLSL}
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform sampler2D uBloom;
uniform sampler2D uRays;
uniform sampler2D uLum;
uniform sampler2D uNoise;
uniform sampler2D uSkyLUT;
uniform mat4 uInvViewProj;
uniform vec2 uNearFar;
uniform float uTime;
uniform vec4 uGrade;      // x heat shimmer, y night factor, z warmth (-1..1), w exposure compensation
uniform vec4 uFx;         // x bloom strength, y rays on, z vignette, w grain
uniform vec3 uRayColor;
uniform vec3 uSunDir;
uniform vec4 uSky;        // x light azimuth, y horizon angle
uniform vec2 uExposureRange;
in vec2 vUV;
out vec4 o;
const float PI = 3.14159265;
float linDepth(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x)); }
vec2 skyUV(vec3 dir) {
  float az = atan(dir.z, dir.x) - uSky.x;
  az = abs(mod(az + PI, 2.0 * PI) - PI);
  float elev = asin(clamp(dir.y, -1.0, 1.0));
  float h0 = uSky.y;
  float lat = elev >= h0 ? (elev - h0) / (1.0 - h0 / 1.5707963) : (elev - h0) / (1.0 + h0 / 1.5707963);
  float v = sign(lat) * sqrt(min(abs(lat) / 1.5707963, 1.0));
  return vec2(az / PI, v * 0.5 + 0.5);
}
// ACES fitted (Hill)
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c) {
  const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c = ACESIn * c;
  c = RRTAndODTFit(c);
  return clamp(ACESOut * c, 0.0, 1.0);
}
void main() {
  vec2 uv = vUV;
  float depth = texture(uDepth, uv).r;
  float dist = linDepth(depth);
  // view ray
  vec4 w = uInvViewProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(w.xyz / w.w);
  // heat shimmer: refraction through turbulent hot air above the ground
  float heat = uGrade.x;
  if (heat > 0.0) {
    float nearGround = smoothstep(0.06, -0.01, dir.y);
    float far = smoothstep(30.0, 400.0, dist) * (depth < 0.99999 ? 1.0 : 0.6);
    vec2 n = texture(uNoise, uv * vec2(6.0, 18.0) + vec2(0.0, -uTime * 0.35)).rg - 0.5;
    uv += n * 0.0035 * heat * nearGround * far;
  }
  vec3 col = texture(uColor, uv).rgb;
  depth = texture(uDepth, uv).r;
  dist = linDepth(depth);
  // inferior mirage: grazing views of distant, sun-baked flats show the sky
  if (heat > 0.0 && depth < 0.99999 && dir.y < 0.0 && dir.y > -0.035) {
    float graze = smoothstep(-0.035, -0.004, dir.y) * smoothstep(250.0, 1500.0, dist);
    float wobble = texture(uNoise, vec2(uv.x * 8.0, uTime * 0.2)).r;
    vec3 mdir = normalize(vec3(dir.x, -dir.y * 0.6 + 0.004, dir.z));
    vec3 skyc = texture(uSkyLUT, skyUV(mdir)).rgb;
    col = mix(col, skyc, graze * heat * (0.45 + 0.35 * wobble));
  }
  col += texture(uBloom, vUV).rgb * uFx.x;
  if (uFx.y > 0.0) col += texture(uRays, vUV).rgb * uRayColor;
  // exposure from adapted luminance
  float avgLog = texture(uLum, vec2(0.5)).r;
  float exposure = clamp(0.17 / exp(avgLog), uExposureRange.x, uExposureRange.y) * exp2(uGrade.w);
  col *= exposure;
  // night vision: rod-dominated, desaturated and blue-shifted
  float night = uGrade.y;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, l * vec3(0.55, 0.75, 1.15), night * 0.75);
  // white balance / warmth
  col *= vec3(1.0 + 0.06 * uGrade.z, 1.0, 1.0 - 0.08 * uGrade.z);
  vec3 m = aces(col);
  // gentle filmic contrast and saturation
  float lm = dot(m, vec3(0.2126, 0.7152, 0.0722));
  m = mix(vec3(lm), m, 1.08);
  m = clamp(m, 0.0, 1.0);
  // vignette
  vec2 q = vUV - 0.5;
  m *= 1.0 - uFx.z * dot(q, q) * 1.6;
  m = pow(m, vec3(1.0 / 2.2));
  // grain + dither against banding
  float g = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
  m += (g - 0.5) * (uFx.w + 1.0 / 255.0);
  o = vec4(m, 1.0);
}`;

function tex2D(gl, w, h, fmt, type, filter = gl.LINEAR) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, fmt === gl.DEPTH_COMPONENT24 ? gl.DEPTH_COMPONENT : gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export class PostFX {
  constructor(gl, opts = {}) {
    this.gl = gl;
    this.float = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    this.fmt = this.float ? gl.RGBA16F : gl.RGBA8;
    this.type = this.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    const maxS = gl.getParameter(gl.MAX_SAMPLES) || 0;
    this.samples = Math.min(opts.msaa ?? 4, maxS);
    this.bloomOn = opts.bloom !== false;
    this.raysOn = opts.rays !== false;
    this.p = {
      down: new Program(gl, VS, DOWN_FS, {}, 'bloomDown'),
      up: new Program(gl, VS, UP_FS, {}, 'bloomUp'),
      rays: new Program(gl, VS, RAYS_FS, {}, 'rays'),
      lum: new Program(gl, VS, LUM_FS, {}, 'lum'),
      comp: new Program(gl, VS, COMPOSITE_FS, {}, 'composite'),
    };
    this.vao = gl.createVertexArray();
    this.w = 0; this.h = 0;
    // 1x1 adapted luminance ping-pong
    this.lum = [0, 1].map(() => {
      const t = tex2D(gl, 1, 1, this.fmt, this.type, gl.NEAREST);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { tex: t, fbo: f };
    });
    this.lumIdx = 0;
    this.lumInit = true;
    this.lumSmall = null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(w, h) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.w = w; this.h = h;
    // multisampled scene buffer
    if (this.msFbo) { gl.deleteFramebuffer(this.msFbo); gl.deleteRenderbuffer(this.msColor); gl.deleteRenderbuffer(this.msDepth); }
    this.msFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);
    this.msColor = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.msColor);
    if (this.samples > 1) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, this.fmt, w, h);
    else gl.renderbufferStorage(gl.RENDERBUFFER, this.fmt, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msColor);
    this.msDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.msDepth);
    if (this.samples > 1) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, w, h);
    else gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msDepth);
    // resolved colour + depth textures
    if (this.rFbo) { gl.deleteFramebuffer(this.rFbo); gl.deleteTexture(this.color); gl.deleteTexture(this.depth); gl.deleteFramebuffer(this.dFbo); }
    this.color = tex2D(gl, w, h, this.fmt, this.type);
    this.depth = tex2D(gl, w, h, gl.DEPTH_COMPONENT24, gl.UNSIGNED_INT, gl.NEAREST);
    this.rFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.color, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depth, 0);
    this.dFbo = gl.createFramebuffer(); // depth-only resolve target used mid-frame
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.dFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depth, 0);
    // bloom mip chain
    for (const m of this.mips || []) { gl.deleteTexture(m.tex); gl.deleteFramebuffer(m.fbo); }
    this.mips = [];
    let mw = w, mh = h;
    for (let i = 0; i < 6; i++) {
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
      const t = tex2D(gl, mw, mh, this.fmt, this.type);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      this.mips.push({ tex: t, fbo: f, w: mw, h: mh });
    }
    // god rays at half resolution
    if (this.rays) { gl.deleteTexture(this.rays.tex); gl.deleteFramebuffer(this.rays.fbo); }
    const rw = Math.max(1, w >> 1), rh = Math.max(1, h >> 1);
    const rt = tex2D(gl, rw, rh, this.fmt, this.type);
    const rf = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, rf);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt, 0);
    this.rays = { tex: rt, fbo: rf, w: rw, h: rh };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  begin() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);
    gl.viewport(0, 0, this.w, this.h);
  }

  // copy the multisampled depth into the sampleable depth texture
  resolveDepth() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.dFbo);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);
  }

  _quad(fbo, w, h) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // f: {dt, time, near, far, invViewProj, sunUV (or null), rayColor, heat, night, warmth, skyLUT, noise, lightAz, horizon, canvasW, canvasH, exposureRange}
  finish(f) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.rFbo);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);
    // bloom down chain (also feeds metering)
    const pd = this.p.down.use();
    let src = this.color, sw = this.w, sh = this.h;
    for (let i = 0; i < this.mips.length; i++) {
      const m = this.mips[i];
      pd.tex('uSrc', src);
      pd.set('uTexel', [1 / sw, 1 / sh]);
      pd.set('uFirst', i === 0 ? 1 : 0);
      this._quad(m.fbo, m.w, m.h);
      src = m.tex; sw = m.w; sh = m.h;
    }
    // eye adaptation from mip 4
    const pl = this.p.lum.use();
    const prev = this.lum[this.lumIdx], next = this.lum[1 - this.lumIdx];
    pl.tex('uSrc', this.mips[Math.min(4, this.mips.length - 1)].tex);
    pl.tex('uPrev', prev.tex);
    pl.set('uDt', f.dt);
    pl.set('uInit', this.lumInit ? 1 : 0);
    this._quad(next.fbo, 1, 1);
    this.lumIdx = 1 - this.lumIdx;
    this.lumInit = false;
    // bloom up chain (additive)
    if (this.bloomOn) {
      const pu = this.p.up.use();
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = this.mips.length - 1; i > 0; i--) {
        const s = this.mips[i], d = this.mips[i - 1];
        pu.tex('uSrc', s.tex);
        pu.set('uTexel', [1 / s.w, 1 / s.h]);
        pu.set('uRadius', 1.0);
        this._quad(d.fbo, d.w, d.h);
      }
      gl.disable(gl.BLEND);
    }
    // god rays
    const raysActive = this.raysOn && f.sunUV;
    if (raysActive) {
      const pr = this.p.rays.use();
      pr.tex('uColor', this.mips[0].tex);
      pr.tex('uDepth', this.depth);
      pr.set('uSunUV', f.sunUV);
      pr.set('uStrength', f.rayStrength);
      this._quad(this.rays.fbo, this.rays.w, this.rays.h);
    }
    // composite to the canvas
    const pc = this.p.comp.use();
    pc.tex('uColor', this.color);
    pc.tex('uDepth', this.depth);
    pc.tex('uBloom', this.mips[0].tex);
    pc.tex('uRays', this.rays.tex);
    pc.tex('uLum', this.lum[this.lumIdx].tex);
    pc.tex('uNoise', f.noise);
    pc.tex('uSkyLUT', f.skyLUT);
    pc.set('uInvViewProj', f.invViewProj);
    pc.set('uNearFar', [f.near, f.far]);
    pc.set('uTime', f.time);
    pc.set('uGrade', [f.heat, f.night, f.warmth, f.exposureComp ?? 0]);
    pc.set('uFx', [this.bloomOn ? 0.05 : 0, raysActive ? 1 : 0, 0.32, 0.018]);
    pc.set('uRayColor', f.rayColor);
    pc.set('uSunDir', f.sunDir);
    pc.set('uSky', [f.lightAz, f.horizon, 0, 0]);
    pc.set('uExposureRange', f.exposureRange);
    this._quad(null, f.canvasW, f.canvasH);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }
}
