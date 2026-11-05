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
import { getAtlas, atlasCss, groupInfo } from './world/icons.js';
import { iconUniforms, iconMat } from './world/materials.js';
import { haversine, offsetMeters } from './geo.js';
import { settings, saveSettings, TIERS, startTier, isTouch } from './settings.js';
import { startCompass, stopCompass, onHeading, currentHeading, compassSupported, keepAwake, watchBattery, buzz } from './sensors.js';
import { Controls } from './ui/controls.js';
import { initCard, showPlace, showSpecies, closeCard } from './ui/card.js';
import { ARView, arSupported } from './ar.js';
import { Journal, TASKS } from './game/journal.js';
import { Minimap } from './ui/minimap.js';
import { initJournal, openJournal } from './ui/journalView.js';
import { showHere } from './ui/card.js';
import { maybeShowTips } from './ui/tips.js';
import { Ambience } from './audio.js';
import { fmtDist, fmtTemp } from './units.js';
import { pruneCache } from './data/cache.js';
import { wildHabitat } from './world/habitats.js';

const $ = (id) => document.getElementById(id);
const MODE_COLOR = { present: '#ff7a3d', home: '#3db8ff', roam: '#b07aff' };

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
const journal = new Journal(profile, environment, (ev) => onGameEvent(ev));
game.journal = journal;
const ambience = new Ambience();
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
const shadowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.06;
avatar.add(body, head, nose, ring, pointer, accuracyRing, shadow);
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
  if (leashLine) { scene.remove(leashLine); leashLine.geometry.dispose(); leashLine.material.dispose(); leashLine = null; }
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
const reveals = new Map(); // chunk -> start time (rise-in animation)
let lastLoadAt = 0;
world.on((ev) => {
  if (ev.type === 'chunk') {
    lastLoadAt = performance.now();
    if (settings.reduceMotion || firstChunk) ev.chunk.reveal(1); else { ev.chunk.reveal(0); reveals.set(ev.chunk, performance.now()); }
  }
  if (ev.type === 'chunk' || ev.type === 'detail') {
    journal.onArea(ev.chunk);
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
    placeAt(m, c.lat, c.lon, g + 0.8 + (settings.reduceMotion ? 0.6 : Math.abs(Math.sin(t / 260 + c.born)) * 1.2));
  }
}

// ---------------------------------------------------------------- input, picking, card
const controls = new Controls(renderer.domElement, $('stick'), { onTap: pick });
const raycaster = new THREE.Raycaster();
function pick(cx, cy) {
  if (!game.pos) return;
  const ndc = new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects([...critterObjs.values()], false)[0];
  if (!hit) { const poi = ar.active ? null : pickPlace(cx, cy); return poi ? openPlace(poi) : closeCard(); }
  if (hit.object.userData.critter) {
    const c = hit.object.userData.critter;
    if (ar.active) return photographCritter(c);
    const label = GROUP_STYLE[c.sp.group]?.label || 'creature';
    return toast(`${/^[aeiou]/.test(label) ? 'An' : 'A'} ${label}: walk up to it to see what it is.`, 'species');
  }
}
// nearest place icon to a tap, in screen space (generous ~30 px target)
const pv = new THREE.Vector3(), pu = new THREE.Vector3();
function pickPlace(cx, cy) {
  const c = viewGeo || game.pos;
  let best = null, bestD = 30 * 30;
  for (const { poi, chunk } of world.pois(c.lat, c.lon, Math.max(700, controls.dist * 4))) {
    pv.set(poi.x, poi.y - 2.5, poi.z).add(chunk.group.position);
    const depth = pv.distanceTo(camera.position), size = Math.min(46, Math.max(1.6, depth * 0.05));
    pu.copy(pv).addScaledVector(camera.up, size * 0.55).project(camera); // icon centre
    if (pu.z > 1) continue;
    const dx = ((pu.x + 1) / 2) * innerWidth - cx, dy = ((1 - pu.y) / 2) * innerHeight - cy, d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = poi; }
  }
  return best;
}
function photographCritter(c) {
  const d = haversine(game.pos.lat, game.pos.lon, c.lat, c.lon);
  if (d > AR_PHOTO_M) return toast(`Get a bit closer to photograph it (${fmtDist(d)} away, need ${fmtDist(AR_PHOTO_M)}).`, 'species');
  flash();
  game.spot(c, 'photo');
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
// Places, street names (zoomed in) and, in AR, tappable creature pins. Light by design:
// candidates are gathered 5x/second; positioning reuses a small fixed pool of elements,
// never reads layout, and avoids overlaps with estimated sizes.
const labelsEl = $('labels');
const labelPool = [], streetPool = [], pinPool = [];
const v3 = new THREE.Vector3(), v3b = new THREE.Vector3(), fwd = new THREE.Vector3();
let cand = { pois: [], streets: [] };
let candT = 0;
labelsEl.addEventListener('click', (e) => {
  const el = e.target.closest('.label');
  if (!el || !game.pos) return;
  if (el._critter) return photographCritter(el._critter);
  if (el._poi) openPlace(el._poi);
});
function newEl(pool, cls) { const el = document.createElement('div'); el.className = cls; el.style.display = 'none'; labelsEl.appendChild(el); pool.push(el); return el; }
function hideRest(pool, n) { for (let k = n; k < pool.length; k++) if (pool[k].style.display !== 'none') pool[k].style.display = 'none'; }
const placed = [];
function fits(l, t, r, b) {
  for (const q of placed) if (l < q[2] && r > q[0] && t < q[3] && b > q[1]) return false;
  placed.push([l, t, r, b]);
  return true;
}
function screenOf(v) { return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight]; }
const textW = (str, px) => str.length * px * 0.56 + 18;

// nearest point of each named street to a reference point (local metres)
function streetCandidates(rx, rz, maxD, maxN) {
  const best = new Map();
  const g = world.toGeo(rx, rz), pad = maxD / 111320, padLon = pad / Math.max(0.2, Math.cos((g.lat * Math.PI) / 180));
  for (const ch of world.readyChunks()) {
    const b = ch.bounds;
    if (g.lat < b.s - pad || g.lat > b.n + pad || g.lon < b.w - padLon || g.lon > b.e + padLon) continue;
    const ox = ch.group.position.x, oz = ch.group.position.z, x0 = rx - ox, z0 = rz - oz;
    for (const st of ch.streets) {
      for (const L of st.lines) {
        for (let i = 0; i + 3 < L.length; i += 2) {
          const ax = L[i], az = L[i + 1], dx = L[i + 2] - ax, dz = L[i + 3] - az;
          let t = ((x0 - ax) * dx + (z0 - az) * dz) / (dx * dx + dz * dz || 1);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x0 - px, z0 - pz);
          if (d > maxD) continue;
          const cur = best.get(st.name);
          if (!cur || d < cur.d) best.set(st.name, { name: st.name, d, x: px + ox, z: pz + oz, dx, dz });
        }
      }
    }
  }
  const list = [...best.values()].sort((a, b) => a.d - b.d).slice(0, maxN);
  for (const s2 of list) { const gg = world.toGeo(s2.x, s2.z); s2.y = (world.groundAt(gg.lat, gg.lon) ?? avatarY) + 0.6; }
  return list;
}

function refreshCandidates() {
  cand = { pois: [], streets: [] };
  if (!game.pos) return;
  const c = ar.active ? game.pos : viewGeo || game.pos;
  const r = ar.active ? 450 : Math.max(220, Math.min(900, controls.dist * 2.5));
  for (const { poi, chunk } of world.pois(c.lat, c.lon, r)) {
    const d = haversine(c.lat, c.lon, poi.lat, poi.lon);
    if (d < r) cand.pois.push({ poi, chunk, d });
  }
  cand.pois.sort((a, b) => a.d - b.d);
  if (cand.pois.length > 60) cand.pois.length = 60;
  if (ar.active) {
    // streets ahead of you: around a point ~25 m in front, at ground level
    fwd.set(0, 0, -1).applyQuaternion(camera.quaternion); fwd.y = 0; fwd.normalize();
    cand.streets = streetCandidates(camera.position.x + fwd.x * 25, camera.position.z + fwd.z * 25, 45, 3);
  } else if (controls.dist < 170) {
    cand.streets = streetCandidates(viewLocal.x, viewLocal.z, 160, 6);
  }
}

function updateLabels() {
  placed.length = 0;
  const big = settings.textSize === 'large' ? 1.18 : 1;
  let nPin = 0, nPoi = 0, nSt = 0;
  if (game.pos) {
    // 1) AR: creature pins first (they're what you tap)
    if (ar.active) {
      for (const c of game.critters) {
        const g = world.groundAt(c.lat, c.lon);
        if (g === null) continue;
        const o = world.toLocal(c.lat, c.lon);
        v3.set(o.x, g + 2.6, o.z).project(camera);
        if (v3.z > 1 || Math.abs(v3.x) > 0.95 || Math.abs(v3.y) > 0.95) continue;
        const [x, y] = screenOf(v3), d = haversine(game.pos.lat, game.pos.lon, c.lat, c.lon);
        const label = GROUP_STYLE[c.sp.group]?.label || 'creature';
        const text = d <= AR_PHOTO_M ? `${label} · ${fmtDist(d)} · tap to photograph` : `${label} · ${fmtDist(d)} · get closer`;
        const w = textW(text, 13 * big), h = 34 * big;
        if (!fits(x - w / 2, y - h, x + w / 2, y)) continue;
        const el = pinPool[nPin] || newEl(pinPool, 'label pin');
        nPin++;
        el._critter = c;
        if (el.textContent !== text) el.textContent = text;
        el.classList.toggle('near', d <= AR_PHOTO_M);
        el.style.display = '';
        el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
      }
    }
    // 2) places: AR pins always; on the map only when zoomed in close (or per setting)
    const maxPoi = ar.active ? Math.max(8, tier.labels) : tier.labels;
    const nameFade = ar.active ? 1 : settings.placeNames === 'always' ? 1 : settings.placeNames === 'never' ? 0 : Math.max(0, Math.min(1, (48 - controls.dist) / 14)); // names fade in below ~48 m
    for (const it of (nameFade > 0 ? cand.pois : [])) {
      if (nPoi >= maxPoi) break;
      v3.set(it.poi.x, it.poi.y + (ar.active ? 0 : 4.5), it.poi.z).add(it.chunk.group.position).project(camera);
      const lim = ar.active ? 0.95 : 1.1;
      if (v3.z > 1 || Math.abs(v3.x) > lim || Math.abs(v3.y) > lim) continue;
      let [x, y] = screenOf(v3);
      const d = ar.active ? haversine(game.pos.lat, game.pos.lon, it.poi.lat, it.poi.lon) : it.d;
      const text = ar.active ? fmtDist(d) : it.poi.name;
      const sc = ar.active ? Math.max(0.82, Math.min(1.12, 1.15 - d / 700)) : 1;
      const w = textW(text, 11 * big * sc) + (ar.active ? 26 : 0), h = (ar.active ? 30 : 20) * big * sc;
      if (ar.active) x = Math.max(w / 2 + 6, Math.min(innerWidth - w / 2 - 6, x)); // keep pins fully on screen
      if (!fits(x - w / 2, y - h, x + w / 2, y)) continue;
      const el = labelPool[nPoi] || newEl(labelPool, 'label');
      nPoi++;
      el._poi = it.poi;
      if (ar.active) {
        if (!el._ico) { el.textContent = ''; el._ico = el.appendChild(document.createElement('i')); el._txt = el.appendChild(document.createElement('span')); }
        if (el._iconFor !== it.poi.icon) { el._iconFor = it.poi.icon; el._ico.style.cssText = atlasCss(it.poi.icon, 22); }
        if (el._txt.textContent !== text) el._txt.textContent = text;
        el.title = it.poi.name;
      } else {
        if (el._ico) { el._ico = null; el._txt = null; el._iconFor = null; }
        if (el.textContent !== text) el.textContent = text;
        const op = nameFade.toFixed(1);
        if (el.style.opacity !== op) el.style.opacity = op;
      }
      const st = game.openState(it.poi);
      const cls = 'label' + (ar.active ? ' arpin' : '') + (profile.data.discoveries[it.poi.ref] ? ' done' : '') + (st && !st.open ? ' closed' : '');
      if (el.className !== cls) el.className = cls;
      if (ar.active && el.style.opacity !== '1') el.style.opacity = '1';
      el.style.display = '';
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)${sc !== 1 ? ` scale(${sc.toFixed(2)})` : ''}`;
    }
    // 3) street names: quiet map text, only when zoomed in (or ahead of you in AR)
    const fade = ar.active ? 1 : Math.max(0, Math.min(1, (170 - controls.dist) / 50));
    if (fade > 0) {
      for (const sn of cand.streets) {
        v3.set(sn.x, sn.y, sn.z).project(camera);
        if (v3.z > 1 || Math.abs(v3.x) > 0.95 || Math.abs(v3.y) > 0.95) continue;
        const [x, y] = screenOf(v3);
        let ang = 0;
        if (!ar.active) {
          v3b.set(sn.x + sn.dx, sn.y, sn.z + sn.dz).project(camera);
          const [x2, y2] = screenOf(v3b);
          ang = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI;
          if (ang > 90) ang -= 180; else if (ang < -90) ang += 180; // keep text upright
        }
        const w = textW(sn.name, 12 * big), h = 16 * big, a = (ang * Math.PI) / 180;
        const bw = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)), bh = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
        if (!fits(x - bw / 2, y - bh / 2, x + bw / 2, y + bh / 2)) continue;
        const el = streetPool[nSt] || newEl(streetPool, 'street');
        nSt++;
        if (el.textContent !== sn.name) el.textContent = sn.name;
        const op = fade.toFixed(1);
        if (el.style.opacity !== op) el.style.opacity = op;
        el.style.display = '';
        el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) rotate(${ang.toFixed(1)}deg)`;
      }
    }
  }
  hideRest(pinPool, nPin); hideRest(labelPool, nPoi); hideRest(streetPool, nSt);
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
let arSaved = null;
function setWorldVisible(chunk, on) {
  for (const o of chunk.group.children) o.visible = on; // AR shows places as small screen pins instead
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
  ar.userOffset = 0; ribbonW = 0;
  refreshCandidates();
  closeCard();
  announce('Camera view on');
  if (!ar.absolute) toast("This phone isn't reporting north, so drag sideways to line labels up.", 'species');
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
  controls.pan.x = controls.pan.z = 0; // AR drags shouldn't leave the map panned
  avatar.visible = true;
  if (leashLine) leashLine.visible = true;
}
function flash() {
  const el = $('ar-flash');
  if (!settings.reduceMotion) { el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); }
  buzz(40);
}
// Photo: camera frame + 3D overlay + labels + a caption, composed on the device; nothing is uploaded.
async function arPhoto() {
  if (!ar.active) return;
  renderer.render(scene, camera); // draw now so the WebGL canvas can be copied in this task
  const src = renderer.domElement, W = src.width, H = src.height, dpr = W / innerWidth;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const v = $('ar-video'), vw = v.videoWidth || W, vh = v.videoHeight || H, k = Math.max(W / vw, H / vh);
  g.drawImage(v, (W - vw * k) / 2, (H - vh * k) / 2, vw * k, vh * k);
  g.drawImage(src, 0, 0);
  g.font = `${Math.round(12 * dpr)}px system-ui, sans-serif`; g.textBaseline = 'middle';
  for (const el of labelPool) {
    if (el.style.display === 'none' || !el.textContent) continue;
    const r = el.getBoundingClientRect();
    g.fillStyle = 'rgba(22,26,32,0.78)'; g.fillRect(r.left * dpr, r.top * dpr, r.width * dpr, r.height * dpr);
    g.fillStyle = '#fff'; g.fillText(el.textContent, (r.left + 7) * dpr, (r.top + r.height / 2) * dpr);
  }
  const snap = environment.snapshot(game.pos.lat, game.pos.lon);
  const area = world.chunkAt(game.pos.lat, game.pos.lon)?.areaName;
  const lines = [[area, `${game.pos.lat.toFixed(4)}, ${game.pos.lon.toFixed(4)}`].filter(Boolean).join(' · '),
    [new Date().toLocaleString(), snap.weather, snap.tempC != null ? fmtTemp(snap.tempC) : null, snap.sun].filter(Boolean).join(' · ')];
  const bh = 64 * dpr;
  g.fillStyle = 'rgba(10,14,20,0.6)'; g.fillRect(0, H - bh, W, bh);
  g.fillStyle = '#fff'; g.font = `${Math.round(13 * dpr)}px system-ui, sans-serif`;
  g.fillText(lines[0], 14 * dpr, H - bh + 20 * dpr); g.fillStyle = '#c9d1d9'; g.fillText(lines[1], 14 * dpr, H - bh + 44 * dpr);
  flash();
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  const file = new File([blob], `openworld-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`, { type: 'image/jpeg' });
  if (isTouch && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch { /* cancelled */ } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
$('ar-photo').onclick = arPhoto;

// AR compass ribbon: heading + where things are, with edge arrows for anything off-screen.
// ~12 small elements moved by transform 10x/second; width read once (no per-frame layout).
const ribbon = $('ar-compass'), ribbonTicks = ribbon.querySelector('.ticks');
const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const SPAN = 120; // degrees shown across the ribbon
const tickEls = Array.from({ length: 9 }, () => ribbonTicks.appendChild(document.createElement('span')));
const markEls = Array.from({ length: 4 }, () => { const m = document.createElement('i'); m.className = 'mark'; ribbonTicks.appendChild(m); return m; });
let ribbonW = 0, ribT = 0;
const bearingTo = (lat, lon) => { const o = offsetMeters(game.pos.lat, game.pos.lon, lat, lon); return ((Math.atan2(o.x, -o.z) * 180) / Math.PI + 360) % 360; };
function announce(msg) { const el = $('sr'); el.textContent = ''; setTimeout(() => (el.textContent = msg), 30); }
function updateRibbon(now) {
  if (now - ribT < 90 || !game.pos) return;
  ribT = now;
  if (!ribbonW) ribbonW = ribbon.clientWidth || 300;
  const h = ARView.bearingOf(camera.quaternion);
  setText('ar-heading', `${CARD[Math.round(h / 45) % 8]} ${Math.round(h) % 360}°`);
  const first = Math.ceil((h - SPAN / 2) / 15) * 15;
  tickEls.forEach((el, k) => {
    const deg = first + k * 15, rel = deg - h;
    if (rel > SPAN / 2) { el.style.display = 'none'; return; }
    el.style.display = '';
    const t = deg % 45 === 0 ? CARD[(((deg / 45) % 8) + 8) % 8] : '·';
    if (el.textContent !== t) el.textContent = t;
    el.className = t !== '·' ? 'cardinal' : '';
    el.style.transform = `translateX(${((rel / SPAN + 0.5) * ribbonW).toFixed(0)}px)`;
  });
  const items = [];
  for (const c of game.critters) items.push({ b: bearingTo(c.lat, c.lon), icon: '●', cls: 'critter', c });
  if (game.nearest) items.push({ b: bearingTo(game.nearest.poi.lat, game.nearest.poi.lon), icon: '★', cls: 'target' });
  markEls.forEach((el, k) => {
    const it = items[k];
    if (!it) { el.style.display = 'none'; return; }
    const rel = ((it.b - h + 540) % 360) - 180, off = Math.abs(rel) > SPAN / 2 - 4;
    const t = off ? (rel < 0 ? `‹${it.icon}` : `${it.icon}›`) : it.icon;
    if (el.textContent !== t) el.textContent = t;
    el.className = `mark ${it.cls}`;
    el.style.display = '';
    const x = (Math.max(-SPAN / 2 + 4, Math.min(SPAN / 2 - 4, rel)) / SPAN + 0.5) * ribbonW;
    el.style.transform = `translateX(${x.toFixed(0)}px)`;
    // a gentle buzz (and a screen-reader note) the first time a creature is straight ahead
    if (it.c && Math.abs(rel) < 12 && !it.c.seenAhead) {
      it.c.seenAhead = true;
      buzz(20);
      announce(`${GROUP_STYLE[it.c.sp.group]?.label || 'creature'} ahead, ${fmtDist(haversine(game.pos.lat, game.pos.lon, it.c.lat, it.c.lon))}`);
    }
  });
  setText('ar-hint', ar.needsCalibration() ? 'Compass needs calibrating: wave your phone in a figure-8'
    : ar.absolute ? 'Point your phone around · drag sideways if labels are off' : 'No compass here: drag sideways to line labels up');
}
addEventListener('resize', () => { ribbonW = 0; });

// AR: drag sideways to nudge the compass if labels don't line up with the real world
let arDragX = null;
renderer.domElement.addEventListener('pointerdown', (e) => { if (ar.active) arDragX = e.clientX; });
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!ar.active || arDragX === null || !e.buttons) return;
  ar.userOffset += (e.clientX - arDragX) * 0.15;
  arDragX = e.clientX;
});
addEventListener('pointerup', () => { arDragX = null; });
$('ar-btn').onclick = () => (ar.active ? exitAR() : enterAR());
$('ar-exit').onclick = exitAR;

// ---------------------------------------------------------------- loop (adaptive quality + frame cap)
let last = performance.now(), lastRender = 0;
let hudT = 0, labelT = 0, envT = 0;
let facing = 0, wasMoving = false;
const perf = { frames: 0, time: 0, good: 0, changedAt: 0 };
const TIER_ORDER = ['saver', 'balanced', 'high'];
let lastUpd = { lat: 0, lon: 0, t: 0 };
let miniT = 0, ambT = 0;
const minimap = new Minimap($('minimap'), { onTap: () => openJournal('map') });
let skyState = { night: 0, precip: null };
let viewGeo = null; // where the camera is looking (labels follow the view, not just the character)
const viewLocal = { x: 0, z: 0 };

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

  // measure real frame rate while busy (ignoring the hitches right after new areas load);
  // step quality down if it can't keep up, and back up when there's headroom again
  if (busy && settings.quality === 'auto' && !batteryLow && now - lastLoadAt > 8000) {
    perf.frames++; perf.time += rdt;
    if (perf.time > 3) {
      const fps = perf.frames / perf.time;
      perf.frames = 0; perf.time = 0;
      const i = TIER_ORDER.indexOf(tierName), top = TIER_ORDER.indexOf(startTier());
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
      if (world.update(game.pos.lat, game.pos.lon)) refreshBeacons();
    }
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
      ar.step(camera.quaternion, rdt);
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
    viewLocal.x = tx; viewLocal.z = tz;
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
    syncCritters(now);
    }
  }
  if (!settings.reduceMotion) beaconGroup.children.forEach((b) => (b.children[1].position.y = 2.5 + Math.sin(now / 500) * 0.4));
  miniT += rdt;
  if (miniT > 0.25 && game.pos && !$('hud').hidden) {
    miniT = 0;
    const bearing = ar.active ? (currentHeading() ?? 0) : (-controls.yaw * 180) / Math.PI;
    minimap.draw({ pos: game.pos, bearing, cells: profile.data.cells, pois: [...world.pois(game.pos.lat, game.pos.lon, 600)].map((x) => x.poi), critters: game.critters, home: profile.data.home, discovered: profile.data.discoveries });
  }
  ambT += rdt;
  if (ambT > 1 && ambience.on && game.pos) {
    ambT = 0;
    const w = environment.weather, sun = environment.sun(game.pos.lat, game.pos.lon);
    const hab = wildHabitat(world.habitatAt(game.pos.lat, game.pos.lon));
    ambience.update({ wind: w?.wind ?? 8, rain: w && /rain|storm/.test(w.kind) ? 1 : w?.kind === 'drizzle' ? 0.4 : 0, day: sun.alt > 0 ? 1 : 0, green: hab !== 'urban', warm: (w?.tempC ?? 10) > 14 });
  }

  candT += rdt; if (candT > 0.2) { candT = 0; refreshCandidates(); }
  labelT += rdt; if (ar.active || labelT > 0.05) { labelT = 0; updateLabels(); }
  if (ar.active) updateRibbon(now);
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
    styleAvatar(); refreshLeash(); requestAnimationFrame(placeToasts);
    keepAwake(ev.mode === 'present' && settings.keepAwake);
  } else if (ev.type === 'critter') { toast(ev.msg, 'species'); buzz(25); }
  else if (ev.type === 'critter-gone') { /* it wandered off */ }
  else if (ev.type === 'spotted') {
    buzz([30, 40, 30, 40, 60]);
    showSpecies(ev.critter.sp, { result: ev.result, grade: ev.grade, autoClose: 12000, pos: game.pos });
    renderHud(true);
  } else if (ev.type === 'beacon') { toast(ev.msg); refreshBeacons(); }
  else if (ev.type === 'rock') { toast(ev.msg, 'rock'); buzz(30); }
  else if (ev.type === 'task') { toast(ev.msg, 'species'); buzz([40, 50, 40, 50, 80]); renderHud(); }
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
  setText('h-home', h ? `${h.trust} · ${game.pos ? fmtDist(haversine(h.lat, h.lon, game.pos.lat, game.pos.lon)) + ' away' : ''}` : 'not set');
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
    if (w) parts.push(`${w.icon} ${fmtTemp(w.tempC)} ${escapeHtml(w.label)}`);
    parts.push(`<span class="muted">${environment.localTimeText()} · ${environment.sunPhase(sun.alt)}</span>`);
    const air = aqiLabel(w?.aqi);
    if (air && air !== 'good' && air !== 'fair') parts.push(`<span class="muted">air ${air}</span>`);
    if (environment.holiday) parts.push(`<span class="holiday">🎉 ${escapeHtml(environment.holiday)}</span>`);
    const html = parts.map((p) => `<span>${p}</span>`).join('');
    const el = $('envline');
    if (el.dataset.v !== html) { el.innerHTML = html; el.dataset.v = html; }
  }

  const n = game.nearest;
  if (n) {
    setText('n-name', n.poi.name);
    const st = game.openState(n.poi);
    setText('n-dist', `${fmtDist(n.dist)} · ${n.poi.kind.split(':')[1]?.replace(/_/g, ' ') || ''}${st?.open ? ' · open' : ''}`);
    $('n-arrow').style.transform = `rotate(${n.bearing + (controls.yaw * 180) / Math.PI}deg)`;
  } else {
    setText('n-name', 'Nothing new nearby');
    setText('n-dist', '');
  }

  const t = journal.task(), T = TASKS[t.type];
  setText('task', t.done ? `✓ Today: ${T.text}` : `Today: ${T.text} · ${T.unit === 'm' ? `${fmtDist(t.progress)}/${fmtDist(T.target)}` : `${t.progress}/${T.target}`}`);
  $('task').classList.toggle('done', t.done);
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
  let warned = false;
  stopWatch = watchDevice((f) => { game.setFix(f); warned = false; }, (e) => {
    console.warn(e);
    if (!warned) { warned = true; toast(`Lost your device location (${e.message || 'permission or signal'}). Present mode will resume when it returns.`, 'error'); }
  });
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
    setTimeout(() => maybeShowTips(isTouch), 1500);
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
    journal.ensure();
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
  $('set-units').value = settings.units;
  $('set-text').value = settings.textSize;
  $('set-motion').checked = settings.reduceMotion;
  $('set-sound').checked = settings.sound;
  $('set-names').value = settings.placeNames;
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
$('set-names').onchange = (e) => { settings.placeNames = e.target.value; saveSettings(); };
$('set-units').onchange = (e) => { settings.units = e.target.value; saveSettings(); renderHud(); };
$('set-text').onchange = (e) => { settings.textSize = e.target.value; saveSettings(); applyLook(); };
$('set-motion').onchange = (e) => { settings.reduceMotion = e.target.checked; saveSettings(); applyLook(); };
$('set-sound').onchange = (e) => { settings.sound = e.target.checked; saveSettings(); settings.sound ? ambience.start() : ambience.stop(); };
function applyLook() {
  document.body.classList.toggle('text-lg', settings.textSize === 'large');
  document.body.classList.toggle('reduce-motion', settings.reduceMotion);
}
applyLook();
// sound may only start from a user gesture: resume on the first tap if it was left on
if (settings.sound) addEventListener('pointerdown', () => settings.sound && ambience.start(), { once: true });

// journal + this spot
initJournal({ profile, game, onSpecies: (id) => { const x = profile.data.species[id]; if (x) showSpecies({ id, name: x.name, sci: x.sci, group: x.group }, { grade: x.grade, pos: game.pos }); } });
$('b-journal').onclick = () => openJournal();
$('b-here').onclick = () => {
  if (!game.pos) return;
  const ch = world.chunkAt(game.pos.lat, game.pos.lon);
  showHere(game.pos, { game, areaName: ch?.areaName, elevation: world.groundAt(game.pos.lat, game.pos.lon) });
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

// housekeeping: drop stale cached reference data once the game is idle
setTimeout(() => pruneCache().catch(() => {}), 15000);

// installable app + instant reloads (production builds only)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// debug handle
window.openworld = { iconMat, iconUniforms, world, game, profile, environment, settings, applyTier, camera, ar, journal, ambience, __refresh: () => refreshCandidates(), __labels: () => updateLabels(), get __cand() { return cand; }, get __view() { return { viewLocal, dist: controls.dist }; }, get tier() { return tierName; } };

// help & about (static page; opened from settings or the start screen)
function openAbout(e) { e?.preventDefault(); $('settings').hidden = true; $('about').hidden = false; }
$('p-about').onclick = openAbout;
$('s-about').onclick = openAbout;
$('about-close').onclick = () => { $('about').hidden = true; };
$('about').addEventListener('click', (e) => { if (e.target.id === 'about') $('about').hidden = true; });
