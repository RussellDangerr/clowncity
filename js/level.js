// ─── Level: tile-based geometry ───
const Level = {
  tileSize: 32,
  tiles: [],        // array of {x, y, w, h} rects
  spawnX: 100,
  spawnY: 300,
  levelWidth: 0,
  levelHeight: 0,

  // Tile legend:
  // 1 = solid, 0 = air, g = goal
  // c = checkpoint, o = collectible (gem)
  // T = treadmill (caps Poko's speed at 0.5 and bleeds momentum)
  // / = slope rising to the right, \ = slope rising to the left (45°)
  //     (authoring: a literal backslash must be written \\ inside the JS strings)

  // Material definitions: only the colour matters here; physics live in Player.
  materials: {
    solid:     { color: null },
    treadmill: { color: Tokens.color.treadmill },
  },
  // Theme palettes used by draw()
  themes: {
    circus: {
      name: 'The Big Top',
      bg: ['#1a0a0a', '#2a0f15', '#1a0a20'],
      tile: ['#8b1a1a', '#a02020', '#b83030'],
      accent: 'rgba(255, 215, 0, 0.15)',
      goalColor: [255, 215, 100],
      dotColor: 'rgba(200, 150, 50, 0.06)',
    },
    harlequin: {
      name: 'The Stage',
      bg: ['#0a0a14', '#12101e', '#1a1030'],
      tile: ['#2a1a3a', '#352248', '#402a55'],
      accent: 'rgba(180, 140, 255, 0.12)',
      goalColor: [180, 140, 255],
      dotColor: 'rgba(140, 100, 220, 0.05)',
    },
    midnight: {
      name: 'The Big Drop',
      bg: ['#0a0a1e', '#0e1230', '#1a1040'],
      tile: ['#1a2348', '#243056', '#36487e'],
      accent: 'rgba(255, 215, 120, 0.14)',
      goalColor: [255, 215, 120],
      dotColor: 'rgba(120, 150, 230, 0.06)',
    }
  },

  maps: [
    {
      name: 'The Big Top',
      theme: 'circus',
      spawn: [3, 21],
      entities: [
        // One-way ledge over the first patrol (ride over, or drop to stomp).
        { type: 'oneway', x: 17 * 32, y: 18 * 32, w: 96 },
        { type: 'patrol', x: 20 * 32, y: 22 * 32 - 20, range: 96, speed: 55 },
        // One-way ledge over the second patrol, just past the checkpoint.
        { type: 'oneway', x: 51 * 32, y: 18 * 32, w: 96 },
        { type: 'patrol', x: 53 * 32, y: 22 * 32 - 20, range: 64, speed: 55 },
        // Ferry platform across the wide gap before the goal run.
        { type: 'platform', x: 57 * 32, y: 22 * 32, w: 64, toX: 61 * 32, toY: 22 * 32, speed: 60 },
      ],
      // 80 wide x 25 tall - unicycle track: jump the pits, brake-kick or stomp
      // the patrols, slow over the treadmill, ferry the wide gap, roll to goal.
      data: [
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000g00001',
        '10000000000000000000000000000000000000000000000000000000000000000000000001001001',
        '10000000000000000000000000000000000000000000000000000000000000000000000001001001',
        '10000000000000000000000000000000000000000000000000000000000000000000000001o01001',
        '10000000000000000000000000000000000000000000000000000000000000000000000001001001',
        '10000000000000000000000000000000000000000000000000000000000000000000000001001001',
        '100000000000000000000000000000000000000000000000000000000000000000000000010o1001',
        '10000000000000000000000000000000000000000000000000000000000000000000000001001001',
        '10000000000000000000000000000000000000000000000000000000000000000000000001001001',
        '10000000000000000000000000000000000000000000000000000000000o00000000000000001001',
        '10000000o0000000000000000o0000000000o0000000000000co0000000000000000o00000001001',
        '111111111111000011111111111111TTTTTTTTTTT111110000111111100000011111111111111111',
        '11111111111100001111111111111111111111111111111000011111110000001111111111111111',
        '11111111111100001111111111111111111111111111111000011111110000001111111111111111',
      ]
    },
    {
      name: 'The Catwalk',
      theme: 'harlequin',
      spawn: [3, 21],
      entities: [
        // One-way ledge over the early patrol (ride over or drop to stomp).
        { type: 'oneway', x: 14 * 32, y: 18 * 32, w: 96 },
        { type: 'patrol', x: 16 * 32, y: 22 * 32 - 20, range: 64, speed: 60 },
        // Patrol pacing the treadmill.
        { type: 'patrol', x: 33 * 32, y: 22 * 32 - 20, range: 96, speed: 60 },
        // Ferry bridging the catwalk gap (rides at the catwalk surface, row 12).
        { type: 'platform', x: 73 * 32, y: 12 * 32, w: 64, toX: 78 * 32, toY: 12 * 32, speed: 60 },
        // Patrol on the far catwalk segment.
        { type: 'patrol', x: 85 * 32, y: 12 * 32 - 20, range: 96, speed: 60 },
      ],
      // 112 wide x 25 tall. Lower run (pits/treadmill/optional gem shaft) -> mandatory
      // wall-jump shaft (cols 57-60: left wall rows 11-19 [one taller, so the top cling
      // launches you RIGHT onto the catwalk], right wall full rows 12-21, gap 58-59) ->
      // climb to the catwalk (row 12) -> ferry gap (73-79) -> goal
      // (col 95). Floor cols 63-110 is a death-void, so the catwalk is the only way across.
      data: [
        '1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000000000000000000001000000000o0000000000000000000000o0000g0000000000000001',
        '1000000000000000000000000000000000000000000o00000000000001001111111111111000000011111111111111111000000000000001',
        '1000000000000000000000000000000000000000001001000000000001001000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000001001000000000001o01000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000001001000000000001001000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000001001000000000001001000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000010010000000000010o1000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000001001000000000001001000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000001001000000000001001000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000001',
        '1000000o000000000000o0000000000000000000000000000000c00000001000000000000000000000000000000000000000000000000001',
        '1111111111000011111111110000TTTTTTTTTTTT111111111111111111111110000000000000000000000000000000000000000000000001',
        '1111111111000011111111110000TTTTTTTTTTTT111111111111111111111110000000000000000000000000000000000000000000000001',
        '1111111111000011111111110000TTTTTTTTTTTT111111111111111111111110000000000000000000000000000000000000000000000001',
      ]
    },
    {
      name: 'The Big Drop',
      theme: 'midnight',
      spawn: [3, 13],
      tent: true,                    // goal IS the tent mouth (render + finale derive from the goal tile)
      entities: [],
      // 80 wide x 25 tall. Plateau intro (rows 14-24, cols 1-21) -> 8-tile downhill
      // bomb '\' (22,14)->(29,21) flowing straight into a 2-tile up-kicker '/'
      // (30,21)/(31,20) (the v0.4.1 fix removed the flat between them) -> chasm
      // cols 32-36 -> tent ledge (rows 14-24, cols 37-78) with goal at (59,13).
      data: [
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000o000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000000000000000000000001',
        '10000000000000000000000000000000000000000000000000000000000g00000000000000000001',
        '1111111111111111111111\\000000000000001111111111111111111111111111111111111111111',
        '11111111111111111111110\\00000000000001111111111111111111111111111111111111111111',
        '111111111111111111111100\\0000000000001111111111111111111111111111111111111111111',
        '1111111111111111111111000\\000000000001111111111111111111111111111111111111111111',
        '11111111111111111111110000\\00000000001111111111111111111111111111111111111111111',
        '111111111111111111111100000\\000o000001111111111111111111111111111111111111111111',
        '1111111111111111111111000000\\00/000001111111111111111111111111111111111111111111',
        '11111111111111111111110000000\\/0000001111111111111111111111111111111111111111111',
        '11111111111111111111111111111111000001111111111111111111111111111111111111111111',
        '11111111111111111111111111111111000001111111111111111111111111111111111111111111',
        '11111111111111111111111111111111000001111111111111111111111111111111111111111111',
      ]
    }
  ],

  currentMap: 0,

  load(mapIndex) {
    this.currentMap = mapIndex;
    this.tiles = [];
    this.checkpoints = [];
    this.collectibles = [];
    this.collectedCount = 0;
    this.totalCollectibles = 0;
    const map = this.maps[mapIndex];
    const data = map.data;

    this.levelHeight = data.length * this.tileSize;
    this.levelWidth = data[0].length * this.tileSize;
    this.spawnX = map.spawn[0] * this.tileSize;
    this.spawnY = map.spawn[1] * this.tileSize;

    const materialMap = { 'T': 'treadmill' };

    for (let row = 0; row < data.length; row++) {
      for (let col = 0; col < data[row].length; col++) {
        const ch = data[row][col];
        const tx = col * this.tileSize;
        const ty = row * this.tileSize;

        if (ch === '1') {
          this.tiles.push({ x: tx, y: ty, w: this.tileSize, h: this.tileSize, type: 'solid', material: 'solid' });
        } else if (materialMap[ch]) {
          this.tiles.push({ x: tx, y: ty, w: this.tileSize, h: this.tileSize, type: 'solid', material: materialMap[ch] });
        } else if (ch === '/' || ch === '\\') {
          const slopeDir = ch === '/' ? 1 : -1;
          this.tiles.push({ x: tx, y: ty, w: this.tileSize, h: this.tileSize, type: 'slope', slopeDir });
        } else if (ch === 'g') {
          this.tiles.push({ x: tx, y: ty, w: this.tileSize, h: this.tileSize, type: 'goal' });
        } else if (ch === 'c') {
          this.checkpoints.push({ x: tx, y: ty, w: this.tileSize, h: this.tileSize, active: false });
        } else if (ch === 'o') {
          this.collectibles.push({ x: tx, y: ty, w: this.tileSize, h: this.tileSize, collected: false });
          this.totalCollectibles++;
        }
      }
    }

    // No static tile hazards on the lean track — danger is pits + enemies.
    this._cachedHazards = [];
    this._cachedGoals = this.tiles.filter(t => t.type === 'goal');

    // Build spatial grid for fast tile lookups (getTilesNear)
    this._tileGrid = {};
    for (const tile of this.tiles) {
      if (tile.type !== 'solid') continue;
      const key = Math.floor(tile.x / this.tileSize) + ',' + Math.floor(tile.y / this.tileSize);
      this._tileGrid[key] = tile;
    }

    // Slopes live in their own grid — kept OUT of _tileGrid so the square-tile
    // X/Y passes never treat a slope's bounding box as a wall/floor.
    this._slopeGrid = {};
    for (const tile of this.tiles) {
      if (tile.type !== 'slope') continue;
      const key = Math.floor(tile.x / this.tileSize) + ',' + Math.floor(tile.y / this.tileSize);
      this._slopeGrid[key] = tile;
    }

    // Build solid grid for edge detection in rendering
    this.gridRows = data.length;
    this.gridCols = data[0].length;
    this.solidGrid = [];
    for (let row = 0; row < data.length; row++) {
      this.solidGrid[row] = [];
      for (let col = 0; col < data[row].length; col++) {
        const ch = data[row][col];
        this.solidGrid[row][col] = (ch === '1' || !!materialMap[ch] || ch === '/' || ch === '\\');
      }
    }

    // Load dynamic entities
    Entities.loadFromMap(map.entities);
  },

  // Check if grid cell is solid (for edge detection)
  _isSolid(row, col) {
    if (row < 0 || row >= this.gridRows || col < 0 || col >= this.gridCols) return false;
    return this.solidGrid[row] && this.solidGrid[row][col];
  },

  getTilesNear(px, py, pw, ph) {
    // Spatial grid lookup — O(1) per cell instead of O(n) scan
    const s = this.tileSize;
    const x1 = Math.floor((px - s) / s);
    const x2 = Math.floor((px + pw + s) / s);
    const y1 = Math.floor((py - s) / s);
    const y2 = Math.floor((py + ph + s) / s);
    const result = [];
    for (let gy = y1; gy <= y2; gy++) {
      for (let gx = x1; gx <= x2; gx++) {
        const tile = this._tileGrid[gx + ',' + gy];
        if (tile && !tile.broken) result.push(tile);
      }
    }
    return result;
  },

  // Surface (top) Y of a slope tile at a world X. Linear for 45°.
  //   '/' (slopeDir +1): low at the left edge, high at the right.
  //   '\' (slopeDir -1): high at the left edge, low at the right.
  slopeSurfaceY(tile, worldX) {
    const s = this.tileSize;
    const localX = Math.max(0, Math.min(s, worldX - tile.x));
    return tile.slopeDir > 0 ? tile.y + (s - localX) : tile.y + localX;
  },

  getSlopesNear(px, py, pw, ph) {
    if (!this._slopeGrid) return [];
    const s = this.tileSize;
    const x1 = Math.floor((px - s) / s), x2 = Math.floor((px + pw + s) / s);
    const y1 = Math.floor((py - s) / s), y2 = Math.floor((py + ph + s) / s);
    const result = [];
    for (let gy = y1; gy <= y2; gy++) {
      for (let gx = x1; gx <= x2; gx++) {
        const t = this._slopeGrid[gx + ',' + gy];
        if (t) result.push(t);
      }
    }
    return result;
  },

  // Get material for a tile at a position (O(1) grid lookup)
  getMaterialAt(x, y) {
    const key = Math.floor(x / this.tileSize) + ',' + Math.floor(y / this.tileSize);
    const tile = this._tileGrid[key];
    if (tile && !tile.broken) return tile.material || 'solid';
    return null;
  },

  getGoals() {
    return this._cachedGoals;
  },

  getHazards() {
    return this._cachedHazards;
  },

  getTheme() {
    const map = this.maps[this.currentMap];
    return this.themes[map.theme] || this.themes.circus;
  },

  draw(ctx) {
    // Skip drawing until a level is loaded (title/levelSelect screens)
    if (!this.collectibles) return;
    const theme = this.getTheme();

    // Background gradient atmosphere
    const grad = ctx.createLinearGradient(0, 0, 0, Engine.height);
    grad.addColorStop(0, theme.bg[0]);
    grad.addColorStop(0.5, theme.bg[1]);
    grad.addColorStop(1, theme.bg[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, Engine.width, Engine.height);

    // Background decorative dots (parallax)
    const camX = Camera.x * 0.3;
    const camY = Camera.y * 0.3;
    ctx.fillStyle = theme.dotColor;
    for (let i = 0; i < 60; i++) {
      const bx = ((i * 137) % Tokens.motion.parallaxX) - camX % Tokens.motion.parallaxX;
      const by = ((i * 89) % Tokens.motion.parallaxY) - camY % Tokens.motion.parallaxY;
      const size = 2 + (i % 3);
      ctx.fillRect(bx, by, size, size);
    }

    // Theme-specific background effects
    const currentTheme = this.maps[this.currentMap].theme;
    ctx.save();
    if (currentTheme === 'circus') {
      // Faint tent stripe pattern
      const stripeW = Tokens.motion.stripeW;
      const offsetX = -Camera.x * 0.15;
      for (let sx = -stripeW; sx < Engine.width + stripeW; sx += stripeW * 2) {
        ctx.fillStyle = 'rgba(180, 30, 30, 0.03)';
        ctx.fillRect(sx + (offsetX % (stripeW * 2)), 0, stripeW, Engine.height);
      }
    } else if (currentTheme === 'harlequin') {
      // Diamond / checkerboard pattern (stage floor vibe)
      const dSize = Tokens.motion.diamondSize;
      const offX = (-Camera.x * 0.1) % (dSize * 2);
      const offY = (-Camera.y * 0.1) % (dSize * 2);
      ctx.fillStyle = 'rgba(100, 60, 160, 0.02)';
      for (let dy = -dSize; dy < Engine.height + dSize; dy += dSize) {
        for (let dx = -dSize; dx < Engine.width + dSize; dx += dSize) {
          if (((Math.floor(dx / dSize) + Math.floor(dy / dSize)) % 2) === 0) {
            ctx.fillRect(dx + offX, dy + offY, dSize, dSize);
          }
        }
      }
    } else if (currentTheme === 'puppet') {
      // Faint horizontal wood grain lines
      const offY = (-Camera.y * 0.1) % 40;
      ctx.fillStyle = 'rgba(120, 90, 50, 0.025)';
      for (let ly = -40; ly < Engine.height + 40; ly += 40) {
        ctx.fillRect(0, ly + offY, Engine.width, 1);
        ctx.fillRect(0, ly + offY + 12, Engine.width, 1);
      }
    }
    ctx.restore();

    // Ambient floating particles (theme-specific)
    const t = performance.now() / 1000;
    ctx.save();
    if (currentTheme === 'circus') {
      // Confetti
      for (let i = 0; i < 15; i++) {
        const px = ((i * 211 + t * 12) % (Engine.width + 100)) - 50;
        const py = ((i * 157 + Math.sin(t * 0.8 + i * 2.1) * 40 + t * 20) % (Engine.height + 60)) - 30;
        const hue = (i * 72) % 360;
        ctx.fillStyle = `hsla(${hue}, 70%, 65%, 0.08)`;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(t * 1.5 + i);
        ctx.fillRect(-3, -1, 6, 2);
        ctx.restore();
      }
    } else if (currentTheme === 'harlequin') {
      // Stage light beams
      for (let i = 0; i < 4; i++) {
        const bx = (Engine.width / 5) * (i + 1) + Math.sin(t * 0.3 + i * 1.5) * 60;
        const grad2 = ctx.createLinearGradient(bx, 0, bx, Engine.height);
        grad2.addColorStop(0, 'rgba(140,100,220,0.04)');
        grad2.addColorStop(1, 'rgba(140,100,220,0)');
        ctx.fillStyle = grad2;
        ctx.beginPath();
        ctx.moveTo(bx - 20, 0);
        ctx.lineTo(bx - 80, Engine.height);
        ctx.lineTo(bx + 80, Engine.height);
        ctx.lineTo(bx + 20, 0);
        ctx.fill();
      }
    } else if (currentTheme === 'puppet') {
      // Sawdust motes
      for (let i = 0; i < 20; i++) {
        const px = ((i * 193 + t * 8 + Math.sin(t * 0.5 + i) * 30) % (Engine.width + 40)) - 20;
        const py = ((i * 127 + t * 15) % (Engine.height + 40)) - 20;
        const size = 1 + (i % 2);
        ctx.fillStyle = `rgba(180,150,100,${0.06 + Math.sin(t + i * 0.7) * 0.02})`;
        ctx.fillRect(px, py, size, size);
      }
    }
    ctx.restore();

    ctx.save();
    ctx.translate(-Camera.drawX, -Camera.drawY);

    // Draw tiles (viewport culled)
    const viewL = Camera.x - 32;
    const viewR = Camera.x + Engine.width + 32;
    const viewT = Camera.y - 32;
    const viewB = Camera.y + Engine.height + 32;

    // ── Circus tent set-piece (Big Drop finale) ──
    // Single source of truth: the tent is drawn around the GOAL tile, so the
    // mouth and the win hitbox can never drift apart.
    const goal0 = this.maps[this.currentMap].tent && this._cachedGoals && this._cachedGoals[0];
    if (goal0) {
      const s = this.tileSize;
      const mouthX = goal0.x + goal0.w / 2;        // centre on the goal column
      const baseY = goal0.y + s;                   // tent sits on the goal row's floor
      const tw = s * 6, th = s * 5;                // tent footprint
      const left = mouthX - tw / 2;
      const peakY = baseY - th;
      // Striped canopy (triangle fan from the peak)
      const stripes = 6;
      for (let i = 0; i < stripes; i++) {
        ctx.fillStyle = (i % 2 === 0) ? Tokens.color.tentRed : Tokens.color.tentCream;
        ctx.beginPath();
        ctx.moveTo(mouthX, peakY);
        ctx.lineTo(left + (tw * i) / stripes, baseY);
        ctx.lineTo(left + (tw * (i + 1)) / stripes, baseY);
        ctx.closePath();
        ctx.fill();
      }
      // Flag pole + pennant at the peak
      ctx.strokeStyle = Tokens.color.frame; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mouthX, peakY); ctx.lineTo(mouthX, peakY - 18); ctx.stroke();
      ctx.fillStyle = Tokens.color.tentRed;
      ctx.beginPath(); ctx.moveTo(mouthX, peakY - 18); ctx.lineTo(mouthX + 14, peakY - 13); ctx.lineTo(mouthX, peakY - 8); ctx.closePath(); ctx.fill();
      // Dark mouth (the goal sits here)
      const mw = s * 1.4, mh = s * 1.8;
      ctx.fillStyle = Tokens.color.tentMouth;
      ctx.beginPath();
      ctx.moveTo(mouthX - mw / 2, baseY);
      ctx.lineTo(mouthX - mw / 2, baseY - mh * 0.6);
      ctx.quadraticCurveTo(mouthX, baseY - mh, mouthX + mw / 2, baseY - mh * 0.6);
      ctx.lineTo(mouthX + mw / 2, baseY);
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = 1;
    }

    for (const tile of this.tiles) {
      // Skip tiles outside viewport
      if (tile.x + tile.w < viewL || tile.x > viewR || tile.y + tile.h < viewT || tile.y > viewB) continue;

      if (tile.type === 'solid') {
        // Skip broken breakable tiles
        if (tile.broken) continue;

        const mat = tile.material && Level.materials[tile.material];
        const colors = (mat && mat.color) ? mat.color : theme.tile;

        // Grid position for edge detection
        const col = Math.floor(tile.x / this.tileSize);
        const row = Math.floor(tile.y / this.tileSize);
        const noTop = this._isSolid(row - 1, col);
        const noBot = this._isSolid(row + 1, col);
        const noLeft = this._isSolid(row, col - 1);
        const noRight = this._isSolid(row, col + 1);

        // Main tile fill
        ctx.fillStyle = colors[1];
        ctx.fillRect(tile.x, tile.y, tile.w, tile.h);

        // Exposed edge highlights (only on sides facing air)
        if (!noTop) {
          ctx.fillStyle = colors[2];
          ctx.fillRect(tile.x, tile.y, tile.w, 2);
        }
        if (!noBot) {
          ctx.fillStyle = colors[0];
          ctx.fillRect(tile.x, tile.y + tile.h - 2, tile.w, 2);
        }
        if (!noLeft) {
          ctx.fillStyle = colors[2];
          ctx.fillRect(tile.x, tile.y, 2, tile.h);
        }
        if (!noRight) {
          ctx.fillStyle = colors[0];
          ctx.fillRect(tile.x + tile.w - 2, tile.y, 2, tile.h);
        }

        // Material-specific visual indicator
        if (tile.material === 'treadmill') {
          // Scrolling belt chevrons
          ctx.fillStyle = Tokens.rgba(Tokens.color.belt, 0.18);
          const off = Math.floor((performance.now() / 1000 * 40) % 16);
          for (let bx = 0; bx < tile.w; bx += 16) {
            ctx.fillRect(tile.x + ((bx + off) % tile.w), tile.y + tile.h / 2 - 1, 9, 2);
          }
        }
      } else if (tile.type === 'goal') {
        // Pulsing goal with theme color
        const gc = theme.goalColor;
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
        ctx.fillStyle = `rgba(${gc[0]}, ${gc[1]}, ${gc[2]}, ${0.3 + pulse * 0.4})`;
        ctx.fillRect(tile.x + 4, tile.y + 4, tile.w - 8, tile.h - 8);
        ctx.strokeStyle = `rgba(${gc[0]}, ${gc[1]}, ${gc[2]}, ${0.5 + pulse * 0.3})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(tile.x + 2, tile.y + 2, tile.w - 4, tile.h - 4);
      } else if (tile.type === 'slope') {
        const s = this.tileSize;
        // Solid region is BELOW the hypotenuse: lower-right triangle for '/',
        // lower-left for '\'.
        ctx.fillStyle = theme.tile[1];
        ctx.beginPath();
        if (tile.slopeDir > 0) {                 // '/'  low-left, high-right
          ctx.moveTo(tile.x, tile.y + s);
          ctx.lineTo(tile.x + s, tile.y);
          ctx.lineTo(tile.x + s, tile.y + s);
        } else {                                 // '\'  high-left, low-right
          ctx.moveTo(tile.x, tile.y);
          ctx.lineTo(tile.x, tile.y + s);
          ctx.lineTo(tile.x + s, tile.y + s);
        }
        ctx.closePath();
        ctx.fill();
        // Exposed-edge highlight along the hypotenuse (the ridable surface).
        ctx.strokeStyle = theme.tile[2];
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (tile.slopeDir > 0) { ctx.moveTo(tile.x, tile.y + s); ctx.lineTo(tile.x + s, tile.y); }
        else { ctx.moveTo(tile.x, tile.y); ctx.lineTo(tile.x + s, tile.y + s); }
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    // Draw collectibles (gems) — viewport culled
    const gc = theme.goalColor;
    for (const col of this.collectibles) {
      if (col.collected) continue;
      if (col.x + col.w < viewL || col.x > viewR || col.y + col.h < viewT || col.y > viewB) continue;
      const t = performance.now() / 1000;
      const bob = Math.sin(t * 3 + col.x * 0.1) * 3; // gentle bob
      const pulse = 0.6 + 0.3 * Math.sin(t * 4 + col.x * 0.2);
      const cx = col.x + col.w / 2;
      const cy = col.y + col.h / 2 + bob;
      // Outer glow
      ctx.fillStyle = `rgba(${gc[0]}, ${gc[1]}, ${gc[2]}, ${pulse * 0.15})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fill();
      // Diamond shape
      ctx.fillStyle = `rgba(${gc[0]}, ${gc[1]}, ${gc[2]}, ${pulse})`;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 7);
      ctx.lineTo(cx + 5, cy);
      ctx.lineTo(cx, cy + 7);
      ctx.lineTo(cx - 5, cy);
      ctx.closePath();
      ctx.fill();
      // Inner highlight
      ctx.fillStyle = Tokens.rgba(Tokens.color.white, pulse * 0.4);
      ctx.beginPath();
      ctx.moveTo(cx, cy - 4);
      ctx.lineTo(cx + 2, cy);
      ctx.lineTo(cx, cy + 4);
      ctx.lineTo(cx - 2, cy);
      ctx.closePath();
      ctx.fill();
    }

    // Draw checkpoints
    for (const cp of this.checkpoints) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 500);
      if (cp.active) {
        // Active checkpoint: bright gold flag
        ctx.fillStyle = Tokens.rgba(Tokens.color.goldFlag, 0.7 + pulse * 0.3);
        // Flagpole
        ctx.fillRect(cp.x + cp.w / 2 - 1, cp.y + 4, 2, cp.h - 4);
        // Flag
        ctx.fillRect(cp.x + cp.w / 2 + 1, cp.y + 4, 10, 8);
      } else {
        // Inactive: dim
        ctx.fillStyle = `rgba(150, 150, 150, ${0.3 + pulse * 0.1})`;
        ctx.fillRect(cp.x + cp.w / 2 - 1, cp.y + 4, 2, cp.h - 4);
        ctx.fillRect(cp.x + cp.w / 2 + 1, cp.y + 6, 8, 6);
      }
    }

    ctx.restore();
  }
};
