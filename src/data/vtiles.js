// Base fabric adapter: OpenFreeMap vector tiles (OpenMapTiles schema, built from OSM).
// Free, keyless, served from a CDN: fast first paint anywhere on Earth.
// Output is in tile-pixel space (0..extent, y down) for one zoom-14 tile.
//
// Feature ids in these tiles encode the OSM object: id = osmId * 10 + (1 node | 2 way | 3 relation),
// so places keep the same stable refs ("osm:node/123") as the Overpass detail layer.

import { VectorTile, classifyRings } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
let tileUrl = null;

async function template() {
  if (tileUrl) return tileUrl;
  const res = await fetch(TILEJSON);
  if (!res.ok) throw new Error('tilejson ' + res.status);
  tileUrl = (await res.json()).tiles[0];
  return tileUrl;
}

export function osmRef(id) {
  if (!id) return null;
  const t = id % 10, n = Math.floor(id / 10);
  const type = t === 1 ? 'node' : t === 2 ? 'way' : t === 3 ? 'relation' : null;
  return type ? `osm:${type}/${n}` : null;
}

// --- place categories (OpenMapTiles poi class -> game kind used for colours/rules) ---
const KIND = {
  attraction: 'tourism', museum: 'tourism', art_gallery: 'tourism', zoo: 'tourism', aquarium: 'tourism',
  castle: 'historic', monument: 'historic', memorial: 'historic', archaeological_site: 'historic', ruins: 'historic',
  cafe: 'amenity', restaurant: 'amenity', fast_food: 'amenity', bar: 'amenity', beer: 'amenity', ice_cream: 'amenity',
  library: 'amenity', college: 'amenity', school: 'amenity', theatre: 'amenity', cinema: 'amenity', town_hall: 'amenity',
  post: 'amenity', place_of_worship: 'amenity', lodging: 'amenity', music: 'amenity', hospital: 'amenity',
  shop: 'shop', grocery: 'shop', clothing_store: 'shop', alcohol_shop: 'shop', bakery: 'shop', books: 'shop',
  park: 'leisure', garden: 'leisure', playground: 'leisure', stadium: 'leisure', swimming: 'leisure', golf: 'leisure', dog_park: 'leisure', pitch: 'leisure',
  railway: 'transport', ferry_terminal: 'transport',
};
const SKIP_SUB = new Set(['platform', 'halt', 'subway_entrance', 'tram_stop', 'bus_stop', 'clinic', 'doctors', 'dentist', 'pharmacy']);

const ROAD_W = { motorway: 14, trunk: 12, primary: 11, secondary: 10, tertiary: 8, minor: 6, service: 4, track: 3, path: 1.8, raceway: 6, busway: 6 };

function areaClass(layer, p) {
  if (layer === 'water') return 'water';
  if (layer === 'park') return p.class === 'park' || p.class === 'nature_reserve' ? 'park' : null;
  if (layer === 'landcover') {
    switch (p.class) {
      case 'wood': return 'wood';
      case 'grass': return p.subclass === 'scrub' || p.subclass === 'heath' ? 'scrub' : p.subclass === 'park' || p.subclass === 'garden' ? 'park' : 'grass';
      case 'farmland': return 'farmland';
      case 'sand': return 'sand';
      case 'rock': return 'rock';
      case 'ice': return 'ice';
      case 'wetland': return 'wetland';
      default: return null;
    }
  }
  if (layer === 'landuse') {
    switch (p.class) {
      case 'residential': case 'suburb': case 'neighbourhood': return 'residential';
      case 'commercial': case 'retail': return 'commercial';
      case 'industrial': case 'railway': case 'garages': return 'industrial';
      case 'cemetery': return 'cemetery';
      case 'pitch': case 'stadium': case 'playground': return 'pitch';
      case 'school': case 'university': case 'college': case 'hospital': return 'campus';
      default: return null;
    }
  }
  return null;
}

const pts = (ring) => ring.map((p) => [p.x, p.y]);

// Sutherland–Hodgman clip of a ring to [0,E]² so neighbouring tiles join exactly.
function clipRing(ring, E) {
  let out = ring;
  const edges = [
    (p) => p[0] >= 0, (a, b) => { const t = (0 - a[0]) / (b[0] - a[0]); return [0, a[1] + t * (b[1] - a[1])]; },
    (p) => p[0] <= E, (a, b) => { const t = (E - a[0]) / (b[0] - a[0]); return [E, a[1] + t * (b[1] - a[1])]; },
    (p) => p[1] >= 0, (a, b) => { const t = (0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), 0]; },
    (p) => p[1] <= E, (a, b) => { const t = (E - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), E]; },
  ];
  for (let k = 0; k < 8; k += 2) {
    const inside = edges[k], cut = edges[k + 1];
    const src = out; out = [];
    if (!src.length) break;
    for (let i = 0; i < src.length; i++) {
      const a = src[(i + src.length - 1) % src.length], b = src[i];
      const ain = inside(a), bin = inside(b);
      if (bin) { if (!ain) out.push(cut(a, b)); out.push(b); }
      else if (ain) out.push(cut(a, b));
    }
  }
  return out;
}

function stripClose(r) {
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) return r.slice(0, -1);
  return r;
}

export async function loadBaseTile(z, x, y) {
  const url = (await template()).replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const res = await fetch(url);
  if (res.status === 204 || res.status === 404) return emptyFabric();
  if (!res.ok) throw new Error('tile ' + res.status);
  const vt = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
  return normalizeTile(vt);
}

function emptyFabric() { return { extent: 4096, buildings: [], areas: [], lines: [], pois: [] }; }

export function normalizeTile(vt) {
  const out = emptyFabric();
  const E = (vt.layers.building || vt.layers.water || vt.layers.landcover)?.extent || 4096;
  out.extent = E;

  for (const name of ['landuse', 'park', 'landcover', 'water']) {
    const layer = vt.layers[name];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 3) continue;
      const cls = areaClass(name, f.properties);
      if (!cls) continue;
      for (const poly of classifyRings(f.loadGeometry())) out.areas.push({ cls, rings: poly.map(pts) });
    }
  }

  const bl = vt.layers.building;
  if (bl) {
    for (let i = 0; i < bl.length; i++) {
      const f = bl.feature(i);
      if (f.type !== 3) continue;
      const p = f.properties;
      const height = Math.min(600, Math.max(3, +p.render_height || 8));
      const minHeight = Math.max(0, +p.render_min_height || 0);
      for (const poly of classifyRings(f.loadGeometry())) {
        const rings = poly.map((r) => stripClose(clipRing(stripClose(pts(r)), E))).filter((r) => r.length >= 3);
        if (rings.length) out.buildings.push({ rings, height, minHeight, colour: p.colour || null });
      }
    }
  }

  const tl = vt.layers.transportation;
  if (tl) {
    for (let i = 0; i < tl.length; i++) {
      const f = tl.feature(i);
      const p = f.properties;
      if (f.type !== 2 || p.brunnel === 'tunnel') continue;
      const isRail = p.class === 'rail' || p.class === 'transit';
      const width = isRail ? 4 : ROAD_W[p.class];
      if (!width) continue;
      const cls = isRail ? 'rail' : p.class === 'path' || p.class === 'track' ? 'path' : 'road';
      for (const line of f.loadGeometry()) out.lines.push({ cls, width, pts: pts(line) });
    }
  }
  const wl = vt.layers.waterway;
  if (wl) {
    for (let i = 0; i < wl.length; i++) {
      const f = wl.feature(i);
      if (f.type !== 2 || f.properties.brunnel === 'tunnel') continue;
      const w = f.properties.class === 'river' ? 14 : f.properties.class === 'canal' ? 9 : 3;
      for (const line of f.loadGeometry()) out.lines.push({ cls: 'river', width: w, pts: pts(line) });
    }
  }

  const pl = vt.layers.poi;
  if (pl) {
    for (let i = 0; i < pl.length; i++) {
      const f = pl.feature(i);
      const p = f.properties;
      const kind = KIND[p.class];
      if (!kind || !p.name || SKIP_SUB.has(p.subclass)) continue;
      if (p.class === 'railway' && p.subclass !== 'station') continue;
      const g = f.loadGeometry()[0]?.[0];
      if (!g || g.x < 0 || g.y < 0 || g.x >= E || g.y >= E) continue;
      const ref = osmRef(f.id);
      if (!ref) continue;
      out.pois.push({ ref, px: g.x, py: g.y, name: p.name, kind: `${kind}:${p.subclass || p.class}`, rank: p.rank || 99 });
    }
  }
  const mp = vt.layers.mountain_peak;
  if (mp) {
    for (let i = 0; i < mp.length; i++) {
      const f = mp.feature(i);
      const p = f.properties;
      const g = f.loadGeometry()[0]?.[0];
      const ref = osmRef(f.id);
      if (!g || !p.name || !ref || g.x < 0 || g.y < 0 || g.x >= E || g.y >= E) continue;
      out.pois.push({ ref, px: g.x, py: g.y, name: p.ele ? `${p.name} (${p.ele} m)` : p.name, kind: `natural:${p.class || 'peak'}`, rank: p.rank || 99 });
    }
  }
  return out;
}
