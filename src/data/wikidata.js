// @ts-check
// Facts about a place from Wikidata (open data, CC0), for expedition riddles: what it is,
// when it was built, who designed or made it, what it's named after, its style and its
// heritage listing. Two small requests per place (its statements, then the labels of the
// things they point to), cached for 30 days. Fetched only for places tagged wikidata=* in OSM.

import { cachedJson } from './cache.js';

const API = 'https://www.wikidata.org/w/api.php';
const LANG = (typeof navigator !== 'undefined' && navigator.language || 'en').slice(0, 2).toLowerCase();
const TTL = 30 * 864e5;

// the statements we use, and what they mean for a place
export const PROPS = {
  P31: 'type', P571: 'inception', P1619: 'opened', P84: 'architect', P170: 'creator',
  P138: 'namedAfter', P149: 'style', P1435: 'heritage', P140: 'religion', P186: 'material',
};

const value = (claim) => claim?.mainsnak?.datavalue?.value;
// preferred statements first, deprecated ones never
function claimsOf(entity, p) {
  const cs = (entity?.claims?.[p] || []).filter((c) => c.rank !== 'deprecated');
  return cs.sort((a, b) => (b.rank === 'preferred' ? 1 : 0) - (a.rank === 'preferred' ? 1 : 0));
}
function yearOf(claim) {
  const t = value(claim)?.time; // "+1712-00-00T00:00:00Z"
  const m = /^([+-])(\d{1,4})-/.exec(t || '');
  if (!m || m[1] === '-') return null;
  const y = +m[2];
  return y > 0 && y <= new Date().getFullYear() ? y : null;
}

/** The ids of the items a place's statements point to (to fetch their labels in one go). */
export function referencedIds(entity) {
  const ids = new Set();
  for (const p of Object.keys(PROPS)) for (const c of claimsOf(entity, p).slice(0, 2)) { const id = value(c)?.id; if (id) ids.add(id); }
  return [...ids];
}

/**
 * Plain facts from a place's Wikidata entity, given the labels/descriptions of what it points to.
 * Pure (testable). Each fact: { label, desc } for items, or a year.
 * @param {any} entity
 * @param {Record<string, { label?: string, desc?: string }>} refs
 */
export function factsFrom(entity, refs) {
  const item = (p) => {
    for (const c of claimsOf(entity, p)) {
      const r = refs[value(c)?.id];
      if (r?.label) return { label: r.label, desc: r.desc || null };
    }
    return null;
  };
  return {
    year: yearOf(claimsOf(entity, 'P571')[0]) || yearOf(claimsOf(entity, 'P1619')[0]),
    type: item('P31'), architect: item('P84'), creator: item('P170'), namedAfter: item('P138'),
    style: item('P149'), heritage: item('P1435'), religion: item('P140'), material: item('P186'),
  };
}

const pick = (o, lang) => o?.[lang]?.value || o?.en?.value || null;

/** Facts for a Wikidata id (e.g. "Q1234"), or null if unavailable. */
export async function placeFacts(qid) {
  if (!/^Q\d+$/.test(qid || '')) return null;
  const opts = { ttl: TTL, timeout: 8000 };
  const j = await cachedJson(`wd:${qid}`, `${API}?action=wbgetentities&ids=${qid}&props=claims&format=json&origin=*`, opts);
  const entity = j?.entities?.[qid];
  if (!entity?.claims) return null;
  const ids = referencedIds(entity).slice(0, 40);
  const refs = {};
  if (ids.length) {
    const langs = [...new Set([LANG, 'en'])].join('|');
    const r = await cachedJson(`wdl:${ids.join(',')}:${LANG}`, `${API}?action=wbgetentities&ids=${ids.join('|')}&props=labels|descriptions&languages=${langs}&format=json&origin=*`, opts);
    for (const [id, e] of Object.entries(r?.entities || {})) refs[id] = { label: pick(/** @type {any} */ (e).labels, LANG), desc: pick(/** @type {any} */ (e).descriptions, LANG) };
  }
  return factsFrom(entity, refs);
}
