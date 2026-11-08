// @ts-check
// Playtest stats: what actually happens in a session, kept ONLY on this device.
// Nothing here is uploaded; players (or testers) can look at it in Settings and export it
// to share by hand. It answers the tuning questions the game design depends on:
//   - Is there something worth chasing within two minutes of starting?
//   - How long until the first discovery?
//   - How many hunts end in a find, how many flee, how many go cold?
//   - How often do people find the daily treasure once it gets "hot"?

import { storeKey } from '../channel.js';
import { storage } from '../storage.js';

const KEY = storeKey('playtest.v1');
const MAX_SESSIONS = 60;
export const CHASE_GOAL_S = 120; // the design target: something to chase within two minutes

// game events counted per session (anything else is ignored)
const COUNTED = new Set(['discover', 'hunt', 'hunt-reveal', 'hunt-flee', 'hunt-cold', 'hunt-caught', 'spotted', 'critter',
  'treasure-hot', 'treasure', 'task', 'geocache', 'rock', 'beacon', 'rephoto', 'quest-start', 'quest-done', 'quest-wrong', 'quest-abandon']);
// events that mean "there's something to chase right now"
const CHASE = new Set(['hunt', 'critter', 'treasure-hot', 'quest-start']);

/**
 * @typedef {{ start: number, last: number, mode: string | null, modes: Record<string, number>,
 *   firstChaseS: number | null, firstDiscoveryS: number | null, meters: number, counts: Record<string, number> }} Session
 */

export class Metrics {
  /** @param {{ key?: string, now?: () => number }} [opts] */
  constructor({ key = KEY, now = Date.now } = {}) {
    this.key = key;
    this.now = now;
    const stored = storage.getJson(key);
    /** @type {{ v: number, sessions: Session[] }} */
    this.data = stored?.v === 1 && Array.isArray(stored.sessions) ? stored : { v: 1, sessions: [] };
    /** @type {Session | null} */
    this.session = null;
    this._t = null;
    if (typeof addEventListener === 'function') addEventListener('pagehide', () => this.flush());
  }

  /** Feed every game event here; it keeps what matters. */
  record(ev) {
    const type = ev.type === 'spotted' && ev.critter?.hunted ? 'hunt-caught' : ev.type;
    if (ev.type === 'mode') this.begin(ev.mode);
    const s = this.session;
    if (!s) return;
    const t = (this.now() - s.start) / 1000;
    s.last = this.now();
    if (CHASE.has(type) && s.firstChaseS == null) s.firstChaseS = Math.round(t);
    if (type === 'discover' && ev.result !== 'revisit' && s.firstDiscoveryS == null) s.firstDiscoveryS = Math.round(t);
    if (type === 'hunt-caught') s.counts.spotted = (s.counts.spotted || 0) + 1;
    if (COUNTED.has(type)) s.counts[type] = (s.counts[type] || 0) + 1;
    this.save();
  }

  /** Distance moved this frame, by mode (call from the game loop; cheap). */
  moved(meters) { if (this.session && meters > 0 && meters < 500) this.session.meters += meters; }

  begin(mode) {
    const now = this.now();
    // a mode switch within a session keeps the session; a long gap starts a new one
    if (this.session && now - this.session.last < 30 * 60 * 1000) {
      this.session.mode = mode;
      this.session.modes[mode] = (this.session.modes[mode] || 0) + 1;
      return;
    }
    this.session = { start: now, last: now, mode, modes: { [mode]: 1 }, firstChaseS: null, firstDiscoveryS: null, meters: 0, counts: {} };
    this.data.sessions.push(this.session);
    if (this.data.sessions.length > MAX_SESSIONS) this.data.sessions.splice(0, this.data.sessions.length - MAX_SESSIONS);
    this.save();
  }

  save() { clearTimeout(this._t); this._t = setTimeout(() => this.flush(), 2000); }
  flush() {
    clearTimeout(this._t);
    if (this.session) { this.session.last = this.now(); this.session.meters = Math.round(this.session.meters); }
    storage.setJson(this.key, this.data);
  }
  clear() { this.data = { v: 1, sessions: [] }; this.session = null; storage.remove(this.key); }
  export() { this.flush(); return JSON.stringify(this.data, null, 2); }

  summary() { return summarize(this.data.sessions); }
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sum = (ss, k) => ss.reduce((a, s) => a + (s.counts[k] || 0), 0);
const rate = (a, b) => (b ? a / b : null);

/** Headline numbers across sessions. Pure, so it can be tested. @param {Session[]} sessions */
export function summarize(sessions) {
  // ignore sessions that were opened and closed straight away
  const ss = sessions.filter((s) => s.last - s.start > 20000);
  const hunts = sum(ss, 'hunt');
  return {
    sessions: ss.length,
    medianMinutes: median(ss.map((s) => (s.last - s.start) / 60000)),
    chaseWithinGoal: rate(ss.filter((s) => s.firstChaseS != null && s.firstChaseS <= CHASE_GOAL_S).length, ss.length),
    medianFirstChaseS: median(ss.filter((s) => s.firstChaseS != null).map((s) => s.firstChaseS)),
    medianFirstDiscoveryS: median(ss.filter((s) => s.firstDiscoveryS != null).map((s) => s.firstDiscoveryS)),
    medianMeters: median(ss.map((s) => s.meters)),
    hunts,
    huntCaught: rate(sum(ss, 'hunt-caught'), hunts),
    huntFled: rate(sum(ss, 'hunt-flee'), hunts),
    huntCold: rate(sum(ss, 'hunt-cold'), hunts),
    treasureFoundWhenHot: rate(sum(ss, 'treasure'), sum(ss, 'treasure-hot')),
    discoveries: sum(ss, 'discover'),
    tasksDone: sum(ss, 'task'),
    questsStarted: sum(ss, 'quest-start'),
    questsDone: sum(ss, 'quest-done'),
  };
}
