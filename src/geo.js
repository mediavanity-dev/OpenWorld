// Geography helpers. WGS84 lat/lon is the source of truth; the renderer works in
// a local metric frame (x = east, y = up, z = south) around a floating origin
// that is re-based as the character moves, so float32 precision never degrades.

export const EARTH_R = 6378137;
const D2R = Math.PI / 180;
const M_PER_DEG = EARTH_R * D2R;

export class LocalFrame {
  constructor(lat = 0, lon = 0) { this.set(lat, lon); }
  set(lat, lon) {
    this.lat0 = lat;
    this.lon0 = lon;
    this.cos0 = Math.cos(lat * D2R);
  }
  toLocal(lat, lon) {
    return { x: (lon - this.lon0) * M_PER_DEG * this.cos0, z: -(lat - this.lat0) * M_PER_DEG };
  }
  toGeo(x, z) {
    return { lat: this.lat0 - z / M_PER_DEG, lon: this.lon0 + x / (M_PER_DEG * this.cos0) };
  }
}

// Metric offset of (lat, lon) from a reference point, in that point's tangent plane.
export function offsetMeters(refLat, refLon, lat, lon) {
  return {
    x: (lon - refLon) * M_PER_DEG * Math.cos(refLat * D2R),
    z: -(lat - refLat) * M_PER_DEG,
  };
}

export function offsetGeo(refLat, refLon, east, north) {
  return {
    lat: refLat + north / M_PER_DEG,
    lon: refLon + east / (M_PER_DEG * Math.cos(refLat * D2R)),
  };
}

export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ---- Web-mercator tile math ----
export function lonToTileX(lon, z) { return ((lon + 180) / 360) * 2 ** z; }
export function latToTileY(lat, z) {
  const r = lat * D2R;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}
export function tileXToLon(x, z) { return (x / 2 ** z) * 360 - 180; }
export function tileYToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

// ---- Chunk grid = web-mercator tiles at zoom 14 (~2.4 km at the equator, ~1.5 km at 51°) ----
// Matches the vector tiles 1:1, and tile ids are stable forever.
export const CHUNK_Z = 14;
export function chunkIndex(lat, lon) {
  return { i: Math.floor(lonToTileX(lon, CHUNK_Z)), j: Math.floor(latToTileY(lat, CHUNK_Z)) };
}
export function chunkKey(i, j) { return `${CHUNK_Z}/${i}/${j}`; }
export function chunkBounds(i, j) {
  return {
    w: tileXToLon(i, CHUNK_Z), e: tileXToLon(i + 1, CHUNK_Z),
    n: tileYToLat(j, CHUNK_Z), s: tileYToLat(j + 1, CHUNK_Z),
  };
}

// ---- Tiny geohash (used to index the profile's task log by place) ----
const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
export function geohash(lat, lon, precision = 8) {
  let latR = [-90, 90], lonR = [-180, 180], hash = '', bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    const r = even ? lonR : latR;
    const v = even ? lon : lat;
    const mid = (r[0] + r[1]) / 2;
    if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch <<= 1; r[1] = mid; }
    even = !even;
    if (++bit === 5) { hash += B32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

// Deterministic PRNG so procedural scatter (trees in woods) is identical on every visit.
export function rng(seed) {
  let s = (typeof seed === 'string' ? hashStr(seed) : seed) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
export function hashStr(str) {
  let h = 2166136261;
  for (let k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
