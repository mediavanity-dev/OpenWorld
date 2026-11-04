// Wikipedia summaries for places tagged with wikipedia=* or wikidata=* in OSM.
// Fetched only when the player opens a place card.

const memo = new Map();
const LANG = (navigator.language || 'en').slice(0, 2).toLowerCase();

async function json(url) {
  const r = await fetch(url, { headers: { 'Api-User-Agent': 'OpenWorld-game (github.com/mediavanity-dev/OpenWorld)' } });
  return r.ok ? r.json() : null;
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
        thumb: s.thumbnail?.source || null,
        url: s.content_urls?.desktop?.page || `https://${target.lang}.wikipedia.org/wiki/${encodeURIComponent(target.title)}`,
      };
    } catch { return null; }
  })();
  memo.set(key, p);
  return p;
}
