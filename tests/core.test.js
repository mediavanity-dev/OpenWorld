// Run with: npm test   (Node's built-in test runner; no extra dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHours, isOpen, nextOpening } from '../src/data/hours.js';
import { geohash, geohashBounds, haversine, offsetMeters, offsetGeo, chunkIndex, chunkBounds, LocalFrame } from '../src/geo.js';
import { makeAnchor, resolveAnchor } from '../src/game/anchors.js';
import { Journal, TASKS } from '../src/game/journal.js';

const at = (dow, hh, mm) => new Date(Date.UTC(2026, 10, 2 + dow, hh, mm)); // 2026-11-02 is a Monday

test('opening hours: common formats', () => {
  const cases = [
    ['24/7', at(6, 3, 0), true],
    ['Mo-Fr 08:00-18:00; Sa 09:00-13:00', at(0, 9, 0), true],
    ['Mo-Fr 08:00-18:00; Sa 09:00-13:00', at(5, 14, 0), false],
    ['Mo-Su 10:00-02:00', at(2, 1, 30), true],
    ['Mo-Su 10:00-02:00', at(2, 3, 0), false],
    ['Tu,Th 09:00-12:00,13:00-17:00', at(1, 12, 30), false],
    ['Tu,Th 09:00-12:00,13:00-17:00', at(3, 13, 30), true],
    ['Mo-Fr 08:00-18:00, Sa 10:00-14:00', at(5, 11, 0), true],
    ['Mo-Sa 09:00-17:00; Su off; PH off', at(6, 11, 0), false],
  ];
  for (const [s, d, exp] of cases) assert.equal(isOpen(parseHours(s), d), exp, s);
});

test('opening hours: unknown formats are null (never block discovery)', () => {
  assert.equal(parseHours('Jan-Mar Mo-Fr 09:00-17:00'), null);
  assert.equal(parseHours('sunrise-sunset'), null);
  assert.equal(isOpen(null, new Date()), null);
  assert.equal(nextOpening(parseHours('Mo-Fr 08:00-18:00'), at(5, 14, 0)), 'Mo 08:00');
});

test('geo: geohash round trip and distances', () => {
  const h = geohash(51.4779, -0.0015, 7);
  const b = geohashBounds(h);
  assert.ok(b.s <= 51.4779 && 51.4779 <= b.n && b.w <= -0.0015 && -0.0015 <= b.e);
  assert.ok(Math.abs(haversine(51.4779, -0.0015, 51.4879, -0.0015) - 1112) < 5);
  const o = offsetMeters(51.5, 0, 51.501, 0.001);
  const g = offsetGeo(51.5, 0, o.x, -o.z);
  assert.ok(Math.abs(g.lat - 51.501) < 1e-7 && Math.abs(g.lon - 0.001) < 1e-7);
  const f = new LocalFrame(51.5, 0), l = f.toLocal(51.51, 0.02), back = f.toGeo(l.x, l.z);
  assert.ok(Math.abs(back.lat - 51.51) < 1e-9 && Math.abs(back.lon - 0.02) < 1e-9);
});

test('geo: chunk tiles contain their points', () => {
  for (const [lat, lon] of [[51.4779, -0.0015], [-33.85, 151.21], [64.1, -21.9], [0.001, 0.001]]) {
    const { i, j } = chunkIndex(lat, lon), b = chunkBounds(i, j);
    assert.ok(lat <= b.n && lat >= b.s && lon >= b.w && lon <= b.e, `${lat},${lon}`);
  }
});

function mockWorld({ features = {}, gone = new Set(), loaded = true } = {}) {
  return {
    groundAt: () => (loaded ? 10 : null),
    isReadyAt: () => loaded,
    findFeature: (r) => features[r] || null,
    isGone: (r) => gone.has(r),
    requestFeature: () => {},
  };
}

test('anchors: follow, shift, orphan, ground, pending', () => {
  const feat = { lat: 51.5, lon: 0, ground: 10 };
  const w = mockWorld({ features: { 'osm:way/1': feat } });
  const a = makeAnchor(w, { lat: 51.50001, lon: 0.00002, featureRef: 'osm:way/1' });
  assert.equal(a.mode, 'feature');
  assert.equal(resolveAnchor(w, a).status, 'feature');
  const moved = mockWorld({ features: { 'osm:way/1': { ...feat, lat: 51.5 + 40 / 111320 } } });
  assert.equal(resolveAnchor(moved, a).status, 'shifted');
  assert.equal(resolveAnchor(mockWorld({ gone: new Set(['osm:way/1']) }), a).status, 'orphaned');
  assert.equal(resolveAnchor(mockWorld(), { ...a, mode: 'ground', feature_ref: null }).status, 'ground');
  assert.equal(resolveAnchor(mockWorld({ loaded: false }), a).status, 'pending');
});

function mockJournal() {
  const data = { id: 'test', discoveries: {}, species: {}, beacons: [], stats: { meters: { present: 0, home: 0, roam: 0 } }, log: [] };
  const profile = { data, save() {}, log() {} };
  const env = { localNow: () => new Date(Date.UTC(2026, 10, 4, 12)) };
  const events = [];
  return { j: new Journal(profile, env, (e) => events.push(e)), data, events };
}

test('journal: roam never counts as real exploration', () => {
  const { j, data } = mockJournal();
  j.onMove('roam', 500, { lat: 51.5, lon: 0 }, 100);
  assert.equal(Object.values(data.cells)[0], 1);
  assert.equal(data.records.highest, undefined);
  assert.equal(data.days['2026-11-04'], undefined);
  j.onMove('present', 500, { lat: 51.5, lon: 0 }, 100);
  assert.equal(Object.values(data.cells)[0], 3);
  assert.equal(data.records.highest.m, 100);
});

test('journal: daily assignment completes once', () => {
  const { j, data, events } = mockJournal();
  const t = j.task();
  assert.ok(TASKS[t.type]);
  const target = TASKS[t.type].target;
  for (let k = 0; k < target + 2; k++) j.progress(t.type, TASKS[t.type].unit === 'm' ? 600 : 1);
  assert.equal(data.task.done, true);
  assert.equal(data.tasksDone, 1);
  assert.equal(events.filter((e) => e.type === 'task').length, 1);
});

test('journal: rocks upgrade only with better grade', () => {
  const { j } = mockJournal();
  const rock = { key: 'x|y', name: 'Lambeth Group', lith: 'clay', period: 'Paleocene', top: 56, bottom: 66 };
  assert.equal(j.onRock(rock, 'echo'), 'new');
  assert.equal(j.onRock(rock, 'echo'), null);
  assert.equal(j.onRock(rock, 'present'), 'upgraded');
});
