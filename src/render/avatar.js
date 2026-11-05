// The player's figure: body, facing nose, mode-coloured ring, an always-visible pointer
// above the head, the GPS accuracy ring and a soft shadow.

import * as THREE from 'three';
import { MODES } from '../game/game.js';
import { compassSupported } from '../sensors.js';
import { arSupported } from '../ar.js';

export const MODE_COLOR = { present: '#ff7a3d', home: '#3db8ff', roam: '#b07aff' };
const $ = (id) => document.getElementById(id);

export function initAvatar(ctx) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: MODE_COLOR.present, transparent: true });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.95, 4, 10), mat);
  body.position.y = 0.9;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), mat);
  head.position.y = 1.85;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 8), mat);
  nose.rotation.x = -Math.PI / 2; nose.position.set(0, 1.85, -0.38);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.5, 32), new THREE.MeshBasicMaterial({ color: MODE_COLOR.present, transparent: true, opacity: 0.8, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15;
  const pointer = new THREE.Mesh(new THREE.ConeGeometry(1, 2, 4), new THREE.MeshBasicMaterial({ color: MODE_COLOR.present }));
  pointer.rotation.x = Math.PI;
  const accuracyRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64), new THREE.MeshBasicMaterial({ color: '#ff7a3d', transparent: true, opacity: 0.45, depthWrite: false }));
  accuracyRing.rotation.x = -Math.PI / 2; accuracyRing.position.y = 0.3;
  // the pointer and rings draw on top of everything, so you can always find yourself (even inside a building)
  for (const m of [pointer, ring, accuracyRing]) { m.material.depthTest = false; m.renderOrder = 10; }
  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.06;
  group.add(body, head, nose, ring, pointer, accuracyRing, shadow);
  ctx.scene.add(group);

  const api = {
    group,
    y: 0, // smoothed ground height under the character
    // colour and controls for the current mode
    style() {
      const { game, controls } = ctx;
      const c = MODE_COLOR[game.mode] || MODE_COLOR.present;
      mat.color.set(c);
      mat.opacity = game.mode === 'roam' ? 0.55 : 1;
      ring.material.color.set(c);
      pointer.material.color.set(c);
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
      const ps = Math.max(1, controls.dist / 25);
      pointer.scale.setScalar(ps);
      pointer.position.y = 3 + ps * 2;
      ring.scale.setScalar(Math.max(1, controls.dist / 40));
      const acc = game.mode === 'present' && game.fix?.source === 'device' ? game.fix.accuracy : 0;
      accuracyRing.visible = acc > 4 && acc < 300;
      if (accuracyRing.visible) accuracyRing.scale.setScalar(acc);
    },
  };
  return api;
}
