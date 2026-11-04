// Game rules. Knows nothing about rendering: state is WGS84 positions,
// the profile, and the reference fabric exposed by World.

import { haversine, offsetGeo, offsetMeters } from '../geo.js';
import { makeAnchor } from './anchors.js';
import { GRADE_RANK } from './profile.js';
import { trustOf } from './locator.js';

const DEV = new URLSearchParams(location.search).has('dev');

export const RULES = {
  LEASH_M: 600,             // home-base free movement radius
  DISCOVER_M: 30,           // how close to a point of interest counts as "visited"
  HOME_COOLDOWN_DAYS: 30,   // a home base is (near) permanent
  BEACON_FEATURE_M: 40,     // beacons latch onto a building within this distance
  WALK: 6, RUN: 20, ROAM_FAST: 90,  // m/s (game-time, not real walking)
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
  constructor(world, profile, onEvent) {
    this.world = world;
    this.profile = profile;
    this.onEvent = onEvent || (() => {});
    this.mode = null;
    this.pos = null;       // { lat, lon }
    this.fix = null;       // latest device fix
    this.nearby = new Set();
    this.nearest = null;   // nearest undiscovered POI {poi, dist, bearing}
    this._discT = 0;
    this._saveT = 0;
  }

  emit(type, msg, extra) { this.onEvent({ type, msg, ...extra }); }

  setFix(fix) {
    this.fix = fix;
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

  // move: { east, north } unit-ish vector in metres-direction, run: bool
  tick(dt, move) {
    if (!this.mode || !this.pos) return;
    const before = this.pos;
    if (this.mode === 'present') {
      if (this.fix) {
        const d = haversine(this.pos.lat, this.pos.lon, this.fix.lat, this.fix.lon);
        const k = d > 300 ? 1 : 1 - Math.exp(-dt * 2.5);
        this.pos = { lat: this.pos.lat + (this.fix.lat - this.pos.lat) * k, lon: this.pos.lon + (this.fix.lon - this.pos.lon) * k };
      }
    } else if (move && (move.east || move.north)) {
      const speed = move.run ? (this.mode === 'roam' ? RULES.ROAM_FAST : RULES.RUN) : RULES.WALK;
      let next = offsetGeo(this.pos.lat, this.pos.lon, move.east * speed * dt, move.north * speed * dt);
      if (this.mode === 'home') next = this.leash(next);
      this.pos = next;
    }
    const moved = haversine(before.lat, before.lon, this.pos.lat, this.pos.lon);
    if (moved < 500) this.profile.data.stats.meters[this.mode] += moved;

    this._discT += dt;
    if (this._discT > 0.4) { this._discT = 0; this.checkDiscoveries(); }
    this._saveT += dt;
    if (this._saveT > 5) { this._saveT = 0; this.persistLast(); }
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

  checkDiscoveries() {
    const grade = MODES[this.mode].grade;
    let nearest = null;
    const stillNear = new Set();
    for (const { poi, chunk } of this.world.pois()) {
      const d = haversine(this.pos.lat, this.pos.lon, poi.lat, poi.lon);
      const known = this.profile.data.discoveries[poi.ref];
      if (d <= RULES.DISCOVER_M) {
        stillNear.add(poi.ref);
        if (this.nearby.has(poi.ref)) continue; // already handled this visit
        const anchor = makeAnchor(this.world, { lat: poi.lat, lon: poi.lon, featureRef: poi.ref, snapshot: chunk.snapshot });
        const res = this.profile.recordDiscovery(poi, grade, this.trust(), anchor);
        const best = this.profile.data.discoveries[poi.ref].grade;
        chunk.markPoi(poi.ref, best);
        if (res === 'new') {
          this.profile.log(`Discovered ${poi.name} [${grade}]`);
          this.emit('discover', `${grade === 'echo' ? 'Echo of' : 'Discovered'} ${poi.name}`, { grade });
        } else if (res === 'upgraded') {
          this.profile.log(`${poi.name} upgraded to ${grade}`);
          this.emit('discover', `${poi.name}: now ${grade.toUpperCase()}`, { grade });
        }
      } else if (!known || GRADE_RANK[known.grade] < GRADE_RANK[grade]) {
        if (!nearest || d < nearest.dist) nearest = { poi, dist: d };
      }
    }
    for (const r of this.nearby) if (!stillNear.has(r)) this.nearby.delete(r);
    for (const r of stillNear) this.nearby.add(r);
    if (nearest) {
      const o = offsetMeters(this.pos.lat, this.pos.lon, nearest.poi.lat, nearest.poi.lon);
      nearest.bearing = (Math.atan2(o.x, -o.z) * 180) / Math.PI; // 0 = north, clockwise
    }
    this.nearest = nearest;
  }

  placeBeacon(label) {
    if (!MODES[this.mode]?.beacons) return this.emit('error', 'Beacons can only be placed where you really are (Present or Home).');
    let best = null;
    for (const ch of this.world.readyChunks()) {
      for (const [ref, f] of ch.features) {
        if (f.kind !== 'building') continue;
        const d = haversine(this.pos.lat, this.pos.lon, f.lat, f.lon);
        if (d < RULES.BEACON_FEATURE_M && (!best || d < best.d)) best = { ref, d, snapshot: ch.snapshot };
      }
    }
    const anchor = makeAnchor(this.world, {
      lat: this.pos.lat, lon: this.pos.lon, featureRef: best?.ref || null,
      snapshot: best?.snapshot || this.world.readyChunks()[0]?.snapshot || null,
    });
    const b = this.profile.addBeacon(label || `Beacon ${this.profile.data.beacons.length + 1}`, this.mode, anchor);
    this.profile.log(`Placed ${b.label} (${anchor.mode}${anchor.feature_ref ? ' → ' + anchor.feature_ref : ''})`);
    this.emit('beacon', `${b.label} placed, anchored to ${anchor.feature_ref ? 'a building' : 'the ground'}`);
    return b;
  }

  persistLast() {
    if (!this.pos || !this.mode) return;
    this.profile.data.last = { lat: +this.pos.lat.toFixed(6), lon: +this.pos.lon.toFixed(6), mode: this.mode };
    this.profile.save();
  }
}
