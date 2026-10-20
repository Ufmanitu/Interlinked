import { createScreen, VIRTUAL_W, VIRTUAL_H } from './core-screen.js';
import { Input } from './core-input.js';
import { VERSION, VERSION_DATE } from './version.js';
import { initDebug } from './core-debug.js';
import { createPlayer, stepPlayer } from './game-player.js';
import { createCamera, stepCamera, cameraOffset } from './game-camera.js';

initDebug();

export const STEP = 1 / 60; // fix 60 Hz logikai lépés
const MAX_FRAME = 0.25;     // spirál-védelem

const canvas = document.getElementById('game');
const screen = createScreen(canvas);
const input = new Input();

const players = [createPlayer(0, 400, 270), createPlayer(1, 540, 270)];
const camera = createCamera((players[0].x + players[1].x) / 2, (players[0].y + players[1].y) / 2);
const game = { time: 0, ticks: 0, fps: 0, players, camera };

function update(dt) {
  input.update();
  game.players.forEach((p, i) => stepPlayer(p, input.get(i), dt));
  stepCamera(game.camera, game.players[0], game.players[1], dt);
  game.time += dt;
  game.ticks++;
}

// Ideiglenes rács a kamera-mozgás láthatóságáért (S012-től tile-ok).
function drawGrid(ctx, o) {
  const T = 32;
  ctx.fillStyle = '#161c28';
  const x0 = Math.floor(o.x / T), x1 = Math.ceil((o.x + VIRTUAL_W) / T);
  const y0 = Math.floor(o.y / T), y1 = Math.ceil((o.y + VIRTUAL_H) / T);
  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0; tx < x1; tx++) {
      if ((tx + ty) & 1) ctx.fillRect(tx * T - o.x, ty * T - o.y, T, T);
      if (tx % 10 === 0 && ty % 10 === 0) {
        ctx.fillStyle = '#2a3750';
        ctx.fillRect(tx * T - o.x, ty * T - o.y, T, T);
        ctx.fillStyle = '#161c28';
      }
    }
  }
}

function render() {
  const ctx = screen.ctx;
  const o = cameraOffset(game.camera, { w: VIRTUAL_W, h: VIRTUAL_H });
  ctx.fillStyle = '#10141c';
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
  drawGrid(ctx, o);
  for (const p of game.players) {
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x - p.w / 2) - o.x, Math.round(p.y - p.h / 2) - o.y, p.w, p.h);
  }
  ctx.font = '12px monospace';
  ctx.textBaseline = 'top';
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
