// World definition: Atlas Mountains & Sahara (Morocco).

import { MoroccoTerrain } from './terrain.js';
import { FLORA } from './flora.js';
import { FAUNA, STORK_NEST } from './fauna.js';
import { STAGES, REGIONS, BOUNDS, ROUTE } from './geo.js';
import { smoothstep, clamp } from '../../core/noise.js';

export default {
  id: 'morocco',
  name: 'Atlas & Sahara',
  country: 'Morocco',
  available: true,
  seed: 1977,
  latitude: 31.0,
  // October: solar declination about -6°
  declination: -6,
  blurb: 'From cedar forests where Barbary macaques forage, over a 2,300 m pass in the High Atlas, down the palm oases of the Draa and into the towering dunes of the Sahara.',
  menuColors: ['#d9884a', '#7a3b1f'],
  bounds: BOUNDS,
  stages: STAGES,
  regions: REGIONS,
  routeCtrl: ROUTE,
  flora: FLORA,
  fauna: FAUNA,
  storkNest: STORK_NEST,
  createTerrain: (seed) => new MoroccoTerrain(seed),

  // Local climate at a point. hour in [0,24). Returns sea-level-equivalent
  // values corrected for altitude with the standard lapse rate.
  climate(z, h, hour, zones) {
    const { wMid, wHigh, wPre, wHam, wErg } = zones;
    const tSea = wMid * 21 + wHigh * 21 + wPre * 27 + wHam * 30 + wErg * 31;
    const swing = wMid * 7 + wHigh * 8 + wPre * 10 + wHam * 12 + wErg * 13;
    const diurnal = Math.cos(((hour - 15) / 24) * Math.PI * 2);
    const temp = tSea + swing * diurnal - 0.0065 * h;
    // daytime convection mixes faster upper air down: windier afternoons
    const day = clamp(Math.sin(((hour - 6) / 12) * Math.PI), 0, 1);
    const windBase = (wMid * 2.5 + wHigh * (4 + h / 900) + wPre * 3.5 + wHam * 6 + wErg * 7) * (0.55 + 0.7 * day);
    // haze: dust in the desert, clear mountain air
    const haze = wMid * 0.5 + wHigh * 0.35 + wPre * 0.8 + wHam * 1.1 + wErg * 1.3;
    const stormProne = wHam * 0.6 + wErg;
    const clouds = wMid * 0.35 + wHigh * 0.45 + wPre * 0.15 + (wHam + wErg) * 0.05;
    return { temp, windBase, haze, stormProne, clouds, snowLine: 3150 };
  },

  // Prevailing wind direction (radians, direction the wind blows towards in
  // the xz plane, 0 = +z/south). Desert trade winds blow from the NE.
  windDir: (zones) => -0.35 + zones.wMid * 0.9,

  dustColor: [0.78, 0.55, 0.34],
  earthTint(zones) {
    // pisé walls take the colour of local earth: grey-brown north, red-ochre south
    const t = smoothstep(0.2, 1.0, zones.wPre + zones.wHam + zones.wErg);
    return [0.78 + 0.12 * t, 0.66 - 0.06 * t, 0.52 - 0.12 * t];
  },
};
