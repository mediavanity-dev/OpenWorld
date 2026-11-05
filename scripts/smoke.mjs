// Browser smoke test: serves the production build, opens it in headless Chrome/Edge,
// starts Roam at Greenwich and fails on any uncaught error or console error from the app.
// No extra dependencies: talks to the browser over the DevTools protocol (Node 22+ WebSocket).
//
//   npm run build && npm run smoke            (CHROME_PATH=... to pick a browser)
//   SMOKE_SHOT=shot.png npm run smoke         (also save a screenshot)
//   SMOKE_PATH=/beta/ npm run smoke           (the beta build)

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
  '--window-size=1280,800', 'about:blank',
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
    if (!document.getElementById('h-desc').textContent) return 'HUD did not render';
    click('b-journal'); await wait(300); click('journal-close'); click('p-settings'); await wait(200); click('set-close');
    click('b-here'); await wait(500); document.getElementById('card-close')?.click();
    return 'ok'; })()` });
  if (r.result?.value !== 'ok') failures.push(`panel exercise failed: ${JSON.stringify(r)}`);
  await sleep(800);

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
