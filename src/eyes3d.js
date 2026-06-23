// eyes3d.js — the two REALISTIC 3D EYEBALLS (Three.js), the centrepiece of EYEBALLS.
//
// Each eye is the player's stick made flesh: the stick is the PUPIL, and the eye rotates to LOOK
// OUTWARD toward where you aim — at rest (stick centred) it stares straight back at you, which is
// the game's "centre it" cue. Lasers (the notes) streak IN toward the eye from the rim ("inverted
// wakka": the circle sits still and the food comes to it; you point the chomp at it). On a hit the
// eye gives a quick chomp pulse. The whites go BLOODSHOT as your combo climbs. During a spin note
// the eye whirls — either direction, and one eye can spin solo.
//
// The realism is a textured sphere (sclera + radial-fibre iris + a wet cornea glint), lit on pure
// black with hue-cycling electric rim lights for the acid/LCD feel. If a `models/eye.glb` is
// present it's loaded and used instead (drop in any rotating-eye model). The 2D laser/HUD overlay
// (render.js) sits on top and targets each eye's projected screen position, exposed via `.screen`.

import * as THREE from 'three';

const LOOK_MAX = 0.62;          // radians the eye can rotate off-centre (keeps the iris readable)
const EYE_R = 1.6;              // eyeball radius (world units)
const EYE_X = 2.45;             // each eye's distance left/right of centre

// ---- procedural textures (canvas) -----------------------------------------
function makeCanvas(s) { const c = document.createElement('canvas'); c.width = c.height = s; return c; }

// Off-white sclera with faint shading.
function scleraTexture() {
  const s = 256, c = makeCanvas(s), x = c.getContext('2d');
  x.fillStyle = '#f4f1ea'; x.fillRect(0, 0, s, s);
  // soft vignette so it reads round under flat light
  const g = x.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.6);
  g.addColorStop(0, 'rgba(255,255,255,0.15)'); g.addColorStop(1, 'rgba(150,140,150,0.18)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c); return t;
}

// Transparent red veins radiating from the edges — overlaid with combo-driven opacity (bloodshot).
function veinsTexture() {
  const s = 512, c = makeCanvas(s), x = c.getContext('2d');
  x.clearRect(0, 0, s, s);
  x.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const edge = Math.random() * Math.PI * 2;
    let px = s / 2 + Math.cos(edge) * s * 0.5, py = s / 2 + Math.sin(edge) * s * 0.5;
    const steps = 6 + (Math.random() * 8 | 0);
    x.strokeStyle = `rgba(${190 + Math.random() * 50 | 0},${10 + Math.random() * 25 | 0},${20 + Math.random() * 20 | 0},${0.5 + Math.random() * 0.4})`;
    x.lineWidth = 0.6 + Math.random() * 1.8;
    x.beginPath(); x.moveTo(px, py);
    let ang = edge + Math.PI + (Math.random() - 0.5);
    for (let k = 0; k < steps; k++) {
      ang += (Math.random() - 0.5) * 0.9;
      const len = 6 + Math.random() * 16;
      px += Math.cos(ang) * len; py += Math.sin(ang) * len;
      x.lineTo(px, py);
    }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c); return t;
}

// Iris with a dark limbal ring, radial fibres, a coloured base and a black pupil. Transparent
// outside the iris disc so it sits on the sphere.
function irisTexture(hueDeg) {
  const s = 256, c = makeCanvas(s), x = c.getContext('2d');
  const cx = s / 2, cy = s / 2, R = s * 0.5;
  x.clearRect(0, 0, s, s);
  // base radial gradient
  const g = x.createRadialGradient(cx, cy, R * 0.16, cx, cy, R);
  g.addColorStop(0, '#0a0a0a');
  g.addColorStop(0.18, `hsl(${hueDeg},85%,62%)`);
  g.addColorStop(0.62, `hsl(${hueDeg},90%,42%)`);
  g.addColorStop(0.93, `hsl(${(hueDeg + 30) % 360},70%,20%)`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.fillStyle = g; x.fill();
  // radial fibres
  for (let i = 0; i < 220; i++) {
    const a = (i / 220) * Math.PI * 2 + Math.random() * 0.05;
    const r0 = R * (0.2 + Math.random() * 0.08), r1 = R * (0.55 + Math.random() * 0.42);
    x.strokeStyle = `hsla(${(hueDeg + (Math.random() * 40 - 20)) % 360},90%,${50 + Math.random() * 30 | 0}%,${0.25 + Math.random() * 0.3})`;
    x.lineWidth = 0.6 + Math.random();
    x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); x.stroke();
  }
  // limbal ring
  x.beginPath(); x.arc(cx, cy, R * 0.97, 0, Math.PI * 2); x.lineWidth = R * 0.07; x.strokeStyle = 'rgba(0,0,0,0.55)'; x.stroke();
  // pupil
  x.beginPath(); x.arc(cx, cy, R * 0.32, 0, Math.PI * 2); x.fillStyle = '#000'; x.fill();
  const t = new THREE.CanvasTexture(c); return t;
}

// Soft round sprite for the cornea glint.
function glintTexture() {
  const s = 128, c = makeCanvas(s), x = c.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

class Eye {
  constructor(side, hue) {
    this.side = side;
    this.group = new THREE.Group();         // looks (yaw/pitch) toward the aim
    this.spinGroup = new THREE.Group();      // rolls during a spin note
    this.group.add(this.spinGroup);

    const sclera = new THREE.Mesh(
      new THREE.SphereGeometry(EYE_R, 64, 64),
      new THREE.MeshStandardMaterial({ map: scleraTexture(), roughness: 0.32, metalness: 0.0 })
    );
    this.scleraMat = sclera.material;
    this.spinGroup.add(sclera);

    this.veins = new THREE.Mesh(
      new THREE.SphereGeometry(EYE_R * 1.004, 48, 48),
      new THREE.MeshBasicMaterial({ map: veinsTexture(), transparent: true, opacity: 0, depthWrite: false })
    );
    this.spinGroup.add(this.veins);

    // iris cup sits on the +Z front of the eye; the group rotates so it points at the aim
    const iris = new THREE.Mesh(
      new THREE.CircleGeometry(EYE_R * 0.64, 64),
      new THREE.MeshStandardMaterial({ map: irisTexture(hue), emissive: new THREE.Color().setHSL(hue / 360, 0.9, 0.4), emissiveIntensity: 0.7, transparent: true, roughness: 0.25, metalness: 0.0 })
    );
    iris.material.emissiveMap = iris.material.map;
    iris.position.z = EYE_R * 0.992;
    this.iris = iris; this.irisMat = iris.material; this.hue = hue;
    this.spinGroup.add(iris);

    // cornea glint (wet highlight) — additive sprite near the top of the iris
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glint.scale.setScalar(EYE_R * 0.7);
    glint.position.set(-EYE_R * 0.28, EYE_R * 0.3, EYE_R * 1.02);
    this.group.add(glint);                   // stays put as the eye rotates (a fixed reflection)

    this.group.position.x = side === 'L' ? -EYE_X : EYE_X;
    this._yaw = 0; this._pitch = 0; this._roll = 0;
    this._chomp = 0;     // hit pulse (0..1, decays)
    this.spinDir = 0;    // -1 / 0 / +1 while a spin note is live
  }

  update(aim, dt) {
    // look outward toward the aim; at rest (centred) stare straight ahead at the player
    const tx = (aim?.x || 0), ty = (aim?.y || 0);
    const tyaw = tx * LOOK_MAX, tpitch = -ty * LOOK_MAX;
    this._yaw += (tyaw - this._yaw) * Math.min(1, dt * 12);
    this._pitch += (tpitch - this._pitch) * Math.min(1, dt * 12);
    this._roll += this.spinDir * dt * 9;                 // whirl during a spin note
    this.group.rotation.set(this._pitch, this._yaw, 0);
    this.spinGroup.rotation.z = this._roll;
    // chomp pulse on a hit ("inverted wakka")
    this._chomp *= Math.pow(0.0001, dt);
    const sc = 1 + this._chomp * 0.12;
    this.group.scale.setScalar(sc);
  }

  setBloodshot(f) {
    this.veins.material.opacity = Math.max(0, Math.min(0.92, f));
    const p = Math.min(0.22, f * 0.22);                  // whites tinge pink too
    this.scleraMat.color.setRGB(1, 1 - p, 1 - p * 0.9);
  }

  setHue(h) { this.irisMat.emissive.setHSL(((h % 360) + 360) % 360 / 360, 0.9, 0.45); }
  chomp() { this._chomp = 1; }
}

export class EyeStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0, 9.2);

    // lights — soft fill + two electric rim lights (hue-cycled for the acid feel)
    this.scene.add(new THREE.AmbientLight(0x222233, 1.1));
    this.key = new THREE.DirectionalLight(0xffffff, 1.5); this.key.position.set(0.3, 0.8, 2); this.scene.add(this.key);
    this.rimL = new THREE.PointLight(0x00f0ff, 60, 40); this.rimL.position.set(-6, 2, 3); this.scene.add(this.rimL);
    this.rimR = new THREE.PointLight(0xff00e0, 60, 40); this.rimR.position.set(6, -1, 3); this.scene.add(this.rimR);

    this.L = new Eye('L', 188); this.R = new Eye('R', 320);   // cyan-ish L, magenta-ish R irises
    this.scene.add(this.L.group); this.scene.add(this.R.group);

    this.screen = { L: { x: 0, y: 0, r: 60 }, R: { x: 0, y: 0, r: 60 } };
    this._t = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this._tryLoadModel();   // optional: swap in models/eye.glb if present
  }

  async _tryLoadModel() {
    try {
      const res = await fetch('models/eye.glb', { method: 'HEAD' });
      if (!res.ok) return;
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync('models/eye.glb');
      const fit = (obj) => { const box = new THREE.Box3().setFromObject(obj); const s = (EYE_R * 2) / box.getSize(new THREE.Vector3()).length(); obj.scale.setScalar(s * 1.7); };
      for (const eye of [this.L, this.R]) {
        const m = gltf.scene.clone(true); fit(m);
        eye.spinGroup.clear(); eye.spinGroup.add(m);   // replace procedural eye with the model
      }
      this._hasModel = true;
    } catch { /* keep the procedural eye */ }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.w = w; this.h = h;
  }

  // Project an eye's centre + radius to 2D screen pixels (for the laser/HUD overlay to target).
  _project(eye) {
    const v = eye.group.position.clone().project(this.camera);
    const x = (v.x * 0.5 + 0.5) * this.w, y = (-v.y * 0.5 + 0.5) * this.h;
    const edge = eye.group.position.clone().add(new THREE.Vector3(EYE_R, 0, 0)).project(this.camera);
    const ex = (edge.x * 0.5 + 0.5) * this.w;
    return { x, y, r: Math.abs(ex - x) };
  }

  /** state: { L:{aim,spinDir}, R:{aim,spinDir}, combo } */
  update(state, dt) {
    this._t += dt;
    const hue = (this._t * 18) % 360;                    // acid hue-cycle
    this.rimL.color.setHSL(((hue + 180) % 360) / 360, 1, 0.5);
    this.rimR.color.setHSL((hue % 360) / 360, 1, 0.55);
    const bloodshot = Math.min(0.92, (state.combo || 0) / 50);
    for (const k of ['L', 'R']) {
      const eye = this[k], s = state[k] || {};
      eye.spinDir = s.spinDir || 0;
      eye.update(s.aim, dt);
      eye.setBloodshot(bloodshot);
    }
    this.screen.L = this._project(this.L);
    this.screen.R = this._project(this.R);
  }

  chomp(ring) { (ring === 'L' ? this.L : this.R).chomp(); }
  render() { this.renderer.render(this.scene, this.camera); }
}
