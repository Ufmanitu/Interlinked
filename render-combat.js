// render-combat.js – a támadás-rendszer rajza (S068): ütés-ív, lövedék, találat-szikra, villanás. Importja: game-combat. Nincs DOM; a ctx paraméter.
// A villanás placeholder (fehér réteg a hurtbox fölött); az S103 sprite-ekkel a sprite fehér-sziluettre cserélhető. A hívó: drawYSorted UTÁN, a nap/éjszaka színezés ELŐTT.
import { combatView, hurtbox, flashAlpha } from './game-combat.js';

export const COMBAT_STYLE = Object.freeze({
  slash: [255, 255, 255], playerShot: '#ffe9a8', enemyShot: '#ff7a5a', spark: '#fff6c0', sparkBig: '#ff9a5a', flash: [255, 255, 255], flashMax: 0.7,
  debugWindup: 'rgba(255,80,80,0.6)', debugActive: 'rgba(255,255,80,0.9)',
});
const vis = (x, y, w, h, vw, vh) => x + w >= 0 && y + h >= 0 && x <= vw && y <= vh;

/** -> rajzolt elemek száma. opts {debug}: a hitbox-keretek (windup piros, aktív sárga). */
export function drawCombat(ctx, cs, ox, oy, vw, vh, opts) {
  if (!ctx || !cs) return 0;
  const v = combatView(cs), debug = !!(opts && opts.debug); let n = 0;
  ctx.save();
  for (const a of v.attacks) {
    const b = a.box, x = Math.round(b.x - ox), y = Math.round(b.y - oy);
    if (!vis(x, y, b.w, b.h, vw, vh)) continue;
    if (a.phase === 'active') { const [r, g, bl] = COMBAT_STYLE.slash; ctx.fillStyle = `rgba(${r},${g},${bl},${(0.55 * (1 - a.ratio)).toFixed(3)})`; ctx.fillRect(x, y, b.w, b.h); n++; }
    if (debug) { ctx.strokeStyle = a.phase === 'active' ? COMBAT_STYLE.debugActive : COMBAT_STYLE.debugWindup; ctx.strokeRect(x + 0.5, y + 0.5, b.w - 1, b.h - 1); n++; }
  }
  for (const s of v.shots) {
    const x = Math.round(s.x - ox), y = Math.round(s.y - oy); if (!vis(x - s.r, y - s.r, s.r * 2, s.r * 2, vw, vh)) continue;
    const sp = Math.hypot(s.vx, s.vy) || 1;
    ctx.strokeStyle = s.team === 'player' ? COMBAT_STYLE.playerShot : COMBAT_STYLE.enemyShot; ctx.globalAlpha = 0.5; ctx.lineWidth = Math.max(1, s.r - 1);
    ctx.beginPath(); ctx.moveTo(x - (s.vx / sp) * 14, y - (s.vy / sp) * 14); ctx.lineTo(x, y); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(x - s.r + 1, y - s.r + 1, s.r * 2 - 2, s.r * 2 - 2); n++;
  }
  for (const e of v.fx) {
    const x = Math.round(e.x - ox), y = Math.round(e.y - oy), k = e.t / e.max, r = (e.big ? 10 : 6) + k * (e.big ? 12 : 8);
    if (!vis(x - r, y - r, r * 2, r * 2, vw, vh)) continue;
    ctx.globalAlpha = Math.max(0, 1 - k); ctx.fillStyle = e.big ? COMBAT_STYLE.sparkBig : COMBAT_STYLE.spark;
    ctx.fillRect(x - r, y - 1, r * 2, 2); ctx.fillRect(x - 1, y - r, 2, r * 2); ctx.globalAlpha = 1; n++;
  }
  ctx.restore(); return n;
}

/** A találat-villanás: fehér réteg a villogó entitások hurtbox-án (játékosok és ellenfelek). -> rajzolt villanások száma. */
export function drawHitFlashes(ctx, cs, ox, oy, vw, vh) {
  if (!ctx || !cs) return 0; let n = 0;
  ctx.save();
  for (const f of cs.flash.values()) {
    const b = hurtbox(f.ref); if (!b) continue;
    const key = f.kind === 'player' ? { kind: 'player', index: f.ref.index } : { kind: 'enemy', ref: f.ref }, a = flashAlpha(cs, key);
    const x = Math.round(b.x - ox), y = Math.round(b.y - oy); if (!(a > 0) || !vis(x, y, b.w, b.h, vw, vh)) continue;
    const [r, g, bl] = COMBAT_STYLE.flash; ctx.fillStyle = `rgba(${r},${g},${bl},${(a * COMBAT_STYLE.flashMax).toFixed(3)})`; ctx.fillRect(x, y, b.w, b.h); n++;
  }
  ctx.restore(); return n;
}
