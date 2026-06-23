// input.js — GamepadInput: Gamepad API polling + hysteresis flick detection.
//
// This game is CONTROLLER-ONLY on purpose: it needs real analog sticks you can flick and flow.
// The keyboard only confirms/cancels menus — it can't play. Use the on-screen tester (title
// screen) to verify your pad: it shows every axis/button live.
//
// Standard mapping (Chrome): axes 0,1 = left stick · 2,3 = right stick (y-down).
//   buttons 0 ✕ · 1 ◯ · 2 ▢ · 3 △ · 4 L1 · 5 R1 · 6 L2 · 7 R2 · 8 share · 9 options
//           10 L3 · 11 R3 · 12 ↑ · 13 ↓ · 14 ← · 15 → · 16 PS

import { vectorToDir } from './chart.js';

// Gameplay modifiers are SHOULDERS/TRIGGERS ONLY (4/5/6/7) — you hold one without lifting a thumb
// off a stick. Face buttons + d-pad stay for MENUS only.
const MOD_BUTTONS = { 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2' };
export const BUTTON_LABELS = ['✕', '◯', '▢', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', '↑', '↓', '←', '→', 'PS'];

// Haptic cues for the controller's two rumble motors (dual-rumble): `strong` = the low-frequency
// (heavy) motor, `weak` = the high-frequency (crisp) motor, `dur` in ms. A hit is a crisp tick; a
// miss is a heavy buzz that pairs with the audio glitch; the sustain is a soft hum while you're on
// a hold/slide/spin. These ARE the hit feedback — by design a hit makes no sound (the song stays
// clean), so the controller is where "you nailed it" is felt.
const RUMBLE = {
  perfect:   { strong: 0.16, weak: 0.85, dur: 55 },
  good:      { strong: 0.10, weak: 0.45, dur: 40 },
  miss:      { strong: 0.90, weak: 0.22, dur: 170 },
  milestone: { strong: 0.55, weak: 0.70, dur: 130 },
  sustain:   { strong: 0.06, weak: 0.22, dur: 110 },
};

export class GamepadInput {
  constructor() {
    this.flickThreshold = 0.5;
    this.releaseThreshold = 0.3;
    this.holdThreshold = 0.45;
    this.deadzone = 0.12;
    this.hapticScale = 0.8;      // 0..1 master haptics intensity (player setting)
    this.padId = null;
    this._pad = null;            // last gamepad snapshot (for the tester)

    window.addEventListener('gamepadconnected', (e) => { this.padId = e.gamepad.id; });
    window.addEventListener('gamepaddisconnected', () => { this.padId = null; });

    this._fired = { L: false, R: false };
    this.left = { x: 0, y: 0, mag: 0 };
    this.right = { x: 0, y: 0, mag: 0 };
    this.demoMods = [];          // mods the attract auto-play is "holding" this frame (see main.js)
    this.flicks = [];
    this.menu = [];
    this._prevButtons = {};
    this._just = {};
    this._installKeyboard();
  }

  // --- gamepad access ------------------------------------------------------
  // Pick the BEST connected pad — some setups expose several (e.g. a real DualSense plus a
  // virtual Steam/DS4Windows pad); we prefer a standard-mapped, DualSense-looking one.
  _getPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let best = null, bestScore = -1;
    for (const p of pads) {
      if (!p || !p.axes || p.axes.length < 2) continue;
      let s = 0;
      if (p.mapping === 'standard') s += 4;
      if (/dualsense|dualshock|sony|0ce6|054c|wireless controller/i.test(p.id || '')) s += 3;
      if (p.axes.length >= 4) s += 1;
      if (s > bestScore) { bestScore = s; best = p; }
    }
    return best;
  }

  get connected() { return this._getPad() != null; }
  get axesCount() { return this._pad ? this._pad.axes.length : 0; }
  get mapping() { return this._pad ? (this._pad.mapping || 'non-standard') : ''; }

  /** Left/right stick axes, adapting to the DualSense's non-standard 6-axis layout. */
  _stickAxes(pad) {
    const a = pad.axes;
    let lx = a[0] || 0, ly = a[1] || 0, rx = a[2] || 0, ry = a[3] || 0;
    // Many DualSense/DS4 setups expose a non-standard layout where 2 & 5 are the right stick
    // and 3 & 4 are the triggers. Detect by axis count + mapping.
    if (pad.mapping !== 'standard' && a.length >= 6) { rx = a[2] || 0; ry = a[5] || 0; }
    return { lx, ly, rx, ry };
  }

  triggers() {
    const p = this._pad; if (!p) return { L2: 0, R2: 0 };
    const v = (i) => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
    return { L2: v(6), R2: v(7) };
  }
  bothTriggers() { const t = this.triggers(); return t.L2 > 0.5 && t.R2 > 0.5; }

  buttonStates() {
    const p = this._pad; if (!p) return [];
    return p.buttons.map((b, i) => ({ label: BUTTON_LABELS[i] || ('b' + i), pressed: b.pressed || b.value > 0.3, value: b.value }));
  }
  allAxes() { return this._pad ? [...this._pad.axes] : []; }

  /** Raw (un-deadzoned) left/right stick axes, DualSense layout corrected — for the tester/drift. */
  rawSticks() {
    const p = this._pad; if (!p) return { lx: 0, ly: 0, rx: 0, ry: 0 };
    return this._stickAxes(p);
  }

  // --- haptics -------------------------------------------------------------
  // Play a dual-rumble effect on the active pad. Magnitudes are scaled by the player's haptics
  // setting (hapticScale); silently no-ops where the browser/pad doesn't expose vibration.
  rumble(strong = 0.5, weak = 0.5, dur = 90) {
    const s = this.hapticScale;
    if (s <= 0) return;
    const pad = this._getPad();
    const act = pad && (pad.vibrationActuator || (pad.hapticActuators && pad.hapticActuators[0]));
    if (!act || typeof act.playEffect !== 'function') return;
    try {
      act.playEffect('dual-rumble', {
        startDelay: 0,
        duration: Math.max(0, dur),
        weakMagnitude: Math.max(0, Math.min(1, weak * s)),
        strongMagnitude: Math.max(0, Math.min(1, strong * s)),
      }).catch(() => {});
    } catch { /* effect type unsupported on this pad */ }
  }

  /** Fire a named haptic cue ('perfect'|'good'|'miss'|'milestone'|'sustain'). */
  rumbleCue(kind) {
    const r = RUMBLE[kind];
    if (r) this.rumble(r.strong, r.weak, r.dur);
  }

  /** Direction the stick is currently held in (for hold notes), or null if below threshold. */
  heldDir(ring) {
    const s = ring === 'L' ? this.left : this.right;
    if (!s || s.mag < this.holdThreshold) return null;
    return { dir: vectorToDir(s.x, s.y), angle: Math.atan2(s.y, s.x), x: s.x, y: s.y, mag: s.mag };
  }

  // --- per-frame -----------------------------------------------------------
  update(songTime) {
    const pad = this._getPad();
    this._pad = pad;
    this._just = {};

    if (pad) {
      const { lx, ly, rx, ry } = this._stickAxes(pad);
      this._updateStick('L', lx, ly, songTime);
      this._updateStick('R', rx, ry, songTime);

      const pressed = (i) => pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4);
      const edges = {};
      for (const i of [0, 1, 9, 12, 13, 14, 15]) {
        const now = !!pressed(i);
        edges[i] = now && !this._prevButtons[i];
        this._prevButtons[i] = now;
      }
      if (edges[9]) { this.menu.push('start'); this._just.options = true; }  // Options = start/pause toggle
      if (edges[0]) { this.menu.push('confirm'); this._just.cross = true; }
      if (edges[1]) { this.menu.push('back'); this._just.circle = true; }
      if (edges[12]) this.menu.push('up');
      if (edges[13]) this.menu.push('down');
      if (edges[14]) this.menu.push('left');
      if (edges[15]) this.menu.push('right');
    } else {
      this.left = { x: 0, y: 0, mag: 0 };
      this.right = { x: 0, y: 0, mag: 0 };
    }
  }

  _updateStick(ring, x, y, songTime) {
    const rawMag = Math.hypot(x, y);
    const live = this._deadzone(x, y);
    if (ring === 'L') this.left = live; else this.right = live;
    if (!this._fired[ring] && rawMag >= this.flickThreshold) {
      this._fired[ring] = true;
      this.flicks.push({ ring, dir: vectorToDir(x, y), angle: Math.atan2(y, x), mods: this.heldMods(), mag: rawMag, t: songTime });
    } else if (this._fired[ring] && rawMag <= this.releaseThreshold) {
      this._fired[ring] = false;
    }
  }

  _deadzone(x, y) {
    const m = Math.hypot(x, y);
    if (m < this.deadzone) return { x: 0, y: 0, mag: 0 };
    const s = (m - this.deadzone) / (1 - this.deadzone);
    return { x: (x / m) * s, y: (y / m) * s, mag: s };
  }

  heldMods() {
    const out = new Set(this.demoMods);   // attract auto-play "holds" these
    const pad = this._pad;
    if (pad) for (const [i, name] of Object.entries(MOD_BUTTONS)) {
      const b = pad.buttons[i];
      if (b && (b.pressed || b.value > 0.35)) out.add(name);
    }
    return [...out];
  }

  justPressed(name) { return !!this._just[name]; }
  takeFlicks() { const f = this.flicks; this.flicks = []; return f; }
  takeMenu() { const m = this.menu; this.menu = []; return m; }

  // --- Keyboard: MENUS ONLY (no gameplay — this game needs real sticks) ----
  _installKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Enter') { this.menu.push('confirm'); this._just.confirm = true; }
      else if (e.code === 'Escape') { this.menu.push('back'); this.menu.push('pause'); this._just.escape = true; }
      else if (e.code === 'ArrowUp') this.menu.push('up');
      else if (e.code === 'ArrowDown') this.menu.push('down');
    });
  }
}
