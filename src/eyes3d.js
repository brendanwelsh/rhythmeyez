// eyes3d.js — the TOON PSYCHEDELIC NERD FACE (Three.js), the centrepiece of EYE BEATS.
//
// A cel-shaded cartoon face floats, breathing and swaying, in a pure-black-to-deep-purple acid
// void. Two big toon eyeballs are the player's sticks made flesh: the stick is the gaze, and each
// eye rotates to LOOK OUTWARD toward where you aim — at rest (stick centred) it stares straight
// back at you, the game's "centre it" cue. The whole head bobs/breathes and PULSES with combo; the
// plasma backdrop swirls faster and more saturated as you build it. Round nerd glasses (taped
// bridge) frame the eyes and SURGE with light on the FOCUS bonus (both eyes on-target). A toon
// mouth below the nose smiles with combo and frowns/opens on a miss.
//
// Lasers (the notes) streak IN toward each eye from the rim; on a hit the eye
// gives a quick chomp pulse. Whites go bloodshot and pupils dilate as your combo climbs. During a
// spin note the eye whirls (either direction; one eye can spin solo). The 2D laser/HUD overlay
// (render.js) sits on top and targets each eye's projected screen position, exposed via `.screen`.
//
// If a `models/eye.glb` is present it's loaded and used for the eyeballs instead.

import * as THREE from 'three';

const LOOK_MAX = 1.05;          // radians the eye rotates at full stick — BIG, obvious gaze
const EYE_R = 1.0;              // eyeball radius (world units) — small, so notes have a long runway
const EYE_X = 4.2;             // each eye's distance left/right of centre (lands ~26%/74% of width @16:9)
const SKIN = 0xe8b98f;          // toon skin tone for the head/nose/mouth

// ---- procedural textures (canvas) -----------------------------------------
function makeCanvas(s) { const c = document.createElement('canvas'); c.width = c.height = s; return c; }

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
  return new THREE.CanvasTexture(c);
}

// A bright 3-step toon ramp so MeshToonMaterial reads as clean cel-shaded bands (not muddy).
function toonGradient() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 1;
  const x = c.getContext('2d');
  const cols = ['#7a6a8a', '#b8a8c8', '#e8e0f0', '#ffffff'];   // shadow → mid → light → hot
  cols.forEach((col, i) => { x.fillStyle = col; x.fillRect(i, 0, 1, 1); });
  const t = new THREE.CanvasTexture(c);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  return t;
}

// Iris with a dark limbal ring, radial fibres, a coloured base and a black pupil. Transparent
// outside the iris disc so it sits on the sphere. The live emissive/hue is animated on top.
function irisTexture(hueDeg) {
  const s = 256, c = makeCanvas(s), x = c.getContext('2d');
  const cx = s / 2, cy = s / 2, R = s * 0.5;
  x.clearRect(0, 0, s, s);
  const g = x.createRadialGradient(cx, cy, R * 0.16, cx, cy, R);
  g.addColorStop(0, '#0a0a0a');
  g.addColorStop(0.18, `hsl(${hueDeg},90%,64%)`);
  g.addColorStop(0.62, `hsl(${hueDeg},95%,46%)`);
  g.addColorStop(0.93, `hsl(${(hueDeg + 30) % 360},80%,22%)`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.fillStyle = g; x.fill();
  for (let i = 0; i < 220; i++) {                  // radial fibres for the trippy swirl
    const a = (i / 220) * Math.PI * 2 + Math.random() * 0.05;
    const r0 = R * (0.2 + Math.random() * 0.08), r1 = R * (0.55 + Math.random() * 0.42);
    x.strokeStyle = `hsla(${(hueDeg + (Math.random() * 40 - 20)) % 360},95%,${55 + Math.random() * 30 | 0}%,${0.25 + Math.random() * 0.3})`;
    x.lineWidth = 0.6 + Math.random();
    x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); x.stroke();
  }
  x.beginPath(); x.arc(cx, cy, R * 0.97, 0, Math.PI * 2); x.lineWidth = R * 0.07; x.strokeStyle = 'rgba(0,0,0,0.55)'; x.stroke();
  x.beginPath(); x.arc(cx, cy, R * 0.2, 0, Math.PI * 2); x.fillStyle = '#000'; x.fill();
  return new THREE.CanvasTexture(c);
}

// Soft round sprite for the cornea glint (wet highlight).
function glintTexture() {
  const s = 128, c = makeCanvas(s), x = c.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

// one shared toon ramp for every cel-shaded part
const TOON_RAMP = (() => { try { return toonGradient(); } catch { return null; } })();

class Eye {
  constructor(side, hue) {
    this.side = side;
    this.group = new THREE.Group();          // looks (yaw/pitch) toward the aim
    this.spinGroup = new THREE.Group();      // rolls during a spin note
    this.group.add(this.spinGroup);

    // TOON sclera — clean cel-shaded white ball (not the veiny realistic sphere)
    const sclera = new THREE.Mesh(
      new THREE.SphereGeometry(EYE_R, 48, 48),
      new THREE.MeshToonMaterial({ color: 0xf6f3ec, gradientMap: TOON_RAMP })
    );
    this.scleraMat = sclera.material;
    this.spinGroup.add(sclera);

    // bloodshot overlay (combo-driven opacity)
    this.veins = new THREE.Mesh(
      new THREE.SphereGeometry(EYE_R * 1.004, 40, 40),
      new THREE.MeshBasicMaterial({ map: veinsTexture(), transparent: true, opacity: 0, depthWrite: false })
    );
    this.spinGroup.add(this.veins);

    // iris cup on the +Z front of the eye — emissive, hue-cycling, psychedelic glow disc
    const iris = new THREE.Mesh(
      new THREE.CircleGeometry(EYE_R * 0.66, 64),
      new THREE.MeshBasicMaterial({ map: irisTexture(hue), transparent: true, depthWrite: false })
    );
    iris.position.z = EYE_R * 0.992;
    this.iris = iris; this.irisMat = iris.material; this.hue = hue;
    this.spinGroup.add(iris);

    // additive emissive glow halo on the iris (this is what hue-cycles for the acid pulse)
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(EYE_R * 0.6, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue / 360, 0.95, 0.55), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow.position.z = EYE_R * 0.994;
    this.glowMat = glow.material;
    this.spinGroup.add(glow);

    // live PUPIL — small black disc that DILATES with combo, with a thin neon limbal ring
    const pupil = new THREE.Group();
    const black = new THREE.Mesh(new THREE.CircleGeometry(EYE_R * 0.16, 40), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(EYE_R * 0.16, EYE_R * 0.21, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue / 360, 1, 0.6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    pupil.add(black); pupil.add(ring);
    pupil.position.z = EYE_R * 0.997;
    this.pupil = pupil; this.pupilRing = ring.material;
    this.spinGroup.add(pupil);

    // cornea glint — additive sprite, a fixed wet reflection (stays put as the eye rotates)
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glint.scale.setScalar(EYE_R * 0.6);
    glint.position.set(-EYE_R * 0.26, EYE_R * 0.3, EYE_R * 1.02);
    this.group.add(glint);

    this.group.position.set(side === 'L' ? -EYE_X : EYE_X, 0, 0);
    this._yaw = 0; this._pitch = 0; this._roll = 0;
    this._chomp = 0;     // hit pulse (0..1, decays)
    this.spinDir = 0;    // -1 / 0 / +1 while a spin note is live
  }

  update(aim, dt) {
    // Look outward toward the aim, mapped 1:1 with the stick direction (screen y-down, same as the
    // notes): stick right → eye looks right, stick DOWN → eye looks DOWN. At rest it stares ahead.
    const tx = (aim?.x || 0), ty = (aim?.y || 0);
    const tyaw = tx * LOOK_MAX, tpitch = ty * LOOK_MAX;   // +ty: stick down → iris down (y-down)
    this._yaw += (tyaw - this._yaw) * Math.min(1, dt * 24);   // snappy — the gaze tracks the stick
    this._pitch += (tpitch - this._pitch) * Math.min(1, dt * 24);
    this._roll += this.spinDir * dt * 9;                 // whirl during a spin note
    this.group.rotation.set(this._pitch, this._yaw, 0);
    this.spinGroup.rotation.z = this._roll;
    this._chomp *= Math.pow(0.0001, dt);                 // chomp pulse on a hit
    this.group.scale.setScalar(1 + this._chomp * 0.12);
  }

  setBloodshot(f) {
    this.veins.material.opacity = Math.max(0, Math.min(1, f));
    const p = Math.min(0.5, f * 0.5);                    // whites flush red as combo climbs
    this.scleraMat.color.setRGB(0.96, 0.95 - p, 0.92 - p * 0.85);
  }

  setHue(h) {
    const hh = ((h % 360) + 360) % 360 / 360;
    this.glowMat.color.setHSL(hh, 0.95, 0.55);
    this.pupilRing.color.setHSL(hh, 1, 0.6);
  }
  setGlow(i) { this.glowMat.opacity = i; }
  setPupil(scale) { this.pupil.scale.setScalar(scale); }
  chomp() { this._chomp = 1; }
}

export class EyeStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x05000a, 1);          // pure-black-to-deep-purple void
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 0, 13);                // pulled back: face sits in the centre ~40-45%

    // lights — soft fill + two electric rim lights (hue-cycled for the acid feel)
    this.scene.add(new THREE.AmbientLight(0x2a2240, 1.2));
    this.key = new THREE.DirectionalLight(0xffffff, 1.5); this.key.position.set(0.3, 0.8, 2); this.scene.add(this.key);
    this.rimL = new THREE.PointLight(0x00f0ff, 70, 50); this.rimL.position.set(-8, 3, 4); this.scene.add(this.rimL);
    this.rimR = new THREE.PointLight(0xff00e0, 70, 50); this.rimR.position.set(8, -2, 4); this.scene.add(this.rimR);

    // the head BOBS/BREATHES as one group; everything (head, eyes, features, specs) lives in it
    this.face = new THREE.Group();
    this.scene.add(this.face);

    this._addBackdrop();    // trippy acid plasma behind everything (not in the face group)
    this._addHead();        // big toon skin-coloured head behind the features
    this.L = new Eye('L', 188); this.R = new Eye('R', 320);   // cyan-ish L, magenta-ish R irises
    this.face.add(this.L.group); this.face.add(this.R.group);
    this._addNose();        // small, low, tucked between the lenses
    this._addMouth();       // reacts to mood/combo
    this._addGlasses();     // round nerd specs, surge on FOCUS

    this.screen = { L: { x: 0, y: 0, r: 60 }, R: { x: 0, y: 0, r: 60 } };
    this._t = 0; this._mood = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this._tryLoadModel();   // optional: swap in models/eye.glb if present
  }

  // A full-screen acid PLASMA behind the face — pure black to deep purple, swirling rainbow.
  _addBackdrop() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 }, energy: { value: 0 } }, depthWrite: false, depthTest: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float t; uniform float energy; varying vec2 vUv;
        void main(){
          vec2 p = (vUv - 0.5) * (9.0 + energy*3.0);
          float v = sin(p.x*1.3 + t) + sin(p.y*1.5 + t*1.2) + sin((p.x+p.y)*0.7 + t*0.8) + sin(length(p)*1.2 - t*1.5);
          vec3 col = 0.5 + 0.5*cos(vec3(0.0,2.1,4.2) + v*2.0 + t*0.4);
          col = mix(col, vec3(0.45,0.05,0.6), 0.35);          // bias toward deep purple
          float bright = (0.14 + 0.16*abs(sin(v + t))) * (1.0 + energy*0.9);   // brighter/saturated w/ combo
          col *= bright;
          float vig = smoothstep(1.25, 0.2, length(vUv-0.5));  // fade the corners to black
          gl_FragColor = vec4(col * vig, 1.0);
        }`,
    });
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(110, 70), mat);
    bg.position.z = -8; bg.renderOrder = -10;
    this.bgMat = mat; this.scene.add(bg);
  }

  // Big rounded toon HEAD sitting BEHIND the eyes (negative z) — a face floating in the void.
  // Sized to frame the features; deliberately not filling the screen (acid void stays around it).
  _addHead() {
    const skin = new THREE.MeshToonMaterial({ color: SKIN, gradientMap: TOON_RAMP });
    this.skinMat = skin;
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), skin);
    head.scale.set(6.6, 5.4, 4.2);    // wide ellipsoid head
    head.position.set(0, -0.2, -2.6);  // behind the features
    this.head = head; this.face.add(head);
    // two simple toon ears poking out the sides
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 24), skin);
      ear.scale.set(0.7, 1.0, 0.6); ear.position.set(s * 6.4, -0.4, -2.8); this.face.add(ear);
    }
  }

  // Small SKIN nose, tucked LOW and neatly BETWEEN the lenses (below the bridge, between the eyes).
  _addNose() {
    const skin = new THREE.MeshToonMaterial({ color: SKIN, gradientMap: TOON_RAMP });
    const nose = new THREE.Group();
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 0.8, 20), skin); bridge.position.y = 0.18; nose.add(bridge);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.24, 22, 22), skin); tip.position.y = -0.28; tip.scale.set(1, 0.85, 0.9); nose.add(tip);
    const nostril = new THREE.SphereGeometry(0.07, 14, 14); const nMat = new THREE.MeshBasicMaterial({ color: 0x2a1410 });
    const nL = new THREE.Mesh(nostril, nMat); nL.position.set(-0.11, -0.34, 0.2); nose.add(nL);
    const nR = new THREE.Mesh(nostril, nMat); nR.position.set(0.11, -0.34, 0.2); nose.add(nR);
    nose.position.set(0, -0.55, 1.0);  // LOWER (below the bridge) and forward, between the eyes
    this.face.add(nose);
  }

  // Toon MOUTH below the nose — a tube bent along a curve that we re-shape each frame from mood:
  // smiles up with combo, flattens then frowns/opens on a miss (mood<0).
  _addMouth() {
    this.mouthMat = new THREE.MeshToonMaterial({ color: 0x8a2030, gradientMap: TOON_RAMP });
    this.mouthGroup = new THREE.Group();
    this.mouthGroup.position.set(0, -2.05, 0.9);
    this.face.add(this.mouthGroup);
    this._setMouthCurve(0.4);   // start with a gentle smile
  }

  // Rebuild the mouth tube for a given curvature: + = smile, 0 = flat, − = frown; |k| also opens it.
  _setMouthCurve(k) {
    if (this.mouthMesh) { this.mouthGroup.remove(this.mouthMesh); this.mouthMesh.geometry.dispose(); }
    const w = 1.5, sag = k;                       // half-width, vertical bow of the lips
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const u = i / 14, xx = (u - 0.5) * 2 * w;   // -w..+w
      const yy = (u - 0.5) ** 2 * (-sag * 6) + Math.abs(k) * 0.0;   // parabola; +sag bows up at ends
      pts.push(new THREE.Vector3(xx, yy, 0));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 24, 0.14 + Math.abs(k) * 0.18, 10, false);
    this.mouthMesh = new THREE.Mesh(tube, this.mouthMat);
    this.mouthGroup.add(this.mouthMesh);
  }

  // Round nerd glasses: a torus around each eye, a bridge bar, white tape, and temple arms.
  // The frame's emissive glow SURGES on the FOCUS bonus (both eyes on-target at once).
  _addGlasses() {
    const frame = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3, metalness: 0.7, emissive: 0x33ddff, emissiveIntensity: 0.5 });
    this.glassesMat = frame;
    const lensR = EYE_R * 1.5, z = EYE_R + 0.3;
    for (const side of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(lensR, 0.09, 16, 56), frame);
      ring.position.set(side * EYE_X, 0, z); this.face.add(ring);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 12), frame);
      arm.rotation.x = Math.PI / 2; arm.position.set(side * (EYE_X + lensR), 0.1, z - 1.6); this.face.add(arm);
    }
    const span = 2 * EYE_X - 2 * lensR + 0.2;
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, span, 12), frame);
    bridge.rotation.z = Math.PI / 2; bridge.position.set(0, 0, z); this.face.add(bridge);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.16), new THREE.MeshStandardMaterial({ color: 0xf4f4f4, emissive: 0x333333 }));
    tape.position.set(0, 0, z + 0.04); this.face.add(tape);   // the iconic taped bridge
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

  // Project an eye's WORLD centre + radius to 2D screen pixels (for the laser/HUD overlay to target).
  // Uses the world matrix so the face bob/sway is included — the overlay tracks the eye exactly.
  _project(eye) {
    const c = new THREE.Vector3(); eye.group.getWorldPosition(c);
    const v = c.clone().project(this.camera);
    const x = (v.x * 0.5 + 0.5) * this.w, y = (-v.y * 0.5 + 0.5) * this.h;
    const edge = c.clone().add(new THREE.Vector3(EYE_R, 0, 0)).project(this.camera);
    const ex = (edge.x * 0.5 + 0.5) * this.w;
    return { x, y, r: Math.abs(ex - x) };
  }

  /** state: { L:{aim,spinDir}, R:{aim,spinDir}, combo, focus, mood } */
  update(state, dt) {
    this._t += dt;
    const combo = state.combo || 0;
    const energy = Math.min(1, combo / 40);              // drives backdrop saturation + pulse
    const hue = (this._t * 42) % 360;                    // faster acid hue-cycle

    // rim lights + plasma hue-cycle, plasma swirls faster/brighter with combo
    this.rimL.color.setHSL(((hue + 180) % 360) / 360, 1, 0.55);
    this.rimR.color.setHSL((hue % 360) / 360, 1, 0.6);
    if (this.bgMat) { this.bgMat.uniforms.t.value = this._t * (0.9 + energy * 0.8); this.bgMat.uniforms.energy.value = energy; }

    // HEAD MOTION — gentle bob/sway/breathe + a combo pulse (centred; it never flies around)
    const bob = Math.sin(this._t * 1.6) * 0.18, sway = Math.sin(this._t * 0.9) * 0.16;
    const breathe = 1 + Math.sin(this._t * 2.2) * 0.012 + energy * 0.04;
    this.face.position.set(sway, bob, 0);
    this.face.rotation.set(Math.sin(this._t * 1.1) * 0.05, Math.sin(this._t * 0.7) * 0.07, Math.sin(this._t * 1.3) * 0.03);
    this.face.scale.setScalar(breathe * (1 + Math.max(0, Math.sin(this._t * 6)) * energy * 0.02));

    // glasses FOCUS surge (both eyes on-target)
    if (this.glassesMat) this.glassesMat.emissiveIntensity = 0.5 + (state.focus ? 2.6 : 0) + Math.sin(this._t * 4) * 0.12;

    // MOUTH — smoothly track mood (+combo lift), smile up / frown+open on a miss
    const targetMood = Math.max(-1, Math.min(1, (state.mood || 0) + energy * 0.5));
    this._mood += (targetMood - this._mood) * Math.min(1, dt * 8);
    this._setMouthCurve(0.35 + this._mood * 0.55);       // +smile … −frown/open

    const bloodshot = Math.min(1, combo / 30);
    const pupil = 1 + Math.min(0.7, combo / 45) + Math.sin(this._t * 7) * 0.05;  // dilates with combo
    const glow = 0.45 + energy * 0.5 + Math.sin(this._t * 5) * 0.12;
    // L iris glows in the BLUE family, R in the PINK family — oscillating for the trip
    this.L.setHue(205 + Math.sin(this._t * 0.8) * 35);
    this.R.setHue(322 + Math.sin(this._t * 1.0) * 22);
    for (const k of ['L', 'R']) {
      const eye = this[k], s = state[k] || {};
      eye.spinDir = s.spinDir || 0;
      eye.update(s.aim, dt);
      eye.setBloodshot(bloodshot);
      eye.setPupil(pupil);
      eye.setGlow(glow);
    }
    this.screen.L = this._project(this.L);
    this.screen.R = this._project(this.R);
  }

  chomp(ring) { (ring === 'L' ? this.L : this.R).chomp(); }
  render() { this.renderer.render(this.scene, this.camera); }
}
