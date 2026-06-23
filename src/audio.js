// audio.js — AudioEngine: owns the musical clock and all sound.
//
// THE timing rule: song time = ctx.currentTime - startedAt. Everything musical reads `.time`.
// No setTimeout / setInterval / Date.now() anywhere near gameplay timing.

export class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.buffer = null;          // decoded AudioBuffer (null => metronome mode)
    this.source = null;          // active AudioBufferSourceNode
    this.startedAt = null;       // ctx time corresponding to song time 0
    this.bpm = 120;
    this.running = false;

    // Master out.
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.95;
    this.master.connect(this.ctx.destination);

    // Music bus: BOTH the real track and the synth groove pass through here, so a miss can
    // "glitch" the whole mix (stutter/duck) — Guitar-Hero style. SFX/glitch bursts bypass it.
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 1.0;
    // User music-volume lives DOWNSTREAM of musicBus so the glitch (which snaps musicBus back to
    // 1.0) never overrides the player's setting.   musicBus -> musicVol -> master.
    this.musicVol = this.ctx.createGain();
    this.musicVol.gain.value = 0.9;
    this.musicBus.connect(this.musicVol);
    this.musicVol.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.5;
    this.sfxGain.connect(this.master);

    // Groove bus (the synthesized backing when there's no audio file) -> music bus.
    this.grooveGain = this.ctx.createGain();
    this.grooveGain.gain.value = 0.85;
    this.grooveGain.connect(this.musicBus);

    // 0.5 s of white noise, reused by hats/snare.
    this._noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
    const nd = this._noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // Groove scheduler state (only used when there's no audio buffer).
    this._grooveStep = 0;        // next 16th-note step to schedule
    this._grooveTimer = null;
  }

  /** Browsers start the AudioContext suspended until a user gesture. Call on first input. */
  async resume() {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  // --- user volume (0..1) -------------------------------------------------
  setMusicVolume(v) { this.musicVol.gain.value = Math.max(0, Math.min(1, v)); }
  setSfxVolume(v) { this.sfxGain.gain.value = Math.max(0, Math.min(1, v)); }
  get musicVolume() { return this.musicVol.gain.value; }
  get sfxVolume() { return this.sfxGain.gain.value; }

  get hasAudio() { return !!this.buffer; }

  /** Current song time in seconds. Negative during the count-in lead. */
  get time() {
    if (this.startedAt == null) return 0;
    return this.ctx.currentTime - this.startedAt;
  }

  async decodeArrayBuffer(arrayBuffer) {
    return await this.ctx.decodeAudioData(arrayBuffer);
  }

  async loadFile(file) {
    this.buffer = await this.decodeArrayBuffer(await file.arrayBuffer());
    return this.buffer;
  }

  /** Try to load assets/<name>; returns false (not throws) if it's not there. */
  async tryLoadUrl(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) { this.buffer = null; return false; }
      this.buffer = await this.decodeArrayBuffer(await res.arrayBuffer());
      return true;
    } catch {
      this.buffer = null;
      return false;
    }
  }

  setBuffer(buffer) { this.buffer = buffer; }
  clearBuffer() { this.buffer = null; }

  /**
   * Start playback after `leadIn` seconds of count-in. Song time begins at -leadIn and the
   * audio/metronome fires exactly when song time hits 0.
   */
  start(bpm, leadIn = 2.5) {
    this.bpm = bpm || 120;
    const t0 = this.ctx.currentTime + leadIn;
    this.startedAt = t0;
    this.running = true;

    if (this.buffer) {
      this.source = this.ctx.createBufferSource();
      this.source.buffer = this.buffer;
      this.source.connect(this.musicBus);
      this.source.start(t0);
    } else {
      // Groove mode: synthesize a backing beat locked to the clock (incl. the count-in).
      const sec16 = 15 / this.bpm; // a 16th-note step
      this._grooveStep = Math.ceil(this.time / sec16);
      this._scheduleGroove();
    }
  }

  stop() {
    this.running = false;
    if (this.source) {
      try { this.source.stop(); } catch { /* already stopped */ }
      this.source.disconnect();
      this.source = null;
    }
    if (this._grooveTimer) { clearTimeout(this._grooveTimer); this._grooveTimer = null; }
    this.startedAt = null;
  }

  // --- Groove (sample-accurate Web Audio scheduling; the timer only refills the lookahead) ---
  _scheduleGroove() {
    if (!this.running || this.buffer) return;
    const sec16 = 15 / this.bpm; // 60/bpm/4
    const lookahead = 0.25;
    while (this._grooveStep * sec16 < this.time + lookahead) {
      const when = this.startedAt + this._grooveStep * sec16;
      if (when >= this.ctx.currentTime) this._grooveStepVoices(this._grooveStep, when);
      this._grooveStep++;
    }
    this._grooveTimer = setTimeout(() => this._scheduleGroove(), 30);
  }

  _grooveStepVoices(step, when) {
    const sub = ((step % 4) + 4) % 4;          // 0..3 within the beat
    const beat = Math.floor(step / 4);
    const beatInBar = ((beat % 4) + 4) % 4;     // 0..3 within the bar
    // kick on the beat, plus a syncopated push on the "&" of odd beats
    if (sub === 0) this._kick(when);
    if (sub === 2 && beatInBar % 2 === 1) this._kick(when, 0.6);
    // snare/clap backbeat
    if (sub === 0 && (beatInBar === 1 || beatInBar === 3)) this._snare(when);
    // hats on every 8th, a touch brighter on the off-beat
    if (sub % 2 === 0) this._hat(when, sub === 2 ? 0.5 : 0.32);
    // bass root note per beat, simple movement across the bar
    if (sub === 0) this._bass(when, [55.0, 55.0, 73.42, 49.0][beatInBar]); // A1 A1 D2 G1
  }

  _kick(when, gain = 1) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(150, when);
    osc.frequency.exponentialRampToValueAtTime(48, when + 0.12);
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
    osc.connect(g); g.connect(this.grooveGain);
    osc.start(when); osc.stop(when + 0.2);
  }

  _noiseBurst(when, dur, gain, filter) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    let node = src;
    if (filter) { node.connect(filter); node = filter; }
    node.connect(g); g.connect(this.grooveGain);
    src.start(when); src.stop(when + dur + 0.02);
  }

  _hat(when, gain) {
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7000;
    this._noiseBurst(when, 0.03, gain * 0.5, hp);
  }

  _snare(when) {
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'highpass'; bp.frequency.value = 1500;
    this._noiseBurst(when, 0.12, 0.5, bp);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle'; osc.frequency.setValueAtTime(180, when);
    g.gain.setValueAtTime(0.25, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.1);
    osc.connect(g); g.connect(this.grooveGain);
    osc.start(when); osc.stop(when + 0.12);
  }

  _bass(when, freq) {
    const osc = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.value = freq;
    lp.type = 'lowpass'; lp.frequency.value = 420;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(0.5, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.26);
    osc.connect(lp); lp.connect(g); g.connect(this.grooveGain);
    osc.start(when); osc.stop(when + 0.3);
  }

  /**
   * GLITCH the music on a miss (Guitar-Hero style): a hard stutter/dropout on the whole mix,
   * a brief pitch wobble on the real track, and a noise/buzz burst. No sound at all on a hit —
   * the song just plays through clean.
   */
  glitch() {
    const now = this.ctx.currentTime;
    // 1) stutter: gate the music bus down and snap it back
    const g = this.musicBus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.linearRampToValueAtTime(0.04, now + 0.015);
    g.setValueAtTime(0.04, now + 0.085);
    g.linearRampToValueAtTime(1.0, now + 0.14);
    // 2) pitch wobble on the real track (if any)
    if (this.source && this.source.playbackRate) {
      const pr = this.source.playbackRate;
      try {
        pr.cancelScheduledValues(now);
        pr.setValueAtTime(1.0, now);
        pr.linearRampToValueAtTime(0.78, now + 0.04);
        pr.linearRampToValueAtTime(1.0, now + 0.13);
      } catch { /* some browsers disallow */ }
    }
    // 3) buzzy glitch burst (bypasses the music bus so it isn't ducked)
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 6;
    this._noiseBurstTo(now, 0.1, 0.5, bp, this.sfxGain);
    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    osc.type = 'square'; osc.frequency.setValueAtTime(140, now);
    osc.frequency.linearRampToValueAtTime(60, now + 0.1);
    og.gain.setValueAtTime(0.18, now); og.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(og); og.connect(this.sfxGain);
    osc.start(now); osc.stop(now + 0.13);
  }

  _noiseBurstTo(when, dur, gain, filter, dest) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    let node = src;
    if (filter) { node.connect(filter); node = filter; }
    node.connect(g); g.connect(dest || this.grooveGain);
    src.start(when); src.stop(when + dur + 0.02);
  }

  /** (legacy) short blip — no longer used for hits; kept for optional cues. */
  hitSound(judgement) {
    const now = this.ctx.currentTime;
    const freq = judgement === 'perfect' ? 1320 : judgement === 'good' ? 880
      : judgement === 'hold' ? 1760 : 220;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = judgement === 'miss' ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    if (judgement !== 'miss') osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 0.05);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.5, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(g); g.connect(this.sfxGain);
    osc.start(now); osc.stop(now + 0.14);
  }
}
