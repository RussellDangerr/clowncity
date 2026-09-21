# Clown City — project memory

A browser game: **Bozo the Clown on a unicycle**, a bidirectional auto-runner
(as of v0.2.0). Vanilla JS, **no build step, no dependencies**. Open `index.html`
in a browser to run; deployed live at clowncity.russelldangerr.com (main → Cloudflare).

## Architecture
- Singleton-object modules (not ES modules/classes for the core), loaded via
  `<script>` tags in `index.html`. **Load order matters**: `tokens.js` first,
  then `engine.js`, …, `game.js` last.
- `Engine` (engine.js): fixed-timestep loop at 120 Hz; registered systems each
  expose `update(dt)` / `draw(ctx)`. **`Input` is registered LAST** so its
  single-frame flag clear runs after all consumers read them. **`Input` is a
  top-level `const`, NOT a window property** — `window.Input = fake` is a no-op
  in any harness; mutate `Input.runDir` / `Input.buffer` directly.
- Internal canvas **960×540** normally, **640×480 in deck mode** (touch device held
  upright), chosen by `Layout` (layout.js) and CSS-scaled to fit. All drawing reads
  `Engine.width/height`; never hardcode the size.

## Key files
- `js/player.js` — Bozo. Unicycle **momentum state machine** (`ramp`→`cruise`→`brake`),
  `approach()` helper. Combat = brake-lunge, spin-out spray (the lethal confetti IS the
  hitbox) and stomp, in `checkHazards()`; wall slide / wall-jump / rev-climb. A wall-jump
  and `spawn()` sync `Input.runDir` (else the sticky steer U-turns Bozo). `finish()` at
  the goal → coast to a stop (`hidden` for the tent).
  `facing` is frozen (always faces one way); `travelDir` is the real direction.
  `resolveCollisions()` X-pass uses a **`stepTolerance` guard** (`overlapY > 8`) so flat
  floor seams aren't misread as walls — that was snagging momentum. Slope tiles live in
  `Level._slopeGrid` (excluded from `_tileGrid`); `Player.resolveSlopes()` runs AFTER the
  square-tile passes so `stepTolerance` is never triggered by slopes. `Player.momentum` is
  clamped 0..1 (HUD/attack); `Player.overspeed` is a separate getter (0 at cruise, grows
  above it) feeding only the speed-scaled jump — keep these separate. The player draws as
  a **procedural unicycle** in `_drawRectFallback()` (spinning wheel + frame + body),
  with a velocity-driven `lean`/`wheelAngle` sway; purely visual, hitbox unchanged.
- `js/input.js` — keyboard + touch. **Virtual keys** `_down/_up/tapKey(code)`: the
  keyboard, the deck and the pause menu all press through them. Touch gestures (swipe =
  steer via sticky `runDir`, any stationary touch = jump) ignore touches that start on
  `[data-ui]` elements. `jumpBuffered()/consumeJump()`, `tapped()/swipeEdge()` for menus.
- `js/layout.js` — picks the scheme (`deck` / `touch` / `keys`) and mode, sizes the
  canvas, sets `Camera.lookaheadX`, owns all input-dependent hint copy (`Layout.hint`).
  `Layout.force` overrides detection for checks.
- `js/controls.js` — DOM UI: the deck (◀ ▶ JUMP pause), the floating pause button
  (touch, sideways) and the pause menu, all wired as virtual keys; `update()` syncs the
  DOM to `Game.state`.
- `js/level.js` — 3 levels: **The Big Top** (circus, 80 wide — the original intro),
  **The Catwalk** (harlequin, 112 wide — merged Stage+Workshop; mandatory + optional
  wall-jump shafts, elevated catwalk over a death-void with a ferry), **The Big Drop**
  (midnight, 80 wide — rideable slopes / downhill overspeed / speed-jump → tent finale).
  Materials (`solid`, `treadmill`), themes, rendering. Tile legend: `1` solid, `0` air,
  `T` treadmill, `g` goal, `c` checkpoint, `o` gem, `/` `\` slopes (rise right / rise
  left, 45°). All maps 25 rows tall; floor on rows 22–24, spawn `[3,21]`.
- `js/entities.js` — `MovingPlatform`, `OneWayPlatform`, `PatrolEnemy`, `Entities.kill()`.
- `js/game.js` — state machine (title/levelSelect/playing/levelComplete/paused/win/tentFinale),
  HUD/menus. `title` is only the boot state under the marquee splash (nothing returns to
  it; the win screen goes back to level select). Level count is dynamic: `Game.totalLevels = Level.maps.length` — don't hardcode.
  `tent: true` on a `Level.maps` entry triggers the tent set-piece + `tentFinale` win state
  (derived from `_cachedGoals[0]`).
- `js/camera.js` — follow + lookahead keyed to `travelDir`.
- `js/tokens.js` — **design tokens** (color/font/space/motion + `rgba()`); single
  source of truth for the visual language. Audit + reference in `DESIGN-SYSTEM.md`.

## Conventions
- Route colours/fonts/magic-numbers through `Tokens.*` (not new hardcoded literals).
- Per-level palettes live in `Level.themes` (deliberately separate from `Tokens`).
- Combat: reversing makes the wheel lunge in the OLD direction = the attack; pressing
  your current heading sprays; stomp from above also kills; side/pit contact is fatal.
- New input sources go through `Input` virtual keys, not new game-logic branches. DOM UI
  that takes touches carries `data-ui`.

## Tuning knobs (all in `player.js` constants)
`runSpeed` (400), `startRampTime` (1.5), `reverseDecel`/`reverseAccel`,
`pauseAtZeroTime`, `treadmillCap` (200), `brakeWindow` (0.18), `jumpForce` (-480).
Combat / walls: `attackThreshold` (0.5), `spinAttackCost` (0.45), `wallSlideSpeed` (120),
`wallJumpForceY` (-440), `wallJumpPushX` (300), `revClimbSpeed` (280).
Collision/feel: `stepTolerance` (8, the flat-ground snag guard). Unicycle sway:
`cruiseLean` (0.10), `brakeLean` (0.14), `leanRate` (10), `wheelRadius` (8).
Slopes / banked overspeed (Big Drop): `overspeedCap` (720), `slopeAccel` (800),
`slopeUphillDrag` (600), `overspeedDecay` (500), `jumpSpeedBonus` (380, scales the
launch from −480 cruise to ≈−860 at full overspeed), `slopeSnap` (8).

## Verifying changes
No test framework. Run `index.html` (the preview server on 8081), then in the page:
- `verify/checks.js` — `runChecks()` regression checks (layout, deck, pause, hints,
  goal, win, meta, warning time, all levels in both layouts). Reload the page first.
- `verify/play.js` — `playLevel(i, opts)` full-level bot through the real engine with
  touch-equivalent input.
- `verify/sim.js` — Player-only physics on a scratch map.
- `verify/og.js` — renders `og.png` (the link preview) from the game's own drawing.
Harnesses set `Engine.halted` and step `Engine.systems` by hand. **A hidden browser pane
never fires requestAnimationFrame** (frozen loop, `innerWidth` 0), so screenshots need
the pane visible, or call each system's `draw` right before capturing.

## Out of scope / follow-ups
- Real sprite art (the player is a procedural unicycle now; no spritesheet).
