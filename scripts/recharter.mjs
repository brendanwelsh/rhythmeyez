// recharter.mjs — re-choreograph the base chart for VARIETY without moving any onset time.
//
// The original base chart was one long slide-chain (134 of 175 notes were slides — every note's
// angle == the previous note's `to`). That reads as a single endless line and feels monotonous on
// a 175-BPM DnB track. This pass keeps every note's `time` EXACTLY (so it stays locked to the
// audio) but re-assigns each note's TYPE / angle / hold / mod into deliberate 8-note phrases:
//
//   • taps as the staccato backbone (you flick onto the heading as the fish crosses),
//   • a couple of slides per phrase for the connected "draw a line" moments,
//   • a parked hold on most downbeats,
//   • a DUAL HOLD on roughly every other phrase's downbeat — an L-hold + an R-hold at the SAME
//     onset time, so the player parks BOTH sticks at once (the signature "hold both eyes" beat),
//   • a spinner to fill the big section-boundary gaps,
//   • the odd modifier button on an accent for spice.
//
// Angle flow stays continuous (each note hands its heading to the next) so the stick path still
// sweeps smoothly. Run:  node scripts/recharter.mjs   (rewrites beatmaps/raise-your-weapon.json)

import fs from 'node:fs';

const PATH = 'beatmaps/raise-your-weapon.json';
const src = JSON.parse(fs.readFileSync(PATH, 'utf8'));

// Preserve the onset times exactly (sorted, just in case).
const times = src.notes.map((n) => n.time).sort((a, b) => a - b);
const gapAfter = (i) => (i < times.length - 1 ? times[i + 1] - times[i] : 1.2);

const MOD_CYCLE = ['L1', 'R1', 'square', 'triangle']; // tasteful sprinkle on accents
const wrap360 = (d) => ((Math.round(d) % 360) + 360) % 360;

// Pick ~7 spinner slots on the BIGGEST gaps (section boundaries), spaced ≥14 notes apart so they
// land at the natural breaks where the music opens up — a spin fills the space.
const spinSet = new Set();
{
  const cand = [];
  for (let i = 9; i < times.length - 1; i++) if (gapAfter(i) > 1.05) cand.push(i);
  cand.sort((a, b) => gapAfter(b) - gapAfter(a));
  const picked = [];
  for (const i of cand) {
    if (picked.every((p) => Math.abs(p - i) >= 30)) { picked.push(i); if (picked.length >= 3) break; }  // ~3 well-spaced spins
  }
  picked.forEach((i) => spinSet.add(i));
}

// DUAL-HOLD slots: the downbeat (pos 0) of roughly every other phrase becomes a paired L+R hold —
// the player parks BOTH sticks at once. We emit two notes at that onset (one per ring) instead of
// one. Skip phrase 0 (easy intro) and any downbeat already claimed by a spinner.
const dualSet = new Set();
{
  const phraseCount = Math.ceil(times.length / 8);
  for (let p = 1; p < phraseCount; p += 2) {           // every OTHER phrase -> ~1 per 2 phrases
    const k = p * 8;                                    // its downbeat note index
    if (k < times.length && !spinSet.has(k)) dualSet.add(k);
  }
}

// CENTER RESTS: at several of the biggest gaps (the song's natural breaths, not claimed by a spin
// or dual-hold), REWARD LETTING GO — both sticks return to NEUTRAL together. We emit a paired
// L+R held-centre at that onset; the eyes stare straight ahead and you score for resting on it.
const centerSet = new Set();
{
  const cand = [];
  for (let i = 12; i < times.length - 1; i++) if (gapAfter(i) > 1.0 && !spinSet.has(i) && !dualSet.has(i)) cand.push(i);
  cand.sort((a, b) => gapAfter(b) - gapAfter(a));
  const picked = [];
  for (const i of cand) { if (picked.every((p) => Math.abs(p - i) >= 12)) { picked.push(i); if (picked.length >= 7) break; } }
  picked.forEach((i) => centerSet.add(i));
}

// MOTIF phrases: instead of the flowing drift, some phrases run a crisp DIRECTIONAL figure you can
// feel in the hands — up/down/up/down, left/right/left/right, or a four-corner tap burst. They cycle
// so they recur through the song. (Taps only — no spins; this is the "tap all 4 corners" feel.)
const MOTIF_ANGLE = { updown: [270, 90], leftright: [180, 0], corners: [45, 135, 315, 225] };
function phraseMotif(phrase) {
  if (phrase < 2) return null;                 // let the intro flow first
  const m = phrase % 6;
  return m === 2 ? 'updown' : m === 4 ? 'leftright' : m === 0 ? 'corners' : null;
}
function motifAngle(motif, pos) { const a = MOTIF_ANGLE[motif]; return a[pos % a.length]; }

// Resolve OVERLAPS so notes never pile on the same eye: on each ring, drop any note landing within
// ~70 ms of the previous one (one stick can only be one place at a time), and clamp every sustained
// span so it ends before the next same-ring note begins.
function fixOverlaps(all) {
  const kept = [];
  for (const ring of ['L', 'R']) {
    const a = all.filter((n) => n.ring === ring).sort((x, y) => x.time - y.time);
    const pri = (x) => x.center ? 4 : x.spin > 0 ? 3 : (x.hold > 0 || x.to != null) ? 2 : 1;  // keep the more important note
    const r = [];
    for (const n of a) {
      const prev = r[r.length - 1];
      if (prev && n.time - prev.time < 0.07) { if (pri(n) > pri(prev)) r[r.length - 1] = n; continue; }
      r.push(n);
    }
    for (let i = 0; i < r.length; i++) {
      const n = r[i], next = r[i + 1];
      if (n.hold && next) { const maxEnd = next.time - 0.08; if (n.time + n.hold > maxEnd) n.hold = Math.max(0.12, +(maxEnd - n.time).toFixed(3)); }
    }
    kept.push(...r);
  }
  return kept.sort((x, y) => x.time - y.time);
}

// MAGNITUDE per note — how far from the eye CENTRE the target sits (0..1). FULL variety: from the
// rim (mag~1) right down to barely-moved near centre (mag~0.06). We swing a wander value then STRETCH
// it away from the middle, so most notes land near an extreme (big eye throw or tiny nudge) rather
// than all bunched mid-eye. Corner bursts + flicky bass-runs slam the edge; holds park more moderate.
function magFor(k, phrase, type, motif, dense) {
  if (motif === 'corners') return 0.97;
  if (dense) return 0.92;                                    // flicky run → slam the edge
  let m = 0.5 + 0.5 * Math.sin(k * 1.7 + phrase * 0.6);      // 0..1 wander
  m = 0.5 + (m - 0.5) * 1.7;                                 // stretch toward the extremes (edge / centre)
  if (type === 'hold') m = 0.34 + 0.36 * (0.5 + 0.5 * Math.sin(k));  // holds: moderate but still varied
  return +Math.max(0.06, Math.min(1.0, m)).toFixed(3);
}

let notes = [];
let heading = 0;          // running target heading (degrees) — handed note-to-note for flow

for (let k = 0; k < times.length; k++) {
  const t = times[k];
  const g = gapAfter(k);
  const phrase = Math.floor(k / 8);
  const pos = k % 8;                       // position within the 8-note phrase
  const dir = phrase % 2 === 0 ? 1 : -1;   // sweep direction flips each phrase
  // ASYMMETRY: one eye LEADS each couple of phrases, carrying most of the figure, then the lead
  // swaps — you feel the busy hand shift back and forth (very joystick-y), not a metronomic L/R/L/R.
  const lead = (Math.floor(phrase / 2) % 2 === 0) ? 'L' : 'R';
  const ring = (k % 5 < 3) ? lead : (lead === 'L' ? 'R' : 'L');   // ~3 of every 5 notes on the lead eye

  // --- CENTER REST: let go — both sticks return to neutral together ("breathe") --------------
  if (centerSet.has(k)) {
    const span = +Math.min(Math.max(g, 0.5) * 0.6, 0.7).toFixed(3);
    notes.push({ time: +t.toFixed(3), ring: 'L', center: true, hold: span });
    notes.push({ time: +t.toFixed(3), ring: 'R', center: true, hold: span });
    continue;   // heading unchanged — the line resumes after the rest
  }

  // --- DUAL HOLD: park BOTH sticks at this onset (two notes, same time, L + R) ---------------
  if (dualSet.has(k)) {
    const span = +Math.min(Math.max(g, 0.45) * 0.7, 0.85).toFixed(3); // overlapping hold spans
    const aL = wrap360(heading);
    const aR = wrap360(heading + 180);     // opposite headings so the two eyes splay apart
    notes.push({ time: +t.toFixed(3), ring: 'L', angle: aL, hold: span, mag: 0.55 });
    notes.push({ time: +t.toFixed(3), ring: 'R', angle: aR, hold: span, mag: 0.55 });
    heading = wrap360(heading + 30 * dir); // advance the line for the next note
    continue;
  }

  // --- choose the note type for this slot -------------------------------------
  const motif = phraseMotif(phrase);
  const dense = g < 0.3 && gapAfter(Math.max(0, k - 1)) < 0.34;       // fast onset run → FLICKY taps (the "bass" hits)
  let type;
  if (spinSet.has(k)) type = 'spin';
  else if (dense) type = 'tap';                                      // heavy/fast bits stay snappy flicks
  else if (motif) type = 'tap';                                      // motif phrases are crisp tap figures
  else if (pos === 0 && g > 1.0 && phrase % 2 === 0) type = 'hold';  // an occasional park on a big downbeat
  else if (pos === 5 && phrase % 2 === 1 && g > 0.5) type = 'slide'; // ~one traced line every other phrase
  else type = 'tap';                                                 // FLICKS are the backbone now

  const note = { time: +t.toFixed(3), ring, angle: motif ? motifAngle(motif, pos) : wrap360(heading) };
  note.mag = magFor(k, phrase, type, motif, dense);                  // place it anywhere centre→edge

  if (type === 'spin') {
    note.spin = (phrase % 3 === 0) ? 3 : 2;
    note.hold = +Math.min(g * 0.82, 1.4).toFixed(3);
    heading = wrap360(heading + 40 * dir);
  } else if (type === 'slide') {
    const to = wrap360(heading + 70 * dir);
    note.to = to;
    note.hold = +Math.min(g * 0.75, 0.95).toFixed(3);
    note.magTo = +Math.max(0.14, Math.min(0.95, note.mag + 0.34 * dir)).toFixed(3);  // spiral in/out → a wiggly traced path
    heading = to;                                          // continue the line from where it ended
  } else if (type === 'hold') {
    note.hold = +Math.min(g * 0.55, 0.85).toFixed(3);
    heading = wrap360(heading + 28 * dir);
  } else {
    // tap — small heading advance so consecutive taps sit near each other (easy to flick between)
    heading = wrap360(heading + 30 * dir);
  }

  // SIDE-MATCHED TRIGGERS — frequent: a LEFT-eye note may need L1/L2, a RIGHT-eye note R1/R2 (so the
  // trigger sits under the same hand as that stick). You hold it WHILE the pupil is on the spot. Put
  // them on ~1 in 3 taps/holds, alternating the inner/outer trigger; never on the first few notes.
  if (k > 8 && k % 3 === 0 && (type === 'tap' || type === 'hold')) {
    note.mod = ring === 'L' ? (k % 6 === 0 ? 'L2' : 'L1') : (k % 6 === 0 ? 'R2' : 'R1');
  }

  notes.push(note);
}

notes = fixOverlaps(notes);   // no two notes piling on the same eye; holds end before the next note

const out = {
  meta: { ...src.meta, difficulty: 'Normal' },
  notes,
};
fs.writeFileSync(PATH, JSON.stringify(out, null, 2) + '\n');

// --- report -----------------------------------------------------------------
const counts = { tap: 0, hold: 0, slide: 0, spin: 0, center: 0 };
let mods = 0, L = 0, R = 0;
const holdByTime = {}, centerByTime = {};
for (const n of notes) {
  const ty = n.center ? 'center' : n.spin > 0 ? 'spin' : n.to != null ? 'slide' : n.hold > 0 ? 'hold' : 'tap';
  counts[ty]++; if (n.mod) mods++; n.ring === 'L' ? L++ : R++;
  if (ty === 'hold') (holdByTime[n.time] = holdByTime[n.time] || { L: 0, R: 0 })[n.ring]++;
  if (ty === 'center') (centerByTime[n.time] = centerByTime[n.time] || { L: 0, R: 0 })[n.ring]++;
}
let dualHolds = 0, dualCenters = 0;
for (const t in holdByTime) if (holdByTime[t].L > 0 && holdByTime[t].R > 0) dualHolds++;
for (const t in centerByTime) if (centerByTime[t].L > 0 && centerByTime[t].R > 0) dualCenters++;
console.log(`re-charted ${notes.length} notes (times preserved)`);
console.log('types:', counts, '| mods:', mods, '| L/R:', L, R);
console.log('DUAL-HOLD pairs:', dualHolds, '| CENTER-REST pairs (let go to neutral):', dualCenters);
