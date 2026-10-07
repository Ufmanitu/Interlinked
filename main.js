// Fix 60 Hz lépésű game loop + render. A boot csak böngészőben fut (Node-ban importálható).
import { W, H, createScreen } from './core-screen.js';
import { Input } from './core-input.js';
import { createDebug } from './core-debug.js';
import { versionString } from './version.js';

export function createLoop({ step, render, hz = 60, maxSteps = 5 }) {
  const dt = 1000 / hz;
  let acc = 0;
  return {
    dt,
    // elapsedMs: a két képkocka közt eltelt idő; visszaadja a lefuttatott lépések számát
    frame(elapsedMs) {
      acc += Math.min(elapsedMs, dt * maxSteps);
      let n = 0;
      while (acc >= dt - 1e-9 && n < maxSteps) { step(dt / 1000); acc -= dt; n++; }
      render(Math.max(0, acc) / dt);
      return n;
    },
  };
}

function boot() {
  const dbg = createDebug();
  const screen = createScreen(document.getElementById('game'));
  const input = new Input();
  const g = screen.ctx;
  const loop = createLoop({
    step: () => input.update(),
    render: () => {
      g.fillStyle = '#10141c';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#1a2130';
      for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 1, H);
      for (let y = 0; y < H; y += 32) g.fillRect(0, y, W, 1);
      g.strokeStyle = '#3a4a6a';
      g.strokeRect(0.5, 0.5, W - 1, H - 1);
      g.fillStyle = '#9fb4d8';
      g.font = '12px monospace';
      g.textAlign = 'right';
      g.textBaseline = 'bottom';
      g.fillText(versionString(), W - 6, H - 6);
    },
  });
  let last = performance.now(), fAcc = 0, fN = 0;
  const raf = (t) => {
    const el = t - last;
    last = t;
    loop.frame(el);
    fAcc += el; fN++;
    if (fAcc >= 500) { dbg.setFps(Math.round((fN * 1000) / fAcc)); fAcc = 0; fN = 0; }
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
}

if (typeof document !== 'undefined' && document.getElementById('game')) boot();
