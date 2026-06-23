// eyes2d.js — the two EYES, drawn in 2D from real layered eyeball art (CC-BY, sunburn / OpenGameArt).
//
// Each eye is a fixed glossy GLOBE (sclera) with an IRIS+PUPIL that slides across it to exactly where
// the stick points — that's where the note lands, so the eye literally LOOKS AT the note and the
// pupil aligns with it. The iris is clamped + clipped to the globe so it never spills off. At rest
// (stick centred) the pupil sits dead-centre, looking straight at the player. No reticles, no lines.
// The whites go BLOODSHOT and the pupil CONSTRICTS as combo climbs. Drawn on the same pixel space as
// the note overlay, so alignment is exact. Same API as the old 3D stage: update(state,dt), render(),
// chomp(ring), and `.screen = { L:{x,y,r}, R:{x,y,r} }`.

const REACH = 0.5;     // pupil travels up to 0.5·r from centre at full stick (stays inside the globe)
const IRIS_TINT = { L: '#1fd8ff', R: '#ff3bd6' };   // cyan-L / magenta-R, applied to the grey iris

export class Eyes2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._t = 0;
    this.globe = this._img('brand/eye/globe.png');
    this.pupilImg = this._img('brand/eye/pupil_round.png');
    this.veins = this._img('brand/eye/blood_veins_100.png');
    this.irisRaw = this._img('brand/eye/iris_desaturated.png', () => this._tintIrises());
    this.irisL = null; this.irisR = null;
    // per-eye runtime: cursor offset (px,py), spin roll, chomp pop
    this.st = { L: { px: 0, py: 0, roll: 0, chomp: 0, spinDir: 0 }, R: { px: 0, py: 0, roll: 0, chomp: 0, spinDir: 0 } };
    this.bloodshot = 0; this.pupilScale = 1;
    this.screen = { L: { x: 0, y: 0, r: 60 }, R: { x: 0, y: 0, r: 60 } };
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _img(src, onload) {
    const im = new Image(); im.onload = () => { im._ready = true; if (onload) onload(); }; im.src = src; return im;
  }

  // Tint the grey iris to cyan / magenta while keeping its realistic luminance detail.
  _tintIrises() {
    this.irisL = this._tint(this.irisRaw, IRIS_TINT.L);
    this.irisR = this._tint(this.irisRaw, IRIS_TINT.R);
  }
  _tint(img, color) {
    const c = document.createElement('canvas'); c.width = img.naturalWidth || 512; c.height = img.naturalHeight || 512;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'color'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);   // hue/sat from colour, luminance from iris
    x.globalCompositeOperation = 'destination-in'; x.drawImage(img, 0, 0);                              // restore the iris alpha shape
    return c;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Use the canvas's OWN client size (same basis the note overlay uses) — NOT window.innerWidth —
    // so the eyes and the notes share one coordinate space and stay aligned on mobile (where the
    // dynamic address bar makes innerHeight differ from 100vh) and at any DPR.
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    const r = Math.max(36, Math.min(w * 0.15, h * 0.24));   // eye radius — scales to the window
    const off = Math.min(w * 0.5 - r - 6, r * 1.7);          // half the gap between the two eyes
    const cy = h * 0.5;
    this.screen = { L: { x: w / 2 - off, y: cy, r }, R: { x: w / 2 + off, y: cy, r } };
  }

  /** state: { L:{aim,spinDir}, R:{aim,spinDir}, combo } */
  update(state, dt) {
    this._t += dt;
    const combo = state.combo || 0;
    this.bloodshot = Math.min(1, combo / 25);
    this.pupilScale = 1 - Math.min(0.5, combo / 40);   // constricts with combo
    for (const k of ['L', 'R']) {
      const st = this.st[k], s = state[k] || {}, aim = s.aim || { x: 0, y: 0 };
      const r = this.screen[k].r;
      const tx = aim.x * r * REACH, ty = aim.y * r * REACH;   // screen y-down → pixel y-down (direct)
      const kf = Math.min(1, dt * 22);
      st.px += (tx - st.px) * kf; st.py += (ty - st.py) * kf;
      st.spinDir = s.spinDir || 0;
      st.roll += st.spinDir * dt * 6;
      st.chomp *= Math.pow(0.0001, dt);
    }
  }

  chomp(ring) { this.st[ring === 'L' ? 'L' : 'R'].chomp = 1; }

  render() {
    const { ctx, w, h } = this;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    // faint deep-purple void so it isn't dead-flat black
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
    g.addColorStop(0, 'rgba(20,4,32,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    this._eye('L'); this._eye('R');
  }

  _eye(ring) {
    const { ctx } = this;
    const e = this.screen[ring], st = this.st[ring];
    const iris = ring === 'L' ? this.irisL : this.irisR;
    const D = e.r * 2;
    if (!this.globe._ready) return;
    // globe (sclera)
    ctx.drawImage(this.globe, e.x - e.r, e.y - e.r, D, D);
    // bloodshot veins over the globe
    if (this.bloodshot > 0.01 && this.veins._ready) {
      ctx.save(); ctx.globalAlpha = this.bloodshot; ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(this.veins, e.x - e.r, e.y - e.r, D, D); ctx.restore();
    }
    // clip to the globe so the iris/pupil can never spill off the eye
    ctx.save();
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 0.97, 0, Math.PI * 2); ctx.clip();
    const cx = e.x + st.px, cy = e.y + st.py, pop = 1 + st.chomp * 0.15;
    // foreshorten the iris along the radial axis so it WRAPS onto the eyeball's curve (looks like
    // one attached piece, not a flat disc sliding on top) — squashed more the further it looks.
    const dist = Math.hypot(st.px, st.py);
    const fs = Math.sqrt(Math.max(0.25, 1 - (dist / e.r) ** 2));
    const ra = Math.atan2(st.py, st.px);
    ctx.translate(cx, cy);
    ctx.rotate(ra); ctx.scale(fs, 1); ctx.rotate(-ra);
    ctx.rotate(st.roll); ctx.scale(pop, pop);
    if (iris) ctx.drawImage(iris, -e.r, -e.r, D, D);                       // iris (~0.4·D, centred on cursor)
    if (this.pupilImg._ready) { ctx.save(); ctx.scale(this.pupilScale, this.pupilScale); ctx.drawImage(this.pupilImg, -e.r, -e.r, D, D); ctx.restore(); }
    ctx.restore();
    // re-shade the iris with the globe's own lighting (multiply) so it picks up the eye's highlights
    // + shadow instead of looking pasted on — clipped to the iris footprint.
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, e.r * 0.42 * pop, 0, Math.PI * 2); ctx.clip();
    ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.globe, e.x - e.r, e.y - e.r, D, D);
    ctx.restore();
    // a small glossy catch-light so the eye reads wet
    ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(e.x - e.r * 0.22, e.y - e.r * 0.26, e.r * 0.1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}
