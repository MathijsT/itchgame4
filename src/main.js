// Terra Endurance — game bootstrap, state machine and frame loop.

import { createContext } from './gfx/gl.js';
import { Renderer, GpuMesh, InstancedBatch } from './gfx/renderer.js';
import { Particles } from './gfx/particles.js';
import { WORLDS } from './worlds/registry.js';
import { Environment } from './world/environment.js';
import { TerrainStreamer, CHUNK } from './world/streamer.js';
import { FaunaSystem } from './world/fauna.js';
import { STRUCTURE_MODELS, STRUCTURE_COLLIDE, layoutPlace } from './world/structures.js';
import { buildRoadRibbon, buildWaterRibbons } from './world/ribbons.js';
import { ROAD } from './world/route.js';
import { Vehicle, SPEC } from './vehicle/vehicle.js';
import { buildBody, buildWheel } from './vehicle/vehicleMesh.js';
import { Rally, PENALTY, formatTime } from './race/rally.js';
import { Hud } from './ui/hud.js';
import { Journal } from './ui/journal.js';
import { Input } from './input.js';
import { GameAudio } from './audio/audio.js';
import { GameCamera } from './camera.js';
import { m4, quat } from './core/math.js';
import { clamp } from './core/noise.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const SCREENS = ['loading', 'title', 'briefing', 'stage-end', 'pause', 'journal', 'map', 'help', 'settings', 'error'];
const REGION_KEYS = ['wMid', 'wHigh', 'wPre', 'wHam', 'wErg'];

function loadSettings() {
  const d = { quality: 'high', viewDist: 4500, volume: 0.7, tcs: true, imperial: false };
  try { return Object.assign(d, JSON.parse(localStorage.getItem('terra.settings') || '{}')); } catch { return d; }
}
function saveSettings(s) { try { localStorage.setItem('terra.settings', JSON.stringify(s)); } catch { /* ignore */ } }

class Game {
  constructor() {
    this.settings = loadSettings();
    this.screen = 'loading';
    this.overlay = null;        // screen shown on top of driving (pause, journal, map...)
    this.state = 'menu';        // menu | drive
    this.mode = 'rally';
    this.time = 0;
    this.selectedWorld = WORLDS[0];
  }

  async init() {
    this.canvas = $('gl');
    this.gl = createContext(this.canvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer = new Renderer(this.gl, { quality: this.settings.quality });
    this.input = new Input();
    this.audio = new GameAudio();
    this.audio.volume = this.settings.volume;
    this.particles = new Particles(this.settings.quality === 'low' ? 1200 : 3000);
    this.camera = new GameCamera();
    const startAudio = () => this.audio.start();
    window.addEventListener('pointerdown', startAudio);
    window.addEventListener('keydown', startAudio);
    this.bindUI();
    await this.loadWorld(this.selectedWorld);
    this.buildTitle();
    this.showScreen('title');
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.settings.quality === 'low' ? 1 : 1.5);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
  }

  progress(frac, text) {
    $('load-fill').style.width = `${Math.round(frac * 100)}%`;
    if (text) $('load-text').textContent = text;
  }

  showScreen(name) {
    for (const s of SCREENS) $(s).classList.toggle('show', s === name);
    this.screen = name;
  }

  // ------------------------------------------------------------------ loading
  async loadWorld(world) {
    const gl = this.gl;
    this.world = world;
    this.progress(0.05, `Shaping the ${world.name}…`);
    await nextFrame();
    const terrain = this.terrain = world.createTerrain(world.seed);
    this.env = new Environment(world, terrain);
    this.env.setHour(8.2);
    this.progress(0.2, 'Starting terrain workers…');
    const q = this.settings.quality;
    this.vegScale = q === 'low' ? 0.55 : q === 'medium' ? 0.8 : 1;
    this.streamer = new TerrainStreamer(gl, world, world.seed, { viewDist: q === 'low' ? Math.min(3000, this.settings.viewDist) : this.settings.viewDist, vegDist: 1400 * this.vegScale + 200 });
    this.streamer.setGroundFn((x, z) => terrain.height(x, z));
    await this.streamer.readyPromise;
    this.progress(0.35, 'Growing cedars and palms…');
    await nextFrame();

    // vegetation batches (near + far LOD per species)
    this.flora = world.flora.map((sp) => {
      const near = new GpuMesh(gl, sp.model(0).build());
      const far = sp.farRange ? new GpuMesh(gl, sp.model(1).build()) : null;
      const tall = sp.kind === 'tree' || sp.kind === 'rock' || sp.kind === 'shrub';
      return {
        sp,
        near: new InstancedBatch(gl, near, 8, { kind: 0, sway: sp.sway ?? 0, castShadow: tall }),
        far: far ? new InstancedBatch(gl, far, 8, { kind: 0, sway: (sp.sway ?? 0) * 0.5, castShadow: tall }) : null,
      };
    });
    this.vegTimer = 0;

    // structures
    this.progress(0.45, 'Building kasbahs and bivouacs…');
    const byType = {};
    const nests = [];
    this.staticColliders = [];
    this.servicePoints = [];
    for (const place of terrain.places) {
      const zones = terrain.regionAt(place.z, place.x);
      const { items, nests: ns } = layoutPlace(place, terrain, world.earthTint(zones));
      nests.push(...ns);
      for (const it of items) {
        const y = terrain.height(it.x, it.z);
        (byType[it.type] ||= []).push(it.x, y, it.z, it.yaw, it.scale, it.tint[0], it.tint[1], it.tint[2]);
        const r = (STRUCTURE_COLLIDE[it.type] || 0) * it.scale;
        if (r > 0) this.staticColliders.push([it.x, it.z, r, Infinity]);
        if (it.type === 'fuelTruck') this.servicePoints.push({ x: it.x, z: it.z, r: 18, type: 'fuel', place });
      }
      if (place.type === 'bivouac') this.servicePoints.push({ x: place.x, z: place.z, r: place.r + 10, type: 'bivouac', place });
    }
    this.structBatches = [];
    for (const [type, arr] of Object.entries(byType)) {
      const b = new InstancedBatch(gl, new GpuMesh(gl, STRUCTURE_MODELS[type]().build()), 8, { kind: 0 });
      b.update(new Float32Array(arr));
      this.structBatches.push(b);
    }
    this.nests = nests;
    // nests on towers
    if (nests.length) {
      const arr = [];
      for (const n of nests) arr.push(n.x, terrain.height(n.x, n.z) + n.y - 0.6, n.z, 0, 1, 1, 1, 1);
      const b = new InstancedBatch(gl, new GpuMesh(gl, STRUCTURE_MODELS.nest().build()), 8, { kind: 0 });
      b.update(new Float32Array(arr));
      this.structBatches.push(b);
    }
    this.flagBatch = new InstancedBatch(gl, new GpuMesh(gl, STRUCTURE_MODELS.flag().build()), 8, { kind: 0 });
    this.archBatch = new InstancedBatch(gl, new GpuMesh(gl, STRUCTURE_MODELS.arch().build()), 8, { kind: 0 });
    this._buildArches();

    // fauna batches
    this.faunaBatches = new Map();
    for (const sp of world.fauna) {
      this.faunaBatches.set(sp.id, new InstancedBatch(gl, new GpuMesh(gl, sp.model().build()), 12, { kind: sp.kind === 'flyer' ? 2 : 1, castShadow: true }));
    }

    this.progress(0.55, 'Laying the piste and filling the oueds…');
    await nextFrame();
    this.road = buildRoadRibbon(gl, terrain);
    this.road.pisteColor = [0.66, 0.54, 0.4];
    this.water = buildWaterRibbons(gl, terrain);

    // vehicle meshes
    this.bodyMesh = new GpuMesh(gl, buildBody().build());
    this.wheelMesh = new GpuMesh(gl, buildWheel().build());

    this.hud = new Hud(world, terrain);
    this.hud.imperial = this.settings.imperial;
    this.journal = new Journal(world);
    this.streamer.requestMap(300, 630).then((m) => this.hud.setMap(m.img, m.w, m.h));

    // warm the streamer around the title flyover point
    const st = world.stages[0];
    void st;
    const start = this.terrain.route.at(30);
    this.titleFocus = [start.x + 120, terrain.height(start.x + 120, start.z + 200) + 10, start.z + 200];
    this.camera.flyover(0, terrain, this.titleFocus);
    await this.warmup(this.camera.pos, 0.6, 1.0);
  }

  async warmup(pos, p0, p1) {
    const t0 = performance.now();
    for (;;) {
      this.streamer.update(pos);
      let total = 0, ready = 0;
      for (const c of this.streamer.chunks.values()) {
        if (c.dist > 900) continue;
        total++;
        if (c.mesh) ready++;
      }
      const frac = total ? ready / total : 0;
      this.progress(p0 + (p1 - p0) * frac, `Streaming terrain… ${ready}/${total}`);
      if ((frac >= 1 && this.streamer.inFlight === 0) || performance.now() - t0 > 25000) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  _buildArches() {
    const r = this.terrain.route;
    const arr = [];
    for (const st of this.world.stages) {
      for (const idx of [st.from, st.to]) {
        const c = this.world.routeCtrl[idx];
        const s = idx === 0 ? 4 : r.track(c.x, c.z).s;
        const p = r.at(s);
        arr.push(p.x, this.terrain.height(p.x, p.z), p.z, Math.atan2(p.tx, p.tz), 1, 1, 1, 1);
      }
    }
    this.archBatch.update(new Float32Array(arr));
  }

  // ------------------------------------------------------------------ UI
  bindUI() {
    $('btn-rally').onclick = () => this.startGame('rally');
    $('btn-explore').onclick = () => this.startGame('explore');
    $('btn-journal-title').onclick = () => this.openJournal();
    $('btn-help-title').onclick = () => this.openOverlay('help');
    $('btn-settings-title').onclick = () => this.openSettings();
    $('b-start').onclick = () => this.toStartLine();
    $('e-next').onclick = () => this.afterStage();
    $('p-resume').onclick = () => this.closeOverlay();
    $('p-journal').onclick = () => this.openJournal();
    $('p-map').onclick = () => this.openMap();
    $('p-help').onclick = () => this.openOverlay('help');
    $('p-settings').onclick = () => this.openSettings();
    $('p-quit').onclick = () => this.quitToTitle();
    for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => this.closeOverlay();
    for (const b of document.querySelectorAll('.tabs button')) {
      b.onclick = () => {
        for (const x of document.querySelectorAll('.tabs button')) x.classList.toggle('active', x === b);
        this.renderJournal(b.dataset.tab);
      };
    }
    const s = this.settings;
    $('s-quality').value = s.quality;
    $('s-view').value = s.viewDist;
    $('s-vol').value = s.volume;
    $('s-tcs').checked = s.tcs;
    $('s-units').checked = s.imperial;
    $('s-quality').onchange = (e) => { s.quality = e.target.value; saveSettings(s); };
    $('s-view').oninput = (e) => { s.viewDist = +e.target.value; if (this.streamer) this.streamer.viewDist = s.viewDist; saveSettings(s); };
    $('s-vol').oninput = (e) => { s.volume = +e.target.value; this.audio.volume = s.volume; saveSettings(s); };
    $('s-tcs').onchange = (e) => { s.tcs = e.target.checked; if (this.vehicle) this.vehicle.tractionAssist = s.tcs; saveSettings(s); };
    $('s-units').onchange = (e) => { s.imperial = e.target.checked; if (this.hud) this.hud.imperial = s.imperial; saveSettings(s); };
  }

  buildTitle() {
    const box = $('world-cards');
    box.innerHTML = '';
    for (const w of WORLDS) {
      const c = document.createElement('div');
      c.className = `wcard${w.available ? '' : ' locked'}${w === this.selectedWorld ? ' selected' : ''}`;
      c.style.background = `linear-gradient(160deg, ${w.menuColors[0]}, ${w.menuColors[1]})`;
      c.innerHTML = `<span class="badge">${w.available ? 'OPEN' : 'COMING SOON'}</span><div class="country"></div><h3></h3><p></p>`;
      c.querySelector('.country').textContent = w.country;
      c.querySelector('h3').textContent = w.name;
      c.querySelector('p').textContent = w.blurb;
      box.appendChild(c);
    }
  }

  openOverlay(name) {
    this.returnScreen = this.screen === 'pause' || this.screen === 'title' ? this.screen : this.returnScreen;
    this.showScreen(name);
  }

  closeOverlay() {
    if (this.state === 'drive') {
      if (this.screen === 'pause' || !this.returnScreen || this.returnScreen === 'pause') {
        if (this.screen !== 'pause' && this.returnScreen === 'pause') { this.showScreen('pause'); this.returnScreen = null; return; }
        this.showScreen('none');
        this.hud.show(true);
      } else this.showScreen(this.returnScreen);
    } else this.showScreen('title');
    this.returnScreen = null;
  }

  openSettings() { this.openOverlay('settings'); }

  openJournal() {
    this.openOverlay('journal');
    const active = document.querySelector('.tabs button.active');
    this.renderJournal(active ? active.dataset.tab : 'fauna');
  }

  renderJournal(tab) {
    const j = this.journal;
    const list = tab === 'flora' ? j.floraList : j.faunaList;
    const p = j.progress;
    $('j-count').textContent = `${p.found} of ${p.total} species observed`;
    const box = $('j-list');
    box.innerHTML = '';
    for (const sp of list) {
      const known = j.has(tab, sp.id);
      const d = document.createElement('div');
      d.className = `entry${known ? '' : ' unknown'}`;
      d.innerHTML = '<h4></h4><div class="latin"></div><p></p><div class="where"></div>';
      d.querySelector('h4').textContent = known ? sp.name : '? ? ?';
      d.querySelector('.latin').textContent = known ? sp.latin : '';
      d.querySelector('p').textContent = known ? sp.fact : hintFor(sp);
      const rec = j.data[tab][sp.id];
      d.querySelector('.where').textContent = known && rec.where ? `Observed: ${rec.where}` : '';
      box.appendChild(d);
    }
  }

  openMap() {
    this.openOverlay('map');
    if (this.vehicle) this.hud.drawBigMap($('map-canvas'), this.hudState());
  }

  // ------------------------------------------------------------------ game flow
  startGame(mode) {
    this.audio.start();
    this.mode = mode;
    this.rally = new Rally(this.world, this.terrain, mode);
    this.vehicle = new Vehicle();
    this.vehicle.tractionAssist = this.settings.tcs;
    this.vehicle.fuel = 100;
    this.fauna = new FaunaSystem(this.world, this.terrain, this.env);
    this.fauna.setNests(this.nests);
    this.fauna.onSpot = (sp) => this.discover('fauna', sp);
    this.fauna.onStrike = (sp) => {
      this.hud.toast('bad', 'Wildlife strike!', { body: `You startled a ${sp.name.toLowerCase()}. Drive gently where animals graze.` });
      if (this.mode === 'rally') this.rally.addPenalty(PENALTY.wildlife, 'wildlife strike');
    };
    this.lastRegion = null;
    this.dirt = 0;
    this.servicing = 0;
    this.state = 'drive';
    this.florTimer = 0;
    this.vegTimer = 0;
    this.placeAtStage(0);
    if (mode === 'rally') this.showBriefing();
    else {
      this.showScreen('none');
      this.hud.show(true);
      this.hud.toast('', 'Free roam', { body: 'Drive anywhere. Follow the orange route markers between bivouacs, or head off to find wildlife for your field journal (J).', ms: 8000 });
    }
  }

  placeAtStage(i) {
    const pose = this.rally.startPose(i);
    this.placeVehicle(pose.x, pose.z, pose.yaw);
    this.env.setHour(Math.max(this.world.stages[i].startHour, i === 0 ? 0 : this.env.hour));
  }

  placeVehicle(x, z, yaw) {
    const v = this.vehicle;
    v.reset([x, this.terrain.height(x, z) + 0.95, z], yaw);
    // let the suspension settle before handing over control
    const ctx = { terrain: this.terrain, env: this.env, colliders: null };
    v.input.throttle = 0; v.input.brake = 0; v.input.steer = 0; v.input.handbrake = 1;
    for (let i = 0; i < 60; i++) v.update(1 / 60, ctx);
    v.input.handbrake = 0;
    v.gear = 1;
    v.events.length = 0;
    this.camera.snap = true;
    this.camera.headingSmooth = yaw;
  }

  showBriefing() {
    const r = this.rally, st = r.stage, n = r.stages.length;
    $('b-kicker').textContent = `Stage ${st.index + 1} of ${n} · ${st.region}`;
    $('b-name').textContent = st.name;
    $('b-brief').textContent = st.brief;
    // surface mix along the stage
    let a = 0, p = 0, o = 0;
    for (let s = st.s0; s < st.s1; s += 50) { const t = this.terrain.route.at(s).type; if (t === ROAD.ASPHALT) a++; else if (t === ROAD.PISTE) p++; else o++; }
    const tot = a + p + o || 1;
    const best = r.bestTime(st.index);
    $('b-facts').innerHTML = `<div><b>${(st.length / 1000).toFixed(1)} km</b>distance · ${st.waypoints.length} waypoints</div>`
      + `<div><b>${Math.round((a / tot) * 100)}/${Math.round((p / tot) * 100)}/${Math.round((o / tot) * 100)}</b>asphalt / piste / off-piste %</div>`
      + `<div><b>${formatTime(st.rivalTimes[1])}</b>target (${r.rivals[1].name})${best ? ` · best ${formatTime(best)}` : ''}</div>`;
    const tips = [
      'Gravel piste: brake before the corner, not in it. Pistes are fast but loose.',
      'Air density drops about 10% per 1,000 m of climb: expect less power at the pass, and less cooling.',
      'Afternoon heat in the valleys: keep revs moderate and keep moving so air flows through the radiator.',
      'Press 1 to drop to 0.9 bar before the dunes. Climb windward slopes with momentum, crest slowly, and never attack a slip face.',
    ];
    $('b-tip').textContent = tips[st.index] || '';
    this.hud.show(false);
    this.showScreen('briefing');
  }

  toStartLine() {
    this.placeAtStage(this.rally.stageIndex);
    this.showScreen('none');
    this.hud.show(true);
    this.hud.center('Press Enter to start', 4000, true);
  }

  showStageEnd() {
    const r = this.rally;
    const st = r.stage;
    const res = r.results[r.stageIndex];
    $('e-kicker').textContent = `Stage ${st.index + 1} complete`;
    $('e-name').textContent = st.name;
    const rows = r.standings(false);
    const overall = r.standings(true);
    const fmtRows = (rs) => rs.map((x, i) => `<tr class="${x.me ? 'me' : ''}"><td>${i + 1}</td><td>${x.name}</td><td class="small">${x.team}</td><td class="num">${formatTime(x.time)}</td></tr>`).join('');
    $('e-table').innerHTML = `<tr><th colspan="4">Stage result</th></tr>${fmtRows(rows)}<tr><th colspan="4">Overall</th></tr>${fmtRows(overall)}`;
    const last = r.stageIndex >= r.stages.length - 1;
    $('e-note').textContent = `Driving ${formatTime(res.time)} + penalties ${formatTime(res.penalty)}. `
      + (last ? 'You crossed the Sahara! The bivouac celebrates under the stars. Continue to explore freely.' : 'At the bivouac the crew refuels the car and repairs all damage overnight.');
    $('e-next').textContent = last ? 'Explore freely' : 'Next stage briefing';
    this.hud.show(false);
    this.showScreen('stage-end');
  }

  afterStage() {
    this.vehicle.repairAll();
    this.vehicle.fuel = SPEC.tank;
    if (this.rally.nextStage()) {
      this.showBriefing();
    } else {
      this.mode = 'explore';
      this.showScreen('none');
      this.hud.show(true);
      this.hud.toast('', 'Rally complete', { body: 'The whole world is yours to explore. Can you complete the field journal?', ms: 8000 });
    }
  }

  quitToTitle() {
    this.state = 'menu';
    this.hud.show(false);
    this.vehicle = null;
    this.showScreen('title');
  }

  discover(kind, sp) {
    const region = this.regionName();
    if (this.journal.discover(kind, sp.id, region)) {
      const p = this.journal.progress;
      this.hud.toast('discovery', `New ${kind === 'fauna' ? 'wildlife' : 'plant'}: ${sp.name}`, { latin: sp.latin, body: `${sp.fact} (${p.found}/${p.total})`, ms: 9000 });
    }
  }

  regionName() {
    const z = this.env.zones;
    let bi = 0;
    for (let i = 1; i < REGION_KEYS.length; i++) if (z[REGION_KEYS[i]] > z[REGION_KEYS[bi]]) bi = i;
    return this.world.regions[bi].name;
  }

  // nearest service point the car is stopped at
  serviceAt() {
    const v = this.vehicle;
    for (const s of this.servicePoints) {
      if (Math.hypot(v.pos[0] - s.x, v.pos[2] - s.z) < s.r) return s;
    }
    return null;
  }

  recover() {
    const v = this.vehicle, t = this.terrain;
    const tr = t.route.track(v.pos[0], v.pos[2], this.rally.progress, 1500);
    let x = v.pos[0], z = v.pos[2], yaw = v.yaw;
    const o = {};
    t.sample(x, z, o);
    if (tr.d > 150 || o.water > 0.3) {
      const p = t.route.at(tr.s);
      x = p.x; z = p.z; yaw = Math.atan2(p.tx, p.tz);
    }
    this.placeVehicle(x, z, yaw);
    if (v.fuel < 5) {
      v.fuel = 25;
      this.hud.toast('warn', 'Assistance truck', { body: 'Out of fuel: the assistance truck brought 25 litres.' });
      if (this.mode === 'rally') this.rally.addPenalty(300, 'assistance');
    }
    if (this.mode === 'rally') this.rally.addPenalty(PENALTY.recovery, 'recovery');
  }

  // ------------------------------------------------------------------ frame
  loop(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    try {
      this.frame(dt);
    } catch (e) {
      console.error(e);
      $('error-text').textContent = String(e && e.stack || e);
      this.showScreen('error');
      return;
    }
    requestAnimationFrame((t) => this.loop(t));
  }

  handleKeys() {
    const I = this.input;
    const v = this.vehicle;
    if (this.screen !== 'none') {
      if (I.hit('Escape', 'KeyP', 'Pad_Start', 'Pad_B')) {
        if (['journal', 'map', 'help', 'settings', 'pause'].includes(this.screen)) this.closeOverlay();
      }
      if (this.screen === 'briefing' && I.hit('Enter', 'Pad_A')) this.toStartLine();
      else if (this.screen === 'stage-end' && I.hit('Enter', 'Pad_A')) this.afterStage();
      if (I.hit('KeyJ') && this.screen === 'journal') this.closeOverlay();
      if (I.hit('KeyM') && this.screen === 'map') this.closeOverlay();
      return;
    }
    if (I.hit('Escape', 'KeyP', 'Pad_Start')) { this.showScreen('pause'); this.hud.show(false); return; }
    if (I.hit('KeyJ', 'Pad_LB')) { this.hud.show(false); this.openJournal(); return; }
    if (I.hit('KeyM', 'Pad_Back')) { this.hud.show(false); this.openMap(); return; }
    if (I.hit('KeyC', 'Pad_Y')) this.camera.cycle();
    if (I.hit('KeyH', 'Pad_Left')) v.headlights = !v.headlights;
    if (I.hit('KeyT', 'Pad_RB')) { v.tractionAssist = !v.tractionAssist; this.hud.toast('', `Traction assist ${v.tractionAssist ? 'on' : 'off'}`, { ms: 1800 }); }
    const setP = (p, label) => { v.targetPressure = clamp(p, 0.8, 2.6); this.hud.toast('', `Tyres → ${v.targetPressure.toFixed(1)} bar${label ? ` (${label})` : ''}`, { ms: 2000 }); };
    if (I.hit('Digit1')) setP(0.9, 'sand');
    if (I.hit('Digit2')) setP(1.5, 'mixed');
    if (I.hit('Digit3')) setP(2.2, 'road');
    if (I.hit('KeyZ')) setP(v.targetPressure - 0.1);
    if (I.hit('KeyX')) setP(v.targetPressure + 0.1);
    if (I.hit('Pad_Down')) setP(v.targetPressure > 1.6 ? 1.5 : 0.9);
    if (I.hit('Pad_Up')) setP(v.targetPressure < 1.4 ? 1.5 : 2.2);
    if (I.hit('KeyF', 'Pad_Right')) this.hud.toast('', v.fitSpare(), { ms: 2500 });
    if (I.hit('KeyR', 'Pad_B')) this.recover();
    if (I.hit('KeyE', 'Pad_X')) {
      const sp = this.serviceAt();
      if (sp && v.speed < 2) {
        this.servicing = sp.type === 'bivouac' ? 6 : 4;
        this.serviceType = sp.type;
        this.hud.center(sp.type === 'bivouac' ? 'Servicing…' : 'Refuelling…', 1500, true);
      }
    }
    if (this.mode === 'rally' && this.rally.state === 'ready' && I.hit('Enter', 'Pad_A')) {
      this.rally.beginCountdown();
    }
  }

  frame(dt) {
    const I = this.input;
    I.update(dt);
    const gl = this.gl;
    const env = this.env;
    let focus;
    if (this.state === 'drive' && this.vehicle) {
      this.handleKeys();
      const paused = this.screen !== 'none';
      if (!paused) this.simulate(dt);
      focus = this.vehicle.pos;
    } else {
      env.update(dt * 0.3, this.titleFocus);
      this.camera.flyover(dt, this.terrain, this.titleFocus);
      focus = this.titleFocus;
      if (this.screen !== 'title' && I.hit('Escape')) this.closeOverlay();
    }
    this.streamer.update(this.camera.pos);
    this.vegTimer -= dt;
    if (this.vegTimer <= 0 || (this.streamer.vegDirty && this.vegTimer < 0.6)) this.updateVegetation();
    this.render(dt, focus);
    I.endFrame();
  }

  simulate(dt) {
    const v = this.vehicle, env = this.env, I = this.input;
    const rally = this.rally;
    const locked = this.mode === 'rally' && (rally.state === 'ready' || rally.state === 'countdown' || rally.state === 'finished');
    if (this.servicing > 0) {
      this.servicing -= dt;
      v.input.throttle = 0; v.input.brake = 1; v.input.steer = 0; v.input.handbrake = 1;
      v.fuel = Math.min(SPEC.tank, v.fuel + dt * 25);
      if (this.servicing <= 0) {
        if (this.serviceType === 'bivouac') { v.repairAll(); v.fuel = SPEC.tank; this.hud.toast('', 'Serviced', { body: 'Full tank, repairs done, filter cleaned, spares restocked.' }); }
        else this.hud.toast('', 'Refuelled', { body: `Tank: ${Math.round(v.fuel)} L` });
      }
    } else if (locked) {
      v.input.throttle = 0; v.input.brake = 0; v.input.steer = I.steer; v.input.handbrake = 1;
    } else {
      v.input.throttle = I.throttle; v.input.brake = I.brake; v.input.steer = I.steer; v.input.handbrake = I.handbrake;
    }
    const prevImpact = v.impact;
    const statics = this.staticColliders;
    v.update(dt, {
      terrain: this.terrain, env,
      colliders: (x, z, r) => {
        const out = this.streamer.colliders(x, z, r);
        for (const c of statics) if (Math.abs(c[0] - x) < r + c[2] && Math.abs(c[1] - z) < r + c[2]) out.push(c);
        return out;
      },
    });
    if (v.impact > prevImpact + 0.15) this.audio.thump(v.impact);
    env.update(dt, v.pos);
    if (this.mode === 'rally') rally.update(dt, v);
    else {
      const tr = this.terrain.route.track(v.pos[0], v.pos[2], rally.progress, 900);
      rally.progress = tr.s;
    }
    this.fauna.update(dt, v, this.camera, this.streamer);
    this.camera.update(dt, v, this.terrain, I);
    this.emitParticles(dt);
    this.particles.update(dt, env.wind, 1);

    // rally events
    for (const e of rally.events) {
      if (e.type === 'count') this.hud.center(e.text, 900);
      else if (e.type === 'go') this.hud.center('GO!', 1000);
      else if (e.type === 'wp') this.hud.toast('', e.text, { ms: 2500 });
      else if (e.type === 'penalty') this.hud.toast('warn', e.text, { ms: 3500 });
      else if (e.type === 'finish') { this.hud.center('FINISH', 2000); this.stageEndTimer = 2.2; }
    }
    rally.events.length = 0;
    if (this.stageEndTimer > 0) { this.stageEndTimer -= dt; if (this.stageEndTimer <= 0) this.showStageEnd(); }
    for (const e of v.events) this.hud.toast(e.type === 'puncture' ? 'bad' : 'warn', e.text, { ms: 4500 });
    v.events.length = 0;
    if (v.fuel <= 0 && !this.fuelWarned) { this.fuelWarned = true; this.hud.toast('bad', 'Out of fuel', { body: 'Press R to call the assistance truck.' }); }
    if (v.fuel > 1) this.fuelWarned = false;

    // prompts
    const sp = this.serviceAt();
    if (this.mode === 'rally' && rally.state === 'ready') this.hud.prompt('Press <kbd>Enter</kbd> to start the stage');
    else if (sp && v.speed < 3 && this.servicing <= 0) this.hud.prompt(sp.type === 'bivouac' ? 'Bivouac: press <kbd>E</kbd> to refuel &amp; repair' : 'Fuel truck: press <kbd>E</kbd> to refuel');
    else if (v.up[1] < 0.3 && v.speed < 2) this.hud.prompt('Stuck or overturned? Press <kbd>R</kbd> to recover');
    else if (env.daylight < 0.25 && !v.headlights) this.hud.prompt('It is getting dark — press <kbd>H</kbd> for headlights');
    else this.hud.prompt(null);

    // region banner
    const rn = this.regionName();
    if (rn !== this.lastRegion) {
      const reg = this.world.regions.find((r) => r.name === rn);
      if (this.lastRegion !== null) this.hud.banner(reg.name, reg.sub);
      this.lastRegion = rn;
    }
    // flora sightings
    this.florTimer -= dt;
    if (this.florTimer <= 0) { this.florTimer = 0.5; this.checkFlora(); }
    // dirt builds up in dust, washes off in rivers
    const wading = v.wheels.some((w) => (w.waterDepth || 0) > 0.1);
    this.dirt = clamp(this.dirt + dt * (v.dustOut * 0.004 + env.storm * 0.01) - (wading ? dt * 0.08 : 0), 0, 0.85);
    // audio
    const grounded = v.wheels.filter((w) => w.contact).length / 4;
    const slip = Math.max(...v.wheels.map((w) => Math.abs(w.slipSpeed)));
    this.audio.update(dt, {
      rpm: v.rpm, throttle: v.thr, running: v.fuel > 0, speed: v.speed, surf: v.wheels[0].surf.id, grounded, slip,
      airspeed: Math.hypot(v.vel[0] - env.wind[0], v.vel[2] - env.wind[1]), storm: env.storm, wading,
      night: 1 - env.daylight, desert: env.zones.wPre + env.zones.wHam + env.zones.wErg, forest: env.zones.wMid,
    });
    this.hud.update(dt, this.hudState());
  }

  hudState() {
    const rally = this.rally;
    let navTarget = null, waypoints = [];
    if (this.mode === 'rally' && rally.stage && rally.state !== 'complete') {
      const wp = rally.nextWaypoint;
      waypoints = rally.stage.waypoints;
      if (wp) navTarget = { x: wp.x, z: wp.z, wp, label: wp.finish ? 'FINISH' : `WP ${rally.stage.waypoints.indexOf(wp) + 1}/${rally.stage.waypoints.length}` };
    } else if (rally) {
      // free roam: next route marker ahead
      for (const st of rally.stages) for (const w of st.waypoints) if (w.s > rally.progress + 60) { navTarget = { x: w.x, z: w.z, wp: w, label: 'ROUTE' }; break; }
      for (const st of rally.stages) waypoints = waypoints.concat(st.waypoints);
    }
    return { vehicle: this.vehicle, env: this.env, rally, mode: this.mode, journal: this.journal, navTarget, waypoints, regionName: this.regionName() };
  }

  checkFlora() {
    const v = this.vehicle;
    const cx = Math.floor(v.pos[0] / CHUNK), cz = Math.floor(v.pos[2] / CHUNK);
    const cd = this.camera.dir, cp = this.camera.pos;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const vg = this.streamer.veg.get(`${cx + dx},${cz + dz}`);
        if (!vg || !vg.inst) continue;
        for (const [id, arr] of Object.entries(vg.inst)) {
          const sp = this.world.flora.find((f) => f.id === id);
          if (!sp || sp.hidden || this.journal.has('flora', id)) continue;
          const reach = sp.kind === 'tree' ? 70 : sp.kind === 'shrub' || sp.kind === 'succulent' ? 35 : 18;
          for (let i = 0; i < arr.length; i += 8) {
            const ex = arr[i] - cp[0], ey = arr[i + 1] - cp[1], ez = arr[i + 2] - cp[2];
            const d = Math.hypot(ex, ey, ez);
            if (d < reach && (ex * cd[0] + ey * cd[1] + ez * cd[2]) / d > 0.55) { this.discover('flora', sp); break; }
          }
        }
      }
    }
  }

  emitParticles(dt) {
    const v = this.vehicle, P = this.particles, env = this.env;
    const q = this.settings.quality === 'low' ? 0.4 : 1;
    for (const w of v.wheels) {
      if (!w.contact) continue;
      const cp = w.contactPos;
      if ((w.waterDepth || 0) > 0.08 && v.speed > 1.5) {
        const n = Math.min(6, v.speed * 0.4) * q;
        for (let k = 0; k < n; k++) {
          P.emit(cp[0] + (Math.random() - 0.5), cp[1] + 0.2, cp[2] + (Math.random() - 0.5),
            -v.vel[0] * 0.2 + (Math.random() - 0.5) * 3, 2 + Math.random() * 3, -v.vel[2] * 0.2 + (Math.random() - 0.5) * 3,
            0.6 + Math.random() * 0.5, 0.3, 0.8, 0.85, 0.9, 0.95, 0.5);
        }
        continue;
      }
      const s = w.surf;
      if (!s.dust) continue;
      const spin = Math.abs(w.slipSpeed);
      const k = s.dust * (clamp((v.speed - 2) / 18, 0, 1.4) + clamp(spin / 6, 0, 1.5)) * q;
      if (k <= 0.02) continue;
      const n = k * 60 * dt * 1.2;
      const cnt = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
      const c = s.dustColor;
      for (let i = 0; i < cnt; i++) {
        P.emit(cp[0] + (Math.random() - 0.5) * 0.6, cp[1] + 0.15, cp[2] + (Math.random() - 0.5) * 0.6,
          -v.vel[0] * 0.15 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.8, -v.vel[2] * 0.15 + (Math.random() - 0.5) * 2,
          1.6 + Math.random() * 2.4, 0.35 + Math.random() * 0.3, 1.1 + k * 0.6, c[0], c[1], c[2], 0.07 + 0.1 * Math.min(1, k));
      }
    }
    // wind-blown sand: streamers near the ground in a dust storm or strong desert wind
    const desert = env.zones.wHam + env.zones.wErg;
    const blow = Math.max(env.storm, desert * clamp((env.windSpeed - 9) / 8, 0, 1) * 0.5);
    if (blow > 0.05) {
      const cp = this.camera.pos;
      const n = blow * 25 * q;
      const dc = this.world.dustColor;
      for (let i = 0; i < n; i++) {
        const x = cp[0] + (Math.random() - 0.5) * 80, z = cp[2] + (Math.random() - 0.5) * 80;
        const y = this.terrain.height(x, z) + Math.random() * (2 + env.storm * 12);
        P.emit(x, y, z, env.wind[0] * 1.2, 0.3, env.wind[1] * 1.2, 1.5 + Math.random(), 0.8 + env.storm * 2.5, 1.5, dc[0], dc[1], dc[2], 0.12 + env.storm * 0.2);
      }
    }
  }

  updateVegetation() {
    this.vegTimer = 0.75;
    this.streamer.vegDirty = false;
    const s = this.vegScale;
    for (const f of this.flora) {
      const sp = f.sp;
      const near = sp.range * s;
      f.near.update(this.streamer.gather(sp.id, 0, near));
      if (f.far) f.far.update(this.streamer.gather(sp.id, near, (sp.farRange || 0) * s, 0.6));
    }
  }

  render(dt, focus) {
    const gl = this.gl;
    const env = this.env;
    const cam = this.camera;
    const batches = [];
    for (const f of this.flora) {
      if (f.near.count) batches.push(f.near);
      if (f.far && f.far.count) batches.push(f.far);
    }
    for (const b of this.structBatches) batches.push(b);
    batches.push(this.archBatch);
    const objects = [];
    let head = { pos: [0, 0, 0], dir: [0, 0, 1], on: 0 };
    if (this.state === 'drive' && this.vehicle) {
      const v = this.vehicle;
      // waypoint flags for the current stage (or route markers when roaming)
      const st = this.mode === 'rally' ? this.rally.stage : null;
      const arr = [];
      const list = st ? st.waypoints : this.rally.stages.flatMap((x) => x.waypoints);
      for (const w of list) {
        if (Math.hypot(w.x - v.pos[0], w.z - v.pos[2]) > 2500) continue;
        const t = w.done ? [0.5, 1.6, 0.6] : w.missed ? [1.2, 0.4, 0.4] : [1, 1, 1];
        arr.push(w.x, this.terrain.height(w.x, w.z), w.z, 0, 1.6, t[0], t[1], t[2]);
      }
      this.flagBatch.update(new Float32Array(arr));
      batches.push(this.flagBatch);
      // animals
      const inst = this.fauna.instances();
      for (const [id, b] of this.faunaBatches) {
        const data = inst.get(id);
        if (data) { b.update(data); batches.push(b); } else b.count = 0;
      }
      // vehicle body and wheels
      const rel = [v.pos[0] - cam.pos[0], v.pos[1] - cam.pos[1], v.pos[2] - cam.pos[2]];
      const body = m4.create();
      m4.compose(body, rel, v.rot, 1);
      const night = env.daylight < 0.4;
      objects.push({ mesh: this.bodyMesh, model: body, spec: 0.5, dirt: this.dirt, dirtY: rel[1] + 0.3, dirtColor: this.world.dustColor, emissive: v.headlights ? 1 : 0 });
      const up = v.up;
      for (const w of v.wheels) {
        const mount = quat.rotate([0, 0, 0], v.rot, w.local);
        const ext = SPEC.restLength - (w.contact ? w.comp : 0);
        const hub = [rel[0] + mount[0] - up[0] * ext, rel[1] + mount[1] - up[1] * ext, rel[2] + mount[2] - up[2] * ext];
        const qs = quat.fromAxisAngle([0, 0, 0, 1], [0, 1, 0], (w.steer || 0) + (w.left ? Math.PI : 0));
        const qw = quat.fromAxisAngle([0, 0, 0, 1], [1, 0, 0], w.left ? -w.angle : w.angle);
        const q = quat.mul([0, 0, 0, 1], v.rot, quat.mul([0, 0, 0, 1], qs, qw));
        const m = m4.create();
        m4.compose(m, hub, q, w.punctured ? [1, 0.85, 1] : 1);
        objects.push({ mesh: this.wheelMesh, model: m, spec: 0.1, dirt: this.dirt * 1.2, dirtY: hub[1] + 0.5, dirtColor: this.world.dustColor });
      }
      const hp = quat.rotate([0, 0, 0], v.rot, [0, 0.35, 2.3]);
      const hd = quat.rotate([0, 0, 0], v.rot, [0, -0.09, 1]);
      head = { pos: [rel[0] + hp[0], rel[1] + hp[1], rel[2] + hp[2]], dir: hd, on: v.headlights ? 1 : 0 };
      void night;
    }
    const f = {
      width: this.canvas.width, height: this.canvas.height,
      camPos: cam.pos, camDir: cam.dir, fov: cam.fov, far: this.streamer.viewDist * 1.5 + 2000,
      env, time: this.time, dustColor: this.world.dustColor, head,
      chunks: this.streamer.chunks.values(), chunkSize: CHUNK,
      batches, objects, road: this.road, water: this.water, focus,
      particles: this.particles.count ? { data: this.particles.out, count: this.particles.count } : null,
    };
    // the renderer iterates chunks twice (shadow + main): materialise once
    f.chunks = Array.from(f.chunks);
    this.renderer.render(f);
    void gl; void dt;
  }
}

function hintFor(sp) {
  const map = {
    walker: 'An animal of this land. Look for it on the ground.',
    flyer: 'A bird. Scan the sky — soaring birds circle in rising warm air.',
    tree: 'A tree of this region.', shrub: 'A shrub of this region.', grass: 'A grass of this region.',
    flower: 'A small flowering plant. Look closely in clearings.', succulent: 'A succulent plant.',
  };
  let h = map[sp.kind] || '';
  if (sp.activity === 'night') h += ' Active at night.';
  if (sp.activity === 'dusk') h += ' Most active at dawn and dusk.';
  if (sp.activity === 'warm') h += ' Basks when the ground is warm.';
  return h;
}

// Debug helpers (used by automated tests): fast-forward and teleport.
Game.prototype.debugTeleport = function (s) {
  const p = this.terrain.route.at(s);
  this.rally.progress = s;
  this.placeVehicle(p.x, p.z, Math.atan2(p.tx, p.tz));
};
Game.prototype.fastForward = function (seconds, input = {}) {
  const dt = 1 / 30;
  const I = this.input;
  for (let t = 0; t < seconds; t += dt) {
    I.throttle = input.throttle ?? 0; I.brake = input.brake ?? 0; I.steer = input.steer ?? 0; I.handbrake = 0;
    if (input.autopilot) {
      // steer towards a point ahead on the route (test driver)
      const v = this.vehicle, r = this.terrain.route;
      const tr = r.track(v.pos[0], v.pos[2], this.rally.progress, 900);
      const p = r.at(tr.s + 25 + v.speed * 0.8);
      const want = Math.atan2(p.x - v.pos[0], p.z - v.pos[2]);
      let d = want - v.yaw;
      while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      I.steer = clamp(d * 2.2, -1, 1);
      const target = input.autopilot;
      I.throttle = v.speed < target ? 1 : 0.2;
      I.brake = v.speed > target + 4 ? 0.6 : 0;
    }
    if (this.screen === 'none') this.simulate(dt);
    this.streamer.update(this.camera.pos);
  }
  this.updateVegetation();
};

const game = new Game();
window.__game = game;
game.init().catch((e) => {
  console.error(e);
  $('error-text').textContent = String(e && e.stack || e);
  for (const s of SCREENS) $(s).classList.toggle('show', s === 'error');
});
