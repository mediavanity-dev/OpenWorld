// Builds the abstract 3D representation of one chunk from its normalized fabric.
// Precision is deliberately low; object *reality* is preserved: a tree in OSM is
// a blob tree here, a building is a coloured extrusion, a park is green ground.

import * as THREE from 'three';
import { offsetMeters, rng, hashStr } from '../geo.js';
import { heightOr } from '../data/terrain.js';

const TEX = 1024;
const GRID = 64;

const AREA_COLORS = {
  farmland: '#d8d3a6', grass: '#a8c98c', pitch: '#8cc387', cemetery: '#a3bd97',
  parking: '#c7c6c1', scrub: '#9db97e', wood: '#7aa968', wetland: '#9cc3ae',
  sand: '#ebdcb0', rock: '#bdb7ab', ice: '#eef4f7', plaza: '#ddd8ce', water: '#7db0d6',
};
const AREA_ORDER = ['farmland', 'grass', 'pitch', 'cemetery', 'parking', 'scrub', 'wood', 'wetland', 'sand', 'rock', 'ice', 'plaza', 'water'];

const BUILDING_COLORS = {
  house: '#e9d9c0', detached: '#e9d9c0', residential: '#e4d3b8', apartments: '#d9c6ad', terrace: '#e2cdb0',
  commercial: '#b9c4d0', office: '#aebccb', retail: '#c9bfd3', supermarket: '#c9bfd3',
  industrial: '#bdb6a8', warehouse: '#c4bdae', church: '#d6c7e6', cathedral: '#d6c7e6',
  school: '#e6c8a8', university: '#e6c8a8', hospital: '#f0d0d0', garage: '#cfcac0', shed: '#cfcac0',
};
const DEFAULT_BUILDING = '#ddd3c4';

export const POI_COLORS = {
  tourism: '#e2703a', historic: '#9a6bd2', amenity: '#3b8fe0', shop: '#e2bd3a', leisure: '#36b874', natural: '#8b6b4b',
};

const treeGeo = new THREE.IcosahedronGeometry(1, 1);
const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1, 5).translate(0, 0.5, 0);
const poiGeo = new THREE.OctahedronGeometry(2.4);
const treeMat = new THREE.MeshLambertMaterial({ flatShading: true });
const trunkMat = new THREE.MeshLambertMaterial({ color: '#7a5c42' });
const poiMat = new THREE.MeshLambertMaterial({ emissive: '#222222' });
const buildingMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

function inside(pt, ring) { // pt=[x,z], ring=[[x,z],...]
  let c = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, za] = ring[a], [xb, zb] = ring[b];
    if ((za > pt[1]) !== (zb > pt[1]) && pt[0] < ((xb - xa) * (pt[1] - za)) / (zb - za) + xa) c = !c;
  }
  return c;
}
function insidePoly(pt, rings) {
  if (!inside(pt, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (inside(pt, rings[k])) return false;
  return true;
}
function bbox(ring) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return { x0, z0, x1, z1 };
}
function ringArea(ring) {
  let a = 0;
  for (let k = 0, n = ring.length; k < n; k++) {
    const [x1, z1] = ring[k], [x2, z2] = ring[(k + 1) % n];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a / 2);
}
function stripClose(ring) {
  const r = ring.slice();
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  return r;
}
function jitter(hex, seed, amt = 0.06) {
  const c = new THREE.Color(hex);
  const r = rng(seed);
  const d = (r() - 0.5) * 2 * amt;
  c.offsetHSL(0, 0, d);
  return c;
}

export function buildChunk(key, b, fabric, opts = {}) {
  const latc = (b.s + b.n) / 2, lonc = (b.w + b.e) / 2;
  const L = (lat, lon) => { const o = offsetMeters(latc, lonc, lat, lon); return [o.x, o.z]; };
  const inChunk = (lat, lon) => lat >= b.s && lat < b.n && lon >= b.w && lon < b.e;
  const half = { x: L(latc, b.e)[0], z: L(b.s, lonc)[1] }; // positive extents
  const group = new THREE.Group();
  group.name = 'chunk:' + key;
  const features = new Map(); // ref -> {lat, lon, ground, top, kind, name}
  const disposables = [];

  // ---------- ground texture (land cover + roads raster) ----------
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEX;
  const g = canvas.getContext('2d');
  const px = (lat, lon) => [((lon - b.w) / (b.e - b.w)) * TEX, ((b.n - lat) / (b.n - b.s)) * TEX];
  const mPerPx = (half.z * 2) / TEX;
  g.fillStyle = '#d3d8c6';
  g.fillRect(0, 0, TEX, TEX);
  const tracePoly = (rings) => {
    g.beginPath();
    for (const ring of rings) ring.forEach(([la, lo], k) => { const [x, y] = px(la, lo); k ? g.lineTo(x, y) : g.moveTo(x, y); });
  };
  const sortedAreas = fabric.areas.slice().sort((a, c) => AREA_ORDER.indexOf(a.cls) - AREA_ORDER.indexOf(c.cls));
  for (const a of sortedAreas) {
    g.fillStyle = AREA_COLORS[a.cls] || AREA_COLORS.grass;
    tracePoly(a.rings);
    g.fill('evenodd');
  }
  g.lineCap = 'round'; g.lineJoin = 'round';
  const strokeLine = (pts) => { g.beginPath(); pts.forEach(([la, lo], k) => { const [x, y] = px(la, lo); k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); };
  const lineOrder = { river: 0, path: 1, road: 2, rail: 3 };
  const lines = fabric.lines.slice().sort((a, c) => lineOrder[a.cls] - lineOrder[c.cls] || a.width - c.width);
  for (const ln of lines) {
    const w = Math.max(1, ln.width / mPerPx);
    if (ln.cls === 'road') { g.strokeStyle = '#a9a396'; g.lineWidth = w + 2; strokeLine(ln.pts); }
  }
  for (const ln of lines) {
    const w = Math.max(1, ln.width / mPerPx);
    g.lineWidth = w;
    g.setLineDash(ln.cls === 'rail' ? [6, 4] : []);
    g.strokeStyle = ln.cls === 'road' ? '#f3f0e8' : ln.cls === 'path' ? '#e9dbbc' : ln.cls === 'rail' ? '#7f7a74' : AREA_COLORS.water;
    strokeLine(ln.pts);
  }
  g.setLineDash([]);
  // building footprints (shadow-ish) on the ground
  g.fillStyle = 'rgba(90,85,75,0.35)';
  for (const bd of fabric.buildings) { tracePoly(bd.rings); g.fill('evenodd'); }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = opts.anisotropy || 4;
  disposables.push(tex);

  // ---------- terrain mesh ----------
  const pos = new Float32Array((GRID + 1) ** 2 * 3);
  const uv = new Float32Array((GRID + 1) ** 2 * 2);
  let fallbackH = heightOr(latc, lonc, 0);
  for (let r = 0; r <= GRID; r++) {
    for (let c = 0; c <= GRID; c++) {
      const lat = b.s + ((b.n - b.s) * r) / GRID;
      const lon = b.w + ((b.e - b.w) * c) / GRID;
      const [x, z] = L(lat, lon);
      const k = r * (GRID + 1) + c;
      pos[k * 3] = x; pos[k * 3 + 1] = heightOr(lat, lon, fallbackH); pos[k * 3 + 2] = z;
      uv[k * 2] = c / GRID; uv[k * 2 + 1] = r / GRID;
    }
  }
  const idx = [];
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
    const a = r * (GRID + 1) + c, bb = a + 1, cc = a + GRID + 1, d = cc + 1;
    idx.push(a, bb, cc, bb, d, cc);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  tg.setIndex(idx);
  tg.computeVertexNormals();
  const tm = new THREE.MeshLambertMaterial({ map: tex });
  const terrain = new THREE.Mesh(tg, tm);
  terrain.name = 'terrain';
  group.add(terrain);
  disposables.push(tg, tm);

  // ---------- buildings ----------
  const bPos = [], bCol = [];
  const footprints = []; // for POI-on-roof placement: {ring, bb, top}
  for (const bd of fabric.buildings) {
    const outerLL = stripClose(bd.rings[0]);
    if (outerLL.length < 3) continue;
    let cla = 0, clo = 0;
    for (const [la, lo] of outerLL) { cla += la; clo += lo; }
    cla /= outerLL.length; clo /= outerLL.length;
    if (!inChunk(cla, clo)) continue; // owned by the neighbouring chunk
    const rings = bd.rings.map((r) => stripClose(r).map(([la, lo]) => L(la, lo))).filter((r) => r.length >= 3);
    let ground = Infinity;
    for (const [la, lo] of outerLL) ground = Math.min(ground, heightOr(la, lo, fallbackH));
    const top = ground + bd.height;
    const wallC = jitter(BUILDING_COLORS[bd.kind] || DEFAULT_BUILDING, hashStr(bd.ref));
    const roofC = wallC.clone().offsetHSL(0, -0.05, 0.08);
    const bottom = ground - 2;
    for (const ring of rings) {
      for (let k = 0; k < ring.length; k++) {
        const [x1, z1] = ring[k], [x2, z2] = ring[(k + 1) % ring.length];
        bPos.push(x1, bottom, z1, x2, bottom, z2, x2, top, z2, x1, bottom, z1, x2, top, z2, x1, top, z1);
        for (let v = 0; v < 6; v++) bCol.push(wallC.r * (v === 2 || v >= 4 ? 1 : 0.82), wallC.g * (v === 2 || v >= 4 ? 1 : 0.82), wallC.b * (v === 2 || v >= 4 ? 1 : 0.82));
      }
    }
    const contour = rings[0].map(([x, z]) => new THREE.Vector2(x, z));
    const holes = rings.slice(1).map((r) => r.map(([x, z]) => new THREE.Vector2(x, z)));
    const all = contour.concat(...holes);
    let tris = [];
    try { tris = THREE.ShapeUtils.triangulateShape(contour, holes); } catch { /* skip roof */ }
    for (const t of tris) for (const vi of t) { bPos.push(all[vi].x, top, all[vi].y); bCol.push(roofC.r, roofC.g, roofC.b); }

    footprints.push({ ring: rings[0], bb: bbox(rings[0]), top, ref: bd.ref });
    if (!features.has(bd.ref)) features.set(bd.ref, { lat: cla, lon: clo, ground, top, kind: 'building', name: bd.name });
  }
  if (bPos.length) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
    bg.setAttribute('color', new THREE.Float32BufferAttribute(bCol, 3));
    bg.computeVertexNormals();
    const bm = new THREE.Mesh(bg, buildingMat);
    bm.name = 'buildings';
    group.add(bm);
    disposables.push(bg);
  }

  // ---------- trees: real ones + procedural scatter inside woodland ----------
  const trees = []; // {x, z, ground, r, seed}
  for (const t of fabric.trees) {
    if (!inChunk(t.lat, t.lon)) continue;
    const [x, z] = L(t.lat, t.lon);
    const r = 2.2 + rng(t.ref)() * 1.8;
    trees.push({ x, z, ground: heightOr(t.lat, t.lon, fallbackH), r, seed: t.ref });
    features.set(t.ref, { lat: t.lat, lon: t.lon, ground: heightOr(t.lat, t.lon, fallbackH), top: null, kind: 'tree', name: null });
  }
  const DENSITY = { wood: 110, scrub: 260, grass: 2500 }; // m² per blob
  const MAX_TREES = 7000;
  for (const a of fabric.areas) {
    const dens = DENSITY[a.cls];
    if (!dens || trees.length >= MAX_TREES) continue;
    const rings = a.rings.map((r) => r.map(([la, lo]) => L(la, lo)));
    const bb0 = bbox(rings[0]);
    const bb = { x0: Math.max(bb0.x0, -half.x), x1: Math.min(bb0.x1, half.x), z0: Math.max(bb0.z0, -half.z), z1: Math.min(bb0.z1, half.z) };
    if (bb.x1 <= bb.x0 || bb.z1 <= bb.z0) continue;
    const approx = Math.min((bb.x1 - bb.x0) * (bb.z1 - bb.z0), ringArea(rings[0]));
    const n = Math.min(MAX_TREES - trees.length, Math.round(approx / dens));
    const rand = rng(a.ref + key);
    for (let k = 0, tries = 0; k < n && tries < n * 4; tries++) {
      const x = bb.x0 + rand() * (bb.x1 - bb.x0), z = bb.z0 + rand() * (bb.z1 - bb.z0);
      if (!insidePoly([x, z], rings)) continue;
      const lat = latc - z / 111319.49, lon = lonc + x / (111319.49 * Math.cos((latc * Math.PI) / 180));
      const r = a.cls === 'scrub' ? 0.9 + rand() * 0.9 : 2 + rand() * 2.4;
      trees.push({ x, z, ground: heightOr(lat, lon, fallbackH), r, seed: tries });
      k++;
    }
  }
  if (trees.length) {
    const blobs = new THREE.InstancedMesh(treeGeo, treeMat, trees.length);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    trees.forEach((t, k) => {
      const trunkH = t.r * 1.1;
      s.set(t.r, t.r * 1.2, t.r); p.set(t.x, t.ground + trunkH + t.r * 0.8, t.z);
      blobs.setMatrixAt(k, m.compose(p, q, s));
      col.setHSL(0.27 + ((k * 0.618) % 1) * 0.06, 0.38, 0.32 + ((k * 0.382) % 1) * 0.1);
      blobs.setColorAt(k, col);
      s.set(Math.max(1, t.r * 0.6), trunkH + t.r * 0.5, Math.max(1, t.r * 0.6)); p.set(t.x, t.ground - 0.3, t.z);
      trunks.setMatrixAt(k, m.compose(p, q, s));
    });
    blobs.name = 'trees'; trunks.name = 'trunks';
    group.add(blobs, trunks);
  }

  // ---------- points of interest (discoverable) ----------
  const pois = [];
  const seen = new Set();
  for (const p of fabric.pois) {
    if (seen.has(p.ref) || !inChunk(p.lat, p.lon)) continue;
    seen.add(p.ref);
    const [x, z] = L(p.lat, p.lon);
    let base = heightOr(p.lat, p.lon, fallbackH);
    for (const f of footprints) {
      if (x < f.bb.x0 || x > f.bb.x1 || z < f.bb.z0 || z > f.bb.z1) continue;
      if (f.ref === p.ref || inside([x, z], f.ring)) { base = Math.max(base, f.top); break; }
    }
    pois.push({ ...p, x, z, y: base + 5, chunk: key, index: pois.length });
    features.set(p.ref, { ...(features.get(p.ref) || {}), lat: p.lat, lon: p.lon, ground: heightOr(p.lat, p.lon, fallbackH), top: base, kind: p.kind, name: p.name });
  }
  let poiMesh = null;
  const poiIndex = new Map();
  if (pois.length) {
    poiMesh = new THREE.InstancedMesh(poiGeo, poiMat, pois.length);
    const m = new THREE.Matrix4();
    pois.forEach((p, k) => {
      m.makeTranslation(p.x, p.y, p.z);
      poiMesh.setMatrixAt(k, m);
      poiMesh.setColorAt(k, new THREE.Color(POI_COLORS[p.kind.split(':')[0]] || '#888'));
      poiIndex.set(p.ref, k);
    });
    poiMesh.name = 'pois';
    group.add(poiMesh);
  }

  return {
    key, bounds: b, latc, lonc, group, features, pois,
    snapshot: fabric.snapshot,
    // dim a discovered marker (grade: 'echo' stays semi-bright, others go grey)
    markPoi(ref, grade) {
      const k = poiIndex.get(ref);
      if (k === undefined || !poiMesh) return;
      const base = new THREE.Color(POI_COLORS[pois[k].kind.split(':')[0]] || '#888');
      const c = grade === 'echo' ? base.lerp(new THREE.Color('#ffffff'), 0.55) : base.lerp(new THREE.Color('#555555'), 0.75);
      poiMesh.setColorAt(k, c);
      poiMesh.instanceColor.needsUpdate = true;
    },
    dispose() {
      group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      disposables.forEach((d) => d.dispose());
    },
  };
}
