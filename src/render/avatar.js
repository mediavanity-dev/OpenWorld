// The player's figure: a small field explorer, a mode-coloured ring under it (drawn over buildings,
// so you can always find yourself), the GPS accuracy haze, the expedition compass ring and a shadow.

import * as THREE from 'three';
import { haversine } from '../geo.js';
import { MODES } from '../game/game.js';
import { compassSupported } from '../sensors.js';
import { arSupported } from '../ar.js';

export const MODE_COLOR = { present: '#ff7a3d', home: '#3db8ff', roam: '#b07aff' };
const $ = (id) => document.getElementById(id);

export function initAvatar(ctx) {
  const group = new THREE.Group();
  // A small low-poly field explorer (same simple style as the blob trees): legs that swing as
  // you walk, a jacket in the mode's colour, a wide-brimmed hat and a backpack, which shows
  // which way you're facing. Faces -z.
  const figure = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: MODE_COLOR.present, transparent: true, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: '#3a3f47', transparent: true, flatShading: true });
  const skin = new THREE.MeshLambertMaterial({ color: '#f0dcc4', transparent: true, flatShading: true });
  const hatM = new THREE.MeshLambertMaterial({ color: '#c8a96a', transparent: true, flatShading: true });
  const packM = new THREE.MeshLambertMaterial({ color: '#7a5a3c', transparent: true, flatShading: true });
  const lam = (color) => new THREE.MeshLambertMaterial({ color, transparent: true, flatShading: true });
  const legML = lam('#3a3f47'), legMR = lam('#3a3f47'), bootML = lam('#4a3a2c'), bootMR = lam('#4a3a2c');
  const parts = [mat, dark, skin, hatM, packM, legML, legMR, bootML, bootMR];
  const leg = (m, bm) => {
    const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.42, 3, 6), m); l.geometry.translate(0, -0.34, 0);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.32), bm); boot.position.set(0, -0.66, -0.05); l.add(boot); l.userData.boot = boot;
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.06, 8), new THREE.MeshBasicMaterial({ color: '#e8f4ff' })); stripe.position.y = -0.45; l.add(stripe); l.userData.stripe = stripe;
    const ankle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.12, 8), skin); ankle.position.y = -0.56; l.add(ankle); l.userData.ankle = ankle;
    return l;
  };
  const legL = leg(legML, bootML), legR = leg(legMR, bootMR);
  legL.position.set(-0.17, 0.72, 0); legR.position.set(0.17, 0.72, 0); // hips: legs swing from here
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.5, 3, 8), mat);
  body.position.y = 1.12;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.27, 1), skin);
  head.position.y = 1.78;
  // headwear: four looks the player can pick in Settings (all on the same simple figure)
  const looks = {};
  { const g = new THREE.Group(); // wide-brimmed hat
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.05, 12), hatM); brim.position.y = 1.93;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.27, 0.22, 10), hatM); crown.position.y = 2.05;
    g.add(brim, crown); looks.hat = g; }
  { const g = new THREE.Group(); // cap with a visor (faces forward, -z)
    const capM = new THREE.MeshLambertMaterial({ color: '#3d6b8c', transparent: true, flatShading: true }); parts.push(capM);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.29, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), capM); dome.position.y = 1.84;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.24), capM); visor.position.set(0, 1.86, -0.3);
    g.add(dome, visor); looks.cap = g; }
  { const g = new THREE.Group(); // knitted beanie with a bobble
    const knit = new THREE.MeshLambertMaterial({ color: '#c27b3a', transparent: true, flatShading: true }); parts.push(knit);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), knit); dome.position.y = 1.82;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.09, 10), knit); band.position.y = 1.83;
    const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), knit); pom.position.y = 2.14;
    g.add(dome, band, pom); looks.beanie = g; }
  { const g = new THREE.Group(); // rain hood in the jacket's colour, open at the face
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8, Math.PI * 0.75, Math.PI * 1.5, 0, Math.PI * 0.62), mat);
    hood.position.y = 1.8;
    g.add(hood); looks.hood = g; }
  const headwear = new THREE.Group();
  for (const g of Object.values(looks)) { g.visible = false; headwear.add(g); }
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.24), packM);
  pack.position.set(0, 1.18, 0.38);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8), dark); // a bedroll on top of the pack
  roll.rotation.z = Math.PI / 2; roll.position.set(0, 1.5, 0.4);
  figure.add(legL, legR, body, head, headwear, pack, roll);

  // ---- outfits (Settings → Your explorer). The jacket stays in the mode's colour (orange Walk,
  // blue Home, purple Roam) for every outfit except Rainbow; the rest of the look changes.
  const acc = {};
  const dk = lam('#2b2f36');
  { const g = new THREE.Group(); // binoculars on the chest
    for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.2, 8), dk); b.rotation.x = Math.PI / 2; b.position.set(s * 0.09, 1.22, -0.4); g.add(b); }
    acc.binoculars = g; }
  { const g = new THREE.Group(); // a satchel on the hip, strap across the body
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.36), lam('#8a6a44')); bag.position.set(-0.44, 0.92, 0);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.95, 0.03), lam('#6b4f30')); strap.position.set(0, 1.25, -0.36); strap.rotation.z = 0.75;
    g.add(bag, strap); acc.satchel = g; }
  { const nb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.04), lam('#e9dfc4')); nb.position.set(0.42, 1.0, -0.2); nb.rotation.y = -0.4; acc.notebook = nb; }
  { const g = new THREE.Group(); // a head torch that glows
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 10), dk); band.position.y = 1.83;
    const lampM = new THREE.MeshLambertMaterial({ color: '#fff6c8', emissive: '#ffe680', emissiveIntensity: 1.6 });
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10), lampM); lamp.rotation.x = Math.PI / 2; lamp.position.set(0, 1.85, -0.28);
    g.add(band, lamp); acc.torch = g; }
  { const g = new THREE.Group(); // a reflective band on the pack (the legs have their own)
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.06, 0.26), new THREE.MeshBasicMaterial({ color: '#e8f4ff' })); band.position.set(0, 1.1, 0.38);
    g.add(band); acc.reflect = g; }
  { const g = new THREE.Group(); // a thick knitted scarf
    const sM = lam('#d64545');
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.1, 6, 12), sM); wrap.rotation.x = Math.PI / 2; wrap.position.y = 1.55;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.07), sM); tail.position.set(0.14, 1.32, -0.34);
    g.add(wrap, tail); acc.scarf = g; }
  { const tote = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.36, 0.34), lam('#d8c9a3')); tote.position.set(0.45, 0.95, 0.05); acc.tote = tote; }
  for (const a of Object.values(acc)) { a.visible = false; figure.add(a); a.traverse((m) => { if (m.isMesh && !parts.includes(m.material)) { m.material.transparent = true; parts.push(m.material); } }); }

  // Rainbow: the jacket as seven solid, glowing bands, as loud as it gets
  const rainbowBody = new THREE.Group();
  ['#d500f9', '#651fff', '#00b0ff', '#00e676', '#ffea00', '#ff9100', '#ff1744'].forEach((c, i, all) => {
    const h = 1.12 / all.length, y = 0.58 + h * (i + 0.5), r = 0.36 * Math.sqrt(Math.max(0.25, 1 - Math.pow((y - 1.12) / 0.62, 2)));
    const m = new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.45, transparent: true, flatShading: true });
    parts.push(m);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, h * 1.02, 12), m);
    band.position.y = y;
    rainbowBody.add(band);
  });
  rainbowBody.visible = false;
  figure.add(rainbowBody);

  // legs, boots (scale: wellies are tall), pack (colour, scale, or none), bedroll, accessories
  const OUTFITS = {
    field: { legs: '#3a3f47', boots: '#4a3a2c', pack: '#7a5a3c', roll: '#3a3f47' },
    rain: { legs: '#24324d', boots: '#2f7a3e', bootH: 2.4, pack: '#f2c53d', roll: '#24324d' },
    hiker: { legs: '#7d8288', boots: '#5a3d26', bootW: 1.25, pack: '#3e5c41', packH: 1.45, roll: '#c2453c' },
    naturalist: { legs: '#b8a77a', boots: '#5a4632', pack: null, acc: ['binoculars', 'satchel'] },
    birdwatcher: { legs: '#5b6340', boots: '#4a3a2c', pack: '#6b6a3c', roll: '#5b6340', acc: ['binoculars', 'notebook'] },
    night: { legs: '#1c2340', boots: '#1d1d1d', pack: '#2a2f45', roll: '#1c2340', acc: ['torch', 'reflect'], stripes: true },
    winter: { legs: '#3b3f55', boots: '#ececec', bootH: 1.6, bootW: 1.2, pack: '#5b4a6b', roll: '#3b3f55', acc: ['scarf'], puffy: true },
    coastal: { legs: '#e9dcc0', boots: '#f7f7f7', pack: null, acc: ['tote'], ankles: true },
    rainbow: { legs: ['#ff1744', '#2979ff'], boots: ['#ffea00', '#00e676'], pack: '#d500f9', roll: '#00e5ff', rainbow: true, hat: '#ff9100' },
  };
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.5, 32), new THREE.MeshBasicMaterial({ color: MODE_COLOR.present, transparent: true, opacity: 0.8, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15;
  const accuracyRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, depthWrite: false }));
  accuracyRing.rotation.x = -Math.PI / 2; accuracyRing.position.y = 0.3;
  // the expedition compass: a steady ring with a bright arc towards the goal, coloured by how
  // close you are (blue far, gold getting close, orange very close; a full glow when there)
  const compass = new THREE.Group();
  const cBase = new THREE.Mesh(new THREE.RingGeometry(5.6, 5.95, 72), new THREE.MeshBasicMaterial({ color: '#4f9dff', transparent: true, opacity: 0.35, depthWrite: false }));
  const cPivot = new THREE.Group();
  const cArc = new THREE.Mesh(new THREE.RingGeometry(5.2, 6.5, 24, 1, -0.42, 0.84), new THREE.MeshBasicMaterial({ color: '#4f9dff', transparent: true, opacity: 0.95, depthWrite: false }));
  const cTip = new THREE.Mesh(new THREE.CircleGeometry(0.95, 3), cArc.material); // an arrowhead beyond the arc
  cTip.position.set(7.4, 0, 0);
  for (const m of [cBase, cArc, cTip]) m.rotation.x = -Math.PI / 2;
  cTip.rotation.z = 0; // the triangle's first point faces +x: outward
  const cWide = new THREE.Mesh(new THREE.RingGeometry(5.3, 6.3, 24, 1, -Math.PI / 8, Math.PI / 4), new THREE.MeshBasicMaterial({ color: '#4f9dff', transparent: true, opacity: 0.5, depthWrite: false }));
  cWide.rotation.x = -Math.PI / 2; cWide.material.depthTest = false; cWide.renderOrder = 10;
  cPivot.add(cArc, cTip, cWide);
  compass.add(cBase, cPivot);
  compass.position.y = 0.2;
  compass.visible = false;
  group.add(compass);
  const WARM = [[300, '#4f9dff'], [100, '#ffd36b'], [0, '#ff7a3d']];
  // the rings draw on top of everything, so you can always find yourself (even inside a building);
  // the figure draws after them (still hidden by buildings in front of it), so it stands on its ring
  figure.traverse((m) => { if (m.isMesh) m.renderOrder = 11; });
  for (const m of [cBase, cArc]) { m.material.depthTest = false; m.renderOrder = 10; }
  for (const m of [ring, accuracyRing]) { m.material.depthTest = false; m.renderOrder = 10; }
  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.06;
  group.add(figure, ring, accuracyRing, shadow);
  let stride = 0, last = null;
  ctx.scene.add(group);
  queueMicrotask(() => { api.setLook(ctx.settings?.avatar || 'hat'); api.setOutfit(ctx.settings?.outfit || 'field'); });

  const api = {
    group,
    /** Settings → Your explorer → Outfit: see OUTFITS (the jacket keeps the mode colour, except Rainbow) */
    setOutfit(name) {
      const o = OUTFITS[name] || OUTFITS.field;
      api.outfit = OUTFITS[name] ? name : 'field';
      const two = (v) => (Array.isArray(v) ? v : [v, v]);
      const [lL, lR] = two(o.legs), [bL, bR] = two(o.boots);
      legML.color.set(lL); legMR.color.set(lR); bootML.color.set(bL); bootMR.color.set(bR);
      for (const l of [legL, legR]) {
        l.userData.boot.scale.set(o.bootW || 1, o.bootH || 1, o.bootW || 1);
        l.userData.boot.position.y = -0.66 + ((o.bootH || 1) - 1) * 0.07;
        l.userData.stripe.visible = !!o.stripes;
        l.userData.ankle.visible = !!o.ankles;
      }
      pack.visible = !!o.pack; roll.visible = !!o.pack && !!o.roll;
      if (o.pack) packM.color.set(o.pack);
      if (o.roll) dark.color.set(o.roll);
      pack.scale.y = o.packH || 1; pack.position.y = 1.18 + ((o.packH || 1) - 1) * 0.26;
      roll.position.y = 1.5 + ((o.packH || 1) - 1) * 0.52;
      for (const [k, a] of Object.entries(acc)) a.visible = (o.acc || []).includes(k);
      body.scale.set(o.puffy ? 1.14 : 1, 1, o.puffy ? 1.14 : 1);
      body.visible = !o.rainbow; rainbowBody.visible = !!o.rainbow;
      for (const m of [legML, legMR, bootML, bootMR, packM, dark, hatM]) { m.emissive.set(o.rainbow ? m.color : '#000000'); m.emissiveIntensity = o.rainbow ? 0.4 : 1; }
      hatM.color.set(o.hat || '#c8a96a');
      figure.traverse((m) => { if (m.isMesh) m.renderOrder = 11; });
    },
    /** 'hat' | 'cap' | 'beanie' | 'hood' (Settings → Your explorer) */
    setLook(name) {
      for (const [k, g] of Object.entries(looks)) g.visible = k === (looks[name] ? name : 'hat');
      figure.traverse((m) => { if (m.isMesh) m.renderOrder = 11; });
    },
    y: 0, // smoothed ground height under the character
    // colour and controls for the current mode
    style() {
      const { game, controls } = ctx;
      const c = MODE_COLOR[game.mode] || MODE_COLOR.present;
      mat.color.set(c);
      for (const m of parts) m.opacity = game.mode === 'roam' ? 0.55 : 1; // Roam: a see-through visitor
      ring.material.color.set(c);
      document.body.classList.toggle('no-stick', !MODES[game.mode]?.canMove);
      controls.panMode = game.mode === 'present';
      $('compass').hidden = !(compassSupported && game.mode === 'present');
      $('ar-btn').hidden = !(arSupported() && game.mode === 'present');
    },
    // jump straight to the ground (after a teleport or the first area loads)
    snap() {
      const { game, world } = ctx;
      if (!game.pos) return;
      const g = world.groundAt(game.pos.lat, game.pos.lon);
      if (g !== null) api.y = g;
    },
    // per frame: follow the ground, scale the markers with zoom, show GPS accuracy
    update(rdt, o) {
      const { game, world, controls } = ctx;
      const g = world.groundAt(game.pos.lat, game.pos.lon);
      if (g !== null) api.y += (g - api.y) * (Math.abs(g - api.y) > 50 ? 1 : Math.min(1, rdt * 12));
      group.position.set(o.x, api.y, o.z);
      // a little bigger when zoomed out, so the figure stays readable (the ring marks the spot)
      figure.scale.setScalar(Math.min(3, Math.max(1, controls.dist / 70)));
      // walking: legs swing and the body bobs with the distance covered
      const moved = last ? Math.hypot(o.x - last.x, o.z - last.z) : 0;
      last = { x: o.x, z: o.z };
      const speed = rdt > 0 ? moved / rdt : 0;
      if (speed > 0.3 && speed < 15 && !ctx.settings?.reduceMotion) stride += moved * 2.4;
      else stride *= 0.85;
      const swing = Math.sin(stride) * Math.min(0.6, speed / 4);
      legL.rotation.x = swing; legR.rotation.x = -swing;
      body.position.y = 1.12 + Math.abs(Math.sin(stride)) * 0.05 * Math.min(1, speed / 2);
      ring.scale.setScalar(Math.max(1, controls.dist / 40));
      const acc = game.mode === 'present' && game.fix?.source === 'device' ? game.fix.accuracy : 0;
      accuracyRing.visible = acc > 4 && acc < 300;
      if (accuracyRing.visible) accuracyRing.scale.setScalar(acc);
      api.updateCompass(o);
    },
    updateCompass(o) {
      const { game, world, controls } = ctx;
      const c = ctx.expeditions?.compass?.();
      compass.visible = !!c && !ctx.arMode?.active;
      if (!compass.visible) return;
      compass.scale.setScalar(Math.max(1, controls.dist / 40));
      const t = c.target;
      const d = t ? haversine(game.pos.lat, game.pos.lon, t.lat, t.lon) : null;
      const col = d == null ? '#4f9dff' : WARM.find(([m]) => d >= m)[1];
      cBase.material.color.set(col); cArc.material.color.set(col); cWide.material.color.set(col);
      cArc.visible = cTip.visible = !c.rough; cWide.visible = !!c.rough;
      const there = d != null && d < 30;
      cPivot.visible = !!t && !there;
      cBase.material.opacity = there ? 0.55 + 0.35 * Math.sin(performance.now() / 250) : t ? 0.35 : 0.22;
      if (cPivot.visible) {
        const p = world.toLocal(t.lat, t.lon);
        // local x east, z south; minus the figure's own turn (the compass rides on it)
        let ang = Math.atan2(-(p.z - o.z), p.x - o.x);
        if (c.rough) ang = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4); // snapped to the 8 compass sectors
        cPivot.rotation.y = ang - group.rotation.y;
      }
    },
  };
  return api;
}
