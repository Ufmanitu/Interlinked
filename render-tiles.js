// Tile-rajzolás: kódból rajzolt atlasz + a kamera kivágásában lévő tile-ok kirajzolása. S012.
import { TILE_SIZE, TILE_DEFS, tileVariant, paintTile } from './world-tiles.js';
import { getTile, visibleRange } from './world-tilemap.js';

const MISSING = '#ff00ff'; // ismeretlen tile-azonosító (a sérült adat látszik, nem omlik össze)

function defaultCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Atlasz: soronként egy tile-típus, oszloponként egy variáns. makeCanvas(w,h) injektálható (tesztek).
export function createTileAtlas(makeCanvas = defaultCanvas) {
  const S = TILE_SIZE;
  const maxV = Math.max(...TILE_DEFS.map(d => d.variants));
  const canvas = makeCanvas(maxV * S, TILE_DEFS.length * S);
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.imageSmoothingEnabled = false;
  for (const d of TILE_DEFS) {
    for (let v = 0; v < d.variants; v++) {
      const px = paintTile(d.id, v);
      for (let y = 0; y < S; y++) {
        let x = 0;
        while (x < S) { // azonos színű vízszintes szakaszok egy fillRect-tel
          const idx = px[y * S + x];
          let x1 = x + 1;
          while (x1 < S && px[y * S + x1] === idx) x1++;
          ctx.fillStyle = d.palette[idx];
          ctx.fillRect(v * S + x, d.id * S + y, x1 - x, 1);
          x = x1;
        }
      }
    }
  }
  return { canvas, tile: S, variants: maxV };
}

// Egy tile forrás-téglalapja az atlaszban; ismeretlen azonosító -> null.
export function atlasRect(atlas, id, variant = 0) {
  const d = TILE_DEFS[id];
  if (!d) return null;
  const v = ((Math.floor(variant) % d.variants) + d.variants) % d.variants;
  return { sx: v * atlas.tile, sy: id * atlas.tile, sw: atlas.tile, sh: atlas.tile };
}

// A (ox, oy) bal-felső sarkú, viewW x viewH méretű kivágás tile-jai. Visszatér a kirajzolt tile-ok számával.
export function drawTiles(ctx, atlas, map, ox, oy, viewW, viewH) {
  const S = TILE_SIZE;
  const px = Math.round(ox), py = Math.round(oy);
  const r = visibleRange(map, px, py, viewW, viewH);
  let n = 0;
  for (let ty = r.y0; ty < r.y1; ty++) {
    for (let tx = r.x0; tx < r.x1; tx++) {
      const id = getTile(map, tx, ty);
      const src = atlasRect(atlas, id, tileVariant(tx, ty, id));
      if (src) ctx.drawImage(atlas.canvas, src.sx, src.sy, src.sw, src.sh, tx * S - px, ty * S - py, S, S);
      else { ctx.fillStyle = MISSING; ctx.fillRect(tx * S - px, ty * S - py, S, S); }
      n++;
    }
  }
  return n;
}
