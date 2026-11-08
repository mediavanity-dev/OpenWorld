// Release channel. The same code is built twice:
//   stable -> /OpenWorld/       (experimental features off)
//   beta   -> /OpenWorld/beta/  (VITE_CHANNEL=beta: experimental features on)
// Each channel keeps its own profile and settings so tests never touch the real journal.

import { OKAPI_KEYS } from './config.js';

export const CHANNEL = import.meta.env?.VITE_CHANNEL === 'beta' ? 'beta' : 'stable';
export const BETA = CHANNEL === 'beta';
const PREFIX = BETA ? 'openworld-beta' : 'openworld';

// localStorage key for this channel, e.g. storeKey('profile.v1')
export const storeKey = (name) => `${PREFIX}.${name}`;
// the stable channel's key (beta can import the real profile from it)
export const stableKey = (name) => `openworld.${name}`;

// Game features that started as beta experiments. `stable: true` = graduated to the main
// version. All can be switched off individually in Settings.
export const FEATURES = {
  hunt: { label: 'The hunt: track animals by their signs', stable: true },
  treasure: { label: 'Daily treasure: golden finds hidden each day', stable: true },
  geocaching: { label: 'Geocaches from Opencaching', stable: true, needsKeys: true },
  rephoto: { label: 'Rephotography: line up old photos of a place in the camera', stable: false },
  quests: { label: 'Expeditions: daily mysteries, bounties and races that win collectible cards', stable: false },
};
// Beacons are hidden (both versions) until there is a shared-content model to give them a
// purpose (BACKLOG item 1). Beacons already placed stay in profiles and exports.
export const SHOW_BEACONS = false;

export const featureAvailable = (k) => (BETA || !!FEATURES[k]?.stable) && (!FEATURES[k]?.needsKeys || Object.values(OKAPI_KEYS).some((v) => (v || '').trim()));
