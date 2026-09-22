// ─── Camera: smooth follow with lookahead ───
const Camera = {
  x: 0, y: 0,
  targetX: 0, targetY: 0,
  smoothing: 5,
  lookaheadX: 60,
  lookaheadY: 30,
  shakeAmount: 0,
  shakeDecay: Tokens.motion.shakeDecay,

  // Pixel-snapped render offsets. Physics keeps the exact float x/y (so the
  // follow stays smooth), but DRAWING rounds to whole pixels. If the draw
  // offset is fractional, every tile edge lands mid-pixel; fillRect then
  // anti-aliases those edges and the dark background bleeds through the joins
  // as shimmering "seams". Rounding once here means the world, entities, and
  // player all share the SAME integer offset, so they stay perfectly aligned.
  get drawX() { return Math.round(this.x); },
  get drawY() { return Math.round(this.y); },

  update(dt) {
    // Target: player center with lookahead based on velocity
    const px = Player.x + Player.w / 2;
    const py = Player.y + Player.h / 2;

    // Lead the direction Poko is actually travelling (facing is frozen in the
    // unicycle rework), falling back to committed travelDir during the brake pause.
    const travelDir = Math.sign(Player.vx) || Player.travelDir || 1;
    const lookX = travelDir * this.lookaheadX;
    const lookY = (Player.vy > 0 ? 1 : Player.vy < 0 ? -0.5 : 0) * this.lookaheadY;

    this.targetX = px + lookX - Engine.width / 2;
    this.targetY = py + lookY - Engine.height / 2;

    // Clamp to level bounds
    this.targetX = Math.max(0, Math.min(this.targetX, Level.levelWidth - Engine.width));
    this.targetY = Math.max(0, Math.min(this.targetY, Level.levelHeight - Engine.height));

    // Smooth interpolation
    this.x += (this.targetX - this.x) * this.smoothing * dt;
    this.y += (this.targetY - this.y) * this.smoothing * dt;

    // Screenshake
    if (this.shakeAmount > 0.5) {
      this.x += (Math.random() - 0.5) * this.shakeAmount;
      this.y += (Math.random() - 0.5) * this.shakeAmount;
      this.shakeAmount -= this.shakeDecay * dt;
    } else {
      this.shakeAmount = 0;
    }
  },

  shake(amount) {
    this.shakeAmount = amount;
  },

  snapTo(x, y) {
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;
  },

  snapToPlayer() {
    const px = Player.x + Player.w / 2;
    const py = Player.y + Player.h / 2;
    const travelDir = Player.travelDir || 1;
    const tx = Math.max(0, Math.min(px + travelDir * this.lookaheadX - Engine.width / 2, Level.levelWidth - Engine.width));
    const ty = Math.max(0, Math.min(py - Engine.height / 2, Level.levelHeight - Engine.height));
    this.snapTo(tx, ty);
  }
};
