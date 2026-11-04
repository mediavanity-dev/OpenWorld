// Anchors: how character task data is pinned to the world.
//
// An anchor never stores render coordinates. It stores:
//   - the true WGS84 position at the time (always valid, survives any dataset swap)
//   - which height reference that position used
//   - optionally a semantic link to a reference-fabric feature (a place, or a building)
//     with a metric offset from it
//   - which fabric snapshot it was made against, and a tolerance
//
// At load time the anchor is *resolved* against whatever fabric is current:
//   feature still exists          -> follow the feature   (status 'feature' / 'shifted')
//   feature deleted from the map  -> fall back to ground   (status 'orphaned')
//   plain ground anchor           -> snap to current terrain (status 'ground')
//   area/feature not known yet    -> (status 'pending')
// Features not present in the loaded tiles (e.g. individual buildings) are looked up
// on demand from OSM by id; the world emits 'remote' when the answer arrives.

import { haversine, offsetMeters, offsetGeo, geohash } from '../geo.js';

export const TERRAIN_SOURCE = 'aws-terrarium-z13';

export function makeAnchor(world, { lat, lon, up = 0, featureRef = null, feature = null, snapshot = null, tolerance = 25 }) {
  const ground = world.groundAt(lat, lon) ?? 0;
  const a = {
    v: 1,
    wgs84: [round(lat, 7), round(lon, 7), round(ground + up, 1)],
    height_ref: 'terrain-surface',
    cell: geohash(lat, lon, 7),
    mode: 'ground',
    feature_ref: null,
    offset: [0, 0, up],            // east, north, up (metres)
    tolerance_m: tolerance,
    fabric: { osm: snapshot, base: 'openfreemap', terrain: TERRAIN_SOURCE },
    created: new Date().toISOString(),
  };
  const f = feature || (featureRef ? world.findFeature(featureRef) : null);
  if (f && featureRef) {
    const o = offsetMeters(f.lat, f.lon, lat, lon);
    a.mode = 'feature';
    a.feature_ref = featureRef;
    a.offset = [round(o.x, 2), round(-o.z, 2), round(up, 2)];
  }
  return a;
}

export function resolveAnchor(world, a) {
  const [lat0, lon0] = a.wgs84;
  if (a.mode === 'feature' && a.feature_ref) {
    const f = world.findFeature(a.feature_ref);
    if (f) {
      const p = offsetGeo(f.lat, f.lon, a.offset[0], a.offset[1]);
      const g = world.groundAt(p.lat, p.lon);
      if (g === null) return { status: 'pending' };
      const drift = haversine(lat0, lon0, p.lat, p.lon);
      return { lat: p.lat, lon: p.lon, y: g + a.offset[2], status: drift > a.tolerance_m ? 'shifted' : 'feature', drift };
    }
    if (!world.isReadyAt(lat0, lon0)) return { status: 'pending' };
    if (world.isGone(a.feature_ref)) {
      return { lat: lat0, lon: lon0, y: world.groundAt(lat0, lon0) ?? a.wgs84[2], status: 'orphaned', drift: 0 };
    }
    world.requestFeature(a.feature_ref); // not in the tiles: ask OSM
    return { status: 'pending', lat: lat0, lon: lon0, y: world.groundAt(lat0, lon0) ?? a.wgs84[2] };
  }
  const g = world.groundAt(lat0, lon0);
  if (g === null) return { status: 'pending' };
  return { lat: lat0, lon: lon0, y: g + (a.offset?.[2] || 0), status: 'ground', drift: 0 };
}

function round(v, d) { const k = 10 ** d; return Math.round(v * k) / k; }
