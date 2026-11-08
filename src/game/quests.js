// @ts-check
// Expeditions (beta): a board of three quests dealt from real data around you, each with
// a different verb, and a collectible card at the end whose rarity comes from real facts.
//
//   Mystery (deduce): an unnamed real place nearby, described as a riddle. Buy clues
//                     (each costs a star); visiting the wrong place nudges you on.
//   Bounty  (track):  a real species recorded locally is "wanted". Head to the habitat it
//                     likes; hunts there favour it.
//   Race    (beat the clock): reach the local high ground (or a landmark) inside par time,
//                     or before the real sunset when it's close.
//
// Stars (1–3) build a field rank. Roam completions are echo cards: collected, but no stars,
// so the honesty rule holds (only real visits count).
// Knows nothing about rendering or the DOM; the UI lives in src/ui/expeditions.js.

import { haversine, offsetGeo, offsetMeters } from '../geo.js';
import { groupOf } from '../world/icons.js';
import { wildHabitat } from '../world/habitats.js';
import { fitsHabitat } from '../data/wildlife.js';
import { isQuirk } from './journal.js';
import { RULES } from './game.js';

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const bump = (r, n = 1) => RARITIES[Math.max(0, Math.min(RARITIES.length - 1, RARITIES.indexOf(r) + n))];

/** @type {[number, string][]} */
export const RANKS = [
  [0, 'Wanderer'], [5, 'Scout'], [15, 'Pathfinder'], [30, 'Tracker'], [50, 'Ranger'],
  [80, 'Surveyor'], [120, 'Naturalist'], [170, 'Explorer'], [230, 'Cartographer'], [300, 'Legend'],
];
export function rankOf(stars) {
  let i = 0;
  while (i + 1 < RANKS.length && stars >= RANKS[i + 1][0]) i++;
  const floor = RANKS[i][0], next = RANKS[i + 1]?.[0] ?? null;
  return { level: i + 1, name: RANKS[i][1], stars, floor, next, frac: next ? (stars - floor) / (next - floor) : 1 };
}

const SECTORS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export function sectorOf(bearing) { return SECTORS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]; }
export function bearingTo(from, to) {
  const o = offsetMeters(from.lat, from.lon, to.lat, to.lon);
  return (Math.atan2(o.x, -o.z) * 180) / Math.PI;
}
let seq = 0;
const uid = (k) => `${k}${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const roundTo = (m, step) => Math.max(step, Math.round(m / step) * step);

const BUSINESS = new Set(['food', 'shop', 'lodging', 'other', 'geocache', 'transport']);
export function yearOf(poi) {
  const y = parseInt(poi?.tags?.start_date, 10);
  return y > 0 && y <= new Date().getFullYear() ? y : null;
}

// ---------------------------------------------------------------- rarity from real facts
export function rarityOfPlace(poi, year = new Date().getFullYear()) {
  const built = yearOf(poi), grp = groupOf(poi.kind, poi.cls);
  let r = 'common';
  if (['history', 'worship', 'museum', 'sight', 'nature'].includes(grp) || isQuirk(poi)) r = 'uncommon';
  if (poi.tags?.heritage || poi.tags?.wikipedia || poi.tags?.wikidata) r = bump(r);
  if (built != null) {
    const age = year - built;
    const byAge = age >= 500 ? 'legendary' : age >= 250 ? 'epic' : age >= 120 ? 'rare' : age >= 60 ? 'uncommon' : 'common';
    if (RARITIES.indexOf(byAge) > RARITIES.indexOf(r)) r = byAge;
  }
  return r;
}
export function rarityOfSpecies(sp) {
  let r = sp.rarity === 'rare' ? 'epic' : sp.rarity === 'uncommon' ? 'rare' : 'uncommon';
  if (['Mammalia', 'Reptilia', 'Amphibia'].includes(sp.group)) r = bump(r);
  return r;
}
export function rarityOfRace(gain, sunset) {
  const r = gain >= 40 ? 'epic' : gain >= 18 ? 'rare' : gain >= 6 ? 'uncommon' : 'common';
  return sunset ? bump(r) : r;
}

// ---------------------------------------------------------------- riddles
const RIDDLE = {
  worship: 'I have heard more whispered wishes than anywhere else around here.',
  history: 'I remember something this street has long forgotten.',
  museum: 'I keep other people’s treasures, and I’ll show you if you ask.',
  sight: 'People come a long way just to stand in front of me.',
  park: 'Green, open and full of birdsong. Dogs adore me.',
  nature: 'I was here long before the houses, and I’ll outlast them.',
  culture: 'Curtains, books or a stage: I’m where stories happen.',
  education: 'Every year a fresh crowd learns something inside me.',
  civic: 'Quietly, I keep this place running.',
  sport: 'Sweat, shouting and the odd triumph: that’s me.',
};
const RIDDLE_KIND = {
  tree: 'I’m alive, I’m older than you, and I’ve never moved an inch.',
  peak: 'Around here, nobody stands taller than me.',
  fountain: 'I never stop talking, but I only ever say one thing.',
  clock: 'I tell everyone the same thing all day long.',
  sundial: 'I only work when the weather is kind.',
  memorial: 'I was made so that someone would not be forgotten.',
  statue: 'I’ve been standing still for a very long time.',
  artwork: 'Someone made me to make you stop and look.',
  viewpoint: 'Stand on me and the whole place opens up.',
  ruins: 'I used to be whole. Now I’m more interesting.',
  castle: 'Walls, gates and old quarrels: I’ve seen them all.',
  windmill: 'I worked with the wind long before it was fashionable.',
  spring: 'Water finds its own way out, right here.',
};
export function riddleFor(poi) {
  const value = (poi.kind || '').split(':')[1] || '';
  return RIDDLE_KIND[value] || RIDDLE[groupOf(poi.kind, poi.cls)] || 'I’m not on any postcard, but I’m worth finding.';
}
const human = (s) => (s || '').replace(/_/g, ' ');
function eraText(y) { return y < 1800 ? `the ${Math.floor(y / 100) * 100}s` : `the ${Math.floor(y / 10) * 10}s`; }

// Era choices for the age-guess at the end of a mystery (wide bands, so it's a judgement call)
export const ERAS = [
  { id: 'old', label: 'Before 1700', test: (y) => y < 1700 },
  { id: '18c', label: '1700s', test: (y) => y >= 1700 && y < 1800 },
  { id: 'e19', label: '1800–1849', test: (y) => y >= 1800 && y < 1850 },
  { id: 'l19', label: '1850–1899', test: (y) => y >= 1850 && y < 1900 },
  { id: 'e20', label: '1900–1949', test: (y) => y >= 1900 && y < 1950 },
  { id: 'new', label: '1950 or later', test: (y) => y >= 1950 },
];

// ---------------------------------------------------------------- dealing
/**
 * Mystery: pick an interesting, unnamed-on-the-card place 120–800 m away.
 * @param {{lat:number, lon:number}} pos
 * @param {any[]} pois
 * @param {Record<string, any>} discovered
 * @param {Set<string>} [avoid]
 * @param {(p: {lat:number, lon:number}) => boolean} [inside] only targets the player can reach in this mode
 */
export function makeMystery(pos, pois, discovered, rand = Math.random, avoid = new Set(), inside = (_p) => true) {
  const cands = [];
  for (const p of pois) {
    if (!p.name || avoid.has(p.ref) || !inside(p)) continue;
    const grp = groupOf(p.kind, p.cls);
    if (BUSINESS.has(grp)) continue;
    const d = haversine(pos.lat, pos.lon, p.lat, p.lon);
    if (d < 120 || d > 800) continue;
    cands.push({ p, d, grp, brg: bearingTo(pos, p) });
  }
  if (!cands.length) return null;
  for (const c of cands) {
    c.sector = sectorOf(c.brg);
    c.alike = cands.filter((o) => o.grp === c.grp && o.sector === c.sector).length;
    let s = rand() * 1.5;
    if (!discovered[c.p.ref]) s += 3;
    if (yearOf(c.p)) s += 3;
    if (c.p.tags?.wikidata || c.p.tags?.wikipedia) s += 2;
    if (c.p.tags?.heritage) s += 1.5;
    if (['history', 'worship', 'museum', 'sight', 'nature'].includes(c.grp) || isQuirk(c.p)) s += 1.5;
    if (c.alike >= 2 && c.alike <= 5) s += 1; // a little ambiguity makes it a puzzle
    if (c.d > 600) s -= 1;
    c.score = s;
  }
  cands.sort((a, b) => b.score - a.score);
  const c = cands[Math.floor(rand() * Math.min(4, cands.length))];
  const poi = c.p, year = yearOf(poi), words = poi.name.trim().split(/\s+/);
  const value = human((poi.kind || '').split(':')[1]);
  const clues = [];
  if (year) clues.push({ key: 'age', label: 'How old?', text: `I was built in ${eraText(year)}.` });
  else if (poi.tags?.species) clues.push({ key: 'fact', label: 'What am I?', text: `I’m a ${poi.tags.species}.` });
  else if (poi.tags?.heritage) clues.push({ key: 'fact', label: 'What am I?', text: `I’m a protected heritage site (a ${value}).` });
  else clues.push({ key: 'fact', label: 'What am I?', text: `I’m a ${value || 'place'}.` });
  clues.push({ key: 'name', label: 'My name', text: `My name starts with “${[...poi.name][0].toUpperCase()}” and has ${words.length} word${words.length > 1 ? 's' : ''}.` });
  const a = rand() * Math.PI * 2, off = 15 + rand() * 35;
  const zc = offsetGeo(poi.lat, poi.lon, Math.cos(a) * off, Math.sin(a) * off);
  clues.push({ key: 'zone', label: 'Search area', text: 'It’s inside the gold circle on your minimap.', zone: { lat: zc.lat, lon: zc.lon, r: 70 } });
  return {
    type: 'mystery', id: uid('m'),
    title: 'Who am I?',
    riddle: riddleFor(poi),
    sector: c.sector, dist: roundTo(c.d, 50), alike: c.alike,
    rarity: rarityOfPlace(poi),
    lat: poi.lat, lon: poi.lon, ref: poi.ref, group: c.grp,
    place: { name: poi.name, kind: poi.kind, cls: poi.cls || null, tags: poi.tags || null, year },
    clues, used: [],
  };
}

/** Find the nearest ground of a habitat that suits a species group (sampled rings). */
export function nearestHabitat(pos, habitatAt, group, maxR = 600, inside = (_p) => true) {
  for (let r = 0; r <= maxR; r += 40) {
    const n = r ? Math.max(8, Math.round(r / 25)) : 1;
    let best = null;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, p = offsetGeo(pos.lat, pos.lon, Math.sin(a) * r, Math.cos(a) * r);
      if (!inside(p)) continue;
      const h = wildHabitat(habitatAt(p.lat, p.lon));
      if (h !== 'urban' && fitsHabitat(group, h, false)) { best = { hab: h, lat: p.lat, lon: p.lon, d: r, bearing: (a * 180) / Math.PI }; break; }
    }
    if (best) return best;
  }
  return null;
}
const HAB_TEXT = { water: 'water', wood: 'woodland', wetland: 'wetland', scrub: 'scrubland', farmland: 'fields', park: 'parks and green spaces' };

/**
 * Bounty: a locally recorded animal you haven't got yet, plus where it likes to be.
 * @param {any[]} species  this area's species list (src/data/wildlife.js)
 */
export function makeBounty(pos, species, known, habitatAt, rand = Math.random, avoid = new Set(), inside = (_p) => true) {
  const pool = species.filter((s) => !['Plantae', 'Fungi'].includes(s.group) && !avoid.has(s.id) && s.count >= 3);
  if (!pool.length) return null;
  const scored = pool.map((s) => {
    let v = rand() * 2;
    if (!known[s.id]) v += 3;
    if (s.rarity === 'uncommon') v += 2; else if (s.rarity === 'rare') v += 1; // rare is great, but should still be findable
    if (s.photo) v += 1;
    return { s, v };
  }).sort((a, b) => b.v - a.v);
  for (const { s } of scored.slice(0, 6)) {
    const hab = nearestHabitat(pos, habitatAt, s.group, 600, inside);
    const urbanOk = fitsHabitat(s.group, 'urban', false);
    if (!hab && !urbanOk) continue;
    const sp = { id: s.id, name: s.name, sci: s.sci, group: s.group, count: s.count, rarity: s.rarity, photo: s.photo, credit: s.credit };
    return {
      type: 'bounty', id: uid('b'),
      title: `Wanted: ${s.name}`,
      sp, rarity: rarityOfSpecies(s), fled: 0,
      habitat: hab ? { hab: hab.hab, text: HAB_TEXT[hab.hab] || hab.hab, lat: hab.lat, lon: hab.lon, d: roundTo(hab.d, 20), sector: sectorOf(hab.bearing) } : null,
    };
  }
  return null;
}

// time (ms from `now`) until the sun sets, if within `maxMin`; null otherwise
export function sunsetIn(sunAlt, now = Date.now(), maxMin = 120) {
  if (sunAlt(now) <= -0.833) return null;
  for (let m = 2; m <= maxMin; m += 2) if (sunAlt(now + m * 60000) <= -0.833) return m * 60000;
  return null;
}
export const PACE = { present: 1.35, home: 6, roam: 6 }; // m/s used for par times (Home/Roam joystick walk)
export function parTime(d, mode) { return Math.round((d * 1.4) / (PACE[mode] || 1.35) + 30); }

/**
 * Race: the highest ground within reach (or a viewpoint / landmark), against par or sunset.
 * @param {(lat:number, lon:number) => number|null} groundAt
 */
export function makeRace(pos, groundAt, pois, mode, sunsetMs, rand = Math.random, inside = (_p) => true) {
  const here = groundAt(pos.lat, pos.lon);
  let best = null;
  if (here != null) {
    for (let e = -650; e <= 650; e += 30) for (let n = -650; n <= 650; n += 30) {
      const r = Math.hypot(e, n);
      if (r < 150 || r > 650) continue;
      const p = offsetGeo(pos.lat, pos.lon, e, n);
      if (!inside(p)) continue;
      const h = groundAt(p.lat, p.lon);
      if (h != null && (!best || h > best.h)) best = { ...p, h, d: r };
    }
  }
  let target, kind, gain = 0;
  if (best && best.h - here >= 6) { target = best; kind = 'summit'; gain = Math.round(best.h - here); }
  else {
    const spots = pois.filter((p) => {
      if (!p.name || !inside(p)) return false;
      const d = haversine(pos.lat, pos.lon, p.lat, p.lon), grp = groupOf(p.kind, p.cls);
      return d >= 200 && d <= 750 && !BUSINESS.has(grp);
    });
    const view = spots.filter((p) => /viewpoint|peak|tower|lighthouse/.test(p.kind || ''));
    const list = view.length ? view : spots;
    if (!list.length) return null;
    const p = list[Math.floor(rand() * list.length)];
    target = { lat: p.lat, lon: p.lon, name: p.name, d: haversine(pos.lat, pos.lon, p.lat, p.lon) };
    kind = view.length ? 'viewpoint' : 'dash';
  }
  const par = parTime(target.d, mode);
  // the real sunset as the clock, if it's close and reachable
  const sunset = sunsetMs != null && sunsetMs > par * 1000 * 1.1 && sunsetMs < 100 * 60000;
  const name = target.name || null;
  const title = sunset ? (kind === 'summit' ? 'Beat the sunset to the high ground' : `Beat the sunset to ${name}`)
    : kind === 'summit' ? 'Summit sprint' : kind === 'viewpoint' ? `Race to the view: ${name}` : `Dash to ${name}`;
  return {
    type: 'race', id: uid('r'),
    title, kind, name, lat: target.lat, lon: target.lon, dist: roundTo(target.d, 10), gain,
    par, sunset, sunsetAt: sunset ? Date.now() + sunsetMs : null,
    rarity: rarityOfRace(gain, sunset),
  };
}

// ---------------------------------------------------------------- the live state
const TYPES = ['mystery', 'bounty', 'race'];
const REDEAL_M = 1500;          // walk/roam this far from where the board was dealt and it re-deals
const FILL_FALLBACK_S = 25;     // a slot that can't be filled (no wildlife data…) becomes another type

export class Quests {
  /** @param {any} game  the Game (world, profile, env, pos, mode, wild) */
  constructor(game, onEvent) {
    this.game = game;
    this.onEvent = onEvent || (() => {});
    this._fillT = 0;
    this._tries = 0;
    this._wrong = new Set();
    this.tidy();
  }
  get profile() { return this.game.profile; }
  get s() { return this.ensure(); }
  emit(type, msg, extra) { this.onEvent({ type, msg, ...extra }); }

  ensure() {
    const d = this.profile.data;
    d.quests ||= { date: null, origin: null, mode: null, offers: [null, null, null], swaps: 1, active: null, cards: [], done: 0, seen: false };
    // seen: the player has opened the board at least once (until then it glows instead of popping up)
    if (d.quests.seen == null) d.quests.seen = !!(d.quests.cards.length || d.quests.active);
    return d.quests;
  }
  // after loading a save: drop moment-to-moment state (a pending age guess re-asks on arrival)
  tidy() {
    for (const o of this.ensure().offers) if (o) { delete o.pending; delete o.live; }
    this._wrong.clear();
  }
  date() { return this.game.env.localNow().toISOString().slice(0, 10); }
  stars() { return this.s.cards.reduce((a, c) => a + (c.grade === 'echo' ? 0 : c.stars), 0); }
  rank() { return rankOf(this.stars()); }
  active() { return this.s.offers.find((o) => o && o.id === this.s.active) || null; }

  // Can the player get to a point in this mode? (Home: only inside the home range.)
  inside(p) {
    const g = this.game, h = this.profile.data.home;
    if (g.mode !== 'home' || !h) return true;
    return haversine(h.lat, h.lon, p.lat, p.lon) <= RULES.LEASH_M - 15;
  }
  goal(o) { return o.type === 'bounty' ? (o.habitat?.d ? o.habitat : null) : o; }
  reachable(o) { const t = this.goal(o); return !t || this.inside(t); }
  // why an offer can't be played right now (null = it can)
  blocked(o) {
    const g = this.game;
    if (g.mode === 'present' && g.fix?.source === 'ip') return 'You’re placed by your internet connection, so you can’t move. Set a home base, or play on your phone.';
    if (!this.reachable(o)) return 'Outside your home range. Play it Present, or in Roam as an echo.';
    return null;
  }
  // today's progress: cards won and (real) stars earned
  today() {
    const d = this.date(), cs = this.s.cards.filter((c) => c.date === d);
    return { done: cs.length, stars: cs.reduce((a, c) => a + (c.grade === 'echo' ? 0 : c.stars), 0) };
  }

  /** @param {'' | 'move'} [why] 'move': re-dealt for a new area (keeps today's swap) */
  deal(why = '') {
    const s = this.ensure(), keep = this.active();
    s.date = this.date();
    s.mode = this.game.mode;
    s.origin = { lat: this.game.pos.lat, lon: this.game.pos.lon };
    s.offers = TYPES.map((t) => (keep && keep.type === t ? keep : null));
    if (why !== 'move') s.swaps = 1;
    this._tries = 0;
    this._fillT = 0;
    this.profile.save();
  }

  // swap one offer for a fresh one of the same type (once a day)
  swap(i) {
    const s = this.s, o = s.offers[i];
    if (!o || o.id === s.active || s.swaps < 1) return false;
    const fresh = this.make(o.type, new Set([o.ref, o.sp?.id].filter(Boolean)));
    if (!fresh) return false;
    s.offers[i] = fresh; s.swaps--;
    this.profile.save();
    return true;
  }

  make(type, avoid = new Set()) {
    const g = this.game, pos = g.pos, w = g.world;
    const pois = [...w.pois(pos.lat, pos.lon, 900)].map((x) => x.poi);
    for (const o of this.s.offers) if (o?.ref) avoid.add(o.ref);
    const inside = (p) => this.inside(p);
    if (type === 'mystery') return makeMystery(pos, pois, this.profile.data.discoveries, Math.random, avoid, inside);
    if (type === 'bounty') return g.wild.species.length ? makeBounty(pos, g.wild.species, this.profile.data.species || {}, (a, b) => w.habitatAt(a, b), Math.random, avoid, inside) : null;
    if (type === 'race') {
      const ss = sunsetIn((t) => g.env.sun(pos.lat, pos.lon, new Date(t)).alt);
      return makeRace(pos, (a, b) => w.groundAt(a, b), pois, g.mode, ss, Math.random, inside);
    }
    return null;
  }

  // Start an offer. Returns the quest, or null (with the reason emitted as 'quest-blocked').
  accept(id) {
    const s = this.s, g = this.game, i = s.offers.findIndex((x) => x && x.id === id);
    let o = s.offers[i];
    if (!o || o.done || s.active) return null;
    const why = this.blocked(o);
    if (why) { this.emit('quest-blocked', why); return null; }
    const pos = g.pos;
    if (o.type === 'race') {
      // the clock is fair from where you actually start: re-measured now, and a fresh
      // course if you're already practically at the finish
      let d = haversine(pos.lat, pos.lon, o.lat, o.lon);
      if (d < 120) {
        const fresh = this.make('race', new Set());
        if (!fresh || haversine(pos.lat, pos.lon, fresh.lat, fresh.lon) < 120) { this.emit('quest-blocked', 'You’re already at the finish. Swap it, or start from further away.'); return null; }
        o = s.offers[i] = fresh; d = haversine(pos.lat, pos.lon, o.lat, o.lon);
      }
      o.dist = roundTo(d, 10); o.par = parTime(d, g.mode);
      if (o.sunset && o.sunsetAt - Date.now() < o.par * 1000) { o.sunset = false; o.rarity = rarityOfRace(o.gain, false); }
    } else if (o.type === 'mystery') {
      // directions are given from where you accept it
      o.sector = sectorOf(bearingTo(pos, o));
      o.dist = roundTo(haversine(pos.lat, pos.lon, o.lat, o.lon), 50);
    }
    o.from = { lat: +pos.lat.toFixed(5), lon: +pos.lon.toFixed(5) };
    s.active = o.id;
    o.startedAt = Date.now();
    this._wrong.clear();
    this.profile.log(`Expedition started: ${o.title}`);
    this.profile.save();
    this.emit('quest-start', null, { quest: o });
    return o;
  }
  abandon() {
    const o = this.active();
    if (!o) return;
    this.s.active = null;
    delete o.startedAt; delete o.pending;
    this.profile.log(`Expedition dropped: ${o.title}`);
    this.profile.save();
    this.emit('quest-abandon', null, { quest: o });
  }
  // switching mode (e.g. into Home) can put offers out of reach: those are re-dealt
  onModeChange() {
    const s = this.s;
    s.mode = this.game.mode;
    let changed = false;
    s.offers = s.offers.map((o) => {
      if (!o || o.done || o.id === s.active || this.reachable(o)) return o;
      changed = true; return null;
    });
    if (changed) { this._tries = 0; this._fillT = 0; }
    this.profile.save();
    const a = this.active();
    if (a && !this.reachable(a)) this.emit('quest-info', 'Your expedition’s goal is outside your home range. Finish it Present, or in Roam as an echo.');
  }
  buyClue(key) {
    const o = this.active();
    if (!o || o.type !== 'mystery' || o.used.includes(key)) return null;
    o.used.push(key);
    this.profile.save();
    return o.clues.find((c) => c.key === key) || null;
  }

  reach() {
    const g = this.game;
    return g.mode === 'present' ? Math.min(45, Math.max(25, (g.fix?.accuracy || 10) * 1.2)) : 25;
  }

  // called by the game every ~0.4 s
  step() {
    const g = this.game, s = this.ensure();
    if (!g.pos) return;
    if (!s.date || s.date !== this.date()) this.deal();
    else if (s.mode !== g.mode) this.onModeChange();
    else if (!s.active && s.origin && haversine(s.origin.lat, s.origin.lon, g.pos.lat, g.pos.lon) > REDEAL_M) { this.deal('move'); this.emit('quest-redeal', 'New expeditions for this area'); }
    this.fill();
    const o = this.active();
    if (!o || o.pending) return;
    const d = o.type === 'bounty' ? null : haversine(g.pos.lat, g.pos.lon, o.lat, o.lon);
    o.live = d; // not saved meaningfully, handy for the UI
    if (o.type === 'mystery') {
      if (d <= this.reach()) {
        if (o.place.year && !o.guessed) { o.pending = true; return this.emit('quest-guess', null, { quest: o }); }
        return this.complete(o);
      }
      // the wrong place: a nudge, not a penalty
      for (const { poi } of g.world.pois(g.pos.lat, g.pos.lon, 60)) {
        if (poi.ref === o.ref || this._wrong.has(poi.ref) || groupOf(poi.kind, poi.cls) !== o.group) continue;
        if (haversine(g.pos.lat, g.pos.lon, poi.lat, poi.lon) > this.reach()) continue;
        this._wrong.add(poi.ref);
        const dd = haversine(poi.lat, poi.lon, o.lat, o.lon);
        this.emit('quest-wrong', `Not me! Look about ${roundTo(dd, 50)} m ${sectorOf(bearingTo(poi, o))} of ${poi.name}.`);
      }
    } else if (o.type === 'race') {
      if (o.sunset && Date.now() > o.sunsetAt) {
        o.sunset = false; o.rarity = rarityOfRace(o.gain, false);
        this.profile.save();
        this.emit('quest-info', 'The sun beat you this time. Finish the race anyway for a regular card.');
      }
      if (d <= this.reach()) this.complete(o);
    }
  }

  fill() {
    const s = this.s;
    if (!s.offers.some((o) => !o)) return;
    const now = Date.now();
    if (now - this._fillT < 2000) return;
    this._fillT = now;
    if (!this.game.world.isReadyAt(this.game.pos.lat, this.game.pos.lon)) return;
    this._tries++;
    let changed = false;
    s.offers.forEach((o, i) => {
      if (o) return;
      let q = this.make(TYPES[i]);
      // can't fill this one (e.g. no wildlife data here): offer another kind after a while
      if (!q && this._tries * 2 > FILL_FALLBACK_S) q = this.make(TYPES[i] === 'race' ? 'mystery' : TYPES[i] === 'bounty' ? 'race' : 'race');
      if (q) { s.offers[i] = q; changed = true; }
    });
    if (changed) { this.profile.save(); this.emit('quest-dealt', null); }
  }

  guess(eraId) {
    const o = this.active();
    if (!o || o.type !== 'mystery') return null;
    const era = ERAS.find((e) => e.id === eraId);
    o.guessed = eraId || 'skip';
    o.guessRight = era ? era.test(o.place.year) : null;
    o.pending = false;
    this.complete(o);
    return o.guessRight;
  }

  // game hooks
  bounty() { const o = this.active(); return o?.type === 'bounty' ? o : null; }
  onFlee(sp) { const o = this.bounty(); if (o && o.sp.id === sp.id) { o.fled++; this.profile.save(); } }
  onSpecies(sp, how) { const o = this.bounty(); if (o && o.sp.id === sp.id) this.complete(o, { photo: how === 'photo' }); }

  starsFor(o, secs) {
    if (o.type === 'mystery') return Math.min(3, Math.max(1, 3 - o.used.length) + (o.guessRight ? 1 : 0));
    if (o.type === 'bounty') return Math.max(1, 3 - o.fled);
    return secs <= o.par ? 3 : secs <= o.par * 1.5 ? 2 : 1;
  }

  // every offer done: deal a fresh board (keeps today's swap)
  more() { if (allDone(this.s)) { this.deal('move'); this.fill(); } }

  complete(o, extra = {}) {
    const g = this.game, s = this.s;
    const grade = g.mode === 'roam' ? 'echo' : g.mode === 'home' ? 'home' : 'present';
    const secs = Math.round((Date.now() - (o.startedAt || Date.now())) / 1000);
    const stars = this.starsFor(o, secs);
    const before = this.rank();
    const card = {
      id: o.id, type: o.type, title: o.title, rarity: o.rarity, stars, grade, mode: g.mode, date: this.date(), secs,
      area: g.world.chunkAt?.(o.lat ?? g.pos.lat, o.lon ?? g.pos.lon)?.areaName || null,
      lat: +(o.lat ?? g.pos.lat).toFixed(5), lon: +(o.lon ?? g.pos.lon).toFixed(5),
      ...(o.type === 'mystery' ? { name: o.place.name, kind: o.place.kind, year: o.place.year, ref: o.ref, tags: o.place.tags ? { wikipedia: o.place.tags.wikipedia, wikidata: o.place.tags.wikidata } : null, clues: o.used.length, guessRight: o.guessRight ?? null } : {}),
      ...(o.type === 'bounty' ? { name: o.sp.name, sci: o.sp.sci, group: o.sp.group, spId: o.sp.id, img: o.sp.photo, credit: o.sp.credit, photo: !!extra.photo } : {}),
      ...(o.type === 'race' ? { name: o.kind === 'summit' ? 'High ground' : o.name, gain: o.gain, par: o.par, sunset: o.sunset, raceKind: o.kind, ground: g.world.groundAt(g.pos.lat, g.pos.lon) } : {}),
    };
    s.cards.unshift(card);
    if (s.cards.length > 500) s.cards.length = 500;
    s.done++;
    s.active = null;
    s.offers = s.offers.map((x) => (x && x.id === o.id ? { ...x, done: true } : x));
    this.profile.log(`Expedition complete: ${card.name} (${card.rarity}, ${'★'.repeat(stars)}${grade === 'echo' ? ', echo' : ''})`);
    this.profile.save();
    const after = this.rank();
    this.emit('quest-done', null, { card, quest: o, rankUp: after.level > before.level ? after : null, rank: after, before });
  }

  // bias wildlife encounters towards the bounty when you're in a habitat it likes
  encounterBias(hab, night) {
    const o = this.bounty();
    if (!o || !fitsHabitat(o.sp.group, hab, night)) return null;
    return { chance: 0.9, sp: o.sp, pick: 0.65 };
  }
}

// next card type for the board header: all offers done today?
export function allDone(s) { return s.offers.every((o) => o?.done); }
