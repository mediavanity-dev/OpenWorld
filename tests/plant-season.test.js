import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plantSeason } from '../src/render/critters.js';

test('plant seasons follow the hemisphere; the tropics stay in leaf', () => {
  const d = (m) => new Date(2026, m, 15);
  assert.equal(plantSeason(44.5, d(10)), 'autumn');  // Vermont, November
  assert.equal(plantSeason(44.5, d(0)), 'winter');
  assert.equal(plantSeason(44.5, d(3)), 'spring');
  assert.equal(plantSeason(44.5, d(6)), 'summer');
  assert.equal(plantSeason(-33.9, d(10)), 'spring'); // Sydney, November
  assert.equal(plantSeason(1.3, d(0)), 'summer');    // Singapore
  assert.equal(plantSeason(undefined), 'summer');
});
