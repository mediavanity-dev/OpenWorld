// @ts-check
// Where the water goes (USA only): the lakes and rivers downstream of a point, in order, from
// USGS's Network-Linked Data Index (public domain, live, no key). The names come from the river
// gauges along the way ("ROCK RIVER AT DIXON, IL" → "Rock River"), ordered by the flow path.
// Elsewhere there is no live service; the game simply says which stream meets which river.

import { cachedJson } from './cache.js';

const NLDI = 'https://api.water.usgs.gov/nldi/linked-data/comid';

/** Roughly the contiguous USA (where NHDPlus, which NLDI is built on, has coverage). */
export function inUS(lat, lon) { return lat > 24.4 && lat < 49.5 && lon > -125 && lon < -66.8; }

/** "MISS. R. @ MI 96.2 (ORANGE ST. WHARF) @ N.O." and friends → a water body's name, or null. */
export function waterBodyName(raw) {
  let s = String(raw || '').toUpperCase();
  s = s.split(/\s(?:AT|NEAR|NR|@|ABV|ABOVE|BLW|BELOW|BL|AB|OUTLET|INLET|DAM|-QW|BRIDGE|MILE|MI)\b|[,(@-]/)[0].trim();
  s = s.replace(/\bR\.?$/, 'RIVER').replace(/\bCR\.?$/, 'CREEK').replace(/\bL\.?\s/, 'LAKE ').replace(/\bMISS\.?\s/, 'MISSISSIPPI ');
  // a lake ("LAKE X") or a named river, creek…; nothing else ("… POOL LOCK AND DAM")
  if (!/^LAKE \S|\s(RIVER|CREEK|BROOK|RUN|FORK|BAYOU|RESERVOIR|BAY|SLOUGH|CANAL)$/.test(s) || /\./.test(s) || s.split(' ').length > 5) return null;
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, 'of').replace(/\bThe\b/g, 'the');
}

/**
 * The named waters downstream of a point, nearest first (e.g. ["Lake Monona", "Yahara River",
 * "Rock River", "Mississippi River"]), or null if unknown.
 */
export async function downstream(lat, lon) {
  if (!inUS(lat, lon)) return null;
  const pos = await cachedJson(`nldi-pos:${lat.toFixed(4)},${lon.toFixed(4)}`, `${NLDI}/position?coords=POINT(${lon.toFixed(5)}%20${lat.toFixed(5)})`, { ttl: 90 * 864e5, timeout: 15000 });
  const comid = pos?.features?.[0]?.properties?.identifier;
  if (!comid) return null;
  const [sites, flow] = await Promise.all([
    cachedJson(`nldi-sites:${comid}`, `${NLDI}/${comid}/navigation/DM/nwissite?distance=4000`, { ttl: 90 * 864e5, timeout: 25000 }),
    cachedJson(`nldi-flow:${comid}`, `${NLDI}/${comid}/navigation/DM/flowlines?distance=4000`, { ttl: 90 * 864e5, timeout: 25000 }),
  ]);
  if (!sites?.features?.length || !flow?.features?.length) return null;
  return orderWaters(sites.features, flow.features);
}

/** Exported for tests: gauge features + flowline features (downstream order) → names in order. */
export function orderWaters(siteFeatures, flowFeatures) {
  const order = new Map(flowFeatures.map((f, i) => [String(f.properties?.nhdplus_comid), i]));
  const ranked = siteFeatures
    .map((f) => ({ i: order.get(String(f.properties?.comid)), name: waterBodyName(f.properties?.name) }))
    .filter((x) => x.i != null && x.name)
    .sort((a, b) => a.i - b.i);
  const out = [];
  for (const { name } of ranked) if (!out.includes(name)) out.push(name);
  return out.length ? out.slice(0, 8) : null;
}
