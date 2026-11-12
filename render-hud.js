// render-hud.js (S029) – játékosonkénti HUD a vászon alsó sarkaiban + a menü-váz panelje. A fő vászonra rajzolódik (a nézetek és a színezés fölé).
import { t } from './i18n.js';
import { HUD_CONFIG, hudModel, hudLayout, menuLayout, menuOpen } from './game-hud.js';
import { balance, formatMoney } from './game-wallet.js';

export const HUD_STYLE = {
  panel: 'rgba(8,12,20,0.66)', bar: '#1b2433', hp: '#e0566b', stamina: '#5ec26a', exhausted: '#ffb45a',
  text: '#dbe6f5', dim: '#9fb4d0', font: '11px monospace',
  coin: '#f2c94c', coinEdge: '#8a6d12', charW: 7, // charW: a monospace karakterszélesség becslése (nincs measureText a fake ctx-ben)
};

function bar(ctx, x, y, w, h, ratio, color) {
  ctx.fillStyle = HUD_STYLE.bar;
  ctx.fillRect(x, y, w, h);
  const fw = Math.round(w * Math.min(1, Math.max(0, ratio)));
  if (fw > 0) { ctx.fillStyle = color; ctx.fillRect(x, y, fw, h); }
}

/** Pénz-sor a panel jobb felső sarkában: érme-ikon + összeg (jobbra igazítva). */
function drawMoney(ctx, L, wallet) {
  const text = formatMoney(balance(wallet));
  const right = L.x + L.w - 8, w = text.length * HUD_STYLE.charW, ix = Math.round(right - w - 11), iy = L.y + 6;
  ctx.fillStyle = HUD_STYLE.coinEdge; ctx.fillRect(ix, iy, 8, 8);
  ctx.fillStyle = HUD_STYLE.coin; ctx.fillRect(ix + 1, iy + 1, 6, 6);
  ctx.textAlign = 'right';
  ctx.fillStyle = HUD_STYLE.text;
  ctx.fillText(text, right, L.y + 5);
  ctx.textAlign = 'left';
}

/** Egy játékos HUD-panelje (név, ÉP, állóképesség, opcionálisan pénz). -> a panel téglalapja. */
export function drawHudPanel(ctx, p, vw, vh, cfg = HUD_CONFIG, tr = t, wallet = undefined) {
  const m = hudModel(p, cfg), L = hudLayout(m.index, vw, vh, cfg);
  ctx.fillStyle = HUD_STYLE.panel;
  ctx.fillRect(L.x, L.y, L.w, L.h);
  ctx.fillStyle = m.color;
  ctx.fillRect(L.x, L.y, 3, L.h); // játékos-színű sáv
  ctx.font = HUD_STYLE.font;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = HUD_STYLE.text;
  ctx.fillText(tr('hud.player', { n: m.index + 1 }), L.x + 10, L.y + 5);
  const lx = L.x + 10, bx = L.x + 46, by1 = L.y + 20, by2 = L.y + 32;
  ctx.fillStyle = HUD_STYLE.dim;
  ctx.fillText(tr('hud.hp'), lx, by1 - 2);
  ctx.fillText(tr('hud.sta'), lx, by2 - 2);
  bar(ctx, bx, by1, cfg.barW, cfg.barH, m.hpRatio, HUD_STYLE.hp);
  bar(ctx, bx, by2, cfg.barW, cfg.barH, m.staminaRatio, m.exhausted ? HUD_STYLE.exhausted : HUD_STYLE.stamina);
  if (wallet) drawMoney(ctx, L, wallet);
  return L;
}

/** A menü-váz panelje (cím, tipp). A tartalmat az S049 tölti fel. -> a panel téglalapja. */
export function drawMenuPanel(ctx, index, vw, vh, cfg = HUD_CONFIG, tr = t) {
  const L = menuLayout(index, vw, vh, cfg);
  ctx.fillStyle = 'rgba(8,12,20,0.82)';
  ctx.fillRect(L.x, L.y, L.w, L.h);
  ctx.fillStyle = index === 1 ? '#ef4444' : '#3b82f6';
  ctx.fillRect(L.x, L.y, L.w, 3);
  ctx.font = HUD_STYLE.font;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = HUD_STYLE.text;
  ctx.fillText(tr('menu.title'), L.x + 10, L.y + 10);
  ctx.fillStyle = HUD_STYLE.dim;
  ctx.fillText(tr('menu.hint'), L.x + 10, L.y + 32);
  ctx.fillText(tr('menu.close'), L.x + 10, L.y + L.h - 18);
  return L;
}

/** Mindkét játékos HUD-ja + a nyitott menük (wallets: i. játékos ↔ i. pénztárca, opcionális). -> kirajzolt panelek száma. save/restore. */
export function drawHud(ctx, players, menus, vw, vh, cfg = HUD_CONFIG, tr = t, wallets = undefined) {
  if (!ctx || !players || ![vw, vh].every(Number.isFinite)) return 0;
  ctx.save();
  let n = 0;
  for (let i = 0; i < 2; i++) {
    if (!players[i]) continue;
    drawHudPanel(ctx, { ...players[i], index: i }, vw, vh, cfg, tr, wallets && wallets[i]); n++;
    if (menuOpen(menus, i)) { drawMenuPanel(ctx, i, vw, vh, cfg, tr); n++; }
  }
  ctx.restore();
  return n;
}
