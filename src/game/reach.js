// @ts-check
// Can people get there? Decided by rules from open map data (OpenStreetMap via the map tiles
// already loaded): each map area keeps the ways people may walk on (public paths and streets,
// not motorways, not rail, not ways closed to walkers; see walkable() in src/data/vtiles.js).
//   - a goal is reachable if a public way passes within a few dozen metres of it, and the
//     place itself isn't tagged private (access / foot);
//   - race finishes are snapped onto a public way, never a raw terrain sample;
//   - the same ways define each area's walkable ground, for coverage ("explorer depth").
// When an area has no path data (still loading), nothing is ruled out.

import { offsetGeo, offsetMeters, geohash } from '../geo.js';

/** Nearest point on a set of polylines [x0,z0,x1,z1,...] to (x, z). */
export function nearestOnLines(lines, x, z) {
  let best = { d: Infinity, x: 0, z: 0 };
  for (const L of lines) {
    for (let i = 0; i + 3 < L.length; i += 2) {
      const ax = L[i], az = L[i + 1], bx = L[i + 2], bz = L[i + 3];
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
      const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < best.d) best = { d, x: px, z: pz };
    }
  }
  return best;
}

/**
 * The nearest public walkable way to a point, across the loaded areas that cover it.
 * @returns {{ known: boolean, d: number, lat: number, lon: number }} known = some area had path data
 */
export function nearestPath(world, lat, lon, maxR = 80) {
  let known = false, best = { d: Infinity, lat, lon };
  const pad = maxR / 111320, padLon = pad / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  for (const ch of world.readyChunks?.() || []) {
    const b = ch.bounds;
    if (!ch.walk || lat < b.s - pad || lat > b.n + pad || lon < b.w - padLon || lon > b.e + padLon) continue;
    known = true;
    const o = offsetMeters(ch.latc, ch.lonc, lat, lon);
    const n = nearestOnLines(ch.walk, o.x, o.z);
    if (n.d < best.d) { const g = offsetGeo(ch.latc, ch.lonc, n.x, -n.z); best = { d: n.d, lat: g.lat, lon: g.lon }; }
  }
  return { known, ...best };
}

/** Is a place itself closed to the public (from its OSM tags)? */
export function closedToPublic(poi) {
  const t = poi?.tags;
  return !!t && (/^(private|no)$/.test(t.access || '') || /^(private|no)$/.test(t.foot || ''));
}

/** Can people walk to this place? Unknown (no path data yet) counts as yes. */
export function reachable(world, p, maxR = 60) {
  if (closedToPublic(p)) return false;
  const n = nearestPath(world, p.lat, p.lon, maxR);
  return !n.known || n.d <= maxR;
}

/** Snap a point onto the nearest public way within maxR; null if there is none (or no data). */
export function snapToPath(world, lat, lon, maxR = 60) {
  const n = nearestPath(world, lat, lon, maxR);
  return n.known && n.d <= maxR ? { lat: n.lat, lon: n.lon, d: n.d } : null;
}

/**
 * The walkable ground of an area: the ~150 m cells (geohash 7) its public ways pass through.
 * Cached on the chunk. Only cells inside the area count.
 */
export function walkCells(chunk) {
  if (chunk._walkCells) return chunk._walkCells;
  const cells = new Set();
  if (!chunk.walk) return cells;
  for (const L of chunk.walk) {
    for (let i = 0; i + 3 < L.length; i += 2) {
      const ax = L[i], az = L[i + 1], bx = L[i + 2], bz = L[i + 3];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 25));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, g = offsetGeo(chunk.latc, chunk.lonc, ax + (bx - ax) * t, -(az + (bz - az) * t));
        if (chunk.contains(g.lat, g.lon)) cells.add(geohash(g.lat, g.lon, 7));
      }
    }
  }
  chunk._walkCells = cells;
  return cells;
}
