// Tile-térkép: adat, lekérdezések, látható tartomány, ütköző tile-ok -> fal-lista (tiszta logika). S012.
import { TILE_SIZE, TILE_DEFS, T, isSolidId } from './world-tiles.js';

export function createTileMap(cols, rows, fill = T.GRASS) {
  const c = Math.max(1, Math.floor(cols) || 0), r = Math.max(1, Math.floor(rows) || 0);
  const tiles = new Uint8Array(c * r);
  tiles.fill(TILE_DEFS[fill] ? fill : T.GRASS);
  return { cols: c, rows: r, tiles };
}

export function inBounds(map, tx, ty) {
  return tx >= 0 && tx < map.cols && ty >= 0 && ty < map.rows;
}

// A térképen kívül -1.
export function getTile(map, tx, ty) {
  tx = Math.floor(tx); ty = Math.floor(ty);
  return inBounds(map, tx, ty) ? map.tiles[ty * map.cols + tx] : -1;
}

// Igaz, ha beállította (érvényes helyre, ismert azonosítóval).
export function setTile(map, tx, ty, id) {
  tx = Math.floor(tx); ty = Math.floor(ty);
  if (!inBounds(map, tx, ty) || !TILE_DEFS[id]) return false;
  map.tiles[ty * map.cols + tx] = id;
  return true;
}

// A térképen kívüli terület ütköző.
export function isSolidTile(map, tx, ty) {
  const id = getTile(map, tx, ty);
  return id < 0 ? true : isSolidId(id);
}

export function tileAtPixel(map, px, py) {
  return getTile(map, Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE));
}

export function solidAtPixel(map, px, py) {
  return isSolidTile(map, Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE));
}

// A kamera kivágásába eső tile-tartomány [x0,x1) x [y0,y1), a térképre vágva. Hibás bemenet -> üres.
export function visibleRange(map, ox, oy, viewW, viewH) {
  if (![ox, oy, viewW, viewH].every(Number.isFinite)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  const S = TILE_SIZE;
  const x0 = Math.max(0, Math.floor(ox / S)), y0 = Math.max(0, Math.floor(oy / S));
  const x1 = Math.min(map.cols, Math.ceil((ox + viewW) / S)), y1 = Math.min(map.rows, Math.ceil((oy + viewH) / S));
  return { x0, y0, x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
}

// Az ütköző tile-okból {x,y,w,h} fal-lista (px): sorok vízszintes szakaszai, az azonos x/szélességű,
// egymás alatti szakaszok összevonva. A térkép szélén nincs automatikus fal: a térkép kerete legyen ütköző.
export function mapToWalls(map, solid = isSolidId) {
  const S = TILE_SIZE, { cols, rows, tiles } = map;
  const out = [];
  let prev = new Map();
  for (let ty = 0; ty < rows; ty++) {
    const cur = new Map();
    let tx = 0;
    while (tx < cols) {
      if (!solid(tiles[ty * cols + tx])) { tx++; continue; }
      let x1 = tx;
      while (x1 < cols && solid(tiles[ty * cols + x1])) x1++;
      const key = tx + ':' + (x1 - tx);
      let r = prev.get(key);
      if (r) r.h += S;
      else { r = { x: tx * S, y: ty * S, w: (x1 - tx) * S, h: S }; out.push(r); }
      cur.set(key, r);
      tx = x1;
    }
    prev = cur;
  }
  return out;
}

// 4-szomszédos elérhetőség egy tile-ból: 1 = elérhető. Kezdő tile blokkolt/érvénytelen -> minden 0.
export function floodReach(map, tx, ty, blocked = isSolidId) {
  const { cols, rows, tiles } = map;
  const seen = new Uint8Array(cols * rows);
  tx = Math.floor(tx); ty = Math.floor(ty);
  if (!inBounds(map, tx, ty) || blocked(tiles[ty * cols + tx])) return seen;
  const stack = [ty * cols + tx];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop(), x = i % cols, y = (i / cols) | 0;
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of nb) {
      if (!inBounds(map, nx, ny)) continue;
      const j = ny * cols + nx;
      if (seen[j] || blocked(tiles[j])) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}
