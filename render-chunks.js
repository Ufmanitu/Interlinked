// render-chunks.js (S014) – chunk-render: chunkonként egy offscreen canvas (cache), csak a látható chunkok rajzolása.
import { TILE_SIZE, tileVariant } from './world-tiles.js';
import { CHUNK_SIZE, chunkKey } from './world-chunk.js';
import { atlasRect } from './render-tiles.js';

const CHUNK_PX = CHUNK_SIZE * TILE_SIZE;
const MISSING = '#ff00ff';

export const RENDER_CONFIG = {
  maxCanvases: 6,         // legfeljebb ennyi chunk-canvas él egyszerre (LRU); a nézet legfeljebb 4 chunkot ér
  maxBuildsPerFrame: 1,   // egy képkockában legfeljebb ennyi új canvas épül, a többi addig tile-onként rajzolódik
};

function defaultCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function createChunkRenderer(atlas, opts = {}, makeCanvas = defaultCanvas) {
  const cfg = { ...RENDER_CONFIG, ...opts };
  cfg.maxCanvases = Math.max(1, Math.floor(Number.isFinite(cfg.maxCanvases) ? cfg.maxCanvases : 6));
  cfg.maxBuildsPerFrame = Math.max(1, Math.floor(Number.isFinite(cfg.maxBuildsPerFrame) ? cfg.maxBuildsPerFrame : 1));
  return { atlas, cfg, makeCanvas, cache: new Map(), tick: 0, stats: { built: 0, evicted: 0, blits: 0, tiles: 0 } };
}

/** Egy chunk teljes rajza egy CHUNK_PX x CHUNK_PX canvasra (a tile-variáns a világ-koordinátából jön). */
export function buildChunkCanvas(rend, chunk) {
  const canvas = rend.makeCanvas(CHUNK_PX, CHUNK_PX);
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.imageSmoothingEnabled = false;
  const x0 = chunk.cx * CHUNK_SIZE, y0 = chunk.cy * CHUNK_SIZE, S = TILE_SIZE;
  for (let ly = 0; ly < chunk.rows; ly++) {
    for (let lx = 0; lx < chunk.cols; lx++) {
      const id = chunk.tiles[ly * chunk.cols + lx];
      const src = atlasRect(rend.atlas, id, tileVariant(x0 + lx, y0 + ly, id));
      if (src) ctx.drawImage(rend.atlas.canvas, src.sx, src.sy, src.sw, src.sh, lx * S, ly * S, S, S);
      else { ctx.fillStyle = MISSING; ctx.fillRect(lx * S, ly * S, S, S); }
    }
  }
  return canvas;
}

// Tartalék: a chunk látható tile-jainak közvetlen rajza (amíg a canvas nem készült el).
function drawChunkTiles(ctx, rend, chunk, px, py, viewW, viewH) {
  const S = TILE_SIZE, x0 = chunk.cx * CHUNK_SIZE, y0 = chunk.cy * CHUNK_SIZE;
  const lx0 = Math.max(0, Math.floor(px / S) - x0), lx1 = Math.min(chunk.cols, Math.ceil((px + viewW) / S) - x0);
  const ly0 = Math.max(0, Math.floor(py / S) - y0), ly1 = Math.min(chunk.rows, Math.ceil((py + viewH) / S) - y0);
  let n = 0;
  for (let ly = ly0; ly < ly1; ly++) {
    for (let lx = lx0; lx < lx1; lx++) {
      const id = chunk.tiles[ly * chunk.cols + lx];
      const src = atlasRect(rend.atlas, id, tileVariant(x0 + lx, y0 + ly, id));
      const dx = (x0 + lx) * S - px, dy = (y0 + ly) * S - py;
      if (src) ctx.drawImage(rend.atlas.canvas, src.sx, src.sy, src.sw, src.sh, dx, dy, S, S);
      else { ctx.fillStyle = MISSING; ctx.fillRect(dx, dy, S, S); }
      n++;
    }
  }
  return n;
}

/** A betöltött streamen kívüli (eldobott) és a LRU-határ feletti canvasok törlése. */
export function pruneChunkCanvases(rend, ws) {
  for (const k of [...rend.cache.keys()]) {
    if (!ws.chunks.has(k)) { rend.cache.delete(k); rend.stats.evicted++; }
  }
  while (rend.cache.size > rend.cfg.maxCanvases) {
    let oldK = null, oldT = Infinity;
    for (const [k, e] of rend.cache) if (e.used < oldT) { oldT = e.used; oldK = k; }
    rend.cache.delete(oldK);
    rend.stats.evicted++;
  }
}

/**
 * A (ox,oy) bal-felső sarkú, viewW x viewH nézet kirajzolása a betöltött chunkokból.
 * -> kirajzolt chunk-ok száma (nem betöltött chunk kimarad; a háttér-szín a hívóé).
 */
export function drawChunks(ctx, rend, ws, ox, oy, viewW, viewH) {
  if (![ox, oy, viewW, viewH].every(Number.isFinite)) return 0;
  const px = Math.round(ox), py = Math.round(oy);
  const cx0 = Math.floor(px / CHUNK_PX), cx1 = Math.floor((px + viewW - 1) / CHUNK_PX);
  const cy0 = Math.floor(py / CHUNK_PX), cy1 = Math.floor((py + viewH - 1) / CHUNK_PX);
  rend.tick++;
  let builds = 0, n = 0;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const k = chunkKey(cx, cy), chunk = ws.chunks.get(k);
      if (!chunk) continue;
      let e = rend.cache.get(k);
      if (!e && builds < rend.cfg.maxBuildsPerFrame) {
        e = { canvas: buildChunkCanvas(rend, chunk), used: rend.tick };
        rend.cache.set(k, e);
        rend.stats.built++;
        builds++;
      }
      if (e) {
        e.used = rend.tick;
        // a canvas megfelelő részletét másoljuk: csak a nézettel átfedő sáv
        const sx = Math.max(0, px - cx * CHUNK_PX), sy = Math.max(0, py - cy * CHUNK_PX);
        const ex = Math.min(CHUNK_PX, px + viewW - cx * CHUNK_PX), ey = Math.min(CHUNK_PX, py + viewH - cy * CHUNK_PX);
        if (ex > sx && ey > sy) {
          ctx.drawImage(e.canvas, sx, sy, ex - sx, ey - sy, cx * CHUNK_PX + sx - px, cy * CHUNK_PX + sy - py, ex - sx, ey - sy);
          rend.stats.blits++;
        }
      } else {
        rend.stats.tiles += drawChunkTiles(ctx, rend, chunk, px, py, viewW, viewH);
      }
      n++;
    }
  }
  pruneChunkCanvases(rend, ws);
  return n;
}
