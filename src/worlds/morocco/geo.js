// Geography of the Atlas & Sahara world.
// Coordinates are metres: +x east, +z south. The world is a 50 km north→south
// transect inspired by the real journey from the Middle Atlas cedar forests,
// over the High Atlas (a Tizi n'Tichka–style pass), down the Draa valley
// palm oases, across the stony hamada and into the great dunes of an erg
// modelled on Erg Chebbi.

import { ROAD } from '../../world/route.js';

export const BOUNDS = { minX: -9000, maxX: 9000, minZ: -3500, maxZ: 34000 };

const P = ROAD.PISTE, A = ROAD.ASPHALT, N = ROAD.NONE;

// Rally route control points. `road` applies to the section after the point.
export const ROUTE = [
  // Stage 1 — Middle Atlas cedar forest piste
  { x: 0, z: -1500, road: P }, { x: 350, z: -900, road: P }, { x: -200, z: -200, road: P },
  { x: -750, z: 500, road: P }, { x: -450, z: 1300, road: P }, { x: 250, z: 1900, road: P },
  { x: 850, z: 2700, road: P }, { x: 500, z: 3500, road: P }, { x: -150, z: 4200, road: P },
  { x: 150, z: 4900, road: P },
  // Stage 2 — High Atlas pass road (asphalt switchbacks)
  { x: 700, z: 5300, road: A }, { x: 1500, z: 5700, road: A }, { x: 900, z: 6200, road: A },
  { x: 300, z: 6700, road: A }, { x: 1100, z: 7100, road: A }, { x: 2000, z: 7400, road: A },
  { x: 1300, z: 7900, road: A }, { x: 700, z: 8400, road: A }, { x: 1600, z: 8800, road: A },
  { x: 2400, z: 9300, road: A }, { x: 2000, z: 9900, road: A }, { x: 2900, z: 10300, road: A },
  { x: 3600, z: 10800, road: A }, { x: 2900, z: 11300, road: A }, { x: 2200, z: 11800, road: A },
  { x: 2900, z: 12300, road: A }, { x: 3700, z: 12800, road: A }, { x: 3200, z: 13400, road: A },
  // Stage 3 — Draa valley oases piste
  { x: 3000, z: 13900, road: P }, { x: 2600, z: 14600, road: P }, { x: 3200, z: 15400, road: P },
  { x: 2500, z: 16200, road: P }, { x: 1800, z: 16900, road: P }, { x: 2200, z: 17700, road: P },
  { x: 1500, z: 18500, road: P }, { x: 900, z: 19300, road: P },
  // Stage 4 — Hamada, then off-piste through the erg
  { x: 1200, z: 20000, road: P }, { x: 1800, z: 21000, road: P }, { x: 1000, z: 22200, road: P },
  { x: 1900, z: 23400, road: P }, { x: 1300, z: 24600, road: P }, { x: 2000, z: 25600, road: N },
  { x: 2600, z: 26500, road: N }, { x: 1800, z: 27600, road: N }, { x: 2700, z: 28700, road: N },
  { x: 2000, z: 29800, road: N }, { x: 2600, z: 31000, road: N }, { x: 2400, z: 31800, road: N },
];

// Stage boundaries reference route control points by index.
export const STAGES = [
  { name: 'Cedars of the Middle Atlas', from: 0, to: 10, region: 'Middle Atlas', startHour: 7.0,
    brief: 'A fast gravel piste through Atlas cedar and holm oak forest. Watch for Barbary macaques on the track and soft ground in the clearings.' },
  { name: 'Over the High Atlas', from: 10, to: 28, region: 'High Atlas', startHour: 9.5,
    brief: 'Asphalt switchbacks climb to a 2,300 m pass. Thin air saps engine power, the temperature drops with every hairpin and the high slopes carry snow.' },
  { name: 'Palm oases of the Draa', from: 28, to: 36, region: 'Draa Valley', startHour: 13.0,
    brief: 'Down into the pre-Saharan valleys: kasbahs, date palm groves and river fords. Heat builds; keep an eye on engine temperature.' },
  { name: 'Hamada & the great erg', from: 36, to: 47, region: 'Erg', startHour: 16.0,
    brief: 'Stony hamada gives way to dunes over 100 m tall. There is no track: navigate by heading, drop tyre pressure for the sand and never climb a slip face.' },
];

// Rivers flow from the first control point to the last.
export const RIVERS = [
  { name: 'Oued Tigrigra', depth: 1.0, halfWidth: 7, ctrl: [
    { x: 4200, z: 3400 }, { x: 2200, z: 3600 }, { x: 600, z: 3300 }, { x: -800, z: 2600 },
    { x: -1500, z: 1500 }, { x: -1200, z: 300 }, { x: -2200, z: -1200 }, { x: -3500, z: -2500 } ] },
  { name: 'Assif n\'Imini', depth: 0.9, halfWidth: 6, ctrl: [
    { x: 4800, z: 10600 }, { x: 4200, z: 11600 }, { x: 3600, z: 12600 }, { x: 3600, z: 13300 },
    { x: 3900, z: 14100 } ] },
  { name: 'Oued Draa', depth: 1.3, halfWidth: 14, ctrl: [
    { x: 3900, z: 14100 }, { x: 3400, z: 14900 }, { x: 2200, z: 15600 }, { x: 2900, z: 16600 },
    { x: 2400, z: 17600 }, { x: 1300, z: 17900 }, { x: 600, z: 18700 }, { x: -600, z: 19400 },
    { x: -2400, z: 19800 }, { x: -4500, z: 19700 } ] },
];

// Places: villages, kasbahs, bivouacs. The terrain is levelled under each pad.
export const PLACES = [
  // Bivouacs sit beside the route at a control point (`at`), offset sideways.
  { name: 'Azrou forest camp', type: 'bivouac', at: 0, side: 1, r: 60, fuel: true },
  { name: 'Aït Lahcen', type: 'village', x: -1300, z: 900, r: 110, n: 14 },
  { name: 'Tizi foothills bivouac', type: 'bivouac', at: 10, side: -1, r: 60, fuel: true },
  { name: 'Taddert', type: 'village', x: 300, z: 6000, r: 90, n: 10 },
  { name: 'Ighrem n\'Tizi', type: 'village', x: 3500, z: 11700, r: 90, n: 9 },
  { name: 'Ksar Aït Imini', type: 'kasbah', x: 3950, z: 13250, r: 120, n: 12, fuel: true },
  { name: 'Agdez palmeraie', type: 'kasbah', x: 2700, z: 15900, r: 120, n: 14, fuel: true },
  { name: 'Tamnougalt', type: 'kasbah', x: 2000, z: 18000, r: 110, n: 12 },
  { name: 'Ksar Aït Imini bivouac', type: 'bivouac', at: 28, side: -1, r: 60, fuel: true },
  { name: 'Draa bivouac', type: 'bivouac', at: 36, side: 1, r: 60, fuel: true },
  { name: 'Ksar of the Hamada', type: 'kasbah', x: 1700, z: 22800, r: 100, n: 8, fuel: true },
  { name: 'Hassi Ouzina well', type: 'well', x: 2300, z: 27100, r: 60, n: 3 },
  { name: 'Merzouga finish bivouac', type: 'bivouac', at: 47, side: 1, r: 70, fuel: true },
];

// Regions along the (noise-warped) north-south axis.
export const REGIONS = [
  { name: 'Middle Atlas', sub: 'Cedar and holm oak forests', z1: 4800 },
  { name: 'High Atlas', sub: 'Juniper slopes and snowy summits', z1: 13000 },
  { name: 'Draa Valley', sub: 'Pre-Saharan palm oases', z1: 19500 },
  { name: 'Hamada', sub: 'Stony desert plateau', z1: 25500 },
  { name: 'Erg', sub: 'Sea of sand dunes', z1: Infinity },
];
