// Open elevation: AWS Terrain Tiles (Terrarium encoding, Mapzen/Tilezen, public dataset).
// height = R*256 + G + B/256 - 32768 (metres, roughly orthometric / above sea level).

import { lonToTileX, latToTileY } from '../geo.js';
import { request } from './net.js';

const Z = 13; // ~19 m/px at the equator; plenty for "simplified terrain"
const URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

const tiles = new Map(); // "x/y" -> Float32Array(256*256) | null (failed); insertion order = recency
const MAX_TILES = 48;     // ~12 MB; older tiles are dropped (re-fetched from the HTTP cache if needed)
function touch(key) { const v = tiles.get(key); tiles.delete(key); tiles.set(key, v); }
function evict() { while (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value); }
const pending = new Map();

async function loadTile(x, y) {
  const key = `${x}/${y}`;
  if (tiles.has(key)) { touch(key); return; }
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    try {
      const res = await request(URL(Z, x, y), { init: { mode: 'cors' }, retries: 1 });
      const bmp = await createImageBitmap(await res.blob());
      const c = new OffscreenCanvas(256, 256);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const px = g.getImageData(0, 0, 256, 256).data;
      const h = new Float32Array(256 * 256);
      for (let k = 0; k < h.length; k++) {
        h[k] = px[k * 4] * 256 + px[k * 4 + 1] + px[k * 4 + 2] / 256 - 32768;
      }
      tiles.set(key, h);
      evict();
    } catch (err) {
      console.warn('terrain tile failed', key, err);
      tiles.set(key, null); // flat fallback
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, p);
  return p;
}

export async function ensureTerrain(b) {
  const x0 = Math.floor(lonToTileX(b.w, Z)), x1 = Math.floor(lonToTileX(b.e, Z));
  const y0 = Math.floor(latToTileY(b.n, Z)), y1 = Math.floor(latToTileY(b.s, Z));
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(loadTile(x, y));
  await Promise.all(jobs);
}

function sample(tile, px, py) {
  px = Math.min(255, Math.max(0, px));
  py = Math.min(255, Math.max(0, py));
  return tile[py * 256 + px];
}

// Bilinear height at lat/lon. Returns null if the covering tile hasn't been fetched.
export function heightAt(lat, lon) {
  const fx = lonToTileX(lon, Z), fy = latToTileY(lat, Z);
  const tx = Math.floor(fx), ty = Math.floor(fy);
  const key = `${tx}/${ty}`;
  if (!tiles.has(key)) return null;
  const t = tiles.get(key);
  if (!t) return 0;
  const px = (fx - tx) * 256 - 0.5, py = (fy - ty) * 256 - 0.5;
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const ax = px - x0, ay = py - y0;
  // (edges clamp within the tile; good enough for an abstract world)
  const h00 = sample(t, x0, y0), h10 = sample(t, x0 + 1, y0);
  const h01 = sample(t, x0, y0 + 1), h11 = sample(t, x0 + 1, y0 + 1);
  return (h00 * (1 - ax) + h10 * ax) * (1 - ay) + (h01 * (1 - ax) + h11 * ax) * ay;
}

export function heightOr(lat, lon, fallback = 0) {
  const h = heightAt(lat, lon);
  return h === null ? fallback : h;
}
