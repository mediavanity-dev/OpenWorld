// An optional morning nudge (iPhone app only; off until the player turns it on in Settings).
// In the spirit of the game: at most one a day, never on a day the app was already opened
// (the next two weeks are re-planned at every launch, starting tomorrow), never streak guilt.
// Built on the device from the real sky: a meteor shower or full moon gets its own line.

import { LocalNotifications } from '@capacitor/local-notifications';
import { getMoonIllumination } from 'suncalc';

const IDS = Array.from({ length: 14 }, (_, k) => 7100 + k);
const PLAIN = [
  'Today’s expeditions are ready: a riddle, a wanted animal and a race.',
  'A new riddle about a real place near you is waiting.',
  'Three fresh expeditions have been dealt around you.',
  'Today’s bounty is a creature people have really seen near you.',
];

/** The two weeks of lines, from tomorrow. showers: [{ date: 'YYYY-MM-DD', name }] */
export function plan(hour, showers = [], now = new Date()) {
  const out = [];
  for (let k = 1; k <= IDS.length; k++) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k, hour, 0, 0);
    const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    const shower = showers.find((s) => s.date === key);
    const night = new Date(at.getFullYear(), at.getMonth(), at.getDate(), 23);
    const full = getMoonIllumination(night).fraction > 0.97;
    const body = shower ? `🌠 The ${shower.name} meteor shower peaks tonight. There’s a night-sky expedition on your board.`
      : full ? '🌕 Full moon tonight. Anything you finish under it after dark earns a rarer card.'
        : PLAIN[k % PLAIN.length];
    out.push({ id: IDS[k - 1], title: 'OpenEarth', body, schedule: { at, allowWhileIdle: false } });
  }
  return out;
}

export async function enable() {
  const p = await LocalNotifications.requestPermissions();
  return p.display === 'granted';
}

/** Re-plan (call at launch and when the setting changes). on=false cancels them all. */
export async function reschedule(on, hour, showers) {
  await LocalNotifications.cancel({ notifications: IDS.map((id) => ({ id })) }).catch(() => {});
  if (!on) return;
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted') return;
  await LocalNotifications.schedule({ notifications: plan(hour, showers) });
}
