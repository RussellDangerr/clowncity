// verify/og.js — renders og.png (1200×630 link preview) from the game's own
// drawing code, so the preview is our own art (safe for the public repo).
// Usage: fetch('/verify/og.js').then(r=>r.text()).then(eval); const c = await renderOG();
(function () {
  window.renderOG = async function () {
    await document.fonts.ready;
    const W = 1200, H = 630;                 // 1:1 world pixels — Bozo at full size
    const prev = { level: Game.currentLevel, state: Game.state };
    Engine.halted = true;
    try {
      Engine.setView(W, H);
      Level.load(2);                         // The Big Drop: kicker, chasm, tent
      Entities.list.length = 0;
      Camera.snapTo(26 * 32, 110);           // cols 26–63: kicker → whole tent; sky for the title
      Player.spawn(34 * 32, 10.5 * 32);      // mid-leap over the chasm, below the title
      Object.assign(Player, { respawning: false, vx: 620, vy: -120, lean: 0.06, squash: 1.15 });
      Particles.pool.length = 0;
      Player._carnivalSpray(1);
      for (let i = 0; i < 14; i++) Particles.update(1 / 120);

      const ctx = Engine.ctx;
      ctx.clearRect(0, 0, W, H);
      Level.draw(ctx);
      Particles.draw(ctx);
      ctx.save(); ctx.translate(-Camera.drawX, -Camera.drawY); Player.draw(ctx); ctx.restore();

      const out = document.createElement('canvas');
      out.width = 1200; out.height = 630;
      const o = out.getContext('2d');
      o.drawImage(Engine.canvas, 0, 0);
      o.textAlign = 'center';
      o.font = '112px Ewert, monospace';
      o.fillStyle = Tokens.color.goldDeep;   o.fillText('CLOWN CITY', 600, 150);
      o.fillStyle = Tokens.color.goldShade;  o.fillText('CLOWN CITY', 600, 146);
      o.fillStyle = Tokens.color.goldBright; o.fillText('CLOWN CITY', 600, 142);
      o.font = 'bold 26px Cinzel, serif';
      o.fillStyle = Tokens.color.ink;
      o.fillText('A  UNICYCLE  AUTO-RUNNER', 600, 196);
      return out;
    } finally {
      Layout.apply();                        // restores the screen's view (it differs from 1200×630)
      Game.loadLevel(prev.level); Game.state = prev.state;
      Engine.halted = false;
    }
  };
})();
