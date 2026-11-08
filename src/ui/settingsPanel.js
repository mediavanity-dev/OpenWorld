// Settings, profile backup (export / import / reset), game-feature switches, the beta's
// "copy my main profile", playtest stats, and the help & about page.

import { settings, saveSettings, startTier } from '../settings.js';
import { startCompass, keepAwake, compassSupported } from '../sensors.js';
import { BETA, FEATURES, featureAvailable } from '../channel.js';
import { STABLE_PROFILE_KEY } from '../game/profile.js';
import { storage } from '../storage.js';
import { CHASE_GOAL_S } from '../game/metrics.js';
import { fmtDist } from '../units.js';
import { esc } from '../util/html.js';
import { toast } from './hud.js';

const $ = (id) => document.getElementById(id);

function download(text, name, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function initSettingsPanel(ctx) {
  const { game, profile, journal, world, ambience, metrics } = ctx;
  const today = () => new Date().toISOString().slice(0, 10);

  function open() {
    $('set-quality').value = settings.quality;
    $('set-weather').checked = settings.weatherFx;
    $('set-datasaver').checked = settings.dataSaver;
    $('set-awake').checked = settings.keepAwake;
    $('set-compass').checked = settings.compassFollow;
    $('set-units').value = settings.units;
    $('set-text').value = settings.textSize;
    $('set-motion').checked = settings.reduceMotion;
    $('set-sound').checked = settings.sound;
    $('set-beta').innerHTML = Object.entries(FEATURES).filter(([k]) => featureAvailable(k))
      .map(([k, f]) => `<label class="set check"><input type="checkbox" data-feature="${k}" ${settings.features?.[k] !== false ? 'checked' : ''}/> ${esc(f.label)}</label>`).join('');
    $('set-names').value = settings.placeNames;
    $('set-awake').disabled = !('wakeLock' in navigator);
    $('set-compass').disabled = !compassSupported;
    tierInfo();
    renderPlaytest();
    $('settings').hidden = false;
  }
  const tierInfo = () => { $('set-info').textContent = `Now: ${ctx.tier.label}${settings.quality === 'auto' ? ' (auto)' : ''}${ctx.batteryLow ? ' · battery low' : ''}`; };

  $('p-settings').onclick = open;
  $('set-close').onclick = () => { $('settings').hidden = true; };
  $('set-quality').onchange = (e) => { settings.quality = e.target.value; saveSettings(); ctx.applyTier(startTier()); tierInfo(); };
  $('set-weather').onchange = (e) => { settings.weatherFx = e.target.checked; saveSettings(); };
  $('set-datasaver').onchange = (e) => { settings.dataSaver = e.target.checked; game.dataSaver = settings.dataSaver; saveSettings(); ctx.applyTier(ctx.tierName); };
  $('set-awake').onchange = (e) => { settings.keepAwake = e.target.checked; saveSettings(); keepAwake(game.mode === 'present' && settings.keepAwake); };
  $('set-compass').onchange = async (e) => {
    settings.compassFollow = e.target.checked; saveSettings();
    if (e.target.checked && !ctx.compassOn) { ctx.compassOn = await startCompass(); $('compass').classList.toggle('on', ctx.compassOn); }
  };
  $('set-names').onchange = (e) => { settings.placeNames = e.target.value; saveSettings(); };
  $('set-units').onchange = (e) => { settings.units = e.target.value; saveSettings(); ctx.hud.render(); };
  $('set-text').onchange = (e) => { settings.textSize = e.target.value; saveSettings(); applyLook(); };
  $('set-motion').onchange = (e) => { settings.reduceMotion = e.target.checked; saveSettings(); applyLook(); };
  $('set-sound').onchange = (e) => { settings.sound = e.target.checked; saveSettings(); settings.sound ? ambience.start() : ambience.stop(); };

  // game feature switches (both versions); beta extras: copy the real profile in
  $('beta-box').hidden = !Object.keys(FEATURES).some(featureAvailable);
  $('beta-title').textContent = BETA ? 'Beta experiments' : 'Game features';
  $('set-beta').addEventListener('change', (e) => {
    const k = e.target.dataset.feature;
    if (!k) return;
    settings.features = { ...(settings.features || {}), [k]: e.target.checked };
    saveSettings(); ctx.applyFeatures();
    if (k === 'geocaching' && e.target.checked) world.refreshSources();
  });
  for (const el of document.querySelectorAll('.beta-only')) el.hidden = !BETA;
  if (BETA) {
    $('beta-import').onclick = () => {
      const raw = storage.get(STABLE_PROFILE_KEY);
      if (!raw) return toast('No main-version profile found on this device.', 'error');
      if (!confirm('Replace your beta profile with a copy of your main profile? Your main profile is not changed.')) return;
      try { profile.import(raw); journal.ensure(); toast('Copied your main profile into the beta'); setTimeout(() => location.reload(), 600); }
      catch (err) { toast('Copy failed: ' + err.message, 'error'); }
    };
  }
  $('channel-link').href = BETA ? '../' : 'beta/';
  $('channel-link').textContent = BETA ? 'Back to the main version' : 'Try the beta (new experiments)';

  // profile backup
  $('p-export').onclick = () => download(profile.export(), `openworld-profile-${today()}.json`);
  $('p-import').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      profile.import(await f.text());
      journal.ensure();
      ctx.markers.markAllKnown();
      ctx.markers.reset();
      ctx.hud.render(); toast('Profile imported');
    } catch (err) { toast('Import failed: ' + err.message, 'error'); }
    e.target.value = '';
  };
  $('p-reset').onclick = () => { if (confirm('Erase this profile (discoveries, species, cards, home base)?')) { profile.reset(); location.reload(); } };

  // playtest stats (local only)
  const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
  const secs = (x) => (x == null ? '–' : x < 90 ? `${Math.round(x)} s` : `${Math.round(x / 60)} min`);
  function renderPlaytest() {
    const s = metrics.summary();
    const rows = !s.sessions ? [['Sessions', 'none yet']] : [
      ['Sessions', s.sessions],
      ['Typical session', s.medianMinutes == null ? '–' : `${Math.round(s.medianMinutes)} min`],
      [`Something to chase within ${CHASE_GOAL_S / 60} min`, pct(s.chaseWithinGoal)],
      ['Time to first chase', secs(s.medianFirstChaseS)],
      ['Time to first new find', secs(s.medianFirstDiscoveryS)],
      ['Distance per session', s.medianMeters == null ? '–' : fmtDist(s.medianMeters)],
      ['Hunts started', s.hunts],
      ['…found / fled / went cold', `${pct(s.huntCaught)} / ${pct(s.huntFled)} / ${pct(s.huntCold)}`],
      ['Treasure found once hot', pct(s.treasureFoundWhenHot)],
      ['Assignments done', s.tasksDone],
      ...(s.questsStarted ? [['Expeditions started / finished', `${s.questsStarted} / ${s.questsDone}`]] : []),
    ];
    $('playtest-stats').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  }
  $('playtest-export').onclick = () => download(metrics.export(), `openworld-playtest-${today()}.json`);
  $('playtest-clear').onclick = () => { if (confirm('Clear the playtest stats on this device?')) { metrics.clear(); renderPlaytest(); } };

  // help & about (static page; opened from settings or the start screen)
  function openAbout(e) { e?.preventDefault(); $('settings').hidden = true; $('about').hidden = false; }
  $('p-about').onclick = openAbout;
  $('s-about').onclick = openAbout;
  $('about-close').onclick = () => { $('about').hidden = true; };
  $('about').addEventListener('click', (e) => { if (e.target.id === 'about') $('about').hidden = true; });

  function applyLook() {
    document.body.classList.toggle('text-lg', settings.textSize === 'large');
    document.body.classList.toggle('reduce-motion', settings.reduceMotion);
  }
  applyLook();
  // sound may only start from a user gesture: resume on the first tap if it was left on
  if (settings.sound) addEventListener('pointerdown', () => settings.sound && ambience.start(), { once: true });

  return { open };
}
