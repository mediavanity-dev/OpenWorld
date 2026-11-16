// @ts-check
// Real-world moments that change play: tonight's meteor shower, a full moon, rain, golden
// hour, snow. All from data the game already has (the sky calculator and live weather).
//   - A "bonus" applies to anything finished while it's happening: the card is one rarity
//     higher and says why ("Golden hour"). Different conditions, not more travel.
//   - Some also deal a one-off event quest on the board (src/game/quests.js, eventOffer).

import { skyNotes } from '../data/science.js';

/**
 * @typedef {{ key: string, glyph: string, title: string, blurb: string, bonus: boolean,
 *   quest: null | 'sky' | 'rain', name?: string }} LiveEvent
 */

/**
 * What's happening at this spot right now (and the meteor shower peaking tonight).
 * @param {any} env  Environment (snapshot, utcOffset)
 * @param {{lat: number, lon: number}} pos
 * @returns {LiveEvent[]}
 */
export function liveEvents(env, pos) {
  const out = [];
  let snap;
  try { snap = env.snapshot(pos.lat, pos.lon); } catch { return out; }
  const night = snap.sun === 'night';
  let shower = null;
  try { shower = skyNotes(pos.lat, pos.lon, env.utcOffset()).shower; } catch { /* no sky data */ }
  if (shower && shower.days === 0) {
    out.push({ key: `shower:${shower.name}`, glyph: '🌠', name: shower.name, bonus: night, quest: 'sky',
      title: `${shower.name} meteor shower tonight`,
      blurb: `The ${shower.name} peak tonight: up to ~${shower.rate} meteors an hour under dark skies. Find open ground away from streetlights after dark.` });
  }
  if (snap.moon === 'full moon') {
    out.push({ key: 'fullmoon', glyph: '🌕', bonus: night, quest: shower?.days === 0 ? null : 'sky',
      title: 'Full moon tonight',
      blurb: 'A full moon is up tonight. Anything you finish under it, outdoors after dark, earns a full-moon card.' });
  }
  if (/rain|drizzle|storm/.test(snap.weather || '')) {
    out.push({ key: 'rain', glyph: '🌧️', bonus: true, quest: 'rain',
      title: 'Rain walk',
      blurb: 'Rain brings out snails, slugs, frogs and fungi. Anything you finish in the rain is a rarer card.' });
  }
  if (snap.weather === 'snow') {
    out.push({ key: 'snow', glyph: '❄️', bonus: true, quest: null, title: 'Snow', blurb: 'Snow on the ground: anything you finish now is a rarer card, and tracks show up well.' });
  }
  if (snap.sun === 'golden hour' || snap.sun === 'twilight') {
    out.push({ key: 'golden', glyph: '🌅', bonus: true, quest: null, title: 'Golden hour', blurb: 'The light is low and warm. Anything you finish right now is a rarer card.' });
  }
  return out;
}

/** The bonus that applies to a card finished now (the first one that's on), or null. */
export function liveBonus(env, pos) {
  return liveEvents(env, pos).find((e) => e.bonus) || null;
}

// groups that come out in the rain
export const RAIN_GROUPS = new Set(['Mollusca', 'Amphibia', 'Fungi']);
