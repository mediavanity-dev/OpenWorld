// Calendar knowledge: seasons, moon phases, public holidays.

import { cachedJson } from './cache.js';

export function seasonAt(lat, date = new Date()) {
  if (Math.abs(lat) < 23.5) return 'tropical';
  let m = date.getUTCMonth(); // 0..11
  if (lat < 0) m = (m + 6) % 12;
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}

export function moonPhaseName(phase) {
  const names = ['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full moon', 'waning gibbous', 'last quarter', 'waning crescent'];
  return names[Math.round(phase * 8) % 8];
}

// Country code for a position (OSM Nominatim reverse, coarse zoom; cached 30 days per ~11 km cell).
export async function countryAt(lat, lon) {
  const key = `country:${lat.toFixed(1)},${lon.toFixed(1)}`;
  const j = await cachedJson(key, `https://nominatim.openstreetmap.org/reverse?format=json&zoom=3&lat=${lat}&lon=${lon}`, { ttl: 30 * 864e5 });
  return j?.address?.country_code?.toUpperCase() || null;
}

// Public holiday for that country on a given local date (Nager.Date; cached 30 days).
export async function holidayOn(country, localDate) {
  if (!country) return null;
  const y = localDate.getUTCFullYear();
  const list = await cachedJson(`hol:${country}:${y}`, `https://date.nager.at/api/v3/PublicHolidays/${y}/${country}`, { ttl: 30 * 864e5 });
  if (!Array.isArray(list)) return null;
  const iso = localDate.toISOString().slice(0, 10);
  const h = list.find((x) => x.date === iso && (x.global !== false));
  return h ? (h.name || h.localName) : null;
}
