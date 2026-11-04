// Where is the device, physically? Two sources:
//   - Browser geolocation (GPS on phones; Wi-Fi/OS location on desktops)
//   - Internet (IP) geolocation: coarse, city-level; the ISP-based fallback
// Every fix carries its source and accuracy so the game can grade trust.

export function trustOf(fix) {
  if (!fix) return 'none';
  if (fix.source === 'ip') return 'ip';
  if (fix.accuracy <= 50) return 'gps';
  if (fix.accuracy <= 1000) return 'network';
  return 'coarse';
}

export function deviceFix(timeout = 20000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation not supported by this browser'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed, source: 'device', t: Date.now() }),
      (e) => reject(new Error(e.message || 'Location permission denied')),
      { enableHighAccuracy: true, timeout, maximumAge: 10000 },
    );
  });
}

export async function ipFix() {
  const res = await fetch('https://get.geojs.io/v1/ip/geo.json');
  if (!res.ok) throw new Error('IP lookup failed: ' + res.status);
  const j = await res.json();
  const lat = parseFloat(j.latitude), lon = parseFloat(j.longitude);
  if (!isFinite(lat) || !isFinite(lon)) throw new Error('IP lookup returned no position');
  return { lat, lon, accuracy: 5000, source: 'ip', place: [j.city, j.region, j.country].filter(Boolean).join(', '), t: Date.now() };
}

export function watchDevice(onFix, onError) {
  if (!navigator.geolocation) return () => {};
  const id = navigator.geolocation.watchPosition(
    (p) => onFix({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed, source: 'device', t: Date.now() }),
    (e) => onError?.(new Error(e.message)),
    { enableHighAccuracy: true, maximumAge: 5000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
