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
          if (Level.maps[i].bot === false) continue;   // levels the pit-jumping bot can't play have their own checks
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
          if (Level.maps[i].bot === false) continue;   // levels the pit-jumping bot can't play have their own checks
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
        if (Level.maps[i].bot === false) continue;
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
    // Coyote time: a jump pressed just after rolling off a ledge still launches,
    // for the whole coyoteTime window (it was once a single frame), then stops;
    // and a second press in the air is not a double jump.
    async coyote() {
      const rows = [];
      for (let r = 0; r < 25; r++) rows.push(r >= 22 ? '1'.repeat(20) + '0'.repeat(60) : '0'.repeat(80));
      Level.maps.push({ name: '__ledge__', theme: 'circus', spawn: [14, 21], entities: [], data: rows });
      const li = Level.maps.length - 1;
      const dt = Engine.fixedDt, win = Player.coyoteTime / dt;
      // Roll off the ledge at cruise, press jump `n` frames after the ground is gone.
      const late = (n) => {
        play(li); cleanInput();
        Player.runState = 'cruise'; Player.rampT = 1; Player.vx = Player.runSpeed;
        let f = 0;
        while (!Player.grounded && f++ < 60) step(dt);
        while (Player.grounded && f++ < 240) step(dt);
        assert(!Player.grounded && !Player.dead, 'Poko never rolled off the ledge');
        for (let i = 1; i < n; i++) step(dt);
        Input.tapKey('Space'); step(dt);
        return Player.vy < -300;
      };
      try {
        const inside = Math.max(1, Math.floor(win) - 1), outside = Math.ceil(win) + 1;
        assert(late(1), 'no jump 1 frame after the ledge');
        assert(late(inside), `no jump ${inside} frames after the ledge (window is ${win.toFixed(1)} frames)`);
        assert(!late(outside), `jumped ${outside} frames after the ledge (window is ${win.toFixed(1)} frames)`);
        late(inside); step(10 * dt);
        Input.tapKey('Space'); step(dt);
        assert(Player.vy > Player.jumpForce * 0.85, `second press re-launched in the air (vy ${Player.vy.toFixed(0)})`);
        return `jumps up to ${inside} frames late, not ${outside}; no double jump`;
      } finally {
        Level.maps.splice(li, 1);
      }
    },
    // A respawn forgets the wall Poko was touching: restarting mid wall-slide with
    // jump held used to wall-jump off thin air, backwards, on the first frame.
    async spawnForgetsWall() {
      flat(); step(0.3);
      Player.wallDir = 1;                                   // as if clinging to a wall on the right
      Player.spawn(Level.spawnX, Level.spawnY);
      Input.tapKey('Space'); step(Engine.fixedDt);
      assert(Player.travelDir === 1 && Player.vx >= 0, `respawn wall-jumped off nothing (travelDir ${Player.travelDir}, vx ${Player.vx.toFixed(0)})`);
      return 'no phantom wall-jump on respawn';
    },
    // The Big Drop ramp: rolling off the lip launches Poko but NOT onto the tent
    // ledge; a press anywhere from the bottom of the bowl to the lip (loaded, it
    // fires at the lip) makes it.
    async rampLaunch() {
      const i = Level.maps.findIndex(m => m.name === 'The Big Drop');
      play(i);
      const ramp = Level.ramps[0];
      const bowl = ramp.pts.reduce((a, p) => (p.y > a.y ? p : a));        // lowest point
      const ride = (pressAt) => {
        play(i); cleanInput();
        let pressed = pressAt == null, launch = null;
        for (let f = 0; f < 12 * 120; f++) {
          if (!pressed && Player.grounded && Player.x + Player.w / 2 >= pressAt) { Input.tapKey('Space'); pressed = true; }
          const wasGrounded = Player.grounded;
          step(Engine.fixedDt);
          if (!launch && wasGrounded && !Player.grounded && Player.x > bowl.x) launch = { vx: Player.vx, vy: Player.vy };
          if (Player.dead) return { made: false, launch };
          if (Game.state === 'tentFinale') return { made: true, launch };
        }
        return { made: false, launch };
      };
      const free = ride(null);
      assert(free.launch && free.launch.vy < -300, `rolling off the lip should launch upward (vy ${free.launch && free.launch.vy.toFixed(0)})`);
      assert(!free.made, 'rolling off the lip with no press reached the tent — the press should matter');
      for (const x of [bowl.x, (bowl.x + ramp.x1) / 2, ramp.x1 - 4]) {            // bowl, mid kicker, lip
        assert(ride(x).made, `a press at x=${Math.round(x)} (bowl→lip) didn't reach the tent`);
      }
      return `free launch ${free.launch.vx.toFixed(0)}/${free.launch.vy.toFixed(0)} px/s falls short; presses at the bowl, kicker and lip all reach the tent`;
    },
    // The Carousel: a loop whose deck carries Poko. With the spin he covers
    // cruise + deckSpeed, against it cruise − deckSpeed; the seam is invisible
    // (no snag, no camera jump); a horse seats and carries him; each brass ring
    // takes the step it's meant to (A deck, B horse, C booth roof); and the
    // exit stays shut until all three are in. Patrols are removed so they
    // can't muddy the measurements.
    async carousel() {
      const i = Level.maps.findIndex(m => m.wrap);
      const S = Level.maps[i].deckSpeed, T = Level.tileSize, run = Player.runSpeed;
      const fresh = () => {
        play(i); cleanInput();
        Entities.list = Entities.list.filter(e => !(e instanceof PatrolEnemy));
      };
      const deckAt = (col) => { fresh(); Player.spawn(col * T, 21 * T, Player.respawnRampTime); };
      const speedOver = (sec) => { const x0 = Player.x; step(sec); return (Player.x - x0) / sec; };

      // 1) Speed with and against the spin.
      deckAt(35); step(1.0);
      const withSpin = speedOver(0.5);
      assert(Math.abs(withSpin - (run + S)) < 15, `with the spin: ${withSpin.toFixed(0)} px/s, want ${run + S}`);
      deckAt(66); step(0.2); Input.runDir = -1; step(1.2);
      const against = speedOver(0.5);
      assert(Math.abs(against + (run - S)) < 15, `against the spin: ${against.toFixed(0)} px/s, want ${-(run - S)}`);

      // 2) Across the seam: never leaves the deck, camera moves smoothly.
      const W = Level.levelWidth;
      deckAt(108); step(0.8);
      let maxCam = 0, airborne = 0, cam = Camera.x;
      for (let f = 0; f < 120; f++) {
        step(Engine.fixedDt);
        maxCam = Math.max(maxCam, Math.abs(Camera.x - cam)); cam = Camera.x;
        if (!Player.grounded) airborne++;
      }
      assert(Player.x > W + 64 && !Player.dead, `didn't roll through the seam (x ${Player.x.toFixed(0)}, W ${W})`);
      assert(airborne === 0, `left the deck for ${airborne} frames at the seam`);
      assert(maxCam < 10, `camera jumped ${maxCam.toFixed(1)} px in a frame at the seam`);

      // Put Poko on horse `h` at the top of its bob, its left edge at x.
      const horseAtPeak = (h, x) => {
        h.x = x; h.t = (((Math.PI - h.phase) / (2 * Math.PI)) * h.period % h.period + h.period) % h.period;
        h.y = h._bobY(); h.prevY = h.y;
      };
      const onHorse = (h) => {
        Player.spawn(h.x + 4, h.y - Player.h, 0.01); Player.respawning = false;
        Object.assign(Player, { vx: run, runState: 'cruise', rampT: 1, grounded: true, carry: S, surfaceSpeed: S });
      };
      const horse = () => Entities.list.find(e => e instanceof CarouselHorse);

      // 3) A horse seats Poko and carries him.
      fresh(); step(0.1);
      const h = horse(); horseAtPeak(h, 50 * T); onHorse(h);
      step(Engine.fixedDt * 4);
      assert(Player.grounded && Player.surfaceSpeed === S && Math.abs(Player.y + Player.h - h.y) < 1,
        `not seated on the horse (grounded ${Player.grounded}, feet ${(Player.y + Player.h).toFixed(1)} vs ${h.y.toFixed(1)})`);

      // Sweep takeoff points; true if any jump from `setup` grabs ring `ri` (A=0, B=1, C=2).
      const tries = (setup, xs, ri) => xs.some(x => {
        setup(x);
        Input.tapKey('Space');
        for (let f = 0; f < 150 && !Player.dead; f++) step(Engine.fixedDt);
        return Level.rings.slice().sort((a, b) => a.x - b.x)[ri].collected;
      });
      const xsNear = (col, from, to) => { const a = []; for (let d = from; d <= to; d += 6) a.push(col * T + d); return a; };
      const fromDeck = (x) => {                 // cruising on the deck, at x, with the spin
        deckAt(Math.floor(x / T) - 8); step(0.6);
        for (let f = 0; Player.x < x && f < 1200; f++) step(Engine.fixedDt);
      };
      const fromHorse = (x) => { fresh(); step(0.05); const h = horse(); horseAtPeak(h, x); onHorse(h); };
      const fromRoof = (x) => {                 // rolling along the booth roof
        fresh(); Player.spawn(88 * T, 16 * T - Player.h, 0.01); Player.respawning = false;
        Object.assign(Player, { vx: run, runState: 'cruise', rampT: 1 });
        step(Engine.fixedDt * 2);
        for (let f = 0; Player.x < x && f < 1200; f++) step(Engine.fixedDt);
      };
      const cols = Level.rings.map(r => r.x / T).sort((a, b) => a - b);
      assert(tries(fromDeck, xsNear(cols[0], -320, 0), 0), 'ring A: no deck jump reaches it');
      assert(!tries(fromDeck, xsNear(cols[1], -320, 0), 1), 'ring B: a deck jump reaches it (it should need a horse)');
      assert(tries(fromHorse, xsNear(cols[1], -320, 0), 1), 'ring B: no jump from a horse at its peak reaches it');
      assert(!tries(fromHorse, xsNear(cols[2], -320, 0), 2), 'ring C: a horse jump reaches it (it should need the booth roof)');
      assert(tries(fromRoof, xsNear(cols[2], -300, -80), 2), 'ring C: no jump off the booth roof reaches it');

      // 4) A horse near its peak reaches the booth roof.
      const roofY = 16 * T;
      const landsOnRoof = xsNear(88, -360, 0).some(x => {
        fromHorse(x); Input.tapKey('Space');
        for (let f = 0; f < 120; f++) {
          step(Engine.fixedDt);
          if (Player.grounded && Math.abs(Player.y + Player.h - roofY) < 1) return true;
        }
        return false;
      });
      assert(landsOnRoof, 'no jump from a horse at its peak lands on the booth roof');

      // 5) The exit is shut until all three rings are in.
      const goal = Level.getGoals()[0];
      const throughGoal = () => {
        Player.spawn(goal.x - 6 * T, 21 * T, 0.01); Player.respawning = false;
        Object.assign(Player, { vx: run, runState: 'cruise', rampT: 1 });
        for (let f = 0; f < 120 && !Player.finished; f++) step(Engine.fixedDt);
        return Player.finished;
      };
      fresh();
      Level.rings[0].collected = Level.rings[1].collected = true; Level.ringsCollected = 2;
      assert(!throughGoal(), 'the exit opened with a ring still out');
      fresh();
      for (const r of Level.rings) r.collected = true;
      Level.ringsCollected = Level.rings.length;
      assert(throughGoal(), 'the exit stayed shut with every ring in');
      return `with spin ${withSpin.toFixed(0)}, against ${against.toFixed(0)} px/s; seam smooth (cam ≤${maxCam.toFixed(1)}px/frame); rings A/B/C need deck/horse/roof; exit locks`;
    },
    // The Duck River: water kills; a rubber duck bounces Poko and hands him the
    // current; the stream's spacing is the rhythm (small gaps chain with no
    // input, the big gap needs a press and drowns you without one); a whole
    // river crossing works pressing only at the big gaps; spraying in the
    // gallery pen knocks every tin duck down; and the drawbridge is a wall
    // until then and a road after.
    async duckRiver() {
      const i = Level.maps.findIndex(m => m.name === 'The Duck River');
      const T = Level.tileSize, run = Player.runSpeed;
      const fresh = (keepDucks = true) => {
        play(i); cleanInput();
        Entities.list = Entities.list.filter(e => !(e instanceof PatrolEnemy) && (keepDucks || !(e instanceof DuckStream)));
      };
      const cruising = (x, y) => {
        Player.spawn(x, y, 0.01); Player.respawning = false;
        Object.assign(Player, { vx: run, runState: 'cruise', rampT: 1 });
      };

      // 1) Water kills.
      fresh(false); cruising(18 * T, 18 * T);
      for (let f = 0; f < 120 && !Player.dead; f++) step(Engine.fixedDt);
      assert(Player.dead && Player.y < Level.levelHeight, `falling in the creek should drown Poko (dead ${Player.dead}, y ${Player.y.toFixed(0)})`);

      // Riding the river stream: land Poko on duck `d` (in its own frame).
      const river = () => Entities.list.filter(e => e instanceof DuckStream)[1];
      const landOn = (s, d) => {
        cruising(d.x + 12, s._bobY(d) - Player.h - 2);
        Object.assign(Player, { vy: 120, carry: s.speed });
      };
      // Step until the next duck bounce (or a death / the far bank); returns the duck.
      const nextBounce = (s, pressAtBounce) => {
        for (let f = 0; f < 240; f++) {
          step(Engine.fixedDt);
          if (Player.dead) return 'drowned';
          if (Player.grounded && !Player.surfaceSpeed) return 'bank';
          if (Player.grounded && Player.vy < 0 && Player.surfaceSpeed === s.speed) {
            const feet = Player.y + Player.h;
            const on = s.ducks.find(d => Player.x + Player.w > d.x && Player.x < d.x + s.w && Math.abs(feet - s._bobY(d)) < 4);
            if (pressAtBounce && pressAtBounce(on)) Input.tapKey('Space');
            return on || 'unknown';
          }
        }
        return 'timeout';
      };
      const ahead = (s, d) => s.ducks.filter(o => o.x > d.x).reduce((a, o) => (!a || o.x < a.x ? o : a), null);

      // 2) A duck bounces Poko and hands him the current.
      fresh(); step(0.1);
      let s = river(), d = s.ducks[Math.floor(s.ducks.length / 2)];
      landOn(s, d);
      const hit = nextBounce(s);
      assert(hit === d, `landing on a duck should bounce off it (got ${typeof hit === 'string' ? hit : 'another duck'})`);
      assert(Player.vy <= -Player.duckBounce + 30 && Player.carry === s.speed, `bounce vy ${Player.vy.toFixed(0)}, carry ${Player.carry}`);

      // 3) The rhythm: from each gap size, unpressed and pressed (at the bounce).
      const tryGap = (want, press) => {
        fresh(); step(0.1);
        const s = river();
        const d = s.ducks.find(o => { const n = ahead(s, o); return n && Math.abs(n.x - o.x - want) < 1 && n.x < s.x1 - 200; });
        landOn(s, d);
        const first = nextBounce(s, () => press);
        if (first !== d) return 'missed the first duck';
        const n = ahead(s, d);
        const second = nextBounce(s);
        return second === n ? 'next' : typeof second === 'string' ? second : 'other';
      };
      const small = tryGap(144, false), bigNo = tryGap(296, false), bigYes = tryGap(296, true);
      assert(small === 'next', `a 144px gap should chain with no press (got ${small})`);
      assert(bigNo === 'drowned', `a 296px gap should drown an unpressed hop (got ${bigNo})`);
      assert(bigYes === 'next', `a 296px gap should be cleared by a pressed hop (got ${bigYes})`);

      // 4) Each river crossed end to end, pressing only where the next gap is big.
      const crossings = [];
      for (const [si, bankCol] of [[1, 74], [2, 112]]) {
        fresh(); step(0.1);
        s = Entities.list.filter(e => e instanceof DuckStream)[si];
        d = s.ducks.reduce((a, o) => (o.x < a.x ? o : a));          // the newest, furthest upstream
        landOn(s, d);
        let hops = 0, end = null;
        for (let k = 0; k < 60 && !end; k++) {
          // Press for a big gap; off the last duck, press only if the bank is far.
          const r = nextBounce(s, (on) => {
            const n = on && ahead(s, on);
            return n ? n.x - on.x > 200 : s.x1 - (Player.x + Player.w) > 150;
          });
          if (typeof r === 'string') end = r; else { d = r; hops++; }
        }
        assert(end === 'bank' && Player.x > bankCol * T, `river ${si}: ended '${end}' after ${hops} hops at col ${(Player.x / T).toFixed(1)}`);
        crossings.push(hops);
      }

      // 4b) Boarding off the bank. A jump only lands within ~264px of the edge and
      // the big gap is nearly that wide, so if Poko arrives as it passes the mouth,
      // no jump lands: he turns on the bank and comes back. Sweep arrival times
      // over one whole stream cycle and require that the longest stretch of
      // unboardable arrivals is short enough for one turnaround (≤ 1.2s).
      s = river();
      const cycle = s.gaps.reduce((a, g) => a + g, 0) / s.speed, N = 24;
      const boardable = [];
      for (let phase = 0; phase < N; phase++) {
        let ok = false;
        for (let x = 33 * T; x <= 41 * T && !ok; x += 8) {
          fresh(); step(cycle * phase / N);
          const st = river();
          cruising(31 * T, 21 * T);
          for (let f = 0; Player.x < x && f < 600; f++) step(Engine.fixedDt);
          Input.tapKey('Space');
          ok = typeof nextBounce(st) !== 'string';
        }
        boardable.push(ok);
      }
      let worst = 0;
      for (let p = 0; p < N; p++) {                 // longest run of misses, wrapping round the cycle
        let run = 0;
        while (run < N && !boardable[(p + run) % N]) run++;
        worst = Math.max(worst, run);
      }
      const worstWait = worst * cycle / N;
      assert(worstWait <= 1.2, `boarding: up to ${worstWait.toFixed(2)}s of arrivals can't reach a duck (${boardable.map(b => (b ? 1 : 0)).join('')})`);

      // 5) The drawbridge is a wall while any tin duck stands.
      fresh(); cruising(126 * T, 21 * T);
      step(2);
      assert(Player.x < 137 * T, `got past the raised drawbridge (col ${(Player.x / T).toFixed(1)})`);

      // 6) The gallery: turn at every wall and spin-spray in between.
      fresh(); cruising(121 * T, 21 * T);
      let t = 0, turns = 0, sprays = 0, lastSpray = 0;
      const wallAhead = () => !!Level._tileGrid[Math.floor((Player.x + Player.w / 2 + Player.travelDir * 40) / T) + ',21'];
      for (; t < 40 && !Level.bridgeOpen; t += Engine.fixedDt) {
        if (Player.runState !== 'brake' && wallAhead()) { Input.runDir = -Player.travelDir; Input._swipeEdge = Input.runDir; turns++; }
        else if (t - lastSpray > 0.4 && Player.momentum >= Player.attackThreshold) {
          Input._swipeEdge = Player.travelDir; sprays++; lastSpray = t;
        }
        step(Engine.fixedDt);
      }
      assert(Level.bridgeOpen, `gallery: ${Level.targetsHit}/${Level.targetsTotal} tin ducks down after 40s`);
      const gallery = `${Level.targetsTotal} tin ducks in ${t.toFixed(1)}s (${turns} turns, ${sprays} sprays)`;

      // 7) Lowered, the bridge carries Poko over the lock to the goal.
      Input.runDir = 1; cruising(131 * T, 21 * T);
      for (let f = 0; f < 120 * 8 && !Player.finished && !Player.dead; f++) step(Engine.fixedDt);
      assert(Player.finished, `after the bridge dropped: finished ${Player.finished}, dead ${Player.dead}, col ${(Player.x / T).toFixed(1)}`);
      return `drowns; bounce ${Player.duckBounce}; 144 chains, 296 needs a press; rivers in ${crossings.join(' + ')} hops; boarding blocked ≤${worstWait.toFixed(2)}s per ${cycle.toFixed(1)}s cycle; ${gallery}; bridge → goal`;
    },
    // The Strongman: rolling off the top grabs the hammer with no press, which
    // locks the wheel and drops Poko straight down; the strike is graded by drop
    // height (a short drop doesn't ring and the hammer goes back on its hook, the
    // full drop rings); the camera rides up with the puck; the exit is shut until
    // the bell rings. (The bot plays the whole level in allLevels.)
    async strongman() {
      const i = Level.maps.findIndex(m => m.name === 'The Strongman');
      const T = Level.tileSize, run = Player.runSpeed;
      const fresh = () => { play(i); cleanInput(); Entities.list = Entities.list.filter(e => !(e instanceof PatrolEnemy)); };
      const machine = () => Entities.list.find(e => e instanceof Strongman);
      const cruising = (x, y) => {
        Player.spawn(x, y, 0.01); Player.respawning = false;
        Object.assign(Player, { vx: run, runState: 'cruise', rampT: 1 });
      };

      // 1) Roll off the top edge with no input: grabs, locks, drops straight.
      fresh(); cruising(17 * T, 3 * T);
      const sm = machine();
      let grabX = null, maxDrift = 0, camTop = Infinity;
      for (let f = 0; f < 120 * 12 && sm.state !== 'done' && !(grabX !== null && sm.state === 'hanging'); f++) {
        step(Engine.fixedDt);
        if (sm.state === 'carried') {
          if (grabX === null) grabX = Player.x;
          maxDrift = Math.max(maxDrift, Math.abs(Player.x - grabX));
          assert(Player.vx === 0, `the wheel should lock while hauling (vx ${Player.vx})`);
        }
        if (sm.state === 'flight') camTop = Math.min(camTop, Camera.y);
      }
      assert(grabX !== null, 'rolling off the top never grabbed the hammer');
      assert(maxDrift < 1, `the hammer drop should be straight down (drifted ${maxDrift.toFixed(1)}px)`);
      assert(Level.bellRung && sm.state === 'done', `the full drop should ring the bell (state ${sm.state}, puck top ${sm.puckTop.toFixed(0)})`);
      assert(camTop < sm.bellY + 200, `the camera should ride up to the bell (got to y ${camTop.toFixed(0)}, bell ${sm.bellY})`);
      const fullTop = sm.puckTop;

      // 2) A short drop: weaker, no ring, hammer back on its hook, exit still shut.
      fresh();
      const sm2 = machine();
      Player.spawn(sm2.plateX0 + 8, 30 * T, 0.01); Player.respawning = false;
      sm2._grab();
      for (let f = 0; f < 120 * 8 && sm2.state !== 'hanging'; f++) step(Engine.fixedDt);
      assert(!Level.bellRung && sm2.state === 'hanging', `a 12-tile drop shouldn't ring (rung ${Level.bellRung}, state ${sm2.state})`);
      assert(sm2.puckTop > fullTop + 300, `a shorter drop should hit weaker (puck top ${sm2.puckTop.toFixed(0)} vs ${fullTop.toFixed(0)})`);
      assert(!Player.hauling, 'Poko should let go after a weak strike');

      // 3) The exit is shut until the bell rings.
      const goal = Level.getGoals()[0];
      fresh(); cruising(goal.x - 6 * T, 41 * T);
      for (let f = 0; f < 120 && !Player.finished; f++) step(Engine.fixedDt);
      assert(!Player.finished, 'the exit opened before the bell rang');
      return `straight drop from x ${grabX.toFixed(0)}, full drop puck → ${fullTop.toFixed(0)} (bell ${sm.bellBottom}), short drop → ${sm2.puckTop.toFixed(0)}, no ring; camera reached y ${camTop.toFixed(0)}; exit locked till the ding`;
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
