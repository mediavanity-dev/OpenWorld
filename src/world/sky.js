// Real-time sky: sun and moon from the true time and place, weather-driven
// clouds, fog, rain, snow, lightning and wind. All cheap: two lights, fog, and
// one GPU-animated particle draw call.

import * as THREE from 'three';
import { env as uniforms, buildingMat, poiMat } from './materials.js';

const C = (h) => new THREE.Color(h);
const SKY = { day: C('#bcd8ec'), overcast: C('#c2c8ce'), golden: C('#f0c49a'), night: C('#16233a'), haze: C('#cbbfa8') };
const NIGHT_SKY = C('#7d93c4'), DAY_SKY = C('#eef6ff'), NIGHT_GROUND = C('#3a4150'), DAY_GROUND = C('#8b9079');
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const PARTICLE_VS = `
uniform float uTime; uniform vec3 uCenter; uniform float uBox; uniform float uH; uniform float uSpeed; uniform vec2 uDrift; uniform float uSize;
void main() {
  vec3 p = position;
  float fall = uTime * uSpeed;
  vec3 w;
  w.y = uCenter.y - uH * 0.5 + mod(p.y - fall, uH);
  vec2 drift = uDrift * (uTime + p.y * 0.01);
  w.x = uCenter.x - uBox + mod(p.x + drift.x - uCenter.x, 2.0 * uBox);
  w.z = uCenter.z - uBox + mod(p.z + drift.y - uCenter.z, 2.0 * uBox);
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * 220.0 / max(1.0, -mv.z);
}`;
const PARTICLE_FS = `
uniform float uMode; uniform vec3 uColor; uniform float uOpacity;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a;
  if (uMode < 0.5) { a = step(abs(c.x), 0.06) * (1.0 - abs(c.y) * 1.6); } // rain streak
  else { a = 1.0 - smoothstep(0.25, 0.5, length(c)); }                     // snow flake
  if (a <= 0.01) discard;
  gl_FragColor = vec4(uColor, a * uOpacity);
}`;

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.hemi = new THREE.HemisphereLight('#eef6ff', '#8b9079', 1.2);
    this.sun = new THREE.DirectionalLight('#fff3df', 1.7);
    this.moon = new THREE.DirectionalLight('#9fb4d9', 0);
    scene.add(this.hemi, this.sun, this.moon);
    this.bg = SKY.day.clone();
    scene.background = this.bg;
    scene.fog = new THREE.Fog(this.bg, 400, 2600);
    this.flash = 0;
    this.nextFlash = 5;
    this.state = { night: 0, precip: null };
    this.particles = null;
    this.count = 0;
  }

  ensureParticles(count) {
    if (this.particles && this.count === count) return;
    if (this.particles) { this.scene.remove(this.particles); this.particles.geometry.dispose(); }
    this.count = count;
    const box = 70, H = 60, pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { pos[i * 3] = Math.random() * box * 2; pos[i * 3 + 1] = Math.random() * H; pos[i * 3 + 2] = Math.random() * box * 2; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.pu = {
      uTime: uniforms.uTime, uCenter: { value: new THREE.Vector3() }, uBox: { value: box }, uH: { value: H },
      uSpeed: { value: 18 }, uDrift: { value: new THREE.Vector2() }, uSize: { value: 1 },
      uMode: { value: 0 }, uColor: { value: C('#cfd8e3') }, uOpacity: { value: 0.6 },
    };
    const m = new THREE.ShaderMaterial({ uniforms: this.pu, vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, transparent: true, depthWrite: false });
    this.particles = new THREE.Points(g, m);
    this.particles.frustumCulled = false;
    this.particles.visible = false;
    this.scene.add(this.particles);
  }

  // e: Environment; pos: {lat, lon}; camPos: THREE.Vector3; quality.particles: count
  update(e, pos, camPos, dt, { particles = 1200, viewDist = 70 } = {}) {
    uniforms.uTime.value += dt;
    const sun = e.sun(pos.lat, pos.lon), moon = e.moon(pos.lat, pos.lon), w = e.weather;
    const cloud = w ? w.cloud : 0.3;
    const day = smooth(-6, 8, sun.alt);
    const golden = smooth(-4, 2, sun.alt) * (1 - smooth(4, 14, sun.alt));
    this.state.night = 1 - day;

    // sky colour
    const c = SKY.night.clone().lerp(SKY.day.clone().lerp(SKY.overcast, cloud * 0.85), day);
    c.lerp(SKY.golden, golden * 0.55 * (1 - cloud * 0.6));
    const aqi = w?.aqi ?? 0;
    if (aqi > 40) c.lerp(SKY.haze, Math.min(0.35, (aqi - 40) / 120));

    // fog distance from weather / air
    let near = 400, far = 2600;
    const kind = w?.kind;
    if (kind === 'fog') { near = 20; far = 320; }
    else if (kind === 'rain' || kind === 'storm') { near = 200; far = 1300; }
    else if (kind === 'drizzle') { near = 260; far = 1800; }
    else if (kind === 'snow') { near = 120; far = 900; }
    if (aqi > 40) far *= Math.max(0.55, 1 - (aqi - 40) / 150);
    far = Math.max(far, viewDist * 2.2);
    near = Math.min(near, far * 0.4);

    // lightning
    if (kind === 'storm') {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) { this.flash = 1; this.nextFlash = 4 + Math.random() * 10; }
    }
    this.flash = Math.max(0, this.flash - dt * 6);

    this.bg.copy(c).lerp(C('#ffffff'), this.flash * 0.5);
    this.scene.fog.color.copy(this.bg);
    this.scene.fog.near = near; this.scene.fog.far = far;

    // lights
    const dir = (az, alt) => {
      const a = (az * Math.PI) / 180, h = (Math.max(alt, 2) * Math.PI) / 180;
      return new THREE.Vector3(Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h)).multiplyScalar(1000);
    };
    this.sun.position.copy(dir(sun.az, sun.alt));
    this.sun.intensity = 1.9 * day * (1 - 0.65 * cloud);
    this.sun.color.copy(C('#ffc58f').lerp(C('#fff3df'), smooth(0, 25, sun.alt)));
    this.moon.position.copy(dir(moon.az, moon.alt));
    this.moon.intensity = moon.alt > 0 ? 0.45 * moon.illum * (1 - 0.7 * cloud) * (1 - day) : 0;
    // night stays readable: a cool moonlit ambient rather than black
    this.hemi.intensity = 0.75 + 0.55 * day * (1 - 0.15 * cloud) + this.flash * 2.5;
    this.hemi.color.copy(NIGHT_SKY).lerp(DAY_SKY, day);
    this.hemi.groundColor.copy(NIGHT_GROUND).lerp(DAY_GROUND, day);

    // night glow on buildings and places
    buildingMat.emissive.setRGB(1, 0.8, 0.55).multiplyScalar(0.11 * (1 - day));
    poiMat.emissive.setScalar(0.13 + 0.55 * (1 - day));

    // ground & tree effects
    const wind = w ? w.wind : 8;
    uniforms.uWind.value = Math.min(1.5, wind / 35);
    const snowing = kind === 'snow';
    const target = Math.max(snowing ? 0.55 : 0, Math.min(1, (w?.snowDepth || 0) * 12));
    uniforms.uSnow.value += (target - uniforms.uSnow.value) * Math.min(1, dt * 0.5);
    const wet = kind === 'rain' || kind === 'storm' ? 1 : kind === 'drizzle' ? 0.5 : 0;
    uniforms.uWet.value += (wet - uniforms.uWet.value) * Math.min(1, dt * 0.5);

    // precipitation
    const precip = kind === 'rain' || kind === 'storm' || kind === 'drizzle' ? 'rain' : snowing ? 'snow' : null;
    if (precip && particles > 0) {
      const n = kind === 'drizzle' ? Math.round(particles * 0.5) : particles;
      this.ensureParticles(n);
      this.particles.visible = true;
      const rad = ((w.windDir + 180) * Math.PI) / 180, ws = Math.min(8, wind / 6);
      this.pu.uCenter.value.copy(camPos);
      this.pu.uDrift.value.set(Math.sin(rad) * ws, -Math.cos(rad) * ws);
      if (precip === 'rain') { this.pu.uMode.value = 0; this.pu.uSpeed.value = 22; this.pu.uSize.value = 1.4; this.pu.uColor.value.set(day > 0.5 ? '#b9c6d4' : '#5d6b80'); this.pu.uOpacity.value = 0.55; }
      else { this.pu.uMode.value = 1; this.pu.uSpeed.value = 1.6; this.pu.uSize.value = 0.55; this.pu.uColor.value.set('#ffffff'); this.pu.uOpacity.value = 0.9; }
    } else if (this.particles) this.particles.visible = false;
    this.state.precip = precip;
    return this.state;
  }
}
