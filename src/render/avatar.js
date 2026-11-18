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
  const parts = [mat, dark, skin, hatM, packM];
  const leg = () => { const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.42, 3, 6), dark); l.geometry.translate(0, -0.34, 0); return l; };
  const legL = leg(), legR = leg();
  legL.position.set(-0.17, 0.72, 0); legR.position.set(0.17, 0.72, 0); // hips: legs swing from here
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.5, 3, 8), mat);
  body.position.y = 1.12;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.27, 1), skin);
  head.position.y = 1.78;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.05, 12), hatM);
  brim.position.y = 1.93;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.27, 0.22, 10), hatM);
  crown.position.y = 2.05;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.24), packM);
  pack.position.set(0, 1.18, 0.38);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8), dark); // a bedroll on top of the pack
  roll.rotation.z = Math.PI / 2; roll.position.set(0, 1.5, 0.4);
  figure.add(legL, legR, body, head, brim, crown, pack, roll);
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
  cPivot.add(cArc, cTip);
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

  const api = {
    group,
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
      cBase.material.color.set(col); cArc.material.color.set(col);
      const there = d != null && d < 30;
      cPivot.visible = !!t && !there;
      cBase.material.opacity = there ? 0.55 + 0.35 * Math.sin(performance.now() / 250) : t ? 0.35 : 0.22;
      if (cPivot.visible) {
        const p = world.toLocal(t.lat, t.lon);
        // local x east, z south; minus the figure's own turn (the compass rides on it)
        cPivot.rotation.y = Math.atan2(-(p.z - o.z), p.x - o.x) - group.rotation.y;
      }
    },
  };
  return api;
}
