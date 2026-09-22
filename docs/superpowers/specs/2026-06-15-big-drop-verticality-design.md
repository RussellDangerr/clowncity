# The Big Drop — Verticality Update (Design Spec)

**Date:** 2026-06-15
**Status:** Approved (brainstorm) — pending implementation plan
**Scope:** Rideable slopes + overspeed + speed-scaled jump, a new showcase level
that ends in a cinematic launch into a circus tent, and a restructure of the
level list from 3 → 3 (merging two existing levels and slotting the new one).

---

## 1. Goal

Add **verticality** to Clown City built on the existing momentum-as-resource
identity. The player learns to **bomb downhill slopes to bank "overspeed"**
(speed above the normal cap), then **cash that speed into a much larger jump**.
The marquee moment is a final downhill that launches Poko off a ramp lip and
**arcs him into a circus tent** to win the level.

A "jump so big you have to build up speed" is delivered by coupling three
systems: slope collision → overspeed momentum → speed-scaled jump. Wall-jumps
already exist (v0.3.0) and are reused, not rebuilt.

## 2. Final level lineup (end state)

| Slot | Level | Change |
|------|-------|--------|
| 1 | The Big Top | **Untouched** |
| 2 | *Merged* Stage + Workshop | Combined into one harlequin level; **+ columns / vertical wall-jump climbs** |
| 3 | **The Big Drop** | New slope/overspeed/speed-jump level; **ends in a launch into a circus tent** |

Net result: still **3 levels**. The current Level 2 (The Stage) and Level 3
(The Workshop) collapse into one; The Big Drop takes slot 3.

## 3. Phasing

The work is built and verified in order. The Big Drop must feel right before any
level is restructured.

- **Phase A** — Slope engine + overspeed + speed-jump + the Big Drop level + the
  cinematic tent finale. The Big Drop is temporarily appended as **Level 4** so
  the three existing levels stay live and comparable while we build.
- **Phase B** — Merge the existing Levels 2 + 3 into a single new Level 2 with
  the column / wall-jump climb shafts.
- **Phase C** — Renumber to the final `[Big Top, merged, Big Drop]` order; verify
  and fix level-select / next-level wiring in `game.js`; update `CLAUDE.md`.

---

## Phase A — Slope engine + The Big Drop

### A1. Slope tiles — `js/level.js`

Two new legend characters:

- **`/`** — slope rising to the right (`slopeDir = +1`). Surface low at the left
  edge, high at the right.
- **`\`** — slope rising to the left (`slopeDir = -1`). High at the left edge,
  low at the right. *Authoring note: a literal backslash must be written `\\`
  inside the single-quoted JS map strings.*

**v1 angle is 45° only** — the surface height is linear within a tile, which keeps
the collision math (and the learning walkthrough) clean. Gentle 2:1 slopes are an
explicit follow-up if the downhill runway feels too cramped to build real speed.

Parsing (in `load()`): a slope char produces a tile
`{ x, y, w, h, type: 'slope', slopeDir }`. Slope tiles are stored so the collision
pass can find them but are **excluded from the solid square-tile grid**
(`_tileGrid`) used by `getTilesNear`'s wall/floor passes — they must never be seen
by the AABB X/Y resolution. A parallel lookup (e.g. a `_slopeGrid` keyed by
`col,row`, plus inclusion of slope tiles in a slope-aware `getTilesNear`) feeds the
new pass.

Surface height helper:

```
surfaceY(tile, worldX):
  localX = clamp(worldX - tile.x, 0, tileSize)
  if slopeDir > 0 (rise-right):  return tile.y + (tileSize - localX)
  else            (rise-left):   return tile.y + localX
```

`solidGrid` (used for render edge detection) marks slope cells as solid so
neighbouring square tiles render their shared edges correctly.

### A2. Slope collision pass — `js/player.js` `resolveCollisions()`

A **new dedicated pass**, run after the existing square-tile passes, using the
player's foot center x (`x + w/2`):

1. Find the slope tile under the foot column (if any).
2. Compute `topY = surfaceY(tile, footCenterX)`.
3. If the feet (`y + h`) are at or below `topY` within a snap tolerance **and**
   the player is descending or already grounded (`vy >= 0` or `grounded`), seat
   the player on the surface: `y = topY - h`, `grounded = true`, `vy = 0`.
   Do **not** snap when clearly rising through a slope from below
   (`vy < 0` and foot above the surface by more than the tolerance) — that lets
   the speed-jump punch up past a slope lip.
4. While seated, expose the **grade** (here, ±1 for 45°) and `slopeDir` so the
   momentum driver (A3) can apply downhill build / uphill bleed.

Slope tiles are explicitly skipped in the square-tile X-pass and Y-pass so the
`stepTolerance` wall guard is never triggered by a slope's bounding box.

**Edge cases to handle and verify:** slope↔flat seam (surface height must be
continuous at the join), slope↔wall inside corner, top-of-slope meeting a flat
platform, running off the bottom of a slope into a pit, and both travel
directions (the auto-runner is bidirectional).

### A3. Overspeed momentum — `js/player.js`

Today `vx` is capped at `runSpeed` (400) and `momentum` clamps to 1.

- **Downhill** (grounded on a slope, `sign(vx) === -slopeDir`): add a tuned
  `slopeAccel` to `|vx|`, allowing it to exceed `runSpeed` up to `overspeedCap`
  (720 = 1.8×).
- **Uphill** (`sign(vx) === slopeDir`): subtract `slopeUphillDrag` from `|vx|`.
- **Flat / cruise:** when `|vx| > runSpeed`, decay back toward `runSpeed` at
  `overspeedDecay`. Overspeed is **perishable** — it must be cashed into a jump
  soon after the bomb.

**Compatibility:** the existing `momentum` getter stays **clamped 0..1** so the
speedometer, the 0.5 spin-out attack threshold, and every current consumer behave
exactly as today. A **new, separate** reading feeds only the jump:

```
get overspeed():     // 0 at/below cruise, grows above it
  return Math.max(0, (Math.abs(this.vx) - runSpeed) / runSpeed)
```

Treadmills already cap `|vx|` at `treadmillCap` (200); overspeed simply cannot
exist on a treadmill, which is correct. No treadmill change needed.

### A4. Speed-scaled jump — `js/player.js` `_doGroundJump()`

```
overspeedFrac = clamp((|vx| - runSpeed) / (overspeedCap - runSpeed), 0, 1)
vy = jumpForce - jumpSpeedBonus * overspeedFrac
   = -480           when overspeedFrac == 0  (identical to today)
   ≈ -860           when overspeedFrac == 1  (~3× height, since height ∝ vy²)
```

Baseline `-480` is untouched, so Levels 1–2 and all normal jumps feel identical;
the giant jump only exists once overspeed is earned, which only slopes provide.
A charged launch adds feedback: larger squash, a carnival spray, camera shake,
and a "charged" tell on the speedometer (a gold zone past full). Horizontal
velocity is left as-is — the banked overspeed carries the horizontal distance
naturally.

### A5. The Big Drop — level geometry (`js/level.js`)

A vertical level whose beats teach the loop in order:

1. **Flat intro** — roll out, get up to cruise.
2. **Gentle downhill** — first taste of bombing; overspeed builds.
3. **Speed-jump gap** — a gap only clearable if you arrive with overspeed.
4. **Uphill** — bleeds your speed (the consequence side of the coupling).
5. **Wall-jump column shaft** — reuses the v0.3.0 wall toolkit to climb.
6. **Final bomb → up-ramp lip → launch into the tent** (see A6).

Built temporarily as `maps[3]` (Level 4) during Phase A.

### A6. Cinematic tent finale (`js/level.js` render + `js/game.js` win flow)

- A **procedural striped circus tent** is drawn on the canvas at the level end
  (no image asset — same procedural approach as the marquee front door; complies
  with the CC0/no-paid-assets rule).
- The **goal hitbox sits at the tent mouth**. The intended approach is the
  speed-jump arc off the final lip.
- On entering the mouth, a **short win flourish** plays: tent curtain flaps,
  confetti burst, Poko is "swallowed" (fades / shrinks into the mouth), then the
  normal level-complete state fires.
- The win sequence is a brief timed state; it must not soft-lock if the player
  reaches the goal by an unexpected path (falling in, low-speed entry) — entering
  the mouth at all triggers the win.

### A7. Tokens & theme (`js/tokens.js`, `js/level.js`)

- New colors routed through `Tokens.*`: slope fill/edge, the "charged-gold"
  overspeed accent, and any tent colors not already covered.
- The Big Drop gets its own theme: a **"Midnight Big Top"** night palette
  (deep blues + gold) echoing the marquee front door, registered in
  `Level.themes`.

### A8. New tuning knobs (constants atop `js/player.js`)

| Knob | Start value | Meaning |
|------|-------------|---------|
| `overspeedCap` | 720 | max `|vx|` reachable on a downhill (1.8× runSpeed) |
| `slopeAccel` | ~800 | px/s² added to speed while bombing downhill |
| `slopeUphillDrag` | ~600 | px/s² bled while climbing a slope |
| `overspeedDecay` | ~500 | px/s² decay back to runSpeed on flat ground |
| `jumpSpeedBonus` | ~380 | extra upward px/s at full overspeed |

All are feel-first starting points, dialed in during verification.

---

## Phase B — Merged Level 2 (Stage + Workshop)

- **Theme:** The Stage (harlequin / purple) — keeps Level 2's identity.
- **Construction:** **curated best-of**, ~100–120 tiles wide. Pull the strongest
  runs from both originals (The Stage's early pits + treadmill + ferry gap; The
  Workshop's tight pits + double treadmill + ferries), stitch and re-pace them
  into one level — not a literal concatenation.
- **New content:** weave in **column / vertical wall-jump climb shafts** (the
  v0.3.0 shaft pattern from Level 1, e.g. two close walls with a gap), so the
  level exercises wall-jumps as well as the horizontal auto-run.
- Entities (patrols, one-ways, ferries) carried over and re-placed to match the
  new geometry.

---

## Phase C — Renumber + cleanup

- Reorder `Level.maps` to the final `[Big Top, merged Stage+Workshop, Big Drop]`.
- **Verify `game.js`** does not hardcode a level count of 3: level-select listing,
  level-complete → next-level advance, and the win/end-of-game state must all be
  driven by `Level.maps.length`. Fix any hardcoded assumptions surfaced.
- Update `CLAUDE.md`: slope legend (`/`, `\`), the new tuning knobs, the level
  list, and the out-of-scope section.

---

## Verification strategy (no test framework — house style)

1. **Headless sim** — step `Engine.systems[*].update(Engine.fixedDt)` and assert
   on `Player` state:
   - overspeed **builds** while grounded on a downhill slope,
   - overspeed **decays** back to `runSpeed` on flat ground,
   - jump `vy` **scales** with overspeed (≈ −480 at rest, ≈ −860 at cap),
   - the slope pass keeps the player **grounded** while riding up and down,
   - a speed-jump can punch up **through** a slope lip (no false snap-down).
2. **One-tile test slope first** — prove riding up/down and the seam transitions
   before building any Big Drop content.
3. **Live play** — the no-cache threaded server on **port 8081**; confirm new
   code actually loaded (check a new symbol) before judging feel.
4. **Pixel / console checks** as needed for the tent finale and slope rendering.

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Slope collision bugs (seams, inside corners, jumping up through) | Build + verify a 1-tile test slope before level content; explicit edge-case checklist (A2) |
| Disturbing the tuned flat-ground feel / `stepTolerance` guard | Slopes fully excluded from the square-tile passes; baseline jump `-480` untouched |
| Overspeed leaking into flat / treadmill feel | Perishable decay on flat; treadmill cap already prevents overspeed there; separate `overspeed` reading keeps `momentum` consumers unchanged |
| Bidirectional slopes | Test both travel directions in the headless sim |
| Renumber breaks level flow | Phase C drives everything off `Level.maps.length`; verify select + advance + end-of-game |
| Tent win sequence soft-lock | Entering the mouth at all triggers the win; timed state, no input dependency |

## Files touched

- `js/level.js` — slope parse (`/`, `\`), slope grid + `surfaceY`, slope render
  (triangles + edge highlight), Big Drop map, Midnight Big Top theme, tent
  set-piece render, merged Level 2, final reorder.
- `js/player.js` — slope collision pass, overspeed momentum + decay + new
  constants, `overspeed` getter, speed-scaled jump, launch FX.
- `js/game.js` — register/verify level count, tent win flourish state,
  speedometer "charged" tell.
- `js/tokens.js` — slope + charged-gold + any new tent colors.
- `CLAUDE.md` — legend, tuning knobs, level list, out-of-scope (Phase C).

## Out of scope / explicit follow-ups

- Gentle 2:1 (or steeper) slopes — only 45° in v1.
- Real sprite art (still a procedural unicycle).
- On-screen touch pause button (pre-existing follow-up).
- Slope-specific surface materials (icy/sticky slopes) — not in v1.
