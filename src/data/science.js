// Science & nature context for a place. All free, keyless, browser-friendly
// sources, fetched on demand and cached (see cache.js).

import { getTimes, getMoonTimes, getMoonIllumination } from 'suncalc';
import { cachedJson, cacheGet, cachePut } from './cache.js';
import { geohash, haversine } from '../geo.js';
import { getJson, tryJson } from './net.js';

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
  const t2 = getTimes(new Date(now.getTime() + DAY), lat, lon);
  const dayLen2 = t2.sunrise && t2.sunset && !isNaN(t2.sunrise) && !isNaN(t2.sunset) ? (t2.sunset - t2.sunrise) / 3600000 : null;
  // how far the clock is from the sun: solar noon vs 12:00 on the local clock
  const noonLocal = t.solarNoon && !isNaN(t.solarNoon) ? new Date(t.solarNoon.getTime() + utcOffsetSec * 1000) : null;
  const solarShift = noonLocal ? Math.round((noonLocal.getUTCHours() * 60 + noonLocal.getUTCMinutes()) - 720) : null;
  return {
    dayTrend: dayLen != null && dayLen2 != null ? Math.round((dayLen2 - dayLen) * 60 * 10) / 10 : null, // minutes per day
    solarShift,
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
  const key = `normals2:${la},${lo}`;
  const hit = await cacheGet(key, 365 * DAY);
  if (hit) return hit;
  try {
    const j = await getJson(`https://archive-api.open-meteo.com/v1/archive?latitude=${la}&longitude=${lo}&start_date=1991-01-01&end_date=2020-12-31&daily=temperature_2m_max,temperature_2m_min&timezone=GMT`, { timeout: 30000 });
    const sum = new Float64Array(366), n = new Uint16Array(366);
    const recHi = Array.from({ length: 366 }, () => [-99, 0]), recLo = Array.from({ length: 366 }, () => [99, 0]);
    j.daily.time.forEach((d, i) => {
      const mx = j.daily.temperature_2m_max[i], mn = j.daily.temperature_2m_min[i];
      if (mx == null || mn == null) return;
      const dt = new Date(d + 'T00:00:00Z');
      const doy = Math.floor((dt - Date.UTC(dt.getUTCFullYear(), 0, 1)) / DAY);
      sum[doy] += (mx + mn) / 2; n[doy]++;
      if (mx > recHi[doy][0]) recHi[doy] = [mx, dt.getUTCFullYear()];
      if (mn < recLo[doy][0]) recLo[doy] = [mn, dt.getUTCFullYear()];
    });
    // ±7-day smoothing
    const out = [];
    for (let d = 0; d < 366; d++) {
      let s = 0, c = 0;
      for (let k = -7; k <= 7; k++) { const i = (d + k + 366) % 366; s += sum[i]; c += n[i]; }
      out.push(c ? +(s / c).toFixed(2) : null);
    }
    const res = { mean: out, hi: recHi.map(([v, y]) => [+v.toFixed(1), y]), lo: recLo.map(([v, y]) => [+v.toFixed(1), y]) };
    cachePut(key, res);
    return res;
  } catch { return null; }
}
export async function climateToday(lat, lon, utcOffsetSec) {
  const [norm, f] = await Promise.all([
    normals(lat, lon),
    tryJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`),
  ]);
  if (!norm || !f?.daily) return null;
  const today = (f.daily.temperature_2m_max[0] + f.daily.temperature_2m_min[0]) / 2;
  const local = new Date(Date.now() + utcOffsetSec * 1000);
  const doy = Math.floor((local - Date.UTC(local.getUTCFullYear(), 0, 1)) / DAY);
  const i = Math.min(365, doy), normal = norm.mean[i];
  if (normal == null || !isFinite(today)) return null;
  return { today, normal, delta: today - normal, high: f.daily.temperature_2m_max[0], low: f.daily.temperature_2m_min[0], recordHigh: norm.hi[i], recordLow: norm.lo[i] };
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

// ---------- recently seen here (iNaturalist, last 14 days, ~1 km) ----------
export async function recentNearby(lat, lon) {
  const since = new Date(Date.now() - 14 * DAY).toISOString().slice(0, 10);
  const j = await cachedJson(`recent:${geohash(lat, lon, 6)}:${since}`,
    `https://api.inaturalist.org/v1/observations?lat=${lat.toFixed(4)}&lng=${lon.toFixed(4)}&radius=1&d1=${since}&order_by=observed_on&per_page=40&quality_grade=research,needs_id&photos=true&locale=${(navigator.language || 'en').slice(0, 2)}`,
    { ttl: 3 * 3600 * 1000 });
  const seen = new Map();
  for (const o of j?.results || []) {
    const t = o.taxon;
    if (!t || seen.has(t.id)) continue;
    const ph = (o.photos || []).find((p) => p.license_code);
    seen.set(t.id, { id: t.id, name: t.preferred_common_name || t.name, sci: t.name, group: t.iconic_taxon_name, date: o.observed_on, photo: ph ? ph.url : null });
  }
  return [...seen.values()].slice(0, 6);
}

// ---------- old photos of this place (Wikimedia Commons, free licences) ----------
const stripTags = (x) => String(x || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
export async function photosNearby(lat, lon) {
  const j = await cachedJson(`commons:${geohash(lat, lon, 7)}`,
    `https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lat.toFixed(5)}|${lon.toFixed(5)}&ggsradius=600&ggsnamespace=6&ggslimit=30&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=200&iiextmetadatafilter=DateTimeOriginal|LicenseShortName|Artist&format=json&origin=*`,
    { ttl: 14 * DAY });
  const out = [];
  for (const pg of Object.values(j?.query?.pages || {})) {
    const ii = pg.imageinfo?.[0];
    if (!ii?.thumburl || !/\.(jpe?g|png|webp)$/i.test(pg.title)) continue;
    const m = /(1[6-9]\d\d|20\d\d)/.exec(stripTags(ii.extmetadata?.DateTimeOriginal?.value));
    out.push({ thumb: ii.thumburl, url: ii.descriptionurl, year: m ? +m[1] : null, title: pg.title.replace(/^File:|\.\w+$/g, ''),
      licence: stripTags(ii.extmetadata?.LicenseShortName?.value), by: stripTags(ii.extmetadata?.Artist?.value).slice(0, 60) });
  }
  // oldest first: the "then" in then-and-now
  return out.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999)).slice(0, 4);
}

// ---------- pollen in the air (Open-Meteo, Europe; only shown when present) ----------
const POLLEN = { alder_pollen: 'alder', birch_pollen: 'birch', grass_pollen: 'grass', mugwort_pollen: 'mugwort', olive_pollen: 'olive', ragweed_pollen: 'ragweed' };
export async function pollenNow(lat, lon) {
  const j = await cachedJson(`pollen:${geohash(lat, lon, 4)}:${new Date().toISOString().slice(0, 13)}`,
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=${Object.keys(POLLEN).join(',')}`,
    { ttl: 3 * 3600 * 1000 });
  const c = j?.current;
  if (!c) return [];
  return Object.entries(POLLEN).map(([k, name]) => ({ name, v: c[k] })).filter((x) => x.v > 1)
    .map((x) => ({ ...x, level: x.v < 10 ? 'low' : x.v < 50 ? 'moderate' : x.v < 200 ? 'high' : 'very high' }))
    .sort((a, b) => b.v - a.v);
}

// ---------- the other side of the Earth ----------
export async function antipode(lat, lon) {
  const a = { lat: -lat, lon: lon > 0 ? lon - 180 : lon + 180 };
  const j = await cachedJson(`anti:${a.lat.toFixed(1)},${a.lon.toFixed(1)}`,
    `https://nominatim.openstreetmap.org/reverse?format=json&zoom=5&lat=${a.lat}&lon=${a.lon}`, { ttl: 60 * DAY });
  const place = j?.address ? [j.address.state || j.address.region, j.address.country].filter(Boolean).join(', ') : null;
  return { ...a, place: place || null };
}

// ---------- rephotography: old photos taken right at a place (Wikimedia Commons) ----------
// Tighter than photosNearby (the photo should show *this* spot) and only genuinely old
// images; a larger rendition is used for the camera overlay. Free licences only.
export const REPHOTO_BEFORE = 1970;
export async function oldPhotosAt(lat, lon, radius = 150) {
  const j = await cachedJson(`commons-old:${geohash(lat, lon, 7)}:${radius}`,
    `https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lat.toFixed(5)}|${lon.toFixed(5)}&ggsradius=${radius}&ggsnamespace=6&ggslimit=40&prop=imageinfo|coordinates&iiprop=url|extmetadata&iiurlwidth=1024&iiextmetadatafilter=DateTimeOriginal|LicenseShortName|Artist|ImageDescription&format=json&origin=*`,
    { ttl: 14 * DAY });
  const out = [];
  for (const pg of Object.values(j?.query?.pages || {})) {
    const ii = pg.imageinfo?.[0];
    if (!ii?.thumburl || !/\.(jpe?g|png|webp)$/i.test(pg.title)) continue;
    const m = /(1[6-9]\d\d|20\d\d)/.exec(stripTags(ii.extmetadata?.DateTimeOriginal?.value));
    const year = m ? +m[1] : null;
    if (!year || year >= REPHOTO_BEFORE) continue;
    const c = pg.coordinates?.[0];
    out.push({
      src: ii.thumburl, url: ii.descriptionurl, year, title: pg.title.replace(/^File:|\.\w+$/g, ''),
      licence: stripTags(ii.extmetadata?.LicenseShortName?.value), by: stripTags(ii.extmetadata?.Artist?.value).slice(0, 80),
      about: stripTags(ii.extmetadata?.ImageDescription?.value).slice(0, 300),
      dist: c ? haversine(lat, lon, c.lat, c.lon) : null,
    });
  }
  return out.sort((a, b) => (a.dist ?? 999) - (b.dist ?? 999) || a.year - b.year).slice(0, 5);
}
