// Lightweight AR: the rear camera is shown full-screen behind a transparent 3D
// overlay, and the phone's orientation sensors aim the virtual camera.
// No libraries, no tracking, no recording: the camera image never leaves the video element.

import * as THREE from 'three';

const ZEE = new THREE.Vector3(0, 0, 1);
const Q_BACK = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // look out of the back of the device
const D2R = Math.PI / 180;

export function arSupported() {
  return matchMedia('(pointer: coarse)').matches && !!navigator.mediaDevices?.getUserMedia && 'DeviceOrientationEvent' in window && window.isSecureContext;
}

export class ARView {
  constructor(videoEl) {
    this.video = videoEl;
    this.active = false;
    this.stream = null;
    this.o = null;          // last orientation { alpha, beta, gamma } in degrees
    this.northOffset = 0;   // degrees added to alpha so that 0 = north
    this.absolute = false;  // do we know where north is?
    this._euler = new THREE.Euler();
    this._q0 = new THREE.Quaternion();
    this._onOrient = (e) => this.onOrient(e);
    this._onVis = () => { if (this.active && document.visibilityState === 'visible') this.video.play().catch(() => {}); };
  }

  // Must be called from a tap (iOS asks for motion + camera permission here).
  async start() {
    // iOS (and some newer browsers) ask for motion permission; whether data actually
    // arrives is checked below, which is the reliable test on every platform.
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      await DeviceOrientationEvent.requestPermission().catch(() => 'denied');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.o = null;
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', this._onOrient);
    else window.addEventListener('deviceorientation', this._onOrient);
    document.addEventListener('visibilitychange', this._onVis);
    // wait briefly for the first sensor reading
    for (let k = 0; k < 20 && !this.o; k++) await new Promise((r) => setTimeout(r, 75));
    if (!this.o) {
      this.stop();
      throw new Error('no motion data from this device. If your browser asked about "Motion & Orientation", allow it and try again.');
    }
    this.active = true;
  }

  stop() {
    this.active = false;
    window.removeEventListener('deviceorientationabsolute', this._onOrient);
    window.removeEventListener('deviceorientation', this._onOrient);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.video.srcObject = null;
  }

  onOrient(e) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    this.o = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
      // iOS: alpha is relative; steer it towards north using the (tilt-compensated) compass, slowly
      const target = (360 - e.webkitCompassHeading) - e.alpha;
      if (!this.absolute) { this.northOffset = target; this.absolute = true; }
      else {
        const d = ((target - this.northOffset + 540) % 360) - 180;
        this.northOffset += d * 0.05;
      }
    } else if (e.absolute || e.type === 'deviceorientationabsolute') {
      this.northOffset = 0;
      this.absolute = true;
    }
  }

  // Orientation as a camera quaternion in the game's frame (x east, y up, -z north).
  quaternion(out) {
    if (!this.o) return out;
    const orient = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * D2R;
    this._euler.set(this.o.beta * D2R, (this.o.alpha + this.northOffset) * D2R, -this.o.gamma * D2R, 'YXZ');
    out.setFromEuler(this._euler);
    out.multiply(Q_BACK);
    out.multiply(this._q0.setFromAxisAngle(ZEE, -orient));
    return out;
  }

  // Vertical field of view that matches a typical phone main camera shown with object-fit: cover.
  fov(aspect) {
    const vw = this.video.videoWidth || 16, vh = this.video.videoHeight || 9;
    const portrait = aspect < 1;
    const longFov = 66; // degrees across the camera's long side (typical phone main camera)
    const vAspect = portrait ? Math.min(vw, vh) / Math.max(vw, vh) : Math.max(vw, vh) / Math.min(vw, vh);
    const half = (longFov / 2) * D2R;
    if (portrait) {
      // long side is vertical; cover crops the sides when the screen is narrower than the video
      return aspect <= vAspect ? longFov : (2 * Math.atan(Math.tan(half) * (vAspect / aspect))) / D2R;
    }
    // landscape: long side horizontal; cover crops top/bottom when the screen is wider
    return aspect >= vAspect ? (2 * Math.atan(Math.tan(half) / aspect)) / D2R : (2 * Math.atan(Math.tan(half) / vAspect)) / D2R;
  }
}
