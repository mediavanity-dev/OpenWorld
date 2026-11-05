// @ts-check
// One way to talk to the outside world. Every request gets a timeout (a stalled server must
// never hang a feature or hold a request slot forever), optional retries with jittered
// backoff (so many clients don't retry in lockstep), and a per-service health note that the
// interface can show ("Wildlife unavailable right now") instead of silently showing nothing.
// Works on the main thread and in workers (each keeps its own health notes).

const DEFAULT_TIMEOUT = 15000;

/** Which free service a URL belongs to, in words a player understands. */
/** @type {[RegExp, string][]} */
const SERVICES = [
  [/openfreemap\.org/, 'map'],
  [/elevation-tiles-prod/, 'terrain'],
  [/overpass/, 'place details'],
  [/open-meteo\.com/, 'weather'],
  [/inaturalist\.org/, 'wildlife'],
  [/wikipedia\.org|wikidata\.org/, 'Wikipedia'],
  [/commons\.wikimedia\.org/, 'old photos'],
  [/macrostrat\.org/, 'geology'],
  [/usgs\.gov/, 'earthquakes'],
  [/nominatim\.openstreetmap\.org/, 'place search'],
  [/date\.nager\.at/, 'holidays'],
  [/geojs\.io/, 'internet location'],
  [/okapi|opencach/, 'geocaches'],
];
export function serviceOf(url) {
  for (const [re, name] of SERVICES) if (re.test(url)) return name;
  return 'other';
}

/** @type {Map<string, { ok: boolean, at: number, failures: number }>} */
const health = new Map();
/** @type {Set<(service: string, state: { ok: boolean, at: number, failures: number }) => void>} */
const listeners = new Set();
function note(service, ok) {
  const prev = health.get(service);
  const state = { ok, at: Date.now(), failures: ok ? 0 : (prev?.failures || 0) + 1 };
  health.set(service, state);
  if (!prev || prev.ok !== ok) for (const fn of listeners) fn(service, state);
}
/** Subscribe to services going down or coming back. Returns an unsubscribe function. */
export function onHealth(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Services whose last request failed (most recent first). */
export function unhealthy() {
  return [...health].filter(([, s]) => !s.ok).sort((a, b) => b[1].at - a[1].at).map(([k]) => k);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Exponential backoff with full jitter: somewhere in [0.5, 1.5] x base x 2^attempt. */
export function backoff(attempt, base = 1000, rand = Math.random) { return base * 2 ** attempt * (0.5 + rand()); }

export class HttpError extends Error {
  /** @param {number} status @param {string} url */
  constructor(status, url) { super(`HTTP ${status}`); this.status = status; this.url = url; }
}

/**
 * fetch with a timeout and optional retries. Resolves to the Response (any status the caller
 * accepts via `okStatus`), or throws after the last attempt.
 * @param {string} url
 * @param {{ init?: RequestInit, timeout?: number, retries?: number, base?: number,
 *           okStatus?: (s: number) => boolean, service?: string, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<Response>}
 */
export async function request(url, opts = {}) {
  const { init, timeout = DEFAULT_TIMEOUT, retries = 0, base = 1000, okStatus = (s) => s >= 200 && s < 300, fetchImpl = fetch } = opts;
  const service = opts.service || serviceOf(url);
  let lastErr;
  for (let a = 0; a <= retries; a++) {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeout) });
      if (okStatus(res.status)) { note(service, true); return res; }
      lastErr = new HttpError(res.status, url);
      // client errors (except "slow down") won't get better by retrying
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastErr = err?.name === 'TimeoutError' ? new Error(`timed out after ${timeout / 1000}s`) : err;
    }
    if (a < retries) await sleep(backoff(a, base));
  }
  note(service, false);
  throw lastErr;
}

/** request() + JSON. Throws on failure. */
export async function getJson(url, opts) { return (await request(url, opts)).json(); }
/** request() + JSON, or null on any failure (for optional extras). */
export async function tryJson(url, opts) { try { return await getJson(url, opts); } catch { return null; } }
