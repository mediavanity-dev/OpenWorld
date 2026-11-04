import * as THREE from 'three';
import { World } from './world/world.js';
import { Profile } from './game/profile.js';
import { Game, MODES, RULES } from './game/game.js';
import { resolveAnchor } from './game/anchors.js';
import { deviceFix, ipFix, watchDevice, trustOf } from './game/locator.js';
import { haversine } from './geo.js';

const $ = (id) => document.getElementById(id);
const MODE_COLOR = { present: '#ff7a3d', home: '#3db8ff', roam: '#b07aff' };

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
$('app').appendChild(renderer.domElement);

const SKY = new THREE.Color('#cfe3ef');
const scene = new THREE.Scene();
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 400, 2600);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 8000);
scene.add(new THREE.HemisphereLight('#eef6ff', '#8b9079', 1.3));
const sun = new THREE.DirectionalLight('#fff3df', 1.7);
sun.position.set(400, 700, 250);
scene.add(sun);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- core
const world = new World(scene, { anisotropy: renderer.capabilities.getMaxAnisotropy() });
const profile = new Profile();
const game = new Game(world, profile, onGameEvent);
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
avatar.add(body, head, nose, ring, pointer);
scene.add(avatar);
let avatarY = 0;

function styleAvatar() {
  const c = MODE_COLOR[game.mode] || MODE_COLOR.present;
  avatarMat.color.set(c);
  avatarMat.opacity = game.mode === 'roam' ? 0.55 : 1;
  ring.material.color.set(c);
  pointer.material.color.set(c);
}

// ---------------------------------------------------------------- beacons, home, leash
const beaconGroup = new THREE.Group();
scene.add(beaconGroup);
const pillarGeo = new THREE.CylinderGeometry(0.6, 0.6, 60, 8, 1, true).translate(0, 30, 0);
const orbGeo = new THREE.SphereGeometry(1.4, 16, 12);
const homeGeo = new THREE.ConeGeometry(5, 7, 4).translate(0, 3.5, 0);
const STATUS_COLOR = { feature: '#ffd36b', ground: '#5fe0d0', shifted: '#ffa04d', orphaned: '#ff5d5d' };
const beaconObjs = new Map(); // id -> group
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
      const mat = new THREE.MeshBasicMaterial({ color: '#ffd36b', transparent: true, opacity: 0.35, depthWrite: false });
      g = new THREE.Group();
      g.add(new THREE.Mesh(pillarGeo, mat), new THREE.Mesh(orbGeo, new THREE.MeshLambertMaterial({ color: '#ffd36b', emissive: '#553b00' })));
      g.children[1].position.y = 2.5;
      beaconObjs.set(b.id, g);
      beaconGroup.add(g);
    }
    const r = resolveAnchor(world, b.anchor);
    g.visible = r.status !== 'pending';
    if (!g.visible) continue;
    placeAt(g, r.lat, r.lon, r.y);
    const c = STATUS_COLOR[r.status];
    g.children[0].material.color.set(c);
    g.children[1].material.color.set(c);
    g.userData.status = r.status;
  }
  // home marker
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

world.on((ev) => {
  if (ev.type === 'chunk') {
    for (const p of ev.chunk.pois) {
      const d = profile.data.discoveries[p.ref];
      if (d) ev.chunk.markPoi(p.ref, d.grade);
    }
    refreshBeacons();
  }
  if (ev.type === 'status') updateWorldStatus();
});

// ---------------------------------------------------------------- camera + input
const cam = { yaw: 0, pitch: 0.75, dist: 70 };
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'KeyB' && game.mode) { game.placeBeacon(); refreshBeacons(); renderHud(); }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const canvas = renderer.domElement;
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  cam.yaw -= (e.clientX - drag.x) * 0.006;
  cam.pitch = Math.min(1.5, Math.max(0.08, cam.pitch + (e.clientY - drag.y) * 0.004));
  drag.x = e.clientX; drag.y = e.clientY;
});
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener('pointercancel', () => (drag = null));
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.dist = Math.min(2500, Math.max(5, cam.dist * Math.pow(1.0015, e.deltaY)));
}, { passive: false });

// touch joystick
const stick = { x: 0, y: 0 };
const stickEl = $('stick');
stickEl.addEventListener('pointermove', (e) => {
  if (!e.pressure && e.pointerType !== 'touch') return;
  const r = stickEl.getBoundingClientRect();
  let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
  const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
  stick.x = x; stick.y = y;
  stickEl.firstElementChild.style.transform = `translate(${x * 35}px, ${y * 35}px)`;
});
const stickEnd = () => { stick.x = stick.y = 0; stickEl.firstElementChild.style.transform = ''; };
stickEl.addEventListener('pointerup', stickEnd);
stickEl.addEventListener('pointerleave', stickEnd);

function moveInput() {
  let f = 0, s = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
  f -= stick.y; s += stick.x;
  const m = Math.hypot(f, s);
  if (m < 0.05) return null;
  if (m > 1) { f /= m; s /= m; }
  const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
  // forward (north/east) = (-sin yaw east, cos yaw north); right = (cos yaw east, sin yaw north)
  return {
    east: -sy * f + cy * s,
    north: cy * f + sy * s,
    run: keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(stick.x, stick.y) > 0.95,
  };
}

// ---------------------------------------------------------------- floating labels
const labelsEl = $('labels');
const labelPool = [];
const v3 = new THREE.Vector3();
function updateLabels() {
  const list = [];
  if (game.pos) {
    for (const { poi, chunk } of world.pois()) {
      const d = haversine(game.pos.lat, game.pos.lon, poi.lat, poi.lon);
      if (d < 220) list.push({ poi, chunk, d });
    }
  }
  list.sort((a, b) => a.d - b.d);
  list.length = Math.min(list.length, 14);
  while (labelPool.length < list.length) { const el = document.createElement('div'); el.className = 'label'; labelsEl.appendChild(el); labelPool.push(el); }
  labelPool.forEach((el, k) => {
    const it = list[k];
    if (!it) { el.style.display = 'none'; return; }
    v3.set(it.poi.x, it.poi.y + 3.5, it.poi.z).add(it.chunk.group.position).project(camera);
    if (v3.z > 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.left = ((v3.x + 1) / 2) * innerWidth + 'px';
    el.style.top = ((1 - v3.y) / 2) * innerHeight + 'px';
    const known = profile.data.discoveries[it.poi.ref];
    el.textContent = it.poi.name;
    el.className = 'label' + (known ? ' done' : '');
  });
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let hudT = 0, labelT = 0;
let facing = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const move = MODES[game.mode]?.canMove ? moveInput() : null;
  game.tick(dt, move);

  if (game.pos) {
    const rebased = world.update(game.pos.lat, game.pos.lon);
    if (rebased) refreshBeacons();
    const o = world.toLocal(game.pos.lat, game.pos.lon);
    const g = world.groundAt(game.pos.lat, game.pos.lon);
    if (g !== null) avatarY += (g - avatarY) * (Math.abs(g - avatarY) > 50 ? 1 : Math.min(1, dt * 12));
    avatar.position.set(o.x, avatarY, o.z);
    if (move) facing = Math.atan2(-move.east, move.north);
    const turn = Math.atan2(Math.sin(facing - avatar.rotation.y), Math.cos(facing - avatar.rotation.y));
    avatar.rotation.y += turn * Math.min(1, dt * 10);
    const ps = Math.max(1, cam.dist / 25);
    pointer.scale.setScalar(ps);
    pointer.position.y = 3 + ps * 2;
    ring.scale.setScalar(Math.max(1, cam.dist / 40));

    const tx = avatar.position.x, ty = avatarY + 1.6, tz = avatar.position.z;
    camera.position.set(
      tx + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist,
      ty + Math.sin(cam.pitch) * cam.dist,
      tz + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist,
    );
    const cg = world.toGeo(camera.position.x, camera.position.z);
    const floor = world.groundAt(cg.lat, cg.lon);
    if (floor !== null && camera.position.y < floor + 2) camera.position.y = floor + 2;
    camera.lookAt(tx, ty, tz);
    scene.fog.far = Math.max(2600, cam.dist * 3);
    scene.fog.near = Math.max(400, cam.dist * 0.8);
  }
  beaconGroup.children.forEach((b) => (b.children[1].position.y = 2.5 + Math.sin(now / 500) * 0.4));

  labelT += dt; if (labelT > 0.05) { labelT = 0; updateLabels(); }
  hudT += dt; if (hudT > 0.25) { hudT = 0; renderHud(); }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- events / toasts
function toast(msg, cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
  while ($('toasts').children.length > 4) $('toasts').firstElementChild.remove();
}

function onGameEvent(ev) {
  if (ev.type === 'error') toast(ev.msg, 'error');
  else if (ev.type === 'discover') toast(ev.msg, ev.grade);
  else if (ev.type === 'mode') { toast(ev.msg, ev.mode === 'roam' ? 'echo' : ev.mode); styleAvatar(); refreshLeash(); }
  else toast(ev.msg);
}

// ---------------------------------------------------------------- HUD
const fmt = (v) => v.toFixed(5);
function fixText(f) {
  if (!f) return 'none';
  return f.source === 'ip' ? `IP · ${f.place || '≈ city'} (±5 km)` : `${trustOf(f)} · ±${Math.round(f.accuracy)} m`;
}

function renderHud() {
  if (!game.mode) return;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.mode === game.mode));
  $('h-desc').textContent = MODES[game.mode].desc;
  $('h-pos').textContent = game.pos ? `${fmt(game.pos.lat)}, ${fmt(game.pos.lon)}` : '–';
  $('h-fix').textContent = fixText(game.fix);
  const h = profile.data.home;
  $('h-home').textContent = h
    ? `${h.trust} · ${game.pos ? Math.round(haversine(h.lat, h.lon, game.pos.lat, game.pos.lon)) + ' m away' : ''}`
    : 'not set';
  $('b-sethome').disabled = game.mode !== 'present' || !game.fix;
  $('b-beacon').disabled = !MODES[game.mode].beacons;

  const c = profile.counts();
  $('c-present').textContent = c.present;
  $('c-home').textContent = c.home;
  $('c-echo').textContent = c.echo;
  $('c-beacons').textContent = profile.data.beacons.length;

  const n = game.nearest;
  if (n) {
    $('n-name').textContent = n.poi.name;
    $('n-dist').textContent = `${Math.round(n.dist)} m · ${n.poi.kind.replace(':', ' ')}`;
    const rel = n.bearing + (cam.yaw * 180) / Math.PI;
    $('n-arrow').style.transform = `rotate(${rel}deg)`;
  } else {
    $('n-name').textContent = 'Nothing new nearby';
    $('n-dist').textContent = '';
  }

  const logEl = $('log');
  const items = profile.data.log.slice(0, 12).map((l) => `<li>${new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${escapeHtml(l.msg)}</li>`).join('');
  if (logEl.dataset.v !== items) { logEl.innerHTML = items; logEl.dataset.v = items; }
}

function updateWorldStatus() {
  const s = world.status();
  $('w-status').textContent = s.loading
    ? `Loading world… ${s.ready}/${s.ready + s.loading} areas${s.error ? ` · ${s.error} failed (retrying)` : ''}`
    : s.error ? `${s.error} area(s) failed to load: the public OSM server may be busy; retrying` : '';
}

function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

// ---------------------------------------------------------------- actions
async function parsePlace(q) {
  const m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) > 85 || Math.abs(lon) > 180) throw new Error('Coordinates out of range');
    return { lat, lon };
  }
  // Place names: OSM Nominatim (open, rate-limited; one lookup per user action)
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
    if (mode === 'present' && game.fix?.source === 'device') startWatching();
    avatarY = world.groundAt(game.pos.lat, game.pos.lon) ?? avatarY;
    styleAvatar();
    renderHud();
    return true;
  }
  return false;
}

async function locateDevice(msgEl) {
  msgEl && (msgEl.textContent = 'Asking your device for its location…');
  try {
    const f = await deviceFix();
    game.setFix(f);
    msgEl && (msgEl.textContent = '');
    return f;
  } catch (e) {
    const m = `Device location failed: ${e.message}. Try "via internet" instead.`;
    msgEl ? (msgEl.textContent = m) : toast(m, 'error');
    return null;
  }
}

async function locateIp(msgEl) {
  msgEl && (msgEl.textContent = 'Looking up your internet connection’s location…');
  try {
    const f = await ipFix();
    game.setFix(f);
    msgEl && (msgEl.textContent = '');
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
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = async () => {
  const mode = b.dataset.mode;
  if (mode === game.mode) return;
  if (mode === 'present' && !game.fix && !(await locateDevice())) return;
  begin(mode, mode === 'roam' ? { to: game.pos } : {});
}));
$('b-locate').onclick = async () => { if (await locateDevice() && game.mode === 'present') begin('present'); else if (game.fix) toast('Device fix updated: ' + fixText(game.fix)); };
$('b-ip').onclick = async () => { if (await locateIp() && game.mode === 'present') begin('present'); else if (game.fix) toast('Fix updated: ' + fixText(game.fix)); };
$('b-sethome').onclick = () => {
  if (profile.data.home && !confirm('Move your home base here? It can then not be moved again for 30 days.')) return;
  if (!profile.data.home && !confirm('Set your permanent home base at your current real location?')) return;
  if (game.setHome()) { $('s-home').hidden = false; refreshBeacons(); renderHud(); }
};
$('b-beacon').onclick = () => { const label = prompt('Beacon label?', `Beacon ${profile.data.beacons.length + 1}`); if (label !== null) { game.placeBeacon(label); refreshBeacons(); renderHud(); } };
$('h-roam-form').onsubmit = async (e) => {
  e.preventDefault();
  try { const to = await parsePlace($('h-roam').value); begin('roam', { to }); $('h-roam').value = ''; }
  catch (err) { toast(err.message, 'error'); }
};
$('p-export').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([profile.export()], { type: 'application/json' }));
  a.download = `openworld-profile-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$('p-import').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    profile.import(await f.text());
    beaconObjs.forEach((g) => beaconGroup.remove(g)); beaconObjs.clear();
    for (const ch of world.readyChunks()) for (const p of ch.pois) { const d = profile.data.discoveries[p.ref]; if (d) ch.markPoi(p.ref, d.grade); }
    refreshBeacons(); renderHud(); toast('Profile imported');
  } catch (err) { toast('Import failed: ' + err.message, 'error'); }
  e.target.value = '';
};
$('p-reset').onclick = () => { if (confirm('Erase this profile (discoveries, beacons, home base)?')) { profile.reset(); location.reload(); } };

// deep link: ?at=lat,lon starts directly in Roam there
const at = new URLSearchParams(location.search).get('at');
if (at) parsePlace(at).then((to) => begin('roam', { to })).catch((e) => (sMsg.textContent = e.message));

// debug handle
window.openworld = { world, game, profile };
