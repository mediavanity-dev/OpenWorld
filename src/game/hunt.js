// The hunt (beta): creatures don't pop up beside you; they leave signs you follow.
// A hidden creature sits somewhere ahead; you get a drifting "rustle" on the minimap
// that tightens as you close in, a warmer/colder signal, tracks on the ground when
// near, and it reveals itself up close. Rush in and it flees. Real local species;
// rarer ones leave fainter trails.

import { haversine, offsetGeo, offsetMeters } from '../geo.js';

const SIGNAL_BANDS = [250, 150, 90, 50, 25]; // metres: signal 1..5 as you get closer

export function startHunt(pos, sp, heading, rand = Math.random) {
  const rare = sp.rarity === 'rare';
  const dist = rare ? 110 + rand() * 70 : 55 + rand() * 55;
  const base = heading != null ? (heading * Math.PI) / 180 : rand() * Math.PI * 2;
  const ang = base + (rand() - 0.5) * 2.2;
  const at = offsetGeo(pos.lat, pos.lon, Math.sin(ang) * dist, Math.cos(ang) * dist);
  return {
    id: `h${Date.now()}`, sp, lat: at.lat, lon: at.lon, rare,
    born: Date.now(), ttl: (rare ? 8 : 6) * 60 * 1000,
    reveal: rare ? 16 : 24, fled: false, revealed: false,
    d: dist, best: dist, signal: 0, trend: 0,
    hint: null, hintAt: 0, tracks: null,
  };
}

// Advance a hunt. speed: the player's real ground speed (m/s).
// Returns an event string or null: 'signal-up' | 'tracks' | 'reveal' | 'flee' | 'cold'
export function stepHunt(h, pos, speed, now = Date.now(), rand = Math.random) {
  if (now - h.born > h.ttl) return 'cold';
  const d = haversine(pos.lat, pos.lon, h.lat, h.lon);
  h.trend = d < h.d - 1.5 ? 1 : d > h.d + 1.5 ? -1 : h.trend;
  h.d = d;
  h.best = Math.min(h.best, d);
  if (d > 420) return 'cold'; // walked away

  // rushing in scares it off (once)
  if (!h.fled && d < 35 && speed > 4.5) {
    const o = offsetMeters(pos.lat, pos.lon, h.lat, h.lon);
    const len = Math.hypot(o.x, o.z) || 1, run = 45 + rand() * 30;
    const p = offsetGeo(h.lat, h.lon, (o.x / len) * run, (-o.z / len) * run);
    h.lat = p.lat; h.lon = p.lon; h.fled = true; h.revealed = false; h.tracks = null; h.reveal = Math.min(h.reveal, 15);
    return 'flee';
  }

  // the rustle: a soft area that tightens as you close in, re-drawn every few seconds
  if (!h.hint || now - h.hintAt > 3500) {
    const r = Math.max(8, d * 0.35), a = rand() * Math.PI * 2, k = rand() * r * 0.8;
    const c = offsetGeo(h.lat, h.lon, Math.cos(a) * k, Math.sin(a) * k);
    h.hint = { lat: c.lat, lon: c.lon, r };
    h.hintAt = now;
  }

  const signal = SIGNAL_BANDS.filter((b) => d < b).length;
  const up = signal > h.signal;
  h.signal = signal;

  if (!h.revealed && d < h.reveal) { h.revealed = true; return 'reveal'; }
  if (!h.tracks && d < 90) { h.tracks = trackLine(pos, h, rand); return 'tracks'; }
  return up ? 'signal-up' : null;
}

// five prints leading in towards the creature, laid once so they stay put on the ground
function trackLine(pos, h, rand) {
  const o = offsetMeters(pos.lat, pos.lon, h.lat, h.lon);
  const out = [];
  for (let k = 0; k < 6; k++) {
    const t = 0.35 + k * 0.1, side = (k % 2 ? 0.6 : -0.6) + (rand() - 0.5) * 0.4;
    const len = Math.hypot(o.x, o.z) || 1, nx = -o.z / len, nz = o.x / len; // perpendicular
    const p = offsetGeo(pos.lat, pos.lon, o.x * t + nx * side, -(o.z * t + nz * side));
    out.push({ lat: p.lat, lon: p.lon, yaw: Math.atan2(o.x, o.z) });
  }
  return out;
}
