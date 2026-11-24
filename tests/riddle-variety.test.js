import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riddleFor, riddleMore } from '../src/game/quests.js';

test('riddle lines are not repeated until a kind of place runs out of them', () => {
  const poi = { kind: 'amenity:place_of_worship', cls: 'place_of_worship' };
  const seen = new Set(), got = [];
  for (let k = 0; k < 5; k++) { const l = riddleFor(poi, Math.random, seen); assert.ok(!seen.has(l)); seen.add(l); got.push(l); }
  assert.equal(new Set(got).size, 5);
  const more = riddleMore(poi, Math.random, new Set());
  assert.equal(typeof more, 'string');
});
