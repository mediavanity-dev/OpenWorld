// Main-thread side of a chunk: turns the worker's buffers into three.js objects,
// and owns the chunk's queries (height, habitat, places) and late detail merging.

import * as THREE from 'three';
import { lonToTileX, latToTileY, CHUNK_Z, offsetMeters, rng } from '../geo.js';
import { HABITATS } from './habitats.js';
import { terrainMaterial, treeMat, trunkMat, buildingMat, poiMat, treeGeoHi, treeGeoLo, coneGeo, trunkGeo, poiGeo, gridIndex } from './materials.js';
import { treeInstance, treeType, packTrees } from './trees.js';
import { parseHours } from '../data/hours.js';

export const POI_COLORS = {
  tourism: '#e2703a', historic: '#9a6bd2', amenity: '#3b8fe0', shop: '#e2bd3a', leisure: '#36b874', natural: '#8b6b4b', transport: '#2bb3b1',
};
const kindColor = (kind) => new THREE.Color(POI_COLORS[kind.split(':')[0]] || '#888888');

function instanced(geo, mat, packed, matKey = 'mat', withColor = true) {
  const m = new THREE.InstancedMesh(geo, mat, packed.n);
  m.instanceMatrix = new THREE.InstancedBufferAttribute(packed[matKey], 16);
  if (withColor) m.instanceColor = new THREE.InstancedBufferAttribute(packed.col, 3);
  m.computeBoundingSphere();
  return m;
}

export function makeChunk(p, { anisotropy = 4 } = {}) {
  const group = new THREE.Group();
  group.name = 'chunk:' + p.key;
  const disposables = [];
  const riseMeshes = []; // buildings + trees rise out of the ground when the chunk appears

  // terrain
  const tex = new THREE.Texture(p.texture);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(p.terrain.pos, 3));
  tg.setAttribute('uv', new THREE.BufferAttribute(p.terrain.uv, 2));
  tg.setIndex(gridIndex(p.gridN));
  tg.computeVertexNormals();
  const tm = terrainMaterial(tex);
  const terrain = new THREE.Mesh(tg, tm);
  terrain.name = 'terrain';
  group.add(terrain);
  disposables.push(tg, tm, tex);

  // buildings
  if (p.buildings) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(p.buildings.pos, 3));
    bg.setAttribute('normal', new THREE.BufferAttribute(p.buildings.nrm, 3));
    bg.setAttribute('color', new THREE.BufferAttribute(p.buildings.col, 3));
    bg.computeBoundingSphere();
    const bm = new THREE.Mesh(bg, buildingMat);
    bm.name = 'buildings';
    riseMeshes.push(bm);
    group.add(bm);
    disposables.push(bg);
  }

  // trees
  const blobMeshes = [];
  const addTrees = (packed, cone) => {
    if (!packed) return;
    const crown = instanced(cone ? coneGeo : treeGeoLo, treeMat, packed);
    const trunks = instanced(trunkGeo, trunkMat, packed, 'trunk', false);
    if (!cone) blobMeshes.push(crown);
    riseMeshes.push(crown, trunks);
    group.add(crown, trunks);
    disposables.push(crown, trunks);
  };
  addTrees(p.trees, false);
  addTrees(p.cones, true);

  // places
  const features = new Map();
  let pois = p.pois.map((x, i) => ({ ...x, chunk: p.key, index: i, tags: null, hours: null }));
  let poiMesh = null;
  const poiIndex = new Map();
  const poiState = new Map(); // ref -> { grade, closed }
  function rebuildPois() {
    if (poiMesh) { group.remove(poiMesh); poiMesh.dispose(); poiMesh = null; }
    poiIndex.clear();
    features.clear();
    for (const q of pois) features.set(q.ref, { lat: q.lat, lon: q.lon, ground: q.ground, top: q.y - 5, kind: q.kind, name: q.name });
    if (!pois.length) return;
    poiMesh = new THREE.InstancedMesh(poiGeo, poiMat, pois.length);
    const m = new THREE.Matrix4();
    pois.forEach((q, k) => {
      q.index = k;
      m.makeTranslation(q.x, q.y, q.z);
      poiMesh.setMatrixAt(k, m);
      poiMesh.setColorAt(k, colorFor(q));
      poiIndex.set(q.ref, k);
    });
    poiMesh.computeBoundingSphere();
    poiMesh.name = 'pois';
    group.add(poiMesh);
  }
  function colorFor(q) {
    const st = poiState.get(q.ref) || {};
    const c = kindColor(q.kind);
    if (st.grade === 'echo') c.lerp(new THREE.Color('#ffffff'), 0.55);
    else if (st.grade) c.lerp(new THREE.Color('#555555'), 0.75);
    if (st.closed) c.lerp(new THREE.Color('#2a2a2a'), 0.6);
    return c;
  }
  function recolor(ref) {
    const k = poiIndex.get(ref);
    if (k === undefined || !poiMesh) return;
    poiMesh.setColorAt(k, colorFor(pois[k]));
    poiMesh.instanceColor.needsUpdate = true;
  }
  rebuildPois();

  const W = p.gridN + 1;
  const chunk = {
    key: p.key, x: p.x, y: p.y, bounds: p.bounds, latc: p.latc, lonc: p.lonc, group, features, areaName: p.areaName || null,
    streets: p.streets || [], // [{ name, lines: [Float32Array x,z,...] }] in chunk-local metres
    get pois() { return pois; },
    snapshot: null, detail: false,
    contains(lat, lon) { return lat <= p.bounds.n && lat > p.bounds.s && lon >= p.bounds.w && lon < p.bounds.e; },
    heightAt(lat, lon) {
      const fx = (lonToTileX(lon, CHUNK_Z) - p.x) * p.gridN, fy = (latToTileY(lat, CHUNK_Z) - p.y) * p.gridN;
      if (fx < -0.01 || fy < -0.01 || fx > p.gridN + 0.01 || fy > p.gridN + 0.01) return null;
      const gx = Math.min(p.gridN - 1e-6, Math.max(0, fx)), gy = Math.min(p.gridN - 1e-6, Math.max(0, fy));
      const c0 = Math.floor(gx), r0 = Math.floor(gy), ax = gx - c0, ay = gy - r0, g = p.grid;
      return (g[r0 * W + c0] * (1 - ax) + g[r0 * W + c0 + 1] * ax) * (1 - ay) + (g[(r0 + 1) * W + c0] * (1 - ax) + g[(r0 + 1) * W + c0 + 1] * ax) * ay;
    },
    habitatAt(lat, lon) {
      const n = p.habitatN;
      const c = Math.floor((lonToTileX(lon, CHUNK_Z) - p.x) * n), r = Math.floor((latToTileY(lat, CHUNK_Z) - p.y) * n);
      if (c < 0 || r < 0 || c >= n || r >= n) return null;
      return HABITATS[p.habitat[r * n + c]];
    },
    // t: 0 (just loaded) .. 1 (settled)
    reveal(t) {
      const k = 1 - t * t * (3 - 2 * t); // smoothstep, inverted
      for (const m of riseMeshes) m.position.y = -k * (m.name === 'buildings' ? 28 : 14);
      const fading = t < 1;
      if (tm.transparent !== fading) { tm.transparent = fading; tm.needsUpdate = true; }
      tm.opacity = fading ? Math.max(0.05, t) : 1;
    },
    setLOD(near) { for (const m of blobMeshes) m.geometry = near ? treeGeoHi : treeGeoLo; },
    markPoi(ref, grade) { poiState.set(ref, { ...(poiState.get(ref) || {}), grade }); recolor(ref); },
    setClosed(ref, closed) {
      const st = poiState.get(ref) || {};
      if (!!st.closed === !!closed) return;
      poiState.set(ref, { ...st, closed }); recolor(ref);
    },

    // Merge the Overpass detail layer: real trees, extra tags, extra landmarks.
    applyDetail(d, season) {
      chunk.detail = true;
      chunk.snapshot = d.snapshot || null;
      const L = (lat, lon) => offsetMeters(p.latc, p.lonc, lat, lon);
      const list = { blob: [], cone: [] };
      for (const t of d.trees) {
        if (!chunk.contains(t.lat, t.lon)) continue;
        const o = L(t.lat, t.lon);
        const rand = rng(t.ref);
        const inst = treeInstance(o.x, chunk.heightAt(t.lat, t.lon) ?? 0, o.z, 2.2 + rand() * 1.8, treeType(t.leaf, t.cycle), season, rand);
        (inst.cone ? list.cone : list.blob).push(inst);
        features.set(t.ref, { lat: t.lat, lon: t.lon, ground: inst.ground, top: null, kind: 'tree', name: null });
      }
      addTrees(packTrees(list.blob), false);
      addTrees(packTrees(list.cone), true);

      const known = new Set(pois.map((q) => q.ref));
      for (const q of pois) {
        const info = d.places[q.ref];
        if (info) { q.tags = info.tags; q.hours = parseHours(info.tags.opening_hours); }
      }
      for (const [ref, info] of Object.entries(d.places)) {
        if (known.has(ref) || !info.kind || !chunk.contains(info.lat, info.lon)) continue;
        if (!(info.tags.heritage || info.tags.wikidata || info.tags.wikipedia || /^(tourism|historic|natural:tree)/.test(info.kind))) continue;
        const o = L(info.lat, info.lon);
        const ground = chunk.heightAt(info.lat, info.lon) ?? 0;
        pois.push({ ref, lat: info.lat, lon: info.lon, x: o.x, z: o.z, y: ground + 5, ground, name: info.name, kind: info.kind, rank: 50, chunk: p.key, tags: info.tags, hours: parseHours(info.tags.opening_hours) });
      }
      rebuildPois();
    },

    dispose() {
      if (poiMesh) poiMesh.dispose();
      disposables.forEach((d) => d.dispose());
      p.texture.close?.();
    },
  };
  return chunk;
}
