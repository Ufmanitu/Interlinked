import { createScreen, VIRTUAL_W, VIRTUAL_H } from './core-screen.js';
import { Input } from './core-input.js';
import { VERSION, VERSION_DATE } from './version.js';
import { initDebug } from './core-debug.js';
import { createPlayer } from './game-player.js';
import { createCamera, stepCamera, cameraOffset } from './game-camera.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { TetherConfig, bindTetherConfigKeys, tetherHudLines, HUD_TEXT } from './tether-config.js';
import { i18n, currentLang, bindLangKeys } from './i18n.js';
import { createTetherVisual, stepTetherVisual, tetherCurve, tetherStyle } from './tether-visual.js';
import { createTileAtlas } from './render-tiles.js';
import { WORLD_SEED, createWorldStream, warmStream, updateStream, streamWalls, findOpenSpot } from './world-stream.js';
import { createChunkRenderer, drawChunks } from './render-chunks.js';
import { createObjectStore, syncObjects, objectColliders, objectCount } from './world-objects.js';
import { createObjectSprites, drawYSorted } from './render-objects.js';
import { createInteractSystem, addObjectSource, addProvider, onInteract, stepInteraction } from './game-interact.js';
import { drawInteractPrompts } from './render-interact.js';
import { createWarpSystem, warpProvider, warpColliders, handleWarpEvent, stepWarp, streamPoints, warpWhere } from './world-warp.js';
import { visibleHouses, drawHouse, drawPockets } from './render-warp.js';
import { createGameClock, stepClock, clockInfo, bindClockKeys } from './game-clock.js';
import { createDayNight, stepDayNight, drawDayNight, clockLabel, drawClockLabel } from './render-daynight.js';
import { createSplitView, stepSplitView, snapSplitView, splitOffsets, mergeBlend } from './game-splitview.js';
import { createSplitRenderer, beginView, composeSplit } from './render-split.js';
import { sanitizeField, fieldL, fieldValue, fieldShare } from './game-field.js';

initDebug();

export const STEP = 1 / 60; // fix 60 Hz logikai lépés
const MAX_FRAME = 0.25;     // spirál-védelem
const VILLAGE_RADIUS = 640; // S027: a falu (Sorskő-mező) sugara px-ben: átmérő 1280 > L_normal; az S028/S097 hangolja

const canvas = document.getElementById('game');
const screen = createScreen(canvas);
const input = new Input();

// Chunk-világ (S014): a kezdőhely a (0,0) körüli első nyitott terület; a falak a betöltött chunkokból jönnek.
const spot = findOpenSpot(WORLD_SEED, 0, 0) || { x: 16, y: 16 };
const SPAWN = [[spot.x - 70, spot.y], [spot.x + 70, spot.y]];
const players = SPAWN.map(([x, y], i) => createPlayer(i, x, y));
const camera = createCamera((players[0].x + players[1].x) / 2, (players[0].y + players[1].y) / 2);
// Két nézet (S023): két kamera (mindkettő a saját játékosán), két offscreen canvas, fix függőleges osztás.
// S025: |Δ| <= 0,85·L_normal -> a két nézet egy közös képet ad (nincs osztóvonal); |Δ| > L_normal -> szétválás (hiszterézis + simított átmenet).
const split = createSplitView(players);
const splitRend = createSplitRenderer(split.layout);
const offs = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
const world = createWorldStream(WORLD_SEED);
warmStream(world, players);
// Objektumok (S015): fa, kő; a kezdőhely körül szabad terület marad; az ütközők a falak közé kerülnek.
const objects = createObjectStore(WORLD_SEED, { keepFree: [{ x: spot.x, y: spot.y, r: 224 }] });
syncObjects(objects, world);
const objSprites = createObjectSprites();
const interact = createInteractSystem();     // S016: interakciós zóna, célpont, egy gomb; a tárgyak a forrásból jönnek
addObjectSource(interact, objects);
const warp = createWarpSystem({ anchor: spot }); // S017: kinti házak + beltér-zsebek (data-warps.js); páros be-/kilépés
addProvider(interact, warpProvider(warp));
onInteract(interact, ev => {
  if (ev.kind !== 'warp' || !handleWarpEvent(warp, players, ev)) return;
  camera.x = (players[0].x + players[1].x) / 2; // a kamera a pár után ugrik (nincs végigsimítás a zsebig)
  camera.y = (players[0].y + players[1].y) / 2;
  snapSplitView(split, players, tc.lNormal()); // a két nézet is a párhoz ugrik (és az összeolvadás állapota újraszámolódik)
});
const clock = createGameClock();               // S018: játékidő (nap/fázis, hookok: onClock); PageUp/PageDown/End: sebesség
bindClockKeys(clock);
const dn = createDayNight();                   // S018: nap/éjszaka színezés (beltérben halványabb)
const walls = [];                              // helyben frissítjük (a póráz-rendszer ugyanezt a tömböt olvassa)
let wallsKey = '';
function refreshWalls() {
  const key = world.version + '|' + objects.version;
  if (key === wallsKey) return;
  wallsKey = key;
  walls.length = 0;
  for (const r of streamWalls(world)) walls.push(r);
  for (const r of objectColliders(objects)) walls.push(r);
  warpColliders(warp, walls); // házak, zseb-falak, ütköző bútorok
}
refreshWalls();
const atlas = createTileAtlas();
const chunkRend = createChunkRenderer(atlas, { maxCanvases: 8 }); // két nézet: legfeljebb 2x4 chunk
const tc = new TetherConfig();                 // hangolható póráz-értékek (localStorage), billentyűk: 1-9
// S027: a Sorskő mezője a pórázban: L_eff = lerp(L_normal, L_falu, min(f(A), f(B))); a split-view továbbra is L_normal-t kap.
const field = sanitizeField({ id: 'sorsko', x: spot.x, y: spot.y, radius: VILLAGE_RADIUS });
const sysCfg = tc.systemConfig({ walls, field });
sysCfg.L = fieldL(field, () => tc.lNormal());
const tether = createTetherSystem(sysCfg);
const camCfg = tc.cameraConfig();
bindTetherConfigKeys(tc);
snapSplitView(split, players, tc.lNormal()); // induláskor az összeolvadás állapota a játékosok távolságából
bindLangKeys(i18n, window);                    // S019: F8 = nyelvváltás HU/EN (az S107 menü átveszi)
const vis = createTetherVisual();              // a fonal megjelenített állapota; vis.on(fn): szint-események (hanghoz)
const game = { time: 0, ticks: 0, fps: 0, players, camera, split, tether, walls, world, objects, interact, warp, clock, field };
const drawList = [];                           // y-sort lista: játékosok + látható házak

function update(dt) {
  input.update();
  stepWarp(warp, dt);
  stepClock(clock, dt);
  stepDayNight(dn, warpWhere(warp, game.players) ? 1 : 0, dt);
  updateStream(world, streamPoints(warp, game.players)); // a zsebben lévő játékos helyett a kinti kilépési pont
  syncObjects(objects, world);
  refreshWalls(); // a betöltött chunkok/objektumok változtak -> falak újraépítése (ugyanabban a tömbben)
  const inputs = [input.get(0), input.get(1)];
  stepTetherSystem(tether, game.players, inputs, dt);
  stepInteraction(interact, game.players, inputs, dt); // a mozgás után: a zóna a végleges pozícióhoz igazodik
  stepTetherVisual(vis, tether, dt);
  stepCamera(game.camera, game.players[0], game.players[1], dt, camCfg);
  stepSplitView(split, game.players, dt, camCfg, tc.lNormal()); // L_normal: az összeolvadás küszöbei ehhez mérve
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
  const lines = tetherHudLines(tether, tc, HUD_TEXT[currentLang()] || HUD_TEXT.hu);
  const [pa, pb] = game.players; // S027: mező-érték játékosonként és a közös s = min(f(A), f(B))
  lines.splice(lines.length - 1, 0, `field    f(a) ${fieldValue(field, pa).toFixed(2)}  f(b) ${fieldValue(field, pb).toFixed(2)}  s ${fieldShare(field, pa, pb).toFixed(2)}`);
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

function drawEntity(ctx, e, ox, oy) {
  if (e.warp) drawHouse(ctx, e.warp, ox, oy);
  else drawPlayer(ctx, e, ox, oy);
}

function drawPlayer(ctx, p, ox, oy) {
  ctx.fillStyle = p.color;
  ctx.fillRect(Math.round(p.x - p.w / 2) - ox, Math.round(p.y - p.h / 2) - oy, p.w, p.h);
}

// Egy nézet rajza a saját offscreen ctx-re (0,0 = a nézet bal-felső sarka; o = az adott kamera offsetje).
function renderView(ctx, o, vw, vh, ci) {
  drawChunks(ctx, chunkRend, world, o.x, o.y, vw, vh);
  drawPockets(ctx, warp, o.x, o.y, vw, vh);
  drawTether(ctx, o);
  drawList.length = 0;
  for (const p of game.players) drawList.push(p);
  visibleHouses(warp, o.x, o.y, vw, vh, drawList);
  drawYSorted(ctx, objSprites, objects, drawList, o.x, o.y, vw, vh, drawEntity);
  drawDayNight(ctx, dn, ci.minuteOfDay, vw, vh); // a promptok a színezés fölé kerülnek
  drawInteractPrompts(ctx, interact, o.x, o.y, vw, vh, { debug: tc.hud, lang: currentLang() }); // promptok a tárgyak fölött, zónák a debug HUD-dal
}

function render() {
  const ctx = screen.ctx;
  const ci = clockInfo(clock);
  splitOffsets(split, offs);
  for (let i = 0; i < 2; i++) {
    const v = split.layout.views[i];
    renderView(beginView(splitRend, i), offs[i], v.w, v.h, ci);
  }
  composeSplit(ctx, splitRend, mergeBlend(split)); // a két nézet + (az összeolvadással halványuló) osztóvonal a fő vászonra; a HUD/számláló fölé kerül
  ctx.font = '12px monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#9fb4d0';
  ctx.fillText(`Interlinked ${VERSION} (${VERSION_DATE})  FPS ${game.fps.toFixed(0)}  chunk ${world.chunks.size}/${chunkRend.cache.size}  obj ${objectCount(objects)}  int ${interact.total}  warp ${warpWhere(warp, game.players) || '-'}  mrg ${mergeBlend(split).toFixed(2)}`, 8, 8);
  drawClockLabel(ctx, clockLabel(ci, currentLang(), clock.speed), VIRTUAL_W);
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

window.__game = { game, split, splitRend, input, screen, tether, tc, vis, world, atlas, chunkRend, objects, objSprites, interact, warp, clock, dn, field };
