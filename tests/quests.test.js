// Expeditions (beta, src/game/quests.js): dealing quests from real data, rarity from real
// facts, clues costing stars, the wrong-place nudge, race par times, bounty bias, and the
// honesty rule (Roam completions are echo cards that earn no stars).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game.js';
import { Profile } from '../src/game/profile.js';
import { useBackend, memoryBackend } from '../src/storage.js';
import { Quests, makeMystery, makeBounty, makeRace, rarityOfPlace, rarityOfSpecies, rankOf, sectorOf, sunsetIn, parTime, nearestHabitat } from '../src/game/quests.js';
import { haversine, offsetGeo, rng } from '../src/geo.js';

useBackend(memoryBackend);
const HOME = { lat: 51.4779, lon: -0.0015 };
const NOON = new Date(Date.UTC(2026, 10, 4, 12));
const at = (east, north, over = {}) => ({ ...offsetGeo(HOME.lat, HOME.lon, east, north), hours: null, ...over });

const chapel = at(0, 400, { ref: 'osm:node/1', name: 'St Alfege Chapel', kind: 'amenity:place_of_worship', tags: { start_date: '1714', wikidata: 'Q1' } });
const memorial = at(30, 380, { ref: 'osm:node/2', name: 'War Memorial', kind: 'historic:memorial', tags: null });
const cafe = at(0, 200, { ref: 'osm:node/3', name: 'Cafe', kind: 'amenity:cafe', tags: null });
const church2 = at(-60, 300, { ref: 'osm:node/4', name: 'Other Church', kind: 'amenity:place_of_worship', tags: null });

function setup({ pois = [chapel, memorial, cafe, church2], ground = () => 10, habitat = () => 'urban', sunAlt = () => 30 } = {}) {
  const chunk = { snapshot: 'test', markPoi() {}, setClosed() {} };
  const world = {
    *pois(lat, lon, r) { for (const poi of pois) if (haversine(lat, lon, poi.lat, poi.lon) <= r + 50) yield { poi, chunk }; },
    groundAt: ground, habitatAt: habitat, isReadyAt: () => true, findFeature: () => null, readyChunks: () => [], remote: new Map(),
  };
  const env = {
    localNow: () => NOON, sun: (_a, _b, d) => ({ alt: sunAlt(d ? +d : Date.now()) }),
    snapshot: () => ({ sun: 'day', weather: 'clear', season: 'autumn' }), tags: () => [],
  };
  const profile = new Profile({ key: `q.${Math.random()}`, lastKey: `q.last.${Math.random()}` });
  const events = [];
  const game = new Game(world, profile, env, (e) => events.push(e));
  game.dataSaver = true;
  game.features = { quests: true, hunt: true };
  game.quests = new Quests(game, (e) => events.push(e));
  return { game, profile, events, q: game.quests };
}

test('quests: rarity comes from real facts', () => {
  assert.equal(rarityOfPlace({ kind: 'amenity:place_of_worship', tags: { start_date: '1450' } }, 2026), 'legendary');
  assert.equal(rarityOfPlace({ kind: 'amenity:place_of_worship', tags: { start_date: '1714' } }, 2026), 'epic');
  assert.equal(rarityOfPlace({ kind: 'historic:memorial', tags: { wikidata: 'Q2' } }, 2026), 'rare');
  assert.equal(rarityOfPlace({ kind: 'leisure:pitch', tags: null }, 2026), 'common');
  assert.equal(rarityOfSpecies({ rarity: 'rare', group: 'Amphibia' }), 'legendary');
  assert.equal(rarityOfSpecies({ rarity: 'common', group: 'Aves' }), 'uncommon');
});

test('quests: ranks and compass sectors', () => {
  assert.equal(rankOf(0).name, 'Wanderer');
  assert.equal(rankOf(16).name, 'Pathfinder');
  assert.ok(rankOf(10).frac > 0 && rankOf(10).frac < 1);
  assert.equal(sectorOf(0), 'north'); assert.equal(sectorOf(130), 'south-east'); assert.equal(sectorOf(-45), 'north-west');
});

test('quests: a mystery never names its place, skips businesses, and offers three clues', () => {
  for (let s = 1; s < 20; s++) {
    const m = makeMystery(HOME, [chapel, memorial, cafe, church2], {}, rng(s));
    assert.ok(m);
    assert.notEqual(m.ref, 'osm:node/3'); // no cafés
    assert.ok(!m.riddle.includes(m.place.name) && !m.title.includes(m.place.name));
    assert.equal(m.clues.length, 3);
    assert.ok(m.clues.every((c) => !c.text.includes(m.place.name)));
  }
  assert.equal(makeMystery(HOME, [cafe], {}, rng(1)), null);
});

test('quests: clues cost stars; the right place solves it, the wrong one nudges', () => {
  const { game, q, events } = setup({ pois: [church2, chapel] });
  game.enter('roam', { to: HOME });
  q.step();
  const m = q.s.offers[0];
  assert.equal(m.type, 'mystery');
  q.accept(m.id);
  q.buyClue('name');
  const decoy = m.ref === chapel.ref ? church2 : chapel;
  game.pos = { lat: decoy.lat, lon: decoy.lon };
  q.step();
  assert.ok(events.some((e) => e.type === 'quest-wrong'));
  game.pos = { lat: m.lat, lon: m.lon };
  q.step();
  if (m.place.year) {
    assert.ok(events.some((e) => e.type === 'quest-guess'));
    q.guess('18c'); // 1714 is in the 1700s
  }
  const done = events.find((e) => e.type === 'quest-done');
  assert.ok(done);
  assert.equal(done.card.grade, 'echo'); // Roam
  assert.equal(q.stars(), 0);            // echoes earn no stars
  assert.equal(done.card.stars, m.place.year ? 3 : 2);
});

test('quests: real completions earn stars and rank', () => {
  const { game, q, events } = setup({ pois: [chapel] });
  game.setFix({ ...HOME, accuracy: 5, source: 'device', t: Date.now() });
  game.enter('present');
  q.step();
  const m = q.s.offers[0];
  q.accept(m.id);
  game.pos = { lat: m.lat, lon: m.lon };
  q.step();
  q.guess('new'); // wrong era: no bonus
  const done = events.find((e) => e.type === 'quest-done');
  assert.equal(done.card.grade, 'present');
  assert.equal(done.card.stars, 3);
  assert.equal(q.stars(), 3);
  assert.equal(done.card.rarity, 'epic');
});

test('quests: the race targets the high ground with a par time; sunset becomes the clock', () => {
  const hill = (lat) => 10 + Math.max(0, (lat - HOME.lat) * 111320) * 0.08; // rises to the north
  const r = makeRace(HOME, hill, [], 'present', null, rng(1));
  assert.equal(r.kind, 'summit');
  assert.ok(r.gain >= 6);
  assert.ok(r.lat > HOME.lat);
  assert.ok(Math.abs(r.par - parTime(r.dist, 'present')) <= 10); // dist is rounded for display
  const flat = makeRace(HOME, () => 10, [chapel, cafe], 'present', null, rng(1));
  assert.equal(flat.kind, 'dash'); assert.equal(flat.name, 'St Alfege Chapel');
  const sunset = makeRace(HOME, hill, [], 'present', 60 * 60000, rng(1));
  assert.ok(sunset.sunset && sunset.sunsetAt > Date.now());
  // sunset search
  const t0 = Date.now();
  assert.equal(sunsetIn((t) => 5 - (t - t0) / 60000 / 6, t0), 36 * 60000); // sets ~35 min from now
  assert.equal(sunsetIn(() => 40, t0), null);
});

test('quests: a bounty is a real local animal, with the habitat it likes', () => {
  const water = (lat) => (lat > HOME.lat + 0.002 ? 'water' : 'residential');
  const species = [
    { id: 1, name: 'Common Frog', sci: 'Rana temporaria', group: 'Amphibia', count: 12, rarity: 'uncommon' },
    { id: 2, name: 'Daisy', sci: 'Bellis perennis', group: 'Plantae', count: 300, rarity: 'common' },
  ];
  const b = makeBounty(HOME, species, {}, water, rng(2));
  assert.equal(b.sp.id, 1);
  assert.equal(b.habitat.hab, 'water');
  assert.equal(b.habitat.sector, 'north');
  assert.equal(nearestHabitat(HOME, () => 'residential', 'Amphibia'), null);
  assert.equal(makeBounty(HOME, species, {}, () => 'residential', rng(2)), null); // frogs don't live on pavements
});

test('quests: an active bounty biases encounters and completes when spotted', () => {
  const { game, q, events } = setup({ habitat: () => 'water' });
  game.enter('roam', { to: HOME });
  game.wild = { cell: 'x', loading: false, species: [{ id: 7, name: 'Grey Heron', sci: 'Ardea cinerea', group: 'Aves', count: 40, rarity: 'uncommon' }] };
  q.s.offers[1] = makeBounty(HOME, game.wild.species, {}, () => 'water', rng(1));
  q.accept(q.s.offers[1].id);
  assert.equal(q.encounterBias('water', false).sp.id, 7);
  game.spot = game.spot.bind(game);
  const c = { id: 'c1', sp: game.wild.species[0], lat: HOME.lat, lon: HOME.lon, born: 0, ttl: 999 };
  game.critters.push(c);
  game.spot(c);
  assert.ok(events.some((e) => e.type === 'quest-done' && e.card.type === 'bounty'));
});

test('quests: the board re-deals daily and when you travel; one swap a day', () => {
  const { game, q } = setup();
  game.enter('roam', { to: HOME });
  q.step();
  const first = q.s.offers[0].id;
  assert.ok(q.swap(0));
  assert.notEqual(q.s.offers[0].id, first);
  assert.equal(q.swap(0), false); // once a day
  game.pos = offsetGeo(HOME.lat, HOME.lon, 0, 3000);
  q.step();
  assert.equal(q.s.origin.lat, game.pos.lat);
});
