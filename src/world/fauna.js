// Wildlife simulation: spawns animals around the player according to each
// species' habitat and daily activity, runs simple herd/flee/soar behaviours,
// and reports sightings for the field journal.

import { clamp, smoothstep } from '../core/noise.js';
import { angleWrap } from '../core/math.js';

const TWO_PI = Math.PI * 2;

export class FaunaSystem {
  constructor(world, terrain, env) {
    this.world = world;
    this.terrain = terrain;
    this.env = env;
    this.species = world.fauna;
    this.agents = [];
    this.spawnTimer = 0;
    this.siteO = {};
    this.counts = new Map();
    this.seen = new Map(); // species id -> seconds in view
    this.onSpot = null;    // callback(speciesDef)
    this.onStrike = null;
    this.nestStorks = [];
    this.treeGoatTrees = new Set();
  }

  // Activity multiplier from time of day / temperature
  activity(sp) {
    const e = this.env;
    const day = e.daylight;
    switch (sp.activity) {
      case 'day': return smoothstep(0.1, 0.5, day);
      case 'night': return 1 - smoothstep(0.0, 0.3, day);
      case 'dusk': {
        const el = e.sunElevation;
        return 0.25 + 0.75 * (1 - smoothstep(4, 25, Math.abs(el - 4)));
      }
      case 'warm': {
        // ectotherm: needs warmth to be active, hides from extreme ground heat
        const t = e.temp;
        return smoothstep(18, 26, t) * (1 - smoothstep(41, 46, t)) * smoothstep(0.2, 0.5, day);
      }
      default: return 1;
    }
  }

  site(x, z) {
    const t = this.terrain;
    const o = this.siteO;
    const h = t.sample(x, z, o);
    const e = 4;
    const hx = t.height(x + e, z) - t.height(x - e, z), hz = t.height(x, z + e) - t.height(x, z - e);
    const ny = 2 * e / Math.hypot(hx, 2 * e, hz);
    o.slope = 1 - ny;
    t.shade(x, z, o, ny);
    o.x = x; o.z = z; o.h = h;
    o.clump1 = t.n5.noise(x / 420, z / 420);
    o.clump2 = t.n4.noise(x / 90, z / 90);
    return o;
  }

  setNests(nests) {
    // storks standing on kasbah tower nests
    const sp = this.species.find((s) => s.id === 'stork');
    if (!sp) return;
    for (const n of nests) {
      const gy = this.terrain.height(n.x, n.z);
      this.nestStorks.push(this._make(sp, n.x, n.z, { y: gy + n.y + 0.4, state: 'nest', yaw: Math.random() * TWO_PI }));
    }
  }

  _make(sp, x, z, extra = {}) {
    const a = {
      sp, x, z, y: 0, yaw: Math.random() * TWO_PI, speed: 0, state: 'idle', timer: Math.random() * 4,
      phase: Math.random() * TWO_PI, amp: 0, head: 0, pitch: 0, bank: 0,
      scale: sp.scale[0] + Math.random() * (sp.scale[1] - sp.scale[0]),
      tint: [1, 1, 1], hx: x, hz: z, ...extra,
    };
    if (sp.variants) {
      const r = Math.random();
      a.tint = r < 0.4 ? [1, 1, 1] : r < 0.75 ? [2.6, 2.1, 1.7] : [4.4, 4.3, 4.1];
    }
    if (sp.kind === 'flyer') {
      a.cx = x; a.cz = z;
      a.alt = sp.altitude[0] + Math.random() * (sp.altitude[1] - sp.altitude[0]);
      a.radius = sp.radius[0] + Math.random() * (sp.radius[1] - sp.radius[0]);
      a.ang = Math.random() * TWO_PI;
      a.dir = Math.random() < 0.5 ? 1 : -1;
      a.flapTimer = 0;
    }
    return a;
  }

  _spawn(px, pz, fwdx, fwdz) {
    // candidate point: ring around the player, biased ahead
    const ang = Math.atan2(fwdx, fwdz) + (Math.random() - 0.5) * Math.PI * 1.4;
    const d = 140 + Math.random() * 380;
    const x = px + Math.sin(ang) * d, z = pz + Math.cos(ang) * d;
    const s = this.site(x, z);
    if (s.water > 0.1) return;
    const sp = this.species[Math.floor(Math.random() * this.species.length)];
    const count = this.counts.get(sp.id) || 0;
    if (count >= sp.maxCount) return;
    let w = sp.habitat(s) * this.activity(sp) * (sp.rarity ?? 1);
    if (!(w > 0.05) || Math.random() > w) return;
    const n = sp.group[0] + Math.floor(Math.random() * (sp.group[1] - sp.group[0] + 1));
    let cx = x, cz = z;
    // some species like to sit on tracks (macaques, camels crossing)
    if (sp.likesRoad && Math.random() < sp.likesRoad) {
      const t = this.terrain.route.track(x, z);
      if (t.d < 400) { const p = this.terrain.route.at(t.s); cx = p.x + (Math.random() - 0.5) * 10; cz = p.z + (Math.random() - 0.5) * 10; }
    }
    for (let i = 0; i < n && count + i < sp.maxCount; i++) {
      const r = sp.kind === 'flyer' ? 0 : 4 + Math.random() * 12;
      const a2 = Math.random() * TWO_PI;
      const ag = this._make(sp, cx + Math.cos(a2) * r, cz + Math.sin(a2) * r, { hx: cx, hz: cz });
      if (sp.kind === 'flyer') { ag.ang += i * 0.6; ag.alt += i * 8; }
      this.agents.push(ag);
    }
  }

  // Goats perched in argan trees, using vegetation instance data
  _spawnTreeGoats(streamer, px, pz) {
    const goat = this.species.find((s) => s.id === 'goat');
    if (!goat || !streamer) return;
    const trees = streamer.gather('argan', 0, 500);
    for (let i = 0; i < trees.length; i += 8) {
      const tx = trees[i], ty = trees[i + 1], tz = trees[i + 2], sc = trees[i + 4];
      const key = `${Math.round(tx)},${Math.round(tz)}`;
      if (this.treeGoatTrees.has(key)) continue;
      const d = Math.hypot(tx - px, tz - pz);
      if (d < 120 || d > 450) continue;
      this.treeGoatTrees.add(key);
      if (Math.random() > 0.3 || this.activity(goat) < 0.3) continue;
      const n = 2 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const a = Math.random() * TWO_PI, r = (0.6 + Math.random() * 2.2) * sc;
        this.agents.push(this._make(goat, tx + Math.cos(a) * r, tz + Math.sin(a) * r, {
          y: ty + (3.3 + Math.random() * 0.6) * sc, state: 'perch', tree: key, yaw: Math.random() * TWO_PI,
        }));
      }
    }
  }

  update(dt, player, cam, streamer) {
    const px = player.pos[0], pz = player.pos[2];
    const pv = player.speed;
    // census
    this.counts.clear();
    for (const a of this.agents) this.counts.set(a.sp.id, (this.counts.get(a.sp.id) || 0) + 1);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.35;
      const f = player.forward;
      for (let k = 0; k < 2; k++) this._spawn(px, pz, f[0], f[2]);
      this._spawnTreeGoats(streamer, px, pz);
    }
    const wind = this.env.wind;
    const keep = [];
    for (const a of this.agents) {
      const dx = a.x - px, dz = a.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > 750) { if (a.tree) this.treeGoatTrees.delete(a.tree); continue; }
      const sp = a.sp;
      if (sp.kind === 'flyer') this._fly(a, dt, wind);
      else this._walk(a, dt, dist, dx, dz, pv);
      keep.push(a);
    }
    this.agents = keep;
    for (const a of this.nestStorks) { a.timer -= dt; if (a.timer < 0) { a.timer = 3 + Math.random() * 8; a.clatter = 1.2; } a.clatter = Math.max(0, (a.clatter || 0) - dt); a.pitch = a.clatter > 0 ? 0.5 + Math.sin(this.env.t * 30) * 0.12 : 0; }

    // sightings: in view, close enough, for a moment
    const camDir = cam.dir, cp = cam.pos;
    const all = this.agents.concat(this.nestStorks);
    const inView = new Set();
    for (const a of all) {
      const vx = a.x - cp[0], vy = a.y - cp[1], vz = a.z - cp[2];
      const d = Math.hypot(vx, vy, vz);
      if (d > a.sp.spot) continue;
      if ((vx * camDir[0] + vy * camDir[1] + vz * camDir[2]) / d < 0.6) continue;
      inView.add(a.sp.id);
    }
    for (const id of inView) {
      const s = (this.seen.get(id) || 0) + dt;
      this.seen.set(id, s);
      if (s > 0.8 && s - dt <= 0.8 && this.onSpot) this.onSpot(this.species.find((x) => x.id === id));
    }
  }

  _walk(a, dt, dist, dx, dz, pv) {
    const sp = a.sp;
    const t = this.terrain;
    if (a.state === 'perch') {
      a.speed = 0; a.amp = 0;
      a.timer -= dt;
      if (a.timer < 0) { a.timer = 1 + Math.random() * 3; a.head = Math.random() < 0.5 ? 0.7 : -0.2; a.yaw += (Math.random() - 0.5) * 1.5; }
      a.phase += dt;
      return;
    }
    // flee from the vehicle when it comes close, or fast
    const threat = dist < sp.flee && (pv > 2.5 || dist < sp.flee * 0.35);
    if (threat && a.state !== 'flee') {
      a.state = 'flee';
      a.timer = 4 + Math.random() * 4;
      a.fleeDir = Math.atan2(dx, dz) + (Math.random() - 0.5) * 0.9;
    }
    a.timer -= dt;
    let targetSpeed = 0, targetYaw = a.yaw;
    if (a.state === 'flee') {
      targetSpeed = sp.run;
      targetYaw = a.fleeDir;
      a.head = 0;
      if (a.timer <= 0 && dist > sp.flee) { a.state = 'idle'; a.timer = 2 + Math.random() * 4; a.hx = a.x; a.hz = a.z; }
    } else if (a.state === 'idle') {
      a.head = Math.min(1, a.head + dt * 1.5); // grazing / foraging
      if (a.timer <= 0) {
        a.state = 'walk';
        a.timer = 3 + Math.random() * 6;
        const ang = Math.random() * TWO_PI, r = Math.random() * 20;
        a.tx = a.hx + Math.cos(ang) * r; a.tz = a.hz + Math.sin(ang) * r;
      }
    } else if (a.state === 'walk') {
      a.head = Math.max(0, a.head - dt * 2);
      targetSpeed = sp.walk;
      targetYaw = Math.atan2(a.tx - a.x, a.tz - a.z);
      if (a.timer <= 0 || Math.hypot(a.tx - a.x, a.tz - a.z) < 1.5) { a.state = 'idle'; a.timer = 2 + Math.random() * 6; }
    }
    a.yaw += clamp(angleWrap(targetYaw - a.yaw), -3 * dt, 3 * dt);
    a.speed += clamp(targetSpeed - a.speed, -sp.run * dt, sp.run * dt * 0.8);
    const nx = a.x + Math.sin(a.yaw) * a.speed * dt, nz = a.z + Math.cos(a.yaw) * a.speed * dt;
    // don't walk into rivers
    const o = this.siteO;
    t.sample(nx, nz, o);
    if (o.water > 0.15) { a.yaw += Math.PI * 0.5; a.fleeDir = a.yaw; a.speed *= 0.5; }
    else { a.x = nx; a.z = nz; }
    const gy = t.height(a.x, a.z);
    const ahead = t.height(a.x + Math.sin(a.yaw) * 0.8, a.z + Math.cos(a.yaw) * 0.8);
    a.pitch = Math.atan2(ahead - gy, 0.8) * 0.8;
    a.y = gy + (sp.yOffset ?? 0) * a.scale;
    a.phase += (a.speed / Math.max(sp.stride * a.scale, 0.1)) * Math.PI * dt;
    a.amp = clamp(a.speed / (sp.stride * a.scale * 3), 0, 0.55);
    // vehicle strike (animals usually get out of the way)
    if (dist < 2.6 && pv > 4 && !a.struck) {
      a.struck = true;
      a.state = 'flee'; a.timer = 6; a.fleeDir = Math.atan2(dx, dz);
      if (this.onStrike) this.onStrike(sp);
    }
  }

  _fly(a, dt, wind) {
    const sp = a.sp;
    // circling in a thermal that drifts downwind
    a.cx += wind[0] * 0.6 * dt; a.cz += wind[1] * 0.6 * dt;
    const omega = (sp.speed / a.radius) * a.dir;
    a.ang += omega * dt;
    a.x = a.cx + Math.cos(a.ang) * a.radius;
    a.z = a.cz + Math.sin(a.ang) * a.radius;
    const gy = this.terrain.height(a.x, a.z);
    const target = gy + a.alt;
    // rising in the thermal by day, sinking at night
    a.alt += (this.env.daylight > 0.3 ? 0.6 : -1) * dt;
    a.alt = clamp(a.alt, sp.altitude[0], sp.altitude[1] * 1.3);
    a.y = a.y ? a.y + (target - a.y) * Math.min(1, dt * 0.5) : target;
    // heading tangent to the circle, banked into the turn
    a.yaw = Math.atan2(-Math.sin(a.ang) * a.dir, Math.cos(a.ang) * a.dir);
    a.bank = -Math.atan((sp.speed * sp.speed) / (a.radius * 9.81)) * a.dir;
    a.pitch = 0;
    // mostly gliding; occasional bursts of flapping
    a.flapTimer -= dt;
    if (a.flapTimer < -6 - Math.random() * 10) a.flapTimer = 1.5 + Math.random() * 2;
    const flapping = a.flapTimer > 0 || this.env.daylight < 0.3;
    a.amp += ((flapping ? 0.7 : 0.03) - a.amp) * Math.min(1, dt * 3);
    a.phase += dt * (flapping ? 9 : 2);
  }

  // Pack instances per species: stride 12
  instances() {
    const per = new Map();
    const push = (a) => {
      let arr = per.get(a.sp.id);
      if (!arr) { arr = []; per.set(a.sp.id, arr); }
      const walker = a.sp.kind !== 'flyer';
      arr.push(a.x, a.y, a.z, a.yaw, a.scale, a.tint[0], a.tint[1], a.tint[2],
        a.phase, a.amp, walker ? a.head : a.pitch, walker ? a.pitch : a.bank);
    };
    for (const a of this.agents) push(a);
    for (const a of this.nestStorks) push(a);
    const out = new Map();
    for (const [k, v] of per) out.set(k, new Float32Array(v));
    return out;
  }
}
