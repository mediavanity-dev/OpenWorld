// The "fun" pass (Nov 2026): find facts and quick challenges, Roam practice stars, real-world
// events and bonuses, habitat preferences, photo licences.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factFor, eraChoices, olderThan } from '../src/game/facts.js';
import { roamStars, ROAM_CAP, ROAM_DAILY, preferredHabitats, nearestHabitat, makeSkyQuest } from '../src/game/quests.js';
import { liveEvents, liveBonus } from '../src/game/events.js';
import { safePhoto } from '../src/data/wildlife.js';

test('facts: a building date becomes an age and a well-known comparison', () => {
  const now = 2026;
  assert.equal(factFor({ tags: { start_date: '1676' } }, now), 'Built 1676: 350 years old, older than Newton’s laws of motion.');
  assert.equal(olderThan(1890), 'powered flight');
  assert.equal(olderThan(2020), null);
  assert.match(factFor({ tags: { heritage: '2' } }), /heritage/);
  assert.match(factFor({ tags: { wikidata: 'Q1' } }), /story/);
  assert.equal(factFor({ tags: {} }), null);
});

test('facts: era choices always contain the right answer once, and never a future era', () => {
  for (const y of [1066, 1676, 1799, 1800, 1850, 1925, 1999, 2015, 2025]) {
    for (let k = 0; k < 20; k++) {
      const opts = eraChoices(y);
      assert.equal(opts.length, 3);
      assert.equal(opts.filter((o) => o.right).length, 1, `one right answer for ${y}`);
      assert.ok(opts.every((o) => o.s <= new Date().getFullYear()), `no future era for ${y}`);
      assert.equal(new Set(opts.map((o) => o.label)).size, 3);
    }
  }
});

test('roam practice stars: at most 3 a day and 5 in all', () => {
  const echo = (date, stars) => ({ grade: 'echo', date, stars, rarity: 'common' });
  assert.equal(roamStars([echo('2026-01-01', 3), echo('2026-01-01', 3)]), ROAM_DAILY);
  assert.equal(roamStars([echo('2026-01-01', 3), echo('2026-01-02', 3), echo('2026-01-03', 3)]), ROAM_CAP);
  assert.equal(roamStars([{ grade: 'present', date: '2026-01-01', stars: 3 }]), 0);
});

test('habitats: water birds and frogs look for water first', () => {
  assert.deepEqual(preferredHabitats({ name: 'Greylag Goose', group: 'Aves' }), ['water', 'wetland']);
  assert.deepEqual(preferredHabitats({ name: 'Common Frog', group: 'Amphibia' }), ['water', 'wetland']);
  assert.deepEqual(preferredHabitats({ name: 'Great Spotted Woodpecker', group: 'Aves' }), ['wood', 'park', 'scrub']);
  assert.equal(preferredHabitats({ name: 'House Sparrow', group: 'Aves' }), null);
  // park right here, a pond 200 m north: a goose is sent to the pond, a sparrow to the park
  const pos = { lat: 51.5, lon: 0 };
  const habitatAt = (lat) => (lat > 51.5017 ? 'water' : 'park');
  assert.equal(nearestHabitat(pos, habitatAt, 'Aves', 600, undefined, ['water', 'wetland']).hab, 'water');
  assert.equal(nearestHabitat(pos, habitatAt, 'Aves').hab, 'park');
});

// a stand-in Environment
const env = (snap, shower = null) => ({ snapshot: () => snap, utcOffset: () => 0, _shower: shower });

test('events: golden hour, rain and night-only bonuses', () => {
  const pos = { lat: 51.5, lon: 0 };
  assert.equal(liveBonus(env({ sun: 'golden hour', moon: 'waxing crescent', weather: 'clear' }), pos)?.key, 'golden');
  assert.equal(liveBonus(env({ sun: 'day', moon: 'waxing crescent', weather: 'rain' }), pos)?.key, 'rain');
  assert.equal(liveBonus(env({ sun: 'day', moon: 'full moon', weather: 'clear' }), pos), null); // full moon counts after dark
  assert.equal(liveBonus(env({ sun: 'night', moon: 'full moon', weather: 'clear' }), pos)?.key, 'fullmoon');
  assert.ok(liveEvents(env({ sun: 'day', moon: 'full moon', weather: 'rain' }), pos).some((e) => e.quest === 'rain'));
});

test('events: a sky quest goes to open green ground, needs the dark, and is epic', () => {
  const pos = { lat: 51.5, lon: 0 };
  const habitatAt = (lat) => (lat > 51.5025 ? 'park' : 'urban');
  const o = makeSkyQuest(pos, habitatAt, 'present', { key: 'fullmoon', glyph: '🌕', title: 'Full moon tonight', blurb: '' });
  assert.ok(o && o.needsDark && o.rarity === 'epic' && o.event.key === 'fullmoon');
  assert.ok(o.lat > 51.5025 && o.dist >= 150);
  assert.equal(makeSkyQuest(pos, () => 'urban', 'present', { key: 'x', glyph: '', title: '', blurb: '' }), null);
});

test('licences: only photos free for any use are shown', () => {
  assert.ok(safePhoto({ license_code: 'cc-by' }));
  assert.ok(safePhoto({ license_code: 'cc0' }));
  assert.ok(safePhoto({ license_code: 'cc-by-sa' }));
  assert.equal(safePhoto({ license_code: 'cc-by-nc' }), null);
  assert.equal(safePhoto({ license_code: 'cc-by-nd' }), null);
  assert.equal(safePhoto({ license_code: null }), null);
});
