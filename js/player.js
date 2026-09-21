// ─── Player: Bozo on a unicycle — bidirectional auto-runner ───
// Bozo is ALWAYS moving; the player only steers (swipe) and jumps (tap).
// Reversing direction is a weighty, momentum-based turnaround whose braking
// lunge ("the wheel kicks out the old way") doubles as the attack.

// Move `cur` toward `target` by at most `maxDelta` (frame-rate independent).
function approach(cur, target, maxDelta) {
  if (cur < target) return Math.min(cur + maxDelta, target);
  if (cur > target) return Math.max(cur - maxDelta, target);
  return cur;
}

// Axis-aligned bounding-box overlap test.
function aabb(a, b) {
  return a.x + a.w > b.x && a.x < b.x + b.w && a.y + a.h > b.y && a.y < b.y + b.h;
}

const Player = {
  // ── Hitbox (collision) ──
  x: 100, y: 300,
  w: 14, h: 28,

  // ── Sprite rendering (visual, larger than hitbox) ──
  spriteW: 32, spriteH: 32,
  spriteOffsetX: -9,   // from hitbox left to sprite left
  spriteOffsetY: -4,   // from hitbox top to sprite top

  // ── Velocity ──
  vx: 0, vy: 0,

  // ── Unicycle momentum (auto-runner) ──
  runSpeed: 400,            // cruise top speed (speed = 1)
  startRampTime: 1.5,       // level start: ramp 0 -> full over this many seconds
  accelRate: 1400,          // px/s^2 — chase target during the start ramp
  cruiseAccel: 420,         // px/s^2 — DELIBERATE eased build to top speed in cruise (~1.2s)
  reverseDecel: 2400,       // px/s^2 — braking old momentum during a turnaround
  reverseAccel: 1600,       // px/s^2 — accelerating into the new direction
  pauseAtZeroTime: 0.03,    // brief commit beat at the bottom of a reversal (tightened)
  zeroEpsilon: 12,          // |vx| under this counts as "stopped"
  treadmillCap: 200,        // 0.5 * runSpeed — speed cap while on a treadmill
  treadmillDamp: 3000,      // px/s^2 — damp toward the cap (non-directional)
  brakeWindow: 0.18,        // max lifetime of the wheel-throw attack hitbox

  // ── Spin-out attack (tap your CURRENT direction with momentum) ──
  attackThreshold: 0.5,     // momentum (0..1) needed to spin out an attack
  spinAttackCost: 0.45,     // fraction of speed spent on a spin-out (bleeds momentum)
  spinAttackWindow: 0.16,   // hitbox lifetime
  spinAttackCooldown: 0.22, // min seconds between spin-outs

  maxFallSpeed: 720,

  // ── Jump tuning (fixed-height tap jump) ──
  jumpForce: -480,
  jumpSpeedBonus: 380,       // px/s extra upward launch at full overspeed (≈ -860 total)
  gravityUp: 1300,           // gravity while rising (lighter, floaty arc)
  gravityDown: 2100,         // gravity while falling (1.6x — snappy descent)

  // ── Slopes / overspeed (the downhill bomb that powers the big jump) ──
  overspeedCap: 720,        // px/s — max |vx| reachable on a downhill (1.8x runSpeed)
  slopeAccel: 800,          // px/s^2 — speed gained while bombing downhill
  slopeUphillDrag: 600,     // px/s^2 — speed bled while climbing a slope
  overspeedDecay: 500,      // px/s^2 — decay back to runSpeed on flat ground/air

  // ── Coyote time / jump buffer ──
  coyoteTime: 0.06,      // ~7 frames at 120Hz
  coyoteTimer: 0,

  // ── Corner correction ──
  cornerCorrectionMax: 5, // pixels — nudge up to 5px to clear corners

  // ── Ledge assist ──
  ledgeAssist: 2,         // extra pixels for ground check width

  // ── Wall-slide / wall-jump ──
  // Bozo clings to a wall he's steering into while airborne, slides down at a
  // capped speed, and can wall-jump up-and-away. The jump FLIPS travelDir away
  // from the wall, so ricocheting between two close walls climbs a shaft.
  wallSlideSpeed: 120,     // px/s — max descent while clinging (lower = stickier)
  wallJumpForceY: -440,    // px/s — launch height (just under the -480 ground jump)
  wallJumpPushX: 300,      // px/s — sideways kick away from the wall
  wallStickTime: 0.08,     // s — "wall-coyote": grace to still wall-jump after leaving
  wallJumpLockTime: 0.12,  // s — ignore steering back into the wall after a wall-jump
  revClimbSpeed: 280,      // px/s — upward pop when you slam a wall with speed (augments slide)
  revClimbThreshold: 0.4,  // momentum (0..1) needed to rev-climb; below this you just slide

  // ── Collision: don't treat flat-floor seams as walls ──
  // X-collision only blocks if a tile rises into the body by more than this.
  // Must be > max per-frame fall penetration (maxFallSpeed/120 = 6px) and < a
  // real step, so flat ground never snags momentum but real walls still stop us.
  stepTolerance: 8,

  slopeSnap: 8,           // px — stick distance to a slope surface (must exceed the
                          // max per-frame horizontal step: overspeedCap/120 = 6px)

  // ── Unicycle visual (roll + momentum sway) ──
  wheelRadius: 8,
  cruiseLean: 0.10,       // rad — gentle lean into travel at full speed (~6°)
  brakeLean: 0.14,        // rad — extra back-sway during a reversal (~8°)
  leanRate: 10,           // lean smoothing rate (squash uses 14; lean trails a touch)

  // ── State ──
  grounded: false,
  wasGrounded: false,     // for coyote: only grant when walking off, not jumping off
  wallDir: 0,             // internal collision state (set in resolveCollisions)
  onSlope: false,         // grounded on a slope this frame (set in resolveSlopes)
  slopeDir: 0,            // sign of the slope under the feet (+1 rise-right)
  facing: 1,              // FIXED visual facing — Bozo always faces the same way

  // ── Unicycle run state ──
  travelDir: 1,           // committed direction of travel, never 0
  desiredDir: 1,          // last steer intent
  runState: 'ramp',       // 'ramp' | 'cruise' | 'brake'
  rampT: 0,               // 0..1 start-ramp progress
  brakeTimer: 0,          // counts down the wheel-throw window during a brake
  pausedAtZero: 0,        // commit-beat accumulator at the bottom of a reversal
  attackDir: 0,           // wheel-throw direction (= old travelDir); 0 = inactive

  // ── Wall-slide / wall-jump state ──
  wallSliding: false,     // currently clinging to a wall this frame
  wallStickTimer: 0,      // wall-coyote countdown (can still wall-jump > 0)
  wallJumpLockTimer: 0,   // steer-back lockout after a wall-jump
  wallContactDir: 0,      // sign of the wall we're touching (+1 wall on right)

  // ── Spin-out attack state ──
  spinAttackTimer: 0,     // forward attack hitbox countdown
  spinAttackDir: 0,       // direction of the active spin-out (0 = inactive)
  _spinCooldown: 0,       // throttles repeat spin-outs

  // ── Animation state ──
  squash: 1,
  squashTarget: 1,
  trail: [],
  animState: 'idle',
  animTimer: 0,
  animFrame: 0,

  // ── Unicycle sway / roll (visual only) ──
  wheelAngle: 0,
  lean: 0,
  leanTarget: 0,

  // Animation definitions: { frames: [indices], duration: ms per frame, loop: bool, next: state }
  anims: {
    idle:      { frames: [0], duration: 0.15, loop: true },
    run:       { frames: [1, 2, 3, 4, 5, 6], duration: 0.07, loop: true },
    jump:      { frames: [7, 8], duration: 0.08, loop: false, next: 'fall' },
    fall:      { frames: [9], duration: 0.1, loop: true },
    land:      { frames: [11, 0], duration: 0.04, loop: false, next: 'idle' },
    death:     { frames: [13], duration: 0.1, loop: true },
  },

  // ── Sprite sheet (null = use rect fallback) ──
  spriteSheet: null,
  spriteColumns: 8,  // columns in spritesheet grid

  // ── Death & respawn ──
  dead: false,
  deathTimer: 0,
  deathDuration: 0.6,       // seconds before respawn
  respawning: false,
  respawnTimer: 0,
  respawnDuration: 0.3,     // brief invuln flash after respawn
  deathCount: 0,
  checkpointX: 0,
  checkpointY: 0,

  // ── Hazard hitbox (smaller than platform hitbox for forgiving near-misses) ──
  hazardShrink: 3,          // pixels inset on each side

  // ── Material state ──
  groundMaterial: 'solid',   // material of tile player is standing on

  // ── Particle timers ──
  _dustTimer: 0,
  _sparkTimer: 0,
  _iceTimer: 0,
  _wallDustTimer: 0,

  // Momentum (0..1): your current speed fraction. Built by cruising along the
  // eased curve, spent by attacks and wall rev-climbs. Read by the speedometer,
  // the spin-out attack threshold, and the wall climb.
  get momentum() {
    return Math.min(1, Math.abs(this.vx) / this.runSpeed);
  },

  // Overspeed (0..1+): speed banked ABOVE the normal cap by bombing a downhill.
  // Separate from `momentum` (which stays clamped 0..1 for the HUD + attack
  // threshold) — only the speed-jump reads this.
  get overspeed() {
    return Math.max(0, (Math.abs(this.vx) - this.runSpeed) / this.runSpeed);
  },

  spawn(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.grounded = false;
    this.wasGrounded = false;
    this.coyoteTimer = 0;
    // Restart the unicycle: slowly ramp forward (right) from a standstill.
    // Reset the sticky steer too, or dying mid-leftward-turn respawns you
    // immediately braking back to the left.
    this.travelDir = 1;
    this.desiredDir = 1;
    Input.runDir = 1;
    this.runState = 'ramp';
    this.rampT = 0;
    this.brakeTimer = 0;
    this.pausedAtZero = 0;
    this.attackDir = 0;
    this.wallSliding = false;
    this.wallStickTimer = 0;
    this.wallJumpLockTimer = 0;
    this.wallContactDir = 0;
    this.onSlope = false;
    this.slopeDir = 0;
    this.spinAttackTimer = 0;
    this.spinAttackDir = 0;
    this._spinCooldown = 0;
    this.facing = 1;
    this.wheelAngle = 0;
    this.lean = 0;
    this.leanTarget = 0;
    this.dead = false;
    this.deathTimer = 0;
    this.respawning = true;
    this.respawnTimer = this.respawnDuration;
    this.setAnim('fall');
  },

  die() {
    if (this.dead || this.respawning) return;
    this.dead = true;
    this.deathTimer = this.deathDuration;
    this.deathCount++;
    this.vx = 0;
    this.vy = 0;
    this.setAnim('death');
    Camera.shake(6);
    Engine.flash('red', 0.3);
    Audio.die();
    // Death burst particles
    Particles.burst(
      this.x + this.w / 2, this.y + this.h / 2,
      20, 250, Tokens.rgba(Tokens.color.danger, 0.8), 0.4
    );
    Particles.burst(
      this.x + this.w / 2, this.y + this.h / 2,
      10, 150, Tokens.rgba(Tokens.color.white, 0.6), 0.3
    );
    // Hitstop: freeze the game for a few frames
    Engine.hitstop(0.05);
  },

  respawn() {
    this.spawn(this.checkpointX, this.checkpointY);
  },

  setCheckpoint(x, y) {
    this.checkpointX = x;
    this.checkpointY = y;
  },

  setAnim(state) {
    if (this.animState === state) return;
    this.animState = state;
    this.animTimer = 0;
    this.animFrame = 0;
  },

  updateAnim(dt) {
    const anim = this.anims[this.animState];
    if (!anim) return;

    this.animTimer += dt;
    if (this.animTimer >= anim.duration) {
      this.animTimer -= anim.duration;
      this.animFrame++;
      if (this.animFrame >= anim.frames.length) {
        if (anim.loop) {
          this.animFrame = 0;
        } else {
          this.animFrame = anim.frames.length - 1;
          if (anim.next) this.setAnim(anim.next);
        }
      }
    }
  },

  update(dt) {
    // ── Death state: frozen, waiting to respawn ──
    if (this.dead) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        this.respawn();
      }
      this.updateAnim(dt);
      return;
    }

    // ── Respawn invulnerability tick-down ──
    if (this.respawning) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.respawning = false;
      }
    }

    // ── Steer intent (sticky) + jump (tap / keyboard) ──
    const wantDir = Input.runDir;
    const jumpBuffered = Input.jumpBuffered();

    // Reversal: a steer against committed travel starts a weighty turnaround.
    // The wheel "kicks" out in the OLD direction (attackDir) as a braking
    // lunge — and that lunge is the attack hitbox (see getAttackRect).
    if (wantDir !== 0 && wantDir !== this.travelDir && this.runState !== 'brake' && this.wallJumpLockTimer <= 0 &&
        !(this.wallSliding && wantDir === -this.wallContactDir)) {   // steering off a wall = wall-jump, not a brake
      this.runState = 'brake';
      this.brakeTimer = this.brakeWindow;
      this.pausedAtZero = 0;
      this.attackDir = this.travelDir;     // old direction = lunge / attack dir
      this.squash = 1.25;
      Audio.bounce();
      this._spawnBrakeDust();
      this._carnivalSpray(this.attackDir);   // multicolour spray = the visible attack
    }
    if (wantDir !== 0) this.desiredDir = wantDir;

    // ── Unicycle momentum driver (replaces free-move accel/friction) ──
    const onTreadmill = this.grounded && this.groundMaterial === 'treadmill';

    if (this.runState === 'ramp') {
      // Level start: ease from a standstill up to full speed.
      this.rampT = Math.min(1, this.rampT + dt / this.startRampTime);
      const target = this.travelDir * this.runSpeed * this.rampT;
      this.vx = approach(this.vx, target, this.accelRate * dt);
      if (this.rampT >= 1) this.runState = 'cruise';
    } else if (this.runState === 'brake') {
      this.brakeTimer -= dt;
      const movingOldWay = Math.sign(this.vx) === this.travelDir && Math.abs(this.vx) > this.zeroEpsilon;
      if (movingOldWay) {
        // Phase A: brake the old momentum toward zero (the wheel kicks forward).
        this.vx = approach(this.vx, 0, this.reverseDecel * dt);
      } else {
        // Phase B: a brief commit beat at the bottom, then flip to the new way.
        this.vx = approach(this.vx, 0, this.reverseDecel * dt);
        this.pausedAtZero += dt;
        if (this.pausedAtZero >= this.pauseAtZeroTime) {
          this.travelDir = this.desiredDir;
          this.attackDir = 0;
          this.runState = 'cruise';
        }
      }
    } else {
      // Cruise: build toward top speed along a DELIBERATE eased curve — speed is
      // something you spin up and feel, not instant. Reversing drops you low so
      // you re-earn it; attacks and wall rev-climbs spend it.
      const targetVx = this.travelDir * this.runSpeed;
      const frac = Math.min(1, Math.abs(this.vx) / this.runSpeed);
      const accel = this.cruiseAccel * (1 - 0.5 * frac);   // eases as you near the top
      this.vx = approach(this.vx, targetVx, accel * dt);
    }

    // Treadmill: cap and damp speed toward 0.5, non-directional (only slows).
    if (onTreadmill && Math.abs(this.vx) > this.treadmillCap) {
      this.vx = approach(this.vx, Math.sign(this.vx) * this.treadmillCap, this.treadmillDamp * dt);
    }

    // ── Slope speed-transfer + perishable overspeed ──
    // onSlope/slopeDir come from the previous frame's resolveSlopes (the same
    // one-frame-late model grounded/wallDir use). Downhill builds speed past the
    // cap; uphill bleeds; on flat/air any overspeed decays back to runSpeed.
    // NOTE: the cruise driver above already nudges vx toward runSpeed every frame
    // (~210 px/s^2 at the top), so the REALIZED rates here are offset by that:
    // effective downhill build ≈ slopeAccel-210, effective flat decay ≈
    // overspeedDecay+210. Keep that in mind when tuning these constants by feel.
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

    // ── Asymmetric gravity (floaty rise, snappy fall) ──
    const grav = this.vy < 0 ? this.gravityUp : this.gravityDown;
    this.vy += grav * dt;
    if (this.vy > this.maxFallSpeed) this.vy = this.maxFallSpeed;

    // ── Coyote time (only when walking off, not jumping off) ──
    if (this.grounded) {
      this.coyoteTimer = this.coyoteTime;
    } else {
      this.coyoteTimer -= dt;
    }

    // ── Wall-slide detection ──
    // wallDir/grounded here are from LAST frame's resolveCollisions (the same
    // one-frame-late model coyote uses). Cling when airborne, touching a wall,
    // and steering INTO it (travelDir === wallDir).
    const onWall = !this.grounded && this.wallDir !== 0 && this.travelDir === this.wallDir;
    if (onWall) {
      this.wallStickTimer = this.wallStickTime;   // refresh wall-coyote
      this.wallContactDir = this.wallDir;
    } else if (this.wallStickTimer > 0) {
      this.wallStickTimer -= dt;
    }
    this.wallSliding = onWall;
    if (this.wallJumpLockTimer > 0) this.wallJumpLockTimer -= dt;
    // Cap descent while clinging — rising (a jump's ascent) is left untouched.
    if (onWall && this.vy > this.wallSlideSpeed) this.vy = this.wallSlideSpeed;

    // ── Spin-out attack ──
    // Tap your CURRENT direction (re-press the key / swipe the way you're going)
    // with momentum >= threshold to spit the wheel out forward and kill what's
    // ahead — no reversing needed, works on the ground OR mid-air. Spends
    // momentum, so you slow and re-earn it. (Clinging a wall zeroes vx, dropping
    // momentum below the threshold, so it won't fire while you're wall-stuck.)
    if (this._spinCooldown > 0) this._spinCooldown -= dt;
    if (this.spinAttackTimer > 0) this.spinAttackTimer -= dt;
    const sameDirTap =
      (Input.swipeEdge() === this.travelDir) ||
      (this.travelDir > 0 && (Input.pressed('ArrowRight') || Input.pressed('KeyD'))) ||
      (this.travelDir < 0 && (Input.pressed('ArrowLeft')  || Input.pressed('KeyA')));
    if (sameDirTap && this.runState !== 'brake' &&
        this.momentum >= this.attackThreshold && this._spinCooldown <= 0) {
      this._doSpinAttack();
    }

    // A wall-jump can also be triggered by HITTING AWAY from the wall (steer off).
    const awayDir = -this.wallContactDir;
    const steerOff = awayDir !== 0 && (
      Input.swipeEdge() === awayDir ||
      (awayDir > 0 && (Input.pressed('ArrowRight') || Input.pressed('KeyD'))) ||
      (awayDir < 0 && (Input.pressed('ArrowLeft')  || Input.pressed('KeyA')))
    );

    // ── Jump: ground / coyote, else a wall-jump (from a jump input OR steering off) ──
    if (jumpBuffered) {
      if (this.grounded || (this.coyoteTimer > 0 && this.wasGrounded)) {
        this._doGroundJump();
      } else if (onWall || this.wallStickTimer > 0) {
        this._doWallJump();
      }
    } else if ((onWall || this.wallStickTimer > 0) && steerOff) {
      this._doWallJump();
    }

    // ── Apply velocity ──
    this.wasGrounded = this.grounded;
    const prevWallDir = this.wallDir;            // wall contact from LAST frame
    const speedAtContact = Math.abs(this.vx);    // speed we may slam a wall with this frame
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // ── Resolve collisions (with corner correction) ──
    this.resolveCollisions();

    // ── Speed → wall rev-climb (augments wall-slide / wall-jump) ──
    // A NEW head-on wall contact while airborne, arriving with momentum, revs
    // the wheel and pops you a small amount UP the wall (height ∝ arrival speed).
    // The collision already zeroed vx, so that horizontal speed is "spent" here.
    if (!this.grounded && this.wallDir !== 0 && prevWallDir === 0 && this.travelDir === this.wallDir) {
      const m = Math.min(1, speedAtContact / this.runSpeed);
      if (m >= this.revClimbThreshold) {
        this.vy = Math.min(this.vy, -this.revClimbSpeed * m);   // upward pop (keep the more-upward)
        this.wallContactDir = this.wallDir;
        this.wallSliding = true;
        this._carnivalSpray(-this.wallDir);     // spray flings off the wall
        Camera.shake(2);
      }
    }

    // ── Check hazard collisions (with smaller hitbox) ──
    this.checkHazards();

    // ── Update animation state ──
    if (this.grounded) {
      if (!this.wasGrounded) this.setAnim('land');
      else this.setAnim('run');            // Bozo is always rolling on the ground
    } else if (this.vy < 0) {
      if (this.animState !== 'jump') this.setAnim('jump');
    } else {
      this.setAnim('fall');
    }
    this.updateAnim(dt);

    // ── Squash & stretch ──
    this.squash += (this.squashTarget - this.squash) * 14 * dt;
    if (Math.abs(this.squash - this.squashTarget) < 0.01) this.squash = this.squashTarget;
    this.squashTarget = 1;

    // ── Unicycle roll + momentum sway ──
    // Wheel rolls by arc length (clockwise-positive canvas rotation, so vx>0 spins +).
    this.wheelAngle += (this.vx / this.wheelRadius) * dt;
    // Lean into travel; during a reversal the body rocks back as the wheel kicks
    // out the OLD way (attackDir). The smoothing is what reads as a sway.
    const speedFrac = Math.max(-1, Math.min(1, this.vx / this.runSpeed));
    let leanT = speedFrac * this.cruiseLean;
    if (this.runState === 'brake' && this.attackDir !== 0) {
      leanT += -this.attackDir * this.brakeLean;
    }
    if (!this.grounded) leanT *= 0.5;   // softer in the air
    if (this.wallSliding) leanT = this.wallContactDir * this.brakeLean;  // hug the wall
    this.leanTarget = leanT;
    this.lean += (this.leanTarget - this.lean) * this.leanRate * dt;

    // ── Movement trail (speed dots) ──
    if (Math.abs(this.vx) > 100 || Math.abs(this.vy) > 100) {
      this.trail.push({ x: this.x + this.w / 2, y: this.y + this.h / 2, alpha: 0.3, type: 'dot' });
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].alpha -= dt * 2;
      if (this.trail[i].alpha <= 0) this.trail.splice(i, 1);
    }

    // ── Run dust (kicked out behind the wheel) ──
    if (this.grounded && Math.abs(this.vx) > 150) {
      const dir = Math.sign(this.vx) || 1;
      this._dustTimer = (this._dustTimer || 0) + dt;
      if (this._dustTimer > 0.06) {
        this._dustTimer = 0;
        Particles.emit(
          this.x + (dir < 0 ? this.w : 0), this.y + this.h,
          -dir * (20 + Math.random() * 40), -(10 + Math.random() * 30),
          Tokens.rgba(Tokens.color.dust, 0.3), 0.15 + Math.random() * 0.1
        );
      }
    }

    // ── Wall-slide dust (trickles down the wall face) ──
    if (this.wallSliding && this.vy > 20) {
      this._wallDustTimer += dt;
      if (this._wallDustTimer > 0.05) {
        this._wallDustTimer = 0;
        const wx = this.x + (this.wallContactDir > 0 ? this.w : 0);
        Particles.emit(
          wx, this.y + Math.random() * this.h,
          -this.wallContactDir * (10 + Math.random() * 20), 20 + Math.random() * 30,
          Tokens.rgba(Tokens.color.dust, 0.3), 0.15 + Math.random() * 0.1
        );
      }
    }

    // ── Treadmill belt dust ──
    if (onTreadmill && Math.abs(this.vx) > 30) {
      this._iceTimer = (this._iceTimer || 0) + dt;
      if (this._iceTimer > 0.05) {
        this._iceTimer = 0;
        Particles.emit(
          this.x + Math.random() * this.w, this.y + this.h,
          (Math.random() - 0.5) * 40, -(15 + Math.random() * 25),
          Tokens.rgba(Tokens.color.belt, 0.35), 0.15 + Math.random() * 0.1
        );
      }
    }
  },

  _doGroundJump() {
    const denom = (this.overspeedCap - this.runSpeed) || 1;
    const overFrac = Math.max(0, Math.min(1, (Math.abs(this.vx) - this.runSpeed) / denom));
    this.vy = this.jumpForce - this.jumpSpeedBonus * overFrac;
    if (overFrac > 0.4) {
      this.squash = 1.5;
      Camera.shake(3 + overFrac * 4);
      this._carnivalSpray(this.travelDir);   // charged launch throws confetti
    } else {
      this.squash = 1.4;
    }
    this.coyoteTimer = 0;
    this.grounded = false;
    this.setAnim('jump');
    Audio.jump();
    Input.consumeJump();
    for (let i = 0; i < 5; i++) {
      Particles.emit(
        this.x + Math.random() * this.w, this.y + this.h,
        (Math.random() - 0.5) * 80, 40 + Math.random() * 40,
        Tokens.rgba(Tokens.color.white, 0.4), 0.15 + Math.random() * 0.1
      );
    }
  },

  // Wall-jump: launch up-and-away from the wall, and FLIP travelDir away so the
  // auto-runner rides off the wall (and aims at the opposite wall of a shaft).
  _doWallJump() {
    const away = -(this.wallContactDir || this.wallDir) || -this.travelDir || 1;
    this.vy = this.wallJumpForceY;
    this.vx = away * this.wallJumpPushX;
    this.travelDir = away;
    this.desiredDir = away;
    // The kick IS a steer: sync the sticky intent, or once wallJumpLockTime
    // expires the brake check sees runDir still pointing at the old wall and
    // U-turns Bozo mid-air (a tap wall-jump could never climb a shaft).
    Input.runDir = away;
    this.runState = 'cruise';
    this.rampT = 1;
    this.attackDir = 0;
    this.wallJumpLockTimer = this.wallJumpLockTime;
    this.wallStickTimer = 0;
    this.wallSliding = false;
    this.grounded = false;
    this.coyoteTimer = 0;
    this.squash = 1.4;
    this.setAnim('jump');
    Audio.jump();
    Input.consumeJump();
    Camera.shake(3);
    // Kick burst off the wall, particles flying out in the away direction.
    const wx = this.x + (this.wallContactDir > 0 ? this.w : 0);
    for (let i = 0; i < 7; i++) {
      Particles.emit(
        wx, this.y + this.h * (0.3 + Math.random() * 0.5),
        away * (80 + Math.random() * 120), -(20 + Math.random() * 60),
        Tokens.rgba(Tokens.color.white, 0.5), 0.15 + Math.random() * 0.12
      );
    }
  },

  // Dust + a little kick when the wheel lunges out to brake (the attack motion).
  _spawnBrakeDust() {
    const dir = this.attackDir || this.travelDir || 1;
    Camera.shake(2);
    for (let i = 0; i < 6; i++) {
      Particles.emit(
        this.x + (dir > 0 ? this.w : 0), this.y + this.h * (0.5 + Math.random() * 0.5),
        dir * (60 + Math.random() * 120), -(10 + Math.random() * 40),
        'rgba(220,220,235,0.5)', 0.15 + Math.random() * 0.1
      );
    }
  },

  resolveCollisions() {
    this.grounded = false;
    this.wallDir = 0;
    this.groundMaterial = 'solid';

    const tiles = Level.getTilesNear(this.x, this.y, this.w, this.h);

    // ── Pass 1: Resolve X axis ──
    for (const tile of tiles) {
      const overlapX = Math.min(this.x + this.w, tile.x + tile.w) - Math.max(this.x, tile.x);
      const overlapY = Math.min(this.y + this.h, tile.y + tile.h) - Math.max(this.y, tile.y);
      if (overlapX <= 0 || overlapY <= 0) continue;

      // Only resolve as a wall if the tile rises into the body by more than
      // stepTolerance. On flat ground the next tile's top is level with the
      // floor we rest on, so gravity penetration alone (<6px) must NOT count as
      // a wall — otherwise momentum snags at every tile seam. Real walls (and
      // the full-height level edges) overlap the body far more, so still block.
      if (overlapX < overlapY && overlapY > this.stepTolerance) {
        const pushDir = (this.x + this.w / 2) < (tile.x + tile.w / 2) ? -1 : 1;
        this.x += pushDir * overlapX;
        this.vx = 0;
        this.wallDir = -pushDir;
      }
    }

    // ── Pass 2: Resolve Y axis with corner correction ──
    for (const tile of tiles) {
      const overlapX = Math.min(this.x + this.w, tile.x + tile.w) - Math.max(this.x, tile.x);
      const overlapY = Math.min(this.y + this.h, tile.y + tile.h) - Math.max(this.y, tile.y);
      if (overlapX <= 0 || overlapY <= 0) continue;

      // Vertical collision
      if (overlapY <= overlapX) {
        const pushDir = (this.y + this.h / 2) < (tile.y + tile.h / 2) ? -1 : 1;

        // Ceiling corner correction: on a ceiling bonk with small horizontal
        // overlap, slide past the corner instead of hard-stopping. Must be
        // gated to pushDir === 1 — running it on ground collisions nudges the
        // player horizontally every frame while walking along flat ground.
        if (pushDir === 1 && overlapX <= this.cornerCorrectionMax && overlapX > 0) {
          const nudgeDir = (this.x + this.w / 2) < (tile.x + tile.w / 2) ? -1 : 1;
          this.x += nudgeDir * overlapX;
          continue;
        }

        this.y += pushDir * overlapY;

        if (pushDir === -1) {
          // Track ground material (drives the treadmill speed cap)
          this.groundMaterial = tile.material || 'solid';

          // Landed
          if (this.vy > 200) {
            this.squash = 0.6;
            Audio.land();
            for (let i = 0; i < 4; i++) {
              Particles.emit(
                this.x + Math.random() * this.w, this.y + this.h,
                (Math.random() - 0.5) * 120, -(20 + Math.random() * 40),
                Tokens.rgba(Tokens.color.white, 0.3), 0.2 + Math.random() * 0.1
              );
            }
          }
          this.grounded = true;
          this.vy = 0;
        } else {
          // ── Ceiling corner correction ──
          // If we bonk a ceiling and are close to the edge, nudge sideways
          if (overlapX <= this.cornerCorrectionMax && overlapX > 0) {
            const nudgeDir = (this.x + this.w / 2) < (tile.x + tile.w / 2) ? -1 : 1;
            this.x += nudgeDir * overlapX;
          } else {
            this.vy = 0;
          }
        }
      }
    }

    // ── Ledge assist: extended ground check ──
    // Check 1-2px wider than hitbox for ground, so near-misses still land
    if (!this.grounded) {
      const footY = this.y + this.h;
      const extL = this.x - this.ledgeAssist;
      const extR = this.x + this.w + this.ledgeAssist;

      for (const tile of tiles) {
        // Check if foot is right at the top of a tile (within 2px)
        if (Math.abs(footY - tile.y) < 2) {
          // Only grab a tile whose TOP is exposed to air — i.e. a REAL ledge.
          // A wall is a vertical stack of tiles, so every interior tile's "top"
          // is buried under the tile above it. Without this check, ledge-assist
          // happily snapped Bozo onto a wall tile (grounded=true, vy=0) and
          // pinned him mid-air — which also let him jump off the wall. Reject
          // any tile that has a solid tile directly above (not a standable lip).
          const col = Math.floor(tile.x / Level.tileSize);
          const row = Math.floor(tile.y / Level.tileSize);
          if (Level._isSolid(row - 1, col)) continue;
          // Check if the extended foot overlaps the tile horizontally
          if (extR > tile.x && extL < tile.x + tile.w) {
            // Check if the actual hitbox doesn't overlap (meaning only the assist does)
            const actualOverlapX = Math.min(this.x + this.w, tile.x + tile.w) - Math.max(this.x, tile.x);
            if (actualOverlapX <= 0) {
              // Nudge player onto the platform
              if (this.x + this.w / 2 < tile.x + tile.w / 2) {
                this.x = tile.x - this.w;
              } else {
                this.x = tile.x + tile.w;
              }
              this.y = tile.y - this.h;
              this.grounded = true;
              this.vy = 0;
              break;
            }
          }
        }
      }
    }

    // ── Entity collisions: moving platforms ──
    const entitySolids = Entities.getSolidRects();
    for (const rect of entitySolids) {
      if (rect.oneWay) continue; // handle one-ways separately
      const overlapX = Math.min(this.x + this.w, rect.x + rect.w) - Math.max(this.x, rect.x);
      const overlapY = Math.min(this.y + this.h, rect.y + rect.h) - Math.max(this.y, rect.y);
      if (overlapX <= 0 || overlapY <= 0) continue;

      if (overlapY <= overlapX) {
        const pushDir = (this.y + this.h / 2) < (rect.y + rect.h / 2) ? -1 : 1;
        this.y += pushDir * overlapY;
        if (pushDir === -1) {
          this.grounded = true;
          if (this.vy > 0) this.vy = 0;
          // Ride the platform
          if (rect.isMoving) {
            this.x += rect.dx;
            this.y += rect.dy;
          }
        } else {
          this.vy = 0;
        }
      } else if (overlapX < overlapY && overlapY > this.stepTolerance) {
        const pushDir = (this.x + this.w / 2) < (rect.x + rect.w / 2) ? -1 : 1;
        this.x += pushDir * overlapX;
        this.vx = 0;
      }
    }

    // ── One-way platforms: only land on top ──
    const oneWays = Entities.getOneWayRects();
    for (const rect of oneWays) {
      const overlapX = Math.min(this.x + this.w, rect.x + rect.w) - Math.max(this.x, rect.x);
      if (overlapX <= 0) continue;
      // Only collide if player's feet are near the top of the platform and falling
      const footY = this.y + this.h;
      const prevFootY = footY - this.vy * Engine.fixedDt;
      if (this.vy >= 0 && footY >= rect.y && prevFootY <= rect.y + 6) {
        this.y = rect.y - this.h;
        this.grounded = true;
        this.vy = 0;
      }
    }

    // ── Slopes: seat the player on the diagonal surface (own pass) ──
    this.resolveSlopes();
  },

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

  // A lunge hitbox extending from Bozo's center outward in `dir` by `reach`.
  _lungeRect(dir) {
    const reach = 22;
    const hh = this.h * 0.9;                // most of the body, not just the low wheel
    const y = this.y + this.h - hh;
    const half = this.w / 2;
    const x = dir > 0 ? this.x + half : this.x + half - (half + reach);
    return { x, y, w: half + reach, h: hh };
  },

  // The attack hitbox — live during EITHER a spin-out (forward) or the braking
  // phase of a reversal (the wheel kicks out the OLD way). Both ARE the attack.
  getAttackRect() {
    if (this.spinAttackTimer > 0 && this.spinAttackDir !== 0) return this._lungeRect(this.spinAttackDir);
    if (this.runState === 'brake' && this.brakeTimer > 0 && this.attackDir !== 0) return this._lungeRect(this.attackDir);
    return null;
  },

  // Spin-out: spit the wheel forward, spend momentum (bleed speed), spray.
  _doSpinAttack() {
    this.spinAttackDir = this.travelDir;
    this.spinAttackTimer = this.spinAttackWindow;
    this._spinCooldown = this.spinAttackCooldown;
    this.vx *= (1 - this.spinAttackCost);
    this.squash = 1.2;
    Camera.shake(2);
    Audio.bounce();
    this._carnivalSpray(this.spinAttackDir);
  },

  // Multicolour carnival sand spray flung in `dir` — the wheel spinning out.
  _carnivalSpray(dir) {
    const pal = Tokens.color.carnival;
    const ox = dir > 0 ? this.x + this.w : this.x;
    const oy = this.y + this.h - this.wheelRadius;
    for (let i = 0; i < 28; i++) {
      // Fan from near-horizontal (direct hits on what's right ahead) up to a
      // high arc (rains back down onto enemies). Every particle is LETHAL —
      // the confetti is the hitbox (see checkHazards._sprayHits).
      Particles.emit(
        ox, oy + (Math.random() - 0.5) * this.h,
        dir * (170 + Math.random() * 340), -(10 + Math.random() * 260),
        pal[i % pal.length], 0.4 + Math.random() * 0.35, 4.5, true
      );
    }
  },

  // True if any LETHAL carnival-spray particle is currently overlapping `r`
  // (small padding for forgiveness). The visible confetti IS the hitbox, so a
  // wide fan reliably catches what's ahead and rains down onto enemies.
  _sprayHits(r) {
    const pool = Particles.pool;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (!p.lethal) continue;
      if (p.x >= r.x - 2 && p.x <= r.x + r.w + 2 && p.y >= r.y - 2 && p.y <= r.y + r.h + 2) return true;
    }
    return false;
  },

  checkHazards() {
    if (this.dead || this.respawning) return;

    const attack = this.getAttackRect();
    const px = this.x + this.hazardShrink;
    const py = this.y + this.hazardShrink;
    const pw = this.w - this.hazardShrink * 2;
    const ph = this.h - this.hazardShrink * 2;
    const body = { x: px, y: py, w: pw, h: ph };

    // Enemies: killable by wheel-throw or stomp; lethal on any other contact.
    // Iterate backwards so kills (which splice the list) are safe.
    for (let i = Entities.list.length - 1; i >= 0; i--) {
      const e = Entities.list[i];
      if (!e.getHazardRect || e.dead) continue;
      const r = e.getHazardRect();

      // (0) Lethal carnival spray — the confetti itself kills what it lands on.
      if (this._sprayHits(r)) { Entities.kill(e); continue; }

      // (a) Wheel-throw lunge connects.
      if (attack && aabb(attack, r)) { Entities.kill(e); continue; }

      // (b) Stomp from above (feet crossing the enemy's top while falling).
      const feet = this.y + this.h;
      const overlapH = (px + pw) > r.x && px < (r.x + r.w);
      if (this.vy >= 0 && overlapH && feet >= r.y - 6 && feet <= r.y + r.h * 0.6) {
        Entities.kill(e);
        this.vy = -260;          // bounce off
        this.squash = 1.3;
        continue;
      }

      // (c) Otherwise the enemy is lethal.
      if (aabb(body, r)) { this.die(); return; }
    }

    // Static tile hazards (none on a lean track, but kept for safety/future).
    for (const haz of Level.getHazards()) {
      if (aabb(body, haz)) { this.die(); return; }
    }
  },

  draw(ctx) {
    // Don't draw during death (particles handle the visual)
    if (this.dead) return;

    // Trail + afterimages
    for (const t of this.trail) {
      if (t.type === 'ghost') {
        ctx.fillStyle = Tokens.rgba(Tokens.color.trailGhost, t.alpha * 0.25);
        ctx.fillRect(t.x, t.y, t.w, t.h);
      } else {
        ctx.fillStyle = Tokens.rgba(Tokens.color.trailDot, t.alpha * 0.3);
        ctx.fillRect(t.x - 3, t.y - 3, 6, 6);
      }
    }

    // Squash & stretch transform origin = bottom center of hitbox (feet planted)
    const cx = this.x + this.w / 2;
    const bottomY = this.y + this.h;
    const stretchX = 1 / this.squash;
    const stretchY = this.squash;

    // Respawn invuln flash
    if (this.respawning) {
      const flash = Math.sin(this.respawnTimer * 30) > 0;
      if (flash) return; // blink invisible every other frame
    }

    ctx.save();
    ctx.translate(cx, bottomY);
    ctx.rotate(this.lean); // momentum sway about the ground-contact point
    ctx.scale(this.facing, 1); // flip horizontally based on facing
    ctx.scale(stretchX, stretchY);
    ctx.translate(-cx, -bottomY);

    if (this.spriteSheet) {
      // ── Sprite rendering ──
      const anim = this.anims[this.animState];
      const frameIdx = anim ? anim.frames[this.animFrame] : 0;
      const col = frameIdx % this.spriteColumns;
      const row = Math.floor(frameIdx / this.spriteColumns);
      const sx = col * this.spriteW;
      const sy = row * this.spriteH;
      const dx = this.x + this.spriteOffsetX;
      const dy = this.y + this.spriteOffsetY;

      ctx.drawImage(
        this.spriteSheet,
        sx, sy, this.spriteW, this.spriteH,
        Math.round(dx), Math.round(dy), this.spriteW, this.spriteH
      );
    } else {
      // ── Rect fallback (no spritesheet loaded) ──
      this._drawRectFallback(ctx);
    }

    ctx.restore();
  },

  _drawRectFallback(ctx) {
    // Procedural unicycle (no sprite sheet). Drawn in the leaned/squashed frame
    // set up by draw(), pivoting at the ground-contact point. Subtle & grounded:
    // a small wheel, a short frame, Bozo perched just above. Hitbox is unchanged.
    const footX = this.x + this.w / 2;     // ground contact (pivot x)
    const footY = this.y + this.h;         // ground contact (pivot y)
    const r = this.wheelRadius;            // 8
    const hubY = footY - r;                // wheel centre

    // Body box: compact, perched a couple px above the hitbox top.
    const bw = 12, bh = 16;
    const bodyX = footX - bw / 2;
    const bodyBottom = hubY - 5;           // short frame gap above the wheel
    const bodyTop = bodyBottom - bh;

    // ── Frame / seat-post ──
    ctx.fillStyle = Tokens.color.frame;
    ctx.fillRect(footX - 1.5, bodyBottom, 3, hubY - bodyBottom);  // post
    ctx.fillRect(footX - 4, bodyBottom - 1, 8, 2);                // saddle

    // ── Wheel (spins with wheelAngle) ──
    ctx.fillStyle = Tokens.color.wheel;
    ctx.beginPath();
    ctx.arc(footX, hubY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = Tokens.color.frame;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(footX, hubY, r - 0.75, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const a = this.wheelAngle + i * (Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(footX, hubY);
      ctx.lineTo(footX + Math.cos(a) * (r - 1), hubY + Math.sin(a) * (r - 1));
      ctx.stroke();
    }
    ctx.fillStyle = Tokens.color.frame;
    ctx.beginPath();
    ctx.arc(footX, hubY, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // ── Body ──
    ctx.fillStyle = Tokens.color.playerBody;
    ctx.fillRect(bodyX, bodyTop, bw, bh);

    // Eyes
    const eyeY = bodyTop + bh * 0.3;
    ctx.fillStyle = Tokens.color.playerEye;
    ctx.fillRect(footX - 4, eyeY, 3, 4);
    ctx.fillRect(footX + 1, eyeY, 3, 4);

    // Clown nose (clear red accent)
    ctx.fillStyle = Tokens.color.clownNose;
    ctx.beginPath();
    ctx.arc(footX, bodyTop + bh * 0.58, 2.4, 0, Math.PI * 2);
    ctx.fill();

    // ── Blue party hat: cone + 3 dots + pom-pom (sits on the crown) ──
    const hatBaseY = bodyTop + 1;
    const hatH = 11, hatHW = 6, apexX = footX + 1;   // slight tilt for a jaunty look
    ctx.fillStyle = Tokens.color.partyHat;
    ctx.beginPath();
    ctx.moveTo(footX - hatHW, hatBaseY);
    ctx.lineTo(footX + hatHW, hatBaseY);
    ctx.lineTo(apexX, hatBaseY - hatH);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = Tokens.color.partyHatDot;
    for (let i = 1; i <= 3; i++) {                   // 3 dots up the centerline
      const t = i / 4;
      ctx.beginPath();
      ctx.arc(footX + (apexX - footX) * t, hatBaseY - hatH * t, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();                                 // pom-pom at the apex
    ctx.arc(apexX, hatBaseY - hatH, 1.7, 0, Math.PI * 2);
    ctx.fill();

    // Speed lines when moving fast (anchored to the torso; tilt with the lean)
    if (Math.abs(this.vx) > 200) {
      const alpha = Math.min(0.5, (Math.abs(this.vx) - 200) / 300);
      const dir = Math.sign(this.vx) || 1;
      ctx.fillStyle = Tokens.rgba(Tokens.color.trailDot, alpha);
      for (let i = 0; i < 3; i++) {
        const ly = bodyTop + 3 + i * 5;
        ctx.fillRect(footX - dir * (bw / 2 + 4 + i * 3), ly, 6, 1);
      }
    }
  },

  // Load a spritesheet image. Call with an Image element or a URL string.
  loadSprite(src) {
    if (typeof src === 'string') {
      const img = new Image();
      img.onload = () => { this.spriteSheet = img; };
      img.src = src;
    } else {
      this.spriteSheet = src;
    }
  }
};
