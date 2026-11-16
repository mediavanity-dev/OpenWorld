// Builds www/, the copy of the game that Capacitor bundles into the iPhone app.
//  - The same Vite build as the website, written to www/ instead of dist/.
//  - No service worker or web manifest: every file is already on the device.
//  - Fails if a remote script or stylesheet slipped into the page (the app must start offline),
//    or if any analytics appeared (the app collects nothing).
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
rmSync(out, { recursive: true, force: true });
execSync('npx vite build --outDir www --emptyOutDir', { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_CHANNEL: 'stable' } });

for (const f of ['sw.js', 'manifest.webmanifest']) if (existsSync(join(out, f))) rmSync(join(out, f));
let html = readFileSync(join(out, 'index.html'), 'utf8');
html = html.replace(/\s*<link rel="manifest"[^>]*>/, '');
if (/<(script|link)[^>]+(src|href)="https?:/i.test(html)) throw new Error('index.html loads a remote script or stylesheet; the app must work offline');
writeFileSync(join(out, 'index.html'), html);
for (const f of readdirSync(join(out, 'assets'))) {
  const s = readFileSync(join(out, 'assets', f), 'utf8');
  if (/googletagmanager|google-analytics|gtag\(|plausible\.io|fonts\.googleapis/.test(s)) throw new Error(`analytics or a remote font in ${f}; refusing to build`);
}
console.log('Built www/');
