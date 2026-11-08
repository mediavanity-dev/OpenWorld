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

const setHome = (profile, p = HOME) => { profile.data.home = { ...p, trust: 'gps', accuracy: 5, source: 'device', setAt: new Date().toISOString() }; };

test('quests: in Home, every goal is inside the home range; switching mode re-deals what is out of reach', () => {
  const far = at(0, 750, { ref: 'osm:node/9', name: 'Far Abbey', kind: 'amenity:place_of_worship', tags: { start_date: '1200' } });
  const near = at(0, 300, { ref: 'osm:node/8', name: 'Near Memorial', kind: 'historic:memorial', tags: null });
  const { game, q, profile } = setup({ pois: [far, near] });
  game.enter('roam', { to: HOME });
  for (let k = 0; k < 20; k++) { q.s.offers[0] = null; q._fillT = 0; q.step(); if (q.s.offers[0]?.ref === far.ref) break; }
  assert.equal(q.s.offers[0].ref, far.ref); // Roam may deal the far one
  setHome(profile);
  game.enter('home');
  q._fillT = 0; q.step();
  assert.equal(q.s.offers[0].ref, near.ref); // out of the 600 m range: re-dealt
  for (let k = 0; k < 10; k++) { q.s.offers[0] = null; q._fillT = 0; q.step(); assert.notEqual(q.s.offers[0]?.ref, far.ref); }
});

test('quests: an active goal outside the range says so; Present on an internet fix cannot start one', () => {
  const far = at(0, 750, { ref: 'osm:node/9', name: 'Far Abbey', kind: 'amenity:place_of_worship', tags: null });
  const { game, q, profile, events } = setup({ pois: [far] });
  game.enter('roam', { to: HOME });
  q.step();
  q.accept(q.s.offers[0].id);
  setHome(profile);
  game.enter('home');
  q.step();
  assert.ok(events.some((e) => e.type === 'quest-info' && /outside your home range/.test(e.msg)));
  q.abandon();
  game.setFix({ ...HOME, accuracy: 5000, source: 'ip', t: Date.now() });
  game.enter('present');
  q.step();
  const o = q.s.offers.find(Boolean);
  assert.equal(q.accept(o.id), null);
  assert.ok(events.some((e) => e.type === 'quest-blocked' && /internet/.test(e.msg)));
});

test('quests: the race clock is measured from where you accept it, never from the finish line', () => {
  const hill = (lat) => 10 + Math.max(0, (lat - HOME.lat) * 111320) * 0.08;
  const { game, q } = setup({ ground: hill });
  game.enter('roam', { to: HOME });
  q.step();
  const r = q.s.offers[2];
  assert.equal(r.type, 'race');
  // walk to (almost) the finish, then accept: a fresh course, not a free three stars
  game.pos = offsetGeo(r.lat, r.lon, 20, 0);
  const o = q.accept(r.id);
  if (o) {
    assert.notEqual(o.id, r.id);
    assert.ok(haversine(game.pos.lat, game.pos.lon, o.lat, o.lon) >= 120);
  }
  assert.ok(!q.active() || q.active().par >= 30);
});

test('quests: a reload while the age question was showing asks again on arrival', () => {
  const { game, q, profile, events } = setup({ pois: [chapel] });
  game.enter('roam', { to: HOME });
  q.step();
  const m = q.s.offers[0];
  q.accept(m.id);
  game.pos = { lat: m.lat, lon: m.lon };
  q.step();
  assert.equal(events.filter((e) => e.type === 'quest-guess').length, 1);
  // "reload": a new Quests over the same saved profile
  const again = new Quests(game, (e) => events.push(e));
  game.quests = again;
  assert.equal(again.active().pending, undefined);
  again.step();
  assert.equal(events.filter((e) => e.type === 'quest-guess').length, 2);
  again.guess('18c');
  const card = profile.data.quests.cards[0];
  assert.equal(card.mode, 'roam');
  assert.ok(card.title && card.date);
});

test('home base: a typed address must be near where the device or connection says you are', () => {
  const { game, profile, events } = setup();
  const ip = { ...HOME, accuracy: 5000, source: 'ip', t: Date.now() };
  assert.match(game.homeCheck(offsetGeo(HOME.lat, HOME.lon, 0, 80000), ip), /80 km/);
  assert.equal(game.homeCheck(offsetGeo(HOME.lat, HOME.lon, 0, 8000), ip), null); // same town: fine
  const gps = { ...HOME, accuracy: 20, source: 'device', t: Date.now() };
  assert.ok(game.homeCheck(offsetGeo(HOME.lat, HOME.lon, 0, 2000), gps)); // a precise fix only allows a small refinement
  assert.ok(game.setHomeAt(offsetGeo(HOME.lat, HOME.lon, 0, 8000), ip, { via: 'address', place: 'Blackheath' }));
  assert.equal(profile.data.home.trust, 'address');
  assert.equal(profile.data.home.place, 'Blackheath');
  // and it's still permanent for 30 days
  assert.equal(game.setHomeAt(HOME, gps), undefined);
  assert.ok(events.some((e) => e.type === 'error' && /permanent/.test(e.msg)));
});

// ---------------------------------------------------------------- richer riddles (rules, never invented)
import { riddleFor, redact, factLines, storyLine, applyFacts } from '../src/game/quests.js';
import { factsFrom, referencedIds } from '../src/data/wikidata.js';

// a trimmed copy of the real Wikidata entity for St Alfege Church, Greenwich (Q1975627)
const ALFEGE = { claims: {
  P31: [{ rank: 'normal', mainsnak: { datavalue: { value: { id: 'Q1' } } } }],
  P571: [{ rank: 'normal', mainsnak: { datavalue: { value: { time: '+1714-00-00T00:00:00Z' } } } }],
  P84: [{ rank: 'normal', mainsnak: { datavalue: { value: { id: 'Q2' } } } }],
  P149: [{ rank: 'deprecated', mainsnak: { datavalue: { value: { id: 'Q9' } } } }, { rank: 'normal', mainsnak: { datavalue: { value: { id: 'Q3' } } } }],
  P1435: [{ rank: 'preferred', mainsnak: { datavalue: { value: { id: 'Q4' } } } }],
} };
const REFS = { Q1: { label: 'church building' }, Q2: { label: 'Nicholas Hawksmoor', desc: 'British architect' }, Q3: { label: 'English Baroque architecture' }, Q4: { label: 'Grade I listed building' }, Q9: { label: 'Wrong style' } };
const EXTRACT = 'St Alfege Church is an Anglican church in the centre of Greenwich, part of the Royal Borough of Greenwich in London.Of medieval origin, it reputedly marks the site where Alfege was martyred in 1012.';

test('riddles: several hand-written lines per kind, so the same kind of place reads differently', () => {
  const lines = new Set();
  const r = rng(7);
  for (let k = 1; k < 40; k++) lines.add(riddleFor({ kind: 'amenity:fountain' }, r));
  assert.ok(lines.size >= 3);
});

test('riddles: Wikidata facts are read as plain facts; deprecated statements are ignored', () => {
  assert.deepEqual(referencedIds(ALFEGE).sort(), ['Q1', 'Q2', 'Q3', 'Q4']); // not the deprecated Q9
  const f = factsFrom(ALFEGE, REFS);
  assert.equal(f.year, 1714);
  assert.equal(f.architect.label, 'Nicholas Hawksmoor');
  assert.equal(f.style.label, 'English Baroque architecture');
});

test('riddles: facts become first-person lines, and nothing gives the name away', () => {
  assert.equal(redact('St Alfege Church is in Greenwich', 'St Alfege Church'), 'St … Church is in Greenwich');
  const lines = factLines(factsFrom(ALFEGE, REFS), 'St Alfege Church');
  assert.equal(lines.maker, 'Nicholas Hawksmoor designed me.');
  assert.equal(lines.style, 'I was built in the English Baroque style.');
  // a fact that repeats the name is left out rather than shown half-blank
  assert.equal(factLines({ type: { label: 'astronomical observatory' } }, 'Royal Observatory').type, undefined);
  // one sentence, even when the summary has no space after a full stop
  assert.equal(storyLine(EXTRACT, 'St Alfege Church'), 'St … Church is an Anglican church in the centre of Greenwich, part of the Royal Borough of Greenwich in London.');
});

test('riddles: facts add a second line, the build year (age guess, rarity) and better clues', () => {
  const o = makeMystery(HOME, [{ ...chapel, tags: { wikidata: 'Q1975627' } }], {}, rng(1));
  assert.equal(o.place.year, null);
  const before = o.rarity;
  applyFacts(o, factsFrom(ALFEGE, REFS), EXTRACT);
  assert.equal(o.fact, 'Nicholas Hawksmoor designed me.');
  assert.equal(o.place.year, 1714);
  assert.ok(['epic', 'legendary'].includes(o.rarity) && o.rarity !== before);
  assert.deepEqual(o.clues.map((c) => c.key), ['age', 'fact', 'story', 'name', 'zone']);
  assert.ok(o.clues.every((c) => !/Alfege/.test(c.text)));
  // once a clue is bought, the clues never change under the player
  const m = makeMystery(HOME, [chapel], {}, rng(2));
  m.used.push('name');
  const keys = m.clues.map((c) => c.key);
  applyFacts(m, factsFrom(ALFEGE, REFS), EXTRACT);
  assert.deepEqual(m.clues.map((c) => c.key), keys);
});

test('riddles: facts are fetched once per mystery in the background, and never with data saver on', async () => {
  const { game, q } = setup({ pois: [{ ...chapel, tags: { wikidata: 'Q1975627' } }] });
  let calls = 0;
  q.lookup = { facts: async () => { calls++; return factsFrom(ALFEGE, REFS); }, summary: async () => ({ extract: EXTRACT }) };
  game.enter('roam', { to: HOME });
  q.step(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 0); // data saver (set in setup)
  game.dataSaver = false;
  q.s.offers[0] = null; q._fillT = 0;
  q.step(); await new Promise((r) => setTimeout(r, 0));
  q.step(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 1);
  assert.equal(q.s.offers[0].fact, 'Nicholas Hawksmoor designed me.');
});
