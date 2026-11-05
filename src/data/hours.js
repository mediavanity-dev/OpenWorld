// @ts-check
// Minimal OSM opening_hours evaluator for the common cases:
//   "24/7", "Mo-Fr 08:00-18:00; Sa 09:00-13:00", "Mo-Su 10:00-02:00", "Tu,Th 09:00-12:00,13:00-17:00",
//   "Mo-Fr 08:00-18:00, Sa 10:00-14:00", "Su off", "10:00-22:00".
// Anything fancier (months, weeks, PH/SH, sunrise, comments) returns null = unknown,
// and the game then treats the place as always discoverable.

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function parseDays(spec) {
  const set = new Set();
  for (const part of spec.split(',')) {
    const m = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(part.trim());
    if (!m) return null;
    const a = DAYS.indexOf(m[1]), b = m[2] ? DAYS.indexOf(m[2]) : a;
    for (let d = a; ; d = (d + 1) % 7) { set.add(d); if (d === b) break; }
  }
  return set;
}

function parseTimes(spec) {
  const out = [];
  for (const part of spec.split(',')) {
    const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\+?$/.exec(part.trim());
    if (!m) return null;
    out.push([+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]]);
  }
  return out;
}

// Returns a weekly schedule: array[7] of [[from,to],...] minutes (to may exceed 1440 for overnight), or null.
export function parseHours(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim();
  if (s === '24/7') return DAYS.map(() => [[0, 1440]]);
  const week = DAYS.map(() => []);
  // split rules on ';' and on a comma that ends a time/off and is followed by a weekday token
  const rules = s.split(/;|(?<=\d|off|closed),\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)/).map((r) => r.trim()).filter(Boolean);
  for (const rule of rules) {
    if (/^(PH|SH)\b/.test(rule)) continue; // holiday rules: ignored (approximation)
    const m = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?)+)?\s*(.*)$/.exec(rule);
    if (!m) return null;
    const days = m[1] ? parseDays(m[1].replace(/,$/, '')) : new Set([0, 1, 2, 3, 4, 5, 6]);
    if (!days) return null;
    const rest = m[2].trim();
    let times;
    if (rest === 'off' || rest === 'closed') times = [];
    else if (rest === '' && m[1]) times = [[0, 1440]];
    else { times = parseTimes(rest); if (!times) return null; }
    for (const d of days) {
      week[d] = times.map(([a, b]) => [a, b <= a ? b + 1440 : b]);
    }
  }
  return week;
}

// `local` is a Date whose UTC fields hold the place's local wall-clock time.
export function isOpen(week, local) {
  if (!week) return null;
  const day = (local.getUTCDay() + 6) % 7; // Mo=0
  const min = local.getUTCHours() * 60 + local.getUTCMinutes();
  for (const [a, b] of week[day]) if (min >= a && min < b) return true;
  const prev = (day + 6) % 7; // yesterday's overnight ranges
  for (const [, b] of week[prev]) if (b > 1440 && min < b - 1440) return true;
  return false;
}

export function nextOpening(week, local) {
  if (!week) return null;
  const day = (local.getUTCDay() + 6) % 7;
  const min = local.getUTCHours() * 60 + local.getUTCMinutes();
  for (let k = 0; k < 7; k++) {
    const d = (day + k) % 7;
    const starts = week[d].map(([a]) => a).filter((a) => k > 0 || a > min).sort((x, y) => x - y);
    if (starts.length) {
      const t = `${String(Math.floor(starts[0] / 60)).padStart(2, '0')}:${String(starts[0] % 60).padStart(2, '0')}`;
      return k === 0 ? t : k === 1 ? `tomorrow ${t}` : `${DAYS[d]} ${t}`;
    }
  }
  return null;
}
