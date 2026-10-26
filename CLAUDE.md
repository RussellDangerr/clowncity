# Clown City — project memory

A browser game: **Poko the Clown on a unicycle**, a bidirectional auto-runner
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
- `js/player.js` — Poko. Unicycle **momentum state machine** (`ramp`→`cruise`→`brake`),
  `approach()` helper. Combat = brake-lunge, spin-out spray (the lethal confetti IS the
  hitbox) and stomp, in `checkHazards()`; wall slide / wall-jump / rev-climb. A wall-jump
  and `spawn()` sync `Input.runDir` (else the sticky steer U-turns Poko). `finish()` at
  the goal → coast to a stop (`hidden` for the tent).
  `facing` is frozen (always faces one way); `travelDir` is the real direction.
  **Moving ground:** `vx` is the wheel's speed over the surface; `carry` is the surface's speed
  (deck / horse), gripped toward `surfaceSpeed` while grounded, kept in the air, zeroed by a wall.
  Real speed = `vx + carry`; the drive, gauge and attacks only ever see `vx`.
  `resolveCollisions()` X-pass uses a **`stepTolerance` guard** (`overlapY > 8`) so flat
  floor seams aren't misread as walls — that was snagging momentum. Slope tiles live in
  `Level._slopeGrid` (excluded from `_tileGrid`); `Player.resolveSlopes()` runs AFTER the
  square-tile passes so `stepTolerance` is never triggered by slopes. It seats Poko on
  slope tiles AND curved ramps (`surfaceSlope` = dy/dx under the feet). On any slope the
  velocity runs **along the surface** (`vy = vx × slope`), so a lip launches Poko.
  **Slopes trade height for speed** (`vx² += 2·slopeGravity·drop`, climbing takes it
  back, the drive never drops below cruise), a slope *landing* pays out the height lost
  since takeoff by the same rule, and overspeed is **kept in the air** (it only decays
  on flat ground). No gameplay speed cap — `speedLimit` is a tunnelling guard only.
  Design rule: **no fun stoppers** — never add caps/bleeds that make bigger or faster
  worse. On a **launcher** ramp (one that curls up, `ramp.lip`), or any slope not heading
  downhill, a press **loads** (`lipLoaded`, crouch) and fires at the lip, adding
  `rampJumpPop` to the ramp's launch; a press up to `lipGrace` after the lip still pops,
  peaking where an on-time press would. `Player.momentum` is
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
- `js/level.js` — 6 levels: **The Big Top** (circus, 213 wide — the teaching intro, one
  idea at a time: pit, patrol, **boost belt** into a pit too wide for cruise, a small
  **kicker** onto a ledge (free launch makes it; a press takes the high gem) with an
  optional turnaround gem in the alcove under it, ferry, belt-into-kicker combo, wall-jump
  shaft to the goal; beats spaced so overspeed fades to cruise before the next one),
  **The Catwalk** (harlequin, 112 wide — the TURN level, every way forward is behind
  you: a boost-belt room dead-ends, you turn and the belt slings you back up a 5-tile kicker that
  launches LEFT; a press clears the ledge above, unpressed it drops you back on the floor heading
  left; a second dead end turns you onto the catwalk over a death-void with a ferry. Either turn
  works on the ground or as a wall-jump off the dead end), **The Big Drop**
  (midnight, 104 wide — one 16-tile curved ramp: drop / bowl / 45° lip → ~31-tile launch
  over a pit → tent on a high mesa; unpressed the launch peaks ~2 tiles under the mesa,
  a press anywhere on the ramp clears it by 3+ and takes the high gem), **The Carousel** (carousel
  theme, 120 wide, `wrap: true` — a LOOP: no edge walls, Poko's x keeps growing lap after lap and
  every lookup folds through `Level.near(rect)` / wrapped columns. The `D` deck carries Poko at the
  map's `deckSpeed` (160): with the spin 560 px/s, against it 240. Eight `horse` entities ride the
  deck and bob; three brass rings `r` (deck jump / horse jump / off the booth-roof one-way) unlock
  the goal, `Level.goalLocked`), **The Duck River** (pond theme, 176 wide, left to right: water `w` is
  lethal; `ducks` streams float rubber ducks downstream that BOUNCE Poko (`duckBounce`, a press on
  landing pops to ~297px in the ducks' frame, unpressed ~143). Stream `gaps` are the rhythm and
  never change as ducks drift, so hop distances are independent of the current's speed: 144 =
  hop, 296 = press. Two rivers (144/144/296, then 144/296) split by an island; then a shooting
  gallery pen: five `tinduck`s on a rail, knocked down by spray/lunge, and the last drops the
  drawbridge (`u` wall → `n` span, `Level.openBridge`). Boarding off a bank can be blocked for
  <1s of each duck cycle; turning on the bank is the wait), **The Strongman** (strongman theme, 48 wide
  x **45 tall** — maps aren't fixed at 25 rows: a tower of four wall-jump shafts on alternating sides,
  floors running opposite ways, floor gaps drop you back a floor. Rolling off the top grabs the
  hammer (`Player.hauling`: wheel locked, straight drop); the `strongman` entity strikes the plate
  with puck height = drop × 1.25 (drop from `Player.airTop`, not fall speed, which caps at 720),
  the camera rides the puck (`Camera.focus`), and the bell opens the goal. A gap must leave its
  landing clear of the next shaft's wall or the wall-jump sends you back). Ramps are a map's `ramps`
  list of Hermite points `[tileX, tileY, slope]` (`Level.rampY/rampSlope/rampAt`); their
  cells stay `0` in the grid but count as solid in `solidGrid` (edge drawing, the bot).
  Materials (`solid`, `treadmill`), themes, rendering. Tile legend: `1` solid, `0` air,
  `T` treadmill, `B` boost belt, `D` carousel deck, `r` brass ring, `w` water, `u`/`n` drawbridge up/down, `g` goal, `c` checkpoint (passing its column at any
  height takes it), `o` gem, `/` `\` slopes (rise right / rise
  left, 45°). All maps 25 rows tall; floor on rows 22–24, spawn `[3,21]` (the Big Drop
  starts high on its plateau, spawn `[3,5]`).
- `js/entities.js` — `MovingPlatform`, `OneWayPlatform`, `PatrolEnemy`, `CarouselHorse` (one-way top that
  carries + lifts its rider), `DuckStream` (one entity, many bouncy rafts: `getSolidRects`),
  `TinDuck` (`getTargetRect`/`knock`, hit in `Player.checkHazards`), `Strongman` (hammer, lever,
  puck, bell as one state machine), `Entities.kill()`. Rect getters return the copy nearest Poko on a loop.
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
`runSpeed` (400), `startRampTime` (1.5, level start), `respawnRampTime` (0.4),
`reverseDecel` (2400, the turn's brake), `reverseAccel` (1600, speed back after a turn — turning is the core move, so it's cheap; a spin-out's cost re-earns at `cruiseAccel` 420), `pauseAtZeroTime`, `treadmillCap` (200), `boostSpeed` (680),
`boostAccel` (1600), `brakeWindow` (0.18), `jumpForce` (-480), `deckGrip` (1200, carry → deck speed),
`duckBounce` (260).
Combat / walls: `attackThreshold` (0.5), `spinAttackCost` (0.45), `wallSlideSpeed` (120),
`wallJumpForceY` (-440), `wallJumpPushX` (300), `revClimbSpeed` (280).
Collision/feel: `stepTolerance` (8, the flat-ground snag guard), `coyoteTime` (0.1),
`Input.bufferTime` (0.1, the jump buffer). Unicycle sway:
`cruiseLean` (0.10), `brakeLean` (0.14), `leanRate` (10), `wheelRadius` (8).
Slopes / overspeed (Big Drop): `slopeGravity` (600, height→speed), `overspeedDecay`
(500, flat ground only), `speedLimit` (1500, tunnelling guard), `jumpSpeedBonus` (380 per
`jumpBonusSpan` 320 of overspeed, no ceiling), `slopeSnap` (8). Ramp launch:
`rampJumpPop` (280), `lipLoadSlope` (0.2), `lipGrace` (0.15 s).

## Verifying changes
No test framework. Run `index.html` (the preview server on 8081), then in the page:
- `verify/checks.js` — `runChecks()` regression checks (layout, deck, pause, hints,
  goal, win, meta, warning time, coyote window, respawn wall state, Big Drop ramp
  launch, all levels in both layouts, the Carousel's speeds/seam/rings/lock, the Duck River's rhythm/crossings/boarding/gallery, the Strongman's grab/drop/grading/lock;
  the bot plays the Strongman whole).
  The bot-driven checks skip maps marked `bot: false` (the bot only jumps pits) — those need their own check. Reload the page first.
- `verify/play.js` — `playLevel(i, opts)` full-level bot through the real engine with
  touch-equivalent input.
- `verify/sim.js` — Player-only physics on a scratch map.
- `verify/og.js` — renders `og.png` (the link preview) from the game's own drawing.
Harnesses set `Engine.halted` and step `Engine.systems` by hand. **A hidden browser pane
never fires requestAnimationFrame** (frozen loop, `innerWidth` 0), so screenshots need
the pane visible, or call each system's `draw` right before capturing.

## Out of scope / follow-ups
- Real sprite art (the player is a procedural unicycle now; no spritesheet).
