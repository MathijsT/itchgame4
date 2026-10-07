// Streams terrain chunks and vegetation around the camera using a pool of
// workers, keeping GPU buffers per chunk and per-species instance buffers.

import { makeBuffer, makeVAO, LOC } from '../gfx/gl.js';

export const CHUNK = 256;
const LODS = [
  { res: 128, dist: 330 },
  { res: 64, dist: 720 },
  { res: 32, dist: 1500 },
  { res: 16, dist: 3000 },
  { res: 8, dist: Infinity },
];

export class TerrainStreamer {
  constructor(gl, world, seed, opts = {}) {
    this.gl = gl;
    this.world = world;
    this.viewDist = opts.viewDist ?? 4500;
    this.vegDist = opts.vegDist ?? 1400;
    this.chunks = new Map();       // key -> {cx,cz,lod,vao,count,minY,maxY,pending}
    this.veg = new Map();          // key -> {inst:{id:Float32Array}, colliders, pending}
    this.indexCache = new Map();
    this.jobs = new Map();
    this.nextId = 1;
    this.ready = false;
    this.inFlight = 0;
    this.vegDirty = true;
    this.mapCallbacks = new Map();
    const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = [];
    let readyCount = 0;
    this.readyPromise = new Promise((resolve, reject) => {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        w.busy = 0;
        w.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'ready') { if (++readyCount === n) { this.ready = true; resolve(); } return; }
          w.busy--; this.inFlight--;
          if (m.type === 'error') { console.error('worker error', m.message); reject(new Error(m.message)); return; }
          this._onResult(m);
        };
        w.onerror = (e) => { console.error('worker failed', e); reject(new Error(e.message || 'Worker failed to start')); };
        w.postMessage({ type: 'init', worldId: world.id, seed });
        this.workers.push(w);
      }
    });
  }

  _post(msg) {
    let best = this.workers[0];
    for (const w of this.workers) if (w.busy < best.busy) best = w;
    best.busy++; this.inFlight++;
    best.postMessage(msg);
  }

  requestMap(w, h) {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.mapCallbacks.set(id, resolve);
      this._post({ type: 'map', id, w, h });
    });
  }

  _indices(res) {
    if (this.indexCache.has(res)) return this.indexCache.get(res);
    const gl = this.gl;
    const n = res + 1;
    const idx = [];
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    // skirt strips: perimeter order matches worker
    const edge = [];
    for (let i = 0; i < n; i++) edge.push(i);
    for (let j = 1; j < n; j++) edge.push(j * n + res);
    for (let i = res - 1; i >= 0; i--) edge.push(res * n + i);
    for (let j = res - 1; j >= 1; j--) edge.push(j * n);
    const base = n * n;
    for (let k = 0; k < edge.length; k++) {
      const k1 = (k + 1) % edge.length;
      const a = edge[k], b = edge[k1], c = base + k, d = base + k1;
      idx.push(a, b, c, b, d, c);
      idx.push(a, c, b, b, c, d); // both windings: skirts are seen from either side
    }
    const arr = n * n + edge.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
    const buf = makeBuffer(gl, arr, gl.STATIC_DRAW, gl.ELEMENT_ARRAY_BUFFER);
    const r = { buf, count: idx.length, type: arr instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
    this.indexCache.set(res, r);
    return r;
  }

  _onResult(m) {
    const gl = this.gl;
    if (m.type === 'chunk') {
      const c = this.chunks.get(m.key);
      if (!c) return;
      c.pending = false;
      if (c.wantLod !== m.lod) return; // stale
      const ib = this._indices(LODS[m.lod].res);
      const pos = makeBuffer(gl, m.pos), nrm = makeBuffer(gl, m.nrm), col = makeBuffer(gl, m.col), det = makeBuffer(gl, m.det);
      const vao = makeVAO(gl, [
        { loc: LOC.POS, buffer: pos, size: 3 },
        { loc: LOC.NRM, buffer: nrm, size: 4, type: gl.BYTE, normalized: true },
        { loc: LOC.COL, buffer: col, size: 4, type: gl.UNSIGNED_BYTE, normalized: true },
        { loc: LOC.DETAIL, buffer: det, size: 4, type: gl.UNSIGNED_BYTE, normalized: true },
      ], ib.buf);
      this._freeMesh(c);
      c.mesh = { vao, bufs: [pos, nrm, col, det], count: ib.count, type: ib.type };
      c.lod = m.lod;
      c.minY = m.minY; c.maxY = m.maxY;
    } else if (m.type === 'veg') {
      const v = this.veg.get(m.key);
      if (!v) return;
      v.pending = false;
      v.inst = m.inst;
      v.colliders = m.colliders;
      this.vegDirty = true;
    } else if (m.type === 'map') {
      const cb = this.mapCallbacks.get(m.id);
      if (cb) { this.mapCallbacks.delete(m.id); cb(m); }
    }
  }

  _freeMesh(c) {
    if (!c.mesh) return;
    const gl = this.gl;
    gl.deleteVertexArray(c.mesh.vao);
    for (const b of c.mesh.bufs) gl.deleteBuffer(b);
    c.mesh = null;
  }

  update(cam) {
    if (!this.ready) return;
    const ccx = Math.floor(cam[0] / CHUNK), ccz = Math.floor(cam[2] / CHUNK);
    const r = Math.ceil(this.viewDist / CHUNK);
    const want = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = ccx + dx, cz = ccz + dz;
        // distance from camera to chunk rectangle
        const x0 = cx * CHUNK, z0 = cz * CHUNK;
        const ex = Math.max(x0 - cam[0], 0, cam[0] - (x0 + CHUNK));
        const ez = Math.max(z0 - cam[2], 0, cam[2] - (z0 + CHUNK));
        const d = Math.hypot(ex, ez);
        if (d > this.viewDist) continue;
        let lod = 0;
        while (d > LODS[lod].dist) lod++;
        want.push({ cx, cz, lod, d, key: `${cx},${cz}` });
      }
    }
    want.sort((a, b) => a.d - b.d);
    const keep = new Set();
    for (const wd of want) {
      keep.add(wd.key);
      let c = this.chunks.get(wd.key);
      if (!c) { c = { cx: wd.cx, cz: wd.cz, lod: -1, wantLod: -1, pending: false, mesh: null, minY: 0, maxY: 3000 }; this.chunks.set(wd.key, c); }
      c.dist = wd.d;
      if (c.wantLod !== wd.lod && !c.pending && this.inFlight < this.workers.length * 3) {
        c.wantLod = wd.lod; c.pending = true;
        this._post({ type: 'chunk', id: this.nextId++, key: wd.key, cx: wd.cx, cz: wd.cz, size: CHUNK, res: LODS[wd.lod].res, lod: wd.lod });
      }
      // vegetation for nearby chunks
      if (wd.d < this.vegDist) {
        let v = this.veg.get(wd.key);
        if (!v && this.inFlight < this.workers.length * 3) {
          v = { pending: true, inst: null, colliders: null, cx: wd.cx, cz: wd.cz };
          this.veg.set(wd.key, v);
          this._post({ type: 'veg', id: this.nextId++, key: wd.key, cx: wd.cx, cz: wd.cz, size: CHUNK });
        }
        if (v) v.dist = wd.d;
      }
    }
    for (const [k, c] of this.chunks) {
      if (!keep.has(k)) { this._freeMesh(c); this.chunks.delete(k); }
    }
    for (const [k, v] of this.veg) {
      const cx = v.cx * CHUNK + CHUNK / 2, cz = v.cz * CHUNK + CHUNK / 2;
      if (Math.hypot(cx - cam[0], cz - cam[2]) > this.vegDist + CHUNK * 1.5) { this.veg.delete(k); this.vegDirty = true; }
    }
  }

  // Nearby obstacle cylinders from vegetation: [x, z, r, top]
  colliders(x, z, radius) {
    const out = [];
    const cx0 = Math.floor((x - radius) / CHUNK), cx1 = Math.floor((x + radius) / CHUNK);
    const cz0 = Math.floor((z - radius) / CHUNK), cz1 = Math.floor((z + radius) / CHUNK);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const v = this.veg.get(`${cx},${cz}`);
        if (!v || !v.colliders) continue;
        const a = v.colliders;
        for (let i = 0; i < a.length; i += 4) {
          const dx = a[i] - x, dz = a[i + 1] - z;
          if (dx * dx + dz * dz < (radius + a[i + 2]) * (radius + a[i + 2])) {
            // boulders are low: small ones can be driven over
            const rock = this.world.flora[a[i + 3]].kind === 'rock';
            out.push([a[i], a[i + 1], a[i + 2], rock ? this._groundAt(a[i], a[i + 1]) + a[i + 2] * 1.3 : Infinity]);
          }
        }
      }
    }
    return out;
  }

  setGroundFn(fn) { this._groundAt = fn; }

  // All vegetation instances of a species within a radius, for the renderer.
  // thin > 0 drops a growing share of instances with distance (far LOD budget)
  gather(speciesId, minD, maxD, thin = 0) {
    const parts = [];
    let total = 0;
    for (const v of this.veg.values()) {
      if (!v.inst || !v.inst[speciesId] || v.dist >= maxD || v.dist < minD) continue;
      let a = v.inst[speciesId];
      if (thin > 0) {
        const keep = 1 - thin * Math.min(1, (v.dist - minD) / Math.max(1, maxD - minD));
        if (keep < 0.999) {
          const out = [];
          for (let i = 0; i < a.length; i += 8) {
            // stable per-instance hash so trees don't flicker as the set changes
            const h = Math.abs(Math.sin(a[i] * 12.9898 + a[i + 2] * 78.233) * 43758.5453) % 1;
            if (h < keep) { for (let k = 0; k < 8; k++) out.push(a[i + k]); out[out.length - 4] *= 1 + (1 - keep) * 0.3; }
          }
          a = new Float32Array(out);
        }
      }
      parts.push(a);
      total += a.length;
    }
    const out = new Float32Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    for (const c of this.chunks.values()) this._freeMesh(c);
    this.chunks.clear();
  }
}
