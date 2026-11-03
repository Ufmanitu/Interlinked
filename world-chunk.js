// world-chunk.js (S013) – tiszta logika: 64x64-es chunk, determinisztikus terep a (seed, chunk-koordináta) párból.
import { T } from './world-tiles.js';
import { mulberry32, hashInt, fbm } from './world-noise.js';

export const CHUNK_SIZE = 64;
export const TERRAIN = {
  scale: 1 / 40,     // zaj-frekvencia (tile-onként)
  octaves: 4,
  water: 0.38,       // magasság < water -> víz
  sand: 0.42,        // < sand -> homok (a víz partja)
  stone: 0.68,       // > stone -> kő
};

/** Kanonikus egész seed. */
export function normSeed(seed) {
  return Number.isFinite(seed) ? seed | 0 : 0;
}

/** Egy tile terep-típusa a világ-koordinátából (a chunk-határtól független -> varratmentes). */
export function terrainTile(seed, wx, wy, cfg = TERRAIN) {
  const s = hashInt(normSeed(seed), 0x7e44, 1) | 0;
  const h = fbm(wx * cfg.scale, wy * cfg.scale, s, cfg.octaves);
  if (h < cfg.water) return T.WATER;
  if (h < cfg.sand) return T.SAND;
  if (h > cfg.stone) return T.STONE;
  return T.GRASS;
}

export function chunkCoord(t) {
  return Math.floor(t / CHUNK_SIZE);
}

export function chunkKey(cx, cy) {
  return cx + ',' + cy;
}

/** Világ-tile -> {cx,cy,lx,ly}. */
export function worldToChunk(wx, wy) {
  const cx = chunkCoord(wx), cy = chunkCoord(wy);
  return { cx, cy, lx: wx - cx * CHUNK_SIZE, ly: wy - cy * CHUNK_SIZE };
}

/** Chunk-hoz kötött RNG a későbbi mikroréteghez (fa, kő, spawn): mulberry32, chunk-koordinátából. */
export function chunkRng(seed, cx, cy) {
  return mulberry32(hashInt(cx | 0, cy | 0, normSeed(seed) ^ 0x51ed270b));
}

/** Chunk generálása; a térkép-kompatibilis alak ({cols,rows,tiles}) a world-tilemap/render-tiles függvényekkel használható. */
export function generateChunk(seed, cx, cy, cfg = TERRAIN) {
  const x0 = (cx | 0) * CHUNK_SIZE, y0 = (cy | 0) * CHUNK_SIZE;
  const tiles = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      tiles[y * CHUNK_SIZE + x] = terrainTile(seed, x0 + x, y0 + y, cfg);
    }
  }
  return { cx: cx | 0, cy: cy | 0, cols: CHUNK_SIZE, rows: CHUNK_SIZE, tiles };
}
