// The character profile: the ONLY durable game state. Small (KBs), lives on the
// device, exportable as JSON. Everything in it is keyed by real-world anchors,
// never by render coordinates or dataset-internal indices.

const KEY = 'openworld.profile.v1';

export const GRADE_RANK = { echo: 1, home: 2, present: 3 };

function fresh() {
  return {
    v: 1,
    id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),
    created: new Date().toISOString(),
    home: null,          // { lat, lon, source, accuracy, setAt }
    last: null,          // { lat, lon, mode }
    discoveries: {},     // feature_ref -> { name, kind, grade, trust, anchor, first, last, visits }
    beacons: [],         // { id, label, mode, anchor }
    stats: { meters: { present: 0, home: 0, roam: 0 } },
    log: [],             // [{ t, msg }]
  };
}

export class Profile {
  constructor() {
    this.data = fresh();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...fresh(), ...JSON.parse(raw) };
    } catch { /* storage unavailable: play with an in-memory profile */ }
    this._t = null;
  }

  save() {
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
    }, 300);
  }

  log(msg) {
    this.data.log.unshift({ t: new Date().toISOString(), msg });
    this.data.log.length = Math.min(this.data.log.length, 200);
    this.save();
  }

  // Returns 'new' | 'upgraded' | 'revisit'
  recordDiscovery(poi, grade, trust, anchor) {
    const d = this.data.discoveries[poi.ref];
    const now = new Date().toISOString();
    if (!d) {
      this.data.discoveries[poi.ref] = { name: poi.name, kind: poi.kind, grade, trust, anchor, first: now, last: now, visits: 1 };
      this.save();
      return 'new';
    }
    d.last = now;
    d.visits++;
    let res = 'revisit';
    if (GRADE_RANK[grade] > GRADE_RANK[d.grade]) {
      d.grade = grade; d.trust = trust; d.anchor = anchor; res = 'upgraded';
    }
    this.save();
    return res;
  }

  addBeacon(label, mode, anchor) {
    const b = { id: 'b' + Date.now().toString(36), label, mode, anchor };
    this.data.beacons.push(b);
    this.save();
    return b;
  }

  counts() {
    const c = { present: 0, home: 0, echo: 0 };
    for (const d of Object.values(this.data.discoveries)) c[d.grade]++;
    return c;
  }

  export() { return JSON.stringify(this.data, null, 2); }
  import(json) {
    const d = JSON.parse(json);
    if (d.v !== 1 || typeof d.discoveries !== 'object') throw new Error('Not an OpenWorld v1 profile');
    this.data = { ...fresh(), ...d };
    this.save();
  }
  reset() { this.data = fresh(); this.save(); }
}
