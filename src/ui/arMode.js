// Camera AR (Present mode, phones): entering and leaving, photographing creatures, saving a
// photo of the view, and the compass ribbon along the top.

import { ARView } from '../ar.js';
import { WALK } from '../names.js';
import { haversine, offsetMeters } from '../geo.js';
import { GROUP_STYLE } from '../data/wildlife.js';
import { fmtDist, fmtTemp } from '../units.js';
import { buzz, currentHeading } from '../sensors.js';
import { isTouch } from '../settings.js';
import { closeCard } from './card.js';
import { toast, setText, announce } from './hud.js';

export const AR_PHOTO_M = 40; // how close you need to be to photograph a creature
const $ = (id) => document.getElementById(id);
const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const SPAN = 120; // degrees shown across the ribbon

export function initArMode(ctx) {
  const { renderer, scene, camera, world, game, environment, settings } = ctx;
  const ar = new ARView($('ar-video'));
  let saved = null;
  const listeners = { enter: [], exit: [] };

  // AR shows places as small screen pins instead of the 3D world
  function setWorldVisible(chunk, on) { for (const o of chunk.group.children) o.visible = on; }

  async function enter() {
    if (game.mode !== 'present') return toast(`AR works in ${WALK} mode, where you really are.`, 'error');
    try {
      await ar.start();
    } catch (err) {
      return toast(err.name === 'NotAllowedError' ? "Camera permission was refused, so AR can't start." : `AR unavailable: ${err.message}`, 'error');
    }
    saved = { fov: camera.fov, near: camera.near, far: camera.far, bg: scene.background, fog: scene.fog };
    scene.background = null;
    scene.fog = null;
    for (const ch of world.readyChunks()) setWorldVisible(ch, false);
    ctx.avatar.group.visible = false;
    ctx.markers.setLeashVisible(false);
    if (ctx.sky.particles) ctx.sky.particles.visible = false;
    document.body.classList.add('ar');
    ar.userOffset = 0; ribbonW = 0;
    ctx.labels.refreshCandidates();
    closeCard();
    announce('Camera view on');
    if (!ar.absolute) toast("This phone isn't reporting north, so drag sideways to line labels up.", 'species');
    listeners.enter.forEach((fn) => fn());
  }

  function exit() {
    if (!ar.active) return;
    ar.stop();
    document.body.classList.remove('ar');
    if (saved) {
      scene.background = saved.bg; scene.fog = saved.fog;
      camera.fov = saved.fov; camera.near = saved.near; camera.far = saved.far; camera.updateProjectionMatrix();
    }
    for (const ch of world.readyChunks()) setWorldVisible(ch, true);
    ctx.controls.pan.x = ctx.controls.pan.z = 0; // AR drags shouldn't leave the map panned
    ctx.avatar.group.visible = true;
    ctx.markers.setLeashVisible(true);
    listeners.exit.forEach((fn) => fn());
  }

  function flash() {
    const el = $('ar-flash');
    if (!settings.reduceMotion) { el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); }
    buzz(40);
  }

  function photographCritter(c) {
    const d = haversine(game.pos.lat, game.pos.lon, c.lat, c.lon);
    if (d > AR_PHOTO_M) return toast(`Get a bit closer to photograph it (${fmtDist(d)} away, need ${fmtDist(AR_PHOTO_M)}).`, 'species');
    flash();
    game.spot(c, 'photo');
  }

  // Photo: camera frame + 3D overlay + labels + a caption, composed on the device; nothing is uploaded.
  async function photo() {
    if (!ar.active) return;
    renderer.render(scene, camera); // draw now so the WebGL canvas can be copied in this task
    const src = renderer.domElement, W = src.width, H = src.height, dpr = W / innerWidth;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const v = $('ar-video'), vw = v.videoWidth || W, vh = v.videoHeight || H, k = Math.max(W / vw, H / vh);
    g.drawImage(v, (W - vw * k) / 2, (H - vh * k) / 2, vw * k, vh * k);
    g.drawImage(src, 0, 0);
    g.font = `${Math.round(12 * dpr)}px system-ui, sans-serif`; g.textBaseline = 'middle';
    for (const el of ctx.labels.visiblePlaceLabels()) {
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
    await saveImage(blob, `openworld-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`);
  }

  // AR compass ribbon: heading + where things are, with edge arrows for anything off-screen.
  // ~12 small elements moved by transform 10x/second; width read once (no per-frame layout).
  const ribbon = $('ar-compass'), ribbonTicks = ribbon.querySelector('.ticks');
  const tickEls = Array.from({ length: 9 }, () => ribbonTicks.appendChild(document.createElement('span')));
  const markEls = Array.from({ length: 4 }, () => { const m = document.createElement('i'); m.className = 'mark'; ribbonTicks.appendChild(m); return m; });
  let ribbonW = 0, ribT = 0;
  const bearingTo = (lat, lon) => { const o = offsetMeters(game.pos.lat, game.pos.lon, lat, lon); return ((Math.atan2(o.x, -o.z) * 180) / Math.PI + 360) % 360; };
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
    const star = game.taskTarget || game.nearest;
    if (star) items.push({ b: bearingTo(star.poi.lat, star.poi.lon), icon: '★', cls: 'target' });
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

  // drag sideways to nudge the compass if labels don't line up with the real world
  let dragX = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { if (ar.active) dragX = e.clientX; });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!ar.active || dragX === null || !e.buttons) return;
    ar.userOffset += (e.clientX - dragX) * 0.15;
    dragX = e.clientX;
  });
  addEventListener('pointerup', () => { dragX = null; });
  $('ar-btn').onclick = () => (ar.active ? exit() : enter());
  $('ar-exit').onclick = exit;
  $('ar-photo').onclick = photo;

  // per frame while active: stand at the character's eyes and look where the phone points
  function step(rdt) {
    camera.position.set(ctx.avatar.group.position.x, ctx.avatar.y + 1.6, ctx.avatar.group.position.z);
    ar.step(camera.quaternion, rdt);
    const fov = ar.fov(camera.aspect);
    if (Math.abs(camera.fov - fov) > 0.5 || camera.near !== 0.3) { camera.fov = fov; camera.near = 0.3; camera.far = 3000; camera.updateProjectionMatrix(); }
  }

  return {
    ar, enter, exit, step, updateRibbon, photographCritter, flash, setWorldVisible,
    get active() { return ar.active; },
    heading: () => currentHeading() ?? 0,
    onEnter(fn) { listeners.enter.push(fn); },
    onExit(fn) { listeners.exit.push(fn); },
  };
}

// share sheet on phones, download elsewhere
export async function saveImage(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (isTouch && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch { /* cancelled */ } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
