// Hunt tracks and the daily-treasure mote. Subtle by design: faint prints on the ground;
// a soft golden mote with a light shaft that fades in when you're close.
// A handful of objects, built once.

import * as THREE from 'three';

function glowTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function initEffects(ctx) {
  const { scene, world, game, settings } = ctx;
  const printGeo = new THREE.CircleGeometry(0.2, 10).scale(1, 1.5, 1).rotateX(-Math.PI / 2);
  const printMat = new THREE.MeshBasicMaterial({ color: '#2a2016', transparent: true, opacity: 0, depthWrite: false });
  const prints = new THREE.InstancedMesh(printGeo, printMat, 6);
  prints.frustumCulled = false; prints.visible = false; prints.renderOrder = 2;
  scene.add(prints);
  let printsFor = null;
  const _pm = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _ps = new THREE.Vector3(1, 1, 1), _pp = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

  const mote = new THREE.Group();
  const moteGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture([[0, 'rgba(255,226,150,0.85)'], [0.2, 'rgba(255,200,90,0.45)'], [1, 'rgba(255,190,80,0)']]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  moteGlow.scale.setScalar(3.2);
  const shaftTex = (() => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 64;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(255,190,80,0)'); gr.addColorStop(0.7, 'rgba(255,190,80,0.08)'); gr.addColorStop(1, 'rgba(255,200,100,0.3)');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
    return new THREE.CanvasTexture(c);
  })();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.45, 18, 16, 1, true).translate(0, 9, 0), new THREE.MeshBasicMaterial({ map: shaftTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0 }));
  mote.add(shaft, moteGlow);
  mote.visible = false;
  scene.add(mote);
  let moteFade = 0;

  function sync(now, rdt) {
    // tracks
    const h = game.hunt;
    if (h?.tracks && !h.revealed) {
      if (printsFor !== h.tracks) {
        printsFor = h.tracks;
        h.tracks.forEach((tp, k) => {
          const g = world.groundAt(tp.lat, tp.lon) ?? ctx.avatar.y, o = world.toLocal(tp.lat, tp.lon);
          _pq.setFromAxisAngle(_up, -tp.yaw);
          prints.setMatrixAt(k, _pm.compose(_pp.set(o.x, g + 0.06, o.z), _pq, _ps));
        });
        prints.instanceMatrix.needsUpdate = true;
      }
      prints.visible = true;
      printMat.opacity += (0.55 - printMat.opacity) * Math.min(1, rdt * 2);
    } else if (prints.visible) {
      printMat.opacity -= Math.min(printMat.opacity, rdt * 1.5);
      if (printMat.opacity <= 0.01) { prints.visible = false; printsFor = null; }
    }
    // treasure mote: fades in when "hot", gently breathes
    const th = game.treasureHint;
    const want = th?.band === 'hot' ? 1 : 0;
    moteFade += (want - moteFade) * Math.min(1, rdt * 2.5);
    mote.visible = moteFade > 0.01;
    if (mote.visible && th) {
      const g = world.groundAt(th.t.lat, th.t.lon) ?? ctx.avatar.y;
      const o = world.toLocal(th.t.lat, th.t.lon);
      mote.position.set(o.x, g, o.z);
      const b = settings.reduceMotion ? 0 : Math.sin(now / 700);
      const ms = Math.min(16, Math.max(3.2, ctx.controls.dist * 0.06));
      moteGlow.scale.setScalar(ms);
      moteGlow.position.y = 1.4 + ms * 0.2 + b * 0.25;
      moteGlow.material.opacity = moteFade * (0.85 + 0.15 * b);
      shaft.material.opacity = moteFade * 0.35; // a faint thread of light, not a beam
    }
  }

  return { sync };
}
