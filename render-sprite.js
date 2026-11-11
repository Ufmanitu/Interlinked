// render-sprite.js (S021; S023-ban a STATE API-ja és a test-sprite.js alapján ÚJRAÍRVA, mert a repóból hiányzott)
// Sprite-rajzolás és gyorsítótár: az indexelt pixelekből canvas, LRU-cache. A hiányzó sprite helyett placeholder jön (soha nem dob).
import { SPRITE_NONE, colorCss, createSpriteRegistry, getSpriteData } from './world-sprite.js';
import { SPRITE_DEFS } from './data-sprites.js';

export const SPRITE_CACHE_CONFIG = { maxEntries: 256 };

function defaultCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/**
 * Indexelt pixelek rajza: vízszintes, azonos indexű szakaszok egy-egy fillRect-tel.
 * px: paletta-index | SPRITE_NONE; colors: css-színek indexenként; (ox,oy) eltolás. -> rajzolt szakaszok száma.
 */
export function paintIndexed(ctx, px, w, h, colors, ox = 0, oy = 0) {
  let runs = 0;
  if (!ctx || !px || !colors) return 0;
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const idx = px[y * w + x];
      let x1 = x + 1;
      while (x1 < w && px[y * w + x1] === idx) x1++;
      if (idx !== SPRITE_NONE && colors[idx] !== undefined) {
        ctx.fillStyle = colors[idx];
        ctx.fillRect(ox + x, oy + y, x1 - x, 1);
        runs++;
      }
      x = x1;
    }
  }
  return runs;
}

/** Egy sprite egyszeri rajza saját canvasra (imageSmoothing ki). 2D kontextus nélkül üres canvas jön. */
export function spriteToCanvas(sprite, makeCanvas = defaultCanvas) {
  const c = makeCanvas(sprite.w, sprite.h);
  const ctx = c && c.getContext ? c.getContext('2d') : null;
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    paintIndexed(ctx, sprite.px, sprite.w, sprite.h, sprite.palette.map(colorCss), 0, 0);
  }
  return c;
}

/** Gyorsítótár (LRU): kulcs = a getSpriteData kulcsa. reg lehet null (akkor minden kérés placeholder). */
export function createSpriteCache(reg, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  let max = Math.floor(Number(o.maxEntries));
  if (!(max >= 1)) max = SPRITE_CACHE_CONFIG.maxEntries;
  return {
    reg: reg || createSpriteRegistry(),
    cfg: { maxEntries: max },
    entries: new Map(),
    makeCanvas: typeof o.makeCanvas === 'function' ? o.makeCanvas : defaultCanvas,
    stats: { built: 0, hits: 0, evicted: 0, missing: 0 },
  };
}

/** Kész készlet: createSprites(defs = SPRITE_DEFS, {maxEntries, makeCanvas}). */
export function createSprites(defs = SPRITE_DEFS, opts = {}) {
  return createSpriteCache(createSpriteRegistry(defs), opts);
}

/** Lekérés: opts {variant, flipX, w, h} -> {canvas, ax, ay, w, h, missing}; ugyanarra a kérésre ugyanaz az elem. */
export function getSprite(cache, id, opts = {}) {
  const data = getSpriteData(cache.reg, id, opts);
  const hit = cache.entries.get(data.key);
  if (hit) {
    cache.entries.delete(data.key);
    cache.entries.set(data.key, hit); // frissítés: a legújabb
    cache.stats.hits++;
    return hit;
  }
  const s = data.sprite;
  const entry = { canvas: spriteToCanvas(s, cache.makeCanvas), ax: s.ax, ay: s.ay, w: s.w, h: s.h, missing: data.missing };
  cache.entries.set(data.key, entry);
  cache.stats.built++;
  if (data.missing) cache.stats.missing++;
  while (cache.entries.size > cache.cfg.maxEntries) {
    cache.entries.delete(cache.entries.keys().next().value); // a legrégebbi
    cache.stats.evicted++;
  }
  return entry;
}

/** Rajz: a lábpont (ax,ay) az (x,y)-ra kerül, egész pixelre kerekítve. -> igaz, ha valódi sprite volt (placeholder: hamis). */
export function drawSprite(ctx, cache, id, x, y, opts = {}) {
  const e = getSprite(cache, id, opts);
  if (ctx && typeof ctx.drawImage === 'function' && Number.isFinite(x) && Number.isFinite(y)) {
    ctx.drawImage(e.canvas, Math.round(x) - e.ax, Math.round(y) - e.ay);
  }
  return !e.missing;
}

export function clearSpriteCache(cache) {
  cache.entries.clear();
}
