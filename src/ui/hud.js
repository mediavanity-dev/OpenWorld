// The heads-up display: toasts, the stats panel, live conditions, today's assignment, the
// activity log, the hunt/treasure tracker pill and the loading / missing-data line.

import { MODES } from '../game/game.js';
import { TASKS } from '../game/journal.js';
import { trustOf } from '../game/locator.js';
import { aqiLabel } from '../data/weather.js';
import { onHealth, unhealthy } from '../data/net.js';
import { haversine } from '../geo.js';
import { fmtDist, fmtTemp } from '../units.js';
import { esc } from '../util/html.js';
import { BETA } from '../channel.js';

const $ = (id) => document.getElementById(id);

export function toast(msg, cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4500);
  while ($('toasts').children.length > 3) $('toasts').firstElementChild.remove();
}
export function setText(id, text) { const el = $(id); if (el.textContent !== text) el.textContent = text; }
// screen-reader announcement
export function announce(msg) { const el = $('sr'); el.textContent = ''; setTimeout(() => (el.textContent = msg), 30); }

export function fixText(f) {
  if (!f) return 'none';
  return f.source === 'ip' ? `IP · ${f.place || '≈ city'} (±5 km)` : `${trustOf(f)} · ±${Math.round(f.accuracy)} m`;
}

// services whose absence the player would notice, and what they'd miss
const MISSING = { weather: 'live weather', wildlife: 'wildlife', geology: 'geology', 'place details': 'trees & opening hours', geocaches: 'geocaches' };

export function initHud(ctx) {
  const { game, profile, environment, journal, settings, world } = ctx;
  const fmt = (v) => v.toFixed(5);
  onHealth(() => worldStatus());

  function render() {
    if (!game.mode) return;
    const controls = ctx.controls;
    document.querySelectorAll('.tabs button[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === game.mode));
    setText('h-desc', MODES[game.mode].desc);
    setText('h-pos', game.pos ? `${fmt(game.pos.lat)}, ${fmt(game.pos.lon)}` : '–');
    setText('h-fix', fixText(game.fix));
    const h = profile.data.home;
    setText('h-home', h ? `${h.trust} · ${game.pos ? fmtDist(haversine(h.lat, h.lon, game.pos.lat, game.pos.lon)) + ' away' : ''}` : 'not set');
    $('b-sethome').disabled = !BETA && (game.mode !== 'present' || !game.fix); // beta: opens the home base setup
    $('b-beacon').disabled = !MODES[game.mode].beacons;

    const c = profile.counts();
    setText('c-present', String(c.present));
    setText('c-home', String(c.home));
    setText('c-echo', String(c.echo));
    setText('c-species', String(c.species));
    setText('c-beacons', String(profile.data.beacons.length));

    // live conditions
    if (game.pos) {
      const w = environment.weather;
      const sun = environment.sun(game.pos.lat, game.pos.lon);
      const parts = [];
      if (w) parts.push(`${w.icon} ${fmtTemp(w.tempC)} ${esc(w.label)}`);
      parts.push(`<span class="muted">${environment.localTimeText()} · ${environment.sunPhase(sun.alt)}</span>`);
      const air = aqiLabel(w?.aqi);
      if (air && air !== 'good' && air !== 'fair') parts.push(`<span class="muted">air ${air}</span>`);
      if (environment.holiday) parts.push(`<span class="holiday">🎉 ${esc(environment.holiday)}</span>`);
      const html = parts.map((p) => `<span>${p}</span>`).join('');
      const el = $('envline');
      if (el.dataset.v !== html) { el.innerHTML = html; el.dataset.v = html; }
    }

    // beta expeditions take this spot when they're on; otherwise today's field assignment,
    // with an arrow to the nearest place that fits it
    if (ctx.expeditions?.hud()) return renderLog();
    $('nearest').classList.remove('quest');
    const nl = document.querySelector('#nearest .n-label');
    if (nl.textContent !== 'Today') nl.textContent = 'Today';
    const t = journal.task(), T = TASKS[t.type];
    const tgt = !t.done && T.place ? game.taskTarget : null;
    setText('n-name', t.type === 'walk1k' ? (settings.units === 'imperial' ? 'Walk 0.6 miles' : 'Walk 1 km') : T.text);
    setText('n-dist', t.done ? 'Done for today. A new one tomorrow.'
      : tgt ? `Nearest: ${tgt.poi.name} · ${fmtDist(tgt.dist)}`
      : T.unit === 'm' ? `${fmtDist(t.progress)} of ${fmtDist(T.target)} · Present or Home`
      : T.place ? 'Nothing that fits close by yet. Keep exploring.'
      : 'Watch for signs as you walk · Present or Home');
    setText('n-arrow', tgt ? '↑' : t.done ? '✓' : '•');
    $('n-arrow').style.transform = tgt ? `rotate(${tgt.bearing + (controls.yaw * 180) / Math.PI}deg)` : '';
    $('nearest').classList.toggle('done', t.done);
    renderLog();
  }
  function renderLog() {
    const logEl = $('log');
    const items = profile.data.log.slice(0, 12).map((l) => `<li>${new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${esc(l.msg)}</li>`).join('');
    if (logEl.dataset.v !== items) { logEl.innerHTML = items; logEl.dataset.v = items; }
  }

  // loading progress, or what's missing right now (busy free servers), instead of silence
  function worldStatus() {
    const s = world.status();
    let text = '';
    if (s.loading) text = `Loading world… ${s.ready}/${s.ready + s.loading} areas`;
    else if (s.error) text = `${s.error} area(s) failed to load, retrying`;
    else if (!settings.dataSaver && s.detail + s.detailFailed < s.ready) text = `Adding trees & place details… ${s.detail}/${s.ready}`;
    if (!text) {
      const down = unhealthy().map((k) => MISSING[k]).filter(Boolean);
      if (s.detailFailed && !settings.dataSaver && !down.includes(MISSING['place details'])) down.push(MISSING['place details']);
      if (down.length) text = `Unavailable right now: ${[...new Set(down)].join(', ')} (busy free servers; retrying later)`;
    }
    setText('w-status', text);
  }

  // small tracker pill: dots for the hunt's signal, a spark for treasure warmth; fades in and out
  function tracker() {
    const el = $('tracker');
    const h = game.hunt, th = game.treasureHint, controls = ctx.controls;
    let html = '';
    if (h) {
      const dots = [1, 2, 3, 4, 5].map((k) => `<i class="${k <= h.signal ? 'on' : ''}"></i>`).join('');
      html += `<span class="hunt ${h.trend > 0 ? 'warmer' : h.trend < 0 ? 'colder' : ''}" title="Tracking">🐾<span class="dots">${dots}</span></span>`;
    }
    if (th?.band) html += `<span class="gold ${th.band}" title="Daily treasure: ${th.band}">✦</span>`;
    // beta: the active expedition (tap to open the board) instead of the field assignment
    const quest = ctx.expeditions?.chip() || '';
    html += quest;
    // map-only view: a faint star + arrow towards today's field assignment (tap to open it)
    const task = journal.task(), tgt = !quest && !game.features.quests && !task.done && document.body.classList.contains('clean') ? game.taskTarget : null;
    if (tgt) html += `<span class="tk-task" title="Today's field assignment">★<i style="transform:rotate(${Math.round((tgt.bearing + (controls.yaw * 180) / Math.PI) / 5) * 5}deg)">↑</i></span>`;
    if (el.dataset.v !== html) { el.dataset.v = html; el.innerHTML = html; }
    el.classList.toggle('show', !!html && !ctx.arMode.active);
    el.classList.toggle('tappable', !!tgt || !!quest);
  }

  return { render, worldStatus, tracker };
}
