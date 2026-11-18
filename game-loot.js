// game-loot.js (S071) – LOOT-TÁBLÁK: súlyozott, szint-függő drop-táblák ellenséghez és konténerhez; a loot a földre esik.
// Tiszta logika (nincs DOM/canvas). Adat + logika egy fájlban (a 6 fájl/lépés miatt; a régió-táblák S098+ külön data-loot-*.js-be mehetnek).
// Importja: world-noise (mulberry32), game-grounditems (dropItem), game-enemy (onEnemy).
// Tábla: {id, rolls [min,max] (hány húzás), nothing (az "üres" húzás súlya), scale (0..1: a mennyiség szorzója szintenként: 1 + scale·(szint-1)),
//   level (alap-szint, ha a hívó nem ad), always [{item,min,max,chance,levels}] (a húzásoktól független, esélyes tételek),
//   entries [{item,min,max,weight,levels [a,b]|null}] (súlyozott készlet: a szint-ablakon kívüli tétel kiesik)}.
// A gurítás determinisztikus: (seed, key, n) -> ugyanaz; az RNG-fogyasztás állandó (a szint/ablak nem tolja el a sorsolást).
import { mulberry32 } from './world-noise.js';
import { dropItem } from './game-grounditems.js';
import { onEnemy } from './game-enemy.js';

export const LOOT_LIMITS = Object.freeze({ maxRolls: 8, maxEntries: 64, maxAmount: 999, minLevel: 1, maxLevel: 60, maxScale: 1, maxWeight: 1e6, maxDrops: 64, maxEvents: 64, maxContainers: 4096, coord: 1e8 });
export const LOOT_CONFIG = Object.freeze({ spread: 1, pickDelay: 0.35, golden: 2.399963229728653 });

// ---- ADAT (S071 kezdőértékek; csak a jelenlegi tárgyakból: az 1. régió nyersanyagai/állati drop-jai S098-ban jönnek) ----
export const LOOT_DEFS = [
  { id: 'field_rat', rolls: [1, 1], nothing: 6, scale: 0.04, level: 3,
    entries: [{ item: 'fiber', min: 1, max: 2, weight: 3 }, { item: 'herb', min: 1, max: 1, weight: 1 }] },
  { id: 'boar', rolls: [1, 2], nothing: 3, scale: 0.08, level: 7,
    entries: [{ item: 'fiber', min: 1, max: 3, weight: 3 }, { item: 'herb', min: 1, max: 2, weight: 2 },
      { item: 'torch', min: 1, max: 1, weight: 1, levels: [5, 10] }, { item: 'rope', min: 1, max: 1, weight: 1, levels: [6, 10] }] },
  { id: 'grunt', rolls: [1, 2], nothing: 2, scale: 0.05, level: 5, // fejlesztői báb
    entries: [{ item: 'wood', min: 1, max: 3, weight: 3 }, { item: 'torch', min: 1, max: 1, weight: 2 }, { item: 'sickle', min: 1, max: 1, weight: 1, levels: [3, 10] }] },
  { id: 'meadow_crate', rolls: [2, 3], nothing: 0, scale: 0.05, level: 1,
    entries: [{ item: 'wood', min: 2, max: 4, weight: 4 }, { item: 'fiber', min: 2, max: 5, weight: 4 }, { item: 'stone', min: 1, max: 3, weight: 3 },
      { item: 'torch', min: 1, max: 2, weight: 2 }, { item: 'rope', min: 1, max: 1, weight: 1 }] },
  { id: 'meadow_chest', rolls: [3, 4], nothing: 0, scale: 0.05, level: 4,
    always: [{ item: 'torch', min: 1, max: 2, chance: 1 }],
    entries: [{ item: 'rope', min: 1, max: 2, weight: 3 }, { item: 'herb', min: 2, max: 4, weight: 3 }, { item: 'sickle', min: 1, max: 1, weight: 1, levels: [1, 10] },
      { item: 'axe', min: 1, max: 1, weight: 1, levels: [2, 10] }, { item: 'pickaxe', min: 1, max: 1, weight: 1, levels: [3, 10] }] },
];
/** Ellenség-típus -> tábla-id. Új ellenség: ide + a LOOT_DEFS-be (az auditLoot hiányolja). */
export const LOOT_ENEMY = Object.freeze({ field_rat: 'field_rat', boar: 'boar', grunt: 'grunt' });

const fin = v => typeof v === 'number' && Number.isFinite(v);
const isInt = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
const clampLevel = v => (fin(v) ? Math.min(LOOT_LIMITS.maxLevel, Math.max(LOOT_LIMITS.minLevel, Math.round(v))) : null);
const ID_RE = /^[a-z][a-z0-9_]{1,47}$/;
const ITEM_RE = /^[a-z][a-z0-9_]*$/;

function checkRange(r, a, b) { return Array.isArray(r) && r.length === 2 && isInt(r[0], a, b) && isInt(r[1], a, b) && r[0] <= r[1]; }
function checkEntry(e, always) {
  if (!e || typeof e !== 'object' || typeof e.item !== 'string' || !ITEM_RE.test(e.item)) return 'item';
  if (!isInt(e.min, 1, LOOT_LIMITS.maxAmount) || !isInt(e.max, 1, LOOT_LIMITS.maxAmount) || e.min > e.max) return 'amount';
  if (always) { if (e.chance !== undefined && (!fin(e.chance) || e.chance < 0 || e.chance > 1)) return 'chance'; }
  else if (!fin(e.weight) || e.weight <= 0 || e.weight > LOOT_LIMITS.maxWeight) return 'weight';
  if (e.levels !== undefined && e.levels !== null && !checkRange(e.levels, LOOT_LIMITS.minLevel, LOOT_LIMITS.maxLevel)) return 'levels';
  return null;
}

/** -> {ok, table (fagyasztott), error}. Hiányzó mező -> alap; rossz típus/tartomány -> hiba (a mező neve). Sosem dob. */
export function validateLootTable(def) {
  const bad = error => ({ ok: false, table: null, error });
  if (!def || typeof def !== 'object') return bad('def');
  if (typeof def.id !== 'string' || !ID_RE.test(def.id)) return bad('id');
  const rolls = def.rolls === undefined ? [1, 1] : def.rolls;
  if (!checkRange(rolls, 0, LOOT_LIMITS.maxRolls)) return bad(def.id + ':rolls');
  const nothing = def.nothing === undefined ? 0 : def.nothing;
  if (!fin(nothing) || nothing < 0 || nothing > LOOT_LIMITS.maxWeight) return bad(def.id + ':nothing');
  const scale = def.scale === undefined ? 0 : def.scale;
  if (!fin(scale) || scale < 0 || scale > LOOT_LIMITS.maxScale) return bad(def.id + ':scale');
  const level = def.level === undefined ? 1 : def.level;
  if (!isInt(level, LOOT_LIMITS.minLevel, LOOT_LIMITS.maxLevel)) return bad(def.id + ':level');
  const always = def.always === undefined ? [] : def.always, entries = def.entries === undefined ? [] : def.entries;
  if (!Array.isArray(always) || !Array.isArray(entries) || always.length + entries.length > LOOT_LIMITS.maxEntries) return bad(def.id + ':entries');
  for (const a of always) { const er = checkEntry(a, true); if (er) return bad(def.id + ':always.' + er); }
  for (const e of entries) { const er = checkEntry(e, false); if (er) return bad(def.id + ':entries.' + er); }
  if (rolls[1] > 0 && !entries.length && always.length === 0) return bad(def.id + ':empty');
  const fr = list => list.map(x => Object.freeze({ item: x.item, min: x.min, max: x.max, weight: x.weight === undefined ? 0 : x.weight, chance: x.chance === undefined ? 1 : x.chance, levels: x.levels ? Object.freeze([x.levels[0], x.levels[1]]) : null }));
  return { ok: true, error: null, table: Object.freeze({ id: def.id, rolls: Object.freeze([rolls[0], rolls[1]]), nothing, scale, level, always: Object.freeze(fr(always)), entries: Object.freeze(fr(entries)) }) };
}

/** defs: tömb | {id: def}. -> {tables: Map, errors ['hiba'], dups: Set}; a hibás kiesik, a duplikátum felülír. Sosem dob. */
export function createLootRegistry(defs = LOOT_DEFS) {
  const reg = { tables: new Map(), errors: [], dups: new Set() };
  const list = Array.isArray(defs) ? defs : defs && typeof defs === 'object' ? Object.entries(defs).map(([id, d]) => ({ id, ...(d && typeof d === 'object' ? d : {}) })) : [];
  for (const d of list) {
    const r = validateLootTable(d);
    if (!r.ok) { reg.errors.push(r.error); continue; }
    if (reg.tables.has(r.table.id)) reg.dups.add(r.table.id);
    reg.tables.set(r.table.id, r.table);
  }
  return reg;
}
export const getLootTable = (reg, id) => (reg && reg.tables instanceof Map && reg.tables.has(id) ? reg.tables.get(id) : null);

/** Hiányzó hivatkozások -> ['tábla:tárgy' | 'ellenség:notable' | 'ellenség:table']. itemReg: createItemRegistry, enemyReg: createEnemyRegistry. */
export function auditLoot(reg, itemReg, enemyReg, map = LOOT_ENEMY) {
  const out = [];
  for (const t of reg.tables.values()) for (const e of [...t.always, ...t.entries]) if (!itemReg || !itemReg.items.has(e.item)) out.push(t.id + ':' + e.item);
  if (enemyReg) for (const id of enemyReg.enemies.keys()) { if (!map[id]) out.push(id + ':notable'); else if (!reg.tables.has(map[id])) out.push(id + ':table'); }
  return out;
}

function hashStr(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const inWindow = (e, level) => !e.levels || (level >= e.levels[0] && level <= e.levels[1]);

/** Tiszta gurítás: (tábla, {seed, key, n, level}) -> [{item, n}] (összevont, sorrend: első előfordulás). Determinisztikus, hibás bemenet -> []. */
export function rollTable(table, opts) {
  const { seed = 0, key = '', n = 0, level } = opts && typeof opts === 'object' ? opts : {};
  if (!table || !Array.isArray(table.entries) || !Array.isArray(table.always)) return [];
  const lv = clampLevel(level) ?? table.level;
  const rng = mulberry32((hashStr(String(key)) ^ Math.imul((Number(n) | 0) + 1, 0x9e3779b1) ^ (Number(seed) | 0)) >>> 0);
  rng(); rng(); // bemelegítés: a közeli seedek ne korreláljanak
  const mult = 1 + table.scale * (lv - 1), sum = new Map();
  const add = (item, min, max, r) => {
    const base = min + Math.floor(r * (max - min + 1));
    const amount = Math.min(LOOT_LIMITS.maxAmount, Math.max(min, Math.floor(base * mult + 0.5)));
    sum.set(item, Math.min(LOOT_LIMITS.maxAmount, (sum.get(item) || 0) + amount));
  };
  for (const a of table.always) { const r1 = rng(), r2 = rng(); if (inWindow(a, lv) && r1 < a.chance) add(a.item, a.min, a.max, r2); }
  const [rmin, rmax] = table.rolls, rolls = rmin + Math.floor(rng() * (rmax - rmin + 1));
  const pool = table.entries.filter(e => inWindow(e, lv));
  let total = table.nothing; for (const e of pool) total += e.weight;
  for (let i = 0; i < rolls; i++) {
    const pick = rng() * total, r2 = rng();
    if (!(total > 0) || pick < table.nothing) continue;
    let acc = table.nothing, chosen = pool[pool.length - 1];
    for (const e of pool) { acc += e.weight; if (pick < acc) { chosen = e; break; } }
    if (chosen) add(chosen.item, chosen.min, chosen.max, r2);
  }
  return [...sum].map(([item, amount]) => ({ item, n: amount }));
}

/** Loot-rendszer. A számláló (ls.counter) a nem-konténer gurításoknál változatossá teszi az azonos kulcsú (pl. újraszületett) ellenfelet. */
export function createLoot({ reg, seed = 1, cfg } = {}) {
  return { reg: reg && reg.tables instanceof Map ? reg : createLootRegistry(), seed: Number(seed) | 0, cfg: { ...LOOT_CONFIG, ...(cfg && typeof cfg === 'object' ? cfg : {}) }, counter: 0,
    stats: { rolls: 0, empty: 0, drops: 0, units: 0, containers: 0, lost: 0 }, events: [], listeners: new Set(), lastError: null };
}
/** -> leiratkozó. Esemény: {type 'loot', source 'enemy'|'container'|'roll', table, key, level, drops [{item,n}], x, y}. A hibázó figyelő nem állít meg. */
export function onLoot(ls, fn) {
  if (!ls || typeof fn !== 'function') return () => {};
  ls.listeners.add(fn); return () => ls.listeners.delete(fn);
}
function emit(ls, ev) {
  ls.events.push(ev); if (ls.events.length > LOOT_LIMITS.maxEvents) ls.events.shift();
  for (const fn of [...ls.listeners]) { try { fn(ev); } catch (e) { ls.lastError = e; } }
}

/** -> {ok, reason null|'table', drops [{item,n}], level}. opts {key, level, n (rögzített számláló: a konténer ezt használja), source, x, y}. Sosem dob. */
export function rollLoot(ls, tableId, opts = {}) {
  const t = ls && ls.reg ? getLootTable(ls.reg, tableId) : null;
  if (!t) return { ok: false, reason: 'table', drops: [], level: null };
  const o = opts && typeof opts === 'object' ? opts : {};
  const level = clampLevel(o.level) ?? t.level, n = Number.isInteger(o.n) ? o.n : ls.counter++;
  const drops = rollTable(t, { seed: ls.seed, key: o.key === undefined ? tableId : o.key, n, level });
  ls.stats.rolls++; if (!drops.length) ls.stats.empty++;
  for (const d of drops) { ls.stats.drops++; ls.stats.units += d.n; }
  emit(ls, { type: 'loot', source: o.source || 'roll', table: tableId, key: o.key === undefined ? tableId : String(o.key), level, drops: drops.map(d => ({ ...d })), x: fin(o.x) ? o.x : null, y: fin(o.y) ? o.y : null });
  return { ok: true, reason: null, drops, level };
}

/** A gurított tételek a földre (szétszórva, rövid felvétel-késleltetéssel). -> a NEM lerakott egységek száma (0 = minden leesett). */
export function dropLoot(ls, gs, drops, x, y, opts = {}) {
  if (!Array.isArray(drops) || !fin(x) || !fin(y)) return 0;
  const cfg = ls && ls.cfg ? ls.cfg : LOOT_CONFIG, o = opts && typeof opts === 'object' ? opts : {};
  let lost = 0, i = 0;
  const base = fin(o.angle) ? o.angle : (Math.abs(x * 0.013 + y * 0.029) % 1) * Math.PI * 2;
  for (const d of drops.slice(0, LOOT_LIMITS.maxDrops)) {
    if (!d || !Number.isSafeInteger(d.n) || d.n < 1) continue;
    lost += dropItem(gs, d.item, d.n, x, y, { toss: !!cfg.spread, angle: base + i++ * LOOT_CONFIG.golden, delay: fin(o.delay) ? o.delay : cfg.pickDelay, owner: o.owner });
  }
  if (ls && ls.stats) ls.stats.lost += lost;
  return lost;
}

/** Az ellenség szintje a spawn-táblákból: az első találó bejegyzés levels-ének közepe (spawnTables: {régió: {entries [{type,levels}]}}). -> szám | null */
export function spawnLevel(spawnTables, type) {
  if (!spawnTables || typeof spawnTables !== 'object') return null;
  for (const r of Object.values(spawnTables)) for (const e of (r && Array.isArray(r.entries) ? r.entries : [])) {
    if (e && e.type === type && Array.isArray(e.levels) && fin(e.levels[0]) && fin(e.levels[1])) return clampLevel((e.levels[0] + e.levels[1]) / 2);
  }
  return null;
}

/** Egy elhullott ellenség loot-ja: tábla = ctx.map[típus] (alap LOOT_ENEMY), szint = ctx.levelOf(e) | spawn-tábla | a tábla alap-szintje. -> {ok, reason, drops, lost} */
export function enemyLoot(ls, gs, e, ctx = {}) {
  if (!ls || !e || typeof e !== 'object' || !fin(e.x) || !fin(e.y)) return { ok: false, reason: 'enemy', drops: [], lost: 0 };
  const map = ctx.map && typeof ctx.map === 'object' ? ctx.map : LOOT_ENEMY, tid = Object.hasOwn(map, e.type) ? map[e.type] : null;
  if (!tid) return { ok: false, reason: 'none', drops: [], lost: 0 };
  let lv = null; try { lv = typeof ctx.levelOf === 'function' ? clampLevel(ctx.levelOf(e)) : null; } catch (er) { ls.lastError = er; }
  if (lv === null) lv = spawnLevel(ctx.spawnTables, e.type);
  const r = rollLoot(ls, tid, { key: e.type + ':' + (e.spawnId ?? e.id), level: lv, source: 'enemy', x: e.x, y: e.y });
  if (!r.ok) return { ok: false, reason: r.reason, drops: [], lost: 0 };
  return { ok: true, reason: null, drops: r.drops, lost: dropLoot(ls, gs, r.drops, e.x, e.y, ctx) };
}

/** Az ellenség-rendszer 'died' eseményére köt: a loot a holttest helyére esik. ctx {ground, levelOf, spawnTables, map}. -> leiratkozó. */
export function connectLoot(ls, es, ctx = {}) {
  if (!ls || !es) return () => {};
  return onEnemy(es, ev => {
    if (!ev || ev.type !== 'died' || !ev.e) return;
    enemyLoot(ls, ctx.ground, { x: fin(ev.x) ? ev.x : ev.e.x, y: fin(ev.y) ? ev.y : ev.e.y, type: ev.e.type, spawnId: ev.e.spawnId, id: ev.e.id }, ctx);
  });
}

// ---- KONTÉNEREK: egyszer nyitható, a tartalom determinisztikus (seed, id) -> nem függ a nyitás sorrendjétől/számlálótól ----
/** list: [{id, table, x, y, level?}] -> {items: Map, opened: Set, version, errors}. A hibás elem kiesik, a duplikált id felülír. */
export function createContainers(list = [], reg) {
  const cs = { items: new Map(), opened: new Set(), version: 0, errors: [] };
  for (const c of (Array.isArray(list) ? list : [])) {
    const ok = c && typeof c === 'object' && typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 64 && typeof c.table === 'string' && fin(c.x) && fin(c.y)
      && Math.abs(c.x) <= LOOT_LIMITS.coord && Math.abs(c.y) <= LOOT_LIMITS.coord && (!reg || getLootTable(reg, c.table)) && (c.level === undefined || clampLevel(c.level) !== null);
    if (!ok || (cs.items.size >= LOOT_LIMITS.maxContainers && !cs.items.has(c.id))) { cs.errors.push(c && c.id ? String(c.id) : '?'); continue; }
    cs.items.set(c.id, { id: c.id, table: c.table, x: c.x, y: c.y, level: c.level === undefined ? null : clampLevel(c.level) });
  }
  return cs;
}
export function containersNear(cs, x, y, r) {
  const out = [];
  if (cs && cs.items instanceof Map && fin(x) && fin(y) && fin(r)) for (const c of cs.items.values()) if (!cs.opened.has(c.id) && Math.hypot(c.x - x, c.y - y) <= r) out.push(c);
  return out.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) || (a.id < b.id ? -1 : 1));
}
/** Kinyitás: a tartalom a konténer helyére esik. opts {level (felülírja), ground-kezelő ctx: owner/delay}. -> {ok, reason null|'unknown'|'opened'|'table', drops, lost} */
export function openContainer(ls, cs, gs, id, opts = {}) {
  const c = cs && cs.items instanceof Map ? cs.items.get(id) : null;
  if (!c) return { ok: false, reason: 'unknown', drops: [], lost: 0 };
  if (cs.opened.has(id)) return { ok: false, reason: 'opened', drops: [], lost: 0 };
  const o = opts && typeof opts === 'object' ? opts : {};
  const r = rollLoot(ls, c.table, { key: 'c:' + id, n: 0, level: clampLevel(o.level) ?? c.level, source: 'container', x: c.x, y: c.y });
  if (!r.ok) return { ok: false, reason: r.reason, drops: [], lost: 0 };
  cs.opened.add(id); cs.version++; if (ls) ls.stats.containers++;
  return { ok: true, reason: null, drops: r.drops, lost: dropLoot(ls, gs, r.drops, c.x, c.y, o) };
}
export const containerOpened = (cs, id) => !!(cs && cs.opened instanceof Set && cs.opened.has(id));
/** Mentés-alak {v:1, opened:[id]} / visszaállítás (ATOMI, csendes; ismeretlen id kimarad). Az S050-es formátumba kötés külön lépés. */
export function containersState(cs) { return { v: 1, opened: cs && cs.opened instanceof Set ? [...cs.opened].sort() : [] }; }
export function restoreContainers(cs, st) {
  if (!cs || !(cs.items instanceof Map) || !st || typeof st !== 'object' || st.v !== 1 || !Array.isArray(st.opened) || st.opened.some(x => typeof x !== 'string')) return false;
  cs.opened = new Set(st.opened.filter(id => cs.items.has(id))); cs.version++;
  return true;
}
