// S042 – Craft UI tesztek (tiszta logika + rajz hamis ctx-szel). Saját mini item/recept-készletet használ.
import { test, assert, eq } from './test-index.js';
import { createItemRegistry } from './data-items.js';
import { createRecipeRegistry } from './game-crafting.js';
import { createInventory, addItem, countItem } from './game-inventory.js';
import { createI18n, addTexts, auditTexts } from './i18n.js';
import {
  CRAFTUI_TEXTS, CRAFT_REASONS, createCraftUi, requestCraftOpen, onCraft, routeCraftInputs, stepCraftUi,
  buildCraftRows, craftTabActive, invMenus, craftView, craftDir, scrollFirst, reasonKey, sanitizeCraftUiConfig,
} from './game-craftui.js';
import { drawCraftPanels, craftPanelLayout } from './render-craftui.js';

const ITEMS = ['wood', 'stone', 'plank', 'hammer', 'brick'].map(id => ({ id, stack: 99, weight: 0.5, value: 1, tags: ['MATERIAL'] }));
const RECIPES = [
  { id: 'plank', inputs: [{ item: 'wood', n: 2 }], output: { item: 'plank', n: 1 }, station: null, skill: null },
  { id: 'hammer', inputs: [{ item: 'plank', n: 2 }, { item: 'stone', n: 1 }], output: { item: 'hammer', n: 1 }, station: 'BENCH', skill: null },
  { id: 'brick', inputs: [{ item: 'stone', n: 3 }], output: { item: 'brick', n: 2 }, station: 'KILN', skill: null },
];

function world() {
  const itemReg = createItemRegistry(ITEMS);
  const recipes = createRecipeRegistry(RECIPES, itemReg);
  const inv = [createInventory(itemReg, 24), createInventory(itemReg, 24)];
  const near = [new Set(), new Set()];
  const cs = createCraftUi({
    recipes,
    ctxOf: i => ({ stations: near[i], skills: {} }),
    tagKey: tag => (tag === 'BENCH' ? 'obj.workbench' : null),
  });
  return { itemReg, recipes, inv, near, cs, menus: { open: [false, false] } };
}
const P = o => ({ x: 0, y: 0, interact: false, ability1: false, ability2: false, menu: false, interactPressed: false, ability1Pressed: false, ability2Pressed: false, menuPressed: false, ...o });
// a stepMenus helyett: a menuPressed éle váltja a menüt
function fakeMenus(menus, menuRaws) {
  for (let i = 0; i < 2; i++) if (menuRaws[i] && menuRaws[i].menuPressed) menus.open[i] = !menus.open[i];
}
function frame(w, raws, dt = 1 / 60) {
  const route = routeCraftInputs(w.cs, w.menus, raws);
  fakeMenus(w.menus, route.menu);
  const ev = stepCraftUi(w.cs, w.menus, raws, w.inv, dt);
  return { route, ev };
}
const idle = () => [P(), P()];
function with0(o) { return [P(o), P()]; }
function openCraft(w, i = 0, extra = {}) { // menü gomb kétszer: inventory -> craft
  const a = idle(); a[i] = P({ menuPressed: true });
  frame(w, a);
  const b = idle(); b[i] = P({ menuPressed: true, ...extra });
  frame(w, b);
  return craftTabActive(w.cs, w.menus, i);
}
function release(w, n = 2) { for (let k = 0; k < n; k++) frame(w, idle()); }
function pulse(w, o) { frame(w, with0(o)); frame(w, idle()); }
function fakeCtx() {
  const calls = [];
  return new Proxy({ calls }, {
    get(tg, k) {
      if (k in tg) return tg[k];
      if (k === 'measureText') return s => ({ width: String(s).length * 6 });
      return (...a) => { calls.push([k, ...a]); };
    },
    set(tg, k, v) { tg[k] = v; return true; },
  });
}

test('craftui: szövegek HU/EN, azonos paraméterekkel', () => {
  const st = { getItem() { return null; }, setItem() {} };
  const i = createI18n({ lang: 'hu', storage: st });
  addTexts(i, CRAFTUI_TEXTS, 'craft.');
  const a = auditTexts(i);
  assert(a.ok, 'audit: ' + JSON.stringify(a));
  for (const r of [...CRAFT_REASONS, 'other']) assert(CRAFTUI_TEXTS.hu['r.' + r] && CRAFTUI_TEXTS.en['r.' + r], 'ok-szöveg: ' + r);
  eq(reasonKey('items'), 'craft.r.items');
  eq(reasonKey('???'), 'craft.r.other');
  eq(reasonKey(undefined), 'craft.r.other');
});

test('craftui: konfig, irány, görgetés', () => {
  eq(sanitizeCraftUiConfig(null).visibleRows, 5);
  eq(sanitizeCraftUiConfig({ visibleRows: 3.9, maxQty: -1, deadzone: 5 }).visibleRows, 3);
  eq(sanitizeCraftUiConfig({ maxQty: -1 }).maxQty, 99);
  assert(sanitizeCraftUiConfig({ deadzone: 5 }).deadzone <= 0.95);
  assert(Object.isFrozen(sanitizeCraftUiConfig({})));
  eq(craftDir(0.2, 0.2, 0.5).dx, 0);
  eq(craftDir(0.9, 0.1, 0.5).dx, 1);
  eq(craftDir(-0.9, 0.1, 0.5).dx, -1);
  eq(craftDir(0.1, -0.9, 0.5).dy, -1);
  eq(craftDir(NaN, undefined, 0.5).dx, 0);
  eq(scrollFirst(0, 3, 5), 0);
  eq(scrollFirst(2, 10, 5), 0);
  eq(scrollFirst(3, 10, 5), 1);
  eq(scrollFirst(9, 10, 5), 5);
  eq(scrollFirst(NaN, 10, 5), 0);
});

test('craftui: sorok – kézi, közeli és távoli állomás; hiány jelzése', () => {
  const w = world();
  addItem(w.inv[0], 'wood', 10); addItem(w.inv[0], 'stone', 5);
  w.near[0].add('BENCH');
  const rows = buildCraftRows(w.recipes, w.inv[0], { stations: w.near[0] });
  eq(rows.map(r => r.recipe.id).join(','), 'plank,hammer,brick');
  eq(rows[0].craftable, true); eq(rows[0].max, 5); eq(rows[0].near, true);
  eq(rows[1].craftable, false); eq(rows[1].reason, 'items'); eq(rows[1].near, true);
  const pl = rows[1].inputs.find(x => x.item === 'plank');
  eq(pl.have, 0); eq(pl.need, 2);
  eq(rows[2].reason, 'station'); eq(rows[2].near, false);
  // közeli állomás előre, a távoli hátra (BENCH < KILN, de a távoli akkor is hátul marad)
  const far = buildCraftRows(w.recipes, w.inv[0], { stations: new Set(['KILN']) });
  eq(far.map(r => r.recipe.id).join(','), 'plank,brick,hammer');
  eq(far[1].craftable, true);
  // hibás bemenetek
  eq(buildCraftRows(null, w.inv[0], {}).length, 0);
  eq(buildCraftRows(w.recipes, null, {}).length, 0);
  eq(buildCraftRows(w.recipes, w.inv[0], null).length, 3, 'null ctx: nincs közeli állomás, de a sorok megvannak');
});

test('craftui: menü-fül körforgás: inventory -> craft -> zár; a másik játékos érintetlen', () => {
  const w = world();
  const a = [P({ menuPressed: true }), P({ x: 1, interactPressed: true })];
  const r1 = frame(w, a);
  eq(w.menus.open[0], true); eq(w.cs.players[0].tab, 'inv');
  eq(r1.route.inv[0], a[0]); eq(r1.route.menu[1], a[1]); // inventory fülön a nyers bemenet megy tovább
  const r2 = frame(w, [P({ menuPressed: true, interactPressed: true, x: 1 }), P()]);
  eq(w.menus.open[0], true, 'a menü nyitva marad'); eq(w.cs.players[0].tab, 'craft');
  eq(r2.route.menu[0].menuPressed, false);
  eq(r2.route.inv[0].interactPressed, false); eq(r2.route.inv[0].x, 0);
  const r3 = frame(w, [P({ interactPressed: true, ability2Pressed: true, x: 1 }), P()]);
  eq(r3.route.inv[0].ability2Pressed, false, 'craft fülön nincs eldobás/felállítás');
  eq(r3.route.inv[0].x, 0);
  const r4 = frame(w, [P({ menuPressed: true }), P()]);
  eq(w.menus.open[0], false); eq(w.cs.players[0].tab, 'inv');
  eq(r4.route.menu[0].menuPressed, true);
  assert(!craftTabActive(w.cs, w.menus, 0));
  eq(w.cs.players[1].tab, 'inv');
});

test('craftui: állomás-interakció a craft fülön nyitja a menüt', () => {
  const w = world();
  eq(requestCraftOpen(w.cs, 1), true);
  eq(requestCraftOpen(w.cs, 2), false);
  eq(requestCraftOpen(w.cs, 0.5), false);
  eq(requestCraftOpen(null, 0), false);
  const r = frame(w, idle());
  eq(r.route.menu[1].menuPressed, true);
  eq(w.menus.open[1], true); eq(w.cs.players[1].tab, 'craft');
  eq(w.cs.pending[1], false);
  assert(craftTabActive(w.cs, w.menus, 1) && !craftTabActive(w.cs, w.menus, 0));
  // nyitott menüvel nem nyit újra: a kérés a zárás után él tovább
  requestCraftOpen(w.cs, 0);
  frame(w, idle());
  eq(w.menus.open[0], true); eq(w.cs.players[0].tab, 'craft');
});

test('craftui: kurzor, db, ismétlés, nyitáskor tartott irány', () => {
  const w = world();
  addItem(w.inv[0], 'wood', 10); addItem(w.inv[0], 'stone', 5);
  w.near[0].add('BENCH');
  assert(openCraft(w, 0, { y: 1 }));
  frame(w, with0({ y: 1 }));
  eq(w.cs.players[0].cursor, 0, 'a nyitáskor tartott irány nem mozdít');
  release(w);
  pulse(w, { y: 1 }); eq(w.cs.players[0].cursor, 1);
  pulse(w, { y: 1 }); pulse(w, { y: 1 }); eq(w.cs.players[0].cursor, 2, 'a végén megáll');
  pulse(w, { y: -1 }); pulse(w, { y: -1 }); pulse(w, { y: -1 });
  eq(w.cs.players[0].cursor, 0);
  // db: plank max 5
  for (let k = 0; k < 8; k++) pulse(w, { x: 1 });
  eq(w.cs.players[0].qty, 5);
  pulse(w, { x: -1 }); eq(w.cs.players[0].qty, 4);
  frame(w, with0({ ability2Pressed: true })); eq(w.cs.players[0].qty, 1);
  pulse(w, { x: 1 }); eq(w.cs.players[0].qty, 2);
  pulse(w, { y: 1 }); eq(w.cs.players[0].qty, 1, 'recept-váltás nullázza a db-ot');
  pulse(w, { y: -1 });
  // ismétlés: tartott irány .3 mp után, utána .1 mp-enként
  frame(w, with0({ y: 1 })); eq(w.cs.players[0].cursor, 1);
  for (let k = 0; k < 17; k++) frame(w, with0({ y: 1 }));
  eq(w.cs.players[0].cursor, 1, '0,3 mp előtt nincs ismétlés');
  for (let k = 0; k < 3; k++) frame(w, with0({ y: 1 }));
  eq(w.cs.players[0].cursor, 2, 'ismétlés');
});

test('craftui: craft interakcióval, max-craft 1. képességgel, esemény', () => {
  const w = world();
  addItem(w.inv[0], 'wood', 10);
  assert(openCraft(w, 0)); release(w);
  const seen = [];
  const off = onCraft(w.cs, ev => seen.push(ev));
  for (let k = 0; k < 2; k++) pulse(w, { x: 1 });
  eq(w.cs.players[0].qty, 3);
  const r = frame(w, with0({ interactPressed: true }));
  eq(countItem(w.inv[0], 'wood'), 4); eq(countItem(w.inv[0], 'plank'), 3);
  eq(r.ev.length, 1); eq(r.ev[0].type, 'craft'); eq(r.ev[0].times, 3); eq(r.ev[0].recipe, 'plank'); eq(r.ev[0].player, 0);
  eq(seen.length, 1);
  assert(w.cs.players[0].flash && w.cs.players[0].flash.ok);
  eq(w.cs.players[0].qty, 2, 'a db a maradék max-ra szorul');
  frame(w, with0({ ability1Pressed: true }));
  eq(countItem(w.inv[0], 'wood'), 0); eq(countItem(w.inv[0], 'plank'), 5);
  // elfogyott: nem craftolható -> hiba-esemény, az inventory érintetlen
  const f = frame(w, with0({ interactPressed: true }));
  eq(f.ev[0].type, 'craft-fail'); eq(f.ev[0].reason, 'items');
  eq(countItem(w.inv[0], 'plank'), 5);
  assert(w.cs.players[0].flash && !w.cs.players[0].flash.ok);
  eq(seen.length, 3); // craft, max-craft, hiba
  off();
  frame(w, with0({ interactPressed: true }));
  eq(seen.length, 3, 'leiratkozás után nincs értesítés');
  // a hibázó figyelő nem állítja meg a többit
  onCraft(w.cs, () => { throw new Error('x'); });
  let got = 0; onCraft(w.cs, () => { got++; });
  frame(w, with0({ interactPressed: true }));
  eq(got, 1); assert(w.cs.lastError);
});

test('craftui: állomás-recept – távoli állomásnál hiba, közelinél megy', () => {
  const w = world();
  addItem(w.inv[0], 'stone', 6); addItem(w.inv[0], 'plank', 4);
  assert(openCraft(w, 0)); release(w);
  pulse(w, { y: 1 });
  eq(w.cs.players[0].rows[w.cs.players[0].cursor].recipe.id.length > 0, true);
  const id0 = w.cs.players[0].id;
  const f = frame(w, with0({ interactPressed: true }));
  eq(f.ev[0].type, 'craft-fail'); eq(f.ev[0].reason, 'station');
  eq(w.cs.players[0].flash.station === 'BENCH' || w.cs.players[0].flash.station === 'KILN', true);
  w.near[0].add('BENCH'); w.near[0].add('KILN');
  frame(w, idle());
  const idx = w.cs.players[0].rows.findIndex(r => r.recipe.id === 'hammer');
  assert(idx >= 0);
  // a kurzort a kalapácsra visszük
  let guard = 0;
  while (w.cs.players[0].id !== 'hammer' && guard++ < 6) pulse(w, { y: w.cs.players[0].cursor < idx ? 1 : -1 });
  eq(w.cs.players[0].id, 'hammer');
  const ok = frame(w, with0({ interactPressed: true }));
  eq(ok.ev[0].type, 'craft'); eq(countItem(w.inv[0], 'hammer'), 1); eq(countItem(w.inv[0], 'plank'), 2); eq(countItem(w.inv[0], 'stone'), 5);
  assert(id0);
});

test('craftui: tele inventory -> hiba, nincs veszteség', () => {
  const w = world();
  w.inv[0] = createInventory(w.itemReg, 1);
  addItem(w.inv[0], 'wood', 99);
  assert(openCraft(w, 0)); release(w);
  const r = frame(w, with0({ interactPressed: true }));
  assert(r.ev[0].type === 'craft' || r.ev[0].reason === 'space');
  assert(countItem(w.inv[0], 'wood') + 2 * countItem(w.inv[0], 'plank') === 99, 'összeg-tartás');
});

test('craftui: két játékos külön fülön; invMenus szűr', () => {
  const w = world();
  addItem(w.inv[0], 'wood', 4); addItem(w.inv[1], 'wood', 2);
  const a = idle(); a[0] = P({ menuPressed: true }); a[1] = P({ menuPressed: true });
  frame(w, a);
  const b = idle(); b[0] = P({ menuPressed: true });
  frame(w, b);
  eq(w.cs.players[0].tab, 'craft'); eq(w.cs.players[1].tab, 'inv');
  const m = invMenus(w.cs, w.menus);
  eq(m.open[0], false); eq(m.open[1], true);
  eq(w.menus.open[0], true, 'az eredeti menü érintetlen');
  release(w);
  frame(w, [P({ interactPressed: true }), P({ interactPressed: true })]);
  eq(countItem(w.inv[0], 'plank'), 1); eq(countItem(w.inv[1], 'plank'), 0, 'az inventory fülön lévő játékos nem craftol');
  eq(craftView(w.cs, 1).total, 0);
});

test('craftui: rajz – panel csak craft fülön, a képen belül, nyelvi kulcsokkal', () => {
  const w = world();
  addItem(w.inv[0], 'wood', 4);
  w.near[0].add('BENCH');
  const players = [{ color: '#58f' }, { color: '#f55' }];
  const tr = (k, p) => k + (p ? JSON.stringify(p) : '');
  let c = fakeCtx();
  eq(drawCraftPanels(c, w.cs, w.menus, players, 960, 540, tr), 0, 'zárt menü');
  assert(openCraft(w, 0)); release(w);
  c = fakeCtx();
  eq(drawCraftPanels(c, w.cs, w.menus, players, 960, 540, tr), 1);
  const texts = c.calls.filter(x => x[0] === 'fillText').map(x => String(x[1]));
  assert(texts.some(s => s.includes('craft.title')), 'cím');
  assert(texts.some(s => s.includes('item.plank')), 'recept-név');
  assert(texts.some(s => s.includes('obj.workbench')), 'állomás-név');
  assert(texts.some(s => s.includes('craft.hint1')), 'súgó');
  for (const i of [0, 1]) {
    const L = craftPanelLayout(i, 960, 540);
    assert(L.x >= 0 && L.y >= 0 && L.x + L.w <= 960 && L.y + L.h <= 540, 'a képen belül');
  }
  assert(craftPanelLayout(1, 960, 540).x > craftPanelLayout(0, 960, 540).x + 256 - 1, 'P2 jobb oldalon');
  // üres lista és hiba-villanás sem dob
  const w2 = world(); w2.recipes.recipes.clear();
  assert(openCraft(w2, 1)); release(w2);
  eq(drawCraftPanels(fakeCtx(), w2.cs, w2.menus, players, 960, 540, tr), 1);
  frame(w, with0({ interactPressed: true }));
  eq(drawCraftPanels(fakeCtx(), w.cs, w.menus, players, 960, 540, tr), 1);
});

test('craftui: hibás bemenet nem dob', () => {
  const w = world();
  for (const raws of [undefined, null, [], [null, undefined], [{}, 5], [P({ x: NaN, y: Infinity }), P({ x: 'a' })]]) {
    routeCraftInputs(w.cs, w.menus, raws);
    stepCraftUi(w.cs, w.menus, raws, w.inv, 1 / 60);
  }
  assert(openCraft(w, 0));
  for (const dt of [NaN, -1, Infinity, 0, undefined, 1e9]) stepCraftUi(w.cs, w.menus, [P({ interactPressed: true }), P()], w.inv, dt);
  stepCraftUi(w.cs, w.menus, idle(), null, 0.016);
  stepCraftUi(w.cs, w.menus, idle(), [undefined, undefined], 0.016);
  stepCraftUi(w.cs, null, idle(), w.inv, 0.016);
  const bad = createCraftUi({ recipes: null, ctxOf: () => { throw new Error('ctx'); } });
  const m = { open: [true, true] };
  bad.players[0].tab = 'craft';
  stepCraftUi(bad, m, [P({ interactPressed: true }), P()], w.inv, 0.016);
  assert(bad.lastError, 'a hibázó ctxOf-ot rögzíti');
  eq(bad.players[0].rows.length, 0);
  const c2 = createCraftUi();
  eq(routeCraftInputs(c2, { open: [false, false] }, idle()).menu.length, 2);
  eq(onCraft(c2, null)(), undefined);
});

test('craftui: 4000 kockás fuzz – kurzor/db érvényes, wood = hozzáadott − 2·plank', () => {
  const w = world();
  let seed = 424242;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let woodAdded = 0, plankMade = 0;
  const bool = p => rnd() < p;
  const axis = () => { const r = rnd(); return r < 0.5 ? 0 : r < 0.6 ? NaN : r < 0.8 ? 1 : -1; };
  for (let f = 0; f < 4000; f++) {
    if (bool(0.02)) { const n = 1 + Math.floor(rnd() * 6); addItem(w.inv[0], 'wood', n); woodAdded += n; }
    if (bool(0.02)) addItem(w.inv[0], 'stone', 1 + Math.floor(rnd() * 3));
    if (bool(0.01)) { if (bool(0.5)) w.near[0].add('BENCH'); else w.near[0].delete('BENCH'); }
    if (bool(0.01)) requestCraftOpen(w.cs, Math.floor(rnd() * 2));
    const raws = [0, 1].map(() => P({
      x: axis(), y: axis(), interactPressed: bool(0.05), ability1Pressed: bool(0.03), ability2Pressed: bool(0.03), menuPressed: bool(0.02),
    }));
    const { ev } = frame(w, raws);
    for (const e of ev) if (e.type === 'craft' && e.made.item === 'plank') plankMade += e.made.n;
    for (let i = 0; i < 2; i++) {
      const ps = w.cs.players[i];
      assert(Number.isInteger(ps.qty) && ps.qty >= 1, 'qty ' + ps.qty);
      assert(ps.cursor >= 0 && (ps.rows.length === 0 || ps.cursor < ps.rows.length), 'kurzor');
      if (ps.rows.length) assert(ps.qty <= Math.max(1, ps.rows[ps.cursor].max), 'qty <= max');
    }
  }
  eq(countItem(w.inv[0], 'wood'), woodAdded - 2 * plankMade, 'wood-összeg');
  assert(countItem(w.inv[0], 'plank') >= 0 && countItem(w.inv[1], 'wood') === 0);
});
