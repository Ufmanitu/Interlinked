// S042 – Craft UI rajz (a logika: game-craftui.js). A panel a játékos menü-sarkában áll, a HUD fölött, és eltakarja a menü-vázat.
import { t } from './i18n.js';
import { craftView, craftTabActive, reasonKey } from './game-craftui.js';

export const CRAFTUI_STYLE = Object.freeze({
  panelW: 256, panelH: 224, margin: 8, hudH: 46, gap: 6, pad: 8, rowH: 18, listY: 34,
  bg: 'rgba(10,16,28,0.97)', edge: '#2d3b55', text: '#e6edf7', dim: '#6f7f99',
  ok: '#7be08a', bad: '#ff7a6a', warn: '#ffb45a', sel: 'rgba(255,255,255,0.09)',
});
const S = CRAFTUI_STYLE;

export function craftPanelLayout(i, vw, vh) {
  return { x: i === 0 ? S.margin : vw - S.margin - S.panelW, y: vh - S.margin - S.hudH - S.gap - S.panelH, w: S.panelW, h: S.panelH };
}

function trunc(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s;
}

function dotColor(row) {
  if (row.craftable) return S.ok;
  if (row.reason === 'station') return S.dim;
  if (row.reason === 'items') return S.bad;
  return S.warn;
}

function tagText(cs, tr, tag) {
  let k = null;
  try { k = cs.tagKey ? cs.tagKey(tag) : null; } catch (e) { k = null; }
  return k ? tr(k) : String(tag == null ? '' : tag);
}

function statusOf(cs, tr, v, row) {
  const f = v.flash;
  if (f) {
    if (f.ok) return { text: tr('craft.done', { name: tr('item.' + f.item), n: f.n }), color: S.ok };
    return { text: tr(reasonKey(f.reason), { name: f.station ? tagText(cs, tr, f.station) : '', level: f.level || 0 }), color: S.bad };
  }
  if (row.craftable) return { text: tr('craft.ok'), color: S.ok };
  const p = { name: row.station ? tagText(cs, tr, row.station) : '', level: row.recipe.skill ? row.recipe.skill.level : 0 };
  return { text: tr(reasonKey(row.reason), p), color: row.reason === 'station' ? S.warn : S.bad };
}

export function drawCraftPanel(ctx, i, player, cs, vw, vh, tr = t) {
  const L = craftPanelLayout(i, vw, vh);
  const v = craftView(cs, i);
  const accent = (player && player.color) || S.edge;
  ctx.save();
  ctx.fillStyle = S.bg;
  ctx.fillRect(L.x, L.y, L.w, L.h);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(L.x + 1, L.y + 1, L.w - 2, L.h - 2);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const x0 = L.x + S.pad, xr = L.x + L.w - S.pad;

  ctx.font = 'bold 12px monospace';
  ctx.fillStyle = S.text;
  ctx.fillText(tr('craft.title'), x0, L.y + 6);
  ctx.font = '10px monospace';
  ctx.fillStyle = S.dim;
  ctx.textAlign = 'right';
  if (v.total) ctx.fillText((v.cursor + 1) + '/' + v.total, xr, L.y + 8);
  ctx.textAlign = 'left';
  const stLine = v.tags.length ? tr('craft.st', { list: v.tags.map(g => tagText(cs, tr, g)).join(', ') }) : tr('craft.nost');
  ctx.fillText(trunc(stLine, 39), x0, L.y + 20);

  ctx.font = '11px monospace';
  if (!v.total) {
    ctx.fillStyle = S.dim;
    ctx.fillText(trunc(tr('craft.none'), 34), x0, L.y + S.listY + 4);
  }
  for (let r = 0; r < v.visible; r++) {
    const idx = v.first + r;
    const row = v.rows[idx];
    if (!row) break;
    const y = L.y + S.listY + r * S.rowH;
    if (idx === v.cursor) {
      ctx.fillStyle = S.sel;
      ctx.fillRect(L.x + 4, y - 1, L.w - 8, S.rowH - 2);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(L.x + 4.5, y - 0.5, L.w - 9, S.rowH - 3);
    }
    ctx.fillStyle = dotColor(row);
    ctx.fillRect(x0, y + 4, 6, 6);
    const out = row.recipe.output || {};
    const label = tr(row.recipe.nameKey) + (out.n > 1 ? ' ×' + out.n : '');
    ctx.fillStyle = row.near ? S.text : S.dim;
    ctx.fillText(trunc(label, 32), x0 + 14, y + 2);
  }

  if (v.total) {
    const row = v.rows[v.cursor];
    const dy = L.y + S.listY + v.visible * S.rowH + 3;
    ctx.fillStyle = S.edge;
    ctx.fillRect(L.x + 4, dy - 2, L.w - 8, 1);
    const out = row.recipe.output || {};
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = S.text;
    ctx.fillText(trunc(tr('craft.makes', { name: tr(row.recipe.nameKey), n: (out.n || 1) * v.qty }), 25), x0, dy + 2);
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = S.warn;
    ctx.fillText(tr('craft.qty', { n: v.qty, max: Math.max(1, row.max) }), xr, dy + 2);
    ctx.textAlign = 'left';
    row.inputs.slice(0, 6).forEach((inp, k) => {
      const col = Math.floor(k / 3), rr = k % 3;
      const need = inp.need * v.qty;
      ctx.fillStyle = inp.have >= need ? S.ok : S.bad;
      ctx.fillText(trunc(tr('item.' + inp.item) + ' ' + inp.have + '/' + need, 18), x0 + col * 120, dy + 17 + rr * 13);
    });
    const st = statusOf(cs, tr, v, row);
    ctx.fillStyle = st.color;
    ctx.fillText(trunc(st.text, 34), x0, dy + 58);
  }

  ctx.font = '10px monospace';
  ctx.fillStyle = S.dim;
  ctx.fillText(trunc(tr('craft.hint1'), 39), x0, L.y + L.h - 24);
  ctx.fillText(trunc(tr('craft.hint2'), 39), x0, L.y + L.h - 13);
  ctx.restore();
}

// a nyitott menüjű, craft fülön lévő játékosok panelje -> rajzolt panelek száma
export function drawCraftPanels(ctx, cs, menus, players, vw, vh, tr = t) {
  let n = 0;
  for (let i = 0; i < 2; i++) {
    if (!craftTabActive(cs, menus, i)) continue;
    drawCraftPanel(ctx, i, players && players[i], cs, vw, vh, tr);
    n++;
  }
  return n;
}
