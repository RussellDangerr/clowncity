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

  // Save data, one record per level NAME, so levels can be added, merged and
  // reordered without scrambling anyone's progress. A level you've retired
  // keeps its record; it just isn't shown.
  save: {
    version: 2,
    levels: {},             // name -> { complete, bestDeaths (-1 = none), gems, totalGems }
  },

  // The order levels sat in when saves were plain arrays by position (v0.4–v0.6
  // live, then dev). Frozen here: Level.maps will keep changing, and the old
  // arrays only make sense against the order that wrote them. v0.1–v0.3 had a
  // different second and third level, but v0.4 already reused those slots, so
  // reading them as Catwalk / Big Drop keeps what players see today.
  legacyOrder: ['The Big Top', 'The Catwalk', 'The Big Drop', 'The Carousel', 'The Duck River', 'The Strongman'],

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
    this.save = { version: 2, levels: {} };
    let data = null;
    try {
      const raw = localStorage.getItem('clowncity_save');
      if (raw) data = JSON.parse(raw);
    } catch (e) { /* ignore corrupt saves */ }
    if (!data || typeof data !== 'object') return;
    if (data.levels && typeof data.levels === 'object') {
      for (const [name, r] of Object.entries(data.levels)) this.save.levels[name] = this._cleanRecord(r);
    } else if (Array.isArray(data.levelsComplete)) {
      // Old format: arrays by position. Move them onto names once; writeSave
      // then stores the new format.
      this.legacyOrder.forEach((name, i) => {
        if (i >= data.levelsComplete.length) return;
        this.save.levels[name] = this._cleanRecord({
          complete: data.levelsComplete[i],
          bestDeaths: (data.bestDeaths || [])[i],
          gems: (data.gemsCollected || [])[i],
          totalGems: (data.totalGemsPerLevel || [])[i],
        });
      });
      this.writeSave();
    }
  },

  _cleanRecord(r) {
    r = r || {};
    const num = (v, d) => (Number.isFinite(v) ? v : d);
    return { complete: r.complete === true, bestDeaths: num(r.bestDeaths, -1), gems: num(r.gems, 0), totalGems: num(r.totalGems, 0) };
  },

  // The save record for level i (by its name), created on first use.
  levelRecord(i) {
    const name = Level.maps[i].name;
    return this.save.levels[name] || (this.save.levels[name] = this._cleanRecord());
  },

  // Playable: the first level, the one after a level you've beaten, or one
  // you've beaten yourself (adding a level ahead of it never locks it again).
  levelUnlocked(i) {
    return i === 0 || this.levelRecord(i - 1).complete || this.levelRecord(i).complete;
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
    this.levelRecord(index).totalGems = Level.totalCollectibles;
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
    const accessible = this.levelUnlocked(this._selectedLevel);

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

    // Checkpoints: passing the flag's column at ANY height above it counts, so
    // jumping over one never costs it (respawn is still at the flag).
    // (Level.near: on a loop level, compare against this lap's copy of each.)
    for (const flag of Level.checkpoints) {
      const cp = Level.near(flag);
      if (!flag.active &&
          Player.x + Player.w > cp.x && Player.x < cp.x + cp.w &&
          Player.y < cp.y + cp.h) {
        for (const other of Level.checkpoints) other.active = false;
        flag.active = true;
        Player.setCheckpoint(cp.x, cp.y);
        Particles.burst(cp.x + cp.w / 2, cp.y + cp.h / 2, 12, 100, Tokens.rgba(Tokens.color.goldFlag, 0.7), 0.3);
        Audio.checkpoint();
      }
    }

    // Collectibles
    for (const gem of Level.collectibles) {
      const col = Level.near(gem);
      if (!gem.collected &&
          Player.x + Player.w > col.x + 4 && Player.x < col.x + col.w - 4 &&
          Player.y + Player.h > col.y + 4 && Player.y < col.y + col.h - 4) {
        gem.collected = true;
        Level.collectedCount++;
        Particles.burst(
          col.x + col.w / 2, col.y + col.h / 2,
          8, 80, `rgba(${Level.getTheme().goalColor.join(',')}, 0.8)`, 0.25
        );
        Audio.collect();
      }
    }

    // Brass rings: grab them all to open the goal.
    for (const ring of Level.rings) {
      const r = Level.near(ring);
      if (!ring.collected &&
          Player.x + Player.w > r.x + 4 && Player.x < r.x + r.w - 4 &&
          Player.y + Player.h > r.y + 4 && Player.y < r.y + r.h - 4) {
        ring.collected = true;
        Level.ringsCollected++;
        Particles.burst(r.x + r.w / 2, r.y + r.h / 2, 18, 140, Tokens.rgba(Tokens.color.ring, 0.9), 0.4);
        Camera.shake(3);
        Audio.collect();
        if (!Level.goalLocked) { Engine.flash('white', 0.25); Audio.checkpoint(); }
      }
    }

    // Goal (shut until the rings are in)
    const goals = Level.goalLocked ? [] : Level.getGoals().map(g => Level.near(g));
    for (const g of goals) {
      if (Player.x + Player.w > g.x && Player.x < g.x + g.w &&
          Player.y + Player.h > g.y && Player.y < g.y + g.h) {
        Particles.burst(g.x + g.w / 2, g.y + g.h / 2, 30, 200, Tokens.rgba(Tokens.color.gold, 0.7), 0.5);
        Camera.shake(8);
        Engine.flash('white', 0.5);
        Audio.levelComplete();
        Player.finish(!!Level.maps[this.currentLevel].tent);

        // Save progress
        this.totalDeaths += Player.deathCount;
        this.totalGems += Level.collectedCount;
        const rec = this.levelRecord(this.currentLevel);
        rec.complete = true;
        if (rec.bestDeaths === -1 || Player.deathCount < rec.bestDeaths) rec.bestDeaths = Player.deathCount;
        rec.gems = Math.max(rec.gems, Level.collectedCount);
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
    const cx = Engine.width / 2, cy = Engine.height / 2;
    ctx.save();
    this._uiScale(ctx, cx, cy);
    ctx.font = Tokens.font.heading;
    const w = ctx.measureText('INTO THE BIG TOP!').width + 56;
    ctx.globalAlpha = a;
    this._panel(ctx, cx - w / 2, cy - 44, w, 54);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.fillStyle = Tokens.rgba(Tokens.color.charged, a * 0.95);
    ctx.fillText('INTO THE BIG TOP!', cx, cy - 10);
    ctx.restore();
    ctx.textAlign = 'left';
  },

  // Backing panel for overlay text so it reads over any scenery (the tent!),
  // styled like the pause menu: oxblood-black with a thin gold edge.
  _panel(ctx, x, y, w, h) {
    ctx.fillStyle = Tokens.rgba(Tokens.color.panel, 0.84);
    ctx.strokeStyle = Tokens.rgba(Tokens.color.gold, 0.55);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 8); else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1;
  },

  // Enlarge the overlay drawn after this (until ctx.restore) around (cx, cy)
  // on small screens — see Layout.views[*].uiScale.
  _uiScale(ctx, cx, cy) {
    const k = Layout.views[Layout.mode].uiScale;
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    ctx.translate(-cx, -cy);
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
        this.state = 'levelSelect';
        this.timer = 0;
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
      ctx.fillText(Layout.hint('muted'), Engine.width - 12, 18);
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

    // Cards shrink to fit the row once there are more levels than the width holds
    // (the gap first, down to 8px, so each card keeps ~110px for its text); if a
    // single row would squeeze them under that, they wrap onto two rows.
    const fit = (perRow) => {
      const gap = Math.min(Tokens.space.cardGap, Math.max(8, (Engine.width - 40 - perRow * 110) / Math.max(1, perRow - 1)));
      return { gap, cardW: Math.min(Tokens.space.cardW, (Engine.width - 40 - (perRow - 1) * gap) / perRow) };
    };
    let rows = 1, perRow = this.totalLevels, { gap, cardW } = fit(perRow);
    if (cardW < 110) { rows = 2; perRow = Math.ceil(this.totalLevels / 2); ({ gap, cardW } = fit(perRow)); }
    const cardH = rows > 1 ? 124 : Tokens.space.cardH;   // two rows: just tall enough for the stats
    const rowGap = 12;
    const startX = (Engine.width - (perRow * cardW + (perRow - 1) * gap)) / 2;
    const firstY = Engine.height / 2 - (rows * cardH + (rows - 1) * rowGap) / 2 + (rows > 1 ? 14 : 0);

    for (let i = 0; i < this.totalLevels; i++) {
      const x = startX + (i % perRow) * (cardW + gap);
      const cardY = firstY + Math.floor(i / perRow) * (cardH + rowGap);
      const selected = i === this._selectedLevel;
      const rec = this.levelRecord(i);
      const accessible = this.levelUnlocked(i);
      const complete = rec.complete;
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
        ctx.font = Tokens.font.lock;
        ctx.fillText('LOCKED', x + cardW / 2, cardY + 90);
      } else if (complete) {
        // Stats
        ctx.fillStyle = Tokens.rgba(Tokens.color.success, 0.6);
        ctx.font = Tokens.font.xs;
        ctx.fillText('COMPLETE', x + cardW / 2, cardY + 80);
        const bd = rec.bestDeaths;
        if (bd >= 0) {
          ctx.fillStyle = Tokens.rgba(Tokens.color.dust, 0.5);
          ctx.fillText(`best: ${bd} deaths`, x + cardW / 2, cardY + 98);
        }
        const gc = rec.gems;
        const tc = rec.totalGems;
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
    ctx.fillText(Layout.hint('select'), Engine.width / 2, Engine.height - 40);
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
      // Sideways on touch, the floating pause button sits over this corner.
      const sx = Layout.scheme === 'touch' ? Tokens.space.hudTouchLeft : Tokens.space.hudMargin;
      const sy = 12;
      ctx.fillRect(sx + 2, sy, 8, 8);      // head
      ctx.fillRect(sx + 1, sy + 3, 10, 4); // jaw
      ctx.fillStyle = 'rgba(10,10,20,0.9)';
      ctx.fillRect(sx + 3, sy + 2, 2, 2);  // left eye
      ctx.fillRect(sx + 7, sy + 2, 2, 2);  // right eye
      ctx.fillRect(sx + 5, sy + 5, 2, 2);  // nose
      ctx.fillStyle = Tokens.rgba(Tokens.color.danger, 0.7);
      ctx.fillText(Player.deathCount, sx + 16, 24);
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

    // Gallery counter (tin ducks down), under the gems: the drawbridge's lock.
    if (Level.targetsTotal > 0) {
      const label = `${Level.targetsHit} / ${Level.targetsTotal}`;
      const [, , ring] = Tokens.color.tin;
      ctx.fillStyle = Level.bridgeOpen ? Tokens.rgba(Tokens.color.success, 0.8) : ring;
      ctx.font = Tokens.font.body;
      ctx.textAlign = 'right';
      ctx.fillText(label, Engine.width - 16, 46);
      const ix = Engine.width - 16 - ctx.measureText(label).width - 9;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ix, 41, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(ix, 41, 1.5, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.textAlign = 'left';
    }

    // Brass-ring counter, under the gems: the goal's lock.
    if (Level.rings.length > 0) {
      const label = `${Level.ringsCollected} / ${Level.rings.length}`;
      ctx.fillStyle = Tokens.rgba(Tokens.color.ring, Level.goalLocked ? 0.8 : 1);
      ctx.font = Tokens.font.body;
      ctx.textAlign = 'right';
      ctx.fillText(label, Engine.width - 16, 46);
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(Engine.width - 16 - ctx.measureText(label).width - 9, 41, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
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
    const alpha = Math.min(1, this.timer * 2);
    const cx = Engine.width / 2, cy = Engine.height / 2;
    ctx.save();
    this._uiScale(ctx, cx, cy);
    ctx.globalAlpha = alpha;
    this._panel(ctx, cx - 170, cy - 62, 340, 166);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';

    ctx.fillStyle = Tokens.rgba(Tokens.color.gold, alpha * 0.95);
    ctx.font = Tokens.font.heading;
    ctx.fillText('LEVEL COMPLETE', cx, cy - 20);

    ctx.fillStyle = Tokens.rgba(Tokens.color.inkWarm, alpha * 0.85);
    ctx.font = Tokens.font.body;
    const lmins = Math.floor(this.levelTimer / 60);
    const lsecs = Math.floor(this.levelTimer % 60);
    const lms = Math.floor((this.levelTimer % 1) * 100);
    const stats = [`time: ${lmins}:${lsecs < 10 ? '0' : ''}${lsecs}.${lms < 10 ? '0' : ''}${lms}`];
    if (Player.deathCount > 0) stats.push(`deaths: ${Player.deathCount}`);
    if (Level.totalCollectibles > 0) stats.push(`gems: ${Level.collectedCount} / ${Level.totalCollectibles}`);
    stats.forEach((line, i) => ctx.fillText(line, cx, cy + 12 + i * 20));   // no gap for a skipped line

    // Continue prompt (after brief delay)
    if (this.timer > 1.0 && Math.sin(this.timer * 3) > -0.3) {
      ctx.fillStyle = Tokens.rgba(Tokens.color.gold, alpha * 0.85);
      ctx.font = Tokens.font.prompt;
      ctx.fillText(Layout.hint('continue'), cx, cy + 85);
    }
    ctx.restore();
    ctx.textAlign = 'left';
  },

  // Set `font`, shrinking its px size if `text` would be wider than maxW.
  _fitFont(ctx, text, font, maxW) {
    ctx.font = font;
    const w = ctx.measureText(text).width;
    if (w <= maxW) return;
    const px = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)[1]);
    ctx.font = font.replace(/\d+(?:\.\d+)?px/, `${Math.floor(px * maxW / w)}px`);
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
    const cx = Engine.width / 2, cy = Engine.height / 2;
    // Marquee title: gold face over a two-step extrusion, like the splash.
    this._fitFont(ctx, 'CONGRATULATIONS', Tokens.font.display, Engine.width - 60);
    ctx.fillStyle = Tokens.color.goldDeep;   ctx.fillText('CONGRATULATIONS', cx, cy - 62);
    ctx.fillStyle = Tokens.color.goldShade;  ctx.fillText('CONGRATULATIONS', cx, cy - 64);
    ctx.fillStyle = Tokens.color.goldBright; ctx.fillText('CONGRATULATIONS', cx, cy - 66);

    ctx.fillStyle = Tokens.color.ink;
    ctx.font = Tokens.font.serif;
    ctx.fillText('You escaped Clown City', cx, cy - 22);

    // Stats + prompt, enlarged on phones (anchored under the subtitle so the
    // bigger block grows downward, away from the title).
    ctx.save();
    this._uiScale(ctx, cx, cy + 15);
    ctx.fillStyle = Tokens.rgba(Tokens.color.dust, 0.8);
    ctx.font = Tokens.font.body;
    ctx.fillText(`total deaths: ${this.totalDeaths}`, cx, cy + 15);
    ctx.fillText(`total gems: ${this.totalGems}`, cx, cy + 38);

    if (Math.sin(t * 3) > -0.3) {
      ctx.fillStyle = Tokens.rgba(Tokens.color.gold, 0.75);
      ctx.font = Tokens.font.md;
      ctx.fillText(Layout.hint('continue'), cx, cy + 80);
    }
    ctx.restore();
    ctx.textAlign = 'left';
  }
};

// Boot
window.addEventListener('load', () => Game.init());
