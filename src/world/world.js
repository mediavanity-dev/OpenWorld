// The moving 3D window: keeps the chunks around the character loaded (nearest
// first, built in a worker), merges background detail, drops distant chunks,
// and re-bases the floating origin so render coordinates stay small.

import { LocalFrame, chunkIndex, chunkKey, haversine } from '../geo.js';
import { makeChunk } from './builder.js';
import { lookupRef } from '../data/osm.js';
import { seasonAt } from '../data/calendar.js';

const REBASE_M = 1500;
const MAX_BUILDS = 2;

export class World {
  constructor(scene, { anisotropy = 4, quality } = {}) {
    this.scene = scene;
    this.frame = new LocalFrame();
    this.hasOrigin = false;
    this.chunks = new Map(); // key -> { i, j, state, chunk }
    this.listeners = new Set();
    this.anisotropy = anisotropy;
    this.quality = quality || { tex: 1024, maxTrees: 4000, ring: 1, detail: true };
    this.remote = new Map(); // ref -> {lat, lon} | null (gone) | 'loading'
    this.center = null;

    this.worker = new Worker(new URL('./chunkWorker.js', import.meta.url), { type: 'module' });
    this.calls = new Map();
    this.seq = 0;
    this.worker.onmessage = (e) => {
      const c = this.calls.get(e.data.id);
      if (!c) return;
      this.calls.delete(e.data.id);
      e.data.ok ? c.resolve(e.data.payload) : c.reject(new Error(e.data.error));
    };
    this.queue = [];
    this.building = 0;
  }

  call(msg) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.calls.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id });
    });
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }

  setQuality(q) { this.quality = { ...this.quality, ...q }; }

  // Called when the character's true (WGS84) position changes. Returns true if the origin was re-based.
  update(lat, lon) {
    let rebased = false;
    if (!this.hasOrigin || haversine(lat, lon, this.frame.lat0, this.frame.lon0) > REBASE_M) {
      this.frame.set(lat, lon);
      this.hasOrigin = true;
      for (const c of this.chunks.values()) if (c.chunk) this.place(c.chunk);
      rebased = true;
    }
    const { i, j } = chunkIndex(lat, lon);
    const centerKey = chunkKey(i, j);
    const R = this.quality.ring;
    const wanted = [];
    for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) wanted.push({ i: i + di, j: j + dj, d: Math.max(Math.abs(di), Math.abs(dj)) });
    for (const w of wanted) {
      const key = chunkKey(w.i, w.j);
      if (!this.chunks.has(key)) this.chunks.set(key, { i: w.i, j: w.j, state: 'queued', chunk: null });
    }
    // nearest first
    this.queue = [...this.chunks.entries()].filter(([, c]) => c.state === 'queued')
      .sort(([, a], [, b]) => Math.max(Math.abs(a.i - i), Math.abs(a.j - j)) - Math.max(Math.abs(b.i - i), Math.abs(b.j - j)))
      .map(([k]) => k);
    this.pump();
    for (const [key, c] of this.chunks) {
      if (Math.abs(c.i - i) > R + 1 || Math.abs(c.j - j) > R + 1) this.unload(key);
    }
    if (centerKey !== this.center) {
      this.center = centerKey;
      for (const c of this.chunks.values()) c.chunk?.setLOD(c.i === i && c.j === j);
    }
    return rebased;
  }

  pump() {
    while (this.building < MAX_BUILDS && this.queue.length) {
      const key = this.queue.shift();
      const entry = this.chunks.get(key);
      if (!entry || entry.state !== 'queued') continue;
      this.build(key, entry);
    }
  }

  async build(key, entry) {
    entry.state = 'loading';
    this.building++;
    this.emit({ type: 'status' });
    try {
      const season = seasonAt(this.frame.lat0);
      const payload = await this.call({ type: 'build', x: entry.i, y: entry.j, opts: { tex: this.quality.tex, maxTrees: this.quality.maxTrees, season } });
      if (this.chunks.get(key) !== entry) { payload.texture?.close?.(); return; }
      const chunk = makeChunk(payload, { anisotropy: this.anisotropy });
      entry.chunk = chunk;
      entry.state = 'ready';
      this.place(chunk);
      chunk.setLOD(key === this.center);
      this.scene.add(chunk.group);
      this.emit({ type: 'chunk', chunk });
      if (this.quality.detail) this.loadDetail(key, entry, season);
      this.runSources(key, entry);
    } catch (err) {
      console.warn('chunk failed', key, err);
      entry.state = 'error';
      setTimeout(() => { if (this.chunks.get(key) === entry) { entry.state = 'queued'; this.queue.push(key); this.pump(); } }, 15000);
    } finally {
      this.building--;
      this.emit({ type: 'status' });
      this.pump();
    }
  }

  // Extra place sources (e.g. geocaches): async (chunk) => [places]. Loaded after the area appears.
  addSource(fn) { (this.sources ||= []).push(fn); }
  runSources(key, entry) {
    for (const fn of this.sources || []) {
      Promise.resolve(fn(entry.chunk)).then((list) => {
        if (!list?.length || this.chunks.get(key) !== entry || !entry.chunk) return;
        if (entry.chunk.addPlaces(list)) this.emit({ type: 'detail', chunk: entry.chunk });
      }).catch(() => {});
    }
  }
  refreshSources() { for (const [key, entry] of this.chunks) if (entry.chunk) this.runSources(key, entry); }

  async loadDetail(key, entry, season) {
    try {
      const d = await this.call({ type: 'detail', x: entry.i, y: entry.j });
      if (this.chunks.get(key) !== entry || !entry.chunk) return;
      entry.chunk.applyDetail(d, season);
      this.emit({ type: 'detail', chunk: entry.chunk });
    } catch (err) {
      console.warn('detail failed (world still playable)', key, err.message);
    }
  }

  place(chunk) {
    const o = this.frame.toLocal(chunk.latc, chunk.lonc);
    chunk.group.position.set(o.x, 0, o.z);
  }

  unload(key) {
    const c = this.chunks.get(key);
    if (!c) return;
    if (c.chunk) { this.scene.remove(c.chunk.group); c.chunk.dispose(); }
    this.chunks.delete(key);
    this.emit({ type: 'unload', key });
  }

  status() {
    let ready = 0, loading = 0, error = 0, detail = 0;
    for (const c of this.chunks.values()) {
      if (c.state === 'ready') { ready++; if (c.chunk.detail) detail++; } else if (c.state === 'error') error++; else loading++;
    }
    return { ready, loading, error, detail };
  }

  readyChunks() { const out = []; for (const c of this.chunks.values()) if (c.chunk) out.push(c.chunk); return out; }
  chunkAt(lat, lon) { const { i, j } = chunkIndex(lat, lon); return this.chunks.get(chunkKey(i, j))?.chunk || null; }
  isReadyAt(lat, lon) { return !!this.chunkAt(lat, lon); }
  groundAt(lat, lon) { return this.chunkAt(lat, lon)?.heightAt(lat, lon) ?? null; }
  habitatAt(lat, lon) { return this.chunkAt(lat, lon)?.habitatAt(lat, lon) ?? null; }

  findFeature(ref) {
    for (const ch of this.readyChunks()) { const f = ch.features.get(ref); if (f) return f; }
    const r = this.remote.get(ref);
    return r && r !== 'loading' ? r : null;
  }
  // Known to be deleted from the map?
  isGone(ref) { return this.remote.get(ref) === null; }

  // Ask OSM where a feature (e.g. a building) is now; emits 'remote' when known.
  requestFeature(ref) {
    if (this.remote.has(ref)) return;
    const retry = this.retryAt?.get(ref);
    if (retry && Date.now() < retry) return; // back off after a failed lookup
    this.remote.set(ref, 'loading');
    lookupRef(ref).then((v) => {
      if (v === undefined) { // network trouble: try again in a few minutes, not on every refresh
        this.remote.delete(ref);
        (this.retryAt ||= new Map()).set(ref, Date.now() + 3 * 60 * 1000);
        return;
      }
      this.remote.set(ref, v ? { lat: v.lat, lon: v.lon, ground: null, kind: 'building', name: v.name } : null);
      this.emit({ type: 'remote', ref });
    });
  }

  // Places in chunks that come within `radius` metres of a point (default: all loaded).
  *pois(lat, lon, radius) {
    const pad = radius ? radius / 111320 : 0;
    const padLon = radius ? pad / Math.max(0.1, Math.cos((lat * Math.PI) / 180)) : 0;
    for (const ch of this.readyChunks()) {
      if (radius) {
        const b = ch.bounds;
        if (lat < b.s - pad || lat > b.n + pad || lon < b.w - padLon || lon > b.e + padLon) continue;
      }
      for (const p of ch.pois) yield { poi: p, chunk: ch };
    }
  }
  toLocal(lat, lon) { return this.frame.toLocal(lat, lon); }
  toGeo(x, z) { return this.frame.toGeo(x, z); }
}
