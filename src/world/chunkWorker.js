// Web Worker: builds one zoom-14 chunk off the main thread.
// Input: tile x/y + options. Output: transferable typed arrays + an ImageBitmap texture.

import earcut from 'earcut';
import { loadBaseTile } from '../data/vtiles.js';
import { loadDetail } from '../data/osm.js';
import { ensureTerrain, heightOr } from '../data/terrain.js';
import { hsl, treeInstance, packTrees } from './trees.js';
import { HABITATS } from './habitats.js';
import { CHUNK_Z, chunkBounds, tileXToLon, tileYToLat, offsetMeters, rng, hashStr, haversine } from '../geo.js';

const HAB_INDEX = Object.fromEntries(HABITATS.map((h, i) => [h, i]));

const AREA_COLORS = {
  residential: '#dcd8c9', commercial: '#dad3cf', industrial: '#cfcac4', campus: '#e2d9c5',
  farmland: '#d8d3a6', grass: '#b2cf95', park: '#a6c98a', pitch: '#8cc387', cemetery: '#a3bd97',
  scrub: '#9db97e', wood: '#7aa968', wetland: '#9cc3ae', sand: '#ebdcb0', rock: '#bdb7ab', ice: '#eef4f7', water: '#7db0d6',
};
const AREA_ORDER = ['residential', 'commercial', 'industrial', 'campus', 'farmland', 'grass', 'park', 'pitch', 'cemetery', 'scrub', 'wood', 'wetland', 'sand', 'rock', 'ice', 'water'];
const GRID = 64;
const HGRID = 32;

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'build') {
      const { payload, transfer } = await build(msg);
      self.postMessage({ id: msg.id, ok: true, payload }, transfer);
    } else if (msg.type === 'detail') {
      const detail = await loadDetail(`${CHUNK_Z}/${msg.x}/${msg.y}`, chunkBounds(msg.x, msg.y));
      self.postMessage({ id: msg.id, ok: true, payload: detail });
    }
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err?.message || err) });
  }
};

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const shade = (c, f) => [Math.min(1, c[0] * f), Math.min(1, c[1] * f), Math.min(1, c[2] * f)];

function inside(x, y, ring) {
  let c = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a], [xb, yb] = ring[b];
    if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c;
  }
  return c;
}
const insidePoly = (x, y, rings) => inside(x, y, rings[0]) && !rings.slice(1).some((r) => inside(x, y, r));
function bbox(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}
function ringArea(ring) {
  let a = 0;
  for (let k = 0, n = ring.length; k < n; k++) { const [x1, y1] = ring[k], [x2, y2] = ring[(k + 1) % n]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a / 2);
}

async function build({ x, y, opts }) {
  const b = chunkBounds(x, y);
  const [fabric] = await Promise.all([loadBaseTile(CHUNK_Z, x, y), ensureTerrain(b)]);
  const E = fabric.extent;
  const latc = tileYToLat(y + 0.5, CHUNK_Z), lonc = tileXToLon(x + 0.5, CHUNK_Z);
  const latOf = (py) => tileYToLat(y + py / E, CHUNK_Z);
  const lonOf = (px) => tileXToLon(x + px / E, CHUNK_Z);
  const tileM = haversine(latc, b.w, latc, b.e); // tile width in metres
  const mPerPx = tileM / E;
  const seed = hashStr(`${x}/${y}`);

  // ---------- height grid (row 0 = north edge) ----------
  const grid = new Float32Array((GRID + 1) ** 2);
  const fb = heightOr(latc, lonc, 0);
  for (let r = 0; r <= GRID; r++) for (let c = 0; c <= GRID; c++) grid[r * (GRID + 1) + c] = heightOr(latOf((r / GRID) * E), lonOf((c / GRID) * E), fb);
  const H = (px, py) => {
    const gx = Math.min(GRID - 1e-6, Math.max(0, (px / E) * GRID)), gy = Math.min(GRID - 1e-6, Math.max(0, (py / E) * GRID));
    const c0 = Math.floor(gx), r0 = Math.floor(gy), ax = gx - c0, ay = gy - r0, W = GRID + 1;
    return (grid[r0 * W + c0] * (1 - ax) + grid[r0 * W + c0 + 1] * ax) * (1 - ay) + (grid[(r0 + 1) * W + c0] * (1 - ax) + grid[(r0 + 1) * W + c0 + 1] * ax) * ay;
  };
  // tile px -> local metres around the chunk centre (exact per vertex)
  const LX = (px) => offsetMeters(latc, lonc, latc, lonOf(px)).x;
  const LZ = (py) => offsetMeters(latc, lonc, latOf(py), lonc).z;
  // lookup tables make it cheap: x depends only on px, z only on py (lat/lon grid is separable)
  const lutN = 1024;
  const lutX = new Float32Array(lutN + 1), lutZ = new Float32Array(lutN + 1);
  for (let k = 0; k <= lutN; k++) { lutX[k] = LX((k / lutN) * E); lutZ[k] = LZ((k / lutN) * E); }
  const lut = (t, v) => { const f = Math.min(lutN, Math.max(0, (v / E) * lutN)); const i = Math.min(lutN - 1, Math.floor(f)); return t[i] + (t[i + 1] - t[i]) * (f - i); };
  const X = (px) => lut(lutX, px), Z = (py) => lut(lutZ, py);

  // ---------- terrain mesh ----------
  const tPos = new Float32Array((GRID + 1) ** 2 * 3), tUv = new Float32Array((GRID + 1) ** 2 * 2);
  for (let r = 0; r <= GRID; r++) for (let c = 0; c <= GRID; c++) {
    const k = r * (GRID + 1) + c;
    tPos[k * 3] = X((c / GRID) * E); tPos[k * 3 + 1] = grid[k]; tPos[k * 3 + 2] = Z((r / GRID) * E);
    tUv[k * 2] = c / GRID; tUv[k * 2 + 1] = r / GRID; // texture uploaded with flipY=false
  }

  // ---------- ground texture ----------
  const TEX = opts.tex || 1024, s = TEX / E;
  const canvas = new OffscreenCanvas(TEX, TEX);
  const g = canvas.getContext('2d');
  g.fillStyle = '#d3d8c6';
  g.fillRect(0, 0, TEX, TEX);
  const areas = fabric.areas.slice().sort((a, c) => AREA_ORDER.indexOf(a.cls) - AREA_ORDER.indexOf(c.cls));
  const trace = (rings) => { g.beginPath(); for (const ring of rings) ring.forEach(([px, py], k) => (k ? g.lineTo(px * s, py * s) : g.moveTo(px * s, py * s))); };
  for (const a of areas) { g.fillStyle = AREA_COLORS[a.cls]; trace(a.rings); g.fill('evenodd'); }
  g.lineCap = 'round'; g.lineJoin = 'round';
  const stroke = (pts) => { g.beginPath(); pts.forEach(([px, py], k) => (k ? g.lineTo(px * s, py * s) : g.moveTo(px * s, py * s))); g.stroke(); };
  const texPerM = TEX / tileM;
  const order = { river: 0, path: 1, road: 2, rail: 3 };
  const lines = fabric.lines.slice().sort((a, c) => order[a.cls] - order[c.cls] || a.width - c.width);
  for (const ln of lines) if (ln.cls === 'road') { g.strokeStyle = '#aaa497'; g.lineWidth = Math.max(1.5, ln.width * texPerM + 2); stroke(ln.pts); }
  for (const ln of lines) {
    g.lineWidth = Math.max(1, ln.width * texPerM);
    g.setLineDash(ln.cls === 'rail' ? [6, 4] : []);
    g.strokeStyle = ln.cls === 'road' ? '#f3f0e8' : ln.cls === 'path' ? '#e9dbbc' : ln.cls === 'rail' ? '#7f7a74' : AREA_COLORS.water;
    stroke(ln.pts);
  }
  g.setLineDash([]);
  g.fillStyle = 'rgba(90,85,75,0.28)';
  for (const bd of fabric.buildings) { trace(bd.rings); g.fill('evenodd'); }
  const texture = canvas.transferToImageBitmap();

  // ---------- habitat grid (what kind of ground is where; for wildlife) ----------
  const habitat = new Uint8Array(HGRID * HGRID);
  for (const a of areas) {
    const idx = HAB_INDEX[a.cls] ?? 0;
    const bb = bbox(a.rings[0]);
    const c0 = Math.max(0, Math.floor((bb.x0 / E) * HGRID)), c1 = Math.min(HGRID - 1, Math.floor((bb.x1 / E) * HGRID));
    const r0 = Math.max(0, Math.floor((bb.y0 / E) * HGRID)), r1 = Math.min(HGRID - 1, Math.floor((bb.y1 / E) * HGRID));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (insidePoly(((c + 0.5) / HGRID) * E, ((r + 0.5) / HGRID) * E, a.rings)) habitat[r * HGRID + c] = idx;
    }
  }

  // ---------- buildings (walls + earcut roofs, flat normals, vertex colours) ----------
  const pos = [], nrm = [], col = [];
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz, cl) => {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    col.push(...cl, ...cl, ...cl);
  };
  const footprints = [];
  for (const bd of fabric.buildings) {
    const outer = bd.rings[0];
    let ground = Infinity, cx = 0, cy = 0;
    for (const [px, py] of outer) { ground = Math.min(ground, H(px, py)); cx += px; cy += py; }
    cx /= outer.length; cy /= outer.length;
    const top = ground + bd.height;
    const bottom = bd.minHeight > 0 ? ground + bd.minHeight : ground - 1.5;
    const r = rng(seed ^ hashStr(`${Math.round(cx)},${Math.round(cy)}`))();
    const base = hexRgb(bd.colour) || (bd.height > 25 ? hsl(0.58, 0.12, 0.76) : bd.height > 11 ? hsl(0.09, 0.14, 0.8) : hsl(0.1, 0.33, 0.84));
    const wallC = shade(base, 0.92 + r * 0.12), lowC = shade(wallC, 0.8), roofC = shade(base, 1.06 + r * 0.06);
    for (const ring of bd.rings) {
      for (let k = 0; k < ring.length; k++) {
        const [p1x, p1y] = ring[k], [p2x, p2y] = ring[(k + 1) % ring.length];
        const x1 = X(p1x), z1 = Z(p1y), x2 = X(p2x), z2 = Z(p2y);
        tri(x1, bottom, z1, x2, bottom, z2, x2, top, z2, lowC);
        tri(x1, bottom, z1, x2, top, z2, x1, top, z1, wallC);
      }
    }
    const flat = [], holes = [];
    for (const ring of bd.rings) { if (flat.length) holes.push(flat.length / 2); for (const [px, py] of ring) flat.push(X(px), Z(py)); }
    const idx = earcut(flat, holes);
    for (let k = 0; k < idx.length; k += 3) {
      const a = idx[k] * 2, bb = idx[k + 1] * 2, c = idx[k + 2] * 2;
      tri(flat[a], top, flat[a + 1], flat[bb], top, flat[bb + 1], flat[c], top, flat[c + 1], roofC);
    }
    footprints.push({ ring: outer, bb: bbox(outer), top });
  }
  const buildings = pos.length ? { pos: new Float32Array(pos), nrm: new Float32Array(nrm), col: new Float32Array(col) } : null;

  // ---------- procedural trees in woodland / parks, seasonal ----------
  const season = opts.season;
  const DENS = { wood: 120, scrub: 280, park: 1800, cemetery: 900 }; // m² per tree
  const blobs = [], cones = [];
  const maxTrees = opts.maxTrees || 4000;
  const evergreenShare = Math.abs(latc) > 55 ? 0.6 : 0.22;
  for (let ai = 0; ai < fabric.areas.length && blobs.length + cones.length < maxTrees; ai++) {
    const a = fabric.areas[ai];
    const dens = DENS[a.cls];
    if (!dens) continue;
    const bb0 = bbox(a.rings[0]);
    const bb = { x0: Math.max(0, bb0.x0), y0: Math.max(0, bb0.y0), x1: Math.min(E, bb0.x1), y1: Math.min(E, bb0.y1) };
    if (bb.x1 <= bb.x0 || bb.y1 <= bb.y0) continue;
    const areaM = Math.min((bb.x1 - bb.x0) * (bb.y1 - bb.y0), ringArea(a.rings[0])) * mPerPx * mPerPx;
    const n = Math.min(maxTrees - blobs.length - cones.length, Math.round(areaM / dens));
    const rand = rng(seed ^ (ai * 2654435761));
    for (let k = 0, tries = 0; k < n && tries < n * 4; tries++) {
      const px = bb.x0 + rand() * (bb.x1 - bb.x0), py = bb.y0 + rand() * (bb.y1 - bb.y0);
      if (!insidePoly(px, py, a.rings)) continue;
      const small = a.cls === 'scrub';
      const radius = small ? 0.9 + rand() * 0.9 : 2 + rand() * 2.4;
      const evergreen = !small && a.cls === 'wood' && rand() < evergreenShare;
      (evergreen ? cones : blobs).push(treeInstance(X(px), H(px, py), Z(py), radius, evergreen ? 'evergreen-needle' : 'deciduous', season, rand));
      k++;
    }
  }

  // ---------- places (dense cities: keep the most notable per tile) ----------
  const PRIORITY = { tourism: 0, historic: 0, natural: 0, leisure: 1, transport: 1, amenity: 2, shop: 3 };
  const chosen = fabric.pois
    .map((p) => ({ p, k: (PRIORITY[p.kind.split(':')[0]] ?? 3) * 1000 + (p.rank || 99) }))
    .sort((a, c) => a.k - c.k)
    .slice(0, opts.maxPois || 300)
    .map((x) => x.p);
  // ---------- street names: compact polylines in local metres, merged per name ----------
  const byName = new Map(), rankOf = new Map();
  // road hierarchy: 3 arteries, 2 secondary/tertiary, 1 minor streets, 0 paths
  const RANK = { motorway: 3, trunk: 3, primary: 3, secondary: 2, tertiary: 2, path: 0, track: 0 };
  for (const st of fabric.streets || []) {
    const out = [];
    let lx = null, lz = null;
    for (const [px, py] of st.pts) {
      if (px < -64 || py < -64 || px > E + 64 || py > E + 64) continue;
      const x = X(px), z = Z(py);
      if (lx !== null && Math.hypot(x - lx, z - lz) < 8) continue; // ~8 m spacing is plenty for labels
      out.push(x, z); lx = x; lz = z;
    }
    if (out.length < 4) continue;
    const list = byName.get(st.name) || [];
    list.push(new Float32Array(out));
    byName.set(st.name, list);
    rankOf.set(st.name, Math.max(rankOf.get(st.name) ?? 0, RANK[st.cls] ?? 1));
    if (byName.size > 500) break;
  }
  const streets = [...byName].map(([name, lines]) => ({ name, lines, rank: rankOf.get(name) }));

  const pois = [];
  for (const p of chosen) {
    let base = H(p.px, p.py);
    for (const f of footprints) {
      if (p.px < f.bb.x0 || p.px > f.bb.x1 || p.py < f.bb.y0 || p.py > f.bb.y1) continue;
      if (inside(p.px, p.py, f.ring)) { base = Math.max(base, f.top); break; }
    }
    pois.push({ ref: p.ref, lat: latOf(p.py), lon: lonOf(p.px), x: X(p.px), z: Z(p.py), y: base + 5, ground: H(p.px, p.py), name: p.name, kind: p.kind, cls: p.cls || null, rank: p.rank });
  }

  const payload = {
    key: `${CHUNK_Z}/${x}/${y}`, x, y, bounds: b, latc, lonc, extent: E, gridN: GRID, grid, areaName: fabric.areaName, streets,
    terrain: { pos: tPos, uv: tUv }, texture, habitat, habitatN: HGRID,
    buildings, trees: packTrees(blobs), cones: packTrees(cones), pois,
  };
  const transfer = [grid.buffer, tPos.buffer, tUv.buffer, texture, habitat.buffer];
  if (buildings) transfer.push(buildings.pos.buffer, buildings.nrm.buffer, buildings.col.buffer);
  for (const t of [payload.trees, payload.cones]) if (t) transfer.push(t.mat.buffer, t.col.buffer, t.trunk.buffer);
  return { payload, transfer };
}
