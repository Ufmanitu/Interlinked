import { createScreen, VIRTUAL_W, VIRTUAL_H } from './core-screen.js';
import { Input } from './core-input.js';
import { VERSION, VERSION_DATE } from './version.js';
import { initDebug } from './core-debug.js';
import { createPlayer } from './game-player.js';
import { createCamera, stepCamera, cameraOffset } from './game-camera.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { generateWalls } from './game-walls.js';
import { TetherConfig, bindTetherConfigKeys, tetherHudLines } from './tether-config.js';
import { createTetherVisual, stepTetherVisual, tetherCurve, tetherStyle } from './tether-visual.js';

initDebug();

export const STEP = 1 / 60; // fix 60 Hz logikai lépés
const MAX_FRAME = 0.25;     // spirál-védelem

const canvas = document.getElementById('game');
const screen = createScreen(canvas);
const input = new Input();

const players = [createPlayer(0, 400, 270), createPlayer(1, 540, 270)];
const camera = createCamera((players[0].x + players[1].x) / 2, (players[0].y + players[1].y) / 2);
const walls = generateWalls();
const tc = new TetherConfig();                 // hangolható póráz-értékek (localStorage), billentyűk: 1-9
const tether = createTetherSystem(tc.systemConfig({ walls }));
const camCfg = tc.cameraConfig();
bindTetherConfigKeys(tc);
const vis = createTetherVisual();              // a fonal megjelenített állapota; vis.on(fn): szint-események (hanghoz)
const game = { time: 0, ticks: 0, fps: 0, players, camera, tether, walls };

function update(dt) {
  input.update();
  stepTetherSystem(tether, game.players, [input.get(0), input.get(1)], dt);
  stepTetherVisual(vis, tether, dt);
  stepCamera(game.camera, game.players[0], game.players[1], dt, camCfg);
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

function drawWalls(ctx, o) {
  ctx.fillStyle = '#3a4660';
  for (const w of game.walls) {
    if (w.x + w.w < o.x || w.x > o.x + VIRTUAL_W || w.y + w.h < o.y || w.y > o.y + VIRTUAL_H) continue;
    ctx.fillRect(w.x - o.x, w.y - o.y, w.w, w.h);
  }
}

// A fonal: lazán lógó görbe, a szín és a vastagság a feszülés szerint (laza/feszes/kritikus).
function drawTether(ctx, o) {
  const [a, b] = game.players;
  const pts = tetherCurve(a, b, vis.s);
  const st = tetherStyle(vis.s, vis.level);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const path = () => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = Math.round(p.x) - o.x, y = Math.round(p.y) - o.y;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
  };
  path();
  ctx.strokeStyle = 'rgba(8,12,20,0.55)'; // sötét körvonal az olvashatóságért
  ctx.lineWidth = st.width + 2;
  ctx.stroke();
  path();
  ctx.strokeStyle = st.color;
  ctx.lineWidth = st.width;
  ctx.stroke();
}

// Debug HUD: póráz-értékek (stretch tengelyenként, k, L_eff) és a konfig; a 9-es billentyű ki/be kapcsolja.
function drawTetherHud(ctx, x, y) {
  const lines = tetherHudLines(tether, tc);
  const lh = 14;
  ctx.font = '12px monospace';
  ctx.textBaseline = 'top';
  let w = 0;
  for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  ctx.fillStyle = 'rgba(8,12,20,0.6)';
  ctx.fillRect(x - 4, y - 4, Math.ceil(w) + 8, lines.length * lh + 8);
  ctx.fillStyle = tether.stretch.x >= 0.999 || tether.stretch.y >= 0.999 ? '#ffb45a' : '#9fb4d0'; // a korlátnál borostyán
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
}

function render() {
  const ctx = screen.ctx;
  const o = cameraOffset(game.camera, { w: VIRTUAL_W, h: VIRTUAL_H });
  ctx.fillStyle = '#10141c';
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
  drawGrid(ctx, o);
  drawWalls(ctx, o);
  drawTether(ctx, o);
  for (const p of game.players) {
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x - p.w / 2) - o.x, Math.round(p.y - p.h / 2) - o.y, p.w, p.h);
  }
  ctx.font = '12px monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#9fb4d0';
  ctx.fillText(`Interlinked ${VERSION} (${VERSION_DATE})  FPS ${game.fps.toFixed(0)}`, 8, 8);
  if (tc.hud) drawTetherHud(ctx, 8, 28);
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

window.__game = { game, input, screen, tether, tc, vis };
