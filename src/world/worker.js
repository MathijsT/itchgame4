// Terrain worker: builds chunk meshes (heights, normals, colours, detail
// weights), scatters vegetation and renders the overview map, off the main thread.

import { getWorld } from '../worlds/registry.js';
import { hash2 } from '../core/noise.js';

let world = null, terrain = null, flora = null;

const SITE_FIELDS = ['zw', 'wMid', 'wHigh', 'wPre', 'wHam', 'wErg', 'mtn', 'mesa', 'duneRel', 'oued', 'riverD', 'river', 'pad', 'road', 'roadType', 'h', 'water', 'routeD'];

function buildChunk({ cx, cz, size, res }) {
  const sp = size / res;
  const n = res + 1, ne = res + 3;
  const x0 = cx * size, z0 = cz * size;
  const H = new Float32Array(ne * ne);
  const fields = {};
  for (const f of SITE_FIELDS) fields[f] = new Float32Array(n * n);
  const o = {};
  for (let j = 0; j < ne; j++) {
    for (let i = 0; i < ne; i++) {
      const x = x0 + (i - 1) * sp, z = z0 + (j - 1) * sp;
      const interior = i >= 1 && j >= 1 && i <= n && j <= n;
      H[j * ne + i] = terrain.sample(x, z, o);
      if (interior) {
        const k = (j - 1) * n + (i - 1);
        for (const f of SITE_FIELDS) fields[f][k] = o[f];
      }
    }
  }
  const skirt = sp * 1.5 + 2;
  const vcount = n * n + 4 * res + 4;
  const pos = new Float32Array(vcount * 3);
  const nrm = new Int8Array(vcount * 4);
  const col = new Uint8Array(vcount * 4);
  const det = new Uint8Array(vcount * 4);
  let minY = Infinity, maxY = -Infinity;
  const so = {};
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const e = (j + 1) * ne + (i + 1);
      const h = H[e];
      const nx = H[e - 1] - H[e + 1], nz = H[e - ne] - H[e + ne], ny = 2 * sp;
      const l = Math.hypot(nx, ny, nz);
      pos[k * 3] = i * sp; pos[k * 3 + 1] = h; pos[k * 3 + 2] = j * sp;
      if (h < minY) minY = h; if (h > maxY) maxY = h;
      nrm[k * 4] = Math.round((nx / l) * 127); nrm[k * 4 + 1] = Math.round((ny / l) * 127); nrm[k * 4 + 2] = Math.round((nz / l) * 127);
      for (const f of SITE_FIELDS) so[f] = fields[f][k];
      terrain.shade(x0 + i * sp, z0 + j * sp, so, ny / l);
      col[k * 4] = Math.min(255, so.r * 255); col[k * 4 + 1] = Math.min(255, so.g * 255); col[k * 4 + 2] = Math.min(255, so.b * 255); col[k * 4 + 3] = so.surf;
      det[k * 4] = Math.min(255, so.dSand * 255); det[k * 4 + 1] = Math.min(255, so.dRock * 255);
      det[k * 4 + 2] = Math.min(255, so.dSnow * 255); det[k * 4 + 3] = Math.min(255, so.dVeg * 255);
    }
  }
  // skirts: perimeter vertices duplicated and dropped, hiding LOD cracks
  let v = n * n;
  const edge = [];
  for (let i = 0; i < n; i++) edge.push(i);                       // north edge (j=0)
  for (let j = 1; j < n; j++) edge.push(j * n + res);             // east edge
  for (let i = res - 1; i >= 0; i--) edge.push(res * n + i);      // south edge
  for (let j = res - 1; j >= 1; j--) edge.push(j * n);            // west edge
  for (const k of edge) {
    pos[v * 3] = pos[k * 3]; pos[v * 3 + 1] = pos[k * 3 + 1] - skirt; pos[v * 3 + 2] = pos[k * 3 + 2];
    for (let c = 0; c < 4; c++) { nrm[v * 4 + c] = nrm[k * 4 + c]; col[v * 4 + c] = col[k * 4 + c]; det[v * 4 + c] = det[k * 4 + c]; }
    v++;
  }
  return { pos, nrm, col, det, minY: minY - skirt, maxY, vcount: v, edgeCount: edge.length };
}

function buildVeg({ cx, cz, size }) {
  const x0 = cx * size, z0 = cz * size;
  // coarse site grid (8 m) with slopes, for fast density evaluation
  const G = 8, gn = Math.round(size / G) + 1, ge = gn + 2;
  const Hs = new Float32Array(ge * ge);
  const sites = new Array(gn * gn);
  const o = {};
  for (let j = 0; j < ge; j++) {
    for (let i = 0; i < ge; i++) {
      const x = x0 + (i - 1) * G, z = z0 + (j - 1) * G;
      Hs[j * ge + i] = terrain.sample(x, z, o);
      if (i >= 1 && j >= 1 && i <= gn && j <= gn) {
        const s = {};
        for (const f of SITE_FIELDS) s[f] = o[f];
        s.x = x; s.z = z;
        sites[(j - 1) * gn + (i - 1)] = s;
      }
    }
  }
  for (let j = 0; j < gn; j++) {
    for (let i = 0; i < gn; i++) {
      const e = (j + 1) * ge + (i + 1);
      const nx = Hs[e - 1] - Hs[e + 1], nz = Hs[e - ge] - Hs[e + ge], ny = 2 * G;
      const s = sites[j * gn + i];
      const yn = ny / Math.hypot(nx, ny, nz);
      s.slope = 1 - yn;
      terrain.shade(s.x, s.z, s, yn);
      s.rgb = [s.r, s.g, s.b];
    }
  }
  const n5 = terrain.n5, n4 = terrain.n4;
  const out = {};
  const colliders = [];
  const site = {};
  for (let si = 0; si < flora.length; si++) {
    const sp = flora[si];
    const step = sp.spacing;
    const cells = Math.floor(size / step);
    const arr = [];
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const gx = Math.floor(x0 / step) + i, gz = Math.floor(z0 / step) + j;
        const r1 = hash2(gx, gz, si * 7919 + 13);
        const x = (gx + hash2(gx, gz, si * 31 + 1)) * step;
        const z = (gz + hash2(gx, gz, si * 37 + 2)) * step;
        if (x < x0 || x >= x0 + size || z < z0 || z >= z0 + size) continue;
        const ii = Math.min(gn - 1, Math.round((x - x0) / G)), jj = Math.min(gn - 1, Math.round((z - z0) / G));
        const s = sites[jj * gn + ii];
        Object.assign(site, s);
        site.x = x; site.z = z;
        site.clump1 = n5.noise(x / 420 + si * 0.0, z / 420);
        site.clump2 = n4.noise(x / 90 + si * 1.7, z / 90);
        const p = sp.density(site) * sp.maxP;
        if (!(r1 < p)) continue;
        const y = terrain.height(x, z);
        const sc = sp.scale[0] + (sp.scale[1] - sp.scale[0]) * hash2(gx, gz, si * 41 + 3);
        const yaw = hash2(gx, gz, si * 43 + 4) * Math.PI * 2;
        let tr = 1, tg = 1, tb = 1;
        if (sp.rockTint) {
          // weathered stone: local ground colour pulled towards grey-brown rock
          tr = (s.rgb[0] * 0.5 + 0.3) * 1.1; tg = (s.rgb[1] * 0.5 + 0.25) * 1.1; tb = (s.rgb[2] * 0.5 + 0.21) * 1.1;
        } else {
          const v = 0.88 + 0.24 * hash2(gx, gz, si * 47 + 5);
          tr = v; tg = v * (0.96 + 0.08 * hash2(gx, gz, si * 53)); tb = v;
        }
        arr.push(x, y - 0.15 * sc, z, yaw, sc, tr, tg, tb);
        if (sp.collide) colliders.push(x, z, sp.collide * sc, si);
      }
    }
    if (arr.length) out[sp.id] = new Float32Array(arr);
  }
  return { inst: out, colliders: new Float32Array(colliders) };
}

function buildMap({ w, h }) {
  const b = terrain.bounds;
  const img = new Uint8ClampedArray(w * h * 4);
  const hs = new Float32Array(w * h);
  const o = {};
  const sx = (b.maxX - b.minX) / w, sz = (b.maxZ - b.minZ) / h;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = b.minX + (i + 0.5) * sx, z = b.minZ + (j + 0.5) * sz;
      hs[j * w + i] = terrain.sample(x, z, o);
      terrain.shade(x, z, o, 1);
      const k = (j * w + i) * 4;
      img[k] = o.r * 255; img[k + 1] = o.g * 255; img[k + 2] = o.b * 255; img[k + 3] = 255;
      if (o.water > 0.1 || o.river > 0.5) { img[k] = 60; img[k + 1] = 110; img[k + 2] = 140; }
    }
  }
  // hillshade from the north-west
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      const dx = (hs[j * w + i + 1] - hs[j * w + i - 1]) / (2 * sx);
      const dz = (hs[(j + 1) * w + i] - hs[(j - 1) * w + i]) / (2 * sz);
      const shade = Math.max(0.35, Math.min(1.35, 1 + (dx * 0.7 + dz * 0.7) * -1.2));
      const k = (j * w + i) * 4;
      img[k] *= shade; img[k + 1] *= shade; img[k + 2] *= shade;
    }
  }
  return { img, hs };
}

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      world = getWorld(m.worldId);
      terrain = world.createTerrain(m.seed);
      flora = world.flora;
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'chunk') {
      const r = buildChunk(m);
      self.postMessage({ type: 'chunk', id: m.id, key: m.key, lod: m.lod, ...r }, [r.pos.buffer, r.nrm.buffer, r.col.buffer, r.det.buffer]);
    } else if (m.type === 'veg') {
      const r = buildVeg(m);
      const transfer = Object.values(r.inst).map((a) => a.buffer).concat([r.colliders.buffer]);
      self.postMessage({ type: 'veg', id: m.id, key: m.key, ...r }, transfer);
    } else if (m.type === 'map') {
      const r = buildMap(m);
      self.postMessage({ type: 'map', id: m.id, w: m.w, h: m.h, img: r.img, hs: r.hs }, [r.img.buffer, r.hs.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.stack || err) });
  }
};
