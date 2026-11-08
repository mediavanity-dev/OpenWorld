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
import { WALK } from '../names.js';
import { placeFacts } from '../data/wikidata.js';
import { wikiSummary } from '../data/wiki.js';
import { reachable as walkableTo, nearestPath, closedToPublic } from './reach.js';
import { taxonDetails, seasonality, lastSightings } from '../data/science.js';

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const bump = (r, n = 1) => RARITIES[Math.max(0, Math.min(RARITIES.length - 1, RARITIES.indexOf(r) + n))];

// Rarer cards raise your rank faster: a bonus on top of the stars you earned (real play only).
export const RARITY_BONUS = { common: 0, uncommon: 0, rare: 1, epic: 2, legendary: 3 };
/** What a card adds to your rank: its stars plus its rarity bonus (echoes: nothing). */
export const cardPoints = (c) => (c.grade === 'echo' ? 0 : c.stars + (RARITY_BONUS[c.rarity] || 0));

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
// Riddles are built by rules, never invented: a hand-written opening line for the kind of
// place (several per kind, so two fountains rarely read the same), then, for places linked
// to Wikidata, a real fact in the first person ("Nicholas Hawksmoor designed me.") and
// extra clues from its facts and its encyclopedia entry. The place's own name is always
// blanked out of anything taken from outside.
const RIDDLE = {
  worship: ['I have heard more whispered wishes than anywhere else around here.', 'Bells, candles or silence: people bring me what they can’t say anywhere else.', 'I’ve seen weddings, farewells and every quiet Sunday in between.'],
  history: ['I remember something this street has long forgotten.', 'Most people walk straight past me. They shouldn’t.', 'I’m a piece of the past that refused to leave.'],
  museum: ['I keep other people’s treasures, and I’ll show you if you ask.', 'Everything inside me has a label and a story.', 'I collect what the world would otherwise lose.'],
  sight: ['People come a long way just to stand in front of me.', 'Cameras point at me more than at anything else around here.', 'I’m the reason some visitors came to this part of town.'],
  park: ['Green, open and full of birdsong. Dogs adore me.', 'Picnics, puddles and the odd lost frisbee: that’s me.', 'In the middle of all this, I’m where the town takes a breath.'],
  nature: ['I was here long before the houses, and I’ll outlast them.', 'Nobody built me. I just happened, slowly.', 'Rain, roots and rock made me.'],
  culture: ['Curtains, books or a stage: I’m where stories happen.', 'Come in quiet, leave with something new in your head.', 'Applause, whispers or turning pages: you’ll hear one of them inside me.'],
  education: ['Every year a fresh crowd learns something inside me.', 'Bells ring here, but not for prayer.', 'I’ve watched generations grow up a little.'],
  civic: ['Quietly, I keep this place running.', 'When something goes wrong around here, people come to me.', 'I serve everyone, and I belong to all of them.'],
  sport: ['Sweat, shouting and the odd triumph: that’s me.', 'Win or lose, people leave me out of breath.', 'I keep the score around here.'],
};
const RIDDLE_KIND = {
  tree: ['I’m alive, I’m older than you, and I’ve never moved an inch.', 'I drink rain, eat sunlight and add a ring every year.', 'Birds live in me, and I don’t charge rent.'],
  peak: ['Around here, nobody stands taller than me.', 'Everything around here is downhill from me.'],
  fountain: ['I never stop talking, but I only ever say one thing.', 'Throw in a coin and I’ll keep your wish.', 'I’m always running, and I never leave.'],
  clock: ['I tell everyone the same thing all day long.', 'I have hands but no fingers, and a face but no smile.'],
  sundial: ['I only work when the weather is kind.', 'I tell the time with a shadow, and I take the night off.'],
  memorial: ['I was made so that someone would not be forgotten.', 'I carry names so the town never loses them.', 'People stop beside me and go quiet.'],
  statue: ['I’ve been standing still for a very long time.', 'I never blink, and the pigeons love my head.'],
  artwork: ['Someone made me to make you stop and look.', 'I’m not useful. I’m here to make you wonder.'],
  viewpoint: ['Stand on me and the whole place opens up.', 'Come for the view: I’m the best seat in town.'],
  ruins: ['I used to be whole. Now I’m more interesting.', 'Time took my roof but left my story.'],
  castle: ['Walls, gates and old quarrels: I’ve seen them all.', 'I was built to keep people out. Now I let everyone in.'],
  windmill: ['I worked with the wind long before it was fashionable.', 'My arms turn, but I never wave.'],
  spring: ['Water finds its own way out, right here.', 'I start small, and I never run dry.'],
};
const RIDDLE_ANY = ['I’m not on any postcard, but I’m worth finding.', 'I’ve been here all along. Have you noticed me?'];
export function riddleFor(poi, rand = Math.random) {
  const value = (poi.kind || '').split(':')[1] || '';
  const list = RIDDLE_KIND[value] || RIDDLE[groupOf(poi.kind, poi.cls)] || RIDDLE_ANY;
  return list[Math.floor(rand() * list.length)];
}

// words of a name that would give it away (generic words like "church" or "park" stay)
const GENERIC = new Set(('st saint the of and a an old new great little upper lower north south east west royal church chapel cathedral '
  + 'abbey park garden gardens street road lane house hall museum memorial statue fountain gate bridge tower square green common '
  + 'place court building centre center school college market hill river war').split(' '));
const escRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Blank out the distinctive words of `name` (and words starting with them) in `text`. */
export function redact(text, name) {
  let out = text || '';
  for (const w of (name || '').split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3 || GENERIC.has(w.toLowerCase())) continue;
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escRe(w)}[\\p{L}\\p{N}]*`, 'giu'), '…');
  }
  return out;
}
const art = (s) => (/^[aeiou]/i.test(s) ? 'an' : 'a');
const hasWords = (s) => /\p{L}{3,}/u.test((s || '').replace(/…/g, ''));
const useless = (s) => !s || /wikimedia|disambiguation|category|list of/i.test(s);

/** First-person fact sentences from Wikidata facts (src/data/wikidata.js), name blanked. */
export function factLines(f, name) {
  const out = {};
  const add = (key, label, text) => {
    // a fact that would have to be blanked out (it repeats the name) is left out, not shown half-empty
    if (!label || useless(label) || redact(label, name) !== label) return;
    out[key] = redact(text, name);
  };
  if (f?.namedAfter?.desc) add('namedAfter', f.namedAfter.desc, `I’m named after ${art(f.namedAfter.desc)} ${f.namedAfter.desc}.`);
  const maker = f?.architect ? ['designed', f.architect] : f?.creator ? ['made', f.creator] : null;
  if (maker) add('maker', maker[1].label, `${maker[1].label} ${maker[0]} me.`);
  if (f?.style) { const st = f.style.label.replace(/ architecture$/i, ''); add('style', st, `I was built in the ${st} style.`); }
  if (f?.heritage) add('heritage', f.heritage.label, `I’m ${art(f.heritage.label)} ${f.heritage.label}.`);
  if (f?.type) add('type', f.type.label, `I’m ${art(f.type.label)} ${f.type.label}.`);
  if (f?.religion) add('religion', f.religion.label, `My faith: ${f.religion.label}.`);
  if (f?.material) add('material', f.material.label, `I’m made of ${f.material.label}.`);
  return out;
}

/** A plaque's or bench's inscription (name blanked, one line) as the riddle's second line. */
export function inscriptionLine(poi) {
  const t = (poi.tags?.inscription || '').replace(/\s+/g, ' ').trim();
  if (t.length < 12) return null;
  const red = redact(t, poi.name);
  const cut = red.length > 160 ? `${red.slice(0, 157).replace(/\s+\S*$/, '')}…` : red;
  return hasWords(cut) ? `It reads: “${cut}”` : null;
}

/** The first sentence of an encyclopedia summary, name blanked, as a clue (or null). */
export function storyLine(extract, name) {
  // first sentence (summaries sometimes lack the space after a full stop: "London.Of medieval…")
  const first = (extract || '').split(/(?<=[\p{Ll})\]][.!?])\s*(?=\p{Lu})/u)[0].trim();
  if (first.length < 25) return null;
  const red = redact(first, name);
  const cut = red.length > 220 ? `${red.slice(0, 217).replace(/\s+\S*$/, '')}…` : red;
  return hasWords(cut) ? cut : null;
}

/**
 * Enrich a mystery with real facts: a specific second sentence for the riddle, its build
 * year (which enables the age guess and can raise the card's rarity), and better clues.
 * Clues are only rebuilt while none has been bought, so nothing already paid for changes.
 */
export function applyFacts(o, f, extract = null) {
  const lines = factLines(f || {}, o.place.name);
  if (f?.year && !o.place.year) {
    o.place.year = f.year;
    if (!o.startedAt) {
      const r = rarityOfPlace({ kind: o.place.kind, cls: o.place.cls, tags: { ...(o.place.tags || {}), start_date: String(f.year) } });
      if (RARITIES.indexOf(r) > RARITIES.indexOf(o.rarity)) o.rarity = r;
    }
  }
  const lead = ['namedAfter', 'maker', 'style', 'heritage'].find((k) => lines[k]);
  if (lead && !o.fact) o.fact = lines[lead]; // (an inscription, when there is one, stays)
  if (o.used.length) return o;
  const rest = ['type', 'heritage', 'maker', 'style', 'religion', 'material', 'namedAfter'].filter((k) => lines[k] && lines[k] !== o.fact);
  const keep = (k) => o.clues.find((c) => c.key === k);
  const clues = [];
  if (o.place.year) clues.push(keep('age') || { key: 'age', label: 'How old?', text: `I was built in ${eraText(o.place.year)}.` });
  clues.push(rest[0] ? { key: 'fact', label: 'What am I?', text: lines[rest[0]] } : keep('fact')
    || { key: 'fact', label: 'What am I?', text: `I’m ${art(human((o.place.kind || '').split(':')[1]) || 'place')} ${human((o.place.kind || '').split(':')[1]) || 'place'}.` });
  const story = storyLine(extract, o.place.name);
  if (story) clues.push({ key: 'story', label: 'Encyclopedia', text: `“${story}”` });
  else if (rest[1]) clues.push({ key: 'detail', label: 'A detail', text: lines[rest[1]] });
  clues.push(keep('name'), keep('zone'));
  o.clues = clues.filter(Boolean);
  return o;
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
export function makeMystery(pos, pois, discovered, rand = Math.random, avoid = new Set(), inside = (_p) => true, range = [120, 800]) {
  const cands = [];
  for (const p of pois) {
    if (!p.name || avoid.has(p.ref) || closedToPublic(p)) continue;
    const grp = groupOf(p.kind, p.cls);
    if (BUSINESS.has(grp)) continue;
    const d = haversine(pos.lat, pos.lon, p.lat, p.lon);
    if (d < range[0] || d > range[1] || !inside(p)) continue;
    cands.push({ p, d, grp, brg: bearingTo(pos, p) });
  }
  if (!cands.length) return null;
  for (const c of cands) {
    c.sector = sectorOf(c.brg);
    c.alike = cands.filter((o) => o.grp === c.grp && o.sector === c.sector).length;
    let s = rand() * 1.5;
    if (!discovered[c.p.ref]) s += 3;
    if (c.p.deep) s += 2; // the deep layer is the reward for knowing an area
    if (yearOf(c.p)) s += 3;
    if (c.p.tags?.wikidata || c.p.tags?.wikipedia) s += 2;
    if (c.p.tags?.heritage) s += 1.5;
    if (['history', 'worship', 'museum', 'sight', 'nature'].includes(c.grp) || isQuirk(c.p)) s += 1.5;
    if (c.alike >= 2 && c.alike <= 5) s += 1; // a little ambiguity makes it a puzzle
    if (c.d > range[0] + (range[1] - range[0]) * 0.75) s -= 1;
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
    riddle: riddleFor(poi, rand),
    sector: c.sector, dist: roundTo(c.d, 50), alike: c.alike,
    rarity: rarityOfPlace(poi),
    fact: inscriptionLine(poi),
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
export function makeBounty(pos, species, known, habitatAt, rand = Math.random, avoid = new Set(), inside = (_p) => true, plants = false) {
  const isPlant = (s) => ['Plantae', 'Fungi'].includes(s.group);
  const pool = species.filter((s) => (plants ? isPlant(s) : !isPlant(s)) && !avoid.has(s.id) && s.count >= 3);
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

// ---------------------------------------------------------------- bounty help as you go
// Where to look, by kind of animal and habitat (hand-written field craft, not data).
const LOOK = {
  Aves: { water: 'Scan the water’s edge, the reeds and any posts sticking out of the water.', wood: 'Listen first: woodland birds are heard long before they’re seen. Watch the branches at the edge of the trees.', park: 'Check lawns, hedges and treetops, then stand still for a minute and let them come back.', wetland: 'Scan reedbeds and muddy edges, moving slowly.', scrub: 'Watch the tops of bushes, where birds perch to sing.', farmland: 'Scan hedgerows and the edges of fields.', urban: 'Look along rooftops, ledges and street trees.' },
  Insecta: { any: 'Look on flowers in sunny, sheltered spots. Warm, still afternoons are best.' },
  Mammalia: { any: 'Most mammals are shy: try the edges of woods and hedges at dawn or dusk, and walk quietly.' },
  Amphibia: { any: 'Look near ponds and damp, shady ground, especially after rain.' },
  Reptilia: { any: 'Check sunny banks and warm stones on bright mornings.' },
  Actinopterygii: { any: 'Look into clear, slow water from a bank or a bridge.' },
  Mollusca: { any: 'Check damp stones, walls and the water’s edge.' },
  Arachnida: { any: 'Look in webs along hedges and fences, and in sheltered corners.' },
  Plantae: { any: 'Look along path edges, verges, walls and the margins of fields; flowers are easiest to spot in sun.' },
  Fungi: { any: 'Look at the base of trees, on dead wood and in leaf litter, especially after rain in autumn.' },
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Field notes for a bounty, from what's known about the species (pure).
 * @param {any} sp the wanted species
 * @param {{ summary?: string } | null} details iNaturalist taxon details
 * @param {number[] | null} months records per month near here (12 numbers)
 * @param {string} hab the habitat you're standing in
 * @param {number} month this month (0–11)
 */
export function fieldNotes(sp, details, months, hab, month) {
  const notes = [];
  const look = LOOK[sp.group]?.[hab] || LOOK[sp.group]?.any || 'Stop, listen and look for movement.';
  notes.push(`Where to look: ${look}`);
  if (months?.some((v) => v > 0)) {
    const max = Math.max(...months), top = months.map((v, i) => [v, i]).filter(([v]) => v >= max * 0.6).map(([, i]) => MONTHS[i]);
    const now = months[month] / max;
    notes.push(`When: most often recorded around here in ${top.slice(0, 3).join(', ')}. ${now >= 0.5 ? 'Now is a good time.' : now > 0 ? 'It’s recorded now, but less often.' : 'It’s rarely recorded at this time of year, so it may take patience.'}`);
  }
  const sum = (details?.summary || '').replace(/\s+/g, ' ').trim();
  if (sum) {
    const first = sum.split(/(?<=[.!?])\s+(?=[A-Z])/).slice(0, 2).join(' ');
    notes.push(`About it: ${first.length > 260 ? `${first.slice(0, 257).replace(/\s+\S*$/, '')}…` : first}`);
  }
  return notes;
}

// ---------------------------------------------------------------- New ground
export const GROUND_TARGET = 8; // ~150 m stretches (geohash-7 cells) never walked before
/** A "New ground" quest: walk stretches you've never walked, in any direction. */
export function makeGround(mode, area = null, left = null) {
  if (left != null && left < GROUND_TARGET) return null; // not enough unwalked ground left here
  return {
    type: 'ground', id: uid('g'), title: area ? `New ground in ${area}` : 'New ground', area,
    target: GROUND_TARGET, par: parTime(GROUND_TARGET * 150, mode), rarity: 'uncommon',
  };
}
// how many cells count as "walked" in this mode (Walk: on foot; Home: from home or on foot; Roam: any)
export function walkedCells(cells, mode) {
  const min = mode === 'present' ? 3 : mode === 'home' ? 2 : 1;
  let n = 0;
  for (const k in cells) if (cells[k] >= min) n++;
  return n;
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
/**
 * @param {(lat: number, lon: number) => ({lat: number, lon: number} | null)} [snap] the nearest
 *   point on a public way (null: nothing walkable near); finishes are never off the paths
 */
export function makeRace(pos, groundAt, pois, mode, sunsetMs, rand = Math.random, inside = (_p) => true, snap = (lat, lon) => ({ lat, lon }), { reach = 650, habitatAt = null } = {}) {
  const here = groundAt(pos.lat, pos.lon);
  let target = null, kind, gain = 0;
  if (here != null) {
    // the highest ground that a public path actually reaches
    const samples = [];
    const step = reach > 1000 ? 60 : 30;
    for (let e = -reach; e <= reach; e += step) for (let n = -reach; n <= reach; n += step) {
      const r = Math.hypot(e, n);
      if (r < 150 || r > reach) continue;
      const p = offsetGeo(pos.lat, pos.lon, e, n);
      if (!inside(p)) continue;
      const h = groundAt(p.lat, p.lon);
      if (h != null && h - here >= 6) samples.push({ ...p, h });
    }
    samples.sort((a, b) => b.h - a.h);
    for (const p of samples.slice(0, 60)) {
      const q = snap(p.lat, p.lon);
      const h = q && groundAt(q.lat, q.lon);
      const d = q && haversine(pos.lat, pos.lon, q.lat, q.lon);
      if (h != null && h - here >= 6 && d >= 150 && inside(q)) { target = { lat: q.lat, lon: q.lon, h, d }; break; }
    }
    if (target) { kind = 'summit'; gain = Math.round(target.h - here); }
  }
  if (!target) {
    const spots = [];
    for (const p of pois) {
      if (!p.name || closedToPublic(p)) continue;
      const d = haversine(pos.lat, pos.lon, p.lat, p.lon), grp = groupOf(p.kind, p.cls);
      if (d < 200 || d > reach + 100 || BUSINESS.has(grp) || !inside(p)) continue;
      spots.push(p);
    }
    const view = spots.filter((p) => /viewpoint|peak|tower|lighthouse/.test(p.kind || ''));
    const pickFrom = (list, k) => {
      for (let tries = 0; tries < 8 && list.length && !target; tries++) {
        const p = list[Math.floor(rand() * list.length)];
        const q = snap(p.lat, p.lon); // the finish line is on the path next to it
        if (q) { target = { lat: q.lat, lon: q.lon, name: p.name, d: haversine(pos.lat, pos.lon, q.lat, q.lon) }; kind = k; }
      }
    };
    pickFrom(view, 'viewpoint');
    // the water's edge: the nearest stream, pond, river or lake a public path reaches
    if (!target && habitatAt) {
      for (let r = 150; r <= reach && !target; r += 40) {
        const n = Math.max(8, Math.round(r / 25));
        for (let k = 0; k < n && !target; k++) {
          const a = (k / n) * Math.PI * 2, p = offsetGeo(pos.lat, pos.lon, Math.sin(a) * r, Math.cos(a) * r);
          if (habitatAt(p.lat, p.lon) !== 'water' || !inside(p)) continue;
          const q = snap(p.lat, p.lon);
          if (q) { target = { lat: q.lat, lon: q.lon, name: 'the water’s edge', d: haversine(pos.lat, pos.lon, q.lat, q.lon) }; kind = 'water'; }
        }
      }
    }
    pickFrom(spots, 'dash');
    if (!target) return null;
  }
  const par = parTime(target.d, mode);
  // the real sunset as the clock, if it's close and reachable
  const sunset = sunsetMs != null && sunsetMs > par * 1000 * 1.1 && sunsetMs < 100 * 60000;
  const name = target.name || null;
  const title = sunset ? (kind === 'summit' ? 'Beat the sunset to the high ground' : `Beat the sunset to ${name}`)
    : kind === 'summit' ? 'Summit sprint' : kind === 'viewpoint' ? `Race to the view: ${name}` : kind === 'water' ? 'Race to the water’s edge' : `Dash to ${name}`;
  return {
    type: 'race', id: uid('r'),
    title, kind, name, lat: target.lat, lon: target.lon, dist: roundTo(target.d, 10), gain,
    par, sunset, sunsetAt: sunset ? Date.now() + sunsetMs : null,
    rarity: rarityOfRace(gain, sunset),
  };
}

// ---------------------------------------------------------------- the live state
const TYPES = ['mystery', 'bounty', 'race'];
export const MYSTERY_WARM_M = 150, MYSTERY_HOT_M = 60; // closeness signals for a mystery
const REDEAL_M = 1500;          // walk/roam this far from where the board was dealt and it re-deals
const FILL_FALLBACK_S = 25;     // a slot that can't be filled (no wildlife data…) becomes another type
const EMPTY_AFTER_S = 60;       // still nothing at all: say honestly that little is mapped here
// what a slot tries next when its own kind can't be dealt here (always ending somewhere playable)
const FALLBACK = { mystery: ['race', 'ground'], bounty: ['ground', 'race'], race: ['ground', 'mystery'] };

export class Quests {
  /** @param {any} game  the Game (world, profile, env, pos, mode, wild) */
  constructor(game, onEvent) {
    this.game = game;
    this.onEvent = onEvent || (() => {});
    this._fillT = 0;
    this._tries = 0;
    this._wrong = new Set();
    // where real facts come from (swappable in tests)
    this.lookup = { facts: placeFacts, summary: wikiSummary, taxon: taxonDetails, season: seasonality, sightings: lastSightings };
    this.tidy();
  }

  // Add real facts to a mystery once (Wikidata + its encyclopedia entry), in the background.
  async enrich(o) {
    const tags = o.place?.tags;
    if (o.enriched || this.game.dataSaver || !tags || (!tags.wikidata && !tags.wikipedia)) return;
    o.enriched = true;
    try {
      const [facts, sum] = await Promise.all([
        tags.wikidata ? this.lookup.facts(tags.wikidata).catch(() => null) : null,
        this.lookup.summary(tags).catch(() => null),
      ]);
      if (!facts && !sum?.extract) return;
      applyFacts(o, facts, sum?.extract || null);
      this.profile.save();
      this.emit('quest-dealt', null);
    } catch { /* the plain riddle stands */ }
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
    for (const o of this.ensure().offers) if (o) { delete o.pending; delete o.live; delete o.band; }
    this._wrong.clear();
  }
  date() { return this.game.env.localNow().toISOString().slice(0, 10); }
  stars() { return this.s.cards.reduce((a, c) => a + cardPoints(c), 0); }
  rank() { return rankOf(this.stars()); }
  active() { return this.s.offers.find((o) => o && o.id === this.s.active) || null; }

  // Places and finish lines players told us they couldn't reach (never offered again)
  isBlocked(p) {
    return (this.s.blocked || []).some((b) => (b.ref && b.ref === p.ref) || haversine(b.lat, b.lon, p.lat, p.lon) < 60);
  }
  // Swap the active quest for another of the same kind, with no penalty, and remember the spot.
  cantReach() {
    const s = this.s, o = this.active();
    if (!o || (o.type !== 'mystery' && o.type !== 'race')) return null;
    (s.blocked ||= []).push({ ref: o.ref || null, lat: +o.lat.toFixed(5), lon: +o.lon.toFixed(5) });
    if (s.blocked.length > 300) s.blocked.splice(0, s.blocked.length - 300);
    const i = s.offers.indexOf(o);
    s.active = null;
    s.offers[i] = this.make(o.type) || null; // null: refilled when something fits
    this.profile.log(`Couldn't reach: ${o.title}${o.place?.name ? ` (${o.place.name})` : ''}`);
    this.profile.save();
    this.emit('quest-info', 'Thanks. We won’t send you there again. Here’s a fresh one instead, no stars lost.');
    return s.offers[i];
  }

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
    if (!this.reachable(o)) return `Outside your home range. Play it in ${WALK}, or in Roam as an echo.`;
    return null;
  }
  // today's progress: cards won and (real) stars earned
  today() {
    const d = this.date(), cs = this.s.cards.filter((c) => c.date === d);
    return { done: cs.length, stars: cs.reduce((a, c) => a + cardPoints(c), 0) };
  }

  /** @param {'' | 'move'} [why] 'move': re-dealt for a new area (keeps today's swap) */
  deal(why = '') {
    const s = this.ensure(), keep = this.active();
    s.date = this.date();
    s.mode = this.game.mode;
    s.origin = { lat: this.game.pos.lat, lon: this.game.pos.lon };
    const at = keep ? s.offers.findIndex((o) => o && o.id === keep.id) : -1; // the active quest keeps its slot
    s.offers = TYPES.map((_, i) => (i === at ? keep : null));
    if (why !== 'move') s.swaps = 1;
    this._tries = 0;
    this._fillT = 0;
    this.profile.save();
  }

  /** Nothing could be dealt for a while: little is mapped around here (the board says so). */
  empty() { return this._tries * 2 > EMPTY_AFTER_S && this.s.offers.some((o) => !o); }

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
    const longer = (o) => { o.long = true; o.rarity = RARITIES[Math.min(4, RARITIES.indexOf(o.rarity) + 1)]; };
    const g = this.game, pos = g.pos, w = g.world;
    const pois = [...w.pois(pos.lat, pos.lon, 900)].map((x) => x.poi);
    for (const o of this.s.offers) if (o?.ref) avoid.add(o.ref);
    const inside = (p) => this.inside(p) && !this.isBlocked(p);
    // finish lines on public ways (where the map has path data; elsewhere the point stands)
    const snap = (lat, lon) => { const n = nearestPath(w, lat, lon, 60); return !n.known ? { lat, lon } : n.d <= 60 ? { lat: n.lat, lon: n.lon } : null; };
    const near = (p) => inside(p) && walkableTo(w, p);
    if (type === 'mystery') {
      // nearby first; if nothing fits, a long expedition further out (rarer, it's a real walk)
      let m = makeMystery(pos, pois, this.profile.data.discoveries, Math.random, avoid, near);
      if (!m) { m = makeMystery(pos, [...w.pois(pos.lat, pos.lon, 2600)].map((x) => x.poi), this.profile.data.discoveries, Math.random, avoid, near, [800, 2500]); if (m) longer(m); }
      if (m) this.enrich(m);
      return m;
    }
    if (type === 'bounty') {
      if (!g.wild.species.length) return null;
      const bounty = (plants) => makeBounty(pos, g.wild.species, this.profile.data.species || {}, (a, b) => w.habitatAt(a, b), Math.random, avoid, inside, plants);
      return bounty(false) || bounty(true); // animals first, then plants and fungi
    }
    if (type === 'race') {
      const ss = sunsetIn((t) => g.env.sun(pos.lat, pos.lon, new Date(t)).alt);
      const habitatAt = (a, b) => w.habitatAt(a, b);
      let r = makeRace(pos, (a, b) => w.groundAt(a, b), pois, g.mode, ss, Math.random, inside, snap, { habitatAt });
      if (!r) { r = makeRace(pos, (a, b) => w.groundAt(a, b), [...w.pois(pos.lat, pos.lon, 1900)].map((x) => x.poi), g.mode, ss, Math.random, inside, snap, { reach: 1800, habitatAt }); if (r) longer(r); }
      return r;
    }
    if (type === 'ground') {
      if (this.s.offers.some((o) => o?.type === 'ground' && !o.done)) return null; // one at a time
      const ch = w.chunkAt?.(pos.lat, pos.lon), a = ch && this.profile.data.areas?.[ch.key];
      const done = g.mode === 'present' ? a?.foot : a?.home;
      return makeGround(g.mode, a?.name || ch?.areaName || null, a?.walk ? a.walk - (done || 0) : null);
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
    if (o.type === 'ground') { o.base = walkedCells(this.profile.data.cells || {}, g.mode); o.prog = 0; }
    o.from = { lat: +pos.lat.toFixed(5), lon: +pos.lon.toFixed(5) };
    s.active = o.id;
    // a race's clock starts when you head off (startClock), not while you read the card
    o.startedAt = o.type === 'race' ? null : Date.now();
    this._wrong.clear();
    this.profile.log(`Expedition started: ${o.title}`);
    this.profile.save();
    this.emit('quest-start', null, { quest: o });
    return o;
  }
  // Start a race's clock (when the board closes after accepting). Returns true if it started.
  startClock() {
    const o = this.active();
    if (!o || o.type !== 'race' || o.startedAt) return false;
    o.startedAt = Date.now();
    this.profile.save();
    this.emit('quest-clock', null, { quest: o });
    return true;
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
    if (a && !this.reachable(a)) this.emit('quest-info', `Your expedition’s goal is outside your home range. Finish it in ${WALK}, or in Roam as an echo.`);
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
      // getting close: warm (~150 m) then hot (~60 m); never a direction, so it's still a puzzle
      const band = d <= MYSTERY_HOT_M ? 'hot' : d <= MYSTERY_WARM_M ? 'warm' : null;
      if (band !== o.band) {
        const closer = band === 'hot' || (band === 'warm' && !o.band);
        o.band = band;
        if (closer) this.emit('quest-warm', null, { quest: o, band });
      }
      // the wrong place: a nudge, not a penalty
      for (const { poi } of g.world.pois(g.pos.lat, g.pos.lon, 60)) {
        if (poi.ref === o.ref || this._wrong.has(poi.ref) || groupOf(poi.kind, poi.cls) !== o.group) continue;
        if (haversine(g.pos.lat, g.pos.lon, poi.lat, poi.lon) > this.reach()) continue;
        this._wrong.add(poi.ref);
        const dd = haversine(poi.lat, poi.lon, o.lat, o.lon);
        this.emit('quest-wrong', `Not me! Look about ${roundTo(dd, 50)} m ${sectorOf(bearingTo(poi, o))} of ${poi.name}.`);
      }
    } else if (o.type === 'ground') {
      if (Date.now() - (this._groundT || 0) > 1500) {
        this._groundT = Date.now();
        const prog = Math.max(0, walkedCells(this.profile.data.cells || {}, g.mode) - (o.base ?? 0));
        if (prog !== o.prog) { o.prog = prog; this.profile.save(); if (prog < o.target) this.emit('quest-ground', null, { quest: o }); }
        if (prog >= o.target) this.complete(o);
      }
    } else if (o.type === 'bounty') {
      if (!o.inHabitat) {
        const hab = wildHabitat(g.world.habitatAt(g.pos.lat, g.pos.lon));
        const there = o.habitat ? hab === o.habitat.hab : hab !== 'urban' && fitsHabitat(o.sp.group, hab, false);
        if (there || (o.habitat && haversine(g.pos.lat, g.pos.lon, o.habitat.lat, o.habitat.lon) < 40)) {
          o.inHabitat = true;
          this.profile.save();
          this.emit('quest-habitat', null, { quest: o });
          this.notes(o, hab);
        }
      }
    } else if (o.type === 'race') {
      // the clock starts on leaving the board; and in any case once you've set off
      if (!o.startedAt && o.from && haversine(g.pos.lat, g.pos.lon, o.from.lat, o.from.lon) > 15) this.startClock();
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
    for (const o of s.offers) if (o?.type === 'mystery' && !o.done && !o.enriched) this.enrich(o); // offers dealt before facts existed
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
      if (!q && this._tries * 2 > FILL_FALLBACK_S) for (const t of FALLBACK[TYPES[i]]) { q = this.make(t); if (q) break; }
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

  // Field notes for a bounty once you're in its habitat (free): where to look, when, what it is.
  async notes(o, hab) {
    if (o.notes) return;
    const g = this.game, pos = g.pos;
    const [details, months] = g.dataSaver ? [null, null] : await Promise.all([
      this.lookup.taxon(o.sp.id).catch(() => null),
      this.lookup.season(o.sp.id, pos.lat, pos.lon).catch(() => null),
    ]);
    o.notes = fieldNotes(o.sp, details, months, hab, g.env.localNow().getUTCMonth());
    this.profile.save();
    this.emit('quest-dealt', null);
  }
  // The latest public record of the bounty nearby (a clue: costs a star; free if there's none).
  async buySighting() {
    const o = this.bounty(), g = this.game;
    if (!o || o.sighting || g.dataSaver) return null;
    const list = await this.lookup.sightings(o.sp.id, g.pos.lat, g.pos.lon).catch(() => []);
    if (!list?.length) { this.emit('quest-info', 'No exact recent records of it are shared near here. Keep to its habitat and watch for signs.'); return null; }
    const best = list[0];
    const d = haversine(g.pos.lat, g.pos.lon, best.lat, best.lon);
    o.sighting = { lat: best.lat, lon: best.lon, date: best.date, d: roundTo(d, 10), sector: sectorOf(bearingTo(g.pos, best)) };
    (o.used ||= []).push('sighting');
    this.profile.save();
    this.emit('quest-dealt', null);
    return o.sighting;
  }

  // game hooks
  bounty() { const o = this.active(); return o?.type === 'bounty' ? o : null; }
  onFlee(sp) { const o = this.bounty(); if (o && o.sp.id === sp.id) { o.fled++; this.profile.save(); } }
  onSpecies(sp, how) { const o = this.bounty(); if (o && o.sp.id === sp.id) this.complete(o, { photo: how === 'photo' }); }

  starsFor(o, secs) {
    if (o.type === 'mystery') return Math.min(3, Math.max(1, 3 - o.used.length) + (o.guessRight ? 1 : 0));
    if (o.type === 'bounty') return Math.max(1, 3 - o.fled - (o.used?.length || 0));
    if (o.type === 'ground') return secs <= o.par ? 3 : secs <= o.par * 1.5 ? 2 : 1;
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
      ...(o.type === 'ground' ? { name: o.area ? `New ground in ${o.area}` : 'New ground', target: o.target, par: o.par } : {}),
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
    o.misses = (o.misses || 0) + 1;
    return { chance: 0.9, sp: o.sp, pick: Math.min(0.95, 0.55 + 0.1 * o.misses) };
  }
}

// next card type for the board header: all offers done today?
export function allDone(s) { return s.offers.every((o) => o?.done); }
