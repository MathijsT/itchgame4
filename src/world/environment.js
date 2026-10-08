// Environment physics: sun and moon position, light through the atmosphere,
// air temperature (lapse rate + day/night cycle), air density, wind with
// gusts, dust storms, clouds and valley mist. Rendering consumes the same
// physical quantities (haze/dust optical densities, transmitted sunlight).

import { Simplex2, clamp, smoothstep, lerp } from '../core/noise.js';
import { cpuTransmittance } from '../gfx/atmosphere.js';

const DEG = Math.PI / 180;
const SUN_E = 18;            // sun illuminance in scene units
const MOON_E = SUN_E * 0.006; // full moon (brightened: the eye adapts further than our exposure can)
const DUST_TINT = [1.0, 1.35, 1.9];

export class Environment {
  constructor(world, terrain) {
    this.world = world;
    this.terrain = terrain;
    this.hour = 7.0;
    this.timeScale = 15; // game seconds per real second (1 game hour = 4 min)
    this.noise = new Simplex2(4242);
    this.t = 0;
    this.sunDir = [0, 1, 0];
    this.lightDir = [0, 1, 0];
    this.lightColor = [1, 1, 1];
    this.sunColor = [1, 1, 1];
    this.sunDisk = [0, 0, 0];
    this.moonDir = [0, -1, 0];
    this.isMoon = false;
    this.wind = [0, 0];
    this.windSpeed = 0;
    this.gust = 0;
    this.storm = 0;
    this.stormTarget = 0;
    this.stormTimer = 60;
    this.temp = 20;
    this.pressure = 101325;
    this.airDensity = 1.2;
    this.haze = 1;
    this.clouds = 0;
    this.stars = 0;
    this.daylight = 1;
    this.night = 0;
    this.heat = 0;
    this.warmth = 0;
    this.cloud = [0, 4000, 1500, 0.7];
    this.cloudOffset = [0, 0];
    this.mist = [0, 0];
    this.atmo = { haze: 1, dust: 0, groundAlt: 0, intensity: SUN_E, dustTint: DUST_TINT };
    this.zones = { wMid: 1, wHigh: 0, wPre: 0, wHam: 0, wErg: 0 };
    this.groundAlt = 0;
    this.sunElevation = 0;
  }

  setHour(h) { this.hour = ((h % 24) + 24) % 24; }

  update(dt, pos) {
    this.t += dt;
    this.setHour(this.hour + (dt * this.timeScale) / 3600);
    const z = this.terrain.regionAt(pos[2], pos[0]);
    const k = 1 - Math.exp(-dt * 0.5);
    for (const key of ['wMid', 'wHigh', 'wPre', 'wHam', 'wErg']) this.zones[key] = lerp(this.zones[key], z[key], k);
    const zn = this.zones;
    const c = this.world.climate(pos[2], pos[1], this.hour, zn);
    const ground = this.terrain.height(pos[0], pos[2]);
    this.groundAlt = lerp(this.groundAlt || ground, ground, 1 - Math.exp(-dt * 0.3));

    // --- sun position for the world's latitude
    const lat = this.world.latitude * DEG, dec = this.world.declination * DEG;
    const H = (this.hour - 12) * 15 * DEG;
    const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
    const el = Math.asin(clamp(sinEl, -1, 1));
    const cosAz = (Math.sin(dec) - Math.sin(el) * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat) + 1e-6);
    let az = Math.acos(clamp(cosAz, -1, 1));
    if (H > 0) az = 2 * Math.PI - az;
    const ce = Math.cos(el);
    this.sunDir = [Math.sin(az) * ce, Math.sin(el), -Math.cos(az) * ce];
    this.sunElevation = el / DEG;
    // a full moon opposite the sun, a little higher in the sky
    const m = [-this.sunDir[0], -this.sunDir[1] * 0.8 + 0.25, -this.sunDir[2]];
    const ml = Math.hypot(...m);
    this.moonDir = m.map((x) => x / ml);

    // --- storms and haze
    this.stormTimer -= dt;
    if (this.stormTimer <= 0) {
      this.stormTimer = 90 + Math.random() * 120;
      this.stormTarget = c.stormProne > 0.5 && Math.random() < 0.3 * c.stormProne ? 0.6 + Math.random() * 0.4 : 0;
    }
    if (c.stormProne < 0.3) this.stormTarget = 0;
    this.storm = lerp(this.storm, this.stormTarget, 1 - Math.exp(-dt * 0.08));
    this.haze = lerp(this.haze, c.haze, k);
    this.clouds = lerp(this.clouds, c.clouds * (1 - this.storm), k);
    // optical properties: Mie haze multiplier and near-ground airborne dust
    const desert = zn.wPre * 0.5 + zn.wHam + zn.wErg;
    const day = smoothstep(-6, 12, this.sunElevation);
    const atmoHaze = 1.5 + this.haze * 2.5;
    const atmoDust = 0.02 + desert * 0.06 * (0.6 + 0.4 * day) + this.storm * 18;
    this.atmo = { haze: atmoHaze, dust: atmoDust, groundAlt: this.groundAlt, intensity: SUN_E, dustTint: DUST_TINT };

    // --- the key light: sun by day, moon by night
    const sunT = cpuTransmittance(pos[1], this.sunDir[1], atmoHaze, atmoDust, this.groundAlt, DUST_TINT);
    this.sunColor = sunT.map((t) => t * SUN_E);
    const useMoon = this.sunElevation < -5;
    this.isMoon = useMoon;
    if (useMoon) {
      const moonT = cpuTransmittance(pos[1], this.moonDir[1], atmoHaze, atmoDust, this.groundAlt, DUST_TINT);
      const fade = smoothstep(-5, -12, this.sunElevation);
      this.lightDir = this.moonDir;
      this.lightColor = moonT.map((t) => t * MOON_E * fade);
      this.atmo.intensity = MOON_E * Math.max(fade, 0.02);
      this.sunDisk = [0, 0, 0];
    } else {
      this.lightDir = this.sunDir;
      // below the horizon the sun still lights the upper sky (twilight)
      const above = smoothstep(-3, 1, this.sunElevation);
      this.lightColor = this.sunColor.map((x) => x * above);
      this.sunDisk = this.sunColor.map((x) => x * 900 * above);
    }
    this.daylight = day;
    this.night = 1 - smoothstep(-10, -2, this.sunElevation);
    this.stars = 1 - smoothstep(-10, -3, this.sunElevation);

    // --- air: temperature, pressure, density
    this.temp = c.temp - this.storm * 4;
    this.pressure = 101325 * Math.exp(-pos[1] / 8434);
    this.airDensity = this.pressure / (287.05 * (this.temp + 273.15));
    this.snowLine = c.snowLine;

    // --- wind: prevailing direction + slow wander + gusts
    const t = this.t;
    const dir = this.world.windDir(zn) + this.noise.noise(t * 0.003, 1.3) * 0.6;
    this.gust = Math.max(0, this.noise.noise(t * 0.35, 7.7) * 0.6 + this.noise.noise(t * 1.3, 3.1) * 0.25);
    const speed = c.windBase * (0.8 + 0.4 * this.noise.noise(t * 0.01, 5.5)) * (1 + this.gust) + this.storm * 14;
    this.windSpeed = speed;
    this.wind = [Math.sin(dir) * speed, Math.cos(dir) * speed];
    this.windDirRad = dir;

    // --- clouds: Atlas cumulus vs thin high desert cloud; they drift with upper winds
    const mountain = zn.wMid + zn.wHigh;
    this.cloud = [this.clouds, 4300 + desert * 1800, 900 + mountain * 900, 0.8];
    this.cloudOffset[0] += (this.wind[0] * 2.5 + 6) * dt * this.timeScale * 0.15;
    this.cloudOffset[1] += (this.wind[1] * 2.5 + 3) * dt * this.timeScale * 0.15;
    // --- valley mist on cool mountain mornings
    const morning = smoothstep(4.5, 6.5, this.hour) * (1 - smoothstep(8.5, 10.5, this.hour));
    this.mist = [0.008 * morning * mountain * (1 - this.storm), this.groundAlt - 60 + 400];

    // --- grading inputs: heat shimmer, warmth of the light
    this.heat = smoothstep(24, 38, this.temp) * day * clamp(desert + zn.wPre * 0.5, 0, 1) * (1 - this.storm);
    const golden = 1 - smoothstep(4, 20, Math.abs(this.sunElevation - 4));
    this.warmth = golden * 0.6 + desert * 0.15 - this.night * 0.4;
  }

  get clock() {
    const h = Math.floor(this.hour), mm = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}
