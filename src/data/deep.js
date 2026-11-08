// @ts-check
// The deep layer (beta, BACKLOG item 11): once you know an area well (Surveyed: half its
// streets walked), the small real things most people walk past appear there. Survey marks,
// plaques and memorial benches (with their inscriptions), boundary stones, milestones,
// wayside crosses and shrines, historic wells, and old post boxes named by their royal
// cipher. All from OpenStreetMap: one Overpass query per area, cached for 30 days.

import { overpass, slot } from './osm.js';
import { cacheGet, cachePut } from './cache.js';

const TTL = 30 * 864e5;
const VERSION = 1;

// what each kind is called when it has no name of its own
const LABEL = {
  survey_point: 'Survey mark', plaque: 'Plaque', blue_plaque: 'Blue plaque', bench: 'Memorial bench', stone: 'Memorial stone',
  stele: 'Memorial stele', boundary_stone: 'Boundary stone', milestone: 'Milestone', wayside_cross: 'Wayside cross',
  wayside_shrine: 'Wayside shrine', well: 'Historic well', water_well: 'Historic well', marker: 'Historic marker',
};
// royal ciphers on British post boxes, and the reign they date the box to
export const CIPHERS = { VR: 'Victorian', EVIIR: 'Edwardian (Edward VII)', GR: 'George V', EVIIIR: 'Edward VIII', GVIR: 'George VI', EIIR: 'Elizabeth II', CIIIR: 'Charles III' };

export function deepQuery(b) {
  const bb = `${b.s},${b.w},${b.n},${b.e}`;
  return `[out:json][timeout:25];(
node["man_made"="survey_point"](${bb});
nwr["memorial"~"^(plaque|blue_plaque|bench|stone|stele)$"](${bb});
nwr["historic"~"^(boundary_stone|milestone|wayside_cross|wayside_shrine|well|marker)$"](${bb});
node["man_made"="water_well"]["historic"](${bb});
node["amenity"="post_box"]["royal_cypher"](${bb});
);out center tags 300;`;
}

const KEEP = ['inscription', 'start_date', 'wikidata', 'wikipedia', 'heritage', 'royal_cypher', 'survey_point:structure', 'access', 'foot', 'description'];

/** Overpass elements to places for the map (pure). Kinds go under historic:* so they group as history. */
export function normalizeDeep(raw) {
  const out = [];
  for (const el of raw?.elements || []) {
    const t = el.tags || {}, lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null || /^(private|no)$/.test(t.access || '')) continue;
    let value, name = t.name || null;
    if (t.amenity === 'post_box') {
      const c = String(t.royal_cypher || '').toUpperCase().replace(/[^A-Z]/g, '');
      if (!CIPHERS[c]) continue;
      value = 'post_box';
      name ||= `${CIPHERS[c].split(' (')[0]} post box (${c})`;
    } else if (t.man_made === 'survey_point') value = 'survey_point';
    else if (t.memorial) value = t.memorial;
    else if (t.historic) value = t.historic;
    else if (t.man_made === 'water_well') value = 'water_well';
    if (!value) continue;
    name ||= LABEL[value] || 'Small find';
    const tags = {};
    for (const k of KEEP) if (t[k]) tags[k] = String(t[k]).slice(0, 300);
    out.push({ ref: `osm:${el.type}/${el.id}`, lat, lon, name, kind: `historic:${value}`, cls: null, rank: 45, tags, deep: true });
  }
  return out;
}

/** The deep layer's places in a map area (cached). */
export async function deepPlaces(bounds, key) {
  const ck = `deep${VERSION}:${key}`;
  const hit = await cacheGet(ck, TTL);
  if (hit) return hit;
  const list = normalizeDeep(await slot(() => overpass(deepQuery(bounds), 3)));
  cachePut(ck, list);
  return list;
}
