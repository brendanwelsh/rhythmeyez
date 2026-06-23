# 👁 EYE BEATS

> An **optical dual-analog-stick rhythm game**. Two **realistic 3D eyeballs** (Three.js) are your
> **pupils** — push a stick and that eye looks *outward* toward the incoming light; centre the stick
> and it stares straight back at you. **Lasers** (the notes) streak IN from every direction and you
> orient each eye to "eat" them on the beat. Keep up and the track plays clean;
> slip and the mix glitches. Pure black, electric/acid/LCD, the whites going **bloodshot** as your
> combo climbs. Built on **Three.js + Canvas + Web Audio**, no build step, runs in a browser tab.
>
> *(A fork of [CHUMSTICK RHYTHM](../dualstick-rhythm) — same flow-rhythm core, all-new optical skin.)*

---

## What it is

The stick is read as what it physically is — an **absolute analog position** in a disc — so scoring
is **continuous and presence-based**, judged every frame. Five note types, each a different laser:

- **tap** — a fast bolt; be aimed in its arc *as it arrives*. A quick zap.
- **hold** — a fat sustained beam; park the eye on it and keep it there.
- **slide** — the contact point sweeps around the rim; trace the moving laser.
- **spin** — whirl the stick to fill a gauge; the **eye spins** (either direction, and one eye can
  spin solo while the other does something else — *spin frenzy*).
- **center** — the beat: pull the stick to **neutral** so the eye stares dead
  ahead. Concentric rings close onto the pupil to cue it.

**Modifiers are shoulders/triggers only** (`L1 / R1 / L2 / R2`) so you never lift a thumb off a
stick. Face buttons + d-pad drive the menus.

## Play it

Serve the folder over `http://` (Gamepad API + ES modules + the Three.js CDN need it):

```bash
python -m http.server 8002      # …or:  npx serve .   (8002 is this project's port)
```

Open **http://localhost:8002**, then: **click** once for sound → connect a **DualSense** and press a
button to wake it (the title screen's eyes follow your sticks — that's your controller test) →
**pull L2 + R2 to stare** and start.

## Songs

Two built-in charts: **Raise Your Weapon (Camo & Krooked remix)** and **Electric Feel (Justice
Remix)**. **The audio isn't bundled** (copyright) — drop the matching file in `assets/`
(`raise-your-weapon.mp3`, `electric-feel.mp3`), or use the **pick-a-local-file** control on the
song-select screen. Without audio a **synth groove** locked to the chart BPM keeps it fully
playable. Bring your own track from **browse songs → Load custom** (auto-charts it).

## The 3D eyes

`src/eyes3d.js` builds each eye as a textured sphere (sclera + radial-fibre iris + wet cornea glint)
lit on black with hue-cycling electric rim lights. The eye rotates to look toward the stick aim, the
whites go bloodshot with combo, and it whirls during a spin. It's **pluggable**: drop a
`models/eye.glb` in and it's loaded via `GLTFLoader` in place of the procedural eye.

## How it's built

Vanilla **JavaScript + Three.js (CDN, build-free) + Canvas + Web Audio**. Timing runs entirely off
`AudioContext.currentTime` (never `setTimeout`). A WebGL canvas draws the 3D eyes; a transparent 2D
canvas overlays the lasers + HUD and targets each eye's projected screen position.

```
index.html · styles.css
src/   eyes3d (Three.js eyeballs) · render (2D laser/HUD overlay) · input (gamepad + haptics) ·
       chart (note types incl. center/spinDir) · scoring (presence/coverage) · audio · beatgen · main
beatmaps/  committed chart JSON (no audio)
scripts/   chart builders + headless node tests (sim, render smoke)
assets/    drop local audio here (gitignored)
```
