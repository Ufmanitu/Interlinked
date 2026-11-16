// render-menu.js (S049) – a térkép- és beállítások-fül rajza (a játékos sarkában, a HUD fölött; a régi menü-panelek helyén).
// Importja: i18n (t), game-hud (hudLayout), game-menu (mapView, menuUiView, MENU_ACTIONS). Nyelvváltáskor a szöveg t()-vel újra számolódik.
import { t as defaultT, currentLang } from './i18n.js';
import { hudLayout, HUD_CONFIG } from './game-hud.js';
import { mapView, menuUiView, menuTabActive } from './game-menu.js';

export const MENU_STYLE = Object.freeze({
  panelW: 256, panelH: 224, gap: 6, pad: 8, rowH: 22, tabH: 16,
  back: 'rgba(8,12,20,0.88)', edge: '#2c3a52', text: '#dfe8f5', dim: '#7f93b0', ok: '#6fdc8c', bad: '#ff7a7a', warn: '#ffb45a',
  colors: ['#4f8cff', '#ff5a5a'],
});

/** A panel téglalapja: a játékos sarkában, a HUD fölött (ugyanott, ahol az inventory/craft panel). */
export function menuPanelLayout(i, vw, vh, st = MENU_STYLE) {
  const h = hudLayout(i, vw, vh);
  const x = i === 1 ? vw - HUD_CONFIG.margin - st.panelW : HUD_CONFIG.margin; // a panel szélesebb a HUD-nál: a külső szélhez igazítva
  return { x, y: h.y - st.gap - st.panelH, w: st.panelW, h: st.panelH };
}

function frame(ctx, L, color, st) {
  ctx.fillStyle = st.back; ctx.fillRect(L.x, L.y, L.w, L.h);
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(L.x + 1, L.y + 1, L.w - 2, L.h - 2);
}

function drawTabs(ctx, L, view, tr, color, st) {
  const n = view.tabs.length, w = Math.floor((L.w - 2 * st.pad) / n);
  ctx.font = '10px monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  view.tabs.forEach((id, k) => {
    const x = L.x + st.pad + k * w, on = k === view.tabIndex;
    ctx.fillStyle = on ? color : st.edge; ctx.fillRect(x, L.y + st.pad, w - 2, st.tabH);
    ctx.fillStyle = on ? '#0a1020' : st.dim; ctx.fillText(String(tr('menu.tab.' + id)).slice(0, 9), x + (w - 2) / 2, L.y + st.pad + st.tabH / 2);
  });
  ctx.textAlign = 'left';
}

function drawMap(ctx, L, mv, tr, st) {
  ctx.font = '12px monospace'; ctx.textBaseline = 'top'; ctx.fillStyle = st.text;
  let y = L.y + st.pad + st.tabH + 14;
  if (!mv) { ctx.fillStyle = st.dim; ctx.fillText(tr('menu.map.none'), L.x + st.pad, y); return; }
  ctx.fillText(tr('menu.map.pos', { x: mv.x, y: mv.y }), L.x + st.pad, y); y += 20;
  ctx.fillText(tr('menu.map.chunk', { cx: mv.cx, cy: mv.cy }), L.x + st.pad, y); y += 20;
  if (mv.dist != null) { ctx.fillText(tr('menu.map.dist', { d: mv.dist }), L.x + st.pad, y); }
  ctx.fillStyle = st.dim; ctx.font = '10px monospace';
  ctx.fillText(tr('menu.map.hint'), L.x + st.pad, L.y + L.h - st.pad - 12);
}

function drawSettings(ctx, L, view, tr, color, st) {
  ctx.font = '12px monospace'; ctx.textBaseline = 'middle';
  const y0 = L.y + st.pad + st.tabH + 8;
  for (let k = 0; k < view.visible && view.first + k < view.total; k++) {
    const row = view.rows[view.first + k], y = y0 + k * st.rowH, sel = view.first + k === view.cursor;
    if (sel) { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(L.x + st.pad, y, L.w - 2 * st.pad, st.rowH - 2); }
    ctx.fillStyle = row.available ? st.text : st.dim;
    ctx.fillText(tr(row.key, row.params), L.x + st.pad + 6, y + st.rowH / 2 - 1);
  }
  ctx.textBaseline = 'top'; ctx.font = '10px monospace';
  if (view.flash) { ctx.fillStyle = view.flash.ok ? st.ok : st.bad; ctx.fillText(tr(view.flash.key), L.x + st.pad, L.y + L.h - st.pad - 26); }
  ctx.fillStyle = st.dim;
  ctx.fillText(tr('menu.set.hint1'), L.x + st.pad, L.y + L.h - st.pad - 12);
}

/** A nyitott extra fülek (térkép/beállítások) rajza játékosonként -> rajzolt panelek száma. A fő vászonra, a HUD után. */
export function drawMenuPanels(ctx, mu, menus, players, vw, vh, tr = defaultT, lang = currentLang(), st = MENU_STYLE) {
  let n = 0;
  for (let i = 0; i < 2; i++) {
    const tab = menuTabActive(mu, menus, i);
    if (!tab) continue;
    const L = menuPanelLayout(i, vw, vh, st), color = st.colors[i];
    const view = menuUiView(mu, i, lang);
    ctx.save();
    frame(ctx, L, color, st);
    drawTabs(ctx, L, view, tr, color, st);
    if (tab === 'map') drawMap(ctx, L, mapView(players, i), tr, st);
    else drawSettings(ctx, L, view, tr, color, st);
    ctx.restore();
    n++;
  }
  return n;
}
