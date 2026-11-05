// Rephotography (beta): at a historic place, an old photo taken right there appears as a
// ghost over the camera view. Line it up with today's view; the match meter shows how
// close you are. Capture it to keep the "then & now" in your journal (and save the pair
// as an image if you like). Everything is composed on the device; nothing is uploaded.

import { haversine } from '../geo.js';
import { groupOf } from '../world/icons.js';
import { oldPhotosAt } from '../data/science.js';
import { matchScore, overlayRegion, GOOD_MATCH } from '../game/rephotoMatch.js';
import { safeUrl } from '../util/html.js';
import { toast, setText } from './hud.js';
import { saveImage } from './arMode.js';

const $ = (id) => document.getElementById(id);
const NEAR_M = 80;            // how close to the place you need to be
const CMP_W = 48;             // comparison image width (px): small on purpose (fast, and ignores detail)
const OLD_GROUPS = new Set(['history', 'sight', 'worship', 'museum', 'culture']);

// places likely to have been photographed long ago
function eligible(poi) {
  return OLD_GROUPS.has(groupOf(poi.kind, poi.cls)) || !!poi.tags?.heritage || !!poi.tags?.start_date;
}

export function initRephoto(ctx) {
  const { game, world, profile } = ctx;
  const photos = new Map();   // poi.ref -> photo list (or [] when none) | 'loading'
  const offered = new Set();  // places we already told the player about
  let offer = null;           // { poi, list }
  let open = null;            // { poi, list, i, score, best, captured }
  let stepT = 0;
  const ghost = $('rephoto-ghost');
  ghost.crossOrigin = 'anonymous'; // Commons allows it; needed to read pixels for the match
  const cA = document.createElement('canvas'), cB = document.createElement('canvas');
  const gA = cA.getContext('2d', { willReadFrequently: true }), gB = cB.getContext('2d', { willReadFrequently: true });

  const enabled = () => !!game.features.rephoto && game.mode === 'present';

  // 5x a second: is there an old photo of a place we're standing at?
  function check() {
    if (!enabled() || !game.pos) { if (offer) { offer = null; renderButton(); } return; }
    let best = null;
    for (const { poi } of world.pois(game.pos.lat, game.pos.lon, NEAR_M)) {
      if (!eligible(poi)) continue;
      const d = haversine(game.pos.lat, game.pos.lon, poi.lat, poi.lon);
      if (d <= NEAR_M && (!best || d < best.d)) best = { poi, d };
    }
    const poi = best?.poi || null;
    if (poi && !photos.has(poi.ref)) {
      photos.set(poi.ref, 'loading');
      oldPhotosAt(poi.lat, poi.lon).then((list) => photos.set(poi.ref, list)).catch(() => photos.set(poi.ref, []));
    }
    const list = poi && photos.get(poi.ref);
    const next = Array.isArray(list) && list.length ? { poi, list } : null;
    if (next?.poi.ref !== offer?.poi.ref) {
      offer = next;
      if (offer && !offered.has(offer.poi.ref) && !ctx.arMode.active) {
        offered.add(offer.poi.ref);
        toast(`An old photo of ${offer.poi.name} (${offer.list[0].year}) was taken near here. Open the camera 📷 to line it up.`, 'gold');
      }
      renderButton();
    }
  }

  function renderButton() {
    const btn = $('rephoto-btn');
    btn.hidden = !offer || !!open;
    if (offer) btn.textContent = `👻 ${offer.list[0].year} photo of ${offer.poi.name}: line it up`;
  }

  function show(i) {
    const p = open.list[i];
    open.i = i; open.score = 0; open.best = 0; open.captured = false;
    ghost.src = p.src;
    ghost.hidden = false;
    setText('rephoto-title', `${open.poi.name}, ${p.year}`);
    const credit = $('rephoto-credit');
    credit.textContent = '';
    const a = document.createElement('a');
    a.textContent = `${p.title}${p.by ? ` · ${p.by}` : ''}${p.licence ? ` · ${p.licence}` : ''} · Wikimedia Commons`;
    if (safeUrl(p.url)) { a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; }
    credit.appendChild(a);
    $('rephoto-other').hidden = open.list.length < 2;
    $('rephoto-capture').textContent = 'Capture';
    meter(0);
  }

  function start() {
    if (!offer || !ctx.arMode.active) return;
    open = { poi: offer.poi, list: offer.list, i: 0 };
    $('rephoto-panel').hidden = false;
    show(0);
    ghost.style.opacity = String($('rephoto-fade').value / 100);
    renderButton();
  }

  function close() {
    open = null;
    ghost.hidden = true;
    ghost.removeAttribute('src');
    $('rephoto-panel').hidden = true;
    renderButton();
  }

  function meter(score) {
    $('rephoto-bar').style.width = `${score}%`;
    setText('rephoto-score', score >= GOOD_MATCH ? `Lined up: ${score}% match. Capture it!` : score > 0 ? `${score}% match: keep adjusting` : 'Line up the old photo with the view');
  }

  // compare what the camera sees under the ghost with the ghost itself (2-3 times a second)
  function step(now) {
    if (!open || open.captured || now - stepT < 400) return;
    stepT = now;
    const v = $('ar-video');
    if (!ghost.complete || !ghost.naturalWidth || !v.videoWidth) return;
    const r = overlayRegion(innerWidth, innerHeight, ghost.naturalWidth, ghost.naturalHeight, v.videoWidth, v.videoHeight);
    const w = CMP_W, h = Math.max(8, Math.round((CMP_W * r.screen.h) / r.screen.w));
    cA.width = cB.width = w; cA.height = cB.height = h;
    try {
      gA.drawImage(v, r.video.x, r.video.y, r.video.w, r.video.h, 0, 0, w, h);
      gB.drawImage(ghost, 0, 0, w, h);
      open.score = matchScore(gA.getImageData(0, 0, w, h).data, gB.getImageData(0, 0, w, h).data, w, h);
    } catch { open.score = 0; } // image not readable (no CORS): the overlay still works, just no meter
    open.best = Math.max(open.best, open.score);
    meter(open.score);
  }

  function capture() {
    if (!open) return;
    if (open.captured) return saveThenAndNow();
    const p = open.list[open.i], score = open.score;
    const store = (profile.data.rephotos ||= {});
    const key = `${open.poi.ref}|${p.url}`;
    const prev = store[key];
    const { snap } = game.conditions();
    store[key] = {
      name: open.poi.name, ref: open.poi.ref, year: p.year, photo: { url: p.url, title: p.title, by: p.by, licence: p.licence },
      score: Math.max(score, prev?.score || 0), first: prev?.first || new Date().toISOString(), last: new Date().toISOString(), conditions: snap,
    };
    profile.log(`Then & now: ${open.poi.name} (${p.year}), ${score}% match`);
    profile.save();
    ctx.arMode.flash();
    game.emit('rephoto', `Then & now: ${open.poi.name}, ${p.year} · ${score}% match${score >= GOOD_MATCH ? '' : ' (line it up closer for a better score)'}`, { poi: open.poi, score });
    if (p.about) toast(p.about.length > 200 ? p.about.slice(0, 197) + '…' : p.about);
    open.captured = true;
    $('rephoto-capture').textContent = 'Save then & now';
  }

  // the old photo and today's camera view side by side, with a caption
  async function saveThenAndNow() {
    const v = $('ar-video'), p = open.list[open.i];
    const r = overlayRegion(innerWidth, innerHeight, ghost.naturalWidth, ghost.naturalHeight, v.videoWidth, v.videoHeight);
    const H = 720, W = Math.round((H * r.screen.w) / r.screen.h), cap = 56;
    const c = document.createElement('canvas'); c.width = W * 2 + 12; c.height = H + cap;
    const g = c.getContext('2d');
    g.fillStyle = '#10141a'; g.fillRect(0, 0, c.width, c.height);
    try { g.drawImage(ghost, 0, 0, W, H); } catch { /* not readable: leave blank */ }
    g.drawImage(v, r.video.x, r.video.y, r.video.w, r.video.h, W + 12, 0, W, H);
    g.fillStyle = '#fff'; g.font = '22px system-ui, sans-serif'; g.textBaseline = 'middle';
    g.fillText(`${open.poi.name}: ${p.year} and ${new Date().getFullYear()}`, 16, H + cap / 2);
    g.fillStyle = '#9aa4ae'; g.font = '14px system-ui, sans-serif'; g.textAlign = 'right';
    g.fillText(`${p.by ? `${p.by} · ` : ''}${p.licence || ''} · Wikimedia Commons`.slice(0, 90), c.width - 16, H + cap / 2);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
    await saveImage(blob, `openworld-then-and-now-${new Date().toISOString().slice(0, 10)}.jpg`);
  }

  $('rephoto-btn').onclick = start;
  $('rephoto-close').onclick = close;
  $('rephoto-capture').onclick = capture;
  $('rephoto-other').onclick = () => open && show((open.i + 1) % open.list.length);
  $('rephoto-fade').oninput = (e) => { ghost.style.opacity = String(e.target.value / 100); };
  ctx.arMode.onEnter(renderButton);
  ctx.arMode.onExit(close);

  return { check, step };
}
