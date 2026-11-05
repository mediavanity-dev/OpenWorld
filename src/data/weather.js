// Live weather + air quality from Open-Meteo (free, keyless, non-commercial use).
// Fetched for the character's area at most every 15 minutes or after moving ~5 km.

import { tryJson } from './net.js';

const FIELDS = 'temperature_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,precipitation,snowfall,snow_depth,is_day';

export async function fetchWeather(lat, lon) {
  const la = lat.toFixed(2), lo = lon.toFixed(2);
  const [w, a] = await Promise.all([
    tryJson(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current=${FIELDS}&timezone=auto`, { retries: 1 }),
    tryJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${la}&longitude=${lo}&current=european_aqi`),
  ]);
  if (!w?.current) return null;
  const c = w.current;
  return {
    t: Date.now(), lat, lon,
    tempC: c.temperature_2m,
    code: c.weather_code,
    cloud: (c.cloud_cover ?? 0) / 100,
    wind: c.wind_speed_10m ?? 0,          // km/h
    windDir: c.wind_direction_10m ?? 0,   // degrees, where wind comes FROM
    precip: c.precipitation ?? 0,
    snowDepth: c.snow_depth ?? 0,
    utcOffset: w.utc_offset_seconds ?? 0,
    timezone: w.timezone || null,
    aqi: a?.current?.european_aqi ?? null,
    ...describe(c.weather_code),
  };
}

// WMO weather interpretation codes -> {kind, label, icon}
export function describe(code) {
  if (code === 0) return { kind: 'clear', label: 'Clear', icon: '☀️' };
  if (code === 1) return { kind: 'clear', label: 'Mostly clear', icon: '🌤️' };
  if (code === 2) return { kind: 'cloudy', label: 'Partly cloudy', icon: '⛅' };
  if (code === 3) return { kind: 'cloudy', label: 'Overcast', icon: '☁️' };
  if (code === 45 || code === 48) return { kind: 'fog', label: 'Fog', icon: '🌫️' };
  if (code >= 51 && code <= 57) return { kind: 'drizzle', label: 'Drizzle', icon: '🌦️' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { kind: 'rain', label: code >= 65 || code === 82 ? 'Heavy rain' : 'Rain', icon: '🌧️' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { kind: 'snow', label: 'Snow', icon: '🌨️' };
  if (code >= 95) return { kind: 'storm', label: 'Thunderstorm', icon: '⛈️' };
  return { kind: 'cloudy', label: 'Cloudy', icon: '☁️' };
}

export function aqiLabel(aqi) {
  if (aqi == null) return null;
  if (aqi <= 20) return 'good';
  if (aqi <= 40) return 'fair';
  if (aqi <= 60) return 'moderate';
  if (aqi <= 80) return 'poor';
  return 'very poor';
}
