// @ts-check
// Player-facing names for the play modes and for how a find was made: "Walk" (your real
// location; you move by walking; formerly "Present"), and finds that say how you made them
// ("walked", "from home", "echo"; formerly "claimed"). Only the words
// change: the internal ids ('present', 'home', 'roam'; grades 'present', 'home', 'echo') stay
// the same, so saves and backups are unaffected.

/** The real-location mode, as players see it. */
export const WALK = 'Walk';
/** How a find was made, in a word (lower case). */
export const GRADE_WORD = { present: 'walked', home: 'from home', echo: 'echo' };
/** Finds made in the real-location mode. */
export const FOUND = 'walked';
