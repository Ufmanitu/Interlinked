// S017 Warp-zsebek rajza (kódból rajzolt placeholder; az S021 pixel-DSL és az S103 valódi art ide köt).
// A kinti házat a main.js a játékosokkal együtt y szerint rendezve rajzolja (visibleHouses -> drawYSorted),
// a zseb belsejét (padló, falak, tárgyak) a talaj után, a játékosok alatt (drawPockets).

export const ROOF_H = 32; // a tető ennyivel nyúlik a ház ütköző törzse fölé

const C = {
  wall: '#b98f5e', wallLine: '#a37c4d', wallDark: '#8a6840', roofA: '#8b3a2e', roofB: '#7a3126',
  door: '#5a3b22', frame: '#3b2616', knob: '#e0b84a', glass: '#9fd3ff', shadow: 'rgba(0,0,0,0.25)',
  hole: '#10141c', floor: '#8a6a45', seam: '#7a5c3a', wallIn: '#4a372b', wallTop: '#6b4f3b', wallEdge: '#34261e',
  rug: '#9b3b3b', rugEdge: '#c9a227', bed: '#e8e0d0', blanket: '#3b6ea5', table: '#7a5230', tableTop: '#9a6c40',
  mat: '#4a3a30', missing: '#ff00ff',
};

/** A nézetben lévő házak y-sort elemei ({warp, x, y: lábpont, w:0, h:0}); az out-ba tolja (nem ürít). */
export function visibleHouses(ws, ox, oy, vw, vh, out = []) {
  if (!ws) return out;
  for (const L of ws.links) {
    const h = L.house;
    if (h.x + h.w < ox || h.x > ox + vw || h.y + h.h < oy || h.y - ROOF_H > oy + vh) continue;
    out.push({ warp: L, x: h.x + h.w / 2, y: h.y + h.h, w: 0, h: 0 });
  }
  return out;
}

/** Egy kinti ház (a lábpont = a törzs alja); a tető a törzs fölé nyúlik. */
export function drawHouse(ctx, L, ox, oy) {
  const h = L.house;
  const x = Math.round(h.x - ox), y = Math.round(h.y - oy), w = h.w, bh = h.h;
  ctx.fillStyle = C.shadow; ctx.fillRect(x - 4, y + bh - 3, w + 8, 7);
  ctx.fillStyle = C.wall; ctx.fillRect(x, y, w, bh);
  ctx.fillStyle = C.wallLine;
  for (let ly = 8; ly < bh; ly += 8) ctx.fillRect(x, y + ly, w, 1);
  ctx.fillStyle = C.wallDark; ctx.fillRect(x, y + bh - 4, w, 4);
  for (let r = 0; r < ROOF_H + 8; r++) {            // tető: lépcsős trapéz
    const inset = Math.max(0, 14 - Math.floor((r * 14) / 24));
    ctx.fillStyle = (r >> 2) % 2 ? C.roofB : C.roofA;
    ctx.fillRect(x - 6 + inset, y - ROOF_H + r, w + 12 - 2 * inset, 1);
  }
  for (const wx of [x + 12, x + w - 24]) {          // ablakok
    ctx.fillStyle = C.frame; ctx.fillRect(wx - 1, y + 15, 14, 14);
    ctx.fillStyle = C.glass; ctx.fillRect(wx, y + 16, 12, 12);
    ctx.fillStyle = C.frame; ctx.fillRect(wx + 5, y + 16, 2, 12);
  }
  const dx = x + Math.round(w / 2) - 9;             // ajtó a törzs alján, középen
  ctx.fillStyle = C.frame; ctx.fillRect(dx - 1, y + bh - 31, 20, 31);
  ctx.fillStyle = C.door; ctx.fillRect(dx, y + bh - 30, 18, 30);
  ctx.fillStyle = C.knob; ctx.fillRect(dx + 13, y + bh - 15, 2, 2);
}

function drawProp(ctx, p, ox, oy) {
  const x = Math.round(p.x - ox), y = Math.round(p.y - oy);
  if (p.kind === 'rug') {
    ctx.fillStyle = C.rug; ctx.fillRect(x, y, p.w, p.h);
    ctx.fillStyle = C.rugEdge; ctx.fillRect(x + 3, y + 3, p.w - 6, 2); ctx.fillRect(x + 3, y + p.h - 5, p.w - 6, 2);
  } else if (p.kind === 'bed') {
    ctx.fillStyle = C.frame; ctx.fillRect(x, y, p.w, p.h);
    ctx.fillStyle = C.bed; ctx.fillRect(x + 2, y + 2, p.w - 4, 18);
    ctx.fillStyle = C.blanket; ctx.fillRect(x + 2, y + 20, p.w - 4, p.h - 22);
  } else if (p.kind === 'table') {
    ctx.fillStyle = C.table; ctx.fillRect(x, y, p.w, p.h);
    ctx.fillStyle = C.tableTop; ctx.fillRect(x + 2, y + 2, p.w - 4, p.h - 8);
  } else { ctx.fillStyle = C.missing; ctx.fillRect(x, y, p.w, p.h); } // hiányzó tárgy-kinézet: a sérült adat látszik
}

/** A nézetbe eső zsebek belseje -> a kirajzolt zsebek száma. */
export function drawPockets(ctx, ws, ox, oy, vw, vh) {
  if (!ctx || !ws) return 0;
  let n = 0;
  for (const L of ws.links) {
    const b = L.bounds;
    if (b.x + b.w < ox || b.x > ox + vw || b.y + b.h < oy || b.y > oy + vh) continue;
    const f = L.floor, fx = Math.round(f.x - ox), fy = Math.round(f.y - oy);
    ctx.fillStyle = C.wallIn; ctx.fillRect(Math.round(b.x - ox), Math.round(b.y - oy), b.w, b.h);
    ctx.fillStyle = C.wallTop; ctx.fillRect(fx - 32, fy - 32, f.w + 64, 24);          // a felső fal belső lapja
    ctx.fillStyle = C.wallEdge; ctx.fillRect(fx - 32, fy - 8, f.w + 64, 8);
    ctx.fillStyle = C.floor; ctx.fillRect(fx, fy, f.w, f.h);
    ctx.fillStyle = C.seam;
    for (let r = 0; r * 32 < f.h; r++) {
      ctx.fillRect(fx, fy + r * 32, f.w, 1);
      for (let x = (r % 2) * 32; x < f.w; x += 64) ctx.fillRect(fx + x, fy + r * 32, 1, 32);
    }
    const e = L.exit;
    ctx.fillStyle = C.mat; ctx.fillRect(Math.round(e.x - ox) + 4, Math.round(e.y - oy) + e.h - 20, e.w - 8, 16);
    ctx.fillStyle = C.rugEdge; ctx.fillRect(Math.round(e.x - ox) + 6, Math.round(e.y - oy) + e.h - 18, e.w - 12, 2);
    const dx = Math.round(e.x - ox) + 8;                                                 // ajtó az alsó falban
    ctx.fillStyle = C.frame; ctx.fillRect(dx - 2, fy + f.h - 2, e.w - 12, 34);
    ctx.fillStyle = C.door; ctx.fillRect(dx, fy + f.h, e.w - 16, 32);
    for (const p of L.props) drawProp(ctx, p, ox, oy);
    n++;
  }
  return n;
}
