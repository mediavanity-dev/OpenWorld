#!/usr/bin/env node
// Copies the iOS fastlane listing into fastlane/metadata/android/en-US/ with
// Google Play's limits checked (answer/9859152, answer/9866151):
//   name.txt        -> title.txt              (≤30)
//   subtitle.txt    -> short_description.txt  (≤80, no emoji)  [or promotional_text.txt if longer fits better]
//   description.txt -> full_description.txt   (≤4,000)
//   release_notes   -> changelogs/default.txt (≤500)
// Apple-only wording is flagged, not rewritten: edit the Android copies by hand.
// Usage, from the app root: node scripts/ios-to-play-metadata.mjs
import fs from 'node:fs';
import path from 'node:path';

const src = 'fastlane/metadata/en-US';
const dst = 'fastlane/metadata/android/en-US';
const rd = (f) => { try { return fs.readFileSync(path.join(src, f), 'utf8').trim(); } catch { return ''; } };
const problems = [];
const out = {};

out['title.txt'] = rd('name.txt');
out['short_description.txt'] = rd('subtitle.txt') || rd('promotional_text.txt');
out['full_description.txt'] = rd('description.txt');
const notes = rd('release_notes.txt');
if (notes) out['changelogs/default.txt'] = notes;

const limits = { 'title.txt': 30, 'short_description.txt': 80, 'full_description.txt': 4000, 'changelogs/default.txt': 500 };
for (const [f, max] of Object.entries(limits)) {
  const s = out[f]; if (s == null) continue;
  const n = [...s].length;
  if (!s) problems.push(`${f}: empty`);
  if (n > max) problems.push(`${f}: ${n} characters, Play allows ${max}`);
}
if (/\p{Extended_Pictographic}/u.test(out['short_description.txt'])) problems.push('short_description.txt: emoji not allowed');
for (const [f, s] of Object.entries(out)) {
  const hits = s.match(/\b(App Store|iPhone|iPad|iOS|Apple|TestFlight|Family Sharing|Face ID)\b/g);
  if (hits) problems.push(`${f}: Apple wording to change: ${[...new Set(hits)].join(', ')}`);
}

for (const [f, s] of Object.entries(out)) {
  const p = path.join(dst, f);
  if (fs.existsSync(p)) { console.log(`kept existing ${p}`); continue; }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s + '\n');
  console.log(`wrote ${p}`);
}
if (problems.length) { console.log('\nTo fix:\n- ' + problems.join('\n- ')); process.exitCode = 1; }
console.log('\nStill needed: images/icon.png (512x512), images/featureGraphic.png (1024x500), images/phoneScreenshots/ (2-8, 9:16, no iPhone frames).');
