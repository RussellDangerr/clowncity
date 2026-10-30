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
- `js/level.js` — 5 levels, in order (each pairs two elements; spec in
  `docs/superpowers/specs/2026-10-25-circus-lineup-design.md`):
  1. **The Big Top** (circus, 211 wide — the intro: the old Big Top up to its col 107 —
     pit, patrol under a one-way, **boost belt** into a pit too wide for cruise, a small
     **kicker** onto a ledge — joined at floor level to the old Catwalk from its col 9 (its
     first pit filled: it caught early jumps off the kicker ledge): a belt room that
     dead-ends, TURN, the belt slings you back up a kicker that launches LEFT onto a ledge,
     a second dead end, TURN onto the catwalk, ferry, goal. The Catwalk is retired).
  2. **The Strongman** (strongman theme, 48 wide x **45 tall** — maps aren't fixed at 25 rows:
     a tower of four wall-jump shafts on alternating sides, floors running opposite ways, floor
     gaps drop you back a floor. A gap must leave even a late jump's landing clear of the next
     shaft's wall, or the wall-jump sends you back. A trampoline on the ground floor teaches the
     press; one on the top floor is the run-up. Going off the top grabs the hammer
     (`Player.hauling`: too heavy to steer, he sails on); DOWN slams it straight down, and the
     `strongman` entity grades ONLY the height he pressed from, against the top floor
     (`Player.slamFrom`; `rollFrac` 0.25, `ringRise` 150): at the edge ~25% of the pole, pressing
     late less, the top of a pumped bounce rings it, never pressing is a thud. The bell is a bonus,
     not a lock: it pays out the gem above it. After any hit he stands by the plate: right is the
     exit, left at the tower wall flings him back to the top floor with the hammer re-hung. The
     map's `headroom` lets the camera rise above row 0 for the bounce. The camera rides the puck
     (`Camera.focus`)).
  3. **The Duck River** (pond theme, 176 wide, left to right: water `w` is lethal; `ducks`
     streams float rubber ducks downstream that BOUNCE Poko (`duckBounce`, a press on landing
     pops to ~297px in the ducks' frame, unpressed ~143). Stream `gaps` are the rhythm and never
     change as ducks drift, so hop distances are independent of the current's speed: 144 = hop,
     296 = press, and the duck before a big gap is PINK with an up-arrow. A nose-to-tail creek
     (the lesson), three rivers (144/144/296, then 144/296 twice) split by checkpoint islands 10+
     tiles wide (a pressed hop overshoots anything narrower, so mid-river rocks don't work); then a
     shooting gallery pen: five `tinduck`s on a rail, knocked down by spray/lunge, and the last drops
     the drawbridge (`u` wall → `n` span, `Level.openBridge`). The map's `lessons` swap the goal line
     on the way past. Boarding off a bank can be blocked for <1s of each duck cycle; turning on the
     bank is the wait).
  4. **The Carousel** (carousel theme, 120 wide, `wrap: true` — a LOOP: no edge walls, Poko's
     x keeps growing lap after lap and every lookup folds through `Level.near(rect)` / wrapped
     columns. The `D` deck carries Poko at the map's `deckSpeed` (160): with the spin 560 px/s,
     against it 240. Eight `horse` entities ride the deck and bob low; their backs BOUNCE like
     ducks. Three brass rings unlock the gate (col 8): A `r` (deck jump), B rides ahead of
     horse 3 at a fixed height (`ring: true`; a pressed bounce off that horse grabs it), C `r`
     off the far end of the 32-tile booth roof (a pressed horse bounce gets you up). Lessons
     from making it fair: hazards ≥ a jump apart (~11.5 tiles at 560), and the bob period must
     not divide the 9.6s you take to lap a horse (2.4 did: same bob height every meeting). A loop
     gets a fixed frame in the HUD (`Game._drawLoopFrame`): posts at the screen edges plus a lap
     dial of Poko, the gate and the rings).
  5. **The Big Drop** (midnight, 228 wide x 40 tall, the finale — jumps stepping down, a
     checkpoint at each, no shortcut. Every pit shows what's in it from the jump (the view is ~8
     rows below Poko, 7.5 on the deck): a net with solid right under it, or water close under the
     ledge; never a floor to get stuck on. Lessons stack: J1 a net (`trampoline`), J2 a `trapeze`
     over water, J3 a kicker over a net, J4 a trapeze to a small island, then both at once: only a
     pumped bounce off a low net flies high and far enough to catch the big trapeze over the
     water. Then the 16-tile curved ramp: drop / bowl /
     45° lip → launch over a pit → tent on the mesa; unpressed it peaks ~2 tiles under the
     mesa, a press anywhere on the ramp clears it. Passing over the tent's column at any
     height counts as entering it, so an overshoot can't strand you).
  Ramps are a map's `ramps` list of Hermite points `[tileX, tileY, slope]`
  (`Level.rampY/rampSlope/rampAt`); their cells stay `0` in the grid but count as solid in
  `solidGrid` (edge drawing, the bot). Materials (`solid`, `treadmill`, `boost`, `deck`,
  `plank`), themes, rendering. Tile legend: `1` solid, `0` air, `T` treadmill, `B` boost belt,
  `D` carousel deck, `r` brass ring, `w` water, `u`/`n` drawbridge up/down, `g` goal, `c`
  checkpoint (passing its column at any height takes it, once; a loop's keep working), `o` gem, `/` `\` slopes (rise right /
  rise left, 45°). Most maps are 25 rows with the floor on rows 22–24 and spawn `[3,21]`; the
  Strongman (45) and the Big Drop (40, spawn `[3,7]`) are taller. Set-piece maps carry an
  `objective: [goal, Layout hint key]` shown at the start and when you bump the lock.
- `js/entities.js` — `MovingPlatform`, `OneWayPlatform`, `PatrolEnemy`, `CarouselHorse` (one-way top that
  carries + lifts its rider), `DuckStream` (one entity, many bouncy rafts: `getSolidRects`),
  `TinDuck` (`getTargetRect`/`knock`, hit in `Player.checkHazards`), `Strongman` (hammer, lever,
  puck, bell as one state machine), `Trampoline` (elastic one-way: gives back `trampReturn` 0.9 of the
  height fallen, `trampPump` 1.25 with a press as you land), `Trapeze` (a real pendulum that hangs still until caught: his
  velocity at the catch sets the swing, a press lets go with the bar's real velocity plus a pop; hanging on as
  `Player.swinging` is safe and keeps its energy), `OneWayPlatform`,
  `Entities.kill()`. Rect getters return the copy nearest Poko on a loop.
- `js/game.js` — state machine (title/levelSelect/playing/levelComplete/paused/win/tentFinale),
  HUD/menus. `title` is only the boot state under the marquee splash (nothing returns to
  it; the win screen goes back to level select). Level count is dynamic: `Game.totalLevels = Level.maps.length` — don't hardcode.
  **Saves are keyed by level NAME** (`Game.save.levels[name]`, via `levelRecord(i)` / `levelUnlocked(i)`), so
  levels can be added, merged or reordered; renaming a level orphans its progress. Old array saves migrate
  once through the frozen `Game.legacyOrder` (never edit it). A beaten level never relocks.
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
- DOWN (`Input.downPressed()`: arrow, S, deck ▼, swipe down) stops the wheel dead with a lethal
  confetti spray (`Player.parked`; a moving deck or duck still carries him). In the air it's a slam,
  straight down. The next steer rolls him on; a jump while parked goes straight up.
- New input sources go through `Input` virtual keys, not new game-logic branches. DOM UI
  that takes touches carries `data-ui`.

## Tuning knobs (all in `player.js` constants)
`runSpeed` (400), `startRampTime` (1.5, level start), `respawnRampTime` (0.4),
`reverseDecel` (2400, the turn's brake), `pauseAtZeroTime`, `treadmillCap` (200), `boostSpeed` (680),
`boostAccel` (1600), `brakeWindow` (0.18), `jumpForce` (-480), `deckGrip` (1200, carry → deck speed),
`duckBounce` (260),
`trampReturn` (0.9), `trampPump` (1.25).
Turning and spraying cost no speed: a turn takes ~0.2s and pays the stored speed back the new way
(never under cruise); a spray is free apart from its cooldown. `?turn=old` and `?spray=kick|cost`
in the URL switch to the alternatives to feel them (`reverseAccel`, `spinAttackKick`, `spinAttackCost`).
Combat / walls: `attackThreshold` (0.5), `wallSlideSpeed` (120),
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
  launch, all levels in both layouts, the Carousel's speeds/seam/rings/lock, the Duck River's rhythm/crossings/boarding/gallery, the Strongman's grab/drop/grading/lock,
  save migration; the bot plays the Strongman whole; `fullRuns` wins the Carousel and Duck River from spawn).
  The bot-driven checks skip maps marked `bot: false` (the bot only jumps pits) — those need their own check. Reload the page first.
- `verify/play.js` — `playLevel(i, opts)` full-level bot through the real engine with
  touch-equivalent input.
- `verify/solve.js` — `solveLevel(name, {warp})`: look-ahead playthrough for `bot: false` levels. Before
  each press it sandboxes the whole game state, only takes jumps with ≥ 0.1s of slack (presses mid-window),
  turns to wait otherwise; `warp` shifts the moving parts so runs meet them at other moments. Policies
  per level; the `fullRuns` check runs them. `window.__solve` exposes the sandbox for experiments.
- `verify/sim.js` — Player-only physics on a scratch map.
- `verify/og.js` — renders `og.png` (the link preview) from the game's own drawing.
Harnesses set `Engine.halted` and step `Engine.systems` by hand. **A hidden browser pane
never fires requestAnimationFrame** (frozen loop, `innerWidth` 0), so screenshots need
the pane visible, or call each system's `draw` right before capturing.

## Out of scope / follow-ups
- Real sprite art (the player is a procedural unicycle now; no spritesheet).
