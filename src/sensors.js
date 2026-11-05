// Phone sensors and device APIs, all optional and feature-detected.

// ---------- compass ----------
// iOS: DeviceOrientationEvent.webkitCompassHeading (needs permission from a tap).
// Android/Chrome: 'deviceorientationabsolute' alpha (0 = north, counter-clockwise).
let heading = null;
let listening = false;
const listeners = new Set();

function screenAngle() { return (screen.orientation && screen.orientation.angle) || window.orientation || 0; }

function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
  if (h === null || Number.isNaN(h)) return;
  h = (h + screenAngle() + 360) % 360;
  // circular low-pass to calm the needle
  if (heading === null) heading = h;
  else {
    const d = ((h - heading + 540) % 360) - 180;
    heading = (heading + d * 0.2 + 360) % 360;
  }
  for (const fn of listeners) fn(heading);
}

export const compassSupported = typeof window.DeviceOrientationEvent !== 'undefined' && matchMedia('(pointer: coarse)').matches;

// Must be called from a user gesture on iOS.
export async function startCompass() {
  if (!compassSupported) return false;
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') return false;
    }
  } catch { return false; }
  if (!listening) {
    listening = true;
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrient);
    else window.addEventListener('deviceorientation', onOrient);
  }
  return true;
}
export function stopCompass() {
  listening = false;
  heading = null;
  window.removeEventListener('deviceorientationabsolute', onOrient);
  window.removeEventListener('deviceorientation', onOrient);
}
export function onHeading(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function currentHeading() { return heading; }

// ---------- keep the screen on (Present mode, walking around) ----------
let lock = null, wantLock = false;
export async function keepAwake(on) {
  wantLock = on;
  if (!('wakeLock' in navigator)) return false;
  try {
    if (on && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => (lock = null)); }
    if (!on && lock) { await lock.release(); lock = null; }
    return true;
  } catch { return false; }
}
document.addEventListener('visibilitychange', () => { if (wantLock && document.visibilityState === 'visible') keepAwake(true); });

// ---------- battery (Chrome/Android) ----------
export async function watchBattery(fn) {
  if (!navigator.getBattery) return;
  try {
    const b = await navigator.getBattery();
    const emit = () => fn({ level: b.level, charging: b.charging, low: !b.charging && b.level < 0.2 });
    b.addEventListener('levelchange', emit);
    b.addEventListener('chargingchange', emit);
    emit();
  } catch { /* unsupported */ }
}

// ---------- haptics ----------
export function buzz(pattern) { try { navigator.vibrate?.(pattern); } catch { /* ignore */ } }
