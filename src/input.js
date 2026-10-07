// Keyboard + gamepad input with smoothed analogue axes for keyboard driving.

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();   // edge-triggered this frame
    this.steer = 0; this.throttle = 0; this.brake = 0; this.handbrake = 0;
    this.lookX = 0; this.lookY = 0;
    this.gamepad = null;
    this.padPrev = [];
    this.usingPad = false;
    this.mouseDX = 0; this.mouseDY = 0; this.dragging = false;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.usingPad = false;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousedown', (e) => { if (e.button === 0 && e.target.tagName === 'CANVAS') this.dragging = true; });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e) => { if (this.dragging) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } });
  }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }

  // Gamepad buttons mapped to virtual key codes so game code checks one thing
  _pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads || []).find((p) => p && p.connected);
    this.gamepad = gp || null;
    if (!gp) return;
    const map = { 0: 'Pad_A', 1: 'Pad_B', 2: 'Pad_X', 3: 'Pad_Y', 4: 'Pad_LB', 5: 'Pad_RB', 8: 'Pad_Back', 9: 'Pad_Start', 12: 'Pad_Up', 13: 'Pad_Down', 14: 'Pad_Left', 15: 'Pad_Right' };
    for (const [i, code] of Object.entries(map)) {
      const b = gp.buttons[i];
      const on = b && b.pressed;
      if (on && !this.padPrev[i]) { this.pressed.add(code); this.usingPad = true; }
      if (on) this.keys.add(code); else this.keys.delete(code);
      this.padPrev[i] = on;
    }
  }

  update(dt) {
    this._pollPad();
    const gp = this.gamepad;
    let padSteer = 0, padThr = 0, padBrk = 0;
    if (gp) {
      const ax = gp.axes[0] || 0;
      padSteer = Math.abs(ax) > 0.08 ? Math.sign(ax) * Math.pow((Math.abs(ax) - 0.08) / 0.92, 1.4) : 0;
      padThr = gp.buttons[7] ? gp.buttons[7].value : 0;
      padBrk = gp.buttons[6] ? gp.buttons[6].value : 0;
      if (Math.abs(padSteer) > 0.1 || padThr > 0.1 || padBrk > 0.1) this.usingPad = true;
      this.lookX = Math.abs(gp.axes[2] || 0) > 0.15 ? gp.axes[2] : 0;
      this.lookY = Math.abs(gp.axes[3] || 0) > 0.15 ? gp.axes[3] : 0;
    }
    if (this.usingPad && gp) {
      this.steer = padSteer; this.throttle = padThr; this.brake = padBrk;
      this.handbrake = this.down('Pad_A') ? 1 : 0;
    } else {
      // keyboard: ramp axes so steering and pedals feel progressive
      const l = this.down('KeyA', 'ArrowLeft'), r = this.down('KeyD', 'ArrowRight');
      const target = (r ? 1 : 0) - (l ? 1 : 0);
      const rate = target === 0 ? 5 : Math.sign(target) !== Math.sign(this.steer) ? 7 : 3.2;
      this.steer += Math.max(-rate * dt, Math.min(rate * dt, target - this.steer));
      const t = this.down('KeyW', 'ArrowUp') ? 1 : 0;
      this.throttle += Math.max(-6 * dt, Math.min(3.5 * dt, t - this.throttle));
      const b = this.down('KeyS', 'ArrowDown') ? 1 : 0;
      this.brake += Math.max(-8 * dt, Math.min(5 * dt, b - this.brake));
      this.handbrake = this.down('Space') ? 1 : 0;
    }
  }

  endFrame() { this.pressed.clear(); this.mouseDX = 0; this.mouseDY = 0; }
}
