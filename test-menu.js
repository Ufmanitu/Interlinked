// test-menu.js (S049): egységes menükezelő – extra fülek (térkép, beállítások), körforgás, kontroller-fókusz, rajz. Importja: test-index, game-menu, render-menu.
// A craft/trade útválasztók helyett azok adat-alakját használja (players[i].tab, trade.phase); a menü-állapot a game-hud createMenus alakja ({open:[b,b]}).
import { test, assert, eq as eqStrict } from './test-index.js';
import { MENU_TEXTS, MENU_TABS, MENU_ACTIONS, sanitizeMenuConfig, menuDir, blankMenuRaw, createMenuUi, menuTabActive, maskMenus, routeMenuInputs, applyMenuClose, stepMenuUi, mapView, menuUiView } from './game-menu.js';
import { drawMenuPanels, menuPanelLayout } from './render-menu.js';

// a test-index eq-ja szigorú (===): objektumokra/tömbökre mély összehasonlítás
const eq = (a, b, m = '') => {
  if ((a && typeof a === 'object') || (b && typeof b === 'object')) assert(JSON.stringify(a) === JSON.stringify(b), `${m} várt: ${JSON.stringify(b)}, kapott: ${JSON.stringify(a)}`);
  else eqStrict(a, b, m);
};

const rig = () => {
  const menus = { open: [true, true] };
  const tu = { players: [{ tab: 'inv' }, { tab: 'inv' }] };
  const cs = { players: [{ tab: 'inv' }, { tab: 'inv' }] };
  const trade = { phase: 'idle', from: 0, to: 1 };
  const log = [];
  const mu = createMenuUi({ actions: Object.fromEntries(MENU_ACTIONS.map(id => [id, i => log.push(id + i)])) });
  return { menus, tu, cs, trade, mu, log };
};
const route = (r, raws) => { const o = routeMenuInputs(r.mu, r.tu, r.cs, r.trade, r.menus, raws); return o; };
const press = { menuPressed: true };
const toMap = r => { r.tu.players[0].tab = 'trade'; return route(r, [press, {}]); };
const params = s => (String(s).match(/\{(\w+)\}/g) || []).sort().join();
const fakeCtx = () => {
  const c = { calls: 0 };
  return new Proxy(c, { get: (o, k) => (k in o ? o[k] : (...a) => { o.calls++; }), set: (o, k, v) => { o[k] = v; return true; } });
};

test('menu: szövegek HU/EN azonos kulcsokkal és paraméterekkel', () => {
  eq(Object.keys(MENU_TEXTS.hu).sort(), Object.keys(MENU_TEXTS.en).sort());
  for (const k of Object.keys(MENU_TEXTS.hu)) eq(params(MENU_TEXTS.hu[k]), params(MENU_TEXTS.en[k]));
  for (const id of MENU_TABS) assert(MENU_TEXTS.hu['tab.' + id], 'tab szöveg ' + id);
  for (const id of MENU_ACTIONS) assert(MENU_TEXTS.hu['a.' + id], 'akció szöveg ' + id);
});

test('menu: konfig szorítás, irány, üres bemenet másolat', () => {
  const c = sanitizeMenuConfig({ deadzone: 5, visibleRows: -2, repeatDelay: 'x' });
  assert(c.deadzone <= 0.95 && c.visibleRows >= 1 && c.repeatDelay === 0.3, 'szorítás');
  eq(menuDir(0.2, 0.3, 0.5), { dx: 0, dy: 0 });
  eq(menuDir(0.9, 0.9, 0.5), { dx: 0, dy: 1 });
  eq(menuDir(-0.9, 0.1, 0.5), { dx: -1, dy: 0 });
  eq(menuDir(NaN, undefined, 0.5), { dx: 0, dy: 0 });
  const raw = { x: 1, interact: true, interactPressed: true, menuPressed: true };
  const b = blankMenuRaw(raw);
  assert(b.x === 0 && !b.interact && !b.interactPressed && !b.menuPressed && raw.x === 1 && raw.interactPressed, 'másolat');
  assert(blankMenuRaw(null).x === 0 && blankMenuRaw(7).menuPressed === false, 'hibás bemenet');
});

test('menu: trade fül + menü gomb -> térkép; a régi fülek inv-re állnak, a bemenet üres', () => {
  const r = rig();
  const o = toMap(r);
  eq(r.mu.players[0].tab, 'map');
  eq(r.tu.players[0].tab, 'inv'); eq(r.cs.players[0].tab, 'inv');
  assert(!o.raws[0].menuPressed && o.raws[0].x === 0 && !o.close[0], 'üres bemenet, nincs zárás');
  eq(menuTabActive(r.mu, r.menus, 0), 'map');
  eq(menuTabActive(r.mu, r.menus, 1), null);
  assert(o.raws[1] && o.raws[1] !== o.raws[0], 'a társ bemenete érintetlen');
});

test('menu: térkép -> beállítások -> zár; a zárás menuPressed-et ad a stepMenus-nak', () => {
  const r = rig();
  toMap(r);
  let o = route(r, [press, {}]);
  eq(r.mu.players[0].tab, 'settings');
  assert(!o.close[0], 'még nyitva');
  o = route(r, [{}, {}]);
  eq(r.mu.players[0].tab, 'settings');
  o = route(r, [press, {}]);
  eq(r.mu.players[0].tab, null);
  assert(o.close[0] === true, 'zárás kérve');
  const rt = { menu: [{ x: 1 }, {}], inv: [{}, {}] };
  applyMenuClose(r.mu, rt);
  assert(rt.menu[0].menuPressed === true && rt.menu[0].x === 1 && !rt.menu[1].menuPressed, 'menuPressed a zárandónál');
  assert(applyMenuClose(r.mu, null) === null, 'hibás route nem dob');
});

test('menu: zárt menünél nincs extra fül; trade-ben részt vevőnél megszűnik', () => {
  const r = rig();
  toMap(r);
  r.menus.open[0] = false;
  const raw = { x: 1 };
  const o = route(r, [raw, {}]);
  eq(r.mu.players[0].tab, null);
  assert(o.raws[0] === raw, 'zárva az eredeti objektum');
  r.menus.open[0] = true;
  toMap(r);
  r.trade.phase = 'request';
  const o2 = route(r, [{ interactPressed: true }, {}]);
  eq(r.mu.players[0].tab, null);
  assert(o2.raws[0].interactPressed === true, 'a trade kapja a bemenetet');
});

test('menu: ha nem a trade fülön áll, a menü gomb nem lép a térképre', () => {
  const r = rig();
  r.tu.players[0].tab = 'inv';
  const raw = { menuPressed: true };
  const o = route(r, [raw, {}]);
  assert(o.raws[0] === raw && r.mu.players[0].tab === null, 'érintetlen');
  r.trade.phase = 'open';
  r.tu.players[0].tab = 'trade';
  route(r, [press, {}]);
  eq(r.mu.players[0].tab, null);
});

test('menu: beállítások – kurzor, ismétlés, tartott irány a belépésnél, akciók, hibák', () => {
  const r = rig();
  toMap(r); route(r, [press, {}]); // beállítások, fresh + hold
  const down = { y: 1 };
  stepMenuUi(r.mu, r.menus, [{ ...down, interactPressed: true }, {}], 1 / 60);
  eq(r.mu.players[0].cursor, 0); assert(r.log.length === 0, 'a belépés kockájában nincs művelet');
  route(r, [{}, {}]);
  stepMenuUi(r.mu, r.menus, [down, {}], 1 / 60);
  eq(r.mu.players[0].cursor, 0); // tartott irány elengedésig
  stepMenuUi(r.mu, r.menus, [{}, {}], 1 / 60);
  stepMenuUi(r.mu, r.menus, [down, {}], 1 / 60);
  eq(r.mu.players[0].cursor, 1);
  for (let k = 0; k < 60; k++) stepMenuUi(r.mu, r.menus, [down, {}], 1 / 60);
  assert(r.mu.players[0].cursor > 1 && r.mu.players[0].cursor < MENU_ACTIONS.length, 'ismétlés léptet, nem fordul körbe');
  for (let k = 0; k < 600; k++) stepMenuUi(r.mu, r.menus, [down, {}], 1 / 60);
  eq(r.mu.players[0].cursor, MENU_ACTIONS.length - 1);
  const ev = stepMenuUi(r.mu, r.menus, [{ interactPressed: true }, {}], 1 / 60);
  eq(ev[0], { type: 'action', player: 0, id: MENU_ACTIONS[MENU_ACTIONS.length - 1] });
  eq(r.log, ['log0']);
  r.mu.actions.log = () => { throw new Error('x'); };
  const ev2 = stepMenuUi(r.mu, r.menus, [{ interactPressed: true }, {}], 1 / 60);
  eq(ev2[0].type, 'action-fail'); assert(r.mu.lastError, 'hiba rögzítve'); assert(r.mu.players[0].flash && !r.mu.players[0].flash.ok, 'piros visszajelzés');
  delete r.mu.actions.log;
  eq(stepMenuUi(r.mu, r.menus, [{ interactPressed: true }, {}], 1 / 60)[0].type, 'action-fail');
  for (let k = 0; k < 200; k++) stepMenuUi(r.mu, r.menus, [{}, {}], 1 / 60);
  assert(r.mu.players[0].flash === null, 'a visszajelzés lejár');
});

test('menu: a térképen / zárt menünél / társ fülén nincs akció', () => {
  const r = rig();
  toMap(r);
  eq(stepMenuUi(r.mu, r.menus, [{ interactPressed: true }, { interactPressed: true }], 1 / 60), []);
  route(r, [press, {}]); route(r, [{}, {}]);
  eq(stepMenuUi(r.mu, r.menus, [{}, { interactPressed: true }], 1 / 60), []);
  r.menus.open[0] = false;
  eq(stepMenuUi(r.mu, r.menus, [{ interactPressed: true }, {}], 1 / 60), []);
  assert(r.log.length === 0, 'semmi nem futott');
  eq(stepMenuUi(r.mu, null, null, NaN), []);
});

test('menu: maskMenus – az extra fülön a régi panelek nem rajzolódnak, az eredeti érintetlen', () => {
  const r = rig();
  toMap(r);
  const m = maskMenus(r.mu, r.menus);
  eq(m.open, [false, true]); eq(r.menus.open, [true, true]);
  eq(maskMenus(r.mu, null).open, [false, false]);
});

test('menu: mapView és nézet-modell', () => {
  const p = [{ x: 33, y: 64 * 32 + 5 }, { x: 33 + 96, y: 64 * 32 + 5 }];
  const v = mapView(p, 0);
  eq(v.x, 1); eq(v.y, 64); eq(v.cx, 0); eq(v.cy, 1); eq(v.dist, 3);
  eq(mapView([{ x: -1, y: -1 }, null], 0).dist, null);
  eq(mapView([{ x: -1, y: -1 }], 0).cx, -1);
  eq(mapView([{ x: NaN, y: 0 }, {}], 0), null);
  eq(mapView(null, 0), null);
  const mu = createMenuUi({ actions: { save: () => {} } });
  const view = menuUiView(mu, 0, 'hu');
  eq(view.total, MENU_ACTIONS.length); eq(view.rows[0].params, { lang: 'HU' });
  assert(view.rows.find(x => x.id === 'save').available && !view.rows.find(x => x.id === 'load').available, 'elérhetőség');
  eq(view.tabIndex, -1);
});

test('menu: rajz – panelek száma, elrendezés, hibás bemenet', () => {
  const r = rig();
  const ctx = fakeCtx();
  eq(drawMenuPanels(ctx, r.mu, r.menus, [{ x: 0, y: 0 }, { x: 0, y: 0 }], 960, 540, k => k, 'hu'), 0);
  toMap(r);
  eq(drawMenuPanels(ctx, r.mu, r.menus, [{ x: 40, y: 50 }, { x: 0, y: 0 }], 960, 540, (k, p) => k, 'hu'), 1);
  route(r, [press, {}]);
  r.tu.players[1].tab = 'trade'; route(r, [{}, press]);
  eq(drawMenuPanels(ctx, r.mu, r.menus, [null, { x: 5, y: 5 }], 960, 540, k => k, 'en'), 2);
  const a = menuPanelLayout(0, 960, 540), b = menuPanelLayout(1, 960, 540);
  assert(a.x < b.x && a.y + a.h <= 540 - 8 - 46 && b.x + b.w <= 960, 'a panel a HUD fölött, a vásznon belül');
  assert(ctx.calls > 20, 'rajzolt');
});

test('menu: 4000 kockás fuzz – fül csak nyitott menün, a körforgás zár, nincs kivétel', () => {
  const r = rig();
  r.menus.open = [false, false];
  let seed = 49;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let closes = 0, maps = 0;
  for (let f = 0; f < 4000; f++) {
    const raws = [0, 1].map(() => ({ x: rnd() < .3 ? rnd() * 2 - 1 : 0, y: rnd() < .3 ? rnd() * 2 - 1 : 0, interactPressed: rnd() < .08, menuPressed: rnd() < .06 }));
    for (let i = 0; i < 2; i++) { // a menü-gomb a zárt menüt nyitja, a trade fülre lépést itt szimuláljuk
      if (r.menus.open[i] && !r.mu.players[i].tab && r.tu.players[i].tab === 'inv' && rnd() < .3) r.tu.players[i].tab = 'trade';
    }
    if (rnd() < .01) r.trade.phase = r.trade.phase === 'idle' ? 'open' : 'idle';
    const o = route(r, raws);
    const rt = { menu: o.raws.map(x => ({ ...x })), inv: o.raws };
    applyMenuClose(r.mu, rt);
    for (let i = 0; i < 2; i++) { // a stepMenus: menuPressed váltja a menüt
      if (rt.menu[i].menuPressed) { r.menus.open[i] = !r.menus.open[i]; if (!r.menus.open[i]) { closes++; r.tu.players[i].tab = 'inv'; } }
    }
    stepMenuUi(r.mu, r.menus, raws, 1 / 60);
    for (let i = 0; i < 2; i++) {
      const t = r.mu.players[i].tab;
      if (t) { maps++; assert(r.menus.open[i], 'extra fül csak nyitott menünél'); assert(t === 'map' || t === 'settings', 'érvényes fül'); }
      const c = r.mu.players[i].cursor;
      assert(Number.isInteger(c) && c >= 0 && c < MENU_ACTIONS.length, 'kurzor határon belül');
    }
  }
  assert(closes > 0 && maps > 0, 'a fuzz érintette a fület és a zárást');
});
