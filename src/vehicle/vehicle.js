// Rally-raid 4x4 physics.
//
// Rigid body with four ray-cast suspension corners and a combined-slip tyre
// model, integrated with fixed sub-steps. Environmental physics that matter:
//  - per-surface friction and rolling resistance
//  - soft-ground terramechanics: tyres sink according to contact pressure
//    (tyre pressure!) and dig in when they spin, adding bulldozing resistance
//  - engine power scales with air density (altitude + temperature)
//  - radiator cooling depends on airflow, air density and ambient temperature
//  - aerodynamic drag relative to the (gusty) wind
//  - wading drag in rivers, punctures on rough ground at low pressure,
//    suspension damage on hard landings, collisions with trees and rocks.

import { v3, quat } from '../core/math.js';
import { clamp, lerp, smoothstep } from '../core/noise.js';
import { SURFACES } from '../world/surfaces.js';

const G = 9.81;
const SUB_DT = 1 / 240;

// Magic-formula style curve, peak 1.0 at x = 1, ~0.87 when sliding
const MF_B = 1.4, MF_C = 1.65;
function mf(x) { return Math.sin(MF_C * Math.atan(MF_B * x)); }
function mfd(x) { const bx = MF_B * x; return Math.cos(MF_C * Math.atan(bx)) * MF_C * MF_B / (1 + bx * bx); }

// torque curve (N·m) vs rpm for a 5-litre V8 restricted rally engine
function engineTorque(rpm) {
  const pts = [[0, 300], [1000, 360], [2000, 450], [3500, 540], [4500, 550], [5500, 500], [6200, 450], [6800, 0]];
  for (let i = 1; i < pts.length; i++) {
    if (rpm < pts[i][0]) {
      const a = pts[i - 1], b = pts[i];
      return a[1] + (b[1] - a[1]) * ((rpm - a[0]) / (b[0] - a[0]));
    }
  }
  return 0;
}

export const SPEC = {
  mass: 2050,
  inertia: [4400, 5000, 1500], // pitch (x), yaw (y), roll (z) kg·m²
  wheelRadius: 0.42,
  wheelInertia: 2.2,
  wheelbase: 2.95,
  track: 1.78,
  mountY: 0.2,         // suspension mount height in body frame (body origin ≈ CoM)
  restLength: 0.62,
  travel: 0.34,
  spring: 58000,
  damperBump: 4800,
  damperRebound: 6800,
  antiRoll: 16000,
  maxSteer: 0.56,
  gears: [3.75, 2.35, 1.65, 1.25, 0.98, 0.8],
  reverse: 3.5,
  finalDrive: 5.2,
  idle: 900,
  redline: 6500,
  maxBrake: 3600,      // N·m per wheel
  diffLock: 900,       // driveline coupling, N·m per rad/s of speed difference
  cda: 1.25,
  tank: 90,
  speedLimit: 47.2,    // FIA rally-raid limiter 170 km/h
  // chassis collision points (body frame)
  hull: [
    [-0.95, -0.3, 2.25], [0.95, -0.3, 2.25], [-0.95, -0.3, -2.25], [0.95, -0.3, -2.25],
    [-0.9, 1.05, 1.0], [0.9, 1.05, 1.0], [-0.9, 1.05, -1.6], [0.9, 1.05, -1.6],
    [0, -0.4, 0], [0, 1.1, -0.3],
  ],
};

class Wheel {
  constructor(x, z, front) {
    this.local = [x, SPEC.mountY, z];
    this.front = front;
    this.left = x < 0;
    this.w = 0;              // angular velocity rad/s
    this.angle = 0;          // visual spin
    this.comp = 0;           // suspension compression (m)
    this.prevComp = 0;
    this.contact = false;
    this.Fz = 0;
    this.slipRatio = 0;
    this.slipAngle = 0;
    this.slipSpeed = 0;
    this.sink = 0;           // sinkage into soft ground (m)
    this.surf = SURFACES[2];
    this.ground = { nx: 0, ny: 1, nz: 0, water: 0 };
    this.pressure = 2.2;     // bar
    this.punctured = false;
    this.damage = 0;         // suspension damage 0..1
    this.steer = 0;
    this.worldPos = [0, 0, 0];
    this.contactPos = [0, 0, 0];
    this.load = 0;
  }
}

export class Vehicle {
  constructor() {
    this.pos = [0, 0, 0];
    this.vel = [0, 0, 0];
    this.rot = quat.identity();
    this.angVel = [0, 0, 0];
    const hw = SPEC.track / 2, hb = SPEC.wheelbase / 2;
    this.wheels = [new Wheel(-hw, hb, true), new Wheel(hw, hb, true), new Wheel(-hw, -hb, false), new Wheel(hw, -hb, false)];
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this.thr = 0; this.brk = 0;
    this.steer = 0;
    this.gear = 1;           // -1 reverse, 0 neutral, 1..6
    this.autoShift = true;
    this.tractionAssist = true;
    this.tcs = 1;
    this.shiftTimer = 0;
    this.shiftLock = 0;
    this.rpm = SPEC.idle;
    this.engineTemp = 85;
    this.engineHealth = 1;
    this.radiatorHealth = 1;
    this.bodyDamage = 0;
    this.filter = 1;
    this.fuel = SPEC.tank * 0.8;
    this.targetPressure = 2.2;
    this.spares = 2;
    this.headlights = false;
    this.powerFactor = 1;
    this.lastPower = 0;
    this.engineLoad = 0;
    this.speed = 0;
    this.fwdSpeed = 0;
    this.events = [];        // [{type, text}] consumed by game for HUD toasts
    this.impact = 0;         // recent impact strength for sound/camera shake
    this.airborne = 0;
    this.distance = 0;
    this.limpMode = false;
    this.dustOut = 0;
    this._acc = 0;
    this._f = [0, 0, 0]; this._t = [0, 0, 0];
  }

  reset(pos, yaw) {
    v3.copy(this.pos, pos);
    this.rot = quat.fromYaw(yaw);
    v3.set(this.vel, 0, 0, 0);
    v3.set(this.angVel, 0, 0, 0);
    for (const w of this.wheels) { w.w = 0; w.sink = 0; w.comp = 0; w.prevComp = 0; }
    this.gear = 1;
  }

  get forward() { return quat.rotate([0, 0, 0], this.rot, [0, 0, 1]); }
  get up() { return quat.rotate([0, 0, 0], this.rot, [0, 1, 0]); }
  get right() { return quat.rotate([0, 0, 0], this.rot, [1, 0, 0]); }
  get yaw() { const f = this.forward; return Math.atan2(f[0], f[2]); }

  emit(type, text) { this.events.push({ type, text }); }

  // ctx: { terrain, env, colliders(x,z,r) -> array of [x,z,r], dt }
  update(dt, ctx) {
    dt = Math.min(dt, 1 / 20);
    const { terrain } = ctx;
    // per-frame ground probe under each wheel (normal, surface, water)
    for (const w of this.wheels) {
      quat.rotate(w.worldPos, this.rot, w.local);
      v3.add(w.worldPos, w.worldPos, this.pos);
      const p = terrain.probe(w.worldPos[0], w.worldPos[2], w.ground);
      w.surf = SURFACES[p.surf] || SURFACES[2];
      w.waterDepth = p.water;
    }
    this._near = ctx.colliders ? ctx.colliders(this.pos[0], this.pos[2], 8) : [];
    this._updateDriver(dt, ctx);
    this._acc += dt;
    let steps = 0;
    while (this._acc >= SUB_DT && steps < 12) {
      this._step(SUB_DT, ctx);
      this._acc -= SUB_DT;
      steps++;
    }
    if (steps >= 12) this._acc = 0;
    this._updateSystems(dt, ctx);
    for (const w of this.wheels) w.angle += w.w * dt;
  }

  _updateDriver(dt, ctx) {
    const inp = this.input;
    const fwd = this.forward;
    this.fwdSpeed = v3.dot(this.vel, fwd);
    this.speed = v3.len(this.vel);
    // steering: rate-limited, reduced lock at speed
    const maxSteer = SPEC.maxSteer / (1 + Math.abs(this.fwdSpeed) / 22);
    const target = inp.steer * maxSteer;
    const rate = 2.6 * dt;
    this.steer += clamp(target - this.steer, -rate, rate);
    // simple Ackermann: inner wheel turns more
    const t = this.steer;
    const k = 0.12;
    this.wheels[0].steer = t * (t > 0 ? 1 - k : 1 + k);
    this.wheels[1].steer = t * (t > 0 ? 1 + k : 1 - k);
    // gear logic: brake held at standstill selects reverse
    if (this.autoShift) {
      if (this.gear > 0 && inp.brake > 0.5 && inp.throttle < 0.1 && this.fwdSpeed < 0.6) this.gear = -1;
      else if (this.gear === -1 && inp.throttle > 0.1 && this.fwdSpeed > -0.6) this.gear = 1;
      if (this.gear > 0 && this.shiftTimer <= 0 && this.shiftLock <= 0) {
        // shift on road speed (not spinning wheels) to avoid hunting
        const wheelRpm = Math.max(0, this.fwdSpeed) / SPEC.wheelRadius * 60 / (2 * Math.PI);
        const ratio = SPEC.gears[this.gear - 1] * SPEC.finalDrive;
        const rpm = wheelRpm * ratio;
        const upAt = 5600 + 600 * inp.throttle;
        if (rpm > upAt && this.gear < SPEC.gears.length && this._grounded() >= 2) { this.gear++; this.shiftTimer = 0.22; this.shiftLock = 0.9; }
        else if (this.gear > 1) {
          const lower = wheelRpm * SPEC.gears[this.gear - 2] * SPEC.finalDrive;
          if (rpm < 2000 + 1300 * inp.throttle && lower < 5600) { this.gear--; this.shiftTimer = 0.18; this.shiftLock = 0.9; }
        }
      }
    }
    this.shiftTimer -= dt;
    this.shiftLock -= dt;
    // in reverse the pedals swap roles: brake key drives backwards
    if (this.gear === -1) { this.thr = inp.brake; this.brk = inp.throttle; }
    else { this.thr = inp.throttle; this.brk = inp.brake; }
    // hill hold: a stationary car with no pedals pressed keeps its brakes on
    if (Math.abs(this.fwdSpeed) < 0.8 && this.thr < 0.05) this.brk = Math.max(this.brk, 0.35);
    // traction assist: trims throttle when driven wheels spin well beyond road speed
    // (some spin is allowed: loose sand needs it to keep momentum)
    if (this.tractionAssist) {
      let spin = 0;
      for (const w of this.wheels) if (w.contact) spin = Math.max(spin, Math.abs(w.slipSpeed));
      const allowed = 2.2 + Math.abs(this.fwdSpeed) * 0.12;
      const target = spin > allowed ? clamp(1 - (spin - allowed) / 4, 0.25, 1) : 1;
      this.tcs += (target - this.tcs) * Math.min(1, dt * (target < this.tcs ? 12 : 3));
      this.thr *= this.tcs;
    }
    // tyre pressure: on-board inflation system (deflate fast, inflate slowly)
    for (const w of this.wheels) {
      if (w.punctured) { w.pressure = Math.max(0.25, w.pressure - dt * 0.8); continue; }
      const d = this.targetPressure - w.pressure;
      w.pressure += clamp(d, -0.16 * dt, 0.06 * dt);
    }
  }

  shiftUp() { if (this.gear < SPEC.gears.length) { this.gear = Math.max(1, this.gear + 1); this.shiftTimer = 0.2; } }
  shiftDown() { if (this.gear > -1) { this.gear--; if (this.gear === 0) this.gear = -1; this.shiftTimer = 0.2; } }

  _grounded() { let n = 0; for (const w of this.wheels) if (w.contact) n++; return n; }

  _wheelRpm() {
    let s = 0;
    for (const w of this.wheels) s += Math.abs(w.w);
    return (s / 4) * 60 / (2 * Math.PI);
  }

  _step(dt, ctx) {
    const { terrain, env } = ctx;
    const F = this._f, T = this._t;
    v3.set(F, 0, -G * SPEC.mass, 0);
    v3.set(T, 0, 0, 0);
    const up = this.up, fwdB = this.forward;
    const inp = this.input;

    // ---- engine & clutch
    const ratio = this.gear === -1 ? -SPEC.reverse * SPEC.finalDrive : this.gear > 0 ? SPEC.gears[this.gear - 1] * SPEC.finalDrive : 0;
    const wheelW = (this.wheels[0].w + this.wheels[1].w + this.wheels[2].w + this.wheels[3].w) / 4;
    const coupled = Math.abs(wheelW * ratio) * 60 / (2 * Math.PI);
    let throttle = this.shiftTimer > 0 ? 0 : this.thr;
    if (this.speed > SPEC.speedLimit) throttle = 0;
    const freeRpm = SPEC.idle + throttle * 3600;
    // clutch slips below ~1400 rpm coupled speed (pulling away)
    const slipping = coupled < 1400;
    const targetRpm = slipping ? Math.max(coupled, lerp(SPEC.idle, freeRpm, 0.7)) : coupled;
    this.rpm = clamp(lerp(this.rpm, targetRpm, 1 - Math.exp(-dt * (slipping ? 8 : 40))), SPEC.idle * 0.8, SPEC.redline + 200);
    const torqueAvail = engineTorque(this.rpm) * this.powerFactor;
    let engT = throttle * torqueAvail;
    if (this.rpm > SPEC.redline) engT = 0;
    // engine braking when off throttle
    const engBrake = (1 - throttle) * (this.rpm / SPEC.redline) * 45;
    const driveTorqueTotal = ratio !== 0 ? (engT * 0.9) * Math.sign(ratio) * Math.abs(ratio) : 0;
    const engBrakeTotal = ratio !== 0 ? engBrake * Math.abs(ratio) : 0;
    this.engineLoad = throttle;
    this.lastPower = engT * this.rpm * 2 * Math.PI / 60;

    // ---- wheels
    let grounded = 0;
    const R = SPEC.wheelRadius;
    const antiRollF = (this.wheels[0].comp - this.wheels[1].comp) * SPEC.antiRoll;
    const antiRollR = (this.wheels[2].comp - this.wheels[3].comp) * SPEC.antiRoll;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const mount = w.worldPos;
      quat.rotate(mount, this.rot, w.local);
      v3.add(mount, mount, this.pos);
      // ray down the suspension axis to the (sunken) ground surface
      const dirx = -up[0], diry = -up[1], dirz = -up[2];
      const maxLen = SPEC.restLength + R;
      let t = maxLen * 0.8;
      let gy = 0;
      for (let it = 0; it < 3; it++) {
        const px = mount[0] + dirx * t, pz = mount[2] + dirz * t;
        gy = terrain.height(px, pz) - w.sink;
        // intersect ray with horizontal plane at gy, corrected by the ground normal
        const g = w.ground;
        const denom = dirx * g.nx + diry * g.ny + dirz * g.nz;
        const num = (gy - mount[1]) * g.ny + ((px - mount[0]) * g.nx + (pz - mount[2]) * g.nz);
        // plane through (px, gy, pz) with normal n
        t = Math.abs(denom) > 1e-3 ? (num) / denom : t;
        if (t < 0) t = 0;
        if (t > maxLen * 1.5) break;
      }
      const dist = t;
      // the ray must actually point into the ground (not when on its side/roof)
      const facing = dirx * w.ground.nx + diry * w.ground.ny + dirz * w.ground.nz;
      const travelMax = SPEC.travel * (w.damage > 0.95 ? 0.4 : 1);
      let comp = maxLen - dist;
      w.contact = comp > 0 && facing < -0.35;
      w.prevComp = w.comp;
      if (!w.contact) {
        w.comp = lerp(w.comp, 0, 0.2);
        w.Fz = 0; w.slipSpeed = 0;
        // free wheel: driven and braked
        const tq = driveTorqueTotal / 4 - Math.sign(w.w) * (engBrakeTotal / 4 + this.brk * SPEC.maxBrake * 0.3);
        w.w += (tq / SPEC.wheelInertia) * dt;
        w.w *= 0.999;
        continue;
      }
      grounded++;
      comp = Math.min(comp, travelMax + 0.08);
      w.comp = comp;
      const compVel = (w.comp - w.prevComp) / dt;
      const health = 1 - w.damage * 0.6;
      let fs = SPEC.spring * health * Math.min(comp, travelMax);
      if (comp > travelMax) {
        // bump stop: very stiff, and hard hits damage the corner
        fs += (comp - travelMax) * 600000;
        if (compVel > 2.8) {
          const dmg = (compVel - 2.8) * 0.01;
          w.damage = Math.min(1, w.damage + dmg);
          this.impact = Math.max(this.impact, compVel / 6);
          if (dmg > 0.02) this.emit('damage', `Hard landing — ${w.front ? 'front' : 'rear'} ${w.left ? 'left' : 'right'} suspension damaged`);
        }
      }
      fs += (compVel > 0 ? SPEC.damperBump : SPEC.damperRebound) * health * compVel;
      fs += (i < 2 ? (i === 0 ? antiRollF : -antiRollF) : (i === 2 ? antiRollR : -antiRollR));
      const Fz = Math.max(0, fs);
      w.Fz = Fz;
      w.load = Fz;
      // contact point and its velocity
      const cp = w.contactPos;
      cp[0] = mount[0] + dirx * dist; cp[1] = mount[1] + diry * dist; cp[2] = mount[2] + dirz * dist;
      const rx = cp[0] - this.pos[0], ry = cp[1] - this.pos[1], rz = cp[2] - this.pos[2];
      const av = this.angVel;
      const vx = this.vel[0] + av[1] * rz - av[2] * ry;
      const vy = this.vel[1] + av[2] * rx - av[0] * rz;
      const vz = this.vel[2] + av[0] * ry - av[1] * rx;
      const n = [w.ground.nx, w.ground.ny, w.ground.nz];
      // wheel heading (steer about body up), projected on the ground plane
      let hx = fwdB[0], hy = fwdB[1], hz = fwdB[2];
      if (w.steer !== 0) {
        const c = Math.cos(w.steer), s = Math.sin(w.steer);
        const rgt = this.right;
        hx = fwdB[0] * c + rgt[0] * s; hy = fwdB[1] * c + rgt[1] * s; hz = fwdB[2] * c + rgt[2] * s;
      }
      const hn = hx * n[0] + hy * n[1] + hz * n[2];
      hx -= n[0] * hn; hy -= n[1] * hn; hz -= n[2] * hn;
      const hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
      // lateral axis = n × heading
      const sx = n[1] * hz - n[2] * hy, sy = n[2] * hx - n[0] * hz, sz = n[0] * hy - n[1] * hx;
      const vLong = vx * hx + vy * hy + vz * hz;
      const vLat = vx * sx + vy * sy + vz * sz;

      // ---- surface & terramechanics
      const surf = w.surf;
      const P = w.pressure;
      const soft = surf.soft;
      const spin = w.w * R - vLong;
      w.slipSpeed = spin;
      // equilibrium sinkage grows with contact pressure (≈ tyre pressure) and load; speed lets tyres plane
      const sinkEq = soft * 0.055 * Math.pow(Math.max(P, 0.3), 1.25) * (Fz / 5000) / (1 + Math.abs(vLong) / 14);
      const dig = soft * Math.max(0, Math.abs(spin) - 1.5) * 0.035;
      w.sink += (sinkEq - w.sink) * Math.min(1, dt * 1.6) + dig * dt;
      w.sink = clamp(w.sink, 0, 0.42);
      if (soft < 0.05) w.sink *= 0.9;
      let mu = surf.mu * (1 + soft * 0.28 * (2.2 - P) / 1.4);
      // loose avalanche sand on slip faces (near the angle of repose) gives way
      mu *= 1 - soft * 0.3 * smoothstep(0.93, 0.85, w.ground.ny);
      if (w.punctured) mu *= 0.75;
      if (w.waterDepth > 0.05) mu *= 0.85;
      // low pressure softens the carcass: lazier cornering response
      const kPeak = 0.1 + soft * 0.1;
      const aPeak = (0.11 + soft * 0.08) * Math.sqrt(2.2 / Math.max(P, 0.5)) * (w.punctured ? 1.6 : 1);
      const vRef = Math.max(Math.abs(vLong), 2.5);
      const kappa = spin / vRef;
      const alpha = Math.atan2(vLat, vRef);
      const kn = kappa / kPeak, an = alpha / aPeak;
      const rho = Math.hypot(kn, an);
      const muFz = mu * Fz;
      let Fx = 0, Fy = 0, dFxdw = 0;
      if (rho > 1e-6) {
        const m = mf(rho);
        Fx = muFz * m * (kn / rho);
        Fy = -muFz * m * (an / rho);
        // derivative of Fx w.r.t. wheel speed (for the implicit wheel update)
        const dkn = R / vRef / kPeak;
        const dm = mfd(rho);
        // past the peak the slope turns negative; keep the implicit term stabilising only
        dFxdw = Math.max(0, muFz * (dm * (kn / rho) * (kn / rho) + (m / rho) * (1 - (kn / rho) * (kn / rho))) * dkn);
      } else {
        dFxdw = muFz * MF_B * MF_C * R / vRef / kPeak;
      }
      w.slipRatio = kappa; w.slipAngle = alpha;
      // rolling + bulldozing resistance (opposes rolling direction)
      const crr = surf.crr * (w.punctured ? 3 : 1) * (1 + Math.max(0, 1.6 - P) * (1 - soft) * 0.25) + 0.55 * w.sink / R;
      const Frr = crr * Fz * Math.tanh(vLong / 0.4);

      // ---- wheel spin (implicit in the stiff tyre force)
      // 4WD with locked centre and limited-slip axles: a stiff coupling pulls
      // every wheel towards the mean driveline speed (solved implicitly)
      const tq = driveTorqueTotal / 4 - Math.sign(w.w) * engBrakeTotal / 4;
      const I = SPEC.wheelInertia;
      const Kc = ratio !== 0 ? SPEC.diffLock : 0;
      let wn = (w.w + (dt / I) * (tq - Fx * R + dFxdw * R * w.w + Kc * wheelW)) / (1 + (dt / I) * (dFxdw * R + Kc));
      // brakes (front-biased) and handbrake (rears): reduce |w| without reversing
      let brakeT = this.brk * SPEC.maxBrake * (w.front ? 1.15 : 0.85);
      if (!w.front) brakeT += inp.handbrake * 5000;
      const dw = (brakeT / I) * dt;
      if (Math.abs(wn) <= dw) wn = 0; else wn -= Math.sign(wn) * dw;
      // recompute slip force with the new wheel speed for consistency
      const spin2 = wn * R - vLong;
      const kn2 = spin2 / vRef / kPeak;
      const rho2 = Math.hypot(kn2, an);
      if (rho2 > 1e-6) {
        const m2 = mf(rho2);
        Fx = muFz * m2 * (kn2 / rho2);
        Fy = -muFz * m2 * (an / rho2);
      }
      w.w = wn;
      // wading drag on the wheel
      const wade = w.waterDepth > 0 ? Math.min(w.waterDepth, 0.9) : 0;
      const Fw = 0.5 * 1000 * 0.9 * (wade * 0.35) * vLong * Math.abs(vLong);

      const fxTot = Fx - Frr - Fw;
      // suspension force acts along body up; tyre forces in the ground plane
      const ax = up[0] * Fz + hx * fxTot + sx * Fy;
      const ay = up[1] * Fz + hy * fxTot + sy * Fy;
      const az = up[2] * Fz + hz * fxTot + sz * Fy;
      F[0] += ax; F[1] += ay; F[2] += az;
      // torque about CoM; tyre forces applied at the contact patch
      T[0] += ry * az - rz * ay;
      T[1] += rz * ax - rx * az;
      T[2] += rx * ay - ry * ax;
    }
    this.airborne = grounded === 0 ? this.airborne + dt : 0;

    // ---- aerodynamics (relative to the wind) and body wading drag
    const rho = env ? env.airDensity : 1.2;
    const wx = env ? env.wind[0] : 0, wz = env ? env.wind[1] : 0;
    const rvx = this.vel[0] - wx, rvy = this.vel[1], rvz = this.vel[2] - wz;
    const rv = Math.hypot(rvx, rvy, rvz);
    const dragK = 0.5 * rho * SPEC.cda;
    F[0] -= dragK * rvx * rv; F[1] -= dragK * rvy * rv; F[2] -= dragK * rvz * rv;
    // crosswind on the slab-sided body: extra side area
    const rgt = this.right;
    const side = rvx * rgt[0] + rvz * rgt[2];
    const sideF = 0.5 * rho * 3.2 * side * Math.abs(side);
    F[0] -= rgt[0] * sideF; F[2] -= rgt[2] * sideF;

    // ---- chassis vs terrain (penalty contact along the ground normal)
    const hp = [0, 0, 0];
    for (const h of SPEC.hull) {
      quat.rotate(hp, this.rot, h);
      const px = hp[0] + this.pos[0], py = hp[1] + this.pos[1], pz = hp[2] + this.pos[2];
      const gh = terrain.height(px, pz);
      const pen = gh - py;
      if (pen <= 0) continue;
      const e = 0.8;
      const gx = terrain.height(px + e, pz) - terrain.height(px - e, pz);
      const gzz = terrain.height(px, pz + e) - terrain.height(px, pz - e);
      let nx = -gx, ny = 2 * e, nz = -gzz;
      const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const av = this.angVel;
      const vx = this.vel[0] + av[1] * hp[2] - av[2] * hp[1];
      const vy = this.vel[1] + av[2] * hp[0] - av[0] * hp[2];
      const vz = this.vel[2] + av[0] * hp[1] - av[1] * hp[0];
      const vn = vx * nx + vy * ny + vz * nz;
      const fn = Math.max(0, Math.min(pen, 1.5) * 260000 - vn * 26000);
      // sliding friction
      const tx = vx - nx * vn, ty = vy - ny * vn, tz = vz - nz * vn;
      const tl = Math.hypot(tx, ty, tz);
      const ff = tl > 0.01 ? Math.min(0.55 * fn, tl * 8000) / tl : 0;
      const ax = nx * fn - tx * ff, ay = ny * fn - ty * ff, az = nz * fn - tz * ff;
      F[0] += ax; F[1] += ay; F[2] += az;
      T[0] += hp[1] * az - hp[2] * ay; T[1] += hp[2] * ax - hp[0] * az; T[2] += hp[0] * ay - hp[1] * ax;
      if (-vn > 5) {
        this.bodyDamage = Math.min(1, this.bodyDamage + (-vn - 5) * 0.004);
        this.impact = Math.max(this.impact, -vn / 10);
      }
    }

    // ---- obstacles: trees, boulders, buildings as vertical cylinders
    const near = this._near;
    if (near && near.length) {
      for (let k = 0; k < 3; k++) {
        const off = (k - 1) * 1.6;
        const cx = this.pos[0] + fwdB[0] * off, cz = this.pos[2] + fwdB[2] * off;
        const cr = 1.05;
        for (let j = 0; j < near.length; j++) {
          const o = near[j];
          const dx = cx - o[0], dz = cz - o[1];
          const d = Math.hypot(dx, dz);
          const minD = cr + o[2];
          if (d >= minD || d < 1e-4) continue;
          if (o[3] !== undefined && this.pos[1] - 0.45 > o[3]) continue; // clears a low obstacle
          const nx = dx / d, nz = dz / d;
          const pen = minD - d;
          const vn = this.vel[0] * nx + this.vel[2] * nz;
          const fn = Math.max(0, pen * 400000 - vn * 30000);
          F[0] += nx * fn; F[2] += nz * fn;
          const rx = cx - nx * cr - this.pos[0], rz = cz - nz * cr - this.pos[2];
          T[1] += rz * nx * fn - rx * nz * fn;
          if (-vn > 3) {
            const hit = -vn;
            this.bodyDamage = Math.min(1, this.bodyDamage + (hit - 3) * 0.012);
            if (k === 2) this.radiatorHealth = Math.max(0, this.radiatorHealth - (hit - 3) * 0.03);
            this.impact = Math.max(this.impact, hit / 8);
            if (hit > 6) this.emit('crash', 'Collision!');
          }
        }
      }
    }

    // ---- integrate
    const m = SPEC.mass;
    v3.addScaled(this.vel, this.vel, F, dt / m);
    v3.addScaled(this.pos, this.pos, this.vel, dt);
    // angular: body-frame inertia
    const wb = quat.rotateInv([0, 0, 0], this.rot, this.angVel);
    const tb = quat.rotateInv([0, 0, 0], this.rot, T);
    const I = SPEC.inertia;
    const Iw = [I[0] * wb[0], I[1] * wb[1], I[2] * wb[2]];
    const gyro = v3.cross([0, 0, 0], wb, Iw);
    wb[0] += ((tb[0] - gyro[0]) / I[0]) * dt;
    wb[1] += ((tb[1] - gyro[1]) / I[1]) * dt;
    wb[2] += ((tb[2] - gyro[2]) / I[2]) * dt;
    // light angular damping (air + suspension friction)
    const ad = Math.exp(-dt * (grounded ? 0.4 : 0.15));
    v3.scale(wb, wb, ad);
    quat.rotate(this.angVel, this.rot, wb);
    quat.integrate(this.rot, this.angVel, dt);
    this.distance += Math.hypot(this.vel[0], this.vel[2]) * dt;
  }

  _updateSystems(dt, ctx) {
    const env = ctx.env;
    const airT = env ? env.temp : 20;
    const rho = env ? env.airDensity : 1.2;
    // power: air density (altitude & heat), clogged filter, overheating, damage
    const densityFactor = Math.pow(rho / 1.2, 0.85);
    let heatFactor = 1;
    if (this.engineTemp > 120) heatFactor = lerp(1, 0.45, clamp((this.engineTemp - 120) / 12, 0, 1));
    this.limpMode = this.engineTemp > 120;
    this.powerFactor = densityFactor * (0.7 + 0.3 * this.filter) * heatFactor * (0.4 + 0.6 * this.engineHealth);
    this.densityFactor = densityFactor;
    // coolant: heat in ~ shaft power; radiator rejects heat by airflow & ΔT
    const P = Math.max(0, this.lastPower);
    const heatIn = P * 0.85 + 6000;
    const airflow = 0.15 + clamp(this.speed / 22, 0, 1.1) + (this.engineTemp > 96 ? 0.25 : 0);
    const thermostat = clamp((this.engineTemp - 82) / 8, 0.05, 1);
    const UA = 1650 * this.radiatorHealth * (rho / 1.2);
    let wading = 0;
    for (const w of this.wheels) wading = Math.max(wading, w.waterDepth || 0);
    const cool = UA * (this.engineTemp - airT) * airflow * thermostat + wading * 40000;
    this.engineTemp += ((heatIn - cool) / 62000) * dt;
    this.engineTemp = Math.max(airT, this.engineTemp);
    if (this.engineTemp > 128) {
      this.engineHealth = Math.max(0, this.engineHealth - (this.engineTemp - 128) * 0.0015 * dt);
    }
    // fuel: brake-specific consumption from power, scaled for the compressed map
    // brake-specific consumption, scaled ×9 because the map compresses rally distances
    const fuelRate = (P / 1000) * 0.25 / 0.74 / 3600 * 9.0 + 0.002;
    this.fuel = Math.max(0, this.fuel - fuelRate * dt);
    if (this.fuel <= 0) this.powerFactor = 0;
    // filter clogs in dust storms and while ploughing sand
    let dust = 0;
    for (const w of this.wheels) dust += (w.surf.dust || 0) * Math.min(1, Math.abs(w.slipSpeed) / 6 + this.speed / 60);
    this.dustOut = dust / 4;
    this.filter = Math.max(0, this.filter - dt * ((env ? env.storm : 0) * 0.0025 + this.dustOut * 0.00012));
    // punctures: rough ground, low pressure, speed
    for (const w of this.wheels) {
      if (w.punctured || !w.contact) continue;
      const risk = w.surf.rough * Math.max(0, 1.5 - w.pressure) * Math.max(0, this.speed - 12) / 25 + w.surf.rough * Math.max(0, this.speed - 38) / 200;
      if (Math.random() < risk * 0.01 * dt) {
        w.punctured = true;
        this.emit('puncture', `Puncture! ${w.front ? 'Front' : 'Rear'} ${w.left ? 'left' : 'right'} tyre — stop and press F to fit a spare`);
      }
    }
    this.impact *= Math.exp(-dt * 4);
  }

  // Fit a spare to the worst punctured wheel (must be nearly stopped)
  fitSpare() {
    if (this.speed > 1.5) return 'Stop the car to change a wheel';
    const w = this.wheels.find((x) => x.punctured);
    if (!w) return 'No punctured tyre';
    if (this.spares <= 0) return 'No spare tyres left';
    w.punctured = false; w.pressure = this.targetPressure; this.spares--;
    return `Spare fitted (${this.spares} left)`;
  }

  repairAll() {
    for (const w of this.wheels) { w.punctured = false; w.damage = 0; w.pressure = this.targetPressure; }
    this.engineHealth = 1; this.radiatorHealth = 1; this.bodyDamage = 0; this.filter = 1; this.spares = 2;
    this.engineTemp = Math.min(this.engineTemp, 90);
  }

  get damageSummary() {
    let susp = 0;
    for (const w of this.wheels) susp = Math.max(susp, w.damage);
    return { susp, engine: 1 - this.engineHealth, radiator: 1 - this.radiatorHealth, body: this.bodyDamage, filter: 1 - this.filter };
  }
}
