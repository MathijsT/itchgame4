// Terrain for the Atlas & Sahara world.
//
// The height field is a sum of regional landforms blended along a warped
// north→south axis:
//   Middle Atlas   rolling limestone/volcanic plateau (~1600 m)
//   High Atlas     ridged multifractal ranges, peaks near 4000 m, opened into a
//                  pass along the route corridor
//   Draa valley    eroded red Anti-Atlas ridges cut by the Draa
//   Hamada         flat stony plateau with terraced mesas (cap-rock erosion)
//   Erg            aeolian dunes whose slip faces stand at the angle of repose
// Then rivers, the road (cut & fill with embankments), and village pads are
// carved in, in that order.

import { Simplex2, smoothstep, clamp, lerp } from '../../core/noise.js';
import { Route, ROAD } from '../../world/route.js';
import { SURF } from '../../world/surfaces.js';
import { BOUNDS, ROUTE, RIVERS, PLACES } from './geo.js';

const ELEV = [
  [-8000, 1450], [-1000, 1560], [3000, 1680], [5000, 1760], [7500, 2050], [9600, 2260],
  [11000, 2080], [12500, 1830], [14000, 1580], [15500, 1430], [17000, 1300], [18500, 1170], [20500, 950],
  [25000, 790], [34000, 720], [44000, 700],
];

function elevAt(zw) {
  if (zw <= ELEV[0][0]) return ELEV[0][1];
  for (let i = 1; i < ELEV.length; i++) {
    if (zw < ELEV[i][0]) {
      const a = ELEV[i - 1], b = ELEV[i];
      let t = (zw - a[0]) / (b[0] - a[0]);
      t = t * t * (3 - 2 * t);
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return ELEV[ELEV.length - 1][1];
}

// angle of repose of dry sand ≈ 33° → horizontal extent of a slip face per metre of height
const SLIP_RUN = 1 / Math.tan(33 * Math.PI / 180);
// domain warping compresses the profile locally; keep slip faces at or below repose
const SLIP_MARGIN = 1.08;
const WIND_DIR = (() => { const a = -0.35; return [Math.sin(a), Math.cos(a)]; })(); // sand-moving wind blows roughly south-southwest

// [r,g,b] sRGB palette
const C = {
  asphalt: [0.2, 0.2, 0.21], forestShade: [0.15, 0.2, 0.11], piste: [0.66, 0.56, 0.43], pisteRed: [0.66, 0.46, 0.34],
  forest: [0.27, 0.31, 0.16], meadow: [0.4, 0.45, 0.2], dryGrass: [0.56, 0.5, 0.32],
  limestone: [0.6, 0.56, 0.5], redRock: [0.6, 0.36, 0.26], darkRock: [0.36, 0.3, 0.27],
  reg: [0.38, 0.29, 0.22], regLight: [0.55, 0.43, 0.32], paleSand: [0.82, 0.66, 0.46],
  ergSand: [0.86, 0.53, 0.3], ergSandLight: [0.92, 0.66, 0.42], snow: [0.94, 0.95, 0.98],
  riverbed: [0.42, 0.38, 0.33], oasis: [0.28, 0.36, 0.14], padEarth: [0.62, 0.5, 0.38],
};

export class MoroccoTerrain {
  constructor(seed = 1977) {
    this.seed = seed;
    this.n1 = new Simplex2(seed);
    this.n2 = new Simplex2(seed + 11);
    this.n3 = new Simplex2(seed + 23);
    this.n4 = new Simplex2(seed + 37);
    this.n5 = new Simplex2(seed + 51);
    this.bounds = BOUNDS;
    this._o = {};

    // Route geometry first (the corridor shapes the mountains), then rivers,
    // then the road profile which is pinned to the water at fords.
    this.route = new Route(ROUTE, BOUNDS, { maxGrade: 0.11, halfWidth: 4.5 });
    this.rivers = RIVERS.map((r) => {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of r.ctrl) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
      const rt = new Route(r.ctrl.map((p) => ({ x: p.x, z: p.z, road: ROAD.NONE })), { minX, maxX, minZ, maxZ }, { maxGrade: 0.25, monotone: true });
      rt.info = r;
      return rt;
    });
    // Profiles, in dependency order: road from the raw land; rivers from the
    // land with the road corridor shaped, pinned beneath the road where they
    // cross; finally the road dips to each ford.
    this._valleys = false;
    this._roadValley = false;
    const base = (x, z) => this._base(x, z, this._o);
    this.route.setProfile(base);
    this._roadValley = true;
    const pinUnderRoad = (x, z) => {
      const q = this.route.near(x, z);
      return q.d < 12 && q.type !== ROAD.NONE ? q.h - 0.3 : NaN;
    };
    const pinToFord = (x, z) => {
      for (const r of this.rivers) {
        const q = r.near(x, z);
        if (q.d < r.info.halfWidth + 6) return q.h + 0.1;
      }
      return NaN;
    };
    this._roadBeforeFords = Float32Array.from(this.route.roadH);
    for (const r of this.rivers) r.setProfile(base, pinUnderRoad);
    this._valleys = true;
    // a few rounds: each only lowers, so road and rivers settle on shared fords
    for (let it = 0; it < 3; it++) {
      this.route.applyPins(pinToFord);
      for (const r of this.rivers) r.applyPins(pinUnderRoad);
    }

    // places: bivouacs are anchored to route control points
    this.places = PLACES.map((p) => {
      const pl = { ...p };
      if (p.at !== undefined) {
        const c = ROUTE[p.at];
        const t = this.route.track(c.x, c.z);
        const a = this.route.at(t.s);
        const off = (p.r + 18) * (p.side || 1);
        pl.x = a.x + a.tz * off; pl.z = a.z - a.tx * off;
        pl.routeS = t.s;
      }
      const q = this.route.near(pl.x, pl.z);
      pl.h = q.d < pl.r + 40 && q.type !== ROAD.NONE ? q.h : this._base(pl.x, pl.z, this._o);
      return pl;
    });
  }

  zones(x, z, o) {
    const n2 = this.n2, n3 = this.n3;
    const zw = z + n2.noise(x / 7000, z / 7000) * 1400 + n3.noise(x / 1800 + 3.7, z / 1800) * 260;
    o.zw = zw;
    const a = smoothstep(3600, 6000, zw), b = smoothstep(11800, 14400, zw);
    const c = smoothstep(18600, 20600, zw), d = smoothstep(24300, 26300, zw);
    o.wMid = 1 - a;
    o.wHigh = a * (1 - b);
    o.wPre = b * (1 - c);
    o.wHam = c * (1 - d);
    o.wErg = d;
  }

  dunes(x, z, zw, corr) {
    const n4 = this.n4, n5 = this.n5, n1 = this.n1;
    const wx = WIND_DIR[0], wz = WIND_DIR[1];
    const u0 = x * wx + z * wz, v0 = -x * wz + z * wx;
    // amplitude: large star/linear dunes in the erg core, smaller at the margins,
    // lower in the inter-dune corridor ("gassi") the route follows
    const core = smoothstep(25200, 28500, zw);
    let amp = 14 + 125 * core * smoothstep(-0.35, 0.55, n1.fbm(x / 6500 + 9.1, z / 6500, 3));
    amp *= 0.42 + 0.58 * smoothstep(40, 700, corr);
    // primary transverse/barchanoid set: crest lines bent into crescents by
    // warping. The warp stretches/compresses the profile, so the slip-face
    // width uses the local phase gradient to stay at the angle of repose.
    const warp1 = (a, b) => a + n4.noise(b / 1500, a / 2800) * 300 + n5.noise(b / 430, a / 1400) * 45;
    const u = warp1(u0, v0);
    const g1 = Math.hypot(warp1(u0 + 1, v0) - u, warp1(u0, v0 + 1) - u);
    const L1 = 860;
    const h1 = amp * duneProfile(u / L1, amp * g1, L1);
    const windward = DUNE_STATE.windward;
    // secondary set at ~65° makes star-dune peaks where crests intersect
    const c2 = Math.cos(1.13), s2 = Math.sin(1.13);
    const warp2 = (a, b) => a * c2 + b * s2 + n5.noise(a / 2200, b / 1800) * 150;
    const u2 = warp2(u0, v0);
    const g2 = Math.hypot(warp2(u0 + 1, v0) - u2, warp2(u0, v0 + 1) - u2);
    const a2 = amp * 0.55;
    const h2 = a2 * duneProfile(u2 / 610, a2 * g2, 610);
    // small superimposed dunes on the gentle windward slopes only
    const u3 = u0 + n4.noise(v0 / 160, u0 / 240) * 25;
    const a3 = 0.9 * (0.4 + core) * windward;
    const h3 = a3 * (0.5 + 0.5 * Math.sin((u3 / 95) * Math.PI * 2));
    const big = Math.max(h1, h2);
    return { h: big + h3 + n1.fbm(x / 900, z / 900, 2) * 6, rel: big / Math.max(1, amp * 1.3) };
  }

  // Height before road, rivers and pads.
  _base(x, z, o) {
    this.zones(x, z, o);
    const n1 = this.n1, n2 = this.n2, n3 = this.n3, n4 = this.n4, n5 = this.n5;
    const corr = this.route.corridor(x, z);
    o.corr = corr;
    // ranges open up along the route and along rivers (rivers made the valleys)
    let rOpen = 1;
    for (let i = 0; i < this.rivers.length; i++) rOpen = Math.min(rOpen, smoothstep(150, 2200, this.rivers[i].corridor(x, z)));
    const open = smoothstep(120, 1900, corr) * (0.15 + 0.85 * rOpen);
    let h = elevAt(o.zw);
    o.mtn = 0; o.duneRel = 0; o.mesa = 0;
    if (o.wMid > 0.001) {
      h += o.wMid * (n1.fbm(x / 1700, z / 1700, 4) * 170 + n2.fbm(x / 340, z / 340, 3) * 18);
    }
    if (o.wHigh > 0.001) {
      const r = n3.ridged(x / 3600, z / 3600, 5);
      const m = (r * 2300 - 420) * (0.04 + 0.96 * open);
      h += o.wHigh * (m + n2.fbm(x / 600, z / 600, 3) * 45);
      o.mtn = o.wHigh * r * (0.04 + 0.96 * open);
    }
    if (o.wPre > 0.001) {
      const r = n3.ridged(x / 2300 + 50, z / 2300, 4);
      h += o.wPre * ((r * 680 - 140) * (0.08 + 0.92 * open) + n1.fbm(x / 520, z / 520, 3) * 22);
      o.mtn += o.wPre * r * 0.6 * open;
    }
    if (o.wHam > 0.001) {
      // cap-rock mesas: terraced noise gives flat tops and short steep scarps
      const t = clamp((n2.fbm(x / 2600 + 4.2, z / 2600, 4) - 0.05) * 3.2, 0, 2.4);
      const step = Math.floor(t) + smoothstep(0.72, 1.0, t - Math.floor(t));
      const mesa = step * 62 * (0.06 + 0.94 * smoothstep(150, 900, corr));
      o.mesa = o.wHam * step;
      h += o.wHam * (mesa + n1.fbm(x / 1100, z / 1100, 3) * 9);
    }
    if (o.wErg > 0.001) {
      const d = this.dunes(x, z, o.zw, corr);
      h += o.wErg * d.h;
      o.duneRel = d.rel * o.wErg;
    }
    // river valleys: blend the land down towards the water surface, wider
    // where the river has had to cut deeper
    if (this._valleys) {
      for (let i = 0; i < this.rivers.length; i++) {
        const rv = this.rivers[i];
        const cd = rv.corridor(x, z);
        if (cd > 1800) continue;
        const surf = rv.corridorHeight(x, z);
        if (Number.isNaN(surf)) continue;
        const floor = surf + 1.5 + cd * 0.02;
        if (h <= floor) continue;
        const width = clamp(260 + (h - floor) * 3.2, 300, 1800);
        const v = 1 - smoothstep(rv.info.halfWidth + 10, width, cd);
        h = lerp(h, floor, v * v * (3 - 2 * v));
      }
    }
    // the road corridor: land eases towards the road profile so climbs become
    // valleys and cols rather than slot cuts (roads follow valleys)
    if (this._roadValley && corr < 1600) {
      const ri = this.route.corridorIndex(x, z);
      if (ri >= 0 && this.route.type[ri] !== ROAD.NONE) {
        const rh = this.route.roadH[ri];
        const diff = h - rh;
        const width = clamp(90 + Math.abs(diff) * (diff > 0 ? 3.0 : 1.6), 100, 1600);
        const v = 1 - smoothstep(25, width, corr);
        h = lerp(h, rh + Math.sign(diff) * Math.min(Math.abs(diff), corr * 0.08), v * v * (3 - 2 * v));
      }
    }
    // dry oueds: meandering channels in the lowlands (flash-flood carved)
    const wd = o.wPre + o.wHam * 0.9 + o.wMid * 0.4;
    o.oued = 0;
    if (wd > 0.01) {
      const rv = Math.abs(n4.fbm(x / 5200 + 7.3, z / 5200 - 3.1, 3) + n5.noise(x / 700, z / 700) * 0.04);
      const m = 1 - smoothstep(0.01, 0.045, rv);
      if (m > 0) {
        const s = m * m * (3 - 2 * m);
        h -= s * 7 * wd;
        o.oued = s * wd;
      }
    }
    return h;
  }

  // Full height sample. Fills `o` with everything shade() needs.
  sample(x, z, o) {
    let h = this._base(x, z, o);
    const q = this.route.near(x, z);
    o.road = 0; o.roadType = ROAD.NONE; o.routeD = q.d; o.water = 0; o.river = 0; o.riverD = 1e9; o.pad = 0;
    // rivers: channel cut to a monotone water surface, banks blended back
    let ford = null;
    for (let i = 0; i < this.rivers.length; i++) {
      const rv = this.rivers[i];
      const hw = rv.info.halfWidth, bank = 34;
      const cd = rv.corridor(x, z);
      if (cd < o.riverD) o.riverD = cd;
      if (cd > hw + bank + 45) continue;
      const rq = rv.near(x, z);
      if (rq.d >= hw + bank) continue;
      const d = rq.d;
      let t;
      if (d < hw) t = rq.h - rv.info.depth * (1 - (d / hw) * (d / hw)) - 0.02;
      else t = rq.h + (d - hw) * 0.3;
      h = d < hw ? t : lerp(t, h, smoothstep(hw, hw + bank, d));
      if (d < hw) ford = { surf: rq.h, d, hw };
      o.river = Math.max(o.river, 1 - smoothstep(hw, hw + 4, d));
    }
    // road: cut & fill with embankment width growing with height difference;
    // it overrides river banks so the carriageway stays on its profile
    if (q.d < 72 && q.type !== ROAD.NONE) {
      const hw = this.route.halfWidth;
      const dh = Math.abs(h - q.h);
      const shoulder = 5 + Math.min(50, dh * 1.4);
      const w = 1 - smoothstep(hw, hw + shoulder, q.d);
      h = lerp(h, q.h - 0.0006 * q.d * q.d, w);
      o.road = 1 - smoothstep(hw - 0.6, hw + 0.8, q.d);
      o.roadType = q.type;
    }
    // fords: where the road crosses a river, a shallow channel runs over it
    if (ford) {
      const fd = 0.42 * (1 - (ford.d / ford.hw) * (ford.d / ford.hw));
      h = Math.min(h, ford.surf - fd - 0.02);
      o.water = Math.max(0, ford.surf - h);
    }
    // flatten village / bivouac pads
    for (let i = 0; i < this.places.length; i++) {
      const p = this.places[i];
      const dx = x - p.x, dz = z - p.z;
      const r2 = (p.r + 40) * (p.r + 40);
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const w = 1 - smoothstep(p.r * 0.75, p.r + 40, Math.sqrt(d2));
      h = lerp(h, p.h, w);
      o.pad = Math.max(o.pad, w);
    }
    o.h = h;
    return h;
  }

  height(x, z) { return this.sample(x, z, this._o); }

  // Colour + surface given the normal's y component (1 = flat).
  shade(x, z, o, ny) {
    const n1 = this.n1, n5 = this.n5;
    const h = o.h;
    const pn = n5.noise(x / 180, z / 180) * 0.5 + n1.noise(x / 45, z / 45) * 0.25; // patchiness
    const steep = 1 - smoothstep(0.62, 0.86, ny); // rock exposure on steep slopes
    let r = 0, g = 0, b = 0;
    const W = o._w || (o._w = new Float32Array(16));
    W.fill(0);
    const layer = (sid, c, a) => {
      if (a <= 0) return;
      if (a > 1) a = 1;
      r += (c[0] - r) * a; g += (c[1] - g) * a; b += (c[2] - b) * a;
      for (let i = 0; i < 16; i++) W[i] *= 1 - a;
      W[sid] += a;
    };
    // regional ground cover
    layer(SURF.SOIL, C.forest, 1);
    layer(SURF.SOIL, C.meadow, o.wMid * smoothstep(0.0, 0.5, pn));
    // shaded forest floor where the cedar/oak canopy closes (reads as forest from afar)
    const canopy = smoothstep(-0.45, 0.05, this.n5.noise(x / 420, z / 420)) * (o.wMid + o.wHigh * (1 - smoothstep(7500, 9500, o.zw)))
      * smoothstep(1420, 1560, h) * (1 - smoothstep(2500, 2750, h));
    layer(SURF.SOIL, C.forestShade, canopy * 0.6 * (1 - steep));
    // High Atlas: limestone north, red rock south, dry grass lower down
    if (o.wHigh > 0.01) {
      const rock = lerp(C.limestone[0], C.redRock[0], smoothstep(9000, 12500, o.zw));
      const rc = [rock, lerp(C.limestone[1], C.redRock[1], smoothstep(9000, 12500, o.zw)), lerp(C.limestone[2], C.redRock[2], smoothstep(9000, 12500, o.zw))];
      layer(SURF.SOIL, C.dryGrass, o.wHigh * 0.8);
      layer(SURF.ROCK, rc, o.wHigh * smoothstep(1900, 2700, h + pn * 300));
    }
    if (o.wPre > 0.01) {
      layer(SURF.REG, C.regLight, o.wPre);
      layer(SURF.ROCK, C.redRock, o.wPre * smoothstep(0.1, 0.6, o.mtn + pn * 0.3));
    }
    if (o.wHam > 0.01) {
      layer(SURF.REG, C.reg, o.wHam);
      layer(SURF.SAND, C.paleSand, o.wHam * smoothstep(0.15, 0.6, pn + 0.2) * (1 - smoothstep(0.2, 0.8, o.mesa)));
      layer(SURF.ROCK, C.darkRock, o.wHam * smoothstep(0.5, 1.2, o.mesa) * 0.6);
    }
    if (o.wErg > 0.01) {
      // interdune flats show reg; dune bodies are deep orange, crests lighter
      const flat = 1 - smoothstep(0.04, 0.2, o.duneRel + pn * 0.08);
      layer(SURF.SAND, C.ergSand, o.wErg);
      layer(SURF.REG, C.regLight, o.wErg * flat * 0.55 * (1 - smoothstep(26500, 29000, o.zw) * 0.6));
      layer(SURF.SAND, C.ergSandLight, o.wErg * smoothstep(0.55, 0.95, o.duneRel) * 0.5);
    }
    // dry oued beds: pale sand and gravel
    layer(SURF.SAND, C.paleSand, o.oued * 0.85);
    // steep slopes expose rock, except loose sand which can't hold a steep slope anyway
    const rockCol = o.wPre + o.wHam > 0.4 ? C.redRock : C.limestone;
    layer(SURF.ROCK, rockCol, steep * (1 - o.wErg));
    // snow above a ragged snowline, only where it can settle
    const snowLine = 3150 + this.n2.noise(x / 900, z / 900) * 220;
    layer(SURF.SNOW, C.snow, smoothstep(snowLine - 60, snowLine + 140, h) * smoothstep(0.55, 0.78, ny));
    // irrigated oasis gardens near the rivers in the arid south
    const nearRiver = 1 - smoothstep(25, 420, o.riverD);
    layer(SURF.OASIS, C.oasis, nearRiver * (o.wPre + o.wHam) * smoothstep(-0.2, 0.3, pn) * (1 - steep));
    layer(SURF.RIVERBED, C.riverbed, o.river);
    layer(SURF.SOIL, C.padEarth, smoothstep(0.3, 0.9, o.pad) * 0.8);
    if (o.road > 0) {
      if (o.roadType === ROAD.ASPHALT) layer(SURF.ASPHALT, C.asphalt, o.road);
      else layer(SURF.PISTE, o.wPre + o.wHam > 0.5 ? C.pisteRed : C.piste, o.road * 0.95);
    }
    o.r = r; o.g = g; o.b = b;
    // dominant surface for physics and detail weights for the shader
    let best = 0, bi = 0;
    for (let i = 0; i < 16; i++) if (W[i] > best) { best = W[i]; bi = i; }
    o.surf = bi;
    o.dSand = W[SURF.SAND];
    o.dRock = W[SURF.ROCK] + W[SURF.REG] * 0.5;
    o.dSnow = W[SURF.SNOW];
    o.dVeg = W[SURF.SOIL] + W[SURF.OASIS];
    return o;
  }

  // Everything physics needs at a point (normal by central differences).
  probe(x, z, o) {
    const e = 0.6;
    const hx1 = this.height(x + e, z), hx0 = this.height(x - e, z);
    const hz1 = this.height(x, z + e), hz0 = this.height(x, z - e);
    this.sample(x, z, o);
    let nx = hx0 - hx1, ny = 2 * e, nz = hz0 - hz1;
    const l = Math.hypot(nx, ny, nz);
    o.nx = nx / l; o.ny = ny / l; o.nz = nz / l;
    this.shade(x, z, o, o.ny);
    return o;
  }

  regionAt(z, x = 0) {
    const o = {};
    this.zones(x, z, o);
    return o;
  }
}

// Asymmetric dune cross-section over one wavelength, phase p in wavelengths.
// Windward (stoss) side: gentle S-curve. Lee side: straight slip face whose
// width is set so its slope equals the angle of repose for this dune height
// (rise = height × local phase gradient).
const DUNE_STATE = { windward: 1 };
function duneProfile(p, rise, L) {
  const f = p - Math.floor(p);
  const s = Math.min(0.75, Math.max(0.04, (rise * SLIP_RUN * SLIP_MARGIN) / L));
  if (f < 1 - s) {
    const g = f / (1 - s);
    DUNE_STATE.windward = 1 - smoothstep(0.85, 1.0, g);
    return g * g * (3 - 2 * g);
  }
  DUNE_STATE.windward = 0;
  return 1 - (f - (1 - s)) / s;
}
