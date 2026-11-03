// Greybox aréna: kódból generált falak (tiszta logika, nincs DOM/canvas). Az S012-től tile-alapú adatból jönnek,
// ugyanebben a {x,y,w,h} (bal-felső sarok, px) formátumban.
import { TILE } from './core-screen.js';

export const ARENA_TILES = { w: 50, h: 30 };

// Fal tile-koordinátákból (tx,ty: bal-felső tile; tw,th: méret tile-ban).
export function wallRect(tx, ty, tw, th) {
  return { x: tx * TILE, y: ty * TILE, w: tw * TILE, h: th * TILE };
}

// 2x2-es oszlopok (tx, ty); a kezdőpozíciók (kb. tile 12,8 és 17,8) szabadon maradnak.
const PILLARS = [[8, 4], [18, 11], [34, 5], [44, 10], [10, 20], [20, 23], [36, 21]];

// Keret, függőleges és vízszintes válaszfalak 4 tile széles átjárókkal, 2x2 oszlopok.
export function generateWalls(cols = ARENA_TILES.w, rows = ARENA_TILES.h) {
  const walls = [
    wallRect(0, 0, cols, 1), wallRect(0, rows - 1, cols, 1),
    wallRect(0, 1, 1, rows - 2), wallRect(cols - 1, 1, 1, rows - 2),
  ];
  if (cols < 16 || rows < 12) return walls; // túl kicsi: csak a keret
  const mx = Math.floor(cols / 2), my = Math.floor(rows / 2);
  // függőleges válaszfal, átjáró: my-2 .. my+1
  walls.push(wallRect(mx, 1, 1, my - 3), wallRect(mx, my + 2, 1, rows - 1 - (my + 2)));
  // vízszintes válaszfal a bal felében (átjáró: tx 6..9) és a jobb felében (átjáró: cols-12 .. cols-9)
  walls.push(wallRect(1, my, 5, 1), wallRect(10, my, mx - 10, 1));
  walls.push(wallRect(mx + 1, my, cols - 12 - (mx + 1), 1), wallRect(cols - 8, my, 7, 1));
  for (const [tx, ty] of PILLARS) {
    if (tx + 2 <= cols - 1 && ty + 2 <= rows - 1) walls.push(wallRect(tx, ty, 2, 2));
  }
  return walls;
}
