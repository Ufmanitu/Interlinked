// render-objects.js (S015): kódból rajzolt placeholder-spriteok (fa, kő; S037: gyógynövény) és az y szerint rendezett rajzolás.
// Az S021 pixel-DSL és az S103 valódi art ide köt: a createObjectSprites cseréje, a rajzolási sorrend marad.
import { OBJECT_DEFS, isObject, sortByY, visibleObjects } from './world-objects.js';
import { gatherView } from './game-nodes.js';

const MISSING = '#ff00ff'; // hiányzó sprite (a sérült adat látszik)

function defaultCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Kitöltött ellipszis soronként (pixeles, nincs élsimítás).
function blob(ctx, cx, cy, rx, ry, color) {
  ctx.fillStyle = color;
  for (let dy = -ry; dy <= ry; dy++) {
    const w = Math.floor(rx * Math.sqrt(1 - (dy * dy) / (ry * ry + 0.0001)));
    if (w > 0) ctx.fillRect(cx - w, cy + dy, w * 2, 1);
  }
}

const PAINT = {
  tree(ctx, d) { // 48x64, lábpont (24,60)
    const [trunk, trunkLight, leafDark, leaf, leafLight] = d.palette;
    blob(ctx, 24, 58, 13, 4, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = trunk; ctx.fillRect(21, 38, 6, 22);
    ctx.fillStyle = trunkLight; ctx.fillRect(21, 38, 2, 22);
    blob(ctx, 24, 28, 20, 20, leafDark);
    blob(ctx, 23, 26, 17, 17, leaf);
    blob(ctx, 19, 20, 8, 7, leafLight);
  },
  stone(ctx, d) { // 32x24, lábpont (16,22)
    const [base, light, dark, hi] = d.palette;
    blob(ctx, 16, 21, 13, 3, 'rgba(0,0,0,0.25)');
    blob(ctx, 16, 14, 13, 8, dark);
    blob(ctx, 16, 13, 12, 7, base);
    blob(ctx, 12, 10, 6, 3, light);
    blob(ctx, 10, 9, 2, 1, hi);
  },
  herb(ctx, d) { // S037: 24x24, lábpont (12,20) – kis lombcsokor sárga virággal
    const [dark, mid, light, flower] = d.palette;
    blob(ctx, 12, 19, 8, 2, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = dark; ctx.fillRect(7, 11, 3, 8); ctx.fillRect(12, 8, 3, 11); ctx.fillRect(16, 12, 3, 7);
    ctx.fillStyle = mid; ctx.fillRect(8, 10, 2, 8); ctx.fillRect(13, 7, 2, 11); ctx.fillRect(17, 11, 2, 7);
    blob(ctx, 8, 10, 3, 2, light); blob(ctx, 14, 7, 3, 2, light); blob(ctx, 18, 11, 3, 2, light);
    ctx.fillStyle = flower; ctx.fillRect(13, 4, 3, 3); ctx.fillRect(7, 7, 2, 2); ctx.fillRect(17, 8, 2, 2);
  },
};

/** Sprite-készlet: típusonként egy canvas. makeCanvas(w,h) injektálható (tesztek). */
export function createObjectSprites(makeCanvas = defaultCanvas) {
  const sprites = new Map();
  for (const d of Object.values(OBJECT_DEFS)) {
    const canvas = makeCanvas(d.sprite.w, d.sprite.h);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      if (PAINT[d.type]) PAINT[d.type](ctx, d);
      else { ctx.fillStyle = MISSING; ctx.fillRect(0, 0, d.sprite.w, d.sprite.h); }
    }
    sprites.set(d.type, { canvas, ax: d.sprite.ax, ay: d.sprite.ay });
  }
  return { sprites };
}

/**
 * Objektumok és játékosok y szerint rendezett kirajzolása (a lábpont szerint: lejjebb lévő takar).
 * drawPlayer(ctx, p, ox, oy): a játékos rajzolója. -> {objects, players} a kirajzoltak száma.
 */
export function drawYSorted(ctx, rend, os, players, ox, oy, viewW, viewH, drawPlayer) {
  const px = Math.round(ox), py = Math.round(oy);
  const list = visibleObjects(os, px, py, viewW, viewH);
  for (const p of players) list.push(p);
  sortByY(list);
  let objects = 0, nPl = 0;
  for (const e of list) {
    if (isObject(e)) {
      const s = rend.sprites.get(e.type);
      const x = Math.round(e.x) - px, y = Math.round(e.y) - py;
      if (s) ctx.drawImage(s.canvas, x - s.ax, y - s.ay);
      else { ctx.fillStyle = MISSING; ctx.fillRect(x - 8, y - 16, 16, 16); }
      objects++;
    } else {
      drawPlayer(ctx, e, px, py);
      nPl++;
    }
  }
  return { objects, players: nPl };
}

// S037: gyűjtés-sáv a célpont lába alatt (a prompt a tetején van): a kitermelés felé haladás, játékosonként egy sor; tele inventorynál borostyán.
export const NODE_BAR = { w: 28, h: 4, gap: 4, colors: ['#4d8cff', '#ff5d5d'], full: '#ffb45a', back: 'rgba(8,12,20,0.75)' };

/** A gyűjtés-sávok rajza a nézetbe (ox,oy = a nézet bal-felső sarka). -> a kirajzolt sávok száma. */
export function drawNodeBars(ctx, ns, ox, oy, viewW, viewH, cfg = NODE_BAR) {
  let n = 0;
  for (let i = 0; i < 2; i++) {
    const g = gatherView(ns, i);
    if (!g || !(g.ratio > 0)) continue;
    const x = Math.round(g.ref.x) - Math.round(ox) - cfg.w / 2, y = Math.round(g.ref.y) - Math.round(oy) + cfg.gap + i * (cfg.h + 2);
    if (x > viewW || x + cfg.w < 0 || y > viewH || y + cfg.h < 0) continue;
    ctx.fillStyle = cfg.back; ctx.fillRect(x - 1, y - 1, cfg.w + 2, cfg.h + 2);
    ctx.fillStyle = g.full ? cfg.full : cfg.colors[i];
    ctx.fillRect(x, y, Math.max(1, Math.round(cfg.w * g.ratio)), cfg.h);
    n++;
  }
  return n;
}
