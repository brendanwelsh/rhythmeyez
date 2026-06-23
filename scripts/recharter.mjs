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
    if (picked.every((p) => Math.abs(p - i) >= 14)) { picked.push(i); if (picked.length >= 7) break; }
  }
  picked.forEach((i) => spinSet.add(i));
}

const notes = [];
let heading = 0;          // running target heading (degrees) — handed note-to-note for flow

for (let k = 0; k < times.length; k++) {
  const t = times[k];
  const g = gapAfter(k);
  const phrase = Math.floor(k / 8);
  const pos = k % 8;                       // position within the 8-note phrase
  const dir = phrase % 2 === 0 ? 1 : -1;   // sweep direction flips each phrase
  const ring = k % 2 === 0 ? 'L' : 'R';    // hands alternate

  // --- choose the note type for this slot -------------------------------------
  let type;
  if (spinSet.has(k)) type = 'spin';
  else if (pos === 0 && g > 0.8) type = 'hold';                       // park on the downbeat
  else if (pos === 4 && phrase % 3 === 2 && g > 0.8) type = 'hold';   // a second park, occasionally
  else if (pos === 2 || pos === 5) type = 'slide';                   // two traced lines per phrase
  else type = 'tap';                                                  // staccato backbone

  const note = { time: +t.toFixed(3), ring, angle: wrap360(heading) };

  if (type === 'spin') {
    note.spin = (phrase % 3 === 0) ? 3 : 2;
    note.hold = +Math.min(g * 0.82, 1.4).toFixed(3);
    heading = wrap360(heading + 40 * dir);
  } else if (type === 'slide') {
    const to = wrap360(heading + 70 * dir);
    note.to = to;
    note.hold = +Math.min(g * 0.75, 0.95).toFixed(3);
    heading = to;                                          // continue the line from where it ended
  } else if (type === 'hold') {
    note.hold = +Math.min(g * 0.55, 0.85).toFixed(3);
    heading = wrap360(heading + 28 * dir);
  } else {
    // tap — small heading advance so consecutive taps sit near each other (easy to flick between)
    heading = wrap360(heading + 30 * dir);
  }

  // accent modifiers — rare, only on taps/holds, never on the first few notes
  if (k > 12 && pos === 4 && phrase % 3 === 1 && (type === 'tap' || type === 'hold')) {
    note.mod = MOD_CYCLE[(phrase / 3 | 0) % MOD_CYCLE.length];
  }

  notes.push(note);
}

const out = {
  meta: { ...src.meta, difficulty: 'Normal' },
  notes,
};
fs.writeFileSync(PATH, JSON.stringify(out, null, 2) + '\n');

// --- report -----------------------------------------------------------------
const counts = { tap: 0, hold: 0, slide: 0, spin: 0 };
let mods = 0, L = 0, R = 0;
for (const n of notes) {
  const ty = n.spin > 0 ? 'spin' : n.to != null ? 'slide' : n.hold > 0 ? 'hold' : 'tap';
  counts[ty]++; if (n.mod) mods++; n.ring === 'L' ? L++ : R++;
}
console.log(`re-charted ${notes.length} notes (times preserved)`);
console.log('types:', counts, '| mods:', mods, '| L/R:', L, R);
