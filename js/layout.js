// ─── Layout: screen mode, canvas sizing, camera lead ───
// Two modes:
//   'deck'   — a touch device held upright: the game renders a zoomed 640×480
//              view across the top and the on-screen deck (#deck) fills the rest.
//   'normal' — everything else (desktop in any window shape, phone sideways):
//              the classic 960×540 view, letterboxed to fit.
// The input scheme ('deck' | 'touch' | 'keys') decides the mode and, later, the
// hint copy. Re-evaluated on every resize (orientation changes fire one).
const Layout = {
  force: null,        // 'deck' | 'touch' | 'keys' — overrides detection (checks / debugging)
  scheme: 'keys',
  // uiScale enlarges overlay screens (level complete, finale, win): the deck
  // view is drawn ~0.59× on a phone, so unscaled 14px stats land at ~8px.
  views: {
    normal: { w: 960, h: 540, lookahead: 60,  uiScale: 1 },
    deck:   { w: 640, h: 480, lookahead: 220, uiScale: 1.35 },   // lead further so Bozo sits left of centre
  },
  deckMinH: 200,      // px — the deck is never shorter than this

  // Copy that depends on how you're playing. One place, so it can't drift.
  hints: {
    keys: {
      splash: 'steer ◂▸ · space to jump · press your heading to spray',
      select: '← →  choose       SPACE  play',
      pause:  '← → turn · space jump · press your heading to spray · esc resume',
      muted:  '[MUTED - M to toggle]',
      continue: 'SPACE',
    },
    touch: {
      splash: 'swipe to turn · tap to jump · swipe your heading to spray',
      select: 'SWIPE  choose       TAP  play',
      pause:  'swipe to turn · tap to jump · swipe your heading to spray',
      muted:  '[MUTED]',
      continue: 'TAP',
    },
    deck: {
      splash: '◀ ▶ to turn · jump · press your heading to spray',
      select: '◀ ▶  choose       JUMP  play',
      pause:  '◀ ▶ turn · JUMP jump · press your heading to spray',
      muted:  '[MUTED]',
      continue: 'JUMP',
    },
  },

  hint(key) { return this.hints[this.scheme][key]; },

  get mode() { return this.scheme === 'deck' ? 'deck' : 'normal'; },

  init() {
    this.apply();
    window.addEventListener('resize', () => this.apply());
  },

  detect() {
    if (this.force) return this.force;
    if (!matchMedia('(pointer: coarse)').matches) return 'keys';
    return matchMedia('(orientation: portrait)').matches ? 'deck' : 'touch';
  },

  apply() {
    const prev = this.scheme;
    this.scheme = this.detect();
    const root = document.documentElement;
    root.classList.toggle('deck', this.scheme === 'deck');
    root.classList.toggle('touch', this.scheme !== 'keys');

    const v = this.views[this.mode];
    if (Engine.width !== v.w || Engine.height !== v.h) Engine.setView(v.w, v.h);
    Camera.lookaheadX = v.lookahead;

    const hint = document.getElementById('hint');
    if (hint) hint.textContent = this.hint('splash');

    // CSS size: fit the view. A hidden preview pane reports 0×0 — skip then.
    const vw = window.innerWidth, vh = window.innerHeight;
    if (vw && vh) {
      const availH = vh - (this.mode === 'deck' ? this.deckMinH : 0);
      const scale = Math.max(0.1, Math.min(vw / v.w, availH / v.h));
      Engine.canvas.style.width = (v.w * scale) + 'px';
      Engine.canvas.style.height = (v.h * scale) + 'px';
    }
    if (prev !== this.scheme && Level.collectibles) Camera.snapToPlayer();
  },
};
