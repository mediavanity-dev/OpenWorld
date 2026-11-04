// The live environment around the character: sun, moon, season, weather, air,
// local time, public holiday. Nothing here is stored as world state; a snapshot
// is stamped onto discoveries as "the conditions when you were there".

import { getPosition, getMoonPosition, getMoonIllumination } from 'suncalc';
import { fetchWeather, aqiLabel } from '../data/weather.js';
import { seasonAt, moonPhaseName, countryAt, holidayOn } from '../data/calendar.js';
import { haversine } from '../geo.js';

const WEATHER_EVERY = 15 * 60 * 1000;
const WEATHER_MOVE_M = 5000;
const COUNTRY_MOVE_M = 40000;

export class Environment {
  constructor(onChange) {
    this.onChange = onChange || (() => {});
    this.weather = null;
    this.country = null;
    this.holiday = null;
    this._w = null; // last weather fetch {lat, lon, t}
    this._c = null; // last country fetch
    this._busy = false;
  }

  // Call periodically with the character's position.
  async refresh(lat, lon, { offline = false } = {}) {
    if (this._busy || offline) return;
    const now = Date.now();
    const needW = !this._w || now - this._w.t > WEATHER_EVERY || haversine(lat, lon, this._w.lat, this._w.lon) > WEATHER_MOVE_M;
    const needC = !this._c || haversine(lat, lon, this._c.lat, this._c.lon) > COUNTRY_MOVE_M;
    if (!needW && !needC) return;
    this._busy = true;
    try {
      if (needW) {
        this._w = { lat, lon, t: now };
        const w = await fetchWeather(lat, lon);
        if (w) this.weather = w;
      }
      if (needC) {
        this._c = { lat, lon };
        this.country = await countryAt(lat, lon);
      }
      this.holiday = await holidayOn(this.country, this.localNow());
      this.onChange(this);
    } finally { this._busy = false; }
  }

  utcOffset() { return this.weather ? this.weather.utcOffset : -new Date().getTimezoneOffset() * 60; }
  // A Date whose UTC fields read as the place's local wall-clock time.
  localNow() { return new Date(Date.now() + this.utcOffset() * 1000); }
  localTimeText() {
    const d = this.localNow();
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }

  sun(lat, lon, date = new Date()) { const p = getPosition(date, lat, lon); return { alt: p.altitude, az: p.azimuth }; }
  moon(lat, lon, date = new Date()) {
    const p = getMoonPosition(date, lat, lon), i = getMoonIllumination(date);
    return { alt: p.altitude, az: p.azimuth, illum: i.fraction, phase: i.phase };
  }

  sunPhase(alt) {
    if (alt < -6) return 'night';
    if (alt < -0.833) return 'twilight';
    if (alt < 8) return 'golden hour';
    return 'day';
  }

  snapshot(lat, lon) {
    const sun = this.sun(lat, lon), moon = this.moon(lat, lon), w = this.weather;
    return {
      local: this.localTimeText(),
      sun: this.sunPhase(sun.alt),
      moon: moonPhaseName(moon.phase),
      season: seasonAt(lat),
      weather: w?.kind || null,
      tempC: w ? Math.round(w.tempC) : null,
      air: aqiLabel(w?.aqi),
      holiday: this.holiday || null,
    };
  }

  // compact condition tags for collecting ("seen in the rain", "at night", ...)
  tags(snap) {
    const t = [];
    if (snap.sun === 'night') t.push('night');
    if (snap.sun === 'golden hour' || snap.sun === 'twilight') t.push('golden');
    if (snap.weather && snap.weather !== 'clear' && snap.weather !== 'cloudy') t.push(snap.weather);
    if (snap.sun === 'night' && snap.moon === 'full moon') t.push('fullmoon');
    if (snap.holiday) t.push('holiday');
    if (snap.season && snap.season !== 'tropical') t.push(snap.season);
    return t;
  }
}

export const TAG_ICONS = {
  night: '🌙', golden: '🌅', fog: '🌫️', drizzle: '🌦️', rain: '🌧️', snow: '❄️', storm: '⛈️',
  fullmoon: '🌕', holiday: '🎉', spring: '🌸', summer: '☀️', autumn: '🍂', winter: '⛄',
};
