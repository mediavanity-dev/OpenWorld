// Game rules. Knows nothing about rendering: state is WGS84 positions,
// the profile, the live environment, and the reference fabric exposed by World.

import { haversine, offsetGeo, offsetMeters, geohash } from '../geo.js';
import { makeAnchor } from './anchors.js';
import { GRADE_RANK } from './profile.js';
import { trustOf } from './locator.js';
import { isOpen, nextOpening } from '../data/hours.js';
import { nearestBuilding } from '../data/osm.js';
import { speciesNear, fitsHabitat, GROUP_STYLE } from '../data/wildlife.js';
import { wildHabitat } from '../world/habitats.js';
import { rockAt, ageText } from '../data/science.js';
import { startHunt, stepHunt } from './hunt.js';
import { treasuresFor, bandOf, PER_AREA } from './treasure.js';
import { TASKS, taskMatches } from './journal.js';

const DEV = new URLSearchParams(location.search).has('dev');

export const RULES = {
  LEASH_M: 600,             // home-base free movement radius
  DISCOVER_M: 30,           // how close to a place counts as "visited"
  HOME_COOLDOWN_DAYS: 30,   // a home base is (near) permanent
  BEACON_PLACE_M: 25,       // beacons latch onto a named place within this distance...
  BEACON_BUILDING_M: 35,    // ...or else the nearest building
  WALK: 6, RUN: 20, ROAM_FAST: 90,  // m/s (game-time, not real walking)
  ENCOUNTER_EVERY_M: 110,   // roll for wildlife every this many metres moved (at walking/running speed only)
  ENCOUNTER_MAX_SPEED: 12,  // m/s: faster travel (Roam fast-travel, vehicles) doesn't meet wildlife
  CRITTER_TTL_S: 120,
};

export const MODES = {
  present: {
    label: 'Present',
    desc: 'You are where your device physically is. You move by moving in real life. Discoveries are CLAIMED.',
    canMove: false, grade: 'present', beacons: true,
  },
  home: {
    label: 'Home base',
    desc: `Free movement within ${RULES.LEASH_M} m of your home base. Discoveries count as HOME.`,
    canMove: true, grade: 'home', beacons: true,
  },
  roam: {
    label: 'Roam',
    desc: 'Project yourself anywhere on Earth. Discoveries are only ECHOES until you visit for real; you cannot place beacons.',
    canMove: true, grade: 'echo', beacons: false,
  },
};

export class Game {
  constructor(world, profile, environment, onEvent) {
    this.world = world;
    this.profile = profile;
    this.env = environment;
    this.onEvent = onEvent || (() => {});
    this.mode = null;
    this.pos = null;       // { lat, lon }
    this.fix = null;       // latest accepted device fix
    this.target = null;    // smoothed target for Present mode
    this.heading = null;   // compass / GPS course, degrees from north
    this.nearby = new Set();
    this.closedNotified = new Set();
    this.nearest = null;   // nearest undiscovered open place {poi, dist, bearing}
    this.critters = [];    // [{ id, sp, lat, lon, born, ttl }]
    this.wild = { cell: null, species: [], loading: false };
    this.dataSaver = false;
    this.journal = null;   // set by the app (src/game/journal.js)
    this.features = {};    // beta-only experiments: { hunt, treasure }
    this.hunt = null;      // active hunt (src/game/hunt.js)
    this.treasureHint = null; // nearest uncollected daily treasure { t, d, band }
    this._treasureMemo = new Map();
    this._roamNoted = new Set();
    this._spd = 0;         // smoothed ground speed (m/s) for Home/Roam
    this._moved = 0;
    this._walk = 0;
    this._rockCell = null;
    this._discT = 0;
    this._saveT = 0;
  }

  emit(type, msg, extra) { this.onEvent({ type, msg, ...extra }); }

  // GPS jitter filter: ignore tiny wobbles inside the accuracy circle, and
  // don't let a much worse fix replace a recent good one.
  setFix(fix) {
    const prev = this.fix;
    if (prev && prev.source === 'device' && fix.source === 'device') {
      const recent = fix.t - prev.t < 20000;
      if (recent && fix.accuracy > Math.max(60, prev.accuracy * 3)) return;
      const d = haversine(prev.lat, prev.lon, fix.lat, fix.lon);
      if (d < Math.max(3, Math.min(fix.accuracy, 25) * 0.5)) { this.fix = { ...prev, t: fix.t, accuracy: fix.accuracy, heading: fix.heading, speed: fix.speed }; return; }
    }
    // real ground speed from consecutive fixes (GPS's own speed when it reports one)
    if (prev && fix.t > prev.t) {
      const d = haversine(prev.lat, prev.lon, fix.lat, fix.lon);
      this.fixSpeed = fix.speed != null && fix.speed >= 0 ? fix.speed : d / ((fix.t - prev.t) / 1000);
    }
    this.fix = fix;
    if (fix.heading != null && fix.speed > 0.8) this.gpsCourse = fix.heading;
    if (this.mode === 'present' && !this.pos) this.pos = { lat: fix.lat, lon: fix.lon };
  }

  enter(mode, opts = {}) {
    const home = this.profile.data.home;
    if (mode === 'present') {
      if (!this.fix) return this.emit('error', 'Present mode needs a location fix first.');
      this.pos = { lat: this.fix.lat, lon: this.fix.lon };
    } else if (mode === 'home') {
      if (!home) return this.emit('error', 'No home base yet. Go Present and set one.');
      this.pos = { lat: home.lat, lon: home.lon };
    } else if (mode === 'roam') {
      const t = opts.to || this.pos;
      if (!t) return this.emit('error', 'Roam needs a destination.');
      this.pos = { lat: t.lat, lon: t.lon };
    }
    const prev = this.mode;
    this.mode = mode;
    this.nearby.clear();
    this.critters = [];
    if (prev !== mode) this.profile.log(`Entered ${MODES[mode].label} mode`);
    this.emit('mode', MODES[mode].desc, { mode });
    this.persistLast();
    return true;
  }

  setHome() {
    const p = this.profile.data;
    if (this.mode !== 'present' || !this.fix) return this.emit('error', 'A home base can only be set while Present (from a real location fix).');
    if (p.home && !DEV) {
      const days = (Date.now() - Date.parse(p.home.setAt)) / 86400000;
      if (days < RULES.HOME_COOLDOWN_DAYS) {
        return this.emit('error', `Home base is permanent: it can move again in ${Math.ceil(RULES.HOME_COOLDOWN_DAYS - days)} days.`);
      }
    }
    p.home = {
      lat: this.fix.lat, lon: this.fix.lon,
      source: this.fix.source, accuracy: Math.round(this.fix.accuracy), trust: trustOf(this.fix),
      place: this.fix.place || null, setAt: new Date().toISOString(),
    };
    this.profile.log(`Home base set (${p.home.trust}, ±${p.home.accuracy} m)`);
    this.emit('home', 'Home base set. You can now play Home mode from anywhere.');
    return true;
  }

  // move: { east, north, run } in [-1, 1]
  tick(dt, move) {
    if (!this.mode || !this.pos) return false;
    const before = this.pos;
    if (this.mode === 'present') {
      if (this.fix) {
        const d = haversine(this.pos.lat, this.pos.lon, this.fix.lat, this.fix.lon);
        const k = d > 300 ? 1 : 1 - Math.exp(-dt * 2.5);
        if (d > 0.05) this.pos = { lat: this.pos.lat + (this.fix.lat - this.pos.lat) * k, lon: this.pos.lon + (this.fix.lon - this.pos.lon) * k };
      }
    } else if (move && (move.east || move.north)) {
      const speed = move.run ? (this.mode === 'roam' ? RULES.ROAM_FAST : RULES.RUN) : RULES.WALK;
      let next = offsetGeo(this.pos.lat, this.pos.lon, move.east * speed * dt, move.north * speed * dt);
      if (this.mode === 'home') next = this.leash(next);
      this.pos = next;
    }
    const moved = haversine(before.lat, before.lon, this.pos.lat, this.pos.lon);
    if (dt > 0) this._spd += (moved / dt - this._spd) * Math.min(1, dt * 3);
    if (moved < 500) {
      this.profile.data.stats.meters[this.mode] += moved;
      // wildlife and walking records only at human speeds
      // (Present: judged by the GPS's real speed, not the smoothed on-screen glide)
      const speed = this.mode === 'present' ? (this.fixSpeed ?? 0) : dt > 0 ? moved / dt : 0;
      if (speed < RULES.ENCOUNTER_MAX_SPEED) { this._moved += moved; this._walk += moved; }
    }
    if (this._moved > RULES.ENCOUNTER_EVERY_M) { this._moved = 0; this.rollEncounter(); }

    this._discT += dt;
    if (this._discT > 0.4) {
      this._discT = 0;
      this.checkDiscoveries(); this.checkCritters(); this.loadWildlife(); this.checkRock();
      if (this.hunt) this.stepHunt();
      if (this.features.treasure) this.checkTreasure();
      this.journal?.onMove(this.mode, this._walk, this.pos, this.world.groundAt(this.pos.lat, this.pos.lon));
      this._walk = 0;
    }
    this._saveT += dt;
    if (this._saveT > 5) { this._saveT = 0; this.persistLast(); }
    return moved > 0.01;
  }

  leash(next) {
    const h = this.profile.data.home;
    const d = haversine(h.lat, h.lon, next.lat, next.lon);
    if (d <= RULES.LEASH_M) return next;
    const o = offsetMeters(h.lat, h.lon, next.lat, next.lon);
    const k = RULES.LEASH_M / d;
    if (!this._leashWarned) { this._leashWarned = true; this.emit('info', 'Edge of your home range. Go Present or Roam to go further.'); setTimeout(() => (this._leashWarned = false), 8000); }
    return offsetGeo(h.lat, h.lon, o.x * k, -o.z * k);
  }

  trust() {
    if (this.mode === 'present') return trustOf(this.fix);
    if (this.mode === 'home') return this.profile.data.home?.trust || 'none';
    return 'none';
  }

  conditions() {
    const snap = this.env.snapshot(this.pos.lat, this.pos.lon);
    return { snap, tags: this.env.tags(snap) };
  }

  // Opening hours in the place's own local time; null = unknown (always discoverable)
  openState(poi) {
    if (!poi.hours) return null;
    const local = this.env.localNow();
    const open = isOpen(poi.hours, local);
    return { open, next: open ? null : nextOpening(poi.hours, local) };
  }

  checkDiscoveries() {
    const grade = MODES[this.mode].grade;
    let nearest = null, taskNear = null;
    const task = this.journal?.task();
    const wantPlace = task && !task.done && TASKS[task.type]?.place ? task.type : null;
    const stillNear = new Set();
    for (const { poi, chunk } of this.world.pois(this.pos.lat, this.pos.lon, 1500)) {
      if (poi.cls === 'geocache') continue; // geocaches count only when you find the box ("I found it")
      const d = haversine(this.pos.lat, this.pos.lon, poi.lat, poi.lon);
      const st = d < 1500 ? this.openState(poi) : null;
      if (d < 1500) chunk.setClosed(poi.ref, st && !st.open);
      const known = this.profile.data.discoveries[poi.ref];
      if (d <= RULES.DISCOVER_M) {
        stillNear.add(poi.ref);
        if (this.nearby.has(poi.ref)) continue; // already handled this visit
        if (st && !st.open) {
          if (!this.closedNotified.has(poi.ref)) {
            this.closedNotified.add(poi.ref);
            this.emit('info', `${poi.name} is closed right now${st.next ? ` (opens ${st.next})` : ''}. Come back when it's open to discover it.`);
          }
          stillNear.delete(poi.ref);
          continue;
        }
        const { snap, tags } = this.conditions();
        const anchor = makeAnchor(this.world, { lat: poi.lat, lon: poi.lon, featureRef: poi.ref, snapshot: chunk.snapshot });
        const { result, newTags } = this.profile.recordDiscovery(poi, grade, this.trust(), anchor, snap, tags);
        chunk.markPoi(poi.ref, this.profile.data.discoveries[poi.ref].grade);
        this.journal?.onDiscovery(poi, grade, snap, result);
        if (result === 'new') {
          this.profile.log(`Discovered ${poi.name} [${grade}]`);
          this.emit('discover', `${grade === 'echo' ? 'Echo of' : 'Discovered'} ${poi.name}`, { grade, poi });
        } else if (result === 'upgraded') {
          this.profile.log(`${poi.name} upgraded to ${grade}`);
          this.emit('discover', `${poi.name}: now ${grade.toUpperCase()}`, { grade, poi });
        } else if (newTags.length) {
          this.profile.log(`${poi.name} seen: ${newTags.join(', ')}`);
          this.emit('discover', `${poi.name}, seen in new conditions: ${newTags.join(', ')}`, { grade, poi, tags: newTags });
        }
      } else if ((!known || GRADE_RANK[known.grade] < GRADE_RANK[grade]) && !(st && !st.open)) {
        if (!nearest || d < nearest.dist) nearest = { poi, dist: d };
        if (wantPlace && !known && (!taskNear || d < taskNear.dist) && taskMatches(wantPlace, poi)) taskNear = { poi, dist: d };
      }
    }
    this.nearby = stillNear;
    for (const n of [nearest, taskNear]) {
      if (!n) continue;
      const o = offsetMeters(this.pos.lat, this.pos.lon, n.poi.lat, n.poi.lon);
      n.bearing = (Math.atan2(o.x, -o.z) * 180) / Math.PI; // 0 = north, clockwise
    }
    this.nearest = nearest;
    this.taskTarget = taskNear; // nearest place that fits today's field assignment
  }

  // ---------------- geocaches ----------------
  // How close you need to be to say you found it (GPS-aware), and whether that's allowed now.
  cacheReach() { return this.mode === 'present' ? Math.min(60, Math.max(30, (this.fix?.accuracy || 10) * 1.5)) : 30; }
  canLogCache(poi) {
    if (this.mode === 'roam') return { ok: false, why: 'Visit for real to log a find.' };
    const d = haversine(this.pos.lat, this.pos.lon, poi.lat, poi.lon);
    if (!poi.gc?.startOnly && d > this.cacheReach()) return { ok: false, why: `Get within ${Math.round(this.cacheReach())} m of the cache.` };
    return { ok: true, d };
  }
  // Honour system, like geocaching itself: you say you found it, we remember where and when.
  logCache(poi) {
    const can = this.canLogCache(poi);
    if (!can.ok) return this.emit('error', can.why);
    const d = (this.profile.data.geocaches ||= {});
    if (d[poi.gc.code]) return this.emit('info', 'Already in your journal.');
    const grade = MODES[this.mode].grade;
    const { snap } = this.conditions();
    d[poi.gc.code] = { name: poi.name, type: poi.gc.type, size: poi.gc.size, difficulty: poi.gc.difficulty, terrain: poi.gc.terrain, site: poi.gc.site, url: poi.gc.url, grade, conditions: snap, anchor: makeAnchor(this.world, { lat: poi.lat, lon: poi.lon, featureRef: poi.ref }), date: new Date().toISOString() };
    this.profile.log(`Found geocache ${poi.name} (${poi.gc.code})`);
    this.profile.save();
    this.journal?.onGeocache?.(d[poi.gc.code]);
    this.emit('geocache', `Found it: ${poi.name}`, { poi });
  }

  // ---------------- geology under your feet ----------------
  checkRock() {
    if (this.dataSaver || this._rockBusy) return;
    const cell = geohash(this.pos.lat, this.pos.lon, 6);
    if (cell === this._rockCell) return;
    this._rockCell = cell;
    this._rockBusy = true;
    const grade = MODES[this.mode].grade;
    rockAt(this.pos.lat, this.pos.lon).then((rock) => {
      this.current = { ...(this.current || {}), rock };
      if (!rock || !this.journal) return;
      const res = this.journal.onRock(rock, grade);
      if (res === 'new') {
        this.profile.log(`New rock underfoot: ${rock.name}`);
        this.emit('rock', `Under your feet: ${rock.name}${rock.lith ? ` (${rock.lith.split(',')[0]})` : ''}, ${ageText(rock)}`, { rock });
      }
    }).finally(() => { this._rockBusy = false; });
  }

  // ---------------- wildlife ----------------
  loadWildlife() {
    if (this.dataSaver || this.wild.loading) return;
    const cell = geohash(this.pos.lat, this.pos.lon, 5);
    if (cell === this.wild.cell) return;
    this.wild.loading = true;
    speciesNear(this.pos.lat, this.pos.lon).then((r) => {
      this.wild = { cell: r.cell, species: r.species, loading: false };
    }).catch(() => { this.wild.loading = false; this.wild.cell = cell; });
  }

  rollEncounter() {
    if (!this.wild.species.length || this.critters.length >= 2) return;
    if (this.features.hunt && this.hunt) return; // one trail at a time
    const hab = wildHabitat(this.world.habitatAt(this.pos.lat, this.pos.lon));
    const chance = hab === 'urban' ? 0.25 : 0.55;
    const rand = Math.random;
    if (rand() > chance) return;
    const night = this.env.sun(this.pos.lat, this.pos.lon).alt < -6;
    const pool = this.wild.species.filter((s) => fitsHabitat(s.group, hab, night));
    if (!pool.length) return;
    let total = 0;
    const w = pool.map((s) => (total += Math.pow(s.count, 0.6)));
    const pick = rand() * total;
    const sp = pool[w.findIndex((v) => v >= pick)];
    // only animals leave signs and flee; plants and fungi are simply found nearby
    if (this.features.hunt && !['Plantae', 'Fungi'].includes(sp.group)) {
      this.hunt = startHunt(this.pos, sp, this.heading);
      const lbl = GROUP_STYLE[sp.group]?.label || 'creature';
      return this.emit('hunt', `Fresh signs of ${/^[aeiou]/.test(lbl) ? 'an' : 'a'} ${lbl} nearby`, { hunt: this.hunt });
    }
    // appear 15–35 m away, roughly ahead if we know the heading
    const base = this.heading != null ? (this.heading * Math.PI) / 180 : rand() * Math.PI * 2;
    const ang = base + (rand() - 0.5) * 1.6, dist = 15 + rand() * 20;
    const at = offsetGeo(this.pos.lat, this.pos.lon, Math.sin(ang) * dist, Math.cos(ang) * dist);
    const c = { id: `c${Date.now()}`, sp, lat: at.lat, lon: at.lon, born: performance.now(), ttl: RULES.CRITTER_TTL_S };
    this.critters.push(c);
    const label = GROUP_STYLE[sp.group]?.label || 'creature';
    this.emit('critter', `Something is moving nearby: ${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}. Go and see!`, { critter: c });
  }

  stepHunt() {
    const h = this.hunt;
    const speed = this.mode === 'present' ? (this.fixSpeed ?? 0) : this._spd;
    const ev = stepHunt(h, this.pos, speed);
    if (!ev) return;
    const drop = () => { this.critters = this.critters.filter((c) => c.id !== h.id); };
    if (ev === 'cold') { drop(); this.hunt = null; this.emit('hunt-cold', 'The trail went cold'); }
    else if (ev === 'flee') { drop(); this.emit('hunt-flee', 'It heard you coming. Approach gently.'); }
    else if (ev === 'reveal') {
      this.critters.push({ id: h.id, sp: h.sp, lat: h.lat, lon: h.lon, born: performance.now(), ttl: 150, hunted: true });
      this.emit('hunt-reveal', null, { hunt: h });
    } else this.emit(`hunt-${ev}`, null, { hunt: h });
  }

  // ---------------- daily treasure (beta) ----------------
  todaysTreasure(chunk) {
    const date = this.env.localNow().toISOString().slice(0, 10), key = `${date}|${chunk.key}`;
    let t = this._treasureMemo.get(key);
    if (!t) { t = treasuresFor(chunk, date); this._treasureMemo.set(key, t); if (this._treasureMemo.size > 60) this._treasureMemo.delete(this._treasureMemo.keys().next().value); }
    return t;
  }
  treasureState() {
    const date = this.env.localNow().toISOString().slice(0, 10);
    const st = (this.profile.data.treasure ||= { date, found: [], total: 0 });
    if (st.date !== date) { st.date = date; st.found = []; }
    return st;
  }
  checkTreasure() {
    const st = this.treasureState();
    let best = null;
    for (const ch of this.world.readyChunks()) {
      const b = ch.bounds, pad = 0.006;
      if (this.pos.lat < b.s - pad || this.pos.lat > b.n + pad || this.pos.lon < b.w - pad * 1.6 || this.pos.lon > b.e + pad * 1.6) continue;
      for (const t of this.todaysTreasure(ch)) {
        if (st.found.includes(t.id)) continue;
        const d = haversine(this.pos.lat, this.pos.lon, t.lat, t.lon);
        if (!best || d < best.d) best = { t, d };
      }
    }
    const prev = this.treasureHint?.band;
    this.treasureHint = best ? { ...best, band: bandOf(best.d) } : null;
    if (this.treasureHint?.band === 'hot' && prev !== 'hot') this.emit('treasure-hot', null);
    if (!best || best.d > 15) return;
    if (this.mode === 'roam') {
      if (!this._roamNoted.has(best.t.id)) { this._roamNoted.add(best.t.id); this.emit('info', 'A golden find is here. Visit for real to collect it.'); }
      return;
    }
    st.found.push(best.t.id);
    st.total = (st.total || 0) + 1;
    this.profile.save();
    const inArea = st.found.filter((id) => id.split(':')[1] === best.t.id.split(':')[1]).length;
    this.profile.log(`Golden find${best.t.area ? ` in ${best.t.area}` : ''} (${inArea}/${PER_AREA} today)`);
    this.journal?.onTreasure?.();
    this.emit('treasure', `Golden find · ${inArea} of ${PER_AREA}${best.t.area ? ` in ${best.t.area}` : ''} today`, { treasure: best.t });
    this.treasureHint = null;
  }

  checkCritters() {
    const now = performance.now();
    const reach = this.mode === 'present' ? Math.min(20, Math.max(8, (this.fix?.accuracy || 10) * 0.6)) : 8;
    for (const c of [...this.critters]) {
      if ((now - c.born) / 1000 > c.ttl) {
        this.critters = this.critters.filter((x) => x !== c);
        if (c.hunted && this.hunt?.id === c.id) this.hunt = null;
        this.emit('critter-gone', null, { critter: c });
        continue;
      }
      if (haversine(this.pos.lat, this.pos.lon, c.lat, c.lon) > reach) continue;
      this.spot(c);
    }
  }

  // Record a creature as seen (walking up to it, or photographing it in AR).
  spot(c, how = 'spotted') {
    if (!this.critters.includes(c)) return;
    this.critters = this.critters.filter((x) => x !== c);
    const grade = MODES[this.mode].grade;
    const { snap } = this.conditions();
    const anchor = makeAnchor(this.world, { lat: c.lat, lon: c.lon });
    if (c.hunted && this.hunt?.id === c.id) this.hunt = null;
    const cond = { ...snap, ...(how === 'photo' ? { photo: true } : {}), ...(c.hunted ? { tracked: true } : {}) };
    const res = this.profile.recordSpecies(c.sp, grade, anchor, cond);
    this.journal?.onSpecies(c.sp, grade, res, how);
    const what = c.sp.name;
    if (res === 'new') this.profile.log(`${how === 'photo' ? 'Photographed' : 'Spotted'} ${what} [${grade}]`);
    this.emit('spotted', res === 'new' ? `New species: ${what}` : res === 'upgraded' ? `${what}: now ${grade.toUpperCase()}` : `Spotted ${what} again`, { critter: c, result: res, grade });
  }

  // ---------------- beacons ----------------
  placeBeacon(label) {
    if (!MODES[this.mode]?.beacons) return this.emit('error', 'Beacons can only be placed where you really are (Present or Home).');
    const { lat, lon } = this.pos;
    let best = null;
    for (const { poi, chunk } of this.world.pois(lat, lon, RULES.BEACON_PLACE_M)) {
      const d = haversine(lat, lon, poi.lat, poi.lon);
      if (d < RULES.BEACON_PLACE_M && (!best || d < best.d)) best = { ref: poi.ref, d, snapshot: chunk.snapshot, name: poi.name };
    }
    const anchor = makeAnchor(this.world, { lat, lon, featureRef: best?.ref || null, snapshot: best?.snapshot || null });
    const b = this.profile.addBeacon(label || `Beacon ${this.profile.data.beacons.length + 1}`, this.mode, anchor);
    if (best) {
      this.profile.log(`Placed ${b.label} at ${best.name}`);
      this.emit('beacon', `${b.label} placed, anchored to ${best.name}`);
      return b;
    }
    this.emit('beacon', `${b.label} placed. Looking for a building to anchor it to…`);
    // upgrade to a building anchor in the background
    nearestBuilding(lat, lon, RULES.BEACON_BUILDING_M).then((bld) => {
      if (!bld) { this.profile.log(`Placed ${b.label} (ground)`); this.emit('beacon', `${b.label} anchored to the ground`); return; }
      this.world.remote.set(bld.ref, { lat: bld.lat, lon: bld.lon, ground: null, kind: 'building', name: null });
      b.anchor = makeAnchor(this.world, { lat, lon, featureRef: bld.ref, feature: bld });
      this.profile.save();
      this.profile.log(`Placed ${b.label} (building ${bld.ref})`);
      this.emit('beacon', `${b.label} anchored to a building`, { beacon: b });
    });
    return b;
  }

  persistLast() {
    if (!this.pos || !this.mode) return;
    this.profile.data.last = { lat: +this.pos.lat.toFixed(6), lon: +this.pos.lon.toFixed(6), mode: this.mode };
    this.profile.save();
  }
}

