// Bottom-sheet card for a place or a species.

import { wikiSummary } from '../data/wiki.js';
import { GROUP_STYLE } from '../data/wildlife.js';
import { TAG_ICONS } from '../game/environment.js';
import { taxonDetails, seasonality, skyNotes, climateToday, wikiNearby, quakesNear, rockAt, ageText } from '../data/science.js';
import { fmtDist, fmtElev, fmtTemp, fmtTempDelta } from '../units.js';
import { groupInfo, iconIndex, atlasCss } from '../world/icons.js';

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
  if (poi.tags?.species) lines.push(`<p class="credit">Species: ${esc(poi.tags.species)}${poi.tags.height ? ` · ${esc(poi.tags.height)} m tall` : ''}${poi.tags.circumference ? ` · ${esc(poi.tags.circumference)} m round` : ''}</p>`);
  if (poi.tags?.cuisine) lines.push(`<p class="credit">Cuisine: ${esc(poi.tags.cuisine.replace(/;/g, ', '))}</p>`);
  if (d?.conditions) {
    const c = d.conditions;
    lines.push(`<p class="credit">When you ${d.grade === 'echo' ? 'saw' : 'found'} it: ${esc([c.local, c.sun, c.weather, c.tempC != null ? c.tempC + '°C' : null, c.season, c.holiday].filter(Boolean).join(' · '))}</p>`);
  }
  const osmUrl = `https://www.openstreetmap.org/${poi.ref.replace('osm:', '')}`;
  $('card-body').innerHTML = `
    <h3><i class="ico" style="${atlasCss(iconIndex(poi.kind, poi.cls), 26)}"></i>${esc(poi.name)}</h3>
    <div class="kind">${esc(groupInfo(poi.kind, poi.cls).label)} · ${esc((sub || cls).replace(/_/g, ' '))} · ${fmtDist(distance)} away</div>
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

const MONTHS = 'JFMAMJJASOND';
const RARITY_TEXT = { rare: 'Rare here', uncommon: 'Uncommon here', common: 'Common here' };

// sp: { id, name, sci, group, count?, photo?, credit?, rarity? }   pos: where (for seasonality)
export function showSpecies(sp, { result, grade, autoClose = 0, pos = null } = {}) {
  current = 'sp:' + sp.id;
  clearTimeout(closeTimer);
  const style = GROUP_STYLE[sp.group] || { label: 'creature', color: '#5fd08a' };
  const title = result === 'new' ? 'New species!' : result === 'upgraded' ? 'Sighting upgraded' : result ? 'Spotted again' : '';
  const photo = safeUrl(sp.photo)
    ? `<img class="photo" src="${esc(sp.photo.replace('square', 'medium'))}" alt="${esc(sp.name)}" />`
    : `<div class="photo none" style="--c:${style.color}"><span>${esc(style.label)}</span></div>`;
  $('card-body').innerHTML = `
    ${photo}
    <h3>${esc(sp.name)}</h3>
    <div class="kind">${esc(style.label)} · <i>${esc(sp.sci)}</i></div>
    <div class="chips">${title ? `<span class="chip grade-${grade}">${title}</span>` : ''}${grade ? `<span class="chip">${GRADE_TEXT[grade]}</span>` : ''}${sp.rarity ? `<span class="chip rarity-${sp.rarity}">${RARITY_TEXT[sp.rarity]}</span>` : ''}<span id="sp-cons"></span></div>
    <p class="credit" id="sp-lineage"></p>
    <div id="sp-season"></div>
    <p id="sp-summary" class="small"></p>
    <p class="credit">${sp.count ? `Recorded ${sp.count} times nearby by iNaturalist naturalists. ` : ''}${sp.credit ? 'Photo ' + esc(sp.credit) : sp.photo === null ? 'No openly licensed photo available.' : ''}</p>
    <p class="credit"><a href="https://www.inaturalist.org/taxa/${encodeURIComponent(sp.id)}" target="_blank" rel="noopener">More on iNaturalist</a></p>`;
  $('card').hidden = false;
  if (autoClose) closeTimer = setTimeout(closeCard, autoClose);
  const id = current;
  taxonDetails(sp.id).then((t) => {
    if (!t || current !== id) return;
    $('sp-lineage').textContent = t.lineage.map((a) => a.name).join(' › ');
    if (t.conservation) $('sp-cons').innerHTML = `<span class="chip closed" title="${esc(t.conservation.authority || '')}">${esc(t.conservation.status)}</span>`;
    if (t.summary) $('sp-summary').textContent = t.summary.length >= 380 ? t.summary + '…' : t.summary;
  });
  if (pos) seasonality(sp.id, pos.lat, pos.lon).then((m) => {
    if (!m || current !== id) return;
    const max = Math.max(...m), now = new Date().getMonth();
    $('sp-season').innerHTML = `<div class="season" title="Research-grade records within 50 km, by month">${m.map((v, i) => `<div class="${i === now ? 'now' : ''}"><i style="height:${Math.round((v / max) * 100)}%"></i><span>${MONTHS[i]}</span></div>`).join('')}</div><p class="credit">When it's recorded around here (by month)</p>`;
  });
}

// "This spot": geology, sky, climate, history and earthquakes around a point.
export function showHere(pos, { game, areaName, elevation }) {
  current = 'here';
  clearTimeout(closeTimer);
  const sky = skyNotes(pos.lat, pos.lon, game.env.utcOffset());
  const hrs = sky.dayLength != null ? `${Math.floor(sky.dayLength)} h ${Math.round((sky.dayLength % 1) * 60)} min of daylight` : sky.polar || '';
  const shower = sky.shower ? (sky.shower.days === 0 ? `${sky.shower.name} meteor shower peaks tonight (up to ~${sky.shower.rate}/hour in dark skies)` : `Next meteor shower: ${sky.shower.name}, in ${sky.shower.days} day${sky.shower.days === 1 ? '' : 's'}`) : '';
  $('card-body').innerHTML = `
    <h3>This spot</h3>
    <div class="kind">${esc(areaName || '')}${areaName ? ' · ' : ''}${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}${elevation != null ? ` · ${fmtElev(elevation)} above sea level` : ''}</div>
    <h4>Under your feet</h4><div id="here-rock"><p class="credit">Looking up the geology…</p></div>
    <h4>Sky today</h4>
    <p class="small">☀️ ${esc(sky.sunrise || '–')} – ${esc(sky.sunset || '–')} · ${esc(hrs)}<br>🌙 ${Math.round(sky.moonIllum * 100)}% lit${sky.moonrise ? ` · rises ${esc(sky.moonrise)}` : ''}${sky.moonset ? ` · sets ${esc(sky.moonset)}` : ''}${shower ? `<br>☄️ ${esc(shower)}` : ''}</p>
    <h4>Climate</h4><div id="here-climate"><p class="credit">Comparing with 1991–2020…</p></div>
    <h4>Nearby on Wikipedia</h4><div id="here-wiki"><p class="credit">Searching…</p></div>
    <h4>Earthquakes (past 7 days, 500 km)</h4><div id="here-quakes"><p class="credit">Checking…</p></div>
    <p class="credit">Geology: Macrostrat · Climate: Open-Meteo/ERA5 · Quakes: USGS · Wikipedia (CC BY-SA)</p>`;
  $('card').hidden = false;
  const id = current;
  const set = (el, html) => { if (current === id) $(el).innerHTML = html; };
  rockAt(pos.lat, pos.lon).then((r) => set('here-rock', r
    ? `<p class="small"><b>${esc(r.name)}</b>${r.lith ? `: ${esc(r.lith)}` : ''}<br>${esc(r.period)}${r.period ? ' · ' : ''}${esc(ageText(r))}${r.descrip ? `<br><span class="credit">${esc(r.descrip)}</span>` : ''}</p>`
    : '<p class="credit">No geological map data here.</p>'));
  climateToday(pos.lat, pos.lon, game.env.utcOffset()).then((c) => set('here-climate', c
    ? `<p class="small">Today: ${fmtTemp(c.low)} to ${fmtTemp(c.high)}, about <b>${fmtTempDelta(c.delta)}</b> ${c.delta >= 0 ? 'warmer' : 'colder'} than the 1991–2020 average for this date (${fmtTemp(c.normal, 1)}).</p>`
    : '<p class="credit">Climate comparison unavailable.</p>'));
  wikiNearby(pos.lat, pos.lon).then((list) => set('here-wiki', list.length
    ? `<ul class="jlist">${list.slice(0, 7).map((w) => `<li><a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.title)}</a> <small>${fmtDist(w.dist)}</small></li>`).join('')}</ul>`
    : '<p class="credit">No articles within 1 km.</p>'));
  quakesNear(pos.lat, pos.lon).then((q) => set('here-quakes', q.length
    ? `<ul class="jlist">${q.map((e) => `<li>M${e.mag.toFixed(1)} · ${esc(e.place || '')} <small>${fmtDist(e.km * 1000)} away · ${new Date(e.time).toLocaleDateString()}</small></li>`).join('')}</ul>`
    : '<p class="credit">None of magnitude 2.5 or more.</p>'));
}
