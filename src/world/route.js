// A rally route: a Catmull-Rom spline through control points, resampled by arc
// length. It knows the road surface type per section and a smoothed,
// grade-limited road height profile so the terrain can be cut and filled
// around it. Queries are accelerated with a segment hash (near) and a coarse
// distance field (far, used to open up mountain passes along the corridor).

import { clamp } from '../core/noise.js';

export const ROAD = { ASPHALT: 0, PISTE: 1, NONE: 2 };

const STEP = 8;          // resample spacing (m)
const CELL = 32;         // segment hash cell size (m)
const NEAR = 72;         // exact query radius (m)
const FIELD_RES = 40;    // corridor distance field resolution (m)
const FIELD_MAX = 2500;  // corridor field saturates here (m)

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export class Route {
  /**
   * @param {Array<{x:number,z:number,road:number}>} ctrl control points; road type applies to the section after the point
   * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds
   * Call setProfile(baseHeight) afterwards: the profile may depend on corridor().
   */
  constructor(ctrl, bounds, opts = {}) {
    this.maxGrade = opts.maxGrade ?? 0.085;
    this.halfWidth = opts.halfWidth ?? 4.5;
    this.monotone = !!opts.monotone;
    // 1. dense spline polyline
    const dense = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      const n = Math.max(2, Math.ceil(segLen / 2));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        dense.push({ x: catmull(p0.x, p1.x, p2.x, p3.x, t), z: catmull(p0.z, p1.z, p2.z, p3.z, t), road: p1.road });
      }
    }
    const last = ctrl[ctrl.length - 1];
    dense.push({ x: last.x, z: last.z, road: last.road });

    // 2. resample at uniform arc length
    const xs = [], zs = [], types = [], ss = [];
    let acc = 0, next = 0;
    xs.push(dense[0].x); zs.push(dense[0].z); types.push(dense[0].road); ss.push(0);
    next = STEP;
    for (let i = 1; i < dense.length; i++) {
      const a = dense[i - 1], b = dense[i];
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      while (acc + l >= next) {
        const t = (next - acc) / l;
        xs.push(a.x + (b.x - a.x) * t); zs.push(a.z + (b.z - a.z) * t); types.push(a.road); ss.push(next);
        next += STEP;
      }
      acc += l;
    }
    this.length = acc;
    const n = xs.length;
    this.n = n;
    this.x = Float32Array.from(xs);
    this.z = Float32Array.from(zs);
    this.s = Float32Array.from(ss);
    this.type = Uint8Array.from(types);

    // 4. segment hash
    this.cells = new Map();
    for (let i = 0; i < n - 1; i++) {
      const minx = Math.min(this.x[i], this.x[i + 1]), maxx = Math.max(this.x[i], this.x[i + 1]);
      const minz = Math.min(this.z[i], this.z[i + 1]), maxz = Math.max(this.z[i], this.z[i + 1]);
      for (let cx = Math.floor(minx / CELL); cx <= Math.floor(maxx / CELL); cx++) {
        for (let cz = Math.floor(minz / CELL); cz <= Math.floor(maxz / CELL); cz++) {
          const key = cx * 73856093 ^ cz * 19349663;
          let arr = this.cells.get(key);
          if (!arr) { arr = []; this.cells.set(key, arr); }
          arr.push(i);
        }
      }
    }

    // 5. coarse corridor distance field
    const b = bounds;
    this.fx0 = b.minX - FIELD_MAX; this.fz0 = b.minZ - FIELD_MAX;
    this.fw = Math.ceil((b.maxX - b.minX + 2 * FIELD_MAX) / FIELD_RES) + 1;
    this.fh = Math.ceil((b.maxZ - b.minZ + 2 * FIELD_MAX) / FIELD_RES) + 1;
    const field = new Float32Array(this.fw * this.fh).fill(FIELD_MAX);
    const fidx = new Int32Array(this.fw * this.fh);
    const r = Math.ceil(FIELD_MAX / FIELD_RES);
    const stride = Math.max(1, Math.round(FIELD_RES / STEP));
    for (let i = 0; i < n; i += stride) {
      const px = this.x[i], pz = this.z[i];
      const cx = Math.round((px - this.fx0) / FIELD_RES), cz = Math.round((pz - this.fz0) / FIELD_RES);
      for (let j = Math.max(0, cz - r); j <= Math.min(this.fh - 1, cz + r); j++) {
        const wz = this.fz0 + j * FIELD_RES - pz;
        for (let k = Math.max(0, cx - r); k <= Math.min(this.fw - 1, cx + r); k++) {
          const wx = this.fx0 + k * FIELD_RES - px;
          const d = Math.sqrt(wx * wx + wz * wz);
          const idx = j * this.fw + k;
          if (d < field[idx]) { field[idx] = d; fidx[idx] = i; }
        }
      }
    }
    this.field = field;
    this.fieldIdx = fidx;
    this.roadH = new Float32Array(n);
    this._q = { d: 0, s: 0, h: 0, type: ROAD.NONE, i: 0, tx: 0, tz: 1, side: 0 };
  }

  // Height profile: smoothed terrain, then grade limited. Rivers (monotone)
  // additionally never rise downstream and stay below the raw terrain.
  // pinFn(x,z) may return a height the profile must pass through (e.g. a ford),
  // or NaN; the profile ramps down to pins at the maximum grade.
  setProfile(baseHeight, pinFn = null) {
    const n = this.n;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = baseHeight(this.x[i], this.z[i]);
    let h = raw;
    const win = Math.round(160 / STEP);
    for (let pass = 0; pass < 3; pass++) {
      const out = new Float32Array(n);
      let sum = 0, cnt = 0;
      for (let i = -win; i < n + win; i++) {
        const add = i + win, rem = i - win - 1;
        if (add >= 0 && add < n) { sum += h[add]; cnt++; }
        if (rem >= 0 && rem < n) { sum -= h[rem]; cnt--; }
        if (i >= 0 && i < n) out[i] = sum / cnt;
      }
      h = out;
    }
    const g = this.maxGrade * STEP;
    if (this.monotone) {
      for (let i = 0; i < n; i++) h[i] = Math.min(h[i], raw[i] - 1.0);
      for (let i = 1; i < n; i++) h[i] = Math.min(h[i], h[i - 1]);
    }
    for (let i = 1; i < n; i++) h[i] = clamp(h[i], h[i - 1] - g, h[i - 1] + g);
    for (let i = n - 2; i >= 0; i--) h[i] = clamp(h[i], h[i + 1] - g, h[i + 1] + g);
    this.roadH = h;
    if (pinFn) this.applyPins(pinFn);
    h = this.roadH;
    this.roadH = h;
    this.rawH = raw;
  }

  // Lower the profile so it passes through pinned heights, ramping at max grade.
  applyPins(pinFn) {
    const n = this.n, h = this.roadH, g = this.maxGrade * STEP;
    const env = new Float32Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) {
      const p = pinFn(this.x[i], this.z[i]);
      if (!Number.isNaN(p)) env[i] = p;
    }
    for (let i = 1; i < n; i++) env[i] = Math.min(env[i], env[i - 1] + g);
    for (let i = n - 2; i >= 0; i--) env[i] = Math.min(env[i], env[i + 1] + g);
    for (let i = 0; i < n; i++) h[i] = Math.min(h[i], env[i]);
    if (this.monotone) for (let i = 1; i < n; i++) h[i] = Math.min(h[i], h[i - 1]);
  }

  // Smooth corridor distance (m), approximate, for large-scale shaping.
  corridor(x, z) {
    const fx = (x - this.fx0) / FIELD_RES, fz = (z - this.fz0) / FIELD_RES;
    if (fx < 0 || fz < 0 || fx >= this.fw - 1 || fz >= this.fh - 1) return FIELD_MAX;
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const f = this.field, w = this.fw, i0 = iz * w + ix;
    const a = f[i0] + (f[i0 + 1] - f[i0]) * tx;
    const b = f[i0 + w] + (f[i0 + w + 1] - f[i0 + w]) * tx;
    return a + (b - a) * tz;
  }

  // Profile height of the (approximately) nearest route sample.
  corridorHeight(x, z) {
    const i = this.corridorIndex(x, z);
    return i < 0 ? NaN : this.roadH[i];
  }

  corridorIndex(x, z) {
    const k = Math.round((x - this.fx0) / FIELD_RES), j = Math.round((z - this.fz0) / FIELD_RES);
    if (k < 0 || j < 0 || k >= this.fw || j >= this.fh) return -1;
    return this.fieldIdx[j * this.fw + k];
  }

  // Exact nearest point on the route within NEAR metres; returns shared object.
  // q.d = Infinity when nothing is near.
  near(x, z) {
    const q = this._q;
    q.d = Infinity;
    const cx0 = Math.floor((x - NEAR) / CELL), cx1 = Math.floor((x + NEAR) / CELL);
    const cz0 = Math.floor((z - NEAR) / CELL), cz1 = Math.floor((z + NEAR) / CELL);
    let best = Infinity, bi = -1, bt = 0;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const arr = this.cells.get(cx * 73856093 ^ cz * 19349663);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const i = arr[k];
          const ax = this.x[i], az = this.z[i];
          const dx = this.x[i + 1] - ax, dz = this.z[i + 1] - az;
          const l2 = dx * dx + dz * dz;
          let t = ((x - ax) * dx + (z - az) * dz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = ax + dx * t - x, ez = az + dz * t - z;
          const d2 = ex * ex + ez * ez;
          if (d2 < best) { best = d2; bi = i; bt = t; }
        }
      }
    }
    if (bi < 0 || best > NEAR * NEAR) return q;
    const i = bi;
    const dx = this.x[i + 1] - this.x[i], dz = this.z[i + 1] - this.z[i];
    const l = Math.hypot(dx, dz) || 1;
    q.d = Math.sqrt(best);
    q.i = i;
    q.s = this.s[i] + STEP * bt;
    q.h = this.roadH[i] + (this.roadH[i + 1] - this.roadH[i]) * bt;
    q.type = this.type[i];
    q.tx = dx / l; q.tz = dz / l;
    q.side = Math.sign((x - this.x[i]) * q.tz - (z - this.z[i]) * q.tx);
    return q;
  }

  // Point at arc length s
  at(s, out = {}) {
    const f = clamp(s / STEP, 0, this.n - 1.001);
    const i = Math.floor(f), t = f - i;
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * t;
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * t;
    out.h = this.roadH[i] + (this.roadH[i + 1] - this.roadH[i]) * t;
    out.type = this.type[i];
    const dx = this.x[i + 1] - this.x[i], dz = this.z[i + 1] - this.z[i];
    const l = Math.hypot(dx, dz) || 1;
    out.tx = dx / l; out.tz = dz / l;
    return out;
  }

  // Signed curvature (1/m) around arc length s, used by AI rivals.
  curvature(s, span = 40) {
    const a = this.at(s - span, {}), b = this.at(s, {}), c = this.at(s + span, {});
    const h1 = Math.atan2(b.x - a.x, b.z - a.z), h2 = Math.atan2(c.x - b.x, c.z - b.z);
    let d = h2 - h1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d / span;
  }

  // Arc length of the route point nearest to (x,z) by brute force over a window
  // around a hint index (cheap tracking for vehicles).
  track(x, z, hintS = -1, window = 600) {
    let i0 = 0, i1 = this.n - 1;
    if (hintS >= 0) {
      const hi = Math.round(hintS / STEP), w = Math.round(window / STEP);
      i0 = Math.max(0, hi - w); i1 = Math.min(this.n - 1, hi + w);
    }
    let best = Infinity, bi = i0;
    const step = hintS >= 0 ? 1 : 4;
    for (let i = i0; i <= i1; i += step) {
      const dx = this.x[i] - x, dz = this.z[i] - z;
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    return { s: this.s[bi], d: Math.sqrt(best) };
  }
}
