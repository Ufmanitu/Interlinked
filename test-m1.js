// S022: M1 playteszt (világ-alap) automata megfelelője. Checklist (6 pont):
// 1 chunk-átmenet (a játékos chunkja mindig betöltött, korlátos készlet)
// 2 varratmentes terep a chunk-határon
// 3 objektumok nem lógnak át chunk-határon
// 4 Y-sort sorrend
// 5 warp be-/kilépés (páros, nincs zseb-chunk)
// 6 FPS-költség: 600 kocka, nincs NaN, korlátos chunk-készlet
import { test, assert, eq } from './test-index.js';
import { WORLD_SEED, CHUNK_PX, createWorldStream, warmStream, updateStream, getChunk, streamWalls, findOpenSpot, pxToChunk } from './world-stream.js';
import { CHUNK_SIZE, generateChunk, terrainTile } from './world-chunk.js';
import { createObjectStore, syncObjects, objectColliders, objectCollider, createObject, sortByY, footY } from './world-objects.js';
import { createPlayer, PLAYER_SIZE } from './game-player.js';
import { TETHER_CONFIG, createTetherSystem, stepTetherSystem } from './tether-system.js';
import { createInteractSystem, addProvider, stepInteraction } from './game-interact.js';
import { WARP_LINKS, POCKET_TYPES } from './data-warps.js';
import { WARP_CONFIG, resolveLink, createWarpSystem, handleWarpEvent, warpProvider, warpWhere, pocketOf, streamPoints, stepWarp } from './world-warp.js';

const DT = 1 / 60;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const mkPlayer = (i, x, y) => { const p = createPlayer(i, x, y); if (!(p.h > 0)) p.h = PLAYER_SIZE; if (!(p.w > 0)) p.w = PLAYER_SIZE; return p; };

test('M1 chunk-átmenet: a játékos chunkja azonnal betöltött, a készlet korlátos', () => {
  const ws = createWorldStream(WORLD_SEED);
  for (let step = -2; step <= 8; step++) {
    const pts = [{ x: step * CHUNK_PX - 1, y: 40 }, { x: step * CHUNK_PX + 1, y: 40 }];
    for (let f = 0; f < 6; f++) {
      updateStream(ws, pts);
      for (const p of pts) {
        const c = pxToChunk(p.x, p.y);
        assert(getChunk(ws, c.cx, c.cy), `nincs betöltve: ${c.cx},${c.cy} (lépés ${step}, kocka ${f})`);
      }
      assert(ws.chunks.size <= 40, 'túl sok chunk: ' + ws.chunks.size);
    }
  }
});

test('M1 varrat: a chunk-határon a terep folytonos és determinisztikus', () => {
  for (const [cx, cy] of [[0, 0], [-1, 0], [0, -1], [3, 2]]) {
    const a = generateChunk(WORLD_SEED, cx, cy);
    const b = generateChunk(WORLD_SEED, cx, cy);
    eq(a.tiles.length, CHUNK_SIZE * CHUNK_SIZE, 'méret');
    for (let i = 0; i < a.tiles.length; i++) if (a.tiles[i] !== b.tiles[i]) throw new Error('nem determinisztikus: ' + cx + ',' + cy);
    for (let l = 0; l < CHUNK_SIZE; l++) {
      const wy = cy * CHUNK_SIZE + l;
      eq(a.tiles[l * CHUNK_SIZE + (CHUNK_SIZE - 1)], terrainTile(WORLD_SEED, cx * CHUNK_SIZE + CHUNK_SIZE - 1, wy), 'jobb szél ' + cx + ',' + cy);
      eq(a.tiles[l * CHUNK_SIZE], terrainTile(WORLD_SEED, cx * CHUNK_SIZE, wy), 'bal szél ' + cx + ',' + cy);
      const wx = cx * CHUNK_SIZE + l;
      eq(a.tiles[(CHUNK_SIZE - 1) * CHUNK_SIZE + l], terrainTile(WORLD_SEED, wx, cy * CHUNK_SIZE + CHUNK_SIZE - 1), 'alsó szél ' + cx + ',' + cy);
    }
  }
});

test('M1 objektumok: az ütközők nem lógnak át a chunk-határon', () => {
  const spot = findOpenSpot(WORLD_SEED, 0, 0);
  assert(spot, 'nincs kezdőhely');
  const ws = createWorldStream(WORLD_SEED);
  warmStream(ws, [spot]);
  const os = createObjectStore(WORLD_SEED, { keepFree: [{ x: spot.x, y: spot.y, r: 224 }] });
  syncObjects(os, ws);
  let n = 0;
  for (const ch of os.chunks.values()) {
    for (const o of ch.list) {
      const c = objectCollider(o);
      assert(c.x >= ch.cx * CHUNK_PX && c.x + c.w <= (ch.cx + 1) * CHUNK_PX, 'x átlóg: ' + o.id);
      assert(c.y >= ch.cy * CHUNK_PX && c.y + c.h <= (ch.cy + 1) * CHUNK_PX, 'y átlóg: ' + o.id);
      n++;
    }
  }
  assert(n > 0, 'nincs objektum');
  assert(objectColliders(os).length >= n, 'hiányzó ütközők');
});

test('M1 Y-sort: a lejjebb lévő lábpont takar (játékos és objektum vegyesen)', () => {
  const p = mkPlayer(0, 100, 200);
  const tree = createObject('tree', 100, 100, 't1');
  const stone = createObject('stone', 100, 300, 's1');
  const list = [stone, p, tree];
  sortByY(list);
  assert(list[0] === tree && list[1] === p && list[2] === stone, 'rossz sorrend');
  const spot = findOpenSpot(WORLD_SEED, 0, 0);
  const ws = createWorldStream(WORLD_SEED);
  warmStream(ws, [spot]);
  const os = createObjectStore(WORLD_SEED, { keepFree: [{ x: spot.x, y: spot.y, r: 224 }] });
  syncObjects(os, ws);
  const all = [];
  for (const ch of os.chunks.values()) for (const o of ch.list) all.push(o);
  all.push(mkPlayer(0, spot.x - 70, spot.y), mkPlayer(1, spot.x + 70, spot.y));
  sortByY(all);
  for (let i = 1; i < all.length; i++) assert(footY(all[i - 1]) <= footY(all[i]), 'nem növekvő footY: ' + i);
});

function scanWarp(warp, region, step) {
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const [dx, dy] of dirs) {
    for (let y = region.y; y <= region.y + region.h; y += step) {
      for (let x = region.x; x <= region.x + region.w; x += step) {
        const sys = createInteractSystem();
        addProvider(sys, warpProvider(warp));
        const pr = [mkPlayer(0, x, y), mkPlayer(1, x, y)];
        const idle = [{ x: dx, y: dy }, { x: 0, y: 0 }];
        stepInteraction(sys, pr, idle, DT);
        stepInteraction(sys, pr, idle, DT);
        const evs = stepInteraction(sys, pr, [{ x: dx, y: dy, interact: true, interactPressed: true }, { x: 0, y: 0 }], DT) || [];
        const ev = evs.find(e => e && e.kind === 'warp' && e.player === 0);
        if (ev) return ev;
      }
    }
  }
  return null;
}

test('M1 warp: páros belépés és kilépés, a zseb nem kerül a chunk-streamingbe', () => {
  const spot = findOpenSpot(WORLD_SEED, 0, 0);
  assert(spot, 'nincs kezdőhely');
  const warp = createWarpSystem({ anchor: spot });
  const link = WARP_LINKS[0];
  assert(link && !warp.rejected.includes(link.id), 'nincs érvényes link');
  const ps = [mkPlayer(0, spot.x - 70, spot.y), mkPlayer(1, spot.x + 70, spot.y)];
  const enterEv = scanWarp(warp, { x: spot.x - 150, y: spot.y - 150, w: 300, h: 300 }, 8);
  assert(enterEv, 'nem található a belépő interakció');
  const r1 = handleWarpEvent(warp, ps, enterEv);
  assert(r1 && r1.type === 'enter', 'nincs belépés');
  eq(warpWhere(warp, ps), link.id, 'mindketten a zsebben');
  assert(pocketOf(warp, ps[0].x, ps[0].y) && pocketOf(warp, ps[1].x, ps[1].y), 'a játékosok a zsebben');
  const out = [];
  const sp = streamPoints(warp, ps, out) || out;
  assert(sp.length > 0, 'nincs streaming pont');
  for (const q of sp) assert(Math.abs(q.x - spot.x) < 600 && Math.abs(q.y - spot.y) < 600, 'a zseb a streamingben');
  const ws = createWorldStream(WORLD_SEED);
  updateStream(ws, sp);
  for (const ch of ws.chunks.values()) assert(Math.abs(ch.cx) < 100 && Math.abs(ch.cy) < 100, 'zseb-chunk');
  stepWarp(warp, 1);
  const res = resolveLink(link, spot, POCKET_TYPES, WARP_CONFIG);
  assert(res && res.bounds && Number.isFinite(res.bounds.x), 'nincs zseb-határ');
  const exitEv = scanWarp(warp, res.bounds, 8);
  assert(exitEv, 'nem található a kilépő interakció');
  const r2 = handleWarpEvent(warp, ps, exitEv);
  assert(r2 && r2.type === 'exit', 'nincs kilépés');
  assert(!warpWhere(warp, ps), 'kint kell lenniük');
  for (const p of ps) assert(Math.abs(p.x - spot.x) < 600 && Math.abs(p.y - spot.y) < 600, 'nem a ház előtt érkeztek');
});

test('M1 FPS-költség: 600 kocka main-szerű lánccal, korlátos chunk-készlet, nincs NaN', () => {
  const spot = findOpenSpot(WORLD_SEED, 0, 0);
  assert(spot, 'nincs kezdőhely');
  const ws = createWorldStream(WORLD_SEED);
  warmStream(ws, [spot]);
  const os = createObjectStore(WORLD_SEED, { keepFree: [{ x: spot.x, y: spot.y, r: 224 }] });
  const walls = [];
  let key = '';
  const ps = [mkPlayer(0, spot.x - 70, spot.y), mkPlayer(1, spot.x + 70, spot.y)];
  const sys = createTetherSystem(Object.assign({}, TETHER_CONFIG, { walls }));
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let maxChunks = 0;
  const t0 = now();
  for (let f = 0; f < 600; f++) {
    updateStream(ws, ps.map(p => ({ x: p.x, y: p.y })));
    syncObjects(os, ws);
    const k = ws.version + '|' + os.version;
    if (k !== key) {
      key = k;
      walls.length = 0;
      for (const w of streamWalls(ws)) walls.push(w);
      for (const w of objectColliders(os)) walls.push(w);
    }
    const v = dirs[Math.floor(f / 120) % 4];
    stepTetherSystem(sys, ps, [{ x: v[0], y: v[1] }, { x: v[0], y: v[1] }], DT);
    for (const p of ps) {
      assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN pozíció a ' + f + '. kockán');
      const c = pxToChunk(p.x, p.y);
      assert(getChunk(ws, c.cx, c.cy), 'a játékos chunkja nincs betöltve a ' + f + '. kockán');
    }
    if (ws.chunks.size > maxChunks) maxChunks = ws.chunks.size;
  }
  const mean = (now() - t0) / 600;
  assert(maxChunks <= 30, 'túl sok chunk: ' + maxChunks);
  assert(mean < 12, 'a logika kockánként túl lassú: ' + mean.toFixed(2) + ' ms');
});
