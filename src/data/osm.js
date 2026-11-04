// OSM adapter: turns raw OpenStreetMap (via Overpass) into the game's neutral
// "reference fabric" for one chunk. Everything downstream (rendering, anchors,
// tasks) consumes only this normalized shape, so another source (Overture, a
// newer OSM snapshot, a different provider) can be swapped in behind it.
//
// Fabric shape:
//   buildings: [{ ref, rings: [[ [lat,lon], ... ] (outer), ...holes], height, kind, name }]
//   areas:     [{ ref, cls, rings }]               cls: water|wood|grass|sand|scrub|farmland|...
//   lines:     [{ ref, cls, width, pts }]          cls: road|path|rail|river
//   trees:     [{ ref, lat, lon }]
//   pois:      [{ ref, lat, lon, name, kind }]
// `ref` is a stable cross-snapshot identity: "osm:way/123" etc.

import { cacheGet, cachePut } from './cache.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

function query(b) {
  return `[out:json][timeout:90][bbox:${b.s},${b.w},${b.n},${b.e}];
(
  wr["building"];
  way["highway"];
  way["railway"~"^(rail|light_rail|tram|subway|narrow_gauge)$"];
  wr["natural"~"^(water|wood|scrub|grassland|heath|beach|sand|wetland|bare_rock|glacier)$"];
  wr["landuse"~"^(forest|grass|meadow|recreation_ground|village_green|reservoir|basin|farmland|orchard|vineyard|cemetery|allotments)$"];
  wr["leisure"~"^(park|garden|pitch|golf_course|playground|nature_reserve|common)$"];
  wr["waterway"="riverbank"];
  way["waterway"~"^(river|stream|canal)$"];
  wr["amenity"="parking"];
  node["natural"="tree"];
  nwr["name"]["amenity"];
  nwr["name"]["tourism"];
  nwr["historic"];
  nwr["name"]["shop"];
  nwr["name"]["leisure"];
  node["name"]["natural"="peak"];
);
out geom qt;`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOverpass(b) {
  const body = 'data=' + encodeURIComponent(query(b));
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const ep = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(ep, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (res.status === 429 || res.status === 504 || res.status >= 500) throw new Error('overpass ' + res.status);
      if (!res.ok) throw new Error('overpass ' + res.status);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

// Bump when normalize() changes so cached fabric is rebuilt.
const FABRIC_VERSION = 2;

// Overpass is a shared public service: at most 2 requests in flight (its per-client slot limit).
const MAX_INFLIGHT = 2;
let inflight = 0;
const waiting = [];
async function slot(fn) {
  if (inflight >= MAX_INFLIGHT) await new Promise((r) => waiting.push(r));
  inflight++;
  try { return await fn(); } finally { inflight--; waiting.shift()?.(); }
}

export async function loadFabric(key, bounds) {
  const cacheKey = `osm:v${FABRIC_VERSION}:${key}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;
  return slot(async () => {
    const raw = await fetchOverpass(bounds);
    const fabric = normalize(raw);
    fabric.snapshot = raw.osm3s?.timestamp_osm_base || null;
    cachePut(cacheKey, fabric);
    return fabric;
  });
}

// ---------------------------------------------------------------------------

const ROAD_WIDTH = {
  motorway: 14, trunk: 12, primary: 11, secondary: 10, tertiary: 8,
  unclassified: 6, residential: 6, living_street: 5, service: 4, pedestrian: 5,
  motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 6, tertiary_link: 6,
  track: 3, footway: 2, path: 1.6, cycleway: 2, steps: 2, bridleway: 2,
};

function areaClass(t) {
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin') return 'water';
  if (t.natural === 'wetland') return 'wetland';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'wood';
  if (t.natural === 'scrub' || t.natural === 'heath') return 'scrub';
  if (t.natural === 'beach' || t.natural === 'sand') return 'sand';
  if (t.natural === 'bare_rock') return 'rock';
  if (t.natural === 'glacier') return 'ice';
  if (t.landuse === 'farmland' || t.landuse === 'orchard' || t.landuse === 'vineyard' || t.landuse === 'allotments') return 'farmland';
  if (t.landuse === 'cemetery') return 'cemetery';
  if (t.amenity === 'parking') return 'parking';
  if (t.leisure === 'pitch') return 'pitch';
  if (t.leisure || t.landuse || t.natural) return 'grass';
  return null;
}

const POI_KEYS = ['tourism', 'historic', 'amenity', 'leisure', 'shop', 'natural'];
function poiKind(t) {
  for (const k of POI_KEYS) if (t[k]) return { key: k, value: t[k] };
  return null;
}

function buildingHeight(t) {
  const h = parseFloat(t.height);
  if (isFinite(h) && h > 0) return Math.min(h, 600);
  const lv = parseFloat(t['building:levels']);
  if (isFinite(lv) && lv > 0) return lv * 3.2 + 1;
  switch (t.building) {
    case 'garage': case 'garages': case 'shed': case 'hut': case 'carport': case 'roof': return 3;
    case 'house': case 'detached': case 'semidetached_house': case 'terrace': case 'bungalow': return 7;
    case 'church': case 'cathedral': case 'mosque': case 'temple': return 18;
    case 'apartments': case 'commercial': case 'office': case 'hotel': case 'hospital': return 15;
    case 'industrial': case 'warehouse': case 'retail': case 'supermarket': return 9;
    default: return 8;
  }
}

const toPts = (geom) => geom.filter(Boolean).map((p) => [p.lat, p.lon]);

function isClosed(pts) {
  if (pts.length < 4) return false;
  const a = pts[0], b = pts[pts.length - 1];
  return a[0] === b[0] && a[1] === b[1];
}

// Stitch multipolygon member ways into closed rings.
function joinRings(parts) {
  const rings = [];
  const open = [];
  for (const p of parts) (isClosed(p) ? rings : open).push(p.slice());
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (open.length) {
    let cur = open.shift();
    let grew = true;
    while (!isClosed(cur) && grew) {
      grew = false;
      for (let k = 0; k < open.length; k++) {
        const o = open[k];
        const end = cur[cur.length - 1];
        if (same(end, o[0])) cur = cur.concat(o.slice(1));
        else if (same(end, o[o.length - 1])) cur = cur.concat(o.slice(0, -1).reverse());
        else continue;
        open.splice(k, 1);
        grew = true;
        break;
      }
    }
    if (isClosed(cur)) rings.push(cur);
  }
  return rings;
}

function pretty(v) {
  const s = String(v).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function centroid(ring) {
  let la = 0, lo = 0;
  const n = ring.length - (isClosed(ring) ? 1 : 0);
  for (let k = 0; k < n; k++) { la += ring[k][0]; lo += ring[k][1]; }
  return [la / n, lo / n];
}

export function normalize(raw) {
  const out = { buildings: [], areas: [], lines: [], trees: [], pois: [] };
  for (const el of raw.elements || []) {
    const t = el.tags || {};
    const ref = `osm:${el.type}/${el.id}`;

    // polygons: closed ways or multipolygon relations
    let polys = null; // array of polygons, each [outer, ...holes]
    if (el.type === 'way' && el.geometry) {
      const pts = toPts(el.geometry);
      if (isClosed(pts)) polys = [[pts]];
      else if (t.highway || t.railway || t.waterway) {
        const cls = t.highway ? (ROAD_WIDTH[t.highway] && ROAD_WIDTH[t.highway] <= 3 ? 'path' : 'road')
          : t.railway ? 'rail' : 'river';
        const width = t.highway ? (ROAD_WIDTH[t.highway] || 4)
          : t.railway ? 4 : (t.waterway === 'river' ? 18 : t.waterway === 'canal' ? 10 : 3);
        if (t.highway !== 'proposed' && t.highway !== 'construction') out.lines.push({ ref, cls, width, pts });
      }
    } else if (el.type === 'relation' && el.members && (t.type === 'multipolygon' || t.type === 'building')) {
      const outer = joinRings(el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => toPts(m.geometry)));
      const inner = joinRings(el.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => toPts(m.geometry)));
      // assign all holes to every outer (cheap; holes outside an outer are harmless for our raster/extrude)
      polys = outer.map((o) => [o, ...(outer.length === 1 ? inner : [])]);
    }

    if (polys) {
      if (t.building && t.building !== 'no') {
        const height = buildingHeight(t);
        for (const rings of polys) out.buildings.push({ ref, rings, height, kind: t.building, name: t.name || null });
      } else if (t.highway === 'pedestrian' || t['area:highway']) {
        for (const rings of polys) out.areas.push({ ref, cls: 'plaza', rings });
      } else {
        const cls = areaClass(t);
        if (cls) for (const rings of polys) out.areas.push({ ref, cls, rings });
      }
    }

    // trees
    if (el.type === 'node' && t.natural === 'tree') out.trees.push({ ref, lat: el.lat, lon: el.lon });

    // points of interest (named things people would recognize)
    const kind = poiKind(t);
    const label = t.name || (t.historic && t.historic !== 'yes' ? pretty(t.historic) : null);
    if (kind && label && !(kind.key === 'natural' && t.natural !== 'peak')) {
      let lat, lon;
      if (el.type === 'node') { lat = el.lat; lon = el.lon; }
      else if (polys && polys[0]) [lat, lon] = centroid(polys[0][0]);
      else if (el.geometry) [lat, lon] = centroid(toPts(el.geometry));
      if (lat !== undefined && !Number.isNaN(lat)) {
        out.pois.push({ ref, lat, lon, name: label, kind: `${kind.key}:${kind.value}` });
      }
    }
  }
  return out;
}
