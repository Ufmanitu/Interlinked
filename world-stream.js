// world-stream.js (S014) – tiszta logika: chunk-streaming mindkét játékos körül (betöltés, eldobás, falak, spawn-keresés).
import { TILE_SIZE, isSolidId } from './world-tiles.js';
import { mapToWalls } from './world-tilemap.js';
import { CHUNK_SIZE, TERRAIN, chunkCoord, chunkKey, generateChunk, terrainTile } from './world-chunk.js';

export const WORLD_SEED = 12014;
export const CHUNK_PX = CHUNK_SIZE * TILE_SIZE; // 2048 px

export const STREAM_CONFIG = {
  loadRadius: 1,      // chunk-sugár (Csebisev) a játékosok körül: 1 -> 3x3 chunk játékosonként
  unloadRadius: 2,    // ennél távolabbi chunk eldobódik (hiszterézis, nincs ki-be villogás a határon)
  maxLoadPerUpdate: 2, // egy frissítésben legfeljebb ennyi NEM sürgős chunk generálódik
};

function num(v, d) { return Number.isFinite(v) ? v : d; }

/** Pixel-pozíció -> chunk-koordináta {cx,cy}. */
export function pxToChunk(px, py) {
  return { cx: chunkCoord(Math.floor(px / TILE_SIZE)), cy: chunkCoord(Math.floor(py / TILE_SIZE)) };
}

export function createWorldStream(seed = WORLD_SEED, opts = {}) {
  const cfg = { ...STREAM_CONFIG, ...opts };
  cfg.loadRadius = Math.max(0, Math.floor(num(cfg.loadRadius, 1)));
  cfg.unloadRadius = Math.max(cfg.loadRadius + 1, Math.floor(num(cfg.unloadRadius, 2)));
  cfg.maxLoadPerUpdate = Math.max(1, Math.floor(num(cfg.maxLoadPerUpdate, 2)));
  return {
    seed, cfg, terrain: opts.terrain || TERRAIN,
    chunks: new Map(),     // key -> chunk
    walls: new Map(),      // key -> [{x,y,w,h}] világ-pixelben (lusta cache)
    version: 0,            // nő, ha a betöltött chunkok halmaza változik (a falak újraépítéséhez)
    stats: { generated: 0, dropped: 0 },
  };
}

/** A játékosok körüli kívánt chunkok, a legközelebbi elöl. points: [{x,y}] pixelben; hibás pont kimarad. */
export function wantedChunks(points, radius) {
  const seen = new Map();
  for (const p of points || []) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const c = pxToChunk(p.x, p.y);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = c.cx + dx, cy = c.cy + dy, k = chunkKey(cx, cy);
        const d = Math.max(Math.abs(dx), Math.abs(dy)) * 2 + (dx || dy ? 1 : 0); // a saját chunk elöl
        const prev = seen.get(k);
        if (!prev || d < prev.d) seen.set(k, { cx, cy, d });
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.d - b.d || a.cy - b.cy || a.cx - b.cx);
}

function loadChunk(ws, cx, cy) {
  const k = chunkKey(cx, cy);
  if (ws.chunks.has(k)) return false;
  ws.chunks.set(k, generateChunk(ws.seed, cx, cy, ws.terrain));
  ws.stats.generated++;
  return true;
}

/**
 * Streaming-lépés. A játékosok saját chunkja azonnal betöltődik (budget nélkül), a többi a budget szerint.
 * Az unloadRadiuson kívüli chunkok eldobódnak. -> {loaded:[kulcs], dropped:[kulcs]}
 */
export function updateStream(ws, points, { all = false } = {}) {
  const loaded = [], dropped = [];
  const want = wantedChunks(points, ws.cfg.loadRadius);
  let budget = ws.cfg.maxLoadPerUpdate;
  for (const c of want) {
    const urgent = c.d === 0;
    if (!urgent && !all && budget <= 0) continue;
    if (loadChunk(ws, c.cx, c.cy)) {
      loaded.push(chunkKey(c.cx, c.cy));
      if (!urgent) budget--;
    }
  }
  const keep = wantedChunks(points, ws.cfg.unloadRadius);
  if (keep.length) { // ha egy pont sem érvényes, nem dobunk el semmit
    const keepSet = new Set(keep.map(c => chunkKey(c.cx, c.cy)));
    for (const k of [...ws.chunks.keys()]) {
      if (!keepSet.has(k)) { ws.chunks.delete(k); ws.walls.delete(k); dropped.push(k); ws.stats.dropped++; }
    }
  }
  if (loaded.length || dropped.length) ws.version++;
  return { loaded, dropped };
}

/** Teljes betöltés budget nélkül (indításkor, teleportnál). */
export function warmStream(ws, points) {
  return updateStream(ws, points, { all: true });
}

export function getChunk(ws, cx, cy) {
  return ws.chunks.get(chunkKey(cx, cy)) || null;
}

/** Világ-tile azonosító (wx, wy tile-koordináta); nem betöltött chunk -> -1. */
export function getStreamTile(ws, wx, wy) {
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return -1;
  wx = Math.floor(wx); wy = Math.floor(wy);
  const cx = chunkCoord(wx), cy = chunkCoord(wy);
  const ch = ws.chunks.get(chunkKey(cx, cy));
  if (!ch) return -1;
  return ch.tiles[(wy - cy * CHUNK_SIZE) * CHUNK_SIZE + (wx - cx * CHUNK_SIZE)];
}

/** Ütköző-e a pixel-pont; nem betöltött terület ütköző (biztonságos oldal). */
export function solidAtWorldPixel(ws, px, py) {
  const id = getStreamTile(ws, px / TILE_SIZE, py / TILE_SIZE);
  return id < 0 ? true : isSolidId(id);
}

/** A betöltött chunkok ütköző fal-téglalapjai világ-pixelben ({x,y,w,h}); chunkonként cache-elve. */
export function streamWalls(ws, solid = isSolidId) {
  const out = [];
  for (const [k, ch] of ws.chunks) {
    let list = ws.walls.get(k);
    if (!list) {
      const ox = ch.cx * CHUNK_PX, oy = ch.cy * CHUNK_PX;
      list = mapToWalls(ch, solid).map(r => ({ x: r.x + ox, y: r.y + oy, w: r.w, h: r.h }));
      ws.walls.set(k, list);
    }
    for (const r of list) out.push(r);
  }
  return out;
}

/**
 * Nyitott hely keresése a (tx0,ty0) tile körül: spirálban az első tile, aminek (2*clear+1)^2 környezete nem ütköző.
 * -> {x,y,tx,ty} a tile közepe pixelben; nincs találat -> null. Chunk-független (a terep a világ-koordinátából jön).
 */
export function findOpenSpot(seed = WORLD_SEED, tx0 = 0, ty0 = 0, clear = 4, maxRing = 64, terrain = TERRAIN) {
  const free = (x, y) => !isSolidId(terrainTile(seed, x, y, terrain));
  const ok = (tx, ty) => {
    for (let y = ty - clear; y <= ty + clear; y++) for (let x = tx - clear; x <= tx + clear; x++) if (!free(x, y)) return false;
    return true;
  };
  for (let r = 0; r <= maxRing; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = tx0 + dx, ty = ty0 + dy;
        if (ok(tx, ty)) return { tx, ty, x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
      }
    }
  }
  return null;
}
