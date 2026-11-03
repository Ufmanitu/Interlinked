// A greybox-aréna tile-térképe: a game-walls.js falaiból + determinisztikus dekoráció (út, tó, kövek). S012.
// Az S013 (chunk-adat, mulberry32) és az S020 (makrótérkép) után ezt a procedurális terep váltja fel.
import { TILE_SIZE, T } from './world-tiles.js';
import { createTileMap, getTile, setTile, isSolidTile } from './world-tilemap.js';

export const ARENA_DECOR = { roadRow: 8, roadCol: 14, pondW: 5, pondH: 4, stones: 24, seed: 12012 };

// Kis determinisztikus véletlen (LCG); a végleges generátor az S013 mulberry32-je.
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

// Pixel-pozíciókból "szabadon hagyandó" tile-körök (pl. a játékosok kezdőhelye).
export function arenaKeepFree(points, r = 3) {
  return points.map(([x, y]) => ({ tx: Math.floor(x / TILE_SIZE), ty: Math.floor(y / TILE_SIZE), r }));
}

function nearKeep(keep, tx, ty, margin = 0) {
  return keep.some(k => Math.abs(tx - k.tx) <= k.r + margin && Math.abs(ty - k.ty) <= k.r + margin);
}

// A fal-téglalapok által lefedett tile-ok (a tile közepe a téglalapban van) -> WALL.
export function stampWalls(map, walls) {
  const S = TILE_SIZE;
  for (const w of walls) {
    if (![w.x, w.y, w.w, w.h].every(Number.isFinite) || w.w <= 0 || w.h <= 0) continue;
    const tx1 = Math.ceil((w.x + w.w) / S), ty1 = Math.ceil((w.y + w.h) / S);
    for (let ty = Math.floor(w.y / S); ty < ty1; ty++) {
      for (let tx = Math.floor(w.x / S); tx < tx1; tx++) {
        const cx = tx * S + S / 2, cy = ty * S + S / 2;
        if (cx >= w.x && cx < w.x + w.w && cy >= w.y && cy < w.y + w.h) setTile(map, tx, ty, T.WALL);
      }
    }
  }
}

function paintRoads(map, d) {
  for (let tx = 0; tx < map.cols; tx++) if (getTile(map, tx, d.roadRow) === T.GRASS) setTile(map, tx, d.roadRow, T.ROAD);
  for (let ty = 0; ty < map.rows; ty++) if (getTile(map, d.roadCol, ty) === T.GRASS) setTile(map, d.roadCol, ty, T.ROAD);
}

function regionFree(map, keep, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) if (isSolidTile(map, x, y) || nearKeep(keep, x, y)) return false;
  }
  return true;
}

// Tó homokparttal: csak teljesen szabad (nem ütköző) területre, 1 tile széles szabad gyűrűvel,
// így nem zárhat el semmilyen járatot. A keresés a jobb-alsó sarok felől indul. Visszatér a régióval vagy null.
export function placePond(map, keep, pw, ph) {
  const rw = pw + 2, rh = ph + 2, cx = (rw - 1) / 2, cy = (rh - 1) / 2;
  for (let y0 = map.rows - rh; y0 >= 0; y0--) {
    for (let x0 = map.cols - rw; x0 >= 0; x0--) {
      if (!regionFree(map, keep, x0, y0, rw, rh)) continue;
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          let id = T.SAND;
          if (x >= 1 && x <= pw && y >= 1 && y <= ph) {
            const dx = (x - cx) / (pw / 2), dy = (y - cy) / (ph / 2);
            if (dx * dx + dy * dy <= 1) id = T.WATER;
          }
          setTile(map, x0 + x, y0 + y, id);
        }
      }
      return { x: x0, y: y0, w: rw, h: rh };
    }
  }
  return null;
}

// Egyedi kő-tile-ok fűre, csak ha a 5x5-ös környezetük teljesen szabad: a kő nem szűkíthet járatot 1 tile alá.
export function placeStones(map, keep, count, rnd) {
  let placed = 0;
  for (let n = 0; n < count * 40 && placed < count; n++) {
    const tx = 2 + Math.floor(rnd() * (map.cols - 4)), ty = 2 + Math.floor(rnd() * (map.rows - 4));
    if (getTile(map, tx, ty) !== T.GRASS || nearKeep(keep, tx, ty)) continue;
    let ok = true;
    for (let dy = -2; dy <= 2 && ok; dy++) {
      for (let dx = -2; dx <= 2; dx++) if ((dx || dy) && isSolidTile(map, tx + dx, ty + dy)) { ok = false; break; }
    }
    if (!ok) continue;
    setTile(map, tx, ty, T.STONE);
    placed++;
  }
  return placed;
}

// walls: a game-walls.js fal-listája; opts: { keepFree: [{tx,ty,r}], decor: {felülírások} }
export function buildArenaMap(walls, cols, rows, opts = {}) {
  const keep = opts.keepFree || [];
  const d = { ...ARENA_DECOR, ...(opts.decor || {}) };
  const map = createTileMap(cols, rows, T.GRASS);
  stampWalls(map, walls);
  paintRoads(map, d);
  placePond(map, keep, d.pondW, d.pondH);
  placeStones(map, keep, d.stones, makeRng(d.seed));
  return map;
}
