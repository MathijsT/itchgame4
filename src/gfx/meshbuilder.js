// Procedural low-poly mesh construction (flat shaded). Pure JS, no GL, so it
// can also be imported by workers. A mesh is a set of growable arrays:
//   pos (xyz), nrm (xyz), col (rgb), limb (type, phaseOffset, pivotY, pivotH)
// `limb` drives vertex animation of legs, wings, heads and tails in the shader.

export const LIMB = { NONE: 0, LEG: 1, WING: 2, HEAD: 3, TAIL: 4, FROND: 5 };

export class MeshBuilder {
  constructor() {
    this.pos = []; this.nrm = []; this.col = []; this.limb = [];
    this.curLimb = [0, 0, 0, 0];
    this.m = null; // current 3x4 transform (row-major [r00 r01 r02 tx, ...])
  }

  setLimb(type = 0, phase = 0, pivotY = 0, pivotH = 0) { this.curLimb = [type, phase, pivotY, pivotH]; return this; }

  // Transform helpers: compose translate * rotY * rotX * rotZ * scale
  setTransform(tx = 0, ty = 0, tz = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const cy = Math.cos(ry), sy_ = Math.sin(ry), cx = Math.cos(rx), sx_ = Math.sin(rx), cz = Math.cos(rz), sz_ = Math.sin(rz);
    // R = Ry * Rx * Rz
    const r00 = cy * cz + sy_ * sx_ * sz_, r01 = -cy * sz_ + sy_ * sx_ * cz, r02 = sy_ * cx;
    const r10 = cx * sz_, r11 = cx * cz, r12 = -sx_;
    const r20 = -sy_ * cz + cy * sx_ * sz_, r21 = sy_ * sz_ + cy * sx_ * cz, r22 = cy * cx;
    this.m = [r00 * sx, r01 * sy, r02 * sz, tx, r10 * sx, r11 * sy, r12 * sz, ty, r20 * sx, r21 * sy, r22 * sz, tz];
    this.rot = [r00, r01, r02, r10, r11, r12, r20, r21, r22];
    this.scl = [sx, sy, sz];
    return this;
  }
  resetTransform() { this.m = null; return this; }

  _tp(x, y, z) {
    const m = this.m;
    if (!m) return [x, y, z];
    return [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
  }

  // Add a triangle (already-transformed points), flat normal.
  triW(a, b, c, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const L = this.curLimb;
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(nx, ny, nz);
      this.col.push(col[0], col[1], col[2]);
      this.limb.push(L[0], L[1], L[2], L[3]);
    }
  }
  tri(a, b, c, col) { this.triW(this._tp(...a), this._tp(...b), this._tp(...c), col); }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }

  // Axis-aligned box centred at (x,y,z) with half sizes, under current transform.
  box(x, y, z, hx, hy, hz, col, colTop = col) {
    const p = (i, j, k) => [x + i * hx, y + j * hy, z + k * hz];
    this.quad(p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), colTop); // top
    this.quad(p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), col); // bottom
    this.quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), col); // +z
    this.quad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), col); // -z
    this.quad(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), col); // +x
    this.quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), col); // -x
    return this;
  }

  // Tapered box: bottom half-size (hx0,hz0), top half-size (hx1,hz1), from y0 to y1
  taper(x, z, y0, y1, hx0, hz0, hx1, hz1, col, colTop = col) {
    const b = (i, k) => [x + i * hx0, y0, z + k * hz0];
    const t = (i, k) => [x + i * hx1, y1, z + k * hz1];
    this.quad(t(-1, -1), t(-1, 1), t(1, 1), t(1, -1), colTop);
    this.quad(b(-1, 1), b(1, 1), t(1, 1), t(-1, 1), col);
    this.quad(b(1, -1), b(-1, -1), t(-1, -1), t(1, -1), col);
    this.quad(b(1, 1), b(1, -1), t(1, -1), t(1, 1), col);
    this.quad(b(-1, -1), b(-1, 1), t(-1, 1), t(-1, -1), col);
    return this;
  }

  // Vertical frustum/cylinder along +y from y0 to y1
  cylinder(x, z, y0, y1, r0, r1, seg, col, caps = true, colTop = col) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p0 = [x + c0 * r0, y0, z + s0 * r0], p1 = [x + c1 * r0, y0, z + s1 * r0];
      const q0 = [x + c0 * r1, y1, z + s0 * r1], q1 = [x + c1 * r1, y1, z + s1 * r1];
      if (r1 > 0.0001) this.quad(p0, q0, q1, p1, col); else this.tri(p0, q0, p1, col);
      if (caps) {
        if (r1 > 0.0001) this.tri([x, y1, z], q1, q0, colTop);
        if (r0 > 0.0001) this.tri([x, y0, z], p0, p1, col);
      }
    }
    return this;
  }

  cone(x, z, y0, y1, r, seg, col) { return this.cylinder(x, z, y0, y1, r, 0, seg, col, true); }

  // Low-poly ellipsoid (UV sphere)
  ellipsoid(x, y, z, rx, ry, rz, col, seg = 6, rings = 4, colFn = null) {
    const P = (i, j) => {
      const th = (j / rings) * Math.PI, ph = (i / seg) * Math.PI * 2;
      return [x + Math.sin(th) * Math.cos(ph) * rx, y + Math.cos(th) * ry, z + Math.sin(th) * Math.sin(ph) * rz];
    };
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const c = colFn ? colFn(i, j) : col;
        const a = P(i, j), b = P(i + 1, j), cc = P(i + 1, j + 1), d = P(i, j + 1);
        if (j === 0) this.tri(a, cc, d, c);
        else if (j === rings - 1) this.tri(a, b, cc, c);
        else this.quad(a, b, cc, d, c);
      }
    }
    return this;
  }

  // Limb between two points as a thin tapered prism (4 sides)
  limbSeg(a, b, r0, r1, col) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const d = [dx / len, dy / len, dz / len];
    // perpendicular basis
    let u = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let px = d[1] * u[2] - d[2] * u[1], py = d[2] * u[0] - d[0] * u[2], pz = d[0] * u[1] - d[1] * u[0];
    let l = Math.hypot(px, py, pz); px /= l; py /= l; pz /= l;
    const qx = d[1] * pz - d[2] * py, qy = d[2] * px - d[0] * pz, qz = d[0] * py - d[1] * px;
    const ring = (c, r) => [0, 1, 2, 3].map((k) => {
      const an = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const cs = Math.cos(an) * r, sn = Math.sin(an) * r;
      return [c[0] + px * cs + qx * sn, c[1] + py * cs + qy * sn, c[2] + pz * cs + qz * sn];
    });
    const A = ring(a, r0), B = ring(b, r1);
    for (let k = 0; k < 4; k++) {
      const k1 = (k + 1) % 4;
      this.quad(A[k], A[k1], B[k1], B[k], col);
    }
    this.tri(B[0], B[1], B[2], col); this.tri(B[0], B[2], B[3], col);
    return this;
  }

  merge(other) {
    this.pos.push(...other.pos); this.nrm.push(...other.nrm); this.col.push(...other.col); this.limb.push(...other.limb);
    return this;
  }

  get vertexCount() { return this.pos.length / 3; }

  build() {
    return {
      pos: new Float32Array(this.pos),
      nrm: new Float32Array(this.nrm),
      col: new Float32Array(this.col),
      limb: new Float32Array(this.limb),
      count: this.pos.length / 3,
    };
  }
}

// Seeded jitter helper for organic shapes
export function jit(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

export function shade(c, f) { return [c[0] * f, c[1] * f, c[2] * f]; }
export function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
