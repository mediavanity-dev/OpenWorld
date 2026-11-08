// Field Journal: a calm overview of what you've done. Overview, collections,
// records, survey areas and a map of explored ground; plus a shareable summary image.

import { geohashBounds, chunkIndex, chunkKey, offsetMeters } from '../geo.js';
import { TASKS, DEPTH_TIERS, depthTier, explorerScore } from '../game/journal.js';
import { GROUP_STYLE } from '../data/wildlife.js';
import { TAG_ICONS } from '../game/environment.js';
import { ageText } from '../data/science.js';
import { fmtDist, fmtElev } from '../units.js';
import { esc, safeUrl } from '../util/html.js';
import { SHOW_BEACONS } from '../channel.js';
import { WALK, FOUND } from '../names.js';

const $ = (id) => document.getElementById(id);
const KIND_LABEL = { tourism: 'Sights', historic: 'History', amenity: 'Cafés, culture & services', shop: 'Shops', leisure: 'Parks & sport', natural: 'Nature', transport: 'Stations' };
const GROUP_PLURAL = { Aves: 'Birds', Plantae: 'Plants', Insecta: 'Insects', Arachnida: 'Spiders & kin', Mammalia: 'Mammals', Reptilia: 'Reptiles', Amphibia: 'Amphibians', Actinopterygii: 'Fish', Mollusca: 'Molluscs', Fungi: 'Fungi' };
const GRADE_DOT = { present: '#ff7a3d', home: '#3db8ff', echo: '#b07aff' };

let ctx = null; // { profile, game, onSpecies }
let tab = 'overview';
let mapRadius = 1000;

export function initJournal(c) {
  ctx = c;
  $('journal-close').onclick = closeJournal;
  $('journal').addEventListener('click', (e) => {
    if (e.target.id === 'journal') closeJournal();
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; render(true); }
    const r = e.target.closest('[data-radius]');
    if (r) { mapRadius = +r.dataset.radius; render(); }
    const sp = e.target.closest('[data-species]');
    if (sp) ctx.onSpecies?.(sp.dataset.species);
    if (e.target.id === 'j-share') shareCard();
    if (e.target.closest('[data-open-quests]')) { closeJournal(); ctx.onQuests?.(); }
  });
}
export function openJournal(which) { if (which) tab = which; $('journal').hidden = false; render(true); }
export function closeJournal() { $('journal').hidden = true; }

// ---------- derived numbers ----------
function cellAreaKm2(h) { const b = geohashBounds(h); return ((b.n - b.s) * 111.32) * ((b.e - b.w) * 111.32 * Math.cos((b.lat * Math.PI) / 180)); }
export function summary(profile) {
  const d = profile.data;
  const c = profile.counts();
  let real = 0, virt = 0;
  for (const [h, r] of Object.entries(d.cells || {})) (r >= 2 ? (real += cellAreaKm2(h)) : (virt += cellAreaKm2(h)));
  const days = Object.entries(d.days || {});
  return {
    ...c,
    rocks: Object.keys(d.rocks || {}).length,
    beacons: d.beacons.length,
    exploredKm2: real, virtualKm2: virt,
    walked: (d.stats.meters.present || 0) + (d.stats.meters.home || 0),
    roamed: d.stats.meters.roam || 0,
    daysActive: days.filter(([, v]) => v.m > 50 || v.finds || v.species).length,
    tasksDone: d.tasksDone || 0,
    photos: d.photos || 0,
    peaks: Object.values(d.discoveries).filter((x) => x.kind?.startsWith('natural:peak') && x.grade !== 'echo').length,
    caches: Object.keys(d.geocaches || {}).length,
    treasure: d.treasure?.total || 0,
  };
}

// ---------- tabs ----------
function render(toTop = false) {
  const { profile } = ctx;
  const tabs = [['overview', 'Overview'], ['collections', 'Collections'], ['records', 'Records'], ['areas', 'Areas'], ['map', 'Map']];
  $('journal-tabs').innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('');
  const body = $('journal-body');
  body.innerHTML = ({ overview, collections, records, areas, map })[tab](profile);
  if (toTop) body.scrollTop = 0; // a new tab starts at its top (zooming the map doesn't)
  if (tab === 'map') drawMap($('j-map'), profile, mapRadius);
}

// beta: expeditions take the place of the daily assignment (tap to open the board)
const RCOL = { common: '#9aa4ae', uncommon: '#5fd08a', rare: '#4f9dff', epic: '#c07aff', legendary: '#ffb84d' };
function expeditionBox() {
  const q = ctx.game.quests;
  if (!ctx.game.features.quests || !q) return '';
  const r = q.rank(), td = q.today(), a = q.active(), cards = q.s.cards;
  const best = cards.slice().sort((x, y) => Object.keys(RCOL).indexOf(y.rarity) - Object.keys(RCOL).indexOf(x.rarity))[0];
  return `<button class="task quest-task" data-open-quests>
    <span>Expeditions · rank ${r.level}, ${esc(r.name)} · ${r.stars}★${r.next ? ` (${r.next - r.stars} to the next rank)` : ''}</span>
    <b>${a ? `On the go: ${esc(a.title)}` : `${td.done} finished today${td.stars ? `, +${td.stars}★` : ''}`}</b>
    <small>${cards.length} cards${best ? ` · best: <span style="color:${RCOL[best.rarity]}">${esc(best.name || '')} (${best.rarity})</span>` : ''} · tap for the board</small></button>`;
}

function stat(n, label, color) { return `<div class="jstat"><b style="color:${color || 'inherit'}">${n}</b><span>${label}</span></div>`; }

function overview(profile) {
  const s = summary(profile);
  const t = ctx.game.journal.task();
  const T = TASKS[t.type];
  const prog = T.unit === 'm' ? `${fmtDist(t.progress)} / ${fmtDist(T.target)}` : `${t.progress}/${T.target}`;
  // last 7 days of real walking
  const days = [];
  const now = ctx.game.env.localNow();
  for (let k = 6; k >= 0; k--) {
    const key = new Date(now.getTime() - k * 864e5).toISOString().slice(0, 10);
    days.push({ key, v: profile.data.days?.[key] || { m: 0, finds: 0, species: 0 } });
  }
  const max = Math.max(1, ...days.map((x) => x.v.m));
  const bars = days.map((x) => `<div class="bar" title="${esc(x.key)}: ${fmtDist(x.v.m)}, ${x.v.finds} finds, ${x.v.species} species"><i style="height:${Math.round((x.v.m / max) * 100)}%"></i><span>${'SMTWTFS'[new Date(x.key + 'T12:00:00Z').getUTCDay()]}</span></div>`).join('');
  return `
    ${expeditionBox() || `<div class="task ${t.done ? 'done' : ''}"><span>Today's field assignment</span><b>${esc(T.text)}</b><small>${t.done ? 'Complete ✓' : prog} · ${WALK} or Home mode</small></div>`}
    <div class="jgrid">
      ${stat(s.present, FOUND, '#ff7a3d')}${stat(s.home, 'found from home', '#3db8ff')}${stat(s.echo, 'echoes', '#b07aff')}
      ${stat(s.species, 'species', '#5fd08a')}${stat(s.rocks, 'rock units', '#c9a27a')}${SHOW_BEACONS ? stat(s.beacons, 'beacons', '#ffd36b') : ''}
    </div>
    <div class="jgrid">
      ${stat(s.exploredKm2.toFixed(2), 'km² explored on foot')}${stat(fmtDist(s.walked), 'walked')}${stat(s.daysActive, 'days out')}
      ${stat(s.tasksDone, 'assignments done')}${stat(s.photos, 'AR photos')}${stat(s.peaks, 'peaks')}
      ${s.caches ? stat(s.caches, 'geocaches', '#7a9a3a') : ''}${s.treasure ? stat(s.treasure, 'golden finds', '#ffd36b') : ''}
    </div>
    <h4>Last 7 days on foot</h4>
    <div class="bars">${bars}</div>
    <p class="credit">Roam (virtual) travel: ${fmtDist(s.roamed)} · ${s.virtualKm2.toFixed(2)} km² seen virtually. These never count as real exploration.</p>
    <button id="j-share" class="primary wide">Create a summary image</button>`;
}

function collections(profile) {
  const d = profile.data;
  // places by type
  const byKind = {};
  for (const x of Object.values(d.discoveries)) (byKind[x.kind?.split(':')[0] || 'other'] ||= []).push(x);
  const places = Object.entries(byKind).sort((a, b) => b[1].length - a[1].length).map(([k, list]) => `
    <details><summary>${esc(KIND_LABEL[k] || k)} <b>${list.length}</b></summary>
    <ul class="jlist">${list.sort((a, b) => (b.last || '').localeCompare(a.last || '')).slice(0, 80).map((x) => `<li><i class="dot" style="background:${GRADE_DOT[x.grade]}"></i>${esc(x.name)} <small>${(x.seen || []).map((t) => TAG_ICONS[t] || '').join('')}</small></li>`).join('')}</ul></details>`).join('') || '<p class="credit">No places yet. Walk within 30 m of a marker.</p>';
  // life list
  const byGroup = {};
  for (const [id, x] of Object.entries(d.species || {})) (byGroup[x.group] ||= []).push({ id, ...x });
  const life = Object.entries(byGroup).sort((a, b) => b[1].length - a[1].length).map(([g, list]) => `
    <details><summary>${esc(GROUP_PLURAL[g] || g)} <b>${list.length}</b></summary>
    <ul class="jlist">${list.sort((a, b) => a.name.localeCompare(b.name)).map((x) => `<li data-species="${esc(x.id)}" class="link"><i class="dot" style="background:${GROUP_STYLE[x.group]?.color || '#5fd08a'}"></i>${esc(x.name)} <small><i>${esc(x.sci)}</i>${x.conditions?.photo ? ' · 📷' : ''}</small></li>`).join('')}</ul></details>`).join('') || '<p class="credit">No species yet. Creatures appear as you walk, especially in parks and near water.</p>';
  // rocks
  const rocks = Object.values(d.rocks || {}).sort((a, b) => (b.bottom ?? 0) - (a.bottom ?? 0));
  const rockList = rocks.length ? `<ul class="jlist">${rocks.map((r) => `<li><i class="dot" style="background:${GRADE_DOT[r.grade]}"></i>${esc(r.name)} <small>${esc(r.lith.split(',').slice(0, 2).join(','))} · ${esc(ageText(r))}</small></li>`).join('')}</ul>` : '<p class="credit">No rocks yet. The ground under you is identified as you move between areas.</p>';
  // conditions
  const tags = {};
  for (const x of Object.values(d.discoveries)) for (const t of x.seen || []) tags[t] = (tags[t] || 0) + 1;
  const cond = Object.keys(TAG_ICONS).map((t) => `<span class="chip ${tags[t] ? '' : 'off'}">${TAG_ICONS[t]} ${t} ${tags[t] ? `<b>${tags[t]}</b>` : ''}</span>`).join('');
  const gcs = Object.entries(d.geocaches || {}).sort((a, b) => (b[1].date || '').localeCompare(a[1].date || ''));
  const gcList = gcs.length ? `<ul class="jlist">${gcs.map(([code, g]) => `<li><i class="dot" style="background:${GRADE_DOT[g.grade]}"></i>${safeUrl(g.url) ? `<a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.name)}</a>` : esc(g.name)} <small>${esc(g.type)} · D${g.difficulty ?? '–'}/T${g.terrain ?? '–'} · ${esc(code)}</small></li>`).join('')}</ul>` : '';
  const rps = Object.values(d.rephotos || {}).sort((a, b) => (b.last || '').localeCompare(a.last || ''));
  const rpList = rps.length ? `<ul class="jlist">${rps.map((r) => `<li><i class="dot" style="background:#ffd36b"></i>${safeUrl(r.photo?.url) ? `<a href="${esc(r.photo.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)} <small>${esc(r.year)} · ${esc(r.score)}% match</small></li>`).join('')}</ul>` : '';
  return `<h4>Places</h4>${places}<h4>Life list</h4>${life}<h4>Rocks underfoot</h4>${rockList}${gcList ? `<h4>Geocaches found</h4>${gcList}` : ''}${rpList ? `<h4>Then &amp; now</h4>${rpList}` : ''}<h4>Conditions you've seen places in</h4><div class="chips">${cond}</div>`;
}

function records(profile) {
  const r = profile.data.records || {};
  const s = summary(profile);
  const row = (label, val) => `<div class="kv"><span>${label}</span><b>${val ?? '<span class="muted">–</span>'}</b></div>`;
  return `
    ${row('Highest point stood on', r.highest ? `${fmtElev(r.highest.m)} <small>(${esc(r.highest.date)})</small>` : null)}
    ${row('Longest day on foot', r.longestDay ? `${fmtDist(r.longestDay.m)} <small>(${esc(r.longestDay.date)})</small>` : null)}
    ${row(`Oldest place ${FOUND}`, r.oldestPlace ? `${esc(r.oldestPlace.name)} <small>(${r.oldestPlace.year})</small>` : null)}
    ${row('Rarest species seen', r.rarestSpecies ? `${esc(r.rarestSpecies.name)} <small>(${r.rarestSpecies.count} local records)</small>` : null)}
    ${row('Furthest north', r.north ? `${esc(r.north.name)} <small>${r.north.lat}°</small>` : null)}
    ${row('Furthest south', r.south ? `${esc(r.south.name)} <small>${r.south.lat}°</small>` : null)}
    ${row('Peaks reached', s.peaks || null)}
    ${(() => { const h = Object.values(profile.data.geocaches || {}).sort((a, b) => ((b.difficulty || 0) + (b.terrain || 0)) - ((a.difficulty || 0) + (a.terrain || 0)))[0]; return h ? row('Hardest geocache', `${esc(h.name)} <small>(D${h.difficulty}/T${h.terrain})</small>`) : ''; })()}
    ${row('First claim', r.firstClaim ? `${esc(r.firstClaim.name)} <small>(${esc(r.firstClaim.date)})</small>` : null)}
    ${row(`Walked (${WALK})`, fmtDist(profile.data.stats.meters.present || 0))}
    ${row('Walked (Home)', fmtDist(profile.data.stats.meters.home || 0))}
    ${row('Travelled virtually (Roam)', fmtDist(profile.data.stats.meters.roam || 0))}
    <p class="credit">Records only count real visits (${WALK} or Home), never Roam.</p>`;
}

function areas(profile) {
  const d = profile.data;
  const found = {}, echo = {};
  for (const x of Object.values(d.discoveries)) {
    const [la, lo] = x.anchor?.wgs84 || [];
    if (la === undefined) continue;
    const { i, j } = chunkIndex(la, lo), k = chunkKey(i, j);
    (x.grade === 'echo' ? echo : found)[k] = ((x.grade === 'echo' ? echo : found)[k] || 0) + 1;
  }
  const share = (n, of) => (of ? Math.min(1, (n || 0) / of) : 0);
  const list = Object.entries(d.areas || {}).filter(([k, a]) => found[k] || echo[k] || a.foot || a.home)
    .map(([k, a]) => ({ k, a, f: found[k] || 0, e: echo[k] || 0, foot: share(a.foot, a.walk), home: share(a.home, a.walk) }))
    .map((x) => ({ ...x, tier: depthTier(x.foot), placePct: x.a.total ? Math.min(100, Math.round((x.f / x.a.total) * 100)) : 0 }))
    .sort((x, y) => y.foot - x.foot || y.home - x.home || y.f - x.f);
  const score = explorerScore(d.areas);
  const deep = list.filter((x) => x.foot >= 0.5).length;
  const head = `<div class="depth-head"><div><b>${score}</b><span>explorer score</span></div><div><b>${deep}</b><span>areas surveyed (50%+)</span></div>
    <p class="credit">Depth beats distance. Each area scores by how much of its streets and paths you've walked for real, squared, so knowing your own neighbourhood counts far more than passing through many places. Only walking or running counts (${WALK}, up to 10 mph); Home progress shows separately.</p>
    <p class="credit tiers">${DEPTH_TIERS.slice().reverse().filter(([t]) => t > 0).map(([t, n]) => `<span>${n} ${Math.round(t * 100)}%</span>`).join(' · ')}</p></div>`;
  if (!list.length) return head + '<p class="credit">Your areas appear here as you walk and discover places. Each area is about 1.5 km across.</p>';
  return head + list.map((x) => `<div class="area depth">
      <div><b>${esc(x.a.name || 'Unnamed area')}</b>${x.tier ? ` <span class="tierchip t-${x.tier.split(' ')[0].toLowerCase()}">${esc(x.tier)}</span>` : ''}
        <small>${x.a.walk ? `Streets walked: <b>${Math.round(x.foot * 100)}%</b> on foot${x.home > x.foot ? ` · ${Math.round(x.home * 100)}% from home` : ''} · ` : ''}places ${x.f}/${x.a.total}${x.e ? ` · ${x.e} echoes` : ''}</small></div>
      <div class="pbar two"><i class="home" style="width:${Math.round(x.home * 100)}%"></i><i style="width:${Math.round(x.foot * 100)}%"></i></div>
      <span>${x.a.walk ? Math.round(x.foot * 100) : x.placePct}%</span></div>`).join('');
}

function map() {
  const r = [[1000, '1 km'], [5000, '5 km'], [25000, '25 km'], [200000, '200 km']];
  return `<div class="row">${r.map(([v, l]) => `<button data-radius="${v}" class="${v === mapRadius ? 'active' : ''}">${l}</button>`).join('')}</div>
    <canvas id="j-map" class="jmap"></canvas>
    <p class="credit"><i class="dot" style="background:#e1ebd2"></i>explored on foot <i class="dot" style="background:#78c8ff"></i>from home <i class="dot" style="background:#b07aff"></i>virtual · dots: discoveries${ctx.game.quests?.s.cards.length ? ' · ◆ expedition cards' : ''}</p>`;
}

// ---------- map drawing (north-up), shared with the share card ----------
function drawMap(canvas, profile, radius, size) {
  const d = profile.data;
  const centre = ctx.game.pos || d.home || d.last;
  const W = size || Math.round(canvas.getBoundingClientRect().width * Math.min(2, devicePixelRatio || 1)) || 600;
  canvas.width = W; canvas.height = W;
  const g = canvas.getContext('2d');
  g.fillStyle = '#12161c'; g.fillRect(0, 0, W, W);
  if (!centre) return;
  const k = (W / 2) / radius;
  const P = (lat, lon) => { const o = offsetMeters(centre.lat, centre.lon, lat, lon); return [W / 2 + o.x * k, W / 2 + o.z * k]; };
  const fill = { 1: 'rgba(176,122,255,0.55)', 2: 'rgba(120,200,255,0.7)', 3: 'rgba(225,235,210,0.85)' };
  const dLat = (radius / 111320) * 1.5;
  for (const [h, rank] of Object.entries(d.cells || {})) {
    const b = geohashBounds(h);
    if (Math.abs(b.lat - centre.lat) > dLat) continue;
    const [x1, y1] = P(b.n, b.w), [x2, y2] = P(b.s, b.e);
    g.fillStyle = fill[rank];
    g.fillRect(x1, y1, Math.max(1, x2 - x1), Math.max(1, y2 - y1));
  }
  for (const x of Object.values(d.discoveries)) {
    const [la, lo] = x.anchor?.wgs84 || [];
    if (la === undefined) continue;
    const [px, py] = P(la, lo);
    if (px < 0 || py < 0 || px > W || py > W) continue;
    g.fillStyle = GRADE_DOT[x.grade];
    g.beginPath(); g.arc(px, py, Math.max(1.5, W / 220), 0, Math.PI * 2); g.fill();
  }
  for (const c of d.quests?.cards || []) {
    if (c.lat == null) continue;
    const [px, py] = P(c.lat, c.lon), r = Math.max(3, W / 110);
    if (px < 0 || py < 0 || px > W || py > W) continue;
    g.fillStyle = RCOL[c.rarity] || '#ffd36b'; g.strokeStyle = '#12161c'; g.lineWidth = Math.max(1, W / 400);
    g.beginPath(); g.moveTo(px, py - r * 1.4); g.lineTo(px + r, py); g.lineTo(px, py + r * 1.4); g.lineTo(px - r, py); g.closePath(); g.fill(); g.stroke();
  }
  if (d.home) { const [hx, hy] = P(d.home.lat, d.home.lon); g.strokeStyle = '#3db8ff'; g.lineWidth = W / 300; g.strokeRect(hx - W / 120, hy - W / 120, W / 60, W / 60); }
  g.fillStyle = '#ff7a3d'; g.beginPath(); g.arc(W / 2, W / 2, W / 110, 0, Math.PI * 2); g.fill();
  // scale bar + north
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = `${Math.round(W / 34)}px system-ui, sans-serif`; g.textAlign = 'left';
  g.fillText(`N ↑   ${fmtDist(radius)} radius`, W / 40, W - W / 40);
}

// ---------- shareable summary image (made on the device; nothing uploaded) ----------
async function shareCard() {
  const { profile } = ctx;
  const s = summary(profile);
  const r = profile.data.records || {};
  const W = 1080, H = 1350, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, '#16202c'); grad.addColorStop(1, '#0d1117');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.fillStyle = '#eef1f4'; g.font = 'bold 64px system-ui, sans-serif'; g.fillText('OpenWorld field journal', 70, 120);
  g.fillStyle = '#a5adb7'; g.font = '34px system-ui, sans-serif'; g.fillText(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }), 70, 175);
  const cells = [[s.present, `places ${FOUND}`, '#ff7a3d'], [s.species, 'species', '#5fd08a'], [s.rocks, 'rock units', '#c9a27a'], [s.exploredKm2.toFixed(1), 'km² explored', '#e1ebd2'], [fmtDist(s.walked), 'walked', '#78c8ff'], [s.daysActive, 'days out', '#ffd36b']];
  cells.forEach(([n, l, col], i) => {
    const x = 70 + (i % 3) * 320, y = 270 + Math.floor(i / 3) * 170;
    g.fillStyle = col; g.font = 'bold 76px system-ui, sans-serif'; g.fillText(String(n), x, y);
    g.fillStyle = '#a5adb7'; g.font = '30px system-ui, sans-serif'; g.fillText(l, x, y + 46);
  });
  const lines = [
    r.highest && `Highest point: ${fmtElev(r.highest.m)}`,
    r.oldestPlace && `Oldest place: ${r.oldestPlace.name} (${r.oldestPlace.year})`,
    r.rarestSpecies && `Rarest find: ${r.rarestSpecies.name}`,
    r.longestDay && `Longest day: ${fmtDist(r.longestDay.m)}`,
  ].filter(Boolean);
  g.fillStyle = '#d9dee4'; g.font = '34px system-ui, sans-serif';
  lines.forEach((t, i) => g.fillText(t.length > 52 ? t.slice(0, 51) + '…' : t, 70, 670 + i * 52));
  const m = document.createElement('canvas');
  drawMap(m, profile, mapRadius, 520);
  g.drawImage(m, W - 520 - 70, H - 520 - 90);
  g.fillStyle = '#6b7480'; g.font = '26px system-ui, sans-serif';
  g.fillText('mediavanity-dev.github.io/OpenWorld · map data © OpenStreetMap', 70, H - 40);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const file = new File([blob], `openworld-journal-${new Date().toISOString().slice(0, 10)}.png`, { type: 'image/png' });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'My OpenWorld field journal' }); return; } catch { /* cancelled */ } }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
