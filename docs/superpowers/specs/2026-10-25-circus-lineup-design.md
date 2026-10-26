# The circus lineup: three new levels, a merged intro, a boss — design

**Date:** 2026-10-25 · **Status:** approved by Caelan 2026-10-25 (decisions at the end), ready for a plan
**Goal:** Clown City should read as a finished game on his website, not a one-day
build. Grow it from a handful of levels into a full show with a start, a middle and a
boss, using the physics that already feel good (the momentum, the back-and-forth,
the jumps).

## Principles

- **Two elements per level.** Each level teaches one new thing, then combines it with
  a second. A third is allowed as the twist at the end, or as a callback in the
  finale. A level made of five unrelated gimmicks is a theme park, not a level.
- **Teach → test → twist.** The first beat is safe and can be passed with no input.
  The middle asks for the move under pressure. The end combines both elements. (The
  Big Top already works this way.)
- **No fun stoppers.** Bigger and faster is always better: no caps or speed bleeds
  that punish going big. Heights pay out by *drop height* (`Player.airTop`), never by
  fall speed, which caps at 720 after four tiles. The Strongman already does this.
- **Turning is the core verb.** Every level has at least one place where the way
  forward is behind you, or where turning is how you wait.
- **Every level is verified.** Either the pit-jumping bot plays it whole (preferred,
  as with the Strongman), or it's marked `bot: false` and gets its own check that
  proves each beat is possible.

## The lineup

| # | Level | Element 1 | Element 2 | Status |
|---|---|---|---|---|
| 1 | **The Big Top** (intro) | the basics: jump, turn, wall-jump, spray | (no gimmick) | merge of Big Top + Catwalk |
| 2 | The Carousel | spinning deck (loop) | horses + brass rings | built, uncommitted |
| 3 | The Duck River | rubber-duck rhythm | shooting gallery → drawbridge | built, uncommitted |
| 4 | The Strongman | tower climb | hammer → bell | built, uncommitted |
| 5 | **The Human Cannonball** | cannons | trampolines (twist: trapeze) | new |
| 6 | **Balloon Bash** | rising balloons | basketball shot | new |
| 7 | The Big Drop | the ramp launch | the tent is the door to the boss | exists, reworked ending |
| 8 | **The Ringmaster** (boss) | the lion + whip | rings of fire (callbacks: trapeze, high wire, trampolines) | new |

Eight levels: two rows of four on an upright phone (the level select already wraps).

---

## 1 · The Big Top (intro, merged)

Fold the Catwalk's one essential lesson (a dead end that makes you turn around) into
the Big Top, then retire the Catwalk as a separate level.

- **Keeps:** pit, patrol under a one-way ledge (stomp or spray), boost belt into a
  wide pit, kicker onto a ledge, wall-jump shaft to the goal.
- **Adds:** one dead-end room after the kicker. The way on is behind you, so it
  teaches the turn (and that turning sprays).
- **Cuts:** the second belt-into-kicker combo, the Catwalk's death-void and ferry.
  Target length about 60 s on a first run. No new systems.
- **Verify:** the bot plays it; `warningTime` still ≥ 1.0 s in deck mode.

## 5 · The Human Cannonball

*Elements: cannons + trampolines. Twist: the trapeze.* A left-to-right level about
being flung: the jump physics and overspeed doing the work.

**New parts**
- **Trampoline** — a static bounce pad (the duck bounce, but elastic). Landing returns
  `bounceE` (≈0.85) of the height you fell: `vy = −√(2·gravityUp·drop·bounceE)`, drop
  measured from `airTop`. A press on landing adds `rampJumpPop`, so you can pump each
  bounce higher. No ceiling (`speedLimit` is the only guard).
- **Cannon** — touch the barrel and Poko is loaded (hidden, wheel locked).
  - *Fixed* cannons fire after a 0.4 s fuse.
  - *Rotating* cannons sweep through an arc and fire when you press (Donkey Kong
    Country barrel style).
  - Launch speed ~900 px/s along the barrel. The horizontal part is kept as overspeed
    (it fades on flat ground as usual), and `travelDir` follows the barrel.
- **Trapeze** — a bar on a rope (length L) that swings by itself. Touch it in the air
  and Poko hangs from it as a pendulum: `θ'' = −(g/L)·sin θ`. Grabbing keeps your
  speed (`ω = v_tangent / L`). A press lets go at the bar's current velocity, so you
  time the release. Holding too long (3 s) drops you.

**Beats**
1. A trampoline in a pit: with no press it bounces you out; a press reaches a gem.
2. A fixed cannon fires you over a pit too wide to jump, into a net.
3. A trampoline chain up a cliff: each pumped bounce goes higher.
4. Trapeze over a pit: grab, swing, release at the forward peak onto a ledge.
5. Rotating cannons, chained two or three in the air: press when the barrel points
   at the next one.
6. **The act:** cannon → catch a trapeze mid-flight → release onto a trampoline →
   bounce into the goal net.

**Size:** ~140 × 25. **Verify:** own check (`bot: false`; the bot can't time a
release). It proves each beat with scripted presses and sweeps release windows (the
same idea as the duck-boarding sweep) to report how wide each timing window is.

## 6 · Balloon Bash

*Elements: rising balloons + a basketball shot.* A climb, like the Strongman but
upward-moving, ending in a carnival basketball booth.

**New parts**
- **Balloons** float up from vendors at the bottom (≈40–60 px/s, with a little
  drift). Landing on one bounces you (duck-style: a small hop, or a big one with a
  press) and **pops it**, so each balloon is used once. Spray pops them too, including
  ones you needed, so careless spraying costs you. Some balloons hold gems that drop
  when popped.
- **Basketball** — a real physics object: gravity, bounce off floor and walls
  (restitution ≈0.6). Touch the rack to pick one up. Carrying it doesn't lock the
  wheel; it rides overhead like the hammer.
- **The shot:** while carrying the ball, **your jump throws it** (decided). It leaves with your
  real speed plus a lob (`travelDir·80, −620`). Where you jump from and how fast you're
  going are the aim, and turning lets you shoot back the other way.
- **Oval hoop** — a backboard plus two rim points (small circles the ball really
  bounces off). The opening is only about 1.3 ball-widths, the carnival trick. A
  basket counts when the ball's centre passes *downward* between the rims. Misses roll
  down a return chute back to the rack (LittleBigPlanet style), so you can retry
  without climbing again.

**Beats**
1. One vendor, one balloon: a single bounce up to a ledge.
2. A shaft of rising balloons: hop from balloon to balloon as they rise. Walls on
   both sides allow wall-jump saves.
3. Balloons and gems in the open: spray pops gem balloons, but also your stepping
   stones.
4. **The booth at the top:** rack, run-up, gap, oval hoop. One basket opens the exit;
   three baskets win the big prize gem.

**Size:** ~40 × 50 (tall). **Verify:** own check. A balloon climb from a scripted
start, and a sweep of jump points on the booth floor reporting the range that scores
(it must be non-empty from both directions).

## 7 · The Big Drop → the tent

No physics changes. Its tent finale ("INTO THE BIG TOP!") stops being the end of the
game and becomes **the door to the boss**: the swallow cinematic, then the boss level
loads with no level-select stop. The win screen moves to after the boss.

## 8 · The Ringmaster (boss)

*Elements: the lion + whip, and rings of fire. Callbacks: trampolines, the trapeze,
the high wire.* Inside the big top: one ring floor about two screens wide, stands on
both sides, trampolines at the edges, trapezes and a high wire overhead.

**Cast and parts**
- **The Ringmaster** on a podium, in a top hat, with a whip. Hits come from spray,
  lunge or stomp, and only while he's open (just after a whip crack, before he
  recovers). Each spray burst counts once, not once per particle. Three hits, one per
  phase, shown as three pips in the HUD.
- **The whip** — telegraphed: a 0.6 s wind-up, then a lash along a line at a set
  height. Deadly. Jump it or be under it.
- **The lion** charges back and forth across the ring and leaps through rings of fire.
  Its back is bouncy (stomping it bounces you; it can't be killed), and that bounce is
  how you reach the podium.
- **Rings of fire** — hoops whose rim burns but whose middle is safe. Jumping through
  the middle is the move: it scores and, in phase 2, it's your way to the
  Ringmaster.

**Phases** (each has its own checkpoint, so dying restarts that phase, not the fight)
1. **The floor.** The whip cracks and the lion charges through a ring of fire. Jump it,
   or bounce off its back up to the podium and hit the Ringmaster while he's open.
2. **The high wire.** He climbs to the wire and hangs rings of fire from it, lashing
   down. Climb by trampoline and trapeze, and go *through* a ring's middle to reach
   him.
3. **The lion turns.** Spray the whip out of his hand: it's a target like a tin duck,
   swinging on his arm. With the whip gone, the lion chases him out of the tent.
   Finale cinematic, confetti, win screen.

**Size:** ~60 × 25 arena. **New systems:** a boss state machine with phases and HP,
the lion, the fire ring, the whip, phase checkpoints, the HP pips. **Verify:** own
check, a scripted run per phase that lands each hit. It also confirms a ring's rim
kills, its middle doesn't, and the whip only hits during the lash.

---

## Shared groundwork (before the new levels)

1. **Save by level name, not position.** Progress is stored in arrays indexed by level
   number, so reordering, merging or inserting levels would scramble every live
   player's save. Key it by level name, and migrate old arrays once on load.
2. **One carry system.** Generalize the Strongman's hammer into a carried object
   (hammer, basketball): pick up, ride overhead, put down or throw, with an option for
   whether it locks the wheel.
3. **Bounce surfaces as one rule.** Duck (a fixed hop), trampoline (elastic, height
   from drop) and balloon (a fixed hop, then pop) share the one-way landing code with
   a `bounce` type.
4. **On-screen hints for new verbs**, through `Layout.hint` so the wording matches the
   control scheme: "spray the ducks", "press as you land", "turn to wait", "jump to
   shoot".

## Build order

| Step | What | Done when |
|---|---|---|
| M0 | Playtest + commit Carousel, Duck River, Strongman | played by hand on desktop and phone; one commit per level |
| M1 | Save by level name + migration | an old save loads with every level's progress intact |
| M2 | Trampoline, cannon, trapeze, carry system | each has a small check on a scratch map (`verify/sim.js` style) |
| M3 | The Human Cannonball | its check passes; full suite green |
| M4 | Balloons, basketball, hoop → Balloon Bash | its check passes; full suite green |
| M5 | Intro merge, reorder, hints | bot plays the new Big Top; deck warning ≥ 1.0 s |
| M6 | Lion, fire ring, whip, Ringmaster; Big Drop → tent → boss; win flow | boss check passes; win screen after the boss only |
| M7 | Polish + release | new sounds (squeak, ding, cannon boom, organ loop), README, `og.png`, v0.7.0 |

M0 comes first because three levels' worth of work is sitting uncommitted. M1 comes
before any reorder because the site is live. After M5 is the natural point to stop and
judge whether eight is the right number.

## Decisions (Caelan, 2026-10-25)

1. **The high wire goes in the Ringmaster's tent** (boss phase 2), not the Cannonball
   level. The trapeze is taught in the Cannonball level and comes back in the tent.
2. **The Big Drop and the boss are two levels back to back.** The tent's swallow
   cinematic is the door; the boss loads straight after with no level-select stop.
3. **The Catwalk is retired.** Its dead-end turn lesson moves into the merged intro.
4. **The jump throws the basketball.** One button; aim by where and how fast you jump.
5. **The boss takes three hits in total**, one per phase.
