// test-world.js (S013, S014): zaj, RNG, chunk-generálás, streaming, chunk-render tesztek.
import { test, assert, eq } from './test-index.js';
import { mulberry32, hashInt, lattice, valueNoise, fbm } from './world-noise.js';
import { CHUNK_SIZE, TERRAIN, terrainTile, chunkCoord, chunkKey, worldToChunk, chunkRng, generateChunk, normSeed } from './world-chunk.js';
import { TILE_COUNT } from './world-tiles.js';
import { TILE_SIZE, isSolidId, tileVariant } from './world-tiles.js';
import {
  WORLD_SEED, CHUNK_PX, pxToChunk, createWorldStream, wantedChunks, updateStream, warmStream,
  getChunk, getStreamTile, solidAtWorldPixel, streamWalls, findOpenSpot,
} from './world-stream.js';
import { createTileAtlas, atlasRect } from './render-tiles.js';
import { createChunkRenderer, buildChunkCanvas, drawChunks, pruneChunkCanvases } from './render-chunks.js';

const SEED = 12013;

test('mulberry32: determinisztikus, [0,1), seedenként más', () => {
  const a = mulberry32(5), b = mulberry32(5), c = mulberry32(6);
  let same = true, diff = false, sum = 0;
  for (let i = 0; i < 2000; i++) {
    const x = a(), y = b(), z = c();
    if (x !== y) same = false;
    if (x !== z) diff = true;
    assert(x >= 0 && x < 1, 'tartomány');
    sum += x;
  }
  assert(same, 'azonos seed azonos sorozat');
  assert(diff, 'más seed más sorozat');
  assert(Math.abs(sum / 2000 - 0.5) < 0.05, 'átlag ~0.5');
  const n = mulberry32(NaN);
  assert(Number.isFinite(n()), 'hibás seed nem dob');
});

test('hashInt/lattice: determinisztikus, tartomány, negatív koordináta', () => {
  eq(hashInt(3, -4, 9), hashInt(3, -4, 9));
  assert(hashInt(3, 4, 9) !== hashInt(4, 3, 9), 'x/y nem cserélhető');
  for (let i = -50; i < 50; i++) {
    const v = lattice(i, -i * 3, 7);
    assert(v >= 0 && v < 1, 'lattice tartomány');
  }
});

test('valueNoise: 0..1, rácspontban a rács-érték, folytonos, hibás -> 0', () => {
  for (let i = 0; i < 500; i++) {
    const x = (i * 0.37) - 90, y = (i * 0.91) - 200;
    const v = valueNoise(x, y, 3);
    assert(v >= 0 && v <= 1, 'tartomány');
    const w = valueNoise(x + 0.001, y, 3);
    assert(Math.abs(v - w) < 0.01, 'folytonos');
  }
  eq(valueNoise(4, 7, 2), lattice(4, 7, 2));
  eq(valueNoise(NaN, 1), 0);
  eq(valueNoise(1, Infinity), 0);
});

test('fbm: 0..1, determinisztikus, oktáv-szám szorítva', () => {
  for (let i = 0; i < 300; i++) {
    const v = fbm(i * 0.13, -i * 0.29, 5, 4);
    assert(v >= 0 && v <= 1);
  }
  eq(fbm(1.5, 2.5, 1, 4), fbm(1.5, 2.5, 1, 4));
  assert(Number.isFinite(fbm(1, 1, 1, 0)) && Number.isFinite(fbm(1, 1, 1, 99)));
});

test('chunk: méret, érvényes tile-id-k, térkép-kompatibilis alak', () => {
  const c = generateChunk(SEED, 0, 0);
  eq(c.cols, CHUNK_SIZE);
  eq(c.rows, CHUNK_SIZE);
  eq(c.tiles.length, CHUNK_SIZE * CHUNK_SIZE);
  for (const t of c.tiles) assert(t >= 0 && t < TILE_COUNT, 'id tartomány');
});

test('chunk: determinisztikus és sorrendfüggetlen', () => {
  const a1 = generateChunk(SEED, 2, -3), b1 = generateChunk(SEED, -1, 5);
  const b2 = generateChunk(SEED, -1, 5), a2 = generateChunk(SEED, 2, -3);
  eq(Array.from(a1.tiles).join(), Array.from(a2.tiles).join());
  eq(Array.from(b1.tiles).join(), Array.from(b2.tiles).join());
});

test('chunk: a világ-tile-lekérdezéssel egyezik (negatív koordinátákkal is)', () => {
  for (const [cx, cy] of [[0, 0], [-1, -1], [3, -2], [-5, 4]]) {
    const c = generateChunk(SEED, cx, cy);
    for (let i = 0; i < 200; i++) {
      const lx = (i * 7) % CHUNK_SIZE, ly = (i * 13) % CHUNK_SIZE;
      eq(c.tiles[ly * CHUNK_SIZE + lx], terrainTile(SEED, cx * CHUNK_SIZE + lx, cy * CHUNK_SIZE + ly));
    }
  }
});

test('chunk: varratmentes határ (a szomszéd első oszlopa/sora a világ-tile-lal egyezik)', () => {
  const a = generateChunk(SEED, 0, 0), b = generateChunk(SEED, 1, 0), d = generateChunk(SEED, 0, 1);
  for (let i = 0; i < CHUNK_SIZE; i++) {
    eq(b.tiles[i * CHUNK_SIZE], terrainTile(SEED, CHUNK_SIZE, i));
    eq(d.tiles[i], terrainTile(SEED, i, CHUNK_SIZE));
    eq(a.tiles[i * CHUNK_SIZE + CHUNK_SIZE - 1], terrainTile(SEED, CHUNK_SIZE - 1, i));
  }
});

test('terep: seedenként más, eloszlás ésszerű (fű, víz, homok, kő)', () => {
  const count = (seed) => {
    const n = new Array(8).fill(0);
    for (let cx = -3; cx < 3; cx++) for (let cy = -3; cy < 3; cy++)
      for (const t of generateChunk(seed, cx, cy).tiles) n[t]++;
    return n;
  };
  const a = count(SEED), b = count(SEED + 1);
  const total = a.reduce((s, v) => s + v, 0);
  assert(a.join() !== b.join(), 'más seed más terep');
  assert(a[0] / total > 0.3 && a[0] / total < 0.85, 'fű 30..85%');
  assert(a[1] > 0 && a[5] > 0 && a[2] > 0, 'víz, homok, kő is van');
  eq(a[3] + a[4], 0);
});

test('terep: a víz partján homok van (nincs víz-fű közvetlen szomszédság)', () => {
  const c = generateChunk(SEED, 0, 0), N = CHUNK_SIZE;
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    if (c.tiles[y * N + x] !== 1) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const t = c.tiles[(y + dy) * N + x + dx];
      assert(t !== 0 && t !== 2, 'víz mellett fű/kő');
    }
  }
});

test('koordináta-segédek: chunkCoord, worldToChunk, chunkKey, chunkRng, normSeed', () => {
  eq(chunkCoord(0), 0); eq(chunkCoord(63), 0); eq(chunkCoord(64), 1); eq(chunkCoord(-1), -1); eq(chunkCoord(-64), -1); eq(chunkCoord(-65), -2);
  const w = worldToChunk(-1, 130);
  eq(w.cx, -1); eq(w.cy, 2); eq(w.lx, 63); eq(w.ly, 2);
  eq(chunkKey(-2, 3), '-2,3');
  const r1 = chunkRng(SEED, 1, 2), r2 = chunkRng(SEED, 1, 2), r3 = chunkRng(SEED, 2, 1);
  eq(r1(), r2());
  assert(r1() !== r3() || r1() !== r3(), 'chunkenként más');
  eq(normSeed(NaN), 0);
  eq(normSeed(7.9), 7);
});

test('chunk-fuzz: sok véletlen chunk, nincs kivétel/érvénytelen id', () => {
  const rng = mulberry32(99);
  for (let i = 0; i < 40; i++) {
    const cx = Math.floor(rng() * 2000) - 1000, cy = Math.floor(rng() * 2000) - 1000;
    const c = generateChunk(Math.floor(rng() * 1e9), cx, cy);
    for (const t of c.tiles) assert(t >= 0 && t < TILE_COUNT);
  }
  assert(TERRAIN.water < TERRAIN.sand && TERRAIN.sand < TERRAIN.stone, 'küszöbök növekvők');
});

// ---- S014: chunk-streaming, falak, spawn, chunk-render (a render-tesztek stub-canvasszal) ----
const S14_FRAMES = 600;
const WSEED = WORLD_SEED;

function fakeCanvas(w, h) {
  const calls = [];
  const ctx = { imageSmoothingEnabled: true, fillStyle: '', drawImage: (...a) => calls.push(a), fillRect: (...a) => calls.push(['fill', ...a]) };
  return { width: w, height: h, calls, getContext: () => ctx };
}
function makeRend(opts) {
  const made = [];
  const mk = (w, h) => { const c = fakeCanvas(w, h); made.push(c); return c; };
  const rend = createChunkRenderer(createTileAtlas(mk), opts, mk);
  made.length = 0; // az atlasz canvasa nem számít
  return { rend, made };
}

test('stream: pxToChunk és wantedChunks (sugár, saját chunk elöl, negatív, hibás pont)', () => {
  eq(pxToChunk(0, 0).cx, 0);
  eq(pxToChunk(CHUNK_PX - 1, 0).cx, 0);
  eq(pxToChunk(CHUNK_PX, 0).cx, 1);
  eq(pxToChunk(-1, -1).cx, -1);
  const w = wantedChunks([{ x: 100, y: 100 }], 1);
  eq(w.length, 9);
  eq(w[0].cx, 0); eq(w[0].cy, 0);
  eq(wantedChunks([{ x: 100, y: 100 }], 0).length, 1);
  // két közeli pont: az átfedő chunkok egyszer szerepelnek
  eq(wantedChunks([{ x: 100, y: 100 }, { x: 300, y: 100 }], 1).length, 9);
  // két távoli pont: 2 x 9
  eq(wantedChunks([{ x: 100, y: 100 }, { x: 10 * CHUNK_PX, y: 0 }], 1).length, 18);
  eq(wantedChunks([{ x: NaN, y: 0 }, null, { x: 0, y: Infinity }], 1).length, 0);
  eq(wantedChunks([{ x: -5, y: -5 }], 1).length, 9);
});

test('stream: a saját chunk azonnal betöltődik, a többi budget szerint; warm mindent betölt', () => {
  const ws = createWorldStream(WSEED, { maxLoadPerUpdate: 2 });
  const p = [{ x: 100, y: 100 }];
  let r = updateStream(ws, p);
  assert(getChunk(ws, 0, 0), 'saját chunk betöltve');
  eq(r.loaded.length, 3, 'saját + 2 budget');
  r = updateStream(ws, p); eq(ws.chunks.size, 5);
  updateStream(ws, p); updateStream(ws, p);
  eq(ws.chunks.size, 9, 'végül mind a 3x3');
  assert(ws.version > 0, 'a betöltés növeli a verziót');
  const v = ws.version;
  r = updateStream(ws, p);
  eq(r.loaded.length + r.dropped.length, 0, 'nincs változás');
  eq(ws.version, v, 'a verzió csak változáskor nő');
  const ws2 = createWorldStream(WSEED);
  warmStream(ws2, p);
  eq(ws2.chunks.size, 9);
});

test('stream: eldobás az unloadRadiuson kívül, hiszterézis, mindkét játékos körül', () => {
  const ws = createWorldStream(WSEED, { loadRadius: 1, unloadRadius: 2 });
  warmStream(ws, [{ x: 100, y: 100 }]);
  // egy chunkkal arrébb: a régi 3x3 egy része még az unloadRadiuson belül van
  warmStream(ws, [{ x: CHUNK_PX + 100, y: 100 }]);
  assert(getChunk(ws, -1, 0), 'a -1 chunk még a hiszterézisen belül marad');
  assert(getChunk(ws, 2, 0), 'az új oldal betöltve');
  // két chunkkal arrébb: a -1 oszlop már kívül van
  const r = warmStream(ws, [{ x: 2 * CHUNK_PX + 100, y: 100 }]);
  assert(!getChunk(ws, -1, 0) && !getChunk(ws, 0, 0) === false, 'a 0 még bent, a -1 kint');
  assert(r.dropped.includes(chunkKey(-1, 0)), 'dropped lista');
  const vd = ws.version;
  warmStream(ws, [{ x: 9 * CHUNK_PX, y: 100 }]);
  assert(ws.version > vd, 'az eldobás növeli a verziót');
  // két játékos távol: mindkettő körül betöltve, a közbülső nem
  const ws2 = createWorldStream(WSEED);
  warmStream(ws2, [{ x: 100, y: 100 }, { x: 10 * CHUNK_PX, y: 100 }]);
  assert(getChunk(ws2, 0, 0) && getChunk(ws2, 10, 0), 'mindkét játékos chunkja');
  assert(!getChunk(ws2, 5, 0), 'a köztes nincs betöltve');
  // érvénytelen pontoknál nem dobunk el semmit
  const n = ws2.chunks.size;
  updateStream(ws2, [{ x: NaN, y: NaN }]);
  eq(ws2.chunks.size, n);
});

test('stream: getStreamTile a terrainTile-lal egyezik, nem betöltött -> -1, szilárd-lekérdezés', () => {
  const ws = createWorldStream(WSEED);
  warmStream(ws, [{ x: 50, y: 50 }]);
  for (let i = 0; i < 400; i++) {
    const wx = ((i * 37) % 120) - 60, wy = ((i * 61) % 120) - 60;
    eq(getStreamTile(ws, wx, wy), terrainTile(WSEED, wx, wy), `tile ${wx},${wy}`);
  }
  eq(getStreamTile(ws, 5 * CHUNK_SIZE, 0), -1);
  eq(getStreamTile(ws, NaN, 0), -1);
  assert(solidAtWorldPixel(ws, 5 * CHUNK_PX, 0), 'nem betöltött = ütköző');
  const wx = 3, wy = 4;
  eq(solidAtWorldPixel(ws, wx * TILE_SIZE + 1, wy * TILE_SIZE + 1), isSolidId(terrainTile(WSEED, wx, wy)));
});

test('stream: streamWalls = az ütköző tile-ok (chunk-határon át is), cache, eldobás után eltűnik', () => {
  const ws = createWorldStream(WSEED);
  warmStream(ws, [{ x: 20, y: 20 }]); // a (0,0) chunk sarka: 4 chunk találkozik
  const walls = streamWalls(ws);
  const inWall = (px, py) => walls.some(r => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h);
  let checked = 0;
  for (let wy = -60; wy < 60; wy++) {
    for (let wx = -60; wx < 60; wx++) {
      const solid = isSolidId(terrainTile(WSEED, wx, wy));
      const c = [wx * TILE_SIZE + 16, wy * TILE_SIZE + 16];
      eq(inWall(c[0], c[1]), solid, `fal-egyezés ${wx},${wy}`);
      checked++;
    }
  }
  eq(checked, 14400);
  assert(walls.length > 0, 'van fal');
  assert(walls.every(r => r.w > 0 && r.h > 0 && Number.isFinite(r.x + r.y)), 'érvényes téglalapok');
  const again = streamWalls(ws);
  eq(again.length, walls.length);
  warmStream(ws, [{ x: 20 * CHUNK_PX, y: 20 }]);
  assert(streamWalls(ws).every(r => r.x >= 19 * CHUNK_PX), 'az eldobott chunkok falai kikerültek');
});

test('stream: findOpenSpot nyitott, determinisztikus, a chunk-világban nincs fal a közelben', () => {
  const a = findOpenSpot(WSEED, 0, 0), b = findOpenSpot(WSEED, 0, 0);
  assert(a && b, 'talál');
  eq(a.x, b.x); eq(a.y, b.y);
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    assert(!isSolidId(terrainTile(WSEED, a.tx + dx, a.ty + dy)), 'a környezet szabad');
  }
  const ws = createWorldStream(WSEED);
  warmStream(ws, [a]);
  const walls = streamWalls(ws);
  const near = walls.filter(r => r.x < a.x + 120 && r.x + r.w > a.x - 120 && r.y < a.y + 120 && r.y + r.h > a.y - 120);
  eq(near.length, 0, 'a kezdőhely körül nincs fal');
  for (const s of [1, 7, 99, 12345]) assert(findOpenSpot(s, 0, 0), 'más seed-nél is talál: ' + s);
  eq(findOpenSpot(WSEED, 0, 0, 4, 0, { scale: 1, octaves: 1, water: -1, sand: -1, stone: 2 }) !== null, true, 'csupa fű: azonnal');
  eq(findOpenSpot(WSEED, 0, 0, 4, 2, { scale: 1, octaves: 1, water: -1, sand: -1, stone: -1 }), null, 'csupa kő: nincs találat');
});

test('render: buildChunkCanvas 64x64 tile-t rajzol egy 2048 px-es canvasra', () => {
  const { rend, made } = makeRend();
  const ws = createWorldStream(WSEED);
  warmStream(ws, [{ x: 50, y: 50 }]);
  const cv = buildChunkCanvas(rend, getChunk(ws, 0, 0));
  eq(cv.width, CHUNK_PX); eq(cv.height, CHUNK_PX);
  eq(cv.calls.length, CHUNK_SIZE * CHUNK_SIZE);
  assert(cv.getContext('2d').imageSmoothingEnabled === false, 'smoothing ki');
  assert(cv.calls.every(c => c[0] !== 'fill'), 'érvényes tile-ok');
  const ch = getChunk(ws, 0, 0);
  for (const i of [0, 77, 1000, 4095]) { // a variáns a világ-koordinátából jön, a forrás-téglalap egyezik
    const lx = i % CHUNK_SIZE, ly = (i / CHUNK_SIZE) | 0, id = ch.tiles[i];
    const want = atlasRect(rend.atlas, id, tileVariant(lx, ly, id));
    const got = cv.calls[i];
    eq(got[1], want.sx); eq(got[2], want.sy); eq(got[5], lx * TILE_SIZE); eq(got[6], ly * TILE_SIZE);
  }
  eq(made.length, 1);
});

test('render: drawChunks csak a látható chunkokat rajzolja, a sávok lefedik a nézetet', () => {
  const { rend, made } = makeRend({ maxBuildsPerFrame: 4 });
  const ws = createWorldStream(WSEED);
  warmStream(ws, [{ x: CHUNK_PX - 100, y: CHUNK_PX - 100 }]); // a 4 chunk találkozása
  const view = fakeCanvas(960, 540), ctx = view.getContext('2d');
  const ox = CHUNK_PX - 480, oy = CHUNK_PX - 270;
  const n = drawChunks(ctx, rend, ws, ox, oy, 960, 540);
  eq(n, 4, 'a nézet 4 chunkot ér');
  eq(view.calls.length, 4);
  eq(made.length, 4, 'chunkonként egy canvas');
  let area = 0;
  for (const c of view.calls) { // [img, sx, sy, sw, sh, dx, dy, dw, dh]
    eq(c[3], c[7]); eq(c[4], c[8]);
    assert(c[5] >= 0 && c[6] >= 0 && c[5] + c[7] <= 960 && c[6] + c[8] <= 540, 'a nézeten belülre rajzol');
    area += c[7] * c[8];
  }
  eq(area, 960 * 540, 'a négy sáv pontosan lefedi a nézetet');
  // egy chunkon belül: 1 blit
  const v2 = fakeCanvas(960, 540);
  eq(drawChunks(v2.getContext('2d'), rend, ws, 100, 100, 960, 540), 1);
  eq(v2.calls.length, 1);
  // nem betöltött terület: semmi
  const v3 = fakeCanvas(960, 540);
  eq(drawChunks(v3.getContext('2d'), rend, ws, 50 * CHUNK_PX, 0, 960, 540), 0);
  eq(v3.calls.length, 0);
  eq(drawChunks(v3.getContext('2d'), rend, ws, NaN, 0, 960, 540), 0, 'hibás nézet nem dob');
});

test('render: építés-budget (tartalék tile-rajz), cache-találat, LRU és eldobás utáni takarítás', () => {
  const { rend, made } = makeRend({ maxBuildsPerFrame: 1, maxCanvases: 2 });
  const ws = createWorldStream(WSEED);
  warmStream(ws, [{ x: CHUNK_PX - 100, y: CHUNK_PX - 100 }]);
  const view = fakeCanvas(960, 540), ctx = view.getContext('2d');
  const ox = CHUNK_PX - 480, oy = CHUNK_PX - 270;
  drawChunks(ctx, rend, ws, ox, oy, 960, 540);
  eq(made.length, 1, 'képkockánként 1 új canvas');
  assert(rend.stats.tiles > 0, 'a többi chunk tile-onként rajzolódott');
  const drawn = view.calls.length;
  assert(drawn > 4, 'a tartalék rajz is rajzol: ' + drawn);
  for (const c of view.calls) assert(c[5] > -TILE_SIZE && c[6] > -TILE_SIZE && c[5] < 960 && c[6] < 540, 'a nézeten belül');
  drawChunks(ctx, rend, ws, ox, oy, 960, 540);
  drawChunks(ctx, rend, ws, ox, oy, 960, 540);
  drawChunks(ctx, rend, ws, ox, oy, 960, 540);
  eq(made.length, 4, 'négy kocka alatt mind a 4 chunk megépült');
  assert(rend.cache.size <= 2, 'LRU: legfeljebb maxCanvases (' + rend.cache.size + ')');
  const built = rend.stats.built;
  // ugyanaz a nézet: a megmaradt canvasok újrahasznosítva (nincs fölösleges újraépítés kockánként > 1)
  drawChunks(ctx, rend, ws, ox, oy, 960, 540);
  assert(rend.stats.built - built <= 1, 'kockánként legfeljebb 1 újraépítés');
  // eldobott chunk canvasa törlődik
  const { rend: r2 } = makeRend({ maxBuildsPerFrame: 4, maxCanvases: 6 });
  drawChunks(ctx, r2, ws, 100, 100, 960, 540);
  eq(r2.cache.size, 1);
  warmStream(ws, [{ x: 30 * CHUNK_PX, y: 0 }]);
  pruneChunkCanvases(r2, ws);
  eq(r2.cache.size, 0, 'a streamből kikerült chunk canvasa törölve');
});

test('stream: hosszú séta két játékossal, a betöltött chunkok száma korlátos, nincs kivétel', () => {
  const ws = createWorldStream(WSEED);
  const { rend } = makeRend({ maxBuildsPerFrame: 1, maxCanvases: 6 });
  const view = fakeCanvas(960, 540).getContext('2d');
  const pts = [{ x: 100, y: 100 }, { x: 180, y: 100 }];
  let maxChunks = 0;
  for (let i = 0; i < 600; i++) {
    pts[0].x += 21; pts[1].x += 21; pts[0].y += 9; pts[1].y += 9; // ~12 chunk távolság
    updateStream(ws, pts);
    drawChunks(view, rend, ws, pts[0].x - 480, pts[0].y - 270, 960, 540);
    maxChunks = Math.max(maxChunks, ws.chunks.size);
    assert(getChunk(ws, pxToChunk(pts[0].x, pts[0].y).cx, pxToChunk(pts[0].x, pts[0].y).cy), 'a játékos chunkja mindig betöltve');
    assert(rend.cache.size <= 6, 'canvas-cache korlátos');
  }
  assert(maxChunks <= 2 * 25, 'korlátos memória: ' + maxChunks);
  assert(ws.stats.generated > 20 && ws.stats.dropped > 10, 'generált és eldobott chunkok');
});

// ---- S014: a teljes lánc a chunk-világon (streaming -> falak -> póráz), mint a main.js ----
test('smoke (S014): 600 kocka a chunk-világon, élő streaminggel és falfrissítéssel (nincs NaN, nincs fal-átfedés, táv. <= L_eff)', async () => {
  const { createPlayer } = await import('./game-player.js');
  const { createTetherSystem, stepTetherSystem } = await import('./tether-system.js');
  const { collides } = await import('./game-collision.js');
  const { WORLD_SEED, createWorldStream, warmStream, updateStream, streamWalls, findOpenSpot, getChunk, pxToChunk } = await import('./world-stream.js');
  const spot = findOpenSpot(WORLD_SEED, 0, 0);
  assert(spot, 'van kezdőhely');
  const P = [createPlayer(0, spot.x - 70, spot.y), createPlayer(1, spot.x + 70, spot.y)];
  const ws = createWorldStream(WORLD_SEED);
  warmStream(ws, P);
  const walls = streamWalls(ws);
  let ver = ws.version;
  const L = { x: 400, y: 260 };
  const sys = createTetherSystem({ walls, L, k: 0.5 });
  const inp = (f, p) => ({ x: Math.sin(f / (50 + 17 * p)) > -0.2 ? 1 : -1, y: Math.cos(f / (70 + 23 * p)) > 0 ? 1 : -1, interact: false, ability1: false, ability2: false, menu: false });
  let moved = 0, refreshes = 0;
  const start = [P[0].x, P[0].y];
  for (let f = 0; f < S14_FRAMES; f++) {
    updateStream(ws, P);
    if (ws.version !== ver) { ver = ws.version; walls.length = 0; for (const r of streamWalls(ws)) walls.push(r); refreshes++; }
    const prev = Math.abs(P[0].x - P[1].x);
    stepTetherSystem(sys, P, [inp(f, 0), inp(f, 1)], 1 / 60);
    for (const p of P) {
      assert(Number.isFinite(p.x) && Number.isFinite(p.y), `NaN pozíció a ${f}. kockában`);
      assert(!collides(p, walls), `fal-átfedés a ${f}. kockában`);
      const c = pxToChunk(p.x, p.y);
      assert(getChunk(ws, c.cx, c.cy), `a játékos chunkja nincs betöltve a ${f}. kockában`);
    }
    assert(Math.abs(P[0].x - P[1].x) <= Math.max(L.x, prev) + 1e-6, `táv. > L_eff a ${f}. kockában`);
  }
  moved = Math.hypot(P[0].x - start[0], P[0].y - start[1]);
  assert(moved > 100, 'a játékosok elmozdultak: ' + moved.toFixed(0));
  assert(ws.chunks.size <= 18, 'korlátos chunk-szám: ' + ws.chunks.size);
});
