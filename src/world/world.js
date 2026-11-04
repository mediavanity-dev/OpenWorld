// The moving 3D window: keeps the chunks around the character loaded, drops
// distant ones, and re-bases the floating origin so render coords stay small.

import { LocalFrame, chunkIndex, chunkKey, chunkBounds, haversine } from '../geo.js';
import { ensureTerrain, heightAt } from '../data/terrain.js';
import { loadFabric } from '../data/osm.js';
import { buildChunk } from './builder.js';

const LOAD_RING = 1;   // 3x3 chunks (~3.3 km window)
const DROP_RING = 2;   // keep a margin before unloading
const REBASE_M = 1500;

export class World {
  constructor(scene, { anisotropy } = {}) {
    this.scene = scene;
    this.frame = new LocalFrame();
    this.hasOrigin = false;
    this.chunks = new Map(); // key -> { i, j, state, chunk, error }
    this.listeners = new Set();
    this.anisotropy = anisotropy;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }

  // Called whenever the character's true (WGS84) position changes.
  // Returns true if the origin was re-based (callers must re-place local objects).
  update(lat, lon) {
    let rebased = false;
    if (!this.hasOrigin || haversine(lat, lon, this.frame.lat0, this.frame.lon0) > REBASE_M) {
      this.frame.set(lat, lon);
      this.hasOrigin = true;
      for (const c of this.chunks.values()) if (c.chunk) this.place(c.chunk);
      rebased = true;
    }
    const { i, j } = chunkIndex(lat, lon);
    const wanted = [];
    for (let di = -LOAD_RING; di <= LOAD_RING; di++)
      for (let dj = -LOAD_RING; dj <= LOAD_RING; dj++) wanted.push({ i: i + di, j: j + dj, d: Math.abs(di) + Math.abs(dj) });
    wanted.sort((a, b) => a.d - b.d);
    for (const w of wanted) {
      const key = chunkKey(w.i, w.j);
      if (!this.chunks.has(key)) this.load(w.i, w.j, key);
    }
    for (const [key, c] of this.chunks) {
      if (Math.abs(c.i - i) > DROP_RING || Math.abs(c.j - j) > DROP_RING) this.unload(key);
    }
    return rebased;
  }

  place(chunk) {
    const o = this.frame.toLocal(chunk.latc, chunk.lonc);
    chunk.group.position.set(o.x, 0, o.z);
  }

  async load(i, j, key) {
    const entry = { i, j, state: 'loading', chunk: null };
    this.chunks.set(key, entry);
    this.emit({ type: 'status' });
    const b = chunkBounds(i, j);
    try {
      const [fabric] = await Promise.all([loadFabric(key, b), ensureTerrain(b)]);
      if (this.chunks.get(key) !== entry) return; // dropped while loading
      const chunk = buildChunk(key, b, fabric, { anisotropy: this.anisotropy });
      entry.chunk = chunk;
      entry.state = 'ready';
      this.place(chunk);
      this.scene.add(chunk.group);
      this.emit({ type: 'chunk', chunk });
    } catch (err) {
      console.error('chunk failed', key, err);
      entry.state = 'error';
      entry.error = String(err.message || err);
      // allow a retry after a while
      setTimeout(() => { if (this.chunks.get(key) === entry) this.chunks.delete(key); }, 20000);
    }
    this.emit({ type: 'status' });
  }

  unload(key) {
    const c = this.chunks.get(key);
    if (!c) return;
    if (c.chunk) { this.scene.remove(c.chunk.group); c.chunk.dispose(); }
    this.chunks.delete(key);
    this.emit({ type: 'unload', key });
  }

  status() {
    let ready = 0, loading = 0, error = 0;
    for (const c of this.chunks.values()) c.state === 'ready' ? ready++ : c.state === 'loading' ? loading++ : error++;
    return { ready, loading, error };
  }

  readyChunks() { return [...this.chunks.values()].filter((c) => c.chunk).map((c) => c.chunk); }

  isReadyAt(lat, lon) {
    const { i, j } = chunkIndex(lat, lon);
    return this.chunks.get(chunkKey(i, j))?.state === 'ready';
  }

  findFeature(ref) {
    for (const ch of this.readyChunks()) { const f = ch.features.get(ref); if (f) return f; }
    return null;
  }

  groundAt(lat, lon) { return heightAt(lat, lon); }

  *pois() { for (const ch of this.readyChunks()) for (const p of ch.pois) yield { poi: p, chunk: ch }; }

  toLocal(lat, lon) { return this.frame.toLocal(lat, lon); }
  toGeo(x, z) { return this.frame.toGeo(x, z); }
}
