// CPU particle pool for dust plumes, sand streamers, spray and snow.
// Particles drift with the wind and settle under gravity/drag.

export class Particles {
  constructor(max = 3000) {
    this.max = max;
    this.p = new Float32Array(max * 14); // x y z vx vy vz life maxLife size grow r g b alpha
    this.n = 0;
    this.out = new Float32Array(max * 8);
    this.count = 0;
  }

  emit(x, y, z, vx, vy, vz, life, size, grow, r, g, b, a) {
    if (this.n >= this.max) return;
    const o = this.n++ * 14, p = this.p;
    p[o] = x; p[o + 1] = y; p[o + 2] = z; p[o + 3] = vx; p[o + 4] = vy; p[o + 5] = vz;
    p[o + 6] = life; p[o + 7] = life; p[o + 8] = size; p[o + 9] = grow;
    p[o + 10] = r; p[o + 11] = g; p[o + 12] = b; p[o + 13] = a;
  }

  update(dt, wind, gravity = 1) {
    const p = this.p;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const o = i * 14;
      p[o + 6] -= dt;
      if (p[o + 6] <= 0) continue;
      // drag towards the wind velocity
      const k = Math.min(1, dt * 1.6);
      p[o + 3] += (wind[0] - p[o + 3]) * k;
      p[o + 5] += (wind[1] - p[o + 5]) * k;
      p[o + 4] += (-1.2 * gravity - p[o + 4]) * k * 0.5;
      p[o] += p[o + 3] * dt; p[o + 1] += p[o + 4] * dt; p[o + 2] += p[o + 5] * dt;
      p[o + 8] += p[o + 9] * dt;
      if (w !== i) p.copyWithin(w * 14, o, o + 14);
      w++;
    }
    this.n = w;
    // pack for GPU: pos, size, rgb, alpha (fade in/out)
    const out = this.out;
    for (let i = 0; i < this.n; i++) {
      const o = i * 14, q = i * 8;
      const t = p[o + 6] / p[o + 7];
      out[q] = p[o]; out[q + 1] = p[o + 1]; out[q + 2] = p[o + 2]; out[q + 3] = p[o + 8];
      out[q + 4] = p[o + 10]; out[q + 5] = p[o + 11]; out[q + 6] = p[o + 12];
      out[q + 7] = p[o + 13] * Math.min(1, t * 2.5) * Math.min(1, (1 - t) * 8 + 0.2);
    }
    this.count = this.n;
  }
}
