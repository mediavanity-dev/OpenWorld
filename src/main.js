import * as THREE from 'three';
import { World } from './world/world.js';
import { Sky } from './world/sky.js';
import { Profile } from './game/profile.js';
import { Game, MODES, RULES } from './game/game.js';
import { Environment } from './game/environment.js';
import { resolveAnchor } from './game/anchors.js';
import { deviceFix, ipFix, watchDevice, trustOf } from './game/locator.js';
import { aqiLabel } from './data/weather.js';
import { GROUP_STYLE } from './data/wildlife.js';
import { haversine } from './geo.js';
import { settings, saveSettings, TIERS, startTier, isTouch } from './settings.js';
import { startCompass, stopCompass, onHeading, currentHeading, compassSupported, keepAwake, watchBattery, buzz } from './sensors.js';
import { Controls } from './ui/controls.js';
import { initCard, showPlace, showSpecies, closeCard } from './ui/card.js';
import { ARView, arSupported } from './ar.js';

const $ = (id) => document.getElementById(id);
const MODE_COLOR = { present: '#ff7a3d', home: '#3db8ff', roam: '#b07aff' };

// ---------------------------------------------------------------- renderer + quality
const renderer = new THREE.WebGLRenderer({ antialias: !isTouch, alpha: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
$('app').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 8000);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let tierName = startTier();
let tier = TIERS[tierName];
let batteryLow = false;
const world = new World(scene, { anisotropy: Math.min(isTouch ? 4 : 8, renderer.capabilities.getMaxAnisotropy()) });
function applyTier(name, why) {
  tierName = name;
  tier = TIERS[name];
  renderer.setPixelRatio(Math.min(devicePixelRatio, tier.pixelRatio));
  world.setQuality({ tex: tier.tex, maxTrees: tier.maxTrees, ring: tier.ring, detail: !settings.dataSaver });
  if (why) toast(`Graphics: ${tier.label} (${why})`);
}
applyTier(tierName);

// ---------------------------------------------------------------- core
const sky = new Sky(scene);
const profile = new Profile();
const environment = new Environment(() => renderHud(true));
const game = new Game(world, profile, environment, onGameEvent);
game.dataSaver = settings.dataSaver;
let stopWatch = null;

// ---------------------------------------------------------------- avatar
const avatar = new THREE.Group();
const avatarMat = new THREE.MeshLambertMaterial({ color: MODE_COLOR.present, transparent: true });
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.95, 4, 10), avatarMat);
body.position.y = 0.9;
const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), avatarMat);
head.position.y = 1.85;
const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 8), avatarMat);
nose.rotation.x = -Math.PI / 2; nose.position.set(0, 1.85, -0.38);
const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.5, 32), new THREE.MeshBasicMaterial({ color: MODE_COLOR.present, transparent: true, opacity: 0.8, depthWrite: false }));
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15;
const pointer = new THREE.Mesh(new THREE.ConeGeometry(1, 2, 4), new THREE.MeshBasicMaterial({ color: MODE_COLOR.present }));
pointer.rotation.x = Math.PI;
const accuracyRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64), new THREE.MeshBasicMaterial({ color: '#ff7a3d', transparent: true, opacity: 0.45, depthWrite: false }));
accuracyRing.rotation.x = -Math.PI / 2; accuracyRing.position.y = 0.3;
// the pointer and rings draw on top of everything, so you can always find yourself (even inside a building)
for (const m of [pointer, ring, accuracyRing]) { m.material.depthTest = false; m.renderOrder = 10; }
avatar.add(body, head, nose, ring, pointer, accuracyRing);
scene.add(avatar);
let avatarY = 0;

function styleAvatar() {
  const c = MODE_COLOR[game.mode] || MODE_COLOR.present;
  avatarMat.color.set(c);
  avatarMat.opacity = game.mode === 'roam' ? 0.55 : 1;
  ring.material.color.set(c);
  pointer.material.color.set(c);
  document.body.classList.toggle('no-stick', !MODES[game.mode]?.canMove);
  controls.panMode = game.mode === 'present';
  $('compass').hidden = !(compassSupported && game.mode === 'present');
  $('ar-btn').hidden = !(arSupported() && game.mode === 'present');
}

// ---------------------------------------------------------------- beacons, home, leash
const beaconGroup = new THREE.Group();
scene.add(beaconGroup);
const pillarGeo = new THREE.CylinderGeometry(0.6, 0.6, 60, 8, 1, true).translate(0, 30, 0);
const orbGeo = new THREE.SphereGeometry(1.4, 16, 12);
const homeGeo = new THREE.ConeGeometry(5, 7, 4).translate(0, 3.5, 0);
const STATUS_COLOR = { feature: '#ffd36b', ground: '#5fe0d0', shifted: '#ffa04d', orphaned: '#ff5d5d', pending: '#c9c9c9' };
const beaconObjs = new Map();
let homeObj = null;
let leashLine = null;

function placeAt(obj, lat, lon, y) {
  const o = world.toLocal(lat, lon);
  obj.position.set(o.x, y, o.z);
}

function refreshBeacons() {
  for (const b of profile.data.beacons) {
    let g = beaconObjs.get(b.id);
    if (!g) {
      g = new THREE.Group();
      g.add(new THREE.Mesh(pillarGeo, new THREE.MeshBasicMaterial({ color: '#ffd36b', transparent: true, opacity: 0.35, depthWrite: false })),
        new THREE.Mesh(orbGeo, new THREE.MeshLambertMaterial({ color: '#ffd36b', emissive: '#553b00' })));
      g.children[1].position.y = 2.5;
      beaconObjs.set(b.id, g);
      beaconGroup.add(g);
    }
    const r = resolveAnchor(world, b.anchor);
    g.visible = r.lat !== undefined;
    if (!g.visible) continue;
    placeAt(g, r.lat, r.lon, r.y);
    const c = STATUS_COLOR[r.status];
    g.children[0].material.color.set(c);
    g.children[1].material.color.set(c);
  }
  const h = profile.data.home;
  if (h) {
    if (!homeObj) {
      homeObj = new THREE.Mesh(homeGeo, new THREE.MeshLambertMaterial({ color: MODE_COLOR.home, emissive: '#06324a' }));
      scene.add(homeObj);
    }
    const y = world.groundAt(h.lat, h.lon);
    homeObj.visible = y !== null;
    if (y !== null) placeAt(homeObj, h.lat, h.lon, y);
  }
  refreshLeash();
}

function refreshLeash() {
  const h = profile.data.home;
  if (leashLine) { scene.remove(leashLine); leashLine.geometry.dispose(); leashLine = null; }
  if (!h || game.mode !== 'home') return;
  const pts = [];
  const hy = world.groundAt(h.lat, h.lon) ?? avatarY;
  const c = world.toLocal(h.lat, h.lon);
  for (let k = 0; k <= 160; k++) {
    const a = (k / 160) * Math.PI * 2;
    const x = c.x + Math.cos(a) * RULES.LEASH_M, z = c.z + Math.sin(a) * RULES.LEASH_M;
    const g = world.toGeo(x, z);
    pts.push(new THREE.Vector3(x, (world.groundAt(g.lat, g.lon) ?? hy) + 2, z));
  }
  leashLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: MODE_COLOR.home }));
  scene.add(leashLine);
}

function markKnown(chunk) {
  for (const p of chunk.pois) {
    const d = profile.data.discoveries[p.ref];
    if (d) chunk.markPoi(p.ref, d.grade);
  }
}
let firstChunk = true;
world.on((ev) => {
  if (ev.type === 'chunk' || ev.type === 'detail') {
    markKnown(ev.chunk);
    refreshBeacons();
    if (firstChunk && ev.type === 'chunk') { firstChunk = false; snapAvatar(); }
    if (ar.active) setWorldVisible(ev.chunk, false);
  }
  if (ev.type === 'remote') refreshBeacons();
  if (ev.type === 'status' || ev.type === 'detail') updateWorldStatus();
});

// ---------------------------------------------------------------- wildlife critters
const critterGeo = new THREE.IcosahedronGeometry(0.7, 1);
const critterObjs = new Map();
function syncCritters(t) {
  const alive = new Set(game.critters.map((c) => c.id));
  for (const [id, m] of critterObjs) if (!alive.has(id)) { scene.remove(m); m.material.dispose(); critterObjs.delete(id); }
  for (const c of game.critters) {
    let m = critterObjs.get(c.id);
    if (!m) {
      m = new THREE.Mesh(critterGeo, new THREE.MeshLambertMaterial({ color: GROUP_STYLE[c.sp.group]?.color || '#5fd08a', emissive: '#113311' }));
      m.userData.critter = c;
      critterObjs.set(c.id, m);
      scene.add(m);
    }
    const g = world.groundAt(c.lat, c.lon);
    if (g === null) { m.visible = false; continue; }
    m.visible = true;
    placeAt(m, c.lat, c.lon, g + 0.8 + Math.abs(Math.sin(t / 260 + c.born)) * 1.2);
  }
}

// ---------------------------------------------------------------- input, picking, card
const controls = new Controls(renderer.domElement, $('stick'), { onTap: pick });
const raycaster = new THREE.Raycaster();
function pick(cx, cy) {
  if (!game.pos) return;
  const ndc = new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const targets = [...critterObjs.values()];
  for (const ch of world.readyChunks()) { const m = ch.group.getObjectByName('pois'); if (m) targets.push(m); }
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit) return closeCard();
  if (hit.object.userData.critter) {
    const c = hit.object.userData.critter;
    if (ar.active) {
      const d = haversine(game.pos.lat, game.pos.lon, c.lat, c.lon);
      if (d > AR_PHOTO_M) return toast(`Get a bit closer to photograph it (${Math.round(d)} m, need ${AR_PHOTO_M} m).`, 'species');
      flash();
      return game.spot(c, 'photo');
    }
    const label = GROUP_STYLE[c.sp.group]?.label || 'creature';
    return toast(`${/^[aeiou]/.test(label) ? 'An' : 'A'} ${label}: walk up to it to see what it is.`, 'species');
  }
  const chunkKey = hit.object.parent.name.replace('chunk:', '');
  const ch = world.readyChunks().find((c) => c.key === chunkKey);
  const poi = ch?.pois[hit.instanceId];
  if (poi) openPlace(poi);
}
function openPlace(poi) {
  showPlace(poi, { game, profile, distance: haversine(game.pos.lat, game.pos.lon, poi.lat, poi.lon) });
}
initCard();

addEventListener('keydown', (e) => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || !game.mode) return;
  if (e.code === 'KeyB') { game.placeBeacon(); refreshBeacons(); renderHud(true); }
  if (e.code === 'KeyH') setClean(!document.body.classList.contains('clean'));
  if (e.code === 'KeyC') controls.recenter();
});

// ---------------------------------------------------------------- floating labels
const labelsEl = $('labels');
const labelPool = [];
const v3 = new THREE.Vector3();
labelsEl.addEventListener('click', (e) => {
  const el = e.target.closest('.label');
  if (!el || !game.pos) return;
  if (el._poi) openPlace(el._poi);
});
function updateLabels() {
  const list = [];
  if (game.pos) {
    const c = ar.active ? game.pos : viewGeo || game.pos;
    const r = ar.active ? 400 : Math.max(220, Math.min(900, controls.dist * 2.5));
    for (const { poi, chunk } of world.pois(c.lat, c.lon, r)) {
      const d = haversine(c.lat, c.lon, poi.lat, poi.lon);
      if (d >= r) continue;
      if (ar.active) {
        // AR: only places in front of the camera compete for the label slots
        v3.set(poi.x, poi.y + 3.5, poi.z).add(chunk.group.position).project(camera);
        if (v3.z > 1 || Math.abs(v3.x) > 0.95 || Math.abs(v3.y) > 0.95) continue;
      }
      list.push({ poi, chunk, d });
    }
  }
  list.sort((a, b) => a.d - b.d);
  list.length = Math.min(list.length, ar.active ? Math.max(8, tier.labels) : tier.labels);
  while (labelPool.length < list.length) { const el = document.createElement('div'); el.className = 'label'; labelsEl.appendChild(el); labelPool.push(el); }
  labelPool.forEach((el, k) => {
    const it = list[k];
    if (!it) { if (el.style.display !== 'none') el.style.display = 'none'; return; }
    v3.set(it.poi.x, it.poi.y + 3.5, it.poi.z).add(it.chunk.group.position).project(camera);
    if (ar.active && (Math.abs(v3.x) > 0.95 || Math.abs(v3.y) > 0.95)) { el.style.display = 'none'; return; }
    if (v3.z > 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.transform = `translate3d(${((v3.x + 1) / 2) * innerWidth}px, ${((1 - v3.y) / 2) * innerHeight}px, 0) translate(-50%, -100%)`;
    const text = ar.active ? `${it.poi.name} · ${Math.round(it.d)} m` : it.poi.name;
    if (el._poi !== it.poi || el.textContent !== text) { el._poi = it.poi; el.textContent = text; }
    const st = game.openState(it.poi);
    const cls = 'label' + (profile.data.discoveries[it.poi.ref] ? ' done' : '') + (st && !st.open ? ' closed' : '');
    if (el.className !== cls) el.className = cls;
  });
}

// ---------------------------------------------------------------- compass / heading
let compassOn = false;
onHeading((h) => { game.heading = h; });
$('compass').onclick = async () => {
  if (compassOn) { stopCompass(); compassOn = false; settings.compassFollow = false; }
  else if (await startCompass()) { compassOn = true; settings.compassFollow = true; toast('Compass on: the camera turns with your phone.'); }
  else toast('Compass not available on this device/browser.', 'error');
  saveSettings();
  $('compass').classList.toggle('on', compassOn);
};

// ---------------------------------------------------------------- camera AR (Present mode, phones)
const AR_PHOTO_M = 40;
const ar = new ARView($('ar-video'));
const arQ = new THREE.Quaternion();
let arSaved = null;
function setWorldVisible(chunk, on) {
  for (const o of chunk.group.children) if (o.name !== 'pois') o.visible = on;
}
async function enterAR() {
  if (game.mode !== 'present') return toast('AR works in Present mode, where you really are.', 'error');
  try {
    await ar.start();
  } catch (err) {
    return toast(err.name === 'NotAllowedError' ? "Camera permission was refused, so AR can't start." : `AR unavailable: ${err.message}`, 'error');
  }
  arSaved = { fov: camera.fov, near: camera.near, far: camera.far, bg: scene.background, fog: scene.fog };
  scene.background = null;
  scene.fog = null;
  for (const ch of world.readyChunks()) setWorldVisible(ch, false);
  avatar.visible = false;
  if (leashLine) leashLine.visible = false;
  if (sky.particles) sky.particles.visible = false;
  document.body.classList.add('ar');
  closeCard();
  toast(ar.absolute ? 'AR on: point your phone around. Tap a creature to photograph it.' : "AR on, but this phone isn't reporting north, so directions may be off.", 'species');
}
function exitAR() {
  if (!ar.active) return;
  ar.stop();
  document.body.classList.remove('ar');
  if (arSaved) {
    scene.background = arSaved.bg; scene.fog = arSaved.fog;
    camera.fov = arSaved.fov; camera.near = arSaved.near; camera.far = arSaved.far; camera.updateProjectionMatrix();
  }
  for (const ch of world.readyChunks()) setWorldVisible(ch, true);
  avatar.visible = true;
  if (leashLine) leashLine.visible = true;
}
function flash() {
  const el = $('ar-flash');
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  buzz(40);
}
$('ar-btn').onclick = () => (ar.active ? exitAR() : enterAR());
$('ar-exit').onclick = exitAR;

// ---------------------------------------------------------------- loop (adaptive quality + frame cap)
let last = performance.now(), lastRender = 0;
let hudT = 0, labelT = 0, envT = 0;
let facing = 0, wasMoving = false;
const perf = { frames: 0, time: 0, lowSince: 0 };
let skyState = { night: 0, precip: null };
let viewGeo = null; // where the camera is looking (labels follow the view, not just the character)

function snapAvatar() {
  if (!game.pos) return;
  const g = world.groundAt(game.pos.lat, game.pos.lon);
  if (g !== null) avatarY = g;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const move = MODES[game.mode]?.canMove ? controls.move() : null;
  const moving = game.tick(dt, move);
  if (move && controls.isAway() && !controls.recentering) controls.recenter();
  const busy = ar.active || controls.active() || moving || wasMoving || skyState.precip || game.critters.length || !$('card').hidden;
  wasMoving = moving;
  const cap = busy ? tier.fps : 20; // idle: save battery
  if (now - lastRender < 1000 / cap - 2) return;
  const rdt = Math.min(0.25, (now - lastRender) / 1000);
  lastRender = now;

  // measure real frame rate while busy; step quality down if it can't keep up
  if (busy && settings.quality === 'auto') {
    perf.frames++; perf.time += rdt;
    if (perf.time > 3) {
      const fps = perf.frames / perf.time;
      perf.frames = 0; perf.time = 0;
      if (fps < tier.fps * 0.7 && tierName !== 'saver') applyTier(tierName === 'high' ? 'balanced' : 'saver', 'adjusted for smoother play');
    }
  }

  if (game.pos) {
    const rebased = world.update(game.pos.lat, game.pos.lon);
    if (rebased) refreshBeacons();
    const o = world.toLocal(game.pos.lat, game.pos.lon);
    const g = world.groundAt(game.pos.lat, game.pos.lon);
    if (g !== null) avatarY += (g - avatarY) * (Math.abs(g - avatarY) > 50 ? 1 : Math.min(1, rdt * 12));
    avatar.position.set(o.x, avatarY, o.z);

    // facing: movement, else compass, else GPS course
    if (move) facing = Math.atan2(-move.east, move.north);
    else if (game.mode === 'present' && (game.heading ?? game.gpsCourse) != null) facing = (-(game.heading ?? game.gpsCourse) * Math.PI) / 180;
    const turn = Math.atan2(Math.sin(facing - avatar.rotation.y), Math.cos(facing - avatar.rotation.y));
    avatar.rotation.y += turn * Math.min(1, rdt * 10);
    if (move && game.heading == null) game.heading = (-facing * 180) / Math.PI;

    if (compassOn && settings.compassFollow && game.mode === 'present' && currentHeading() != null) {
      const target = (-currentHeading() * Math.PI) / 180;
      const d = Math.atan2(Math.sin(target - controls.yaw), Math.cos(target - controls.yaw));
      controls.yaw += d * Math.min(1, rdt * 4);
    }

    const ps = Math.max(1, controls.dist / 25);
    pointer.scale.setScalar(ps);
    pointer.position.y = 3 + ps * 2;
    ring.scale.setScalar(Math.max(1, controls.dist / 40));
    const acc = game.mode === 'present' && game.fix?.source === 'device' ? game.fix.accuracy : 0;
    accuracyRing.visible = acc > 4 && acc < 300;
    if (accuracyRing.visible) accuracyRing.scale.setScalar(acc);

    if (ar.active) {
      // AR: stand at the character's eyes and look where the phone points
      camera.position.set(avatar.position.x, avatarY + 1.6, avatar.position.z);
      camera.quaternion.slerp(ar.quaternion(arQ), 0.35);
      const fov = ar.fov(camera.aspect);
      if (Math.abs(camera.fov - fov) > 0.5 || camera.near !== 0.3) { camera.fov = fov; camera.near = 0.3; camera.far = 3000; camera.updateProjectionMatrix(); }
      viewGeo = game.pos;
      syncCritters(now);
    } else {
    controls.step(rdt);
    const tx = avatar.position.x + controls.pan.x, tz = avatar.position.z + controls.pan.z, dist = controls.dist;
    const tg = world.toGeo(tx, tz);
    const ty = (controls.pan.x || controls.pan.z ? world.groundAt(tg.lat, tg.lon) ?? avatarY : avatarY) + 1.6;
    viewGeo = tg;
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

    skyState = sky.update(environment, game.pos, camera.position, rdt, { particles: settings.weatherFx ? tier.particles : 0, viewDist: dist });
    document.body.classList.toggle('night', skyState.night > 0.6);
    syncCritters(now);
    }
  }
  beaconGroup.children.forEach((b) => (b.children[1].position.y = 2.5 + Math.sin(now / 500) * 0.4));

  labelT += rdt; if (labelT > 0.05) { labelT = 0; updateLabels(); }
  hudT += rdt; if (hudT > 0.3) { hudT = 0; renderHud(); }
  envT += rdt; if (envT > 10 && game.pos) { envT = 0; environment.refresh(game.pos.lat, game.pos.lon); }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- events / toasts
function toast(msg, cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4500);
  while ($('toasts').children.length > 3) $('toasts').firstElementChild.remove();
}

function onGameEvent(ev) {
  if (ev.type === 'error') toast(ev.msg, 'error');
  else if (ev.type === 'discover') { toast(ev.msg, ev.grade); buzz(ev.grade === 'echo' ? 30 : [40, 60, 40]); }
  else if (ev.type === 'mode') {
    if (ev.mode !== 'present') exitAR();
    toast(ev.msg, ev.mode === 'roam' ? 'echo' : ev.mode);
    styleAvatar(); refreshLeash();
    keepAwake(ev.mode === 'present' && settings.keepAwake);
  } else if (ev.type === 'critter') { toast(ev.msg, 'species'); buzz(25); }
  else if (ev.type === 'critter-gone') { /* it wandered off */ }
  else if (ev.type === 'spotted') {
    buzz([30, 40, 30, 40, 60]);
    showSpecies(ev.critter.sp, { result: ev.result, grade: ev.grade, autoClose: 9000 });
    renderHud(true);
  } else if (ev.type === 'beacon') { toast(ev.msg); refreshBeacons(); }
  else if (ev.msg) toast(ev.msg);
}

// ---------------------------------------------------------------- HUD
const fmt = (v) => v.toFixed(5);
function fixText(f) {
  if (!f) return 'none';
  return f.source === 'ip' ? `IP · ${f.place || '≈ city'} (±5 km)` : `${trustOf(f)} · ±${Math.round(f.accuracy)} m`;
}
function setText(id, text) { const el = $(id); if (el.textContent !== text) el.textContent = text; }

function renderHud() {
  if (!game.mode) return;
  document.querySelectorAll('.tabs button[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === game.mode));
  setText('h-desc', MODES[game.mode].desc);
  setText('h-pos', game.pos ? `${fmt(game.pos.lat)}, ${fmt(game.pos.lon)}` : '–');
  setText('h-fix', fixText(game.fix));
  const h = profile.data.home;
  setText('h-home', h ? `${h.trust} · ${game.pos ? Math.round(haversine(h.lat, h.lon, game.pos.lat, game.pos.lon)) + ' m away' : ''}` : 'not set');
  $('b-sethome').disabled = game.mode !== 'present' || !game.fix;
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
    if (w) parts.push(`${w.icon} ${Math.round(w.tempC)}°C ${w.label}`);
    parts.push(`<span class="muted">${environment.localTimeText()} · ${environment.sunPhase(sun.alt)}</span>`);
    const air = aqiLabel(w?.aqi);
    if (air && air !== 'good' && air !== 'fair') parts.push(`<span class="muted">air ${air}</span>`);
    if (environment.holiday) parts.push(`<span class="holiday">🎉 ${environment.holiday}</span>`);
    const html = parts.map((p) => `<span>${p}</span>`).join('');
    const el = $('envline');
    if (el.dataset.v !== html) { el.innerHTML = html; el.dataset.v = html; }
  }

  const n = game.nearest;
  if (n) {
    setText('n-name', n.poi.name);
    const st = game.openState(n.poi);
    setText('n-dist', `${Math.round(n.dist)} m · ${n.poi.kind.split(':')[1]?.replace(/_/g, ' ') || ''}${st?.open ? ' · open' : ''}`);
    $('n-arrow').style.transform = `rotate(${n.bearing + (controls.yaw * 180) / Math.PI}deg)`;
  } else {
    setText('n-name', 'Nothing new nearby');
    setText('n-dist', '');
  }

  const logEl = $('log');
  const items = profile.data.log.slice(0, 12).map((l) => `<li>${new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${escapeHtml(l.msg)}</li>`).join('');
  if (logEl.dataset.v !== items) { logEl.innerHTML = items; logEl.dataset.v = items; }
}

function updateWorldStatus() {
  const s = world.status();
  let text = '';
  if (s.loading) text = `Loading world… ${s.ready}/${s.ready + s.loading} areas`;
  else if (s.error) text = `${s.error} area(s) failed to load, retrying`;
  else if (!settings.dataSaver && s.detail < s.ready) text = `Adding trees & place details… ${s.detail}/${s.ready}`;
  setText('w-status', text);
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

// ---------------------------------------------------------------- actions
async function parsePlace(q) {
  const m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) > 85 || Math.abs(lon) > 180) throw new Error('Coordinates out of range');
    return { lat, lon };
  }
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
  const j = await res.json();
  if (!j[0]) throw new Error(`No place found for "${q}"`);
  return { lat: +j[0].lat, lon: +j[0].lon, name: j[0].display_name };
}

function startWatching() {
  stopWatch?.();
  stopWatch = watchDevice((f) => game.setFix(f), (e) => console.warn(e));
}

function begin(mode, opts) {
  stopWatch?.(); stopWatch = null;
  if (game.enter(mode, opts)) {
    $('start').hidden = true;
    $('hud').hidden = false;
    controls.pan.x = controls.pan.z = 0;
    if (mode === 'present' && game.fix?.source === 'device') startWatching();
    snapAvatar();
    styleAvatar();
    environment.refresh(game.pos.lat, game.pos.lon);
    renderHud();
    return true;
  }
  return false;
}

async function locateDevice(msgEl) {
  if (msgEl) msgEl.textContent = 'Asking your device for its location…';
  try {
    const f = await deviceFix();
    game.setFix(f);
    if (msgEl) msgEl.textContent = '';
    return f;
  } catch (e) {
    const m = `Device location failed: ${e.message}. Try "via internet" instead.`;
    msgEl ? (msgEl.textContent = m) : toast(m, 'error');
    return null;
  }
}

async function locateIp(msgEl) {
  if (msgEl) msgEl.textContent = 'Looking up your internet connection’s location…';
  try {
    const f = await ipFix();
    game.setFix(f);
    if (msgEl) msgEl.textContent = '';
    return f;
  } catch (e) {
    const m = `IP location failed: ${e.message}`;
    msgEl ? (msgEl.textContent = m) : toast(m, 'error');
    return null;
  }
}

// start screen
const sMsg = $('s-msg');
if (profile.data.home) $('s-home').hidden = false;
if (profile.data.last) $('s-resume').hidden = false;
$('s-device').onclick = async () => { if (await locateDevice(sMsg)) begin('present'); };
$('s-ip').onclick = async () => {
  if (await locateIp(sMsg)) {
    begin('present');
    toast('IP location is approximate (city-level) and you can’t walk on it. Set it as your home base to move around.', 'home');
  }
};
$('s-home').onclick = () => begin('home');
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
  if (mode === 'present' && !game.fix && !(await locateDevice())) return;
  begin(mode, mode === 'roam' ? { to: game.pos } : {});
}));
const left = $('left');
function setCollapsed(on) { left.classList.toggle('collapsed', on); $('more').setAttribute('aria-expanded', String(!on)); }
setCollapsed(isTouch);
$('more').onclick = () => setCollapsed(!left.classList.contains('collapsed'));
$('nearest').onclick = () => { if (game.nearest) openPlace(game.nearest.poi); else $('right').classList.toggle('expanded'); };
$('b-locate').onclick = async () => { if (await locateDevice()) { if (game.mode === 'present') begin('present'); else toast('Device fix updated: ' + fixText(game.fix)); } };
$('b-ip').onclick = async () => { if (await locateIp()) { if (game.mode === 'present') begin('present'); else toast('Fix updated: ' + fixText(game.fix)); } };
$('b-sethome').onclick = () => {
  if (profile.data.home && !confirm('Move your home base here? It can then not be moved again for 30 days.')) return;
  if (!profile.data.home && !confirm('Set your permanent home base at your current real location?')) return;
  if (game.setHome()) { $('s-home').hidden = false; refreshBeacons(); renderHud(); }
};
$('b-beacon').onclick = () => { const label = prompt('Beacon label?', `Beacon ${profile.data.beacons.length + 1}`); if (label !== null) { game.placeBeacon(label); refreshBeacons(); renderHud(); } };
$('h-roam-form').onsubmit = async (e) => {
  e.preventDefault();
  try { const to = await parsePlace($('h-roam').value); begin('roam', { to }); $('h-roam').value = ''; $('h-roam').blur(); }
  catch (err) { toast(err.message, 'error'); }
};
$('p-export').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([profile.export()], { type: 'application/json' }));
  a.download = `openworld-profile-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('p-import').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    profile.import(await f.text());
    beaconObjs.forEach((g) => beaconGroup.remove(g)); beaconObjs.clear();
    for (const ch of world.readyChunks()) markKnown(ch);
    refreshBeacons(); renderHud(); toast('Profile imported');
  } catch (err) { toast('Import failed: ' + err.message, 'error'); }
  e.target.value = '';
};

// settings
function openSettings() {
  $('set-quality').value = settings.quality;
  $('set-weather').checked = settings.weatherFx;
  $('set-datasaver').checked = settings.dataSaver;
  $('set-awake').checked = settings.keepAwake;
  $('set-compass').checked = settings.compassFollow;
  $('set-awake').disabled = !('wakeLock' in navigator);
  $('set-compass').disabled = !compassSupported;
  $('set-info').textContent = `Now: ${tier.label}${settings.quality === 'auto' ? ' (auto)' : ''}${batteryLow ? ' · battery low' : ''}`;
  $('settings').hidden = false;
}
$('p-settings').onclick = openSettings;
$('set-close').onclick = () => { $('settings').hidden = true; };
$('set-quality').onchange = (e) => { settings.quality = e.target.value; saveSettings(); applyTier(startTier()); $('set-info').textContent = `Now: ${tier.label}`; };
$('set-weather').onchange = (e) => { settings.weatherFx = e.target.checked; saveSettings(); };
$('set-datasaver').onchange = (e) => { settings.dataSaver = e.target.checked; game.dataSaver = settings.dataSaver; saveSettings(); applyTier(tierName); };
$('set-awake').onchange = (e) => { settings.keepAwake = e.target.checked; saveSettings(); keepAwake(game.mode === 'present' && settings.keepAwake); };
$('set-compass').onchange = async (e) => {
  settings.compassFollow = e.target.checked; saveSettings();
  if (e.target.checked && !compassOn) { compassOn = await startCompass(); $('compass').classList.toggle('on', compassOn); }
};
$('p-reset').onclick = () => { if (confirm('Erase this profile (discoveries, species, beacons, home base)?')) { profile.reset(); location.reload(); } };

// battery-aware quality
watchBattery((b) => {
  const wasLow = batteryLow;
  batteryLow = b.low;
  if (settings.quality !== 'auto' || wasLow === batteryLow) return;
  if (batteryLow) applyTier('saver', 'battery low');
  else applyTier(startTier(), 'charging / battery ok');
});

// map-only view toggle (button, or H on a keyboard); remembered per device
const UI_KEY = 'openworld.cleanView';
function setClean(on) {
  document.body.classList.toggle('clean', on);
  $('ui-toggle').setAttribute('aria-label', on ? 'Show interface' : 'Hide interface');
  try { localStorage.setItem(UI_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}
try { setClean(localStorage.getItem(UI_KEY) === '1'); } catch { setClean(false); }
$('ui-toggle').onclick = () => setClean(!document.body.classList.contains('clean'));
$('recenter').onclick = () => controls.recenter();

// deep link: ?at=lat,lon starts directly in Roam there
const at = new URLSearchParams(location.search).get('at');
if (at) parsePlace(at).then((to) => begin('roam', { to })).catch((e) => (sMsg.textContent = e.message));

// debug handle
window.openworld = { world, game, profile, environment, settings, applyTier, camera, ar, get tier() { return tierName; } };
