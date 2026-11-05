// @ts-check
// Durable key-value storage for the profile, settings and small per-device flags.
// The rest of the code only ever calls get/set/remove here, never localStorage directly,
// so the app-store build can swap the backend for native storage (e.g. Capacitor
// Preferences or SQLite, which the OS won't clear under storage pressure) in one place:
//
//   import { useBackend } from './storage.js';
//   await nativeBackend.hydrate();   // read everything into memory before the game starts
//   useBackend(nativeBackend);       // { read(key) -> string | null, write(key, value), remove(key) }
//
// Reads are synchronous on purpose: the game loads its profile once at start-up.

/** @typedef {{ read(key: string): string | null, write(key: string, value: string): void, remove(key: string): void }} Backend */

/** @type {Backend} */
const browserBackend = {
  read: (key) => localStorage.getItem(key),
  write: (key, value) => localStorage.setItem(key, value),
  remove: (key) => localStorage.removeItem(key),
};
const memory = new Map();
/** @type {Backend} in-memory only: storage blocked (private mode) or tests */
export const memoryBackend = {
  read: (key) => (memory.has(key) ? memory.get(key) : null),
  write: (key, value) => { memory.set(key, value); },
  remove: (key) => { memory.delete(key); },
};

function detect() {
  try {
    const k = '__openworld_probe__';
    localStorage.setItem(k, '1'); localStorage.removeItem(k);
    return browserBackend;
  } catch { return memoryBackend; }
}

/** @type {Backend | null} */
let backend = null;
const be = () => (backend ||= detect());
/** @param {Backend} b */
export function useBackend(b) { backend = b; }
/** True when progress can't outlive this tab (storage blocked). */
export function isVolatile() { return be() === memoryBackend; }

/** @type {Set<(err: unknown, key: string) => void>} */
const errorListeners = new Set();
/** Called when a write fails (usually: storage full). Returns an unsubscribe function. */
export function onStorageError(fn) { errorListeners.add(fn); return () => errorListeners.delete(fn); }

export const storage = {
  /** @param {string} key @returns {string | null} */
  get(key) { try { return be().read(key); } catch { return null; } },
  /** @param {string} key @param {string} value @returns {boolean} false if it couldn't be saved */
  set(key, value) {
    try { be().write(key, value); return true; } catch (err) { for (const fn of errorListeners) fn(err, key); return false; }
  },
  /** @param {string} key */
  remove(key) { try { be().remove(key); } catch { /* ignore */ } },
  /** Parsed JSON, or `fallback` when missing or unreadable. */
  getJson(key, fallback = null) {
    const raw = this.get(key);
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  },
  setJson(key, value) { return this.set(key, JSON.stringify(value)); },
};
