// Floating labels: places, street names (zoomed in) and, in AR, tappable creature pins.
// Light by design: candidates are gathered 5x/second; positioning reuses a small fixed pool
// of elements, never reads layout, and avoids overlaps with estimated sizes.

import * as THREE from 'three';
import { haversine } from '../geo.js';
import { GROUP_STYLE } from '../data/wildlife.js';
import { atlasCss } from '../world/icons.js';
import { fmtDist } from '../units.js';
import { AR_PHOTO_M } from './arMode.js';

// Street names by road class: arteries show from far out, small streets only up close.
// (camera distance in metres under which each rank appears; fades in over the last quarter)
export const STREET_SHOW = [140, 300, 520, 1100]; // paths, minor, secondary/tertiary, arteries

export function initLabels(ctx) {
  const { camera, world, game, profile, settings } = ctx;
  const labelsEl = document.getElementById('labels');
  const labelPool = [], streetPool = [], pinPool = [];
  const v3 = new THREE.Vector3(), v3b = new THREE.Vector3(), fwd = new THREE.Vector3();
  let cand = { pois: [], streets: [] };

  labelsEl.addEventListener('click', (e) => {
    const el = e.target.closest('.label');
    if (!el || !game.pos) return;
    if (el._critter) return ctx.arMode.photographCritter(el._critter);
    if (el._poi) ctx.openPlace(el._poi);
  });
  function newEl(pool, cls) { const el = document.createElement('div'); el.className = cls; el.style.display = 'none'; labelsEl.appendChild(el); pool.push(el); return el; }
  function hideRest(pool, n) { for (let k = n; k < pool.length; k++) if (pool[k].style.display !== 'none') pool[k].style.display = 'none'; }
  const placed = [];
  function fits(l, t, r, b) {
    for (const q of placed) if (l < q[2] && r > q[0] && t < q[3] && b > q[1]) return false;
    placed.push([l, t, r, b]);
    return true;
  }
  const screenOf = (v) => [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
  const textW = (str, px) => str.length * px * 0.56 + 18;
  const streetFade = (rank) => Math.max(0, Math.min(1, (STREET_SHOW[rank ?? 1] - ctx.controls.dist) / (STREET_SHOW[rank ?? 1] * 0.25)));

  // nearest point of each named street to a reference point (local metres)
  function streetCandidates(rx, rz, maxD, maxN, minRank = 0) {
    const best = new Map();
    const g = world.toGeo(rx, rz), pad = maxD / 111320, padLon = pad / Math.max(0.2, Math.cos((g.lat * Math.PI) / 180));
    for (const ch of world.readyChunks()) {
      const b = ch.bounds;
      if (g.lat < b.s - pad || g.lat > b.n + pad || g.lon < b.w - padLon || g.lon > b.e + padLon) continue;
      const ox = ch.group.position.x, oz = ch.group.position.z, x0 = rx - ox, z0 = rz - oz;
      for (const st of ch.streets) {
        if ((st.rank ?? 1) < minRank) continue; // zoomed out: only bigger roads are even considered
        for (const L of st.lines) {
          for (let i = 0; i + 3 < L.length; i += 2) {
            const ax = L[i], az = L[i + 1], dx = L[i + 2] - ax, dz = L[i + 3] - az;
            let t = ((x0 - ax) * dx + (z0 - az) * dz) / (dx * dx + dz * dz || 1);
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x0 - px, z0 - pz);
            if (d > maxD) continue;
            const cur = best.get(st.name);
            if (!cur || d < cur.d) best.set(st.name, { name: st.name, rank: st.rank ?? 1, d, x: px + ox, z: pz + oz, dx, dz });
          }
        }
      }
    }
    // bigger roads win a slot when they're comparably close (each rank ≈ 120 m of priority)
    const list = [...best.values()].sort((a, b) => (a.d - a.rank * 120) - (b.d - b.rank * 120)).slice(0, maxN);
    for (const s2 of list) { const gg = world.toGeo(s2.x, s2.z); s2.y = (world.groundAt(gg.lat, gg.lon) ?? ctx.avatar.y) + 0.6; }
    return list;
  }

  function refreshCandidates() {
    cand = { pois: [], streets: [] };
    if (!game.pos) return;
    const ar = ctx.arMode.active, dist = ctx.controls.dist;
    const c = ar ? game.pos : ctx.view.geo || game.pos;
    const r = ar ? 450 : Math.max(220, Math.min(900, dist * 2.5));
    for (const { poi, chunk } of world.pois(c.lat, c.lon, r)) {
      const d = haversine(c.lat, c.lon, poi.lat, poi.lon);
      if (d < r) cand.pois.push({ poi, chunk, d });
    }
    cand.pois.sort((a, b) => a.d - b.d);
    if (cand.pois.length > 60) cand.pois.length = 60;
    if (ar) {
      // streets ahead of you: around a point ~25 m in front, at ground level
      fwd.set(0, 0, -1).applyQuaternion(camera.quaternion); fwd.y = 0; fwd.normalize();
      cand.streets = streetCandidates(camera.position.x + fwd.x * 25, camera.position.z + fwd.z * 25, 45, 3);
    } else if (dist < STREET_SHOW[3]) {
      const minRank = STREET_SHOW.findIndex((v) => v > dist);
      cand.streets = streetCandidates(ctx.view.local.x, ctx.view.local.z, Math.min(2200, Math.max(160, dist * 2.2)), 8, minRank);
    }
  }

  function update() {
    placed.length = 0;
    const big = settings.textSize === 'large' ? 1.18 : 1;
    const ar = ctx.arMode.active, dist = ctx.controls.dist;
    let nPin = 0, nPoi = 0, nSt = 0;
    if (game.pos) {
      // 1) AR: creature pins first (they're what you tap)
      if (ar) {
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
      const maxPoi = ar ? Math.max(8, ctx.tier.labels) : ctx.tier.labels;
      const nameFade = ar ? 1 : settings.placeNames === 'always' ? 1 : settings.placeNames === 'never' ? 0 : Math.max(0, Math.min(1, (48 - dist) / 14)); // names fade in below ~48 m
      for (const it of (nameFade > 0 ? cand.pois : [])) {
        if (nPoi >= maxPoi) break;
        v3.set(it.poi.x, it.poi.y + (ar ? 0 : 4.5), it.poi.z).add(it.chunk.group.position).project(camera);
        const lim = ar ? 0.95 : 1.1;
        if (v3.z > 1 || Math.abs(v3.x) > lim || Math.abs(v3.y) > lim) continue;
        let [x, y] = screenOf(v3);
        const d = ar ? haversine(game.pos.lat, game.pos.lon, it.poi.lat, it.poi.lon) : it.d;
        const text = ar ? fmtDist(d) : it.poi.name;
        const sc = ar ? Math.max(0.82, Math.min(1.12, 1.15 - d / 700)) : 1;
        const w = textW(text, 11 * big * sc) + (ar ? 26 : 0), h = (ar ? 30 : 20) * big * sc;
        if (ar) x = Math.max(w / 2 + 6, Math.min(innerWidth - w / 2 - 6, x)); // keep pins fully on screen
        if (!fits(x - w / 2, y - h, x + w / 2, y)) continue;
        const el = labelPool[nPoi] || newEl(labelPool, 'label');
        nPoi++;
        el._poi = it.poi;
        if (ar) {
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
        const cls = 'label' + (ar ? ' arpin' : '') + (profile.data.discoveries[it.poi.ref] ? ' done' : '') + (st && !st.open ? ' closed' : '');
        if (el.className !== cls) el.className = cls;
        if (ar && el.style.opacity !== '1') el.style.opacity = '1';
        el.style.display = '';
        el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)${sc !== 1 ? ` scale(${sc.toFixed(2)})` : ''}`;
      }
      // 3) street names: quiet map text, only when zoomed in (or ahead of you in AR)
      for (const sn of cand.streets) {
        const fade = ar ? 1 : streetFade(sn.rank);
        if (fade <= 0) continue;
        v3.set(sn.x, sn.y, sn.z).project(camera);
        if (v3.z > 1 || Math.abs(v3.x) > 0.95 || Math.abs(v3.y) > 0.95) continue;
        const [x, y] = screenOf(v3);
        let ang = 0;
        if (!ar) {
          v3b.set(sn.x + sn.dx, sn.y, sn.z + sn.dz).project(camera);
          const [x2, y2] = screenOf(v3b);
          ang = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI;
          if (ang > 90) ang -= 180; else if (ang < -90) ang += 180; // keep text upright
        }
        const fs = (sn.rank >= 3 ? 13.5 : sn.rank === 2 ? 12.5 : 12) * big;
        const w = textW(sn.name, fs), h = 16 * big, a = (ang * Math.PI) / 180;
        const bw = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)), bh = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
        if (!fits(x - bw / 2, y - bh / 2, x + bw / 2, y + bh / 2)) continue;
        const el = streetPool[nSt] || newEl(streetPool, 'street');
        nSt++;
        if (el.textContent !== sn.name) el.textContent = sn.name;
        const cls = sn.rank >= 3 ? 'street major' : sn.rank === 2 ? 'street mid' : 'street';
        if (el.className !== cls) el.className = cls;
        const op = fade.toFixed(1);
        if (el.style.opacity !== op) el.style.opacity = op;
        el.style.display = '';
        el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) rotate(${ang.toFixed(1)}deg)`;
      }
    }
    hideRest(pinPool, nPin); hideRest(labelPool, nPoi); hideRest(streetPool, nSt);
  }

  return {
    refreshCandidates, update,
    // visible place pins, for drawing into an AR photo
    visiblePlaceLabels: () => labelPool.filter((el) => el.style.display !== 'none' && el.textContent),
    get candidates() { return cand; },
  };
}
