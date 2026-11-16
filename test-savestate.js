// S050 tesztek: a mentés bővítése (inventory, pénz, skillek, szint, kitermelt node-ok, lerakott állomások, szakmák): körút, régi (v1) mentés,
// hibás szekciók + atomi rollback, node-idő az óra szerint, fuzz, 600 kockás smoke (mentés a közepén, azonos folytatás).
import { test, assert, eq } from './test-index.js';
import { createPlayer } from './game-player.js';
import { createGameClock, stepClock } from './game-clock.js';
import { sanitizeField } from './game-field.js';
import { SORSKO_CONFIG, createSorsko, setSorskoLevel } from './game-sorsko.js';
import { createPlayerInventories, addItem, countItem, inventoryState } from './game-inventory.js';
import { createPlayerWallets, deposit, balance } from './game-wallet.js';
import { createSkillSystem, addXp, skillXp, skillState } from './game-skills.js';
import { createProgression, addCharXp, charXp } from './game-curve.js';
import { createWorldStream, warmStream } from './world-stream.js';
import { createObjectStore, syncObjects, removeObject } from './world-objects.js';
import { createNodeSystem, stepNodes, nodeState } from './game-nodes.js';
import { createStationSystem, placeStation, stationCount, stationState } from './game-stations.js';
import { createProfessionSystem, chooseProfession, professionState } from './game-professions.js';
import {
  SAVE_VERSION, SAVE_ERRORS, SAVE_TEXTS, MIGRATIONS, SECTIONS, EXTRA_ERRORS, captureExtras, checkExtras, applyExtras,
  captureSave, migrateSave, applySave, exportText, importSave, writeSave, loadSave, readSaveText, createSaveController, loadNow,
} from './game-save.js';

const SEED = 12014, DT = 1 / 60;
const rnd = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const clone = o => JSON.parse(JSON.stringify(o));
function fakeStorage() { const m = new Map(); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; }

function rig() {
  const players = [createPlayer(0, 100, 200), createPlayer(1, 170, 200)];
  const clock = createGameClock();
  const sorsko = createSorsko(sanitizeField({ id: 'sorsko', x: 0, y: 0, radius: SORSKO_CONFIG.levels[0] }));
  const ws = createWorldStream(SEED); warmStream(ws, [{ x: 0, y: 0 }]);
  const objects = createObjectStore(SEED, { cfg: { herbChance: 0.01 } }); syncObjects(objects, ws);
  const nodes = createNodeSystem(objects, { seed: SEED });
  return {
    players, clock, sorsko, seed: SEED, objects, ws, nodes,
    inventories: createPlayerInventories(), wallets: createPlayerWallets(), skills: createSkillSystem(), prog: createProgression(),
    stations: createStationSystem(), professions: createProfessionSystem(),
  };
}
const trees = c => { const out = []; for (const ch of c.objects.chunks.values()) for (const o of ch.list) if (o.type === 'tree') out.push(o); return out; };
function mutate(c) {
  c.players[0].x = -50.5; c.players[1].y = 321;
  c.clock.t = 2 * 1440 + 600; setSorskoLevel(c.sorsko, 1);
  addItem(c.inventories[0], 'wood', 17); addItem(c.inventories[0], 'pickaxe', 1); addItem(c.inventories[1], 'stone', 40); addItem(c.inventories[1], 'workbench', 1);
  deposit(c.wallets[0], 123); deposit(c.wallets[1], 4567);
  addXp(c.skills, 0, 'mining', 700); addXp(c.skills, 1, 'woodcutting', 90); addCharXp(c.prog, 0, 900); addCharXp(c.prog, 1, 150);
  const [a, b] = trees(c);
  removeObject(c.objects, a.id); c.nodes.depleted.set(a.id, { type: 'tree', regrowAt: c.clock.t + 45 });
  removeObject(c.objects, b.id); c.nodes.depleted.set(b.id, { type: 'tree', regrowAt: c.clock.t + 300.5 });
  assert(placeStation(c.stations, c.inventories[1], 'workbench', 400, 400, [], []).ok, 'állomás lerakva');
  chooseProfession(c.professions, 0, 'mining'); chooseProfession(c.professions, 1, 'herbalism');
}
const snapAll = c => JSON.stringify({
  p: c.players.map(p => [p.x, p.y]), t: c.clock.t, l: c.sorsko.level, inv: c.inventories.map(inventoryState), w: c.wallets.map(balance),
  s: skillState(c.skills), pr: [charXp(c.prog, 0), charXp(c.prog, 1)], n: nodeState(c.nodes, c.clock.t), st: stationState(c.stations), pf: professionState(c.professions),
});

test('save S050: verzió, migráció, hibakódok és szövegek', () => {
  eq(SAVE_VERSION, 2); eq(typeof MIGRATIONS[1], 'function');
  eq(EXTRA_ERRORS.join(), 'inventory,wallet,skills,prog,nodes,stations,professions');
  for (const e of EXTRA_ERRORS) { assert(SAVE_ERRORS.includes(e), e); for (const l of ['hu', 'en']) assert(SAVE_TEXTS[l]['err.' + e], l + ' ' + e); }
  const r = migrateSave({ magic: 'interlinked-save', v: 1, seed: SEED, players: [], clock: {}, sorsko: {} });
  assert(r.ok); eq(r.data.v, 2);
  eq(SECTIONS.length, 7);
});

test('save S050: a mentés-objektum minden szekciót tartalmaz, a minimális ctx csak a régieket', () => {
  const c = rig(); mutate(c);
  const s = captureSave(c, 1);
  for (const k of ['inv', 'wal', 'skl', 'prog', 'nod', 'stn', 'prof']) assert(s[k] !== undefined, 'hiányzik: ' + k);
  eq(s.wal[1].coins, 4567); eq(s.prog.xp[0], 900); eq(s.stn.list.length, 1); eq(s.nod.depleted.length, 2);
  eq(JSON.stringify(s), JSON.stringify(JSON.parse(JSON.stringify(s))), 'JSON-barát');
  const m = captureSave({ players: c.players, clock: c.clock, sorsko: c.sorsko, seed: SEED }, 1);
  eq(Object.keys(m).sort().join(), 'clock,magic,players,savedAt,seed,sorsko,v');
  eq(JSON.stringify(captureExtras({})), '{}');
});

test('save S050: export -> import körút minden állapotot visszaad (új rendszeren)', () => {
  const a = rig(); mutate(a);
  const text = exportText(a, 9);
  const b = rig();
  const r = importSave(b, text);
  assert(r.ok, 'import: ' + r.error);
  eq(snapAll(b), snapAll(a));
  eq(countItem(b.inventories[0], 'wood'), 17); eq(balance(b.wallets[1]), 4567); eq(skillXp(b.skills, 0, 'mining'), 700); eq(stationCount(b.stations), 1);
  eq(exportText(b, 9), text, 'újra exportálva ugyanaz');
  for (const id of a.nodes.depleted.keys()) assert(b.nodes.depleted.has(id) && !trees(b).some(o => o.id === id), 'a kitermelt fa a betöltés után is hiányzik');
  const st = fakeStorage(); assert(writeSave(a, st, 1).ok);
  const c = rig(); assert(loadSave(c, st).ok); eq(snapAll(c), snapAll(a));
});

test('save S050: a node újranövési ideje az új játékórához képest számít (a visszaírt óra után)', () => {
  const a = rig(); mutate(a);
  const b = rig(); b.clock.t = 5; // a cél-óra más: a hátralévő idő a mentett óra szerint értendő
  assert(applySave(b, captureSave(a, 1)).ok);
  eq(b.clock.t, a.clock.t);
  const left = [...b.nodes.depleted.values()].map(e => e.regrowAt - b.clock.t).sort((x, y) => x - y);
  eq(left[0], 45); eq(left[1], 300.5);
});

test('save S050: régi (v1) mentés betölthető, a bővítő szekciók állapota érintetlen', () => {
  const a = rig(); mutate(a);
  const old = { magic: 'interlinked-save', v: 1, savedAt: 1, seed: SEED, players: [{ x: 7, y: 8 }, { x: 9, y: 10 }], clock: { v: 1, t: 77 }, sorsko: { v: 1, level: 0 } };
  const before = JSON.stringify({ i: a.inventories.map(inventoryState), w: a.wallets.map(balance), st: stationState(a.stations) });
  const r = applySave(a, old);
  assert(r.ok, 'v1: ' + r.error); eq(a.players[0].x, 7); eq(a.clock.t, 77); eq(a.sorsko.level, 0);
  eq(JSON.stringify({ i: a.inventories.map(inventoryState), w: a.wallets.map(balance), st: stationState(a.stations) }), before, 'inventory/pénz/állomás érintetlen');
  const r2 = importSave(rig(), JSON.stringify(old)); assert(r2.ok, 'v1 import');
});

test('save S050: hibás szekciók -> hibakód, és az ÖSSZES állapot visszaáll (atomi)', () => {
  const a = rig(); mutate(a);
  const good = captureSave(a, 1);
  const cases = [
    ['inventory', d => { d.inv = 5; }], ['inventory', d => { d.inv = [{}]; }], ['inventory', d => { d.inv[1].slots = 'x'; }], ['inventory', d => { d.inv[0].slots[0] = ['nincs_ilyen', 1]; }],
    ['inventory', d => { d.inv[0].slots[0] = ['wood', 9999]; }], ['inventory', d => { d.inv[1].v = 9; }],
    ['wallet', d => { d.wal = null; }], ['wallet', d => { d.wal[0].coins = -1; }], ['wallet', d => { d.wal[1].coins = 1.5; }], ['wallet', d => { d.wal[1].v = 2; }],
    ['skills', d => { d.skl = []; }], ['skills', d => { d.skl.players = [[]]; }], ['skills', d => { d.skl.players[0] = [['mining', -3]]; }], ['skills', d => { d.skl.v = 0; }],
    ['prog', d => { d.prog = 'x'; }], ['prog', d => { d.prog.xp = [1]; }], ['prog', d => { d.prog.xp = [1, -1]; }], ['prog', d => { d.prog.v = 5; }],
    ['nodes', d => { d.nod = 3; }], ['nodes', d => { d.nod.depleted = {}; }], ['nodes', d => { d.nod.depleted[0] = ['x', 'tree']; }], ['nodes', d => { d.nod.depleted[0][1] = 'bokor'; }],
    ['nodes', d => { d.nod.depleted[0][2] = -4; }], ['nodes', d => { d.nod.v = 7; }],
    ['stations', d => { d.stn = []; }], ['stations', d => { d.stn.list[0][1] = 'nincs'; }], ['stations', d => { d.stn.list[0][2] = NaN; }], ['stations', d => { d.stn.v = 3; }],
    ['professions', d => { d.prof = 7; }], ['professions', d => { d.prof.players = [[]]; }], ['professions', d => { d.prof.v = 2; }],
  ];
  cases.forEach(([code, f], i) => {
    const b = rig(); b.wallets[0].coins = 5; b.inventories[0].slots[3] = { id: 'stone', n: 2 }; b.clock.t = 11;
    const before = snapAll(b);
    const d = clone(good); f(d);
    let r; try { r = applySave(b, d); } catch (e) { throw new Error('dobott (eset ' + i + '): ' + e.message); }
    eq(r.ok, false, 'eset ' + i); eq(r.error, code, 'eset ' + i);
    eq(snapAll(b), before, 'eset ' + i + ': az állapot érintetlen');
  });
  // a 2. inventory hibás (az 1. már visszaíródott volna), a játékos-pozíció is változott volna -> minden marad
  const b = rig(); const before = snapAll(b);
  const d = clone(good); d.inv[1].slots[0] = ['nincs_ilyen', 1];
  eq(applySave(b, d).error, 'inventory'); eq(snapAll(b), before); eq(countItem(b.inventories[0], 'wood'), 0, 'az 1. inventory visszaállt');
});

test('save S050: a ctx-ből hiányzó rendszer szekcióját a betöltés kihagyja, a hibás szerkezetet viszont jelzi', () => {
  const a = rig(); mutate(a);
  const good = captureSave(a, 1);
  const min = { players: [createPlayer(0, 0, 0), createPlayer(1, 0, 0)], clock: createGameClock(), sorsko: createSorsko(sanitizeField({ id: 's', x: 0, y: 0, radius: SORSKO_CONFIG.levels[0] })), seed: SEED };
  assert(applySave(min, good).ok, 'minimális ctx: a szekciók kimaradnak');
  const bad = clone(good); bad.inv = 5;
  eq(applySave(min, bad).error, 'inventory', 'a szerkezet a ctx-től függetlenül ellenőrzött');
  eq(checkExtras(good), null); eq(checkExtras({}), null); eq(checkExtras(null), null); eq(applyExtras({}, good), null);
});

test('save S050: vezérlő — a betöltés után onLoaded fut, a hiba nem módosít', () => {
  const a = rig(); mutate(a);
  const st = fakeStorage(); const kinds = [];
  const c = createSaveController(a, { storage: st, onLoaded: k => kinds.push(k), now: () => 1 });
  assert(writeSave(a, st, 1).ok);
  const b = rig(); c.ctx = b;
  assert(loadNow(c).ok); eq(kinds.join(), 'load'); eq(snapAll(b), snapAll(a));
  const tx = JSON.parse(readSaveText(st)); tx.wal = 'x'; st.setItem('interlinked.save', JSON.stringify(tx));
  const e = rig(); c.ctx = e; const before = snapAll(e);
  eq(loadNow(c).error, 'wallet'); eq(c.toast.key, 'save.err.wallet'); eq(kinds.length, 1); eq(snapAll(e), before);
});

test('save S050: fuzz — sosem dob, hibánál érintetlen, sikernél érvényes inventory/pénz', () => {
  const a = rig(); mutate(a);
  const good = captureSave(a, 1);
  const r = rnd(50);
  const junk = () => [null, undefined, NaN, Infinity, -1, 'x', [], {}, 1e300, 1.5, true][Math.floor(r() * 11)];
  const paths = [['inv'], ['inv', 0], ['inv', 1, 'slots'], ['inv', 0, 'slots', 0], ['inv', 0, 'v'], ['wal'], ['wal', 0, 'coins'], ['wal', 1], ['skl'], ['skl', 'players'], ['skl', 'players', 0],
    ['skl', 'players', 1, 0], ['prog'], ['prog', 'xp'], ['prog', 'xp', 0], ['nod'], ['nod', 'depleted'], ['nod', 'depleted', 0], ['nod', 'depleted', 1, 2], ['nod', 'v'],
    ['stn'], ['stn', 'list'], ['stn', 'list', 0], ['stn', 'list', 0, 3], ['stn', 'next'], ['prof'], ['prof', 'players'], ['prof', 'players', 0], ['clock', 't'], ['sorsko', 'level']];
  let okN = 0, failN = 0;
  for (let i = 0; i < 800; i++) {
    const d = clone(good);
    for (let j = 0, n = 1 + Math.floor(r() * 3); j < n; j++) {
      const path = paths[Math.floor(r() * paths.length)];
      let o = d;
      for (let k = 0; k < path.length - 1 && o && typeof o === 'object'; k++) o = o[path[k]];
      if (o && typeof o === 'object') o[path[path.length - 1]] = junk();
    }
    const b = rig(); b.wallets[1].coins = 9; const before = snapAll(b);
    let res; try { res = applySave(b, d); } catch (e) { throw new Error('dobott: ' + e.message + ' ' + JSON.stringify(d)); }
    if (res.ok) {
      okN++;
      assert(b.wallets.every(w => Number.isSafeInteger(balance(w)) && balance(w) >= 0), 'érvényes pénz');
      assert(b.inventories.every(inv => inv.slots.every(s => s === null || (Number.isInteger(s.n) && s.n >= 1))), 'érvényes inventory');
      assert(b.players.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), 'véges pozíció');
    } else { failN++; eq(snapAll(b), before, 'hibánál érintetlen: ' + JSON.stringify(d).slice(0, 200)); }
  }
  assert(okN > 0 && failN > 0, `mindkét ág előfordul (${okN}/${failN})`);
});

test('save S050 smoke: 600 kocka, mentés a 300.-ban, a betöltött állapot ugyanoda jut', () => {
  const play = (c, from, to) => {
    for (let f = from; f < to; f++) {
      stepClock(c.clock, DT);
      if (f % 50 === 0) { addItem(c.inventories[f % 2 === 0 ? 0 : 1], 'wood', 1); deposit(c.wallets[0], 2); addXp(c.skills, 0, 'woodcutting', 3); addCharXp(c.prog, 0, 3); }
      stepNodes(c.nodes, c.players, [{ x: 0, y: 0, interact: false }, { x: 0, y: 0, interact: false }], [null, null], c.inventories, c.clock.t, DT);
      for (const p of c.players) assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN pozíció');
    }
  };
  const a = rig(); mutate(a); a.clock.speed = 64; play(a, 0, 300);
  const st = fakeStorage(); assert(writeSave(a, st, 1).ok);
  play(a, 300, 600);
  const b = rig(); b.clock.speed = 64; assert(loadSave(b, st).ok); play(b, 300, 600);
  eq(snapAll(b), snapAll(a), 'a betöltött állapot ugyanoda jut');
  for (let i = 0; i < 20; i++) { assert(writeSave(a, st, i).ok); assert(loadSave(a, st).ok); }
  eq(snapAll(a), snapAll(b), 'ismételt mentés/betöltés nem változtat');
});
