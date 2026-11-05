// @ts-check
// Display units (metric / imperial), read live from settings.
import { settings } from './settings.js';

export function fmtDist(m) {
  if (m == null || !isFinite(m)) return '–';
  if (settings.units === 'imperial') {
    const ft = m * 3.28084;
    return ft < 1000 ? `${Math.round(ft)} ft` : `${(m / 1609.344).toFixed(ft < 52800 ? 1 : 0)} mi`;
  }
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

export function fmtElev(m) {
  if (m == null || !isFinite(m)) return '–';
  return settings.units === 'imperial' ? `${Math.round(m * 3.28084)} ft` : `${Math.round(m)} m`;
}

export function fmtTemp(c, digits = 0) {
  if (c == null || !isFinite(c)) return '–';
  return settings.units === 'imperial' ? `${(c * 9 / 5 + 32).toFixed(digits)}°F` : `${c.toFixed(digits)}°C`;
}

// temperature *difference*
export function fmtTempDelta(dc) {
  const v = settings.units === 'imperial' ? dc * 9 / 5 : dc;
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)}°${settings.units === 'imperial' ? 'F' : 'C'}`;
}
