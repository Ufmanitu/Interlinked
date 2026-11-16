// game-menu.js (S049) – egységes menükezelő: a játékos menü-fülei: inventory -> craft -> trade -> TÉRKÉP -> BEÁLLÍTÁSOK -> zár.
// Tiszta logika (nincs DOM/canvas, nincs import). A meglévő fülek (S035/S042/S044) állapota a saját rendszerükben marad; ez a modul
// a trade fül UTÁNI két új fület és a bezárást kezeli, a bemenetet a lánc elejére szűrve (routeMenuInputs). Nincs pause: a karakter áll, de húzható.
// Kontroller-fókusz: fel/le = kurzor (holtsáv + ismétlés), interakció = végrehajt, menü gomb = következő fül.

export const MENU_CONFIG = Object.freeze({ deadzone: 0.5, repeatDelay: 0.3, repeatRate: 0.1, visibleRows: 6, flash: 1.6, tile: 32, chunkTiles: 64 });
export const MENU_TABS = Object.freeze(['inv', 'craft', 'trade', 'map', 'settings']);
export const MENU_EXTRA = Object.freeze(['map', 'settings']);
export const MENU_ACTIONS = Object.freeze(['lang', 'save', 'load', 'export', 'import', 'log']);

// prefix: 'menu.' (registerTexts(MENU_TEXTS, 'menu.')); a paraméterek HU/EN azonosak
export const MENU_TEXTS = {
  hu: {
    'tab.inv': 'Tárgyak', 'tab.craft': 'Craft', 'tab.trade': 'Csere', 'tab.map': 'Térkép', 'tab.settings': 'Beállítások',
    'map.player': 'Játékos {n}', 'map.pos': 'Hely: {x}, {y} (tile)', 'map.chunk': 'Chunk: {cx}, {cy}', 'map.dist': 'A társ távolsága: {d} tile',
    'map.none': 'Nincs adat', 'map.hint': 'Menü: tovább a beállításokhoz',
    'set.hint1': 'Fel/le választ · Interakció: indít', 'set.hint2': 'Menü: bezár',
    'a.lang': 'Nyelv: {lang}', 'a.save': 'Mentés (F2)', 'a.load': 'Betöltés (F3)', 'a.export': 'Mentés másolása (F4)',
    'a.import': 'Betöltés beillesztésből (F7)', 'a.log': 'Napló másolása (F6)',
    ok: 'Kész', fail: 'Nem sikerült', na: 'Nem elérhető',
  },
  en: {
    'tab.inv': 'Items', 'tab.craft': 'Craft', 'tab.trade': 'Trade', 'tab.map': 'Map', 'tab.settings': 'Settings',
    'map.player': 'Player {n}', 'map.pos': 'Position: {x}, {y} (tiles)', 'map.chunk': 'Chunk: {cx}, {cy}', 'map.dist': 'Partner distance: {d} tiles',
    'map.none': 'No data', 'map.hint': 'Menu: on to settings',
    'set.hint1': 'Up/down select · Interact: run', 'set.hint2': 'Menu: close',
    'a.lang': 'Language: {lang}', 'a.save': 'Save (F2)', 'a.load': 'Load (F3)', 'a.export': 'Copy save (F4)',
    'a.import': 'Load from pasted text (F7)', 'a.log': 'Copy activity log (F6)',
    ok: 'Done', fail: 'Failed', na: 'Unavailable',
  },
};

const fin = v => typeof v === 'number' && Number.isFinite(v);
const num = v => (fin(v) ? v : 0);
const isObj = v => !!v && typeof v === 'object';
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const menuIsOpen = (menus, i) => !!(menus && menus.open && menus.open[i]);

export function sanitizeMenuConfig(src) {
  const o = { ...MENU_CONFIG };
  if (isObj(src)) for (const k of Object.keys(o)) { const v = src[k]; if (fin(v) && v > 0) o[k] = v; }
  o.visibleRows = Math.max(1, Math.floor(o.visibleRows));
  o.chunkTiles = Math.max(1, Math.floor(o.chunkTiles));
  o.deadzone = Math.min(o.deadzone, 0.95);
  return Object.freeze(o);
}

/** Domináns tengely (azonos tengelyen y nyer), holtsáv alatt nincs irány. */
export function menuDir(x, y, dz) {
  const ax = num(x), ay = num(y);
  if (Math.abs(ax) < dz && Math.abs(ay) < dz) return { dx: 0, dy: 0 };
  if (Math.abs(ax) > Math.abs(ay)) return { dx: Math.sign(ax), dy: 0 };
  return { dx: 0, dy: Math.sign(ay) };
}

/** A nyers bemenet másolata mozgás/interakció/képesség/menü nélkül (az eredetit nem módosítja). */
export function blankMenuRaw(raw) {
  return {
    ...(isObj(raw) ? raw : {}), x: 0, y: 0, interact: false, ability1: false, ability2: false,
    interactPressed: false, ability1Pressed: false, ability2Pressed: false, menuPressed: false,
  };
}

const mkPlayer = () => ({ tab: null, cursor: 0, dx: 0, dy: 0, t: 0, hold: false, fresh: false, flash: null });

/** opts: {actions: {lang,save,load,export,import,log: fn(playerIndex)}, cfg}. */
export function createMenuUi(opts) {
  const o = isObj(opts) ? opts : {};
  return {
    cfg: sanitizeMenuConfig(o.cfg), actions: isObj(o.actions) ? { ...o.actions } : {},
    players: [mkPlayer(), mkPlayer()], close: [false, false], events: [], lastError: null,
  };
}

/** A játékos aktuális extra füle ('map'|'settings') ha a menüje nyitva van, különben null. */
export function menuTabActive(mu, menus, i) {
  const ps = mu && mu.players && mu.players[i];
  return ps && ps.tab && menuIsOpen(menus, i) ? ps.tab : null;
}

/** A rajzhoz: az extra fülön lévő játékosnál a régi menü-panelek (váz, inventory, craft) nem rajzolódnak (másolat). */
export function maskMenus(mu, menus) {
  const open = [0, 1].map(i => menuIsOpen(menus, i) && !menuTabActive(mu, menus, i));
  return Object.assign({}, menus, { open });
}

function startHold(ps) { ps.hold = true; ps.dx = 0; ps.dy = 0; ps.t = 0; }

/**
 * A routeTradeInputs/routeCraftInputs ELŐTT hívandó. -> {raws, close}: a láncnak adandó bemenetek (az extra fülön üres), close[i] = a menüt zárni kell
 * (az applyMenuClose a route.menu-ba menuPressed-et tesz). Trade fül + menü gomb: továbblép a térképre (a trade/craft fül 'inv'-re áll);
 * térkép -> beállítások -> zár. Ha a játékos trade-ben vesz részt, az extra fül megszűnik (a kérés/csere a trade-é).
 */
export function routeMenuInputs(mu, tu, cs, trade, menus, raws) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    const raw = isObj(raws && raws[i]) ? raws[i] : {};
    const ps = mu.players[i];
    ps.fresh = false;
    mu.close[i] = false;
    if (!menuIsOpen(menus, i)) { ps.tab = null; out.push(raw); continue; }
    const busy = !!trade && trade.phase !== 'idle' && (i === trade.from || i === trade.to);
    if (ps.tab && busy) ps.tab = null;
    if (ps.tab) {
      if (raw.menuPressed) {
        if (ps.tab === 'map') { ps.tab = 'settings'; ps.cursor = 0; startHold(ps); ps.fresh = true; }
        else { ps.tab = null; mu.close[i] = true; }
      }
      out.push(blankMenuRaw(raw));
      continue;
    }
    const tp = tu && tu.players && tu.players[i];
    if (!busy && raw.menuPressed && tp && tp.tab === 'trade') {
      tp.tab = 'inv';
      const cp = cs && cs.players && cs.players[i];
      if (cp) cp.tab = 'inv';
      ps.tab = 'map'; ps.cursor = 0; startHold(ps); ps.fresh = true;
      out.push(blankMenuRaw(raw));
      continue;
    }
    out.push(raw);
  }
  return { raws: out, close: mu.close.slice() };
}

/** A routeCraftInputs eredményére: a zárást kérő játékosnál a menu-bemenet menuPressed-et kap (a stepMenus bezárja). */
export function applyMenuClose(mu, route) {
  if (!route || !Array.isArray(route.menu)) return route;
  for (let i = 0; i < 2; i++) {
    if (!mu.close[i]) continue;
    route.menu[i] = { ...(isObj(route.menu[i]) ? route.menu[i] : {}), menuPressed: true };
    mu.close[i] = false;
  }
  return route;
}

function navStep(ps, dir, d, cfg) {
  if (!dir.dx && !dir.dy) { ps.hold = false; ps.dx = 0; ps.dy = 0; ps.t = 0; return null; }
  if (ps.hold) return null;
  if (dir.dx !== ps.dx || dir.dy !== ps.dy) { ps.dx = dir.dx; ps.dy = dir.dy; ps.t = cfg.repeatDelay; return dir; }
  ps.t -= d;
  if (ps.t <= 0) { ps.t = cfg.repeatRate; return dir; }
  return null;
}

/** A stepMenus UTÁN, a NYERS (szűretlen) bemenettel; -> a kocka eseményei [{type 'action'|'action-fail', player, id}]. */
export function stepMenuUi(mu, menus, raws, dt) {
  const out = [];
  mu.events = out;
  const d = fin(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
  for (let i = 0; i < 2; i++) {
    const ps = mu.players[i];
    if (ps.flash) { ps.flash.t -= d; if (ps.flash.t <= 0) ps.flash = null; }
    if (menuTabActive(mu, menus, i) !== 'settings' || ps.fresh) continue;
    const raw = isObj(raws && raws[i]) ? raws[i] : {};
    const mv = navStep(ps, menuDir(raw.x, raw.y, mu.cfg.deadzone), d, mu.cfg);
    if (mv && mv.dy) ps.cursor = clamp(ps.cursor + mv.dy, 0, MENU_ACTIONS.length - 1);
    if (!raw.interactPressed) continue;
    const id = MENU_ACTIONS[ps.cursor], fn = mu.actions[id];
    if (typeof fn !== 'function') { ps.flash = { ok: false, key: 'menu.na', t: mu.cfg.flash }; out.push({ type: 'action-fail', player: i, id }); continue; }
    try { fn(i); ps.flash = { ok: true, key: 'menu.ok', t: mu.cfg.flash }; out.push({ type: 'action', player: i, id }); }
    catch (e) { mu.lastError = e; ps.flash = { ok: false, key: 'menu.fail', t: mu.cfg.flash }; out.push({ type: 'action-fail', player: i, id }); }
  }
  return out;
}

function firstRow(cursor, total, visible) {
  if (!(total > visible)) return 0;
  return Math.min(Math.max(0, Math.floor(num(cursor) - visible / 2 + 0.5)), total - visible);
}

/** A játékos térkép-adata: tile- és chunk-koordináta, a társ távolsága tile-ban (hibás játékos -> null). */
export function mapView(players, i, cfg = MENU_CONFIG) {
  const a = players && players[i], b = players && players[1 - i];
  if (!a || !fin(a.x) || !fin(a.y)) return null;
  const x = Math.floor(a.x / cfg.tile), y = Math.floor(a.y / cfg.tile);
  const dist = b && fin(b.x) && fin(b.y) ? Math.round(Math.hypot(a.x - b.x, a.y - b.y) / cfg.tile * 10) / 10 : null;
  return { x, y, cx: Math.floor(x / cfg.chunkTiles), cy: Math.floor(y / cfg.chunkTiles), dist };
}

/** Nézet-modell a rajzhoz (fül, fül-sáv, beállítás-sorok, kurzor, visszajelzés). */
export function menuUiView(mu, i, lang = 'hu') {
  const ps = mu.players[i];
  const rows = MENU_ACTIONS.map(id => ({
    id, key: 'menu.a.' + id, params: id === 'lang' ? { lang: String(lang).toUpperCase() } : undefined, available: typeof mu.actions[id] === 'function',
  }));
  return {
    tab: ps.tab, tabs: MENU_TABS, tabIndex: ps.tab ? MENU_TABS.indexOf(ps.tab) : -1, rows, total: rows.length, cursor: ps.cursor,
    visible: mu.cfg.visibleRows, first: firstRow(ps.cursor, rows.length, mu.cfg.visibleRows), flash: ps.flash,
  };
}
