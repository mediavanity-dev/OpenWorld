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

const DEV = new URLSearchParams(location.search).has('dev');

export const RULES = {
  LEASH_M: 600,             // home-base free movement radius
  DISCOVER_M: 30,           // how close to a place counts as "visited"
  HOME_COOLDOWN_DAYS: 30,   // a home base is (near) permanent
  BEACON_PLACE_M: 25,       // beacons latch onto a named place within this distance...
  BEACON_BUILDING_M: 35,    // ...or else the nearest building
  WALK: 6, RUN: 20, ROAM_FAST: 90,  // m/s (game-time, not real walking)
  ENCOUNTER_EVERY_M: 110,   // roll for wildlife every this many metres moved
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
    this._moved = 0;
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
    if (moved < 500) {
      this.profile.data.stats.meters[this.mode] += moved;
      this._moved += moved;
    }
    if (this._moved > RULES.ENCOUNTER_EVERY_M) { this._moved = 0; this.rollEncounter(); }

    this._discT += dt;
    if (this._discT > 0.4) { this._discT = 0; this.checkDiscoveries(); this.checkCritters(); this.loadWildlife(); }
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
    let nearest = null;
    const stillNear = new Set();
    for (const { poi, chunk } of this.world.pois(this.pos.lat, this.pos.lon, 1500)) {
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
      }
    }
    this.nearby = stillNear;
    if (nearest) {
      const o = offsetMeters(this.pos.lat, this.pos.lon, nearest.poi.lat, nearest.poi.lon);
      nearest.bearing = (Math.atan2(o.x, -o.z) * 180) / Math.PI; // 0 = north, clockwise
    }
    this.nearest = nearest;
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
    // appear 15–35 m away, roughly ahead if we know the heading
    const base = this.heading != null ? (this.heading * Math.PI) / 180 : rand() * Math.PI * 2;
    const ang = base + (rand() - 0.5) * 1.6, dist = 15 + rand() * 20;
    const at = offsetGeo(this.pos.lat, this.pos.lon, Math.sin(ang) * dist, Math.cos(ang) * dist);
    const c = { id: `c${Date.now()}`, sp, lat: at.lat, lon: at.lon, born: performance.now(), ttl: RULES.CRITTER_TTL_S };
    this.critters.push(c);
    const label = GROUP_STYLE[sp.group]?.label || 'creature';
    this.emit('critter', `Something is moving nearby: ${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}. Go and see!`, { critter: c });
  }

  checkCritters() {
    const now = performance.now();
    const reach = this.mode === 'present' ? Math.min(20, Math.max(8, (this.fix?.accuracy || 10) * 0.6)) : 8;
    for (const c of [...this.critters]) {
      if ((now - c.born) / 1000 > c.ttl) { this.critters = this.critters.filter((x) => x !== c); this.emit('critter-gone', null, { critter: c }); continue; }
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
    const res = this.profile.recordSpecies(c.sp, grade, anchor, how === 'photo' ? { ...snap, photo: true } : snap);
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

