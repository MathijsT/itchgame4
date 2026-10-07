// Endurance rally: stages along the route, GPS waypoints that must be
// validated, penalties, bivouac service between stages and rival times.

import { ROAD } from '../world/route.js';
import { mulberry32, clamp } from '../core/noise.js';

const WP_SPACING = 1500;
export const PENALTY = { missedWaypoint: 120, recovery: 30, wildlife: 60 };

const RIVALS = [
  { name: 'N. Aït Ali', team: 'Atlas Raid', skill: 0.93, color: '#e8b04a' },
  { name: 'S. Lindqvist', team: 'Nordic Sands', skill: 1.0, color: '#6fb3e0' },
  { name: 'M. Ferreira', team: 'Altiplano Racing', skill: 1.07, color: '#b9e06f' },
  { name: 'K. Tanaka', team: 'Shield Motorsport', skill: 1.16, color: '#e06f8e' },
];

export function formatTime(t, sign = false) {
  const neg = t < 0; t = Math.abs(t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ds = Math.floor((t * 10) % 10);
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}.${ds}`;
  return (neg ? '−' : sign ? '+' : '') + body;
}

export class Rally {
  constructor(world, terrain, mode = 'rally') {
    this.world = world;
    this.terrain = terrain;
    this.route = terrain.route;
    this.mode = mode;
    this.stages = world.stages.map((st, i) => this._buildStage(st, i));
    this.stageIndex = 0;
    this.state = 'ready';     // ready → countdown → running → finished → (next) ready ... → complete
    this.countdown = 0;
    this.time = 0;
    this.penalty = 0;
    this.progress = 0;
    this.results = [];        // per stage {time, penalty}
    this.events = [];
    this.rivals = RIVALS;
    this.lastRecoveryAt = -1;
  }

  _buildStage(st, i) {
    const r = this.route;
    const c0 = this.world.routeCtrl[st.from], c1 = this.world.routeCtrl[st.to];
    const s0 = i === 0 ? 0 : r.track(c0.x, c0.z).s;
    const s1 = r.track(c1.x, c1.z).s;
    const len = s1 - s0;
    const n = Math.max(2, Math.round(len / WP_SPACING));
    const wps = [];
    for (let k = 1; k <= n; k++) {
      const s = s0 + (len * k) / n;
      const p = r.at(s);
      const offroad = p.type === ROAD.NONE;
      wps.push({ s, x: p.x, z: p.z, r: offroad ? 75 : 40, done: false, missed: false, finish: k === n, offroad });
    }
    // target pace: what a strong crew manages on each surface, slowed by corners
    let ref = 0;
    for (let s = s0; s < s1; s += 8) {
      const p = r.at(s);
      let v = p.type === ROAD.ASPHALT ? 27 : p.type === ROAD.PISTE ? 22 : 14;
      const curv = Math.abs(r.curvature(s, 24));
      if (curv > 1e-4) v = Math.min(v, Math.sqrt((0.75 * 9.81) / curv));
      ref += 8 / Math.max(v, 6);
    }
    const rnd = mulberry32(1234 + i * 77);
    const rivalTimes = RIVALS.map((rv) => ref * rv.skill * (0.97 + rnd() * 0.06));
    return { ...st, index: i, s0, s1, length: len, waypoints: wps, refTime: ref, rivalTimes };
  }

  get stage() { return this.stages[this.stageIndex]; }

  get nextWaypoint() {
    const st = this.stage;
    if (!st) return null;
    return st.waypoints.find((w) => !w.done && !w.missed) || null;
  }

  startPose(stageIndex = this.stageIndex) {
    const st = this.stages[stageIndex];
    const p = this.route.at(st.s0 + 12);
    return { x: p.x, z: p.z, yaw: Math.atan2(p.tx, p.tz) };
  }

  beginCountdown() {
    if (this.state !== 'ready') return;
    this.state = 'countdown';
    this.countdown = 3.999;
    for (const w of this.stage.waypoints) { w.done = false; w.missed = false; }
    this.time = 0; this.penalty = 0;
    this.progress = this.stage.s0;
  }

  addPenalty(sec, reason) {
    if (this.state !== 'running') return;
    this.penalty += sec;
    this.events.push({ type: 'penalty', text: `+${formatTime(sec)} penalty — ${reason}` });
  }

  update(dt, vehicle) {
    const st = this.stage;
    if (!st) return;
    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after > 0) this.events.push({ type: 'count', text: String(after) });
      if (this.countdown <= 0) { this.state = 'running'; this.events.push({ type: 'go', text: 'GO!' }); }
      return;
    }
    // track progress along the route even off-piste
    const tr = this.route.track(vehicle.pos[0], vehicle.pos[2], this.progress, 900);
    this.progress = clamp(tr.s, st.s0, st.s1);
    this.offRoute = tr.d;
    if (this.state !== 'running') return;
    this.time += dt;
    for (const w of st.waypoints) {
      if (w.done || w.missed) continue;
      const d = Math.hypot(vehicle.pos[0] - w.x, vehicle.pos[2] - w.z);
      if (d < w.r) {
        w.done = true;
        if (w.finish) { this._finish(); return; }
        const idx = st.waypoints.indexOf(w) + 1;
        this.events.push({ type: 'wp', text: `Waypoint ${idx}/${st.waypoints.length} validated` });
      } else if (!w.finish && this.progress > w.s + 450) {
        w.missed = true;
        this.addPenalty(PENALTY.missedWaypoint, 'missed waypoint');
      }
    }
  }

  _finish() {
    const total = this.time + this.penalty;
    this.results[this.stageIndex] = { time: this.time, penalty: this.penalty, total };
    this.state = 'finished';
    this.events.push({ type: 'finish', text: `Stage ${this.stageIndex + 1} complete — ${formatTime(total)}` });
    try {
      const key = `terra.best.${this.world.id}.${this.stageIndex}`;
      const prev = parseFloat(localStorage.getItem(key));
      if (!(prev <= total)) localStorage.setItem(key, String(total));
    } catch { /* storage unavailable */ }
  }

  bestTime(i) {
    try { const v = parseFloat(localStorage.getItem(`terra.best.${this.world.id}.${i}`)); return Number.isFinite(v) ? v : null; } catch { return null; }
  }

  // Standings for the current stage (finished) or overall
  standings(overall = false) {
    const rows = this.rivals.map((rv, k) => ({
      name: rv.name, team: rv.team, color: rv.color,
      time: overall ? this.stages.slice(0, this.results.length).reduce((a, s) => a + s.rivalTimes[k], 0) : this.stage.rivalTimes[k],
    }));
    const mine = overall ? this.results.reduce((a, r) => a + (r ? r.total : 0), 0) : (this.results[this.stageIndex]?.total ?? this.time + this.penalty);
    rows.push({ name: 'You', team: 'Terra Endurance', color: '#ffffff', time: mine, me: true });
    rows.sort((a, b) => a.time - b.time);
    return rows;
  }

  nextStage() {
    if (this.stageIndex < this.stages.length - 1) {
      this.stageIndex++;
      this.state = 'ready';
      this.time = 0; this.penalty = 0;
      this.progress = this.stage.s0;
      return true;
    }
    this.state = 'complete';
    return false;
  }

  // live delta against the median rival's pace at this progress
  liveDelta() {
    const st = this.stage;
    const frac = clamp((this.progress - st.s0) / st.length, 0, 1);
    const pace = st.rivalTimes[1] * frac;
    return this.time + this.penalty - pace;
  }
}
