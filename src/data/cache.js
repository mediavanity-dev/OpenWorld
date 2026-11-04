// Transient cache for global reference data (OSM chunks). This is NOT game state:
// it expires, can be wiped at any time, and the game must work without it.
// Only the player profile (src/game/profile.js) is durable.

const DB_NAME = 'openworld-refcache';
const STORE = 'chunks';
const TTL_MS = 7 * 24 * 3600 * 1000;

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

export async function cacheGet(key) {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result;
        resolve(v && Date.now() - v.t < TTL_MS ? v.data : null);
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
