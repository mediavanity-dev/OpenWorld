// Per-device settings (not part of the portable profile) and quality tiers.

import { storeKey } from './channel.js';
import { storage } from './storage.js';

const KEY = storeKey('settings.v1');
const coarse = matchMedia('(pointer: coarse)').matches;
const conn = navigator.connection;
const saveDataHint = !!(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')));

export const TIERS = {
  high:     { label: 'High',          pixelRatio: 2,   tex: 1024, maxTrees: 5000, ring: 1, particles: 2200, labels: 14, fps: 60 },
  balanced: { label: 'Balanced',      pixelRatio: 1.5, tex: 768,  maxTrees: 3000, ring: 1, particles: 1200, labels: 10, fps: 60 },
  saver:    { label: 'Battery saver', pixelRatio: 1,   tex: 512,  maxTrees: 1200, ring: 1, particles: 500,  labels: 6,  fps: 30 },
};

const defaults = {
  quality: 'auto',          // auto | high | balanced | saver
  dataSaver: saveDataHint,  // skip background detail + wildlife lookups
  compassFollow: false,     // camera turns with the phone (Present mode)
  keepAwake: coarse,        // keep the screen on while Present
  weatherFx: true,
  units: /^en-(US|LR)|^my\b/i.test(navigator.language || '') ? 'imperial' : 'metric',
  textSize: 'normal',       // normal | large
  reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  sound: false,             // ambient soundscape (off by default)
  placeNames: 'zoom',       // zoom (only when zoomed in) | always | never
  features: {},             // beta experiments switched off by the player: { hunt: false, ... }
};

export const settings = (() => {
  return { ...defaults, ...(storage.getJson(KEY) || {}) };
})();

export function saveSettings() {
  storage.setJson(KEY, settings);
}

export const isTouch = coarse;
export function startTier() { return settings.quality !== 'auto' ? settings.quality : coarse ? 'balanced' : 'high'; }
