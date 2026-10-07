// Man-made structures: low-poly models for villages, kasbahs, bivouacs and
// rally furniture, plus a deterministic village layout generator.

import { MeshBuilder, shade } from '../gfx/meshbuilder.js';
import { mulberry32 } from '../core/noise.js';

const WHITE = [1, 1, 1];
const DARK = [0.12, 0.1, 0.09];

export const STRUCTURE_MODELS = {
  // flat-roofed pisé (rammed earth) house; tinted by local earth colour
  house: () => {
    const b = new MeshBuilder();
    b.taper(0, 0, -1, 4.2, 4.2, 3.6, 4.0, 3.4, WHITE, shade(WHITE, 0.92));
    b.box(0, 4.5, 0, 4.1, 0.3, 3.5, shade(WHITE, 0.95));
    for (const x of [-2, 2]) b.box(x, 2.6, 3.42, 0.35, 0.45, 0.05, DARK);
    b.box(0, 1.1, 3.45, 0.6, 1.1, 0.05, [0.3, 0.2, 0.14]);
    return b;
  },
  // kasbah: fortified house with four tapering corner towers and crenellations
  kasbah: () => {
    const b = new MeshBuilder();
    b.taper(0, 0, -1, 9, 8, 8, 7.6, 7.6, WHITE, shade(WHITE, 0.9));
    for (const [x, z] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) {
      b.taper(x, z, -1, 14, 2.6, 2.6, 1.9, 1.9, shade(WHITE, 0.97), shade(WHITE, 0.9));
      for (const [dx, dz] of [[-1.4, 0], [1.4, 0], [0, -1.4], [0, 1.4]]) b.box(x + dx * 1.0, 14.5, z + dz * 1.0, 0.45, 0.6, 0.45, shade(WHITE, 0.95));
      // decorative brick motifs (dark recesses) near the top
      for (const s of [-1, 1]) b.box(x + s * 1.95, 11.5, z, 0.05, 0.9, 0.4, shade(WHITE, 0.55));
      for (const s of [-1, 1]) b.box(x, 11.5, z + s * 1.95, 0.4, 0.9, 0.05, shade(WHITE, 0.55));
    }
    for (let i = -3; i <= 3; i++) {
      b.box(i * 2.2, 3.5, 8.0, 0.35, 0.5, 0.05, DARK);
      b.box(i * 2.2, 6.5, 7.8, 0.3, 0.4, 0.05, DARK);
    }
    b.box(0, 1.4, 8.05, 1.2, 1.4, 0.05, [0.32, 0.2, 0.12]);
    return b;
  },
  // black goat-hair Amazigh nomad tent
  tent: () => {
    const b = new MeshBuilder();
    const c = [0.16, 0.13, 0.11], c2 = [0.22, 0.18, 0.15];
    b.quad([-4, 0.4, -3], [-4, 2.2, 0], [4, 2.2, 0], [4, 0.4, -3], c);
    b.quad([4, 0.4, 3], [4, 2.2, 0], [-4, 2.2, 0], [-4, 0.4, 3], c2);
    b.quad([4, 0.4, -3], [4, 2.2, 0], [-4, 2.2, 0], [-4, 0.4, -3], c);
    b.quad([-4, 0.4, 3], [-4, 2.2, 0], [4, 2.2, 0], [4, 0.4, 3], c2);
    b.box(0, 1.1, 0, 0.06, 1.1, 0.06, [0.4, 0.3, 0.2]);
    b.box(0, 0.1, -3.4, 2.5, 0.08, 0.6, [0.6, 0.15, 0.12]); // rug
    return b;
  },
  // white rally service tent
  serviceTent: () => {
    const b = new MeshBuilder();
    const w = [0.92, 0.92, 0.9];
    b.box(0, 1.25, 0, 3, 1.25, 3, w);
    b.cone(0, 0, 2.5, 4.2, 4.3, 4, w);
    b.box(0, 1.0, 3.02, 1.4, 1.0, 0.03, [0.85, 0.35, 0.1]);
    return b;
  },
  // fuel bowser truck at bivouacs and village stations
  fuelTruck: () => {
    const b = new MeshBuilder();
    b.box(0, 1.0, 2.6, 1.25, 1.0, 1.0, [0.8, 0.15, 0.1]);
    b.box(0, 1.5, 2.95, 1.15, 0.45, 0.65, [0.2, 0.25, 0.3]);
    b.setTransform(0, 1.55, -1.0, 0, Math.PI / 2, 0);
    b.cylinder(0, 0, -2.4, 2.4, 1.1, 1.1, 10, [0.9, 0.9, 0.88]);
    b.resetTransform();
    b.box(0, 0.45, -0.5, 1.2, 0.2, 3.6, [0.15, 0.15, 0.15]);
    for (const [x, z] of [[-1.1, 2.4], [1.1, 2.4], [-1.1, -1.8], [1.1, -1.8], [-1.1, -3.0], [1.1, -3.0]]) {
      b.setTransform(x, 0.5, z, 0, 0, Math.PI / 2);
      b.cylinder(0, 0, -0.25, 0.25, 0.5, 0.5, 8, [0.1, 0.1, 0.1]);
      b.resetTransform();
    }
    b.box(0, 3.4, -1, 0.05, 0.9, 0.05, [0.5, 0.5, 0.5]);
    b.box(0.4, 4.0, -1, 0.4, 0.25, 0.02, [0.95, 0.75, 0.1]);
    return b;
  },
  // rally waypoint: tall pole, flag and a ring of stones
  flag: () => {
    const b = new MeshBuilder();
    b.cylinder(0, 0, 0, 7, 0.08, 0.06, 5, [0.9, 0.9, 0.9]);
    b.quad([0, 6.9, 0], [0, 5.3, 0], [2.4, 5.6, 0.1], [2.4, 6.7, 0.1], [1.0, 0.45, 0.05]);
    b.quad([0, 6.9, 0], [2.4, 6.7, 0.1], [2.4, 5.6, 0.1], [0, 5.3, 0], [1.0, 0.45, 0.05]);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      b.ellipsoid(Math.cos(a) * 1.4, 0.15, Math.sin(a) * 1.4, 0.35, 0.25, 0.3, [0.95, 0.95, 0.95], 4, 2);
    }
    return b;
  },
  // stage start / finish arch spanning the track
  arch: () => {
    const b = new MeshBuilder();
    const o = [0.95, 0.45, 0.05], w = [0.95, 0.95, 0.95];
    for (const x of [-7, 7]) b.box(x, 3.5, 0, 0.5, 3.5, 0.5, o);
    b.box(0, 7.4, 0, 7.5, 0.9, 0.35, w);
    for (let i = -6; i <= 6; i += 2) b.box(i, 7.4, 0.36, 0.5, 0.5, 0.02, (i / 2) % 2 ? DARK : WHITE);
    return b;
  },
  well: () => {
    const b = new MeshBuilder();
    b.cylinder(0, 0, -0.5, 0.9, 1.4, 1.4, 10, [0.75, 0.68, 0.58], true, [0.15, 0.2, 0.25]);
    for (const x of [-1.2, 1.2]) b.box(x, 1.6, 0, 0.1, 1.0, 0.1, [0.4, 0.3, 0.2]);
    b.box(0, 2.6, 0, 1.4, 0.08, 0.08, [0.4, 0.3, 0.2]);
    return b;
  },
  // stork nest: a big bundle of sticks on a tower top
  nest: () => {
    const b = new MeshBuilder();
    b.cylinder(0, 0, 0, 0.6, 0.9, 1.1, 8, [0.4, 0.32, 0.22], true, [0.32, 0.25, 0.18]);
    return b;
  },
};

// Colliders as (x, z, radius) per structure type at scale 1
export const STRUCTURE_COLLIDE = { house: 4.6, kasbah: 11, tent: 3.5, serviceTent: 3.6, fuelTruck: 2.6, flag: 0.15, arch: 0, well: 1.5 };

// Lay out a village / kasbah / bivouac around a place pad.
// Returns [{type, x, z, yaw, scale, tint}] plus stork nest positions.
export function layoutPlace(place, terrain, earthTint) {
  const rnd = mulberry32(Math.floor(place.x * 13 + place.z * 7) >>> 0);
  const out = [];
  const nests = [];
  const route = terrain.route;
  const free = (x, z, r) => {
    const q = route.near(x, z);
    if (q.d < r + 7) return false;
    for (const o of out) if (Math.hypot(o.x - x, o.z - z) < r + (o.r || 4) + 1.5) return false;
    return true;
  };
  const add = (type, x, z, yaw, scale, r) => {
    if (!free(x, z, r)) return false;
    out.push({ type, x, z, yaw, scale, r, tint: type === 'house' || type === 'kasbah' || type === 'well' ? earthTint : [1, 1, 1] });
    return true;
  };
  if (place.type === 'bivouac') {
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rnd() * 0.3, d = place.r * (0.35 + 0.3 * rnd());
      add('serviceTent', place.x + Math.cos(a) * d, place.z + Math.sin(a) * d, rnd() * 6, 1, 4);
    }
    for (let k = 0; k < 3; k++) {
      const a = rnd() * 6.28, d = place.r * 0.7;
      add('tent', place.x + Math.cos(a) * d, place.z + Math.sin(a) * d, rnd() * 6, 1, 4.5);
    }
    if (place.fuel) add('fuelTruck', place.x + 8, place.z - 6, rnd() * 6, 1, 3.5);
    return { items: out, nests };
  }
  if (place.type === 'kasbah') {
    const yaw = rnd() * Math.PI * 2;
    if (add('kasbah', place.x, place.z, yaw, 1, 12)) {
      // a nest on two of the four towers
      for (const [tx, tz] of [[-8, -8], [8, 8]]) {
        const c = Math.cos(yaw), s = Math.sin(yaw);
        nests.push({ x: place.x + tx * c + tz * s, z: place.z - tx * s + tz * c, y: 15.0 });
      }
    }
  }
  if (place.type === 'well') {
    add('well', place.x, place.z, 0, 1, 2);
    for (let k = 0; k < 2; k++) add('tent', place.x + 15 + k * 12, place.z + 10 - k * 18, rnd() * 6, 1, 4.5);
    return { items: out, nests };
  }
  const n = place.n || 8;
  let tries = 0;
  for (let k = 0; k < n && tries < n * 30; tries++) {
    const a = rnd() * Math.PI * 2, d = place.r * Math.sqrt(rnd()) * 0.8;
    const x = place.x + Math.cos(a) * d, z = place.z + Math.sin(a) * d;
    // houses huddle and share alignment, like a ksar
    if (add('house', x, z, Math.round(rnd() * 4) * (Math.PI / 2) + 0.1, 0.8 + rnd() * 0.5, 5)) k++;
  }
  if (place.fuel) {
    for (let t = 0; t < 20; t++) {
      const a = rnd() * 6.28, d = place.r * 0.85;
      if (add('fuelTruck', place.x + Math.cos(a) * d, place.z + Math.sin(a) * d, rnd() * 6, 1, 3.5)) break;
    }
  }
  return { items: out, nests };
}
