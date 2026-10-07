// Ribbon meshes that follow splines: the road surface (asphalt markings,
// piste ruts) and river water surfaces (with flow direction for the shader).

import { makeBuffer, makeVAO } from '../gfx/gl.js';
import { ROAD } from './route.js';

export function buildRoadRibbon(gl, terrain) {
  const r = terrain.route;
  const hw = r.halfWidth + 0.4;
  const pos = [], nrm = [], uv = [], idx = [];
  const ox = r.x[0], oz = r.z[0], oy = r.roadH[0];
  let prevValid = false;
  const o = {};
  for (let i = 0; i < r.n; i++) {
    const type = r.type[i];
    if (type === ROAD.NONE) { prevValid = false; continue; }
    const i0 = Math.max(0, i - 1), i1 = Math.min(r.n - 1, i + 1);
    let tx = r.x[i1] - r.x[i0], tz = r.z[i1] - r.z[i0];
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = tz, nz = -tx; // right-hand normal in xz
    const base = pos.length / 3;
    const across = [-1, -0.5, 0, 0.5, 1];
    for (const u of across) {
      const x = r.x[i] + nx * hw * u, z = r.z[i] + nz * hw * u;
      const h = terrain.sample(x, z, o);
      pos.push(x - ox, h + 0.04 - oy, z - oz);
      // normal from terrain gradient
      const e = 1.0;
      const gx = terrain.height(x + e, z) - terrain.height(x - e, z);
      const gz = terrain.height(x, z + e) - terrain.height(x, z - e);
      const l = Math.hypot(gx, 2 * e, gz);
      nrm.push(-gx / l, (2 * e) / l, -gz / l);
      uv.push(u, r.s[i], type === ROAD.ASPHALT ? 0 : 1);
    }
    if (prevValid) {
      const a = base - 5;
      for (let k = 0; k < 4; k++) {
        idx.push(a + k, base + k, a + k + 1, a + k + 1, base + k, base + k + 1);
      }
    }
    prevValid = true;
  }
  const vao = makeVAO(gl, [
    { loc: 0, buffer: makeBuffer(gl, new Float32Array(pos)), size: 3 },
    { loc: 1, buffer: makeBuffer(gl, new Float32Array(nrm)), size: 3 },
    { loc: 2, buffer: makeBuffer(gl, new Float32Array(uv)), size: 3 },
  ], makeBuffer(gl, new Uint32Array(idx), gl.STATIC_DRAW, gl.ELEMENT_ARRAY_BUFFER));
  return { vao, count: idx.length, origin: [ox, oy, oz] };
}

export function buildWaterRibbons(gl, terrain) {
  const pos = [], flow = [], idx = [];
  const ox = terrain.route.x[0], oz = terrain.route.z[0], oy = terrain.route.roadH[0];
  for (const rv of terrain.rivers) {
    const hw = rv.info.halfWidth + 2.5;
    let prev = -1;
    for (let i = 0; i < rv.n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(rv.n - 1, i + 1);
      let tx = rv.x[i1] - rv.x[i0], tz = rv.z[i1] - rv.z[i0];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const nx = tz, nz = -tx;
      // flow speed from the water surface slope (steeper = faster)
      const slope = Math.max(0, (rv.roadH[i0] - rv.roadH[i1]) / (8 * (i1 - i0 || 1)));
      const sp = 0.6 + Math.min(2.5, slope * 60);
      const base = pos.length / 3;
      for (const u of [-1, 0, 1]) {
        pos.push(rv.x[i] + nx * hw * u - ox, rv.roadH[i] - 0.05 - oy, rv.z[i] + nz * hw * u - oz);
        flow.push(tx * sp, Math.abs(u), tz * sp);
      }
      if (prev >= 0) {
        for (let k = 0; k < 2; k++) idx.push(prev + k, base + k, prev + k + 1, prev + k + 1, base + k, base + k + 1);
      }
      prev = base;
    }
  }
  const vao = makeVAO(gl, [
    { loc: 0, buffer: makeBuffer(gl, new Float32Array(pos)), size: 3 },
    { loc: 1, buffer: makeBuffer(gl, new Float32Array(flow)), size: 3 },
  ], makeBuffer(gl, new Uint32Array(idx), gl.STATIC_DRAW, gl.ELEMENT_ARRAY_BUFFER));
  return { vao, count: idx.length, origin: [ox, oy, oz] };
}
