// Heading-up minimap: explored ground is "lit", the rest is fog; nearby places,
// home and creatures are dots. Drawn a few times per second on a small canvas.

import { geohashBounds, offsetMeters } from '../geo.js';
import { POI_COLORS } from '../world/builder.js';

const CELL_FILL = { 1: 'rgba(176,122,255,0.30)', 2: 'rgba(120,200,255,0.42)', 3: 'rgba(225,235,210,0.55)' };

export class Minimap {
  constructor(canvas, { onTap } = {}) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.bounds = new Map(); // geohash -> bounds (cache)
    this.radius = 450;       // metres shown from centre to rim
    canvas.addEventListener('click', () => onTap?.());
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(r.width * dpr);
    if (w && this.c.width !== w) { this.c.width = w; this.c.height = w; }
  }

  cellBounds(h) {
    let b = this.bounds.get(h);
    if (!b) { b = geohashBounds(h); this.bounds.set(h, b); }
    return b;
  }

  // bearing: degrees clockwise from north that should point "up"
  draw({ pos, bearing = 0, cells = {}, pois = [], critters = [], home = null, discovered = {} }) {
    this.resize();
    const { g, c } = this;
    const W = c.width, R = W / 2, k = (R - 3) / this.radius;
    const th = (bearing * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
    // east/north metres -> canvas px (heading-up)
    const P = (lat, lon) => {
      const o = offsetMeters(pos.lat, pos.lon, lat, lon), e = o.x, n = -o.z;
      return [R + (e * cos - n * sin) * k, R - (e * sin + n * cos) * k];
    };
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = 'rgba(16,20,26,0.88)';
    g.fillRect(0, 0, W, W);

    // explored cells (quick reject by degrees first)
    const dLat = this.radius / 111320 * 1.5, dLon = dLat / Math.max(0.2, Math.cos((pos.lat * Math.PI) / 180));
    for (const h in cells) {
      const b = this.cellBounds(h);
      if (Math.abs(b.lat - pos.lat) > dLat || Math.abs(b.lon - pos.lon) > dLon) continue;
      g.fillStyle = CELL_FILL[cells[h]] || CELL_FILL[1];
      g.beginPath();
      const p1 = P(b.s, b.w), p2 = P(b.s, b.e), p3 = P(b.n, b.e), p4 = P(b.n, b.w);
      g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.lineTo(p4[0], p4[1]);
      g.fill();
    }

    // places
    const dot = Math.max(2, W / 60);
    for (const p of pois) {
      const [x, y] = P(p.lat, p.lon);
      if ((x - R) ** 2 + (y - R) ** 2 > (R - 2) ** 2) continue;
      g.fillStyle = discovered[p.ref] ? 'rgba(160,160,160,0.6)' : POI_COLORS[p.kind.split(':')[0]] || '#888';
      g.beginPath(); g.arc(x, y, dot, 0, Math.PI * 2); g.fill();
    }
    if (home) {
      const [x, y] = P(home.lat, home.lon);
      g.fillStyle = '#3db8ff';
      g.beginPath(); g.moveTo(x, y - dot * 2); g.lineTo(x + dot * 1.6, y + dot); g.lineTo(x - dot * 1.6, y + dot); g.fill();
    }
    for (const cr of critters) {
      const [x, y] = P(cr.lat, cr.lon);
      g.strokeStyle = '#5fd08a'; g.lineWidth = Math.max(1.5, W / 90);
      g.beginPath(); g.arc(x, y, dot * 1.8, 0, Math.PI * 2); g.stroke();
    }

    // you
    g.fillStyle = '#ff7a3d';
    g.beginPath(); g.moveTo(R, R - dot * 3); g.lineTo(R + dot * 2, R + dot * 2); g.lineTo(R, R + dot); g.lineTo(R - dot * 2, R + dot * 2); g.fill();
    g.restore();

    // rim + north marker
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = Math.max(1, W / 120);
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.stroke();
    const nx = R + Math.sin(-th) * (R - W * 0.09), ny = R - Math.cos(-th) * (R - W * 0.09);
    g.fillStyle = '#ffd36b';
    g.font = `bold ${Math.round(W * 0.11)}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', nx, ny);
  }
}
