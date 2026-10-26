// verify/solve.js — look-ahead playthroughs for levels the pit-jumping bot
// (play.js) can't read: rings to chase, duck rhythm, a gallery to spray.
//
// Usage (in the running game page, via the preview tools):
//   1) install:  fetch('/verify/solve.js').then(r=>r.text()).then(eval)
//   2) run:      JSON.stringify(window.solveLevel('The Carousel'))
//      opts.warp (s) advances the moving parts (horses, ducks, patrols) before
//      Poko sets off, so runs meet them at different moments.
//
// Like play.js it steps every Engine system on the real level from the spawn
// point, and it feeds input the way input.js's touch handlers do (tap = Jump
// buffer, swipe = runDir + _swipeEdge). The difference is how it decides: at
// each frame it copies the whole game state, tries "press now" in a sandbox
// for up to `horizon` seconds, then restores. A press is only taken if the
// sandbox shows it doing something the level's policy wants (not dying, a ring,
// a horse, the far bank...).
//
// To be fair to humans it doesn't press at the first frame that works: it
// keeps scanning until the press stops working and presses in the MIDDLE of
// that run of frames. Each press's window (in seconds) is in the result:
// that's the timing slack a person gets there.
//
// Math.random is swapped for a seeded generator during a run so the sandbox
// and the real step see the same particles and duck bobs.
(function () {
  const dt = () => Engine.fixedDt;
  const T = () => Level.tileSize;

  // ── Seeded random (the sandbox must replay exactly) ──
  let seed = 1;
  const rand = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ── Snapshot / restore everything a few seconds of play can change ──
  // Arrays are copied one level deep (their elements' fields too); other
  // object fields are kept by reference (ramps, themes: shared, never mutated).
  const copyFields = (o) => {
    const c = {};
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'function') continue;
      c[k] = Array.isArray(v) ? v.map(e => (e && typeof e === 'object' ? Object.assign({}, e) : e)) : v;
    }
    return c;
  };
  const back = (o, c) => {
    for (const k of Object.keys(c)) {
      const v = c[k];
      o[k] = Array.isArray(v) ? v.map(e => (e && typeof e === 'object' ? Object.assign({}, e) : e)) : v;
    }
  };
  function snap() {
    return {
      seed,
      player: copyFields(Player),
      camera: copyFields(Camera), cam: Camera.focus && Object.assign({}, Camera.focus),
      game: { state: Game.state, timer: Game.timer, levelTimer: Game.levelTimer, objectiveTimer: Game.objectiveTimer, totalDeaths: Game.totalDeaths, totalGems: Game.totalGems },
      level: {
        rings: Level.rings.map(r => r.collected), ringsCollected: Level.ringsCollected,
        gems: Level.collectibles.map(g => g.collected), collectedCount: Level.collectedCount,
        cps: Level.checkpoints.map(c => c.active),
        targetsHit: Level.targetsHit, bridgeOpen: Level.bridgeOpen, bellRung: Level.bellRung,
      },
      list: Entities.list.slice(), ents: Entities.list.map(copyFields),
      particles: Particles.pool.map(p => Object.assign({}, p)),
      input: { keys: Object.assign({}, Input.keys), justPressed: Object.assign({}, Input.justPressed), buffer: Object.assign({}, Input.buffer), runDir: Input.runDir, _jumpDown: Input._jumpDown, _tapped: Input._tapped, _swipeEdge: Input._swipeEdge },
    };
  }
  function restore(s) {
    if (Level.bridgeOpen && !s.level.bridgeOpen) throw new Error('solve: a sandbox opened the drawbridge; tiles changed and cannot be restored');
    seed = s.seed;
    back(Player, s.player);
    back(Camera, s.camera); Camera.focus = s.camera.focus ? Object.assign(s.camera.focus, s.cam) : null;
    Object.assign(Game, s.game);
    Level.rings.forEach((r, i) => { r.collected = s.level.rings[i]; });
    Level.collectibles.forEach((g, i) => { g.collected = s.level.gems[i]; });
    Level.checkpoints.forEach((c, i) => { c.active = s.level.cps[i]; });
    Object.assign(Level, { ringsCollected: s.level.ringsCollected, collectedCount: s.level.collectedCount, targetsHit: s.level.targetsHit, bridgeOpen: s.level.bridgeOpen, bellRung: s.level.bellRung });
    Entities.list = s.list.slice();
    s.list.forEach((e, i) => back(e, s.ents[i]));
    Particles.pool = s.particles.map(p => Object.assign({}, p));
    Object.assign(Input, { keys: Object.assign({}, s.input.keys), justPressed: Object.assign({}, s.input.justPressed), buffer: Object.assign({}, s.input.buffer), runDir: s.input.runDir, _jumpDown: s.input._jumpDown, _tapped: s.input._tapped, _swipeEdge: s.input._swipeEdge });
  }

  // Every system but the DOM sync (Controls) and the camera: neither moves
  // anything a run depends on, and Controls touching the DOM every frame is
  // most of the cost of a look-ahead.
  let sims = null;
  function stepOnce() {
    if (!sims) sims = Engine.systems.filter(sys => sys.update && sys !== Controls && sys !== Camera);
    for (const sys of sims) sys.update(dt());
  }
  const act = {
    jump() { Input.buffer.Jump = Input.bufferTime; Input._jumpDown = true; Input._tapped = true; },
    swipe(dir) { Input.runDir = dir; Input._swipeEdge = dir; },
  };

  // What happens over the next `sec` seconds if `action` is applied now and
  // nothing after it. Reports the events a policy scores.
  function sandbox(action, sec) {
    const s = snap();
    const ev = { died: false, finished: false, rings: 0, targets: 0, bounces: [], landings: [] };
    const r0 = Level.ringsCollected, t0 = Level.targetsHit;
    if (action) action();
    const n = Math.round(sec / dt());
    for (let f = 0; f < n; f++) {
      const wasGrounded = Player.grounded;
      stepOnce();
      if (Player.dead) { ev.died = true; break; }
      if (Player.finished) { ev.finished = true; break; }
      const feet = Player.y + Player.h;
      if (Player.grounded && Player.vy < 0) ev.bounces.push({ f, x: Player.x, feet, carry: Player.surfaceSpeed });
      else if (Player.grounded && !wasGrounded) ev.landings.push({ f, x: Player.x, feet, carry: Player.surfaceSpeed });
    }
    ev.rings = Level.ringsCollected - r0;
    ev.targets = Level.targetsHit - t0;
    ev.endX = Player.x; ev.endFeet = Player.y + Player.h;
    restore(s);
    return ev;
  }

  // Does Poko come through `action` alive, thinking one move ahead the way a
  // careful player does? Simulate until he next touches something:
  //  - a bounce (horse, duck) is safe if pressing or not pressing right then
  //    is, `depth` bounces deep (that press can't wait);
  //  - solid ground is safe if it leaves at least `react` seconds before
  //    anything kills him, enough to see the next thing and press;
  //  - dying is not safe; the goal, or no contact within maxSec, is.
  const react = 0.35;
  function survives(action, depth = 2, maxSec = 2.0) {
    const s = snap();
    let ok = true, airborne = !Player.grounded;
    if (action) action();
    const n = Math.round(maxSec / dt());
    for (let f = 0; f < n; f++) {
      stepOnce();
      if (Player.dead) { ok = false; break; }
      if (Player.finished) break;
      if (!Player.grounded) { airborne = true; continue; }
      if (!airborne) continue;                      // still rolling on the ground he started on
      if (Player.vy < 0) {                           // bounced: press now or not
        ok = depth > 0 ? (survives(null, depth - 1) || survives(act.jump, depth - 1)) : true;
      } else {                                       // landed: room to react?
        for (let g = 0; g < Math.round(react / dt()) && !Player.dead && !Player.finished; g++) stepOnce();
        ok = !Player.dead;
      }
      break;
    }
    restore(s);
    return ok;
  }

  // From now, find the run of frames where `test()` holds for `action` (scanning
  // at most `scan` s ahead, stepping with no input in between) and apply it in
  // the middle of that run. Returns the window in seconds, or null (state
  // untouched) if no frame works or the run is shorter than minW: a careful
  // player waits for a better chance rather than a 4-frame one.
  function centred(action, test, scan, minW = 0) {
    const start = snap();
    let first = -1, last = -1;
    const n = Math.round(scan / dt());
    for (let f = 0; f <= n; f++) {
      const ok = test();
      if (ok && first < 0) first = f;
      if (ok) last = f;
      if (!ok && first >= 0) break;
      if (Player.dead || Player.finished) break;
      stepOnce();
    }
    restore(start);
    if (first < 0 || (last - first + 1) * dt() < minW - 1e-9) return null;
    const mid = Math.floor((first + last) / 2);
    for (let f = 0; f < mid; f++) stepOnce();
    action();
    return +((last - first + 1) * dt()).toFixed(3);
  }

  // ── Policies: decide() runs every frame the solver is free; it may call
  // centred() (which steps the world itself) and returns a label for the log
  // ([label, window]), or null to let one frame pass with no input. ──
  const bouncing = () => Player.grounded && Player.vy < 0 && Player.surfaceSpeed > 0;

  const POLICIES = {
    'The Carousel'(ctx) {
      const roofFeet = 17 * T();
      const onRoofAfter = ev => ev.landings.some(l => Math.abs(l.feet - roofFeet) < 1);
      return {
        decide() {
          if (Player.finished || Player.dead) return null;
          if (!(Player.grounded || Player.coyoteTimer > 0)) return null;
          const onHorse = bouncing();
          const onRoof = Player.grounded && Math.abs(Player.y + Player.h - roofFeet) < 1;
          // Heading against the spin (a wall-jump out of a gap flips him): turn back.
          if (Player.travelDir < 0 && Player.grounded && !onHorse && Player.runState !== 'brake') { act.swipe(1); return 'turn (with the spin)'; }
          if (ctx.frame % 4 && !onHorse) return null;    // rolling along: look ahead every 4th frame
          // Doing nothing kills him (a gap, a patrol, a hop off a horse into a gap): press.
          if (!survives(null)) {
            const test = () => survives(act.jump);
            const w = ctx.centred(act.jump, test, 0.5, onHorse ? 0 : ctx.comfy) ?? ctx.centred(act.jump, test, 0.5);
            if (w !== null) return [onHorse ? 'bounce (escape)' : 'jump (pit/patrol)', w];
          }
          const pending = Level.rings.filter(x => !x.collected);
          if (!pending.length) return null;
          // A press that grabs a ring, from wherever he is.
          if (sandbox(act.jump, 1.0).rings > 0) {
            const w = ctx.centred(act.jump, () => sandbox(act.jump, 1.0).rings > 0 && survives(act.jump), 0.6, onHorse ? 0 : ctx.comfy);
            if (w !== null) return [onHorse ? 'bounce → ring' : onRoof ? 'roof → ring' : 'deck → ring', w];
          }
          // Ring B rides a horse; ring C hangs off the booth roof's far end.
          const horseRing = (Entities.list.find(e => e.ring) || {}).ring;
          const needRoof = pending.some(x => x !== horseRing && x.y < 15 * T());
          const needHorse = needRoof || pending.includes(horseRing);
          // Off a horse: a pressed bounce onto the booth roof, if ring C is still up there.
          if (onHorse && needRoof && onRoofAfter(sandbox(act.jump, 1.2))) {
            const w = ctx.centred(act.jump, () => onRoofAfter(sandbox(act.jump, 1.2)) && survives(act.jump), 0.1);
            if (w !== null) return ['bounce → roof', w];
          }
          // Off the deck onto the ring horse, landing where a pressed bounce grabs
          // its ring: what a player aiming for ring B does.
          if (!onHorse && !onRoof && pending.includes(horseRing) && Player.grounded) {
            const viaRing = () => {
              const s0 = snap(); let got = false;
              act.jump();
              for (let f = 0; f < 120 && !Player.dead; f++) {
                stepOnce();
                if (bouncing()) {
                  act.jump();
                  for (let g = 0; g < 120 && !Player.dead && !horseRing.collected; g++) stepOnce();
                  got = horseRing.collected && !Player.dead;
                  break;
                }
              }
              restore(s0);
              return got;
            };
            if (viaRing()) {
              const w = ctx.centred(act.jump, viaRing, 0.4, ctx.comfy);
              if (w !== null) return ['deck → ring horse', w];
            }
          }
          // Off the deck: a jump that lands on a horse (the roof needs one).
          if (!onHorse && !onRoof && needRoof && Player.grounded) {
            const onto = () => sandbox(act.jump, 1.0).bounces.some(b => b.feet < 22 * T() - 4) && survives(act.jump);
            if (onto()) {
              const w = ctx.centred(act.jump, onto, 0.4, ctx.comfy);
              if (w !== null) return ['deck → horse', w];
            }
          }
          return null;
        },
      };
    },

    'The Duck River'(ctx) {
      const pen = { x0: 119 * T(), x1: 137 * T() };
      let lastSpray = -1, waitingUntil = -1;
      return {
        decide() {
          if (Player.finished || Player.dead) return null;
          const inPen = Player.x > pen.x0 - T() && Player.x < pen.x1 && !Level.bridgeOpen && Player.y < 22 * T();
          if (inPen) {
            // The gallery: turn at the walls, spray in between (no sandbox:
            // knocking the last duck rebuilds tiles).
            const ahead = Math.floor((Player.x + Player.w / 2 + Player.travelDir * 40) / T());
            if (Player.runState !== 'brake' && Level._tileGrid[ahead + ',21']) { act.swipe(-Player.travelDir); return 'turn (pen wall)'; }
            if (Game.levelTimer - lastSpray > 0.4 && Player.momentum >= Player.attackThreshold) { act.swipe(Player.travelDir); lastSpray = Game.levelTimer; return 'spray'; }
            return null;
          }
          if (bouncing()) {
            // On a duck: no press if that's safe, else press if that is. The
            // real window for a press here is the 0.1s jump buffer before landing.
            if (survives(null)) return null;
            if (survives(act.jump)) { act.jump(); return ['duck: press', 0.1]; }
            return null;
          }
          // The bridge is down: the goal is to the right.
          if (Level.bridgeOpen && Player.travelDir < 0 && Player.runState !== 'brake') { act.swipe(1); return 'turn (to the goal)'; }
          if (!Player.grounded || Player.surfaceSpeed) return null;   // only decide standing on a bank
          // A wall ahead at body height (the gallery's counter): hop it.
          const wallCol = Math.floor((Player.x + Player.w / 2 + Player.travelDir * 30) / T());
          if (Level._tileGrid[wallCol + ',' + Math.floor((Player.y + Player.h - 8) / T())]) { act.jump(); return 'jump (wall)'; }
          if (ctx.frame % 4) return null;            // rolling along: look ahead every 4th frame
          if (survives(null)) return null;
          // About to go in (a bank edge, a patrol): a jump that comes through.
          const w = ctx.centred(act.jump, () => survives(act.jump), 0.5, ctx.comfy);
          if (w !== null) return ['jump', w];
          // Nothing comfortable: turn and come back (the wait the level asks for).
          if (Game.levelTimer < waitingUntil) return null;
          waitingUntil = Game.levelTimer + 1.0;
          act.swipe(-Player.travelDir);
          ctx.after(0.5, () => act.swipe(-Player.travelDir));
          return 'turn to wait';
        },
      };
    },
  };

  // The sandbox pieces, for one-off experiments in the console.
  window.__solve = { snap, restore, stepOnce, sandbox, survives, act };

  window.solveLevel = function (name, opts) {
    opts = Object.assign({ maxSeconds: 180 }, opts);
    const idx = Level.maps.findIndex(m => m.name === name);
    if (idx < 0) throw new Error(`solve: no level named ${name}`);
    const policyOf = POLICIES[name];
    if (!policyOf) throw new Error(`solve: no policy for ${name}`);
    const saved = {
      raw: (() => { try { return localStorage.getItem('clowncity_save'); } catch (e) { return null; } })(),
      save: JSON.parse(JSON.stringify(Game.save)), muted: Audio.muted, random: Math.random, halted: Engine.halted,
    };
    Engine.halted = true; Audio.muted = true; seed = 1; Math.random = rand;
    Input.keys = {}; Input.justPressed = {}; Input.buffer = {}; Input.runDir = 1;
    Game.transitionDir = 0; Game.transitionAlpha = 0; Game.state = 'playing';
    Game.loadLevel(idx);
    for (let w = 0; w < (opts.warp || 0); w += dt()) Entities.update(dt());

    const log = [], windows = [], deaths = [];
    const timers = [];
    const ctx = {
      frame: 0,
      centred: (a, t, s, m) => centred(a, t, s, m),
      comfy: 0.1,                 // the slack a careful player wants on a jump (bounce presses get the 0.1s buffer on top)
      after: (sec, fn) => timers.push({ at: Game.levelTimer + sec, fn }),
    };
    const policy = policyOf(ctx);
    let result = 'timeout', stillSince = 0, lastX = Player.x;
    try {
      while (Game.levelTimer < opts.maxSeconds) {
        ctx.frame++;
        if (Math.abs(Player.x - lastX) > 4) { lastX = Player.x; stillSince = Game.levelTimer; }
        else if (!Player.dead && Game.levelTimer - stillSince > 3) { result = 'stuck'; break; }
        for (let i = timers.length - 1; i >= 0; i--) if (Game.levelTimer >= timers[i].at) { timers[i].fn(); timers.splice(i, 1); }
        const wasDead = Player.dead;
        const d = policy.decide();
        if (d) {
          const [label, w] = Array.isArray(d) ? d : [d, null];
          if (log.length < 300) log.push({ t: +Game.levelTimer.toFixed(2), what: label, col: +(Player.x / T()).toFixed(1), row: +(Player.y / T()).toFixed(1), window: w });
          if (w) windows.push({ what: label, w, t: +Game.levelTimer.toFixed(2) });
        }
        stepOnce();
        if (Player.dead && !wasDead) deaths.push({ t: +Game.levelTimer.toFixed(2), col: +(Player.x / T()).toFixed(1), row: +(Player.y / T()).toFixed(1) });
        if (Game.state === 'levelComplete' || Player.finished) { result = 'goal'; break; }
      }
    } finally {
      Math.random = saved.random;
      Audio.muted = saved.muted;
      Game.save = saved.save;
      try { if (saved.raw == null) localStorage.removeItem('clowncity_save'); else localStorage.setItem('clowncity_save', saved.raw); } catch (e) {}
      Engine.halted = saved.halted;
    }
    const tightest = windows.reduce((a, w) => (!a || w.w < a.w ? w : a), null);
    return { level: name, result, time: +Game.levelTimer.toFixed(2), deaths, rings: `${Level.ringsCollected}/${Level.rings.length}`, targets: `${Level.targetsHit}/${Level.targetsTotal}`, gems: `${Level.collectedCount}/${Level.totalCollectibles}`, tightest, presses: windows.length, log };
  };
})();
