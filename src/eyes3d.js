// eyes3d.js — the two 3D EYES (Three.js) for EYE BEATS.
//
// Each eye is a CONTROL STICK: a round eyeball whose IRIS+PUPIL is a cursor that slides across the
// surface to exactly where your stick points — and that's where the note lands. Push the stick and
// the pupil glides to that spot on the rim; centre it and the pupil returns to the middle. Hit
// quality is how close the pupil is to the note's spot (+ timing), so the pupil literally being
// "on" the note is the hit. The pupil CONSTRICTS as your combo climbs and the whites go BLOODSHOT.
// No glasses (they confused the hit zone). The 2D note/HUD overlay (render.js) targets each eye's
// projected screen centre + radius via `.screen`, so its notes line up with the pupil.
//
// If a `models/eye.glb` is present it's loaded and used for the eyeballs instead.

import * as THREE from 'three';

const EYE_R = 1.5;              // eyeball radius (world units)
const EYE_X = 3.0;              // each eye's distance left/right of centre
const REACH = 0.9;             // fraction of the radius the pupil travels at full stick (matches the rim)
const _Z = new THREE.Vector3(0, 0, 1);   // reused: the iris hugs the surface by facing the radial normal

function makeCanvas(s) { const c = document.createElement('canvas'); c.width = c.height = s; return c; }

// Iris disc: coloured base + radial fibres + dark limbal ring; transparent outside. The black pupil
// is a separate mesh on top (so it can constrict).
function irisTexture(hueDeg) {
  const s = 256, c = makeCanvas(s), x = c.getContext('2d');
  const cx = s / 2, cy = s / 2, R = s * 0.5;
  x.clearRect(0, 0, s, s);
  const g = x.createRadialGradient(cx, cy, R * 0.18, cx, cy, R);
  g.addColorStop(0, '#101014');
  g.addColorStop(0.24, `hsl(${hueDeg},90%,64%)`);
  g.addColorStop(0.64, `hsl(${hueDeg},95%,46%)`);
  g.addColorStop(0.92, `hsl(${(hueDeg + 28) % 360},80%,22%)`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.fillStyle = g; x.fill();
  for (let i = 0; i < 200; i++) {
    const a = (i / 200) * Math.PI * 2 + Math.random() * 0.05;
    const r0 = R * (0.22 + Math.random() * 0.08), r1 = R * (0.55 + Math.random() * 0.42);
    x.strokeStyle = `hsla(${(hueDeg + (Math.random() * 36 - 18)) % 360},95%,${58 + Math.random() * 24 | 0}%,${0.2 + Math.random() * 0.26})`;
    x.lineWidth = 0.6 + Math.random();
    x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); x.stroke();
  }
  x.beginPath(); x.arc(cx, cy, R * 0.96, 0, Math.PI * 2); x.lineWidth = R * 0.05; x.strokeStyle = 'rgba(0,0,0,0.45)'; x.stroke();
  return new THREE.CanvasTexture(c);
}

function veinsTexture() {
  const s = 512, c = makeCanvas(s), x = c.getContext('2d');
  x.clearRect(0, 0, s, s); x.lineCap = 'round';
  for (let i = 0; i < 64; i++) {
    const edge = Math.random() * Math.PI * 2;
    let px = s / 2 + Math.cos(edge) * s * 0.5, py = s / 2 + Math.sin(edge) * s * 0.5;
    const steps = 5 + (Math.random() * 7 | 0);
    x.strokeStyle = `rgba(${200 + Math.random() * 40 | 0},20,30,${0.5 + Math.random() * 0.4})`;
    x.lineWidth = 0.6 + Math.random() * 1.6;
    x.beginPath(); x.moveTo(px, py);
    let ang = edge + Math.PI + (Math.random() - 0.5);
    for (let k = 0; k < steps; k++) { ang += (Math.random() - 0.5) * 0.9; const len = 6 + Math.random() * 14; px += Math.cos(ang) * len; py += Math.sin(ang) * len; x.lineTo(px, py); }
    x.stroke();
  }
  return new THREE.CanvasTexture(c);
}

function glintTexture() {
  const s = 128, c = makeCanvas(s), x = c.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

class Eye {
  constructor(side, hue) {
    this.side = side; this.hue = hue;
    this.group = new THREE.Group();
    this.group.position.x = side === 'L' ? -EYE_X : EYE_X;

    // sclera — a still white eyeball
    const sclera = new THREE.Mesh(
      new THREE.SphereGeometry(EYE_R, 56, 56),
      new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.34, metalness: 0.0 })
    );
    this.scleraMat = sclera.material; this.group.add(sclera);

    // bloodshot overlay (combo-driven)
    this.veins = new THREE.Mesh(
      new THREE.SphereGeometry(EYE_R * 1.004, 40, 40),
      new THREE.MeshBasicMaterial({ map: veinsTexture(), transparent: true, opacity: 0, depthWrite: false })
    );
    this.group.add(this.veins);

    // CURSOR — iris + pupil that slides across the surface to the aim (this is "where the note hits")
    this.cursor = new THREE.Group();
    const iris = new THREE.Mesh(
      new THREE.CircleGeometry(EYE_R * 0.4, 56),
      new THREE.MeshStandardMaterial({ map: irisTexture(hue), emissive: new THREE.Color().setHSL(hue / 360, 0.9, 0.45), emissiveIntensity: 0.9, transparent: true, roughness: 0.25 })
    );
    iris.material.emissiveMap = iris.material.map; this.irisMat = iris.material;
    this.cursor.add(iris);
    // glow halo behind the iris
    const halo = new THREE.Mesh(new THREE.CircleGeometry(EYE_R * 0.46, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue / 360, 1, 0.55), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.position.z = -0.01; this.cursor.add(halo);
    // pupil — black disc + neon limbal ring; CONSTRICTS with combo
    this.pupil = new THREE.Group();
    this.pupil.add(new THREE.Mesh(new THREE.CircleGeometry(EYE_R * 0.17, 36), new THREE.MeshBasicMaterial({ color: 0x000000 })));
    const ring = new THREE.Mesh(new THREE.RingGeometry(EYE_R * 0.17, EYE_R * 0.21, 36),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue / 360, 1, 0.6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.pupil.add(ring); this.pupilRing = ring.material; this.pupil.position.z = 0.01;
    this.cursor.add(this.pupil);
    // wet glint on the iris
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
    glint.scale.setScalar(EYE_R * 0.28); glint.position.set(-EYE_R * 0.12, EYE_R * 0.14, 0.05); this.cursor.add(glint);

    this.cursor.position.set(0, 0, EYE_R);
    this.group.add(this.cursor);
    this._px = 0; this._py = 0; this._roll = 0; this._chomp = 0; this.spinDir = 0;
  }

  update(aim, dt) {
    // slide the pupil to the aim on the eye surface (screen y-down → 3D y-up)
    const tx = (aim?.x || 0) * EYE_R * REACH;
    const ty = -(aim?.y || 0) * EYE_R * REACH;
    const k = Math.min(1, dt * 24);
    this._px += (tx - this._px) * k; this._py += (ty - this._py) * k;
    const r2 = this._px * this._px + this._py * this._py;
    const pz = Math.sqrt(Math.max(0.04, EYE_R * EYE_R - r2));   // keep it ON the sphere front
    this.cursor.position.set(this._px, this._py, pz);
    // orient the iris along the surface NORMAL so it hugs the eyeball (one attached piece, not a
    // flat disc floating on top). At neutral the normal is +Z, so the eye looks straight ahead.
    this.cursor.quaternion.setFromUnitVectors(_Z, this.cursor.position.clone().normalize());
    this._roll += this.spinDir * dt * 9;
    this.cursor.rotateZ(this._roll);                            // whirl during a spin
    this._chomp *= Math.pow(0.0001, dt);
    this.cursor.scale.setScalar(1 + this._chomp * 0.18);        // chomp pop on a hit
  }

  setBloodshot(f) { this.veins.material.opacity = Math.max(0, Math.min(1, f)); const p = Math.min(0.45, f * 0.45); this.scleraMat.color.setRGB(1, 1 - p, 1 - p * 0.85); }
  setPupil(s) { this.pupil.scale.setScalar(s); }              // <1 = constricted (combo)
  setHue(h) { const hh = (((h % 360) + 360) % 360) / 360; this.irisMat.emissive.setHSL(hh, 0.9, 0.45); this.pupilRing.color.setHSL(hh, 1, 0.6); }
  chomp() { this._chomp = 1; }
}

export class EyeStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 0, 11.5);

    this.scene.add(new THREE.AmbientLight(0x303040, 1.3));
    this.key = new THREE.DirectionalLight(0xffffff, 1.5); this.key.position.set(0.2, 0.7, 2); this.scene.add(this.key);
    this.rimL = new THREE.PointLight(0x00f0ff, 45, 40); this.rimL.position.set(-6, 2, 3); this.scene.add(this.rimL);
    this.rimR = new THREE.PointLight(0xff00e0, 45, 40); this.rimR.position.set(6, -1, 3); this.scene.add(this.rimR);

    this._addBackdrop();
    this.L = new Eye('L', 192); this.R = new Eye('R', 320);
    this.scene.add(this.L.group); this.scene.add(this.R.group);

    this.screen = { L: { x: 0, y: 0, r: 60 }, R: { x: 0, y: 0, r: 60 } };
    this._t = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this._tryLoadModel();
  }

  _addBackdrop() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 } }, depthWrite: false, depthTest: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform float t; varying vec2 vUv;
        void main(){
          vec2 p=(vUv-0.5)*8.0;
          float v=sin(p.x*1.2+t)+sin(p.y*1.4+t*1.1)+sin((p.x+p.y)*0.6+t*0.7)+sin(length(p)*1.1-t*1.3);
          vec3 c=0.5+0.5*cos(vec3(0.0,2.1,4.2)+v*1.8+t*0.3);
          c*=0.11+0.09*abs(sin(v+t));
          gl_FragColor=vec4(c,1.0);
        }`,
    });
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(110, 70), mat);
    bg.position.z = -8; bg.renderOrder = -10; this.bgMat = mat; this.scene.add(bg);
  }

  async _tryLoadModel() {
    try {
      const res = await fetch('models/eye.glb', { method: 'HEAD' });
      if (!res.ok) return;
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync('models/eye.glb');
      const fit = (o) => { const b = new THREE.Box3().setFromObject(o); const s = (EYE_R * 2) / b.getSize(new THREE.Vector3()).length(); o.scale.setScalar(s * 1.7); };
      for (const eye of [this.L, this.R]) { const m = gltf.scene.clone(true); fit(m); m.add(eye.cursor); eye.group.add(m); }
    } catch { /* keep procedural eyes */ }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.w = w; this.h = h;
  }

  _project(eye) {
    const c = eye.group.getWorldPosition(new THREE.Vector3()).project(this.camera);
    const x = (c.x * 0.5 + 0.5) * this.w, y = (-c.y * 0.5 + 0.5) * this.h;
    const edge = eye.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(EYE_R, 0, 0)).project(this.camera);
    const ex = (edge.x * 0.5 + 0.5) * this.w;
    return { x, y, r: Math.abs(ex - x) };
  }

  /** state: { L:{aim,spinDir}, R:{aim,spinDir}, combo } */
  update(state, dt) {
    this._t += dt;
    const hue = (this._t * 28) % 360;
    this.rimL.color.setHSL(((hue + 180) % 360) / 360, 1, 0.5);
    this.rimR.color.setHSL((hue % 360) / 360, 1, 0.55);
    if (this.bgMat) this.bgMat.uniforms.t.value = this._t * 0.8;
    const combo = state.combo || 0;
    const bloodshot = Math.min(1, combo / 25);                  // bloodshot as combo builds
    const pupil = 1 - Math.min(0.55, combo / 40);               // CONSTRICTS as combo climbs
    this.L.setHue(196 + Math.sin(this._t * 0.8) * 30);
    this.R.setHue(320 + Math.sin(this._t) * 20);
    for (const k of ['L', 'R']) {
      const eye = this[k], s = state[k] || {};
      eye.spinDir = s.spinDir || 0;
      eye.update(s.aim, dt); eye.setBloodshot(bloodshot); eye.setPupil(pupil);
    }
    this.screen.L = this._project(this.L);
    this.screen.R = this._project(this.R);
  }

  chomp(ring) { (ring === 'L' ? this.L : this.R).chomp(); }
  render() { this.renderer.render(this.scene, this.camera); }
}
