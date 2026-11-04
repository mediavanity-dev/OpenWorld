// Anchors: how character task data is pinned to the world.
//
// An anchor never stores render coordinates. It stores:
//   - the true WGS84 position at the time (always valid, survives any dataset swap)
//   - which height reference that position used
//   - optionally a semantic link to a reference-fabric feature (e.g. a building)
//     with a metric offset from it
//   - which fabric snapshot it was made against, and a tolerance
//
// At load time the anchor is *resolved* against whatever fabric is current:
//   feature still exists          -> follow the feature   (status 'feature' / 'shifted')
//   feature gone, area loaded     -> fall back to ground   (status 'orphaned')
//   plain ground anchor           -> snap to current terrain (status 'ground')
//   area not loaded yet           -> (status 'pending')

import { haversine, offsetMeters, offsetGeo, geohash } from '../geo.js';

export const TERRAIN_SOURCE = 'aws-terrarium-z13';

export function makeAnchor(world, { lat, lon, up = 0, featureRef = null, snapshot = null, tolerance = 25 }) {
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
    fabric: { osm: snapshot, terrain: TERRAIN_SOURCE },
    created: new Date().toISOString(),
  };
  const f = featureRef ? world.findFeature(featureRef) : null;
  if (f) {
    const o = offsetMeters(f.lat, f.lon, lat, lon);
    a.mode = 'feature';
    a.feature_ref = featureRef;
    a.offset = [round(o.x, 2), round(-o.z, 2), round(ground + up - (f.ground ?? ground), 2)];
  }
  return a;
}

export function resolveAnchor(world, a) {
  const [lat0, lon0] = a.wgs84;
  if (a.mode === 'feature' && a.feature_ref) {
    const f = world.findFeature(a.feature_ref);
    if (f) {
      const p = offsetGeo(f.lat, f.lon, a.offset[0], a.offset[1]);
      const g = world.groundAt(p.lat, p.lon) ?? f.ground ?? 0;
      const drift = haversine(lat0, lon0, p.lat, p.lon);
      return { lat: p.lat, lon: p.lon, y: g + a.offset[2], status: drift > a.tolerance_m ? 'shifted' : 'feature', drift };
    }
    if (!world.isReadyAt(lat0, lon0)) return { status: 'pending' };
    const g = world.groundAt(lat0, lon0) ?? a.wgs84[2];
    return { lat: lat0, lon: lon0, y: g, status: 'orphaned', drift: 0 };
  }
  const g = world.groundAt(lat0, lon0);
  if (g === null) return { status: 'pending' };
  return { lat: lat0, lon: lon0, y: g + (a.offset?.[2] || 0), status: 'ground', drift: 0 };
}

function round(v, d) { const k = 10 ** d; return Math.round(v * k) / k; }
