// sim.test.mjs — headless sanity check of the presence/coverage scorer (no browser needed).
// Simulates a frame loop driving a fake GamepadInput, for each note type, and asserts that a
// follower clears them while an idle player misses them. Run:  node scripts/sim.test.mjs

import { normalizeChart, noteTargetAngle, angleVec } from '../src/chart.js';
import { Scorer, PRESENCE_MAG } from '../src/scoring.js';

const FPS = 120, DT = 1 / FPS;

// minimal stand-in for GamepadInput: just the fields the scorer reads
function makeInput() { return { left: { x: 0, y: 0, mag: 0 }, right: { x: 0, y: 0, mag: 0 }, heldMods: () => [] }; }

// aim a stick at a target angle (or spin), like the in-game demo autoplay
function aim(input, ring, a, mag = 0.95) {
  const v = angleVec(a);
  input[ring === 'L' ? 'left' : 'right'] = { x: v.x * mag, y: v.y * mag, mag };
}
function relax(input, ring) { input[ring === 'L' ? 'left' : 'right'] = { x: 0, y: 0, mag: 0 }; }

function run(rawNotes, { follow }) {
  const chart = normalizeChart({ meta: { bpm: 120, approachTime: 1.6 }, notes: rawNotes });
  const scorer = new Scorer();
  const input = makeInput();
  const end = chart.duration;
  for (let t = -0.3; t <= end; t += DT) {
    for (const ring of ['L', 'R']) {
      if (!follow) { relax(input, ring); continue; }
      // perform the nearest active/upcoming note on this ring
      let best = null, bd = Infinity;
      for (const n of chart.notes) {
        if (n.ring !== ring || n.judged) continue;
        const t0 = n.time, t1 = n.time + n.hold;
        const d = t < t0 ? t0 - t : t > t1 ? t - t1 : 0;
        if (d < bd) { bd = d; best = n; }
      }
      if (!best || bd > 0.4) { relax(input, ring); continue; }
      if (best.type === 'spin') aim(input, ring, t * 16);
      else aim(input, ring, noteTargetAngle(best, t));
    }
    scorer.update(chart.notes, input, t, DT);
    scorer.takeEvents();
  }
  return { scorer, chart };
}

const cases = {
  tap: [{ time: 1.0, ring: 'L', angle: 90 }],
  hold: [{ time: 1.0, ring: 'L', angle: 45, hold: 1.0 }],
  slide: [{ time: 1.0, ring: 'R', angle: 0, to: 180, hold: 1.2 }],
  spin: [{ time: 1.0, ring: 'R', angle: 0, spin: 2, hold: 1.2 }],
  mixed: [
    { time: 1.0, ring: 'L', angle: 90 },
    { time: 1.0, ring: 'R', angle: 270, to: 90, hold: 1.0 },
    { time: 2.6, ring: 'L', angle: 0, hold: 0.8 },
    { time: 2.6, ring: 'R', angle: 0, spin: 2, hold: 1.2 },
  ],
};

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  ✗', msg); } };

for (const [name, notes] of Object.entries(cases)) {
  const good = run(notes, { follow: true }).scorer;
  const idle = run(notes, { follow: false }).scorer;
  console.log(`\n[${name}] follower:`, JSON.stringify(good.counts), 'score', good.score, '| idle:', JSON.stringify(idle.counts));
  ok(good.counts.miss === 0, `${name}: follower should have 0 misses`);
  ok(good.counts.perfect + good.counts.good === notes.length, `${name}: follower judged all notes`);
  ok(good.score > 0, `${name}: follower scored > 0`);
  ok(idle.counts.miss === notes.length, `${name}: idle should miss all ${notes.length}`);
  ok(idle.score === 0, `${name}: idle should score 0`);
}

console.log(`\nPRESENCE_MAG=${PRESENCE_MAG}  →  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
