// Procedural rally-raid prototype (T1-style 4x4) and its wheels.
// Body frame: +z forward, +y up, origin at the centre of mass (ground ≈ -0.75).
// The limb attribute's x component carries a material id for the object shader:
//   0 paint (clear-coat)  1 glass  2 rubber  3 matte plastic  4 head lamp
//   5 metal  6 tail lamp  7 matte decal

import { MeshBuilder } from '../gfx/meshbuilder.js';

export const MAT = { PAINT: 0, GLASS: 1, RUBBER: 2, PLASTIC: 3, LAMP: 4, METAL: 5, TAIL: 6, DECAL: 7 };

export function buildBody(livery = {}) {
  const b = new MeshBuilder();
  const paint = livery.paint ?? [0.9, 0.9, 0.87];
  const accent = livery.accent ?? [0.95, 0.42, 0.06];
  const accent2 = livery.accent2 ?? [0.07, 0.14, 0.32];
  const dark = [0.05, 0.05, 0.055], glass = [0.03, 0.035, 0.04], grey = [0.32, 0.33, 0.35];
  const M = (id) => b.setLimb(id, 0, 0, 0);

  // ---- lower body: sculpted nose, flat flanks, upper half overhangs the wheels
  const lower = [
    { z: 2.38, w: 0.66, wb: 0.9, y0: -0.18, y1: 0.06, r: 3 },
    { z: 2.24, w: 0.88, wb: 0.8, y0: -0.3, y1: 0.24, r: 4 },
    { z: 1.95, w: 0.98, wb: 0.74, y0: -0.33, y1: 0.37, r: 5 },
    { z: 1.25, w: 1.0, wb: 0.74, y0: -0.33, y1: 0.45, r: 7 },
    { z: 0.45, w: 1.0, wb: 0.76, y0: -0.34, y1: 0.47, r: 8 },
    { z: -0.8, w: 1.0, wb: 0.76, y0: -0.34, y1: 0.48, r: 8 },
    { z: -1.7, w: 0.99, wb: 0.74, y0: -0.33, y1: 0.47, r: 7 },
    { z: -2.16, w: 0.95, wb: 0.8, y0: -0.26, y1: 0.43, r: 5 },
    { z: -2.34, w: 0.84, wb: 0.85, y0: -0.12, y1: 0.36, r: 4 },
  ];
  M(MAT.PAINT);
  let from = b.loft(lower, 28, (i, u, pa) => {
    if (i < 0) return paint;
    const y = pa[1], x = Math.abs(pa[0]);
    if (y < -0.12) return dark;                         // skid plates & sills
    if (y > 0.3 && x < 0.22 && pa[2] > 0.9) return accent; // bonnet stripe
    if (y > 0.02 && y < 0.13) return accent;            // side stripe
    if (y > -0.06 && y < 0.02) return accent2;
    return paint;
  });
  b.smooth(from, 50);

  // ---- greenhouse: raked windscreen, side glass, roof
  const cabin = [
    { z: 1.0, w: 0.93, y0: 0.38, y1: 0.47, r: 7 },
    { z: 0.22, w: 0.82, y0: 0.38, y1: 1.08, r: 6 },
    { z: -0.25, w: 0.8, y0: 0.38, y1: 1.12, r: 6 },
    { z: -0.85, w: 0.84, y0: 0.38, y1: 1.07, r: 6 },
    { z: -1.08, w: 0.9, y0: 0.38, y1: 0.82, r: 6 },
  ];
  from = b.mark();
  b.loft(cabin, 28, (i, u, pa, pb) => {
    const y = (pa[1] + pb[1]) / 2, x = Math.abs((pa[0] + pb[0]) / 2);
    if (i < 0) return paint;
    if (y > 1.03) return accent2;                          // roof
    if (i === 0) return x < 0.68 && y > 0.5 ? glass : paint; // windscreen with A-pillars
    if (i === 3) return x < 0.6 && y > 0.55 ? glass : paint;   // rear window
    if (y > 0.6 && y < 0.98) return glass;                // side windows
    return paint;
  }, false, false);
  // mark glass vertices with the glass material
  for (let v = from; v < b.mark(); v++) {
    const c = b.col.slice(v * 3, v * 3 + 3);
    if (c[0] === glass[0] && c[1] === glass[1]) b.limb[v * 4] = MAT.GLASS;
  }
  b.smooth(from, 40);

  // ---- roof details: scoop, light pod, aerials
  M(MAT.PAINT);
  from = b.loft([
    { z: -0.05, w: 0.18, y0: 1.08, y1: 1.12, r: 4 },
    { z: -0.25, w: 0.22, y0: 1.08, y1: 1.27, r: 4 },
    { z: -0.75, w: 0.24, y0: 1.07, y1: 1.3, r: 4 },
    { z: -1.0, w: 0.22, y0: 1.06, y1: 1.12, r: 4 },
  ], 16, (i) => (i < 0 ? dark : paint));
  b.smooth(from, 50);
  M(MAT.PLASTIC);
  b.box(0, 1.27, -0.27, 0.15, 0.02, 0.012, dark);
  b.box(0, 1.15, 0.24, 0.66, 0.05, 0.08, dark);
  for (let i = -3; i <= 3; i++) {
    M(MAT.LAMP);
    b.setTransform(i * 0.19, 1.15, 0.33, 0, Math.PI / 2, 0);
    b.cylinder(0, 0, -0.01, 0.02, 0.065, 0.065, 10, [1, 0.95, 0.8], true, [1, 0.95, 0.8]);
    b.resetTransform();
  }
  M(MAT.METAL);
  b.limbSeg([0.7, 1.08, -0.9], [0.72, 1.9, -1.0], 0.008, 0.004, grey);

  // ---- front: headlights, grille, bash plate, tow hooks
  for (const sx of [-1, 1]) {
    M(MAT.LAMP);
    b.setTransform(sx * 0.62, 0.17, 2.21, 0, Math.PI / 2 - 0.35, 0);
    b.cylinder(0, 0, -0.02, 0.03, 0.12, 0.12, 14, [1, 0.96, 0.85], true, [1, 0.96, 0.85]);
    b.resetTransform();
    M(MAT.PLASTIC);
    b.box(sx * 0.62, 0.17, 2.18, 0.16, 0.13, 0.03, dark);
  }
  M(MAT.PLASTIC);
  b.box(0, 0.02, 2.3, 0.4, 0.09, 0.03, dark);
  M(MAT.METAL);
  b.box(0, -0.28, 2.22, 0.6, 0.04, 0.2, grey);
  for (const sx of [-0.45, 0.45]) b.box(sx, -0.2, 2.38, 0.04, 0.04, 0.06, [0.9, 0.3, 0.05]);

  // ---- mirrors
  M(MAT.PAINT);
  for (const sx of [-1, 1]) {
    b.box(sx * 0.98, 0.72, 0.62, 0.08, 0.06, 0.05, paint);
    M(MAT.GLASS); b.box(sx * 0.98, 0.72, 0.565, 0.065, 0.045, 0.005, glass); M(MAT.PAINT);
  }

  // ---- sand ladders along the sills (rally essential)
  M(MAT.PLASTIC);
  for (const sx of [-1, 1]) {
    b.box(sx * 0.79, -0.08, -0.15, 0.025, 0.11, 0.9, [0.95, 0.45, 0.06]);
    for (let k = -4; k <= 4; k++) b.box(sx * 0.81, -0.08, -0.15 + k * 0.2, 0.01, 0.1, 0.02, dark);
  }

  // ---- spare wheels lying in the rear bay
  for (const z of [-1.45, -1.98]) {
    b.setTransform(0, 0.5, z, 0, 0, Math.PI / 2);
    addTyre(b, 0.36, 0.13, 18, false);
    b.resetTransform();
  }

  // ---- rear: tail lamps, bumper, mud flaps, number plate
  for (const sx of [-0.84, 0.84]) {
    M(MAT.TAIL);
    b.box(sx, 0.28, -2.3, 0.09, 0.07, 0.02, [0.75, 0.04, 0.02]);
  }
  M(MAT.PLASTIC);
  b.box(0, -0.16, -2.3, 0.92, 0.07, 0.07, dark);
  for (const sx of [-0.86, 0.86]) {
    b.box(sx, -0.42, -1.95, 0.13, 0.2, 0.012, dark);
    b.box(sx, -0.42, 1.0, 0.13, 0.18, 0.012, dark);
  }
  // ---- race number boards on the doors
  M(MAT.DECAL);
  for (const s of [-1, 1]) {
    b.box(s * 1.005, 0.27, 0.05, 0.004, 0.13, 0.3, [0.97, 0.97, 0.97]);
    b.box(s * 1.008, 0.27, 0.0, 0.004, 0.08, 0.035, dark);
    b.box(s * 1.008, 0.27, 0.12, 0.004, 0.08, 0.035, dark);
    b.box(s * 1.008, 0.27, -0.12, 0.004, 0.06, 0.06, accent);
  }
  // ---- underfloor (so the car never looks hollow)
  M(MAT.PLASTIC);
  b.box(0, -0.3, -0.1, 0.72, 0.04, 2.1, dark);
  return b;
}

// Tyre with a rounded profile, revolved about the local y axis
function addTyre(b, R, halfW, seg, tread = true) {
  const rubber = [0.06, 0.06, 0.065], side = [0.1, 0.1, 0.105];
  b.setLimb(MAT.RUBBER, 0, 0, 0);
  const prof = [
    [-halfW * 0.98, R * 0.72], [-halfW, R * 0.86], [-halfW * 0.85, R * 0.97], [-halfW * 0.5, R], [halfW * 0.5, R],
    [halfW * 0.85, R * 0.97], [halfW, R * 0.86], [halfW * 0.98, R * 0.72],
  ];
  const from = b.mark();
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    for (let k = 0; k < prof.length - 1; k++) {
      const [y0, r0] = prof[k], [y1, r1] = prof[k + 1];
      const p = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
      const col = k === 0 || k === prof.length - 2 ? side : rubber;
      b.quad(p(a0, r0, y0), p(a1, r0, y0), p(a1, r1, y1), p(a0, r1, y1), col);
    }
  }
  b.smooth(from, 55);
  if (tread) {
    for (let i = 0; i < seg * 2; i++) {
      const a = (i / (seg * 2)) * Math.PI * 2;
      const off = i % 2 ? 0.05 : -0.05;
      const c = [Math.cos(a) * (R + 0.008), off, Math.sin(a) * (R + 0.008)];
      // a small block on the tread, oriented along the circumference
      const tx = -Math.sin(a), tz = Math.cos(a);
      const nx = Math.cos(a), nz = Math.sin(a);
      const hw = 0.045, hl = 0.035, hh = 0.012;
      const P = (u, v, w) => [c[0] + tx * u + nx * w, c[1] + v, c[2] + tz * u + nz * w];
      b.quad(P(-hl, -hw, hh), P(-hl, hw, hh), P(hl, hw, hh), P(hl, -hw, hh), rubber);
      b.quad(P(hl, -hw, -hh), P(hl, hw, -hh), P(hl, hw, hh), P(hl, -hw, hh), rubber);
      b.quad(P(-hl, hw, -hh), P(-hl, -hw, -hh), P(-hl, -hw, hh), P(-hl, hw, hh), rubber);
    }
  }
}

// Wheel around the x axis, centred at the hub.
export function buildWheel() {
  const b = new MeshBuilder();
  const R = 0.42, halfW = 0.16;
  b.setTransform(0, 0, 0, 0, 0, Math.PI / 2);
  addTyre(b, R, halfW, 28, true);
  // beadlock rim: dished disc, spokes, hub
  b.setLimb(MAT.METAL, 0, 0, 0);
  const rim = [0.55, 0.56, 0.58], dark = [0.18, 0.18, 0.2];
  let from = b.mark();
  b.cylinder(0, 0, halfW * 0.55, halfW * 0.9, 0.28, 0.26, 24, rim, true, dark);
  b.cylinder(0, 0, -halfW * 0.9, -halfW * 0.55, 0.26, 0.28, 24, rim, true, dark);
  b.smooth(from, 40);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    b.limbSeg([0, halfW * 0.92, 0], [Math.cos(a) * 0.24, halfW * 0.88, Math.sin(a) * 0.24], 0.035, 0.03, rim);
  }
  from = b.mark();
  b.cylinder(0, 0, halfW * 0.9, halfW + 0.04, 0.07, 0.05, 12, [0.3, 0.3, 0.32], true, [0.9, 0.42, 0.05]);
  b.smooth(from, 40);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    b.box(Math.cos(a) * 0.27, halfW * 0.92, Math.sin(a) * 0.27, 0.012, 0.012, 0.012, [0.7, 0.7, 0.72]);
  }
  b.resetTransform();
  return b;
}
