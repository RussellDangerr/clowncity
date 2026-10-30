// ─── Entities: moving platforms, hazards, enemies ───
const Entities = {
  list: [],

  clear() {
    this.list = [];
  },

  // Spawn entities from a level's entity definitions
  loadFromMap(entityDefs) {
    this.clear();
    if (!entityDefs) return;
    for (const def of entityDefs) {
      if (def.type === 'platform') {
        this.list.push(new MovingPlatform(def));
      } else if (def.type === 'patrol') {
        this.list.push(new PatrolEnemy(def));
      } else if (def.type === 'oneway') {
        this.list.push(new OneWayPlatform(def));
      } else if (def.type === 'horse') {
        this.list.push(new CarouselHorse(def));
      } else if (def.type === 'ducks') {
        this.list.push(new DuckStream(def));
      } else if (def.type === 'tinduck') {
        this.list.push(new TinDuck(def));
      } else if (def.type === 'strongman') {
        this.list.push(new Strongman(def));
      } else if (def.type === 'trampoline') {
        this.list.push(new Trampoline(def));
      }
    }
  },

  update(dt) {
    for (const e of this.list) e.update(dt);
  },

  draw(ctx) {
    ctx.save();
    ctx.translate(-Camera.drawX, -Camera.drawY);
    // On a loop level, draw each copy of the map the view overlaps (see Level.draw).
    const W = Level.levelWidth;
    const k0 = Level.wrap ? Math.floor(Camera.x / W) : 0;
    const k1 = Level.wrap ? Math.floor((Camera.x + Engine.width) / W) : 0;
    for (let k = k0; k <= k1; k++) {
      ctx.save();
      ctx.translate(k * W, 0);
      for (const e of this.list) e.draw(ctx);
      ctx.restore();
    }
    ctx.restore();
  },

  // Get all solid rects the player should collide with (platforms, one-ways),
  // each at its copy nearest Poko on a loop level.
  getSolidRects() {
    const rects = [];
    for (const e of this.list) {
      if (e.getSolidRect) rects.push(Level.near(e.getSolidRect()));
      if (e.getSolidRects) for (const r of e.getSolidRects()) rects.push(Level.near(r));   // a duck stream: many rafts
    }
    return rects;
  },

  // Get all hazard rects (enemies)
  getHazardRects() {
    const rects = [];
    for (const e of this.list) {
      if (e.getHazardRect) rects.push(Level.near(e.getHazardRect()));
    }
    return rects;
  },

  // Get one-way platforms specifically (need special collision)
  getOneWayRects() {
    return this.getSolidRects().filter(r => r.oneWay);
  },

  // Kill an enemy (stomp or wheel-throw). Bursts juice and removes it.
  kill(e) {
    if (e.dead) return;
    e.dead = true;
    const at = Level.near({ x: e.x, y: e.y, w: e.w || 0, h: e.h || 0 });
    const cx = at.x + at.w / 2;
    const cy = at.y + at.h / 2;
    Particles.burst(cx, cy, 14, 160, Tokens.rgba(Tokens.color.kill, 0.85), 0.35);
    Particles.burst(cx, cy, 6, 90, Tokens.rgba(Tokens.color.white, 0.6), 0.25);
    Camera.shake(4);
    Engine.hitstop(0.04);
    Audio.bounce();
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
  }
};

// ═══════════════════════════════════════════
// MOVING PLATFORM
// Moves between two points. Player rides it.
// ═══════════════════════════════════════════
class MovingPlatform {
  constructor({ x, y, w, h, toX, toY, speed, wait }) {
    this.startX = x; this.startY = y;
    this.endX = toX ?? x; this.endY = toY ?? y;
    this.w = w || 64; this.h = h || 12;
    this.speed = speed || 60;
    this.wait = wait || 0.5;
    this.x = x; this.y = y;
    this.prevX = x; this.prevY = y;
    this.t = 0;         // 0 = at start, 1 = at end
    this.dir = 1;       // 1 = going to end, -1 = going to start
    this.waitTimer = 0;
  }

  update(dt) {
    this.prevX = this.x;
    this.prevY = this.y;

    if (this.waitTimer > 0) {
      this.waitTimer -= dt;
      return;
    }

    const dx = this.endX - this.startX;
    const dy = this.endY - this.startY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const step = (this.speed / dist) * dt;

    this.t += this.dir * step;
    if (this.t >= 1) {
      this.t = 1; this.dir = -1; this.waitTimer = this.wait;
    } else if (this.t <= 0) {
      this.t = 0; this.dir = 1; this.waitTimer = this.wait;
    }

    this.x = this.startX + dx * this.t;
    this.y = this.startY + dy * this.t;
  }

  getSolidRect() {
    return {
      x: this.x, y: this.y, w: this.w, h: this.h,
      // Delta so player can ride the platform
      dx: this.x - this.prevX,
      dy: this.y - this.prevY,
      isMoving: true
    };
  }

  draw(ctx) {
    const theme = Level.getTheme();
    ctx.fillStyle = theme.tile[1];
    ctx.fillRect(this.x, this.y, this.w, this.h);
    ctx.fillStyle = theme.tile[2];
    ctx.fillRect(this.x + 1, this.y, this.w - 2, 2);
    // Subtle edge dots to show it moves
    ctx.fillStyle = Tokens.rgba(Tokens.color.white, 0.15);
    ctx.fillRect(this.x + 4, this.y + this.h / 2 - 1, 2, 2);
    ctx.fillRect(this.x + this.w - 6, this.y + this.h / 2 - 1, 2, 2);
  }
}

// ═══════════════════════════════════════════
// ONE-WAY PLATFORM
// Player passes through from below, lands on top.
// ═══════════════════════════════════════════
class OneWayPlatform {
  constructor({ x, y, w, wire, carry }) {
    this.x = x; this.y = y;
    this.w = w || 64; this.h = 8;
    this.wire = !!wire;         // drawn as a high wire between two poles
    this.carry = carry || 0;    // a zip line: carries a rider along like the carousel deck (Player.carry)
  }

  update(dt) {}

  getSolidRect() {
    return {
      x: this.x, y: this.y, w: this.w, h: this.h,
      oneWay: true, carry: this.carry,
    };
  }

  draw(ctx) {
    const theme = Level.getTheme();
    if (this.wire) {
      // A high wire: a taut rope between two striped poles.
      ctx.fillStyle = Tokens.color.brass;
      ctx.fillRect(this.x - 4, this.y, 4, 120);
      ctx.fillRect(this.x + this.w, this.y, 4, 120);
      ctx.strokeStyle = Tokens.color.tentCream;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(this.x, this.y + 1); ctx.lineTo(this.x + this.w, this.y + 1); ctx.stroke();
      ctx.lineWidth = 1;
      // Bunting under the rope, so it reads from far below as somewhere to get to.
      const pal = Tokens.color.carnival;
      for (let fx = 8, n = 0; fx < this.w - 8; fx += 40, n++) {
        ctx.fillStyle = pal[n % pal.length];
        ctx.beginPath(); ctx.moveTo(this.x + fx, this.y + 3); ctx.lineTo(this.x + fx + 14, this.y + 3); ctx.lineTo(this.x + fx + 7, this.y + 15); ctx.closePath(); ctx.fill();
      }
      return;
    }
    // Dashed/thin platform to visually signal one-way
    ctx.fillStyle = theme.tile[2];
    for (let dx = 0; dx < this.w; dx += 8) {
      ctx.fillRect(this.x + dx, this.y, 5, 3);
    }
    // Faint line underneath
    ctx.fillStyle = Tokens.rgba(Tokens.color.white, 0.06);
    ctx.fillRect(this.x, this.y + 3, this.w, 1);
  }
}

// ═══════════════════════════════════════════
// PATROL ENEMY
// Walks back and forth on platforms. Lethal on side contact;
// killed by a stomp from above or a unicycle wheel-throw.
// ═══════════════════════════════════════════
class PatrolEnemy {
  constructor({ x, y, range, speed }) {
    this.startX = x;
    this.x = x; this.y = y;
    this.w = 20; this.h = 20;
    this.range = range || 128;
    this.speed = speed || 50;
    this.dir = 1;
    this.animTimer = 0;
    this.dead = false;
  }

  update(dt) {
    this.x += this.dir * this.speed * dt;
    this.animTimer += dt;

    // Reverse at range limits
    if (this.x > this.startX + this.range) {
      this.x = this.startX + this.range;
      this.dir = -1;
    } else if (this.x < this.startX) {
      this.x = this.startX;
      this.dir = 1;
    }
  }

  getHazardRect() {
    // Slightly smaller than visual for forgiveness
    return { x: this.x + 2, y: this.y + 2, w: this.w - 4, h: this.h - 4 };
  }

  draw(ctx) {
    // Body
    ctx.fillStyle = Tokens.color.enemy;
    ctx.fillRect(this.x, this.y, this.w, this.h);
    // Lighter middle
    ctx.fillStyle = Tokens.color.enemyLight;
    ctx.fillRect(this.x + 2, this.y + 2, this.w - 4, this.h - 4);

    // Googly eyes (LBP-inspired!)
    const eyeX = this.dir > 0 ? this.x + this.w * 0.6 : this.x + this.w * 0.2;
    const eyeX2 = this.dir > 0 ? this.x + this.w * 0.35 : this.x + this.w * 0.45;
    // White
    ctx.fillStyle = Tokens.color.eyeWhite;
    ctx.beginPath();
    ctx.arc(eyeX, this.y + 7, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(eyeX2, this.y + 7, 3.5, 0, Math.PI * 2);
    ctx.fill();
    // Pupils (jiggle slightly)
    const jiggle = Math.sin(this.animTimer * 6) * 1;
    ctx.fillStyle = Tokens.color.eyePupil;
    ctx.beginPath();
    ctx.arc(eyeX + this.dir * 1.5, this.y + 7 + jiggle, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(eyeX2 + this.dir * 1, this.y + 7 + jiggle * 0.8, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Little legs animation
    const legOffset = Math.sin(this.animTimer * 10) * 2;
    ctx.fillStyle = Tokens.color.enemyDark;
    ctx.fillRect(this.x + 3, this.y + this.h, 3, 4 + legOffset);
    ctx.fillRect(this.x + this.w - 6, this.y + this.h, 3, 4 - legOffset);
  }
}

// ═══════════════════════════════════════════
// CAROUSEL HORSE
// Rides the deck round a loop level at Level.deckSpeed, bobbing on its pole.
// Its back is a bouncy one-way top, like a rubber duck: jump up through it,
// land on it and it squeaks you back up with the deck's carry (a press as you
// land is a big hop).
// ═══════════════════════════════════════════
class CarouselHorse {
  constructor({ x, y, w, amp, period, phase, floorY, ring }) {
    this.x = x;
    this.lowY = y;              // its back at the bottom of the bob
    this.w = w || 80; this.h = 8;
    this.amp = amp || 80;       // px it rises at the top of the bob
    this.period = period || 2.4;
    this.phase = phase || 0;
    this.floorY = floorY ?? y + 64;   // where the pole meets the deck
    this.ringAhead = 150;       // px ahead of its middle: where a pressed bounce peaks
    this.ringRise = 187;        // px from the bottom of the bob up to the catch area's top
    this.t = 0;
    this.y = this._bobY();
    this.prevY = this.y;
    // A brass ring hung from the canopy just ahead of this horse: it turns with
    // the horse but hangs at a fixed height (bobbing with it put it out of reach
    // whenever the horse moved during the hop). Its catch area is big, so a
    // pressed bounce from any height of the bob and anywhere on its back passes
    // through it; a deck jump tops out below it.
    if (ring) {
      this.ring = { x: 0, y: 0, w: 48, h: 80, collected: false };
      Level.rings.push(this.ring);
      this._placeRing();
    }
  }

  _placeRing() {
    const W = Level.levelWidth, dir = Math.sign(Level.deckSpeed) || 1;
    this.ring.x = ((this.x + this.w / 2 - this.ring.w / 2 + dir * this.ringAhead) % W + W) % W;
    this.ring.y = this.lowY - this.ringRise;
  }

  _bobY() {
    return this.lowY - this.amp * (0.5 - 0.5 * Math.cos(2 * Math.PI * this.t / this.period + this.phase));
  }

  update(dt) {
    this.t += dt;
    this.prevY = this.y;
    this.y = this._bobY();
    // Round the loop, kept in map space (Level.near finds the copy beside Poko).
    const W = Level.levelWidth;
    this.x = (((this.x + Level.deckSpeed * dt) % W) + W) % W;
    if (this.ring) this._placeRing();
  }

  getSolidRect() {
    return {
      x: this.x, y: this.y, w: this.w, h: this.h,
      oneWay: true,
      bounce: true,
      dy: this.y - this.prevY,
      carry: Level.deckSpeed,
    };
  }

  draw(ctx) {
    const [body, saddle, mane] = Tokens.color.horse;
    const dir = Math.sign(Level.deckSpeed) || 1;
    const cx = this.x + this.w / 2, top = this.y;
    const gallop = Math.sin(2 * Math.PI * this.t / this.period + this.phase);
    // Brass pole, from above the view down to the deck: the horse slides on it.
    ctx.strokeStyle = Tokens.color.brass;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, Camera.y); ctx.lineTo(cx, this.floorY); ctx.stroke();
    // Ring B's arm: from this horse's pole out to the ring's string, so it reads as this horse's ring.
    if (this.ring && !this.ring.collected) {
      const rx = this.ring.x + this.ring.w / 2, armY = this.ring.y + this.ring.h / 2 - 34;
      if (Math.abs(rx - cx) < 400) {
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, armY); ctx.lineTo(rx, armY); ctx.stroke();
      }
    }
    // Legs, tucked and stretched with the bob.
    ctx.strokeStyle = body;
    ctx.lineWidth = 4;
    for (const [lx, swing] of [[-20, 1], [-12, -1], [14, 1], [22, -1]]) {
      const x0 = cx + dir * lx;
      ctx.beginPath(); ctx.moveTo(x0, top + 14); ctx.lineTo(x0 + dir * swing * gallop * 6, top + 26); ctx.stroke();
    }
    // Body: its top edge is the surface Poko lands on.
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(cx, top + 10, this.w / 2 - 8, 10, 0, 0, Math.PI * 2); ctx.fill();
    // Neck and head, reaching the way the deck turns.
    ctx.beginPath();
    ctx.moveTo(cx + dir * 18, top + 4);
    ctx.lineTo(cx + dir * 32, top - 14);
    ctx.lineTo(cx + dir * 42, top - 10);
    ctx.lineTo(cx + dir * 30, top + 10);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + dir * 40, top - 12, 8, 5, dir * 0.4, 0, Math.PI * 2); ctx.fill();
    // Mane and tail.
    ctx.strokeStyle = mane;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx + dir * 18, top + 2); ctx.lineTo(cx + dir * 31, top - 15); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - dir * 30, top + 6); ctx.quadraticCurveTo(cx - dir * 42, top + 8 + gallop * 3, cx - dir * 38, top + 20); ctx.stroke();
    // Saddle, and an eye.
    ctx.fillStyle = saddle;
    ctx.fillRect(cx - 10, top, 20, 5);
    ctx.fillStyle = Tokens.color.eyePupil;
    ctx.beginPath(); ctx.arc(cx + dir * 42, top - 13, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1;
  }
}

// ═══════════════════════════════════════════
// DUCK STREAM
// Rubber ducks floating down a river at the current's speed, from x0 to x1.
// `gaps` (px, cycled) is the spacing between ducks; since they all drift
// together it never changes, so seen from a duck the river is a fixed row of
// stepping stones. Each duck is a bouncy one-way top: landing squeaks Poko
// back up (Player.duckBounce) and hands him the current (carry). A duck with a
// big gap ahead of it is pink: that's the one to press on.
// ═══════════════════════════════════════════
class DuckStream {
  constructor({ x0, x1, y, speed, gaps }) {
    this.x0 = x0; this.x1 = x1;
    this.y = y;                     // raft top (the duck's back) on calm water
    this.speed = speed || 120;      // + = downstream to the right
    this.gaps = gaps || [192];
    this.w = 64; this.h = 8;
    this.ducks = [];                // { x, t, big } — t only staggers the bob; big = a press-sized gap ahead
    this.gi = 0;                    // next gap in the cycle
    this.sinceSpawn = 0;            // px drifted since the last duck appeared
    this.t = 0;
    // Start with the river already full: drift a whole crossing's worth.
    this._spawn(0);
    const fill = Math.abs(this.x1 - this.x0) / Math.abs(this.speed);
    for (let s = 0; s < fill; s += 0.05) this._drift(0.05);
  }

  _spawn(ahead, big) {
    const dir = Math.sign(this.speed);
    this.ducks.push({ x: (dir > 0 ? this.x0 : this.x0 - this.w) + dir * ahead, t: Math.random() * 6, big });
  }

  _drift(dt) {
    const step = this.speed * dt;
    for (const d of this.ducks) d.x += step;
    // A duck is gone once its back end passes x1 (it drifts under the bank).
    const dir = Math.sign(this.speed);
    this.ducks = this.ducks.filter(d => (dir > 0 ? d.x < this.x1 : d.x + this.w > this.x1));
    this.sinceSpawn += Math.abs(step);
    const gap = this.gaps[this.gi % this.gaps.length];
    if (this.sinceSpawn >= gap) {
      this.sinceSpawn -= gap;
      this.gi++;
      this._spawn(this.sinceSpawn, gap > 200);   // carry the leftover so spacing stays exact
    }
  }

  update(dt) {
    for (const d of this.ducks) d.prevY = this._bobY(d);
    this.t += dt;
    this._drift(dt);
  }

  _bobY(d) {
    return this.y + Math.sin((this.t + d.t) * 3) * 1.5;
  }

  getSolidRects() {
    return this.ducks.map(d => {
      const y = this._bobY(d);
      return { x: d.x, y, w: this.w, h: this.h, oneWay: true, bounce: true, carry: this.speed, dy: y - (d.prevY ?? y) };
    });
  }

  draw(ctx) {
    const dir = Math.sign(this.speed) || 1;
    for (const d of this.ducks) {
      const [body, beak, shade] = d.big ? Tokens.color.duckBig : Tokens.color.duck;
      // Fade in and out at the ends, where they slip out from under the banks.
      const into = Math.abs(d.x - this.x0), left = Math.abs(this.x1 - d.x);
      ctx.globalAlpha = Math.max(0, Math.min(1, into / 24, left / 24));
      const top = this._bobY(d), cx = d.x + this.w / 2;
      ctx.fillStyle = shade;
      ctx.beginPath(); ctx.ellipse(cx, top + 9, this.w / 2, 7, 0, 0, Math.PI); ctx.fill();
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.ellipse(cx, top + 7, this.w / 2 - 2, 8, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - this.w / 2 + 2, top + 6, this.w - 4, 4);
      // Tail flick at the back, head and beak at the front (facing downstream).
      ctx.beginPath(); ctx.moveTo(cx - dir * (this.w / 2 - 2), top + 6); ctx.lineTo(cx - dir * (this.w / 2 + 5), top - 2); ctx.lineTo(cx - dir * (this.w / 2 - 8), top + 2); ctx.fill();
      const hx = cx + dir * (this.w / 2 - 12);
      ctx.beginPath(); ctx.arc(hx, top - 6, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = beak;
      ctx.beginPath(); ctx.moveTo(hx + dir * 6, top - 8); ctx.lineTo(hx + dir * 15, top - 5); ctx.lineTo(hx + dir * 6, top - 2); ctx.fill();
      ctx.fillStyle = Tokens.color.eyePupil;
      ctx.beginPath(); ctx.arc(hx + dir * 3, top - 9, 1.5, 0, Math.PI * 2); ctx.fill();
      if (d.big) {                      // a little up-arrow over its back: press here
        const ay = top - 22 + Math.sin(this.t * 6) * 2;
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.moveTo(cx - 8, ay); ctx.lineTo(cx, ay - 9); ctx.lineTo(cx + 8, ay); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}

// ═══════════════════════════════════════════
// TIN DUCK (shooting gallery)
// Rides a rail from x0 to x1, then pops back to x0, like a gallery conveyor.
// The spray or the lunge knocks it down (Player.checkTargets); the last one
// down lowers the drawbridge (Level.targetHit). Harmless to touch.
// ═══════════════════════════════════════════
class TinDuck {
  constructor({ x0, x1, y, speed, offset }) {
    this.x0 = x0; this.x1 = x1;
    this.y = y;                     // top of the duck; the rail runs under it
    this.w = 20; this.h = 22;
    this.speed = speed || 60;
    this.x = x0 + (offset || 0) % (x1 - x0);
    this.down = false;
    this.fall = 0;                  // 0..1 tipping over once hit
  }

  update(dt) {
    if (this.down) { this.fall = Math.min(1, this.fall + dt * 4); return; }
    this.x += this.speed * dt;
    if (this.x > this.x1 - this.w) this.x -= (this.x1 - this.x0 - this.w);
  }

  getTargetRect() {
    return this.down ? null : { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  knock() {
    if (this.down) return;
    this.down = true;
    const at = Level.near({ x: this.x, y: this.y, w: this.w, h: this.h });
    Particles.burst(at.x + this.w / 2, at.y + this.h / 2, 12, 140, Tokens.rgba(Tokens.color.white, 0.8), 0.3);
    Camera.shake(2);
    Engine.hitstop(0.03);
    Audio.collect();
    Level.targetHit();
  }

  draw(ctx) {
    const [face, shade, target] = Tokens.color.tin;
    // The rail (every tin duck draws it; they share one).
    ctx.fillStyle = Tokens.color.brass;
    ctx.fillRect(this.x0, this.y + this.h, this.x1 - this.x0, 3);
    if (this.fall >= 1) return;
    // Tip backwards about the foot of the duck as it falls.
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h);
    ctx.rotate(-this.fall * Math.PI / 2);
    ctx.globalAlpha = 1 - this.fall * 0.6;
    ctx.fillStyle = shade;
    ctx.fillRect(-2, -4, 4, 4);                       // peg on the rail
    ctx.fillStyle = face;
    ctx.beginPath(); ctx.ellipse(0, -9, 10, 6, 0, 0, Math.PI * 2); ctx.fill();   // body
    ctx.beginPath(); ctx.arc(5, -17, 5, 0, Math.PI * 2); ctx.fill();             // head
    ctx.fillStyle = shade;
    ctx.beginPath(); ctx.moveTo(10, -18); ctx.lineTo(15, -16); ctx.lineTo(10, -14); ctx.fill();  // beak
    ctx.strokeStyle = target;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(-2, -9, 3.5, 0, Math.PI * 2); ctx.stroke();          // bullseye
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  }
}

// ═══════════════════════════════════════════
// STRONGMAN (the high striker)
// One machine, every part moving on its own physics, LittleBigPlanet-style:
//   hanging  the hammer sways on its hook; touching the grab box takes it
//            (Player.hauling: the wheel locks, he drops straight down)
//   carried  until he lands. On the plate the hammer strikes: the lever kicks
//            and the puck launches by how high over the top floor he left
//            (higher, harder), with the camera riding along (Camera.focus)
//   flight   the puck rises, rings the bell if it reaches it (that opens the
//            goal), falls back and settles on the lever
//   return   the camera comes home, then Poko lets go and rolls on. No ring:
//            the hammer goes back on its hook and Poko back to his last
//            checkpoint (the top of the tower), for another go.
// The grade is the skill: a roll is a WEAKLING, a jump is NOT BAD, and a pumped
// bounce off the top floor's trampoline rings the bell.
// ═══════════════════════════════════════════
class Strongman {
  constructor({ hammerX, hammerY, grab, plateX0, plateX1, groundY, topY, trackX, bellY }) {
    Object.assign(this, { hammerX, hammerY, grab, plateX0, plateX1, groundY, topY, trackX, bellY });
    this.rollFrac = 0.25;        // how far up the pole a plain roll off the top floor sends the puck
    this.ringRise = 160;         // px over the top floor he must leave at to ring: a jump is ~90, a pumped bounce ~200
    this.puckGravity = 600;      // px/s^2 — floaty, so the camera can ride along
    this.state = 'hanging';
    this.t = 0;
    this.timer = 0;              // return: time until Poko lets go
    this.dingTimer = 0;          // camera holds on the bell while > 0
    this.pivotX = (plateX0 + trackX) / 2;
    this.lever = 0; this.leverV = 0;       // beam angle (− = plate end down) and its spin
    this.puckRest = groundY - 14;          // puck centre, sitting on the lever's far end
    this.puckY = this.puckRest; this.puckV = 0; this.puckTop = this.puckY;
    this.bell = 0; this.bellV = 0;         // bell swing
    this.topple = 0; this.toppleV = 0;     // the dropped hammer falling over (0 upright → π/2 lying)
    this.dropX = 0;                        // where the hammer came down
    this.cam = { x: trackX, y: this.puckY };
    Level.needsBell = true;
  }

  get bellBottom() { return this.bellY + 22; }

  update(dt) {
    this.t += dt;
    // Lever and bell are damped springs; the dropped hammer topples under gravity.
    this.leverV += (-60 * this.lever - 5 * this.leverV) * dt;
    this.lever += this.leverV * dt;
    this.bellV += (-30 * this.bell - 1.2 * this.bellV) * dt;
    this.bell += this.bellV * dt;
    if (this.state === 'return' || this.state === 'done') {
      if (this.topple < Math.PI / 2 || this.toppleV < 0) {
        this.toppleV += 9 * Math.sin(this.topple + 0.05) * dt;
        this.topple += this.toppleV * dt;
        if (this.topple >= Math.PI / 2) { this.topple = Math.PI / 2; this.toppleV = -this.toppleV * 0.3; }
      }
    }

    if (this.state === 'hanging') {
      if (!Player.dead && !Player.finished && aabb(Player, this.grab)) this._grab();
    } else if (this.state === 'carried') {
      if (!Player.hauling) { this.state = 'hanging'; return; }      // a restart took it away
      if (Player.grounded) this._strike(Player.y - Player.airTop);
    } else if (this.state === 'flight') {
      this._puck(dt);
      if (this.dingTimer > 0) this.dingTimer -= dt;
      this.cam.y = this.dingTimer > 0 ? this.bellY + 60 : this.puckY;
      if (this.puckV === 0 && this.dingTimer <= 0) {
        this.state = 'return';
        this.timer = 0.6;
        Camera.focus = null;
      }
    } else if (this.state === 'return') {
      this.timer -= dt;
      if (this.timer <= 0) this._release();
    }
  }

  _grab() {
    this.state = 'carried';
    Player.hauling = true;
    Player.vx = 0;
    Player.carry = 0;
    Player.squash = 0.8;
    Audio.grab();
    Camera.shake(2);
  }

  _strike(drop) {
    this.dropX = Player.x + Player.w / 2;
    this.topple = 0; this.toppleV = 0;
    Camera.shake(10);
    Engine.hitstop(0.08);
    Audio.land();
    Particles.burst(this.dropX, this.groundY, 24, 220, Tokens.rgba(Tokens.color.dust, 0.7), 0.4);
    if (this.dropX < this.plateX0 || this.dropX > this.plateX1) {   // missed the plate: just a thud
      this.state = 'return';
      this.timer = 0.4;
      return;
    }
    this.state = 'flight';
    this.leverV = -9;                                               // plate end slams down
    this.puckY = this.puckRest;
    // The whole tower is the same for everyone, so only the height he added over
    // the top floor grades the hit. No ceiling: past the bell it just rings harder.
    const pole = this.puckRest - this.bellBottom;
    const rise = Math.max(0, drop - (this.groundY - this.topY));
    const frac = this.rollFrac + (1 - this.rollFrac) * rise / this.ringRise;
    this.puckV = -Math.sqrt(2 * this.puckGravity * pole * frac);
    this.puckTop = this.puckY;
    this.cam.x = this.trackX;
    this.cam.y = this.puckY;
    Camera.focus = this.cam;
    Audio.bounce();
  }

  _puck(dt) {
    this.puckV += this.puckGravity * dt;          // + = down
    this.puckY += this.puckV * dt;
    this.puckTop = Math.min(this.puckTop, this.puckY);
    if (this.puckV < 0 && this.puckY - 6 <= this.bellBottom) {   // DING
      this.puckY = this.bellBottom + 6;
      this.puckV = -this.puckV * 0.3;
      this._ring();
    }
    if (this.puckV > 0 && this.puckY >= this.puckRest) {         // back on the lever
      this.puckY = this.puckRest;
      this.leverV += this.puckV * 0.004;                          // lands on the far end: plate end kicks up
      this.puckV = this.puckV > 150 ? -this.puckV * 0.25 : 0;
    }
  }

  _ring() {
    Level.bellRung = true;
    this.bellV = 7;
    this.dingTimer = 1.0;
    Engine.flash('white', 0.3);
    Camera.shake(5);
    Audio.checkpoint();
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 220;
      Particles.emit(this.trackX, this.bellY + 10, Math.cos(a) * sp, Math.sin(a) * sp,
        Tokens.color.carnival[i % Tokens.color.carnival.length], 0.6 + Math.random() * 0.5, 4.5);
    }
  }

  _release() {
    this.state = Level.bellRung ? 'done' : 'hanging';
    if (!Player.hauling) return;
    Player.hauling = false;
    if (!Level.bellRung) {               // too weak: back up to the last checkpoint for another go
      Player.respawn();
      Camera.snapToPlayer();
      return;
    }
    Player.vx = 0;
    Player.runState = 'ramp';
    Player.rampT = 0;
    Player.rampTime = Player.respawnRampTime;
  }

  // The hammer, its head centred at (hx, hy), the handle pointing at angle a
  // from straight up (clockwise). The grip is the handle's far end.
  _drawHammer(ctx, hx, hy, a) {
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(a);
    ctx.fillStyle = Tokens.color.plank[2];
    ctx.fillRect(-2, -38, 4, 34);                         // handle
    ctx.fillStyle = Tokens.color.tentRed;
    ctx.fillRect(-16, -9, 32, 18);                        // head
    ctx.fillStyle = Tokens.color.tentCream;
    ctx.fillRect(-16, -9, 5, 18);
    ctx.fillRect(11, -9, 5, 18);
    ctx.restore();
  }

  draw(ctx) {
    const top = this.bellBottom, rest = this.puckRest;
    // Track: a striped pole from the lever up to the bell, with the classic grades.
    for (let y = rest; y > top; y -= 32) {
      ctx.fillStyle = (Math.round((rest - y) / 32) & 1) ? Tokens.color.tentCream : Tokens.color.tentRed;
      ctx.fillRect(this.trackX - 5, Math.max(top, y - 32), 10, Math.min(32, y - top));
    }
    ctx.font = Tokens.font.xs;
    ctx.textAlign = 'left';
    for (const [f, label] of [[0.2, 'WEAKLING'], [0.45, 'NOT BAD'], [0.7, 'STRONG!'], [0.92, 'STRONGMAN!']]) {
      const y = rest - (rest - top) * f;
      const passed = this.puckTop <= y;
      ctx.fillStyle = passed ? Tokens.rgba(Tokens.color.gold, 0.95) : Tokens.rgba(Tokens.color.dust, 0.45);
      ctx.fillRect(this.trackX + 6, y - 1, 8, 2);
      ctx.fillText(label, this.trackX + 18, y + 4);
    }
    // Bell, swinging from its top.
    ctx.save();
    ctx.translate(this.trackX, this.bellY - 4);
    ctx.rotate(this.bell * 0.2);
    ctx.fillStyle = Tokens.color.goldBright;
    ctx.beginPath();
    ctx.moveTo(-14, 26); ctx.quadraticCurveTo(-14, 0, 0, 0); ctx.quadraticCurveTo(14, 0, 14, 26);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = Tokens.color.goldShade;
    ctx.fillRect(-17, 24, 34, 4);
    ctx.restore();
    if (this.dingTimer > 0) {
      ctx.font = Tokens.font.heading;
      ctx.textAlign = 'center';
      ctx.fillStyle = Tokens.rgba(Tokens.color.charged, Math.min(1, this.dingTimer * 2));
      ctx.fillText('DING!', this.trackX, this.bellY - 18 - (1 - this.dingTimer) * 20);
    }
    // Puck.
    ctx.fillStyle = Tokens.color.clownNose;
    ctx.fillRect(this.trackX - 9, this.puckY - 6, 18, 12);
    // Lever: a beam on a pivot, the plate at its near end.
    ctx.save();
    ctx.translate(this.pivotX, this.groundY - 6);
    ctx.rotate(this.lever);
    const half = this.trackX - this.pivotX + 12;
    ctx.fillStyle = Tokens.color.plank[1];
    ctx.fillRect(-half, -3, half * 2, 6);
    ctx.fillStyle = Tokens.color.brass;
    ctx.fillRect(this.plateX0 - this.pivotX, -6, this.plateX1 - this.plateX0, 6);
    ctx.restore();
    ctx.fillStyle = Tokens.color.plank[0];
    ctx.beginPath();
    ctx.moveTo(this.pivotX, this.groundY - 6); ctx.lineTo(this.pivotX - 10, this.groundY); ctx.lineTo(this.pivotX + 10, this.groundY);
    ctx.closePath(); ctx.fill();
    // Hammer.
    if (this.state === 'hanging') {
      const sway = Math.sin(this.t * 1.3) * 0.08;
      const hookY = this.hammerY - 34;
      ctx.strokeStyle = Tokens.rgba(Tokens.color.dust, 0.6);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.hammerX, Camera.y); ctx.lineTo(this.hammerX, hookY); ctx.stroke();
      this._drawHammer(ctx, this.hammerX + Math.sin(sway) * 34, hookY + Math.cos(sway) * 34, -sway);
    } else if (this.state === 'carried') {
      this._drawHammer(ctx, Player.x + Player.w / 2, Player.y - 18, Math.PI + Math.sin(this.t * 20) * 0.05);
    } else {
      this._drawHammer(ctx, this.dropX, this.groundY - 15, this.topple);
    }
    ctx.textAlign = 'left';
  }
}

// ═══════════════════════════════════════════
// TRAMPOLINE
// A one-way bounce pad that gives back the height Poko fell (Player.trampReturn
// of it, or trampPump with a press as he lands). In a pit it's a safety net
// that bounces him back up to the ledge he missed; pumped, it can launch him
// far higher than he started. On a floor it's a run-up (the Strongman's top).
// ═══════════════════════════════════════════
class Trampoline {
  constructor({ x, y, w, leg }) {
    this.x = x; this.y = y;
    this.w = w || 96; this.h = 8;
    this.leg = leg || 8;        // px of frame down to whatever it stands on
    this.sag = 0;               // the bed dips when he lands and springs back
  }

  update(dt) {
    if (Player.trampDrop > 0 && Player.x + Player.w > this.x && Player.x < this.x + this.w &&
        Math.abs(Player.y + Player.h - this.y) < 2) this.sag = 1;
    this.sag = Math.max(0, this.sag - dt * 5);
  }

  getSolidRect() {
    return { x: this.x, y: this.y, w: this.w, h: this.h, oneWay: true, bounce: true, elastic: true, carry: 0 };
  }

  draw(ctx) {
    const dip = Math.sin(this.sag * Math.PI) * 6;
    // Legs every few tiles down to the floor beneath.
    ctx.fillStyle = Tokens.color.plank[1];
    for (let lx = this.x + 6; lx < this.x + this.w - 4; lx += 64) ctx.fillRect(lx, this.y + 4, 4, this.leg);
    ctx.fillRect(this.x + this.w - 10, this.y + 4, 4, this.leg);
    // Striped bed (red / cream), dipping in the middle when he lands.
    for (let bx = 0; bx < this.w; bx += 16) {
      const mid = 1 - Math.abs((bx + 8) / this.w * 2 - 1);
      ctx.fillStyle = (bx / 16) & 1 ? Tokens.color.tentCream : Tokens.color.tentRed;
      ctx.fillRect(this.x + bx, this.y + dip * mid, Math.min(16, this.w - bx), 6);
    }
    ctx.fillStyle = Tokens.color.brass;
    ctx.fillRect(this.x - 2, this.y - 1, 4, 8);
    ctx.fillRect(this.x + this.w - 2, this.y - 1, 4, 8);
  }
}
