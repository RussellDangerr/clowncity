// verify/play.js — full-level headless playthrough bot.
//
// Usage (in the running game page, via the preview tools):
//   1) install:  fetch('/verify/play.js').then(r=>r.text()).then(eval)
//   2) run:      JSON.stringify(window.playLevel(0, { lead: 40 }))
//
// Unlike sim.js (Player-only on a scratch map), this steps EVERY registered
// Engine system — Game, Level, Entities, Particles, Player, Camera, Input — on
// the real level, so enemies, platforms, checkpoints, the goal and pit deaths
// are all live. It's synchronous, so the RAF loop can't interleave; afterwards
// the game is parked on level select and the save is restored untouched.
//
// The bot feeds input exactly the way input.js's touch handlers do (tap =
// Jump buffer + _tapped, swipe = runDir + _swipeEdge), so a pass here means
// the level is beatable with the touch input path, not just the keyboard.
//
// Bot knobs:
//   lead       px before a pit edge / wall / enemy at which Bozo "sees" it
//   react      frames between seeing it and the input landing (reaction +
//              tap latency — a tap registers on touchend, not touchstart)
//   wallDelay  frames spent clinging before wall-jumping (18 = 150ms, human-ish)
//   wallMode   'tap' (jump) or 'swipe' (steer away from the wall) to wall-jump
//   attack     'spin' (swipe your heading) or 'jump' for enemies ahead
//   log        include the bot's decisions in the result
//   traceFrom/traceTo  per-frame player state between these times (s)
//   onFrame    callback(frame) after each step (e.g. sample the camera)
(function () {
  const S = () => Level.tileSize;

  // Is there something to roll on in world column `px`, near feet height?
  // A drop of up to `drop` tiles still counts (downhill slopes, small steps).
  function supported(px, feetY, drop) {
    const c = Math.floor(px / S());
    const r0 = Math.floor((feetY - 2) / S());
    for (let r = r0; r <= r0 + drop; r++) if (Level._isSolid(r, c)) return true;
    for (const e of Entities.list) {
      if (!e.getSolidRect) continue;
      const rc = e.getSolidRect();
      if (px >= rc.x && px <= rc.x + rc.w && Math.abs(rc.y - feetY) < 24) return true;
    }
    return false;
  }

  // Square tiles only — a slope ahead is something to ride, not a wall.
  function wallAt(px, bodyY) {
    return !!Level._tileGrid[Math.floor(px / S()) + ',' + Math.floor(bodyY / S())];
  }

  const DEFAULTS = { lead: 40, react: 0, wallDelay: 18, wallMode: 'tap', attack: 'spin' };

  // The bot's brain, shared by playLevel (headless) and watchGame (live).
  // Called once per fixed step while it's free to act; returns what to press
  // ({ kind: 'jump' | 'swipe', dir, why }) or null. st.cling counts steps
  // spent clinging to a wall.
  function think(st, opts) {
    const dir = Player.travelDir;
    const feetY = Player.y + Player.h;
    const front = dir > 0 ? Player.x + Player.w : Player.x;

    if (Player.wallSliding) {
      if (++st.cling < opts.wallDelay) return null;
      st.cling = 0;
      return opts.wallMode === 'swipe'
        ? { kind: 'swipe', dir: -Player.wallContactDir, why: 'wall' }
        : { kind: 'jump', why: 'wall' };
    }
    st.cling = 0;
    if (!Player.grounded) return null;

    // Enemy ahead at roughly our height?
    for (const e of Entities.list) {
      if (!e.getHazardRect || e.dead) continue;
      const r = e.getHazardRect();
      const ahead = dir > 0 ? r.x - front : front - (r.x + r.w);
      if (ahead > 0 && ahead < opts.lead + 24 && Math.abs((r.y + r.h) - feetY) < 28) {
        return opts.attack === 'spin' && Player.momentum >= Player.attackThreshold
          ? { kind: 'swipe', dir, why: 'enemy' }
          : { kind: 'jump', why: 'enemy' };
      }
    }
    // Pit or wall within `lead` px ahead?
    for (let d = 2; d <= opts.lead; d += 2) {
      const px = front + dir * d;
      if (wallAt(px, feetY - 16)) return { kind: 'jump', why: 'wallAhead' };
      if (!supported(px, feetY, 2)) return { kind: 'jump', why: 'pit' };
    }
    return null;
  }

  window.playLevel = function (idx, opts) {
    opts = Object.assign({}, DEFAULTS, { maxSeconds: 120, postSeconds: 3 }, opts);
    const dt = Engine.fixedDt;
    const saved = {
      raw: (() => { try { return localStorage.getItem('clowncity_save'); } catch (e) { return null; } })(),
      save: JSON.parse(JSON.stringify(Game.save)),
      muted: Audio.muted,
    };
    Audio.muted = true;
    Input.keys = {}; Input.justPressed = {}; Input.buffer = {};
    Input.runDir = 1;
    Game.transitionDir = 0; Game.transitionAlpha = 0;
    Game.state = 'playing';
    Game.loadLevel(idx);

    const queue = [];            // [{at, kind, dir}]
    const deaths = [];
    const st = { cling: 0 };
    let cooldown = 0, lastGroundX = Player.x;
    let wasDead = false, result = 'timeout', frame = 0, goalFrame = -1, deathsAtGoal = 0;
    const maxFrames = Math.round(opts.maxSeconds / dt);

    const decisions = [], trace = [];
    const schedule = (kind, dir, why) => {
      if (decisions.length < 200) decisions.push({
        t: +(frame * dt).toFixed(2), kind, why,
        x: Math.round(Player.x), col: +(Player.x / S()).toFixed(1), row: +(Player.y / S()).toFixed(1),
        vx: Math.round(Player.vx), slope: Player.onSlope, dir: Player.travelDir,
      });
      queue.push({ at: frame + opts.react, kind, dir });
      cooldown = Math.max(opts.react, 1) + 12;   // one decision per obstacle
    };

    function decide() {
      if (Player.dead || cooldown > 0 || goalFrame >= 0) return;   // hands off after the goal
      const a = think(st, opts);
      if (a) schedule(a.kind, a.dir, a.why);
    }

    try {
      for (frame = 0; frame < maxFrames; frame++) {
        if (cooldown > 0) cooldown--;
        decide();
        // Deliver due inputs exactly like input.js's touch handlers.
        for (let i = queue.length - 1; i >= 0; i--) {
          const q = queue[i];
          if (q.at > frame) continue;
          if (q.kind === 'jump') { Input.buffer.Jump = Input.bufferTime; Input._jumpDown = true; Input._tapped = true; }
          if (q.kind === 'swipe') { Input.runDir = q.dir; Input._swipeEdge = q.dir; }
          queue.splice(i, 1);
        }
        for (const sys of Engine.systems) if (sys.update) sys.update(dt);
        if (opts.onFrame) opts.onFrame(frame);

        if (opts.traceFrom != null && frame * dt >= opts.traceFrom && frame * dt <= opts.traceTo) {
          trace.push(`${(frame * dt).toFixed(3)} x${Player.x.toFixed(0)} y${Player.y.toFixed(0)} vx${Player.vx.toFixed(0)} vy${Player.vy.toFixed(0)}` +
            ` g${+Player.grounded} wd${Player.wallDir} td${Player.travelDir} sl${+Player.wallSliding} lock${Player.wallJumpLockTimer.toFixed(2)} ${Player.runState}`);
        }
        if (Player.grounded) lastGroundX = Player.x;
        if (Player.dead && !wasDead) {
          deaths.push({
            t: +(frame * dt).toFixed(2),
            col: Math.floor((Player.x + Player.w / 2) / S()), row: Math.floor((Player.y + Player.h / 2) / S()),
            fromCol: Math.floor(lastGroundX / S()),
            pit: Player.y > Level.levelHeight,
          });
        }
        wasDead = Player.dead;

        if (goalFrame < 0 && (Game.state === 'levelComplete' || Game.state === 'tentFinale')) {
          goalFrame = frame; result = 'goal'; deathsAtGoal = deaths.length;
        }
        if (goalFrame >= 0 && frame - goalFrame >= opts.postSeconds / dt) break;
        if (deaths.length >= 12) { result = 'stuck (12 deaths)'; break; }
      }
      return {
        level: Level.maps[idx].name, result,
        time: goalFrame >= 0 ? +(goalFrame * dt).toFixed(2) : null,
        deaths: goalFrame >= 0 ? deathsAtGoal : deaths.length, deathLog: deaths, decisions: opts.log ? decisions : undefined, trace: trace.length ? trace : undefined,
        gems: `${Level.collectedCount}/${Level.totalCollectibles}`,
        afterGoal: goalFrame >= 0 ? {
          state: Game.state, diedAfterGoal: deaths.length > deathsAtGoal,
          col: Math.floor(Player.x / S()), row: Math.floor(Player.y / S()),
          x: +Player.x.toFixed(2), y: +Player.y.toFixed(2), vx: +Player.vx.toFixed(2),
          grounded: Player.grounded, finished: !!Player.finished, hidden: !!Player.hidden,
          offscreenBelow: Player.y > Level.levelHeight,
        } : null,
        stuckAt: result === 'goal' ? null : { col: Math.floor(Player.x / S()), row: Math.floor(Player.y / S()), vx: +Player.vx.toFixed(1) },
      };
    } finally {
      Game.save = saved.save;
      try { if (saved.raw == null) localStorage.removeItem('clowncity_save'); else localStorage.setItem('clowncity_save', saved.raw); } catch (e) {}
      Input.keys = {}; Input.justPressed = {}; Input.buffer = {}; Input.runDir = 1;
      Game.state = 'levelSelect'; Game.timer = 0;
      setTimeout(() => { Audio.muted = saved.muted; }, 600);   // let queued finale tones fire muted
    }
  };

  // ── Live play through the REAL on-screen deck ──
  // Presses ◀ ▶ JUMP with pointer events — a thumb, as far as the page can
  // tell — from a system inserted before Game, so it runs every fixed step of
  // whatever is stepping the engine: the live loop (watch it in a visible
  // pane) or a harness stepping by hand. Plays every level from level select,
  // continues past LEVEL COMPLETE and the win screen like a player, restores
  // the save, and resolves { levels: [{ level, time, deaths }] }.
  // Needs deck mode (touch device held upright, or Layout.force = 'deck').
  // onEvent(name, info) fires on 'start', 'wallJump', 'launch', 'goal', 'win'.
  window.watchGame = function (opts) {
    opts = Object.assign({}, DEFAULTS, { lead: 24, holdSteps: 10, pauseOnScreens: 1.5, onEvent: () => {} }, opts);
    const el = id => document.getElementById(id);
    const raw = (() => { try { return localStorage.getItem('clowncity_save'); } catch (e) { return null; } })();
    const savedSave = JSON.parse(JSON.stringify(Game.save));
    const st = { cling: 0, started: -1, won: false };
    const releases = [];                         // [{ id, at }]
    const levels = [];
    let step = 0, cooldown = 0, current = -1;

    const press = (id, hold = opts.holdSteps) => {
      el(id).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true }));
      releases.push({ id, at: step + hold });
    };

    let finish;
    const done = new Promise(r => { finish = r; });
    const driver = {
      update() {
        step++;
        for (let i = releases.length - 1; i >= 0; i--) {
          if (releases[i].at > step) continue;
          el(releases[i].id).dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'touch' }));
          releases.splice(i, 1);
        }
        if (Game.transitionDir !== 0) return;              // mid-fade: nothing to press
        if (cooldown > 0) cooldown--;

        if (Game.state === 'levelSelect') {
          if (current === -1) { Game._selectedLevel = 0; current = 0; press('btn-jump'); }
          else if (levels.length === Game.totalLevels) stop();
        } else if (Game.state === 'playing') {
          if (Game.currentLevel !== current || levels.length > current) return;
          if (st.started !== current) { st.started = current; opts.onEvent('start', { level: Level.maps[current].name }); }
          if (Player.dead || cooldown > 0) return;
          const a = think(st, opts);
          if (!a) return;
          if (a.why === 'wall') opts.onEvent('wallJump', { col: Math.floor(Player.x / 32) });
          if (Player.overspeed > 0.4) opts.onEvent('launch', { vx: Math.round(Player.vx) });
          press(a.kind === 'jump' ? 'btn-jump' : (a.dir > 0 ? 'btn-right' : 'btn-left'), a.kind === 'jump' ? opts.holdSteps : 2);
          cooldown = 13;
        } else if (Game.state === 'levelComplete') {
          if (levels.length === current) {
            levels.push({ level: Level.maps[current].name, time: +Game.levelTimer.toFixed(2), deaths: Player.deathCount });
            opts.onEvent('goal', levels[levels.length - 1]);
          }
          if (Game.timer > opts.pauseOnScreens && !releases.length) { current++; press('btn-jump'); }
        } else if (Game.state === 'win') {
          if (!st.won) { st.won = true; opts.onEvent('win', { levels }); }
          if (Game.timer > opts.pauseOnScreens + 1 && !releases.length) press('btn-jump');
        }
      },
    };

    function stop() {
      const i = Engine.systems.indexOf(driver);
      if (i >= 0) Engine.systems.splice(i, 1);
      Game.save = savedSave;
      try { if (raw == null) localStorage.removeItem('clowncity_save'); else localStorage.setItem('clowncity_save', raw); } catch (e) {}
      finish({ levels });
    }

    Engine.systems.unshift(driver);
    Game.transitionDir = 0; Game.transitionAlpha = 0;
    Game.state = 'levelSelect';
    Input.keys = {}; Input.justPressed = {}; Input.buffer = {}; Input.runDir = 1;
    return { done, stop };
  };
})();
