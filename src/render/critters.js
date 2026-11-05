// Creatures in the world: a small bobbing shape with a soft glow, coloured by group.

import * as THREE from 'three';
import { GROUP_STYLE } from '../data/wildlife.js';

export function initCritters(ctx) {
  const { scene, world, game, settings } = ctx;
  const geo = new THREE.IcosahedronGeometry(0.7, 1);
  const haloMat = new THREE.SpriteMaterial({ map: (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(160,255,200,0.55)'); gr.addColorStop(0.5, 'rgba(95,208,138,0.22)'); gr.addColorStop(1, 'rgba(95,208,138,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const objs = new Map();

  function sync(t) {
    const alive = new Set(game.critters.map((c) => c.id));
    for (const [id, m] of objs) if (!alive.has(id)) { scene.remove(m); m.material.dispose(); objs.delete(id); }
    for (const c of game.critters) {
      let m = objs.get(c.id);
      if (!m) {
        m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: GROUP_STYLE[c.sp.group]?.color || '#5fd08a', emissive: '#113311' }));
        m.userData.critter = c;
        const halo = new THREE.Sprite(haloMat);
        halo.raycast = () => {}; // taps hit the creature, not its glow
        m.add(halo);
        objs.set(c.id, m);
        scene.add(m);
      }
      const g = world.groundAt(c.lat, c.lon);
      if (g === null) { m.visible = false; continue; }
      m.visible = true;
      const o = world.toLocal(c.lat, c.lon);
      m.position.set(o.x, g + 0.8 + (settings.reduceMotion ? 0.6 : Math.abs(Math.sin(t / 260 + c.born)) * 1.2), o.z);
      const age = Math.min(1, (t - c.born) / 700);
      m.scale.setScalar(settings.reduceMotion ? 1 : 0.2 + 0.8 * age * age * (3 - 2 * age));
      const hs = ctx.arMode.active ? 3 : Math.min(18, Math.max(3, ctx.controls.dist * 0.07)) / Math.max(0.2, m.scale.x);
      m.children[0].scale.setScalar(hs * (settings.reduceMotion ? 1 : 0.92 + 0.08 * Math.sin(t / 500)));
    }
  }

  return { sync, meshes: () => [...objs.values()] };
}
