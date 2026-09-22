// ─── Input: keyboard + touch (swipe / tap) with buffering ───
// Unicycle scheme: horizontal swipe = steer (sticky runDir), tap = jump.
// Keyboard parity is kept for desktop testing (arrows/WASD steer, Space/Up/W jump).
const Input = {
  keys: {},
  justPressed: {},
  buffer: {},          // jump buffer: remembers a press for a few frames
  bufferTime: 0.1,     // seconds to remember a press

  // ── Unicycle controls ──
  runDir: 1,           // sticky travel intent: -1 = left, +1 = right
  _jumpDown: false,    // jump held this frame (cleared each update)
  _tapped: false,      // single-frame: a tap happened (menus = confirm)
  _swipeEdge: 0,       // single-frame: -1/+1 when a swipe just registered (menus = navigate)

  // ── Touch gesture tuning ──
  _touches: {},
  swipeThreshold: 30,  // px of horizontal travel to register a swipe
  tapMaxMove: 14,      // px total movement under which a touch counts as a tap

  init() {
    window.addEventListener('keydown', e => {
      this._down(e.code);
      // Prevent scrolling
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', e => this._up(e.code));

    this.initTouch();
  },

  // ── Virtual keys ── the keyboard, the on-screen deck and the pause menu all
  // press through here, so every input source behaves identically.
  _down(code) {
    if (!this.keys[code]) {
      this.justPressed[code] = true;
      this.buffer[code] = this.bufferTime;
    }
    this.keys[code] = true;
    // Unicycle steering
    if (code === 'ArrowLeft' || code === 'KeyA') this.runDir = -1;
    if (code === 'ArrowRight' || code === 'KeyD') this.runDir = 1;
  },

  _up(code) {
    this.keys[code] = false;
  },

  // One press-and-release (menu buttons). The press edge survives until the
  // next Input.update, so the game still sees it this frame.
  tapKey(code) {
    this._down(code);
    this._up(code);
  },

  // Touches that START on on-screen UI (deck, pause button, pause menu) belong
  // to that UI: no gesture, and no preventDefault (that would swallow its click).
  _isUI(t) {
    return !!(t.target && t.target.closest && t.target.closest('[data-ui]'));
  },

  initTouch() {
    const gameTouches = e => Array.from(e.changedTouches).filter(t => !this._isUI(t));

    window.addEventListener('touchstart', e => {
      const touches = gameTouches(e);
      if (!touches.length) return;
      e.preventDefault();
      for (const t of touches) {
        this._touches[t.identifier] = { x0: t.clientX, y0: t.clientY, swiped: false };
      }
    }, { passive: false });

    window.addEventListener('touchmove', e => {
      const touches = gameTouches(e);
      if (!touches.length) return;
      e.preventDefault();
      for (const t of touches) {
        const rec = this._touches[t.identifier];
        if (!rec) continue;
        const dx = t.clientX - rec.x0;
        if (Math.abs(dx) >= this.swipeThreshold) {
          const dir = dx > 0 ? 1 : -1;
          this.runDir = dir;
          this._swipeEdge = dir;
          rec.swiped = true;
          rec.x0 = t.clientX;  // re-arm so a back-and-forth within one touch re-steers
          rec.y0 = t.clientY;
        }
      }
    }, { passive: false });

    window.addEventListener('touchend', e => {
      const touches = gameTouches(e);
      if (!touches.length) return;
      e.preventDefault();
      for (const t of touches) {
        const rec = this._touches[t.identifier];
        if (!rec) continue;
        const dist = Math.hypot(t.clientX - rec.x0, t.clientY - rec.y0);
        // Any touch that didn't travel is a tap = jump (and a menu confirm),
        // however long it was held — a slow, deliberate press is still a jump.
        if (!rec.swiped && dist < this.tapMaxMove) {
          this.buffer['Jump'] = this.bufferTime;
          this._jumpDown = true;
          this._tapped = true;
        }
        delete this._touches[t.identifier];
      }
    }, { passive: false });

    window.addEventListener('touchcancel', e => {
      for (const t of e.changedTouches) delete this._touches[t.identifier];
    }, { passive: false });
  },

  update(dt) {
    // Clear single-frame flags and tick down buffers
    for (const code in this.justPressed) {
      this.justPressed[code] = false;
    }
    for (const code in this.buffer) {
      this.buffer[code] -= dt;
      if (this.buffer[code] <= 0) delete this.buffer[code];
    }
    // Per-frame touch edges (runDir is sticky — do NOT clear it)
    this._jumpDown = false;
    this._tapped = false;
    this._swipeEdge = 0;
  },

  held(code) {
    return !!this.keys[code];
  },

  pressed(code) {
    return !!this.justPressed[code];
  },

  buffered(code) {
    return this.buffer[code] > 0;
  },

  consumeBuffer(code) {
    delete this.buffer[code];
  },

  // ── Unicycle jump (touch tap OR keyboard) ──
  jumpBuffered() {
    return this.buffered('Jump') || this.buffered('Space') || this.buffered('ArrowUp') || this.buffered('KeyW');
  },

  jumpHeld() {
    return this._jumpDown || this.held('Space') || this.held('ArrowUp') || this.held('KeyW');
  },

  consumeJump() {
    this.consumeBuffer('Jump');
    this.consumeBuffer('Space');
    this.consumeBuffer('ArrowUp');
    this.consumeBuffer('KeyW');
  },

  // ── Menu helpers (so the game is fully playable on touch) ──
  tapped() {
    return this._tapped;
  },

  // Returns -1 / 0 / +1 for a fresh navigation swipe this frame
  swipeEdge() {
    return this._swipeEdge;
  }
};
