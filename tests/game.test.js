// The game rules (src/game/game.js) against a small fake world: the honesty rules
// (Roam never counts as real), the home-base leash, upgrades, opening hours, treasure
// and geocache logging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, RULES } from '../src/game/game.js';
import { Profile } from '../src/game/profile.js';
import { useBackend, memoryBackend } from '../src/storage.js';
import { parseHours } from '../src/data/hours.js';
import { haversine, offsetGeo } from '../src/geo.js';

useBackend(memoryBackend);
const HOME = { lat: 51.4779, lon: -0.0015 };
const NOON = new Date(Date.UTC(2026, 10, 4, 12)); // a Wednesday, 12:00 local

function fakeWorld(pois = [], chunks = []) {
  const chunk = { snapshot: 'test', marked: {}, closed: {}, markPoi(ref, g) { this.marked[ref] = g; }, setClosed(ref, c) { this.closed[ref] = c; } };
  return {
    chunk,
    *pois(lat, lon, r) { for (const poi of pois) if (haversine(lat, lon, poi.lat, poi.lon) <= r + 50) yield { poi, chunk }; },
    groundAt: () => 10, habitatAt: () => 'urban', findFeature: () => null, readyChunks: () => chunks, remote: new Map(),
  };
}
const fakeEnv = {
  localNow: () => NOON,
  sun: () => ({ alt: 30 }),
  snapshot: () => ({ sun: 'day', weather: 'clear', moon: 'waxing', season: 'autumn', tempC: 12, holiday: null }),
  tags: () => ['autumn'],
};
function setup({ pois = [], chunks = [] } = {}) {
  const profile = new Profile({ key: `t.${Math.random()}`, lastKey: `t.last.${Math.random()}` });
  const events = [];
  const world = fakeWorld(pois, chunks);
  const game = new Game(world, profile, fakeEnv, (e) => events.push(e));
  game.dataSaver = true; // no network in tests (wildlife, geology)
  return { game, profile, events, world };
}
const place = (over = {}) => ({ ref: 'osm:node/1', name: 'Old Chapel', kind: 'historic:monument', ...HOME, hours: null, ...over });
const fix = (p, accuracy = 5) => ({ lat: p.lat, lon: p.lon, accuracy, source: 'device', t: Date.now() });

test('game: roam finds are only echoes; a real visit upgrades them to claimed', () => {
  const { game, profile, events } = setup({ pois: [place()] });
  game.enter('roam', { to: HOME });
  game.checkDiscoveries();
  assert.equal(profile.data.discoveries['osm:node/1'].grade, 'echo');
  assert.equal(events.find((e) => e.type === 'discover').result, 'new');
  game.setFix(fix(HOME));
  game.enter('present');
  game.checkDiscoveries();
  assert.equal(profile.data.discoveries['osm:node/1'].grade, 'present');
  assert.equal(events.filter((e) => e.type === 'discover').at(-1).result, 'upgraded');
});

test('game: places count only within the discovery radius, once per visit', () => {
  const far = offsetGeo(HOME.lat, HOME.lon, RULES.DISCOVER_M + 15, 0);
  const { game, profile, events } = setup({ pois: [place({ ...far })] });
  game.enter('roam', { to: HOME });
  game.checkDiscoveries();
  assert.equal(profile.data.discoveries['osm:node/1'], undefined);
  assert.equal(game.nearest.poi.ref, 'osm:node/1'); // the arrow points at it
  game.pos = { ...far };
  game.checkDiscoveries(); game.checkDiscoveries();
  assert.equal(events.filter((e) => e.type === 'discover').length, 1);
});

test('game: closed places can still be discovered; visiting while open earns the badge', () => {
  const closed = place({ hours: parseHours('Mo-Su 18:00-20:00') });
  const { game, profile, events } = setup({ pois: [closed] });
  game.enter('roam', { to: HOME });
  game.checkDiscoveries();
  const d = profile.data.discoveries['osm:node/1'];
  assert.ok(d, 'discovered even though closed');
  assert.ok(!d.seen.includes('open'));
  assert.ok(events.some((e) => e.type === 'info' && /closed right now/.test(e.msg)));

  const { game: g2, profile: p2 } = setup({ pois: [place({ hours: parseHours('Mo-Su 08:00-20:00') })] });
  g2.enter('roam', { to: HOME });
  g2.checkDiscoveries();
  assert.ok(p2.data.discoveries['osm:node/1'].seen.includes('open'));
});

test('game: home mode is leashed to the home base', () => {
  const { game, profile, events } = setup();
  game.setFix(fix(HOME));
  game.enter('present');
  assert.equal(game.setHome(), true);
  game.enter('home');
  for (let k = 0; k < 400; k++) game.tick(0.1, { east: 1, north: 0, run: true });
  const d = haversine(profile.data.home.lat, profile.data.home.lon, game.pos.lat, game.pos.lon);
  assert.ok(d <= RULES.LEASH_M + 1, `stayed within the leash (${d.toFixed(0)} m)`);
  assert.ok(events.some((e) => /Edge of your home range/.test(e.msg || '')));
});

test('game: home base needs a real fix in Present, and can only move once a month', () => {
  const { game, events } = setup();
  game.enter('roam', { to: HOME });
  game.setHome();
  assert.ok(events.at(-1).type === 'error');
  game.setFix(fix(HOME));
  game.enter('present');
  assert.equal(game.setHome(), true);
  game.setHome();
  assert.match(events.at(-1).msg, /can move again in 30 days/);
});

test('game: beacons are refused in Roam', () => {
  const { game, profile, events } = setup();
  game.enter('roam', { to: HOME });
  game.placeBeacon('x');
  assert.equal(profile.data.beacons.length, 0);
  assert.equal(events.at(-1).type, 'error');
});

test('game: daily treasure is collected once, and never in Roam', () => {
  // a single straight street through the area, so treasures land on it
  const lines = [[-400, 0, 400, 0]];
  const chunk = {
    key: '14/8191/5448', latc: HOME.lat, lonc: HOME.lon, areaName: 'Greenwich', streets: [{ name: 'Test St', lines }],
    bounds: { s: HOME.lat - 0.01, n: HOME.lat + 0.01, w: HOME.lon - 0.02, e: HOME.lon + 0.02 },
    contains: () => true,
  };
  const { game, profile, events } = setup({ chunks: [chunk] });
  game.features.treasure = true;
  const t = game.todaysTreasure(chunk)[0];
  game.enter('roam', { to: t });
  game.checkTreasure();
  assert.equal(events.filter((e) => e.type === 'treasure').length, 0, 'not in Roam');

  game.setFix(fix(t));
  game.enter('present');
  game.checkTreasure(); game.checkTreasure();
  assert.equal(events.filter((e) => e.type === 'treasure').length, 1);
  assert.equal(profile.data.treasure.found.length, 1);
});

test('game: geocache finds need you close by, and not in Roam', () => {
  const cache = place({ ref: 'oc:OC1', cls: 'geocache', gc: { code: 'OC1', type: 'Traditional', size: 'small', difficulty: 2, terrain: 1, site: 'de', url: 'https://x' } });
  const { game, profile } = setup();
  game.enter('roam', { to: HOME });
  assert.equal(game.canLogCache(cache).ok, false);
  game.setFix(fix(offsetGeo(HOME.lat, HOME.lon, 200, 0)));
  game.enter('present');
  assert.equal(game.canLogCache(cache).ok, false);
  game.setFix(fix(HOME));
  game.enter('present');
  game.logCache(cache);
  assert.ok(profile.data.geocaches.OC1);
});

test('game: GPS jitter inside the accuracy circle does not move you', () => {
  const { game } = setup();
  game.setFix(fix(HOME, 20));
  const jitter = offsetGeo(HOME.lat, HOME.lon, 4, 3);
  game.setFix({ ...fix(jitter, 20), t: Date.now() + 1000 });
  assert.equal(game.fix.lat, HOME.lat);
});
