// Optional ambient soundscape, synthesised on the device (no audio files):
// wind and rain from filtered noise, occasional birdsong by day in green places,
// crickets on warm nights. Very quiet; off by default; must be started from a tap.

export class Ambience {
  constructor() { this.ctx = null; this.on = false; this.state = {}; this._t = null; }

  start() {
    if (this.on) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx ||= new AC();
    const c = this.ctx;
    c.resume();
    if (!this.master) {
      this.master = c.createGain(); this.master.gain.value = 0.0; this.master.connect(c.destination);
      // shared noise buffer
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } // brown-ish
      const white = c.createBuffer(1, len, c.sampleRate), wd = white.getChannelData(0);
      for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
      const loop = (b) => { const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.start(); return s; };
      this.windF = c.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 400;
      this.windG = c.createGain(); this.windG.gain.value = 0;
      loop(buf).connect(this.windF).connect(this.windG).connect(this.master);
      this.rainF = c.createBiquadFilter(); this.rainF.type = 'bandpass'; this.rainF.frequency.value = 2500; this.rainF.Q.value = 0.6;
      this.rainG = c.createGain(); this.rainG.gain.value = 0;
      loop(white).connect(this.rainF).connect(this.rainG).connect(this.master);
    }
    this.master.gain.setTargetAtTime(0.5, c.currentTime, 1.5);
    this.on = true;
    document.addEventListener('visibilitychange', this._vis ||= () => (document.hidden ? c.suspend() : this.on && c.resume()));
    this.schedule();
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    clearTimeout(this._t);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    setTimeout(() => !this.on && this.ctx.suspend(), 1500);
  }

  // { wind: km/h, rain: 0..1, day: 0..1, green: bool, warm: bool }
  update(s) {
    this.state = s;
    if (!this.on) return;
    const t = this.ctx.currentTime;
    this.windG.gain.setTargetAtTime(Math.min(0.5, 0.04 + s.wind / 90), t, 2);
    this.windF.frequency.setTargetAtTime(250 + Math.min(900, s.wind * 18), t, 2);
    this.rainG.gain.setTargetAtTime(s.rain * 0.12, t, 2);
  }

  schedule() {
    clearTimeout(this._t);
    if (!this.on) return;
    const s = this.state;
    if (s.day > 0.5 && s.green && s.rain < 0.5) this.bird();
    else if (s.day < 0.2 && s.green && s.warm) this.cricket();
    this._t = setTimeout(() => this.schedule(), 2500 + Math.random() * 6000);
  }

  bird() {
    const c = this.ctx, t0 = c.currentTime + 0.05, notes = 2 + Math.floor(Math.random() * 4);
    const base = 2800 + Math.random() * 2200, pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(this.master); }
    for (let k = 0; k < notes; k++) {
      const o = c.createOscillator(), g = c.createGain(), t = t0 + k * (0.09 + Math.random() * 0.08);
      o.type = 'sine';
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.25), t);
      o.frequency.exponentialRampToValueAtTime(base * (1.15 + Math.random() * 0.3), t + 0.07);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
      o.connect(g).connect(pan || this.master); o.start(t); o.stop(t + 0.1);
    }
  }

  // a soft two-note chime (hunt signal, treasure); level 0..5 raises the pitch slightly
  chime(level = 1) {
    if (!this.on) return;
    const c = this.ctx, t0 = c.currentTime + 0.02;
    [0, 0.11].forEach((dt, k) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = 660 * Math.pow(2, (level + k * 4) / 12);
      g.gain.setValueAtTime(0, t0 + dt); g.gain.linearRampToValueAtTime(0.03, t0 + dt + 0.015); g.gain.exponentialRampToValueAtTime(0.0005, t0 + dt + 0.6);
      o.connect(g).connect(this.master); o.start(t0 + dt); o.stop(t0 + dt + 0.65);
    });
  }

  cricket() {
    const c = this.ctx, t0 = c.currentTime + 0.05;
    for (let k = 0; k < 6; k++) {
      const o = c.createOscillator(), g = c.createGain(), t = t0 + k * 0.06;
      o.type = 'triangle'; o.frequency.value = 4400;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.012, t + 0.008); g.gain.linearRampToValueAtTime(0, t + 0.035);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.04);
    }
  }
}
