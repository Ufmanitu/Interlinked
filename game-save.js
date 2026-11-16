// S032: mentés — verziózott JSON (localStorage + szöveges export/import), billentyűk és értesítés.
// Tiszta logika (nincs DOM/canvas függés; a tároló, a vágólap és a kérdés injektálható). A rajz a main.js-ben van.
// ctx = {players[2], clock, sorsko, seed} + (S050, opcionális) {inventories, wallets, skills, prog, nodes, stations, professions}: a mentett állapot ezekből áll
// (játékos-pozíciók, világ-seed, GameClock, Sorskő-szint, inventory, pénz, skillek, szint, kitermelt node-ok, lerakott állomások, szakmák; lásd SECTIONS).
import { clockState, restoreClock } from './game-clock.js';
import { sorskoState, restoreSorsko } from './game-sorsko.js';
import { inventoryState, restoreInventory } from './game-inventory.js';
import { walletState, restoreWallet } from './game-wallet.js';
import { skillState, restoreSkills } from './game-skills.js';
import { progressionState, restoreProgression } from './game-curve.js';
import { nodeState, restoreNodes } from './game-nodes.js';
import { stationState, restoreStations } from './game-stations.js';
import { professionState, restoreProfessions } from './game-professions.js';


// --- S050: a mentés bővítése: inventory, pénz, skillek, karakter-szint, kitermelt node-ok, lerakott állomások, szakmák ---
// A szekciók a ctx opcionális mezői: ha a ctx-ben nincs meg a célrendszer, a szekció nem kerül a mentésbe / a betöltés kihagyja.
// A visszatöltés szekciónként atomi; a teljes betöltés atomitását az applySave rollback-je adja (az előző állapot visszaírása).
const isArr = Array.isArray;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const pair = v => isArr(v) && v.length === 2 && v.every(isObj);
const clockT = c => (c.clock && typeof c.clock.t === 'number' && isFinite(c.clock.t) ? c.clock.t : 0);
const two = a => isArr(a) && a.length >= 2;

// key: a mentés-objektum kulcsa; err: hibakód; has(ctx): van-e célrendszer; cap(ctx): állapot; ok(d): szerkezet; put(ctx, d): visszatöltés -> bool
export const SECTIONS = [
  { key: 'inv', err: 'inventory', has: c => two(c.inventories), cap: c => c.inventories.slice(0, 2).map(inventoryState), ok: pair,
    put: (c, d) => restoreInventory(c.inventories[0], d[0]) && restoreInventory(c.inventories[1], d[1]) },
  { key: 'wal', err: 'wallet', has: c => two(c.wallets), cap: c => c.wallets.slice(0, 2).map(walletState), ok: pair,
    put: (c, d) => restoreWallet(c.wallets[0], d[0]) && restoreWallet(c.wallets[1], d[1]) },
  { key: 'skl', err: 'skills', has: c => isObj(c.skills), cap: c => skillState(c.skills), ok: isObj, put: (c, d) => restoreSkills(c.skills, d) },
  { key: 'prog', err: 'prog', has: c => isObj(c.prog), cap: c => progressionState(c.prog), ok: isObj, put: (c, d) => restoreProgression(c.prog, d) },
  // a node-ok hátralévő újranövési ideje a játékórához képest mentett, ezért a visszatöltés az óra visszaírása UTÁN fut
  { key: 'nod', err: 'nodes', has: c => isObj(c.nodes) && isObj(c.nodes.os), cap: c => nodeState(c.nodes, clockT(c)), ok: isObj, put: (c, d) => restoreNodes(c.nodes, d, clockT(c)) },
  { key: 'stn', err: 'stations', has: c => isObj(c.stations), cap: c => stationState(c.stations), ok: isObj, put: (c, d) => restoreStations(c.stations, d) },
  { key: 'prof', err: 'professions', has: c => isObj(c.professions), cap: c => professionState(c.professions), ok: isObj, put: (c, d) => restoreProfessions(c.professions, d) },
];
export const EXTRA_ERRORS = SECTIONS.map(s => s.err);

// A ctx-ben jelen lévő rendszerek állapota (mély, JSON-barát). Egy szekció hibája nem dobja el a többit.
export function captureExtras(ctx) {
  const out = {};
  for (const s of SECTIONS) {
    try { if (s.has(ctx)) out[s.key] = s.cap(ctx); } catch (e) { /* a szekció kimarad; a többi mentése nem akad el */ }
  }
  return out;
}

// A mentésben jelen lévő szekciók szerkezete (a ctx-től függetlenül) -> hibakód | null. A hiányzó szekció (régi mentés) rendben van.
export function checkExtras(d) {
  if (!isObj(d)) return null;
  for (const s of SECTIONS) if (d[s.key] !== undefined && !s.ok(d[s.key])) return s.err;
  return null;
}

// Visszatöltés: csak ott, ahol a mentésben és a ctx-ben is van szekció. -> hibakód | null (az első hibánál megáll; a hívó rollback-el)
export function applyExtras(ctx, d) {
  for (const s of SECTIONS) {
    if (!isObj(d) || d[s.key] === undefined) continue;
    let has = false, ok = false;
    try { has = s.has(ctx); ok = !has || s.put(ctx, d[s.key]) === true; } catch (e) { ok = false; }
    if (has && !ok) return s.err;
  }
  return null;
}

export const SAVE_VERSION = 2;
export const SAVE_MAGIC = 'interlinked-save';
export const SAVE_KEY = 'interlinked.save';
export const SAVE_LIMITS = { maxText: 1000000, maxCoord: 1e8 };
export const SAVE_TOAST_TIME = 2.5; // mp
// Migrációs hook: MIGRATIONS[n](adat) a v=n mentést v=n+1 alakra hozza (új verziónál ide kerül a lépés + SAVE_VERSION nő).
// v1 -> v2 (S050): a bővítő szekciók opcionálisak, a régi mentés változatlanul átmegy (a hiányzó szekciók állapota érintetlen marad).
export const MIGRATIONS = { 1: d => d };
export const SAVE_KEYS = new Map([['F2', 'save'], ['F3', 'load'], ['F4', 'export'], ['F7', 'import']]);
export const SAVE_ERRORS = ['none', 'format', 'parse', 'size', 'newer', 'migrate', 'seed', 'players', 'clock', 'sorsko', 'storage', 'copy', 'ctx', 'cancel', ...EXTRA_ERRORS];

export const SAVE_TEXTS = {
  hu: {
    'ok.save': 'Mentve', 'ok.load': 'Betöltve', 'ok.export': 'Mentés a vágólapra másolva', 'ok.import': 'Betöltve a beillesztett mentésből',
    'err.none': 'Nincs mentés', 'err.format': 'Hibás mentés-formátum', 'err.parse': 'A szöveg nem olvasható mentésként',
    'err.size': 'A mentés túl nagy', 'err.newer': 'A mentés újabb verzióból van', 'err.migrate': 'A mentés nem alakítható át',
    'err.seed': 'A mentés másik világból való', 'err.players': 'Hibás játékos-adat a mentésben', 'err.clock': 'Hibás időadat a mentésben',
    'err.sorsko': 'Hibás Sorskő-adat a mentésben', 'err.storage': 'A böngésző nem engedi a mentést',
    'err.copy': 'A vágólapra másolás nem sikerült', 'err.ctx': 'A játékállapot nem érhető el', 'err.cancel': 'Megszakítva',
    'import.prompt': 'Illeszd be a mentés szövegét:',
    'err.inventory': 'Hibás inventory-adat a mentésben', 'err.wallet': 'Hibás pénz-adat a mentésben', 'err.skills': 'Hibás skill-adat a mentésben',
    'err.prog': 'Hibás szint-adat a mentésben', 'err.nodes': 'Hibás kitermelés-adat a mentésben', 'err.stations': 'Hibás állomás-adat a mentésben',
    'err.professions': 'Hibás szakma-adat a mentésben',
  },
  en: {
    'ok.save': 'Saved', 'ok.load': 'Loaded', 'ok.export': 'Save copied to the clipboard', 'ok.import': 'Loaded from the pasted save',
    'err.none': 'No save found', 'err.format': 'Invalid save format', 'err.parse': 'The text is not a readable save',
    'err.size': 'The save is too large', 'err.newer': 'The save is from a newer version', 'err.migrate': 'The save cannot be converted',
    'err.seed': 'The save belongs to a different world', 'err.players': 'Invalid player data in the save', 'err.clock': 'Invalid time data in the save',
    'err.sorsko': 'Invalid Fate Stone data in the save', 'err.storage': 'The browser does not allow saving',
    'err.copy': 'Copying to the clipboard failed', 'err.ctx': 'The game state is not available', 'err.cancel': 'Cancelled',
    'import.prompt': 'Paste the save text:',
    'err.inventory': 'Invalid inventory data in the save', 'err.wallet': 'Invalid money data in the save', 'err.skills': 'Invalid skill data in the save',
    'err.prog': 'Invalid level data in the save', 'err.nodes': 'Invalid harvest data in the save', 'err.stations': 'Invalid station data in the save',
    'err.professions': 'Invalid profession data in the save',
  },
};

const isNum = v => typeof v === 'number' && isFinite(v);
const fail = error => ({ ok: false, error });

function ctxOk(ctx) {
  return isObj(ctx) && Array.isArray(ctx.players) && ctx.players.length >= 2 && isObj(ctx.players[0]) && isObj(ctx.players[1]) && isObj(ctx.clock) && isObj(ctx.sorsko);
}

// A jelenlegi állapot mentés-objektumként (tiszta másolat; JSON-ba írható).
export function captureSave(ctx, now = Date.now()) {
  return {
    magic: SAVE_MAGIC, v: SAVE_VERSION, savedAt: isNum(now) ? now : 0, seed: ctx.seed,
    players: [0, 1].map(i => ({ x: ctx.players[i].x, y: ctx.players[i].y })),
    clock: clockState(ctx.clock), sorsko: sorskoState(ctx.sorsko),
    ...captureExtras(ctx), // S050
  };
}

// Verzió-léptetés a célverzióig; a bemenetet nem módosítja. -> {ok,data} | {ok:false,error}
export function migrateSave(data, target = SAVE_VERSION, migrations = MIGRATIONS) {
  if (!isObj(data) || data.magic !== SAVE_MAGIC || !Number.isInteger(data.v) || data.v < 1) return fail('format');
  if (data.v > target) return fail('newer');
  let d;
  try { d = JSON.parse(JSON.stringify(data)); } catch (e) { return fail('format'); }
  while (d.v < target) {
    const fn = migrations && migrations[d.v];
    if (typeof fn !== 'function') return fail('migrate');
    let next;
    try { next = fn(d); } catch (e) { return fail('migrate'); }
    if (!isObj(next)) return fail('migrate');
    d = next;
    d.v = d.v + 1;
  }
  return { ok: true, data: d };
}

// Tartalmi ellenőrzés (a már átalakított adatra), a ctx módosítása nélkül.
export function validateSave(d, seed) {
  if (!isObj(d)) return fail('format');
  if (!isNum(d.seed) || d.seed !== seed) return fail('seed');
  const m = SAVE_LIMITS.maxCoord;
  if (!Array.isArray(d.players) || d.players.length !== 2) return fail('players');
  for (const p of d.players) if (!isObj(p) || !isNum(p.x) || !isNum(p.y) || Math.abs(p.x) > m || Math.abs(p.y) > m) return fail('players');
  if (!isObj(d.clock)) return fail('clock');
  if (!isObj(d.sorsko)) return fail('sorsko');
  const xe = checkExtras(d); // S050: a jelen lévő bővítő szekciók szerkezete
  if (xe) return fail(xe);
  return { ok: true };
}

function writeState(ctx, d) { // -> hibakód | null
  if (!restoreSorsko(ctx.sorsko, d.sorsko)) return 'sorsko';
  if (!restoreClock(ctx.clock, d.clock)) return 'clock';
  const xe = applyExtras(ctx, d); // S050: az óra UTÁN (a node-ok újranövési ideje az órához képest van)
  if (xe) return xe;
  for (let i = 0; i < 2; i++) {
    const p = ctx.players[i];
    p.x = d.players[i].x; p.y = d.players[i].y; p.vx = 0; p.vy = 0;
  }
  return null;
}

// Mentés alkalmazása a játékállapotra. Atomi: hiba esetén az előző állapot áll vissza. Sosem dob.
export function applySave(ctx, raw) {
  try {
    if (!ctxOk(ctx)) return fail('ctx');
    const m = migrateSave(raw);
    if (!m.ok) return m;
    const v = validateSave(m.data, ctx.seed);
    if (!v.ok) return v;
    const prev = captureSave(ctx, 0);
    const err = writeState(ctx, m.data);
    if (err) { writeState(ctx, prev); return fail(err); }
    return { ok: true, data: m.data };
  } catch (e) { return fail('format'); }
}

export function serializeSave(data) { return JSON.stringify(data); }
export function exportText(ctx, now) { return serializeSave(captureSave(ctx, now)); }

// Beillesztett/tárolt szöveg -> mentés-objektum. -> {ok,data} | {ok:false,error}
export function parseSaveText(text) {
  if (typeof text !== 'string') return fail('parse');
  const s = text.replace(/^﻿/, '').trim();
  if (!s) return fail('parse');
  if (s.length > SAVE_LIMITS.maxText) return fail('size');
  let data;
  try { data = JSON.parse(s); } catch (e) { return fail('parse'); }
  return isObj(data) ? { ok: true, data } : fail('format');
}

export function importSave(ctx, text) {
  const p = parseSaveText(text);
  return p.ok ? applySave(ctx, p.data) : p;
}

// --- localStorage (injektálható tároló; hibázó/hiányzó tároló nem dob) ---
export function defaultStorage() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } }

export function writeSave(ctx, storage = defaultStorage(), now, key = SAVE_KEY) {
  if (!storage || typeof storage.setItem !== 'function') return fail('storage');
  if (!ctxOk(ctx)) return fail('ctx');
  try { storage.setItem(key, exportText(ctx, now)); } catch (e) { return fail('storage'); }
  return { ok: true };
}

export function readSaveText(storage = defaultStorage(), key = SAVE_KEY) {
  try { const s = storage && typeof storage.getItem === 'function' ? storage.getItem(key) : null; return typeof s === 'string' && s ? s : null; } catch (e) { return null; }
}

export function hasSave(storage, key = SAVE_KEY) { return readSaveText(storage, key) !== null; }

export function loadSave(ctx, storage = defaultStorage(), key = SAVE_KEY) {
  const text = readSaveText(storage, key);
  return text === null ? fail('none') : importSave(ctx, text);
}

// --- Vezérlő: gombok -> mentés/betöltés/export/import + értesítés (toast) ---
// opts: {storage, copy(text) -> Promise|any, ask(kulcs) -> szöveg|null, onLoaded(kind 'load'|'import'), now}
export function createSaveController(ctx, opts = {}) {
  const o = isObj(opts) ? opts : {};
  return { ctx, storage: o.storage === undefined ? defaultStorage() : o.storage, copy: o.copy, ask: o.ask, onLoaded: o.onLoaded, now: o.now, toast: null, last: null };
}

function notify(c, okKey, res) {
  c.last = res;
  c.toast = { key: res.ok ? 'save.ok.' + okKey : 'save.err.' + res.error, ok: !!res.ok, age: 0 };
  return res;
}
function loaded(c, kind) { try { if (typeof c.onLoaded === 'function') c.onLoaded(kind); } catch (e) { c.lastError = e && e.message ? e.message : String(e); } }

export function saveNow(c) { return notify(c, 'save', writeSave(c.ctx, c.storage, typeof c.now === 'function' ? c.now() : undefined)); }

export function loadNow(c) {
  const res = loadSave(c.ctx, c.storage);
  if (res.ok) loaded(c, 'load');
  return notify(c, 'load', res);
}

export async function exportNow(c) {
  if (!ctxOk(c.ctx)) return notify(c, 'export', fail('ctx'));
  if (typeof c.copy !== 'function') return notify(c, 'export', fail('copy'));
  try { await c.copy(exportText(c.ctx, typeof c.now === 'function' ? c.now() : undefined)); } catch (e) { return notify(c, 'export', fail('copy')); }
  return notify(c, 'export', { ok: true });
}

export function importNow(c) {
  if (typeof c.ask !== 'function') return notify(c, 'import', fail('cancel'));
  let text;
  try { text = c.ask('save.import.prompt'); } catch (e) { text = null; }
  if (text === null || text === undefined) { c.last = fail('cancel'); return c.last; } // megszakítás: nincs értesítés
  const res = importSave(c.ctx, text);
  if (res.ok) loaded(c, 'import');
  return notify(c, 'import', res);
}

export function stepSaveToast(c, dt) {
  if (!c || !c.toast || !(dt > 0)) return;
  c.toast.age += dt;
  if (c.toast.age >= SAVE_TOAST_TIME) c.toast = null;
}

// Fejlesztői/ideiglenes billentyűk (a menü-gombokat az S049 adja): F2 mentés, F3 betöltés, F4 export (másolás), F7 import (beillesztés).
export function saveKeyAction(e) {
  if (!e || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null;
  return SAVE_KEYS.get(e.code) || null;
}

export function runSaveAction(c, action) {
  if (action === 'save') return saveNow(c);
  if (action === 'load') return loadNow(c);
  if (action === 'export') return exportNow(c);
  if (action === 'import') return importNow(c);
  return null;
}

export function bindSaveKeys(c, target = typeof window !== 'undefined' ? window : null) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const h = e => {
    const a = saveKeyAction(e);
    if (!a) return;
    if (typeof e.preventDefault === 'function') e.preventDefault(); // a böngésző saját F-billentyű-műveletei ne fussanak
    if (!e.repeat) runSaveAction(c, a);
  };
  target.addEventListener('keydown', h);
  return () => target.removeEventListener('keydown', h);
}
