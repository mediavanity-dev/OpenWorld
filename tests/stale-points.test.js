import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropStalePoints } from '../src/data/vtiles.js';

// Burlington, VT: the GNIS point "Saint Jean Baptist Church" sits ~30 m from the building "Saint John's Club"
const z = 14, lat = 44.4607, lon = -73.2209, E = 4096;
const n = 2 ** z, xt = ((lon + 180) / 360) * n, yt = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n;
const y = Math.floor(yt);
const at = (la, lo) => ({ px: (((lo + 180) / 360) * n - Math.floor(xt)) * E, py: ((1 - Math.asinh(Math.tan(la * Math.PI / 180)) / Math.PI) / 2 * n - y) * E });

test('a lone imported church point beside a differently named building is dropped', () => {
  const out = { extent: E, pois: [
    { ref: 'osm:node/356556291', name: 'Saint Jean Baptist Church', cls: 'place_of_worship', ...at(44.4606050, -73.2206829) },
    { ref: 'osm:way/201657533', name: "Saint John's Club", cls: 'bar', ...at(44.4607042, -73.2210499) },
  ] };
  dropStalePoints(out, z, y);
  assert.deepEqual(out.pois.map((p) => p.name), ["Saint John's Club"]);
});

test('a church point far from other places, or matching its building, stays', () => {
  const out = { extent: E, pois: [
    { ref: 'osm:node/1', name: 'St Mary', cls: 'place_of_worship', ...at(44.4606, -73.2206) },
    { ref: 'osm:way/2', name: 'Corner Cafe', cls: 'cafe', ...at(44.4630, -73.2206) }, // ~260 m away
    { ref: 'osm:node/3', name: 'Old School', cls: 'school', ...at(44.4650, -73.2150) },
    { ref: 'osm:way/4', name: 'Old School', cls: 'school', ...at(44.46502, -73.21502) },
  ] };
  dropStalePoints(out, z, y);
  assert.equal(out.pois.length, 4);
});
