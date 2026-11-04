// S016 Interakció-promptok rajza (a repóból hiányzott: S017-ben a STATE szerinti API-val újraírva).
// A prompt a célpont fölött: billentyű-gomb + akció-szöveg, játékos-színű kerettel; azonos célponton a két prompt
// egymás mellett; az interakció visszajelző gyűrűje; debug: a zónák keretei. A szövegek ideiglenesek (S019-től i18n).

export const PROMPT_CONFIG = {
  font: '11px monospace',
  capW: 14, capH: 14,          // a billentyű-gomb mérete
  padX: 5, padY: 3,            // a doboz belső margója
  gap: 4,                      // gomb és szöveg között
  pairGap: 6,                  // két prompt között azonos célpontnál
  margin: 8,                   // a nézeten kívüli kivágás margója (px)
  bg: 'rgba(8,12,20,0.78)', text: '#e6edf7', capText: '#10141c',
  colors: ['#3b82f6', '#ef4444'],   // P1 kék, P2 piros (a játékos-színek)
  labels: ['F', ','],               // a gomb-feliratok (az S107 kiosztás-átállítása frissítse)
  ringMin: 6, ringMax: 24,
};

export const INTERACT_TEXT = {
  hu: { 'act.examine': 'Megnéz', 'act.enter': 'Belép', 'act.exit': 'Kilép', 'act.default': 'Használ' },
  en: { 'act.examine': 'Look', 'act.enter': 'Enter', 'act.exit': 'Exit', 'act.default': 'Use' },
};

/** Az akció szövege; ismeretlen akció -> act.default, ismeretlen nyelv -> hu. */
export function promptText(action, lang = 'hu') {
  const tab = INTERACT_TEXT[lang] || INTERACT_TEXT.hu;
  const k = 'act.' + action;
  return Object.prototype.hasOwnProperty.call(tab, k) ? tab[k] : tab['act.default'];
}

const fin = v => typeof v === 'number' && Number.isFinite(v);

function drawOne(ctx, c, x, y, w, h, label, text, color, pc) {
  ctx.fillStyle = pc.bg; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = color; ctx.fillRect(x + pc.padX, y + pc.padY, pc.capW, pc.capH);
  ctx.fillStyle = pc.capText; ctx.fillText(label, x + pc.padX + pc.capW / 2, y + pc.padY + pc.capH / 2);
  ctx.fillStyle = pc.text; ctx.fillText(text, x + pc.padX + pc.capW + pc.gap + ctx.measureText(text).width / 2, y + pc.padY + pc.capH / 2);
}

/**
 * Promptok a célpontok fölött, gyűrűk, debug-zónák. opts: {lang, labels, colors, cfg, debug}.
 * -> a kirajzolt promptok száma (nézeten kívüli nincs rajzolva).
 */
export function drawInteractPrompts(ctx, sys, ox, oy, vw, vh, opts = {}) {
  if (!ctx || !sys || !Array.isArray(sys.players)) return 0;
  const pc = PROMPT_CONFIG;
  const labels = opts.labels || pc.labels, colors = opts.colors || pc.colors, lang = opts.lang || 'hu';
  const gap = fin(sys.cfg && sys.cfg.promptGap) ? sys.cfg.promptGap : 6;
  const ftime = fin(sys.cfg && sys.cfg.feedbackTime) && sys.cfg.feedbackTime > 0 ? sys.cfg.feedbackTime : 0.35;
  ctx.save();
  ctx.font = pc.font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const h = pc.capH + 2 * pc.padY;
  const groups = new Map();
  sys.players.forEach((ps, i) => {
    const t = ps && ps.target;
    if (!t) return;
    let g = groups.get(t.key);
    if (!g) { g = { t, list: [] }; groups.set(t.key, g); }
    g.list.push(i);
  });
  let n = 0;
  for (const g of groups.values()) {
    const ax = g.t.ax - ox, ay = g.t.ay - oy;
    if (!fin(ax) || !fin(ay) || ax < -pc.margin || ax > vw + pc.margin || ay < -pc.margin || ay > vh + pc.margin) continue;
    const text = promptText(g.t.action, lang);
    const w = pc.padX * 2 + pc.capW + pc.gap + Math.ceil(ctx.measureText(text).width);
    const total = g.list.length * w + (g.list.length - 1) * pc.pairGap;
    let x = Math.round(ax - total / 2);
    const y = Math.round(ay - gap - h);
    for (const i of g.list) {
      drawOne(ctx, g.t, x, y, w, h, labels[i] !== undefined ? labels[i] : '?', text, colors[i] || colors[0], pc);
      x += w + pc.pairGap; n++;
    }
  }
  for (const f of sys.feedback || []) {   // az interakció gyűrűje: tágul és halványodik
    const x = f.x - ox, y = f.y - oy, k = Math.min(1, Math.max(0, f.age / ftime));
    if (!fin(x) || !fin(y) || x < -pc.ringMax || x > vw + pc.ringMax || y < -pc.ringMax || y > vh + pc.ringMax) continue;
    ctx.globalAlpha = 1 - k; ctx.strokeStyle = colors[f.player] || colors[0]; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, pc.ringMin + (pc.ringMax - pc.ringMin) * k, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (opts.debug) {                        // a játékosok interakciós zónái
    ctx.lineWidth = 1;
    sys.players.forEach((ps, i) => {
      const z = ps && ps.zone;
      if (!z || !fin(z.x) || !fin(z.y) || z.w <= 0 || z.x - ox > vw || z.x + z.w - ox < 0 || z.y - oy > vh || z.y + z.h - oy < 0) return;
      ctx.strokeStyle = colors[i] || colors[0]; ctx.strokeRect(Math.round(z.x - ox) + 0.5, Math.round(z.y - oy) + 0.5, z.w, z.h);
    });
  }
  ctx.restore();
  return n;
}
