import { createScreen, VIRTUAL_W, VIRTUAL_H } from './core-screen.js';
import { Input } from './core-input.js';
import { VERSION, VERSION_DATE } from './version.js';
import { initDebug } from './core-debug.js';
import { createPlayer } from './game-player.js';
import { createCamera, stepCamera, cameraOffset } from './game-camera.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { TetherConfig, bindTetherConfigKeys, tetherHudLines } from './tether-config.js';
import { createTetherVisual, stepTetherVisual, tetherCurve, tetherStyle } from './tether-visual.js';
import { createTileAtlas } from './render-tiles.js';
import { WORLD_SEED, createWorldStream, warmStream, updateStream, streamWalls, findOpenSpot } from './world-stream.js';
import { createChunkRenderer, drawChunks } from './render-chunks.js';
import { createObjectStore, syncObjects, objectColliders, objectCount } from './world-objects.js';
import { createObjectSprites, drawYSorted } from './render-objects.js';

initDebug();

export const STEP = 1 / 60; // fix 60 Hz logikai lépés
const MAX_FRAME = 0.25;     // spirál-védelem

const canvas = document.getElementById('game');
const screen = createScreen(canvas);
const input = new Input();

// Chunk-világ (S014): a kezdőhely a (0,0) körüli első nyitott terület; a falak a betöltött chunkokból jönnek.
const spot = findOpenSpot(WORLD_SEED, 0, 0) || { x: 16, y: 16 };
const SPAWN = [[spot.x - 70, spot.y], [spot.x + 70, spot.y]];
const players = SPAWN.map(([x, y], i) => createPlayer(i, x, y));
const camera = createCamera((players[0].x + players[1].x) / 2, (players[0].y + players[1].y) / 2);
const world = createWorldStream(WORLD_SEED);
warmStream(world, players);
// Objektumok (S015): fa, kő; a kezdőhely körül szabad terület marad; az ütközők a falak közé kerülnek.
const objects = createObjectStore(WORLD_SEED, { keepFree: [{ x: spot.x, y: spot.y, r: 224 }] });
syncObjects(objects, world);
const objSprites = createObjectSprites();
const walls = [];                              // helyben frissítjük (a póráz-rendszer ugyanezt a tömböt olvassa)
let wallsKey = '';
function refreshWalls() {
  const key = world.version + '|' + objects.version;
  if (key === wallsKey) return;
  wallsKey = key;
  walls.length = 0;
  for (const r of streamWalls(world)) walls.push(r);
  for (const r of objectColliders(objects)) walls.push(r);
}
refreshWalls();
const atlas = createTileAtlas();
const chunkRend = createChunkRenderer(atlas);
const tc = new TetherConfig();                 // hangolható póráz-értékek (localStorage), billentyűk: 1-9
const tether = createTetherSystem(tc.systemConfig({ walls }));
const camCfg = tc.cameraConfig();
bindTetherConfigKeys(tc);
const vis = createTetherVisual();              // a fonal megjelenített állapota; vis.on(fn): szint-események (hanghoz)
const game = { time: 0, ticks: 0, fps: 0, players, camera, tether, walls, world, objects };

function update(dt) {
  input.update();
  updateStream(world, game.players);
  syncObjects(objects, world);
  refreshWalls(); // a betöltött chunkok/objektumok változtak -> falak újraépítése (ugyanabban a tömbben)
  stepTetherSystem(tether, game.players, [input.get(0), input.get(1)], dt);
  stepTetherVisual(vis, tether, dt);
  stepCamera(game.camera, game.players[0], game.players[1], dt, camCfg);
  game.time += dt;
  game.ticks++;
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

function drawPlayer(ctx, p, ox, oy) {
  ctx.fillStyle = p.color;
  ctx.fillRect(Math.round(p.x - p.w / 2) - ox, Math.round(p.y - p.h / 2) - oy, p.w, p.h);
}

function render() {
  const ctx = screen.ctx;
  const o = cameraOffset(game.camera, { w: VIRTUAL_W, h: VIRTUAL_H });
  ctx.fillStyle = '#10141c';
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
  drawChunks(ctx, chunkRend, world, o.x, o.y, VIRTUAL_W, VIRTUAL_H);
  drawTether(ctx, o);
  drawYSorted(ctx, objSprites, objects, game.players, o.x, o.y, VIRTUAL_W, VIRTUAL_H, drawPlayer);
  ctx.font = '12px monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#9fb4d0';
  ctx.fillText(`Interlinked ${VERSION} (${VERSION_DATE})  FPS ${game.fps.toFixed(0)}  chunk ${world.chunks.size}/${chunkRend.cache.size}  obj ${objectCount(objects)}`, 8, 8);
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

window.__game = { game, input, screen, tether, tc, vis, world, atlas, chunkRend, objects, objSprites };
