// @ts-check
// Daily treasure (beta): a few golden finds hidden each day in every map area, along
// public streets and paths. Placement comes from a seed of (date, area), so everyone in
// the same place hunts the same finds on the same day, with no server involved.

import { offsetGeo, rng, hashStr } from '../geo.js';

export const PER_AREA = 3;

// chunk: a loaded map area (with .streets in chunk-local metres); dateKey: 'YYYY-MM-DD'
export function treasuresFor(chunk, dateKey) {
  const lines = [];
  for (const st of chunk.streets || []) for (const L of st.lines) if (L.length >= 4) lines.push(L);
  if (!lines.length) return [];
  const rand = rng(hashStr(`${dateKey}|${chunk.key}|treasure`));
  const out = [];
  for (let k = 0, tries = 0; k < PER_AREA && tries < 40; tries++) {
    const L = lines[Math.floor(rand() * lines.length)];
    const seg = Math.floor(rand() * (L.length / 2 - 1)) * 2, t = rand();
    const x = L[seg] + (L[seg + 2] - L[seg]) * t, z = L[seg + 1] + (L[seg + 3] - L[seg + 1]) * t;
    const p = offsetGeo(chunk.latc, chunk.lonc, x, -z);
    if (!chunk.contains(p.lat, p.lon)) continue;
    if (out.some((q) => Math.hypot(q.x - x, q.z - z) < 120)) continue; // spread them out
    out.push({ id: `${dateKey}:${chunk.key}:${k}`, lat: p.lat, lon: p.lon, x, z, area: chunk.areaName || null, rim: rand() * 50 - 25 });
    k++;
  }
  return out;
}

// how close: 'hot' (sparkle visible), 'warm' (direction hinted), 'cool' (somewhere near)
export function bandOf(d) { return d < 40 ? 'hot' : d < 160 ? 'warm' : d < 380 ? 'cool' : null; }
