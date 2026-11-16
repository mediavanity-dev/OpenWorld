// @ts-check
// Fetch the remote switches (see net.js setSwitchedOff) once per start. The file is part of the
// public website, so a provider's request to stop can be honoured in minutes, for every copy of
// the app, without an update. The last list is kept, so it also applies offline.

import { setSwitchedOff } from './net.js';
import { storage } from '../storage.js';

const URL_ = 'https://mediavanity-dev.github.io/OpenWorld/switches.json';
const KEY = 'openworld.switches';

export async function loadSwitches(fetchImpl = fetch) {
  setSwitchedOff(storage.getJson(KEY)?.off || []);
  try {
    const res = await fetchImpl(URL_, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (!res.ok) return;
    const j = await res.json();
    if (!Array.isArray(j?.off)) return;
    setSwitchedOff(j.off);
    storage.setJson(KEY, { off: j.off });
  } catch { /* offline or not published yet: keep the last list */ }
}
