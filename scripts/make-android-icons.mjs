#!/usr/bin/env node
// Android launcher icons (adaptive + legacy), splash images and the Play
// listing icon, from the iOS icon's parts. Uses sharp (already a dev
// dependency of the iOS make-icons.mjs). Run from the app root:
//
//   node scripts/make-android-icons.mjs --bg design/android-icon-bg.svg --fg design/android-icon-fg.svg \
//        --icon design/icon-1024.png --splash "#16202B" [--scale 0.72]
//
//   --bg      background layer: an SVG/PNG (full bleed, e.g. just the gradient) or a colour "#rrggbb"
//   --fg      foreground: SVG/PNG with a TRANSPARENT background (the artwork only)
//   --icon    the full square iOS icon (1024): legacy icons and the 512 Play listing icon
//   --splash  splash background colour (the app's backgroundColor)
//   --scale   how much of the 108dp layer the artwork spans (default 0.72). Android masks the layer
//             to a shape at least 66dp across, so artwork beyond ~61% of the layer's width from the
//             centre (radius 33dp of 108) may be clipped by a circle mask. Check the printed radius.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
let bg = opt('--bg'), fg = opt('--fg'), icon = opt('--icon');
const splashColor = opt('--splash', '#000000');
const scale = Number(opt('--scale', '0.72'));
// --svg icons/icon.svg: split an icon whose first full-size <rect> is the background (the usual
// shape of these apps' icons): bg = <defs> + that rect without rounded corners, fg = everything else,
// icon = both, square (Play and the launcher apply their own masks).
const svgFile = opt('--svg');
if (svgFile) {
  const svg = fs.readFileSync(svgFile, 'utf8');
  const vb = (svg.match(/viewBox="0 0 (\d+) (\d+)"/) || [])[1];
  const rect = [...svg.matchAll(/<rect\b[^>]*\/>/g)].map((m) => m[0])
    .find((r) => new RegExp(`width="${vb}"`).test(r) && !/\b(x|y)="[1-9]/.test(r));
  if (!rect) throw new Error(`${svgFile}: no full-size background <rect width="${vb}">`);
  const square = rect.replace(/\srx="[^"]*"/, '').replace(/\sry="[^"]*"/, '');
  const open = svg.match(/<svg\b[^>]*>/)[0].replace(/\swidth="[^"]*"|\sheight="[^"]*"/g, '').replace('<svg', '<svg width="1024" height="1024"');
  const defs = (svg.match(/<defs>[\s\S]*?<\/defs>/) || [''])[0];
  const body = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'));
  bg = Buffer.from(`${open}${defs}${square}</svg>`);
  fg = Buffer.from(`${open}${body.replace(rect, '')}</svg>`);
  icon = Buffer.from(`${open}${body.replace(rect, square)}</svg>`);
}
if (!bg || !fg || !icon) throw new Error('need --svg, or --bg, --fg and --icon');

const res = 'android/app/src/main/res';
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const isColor = (s) => /^#[0-9a-f]{6}$/i.test(s);
const render = (file, size) => sharp(file, { density: 384 }).resize(size, size, { fit: 'fill' }).png().toBuffer();
const solid = (w, h, c) => sharp({ create: { width: w, height: h, channels: 4, background: c } }).png().toBuffer();

// How far the artwork reaches from the centre, as a share of the layer (safe circle: 33/108 = 0.306).
const probe = await sharp(await render(fg, 1024)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let r = 0;
for (let y = 0; y < 1024; y += 2) for (let x = 0; x < 1024; x += 2)
  if (probe.data[(y * 1024 + x) * 4 + 3] > 16) r = Math.max(r, Math.hypot(x - 512, y - 512));
const reach = (r / 1024) * scale;
console.log(`artwork reaches ${(reach * 100).toFixed(1)}% of the layer from the centre (safe: 30.6%)${reach > 0.306 ? '  <-- lower --scale' : ''}`);

async function fgLayer(size) {
  const inner = Math.round(size * scale);
  const art = await render(fg, inner);
  return sharp({ create: { width: size, height: size, channels: 4, background: '#00000000' } })
    .composite([{ input: art, gravity: 'centre' }]).png().toBuffer();
}

for (const [d, k] of Object.entries(dens)) {
  const dir = path.join(res, `mipmap-${d}`);
  fs.mkdirSync(dir, { recursive: true });
  const layer = Math.round(108 * k), legacy = Math.round(48 * k);
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), await fgLayer(layer));
  fs.writeFileSync(path.join(dir, 'ic_launcher_background.png'),
    isColor(bg) ? await solid(layer, layer, bg) : await render(bg, layer));
  const full = await render(icon, legacy);
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), full);
  const circle = Buffer.from(`<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}"/></svg>`);
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'),
    await sharp(full).composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer());
}

// Adaptive icon XML: background from the mipmap PNG (the template points at a colour).
for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  fs.writeFileSync(path.join(res, 'mipmap-anydpi-v26', f), `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`);
}

// Splash images (Capacitor's template ships its own logo): the app colour with the artwork centred.
const splashes = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'splash.png') splashes.push(p); } })(res);
for (const p of splashes) {
  const { width, height } = await sharp(p).metadata();
  const art = await render(fg, Math.round(Math.min(width, height) * 0.4));
  fs.writeFileSync(p, await sharp({ create: { width, height, channels: 4, background: splashColor } })
    .composite([{ input: art, gravity: 'centre' }]).png().toBuffer());
}

// Play listing icon: 512x512 32-bit PNG (Play applies its own mask).
const out = 'fastlane/metadata/android/en-US/images';
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), await sharp(icon).resize(512, 512).ensureAlpha().png().toBuffer());
console.log(`wrote launcher icons (${Object.keys(dens).length} densities), ${splashes.length} splash images, ${out}/icon.png`);
