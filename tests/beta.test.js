import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startHunt, stepHunt } from '../src/game/hunt.js';
import { treasuresFor, bandOf, PER_AREA } from '../src/game/treasure.js';
import { offsetGeo, haversine, rng } from '../src/geo.js';

const HOME = { lat: 51.48, lon: 0 };
const sp = { id: 1, name: 'Robin', group: 'Aves', count: 120, rarity: 'common' };

function walk(from, to, metres) {
  const d = haversine(from.lat, from.lon, to.lat, to.lon), k = Math.min(1, metres / d);
  return { lat: from.lat + (to.lat - from.lat) * k, lon: from.lon + (to.lon - from.lon) * k };
}

test('hunt: signal rises, tracks appear, then it reveals up close', () => {
  const r = rng(7), h = startHunt(HOME, sp, 0, r);
  assert.ok(h.d > 50 && h.d < 115);
  let pos = { ...HOME }, events = [], t = Date.now();
  for (let k = 0; k < 60 && !h.revealed; k++) { pos = walk(pos, h, 3); t += 2000; const ev = stepHunt(h, pos, 1.4, t, r); if (ev) events.push(ev); }
  assert.ok(events.includes('signal-up'));
  assert.ok(events.includes('tracks'));
  assert.ok(events.includes('reveal'));
  assert.equal(h.tracks.length, 6);
});

test('hunt: rushing in makes it flee (once), and it goes cold when abandoned', () => {
  const r = rng(3), h = startHunt(HOME, sp, 0, r);
  let pos = { ...HOME };
  pos = walk(pos, h, h.d - 30);
  assert.equal(stepHunt(h, pos, 7, Date.now(), r), 'flee');
  assert.ok(haversine(pos.lat, pos.lon, h.lat, h.lon) > 60);
  assert.notEqual(stepHunt(h, pos, 7, Date.now(), r), 'flee'); // only once
  assert.equal(stepHunt(h, pos, 1, h.born + h.ttl + 1, r), 'cold');
});

test('hunt: rare species start further away and reveal later', () => {
  const h = startHunt(HOME, { ...sp, rarity: 'rare' }, 0, rng(1));
  assert.ok(h.d >= 110 && h.reveal < 20);
});

function mockChunk(key = '14/8191/5450') {
  const lines = [];
  for (let k = 0; k < 12; k++) { const a = new Float32Array(20); for (let i = 0; i < 10; i++) { a[i * 2] = -700 + k * 120; a[i * 2 + 1] = -600 + i * 130; } lines.push(a); }
  return { key, latc: 51.48, lonc: 0, areaName: 'Testville', streets: [{ name: 'A Street', lines }],
    contains(lat, lon) { return Math.abs(lat - 51.48) < 0.007 && Math.abs(lon) < 0.011; } };
}

test('treasure: same spots for everyone on the same day, new spots tomorrow', () => {
  const a = treasuresFor(mockChunk(), '2026-11-05'), b = treasuresFor(mockChunk(), '2026-11-05'), c = treasuresFor(mockChunk(), '2026-11-06');
  assert.equal(a.length, PER_AREA);
  assert.deepEqual(a.map((t) => t.id + t.lat), b.map((t) => t.id + t.lat));
  assert.notDeepEqual(a.map((t) => t.lat), c.map((t) => t.lat));
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) assert.ok(haversine(a[i].lat, a[i].lon, a[j].lat, a[j].lon) >= 110);
});

test('treasure: hot / warm / cool bands', () => {
  assert.equal(bandOf(20), 'hot'); assert.equal(bandOf(100), 'warm'); assert.equal(bandOf(300), 'cool'); assert.equal(bandOf(900), null);
});
