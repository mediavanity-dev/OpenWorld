// @ts-check
// How well does the live camera view line up with an old photo? Both are reduced to small
// greyscale images, turned into edge maps (outlines of buildings, rooflines, kerbs: the
// things that survive a century, unlike colour, light and film grain), and compared with
// normalised cross-correlation. Pure functions on plain arrays, so they can be tested.

/** RGBA bytes -> greyscale [0, 1]. @param {Uint8ClampedArray | number[]} rgba */
export function toGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;
  return g;
}

/** Sobel gradient magnitude (border pixels 0). @param {Float32Array} g */
export function edges(g, w, h) {
  const e = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      e[i] = Math.hypot(gx, gy);
    }
  }
  return e;
}

/** Normalised cross-correlation in [-1, 1] (0 when either image is flat). */
export function ncc(a, b) {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da > 1e-9 && db > 1e-9 ? num / Math.sqrt(da * db) : 0;
}

/**
 * Match score 0..100 between two same-size RGBA images.
 * Random pairs of real photos land around 0-15; a careful line-up of the same scene, 50+.
 */
export function matchScore(rgbaA, rgbaB, w, h) {
  const r = ncc(edges(toGray(rgbaA, w, h), w, h), edges(toGray(rgbaB, w, h), w, h));
  return Math.round(Math.max(0, Math.min(1, (r - 0.05) / 0.4)) * 100);
}
export const GOOD_MATCH = 50;

/**
 * Where an image shown with object-fit: contain sits on a W x H screen, and which part of a
 * video shown with object-fit: cover lies under it (in video pixels).
 */
export function overlayRegion(W, H, iw, ih, vw, vh) {
  const s = Math.min(W / iw, H / ih), gw = iw * s, gh = ih * s, gx = (W - gw) / 2, gy = (H - gh) / 2;
  const k = Math.max(W / vw, H / vh), ox = (W - vw * k) / 2, oy = (H - vh * k) / 2;
  return { screen: { x: gx, y: gy, w: gw, h: gh }, video: { x: (gx - ox) / k, y: (gy - oy) / k, w: gw / k, h: gh / k } };
}
