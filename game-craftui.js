// S042 – Craft UI logika (tiszta, DOM nélkül).
// A craft-panel a játékos menüjének MÁSODIK füle: menü gomb: zárva -> inventory -> craft -> zár (a körforgást a routeCraftInputs végzi a stepMenus ELŐTT).
// Állomás 'use' interakció: requestCraftOpen -> a következő kockában a menü a craft fülön nyílik.
// Lista: kézzel craftolható + a közeli állomások receptjei elöl, a többi (távoli állomás) szürkén a végén.
import { craftList, craft } from './game-crafting.js';
import { countItem } from './game-inventory.js';

export const CRAFTUI_CONFIG = Object.freeze({ visibleRows: 5, deadzone: 0.5, repeatDelay: 0.3, repeatRate: 0.1, flash: 1.4, maxQty: 99 });
export const CRAFT_REASONS = Object.freeze(['items', 'station', 'skill', 'space', 'times', 'recipe']);

// prefix: 'craft.' (registerTexts(CRAFTUI_TEXTS, 'craft.')); a paraméterek HU/EN azonosak
export const CRAFTUI_TEXTS = {
  hu: {
    title: 'Craftolás',
    st: 'Állomás: {list}',
    nost: 'Nincs közeli állomás',
    qty: '{n} / {max} db',
    makes: '{name} ×{n}',
    none: 'Nincs elérhető recept',
    ok: 'Mehet a craftolás',
    done: 'Kész: {name} ×{n}',
    hint1: 'Fel/le recept · Bal/jobb db',
    hint2: 'Interakció craft · 1.kép max · Menü',
    'r.items': 'Hiányzó összetevők',
    'r.station': 'Állomás kell: {name}',
    'r.skill': 'Szakma-szint kell: {level}',
    'r.space': 'Nincs elég hely',
    'r.times': 'Hibás mennyiség',
    'r.recipe': 'Ismeretlen recept',
    'r.other': 'Nem sikerült',
  },
  en: {
    title: 'Crafting',
    st: 'Station: {list}',
    nost: 'No station nearby',
    qty: '{n} / {max} pcs',
    makes: '{name} ×{n}',
    none: 'No recipes available',
    ok: 'Ready to craft',
    done: 'Crafted: {name} ×{n}',
    hint1: 'Up/down recipe · Left/right qty',
    hint2: 'Interact craft · Abil.1 max · Menu',
    'r.items': 'Missing ingredients',
    'r.station': 'Needs station: {name}',
    'r.skill': 'Skill level needed: {level}',
    'r.space': 'Not enough space',
    'r.times': 'Invalid amount',
    'r.recipe': 'Unknown recipe',
    'r.other': 'Failed',
  },
};

export function sanitizeCraftUiConfig(src) {
  const o = { ...CRAFTUI_CONFIG };
  if (src && typeof src === 'object') {
    for (const k of Object.keys(o)) {
      const v = src[k];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) o[k] = v;
    }
  }
  o.visibleRows = Math.max(1, Math.floor(o.visibleRows));
  o.maxQty = Math.max(1, Math.floor(o.maxQty));
  o.deadzone = Math.min(o.deadzone, 0.95);
  return Object.freeze(o);
}

export function reasonKey(reason) {
  return 'craft.r.' + (CRAFT_REASONS.includes(reason) ? reason : 'other');
}

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const menuIsOpen = (menus, i) => !!(menus && menus.open && menus.open[i]);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// domináns tengely (azonos tengelyen y nyer), holtsáv alatt nincs irány
export function craftDir(x, y, dz) {
  const ax = num(x), ay = num(y);
  if (Math.abs(ax) < dz && Math.abs(ay) < dz) return { dx: 0, dy: 0 };
  if (Math.abs(ax) > Math.abs(ay)) return { dx: Math.sign(ax), dy: 0 };
  return { dx: 0, dy: Math.sign(ay) };
}

// a nyers bemenet másolata, a craft-fülön az inventory-rendszerek ezt kapják (nincs mozgás/jelölés/eldobás/felállítás)
export function blankRaw(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    ...r, x: 0, y: 0, interact: false, ability1: false, ability2: false,
    interactPressed: false, ability1Pressed: false, ability2Pressed: false, menuPressed: false,
  };
}

// a kurzor körüli ablak (a kurzor középen, a végeken megáll)
export function scrollFirst(cursor, total, visible) {
  if (!(total > visible)) return 0;
  const f = Math.floor(num(cursor) - visible / 2 + 0.5);
  return Math.min(Math.max(0, f), total - visible);
}

function mkPlayer() {
  return { tab: 'inv', cursor: 0, id: null, qty: 1, rows: [], tags: [], hold: false, dx: 0, dy: 0, t: 0, flash: null, fresh: false };
}

export function createCraftUi(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  return {
    recipes: o.recipes || null,
    ctxOf: typeof o.ctxOf === 'function' ? o.ctxOf : () => ({}),
    tagKey: typeof o.tagKey === 'function' ? o.tagKey : null, // állomás-TAG -> szöveg-kulcs (a rajzhoz)
    cfg: sanitizeCraftUiConfig(o.cfg),
    pending: [false, false],
    players: [mkPlayer(), mkPlayer()],
    events: [],
    listeners: [],
    lastError: null,
    crafts: 0,
  };
}

// az állomás 'use' interakciója: a játékos menüje a craft fülön nyílik (zárt menünél a következő kockában)
export function requestCraftOpen(cs, i) {
  if (!cs || !Number.isInteger(i) || i < 0 || i > 1) return false;
  cs.pending[i] = true;
  return true;
}

// esemény: {type 'craft', player, recipe, times, made, used} | {type 'craft-fail', player, recipe, reason}; az S045 (XP) erre köt
export function onCraft(cs, fn) {
  if (!cs || typeof fn !== 'function') return () => {};
  cs.listeners.push(fn);
  return () => { const k = cs.listeners.indexOf(fn); if (k >= 0) cs.listeners.splice(k, 1); };
}

function emit(cs, ev) {
  cs.events.push(ev);
  for (const fn of cs.listeners.slice()) {
    try { fn(ev); } catch (e) { cs.lastError = e; }
  }
}

export function craftTabActive(cs, menus, i) {
  return !!(cs && cs.players[i] && cs.players[i].tab === 'craft' && menuIsOpen(menus, i));
}

// a drawInventories-nek: a craft fülön lévő játékos inventory-panelje nem rajzolódik
export function invMenus(cs, menus) {
  const open = [0, 1].map(i => menuIsOpen(menus, i) && !craftTabActive(cs, menus, i));
  return Object.assign({}, menus, { open });
}

// A stepMenus ELŐTT hívandó: -> {menu: [raw,raw] a stepMenus-nak, inv: [raw,raw] a drop/place/invUi-nak}
export function routeCraftInputs(cs, menus, raws) {
  const menu = [], inv = [];
  for (let i = 0; i < 2; i++) {
    const raw = raws && raws[i] && typeof raws[i] === 'object' ? raws[i] : {};
    const ps = cs.players[i];
    let mr = raw, ir = raw;
    ps.fresh = false;
    if (!menuIsOpen(menus, i)) {
      ps.tab = 'inv';
      if (cs.pending[i]) {
        cs.pending[i] = false;
        mr = { ...raw, menuPressed: true };
        ps.tab = 'craft';
        ps.fresh = true;
        startHold(ps);
      }
    } else if (raw.menuPressed) {
      if (ps.tab === 'inv') { // inventory -> craft: a menü nyitva marad
        ps.tab = 'craft';
        ps.fresh = true;
        startHold(ps);
        mr = { ...raw, menuPressed: false };
      } else { // craft -> zár
        ps.tab = 'inv';
      }
      ir = blankRaw(raw);
    } else if (ps.tab === 'craft') {
      ir = blankRaw(raw);
    }
    if (ps.tab === 'craft' && !menuIsOpen(menus, i)) ir = blankRaw(raw);
    menu.push(mr);
    inv.push(ir);
  }
  return { menu, inv };
}

function startHold(ps) {
  ps.hold = true; ps.dx = 0; ps.dy = 0; ps.t = 0; ps.qty = 1;
}

export function nearbyTags(ctx) {
  const s = ctx && ctx.stations;
  let list = [];
  if (s instanceof Set) list = Array.from(s);
  else if (Array.isArray(s)) list = s.slice();
  return list.filter(x => typeof x === 'string' && x).sort();
}

function makeRow(e, inv, st, near) {
  const rec = e.recipe;
  return {
    recipe: rec,
    craftable: !!e.craftable,
    reason: e.craftable ? null : (e.reason || 'other'),
    missing: Array.isArray(e.missing) ? e.missing : [],
    max: Number.isFinite(e.max) ? Math.max(0, Math.floor(e.max)) : 0,
    station: st,
    near: st === null || near.has(st),
    inputs: (rec.inputs || []).map(x => ({ item: x.item, need: x.n, have: countItem(inv, x.item) })),
  };
}

// minden recept: [kézzel] + [közeli állomások] + [távoli állomások], csoportonként id szerint (a craftList sorrendje)
export function buildCraftRows(reg, inv, ctx) {
  if (!reg || !reg.recipes || typeof reg.recipes.values !== 'function' || !inv) return [];
  const seen = new Set(), tags = [];
  for (const r of reg.recipes.values()) {
    const s = r && r.station;
    if (s && !seen.has(s)) { seen.add(s); tags.push(s); }
  }
  const near = new Set(nearbyTags(ctx));
  tags.sort((a, b) => (near.has(a) ? 0 : 1) - (near.has(b) ? 0 : 1) || (a < b ? -1 : a > b ? 1 : 0));
  const rows = [];
  for (const st of [null, ...tags]) {
    let list = [];
    try { list = craftList(reg, inv, ctx, st) || []; } catch (e) { list = []; }
    for (const e of list) if (e && e.recipe) rows.push(makeRow(e, inv, st, near));
  }
  return rows;
}

function safeCtx(cs, i) {
  try { return cs.ctxOf(i) || {}; } catch (e) { cs.lastError = e; return {}; }
}

function refreshRows(cs, ps, inv, ctx) {
  const rows = buildCraftRows(cs.recipes, inv, ctx);
  ps.rows = rows;
  ps.tags = nearbyTags(ctx);
  if (!rows.length) { ps.cursor = 0; ps.id = null; ps.qty = 1; return; }
  let idx = ps.id != null ? rows.findIndex(r => r.recipe.id === ps.id) : -1;
  if (idx < 0) idx = clamp(Math.floor(num(ps.cursor)), 0, rows.length - 1);
  ps.cursor = idx;
  ps.id = rows[idx].recipe.id;
  ps.qty = clamp(Math.floor(num(ps.qty)) || 1, 1, Math.max(1, Math.min(rows[idx].max, cs.cfg.maxQty)));
}

// tartott irány: azonnali + repeatDelay + repeatRate ismétlés; nyitáskor tartott iránynál elengedésig nincs művelet
function navStep(ps, dir, d, cfg) {
  if (dir.dx === 0 && dir.dy === 0) { ps.hold = false; ps.dx = 0; ps.dy = 0; ps.t = 0; return null; }
  if (ps.hold) return null;
  if (dir.dx !== ps.dx || dir.dy !== ps.dy) { ps.dx = dir.dx; ps.dy = dir.dy; ps.t = cfg.repeatDelay; return dir; }
  ps.t -= d;
  if (ps.t <= 0) { ps.t = cfg.repeatRate; return dir; }
  return null;
}

function doCraft(cs, i, ps, inv, ctx, row, n) {
  const rec = row.recipe;
  let res = null;
  try { res = craft(inv, rec, ctx, n); } catch (e) { cs.lastError = e; }
  const skillLevel = rec.skill ? rec.skill.level : 0;
  if (res && res.ok && res.made) {
    cs.crafts++;
    ps.flash = { ok: true, item: res.made.item, n: res.made.n, t: cs.cfg.flash };
    emit(cs, { type: 'craft', player: i, recipe: rec.id, times: n, made: res.made, used: res.used || [] });
  } else {
    const reason = res && res.reason ? res.reason : 'other';
    ps.flash = { ok: false, reason, station: row.station, level: skillLevel, t: cs.cfg.flash };
    emit(cs, { type: 'craft-fail', player: i, recipe: rec.id, reason });
  }
  refreshRows(cs, ps, inv, ctx);
}

// A stepMenus UTÁN: a NYERS bemenettel (a craft fülön lévő játékosoknál); -> a kocka eseményei
export function stepCraftUi(cs, menus, raws, inventories, dt) {
  const out = [];
  cs.events = out;
  const d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
  for (let i = 0; i < 2; i++) {
    const ps = cs.players[i];
    if (ps.flash) { ps.flash.t -= d; if (ps.flash.t <= 0) ps.flash = null; }
    const inv = inventories && inventories[i];
    if (!craftTabActive(cs, menus, i) || !inv) { ps.rows = []; continue; }
    const ctx = safeCtx(cs, i);
    refreshRows(cs, ps, inv, ctx);
    if (ps.fresh) continue; // a váltás kockájában nincs művelet
    const raw = raws && raws[i] && typeof raws[i] === 'object' ? raws[i] : {};
    const mv = navStep(ps, craftDir(raw.x, raw.y, cs.cfg.deadzone), d, cs.cfg);
    const len = ps.rows.length;
    if (mv && len) {
      if (mv.dy) {
        const c = clamp(ps.cursor + mv.dy, 0, len - 1);
        if (c !== ps.cursor) { ps.cursor = c; ps.id = ps.rows[c].recipe.id; ps.qty = 1; }
      }
      if (mv.dx) {
        const mx = Math.max(1, Math.min(ps.rows[ps.cursor].max, cs.cfg.maxQty));
        ps.qty = clamp(ps.qty + mv.dx, 1, mx);
      }
    }
    if (len && (raw.interactPressed || raw.ability1Pressed)) {
      const row = ps.rows[ps.cursor];
      if (row.craftable) {
        const n = raw.interactPressed ? ps.qty : Math.min(row.max, cs.cfg.maxQty);
        doCraft(cs, i, ps, inv, ctx, row, Math.max(1, Math.floor(n)));
      } else {
        const rec = row.recipe;
        ps.flash = { ok: false, reason: row.reason || 'other', station: row.station, level: rec.skill ? rec.skill.level : 0, t: cs.cfg.flash };
        emit(cs, { type: 'craft-fail', player: i, recipe: rec.id, reason: row.reason || 'other' });
      }
    } else if (raw.ability2Pressed) {
      ps.qty = 1;
    }
  }
  return out;
}

// nézet-modell a rajzhoz
export function craftView(cs, i) {
  const ps = cs.players[i];
  const total = ps.rows.length;
  return {
    tab: ps.tab, rows: ps.rows, total, cursor: ps.cursor, qty: ps.qty, tags: ps.tags, flash: ps.flash,
    visible: cs.cfg.visibleRows, first: scrollFirst(ps.cursor, total, cs.cfg.visibleRows),
  };
}
