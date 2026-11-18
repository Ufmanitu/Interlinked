// render-charselect.js (S063) – a karakterválasztó rajza: két panel (faj- és kaszt-lista, előnézet, leírás, statok, képességek), alul súgó.
// Importja: i18n (t), game-charselect (charView), render-paperdoll. Az előnézet S064-től a valódi paperdoll (2x, sétáló figura); ha a vászon nem tud képet rajzolni, a régi helyőrző figura marad.
import { t as defaultT } from './i18n.js';
import { charView } from './game-charselect.js';
import { sharedPaperdoll, drawPreviewDoll } from './render-paperdoll.js';

export const CHARSEL_STYLE = Object.freeze({
  panelW: 448, panelH: 468, panelY: 40, margin: 16, pad: 12, rowH: 22, listW: 140, gap: 8, abIndent: 80,
  back: 'rgba(8,12,20,0.94)', edge: '#2c3a52', text: '#dfe8f5', dim: '#7f93b0', ok: '#6fdc8c', title: '#ffffff', bg: '#0a1020',
  colors: ['#4f8cff', '#ff5a5a'],
  skin: { dwarf: '#d9a066', elf: '#ecd9b2', orc: '#7ea35a' }, cloth: { warrior: '#a64b3c', wizard: '#5a4fb0', ranger: '#3f7d4a', healer: '#d8d2c0' },
  build: { dwarf: { w: 1.1, h: 0.85 }, elf: { w: 0.9, h: 1.1 }, orc: { w: 1.25, h: 1.05 } }, fallback: '#9fb4d0',
});

/** Szöveg tördelése a szélességre (szóhatár; túl hosszú szó karakterenként); maxLines felett az utolsó sor "…"-re végződik. -> sorok. */
export function wrapText(ctx, text, width, maxLines = 99) {
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  const fits = s => ctx.measureText(s).width <= width;
  for (const w of words) {
    const tryLine = cur ? cur + ' ' + w : w;
    if (fits(tryLine)) { cur = tryLine; continue; }
    if (cur) lines.push(cur);
    cur = w;
    while (cur.length > 1 && !fits(cur)) { let k = cur.length - 1; while (k > 1 && !fits(cur.slice(0, k))) k--; lines.push(cur.slice(0, k)); cur = cur.slice(k); }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S?$/, '') + '…'; }
  return lines;
}

export const panelRect = (i, st = CHARSEL_STYLE) => ({ x: st.margin + (i === 1 ? 1 : 0) * (st.panelW + 32), y: st.panelY, w: st.panelW, h: st.panelH });

/** Előnézet (a (x,y) a bal-felső sarok, 64x80 doboz): paperdoll, t = idő (mp) a séta-animációhoz; kép nélküli vásznon helyőrző figura. */
export function drawPreview(ctx, x, y, raceId, classId, st = CHARSEL_STYLE, t = 0) {
  ctx.fillStyle = st.edge; ctx.fillRect(x, y, 64, 80);
  if (drawPreviewDoll(ctx, sharedPaperdoll(), raceId, classId, x, y, t)) return;
  drawPlaceholder(ctx, x, y, raceId, classId, st);
}

/** Helyőrző figura (az S063 előnézete; tartalék). */
function drawPlaceholder(ctx, x, y, raceId, classId, st) {
  const b = st.build[raceId] || { w: 1, h: 1 }, skin = st.skin[raceId] || st.fallback, cloth = st.cloth[classId] || st.fallback;
  const bw = Math.round(28 * b.w), bh = Math.round(30 * b.h), hs = Math.round(18 * b.w), cx = x + 32, base = y + 70;
  ctx.fillStyle = '#1b2438'; ctx.fillRect(cx - 20, base - 2, 40, 2);
  ctx.fillStyle = '#2a2a3a'; ctx.fillRect(cx - Math.round(bw / 2) + 2, base - 10, 8, 8); ctx.fillRect(cx + Math.round(bw / 2) - 10, base - 10, 8, 8); // lábak
  ctx.fillStyle = cloth; ctx.fillRect(cx - Math.round(bw / 2), base - 10 - bh, bw, bh); // törzs
  ctx.fillStyle = skin; ctx.fillRect(cx - Math.round(hs / 2), base - 10 - bh - hs, hs, hs); // fej
  if (classId === 'wizard') { ctx.fillStyle = cloth; ctx.fillRect(cx - Math.round(hs / 2) - 2, base - 10 - bh - hs - 4, hs + 4, 4); ctx.fillRect(cx - 4, base - 10 - bh - hs - 12, 8, 8); }
  else if (classId === 'warrior') { ctx.fillStyle = '#9aa4b2'; ctx.fillRect(cx - Math.round(hs / 2), base - 10 - bh - hs, hs, 5); }
  else if (classId === 'ranger') { ctx.fillStyle = cloth; ctx.fillRect(cx - Math.round(hs / 2), base - 10 - bh - hs, hs, 4); }
  else if (classId === 'healer') { ctx.fillStyle = '#e04a4a'; ctx.fillRect(cx - 2, base - 10 - bh + 6, 4, 12); ctx.fillRect(cx - 6, base - 10 - bh + 10, 12, 4); }
}

const resKey = r => 'charsel.res.' + (r || 'none');
const num = (v, d = 2) => (Number.isFinite(v) ? (Math.round(v * 10 ** d) / 10 ** d).toString() : '-');

function drawList(ctx, x, y, title, rows, sel, active, confirmed, color, tr, st) {
  ctx.font = '10px monospace'; ctx.textBaseline = 'top'; ctx.fillStyle = st.dim; ctx.fillText(title, x, y);
  rows.forEach((r, k) => {
    const ry = y + 14 + k * st.rowH, on = k === sel;
    if (on) { ctx.fillStyle = active ? color : st.edge; ctx.fillRect(x, ry, st.listW, st.rowH - 2); }
    ctx.font = '12px monospace'; ctx.textBaseline = 'middle';
    ctx.fillStyle = on ? (active ? '#0a1020' : st.text) : st.dim;
    ctx.fillText(String(tr(r.nameKey)).slice(0, 14), x + 8, ry + st.rowH / 2 - 1);
    if (on && confirmed) { ctx.fillStyle = st.ok; ctx.fillText('✓', x + st.listW - 16, ry + st.rowH / 2 - 1); }
    ctx.textBaseline = 'top';
  });
}

function drawPanel(ctx, cs, i, tr, st) {
  const v = charView(cs, i);
  if (!v) return false;
  const L = panelRect(i, st), color = st.colors[i], x0 = L.x + st.pad, rx = x0 + st.listW + st.gap + 6, rw = L.w - st.pad - (rx - L.x);
  ctx.fillStyle = st.back; ctx.fillRect(L.x, L.y, L.w, L.h);
  ctx.strokeStyle = v.ready ? st.ok : color; ctx.lineWidth = 2; ctx.strokeRect(L.x + 1, L.y + 1, L.w - 2, L.h - 2);
  ctx.textBaseline = 'top'; ctx.font = '14px monospace'; ctx.fillStyle = color; ctx.fillText(tr('charsel.player', { n: i + 1 }), x0, L.y + 10);
  ctx.font = '11px monospace'; ctx.textAlign = 'right'; ctx.fillStyle = v.ready ? st.ok : st.text; ctx.fillText(tr('charsel.stage.' + v.stage), L.x + L.w - st.pad, L.y + 12); ctx.textAlign = 'left';
  const ly = L.y + 34;
  drawList(ctx, x0, ly, tr('charsel.list.race'), v.races, v.raceIndex, v.stage === 'race', v.stage !== 'race', color, tr, st);
  drawList(ctx, x0, ly + 14 + v.races.length * st.rowH + 12, tr('charsel.list.class'), v.classes, v.classIndex, v.stage === 'class', v.stage === 'ready', color, tr, st);
  // Jobb oszlop: előnézet, nevek, erőforrás, leírások, statok, passzívok
  drawPreview(ctx, rx, ly, v.race ? v.race.id : '', v.cls ? v.cls.id : '', st, Date.now() / 1000);
  ctx.font = '14px monospace'; ctx.fillStyle = st.title;
  ctx.fillText(v.race ? String(tr(v.race.nameKey)) : '-', rx + 76, ly + 2);
  ctx.fillText(v.cls ? String(tr(v.cls.nameKey)) : '-', rx + 76, ly + 22);
  ctx.font = '10px monospace'; ctx.fillStyle = st.dim;
  ctx.fillText(tr('charsel.resource', { res: tr(resKey(v.cls && v.cls.resource)) }), rx + 76, ly + 46);
  let y = ly + 80;
  ctx.font = '11px monospace'; ctx.fillStyle = st.text;
  for (const key of [v.race && v.race.descKey, v.cls && v.cls.descKey]) {
    if (!key) continue;
    for (const line of wrapText(ctx, tr(key), rw, 3)) { ctx.fillText(line, rx, y); y += 13; }
    y += 5;
  }
  if (v.race) {
    ctx.fillStyle = st.dim;
    ctx.fillText(`${tr('charsel.stat.strength')} ${num(v.race.strength)}  ${tr('charsel.stat.weight')} ${num(v.race.weight)}  ${tr('charsel.stat.speed')} ${num(v.race.speed)}`.slice(0, 44), rx, y); y += 14;
    for (const p of v.race.passives) { ctx.fillText(tr('charsel.' + p.key, { v: p.v }), rx, y); y += 13; }
  }
  // Képességek: a panel alján, teljes szélességben
  let ay = L.y + 254;
  ctx.fillStyle = st.edge; ctx.fillRect(x0, ay - 6, L.w - 2 * st.pad, 1);
  ctx.font = '10px monospace'; ctx.fillStyle = st.dim; ctx.fillText(tr('charsel.abilities'), x0, ay); ay += 14;
  for (const a of v.cls ? v.cls.abilities : []) {
    ctx.font = '12px monospace'; ctx.fillStyle = a.slot ? color : st.dim;
    ctx.fillText(`[${a.slot ? tr('charsel.ab.slot', { n: a.slot }) : tr('charsel.ab.later')}]`, x0, ay);
    ctx.fillStyle = st.title; ctx.fillText(String(tr(a.nameKey)), x0 + st.abIndent, ay);
    ctx.font = '10px monospace'; ctx.fillStyle = st.dim; ctx.textAlign = 'right';
    ctx.fillText(a.cost > 0 ? tr('charsel.ab.cost', { cost: num(a.cost, 0), cd: num(a.cooldown, 1) }) : tr('charsel.ab.free', { cd: num(a.cooldown, 1) }), L.x + L.w - st.pad, ay + 2); ctx.textAlign = 'left';
    ay += 15; ctx.fillStyle = st.text;
    for (const line of wrapText(ctx, tr(a.descKey), L.w - 2 * st.pad - st.abIndent, 2)) { ctx.fillText(line, x0 + st.abIndent, ay); ay += 12; }
    ay += 3;
  }
  ctx.font = '10px monospace'; ctx.fillStyle = st.dim; ctx.fillText(tr('charsel.hint.' + v.stage), x0, L.y + L.h - st.pad - 10);
  return true;
}

/** A teljes képernyő rajza (a fő vászonra, a játék helyett) -> rajzolt panelek száma. */
export function drawCharSelect(ctx, cs, vw, vh, tr = defaultT, st = CHARSEL_STYLE) {
  if (!ctx || !cs) return 0;
  ctx.save();
  ctx.fillStyle = st.bg; ctx.fillRect(0, 0, vw, vh);
  ctx.font = '18px monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'center'; ctx.fillStyle = st.title;
  ctx.fillText(String(tr('charsel.title')), vw / 2, 14); ctx.textAlign = 'left';
  let n = 0;
  for (let i = 0; i < 2; i++) if (drawPanel(ctx, cs, i, tr, st)) n++;
  const waiting = cs.players.some(p => p.stage === 'ready');
  if (waiting) { ctx.font = '12px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = cs.done ? st.ok : st.dim; ctx.fillText(String(tr(cs.done ? 'charsel.start' : 'charsel.wait')), vw / 2, vh - 22); ctx.textAlign = 'left'; }
  ctx.restore();
  return n;
}
