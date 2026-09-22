# Mobile sign-off: portrait deck mode + polish batch — design

**Date:** 2026-09-21 · **Status:** approved in brainstorming, ready for a plan
**Goal:** Clown City is Caelan's first project and lives on his website. It must be
playable and beatable on desktop and on phones — held **upright** (visitors won't
rotate) as well as sideways — with nothing embarrassing on it.

## Context: audit findings (2026-09-21)

A headless full-level bot (`verify/play.js`, new) drove every level through the real
engine with touch-equivalent input. Findings:

- **Fixed already (verified, own commit):** a tap wall-jump U-turned Poko back into the
  wall 0.12s after the kick (`_doWallJump` flipped `travelDir` but not the sticky
  `Input.runDir`), so shafts were only climbable by steering away; respawning after
  dying while heading left rode left. Both now sync `Input.runDir`. `verify/sim.js`
  sets `runDir` after `spawn()` so explicit runs keep their steer.
- All 3 levels are beatable. Measured slack: Big Top jumps ~260ms; Big Drop launch
  308ms (contiguous, mid-downhill → lip); Catwalk shaft climbs for any human cling
  time (≥ 67ms).
- Portrait phones get a 375×211 strip with ~5px menu text. Touch has no pause, restart
  or quit. A gesture tap fires on finger-lift and presses held > 0.25s are ignored.
- The rest of the list is in "Polish batch" below.

## 1 · Layout

**Two modes**, chosen by `matchMedia('(orientation: portrait) and (pointer: coarse)')`
and re-evaluated on every `resize` (orientation changes fire it):

| Mode | When | Internal canvas | Camera `lookaheadX` |
|---|---|---|---|
| **normal** | everything else (desktop any shape, phone sideways) | 960×540 (unchanged) | 60 (unchanged) |
| **deck** | touch device held upright (phones, tablets) | **640×480** (4:3, 20 tiles wide) | tuned (≈220) so Poko sits left of centre |

- `Engine` gains a layout setter that switches `width`/`height`, reassigns the canvas
  bitmap and re-scales. All drawing already reads `Engine.width/height` (no literal
  960/540 outside `engine.js`/a `tokens.js` comment), so menus, HUD and the camera
  clamp re-flow on their own.
- **Deck mode geometry:** the canvas spans the full width at the top (below the
  safe-area inset); the deck fills the rest. Scale = `min(vw / 640, (vh − 200) / 480)`
  so the deck is never shorter than 200px. Typical phone: game ≈ 375×281, deck ≈ 380px.
- `html`/`body` height uses `100dvh` with a `100vh` fallback so nothing hides under
  mobile browser toolbars (both modes).
- **No level or physics changes.** Only the view changes; everything the bot proved
  beatable stays beatable. Target: **≥ 1.0s of warning at cruise before every pit and
  enemy in deck mode**, measured, and `lookaheadX` tuned to meet it. (The camera's
  smoothing trails a cruising Poko by ~80px, so today's desktop view gives ≈1.07s,
  not the 1.35s the no-lag arithmetic suggests; deck mode needs `lookaheadX` ≈ 220
  to match it.)

## 2 · Controls

**Deck (deck mode only):** DOM buttons in `index.html` — ◀ and ▶ bottom-left, a large
**JUMP** bottom-right, **pause** in the deck's top corner. Every touch target ≥ 64px.
Marquee styling (gold ring, oxblood fill, Silkscreen labels), colours as CSS vars
alongside the splash's.

**Virtual keys.** `input.js`'s keydown/keyup bodies are extracted into
`Input._down(code)` / `Input._up(code)`; the keyboard listeners call them, and so do
the deck buttons on `pointerdown` / `pointerup|pointercancel|pointerleave`:

| Button | Virtual key | So it gets, for free |
|---|---|---|
| ◀ / ▶ | `ArrowLeft` / `ArrowRight` | turn, spray (press your heading), wall steer-off, level-select navigation |
| JUMP | `Space` | jump, wall-jump, menu confirm |
| pause | `Escape` | pause / resume |

Buttons fire on touch-**down** (instant jump in deck mode). Keyboard behaviour is
unchanged because it runs the same path. The deck gets `touch-action: none`,
`user-select: none` and `-webkit-touch-callout: none` so iOS never shows a long-press
menu or magnifier, and it sits below the splash (z-index) so the curtains cover it.

**Gestures stay on for touches that start on the game.** The window touch handlers
ignore any touch whose target is inside a UI element (`e.target.closest('[data-ui]')`
on the deck, pause button and pause menu), so a JUMP press never also counts as a tap.
Gesture taps no longer have a duration limit: any touch that doesn't move is a jump.

**One pause menu for all inputs:** a DOM overlay in marquee style with **Resume /
Restart / Levels / Sound** buttons (tap or click). Each button sends the existing
virtual key (`Escape` / `KeyR` / `KeyQ` / `KeyM`), so the pause logic stays in
`Game.updatePaused`. A small controller system (registered before `Input`) shows or
hides the overlay to match `Game.state === 'paused'` and keeps the Sound label current.
The canvas-drawn pause text is removed. Entry points:

- deck mode — the deck's pause button
- phone sideways — a small floating pause button in the game's top corner, shown only
  on touch devices while playing
- desktop — Esc / P (no on-screen button)

**Hints match the input scheme** — `'deck'`, `'touch'` (coarse pointer, not deck) or
`'keys'`, with the strings kept in one place:

- splash hint line (set on load and on layout change)
- level-select footer
- the pause menu, which also lists the controls
- the canvas mute label: "[MUTED - M to toggle]" becomes plain "MUTED" on touch

Deck: "◀ ▶ turn · JUMP jump · press your heading to spray". Touch: "swipe to turn · tap
to jump · swipe your heading to spray". Keys: arrows / Space.

## 3 · Polish batch

1. **Splash key handoff:** after dispatching its synthetic Space `keydown`, the splash
   also dispatches the matching `keyup` (today `Input.keys.Space` sticks and the first
   real Space on level select is swallowed after clicking the splash).
2. **Goal behaviour:** on touching a goal, `Player.finish()` sets `finished`. While
   finished, Poko ignores input, skips hazards and brakes to a stop (`reverseDecel`);
   gravity and collisions still run. `spawn()` clears it. On a `tent: true` level the
   player stays hidden and frozen after the finale. This fixes riding back down the Big
   Top shaft, falling forever off the Catwalk, and reappearing out of the tent.
3. **Ending:** the win screen leads back to **level select**. The canvas title leaves
   the flow: it remains only as the boot state under the splash, and level-select Esc
   no longer goes there. The win screen uses the marquee display fonts (Ewert / Cinzel,
   added as `Tokens.font` entries) so the last screen matches the first.
4. **Website metadata:**
   - an inline SVG favicon (fixes `/favicon.ico` returning the HTML page)
   - `<meta name="description">`
   - Open Graph and Twitter card tags, with a **1200×630 `og.png`** rendered from the
     game's own drawing (own art, safe for the public repo)
5. **Cleanups:**
   - The LOCKED label font goes through `Tokens`.
   - Correct the stale Big Drop map comment (downhill starts at col 22 since v0.4.1).
   - Refresh `CLAUDE.md` (runSpeed 400, spray combat, wall systems, deck mode,
     `verify/play.js`).
   - Tag `v0.4.0` / `v0.4.1` (the push needs Caelan's go-ahead).

## Testing

- `verify/play.js`: all 3 levels reach the goal in **both** layouts.
- Warning-time measurement per pit and enemy in deck mode (target above).
- Deck buttons: synthetic pointer events on each button produce the expected `Input`
  state. JUMP does **not** also register a gesture tap. Pause menu buttons each work.
- Screenshots:
  - upright phones at 375×667 and 390×844
  - sideways at 812×375
  - desktop
  - turning the phone mid-level (no errors, and the camera and HUD re-flow)
- Keyboard regression: click the splash, then the first Space on level select works.
- **Caelan plays all three levels on his phone** (LAN URL) before release.

## Out of scope

- tapping a level card directly
- moving the Catwalk col-16 patrol (a 12% landing-overlap)
- restyling the level-select screen
- touchstart-jump for gesture taps
- sprite art

Revisit only if the playtest says so.

## Release

Commits land on `dev`. Merging to `main` deploys live (Cloudflare) as **v0.5.0**, and
only when Caelan says so.
