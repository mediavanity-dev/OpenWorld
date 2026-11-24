#!/usr/bin/env node
// The Play listing's feature graphic (1024x500, 24-bit PNG, no alpha: answer/9866151):
// the icon's background stretched across, the artwork on the left, the app name and the
// short description on the right. Run from the app root:
//
//   node scripts/make-feature-graphic.mjs --svg icons/icon.svg
//   node scripts/make-feature-graphic.mjs --bg design/android-icon-bg.svg --fg design/android-icon-fg.svg
//   [--title "Name"] [--tagline "..."]   (default: the Play title.txt / short_description.txt)
//
// Writes fastlane/metadata/android/en-US/images/featureGraphic.png. Look at it before uploading.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const meta = 'fastlane/metadata/android/en-US';
const readMeta = (f) => { try { return fs.readFileSync(path.join(meta, f), 'utf8').trim(); } catch { return ''; } };
const title = opt('--title', readMeta('title.txt').split(':')[0]);
const tagline = opt('--tagline', readMeta('short_description.txt'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

let bg, fg;
const svgFile = opt('--svg');
if (svgFile) {
  const svg = fs.readFileSync(svgFile, 'utf8');
  const vb = (svg.match(/viewBox="0 0 (\d+) (\d+)"/) || [])[1];
  const rect = [...svg.matchAll(/<rect\b[^>]*\/>/g)].map((m) => m[0])
    .find((r) => new RegExp(`width="${vb}"`).test(r) && !/\b(x|y)="[1-9]/.test(r));
  if (!rect) throw new Error(`${svgFile}: no full-size background <rect>`);
  const open = svg.match(/<svg\b[^>]*>/)[0].replace(/\swidth="[^"]*"|\sheight="[^"]*"/g, '').replace('<svg', '<svg width="1024" height="1024"');
  const defs = (svg.match(/<defs>[\s\S]*?<\/defs>/) || [''])[0];
  const body = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'));
  bg = Buffer.from(`${open}${defs}${rect.replace(/\srx="[^"]*"/, '')}</svg>`);
  fg = Buffer.from(`${open}${body.replace(rect, '')}</svg>`);
} else {
  bg = fs.readFileSync(opt('--bg')); fg = fs.readFileSync(opt('--fg'));
}

const W = 1024, H = 500;
const back = await sharp(bg, { density: 300 }).resize(W, H, { fit: 'cover' }).png().toBuffer();
// Text colour from the background's brightness
const { channels } = await sharp(back).stats();
const lum = 0.2126 * channels[0].mean + 0.7152 * channels[1].mean + 0.0722 * channels[2].mean;
const ink = lum > 150 ? '#1d1d1f' : '#ffffff', soft = lum > 150 ? '#3a3a3c' : 'rgba(255,255,255,0.82)';
const art = await sharp(fg, { density: 300 }).resize(380, 380).png().toBuffer();

// Wrap the tagline at ~30 characters per line, two lines at most
const words = tagline.split(/\s+/); const lines = [''];
for (const w of words) { if ((lines.at(-1) + ' ' + w).trim().length > 30 && lines.length < 2) lines.push(w); else lines[lines.length - 1] = (lines.at(-1) + ' ' + w).trim(); }
// Title: one line if it fits, else two balanced lines; the size shrinks to fit 510px (bold ≈ 0.58em/char).
const tw = title.split(/\s+/); let tl = [title];
if (title.length > 15 && tw.length > 1) {
  let best = null;
  for (let i = 1; i < tw.length; i++) {
    const a = tw.slice(0, i).join(' '), b = tw.slice(i).join(' ');
    if (!best || Math.max(a.length, b.length) < Math.max(best[0].length, best[1].length)) best = [a, b];
  }
  tl = best;
}
const size = Math.min(68, Math.floor(510 / (0.58 * Math.max(...tl.map((l) => l.length)))));
const block = tl.length * size * 1.1 + 20 + lines.length * 42;
let y = (H - block) / 2 + size;
const font = 'font-family="Segoe UI, Roboto, Arial, sans-serif"';
const parts = [];
for (const l of tl) { parts.push(`<text x="470" y="${y}" ${font} font-weight="700" font-size="${size}" fill="${ink}">${esc(l)}</text>`); y += size * 1.1; }
y += 20 - size * 0.1 + 6;
for (const l of lines) { parts.push(`<text x="472" y="${y}" ${font} font-size="32" fill="${soft}">${esc(l)}</text>`); y += 42; }
const text = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`);

fs.mkdirSync(path.join(meta, 'images'), { recursive: true });
const out = path.join(meta, 'images', 'featureGraphic.png');
await sharp(back).composite([{ input: art, left: 60, top: 60 }, { input: text }]).flatten({ background: '#000' })
  .removeAlpha().png().toFile(out);
console.log('wrote', out);
