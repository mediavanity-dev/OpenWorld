// The minimap as a radar: heading-up (up is the way you face), and only what matters right now,
// each as a clear icon: your expedition's goal (with its distance; pinned to the rim, pointing
// the way, when it's further than the radar shows), the few nearest places you haven't found
// (the same icons as on the map), 🐾 for an animal you're tracking, a glowing creature that has
// shown itself, ✦ for today's treasure, and your home base. Two faint rings give the scale.
// The ground you've explored lives on the journal's Map, not here.

import { offsetMeters } from '../geo.js';
import { groupInfo, iconIndex, getAtlas, groupOf } from '../world/icons.js';
import { fmtDist } from '../units.js';

const ICON_CELL = 64, ICON_COLS = 4;      // the place-icon atlas (src/world/icons.js)
const RADIUS_M = 300;                     // metres from the centre to the rim
const RINGS_M = [100, 250];
const MAX_PLACES = 6;
const BUSINESS = new Set(['food', 'shop', 'lodging', 'other', 'transport']);

export class Minimap {
  constructor(canvas, { onTap } = {}) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.radius = RADIUS_M;
    canvas.addEventListener('click', () => onTap?.());
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(r.width * dpr);
    if (w && this.c.width !== w) { this.c.width = w; this.c.height = w; }
  }

  // the nearest unfound places worth walking to: landmarks first, cafés and shops only if there's room
  pick(pos, pois, discovered) {
    const list = [];
    for (const p of pois) {
      if (discovered[p.ref] || p.cls === 'geocache') continue;
      const o = offsetMeters(pos.lat, pos.lon, p.lat, p.lon), d = Math.hypot(o.x, o.z);
      if (d > this.radius * 0.95) continue;
      list.push({ p, d, biz: BUSINESS.has(groupOf(p.kind, p.cls)) });
    }
    list.sort((a, b) => a.biz - b.biz || a.d - b.d);
    return list.slice(0, MAX_PLACES).map((x) => x.p);
  }

  // bearing: degrees clockwise from north that should point "up"
  draw({ pos, bearing = 0, pois = [], critters = [], home = null, discovered = {}, hunt = null, treasure = null, quest = null, t = 0 }) {
    this.resize();
    const { g, c } = this;
    const W = c.width, R = W / 2, k = (R - 3) / this.radius;
    const th = (bearing * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
    // east/north metres -> canvas px (heading-up)
    const P = (lat, lon) => {
      const o = offsetMeters(pos.lat, pos.lon, lat, lon), e = o.x, n = -o.z;
      return [R + (e * cos - n * sin) * k, R - (e * sin + n * cos) * k];
    };
    const rim = (x, y, inset) => { const dx = x - R, dy = y - R, len = Math.hypot(dx, dy), max = R - inset; return len > max ? [R + (dx / len) * max, R + (dy / len) * max, true] : [x, y, false]; };
    const icon = W / 9; // place icon diameter
    const font = (px, bold = false) => { g.font = `${bold ? 'bold ' : ''}${Math.round(px)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; };

    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.clip();
    const bg = g.createRadialGradient(R, R, 0, R, R, R);
    bg.addColorStop(0, 'rgba(30,38,48,0.92)'); bg.addColorStop(1, 'rgba(14,18,24,0.94)');
    g.fillStyle = bg; g.fillRect(0, 0, W, W);

    // scale: two faint rings, labelled
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = Math.max(1, W / 160);
    font(W / 19);
    for (const m of RINGS_M) {
      g.beginPath(); g.arc(R, R, m * k, 0, Math.PI * 2); g.stroke();
      const la = Math.PI * 0.75; // lower left, away from the N and most icons
      g.fillStyle = 'rgba(255,255,255,0.32)'; g.fillText(fmtDist(m), R - Math.sin(la) * m * k * 0.98, R + Math.cos(-la) * -m * k * 0.98);
    }

    // home base
    if (home) {
      const [hx, hy] = P(home.lat, home.lon);
      if ((hx - R) ** 2 + (hy - R) ** 2 < (R - icon / 2) ** 2) { font(icon * 0.8); g.fillText('🏠', hx, hy); }
    }

    // the nearest unfound places, as their map icons
    const atlas = getAtlas();
    const placed = [[R, R]]; // your arrow's spot is taken
    for (const p of this.pick(pos, pois, discovered)) {
      const [x, y] = P(p.lat, p.lon), info = groupInfo(p.kind, p.cls), i = iconIndex(p.kind, p.cls);
      if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < icon * 0.95)) continue; // no pile-ups
      placed.push([x, y]);
      g.fillStyle = info.color; g.strokeStyle = 'rgba(10,14,20,0.9)'; g.lineWidth = Math.max(1, W / 140);
      g.beginPath(); g.arc(x, y, icon / 2, 0, Math.PI * 2); g.fill(); g.stroke();
      g.drawImage(atlas, (i % ICON_COLS) * ICON_CELL, Math.floor(i / ICON_COLS) * ICON_CELL, ICON_CELL, ICON_CELL, x - icon * 0.42, y - icon * 0.42, icon * 0.84, icon * 0.84);
    }

    // an animal you're tracking: 🐾 breathing over the area it's in
    if (hunt?.hint && !hunt.revealed) {
      const [hx, hy] = P(hunt.hint.lat, hunt.hint.lon), hr = Math.max(icon, hunt.hint.r * k);
      const breathe = 0.75 + 0.25 * Math.sin(t / 600);
      const gr = g.createRadialGradient(hx, hy, 0, hx, hy, hr);
      gr.addColorStop(0, `rgba(95,208,138,${0.45 * breathe})`); gr.addColorStop(1, 'rgba(95,208,138,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(hx, hy, hr, 0, Math.PI * 2); g.fill();
      const [px, py] = rim(hx, hy, icon * 0.7);
      font(icon * 0.85); g.fillText('🐾', px, py);
    }
    // a creature that has shown itself: a bright green dot that pulses
    for (const cr of critters) {
      const [x, y] = P(cr.lat, cr.lon), pulse = 1 + 0.25 * Math.sin(t / 250);
      g.fillStyle = '#5fd08a'; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = Math.max(1.5, W / 100);
      g.beginPath(); g.arc(x, y, (icon / 3) * pulse, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // today's treasure: ✦ on the rim when it's warm (pointing the way), on the spot when it's close
    if (treasure?.band && treasure.band !== 'cool') {
      const o = offsetMeters(pos.lat, pos.lon, treasure.t.lat, treasure.t.lon);
      const near = treasure.band === 'hot';
      let [x, y] = P(treasure.t.lat, treasure.t.lon);
      if (!near) { const a = Math.atan2(o.x, -o.z) + ((treasure.t.rim || 0) * Math.PI) / 180 - th; x = R + Math.sin(a) * (R - icon * 0.7); y = R - Math.cos(a) * (R - icon * 0.7); }
      const pulse = 1 + 0.2 * Math.sin(t / 300);
      g.shadowColor = 'rgba(255,211,107,0.9)'; g.shadowBlur = W / 20;
      g.fillStyle = '#ffd36b'; font(icon * 0.9 * pulse, true); g.fillText('✦', x, y);
      g.shadowBlur = 0;
    }

    // the expedition's goal: a gold star with its distance; on the rim, pointing the way, when far
    if (quest?.zone) {
      const [x, y] = P(quest.zone.lat, quest.zone.lon), r = Math.max(icon, quest.zone.r * k);
      g.setLineDash([W / 40, W / 60]); g.strokeStyle = 'rgba(255,211,107,0.9)'; g.lineWidth = Math.max(1.5, W / 70);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(255,211,107,0.12)'; g.fill();
    }
    for (const [pt, col, glyph] of [[quest?.target, '#ffd36b', '★'], [quest?.habitat, '#5fd08a', '🎯']]) {
      if (!pt) continue;
      const o = offsetMeters(pos.lat, pos.lon, pt.lat, pt.lon), d = Math.hypot(o.x, o.z);
      const [px, py] = P(pt.lat, pt.lon), [x, y, pinned] = rim(px, py, W * 0.27); // inside the N marker's band
      const pulse = 1 + 0.12 * Math.sin(t / 350), s = icon * 1.15 * pulse;
      g.fillStyle = 'rgba(10,14,20,0.85)'; g.beginPath(); g.arc(x, y, s / 2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = col; g.lineWidth = Math.max(2, W / 70); g.stroke();
      g.fillStyle = col; font(s * 0.7, true); g.fillText(glyph, x, y + s * 0.03);
      // distance label, inside the circle's edge
      const lx = pinned ? R + (x - R) * 0.55 : x, ly = pinned ? R + (y - R) * 0.55 : y + s * 0.85;
      font(W / 13, true); g.lineWidth = W / 40; g.strokeStyle = 'rgba(10,14,20,0.9)';
      g.strokeText(fmtDist(d), lx, ly); g.fillStyle = '#fff'; g.fillText(fmtDist(d), lx, ly);
    }

    // you: an arrow pointing the way you face (always up)
    const a = W / 22;
    g.fillStyle = '#ff7a3d'; g.strokeStyle = 'rgba(10,14,20,0.9)'; g.lineWidth = Math.max(1, W / 140);
    g.beginPath(); g.moveTo(R, R - a * 1.5); g.lineTo(R + a, R + a); g.lineTo(R, R + a * 0.45); g.lineTo(R - a, R + a); g.closePath(); g.fill(); g.stroke();
    g.restore();

    // rim + north marker
    g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = Math.max(1, W / 110);
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.stroke();
    const nx = R + Math.sin(-th) * (R - W * 0.07), ny = R - Math.cos(-th) * (R - W * 0.07);
    g.fillStyle = '#ffd36b'; font(W * 0.09, true); g.fillText('N', nx, ny);
  }
}
