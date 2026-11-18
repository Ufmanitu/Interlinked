// render-status.js (S072) – a státusz-ikonok a játékosok HUD-ja fölött + a sötétség-vignetta. Kódból rajzolt (8x8 maszk), a fő vászonra / a nézetekre.
// Importja: game-hud (hudLayout, menuLayout, menuOpen), game-status (listStatuses, effectsOf, STATUS_DEFS).
import { hudLayout, menuLayout, menuOpen, HUD_CONFIG } from './game-hud.js';
import { listStatuses, effectsOf, STATUS_DEFS } from './game-status.js';

export const STATUS_STYLE = Object.freeze({
  cell: 12, gap: 2, rise: 3,           // ikon-mező (px), köz, a HUD/menü fölötti távolság
  bg: 'rgba(8,12,20,0.78)', barBg: '#1b2433', text: '#ffffff', font: '9px monospace',
  blinkBelow: 1.5,                      // mp: ennyi hátralévő idő alatt villog
  vignetteRadius: 240,                  // px: a teljes látótáv sugara (visionMul 1)
  vignetteAlpha: 0.85,
});

// 8x8 maszkok ('#' = pont)
export const STATUS_ICONS = Object.freeze({
  burn: ['...#....', '..##..#.', '..###.##', '.#######', '.#######', '.#######', '..#####.', '...###..'],
  freeze: ['...##...', '.#.##.#.', '..####..', '########', '########', '..####..', '.#.##.#.', '...##...'],
  poison: ['...##...', '..####..', '..####..', '.######.', '########', '########', '.######.', '..####..'],
  slow: ['..####..', '..####..', '..####..', '########', '.######.', '..####..', '...##...', '........'],
  darkness: ['..####..', '.###....', '###.....', '###.....', '###.....', '####....', '.#######', '..####..'],
});

/**
 * Az i. játékos ikon-sorának téglalapjai (n ikon). A sor a HUD-panel FÖLÖTT van, nyitott menünél a menü-panel fölött;
 * az 1. játékosnál balra igazított (jobbra nő), a 2.-nál jobbra igazított (balra nő). -> [{x,y,w,h}]
 */
export function statusLayout(index, n, vw, vh, menuIsOpen, cfg = HUD_CONFIG, st = STATUS_STYLE) {
  const out = [];
  if (!Number.isInteger(n) || n <= 0 || ![vw, vh].every(Number.isFinite)) return out;
  const base = menuIsOpen ? menuLayout(index, vw, vh, cfg) : hudLayout(index, vw, vh, cfg);
  const y = base.y - st.rise - st.cell, step = st.cell + st.gap;
  for (let k = 0; k < n; k++) {
    const x = index === 1 ? base.x + base.w - st.cell - k * step : base.x + k * step;
    out.push({ x, y, w: st.cell, h: st.cell });
  }
  return out;
}

function drawIcon(ctx, id, r, color, ratio, stacks, left, st) {
  ctx.fillStyle = st.bg;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  const mask = STATUS_ICONS[id];
  ctx.fillStyle = color;
  if (mask) {
    for (let row = 0; row < mask.length; row++) {
      const line = mask[row];
      let c = 0;
      while (c < line.length) {
        if (line[c] !== '#') { c++; continue; }
        let e = c;
        while (e < line.length && line[e] === '#') e++;
        ctx.fillRect(r.x + 2 + c, r.y + 1 + row, e - c, 1); // vízszintes szakaszok: kevesebb rajz-hívás
        c = e;
      }
    }
  }
  ctx.fillStyle = st.barBg;
  ctx.fillRect(r.x + 1, r.y + r.h - 2, r.w - 2, 1);
  const bw = Math.round((r.w - 2) * Math.min(1, Math.max(0, ratio)));
  if (bw > 0) { ctx.fillStyle = color; ctx.fillRect(r.x + 1, r.y + r.h - 2, bw, 1); }
  if (stacks > 1) {
    ctx.fillStyle = st.text;
    ctx.fillText(String(stacks), r.x + r.w - 1, r.y);
  }
}

/** Mindkét játékos státusz-ikonjai (players[i].index nem kell: a sorrend a játékos-index). -> kirajzolt ikonok száma. save/restore, sosem dob. */
export function drawStatusIcons(ctx, ss, players, menus, vw, vh, cfg = HUD_CONFIG, st = STATUS_STYLE) {
  if (!ctx || !ss || !Array.isArray(players) || ![vw, vh].every(Number.isFinite)) return 0;
  ctx.save();
  ctx.font = st.font; ctx.textBaseline = 'top'; ctx.textAlign = 'right';
  let drawn = 0;
  for (let i = 0; i < 2; i++) {
    if (!players[i]) continue;
    const list = listStatuses(ss, i);
    const rects = statusLayout(i, list.length, vw, vh, menuOpen(menus, i), cfg, st);
    for (let k = 0; k < rects.length; k++) {
      const s = list[k], blink = s.left < st.blinkBelow && Math.floor(s.left * 6) % 2 === 0;
      ctx.globalAlpha = blink ? 0.45 : 1;
      drawIcon(ctx, s.id, rects[k], STATUS_DEFS[s.id].color, s.ratio, s.stacks, s.left, st);
      drawn++;
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  return drawn;
}

/**
 * Sötétség-vignetta egy nézetre: a rosszul látó játékos körül a látótáv (vignetteRadius · visionMul) kívül sötétedik.
 * (ox, oy) = a nézet bal-felső sarka a világban, a játékos középpontja p.x/p.y. Gradiens nélküli ctx-en nem rajzol. -> a rajzolt vignetták száma.
 */
export function drawDarknessVignette(ctx, ss, players, ox, oy, vw, vh, st = STATUS_STYLE) {
  if (!ctx || !ss || !Array.isArray(players) || typeof ctx.createRadialGradient !== 'function' || ![ox, oy, vw, vh].every(Number.isFinite)) return 0;
  let n = 0;
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const vm = effectsOf(ss, i).visionMul;
    if (!(vm < 1)) continue;
    const R = st.vignetteRadius * vm, cx = p.x - ox, cy = p.y - oy;
    const a = Math.min(st.vignetteAlpha, 0.35 + (1 - vm));
    const g = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
    g.addColorStop(0, 'rgba(0,0,12,0)');
    g.addColorStop(1, `rgba(0,0,12,${a.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
    n++;
  }
  return n;
}
