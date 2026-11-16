// @ts-check
// Pure helpers behind the moment of a find (src/ui/finds.js): the one real fact worth telling
// about a place, and the choices for the quick "when was it built?" challenge.

import { yearOf } from './quests.js';

// Well-known dates to make a building's age feel real. Only firm, widely agreed years.
const MILESTONES = [
  [1066, 'the Battle of Hastings'], [1492, 'Columbus’s first voyage'], [1687, 'Newton’s laws of motion'],
  [1776, 'the United States'], [1825, 'the first public railway'], [1859, 'Darwin’s Origin of Species'],
  [1879, 'the electric light bulb'], [1889, 'the Eiffel Tower'], [1903, 'powered flight'],
  [1928, 'penicillin'], [1969, 'the Moon landing'], [1989, 'the World Wide Web'], [2007, 'the iPhone'],
];
export function olderThan(year) {
  const m = MILESTONES.find(([y]) => y > year);
  return m ? m[1] : null;
}

/** The one line that makes a place interesting, from real tags only. */
export function factFor(poi, now = new Date().getFullYear()) {
  const y = yearOf(poi), t = poi.tags || {};
  if (y) {
    const age = now - y, than = olderThan(y);
    return `Built ${y}: ${age} years old${than && age > 15 ? `, older than ${than}` : ''}.`;
  }
  if (t.heritage) return 'A protected heritage site.';
  if (t.wikipedia || t.wikidata) return 'It has its own encyclopedia entry. Tap for its story.';
  if (t.inscription) return `It reads: “${String(t.inscription).slice(0, 90)}${t.inscription.length > 90 ? '…' : ''}”`;
  return null;
}

// Three era choices around a year: centuries before 1800, half-centuries after.
export function eraChoices(year, rand = Math.random) {
  const span = year < 1800 ? 100 : 50;
  const start = Math.floor(year / span) * span;
  const label = (s) => (span === 100 ? `${s}s` : `${s}–${s + 49}`);
  const offsets = rand() < 0.5 ? [-span, span] : [-span, -2 * span];
  if (start + span > new Date().getFullYear()) offsets.splice(0, 2, -span, -2 * span); // no future eras
  const opts = [start, ...offsets.map((o) => start + o)].map((s) => ({ s, label: label(s), right: s === start }));
  return opts.sort((a, b) => a.s - b.s);
}
