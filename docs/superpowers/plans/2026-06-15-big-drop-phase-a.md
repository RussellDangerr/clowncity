# The Big Drop — Phase A Implementation Plan (slope engine + Level "The Big Drop")

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rideable 45° slopes whose downhill bombing banks "overspeed" that scales a much bigger jump, then build a new "The Big Drop" level (temporary slot 4) that ends with a cinematic launch into a procedural circus tent.

**Architecture:** Slopes are new tile chars (`/`, `\`) kept OUT of the existing square-tile collision grid and resolved by a dedicated foot-height-sampling pass in `player.js`, so the tuned flat-ground/wall logic is untouched. The same pass reports the grade, which drives an overspeed term on `vx` (above the normal `runSpeed` cap, perishable on flat). `_doGroundJump` scales launch height with that overspeed. The Big Drop is a new `Level.maps` entry with a "Midnight Big Top" theme; reaching its tent goal triggers a short finale state in `game.js`.

**Tech stack:** Vanilla JS singletons loaded by `<script>` tags (no build, no test runner). Verification is a headless physics harness (`verify/sim.js`) stepped via the preview MCP tools, plus live-play screenshots on the no-cache dev server (port 8081).

**Scope:** Phase A only. Phase B (merge Stage+Workshop into one Level 2) and Phase C (renumber to the final 3-level order + `CLAUDE.md`) are a separate follow-up plan, written after Phase A is verified and felt. During Phase A the Big Drop is appended as Level 4 and appears automatically (level count is `Level.maps.length`).

**Spec:** `docs/superpowers/specs/2026-06-15-big-drop-verticality-design.md`

---

## Conventions for every task

- **Dev server:** the no-cache threaded server on **port 8081** (`.claude/launch.json`). Start it with the preview tools (`preview_start`) if not already running. After any JS edit, reload and confirm the NEW code loaded (check a new symbol exists) before judging behavior — stale browser cache has bitten this project before.
- **Headless assertions:** load the harness once per page session, then call it:
  ```js
  // preview_eval (install once after a reload):
  fetch('/verify/sim.js').then(r => r.text()).then(eval).then(() => 'installed')
  // preview_eval (run a scenario, returns JSON):
  JSON.stringify(window.runSim({ /* opts */ }))
  ```
- **Commit** after each task with the message shown. Work on the `dev` branch.

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `verify/sim.js` | Headless physics harness (halts RAF, steps `Player.update`, returns a trace) | **Create** |
| `js/level.js` | Slope parse + `_slopeGrid` + `slopeSurfaceY`/`getSlopesNear`, slope render, Big Drop map, Midnight Big Top theme, tent render | Modify |
| `js/player.js` | Slope collision pass, overspeed constants + driver + `overspeed` getter, speed-scaled jump, launch FX | Modify |
| `js/game.js` | Tent finale state (goal hook + update/draw), speedometer "charged" tell | Modify |
| `js/tokens.js` | Slope + charged-gold + tent colors | Modify |

---

## Task 1: Headless physics harness

**Files:**
- Create: `verify/sim.js`

The harness halts the live RAF loop and steps `Player.update` deterministically, returning a state trace. It reads `Player.onSlope` / `Player.slopeDir` / `Player.overspeed`, which don't exist yet — they read as `false`/`0` until later tasks add them, which is exactly what makes the early assertions fail first.

- [ ] **Step 1: Create the harness**

```js
// verify/sim.js — headless physics harness for the Big Drop slope work.
//
// Usage (via the preview MCP tools, in the running game page):
//   1) install:  fetch('/verify/sim.js').then(r=>r.text()).then(eval)
//   2) run:      JSON.stringify(window.runSim({ rows: [...], ... }))
//
// It stops Engine's RAF loop and steps Player.update() by hand so results are
// independent of real time. A scratch map named '__sim__' is appended to
// Level.maps and reused across runs.
(function () {
  function fakeInput() {
    return {
      runDir: 0, _jumpFrame: -1, _frame: 0,
      jumpBuffered() { return this._frame === this._jumpFrame; },
      consumeJump() {}, swipeEdge() { return 0; },
      pressed() { return false; }, tapped() { return false; },
    };
  }

  window.runSim = function (opts) {
    opts = opts || {};
    Engine.running = false;                       // halt the live loop

    const map = {
      name: '__sim__',
      theme: opts.theme || 'circus',
      spawn: opts.spawn || [2, 0],
      entities: opts.entities || [],
      data: opts.rows,
    };
    let idx = Level.maps.findIndex(m => m.name === '__sim__');
    if (idx === -1) { Level.maps.push(map); idx = Level.maps.length - 1; }
    else { Level.maps[idx] = map; }
    Level.load(idx);

    const wasMuted = Audio.muted; Audio.muted = true;
    const realInput = window.Input;
    const fin = fakeInput(); window.Input = fin;
    fin.runDir = opts.runDir != null ? opts.runDir : 0;
    fin._jumpFrame = opts.jumpFrame != null ? opts.jumpFrame : -1;

    const s = Level.tileSize;
    const px = opts.x != null ? opts.x : map.spawn[0] * s;
    const py = opts.y != null ? opts.y : map.spawn[1] * s;
    Player.spawn(px, py);
    if (opts.skipRamp) { Player.runState = 'cruise'; Player.rampT = 1; }
    if (opts.vx != null) Player.vx = opts.vx;

    const frames = opts.frames || 240;
    const sample = opts.sample || 1;
    const trace = [];
    for (let f = 0; f < frames; f++) {
      fin._frame = f;
      if (opts.steer && opts.steer[f] != null) fin.runDir = opts.steer[f];
      Player.update(Engine.fixedDt);
      if (f % sample === 0) {
        trace.push({
          f,
          x: +Player.x.toFixed(2), y: +Player.y.toFixed(2),
          vx: +Player.vx.toFixed(2), vy: +Player.vy.toFixed(2),
          grounded: Player.grounded,
          onSlope: !!Player.onSlope,
          slopeDir: Player.slopeDir || 0,
          momentum: +Player.momentum.toFixed(3),
          overspeed: +((Player.overspeed || 0)).toFixed(3),
        });
      }
    }
    Audio.muted = wasMuted;
    window.Input = realInput;
    return { idx, frames, last: trace[trace.length - 1], trace };
  };
})();
```

- [ ] **Step 2: Verify the harness loads and runs against current (slope-free) physics**

Start the dev server (`preview_start`), navigate to the game, then:

```js
// preview_eval:
fetch('/verify/sim.js').then(r => r.text()).then(eval).then(() => 'installed')
```
Then drop the player onto a flat floor and confirm it lands:
```js
// preview_eval:
JSON.stringify(window.runSim({
  rows: ['0000000', '0000000', '0000000', '1111111'],
  spawn: [3, 0], frames: 120, sample: 30
}).last)
```
Expected: `grounded:true`, `onSlope:false`, `vy:0`, and `y` resting on the floor row (floor top = row 3 → y = 3*32 − 28 = 68). `overspeed:0`.

- [ ] **Step 3: Commit**

```bash
git add verify/sim.js
git commit -m "test: headless physics harness for slope/overspeed work"
```

---

## Task 2: Parse slope tiles (`/`, `\`) in level.js

**Files:**
- Modify: `js/level.js` — legend comment (10-13), `load()` parse loop (197-216), grid build (222-240), add helpers near `getTilesNear` (252-267)

Slopes go into `this.tiles` (so the draw loop + culling see them) and a new `_slopeGrid` (for the slope collision pass), but are kept OUT of `_tileGrid` (the square-collision grid) so the wall/floor passes never see them.

- [ ] **Step 1: Write the failing assertion**

After installing the harness (Step from Task 1), a single rise-right slope tile should yield a slope object with the right surface heights. Before the parse exists, `getSlopesNear` is undefined.

```js
// preview_eval (EXPECTED TO FAIL until implemented):
(function () {
  // floor of slopes: one '/' at col 2,row 2 (tile x=64,y=64,size=32)
  Level.maps.push({ name: '__probe__', theme: 'circus', spawn: [0,0], entities: [],
    data: ['00000', '00000', '00/00', '11111'] });
  Level.load(Level.maps.length - 1);
  const near = Level.getSlopesNear(64, 64, 16, 16);
  const t = near[0];
  return JSON.stringify({
    found: near.length,
    slopeDir: t && t.slopeDir,
    yAtLeft: t && Level.slopeSurfaceY(t, 64),    // localX 0  -> bottom (y+32) = 96
    yAtRight: t && Level.slopeSurfaceY(t, 96),   // localX 32 -> top    (y)    = 64
    inSquareGrid: !!Level._tileGrid['2,2'],      // must be false
  });
})()
```
Expected after implementation: `{found:1, slopeDir:1, yAtLeft:96, yAtRight:64, inSquareGrid:false}`. Before: throws (`getSlopesNear is not a function`).

- [ ] **Step 2: Update the legend comment** (`js/level.js` ~10-13)

```js
  // Tile legend:
  // 1 = solid, 0 = air, g = goal
  // c = checkpoint, o = collectible (gem)
  // T = treadmill (caps Poko's speed at 0.5 and bleeds momentum)
  // / = slope rising to the right, \ = slope rising to the left (45°)
  //     (authoring: a literal backslash must be written \\ inside the JS strings)
```

- [ ] **Step 3: Parse slopes in `load()`** — add to the per-char branch (after the `ch === '1'` / treadmill branches, before `ch === 'g'`, around line 205):

```js
        } else if (ch === '/' || ch === '\\') {
          const slopeDir = ch === '/' ? 1 : -1;
          this.tiles.push({ x: tx, y: ty, w: this.tileSize, h: this.tileSize, type: 'slope', slopeDir });
        }
```

- [ ] **Step 4: Build `_slopeGrid` and mark slope cells solid for rendering** — in `load()`, after the `_tileGrid` build (after line 228) add:

```js
    // Slopes live in their own grid — kept OUT of _tileGrid so the square-tile
    // X/Y passes never treat a slope's bounding box as a wall/floor.
    this._slopeGrid = {};
    for (const tile of this.tiles) {
      if (tile.type !== 'slope') continue;
      const key = Math.floor(tile.x / this.tileSize) + ',' + Math.floor(tile.y / this.tileSize);
      this._slopeGrid[key] = tile;
    }
```
And in the `solidGrid` build loop (line 238), count slopes as solid so neighbours edge-detect cleanly:
```js
        this.solidGrid[row][col] = (ch === '1' || !!materialMap[ch] || ch === '/' || ch === '\\');
```

- [ ] **Step 5: Add `slopeSurfaceY` and `getSlopesNear`** — after `getTilesNear` (after line 267):

```js
  // Surface (top) Y of a slope tile at a world X. Linear for 45°.
  //   '/' (slopeDir +1): low at the left edge, high at the right.
  //   '\' (slopeDir -1): high at the left edge, low at the right.
  slopeSurfaceY(tile, worldX) {
    const s = this.tileSize;
    const localX = Math.max(0, Math.min(s, worldX - tile.x));
    return tile.slopeDir > 0 ? tile.y + (s - localX) : tile.y + localX;
  },

  getSlopesNear(px, py, pw, ph) {
    if (!this._slopeGrid) return [];
    const s = this.tileSize;
    const x1 = Math.floor((px - s) / s), x2 = Math.floor((px + pw + s) / s);
    const y1 = Math.floor((py - s) / s), y2 = Math.floor((py + ph + s) / s);
    const result = [];
    for (let gy = y1; gy <= y2; gy++) {
      for (let gx = x1; gx <= x2; gx++) {
        const t = this._slopeGrid[gx + ',' + gy];
        if (t) result.push(t);
      }
    }
    return result;
  },
```

- [ ] **Step 6: Run the assertion from Step 1 — expect PASS**

Reload the page (to reload `level.js`), confirm new code loaded (`typeof Level.getSlopesNear === 'function'`), then re-run the Step 1 snippet. Expected: `{found:1, slopeDir:1, yAtLeft:96, yAtRight:64, inSquareGrid:false}`.

- [ ] **Step 7: Commit**

```bash
git add js/level.js
git commit -m "feat(level): parse / and \\ slope tiles into a separate slope grid"
```

---

## Task 3: Slope collision — ride up and down

**Files:**
- Modify: `js/player.js` — add state fields (near 91-115), add `slopeSnap` const (near 79-83), call a new `resolveSlopes()` at the end of `resolveCollisions()` (before line 744 close), implement `resolveSlopes()`.

- [ ] **Step 1: Write the failing assertions**

Drop the player above a rise-left `\` slope and let it ride down; it should become grounded and its feet should track the surface. (Install the harness first.)

```js
// preview_eval (EXPECTED TO FAIL until implemented):
JSON.stringify(window.runSim({
  // a downhill to the right: '\' tiles stepping down, then flat
  rows: [
    '000000000000',
    '000000000000',
    '00\\000000000',
    '000\\00000000',
    '0000\\0000000',
    '11111111111 1'.replace(' ',''),
  ],
  spawn: [2, 0], runDir: 1, skipRamp: true, vx: 300, frames: 120, sample: 20
}))
```
Expected after implementation: within the trace, once the player reaches the slope it shows `onSlope:true` and `grounded:true`, and `y + 28` (foot) equals `Level.slopeSurfaceY` at the foot x (no free-fall through the ramp). Before implementation: the player free-falls (`onSlope:false`, falls past the slope).

Second assertion — a jump must punch UP through a slope lip without being snapped back down:
```js
// preview_eval (EXPECTED TO FAIL until implemented):
JSON.stringify(window.runSim({
  rows: ['000000', '000000', '00/000', '00/000', '111111'],
  spawn: [2, 0], runDir: -1, skipRamp: true, vx: -300,
  jumpFrame: 40, frames: 120, sample: 10
}))
```
Expected after implementation: after `f=40` the trace shows `vy` going strongly negative and `y` decreasing (rising), i.e. NOT re-seated onto the slope. Before: no jump scaling yet but also the slope pass won't exist, so the run just shows fall-through.

- [ ] **Step 2: Add state fields and the snap constant**

In the "Collision" constants block (after `stepTolerance: 8,` at line 83):
```js
  slopeSnap: 8,           // px — stick distance to a slope surface (must exceed the
                          // max per-frame horizontal step: overspeedCap/120 = 6px)
```
In the "State" block (after `wallDir: 0,` line 94):
```js
  onSlope: false,         // grounded on a slope this frame (set in resolveSlopes)
  slopeDir: 0,            // sign of the slope under the feet (+1 rise-right)
```
And initialise them in `spawn()` (after `this.wallContactDir = 0;` line 193):
```js
    this.onSlope = false;
    this.slopeDir = 0;
```

- [ ] **Step 3: Call and implement `resolveSlopes()`**

At the very end of `resolveCollisions()`, just before its closing `}` (line 744), add:
```js
    // ── Slopes: seat the player on the diagonal surface (own pass) ──
    this.resolveSlopes();
```
Then add the method immediately after `resolveCollisions()` (after line 744):
```js
  // Seat the player on a slope surface. Runs AFTER the square-tile passes;
  // slope tiles are not in the square grid, so they never trigger wall logic.
  resolveSlopes() {
    const slopes = Level.getSlopesNear(this.x, this.y, this.w, this.h);
    if (!slopes.length) { this.onSlope = false; this.slopeDir = 0; return; }

    const footX = this.x + this.w / 2;
    let best = null, bestTop = Infinity;
    for (const sl of slopes) {
      if (footX < sl.x || footX > sl.x + sl.w) continue;   // foot column over it
      const top = Level.slopeSurfaceY(sl, footX);
      if (top < bestTop) { bestTop = top; best = sl; }      // highest surface wins
    }
    if (!best) { this.onSlope = false; this.slopeDir = 0; return; }

    const feetY = this.y + this.h;
    // Clearly rising up through the surface from below → let the jump punch out.
    if (this.vy < 0 && feetY < bestTop - 1) { this.onSlope = false; this.slopeDir = 0; return; }

    // Within stick range (a little above the surface, or penetrating) → seat.
    if (feetY >= bestTop - this.slopeSnap) {
      this.y = bestTop - this.h;
      if (this.vy > 0) this.vy = 0;
      this.grounded = true;
      this.groundMaterial = 'solid';
      this.onSlope = true;
      this.slopeDir = best.slopeDir;
    } else {
      this.onSlope = false;
      this.slopeDir = 0;
    }
  },
```

- [ ] **Step 4: Run the Step 1 assertions — expect PASS**

Reload, confirm `typeof Player.resolveSlopes === 'function'`, re-run both snippets. Confirm: ride-down run reaches `onSlope:true`/`grounded:true` with feet on the surface; jump run shows `vy<0` and rising `y` after the jump frame (no re-seat).

- [ ] **Step 5: Commit**

```bash
git add js/player.js
git commit -m "feat(player): slope collision pass — ride up/down, jump through lips"
```

---

## Task 4: Overspeed momentum (downhill builds, flat decays, uphill bleeds)

**Files:**
- Modify: `js/player.js` — add constants (after the jump-tuning block ~52-56), add the `overspeed` getter (after `momentum` getter, line 172), add the slope/overspeed driver in `update()` (after the runState block, after line 344).

- [ ] **Step 1: Write the failing assertions**

```js
// preview_eval (EXPECTED TO FAIL until implemented):
// Long rise-left ramp dropping to the right — bomb it and read peak |vx|.
JSON.stringify(window.runSim({
  rows: [
    '0000000000000000',
    '00\\0000000000000',
    '000\\000000000000',
    '0000\\00000000000',
    '00000\\0000000000',
    '000000\\000000000',
    '1111111111111111',
  ],
  spawn: [2, 0], runDir: 1, skipRamp: true, vx: 380, frames: 160, sample: 10
}).trace.map(s => ({ f: s.f, vx: s.vx, overspeed: s.overspeed, onSlope: s.onSlope })))
```
Expected after implementation: while `onSlope:true` and travelling downhill, `vx` climbs ABOVE 400 toward ~720 and `overspeed` rises above 0; once back on the flat floor, `vx` decays back toward 400 and `overspeed` returns to ~0.

- [ ] **Step 2: Add the overspeed constants** (after the jump-tuning block, after line 56)

```js
  // ── Slopes / overspeed (the downhill bomb that powers the big jump) ──
  overspeedCap: 720,        // px/s — max |vx| reachable on a downhill (1.8x runSpeed)
  slopeAccel: 800,          // px/s^2 — speed gained while bombing downhill
  slopeUphillDrag: 600,     // px/s^2 — speed bled while climbing a slope
  overspeedDecay: 500,      // px/s^2 — decay back to runSpeed on flat ground/air
```

- [ ] **Step 3: Add the `overspeed` getter** (right after the `momentum` getter's closing `}`, after line 172)

```js
  // Overspeed (0..1+): speed banked ABOVE the normal cap by bombing a downhill.
  // Separate from `momentum` (which stays clamped 0..1 for the HUD + attack
  // threshold) — only the speed-jump reads this.
  get overspeed() {
    return Math.max(0, (Math.abs(this.vx) - this.runSpeed) / this.runSpeed);
  },
```

- [ ] **Step 4: Add the slope/overspeed driver** — in `update()`, immediately AFTER the treadmill cap block (after line 344), BEFORE the gravity block:

```js
    // ── Slope speed-transfer + perishable overspeed ──
    // onSlope/slopeDir come from the previous frame's resolveSlopes (the same
    // one-frame-late model grounded/wallDir use). Downhill builds speed past the
    // cap; uphill bleeds; on flat/air any overspeed decays back to runSpeed.
    if (this.grounded && this.onSlope && this.slopeDir !== 0 && Math.abs(this.vx) > this.zeroEpsilon) {
      const sign = Math.sign(this.vx);
      const goingDownhill = sign === -this.slopeDir;
      if (goingDownhill) {
        this.vx += sign * this.slopeAccel * dt;
        if (Math.abs(this.vx) > this.overspeedCap) this.vx = sign * this.overspeedCap;
      } else {
        this.vx -= sign * this.slopeUphillDrag * dt;
      }
    } else if (Math.abs(this.vx) > this.runSpeed) {
      this.vx = approach(this.vx, Math.sign(this.vx) * this.runSpeed, this.overspeedDecay * dt);
    }
```

- [ ] **Step 5: Run the Step 1 assertion — expect PASS**

Reload, confirm `typeof Object.getOwnPropertyDescriptor(Player,'overspeed') !== 'undefined'` (or just read `Player.overspeed`), re-run. Confirm `vx` exceeds 400 on the downhill (toward ~720) and decays back on the flat.

- [ ] **Step 6: Commit**

```bash
git add js/player.js
git commit -m "feat(player): overspeed — downhill builds speed past the cap, flat decays it"
```

---

## Task 5: Speed-scaled jump

**Files:**
- Modify: `js/player.js` — `_doGroundJump()` (line 520-521).

- [ ] **Step 1: Write the failing assertions**

```js
// preview_eval (compare jump vy at cruise vs at overspeed):
// (a) flat-ground jump at cruise speed -> baseline ~ -480
const flat = window.runSim({
  rows: ['000000', '000000', '111111'], spawn: [3, 0], runDir: 1,
  skipRamp: true, vx: 400, jumpFrame: 30, frames: 60, sample: 1
});
// (b) jump the instant we hit the flat at the bottom of a steep bomb -> bigger
const bomb = window.runSim({
  rows: ['00000000', '0\\000000', '00\\00000', '000\\0000', '0000\\000', '11111111'],
  spawn: [1, 0], runDir: 1, skipRamp: true, vx: 380, jumpFrame: 55, frames: 90, sample: 1
});
// report the most-negative vy right after each jump frame
const minVy = t => Math.min(...t.trace.map(s => s.vy));
JSON.stringify({ flatJumpVy: minVy(flat), bombJumpVy: minVy(bomb) });
```
Expected after implementation: `flatJumpVy ≈ -480`; `bombJumpVy` is substantially more negative (toward −860 if the jump lands at full overspeed). Before: both are exactly −480 (no scaling).

- [ ] **Step 2: Add the `jumpSpeedBonus` constant** (in the jump-tuning block, after `jumpForce: -480,` line 53)

```js
  jumpSpeedBonus: 380,       // px/s extra upward launch at full overspeed (≈ -860 total)
```

- [ ] **Step 3: Scale the jump** — replace `_doGroundJump`'s first line (line 521 `this.vy = this.jumpForce;`) with:

```js
    const denom = (this.overspeedCap - this.runSpeed) || 1;
    const overFrac = Math.max(0, Math.min(1, (Math.abs(this.vx) - this.runSpeed) / denom));
    this.vy = this.jumpForce - this.jumpSpeedBonus * overFrac;
```

- [ ] **Step 4: Run the Step 1 assertion — expect PASS**

Reload, re-run. Confirm `flatJumpVy ≈ -480` and `bombJumpVy` clearly below that (e.g. < −600).

- [ ] **Step 5: Commit**

```bash
git add js/player.js
git commit -m "feat(player): jump height scales with banked overspeed"
```

---

## Task 6: Launch FX + speedometer "charged" tell

**Files:**
- Modify: `js/player.js` — `_doGroundJump()` (after the vy calc), `js/game.js` — `drawSpeedometer()` (548-569), `js/tokens.js` — add `charged` color.

- [ ] **Step 1: Add a charged-gold token** (`js/tokens.js`, in the Brand/accent group after `goldFlag` line 27)

```js
    charged:    [255, 240, 150], // overspeed "charged" tell (speedometer + launch spray)
```

- [ ] **Step 2: Add launch feedback** — in `_doGroundJump()`, after the `this.vy = ...` lines from Task 5, before `this.coyoteTimer = 0;` (line 522), add:

```js
    if (overFrac > 0.4) {
      this.squash = 1.5;
      Camera.shake(3 + overFrac * 4);
      this._carnivalSpray(this.travelDir);   // charged launch throws confetti
    }
```

- [ ] **Step 3: Add the charged zone to the speedometer** — in `drawSpeedometer()`, after the bar fill (`ctx.fillRect(x, y, w * m, h);` line 560), add:

```js
    // Overspeed "charged" overlay: a gold sliver past full while banking speed.
    const over = Math.max(0, Math.min(1, Player.overspeed));
    if (over > 0) {
      ctx.fillStyle = Tokens.rgba(Tokens.color.charged, 0.85);
      ctx.fillRect(x, y - 2, w, 2);                 // gold cap line = "charged!"
      ctx.fillRect(x + w, y - 1, 6 * over, h + 2);  // a nub past the end of the bar
    }
```

- [ ] **Step 4: Verify visually**

Reload. Use a live scenario (drive a downhill in the actual Big Drop once Task 8 exists, or temporarily test by setting `Player.vx = 700` on a paused playing state) and `preview_screenshot` the HUD; confirm the gold "charged" cap appears above the speed bar past full. (No headless assertion — this is purely visual.)

- [ ] **Step 5: Commit**

```bash
git add js/player.js js/game.js js/tokens.js
git commit -m "feat: charged launch FX + speedometer overspeed tell"
```

---

## Task 7: Render slope tiles

**Files:**
- Modify: `js/level.js` — tile draw loop (`draw()`, add a `type === 'slope'` branch after the `'goal'` branch, around line 460).

- [ ] **Step 1: Add the slope draw branch** — in `draw()`, after the `} else if (tile.type === 'goal') { ... }` block closes (line 460), add:

```js
      } else if (tile.type === 'slope') {
        const s = this.tileSize;
        // Solid region is BELOW the hypotenuse: lower-right triangle for '/',
        // lower-left for '\'.
        ctx.fillStyle = theme.tile[1];
        ctx.beginPath();
        if (tile.slopeDir > 0) {                 // '/'  low-left, high-right
          ctx.moveTo(tile.x, tile.y + s);
          ctx.lineTo(tile.x + s, tile.y);
          ctx.lineTo(tile.x + s, tile.y + s);
        } else {                                 // '\'  high-left, low-right
          ctx.moveTo(tile.x, tile.y);
          ctx.lineTo(tile.x, tile.y + s);
          ctx.lineTo(tile.x + s, tile.y + s);
        }
        ctx.closePath();
        ctx.fill();
        // Exposed-edge highlight along the hypotenuse (the ridable surface).
        ctx.strokeStyle = theme.tile[2];
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (tile.slopeDir > 0) { ctx.moveTo(tile.x, tile.y + s); ctx.lineTo(tile.x + s, tile.y); }
        else { ctx.moveTo(tile.x, tile.y); ctx.lineTo(tile.x + s, tile.y + s); }
        ctx.stroke();
        ctx.lineWidth = 1;
      }
```

- [ ] **Step 2: Verify visually**

Load a probe map with both slope directions in the live page (or wait for Task 8's level) and `preview_screenshot`. Confirm `/` draws a triangle rising to the right and `\` rising to the left, with a highlighted top edge, themed to the level.

```js
// preview_eval to stage a quick visual probe (then screenshot):
Level.maps.push({ name:'__probe2__', theme:'circus', spawn:[1,1], entities:[],
  data:['00000000','000/0000','0000\\000','11111111'] });
Game.loadLevel(Level.maps.length - 1); Game.state = 'playing'; 'staged'
```

- [ ] **Step 3: Commit**

```bash
git add js/level.js
git commit -m "feat(level): render slope tiles as themed triangles"
```

---

## Task 8: "The Big Drop" level + "Midnight Big Top" theme

**Files:**
- Modify: `js/level.js` — add a `themes.midnight` palette (after `puppet` theme, line 45), add a 4th `maps[]` entry (after the Workshop map, line 175).

This scaffold delivers the **core coupling** end to end: a start plateau → an 8-tile downhill `\` bomb (banks overspeed) → a 2-tile flat → a 2-tile `/` up-kicker → a chasm only the speed-jump clears → the tent ledge with the goal. It's deliberately minimal and verifiably coherent (every row is exactly 80 chars — generated, not hand-counted). The extra spec beats (a wall-jump column shaft, a second bomb, more gems) are layered in during the live build & tune (Task 11) once the loop feels right. Built as `maps[3]`; it appears as Level 4 automatically because the level count is `Level.maps.length`.

- [ ] **Step 1: Add the Midnight Big Top theme** (after the `puppet` theme block, line 45, before the closing `}` of `themes`)

```js
    midnight: {
      name: 'The Big Drop',
      bg: ['#0a0a1e', '#0e1230', '#1a1040'],
      tile: ['#1a2348', '#243056', '#36487e'],
      accent: 'rgba(255, 215, 120, 0.14)',
      goalColor: [255, 215, 120],
      dotColor: 'rgba(120, 150, 230, 0.06)',
    }
```

- [ ] **Step 2: Add the Big Drop map** (after the Workshop map object, before the closing `]` of `maps`, line 175 — add a leading comma)

```js
    ,{
      name: 'The Big Drop',
      theme: 'midnight',
      spawn: [3, 13],
      tent: true,                    // goal IS the tent mouth (render + finale derive from the goal tile)
      entities: [],
      // 80 wide x 25 tall — generated (every row exactly 80 chars). Plateau intro
      // (rows 14-24, cols 1-19) -> 8-tile downhill bomb '\' (20,14)->(27,21) ->
      // 2-tile flat -> 2-tile up-kicker '/' (30,21)/(31,20) -> chasm cols 32-49 ->
      // tent ledge (rows 14-24, cols 50-78) with goal at (56,13).
      data: [
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000o000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000g00000000000000000000001',
        '11111111111111111111\\00000000000000000000000000000111111111111111111111111111111',
        '111111111111111111110\\0000000000000000000000000000111111111111111111111111111111',
        '1111111111111111111100\\000000000000000000000000000111111111111111111111111111111',
        '11111111111111111111000\\00000000000000000000000000111111111111111111111111111111',
        '111111111111111111110000\\0000000000000000000000000111111111111111111111111111111',
        '1111111111111111111100000\\000000000000000000000000111111111111111111111111111111',
        '11111111111111111111000000\\0o00/000000000000000000111111111111111111111111111111',
        '111111111111111111110000000\\00/0000000000000000000111111111111111111111111111111',
        '11111111111111111111111111111111000000000000000000111111111111111111111111111111',
        '11111111111111111111111111111111000000000000000000111111111111111111111111111111',
        '11111111111111111111111111111111000000000000000000111111111111111111111111111111',
      ]
    }
```
*(This array was generated programmatically and checked: 25 rows, every row exactly 80 chars, 10 slope tiles. Each `\\` in source is one backslash char. Re-verify width in Step 3 after pasting.)*

- [ ] **Step 3: Verify the map is well-formed**

```js
// preview_eval after reload:
(function () {
  const m = Level.maps.find(x => x.name === 'The Big Drop');
  return JSON.stringify({
    rows: m.data.length,                                   // expect 25
    widths: Array.from(new Set(m.data.map(r => r.length))),// expect [80]
    slopes: m.data.join('').split('').filter(c => c === '/' || c === '\\').length,
  });
})()
```
Expected: `rows:25`, `widths:[80]`, `slopes` > 0. Fix any row whose width ≠ 80 before continuing.

- [ ] **Step 4: Play it headlessly + visually**

Headless sweep — auto-run right with `skipRamp` and confirm the bomb→kicker stretch builds overspeed (the trace should show `overspeed > 0` while descending, around the slope columns). The full launch over the chasm needs a jump pressed AT the kicker, so the headless sweep checks the build-up; the actual clear is judged in live play (Task 11).
```js
// preview_eval:
JSON.stringify(window.runSim({
  rows: Level.maps.find(x => x.name === 'The Big Drop').data,
  theme: 'midnight', spawn: [3, 13], runDir: 1, skipRamp: true, vx: 380,
  frames: 240, sample: 20
}).trace.map(s => ({ f: s.f, x: s.x, vx: s.vx, overspeed: s.overspeed, grounded: s.grounded, onSlope: s.onSlope })))
```
Expected: while on the `\` descent (player x roughly 640–880px), `overspeed` rises above 0 and `vx` climbs past 400. Then load it live (`Game.loadLevel(Level.maps.findIndex(m=>m.name==='The Big Drop')); Game.state='playing'`) and `preview_screenshot` to eyeball the slopes/flow. Note rough spots for Task 11 tuning.

- [ ] **Step 5: Commit**

```bash
git add js/level.js
git commit -m "feat(level): add The Big Drop (Level 4) + Midnight Big Top theme"
```

---

## Task 9: Procedural circus tent set-piece

**Files:**
- Modify: `js/level.js` — `draw()`, render the tent in WORLD space **before the tile loop** (right after the camera translate + viewport-cull vars, before `for (const tile of this.tiles)` at line 401) so it sits BEHIND the tiles and the pulsing goal marker. Add tent colors to `js/tokens.js`.

- [ ] **Step 1: Add tent colors** (`js/tokens.js`, World/materials group after `treadmill` line 57)

```js
    tentRed:   '#b5202a',  // circus tent stripe (red)
    tentCream: '#f3e2b8',  // circus tent stripe (cream)
    tentMouth: '#140a16',  // dark tent entrance
```

- [ ] **Step 2: Draw the tent** — in `draw()`, right after the viewport-cull variables (`viewL`/`viewR`/`viewT`/`viewB`, ~line 399) and BEFORE the `for (const tile of this.tiles)` loop (line 401), add:

```js
    // ── Circus tent set-piece (Big Drop finale) ──
    // Single source of truth: the tent is drawn around the GOAL tile, so the
    // mouth and the win hitbox can never drift apart.
    const goal0 = this.maps[this.currentMap].tent && this._cachedGoals && this._cachedGoals[0];
    if (goal0) {
      const s = this.tileSize;
      const mouthX = goal0.x + goal0.w / 2;        // centre on the goal column
      const baseY = goal0.y + s;                   // tent sits on the goal row's floor
      const tw = s * 6, th = s * 5;                // tent footprint
      const left = mouthX - tw / 2, right = mouthX + tw / 2;
      const peakY = baseY - th;
      // Striped canopy (triangle fan from the peak)
      const stripes = 6;
      for (let i = 0; i < stripes; i++) {
        ctx.fillStyle = (i % 2 === 0) ? Tokens.color.tentRed : Tokens.color.tentCream;
        ctx.beginPath();
        ctx.moveTo(mouthX, peakY);
        ctx.lineTo(left + (tw * i) / stripes, baseY);
        ctx.lineTo(left + (tw * (i + 1)) / stripes, baseY);
        ctx.closePath();
        ctx.fill();
      }
      // Flag pole + pennant at the peak
      ctx.strokeStyle = Tokens.color.frame; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mouthX, peakY); ctx.lineTo(mouthX, peakY - 18); ctx.stroke();
      ctx.fillStyle = Tokens.color.tentRed;
      ctx.beginPath(); ctx.moveTo(mouthX, peakY - 18); ctx.lineTo(mouthX + 14, peakY - 13); ctx.lineTo(mouthX, peakY - 8); ctx.closePath(); ctx.fill();
      // Dark mouth (the goal sits here)
      const mw = s * 1.4, mh = s * 1.8;
      ctx.fillStyle = Tokens.color.tentMouth;
      ctx.beginPath();
      ctx.moveTo(mouthX - mw / 2, baseY);
      ctx.lineTo(mouthX - mw / 2, baseY - mh * 0.6);
      ctx.quadraticCurveTo(mouthX, baseY - mh, mouthX + mw / 2, baseY - mh * 0.6);
      ctx.lineTo(mouthX + mw / 2, baseY);
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = 1;
    }
```

- [ ] **Step 3: Verify visually**

Reload, load the Big Drop live, `preview_screenshot`. Confirm a striped tent with a dark mouth sits around the goal at col 56 / row 13 (on the tent ledge), behind the pulsing goal marker.

- [ ] **Step 4: Commit**

```bash
git add js/level.js js/tokens.js
git commit -m "feat(level): procedural circus tent set-piece at the Big Drop goal"
```

---

## Task 10: Cinematic tent finale

**Files:**
- Modify: `js/game.js` — branch the goal hook (228-256) to a `tentFinale` state when the map has a `tent`; add `updateTentFinale` + `drawTentFinale`; register the state in `update()` dispatch (128-135) and `drawOverlay()` (325-332). (The player update/draw gates need no change — they already exclude `tentFinale`, so Poko freezes + hides automatically.)

- [ ] **Step 1: Branch the goal hook** — inside the goal loop in `updatePlaying`, replace the block that runs after `Audio.levelComplete();` through `return;` (lines 236-255) with a version that diverts to the finale when there's a tent. Keep all the save logic; only the tail changes:

```js
        Audio.levelComplete();

        // Save progress (unchanged)
        this.totalDeaths += Player.deathCount;
        this.totalGems += Level.collectedCount;
        this.save.levelsComplete[this.currentLevel] = true;
        const bd = this.save.bestDeaths[this.currentLevel];
        if (bd === -1 || Player.deathCount < bd) this.save.bestDeaths[this.currentLevel] = Player.deathCount;
        const prevGems = this.save.gemsCollected[this.currentLevel];
        if (Level.collectedCount > prevGems) this.save.gemsCollected[this.currentLevel] = Level.collectedCount;
        this.writeSave();

        if (Level.maps[this.currentLevel].tent) {
          // Cinematic finale: confetti swallow, then level complete.
          this.tentTimer = 0;
          this._tentMouth = { x: g.x + g.w / 2, y: g.y + g.h / 2 };
          Engine.hitstop(0.08);
          Camera.shake(6);
          for (let i = 0; i < 40; i++) {
            const a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 180;
            Particles.emit(this._tentMouth.x, this._tentMouth.y, Math.cos(a) * sp, Math.sin(a) * sp,
              Tokens.color.carnival[i % Tokens.color.carnival.length], 0.6 + Math.random() * 0.4, 4.5);
          }
          this.state = 'tentFinale';
          this.timer = 0;
          return;
        }

        this.state = 'levelComplete';
        this.timer = 0;
        return;
```

- [ ] **Step 2: Add finale state fields** (near the top of `Game`, after `levelTimer: 0,` line 7)

```js
  tentTimer: 0,
  _tentMouth: null,
```

- [ ] **Step 3: Register the state in the dispatch** — in `update()` (after the `levelComplete` line 132) add:

```js
    else if (this.state === 'tentFinale') this.updateTentFinale(dt);
```
In `drawOverlay()` (after the `levelComplete` line 329) add:
```js
    else if (this.state === 'tentFinale') this.drawTentFinale(ctx);
```
**No change to the registered player system is needed.** Its update gate (lines 38-43) only runs `Player.update` in `playing`/`levelComplete`, and its draw gate (lines 44-51) only draws the player in `playing`/`levelComplete`/`paused`. Neither lists `tentFinale`, so during the finale Poko is automatically **frozen and hidden** ("swallowed") with zero edits — while `Particles` and `Camera` (registered separately and unconditionally) keep animating the confetti.

- [ ] **Step 4: Add `updateTentFinale` + `drawTentFinale`** (after `updateLevelComplete`, line 290)

```js
  updateTentFinale(dt) {
    this.tentTimer += dt;
    // Keep raining confetti from the mouth for the first beat.
    if (this._tentMouth && this.tentTimer < 0.6 && Math.random() < 0.6) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6, sp = 60 + Math.random() * 160;
      Particles.emit(this._tentMouth.x, this._tentMouth.y, Math.cos(a) * sp, Math.sin(a) * sp,
        Tokens.color.carnival[(Math.random() * 5) | 0], 0.5 + Math.random() * 0.4, 4.5);
    }
    // After the flourish, hand off to the normal complete screen.
    if (this.tentTimer >= 1.3) {
      this.state = 'levelComplete';
      this.timer = 0;
    }
  },

  drawTentFinale(ctx) {
    this.drawHUD(ctx);
    const a = Math.min(1, this.tentTimer * 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = Tokens.rgba(Tokens.color.charged, a * 0.9);
    ctx.font = Tokens.font.heading;
    ctx.fillText('INTO THE BIG TOP!', Engine.width / 2, Engine.height / 2 - 10);
    ctx.textAlign = 'left';
  },
```

- [ ] **Step 5: Verify the finale + no soft-lock**

Reload, play the Big Drop to the tent (or, to reach it fast, `preview_eval`: position the player at the goal — `Player.x = 70*32; Player.y = 6*32;` while `Game.state='playing'`). Confirm: confetti bursts, Poko vanishes, "INTO THE BIG TOP!" shows, and after ~1.3s the normal LEVEL COMPLETE screen appears and `TAP/SPACE` advances. Re-check that entering the mouth at LOW speed or by falling also triggers it (no speed/input dependency).

- [ ] **Step 6: Commit**

```bash
git add js/game.js
git commit -m "feat(game): cinematic tent finale for the Big Drop"
```

---

## Task 11: Integration playtest, tuning pass, knobs note

**Files:**
- Modify: `js/player.js` (tuning constants only, if needed), `js/level.js` (Big Drop geometry tweaks, if needed), `CLAUDE.md` (Phase A knobs/legend note).

- [ ] **Step 1: Full live playthrough**

On port 8081, play The Big Drop end to end with real input. Verify the intended loop: the downhill banks overspeed (gold "charged" tell appears), the speed-jump clears the gap that a flat jump can't, the uphill visibly bleeds speed, the wall-jump shaft works (existing mechanic), and the final bomb → lip → launch reaches the tent. Confirm Levels 1–3 still feel identical (spot-check a normal jump height).

- [ ] **Step 2: Tune**

Adjust only as needed, smallest change first: `slopeAccel` / `overspeedCap` (how fast/high the bomb builds), `jumpSpeedBonus` (launch height), `overspeedDecay` (how perishable), and the Big Drop slope lengths / gap widths. Re-verify with the harness sweeps from Tasks 4/5/8 after any constant change.

- [ ] **Step 3: Regression check — existing levels untouched**

```js
// preview_eval: a flat-ground jump must still be exactly the baseline.
JSON.stringify({ vy: Math.min(...window.runSim({
  rows: ['000000','000000','111111'], spawn:[3,0], runDir:1, skipRamp:true,
  vx:400, jumpFrame:30, frames:60, sample:1
}).trace.map(s => s.vy)) })
```
Expected: `vy: -480` (no overspeed on flat → identical to pre-change behavior).

- [ ] **Step 4: Note the new knobs + legend in CLAUDE.md**

Add to the "Tuning knobs" section: `overspeedCap (720)`, `slopeAccel (800)`, `slopeUphillDrag (600)`, `overspeedDecay (500)`, `jumpSpeedBonus (380)`, `slopeSnap (8)`. Add to the `level.js` legend line: `/` `\` slopes. (Leave the level-list / out-of-scope edits for the Phase B/C plan.)

- [ ] **Step 5: Commit**

```bash
git add js/player.js js/level.js CLAUDE.md
git commit -m "polish: Big Drop tuning pass + document slope knobs/legend"
```

---

## Done-when (Phase A acceptance)

- Slopes ride up and down; a speed-jump punches through a slope lip (harness Tasks 3–5 pass).
- Downhill bombing banks overspeed that decays on flat; jump height scales from −480 (cruise) to ≈−860 (full overspeed); flat-ground jumps are unchanged (Task 11 Step 3).
- The Big Drop is playable as Level 4 and ends with the cinematic launch into the tent; no soft-lock.
- Levels 1–3 feel identical.

## Deferred to the Phase B/C plan (do NOT do here)

- Merge Stage + Workshop into one harlequin Level 2 with column / wall-jump climb shafts.
- Renumber `Level.maps` to `[Big Top, merged, Big Drop]`.
- `CLAUDE.md` level-list + out-of-scope updates.
