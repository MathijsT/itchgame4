import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MoroccoTerrain } from '../src/worlds/morocco/terrain.js';
import { ROAD } from '../src/world/route.js';

const T = new MoroccoTerrain(1977);

test('terrain is deterministic', () => {
  const T2 = new MoroccoTerrain(1977);
  for (const [x, z] of [[0, 0], [1234, 8765], [-4000, 30000], [2500, 15500]]) {
    assert.equal(T.height(x, z), T2.height(x, z));
  }
});

test('regions have plausible altitudes', () => {
  const band = (z0, z1) => {
    let mn = Infinity, mx = -Infinity;
    for (let z = z0; z <= z1; z += 400) for (let x = -6000; x <= 6000; x += 400) { const h = T.height(x, z); mn = Math.min(mn, h); mx = Math.max(mx, h); }
    return [mn, mx];
  };
  const high = band(7000, 11000);
  assert.ok(high[1] > 3300, `High Atlas should have peaks above 3300 m (got ${high[1].toFixed(0)})`);
  const erg = band(28000, 32000);
  assert.ok(erg[0] > 600 && erg[1] < 1100, `erg between 600 and 1100 m (got ${erg.map(Math.round)})`);
});

test('road profile respects the maximum grade and the terrain follows the road', () => {
  const r = T.route;
  for (let i = 1; i < r.n; i++) {
    const g = Math.abs(r.roadH[i] - r.roadH[i - 1]) / 8;
    assert.ok(g <= r.maxGrade + 1e-3, `grade ${g.toFixed(3)} at s=${r.s[i]}`);
  }
  let worst = 0;
  for (let i = 0; i < r.n; i += 3) {
    if (r.type[i] === ROAD.NONE) continue;
    const o = {};
    T.sample(r.x[i], r.z[i], o);
    if (o.water > 0) continue; // fords dip into the river
    if (o.pad > 0.05) continue;
    worst = Math.max(worst, Math.abs(o.h - r.roadH[i]));
  }
  assert.ok(worst < 1.0, `road surface deviates from profile by ${worst.toFixed(2)} m`);
});

test('rivers flow downhill', () => {
  for (const rv of T.rivers) {
    for (let i = 1; i < rv.n; i++) assert.ok(rv.roadH[i] <= rv.roadH[i - 1] + 1e-4, `${rv.info.name} rises at ${i}`);
  }
});

test('dune slip faces stand at the angle of repose', () => {
  const slopes = [];
  for (let z = 28500; z < 31500; z += 37) {
    for (let x = -3000; x < 3000; x += 41) {
      const e = 1;
      const hx = (T.height(x + e, z) - T.height(x - e, z)) / (2 * e);
      const hz = (T.height(x, z + e) - T.height(x, z - e)) / (2 * e);
      slopes.push(Math.atan(Math.hypot(hx, hz)) * 180 / Math.PI);
    }
  }
  slopes.sort((a, b) => a - b);
  const p99 = slopes[Math.floor(slopes.length * 0.99)];
  const max = slopes[slopes.length - 1];
  // slip faces cluster just under ~33°; domain warping leaves only rare steeper spots
  assert.ok(p99 > 28 && p99 < 37, `99th percentile dune slope ${p99.toFixed(1)}°`);
  assert.ok(max < 50, `steepest dune slope ${max.toFixed(1)}°`);
});
