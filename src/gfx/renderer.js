// Scene renderer: physically based atmosphere LUTs, cascaded shadows, HDR
// scene (terrain, foliage, animals, buildings, vehicle, sky with clouds,
// roads, rivers, dust) and the post-processing stack.

import { Program, makeBuffer, makeVAO, LOC } from './gl.js';
import * as S from './shaders.js';
import { Atmosphere } from './atmosphere.js';
import { PostFX } from './postfx.js';
import { createNoiseTexture, createGroundTextures } from './textures.js';
import { createFoliageAtlas } from './foliage.js';
import { m4, frustumPlanes, aabbInFrustum } from '../core/math.js';

export class GpuMesh {
  constructor(gl, built) {
    this.gl = gl;
    this.count = built.count;
    const uv = built.uv && built.uv.length ? built.uv : new Float32Array(built.count * 2).fill(-1);
    this.bufs = {
      pos: makeBuffer(gl, built.pos), nrm: makeBuffer(gl, built.nrm),
      col: makeBuffer(gl, built.col), limb: makeBuffer(gl, built.limb), uv: makeBuffer(gl, uv),
    };
    this.vao = makeVAO(gl, this.attribs());
    let maxY = 0;
    for (let i = 1; i < built.pos.length; i += 3) maxY = Math.max(maxY, built.pos[i]);
    this.height = maxY;
    this.hasCards = false;
    for (let i = 0; i < uv.length; i += 2) if (uv[i] >= 0) { this.hasCards = true; break; }
  }
  attribs() {
    return [
      { loc: LOC.POS, buffer: this.bufs.pos, size: 3 },
      { loc: LOC.NRM, buffer: this.bufs.nrm, size: 3 },
      { loc: LOC.COL, buffer: this.bufs.col, size: 3 },
      { loc: LOC.LIMB, buffer: this.bufs.limb, size: 4 },
      { loc: LOC.DETAIL, buffer: this.bufs.uv, size: 2 },
    ];
  }
}

// A mesh drawn many times with per-instance data.
// stride 8: (x,y,z,yaw, scale,r,g,b); stride 12 adds (phase, amp, pitch, bank)
export class InstancedBatch {
  constructor(gl, mesh, stride = 8, opts = {}) {
    this.gl = gl; this.mesh = mesh; this.stride = stride;
    this.kind = opts.kind ?? 0; this.sway = opts.sway ?? 0; this.spec = opts.spec ?? 0;
    this.castShadow = opts.castShadow ?? true;
    this.wall = opts.wall ? 1 : 0;
    this.buf = gl.createBuffer();
    this.capacity = 0; this.count = 0;
    const B = stride * 4;
    const attrs = mesh.attribs().concat([
      { loc: LOC.I0, buffer: this.buf, size: 4, stride: B, offset: 0, divisor: 1 },
      { loc: LOC.I1, buffer: this.buf, size: 4, stride: B, offset: 16, divisor: 1 },
    ]);
    if (stride >= 12) attrs.push({ loc: LOC.I2, buffer: this.buf, size: 4, stride: B, offset: 32, divisor: 1 });
    this.vao = makeVAO(gl, attrs);
  }
  update(data, count = data.length / this.stride) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    if (data.byteLength > this.capacity) {
      this.capacity = Math.max(data.byteLength, this.capacity * 1.5);
      gl.bufferData(gl.ARRAY_BUFFER, this.capacity, gl.DYNAMIC_DRAW);
    }
    if (count > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * this.stride);
    this.count = count;
  }
}

const SHADOW_SIZE = 2048;
const NEAR = 0.3;

const QUALITY = {
  low: { cascades: 0, msaa: 0, bloom: true, rays: false, cloudSteps: 10, scale: 0.8 },
  medium: { cascades: 1, msaa: 2, bloom: true, rays: true, cloudSteps: 14, scale: 1 },
  high: { cascades: 2, msaa: 4, bloom: true, rays: true, cloudSteps: 24, scale: 1 },
};

export class Renderer {
  constructor(gl, opts = {}) {
    this.gl = gl;
    this.quality = opts.quality ?? 'high';
    const Q = this.Q = QUALITY[this.quality] || QUALITY.high;
    this.shadowCascades = Q.cascades;
    const sh = this.shadowCascades > 0;
    const D = { SHADOWS: sh };
    this.p = {
      terrain: new Program(gl, S.TERRAIN_VS, S.TERRAIN_FS, D, 'terrain'),
      inst: new Program(gl, S.INST_VS, S.INST_FS, D, 'inst'),
      obj: new Program(gl, S.OBJ_VS, S.OBJ_FS, D, 'obj'),
      sky: new Program(gl, S.SKY_VS, S.SKY_FS, {}, 'sky'),
      water: new Program(gl, S.WATER_VS, S.WATER_FS, D, 'water'),
      road: new Program(gl, S.ROAD_VS, S.ROAD_FS, D, 'road'),
      part: new Program(gl, S.PART_VS, S.PART_FS, {}, 'particles'),
    };
    if (sh) {
      this.d = {
        terrain: new Program(gl, S.TERRAIN_VS, S.TERRAIN_FS, { DEPTH: true }, 'terrainDepth'),
        inst: new Program(gl, S.INST_VS, S.INST_FS, { DEPTH: true }, 'instDepth'),
        obj: new Program(gl, S.OBJ_VS, S.OBJ_FS, { DEPTH: true }, 'objDepth'),
      };
      this.shadow = [];
      for (let i = 0; i < this.shadowCascades; i++) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
        gl.drawBuffers([gl.NONE]);
        gl.readBuffer(gl.NONE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.shadow.push({ tex, fbo, mat: m4.create(), radius: i === 0 ? 60 : 650 });
      }
    }
    this.atmo = new Atmosphere(gl);
    this.post = new PostFX(gl, { msaa: Q.msaa, bloom: Q.bloom, rays: Q.rays });
    this.noise = createNoiseTexture(gl);
    this.foliage = createFoliageAtlas(gl);
    this.ground = createGroundTextures(gl);
    // particle quad
    this.quadBuf = makeBuffer(gl, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
    this.partBuf = gl.createBuffer();
    this.partCap = 0;
    this.partVao = makeVAO(gl, [
      { loc: 0, buffer: this.quadBuf, size: 2 },
      { loc: LOC.I0, buffer: this.partBuf, size: 4, stride: 32, offset: 0, divisor: 1 },
      { loc: LOC.I1, buffer: this.partBuf, size: 4, stride: 32, offset: 16, divisor: 1 },
    ]);
    this.emptyVao = gl.createVertexArray();
    this.viewProj = m4.create();
    this.view = m4.create();
    this.proj = m4.create();
    this.invViewProj = m4.create();
    this.planes = new Float32Array(24);
    this.stats = { draws: 0 };
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
  }

  setCommon(p, f) {
    const e = f.env;
    p.set('uViewProj', this.viewProj);
    p.set('uCamPos', f.camPos);
    p.set('uSunDir', e.lightDir);
    p.set('uSunColor', e.lightColor);
    p.set('uTime', f.time);
    p.set('uWind', [e.wind[0], e.wind[1], e.gust, 0]);
    p.set('uHeadPos', f.head.pos);
    p.set('uHeadDir', f.head.dir);
    p.set('uHeadOn', f.head.on);
    p.set('uCloud', e.cloud);
    p.set('uCloudOff', e.cloudOffset);
    p.set('uMist', [e.mist[0], e.mist[1], e.night, this.horizon]);
    p.set('uLightAz', [this.lightAz, 0, 0, 0]);
    p.set('uAtmo', [e.atmo.haze, e.atmo.dust, e.atmo.groundAlt, e.atmo.intensity]);
    p.set('uDustTint', e.atmo.dustTint);
    p.tex('uSkyLUT', this.atmo.sky.tex);
    p.tex('uNoise', this.noise);
    p.tex('uFoliage', this.foliage);
    p.tex('uGround', this.ground, this.gl.TEXTURE_2D_ARRAY);
    if (this.shadowCascades > 0) {
      p.set('uShadowMat0', this.shadow[0].mat);
      if (this.shadow[1]) p.set('uShadowMat1', this.shadow[1].mat);
      p.set('uShadowInfo', [this.shadowActive ? this.shadowCascades : 0, 1 / SHADOW_SIZE, 1 / SHADOW_SIZE, 0]);
      p.tex('uShadow0', this.shadow[0].tex);
      p.tex('uShadow1', (this.shadow[1] || this.shadow[0]).tex);
    }
  }

  render(f) {
    const gl = this.gl;
    const e = f.env;
    const width = Math.max(1, Math.round(f.width * this.Q.scale)), height = Math.max(1, Math.round(f.height * this.Q.scale));
    this.stats.draws = 0;
    m4.perspective(this.proj, f.fov, width / height, NEAR, f.far);
    m4.lookAt(this.view, [0, 0, 0], f.camDir, [0, 1, 0]);
    m4.mul(this.viewProj, this.proj, this.view);
    m4.invert(this.invViewProj, this.viewProj);
    frustumPlanes(this.planes, this.viewProj);
    const camAlt = Math.max(1, f.camPos[1]);
    this.horizon = -Math.acos(6360e3 / (6360e3 + camAlt));
    this.lightAz = Math.atan2(e.lightDir[2], e.lightDir[0]);

    // ---------- atmosphere LUTs
    this.atmo.update({ ...e.atmo, lightDir: e.lightDir, camAlt });

    // ---------- shadows
    this.shadowActive = this.shadowCascades > 0 && e.lightDir[1] > 0.04 && f.shadows !== false;
    if (this.shadowActive) {
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(2.0, 4.0);
      for (const sc of this.shadow) this._renderShadow(sc, f);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    // ---------- HDR scene
    this.post.resize(width, height);
    this.post.begin();
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const pt = this.p.terrain.use();
    this.setCommon(pt, f);
    for (const c of f.chunks) {
      if (!c.mesh) continue;
      const ox = c.cx * f.chunkSize - f.camPos[0], oz = c.cz * f.chunkSize - f.camPos[2];
      if (!aabbInFrustum(this.planes, ox, c.minY - f.camPos[1], oz, ox + f.chunkSize, c.maxY - f.camPos[1], oz + f.chunkSize)) continue;
      pt.set('uOrigin', [ox, -f.camPos[1], oz]);
      gl.bindVertexArray(c.mesh.vao);
      gl.drawElements(gl.TRIANGLES, c.mesh.count, c.mesh.type, 0);
      this.stats.draws++;
    }

    gl.disable(gl.CULL_FACE);
    const msaa = this.post.samples > 1;
    const pi = this.p.inst.use();
    this.setCommon(pi, f);
    for (const b of f.batches) {
      if (!b.count) continue;
      pi.set('uKind', b.kind); pi.set('uSway', b.sway); pi.set('uHeight', b.mesh.height || 1); pi.set('uSpec', b.spec);
      pi.set('uWall', b.wall);
      if (msaa && b.mesh.hasCards) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.bindVertexArray(b.vao);
      if (b.stride < 12) gl.vertexAttrib4f(LOC.I2, 0, 0, 0, 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, b.mesh.count, b.count);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      this.stats.draws++;
    }
    gl.enable(gl.CULL_FACE);

    const po = this.p.obj.use();
    this.setCommon(po, f);
    for (const o of f.objects) {
      po.set('uModel', o.model); po.set('uSpec', o.spec ?? 0.3);
      po.set('uDirt', [o.dirt ?? 0, 0, 0]); po.set('uDirtColor', o.dirtColor ?? [0.6, 0.5, 0.4]);
      po.set('uEmissive', o.emissive ?? 0);
      gl.bindVertexArray(o.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, o.mesh.count);
      this.stats.draws++;
    }

    // sky at the far plane
    gl.depthFunc(gl.LEQUAL);
    const ps = this.p.sky.use();
    this.setCommon(ps, f);
    ps.set('uInvViewProj', this.invViewProj);
    ps.set('uStars', e.stars);
    ps.set('uSunDisk', e.sunDisk);
    ps.set('uMoonDir', e.moonDir);
    ps.set('uCloudSteps', this.Q.cloudSteps);
    ps.set('uCirrus', e.cirrus ?? 0);
    gl.bindVertexArray(this.emptyVao);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);

    // ---------- transparent: needs the opaque depth for soft edges
    this.post.resolveDepth();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (f.road) {
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-2.0, -8.0);
      const pr = this.p.road.use();
      this.setCommon(pr, f);
      pr.set('uPisteColor', f.road.pisteColor);
      pr.set('uOrigin', [f.road.origin[0] - f.camPos[0], f.road.origin[1] - f.camPos[1], f.road.origin[2] - f.camPos[2]]);
      gl.bindVertexArray(f.road.vao);
      gl.drawElements(gl.TRIANGLES, f.road.count, gl.UNSIGNED_INT, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    const viewport = [width, height], nearFar = [NEAR, f.far];
    if (f.water) {
      const pw = this.p.water.use();
      this.setCommon(pw, f);
      pw.tex('uDepth', this.post.depth);
      pw.set('uViewport', viewport); pw.set('uNearFar', nearFar);
      pw.set('uOrigin', [f.water.origin[0] - f.camPos[0], f.water.origin[1] - f.camPos[1], f.water.origin[2] - f.camPos[2]]);
      gl.bindVertexArray(f.water.vao);
      gl.disable(gl.CULL_FACE);
      gl.drawElements(gl.TRIANGLES, f.water.count, gl.UNSIGNED_INT, 0);
      gl.enable(gl.CULL_FACE);
    }
    if (f.particles && f.particles.count > 0) {
      const pp = this.p.part.use();
      this.setCommon(pp, f);
      pp.tex('uDepth', this.post.depth);
      pp.set('uViewport', viewport); pp.set('uNearFar', nearFar);
      pp.set('uRight', [this.view[0], this.view[4], this.view[8]]);
      pp.set('uUp', [this.view[1], this.view[5], this.view[9]]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
      const data = f.particles.data;
      if (data.byteLength > this.partCap) { this.partCap = data.byteLength; gl.bufferData(gl.ARRAY_BUFFER, this.partCap, gl.DYNAMIC_DRAW); }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, f.particles.count * 8);
      gl.bindVertexArray(this.partVao);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, f.particles.count);
      gl.depthMask(true);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);

    // ---------- post
    let sunUV = null;
    const ld = e.lightDir;
    const clip = [0, 0, 0, 0];
    const m = this.viewProj;
    const P = [ld[0] * 1000, ld[1] * 1000, ld[2] * 1000];
    for (let r = 0; r < 4; r++) clip[r] = m[r] * P[0] + m[4 + r] * P[1] + m[8 + r] * P[2] + m[12 + r];
    if (clip[3] > 0 && !e.isMoon) {
      const u = (clip[0] / clip[3]) * 0.5 + 0.5, v = (clip[1] / clip[3]) * 0.5 + 0.5;
      if (u > -0.4 && u < 1.4 && v > -0.4 && v < 1.4) sunUV = [u, v];
    }
    this.post.finish({
      dt: f.dt, time: f.time, near: NEAR, far: f.far, invViewProj: this.invViewProj,
      sunUV, rayStrength: 0.35 + e.atmo.haze * 0.05 + e.storm * 0.6, rayColor: [1, 1, 1],
      heat: e.heat, night: e.night, warmth: e.warmth, exposureComp: f.exposureComp ?? 0,
      skyLUT: this.atmo.sky.tex, noise: this.noise, lightAz: this.lightAz, horizon: this.horizon, sunDir: ld,
      canvasW: f.width, canvasH: f.height, exposureRange: [0.04, 150],
    });
  }

  _renderShadow(sc, f) {
    const gl = this.gl;
    const sun = f.env.lightDir;
    const r = sc.radius;
    const fc = [f.focus[0] - f.camPos[0], f.focus[1] - f.camPos[1], f.focus[2] - f.camPos[2]];
    const ahead = r * 0.5;
    const cx = fc[0] + f.camDir[0] * ahead, cz = fc[2] + f.camDir[2] * ahead, cy = fc[1];
    const view = m4.create();
    const eye = [cx + sun[0] * 2500, cy + sun[1] * 2500, cz + sun[2] * 2500];
    m4.lookAt(view, eye, [cx, cy, cz], Math.abs(sun[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]);
    const texel = (2 * r) / SHADOW_SIZE;
    const ox = view[12] - (f.camPos[0] * view[0] + f.camPos[1] * view[4] + f.camPos[2] * view[8]);
    const oy = view[13] - (f.camPos[0] * view[1] + f.camPos[1] * view[5] + f.camPos[2] * view[9]);
    view[12] -= ox - Math.round(ox / texel) * texel;
    view[13] -= oy - Math.round(oy / texel) * texel;
    const proj = m4.create();
    m4.ortho(proj, -r, r, -r, r, 100, 5000);
    m4.mul(sc.mat, proj, view);
    const planes = frustumPlanes(new Float32Array(24), sc.mat);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sc.fbo);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);
    const pt = this.d.terrain.use();
    pt.set('uLightMat', sc.mat);
    for (const c of f.chunks) {
      if (!c.mesh) continue;
      const ox2 = c.cx * f.chunkSize - f.camPos[0], oz2 = c.cz * f.chunkSize - f.camPos[2];
      if (!aabbInFrustum(planes, ox2, c.minY - f.camPos[1], oz2, ox2 + f.chunkSize, c.maxY - f.camPos[1], oz2 + f.chunkSize)) continue;
      pt.set('uOrigin', [ox2, -f.camPos[1], oz2]);
      gl.bindVertexArray(c.mesh.vao);
      gl.drawElements(gl.TRIANGLES, c.mesh.count, c.mesh.type, 0);
    }
    const pi = this.d.inst.use();
    pi.set('uLightMat', sc.mat);
    pi.set('uCamPos', f.camPos);
    pi.set('uTime', f.time);
    pi.set('uWind', [f.env.wind[0], f.env.wind[1], f.env.gust, 0]);
    pi.tex('uFoliage', this.foliage);
    for (const b of f.batches) {
      if (!b.count || !b.castShadow) continue;
      if (sc.radius > 100 && b.kind !== 0) continue;
      pi.set('uKind', b.kind); pi.set('uSway', b.sway); pi.set('uHeight', b.mesh.height || 1);
      gl.bindVertexArray(b.vao);
      if (b.stride < 12) gl.vertexAttrib4f(LOC.I2, 0, 0, 0, 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, b.mesh.count, b.count);
    }
    const po = this.d.obj.use();
    po.set('uLightMat', sc.mat);
    for (const o of f.objects) {
      po.set('uModel', o.model);
      gl.bindVertexArray(o.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, o.mesh.count);
    }
    gl.enable(gl.CULL_FACE);
  }
}
