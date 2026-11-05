// Saving, save-format migrations, playtest stats, the network helper and rephoto matching.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storage, useBackend, memoryBackend, onStorageError } from '../src/storage.js';
import { Profile, migrate, PROFILE_VERSION } from '../src/game/profile.js';
import { summarize, Metrics } from '../src/game/metrics.js';
import { request, backoff, serviceOf, unhealthy } from '../src/data/net.js';
import { matchScore, ncc, overlayRegion } from '../src/game/rephotoMatch.js';
import { esc, safeUrl } from '../src/util/html.js';

useBackend(memoryBackend);
let n = 0;
const keys = () => ({ key: `p${++n}`, lastKey: `l${n}` });

// ---------------------------------------------------------------- profile + storage
test('profile: saves are debounced, and flushed immediately on demand', async () => {
  const k = keys();
  const p = new Profile(k);
  p.data.beacons.push({ id: 'b1' });
  p.save();
  assert.equal(storage.get(k.key), null, 'not written yet');
  assert.equal(p.flush(), true);
  assert.equal(storage.getJson(k.key).beacons.length, 1);
  assert.equal(new Profile(k).data.beacons.length, 1, 'reloads');
});

test('profile: the last position has its own small key and survives a reload', () => {
  const k = keys();
  const p = new Profile(k);
  p.saveLast({ lat: 1, lon: 2, mode: 'roam' });
  assert.equal(storage.get(k.key), null, 'the whole profile was not rewritten');
  assert.deepEqual(new Profile(k).data.last, { lat: 1, lon: 2, mode: 'roam' });
});

test('profile: migrations run step by step; newer or broken saves are refused', () => {
  const steps = { 1: (d) => ({ ...d, v: 2, renamed: d.old }), 2: (d) => ({ ...d, v: 3, extra: true }) };
  const out = migrate({ v: 1, discoveries: {}, old: 'x' }, { version: 3, steps });
  assert.equal(out.v, 3); assert.equal(out.renamed, 'x'); assert.equal(out.extra, true);
  assert.ok(Array.isArray(out.beacons), 'missing fields filled in');
  assert.throws(() => migrate({ v: PROFILE_VERSION + 1, discoveries: {} }), /newer version/);
  assert.throws(() => migrate({ hello: 1 }), /Not an OpenWorld profile/);
  assert.throws(() => migrate({ v: 1, discoveries: {} }, { version: 2, steps: {} }), /No upgrade/);
});

test('profile: an unreadable save is kept untouched, never overwritten', () => {
  const k = keys();
  storage.setJson(k.key, { v: 99, discoveries: {} });
  const p = new Profile(k);
  assert.ok(p.loadError);
  p.data.beacons.push({ id: 'x' }); p.save(); p.flush();
  assert.equal(storage.getJson(k.key).v, 99, 'original still there');
});

test('profile: import goes through migration and is written at once', () => {
  const k = keys();
  const p = new Profile(k);
  p.import(JSON.stringify({ v: 1, discoveries: { a: { grade: 'present' } }, last: { lat: 3, lon: 4, mode: 'home' } }));
  assert.equal(storage.getJson(k.key).discoveries.a.grade, 'present');
  assert.deepEqual(storage.getJson(k.lastKey), { lat: 3, lon: 4, mode: 'home' });
  assert.throws(() => p.import('{"v":1}'));
});

test('storage: a failed write is reported (storage full)', () => {
  const full = { read: () => null, write: () => { throw new Error('QuotaExceededError'); }, remove() {} };
  useBackend(full);
  let seen = null;
  const off = onStorageError((err, key) => { seen = key; });
  assert.equal(storage.set('k', 'v'), false);
  assert.equal(seen, 'k');
  off(); useBackend(memoryBackend);
});

// ---------------------------------------------------------------- playtest stats
test('metrics: sessions, time to first chase, hunt outcomes', () => {
  let t = 1_000_000;
  const m = new Metrics({ key: 'm1', now: () => t });
  m.record({ type: 'mode', mode: 'present' });
  t += 50_000; m.record({ type: 'hunt' });
  t += 30_000; m.record({ type: 'spotted', critter: { hunted: true } });
  t += 10_000; m.record({ type: 'hunt' });
  t += 10_000; m.record({ type: 'hunt-flee' });
  t += 5_000; m.record({ type: 'discover', result: 'new' });
  m.moved(320);
  const s = m.summary();
  assert.equal(s.sessions, 1);
  assert.equal(s.chaseWithinGoal, 1);
  assert.equal(s.medianFirstChaseS, 50);
  assert.equal(s.medianFirstDiscoveryS, 105);
  assert.equal(s.hunts, 2);
  assert.equal(s.huntCaught, 0.5);
  assert.equal(s.huntFled, 0.5);
  m.flush();
  assert.equal(new Metrics({ key: 'm1' }).data.sessions.length, 1, 'kept on the device');
});

test('metrics: a mode switch keeps the session; a long break starts a new one', () => {
  let t = 0;
  const m = new Metrics({ key: 'm2', now: () => t });
  m.record({ type: 'mode', mode: 'roam' });
  t += 60_000; m.record({ type: 'mode', mode: 'present' });
  t += 2 * 3600_000; m.record({ type: 'mode', mode: 'present' });
  assert.equal(m.data.sessions.length, 2);
  assert.deepEqual(m.data.sessions[0].modes, { roam: 1, present: 1 });
});

test('metrics: very short sessions are ignored in the summary', () => {
  assert.equal(summarize([{ start: 0, last: 5000, mode: 'roam', modes: {}, firstChaseS: null, firstDiscoveryS: null, meters: 0, counts: {} }]).sessions, 0);
});

// ---------------------------------------------------------------- network
test('net: retries server errors with backoff, not client errors', async () => {
  let calls = 0;
  const flaky = async () => (++calls < 3 ? new Response('', { status: 503 }) : new Response('{"ok":1}', { status: 200 }));
  const res = await request('https://api.inaturalist.org/x', { retries: 3, base: 1, fetchImpl: flaky });
  assert.equal(res.status, 200); assert.equal(calls, 3);

  calls = 0;
  const missing = async () => { calls++; return new Response('', { status: 404 }); };
  await assert.rejects(request('https://macrostrat.org/x', { retries: 3, base: 1, fetchImpl: missing }), /HTTP 404/);
  assert.equal(calls, 1);
  assert.ok(unhealthy().includes('geology'));
});

test('net: a stalled request times out instead of hanging', async () => {
  const stall = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  await assert.rejects(request('https://example.org', { timeout: 50, fetchImpl: stall }), /timed out/);
});

test('net: jittered backoff and service names', () => {
  const lo = backoff(2, 1000, () => 0), hi = backoff(2, 1000, () => 0.999);
  assert.equal(lo, 2000); assert.ok(hi > 5900 && hi < 6000);
  assert.equal(serviceOf('https://overpass-api.de/api/interpreter'), 'place details');
  assert.equal(serviceOf('https://api.open-meteo.com/v1/forecast'), 'weather');
});

// ---------------------------------------------------------------- html + rephoto
test('html: escaping and link safety', () => {
  assert.equal(esc(`<a href='x'>"&"</a>`), '&lt;a href=&#39;x&#39;&gt;&quot;&amp;&quot;&lt;/a&gt;');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('https://ok.org'), 'https://ok.org');
});

function scene(w, h, shift = 0) { // a "building": bright block on a dark background
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = x >= 12 + shift && x < 30 + shift && y >= 8 && y < 26 ? 220 : 30;
    px.set([v, v, v, 255], (y * w + x) * 4);
  }
  return px;
}
test('rephoto: lined-up views score high, misaligned ones low', () => {
  const w = 48, h = 36;
  assert.ok(matchScore(scene(w, h), scene(w, h), w, h) >= 90);
  assert.ok(matchScore(scene(w, h), scene(w, h, 14), w, h) < 30);
  assert.equal(ncc(new Float32Array(10), new Float32Array(10)), 0, 'flat images do not match');
});

test('rephoto: overlay region maps the contained photo onto the covering video', () => {
  const r = overlayRegion(400, 800, 1000, 750, 720, 1280); // portrait phone, landscape photo
  assert.equal(r.screen.w, 400); assert.equal(r.screen.h, 300); assert.equal(r.screen.y, 250);
  assert.ok(Math.abs(r.video.w - 400 / (800 / 1280)) < 1e-6);
});
