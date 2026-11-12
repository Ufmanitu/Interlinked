// S032 tesztek: mentés (verziózott JSON, migráció, atomi betöltés, tároló, export/import, billentyűk, vezérlő, szövegek) + smoke.
import { test, assert, eq } from './test-index.js';
import { createPlayer } from './game-player.js';
import { createGameClock, clockInfo, stepClock } from './game-clock.js';
import { sanitizeField, fieldL } from './game-field.js';
import { SORSKO_CONFIG, createSorsko, setSorskoLevel, stepSorsko } from './game-sorsko.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { TetherConfig } from './tether-config.js';
import { createI18n, addTexts, auditTexts } from './i18n.js';
import { BASE_TEXTS } from './data-text.js';
import {
  SAVE_VERSION, SAVE_MAGIC, SAVE_KEY, SAVE_LIMITS, SAVE_ERRORS, SAVE_TEXTS, SAVE_TOAST_TIME, MIGRATIONS,
  captureSave, migrateSave, validateSave, applySave, serializeSave, exportText, parseSaveText, importSave,
  writeSave, readSaveText, hasSave, loadSave, createSaveController, saveNow, loadNow, exportNow, importNow, stepSaveToast,
  saveKeyAction, runSaveAction, bindSaveKeys,
} from './game-save.js';

const SEED = 12014;
const DT = 1 / 60;

function rig(seed = SEED) {
  const players = [createPlayer(0, 100, 200), createPlayer(1, 170, 200)];
  const clock = createGameClock();
  const field = sanitizeField({ id: 'sorsko', x: 0, y: 0, radius: SORSKO_CONFIG.levels[0] });
  const sorsko = createSorsko(field);
  return { players, clock, sorsko, field, seed };
}
function fakeStorage(opts = {}) {
  const m = new Map();
  return {
    m,
    getItem(k) { if (opts.getThrows) throw new Error('get'); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (opts.setThrows) throw new Error('quota'); m.set(k, String(v)); },
  };
}
const snap = c => JSON.stringify({ p: c.players.map(p => [p.x, p.y, p.vx, p.vy]), t: c.clock.t, ph: c.clock.phase, l: c.sorsko.level, r: c.field.radius });
function mutate(c) {
  c.players[0].x = -321.5; c.players[0].y = 77.25; c.players[1].x = 999.125; c.players[1].y = -40;
  c.players[0].vx = 5; c.players[1].vy = -3;
  c.clock.t = 3 * 1440 + 17 * 60 + 5; setSorskoLevel(c.sorsko, 2);
}
const rnd = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

test('save: mentés-objektum alakja', () => {
  const c = rig(); mutate(c);
  const s = captureSave(c, 1234);
  eq(s.magic, SAVE_MAGIC); eq(s.v, SAVE_VERSION); eq(s.seed, SEED); eq(s.savedAt, 1234);
  eq(s.players.length, 2); eq(s.players[0].x, -321.5); eq(s.players[1].y, -40);
  eq(s.clock.t, c.clock.t); eq(s.sorsko.level, 2);
  eq(JSON.stringify(s), serializeSave(s));
  assert(!('vx' in s.players[0]), 'nincs sebesség a mentésben');
  eq(captureSave(c, NaN).savedAt, 0, 'hibás idő -> 0');
  s.players[0].x = 1; eq(c.players[0].x, -321.5, 'másolat');
});

test('save: export -> import körút azonos állapotot ad', () => {
  const a = rig(); mutate(a);
  const text = exportText(a, 1);
  const b = rig();
  const r = importSave(b, text);
  assert(r.ok, 'import: ' + r.error);
  eq(b.players[0].x, -321.5); eq(b.players[1].x, 999.125); eq(b.clock.t, a.clock.t); eq(b.sorsko.level, 2);
  eq(b.field.radius, SORSKO_CONFIG.levels[2], 'a mező sugara követi a Sorskő szintjét');
  eq(b.players[0].vx, 0, 'a sebesség nullázódik');
  eq(exportText(b, 1), text, 'újra exportálva ugyanaz a szöveg');
  const info = clockInfo(b.clock); eq(info.day, 4); eq(info.hour, 17);
});

test('save: tároló (mentés, betöltés, nincs mentés, hibázó/hiányzó tároló)', () => {
  const a = rig(); mutate(a);
  const st = fakeStorage();
  eq(hasSave(st), false); eq(loadSave(rig(), st).error, 'none');
  assert(writeSave(a, st, 5).ok);
  assert(hasSave(st)); assert(readSaveText(st).includes(SAVE_MAGIC));
  const b = rig(); assert(loadSave(b, st).ok);
  eq(b.players[1].x, 999.125); eq(b.clock.t, a.clock.t); eq(b.sorsko.level, 2); eq(b.players[0].vx, 0);
  eq(writeSave(a, fakeStorage({ setThrows: true })).error, 'storage');
  eq(writeSave(a, null).error, 'storage');
  eq(writeSave(a, {}).error, 'storage');
  eq(loadSave(rig(), fakeStorage({ getThrows: true })).error, 'none');
  eq(loadSave(rig(), null).error, 'none');
  eq(writeSave({}, st).error, 'ctx');
  st.setItem(SAVE_KEY, '{szemét'); eq(loadSave(rig(), st).error, 'parse');
  st.setItem(SAVE_KEY, ''); eq(hasSave(st), false);
  writeSave(a, st, 1, 'más.kulcs'); assert(hasSave(st, 'más.kulcs'));
});

test('save: migráció (lánc, hiányzó lépés, dobó lépés, újabb verzió, érintetlen bemenet)', () => {
  const base = { magic: SAVE_MAGIC, v: 1, seed: SEED, nested: { a: 1 } };
  const mig = { 1: d => ({ ...d, extra: 'x' }), 2: d => { d.nested.a = 2; return d; } };
  const r = migrateSave(base, 3, mig);
  assert(r.ok); eq(r.data.v, 3); eq(r.data.extra, 'x'); eq(r.data.nested.a, 2);
  eq(base.v, 1, 'bemenet érintetlen'); eq(base.nested.a, 1, 'mély másolat');
  eq(migrateSave(base, 3, { 1: mig[1] }).error, 'migrate', 'hiányzó lépés');
  eq(migrateSave(base, 2, { 1: () => { throw new Error('x'); } }).error, 'migrate', 'dobó lépés');
  eq(migrateSave(base, 2, { 1: () => null }).error, 'migrate', 'nem objektum');
  eq(migrateSave({ ...base, v: 4 }, 3, mig).error, 'newer');
  eq(migrateSave({ ...base, v: 0 }).error, 'format'); eq(migrateSave({ ...base, v: 1.5 }).error, 'format');
  eq(migrateSave({ ...base, magic: 'más' }).error, 'format');
  for (const bad of [null, undefined, 5, 'x', [], true]) eq(migrateSave(bad).error, 'format');
  assert(migrateSave({ ...base, v: SAVE_VERSION }).ok, 'aktuális verzió átmegy');
  assert(typeof MIGRATIONS === 'object');
});

test('save: szöveg-feldolgozás (üres, szemét, méret, BOM, nem objektum)', () => {
  for (const bad of ['', '   ', 'abc', '{', undefined, null, 5, {}]) eq(parseSaveText(bad).error, 'parse', String(bad));
  eq(parseSaveText('[1,2]').error, 'format'); eq(parseSaveText('5').error, 'format'); eq(parseSaveText('null').error, 'format');
  eq(parseSaveText('"x'.repeat(SAVE_LIMITS.maxText)).error, 'size');
  const a = rig(); const text = exportText(a, 1);
  assert(parseSaveText('﻿  ' + text + '\n\n').ok, 'BOM + szóköz');
  eq(importSave(a, 'abc').error, 'parse');
});

test('save: tartalmi hibák (seed, játékosok, óra, Sorskő) és az atomi visszaállás', () => {
  const a = rig(); mutate(a);
  const good = captureSave(a, 1);
  const b = rig(); const before = snap(b);
  const cases = [
    ['seed', d => { d.seed = SEED + 1; }], ['seed', d => { delete d.seed; }], ['seed', d => { d.seed = '12014'; }],
    ['players', d => { d.players = [d.players[0]]; }], ['players', d => { d.players.push({ x: 1, y: 1 }); }],
    ['players', d => { d.players[1].x = NaN; }], ['players', d => { d.players[0].y = Infinity; }],
    ['players', d => { d.players[0].x = '5'; }], ['players', d => { d.players[1] = null; }],
    ['players', d => { d.players[0].x = SAVE_LIMITS.maxCoord * 2; }], ['players', d => { d.players = 'x'; }],
    ['clock', d => { d.clock = null; }], ['clock', d => { d.clock.t = -5; }], ['clock', d => { d.clock.v = 9; }], ['clock', d => { d.clock.t = 'x'; }],
    ['sorsko', d => { d.sorsko = null; }], ['sorsko', d => { d.sorsko.level = 99; }], ['sorsko', d => { d.sorsko.level = 1.5; }], ['sorsko', d => { d.sorsko.v = 2; }],
  ];
  cases.forEach(([code, f], i) => {
    const d = JSON.parse(JSON.stringify(good)); f(d);
    const r = applySave(b, d);
    eq(r.ok, false, 'eset ' + i); eq(r.error, code, 'eset ' + i);
    eq(snap(b), before, 'eset ' + i + ': az állapot érintetlen');
  });
  // a Sorskő már a 2. szinten, az óra hibás -> rollback: a Sorskő visszaáll
  const d = JSON.parse(JSON.stringify(good)); d.clock.t = -1;
  eq(applySave(b, d).error, 'clock'); eq(b.sorsko.level, 0, 'a Sorskő-szint visszaállt'); eq(snap(b), before);
  assert(applySave(b, good).ok);
  for (const bad of [null, {}, { players: [] }]) eq(applySave(bad, good).error, 'ctx');
});

test('save: fuzz — sosem dob, hibánál érintetlen állapot, sikernél véges értékek', () => {
  const a = rig(); mutate(a);
  const good = captureSave(a, 1);
  const r = rnd(32);
  const junk = () => { const k = Math.floor(r() * 9); return [null, undefined, NaN, Infinity, -1, 'x', [], {}, 1e300][k]; };
  const paths = [['seed'], ['v'], ['magic'], ['players'], ['players', 0], ['players', 0, 'x'], ['players', 1, 'y'], ['clock'], ['clock', 't'], ['clock', 'v'], ['sorsko'], ['sorsko', 'level'], ['sorsko', 'v'], ['savedAt']];
  let okN = 0, failN = 0;
  for (let i = 0; i < 600; i++) {
    const d = JSON.parse(JSON.stringify(good));
    const n = 1 + Math.floor(r() * 3);
    for (let j = 0; j < n; j++) {
      const path = paths[Math.floor(r() * paths.length)];
      let o = d;
      for (let k = 0; k < path.length - 1 && o && typeof o === 'object'; k++) o = o[path[k]];
      if (o && typeof o === 'object') o[path[path.length - 1]] = junk();
    }
    const b = rig(); const before = snap(b);
    let res;
    try { res = applySave(b, d); } catch (e) { throw new Error('dobott: ' + e.message + ' ' + JSON.stringify(d)); }
    if (res.ok) {
      okN++;
      assert(b.players.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), 'véges pozíció');
      assert(Number.isFinite(b.clock.t) && b.clock.t >= 0, 'érvényes idő');
    } else { failN++; eq(snap(b), before, 'hibánál érintetlen: ' + JSON.stringify(d)); }
  }
  assert(okN > 0 && failN > 0, `mindkét ág előfordul (${okN}/${failN})`);
  for (let i = 0; i < 200; i++) { const s = Array.from({ length: Math.floor(r() * 60) }, () => String.fromCharCode(32 + Math.floor(r() * 90))).join(''); importSave(rig(), s); }
});

test('save: billentyűk (F2/F3/F4/F7, módosítók, ismétlés, preventDefault, leválasztás)', () => {
  eq(saveKeyAction({ code: 'F2' }), 'save'); eq(saveKeyAction({ code: 'F3' }), 'load');
  eq(saveKeyAction({ code: 'F4' }), 'export'); eq(saveKeyAction({ code: 'F7' }), 'import');
  eq(saveKeyAction({ code: 'F8' }), null, 'az F8 a nyelvváltás'); eq(saveKeyAction({ code: 'KeyF' }), null);
  for (const m of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) eq(saveKeyAction({ code: 'F2', [m]: true }), null);
  eq(saveKeyAction(null), null);
  const st = fakeStorage();
  const c = createSaveController(rig(), { storage: st });
  let h = null, removed = 0;
  const target = { addEventListener(t, f) { if (t === 'keydown') h = f; }, removeEventListener() { removed++; } };
  const off = bindSaveKeys(c, target);
  let prevented = 0;
  const key = (code, extra = {}) => h({ code, preventDefault() { prevented++; }, ...extra });
  key('F2'); assert(hasSave(st), 'F2 mentett'); eq(prevented, 1);
  st.m.clear(); key('F2', { repeat: true }); eq(hasSave(st), false, 'ismétlés nem ment'); eq(prevented, 2);
  key('KeyA'); eq(prevented, 2, 'más billentyű érintetlen');
  key('F2', { shiftKey: true }); eq(prevented, 2);
  off(); eq(removed, 1);
  eq(typeof bindSaveKeys(c, null), 'function'); eq(typeof bindSaveKeys(c, {}), 'function');
  eq(runSaveAction(c, 'x'), null);
});

test('save: vezérlő (mentés/betöltés/export/import, toast, onLoaded)', async () => {
  const a = rig(); mutate(a);
  const st = fakeStorage();
  const kinds = [];
  const clip = [];
  let asked = null;
  const c = createSaveController(a, { storage: st, copy: t => { clip.push(t); }, ask: k => asked, onLoaded: k => kinds.push(k), now: () => 77 });
  eq(saveNow(c).ok, true); eq(c.toast.key, 'save.ok.save'); eq(c.toast.ok, true);
  assert(JSON.parse(readSaveText(st)).savedAt === 77, 'now() injektált');
  const b = rig(); c.ctx = b;
  assert(loadNow(c).ok); eq(c.toast.key, 'save.ok.load'); eq(kinds.join(), 'load'); eq(b.players[0].x, -321.5);
  st.m.clear(); const bad = loadNow(c); eq(bad.error, 'none'); eq(c.toast.key, 'save.err.none'); eq(c.toast.ok, false); eq(kinds.length, 1, 'hibánál nincs onLoaded');
  c.ctx = a;
  const ex = await exportNow(c); assert(ex.ok); eq(clip.length, 1); eq(c.toast.key, 'save.ok.export');
  eq(clip[0], exportText(a, 77));
  asked = clip[0]; const b2 = rig(); c.ctx = b2;
  assert(importNow(c).ok); eq(kinds.join(), 'load,import'); eq(b2.sorsko.level, 2); eq(c.toast.key, 'save.ok.import');
  asked = null; c.toast = null; eq(importNow(c).error, 'cancel'); eq(c.toast, null, 'megszakítás: nincs toast');
  asked = 'szemét'; eq(importNow(c).error, 'parse'); eq(c.toast.key, 'save.err.parse');
  const c2 = createSaveController(a, { storage: st, copy: () => { throw new Error('nem'); } });
  eq((await exportNow(c2)).error, 'copy');
  eq((await exportNow(createSaveController(a, { storage: st }))).error, 'copy', 'nincs másoló');
  eq(importNow(createSaveController(a, { storage: st })).error, 'cancel', 'nincs kérdező');
  const c3 = createSaveController(a, { storage: st, onLoaded: () => { throw new Error('boom'); } });
  saveNow(c3); assert(loadNow(c3).ok, 'a hibázó onLoaded nem állítja meg'); eq(c3.lastError, 'boom');
  eq(createSaveController(a, null).toast, null);
  saveNow(c); stepSaveToast(c, 1); assert(c.toast); stepSaveToast(c, SAVE_TOAST_TIME); eq(c.toast, null, 'a toast lejár');
  stepSaveToast(c, 1); stepSaveToast(null, 1); stepSaveToast(c, NaN);
});

test('save: szövegek HU/EN teljessége, hibakódok, i18n-audit', () => {
  eq(JSON.stringify(Object.keys(SAVE_TEXTS.hu).sort()), JSON.stringify(Object.keys(SAVE_TEXTS.en).sort()));
  for (const e of SAVE_ERRORS) for (const l of ['hu', 'en']) assert(SAVE_TEXTS[l]['err.' + e], `hiányzó ${l} err.${e}`);
  for (const k of ['save', 'load', 'export', 'import']) for (const l of ['hu', 'en']) assert(SAVE_TEXTS[l]['ok.' + k], `hiányzó ${l} ok.${k}`);
  const i = createI18n({ lang: 'hu', texts: BASE_TEXTS, storage: null });
  addTexts(i, SAVE_TEXTS, 'save.');
  const a = auditTexts(i);
  eq(a.missing.hu.length + a.missing.en.length, 0); eq(a.empty.length, 0);
  assert(i.tables.hu['save.err.none'] && i.tables.en['save.import.prompt']);
});

// smoke: main-szerű lánc 600 kockán; a közbeni mentésből újraindított szimuláció pontosan ugyanoda jut
function chain(ctx) {
  const tc = new TetherConfig(null);
  const cfg = tc.systemConfig({ walls: [], field: ctx.field });
  cfg.L = fieldL(ctx.field, () => tc.lNormal());
  const sys = createTetherSystem(cfg);
  const script = (p, f) => { const k = Math.floor(f / 75) + p * 3; return [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 1 }, { x: 0, y: 0 }][k % 6]; };
  return (from, to) => {
    for (let f = from; f < to; f++) {
      stepClock(ctx.clock, DT); stepSorsko(ctx.sorsko, DT);
      stepTetherSystem(sys, ctx.players, [script(0, f), script(1, f)], DT);
      for (const p of ctx.players) assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN pozíció');
    }
  };
}

test('save smoke: 600 kocka, mentés a 300.-ban, betöltés után azonos folytatás', () => {
  const a = rig(); const runA = chain(a);
  runA(0, 300);
  const st = fakeStorage(); assert(writeSave(a, st, 1).ok);
  runA(300, 600);
  const endA = snap(a);
  const b = rig(); const runB = chain(b);
  assert(loadSave(b, st).ok);
  eq(b.players[0].x, JSON.parse(readSaveText(st)).players[0].x);
  runB(300, 600);
  eq(snap(b), endA, 'a betöltött állapot ugyanoda jut');
  const c = rig(); assert(importSave(c, exportText(a, 2)).ok);
  eq(c.players[0].x, a.players[0].x); eq(c.players[1].y, a.players[1].y); eq(c.clock.t, a.clock.t); eq(c.sorsko.level, a.sorsko.level);
  for (let i = 0; i < 20; i++) { saveNow(createSaveController(a, { storage: st })); loadSave(a, st); }
  assert(a.players.every(p => Number.isFinite(p.x)), 'ismételt mentés/betöltés után is véges');
});
