// S012: tile-rendszer tesztek (DOM-független; a render-tesztek hamis canvas-szal futnak).
import { test, assert } from './test-index.js';
import { TILE_SIZE, TILE_DEFS, T, hash2, paintTile, tileVariant, isSolidId } from './world-tiles.js';
import {
  createTileMap, getTile, setTile, isSolidTile, solidAtPixel, tileAtPixel, visibleRange, mapToWalls, floodReach,
} from './world-tilemap.js';
import { buildArenaMap, stampWalls, arenaKeepFree, makeRng } from './world-arena.js';
import { createTileAtlas, atlasRect, drawTiles } from './render-tiles.js';
import { generateWalls, ARENA_TILES } from './game-walls.js';
import { createPlayer } from './game-player.js';
import { TETHER_CONFIG, createTetherSystem, stepTetherSystem } from './tether-system.js';
import { collides } from './game-collision.js';

const S = TILE_SIZE;
const SPAWN = [[400, 270], [540, 270]];
const arena = () => buildArenaMap(generateWalls(), ARENA_TILES.w, ARENA_TILES.h, { keepFree: arenaKeepFree(SPAWN) });
const count = (map, id) => { let n = 0; for (const t of map.tiles) if (t === id) n++; return n; };
const solidCount = map => { let n = 0; for (const t of map.tiles) if (isSolidId(t)) n++; return n; };

// Hány fal-téglalap fedi az egyes tile-okat (a tile közepe alapján).
function coverage(map, walls) {
  const cov = new Uint8Array(map.cols * map.rows);
  for (const w of walls) {
    for (let ty = w.y / S; ty < (w.y + w.h) / S; ty++) {
      for (let tx = w.x / S; tx < (w.x + w.w) / S; tx++) cov[ty * map.cols + tx]++;
    }
  }
  return cov;
}

function fakeCanvas(w, h) {
  const calls = [];
  const ctx = { fillStyle: '', imageSmoothingEnabled: true,
    fillRect(x, y, ww, hh) { calls.push({ t: 'fill', x, y, w: ww, h: hh, c: this.fillStyle }); },
    drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) { calls.push({ t: 'img', sx, sy, sw, sh, dx, dy, dw, dh }); } };
  return { width: w, height: h, calls, getContext: () => ctx };
}

test('tile: definíciók (sorrend, paletta, névkulcs, variánsok)', () => {
  assert(TILE_DEFS.length === 6, 'hat tile-típus');
  TILE_DEFS.forEach((d, i) => {
    assert(d.id === i, 'az id az indexszel egyezik: ' + d.key);
    assert(d.nameKey === 'tile.' + d.key, 'névkulcs: ' + d.key);
    assert(d.palette.length === 4 && d.palette.every(c => /^#[0-9a-f]{6}$/.test(c)), 'paletta: ' + d.key);
    assert(d.variants >= 1, 'variáns: ' + d.key);
  });
  assert(!isSolidId(T.GRASS) && !isSolidId(T.ROAD) && !isSolidId(T.SAND), 'fű, út, homok járható');
  assert(isSolidId(T.WATER) && isSolidId(T.STONE) && isSolidId(T.WALL), 'víz, kő, fal ütköző');
  assert(isSolidId(99) && isSolidId(-1), 'ismeretlen azonosító ütköző');
});

test('tile: paintTile (méret, indexhatár, determinizmus, nem tömör, variánsok eltérnek, rossz bemenet)', () => {
  for (const d of TILE_DEFS) {
    for (let v = 0; v < d.variants; v++) {
      const a = paintTile(d.id, v), b = paintTile(d.id, v);
      assert(a.length === S * S, 'méret: ' + d.key);
      assert(a.every((x, i) => x === b[i]), 'determinisztikus: ' + d.key);
      assert(a.every(x => x < d.palette.length), 'indexhatár: ' + d.key);
      assert(new Set(a).size >= 2, 'nem tömör szín: ' + d.key + v);
    }
  }
  const g0 = paintTile(T.GRASS, 0), g1 = paintTile(T.GRASS, 1);
  assert(g0.some((x, i) => x !== g1[i]), 'a fű variánsai eltérnek');
  assert(paintTile(99) === null && paintTile(-1) === null, 'ismeretlen id -> null');
  const nan = paintTile(T.GRASS, NaN), neg = paintTile(T.GRASS, -1), big = paintTile(T.GRASS, 7);
  assert(nan.length === S * S && neg.length === S * S && big.length === S * S, 'hibás variáns nem dob');
  assert(big.every((x, i) => x === paintTile(T.GRASS, 1)[i]), 'a variáns körbefordul (7 % 3 = 1)');
});

test('tile: tileVariant determinisztikus és tartományban van', () => {
  for (const d of TILE_DEFS) {
    for (let i = 0; i < 200; i++) {
      const v = tileVariant(i % 17, (i * 7) % 13, d.id);
      assert(v >= 0 && v < d.variants && v === tileVariant(i % 17, (i * 7) % 13, d.id), 'variáns: ' + d.key);
    }
  }
  assert(tileVariant(1, 1, 99) === 0, 'ismeretlen id -> 0');
  const seen = new Set();
  for (let i = 0; i < 64; i++) seen.add(tileVariant(i, i * 3, T.GRASS));
  assert(seen.size === 3, 'a fű mindhárom variánsa előfordul');
  assert(hash2(3, 4, 5) === hash2(3, 4, 5) && hash2(3, 4, 5) !== hash2(4, 3, 5), 'hash2 determinisztikus, nem szimmetrikus');
});

test('tilemap: alap (létrehozás, get/set, határok, ütközés, pixel-lekérdezés)', () => {
  const m = createTileMap(4, 3);
  assert(m.cols === 4 && m.rows === 3 && m.tiles.length === 12 && count(m, T.GRASS) === 12, 'méret és kitöltés');
  assert(setTile(m, 1, 1, T.WALL) && getTile(m, 1, 1) === T.WALL, 'beállítás');
  assert(!setTile(m, 4, 0, T.WALL) && !setTile(m, -1, 0, T.WALL) && !setTile(m, 0, 3, T.WALL), 'határon kívül nem állít');
  assert(!setTile(m, 0, 0, 99) && getTile(m, 0, 0) === T.GRASS, 'ismeretlen azonosítót nem fogad el');
  assert(getTile(m, -1, 0) === -1 && getTile(m, 0, 99) === -1 && getTile(m, NaN, 0) === -1, 'térképen kívül -1');
  assert(isSolidTile(m, 1, 1) && !isSolidTile(m, 0, 0), 'ütköző/járható');
  assert(isSolidTile(m, -1, 0) && isSolidTile(m, 9, 9), 'a térképen kívüli terület ütköző');
  assert(solidAtPixel(m, 1 * S + 5, 1 * S + 31) && !solidAtPixel(m, 1 * S - 1, 1 * S + 5), 'pixel -> tile (él)');
  assert(tileAtPixel(m, 1.9 * S, 1.1 * S) === T.WALL, 'tileAtPixel');
  assert(createTileMap(0, NaN).cols === 1 && createTileMap(2, 2, 99).tiles[0] === T.GRASS, 'hibás méret/kitöltés nem dob');
});

test('tilemap: visibleRange (kivágás, vágás a térképre, hibás bemenet)', () => {
  const m = createTileMap(10, 10);
  const r = visibleRange(m, 16, 16, 96, 64);
  assert(r.x0 === 0 && r.x1 === 4 && r.y0 === 0 && r.y1 === 3, 'tört eltolás: 4x3 tile');
  const r2 = visibleRange(m, -100, -100, 96, 64);
  assert(r2.x0 === 0 && r2.y0 === 0 && r2.x1 === 0 && r2.y1 === 0, 'a térkép bal-felett üres');
  const r3 = visibleRange(m, 9 * S, 9 * S, 960, 540);
  assert(r3.x0 === 9 && r3.x1 === 10 && r3.y0 === 9 && r3.y1 === 10, 'a térkép szélére vágva');
  const r4 = visibleRange(m, 9999, 0, 100, 100);
  assert(r4.x1 >= r4.x0 && r4.x1 - r4.x0 === 0, 'a térképen kívül üres');
  const r5 = visibleRange(m, NaN, 0, 960, 540);
  assert(r5.x1 === 0 && r5.y1 === 0, 'NaN -> üres');
  const full = visibleRange(m, 0, 0, 960, 540);
  assert(full.x1 === 10 && full.y1 === 10, 'teljes térkép');
});

test('tilemap: mapToWalls (ismert elrendezés, függőleges összevonás)', () => {
  const m = createTileMap(5, 3);
  for (let x = 0; x < 5; x++) { setTile(m, x, 0, T.WALL); setTile(m, x, 2, T.WALL); }
  setTile(m, 0, 1, T.WALL); setTile(m, 4, 1, T.WALL);
  const w = mapToWalls(m);
  const area = w.reduce((a, r) => a + r.w * r.h, 0);
  assert(area === 12 * S * S, 'a terület 12 tile');
  assert(w.length === 4, 'felső sor, két oszlop-darab, alsó sor: 4 téglalap, volt ' + w.length);
  const col = createTileMap(3, 4);
  for (let y = 0; y < 4; y++) setTile(col, 1, y, T.WALL);
  const cw = mapToWalls(col);
  assert(cw.length === 1 && cw[0].x === S && cw[0].y === 0 && cw[0].w === S && cw[0].h === 4 * S, 'egy oszlop = egy téglalap');
  assert(mapToWalls(createTileMap(3, 3)).length === 0, 'üres térkép nem ad falat');
  const water = createTileMap(2, 2, T.WATER);
  assert(mapToWalls(water).length === 1 && mapToWalls(water, id => id === T.WALL).length === 0, 'egyedi ütközés-függvény');
});

test('tilemap: mapToWalls fuzz (pontosan lefedi az ütköző tile-okat, nincs átfedés)', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = makeRng(seed), m = createTileMap(12, 9);
    for (let i = 0; i < m.tiles.length; i++) m.tiles[i] = Math.floor(rnd() * TILE_DEFS.length);
    const walls = mapToWalls(m), cov = coverage(m, walls);
    for (let i = 0; i < m.tiles.length; i++) {
      const want = isSolidId(m.tiles[i]) ? 1 : 0;
      assert(cov[i] === want, 'seed ' + seed + ', tile ' + i + ': lefedés ' + cov[i] + ', várt ' + want);
    }
  }
});

test('tilemap: floodReach (zárt terem, nyitott átjáró, blokkolt kezdőpont)', () => {
  const m = createTileMap(7, 5);
  for (let y = 0; y < 5; y++) setTile(m, 3, y, T.WALL);
  let r = floodReach(m, 0, 0);
  assert(r[0] === 1 && r[1 * 7 + 2] === 1 && r[3] === 0 && r[6] === 0, 'a fal elzárja a jobb oldalt');
  setTile(m, 3, 2, T.GRASS);
  r = floodReach(m, 0, 0);
  assert(r[6] === 1 && r[4 * 7 + 6] === 1, 'az átjárón át elérhető');
  assert(floodReach(m, 3, 0).every(x => x === 0), 'blokkolt kezdőpont -> üres');
  assert(floodReach(m, -1, 0).every(x => x === 0), 'érvénytelen kezdőpont -> üres');
});

test('aréna: a fal-tile-ok lefedik a game-walls.js falait, a kezdőhelyek szabadok', () => {
  const walls = generateWalls();
  const m = buildArenaMap(walls, ARENA_TILES.w, ARENA_TILES.h);
  assert(m.cols === ARENA_TILES.w && m.rows === ARENA_TILES.h, 'méret');
  for (const w of walls) {
    const pts = [[w.x + 1, w.y + 1], [w.x + w.w - 1, w.y + w.h - 1], [w.x + w.w / 2, w.y + w.h / 2]];
    for (const [px, py] of pts) assert(tileAtPixel(m, px, py) === T.WALL, 'fal-tile a (' + px + ',' + py + ') pontban');
  }
  const full = arena(), tw = mapToWalls(full);
  for (const [x, y] of SPAWN) {
    const p = createPlayer(0, x, y);
    assert(!collides(p, tw), 'a kezdőhely szabad: ' + x + ',' + y);
  }
});

test('aréna: dekoráció (tó, homok, kövek, út), determinisztikus', () => {
  const a = arena(), b = arena();
  assert(a.tiles.length === b.tiles.length && a.tiles.every((t, i) => t === b.tiles[i]), 'kétszer ugyanaz');
  assert(count(a, T.WATER) >= 8, 'van tó: ' + count(a, T.WATER));
  assert(count(a, T.SAND) >= 8, 'van homok');
  assert(count(a, T.STONE) >= 1, 'van kő');
  assert(count(a, T.ROAD) >= 10, 'van út');
  const sp = arenaKeepFree(SPAWN);
  for (let y = 0; y < a.rows; y++) {
    for (let x = 0; x < a.cols; x++) {
      const id = getTile(a, x, y);
      if (id === T.WATER || id === T.STONE) {
        assert(!sp.some(k => Math.abs(x - k.tx) <= k.r && Math.abs(y - k.ty) <= k.r), 'nincs akadály a kezdőhely körül');
      }
    }
  }
  const c = buildArenaMap(generateWalls(), ARENA_TILES.w, ARENA_TILES.h, { decor: { seed: 7 } });
  assert(count(c, T.STONE) >= 1, 'más maggal is van kő');
});

test('aréna: a dekoráció nem zár el semmilyen járatot', () => {
  const walls = generateWalls();
  const bare = buildArenaMap(walls, ARENA_TILES.w, ARENA_TILES.h, { decor: { stones: 0, pondW: 0, pondH: 0 } });
  const deco = arena();
  const tx = Math.floor(SPAWN[0][0] / S), ty = Math.floor(SPAWN[0][1] / S);
  const before = floodReach(bare, tx, ty, id => id === T.WALL);
  const after = floodReach(deco, tx, ty);
  let lost = 0, reach = 0;
  for (let i = 0; i < deco.tiles.length; i++) {
    if (before[i] && !isSolidId(deco.tiles[i])) { reach++; if (!after[i]) lost++; }
  }
  assert(reach > 100, 'a kezdőhelyről sok tile elérhető: ' + reach);
  assert(lost === 0, lost + ' tile elérhetetlenné vált a dekoráció miatt');
});

test('aréna: a víz és a kő ütköző a fal-listában, a fű/út/homok nem', () => {
  const m = arena(), walls = mapToWalls(m);
  let seen = { [T.WATER]: 0, [T.STONE]: 0, [T.GRASS]: 0, [T.ROAD]: 0, [T.SAND]: 0 };
  for (let y = 0; y < m.rows; y++) {
    for (let x = 0; x < m.cols; x++) {
      const id = getTile(m, x, y);
      if (!(id in seen)) continue;
      const hit = collides({ x: x * S + S / 2, y: y * S + S / 2, w: 10, h: 10 }, walls);
      assert(hit === (id === T.WATER || id === T.STONE), 'ütközés a ' + id + ' tile-on (' + x + ',' + y + ')');
      seen[id]++;
    }
  }
  assert(seen[T.WATER] > 0 && seen[T.STONE] > 0 && seen[T.GRASS] > 0 && seen[T.ROAD] > 0 && seen[T.SAND] > 0, 'minden típus előfordul');
  assert(walls.length < solidCount(m), 'az összevonás csökkenti a téglalapok számát');
});

test('aréna: stampWalls hibás fal-adatot kihagy', () => {
  const m = createTileMap(4, 4);
  stampWalls(m, [{ x: NaN, y: 0, w: 32, h: 32 }, { x: 0, y: 0, w: 0, h: 32 }, { x: 32, y: 32, w: 32, h: 32 }]);
  assert(count(m, T.WALL) === 1 && getTile(m, 1, 1) === T.WALL, 'csak az érvényes fal kerül be');
});

test('aréna: 600 kocka két szkriptelt játékossal a tile-falakon (nincs NaN, nincs átfedés)', () => {
  const map = arena(), walls = mapToWalls(map);
  const ps = SPAWN.map(([x, y], i) => createPlayer(i, x, y));
  const sys = createTetherSystem({ ...TETHER_CONFIG, walls });
  const dirs = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (let f = 0; f < 600; f++) {
    const inps = ps.map((_, i) => {
      const d = dirs[hash2(Math.floor(f / 45), i, 5) % dirs.length];
      return { x: d[0], y: d[1], interact: false, ability1: false, ability2: false, menu: false };
    });
    stepTetherSystem(sys, ps, inps, 1 / 60);
    for (const p of ps) {
      assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN pozíció a ' + f + '. kockán');
      assert(!collides(p, walls), 'fal-átfedés a ' + f + '. kockán');
    }
  }
});

test('render: atlasz (méret, minden tile teljesen és átfedés nélkül kifestve, pixelated)', () => {
  const atlas = createTileAtlas(fakeCanvas);
  const maxV = Math.max(...TILE_DEFS.map(d => d.variants));
  assert(atlas.canvas.width === maxV * S && atlas.canvas.height === TILE_DEFS.length * S, 'atlasz-méret');
  const calls = atlas.canvas.calls;
  assert(calls.every(c => c.x >= 0 && c.y >= 0 && c.x + c.w <= atlas.canvas.width && c.y + c.h <= atlas.canvas.height), 'minden festés az atlaszon belül');
  const area = calls.reduce((a, c) => a + c.w * c.h, 0);
  const want = TILE_DEFS.reduce((a, d) => a + d.variants * S * S, 0);
  assert(area === want, 'a festett terület pontosan a tile-ok területe: ' + area + ' / ' + want);
  assert(calls.every(c => /^#[0-9a-f]{6}$/.test(c.c)), 'érvényes színek');
  assert(atlas.canvas.getContext('2d').imageSmoothingEnabled === false, 'imageSmoothing kikapcsolva');
});

test('render: atlasRect és drawTiles (darabszám, célpont, vágás, sérült azonosító)', () => {
  const atlas = createTileAtlas(fakeCanvas);
  const r = atlasRect(atlas, T.WALL, 0);
  assert(r.sx === 0 && r.sy === T.WALL * S && r.sw === S && r.sh === S, 'atlasRect');
  assert(atlasRect(atlas, 99, 0) === null, 'ismeretlen -> null');
  assert(atlasRect(atlas, T.GRASS, 4).sx === 1 * S, 'a variáns körbefordul');
  const m = createTileMap(10, 10);
  const cv = fakeCanvas(960, 540), c = cv.getContext('2d');
  const n = drawTiles(c, atlas, m, 16, 16, 96, 64);
  const imgs = cv.calls.filter(x => x.t === 'img');
  assert(n === 12 && imgs.length === 12, '4x3 látható tile: ' + n);
  assert(imgs[0].dx === -16 && imgs[0].dy === -16 && imgs[0].dw === S, 'az első tile a kamera-eltoláshoz igazítva');
  assert(imgs.every(i => i.sx % S === 0 && i.sy % S === 0), 'forrás az atlasz rácsán');
  const cv2 = fakeCanvas(960, 540);
  assert(drawTiles(cv2.getContext('2d'), atlas, m, 5000, 5000, 960, 540) === 0 && cv2.calls.length === 0, 'a térképen kívül nem rajzol');
  const bad = createTileMap(2, 2);
  bad.tiles[3] = 200;
  const cv3 = fakeCanvas(960, 540);
  drawTiles(cv3.getContext('2d'), atlas, bad, 0, 0, 64, 64);
  assert(cv3.calls.filter(x => x.t === 'fill' && x.c === '#ff00ff').length === 1, 'sérült azonosító -> magenta placeholder');
});

test('render: a teljes aréna egy kamera-kivágása nem lépi túl a látható tile-ok számát', () => {
  const atlas = createTileAtlas(fakeCanvas), m = arena();
  const cv = fakeCanvas(960, 540);
  const n = drawTiles(cv.getContext('2d'), atlas, m, 300, 200, 960, 540);
  assert(n > 0 && n <= 31 * 18, 'legfeljebb 31x18 tile: ' + n);
  assert(cv.calls.every(c => c.t === 'img'), 'érvényes arénában nincs placeholder');
});
