// S077 tesztek: procedurális bánya (profil-adat, generálás sok seeden/méreten, járhatóság, mélység-skálázás, determinizmus, instance-lánc).
import { test, assert, eq } from './test-index.js';
import { T, isSolidId } from './world-tiles.js';
import { floodReach, getTile } from './world-tilemap.js';
import { findPath } from './game-pathfind.js';
import { createPlayer } from './game-player.js';
import * as I from './game-instance.js';
import * as M from './world-mine.js';

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
