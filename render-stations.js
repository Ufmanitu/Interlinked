// render-stations.js (S041): kódból rajzolt placeholder-spriteok a craft-állomásokhoz és a y-sort bejegyzések (az S103 cseréli az art-ot).
// A main.js a látható állomásokat a játékosokkal egy listában adja a drawYSorted-nek; a rajzoló az e.station alapján választ (mint a házaknál: e.warp).

const MISSING = '#ff00ff';

function defaultCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function blob(ctx, cx, cy, rx, ry, color) {
  ctx.fillStyle = color;
  for (let dy = -ry; dy <= ry; dy++) {
    const w = Math.floor(rx * Math.sqrt(1 - (dy * dy) / (ry * ry + 0.0001)));
    if (w > 0) ctx.fillRect(cx - w, cy + dy, w * 2, 1);
  }
}

const PAINT = {
  workbench(ctx, d) { // 48x40, lábpont (24,36)
    const [dark, mid, top, steel, grey] = d.palette;
    blob(ctx, 24, 35, 20, 3, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = dark; ctx.fillRect(6, 22, 5, 14); ctx.fillRect(37, 22, 5, 14); // lábak
    ctx.fillStyle = mid; ctx.fillRect(6, 30, 36, 3); // alsó keresztléc
    ctx.fillStyle = top; ctx.fillRect(3, 14, 42, 9); // lap
    ctx.fillStyle = dark; ctx.fillRect(3, 22, 42, 2);
    ctx.fillStyle = steel; ctx.fillRect(30, 10, 10, 4); ctx.fillStyle = grey; ctx.fillRect(10, 11, 8, 3); // szerszámok a lapon
  },
  furnace(ctx, d) { // 40x48, lábpont (20,44)
    const [dark, base, light, fire, glow] = d.palette;
    blob(ctx, 20, 43, 17, 3, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = dark; ctx.fillRect(4, 16, 32, 28);
    ctx.fillStyle = base; ctx.fillRect(5, 17, 30, 26);
    ctx.fillStyle = light; ctx.fillRect(5, 17, 30, 3);
    ctx.fillStyle = dark; ctx.fillRect(15, 4, 10, 14); ctx.fillStyle = base; ctx.fillRect(16, 4, 8, 14); // kémény
    ctx.fillStyle = dark; ctx.fillRect(11, 26, 18, 14); // szájnyílás
    blob(ctx, 20, 36, 6, 4, fire); blob(ctx, 20, 35, 3, 2, glow);
  },
  cookfire(ctx, d) { // 32x32, lábpont (16,28)
    const [stoneDark, stone, log, fire, glow] = d.palette;
    blob(ctx, 16, 27, 13, 3, 'rgba(0,0,0,0.25)');
    for (let i = 0; i < 8; i++) { // kőgyűrű
      const a = (i / 8) * Math.PI * 2, x = 16 + Math.round(Math.cos(a) * 11), y = 22 + Math.round(Math.sin(a) * 4);
      ctx.fillStyle = i % 2 ? stone : stoneDark; ctx.fillRect(x - 3, y - 2, 6, 4);
    }
    ctx.fillStyle = log; ctx.fillRect(9, 21, 14, 3); ctx.fillRect(12, 18, 3, 6); ctx.fillRect(18, 18, 3, 6);
    blob(ctx, 16, 16, 5, 7, fire); blob(ctx, 16, 17, 2, 4, glow);
  },
};

/** Sprite-készlet: állomás-típusonként egy canvas. makeCanvas(w,h) injektálható (tesztek). */
export function createStationSprites(reg, makeCanvas = defaultCanvas) {
  const sprites = new Map();
  if (!reg || !reg.stations) return { sprites };
  for (const d of reg.stations.values()) {
    const canvas = makeCanvas(d.sprite.w, d.sprite.h);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      if (PAINT[d.id]) PAINT[d.id](ctx, d);
      else { ctx.fillStyle = MISSING; ctx.fillRect(0, 0, d.sprite.w, d.sprite.h); }
    }
    sprites.set(d.id, { canvas, ax: d.sprite.ax, ay: d.sprite.ay });
  }
  return { sprites };
}

/** A nézetbe eső állomások y-sort bejegyzései {station, x, y (lábpont), w:0, h:0}; a `out` tömbhöz fűz. -> out */
export function visibleStations(sys, ox, oy, vw, vh, out = []) {
  if (!sys || !sys.placed) return out;
  for (const st of sys.placed.values()) {
    const d = sys.reg.stations.get(st.type);
    if (!d) continue;
    const x0 = st.x - d.sprite.ax, y0 = st.y - d.sprite.ay;
    if (x0 > ox + vw || x0 + d.sprite.w < ox || y0 > oy + vh || y0 + d.sprite.h < oy) continue;
    out.push({ station: st, x: st.x, y: st.y, w: 0, h: 0 });
  }
  return out;
}

/** Egy y-sort bejegyzés rajza (ox,oy = a nézet bal-felső sarka). -> kirajzolt-e */
export function drawStation(ctx, rend, e, ox, oy) {
  const s = rend && rend.sprites ? rend.sprites.get(e.station.type) : null;
  const x = Math.round(e.x) - Math.round(ox), y = Math.round(e.y) - Math.round(oy);
  if (s) ctx.drawImage(s.canvas, x - s.ax, y - s.ay);
  else { ctx.fillStyle = MISSING; ctx.fillRect(x - 8, y - 16, 16, 16); }
  return !!s;
}
