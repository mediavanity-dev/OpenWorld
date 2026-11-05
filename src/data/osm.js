// OSM detail adapter (Overpass): the things vector tiles don't carry.
//   - individual trees, with leaf type / cycle (for seasonal looks)
//   - extra place tags: opening_hours, wikidata/wikipedia, start_date, heritage
//   - named heritage/landmark objects that aren't in the tile POI layer
//   - on-demand building lookups for beacon anchoring
// Loaded in the background after the base tile; the world is playable without it.

import { cacheGet, cachePut } from './cache.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const DETAIL_VERSION = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function overpass(query, attempts = 5) {
  const body = 'data=' + encodeURIComponent(query);
  let lastErr;
  for (let a = 0; a < attempts; a++) {
    try {
      const res = await fetch(ENDPOINTS[a % ENDPOINTS.length], {
        method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (!res.ok) throw new Error('overpass ' + res.status);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await sleep(2000 * (a + 1));
    }
  }
  throw lastErr;
}

// Overpass is shared: at most 2 requests in flight (its per-client slot limit).
let inflight = 0;
const waiting = [];
export async function slot(fn) {
  if (inflight >= 2) await new Promise((r) => waiting.push(r));
  inflight++;
  try { return await fn(); } finally { inflight--; waiting.shift()?.(); }
}

const TAG_KEYS = ['opening_hours', 'wikidata', 'wikipedia', 'start_date', 'heritage', 'website', 'cuisine', 'description'];
const KIND_KEYS = ['tourism', 'historic', 'amenity', 'leisure', 'shop', 'natural', 'man_made'];

export async function loadDetail(key, b) {
  const cacheKey = `detail:v${DETAIL_VERSION}:${key}`;
  const hit = await cacheGet(cacheKey);
  if (hit) return hit;
  return slot(async () => {
    const raw = await overpass(`[out:json][timeout:60][bbox:${b.s},${b.w},${b.n},${b.e}];
(
  node["natural"="tree"];
  nwr["name"]["opening_hours"];
  nwr["name"]["wikidata"];
  nwr["name"]["wikipedia"];
  nwr["name"]["start_date"];
  nwr["name"]["heritage"];
  nwr["name"]["tourism"="viewpoint"];
  nwr["name"]["man_made"~"^(lighthouse|windmill|tower|obelisk)$"];
);
out tags center qt;`);
    const out = normalizeDetail(raw);
    out.snapshot = raw.osm3s?.timestamp_osm_base || null;
    cachePut(cacheKey, out);
    return out;
  });
}

export function normalizeDetail(raw) {
  const trees = [];
  const places = {}; // ref -> { tags, lat, lon, name, kind }
  for (const el of raw.elements || []) {
    const t = el.tags || {};
    const ref = `osm:${el.type}/${el.id}`;
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat === undefined) continue;
    if (el.type === 'node' && t.natural === 'tree') {
      trees.push({ ref, lat, lon, leaf: t.leaf_type || null, cycle: t.leaf_cycle || null, genus: t.genus || null });
      // notable trees (named, protected or monumental) become discoverable places
      const notable = t.name || /natural_monument|landmark/.test(t.denotation || '') || t.protected === 'yes' || t.heritage;
      if (notable) {
        const species = t['species:en'] || t.species || t['taxon:en'] || t.taxon || t.genus || null;
        const tags = {};
        for (const k of TAG_KEYS) if (t[k]) tags[k] = t[k];
        if (species) tags.species = species;
        if (t.circumference) tags.circumference = t.circumference;
        if (t.height) tags.height = t.height;
        places[ref] = { tags, lat, lon, name: t.name || (species ? `Notable tree (${species})` : 'Notable tree'), kind: 'natural:tree' };
      }
      continue;
    }
    if (!t.name) continue;
    const tags = {};
    for (const k of TAG_KEYS) if (t[k]) tags[k] = t[k];
    let kind = null;
    for (const k of KIND_KEYS) if (t[k] && t[k] !== 'yes') { kind = `${k === 'man_made' ? 'tourism' : k}:${t[k]}`; break; }
    if (!kind && t.historic) kind = 'historic:yes';
    if (!kind && t.heritage) kind = 'historic:heritage';
    if (!kind && t.building) kind = `historic:${t.building}`;
    places[ref] = { tags, lat, lon, name: t.name, kind };
  }
  return { trees, places };
}

// Nearest building to a point (for anchoring beacons). Returns {ref, lat, lon} or null.
export async function nearestBuilding(lat, lon, radius = 35) {
  try {
    const raw = await slot(() => overpass(`[out:json][timeout:20];way["building"](around:${radius},${lat},${lon});out center ids qt;`, 2));
    let best = null;
    for (const el of raw.elements || []) {
      if (!el.center) continue;
      const d = (el.center.lat - lat) ** 2 + ((el.center.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
      if (!best || d < best.d) best = { d, ref: `osm:way/${el.id}`, lat: el.center.lat, lon: el.center.lon };
    }
    return best && { ref: best.ref, lat: best.lat, lon: best.lon };
  } catch { return null; }
}

// Current position of any OSM object by ref; null if it no longer exists. Cached a week.
export async function lookupRef(ref) {
  const m = /^osm:(node|way|relation)\/(\d+)$/.exec(ref);
  if (!m) return null;
  const cacheKey = 'ref:' + ref;
  const hit = await cacheGet(cacheKey);
  if (hit) return hit.gone ? null : hit;
  try {
    const raw = await slot(() => overpass(`[out:json][timeout:20];${m[1]}(${m[2]});out center tags qt;`, 2));
    const el = raw.elements?.[0];
    const v = el ? { lat: el.lat ?? el.center?.lat, lon: el.lon ?? el.center?.lon, name: el.tags?.name || null } : { gone: true };
    cachePut(cacheKey, v);
    return v.gone ? null : v;
  } catch { return undefined; } // undefined = unknown (network), not "gone"
}
