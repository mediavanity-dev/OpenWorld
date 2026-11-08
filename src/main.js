// App entry: creates the renderer and the core objects, wires the modules together through
// one shared context (`ctx`), runs the frame loop (adaptive quality + frame cap) and the
// start screen. Everything else lives in its own module:
//   render/  avatar, beacons & home, creatures, hunt tracks & treasure mote
//   ui/      HUD, floating labels, camera AR, settings, cards, journal, minimap, tutorial

import * as THREE from 'three';
import { World } from './world/world.js';
import { Sky } from './world/sky.js';
import { Profile } from './game/profile.js';
import { Game, MODES, RULES } from './game/game.js';
import { Environment } from './game/environment.js';
import { Journal } from './game/journal.js';
import { Quests } from './game/quests.js';
import { Metrics } from './game/metrics.js';
import { deviceFix, ipFix, watchDevice } from './game/locator.js';
import { GROUP_STYLE } from './data/wildlife.js';
import { getJson } from './data/net.js';
import { pruneCache } from './data/cache.js';
import { cachesIn, nodesFor } from './data/geocaching.js';
import { deepPlaces } from './data/deep.js';
import { getAtlas, iconVisibility } from './world/icons.js';
import { iconUniforms, iconMat } from './world/materials.js';
import { wildHabitat } from './world/habitats.js';
import { haversine } from './geo.js';
import { settings, saveSettings, TIERS, startTier, isTouch } from './settings.js';
import { storage, onStorageError, isVolatile } from './storage.js';
import { startCompass, stopCompass, onHeading, currentHeading, keepAwake, watchBattery, buzz } from './sensors.js';
import { BETA, FEATURES, featureAvailable, storeKey, SHOW_BEACONS } from './channel.js';
import { Controls } from './ui/controls.js';
import { initCard, showPlace, showSpecies, showHere, closeCard } from './ui/card.js';
import { Minimap } from './ui/minimap.js';
import { initJournal, openJournal } from './ui/journalView.js';
import { runTutorial, tutorialDone, showHint } from './ui/tips.js';
import { fmtDist } from './units.js';
import { toast, fixText, initHud } from './ui/hud.js';
import { initLabels } from './ui/labels.js';
import { initArMode } from './ui/arMode.js';
import { initSettingsPanel } from './ui/settingsPanel.js';
import { initRephoto } from './ui/rephoto.js';
import { initExpeditions } from './ui/expeditions.js';
import { initHomeSetup } from './ui/homeSetup.js';
import { initAvatar } from './render/avatar.js';
import { initMarkers } from './render/markers.js';
import { initCritters } from './render/critters.js';
import { initEffects } from './render/effects.js';
import { Ambience } from './audio.js';
import { WALK, renameStaticText } from './names.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- renderer + quality
const renderer = new THREE.WebGLRenderer({ antialias: !isTouch, alpha: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
$('app').appendChild(renderer.domElement);
const scene = new THREE.Scene();
iconUniforms.uAtlas.value = new THREE.CanvasTexture(getAtlas()); // place-class icons (drawn once)
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 8000);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
const world = new World(scene, { anisotropy: Math.min(isTouch ? 4 : 8, renderer.capabilities.getMaxAnisotropy()) });

// ---------------------------------------------------------------- core + shared context
const profile = new Profile();
const environment = new Environment(() => ctx.hud.render());
const metrics = new Metrics();
const game = new Game(world, profile, environment, onGameEvent);
const journal = new Journal(profile, environment, (ev) => onGameEvent(ev));
game.journal = journal;
journal.chunkAt = (lat, lon) => world.chunkAt(lat, lon); // depth of exploration per area
game.quests = new Quests(game, (ev) => onGameEvent(ev));
game.dataSaver = settings.dataSaver;

const ctx = {
  renderer, scene, camera, world, game, profile, environment, journal, metrics, settings,
  sky: new Sky(scene),
  ambience: new Ambience(),
  tierName: startTier(),
  get tier() { return TIERS[this.tierName]; },
  batteryLow: false,
  compassOn: false,
  view: { geo: null, local: { x: 0, z: 0 } }, // where the camera is looking (labels follow the view)
  applyTier, applyFeatures, openPlace,
};
ctx.controls = new Controls(renderer.domElement, $('stick'), { onTap: pick });
ctx.hud = initHud(ctx);
ctx.avatar = initAvatar(ctx);
ctx.markers = initMarkers(ctx);
ctx.critters = initCritters(ctx);
ctx.effects = initEffects(ctx);
ctx.arMode = initArMode(ctx);
ctx.labels = initLabels(ctx);
ctx.rephoto = initRephoto(ctx);
ctx.settingsPanel = initSettingsPanel(ctx);
ctx.expeditions = initExpeditions(ctx);
ctx.homeSetup = initHomeSetup(ctx, { parsePlace: (q) => parsePlace(q) });
ctx.minimap = new Minimap($('minimap'), { onTap: () => openJournal('map') });
const { controls, hud, avatar, markers, critters, effects, arMode, labels, ambience, sky } = ctx;

function applyTier(name, why) {
  ctx.tierName = name;
  const tier = TIERS[name];
  renderer.setPixelRatio(Math.min(devicePixelRatio, tier.pixelRatio));
  world.setQuality({ tex: tier.tex, maxTrees: tier.maxTrees, ring: tier.ring, detail: !settings.dataSaver });
  if (why) toast(`Graphics: ${tier.label} (${why})`);
}
applyTier(ctx.tierName);

// game features (graduated or beta-only): on unless switched off in settings
function applyFeatures() {
  game.features = {};
  for (const k of Object.keys(FEATURES)) if (featureAvailable(k)) game.features[k] = settings.features?.[k] !== false;
  if (!game.features.hunt) game.hunt = null;
  if (!game.features.quests) ctx.expeditions?.close();
  ctx.hud?.render();
}
applyFeatures();
if (BETA) document.body.classList.add('beta');
renameStaticText(); // beta: plainer names (Walk / walked) in the page's fixed text
if (!SHOW_BEACONS) document.body.classList.add('no-beacons'); // hidden until shared content (BACKLOG 1)

// saving problems are the one thing a player must hear about
onStorageError(() => {
  if (ctx._storageWarned) return;
  ctx._storageWarned = true;
  toast("Couldn't save your progress: this device's storage is full. Export a backup in the panel.", 'error');
});
if (profile.loadError) setTimeout(() => toast(`Your saved profile couldn't be loaded (${profile.loadError.message}). It has been kept untouched; you're playing on a fresh one.`, 'error'), 1500);
if (isVolatile()) setTimeout(() => toast('This browser is blocking storage (private mode?), so progress will be lost when you close it.', 'error'), 1500);

world.addSource(async (chunk) => {
  if (!game.features.geocaching) return [];
  const lists = await Promise.all(nodesFor(environment.country).map((n) => cachesIn(chunk.bounds, n, chunk.key)));
  return lists.flat();
});

// beta: the deep layer, in areas you know well (half walked); see src/data/deep.js
world.addSource(async (chunk) => {
  if (!game.features.deep || !profile.data.areas?.[chunk.key]?.deep || settings.dataSaver) return [];
  return deepPlaces(chunk.bounds, chunk.key);
});

let firstChunk = true;
const reveals = new Map(); // chunk -> start time (rise-in animation)
let lastLoadAt = 0;
world.on((ev) => {
  if (ev.type === 'chunk') {
    lastLoadAt = performance.now();
    if (settings.reduceMotion || firstChunk) ev.chunk.reveal(1); else { ev.chunk.reveal(0); reveals.set(ev.chunk, performance.now()); }
  }
  if (ev.type === 'chunk' || ev.type === 'detail') {
    journal.onArea(ev.chunk);
    markers.markKnown(ev.chunk);
    markers.refreshBeacons();
    if (firstChunk && ev.type === 'chunk') { firstChunk = false; avatar.snap(); }
    if (arMode.active) arMode.setWorldVisible(ev.chunk, false);
  }
  if (ev.type === 'remote') markers.refreshBeacons();
  if (ev.type === 'status' || ev.type === 'detail') hud.worldStatus();
});

// ---------------------------------------------------------------- input, picking, card
const raycaster = new THREE.Raycaster();
function pick(cx, cy) {
  if (!game.pos) return;
  const ndc = new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(critters.meshes(), false)[0];
  if (!hit) { const poi = arMode.active ? null : pickPlace(cx, cy); return poi ? openPlace(poi) : closeCard(); }
  if (hit.object.userData.critter) {
    const c = hit.object.userData.critter;
    if (arMode.active) return arMode.photographCritter(c);
    const label = GROUP_STYLE[c.sp.group]?.label || 'creature';
    return toast(`${/^[aeiou]/.test(label) ? 'An' : 'A'} ${label}: walk up to it to see what it is.`, 'species');
  }
}
// nearest place icon to a tap, in screen space (generous ~30 px target)
const pv = new THREE.Vector3(), pu = new THREE.Vector3();
function pickPlace(cx, cy) {
  const c = ctx.view.geo || game.pos;
  let best = null, bestD = 30 * 30;
  for (const { poi, chunk } of world.pois(c.lat, c.lon, Math.max(700, controls.dist * 4))) {
    pv.set(poi.x, poi.y - 2.5, poi.z).add(chunk.group.position);
    const depth = pv.distanceTo(camera.position), size = Math.min(46, Math.max(1.6, depth * 0.05));
    if (iconVisibility(poi.pri ?? 2, controls.dist, depth) < 0.3) continue; // can't tap what you can't see
    pu.copy(pv).addScaledVector(camera.up, size * 0.55).project(camera); // icon centre
    if (pu.z > 1) continue;
    const dx = ((pu.x + 1) / 2) * innerWidth - cx, dy = ((1 - pu.y) / 2) * innerHeight - cy, d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = poi; }
  }
  return best;
}
function openPlace(poi) {
  showPlace(poi, { game, profile, distance: haversine(game.pos.lat, game.pos.lon, poi.lat, poi.lon), onLogged: () => markers.markAllKnown() });
}
initCard();

addEventListener('keydown', (e) => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || !game.mode) return;
  if (e.code === 'KeyB' && SHOW_BEACONS) { game.placeBeacon(); markers.refreshBeacons(); hud.render(); }
  if (e.code === 'KeyH') setClean(!document.body.classList.contains('clean'));
  if (e.code === 'KeyC') controls.recenter();
});

// ---------------------------------------------------------------- compass / heading
onHeading((h) => { game.heading = h; });
$('compass').onclick = async () => {
  if (ctx.compassOn) { stopCompass(); ctx.compassOn = false; settings.compassFollow = false; }
  else if (await startCompass()) { ctx.compassOn = true; settings.compassFollow = true; toast('Compass on: the camera turns with your phone.'); }
  else toast('Compass not available on this device/browser.', 'error');
  saveSettings();
  $('compass').classList.toggle('on', ctx.compassOn);
};

// ---------------------------------------------------------------- loop (adaptive quality + frame cap)
let last = performance.now(), lastRender = 0;
let hudT = 0, labelT = 0, envT = 0, candT = 0, miniT = 0, ambT = 0;
let facing = 0, wasMoving = false;
const perf = { frames: 0, time: 0, good: 0, changedAt: 0 };
const TIER_ORDER = ['saver', 'balanced', 'high'];
let lastUpd = { lat: 0, lon: 0, t: 0 };
let skyState = { night: 0, precip: null };
const metersWalked = () => { const m = profile.data.stats.meters; return m.present + m.home + m.roam; };

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const move = MODES[game.mode]?.canMove ? controls.move() : null;
  const before = metersWalked();
  const moving = game.tick(dt, move);
  metrics.moved(metersWalked() - before);
  if (move && controls.isAway() && !controls.recentering) controls.recenter();
  const busy = arMode.active || controls.active() || moving || wasMoving || skyState.precip || game.critters.length || !$('card').hidden;
  wasMoving = moving;
  const tier = ctx.tier;
  const cap = busy ? tier.fps : 20; // idle: save battery
  if (now - lastRender < 1000 / cap - 2) return;
  const rdt = Math.min(0.25, (now - lastRender) / 1000);
  lastRender = now;

  // measure real frame rate while busy (ignoring the hitches right after new areas load);
  // step quality down if it can't keep up, and back up when there's headroom again
  if (busy && settings.quality === 'auto' && !ctx.batteryLow && now - lastLoadAt > 8000) {
    perf.frames++; perf.time += rdt;
    if (perf.time > 3) {
      const fps = perf.frames / perf.time;
      perf.frames = 0; perf.time = 0;
      const i = TIER_ORDER.indexOf(ctx.tierName), top = TIER_ORDER.indexOf(startTier());
      if (fps < tier.fps * 0.7 && i > 0) { applyTier(TIER_ORDER[i - 1], 'adjusted for smoother play'); perf.good = 0; perf.changedAt = now; }
      else if (fps >= tier.fps * 0.92 && i < top) {
        if (++perf.good >= 4 && now - perf.changedAt > 20000) { applyTier(TIER_ORDER[i + 1]); perf.good = 0; perf.changedAt = now; }
      } else perf.good = 0;
    }
  }
  // rise-in of newly loaded areas
  for (const [ch, t0] of reveals) {
    const t = Math.min(1, (now - t0) / 650);
    ch.reveal(t);
    if (t >= 1) reveals.delete(ch);
  }

  if (game.pos) {
    // the streaming window only needs a nudge after real movement (or once a second)
    if (now - lastUpd.t > 1000 || Math.abs(game.pos.lat - lastUpd.lat) + Math.abs(game.pos.lon - lastUpd.lon) > 0.0002) {
      lastUpd = { lat: game.pos.lat, lon: game.pos.lon, t: now };
      if (world.update(game.pos.lat, game.pos.lon)) markers.refreshBeacons();
    }
    avatar.update(rdt, world.toLocal(game.pos.lat, game.pos.lon));
    const ag = avatar.group;

    // facing: movement, else compass, else GPS course
    if (move) facing = Math.atan2(-move.east, move.north);
    else if (game.mode === 'present' && (game.heading ?? game.gpsCourse) != null) facing = (-(game.heading ?? game.gpsCourse) * Math.PI) / 180;
    const turn = Math.atan2(Math.sin(facing - ag.rotation.y), Math.cos(facing - ag.rotation.y));
    ag.rotation.y += turn * Math.min(1, rdt * 10);
    if (move && game.heading == null) game.heading = (-facing * 180) / Math.PI;

    if (ctx.compassOn && settings.compassFollow && game.mode === 'present' && currentHeading() != null) {
      const target = (-currentHeading() * Math.PI) / 180;
      const d = Math.atan2(Math.sin(target - controls.yaw), Math.cos(target - controls.yaw));
      controls.yaw += d * Math.min(1, rdt * 4);
    }

    if (arMode.active) {
      arMode.step(rdt);
      ctx.view.geo = game.pos;
    } else {
      controls.step(rdt);
      iconUniforms.uViewDist.value = controls.dist;
      const tx = ag.position.x + controls.pan.x, tz = ag.position.z + controls.pan.z, dist = controls.dist;
      const tg = world.toGeo(tx, tz);
      const ty = (controls.pan.x || controls.pan.z ? world.groundAt(tg.lat, tg.lon) ?? avatar.y : avatar.y) + 1.6;
      ctx.view.geo = tg;
      ctx.view.local.x = tx; ctx.view.local.z = tz;
      $('recenter').hidden = !controls.isAway();
      camera.position.set(
        tx + Math.sin(controls.yaw) * Math.cos(controls.pitch) * dist,
        ty + Math.sin(controls.pitch) * dist,
        tz + Math.cos(controls.yaw) * Math.cos(controls.pitch) * dist,
      );
      const cg = world.toGeo(camera.position.x, camera.position.z);
      const floor = world.groundAt(cg.lat, cg.lon);
      if (floor !== null && camera.position.y < floor + 2) camera.position.y = floor + 2;
      camera.lookAt(tx, ty, tz);
      const near = Math.min(4, Math.max(0.3, dist * 0.01)), far = Math.max(4000, dist * 8);
      if (Math.abs(camera.near - near) > 0.05 || camera.far !== far) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); }

      skyState = sky.update(environment, game.pos, camera.position, rdt, { particles: settings.weatherFx ? tier.particles : 0, viewDist: dist, reduceMotion: settings.reduceMotion });
      document.body.classList.toggle('night', skyState.night > 0.6);
    }
    critters.sync(now);
    effects.sync(now, rdt); // hunt tracks + treasure mote (both versions since they graduated)
  }
  if (!settings.reduceMotion) markers.animate(now);
  miniT += rdt;
  if (miniT > 0.25 && game.pos && !$('hud').hidden) {
    miniT = 0;
    const bearing = arMode.active ? arMode.heading() : (-controls.yaw * 180) / Math.PI;
    ctx.minimap.draw({ pos: game.pos, bearing, cells: profile.data.cells, pois: [...world.pois(game.pos.lat, game.pos.lon, 600)].map((x) => x.poi), critters: game.critters, home: profile.data.home, discovered: profile.data.discoveries, hunt: game.hunt, treasure: game.treasureHint, quest: ctx.expeditions.minimap(), t: now });
    hud.tracker();
  }
  ambT += rdt;
  if (ambT > 1 && ambience.on && game.pos) {
    ambT = 0;
    const w = environment.weather, sun = environment.sun(game.pos.lat, game.pos.lon);
    const hab = wildHabitat(world.habitatAt(game.pos.lat, game.pos.lon));
    ambience.update({ wind: w?.wind ?? 8, rain: w && /rain|storm/.test(w.kind) ? 1 : w?.kind === 'drizzle' ? 0.4 : 0, day: sun.alt > 0 ? 1 : 0, green: hab !== 'urban', warm: (w?.tempC ?? 10) > 14 });
  }

  candT += rdt; if (candT > 0.2) { candT = 0; labels.refreshCandidates(); ctx.rephoto.check(); }
  labelT += rdt; if (arMode.active || labelT > 0.05) { labelT = 0; labels.update(); }
  if (arMode.active) { arMode.updateRibbon(now); ctx.rephoto.step(now); }
  hudT += rdt; if (hudT > 0.3) { hudT = 0; hud.render(); }
  envT += rdt; if (envT > 10 && game.pos) { envT = 0; environment.refresh(game.pos.lat, game.pos.lon); }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- events
function onGameEvent(ev) {
  metrics.record(ev);
  if (ev.type === 'error') toast(ev.msg, 'error');
  else if (ev.type === 'discover') { toast(ev.msg, ev.grade); buzz(ev.grade === 'echo' ? 30 : [40, 60, 40]); }
  else if (ev.type === 'mode') {
    if (ev.mode !== 'present') arMode.exit();
    toast(ev.msg, ev.mode === 'roam' ? 'echo' : ev.mode);
    avatar.style(); markers.refreshLeash(); requestAnimationFrame(placeToasts);
    keepAwake(ev.mode === 'present' && settings.keepAwake);
  } else if (ev.type === 'critter') { toast(ev.msg, 'species'); buzz(25); }
  else if (ev.type === 'critter-gone') { /* it wandered off */ }
  else if (ev.type === 'spotted') {
    buzz([30, 40, 30, 40, 60]);
    showSpecies(ev.critter.sp, { result: ev.result, grade: ev.grade, autoClose: 12000, pos: game.pos });
    hud.render();
  } else if (ev.type === 'beacon') { toast(ev.msg); markers.refreshBeacons(); }
  else if (ev.type === 'rock') { toast(ev.msg, 'rock'); buzz(30); }
  else if (ev.type === 'task') { toast(ev.msg, 'species'); buzz([40, 50, 40, 50, 80]); hud.render(); }
  else if (ev.type === 'hunt') { toast(ev.msg, 'species'); buzz(15); ambience.chime(0); }
  else if (ev.type === 'hunt-signal-up') { buzz(8 + ev.hunt.signal * 6); ambience.chime(ev.hunt.signal); }
  else if (ev.type === 'hunt-tracks') { buzz(12); }
  else if (ev.type === 'hunt-reveal') { buzz([20, 40, 20]); ambience.chime(7); }
  else if (ev.type === 'hunt-flee' || ev.type === 'hunt-cold') { toast(ev.msg); }
  else if (ev.type === 'treasure-hot') { buzz([12, 30, 12]); ambience.chime(5); }
  else if (ev.type === 'geocache') { toast(ev.msg, 'gold'); buzz([30, 40, 30]); ambience.chime(6); hud.render(); }
  else if (ev.type === 'deep-unlock') { if (game.features.deep) { toast(ev.msg, 'gold'); buzz([40, 60, 40, 60, 120]); ambience.chime(10); world.refreshSources(); } }
  else if (ev.type === 'area-tier') { toast(ev.msg, 'gold'); buzz([30, 40, 30, 40, 60]); ambience.chime(8); }
  else if (ev.type === 'treasure') { toast(ev.msg, 'gold'); buzz([30, 40, 60]); ambience.chime(9); hud.render(); }
  else if (ev.type === 'rephoto') { toast(ev.msg, 'gold'); buzz([30, 40, 60]); ambience.chime(8); hud.render(); }
  else if (ev.type.startsWith('quest')) ctx.expeditions.onEvent(ev);
  else if (ev.msg) toast(ev.msg);
}

// ---------------------------------------------------------------- actions
async function parsePlace(q) {
  const m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) > 85 || Math.abs(lon) > 180) throw new Error('Coordinates out of range');
    return { lat, lon };
  }
  const j = await getJson(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { timeout: 10000 })
    .catch((err) => { throw new Error(`Place search failed (${err.message}). Try again in a moment.`); });
  if (!j[0]) throw new Error(`No place found for "${q}"`);
  return { lat: +j[0].lat, lon: +j[0].lon, name: j[0].display_name };
}

let stopWatch = null;
function startWatching() {
  stopWatch?.();
  let warned = false;
  stopWatch = watchDevice((f) => { game.setFix(f); warned = false; }, (e) => {
    console.warn(e);
    if (!warned) { warned = true; toast(`Lost your device location (${e.message || 'permission or signal'}). ${WALK} mode will resume when it returns.`, 'error'); }
  });
}

function begin(mode, opts) {
  stopWatch?.(); stopWatch = null;
  if (game.enter(mode, opts)) {
    $('start').hidden = true;
    $('hud').hidden = false;
    controls.pan.x = controls.pan.z = 0;
    if (mode === 'present' && game.fix?.source === 'device') startWatching();
    avatar.snap();
    avatar.style();
    environment.refresh(game.pos.lat, game.pos.lon);
    hud.render();
    // beta: deal the expedition board straight away (the tiny tutorial waits until it's closed)
    const after = () => { if (!tutorialDone()) setTimeout(startTutorial, 400); };
    if (!ctx.expeditions.openOnStart(after)) after();
    return true;
  }
  return false;
}

async function locate(getFix, failText, msgEl, busyText) {
  if (msgEl) msgEl.textContent = busyText;
  try {
    const f = await getFix();
    game.setFix(f);
    if (msgEl) msgEl.textContent = '';
    return f;
  } catch (e) {
    const m = failText(e);
    msgEl ? (msgEl.textContent = m) : toast(m, 'error');
    return null;
  }
}
const locateDevice = (msgEl) => locate(deviceFix, (e) => (BETA ? `Couldn’t get this device’s location (${e.message}).` : `Device location failed: ${e.message}. Try "via internet" instead.`), msgEl, 'Asking your device for its location…');
// beta: Present always needs a fresh, real device location. If there isn't one: computers are
// pointed to a home base (that's how to play from a computer); phones to the location setting.
async function presentNow(msgEl) {
  if (await locateDevice(msgEl)) return begin('present');
  if (!isTouch) return ctx.homeSetup.open({ reason: `<b>${WALK} needs this device’s real location</b>, and it couldn’t be found. To play from a computer, set a home base and play <b>Home</b>.`, onSet: () => homeWasSet(true) });
  toast(`${WALK} needs your location. Allow location for this site in your browser settings, then try again.`, 'error');
  return false;
}
const locateIp = (msgEl) => locate(ipFix, (e) => e.message, msgEl, 'Looking up your internet connection’s location…');

// start screen
const sMsg = $('s-msg');
if (profile.data.home) $('s-home').hidden = false;
if (profile.data.last) $('s-resume').hidden = false;
$('s-device').onclick = async () => { if (BETA) return presentNow(sMsg); if (await locateDevice(sMsg)) begin('present'); };
$('s-ip').onclick = async () => {
  if (await locateIp(sMsg)) {
    begin('present');
    toast('IP location is approximate (city-level) and you can’t walk on it. Set it as your home base to move around.', 'home');
  }
};
$('s-home').onclick = () => enterHome();
$('s-sethome').hidden = !BETA || !!profile.data.home || isTouch;
$('s-sethome').onclick = () => ctx.homeSetup.open({ onSet: () => homeWasSet(true) });
$('s-resume').onclick = () => begin('roam', { to: profile.data.last });
$('s-roam-form').onsubmit = async (e) => {
  e.preventDefault();
  try { sMsg.textContent = 'Finding place…'; begin('roam', { to: await parsePlace($('s-roam').value) }); }
  catch (err) { sMsg.textContent = err.message; }
};
document.querySelectorAll('.presets a').forEach((a) => (a.onclick = () => {
  const [lat, lon] = a.dataset.to.split(',').map(Number);
  begin('roam', { to: { lat, lon } });
}));

// HUD
document.querySelectorAll('.tabs button[data-mode]').forEach((b) => (b.onclick = async () => {
  const mode = b.dataset.mode;
  if (mode === game.mode) return;
  if (mode === 'present' && BETA) return presentNow(); // always a fresh fix, never a stale or internet one
  if (mode === 'present' && !game.fix && !(await locateDevice())) return;
  if (mode === 'home') return enterHome();
  begin(mode, mode === 'roam' ? { to: game.pos } : {});
}));

// Home mode, with a short pointer to how you get around in it (each time; "Don't show again" stops it).
// Without a home base yet, the pointer explains how to set one instead of a bare error.
function enterHome() {
  const range = fmtDist(RULES.LEASH_M);
  if (!profile.data.home) {
    if (BETA) return ctx.homeSetup.open({ reason: `<b>Home needs a home base first.</b> Set one and you can wander ${range} around it from anywhere.`, onSet: () => homeWasSet(true) });
    const shown = game.mode && showHint({ target: () => document.querySelector('.tabs button[data-mode="present"]'), timeout: 12000,
      text: `<b>Set a home base first.</b> Go <b>${WALK}</b> (where you really are) and tap <b>Set home base</b>. After that, Home lets you wander ${range} around it from anywhere.` });
    if (!shown) toast(`No home base yet. Go ${WALK} and set one; then Home lets you wander ${range} around it from anywhere.`, 'error');
    return;
  }
  if (!begin('home')) return;
  // close the hint once they've been moving for a moment (they've got it)
  const until = (close) => { let n = 0; const id = setInterval(() => { if (controls.move() && ++n >= 5) close(); }, 300); return () => clearInterval(id); };
  const text = isTouch
    ? `<b>Use the joystick to wander.</b> Go anywhere within ${range} of your home base (the blue ring). Push it all the way out to run.`
    : `<b>Use W A S D or the arrow keys to wander.</b> Go anywhere within ${range} of your home base (the blue ring). Hold Shift to run.`;
  // wait a moment for the mode switch (and the joystick) to appear, and for the expedition board to close
  ctx.expeditions.whenClear('home-hint', () => setTimeout(() => showHint({ key: 'home', text, until, target: () => (isTouch ? $('stick') : document.querySelector('.tabs button[data-mode="home"]')) }), 400));
}
const left = $('left');
function setCollapsed(on) {
  left.classList.toggle('collapsed', on);
  document.body.classList.toggle('menu-open', !on); // phones: the minimap steps aside while the menu is open
  $('more').setAttribute('aria-expanded', String(!on));
  placeToasts();
}
// phones: while the menu is open, messages appear just below it instead of on top of it
function placeToasts() {
  const open = document.body.classList.contains('menu-open') && innerWidth <= 720 && !$('hud').hidden;
  $('toasts').style.top = open ? `${Math.round(left.getBoundingClientRect().bottom + 8)}px` : '';
}
addEventListener('resize', placeToasts);
// phones: the joystick and loading text sit just above the bottom-anchored stats panel
if ('ResizeObserver' in window) new ResizeObserver(([e]) => document.documentElement.style.setProperty('--panel-h', `${Math.round(e.target.offsetHeight)}px`)).observe($('right'));
setCollapsed(isTouch);
$('more').onclick = () => setCollapsed(!left.classList.contains('collapsed'));
$('nearest').onclick = () => { if (game.features.quests) return ctx.expeditions.open(); if (game.taskTarget && !journal.task().done) openPlace(game.taskTarget.poi); else openJournal('overview'); };
$('b-locate').onclick = async () => { if (await locateDevice()) { if (game.mode === 'present') begin('present'); else toast('Device fix updated: ' + fixText(game.fix)); } };
$('b-ip').onclick = async () => { if (await locateIp()) { if (game.mode === 'present') begin('present'); else toast('Fix updated: ' + fixText(game.fix)); } };
$('b-sethome').onclick = () => {
  if (BETA) return ctx.homeSetup.open({ onSet: () => homeWasSet(game.mode !== 'present') });
  if (profile.data.home && !confirm('Move your home base here? It can then not be moved again for 30 days.')) return;
  if (!profile.data.home && !confirm('Set your permanent home base at your current real location?')) return;
  if (game.setHome()) { $('s-home').hidden = false; markers.refreshBeacons(); hud.render(); }
};
$('b-beacon').onclick = () => { const label = prompt('Beacon label?', `Beacon ${profile.data.beacons.length + 1}`); if (label !== null) { game.placeBeacon(label); markers.refreshBeacons(); hud.render(); } };
$('h-roam-form').onsubmit = async (e) => {
  e.preventDefault();
  try { const to = await parsePlace($('h-roam').value); begin('roam', { to }); $('h-roam').value = ''; $('h-roam').blur(); }
  catch (err) { toast(err.message, 'error'); }
};

// journal + this spot
initJournal({ profile, game, onQuests: () => ctx.expeditions.open('today'), onSpecies: (id) => { const x = profile.data.species[id]; if (x) showSpecies({ id, name: x.name, sci: x.sci, group: x.group }, { grade: x.grade, pos: game.pos }); } });
$('b-journal').onclick = () => openJournal();
$('b-here').onclick = () => {
  if (!game.pos) return;
  const ch = world.chunkAt(game.pos.lat, game.pos.lon);
  showHere(game.pos, { game, areaName: ch?.areaName, elevation: world.groundAt(game.pos.lat, game.pos.lon) });
};

// battery-aware quality
watchBattery((b) => {
  const wasLow = ctx.batteryLow;
  ctx.batteryLow = b.low;
  if (settings.quality !== 'auto' || wasLow === ctx.batteryLow) return;
  if (ctx.batteryLow) applyTier('saver', 'battery low');
  else applyTier(startTier(), 'charging / battery ok');
});

// map-only view toggle (button, or H on a keyboard); remembered per device
const UI_KEY = storeKey('cleanView');
function setClean(on) {
  document.body.classList.toggle('clean', on);
  $('ui-toggle').setAttribute('aria-label', on ? 'Show interface' : 'Hide interface');
  storage.set(UI_KEY, on ? '1' : '0');
}
// first-ever visit: start with everything hidden; the mini tutorial points at the eye
const firstRun = !tutorialDone() && storage.get(UI_KEY) === null && !profile.data.last;
setClean(firstRun || storage.get(UI_KEY) === '1');
function startTutorial() {
  if (tutorialDone() || arMode.active) return;
  // deliberately tiny: show the eye, then one pointer, then never again
  const steps = [];
  if (document.body.classList.contains('clean')) steps.push({ target: () => $('ui-toggle'), text: '<b>Tap to show the menus.</b>', waitFor: 'click' });
  const first = game.features.quests ? '<b>✦ Expeditions</b>: quests from the real world around you. Tap the glowing box to pick your first one.' : "Today's field assignment: follow its arrow.";
  steps.push({ target: () => $('nearest'), text: `${first} Tap any icon for details. ${isTouch ? 'Pinch to zoom.' : 'Scroll to zoom.'} More in Settings → Help.` });
  runTutorial(steps);
}
$('ui-toggle').onclick = () => setClean(!document.body.classList.contains('clean'));
$('recenter').onclick = () => controls.recenter();
$('tracker').addEventListener('click', () => { if (game.features.quests && ctx.expeditions.chip()) return ctx.expeditions.open(); if (game.taskTarget && !journal.task().done) openPlace(game.taskTarget.poi); });

// a new home base: refresh what depends on it, and (optionally) go there
function homeWasSet(go) {
  $('s-home').hidden = false; $('s-sethome').hidden = true;
  markers.refreshBeacons(); hud.render();
  if (go) enterHome();
}

// deep link: ?at=lat,lon starts directly in Roam there
const at = new URLSearchParams(location.search).get('at');
if (at) parsePlace(at).then((to) => begin('roam', { to })).catch((e) => (sMsg.textContent = e.message));
// beta: returning players skip the start screen (first-timers still see it)
else if (BETA && profile.data.last) autoStart();

// a friend's explorer card link (#friend=CODE): add them to your league (beta), then tidy the URL
function friendFromLink() {
  const m = /^#friend=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  const go = () => ctx.expeditions.friendLink(m[1]);
  if (game.mode) go(); else { const id = setInterval(() => { if (game.mode) { clearInterval(id); setTimeout(go, 800); } }, 400); }
}
friendFromLink();
addEventListener('hashchange', friendFromLink);

// Phones start where they really are; computers start at their home base, or are helped to
// set one up. If that fails or they'd rather not, the start screen is the fallback.
async function autoStart() {
  $('start').hidden = true;
  const fallback = (m = '') => { if (!game.mode) { $('start').hidden = false; sMsg.textContent = m; } };
  if (isTouch) {
    toast('Finding where you are…');
    if (await locateDevice()) return begin('present');
    return fallback('Couldn’t get your location. Choose how to start:');
  }
  if (profile.data.home) return enterHome();
  ctx.homeSetup.open({
    reason: '<b>Welcome back!</b> To play from this computer you need a home base. It takes a few seconds, and only once.',
    onSet: () => homeWasSet(true),
    onLater: () => fallback(),
  });
}

// housekeeping: drop stale cached reference data once the game is idle
setTimeout(() => pruneCache().catch(() => {}), 15000);

// installable app + instant reloads (production builds only)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// debug handle
window.openworld = {
  iconMat, iconUniforms, world, game, profile, environment, settings, applyTier, camera, ar: arMode.ar, journal, ambience, metrics, ctx,
  __refresh: () => labels.refreshCandidates(), __open: (p) => openPlace(p), __labels: () => labels.update(),
  get __cand() { return labels.candidates; }, get __view() { return { viewLocal: ctx.view.local, dist: controls.dist }; },
  __setDist: (d) => { controls.dist = d; }, get tier() { return ctx.tierName; },
};
