// gen-electric-feel.mjs — build a BPM-GRID flow chart for "Electric Feel (Justice Remix)".
//
// No audio decoding here: the track is a steady 4/4 at 107 BPM, so we lay notes straight onto the
// beat grid and choreograph DELIBERATE phrase texture (not all one type). Each 8-note phrase mixes
// taps (the backbone), a couple of traced slides, a parked hold, the occasional spinner / center
// "look straight ahead" beat, and a rare shoulder-button accent. Hands alternate L/R and the target
// `angle` flows continuously — every note hands its heading to the next; slides set `to`.
//
//   node scripts/gen-electric-feel.mjs   ->  writes beatmaps/electric-feel.json
//
// Vocabulary this fork's parser eats (src/chart.js):
//   {time, ring:"L"|"R", angle}            -> tap
//   + hold:<sec>                           -> hold
//   + to:<deg>                             -> slide (angle sweeps -> to over hold)
//   + spin:<count> (+ hold) [+ spinDir]    -> spinner (spinDir 1|-1 picks rotation sense)
//   + center:true                          -> center note (pull stick to neutral)
//   + mod:"L1"|"R1"|"L2"|"R2"              -> shoulder accent (face/dpad mods forbidden here)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'beatmaps', 'electric-feel.json');

const BPM = 107;
const SEC_PER_BEAT = 60 / BPM;          // ~0.5607 s
const START_BEAT = 8;                   // ~4.5 s intro before the first note
const NOTES_END_SEC = 300;              // ~300 s of playable notes (track is ~327 s)

const wrap360 = (d) => ((Math.round(d) % 360) + 360) % 360;
const round3 = (x) => +x.toFixed(3);

// ---------------------------------------------------------------------------
// Phrase template: 8 slots per phrase. Each slot names a type ('rest' drops the
// beat so the chart breathes and the count lands ~280, not one-per-beat). The
// type mix in the templates plus the spinner injections is tuned so the final
// distribution lands near: ~45% tap, ~22% slide, ~15% hold, ~8% spin,
// ~10% center, ~5% mod.
//
// Four rotating phrase shapes keep it from feeling like a loop:
//   A: tap-led drive, two slides, a hold      (verse)
//   B: breath — hold + center + a slide        (chorus lift)
//   C: tap run with a slide tail               (build)
//   D: sparse, center-anchored                 (bridge)
// ---------------------------------------------------------------------------
const PHRASES = [
  ['hold', 'tap', 'slide', 'rest', 'tap', 'slide', 'tap', 'rest'],   // A
  ['center', 'tap', 'hold', 'rest', 'slide', 'tap', 'tap', 'rest'],  // B
  ['tap', 'tap', 'slide', 'rest', 'hold', 'tap', 'slide', 'rest'],   // C
  ['center', 'rest', 'hold', 'tap', 'slide', 'rest', 'tap', 'center'],// D
];

const MOD_CYCLE = ['L1', 'R1', 'L2', 'R2']; // shoulders only — fork forbids face/dpad

// Build the beat grid (one slot per beat from START_BEAT up to the cutoff).
const beats = [];
for (let b = START_BEAT; b * SEC_PER_BEAT < NOTES_END_SEC; b++) beats.push(b);

// Pick spinner phrases: a spinner roughly every ~3rd phrase at a phrase boundary
// where the music opens up. Alternate solo-eye (one ring) vs both-rings for variety.
const totalPhrases = Math.ceil(beats.length / 8);
const spinPhrases = new Map(); // phraseIndex -> { both:boolean }
for (let p = 3; p < totalPhrases; p += 3) {
  // every other spinner is a "both eyes" spin; the rest are solo-eye
  spinPhrases.set(p, { both: (Math.floor(p / 3)) % 2 === 0 });
}

// Pick DUAL-HOLD phrases: the downbeat (pos 0) becomes a paired L-hold + R-hold at the SAME time
// so the player parks BOTH sticks at once. Roughly one every other phrase (~1 per 2 phrases),
// skipping phrase 0 (easy intro) and any phrase already claimed by a spinner.
const dualHoldPhrases = new Set();
for (let p = 2; p < totalPhrases; p += 2) {
  if (!spinPhrases.has(p)) dualHoldPhrases.add(p);
}

// Resolve OVERLAPS so notes never pile on the same eye: drop same-ring notes <70 ms apart, and clamp
// each sustained span to end before the next same-ring note.
function fixOverlaps(all) {
  const kept = [];
  for (const ring of ['L', 'R']) {
    const a = all.filter((n) => n.ring === ring).sort((x, y) => x.time - y.time);
    const pri = (x) => x.center ? 4 : x.spin > 0 ? 3 : (x.hold > 0 || x.to != null) ? 2 : 1;
    const r = [];
    for (const n of a) {
      const prev = r[r.length - 1];
      if (prev && n.time - prev.time < 0.07) { if (pri(n) > pri(prev)) r[r.length - 1] = n; continue; }
      r.push(n);
    }
    for (let i = 0; i < r.length; i++) { const n = r[i], next = r[i + 1]; if (n.hold && next) { const m = next.time - 0.08; if (n.time + n.hold > m) n.hold = Math.max(0.12, +(m - n.time).toFixed(3)); } }
    kept.push(...r);
  }
  return kept.sort((x, y) => x.time - y.time);
}

// MAGNITUDE per note — FULL variety from the rim (mag~1) down to barely-moved near centre (mag~0.06).
// Swing a wander value then STRETCH it away from the middle so notes land near an extreme (big throw
// or tiny nudge), not bunched mid-eye. Holds park more moderate.
function magFor(i, phrase, type) {
  let m = 0.5 + 0.5 * Math.sin(i * 1.7 + phrase * 0.6);
  m = 0.5 + (m - 0.5) * 1.7;
  if (type === 'hold') m = 0.34 + 0.36 * (0.5 + 0.5 * Math.sin(i));
  return +Math.max(0.06, Math.min(1.0, m)).toFixed(3);
}

let notes = [];
let heading = 0;       // running target heading (deg) handed note-to-note
let sweepDir = 1;      // flips per phrase so the stick path snakes back and forth
let hand = 0;          // running emitted-note counter -> L/R alternates on actual notes (not beats)

for (let i = 0; i < beats.length; i++) {
  const beat = beats[i];
  const t = beat * SEC_PER_BEAT;
  const phrase = Math.floor(i / 8);
  const pos = i % 8;
  if (pos === 0) sweepDir = phrase % 2 === 0 ? 1 : -1;

  const template = PHRASES[phrase % PHRASES.length];
  let type = template[pos];
  // FLICKY: thin most templated holds/slides down to snappy taps so the song plays flickier.
  if ((type === 'hold' || type === 'slide') && i % 2 === 0) type = 'tap';

  // 'rest' drops the beat entirely (keeps the chart breathing / count sane).
  if (type === 'rest' && !(spinPhrases.has(phrase) && pos === 0)) continue;

  // --- spinner injection: replace the downbeat of a designated phrase --------
  if (spinPhrases.has(phrase) && pos === 0) {
    const { both } = spinPhrases.get(phrase);
    const spinDir = sweepDir; // spin the way the phrase is sweeping
    const spinCount = (phrase % 3 === 0) ? 3 : 2;
    const holdLen = round3(SEC_PER_BEAT * (both ? 3 : 2.5));
    if (both) {
      // both eyes spin together — two notes, one per ring, same time (self-balanced)
      notes.push({ time: round3(t), ring: 'L', angle: wrap360(heading), spin: spinCount, hold: holdLen, spinDir, mag: 0.6 });
      notes.push({ time: round3(t), ring: 'R', angle: wrap360(heading + 180), spin: spinCount, hold: holdLen, spinDir: -spinDir, mag: 0.6 });
    } else {
      // solo-eye spin — just this ring rotates
      notes.push({ time: round3(t), ring: hand % 2 === 0 ? 'L' : 'R', angle: wrap360(heading), spin: spinCount, hold: holdLen, spinDir, mag: 0.6 });
      hand++;
    }
    heading = wrap360(heading + 50 * sweepDir);
    continue;
  }

  // --- DUAL HOLD injection: park BOTH eyes on this phrase's downbeat (two notes, same time) ---
  if (dualHoldPhrases.has(phrase) && pos === 0) {
    const span = round3(SEC_PER_BEAT * 1.4); // overlapping ~1.5-beat parks on both rings
    notes.push({ time: round3(t), ring: 'L', angle: wrap360(heading), hold: span, mag: 0.55 });
    notes.push({ time: round3(t), ring: 'R', angle: wrap360(heading + 180), hold: span, mag: 0.55 });
    // these consume the downbeat without advancing the L/R `hand` counter (self-balanced pair)
    heading = wrap360(heading + 30 * sweepDir);
    continue;
  }

  // ASYMMETRY: one eye LEADS each couple of phrases (carries ~3 of every 5 notes), then the lead
  // swaps — the busy hand shifts back and forth instead of a metronomic L/R/L/R.
  const lead = (Math.floor(phrase / 2) % 2 === 0) ? 'L' : 'R';
  const ring = (hand % 5 < 3) ? lead : (lead === 'L' ? 'R' : 'L');
  hand++;
  const note = { time: round3(t), ring };
  note.mag = magFor(i, phrase, type);                          // place it anywhere centre→edge

  if (type === 'center') {
    // CENTER beat — pull the stick to neutral. Lands on a downbeat for a "look straight" moment.
    note.center = true;
    note.angle = wrap360(heading); // approach heading still set for visuals
    heading = wrap360(heading + 24 * sweepDir);
  } else if (type === 'slide') {
    const span = 60 + 30 * Math.abs(Math.sin(i)); // 60..90 deg traced line
    const to = wrap360(heading + span * sweepDir);
    note.angle = wrap360(heading);
    note.to = to;
    note.hold = round3(Math.min(SEC_PER_BEAT * 0.9, 0.95));
    note.magTo = +Math.max(0.14, Math.min(0.95, note.mag + 0.34 * sweepDir)).toFixed(3);  // spiral in/out → wiggly path
    heading = to;                                  // continue the line from where it ended
  } else if (type === 'hold') {
    note.angle = wrap360(heading);
    note.hold = round3(Math.min(SEC_PER_BEAT * 1.4, 0.9)); // park ~1.5 beats
    heading = wrap360(heading + 28 * sweepDir);
  } else {
    // tap — small heading advance so consecutive taps sit near each other (easy to flow between)
    note.angle = wrap360(heading);
    heading = wrap360(heading + 30 * sweepDir);
  }

  // SIDE-MATCHED TRIGGERS — frequent (~1 in 3 taps/holds): a LEFT-eye note needs L1/L2, a RIGHT-eye
  // note R1/R2 (trigger under the same hand as the stick). Held WHILE the pupil is on the spot.
  if (i > 12 && i % 3 === 0 && (type === 'tap' || type === 'hold')) {
    note.mod = ring === 'L' ? (i % 6 === 0 ? 'L2' : 'L1') : (i % 6 === 0 ? 'R2' : 'R1');
  }

  notes.push(note);
}

notes = fixOverlaps(notes);   // no two notes piling on the same eye; holds end before the next note

const out = {
  meta: {
    title: 'Electric Feel (Justice Remix)',
    artist: 'MGMT / Justice',
    audio: 'electric-feel.mp3',
    bpm: BPM,
    offset: 0,
    approachTime: 1.8,
    difficulty: 'Normal',
  },
  notes,
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

// --- report -----------------------------------------------------------------
const counts = { tap: 0, hold: 0, slide: 0, spin: 0, center: 0 };
let mods = 0, L = 0, R = 0, soloSpins = 0, bothSpinNotes = 0;
const holdByTime = {};   // time -> { L, R } count of plain holds, for dual-hold detection
for (const n of notes) {
  let ty;
  if (n.center) ty = 'center';
  else if ((n.spin || 0) > 0) ty = 'spin';
  else if (n.to != null) ty = 'slide';
  else if (n.hold > 0) ty = 'hold';
  else ty = 'tap';
  counts[ty]++;
  if (n.mod) mods++;
  n.ring === 'L' ? L++ : R++;
  if (ty === 'hold') (holdByTime[n.time] = holdByTime[n.time] || { L: 0, R: 0 })[n.ring]++;
}
let dualHolds = 0;
for (const t in holdByTime) if (holdByTime[t].L > 0 && holdByTime[t].R > 0) dualHolds++;
// count solo-eye spin phrases vs both-eye spin phrases from the planner
let soloPhrases = 0, bothPhrases = 0;
for (const { both } of spinPhrases.values()) both ? bothPhrases++ : soloPhrases++;

const total = notes.length;
const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;
console.log(`wrote ${OUT}`);
console.log(`total notes: ${total}  (span ${round3(notes[0].time)}s .. ${round3(notes[total - 1].time)}s)`);
console.log('per-type:');
for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(7)} ${String(v).padStart(4)}  ${pct(v)}`);
console.log(`L/R balance: L=${L}  R=${R}`);
console.log(`mods: ${mods}  (${pct(mods)})`);
console.log(`center: ${counts.center}  (${pct(counts.center)})`);
console.log(`spin notes: ${counts.spin}  | spin phrases: ${spinPhrases.size}  (solo-eye=${soloPhrases}, both-eyes=${bothPhrases})`);
console.log(`DUAL-HOLD pairs (same time, L-hold + R-hold): ${dualHolds}  | dual-hold phrases planned: ${dualHoldPhrases.size}`);
