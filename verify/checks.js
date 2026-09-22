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

  // Run one draw pass and report every fillText as { text, font, px } — px is
  // the rendered size in canvas pixels (font size × the current transform scale).
  function drawTexts() {
    const ctx = Engine.ctx, orig = ctx.fillText, seen = [];
    ctx.fillText = function (t, ...a) {
      const m = ctx.font.match(/(\d+(?:\.\d+)?)px/);
      seen.push({ text: String(t), font: ctx.font, px: m ? parseFloat(m[1]) * ctx.getTransform().a : 0, x: a[0], y: a[1] });
      return orig.call(this, t, ...a);
    };
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
      assert(Player.x > Level.spawnX, 'Poko should roll forward from spawn');
      return `${Engine.systems.length} systems, Poko rolled to x=${Math.round(Player.x)}`;
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
    // Finale / level-complete / win text: prompt per scheme, a backing panel so
    // it reads over the tent, and phone-sized text in deck mode.
    async completeScreen() {
      assert(Game._panel, 'Game._panel missing');
      for (const s of ['keys', 'touch', 'deck']) {
        Layout.force = s; Layout.apply();
        play(2); Player.finish(true);
        const want = Layout.hints[s].continue;
        assert(want, `${s}: no continue hint`);
        for (const state of ['tentFinale', 'levelComplete', 'win']) {
          Game.state = state; Game.timer = 2.1; Game.tentTimer = 1;   // 2.1: prompt blink is "on"
          const orig = Game._panel;
          let panels = 0, texts;
          Game._panel = function (...a) { panels++; return orig.apply(this, a); };
          try { texts = drawTexts(); } finally { Game._panel = orig; }
          if (state !== 'win') assert(panels >= 1, `${s}/${state}: no backing panel behind the text`);
          if (state !== 'tentFinale') {
            assert(texts.some(t => t.text === want), `${s}/${state}: continue prompt should read "${want}"`);
            assert(!texts.some(t => /TAP\s+\/\s+SPACE/.test(t.text)), `${s}/${state}: old "TAP / SPACE" prompt still drawn`);
          }
          if (s === 'deck' && state !== 'tentFinale') {
            const stat = texts.find(t => /^(time|total deaths):/.test(t.text));
            assert(stat && stat.px >= 18, `deck/${state}: stats render at ${stat && stat.px.toFixed(1)}px (want >= 18)`);
          }
        }
      }
      return 'panels behind finale + complete text; prompt per scheme; phone-sized stats';
    },
    // Sideways touch: the floating pause button (64px at the top-left) must not
    // cover the death counter. Worst case is a 16:9 phone — no letterbox, the
    // canvas is 667 css px wide, so the button reaches (8 + 64) × 960 / 667 ≈ 104
    // canvas px in from the left.
    async pauseOverlap() {
      const reach = (8 + 64) * 960 / 667;
      for (const s of ['touch', 'keys']) {
        Layout.force = s; Layout.apply();
        flat(); step(0.2);
        Player.deathCount = 3;
        const count = drawTexts().find(t => t.text === '3');
        assert(count, `${s}: death counter not drawn`);
        const skullLeft = count.x - 16;                   // the skull icon sits 16px left of the number
        if (s === 'touch') assert(skullLeft >= reach, `touch: death counter at ${skullLeft}px is under the pause button (reaches ${reach.toFixed(0)}px)`);
        else assert(skullLeft === Tokens.space.hudMargin, `desktop: death counter should stay at the ${Tokens.space.hudMargin}px margin (got ${skullLeft})`);
      }
      return `touch: counter clear of the button (>= ${reach.toFixed(0)}px); desktop unchanged`;
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
