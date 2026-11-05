// Science & nature context for a place. All free, keyless, browser-friendly
// sources, fetched on demand and cached (see cache.js).

import { getTimes, getMoonTimes, getMoonIllumination } from 'suncalc';
import { cachedJson, cacheGet, cachePut } from './cache.js';
import { geohash, haversine } from '../geo.js';

const DAY = 864e5;

// ---------- geology under your feet (Macrostrat) ----------
export async function rockAt(lat, lon) {
  const cell = geohash(lat, lon, 6);
  const j = await cachedJson(`rock:${cell}`, `https://macrostrat.org/api/v2/geologic_units/map?lat=${lat.toFixed(4)}&lng=${lon.toFixed(4)}&format=json`, { ttl: 180 * DAY });
  const u = j?.success?.data?.[0];
  if (!u) return null;
  const name = u.strat_name || u.name;
  if (!name) return null;
  const period = u.t_int_name && u.b_int_name && u.t_int_name !== u.b_int_name ? `${u.b_int_name}–${u.t_int_name}` : u.t_int_name || u.b_int_name || '';
  return {
    key: `${name}|${period}`.toLowerCase(),
    name,
    lith: (u.lith || '').replace(/\s+/g, ' ').trim(),
    period,
    top: u.t_age ?? null,       // million years ago (youngest)
    bottom: u.b_age ?? null,    // million years ago (oldest)
    descrip: (u.descrip || '').slice(0, 300),
  };
}
export function ageText(r) {
  if (r.top == null || r.bottom == null) return r.period || '';
  const f = (v) => (v >= 1 ? `${+v.toFixed(v < 10 ? 1 : 0)}` : `${Math.round(v * 1000)} thousand`);
  return r.top === r.bottom ? `${f(r.top)} million years old` : `${f(r.top)}–${f(r.bottom)} million years old`;
}

// ---------- Wikipedia articles near a point ----------
export async function wikiNearby(lat, lon, radius = 1000) {
  const lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
  const url = (l) => `https://${l}.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat.toFixed(5)}|${lon.toFixed(5)}&gsradius=${radius}&gslimit=12&format=json&origin=*`;
  let j = await cachedJson(`wgeo:${lang}:${geohash(lat, lon, 7)}`, url(lang), { ttl: 14 * DAY });
  let used = lang;
  if (!j?.query?.geosearch?.length && lang !== 'en') { j = await cachedJson(`wgeo:en:${geohash(lat, lon, 7)}`, url('en'), { ttl: 14 * DAY }); used = 'en'; }
  return (j?.query?.geosearch || []).map((g) => ({
    title: g.title, dist: g.dist, lat: g.lat, lon: g.lon,
    url: `https://${used}.wikipedia.org/wiki/${encodeURIComponent(g.title.replace(/ /g, '_'))}`,
  }));
}

// ---------- sky (computed on the device) ----------
const SHOWERS = [ // peak month (1-12), day, name, typical zenithal hourly rate
  [1, 3, 'Quadrantids', 110], [4, 22, 'Lyrids', 18], [5, 6, 'Eta Aquariids', 50], [7, 30, 'Southern Delta Aquariids', 25],
  [8, 12, 'Perseids', 100], [10, 21, 'Orionids', 20], [11, 17, 'Leonids', 15], [12, 14, 'Geminids', 150], [12, 22, 'Ursids', 10],
];
export function skyNotes(lat, lon, utcOffsetSec) {
  const now = new Date();
  const t = getTimes(now, lat, lon);
  const m = getMoonTimes(now, lat, lon);
  const ill = getMoonIllumination(now);
  const local = (d) => (d && !isNaN(d) ? new Date(d.getTime() + utcOffsetSec * 1000).toISOString().slice(11, 16) : null);
  const dayLen = t.sunrise && t.sunset && !isNaN(t.sunrise) && !isNaN(t.sunset) ? (t.sunset - t.sunrise) / 3600000 : null;
  const localNow = new Date(now.getTime() + utcOffsetSec * 1000);
  let shower = null;
  for (let k = 0; k < 400 && !shower; k += 1) {
    const d = new Date(localNow.getTime() + k * DAY);
    const hit = SHOWERS.find(([mo, da]) => d.getUTCMonth() + 1 === mo && d.getUTCDate() === da);
    if (hit) shower = { name: hit[2], rate: hit[3], days: k, date: d.toISOString().slice(0, 10) };
  }
  return {
    sunrise: local(t.sunrise), sunset: local(t.sunset), noon: local(t.solarNoon),
    golden: local(t.goldenHour), dawn: local(t.dawn), dusk: local(t.dusk),
    dayLength: dayLen, polar: dayLen === null ? (t.solarNoon ? 'polar day or night' : null) : null,
    moonrise: local(m.rise), moonset: local(m.set), moonIllum: ill.fraction, moonPhase: ill.phase,
    shower, hemisphere: lat >= 0 ? 'N' : 'S',
  };
}

// ---------- climate: today vs the 1991–2020 normal for this date ----------
// One-time ~150 KB download per ~50 km area, reduced to 366 daily normals and cached for a year.
async function normals(lat, lon) {
  const la = (Math.round(lat * 2) / 2).toFixed(1), lo = (Math.round(lon * 2) / 2).toFixed(1);
  const key = `normals:${la},${lo}`;
  const hit = await cacheGet(key, 365 * DAY);
  if (hit) return hit;
  try {
    const r = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${la}&longitude=${lo}&start_date=1991-01-01&end_date=2020-12-31&daily=temperature_2m_max,temperature_2m_min&timezone=GMT`);
    if (!r.ok) return null;
    const j = await r.json();
    const sum = new Float64Array(366), n = new Uint16Array(366);
    j.daily.time.forEach((d, i) => {
      const mx = j.daily.temperature_2m_max[i], mn = j.daily.temperature_2m_min[i];
      if (mx == null || mn == null) return;
      const dt = new Date(d + 'T00:00:00Z');
      const doy = Math.floor((dt - Date.UTC(dt.getUTCFullYear(), 0, 1)) / DAY);
      sum[doy] += (mx + mn) / 2; n[doy]++;
    });
    // ±7-day smoothing
    const out = [];
    for (let d = 0; d < 366; d++) {
      let s = 0, c = 0;
      for (let k = -7; k <= 7; k++) { const i = (d + k + 366) % 366; s += sum[i]; c += n[i]; }
      out.push(c ? +(s / c).toFixed(2) : null);
    }
    cachePut(key, out);
    return out;
  } catch { return null; }
}
export async function climateToday(lat, lon, utcOffsetSec) {
  const [norm, f] = await Promise.all([
    normals(lat, lon),
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (!norm || !f?.daily) return null;
  const today = (f.daily.temperature_2m_max[0] + f.daily.temperature_2m_min[0]) / 2;
  const local = new Date(Date.now() + utcOffsetSec * 1000);
  const doy = Math.floor((local - Date.UTC(local.getUTCFullYear(), 0, 1)) / DAY);
  const normal = norm[Math.min(365, doy)];
  if (normal == null || !isFinite(today)) return null;
  return { today, normal, delta: today - normal, high: f.daily.temperature_2m_max[0], low: f.daily.temperature_2m_min[0] };
}

// ---------- earthquakes (USGS), last 7 days within 500 km ----------
export async function quakesNear(lat, lon) {
  const start = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10);
  const j = await cachedJson(`quakes:${geohash(lat, lon, 3)}:${start}`,
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&maxradiuskm=500&minmagnitude=2.5&starttime=${start}&orderby=magnitude&limit=5`,
    { ttl: 3 * 3600 * 1000 });
  return (j?.features || []).map((f) => ({
    mag: f.properties.mag, place: f.properties.place, time: f.properties.time,
    km: Math.round(haversine(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0]) / 1000),
    url: f.properties.url,
  }));
}

// ---------- species depth (iNaturalist) ----------
export async function taxonDetails(id) {
  const j = await cachedJson(`taxon:${id}`, `https://api.inaturalist.org/v1/taxa/${id}?locale=${(navigator.language || 'en').slice(0, 2)}`, { ttl: 30 * DAY });
  const t = j?.results?.[0];
  if (!t) return null;
  const RANKS = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus'];
  const lineage = (t.ancestors || []).filter((a) => RANKS.includes(a.rank)).map((a) => ({ rank: a.rank, name: a.name, common: a.preferred_common_name || null }));
  const cs = t.conservation_status;
  return {
    lineage,
    conservation: cs ? { status: cs.status_name || cs.status, authority: cs.authority || null } : null,
    observations: t.observations_count,
    summary: (t.wikipedia_summary || '').replace(/<[^>]+>/g, '').slice(0, 380),
    wiki: t.wikipedia_url || null,
  };
}
export async function seasonality(id, lat, lon) {
  const j = await cachedJson(`season:${id}:${geohash(lat, lon, 4)}`,
    `https://api.inaturalist.org/v1/observations/histogram?taxon_id=${id}&lat=${lat.toFixed(2)}&lng=${lon.toFixed(2)}&radius=50&interval=month_of_year&quality_grade=research`,
    { ttl: 60 * DAY });
  const m = j?.results?.month_of_year;
  if (!m) return null;
  const arr = Array.from({ length: 12 }, (_, i) => m[i + 1] || 0);
  return arr.some((v) => v > 0) ? arr : null;
}
