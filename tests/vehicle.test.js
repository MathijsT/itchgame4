import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle } from '../src/vehicle/vehicle.js';
import { SURF } from '../src/world/surfaces.js';

// A synthetic test ground: flat run-up, then a slope
function ground(surf, slope, runup = 40) {
  const H = (z) => Math.max(0, z - runup) * slope;
  return {
    height: (x, z) => H(z),
    probe(x, z, o) {
      const s = z > runup ? slope : 0, l = Math.hypot(s, 1);
      o.h = H(z); o.nx = 0; o.ny = 1 / l; o.nz = -s / l; o.surf = surf; o.water = 0;
      return o;
    },
  };
}

function run(terrain, { pressure = 2.2, seconds = 10, throttle = 1, env = {}, tcs = true } = {}) {
  const v = new Vehicle();
  v.tractionAssist = tcs;
  v.reset([0, 1.0, 0], 0);
  v.targetPressure = pressure;
  for (const w of v.wheels) w.pressure = pressure;
  const e = { temp: 20, airDensity: 1.2, wind: [0, 0], storm: 0, ...env };
  const ctx = { terrain, env: e };
  for (let i = 0; i < 60; i++) v.update(1 / 60, ctx);
  v.input.throttle = throttle;
  for (let i = 0; i < seconds * 60; i++) v.update(1 / 60, ctx);
  return v;
}

test('accelerates on asphalt and stays upright', () => {
  const v = run(ground(SURF.ASPHALT, 0, 1e9), { seconds: 8 });
  assert.ok(v.fwdSpeed > 25, `speed after 8 s: ${(v.fwdSpeed * 3.6).toFixed(0)} km/h`);
  assert.ok(v.up[1] > 0.99);
});

test('deflated tyres climb a soft sand slope that bogs down inflated ones', () => {
  const hard = run(ground(SURF.SAND, 0.25, 0), { pressure: 2.2, seconds: 8 });
  const soft = run(ground(SURF.SAND, 0.25, 0), { pressure: 0.9, seconds: 8 });
  assert.ok(soft.pos[2] > hard.pos[2] + 30, `0.9 bar reached ${soft.pos[2].toFixed(0)} m, 2.2 bar ${hard.pos[2].toFixed(0)} m`);
  assert.ok(Math.max(...hard.wheels.map((w) => w.sink)) > Math.max(...soft.wheels.map((w) => w.sink)));
});

test('a slip face at the angle of repose cannot be climbed', () => {
  const v = run(ground(SURF.SAND, Math.tan(33 * Math.PI / 180)), { pressure: 0.9, seconds: 14 });
  const climbed = v.pos[1];
  assert.ok(climbed < 30, `climbed ${climbed.toFixed(1)} m up a 33° slip face`);
});

test('thin hot air costs engine power', () => {
  const sea = run(ground(SURF.ASPHALT, 0, 1e9), { seconds: 1, env: { airDensity: 1.225 } });
  const pass = run(ground(SURF.ASPHALT, 0, 1e9), { seconds: 1, env: { airDensity: 0.95 } });
  assert.ok(pass.powerFactor < sea.powerFactor * 0.85);
});

test('flooring it while bogged down in hot sand overheats the engine', () => {
  const v = run(ground(SURF.SAND, 0.25, 0), { pressure: 2.2, seconds: 60, tcs: false, env: { temp: 42, airDensity: 1.08 } });
  assert.ok(v.engineTemp > 105, `engine at ${v.engineTemp.toFixed(0)} °C`);
});
