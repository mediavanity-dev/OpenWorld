// @ts-check
// Field journal: explored ground, daily totals, personal records, rock collection,
// survey areas and one gentle daily field assignment. Everything lives in the
// profile (small, on-device). Roam never counts as real exploration.

import { geohash, hashStr } from '../geo.js';
import { GRADE_RANK } from './profile.js';
import { groupOf } from '../world/icons.js';

const MODE_RANK = { roam: 1, home: 2, present: 3 };

// Daily assignments lean towards nature, history and the quirky, not businesses.
export const TASKS = {
  landmark: { text: 'Discover a landmark or green space', target: 1, unit: '', place: true },
  monument: { text: 'Find a monument, memorial or historic spot', target: 1, unit: '', place: true },
  green: { text: 'Visit a park, garden or nature spot', target: 1, unit: '', place: true },
  quirk: { text: 'Find something quirky: a sculpture, fountain, clock or sundial', target: 1, unit: '', place: true },
  bird: { text: 'Spot a bird', target: 1, unit: '' },
  plant: { text: 'Spot a plant', target: 1, unit: '' },
  night: { text: 'Discover a landmark after dark', target: 1, unit: '', place: true },
  walk1k: { text: 'Walk 1 km', target: 1000, unit: 'm' },
};
// businesses never count towards assignments
const BUSINESS = new Set(['food', 'shop', 'lodging', 'other']);
const QUIRK_VALUES = /^(artwork|sculpture|statue|fountain|clock|sundial|obelisk|folly|lighthouse|windmill|watermill|tower|well|milestone|boundary_stone|wayside_cross|wayside_shrine|tree|bust|stone|cannon)$/;
const QUIRK_NAMES = /sundial|clock|statue|fountain|obelisk|folly|sculpture|\bwell\b|standing stone|stone circle|gnome|\bbench\b/i;
// Does this place satisfy a place-type assignment? (used to point the way)
export function taskMatches(type, poi) {
  const grp = groupOf(poi.kind, poi.cls);
  switch (type) {
    case 'landmark': case 'night': return !BUSINESS.has(grp) && grp !== 'geocache';
    case 'monument': return grp === 'history';
    case 'green': return grp === 'park' || grp === 'nature';
    case 'quirk': return isQuirk(poi);
    default: return false;
  }
}
export function isQuirk(poi) {
  const value = (poi.kind || '').split(':')[1] || '';
  return QUIRK_VALUES.test(value) || QUIRK_NAMES.test(poi.name || '');
}

export class Journal {
  constructor(profile, env, onEvent) {
    this.profile = profile;
    this.env = env;
    this.onEvent = onEvent || (() => {});
    this.ensure();
  }

  get d() { return this.profile.data; }

  ensure() {
    const d = this.d;
    d.cells ||= {};      // geohash7 (~150 m) -> best mode rank (1 roam, 2 home, 3 present)
    d.rocks ||= {};      // key -> { name, lith, period, top, bottom, grade, first }
    d.records ||= {};    // highest, longestDay, oldestPlace, rarestSpecies, north, south, firstClaim
    d.days ||= {};       // 'YYYY-MM-DD' -> { m, finds, species }
    d.areas ||= {};      // chunk key -> { name, total, lat, lon }
    d.task ||= null;     // { date, type, progress, done }
    d.tasksDone ||= 0;
    d.photos ||= 0;
  }

  dayKey() { return this.env.localNow().toISOString().slice(0, 10); }
  today() {
    const k = this.dayKey();
    if (!this.d.days[k]) {
      this.d.days[k] = { m: 0, finds: 0, species: 0 };
      const keys = Object.keys(this.d.days).sort();
      while (keys.length > 400) delete this.d.days[keys.shift()];
    }
    return this.d.days[k];
  }

  task() {
    const date = this.dayKey();
    if (!this.d.task || this.d.task.date !== date || !TASKS[this.d.task.type]) {
      const types = Object.keys(TASKS);
      const type = types[hashStr(this.d.id + date) % types.length];
      this.d.task = { date, type, progress: 0, done: false };
      this.profile.save();
    }
    return this.d.task;
  }

  progress(type, amount = 1) {
    const t = this.task();
    if (t.type !== type || t.done) return;
    t.progress = Math.min(TASKS[type].target, t.progress + amount);
    if (t.progress >= TASKS[type].target) {
      t.done = true;
      this.d.tasksDone++;
      this.profile.log(`Field assignment complete: ${TASKS[type].text}`);
      this.onEvent({ type: 'task', msg: `Field assignment complete: ${TASKS[type].text}` });
    }
    this.profile.save();
  }

  // ---- hooks called by the game ----
  onMove(mode, meters, pos, ground) {
    const cell = geohash(pos.lat, pos.lon, 7);
    const rank = MODE_RANK[mode];
    if ((this.d.cells[cell] || 0) < rank) { this.d.cells[cell] = rank; this.profile.save(); }
    if (mode === 'roam') return;
    const day = this.today();
    if (meters > 0) {
      day.m += meters;
      const r = this.d.records;
      if (!r.longestDay || day.m > r.longestDay.m) r.longestDay = { m: Math.round(day.m), date: this.dayKey() };
      this.progress('walk1k', meters);
    }
    if (ground != null && mode === 'present') {
      const r = this.d.records;
      if (!r.highest || ground > r.highest.m) r.highest = { m: Math.round(ground), lat: +pos.lat.toFixed(5), lon: +pos.lon.toFixed(5), date: this.dayKey() };
    }
  }

  onDiscovery(poi, grade, snap, result) {
    if (grade === 'echo' || (result !== 'new' && result !== 'upgraded')) return;
    const r = this.d.records;
    this.today().finds++;
    const grp = groupOf(poi.kind, poi.cls);
    if (!BUSINESS.has(grp)) {
      this.progress('landmark');
      if (snap && (snap.sun === 'night' || snap.sun === 'twilight')) this.progress('night');
    }
    if (grp === 'history') this.progress('monument');
    if (grp === 'park' || grp === 'nature') this.progress('green');
    if (isQuirk(poi)) this.progress('quirk');
    if (!r.firstClaim) r.firstClaim = { name: poi.name, date: this.dayKey() };
    const year = parseInt(poi.tags?.start_date, 10);
    if (year > 0 && year <= new Date().getFullYear() && (!r.oldestPlace || year < r.oldestPlace.year)) r.oldestPlace = { name: poi.name, year };
    if (!r.north || poi.lat > r.north.lat) r.north = { name: poi.name, lat: +poi.lat.toFixed(4) };
    if (!r.south || poi.lat < r.south.lat) r.south = { name: poi.name, lat: +poi.lat.toFixed(4) };
    this.profile.save();
  }

  onSpecies(sp, grade, result, how) {
    if (how === 'photo') this.d.photos++;
    if (grade === 'echo') { this.profile.save(); return; }
    this.today().species++;
    if (sp.group === 'Aves') this.progress('bird');
    if (sp.group === 'Plantae') this.progress('plant');
    const r = this.d.records;
    if (result !== 'revisit' && (!r.rarestSpecies || sp.count < r.rarestSpecies.count)) r.rarestSpecies = { name: sp.name, sci: sp.sci, count: sp.count };
    this.profile.save();
  }

  // returns 'new' | 'upgraded' | null
  onRock(rock, grade) {
    const have = this.d.rocks[rock.key];
    if (have && GRADE_RANK[have.grade] >= GRADE_RANK[grade]) return null;
    this.d.rocks[rock.key] = { name: rock.name, lith: rock.lith, period: rock.period, top: rock.top, bottom: rock.bottom, grade, first: have?.first || this.dayKey() };
    this.profile.save();
    return have ? 'upgraded' : 'new';
  }

  onGeocache() { this.today().caches = (this.today().caches || 0) + 1; this.profile.save(); }

  onTreasure() { this.today().treasure = (this.today().treasure || 0) + 1; this.profile.save(); }

  onArea(chunk) {
    const a = this.d.areas[chunk.key];
    const total = chunk.pois.length;
    if (!a || a.total < total || (!a.name && chunk.areaName)) {
      this.d.areas[chunk.key] = { name: chunk.areaName || a?.name || null, total: Math.max(total, a?.total || 0), lat: +chunk.latc.toFixed(4), lon: +chunk.lonc.toFixed(4) };
      this.profile.save();
    }
  }
}
