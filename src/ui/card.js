// Bottom-sheet card for a place or a species.

import { wikiSummary } from '../data/wiki.js';
import { GROUP_STYLE } from '../data/wildlife.js';
import { TAG_ICONS } from '../game/environment.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
const GRADE_TEXT = { present: 'Claimed', home: 'Found from home', echo: 'Echo (seen virtually)' };
let closeTimer = null;
let current = null;

export function initCard() {
  $('card-close').onclick = closeCard;
  $('card').addEventListener('pointerdown', () => clearTimeout(closeTimer));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCard(); });
}
export function closeCard() { $('card').hidden = true; current = null; }
export function cardOpenFor() { return current; }

function builtText(start, localNow) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(start || '');
  if (!m) return start ? `Built: ${esc(start)}` : null;
  const year = +m[1], age = localNow.getUTCFullYear() - year;
  let s = `Built ${year} · ${age} years old`;
  if (m[2] && m[3] && +m[2] === localNow.getUTCMonth() + 1 && +m[3] === localNow.getUTCDate()) s += ' · 🎂 anniversary today!';
  return s;
}

export function showPlace(poi, { game, profile, distance }) {
  current = poi.ref;
  clearTimeout(closeTimer);
  const d = profile.data.discoveries[poi.ref];
  const st = game.openState(poi);
  const [cls, sub] = poi.kind.split(':');
  const chips = [];
  if (d) chips.push(`<span class="chip grade-${d.grade}">${GRADE_TEXT[d.grade]}</span>`);
  else chips.push('<span class="chip">Not discovered yet</span>');
  if (st) chips.push(st.open ? '<span class="chip open">Open now</span>' : `<span class="chip closed">Closed${st.next ? ` · opens ${esc(st.next)}` : ''}</span>`);
  if (poi.tags?.heritage) chips.push('<span class="chip">Heritage listed</span>');
  for (const t of d?.seen || []) chips.push(`<span class="chip" title="${esc(t)}">${TAG_ICONS[t] || ''} ${esc(t)}</span>`);
  const built = builtText(poi.tags?.start_date, game.env.localNow());
  const lines = [];
  if (built) lines.push(`<p>${built}</p>`);
  if (poi.tags?.opening_hours) lines.push(`<p class="credit">Hours: ${esc(poi.tags.opening_hours)}</p>`);
  if (poi.tags?.cuisine) lines.push(`<p class="credit">Cuisine: ${esc(poi.tags.cuisine.replace(/;/g, ', '))}</p>`);
  if (d?.conditions) {
    const c = d.conditions;
    lines.push(`<p class="credit">When you ${d.grade === 'echo' ? 'saw' : 'found'} it: ${esc([c.local, c.sun, c.weather, c.tempC != null ? c.tempC + '°C' : null, c.season, c.holiday].filter(Boolean).join(' · '))}</p>`);
  }
  const osmUrl = `https://www.openstreetmap.org/${poi.ref.replace('osm:', '')}`;
  $('card-body').innerHTML = `
    <h3>${esc(poi.name)}</h3>
    <div class="kind">${esc((sub || cls).replace(/_/g, ' '))} · ${Math.round(distance)} m away</div>
    <div class="chips">${chips.join('')}</div>
    ${lines.join('')}
    <div id="card-wiki"></div>
    <p class="credit"><a href="${osmUrl}" target="_blank" rel="noopener">View on OpenStreetMap</a>${safeUrl(poi.tags?.website) ? ` · <a href="${esc(safeUrl(poi.tags.website))}" target="_blank" rel="noopener nofollow">Website</a>` : ''}</p>`;
  $('card').hidden = false;
  if (poi.tags?.wikipedia || poi.tags?.wikidata) {
    $('card-wiki').innerHTML = '<p class="credit">Loading Wikipedia…</p>';
    wikiSummary(poi.tags).then((w) => {
      if (current !== poi.ref) return;
      $('card-wiki').innerHTML = w
        ? `<div class="wiki">${safeUrl(w.thumb) ? `<img src="${esc(w.thumb)}" alt="" loading="lazy" />` : ''}<div>${esc(w.extract.length > 420 ? w.extract.slice(0, 400) + '…' : w.extract)} <a href="${esc(w.url)}" target="_blank" rel="noopener">Wikipedia</a></div></div>`
        : '';
    });
  }
}

export function showSpecies(sp, { result, grade, autoClose = 0 } = {}) {
  current = 'sp:' + sp.id;
  clearTimeout(closeTimer);
  const style = GROUP_STYLE[sp.group] || { label: 'creature' };
  const title = result === 'new' ? 'New species!' : result === 'upgraded' ? 'Sighting upgraded' : result ? 'Spotted again' : '';
  $('card-body').innerHTML = `
    ${sp.photo ? `<img class="photo" src="${esc(sp.photo.replace('square', 'medium'))}" alt="${esc(sp.name)}" />` : ''}
    <h3>${esc(sp.name)}</h3>
    <div class="kind">${esc(style.label)} · <i>${esc(sp.sci)}</i></div>
    <div class="chips">${title ? `<span class="chip grade-${grade}">${title}</span>` : ''}${grade ? `<span class="chip">${GRADE_TEXT[grade]}</span>` : ''}</div>
    <p class="credit">Observed ${sp.count} times around here by iNaturalist naturalists. ${sp.credit ? 'Photo ' + esc(sp.credit) : ''}</p>
    <p class="credit"><a href="https://www.inaturalist.org/taxa/${sp.id}" target="_blank" rel="noopener">More on iNaturalist</a></p>`;
  $('card').hidden = false;
  if (autoClose) closeTimer = setTimeout(closeCard, autoClose);
}
