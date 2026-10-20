import { createScreen, VIRTUAL_W, VIRTUAL_H } from './core-screen.js';
import { Input } from './core-input.js';
import { VERSION, VERSION_DATE } from './version.js';
import { initDebug } from './core-debug.js';

initDebug();

export const STEP = 1 / 60; // fix 60 Hz logikai lépés
const MAX_FRAME = 0.25;     // spirál-védelem

const canvas = document.getElementById('game');
const screen = createScreen(canvas);
const input = new Input();

const game = { time: 0, ticks: 0, fps: 0 };

function update(dt) {
  input.update();
  game.time += dt;
  game.ticks++;
}

function render() {
  const ctx = screen.ctx;
  ctx.fillStyle = '#10141c';
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
  ctx.fillStyle = '#9fb4d0';
  ctx.font = '12px monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(`Interlinked ${VERSION} (${VERSION_DATE})  FPS ${game.fps.toFixed(0)}`, 8, 8);
}

let last = performance.now(), acc = 0, fpsAcc = 0, fpsN = 0;
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > MAX_FRAME) dt = MAX_FRAME;
  acc += dt;
  while (acc >= STEP) { update(STEP); acc -= STEP; }
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) { game.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__game = { game, input, screen };
