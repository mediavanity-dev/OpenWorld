// Shared materials. Weather/time effects run on the GPU through a few shared
// uniforms, so they cost almost nothing per frame.

import * as THREE from 'three';

export const env = {
  uTime: { value: 0 },
  uWind: { value: 0 },   // 0..1.5
  uSnow: { value: 0 },   // 0..1 ground/tree snow cover
  uWet: { value: 0 },    // 0..1 darkened wet ground
};

function hook(material, key, { vertex, fragment, after = '#include <map_fragment>' }) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, env);
    const decl = 'uniform float uTime; uniform float uWind; uniform float uSnow; uniform float uWet;\n';
    shader.vertexShader = decl + shader.vertexShader;
    shader.fragmentShader = decl + shader.fragmentShader;
    if (vertex) shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + vertex);
    if (fragment) shader.fragmentShader = shader.fragmentShader.replace(after, after + '\n' + fragment);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

export function terrainMaterial(map) {
  return hook(new THREE.MeshLambertMaterial({ map }), 'ow-terrain', {
    fragment: 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), uSnow * 0.85); diffuseColor.rgb *= 1.0 - uWet * 0.2;',
  });
}

const SWAY = `
#ifdef USE_INSTANCING
  float ph = instanceMatrix[3].x * 0.07 + instanceMatrix[3].z * 0.05;
  float bend = (position.y + 1.0) * uWind;
  transformed.x += sin(uTime * 1.7 + ph) * 0.07 * bend;
  transformed.z += cos(uTime * 1.3 + ph) * 0.05 * bend;
#endif`;

export const treeMat = hook(new THREE.MeshLambertMaterial({ flatShading: true }), 'ow-tree', {
  vertex: SWAY,
  fragment: 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.97), uSnow * 0.45);',
  after: '#include <color_fragment>',
});
export const trunkMat = new THREE.MeshLambertMaterial({ color: '#7a5c42' });
export const buildingMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
export const poiMat = new THREE.MeshLambertMaterial({ emissive: '#222222' });

export const treeGeoHi = new THREE.IcosahedronGeometry(1, 1);
export const treeGeoLo = new THREE.IcosahedronGeometry(1, 0);
export const coneGeo = new THREE.ConeGeometry(1, 1, 7);
export const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1, 5).translate(0, 0.5, 0);
export const poiGeo = new THREE.OctahedronGeometry(2.4);

// one index buffer shared by every terrain grid
const cache = new Map();
export function gridIndex(n) {
  if (cache.has(n)) return cache.get(n);
  const idx = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const a = r * (n + 1) + c, b = a + 1, cc = a + n + 1, d = cc + 1;
    idx.push(a, cc, b, b, cc, d);
  }
  const attr = new THREE.Uint16BufferAttribute(idx, 1);
  cache.set(n, attr);
  return attr;
}
