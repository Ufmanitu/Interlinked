// test-world.js (S013): zaj, RNG, chunk-generálás tesztek.
import { test, assert, eq } from './test-index.js';
import { mulberry32, hashInt, lattice, valueNoise, fbm } from './world-noise.js';
import { CHUNK_SIZE, TERRAIN, terrainTile, chunkCoord, chunkKey, worldToChunk, chunkRng, generateChunk, normSeed } from './world-chunk.js';
import { TILE_COUNT } from './world-tiles.js';

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
