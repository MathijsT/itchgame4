// HUD: roadbook-style compass tape, stage timer, environment readouts,
// rotating minimap, dashboard gauges, toasts and banners.

import { formatTime } from '../race/rally.js';
import { SURFACES } from '../world/surfaces.js';
import { ROAD } from '../world/route.js';

const $ = (id) => document.getElementById(id);
const DEG = 180 / Math.PI;

export function bearing(dx, dz) {
  // degrees clockwise from north (north = -z, east = +x)
  let b = Math.atan2(dx, -dz) * DEG;
  if (b < 0) b += 360;
  return b;
}

export class Hud {
  constructor(world, terrain) {
    this.world = world;
    this.terrain = terrain;
    this.root = $('hud');
    this.el = {};
    for (const id of ['h-stage', 'h-timer', 'h-delta', 'h-pen', 'h-cap', 'h-wp', 'h-dist', 'h-clock', 'h-temp', 'h-wind', 'h-windarrow', 'h-alt', 'h-power', 'h-region',
      'h-speed', 'h-gear', 'h-rpm', 'h-fuel', 'h-fuel-t', 'h-eng', 'h-eng-t', 'h-press', 'h-press-t', 'h-spares', 'h-icons', 'h-surface', 'toasts', 'center-msg', 'region-banner', 'prompt']) this.el[id] = $(id);
    this.tyres = [0, 1, 2, 3].map((i) => $(`t${i}`));
    this.compass = $('compass').getContext('2d');
    this.mini = $('minimap').getContext('2d');
    this.slowTimer = 0;
    this.centerTimer = 0;
    this.bannerTimer = 0;
    this.imperial = false;
    this.mapCanvas = null;
    // decimated route polyline for maps
    const r = terrain.route;
    this.routePts = [];
    for (let i = 0; i < r.n; i += 6) this.routePts.push([r.x[i], r.z[i], r.type[i]]);
    this.riverPts = terrain.rivers.map((rv) => { const pts = []; for (let i = 0; i < rv.n; i += 6) pts.push([rv.x[i], rv.z[i]]); return pts; });
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  setMap(img, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(img, w, h), 0, 0);
    this.mapCanvas = c;
    this.mapW = w; this.mapH = h;
  }

  toast(kind, title, opts = {}) {
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.innerHTML = `<div class="t-title"></div>${opts.latin ? '<div class="t-latin"></div>' : ''}${opts.body ? '<div class="t-body"></div>' : ''}`;
    d.querySelector('.t-title').textContent = title;
    if (opts.latin) d.querySelector('.t-latin').textContent = opts.latin;
    if (opts.body) d.querySelector('.t-body').textContent = opts.body;
    const box = this.el.toasts;
    box.appendChild(d);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 450); }, opts.ms ?? 5000);
  }

  center(text, ms = 1000, small = false) {
    const e = this.el['center-msg'];
    e.textContent = text;
    e.classList.toggle('small-msg', small);
    this.centerTimer = ms / 1000;
  }

  banner(name, sub) {
    const b = this.el['region-banner'];
    b.querySelector('.rb-name').textContent = name;
    b.querySelector('.rb-sub').textContent = sub;
    b.classList.add('show');
    this.bannerTimer = 4;
  }

  prompt(html) {
    const p = this.el.prompt;
    if (!html) { p.classList.remove('show'); return; }
    if (p.innerHTML !== html) p.innerHTML = html;
    p.classList.add('show');
  }

  speedText(ms) { return this.imperial ? Math.round(ms * 2.23694) : Math.round(ms * 3.6); }

  update(dt, s) {
    const v = s.vehicle;
    const el = this.el;
    // every frame: speed, rpm bar
    el['h-speed'].textContent = this.speedText(Math.abs(v.fwdSpeed));
    el['h-rpm'].style.width = `${Math.min(100, (v.rpm / 6500) * 100)}%`;
    if (this.centerTimer > 0) { this.centerTimer -= dt; if (this.centerTimer <= 0) el['center-msg'].textContent = ''; }
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) el['region-banner'].classList.remove('show'); }
    this._drawCompass(s);
    this._drawMinimap(s);
    this.slowTimer -= dt;
    if (this.slowTimer > 0) return;
    this.slowTimer = 0.1;
    // ---- stage panel
    const rally = s.rally;
    if (s.mode === 'rally' && rally.stage) {
      const st = rally.stage;
      el['h-stage'].textContent = `Stage ${st.index + 1} · ${st.name}`;
      el['h-timer'].textContent = rally.state === 'running' || rally.state === 'finished' ? formatTime(rally.time + rally.penalty) : rally.state === 'countdown' ? 'READY' : 'START';
      if (rally.state === 'running') {
        const d = rally.liveDelta();
        el['h-delta'].textContent = `${formatTime(d, true)} vs ${rally.rivals[1].name}`;
        el['h-delta'].className = d <= 0 ? 'ahead' : 'behind';
      } else el['h-delta'].textContent = '';
      el['h-pen'].textContent = rally.penalty > 0 ? `pen ${formatTime(rally.penalty)}` : '';
    } else {
      el['h-stage'].textContent = 'Free roam';
      el['h-timer'].textContent = `${(v.distance / 1000).toFixed(1)} km`;
      const jp = s.journal.progress;
      el['h-delta'].textContent = `Field journal ${jp.found}/${jp.total}`;
      el['h-delta'].className = '';
      el['h-pen'].textContent = '';
    }
    // ---- navigation
    const f = v.forward;
    const hdg = bearing(f[0], f[2]);
    const wp = s.navTarget;
    if (wp) {
      const dx = wp.x - v.pos[0], dz = wp.z - v.pos[2];
      el['h-cap'].textContent = `${String(Math.round(bearing(dx, dz))).padStart(3, '0')}°`;
      const dist = Math.hypot(dx, dz);
      el['h-dist'].textContent = this.imperial ? `${(dist / 1609).toFixed(2)} mi` : dist > 1000 ? `${(dist / 1000).toFixed(2)} km` : `${Math.round(dist)} m`;
      el['h-wp'].textContent = wp.label;
    } else {
      el['h-cap'].textContent = `${String(Math.round(hdg)).padStart(3, '0')}°`;
      el['h-wp'].textContent = 'HEADING';
      el['h-dist'].textContent = '';
    }
    // ---- environment
    const env = s.env;
    el['h-clock'].textContent = env.clock;
    el['h-temp'].textContent = this.imperial ? `${Math.round(env.temp * 1.8 + 32)}°F` : `${Math.round(env.temp)}°C`;
    el['h-wind'].textContent = this.imperial ? `${Math.round(env.windSpeed * 2.237)} mph` : `${Math.round(env.windSpeed * 3.6)} km/h`;
    // arrow shows where the wind blows towards, relative to the car's heading
    const wb = bearing(env.wind[0], env.wind[1]);
    el['h-windarrow'].style.transform = `rotate(${wb - hdg - 90}deg)`;
    el['h-alt'].textContent = this.imperial ? Math.round(v.pos[1] * 3.281) : Math.round(v.pos[1]);
    el['h-power'].textContent = `${Math.round(v.powerFactor * 100)}%`;
    el['h-region'].textContent = s.regionName;
    // ---- dash
    el['h-gear'].textContent = v.gear === -1 ? 'R' : v.gear === 0 ? 'N' : String(v.gear);
    el['h-fuel'].style.width = `${(v.fuel / 110) * 100}%`;
    el['h-fuel'].style.background = v.fuel < 15 ? 'var(--bad)' : '';
    el['h-fuel-t'].textContent = `${Math.round(v.fuel)} L`;
    const et = v.engineTemp;
    el['h-eng'].style.width = `${Math.min(100, Math.max(0, (et - 60) / 80 * 100))}%`;
    el['h-eng-t'].textContent = `${Math.round(et)}°`;
    let pAvg = 0;
    v.wheels.forEach((w, i) => {
      pAvg += w.pressure / 4;
      this.tyres[i].className = w.punctured ? 'flat' : w.pressure < 1.3 ? 'low' : '';
    });
    el['h-press'].textContent = pAvg.toFixed(1);
    el['h-press-t'].textContent = Math.abs(pAvg - v.targetPressure) > 0.05 ? `→ ${v.targetPressure.toFixed(1)}` : '';
    el['h-spares'].textContent = `${v.spares} spare${v.spares === 1 ? '' : 's'}${v.tractionAssist ? ' · TC' : ''}`;
    const dm = v.damageSummary;
    const icons = [];
    if (v.limpMode) icons.push(['OVERHEAT — LIMP MODE', '']);
    else if (et > 112) icons.push(['ENGINE HOT', 'warn']);
    if (v.fuel < 15) icons.push(['LOW FUEL', v.fuel < 5 ? '' : 'warn']);
    if (dm.susp > 0.15) icons.push([`SUSPENSION ${Math.round(dm.susp * 100)}%`, dm.susp > 0.6 ? '' : 'warn']);
    if (dm.radiator > 0.1) icons.push([`RADIATOR ${Math.round(dm.radiator * 100)}%`, 'warn']);
    if (dm.engine > 0.05) icons.push([`ENGINE DMG ${Math.round(dm.engine * 100)}%`, '']);
    if (dm.filter > 0.25) icons.push([`AIR FILTER ${Math.round(dm.filter * 100)}%`, 'warn']);
    if (v.wheels.some((w) => w.punctured)) icons.push(['PUNCTURE', '']);
    if (v.headlights) icons.push(['LIGHTS', 'ok']);
    const html = icons.map(([t, c]) => `<span class="${c}">${t}</span>`).join('');
    if (el['h-icons'].innerHTML !== html) el['h-icons'].innerHTML = html;
    // surface & sinkage readout: the physics made visible
    const w0 = v.wheels.reduce((a, w) => (w.Fz > a.Fz ? w : a), v.wheels[0]);
    const sink = Math.max(...v.wheels.map((w) => w.sink));
    let surfTxt = SURFACES[w0.surf.id]?.name ?? '—';
    if (sink > 0.03) surfTxt += ` · sinking ${Math.round(sink * 100)} cm`;
    if (w0.waterDepth > 0.05) surfTxt += ` · wading ${Math.round(w0.waterDepth * 100)} cm`;
    el['h-surface'].textContent = surfTxt;
  }

  _drawCompass(s) {
    const g = this.compass;
    const W = g.canvas.width, H = g.canvas.height;
    g.clearRect(0, 0, W, H);
    const v = s.vehicle;
    const f = v.forward;
    const hdg = bearing(f[0], f[2]);
    const span = 70; // degrees visible each side
    const px = (deg) => {
      let d = deg - hdg;
      while (d > 180) d -= 360; while (d < -180) d += 360;
      return W / 2 + (d / span) * (W / 2);
    };
    g.strokeStyle = 'rgba(255,236,210,0.5)';
    g.fillStyle = '#f4ece0';
    g.textAlign = 'center';
    g.font = '600 13px ui-monospace, Menlo, monospace';
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = 0; d < 360; d += 5) {
      const x = px(d);
      if (x < 0 || x > W) continue;
      const major = d % 15 === 0;
      g.beginPath(); g.moveTo(x, 30); g.lineTo(x, major ? 18 : 24); g.stroke();
      if (names[d] !== undefined) { g.fillStyle = d === 0 ? '#ff8a2b' : '#f4ece0'; g.fillText(names[d], x, 13); g.fillStyle = '#f4ece0'; }
      else if (d % 30 === 0) { g.fillStyle = '#b9ab98'; g.fillText(String(d), x, 13); g.fillStyle = '#f4ece0'; }
    }
    // waypoint bearing marker
    if (s.navTarget) {
      const b = bearing(s.navTarget.x - v.pos[0], s.navTarget.z - v.pos[2]);
      let d = b - hdg;
      while (d > 180) d -= 360; while (d < -180) d += 360;
      const x = Math.max(8, Math.min(W - 8, W / 2 + (d / span) * (W / 2)));
      g.fillStyle = Math.abs(d) < span ? '#ff8a2b' : '#ffd27a';
      g.beginPath(); g.moveTo(x, 34); g.lineTo(x - 7, 46); g.lineTo(x + 7, 46); g.closePath(); g.fill();
    }
    // wind indicator on the tape
    const wb = bearing(s.env.wind[0], s.env.wind[1]);
    const wx = px(wb);
    if (wx > 0 && wx < W) { g.fillStyle = 'rgba(140,200,255,0.8)'; g.fillRect(wx - 1, 32, 2, 8); }
    g.fillStyle = '#fff';
    g.fillRect(W / 2 - 1, 16, 2, 20);
  }

  worldToMap(x, z) {
    const b = this.terrain.bounds;
    return [((x - b.minX) / (b.maxX - b.minX)) * this.mapW, ((z - b.minZ) / (b.maxZ - b.minZ)) * this.mapH];
  }

  _drawMinimap(s) {
    const g = this.mini;
    const W = g.canvas.width, H = g.canvas.height;
    g.save();
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#2a2018';
    g.fillRect(0, 0, W, H);
    const v = s.vehicle;
    const f = v.forward;
    const hdg = Math.atan2(f[0], -f[2]);
    const metersPerPx = 7;
    const b = this.terrain.bounds;
    g.translate(W / 2, H / 2);
    g.rotate(-hdg);
    if (this.mapCanvas) {
      const sx = (b.maxX - b.minX) / this.mapW; // metres per map pixel
      const k = sx / metersPerPx;
      const [mx, my] = this.worldToMap(v.pos[0], v.pos[2]);
      g.imageSmoothingEnabled = true;
      g.drawImage(this.mapCanvas, -mx * k, -my * k, this.mapW * k, this.mapH * k);
    }
    const tp = (x, z) => [(x - v.pos[0]) / metersPerPx, (z - v.pos[2]) / metersPerPx];
    // rivers
    g.strokeStyle = 'rgba(90,150,190,0.9)'; g.lineWidth = 2;
    for (const pts of this.riverPts) {
      g.beginPath();
      pts.forEach((p, i) => { const [x, y] = tp(p[0], p[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
    }
    // route
    g.lineWidth = 3;
    let prevType = -1;
    g.beginPath();
    for (let i = 0; i < this.routePts.length; i++) {
      const p = this.routePts[i];
      const [x, y] = tp(p[0], p[1]);
      if (Math.abs(x) > 400 || Math.abs(y) > 400) { prevType = -1; continue; }
      if (p[2] !== prevType) {
        g.stroke(); g.beginPath();
        g.strokeStyle = p[2] === ROAD.ASPHALT ? '#e8e4dc' : p[2] === ROAD.PISTE ? '#ffb070' : 'rgba(255,138,43,0.7)';
        g.setLineDash(p[2] === ROAD.NONE ? [5, 5] : []);
        g.moveTo(x, y); prevType = p[2];
      } else g.lineTo(x, y);
    }
    g.stroke();
    g.setLineDash([]);
    // waypoints
    for (const w of s.waypoints || []) {
      const [x, y] = tp(w.x, w.z);
      g.fillStyle = w.done ? '#8fd16a' : w.missed ? '#ff5a4a' : '#ff8a2b';
      g.beginPath(); g.arc(x, y, w === s.navTarget?.wp ? 6 : 4, 0, Math.PI * 2); g.fill();
    }
    // places
    for (const p of this.terrain.places) {
      const [x, y] = tp(p.x, p.z);
      g.fillStyle = p.type === 'bivouac' ? '#ffffff' : '#e0c090';
      g.fillRect(x - 3, y - 3, 6, 6);
    }
    g.restore();
    // player arrow (always pointing up)
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(W / 2, H / 2 - 9); g.lineTo(W / 2 - 6, H / 2 + 7); g.lineTo(W / 2, H / 2 + 3); g.lineTo(W / 2 + 6, H / 2 + 7); g.closePath(); g.fill();
    // north marker on the rim
    const na = -hdg;
    g.fillStyle = '#ff8a2b';
    g.font = '700 12px ui-monospace, monospace';
    g.textAlign = 'center';
    g.fillText('N', W / 2 + Math.sin(na) * 88, H / 2 - Math.cos(na) * 88 + 4);
  }

  drawBigMap(canvas, s) {
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    g.fillStyle = '#16120f'; g.fillRect(0, 0, W, H);
    if (!this.mapCanvas) return;
    const k = Math.min(W / this.mapW, H / this.mapH);
    const ox = (W - this.mapW * k) / 2, oy = (H - this.mapH * k) / 2;
    g.drawImage(this.mapCanvas, ox, oy, this.mapW * k, this.mapH * k);
    const tp = (x, z) => { const [mx, my] = this.worldToMap(x, z); return [ox + mx * k, oy + my * k]; };
    g.lineWidth = 2.5;
    g.strokeStyle = '#ff8a2b';
    g.beginPath();
    this.routePts.forEach((p, i) => { const [x, y] = tp(p[0], p[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    g.font = '600 11px system-ui, sans-serif';
    for (const p of this.terrain.places) {
      const [x, y] = tp(p.x, p.z);
      g.fillStyle = p.type === 'bivouac' ? '#fff' : '#e0c090';
      g.fillRect(x - 3, y - 3, 6, 6);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillText(p.name, x + 6, y + 4);
    }
    for (const w of s.waypoints || []) {
      const [x, y] = tp(w.x, w.z);
      g.fillStyle = w.done ? '#8fd16a' : w.missed ? '#ff5a4a' : '#ff8a2b';
      g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
    }
    // regions
    g.fillStyle = 'rgba(255,210,122,0.9)';
    g.font = '700 13px system-ui, sans-serif';
    let z0 = this.terrain.bounds.minZ;
    for (const r of this.world.regions) {
      const z1 = Math.min(r.z1, this.terrain.bounds.maxZ);
      const [, y] = tp(0, (z0 + z1) / 2);
      g.fillText(r.name.toUpperCase(), ox + 8, y);
      z0 = z1;
    }
    const v = s.vehicle;
    const [px, py] = tp(v.pos[0], v.pos[2]);
    const f = v.forward;
    const a = Math.atan2(f[0], -f[2]);
    g.save(); g.translate(px, py); g.rotate(a);
    g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, -10); g.lineTo(-7, 8); g.lineTo(0, 4); g.lineTo(7, 8); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
}
