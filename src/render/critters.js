// Creatures in the world: a small low-poly figure for each kind of life (bird, insect, mammal,
// frog, lizard, fish, snail, spider, plant, mushroom) with a little motion of its own and a
// soft glow, in the same simple style as the explorer and the blob trees. The real species is
// on its card; the figure only says what kind of thing it is. Taps hit an invisible sphere
// around it, so small figures stay easy to tap.

import * as THREE from 'three';
import { GROUP_STYLE } from '../data/wildlife.js';

const lam = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: new THREE.Color(color).multiplyScalar(0.18) });
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
const shade = (hex, k) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;

/**
 * One figure per group. Each returns { g, anim(t), fly } where fly = it floats and bobs.
 * Sizes are roughly 1–1.6 m: larger than life, so they read on a phone screen.
 * @param {string} group  iNaturalist iconic group
 * @param {string} [season]  'spring' | 'summer' | 'autumn' | 'winter' where it is (plants only)
 */
export function figureFor(group, season = 'summer') {
  const col = GROUP_STYLE[group]?.color || '#5fd08a';
  const main = lam(col), dark = lam(shade(col, 0.55)), light = lam(shade(col, 1.35));
  const g = new THREE.Group();
  let anim = () => {};
  let fly = false;
  switch (group) {
    case 'Aves': { // a round bird with flapping wings and an orange beak
      fly = true;
      const body = mesh(new THREE.IcosahedronGeometry(0.45, 1), main); body.scale.set(0.8, 0.75, 1.1);
      const head = mesh(new THREE.IcosahedronGeometry(0.27, 1), main, 0, 0.32, -0.42);
      const beak = mesh(new THREE.ConeGeometry(0.08, 0.26, 6), lam('#f2a33a'), 0, 0.3, -0.72); beak.rotation.x = -Math.PI / 2;
      const tail = mesh(new THREE.ConeGeometry(0.18, 0.4, 4), dark, 0, 0.05, 0.55); tail.rotation.x = Math.PI / 2.4;
      const wing = (s) => { const p = new THREE.Group(); p.position.set(s * 0.3, 0.12, 0); const w = mesh(new THREE.BoxGeometry(0.75, 0.05, 0.42), dark, s * 0.36, 0, 0); p.add(w); return p; };
      const wl = wing(-1), wr = wing(1);
      g.add(body, head, beak, tail, wl, wr);
      anim = (t) => { const f = Math.sin(t / 90) * 0.7; wl.rotation.z = -f; wr.rotation.z = f; };
      break;
    }
    case 'Insecta': { // a butterfly: four fluttering wings on a slim body
      fly = true;
      const body = mesh(new THREE.CapsuleGeometry(0.06, 0.55, 3, 6), lam('#3a3226')); body.rotation.x = Math.PI / 2;
      const wingGeo = new THREE.CircleGeometry(0.42, 6);
      const half = (s) => {
        const p = new THREE.Group();
        const f = mesh(wingGeo, main, s * 0.36, 0, -0.14); f.rotation.x = -Math.PI / 2;
        const b = mesh(new THREE.CircleGeometry(0.28, 6), light, s * 0.26, 0, 0.24); b.rotation.x = -Math.PI / 2;
        f.material.side = b.material.side = THREE.DoubleSide;
        p.add(f, b); return p;
      };
      const l = half(-1), r = half(1);
      g.add(body, l, r);
      anim = (t) => { const f = 0.25 + Math.abs(Math.sin(t / 70)) * 1.1; l.rotation.z = f; r.rotation.z = -f; };
      break;
    }
    case 'Arachnida': { // a spider: round body, eight legs
      const body = mesh(new THREE.IcosahedronGeometry(0.28, 1), dark, 0, 0.32, -0.12);
      const abdomen = mesh(new THREE.IcosahedronGeometry(0.4, 1), main, 0, 0.38, 0.32);
      g.add(body, abdomen);
      const legs = [];
      for (let k = 0; k < 8; k++) {
        const s = k < 4 ? -1 : 1, i = k % 4;
        // each leg pivots at the body and splays out sideways, front legs forward, back legs back
        const leg = new THREE.Group(); leg.position.set(s * 0.12, 0.3, -0.2 + i * 0.12);
        const seg = mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.7, 4), dark, s * 0.3, -0.08, 0); seg.rotation.z = s * 1.2;
        leg.add(seg); leg.rotation.y = (i - 1.5) * -0.45 * s;
        legs.push(leg); g.add(leg);
      }
      anim = (t) => legs.forEach((l, k) => { l.position.y = 0.3 + Math.max(0, Math.sin(t / 120 + k * 1.3)) * 0.05; });
      break;
    }
    case 'Mammalia': { // a small four-legged animal with ears and a tail
      const body = mesh(new THREE.CapsuleGeometry(0.3, 0.55, 3, 8), main, 0, 0.62, 0); body.rotation.x = Math.PI / 2;
      const head = mesh(new THREE.IcosahedronGeometry(0.26, 1), main, 0, 0.82, -0.6);
      const snout = mesh(new THREE.ConeGeometry(0.12, 0.25, 6), light, 0, 0.78, -0.85); snout.rotation.x = -Math.PI / 2;
      const ear = (s) => mesh(new THREE.ConeGeometry(0.08, 0.2, 4), dark, s * 0.14, 1.05, -0.58);
      const tail = mesh(new THREE.ConeGeometry(0.1, 0.6, 6), dark, 0, 0.75, 0.62); tail.rotation.x = Math.PI / 2.8;
      const legs = [[-0.17, -0.3], [0.17, -0.3], [-0.17, 0.3], [0.17, 0.3]].map(([x, z]) => { const l = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.45, 5), dark, x, 0.24, z); return l; });
      g.add(body, head, snout, ear(-1), ear(1), tail, ...legs);
      anim = (t) => { const s = Math.sin(t / 130) * 0.4; legs[0].rotation.x = legs[3].rotation.x = s; legs[1].rotation.x = legs[2].rotation.x = -s; tail.rotation.y = Math.sin(t / 300) * 0.5; };
      break;
    }
    case 'Reptilia': { // a low lizard that wiggles
      const body = mesh(new THREE.CapsuleGeometry(0.16, 0.6, 3, 6), main, 0, 0.2, 0); body.rotation.x = Math.PI / 2; body.scale.set(1.2, 1, 0.7);
      const head = mesh(new THREE.ConeGeometry(0.17, 0.38, 6), main, 0, 0.2, -0.6); head.rotation.x = -Math.PI / 2;
      const tail = mesh(new THREE.ConeGeometry(0.13, 0.9, 6), dark, 0, 0.18, 0.85); tail.rotation.x = Math.PI / 2;
      const legs = [[-1, -0.25], [1, -0.25], [-1, 0.28], [1, 0.28]].map(([s, z]) => { const l = mesh(new THREE.BoxGeometry(0.32, 0.06, 0.08), dark, s * 0.25, 0.1, z); return l; });
      g.add(body, head, tail, ...legs);
      anim = (t) => { g.rotation.y = (g.userData.yaw || 0) + Math.sin(t / 220) * 0.18; tail.rotation.y = Math.sin(t / 220 + 1) * 0.4; };
      break;
    }
    case 'Amphibia': { // a squat frog that hops now and then
      const body = mesh(new THREE.IcosahedronGeometry(0.42, 1), main, 0, 0.32, 0); body.scale.set(1.1, 0.7, 1);
      const eye = (s) => mesh(new THREE.IcosahedronGeometry(0.11, 0), light, s * 0.2, 0.6, -0.28);
      const leg = (s) => { const l = mesh(new THREE.CapsuleGeometry(0.09, 0.3, 3, 5), dark, s * 0.38, 0.14, 0.18); l.rotation.x = Math.PI / 2; l.rotation.z = s * 0.4; return l; };
      g.add(body, eye(-1), eye(1), leg(-1), leg(1));
      anim = (t) => { const p = (t / 1400) % 1; g.position.y = p < 0.25 ? Math.sin((p / 0.25) * Math.PI) * 0.45 : 0; };
      break;
    }
    case 'Actinopterygii': { // a fish that leaps in an arc
      const body = mesh(new THREE.IcosahedronGeometry(0.35, 1), main); body.scale.set(0.55, 0.8, 1.4);
      const tail = mesh(new THREE.ConeGeometry(0.28, 0.4, 3), dark, 0, 0, 0.6); tail.rotation.x = -Math.PI / 2; tail.rotation.y = Math.PI / 2;
      g.add(body, tail);
      anim = (t) => { const p = (t / 1800) % 1; g.position.y = Math.max(0, Math.sin(p * Math.PI * 2)) * 0.9; g.rotation.x = Math.cos(p * Math.PI * 2) * 0.6; };
      break;
    }
    case 'Mollusca': { // a snail with a spiral shell
      const foot = mesh(new THREE.CapsuleGeometry(0.13, 0.7, 3, 6), lam('#c9b48a'), 0, 0.13, 0); foot.rotation.x = Math.PI / 2;
      // a round shell with a darker spiral ring on each side, so it reads from any angle
      const shell = mesh(new THREE.IcosahedronGeometry(0.3, 1), main, 0, 0.44, 0.08); shell.scale.set(0.75, 1, 1);
      const ringGeo = new THREE.TorusGeometry(0.15, 0.04, 5, 12);
      const ringL = mesh(ringGeo, dark, -0.22, 0.46, 0.08), ringR = mesh(ringGeo, dark, 0.22, 0.46, 0.08);
      ringL.rotation.y = ringR.rotation.y = Math.PI / 2;
      const core = mesh(new THREE.IcosahedronGeometry(0.07, 0), dark, 0.24, 0.46, 0.08);
      const stalk = (s) => mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.25, 4), lam('#c9b48a'), s * 0.06, 0.3, -0.42);
      g.add(foot, shell, ringL, ringR, core, stalk(-1), stalk(1));
      anim = (t) => { foot.scale.z = 1 + Math.sin(t / 500) * 0.06; };
      break;
    }
    case 'Plantae': { // a stem that follows the local season (see plantSeason)
      const stem = mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.1, 5), season === 'winter' ? lam('#7a5a3c') : main, 0, 0.55, 0);
      const leafMat = season === 'autumn' ? null : season === 'spring' ? lam('#9be07a') : main;
      const AUTUMN = ['#e0672a', '#f2a33a', '#c8402e'];
      const leaf = (s, y, k) => { const l = mesh(new THREE.IcosahedronGeometry(0.16, 0), leafMat || lam(AUTUMN[k % 3]), s * 0.17, y, 0); l.scale.set(1.6, 0.35, 0.8); return l; };
      g.add(stem);
      if (season === 'winter') { // a bare twig: a side shoot and a couple of closed buds
        const shoot = mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.4, 4), lam('#7a5a3c'), 0.12, 0.75, 0); shoot.rotation.z = -0.7;
        g.add(shoot, mesh(new THREE.IcosahedronGeometry(0.06, 0), lam('#a0603a'), 0, 1.12, 0), mesh(new THREE.IcosahedronGeometry(0.05, 0), lam('#a0603a'), 0.25, 0.9, 0));
      } else if (season === 'spring') { // fresh small leaves and fat green buds
        const l1 = leaf(-1, 0.5, 0), l2 = leaf(1, 0.75, 1); l1.scale.multiplyScalar(0.7); l2.scale.multiplyScalar(0.7);
        g.add(l1, l2, mesh(new THREE.IcosahedronGeometry(0.1, 0), lam('#7cc85a'), 0, 1.13, 0), mesh(new THREE.IcosahedronGeometry(0.07, 0), lam('#f2a7c8'), 0, 1.22, 0));
      } else if (season === 'autumn') { // turning leaves, one falling, and a seed head
        const fall = leaf(1, 0.2, 2); fall.position.x = 0.35;
        g.add(leaf(-1, 0.45, 0), leaf(1, 0.7, 1), leaf(-1, 0.95, 2), fall, mesh(new THREE.IcosahedronGeometry(0.1, 0), lam('#8a6a3c'), 0, 1.13, 0));
        const base = anim; anim = (t) => { base(t); fall.position.y = 0.2 + ((t / 2600) % 1) * -0.18; fall.rotation.y = t / 700; };
      } else { // summer (and the tropics): in full flower
        const flower = new THREE.Group(); flower.position.y = 1.12;
        const petal = lam('#f2a7c8');
        for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const p = mesh(new THREE.IcosahedronGeometry(0.12, 0), petal, Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16); p.scale.set(1.2, 0.5, 1.2); flower.add(p); }
        flower.add(mesh(new THREE.IcosahedronGeometry(0.09, 0), lam('#f5d04a')));
        g.add(leaf(-1, 0.45, 0), leaf(1, 0.7, 1), flower);
      }
      const sway = anim; anim = (t) => { sway(t); g.rotation.z = Math.sin(t / 900) * 0.08; };
      break;
    }
    case 'Fungi': { // a mushroom with a spotted cap
      const stem = mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.5, 7), lam('#efe6d4'), 0, 0.25, 0);
      const cap = mesh(new THREE.SphereGeometry(0.4, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2), main, 0, 0.45, 0);
      g.add(stem, cap);
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; g.add(mesh(new THREE.IcosahedronGeometry(0.05, 0), lam('#fff4e0'), Math.cos(a) * 0.22, 0.75, Math.sin(a) * 0.22)); }
      break;
    }
    default: { // anything else: the original glowing ball
      fly = true;
      g.add(mesh(new THREE.IcosahedronGeometry(0.6, 1), main));
    }
  }
  return { g, anim, fly };
}

/** The season at a latitude today: flipped south of the equator; the tropics stay in leaf. */
export function plantSeason(lat, date = new Date()) {
  if (lat == null || Math.abs(lat) < 23.5) return 'summer';
  const m = (date.getMonth() + (lat < 0 ? 6 : 0)) % 12; // 0 = January (north)
  return m <= 1 || m === 11 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn';
}

export function initCritters(ctx) {
  const { scene, world, game, settings } = ctx;
  const hitGeo = new THREE.SphereGeometry(1.1, 8, 6);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const haloMat = new THREE.SpriteMaterial({ map: (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(160,255,200,0.55)'); gr.addColorStop(0.5, 'rgba(95,208,138,0.22)'); gr.addColorStop(1, 'rgba(95,208,138,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const objs = new Map();

  const dispose = (m) => m.traverse((o) => { if (o.isMesh && o !== m) { o.material.dispose?.(); o.geometry.dispose?.(); } });

  function sync(t) {
    const alive = new Set(game.critters.map((c) => c.id));
    for (const [id, m] of objs) if (!alive.has(id)) { scene.remove(m); dispose(m); objs.delete(id); }
    for (const c of game.critters) {
      let m = objs.get(c.id);
      if (!m) {
        m = new THREE.Mesh(hitGeo, hitMat); // the tap target
        m.userData.critter = c;
        const fig = figureFor(c.sp.group, plantSeason(game.pos?.lat));
        fig.g.userData.yaw = Math.random() * Math.PI * 2;
        fig.g.rotation.y = fig.g.userData.yaw;
        fig.g.traverse((o) => { o.raycast = () => {}; }); // taps hit the sphere
        m.userData.fig = fig;
        const halo = new THREE.Sprite(haloMat);
        halo.raycast = () => {};
        halo.position.y = 0.5;
        m.add(fig.g, halo);
        objs.set(c.id, m);
        scene.add(m);
      }
      const g = world.groundAt(c.lat, c.lon);
      if (g === null) { m.visible = false; continue; }
      m.visible = true;
      const fig = m.userData.fig;
      const o = world.toLocal(c.lat, c.lon);
      const still = settings.reduceMotion;
      // flying things float and bob; walkers, plants and fungi stand on the ground
      m.position.set(o.x, g + (fig.fly ? 0.9 + (still ? 0.5 : Math.abs(Math.sin(t / 260 + c.born)) * 0.9) : 0.02), o.z);
      if (!still) fig.anim(t + c.born * 7);
      const age = Math.min(1, (t - c.born) / 700);
      m.scale.setScalar(still ? 1 : 0.2 + 0.8 * age * age * (3 - 2 * age));
      // the glow grows when zoomed out, so a creature can be spotted from afar
      const hs = ctx.arMode.active ? 3 : Math.min(18, Math.max(3, ctx.controls.dist * 0.07)) / Math.max(0.2, m.scale.x);
      m.children[1].scale.setScalar(hs * (still ? 1 : 0.92 + 0.08 * Math.sin(t / 500)));
    }
  }

  return { sync, meshes: () => [...objs.values()] };
}
