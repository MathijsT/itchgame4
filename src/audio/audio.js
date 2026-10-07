// Procedural audio with WebAudio: V8 engine, tyres on different surfaces,
// wind, impacts, water and a little ambience (birdsong by day, crickets by night).

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    // shared noise buffer
    const len = ctx.sampleRate * 2;
    const nb = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };

    // engine: firing-frequency sawtooth + sub-harmonic + grit through a lowpass
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 800; this.engFilter.Q.value = 2;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 255) * 2 - 1; curve[i] = Math.tanh(x * 2.5); }
    shaper.curve = curve;
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
    this.osc3 = ctx.createOscillator(); this.osc3.type = 'triangle';
    const g1 = ctx.createGain(); g1.gain.value = 0.45;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    const g3 = ctx.createGain(); g3.gain.value = 0.6;
    this.osc1.connect(g1).connect(shaper); this.osc2.connect(g2).connect(shaper); this.osc3.connect(g3).connect(shaper);
    shaper.connect(this.engFilter).connect(this.engGain).connect(this.master);
    for (const o of [this.osc1, this.osc2, this.osc3]) o.start();
    // intake roar: filtered noise following throttle
    this.intake = noise();
    this.intakeF = ctx.createBiquadFilter(); this.intakeF.type = 'bandpass'; this.intakeF.Q.value = 0.8;
    this.intakeG = ctx.createGain(); this.intakeG.gain.value = 0;
    this.intake.connect(this.intakeF).connect(this.intakeG).connect(this.master);

    // tyres / surface
    this.tyre = noise();
    this.tyreF = ctx.createBiquadFilter(); this.tyreF.type = 'bandpass'; this.tyreF.Q.value = 0.7;
    this.tyreG = ctx.createGain(); this.tyreG.gain.value = 0;
    this.tyre.connect(this.tyreF).connect(this.tyreG).connect(this.master);
    // skid
    this.skid = noise();
    this.skidF = ctx.createBiquadFilter(); this.skidF.type = 'bandpass'; this.skidF.frequency.value = 1600; this.skidF.Q.value = 3;
    this.skidG = ctx.createGain(); this.skidG.gain.value = 0;
    this.skid.connect(this.skidF).connect(this.skidG).connect(this.master);
    // wind
    this.wind = noise();
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 500;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    this.wind.connect(this.windF).connect(this.windG).connect(this.master);
    // water
    this.water = noise();
    this.waterF = ctx.createBiquadFilter(); this.waterF.type = 'highpass'; this.waterF.frequency.value = 900;
    this.waterG = ctx.createGain(); this.waterG.gain.value = 0;
    this.water.connect(this.waterF).connect(this.waterG).connect(this.master);
    // night insects
    this.cricket = ctx.createOscillator(); this.cricket.frequency.value = 4400;
    this.cricketAM = ctx.createGain(); this.cricketAM.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 28;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.5;
    lfo.connect(lfoG).connect(this.cricketAM.gain);
    this.cricketG = ctx.createGain(); this.cricketG.gain.value = 0;
    this.cricket.connect(this.cricketAM).connect(this.cricketG).connect(this.master);
    this.cricket.start(); lfo.start();
    this.birdTimer = 2;
  }

  thump(strength) {
    if (!this.ctx || strength < 0.15) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300 + strength * 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(1, strength) * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random()); s.stop(t + 0.4);
  }

  chirp() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    const g = ctx.createGain();
    const base = 2500 + Math.random() * 2500;
    const notes = 2 + Math.floor(Math.random() * 4);
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < notes; i++) {
      const t0 = t + i * 0.12;
      o.frequency.setValueAtTime(base * (1 + (Math.random() - 0.5) * 0.3), t0);
      o.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.6), t0 + 0.08);
      g.gain.setValueAtTime(0.035, t0);
      g.gain.linearRampToValueAtTime(0, t0 + 0.09);
    }
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + notes * 0.12 + 0.1);
  }

  update(dt, s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = 0.05;
    this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, t, 0.1);
    const fire = (s.rpm / 60) * 4; // V8 firing frequency
    this.osc1.frequency.setTargetAtTime(fire, t, k * 0.5);
    this.osc2.frequency.setTargetAtTime(fire * 0.5, t, k * 0.5);
    this.osc3.frequency.setTargetAtTime(fire * 0.25, t, k * 0.5);
    this.engFilter.frequency.setTargetAtTime(400 + s.throttle * 1800 + s.rpm * 0.15, t, k);
    this.engGain.gain.setTargetAtTime(s.running ? 0.12 + s.throttle * 0.12 : 0, t, k);
    this.intakeF.frequency.setTargetAtTime(200 + s.rpm * 0.25, t, k);
    this.intakeG.gain.setTargetAtTime(s.running ? s.throttle * 0.06 * (s.rpm / 6000) : 0, t, k);
    // tyres: frequency by surface (gravel crunch, sand hiss, asphalt hum)
    const surfF = { 0: 350, 1: 2200, 2: 900, 3: 1600, 4: 2000, 5: 600, 6: 1200, 7: 800, 8: 900 }[s.surf] ?? 1000;
    this.tyreF.frequency.setTargetAtTime(surfF, t, 0.2);
    this.tyreG.gain.setTargetAtTime(Math.min(0.22, s.speed * 0.006) * s.grounded, t, 0.08);
    this.skidG.gain.setTargetAtTime(Math.min(0.15, Math.max(0, s.slip - 2) * 0.02) * s.grounded * (s.surf === 0 ? 1 : 0.3), t, 0.05);
    this.windF.frequency.setTargetAtTime(300 + s.airspeed * 25, t, 0.2);
    this.windG.gain.setTargetAtTime(Math.min(0.3, s.airspeed * s.airspeed * 0.00012 + s.storm * 0.25), t, 0.2);
    this.waterG.gain.setTargetAtTime(s.wading ? Math.min(0.3, s.speed * 0.04) : 0, t, 0.05);
    this.cricketG.gain.setTargetAtTime(s.night * s.desert * 0.02, t, 0.5);
    this.birdTimer -= dt;
    if (this.birdTimer < 0) {
      this.birdTimer = 0.8 + Math.random() * 3;
      if (s.forest > 0.3 && s.night < 0.5 && Math.random() < s.forest) this.chirp();
    }
  }
}
