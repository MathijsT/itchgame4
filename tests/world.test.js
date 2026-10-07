import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLDS, getWorld } from '../src/worlds/registry.js';
import { Environment } from '../src/world/environment.js';
import { Rally } from '../src/race/rally.js';

const world = getWorld('morocco');
const terrain = world.createTerrain(world.seed);

test('four worlds are declared, Morocco is playable', () => {
  assert.equal(WORLDS.length, 4);
  assert.ok(world.available);
  assert.ok(WORLDS.filter((w) => w.available).length >= 1);
});

test('sun rises in the east, sets in the west, and air cools with altitude', () => {
  const env = new Environment(world, terrain);
  env.setHour(8); env.update(0.01, [0, 1600, 0]);
  assert.ok(env.sunDir[1] > 0 && env.sunDir[0] > 0, 'morning sun is up and in the east');
  env.setHour(17); env.update(0.01, [0, 1600, 0]);
  assert.ok(env.sunDir[0] < 0, 'afternoon sun is in the west');
  env.setHour(0); env.update(0.01, [0, 1600, 0]);
  assert.ok(env.sunDir[1] < 0, 'midnight sun is below the horizon');
  const low = world.climate(9000, 1000, 14, { wMid: 0, wHigh: 1, wPre: 0, wHam: 0, wErg: 0 }).temp;
  const high = world.climate(9000, 3000, 14, { wMid: 0, wHigh: 1, wPre: 0, wHam: 0, wErg: 0 }).temp;
  assert.ok(Math.abs((low - high) - 13) < 0.01, 'standard lapse rate 6.5 °C/km');
});

test('rally stages chain together with ordered waypoints', () => {
  const r = new Rally(world, terrain, 'rally');
  assert.equal(r.stages.length, 4);
  for (let i = 0; i < r.stages.length; i++) {
    const st = r.stages[i];
    assert.ok(st.s1 > st.s0 + 3000, `stage ${i + 1} length ${st.length}`);
    if (i > 0) assert.ok(Math.abs(st.s0 - r.stages[i - 1].s1) < 1, 'stages are contiguous');
    for (let k = 1; k < st.waypoints.length; k++) assert.ok(st.waypoints[k].s > st.waypoints[k - 1].s);
    assert.ok(st.waypoints[st.waypoints.length - 1].finish);
    assert.ok(st.rivalTimes.every((t) => t > 60));
  }
});

test('every species has a field-guide entry and a model', () => {
  for (const sp of [...world.flora.filter((f) => !f.hidden), ...world.fauna]) {
    assert.ok(sp.name && sp.latin && sp.fact && sp.fact.length > 40, sp.id);
    const m = (sp.model.length ? sp.model(0) : sp.model()).build();
    assert.ok(m.count > 0 && !m.pos.some(Number.isNaN), sp.id);
  }
});
