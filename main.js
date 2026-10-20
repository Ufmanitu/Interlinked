import { createScreen, VIRTUAL_W, VIRTUAL_H } from './core-screen.js';
import { Input } from './core-input.js';
import { VERSION, VERSION_DATE } from './version.js';
import { initDebug } from './core-debug.js';
import { createPlayer, stepPlayer } from './game-player.js';

initDebug();

export const STEP = 1 / 60; // fix 60 Hz logikai lépés
const MAX_FRAME = 0.25;     // spirál-védelem

const canvas = document.getElementById('game');
const screen = createScreen(canvas);
const input = new Input();

const game = { time: 0, ticks: 0, fps: 0, players: [createPlayer(0, 400, 270), createPlayer(1, 540, 270)] };

function update(dt) {
  input.update();
  game.players.forEach((p, i) => stepPlayer(p, input.get(i), dt));
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
  for (const p of game.players) {
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x - p.w / 2), Math.round(p.y - p.h / 2), p.w, p.h);
  }
  ctx.fillStyle = '#9fb4d0';
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
