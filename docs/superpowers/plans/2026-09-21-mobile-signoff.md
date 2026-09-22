# Mobile Sign-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Clown City sign-off ready on phones and desktop. Phones held upright get a
"deck" layout (zoomed game on top, on-screen buttons below), every touch player gets a
pause menu, and the audit's polish bugs get fixed.

**Architecture:** A new `Layout` singleton picks the screen mode and input scheme and sizes
the canvas; `Engine` gains a switchable internal resolution. A new `Controls` singleton
wires DOM UI (deck, pause button, pause menu) into `Input` as *virtual keys*, so game
logic never knows which device pressed what. Verification is a new in-page check runner
(`verify/checks.js`) that steps the engine by hand, plus the existing bot
(`verify/play.js`).

**Tech Stack:** Vanilla JS singletons loaded by `<script>` tags (no modules, no build),
HTML/CSS in `index.html`, Canvas 2D. Checks run in the browser through the preview tools.

**Spec:** `docs/superpowers/specs/2026-09-21-mobile-signoff-design.md`

---

## How to run checks (read first)

There is no test framework. Checks run *in the game page* via the Claude Browser preview:

1. Start or reuse the preview: `preview_start` with `{ "name": "clowncity" }` (port 8081).
2. **Reload after every code change** so the page runs the new files: `navigate` to
   `http://localhost:8081`.
3. Run with `javascript_tool`:

```js
await fetch('/verify/checks.js').then(r => r.text()).then(eval);
JSON.stringify(await runChecks(['smoke']))
```

`runChecks()` with no argument runs everything. The result is
`{ pass, results: [{ name, ok, detail }] }`. `ok: null` means skipped (see `splashHandoff`).

Gotchas (these cost time before):
- A **hidden** browser pane never fires `requestAnimationFrame`, so the live loop freezes.
  Checks don't depend on it: they set `Engine.halted` and step systems by hand.
- A hidden pane reports `innerWidth === 0`; `Layout` skips CSS sizing then. Visual
  checks (Task 12) need the pane visible.
- `Input` is a top-level `const`, not a window property. Mutate it directly.
- The dev server sends `no-store`. If a reload seems to ignore an edit, confirm the new
  symbol exists in the page before concluding a fix failed.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `js/engine.js` | modify | fixed-step loop; `setView(w,h)` internal resolution; `halted` flag for harnesses |
| `js/layout.js` | **create** | detect mode (`deck`/`normal`) + scheme (`deck`/`touch`/`keys`), size the canvas, camera lead, hint copy |
| `js/controls.js` | **create** | wire deck buttons, floating pause button, pause menu to `Input` virtual keys; sync DOM to `Game.state` |
| `js/input.js` | modify | `_down/_up/tapKey` virtual keys; ignore touches on `[data-ui]`; stationary touch of any length = jump |
| `js/player.js` | modify | `finish()` / `finished` / `hidden`; coast to a stop after the goal |
| `js/game.js` | modify | init wiring, hints on canvas, no Esc→title, win→level select, win fonts, LOCKED token, drop canvas pause |
| `js/tokens.js` | modify | `font.lock`, `font.display`, `font.serif`, `color.goldShade`, `color.goldDeep` |
| `js/level.js` | modify | Big Drop map comment only |
| `index.html` | modify | dvh, deck/pause/menu markup + CSS, `#hint` id, splash keyup, meta/OG/favicon, script tags |
| `verify/checks.js` | **create** | check runner + helpers + one check per behaviour |
| `verify/play.js` | modify | log `dir` in decisions, `onFrame` hook, richer `afterGoal` |
| `verify/og.js` | **create** | render the 1200×630 `og.png` from the game's own drawing |
| `og.png` | **create** | link-preview image |
| `CLAUDE.md` | modify | refresh stale facts |

Script load order after this work: `tokens, engine, input, player, level, camera, entities,
particles, audio, layout, controls, game`.

---

### Task 0: Check harness (`Engine.halted`, `verify/checks.js`, `play.js` hooks)

**Files:**
- Modify: `js/engine.js` (`loop()`)
- Create: `verify/checks.js`
- Modify: `verify/play.js`

- [ ] **Step 1: Add `Engine.halted`**

In `js/engine.js`, add the field after `running: false,`:

```js
  halted: false,           // a harness is stepping systems by hand: keep RAF alive, skip work
```

and at the top of `loop(timestamp)`, right after `if (!this.running) return;`:

```js
    if (this.halted) {
      this.lastTime = timestamp / 1000;
      requestAnimationFrame(t => this.loop(t));
      return;
    }
```

- [ ] **Step 2: Create `verify/checks.js`**

```js
// verify/checks.js — regression checks for the mobile sign-off work.
//
// Usage (in the running game page via the preview tools; RELOAD the page first
// so it runs the current code):
//   await fetch('/verify/checks.js').then(r => r.text()).then(eval);
//   JSON.stringify(await runChecks())                  // everything
//   JSON.stringify(await runChecks(['deckButtons']))   // one check
//
// Checks halt the live loop (Engine.halted) and step Engine systems by hand, so
// they are deterministic and work even in a hidden pane (no RAF there). Each
// check restores the save, audio, layout override and input state afterwards.
// A check returns a detail string (pass), throws (fail), or returns null (skipped).
(function () {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  function step(sec) {
    const n = Math.max(1, Math.round(sec / Engine.fixedDt));
    for (let i = 0; i < n; i++) for (const s of Engine.systems) if (s.update) s.update(Engine.fixedDt);
  }

  // Run one draw pass and report every fillText as { text, font }.
  function drawTexts() {
    const ctx = Engine.ctx, orig = ctx.fillText, seen = [];
    ctx.fillText = function (t, ...a) { seen.push({ text: String(t), font: ctx.font }); return orig.call(this, t, ...a); };
    try {
      ctx.clearRect(0, 0, Engine.width, Engine.height);
      for (const s of Engine.systems) if (s.draw) s.draw(ctx);
    } finally { ctx.fillText = orig; }
    return seen;
  }

  function play(i) {
    Game.transitionDir = 0; Game.transitionAlpha = 0;
    Game.state = 'playing';
    Game.loadLevel(i);
  }

  // A long flat scratch level: safe ground for input checks.
  function flat() {
    const W = 200, rows = [];
    for (let r = 0; r < 25; r++) rows.push(r >= 22 ? '1'.repeat(W) : '1' + '0'.repeat(W - 2) + '1');
    let i = Level.maps.findIndex(m => m.name === '__flat__');
    if (i < 0) { Level.maps.push({ name: '__flat__', theme: 'circus', spawn: [3, 21], entities: [], data: rows }); i = Level.maps.length - 1; }
    play(i);
    return i;
  }

  // ── Synthetic input that goes through the real listeners ──
  let nextId = 100;
  function touchEv(type, el, id, x, y) {
    const t = new Touch({ identifier: id, target: el, clientX: x, clientY: y });
    const ev = new TouchEvent(type, {
      touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true,
    });
    el.dispatchEvent(ev);
    return ev;
  }
  async function tap(el = document.body, holdMs = 60) {
    const id = nextId++;
    touchEv('touchstart', el, id, 180, 300);
    await wait(holdMs);
    return touchEv('touchend', el, id, 180, 300);
  }
  async function swipe(el = document.body, dx = 80) {
    const id = nextId++;
    touchEv('touchstart', el, id, 180, 300);
    for (let i = 1; i <= 5; i++) { await wait(16); touchEv('touchmove', el, id, 180 + dx * i / 5, 300); }
    return touchEv('touchend', el, id, 180 + dx, 300);
  }
  function pointer(el, type) {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true }));
  }
  function press(el) { pointer(el, 'pointerdown'); step(1 / 120); pointer(el, 'pointerup'); }

  function snapshot() {
    let raw = null;
    try { raw = localStorage.getItem('clowncity_save'); } catch (e) {}
    return {
      raw, save: JSON.parse(JSON.stringify(Game.save)), muted: Audio.muted,
      force: typeof Layout !== 'undefined' ? Layout.force : undefined,
    };
  }
  function restore(s) {
    Game.save = s.save;
    try { if (s.raw == null) localStorage.removeItem('clowncity_save'); else localStorage.setItem('clowncity_save', s.raw); } catch (e) {}
    setTimeout(() => { Audio.muted = s.muted; }, 600);          // let queued SFX fire muted
    const fi = Level.maps.findIndex(m => m.name === '__flat__');
    if (fi >= 0) Level.maps.splice(fi, 1);
    if (typeof Layout !== 'undefined') { Layout.force = s.force; Layout.apply(); }
    Input.keys = {}; Input.justPressed = {}; Input.buffer = {}; Input._touches = {}; Input.runDir = 1;
    Game.transitionDir = 0; Game.transitionAlpha = 0;
    Game.loadLevel(0); Game.state = 'levelSelect'; Game.timer = 0;
  }

  const CHECKS = {
    async smoke() {
      assert(Engine.systems.length >= 8, `only ${Engine.systems.length} systems registered`);
      play(0); step(0.5);
      assert(Player.x > Level.spawnX, 'Poko should roll forward from spawn');
      return `${Engine.systems.length} systems, Poko rolled to x=${Math.round(Player.x)}`;
    },
    // ── checks added by later tasks go here, in task order ──
  };

  window.runChecks = async function (names) {
    if (!window.playLevel) await fetch('/verify/play.js').then(r => r.text()).then(eval);
    // splashHandoff needs the untouched splash, so it always runs first.
    const list = (names || Object.keys(CHECKS)).slice()
      .sort((a, b) => (b === 'splashHandoff') - (a === 'splashHandoff'));
    const splash = document.getElementById('splash');
    if (!splash.classList.contains('go') && !list.includes('splashHandoff')) {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    }
    const results = [];
    for (const name of list) {
      const fn = CHECKS[name];
      if (!fn) { results.push({ name, ok: false, detail: 'no such check' }); continue; }
      const snap = snapshot();
      Engine.halted = true;
      Audio.muted = true;
      try {
        const detail = await fn();
        results.push({ name, ok: detail === null ? null : true, detail: detail === null ? 'skipped: reload the page, then run it first' : detail });
      } catch (e) {
        results.push({ name, ok: false, detail: e.message });
      } finally {
        restore(snap);
        Engine.halted = false;
      }
    }
    return { pass: results.every(r => r.ok !== false), results };
  };
  Object.assign(window, { __checks: { step, drawTexts, play, flat, tap, swipe, pointer, press, wait, assert } });
})();
```

- [ ] **Step 3: Add the hooks `verify/play.js` needs**

In `verify/play.js`:

(a) In `schedule`, add the travel direction to each logged decision. Replace
`vx: Math.round(Player.vx), slope: Player.onSlope,` with:

```js
        vx: Math.round(Player.vx), slope: Player.onSlope, dir: Player.travelDir,
```

(b) Right after `for (const sys of Engine.systems) if (sys.update) sys.update(dt);` add:

```js
        if (opts.onFrame) opts.onFrame(frame);
```

(c) Replace the whole `afterGoal: goalFrame >= 0 ? { … } : null,` block with:

```js
        afterGoal: goalFrame >= 0 ? {
          state: Game.state, diedAfterGoal: deaths.length > deathsAtGoal,
          col: Math.floor(Player.x / S()), row: Math.floor(Player.y / S()),
          x: +Player.x.toFixed(2), y: +Player.y.toFixed(2), vx: +Player.vx.toFixed(2),
          grounded: Player.grounded, finished: !!Player.finished, hidden: !!Player.hidden,
          offscreenBelow: Player.y > Level.levelHeight,
        } : null,
```

(d) Document the hook in the header's knob list, after the `traceFrom/traceTo` line:

```js
//   onFrame    callback(frame) after each step (e.g. sample the camera)
```

- [ ] **Step 4: Run the smoke check**

Reload, then run `runChecks(['smoke'])`.
Expected: `{"pass":true,"results":[{"name":"smoke","ok":true,"detail":"10 systems, Poko rolled to x=…"}]}`

- [ ] **Step 5: Confirm the bot still passes**

```js
[0,1,2].map(i => playLevel(i, { lead: 24 }).result).join(',')
```
Expected: `"goal,goal,goal"`

- [ ] **Step 6: Commit**

```bash
cd /c/Code/clowncity && git add js/engine.js verify/checks.js verify/play.js && git commit -m "test(verify): in-page check runner + Engine.halted for hand-stepped harnesses"
```
(End every commit message in this plan with the `Co-Authored-By` trailer from the session's attribution reminder.)

---

### Task 1: Layout modes and canvas sizing

**Files:**
- Create: `js/layout.js`
- Modify: `js/engine.js` (`init`, replace `resize` with `setView`)
- Modify: `js/game.js` (`init`)
- Modify: `index.html` (CSS + script tag)
- Test: `verify/checks.js` (`layoutModes`)

- [ ] **Step 1: Write the failing check**

Add to `CHECKS` in `verify/checks.js`:

```js
    async layoutModes() {
      const root = document.documentElement;
      Layout.force = 'deck'; Layout.apply();
      assert(Engine.width === 640 && Engine.height === 480, `deck view is ${Engine.width}x${Engine.height}`);
      assert(Engine.canvas.width === 640 && Engine.canvas.height === 480, 'canvas bitmap not resized');
      assert(root.classList.contains('deck') && root.classList.contains('touch'), 'deck mode needs html.deck.touch');
      assert(Camera.lookaheadX === Layout.views.deck.lookahead, 'deck camera lead not applied');
      play(0); step(1);                                         // a frame in the deck view must not throw
      Layout.force = 'touch'; Layout.apply();
      assert(Engine.width === 960 && Engine.height === 540, `touch view is ${Engine.width}x${Engine.height}`);
      assert(!root.classList.contains('deck') && root.classList.contains('touch'), 'touch scheme classes');
      Layout.force = 'keys'; Layout.apply();
      assert(!root.classList.contains('touch'), 'keys scheme must drop html.touch');
      assert(Camera.lookaheadX === 60, 'normal camera lead should stay 60');
      step(1);
      return 'deck 640x480 + lead, touch/keys 960x540, classes ok';
    },
```

- [ ] **Step 2: Run it to see it fail**

Reload, run `runChecks(['layoutModes'])`. Expected: `ok:false`, detail `Layout is not defined`.

- [ ] **Step 3: Give `Engine` a switchable view**

In `js/engine.js`, replace `init()` and `resize()` with:

```js
  init() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.setView(this.width, this.height);   // Layout.init() then sizes it for the screen
  },

  // Internal resolution = the canvas bitmap (all drawing reads width/height).
  // CSS sizing and the choice of view live in Layout.
  setView(w, h) {
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
  },
```

- [ ] **Step 4: Create `js/layout.js`**

```js
// ─── Layout: screen mode, canvas sizing, camera lead ───
// Two modes:
//   'deck'   — a touch device held upright: the game renders a zoomed 640×480
//              view across the top and the on-screen deck (#deck) fills the rest.
//   'normal' — everything else (desktop in any window shape, phone sideways):
//              the classic 960×540 view, letterboxed to fit.
// The input scheme ('deck' | 'touch' | 'keys') decides the mode and, later, the
// hint copy. Re-evaluated on every resize (orientation changes fire one).
const Layout = {
  force: null,        // 'deck' | 'touch' | 'keys' — overrides detection (checks / debugging)
  scheme: 'keys',
  views: {
    normal: { w: 960, h: 540, lookahead: 60 },
    deck:   { w: 640, h: 480, lookahead: 220 },   // lead further so Poko sits left of centre
  },
  deckMinH: 200,      // px — the deck is never shorter than this

  get mode() { return this.scheme === 'deck' ? 'deck' : 'normal'; },

  init() {
    this.apply();
    window.addEventListener('resize', () => this.apply());
  },

  detect() {
    if (this.force) return this.force;
    if (!matchMedia('(pointer: coarse)').matches) return 'keys';
    return matchMedia('(orientation: portrait)').matches ? 'deck' : 'touch';
  },

  apply() {
    const prev = this.scheme;
    this.scheme = this.detect();
    const root = document.documentElement;
    root.classList.toggle('deck', this.scheme === 'deck');
    root.classList.toggle('touch', this.scheme !== 'keys');

    const v = this.views[this.mode];
    if (Engine.width !== v.w || Engine.height !== v.h) Engine.setView(v.w, v.h);
    Camera.lookaheadX = v.lookahead;

    // CSS size: fit the view. A hidden preview pane reports 0×0 — skip then.
    const vw = window.innerWidth, vh = window.innerHeight;
    if (vw && vh) {
      const availH = vh - (this.mode === 'deck' ? this.deckMinH : 0);
      const scale = Math.max(0.1, Math.min(vw / v.w, availH / v.h));
      Engine.canvas.style.width = (v.w * scale) + 'px';
      Engine.canvas.style.height = (v.h * scale) + 'px';
    }
    if (prev !== this.scheme && Level.collectibles) Camera.snapToPlayer();
  },
};
```

- [ ] **Step 5: Load it and initialise it**

In `index.html`, add `<script src="js/layout.js"></script>` right after
`<script src="js/audio.js"></script>`.

In `js/game.js` `init()`, change the first lines to:

```js
    Engine.init();
    Input.init();
    Audio.init();
    Layout.init();
```

- [ ] **Step 6: Deck-mode page CSS**

In `index.html`, in the `html, body { … }` rule, replace `height: 100vh;` with:

```css
      height: 100vh;
      height: 100dvh;   /* the VISIBLE height: excludes mobile browser toolbars */
```

Then add after the `canvas { … }` rule:

```css
    [hidden] { display: none !important; }

    /* ── Deck mode (touch, held upright): game across the top, deck below ── */
    html.deck body {
      flex-direction: column; justify-content: flex-start;
      padding-top: env(safe-area-inset-top);
    }
    html.deck canvas {
      border-radius: 0;
      box-shadow: 0 2px 0 var(--gold), 0 8px 0 var(--oxblood), 0 9px 0 rgba(232,198,106,0.35);
    }
```

- [ ] **Step 7: Run the check**

Reload, run `runChecks(['layoutModes','smoke'])`. Expected: both `ok:true`.

- [ ] **Step 8: Commit**

```bash
cd /c/Code/clowncity && git add js/layout.js js/engine.js js/game.js index.html verify/checks.js && git commit -m "feat(layout): deck mode renders a zoomed 640x480 view on upright touch screens"
```

---

### Task 2: Virtual keys and touch-gesture fixes in `Input`

**Files:**
- Modify: `js/input.js`
- Test: `verify/checks.js` (`virtualKeys`, `gestureIgnoresUI`, `longPressJumps`)

- [ ] **Step 1: Write the failing checks**

Add to `CHECKS`:

```js
    async virtualKeys() {
      flat(); step(0.5);
      Input._down('ArrowLeft');
      assert(Input.runDir === -1 && Input.pressed('ArrowLeft') && Input.held('ArrowLeft'), 'ArrowLeft down');
      Input._up('ArrowLeft');
      assert(!Input.held('ArrowLeft'), 'ArrowLeft up');
      Input._down('Space');
      assert(Input.jumpBuffered(), 'Space down should buffer a jump');
      Input.justPressed.Space = false;
      Input._down('Space');                              // repeat while held: no new edge
      assert(!Input.pressed('Space'), 'a held key must not re-trigger');
      Input._up('Space');
      Input.tapKey('KeyM');
      assert(Input.pressed('KeyM') && !Input.held('KeyM'), 'tapKey = press + release');
      return 'down/up/tapKey ok';
    },
    async gestureIgnoresUI() {
      const el = document.createElement('div');
      el.setAttribute('data-ui', '');
      document.body.appendChild(el);
      try {
        Input.buffer = {};
        const end = await tap(el);
        assert(!Input.buffer.Jump, 'a tap that starts on UI must not jump');
        assert(!end.defaultPrevented, 'UI touchend must not be preventDefault-ed (it would swallow the click)');
        await tap(document.body);
        assert(Input.buffer.Jump > 0, 'a tap on the game should still jump');
      } finally { el.remove(); }
      return 'UI touches ignored, game taps jump';
    },
    async longPressJumps() {
      Input.buffer = {};
      await tap(document.body, 400);
      assert(Input.buffer.Jump > 0, 'a 400ms stationary press should jump');
      Input.buffer = {};
      await swipe(document.body, -80);
      assert(!Input.buffer.Jump && Input.runDir === -1, 'a swipe steers and does not jump');
      return 'long press jumps, swipe steers';
    },
```

- [ ] **Step 2: Run them to see them fail**

Reload, run `runChecks(['virtualKeys','gestureIgnoresUI','longPressJumps'])`.
Expected: `virtualKeys` fails `Input._down is not a function`; `gestureIgnoresUI` fails
`a tap that starts on UI must not jump`; `longPressJumps` fails
`a 400ms stationary press should jump`.

- [ ] **Step 3: Implement virtual keys**

In `js/input.js`, replace the two keyboard listeners inside `init()` with:

```js
    window.addEventListener('keydown', e => {
      this._down(e.code);
      // Prevent scrolling
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', e => this._up(e.code));
```

and add these methods after `init()`:

```js
  // ── Virtual keys ── the keyboard, the on-screen deck and the pause menu all
  // press through here, so every input source behaves identically.
  _down(code) {
    if (!this.keys[code]) {
      this.justPressed[code] = true;
      this.buffer[code] = this.bufferTime;
    }
    this.keys[code] = true;
    // Unicycle steering
    if (code === 'ArrowLeft' || code === 'KeyA') this.runDir = -1;
    if (code === 'ArrowRight' || code === 'KeyD') this.runDir = 1;
  },

  _up(code) {
    this.keys[code] = false;
  },

  // One press-and-release (menu buttons). The press edge survives until the
  // next Input.update, so the game still sees it this frame.
  tapKey(code) {
    this._down(code);
    this._up(code);
  },

  // Touches that START on on-screen UI (deck, pause button, pause menu) belong
  // to that UI: no gesture, and no preventDefault (that would swallow its click).
  _isUI(t) {
    return !!(t.target && t.target.closest && t.target.closest('[data-ui]'));
  },
```

- [ ] **Step 4: Filter UI touches; accept long presses**

In `js/input.js`, replace the whole `initTouch()` method with:

```js
  initTouch() {
    const gameTouches = e => Array.from(e.changedTouches).filter(t => !this._isUI(t));

    window.addEventListener('touchstart', e => {
      const touches = gameTouches(e);
      if (!touches.length) return;
      e.preventDefault();
      for (const t of touches) {
        this._touches[t.identifier] = { x0: t.clientX, y0: t.clientY, swiped: false };
      }
    }, { passive: false });

    window.addEventListener('touchmove', e => {
      const touches = gameTouches(e);
      if (!touches.length) return;
      e.preventDefault();
      for (const t of touches) {
        const rec = this._touches[t.identifier];
        if (!rec) continue;
        const dx = t.clientX - rec.x0;
        if (Math.abs(dx) >= this.swipeThreshold) {
          const dir = dx > 0 ? 1 : -1;
          this.runDir = dir;
          this._swipeEdge = dir;
          rec.swiped = true;
          rec.x0 = t.clientX;  // re-arm so a back-and-forth within one touch re-steers
          rec.y0 = t.clientY;
        }
      }
    }, { passive: false });

    window.addEventListener('touchend', e => {
      const touches = gameTouches(e);
      if (!touches.length) return;
      e.preventDefault();
      for (const t of touches) {
        const rec = this._touches[t.identifier];
        if (!rec) continue;
        const dist = Math.hypot(t.clientX - rec.x0, t.clientY - rec.y0);
        // Any touch that didn't travel is a tap = jump (and a menu confirm),
        // however long it was held — a slow, deliberate press is still a jump.
        if (!rec.swiped && dist < this.tapMaxMove) {
          this.buffer['Jump'] = this.bufferTime;
          this._jumpDown = true;
          this._tapped = true;
        }
        delete this._touches[t.identifier];
      }
    }, { passive: false });

    window.addEventListener('touchcancel', e => {
      for (const t of e.changedTouches) delete this._touches[t.identifier];
    }, { passive: false });
  },
```

Also delete the now-unused `tapMaxTime: 0.25,` line from the gesture-tuning fields.

- [ ] **Step 5: Run the checks**

Reload, run `runChecks(['virtualKeys','gestureIgnoresUI','longPressJumps','smoke'])`.
Expected: all `ok:true`.

- [ ] **Step 6: Keyboard still drives the game**

```js
await fetch('/verify/checks.js').then(r => r.text()).then(eval);
const c = __checks; Engine.halted = true; c.flat(); c.step(1);
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' })); c.step(1/120);
const s = Player.runState; window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' }));
Engine.halted = false; s
```
Expected: `"brake"`.

- [ ] **Step 7: Commit**

```bash
cd /c/Code/clowncity && git add js/input.js verify/checks.js && git commit -m "feat(input): virtual keys; UI touches skip gestures; any stationary press jumps"
```

---

### Task 3: The deck (on-screen buttons)

**Files:**
- Create: `js/controls.js`
- Modify: `index.html` (markup, CSS, script tag)
- Modify: `js/game.js` (`init`)
- Test: `verify/checks.js` (`deckButtons`)

- [ ] **Step 1: Write the failing check**

Add to `CHECKS`:

```js
    async deckButtons() {
      Layout.force = 'deck'; Layout.apply();
      const deck = document.getElementById('deck');
      const L = document.getElementById('btn-left'), R = document.getElementById('btn-right'), J = document.getElementById('btn-jump');
      assert(deck && L && R && J, 'deck buttons missing');
      assert(getComputedStyle(deck).display !== 'none', 'deck should show in deck mode');
      flat(); step(2.5);                                  // cruising right on flat ground
      Input.buffer = {};
      pointer(J, 'pointerdown');
      assert(Input.jumpBuffered(), 'JUMP should buffer a jump the moment it is pressed');
      step(1 / 120);
      assert(Player.vy < 0, 'JUMP press should jump immediately');
      pointer(J, 'pointerup');
      assert(!Input.held('Space'), 'JUMP release');
      step(1.2);
      Input.buffer = {};
      await tap(J);                                       // the touch side of a JUMP press
      assert(!Input.buffer.Jump, 'a touch on JUMP must not ALSO count as a gesture tap');
      press(L);
      assert(Input.runDir === -1 && Player.runState === 'brake', '◀ should start a reversal');
      step(1.5);
      press(R);
      assert(Input.runDir === 1, '▶ should steer right');
      Layout.force = 'keys'; Layout.apply();
      assert(getComputedStyle(deck).display === 'none', 'deck must hide outside deck mode');
      return 'jump instant, no double-fire, turn both ways, hidden on desktop';
    },
```

- [ ] **Step 2: Run it to see it fail**

Reload, run `runChecks(['deckButtons'])`. Expected: `ok:false`, `deck buttons missing`.

- [ ] **Step 3: Deck markup**

In `index.html`, right after `<canvas id="game"></canvas>`:

```html
  <div id="deck" data-ui>
    <button class="deck-btn deck-pause" id="btn-pause" aria-label="Pause">&#10074;&#10074;</button>
    <div class="deck-row">
      <div class="deck-arrows">
        <button class="deck-btn" id="btn-left" aria-label="Turn left">&#9664;</button>
        <button class="deck-btn" id="btn-right" aria-label="Turn right">&#9654;</button>
      </div>
      <button class="deck-btn deck-jump" id="btn-jump" aria-label="Jump">JUMP</button>
    </div>
  </div>
```

- [ ] **Step 4: Deck CSS**

In `index.html`, after the `html.deck canvas { … }` rule:

```css
    #deck { display: none; }
    html.deck #deck {
      display: flex; flex-direction: column; flex: 1; align-self: stretch;
      position: relative; z-index: 1;
      padding: 12px 18px calc(18px + env(safe-area-inset-bottom));
      touch-action: none; -webkit-user-select: none; user-select: none;
      -webkit-touch-callout: none;
    }
    .deck-row { flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .deck-arrows { display: flex; gap: 14px; }
    .deck-btn {
      width: 76px; height: 76px; border-radius: 50%;
      font-family: 'Silkscreen', monospace; font-weight: 700; font-size: 26px;
      color: var(--gold-brt);
      background: radial-gradient(circle at 40% 35%, var(--velvet), var(--oxblood) 72%);
      border: 2px solid var(--gold);
      box-shadow: 0 0 0 5px var(--oxblood), 0 0 0 6px rgba(232,198,106,0.35), 0 10px 24px -8px #000;
      touch-action: none; -webkit-tap-highlight-color: transparent;
      -webkit-touch-callout: none; user-select: none; cursor: pointer;
      transition: transform .06s ease;
    }
    .deck-btn.down { transform: scale(0.92); background: var(--maroon); }
    .deck-jump { width: 112px; height: 112px; font-size: 18px; letter-spacing: 0.12em; }
    .deck-pause {
      align-self: flex-end; width: 64px; height: 64px; border-radius: 14px;
      font-size: 16px; background: rgba(28,8,11,0.85);
    }
```

- [ ] **Step 5: Create `js/controls.js`**

```js
// ─── Controls: on-screen deck, floating pause button, pause menu ───
// DOM UI for touch play. Every control is a virtual key through Input._down /
// _up / tapKey, so Game and Player never know whether a press came from the
// keyboard, the deck, or the pause menu.
const Controls = {
  init() {
    this._bindHold('btn-left', 'ArrowLeft');
    this._bindHold('btn-right', 'ArrowRight');
    this._bindHold('btn-jump', 'Space');
    this._bindHold('btn-pause', 'Escape');
  },

  // Held control: press on pointerdown (instant — no waiting for the lift),
  // release on pointerup / cancel / lost capture.
  _bindHold(id, code) {
    const el = document.getElementById(id);
    const up = () => {
      if (!el.classList.contains('down')) return;
      el.classList.remove('down');
      Input._up(code);
    };
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic or inactive pointer */ }
      if (el.classList.contains('down')) return;
      el.classList.add('down');
      Input._down(code);
    });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  },

  update() {},
};
```

- [ ] **Step 6: Load, initialise and register it**

`index.html`: add `<script src="js/controls.js"></script>` right after the `layout.js` tag.

`js/game.js` `init()`: add `Controls.init();` after `Layout.init();`, and register it
just before Input:

```js
    Engine.register({ draw(ctx) { Game.drawOverlay(ctx); } });
    Engine.register(Controls);   // syncs the DOM UI to Game.state (before Input, like every consumer)
    Engine.register(Input);
```

- [ ] **Step 7: Run the checks**

Reload, run `runChecks(['deckButtons','layoutModes','gestureIgnoresUI','smoke'])`.
Expected: all `ok:true`.

- [ ] **Step 8: Commit**

```bash
cd /c/Code/clowncity && git add js/controls.js index.html js/game.js verify/checks.js && git commit -m "feat(controls): on-screen deck (turn, jump, pause) for upright phones"
```

---

### Task 4: Pause menu (DOM) and the floating pause button

**Files:**
- Modify: `index.html` (markup + CSS)
- Modify: `js/controls.js`
- Modify: `js/game.js` (drop the canvas pause text)
- Test: `verify/checks.js` (`pauseMenu`)

- [ ] **Step 1: Write the failing check**

Add to `CHECKS`:

```js
    async pauseMenu() {
      const menu = document.getElementById('pause-menu');
      const pb = document.getElementById('pause-btn');
      const click = id => document.getElementById(id).click();
      assert(menu && pb, 'pause UI missing');
      flat(); step(1);
      Input.tapKey('Escape'); step(1 / 120);
      assert(Game.state === 'paused' && !menu.hidden, 'Esc should pause and show the menu');
      click('pm-resume'); step(1 / 120);
      assert(Game.state === 'playing' && menu.hidden, 'Resume');
      Layout.force = 'touch'; Layout.apply(); step(1 / 120);
      assert(!pb.hidden && getComputedStyle(pb).display !== 'none', 'floating pause button should show on touch while playing');
      pb.click(); step(1 / 120);
      assert(Game.state === 'paused', 'floating pause button');
      const x0 = Player.x;
      click('pm-restart'); step(1 / 120);
      assert(Game.state === 'playing' && Player.x < x0, 'Restart');
      Input.tapKey('Escape'); step(1 / 120);
      const m0 = Audio.muted;
      click('pm-sound'); step(1 / 120);
      assert(Audio.muted === !m0, 'Sound should toggle');
      assert(document.getElementById('pm-sound').textContent === `Sound: ${Audio.muted ? 'off' : 'on'}`, 'Sound label');
      click('pm-levels'); step(1);
      assert(Game.state === 'levelSelect', `Levels → ${Game.state}`);
      assert(menu.hidden && pb.hidden, 'pause UI hidden outside play');
      Layout.force = 'keys'; Layout.apply(); flat(); step(1 / 120);
      assert(getComputedStyle(pb).display === 'none', 'no floating pause button on desktop');
      Layout.force = 'deck'; Layout.apply(); flat(); step(0.5);
      press(document.getElementById('btn-pause'));
      assert(Game.state === 'paused', 'deck pause button');
      return 'Esc/button/deck pause; resume, restart, sound, levels';
    },
```

- [ ] **Step 2: Run it to see it fail**

Reload, run `runChecks(['pauseMenu'])`. Expected: `ok:false`, `pause UI missing`.

- [ ] **Step 3: Markup**

In `index.html`, right after the `#deck` div:

```html
  <button id="pause-btn" data-ui aria-label="Pause" hidden>&#10074;&#10074;</button>

  <div id="pause-menu" data-ui role="dialog" aria-label="Paused" hidden>
    <div class="pm-panel">
      <div class="pm-title">Paused</div>
      <button id="pm-resume">Resume</button>
      <button id="pm-restart">Restart level</button>
      <button id="pm-levels">Levels</button>
      <button id="pm-sound">Sound: on</button>
      <div class="pm-hint" id="pm-hint"></div>
    </div>
  </div>
```

- [ ] **Step 4: CSS**

In `index.html`, after the deck CSS:

```css
    /* ── Floating pause button (touch, sideways) ── */
    #pause-btn {
      display: none; position: fixed; z-index: 5;
      top: calc(8px + env(safe-area-inset-top)); left: calc(8px + env(safe-area-inset-left));
      width: 64px; height: 64px; border: none; border-radius: 50%;
      background: radial-gradient(circle, rgba(28,8,11,0.85) 0 19px, var(--gold) 19px 21px, transparent 22px);
      color: var(--gold-brt); font-size: 13px;
      touch-action: none; -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none;
    }
    html.touch:not(.deck) #pause-btn { display: block; }

    /* ── Pause menu (every input) ── */
    #pause-menu {
      position: fixed; inset: 0; z-index: 20;
      display: flex; align-items: center; justify-content: center;
      background: rgba(11,5,7,0.72);
      touch-action: none; -webkit-user-select: none; user-select: none;
    }
    .pm-panel {
      display: flex; flex-direction: column; gap: 12px; min-width: 250px;
      padding: 26px 34px 22px; text-align: center; border-radius: 8px;
      background: radial-gradient(ellipse 90% 80% at 50% 40%, rgba(74,14,18,0.95), rgba(12,6,8,0.97));
      box-shadow: 0 0 0 2px var(--gold), 0 0 0 7px var(--oxblood), 0 0 0 8px rgba(232,198,106,0.35), 0 30px 80px -20px #000;
    }
    .pm-title {
      font-family: 'Ewert', serif; font-size: 44px; line-height: 1; margin-bottom: 6px;
      color: var(--gold-brt); text-shadow: 0 2px 0 #b07a1e, 0 4px 0 #6e4a12;
    }
    .pm-panel button {
      min-height: 52px; font-family: 'Cinzel', serif; font-weight: 700; font-size: 16px;
      letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--ink); background: rgba(74,14,18,0.6);
      border: 1px solid rgba(232,198,106,0.45); border-radius: 6px; cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .pm-panel button:hover, .pm-panel button:focus-visible { border-color: var(--gold); color: var(--gold-brt); outline: none; }
    .pm-hint {
      margin-top: 6px; max-width: 280px; font-family: 'Cinzel', serif; font-size: 11px;
      letter-spacing: 0.14em; color: var(--ink); opacity: 0.55;
    }
```

- [ ] **Step 5: Wire it in `js/controls.js`**

Add to `init()`:

```js
    this._bindTap('pause-btn', 'Escape');
    this._bindTap('pm-resume', 'Escape');
    this._bindTap('pm-restart', 'KeyR');
    this._bindTap('pm-levels', 'KeyQ');
    this._bindTap('pm-sound', 'KeyM');
```

Add the fields `_state: null, _muted: null,` at the top of the object, then add
`_bindTap` and replace the empty `update() {}`:

```js
  // Menu button: one press-and-release per click (tap or mouse).
  _bindTap(id, code) {
    document.getElementById(id).addEventListener('click', () => Input.tapKey(code));
  },

  // Keep the DOM in step with the game — only touching it when something changed.
  update() {
    const state = Game.state;
    if (state !== this._state) {
      this._state = state;
      document.getElementById('pause-menu').hidden = state !== 'paused';
      document.getElementById('pause-btn').hidden = state !== 'playing';
    }
    if (Audio.muted !== this._muted) {
      this._muted = Audio.muted;
      document.getElementById('pm-sound').textContent = `Sound: ${Audio.muted ? 'off' : 'on'}`;
    }
  },
```

- [ ] **Step 6: Drop the canvas pause text**

In `js/game.js` `drawOverlay`, replace
`else if (this.state === 'paused') { this.drawHUD(ctx); this.drawPause(ctx); }` with:

```js
    else if (this.state === 'paused') this.drawHUD(ctx);   // the menu itself is DOM (#pause-menu)
```

and delete the whole `drawPause(ctx) { … }` method.

- [ ] **Step 7: Run the checks**

Reload, run `runChecks(['pauseMenu','deckButtons','smoke'])`. Expected: all `ok:true`.

- [ ] **Step 8: Commit**

```bash
cd /c/Code/clowncity && git add index.html js/controls.js js/game.js verify/checks.js && git commit -m "feat(controls): tappable pause menu for every input + floating pause on touch"
```

---

### Task 5: Hints that match the input scheme; Esc stays on level select

**Files:**
- Modify: `js/layout.js` (hint table + splash hint)
- Modify: `index.html` (`id="hint"`)
- Modify: `js/game.js` (level-select footer, mute label, level-select Esc)
- Modify: `js/controls.js` (pause-menu hint)
- Test: `verify/checks.js` (`hints`)

- [ ] **Step 1: Write the failing check**

Add to `CHECKS`:

```js
    async hints() {
      for (const s of ['keys', 'touch', 'deck']) {
        Layout.force = s; Layout.apply();
        assert(document.getElementById('hint').textContent === Layout.hints[s].splash, `${s}: splash hint`);
        Game.state = 'levelSelect';
        let texts = drawTexts().map(t => t.text);
        assert(texts.includes(Layout.hints[s].select), `${s}: level-select footer`);
        Audio.muted = true;
        texts = drawTexts().map(t => t.text);
        assert(texts.includes(Layout.hints[s].muted), `${s}: mute label`);
        flat(); Input.tapKey('Escape'); step(1 / 120);
        assert(document.getElementById('pm-hint').textContent === Layout.hints[s].pause, `${s}: pause-menu hint`);
      }
      assert(!/tap your heading/i.test(Layout.hints.touch.splash), 'touch copy must not say "tap your heading"');
      Game.state = 'levelSelect';
      Input.tapKey('Escape'); step(0.6);
      assert(Game.state === 'levelSelect', `Esc on level select → ${Game.state}`);
      return 'splash, footer, mute, pause hints per scheme; Esc stays';
    },
```

- [ ] **Step 2: Run it to see it fail**

Reload, run `runChecks(['hints'])`. Expected: `ok:false` (`Cannot read properties of undefined` on `Layout.hints`).

- [ ] **Step 3: Hint table and the splash hint**

In `js/layout.js`, add after `deckMinH`:

```js
  // Copy that depends on how you're playing. One place, so it can't drift.
  hints: {
    keys: {
      splash: 'steer \u25C2\u25B8 \u00B7 space to jump \u00B7 press your heading to spray',
      select: '\u2190 \u2192  choose       SPACE  play',
      pause:  '\u2190 \u2192 turn \u00B7 space jump \u00B7 press your heading to spray \u00B7 esc resume',
      muted:  '[MUTED - M to toggle]',
    },
    touch: {
      splash: 'swipe to turn \u00B7 tap to jump \u00B7 swipe your heading to spray',
      select: 'SWIPE  choose       TAP  play',
      pause:  'swipe to turn \u00B7 tap to jump \u00B7 swipe your heading to spray',
      muted:  '[MUTED]',
    },
    deck: {
      splash: '\u25C0 \u25B6 to turn \u00B7 jump \u00B7 press your heading to spray',
      select: '\u25C0 \u25B6  choose       JUMP  play',
      pause:  '\u25C0 \u25B6 turn \u00B7 JUMP jump \u00B7 press your heading to spray',
      muted:  '[MUTED]',
    },
  },

  hint(key) { return this.hints[this.scheme][key]; },
```

and in `apply()`, right after `Camera.lookaheadX = v.lookahead;`:

```js
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = this.hint('splash');
```

In `index.html`, change `<div class="hint">…</div>` to `<div class="hint" id="hint"></div>`
(Layout fills it on load).

- [ ] **Step 4: Canvas copy + Esc**

In `js/game.js`:

(a) `drawLevelSelect`: replace the instructions `fillText('SWIPE / ← → to select …', …)` line with:

```js
    ctx.fillText(Layout.hint('select'), Engine.width / 2, Engine.height - 40);
```

(b) `drawOverlay` mute indicator: replace `ctx.fillText('[MUTED - M to toggle]', Engine.width - 12, 18);` with:

```js
      ctx.fillText(Layout.hint('muted'), Engine.width - 12, 18);
```

(c) `updateLevelSelect`: delete the whole `// Back to title` block
(`if (Input.pressed('Escape')) { this.fadeToBlack(() => { this.state = 'title'; … }); }`).
The marquee is the only title now.

- [ ] **Step 5: Pause-menu hint**

In `js/controls.js`, add the field `_hintKey: null,` next to `_state`, and add this block at
the end of `update()`. It re-renders on entering pause and when the phone turns mid-pause:

```js
    const hintKey = state === 'paused' ? Layout.scheme : null;
    if (hintKey && hintKey !== this._hintKey) {
      document.getElementById('pm-hint').textContent = Layout.hint('pause');
    }
    this._hintKey = hintKey;
```

- [ ] **Step 6: Run the checks**

Reload, run `runChecks(['hints','pauseMenu','layoutModes'])`. Expected: all `ok:true`.

- [ ] **Step 7: Commit**

```bash
cd /c/Code/clowncity && git add js/layout.js js/game.js js/controls.js index.html verify/checks.js && git commit -m "feat(copy): control hints match keyboard / swipe / deck; Esc no longer exits to the old title"
```

---

### Task 6: Camera lead — measure the warning time in both layouts

**Files:**
- Modify: `js/layout.js` (only if tuning is needed)
- Test: `verify/checks.js` (`warningTime`, `allLevels`)

- [ ] **Step 1: Write the checks**

Add to `CHECKS`:

```js
    async allLevels() {
      const out = [];
      for (const s of ['keys', 'deck']) {
        Layout.force = s; Layout.apply();
        for (let i = 0; i < Game.totalLevels; i++) {
          const r = playLevel(i, { lead: 24 });
          assert(r.result === 'goal', `${s} / ${r.level}: ${r.result}`);
          out.push(`${s}/${r.level} ${r.time}s`);
        }
      }
      return out.join(' · ');
    },
    // Warning = time from an obstacle entering the view to the moment Poko acts
    // on it. Cruise speed must give >= 1.0s in deck mode; overspeed is reported.
    async warningTime() {
      const res = {};
      for (const s of ['keys', 'deck']) {
        Layout.force = s; Layout.apply();
        const worst = { cruise: { t: Infinity }, over: { t: Infinity } };
        for (let i = 0; i < Game.totalLevels; i++) {
          const right = [];
          const r = playLevel(i, { lead: 24, log: true, onFrame: () => right.push(Camera.x + Engine.width) });
          for (const d of r.decisions) {
            if ((d.why !== 'pit' && d.why !== 'enemy') || d.dir !== 1) continue;
            const edgeX = d.x + Player.w + 24 + (d.why === 'enemy' ? 24 : 0);
            const fDecide = Math.round(d.t / Engine.fixedDt);
            const fSeen = right.findIndex(x => x >= edgeX);
            if (fSeen < 0 || fSeen > fDecide) continue;
            const t = +((fDecide - fSeen) * Engine.fixedDt).toFixed(2);
            const bucket = Math.abs(d.vx) <= 420 ? worst.cruise : worst.over;
            if (t < bucket.t) Object.assign(bucket, { t, level: r.level, col: Math.floor(edgeX / 32) });
          }
        }
        res[s] = worst;
      }
      assert(res.deck.cruise.t >= 1.0, `deck cruise warning ${res.deck.cruise.t}s < 1.0s (${JSON.stringify(res.deck.cruise)})`);
      return JSON.stringify(res);
    },
```

- [ ] **Step 2: Run them**

Reload, run `runChecks(['allLevels','warningTime'])`.
Expected: `allLevels` ok (6 goals). `warningTime`: `keys.cruise.t` ≈ 1.0–1.1s and
`deck.cruise.t` ≥ 1.0s with `lookahead: 220`. Record both `over` values (the Big Drop
launch) in the commit message.

- [ ] **Step 3: Tune only if needed**

If `deck.cruise.t < 1.0`, raise `views.deck.lookahead` in `js/layout.js` by 20 and re-run
Step 2. Stop at 260. If 260 still fails, stop and report the numbers to Caelan rather
than going further, because a bigger lead pushes Poko against the left edge.

- [ ] **Step 4: Commit**

```bash
cd /c/Code/clowncity && git add js/layout.js verify/checks.js && git commit -m "test(verify): warning-time + both-layout playthrough checks (deck cruise ≥1.0s)"
```
(Put the measured `keys`/`deck` cruise and overspeed numbers in the message body.)

---

### Task 7: Splash hands Space back (the first Space press works)

**Files:**
- Modify: `index.html` (splash `enter()`)
- Test: `verify/checks.js` (`splashHandoff`)

- [ ] **Step 1: Write the failing check**

Add to `CHECKS` (it only runs on a freshly loaded page, so it's first in any run list):

```js
    async splashHandoff() {
      const splash = document.getElementById('splash');
      if (splash.classList.contains('go')) return null;   // already entered this page load
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      assert(splash.classList.contains('go'), 'splash did not enter on click');
      assert(!Input.held('Space'), 'Space is stuck down after the splash handoff');
      step(1);
      assert(Game.state === 'levelSelect', `after the splash: ${Game.state}`);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      step(1 / 120);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
      assert(Game.transitionDir === 1, 'the first Space on level select should start the level');
      return 'click → level select; first Space works';
    },
```

- [ ] **Step 2: Run it to see it fail**

Reload, then run `runChecks(['splashHandoff'])` **as the first thing on the page**.
Expected: `ok:false`, `Space is stuck down after the splash handoff`.

- [ ] **Step 3: Fix**

In `index.html`, in the splash script's `enter()`, replace the single `dispatchEvent` line with:

```js
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
        // …and let it go again: a click, tap or Enter never sends a Space keyup,
        // so without this Input thinks Space is still held and swallows the
        // first real Space press on level select.
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
```

- [ ] **Step 4: Run it**

Reload, run `runChecks(['splashHandoff'])` first. Expected: `ok:true`.

- [ ] **Step 5: Commit**

```bash
cd /c/Code/clowncity && git add index.html verify/checks.js && git commit -m "fix(splash): release the synthetic Space so the first real press isn't swallowed"
```

---

### Task 8: After the goal — coast to a stop, stay swallowed by the tent

**Files:**
- Modify: `js/player.js` (`finish`, `_coast`, fields, `spawn`, `update`, `draw`)
- Modify: `js/game.js` (goal branch)
- Test: `verify/checks.js` (`goalCoast`)

- [ ] **Step 1: Write the failing check**

Add to `CHECKS`:

```js
    async goalCoast() {
      const out = [];
      for (let i = 0; i < Game.totalLevels; i++) {
        let atGoal = null;
        const r = playLevel(i, { lead: 24, postSeconds: 5, onFrame: () => {
          if (!atGoal && Player.finished) atGoal = { x: Player.x, y: Player.y };
        } });
        const a = r.afterGoal;
        assert(r.result === 'goal' && a, `${r.level}: no goal`);
        assert(atGoal, `${r.level}: Player.finished never set at the goal`);
        assert(!a.diedAfterGoal, `${r.level}: died after the goal`);
        if (Level.maps[i].tent) {
          assert(a.hidden && a.x === +atGoal.x.toFixed(2) && a.y === +atGoal.y.toFixed(2), `${r.level}: Poko should stay swallowed by the tent`);
        } else {
          assert(!a.offscreenBelow && a.grounded && Math.abs(a.vx) < 1, `${r.level}: should coast to a stop (got ${JSON.stringify(a)})`);
        }
        out.push(`${r.level} ok`);
      }
      return out.join(' · ');
    },
```

- [ ] **Step 2: Run it to see it fail**

Reload, run `runChecks(['goalCoast'])`. Expected: `ok:false`, `The Big Top: Player.finished never set at the goal`.

- [ ] **Step 3: Player state**

In `js/player.js`, add to the `// ── Death & respawn ──` field group:

```js
  finished: false,          // reached the goal: coasting to a stop, input ignored
  hidden: false,            // swallowed by the tent (Big Drop finale): not drawn or updated
```

In `spawn()`, after `this.dead = false;`:

```js
    this.finished = false;
    this.hidden = false;
```

Add these methods after `respawn()`:

```js
  // Called by Game on touching the goal. hide = swallowed by the tent.
  finish(hide) {
    this.finished = true;
    this.hidden = !!hide;
    this.attackDir = 0;
    this.spinAttackTimer = 0;
    if (this.hidden) this.trail.length = 0;
  },

  // Post-goal physics: no input, no hazards — brake to a stop under gravity.
  _coast(dt) {
    this.vx = approach(this.vx, 0, this.reverseDecel * dt);
    const grav = this.vy < 0 ? this.gravityUp : this.gravityDown;
    this.vy = Math.min(this.vy + grav * dt, this.maxFallSpeed);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.resolveCollisions();
    this.wheelAngle += (this.vx / this.wheelRadius) * dt;
    this.lean += (0 - this.lean) * this.leanRate * dt;
    this.squash += (1 - this.squash) * 14 * dt;
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].alpha -= dt * 2;
      if (this.trail[i].alpha <= 0) this.trail.splice(i, 1);
    }
    this.updateAnim(dt);
  },
```

In `update(dt)`, right after the `if (this.dead) { … return; }` block:

```js
    // ── Finished: the goal was reached ──
    if (this.finished) {
      if (!this.hidden) this._coast(dt);
      return;
    }
```

In `draw(ctx)`, change the first guard to:

```js
    if (this.dead || this.hidden) return;
```

- [ ] **Step 4: Call it from the goal**

In `js/game.js` `updatePlaying`, inside the goal branch, right after `Audio.levelComplete();`:

```js
        Player.finish(!!Level.maps[this.currentLevel].tent);
```

- [ ] **Step 5: Run the checks**

Reload, run `runChecks(['goalCoast','allLevels','smoke'])`. Expected: all `ok:true`.

- [ ] **Step 6: Commit**

```bash
cd /c/Code/clowncity && git add js/player.js js/game.js verify/checks.js && git commit -m "fix(player): coast to a stop after the goal; stay swallowed by the Big Drop tent"
```

---

### Task 9: Ending returns to level select; win screen matches the marquee; LOCKED token

**Files:**
- Modify: `js/tokens.js`
- Modify: `js/game.js` (`updateWin`, `drawWin`, `_fit` helper, LOCKED font)
- Test: `verify/checks.js` (`winFlow`)

- [ ] **Step 1: Write the failing check**

Add to `CHECKS`:

```js
    async winFlow() {
      for (const s of ['keys', 'deck']) {
        Layout.force = s; Layout.apply();
        Game.transitionDir = 0; Game.transitionAlpha = 0;
        Game.state = 'win'; Game.timer = 2;
        const texts = drawTexts();
        const title = texts.find(t => t.text === 'CONGRATULATIONS');
        assert(title && /Ewert/.test(title.font), `${s}: win title should use the marquee face (got ${title && title.font})`);
        Engine.ctx.font = title.font;
        assert(Engine.ctx.measureText('CONGRATULATIONS').width <= Engine.width - 60, `${s}: win title overflows`);
        Input.tapKey('Space'); step(1);
        assert(Game.state === 'levelSelect', `${s}: win → ${Game.state}`);
      }
      assert(Tokens.font.lock, 'Tokens.font.lock missing');
      Engine.ctx.font = Tokens.font.lock;
      const want = Engine.ctx.font;                       // canvas-normalised form
      Game.save.levelsComplete = [false, false, false];
      Game.state = 'levelSelect';
      const locked = drawTexts().find(t => t.text === 'LOCKED');
      assert(locked && locked.font === want, `LOCKED should use Tokens.font.lock (got ${locked && locked.font})`);
      return 'win → level select; Ewert title fits both views; LOCKED tokenised';
    },
```

- [ ] **Step 2: Run it to see it fail**

Reload, run `runChecks(['winFlow'])`. Expected: `ok:false`, `keys: win title should use the marquee face (got bold 42px monospace)`.

- [ ] **Step 3: Tokens**

In `js/tokens.js`, add to `color` after `goldBright`:

```js
    goldShade:  '#b07a1e',       // marquee gold extrusion (upper step)
    goldDeep:   '#6e4a12',       // marquee gold extrusion (lower step)
```

and to `font` after `xs`:

```js
    lock:    '20px monospace',          // level-select LOCKED label
    display: '58px Ewert, monospace',   // marquee display face (win title); loaded by index.html
    serif:   'bold 20px Cinzel, serif', // marquee serif (win subtitle)
```

Update the typography comment to:
`// ── Typography ── monospace scale for the game UI, plus the marquee faces ──`

- [ ] **Step 4: Game changes**

In `js/game.js`:

(a) `updateWin`: change `this.state = 'title';` to:

```js
        this.state = 'levelSelect';
        this.timer = 0;
```

(b) LOCKED label: change `ctx.font = '20px monospace';` to `ctx.font = Tokens.font.lock;`.

(c) Add a helper above `drawWin`:

```js
  // Set `font`, shrinking its px size if `text` would be wider than maxW.
  _fitFont(ctx, text, font, maxW) {
    ctx.font = font;
    const w = ctx.measureText(text).width;
    if (w <= maxW) return;
    const px = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)[1]);
    ctx.font = font.replace(/\d+(?:\.\d+)?px/, `${Math.floor(px * maxW / w)}px`);
  },
```

(d) In `drawWin`, replace from `ctx.textAlign = 'center';` down to (not including) the
`total deaths` line with:

```js
    ctx.textAlign = 'center';
    const cx = Engine.width / 2, cy = Engine.height / 2;
    // Marquee title: gold face over a two-step extrusion, like the splash.
    this._fitFont(ctx, 'CONGRATULATIONS', Tokens.font.display, Engine.width - 60);
    ctx.fillStyle = Tokens.color.goldDeep;   ctx.fillText('CONGRATULATIONS', cx, cy - 62);
    ctx.fillStyle = Tokens.color.goldShade;  ctx.fillText('CONGRATULATIONS', cx, cy - 64);
    ctx.fillStyle = Tokens.color.goldBright; ctx.fillText('CONGRATULATIONS', cx, cy - 66);

    ctx.fillStyle = Tokens.color.ink;
    ctx.font = Tokens.font.serif;
    ctx.fillText('You escaped Clown City', cx, cy - 22);
```

- [ ] **Step 5: Run the checks**

Reload, run `runChecks(['winFlow','hints','smoke'])`. Expected: all `ok:true`.

- [ ] **Step 6: Commit**

```bash
cd /c/Code/clowncity && git add js/tokens.js js/game.js verify/checks.js && git commit -m "feat(game): ending returns to level select; marquee-styled win title; LOCKED font token"
```

---

### Task 10: Website metadata and the link-preview image

**Files:**
- Modify: `index.html` (`<head>`)
- Create: `verify/og.js`
- Create: `og.png`
- Test: `verify/checks.js` (`meta`)

- [ ] **Step 1: Write the failing check**

Add to `CHECKS`:

```js
    async meta() {
      const q = sel => document.querySelector(sel);
      assert(q('link[rel="icon"]'), 'favicon link missing');
      assert(q('meta[name="description"]') && q('meta[name="description"]').content.length > 40, 'description missing');
      for (const p of ['og:title', 'og:description', 'og:url', 'og:image']) assert(q(`meta[property="${p}"]`), `${p} missing`);
      assert(q('meta[name="twitter:card"]'), 'twitter:card missing');
      const img = q('meta[property="og:image"]').content;
      const res = await fetch('/og.png', { cache: 'no-store' });
      assert(res.ok && res.headers.get('content-type').includes('png'), 'og.png not served');
      return `og:image → ${img}`;
    },
```

- [ ] **Step 2: Run it to see it fail**

Reload, run `runChecks(['meta'])`. Expected: `ok:false`, `favicon link missing`.

- [ ] **Step 3: `<head>` tags**

In `index.html`, after `<title>Clown City</title>`:

```html
  <meta name="description" content="Poko the Clown on a unicycle: a bite-size browser platformer with three levels. Plays on phones and desktop.">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='27' fill='%23e23b30'/%3E%3Ccircle cx='23' cy='22' r='8' fill='%23fff' fill-opacity='.55'/%3E%3C/svg%3E">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Clown City">
  <meta property="og:description" content="Poko the Clown on a unicycle: a bite-size browser platformer with three levels. Plays on phones and desktop.">
  <meta property="og:url" content="https://clowncity.russelldangerr.com/">
  <meta property="og:image" content="https://clowncity.russelldangerr.com/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
```

- [ ] **Step 4: Create `verify/og.js`**

```js
// verify/og.js — renders og.png (1200×630 link preview) from the game's own
// drawing code, so the preview is our own art (safe for the public repo).
// Usage: fetch('/verify/og.js').then(r=>r.text()).then(eval); const c = await renderOG();
(function () {
  window.renderOG = async function () {
    await document.fonts.ready;
    const W = 1500, H = 788;                 // world view; downscaled to 1200×630
    const prev = { level: Game.currentLevel, state: Game.state };
    Engine.halted = true;
    try {
      Engine.setView(W, H);
      Level.load(2);                         // The Big Drop: downhill, chasm, tent
      Entities.list.length = 0;
      Camera.snapTo(20 * 32, Level.levelHeight - H);
      Player.spawn(33 * 32, 11 * 32);        // mid-leap over the chasm
      Object.assign(Player, { respawning: false, vx: 620, vy: -120, lean: 0.06, squash: 1.15 });
      Particles.pool.length = 0;
      Player._carnivalSpray(1);
      for (let i = 0; i < 14; i++) Particles.update(1 / 120);

      const ctx = Engine.ctx;
      ctx.clearRect(0, 0, W, H);
      Level.draw(ctx);
      Particles.draw(ctx);
      ctx.save(); ctx.translate(-Camera.drawX, -Camera.drawY); Player.draw(ctx); ctx.restore();

      const out = document.createElement('canvas');
      out.width = 1200; out.height = 630;
      const o = out.getContext('2d');
      o.drawImage(Engine.canvas, 0, 0, 1200, 630);
      o.textAlign = 'center';
      o.font = '112px Ewert, monospace';
      o.fillStyle = Tokens.color.goldDeep;   o.fillText('CLOWN CITY', 600, 198);
      o.fillStyle = Tokens.color.goldShade;  o.fillText('CLOWN CITY', 600, 194);
      o.fillStyle = Tokens.color.goldBright; o.fillText('CLOWN CITY', 600, 190);
      o.font = 'bold 26px Cinzel, serif';
      o.fillStyle = Tokens.color.ink;
      o.fillText('A  UNICYCLE  AUTO-RUNNER', 600, 246);
      return out;
    } finally {
      Layout.apply();                        // restores the screen's view (it differs from 1500×788)
      Game.loadLevel(prev.level); Game.state = prev.state;
      Engine.halted = false;
    }
  };
})();
```

- [ ] **Step 5: Export `og.png` to disk**

Write a one-shot receiver to the scratchpad and start it in the background (Bash tool,
`run_in_background: true`):

```bash
cat > "C:/Users/caela/AppData/Local/Temp/claude/C--Code-clowncity/e21dc477-bd4b-4cac-a7e5-9aba2cca3f25/scratchpad/og_receiver.py" <<'EOF'
import http.server, sys
OUT = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        with open(OUT, 'wb') as f: f.write(data)
        self.send_response(204); self.end_headers()
        print(f'wrote {len(data)} bytes to {OUT}', flush=True)
http.server.HTTPServer(('127.0.0.1', 8082), H).handle_request()
EOF
py "C:/Users/caela/AppData/Local/Temp/claude/C--Code-clowncity/e21dc477-bd4b-4cac-a7e5-9aba2cca3f25/scratchpad/og_receiver.py" "C:/Code/clowncity/og.png"
```

Then in the page (`javascript_tool`, after a reload):

```js
await fetch('/verify/og.js').then(r => r.text()).then(eval);
const c = await renderOG();
const png = await new Promise(r => c.toBlob(r, 'image/png'));
await fetch('http://localhost:8082/', { method: 'POST', mode: 'no-cors', body: new Blob([png], { type: 'text/plain' }) });
png.size
```
Expected: a byte count (roughly 100–400 KB), and the background task prints `wrote N bytes`.

- [ ] **Step 6: Look at it**

`Read` `C:\Code\clowncity\og.png` and confirm what's in it. The title should be legible
and the tent, chasm and Poko visible. If not, adjust the `Camera.snapTo` / `Player.spawn`
positions in `og.js` and export again.

- [ ] **Step 7: Run the check**

Reload, run `runChecks(['meta'])`. Expected: `ok:true`.

- [ ] **Step 8: Commit**

```bash
cd /c/Code/clowncity && git add index.html verify/og.js og.png verify/checks.js && git commit -m "feat(site): favicon, description, link-preview tags + og.png rendered from the game"
```

---

### Task 11: Docs and comment cleanup

**Files:**
- Modify: `js/level.js` (Big Drop comment)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Big Drop map comment**

In `js/level.js`, replace the comment above The Big Drop's `data:` (the four lines starting
`// 80 wide x 25 tall — generated`) with:

```js
      // 80 wide x 25 tall. Plateau intro (rows 14-24, cols 1-21) -> 8-tile downhill
      // bomb '\' (22,14)->(29,21) flowing straight into a 2-tile up-kicker '/'
      // (30,21)/(31,20) (the v0.4.1 fix removed the flat between them) -> chasm
      // cols 32-36 -> tent ledge (rows 14-24, cols 37-78) with goal at (59,13).
```

- [ ] **Step 2: `CLAUDE.md` facts**

Edit `CLAUDE.md`:

(a) Architecture: replace `- Fixed internal canvas 960×540, CSS-scaled to fit.` with:

```markdown
- Internal canvas **960×540** normally, **640×480 in deck mode** (touch device held
  upright), chosen by `Layout` (layout.js) and CSS-scaled to fit. All drawing reads
  `Engine.width/height`; never hardcode the size.
```

(b) Key files, replace the `js/input.js` bullet with:

```markdown
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
```

(c) In the `js/player.js` bullet, replace `brake-kick + stomp combat in checkHazards()/getAttackRect().`
with:

```markdown
combat = brake-lunge, spin-out spray (the lethal confetti IS the hitbox) and stomp, in
`checkHazards()`; wall slide / wall-jump / rev-climb. A wall-jump and `spawn()` sync
`Input.runDir` (else the sticky steer U-turns Poko). `finish()` at the goal → coast to a
stop (`hidden` for the tent).
```

(d) Tuning knobs: change `` `runSpeed` (300) `` to `` `runSpeed` (400) `` and
`` `treadmillCap` (150) `` to `` `treadmillCap` (200) ``, and append the line:

```markdown
Combat / walls: `attackThreshold` (0.5), `spinAttackCost` (0.45), `wallSlideSpeed` (120),
`wallJumpForceY` (-440), `wallJumpPushX` (300), `revClimbSpeed` (280).
```

(e) Replace the whole `## Verifying changes` section body with:

```markdown
No test framework. Run `index.html` (the preview server on 8081), then in the page:
- `verify/checks.js` — `runChecks()` regression checks (layout, deck, pause, hints,
  goal, win, meta, warning time, all levels in both layouts). Reload the page first.
- `verify/play.js` — `playLevel(i, opts)` full-level bot through the real engine with
  touch-equivalent input.
- `verify/sim.js` — Player-only physics on a scratch map.
Harnesses set `Engine.halted` and step `Engine.systems` by hand. **A hidden browser pane
never fires requestAnimationFrame** (frozen loop, `innerWidth` 0), so screenshots need
the pane visible; call each system's `draw` right before capturing.
```

(f) Out of scope: delete the `On-screen touch **pause** button.` sentence and the
`The lone non-bold 20px LOCKED font label (flagged in the audit).` sentence.

- [ ] **Step 3: Commit**

```bash
cd /c/Code/clowncity && git add js/level.js CLAUDE.md && git commit -m "docs: refresh CLAUDE.md for deck mode, virtual keys and the check harness"
```

---

### Task 12: Visual pass and full regression

**Files:** none (verification only; fix and commit anything found)

- [ ] **Step 1: Full check run**

Reload, then run `runChecks()` (it runs `splashHandoff` first on its own).
Expected: `pass: true`, with every check `ok:true`.

- [ ] **Step 2: Screenshots — the pane must be visible**

Check `tabs_context` says the pane is displayed; the live loop then draws for you. For each
viewport: `resize_window`, reload, dismiss the splash (a `computer` click), then capture
with `computer` → `screenshot`:
1. `375×667` upright: splash, level select, mid-level on The Catwalk, pause menu.
2. `390×844` upright: mid-level.
3. `812×375` sideways: mid-level with the floating pause button.
4. desktop (preset `desktop`): level select, pause menu (Esc), win screen.

Look for clipped text, overlapping HUD, deck buttons off-screen, and the gold frame
misaligned. Fix anything found, re-run Step 1, and commit the fix.

- [ ] **Step 3: Rotate mid-level**

At `375×667`, start The Big Top, step 2s, then `resize_window` to `667×375`, then back.
Expected: no console errors (`read_console_messages` with `onlyErrors`), the view switches
960↔640, and the HUD re-centres.

- [ ] **Step 4: Reset the viewport**

`resize_window` preset `desktop`.

---

### Task 13: Caelan's phone playtest, then the release gate

- [ ] **Step 1: Hand it to Caelan**

Give him `http://192.168.1.72:8081` (same Wi-Fi as this PC; if it won't load, Windows
Firewall is blocking Python). Ask him to play all three levels upright and sideways and
to report anything that feels off: button size or placement, jump timing, camera lead,
or text he can't read.

- [ ] **Step 2: Fix what he finds** (each fix with a check if it's testable, then commit)

- [ ] **Step 3: Release, only on his go-ahead**

- Push `dev`.
- Tag `v0.4.0` / `v0.4.1` on their merge commits (`f1bd159`, `6a75a72`) and push the tags.
- Merge `dev` into `main` as `Merge dev into main - v0.5.0 (mobile sign-off)`, tag
  `v0.5.0`, and push. Cloudflare deploys `main` to clowncity.russelldangerr.com.
- Confirm the live site serves the new `index.html` and `og.png`.

Each push is outward-facing: confirm with Caelan immediately before running it.
