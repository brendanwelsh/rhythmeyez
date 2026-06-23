// render.smoke.mjs — exercise every Renderer path against a stubbed 2D canvas so typos / bad
// references in the new note-drawing + trail code throw HERE instead of silently in the browser.
// Run:  node scripts/render.smoke.mjs

import fs from 'node:fs';
import { normalizeChart, angleVec } from '../src/chart.js';
import { Scorer } from '../src/scoring.js';

// --- minimal browser stubs ----------------------------------------------------
const grad = { addColorStop() {} };
const ctx = new Proxy({}, {
  get: (_, p) => (p === 'createLinearGradient' || p === 'createRadialGradient') ? () => grad : () => {},
  set: () => true,
});
const canvas = { getContext: () => ctx, clientWidth: 1280, clientHeight: 720, width: 0, height: 0, style: {} };
globalThis.window = { addEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720 };
globalThis.Image = class { set src(_) { if (this.onload) this.onload(); } };

const { Renderer } = await import('../src/render.js');

// --- drive a representative chart through many frames --------------------------
const raw = JSON.parse(fs.readFileSync('beatmaps/raise-your-weapon.json', 'utf8'));
const chart = normalizeChart(raw);
const scorer = new Scorer();
const r = new Renderer(canvas);

let frames = 0;
const DT = 1 / 60;
const input = { left: { x: 0, y: 0, mag: 0 }, right: { x: 0, y: 0, mag: 0 }, heldMods: () => [] };
try {
  // menus first (chart=null), then a full play-through with a moving stick + injected FX
  for (let t = 0; t < 0.5; t += DT) { r.drawGame({ chart: null, songTime: 0, scorer, input, playing: false, demo: false }); frames++; }
  for (let t = -0.3; t <= chart.duration; t += DT) {
    const a = t * 2;                                   // sweep the stick around
    input.left = { x: Math.cos(a) * 0.8, y: Math.sin(a) * 0.8, mag: 0.8 };
    input.right = { x: Math.cos(-a) * 0.6, y: Math.sin(-a) * 0.6, mag: 0.6 };
    scorer.update(chart.notes, input, t, DT);
    for (const ev of scorer.takeEvents()) r.addEffect(ev);
    if (Math.floor(t * 4) % 7 === 0) r.addFlick({ ring: 'L', dir: 'up', mag: 1, t });
    r.drawGame({ chart, songTime: t, scorer, input, playing: true, demo: true });
    frames++;
  }
  console.log(`render smoke OK — ${frames} frames drawn, no exceptions. (judged ${chart.notes.filter(n => n.judged).length}/${chart.notes.length})`);
} catch (e) {
  console.error('render smoke FAILED at frame', frames, '\n', e);
  process.exit(1);
}
