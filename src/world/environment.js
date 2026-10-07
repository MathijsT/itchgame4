// Environment physics: sun position, sky light, air temperature (lapse rate and
// day/night cycle), air density, wind with gusts, and dust storms.

import { Simplex2, clamp, smoothstep, lerp } from '../core/noise.js';

const DEG = Math.PI / 180;

export class Environment {
  constructor(world, terrain) {
    this.world = world;
    this.terrain = terrain;
    this.hour = 7.0;
    this.timeScale = 15; // game seconds per real second (1 game hour = 4 min)
    this.noise = new Simplex2(4242);
    this.t = 0;
    this.sunDir = [0, 1, 0];
    this.sunColor = [1, 1, 1];
    this.skyZenith = [0.1, 0.2, 0.5];
    this.skyHorizon = [0.6, 0.6, 0.6];
    this.groundAmb = [0.1, 0.1, 0.1];
    this.moonColor = [0, 0, 0];
    this.wind = [0, 0];          // m/s, xz
    this.windSpeed = 0;
    this.gust = 0;
    this.storm = 0;              // 0..1 dust storm intensity
    this.stormTarget = 0;
    this.stormTimer = 60;
    this.temp = 20;              // °C at the player
    this.pressure = 101325;
    this.airDensity = 1.2;
    this.haze = 1;
    this.clouds = 0;
    this.stars = 0;
    this.daylight = 1;
    this.exposure = 0.6;
    this.zones = { wMid: 1, wHigh: 0, wPre: 0, wHam: 0, wErg: 0 };
  }

  setHour(h) { this.hour = ((h % 24) + 24) % 24; }

  update(dt, pos) {
    this.t += dt;
    this.setHour(this.hour + (dt * this.timeScale) / 3600);
    const z = this.terrain.regionAt(pos[2], pos[0]);
    // smooth zone weights so sky/climate don't pop
    const k = 1 - Math.exp(-dt * 0.5);
    for (const key of ['wMid', 'wHigh', 'wPre', 'wHam', 'wErg']) this.zones[key] = lerp(this.zones[key], z[key], k);
    const c = this.world.climate(pos[2], pos[1], this.hour, this.zones);

    // --- sun position for the world's latitude
    const lat = this.world.latitude * DEG, dec = this.world.declination * DEG;
    const H = (this.hour - 12) * 15 * DEG;
    const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
    const el = Math.asin(clamp(sinEl, -1, 1));
    const cosAz = (Math.sin(dec) - Math.sin(el) * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat) + 1e-6);
    let az = Math.acos(clamp(cosAz, -1, 1)); // from north
    if (H > 0) az = 2 * Math.PI - az;
    // +x east, +z south: north = -z
    const ce = Math.cos(el);
    this.sunDir = [Math.sin(az) * ce, Math.sin(el), -Math.cos(az) * ce];
    this.sunElevation = el / DEG;

    // --- haze & storms
    this.stormTimer -= dt;
    if (this.stormTimer <= 0) {
      this.stormTimer = 90 + Math.random() * 120;
      this.stormTarget = c.stormProne > 0.5 && Math.random() < 0.3 * c.stormProne ? 0.6 + Math.random() * 0.4 : 0;
    }
    if (c.stormProne < 0.3) this.stormTarget = 0;
    this.storm = lerp(this.storm, this.stormTarget, 1 - Math.exp(-dt * 0.08));
    this.haze = lerp(this.haze, c.haze, k);
    this.clouds = lerp(this.clouds, c.clouds, k);

    // --- sunlight through the atmosphere (Kasten–Young air mass, per-channel extinction)
    const elDeg = el / DEG;
    const airmass = elDeg > -2 ? 1 / (Math.max(Math.sin(el), 0) + 0.50572 * Math.pow(Math.max(elDeg, -1.5) + 6.07995, -1.6364)) : 40;
    const turb = 1 + this.haze * 0.6 + this.storm * 3;
    const tau = [0.09 * turb, 0.17 * turb + 0.02, 0.33 * turb + 0.05];
    const above = smoothstep(-3, 2, elDeg);
    const sunI = 3.6 * above * (1 - this.storm * 0.7);
    this.sunColor = tau.map((t) => Math.exp(-t * Math.min(airmass, 38)) * sunI);
    const day = smoothstep(-6, 12, elDeg);
    const twilight = smoothstep(-14, -2, elDeg) * (1 - smoothstep(3, 15, elDeg));
    this.daylight = day;
    const dayZen = [0.06, 0.16, 0.48], twZen = [0.04, 0.06, 0.16], nightZen = [0.0015, 0.0025, 0.007];
    const dayHor = lerp3([0.48, 0.58, 0.72], [0.66, 0.6, 0.5], clamp(this.haze - 0.4, 0, 1) * 0.6);
    const setHor = [0.95, 0.48, 0.2], nightHor = [0.006, 0.008, 0.016];
    const lowSun = 1 - smoothstep(2, 22, elDeg);
    let zen = lerp3(nightZen, twZen, smoothstep(-14, -4, elDeg));
    zen = lerp3(zen, dayZen, day);
    let hor = lerp3(nightHor, setHor, twilight);
    hor = lerp3(hor, dayHor, day * (1 - lowSun * 0.6));
    if (day > 0) hor = lerp3(hor, lerp3(dayHor, setHor, 0.6), day * lowSun * 0.6);
    const dust = this.world.dustColor;
    const st = this.storm;
    this.skyZenith = lerp3(zen, mul3(dust, 0.35 * (0.2 + day)), st * 0.8);
    this.skyHorizon = lerp3(hor, mul3(dust, 0.6 * (0.15 + day)), st * 0.8);
    this.groundAmb = mul3([0.28, 0.22, 0.17], 0.25 * (0.05 + day) + 0.05 * twilight);
    this.stars = 1 - smoothstep(-12, -3, elDeg);
    this.moonColor = [0.012 * this.stars, 0.016 * this.stars, 0.026 * this.stars];
    this.exposure = lerp(1.7, 0.62, smoothstep(-10, 8, elDeg));

    // --- air: temperature, pressure, density
    this.temp = c.temp - this.storm * 4;
    this.pressure = 101325 * Math.exp(-pos[1] / 8434);
    this.airDensity = this.pressure / (287.05 * (this.temp + 273.15));
    this.snowLine = c.snowLine;

    // --- wind: prevailing direction + slow wander + gusts
    const t = this.t;
    const dir = this.world.windDir(this.zones) + this.noise.noise(t * 0.003, 1.3) * 0.6;
    this.gust = Math.max(0, this.noise.noise(t * 0.35, 7.7) * 0.6 + this.noise.noise(t * 1.3, 3.1) * 0.25);
    const speed = c.windBase * (0.8 + 0.4 * this.noise.noise(t * 0.01, 5.5)) * (1 + this.gust) + this.storm * 14;
    this.windSpeed = speed;
    this.wind = [Math.sin(dir) * speed, Math.cos(dir) * speed];
    this.windDirRad = dir;
    this.fog = [0.00011 * (0.5 + this.haze), 1 / 700, pos[1] - 150, this.storm];
  }

  get clock() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}

function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function mul3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
