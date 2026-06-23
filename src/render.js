// render.js — EYE BEATS, the 2D-canvas NOTE + HUD overlay (TRANSPARENT background).
//
// Psychedelic LSD/hippy theme: neon shapes on black, rainbow flourishes. This canvas sits ON TOP of
// the Three.js eyeball stage (eyes3d.js). It paints nothing behind the notes — the 3D eyes show
// through. The two "rings" are each EYE, targeted at its projected screen position
// (`state.eyes = { L:{x,y,r}, R:{x,y,r} }` from EyeStage.screen). The eye holds still; the notes
// come to it. LEFT-eye notes are the BLUE family, RIGHT-eye the PINK family
// (per COLVAR); a lit note flares white. A MISS glitches the screen.
//
// Every note TYPE gets a DISTINCT icon so the kind is instantly readable:
//   tap → a sharp chevron/arrowhead BOLT streaking inward (a quick flick).
//   hold → a FAT lane beam + coverage gauge arc (clearly heavier than a flick).
//   slide → a CURVED ARROW hugging the rim from angle→angleTo with a moving arrowhead.
//   spin → rotating circular arrows + a gauge ring filling with coverage.
//   center → concentric target rings collapsing onto the pupil + "CENTER" cue.
// A GAZE line + pupil dot is drawn from each eye along the player's stick (state.input.left/.right)
// so they can ALIGN the pupil with the incoming note line to score.
//
// API (unchanged, what main.js calls): new Renderer(canvas) · drawGame(state) · addEffect(e) ·
// addFlick(f) · showBanner(text) · public fields .effects .flickFx .pulse .glitch .trail

import { angleVec, wrapPi, noteTargetAngle, MODS } from './chart.js';
import { TAP_ARC, HOLD_ARC, SLIDE_ARC, PRESENCE_MAG } from './scoring.js';

// HUD/score/combo/banner/judgement font — 'Bungee' (loaded via Google Fonts + preloaded by main.js).
const FONT = "'Bungee', ui-monospace, monospace";

const COL = {
  L: '#00f0ff', R: '#ff2bd6',                 // electric cyan / electric magenta — the two eyes
  text: '#eafcff', dim: '#79b7c8',            // HUD ink, neon over black
  perfect: '#7dffea', good: '#9bff8a', miss: '#ff3b6b',
  accent: '#c8ff00',                           // acid lime — combo / banners
};
const ringColor = (r) => (r === 'L' ? COL.L : COL.R);

// Psychedelic rainbow: cycle hue over time (and by phase offset) for HUD accent / combo flourishes,
// WITHOUT touching the per-side note colour-coding.
const rainbow = (t, phase = 0, sat = 100, light = 60) => `hsl(${((t * 60 + phase) % 360 + 360) % 360},${sat}%,${light}%)`;

// Each note TYPE gets its own colour, but always within its side's FAMILY — the left eye's notes
// are variants of BLUE, the right eye's are variants of PINK — so you can read both the side and
// the kind at a glance.
const COLVAR = {
  L: { tap: '#00f0ff', hold: '#2f6bff', slide: '#00b3ff', spin: '#7a4dff', center: '#aef6ff' },
  R: { tap: '#ff2bd6', hold: '#ff4d7a', slide: '#ff66c4', spin: '#c94dff', center: '#ffc2ec' },
};

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

    // a very faint centre reticle + 8-direction tick guides at each eye (so diagonals read clear)
    for (const ring of ['L', 'R']) this._reticle(eyes[ring], ring);

    // the notes per ring, then the player's GAZE/aim line, then hit FX on top
    for (const ring of ['L', 'R']) {
      if (chart) this._notes(ring, eyes[ring], chart, songTime);
      this._gaze(ring, eyes[ring], state, chart, songTime);
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

  // A faint crosshair + 8-direction tick guides ringing the eye, so notes arriving on the diagonals
  // (top-left/right, bottom-left/right) read just as clearly as the cardinals. Throbs gently.
  _reticle(eye, ring) {
    const { ctx } = this;
    const c = ringColor(ring);
    const r = eye.r;
    const throb = 0.10 + 0.05 * (0.5 + 0.5 * Math.sin(this._t * 3));
    ctx.save();
    // centre crosshair
    ctx.strokeStyle = this._alpha(c, throb + 0.04);
    ctx.lineWidth = 1;
    const t = r * 0.16;
    ctx.beginPath();
    ctx.moveTo(eye.x - t, eye.y); ctx.lineTo(eye.x + t, eye.y);
    ctx.moveTo(eye.x, eye.y - t); ctx.lineTo(eye.x, eye.y + t);
    ctx.stroke();
    // 8 short direction ticks just outside the rim (cardinals + diagonals)
    ctx.strokeStyle = this._alpha(c, throb);
    ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      const diag = k % 2 === 1;
      const inP = this._rimPt(eye, a, 1.22);
      const outP = this._rimPt(eye, a, diag ? 1.42 : 1.36);
      ctx.beginPath(); ctx.moveTo(inP.x, inP.y); ctx.lineTo(outP.x, outP.y); ctx.stroke();
    }
    ctx.restore();
  }

  // GAZE / ALIGNMENT — draw the player's aim as a pupil dot + aim line from the eye centre along the
  // stick direction (screen y-down, magnitude-scaled). Brightens when it lines up with a LIVE note on
  // this eye (or any n.lit on this eye), so "align the pupil with the line to score" is tangible.
  // Guarded: no input → nothing drawn.
  _gaze(ring, eye, state, chart, songTime) {
    const input = state && state.input;
    if (!input) return;
    const s = ring === 'L' ? input.left : input.right;
    if (!s) return;
    const { ctx } = this;
    const mag = Math.max(0, Math.min(1, s.mag || 0));
    const aim = Math.atan2(s.y, s.x);
    const c = ringColor(ring);

    // is the pupil lined up with a live/lit note on this eye? -> brighten the gaze
    let aligned = false;
    if (chart && mag > PRESENCE_MAG * 0.6) {
      for (const n of chart.notes) {
        if (n.ring !== ring || n.judged) continue;
        if (n.lit) { aligned = true; break; }
        const dt = n.time - songTime;
        if (dt < -((n.hold || 0) + 0.2) || dt > 0.5) continue;
        const targ = noteTargetAngle(n, songTime);
        if (Math.abs(wrapPi(targ - aim)) < (SLIDE_ARC * 0.9)) { aligned = true; break; }
      }
    }
    const lit = aligned;
    const reach = eye.r * (0.55 + mag * 0.85);  // pupil pushed toward the rim by deflection
    const px = eye.x + Math.cos(aim) * reach * mag;
    const py = eye.y + Math.sin(aim) * reach * mag;

    ctx.save();
    ctx.lineCap = 'round';
    // aim line from centre out past the rim, so it visibly reaches toward the incoming note line
    const tip = this._rimPt(eye, aim, 1.55);
    ctx.shadowColor = lit ? '#ffffff' : c; ctx.shadowBlur = lit ? 20 : 10;
    ctx.strokeStyle = this._alpha(lit ? '#ffffff' : c, (lit ? 0.85 : 0.4) * (0.4 + mag * 0.6));
    ctx.lineWidth = eye.r * (lit ? 0.07 : 0.045);
    ctx.beginPath(); ctx.moveTo(eye.x, eye.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    // pupil / cursor dot
    ctx.shadowBlur = lit ? 18 : 10;
    ctx.fillStyle = this._alpha(lit ? '#ffffff' : c, 0.95);
    ctx.beginPath(); ctx.arc(px, py, eye.r * (lit ? 0.15 : 0.11), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // --- geometry helpers (names preserved) ---------------------------------
  // A point on the eye's rim for a given heading; `frac` scales the radius.
  _rimPt(eye, a, frac = 1) { const v = angleVec(a); return { x: eye.x + v.x * eye.r * frac, y: eye.y + v.y * eye.r * frac }; }
  // The incoming note head; p 0→1 as it approaches. Comes from FAR out (≈half the screen) so you
  // read it well before it lands, and at EVERY heading (incl. the four diagonals) without colliding
  // with the centred face — independent of how small the eye is on screen.
  _runwayPt(eye, a, p) {
    const v = angleVec(a);
    const far = Math.min(this.w, this.h) * 0.5;
    const d = eye.r + far * (1 - p);
    return { x: eye.x + v.x * d, y: eye.y + v.y * d };
  }

  // Colour for a note: its side's family (blue L / pink R), varied by type.
  _noteCol(ring, type) { return (COLVAR[ring] && COLVAR[ring][type]) || ringColor(ring); }

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

  // A filled chevron / arrowhead pointing along heading `a` at point p, size s. The "flick" glyph.
  _chevron(p, a, s, col, lit, alpha = 1) {
    const { ctx } = this;
    const bright = lit ? '#ffffff' : col;
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(a);
    ctx.shadowColor = bright; ctx.shadowBlur = lit ? 20 : 12;
    ctx.fillStyle = this._alpha(bright, alpha);
    // a sharp arrowhead opening backward (tip leads, toward +x = heading)
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.7, -s * 0.85);
    ctx.lineTo(-s * 0.25, 0);
    ctx.lineTo(-s * 0.7, s * 0.85);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Notes draw per TYPE with DISTINCT icons converging on the eye. Nothing is a discrete press — you're scored
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
      if (n.mod) this._modIncoming(eye, n, songTime, p);
    }
  }

  // TAP — a FLICK: a sharp thin CHEVRON / arrowhead bolt streaking inward toward the rim at n.angle,
  // with a tiny thin streak tail. Snappy and light (deliberately the opposite of the fat HOLD beam).
  // A faint bite-arc marks the rim landing zone; everything pulses brighter as it approaches.
  _noteTap(eye, n, songTime, p, dt, arcScale = 1) {
    const c = this._noteCol(n.ring, n.type);
    const near = Math.abs(dt) < 0.12;
    const pulse = 0.6 + 0.4 * Math.sin(this._t * 8 + n.time * 5);   // throb as it nears
    // faint rim bite-zone so you see exactly where it lands
    this._rimArc(eye, n.angle, TAP_ARC * arcScale, c, (near ? 0.9 : 0.32) * Math.min(1, p * 2), eye.r * (near ? 0.12 : 0.07), n.lit);
    // thin snappy streak just behind the arrowhead
    const head = this._runwayPt(eye, n.angle, p);
    const tail = this._runwayPt(eye, n.angle, Math.max(0, p - 0.16));
    this._beam(tail, head, c, n.lit, eye.r * 0.035, eye.r * 0.085);
    // the arrowhead itself — the unmistakable "flick" icon, pointing inward (toward the eye)
    const s = eye.r * (0.30 + 0.06 * pulse) * (near ? 1.15 : 1);
    this._chevron(head, n.angle + Math.PI, s, c, n.lit, Math.min(1, p * 2.2));
  }

  // HOLD — a FAT lane BEAM / chunky bar locked at n.angle (clearly heavier than a flick) framed by
  // rail edges, + a coverage gauge arc on the rim filling with n.coverage. Reads as "park here".
  _noteHold(eye, n, songTime, p, arcScale = 1) {
    const { ctx } = this;
    const c = this._noteCol(n.ring, n.type);
    const arc = HOLD_ARC * arcScale;
    const throb = 0.85 + 0.15 * Math.sin(this._t * 6);
    // fat beam from outside straight into the rim point
    const head = this._rimPt(eye, n.angle, 1.0);
    const tail = this._runwayPt(eye, n.angle, songTime < n.time ? p : 1);
    this._beam(tail, head, c, n.lit, eye.r * 0.20 * throb, eye.r * 0.5);
    // rail edges flanking the lane so the "fat bar" is unmistakable
    const v = angleVec(n.angle), perp = { x: -v.y, y: v.x };
    const off = eye.r * 0.26;
    ctx.save(); ctx.lineCap = 'round'; ctx.shadowColor = n.lit ? '#fff' : c; ctx.shadowBlur = n.lit ? 14 : 8;
    ctx.strokeStyle = this._alpha(n.lit ? '#ffffff' : c, 0.55 * Math.min(1, p * 2)); ctx.lineWidth = eye.r * 0.03;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(tail.x + perp.x * off * sgn, tail.y + perp.y * off * sgn);
      ctx.lineTo(head.x + perp.x * off * sgn, head.y + perp.y * off * sgn);
      ctx.stroke();
    }
    ctx.restore();
    // coverage gauge: faint full arc + a bright fill that grows with coverage
    this._rimArc(eye, n.angle, arc, c, 0.28 * Math.min(1, p * 2), eye.r * 0.18, false);
    if (n.coverage > 0) this._rimArc(eye, n.angle, arc * n.coverage, c, 0.9, eye.r * 0.26, n.lit);
  }

  // SLIDE — a CURVED ARROW track hugging the rim from angle→angleTo. Faint full curved path to trace,
  // a bright traced portion up to the current head, and a MOVING ARROWHEAD riding the curve so it
  // unmistakably reads "trace this curve". Uses noteTargetAngle for the head position.
  _noteSlide(eye, n, songTime, p) {
    const { ctx } = this;
    const c = this._noteCol(n.ring, n.type);
    const a0 = n.angle, a1 = n.angleTo, sweep = wrapPi(a1 - a0);
    const pathR = eye.r * 0.96;
    // faint full path to trace
    ctx.save(); ctx.lineCap = 'round'; ctx.shadowColor = c; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(eye.x, eye.y, pathR, a0, a0 + sweep, sweep < 0);
    ctx.strokeStyle = this._alpha(c, 0.26 * Math.min(1, p * 2)); ctx.lineWidth = eye.r * 0.1; ctx.stroke();
    // bright traced portion up to the current head
    const u = n.hold > 0 ? Math.max(0, Math.min(1, (songTime - n.time) / n.hold)) : 0;
    if (u > 0) {
      ctx.shadowColor = n.lit ? '#ffffff' : c; ctx.shadowBlur = n.lit ? 22 : 14;
      ctx.beginPath(); ctx.arc(eye.x, eye.y, pathR, a0, a0 + sweep * u, sweep < 0);
      ctx.strokeStyle = this._alpha(n.lit ? '#ffffff' : c, 0.9); ctx.lineWidth = eye.r * 0.15; ctx.stroke();
    }
    ctx.restore();
    // start-cap dot so you see where the trace BEGINS
    const startP = this._rimPt(eye, a0, 0.96);
    ctx.save(); ctx.shadowColor = c; ctx.shadowBlur = 10; ctx.fillStyle = this._alpha(c, 0.7 * Math.min(1, p * 2));
    ctx.beginPath(); ctx.arc(startP.x, startP.y, eye.r * 0.08, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    // the MOVING arrowhead riding the curve, pointing along the sweep (the "follow me" head)
    const head = noteTargetAngle(n, songTime);
    const onRim = songTime >= n.time;
    if (onRim) {
      const hp = this._rimPt(eye, head, 0.96);
      const tangent = head + (sweep >= 0 ? Math.PI / 2 : -Math.PI / 2);   // along the curve direction
      this._chevron(hp, tangent, eye.r * 0.26, c, n.lit, 1);
    } else {
      // before it's live, a short incoming streak + arrowhead converging on the start
      const hp = this._runwayPt(eye, a0, p);
      const tail = this._runwayPt(eye, a0, Math.max(0, p - 0.18));
      this._beam(tail, hp, c, n.lit, eye.r * 0.06, eye.r * 0.14);
      this._chevron(hp, a0 + Math.PI, eye.r * 0.24, c, n.lit, Math.min(1, p * 2.2));
    }
  }

  // SPIN — rotating CIRCULAR ARROWS chasing around a gauge ring that fills with n.coverage, whirling
  // in n.spinDir. The curved-arrow arcs + arrowheads unmistakably say "rotate the stick".
  _noteSpin(eye, n, songTime, p) {
    const { ctx } = this;
    const c = this._noteCol(n.ring, n.type);
    const live = songTime >= n.time;
    const R = eye.r * 1.2;
    const dir = n.spinDir || 1;
    ctx.save();
    // gauge ring (the track that fills)
    ctx.shadowColor = c; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(eye.x, eye.y, R, 0, Math.PI * 2);
    ctx.strokeStyle = this._alpha(c, (live ? 0.4 : 0.2) * Math.min(1, p * 2)); ctx.lineWidth = eye.r * 0.12; ctx.stroke();
    if (n.coverage > 0) {
      ctx.lineCap = 'round'; ctx.shadowColor = n.lit ? '#fff' : c; ctx.shadowBlur = n.lit ? 22 : 12;
      ctx.beginPath();
      ctx.arc(eye.x, eye.y, R, -Math.PI / 2, -Math.PI / 2 + dir * Math.PI * 2 * n.coverage, dir < 0);
      ctx.strokeStyle = this._alpha(n.lit ? '#fff' : c, 0.95); ctx.lineWidth = eye.r * 0.16; ctx.stroke();
    }
    ctx.restore();
    // two rotating CURVED ARROWS chasing each other around the ring (the "spin me" icon)
    const spin = this._t * (live ? 6 : 2) * dir;
    const aR = R * 0.78;                    // radius of the chasing arrows
    ctx.save(); ctx.lineCap = 'round'; ctx.shadowColor = n.lit ? '#fff' : c; ctx.shadowBlur = live ? 14 : 8;
    const arcStroke = this._alpha(n.lit ? '#fff' : c, 0.92 * Math.min(1, p * 2));
    for (let k = 0; k < 2; k++) {
      const base = spin + k * Math.PI;
      const sweep = dir * 0.9;             // ~52° curved arc segment
      ctx.strokeStyle = arcStroke; ctx.lineWidth = eye.r * 0.09;
      ctx.beginPath(); ctx.arc(eye.x, eye.y, aR, base, base + sweep, dir < 0); ctx.stroke();
      // arrowhead at the leading end of the arc, pointing along the rotation
      const tipA = base + sweep;
      const tp = { x: eye.x + Math.cos(tipA) * aR, y: eye.y + Math.sin(tipA) * aR };
      const tangent = tipA + (dir >= 0 ? Math.PI / 2 : -Math.PI / 2);
      this._chevron(tp, tangent, eye.r * 0.2, c, n.lit, Math.min(1, p * 2));
    }
    ctx.restore();
    if (live) { ctx.save(); ctx.shadowColor = c; ctx.shadowBlur = 10; ctx.fillStyle = this._alpha('#fff', 0.85); ctx.font = `800 ${eye.r * 0.28}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SPIN', eye.x, eye.y - eye.r * 1.7); ctx.restore(); }
  }

  // CENTER — the: concentric rings CLOSING IN onto the eye centre as time nears
  // n.time, cueing the player to pull the stick to NEUTRAL. Brightens when lit (centred).
  _noteCenter(eye, n, songTime, p, dt) {
    const { ctx } = this;
    const c = this._noteCol(n.ring, n.type);
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
    ctx.font = `800 ${eye.r * 0.26}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('CENTER', eye.x, eye.y - eye.r * 1.7);
    ctx.restore();
  }

  // Modifier note (L1/R1/L2/R2): an INCOMING labelled badge that flies in along the runway with the
  // laser (not just a static glyph) so you see the shoulder/trigger button coming. Side-coloured.
  _modIncoming(eye, n, songTime, p) {
    const { ctx } = this;
    // ride the incoming head until it lands, then sit on the rim
    const rp = songTime >= n.time ? this._rimPt(eye, n.angle, 1.4) : this._runwayPt(eye, n.angle, p);
    const c = this._noteCol(n.ring, n.type);
    const bw = eye.r * 0.62, bh = eye.r * 0.36;
    ctx.save();
    ctx.globalAlpha = Math.min(1, p * 2.2);
    ctx.shadowColor = c; ctx.shadowBlur = 16;
    this._roundRect(rp.x - bw / 2, rp.y - bh / 2, bw, bh, bh * 0.32);
    ctx.fillStyle = this._alpha('#0a0a14', 0.82); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = this._alpha(n.lit ? '#ffffff' : c, 0.95); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = '#fff';
    ctx.font = `800 ${bh * 0.58}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
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
      ctx.font = `900 ${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
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
    if (prog > 0 && prog < 1) { ctx.fillStyle = rainbow(this._t, 0, 100, 60); ctx.fillRect(w * prog - 1, 0, 3, barH); } // hue-cycling playhead

    const top = barH + h * 0.012;
    // --- score (left) / accuracy (right) ---
    ctx.textBaseline = 'top';
    const lab = `700 ${Math.max(9, h * 0.016)}px ${FONT}`;
    const big = `800 ${Math.max(16, h * 0.03)}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = COL.dim; ctx.font = lab; ctx.fillText('SCORE', w * 0.03, top);
    ctx.fillStyle = COL.text; ctx.font = big; ctx.fillText(String(sc.score).padStart(7, '0'), w * 0.03, top + h * 0.02);
    ctx.textAlign = 'right';
    ctx.fillStyle = COL.dim; ctx.font = lab; ctx.fillText('ACCURACY', w * 0.97, top);
    ctx.fillStyle = COL.text; ctx.font = big; ctx.fillText((sc.accuracy * 100).toFixed(1) + '%', w * 0.97, top + h * 0.02);

    // --- centre: track title + big combo ---
    ctx.textAlign = 'center';
    if (chart && chart.meta && chart.meta.title) {
      ctx.fillStyle = this._alpha(COL.dim, 0.85); ctx.font = `600 ${Math.max(10, h * 0.016)}px ${FONT}`;
      ctx.fillText(chart.meta.title, w / 2, top, w * 0.5);
    }
    if (sc.combo > 1) {
      // combo + label hue-cycle through the rainbow (note colour-coding stays intact elsewhere)
      const hue = rainbow(this._t, sc.combo * 8, 100, 62);
      const cs = Math.max(26, h * 0.062) * (1 + Math.min(0.28, this.pulse * 0.28));
      ctx.save(); ctx.shadowColor = hue; ctx.shadowBlur = 22;
      ctx.fillStyle = hue; ctx.font = `800 ${cs}px ${FONT}`;
      ctx.fillText(String(sc.combo), w / 2, top + h * 0.022);
      ctx.restore();
      ctx.fillStyle = this._alpha(COL.dim, 0.9); ctx.font = `700 ${Math.max(8, h * 0.013)}px ${FONT}`;
      ctx.fillText('COMBO', w / 2, top + h * 0.022 + cs);
    }
  }

  _countIn(songTime) {
    const { ctx, w, h } = this;
    ctx.save();
    ctx.fillStyle = COL.text; ctx.globalAlpha = 0.9;
    ctx.shadowColor = rainbow(this._t, 0, 100, 60); ctx.shadowBlur = 24;
    ctx.font = `900 ${h * 0.18}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
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
    const hue = rainbow(this._t, 0, 100, 62);
    ctx.shadowColor = hue; ctx.shadowBlur = 28;
    ctx.fillStyle = hue; ctx.font = `900 ${Math.max(30, h * 0.072)}px ${FONT}`;
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
    ctx.font = `700 ${Math.max(11, h * 0.022)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
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
