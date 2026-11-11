// S028: a Sorskő rajza. A kristály kódból rajzolt (paletta + mátrix, az S021 sprite-DSL-lel), a határ-gyűrű
// szaggatott kör. A kristályt a main.js a játékosokkal együtt y szerint rendezve rajzolja (visibleSorsko -> drawYSorted).
import { createSprites, drawSprite } from './render-sprite.js';
import { sorskoFoot } from './game-sorsko.js';

export const CRYSTAL_ID = 'obj.sorsko';
export const CRYSTAL_W = 40;
export const CRYSTAL_H = 64;
const FOOT = { ax: 20, ay: 60 }; // a lábpont a spriteon belül (a törmelék közepe)
const GLOW_R = 56;               // a kristály körüli fény sugara (px)

export const CRYSTAL_PALETTE = {
  o: '#1b1840', d: '#3a3a8c', m: '#5f66d6', l: '#8fa2ff', h: '#cfd8ff', g: '#eef3ff', s: '#343843', t: '#5a606e',
};

// egy prizma félszélessége az y sorban (-1: kívül): hegyes csúcs, egyenes test, enyhe szűkülés alul
function halfWidth(y, tip, shoulder, bot, hmax) {
  if (y < tip || y > bot) return -1;
  if (y < shoulder) return Math.max(0.6, hmax * Math.pow((y - tip) / (shoulder - tip), 0.85));
  const body = bot - (bot - shoulder) * 0.3;
  if (y <= body) return hmax;
  return hmax * (1 - 0.45 * ((y - body) / (bot - body)));
}

// a kristály mátrixa: sorok (azonos hosszúak) a CRYSTAL_PALETTE kulcsaival, '.' = átlátszó
export function crystalRows(w = CRYSTAL_W, h = CRYSTAL_H) {
  const g = Array.from({ length: h }, () => Array(w).fill('.'));
  const cx = w / 2;
  const put = (x, y, ch) => { if (x >= 0 && x < w && y >= 0 && y < h) g[y][x] = ch; };
  const prism = (cOff, tip, shoulder, bot, hmax, core) => {
    for (let y = tip; y <= bot; y++) {
      const hw = halfWidth(y, tip, shoulder, bot, hmax);
      if (hw < 0) continue;
      for (let x = 0; x < w; x++) {
        const xc = x + 0.5 - cx - cOff;
        if (Math.abs(xc) > hw) continue;
        const rel = xc / hw;
        let ch = rel < -0.35 ? 'd' : rel < 0.25 ? 'm' : 'l';
        if ((x + y) % 11 === 0) ch = 'h';
        if (core && (xc / 5) ** 2 + ((y - (tip + bot) / 2) / 12) ** 2 <= 1) ch = 'g';
        if (Math.abs(xc) > hw - 1 || y === tip || y === bot) ch = 'o';
        put(x, y, ch);
      }
    }
  };
  for (let y = 54; y < h; y++) {                      // a talp törmeléke (ellipszis)
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - cx) / 18, dy = (y - 59) / 4.5;
      if (dx * dx + dy * dy <= 1) put(x, y, y < 58 ? 't' : 's');
    }
  }
  prism(-13, 38, 44, 58, 5, false);                   // két kis szilánk a kristály mellett
  prism(12, 42, 47, 58, 4, false);
  prism(0, 0, 22, 56, 14, true);                      // a fő kristály
  return g.map((r) => r.join(''));
}

export function crystalDef() {
  return { id: CRYSTAL_ID, palette: CRYSTAL_PALETTE, rows: crystalRows(), ax: FOOT.ax, ay: FOOT.ay };
}

export function createSorskoSprites(makeCanvas) {
  return createSprites({ [CRYSTAL_ID]: crystalDef() }, makeCanvas ? { makeCanvas } : {});
}

/** A nézetben lévő kristály y-sort eleme ({sorsko, x, y: lábpont, w:0, h:0}); az out-ba tolja (nem ürít). */
export function visibleSorsko(s, ox, oy, vw, vh, out = []) {
  if (!s) return out;
  const f = sorskoFoot(s);
  const x0 = f.x - FOOT.ax - GLOW_R, x1 = f.x - FOOT.ax + CRYSTAL_W + GLOW_R;
  const y0 = f.y - FOOT.ay - GLOW_R, y1 = f.y - FOOT.ay + CRYSTAL_H + GLOW_R;
  if (x1 < ox || x0 > ox + vw || y1 < oy || y0 > oy + vh) return out;
  out.push({ sorsko: s, x: f.x, y: f.y, w: 0, h: 0 });
  return out;
}

/** A kristály (fény + árnyék + sprite); a lábpont (f.x - ox, f.y - oy). -> kirajzolt-e a valódi sprite */
export function drawSorsko(ctx, sprites, s, ox, oy) {
  const f = sorskoFoot(s);
  const x = Math.round(f.x - ox), y = Math.round(f.y - oy);
  const pulse = 0.5 + 0.5 * Math.sin((2 * Math.PI * s.t) / 3);
  if (typeof ctx.createRadialGradient === 'function') {
    const gy = y - 30;
    const grad = ctx.createRadialGradient(x, gy, 4, x, gy, GLOW_R);
    grad.addColorStop(0, `rgba(150,170,255,${(0.26 + 0.12 * pulse).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(150,170,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - GLOW_R, gy - GLOW_R, GLOW_R * 2, GLOW_R * 2);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x - 18, y - 2, 36, 5);
  return drawSprite(ctx, sprites, CRYSTAL_ID, x, y);
}

/** Metszi-e a mező határköre (vagy a belső sáv-köre) a nézetet? (a távolság a nézet legközelebbi/legtávolabbi pontjához) */
export function ringVisible(s, ox, oy, vw, vh) {
  const cx = s.field.x - ox, cy = s.field.y - oy, r = s.field.radius;
  const dx = Math.max(-cx, 0, cx - vw), dy = Math.max(-cy, 0, cy - vh);
  const fx = Math.max(Math.abs(cx), Math.abs(cx - vw)), fy = Math.max(Math.abs(cy), Math.abs(cy - vh));
  return Math.hypot(dx, dy) <= r + 4 && r - 4 <= Math.hypot(fx, fy);
}

/** A halvány határ-gyűrű (a határ és a belső sáv széle, szaggatva); alpha 0 -> nincs rajz. -> rajzolt-e */
export function drawSorskoRing(ctx, s, alpha, ox, oy, vw, vh) {
  if (!(alpha > 0.005) || !ringVisible(s, ox, oy, vw, vh)) return false;
  const f = s.field, cx = f.x - ox, cy = f.y - oy;
  ctx.save();
  ctx.lineWidth = 2;
  const ring = (r, a, dash) => {
    ctx.strokeStyle = `rgba(150,170,255,${a.toFixed(3)})`;
    if (typeof ctx.setLineDash === 'function') { ctx.setLineDash(dash); ctx.lineDashOffset = -s.t * 8; }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  };
  ring(f.radius, alpha, [10, 10]);
  if (f.band > 0) ring(f.inner, alpha * 0.45, [4, 12]);
  ctx.restore();
  return true;
}
