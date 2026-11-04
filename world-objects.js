// world-objects.js (S015) – tiszta logika: világ-objektumok (fa, kő placeholder), ütközők, y szerinti rajzolási sorrend.
// Az objektum pozíciója a LÁBPONT (x,y világ-pixel): a sprite és az ütköző ehhez van horgonyozva.
// A chunk-objektumok determinisztikusak (seed + chunk-koordináta), a chunk betöltésekor/eldobásakor szinkronizálódnak.
import { TILE_SIZE, T, isSolidId } from './world-tiles.js';
import { CHUNK_SIZE, TERRAIN, chunkRng, normSeed, terrainTile } from './world-chunk.js';

const def = (type, solid, collider, sprite, palette) =>
  Object.freeze({
    type, nameKey: 'obj.' + type, solid,
    collider: Object.freeze(collider),                 // {w,h}: a lábpont fölé nyúló talp-téglalap (középen)
    sprite: Object.freeze(sprite),                     // {w,h,ax,ay}: méret és a lábpont a spriteon belül
    palette: Object.freeze(palette),
  });

export const OBJECT_DEFS = Object.freeze({
  tree: def('tree', true, { w: 16, h: 10 }, { w: 48, h: 64, ax: 24, ay: 60 }, ['#5a3b22', '#74502d', '#2f6a30', '#3f8a3c', '#63b052']),
  stone: def('stone', true, { w: 24, h: 14 }, { w: 32, h: 24, ax: 16, ay: 22 }, ['#6b727c', '#8d95a0', '#4a5059', '#b4bcc6']),
});

export const OBJECT_CONFIG = {
  treeChance: 0.012,  // tile-onkénti esély a füves tile-okon
  stoneChance: 0.004,
  jitter: 6,          // a lábpont eltolása a tile közepétől (px, ±)
  salt: 0x0b7ec7,     // az RNG-sorozat elkülönítése a többi chunk-RNG-től
};

const MAX_SPRITE = 64; // a legnagyobb sprite-méret (kivágás-margó)

export function isObject(e) {
  return !!e && typeof e.type === 'string' && !!OBJECT_DEFS[e.type];
}

/** Objektum létrehozása a lábpontból; ismeretlen típus -> null. */
export function createObject(type, x, y, id = null) {
  if (!OBJECT_DEFS[type] || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { id, type, x, y };
}

/** Az objektum ütköző téglalapja ({x,y,w,h}, bal-felső sarok): a lábpont fölé nyúló talp. */
export function objectCollider(obj) {
  const d = OBJECT_DEFS[obj.type];
  if (!d) return null;
  return { x: obj.x - d.collider.w / 2, y: obj.y - d.collider.h, w: d.collider.w, h: d.collider.h };
}

/** A sprite téglalapja világ-pixelben (kivágáshoz). */
export function objectSpriteRect(obj) {
  const s = OBJECT_DEFS[obj.type].sprite;
  return { x: obj.x - s.ax, y: obj.y - s.ay, w: s.w, h: s.h };
}

/** Y-sort kulcs: a lábpont y-ja. Objektum: obj.y; játékos (középpont + méret): y + h/2. */
export function footY(e) {
  if (!e) return Infinity;
  const y = isObject(e) ? e.y : e.y + (e.h || 0) / 2;
  return Number.isFinite(y) ? y : Infinity;
}

function cmpDraw(a, b) {
  const fa = footY(a), fb = footY(b);
  if (fa !== fb) return fa < fb ? -1 : 1;
  if (a.x !== b.x) return a.x < b.x ? -1 : 1;
  const ia = String(a.id ?? a.index ?? ''), ib = String(b.id ?? b.index ?? '');
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/** Rajzolási sorrend: fentről lefelé (kisebb lábpont-y előbb), döntetlennél x, majd id szerint; helyben rendez. */
export function sortByY(list) {
  return list.sort(cmpDraw);
}

function inKeepFree(x, y, keepFree) {
  for (const k of keepFree) {
    if (k && Math.hypot(x - k.x, y - k.y) < k.r) return true;
  }
  return false;
}

/**
 * Egy chunk objektumai: determinisztikusak a (seed, cx, cy) párból. Csak fűre, 3x3 szabad (nem ütköző) környezettel,
 * a chunk szélétől 1 tile-lal beljebb (nincs chunk-határon átnyúló ütközés). opts: {cfg, keepFree:[{x,y,r}], terrain}.
 * Az RNG-fogyasztás tile-onként állandó, így a szűrők (keepFree, környezet) nem tolják el a többi objektumot.
 */
export function scatterChunkObjects(seed, cx, cy, opts = {}) {
  const cfg = { ...OBJECT_CONFIG, ...(opts.cfg || {}) };
  const keepFree = opts.keepFree || [];
  const terrain = opts.terrain || TERRAIN;
  const rng = chunkRng(normSeed(seed) ^ cfg.salt, cx, cy);
  const x0 = (cx | 0) * CHUNK_SIZE, y0 = (cy | 0) * CHUNK_SIZE;
  const out = [];
  const j = Math.max(0, cfg.jitter);
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const roll = rng(), jx = rng(), jy = rng();
      let type = null;
      if (roll < cfg.treeChance) type = 'tree';
      else if (roll < cfg.treeChance + cfg.stoneChance) type = 'stone';
      if (!type) continue;
      if (lx < 1 || ly < 1 || lx > CHUNK_SIZE - 2 || ly > CHUNK_SIZE - 2) continue;
      const wx = x0 + lx, wy = y0 + ly;
      if (terrainTile(seed, wx, wy, terrain) !== T.GRASS) continue;
      let clear = true;
      for (let dy = -1; dy <= 1 && clear; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (isSolidId(terrainTile(seed, wx + dx, wy + dy, terrain))) { clear = false; break; }
        }
      }
      if (!clear) continue;
      const x = (wx + 0.5) * TILE_SIZE + (jx * 2 - 1) * j;
      const y = (wy + 0.5) * TILE_SIZE + (jy * 2 - 1) * j;
      if (inKeepFree(x, y, keepFree)) continue;
      out.push(createObject(type, x, y, `${cx | 0},${cy | 0}:${ly * CHUNK_SIZE + lx}`));
    }
  }
  return out;
}

function collidersOf(list) {
  const w = [];
  for (const o of list) {
    if (OBJECT_DEFS[o.type].solid) w.push(objectCollider(o));
  }
  return w;
}

/** Objektum-tár: chunkonként a lista és az ütközők; a világ-streammel szinkronban tartva. */
export function createObjectStore(seed, opts = {}) {
  return {
    seed, opts,
    chunks: new Map(),  // chunk-kulcs -> {cx, cy, list, walls}
    version: 0,         // nő, ha a betöltött objektum-halmaz változik
  };
}

/** A tár igazítása a világ-stream betöltött chunkjaihoz. -> {added:[kulcs], dropped:[kulcs]} */
export function syncObjects(os, ws) {
  const added = [], dropped = [];
  for (const [k, ch] of ws.chunks) {
    if (os.chunks.has(k)) continue;
    const list = scatterChunkObjects(os.seed, ch.cx, ch.cy, os.opts);
    os.chunks.set(k, { cx: ch.cx, cy: ch.cy, list, walls: collidersOf(list) });
    added.push(k);
  }
  for (const k of [...os.chunks.keys()]) {
    if (!ws.chunks.has(k)) { os.chunks.delete(k); dropped.push(k); }
  }
  if (added.length || dropped.length) os.version++;
  return { added, dropped };
}

/** Az összes betöltött ütköző objektum téglalapja (világ-pixel). */
export function objectColliders(os) {
  const out = [];
  for (const e of os.chunks.values()) for (const w of e.walls) out.push(w);
  return out;
}

export function objectCount(os) {
  let n = 0;
  for (const e of os.chunks.values()) n += e.list.length;
  return n;
}

/** A (ox,oy) bal-felső sarkú, vw x vh nézettel átfedő sprite-ú objektumok (a tárolt objektumokra mutatnak). */
export function visibleObjects(os, ox, oy, vw, vh, out = []) {
  if (![ox, oy, vw, vh].every(Number.isFinite)) return out;
  const CP = CHUNK_SIZE * TILE_SIZE;
  for (const e of os.chunks.values()) {
    const cx0 = e.cx * CP, cy0 = e.cy * CP;
    if (cx0 > ox + vw + MAX_SPRITE || cx0 + CP < ox - MAX_SPRITE || cy0 > oy + vh + MAX_SPRITE || cy0 + CP < oy - MAX_SPRITE) continue;
    for (const o of e.list) {
      const r = objectSpriteRect(o);
      if (r.x < ox + vw && r.x + r.w > ox && r.y < oy + vh && r.y + r.h > oy) out.push(o);
    }
  }
  return out;
}
