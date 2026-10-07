// Scene renderer: cascaded sun shadows, terrain chunks, instanced vegetation,
// animals and buildings, the vehicle, rivers, roads, sky and dust particles.

import { Program, makeBuffer, makeVAO, LOC } from './gl.js';
import * as S from './shaders.js';
import { m4, frustumPlanes, aabbInFrustum } from '../core/math.js';

export class GpuMesh {
  constructor(gl, built) {
    this.gl = gl;
    this.count = built.count;
    this.bufs = {
      pos: makeBuffer(gl, built.pos), nrm: makeBuffer(gl, built.nrm),
      col: makeBuffer(gl, built.col), limb: makeBuffer(gl, built.limb),
    };
    this.vao = makeVAO(gl, this.attribs());
    // bounding height (for sway normalisation)
    let maxY = 0;
    for (let i = 1; i < built.pos.length; i += 3) maxY = Math.max(maxY, built.pos[i]);
    this.height = maxY;
  }
  attribs() {
    return [
      { loc: LOC.POS, buffer: this.bufs.pos, size: 3 },
      { loc: LOC.NRM, buffer: this.bufs.nrm, size: 3 },
      { loc: LOC.COL, buffer: this.bufs.col, size: 3 },
      { loc: LOC.LIMB, buffer: this.bufs.limb, size: 4 },
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

export class Renderer {
  constructor(gl, opts = {}) {
    this.gl = gl;
    this.quality = opts.quality ?? 'high';
    this.shadowCascades = this.quality === 'low' ? 0 : this.quality === 'medium' ? 1 : 2;
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
        this.shadow.push({ tex, fbo, mat: m4.create(), radius: i === 0 ? 70 : 700 });
      }
    }
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
    this.stats = { draws: 0, tris: 0 };
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
  }

  setCommon(p, f) {
    p.set('uViewProj', this.viewProj);
    p.set('uCamPos', f.camPos);
    p.set('uSunDir', f.env.sunDir);
    p.set('uSunColor', f.env.sunColor);
    p.set('uSkyZenith', f.env.skyZenith);
    p.set('uSkyHorizon', f.env.skyHorizon);
    p.set('uGroundAmb', f.env.groundAmb);
    p.set('uMoonColor', f.env.moonColor);
    p.set('uFog', f.env.fog);
    p.set('uDustColor', f.dustColor);
    p.set('uTime', f.time);
    p.set('uWind', [f.env.wind[0], f.env.wind[1], f.env.gust, 0]);
    p.set('uExposure', f.env.exposure);
    p.set('uHeadPos', f.head.pos);
    p.set('uHeadDir', f.head.dir);
    p.set('uHeadOn', f.head.on);
    if (this.shadowCascades > 0) {
      p.set('uShadowMat0', this.shadow[0].mat);
      if (this.shadow[1]) p.set('uShadowMat1', this.shadow[1].mat);
      p.set('uShadowInfo', [this.shadowActive ? this.shadowCascades : 0, 1 / SHADOW_SIZE, 1 / SHADOW_SIZE, 0]);
      p.tex('uShadow0', this.shadow[0].tex);
      p.tex('uShadow1', (this.shadow[1] || this.shadow[0]).tex);
    }
  }

  // f: frame description, see main.js
  render(f) {
    const gl = this.gl;
    const { width, height } = f;
    this.stats.draws = 0;
    // camera-relative matrices
    m4.perspective(this.proj, f.fov, width / height, 0.3, f.far);
    m4.lookAt(this.view, [0, 0, 0], f.camDir, [0, 1, 0]);
    m4.mul(this.viewProj, this.proj, this.view);
    m4.invert(this.invViewProj, this.viewProj);
    frustumPlanes(this.planes, this.viewProj);

    // ---------- shadows
    this.shadowActive = this.shadowCascades > 0 && f.env.sunDir[1] > 0.03 && f.shadows !== false;
    if (this.shadowActive) {
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(2.0, 4.0);
      for (const sc of this.shadow) this._renderShadow(sc, f);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    // ---------- main pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // terrain
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

    // instanced (vegetation, animals, buildings): leaves seen from both sides
    gl.disable(gl.CULL_FACE);
    const pi = this.p.inst.use();
    this.setCommon(pi, f);
    for (const b of f.batches) {
      if (!b.count) continue;
      pi.set('uKind', b.kind); pi.set('uSway', b.sway); pi.set('uHeight', b.mesh.height || 1); pi.set('uSpec', b.spec);
      gl.bindVertexArray(b.vao);
      if (b.stride < 12) gl.vertexAttrib4f(LOC.I2, 0, 0, 0, 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, b.mesh.count, b.count);
      this.stats.draws++;
    }
    gl.enable(gl.CULL_FACE);

    // single objects (vehicle body, wheels)
    const po = this.p.obj.use();
    this.setCommon(po, f);
    for (const o of f.objects) {
      po.set('uModel', o.model); po.set('uSpec', o.spec ?? 0.3);
      po.set('uDirt', [o.dirt ?? 0, o.dirtY ?? -10, 0]); po.set('uDirtColor', o.dirtColor ?? [0.6, 0.5, 0.4]);
      po.set('uEmissive', o.emissive ?? 0);
      gl.bindVertexArray(o.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, o.mesh.count);
      this.stats.draws++;
    }

    // sky (behind everything, depth test at far plane)
    gl.depthFunc(gl.LEQUAL);
    const ps = this.p.sky.use();
    this.setCommon(ps, f);
    ps.set('uInvViewProj', this.invViewProj);
    ps.set('uStars', f.env.stars);
    ps.set('uClouds', f.env.clouds);
    gl.bindVertexArray(this.emptyVao);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);

    // transparent: roads, water, particles
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-2.0, -8.0);
    if (f.road) {
      const pr = this.p.road.use();
      this.setCommon(pr, f);
      pr.set('uPisteColor', f.road.pisteColor);
      pr.set('uOrigin', [f.road.origin[0] - f.camPos[0], f.road.origin[1] - f.camPos[1], f.road.origin[2] - f.camPos[2]]);
      gl.bindVertexArray(f.road.vao);
      gl.drawElements(gl.TRIANGLES, f.road.count, gl.UNSIGNED_INT, 0);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    if (f.water) {
      const pw = this.p.water.use();
      this.setCommon(pw, f);
      pw.set('uOrigin', [f.water.origin[0] - f.camPos[0], f.water.origin[1] - f.camPos[1], f.water.origin[2] - f.camPos[2]]);
      gl.bindVertexArray(f.water.vao);
      gl.disable(gl.CULL_FACE);
      gl.drawElements(gl.TRIANGLES, f.water.count, gl.UNSIGNED_INT, 0);
      gl.enable(gl.CULL_FACE);
    }
    if (f.particles && f.particles.count > 0) {
      const pp = this.p.part.use();
      this.setCommon(pp, f);
      pp.set('uRight', [this.view[0], this.view[4], this.view[8]]);
      pp.set('uUp', [this.view[1], this.view[5], this.view[9]]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
      const data = f.particles.data;
      if (data.byteLength > this.partCap) { this.partCap = data.byteLength; gl.bufferData(gl.ARRAY_BUFFER, this.partCap, gl.DYNAMIC_DRAW); }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, f.particles.count * 8);
      gl.bindVertexArray(this.partVao);
      gl.depthMask(false);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, f.particles.count);
      gl.depthMask(true);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  _renderShadow(sc, f) {
    const gl = this.gl;
    const sun = f.env.sunDir;
    const r = sc.radius;
    // centre the cascade ahead of the camera focus, snapped to texels
    const fc = [f.focus[0] - f.camPos[0], f.focus[1] - f.camPos[1], f.focus[2] - f.camPos[2]];
    const ahead = r * 0.5;
    const cx = fc[0] + f.camDir[0] * ahead, cz = fc[2] + f.camDir[2] * ahead, cy = fc[1];
    const view = m4.create();
    const eye = [cx + sun[0] * 2500, cy + sun[1] * 2500, cz + sun[2] * 2500];
    m4.lookAt(view, eye, [cx, cy, cz], Math.abs(sun[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]);
    // snap translation to texel size to stop shimmering
    const texel = (2 * r) / SHADOW_SIZE;
    // light-space position of the world origin relative to camera
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
    // terrain (only the near cascade needs fine terrain self-shadowing of bumps; far one casts mountain shadows)
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
