// flowify.mjs — one-off: rework the (sparse, onset-aligned) base chart into a flowing SLIDE PATH
// without moving any onset time. Run:  node scripts/flowify.mjs
//
// The detected onsets sit ~0.6–1.8s apart — too sparse to feel anything but stop-start. So each
// onset becomes a SLIDE that traces a line toward the next beat's heading: the stick is in near-
// continuous motion ("follow a line, draw a line"), still locked to the real audio's onsets.
// Hands alternate so both sticks trade lines; long gaps become spinners or holds; a few stay taps.

import fs from 'node:fs';

const PATH = 'beatmaps/raise-your-weapon.json';
const data = JSON.parse(fs.readFileSync(PATH, 'utf8'));
// rebuild purely from the original onset time + heading (drop any earlier flow edits)
const seq = data.notes.map((n) => ({ time: n.time, angle: n.angle })).sort((a, b) => a.time - b.time);

// Mark the ~6 longest gaps as spinners so the mechanic shows up regardless of gap distribution.
const spinAt = new Set(
  seq.map((n, i) => ({ i, gap: (seq[i + 1] ? seq[i + 1].time - n.time : 0) }))
    .filter((x) => x.i > 6)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 6)
    .map((x) => x.i),
);

const out = [];
for (let i = 0; i < seq.length; i++) {
  const n = seq[i];
  const next = seq[i + 1];
  const gap = next ? next.time - n.time : 1.0;
  const ring = i % 2 === 0 ? 'L' : 'R';
  const a = n.angle;

  if (spinAt.has(i)) {
    // long rest -> spinner to fill it
    out.push({ time: n.time, ring, angle: a, spin: 2, hold: +Math.min(gap * 0.7, 1.4).toFixed(3) });
  } else if (gap > 1.12 && i % 3 === 0) {
    // long-ish gap -> a parked hold (a breath between phrases)
    out.push({ time: n.time, ring, angle: a, hold: +Math.min(gap * 0.55, 1.0).toFixed(3) });
  } else if (i % 5 === 4) {
    // punctuation: a clean presence tap
    out.push({ time: n.time, ring, angle: a });
  } else {
    // the staple: a slide sweeping toward the next beat's heading (a drawn line)
    const to = next ? next.angle : (a + 120) % 360;
    const hold = +Math.min(Math.max(gap - 0.14, gap * 0.55), 1.2).toFixed(3);
    out.push({ time: n.time, ring, angle: a, to, hold });
  }
}

data.meta.difficulty = 'Flow';
data.meta.approachTime = 1.8;            // tighter read now that notes are near-continuous
data.notes = out;
fs.writeFileSync(PATH, JSON.stringify(data, null, 2));

const c = (p) => out.filter(p).length;
console.log(`flowified ${seq.length} onsets -> ${out.length} notes  |  slides ${c((o) => o.to != null)}  holds ${c((o) => o.hold && o.to == null && !o.spin)}  spins ${c((o) => o.spin)}  taps ${c((o) => !o.hold && !o.spin && o.to == null)}`);
