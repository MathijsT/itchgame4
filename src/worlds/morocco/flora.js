// Flora of the Atlas & Sahara world: field-guide entries, where each plant
// grows (density from the site: altitude, slope, water, region...), and its
// low-poly model. Densities are evaluated in terrain workers.

import { MeshBuilder, LIMB, jit, shade } from '../../gfx/meshbuilder.js';
import { smoothstep } from '../../core/noise.js';

const band = (v, a0, a1, b0, b1) => smoothstep(a0, a1, v) * (1 - smoothstep(b0, b1, v));
const notRoad = (s) => (s.road > 0.05 || s.routeD < 7 || s.water > 0.05 || s.pad > 0.55 ? 0 : 1);
const BARK = [0.3, 0.22, 0.16], BARK_GREY = [0.42, 0.38, 0.33];

// ---------- models ----------

function cedar(lod) {
  const b = new MeshBuilder();
  const needle = [0.2, 0.31, 0.28], needleLight = [0.27, 0.39, 0.34];
  b.cylinder(0, 0, 0, 14, 0.75, 0.35, lod ? 4 : 7, BARK, false);
  if (lod) {
    b.cylinder(0, 0, 4, 9, 5.5, 3.6, 5, needle, true, needleLight);
    b.cone(0, 0, 9, 15, 4, 5, needle);
    return b;
  }
  // the Atlas cedar's signature: flat, layered tiers of foliage
  const r = jit(7);
  const tiers = [[4.2, 6.2], [7.0, 5.4], [9.6, 4.4], [12.0, 3.2], [14.0, 1.8]];
  for (const [y, rad] of tiers) {
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + r();
      const ox = Math.cos(a) * rad * 0.35, oz = Math.sin(a) * rad * 0.35;
      b.ellipsoid(ox, y, oz, rad * (0.75 + 0.15 * r()), 0.9, rad * (0.75 + 0.15 * r()), k === 0 ? needleLight : needle, 7, 3);
    }
  }
  b.cone(0, 0, 13, 16.5, 1.2, 6, needle);
  return b;
}

function holmOak(lod) {
  const b = new MeshBuilder();
  const leaf = [0.17, 0.24, 0.12], leaf2 = [0.22, 0.29, 0.14];
  b.cylinder(0, 0, 0, 3.2, 0.45, 0.3, lod ? 3 : 5, BARK_GREY, false);
  if (lod) { b.ellipsoid(0, 5, 0, 4.2, 3.2, 4.2, leaf, 5, 3); return b; }
  const r = jit(3);
  b.ellipsoid(0, 5.2, 0, 3.6, 2.8, 3.6, leaf, 8, 5);
  for (let k = 0; k < 4; k++) {
    const a = k * 1.57 + r() * 0.5;
    b.ellipsoid(Math.cos(a) * 2.4, 4.4 + r() * 0.6, Math.sin(a) * 2.4, 2.2, 1.9, 2.2, k % 2 ? leaf2 : leaf, 6, 4);
  }
  return b;
}

function juniper(lod) {
  const b = new MeshBuilder();
  const leaf = [0.19, 0.27, 0.17], leaf2 = [0.25, 0.32, 0.2];
  b.limbSeg([0, 0, 0], [0.4, 2.5, 0.2], 0.55, 0.35, BARK);
  b.limbSeg([0.4, 2.5, 0.2], [-0.3, 5, 0], 0.35, 0.2, BARK);
  if (lod) { b.cylinder(0, 0, 2, 8, 2.8, 0.8, 5, leaf); return b; }
  const r = jit(11);
  for (let k = 0; k < 6; k++) {
    const y = 2.5 + k * 0.95;
    const rad = 2.6 - k * 0.3;
    b.ellipsoid(r() * 0.8, y, r() * 0.8, rad, 1.1, rad * (0.8 + 0.2 * r()), k % 2 ? leaf : leaf2, 6, 3);
  }
  return b;
}

function walnut(lod) {
  const b = new MeshBuilder();
  const leaf = [0.25, 0.37, 0.14], leaf2 = [0.3, 0.42, 0.17];
  b.cylinder(0, 0, 0, 4, 0.5, 0.35, 6, BARK_GREY, false);
  if (lod) { b.ellipsoid(0, 6.5, 0, 5.5, 3.8, 5.5, leaf, 5, 3); return b; }
  const r = jit(5);
  b.limbSeg([0, 3.5, 0], [2, 6, 0.5], 0.3, 0.15, BARK_GREY);
  b.limbSeg([0, 3.5, 0], [-1.8, 6, -0.6], 0.3, 0.15, BARK_GREY);
  b.ellipsoid(0, 7, 0, 4.4, 3.2, 4.4, leaf, 8, 5);
  for (let k = 0; k < 5; k++) {
    const a = k * 1.25 + r() * 0.4;
    b.ellipsoid(Math.cos(a) * 3.3, 6 + r(), Math.sin(a) * 3.3, 2.5, 2, 2.5, k % 2 ? leaf2 : leaf, 6, 4);
  }
  return b;
}

function datePalm(lod) {
  const b = new MeshBuilder();
  const trunk = [0.42, 0.33, 0.24], trunkDark = [0.33, 0.25, 0.18];
  const frond = [0.3, 0.42, 0.17], frondDry = [0.55, 0.5, 0.3];
  const H = 13;
  // slightly leaning, ringed trunk
  for (let i = 0; i < (lod ? 2 : 6); i++) {
    const n = lod ? 2 : 6;
    const y0 = (i / n) * H, y1 = ((i + 1) / n) * H;
    b.cylinder(0.04 * y0, 0, y0, y1, 0.42 - 0.02 * i, 0.38 - 0.02 * i, lod ? 5 : 7, i % 2 ? trunk : trunkDark, false);
  }
  const top = [0.04 * H, H, 0];
  const nf = lod ? 5 : 14;
  const r = jit(13);
  for (let k = 0; k < nf; k++) {
    const a = (k / nf) * Math.PI * 2 + r() * 0.2;
    const up = k % 3 === 0 ? 0.55 : 0.15 + 0.1 * r();
    const len = 4.8 + r() * 0.6;
    const ca = Math.cos(a), sa = Math.sin(a);
    const mid = [top[0] + ca * len * 0.5, top[1] + up * len * 0.6 + 0.4, top[2] + sa * len * 0.5];
    const end = [top[0] + ca * len, top[1] + up * len * 0.4 - 1.6, top[2] + sa * len];
    const w = 0.7;
    const px = -sa * w, pz = ca * w;
    const col = k % 5 === 4 ? frondDry : frond;
    b.setLimb(LIMB.FROND, a * 3, top[1], 0);
    b.tri(top, [mid[0] + px, mid[1], mid[2] + pz], [mid[0] - px, mid[1], mid[2] - pz], col);
    b.tri([mid[0] + px, mid[1], mid[2] + pz], end, [mid[0] - px, mid[1], mid[2] - pz], col);
    // underside so fronds are visible from below
    b.tri(top, [mid[0] - px, mid[1] - 0.05, mid[2] - pz], [mid[0] + px, mid[1] - 0.05, mid[2] + pz], shade(col, 0.8));
    b.tri([mid[0] - px, mid[1] - 0.05, mid[2] - pz], end, [mid[0] + px, mid[1] - 0.05, mid[2] + pz], shade(col, 0.8));
    b.setLimb();
  }
  if (!lod) {
    // date clusters
    for (let k = 0; k < 4; k++) {
      const a = k * 1.6;
      b.ellipsoid(top[0] + Math.cos(a) * 0.6, H - 0.8, Math.sin(a) * 0.6, 0.35, 0.6, 0.35, [0.75, 0.42, 0.12], 5, 3);
    }
  }
  return b;
}

function argan(lod) {
  const b = new MeshBuilder();
  const leaf = [0.24, 0.3, 0.12], leaf2 = [0.3, 0.35, 0.15];
  b.limbSeg([0, 0, 0], [0.6, 1.6, 0.3], 0.5, 0.4, BARK);
  b.limbSeg([0.6, 1.6, 0.3], [2.2, 3.0, 0.8], 0.3, 0.15, BARK);
  b.limbSeg([0.6, 1.6, 0.3], [-1.6, 3.1, -0.5], 0.3, 0.15, BARK);
  b.limbSeg([0.6, 1.6, 0.3], [0.2, 3.2, -1.9], 0.25, 0.12, BARK);
  if (lod) { b.ellipsoid(0.3, 3.7, 0, 4.2, 1.6, 3.8, leaf, 5, 3); return b; }
  const r = jit(17);
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9 + r() * 0.3;
    const d = k === 0 ? 0 : 2.6;
    b.ellipsoid(0.3 + Math.cos(a) * d, 3.6 + r() * 0.5, Math.sin(a) * d, 2.2, 1.1, 2.2, k % 2 ? leaf2 : leaf, 6, 3);
  }
  return b;
}

function acacia(lod) {
  const b = new MeshBuilder();
  const leaf = [0.42, 0.45, 0.24], leaf2 = [0.36, 0.4, 0.2];
  b.limbSeg([0, 0, 0], [0.2, 2.2, 0], 0.28, 0.22, BARK_GREY);
  b.limbSeg([0.2, 2.2, 0], [2.0, 4.4, 0.6], 0.18, 0.1, BARK_GREY);
  b.limbSeg([0.2, 2.2, 0], [-1.7, 4.3, -0.4], 0.18, 0.1, BARK_GREY);
  b.limbSeg([0.2, 2.2, 0], [0.3, 4.5, 1.8], 0.15, 0.08, BARK_GREY);
  // the classic flat-topped umbrella crown
  if (lod) { b.ellipsoid(0, 4.7, 0, 4.4, 0.6, 4.4, leaf, 6, 2); return b; }
  const r = jit(19);
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05 + r() * 0.3;
    const d = k === 0 ? 0 : 2.5;
    b.ellipsoid(Math.cos(a) * d, 4.7 + r() * 0.2, Math.sin(a) * d, 2.4, 0.45, 2.4, k % 2 ? leaf2 : leaf, 7, 2);
  }
  return b;
}

function tamarisk(lod) {
  const b = new MeshBuilder();
  const leaf = [0.47, 0.52, 0.42], leaf2 = [0.55, 0.57, 0.48];
  const r = jit(23);
  for (let k = 0; k < (lod ? 2 : 5); k++) {
    const a = k * 1.3 + r();
    const x = Math.cos(a) * 1.2, z = Math.sin(a) * 1.2;
    if (!lod) b.limbSeg([0, 0, 0], [x * 0.8, 1.6, z * 0.8], 0.12, 0.08, BARK);
    b.ellipsoid(x, 2.4 + r() * 0.5, z, 1.7, 1.6, 1.7, k % 2 ? leaf : leaf2, 6, 4);
  }
  return b;
}

function oleander() {
  const b = new MeshBuilder();
  const leaf = [0.16, 0.3, 0.14], pink = [0.92, 0.45, 0.6];
  const r = jit(29);
  for (let k = 0; k < 4; k++) {
    const a = k * 1.6 + r();
    b.ellipsoid(Math.cos(a) * 0.8, 1.1 + r() * 0.3, Math.sin(a) * 0.8, 1.0, 0.9, 1.0, leaf, 6, 3);
  }
  for (let k = 0; k < 12; k++) {
    const a = k * 2.4, d = 0.6 + 0.9 * Math.abs(r());
    b.box(Math.cos(a) * d, 1.6 + r() * 0.5, Math.sin(a) * d, 0.12, 0.12, 0.12, pink);
  }
  return b;
}

function tussock(colA, colB, h = 0.9, blades = 9) {
  const b = new MeshBuilder();
  const r = jit(31);
  for (let k = 0; k < blades; k++) {
    const a = (k / blades) * Math.PI * 2;
    const lean = 0.35 + 0.15 * r();
    const tip = [Math.cos(a) * lean * h, h * (0.8 + 0.3 * r()), Math.sin(a) * lean * h];
    const w = 0.07;
    b.setLimb(LIMB.FROND, a, 0, 0);
    b.tri([-Math.sin(a) * w, 0, Math.cos(a) * w], [Math.sin(a) * w, 0, -Math.cos(a) * w], tip, k % 2 ? colA : colB);
    b.tri([Math.sin(a) * w, 0, -Math.cos(a) * w], [-Math.sin(a) * w, 0, Math.cos(a) * w], tip, k % 2 ? colA : colB);
  }
  b.setLimb();
  return b;
}

function calligonum() {
  const b = new MeshBuilder();
  const stem = [0.45, 0.48, 0.3], wood = [0.45, 0.35, 0.25];
  const r = jit(37);
  for (let k = 0; k < 9; k++) {
    const a = k * 0.7 + r() * 0.3;
    const d = 0.6 + 0.5 * r();
    b.limbSeg([0, 0, 0], [Math.cos(a) * d, 1.3 + 0.5 * r(), Math.sin(a) * d], 0.06, 0.03, k % 3 ? stem : wood);
  }
  b.ellipsoid(0, 1.1, 0, 1.0, 0.6, 1.0, [0.5, 0.5, 0.33], 5, 3);
  return b;
}

function euphorbia() {
  const b = new MeshBuilder();
  const g = [0.42, 0.5, 0.38], g2 = [0.5, 0.56, 0.42];
  const r = jit(41);
  for (let k = 0; k < 16; k++) {
    const a = k * 2.399, d = Math.sqrt(k) * 0.22;
    const hgt = 0.7 - d * 0.35 + 0.1 * r();
    b.cylinder(Math.cos(a) * d, Math.sin(a) * d, 0, hgt, 0.08, 0.07, 4, k % 2 ? g : g2, true, [0.75, 0.62, 0.3]);
  }
  return b;
}

function pricklyPear() {
  const b = new MeshBuilder();
  const g = [0.3, 0.45, 0.2], g2 = [0.36, 0.5, 0.22], fruit = [0.85, 0.3, 0.25];
  const r = jit(43);
  const pad = (x, y, z, ry, rz, s) => {
    b.setTransform(x, y, z, ry, 0, rz);
    b.ellipsoid(0, 0, 0, 0.32 * s, 0.42 * s, 0.07 * s, r() > 0 ? g : g2, 6, 3);
    b.box(0, 0.42 * s, 0, 0.05, 0.05, 0.05, fruit);
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
  const leaf = [0.3, 0.42, 0.2], white = [0.95, 0.94, 0.9], red = [0.75, 0.15, 0.15], eye = [0.95, 0.75, 0.1];
  const r = jit(47);
  b.ellipsoid(0, 0.04, 0, 0.25, 0.06, 0.25, leaf, 6, 2);
  for (let k = 0; k < 5; k++) {
    const a = k * 1.256 + r() * 0.3, d = 0.18;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    // prostrate flower heads: white rays, red undersides, yellow disc
    b.cylinder(x, z, 0.05, 0.08, 0.08, 0.075, 6, red, true, white);
    b.box(x, 0.085, z, 0.025, 0.01, 0.025, eye);
  }
  return b;
}

function grassClump() {
  return tussock([0.36, 0.45, 0.2], [0.42, 0.5, 0.24], 0.45, 7);
}

function boulder(lod) {
  const b = new MeshBuilder();
  const r = jit(53);
  const c = [0.85, 0.85, 0.85], c2 = [0.75, 0.75, 0.75];
  b.ellipsoid(0, 0.5, 0, 1.3, 0.95, 1.0, c, lod ? 5 : 6, lod ? 3 : 4, (i, j) => ((i + j) % 2 ? c : c2));
  if (!lod) b.ellipsoid(0.8 + r() * 0.2, 0.3, 0.4, 0.7, 0.5, 0.6, c2, 5, 3);
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
    spacing: 4, maxP: 0.45, scale: [0.7, 1.3], range: 130, sway: 1.0,
    density: (s) => notRoad(s) * (s.wHigh * (1 - smoothstep(2400, 2800, s.h)) + s.wPre + s.wHam * 0.4) * (1 - smoothstep(0.45, 0.7, s.slope)) * smoothstep(-0.5, 0.2, s.clump2),
    model: () => tussock([0.72, 0.66, 0.42], [0.62, 0.58, 0.36], 0.9, 11),
  },
  {
    id: 'drinn', name: 'Drinn grass', latin: 'Stipagrostis pungens', kind: 'grass',
    fact: 'One of the few plants that can live on moving dunes: its roots run many metres through the sand and it keeps growing upward as sand buries it.',
    spacing: 7, maxP: 0.35, scale: [0.7, 1.5], range: 160, sway: 1.0,
    density: (s) => notRoad(s) * s.wErg * (1 - smoothstep(0.35, 0.7, s.duneRel)) * smoothstep(-0.3, 0.4, s.clump2),
    model: () => tussock([0.78, 0.72, 0.5], [0.66, 0.64, 0.42], 1.1, 13),
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
    density: (s) => notRoad(s) * (smoothstep(0.25, 0.5, s.slope) * 0.25 + s.wHam * 0.06 + s.wHigh * 0.05 + s.wPre * 0.05 + s.mesa * 0.03) * (1 - s.wErg * 0.9),
    model: boulder,
  },
];
