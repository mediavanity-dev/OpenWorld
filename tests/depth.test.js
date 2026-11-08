// Explorer depth, reachable goals and friend leagues (BACKLOG items 8–10, first steps):
// public walkable ways from the map tiles, "can people get there?", race finishes on paths,
// "can't get there", on-foot speed for explored ground, area coverage and tiers, share codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkable } from '../src/data/vtiles.js';
import { nearestOnLines, nearestPath, reachable, snapToPath, walkCells, closedToPublic } from '../src/game/reach.js';
import { depthTier, explorerScore, Journal } from '../src/game/journal.js';
import { Game, RULES } from '../src/game/game.js';
import { Profile } from '../src/game/profile.js';
import { Quests, makeRace } from '../src/game/quests.js';
import { explorerName, summaryOf, encode, decode, standings } from '../src/game/league.js';
import { useBackend, memoryBackend } from '../src/storage.js';
import { offsetGeo, haversine, geohash, rng } from '../src/geo.js';

useBackend(memoryBackend);
const C = { lat: 51.48, lon: 0 };
const NOON = new Date(Date.UTC(2026, 10, 4, 12));

// a fake map area: a straight east–west public street through the middle (z = 0, chunk-local metres)
function area(walk = [new Float32Array([-600, 0, -300, 0, 0, 0, 300, 0, 600, 0])]) {
  return {
    key: '14/1/1', latc: C.lat, lonc: C.lon, areaName: 'Testville', pois: [],
    bounds: { n: C.lat + 0.006, s: C.lat - 0.006, w: C.lon - 0.01, e: C.lon + 0.01 },
    contains(lat, lon) { return Math.abs(lat - C.lat) < 0.006 && Math.abs(lon - C.lon) < 0.01; },
    walk,
  };
}
const worldOf = (...chunks) => ({ readyChunks: () => chunks });

test('paths: which ways people may walk on comes from the tiles\' access and foot tags', () => {
  assert.ok(walkable({ class: 'path', subclass: 'footway' }));
  assert.ok(walkable({ class: 'minor' }));
  assert.ok(!walkable({ class: 'motorway' }));
  assert.ok(!walkable({ class: 'rail' }));
  assert.ok(!walkable({ class: 'path', foot: 'private' }));
  assert.ok(!walkable({ class: 'service', service: 'driveway' }));
  assert.ok(!walkable({ class: 'minor', access: 'no' }));
  assert.ok(walkable({ class: 'minor', access: 'no', foot: 'yes' })); // closed to cars, open to walkers
});

test('reach: near a public way is reachable; far from any, or tagged private, is not', () => {
  assert.equal(Math.round(nearestOnLines([new Float32Array([0, 0, 100, 0])], 50, 30).d), 30);
  const w = worldOf(area());
  const near = offsetGeo(C.lat, C.lon, 100, 40), far = offsetGeo(C.lat, C.lon, 100, 200);
  assert.ok(reachable(w, near));
  assert.ok(!reachable(w, far));
  assert.ok(!reachable(w, { ...near, tags: { access: 'private' } }));
  assert.ok(closedToPublic({ tags: { foot: 'no' } }));
  // no path data yet (still loading): nothing is ruled out
  assert.ok(reachable(worldOf(area(null)), far));
  // snapping lands on the street
  const s = snapToPath(w, near.lat, near.lon);
  assert.ok(Math.abs(s.lat - C.lat) < 1e-5);
  assert.equal(snapToPath(w, far.lat, far.lon), null);
  assert.ok(!nearestPath(worldOf(), C.lat, C.lon).known);
});

test('race: the high ground is only a finish if a public path reaches it', () => {
  // a hill to the north, with the street running east–west at the bottom (no path up the hill)
  const hill = (lat) => 10 + Math.max(0, (lat - C.lat) * 111320) * 0.08;
  const w = worldOf(area());
  const snap = (lat, lon) => snapToPath(w, lat, lon);
  const r = makeRace(C, hill, [], 'present', null, rng(1), () => true, snap);
  assert.equal(r, null); // the top is off the paths and there's no landmark to dash to instead
  // add a footpath up the hill: now the summit is on it
  const up = area([new Float32Array([-600, 0, 600, 0]), new Float32Array([200, 0, 200, -300, 200, -600])]);
  const r2 = makeRace(C, hill, [], 'present', null, rng(1), () => true, (lat, lon) => snapToPath(worldOf(up), lat, lon));
  assert.equal(r2.kind, 'summit');
  const o = offsetGeo(C.lat, C.lon, 200, 0);
  assert.ok(Math.abs(r2.lon - o.lon) < 0.0002); // on the path at x = 200 m
});

test('cells: explored ground counts on foot only (Present, up to 10 mph)', () => {
  assert.ok(Math.abs(RULES.ON_FOOT_MAX_SPEED - 4.47) < 0.01);
  const profile = new Profile({ key: `d.${Math.random()}`, lastKey: `d.l.${Math.random()}` });
  const env = { localNow: () => NOON };
  const j = new Journal(profile, env);
  j.onMove('present', 30, C, 10, false);
  assert.equal(profile.data.cells[geohash(C.lat, C.lon, 7)], undefined);
  j.onMove('present', 30, C, 10, true);
  assert.equal(profile.data.cells[geohash(C.lat, C.lon, 7)], 3);
  // and the game passes that flag from the real (GPS) speed
  const world = { *pois() {}, groundAt: () => 10, habitatAt: () => 'urban', readyChunks: () => [], chunkAt: () => null, remote: new Map() };
  const g = new Game(world, new Profile({ key: `d2.${Math.random()}`, lastKey: `d2.l.${Math.random()}` }), { ...env, sun: () => ({ alt: 30 }), snapshot: () => ({}), tags: () => [] }, () => {});
  g.dataSaver = true;
  const seen = [];
  g.journal = { onMove: (...a) => seen.push(a[4]), task: () => ({}) };
  g.setFix({ ...C, accuracy: 5, source: 'device', t: 1000 });
  g.enter('present');
  g.setFix({ ...offsetGeo(C.lat, C.lon, 0, 100), accuracy: 5, source: 'device', t: 6000 }); // 100 m in 5 s = 20 m/s (a car)
  g.tick(0.5, null);
  assert.equal(seen.at(-1), false);
});

test('depth: coverage of an area\'s walkable ground, tiers, and a score that rewards depth', () => {
  const ch = area();
  const cells = walkCells(ch);
  assert.ok(cells.size >= 6);
  assert.equal(depthTier(0), null);
  assert.equal(depthTier(0.3), 'Explored');
  assert.equal(depthTier(0.95), 'Known by heart');
  // ten areas known well beat a hundred passed through
  const deep = {}, wide = {};
  for (let k = 0; k < 10; k++) deep[k] = { walk: 100, foot: 80 };
  for (let k = 0; k < 100; k++) wide[k] = { walk: 100, foot: 3 };
  assert.ok(explorerScore(deep) > 50 * explorerScore(wide));
  // walking the street announces tiers
  const profile = new Profile({ key: `d3.${Math.random()}`, lastKey: `d3.l.${Math.random()}` });
  const events = [];
  const j = new Journal(profile, { localNow: () => NOON }, (e) => events.push(e));
  j.chunkAt = () => ch;
  j.onArea(ch);
  assert.equal(profile.data.areas[ch.key].walk, cells.size);
  for (let x = -590; x <= 590; x += 40) j.onMove('present', 40, offsetGeo(C.lat, C.lon, x, 0), 10, true);
  const a = profile.data.areas[ch.key];
  assert.ok(a.foot / a.walk > 0.9);
  assert.deepEqual(events.filter((e) => e.type === 'area-tier').map((e) => e.tier), ['Explored', 'Surveyed', 'Mapped', 'Known by heart']);
});

test('can\'t get there: swaps with no penalty and the spot is never offered again', () => {
  const pois = [0, 1].map((k) => ({ ref: `osm:node/${k}`, name: `Memorial ${k}`, kind: 'historic:memorial', tags: null, hours: null, ...offsetGeo(C.lat, C.lon, k ? -300 : 300, 0) }));
  const world = {
    *pois(lat, lon, r) { for (const poi of pois) if (haversine(lat, lon, poi.lat, poi.lon) <= r + 50) yield { poi, chunk: { markPoi() {}, setClosed() {} } }; },
    groundAt: () => 10, habitatAt: () => 'urban', isReadyAt: () => true, readyChunks: () => [], chunkAt: () => null, remote: new Map(),
  };
  const env = { localNow: () => NOON, sun: () => ({ alt: 30 }), snapshot: () => ({}), tags: () => [] };
  const profile = new Profile({ key: `d4.${Math.random()}`, lastKey: `d4.l.${Math.random()}` });
  const events = [];
  const g = new Game(world, profile, env, (e) => events.push(e));
  g.dataSaver = true; g.features = { quests: true };
  const q = g.quests = new Quests(g, (e) => events.push(e));
  g.enter('roam', { to: C });
  q.step();
  const m = q.s.offers[0];
  q.accept(m.id);
  const fresh = q.cantReach();
  assert.equal(q.active(), null);
  assert.notEqual(fresh.ref, m.ref);
  assert.equal(q.s.swaps, 1); // the daily swap is untouched
  for (let k = 0; k < 10; k++) { q.s.offers[0] = null; q._fillT = 0; q.step(); assert.notEqual(q.s.offers[0]?.ref, m.ref); }
});

test('league: a code carries numbers and a generated name only, and bad codes are refused', () => {
  const me = summaryOf({ id: 'abc', level: 3, stars: 21, cards: 9, rare: 2, species: 14, score: 230, deep: 1, date: '2026-11-08' });
  assert.match(me.n, /^[A-Z][a-z]+ [A-Z][a-z]+ \d{2}$/);
  assert.equal(explorerName('abc'), me.n);
  const code = encode(me);
  assert.deepEqual(decode(code), me);
  assert.deepEqual(decode(`https://example.org/OpenWorld/beta/#friend=${code}`), me);
  assert.equal(decode('hello'), null);
  assert.equal(decode(encode({ ...me, n: '<img src=x onerror=alert(1)>' })), null);
  assert.equal(decode(encode({ ...me, s: -5 })), null);
  assert.equal(decode(encode({ ...me, extra: 'x', lat: 51.5 })).lat, undefined); // unknown fields are dropped
  const order = standings([{ ...me, n: 'A A 10', x: 10 }, { ...me, n: 'B B 10', x: 300 }]);
  assert.equal(order[0].n, 'B B 10'); // depth first
});

// ---------------------------------------------------------------- the deep layer (BACKLOG 11), help as you go
import { normalizeDeep, deepQuery } from '../src/data/deep.js';
import { inscriptionLine, fieldNotes, MYSTERY_WARM_M, MYSTERY_HOT_M } from '../src/game/quests.js';

test('deep layer: small real things become places, private ones never', () => {
  assert.match(deepQuery({ s: 1, w: 2, n: 3, e: 4 }), /\(1,2,3,4\)/);
  const places = normalizeDeep({ elements: [
    { type: 'node', id: 1, lat: 51.48, lon: 0, tags: { man_made: 'survey_point', 'survey_point:structure': 'pillar' } },
    { type: 'node', id: 2, lat: 51.48, lon: 0, tags: { amenity: 'post_box', royal_cypher: 'VR' } },
    { type: 'way', id: 3, center: { lat: 51.48, lon: 0 }, tags: { memorial: 'plaque', name: 'Wolfe plaque', inscription: 'General James Wolfe lived here 1752–1759' } },
    { type: 'node', id: 4, lat: 51.48, lon: 0, tags: { historic: 'boundary_stone', access: 'private' } },
    { type: 'node', id: 5, lat: 51.48, lon: 0, tags: { amenity: 'post_box', royal_cypher: 'XYZ' } },
  ] });
  assert.deepEqual(places.map((p) => p.name), ['Survey mark', 'Victorian post box (VR)', 'Wolfe plaque']);
  assert.ok(places.every((p) => p.deep && p.kind.startsWith('historic:')));
  // a plaque's inscription becomes the riddle's second line, with the name blanked out
  assert.equal(inscriptionLine(places[2]), 'It reads: “General James … lived here 1752–1759”');
});

test('deep layer: opens once half an area is walked, once, and only then', () => {
  const profile = new Profile({ key: `d5.${Math.random()}`, lastKey: `d5.l.${Math.random()}` });
  const events = [];
  const j = new Journal(profile, { localNow: () => NOON }, (e) => events.push(e));
  const ch = area();
  j.chunkAt = () => ch;
  j.onArea(ch);
  for (let x = -590; x <= -100; x += 40) j.onMove('present', 40, offsetGeo(C.lat, C.lon, x, 0), 10, true);
  assert.equal(events.filter((e) => e.type === 'deep-unlock').length, 0); // under half
  for (let x = -100; x <= 590; x += 40) j.onMove('present', 40, offsetGeo(C.lat, C.lon, x, 0), 10, true);
  assert.equal(events.filter((e) => e.type === 'deep-unlock').length, 1);
  assert.ok(profile.data.areas[ch.key].deep);
});

test('help as you go: a mystery gets warm, then hot, but never gives a direction', () => {
  const target = { ref: 'osm:node/7', name: 'Old Well', kind: 'historic:well', tags: null, hours: null, ...offsetGeo(C.lat, C.lon, 0, 400) };
  const world = {
    *pois(lat, lon, r) { if (haversine(lat, lon, target.lat, target.lon) <= r + 50) yield { poi: target, chunk: { markPoi() {}, setClosed() {} } }; },
    groundAt: () => 10, habitatAt: () => 'urban', isReadyAt: () => true, readyChunks: () => [], chunkAt: () => null, remote: new Map(),
  };
  const events = [];
  const g = new Game(world, new Profile({ key: `d6.${Math.random()}`, lastKey: `d6.l.${Math.random()}` }), { localNow: () => NOON, sun: () => ({ alt: 30 }), snapshot: () => ({}), tags: () => [] }, (e) => events.push(e));
  g.dataSaver = true; g.features = { quests: true };
  const q = g.quests = new Quests(g, (e) => events.push(e));
  g.enter('roam', { to: C });
  q.step();
  q.accept(q.s.offers[0].id);
  const at = (m) => { g.pos = offsetGeo(C.lat, C.lon, 0, 400 - m); q.step(); };
  at(300); at(MYSTERY_WARM_M - 10); at(MYSTERY_HOT_M - 10); at(MYSTERY_WARM_M - 10); at(MYSTERY_HOT_M - 10);
  assert.deepEqual(events.filter((e) => e.type === 'quest-warm').map((e) => e.band), ['warm', 'hot', 'hot']);
  assert.ok(events.filter((e) => e.type === 'quest-warm').every((e) => !('bearing' in e)));
});

test('help as you go: a bounty gets field notes in its habitat, a sighting clue costs a star, patience pays', async () => {
  const notes = fieldNotes({ group: 'Aves' }, { summary: 'The grey heron is a long-legged wading bird. It is common. It eats fish.' }, [0, 0, 1, 2, 8, 10, 9, 4, 1, 0, 0, 0], 'water', 5);
  assert.match(notes[0], /water’s edge/);
  assert.match(notes[1], /May, June, July.*good time/);
  assert.equal(notes[2], 'About it: The grey heron is a long-legged wading bird. It is common.');
  // in the game
  const world = { *pois() {}, groundAt: () => 10, habitatAt: () => 'water', isReadyAt: () => true, readyChunks: () => [], chunkAt: () => null, remote: new Map() };
  const events = [];
  const g = new Game(world, new Profile({ key: `d7.${Math.random()}`, lastKey: `d7.l.${Math.random()}` }), { localNow: () => NOON, sun: () => ({ alt: 30 }), snapshot: () => ({}), tags: () => [] }, (e) => events.push(e));
  g.features = { quests: true, hunt: true };
  const q = g.quests = new Quests(g, (e) => events.push(e));
  q.lookup = { ...q.lookup, taxon: async () => ({ summary: 'A wading bird.' }), season: async () => null, sightings: async () => [{ ...offsetGeo(C.lat, C.lon, 200, 0), date: '2026-11-06' }] };
  g.enter('roam', { to: C });
  const heron = { id: 7, name: 'Grey Heron', sci: 'Ardea cinerea', group: 'Aves', count: 40, rarity: 'uncommon' };
  q.s.offers[1] = { type: 'bounty', id: 'b1', title: 'Wanted: Grey Heron', sp: heron, rarity: 'rare', fled: 0, habitat: { hab: 'water', text: 'water', lat: C.lat, lon: C.lon, d: 0, sector: 'north' } };
  q.s.date = q.date(); q.s.mode = 'roam';
  q.accept('b1');
  q.step(); await new Promise((r) => setTimeout(r, 0));
  assert.ok(events.some((e) => e.type === 'quest-habitat'));
  assert.equal(q.active().notes.at(-1), 'About it: A wading bird.');
  const s = await q.buySighting();
  assert.equal(s.sector, 'east');
  assert.equal(q.starsFor(q.active(), 0), 2);
  const p1 = q.encounterBias('water', false).pick, p2 = q.encounterBias('water', false).pick;
  assert.ok(p2 > p1);
});

test('accepting a race: the clock waits while you read the card, and starts when you head off', () => {
  const hill = (lat) => 10 + Math.max(0, (lat - C.lat) * 111320) * 0.08;
  const world = { *pois() {}, groundAt: hill, habitatAt: () => 'urban', isReadyAt: () => true, readyChunks: () => [], chunkAt: () => null, remote: new Map() };
  const events = [];
  const g = new Game(world, new Profile({ key: `d8.${Math.random()}`, lastKey: `d8.l.${Math.random()}` }), { localNow: () => NOON, sun: () => ({ alt: 30 }), snapshot: () => ({}), tags: () => [] }, (e) => events.push(e));
  g.dataSaver = true; g.features = { quests: true };
  const q = g.quests = new Quests(g, (e) => events.push(e));
  g.enter('roam', { to: C });
  q.step();
  const r = q.accept(q.s.offers[2].id);
  assert.equal(r.type, 'race');
  assert.equal(r.startedAt, null);
  q.step();
  assert.equal(q.active().startedAt, null); // still reading
  g.pos = offsetGeo(C.lat, C.lon, 0, 20);   // set off without closing the board (e.g. after a reload)
  q.step();
  assert.ok(q.active().startedAt);
  assert.equal(events.filter((e) => e.type === 'quest-clock').length, 1);
  assert.equal(q.startClock(), false); // once
});

// ---------------------------------------------------------------- far from everything (no dead boards)
import { makeBounty, makeGround, walkedCells, GROUND_TARGET } from '../src/game/quests.js';

function farGame({ pois = [], habitat = () => 'farmland', ground = () => 10, species = [] } = {}) {
  const world = {
    *pois(lat, lon, r) { for (const poi of pois) if (haversine(lat, lon, poi.lat, poi.lon) <= r + 50) yield { poi, chunk: { markPoi() {}, setClosed() {} } }; },
    groundAt: ground, habitatAt: habitat, isReadyAt: () => true, readyChunks: () => [], chunkAt: () => null, remote: new Map(),
  };
  const events = [];
  const profile = new Profile({ key: `f.${Math.random()}`, lastKey: `f.l.${Math.random()}` });
  const g = new Game(world, profile, { localNow: () => NOON, sun: () => ({ alt: 30 }), snapshot: () => ({}), tags: () => [] }, (e) => events.push(e));
  g.dataSaver = true; g.features = { quests: true };
  g.wild = { cell: 'x', loading: false, species };
  const q = g.quests = new Quests(g, (e) => events.push(e));
  g.enter('roam', { to: C });
  return { g, q, events, profile };
}

test('far from everything: a mystery 1.5 km away becomes a rarer long expedition', () => {
  const chapel = { ref: 'osm:node/50', name: 'Lonely Chapel', kind: 'amenity:place_of_worship', tags: null, hours: null, ...offsetGeo(C.lat, C.lon, 0, 1500) };
  const { q } = farGame({ pois: [chapel] });
  const m = q.make('mystery');
  assert.equal(m.ref, chapel.ref);
  assert.ok(m.long);
  assert.equal(m.rarity, 'rare'); // uncommon, one step up for the long walk
});

test('far from everything: with no hill or landmark, the race goes to the water’s edge', () => {
  const water = (lat) => (lat > C.lat + 0.003 ? 'water' : 'farmland'); // a lake ~330 m north
  const { q } = farGame({ habitat: water });
  const r = q.make('race');
  assert.equal(r.kind, 'water');
  assert.equal(r.title, 'Race to the water’s edge');
});

test('far from everything: plants and fungi can be wanted when no animal fits', () => {
  const sp = [{ id: 9, name: 'Bluebell', sci: 'Hyacinthoides non-scripta', group: 'Plantae', count: 20, rarity: 'uncommon' }];
  assert.equal(makeBounty(C, sp, {}, () => 'wood', rng(1)), null);
  assert.equal(makeBounty(C, sp, {}, () => 'wood', rng(1), new Set(), () => true, true).sp.name, 'Bluebell');
});

test('New ground: walk stretches you have never walked; it fills empty boards', () => {
  assert.equal(makeGround('present', 'Testville', 3), null); // not enough unwalked ground left
  assert.equal(walkedCells({ a: 3, b: 2, c: 1 }, 'present'), 1);
  assert.equal(walkedCells({ a: 3, b: 2, c: 1 }, 'home'), 2);
  const { g, q, events, profile } = farGame(); // nothing at all around: no places, no water, flat, no wildlife
  for (let k = 0; k < 40; k++) { q._fillT = 0; q.step(); }
  const ground = q.s.offers.find((o) => o?.type === 'ground');
  assert.ok(ground, 'a New ground quest fills in');
  assert.equal(q.s.offers.filter((o) => o?.type === 'ground').length, 1); // only one
  assert.ok(q.empty()); // the other slots say honestly that little is mapped here
  profile.data.cells = {}; // (the journal makes this in the game)
  q.accept(ground.id);
  for (let k = 0; k < GROUND_TARGET; k++) { profile.data.cells[`newcell${k}`] = 1; q._groundT = 0; q.step(); }
  assert.ok(events.some((e) => e.type === 'quest-done' && e.card.type === 'ground'));
  void g;
});

test('re-dealing keeps the active quest in its own slot, whatever its kind', () => {
  const { g, q } = farGame();
  for (let k = 0; k < 40; k++) { q._fillT = 0; q.step(); }
  const i = q.s.offers.findIndex((o) => o?.type === 'ground');
  q.accept(q.s.offers[i].id);
  q.deal('move');
  assert.equal(q.s.offers[i]?.id, q.s.active);
  void g;
});
