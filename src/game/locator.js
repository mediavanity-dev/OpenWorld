// @ts-check
// Where is the device, physically? Two sources:
//   - Browser geolocation (GPS on phones; Wi-Fi/OS location on desktops)
//   - Internet (IP) geolocation: coarse, city-level; the ISP-based fallback
// Every fix carries its source and accuracy so the game can grade trust.

import { getJson } from '../data/net.js';

// The phone app swaps in native location (one clear iOS permission prompt, better accuracy);
// it has the same shape as navigator.geolocation.
/** @type {any} */
let nativeGeo = null;
export function useNativeGeolocation(g) { nativeGeo = g; }
const geo = () => nativeGeo || navigator.geolocation;

export function trustOf(fix) {
  if (!fix) return 'none';
  if (fix.source === 'ip') return 'ip';
  if (fix.accuracy <= 50) return 'gps';
  if (fix.accuracy <= 1000) return 'network';
  return 'coarse';
}

// quick: the position the phone already knows (cached up to 2 minutes, network-level accuracy),
// which comes back almost at once; the location watch then sharpens it with GPS.
export function deviceFix(timeout = 20000, { quick = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!geo()) return reject(new Error('Geolocation not supported by this browser'));
    geo().getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed, source: 'device', t: Date.now() }),
      (e) => reject(new Error(e.message || 'Location permission denied')),
      quick ? { enableHighAccuracy: false, timeout: Math.min(timeout, 4000), maximumAge: 120000 } : { enableHighAccuracy: true, timeout, maximumAge: 10000 },
    );
  });
}

export async function ipFix() {
  const j = await getJson('https://get.geojs.io/v1/ip/geo.json', { timeout: 10000, retries: 1 })
    .catch((err) => { throw new Error('IP lookup failed: ' + err.message); });
  const lat = parseFloat(j.latitude), lon = parseFloat(j.longitude);
  if (!isFinite(lat) || !isFinite(lon)) throw new Error('IP lookup returned no position');
  return { lat, lon, accuracy: 5000, source: 'ip', place: [j.city, j.region, j.country].filter(Boolean).join(', '), t: Date.now() };
}

export function watchDevice(onFix, onError) {
  if (!geo()) return () => {};
  const g = geo();
  const id = g.watchPosition(
    (p) => onFix({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed, source: 'device', t: Date.now() }),
    (e) => onError?.(new Error(e.message)),
    { enableHighAccuracy: true, maximumAge: 5000 },
  );
  return () => g.clearWatch(id);
}
