// The iPhone app's native pieces (loaded only inside the app, see src/boot.js):
//   - storage: the profile and settings in native storage (iOS may clear a web view's storage)
//   - haptics: real taps and buzzes (iPhones have no navigator.vibrate)
//   - location: native location, one clear permission prompt
//   - notifications: an optional morning nudge for the day's expeditions (Settings)
//   - tips: the optional tip jar (StoreKit, via the app's own plugin)

import { registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Geolocation } from '@capacitor/geolocation';
import { useBackend } from '../storage.js';
import { useNativeHaptics } from '../sensors.js';
import { useNativeGeolocation } from '../game/locator.js';

export const isNative = true;

// ---------------------------------------------------------------- storage
// Everything is read into memory once at start (the game reads synchronously), then every write
// goes to memory at once and to native storage in the background.
async function nativeStorage() {
  const mem = new Map();
  const { keys } = await Preferences.keys();
  await Promise.all(keys.map(async (key) => { const { value } = await Preferences.get({ key }); if (value != null) mem.set(key, value); }));
  // first launch after an update that moved storage: bring over anything the web view kept
  if (!keys.length) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('openworld')) { const v = localStorage.getItem(k); if (v != null) { mem.set(k, v); Preferences.set({ key: k, value: v }); } }
      }
    } catch { /* no web storage */ }
  }
  useBackend({
    read: (key) => (mem.has(key) ? mem.get(key) : null),
    write: (key, value) => { mem.set(key, value); Preferences.set({ key, value }).catch(() => {}); },
    remove: (key) => { mem.delete(key); Preferences.remove({ key }).catch(() => {}); },
  });
}

// ---------------------------------------------------------------- haptics
// navigator.vibrate patterns, mapped to iOS feel: short = a light tap, longer patterns = a
// success buzz, a long single = a medium thud.
function hapticsFor(pattern) {
  const p = Array.isArray(pattern) ? pattern : [pattern];
  if (p.length >= 5) return Haptics.notification({ type: NotificationType.Success });
  if (p.length >= 3) return Haptics.impact({ style: ImpactStyle.Medium });
  return Haptics.impact({ style: (p[0] || 0) < 20 ? ImpactStyle.Light : ImpactStyle.Medium });
}

// ---------------------------------------------------------------- location
// The same shape as navigator.geolocation, backed by the native plugin.
const nativeGeo = {
  getCurrentPosition(ok, fail, opts) { Geolocation.getCurrentPosition(opts).then(ok, (e) => fail?.({ message: e?.message || String(e) })); },
  watchPosition(ok, fail, opts) {
    const h = { id: null, stopped: false };
    Geolocation.watchPosition(opts || {}, (pos, err) => { if (err) fail?.({ message: err.message || String(err) }); else if (pos) ok(pos); })
      .then((id) => { h.id = id; if (h.stopped) Geolocation.clearWatch({ id }); });
    return h;
  },
  clearWatch(h) { if (!h) return; h.stopped = true; if (h.id) Geolocation.clearWatch({ id: h.id }); },
};

// ---------------------------------------------------------------- the app's own plugin (tips)
// A Capacitor plugin proxy answers to every property, `then` included, so it must never be
// returned from an async function or awaited directly: hand it out behind a wrapper.
const raw = registerPlugin('OpenWorld');
export const app = new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : raw[k]) });

// Android back button/gesture: close the open card or panel, else go back in the page's history,
// else leave (Android keeps the app in the background). Without a handler, Android closes the app
// from any screen.
function androidBack() {
  const App = registerPlugin('App'); // @capacitor/app
  App.addListener('backButton', ({ canGoBack }) => {
    const open = [...document.querySelectorAll('dialog[open]')].pop();
    if (open) { open.close(); return; }
    for (const el of document.querySelectorAll('[aria-label="Close"], [aria-label="Close old photo"], .close')) {
      if (el.offsetParent !== null) { el.click(); return; }
    }
    if (canGoBack) history.back();
    else App.minimizeApp();
  }).catch(() => {});
}

export async function startNative() {
  await nativeStorage().catch((e) => console.warn('native storage unavailable, using the web view’s', e));
  useNativeHaptics((pattern) => { hapticsFor(pattern).catch(() => {}); });
  useNativeGeolocation(nativeGeo);
  document.documentElement.classList.add('native');
  if (globalThis.Capacitor?.getPlatform?.() === 'android') androidBack();
  // the App Store name (the website keeps OpenWorld)
  document.title = 'OpenEarth';
  const rename = () => { for (const el of document.querySelectorAll('#start h1, .app-name')) el.textContent = 'OpenEarth'; };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rename); else rename();
  window.OpenWorldNative = { app, notifications: () => import('./notify.js') };
}
