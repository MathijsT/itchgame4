// Cameras: chase (near/far), hood, bumper and a slow cinematic orbit.
// Positions are world-space doubles; the renderer works camera-relative.

import { quat } from './core/math.js';
import { clamp, lerp } from './core/noise.js';

export const CAM_MODES = ['chase', 'far', 'hood', 'bumper', 'cinematic'];

export class GameCamera {
  constructor() {
    this.pos = [0, 100, 0];
    this.dir = [0, 0, 1];
    this.mode = 'chase';
    this.fov = 70 * Math.PI / 180;
    this.yawOff = 0; this.pitchOff = 0;
    this.headingSmooth = 0;
    this.shake = 0;
    this.t = 0;
  }

  cycle() {
    const i = CAM_MODES.indexOf(this.mode);
    this.mode = CAM_MODES[(i + 1) % CAM_MODES.length];
    this.snap = true;
  }

  update(dt, v, terrain, input) {
    this.t += dt;
    // free look: mouse drag or right stick, springs back when released
    if (input) {
      this.yawOff += -input.mouseDX * 0.006 + input.lookX * dt * 2.5;
      this.pitchOff += input.mouseDY * 0.004 + input.lookY * dt * 1.5;
      if (!input.dragging && Math.abs(input.lookX) < 0.1) this.yawOff *= Math.exp(-dt * 1.5);
      if (!input.dragging && Math.abs(input.lookY) < 0.1) this.pitchOff *= Math.exp(-dt * 1.5);
      this.pitchOff = clamp(this.pitchOff, -0.6, 0.9);
    }
    const f = v.forward;
    let yaw = Math.atan2(f[0], f[2]);
    // follow the direction of travel when sliding fast, so drifts read well
    const sp = Math.hypot(v.vel[0], v.vel[2]);
    if (sp > 4 && v.fwdSpeed > 0) {
      const vy = Math.atan2(v.vel[0], v.vel[2]);
      let d = vy - yaw;
      while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      yaw += d * clamp((sp - 4) / 20, 0, 0.5);
    }
    let dh = yaw - this.headingSmooth;
    while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    this.headingSmooth += dh * (this.snap ? 1 : 1 - Math.exp(-dt * 4));
    const h = this.headingSmooth + this.yawOff;
    const shake = Math.min(0.4, v.impact * 0.3) + clamp(v.speed / 50, 0, 1) * 0.01;

    if (this.mode === 'fixed') {
      // externally controlled (photo mode / tests)
    } else if (this.mode === 'chase' || this.mode === 'far') {
      const far = this.mode === 'far';
      const dist = (far ? 11 : 7.2) + v.speed * 0.03;
      const height = (far ? 3.6 : 2.5) + this.pitchOff * 4;
      const tx = v.pos[0], ty = v.pos[1] + 1.1, tz = v.pos[2];
      let cx = tx - Math.sin(h) * dist, cz = tz - Math.cos(h) * dist;
      let cy = ty + height;
      const g = terrain.height(cx, cz) + 1.2;
      if (cy < g) cy = g;
      const k = this.snap ? 1 : 1 - Math.exp(-dt * 10);
      this.pos[0] = lerp(this.pos[0], cx, k);
      this.pos[1] = lerp(this.pos[1], cy, 1 - Math.exp(-dt * 6));
      this.pos[2] = lerp(this.pos[2], cz, k);
      if (this.snap) this.pos[1] = cy;
      this.pos[1] = Math.max(this.pos[1], terrain.height(this.pos[0], this.pos[2]) + 1.0);
      const dx = tx - this.pos[0], dy = ty + 0.4 - this.pos[1], dz = tz - this.pos[2];
      const l = Math.hypot(dx, dy, dz);
      this.dir = [dx / l, dy / l, dz / l];
      this.fov = (66 + clamp(v.speed * 0.25, 0, 12)) * Math.PI / 180;
    } else if (this.mode === 'hood' || this.mode === 'bumper') {
      const local = this.mode === 'hood' ? [0, 1.12, 0.35] : [0, 0.35, 2.4];
      const p = quat.rotate([0, 0, 0], v.rot, local);
      this.pos = [v.pos[0] + p[0], v.pos[1] + p[1], v.pos[2] + p[2]];
      const look = quat.rotate([0, 0, 0], v.rot, [Math.sin(this.yawOff), -0.06 - this.pitchOff * 0.5, Math.cos(this.yawOff)]);
      const l = Math.hypot(...look);
      this.dir = [look[0] / l, look[1] / l, look[2] / l];
      this.fov = 75 * Math.PI / 180;
    } else {
      // cinematic: slow, high orbit at a distance
      const a = this.t * 0.08 + this.yawOff;
      const r = 20 + Math.sin(this.t * 0.05) * 6;
      const cx = v.pos[0] + Math.sin(a) * r, cz = v.pos[2] + Math.cos(a) * r;
      const cy = Math.max(terrain.height(cx, cz) + 3, v.pos[1] + 7 + Math.sin(this.t * 0.11) * 3);
      const k = 1 - Math.exp(-dt * 3);
      this.pos[0] = lerp(this.pos[0], cx, this.snap ? 1 : k);
      this.pos[1] = lerp(this.pos[1], cy, this.snap ? 1 : k);
      this.pos[2] = lerp(this.pos[2], cz, this.snap ? 1 : k);
      const dx = v.pos[0] - this.pos[0], dy = v.pos[1] + 0.8 - this.pos[1], dz = v.pos[2] - this.pos[2];
      const l = Math.hypot(dx, dy, dz);
      this.dir = [dx / l, dy / l, dz / l];
      this.fov = 50 * Math.PI / 180;
    }
    if (shake > 0.005) {
      this.dir[0] += (Math.random() - 0.5) * shake * 0.05;
      this.dir[1] += (Math.random() - 0.5) * shake * 0.05;
    }
    this.snap = false;
  }

  // Scenic flyover for the title screen
  flyover(dt, terrain, focus) {
    this.t += dt;
    const a = this.t * 0.025;
    const r = 260;
    const cx = focus[0] + Math.sin(a) * r, cz = focus[2] + Math.cos(a) * r;
    const cy = Math.max(terrain.height(cx, cz) + 60, focus[1] + 70);
    this.pos = [cx, cy, cz];
    const dx = focus[0] - cx, dy = focus[1] + 20 - cy, dz = focus[2] - cz;
    const l = Math.hypot(dx, dy, dz);
    this.dir = [dx / l, dy / l, dz / l];
    this.fov = 55 * Math.PI / 180;
  }
}
