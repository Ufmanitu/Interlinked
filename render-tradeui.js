// S044 – Trade UI rajz (a logika: game-tradeui.js). Három elem: trade FÜL a menü-sarokban, kérés-sáv, a két panel a kép közepén + üzenet.
import { t } from './i18n.js';
import { tradeUiView, tabView, tradeTabActive, reasonKey } from './game-tradeui.js';
import { craftPanelLayout } from './render-craftui.js';
import { formatMoney } from './game-wallet.js';

export const TRADEUI_STYLE = Object.freeze({
  panelW: 300, panelH: 286, gap: 16, pad: 8, rowH: 16, lineH: 13, offerY: 34, pickY: 146,
  bannerW: 560, bannerH: 54, bannerY: 36,
  bg: 'rgba(10,16,28,0.97)', edge: '#2d3b55', text: '#e6edf7', dim: '#6f7f99',
  ok: '#7be08a', bad: '#ff7a6a', warn: '#ffb45a', sel: 'rgba(255,255,255,0.09)', colors: ['#58a6ff', '#ff6a6a'],
});
const S = TRADEUI_STYLE;
const KIND = { ok: S.ok, bad: S.bad, warn: S.warn, dim: S.dim };

const trunc = (s, n) => { s = String(s); return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s; };

export function tradePanelLayout(i, vw, vh) {
  const total = S.panelW * 2 + S.gap;
  return { x: Math.round((vw - total) / 2) + i * (S.panelW + S.gap), y: Math.round((vh - S.panelH) / 2), w: S.panelW, h: S.panelH };
}

function box(ctx, L, accent) {
  ctx.fillStyle = S.bg;
  ctx.fillRect(L.x, L.y, L.w, L.h);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(L.x + 1, L.y + 1, L.w - 2, L.h - 2);
}

function drawSide(ctx, side, vw, vh, tr) {
  const L = tradePanelLayout(side.player, vw, vh);
  const accent = S.colors[side.player];
  box(ctx, L, accent);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const x0 = L.x + S.pad, xr = L.x + L.w - S.pad;
  ctx.font = 'bold 12px monospace';
  ctx.fillStyle = accent;
  ctx.fillText(tr('trade.player', { n: side.player + 1 }), x0, L.y + 6);
  const badge = side.confirmed ? 'trade.badge.confirmed' : side.accepted ? 'trade.badge.accepted' : null;
  if (badge) { ctx.font = 'bold 10px monospace'; ctx.fillStyle = S.ok; ctx.textAlign = 'right'; ctx.fillText(tr(badge), xr, L.y + 8); ctx.textAlign = 'left'; }
  ctx.font = '10px monospace';
  ctx.fillStyle = S.dim;
  ctx.fillText(tr('trade.offer'), x0, L.y + 22);

  ctx.font = '11px monospace';
  const empty = !side.lines.length && !side.money;
  if (empty) { ctx.fillStyle = S.dim; ctx.fillText(trunc(tr('trade.empty'), 40), x0, L.y + S.offerY); }
  side.lines.forEach((l, k) => { ctx.fillStyle = S.text; ctx.fillText(trunc(tr('item.' + l.id), 30) + ' ×' + l.n, x0, L.y + S.offerY + k * S.lineH); });
  if (side.money) { ctx.fillStyle = S.warn; ctx.fillText(tr('trade.money', { n: formatMoney(side.money) }), x0, L.y + S.offerY + 6 * S.lineH); }

  ctx.fillStyle = S.edge;
  ctx.fillRect(L.x + 4, L.y + S.pickY - 8, L.w - 8, 1);
  ctx.font = '10px monospace';
  ctx.fillStyle = S.dim;
  ctx.fillText(tr(side.mode === 'money' ? 'trade.moneyMode' : 'trade.items'), x0, L.y + S.pickY - 4);
  ctx.font = '11px monospace';
  if (side.mode === 'money') {
    ctx.fillStyle = S.warn;
    ctx.fillText(tr('trade.moneyOf', { n: formatMoney(side.money), max: formatMoney(side.balance) }), x0, L.y + S.pickY + 14);
  } else if (!side.total) {
    ctx.fillStyle = S.dim;
    ctx.fillText(trunc(tr('trade.none'), 40), x0, L.y + S.pickY + 12);
  }
  for (let r = 0; side.mode === 'item' && r < side.visible; r++) {
    const idx = side.first + r, row = side.rows[idx];
    if (!row) break;
    const y = L.y + S.pickY + 10 + r * S.rowH;
    if (idx === side.cursor) {
      ctx.fillStyle = S.sel;
      ctx.fillRect(L.x + 4, y - 1, L.w - 8, S.rowH - 2);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(L.x + 4.5, y - 0.5, L.w - 9, S.rowH - 3);
    }
    ctx.fillStyle = row.offered > 0 ? S.warn : S.text;
    ctx.fillText(trunc(tr('item.' + row.id), 22), x0, y + 2);
    ctx.textAlign = 'right';
    ctx.fillText(row.offered + ' / ' + row.have, xr, y + 2);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = KIND[side.status.kind] || S.dim;
  ctx.fillText(trunc(tr(side.status.key, side.status.params), 44), x0, L.y + L.h - 52);
  ctx.font = '10px monospace';
  ctx.fillStyle = S.dim;
  ctx.fillText(trunc(tr(side.mode === 'money' ? 'trade.hintm1' : 'trade.hint1'), 48), x0, L.y + L.h - 24);
  ctx.fillText(trunc(tr('trade.hint2'), 48), x0, L.y + L.h - 13);
}

function drawBanner(ctx, v, vw, tr) {
  const x = Math.round((vw - S.bannerW) / 2), y = S.bannerY;
  box(ctx, { x, y, w: S.bannerW, h: S.bannerH }, S.warn);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.font = 'bold 12px monospace';
  ctx.fillStyle = S.text;
  ctx.fillText(trunc(tr('trade.req', { from: v.from + 1, to: v.to + 1, s: v.secs }), 80), vw / 2, y + 8);
  ctx.font = '10px monospace';
  ctx.fillStyle = S.colors[v.to];
  ctx.fillText(trunc(tr('trade.req.to', { n: v.to + 1 }), 80), vw / 2, y + 24);
  ctx.fillStyle = S.colors[v.from];
  ctx.fillText(trunc(tr('trade.req.from', { n: v.from + 1 }), 80), vw / 2, y + 37);
  ctx.textAlign = 'left';
}

function drawToast(ctx, toast, vw, vh, tr) {
  const text = tr(toast.key);
  ctx.font = '14px monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  ctx.fillStyle = toast.ok ? 'rgba(10,50,24,0.9)' : 'rgba(70,14,14,0.92)';
  ctx.fillRect(Math.round(vw / 2 - w / 2), vh - 92, w, 26);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, vw / 2, vh - 79);
  ctx.textAlign = 'left';
}

// A trade fül a menü-sarokban (a craft-panel helyén) -> rajzolt panelek száma
export function drawTradeTabs(ctx, tu, trade, tctx, menus, players, vw, vh, tr = t) {
  let n = 0;
  for (let i = 0; i < 2; i++) {
    const v = tabView(tu, trade, tctx, menus, i);
    if (!v) continue;
    const L = craftPanelLayout(i, vw, vh);
    ctx.save();
    box(ctx, L, (players && players[i] && players[i].color) || S.edge);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const x0 = L.x + S.pad;
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = S.text;
    ctx.fillText(tr('trade.title'), x0, L.y + 6);
    ctx.font = '11px monospace';
    ctx.fillStyle = v.inRange ? S.ok : S.bad;
    ctx.fillText(trunc(tr('trade.tab.partner', { d: v.dist == null ? '?' : v.dist, max: v.max }), 34), x0, L.y + 34);
    ctx.fillStyle = v.busy ? S.warn : v.inRange ? S.text : S.dim;
    ctx.fillText(trunc(tr(v.busy ? 'trade.tab.busy' : v.inRange ? 'trade.tab.go' : 'trade.tab.far'), 34), x0, L.y + 54);
    if (v.flash) { ctx.fillStyle = S.bad; ctx.fillText(trunc(tr(reasonKey(v.flash.reason), { max: trade.cfg.maxLines }), 34), x0, L.y + 74); }
    ctx.font = '10px monospace';
    ctx.fillStyle = S.dim;
    ctx.fillText(trunc(tr('trade.tab.close'), 39), x0, L.y + L.h - 13);
    ctx.restore();
    n++;
  }
  return n;
}

// Kérés-sáv, a két panel (open/confirm) és az üzenet -> rajzolt elemek száma
export function drawTradeOverlay(ctx, tu, trade, tctx, vw, vh, tr = t) {
  const v = tradeUiView(tu, trade, tctx);
  let n = 0;
  ctx.save();
  if (v.phase === 'request') { drawBanner(ctx, v, vw, tr); n++; }
  if (v.phase === 'open' || v.phase === 'confirm') for (const side of v.sides) { drawSide(ctx, side, vw, vh, tr); n++; }
  if (v.toast) { drawToast(ctx, v.toast, vw, vh, tr); n++; }
  ctx.restore();
  return n;
}

export { tradeTabActive };
