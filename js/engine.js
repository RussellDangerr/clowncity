// ─── Engine: fixed-timestep game loop ───
const Engine = {
  canvas: null,
  ctx: null,
  width: 960,
  height: 540,
  fixedDt: 1 / 120,       // physics at 120 Hz for precision
  maxStepsPerFrame: 4,
  accumulator: 0,
  lastTime: 0,
  running: false,
  halted: false,           // a harness is stepping systems by hand: keep RAF alive, skip work
  hitstopTimer: 0,        // freeze frames for impact feel
  flashAlpha: 0,           // screen flash overlay
  flashColor: 'white',
  flashDecay: Tokens.motion.flashDecay,
  systems: [],             // objects with update(dt) and/or draw(ctx)

  init() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },

  resize() {
    const scale = Math.min(
      window.innerWidth / this.width,
      window.innerHeight / this.height
    );
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.canvas.style.width = (this.width * scale) + 'px';
    this.canvas.style.height = (this.height * scale) + 'px';
  },

  start() {
    this.running = true;
    this.lastTime = performance.now() / 1000;
    requestAnimationFrame(t => this.loop(t));
  },

  loop(timestamp) {
    if (!this.running) return;
    if (this.halted) {
      this.lastTime = timestamp / 1000;
      requestAnimationFrame(t => this.loop(t));
      return;
    }
    const now = timestamp / 1000;
    let frameTime = now - this.lastTime;
    this.lastTime = now;

    // Clamp to avoid spiral of death
    if (frameTime > 0.1) frameTime = 0.1;
    this.accumulator += frameTime;

    // Hitstop: skip physics updates during freeze frames
    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= frameTime;
      this.accumulator = 0;
    }

    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxStepsPerFrame) {
      for (const sys of this.systems) {
        if (sys.update) sys.update(this.fixedDt);
      }
      this.accumulator -= this.fixedDt;
      steps++;
    }

    // Draw
    this.ctx.clearRect(0, 0, this.width, this.height);
    for (const sys of this.systems) {
      if (sys.draw) sys.draw(this.ctx);
    }

    // Screen flash overlay
    if (this.flashAlpha > 0.01) {
      this.ctx.fillStyle = this.flashColor === 'white'
        ? Tokens.rgba(Tokens.color.white, this.flashAlpha)
        : Tokens.rgba(Tokens.color.flashRed, this.flashAlpha);
      this.ctx.fillRect(0, 0, this.width, this.height);
      this.flashAlpha -= this.flashDecay * frameTime;
      if (this.flashAlpha < 0) this.flashAlpha = 0;
    }

    requestAnimationFrame(t => this.loop(t));
  },

  hitstop(duration) {
    this.hitstopTimer = duration;
  },

  flash(color, intensity) {
    this.flashColor = color || 'white';
    this.flashAlpha = intensity || 0.4;
  },

  register(system) {
    this.systems.push(system);
  }
};
