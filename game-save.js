// S032: mentés — verziózott JSON (localStorage + szöveges export/import), billentyűk és értesítés.
// Tiszta logika (nincs DOM/canvas függés; a tároló, a vágólap és a kérdés injektálható). A rajz a main.js-ben van.
// ctx = {players[2], clock, sorsko, seed}: a mentett állapot ezekből áll (játékos-pozíciók, világ-seed, GameClock, Sorskő-szint).
import { clockState, restoreClock } from './game-clock.js';
import { sorskoState, restoreSorsko } from './game-sorsko.js';

export const SAVE_VERSION = 1;
export const SAVE_MAGIC = 'interlinked-save';
export const SAVE_KEY = 'interlinked.save';
export const SAVE_LIMITS = { maxText: 200000, maxCoord: 1e8 };
export const SAVE_TOAST_TIME = 2.5; // mp
// Migrációs hook: MIGRATIONS[n](adat) a v=n mentést v=n+1 alakra hozza (új verziónál ide kerül a lépés + SAVE_VERSION nő).
export const MIGRATIONS = {};
export const SAVE_KEYS = new Map([['F2', 'save'], ['F3', 'load'], ['F4', 'export'], ['F7', 'import']]);
export const SAVE_ERRORS = ['none', 'format', 'parse', 'size', 'newer', 'migrate', 'seed', 'players', 'clock', 'sorsko', 'storage', 'copy', 'ctx', 'cancel'];

export const SAVE_TEXTS = {
  hu: {
    'ok.save': 'Mentve', 'ok.load': 'Betöltve', 'ok.export': 'Mentés a vágólapra másolva', 'ok.import': 'Betöltve a beillesztett mentésből',
    'err.none': 'Nincs mentés', 'err.format': 'Hibás mentés-formátum', 'err.parse': 'A szöveg nem olvasható mentésként',
    'err.size': 'A mentés túl nagy', 'err.newer': 'A mentés újabb verzióból van', 'err.migrate': 'A mentés nem alakítható át',
    'err.seed': 'A mentés másik világból való', 'err.players': 'Hibás játékos-adat a mentésben', 'err.clock': 'Hibás időadat a mentésben',
    'err.sorsko': 'Hibás Sorskő-adat a mentésben', 'err.storage': 'A böngésző nem engedi a mentést',
    'err.copy': 'A vágólapra másolás nem sikerült', 'err.ctx': 'A játékállapot nem érhető el', 'err.cancel': 'Megszakítva',
    'import.prompt': 'Illeszd be a mentés szövegét:',
  },
  en: {
    'ok.save': 'Saved', 'ok.load': 'Loaded', 'ok.export': 'Save copied to the clipboard', 'ok.import': 'Loaded from the pasted save',
    'err.none': 'No save found', 'err.format': 'Invalid save format', 'err.parse': 'The text is not a readable save',
    'err.size': 'The save is too large', 'err.newer': 'The save is from a newer version', 'err.migrate': 'The save cannot be converted',
    'err.seed': 'The save belongs to a different world', 'err.players': 'Invalid player data in the save', 'err.clock': 'Invalid time data in the save',
    'err.sorsko': 'Invalid Fate Stone data in the save', 'err.storage': 'The browser does not allow saving',
    'err.copy': 'Copying to the clipboard failed', 'err.ctx': 'The game state is not available', 'err.cancel': 'Cancelled',
    'import.prompt': 'Paste the save text:',
  },
};

const isNum = v => typeof v === 'number' && isFinite(v);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
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
  return { ok: true };
}

function writeState(ctx, d) { // -> hibakód | null
  if (!restoreSorsko(ctx.sorsko, d.sorsko)) return 'sorsko';
  if (!restoreClock(ctx.clock, d.clock)) return 'clock';
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
