// @ts-check
// Player-facing names for the play modes and for how a find was made. The beta tries plainer
// names: "Walk" (your real location; you move by walking) instead of "Present", and finds that
// say how you made them ("walked", "from home", "echo") instead of "claimed". Only the words
// change: the internal ids ('present', 'home', 'roam'; grades 'present', 'home', 'echo') stay
// the same, so saves and backups are unaffected.

import { BETA } from './channel.js';

/** The real-location mode, as players see it. */
export const WALK = BETA ? 'Walk' : 'Present';
/** How a find was made, in a word (lower case). */
export const GRADE_WORD = BETA
  ? { present: 'walked', home: 'from home', echo: 'echo' }
  : { present: 'present', home: 'home', echo: 'echo' };
/** "claimed" (main) / "walked" (beta): finds made in the real-location mode. */
export const FOUND = BETA ? 'walked' : 'claimed';

/** Beta: swap the old words in the page's fixed text (start screen, tabs, help, settings). */
export function renameStaticText(root = document.body) {
  if (!BETA) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue;
    if (!t || !/Present|claimed|Be here/.test(t)) continue;
    n.nodeValue = t
      .replace('Be here: use my device location', 'Walk where I am')
      .replace(/\bPresent\b/g, 'Walk')
      .replace(/\bclaimed\b/g, 'walked');
  }
}
