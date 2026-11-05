// Geocaches from the Opencaching network (OKAPI, open API, read-only Level 1 with a free
// consumer key per regional site). Each map area asks the site(s) that cover its country.
// Listings are shown as published, with the site's attribution, and link to the original.

import { OKAPI_KEYS } from '../config.js';
import { cacheGet, cachePut } from './cache.js';
import { tryJson } from './net.js';

export const NODES = {
  de: { base: 'https://www.opencaching.de/okapi/', name: 'Opencaching.de', countries: ['DE', 'AT', 'CH', 'LI', 'IT', 'FR', 'ES', 'DK'] },
  pl: { base: 'https://opencaching.pl/okapi/', name: 'Opencaching.pl', countries: ['PL'] },
  nl: { base: 'https://www.opencaching.nl/okapi/', name: 'Opencaching.nl', countries: ['NL', 'BE', 'LU'] },
  ro: { base: 'https://www.opencaching.ro/okapi/', name: 'Opencaching.ro', countries: ['RO', 'MD'] },
  uk: { base: 'https://opencache.uk/okapi/', name: 'Opencache.uk', countries: ['GB', 'IE', 'IM', 'JE', 'GG'] },
  us: { base: 'https://www.opencaching.us/okapi/', name: 'Opencaching.us', countries: ['US', 'CA'] },
};

const configured = () => Object.keys(NODES).filter((k) => (OKAPI_KEYS[k] || '').trim());
export const geocachingConfigured = () => configured().length > 0;

// Which sites to ask for an area: the one(s) for its country, else every configured site
// (caches abroad are often listed on opencaching.de).
export function nodesFor(country) {
  const all = configured();
  const hit = country ? all.filter((k) => NODES[k].countries.includes(country)) : [];
  return hit.length ? hit : all;
}

const FIELDS = 'code|name|location|type|status|url|owner|size2|difficulty|terrain|short_description|hint2|last_found|founds|date_hidden|attribution_note';

export function normalizeCache(c, node) {
  const [lat, lon] = String(c.location || '').split(/[|\s,]+/).map(Number); // "lat|lon"
  if (!isFinite(lat) || !isFinite(lon) || !c.code) return null;
  const type = String(c.type || 'Other');
  return {
    ref: `oc:${c.code}`, lat, lon, name: c.name || c.code,
    kind: `geocache:${type.toLowerCase().replace(/[^a-z]+/g, '_')}`, cls: 'geocache', rank: 40,
    gc: {
      code: c.code, node, site: NODES[node]?.name || 'Opencaching', type,
      // the listed point is the final spot only for single-stage caches
      startOnly: !/^(traditional|virtual|webcam|drive-in|event)$/i.test(type),
      size: c.size2 || null, difficulty: c.difficulty ?? null, terrain: c.terrain ?? null,
      status: c.status || 'Available', url: /^https?:\/\//.test(c.url || '') ? c.url : null,
      owner: c.owner?.username || null, tagline: (c.short_description || '').slice(0, 200),
      hint: (c.hint2 || '').slice(0, 400), lastFound: c.last_found || null, founds: c.founds ?? null,
      hidden: c.date_hidden || null,
      attribution: String(c.attribution_note || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim().slice(0, 300),
    },
  };
}

// Available caches inside a bounding box, from one site; cached 12 h per area and site.
export async function cachesIn(bounds, node, areaKey) {
  const key = `oc:v1:${node}:${areaKey}`;
  const hit = await cacheGet(key, 12 * 3600 * 1000);
  if (hit) return hit;
  const n = NODES[node], ck = (OKAPI_KEYS[node] || '').trim();
  if (!n || !ck) return [];
  const params = new URLSearchParams({
    search_method: 'services/caches/search/bbox',
    search_params: JSON.stringify({ bbox: `${bounds.s.toFixed(5)}|${bounds.w.toFixed(5)}|${bounds.n.toFixed(5)}|${bounds.e.toFixed(5)}`, status: 'Available', limit: '200' }),
    retr_method: 'services/caches/geocaches',
    retr_params: JSON.stringify({ fields: FIELDS, attribution_append: 'none', owner_fields: 'username' }),
    wrap: 'false',
    consumer_key: ck,
  });
  try {
    const j = await tryJson(`${n.base}services/caches/shortcuts/search_and_retrieve?${params}`, { service: 'geocaches' });
    if (!j) return [];
    const list = Object.values(j || {}).map((c) => normalizeCache(c, node)).filter(Boolean);
    cachePut(key, list);
    return list;
  } catch { return []; }
}

export function sizeLabel(s) {
  return { none: 'no container', nano: 'nano', micro: 'micro', small: 'small', regular: 'regular', large: 'large', xlarge: 'extra large', other: 'other size' }[s] || null;
}
