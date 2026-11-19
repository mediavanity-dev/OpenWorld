// Wikipedia summaries for places tagged with wikipedia=* or wikidata=* in OSM.
// Fetched only when the player opens a place card.

import { tryJson } from './net.js';
import { cachedJson } from './cache.js';

const memo = new Map();
// the game is in English: summaries in English first (place cards and riddle clues alike)
const LANG = 'en';

function json(url) {
  return tryJson(url, { init: { headers: { 'Api-User-Agent': 'OpenWorld-game (github.com/mediavanity-dev/OpenWorld)' } } });
}

async function titleFromWikidata(q) {
  const j = await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(q)}&props=sitelinks&format=json&origin=*`);
  const links = j?.entities?.[q]?.sitelinks || {};
  for (const lang of [LANG, 'en']) if (links[`${lang}wiki`]) return { lang, title: links[`${lang}wiki`].title };
  const any = Object.keys(links).find((k) => /^[a-z]{2,3}wiki$/.test(k));
  return any ? { lang: any.replace(/wiki$/, ''), title: links[any].title } : null;
}

export async function wikiSummary(tags) {
  if (!tags) return null;
  const key = tags.wikipedia || tags.wikidata;
  if (!key) return null;
  if (memo.has(key)) return memo.get(key);
  const p = (async () => {
    try {
      let target = null;
      if (tags.wikipedia) {
        const m = /^([a-z-]{2,12}):(.+)$/.exec(tags.wikipedia);
        if (m) target = { lang: m[1], title: m[2] };
      }
      if (!target && tags.wikidata) target = await titleFromWikidata(tags.wikidata);
      if (!target) return null;
      const s = await json(`https://${target.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(target.title.replace(/ /g, '_'))}`);
      if (!s || s.type === 'disambiguation') return null;
      return {
        title: s.title,
        extract: s.extract,
        // only freely licensed images (Wikimedia Commons); skips local "fair use" files
        thumb: s.thumbnail?.source && s.thumbnail.source.includes('/wikipedia/commons/') ? s.thumbnail.source : null,
        url: s.content_urls?.desktop?.page || `https://${target.lang}.wikipedia.org/wiki/${encodeURIComponent(target.title)}`,
      };
    } catch { return null; }
  })();
  memo.set(key, p);
  return p;
}

// ---------- a place's article, found by its name near where it is (no OSM wikipedia/wikidata tag needed)
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/\s*\(.*?\)\s*/g, ' ').replace(/,.*$/, '').replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Does an article title name this place? (exact, or one starts with the other and is long enough) */
export function titleMatches(title, names) {
  const t = norm(title);
  return names.filter(Boolean).map(norm).some((n) => n.length >= 3 && (t === n || (n.length >= 6 && (t.startsWith(`${n} `) || n.startsWith(`${t} `) && t.length >= 6))));
}
/**
 * The English Wikipedia article about a named place within ~150 m, and its Wikidata id:
 * { title, qid } or null. One geosearch per place, cached for 30 days.
 * @param {string[]} names  its names (local, English)
 */
export async function findArticle(names, lat, lon) {
  if (!names.some(Boolean)) return null;
  const j = await cachedJson(`wfind:${lat.toFixed(4)},${lon.toFixed(4)}`,
    `https://en.wikipedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lat.toFixed(5)}|${lon.toFixed(5)}&ggsradius=150&ggslimit=20&prop=pageprops|coordinates&ppprop=wikibase_item&format=json&origin=*`,
    { ttl: 30 * 864e5, timeout: 10000 });
  const pages = Object.values(j?.query?.pages || {}).filter((pg) => titleMatches(pg.title, names));
  if (!pages.length) return null;
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)); // geosearch order: nearest first
  const pg = pages[0];
  return { title: pg.title, qid: pg.pageprops?.wikibase_item || null };
}

