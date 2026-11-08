// @ts-check
// Friend leagues (beta): compare with friends without any server. Your "explorer card" is a
// short code holding a few numbers and a generated name, never places, routes or dates
// finer than a day. You pass it by hand (a link or a pasted code); friends' cards are kept
// on your device. Codes can be edited by hand, so this is for friends, not prizes; a public
// board would need the server-side checks in BACKLOG item 9.

import { hashStr } from '../geo.js';

const ADJ = ['Swift', 'Quiet', 'Bright', 'Curious', 'Bold', 'Gentle', 'Keen', 'Wild', 'Sunny', 'Misty', 'Brave', 'Nimble', 'Patient', 'Lucky', 'Clever', 'Steady'];
const ANIMALS = ['Heron', 'Fox', 'Otter', 'Wren', 'Badger', 'Hare', 'Kestrel', 'Newt', 'Robin', 'Stag', 'Owl', 'Plover', 'Beaver', 'Lynx', 'Puffin', 'Marten'];

/** A friendly, stable name from the profile id (no free text, so nothing to moderate). */
export function explorerName(id) {
  const h = hashStr(String(id));
  return `${ADJ[h % 16]} ${ANIMALS[(h >>> 4) % 16]} ${10 + ((h >>> 8) % 90)}`;
}
/** A short stable key for a player (to update a friend's row instead of duplicating it). */
export const playerKey = (id) => hashStr(`league|${id}`).toString(36);

/**
 * The numbers on your card.
 * @param {{ id: string, level: number, stars: number, cards: number, rare: number, species: number, score: number, deep: number, date: string }} p
 */
export function summaryOf(p) {
  return { v: 1, k: playerKey(p.id), n: explorerName(p.id), r: p.level, s: p.stars, c: p.cards, e: p.rare, sp: p.species, x: p.score, a: p.deep, t: p.date };
}

const b64 = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

export function encode(sum) { return b64(JSON.stringify(sum)); }

const INT = ['r', 's', 'c', 'e', 'sp', 'x', 'a'];
/** A friend's code (or a link containing one) back to a card; null if it isn't a valid card. */
export function decode(input) {
  const code = /(?:#friend=)?([A-Za-z0-9_-]{8,600})\s*$/.exec(String(input || '').trim())?.[1];
  if (!code) return null;
  let o;
  try { o = JSON.parse(unb64(code)); } catch { return null; }
  if (!o || o.v !== 1 || typeof o.k !== 'string' || !/^[0-9a-z]{1,10}$/.test(o.k)) return null;
  if (typeof o.n !== 'string' || !/^[A-Z][a-z]+ [A-Z][a-z]+ \d{2}$/.test(o.n)) return null;
  if (typeof o.t !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.t)) return null;
  for (const f of INT) if (!Number.isInteger(o[f]) || o[f] < 0 || o[f] > 1e7) return null;
  const out = { v: 1, k: o.k, n: o.n, t: o.t };
  for (const f of INT) out[f] = o[f];
  return out;
}

/** League order: explorer depth first, then stars, then species. */
export function standings(cards) {
  return [...cards].sort((a, b) => b.x - a.x || b.s - a.s || b.sp - a.sp || a.n.localeCompare(b.n));
}
