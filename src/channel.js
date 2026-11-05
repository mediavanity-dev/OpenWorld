// Release channel. The same code is built twice:
//   stable -> /OpenWorld/       (experimental features off)
//   beta   -> /OpenWorld/beta/  (VITE_CHANNEL=beta: experimental features on)
// Each channel keeps its own profile and settings so tests never touch the real journal.

export const CHANNEL = import.meta.env?.VITE_CHANNEL === 'beta' ? 'beta' : 'stable';
export const BETA = CHANNEL === 'beta';
const PREFIX = BETA ? 'openworld-beta' : 'openworld';

// localStorage key for this channel, e.g. storeKey('profile.v1')
export const storeKey = (name) => `${PREFIX}.${name}`;
// the stable channel's key (beta can import the real profile from it)
export const stableKey = (name) => `openworld.${name}`;

// Experimental features (beta only). Can be switched off individually in beta settings.
export const FEATURES = {
  hunt: { label: 'The hunt: track creatures by their signs', default: true },
  treasure: { label: 'Daily treasure: golden finds hidden each day', default: true },
};
