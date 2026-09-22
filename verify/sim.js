// verify/sim.js — headless physics harness for the Big Drop slope work.
//
// Usage (via the preview MCP tools, in the running game page):
//   1) install:  fetch('/verify/sim.js').then(r=>r.text()).then(eval)
//   2) run:      JSON.stringify(window.runSim({ rows: [...], ... }))
//
// It stops Engine's RAF loop and steps Player.update() by hand so results are
// independent of real time. A scratch map named '__sim__' is appended to
// Level.maps and reused across runs.
//
// Input is a top-level `const` (not a window property), so it can't be swapped
// out — player.js closes over the real object. Instead we drive that real
// `Input`: set its sticky `runDir`, and arm its jump buffer on a chosen frame.
// `Input.update()` is NOT in this loop, so we tick the buffer down ourselves
// (mirroring input.js) and restore everything in a finally block.
(function () {
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

    // Save + drive the REAL Input/Audio, restore in finally.
    const saved = { muted: Audio.muted, runDir: Input.runDir, buffer: Input.buffer };
    Audio.muted = true;
    Input.buffer = {};
    const jumpFrame = opts.jumpFrame != null ? opts.jumpFrame : -1;
    const jumpSet = new Set(opts.jumpFrames || []);
    if (jumpFrame >= 0) jumpSet.add(jumpFrame);

    const s = Level.tileSize;
    const px = opts.x != null ? opts.x : map.spawn[0] * s;
    const py = opts.y != null ? opts.y : map.spawn[1] * s;
    Player.spawn(px, py);
    Input.runDir = opts.runDir != null ? opts.runDir : 0;   // after spawn(), which resets it
    if (opts.skipRamp) { Player.runState = 'cruise'; Player.rampT = 1; }
    if (opts.vx != null) Player.vx = opts.vx;

    const frames = opts.frames || 240;
    const sample = opts.sample || 1;
    const trace = [];
    try {
      for (let f = 0; f < frames; f++) {
        if (opts.steer && opts.steer[f] != null) Input.runDir = opts.steer[f];
        if (jumpSet.has(f)) Input.buffer.Jump = Input.bufferTime;   // arm a jump this frame
        Player.update(Engine.fixedDt);
        // Tick the jump buffer down like Input.update would (it's not in this loop).
        for (const k in Input.buffer) {
          Input.buffer[k] -= Engine.fixedDt;
          if (Input.buffer[k] <= 0) delete Input.buffer[k];
        }
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
    } finally {
      Audio.muted = saved.muted;
      Input.runDir = saved.runDir;
      Input.buffer = saved.buffer;
    }
    return { idx, frames, last: trace[trace.length - 1], trace };
  };
})();
