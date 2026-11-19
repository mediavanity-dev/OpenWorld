// App Store screenshots (iPhone 6.9", 1320×2868): each scene is staged in the real game by the
// smoke harness (headless Chrome, phone layout, 3× pixels), then framed with a caption here.
//   npm run build && node scripts/store-shots.mjs        → fastlane/screenshots/en-US/*.png
//   SHOTS=board,reveal node scripts/store-shots.mjs       (just some)
// Scenes play in Walk mode at a daytime spot (Sydney's Royal Botanic Garden) so the world is lit.
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'fastlane', 'screenshots', 'en-US');
const raw = join(tmpdir(), 'oe-shots');
mkdirSync(out, { recursive: true }); mkdirSync(raw, { recursive: true });

const AT = '{ lat: -33.8655, lon: 151.2155 }'; // Royal Botanic Garden, Sydney
const SETUP = `
  const o = window.openworld, g = o.game, q = g.quests, ctx = o.ctx, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('#tips .skip')?.click();
  ctx.settings.weatherFx = false; g.dataSaver = false;
  // Walk mode, as a player outdoors sees it (a steady device fix at the spot)
  const at = ${AT}; g.setFix({ ...at, accuracy: 5, source: 'device', t: Date.now() }); g.enter('present'); ctx.avatar.style(); ctx.environment.refresh(at.lat, at.lon); await wait(9000);
  const css = document.createElement('style'); css.textContent = '#w-status{display:none!important}'; document.head.appendChild(css);
  for (let k = 0; k < 40 && !q.s.offers.filter(Boolean).length; k++) await wait(500);
  q.s.seen = true; for (const id of ['find']) document.getElementById(id).hidden = true;
  const hideFind = () => { document.getElementById('find').hidden = true; for (const t of document.querySelectorAll('.toast')) t.remove(); };
`;
// scene: [file, headline, accent, subline, staging JS]
const SCENES = [
  ['1-explore', 'Your street, turned into', 'expeditions', 'Riddles, wildlife and races built from the real world around you', `
    const r = q.make('race') || q.s.offers.find((x) => x?.type === 'race'); if (r) { if (!q.s.offers.includes(r)) q.s.offers.push(r); q.accept(r.id); r.startedAt = Date.now() - 20000; }
    ctx.controls.dist = 45; ctx.controls.pitch = 0.62; await wait(2500); hideFind();`],
  ['2-board', 'Three new expeditions', 'every day', 'A riddle, a wanted animal and a race, dealt fresh where you are', `
    ctx.expeditions.open('today'); await wait(800); for (const el of document.querySelectorAll('#quests, #quests *')) el.scrollTop = 0; await wait(300); hideFind();`],
  ['3-bounty', 'Track animals', 'really seen near you', 'Every species is real: recorded nearby by naturalists', `
    for (let k = 0; k < 30 && !g.wild?.species?.length; k++) await wait(500);
    const b = q.make('bounty'); if (b) { q.s.offers.push(b); q.accept(b.id); for (let k = 0; k < 6; k++) { g.tick(0.5, null); await wait(60); } if (!b.inHabitat) { b.inHabitat = true; q.emit('quest-habitat', null, { quest: b }); q.notes(b, b.habitat?.hab || 'park'); } }
    for (let k = 0; k < 20 && !(b?.notes); k++) await wait(300); q.emit('quest-dealt', null); await wait(800); hideFind();`],
  ['4-card', 'Collect cards for', 'real finds', 'The rarer the real thing, the rarer the card', `
    const m = q.make('mystery'); q.s.offers.push(m); q.accept(m.id); await q.enrich(m); await wait(1500);
    m.place.year ||= 1816; m.rarity = 'epic'; m.guessRight = true;
    q.complete(m); await wait(3500); hideFind();`],
  ['5-wildlife', 'Find every species', 'around you', 'Silhouettes until you find them, from birds to fungi', `
    for (let k = 0; k < 30 && !g.wild?.species?.length; k++) await wait(500);
    for (const s of g.wild.species.filter((x) => x.group === 'Aves' && x.photo).slice(0, 4)) o.profile.data.species[s.id] = { name: s.name, sci: s.sci, group: s.group, grade: 'present', first: new Date().toISOString(), sightings: 1 };
    ctx.openJournal('collections'); await wait(2500); hideFind();`],
  ['6-quiz', 'Learn as you', 'explore', 'Quick challenges: name the bird, date the building, age the rock', `
    for (let k = 0; k < 30 && !g.wild?.species?.length; k++) await wait(500);
    const sp = g.wild.species.find((s) => s.group === 'Aves' && s.photo) || g.wild.species.find((s) => s.photo);
    for (const t of document.querySelectorAll('.toast')) t.remove();
    ctx.finds.quizSpecies(sp, () => {}); ctx.controls.dist = 30; await wait(2500);`],
];
const want = (process.env.SHOTS || '').split(',').filter(Boolean);

const W = 1320, H = 2868, PAD = 90;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
for (const [file, head, accent, sub, js] of SCENES) {
  if (want.length && !want.some((w) => file.includes(w))) continue;
  const shot = join(raw, `${file}.png`);
  if (existsSync(shot)) rmSync(shot);
  const r = spawnSync(process.execPath, ['scripts/smoke.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 240000,
    env: { ...process.env, SMOKE_TOUCH: '1', SMOKE_DPR: '3', SMOKE_SIZE: '440,956', SMOKE_OPEN: 'x', SMOKE_WAIT: '40000', SMOKE_SHOT: shot, SMOKE_EVAL_WAIT: '600', SMOKE_EVAL: `(async () => { ${SETUP} ${js} return 'ok'; })()` },
  });
  if (!existsSync(shot)) { console.error(`${file}: no capture\n${(r.stdout || '').slice(-600)}${(r.stderr || '').slice(-600)}`); continue; }
  // frame: caption on top, the app below with rounded corners and a soft border
  const appW = 1080, appH = Math.round(appW * 956 / 440), top = H - appH - PAD;
  const caption = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${top}">
    <text x="${W / 2}" y="${top * 0.44}" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-weight="800" font-size="86" fill="#eef1f4">${esc(head)}</text>
    <text x="${W / 2}" y="${top * 0.44 + 104}" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-weight="800" font-size="86" fill="#ffb84d">${esc(accent)}</text>
    <text x="${W / 2}" y="${top * 0.44 + 200}" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="44" fill="#a5adb7">${esc(sub)}</text></svg>`);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${appW}" height="${appH}"><rect width="${appW}" height="${appH}" rx="64" ry="64"/></svg>`);
  const app = await sharp(shot).resize(appW, appH).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const border = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${appW + 12}" height="${appH + 12}"><rect x="3" y="3" width="${appW + 6}" height="${appH + 6}" rx="68" ry="68" fill="none" stroke="#3a4250" stroke-width="6"/></svg>`);
  await sharp({ create: { width: W, height: H, channels: 3, background: '#12161c' } })
    .composite([{ input: caption, left: 0, top: 0 }, { input: border, left: (W - appW) / 2 - 6, top: top - 6 }, { input: app, left: (W - appW) / 2, top }])
    .removeAlpha().png().toFile(join(out, `${file}.png`));
  console.log(`${file}: ok`);
}
console.log(readdirSync(out).join(', '));
