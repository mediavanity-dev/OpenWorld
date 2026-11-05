// @ts-check
// The character profile: the ONLY durable game state. Small (KBs), lives on the
// device, exportable as JSON. Everything in it is keyed by real-world anchors,
// never by render coordinates or dataset-internal indices.
//
// Saving: changes are written shortly after they happen (debounced), and immediately when
// the page is hidden or closed, so a find right before closing the tab is never lost.
// The last position changes every few seconds, so it lives under its own small key
// instead of rewriting the whole profile each time.

import { storeKey, stableKey } from '../channel.js';
import { storage } from '../storage.js';

const KEY = storeKey('profile.v1');
const LAST_KEY = storeKey('profile.last');
export const STABLE_PROFILE_KEY = stableKey('profile.v1');

export const GRADE_RANK = { echo: 1, home: 2, present: 3 };

// ---------------------------------------------------------------- versions
// The save format version. To change the format: bump this, and add a step to MIGRATIONS
// that upgrades a profile from the previous version. Old saves and exported backups are
// upgraded step by step when loaded or imported; they are never thrown away.
export const PROFILE_VERSION = 1;
/** @type {Record<number, (d: any) => any>} from version N to N+1 */
export const MIGRATIONS = {
  // 1: (d) => ({ ...d, v: 2, newField: d.oldField ?? null }),
};

/**
 * Upgrade a stored or imported profile to the current version.
 * @param {any} d
 * @param {{ version?: number, steps?: Record<number, (d: any) => any> }} [opts] (for tests)
 */
export function migrate(d, { version = PROFILE_VERSION, steps = MIGRATIONS } = {}) {
  if (!d || typeof d !== 'object' || typeof d.discoveries !== 'object') throw new Error('Not an OpenWorld profile');
  const v0 = d.v ?? 1;
  if (!Number.isInteger(v0) || v0 < 1) throw new Error('Not an OpenWorld profile');
  if (v0 > version) throw new Error('This profile was saved by a newer version of OpenWorld. Update the app, then try again.');
  let out = d;
  for (let v = v0; v < version; v++) {
    if (!steps[v]) throw new Error(`No upgrade from profile version ${v}`);
    out = steps[v](out);
  }
  return { ...fresh(), ...out, v: version };
}

function fresh() {
  return {
    v: PROFILE_VERSION,
    id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),
    created: new Date().toISOString(),
    home: null,          // { lat, lon, source, accuracy, setAt }
    last: null,          // { lat, lon, mode }
    discoveries: {},     // feature_ref -> { name, kind, grade, trust, anchor, first, last, visits, conditions, seen[] }
    species: {},         // iNaturalist taxon id -> { name, sci, group, grade, anchor, first, conditions }
    beacons: [],         // { id, label, mode, anchor }
    stats: { meters: { present: 0, home: 0, roam: 0 } },
    log: [],             // [{ t, msg }]
  };
}

export class Profile {
  /** @param {{ key?: string, lastKey?: string }} [opts] */
  constructor({ key = KEY, lastKey = LAST_KEY } = {}) {
    this.key = key;
    this.lastKey = lastKey;
    /** @type {any} */
    this.data = fresh();
    this.loadError = null;
    const stored = storage.getJson(key);
    if (stored) {
      try { this.data = migrate(stored); } catch (err) {
        // keep the unreadable save untouched (never overwrite it) and play with a fresh profile
        this.loadError = err;
        this.key = `${key}.recovered-${Date.now()}`;
      }
    }
    const last = storage.getJson(lastKey);
    if (last && typeof last.lat === 'number') this.data.last = last;
    this._t = null;
    this.dirty = false;
    if (typeof addEventListener === 'function') {
      const flush = () => this.flush();
      addEventListener('pagehide', flush);
      addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    }
  }

  save() {
    this.dirty = true;
    clearTimeout(this._t);
    this._t = setTimeout(() => this.flush(), 300);
  }

  /** Write now (if anything changed). Returns false if storage refused it. */
  flush() {
    clearTimeout(this._t);
    this._t = null;
    if (!this.dirty) return true;
    const ok = storage.setJson(this.key, this.data);
    if (ok) this.dirty = false;
    return ok;
  }

  /** The last position: small and frequent, so it has its own key. */
  saveLast(last) {
    this.data.last = last;
    storage.setJson(this.lastKey, last);
  }

  log(msg) {
    this.data.log.unshift({ t: new Date().toISOString(), msg });
    this.data.log.length = Math.min(this.data.log.length, 200);
    this.save();
  }

  // Returns { result: 'new' | 'upgraded' | 'revisit', newTags: [...] }
  recordDiscovery(poi, grade, trust, anchor, conditions = null, tags = []) {
    const d = this.data.discoveries[poi.ref];
    const now = new Date().toISOString();
    if (!d) {
      this.data.discoveries[poi.ref] = { name: poi.name, kind: poi.kind, grade, trust, anchor, first: now, last: now, visits: 1, conditions, seen: tags };
      this.save();
      return { result: 'new', newTags: [] };
    }
    d.last = now;
    d.visits++;
    d.seen = d.seen || [];
    const newTags = tags.filter((t) => !d.seen.includes(t));
    d.seen.push(...newTags);
    let result = 'revisit';
    if (GRADE_RANK[grade] > GRADE_RANK[d.grade]) {
      d.grade = grade; d.trust = trust; d.anchor = anchor; d.conditions = conditions; result = 'upgraded';
    }
    this.save();
    return { result, newTags };
  }

  // Returns 'new' | 'upgraded' | 'revisit'
  recordSpecies(sp, grade, anchor, conditions) {
    this.data.species = this.data.species || {};
    const d = this.data.species[sp.id];
    if (!d) {
      this.data.species[sp.id] = { name: sp.name, sci: sp.sci, group: sp.group, grade, anchor, conditions, first: new Date().toISOString(), sightings: 1 };
      this.save();
      return 'new';
    }
    d.sightings = (d.sightings || 1) + 1;
    if (GRADE_RANK[grade] > GRADE_RANK[d.grade]) { d.grade = grade; d.anchor = anchor; d.conditions = conditions; this.save(); return 'upgraded'; }
    this.save();
    return 'revisit';
  }

  addBeacon(label, mode, anchor) {
    const b = { id: 'b' + Date.now().toString(36), label, mode, anchor };
    this.data.beacons.push(b);
    this.save();
    return b;
  }

  counts() {
    const c = { present: 0, home: 0, echo: 0, species: Object.keys(this.data.species || {}).length };
    for (const d of Object.values(this.data.discoveries)) c[/** @type {any} */ (d).grade]++;
    return c;
  }

  export() { return JSON.stringify(this.data, null, 2); }
  import(json) {
    this.data = migrate(JSON.parse(json));
    this.dirty = true;
    this.flush();
    if (this.data.last) this.saveLast(this.data.last);
  }
  reset() { this.data = fresh(); this.dirty = true; this.flush(); storage.remove(this.lastKey); }
}
