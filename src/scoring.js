// scoring.js — Scorer: continuous, presence-based judgement for an analog-stick rhythm game.
//
// A thumbstick is an ABSOLUTE position inside a disc, not a button — so we don't judge a discrete
// "flick" at one instant. Every frame we ask, per note: is the stick where the note wants it?
//   tap   — be in the arc as the note CROSSES (no timed press). Graded by how centred you were.
//   hold  — keep the stick parked in the arc for the span. Graded by coverage.
//   slide — trace a target that sweeps along the ring. Graded by coverage of the moving line.
//   spin  — rotate the stick to fill a gauge. Graded by rotations completed.
// This is what makes it FLOW: you're rewarded for being on it / following it, not for snapping.
//
// All times in seconds, all driven off AudioEngine.time via the songTime passed each frame.

import { noteTargetAngle, wrapPi } from './chart.js';

export const WINDOWS = { perfect: 0.05, good: 0.13 };  // tap timing windows (± seconds)
const SCORE = { perfect: 300, good: 100, miss: 0 };
const HOLD_BONUS = 150;                 // bonus for clearing a sustained note
const SUSTAIN_RATE = 220;               // points/second while satisfying a hold/slide/spin

// How close (radians) the stick heading must be to the target to count as "on it". Generous on
// purpose — flow over precision. Slides/holds are looser than taps; spins only need engagement.
export const TAP_ARC = 0.70;            // ±~40°
export const HOLD_ARC = 0.95;           // ±~54°
export const SLIDE_ARC = 1.05;          // ±~60° (the line is moving — be forgiving)
export const PRESENCE_MAG = 0.42;       // stick must be deflected at least this much to "point"
export const CENTER_MAG = 0.28;         // for a CENTER note the stick must be BELOW this (neutral)

/** Shortest absolute angle between two headings (radians, 0..π). */
function angleGap(a, b) { return Math.abs(wrapPi(a - b)); }

export class Scorer {
  constructor() {
    // Difficulty profile: multiplies the base arcs/timing-windows. 1 = Normal. Easy widens both
    // (>1, more forgiving); Hard tightens them (<1, more precise). Set by main before each chart.
    this.arcScale = 1;
    this.winScale = 1;
    this.reset();
  }

  reset() {
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { perfect: 0, good: 0, miss: 0 };
    this.totalJudged = 0;
    this.events = [];   // judgement popups for the renderer to consume
  }

  /** Weighted accuracy 0..1 (Perfect = full, Good = third, Miss = 0). */
  get accuracy() {
    if (this.totalJudged === 0) return 1;
    return (this.counts.perfect + this.counts.good / 3) / this.totalJudged;
  }

  get grade() {
    const a = this.accuracy;
    if (this.counts.miss === 0 && a >= 0.99) return 'S';
    if (a >= 0.90) return 'A';
    if (a >= 0.80) return 'B';
    if (a >= 0.70) return 'C';
    return 'D';
  }

  _comboMultiplier() { return Math.min(4, 1 + Math.floor(this.combo / 10) * 0.5); }

  /** Commit a final judgement for a note and emit a feedback event. */
  _resolve(note, judgement, songTime) {
    note.judged = true;
    note.judgement = judgement;
    note.lit = false;
    this.counts[judgement]++;
    this.totalJudged++;
    if (judgement === 'miss') {
      this.combo = 0;
    } else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += Math.round(SCORE[judgement] * this._comboMultiplier());
      if (note.hold > 0) this.score += HOLD_BONUS;
    }
    this.events.push({ judgement, ring: note.ring, dir: note.dir, angle: noteTargetAngle(note, songTime), t: songTime });
  }

  /**
   * Advance every active note one frame against the current stick state. This REPLACES the old
   * discrete judgeFlick/updateHolds/checkMisses trio — notes resolve themselves when their window
   * passes. `dt` is the elapsed song-seconds since last frame (for coverage accumulation).
   */
  update(notes, input, songTime, dt) {
    // Per-difficulty effective arcs/windows (scaled off the base constants).
    const perfWin = WINDOWS.perfect * this.winScale;
    const tapWin = WINDOWS.good * this.winScale + 0.02;   // half-window a tap is evaluable around its time
    const tapArc = TAP_ARC * this.arcScale;
    const holdArc = HOLD_ARC * this.arcScale;
    const slideArc = SLIDE_ARC * this.arcScale;
    for (const n of notes) {
      if (n.judged) continue;
      n.lit = false;
      const s = n.ring === 'L' ? input.left : input.right;
      const engaged = !!s && s.mag >= PRESENCE_MAG;
      const centered = !s || s.mag <= CENTER_MAG;   // stick at neutral — for CENTER notes
      const sa = engaged ? Math.atan2(s.y, s.x) : 0;
      const t0 = n.time, t1 = n.time + n.hold;

      // CENTER — pull the stick to neutral as it crosses (or hold neutral for a span). The eye
      // stares straight ahead. Graded like a tap/hold but the "on-target" test is being CENTRED.
      if (n.type === 'center') {
        const modOk = n.mod ? input.heldMods().includes(n.mod) : true;
        if (n.hold > 0) {
          if (songTime < t0 - 0.10) continue;
          if (songTime >= t0 && songTime <= t1) {
            if (centered && modOk) { n.lit = true; n._covered += dt; this.score += Math.round(SUSTAIN_RATE * dt); }
            n.coverage = Math.min(1, n._covered / n.hold);
          }
          if (songTime > t1 + 0.06) { const c = n._covered / n.hold; this._resolve(n, c >= 0.82 ? 'perfect' : c >= 0.4 ? 'good' : 'miss', songTime); }
          continue;
        }
        if (songTime < t0 - tapWin) continue;
        const err = songTime - t0;
        if (centered && modOk) {
          n.lit = true;
          if (n.bestErr == null || Math.abs(err) < Math.abs(n.bestErr)) n.bestErr = err;
          if (Math.abs(err) <= perfWin) { this._resolve(n, 'perfect', songTime); continue; }
        }
        if (songTime > t0 + tapWin) this._resolve(n, n.bestErr == null ? 'miss' : Math.abs(n.bestErr) <= perfWin ? 'perfect' : 'good', songTime);
        continue;
      }

      if (n.type === 'tap') {
        if (songTime < t0 - tapWin) continue;
        const err = songTime - t0;
        const modOk = n.mod ? input.heldMods().includes(n.mod) : true;
        if (engaged && modOk && angleGap(sa, n.angle) <= tapArc) {
          n.lit = true;
          if (n.bestErr == null || Math.abs(err) < Math.abs(n.bestErr)) n.bestErr = err;
          if (Math.abs(err) <= perfWin) { this._resolve(n, 'perfect', songTime); continue; }
        }
        if (songTime > t0 + tapWin) {
          this._resolve(n, n.bestErr == null ? 'miss' : Math.abs(n.bestErr) <= perfWin ? 'perfect' : 'good', songTime);
        }
        continue;
      }

      // sustained types share a lead-in so they light up just before the head
      if (songTime < t0 - 0.10) continue;

      if (n.type === 'spin') {
        if (songTime >= t0 && songTime <= t1) {
          if (engaged) {
            if (n._prevA != null) n._spin += wrapPi(sa - n._prevA);
            n._prevA = sa;
            n.lit = true;
            this.score += Math.round(SUSTAIN_RATE * dt);
          } else { n._prevA = null; }
          n.coverage = Math.min(1, Math.abs(n._spin) / (Math.PI * 2) / n.spinsNeed);
        }
        if (songTime > t1 + 0.06) this._resolve(n, n.coverage >= 0.95 ? 'perfect' : n.coverage >= 0.5 ? 'good' : 'miss', songTime);
        continue;
      }

      // hold or slide: accrue on-target time against a (possibly moving) target angle
      if (songTime >= t0 && songTime <= t1) {
        const target = noteTargetAngle(n, songTime);
        const arc = n.type === 'slide' ? slideArc : holdArc;
        const modOk = n.mod ? input.heldMods().includes(n.mod) : true;
        if (engaged && modOk && angleGap(sa, target) <= arc) {
          n.lit = true;
          n._covered += dt;
          this.score += Math.round(SUSTAIN_RATE * dt);
        }
        n.coverage = n.hold > 0 ? Math.min(1, n._covered / n.hold) : (n.lit ? 1 : 0);
      }
      if (songTime > t1 + 0.06) {
        const cov = n.hold > 0 ? n._covered / n.hold : (n.lit ? 1 : 0);
        this._resolve(n, cov >= 0.82 ? 'perfect' : cov >= 0.4 ? 'good' : 'miss', songTime);
      }
    }
  }

  takeEvents() { const e = this.events; this.events = []; return e; }
}
