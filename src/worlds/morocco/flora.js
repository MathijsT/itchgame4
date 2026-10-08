// Flora of the Atlas & Sahara world: field-guide entries, where each plant
// grows (density from the site: altitude, slope, water, region...), and its
// low-poly model. Densities are evaluated in terrain workers.

import { MeshBuilder, LIMB, jit } from '../../gfx/meshbuilder.js';
import { smoothstep } from '../../core/noise.js';

const band = (v, a0, a1, b0, b1) => smoothstep(a0, a1, v) * (1 - smoothstep(b0, b1, v));
const notRoad = (s) => (s.road > 0.05 || s.routeD < 7 || s.water > 0.05 || s.pad > 0.55 ? 0 : 1);
const BARK = [0.3, 0.22, 0.16], BARK_GREY = [0.42, 0.38, 0.33];

// ---------- models ----------
// Trunks and branches are smooth-shaded geometry; crowns are clusters of
// alpha-tested foliage cards (see gfx/foliage.js) whose normals point out of
// the crown so they light like a soft volume. LOD 1 uses fewer, larger cards.

const T = { NEEDLE: 0, LEAF: 1, FROND: 2, GRASS: 3, ACACIA: 4, TAMARISK: 5, STRAW: 6, SCALE: 7 };

// One foliage card centred at c, yaw a, tilt t (0 = upright, π/2 = lying flat)
function card(b, c, half, a, t, tile, col, crown) {
  const ux = Math.cos(a), uz = Math.sin(a);
  const vx = -Math.sin(a) * Math.sin(t), vy = Math.cos(t), vz = Math.cos(a) * Math.sin(t);
  const p0 = [c[0] - ux * half - vx * half, c[1] - vy * half, c[2] - uz * half - vz * half];
  const p1 = [c[0] + ux * half - vx * half, c[1] - vy * half, c[2] + uz * half - vz * half];
  const p2 = [c[0] + ux * half + vx * half, c[1] + vy * half, c[2] + uz * half + vz * half];
  const p3 = [c[0] - ux * half + vx * half, c[1] + vy * half, c[2] - uz * half + vz * half];
  let n;
  if (crown) {
    n = [c[0] - crown[0], (c[1] - crown[1]) * 1.3 + 0.35 * crown[3], c[2] - crown[2]];
    const l = Math.hypot(...n) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
  } else n = [0, 1, 0];
  b.card(p0, p1, p2, p3, tile, col, n);
}

// A clump: 2-3 crossed cards (gives volume from every angle)
function clump(b, c, half, tile, col, crown, r, flat = 0.25, count = 2) {
  const a0 = r() * Math.PI;
  for (let k = 0; k < count; k++) card(b, c, half * (0.85 + 0.3 * Math.abs(r())), a0 + (k * Math.PI) / count, flat + r() * 0.35, tile, col, crown);
}

function shade3(c, f) { return [c[0] * f, c[1] * f, c[2] * f]; }

function trunk(b, pts, r0, r1, col, seg = 7) {
  const from = b.mark();
  for (let i = 0; i < pts.length - 1; i++) {
    const t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1);
    b.limbSeg(pts[i], pts[i + 1], r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1, col);
  }
  b.smooth(from, 80);
  void seg;
}

function cedar(lod) {
  const b = new MeshBuilder();
  const r = jit(7);
  const needle = [0.36, 0.47, 0.44], needleDark = [0.24, 0.33, 0.31];
  trunk(b, [[0, -0.3, 0], [0.1, 6, 0.05], [0, 12, 0], [0.05, 16, 0]], 0.75, 0.2, BARK);
  // Atlas cedar's signature: flat tabular tiers of foliage
  const tiers = lod ? [[5.5, 6.2], [9.5, 4.6], [13.5, 2.8]] : [[4.4, 6.6], [6.8, 6.0], [9.0, 5.0], [11.2, 3.9], [13.3, 2.8], [15.2, 1.6]];
  for (const [y, rad] of tiers) {
    const crown = [0, y - 1.5, 0, 1];
    if (!lod) {
      // main limbs reaching each tier
      for (let k = 0; k < 4; k++) {
        const a = k * 1.57 + r() * 0.5;
        b.limbSeg([0, y - 0.6, 0], [Math.cos(a) * rad * 0.8, y - 0.1 + r() * 0.3, Math.sin(a) * rad * 0.8], 0.16, 0.05, BARK);
      }
    }
    const n = lod ? 5 : Math.round(8 + rad * 2.2);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r() * 0.4;
      const d = rad * (0.25 + 0.7 * Math.sqrt(Math.abs(r())));
      const c = [Math.cos(a) * d, y + r() * 0.35, Math.sin(a) * d];
      const col = k % 3 === 0 ? needleDark : needle;
      clump(b, c, lod ? rad * 0.55 : 1.5 + rad * 0.12, T.NEEDLE, col, crown, r, Math.PI / 2 - 0.35, lod ? 1 : 2);
    }
  }
  return b;
}

function holmOak(lod) {
  const b = new MeshBuilder();
  const r = jit(3);
  const leaf = [0.27, 0.36, 0.2], leaf2 = [0.33, 0.42, 0.24];
  trunk(b, [[0, -0.3, 0], [0.2, 2.2, 0.1], [0.1, 3.4, 0]], 0.45, 0.28, BARK_GREY);
  for (let k = 0; k < 4; k++) {
    const a = k * 1.6 + r();
    b.limbSeg([0.1, 3.0, 0], [Math.cos(a) * 2.2, 4.8 + r() * 0.8, Math.sin(a) * 2.2], 0.2, 0.07, BARK_GREY);
  }
  const crown = [0, 5.0, 0, 1];
  const n = lod ? 10 : 46;
  for (let k = 0; k < n; k++) {
    const u = Math.abs(r()), a = r() * Math.PI;
    const d = Math.cbrt(Math.abs(r()));
    const c = [Math.cos(a * 2) * 3.8 * d, 5.0 + (u - 0.35) * 3.6, Math.sin(a * 2) * 3.8 * d];
    clump(b, c, lod ? 2.2 : 1.25, T.LEAF, k % 2 ? leaf : leaf2, crown, r, 0.4);
  }
  return b;
}

function juniper(lod) {
  const b = new MeshBuilder();
  const r = jit(11);
  const leaf = [0.3, 0.38, 0.27], leaf2 = [0.36, 0.43, 0.3];
  trunk(b, [[0, -0.3, 0], [0.5, 1.6, 0.3], [0.1, 3.2, -0.2], [-0.3, 5.2, 0]], 0.6, 0.18, [0.38, 0.28, 0.22]);
  b.limbSeg([0.5, 1.6, 0.3], [1.6, 3.4, 0.8], 0.25, 0.08, [0.38, 0.28, 0.22]);
  const crown = [0, 4.2, 0, 1];
  const n = lod ? 8 : 34;
  for (let k = 0; k < n; k++) {
    const y = 2.0 + Math.abs(r()) * 5.2;
    const rad = 2.4 * (1 - (y - 2) / 6.5) + 0.4;
    const a = r() * Math.PI * 2;
    const c = [Math.cos(a) * rad * Math.abs(r()), y, Math.sin(a) * rad * Math.abs(r())];
    clump(b, c, lod ? 1.6 : 0.95, T.SCALE, k % 2 ? leaf : leaf2, crown, r, 0.3);
  }
  return b;
}

function walnut(lod) {
  const b = new MeshBuilder();
  const r = jit(5);
  const leaf = [0.36, 0.48, 0.22], leaf2 = [0.42, 0.53, 0.26];
  trunk(b, [[0, -0.3, 0], [0.1, 3.5, 0]], 0.5, 0.35, BARK_GREY);
  for (let k = 0; k < 5; k++) {
    const a = k * 1.25 + r() * 0.4;
    b.limbSeg([0, 3.3, 0], [Math.cos(a) * 3.0, 6.5 + r(), Math.sin(a) * 3.0], 0.25, 0.08, BARK_GREY);
  }
  const crown = [0, 7, 0, 1];
  const n = lod ? 10 : 50;
  for (let k = 0; k < n; k++) {
    const d = Math.cbrt(Math.abs(r())), a = r() * Math.PI * 2;
    const c = [Math.cos(a) * 4.8 * d, 7 + r() * 2.6, Math.sin(a) * 4.8 * d];
    clump(b, c, lod ? 2.6 : 1.5, T.LEAF, k % 2 ? leaf : leaf2, crown, r, 0.35);
  }
  return b;
}

function datePalm(lod) {
  const b = new MeshBuilder();
  const r = jit(13);
  const trunkC = [0.46, 0.37, 0.27], trunkDark = [0.36, 0.28, 0.2];
  const frond = [0.42, 0.52, 0.28], frondDry = [0.66, 0.58, 0.38];
  const H = 13;
  const from = b.mark();
  const n = lod ? 3 : 10;
  for (let i = 0; i < n; i++) {
    const y0 = (i / n) * H, y1 = ((i + 1) / n) * H;
    // the persistent leaf bases give the trunk its rough, ringed look
    b.cylinder(0.04 * y0, 0, y0 - (i ? 0 : 0.3), y1, 0.42 - 0.015 * i + (i % 2) * 0.03, 0.4 - 0.015 * i, lod ? 6 : 9, i % 2 ? trunkC : trunkDark, false);
  }
  b.smooth(from, 60);
  const top = [0.04 * H, H, 0];
  const nf = lod ? 7 : 18;
  for (let k = 0; k < nf; k++) {
    const a = (k / nf) * Math.PI * 2 + r() * 0.25;
    const lift = k % 3 === 0 ? 0.9 : 0.25 + 0.25 * Math.abs(r());
    const len = 5.2 + r() * 0.6;
    const ca = Math.cos(a), sa = Math.sin(a);
    const col = k % 6 === 5 ? frondDry : frond;
    // arching frond as two card segments: rising base, drooping tip
    const mid = [top[0] + ca * len * 0.5, top[1] + lift * len * 0.45 + 0.3, top[2] + sa * len * 0.5];
    const end = [top[0] + ca * len, top[1] + lift * len * 0.3 - 1.6, top[2] + sa * len];
    const w = 0.85;
    const px = -sa * w, pz = ca * w;
    b.setLimb(LIMB.FROND, a * 3, top[1], 0);
    const nUp = [ca * 0.4, 1, sa * 0.4];
    b.card([top[0] - px * 0.4, top[1], top[2] - pz * 0.4], [top[0] + px * 0.4, top[1], top[2] + pz * 0.4], [mid[0] + px, mid[1], mid[2] + pz], [mid[0] - px, mid[1], mid[2] - pz], T.FROND, col, nUp);
    b.card([mid[0] - px, mid[1], mid[2] - pz], [mid[0] + px, mid[1], mid[2] + pz], [end[0] + px * 0.3, end[1], end[2] + pz * 0.3], [end[0] - px * 0.3, end[1], end[2] - pz * 0.3], T.FROND, shade3(col, 0.95), nUp);
    b.setLimb();
  }
  if (!lod) {
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3;
      const f = b.mark();
      b.ellipsoid(top[0] + Math.cos(a) * 0.65, H - 1.0, Math.sin(a) * 0.65, 0.35, 0.7, 0.35, [0.72, 0.4, 0.12], 7, 5);
      b.smooth(f, 80);
    }
  }
  return b;
}

function argan(lod) {
  const b = new MeshBuilder();
  const r = jit(17);
  const leaf = [0.3, 0.37, 0.18], leaf2 = [0.36, 0.42, 0.22];
  trunk(b, [[0, -0.3, 0], [0.4, 1.0, 0.2], [0.6, 1.7, 0.3]], 0.5, 0.36, BARK);
  for (const [x, y, z] of [[2.4, 3.0, 0.9], [-1.8, 3.1, -0.6], [0.2, 3.3, -2.1], [0.9, 3.4, 2.0], [-1.0, 3.2, 1.6]]) {
    b.limbSeg([0.6, 1.7, 0.3], [x, y, z], 0.25, 0.08, BARK);
  }
  const crown = [0.3, 3.2, 0, 1];
  const n = lod ? 9 : 40;
  for (let k = 0; k < n; k++) {
    const d = Math.sqrt(Math.abs(r())), a = r() * Math.PI * 2;
    const c = [0.3 + Math.cos(a) * 4.0 * d, 3.6 + r() * 0.8, Math.sin(a) * 3.6 * d];
    clump(b, c, lod ? 2.0 : 1.15, T.LEAF, k % 2 ? leaf : leaf2, crown, r, 0.9);
  }
  return b;
}

function acacia(lod) {
  const b = new MeshBuilder();
  const r = jit(19);
  const leaf = [0.5, 0.54, 0.3], leaf2 = [0.44, 0.49, 0.27];
  trunk(b, [[0, -0.3, 0], [0.25, 1.4, 0.05], [0.2, 2.3, 0]], 0.3, 0.22, BARK_GREY);
  const tips = [[2.4, 4.4, 0.7], [-2.0, 4.3, -0.5], [0.3, 4.5, 2.2], [-0.4, 4.4, -2.3], [1.6, 4.6, -1.6]];
  for (const t of tips) b.limbSeg([0.2, 2.3, 0], t, 0.16, 0.06, BARK_GREY);
  // flat umbrella crown: horizontal cards in two thin layers
  const crown = [0, 3.8, 0, 1];
  const n = lod ? 7 : 34;
  for (let k = 0; k < n; k++) {
    const d = Math.sqrt(Math.abs(r())), a = r() * Math.PI * 2;
    const c = [Math.cos(a) * 4.4 * d, 4.65 + (k % 2) * 0.35 + r() * 0.12, Math.sin(a) * 4.4 * d];
    clump(b, c, lod ? 2.4 : 1.35, T.ACACIA, k % 2 ? leaf : leaf2, crown, r, Math.PI / 2 - 0.12, lod ? 1 : 2);
  }
  return b;
}

function tamarisk(lod) {
  const b = new MeshBuilder();
  const r = jit(23);
  const leaf = [0.58, 0.62, 0.52], leaf2 = [0.64, 0.66, 0.56];
  for (let k = 0; k < 5; k++) {
    const a = k * 1.3 + r();
    b.limbSeg([0, -0.2, 0], [Math.cos(a) * 0.9, 2.0, Math.sin(a) * 0.9], 0.12, 0.05, BARK);
  }
  const crown = [0, 2.2, 0, 1];
  const n = lod ? 6 : 26;
  for (let k = 0; k < n; k++) {
    const d = Math.sqrt(Math.abs(r())), a = r() * Math.PI * 2;
    clump(b, [Math.cos(a) * 1.9 * d, 1.6 + Math.abs(r()) * 2.2, Math.sin(a) * 1.9 * d], lod ? 1.6 : 0.95, T.TAMARISK, k % 2 ? leaf : leaf2, crown, r, 0.1);
  }
  return b;
}

function oleander() {
  const b = new MeshBuilder();
  const r = jit(29);
  const leaf = [0.24, 0.38, 0.2], pink = [0.95, 0.5, 0.65];
  const crown = [0, 1.1, 0, 1];
  for (let k = 0; k < 14; k++) {
    const a = r() * Math.PI * 2, d = Math.abs(r()) * 0.9;
    clump(b, [Math.cos(a) * d, 0.7 + Math.abs(r()) * 1.1, Math.sin(a) * d], 0.6, T.LEAF, leaf, crown, r, 0.2);
  }
  for (let k = 0; k < 16; k++) {
    const a = k * 2.4, d = 0.5 + 0.8 * Math.abs(r());
    const f = b.mark();
    b.ellipsoid(Math.cos(a) * d, 1.6 + r() * 0.4, Math.sin(a) * d, 0.11, 0.08, 0.11, pink, 5, 3);
    b.smooth(f, 90);
  }
  return b;
}

function tussock(col, _unused, h = 0.9, blades = 9) {
  const b = new MeshBuilder();
  const r = jit(31 + blades);
  b.setLimb(LIMB.FROND, 0, 0, 0);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI + r() * 0.3;
    card(b, [0, h * 0.5, 0], h * 0.62, a, 0.05, T.STRAW, col, [0, -h, 0, 0]);
  }
  b.setLimb();
  return b;
}

function calligonum() {
  const b = new MeshBuilder();
  const r = jit(37);
  const stem = [0.5, 0.52, 0.34], wood = [0.45, 0.35, 0.25];
  for (let k = 0; k < 9; k++) {
    const a = k * 0.7 + r() * 0.3;
    const d = 0.6 + 0.5 * r();
    b.limbSeg([0, 0, 0], [Math.cos(a) * d, 1.3 + 0.5 * r(), Math.sin(a) * d], 0.05, 0.02, k % 3 ? stem : wood);
  }
  const crown = [0, 0.9, 0, 1];
  for (let k = 0; k < 8; k++) {
    const a = r() * Math.PI * 2;
    clump(b, [Math.cos(a) * 0.6, 0.9 + Math.abs(r()) * 0.8, Math.sin(a) * 0.6], 0.6, T.TAMARISK, stem, crown, r, 0.15);
  }
  return b;
}

function euphorbia() {
  const b = new MeshBuilder();
  const g = [0.46, 0.53, 0.42], g2 = [0.53, 0.58, 0.45];
  const r = jit(41);
  const from = b.mark();
  for (let k = 0; k < 22; k++) {
    const a = k * 2.399, d = Math.sqrt(k) * 0.2;
    const hgt = 0.75 - d * 0.35 + 0.1 * r();
    b.cylinder(Math.cos(a) * d, Math.sin(a) * d, 0, hgt, 0.075, 0.065, 5, k % 2 ? g : g2, true, [0.78, 0.66, 0.34]);
  }
  b.smooth(from, 75);
  return b;
}

function pricklyPear() {
  const b = new MeshBuilder();
  const g = [0.33, 0.47, 0.24], g2 = [0.38, 0.52, 0.26], fruit = [0.85, 0.32, 0.25];
  const r = jit(43);
  const pad = (x, y, z, ry, rz, s) => {
    b.setTransform(x, y, z, ry, 0, rz);
    const f = b.mark();
    b.ellipsoid(0, 0, 0, 0.32 * s, 0.42 * s, 0.07 * s, r() > 0 ? g : g2, 10, 6);
    b.smooth(f, 85);
    b.ellipsoid(0, 0.43 * s, 0, 0.05, 0.06, 0.05, fruit, 5, 3);
    b.resetTransform();
  };
  pad(0, 0.4, 0, 0, 0, 1.1);
  pad(0.2, 1.1, 0, 0.3, -0.4, 1);
  pad(-0.25, 1.05, 0.1, -0.5, 0.5, 1);
  pad(0.45, 1.75, 0.1, 0.6, -0.6, 0.9);
  pad(-0.4, 1.7, -0.1, 1.2, 0.4, 0.85);
  pad(0.05, 1.85, -0.2, 2.0, 0.1, 0.9);
  return b;
}

function atlasDaisy() {
  const b = new MeshBuilder();
  const leaf = [0.32, 0.44, 0.22], white = [0.96, 0.95, 0.92], red = [0.75, 0.15, 0.15], eye = [0.95, 0.75, 0.1];
  const r = jit(47);
  card(b, [0, 0.12, 0], 0.18, 0, 0.1, T.GRASS, leaf, [0, -0.2, 0, 0]);
  card(b, [0, 0.12, 0], 0.18, 1.57, 0.1, T.GRASS, leaf, [0, -0.2, 0, 0]);
  for (let k = 0; k < 5; k++) {
    const a = k * 1.256 + r() * 0.3, d = 0.14;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    b.cylinder(x, z, 0.12, 0.15, 0.055, 0.05, 8, red, true, white);
    b.cylinder(x, z, 0.15, 0.162, 0.016, 0.012, 6, eye, true, eye);
  }
  return b;
}

function grassClump() {
  const b = new MeshBuilder();
  const r = jit(59);
  b.setLimb(LIMB.FROND, 0, 0, 0);
  for (let k = 0; k < 3; k++) card(b, [r() * 0.15, 0.32, r() * 0.15], 0.38, (k / 3) * Math.PI + r() * 0.3, 0.05, T.GRASS, [0.46, 0.56, 0.28], [0, -0.5, 0, 0]);
  b.setLimb();
  return b;
}

// Boulder: a noise-displaced sphere, smooth-shaded with sharp-ish creases
function boulder(lod) {
  const b = new MeshBuilder();
  const c = [0.86, 0.86, 0.86];
  const from = b.mark();
  b.ellipsoid(0, 0.45, 0, 1.3, 0.95, 1.05, c, lod ? 7 : 12, lod ? 5 : 8);
  const r = jit(53);
  const disp = new Map();
  for (let i = from; i < b.pos.length / 3; i++) {
    const x = b.pos[i * 3], y = b.pos[i * 3 + 1], z = b.pos[i * 3 + 2];
    const k = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
    let d = disp.get(k);
    if (d === undefined) {
      // faceted rock: flatten the base, chip the shape with a few planes
      d = 1 + 0.16 * Math.sin(x * 3.1 + z * 1.7) + 0.1 * Math.sin(y * 5.3 + x * 2.2) + r() * 0.05;
      disp.set(k, d);
    }
    b.pos[i * 3] = x * d; b.pos[i * 3 + 2] = z * d;
    b.pos[i * 3 + 1] = Math.max(0.0, (y - 0.45) * d + 0.45) - 0.05;
  }
  // recompute face normals after displacement, then smooth
  for (let i = from; i < b.pos.length / 3; i += 3) {
    const P = (j) => [b.pos[j * 3], b.pos[j * 3 + 1], b.pos[j * 3 + 2]];
    const A = P(i), B = P(i + 1), C = P(i + 2);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) { b.nrm[(i + k) * 3] = nx; b.nrm[(i + k) * 3 + 1] = ny; b.nrm[(i + k) * 3 + 2] = nz; }
  }
  b.smooth(from, 40);
  return b;
}

// ---------- species ----------
// spacing: jitter grid cell (m); maxP: probability at full suitability
// collide: trunk radius at scale 1 (m) for vehicle collisions
// range: draw distance (m); farRange: distance for the low LOD model

export const FLORA = [
  {
    id: 'cedar', name: 'Atlas cedar', latin: 'Cedrus atlantica', kind: 'tree',
    fact: 'Endemic to the Atlas of Morocco and Algeria and now endangered. Its flat, layered tiers shed snow, and individuals can live for over a thousand years.',
    spacing: 11, maxP: 0.75, scale: [0.75, 1.35], collide: 0.75, range: 300, farRange: 1400, sway: 0.25,
    density: (s) => notRoad(s) * (s.wMid + s.wHigh * (1 - smoothstep(7500, 9500, s.zw))) * band(s.h, 1420, 1560, 2500, 2750)
      * smoothstep(-0.45, 0.05, s.clump1) * (1 - smoothstep(0.35, 0.6, s.slope)),
    model: cedar,
  },
  {
    id: 'holmoak', name: 'Holm oak', latin: 'Quercus rotundifolia', kind: 'tree',
    fact: 'An evergreen oak with leathery, holly-like leaves. Its sweet acorns feed Barbary macaques and wild boar through the Atlas winter.',
    spacing: 9, maxP: 0.4, scale: [0.7, 1.25], collide: 0.45, range: 240, farRange: 950, sway: 0.35,
    density: (s) => notRoad(s) * (s.wMid + s.wHigh * 0.5) * band(s.h, 1200, 1350, 2000, 2250) * smoothstep(-0.6, -0.1, s.clump1) * (1 - smoothstep(0.4, 0.65, s.slope)),
    model: holmOak,
  },
  {
    id: 'juniper', name: 'Thurifer juniper', latin: 'Juniperus thurifera', kind: 'tree',
    fact: 'The highest-growing tree of the High Atlas, surviving to about 3,100 m. Gnarled, centuries-old junipers are often pollarded by Amazigh herders for fodder.',
    spacing: 15, maxP: 0.22, scale: [0.6, 1.3], collide: 0.5, range: 280, farRange: 1100, sway: 0.2,
    density: (s) => notRoad(s) * s.wHigh * band(s.h, 1850, 2100, 2950, 3200) * (1 - smoothstep(0.45, 0.7, s.slope)) * smoothstep(-0.7, 0.2, s.clump2),
    model: juniper,
  },
  {
    id: 'walnut', name: 'Walnut', latin: 'Juglans regia', kind: 'tree',
    fact: 'Planted for centuries along irrigated mountain valleys, walnuts shade the terraced barley fields of High Atlas villages.',
    spacing: 13, maxP: 0.5, scale: [0.8, 1.2], collide: 0.5, range: 240, farRange: 900, sway: 0.4,
    density: (s) => notRoad(s) * (s.wHigh + s.wMid * 0.3) * (1 - smoothstep(25, 260, s.riverD)) * (1 - smoothstep(2200, 2500, s.h)),
    model: walnut,
  },
  {
    id: 'palm', name: 'Date palm', latin: 'Phoenix dactylifera', kind: 'tree',
    fact: '"Feet in the water, head in the fire": date palms need groundwater at their roots and fierce heat to ripen fruit. The Draa valley holds one of the largest palm groves in the world.',
    spacing: 8, maxP: 0.7, scale: [0.75, 1.3], collide: 0.45, range: 320, farRange: 1300, sway: 0.5,
    density: (s) => (s.road > 0.05 || s.routeD < 7 || s.water > 0.05 || s.pad > 0.75 ? 0 : 1)
      * (s.wPre + s.wHam * 0.8 + s.wErg * 0.5)
      * Math.max(1 - smoothstep(20, 380, s.riverD), s.oued * 0.55, band(s.pad, 0.05, 0.2, 0.6, 0.8) * 0.8)
      * smoothstep(-0.6, 0.0, s.clump1),
    model: datePalm,
  },
  {
    id: 'argan', name: 'Argan tree', latin: 'Argania spinosa', kind: 'tree',
    fact: 'Found wild only in south-west Morocco. Its thorny branches hold the nuts pressed for argan oil, and goats famously climb into the canopy to eat the fruit.',
    spacing: 16, maxP: 0.35, scale: [0.8, 1.25], collide: 0.45, range: 260, farRange: 1000, sway: 0.2,
    density: (s) => notRoad(s) * s.wPre * (1 - smoothstep(-500, 1500, s.x)) * band(s.h, 1050, 1150, 1650, 1800) * (1 - smoothstep(0.4, 0.6, s.slope)) * (1 - s.river),
    model: argan,
  },
  {
    id: 'acacia', name: 'Umbrella thorn acacia', latin: 'Vachellia tortilis raddiana', kind: 'tree',
    fact: 'The emblematic tree of Saharan wadis. Its roots chase groundwater tens of metres down, and its flat crown is often the only shade for a day\'s travel.',
    spacing: 19, maxP: 0.55, scale: [0.7, 1.3], collide: 0.3, range: 320, farRange: 1400, sway: 0.25,
    density: (s) => notRoad(s) * (s.wHam + s.wPre * 0.35 + s.wErg * 0.25) * (0.06 + 0.9 * s.oued + 0.3 * (1 - smoothstep(50, 500, s.riverD))) * (1 - smoothstep(0.3, 0.5, s.duneRel)),
    model: acacia,
  },
  {
    id: 'tamarisk', name: 'Tamarisk', latin: 'Tamarix aphylla', kind: 'shrub',
    fact: 'Tolerates salty groundwater by excreting salt through its leaves. Planted as living windbreaks to stop dunes burying oasis gardens.',
    spacing: 13, maxP: 0.35, scale: [0.7, 1.3], collide: 0.3, range: 220, farRange: 650, sway: 0.5,
    density: (s) => notRoad(s) * (s.wPre * 0.6 + s.wHam + s.wErg * 0.7) * Math.max(s.oued, 1 - smoothstep(10, 160, s.riverD), s.wErg * band(s.zw, 25000, 25800, 27000, 28500) * 0.4) * (1 - smoothstep(0.35, 0.55, s.duneRel)),
    model: tamarisk,
  },
  {
    id: 'oleander', name: 'Oleander', latin: 'Nerium oleander', kind: 'shrub',
    fact: 'Lines riverbeds that flow only part of the year; its pink flowers are a sure sign of water below. Every part of the plant is highly toxic.',
    spacing: 5, maxP: 0.55, scale: [0.8, 1.3], range: 180, sway: 0.4,
    density: (s) => notRoad(s) * (s.wMid * 0.4 + s.wHigh + s.wPre) * band(s.riverD, 3, 8, 22, 40) * (1 - smoothstep(2300, 2600, s.h)),
    model: oleander,
  },
  {
    id: 'esparto', name: 'Esparto grass', latin: 'Macrochloa tenacissima', kind: 'grass',
    fact: 'Also called halfa. These tough tussocks bind the soils of the steppes and have been woven into baskets, mats and rope for millennia.',
    spacing: 3.2, maxP: 0.55, scale: [0.7, 1.3], range: 150, sway: 1.0,
    density: (s) => notRoad(s) * (s.wHigh * (1 - smoothstep(2400, 2800, s.h)) + s.wPre + s.wHam * 0.4) * (1 - smoothstep(0.45, 0.7, s.slope)) * smoothstep(-0.5, 0.2, s.clump2),
    model: () => tussock([0.74, 0.68, 0.46], null, 0.9, 11),
  },
  {
    id: 'drinn', name: 'Drinn grass', latin: 'Stipagrostis pungens', kind: 'grass',
    fact: 'One of the few plants that can live on moving dunes: its roots run many metres through the sand and it keeps growing upward as sand buries it.',
    spacing: 7, maxP: 0.35, scale: [0.7, 1.5], range: 160, sway: 1.0,
    density: (s) => notRoad(s) * s.wErg * (1 - smoothstep(0.35, 0.7, s.duneRel)) * smoothstep(-0.3, 0.4, s.clump2),
    model: () => tussock([0.8, 0.74, 0.52], null, 1.1, 13),
  },
  {
    id: 'calligonum', name: 'Calligonum', latin: 'Calligonum comosum', kind: 'shrub',
    fact: 'A nearly leafless dune shrub: photosynthesis happens in its green twigs, cutting water loss in the heat. Camels browse it and nomads burn its wood.',
    spacing: 16, maxP: 0.2, scale: [0.7, 1.3], range: 220, sway: 0.6,
    density: (s) => notRoad(s) * (s.wErg + s.wHam * 0.25) * (1 - smoothstep(0.4, 0.8, s.duneRel)),
    model: calligonum,
  },
  {
    id: 'euphorbia', name: 'Resin spurge', latin: 'Euphorbia resinifera', kind: 'succulent',
    fact: 'A cactus-like cushion found only in Morocco. Its latex contains resiniferatoxin, one of the most pungent substances known, thousands of times hotter than pure capsaicin.',
    spacing: 9, maxP: 0.2, scale: [0.8, 1.6], range: 150,
    density: (s) => notRoad(s) * (s.wHigh * smoothstep(9500, 11000, s.zw) + s.wPre * 0.6) * band(s.h, 1150, 1300, 2100, 2300) * smoothstep(0.08, 0.25, s.slope),
    model: euphorbia,
  },
  {
    id: 'opuntia', name: 'Prickly pear', latin: 'Opuntia ficus-indica', kind: 'succulent',
    fact: 'Brought from the Americas centuries ago, it is planted as a living fence around villages. Its fruit, "hendia", is sold from carts in summer.',
    spacing: 5, maxP: 0.45, scale: [0.8, 1.3], range: 200,
    density: (s) => (s.road > 0.05 || s.routeD < 7 ? 0 : 1) * (1 - s.wErg) * band(s.pad, 0.08, 0.2, 0.45, 0.6),
    model: pricklyPear,
  },
  {
    id: 'daisy', name: 'Mount Atlas daisy', latin: 'Anacyclus pyrethrum', kind: 'flower',
    fact: 'A Moroccan endemic of mountain pastures. Its white flowers are red underneath and close at night; its root has long been used in traditional medicine.',
    spacing: 3, maxP: 0.3, scale: [0.8, 1.4], range: 70,
    density: (s) => notRoad(s) * (s.wMid + s.wHigh * band(s.h, 1600, 1800, 2700, 3000)) * smoothstep(0.0, 0.5, -s.clump1) * (1 - smoothstep(0.3, 0.5, s.slope)) * (1 - s.dSnow),
    model: atlasDaisy,
  },
  {
    id: 'grass', name: 'Mountain grasses', latin: 'Festuca spp.', kind: 'grass', hidden: true,
    spacing: 2.6, maxP: 0.55, scale: [0.7, 1.4], range: 90, sway: 1.0,
    density: (s) => notRoad(s) * (s.wMid + s.wHigh * (1 - smoothstep(2200, 2700, s.h))) * smoothstep(-0.2, 0.4, -s.clump1 + 0.2) * (1 - s.dSnow) * (1 - smoothstep(0.4, 0.6, s.slope)),
    model: grassClump,
  },
  {
    id: 'boulder', name: 'Boulders', latin: '', kind: 'rock', hidden: true,
    spacing: 12, maxP: 0.5, scale: [0.4, 2.4], collide: 1.0, range: 250, farRange: 700, rockTint: true,
    density: (s) => notRoad(s) * (smoothstep(0.25, 0.5, s.slope) * 0.25 + s.wHam * 0.06 + s.wHigh * 0.14 + s.wPre * 0.07 + s.mesa * 0.03) * (1 - s.wErg * 0.9),
    model: boulder,
  },
];
