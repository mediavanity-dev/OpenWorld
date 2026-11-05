// Transient cache for global reference data (OSM detail, lookups, wildlife lists,
// holidays). This is NOT game state: it expires, can be wiped at any time, and the
// game must work without it. Works on the main thread and in workers.
// Only the player profile (src/game/profile.js) is durable.

import { tryJson } from './net.js';

const DB_NAME = 'openworld-refcache';
const STORE = 'chunks';
const DEFAULT_TTL = 7 * 24 * 3600 * 1000;

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbPromise;
}

export async function cacheGet(key, ttl = DEFAULT_TTL) {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result;
        resolve(v && Date.now() - v.t < ttl ? v.data : null);
      };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function cachePut(key, data) {
  const d = await db();
  if (!d) return;
  try { d.transaction(STORE, 'readwrite').objectStore(STORE).put({ t: Date.now(), data }, key); } catch { /* best effort */ }
}

// Delete entries older than maxAge (the cache otherwise only skips stale entries on read).
export async function pruneCache(maxAge = 60 * 24 * 3600 * 1000) {
  const d = await db();
  if (!d) return 0;
  return new Promise((resolve) => {
    let n = 0;
    try {
      const req = d.transaction(STORE, 'readwrite').objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(n);
        if (!c.value || Date.now() - c.value.t > maxAge) { c.delete(); n++; }
        c.continue();
      };
      req.onerror = () => resolve(n);
    } catch { resolve(n); }
  });
}

// fetch JSON with a cache in front; returns null on failure
export async function cachedJson(key, url, { ttl = DEFAULT_TTL, init = undefined, timeout = undefined } = {}) {
  const hit = await cacheGet(key, ttl);
  if (hit) return hit;
  const j = await tryJson(url, { init, timeout });
  if (j != null) cachePut(key, j);
  return j;
}
