// Fauna of the Atlas & Sahara world: field-guide entries, habitat and
// activity rules, behaviour parameters and low-poly animated models.
// Models face +z; legs/wings/heads carry LIMB data for vertex animation.

import { MeshBuilder, LIMB, shade } from '../../gfx/meshbuilder.js';
import { smoothstep } from '../../core/noise.js';

const band = (v, a0, a1, b0, b1) => smoothstep(a0, a1, v) * (1 - smoothstep(b0, b1, v));

// Generic quadruped. Dimensions in metres.
function quadruped(o) {
  const b = new MeshBuilder();
  const L = o.len, legH = o.legH, ry = o.bodyR, rx = o.bodyRx ?? ry * 0.85;
  const bodyY = legH + ry * 0.7;
  const col = o.col, belly = o.belly ?? col, legCol = o.legCol ?? shade(col, 0.85);
  // body: belly-coloured lower half
  b.ellipsoid(0, bodyY, 0, rx, ry, L / 2, col, 8, 5, (i, j) => (j >= 3 ? belly : col));
  if (o.hump) b.ellipsoid(0, bodyY + ry * 0.9, -L * 0.05, rx * 0.65, o.hump, L * 0.22, col, 6, 3);
  // legs: diagonal pairs move together (trot / walk)
  const hipY = bodyY - ry * 0.2;
  const lr = o.legR ?? 0.06;
  const legs = [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]];
  for (const [sx, sz, ph] of legs) {
    const x = sx * rx * 0.55, z = sz * L * 0.33;
    b.setLimb(LIMB.LEG, ph, hipY, z);
    b.limbSeg([x, hipY, z], [x, legH * 0.45, z + sz * 0.02], lr * 1.4, lr, legCol);
    b.limbSeg([x, legH * 0.45, z + sz * 0.02], [x, 0.0, z], lr, lr * 0.8, o.hoof ?? shade(legCol, 0.6));
  }
  // neck and head
  const neckBase = [0, bodyY + ry * 0.3, L * 0.42];
  const headPos = o.headPos ?? [0, bodyY + ry * 1.1, L * 0.62];
  b.setLimb(LIMB.HEAD, 0, neckBase[1], neckBase[2]);
  if (o.neckMid) {
    b.limbSeg(neckBase, o.neckMid, o.neckR ?? ry * 0.45, (o.neckR ?? ry * 0.45) * 0.8, col);
    b.limbSeg(o.neckMid, headPos, (o.neckR ?? ry * 0.45) * 0.8, (o.neckR ?? ry * 0.45) * 0.6, col);
  } else {
    b.limbSeg(neckBase, headPos, o.neckR ?? ry * 0.45, (o.neckR ?? ry * 0.45) * 0.7, col);
  }
  const hs = o.head;
  b.ellipsoid(headPos[0], headPos[1], headPos[2] + hs[2] * 0.5, hs[0], hs[1], hs[2], o.headCol ?? col, 6, 4);
  if (o.face) b.ellipsoid(0, headPos[1] - hs[1] * 0.1, headPos[2] + hs[2] * 1.25, hs[0] * 0.55, hs[1] * 0.6, hs[2] * 0.35, o.face, 5, 3);
  if (o.extraHead) o.extraHead(b, headPos, hs);
  // tail
  if (o.tail) {
    b.setLimb(LIMB.TAIL, 0, bodyY, -L / 2);
    b.limbSeg([0, bodyY + ry * 0.2, -L * 0.48], [0, bodyY - o.tail * 0.6, -L * 0.5 - o.tail * 0.5], o.tailR ?? 0.04, 0.02, o.tailCol ?? col);
  }
  b.setLimb();
  if (o.extra) o.extra(b, { bodyY, L, rx, ry });
  return b;
}

function bird(o) {
  const b = new MeshBuilder();
  const col = o.col, wing = o.wingCol ?? col, tip = o.tipCol ?? wing;
  const span = o.span, bl = o.len;
  const y = 0;
  b.ellipsoid(0, y, 0, bl * 0.16, bl * 0.16, bl * 0.45, col, 6, 4, (i, j) => (j >= 2 && o.belly ? o.belly : col));
  b.setLimb(LIMB.HEAD, 0, y, bl * 0.3);
  b.ellipsoid(0, y + bl * 0.06, bl * 0.48, bl * 0.11, bl * 0.11, bl * 0.13, o.headCol ?? col, 5, 3);
  b.limbSeg([0, y + bl * 0.04, bl * 0.58], [0, y + bl * 0.0, bl * 0.58 + (o.beakLen ?? bl * 0.12)], bl * 0.03, bl * 0.008, o.beak ?? [0.9, 0.75, 0.2]);
  b.setLimb();
  // tail fan
  b.tri([0, y, -bl * 0.3], [-bl * 0.14, y, -bl * 0.62], [bl * 0.14, y, -bl * 0.62], o.tailCol ?? wing);
  b.tri([0, y, -bl * 0.3], [bl * 0.14, y, -bl * 0.62], [-bl * 0.14, y, -bl * 0.62], o.tailCol ?? wing);
  // wings: inner and outer panel, both sides, double-sided
  const chord = o.chord ?? span * 0.22;
  for (const s of span > 0 ? [-1, 1] : []) {
    b.setLimb(LIMB.WING, 0, y, 0);
    const root0 = [s * bl * 0.12, y + 0.01, chord * 0.55], root1 = [s * bl * 0.12, y + 0.01, -chord * 0.45];
    const mid0 = [s * span * 0.26, y + 0.03, chord * 0.5], mid1 = [s * span * 0.26, y + 0.03, -chord * 0.5];
    const tip0 = [s * span * 0.5, y + 0.02, chord * 0.15], tip1 = [s * span * 0.5, y + 0.02, -chord * 0.3];
    const tri2 = (a, c, d, colr) => { b.tri(a, c, d, colr); b.tri(a, d, c, shade(colr, 0.85)); };
    tri2(root0, mid0, mid1, wing); tri2(root0, mid1, root1, wing);
    tri2(mid0, tip0, tip1, tip); tri2(mid0, tip1, mid1, tip);
    if (o.fingers) {
      for (let k = 0; k < 4; k++) {
        const t = k / 3;
        const p0 = [s * span * 0.5, y + 0.02, chord * (0.12 - 0.42 * t)];
        tri2(p0, [s * span * (0.58 + 0.02 * Math.sin(k)), y + 0.04, chord * (0.08 - 0.42 * t)], [s * span * 0.5, y + 0.02, chord * (0.02 - 0.42 * t)], tip);
      }
    }
  }
  b.setLimb();
  if (o.legs) {
    // dangling/standing legs (for storks and walkers)
    for (const s of [-1, 1]) {
      b.setLimb(LIMB.LEG, s > 0 ? 0 : Math.PI, y - bl * 0.1, 0);
      b.limbSeg([s * bl * 0.06, y - bl * 0.1, 0], [s * bl * 0.06, y - bl * 0.1 - o.legs, 0], 0.012 * bl * 3, 0.01 * bl * 3, o.legCol ?? [0.8, 0.3, 0.2]);
    }
    b.setLimb();
  }
  return b;
}

function lizard() {
  const b = new MeshBuilder();
  const col = [0.75, 0.62, 0.35], spots = [0.85, 0.55, 0.2];
  b.ellipsoid(0, 0.06, 0, 0.07, 0.04, 0.16, col, 6, 3, (i) => (i % 2 ? col : spots));
  b.setLimb(LIMB.HEAD, 0, 0.06, 0.14);
  b.ellipsoid(0, 0.07, 0.2, 0.045, 0.035, 0.06, col, 5, 3);
  b.setLimb(LIMB.TAIL, 0, 0.05, -0.15);
  b.limbSeg([0, 0.05, -0.14], [0, 0.03, -0.38], 0.035, 0.012, [0.6, 0.5, 0.3]);
  for (const [sx, sz, ph] of [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]]) {
    b.setLimb(LIMB.LEG, ph, 0.05, sz * 0.09);
    b.limbSeg([sx * 0.06, 0.05, sz * 0.09], [sx * 0.12, 0.0, sz * 0.1], 0.015, 0.01, col);
  }
  b.setLimb();
  return b;
}

const horns = (col, curl = 1) => (b, hp, hs) => {
  for (const s of [-1, 1]) {
    b.limbSeg([s * hs[0] * 0.5, hp[1] + hs[1] * 0.6, hp[2] + hs[2] * 0.2], [s * hs[0] * 1.3, hp[1] + hs[1] * 1.0, hp[2] - hs[2] * 0.6 * curl], 0.05, 0.035, col);
    b.limbSeg([s * hs[0] * 1.3, hp[1] + hs[1] * 1.0, hp[2] - hs[2] * 0.6 * curl], [s * hs[0] * 1.5, hp[1] + hs[1] * 0.2, hp[2] - hs[2] * 1.2 * curl], 0.035, 0.015, col);
  }
};
const ears = (col, size, inner) => (b, hp, hs) => {
  for (const s of [-1, 1]) {
    b.tri([s * hs[0] * 0.4, hp[1] + hs[1] * 0.5, hp[2]], [s * hs[0] * (0.6 + size * 0.6), hp[1] + hs[1] * (0.6 + size * 1.6), hp[2] - 0.02], [s * hs[0] * 1.0, hp[1] + hs[1] * 0.3, hp[2] + 0.01], col);
    b.tri([s * hs[0] * 0.4, hp[1] + hs[1] * 0.5, hp[2] + 0.005], [s * hs[0] * 1.0, hp[1] + hs[1] * 0.3, hp[2] + 0.015], [s * hs[0] * (0.6 + size * 0.6), hp[1] + hs[1] * (0.6 + size * 1.6), hp[2] - 0.015], inner ?? col);
  }
};

export const FAUNA = [
  {
    id: 'macaque', name: 'Barbary macaque', latin: 'Macaca sylvanus', kind: 'walker',
    fact: 'Africa\'s only macaque and the only primate north of the Sahara besides humans. Endangered; troops forage in cedar forests and males help raise the infants.',
    group: [5, 14], walk: 1.0, run: 4.5, flee: 22, spot: 45, stride: 0.6, activity: 'day', maxCount: 18, scale: [0.85, 1.1],
    habitat: (s) => s.wMid * band(s.h, 1400, 1550, 2300, 2600) * smoothstep(-0.5, 0.0, s.clump1) * (s.water > 0 ? 0 : 1),
    likesRoad: 0.35,
    model: () => quadruped({ len: 0.6, legH: 0.28, bodyR: 0.16, col: [0.55, 0.45, 0.32], belly: [0.66, 0.58, 0.45], head: [0.1, 0.1, 0.09], headPos: [0, 0.6, 0.36], face: [0.82, 0.6, 0.55], legR: 0.035 }),
  },
  {
    id: 'boar', name: 'Wild boar', latin: 'Sus scrofa', kind: 'walker',
    fact: 'Roots through the forest floor for acorns, bulbs and grubs, turning the soil like a plough. Mostly active at dusk and through the night.',
    group: [2, 6], walk: 1.0, run: 7, flee: 45, spot: 50, stride: 0.7, activity: 'dusk', maxCount: 8, scale: [0.85, 1.15],
    habitat: (s) => (s.wMid + s.wHigh * 0.3) * band(s.h, 1200, 1400, 2200, 2500) * smoothstep(-0.4, 0.2, s.clump1),
    model: () => quadruped({ len: 1.25, legH: 0.38, bodyR: 0.32, bodyRx: 0.25, col: [0.25, 0.22, 0.2], head: [0.15, 0.17, 0.25], headPos: [0, 0.72, 0.62], face: [0.35, 0.3, 0.28], tail: 0.2, tailR: 0.02, legR: 0.05,
      extraHead: ears([0.22, 0.2, 0.18], 0.4) }),
  },
  {
    id: 'aoudad', name: 'Barbary sheep (aoudad)', latin: 'Ammotragus lervia', kind: 'walker',
    fact: 'A wild goat-antelope of rocky mountains. It can live without drinking, taking water from plants and dew, and long fringes of hair hang from its throat and forelegs.',
    group: [3, 8], walk: 1.1, run: 9, flee: 90, spot: 90, stride: 0.9, activity: 'day', maxCount: 10, scale: [0.9, 1.15],
    habitat: (s) => (s.wHigh + s.wPre * 0.4) * band(s.h, 1700, 1900, 3100, 3400) * smoothstep(0.12, 0.35, s.slope) * (1 - s.dSnow),
    model: () => quadruped({ len: 1.5, legH: 0.6, bodyR: 0.3, col: [0.68, 0.5, 0.32], belly: [0.75, 0.62, 0.45], head: [0.12, 0.13, 0.2], headPos: [0, 1.25, 0.88], legR: 0.05,
      extraHead: horns([0.45, 0.4, 0.33], 1.2),
      extra: (b, d) => { b.setLimb(LIMB.NONE); b.taper(0, d.L * 0.38, d.bodyY - 0.55, d.bodyY, 0.08, 0.12, 0.12, 0.16, [0.62, 0.45, 0.3]); } }),
  },
  {
    id: 'goat', name: 'Goats', latin: 'Capra hircus', kind: 'walker',
    fact: 'Herded across every Moroccan landscape. In the argan woodlands they are famous for climbing high into the thorny trees to reach the fruit.',
    group: [4, 12], walk: 1.0, run: 4, flee: 18, spot: 40, stride: 0.6, activity: 'day', maxCount: 16, scale: [0.85, 1.1], variants: true,
    habitat: (s) => (1 - s.wErg) * band(s.pad, 0.0, 0.05, 0.7, 0.9) * (s.pad > 0 ? 1 : 0) + s.wPre * band(s.h, 1050, 1150, 1650, 1800) * (1 - smoothstep(-500, 1500, s.x)) * 0.4,
    model: () => quadruped({ len: 0.85, legH: 0.42, bodyR: 0.2, col: [0.2, 0.17, 0.15], belly: [0.3, 0.26, 0.22], head: [0.08, 0.09, 0.14], headPos: [0, 0.85, 0.5], tail: 0.1, legR: 0.03,
      extraHead: horns([0.3, 0.28, 0.25], 0.8) }),
  },
  {
    id: 'dromedary', name: 'Dromedary', latin: 'Camelus dromedarius', kind: 'walker',
    fact: 'Lets its body temperature swing by about 6 °C over a day instead of sweating, and can lose a quarter of its body water. Broad, soft footpads spread its weight on sand, just like deflated tyres.',
    group: [3, 10], walk: 1.3, run: 6, flee: 14, spot: 120, stride: 1.4, activity: 'day', maxCount: 14, scale: [0.9, 1.1],
    habitat: (s) => (s.wPre * 0.3 + s.wHam + s.wErg * 0.8) * (1 - smoothstep(0.45, 0.8, s.duneRel)) * (1 - smoothstep(0.25, 0.45, s.slope)),
    likesRoad: 0.15,
    model: () => quadruped({ len: 2.3, legH: 1.25, bodyR: 0.45, bodyRx: 0.42, col: [0.78, 0.62, 0.42], hump: 0.42, head: [0.13, 0.15, 0.32], legR: 0.07,
      neckMid: [0, 1.95, 1.65], headPos: [0, 2.35, 1.75], neckR: 0.17, tail: 0.5, tailR: 0.03, extraHead: ears([0.7, 0.55, 0.38], 0.2) }),
  },
  {
    id: 'gazelle', name: 'Dorcas gazelle', latin: 'Gazella dorcas', kind: 'walker',
    fact: 'Can sprint at 80 km/h and may never drink, getting water from leaves and dew. Most active at dawn and dusk to avoid the heat.',
    group: [2, 7], walk: 1.2, run: 20, flee: 140, spot: 110, stride: 1.2, activity: 'dusk', maxCount: 10, scale: [0.9, 1.1],
    habitat: (s) => (s.wHam + s.wErg * 0.6 + s.wPre * 0.3) * (1 - smoothstep(0.3, 0.6, s.duneRel)) * (1 - smoothstep(0.25, 0.4, s.slope)),
    model: () => quadruped({ len: 0.95, legH: 0.62, bodyR: 0.17, col: [0.78, 0.6, 0.4], belly: [0.95, 0.92, 0.88], head: [0.07, 0.08, 0.13], headPos: [0, 1.15, 0.58], legR: 0.025, tail: 0.15, tailCol: [0.15, 0.12, 0.1],
      extraHead: (b, hp, hs) => { for (const s of [-1, 1]) b.limbSeg([s * 0.03, hp[1] + 0.06, hp[2] + 0.02], [s * 0.07, hp[1] + 0.3, hp[2] - 0.08], 0.018, 0.008, [0.2, 0.18, 0.15]); ears([0.75, 0.6, 0.42], 0.8)(b, hp, hs); } }),
  },
  {
    id: 'houbara', name: 'Houbara bustard', latin: 'Chlamydotis undulata', kind: 'walker',
    fact: 'A ground bird of stony plains, superbly camouflaged. Displaying males raise a white ruff over their heads and race in circles at dawn.',
    group: [1, 2], walk: 0.8, run: 6, flee: 70, spot: 55, stride: 0.4, activity: 'day', maxCount: 4, scale: [0.9, 1.1],
    habitat: (s) => s.wHam * (1 - s.mesa * 0.5) + s.wPre * 0.2,
    model: () => { const b = bird({ col: [0.72, 0.62, 0.45], belly: [0.92, 0.9, 0.85], headCol: [0.75, 0.7, 0.6], span: 0.0, len: 0.65, beak: [0.4, 0.38, 0.33], beakLen: 0.05, legs: 0.35, legCol: [0.7, 0.65, 0.4] }); return b; },
    yOffset: 0.42,
  },
  {
    id: 'fennec', name: 'Fennec fox', latin: 'Vulpes zerda', kind: 'walker',
    fact: 'The smallest fox. Its enormous ears shed body heat and hear prey moving under the sand; furred soles insulate its paws from scorching dunes. Strictly nocturnal in summer.',
    group: [1, 2], walk: 1.0, run: 9, flee: 45, spot: 35, stride: 0.35, activity: 'night', maxCount: 4, scale: [0.9, 1.1],
    habitat: (s) => s.wErg * (0.3 + 0.7 * smoothstep(0.05, 0.4, s.duneRel)),
    model: () => quadruped({ len: 0.4, legH: 0.16, bodyR: 0.1, col: [0.93, 0.82, 0.62], belly: [0.98, 0.95, 0.9], head: [0.06, 0.06, 0.07], headPos: [0, 0.34, 0.24], legR: 0.018, tail: 0.25, tailR: 0.04, tailCol: [0.9, 0.78, 0.58],
      extraHead: ears([0.93, 0.8, 0.6], 2.6, [0.95, 0.75, 0.7]) }),
  },
  {
    id: 'uromastyx', name: 'Spiny-tailed lizard', latin: 'Uromastyx nigriventris', kind: 'walker',
    fact: 'A vegetarian lizard that basks to warm up: cold, it is dark to absorb heat; once hot it turns bright yellow and red. It retreats to its burrow when the ground gets too hot or too cold.',
    group: [1, 3], walk: 0.5, run: 3.5, flee: 12, spot: 18, stride: 0.15, activity: 'warm', maxCount: 5, scale: [0.9, 1.2],
    habitat: (s) => (s.wHam + s.wPre * 0.5) * (1 - s.oued),
    model: lizard,
  },
  {
    id: 'eagle', name: 'Golden eagle', latin: 'Aquila chrysaetos', kind: 'flyer',
    fact: 'Rides thermals and the updrafts along ridges, soaring for hours with barely a wingbeat. Its 2-metre wings end in spread "finger" feathers that tame turbulence.',
    group: [1, 2], speed: 13, spot: 160, activity: 'day', maxCount: 3, scale: [0.95, 1.1], altitude: [60, 220], radius: [60, 160],
    habitat: (s) => s.wHigh + s.wMid * 0.2,
    model: () => bird({ col: [0.33, 0.24, 0.16], headCol: [0.6, 0.45, 0.25], span: 2.1, len: 0.9, beak: [0.85, 0.75, 0.2], fingers: true, tipCol: [0.2, 0.16, 0.12] }),
  },
  {
    id: 'lammergeier', name: 'Bearded vulture', latin: 'Gypaetus barbatus', kind: 'flyer',
    fact: 'Lives almost entirely on bone, dropping large bones from height onto rocks to crack them. A handful of pairs survive in the High Atlas.',
    group: [1, 1], speed: 14, spot: 180, activity: 'day', maxCount: 1, scale: [1, 1.1], altitude: [90, 260], radius: [100, 220], rarity: 0.25,
    habitat: (s) => s.wHigh * smoothstep(2200, 2700, s.h),
    model: () => bird({ col: [0.88, 0.62, 0.35], belly: [0.9, 0.6, 0.3], headCol: [0.92, 0.85, 0.75], wingCol: [0.25, 0.25, 0.27], span: 2.7, len: 1.15, chord: 0.5, beak: [0.3, 0.3, 0.3], fingers: true }),
  },
  {
    id: 'stork', name: 'White stork', latin: 'Ciconia ciconia', kind: 'flyer',
    fact: 'Nests on kasbah towers and minarets. It migrates across the Sahara by soaring from thermal to thermal, saving the energy of flapping flight.',
    group: [2, 5], speed: 11, spot: 120, activity: 'day', maxCount: 6, scale: [0.95, 1.05], altitude: [40, 140], radius: [50, 130],
    habitat: (s) => (s.wPre + s.wMid * 0.3) * (1 - smoothstep(100, 900, s.riverD)),
    model: () => bird({ col: [0.95, 0.95, 0.93], wingCol: [0.95, 0.95, 0.93], tipCol: [0.08, 0.08, 0.08], span: 1.9, len: 1.0, beak: [0.85, 0.2, 0.12], beakLen: 0.22, legs: 0.0, fingers: true }),
  },
  {
    id: 'raven', name: 'Brown-necked raven', latin: 'Corvus ruficollis', kind: 'flyer',
    fact: 'The raven of the true desert, often in pairs. Ravens follow caravans and camps, and are among the most intelligent of birds.',
    group: [1, 3], speed: 12, spot: 70, activity: 'day', maxCount: 4, scale: [0.95, 1.05], altitude: [15, 70], radius: [30, 90],
    habitat: (s) => s.wHam + s.wErg * 0.7 + s.wPre * 0.4,
    model: () => bird({ col: [0.08, 0.08, 0.1], headCol: [0.15, 0.1, 0.08], span: 1.1, len: 0.55, beak: [0.05, 0.05, 0.05], fingers: true }),
  },
  {
    id: 'lanner', name: 'Lanner falcon', latin: 'Falco biarmicus', kind: 'flyer',
    fact: 'A desert falcon that hunts birds in fast, low chases over open ground and nests on cliff ledges and mesa scarps.',
    group: [1, 1], speed: 17, spot: 80, activity: 'day', maxCount: 2, scale: [0.95, 1.05], altitude: [25, 90], radius: [40, 110],
    habitat: (s) => s.wHam * (0.3 + s.mesa * 0.5) + s.wPre * 0.3,
    model: () => bird({ col: [0.55, 0.48, 0.42], belly: [0.9, 0.85, 0.78], headCol: [0.75, 0.55, 0.4], span: 1.0, len: 0.45, chord: 0.18, beak: [0.9, 0.8, 0.3] }),
  },
];

// Nesting storks sit on kasbah towers (placed by the world's structures).
export const STORK_NEST = { id: 'stork', model: () => bird({ col: [0.95, 0.95, 0.93], wingCol: [0.95, 0.95, 0.93], tipCol: [0.08, 0.08, 0.08], span: 0.5, len: 1.0, beak: [0.85, 0.2, 0.12], beakLen: 0.22, legs: 0.0 }) };
