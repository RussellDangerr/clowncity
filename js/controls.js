// ─── Controls: on-screen deck, floating pause button, pause menu ───
// DOM UI for touch play. Every control is a virtual key through Input._down /
// _up / tapKey, so Game and Player never know whether a press came from the
// keyboard, the deck, or the pause menu.
const Controls = {
  init() {
    this._bindHold('btn-left', 'ArrowLeft');
    this._bindHold('btn-right', 'ArrowRight');
    this._bindHold('btn-jump', 'Space');
    this._bindHold('btn-pause', 'Escape');
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

  update() {},
};
