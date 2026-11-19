// render-combathud.js (S074) – harc HUD rajza: képesség-sáv (a fő vásznon), ellenség-életcsík és lebegő sebzés-számok (nézetenként).
// Importja: i18n (t), game-hud (menuOpen), game-combathud (modell/elrendezés). Nincs strokeText/measureText: a szöveg árnyékkal (2× fillText) rajzolódik, így fake ctx-en is fut.
import { t } from './i18n.js';
import { HUD_CONFIG, menuOpen } from './game-hud.js';
import { COMBATHUD_CONFIG, stripLayout, stripModel, enemyBars, visibleNumbers } from './game-combathud.js';

export const COMBATHUD_STYLE = Object.freeze({
  panel: 'rgba(8,12,20,0.78)', edge: '#3a4a63', edgeReady: '#9fb4d0', edgeLow: '#8a3a3a', text: '#dbe6f5', dim: '#6f7f99', shade: 'rgba(0,0,0,0.75)',
  cd: 'rgba(0,0,0,0.68)', pool: { mana: '#4f8cff', focus: '#e8c24a' }, poolBg: '#1b2433', slotFont: '10px monospace', keyFont: '7px monospace', poolFont: '8px monospace',
  bar: { bg: '#10151f', edge: '#000000', hi: '#5ec26a', mid: '#e8c24a', lo: '#e0566b', attack: '#ffd24a', frozen: '#8fd8ff' },
  num: { physical: '#ffffff', fire: '#ff9a4a', frost: '#8fd8ff', poison: '#8be07a', dark: '#b18aff', heat: '#ffcf5a', player: '#ff6b6b', heal: '#6be08a' },
  numFont: 'bold 11px monospace', numFontBig: 'bold 14px monospace', numFontDot: '9px monospace',
});
const S = COMBATHUD_STYLE;

function shadowText(ctx, text, x, y) {
  ctx.fillStyle = S.shade; ctx.fillText(text, x + 1, y + 1);
}

function drawSlot(ctx, r, s) {
  ctx.fillStyle = S.panel; ctx.fillRect(r.x, r.y, r.w, r.h);
  const edge = s.empty ? S.edge : (s.ready ? S.edgeReady : (!s.affordable && s.remaining <= 0 ? S.edgeLow : S.edge));
  ctx.fillStyle = edge;
  ctx.fillRect(r.x, r.y, r.w, 1); ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1); ctx.fillRect(r.x, r.y, 1, r.h); ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  if (s.empty) { ctx.font = S.keyFont; ctx.fillStyle = S.dim; ctx.fillText(s.key, r.x + 3, r.y + 2); return; }
  ctx.font = S.slotFont; ctx.textAlign = 'center';
  ctx.globalAlpha = s.affordable ? 1 : 0.45;
  ctx.fillStyle = S.text; ctx.fillText(s.label, r.x + r.w / 2, r.y + 6);
  ctx.globalAlpha = 1;
  if (s.ratio > 0) { // a hátralévő cooldown felülről takarja (kifogyó függöny)
    const h = Math.max(1, Math.round((r.h - 2) * s.ratio));
    ctx.fillStyle = S.cd; ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, h);
  }
  if (s.secs) { ctx.font = S.keyFont; ctx.textAlign = 'center'; shadowText(ctx, s.secs, r.x + r.w / 2, r.y + r.h - 9); ctx.fillStyle = '#ffffff'; ctx.fillText(s.secs, r.x + r.w / 2, r.y + r.h - 9); }
  ctx.font = S.keyFont; ctx.textAlign = 'left'; ctx.fillStyle = S.dim; ctx.fillText(s.key, r.x + 2, r.y + 1);
}

function drawPool(ctx, r, pool, tr) {
  ctx.fillStyle = S.poolBg; ctx.fillRect(r.x, r.y, r.w, r.h);
  const w = Math.round(r.w * Math.min(1, Math.max(0, pool.ratio)));
  if (w > 0) { ctx.fillStyle = S.pool[pool.res] || S.pool.mana; ctx.fillRect(r.x, r.y, w, r.h); }
  ctx.font = S.poolFont; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const txt = tr(pool.textKey) + ' ' + Math.floor(pool.value);
  shadowText(ctx, txt, r.x + 3, r.y + r.h / 2); ctx.fillStyle = '#ffffff'; ctx.fillText(txt, r.x + 3, r.y + r.h / 2);
}

/** Mindkét játékos képesség-sávja a HUD-panel fölött (nyitott menünél az adott játékosé rejtve: a menü foglalja a helyet). -> kirajzolt sávok száma. save/restore, sosem dob. */
export function drawAbilityStrips(ctx, abilitySys, players, menus, vw, vh, tr = t, cfg = HUD_CONFIG, cc = COMBATHUD_CONFIG) {
  if (!ctx || !Array.isArray(players) || ![vw, vh].every(Number.isFinite)) return 0;
  ctx.save();
  let n = 0;
  for (let i = 0; i < 2; i++) {
    if (!players[i] || menuOpen(menus, i)) continue;
    const L = stripLayout(i, vw, vh, cfg, cc); if (!L) continue;
    const m = stripModel(abilitySys, players, i, tr);
    for (let k = 0; k < 2; k++) drawSlot(ctx, L.slots[k], m.slots[k]);
    if (m.pool) drawPool(ctx, L.pool, m.pool, tr);
    n++;
  }
  ctx.restore();
  return n;
}

/** Az ellenség-életcsíkok egy nézetben ((ox,oy) = a nézet bal-felső sarka). -> kirajzolt csíkok száma. */
export function drawEnemyBars(ctx, ch, enemySys, ox, oy, vw, vh) {
  if (!ctx || !ch || !enemySys) return 0;
  const list = enemyBars(ch, enemySys, ox, oy, vw, vh);
  ctx.save();
  for (const b of list) {
    ctx.fillStyle = b.state === 'attack' ? S.bar.attack : S.bar.edge; ctx.fillRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2);
    ctx.fillStyle = S.bar.bg; ctx.fillRect(b.x, b.y, b.w, b.h);
    const w = Math.max(b.ratio > 0 ? 1 : 0, Math.round(b.w * b.ratio));
    if (w > 0) { ctx.fillStyle = b.frozen ? S.bar.frozen : (b.ratio > 0.5 ? S.bar.hi : (b.ratio > 0.25 ? S.bar.mid : S.bar.lo)); ctx.fillRect(b.x, b.y, w, b.h); }
  }
  ctx.restore();
  return list.length;
}

/** A lebegő sebzés-/gyógyítás-számok egy nézetben. -> kirajzolt számok száma. */
export function drawDamageNumbers(ctx, ch, ox, oy, vw, vh) {
  if (!ctx || !ch) return 0;
  const list = visibleNumbers(ch, ox, oy, vw, vh);
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const n of list) {
    if (!n.text) continue;
    ctx.globalAlpha = n.alpha; ctx.font = n.dot ? S.numFontDot : (n.big ? S.numFontBig : S.numFont);
    shadowText(ctx, n.text, n.x, n.y);
    ctx.fillStyle = n.kind === 'heal' ? S.num.heal : (n.kind === 'player' ? S.num.player : (S.num[n.type] || S.num.physical));
    ctx.fillText(n.text, n.x, n.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  return list.length;
}
