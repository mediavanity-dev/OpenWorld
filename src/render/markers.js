// Things the player leaves in the world: beacons (coloured by how their anchor resolved),
// the home-base marker and, in Home mode, the ring showing how far you can go.

import * as THREE from 'three';
import { RULES } from '../game/game.js';
import { resolveAnchor } from '../game/anchors.js';
import { MODE_COLOR } from './avatar.js';

const STATUS_COLOR = { feature: '#ffd36b', ground: '#5fe0d0', shifted: '#ffa04d', orphaned: '#ff5d5d', pending: '#c9c9c9' };

export function initMarkers(ctx) {
  const { scene, world, profile } = ctx;
  const beaconGroup = new THREE.Group();
  scene.add(beaconGroup);
  const pillarGeo = new THREE.CylinderGeometry(0.6, 0.6, 60, 8, 1, true).translate(0, 30, 0);
  const orbGeo = new THREE.SphereGeometry(1.4, 16, 12);
  const homeGeo = new THREE.ConeGeometry(5, 7, 4).translate(0, 3.5, 0);
  const beaconObjs = new Map();
  let homeObj = null;
  let leashLine = null;

  const placeAt = (obj, lat, lon, y) => { const o = world.toLocal(lat, lon); obj.position.set(o.x, y, o.z); };

  function refreshLeash() {
    const h = profile.data.home;
    if (leashLine) { scene.remove(leashLine); leashLine.geometry.dispose(); leashLine.material.dispose(); leashLine = null; }
    if (!h || ctx.game.mode !== 'home') return;
    const pts = [];
    const hy = world.groundAt(h.lat, h.lon) ?? ctx.avatar.y;
    const c = world.toLocal(h.lat, h.lon);
    for (let k = 0; k <= 160; k++) {
      const a = (k / 160) * Math.PI * 2;
      const x = c.x + Math.cos(a) * RULES.LEASH_M, z = c.z + Math.sin(a) * RULES.LEASH_M;
      const g = world.toGeo(x, z);
      pts.push(new THREE.Vector3(x, (world.groundAt(g.lat, g.lon) ?? hy) + 2, z));
    }
    leashLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: MODE_COLOR.home }));
    scene.add(leashLine);
  }

  function refreshBeacons() {
    for (const b of profile.data.beacons) {
      let g = beaconObjs.get(b.id);
      if (!g) {
        g = new THREE.Group();
        g.add(new THREE.Mesh(pillarGeo, new THREE.MeshBasicMaterial({ color: '#ffd36b', transparent: true, opacity: 0.35, depthWrite: false })),
          new THREE.Mesh(orbGeo, new THREE.MeshLambertMaterial({ color: '#ffd36b', emissive: '#553b00' })));
        g.children[1].position.y = 2.5;
        beaconObjs.set(b.id, g);
        beaconGroup.add(g);
      }
      const r = resolveAnchor(world, b.anchor);
      g.visible = r.lat !== undefined;
      if (!g.visible) continue;
      placeAt(g, r.lat, r.lon, r.y);
      const c = STATUS_COLOR[r.status];
      g.children[0].material.color.set(c);
      g.children[1].material.color.set(c);
    }
    const h = profile.data.home;
    if (h) {
      if (!homeObj) {
        homeObj = new THREE.Mesh(homeGeo, new THREE.MeshLambertMaterial({ color: MODE_COLOR.home, emissive: '#06324a' }));
        scene.add(homeObj);
      }
      const y = world.groundAt(h.lat, h.lon);
      homeObj.visible = y !== null;
      if (y !== null) placeAt(homeObj, h.lat, h.lon, y);
    }
    refreshLeash();
  }

  // grey out places (and geocaches) already in the journal
  function markKnown(chunk) {
    for (const p of chunk.pois) {
      const d = p.gc ? profile.data.geocaches?.[p.gc.code] : profile.data.discoveries[p.ref];
      if (d) chunk.markPoi(p.ref, d.grade);
    }
  }

  return {
    refreshBeacons, refreshLeash, markKnown,
    markAllKnown() { for (const ch of world.readyChunks()) markKnown(ch); },
    // after an import: rebuild every beacon from the new profile
    reset() { beaconObjs.forEach((g) => beaconGroup.remove(g)); beaconObjs.clear(); refreshBeacons(); },
    setLeashVisible(on) { if (leashLine) leashLine.visible = on; },
    animate(now) { beaconGroup.children.forEach((b) => (b.children[1].position.y = 2.5 + Math.sin(now / 500) * 0.4)); },
  };
}
