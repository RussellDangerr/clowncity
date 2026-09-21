// ─── Controls: on-screen deck, floating pause button, pause menu ───
// DOM UI for touch play. Every control is a virtual key through Input._down /
// _up / tapKey, so Game and Player never know whether a press came from the
// keyboard, the deck, or the pause menu.
const Controls = {
  _state: null,       // last Game.state / Audio.muted / pause-hint scheme pushed to the DOM
  _muted: null,
  _hintKey: null,

  init() {
    this._bindHold('btn-left', 'ArrowLeft');
    this._bindHold('btn-right', 'ArrowRight');
    this._bindHold('btn-jump', 'Space');
    this._bindHold('btn-pause', 'Escape');
    this._bindTap('pause-btn', 'Escape');
    this._bindTap('pm-resume', 'Escape');
    this._bindTap('pm-restart', 'KeyR');
    this._bindTap('pm-levels', 'KeyQ');
    this._bindTap('pm-sound', 'KeyM');
  },

  // Held control: press on pointerdown (instant — no waiting for the lift),
  // release on pointerup / cancel / lost capture.
  _bindHold(id, code) {
    const el = document.getElementById(id);
    const up = () => {
      if (!el.classList.contains('down')) return;
      el.classList.remove('down');
      Input._up(code);
    };
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic or inactive pointer */ }
      if (el.classList.contains('down')) return;
      el.classList.add('down');
      Input._down(code);
    });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  },

  // Menu button: one press-and-release per click (tap or mouse).
  _bindTap(id, code) {
    document.getElementById(id).addEventListener('click', () => Input.tapKey(code));
  },

  // Keep the DOM in step with the game — only touching it when something changed.
  update() {
    const state = Game.state;
    if (state !== this._state) {
      this._state = state;
      document.getElementById('pause-menu').hidden = state !== 'paused';
      document.getElementById('pause-btn').hidden = state !== 'playing';
    }
    if (Audio.muted !== this._muted) {
      this._muted = Audio.muted;
      document.getElementById('pm-sound').textContent = `Sound: ${Audio.muted ? 'off' : 'on'}`;
    }
    // Controls hint: on entering pause, and again if the phone turns mid-pause.
    const hintKey = state === 'paused' ? Layout.scheme : null;
    if (hintKey && hintKey !== this._hintKey) {
      document.getElementById('pm-hint').textContent = Layout.hint('pause');
    }
    this._hintKey = hintKey;
  },
};
