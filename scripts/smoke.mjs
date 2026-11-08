// Browser smoke test: serves the production build, opens it in headless Chrome/Edge,
// starts Roam at Greenwich and fails on any uncaught error or console error from the app.
// No extra dependencies: talks to the browser over the DevTools protocol (Node 22+ WebSocket).
//
//   npm run build && npm run smoke            (CHROME_PATH=... to pick a browser)
//   SMOKE_SHOT=shot.png npm run smoke         (also save a screenshot)
//   SMOKE_PATH=/beta/ npm run smoke           (the beta build)
//   SMOKE_SIZE=390,844 SMOKE_OPEN=journal:records   (window size; leave a panel open for the shot)
//   SMOKE_TOUCH=1                             (emulate a phone: touch screen, joystick, phone layout)

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preview } from 'vite';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const browserPath = CANDIDATES.find((p) => existsSync(p));
if (!browserPath) { console.error('smoke: no Chrome/Edge found (set CHROME_PATH)'); process.exit(2); }

const WAIT_MS = +(process.env.SMOKE_WAIT || 25000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a free port each run, so a leftover server or browser can never be picked up by mistake
const freePort = () => new Promise((res) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const PORT = await freePort();
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const profileDir = mkdtempSync(join(tmpdir(), 'ow-smoke-'));
const browser = spawn(browserPath, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  // never pause the game loop (requestAnimationFrame) because the headless window seems hidden
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  `--window-size=${process.env.SMOKE_SIZE || '1280,800'}`, 'about:blank',
], { stdio: 'ignore' });

let failures = [];
let exitCode = 1;
try {
  // the browser writes the port it picked into its profile folder
  let target, debugPort;
  for (let k = 0; k < 75 && !target; k++) {
    try {
      debugPort ||= +readFileSync(join(profileDir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
      target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((t) => t.type === 'page');
    } catch { await sleep(200); }
  }
  if (!target) throw new Error('browser did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      failures.push(`uncaught: ${d.exception?.description || d.text}`);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      failures.push(`console.error: ${text}`);
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  // keep the page in the foreground: a page that thinks it's hidden pauses its game loop
  await send('Page.bringToFront').catch(() => {});
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  // SMOKE_TOUCH=1: behave like a phone (touch screen, coarse pointer: joystick, phone layout)
  if (process.env.SMOKE_TOUCH) {
    const [w, h] = (process.env.SMOKE_SIZE || '390,844').split(',').map(Number);
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  await send('Page.navigate', { url: `http://localhost:${PORT}${process.env.SMOKE_PATH || '/'}?at=51.4779,-0.0015` });

  // wait for the game to start and at least one map area to be built
  const t0 = Date.now();
  let state = null;
  while (Date.now() - t0 < WAIT_MS) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const o = window.openworld; if (!o) return null;
      return { mode: o.game.mode, chunks: [...o.world.readyChunks()].length, pois: [...o.world.pois(o.game.pos?.lat ?? 0, o.game.pos?.lon ?? 0, 800)].length }; })()` });
    state = r.result?.value;
    if (state?.mode === 'roam' && state.chunks > 0 && state.pois > 0) break;
  }
  console.log('smoke state:', JSON.stringify(state));
  if (state?.mode !== 'roam') {
    const page = await send('Runtime.evaluate', { returnByValue: true, expression: `({ url: location.href, title: document.title, body: document.body?.innerText.slice(0, 200) })` });
    failures.push(`game did not enter Roam from ?at= (page: ${JSON.stringify(page.result?.value)})`);
  }
  if (!state?.chunks) console.warn('smoke: warning: no map area loaded (network?)');

  // exercise the main panels once (they must open without throwing)
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
    const click = (id) => document.getElementById(id)?.click();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    if (document.body.classList.contains('clean')) click('ui-toggle');
    await wait(500);
    // beta: the expedition board opens first; close it like a player would
    if (!document.getElementById('quests').hidden) { click('quests-close'); await wait(600); }
    if (!document.getElementById('h-desc').textContent) return 'HUD did not render';
    click('b-journal'); await wait(300);
    // the journal window must stay in one place and size whichever tab is open
    const box = () => { const r = document.querySelector('.card.journal').getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(','); };
    const first = box();
    for (const b of document.querySelectorAll('#journal-tabs button[data-tab]')) {
      document.querySelector('#journal-tabs button[data-tab="' + b.dataset.tab + '"]').click(); await wait(150);
      if (box() !== first) return 'journal window moved on tab ' + b.dataset.tab + ': ' + first + ' -> ' + box();
    }
    click('journal-close'); click('p-settings'); await wait(200); click('set-close');
    click('b-here'); await wait(500); document.getElementById('card-close')?.click();
    // Home: a hint says how to get around (or, with no home base yet, how to set one)
    document.querySelector('#tips .skip')?.click(); await wait(100); // past the first-run tutorial
    const o = window.openworld, tip = document.getElementById('tips');
    const tab = (m) => document.querySelector('.tabs button[data-mode="' + m + '"]');
    tab('home').click(); await wait(300);
    // no home base: Home opens the home base setup (device location or a typed address)
    const hs = document.getElementById('homesetup');
    if (hs.hidden || !document.getElementById('hs-device')) return 'Home without a home base did not open the setup';
    click('hs-later'); await wait(100);
    o.profile.data.home = { lat: o.game.pos.lat, lon: o.game.pos.lon, trust: 'gps', accuracy: 5, source: 'device', setAt: new Date().toISOString() };
    tab('home').click(); await wait(900);
    if (o.game.mode !== 'home') return 'did not enter Home';
    if (tip.hidden || !/wander/.test(tip.textContent)) return 'no Home hint';
    return 'ok'; })()` });
  if (r.result?.value !== 'ok') failures.push(`panel exercise failed: ${JSON.stringify(r)}`);
  await sleep(800);

  // beta expeditions: the board deals quests from the loaded area, one can be accepted, and
  // the card reveal renders (SMOKE_OPEN=quests or =reveal leaves one showing for the shot)
  const qr = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
    const o = window.openworld, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    if (!o.game.features.quests) return 'off';
    for (let k = 0; k < 30 && !o.game.quests.s.offers.some(Boolean); k++) await wait(500);
    const offers = o.game.quests.s.offers.filter(Boolean);
    if (!offers.length) { const s = o.game.quests.s, f0 = o.ctx.renderer.info.render.frame; await wait(1000); return 'no expeditions dealt: ' + JSON.stringify({ framesPerSecond: o.ctx.renderer.info.render.frame - f0, hidden: document.visibilityState, mode: o.game.mode, smode: s.mode, date: s.date, active: s.active, offers: s.offers, tries: o.game.quests._tries, wild: o.game.wild.species.length, ready: o.world.isReadyAt(o.game.pos.lat, o.game.pos.lon), feat: o.game.features }); }
    const want = ${JSON.stringify(process.env.SMOKE_OPEN || '')};
    // a new player: the board has not popped up by itself, and its entry point glows
    if (o.game.quests.s.seen) return 'board was opened before the player chose to';
    if (!document.querySelector('#nearest.qnew')) return 'the never-opened Expedition box is not glowing';
    if (want === 'glow') return 'ok:glow';
    if (want === 'homesetup') { o.profile.data.home = null; o.ctx.homeSetup.open({ reason: '<b>Welcome back!</b> To play from this computer you need a home base.' }); return 'ok:homesetup'; }
    o.ctx.expeditions.open('today'); await wait(300);
    if (!document.querySelector('#quests-body .qwelcome')) return 'no welcome blurb on first open';
    // Give up works from an active quest's card (value-less button attributes once broke it)
    { const q0 = offers.find((x) => !o.game.quests.blocked(x));
      if (q0) {
        const realConfirm = window.confirm; window.confirm = () => true;
        o.game.quests.accept(q0.id); o.ctx.expeditions.render(); await wait(100);
        document.querySelector('#quests-body [data-qabandon]')?.click(); await wait(100);
        window.confirm = realConfirm;
        if (o.game.quests.active()) return 'Give up did nothing';
      }
      // an accepted mystery keeps its clues tucked away behind one button
      const m = offers.find((x) => x.type === 'mystery' && !o.game.quests.blocked(x));
      if (m) {
        o.game.quests.accept(m.id); o.ctx.expeditions.render(); await wait(100);
        if (document.querySelector('#quests-body [data-qclue]')) return 'clue choices showed before asking';
        document.querySelector('#quests-body [data-qclues]')?.click(); await wait(100);
        if (!document.querySelector('#quests-body [data-qclue]')) return 'Get a clue did not show the clues';
        const realConfirm = window.confirm; window.confirm = () => true;
        document.querySelector('#quests-body [data-qabandon]')?.click(); await wait(100);
        window.confirm = realConfirm;
      } }
    if (!document.querySelector('#quests-body .qcard')) return 'board did not render';
    // a quest's rarity badge explains cards (in "How expeditions work")
    document.querySelector('#quests-body [data-qintro]')?.click(); await wait(100);
    document.querySelector('#quests-body .qcard [data-qabout]')?.click(); await wait(400);
    if (!document.querySelector('#quests-body details.qhow[open] #qhow-cards')) return 'rarity badge did not open the card explanation';
    if (want === 'about') return 'ok:about';
    if (want === 'accepted') { const m = o.game.quests.s.offers.find((x) => x?.type === 'mystery'); if (m) { o.game.quests.accept(m.id); o.ctx.expeditions.close(); o.ctx.expeditions.open('today'); await wait(300); document.querySelector('#quests-body .qcard.active')?.scrollIntoView({ block: 'start' }); await wait(300); } }
    else     if (want === 'friends') { o.ctx.expeditions.close(); o.ctx.expeditions.open('friends'); await wait(300); if (!document.querySelector('#quests-body table.lg')) return 'no friends table'; }
    else if (want === 'reveal') { const q = offers.find((x) => x.type !== 'bounty') || offers[0]; o.game.quests.accept(q.id); if (q.type === 'mystery') q.guessRight = true; o.game.quests.complete(q); await wait(2200); }
    else if (want !== 'quests') o.ctx.expeditions.close();
    return 'ok:' + offers.map((x) => x.type).join(','); })()` });
  if (qr.result?.value && !String(qr.result.value).startsWith('ok') && qr.result.value !== 'off') failures.push(`expeditions: ${qr.result.value}`);
  else if (qr.result?.value) console.log(`smoke: expeditions ${qr.result.value}`);

  // returning player on a computer: the start screen is skipped. Without a home base the
  // setup window opens; with one, the game goes straight into Home.
  if (!process.env.SMOKE_TOUCH && !process.env.SMOKE_OPEN) {
    const probe = async (prep) => {
      await send('Runtime.evaluate', { expression: prep });
      await sleep(400);
      await send('Page.navigate', { url: `http://localhost:${PORT}${process.env.SMOKE_PATH || '/'}` });
      await sleep(4000);
      return (await send('Runtime.evaluate', { returnByValue: true, expression: `({ start: !document.getElementById('start').hidden, setup: !document.getElementById('homesetup').hidden, mode: window.openworld?.game.mode || null })` })).result?.value;
    };
    const a = await probe(`(() => { const p = window.openworld.profile; p.data.home = null; p.dirty = true; p.flush(); })()`);
    if (!a || a.start || !a.setup) failures.push(`returning player without a home base: ${JSON.stringify(a)}`);
    const b = await probe(`(() => { const p = window.openworld.profile; p.data.home = { lat: 51.4779, lon: -0.0015, trust: 'gps', accuracy: 5, source: 'device', setAt: new Date().toISOString() }; p.dirty = true; p.flush(); })()`);
    if (!b || b.start || b.mode !== 'home') failures.push(`returning player with a home base: ${JSON.stringify(b)}`);
    else console.log('smoke: returning player skips the start screen (setup without home, Home with one)');
  }

  // SMOKE_OPEN=journal:collections leaves that panel open for the screenshot
  if (process.env.SMOKE_OPEN?.startsWith('journal')) {
    const t = process.env.SMOKE_OPEN.split(':')[1] || 'overview';
    await send('Runtime.evaluate', { expression: `document.getElementById('b-journal').click(); document.querySelector('#journal-tabs button[data-tab="${t}"]')?.click();` });
    await sleep(600);
  }
  if (process.env.SMOKE_SHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(process.env.SMOKE_SHOT, Buffer.from(shot.data, 'base64'));
  }
  // third-party services can be down or rate-limit; only the app's own errors fail the run
  failures = failures.filter((f) => !/Failed to load resource|net::ERR_|status of (4|5)\d\d/.test(f));
  ws.close();
  exitCode = failures.length ? 1 : 0;
} catch (err) {
  failures.push(String(err?.stack || err));
} finally {
  // Chrome/Edge start helper processes; stop the whole tree so nothing is left running
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
  else browser.kill();
  await server.close();
  await sleep(300);
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* locked on Windows: leave it */ }
}
if (failures.length) { console.error('smoke FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
console.log('smoke ok');
process.exit(exitCode);
