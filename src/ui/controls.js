// Camera + movement input: mouse, keyboard, touch (drag / pinch / twist / tap) and an on-screen stick.

export class Controls {
  constructor(canvas, stickEl, { onTap } = {}) {
    this.yaw = 0; this.pitch = 0.75; this.dist = 70;
    this.pan = { x: 0, z: 0 };   // view offset from the character, local metres
    this.panMode = false;        // one-finger / left drag pans instead of orbiting (Present mode)
    this.recentering = false;
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };
    this.lastInput = 0;
    this.onTap = onTap;
    const ptrs = new Map();
    let gesture = null; // { d, a } for two-finger gestures
    let tap = null;

    const touchInfo = () => {
      const [a, b] = [...ptrs.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), my: (a.y + b.y) / 2 };
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      tap = ptrs.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
      if (ptrs.size === 2) gesture = touchInfo();
      this.touch();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap = null;
      if (ptrs.size === 1) {
        const panning = this.panMode ? !(e.buttons & 2) : !!(e.buttons & 2);
        if (panning) this.panBy(dx, dy);
        else {
          this.yaw -= dx * 0.006;
          this.pitch = Math.min(1.5, Math.max(0.08, this.pitch + dy * 0.004));
        }
      } else if (ptrs.size === 2 && gesture) {
        const g = touchInfo();
        this.zoomBy(gesture.d / Math.max(1, g.d));
        let da = g.a - gesture.a;
        if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
        this.yaw -= da;
        // two fingers moving up/down together tilts the view
        this.pitch = Math.min(1.5, Math.max(0.08, this.pitch + (g.my - gesture.my) * 0.004));
        gesture = g;
      }
      this.touch();
    });
    const end = (e) => {
      if (tap && ptrs.size === 1 && performance.now() - tap.t < 300) this.onTap?.(e.clientX, e.clientY);
      ptrs.delete(e.pointerId);
      tap = null;
      gesture = ptrs.size === 2 ? touchInfo() : null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); tap = null; gesture = null; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(Math.pow(1.0015, e.deltaY)); this.touch(); }, { passive: false });

    addEventListener('keydown', (e) => {
      if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      this.keys.add(e.code); this.touch();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // on-screen stick
    if (stickEl) {
      const knob = stickEl.firstElementChild;
      const move = (e) => {
        const r = stickEl.getBoundingClientRect();
        let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
        const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
        this.stick.x = x; this.stick.y = y;
        knob.style.transform = `translate(${x * 35}px, ${y * 35}px)`;
        this.touch();
      };
      const stop = () => { this.stick.x = this.stick.y = 0; knob.style.transform = ''; };
      stickEl.addEventListener('pointerdown', (e) => { stickEl.setPointerCapture(e.pointerId); move(e); });
      stickEl.addEventListener('pointermove', (e) => { if (stickEl.hasPointerCapture(e.pointerId)) move(e); });
      stickEl.addEventListener('pointerup', stop);
      stickEl.addEventListener('pointercancel', stop);
    }
  }

  touch() { this.lastInput = performance.now(); this.recentering = false; }

  // drag on screen -> move the view over the ground (map-style), scaled by zoom
  panBy(dx, dy) {
    const k = this.dist * 0.0022 / Math.max(0.35, Math.sin(this.pitch) * 0.6 + 0.4);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // right = (cos, -sin), forward = (-sin, -cos) in local x/z
    this.pan.x += (-cy * dx - sy * dy) * k;
    this.pan.z += (sy * dx - cy * dy) * k;
    const m = Math.hypot(this.pan.x, this.pan.z), max = 3000;
    if (m > max) { this.pan.x *= max / m; this.pan.z *= max / m; }
  }
  isAway() { return Math.hypot(this.pan.x, this.pan.z) > 8 || this.dist > 400; }
  recenter() { this.recentering = true; }
  // called every frame: eases the view back onto the character
  step(dt) {
    if (!this.recentering) return;
    const k = Math.min(1, dt * 5);
    this.pan.x -= this.pan.x * k; this.pan.z -= this.pan.z * k;
    if (this.dist > 120) this.dist += (70 - this.dist) * k;
    if (Math.hypot(this.pan.x, this.pan.z) < 0.5 && this.dist <= 121) { this.pan.x = this.pan.z = 0; this.recentering = false; }
  }
  active() { return performance.now() - this.lastInput < 1200 || this.keys.size > 0 || this.stick.x || this.stick.y; }
  zoomBy(f) { this.dist = Math.min(2500, Math.max(5, this.dist * f)); }

  // -> { east, north, run } relative to the camera, or null
  move() {
    let f = 0, s = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) s += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) s -= 1;
    f -= this.stick.y; s += this.stick.x;
    const m = Math.hypot(f, s);
    if (m < 0.05) return null;
    if (m > 1) { f /= m; s /= m; }
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    return {
      east: -sy * f + cy * s,
      north: cy * f + sy * s,
      run: k.has('ShiftLeft') || k.has('ShiftRight') || Math.hypot(this.stick.x, this.stick.y) > 0.95,
    };
  }
}
