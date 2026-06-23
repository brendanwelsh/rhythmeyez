// chart.js — beatmap constants, direction math, load/parse/normalize.
//
// Screen space is y-down. Gamepad stick axes are already y-down (pushing the stick up gives a
// negative Y), so a stick vector (x, y) maps straight onto a screen direction. That means the
// SAME vector table works for both "which way is this note" (render) and "which way did the
// player flick" (input).

/** The 8 flick directions, in clockwise order starting from "right" (angle 0). */
export const DIRS = [
  'right', 'downright', 'down', 'downleft', 'left', 'upleft', 'up', 'upright',
];

/** Unit vectors in screen space (y-down). */
const S = Math.SQRT1_2; // 0.7071…
export const DIR_VECTORS = {
  right:     { x:  1, y:  0 },
  downright: { x:  S, y:  S },
  down:      { x:  0, y:  1 },
  downleft:  { x: -S, y:  S },
  left:      { x: -1, y:  0 },
  upleft:    { x: -S, y: -S },
  up:        { x:  0, y: -1 },
  upright:   { x:  S, y: -S },
};

/** Modifier buttons a note can require — SHOULDERS/TRIGGERS ONLY so you never lift a thumb off a
 *  stick (face buttons + d-pad are reserved for menus). Mapped to a short on-screen glyph. */
export const MODS = {
  L1: 'L1', R1: 'R1', L2: 'L2', R2: 'R2',
};

/**
 * Convert a stick vector to one of the 8 direction names.
 * index = round(atan2(y, x) / (π/4)) gives 0=right, 2=down, 4=left, 6=up (y-down).
 */
export function vectorToDir(x, y) {
  let idx = Math.round(Math.atan2(y, x) / (Math.PI / 4));
  idx = ((idx % 8) + 8) % 8;
  return DIRS[idx];
}

export function dirVector(dir) {
  return DIR_VECTORS[dir] || { x: 0, y: 0 };
}

/** Unit vector for a continuous angle (radians, screen space y-down). */
export function angleVec(a) { return { x: Math.cos(a), y: Math.sin(a) }; }

/** Wrap an angle delta into (-π, π]. */
export function wrapPi(d) {
  d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return d;
}

/** Interpolate between two headings along the SHORTEST arc (u in 0..1). */
export function lerpAngle(a, b, u) { return a + wrapPi(b - a) * Math.max(0, Math.min(1, u)); }

/**
 * The angle a note's target occupies at song time `t`. Stationary for tap/hold/spin; for a
 * SLIDE it sweeps from `angle` to `angleTo` across the note's hold span (this is the "line" the
 * player traces). Shared by scoring, rendering and the demo so they always agree.
 */
export function noteTargetAngle(note, t) {
  if (note.type === 'slide' && note.hold > 0) {
    return lerpAngle(note.angle, note.angleTo, (t - note.time) / note.hold);
  }
  return note.angle;
}

/** Human label for a direction (used in debug / fallback rendering). */
export function dirArrowAngle(dir) {
  const v = dirVector(dir);
  return Math.atan2(v.y, v.x);
}

/**
 * Normalize a raw beatmap object into the runtime shape the game plays.
 * Adds defaults, sorts notes by time, applies meta.offset, and attaches per-note state.
 */
export function normalizeChart(raw) {
  const meta = raw.meta || {};
  const offset = Number(meta.offset) || 0;
  const approachTime = Number(meta.approachTime) || 1.5;

  const notes = (raw.notes || [])
    .map((n, i) => {
      const dirName = String(n.dir || 'up').toLowerCase();
      const ring = String(n.ring || 'L').toUpperCase() === 'R' ? 'R' : 'L';
      const mod = n.mod && MODS[n.mod] ? n.mod : null;
      // A note's target is a continuous ANGLE. Use a numeric `angle` (degrees) if given,
      // else derive it from the named `dir`. dir is kept (nearest of 8) for any legacy use.
      const baseDir = DIR_VECTORS[dirName] ? dirName : 'up';
      const angle = (n.angle != null && isFinite(n.angle))
        ? (Number(n.angle) * Math.PI) / 180
        : Math.atan2(DIR_VECTORS[baseDir].y, DIR_VECTORS[baseDir].x);

      // --- note vocabulary (flow model) -----------------------------------
      // spin: rotate the stick to fill a gauge.   slide: trace a moving target along the ring.
      // hold: keep the stick parked in the arc.    tap: just BE in the arc as it crosses.
      // center: pull the stick to NEUTRAL (the eye stares straight ahead — "inverted wakka").
      const isCenter = n.center === true;
      const isSpin = n.spin === true || (Number(n.spin) || 0) > 0;
      const hasTo = n.to != null && isFinite(n.to);
      let hold = Math.max(0, Number(n.hold) || 0);
      if (isSpin && hold <= 0) hold = 1.2;             // spinners need a span; default ~1 bar-ish
      const type = isCenter ? 'center' : isSpin ? 'spin' : hasTo ? 'slide' : hold > 0 ? 'hold' : 'tap';
      const angleTo = hasTo ? (Number(n.to) * Math.PI) / 180 : angle;
      const spins = Number(n.spin) || 0;
      const spinsNeed = type === 'spin' ? (spins > 0 ? spins : Math.max(2, Math.round(hold * 2))) : 0;
      const spinDir = Number(n.spinDir) < 0 ? -1 : 1;  // which way the eye whirls (default CW)

      return {
        id: i,
        time: Number(n.time) + offset,
        ring,
        type,
        angle,
        angleTo,                                       // slide end heading (== angle otherwise)
        dir: vectorToDir(Math.cos(angle), Math.sin(angle)),
        mod,
        hold,                                          // sustain seconds (0 = instantaneous tap)
        spinsNeed,                                     // full rotations to clear a spinner
        spinDir,                                       // +1 CW / -1 CCW (drives the eye spin)
        // runtime state (frame-driven presence/coverage scoring):
        judged: false,
        judgement: null,  // 'perfect' | 'good' | 'miss'
        lit: false,        // stick is satisfying this note THIS frame (drives live FX)
        coverage: 0,       // 0..1 fraction of the span satisfied (hold/slide/spin)
        bestErr: null,     // signed timing error of the best on-target moment (taps)
        _covered: 0,       // accumulated on-target seconds (hold/slide)
        _spin: 0,          // accumulated signed rotation radians (spin)
        _prevA: null,      // previous stick angle, for spin delta integration
      };
    })
    .sort((a, b) => a.time - b.time);

  // Re-id after sort so ids are stable index order.
  notes.forEach((n, i) => { n.id = i; });

  return {
    meta: {
      title: meta.title || 'Untitled',
      artist: meta.artist || 'Unknown',
      audio: meta.audio || null,
      bpm: Number(meta.bpm) || 120,
      offset,
      approachTime,
      difficulty: meta.difficulty || 'Normal',
    },
    notes,
    // The chart "ends" a bit after the final note (incl. its hold) so results wait for it.
    duration: notes.length ? Math.max(...notes.map((n) => n.time + n.hold)) + 2.5 : 5,
  };
}

/** Fetch + parse a beatmap JSON file by URL (used for the built-in charts). */
export async function loadChartFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load chart: ${url} (${res.status})`);
  return normalizeChart(await res.json());
}

/** Parse a beatmap JSON from a user-selected File object. */
export async function loadChartFromFile(file) {
  const text = await file.text();
  return normalizeChart(JSON.parse(text));
}
