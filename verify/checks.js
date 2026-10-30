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
      Game.save.levels = {};                              // nothing beaten: every level after the first is locked
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
      const ramp = Level.ramps[Level.ramps.length - 1];                   // the big one (the kicker at jump 3 comes first)
      const bowl = ramp.pts.reduce((a, p) => (p.y > a.y ? p : a));        // lowest point
      const ride = (pressAt) => {
        play(i); cleanInput();
        Player.spawn(ramp.x0 - 8 * Level.tileSize, ramp.pts[0].y - Player.h, 0.01);   // cruising on the final plateau
        Player.respawning = false;
        Object.assign(Player, { vx: Player.runSpeed, runState: 'cruise', rampT: 1 });
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

      // Put horse h with its left edge at x, at bob phase θ (0 = lowest, π = top),
      // and drop Poko onto its back from just above.
      const horseAt = (h, x, theta) => {
        h.x = x; h.t = (((theta - h.phase) / (2 * Math.PI)) * h.period % h.period + h.period) % h.period;
        h.y = h._bobY(); h.prevY = h.y;
      };
      const dropOn = (h) => {
        Player.spawn(h.x + 4, h.y - Player.h - 4, 0.01); Player.respawning = false;
        Object.assign(Player, { vx: run, runState: 'cruise', rampT: 1, vy: 60, carry: S });
      };
      const horse = () => Entities.list.find(e => e instanceof CarouselHorse);
      // Step until Poko bounces (grounded and going up); optionally press right then.
      const bounce = (press) => {
        for (let f = 0; f < 60; f++) {
          step(Engine.fixedDt);
          if (Player.grounded && Player.vy < 0) { if (press) Input.tapKey('Space'); return true; }
        }
        return false;
      };

      // 3) A horse bounces Poko and hands him the deck's carry.
      fresh(); step(0.1);
      const h = horse(); horseAt(h, 50 * T, Math.PI); dropOn(h);
      assert(bounce(false), 'landing on a horse should bounce');
      assert(Player.carry === S && Player.vy <= -Player.duckBounce + 30, `horse bounce: vy ${Player.vy.toFixed(0)}, carry ${Player.carry}`);

      // Sweep takeoff points; true if any try from `setup` grabs `ring`.
      const tries = (setup, xs, ring) => xs.some(x => {
        setup(x);
        for (let f = 0; f < 150 && !Player.dead; f++) step(Engine.fixedDt);
        return ring.collected;
      });
      const xsNear = (col, from, to) => { const a = []; for (let d = from; d <= to; d += 6) a.push(col * T + d); return a; };
      const fromDeck = (x) => {                 // cruising on the deck with the spin, jump at x
        deckAt(Math.floor(x / T) - 8); step(0.6);
        for (let f = 0; Player.x < x && f < 1200; f++) step(Engine.fixedDt);
        Input.tapKey('Space');
      };
      const fromHorse = (theta, press) => (x) => { fresh(); step(0.05); const h = horse(); horseAt(h, x, theta); dropOn(h); bounce(press); };
      const fromRoof = (x) => {                 // rolling along the booth roof, jump at x
        fresh(); Player.spawn(96 * T, 17 * T - Player.h, 0.01); Player.respawning = false;
        Object.assign(Player, { vx: run, runState: 'cruise', rampT: 1 });
        step(Engine.fixedDt * 2);
        for (let f = 0; Player.x < x && f < 1200; f++) step(Engine.fixedDt);
        Input.tapKey('Space');
      };
      const ringA = () => Level.rings.find(r => r.x === 20 * T);
      const ringC = () => Level.rings.find(r => r.x === 110 * T);
      const rider = () => Entities.list.find(e => e.ring);
      assert(tries(fromDeck, xsNear(20, -320, 0), { get collected() { return ringA().collected; } }), 'ring A: no deck jump reaches it');

      // Ring B rides horse 3. A pressed bounce off its back grabs it from any
      // height of the bob and anywhere on the back; a deck jump tops out under it.
      let ringBMisses = [];
      for (const theta of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
        for (const at of [-10, 20, 44, 64]) {    // back edge to front edge (he rolls 400px/s while he drops)
          fresh(); step(0.05);
          const h = rider(); horseAt(h, 50 * T, theta); h._placeRing();
          Player.spawn(h.x + at, h.y - Player.h - 1, 0.01); Player.respawning = false;   // 1px up: a longer drop rolls him off the front
          Object.assign(Player, { vx: run, runState: 'cruise', rampT: 1, vy: 60, carry: S });
          bounce(true);
          for (let f = 0; f < 120 && !h.ring.collected; f++) step(Engine.fixedDt);
          if (!h.ring.collected) ringBMisses.push(`θ ${theta.toFixed(2)} at ${at}`);
        }
      }
      assert(!ringBMisses.length, `ring B: pressed bounces off its horse missed it (${ringBMisses.join(', ')})`);
      deckAt(40); step(0.6);
      let deckTop = Infinity;
      Input.tapKey('Space');
      for (let f = 0; f < 90; f++) { step(Engine.fixedDt); deckTop = Math.min(deckTop, Player.y); }
      const rb = rider().ring;
      assert(deckTop > rb.y + rb.h - 4, `ring B: a deck jump reaches its catch area (top ${deckTop.toFixed(0)} vs ${rb.y + rb.h - 4})`);

      assert(!tries(fromHorse(Math.PI, true), xsNear(110, -320, 0), { get collected() { return ringC().collected; } }), 'ring C: a horse bounce reaches it (it should need the booth roof)');
      assert(tries(fromRoof, xsNear(110, -360, -60), { get collected() { return ringC().collected; } }), 'ring C: no jump off the booth roof reaches it');

      // 4) A pressed bounce off a horse mid-bob lands on the booth roof.
      const roofY = 17 * T;
      const landsOnRoof = xsNear(88, -400, 0).some(x => {
        fromHorse(Math.PI / 2, true)(x);
        for (let f = 0; f < 120; f++) {
          step(Engine.fixedDt);
          if (Player.grounded && Math.abs(Player.y + Player.h - roofY) < 1) return true;
        }
        return false;
      });
      assert(landsOnRoof, 'no pressed bounce off a horse mid-bob lands on the booth roof');

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
      return `with spin ${withSpin.toFixed(0)}, against ${against.toFixed(0)} px/s; seam smooth (cam ≤${maxCam.toFixed(1)}px/frame); ring A from the deck, B off its horse at any bob height, C off the roof; exit locks`;
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
        fresh();
        const s = river();
        let d;
        for (let k = 0; k < 100 && !d; k++) {         // wait for that gap to be on the water
          step(0.1);
          d = s.ducks.find(o => { const n = ahead(s, o); return n && Math.abs(n.x - o.x - want) < 1 && o.x > s.x0 + 24 && n.x < s.x1 - 88; });
        }
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
      for (const [si, bankCol] of [[1, 58], [2, 83], [3, 112]]) {
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
    // The Strongman: going off the top grabs the hammer; DOWN slams it straight
    // down, graded by the height he pressed from. Slamming at the top of a pumped
    // bounce rings the bell and pays out its gem, the camera riding up with the
    // puck; never pressing is a thud. Whatever happens he ends up standing by the
    // plate: right is the open exit, left flings him back to the top with the hammer
    // re-hung. (The bot plays the whole level in allLevels.)
    async strongman() {
      const i = Level.maps.findIndex(m => m.name === 'The Strongman');
      const T = Level.tileSize, run = Player.runSpeed;
      const fresh = () => { play(i); cleanInput(); Entities.list = Entities.list.filter(e => !(e instanceof PatrolEnemy)); };
      const machine = () => Entities.list.find(e => e instanceof Strongman);
      const cruising = (x, y) => {
        Player.spawn(x, y, 0.01); Player.respawning = false;
        Object.assign(Player, { vx: run, runState: 'cruise', rampT: 1 });
      };
      // Off the top heading for the hammer; jump at x (or roll off if null), press
      // as he lands on the trampoline if pump, and slam: 'now' as soon as he has the
      // hammer, 'top' at the top of the arc, 'late' well into the fall, or not at
      // all. Steps until the machine settles; reports what happened.
      const goFor = (jumpAt, pump, slam = 'top') => {
        fresh();
        Player.setCheckpoint(6 * T, 3 * T);                 // as if he passed the top flag
        cruising(jumpAt === null ? 21.5 * T : 6 * T, 3 * T);
        const sm = machine();
        let grabX = null, slamX = null, maxDrift = 0, camTop = Infinity, jumped = jumpAt === null;
        for (let f = 0; f < 120 * 12 && sm.state !== 'open'; f++) {
          if (!jumped && Player.x >= jumpAt) { Input.tapKey('Space'); jumped = true; }
          if (pump && Player.trampDrop > 0) Input.tapKey('Space');
          if (Player.hauling && Player.slamFrom === null && (slam === 'now' || (slam === 'top' && Player.vy >= 0) ||
              (slam === 'late' && Player.y > 8 * T))) Input.tapKey('ArrowDown');
          step(Engine.fixedDt);
          if (sm.state === 'carried') {
            if (grabX === null) grabX = Player.x;
            if (Player.slamFrom !== null) {
              if (slamX === null) slamX = Player.x;
              maxDrift = Math.max(maxDrift, Math.abs(Player.x - slamX));
            }
          }
          if (sm.state === 'flight') camTop = Math.min(camTop, Camera.y);
        }
        return { sm, grabX, maxDrift, camTop };
      };

      // 1) Roll off and slam at once: grabs, drops straight, a weak hit, and Poko
      //    stands by the plate.
      const roll = goFor(null, false, 'now');
      assert(roll.grabX !== null, 'rolling off the top never grabbed the hammer');
      assert(roll.maxDrift < 1, `the hammer drop should be straight down (drifted ${roll.maxDrift.toFixed(1)}px)`);
      assert(!Level.bellRung, `rolling off shouldn't ring the bell (puck top ${roll.sm.puckTop.toFixed(0)}, bell ${roll.sm.bellBottom})`);
      assert(roll.sm.state === 'open' && !Player.hauling && Player.parked, `after a weak hit Poko should stand by the plate (state ${roll.sm.state}, parked ${Player.parked})`);
      const rollHeight = roll.sm.puckRest - roll.sm.puckTop;
      // Left at the tower wall: flung back to the top floor, the hammer on its hook.
      Input.tapKey('ArrowLeft');
      for (let f = 0; f < 120 * 4 && !(roll.sm.state === 'hanging' && !Player.flung); f++) step(Engine.fixedDt);
      assert(roll.sm.state === 'hanging' && !Player.dead && Math.abs(Player.y + Player.h - 4 * T) < 12, `going left should fling him to the top with the hammer back (state ${roll.sm.state}, row ${(Player.y / T).toFixed(1)})`);
      for (let f = 0; f < 60; f++) step(Engine.fixedDt);
      assert(!Player.dead && Player.vx > 300 && Math.abs(Player.y + Player.h - 4 * T) < 12, `he should roll on along the top floor (vx ${Player.vx.toFixed(0)}, row ${(Player.y / T).toFixed(1)})`);

      // 1b) The grades: higher is harder, only the pumped bounce rings, pressing
      //     late throws height away, and never pressing doesn't swing at all.
      const height = (r) => r.sm.puckRest - r.sm.puckTop;
      const jumpOff = goFor(11 * T, false);          // jump, unpressed bounce, slam at the top of it
      assert(!Level.bellRung, 'an unpressed bounce should not ring the bell');
      assert(height(jumpOff) > rollHeight + 200, `a bounce should hit clearly harder than a roll (${height(jumpOff).toFixed(0)} vs ${rollHeight.toFixed(0)})`);
      const late = goFor(11 * T, false, 'late');
      assert(height(late) < rollHeight, `a late slam should be weaker than slamming at the edge (${height(late).toFixed(0)} vs ${rollHeight.toFixed(0)})`);
      const never = goFor(11 * T, false, null);
      assert(!Level.bellRung && never.sm.puckTop === never.sm.puckRest, 'never pressing down should not launch the puck');

      // 2) Jump onto the trampoline and press as you land: rings, with the camera
      //    riding up to the bell. Any jump that lands on the bed works.
      let rang = 0, camTop = Infinity, ringTop = null;
      const takeoffs = [8, 9, 10, 11, 12];
      for (const col of takeoffs) {
        const r = goFor(col * T, true);
        if (Level.bellRung && r.sm.state === 'open') { rang++; camTop = Math.min(camTop, r.camTop); ringTop = r.sm.puckTop; }
      }
      assert(rang === takeoffs.length, `a pumped trampoline bounce should ring every time (rang ${rang}/${takeoffs.length})`);
      assert(Level.collectibles.some(g => g.collected && g.y < machine().bellY), 'the bell should pay out its gem');
      assert(camTop < machine().bellY + 200, `the camera should ride up to the bell (got to y ${camTop.toFixed(0)})`);

      // 3) The exit is open without the bell.
      const goal = Level.getGoals()[0];
      fresh(); cruising(goal.x - 6 * T, 41 * T);
      for (let f = 0; f < 120 && !Player.finished; f++) step(Engine.fixedDt);
      assert(Player.finished, 'the exit should be open without ringing the bell');
      return `puck height late ${height(late).toFixed(0)}, roll ${rollHeight.toFixed(0)}, jump ${height(jumpOff).toFixed(0)}, no ring, back at the top; left flings him back up; pumped bounce rings ${rang}/${takeoffs.length} and pays its gem; camera reached y ${camTop.toFixed(0)}; exit open without the bell`;
    },
    // DOWN stops the wheel dead; a steer rolls on. On the ground he stays put and
    // can hop straight up; in the air he drops straight down; the spray kills;
    // a duck or the carousel deck keeps carrying him.
    async stopDead() {
      const T = Level.tileSize;
      const cruise = (i, col, row) => {
        play(i); cleanInput();
        Entities.list = Entities.list.filter(e => !(e instanceof PatrolEnemy));
        Player.spawn(col * T, row * T, 0.01); Player.respawning = false;
        Object.assign(Player, { vx: Player.runSpeed, runState: 'cruise', rampT: 1 });
      };
      cruise(0, 4, 21); step(0.2);
      Input.tapKey('ArrowDown'); step(0.1);
      assert(Player.parked && Player.vx === 0, `down should stop the wheel (vx ${Player.vx})`);
      let x = Player.x;
      step(1);
      assert(Player.x === x, `a stopped Poko should stay put (moved ${(Player.x - x).toFixed(1)}px)`);
      Input.tapKey('Space'); step(0.2);
      assert(!Player.grounded && Player.x === x, 'a stopped Poko should hop straight up');
      step(1);
      Input.tapKey('ArrowRight'); step(0.8);
      assert(!Player.parked && Math.abs(Player.vx - Player.runSpeed) < 1, `a steer should roll him on (vx ${Player.vx.toFixed(0)})`);
      Input.tapKey('ArrowDown'); step(0.1);
      Input.tapKey('ArrowLeft'); step(0.2);
      assert(Player.travelDir === -1 && Player.vx < -100, `steering the other way from a stop should go that way (vx ${Player.vx.toFixed(0)})`);

      cruise(0, 4, 21); step(0.2);
      Input.tapKey('Space'); step(0.2);
      x = Player.x;
      Input.tapKey('ArrowDown');
      let t = 0;
      for (; t < 2 && !Player.grounded; t += Engine.fixedDt) step(Engine.fixedDt);
      assert(Player.grounded && Math.abs(Player.x - x) < 8, `a slam should drop straight down (drifted ${(Player.x - x).toFixed(1)}px)`);

      // The confetti kills what's beside him.
      play(0); cleanInput();
      const patrol = Entities.list.find(e => e instanceof PatrolEnemy);
      Entities.list = Entities.list.filter(e => e === patrol);
      const r = patrol.getHazardRect();
      Player.spawn(r.x - 70, r.y + r.h - Player.h, 0.01); Player.respawning = false;
      step(0.05);
      Input.tapKey('ArrowDown');
      for (let f = 0; f < 60 && !patrol.dead; f++) step(Engine.fixedDt);
      assert(patrol.dead && !Player.dead, `the down spray should kill a patrol beside him (killed ${patrol.dead}, Poko dead ${Player.dead})`);

      // A duck carries a stopped Poko; so does the deck.
      const duck = Level.maps.findIndex(m => m.name === 'The Duck River');
      play(duck); cleanInput(); step(0.1);
      const s = Entities.list.filter(e => e instanceof DuckStream)[1];
      const d = s.ducks.reduce((a, o) => (o.x < a.x ? o : a));
      Player.spawn(d.x + 12, s._bobY(d) - Player.h - 2, 0.01); Player.respawning = false;
      Object.assign(Player, { vy: 120, carry: s.speed });
      Input.tapKey('ArrowDown'); step(1);
      assert(!Player.dead && Player.x + Player.w > d.x && Player.x < d.x + s.w, `a stopped Poko should ride his duck (Poko ${Player.x.toFixed(0)}, duck ${d.x.toFixed(0)})`);
      const carousel = Level.maps.findIndex(m => m.name === 'The Carousel');
      cruise(carousel, 40, 21); step(0.3);
      Input.tapKey('ArrowDown'); step(0.3);
      x = Player.x; step(1);
      assert(Math.abs(Player.x - x - Level.deckSpeed) < 2, `the deck should carry a stopped Poko (${(Player.x - x).toFixed(0)}px/s)`);

      // The deck's button is the same press.
      cruise(0, 4, 21); step(0.2);
      press(document.getElementById('btn-down'));
      assert(Player.parked, 'the deck button should stop him');
      return 'stops, stays, hops straight up, rolls either way; slam drops straight; spray kills; rides a duck and the deck; deck button works';
    },
    // Saves are keyed by level name. An old save (arrays by position, as v0.4–v0.6
    // write it) moves onto names once and is rewritten in the new format; a
    // beaten level never locks again even if a level is put ahead of it; junk
    // and corrupt saves load as empty.
    async saveMigration() {
      const load = (raw) => {
        if (raw == null) localStorage.removeItem('clowncity_save'); else localStorage.setItem('clowncity_save', raw);
        Game.loadSave();
      };
      // 1) A live-site save: Big Top and Catwalk beaten, Big Drop not.
      load(JSON.stringify({ levelsComplete: [true, true, false], bestDeaths: [2, 5, -1], gemsCollected: [7, 4, 0], totalGemsPerLevel: [9, 7, 2] }));
      const L = Game.save.levels;
      assert(L['The Big Top'].complete && L['The Big Top'].bestDeaths === 2 && L['The Big Top'].gems === 7 && L['The Big Top'].totalGems === 9, `Big Top migrated wrong: ${JSON.stringify(L['The Big Top'])}`);
      assert(L['The Catwalk'].complete && L['The Catwalk'].bestDeaths === 5 && L['The Catwalk'].gems === 4, `Catwalk migrated wrong: ${JSON.stringify(L['The Catwalk'])}`);
      assert(!L['The Big Drop'].complete && L['The Big Drop'].bestDeaths === -1, `Big Drop migrated wrong: ${JSON.stringify(L['The Big Drop'])}`);
      const written = JSON.parse(localStorage.getItem('clowncity_save'));
      assert(written.version === 2 && written.levels && !written.levelsComplete, 'the migrated save should be rewritten in the new format');
      const idx = (name) => Level.maps.findIndex(m => m.name === name);
      assert(Game.levelUnlocked(idx('The Strongman')), 'the level after the beaten Big Top should be unlocked');
      assert(!Game.levelUnlocked(idx('The Duck River')), 'the Duck River should be locked until the Strongman is beaten');
      assert(!Game.levelUnlocked(idx('The Big Drop')), 'the Big Drop (now the finale) should be locked: it and the level before it are unbeaten');

      // 2) The new format round-trips, and a beaten level stays open with its predecessor unbeaten.
      load(JSON.stringify({ version: 2, levels: { 'The Strongman': { complete: true, bestDeaths: 0, gems: 12, totalGems: 12 } } }));
      assert(Game.save.levels['The Strongman'].gems === 12, 'a v2 save should load as written');
      assert(Game.levelUnlocked(idx('The Strongman')), 'a beaten level should never lock, even with the one before it unbeaten');
      assert(!Game.levelUnlocked(idx('The Carousel')), 'an unbeaten level behind an unbeaten one should stay locked');

      // 3) Junk: corrupt JSON, wrong types, and no save at all all load as empty.
      for (const raw of ['{not json', JSON.stringify({ levelsComplete: 'yes', levels: 3 }), JSON.stringify(null), null]) {
        load(raw);
        assert(Object.keys(Game.save.levels).length === 0 && Game.levelUnlocked(0) && !Game.levelUnlocked(1), `junk save ${String(raw).slice(0, 20)} should load as empty`);
      }
      load(JSON.stringify({ version: 2, levels: { 'The Big Top': { complete: 'yes', bestDeaths: 'x' } } }));
      assert(Game.save.levels['The Big Top'].complete === false && Game.save.levels['The Big Top'].bestDeaths === -1, 'bad fields in a record should fall back to defaults');
      return 'old position arrays → names (Big Top 2 deaths/7 gems, Catwalk, Big Drop), rewritten as v2; beaten levels never relock; junk loads empty';
    },
    // Winnable from the spawn point, the way a careful player plays (verify/
    // solve.js: looks ahead before each press, only takes jumps with ≥ 0.1s
    // of slack, turns to wait otherwise). Each level is run at several
    // timings of its moving parts, so no win depends on luck.
    async fullRuns() {
      const out = [];
      for (const name of ['The Carousel', 'The Duck River']) {
        const times = [];
        for (const warp of [0, 1.2, 2.4, 3.6]) {
          const r = solveLevel(name, { warp, maxSeconds: 75 });
          assert(r.result === 'goal', `${name} (warp ${warp}): ${r.result} after ${r.time}s, rings ${r.rings}, targets ${r.targets}`);
          times.push(`${r.time}s${r.deaths.length ? `/${r.deaths.length}✝` : ''}`);
        }
        out.push(`${name}: ${times.join(' ')}`);
      }
      return out.join(' · ');
    },
    // The Big Drop's jumps: falling short at jump 1 or 3 bounces Poko back up onto
    // the next ledge; every pit is a net or water with nothing to get stuck on; a
    // trapeze holds him until he lets go, and a forward swing throws him across;
    // a fall at jump 4 only costs jump 4; and the whole level ends in the tent.
    async bigDropJumps() {
      const i = Level.maps.findIndex(m => m.name === 'The Big Drop');
      const T = Level.tileSize;
      const cruise = (col, row) => {
        play(i); cleanInput();
        Player.spawn(col * T, row * T, 0.01); Player.respawning = false;
        Object.assign(Player, { vx: Player.runSpeed, runState: 'cruise', rampT: 1 });
      };
      const feetRow = () => (Player.y + Player.h) / T;
      const afterBounce = () => {
        let bounced = false;
        for (let f = 0; f < 600; f++) {
          step(Engine.fixedDt);
          if (Player.dead) return 'died';
          if (!bounced && Player.grounded && Player.trampDrop > 0) { bounced = true; continue; }
          if (bounced && Player.grounded && Player.vy >= 0) return feetRow();
        }
        return 'timeout';
      };
      cruise(8, 7);
      const fallJ1 = afterBounce();
      assert(fallJ1 === 12, `falling short at jump 1 should bounce him onto ledge 1 (row 12), got ${fallJ1}`);
      cruise(82, 14);
      const fallJ3 = afterBounce();
      assert(fallJ3 === 18, `falling into jump 3's pit should bounce him onto ledge 3 (row 18), got ${fallJ3}`);
      const net = () => Entities.list.filter(e => e instanceof Trampoline);
      for (const n of net()) {
        const col = Math.floor(n.x / T), row = Math.floor(n.y / T) + 1;
        assert(Level._isSolid(row, col), `the net at col ${col} should have solid right under it`);
      }

      // Rolling off each ledge ends in a net's bounce or in water, never on a floor.
      for (const [col, row] of [[46, 11], [94, 17]]) {
        cruise(col, row);
        for (let f = 0; f < 240 && !Player.dead; f++) step(Engine.fixedDt);
        assert(Player.dead, `rolling off the ledge at col ${col} should end in the water (row ${feetRow().toFixed(1)})`);
      }

      // The trapeze: catch from a jump, hang on, throw across from the forward swing.
      const bars = () => Entities.list.filter(e => e instanceof Trapeze);
      const trial = (ledgeCol, ledgeRow, farRow, delay, barIndex) => {
        cruise(ledgeCol, ledgeRow);
        Entities.update(0);
        for (const b of bars()) { b.t = delay; b._place(); }
        let jumped = false, caught = false;
        const edge = barIndex === 0 ? 51 : 99;
        for (let f = 0; f < 120 * 6; f++) {
          if (!jumped && Player.x + Player.w >= (edge - 1.5) * T) { Input.tapKey('Space'); jumped = true; }
          if (Player.swinging) {
            caught = true;
            if (Player.swinging.barSpeed > 150) Input.tapKey('Space');
          }
          step(Engine.fixedDt);
          if (Player.dead) return { caught, end: 'drowned' };
          if (Player.grounded && jumped && !Player.trampDrop && Player.x > edge * T) return { caught, end: feetRow() };
          if (Player.grounded && Player.x > edge * T + 800) break;
        }
        return { caught, end: 'timeout' };
      };
      const N = 12;
      let caught = 0, across = 0;
      for (let k = 0; k < N; k++) {
        const r = trial(44, 11, 15, 2.4 * k / N, 0);
        if (r.caught) caught++;
        if (r.end === 15) across++;
      }
      assert(caught >= N * 0.75, `a jump off ledge 1 should catch the trapeze at most moments (${caught}/${N})`);
      assert(across >= N * 0.75, `a forward release should reach ledge 2 (${across}/${N})`);

      // Hanging on is safe, for as long as you like.
      cruise(44, 11);
      for (let f = 0; f < 120 * 8 && !Player.swinging && !Player.dead; f++) {
        if (Player.x + Player.w >= 49.5 * T && Player.grounded) Input.tapKey('Space');
        step(Engine.fixedDt);
      }
      if (Player.swinging) { step(6); assert(Player.swinging && !Player.dead, 'hanging on should be safe'); }

      // Jump 4: pass ledge 3's flag, fall in, come back at ledge 3.
      cruise(90, 17);
      for (let f = 0; f < 600 && !Player.dead; f++) step(Engine.fixedDt);
      assert(Player.dead, 'rolling off ledge 3 with no jump should fall in the water');
      for (let f = 0; f < 120 && Player.dead; f++) step(Engine.fixedDt);
      assert(Math.abs(Player.x - 92 * T) < T, `should respawn at ledge 3's flag (col ${(Player.x / T).toFixed(1)})`);
      return `nets bounce back to rows 12 and 18; no floors to get stuck on; trapeze caught ${caught}/${N}, forward throw across ${across}/${N}; J4 fall → back at J4`;
    },
    // ── checks added by later tasks go here, in task order ──
  };

  window.runChecks = async function (names) {
    if (!window.playLevel) await fetch('/verify/play.js').then(r => r.text()).then(eval);
    if (!window.solveLevel) await fetch('/verify/solve.js').then(r => r.text()).then(eval);
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
