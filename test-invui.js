// S035 tesztek: inventory UI (game-invui + render-invui). Node-ban fut, hamis canvas-szal; a kijelölés/mozgatás/felezés összeg-tartó.
import { test, assert, eq } from './test-index.js';
import { INVUI_CONFIG, INVUI_TEXTS, gridDims, scrollTop, itemColor, slotView, dirOf, createInvUi, moveCursor, stepInvUi } from './game-invui.js';
import { createMenus, stepMenus, menuOpen } from './game-hud.js';
import { createItemRegistry, ITEM_DEFS, ITEM_TEXTS } from './data-items.js';
import { createInventory, createPlayerInventories, addItem, countItem, totalWeight, removeItem, inventoryState } from './game-inventory.js';
import { drawInventories, drawInventoryPanel, invPanelLayout, slotRect, INVUI_STYLE } from './render-invui.js';
import { HUD_CONFIG, hudLayout } from './game-hud.js';
import { createI18n, addTexts, translate, auditTexts } from './i18n.js';
import { BASE_TEXTS } from './data-text.js';
import { createPlayer } from './game-player.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { syncEncumbrance } from './game-encumbrance.js';
import { mulberry32 } from './world-noise.js';

const DT = 1 / 60;
const REG = createItemRegistry();
const C = INVUI_CONFIG;
const blank = (o = {}) => ({ x: 0, y: 0, interact: false, ability1: false, ability2: false, menu: false,
  interactPressed: false, ability1Pressed: false, ability2Pressed: false, menuPressed: false, ...o });

// Rig: menük + UI + két inventory; step(r0, r1) = a main.js sorrendje (stepMenus -> stepInvUi); open(i) = a menü-gomb éle.
function rig(slots) {
  const r = { menus: createMenus(), ui: createInvUi(), invs: createPlayerInventories(REG, 2, slots) };
  r.step = (a = {}, b = {}, dt = DT) => {
    const raws = [blank(a), blank(b)];
    stepMenus(r.menus, raws);
    return stepInvUi(r.ui, r.menus, raws, r.invs, dt);
  };
  r.open = i => (i === 0 ? r.step({ menuPressed: true }) : r.step({}, { menuPressed: true }));
  r.p = i => r.ui.players[i];
  return r;
}
const put = (inv, i, id, n) => { inv.slots[i] = { id, n }; };
const idle = (r, n = 1) => { for (let k = 0; k < n; k++) r.step(); };
const total = invs => invs.map(inv => ({ w: totalWeight(inv), c: ITEM_DEFS.map(d => countItem(inv, d.id)) }));

test('invui: konfig befagyasztva, szövegek HU/EN azonos kulcsokkal és paraméterekkel, minden tárgynak van neve', () => {
  assert(Object.isFrozen(C), 'befagyasztott');
  assert(C.cols >= 1 && C.visibleRows >= 1 && C.deadzone > 0 && C.deadzone < 1 && C.repeatDelay > 0 && C.repeatRate > 0, 'konfig érvényes');
  const hu = Object.keys(INVUI_TEXTS.hu).sort(), en = Object.keys(INVUI_TEXTS.en).sort();
  eq(hu.join(), en.join(), 'azonos kulcsok');
  const params = s => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const k of hu) eq(params(INVUI_TEXTS.hu[k]), params(INVUI_TEXTS.en[k]), 'paraméterek: ' + k);
  for (const d of ITEM_DEFS) assert(ITEM_TEXTS.hu[d.id] && ITEM_TEXTS.en[d.id], 'tárgy-név: ' + d.id);
  const i = createI18n({ lang: 'hu', texts: BASE_TEXTS });
  addTexts(i, INVUI_TEXTS, 'inv.'); addTexts(i, ITEM_TEXTS, 'item.');
  const a = auditTexts(i);
  assert(a.ok, 'audit: ' + JSON.stringify(a));
});

test('invui: dirOf – holtsáv, domináns tengely, hibás bemenet', () => {
  const z = { dx: 0, dy: 0 };
  eq(JSON.stringify(dirOf(0, 0)), JSON.stringify(z));
  eq(JSON.stringify(dirOf(0.49, -0.49)), JSON.stringify(z));
  eq(JSON.stringify(dirOf(1, 0)), JSON.stringify({ dx: 1, dy: 0 }));
  eq(JSON.stringify(dirOf(-0.6, 0.2)), JSON.stringify({ dx: -1, dy: 0 }));
  eq(JSON.stringify(dirOf(0.3, 0.9)), JSON.stringify({ dx: 0, dy: 1 }));
  eq(JSON.stringify(dirOf(0.7, -0.7)), JSON.stringify({ dx: 0, dy: -1 }), 'egyenlő -> függőleges');
  eq(JSON.stringify(dirOf(NaN, undefined)), JSON.stringify(z));
  eq(JSON.stringify(dirOf('x', null)), JSON.stringify(z));
});

test('invui: gridDims és scrollTop', () => {
  const inv = createInventory(REG), big = createInventory(REG, 120), tiny = createInventory(REG, 10);
  eq(gridDims(inv).rows, 4); eq(gridDims(inv).cols, 6); eq(gridDims(big).rows, 20); eq(gridDims(tiny).rows, 2);
  eq(gridDims(null).rows, 0); eq(gridDims({}).rows, 0);
  eq(scrollTop(0, 4), 0, 'belefér'); eq(scrollTop(23, 4), 0);
  eq(scrollTop(0, 20), 0); eq(scrollTop(6 * 10, 20), 8, 'a kurzor sora körül'); eq(scrollTop(119, 20), 16, 'alul a szélre szorítva');
  eq(scrollTop(-5, 20), 0); eq(scrollTop(NaN, 20), 0); eq(scrollTop(3, NaN), 0);
});

test('invui: kurzor-mozgás – korlátok, nincs körbefordulás, a hiányos utolsó sor üres részére nem lép', () => {
  const inv = createInventory(REG, 10); // 6 + 4 slot
  const ps = createInvUi().players[0];
  eq(moveCursor(ps, inv, -1, 0), false); eq(moveCursor(ps, inv, 0, -1), false); eq(ps.cursor, 0);
  ps.cursor = 3; eq(moveCursor(ps, inv, 0, 1), true); eq(ps.cursor, 9);
  eq(moveCursor(ps, inv, 1, 0), false, 'a sor vége'); eq(ps.cursor, 9);
  ps.cursor = 4; eq(moveCursor(ps, inv, 0, 1), false, 'a hiányos sor üres része'); eq(ps.cursor, 4);
  ps.cursor = 5; eq(moveCursor(ps, inv, 1, 0), false, 'nincs körbefordulás'); eq(ps.cursor, 5);
  eq(moveCursor(ps, null, 1, 0), false); eq(moveCursor(ps, createInventory(REG, 1), 1, 0), false);
});

test('invui: zárt menünél nincs mozgás/művelet; megnyitáskor a tartott irány nem fut, és a megnyitás kockájában nincs művelet', () => {
  const r = rig();
  put(r.invs[0], 0, 'wood', 5);
  eq(r.step({ x: 1, interactPressed: true }).length, 0); eq(r.p(0).cursor, 0); eq(r.p(0).mark, -1);
  r.step({ menuPressed: true, x: 1, interactPressed: true }); // megnyitás + tartott jobb + interakció
  assert(menuOpen(r.menus, 0), 'nyitva');
  eq(r.p(0).mark, -1, 'a megnyitás kockájában nincs jelölés');
  for (let k = 0; k < 60; k++) r.step({ x: 1 });
  eq(r.p(0).cursor, 0, 'a megnyitáskor tartott irány nem mozgat');
  r.step({ x: 0 }); r.step({ x: 1 });
  eq(r.p(0).cursor, 1, 'elengedés után mozgat');
});

test('invui: tartott irány – azonnali első lépés, késleltetés, ismétlés, elengedés után újra azonnali', () => {
  const r = rig(120);
  r.open(0);
  const rows = [];
  for (let k = 0; k < 60; k++) { r.step({ y: 1 }); rows.push(Math.floor(r.p(0).cursor / C.cols)); }
  eq(rows[0], 1, 'azonnali első lépés');
  eq(rows[14], 1, 'a késleltetés alatt nincs több');
  const moves = rows[59];
  assert(moves >= 7 && moves <= 10, 'ismétlés ~1/0,1 mp a késleltetés után: ' + moves);
  r.step({ y: 0 });
  const at = r.p(0).cursor;
  r.step({ y: 1 });
  eq(r.p(0).cursor, at + C.cols, 'elengedés után újra azonnali');
  const e = r.step({ x: 1 }); // irányváltás: azonnal
  eq(r.p(0).cursor, at + C.cols + 1); eq(e.length, 1); eq(e[0].type, 'cursor');
});

test('invui: kijelölés, áthelyezés üres helyre, összevonás, csere, visszavonás, üres slot nem jelölhető', () => {
  const r = rig(), inv = r.invs[0];
  put(inv, 0, 'wood', 10); put(inv, 1, 'wood', 20); put(inv, 2, 'stone', 5);
  r.open(0);
  r.step({ interactPressed: true }); eq(r.p(0).mark, 0);
  r.step({ interactPressed: true }); eq(r.p(0).mark, -1, 'ugyanarra: visszavonás');
  r.step({ x: 1 }); r.step({ x: 0 }); // kurzor: 1
  r.step({ interactPressed: true }); eq(r.p(0).mark, 1);
  r.step({ x: 1 }); r.step({ x: 0 }); // kurzor: 2 (kő)
  const e = r.step({ interactPressed: true }); // csere: fa(20) <-> kő(5)
  eq(e[0].type, 'move'); eq(inv.slots[1].id, 'stone'); eq(inv.slots[2].id, 'wood'); eq(inv.slots[2].n, 20); eq(r.p(0).mark, -1);
  r.step({ x: 1 }); r.step({ x: 0 }); // kurzor: 3 (üres)
  r.step({ interactPressed: true }); eq(r.p(0).mark, -1, 'üres slot nem jelölhető');
  r.step({ x: -1 }); r.step({ x: 0 }); // kurzor: 2
  r.step({ interactPressed: true }); eq(r.p(0).mark, 2);
  r.step({ x: 1 }); r.step({ x: 0 });
  r.step({ interactPressed: true }); eq(inv.slots[3].n, 20); eq(inv.slots[2], null, 'üres célra mozgat');
  r.step({ x: -1 }); r.step({ x: 0 }); r.step({ x: -1 }); r.step({ x: 0 }); // kurzor: 1
  put(inv, 1, 'wood', 30);
  r.step({ x: 1 }); r.step({ x: 0 }); r.step({ x: 1 }); r.step({ x: 0 }); // kurzor: 3 (fa 20)
  r.step({ interactPressed: true }); // jelöl: 3
  r.step({ x: -1 }); r.step({ x: 0 }); r.step({ x: -1 }); r.step({ x: 0 }); // kurzor: 1 (fa 30)
  const m = r.step({ interactPressed: true }); // összevonás: 30 + 20 -> 50 (stack 99)
  eq(m[0].type, 'move'); eq(inv.slots[1].n, 50); eq(inv.slots[3], null);
});

test('invui: stack-felezés (képesség 1) – páros/páratlan, csak üres célra, 1 db nem osztható', () => {
  const r = rig(), inv = r.invs[0];
  put(inv, 0, 'wood', 10); put(inv, 2, 'wood', 7); put(inv, 4, 'shard', 1);
  r.open(0);
  r.step({ ability1Pressed: true }); eq(r.p(0).mark, 0, 'felezés előtt jelöl');
  r.step({ x: 1 }); r.step({ x: 0 });
  const e = r.step({ ability1Pressed: true });
  eq(e[0].type, 'split'); eq(inv.slots[0].n, 5); eq(inv.slots[1].n, 5); eq(r.p(0).mark, -1);
  r.step({ x: 1 }); r.step({ x: 0 }); // kurzor 2 (7 fa)
  r.step({ ability1Pressed: true }); eq(r.p(0).mark, 2);
  r.step({ x: 1 }); r.step({ x: 0 }); // kurzor 3 (üres)
  r.step({ ability1Pressed: true });
  eq(inv.slots[2].n, 4); eq(inv.slots[3].n, 3, 'páratlan: a kisebbik fele kerül át');
  // nem üres cél: blokkolt, a jelölés marad
  r.step({ x: -1 }); r.step({ x: 0 }); r.step({ ability1Pressed: true }); eq(r.p(0).mark, 2);
  r.step({ x: -1 }); r.step({ x: 0 }); // kurzor 1 (5 fa, nem üres)
  const b = r.step({ ability1Pressed: true });
  eq(b[0].type, 'blocked'); eq(inv.slots[1].n, 5); eq(inv.slots[2].n, 4); eq(r.p(0).mark, 2);
  r.step({ ability2Pressed: true }); eq(r.p(0).mark, -1);
  // 1 db (szilánk) nem osztható
  r.step({ x: 1 }); r.step({ x: 0 }); r.step({ x: 1 }); r.step({ x: 0 }); r.step({ x: 1 }); r.step({ x: 0 }); // kurzor 4
  r.step({ ability1Pressed: true }); eq(r.p(0).mark, 4);
  r.step({ x: 1 }); r.step({ x: 0 });
  eq(r.step({ ability1Pressed: true })[0].type, 'blocked'); eq(inv.slots[4].n, 1); eq(inv.slots[5], null);
});

test('invui: mégse, zárás törli a kijelölést (a kurzor marad), az eltűnt tárgy kijelölése törlődik', () => {
  const r = rig(), inv = r.invs[0];
  put(inv, 0, 'wood', 4); put(inv, 1, 'herb', 3);
  r.open(0);
  r.step({ interactPressed: true }); eq(r.p(0).mark, 0);
  eq(r.step({ ability2Pressed: true })[0].type, 'cancel'); eq(r.p(0).mark, -1);
  r.step({ ability2Pressed: true }); // nincs jelölés: nincs hatás
  r.step({ interactPressed: true }); eq(r.p(0).mark, 0);
  r.step({ x: 1 }); r.step({ x: 0 });
  r.step({ menuPressed: true }); // zárás
  assert(!menuOpen(r.menus, 0), 'zárva'); eq(r.p(0).mark, -1); eq(r.p(0).cursor, 1, 'a kurzor megmarad');
  r.open(0); eq(r.p(0).cursor, 1);
  r.step({ interactPressed: true }); eq(r.p(0).mark, 1);
  removeItem(inv, 'herb', 3); // közben eltűnik
  r.step(); eq(r.p(0).mark, -1, 'eltűnt tárgy kijelölése törlődik');
  inv.slots.length = 0; // üres/hibás inventory: nem dob
  r.step({ interactPressed: true, x: 1 });
  r.invs[0] = null; r.step({ interactPressed: true, x: 1 });
});

test('invui: két játékos függetlenül – külön kurzor, kijelölés és inventory; csak a nyitott menü reagál', () => {
  const r = rig();
  put(r.invs[0], 0, 'wood', 6); put(r.invs[1], 0, 'stone', 9);
  r.open(1);
  r.step({ x: 1, interactPressed: true }, { x: 1 }); // P0 zárt: semmi; P1 nyitva: mozog
  eq(r.p(0).cursor, 0); eq(r.p(0).mark, -1); eq(r.p(1).cursor, 1);
  r.open(0);
  r.step({ interactPressed: true }, { x: 0 });
  eq(r.p(0).mark, 0); eq(r.p(1).mark, -1);
  r.step({ x: 0 }, { x: -1 }); r.step({}, { interactPressed: true }); // P1: kurzor 0, jelöl
  eq(r.p(1).mark, 0); eq(r.p(0).mark, 0);
  r.step({ ability2Pressed: true }); // P0 mégse nem érinti P1-et
  eq(r.p(0).mark, -1); eq(r.p(1).mark, 0);
  eq(r.invs[0].slots[0].id, 'wood'); eq(r.invs[1].slots[0].id, 'stone');
});

test('invui: összeg-tartó fuzz – 4000 véletlen bemenettel az inventory összegei és a súly nem változik', () => {
  const rnd = mulberry32(35035), r = rig();
  for (const inv of r.invs) {
    for (const [id, n] of [['wood', 150], ['stone', 140], ['herb', 70], ['torch', 21], ['fiber', 30], ['shard', 1]]) addItem(inv, id, n);
  }
  const before = JSON.stringify(total(r.invs));
  const pick = a => a[Math.floor(rnd() * a.length)];
  const axis = [-1, 0, 0, 1, 0.3, -0.7, NaN];
  let events = 0;
  for (let f = 0; f < 4000; f++) {
    const mk = () => ({ x: pick(axis), y: pick(axis), interactPressed: rnd() < 0.08, ability1Pressed: rnd() < 0.08, ability2Pressed: rnd() < 0.04, menuPressed: rnd() < 0.01 });
    events += r.step(mk(), mk(), rnd() < 0.1 ? 0.2 : DT).length;
    for (let i = 0; i < 2; i++) {
      const ps = r.p(i), inv = r.invs[i];
      assert(Number.isInteger(ps.cursor) && ps.cursor >= 0 && ps.cursor < inv.slots.length, 'kurzor tartományban');
      assert(ps.mark === -1 || (ps.mark >= 0 && ps.mark < inv.slots.length), 'jelölés tartományban');
      for (const s of inv.slots) assert(s === null || (s.n >= 1 && s.n <= REG.items.get(s.id).stack), 'stack-határ');
    }
  }
  assert(events > 200, 'a fuzz tényleg művelt: ' + events);
  eq(JSON.stringify(total(r.invs)), before, 'összegek és súly változatlan');
});

test('invui: slotView és itemColor', () => {
  const inv = createInventory(REG);
  put(inv, 3, 'wood', 12); put(inv, 4, 'ghost', 2);
  const v = slotView(inv, 3);
  eq(v.id, 'wood'); eq(v.n, 12); eq(v.nameKey, 'item.wood'); eq(v.unitKg, 2); eq(v.totalKg, 24); eq(v.value, 2); assert(v.tags.includes('FUEL'), 'tag');
  const g = slotView(inv, 4);
  eq(g.nameKey, 'item.ghost'); eq(g.totalKg, 0, 'ismeretlen tárgy: nincs súly, nincs összeomlás');
  eq(slotView(inv, 0), null); eq(slotView(inv, -1), null); eq(slotView(inv, 99), null); eq(slotView(inv, 1.5), null); eq(slotView(null, 0), null);
  assert(/^hsl\(\d+,55%,52%\)$/.test(itemColor('wood')), 'alak');
  eq(itemColor('wood'), itemColor('wood'), 'determinisztikus');
  for (const d of ITEM_DEFS) for (const o of ITEM_DEFS) if (d.id !== o.id) assert(itemColor(d.id) !== itemColor(o.id), 'különböző szín: ' + d.id + '/' + o.id);
  assert(/^hsl/.test(itemColor(undefined)) && /^hsl/.test(itemColor(7)), 'hibás id nem dob');
});

// hamis ctx: rajz-hívások, save/restore egyensúly, a fillText pillanatnyi színével
function rec() {
  const c = { fills: [], texts: [], depth: 0, bad: 0, fillStyle: '', font: '', textAlign: 'left' };
  c.save = () => { c.depth++; };
  c.restore = () => { c.depth--; if (c.depth < 0) c.bad++; };
  c.fillRect = (x, y, w, h) => c.fills.push({ x, y, w, h, s: c.fillStyle });
  c.fillText = (s, x, y) => c.texts.push({ s, x, y, fs: c.fillStyle });
  return c;
}
const VW = 960, VH = 540;
const trFor = lang => {
  const i = createI18n({ lang, texts: BASE_TEXTS });
  addTexts(i, INVUI_TEXTS, 'inv.'); addTexts(i, ITEM_TEXTS, 'item.');
  return (k, p) => translate(i, k, p);
};
const inside = (r, w = VW, h = VH) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('invui render: a panel a vásznon belül, a HUD fölött, a két panel nem fedi egymást, a slotok a panelen belül maradnak', () => {
  const S = INVUI_STYLE;
  const L0 = invPanelLayout(0, VW, VH), L1 = invPanelLayout(1, VW, VH);
  assert(inside(L0) && inside(L1), 'vásznon belül'); assert(!overlap(L0, L1), 'nem fedik egymást');
  for (const [i, L] of [[0, L0], [1, L1]]) {
    const h = hudLayout(i, VW, VH);
    assert(L.y + L.h <= h.y, 'a HUD fölött'); assert(!overlap(L, h), 'nem fedi a HUD-ot');
    for (let vr = 0; vr < C.visibleRows; vr++) for (let c = 0; c < C.cols; c++) {
      const r = slotRect(L, c, vr);
      assert(r.x >= L.x && r.y >= L.y && r.x + r.w <= L.x + L.w && r.y + r.h <= L.y + L.h, 'slot a panelen belül');
    }
    const lastBottom = slotRect(L, 0, C.visibleRows - 1).y + S.cell;
    assert(lastBottom + 4 + 14 + 11 < L.y + L.h - 26, 'az infó-sorok nem érik el a súgót');
  }
  assert(C.cols * (S.cell + S.gap) - S.gap + 2 * S.pad <= S.panelW, 'a rács belefér a panel szélességébe');
});

test('invui render: csak a nyitott menü rajzol; HU/EN szöveg; kurzor, kijelölés és teher-szín; save/restore egyensúly; hibás bemenet nem dob', () => {
  const r = rig(), P = [createPlayer(0, 0, 0), createPlayer(1, 100, 0)];
  put(r.invs[0], 0, 'wood', 12); put(r.invs[0], 1, 'stone', 3);
  P[0].carryKg = 33; P[0].capacityKg = 40; P[0].overload = 0;
  P[1].carryKg = 90.25; P[1].capacityKg = 40; P[1].overload = 0.8;
  const hu = trFor('hu'), en = trFor('en');
  let c = rec();
  eq(drawInventories(c, P, r.invs, r.ui, r.menus, VW, VH, hu), 0); eq(c.fills.length, 0, 'zárt menü: nincs rajz'); eq(c.depth, 0);
  r.open(0);
  c = rec();
  eq(drawInventories(c, P, r.invs, r.ui, r.menus, VW, VH, hu), 1); eq(c.depth, 0); eq(c.bad, 0);
  const txt = c.texts.map(t => t.s);
  assert(txt.includes('Hátizsák'), 'HU cím'); assert(txt.includes('33 / 40 kg'), 'teher-sor: ' + txt.join('|'));
  assert(txt.includes('Fa ×12 · 24 kg'), 'kurzor alatti tárgy: ' + txt.join('|')); assert(txt.includes('12'), 'darabszám a slotban');
  const wt = c.texts.find(t => t.s === '33 / 40 kg'); eq(wt.fs, INVUI_STYLE.dim, 'terhelés alatt nem figyelmeztet');
  assert(c.fills.some(f => f.s === '#3b82f6' && f.w === INVUI_STYLE.cell && f.h === 2), 'kurzor-keret a játékos színével');
  r.step({ interactPressed: true }); // jelölés a 0. slotban
  c = rec(); drawInventories(c, P, r.invs, r.ui, r.menus, VW, VH, en);
  const t2 = c.texts.map(t => t.s);
  assert(t2.includes('Backpack') && t2.includes('Held: Wood ×12'), 'EN, fogott tárgy: ' + t2.join('|'));
  assert(c.fills.some(f => f.s === INVUI_STYLE.mark && f.w === INVUI_STYLE.cell), 'kijelölt slot kerete');
  r.open(1); r.step({}, { x: 1 }); // P1: a 1. slot üres
  c = rec(); eq(drawInventories(c, P, r.invs, r.ui, r.menus, VW, VH, hu), 2); eq(c.depth, 0);
  assert(c.texts.some(t => t.s === 'Üres'), 'üres slot felirata');
  const w1 = c.texts.find(t => t.s === '90.3 / 40 kg' || t.s === '90.2 / 40 kg'); assert(w1, 'tizedes-kerekítés: ' + c.texts.map(t => t.s).join('|'));
  eq(w1.fs, INVUI_STYLE.warn, 'túlterhelve figyelmeztet');
  // hibás bemenet
  for (const args of [[null, P, r.invs, r.ui, r.menus], [rec(), null, r.invs, r.ui, r.menus], [rec(), P, r.invs, null, r.menus], [rec(), P, null, r.ui, r.menus], [rec(), [null, null], r.invs, r.ui, r.menus], [rec(), P, r.invs, r.ui, null]]) {
    drawInventories(args[0], args[1], args[2], args[3], args[4], VW, VH, hu);
  }
  eq(drawInventories(rec(), P, r.invs, r.ui, r.menus, NaN, VH, hu), 0);
  const c2 = rec(); drawInventoryPanel(c2, 0, {}, { slots: [] }, { cursor: 5, mark: 9 }, VW, VH, hu); // üres rács, kurzor kint: nem dob
  drawInventoryPanel(rec(), 1, null, null, { cursor: 0, mark: -1 }, VW, VH, hu);
});

test('invui render: 120 slotos inventory – a látható sávban a kurzor mindig ott van, és legfeljebb visibleRows*cols slot rajzolódik', () => {
  const r = rig(120), P = [createPlayer(0, 0, 0), createPlayer(1, 100, 0)], hu = trFor('hu');
  r.open(0);
  for (const cur of [0, 30, 59, 100, 119]) {
    r.p(0).cursor = cur;
    const c = rec(); drawInventories(c, P, r.invs, r.ui, r.menus, VW, VH, hu);
    const cells = c.fills.filter(f => f.w === INVUI_STYLE.cell && f.h === INVUI_STYLE.cell).length;
    eq(cells, C.visibleRows * C.cols, 'rajzolt slotok (kurzor ' + cur + ')');
    assert(c.fills.some(f => f.s === '#3b82f6' && f.w === INVUI_STYLE.cell && f.h === 2), 'kurzor látszik: ' + cur);
  }
});

// main-szerű lánc: menük + UI + póráz + teher
function chain(frames, script) {
  const P = [createPlayer(0, 400, 300), createPlayer(1, 520, 300)];
  const r = rig();
  for (const inv of r.invs) { addItem(inv, 'wood', 30); addItem(inv, 'stone', 12); addItem(inv, 'herb', 9); }
  const sys = createTetherSystem({ L: { x: 300, y: 200 }, k: 0.5 });
  const trace = [];
  for (let f = 0; f < frames; f++) {
    const raws = script(f).map(blank);
    const eff = stepMenus(r.menus, raws);
    stepInvUi(r.ui, r.menus, raws, r.invs, DT);
    syncEncumbrance(P, r.invs);
    stepTetherSystem(sys, P, eff, DT);
    for (const p of P) assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN pozíció a ' + f + '. kockában');
    assert(Math.abs(P[1].x - P[0].x) <= 300 + 1e-6 && Math.abs(P[1].y - P[0].y) <= 200 + 1e-6, 'póráz-távolság a ' + f + '. kockában');
    if (f % 50 === 0) trace.push([f, P[0].x, P[0].y, P[1].x, P[1].y, r.p(0).cursor, r.p(0).mark, r.p(1).cursor, r.p(1).mark]);
  }
  return { P, r, trace };
}

test('invui: nyitott menü + póráz + teher – a menüs karakter áll (de húzható), a menü a súlyt nem változtatja', () => {
  // 1) P1 áll, P0 menüben navigál és mozgat: P0 helyben marad
  const a = chain(120, f => [
    f === 0 ? { menuPressed: true } : { x: f % 40 < 20 ? 1 : -1, y: f % 30 < 10 ? 1 : 0, interactPressed: f % 17 === 0, ability1Pressed: f % 23 === 0 }, {}]);
  eq(a.P[0].x, 400); eq(a.P[0].y, 300); assert(menuOpen(a.r.menus, 0), 'nyitva maradt');
  assert(a.r.p(0).cursor !== 0 || a.r.ui.actions > 0, 'az UI tényleg dolgozott');
  // 2) P1 elsétál a pórázig: P0 (nyitott menüvel) vele megy, a távolság végig <= L (a chain ellenőrzi), a súly változatlan
  const b = chain(300, f => [f === 0 ? { menuPressed: true } : { x: 1, interactPressed: f % 11 === 0 }, f < 5 ? {} : { x: 1 }]);
  assert(b.P[0].x > 400 + 5, 'a menüs karaktert a társ elhúzta: ' + b.P[0].x);
  const w = 30 * 2 + 12 * 3 + 9 * 0.1;
  for (const p of b.P) assert(Math.abs(p.carryKg - w) < 1e-9, 'a súly változatlan: ' + p.carryKg);
});

test('invui: 600 kockás smoke két szkriptelt játékossal, menü-nyitás/zárás közben – nincs kivétel, az összeg-tartás él, a futás determinisztikus', () => {
  const script = f => [
    { menuPressed: f % 97 === 5 || f % 97 === 60, x: [1, 0, -1, 0][(f >> 3) % 4], y: [0, 0, 1, 0][(f >> 4) % 4], interactPressed: f % 13 === 0, ability1Pressed: f % 19 === 0, ability2Pressed: f % 29 === 0 },
    { menuPressed: f % 89 === 11 || f % 89 === 70, x: [0, -1, 0, 1][(f >> 3) % 4], y: [1, 0, 0, -1][(f >> 4) % 4], interactPressed: f % 11 === 0, ability1Pressed: f % 17 === 0, ability2Pressed: f % 31 === 0 },
  ];
  const run = () => chain(600, script);
  const a = run(), b = run();
  eq(JSON.stringify(a.trace), JSON.stringify(b.trace), 'azonos futás azonos pályát ad');
  eq(JSON.stringify(a.r.invs.map(inventoryState)), JSON.stringify(b.r.invs.map(inventoryState)), 'azonos inventory');
  for (const inv of a.r.invs) { eq(countItem(inv, 'wood'), 30); eq(countItem(inv, 'stone'), 12); eq(countItem(inv, 'herb'), 9); }
  assert(a.r.menus.opened >= 4 && a.r.menus.closed >= 4, 'a menük nyíltak és zárultak');
  assert(a.r.ui.actions > 0 && a.r.ui.moves > 0, 'az UI művelt');
});
