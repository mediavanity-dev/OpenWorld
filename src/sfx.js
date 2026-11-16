// @ts-check
// Short sound effects for the moments that matter (a find, a card, getting warmer), synthesised
// on the device: no audio files. On by default (Settings → Sound effects), separate from the
// optional ambient soundscape. Browsers only allow audio after a tap, so the first tap unlocks
// it. On iPhone, Web Audio follows the ring/silent switch, as a game's effects should.

import { settings } from './settings.js';

/** @type {AudioContext | null} */
let ctx = null;
/** @type {GainNode | null} */
let out = null;

function audio() {
  if (!settings.sfx) return null;
  if (!ctx) {
    const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(ctx.destination);
    document.addEventListener('visibilitychange', () => { if (document.hidden) ctx?.suspend(); });
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  return ctx;
}
// unlock on the first tap or key (required by browsers; harmless if sound is off)
const unlock = () => { if (settings.sfx) audio(); };
addEventListener('pointerdown', unlock, { once: true, capture: true });
addEventListener('keydown', unlock, { once: true, capture: true });

const semis = (base, n) => base * Math.pow(2, n / 12);

/** one soft mallet note: a sine with a quiet octave partial and a quick decay */
function note(freq, at, { dur = 0.5, vol = 0.06, type = /** @type {OscillatorType} */ ('sine') } = {}) {
  const c = audio();
  if (!c || !out) return;
  const t = c.currentTime + 0.02 + at;
  for (const [mul, v] of [[1, vol], [2, vol * 0.25]]) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq * mul;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }
}

export const sfx = {
  /** the original two-note chime; level raises the pitch (hunt signal, treasure, clues) */
  chime(level = 1) {
    note(semis(660, level), 0, { dur: 0.6, vol: 0.045 });
    note(semis(660, level + 4), 0.11, { dur: 0.6, vol: 0.045 });
  },
  /** a new place, rock or creature: a bright three-note arpeggio */
  discover(grade = 'present') {
    const base = grade === 'echo' ? 523 : 587; // echoes sound a little softer and lower
    [0, 4, 7].forEach((n, k) => note(semis(base, n), k * 0.07, { dur: 0.45, vol: grade === 'echo' ? 0.035 : 0.055 }));
  },
  /** a card turning over: more notes and a shimmer for rarer cards (0 common .. 4 legendary) */
  card(rarity = 0) {
    const steps = [0, 4, 7, 12, 16, 19, 24].slice(0, 3 + rarity);
    steps.forEach((n, k) => note(semis(440, n), k * 0.085, { dur: 0.7, vol: 0.055 }));
    if (rarity >= 2) for (let k = 0; k < 6; k++) note(semis(1760, (k * 5) % 12), 0.35 + k * 0.05, { dur: 0.3, vol: 0.018, type: 'triangle' });
  },
  /** a new field rank */
  rankUp() {
    [[0, 0], [4, 0.12], [7, 0.24], [12, 0.36], [7, 0.52], [12, 0.62]].forEach(([n, at]) => note(semis(523, n), at, { dur: n === 12 && at > 0.5 ? 1.1 : 0.4, vol: 0.06 }));
  },
  /** quiz answers */
  right() { note(semis(659, 0), 0, { dur: 0.3 }); note(semis(659, 7), 0.09, { dur: 0.5 }); },
  wrong() { note(220, 0, { dur: 0.35, vol: 0.05, type: 'triangle' }); note(196, 0.12, { dur: 0.45, vol: 0.05, type: 'triangle' }); },
};
