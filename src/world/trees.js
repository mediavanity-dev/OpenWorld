// Tree appearance + instance packing, shared by the chunk worker (procedural woodland)
// and the main thread (real OSM trees from the detail layer). No three.js dependency.

export function hsl(h, s, l) {
  const k = (n) => (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

// type: 'deciduous' | 'evergreen-broad' | 'evergreen-needle'
export function treeType(leaf, cycle) {
  if (leaf === 'needleleaved') return 'evergreen-needle';
  if (cycle === 'evergreen') return 'evergreen-broad';
  return 'deciduous';
}

export function treeInstance(x, ground, z, radius, type, season, rand) {
  let color, scale = 1;
  const r = rand();
  if (type === 'evergreen-needle') color = hsl(0.36, 0.35, 0.24 + r * 0.06);
  else if (type === 'evergreen-broad' || season === 'tropical') color = hsl(0.3, 0.45, 0.28 + r * 0.08);
  else if (season === 'spring') color = r < 0.08 ? hsl(0.95, 0.6, 0.82) : hsl(0.27, 0.5, 0.42 + r * 0.08);
  else if (season === 'summer') color = hsl(0.29, 0.4, 0.3 + r * 0.08);
  else if (season === 'autumn') color = [hsl(0.08, 0.7, 0.5), hsl(0.03, 0.62, 0.45), hsl(0.12, 0.72, 0.52), hsl(0.07, 0.45, 0.35), hsl(0.25, 0.35, 0.35)][Math.floor(r * 5)];
  else { color = hsl(0.08, 0.12, 0.5 + r * 0.08); scale = 0.62; } // winter: bare, smaller crown
  return { x, ground, z, radius: radius * scale, trunkH: radius * 1.1, color, cone: type === 'evergreen-needle' };
}

// -> { n, mat: Float32Array(n*16), col: Float32Array(n*3), trunk: Float32Array(n*16) } or null
export function packTrees(list) {
  if (!list.length) return null;
  const n = list.length, mat = new Float32Array(n * 16), col = new Float32Array(n * 3), trunk = new Float32Array(n * 16);
  list.forEach((t, k) => {
    const o = k * 16;
    const sy = t.cone ? t.radius * 2.4 : t.radius * 1.2;
    const cy = t.cone ? t.ground + t.trunkH * 0.5 + sy * 0.5 : t.ground + t.trunkH + t.radius * 0.8;
    mat[o] = t.radius; mat[o + 5] = sy; mat[o + 10] = t.radius; mat[o + 12] = t.x; mat[o + 13] = cy; mat[o + 14] = t.z; mat[o + 15] = 1;
    col[k * 3] = t.color[0]; col[k * 3 + 1] = t.color[1]; col[k * 3 + 2] = t.color[2];
    const tw = Math.max(1, t.radius * 0.6);
    trunk[o] = tw; trunk[o + 5] = t.trunkH + t.radius * 0.5; trunk[o + 10] = tw; trunk[o + 12] = t.x; trunk[o + 13] = t.ground - 0.3; trunk[o + 14] = t.z; trunk[o + 15] = 1;
  });
  return { n, mat, col, trunk };
}
