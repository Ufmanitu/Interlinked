// render-invui.js (S035) – az inventory panelje a nyitott menüben: slot-rács, kurzor, kijelölés, tárgy-infó, teher. A fő vászonra rajzol (a HUD fölé).
// A panel a játékos HUD-jának sarkában ül (P1 bal, P2 jobb), a menü-váz fölé rajzolódik és teljesen eltakarja. A szöveg t()-ből (inv.*, item.*).
import { t } from './i18n.js';
import { HUD_CONFIG, hudLayout, menuOpen } from './game-hud.js';
import { INVUI_CONFIG, gridDims, scrollTop, slotView, itemColor } from './game-invui.js';

export const INVUI_STYLE = {
  panelW: 256, panelH: 224, pad: 10, gridTop: 26, cell: 34, gap: 2,
  bg: '#0b111c', slot: '#1b2433', slotBorder: '#2c3a52', text: '#dbe6f5', dim: '#9fb4d0', warn: '#ffb45a',
  mark: '#ffd35a', font: '11px monospace', small: '10px monospace', colors: ['#3b82f6', '#ef4444'],
};

/** A panel téglalapja: a HUD fölött, a játékos sarkában (a vászon vw x vh). */
export function invPanelLayout(index, vw, vh, cfg = HUD_CONFIG, st = INVUI_STYLE) {
  const h = hudLayout(index, vw, vh, cfg);
  const x = index === 1 ? vw - cfg.margin - st.panelW : cfg.margin;
  return { x, y: h.y - cfg.menuGap - st.panelH, w: st.panelW, h: st.panelH };
}

/** Slot téglalapja a panelen belül (a látható sor- és oszlop-indexből). */
export function slotRect(L, col, vrow, st = INVUI_STYLE) {
  const stride = st.cell + st.gap;
  return { x: L.x + st.pad + col * stride, y: L.y + st.gridTop + vrow * stride, w: st.cell, h: st.cell };
}

const kg = v => (Math.round(v * 10) / 10).toString();

/** Egy játékos inventory-panelje. -> a panel téglalapja. */
export function drawInventoryPanel(ctx, i, p, inv, ps, vw, vh, tr = t, cfg = INVUI_CONFIG, st = INVUI_STYLE) {
  const L = invPanelLayout(i, vw, vh, HUD_CONFIG, st);
  ctx.fillStyle = st.bg;
  ctx.fillRect(L.x, L.y, L.w, L.h);
  ctx.fillStyle = st.colors[i] || st.colors[0];
  ctx.fillRect(L.x, L.y, L.w, 3);
  ctx.font = st.font;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = st.text;
  ctx.fillText(tr('inv.title'), L.x + st.pad, L.y + 9);
  const over = p && Number.isFinite(p.overload) ? p.overload : 0;
  const w = tr('inv.weight', { kg: kg(p && Number.isFinite(p.carryKg) ? p.carryKg : 0), cap: kg(p && Number.isFinite(p.capacityKg) ? p.capacityKg : 0) });
  ctx.textAlign = 'right';
  ctx.fillStyle = over > 0 ? st.warn : st.dim;
  ctx.fillText(w, L.x + L.w - st.pad, L.y + 9);
  ctx.textAlign = 'left';
  const slots = inv && Array.isArray(inv.slots) ? inv.slots : [];
  const { rows } = gridDims(inv, cfg);
  const top = scrollTop(ps.cursor, rows, cfg);
  for (let vr = 0; vr < cfg.visibleRows; vr++) {
    for (let c = 0; c < cfg.cols; c++) {
      const idx = (top + vr) * cfg.cols + c;
      if (idx >= slots.length) continue;
      const r = slotRect(L, c, vr, st);
      ctx.fillStyle = idx === ps.mark ? st.mark : st.slotBorder;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = st.slot;
      ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      const e = slots[idx];
      if (e) {
        ctx.fillStyle = itemColor(e.id);
        ctx.fillRect(r.x + 9, r.y + 6, 16, 16);
        ctx.font = st.small;
        ctx.textAlign = 'right';
        ctx.fillStyle = st.text;
        ctx.fillText(String(e.n), r.x + r.w - 3, r.y + r.h - 12);
        ctx.textAlign = 'left';
      }
      if (idx === ps.cursor) { // kurzor: a játékos színével, 2 px-es keret
        ctx.fillStyle = st.colors[i] || st.colors[0];
        ctx.fillRect(r.x, r.y, r.w, 2); ctx.fillRect(r.x, r.y + r.h - 2, r.w, 2);
        ctx.fillRect(r.x, r.y, 2, r.h); ctx.fillRect(r.x + r.w - 2, r.y, 2, r.h);
      }
    }
  }
  const stride = st.cell + st.gap, iy = L.y + st.gridTop + cfg.visibleRows * stride + 4;
  ctx.font = st.font;
  const cur = slotView(inv, ps.cursor), held = slotView(inv, ps.mark);
  ctx.fillStyle = st.text;
  ctx.fillText(cur ? tr('inv.slot', { name: tr(cur.nameKey), n: cur.n, kg: kg(cur.totalKg) }) : tr('inv.empty'), L.x + st.pad, iy);
  if (held) { ctx.fillStyle = st.mark; ctx.fillText(tr('inv.held', { name: tr(held.nameKey), n: held.n }), L.x + st.pad, iy + 14); }
  ctx.font = st.small;
  ctx.fillStyle = st.dim;
  ctx.fillText(tr('inv.hint1'), L.x + st.pad, L.y + L.h - 26);
  ctx.fillText(tr('inv.hint2'), L.x + st.pad, L.y + L.h - 14);
  return L;
}

/** A nyitott menüjű játékosok inventory-panelje. -> kirajzolt panelek száma. save/restore; hibás bemenetre nem dob. */
export function drawInventories(ctx, players, inventories, ui, menus, vw, vh, tr = t) {
  if (!ctx || !players || !ui || !Array.isArray(ui.players) || ![vw, vh].every(Number.isFinite)) return 0;
  ctx.save();
  let n = 0;
  for (let i = 0; i < 2; i++) {
    if (!players[i] || !menuOpen(menus, i) || !ui.players[i]) continue;
    drawInventoryPanel(ctx, i, players[i], Array.isArray(inventories) ? inventories[i] : null, ui.players[i], vw, vh, tr);
    n++;
  }
  ctx.restore();
  return n;
}
