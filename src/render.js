// render.js — EYEBALLS, the 2D-canvas LASER + HUD overlay (TRANSPARENT background).
//
// This canvas sits ON TOP of the Three.js eyeball stage (eyes3d.js). It paints nothing behind the
// notes — the 3D eyes show through. The two "rings" are each EYE, targeted at its projected screen
// position (`state.eyes = { L:{x,y,r}, R:{x,y,r} }` from EyeStage.screen). Notes are neon LASERS
// streaking IN toward each eye's rim ("inverted wakka": the eye holds still, the food comes to it).
// L = electric cyan, R = electric magenta; a lit note flares white. A MISS glitches the screen.
//
// API (unchanged, what main.js calls): new Renderer(canvas) · drawGame(state) · addEffect(e) ·
// addFlick(f) · showBanner(text) · public fields .effects .flickFx .pulse .glitch .trail

import { angleVec, wrapPi, noteTargetAngle, MODS } from './chart.js';
import { TAP_ARC, HOLD_ARC, SLIDE_ARC, PRESENCE_MAG } from './scoring.js';

// "centre it" neutral threshold: stick deflection below this counts as centred (for CENTER notes).
// scoring.js may export CENTER_MAG later; we keep a local default so this module imports cleanly.
const CENTER_MAG = PRESENCE_MAG * 0.6;

const COL = {
  L: '#00f0ff', R: '#ff2bd6',                 // electric cyan / electric magenta — the two eyes
  text: '#eafcff', dim: '#79b7c8',            // HUD ink, neon over black
  perfect: '#7dffea', good: '#9bff8a', miss: '#ff3b6b',
  accent: '#c8ff00',                           // acid lime — combo / banners
};
const ringColor = (r) => (r === 'L' ? COL.L : COL.R);

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.effects = [];
    this.flickFx = [];
    this.pulse = 0;
    this.glitch = 0;
    this._banner = null;   // transient centred flourish (combo milestones), {text, life}
    this._t = 0;
    this.trail = { L: [], R: [] };   // kept as a stub field (main.js resets it); no 2D trail drawn
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
  }

  // The per-ring eye geometry (centre + radius), from the 3D stage's projection if supplied, else a
  // sensible fallback so headless tests / a missing 3D layer still lay out two eyes.
  _eyes(state) {
    const e = state && state.eyes;
    if (e && e.L && e.R) return e;
    const { w, h } = this;
    const r = Math.min(h * 0.16, w * 0.1);
    return {
      L: { x: w * 0.3, y: h * 0.5, r },
      R: { x: w * 0.7, y: h * 0.5, r },
    };
  }

  addEffect({ judgement, ring, dir, angle, t }) {
    const e = { ring, dir, angle, judgement, t0: t, dur: judgement === 'miss' ? 0.4 : 0.7 };
    if (judgement !== 'miss') {
      const n = judgement === 'perfect' ? 12 : 7;     // spark particles bursting out on a hit
      e.spark = Array.from({ length: n }, (_, i) => ({ a: (i / n) * Math.PI * 2 + i * 0.7, sp: 0.6 + (i % 3) * 0.3 }));
    }
    this.effects.push(e);
    if (judgement === 'miss') this.glitch = 1; else this.pulse = 1;
  }

  addFlick({ ring, dir, mag = 1, t }) { this.flickFx.push({ ring, dir, mag, t0: t, dur: 0.22 }); }

  // --- main draw ----------------------------------------------------------
  drawGame(state) {
    const { chart, songTime, scorer } = state;
    const ctx = this.ctx, { w, h } = this;
    this._t += 1 / 60;

    // TRANSPARENT: clear every frame, paint NO background — the 3D eye canvas shows through.
    ctx.clearRect(0, 0, w, h);

    const eyes = this._eyes(state);

    ctx.save();
    if (this.glitch > 0.01) ctx.translate(Math.sin(this._t * 90) * 7 * this.glitch, Math.sin(this._t * 70) * 4 * this.glitch);

    // a very faint centre reticle at each eye (communicates "centre"); no 2D pupil/cursor/trail
    for (const ring of ['L', 'R']) this._reticle(eyes[ring], ring);

    // the lasers (notes) per ring, then hit FX on top
    for (const ring of ['L', 'R']) {
      if (chart) this._notes(ring, eyes[ring], chart, songTime);
      this._effects(ring, eyes[ring], songTime);
    }

    // HUD at the top edge: progress bar + score / combo+title / accuracy
    this._topbar(scorer, chart, songTime);

    if (this._banner) this._drawBanner();
    if (chart && songTime < 0) this._countIn(songTime);
    if (state.demo) this._demoBadge();
    ctx.restore();

    if (this.glitch > 0.01) this._glitchOverlay();
    this.pulse *= 0.9;
    this.glitch *= 0.86;
  }

  // A faint crosshair + dim ring at the eye centre — the only persistent 2D mark, cuing "centre".
  _reticle(eye, ring) {
    const { ctx } = this;
    const c = ringColor(ring);
    const r = eye.r;
    ctx.save();
    ctx.strokeStyle = this._alpha(c, 0.12);
    ctx.lineWidth = 1;
    const t = r * 0.16;
    ctx.beginPath();
    ctx.moveTo(eye.x - t, eye.y); ctx.lineTo(eye.x + t, eye.y);
    ctx.moveTo(eye.x, eye.y - t); ctx.lineTo(eye.x, eye.y + t);
    ctx.stroke();
    ctx.restore();
  }

  // --- geometry helpers (names preserved) ---------------------------------
  // A point on the eye's rim for a given heading; `frac` scales the radius.
  _rimPt(eye, a, frac = 1) { const v = angleVec(a); return { x: eye.x + v.x * eye.r * frac, y: eye.y + v.y * eye.r * frac }; }
  // The incoming laser head out beyond the rim; p 0→1 as it approaches (3.2r out → at the rim).
  _runwayPt(eye, a, p) { const v = angleVec(a); const d = eye.r + eye.r * 3.4 * (1 - p); return { x: eye.x + v.x * d, y: eye.y + v.y * d }; }

  // Glowing arc segment on the rim, centred on `a` spanning ±span. `lit` flares it white.
  _rimArc(eye, a, span, col, alpha, width, lit) {
    const { ctx } = this;
    ctx.save(); ctx.beginPath(); ctx.lineCap = 'round';
    ctx.shadowColor = lit ? '#ffffff' : col; ctx.shadowBlur = lit ? 18 : 8;
    ctx.arc(eye.x, eye.y, eye.r, a - span, a + span);
    ctx.strokeStyle = this._alpha(lit ? '#ffffff' : col, alpha); ctx.lineWidth = width; ctx.stroke();
    ctx.restore();
  }

  // Core neon beam: a wide soft glow stroke under a bright thin core, from `from` to `to`.
  _beam(from, to, col, lit, coreW, glowW) {
    const { ctx } = this;
    const bright = lit ? '#ffffff' : col;
    ctx.save();
    ctx.lineCap = 'round';
    // soft glow
    ctx.shadowColor = bright; ctx.shadowBlur = lit ? 26 : 16;
    ctx.strokeStyle = this._alpha(col, lit ? 0.5 : 0.32); ctx.lineWidth = glowW;
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    // bright core
    ctx.shadowBlur = lit ? 14 : 8;
    ctx.strokeStyle = this._alpha(bright, 0.95); ctx.lineWidth = coreW;
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    ctx.restore();
  }

  // Notes draw per TYPE as LASERS converging on the eye. Nothing is a discrete press — you're scored
  // for BEING in the arc / TRACING the line / SPINNING / CENTRING, so the visuals show a target to
  // ride into and flare white (n.lit) while your stick is satisfying them.
  _notes(ring, eye, chart, songTime) {
    const arcScale = (chart.meta && chart.meta.arcScale) || 1;
    const approach = (chart.meta && chart.meta.approachTime) || 1.5;
    for (const n of chart.notes) {
      if (n.ring !== ring || n.judged) continue;
      const dt = n.time - songTime;
      if (dt > approach || songTime > n.time + n.hold + 0.2) continue;
      const p = Math.max(0, Math.min(1, 1 - dt / approach)); // 0 far → 1 at the rim
      if (n.type === 'spin') this._noteSpin(eye, n, songTime, p);
      else if (n.type === 'slide') this._noteSlide(eye, n, songTime, p);
      else if (n.type === 'hold') this._noteHold(eye, n, songTime, p, arcScale);
      else if (n.type === 'center') this._noteCenter(eye, n, songTime, p, dt);
      else this._noteTap(eye, n, songTime, p, dt, arcScale);
      if (n.mod) this._modGlyph(eye, n, p);
    }
  }

  // TAP — a sharp fast bolt converging to the rim + a bite-arc on the rim at n.angle (±TAP_ARC) that
  // brightens near/lit. Reads as a quick ZAP: thin core, short streak.
  _noteTap(eye, n, songTime, p, dt, arcScale = 1) {
    const c = ringColor(n.ring);
    const near = Math.abs(dt) < 0.12;
    // bite zone on the rim
    this._rimArc(eye, n.angle, TAP_ARC * arcScale, c, (near ? 0.95 : 0.4) * Math.min(1, p * 2), eye.r * (near ? 0.18 : 0.1), n.lit);
    // incoming bolt — short, snappy streak just ahead of the rim
    const head = this._runwayPt(eye, n.angle, p);
    const tail = this._runwayPt(eye, n.angle, Math.max(0, p - 0.22));
    this._beam(tail, head, c, n.lit, eye.r * 0.06, eye.r * 0.16);
  }

  // HOLD — a FAT sustained beam locked at n.angle (clearly thicker than a tap) + a coverage gauge
  // arc on the rim filling with n.coverage.
  _noteHold(eye, n, songTime, p, arcScale = 1) {
    const c = ringColor(n.ring);
    const arc = HOLD_ARC * arcScale;
    // fat beam from outside straight into the rim point
    const head = this._rimPt(eye, n.angle, 1.0);
    const tail = this._runwayPt(eye, n.angle, songTime < n.time ? p : 1);
    this._beam(tail, head, c, n.lit, eye.r * 0.16, eye.r * 0.4);
    // coverage gauge: faint full arc + a bright fill that grows with coverage
    this._rimArc(eye, n.angle, arc, c, 0.28 * Math.min(1, p * 2), eye.r * 0.18, false);
    if (n.coverage > 0) this._rimArc(eye, n.angle, arc * n.coverage, c, 0.9, eye.r * 0.24, n.lit);
  }

  // SLIDE — the contact point sweeps angle→angleTo over the hold. Faint full path just inside the
  // rim + a bright traced portion up to the current head + the moving laser head.
  _noteSlide(eye, n, songTime, p) {
    const { ctx } = this;
    const c = ringColor(n.ring);
    const a0 = n.angle, a1 = n.angleTo, sweep = wrapPi(a1 - a0);
    const pathR = eye.r * 0.92;
    // faint full path to trace
    ctx.save(); ctx.lineCap = 'round'; ctx.shadowColor = c; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(eye.x, eye.y, pathR, a0, a0 + sweep, sweep < 0);
    ctx.strokeStyle = this._alpha(c, 0.26 * Math.min(1, p * 2)); ctx.lineWidth = eye.r * 0.12; ctx.stroke();
    // bright traced portion up to the current head
    const u = n.hold > 0 ? Math.max(0, Math.min(1, (songTime - n.time) / n.hold)) : 0;
    if (u > 0) {
      ctx.shadowColor = n.lit ? '#ffffff' : c; ctx.shadowBlur = n.lit ? 22 : 14;
      ctx.beginPath(); ctx.arc(eye.x, eye.y, pathR, a0, a0 + sweep * u, sweep < 0);
      ctx.strokeStyle = this._alpha(n.lit ? '#ffffff' : c, 0.9); ctx.lineWidth = eye.r * 0.16; ctx.stroke();
    }
    ctx.restore();
    // the moving laser head (a bolt converging on the swept contact point)
    const head = noteTargetAngle(n, songTime);
    const onRim = songTime >= n.time;
    const hp = onRim ? this._rimPt(eye, head, 0.92) : this._runwayPt(eye, a0, p);
    const tail = onRim ? this._runwayPt(eye, head, 0.55) : this._runwayPt(eye, a0, Math.max(0, p - 0.2));
    this._beam(tail, hp, c, n.lit, eye.r * 0.08, eye.r * 0.2);
  }

  // SPIN — a rotating swirl / gauge ring around the eye, filling with n.coverage; spins in n.spinDir.
  _noteSpin(eye, n, songTime, p) {
    const { ctx } = this;
    const c = ringColor(n.ring);
    const live = songTime >= n.time;
    const R = eye.r * 1.2;
    const dir = n.spinDir || 1;
    ctx.save();
    // gauge ring
    ctx.shadowColor = c; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(eye.x, eye.y, R, 0, Math.PI * 2);
    ctx.strokeStyle = this._alpha(c, (live ? 0.4 : 0.2) * Math.min(1, p * 2)); ctx.lineWidth = eye.r * 0.12; ctx.stroke();
    if (n.coverage > 0) {
      ctx.lineCap = 'round'; ctx.shadowColor = n.lit ? '#fff' : c; ctx.shadowBlur = n.lit ? 22 : 12;
      ctx.beginPath();
      ctx.arc(eye.x, eye.y, R, -Math.PI / 2, -Math.PI / 2 + dir * Math.PI * 2 * n.coverage, dir < 0);
      ctx.strokeStyle = this._alpha(n.lit ? '#fff' : c, 0.95); ctx.lineWidth = eye.r * 0.16; ctx.stroke();
    }
    // rotating swirl blades (spin in the note's direction)
    const spin = this._t * (live ? 6 : 2) * dir;
    ctx.translate(eye.x, eye.y); ctx.rotate(spin);
    ctx.shadowColor = n.lit ? '#fff' : c; ctx.shadowBlur = 10;
    ctx.fillStyle = this._alpha(n.lit ? '#fff' : c, 0.9);
    for (let k = 0; k < 3; k++) {
      ctx.rotate((Math.PI * 2) / 3);
      ctx.beginPath(); ctx.moveTo(R * 0.86, 0); ctx.lineTo(R * 0.7, -eye.r * 0.12); ctx.lineTo(R * 0.7, eye.r * 0.12); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (live) { ctx.save(); ctx.shadowColor = c; ctx.shadowBlur = 10; ctx.fillStyle = this._alpha('#fff', 0.85); ctx.font = `800 ${eye.r * 0.28}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SPIN', eye.x, eye.y - eye.r * 1.55); ctx.restore(); }
  }

  // CENTER — the "inverted wakka": concentric rings CLOSING IN onto the eye centre as time nears
  // n.time, cueing the player to pull the stick to NEUTRAL. Brightens when lit (centred).
  _noteCenter(eye, n, songTime, p, dt) {
    const { ctx } = this;
    const c = ringColor(n.ring);
    ctx.save();
    ctx.shadowColor = n.lit ? '#fff' : c;
    // 3 rings collapsing from outside the rim toward the pupil as p→1
    for (let k = 0; k < 3; k++) {
      const kp = Math.max(0, Math.min(1, p - k * 0.16));      // staggered so they cascade inward
      const rr = eye.r * (1.5 - 1.2 * kp);                    // 1.5r → 0.3r
      const a = (1 - Math.abs(2 * kp - 1)) * 0.8;             // fade in then out across approach
      ctx.shadowBlur = n.lit ? 20 : 12;
      ctx.beginPath(); ctx.arc(eye.x, eye.y, Math.max(2, rr), 0, Math.PI * 2);
      ctx.strokeStyle = this._alpha(n.lit ? '#ffffff' : c, a * (n.lit ? 1 : 0.85)); ctx.lineWidth = eye.r * 0.07; ctx.stroke();
    }
    // bright "CENTER" cue
    ctx.shadowBlur = 10; ctx.fillStyle = this._alpha(n.lit ? '#ffffff' : c, 0.9);
    ctx.font = `800 ${eye.r * 0.26}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('CENTER', eye.x, eye.y - eye.r * 1.55);
    ctx.restore();
  }

  // Modifier glyph (MODS[n.mod]) near the rim at the note angle.
  _modGlyph(eye, n, p) {
    const { ctx } = this;
    const rp = this._rimPt(eye, n.angle, 1.4);
    ctx.save();
    ctx.globalAlpha = Math.min(1, p * 2);
    ctx.shadowColor = COL.accent; ctx.shadowBlur = 8;
    ctx.fillStyle = COL.text; ctx.font = `800 ${eye.r * 0.3}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(MODS[n.mod] || n.mod, rp.x, rp.y);
    ctx.restore();
  }

  // Hit FX: neon shockwave rings + spark particles (no fish). Judgement text rises and fades.
  _effects(ring, eye, songTime) {
    const { ctx } = this;
    this.effects = this.effects.filter((e) => songTime - e.t0 < e.dur);
    for (const e of this.effects) {
      if (e.ring !== ring) continue;
      const age = (songTime - e.t0) / e.dur;
      const c = e.judgement === 'perfect' ? COL.perfect : e.judgement === 'good' ? COL.good : COL.miss;
      const v = e.angle != null ? angleVec(e.angle) : { x: 0, y: -1 };
      const rx = eye.x + v.x * eye.r, ry = eye.y + v.y * eye.r;
      // expanding shockwave ring (bigger/brighter on a perfect)
      const big = e.judgement === 'perfect' ? 2.4 : 1.6;
      ctx.save();
      ctx.shadowColor = c; ctx.shadowBlur = 16 * (1 - age);
      ctx.beginPath(); ctx.arc(rx, ry, eye.r * 0.25 * (1 + age * big), 0, Math.PI * 2);
      ctx.strokeStyle = this._alpha(c, (1 - age) * 0.9); ctx.lineWidth = 5 * (1 - age); ctx.stroke();
      // spark particles scattering outward
      if (e.spark) {
        ctx.fillStyle = this._alpha(c, (1 - age) * 0.95);
        for (const s of e.spark) {
          const d = eye.r * (0.2 + age * 1.6 * s.sp);
          const sx = rx + Math.cos(s.a) * d, sy = ry + Math.sin(s.a) * d;
          ctx.beginPath(); ctx.arc(sx, sy, eye.r * 0.05 * (1 - age), 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
      // judgement text: rises, scales in, glows
      ctx.save();
      ctx.globalAlpha = 1 - age; ctx.fillStyle = c;
      ctx.shadowColor = c; ctx.shadowBlur = 18 * (1 - age);
      const fs = eye.r * (e.judgement === 'perfect' ? 0.5 : 0.42) * (1 + (1 - Math.min(1, age * 4)) * 0.35);
      ctx.font = `900 ${fs}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(e.judgement.toUpperCase(), eye.x, eye.y - eye.r * 1.55 - age * 24);
      ctx.restore();
    }
  }

  // HUD at the very TOP edge: a song-progress bar across the top; SCORE left, ACCURACY right, big
  // COMBO + track title centred. Neon over black (no background fill — the 3D stage shows through).
  _topbar(scorer, chart, songTime) {
    const { ctx, w, h } = this;
    const sc = scorer || { score: 0, combo: 0, accuracy: 1 };

    // --- song progress bar ---
    const barH = Math.max(5, h * 0.009);
    ctx.fillStyle = 'rgba(8,18,26,0.7)'; ctx.fillRect(0, 0, w, barH);
    const prog = (chart && chart.duration > 0 && songTime > 0) ? Math.max(0, Math.min(1, songTime / chart.duration)) : 0;
    const pg = ctx.createLinearGradient(0, 0, w, 0);
    pg.addColorStop(0, COL.L); pg.addColorStop(1, COL.R);
    ctx.fillStyle = pg; ctx.fillRect(0, 0, w * prog, barH);
    if (prog > 0 && prog < 1) { ctx.fillStyle = this._alpha(COL.accent, 0.95); ctx.fillRect(w * prog - 1, 0, 3, barH); } // playhead

    const top = barH + h * 0.012;
    // --- score (left) / accuracy (right) ---
    ctx.textBaseline = 'top';
    const lab = `700 ${Math.max(9, h * 0.016)}px ui-monospace, monospace`;
    const big = `800 ${Math.max(16, h * 0.03)}px ui-monospace, monospace`;
    ctx.textAlign = 'left';
    ctx.fillStyle = COL.dim; ctx.font = lab; ctx.fillText('SCORE', w * 0.03, top);
    ctx.fillStyle = COL.text; ctx.font = big; ctx.fillText(String(sc.score).padStart(7, '0'), w * 0.03, top + h * 0.02);
    ctx.textAlign = 'right';
    ctx.fillStyle = COL.dim; ctx.font = lab; ctx.fillText('ACCURACY', w * 0.97, top);
    ctx.fillStyle = COL.text; ctx.font = big; ctx.fillText((sc.accuracy * 100).toFixed(1) + '%', w * 0.97, top + h * 0.02);

    // --- centre: track title + big combo ---
    ctx.textAlign = 'center';
    if (chart && chart.meta && chart.meta.title) {
      ctx.fillStyle = this._alpha(COL.dim, 0.85); ctx.font = `600 ${Math.max(10, h * 0.016)}px ui-monospace, monospace`;
      ctx.fillText(chart.meta.title, w / 2, top, w * 0.5);
    }
    if (sc.combo > 1) {
      const cs = Math.max(26, h * 0.062) * (1 + Math.min(0.28, this.pulse * 0.28));
      ctx.save(); ctx.shadowColor = COL.accent; ctx.shadowBlur = 22;
      ctx.fillStyle = COL.accent; ctx.font = `800 ${cs}px ui-monospace, monospace`;
      ctx.fillText(String(sc.combo), w / 2, top + h * 0.022);
      ctx.restore();
      ctx.fillStyle = COL.dim; ctx.font = `700 ${Math.max(8, h * 0.013)}px ui-monospace, monospace`;
      ctx.fillText('COMBO', w / 2, top + h * 0.022 + cs);
    }
  }

  _countIn(songTime) {
    const { ctx, w, h } = this;
    ctx.save();
    ctx.fillStyle = COL.text; ctx.globalAlpha = 0.9;
    ctx.shadowColor = COL.accent; ctx.shadowBlur = 24;
    ctx.font = `900 ${h * 0.18}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.ceil(-songTime)), w / 2, h * 0.34);
    ctx.restore();
  }

  /** Trigger a transient centred banner (e.g. "50 COMBO") that scales up and fades. */
  showBanner(text) { this._banner = { text, life: 1 }; this.pulse = 1; }

  _drawBanner() {
    const { ctx, w, h } = this;
    const b = this._banner;
    const grow = 1 + (1 - b.life) * 0.45;
    ctx.save();
    ctx.globalAlpha = Math.min(1, b.life * 1.5);
    ctx.translate(w / 2, h * 0.3); ctx.scale(grow, grow);
    ctx.shadowColor = COL.accent; ctx.shadowBlur = 28;
    ctx.fillStyle = COL.accent; ctx.font = `900 ${Math.max(30, h * 0.072)}px ui-monospace, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(b.text, 0, 0);
    ctx.restore();
    b.life -= 0.018;
    if (b.life <= 0) this._banner = null;
  }

  _demoBadge() {
    const { ctx, w, h } = this;
    ctx.save();
    ctx.globalAlpha = 0.7; ctx.fillStyle = COL.dim;
    ctx.font = `700 ${Math.max(11, h * 0.022)}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('▶ DEMO · auto-play — Back/Esc to exit', w / 2, h - 14);
    ctx.restore();
  }

  _glitchOverlay() {
    const { ctx, w, h } = this;
    const g = this.glitch;
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 6 * g; i++) {
      const y = Math.random() * h, sh = 4 + Math.random() * 22;
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,43,214,0.28)' : 'rgba(0,240,255,0.28)';
      ctx.fillRect(0, y, w, sh);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(255,59,107,${0.08 * g})`; ctx.fillRect(0, 0, w, h);
  }

  _roundRect(x, y, w, h, r) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _alpha(hex, a) {
    if (hex.startsWith('rgba')) return hex;
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
}
