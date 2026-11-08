// Bottom-sheet card for a place or a species.

import { wikiSummary } from '../data/wiki.js';
import { GROUP_STYLE } from '../data/wildlife.js';
import { TAG_ICONS } from '../game/environment.js';
import { taxonDetails, seasonality, skyNotes, climateToday, wikiNearby, quakesNear, rockAt, ageText, recentNearby, photosNearby, pollenNow, antipode } from '../data/science.js';
import { fmtDist, fmtElev, fmtTemp, fmtTempDelta } from '../units.js';
import { groupInfo, iconIndex, atlasCss } from '../world/icons.js';
import { sizeLabel } from '../data/geocaching.js';
import { esc, safeUrl } from '../util/html.js';
import { FOUND } from '../names.js';

const $ = (id) => document.getElementById(id);
const GRADE_TEXT = { present: FOUND[0].toUpperCase() + FOUND.slice(1), home: 'Found from home', echo: 'Echo (seen virtually)' };
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

// Walking directions in the device's maps app. Only the destination is passed, so the maps
// app starts from the person's real current location; nothing else leaves the device.
const UA = navigator.userAgent || '';
const IS_IOS = /iPad|iPhone|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/i.test(UA);
export function directionLinks(lat, lon, name) {
  const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  if (IS_IOS) return { main: `https://maps.apple.com/?daddr=${ll}&dirflg=w`, label: 'Walking directions', alt: null };
  if (IS_ANDROID) return {
    main: `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=walking`, label: 'Walking directions',
    alt: { href: `geo:${ll}?q=${ll}(${encodeURIComponent(name || 'Destination')})`, label: 'Other app' },
  };
  return {
    main: `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=walking`, label: 'Walking directions',
    alt: { href: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=;${encodeURIComponent(ll)}`, label: 'OpenStreetMap route' },
  };
}

// Geocache card: shows the listing as published, with the site's attribution, and links to it.
const stars = (v) => (v == null ? '–' : `${'★'.repeat(Math.round(v))}${'☆'.repeat(5 - Math.round(v))} ${(+v).toFixed(1)}`);
function showGeocache(poi, { game, profile, distance, onLogged }) {
  const g = poi.gc, mine = profile.data.geocaches?.[g.code];
  const can = game.canLogCache(poi);
  const size = sizeLabel(g.size);
  $('card-body').innerHTML = `
    <h3><i class="ico" style="${atlasCss(iconIndex(poi.kind, poi.cls), 26)}"></i>${esc(poi.name)}</h3>
    <div class="kind">${esc(g.type)} cache${size ? ` · ${esc(size)}` : ''} · ${esc(g.code)} · ${fmtDist(distance)} away</div>
    <div class="chips">${mine ? `<span class="chip grade-${mine.grade}">Found ${new Date(mine.date).toLocaleDateString()}</span>` : '<span class="chip">Not found yet</span>'}${g.startOnly ? '<span class="chip">Start point: puzzle or multi-stage</span>' : ''}</div>
    <p class="small gcrate"><span>Difficulty <b>${stars(g.difficulty)}</b></span><span>Terrain <b>${stars(g.terrain)}</b></span></p>
    ${g.tagline ? `<p class="small">${esc(g.tagline)}</p>` : ''}
    ${g.hint ? `<details class="gchint"><summary>Show the hint</summary><p class="small">${esc(g.hint)}</p></details>` : ''}
    <p class="credit">${g.founds != null ? `Found ${g.founds} times` : ''}${g.lastFound ? ` · last ${new Date(g.lastFound).toLocaleDateString()}` : ''}${g.owner ? ` · hidden by ${esc(g.owner)}` : ''}</p>
    ${directionsRow(poi, game)}
    <div class="dirs">${mine ? '' : `<button id="gc-found" class="dirbtn found" ${can.ok ? '' : 'disabled'}>✓ I found it</button>`}${safeUrl(g.url) ? `<a class="diralt" href="${esc(g.url)}" target="_blank" rel="noopener">Open listing &amp; log on ${esc(g.site)}</a>` : ''}</div>
    ${!mine && !can.ok ? `<p class="credit">${esc(can.why)}</p>` : ''}
    <p class="credit">${esc(g.attribution || `Listing from ${g.site}`)}. Please follow the cache's rules, respect private land, and re-hide it as you found it.</p>`;
  $('card').hidden = false;
  $('gc-found')?.addEventListener('click', () => { game.logCache(poi); onLogged?.(poi); showGeocache(poi, { game, profile, distance, onLogged }); });
}

export function showPlace(poi, { game, profile, distance, onLogged }) {
  if (poi.cls === 'geocache' && poi.gc) { current = poi.ref; clearTimeout(closeTimer); return showGeocache(poi, { game, profile, distance, onLogged }); }
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
    ${directionsRow(poi, game)}
    <p class="credit"><a href="${osmUrl}" target="_blank" rel="noopener">View on OpenStreetMap</a>${safeUrl(poi.tags?.website) ? ` · <a href="${esc(safeUrl(poi.tags.website))}" target="_blank" rel="noopener nofollow">Website</a>` : ''}</p>`;
  $('card').hidden = false;
  if (poi.tags?.wikipedia || poi.tags?.wikidata) {
    $('card-wiki').innerHTML = '<p class="credit">Loading Wikipedia…</p>';
    wikiSummary(poi.tags).then((w) => {
      if (current !== poi.ref) return;
      $('card-wiki').innerHTML = w
        ? `<div class="wiki">${safeUrl(w.thumb) ? `<img src="${esc(w.thumb)}" alt="" loading="lazy" />` : ''}<div>${esc(w.extract.length > 420 ? w.extract.slice(0, 400) + '…' : w.extract)} ${safeUrl(w.url) ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">Wikipedia</a>` : ''}</div></div>`
        : '';
    });
  }
}

function directionsRow(poi, game) {
  const d = directionLinks(poi.lat, poi.lon, poi.name);
  const note = game.mode === 'roam' ? '<span class="credit">From where you really are</span>' : '';
  return `<div class="dirs"><a class="dirbtn" href="${esc(d.main)}" target="_blank" rel="noopener">🚶 ${d.label}</a>${d.alt ? `<a class="diralt" href="${esc(d.alt.href)}" target="_blank" rel="noopener">${esc(d.alt.label)}</a>` : ''}${note}</div>`;
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
  const trend = sky.dayTrend != null && Math.abs(sky.dayTrend) >= 0.1 ? ` · getting ${Math.abs(sky.dayTrend).toFixed(1)} min ${sky.dayTrend > 0 ? 'longer' : 'shorter'} each day` : '';
  const shift = sky.solarShift != null && Math.abs(sky.solarShift) >= 2 ? `<br>🕰 The sun is highest at ${esc(sky.noon)}: clocks here run ${Math.abs(sky.solarShift)} min ${sky.solarShift > 0 ? 'ahead of' : 'behind'} the sun.` : '';
  const shower = sky.shower ? (sky.shower.days === 0 ? `${sky.shower.name} meteor shower peaks tonight (up to ~${sky.shower.rate}/hour in dark skies)` : `Next meteor shower: ${sky.shower.name}, in ${sky.shower.days} day${sky.shower.days === 1 ? '' : 's'}`) : '';
  $('card-body').innerHTML = `
    <h3>This spot</h3>
    <div class="kind">${esc(areaName || '')}${areaName ? ' · ' : ''}${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}${elevation != null ? ` · ${fmtElev(elevation)} above sea level` : ''}</div>
    <h4>Under your feet</h4><div id="here-rock"><p class="credit">Looking up the geology…</p></div>
    <div id="here-recent"></div>
    <div id="here-photos"></div>
    <h4>Sky today</h4>
    <p class="small">☀️ ${esc(sky.sunrise || '–')} – ${esc(sky.sunset || '–')} · ${esc(hrs)}${esc(trend)}<br>🌙 ${Math.round(sky.moonIllum * 100)}% lit${sky.moonrise ? ` · rises ${esc(sky.moonrise)}` : ''}${sky.moonset ? ` · sets ${esc(sky.moonset)}` : ''}${shower ? `<br>☄️ ${esc(shower)}` : ''}${shift}</p>
    <h4>Climate</h4><div id="here-climate"><p class="credit">Comparing with 1991–2020…</p></div>
    <div id="here-pollen"></div>
    <h4>Nearby on Wikipedia</h4><div id="here-wiki"><p class="credit">Searching…</p></div>
    <h4>The other side of the Earth</h4><div id="here-anti"><p class="credit">Digging…</p></div>
    <h4>Earthquakes (past 7 days, 500 km)</h4><div id="here-quakes"><p class="credit">Checking…</p></div>
    <p class="credit">Geology: Macrostrat · Wildlife: iNaturalist · Photos: Wikimedia Commons · Climate &amp; pollen: Open-Meteo/ERA5 · Quakes: USGS · Wikipedia (CC BY-SA) · Places: OpenStreetMap</p>`;
  $('card').hidden = false;
  const id = current;
  const set = (el, html) => { if (current === id) $(el).innerHTML = html; };
  rockAt(pos.lat, pos.lon).then((r) => set('here-rock', r
    ? `<p class="small"><b>${esc(r.name)}</b>${r.lith ? `: ${esc(r.lith)}` : ''}<br>${esc(r.period)}${r.period ? ' · ' : ''}${esc(ageText(r))}${r.descrip ? `<br><span class="credit">${esc(r.descrip)}</span>` : ''}</p>`
    : '<p class="credit">No geological map data here.</p>'));
  recentNearby(pos.lat, pos.lon).then((list) => set('here-recent', list.length
    ? `<h4>Recently seen here</h4><div class="seen">${list.map((x) => `<a class="seen1" href="https://www.inaturalist.org/taxa/${encodeURIComponent(x.id)}" target="_blank" rel="noopener">${safeUrl(x.photo) ? `<img src="${esc(x.photo)}" alt="" loading="lazy" />` : `<i style="background:${GROUP_STYLE[x.group]?.color || '#5fd08a'}"></i>`}<span>${esc(x.name)}<small>${esc(ago(x.date))}</small></span></a>`).join('')}</div>`
    : ''));
  photosNearby(pos.lat, pos.lon).then((list) => set('here-photos', list.length
    ? `<h4>Pictures of this place</h4><div class="thens">${list.map((ph) => `<a href="${esc(ph.url)}" target="_blank" rel="noopener" title="${esc(ph.title)}${ph.by ? ` · ${esc(ph.by)}` : ''}${ph.licence ? ` · ${esc(ph.licence)}` : ''}"><img src="${esc(ph.thumb)}" alt="${esc(ph.title)}" loading="lazy" />${ph.year ? `<span>${ph.year}</span>` : ''}</a>`).join('')}</div>`
    : ''));
  climateToday(pos.lat, pos.lon, game.env.utcOffset()).then((c) => set('here-climate', c
    ? `<p class="small">Today: ${fmtTemp(c.low)} to ${fmtTemp(c.high)}, about <b>${fmtTempDelta(c.delta)}</b> ${c.delta >= 0 ? 'warmer' : 'colder'} than the 1991–2020 average for this date (${fmtTemp(c.normal, 1)}).${c.recordHigh && c.recordLow ? `<br><span class="credit">On this date since 1991: hottest ${fmtTemp(c.recordHigh[0], 1)} (${c.recordHigh[1]}), coldest ${fmtTemp(c.recordLow[0], 1)} (${c.recordLow[1]}).</span>` : ''}</p>`
    : '<p class="credit">Climate comparison unavailable.</p>'));
  pollenNow(pos.lat, pos.lon).then((list) => set('here-pollen', list.length
    ? `<h4>Pollen in the air</h4><p class="small">${list.map((x) => `${esc(x.name)} <span class="credit">${esc(x.level)}</span>`).join(' · ')}</p>`
    : ''));
  wikiNearby(pos.lat, pos.lon).then((list) => set('here-wiki', list.length
    ? `<ul class="jlist">${list.slice(0, 7).map((w) => `<li><a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.title)}</a> <small>${fmtDist(w.dist)}</small></li>`).join('')}</ul>`
    : '<p class="credit">No articles within 1 km.</p>'));
  antipode(pos.lat, pos.lon).then((a) => set('here-anti', `<p class="small">Dig straight down through the Earth and you'd come out at ${Math.abs(a.lat).toFixed(2)}°${a.lat >= 0 ? 'N' : 'S'}, ${Math.abs(a.lon).toFixed(2)}°${a.lon >= 0 ? 'E' : 'W'}: ${a.place ? `<b>${esc(a.place)}</b>` : '<b>open ocean</b>'}.</p>`));
  quakesNear(pos.lat, pos.lon).then((q) => set('here-quakes', q.length
    ? `<ul class="jlist">${q.map((e) => `<li>M${e.mag.toFixed(1)} · ${esc(e.place || '')} <small>${fmtDist(e.km * 1000)} away · ${new Date(e.time).toLocaleDateString()}</small></li>`).join('')}</ul>`
    : '<p class="credit">None of magnitude 2.5 or more.</p>'));
}

function ago(dateStr) {
  const d = Math.round((Date.now() - Date.parse(dateStr)) / 864e5);
  return !isFinite(d) ? '' : d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}
