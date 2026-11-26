// S077 tesztek: procedurális bánya (profil-adat, generálás sok seeden/méreten, járhatóság, mélység-skálázás, determinizmus, instance-lánc).
import { test, assert, eq } from './test-index.js';
import { T, isSolidId } from './world-tiles.js';
import { floodReach, getTile } from './world-tilemap.js';
import { findPath } from './game-pathfind.js';
import { createPlayer } from './game-player.js';
import * as I from './game-instance.js';
import * as M from './world-mine.js';
import * as MN from './game-mining.js';
import * as CT from './game-minecart.js';
import { createInventory, addItem, countItem } from './game-inventory.js';
import { createItemRegistry, ITEM_TEXTS } from './data-items.js';
import { createStatuses, applyStatus, hasStatus } from './game-status.js';
import { createPlayerHealths } from './game-health.js';
import { mapToWalls } from './world-tilemap.js';

const mkDef = (o = {}) => ({ id: 'mine_x', kind: 'mine', generator: 'mine', seed: 1, cols: 48, rows: 66, depth: 3, ...o });
const floor = id => id === T.ROAD || id === T.SAND;
const idx = (m, x, y) => y * m.cols + x;
const hashOf = g => { let h = 2166136261; for (const v of g.map.tiles) h = Math.imul(h ^ v, 16777619) >>> 0; return h + ':' + JSON.stringify(g.meta) + JSON.stringify([g.entry, g.exit]); };

test('mine adat: profilok, szorítás, hibás profil -> alap, érc-fajta, a def és a generátor regisztrálva', () => {
  const d = M.sanitizeMineProfile(undefined);
  eq(d.layers, M.MINE_PROFILES.default.layers); assert(Object.isFrozen(d), 'fagyasztott');
  for (const bad of [null, 5, 'x', [], { layers: 'a', tunnelW: NaN, bends: [3, 1], branches: 'x', ores: [1], tierStep: Infinity, dangerBase: -4 }]) {
    const p = M.sanitizeMineProfile(bad);
    assert(p.layers >= 1 && p.layers <= M.MINE_LIMITS.maxLayers && p.tunnelW >= 2 && p.tunnelW <= 5, 'szorított');
    assert(p.bends[0] <= p.bends[1] && p.dangerBase >= 0 && Number.isFinite(p.tierStep), 'pár/szám');
  }
  const x = M.sanitizeMineProfile({ layers: 99, tunnelW: 99, tierBase: 99, dangerStep: 9, tierStep: 0.5 });
  eq(x.layers, 8); eq(x.tunnelW, 5); eq(x.tierBase, 9); eq(x.dangerStep, 1); eq(x.tierStep, 0.5);
  for (const k of Object.keys(M.MINE_PROFILES)) { const p = M.sanitizeMineProfile(M.MINE_PROFILES[k]); eq(JSON.stringify(p), JSON.stringify({ ...M.MINE_PROFILES[k], ...p }), 'élő profil érvényes: ' + k); }
  eq(M.mineProfileFor(mkDef({ id: 'mine_meadow' })).tierStep, 0.5); eq(M.mineProfileFor(mkDef({ id: 'ismeretlen' })).tierStep, 1);
  eq(M.mineProfileFor(mkDef({ id: '__proto__' })).layers, 3); eq(M.mineProfileFor(null).layers, 3);
  eq(M.oreKind(1), 'copper'); eq(M.oreKind(5), 'gem'); eq(M.oreKind(9), 'gem'); eq(M.oreKind(0), 'copper'); eq(M.oreKind(NaN), 'copper');
  assert(typeof I.INSTANCE_GENERATORS.mine === 'function' && typeof I.INSTANCE_GENERATORS.room === 'function', 'generátorok');
  const reg = I.createInstanceRegistry(); eq(reg.defs.get('mine_meadow').generator, 'mine'); eq(reg.defs.get('mine_meadow').depth, 3);
  eq(I.auditInstances(reg, [{ id: 'e', target: 'mine_meadow' }]).length, 0);
});

test('mine generálás: 120 seed × méret × rétegszám — érvényes világ, keret, elérhető járatok, érc/ellenség a helyén', () => {
  for (let s = 0; s < 120; s++) {
    const def = mkDef({ seed: s * 37 + 1, cols: 12 + (s * 11) % 70, rows: 12 + (s * 17) % 110, depth: s % 7, id: s % 3 ? 'mine_x' : 'mine_meadow' });
    const r = I.buildInstanceWorld({ ...def, nameKey: 'k' }, undefined, I.INSTANCE_GENERATORS);
    assert(r.ok, 'építés ' + s + ': ' + r.error);
    const g = M.generateMine(def), m = g.map, reach = floodReach(m, g.entry.tx, g.entry.ty), meta = g.meta;
    for (let y = 0; y < m.rows; y++) for (let x = 0; x < m.cols; x++) {
      const t = m.tiles[idx(m, x, y)], edge = x === 0 || y === 0 || x === m.cols - 1 || y === m.rows - 1;
      if (edge) eq(t, T.WALL, 'keret ' + s); else assert(t === T.STONE || floor(t), 'csak kő/járat belül ' + s + ' ' + t);
      if (floor(t)) assert(reach[idx(m, x, y)], 'minden járat elérhető ' + s);
    }
    assert(meta.layerCount >= 1 && meta.layerCount <= 8 && meta.layers.length === meta.layerCount, 'rétegszám ' + s);
    let pt = -1, pd = -1;
    for (const l of meta.layers) {
      assert(l.tier >= pt && l.danger >= pd && l.danger <= 1 && l.tier >= 1 && l.tier <= 9, 'tier/veszély nem csökken ' + s); pt = l.tier; pd = l.danger;
      assert(floor(getTile(m, l.start.tx, l.start.ty)) && reach[idx(m, l.start.tx, l.start.ty)], 'réteg-start járható ' + s);
      if (l.index < meta.layerCount - 1) { assert(l.descent && floor(getTile(m, l.descent.tx, l.descent.ty)), 'akna ' + s); assert(l.descent.ty >= l.y0 && l.descent.ty < l.y1, 'akna a rétegben'); } else eq(l.descent, null);
      for (const o of l.ores) {
        eq(getTile(m, o.tx, o.ty), T.STONE, 'érc ásható kőben ' + s); eq(o.tier, l.tier); eq(o.kind, M.oreKind(l.tier));
        assert([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => floor(getTile(m, o.tx + dx, o.ty + dy))), 'az érc a járat mellett ' + s); assert(o.ty >= l.y0 && o.ty < l.y1, 'érc a rétegében');
      }
      for (const e of l.spawns) assert(floor(getTile(m, e.tx, e.ty)) && Math.abs(e.tx - l.start.tx) + Math.abs(e.ty - l.start.ty) >= 8, 'ellenség-pont járaton, a starttól távol ' + s);
      eq(new Set(l.ores.map(o => o.tx + ',' + o.ty)).size, l.ores.length, 'nincs ismétlődő érc'); eq(new Set(l.spawns.map(o => o.tx + ',' + o.ty)).size, l.spawns.length);
      assert(l.ores.every((o, i) => !i || o.ty > l.ores[i - 1].ty || (o.ty === l.ores[i - 1].ty && o.tx > l.ores[i - 1].tx)), 'rendezett');
    }
    assert(floor(getTile(m, meta.bottom.tx, meta.bottom.ty)) && reach[idx(m, meta.bottom.tx, meta.bottom.ty)], 'a mélyponti terem elérhető ' + s);
    assert(meta.bottom.ty >= meta.layers[meta.layerCount - 1].y0, 'a mélypont az utolsó rétegben');
    for (const o of meta.layers[0].ores) assert(o.ty > 7, 'a belépő terem körül nincs érc');
    assert(!isSolidId(getTile(m, g.entry.tx, g.entry.ty)), 'belépő szabad');
  }
});

test('mine mélység-skálázás: a mélységgel nő a tier, a veszély, az érc- és ellenség-pontok; a mine_meadow 1,1,2 tier', () => {
  const g = M.generateMine(mkDef({ id: 'mine_deep', seed: 9, cols: 96, rows: 150, depth: 6 }), { default: { ...M.MINE_PROFILES.default, tierStep: 1, dangerBase: 0.1, dangerStep: 0.15, oresGrow: 2, spawnsGrow: 2, ores: [6, 6], spawns: [4, 4] } });
  const L = g.meta.layers; eq(L.length, 6);
  eq(L.map(l => l.tier).join(), '1,2,3,4,5,6'); eq(L.map(l => l.danger).join(), '0.1,0.25,0.4,0.55,0.7,0.85');
  eq(L.map(l => l.kind).join(), 'copper,coal,iron,silver,gem,gem'); eq(L.map(l => l.dark).join(), 'false,true,true,true,true,true');
  assert(L[5].ores.length > L[0].ores.length && L[5].spawns.length > L[0].spawns.length, 'több érc és ellenség mélyebben');
  const mm = M.generateMine({ ...mkDef({ id: 'mine_meadow', seed: 7601 }) }).meta.layers;
  eq(mm.map(l => l.tier).join(), '1,1,2'); eq(mm.map(l => l.danger).join(), '0.1,0.3,0.5');
  eq(M.mineLayerAt(g.meta, 0), null); eq(M.mineLayerAt(g.meta, L[2].y0).index, 2); eq(M.mineLayerAt(g.meta, L[5].y1 - 1).index, 5);
  eq(M.mineLayerAt(null, 3), null); eq(M.mineLayerAt(g.meta, 1.5), null); eq(M.mineLayerAt({ layers: 5 }, 3), null);
});

test('mine determinizmus és seed-függés: azonos def azonos bánya, más seed más bánya, a sorrend nem számít', () => {
  const a = M.generateMine(mkDef({ seed: 77 })), b = M.generateMine(mkDef({ seed: 77 })); eq(hashOf(a), hashOf(b));
  M.generateMine(mkDef({ seed: 5, cols: 30, rows: 30 })); eq(hashOf(M.generateMine(mkDef({ seed: 77 }))), hashOf(a), 'nincs rejtett állapot');
  const seen = new Set(); for (let s = 0; s < 12; s++) seen.add(hashOf(M.generateMine(mkDef({ seed: s })))); eq(seen.size, 12);
  assert(hashOf(M.generateMine(mkDef({ seed: 77, depth: 4 }))) !== hashOf(a), 'a rétegszám változtat');
  assert(hashOf(M.generateMine(mkDef({ seed: 77, id: 'mine_meadow' }))) !== hashOf(a), 'a profil változtat');
});

test('mine járhatóság: A* a belépőtől minden réteg startjáig, aknáig és a mélypontig (a két játékos 24 px-es járatban elfér)', () => {
  for (const seed of [1, 2, 3, 7601, 99]) {
    const g = M.generateMine(mkDef({ seed, depth: 5, rows: 110 })), m = g.map, blocked = (tx, ty) => isSolidId(getTile(m, tx, ty));
    const goals = [g.meta.bottom, ...g.meta.layers.flatMap(l => [l.start, l.descent].filter(Boolean))];
    for (const p of goals) {
      const r = findPath({ from: g.entry, to: { tx: p.tx, ty: p.ty }, blocked, maxNodes: 60000, maxLen: 4000 });
      assert(r.ok && !r.partial, 'út a célhoz ' + seed + ' ' + p.tx + ',' + p.ty);
    }
    for (const l of g.meta.layers) { // a járat 3 tile széles: a start körül 3x3 szabad
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) assert(floor(getTile(m, l.start.tx + dx, l.start.ty + dy)), 'szabad 3x3 a startnál');
    }
  }
});

test('mine szélsőségek: minimális méret, 5 széles járat, nulla elemszám, hibás generátor-bemenet', () => {
  for (const cols of [12, 13, 14]) for (const rows of [12, 20, 21, 30]) for (const w of [2, 5]) {
    const g = M.generateMine(mkDef({ cols, rows, seed: cols * rows + w, depth: 9 }), { default: { ...M.MINE_PROFILES.default, tunnelW: w, ores: [0, 0], oresGrow: 0, spawns: [0, 0], spawnsGrow: 0, branches: [0, 0], chambers: [0, 0], bends: [0, 0] } });
    const r = I.buildInstanceWorld({ ...mkDef({ cols, rows }), nameKey: 'k' }, undefined, { mine: () => g });
    assert(r.ok, 'érvényes ' + cols + 'x' + rows + ' w' + w + ': ' + r.error); eq(g.meta.layers.every(l => !l.ores.length && !l.spawns.length), true);
  }
  assert(M.generateMine(mkDef({ rows: 12, depth: 9 })).meta.layerCount === 1, 'kis térkép: 1 réteg');
  const big = M.generateMine(mkDef({ cols: 256, rows: 256, depth: 8, seed: 3 })); eq(big.meta.layerCount, 8); assert(big.meta.layers.every(l => l.ores.length <= 64), 'plafon');
  const o = M.generateMine(mkDef({ seed: 4 }), null); assert(o.meta.layerCount === 3, 'hibás profil-tár -> alap');
  eq(I.buildInstanceWorld({ ...mkDef(), nameKey: 'k' }, undefined, I.INSTANCE_GENERATORS).ok, true);
});

test('mine instance-lánc: valódi belépés a makró-bejáraton, a világ meta-ja, a falak = csempék, kilépés, mentés-körút', () => {
  const ps = [createPlayer(0, 0, 0), createPlayer(1, 0, 0)], ins = I.createInstanceManager();
  const en = { id: 'e', target: 'mine_meadow', tx: 10, ty: 10, w: 2, h: 2 };
  assert(I.enterInstance(ins, ps, en, { force: true }).ok, 'belép');
  const w = I.instanceWorld(ins); eq(w.id, 'mine_meadow'); eq(w.kind, 'mine'); eq(w.cols, 48); eq(w.rows, 66); assert(w.meta && w.meta.layerCount === 3, 'meta a világban');
  eq(JSON.stringify(w.meta), JSON.stringify(M.generateMine(I.getInstanceDef(ins.reg, 'mine_meadow')).meta), 'a meta a def-ből adódik');
  eq(I.instanceWorld(ins), w, 'gyorsítótár'); eq(I.buildInstanceWorld(I.getInstanceDef(ins.reg, 'mine_meadow')).world.meta.layers[2].tier, 2);
  const rnd = (() => { let s = 5; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); })();
  for (let k = 0; k < 400; k++) {
    const tx = Math.floor(rnd() * w.cols), ty = Math.floor(rnd() * w.rows), solid = isSolidId(w.map.tiles[ty * w.cols + tx]);
    eq(I.instanceSolidAt(ins, w.ox + tx * 32 + 16, w.oy + ty * 32 + 16), solid, 'csempe ↔ fal');
  }
  assert(w.walls.length > 20, 'a kő falak közé került');
  const st = I.instanceState(ins); eq(JSON.parse(JSON.stringify(st)).active.id, 'mine_meadow');
  const ins2 = I.createInstanceManager(); assert(I.restoreInstances(ins2, st), 'visszatölt'); eq(JSON.stringify(I.instanceWorld(ins2).meta), JSON.stringify(w.meta), 'ugyanaz a bánya betöltés után');
  assert(I.exitInstance(ins, ps, { force: true }).ok, 'kilép'); eq(I.instanceWhere(ins), null);
});

// ---- S078: bánya-tartalom (ásás, érc, robbantás, sötétség, csille) ----
const IREG = createItemRegistry(), DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const rig = (mo, co) => {
  const ps = [createPlayer(0, 0, 0), createPlayer(1, 0, 0)], ins = I.createInstanceManager(), invs = [createInventory(IREG), createInventory(IREG)];
  assert(I.enterInstance(ins, ps, { id: 'e', target: 'mine_meadow', tx: 10, ty: 10, w: 2, h: 2 }, { force: true }).ok, 'belép');
  return { ps, ins, invs, ms: MN.createMining(mo), cm: CT.createCarts(co), drops: [], hurts: [], w: I.instanceWorld(ins) };
};
const spot = (w, tx, ty) => { // járat-csempe a kő mellett + a facing a kő felé
  for (const [dx, dy] of DIRS) { const fx = tx - dx, fy = ty - dy; if (floor(getTile(w.map, fx, fy))) return { x: w.ox + (fx + 0.5) * 32, y: w.oy + (fy + 0.5) * 32, f: { x: dx, y: dy } }; }
  return null;
};
const run = (r, who, secs, f, extra = {}) => { // a `who` játékos tartja az interakciót `secs` másodpercig
  const out = [], ctx = { facings: [f, f], drop: (item, n, x, y) => r.drops.push({ item, n, x, y }), ...extra };
  for (let t = 0; t < secs * 30 - 1e-9; t++) out.push(...MN.stepMining(r.ms, r.ins, r.ps, [{ interact: who === 0 }, { interact: who === 1 }], r.invs, 1 / 30, ctx).map(e => ({ ...e })));
  return out;
};
const wallArea = w => w.walls.reduce((a, q) => a + q.w * q.h, 0), mapArea = m => mapToWalls(m).reduce((a, q) => a + q.w * q.h, 0);
const floors = (w, l) => { const o = []; for (let y = l.y0; y < l.y1; y++) for (let x = 1; x < w.cols - 1; x++) if (floor(getTile(w.map, x, y))) o.push([x, y]); return o; };

test('mining adat: érc-tábla a bánya-fajtákra, tárgyak + HU/EN szövegek, a config fagyasztott, hibás cfg -> alap', () => {
  for (const k of M.MINE_ORE_KINDS) { const t = MN.ORE_TABLE[k]; assert(t && IREG.items.has(t[0]) && t[1] >= 1 && t[2] >= t[1], 'érc-tárgy ' + k); }
  for (const id of ['copper_ore', 'coal', 'iron_ore', 'silver_ore', 'gem', 'blast_charge']) { assert(IREG.items.has(id), id); assert(ITEM_TEXTS.hu[id] && ITEM_TEXTS.en[id], 'szöveg ' + id); }
  assert(Object.isFrozen(MN.MINING_CONFIG) && Object.isFrozen(MN.ORE_TABLE) && Object.isFrozen(CT.CART_CONFIG), 'fagyasztott');
  eq(MN.createMining(null).cfg.fuse, MN.MINING_CONFIG.fuse); eq(MN.createMining(5).cfg.reach, MN.MINING_CONFIG.reach); eq(CT.createCarts('x').cfg.cap, 40);
  const a = MN.tileDrops(MN.MINING_CONFIG, { seed: 7 }, 3, 4, { kind: 'copper', tier: 1 }), b = MN.tileDrops(MN.MINING_CONFIG, { seed: 7 }, 3, 4, { kind: 'copper', tier: 1 });
  eq(JSON.stringify(a), JSON.stringify(b), 'determinisztikus'); assert(a[0].n >= 1 && a[0].n <= 3, 'darab'); eq(MN.tileDrops(MN.MINING_CONFIG, { seed: 7 }, 3, 4, { kind: 'gem', tier: 5 }, 0.6)[0].n, 1);
  eq(MN.tileDrops(MN.MINING_CONFIG, { seed: 7 }, 3, 4, { kind: 'nincs', tier: 1 }).length, 0, 'ismeretlen fajta');
  const r = rig(); eq(MN.stepMining(r.ms, r.ins, r.ps, [], r.invs, NaN).length, 0); eq(MN.stepMining(r.ms, null, r.ps, [], r.invs, 0.1).length, 0, 'nincs instance'); eq(MN.mineWorld(r.ms, createEmpty()), null);
  function createEmpty() { return I.createInstanceManager(); }
});

test('mining ásás: csákány kell (locked egyszer), idő a sebességből, az érc a tárgy, járattá válik, a falak frissülnek, kapu-tier, tele inventory', () => {
  const r = rig(), w = r.w, o = w.meta.layers[0].ores[0], sp = spot(w, o.tx, o.ty);
  assert(sp, 'állóhely'); Object.assign(r.ps[0], { x: sp.x, y: sp.y });
  let ev = run(r, 0, 1, sp.f); eq(ev.length, 1, 'kéz: csak egy locked'); eq(ev[0].type, 'locked'); eq(ev[0].need.tier, 1); eq(ev[0].have, 0);
  assert(MN.diggable(w, o.tx, o.ty) && !MN.diggable(w, 0, 0), 'diggable'); eq(run(r, 1, 1, sp.f).length, 0, 'a társ nem nyom: semmi');
  addItem(r.invs[0], 'pickaxe', 1); const v0 = r.ins.version;
  eq(run(r, 0, 1.1, sp.f).length, 0, 'még nem kész (1,2 mp)'); ev = run(r, 0, 0.3, sp.f); eq(ev.length, 1); eq(ev[0].type, 'dug'); eq(ev[0].ore, 'copper');
  eq(getTile(w.map, o.tx, o.ty), T.ROAD); eq(I.instanceSolidAt(r.ins, w.ox + o.tx * 32 + 16, w.oy + o.ty * 32 + 16), false); assert(r.ins.version > v0, 'verzió nő');
  eq(wallArea(w), mapArea(w.map), 'a fal-lista a térképből'); eq(countItem(r.invs[0], 'copper_ore'), ev[0].items[0].n); assert(r.ins.data.get('mine_meadow').mine.dug.includes(o.ty * w.cols + o.tx), 'a zsákban');
  eq(r.ms.stats.dug, 1); eq(run(r, 0, 1, sp.f).length, 0, 'a lyuk nem diggelhető újra');
  const r2 = rig({ oreGate: 0 }), o2 = r2.w.meta.layers[2].ores[0], s2 = spot(r2.w, o2.tx, o2.ty); eq(o2.tier, 2); Object.assign(r2.ps[0], { x: s2.x, y: s2.y }); addItem(r2.invs[0], 'pickaxe', 1);
  ev = run(r2, 0, 2, s2.f); eq(ev.length, 1); eq(ev[0].type, 'locked'); eq(ev[0].need.tier, 2); eq(ev[0].have, 1, 'a tier-2 érc zárt a tier-1 csákánynak');
  const r3 = rig(), o3 = r3.w.meta.layers[0].ores[1], s3 = spot(r3.w, o3.tx, o3.ty); Object.assign(r3.ps[0], { x: s3.x, y: s3.y });
  r3.invs[0] = createInventory(IREG, 2); addItem(r3.invs[0], 'pickaxe', 1); addItem(r3.invs[0], 'axe', 1);
  ev = run(r3, 0, 3, s3.f, { drop: null }); eq(ev.filter(e => e.type === 'full').length, 1, 'tele: full egyszer'); eq(getTile(r3.w.map, o3.tx, o3.ty), T.STONE, 'a csempe megmarad');
  ev = run(r3, 0, 1, s3.f); eq(ev.length, 1); eq(ev[0].type, 'dug'); eq(r3.drops.length, 1, 'a földre esik'); eq(r3.drops[0].item, 'copper_ore');
});

test('mining mentés: a kiásott csempék a zsákból térnek vissza (új kezelő, ugyanaz a kezelő visszatöltés), a szemét-adat kiszűrve', () => {
  const r = rig(), w = r.w, ores = w.meta.layers[0].ores.slice(0, 2); addItem(r.invs[0], 'pickaxe', 1);
  const dig = o => { const sp = spot(w, o.tx, o.ty); Object.assign(r.ps[0], { x: sp.x, y: sp.y }); run(r, 0, 1.4, sp.f); };
  dig(ores[0]); const st = JSON.parse(JSON.stringify(I.instanceState(r.ins))); dig(ores[1]);
  eq(getTile(w.map, ores[1].tx, ores[1].ty), T.ROAD);
  assert(I.restoreInstances(r.ins, st), 'visszatölt'); MN.mineWorld(r.ms, r.ins);
  eq(getTile(w.map, ores[0].tx, ores[0].ty), T.ROAD, 'a mentett marad'); eq(getTile(w.map, ores[1].tx, ores[1].ty), T.STONE, 'a mentés utáni visszaáll'); eq(wallArea(w), mapArea(w.map));
  const ins2 = I.createInstanceManager(); assert(I.restoreInstances(ins2, st), 'új kezelő'); const w2 = MN.mineWorld(MN.createMining(), ins2).w; eq(getTile(w2.map, ores[0].tx, ores[0].ty), T.ROAD);
  const bad = JSON.parse(JSON.stringify(st)); bad.data.mine_meadow.mine.dug = [-1, 1.5, 'x', null, 0, 99999999, st.data.mine_meadow.mine.dug[0], st.data.mine_meadow.mine.dug[0], {}];
  const ins3 = I.createInstanceManager(); assert(I.restoreInstances(ins3, bad), 'szemét-zsák'); const m3 = MN.mineWorld(MN.createMining(), ins3);
  eq(m3.mine.dug.length, 1, 'csak az érvényes, egyszer'); eq(m3.w.map.tiles[0], T.WALL, 'a keret sértetlen');
  const ins4 = I.createInstanceManager(); assert(I.restoreInstances(ins4, { ...st, data: { mine_meadow: { mine: 'x' } } }), 'szemét-típus'); eq(MN.mineWorld(MN.createMining(), ins4).mine.dug.length, 0);
});

test('mining robbantás: kráter csak a kőből, a keret és a járat sértetlen, érc-drop, sebzés-callback, láncreakció, korlátok', () => {
  const r = rig(), w = r.w, l0 = w.meta.layers[0], fl = floors(w, l0);
  const cand = fl.find(([x, y]) => { let n = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 5.29 && getTile(w.map, x + dx, y + dy) === T.STONE) n++; return n >= 8 && y > 8; });
  const [cx, cy] = cand, X = w.ox + (cx + 0.5) * 32, Y = w.oy + (cy + 0.5) * 32, before = w.map.tiles.slice();
  const c = MN.placeCharge(r.ms, r.ins, X, Y, { owner: 1 }); assert(c.ok, 'lerak');
  const ctx = { drop: (item, n, x, y) => r.drops.push({ item, n, x, y }), hurt: h => r.hurts.push(h) };
  for (let t = 0; t < 70; t++) eq(MN.stepBlasts(r.ms, r.ins, 0.0333, ctx).length, 0, 'zsinór ég');
  let ev = []; for (let t = 0; t < 20 && !ev.length; t++) ev = MN.stepBlasts(r.ms, r.ins, 0.0333, ctx).map(e => ({ ...e }));
  eq(ev.length, 1); eq(ev[0].type, 'blast'); assert(ev[0].tiles >= 8, 'kráter'); eq(r.hurts.length, 1); eq(r.hurts[0].amount, 40); eq(r.hurts[0].r, 96); eq(r.hurts[0].owner, 1);
  let changed = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== w.map.tiles[i]) {
    const x = i % w.cols, y = (i - x) / w.cols; changed++;
    assert(before[i] === T.STONE && w.map.tiles[i] === T.ROAD && (x - cx) ** 2 + (y - cy) ** 2 <= 2.3 * 2.3, 'csak a körön belüli kő lett járat ' + x + ',' + y);
  }
  eq(changed, ev[0].tiles); eq(wallArea(w), mapArea(w.map)); for (let x = 0; x < w.cols; x++) eq(w.map.tiles[x], T.WALL, 'felső keret');
  assert(r.ms.charges.length === 0 && r.ms.stats.blasts === 1, 'a töltet elfogyott');
  for (const d of r.drops) { assert(d.n >= 1 && ['copper_ore', 'coal', 'iron_ore', 'silver_ore', 'gem'].includes(d.item), 'érc-drop'); } eq(r.drops.length, ev[0].ores);
  // láncreakció: közeli töltet követi, a távoli nem
  const r2 = rig(), f2 = floors(r2.w, r2.w.meta.layers[0]), a = f2.find(([x, y]) => floor(getTile(r2.w.map, x + 2, y)) && y > 8), far = f2.find(([x, y]) => Math.abs(x - a[0]) + Math.abs(y - a[1]) >= 12);
  const P = (t, f) => MN.placeCharge(r2.ms, r2.ins, r2.w.ox + (t[0] + 0.5) * 32, r2.w.oy + (t[1] + 0.5) * 32, { fuse: f });
  assert(P(a, 0.1).ok && P([a[0] + 2, a[1]], 5).ok && P(far, 5).ok, 'három töltet'); let n = 0;
  for (let t = 0; t < 15; t++) n += MN.stepBlasts(r2.ms, r2.ins, 0.0333, {}).length;
  eq(n, 2, 'a lánc két robbanás 0,5 mp-en belül'); eq(r2.ms.charges.length, 1, 'a távoli megmarad');
  for (let t = 0; t < 160; t++) n += MN.stepBlasts(r2.ms, r2.ins, 0.0333, {}).length; eq(n, 3, 'a távoli a maga idejében');
  const r3 = rig(); for (let k = 0; k < 8; k++) assert(MN.placeCharge(r3.ms, r3.ins, r3.w.entry.x, r3.w.entry.y).ok); eq(MN.placeCharge(r3.ms, r3.ins, r3.w.entry.x, r3.w.entry.y).reason, 'limit');
  eq(MN.placeCharge(r3.ms, r3.ins, NaN, 0).reason, 'pos'); eq(MN.placeCharge(r3.ms, r3.ins, r3.w.ox + 16, r3.w.oy + 16).reason, 'solid', 'a keretbe nem');
  eq(MN.placeCharge(MN.createMining(), I.createInstanceManager(), 0, 0).reason, 'inactive'); eq(MN.stepBlasts(r3.ms, I.createInstanceManager(), 0.1).length, 0); eq(r3.ms.charges.length, 0, 'kilépve a töltetek törlődnek');
});

test('mining sötétség: sötét rétegben FÁKLYA/FÉNY-tag/fényforrás nélkül darkness státusz, világosban nem, a valódi státusz-rendszerrel is', () => {
  const r = rig(), L = r.w.meta.layers, got = [], st = (x, y) => ({ x, y, w: 24, h: 24, vx: 0, vy: 0 });
  const at = l => [r.w.ox + (l.start.tx + 0.5) * 32, r.w.oy + (l.start.ty + 0.5) * 32];
  eq(L[0].dark, false); eq(L[1].dark, true);
  r.ps[0] = st(...at(L[0])); r.ps[1] = st(...at(L[1]));
  const ctx = { apply: (i, id, o) => got.push([i, id, o.secs]) }, step = (dt = 0.1) => MN.stepDark(r.ms, r.ins, r.ps, r.invs, dt, ctx);
  let v = step(); eq(v[0].dark, false); eq(v[0].layer, 0); eq(v[1].dark, true); eq(v[1].layer, 1); eq(got.length, 1); eq(got[0].join(), '1,darkness,3');
  for (let t = 0; t < 19; t++) step(); eq(got.length, 2, 'másodpercenként újra (darkTick)');
  addItem(r.invs[1], 'torch', 1); v = step(); eq(v[1].lit, true); eq(v[1].dark, false); const n = got.length; for (let t = 0; t < 30; t++) step(); eq(got.length, n, 'fáklyával nincs státusz');
  r.invs[1] = createInventory(IREG); r.ps[1].tags = ['FÉNY']; eq(step()[1].dark, false, 'FÉNY-tag (varázsló)'); r.ps[1].tags = []; eq(step()[1].dark, true);
  ctx.lit = () => true; eq(step()[1].dark, false, 'fényforrás'); delete ctx.lit;
  r.ps[0] = st(0, 0); eq(step()[0].layer, -1, 'a keret/nincs réteg'); r.ps[1] = null; eq(step()[1].dark, false, 'hiányzó játékos');
  eq(MN.stepDark(MN.createMining(), I.createInstanceManager(), r.ps, r.invs, 0.1, ctx)[0].dark, false, 'bányán kívül nincs sötét');
  const ss = createStatuses({ healths: createPlayerHealths(r.ps.map((p, i) => p || st(0, 0))) }); r.ps[1] = st(...at(L[2]));
  MN.stepDark(r.ms, r.ins, r.ps, r.invs, 0.1, { apply: (i, id, o) => applyStatus(ss, i, id, o) }); assert(hasStatus(ss, 1, 'darkness'), 'valódi státusz');
});

test('csille: automata sín-vonal rétegenként, meglökés -> a sín végéig megy és megáll, teher/kapacitás, lerakodás, mentés-körút, szemét-zsák', () => {
  const r = rig(), cw = CT.cartWorld(r.cm, r.ins), w = r.w, L = w.meta.layers;
  eq(r.cm.carts.length, 3); assert(r.cm.rails.size >= 30, 'sínek'); eq(r.ins.data.get('mine_meadow').cart.v, 1, 'a zsákban');
  const end = l => l.descent || w.meta.bottom;
  for (const [k, l] of L.entries()) {
    const c = r.cm.carts[k]; eq(c.tx + ',' + c.ty, l.start.tx + ',' + l.start.ty);
    const d = DIRS.findIndex((_, i) => CT.railAt(r.cm, w, c.tx + DIRS[i][0], c.ty + DIRS[i][1])); assert(d >= 0, 'van sín a start mellett');
    assert(CT.pushCart(r.cm, r.ins, c.id, d).ok, 'meglök'); const evs = []; for (let t = 0; t < 400 && c.dir >= 0; t++) evs.push(...CT.stepCarts(r.cm, r.ins, 0.05).map(e => ({ ...e })));
    eq(c.dir, -1, 'megáll'); eq(c.tx + ',' + c.ty, end(l).tx + ',' + end(l).ty, 'a sín végén áll (akna/mélypont)'); eq(evs[evs.length - 1].type, 'stopped'); assert(evs.filter(e => e.type === 'moved').length >= 5, 'haladt');
  }
  const rt = CT.routeTiles(w.map, L[0].start, end(L[0])), ex = rt[rt.length - 1] % w.cols, ey = (rt[rt.length - 1] - ex) / w.cols, pvx = rt[rt.length - 2] % w.cols, pvy = (rt[rt.length - 2] - pvx) / w.cols;
  const perp = DIRS.map(([dx, dy]) => [ex + dx, ey + dy]).filter(([x, y]) => (x - ex) * (ex - pvx) + (y - ey) * (ey - pvy) === 0 && floor(getTile(w.map, x, y)) && !CT.railAt(r.cm, w, x, y));
  assert(perp.length >= 2, 'két oldalsó járat-csempe'); for (const [x, y] of perp.slice(0, 2)) assert(CT.placeRail(r.cm, r.ins, x, y).ok);
  const goes = d => { assert(CT.pushCart(r.cm, r.ins, r.cm.carts[0].id, d).ok); for (let t = 0; t < 400 && r.cm.carts[0].dir >= 0; t++) CT.stepCarts(r.cm, r.ins, 0.05); return r.cm.carts[0].tx + ',' + r.cm.carts[0].ty; };
  eq(goes(DIRS.findIndex(([dx, dy]) => ex + dx === pvx && ey + dy === pvy)), L[0].start.tx + ',' + L[0].start.ty, 'vissza a startig'); const nx = rt[1] % w.cols, ny = (rt[1] - nx) / w.cols; eq(goes(DIRS.findIndex(([dx, dy]) => L[0].start.tx + dx === nx && L[0].start.ty + dy === ny)), ex + ',' + ey, 'az elágazásnál megáll');
  for (const [x, y] of perp.slice(0, 2)) r.cm.rails.delete(y * w.cols + x);
  const c0 = r.cm.carts[0]; eq(CT.pushCart(r.cm, r.ins, c0.id, 9).reason, 'dir'); eq(CT.pushCart(r.cm, r.ins, 999, 0).reason, 'cart'); eq(CT.pushCart(r.cm, r.ins, c0.id, DIRS.findIndex((_, i) => !CT.railAt(r.cm, w, c0.tx + DIRS[i][0], c0.ty + DIRS[i][1]))).reason, 'norail');
  eq(CT.loadCart(r.cm, r.ins, c0.id, 'copper_ore', 30), 30); eq(CT.loadCart(r.cm, r.ins, c0.id, 'coal', 20), 10, 'kapacitás 40'); eq(CT.loadCart(r.cm, r.ins, c0.id, 'coal', 1), 0); eq(CT.loadCart(r.cm, r.ins, c0.id, '', 1), 0); eq(CT.loadCart(r.cm, r.ins, c0.id, 'x', 0), 0);
  const p = CT.cartPos(r.cm, w, c0); eq(CT.nearCart(r.cm, r.ins, p.x + 10, p.y), c0); eq(CT.nearCart(r.cm, r.ins, p.x + 900, p.y), null); eq(CT.nearCart(r.cm, r.ins, NaN, 0), null);
  const st = JSON.parse(JSON.stringify(I.instanceState(r.ins))), ins2 = I.createInstanceManager(); assert(I.restoreInstances(ins2, st), 'visszatölt'); const cm2 = CT.createCarts(); CT.cartWorld(cm2, ins2);
  eq(cm2.carts.length, 3); eq(cm2.rails.size, r.cm.rails.size); eq(cm2.carts[0].tx + ',' + cm2.carts[0].ty, c0.tx + ',' + c0.ty); eq(cm2.carts[0].load.copper_ore, 30); eq(cm2.carts[0].load.coal, 10);
  const inv = createInventory(IREG, 1), drops = []; eq(CT.unloadCart(r.cm, r.ins, c0.id, inv, (i, n) => drops.push([i, n])), 40); eq(countItem(inv, 'copper_ore') + drops.reduce((a, d) => a + d[1], 0) + countItem(inv, 'coal'), 40); eq(Object.keys(c0.load).length, 0);
  eq(CT.unloadCart(r.cm, r.ins, c0.id, null, null), 0, 'üres');
  const t0 = r.cm.rails.size, o = L[0].ores[0]; eq(CT.placeRail(r.cm, r.ins, o.tx, o.ty).reason, 'tile', 'kőre nem'); const f = floors(w, L[0]).find(([x, y]) => !CT.railAt(r.cm, w, x, y)); assert(CT.placeRail(r.cm, r.ins, f[0], f[1]).ok); eq(r.cm.rails.size, t0 + 1); eq(CT.placeRail(r.cm, r.ins, f[0], f[1]).reason, 'have'); eq(CT.placeRail(r.cm, r.ins, 1.5, 2).reason, 'tile');
  const bad = JSON.parse(JSON.stringify(st)); bad.data.mine_meadow.cart = { v: 1, rails: [-3, 0.5, 'a', null, 1, 99999999, ...st.data.mine_meadow.cart.rails.slice(0, 5)], carts: [{ x: 'a', y: 1 }, null, { x: 0, y: 0, l: {} }, { x: 1, y: 1, l: { a: 999, b: -2 } }] };
  const ins3 = I.createInstanceManager(); assert(I.restoreInstances(ins3, bad), 'szemét-zsák'); const cm3 = CT.createCarts(); CT.cartWorld(cm3, ins3);
  assert(cm3.rails.size <= 5 && cm3.carts.length === 0, 'csak az érvényes sín, rossz csille kiesik'); eq(CT.cartWorld(CT.createCarts(), I.createInstanceManager()), null); eq(CT.stepCarts(CT.createCarts(), I.createInstanceManager(), 0.1).length, 0);
});

test('bánya-tartalom fuzz: 2400 lépés véletlen ásással/töltettel/csillével — nincs NaN, a keret sértetlen, a fal-lista a térképből, a zsák kicsi és körútba hibátlan, determinista', () => {
  const sim = () => {
    const r = rig(), w = r.w; let s = 11; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (const inv of r.invs) { addItem(inv, 'pickaxe', 1); addItem(inv, 'torch', 1); }
    const allFloor = w.meta.layers.flatMap(l => floors(w, l)), ctx = { drop: () => {}, hurt: () => {} };
    for (let k = 0; k < 2400; k++) {
      if (k % 40 === 0) for (const p of r.ps) { const [x, y] = allFloor[Math.floor(rnd() * allFloor.length)]; p.x = w.ox + (x + 0.5) * 32; p.y = w.oy + (y + 0.5) * 32; }
      const f = { x: [1, 0, -1, 0][k % 4 | 0], y: [0, 1, 0, -1][(k >> 2) % 4] };
      MN.stepMining(r.ms, r.ins, r.ps, [{ interact: rnd() < 0.8 }, { interact: rnd() < 0.8 }], r.invs, 1 / 30, { ...ctx, facings: [f, f] });
      if (k % 97 === 0) { const [x, y] = allFloor[Math.floor(rnd() * allFloor.length)]; MN.placeCharge(r.ms, r.ins, w.ox + (x + 0.5) * 32, w.oy + (y + 0.5) * 32, { fuse: rnd() }); }
      MN.stepBlasts(r.ms, r.ins, 1 / 30, ctx); MN.stepDark(r.ms, r.ins, r.ps, r.invs, 1 / 30, {});
      if (k % 53 === 0 && r.cm.carts.length) CT.pushCart(r.cm, r.ins, r.cm.carts[k % r.cm.carts.length].id, k % 4);
      CT.stepCarts(r.cm, r.ins, 1 / 30);
    }
    const t = w.map.tiles; for (let i = 0; i < t.length; i++) assert(t[i] <= T.SAND, 'érvényes csempe');
    for (let x = 0; x < w.cols; x++) { eq(t[x], T.WALL); eq(t[(w.rows - 1) * w.cols + x], T.WALL); } for (let y = 0; y < w.rows; y++) { eq(t[y * w.cols], T.WALL); eq(t[y * w.cols + w.cols - 1], T.WALL); }
    eq(wallArea(w), mapArea(w.map), 'fal-lista'); const z = r.ins.data.get('mine_meadow'); assert(JSON.stringify(z).length < 65536, 'a zsák a plafon alatt'); eq(new Set(z.mine.dug).size, z.mine.dug.length);
    for (const c of r.cm.carts) assert(Number.isFinite(c.prog) && c.prog >= 0 && c.prog < 1.0001, 'csille-haladás');
    const ins2 = I.createInstanceManager(); assert(I.restoreInstances(ins2, JSON.parse(JSON.stringify(I.instanceState(r.ins)))), 'körút'); const w2 = MN.mineWorld(MN.createMining(), ins2).w;
    eq(w2.map.tiles.join(), t.join(), 'a mentés-betöltés ugyanazt a bányát adja'); return z.mine.dug.length + ':' + r.ms.stats.blasts + ':' + r.cm.stats.moved + ':' + t.reduce((a, v, i) => (a + v * (i % 7 + 1)) | 0, 0);
  };
  const a = sim(); eq(sim(), a, 'determinista'); assert(Number(a.split(':')[0]) > 0, 'ásott is');
});
