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

  function cleanInput() {
    Input.keys = {}; Input.justPressed = {}; Input.buffer = {}; Input._touches = {}; Input.runDir = 1;
  }

  function snapshot() {
    let raw = null;
    try { raw = localStorage.getItem('clowncity_save'); } catch (e) {}
    return {
      raw, save: JSON.parse(JSON.stringify(Game.save)),
      force: typeof Layout !== 'undefined' ? Layout.force : undefined,
    };
  }
  function restore(s) {
    Game.save = s.save;
    try { if (s.raw == null) localStorage.removeItem('clowncity_save'); else localStorage.setItem('clowncity_save', s.raw); } catch (e) {}
    const fi = Level.maps.findIndex(m => m.name === '__flat__');
    if (fi >= 0) Level.maps.splice(fi, 1);
    if (typeof Layout !== 'undefined') { Layout.force = s.force; Layout.apply(); }
    cleanInput();
    Game.transitionDir = 0; Game.transitionAlpha = 0;
    Game.loadLevel(0); Game.state = 'levelSelect'; Game.timer = 0;
  }

  const CHECKS = {
    async smoke() {
      assert(Engine.systems.length >= 8, `only ${Engine.systems.length} systems registered`);
      play(0); step(0.5);
      assert(Player.x > Level.spawnX, 'Bozo should roll forward from spawn');
      return `${Engine.systems.length} systems, Bozo rolled to x=${Math.round(Player.x)}`;
    },
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
    const mutedBefore = Audio.muted;                 // restored once, after the whole run
    for (const name of list) {
      const fn = CHECKS[name];
      if (!fn) { results.push({ name, ok: false, detail: 'no such check' }); continue; }
      const snap = snapshot();
      Engine.halted = true;
      Audio.muted = true;
      cleanInput();                                  // every check starts from released keys
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
    setTimeout(() => { Audio.muted = mutedBefore; }, 600);   // let queued SFX fire muted
    return { pass: results.every(r => r.ok !== false), results };
  };
  Object.assign(window, { __checks: { step, drawTexts, play, flat, tap, swipe, pointer, press, wait, assert } });
})();
