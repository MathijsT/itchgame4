// Procedural low-poly rally-raid prototype and its wheels.
// Body frame: +z forward, +y up, origin at the centre of mass.

import { MeshBuilder, shade } from '../gfx/meshbuilder.js';

export function buildBody(livery = {}) {
  const b = new MeshBuilder();
  const paint = livery.paint ?? [0.93, 0.92, 0.88];
  const accent = livery.accent ?? [0.95, 0.42, 0.06];
  const accent2 = livery.accent2 ?? [0.08, 0.16, 0.36];
  const dark = [0.07, 0.07, 0.08], glass = [0.05, 0.07, 0.09], grey = [0.35, 0.36, 0.38];
  const lamp = [1.0, 0.95, 0.75], red = [0.7, 0.05, 0.03];

  // floor pan & sills
  b.box(0, -0.25, 0, 0.98, 0.12, 2.2, dark);
  // lower body sides
  b.box(0, 0.05, -0.1, 1.0, 0.25, 2.05, paint);
  // nose: sloping bonnet
  b.taper(0, 1.65, -0.2, 0.42, 0.98, 0.55, 0.95, 0.45, paint, paint);
  b.quad([-0.95, 0.42, 1.2], [0.95, 0.42, 1.2], [0.95, 0.36, 2.1], [-0.95, 0.36, 2.1], paint);
  // accent stripe across bonnet and sides
  b.box(0, 0.425, 1.55, 0.3, 0.01, 0.55, accent);
  b.box(1.005, 0.08, -0.1, 0.01, 0.07, 2.0, accent);
  b.box(-1.005, 0.08, -0.1, 0.01, 0.07, 2.0, accent);
  b.box(1.006, -0.04, -0.1, 0.01, 0.04, 2.0, accent2);
  b.box(-1.006, -0.04, -0.1, 0.01, 0.04, 2.0, accent2);
  // cabin with raked windscreen
  b.quad([-0.92, 0.3, 0.95], [0.92, 0.3, 0.95], [0.78, 1.05, 0.15], [-0.78, 1.05, 0.15], glass);
  b.quad([0.92, 0.3, 0.95], [0.92, 0.3, -1.0], [0.78, 1.05, -1.0], [0.78, 1.05, 0.15], paint);
  b.quad([-0.92, 0.3, -1.0], [-0.92, 0.3, 0.95], [-0.78, 1.05, 0.15], [-0.78, 1.05, -1.0], paint);
  // side windows
  b.quad([0.925, 0.55, 0.62], [0.925, 0.55, -0.65], [0.805, 0.97, -0.65], [0.805, 0.97, 0.12], glass);
  b.quad([-0.925, 0.55, -0.65], [-0.925, 0.55, 0.62], [-0.805, 0.97, 0.12], [-0.805, 0.97, -0.65], glass);
  // roof and rear wall
  b.quad([-0.78, 1.05, 0.15], [0.78, 1.05, 0.15], [0.78, 1.05, -1.0], [-0.78, 1.05, -1.0], accent2);
  b.quad([0.92, 0.3, -1.0], [-0.92, 0.3, -1.0], [-0.78, 1.05, -1.0], [0.78, 1.05, -1.0], paint);
  // roof air scoop and light pod
  b.taper(0, -0.3, 1.05, 1.22, 0.22, 0.45, 0.18, 0.35, paint, paint);
  b.box(0, 1.24, -0.1, 0.18, 0.02, 0.06, dark);
  b.box(0, 1.1, 0.2, 0.72, 0.06, 0.07, dark);
  for (let i = -3; i <= 3; i++) b.box(i * 0.2, 1.1, 0.275, 0.07, 0.045, 0.01, lamp);
  // rear deck with two spare wheels
  b.box(0, 0.32, -1.75, 0.95, 0.05, 0.6, dark);
  for (const z of [-1.45, -2.0]) {
    b.setTransform(0, 0.55, z, 0, 0, 0);
    b.cylinder(0, 0, -0.16, 0.16, 0.42, 0.42, 12, [0.08, 0.08, 0.08], true, [0.5, 0.5, 0.52]);
    b.resetTransform();
  }
  // fenders over each wheel
  for (const [x, z] of [[-0.92, 1.475], [0.92, 1.475], [-0.92, -1.475], [0.92, -1.475]]) {
    b.box(x, 0.12, z, 0.16, 0.08, 0.62, shade(paint, 0.9));
  }
  // bull bar, headlights, tail lights
  b.box(0, -0.05, 2.25, 0.85, 0.06, 0.06, grey);
  b.box(0, 0.15, 2.25, 0.85, 0.04, 0.05, grey);
  for (const x of [-0.62, 0.62]) b.box(x, 0.3, 2.12, 0.2, 0.07, 0.03, lamp);
  for (const x of [-0.85, 0.85]) b.box(x, 0.25, -2.2, 0.1, 0.08, 0.02, red);
  // rear bumper and mud flaps
  b.box(0, -0.15, -2.2, 0.95, 0.08, 0.06, dark);
  for (const x of [-0.92, 0.92]) b.box(x, -0.15, -1.98, 0.14, 0.2, 0.01, dark);
  // race number panel on the doors
  for (const s of [-1, 1]) {
    b.box(s * 1.01, 0.12, 0.25, 0.005, 0.15, 0.25, [0.98, 0.98, 0.98]);
    b.box(s * 1.012, 0.12, 0.25, 0.005, 0.08, 0.04, dark);
    b.box(s * 1.012, 0.12, 0.33, 0.005, 0.08, 0.025, dark);
  }
  return b;
}

// Wheel around the x axis, centred at the hub.
export function buildWheel() {
  const b = new MeshBuilder();
  const tyre = [0.08, 0.08, 0.085], rim = [0.62, 0.63, 0.66], hub = [0.25, 0.25, 0.27];
  const R = 0.42, w = 0.16, seg = 14;
  b.setTransform(0, 0, 0, 0, 0, Math.PI / 2);
  b.cylinder(0, 0, -w, w, R, R, seg, tyre, true, tyre);
  b.cylinder(0, 0, w, w + 0.005, 0.26, 0.26, seg, rim, true, rim);
  b.cylinder(0, 0, -w - 0.005, -w, 0.26, 0.26, seg, rim, true, rim);
  b.cylinder(0, 0, w + 0.005, w + 0.05, 0.08, 0.06, 6, hub, true, hub);
  b.resetTransform();
  // tread blocks make rotation readable
  for (let k = 0; k < seg; k++) {
    const a = (k / seg) * Math.PI * 2;
    b.setTransform(0, Math.cos(a) * (R + 0.012), Math.sin(a) * (R + 0.012), 0, a, 0);
    b.box(k % 2 ? 0.07 : -0.07, 0, 0, 0.07, 0.014, 0.05, [0.11, 0.11, 0.11]);
    b.resetTransform();
  }
  return b;
}
