// beatgen.js — build a starter beatmap from a decoded AudioBuffer.
//
// Strategy: short-time energy -> positive "flux" -> adaptive-threshold peak picking for onsets;
// autocorrelation of the flux envelope for a BPM estimate. Onsets become notes, with ring and
// direction assigned by a deterministic choreographed pattern. Output is the same JSON the rest
// of the game eats, ready to download and hand-tune. If onset detection is too sparse, fall back
// to a straight beat grid at the detected/given BPM so you always get something playable.

import { DIRS } from './chart.js';

const HOP = 512;
const WIN = 1024;

/** Downmix to a single Float32 mono channel. */
function toMono(buffer) {
  const n = buffer.length;
  const ch0 = buffer.getChannelData(0);
  if (buffer.numberOfChannels === 1) return ch0;
  const ch1 = buffer.getChannelData(1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.5 * (ch0[i] + ch1[i]);
  return out;
}

/** Per-hop positive energy flux envelope + its frame rate (frames per second). */
function fluxEnvelope(buffer) {
  const mono = toMono(buffer);
  const sr = buffer.sampleRate;
  const frames = Math.max(0, Math.floor((mono.length - WIN) / HOP));
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const start = f * HOP;
    for (let i = 0; i < WIN; i++) { const s = mono[start + i]; e += s * s; }
    energy[f] = e;
  }
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) flux[f] = Math.max(0, energy[f] - energy[f - 1]);
  return { flux, fps: sr / HOP };
}

/** Adaptive-threshold local-maxima peak picking -> onset times (seconds). */
function detectOnsets(flux, fps, { sensitivity = 1.5, minGap = 0.18 } = {}) {
  const onsets = [];
  const W = Math.round(0.10 * fps); // ~100 ms half-window for the moving mean
  const minGapFrames = Math.round(minGap * fps);
  let last = -Infinity;
  for (let f = 1; f < flux.length - 1; f++) {
    let sum = 0, cnt = 0;
    for (let k = f - W; k <= f + W; k++) { if (k >= 0 && k < flux.length) { sum += flux[k]; cnt++; } }
    const thr = (sum / cnt) * sensitivity;
    const isPeak = flux[f] > thr && flux[f] >= flux[f - 1] && flux[f] > flux[f + 1] && flux[f] > 0;
    if (isPeak && f - last >= minGapFrames) { onsets.push(f / fps); last = f; }
  }
  return onsets;
}

/** Estimate BPM by autocorrelating the flux envelope over a musical lag range. */
function detectBPM(flux, fps, { min = 70, max = 200 } = {}) {
  let bestBpm = 0, bestScore = -Infinity;
  for (let bpm = min; bpm <= max; bpm += 0.5) {
    const lag = Math.round((60 / bpm) * fps);
    if (lag <= 0 || lag >= flux.length) continue;
    let score = 0;
    for (let f = 0; f + lag < flux.length; f++) score += flux[f] * flux[f + lag];
    if (score > bestScore) { bestScore = score; bestBpm = bpm; }
  }
  // Fold obvious half/double-time results toward a comfortable range.
  if (bestBpm && bestBpm < 90) bestBpm *= 2;
  return Math.round(bestBpm);
}

// Continuous, flowing ANGLE pattern (degrees) — not snapped to 8 directions. A golden-ish step
// drifts the angle around the dial so notes land at varied headings; hands offset by 180°.
function pickAngle(i, ring) {
  const a = (i * 137 + (ring === 'R' ? 180 : 0)) % 360; // 0..360
  return Math.round(a);
}

const MOD_CYCLE = ['L1', 'R1', 'L2', 'R2'];  // shoulders/triggers only (no face buttons in EYE BEATS)

/**
 * Turn onset times into FLOW notes. Runs of tightly-spaced onsets become a slide (a line you
 * trace); a long pause becomes a spinner; medium gaps become holds; the rest are presence taps.
 * Hands alternate, and a continuous-angle pattern keeps the sticks moving so nothing feels static.
 */
function notesFromTimes(times) {
  const out = [];
  let i = 0, k = 0;
  while (i < times.length) {
    const t = times[i];
    const gapNext = i < times.length - 1 ? times[i + 1] - t : 1.5;
    const ring = k % 2 === 0 ? 'L' : 'R';

    // run of tight onsets -> a slide that sweeps across the dial
    let j = i;
    while (j + 1 < times.length && times[j + 1] - times[j] < 0.30) j++;
    if (j - i + 1 >= 3) {
      out.push({ time: +t.toFixed(3), ring, angle: pickAngle(k, ring), to: pickAngle(k + (j - i + 1), ring), hold: +(times[j] - t).toFixed(3) });
      i = j + 1; k++; continue;
    }
    // long pause -> a spinner to fill it (sparingly)
    if (gapNext > 1.4 && k > 6 && k % 6 === 0) {
      out.push({ time: +t.toFixed(3), ring, angle: pickAngle(k, ring), spin: 2, hold: +Math.min(gapNext * 0.7, 1.4).toFixed(3) });
      i++; k++; continue;
    }
    // medium gap -> a hold; otherwise a tap (with the occasional button modifier)
    const note = { time: +t.toFixed(3), ring, angle: pickAngle(k, ring) };
    if (k > 4 && gapNext > 0.8 && k % 4 === 0) note.hold = +Math.min(gapNext * 0.5, 1.0).toFixed(3);
    else if (k > 6 && k % 9 === 4) note.mod = MOD_CYCLE[(k / 9 | 0) % MOD_CYCLE.length];
    out.push(note); i++; k++;
  }
  return out;
}

/** Straight beat grid (fallback / placeholder), notes every `subdiv`-th beat. */
export function generateGrid(bpm, durationSec, { startBeat = 8, subdiv = 1 } = {}) {
  const secPerBeat = 60 / bpm;
  const times = [];
  for (let b = startBeat; b * secPerBeat < durationSec; b += subdiv) times.push(b * secPerBeat);
  return notesFromTimes(times);
}

/**
 * Main entry: generate a beatmap object (un-normalized; caller normalizes) from a buffer.
 * `opts`: { title, artist, audioName, difficulty, density (0..1), approachTime }.
 */
export function generateBeatmap(buffer, opts = {}) {
  const { flux, fps } = fluxEnvelope(buffer);
  const bpm = detectBPM(flux, fps) || opts.bpmHint || 120;

  let onsets = detectOnsets(flux, fps);

  // Thin by density (keep every Nth onset) for lower difficulties.
  const density = Math.min(1, Math.max(0.1, opts.density ?? 0.5));
  if (density < 1) {
    const keepEvery = Math.max(1, Math.round(1 / density));
    onsets = onsets.filter((_, i) => i % keepEvery === 0);
  }

  // If detection found too little, fall back to a grid so the chart is always playable.
  let notes;
  if (onsets.length < 16) {
    notes = generateGrid(bpm, buffer.duration, { subdiv: density < 0.6 ? 2 : 1 });
  } else {
    notes = notesFromTimes(onsets);
  }

  return {
    meta: {
      title: opts.title || 'Custom Track',
      artist: opts.artist || 'Unknown',
      audio: opts.audioName || null,
      bpm,
      offset: 0,
      approachTime: opts.approachTime ?? 1.8,
      difficulty: opts.difficulty || 'Auto',
    },
    notes,
  };
}

/** Serialize a beatmap to a downloadable, pretty JSON string. */
export function chartToJSON(chart) {
  const notes = chart.notes.map((n) => {
    const o = { time: n.time, ring: n.ring };
    if (n.angle != null) o.angle = n.angle; else o.dir = n.dir;
    if (n.hold) o.hold = n.hold;
    if (n.mod) o.mod = n.mod;
    return o;
  });
  return JSON.stringify({ meta: chart.meta, notes }, null, 2);
}
