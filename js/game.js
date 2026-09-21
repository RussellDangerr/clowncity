// ─── Game: main entry point + state machine ───
// States: title -> levelSelect -> playing -> levelComplete -> (next level or win)
// Pause overlay available during 'playing'
const Game = {
  state: 'title',
  timer: 0,
  levelTimer: 0,
  tentTimer: 0,
  _tentMouth: null,
  currentLevel: 0,
  totalLevels: 0,
  transitionAlpha: 0,
  transitionDir: 0,
  transitionCallback: null,
  totalDeaths: 0,
  totalGems: 0,

  // Save data
  save: {
    levelsComplete: [],     // boolean per level
    bestDeaths: [],         // best (lowest) death count per level
    gemsCollected: [],      // gems collected per level (count)
    totalGemsPerLevel: [],  // total possible per level
  },

  init() {
    Engine.init();
    Input.init();
    Audio.init();
    Layout.init();
    Controls.init();
    this.totalLevels = Level.maps.length;
    this.loadSave();

    // Register systems in update/draw order.
    // Input must run LAST so it clears single-frame flags (justPressed)
    // only after every consumer has had a chance to read them this frame.
    Engine.register(this);
    Engine.register(Level);
    Engine.register(Entities);
    Engine.register(Particles);
    Engine.register({
      update(dt) {
        if (Game.state === 'playing' || Game.state === 'levelComplete') {
          Player.update(dt);
        }
      },
      draw(ctx) {
        if (Game.state === 'playing' || Game.state === 'levelComplete' || Game.state === 'paused') {
          ctx.save();
          ctx.translate(-Camera.drawX, -Camera.drawY);
          Player.draw(ctx);
          ctx.restore();
        }
      }
    });
    Engine.register(Camera);
    Engine.register({ draw(ctx) { Game.drawOverlay(ctx); } });
    Engine.register(Controls);   // syncs the DOM UI to Game.state (before Input, like every consumer)
    Engine.register(Input);

    Engine.start();
  },

  // ── Save / Load ──
  loadSave() {
    try {
      const raw = localStorage.getItem('clowncity_save');
      if (raw) {
        const data = JSON.parse(raw);
        // Only merge valid arrays
        if (Array.isArray(data.levelsComplete)) this.save.levelsComplete = data.levelsComplete;
        if (Array.isArray(data.bestDeaths)) this.save.bestDeaths = data.bestDeaths;
        if (Array.isArray(data.gemsCollected)) this.save.gemsCollected = data.gemsCollected;
        if (Array.isArray(data.totalGemsPerLevel)) this.save.totalGemsPerLevel = data.totalGemsPerLevel;
      }
    } catch (e) { /* ignore corrupt saves */ }
    // Ensure arrays are properly sized
    while (this.save.levelsComplete.length < this.totalLevels) this.save.levelsComplete.push(false);
    while (this.save.bestDeaths.length < this.totalLevels) this.save.bestDeaths.push(-1);
    while (this.save.gemsCollected.length < this.totalLevels) this.save.gemsCollected.push(0);
    while (this.save.totalGemsPerLevel.length < this.totalLevels) this.save.totalGemsPerLevel.push(0);
  },

  writeSave() {
    try {
      localStorage.setItem('clowncity_save', JSON.stringify(this.save));
    } catch (e) { /* localStorage full or disabled */ }
  },

  // ── Transition helpers ──
  fadeToBlack(callback) {
    this.transitionDir = 1;
    this.transitionAlpha = 0;
    this.transitionCallback = callback;
  },

  fadeFromBlack() {
    this.transitionDir = -1;
    this.transitionAlpha = 1;
    this.transitionCallback = null;
  },

  loadLevel(index) {
    this.currentLevel = index;
    Level.load(index);
    Player.setCheckpoint(Level.spawnX, Level.spawnY);
    Player.spawn(Level.spawnX, Level.spawnY);
    Player.deathCount = 0;
    this.levelTimer = 0;
    Camera.snapToPlayer();
    // Store total collectibles for save data
    this.save.totalGemsPerLevel[index] = Level.totalCollectibles;
  },

  update(dt) {
    this.timer += dt;

    // ── Transition fade ──
    if (this.transitionDir !== 0) {
      this.transitionAlpha += this.transitionDir * dt * 3;
      if (this.transitionDir === 1 && this.transitionAlpha >= 1) {
        this.transitionAlpha = 1;
        this.transitionDir = 0;
        if (this.transitionCallback) this.transitionCallback();
      } else if (this.transitionDir === -1 && this.transitionAlpha <= 0) {
        this.transitionAlpha = 0;
        this.transitionDir = 0;
      }
      return;
    }

    // ── State dispatch ──
    if (this.state === 'title') this.updateTitle(dt);
    else if (this.state === 'levelSelect') this.updateLevelSelect(dt);
    else if (this.state === 'playing') this.updatePlaying(dt);
    else if (this.state === 'levelComplete') this.updateLevelComplete(dt);
    else if (this.state === 'tentFinale') this.updateTentFinale(dt);
    else if (this.state === 'paused') this.updatePaused(dt);
    else if (this.state === 'win') this.updateWin(dt);
  },

  // ── TITLE ──
  updateTitle(dt) {
    if (Input.pressed('Space') || Input.pressed('Enter') || Input.pressed('KeyZ') || Input.tapped()) {
      Audio.uiSelect();
      this.fadeToBlack(() => {
        this.state = 'levelSelect';
        this.timer = 0;
        this.fadeFromBlack();
      });
    }
    // Mute toggle
    if (Input.pressed('KeyM')) Audio.toggle();
  },

  // ── LEVEL SELECT ──
  _selectedLevel: 0,

  updateLevelSelect(dt) {
    // Navigate (arrows/keys or a horizontal swipe)
    if (Input.pressed('ArrowRight') || Input.pressed('KeyD') || Input.swipeEdge() > 0) {
      this._selectedLevel = Math.min(this._selectedLevel + 1, this.totalLevels - 1);
      Audio.uiSelect();
    }
    if (Input.pressed('ArrowLeft') || Input.pressed('KeyA') || Input.swipeEdge() < 0) {
      this._selectedLevel = Math.max(this._selectedLevel - 1, 0);
      Audio.uiSelect();
    }
    // Check if level is accessible (previous level complete, or it's level 0)
    const accessible = this._selectedLevel === 0 || this.save.levelsComplete[this._selectedLevel - 1];

    // Select (confirm key or a tap)
    if ((Input.pressed('Space') || Input.pressed('Enter') || Input.pressed('KeyZ') || Input.tapped()) && accessible) {
      Audio.uiSelect();
      this.fadeToBlack(() => {
        this.state = 'playing';
        this.totalDeaths = 0;
        this.totalGems = 0;
        this.loadLevel(this._selectedLevel);
        this.fadeFromBlack();
      });
    }
    // Back to title
    if (Input.pressed('Escape')) {
      this.fadeToBlack(() => {
        this.state = 'title';
        this.fadeFromBlack();
      });
    }
    if (Input.pressed('KeyM')) Audio.toggle();
  },

  // ── PLAYING ──
  updatePlaying(dt) {
    this.levelTimer += dt;

    if (Input.pressed('Escape') || Input.pressed('KeyP')) {
      this.state = 'paused';
      return;
    }
    if (Input.pressed('KeyM')) Audio.toggle();

    if (Player.dead) return;

    // Checkpoints
    for (const cp of Level.checkpoints) {
      if (!cp.active &&
          Player.x + Player.w > cp.x && Player.x < cp.x + cp.w &&
          Player.y + Player.h > cp.y && Player.y < cp.y + cp.h) {
        for (const other of Level.checkpoints) other.active = false;
        cp.active = true;
        Player.setCheckpoint(cp.x, cp.y);
        Particles.burst(cp.x + cp.w / 2, cp.y + cp.h / 2, 12, 100, Tokens.rgba(Tokens.color.goldFlag, 0.7), 0.3);
        Audio.checkpoint();
      }
    }

    // Collectibles
    for (const col of Level.collectibles) {
      if (!col.collected &&
          Player.x + Player.w > col.x + 4 && Player.x < col.x + col.w - 4 &&
          Player.y + Player.h > col.y + 4 && Player.y < col.y + col.h - 4) {
        col.collected = true;
        Level.collectedCount++;
        Particles.burst(
          col.x + col.w / 2, col.y + col.h / 2,
          8, 80, `rgba(${Level.getTheme().goalColor.join(',')}, 0.8)`, 0.25
        );
        Audio.collect();
      }
    }

    // Goal
    const goals = Level.getGoals();
    for (const g of goals) {
      if (Player.x + Player.w > g.x && Player.x < g.x + g.w &&
          Player.y + Player.h > g.y && Player.y < g.y + g.h) {
        Particles.burst(g.x + g.w / 2, g.y + g.h / 2, 30, 200, Tokens.rgba(Tokens.color.gold, 0.7), 0.5);
        Camera.shake(8);
        Engine.flash('white', 0.5);
        Audio.levelComplete();

        // Save progress
        this.totalDeaths += Player.deathCount;
        this.totalGems += Level.collectedCount;
        this.save.levelsComplete[this.currentLevel] = true;
        const bd = this.save.bestDeaths[this.currentLevel];
        if (bd === -1 || Player.deathCount < bd) {
          this.save.bestDeaths[this.currentLevel] = Player.deathCount;
        }
        const prevGems = this.save.gemsCollected[this.currentLevel];
        if (Level.collectedCount > prevGems) {
          this.save.gemsCollected[this.currentLevel] = Level.collectedCount;
        }
        this.writeSave();

        if (Level.maps[this.currentLevel].tent) {
          // Cinematic finale: confetti swallow, then level complete.
          this.tentTimer = 0;
          this._tentMouth = { x: g.x + g.w / 2, y: g.y + g.h / 2 };
          Engine.hitstop(0.08);
          Camera.shake(6);
          for (let i = 0; i < 40; i++) {
            const a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 180;
            Particles.emit(this._tentMouth.x, this._tentMouth.y, Math.cos(a) * sp, Math.sin(a) * sp,
              Tokens.color.carnival[i % Tokens.color.carnival.length], 0.6 + Math.random() * 0.4, 4.5);
          }
          this.state = 'tentFinale';
          this.timer = 0;
          return;
        }

        this.state = 'levelComplete';
        this.timer = 0;
        return;
      }
    }

    // Pit death
    if (Player.y > Level.levelHeight + 100) {
      Player.die();
    }

    // Restart current level
    if (Input.pressed('KeyR')) {
      Player.setCheckpoint(Level.spawnX, Level.spawnY);
      Player.spawn(Level.spawnX, Level.spawnY);
      Player.deathCount = 0;
      this.levelTimer = 0;
    }
  },

  // ── LEVEL COMPLETE ──
  updateLevelComplete(dt) {
    if (this.timer > 1.0 && (Input.pressed('Space') || Input.pressed('Enter') || Input.pressed('KeyZ') || Input.tapped())) {
      const nextLevel = this.currentLevel + 1;
      if (nextLevel >= this.totalLevels) {
        this.fadeToBlack(() => {
          this.state = 'win';
          this.timer = 0;
          this.fadeFromBlack();
        });
      } else {
        this.fadeToBlack(() => {
          this.state = 'playing';
          this.loadLevel(nextLevel);
          this.fadeFromBlack();
        });
      }
    }
  },

  // ── TENT FINALE (cinematic) ──
  updateTentFinale(dt) {
    this.tentTimer += dt;
    // Keep raining confetti from the mouth for the first beat.
    if (this._tentMouth && this.tentTimer < 0.6 && Math.random() < 0.6) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6, sp = 60 + Math.random() * 160;
      Particles.emit(this._tentMouth.x, this._tentMouth.y, Math.cos(a) * sp, Math.sin(a) * sp,
        Tokens.color.carnival[(Math.random() * 5) | 0], 0.5 + Math.random() * 0.4, 4.5);
    }
    // After the flourish, hand off to the normal complete screen.
    if (this.tentTimer >= 1.3) {
      this.state = 'levelComplete';
      this.timer = 0;
    }
  },

  drawTentFinale(ctx) {
    this.drawHUD(ctx);
    const a = Math.min(1, this.tentTimer * 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = Tokens.rgba(Tokens.color.charged, a * 0.9);
    ctx.font = Tokens.font.heading;
    ctx.fillText('INTO THE BIG TOP!', Engine.width / 2, Engine.height / 2 - 10);
    ctx.textAlign = 'left';
  },

  // ── PAUSED ──
  updatePaused(dt) {
    if (Input.pressed('Escape') || Input.pressed('KeyP')) {
      this.state = 'playing';
    }
    if (Input.pressed('KeyR')) {
      this.state = 'playing';
      this.loadLevel(this.currentLevel);
    }
    if (Input.pressed('KeyQ')) {
      this.fadeToBlack(() => {
        this.state = 'levelSelect';
        this.timer = 0;
        this.fadeFromBlack();
      });
    }
    if (Input.pressed('KeyM')) Audio.toggle();
  },

  // ── WIN ──
  updateWin(dt) {
    if (Input.pressed('Space') || Input.pressed('Enter') || Input.pressed('KeyZ') || Input.tapped()) {
      Audio.uiSelect();
      this.fadeToBlack(() => {
        this.state = 'title';
        this.fadeFromBlack();
      });
    }
  },

  // ═══════════════════════════════════════════
  // DRAW
  // ═══════════════════════════════════════════
  drawOverlay(ctx) {
    if (this.state === 'title') this.drawTitle(ctx);
    else if (this.state === 'levelSelect') this.drawLevelSelect(ctx);
    else if (this.state === 'playing') this.drawHUD(ctx);
    else if (this.state === 'levelComplete') this.drawLevelComplete(ctx);
    else if (this.state === 'tentFinale') this.drawTentFinale(ctx);
    else if (this.state === 'paused') this.drawHUD(ctx);   // the menu itself is DOM (#pause-menu)
    else if (this.state === 'win') this.drawWin(ctx);

    // Mute indicator
    if (Audio.muted) {
      ctx.fillStyle = Tokens.rgba(Tokens.color.white, 0.3);
      ctx.font = Tokens.font.xs;
      ctx.textAlign = 'right';
      ctx.fillText('[MUTED - M to toggle]', Engine.width - 12, 18);
    }

    // Transition overlay
    if (this.transitionAlpha > 0) {
      ctx.fillStyle = Tokens.rgba(Tokens.color.overlay, this.transitionAlpha);
      ctx.fillRect(0, 0, Engine.width, Engine.height);
    }
  },

  drawTitle(ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, Engine.height);
    grad.addColorStop(0, Tokens.color.bgDeep);
    grad.addColorStop(1, Tokens.color.bgCircus);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, Engine.width, Engine.height);

    const t = this.timer;
    ctx.fillStyle = 'rgba(200, 150, 50, 0.1)';
    for (let i = 0; i < 30; i++) {
      const px = (i * 137 + t * 20) % Engine.width;
      const py = (i * 89 + Math.sin(t + i) * 30) % Engine.height;
      ctx.fillRect(px, py, 2 + (i % 3), 2 + (i % 2));
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = Tokens.color.ink;
    ctx.font = Tokens.font.title;
    ctx.fillText('CLOWN CITY', Engine.width / 2, Engine.height / 2 - 60);

    ctx.fillStyle = Tokens.rgba(Tokens.color.inkWarm, 0.6);
    ctx.font = Tokens.font.md;
    ctx.fillText('a unicycle auto-runner', Engine.width / 2, Engine.height / 2 - 20);

    if (Math.sin(t * 3) > -0.3) {
      ctx.fillStyle = Tokens.rgba(Tokens.color.gold, 0.8);
      ctx.font = Tokens.font.lg;
      ctx.fillText('TAP  /  SPACE', Engine.width / 2, Engine.height / 2 + 50);
    }

    ctx.fillStyle = Tokens.rgba(Tokens.color.inkDim, 0.4);
    ctx.font = Tokens.font.xs;
    ctx.fillText('SWIPE = steer    TAP = jump    (keyboard: ← → / SPACE)', Engine.width / 2, Engine.height - 40);
  },

  drawLevelSelect(ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, Engine.height);
    grad.addColorStop(0, Tokens.color.bgDeep);
    grad.addColorStop(1, Tokens.color.bgSelect);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, Engine.width, Engine.height);

    ctx.textAlign = 'center';
    ctx.fillStyle = Tokens.color.ink;
    ctx.font = Tokens.font.heading;
    ctx.fillText('SELECT LEVEL', Engine.width / 2, 80);

    const cardW = 180;
    const cardH = 140;
    const gap = 30;
    const totalW = this.totalLevels * cardW + (this.totalLevels - 1) * gap;
    const startX = (Engine.width - totalW) / 2;
    const cardY = Engine.height / 2 - cardH / 2;

    for (let i = 0; i < this.totalLevels; i++) {
      const x = startX + i * (cardW + gap);
      const selected = i === this._selectedLevel;
      const accessible = i === 0 || this.save.levelsComplete[i - 1];
      const complete = this.save.levelsComplete[i];
      const theme = Level.themes[Level.maps[i].theme];

      // Card background
      if (!accessible) {
        ctx.fillStyle = 'rgba(40, 40, 50, 0.6)';
      } else if (selected) {
        ctx.fillStyle = 'rgba(60, 50, 80, 0.9)';
      } else {
        ctx.fillStyle = 'rgba(30, 28, 40, 0.8)';
      }
      ctx.fillRect(x, cardY, cardW, cardH);

      // Selection border
      if (selected && accessible) {
        ctx.strokeStyle = Tokens.rgba(Tokens.color.gold, 0.7);
        ctx.lineWidth = 2;
        ctx.strokeRect(x, cardY, cardW, cardH);
      }

      // Theme color bar at top
      ctx.fillStyle = accessible ? theme.tile[1] : 'rgba(60, 60, 60, 0.5)';
      ctx.fillRect(x, cardY, cardW, 4);

      // Level number
      ctx.fillStyle = accessible ? Tokens.color.ink : Tokens.rgba(Tokens.color.disabled, 0.5);
      ctx.font = Tokens.font.cardNum;
      ctx.fillText(`${i + 1}`, x + cardW / 2, cardY + 32);

      // Level name
      ctx.font = Tokens.font.sm;
      ctx.fillStyle = accessible ? Tokens.rgba(Tokens.color.dust, 0.8) : Tokens.rgba(Tokens.color.disabled, 0.4);
      ctx.fillText(Level.maps[i].name, x + cardW / 2, cardY + 55);

      if (!accessible) {
        // Locked
        ctx.fillStyle = Tokens.rgba(Tokens.color.disabled, 0.4);
        ctx.font = '20px monospace';
        ctx.fillText('LOCKED', x + cardW / 2, cardY + 90);
      } else if (complete) {
        // Stats
        ctx.fillStyle = Tokens.rgba(Tokens.color.success, 0.6);
        ctx.font = Tokens.font.xs;
        ctx.fillText('COMPLETE', x + cardW / 2, cardY + 80);
        const bd = this.save.bestDeaths[i];
        if (bd >= 0) {
          ctx.fillStyle = Tokens.rgba(Tokens.color.dust, 0.5);
          ctx.fillText(`best: ${bd} deaths`, x + cardW / 2, cardY + 98);
        }
        const gc = this.save.gemsCollected[i];
        const tc = this.save.totalGemsPerLevel[i];
        if (tc > 0) {
          ctx.fillText(`gems: ${gc} / ${tc}`, x + cardW / 2, cardY + 114);
        }
      } else {
        // Not yet played
        ctx.fillStyle = Tokens.rgba(Tokens.color.dust, 0.3);
        ctx.font = Tokens.font.xs;
        ctx.fillText('—', x + cardW / 2, cardY + 90);
      }
    }

    // Instructions
    ctx.fillStyle = Tokens.rgba(Tokens.color.inkDim, 0.5);
    ctx.font = Tokens.font.sm;
    ctx.fillText('SWIPE / ← → to select    TAP / SPACE to play    ESC to go back', Engine.width / 2, Engine.height - 40);
  },

  drawHUD(ctx) {
    ctx.textAlign = 'left';

    // Level name fade-in with theme accent
    if (this.levelTimer < 4) {
      const alpha = this.levelTimer < 2 ? 0.8 : 0.8 * (1 - (this.levelTimer - 2) / 2);
      const theme = Level.getTheme();
      const gc = theme.goalColor;
      // Themed accent underline
      const nameW = Level.maps[this.currentLevel].name.length * 10;
      ctx.fillStyle = `rgba(${gc[0]},${gc[1]},${gc[2]},${alpha * 0.3})`;
      ctx.fillRect(Engine.width / 2 - nameW / 2 - 10, 36, nameW + 20, 2);
      // Level name
      ctx.fillStyle = `rgba(${gc[0]},${gc[1]},${gc[2]},${alpha})`;
      ctx.font = Tokens.font.hud;
      ctx.textAlign = 'center';
      ctx.fillText(Level.maps[this.currentLevel].name, Engine.width / 2, 32);
      ctx.fillStyle = Tokens.rgba(Tokens.color.dust, alpha * 0.5);
      ctx.font = Tokens.font.xs;
      ctx.fillText(`${this.currentLevel + 1} / ${this.totalLevels}`, Engine.width / 2, 52);
      ctx.textAlign = 'left';
    }

    // Death counter (top-left) with skull icon
    if (Player.deathCount > 0) {
      ctx.fillStyle = Tokens.rgba(Tokens.color.danger, 0.7);
      ctx.font = Tokens.font.body;
      // Mini skull
      const sx = 16, sy = 12;
      ctx.fillRect(sx + 2, sy, 8, 8);      // head
      ctx.fillRect(sx + 1, sy + 3, 10, 4); // jaw
      ctx.fillStyle = 'rgba(10,10,20,0.9)';
      ctx.fillRect(sx + 3, sy + 2, 2, 2);  // left eye
      ctx.fillRect(sx + 7, sy + 2, 2, 2);  // right eye
      ctx.fillRect(sx + 5, sy + 5, 2, 2);  // nose
      ctx.fillStyle = Tokens.rgba(Tokens.color.danger, 0.7);
      ctx.fillText(Player.deathCount, 32, 24);
    }

    // Timer (top-center)
    const mins = Math.floor(this.levelTimer / 60);
    const secs = Math.floor(this.levelTimer % 60);
    const ms = Math.floor((this.levelTimer % 1) * 100);
    ctx.fillStyle = Tokens.rgba(Tokens.color.dust, 0.4);
    ctx.font = Tokens.font.sm;
    ctx.textAlign = 'center';
    ctx.fillText(`${mins}:${secs < 10 ? '0' : ''}${secs}.${ms < 10 ? '0' : ''}${ms}`, Engine.width / 2, Engine.height - 12);
    ctx.textAlign = 'left';

    // Gem counter (top-right) with diamond icon
    if (Level.totalCollectibles > 0) {
      const gc = Level.getTheme().goalColor;
      ctx.fillStyle = `rgba(${gc[0]}, ${gc[1]}, ${gc[2]}, 0.8)`;
      ctx.font = Tokens.font.body;
      ctx.textAlign = 'right';
      ctx.fillText(`${Level.collectedCount} / ${Level.totalCollectibles}`, Engine.width - 16, 24);
      // Mini diamond icon
      const dx = Engine.width - 16 - ctx.measureText(`${Level.collectedCount} / ${Level.totalCollectibles}`).width - 14;
      ctx.beginPath();
      ctx.moveTo(dx + 5, 12);
      ctx.lineTo(dx + 10, 18);
      ctx.lineTo(dx + 5, 24);
      ctx.lineTo(dx, 18);
      ctx.closePath();
      ctx.fill();
      ctx.textAlign = 'left';
    }

    // Speedometer (momentum gauge)
    this.drawSpeedometer(ctx);
  },

  // Momentum gauge: fills 0->1, brightens to the theme accent past the 0.5
  // threshold where the spin-out attack and wall rev-climb unlock.
  drawSpeedometer(ctx) {
    const m = Math.max(0, Math.min(1, Player.momentum));
    const w = 150, h = 7;
    const x = (Engine.width - w) / 2;
    const y = Engine.height - 32;
    ctx.fillStyle = Tokens.rgba(Tokens.color.overlay, 0.45);
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = Tokens.rgba(Tokens.color.white, 0.10);
    ctx.fillRect(x, y, w, h);
    const ready = m >= 0.5;
    const gc = Level.getTheme().goalColor;
    ctx.fillStyle = ready ? `rgba(${gc[0]},${gc[1]},${gc[2]},0.9)` : Tokens.rgba(Tokens.color.dust, 0.5);
    ctx.fillRect(x, y, w * m, h);
    // Overspeed "charged" overlay: a gold sliver past full while banking speed.
    const over = Math.max(0, Math.min(1, Player.overspeed));
    if (over > 0) {
      ctx.fillStyle = Tokens.rgba(Tokens.color.charged, 0.85);
      ctx.fillRect(x, y - 2, w, 2);                 // gold cap line = "charged!"
      ctx.fillRect(x + w, y - 1, 6 * over, h + 2);  // a nub past the end of the bar
    }
    // half-speed threshold tick
    ctx.fillStyle = Tokens.rgba(Tokens.color.white, 0.55);
    ctx.fillRect(x + w * 0.5 - 1, y - 3, 2, h + 6);
    ctx.fillStyle = Tokens.rgba(Tokens.color.dust, 0.5);
    ctx.font = Tokens.font.xs;
    ctx.textAlign = 'center';
    ctx.fillText('SPEED', Engine.width / 2, y - 6);
    ctx.textAlign = 'left';
  },

  drawLevelComplete(ctx) {
    ctx.textAlign = 'center';
    const alpha = Math.min(1, this.timer * 2);

    ctx.fillStyle = Tokens.rgba(Tokens.color.gold, alpha * 0.9);
    ctx.font = Tokens.font.heading;
    ctx.fillText('LEVEL COMPLETE', Engine.width / 2, Engine.height / 2 - 20);

    ctx.fillStyle = Tokens.rgba(Tokens.color.inkWarm, alpha * 0.5);
    ctx.font = Tokens.font.body;
    const lmins = Math.floor(this.levelTimer / 60);
    const lsecs = Math.floor(this.levelTimer % 60);
    const lms = Math.floor((this.levelTimer % 1) * 100);
    ctx.fillText(`time: ${lmins}:${lsecs < 10 ? '0' : ''}${lsecs}.${lms < 10 ? '0' : ''}${lms}`, Engine.width / 2, Engine.height / 2 + 12);
    if (Player.deathCount > 0) {
      ctx.fillText(`deaths: ${Player.deathCount}`, Engine.width / 2, Engine.height / 2 + 32);
    }
    if (Level.totalCollectibles > 0) {
      ctx.fillText(`gems: ${Level.collectedCount} / ${Level.totalCollectibles}`, Engine.width / 2, Engine.height / 2 + 52);
    }

    // Continue prompt (after brief delay)
    if (this.timer > 1.0 && Math.sin(this.timer * 3) > -0.3) {
      ctx.fillStyle = Tokens.rgba(Tokens.color.gold, alpha * 0.6);
      ctx.font = Tokens.font.prompt;
      ctx.fillText('TAP  /  SPACE', Engine.width / 2, Engine.height / 2 + 85);
    }
  },

  drawWin(ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, Engine.height);
    grad.addColorStop(0, Tokens.color.bgDeep);
    grad.addColorStop(1, Tokens.color.bgWin);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, Engine.width, Engine.height);

    const t = this.timer;
    for (let i = 0; i < 40; i++) {
      const hue = (i * 37 + t * 50) % 360;
      const px = (i * 97 + Math.sin(t * 0.7 + i) * 40) % Engine.width;
      const py = (i * 61 + t * 15) % Engine.height;
      ctx.fillStyle = `hsla(${hue}, 70%, 60%, 0.15)`;
      ctx.fillRect(px, py, 3, 3);
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = Tokens.color.goldBright;
    ctx.font = Tokens.font.win;
    ctx.fillText('CONGRATULATIONS', Engine.width / 2, Engine.height / 2 - 70);

    ctx.fillStyle = Tokens.color.ink;
    ctx.font = Tokens.font.lg;
    ctx.fillText('You escaped Clown City', Engine.width / 2, Engine.height / 2 - 25);

    ctx.fillStyle = Tokens.rgba(Tokens.color.dust, 0.7);
    ctx.font = Tokens.font.body;
    ctx.fillText(`total deaths: ${this.totalDeaths}`, Engine.width / 2, Engine.height / 2 + 15);
    ctx.fillText(`total gems: ${this.totalGems}`, Engine.width / 2, Engine.height / 2 + 38);

    if (Math.sin(t * 3) > -0.3) {
      ctx.fillStyle = Tokens.rgba(Tokens.color.gold, 0.6);
      ctx.font = Tokens.font.md;
      ctx.fillText('TAP  /  SPACE', Engine.width / 2, Engine.height / 2 + 80);
    }
  }
};

// Boot
window.addEventListener('load', () => Game.init());
