// S079 tesztek: procedurális dungeon (prefab-adat, profil, generálás sok seeden/méreten, zárt ajtók + kulcsok megoldhatósága, entitások, determinizmus, instance-lánc, póráz bent).
import { test, assert, eq } from './test-index.js';
import { T, isSolidId } from './world-tiles.js';
import { getTile } from './world-tilemap.js';
import { findPath } from './game-pathfind.js';
import { createPlayer } from './game-player.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { collides } from './game-collision.js';
import { MACRO_MAP } from './data-macro.js';
import { loadMacroMap } from './world-macro.js';
import * as I from './game-instance.js';
import * as D from './world-dungeon.js';

const mkDef = (o = {}) => ({ id: 'dungeon_x', kind: 'dungeon', generator: 'dungeon', seed: 1, cols: 65, rows: 45, ...o });
const floor = id => id === T.ROAD || id === T.SAND;
const lcg = s => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const hashOf = g => { let h = 2166136261; for (const v of g.map.tiles) h = Math.imul(h ^ v, 16777619) >>> 0; return h + ':' + JSON.stringify(g.meta) + JSON.stringify([g.entry, g.exit]); };
const pf = id => D.DUNGEON_PREFABS.find(p => p.id === id);
const mut = (id, fn) => { const p = pf(id), r = p.rows.map(s => s.split('')); fn(r); return { ...p, rows: r.map(s => s.join('')) }; };
const idx = (m, x, y) => y * m.cols + x;
const at = (g, o) => idx(g.map, o.tx, o.ty);

test('dungeon adat: prefabok érvényesek, hibás prefab elutasítva (id/tags/weight/méret/jelölő/keret/nyílás/összefüggés/start/boss/szabad hely), a profil szorítva, def + generátor + szöveg regisztrálva', () => {
  const lib = D.loadPrefabs(); eq(lib.errors.length, 0); eq(lib.prefabs.length, D.DUNGEON_PREFABS.length);
  for (const t of D.DUNGEON_LIMITS.tags) assert(lib.prefabs.some(p => p.tags.includes(t)), 'van prefab: ' + t);
  assert(lib.prefabs.every(p => Object.isFrozen(p) && p.rows.length === 9 && p.rows.every(r => r.length === 13)), 'fagyasztott, 13x9');
  const dead = pf('hall').rows.map((r, y) => r.split('').map((c, x) => (c !== '#' && Math.abs(x - 6) > 1 && Math.abs(y - 4) > 1 ? 'o' : c)).join(''));
  const cases = [
    [null, 'id'], [5, 'id'], [[], 'id'], ['x', 'id'], [{ ...pf('hall'), id: 'A' }, 'id'], [{ ...pf('hall'), tags: [] }, 'tags'], [{ ...pf('hall'), tags: ['x'] }, 'tags'], [{ ...pf('hall'), tags: 'normal' }, 'tags'],
    [{ ...pf('hall'), weight: 0 }, 'weight'], [{ ...pf('hall'), weight: 11 }, 'weight'], [{ ...pf('hall'), weight: 'a' }, 'weight'],
    [{ ...pf('hall'), rows: pf('hall').rows.slice(1) }, 'size'], [{ ...pf('hall'), rows: pf('hall').rows.map((r, i) => (i === 3 ? r.slice(1) : r)) }, 'size'], [{ ...pf('hall'), rows: [...pf('hall').rows.slice(1), 5] }, 'size'],
    [mut('hall', r => { r[2][2] = 'Z'; }), 'char'], [mut('hall', r => { r[3][0] = '.'; }), 'frame'], [mut('hall', r => { r[0][4] = 'o'; }), 'frame'],
    [mut('hall', r => { r[1][6] = 'o'; }), 'lane'], [mut('hall', r => { r[4][11] = 'o'; }), 'lane'], [mut('hall', r => { r[7][5] = '#'; }), 'lane'],
    [mut('arena', r => { r[1][2] = 'o'; r[2][1] = 'o'; }), 'connected'],
    [mut('start_hall', r => { r[5][6] = '.'; }), 'start'], [mut('start_hall', r => { r[6][6] = 'S'; }), 'start'], [mut('boss_hall', r => { r[4][6] = '.'; }), 'boss'], [mut('boss_hall', r => { r[3][3] = 'B'; }), 'boss'],
    [{ ...pf('hall'), rows: dead }, 'free'],
  ];
  for (const [d, err] of cases) { const r = D.parsePrefab(d); assert(!r.ok && r.error === err && r.prefab === null, 'elutasítandó: ' + err + ' ' + JSON.stringify(d && d.id)); }
  const mix = D.loadPrefabs([{ ...pf('hall'), id: 'A' }, pf('hall'), null, 7]); eq(mix.prefabs.length, 1); eq(mix.errors.length, 3);
  eq(D.loadPrefabs(null).prefabs.length, 0); eq(D.loadPrefabs('x').errors.length, 0); eq(pf('hall').rows.join('').length, 117, 'a rows-t a parse nem módosítja');
  const d = D.sanitizeDungeonProfile(undefined); eq(d.rooms[0], D.DUNGEON_PROFILES.default.rooms[0]); assert(Object.isFrozen(d), 'fagyasztott');
  for (const bad of [null, 5, 'x', [], { rooms: [9, 3], keys: 'a', loops: [NaN, 2], chain: 9, tierBase: -3, dangerStep: Infinity, spawnsGrow: 'x', eliteDepth: 0, sandChance: 9 }]) {
    const p = D.sanitizeDungeonProfile(bad);
    assert(p.rooms[0] >= 3 && p.rooms[0] <= p.rooms[1] && p.rooms[1] <= 40 && p.chain >= 0 && p.chain <= 1 && p.tierBase >= 1 && p.eliteDepth >= 1 && Number.isFinite(p.dangerStep) && p.sandChance <= 0.5, 'szorított');
  }
  const x = D.sanitizeDungeonProfile({ rooms: [99, 120], keys: [0, 99], tierBase: 99, chain: 5, eliteDepth: 99 }); eq(x.rooms[0], 40); eq(x.keys[1], 6); eq(x.tierBase, 9); eq(x.chain, 1); eq(x.eliteDepth, 12);
  for (const k of Object.keys(D.DUNGEON_PROFILES)) { const p = D.sanitizeDungeonProfile(D.DUNGEON_PROFILES[k]); eq(JSON.stringify(p), JSON.stringify({ ...D.DUNGEON_PROFILES[k], ...p }), 'élő profil érvényes: ' + k); }
  eq(D.dungeonProfileFor(mkDef({ id: 'dungeon_ruin' })).loops[0], 1); eq(D.dungeonProfileFor(mkDef({ id: 'ismeretlen' })).loops[0], 0); eq(D.dungeonProfileFor(mkDef({ id: '__proto__' })).keys[1], 2); eq(D.dungeonProfileFor(null).rooms[1], 13);
  const reg = I.createInstanceRegistry(), def = reg.defs.get('dungeon_ruin');
  assert(def && def.kind === 'dungeon' && def.generator === 'dungeon' && typeof I.INSTANCE_GENERATORS.dungeon === 'function', 'def + generátor');
  eq(I.auditInstances(reg, loadMacroMap(MACRO_MAP).entrances).length, 0, 'az audit tiszta'); eq(reg.errors.length, 0);
  eq(Object.keys(I.INSTANCE_TEXTS.hu).sort().join(), Object.keys(I.INSTANCE_TEXTS.en).sort().join()); assert(I.INSTANCE_TEXTS.hu[def.nameKey] && I.INSTANCE_TEXTS.en[def.nameKey], 'név-kulcs HU/EN');
});

test('dungeon generálás: 2×150 seed — érvényes világ, a start az alsó sorban, a boss a legmélyebb levél, a szobák száma a profilban, a padló teljesen összefüggő', () => {
  for (const [cols, rows] of [[65, 45], [52, 36]]) for (let seed = 1; seed <= 150; seed++) {
    const def = mkDef({ seed, cols, rows }), g = D.generateDungeon(def), meta = g.meta, m = g.map, prof = D.dungeonProfileFor(def), tag = `${cols}x${rows} #${seed}`;
    const r = I.buildInstanceWorld({ ...def, nameKey: 'k' }); assert(r.ok, 'érvényes világ ' + tag + ': ' + r.error);
    const cells = meta.grid.w * meta.grid.h, lo = Math.min(prof.rooms[0], cells), hi = Math.min(prof.rooms[1], cells);
    assert(meta.roomCount >= lo && meta.roomCount <= hi && meta.rooms.length === meta.roomCount, 'szobák száma ' + tag);
    eq(meta.rooms[0].gy, meta.grid.h - 1, 'a start az alsó sorban'); eq(meta.rooms[0].role, 'start');
    const boss = meta.rooms[meta.boss.room]; eq(boss.role, 'boss'); eq(boss.depth, meta.maxDepth); assert(meta.rooms.every(q => q.depth <= meta.maxDepth), 'legmélyebb ' + tag);
    if (meta.doors.length) eq(boss.links.length, 1, 'a boss zsákutca, ha van zár');
    assert(meta.boss.placeholder === true && floor(m.tiles[at(g, meta.boss)]), 'boss-hely padló');
    const reachAll = D.dungeonReach(m, meta, g.entry, meta.doors.map(d => d.id)); let nf = 0, nr = 0;
    for (let i = 0; i < m.tiles.length; i++) if (floor(m.tiles[i])) { nf++; if (reachAll[i]) nr++; }
    eq(nr, nf, 'minden padló elérhető a zárak kinyitásával ' + tag);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) assert(floor(getTile(m, g.entry.tx + dx, g.entry.ty + dy)), 'szabad 3x3 a belépőnél');
    for (let tx = g.exit.tx; tx < g.exit.tx + g.exit.w; tx++) assert(floor(getTile(m, tx, g.exit.ty)) && isSolidId(getTile(m, tx, g.exit.ty + 1)), 'a kijárat a fal előtt');
    // ajtók, kulcsok, megoldhatóság
    const nd = meta.doors.length; eq(meta.keys.length, nd); assert(nd <= prof.keys[1], 'zárak plafonja');
    meta.doors.forEach((d, j) => {
      eq(d.id, 'd' + (j + 1)); eq(d.key, 'k' + (j + 1)); assert((d.w === 3 && d.h === 2) || (d.w === 2 && d.h === 3), 'nyílás-méret');
      for (let y = d.ty; y < d.ty + d.h; y++) for (let x = d.tx; x < d.tx + d.w; x++) assert(floor(getTile(m, x, y)), 'az ajtó padlón áll');
      const a = meta.rooms[d.a], b = meta.rooms[d.b]; eq(b.region, a.region + 1, 'a zár két régiót választ'); eq(a.region, j); eq(b.depth, a.depth + 1);
      eq(d.boss, j === nd - 1); assert(a.links.some(l => l.to === d.b && l.door === d.id) && b.links.some(l => l.to === d.a && l.door === d.id), 'link-ek');
      const k = meta.keys[j]; eq(meta.rooms[k.room].region, j, 'a kulcs a zár előtti régióban'); assert(floor(m.tiles[at(g, k)]), 'kulcs-hely padló');
      assert(D.dungeonReach(m, meta, g.entry, meta.doors.slice(0, j).map(q => q.id))[at(g, k)] === 1, 'a k. kulcs az előző ajtókkal elérhető ' + tag);
      if (j >= 1) eq(D.dungeonReach(m, meta, g.entry, meta.doors.slice(0, j - 1).map(q => q.id))[at(g, k)], 0, 'a k. kulcs a (k-1). ajtó nélkül NEM elérhető ' + tag);
    });
    if (nd) { eq(D.dungeonReach(m, meta, g.entry, [])[at(g, meta.boss)], 0, 'zárt ajtókkal a boss nem elérhető'); eq(D.dungeonReach(m, meta, g.entry, meta.doors.slice(0, nd - 1).map(q => q.id))[at(g, meta.boss)], 0, 'az utolsó ajtó nélkül sem'); }
    const sv = D.dungeonSolve(meta); assert(sv.ok && sv.reached === meta.roomCount && sv.order.length === nd, 'megoldható ' + tag); eq(sv.order.map(o => o.door).join(), meta.doors.map(q => q.id).join());
    // entitások
    const used = new Set(), put = (o, what) => { const k = o.tx + ',' + o.ty; assert(!used.has(k), 'egy hely egyszer: ' + what + ' ' + tag); used.add(k); assert(floor(m.tiles[at(g, o)]), what + ' padlón'); const rm = D.dungeonRoomAt(meta, o.tx, o.ty); assert(rm && rm.id === o.room, what + ' a saját szobájában ' + tag); return rm; };
    for (const k of meta.keys) put(k, 'kulcs'); put({ ...meta.boss }, 'boss');
    for (const c of meta.chests) { const rm = put(c, 'láda'); assert(rm.role !== 'start' && rm.role !== 'boss', 'láda nem a startban/bossnál'); assert(c.tier >= prof.tierBase && c.tier <= 9, 'láda-tier'); }
    for (const e of meta.elites) { const rm = put(e, 'elit'); assert(rm.depth >= prof.eliteDepth && rm.role !== 'start' && rm.role !== 'boss', 'elit mélysége'); }
    for (const s of meta.spawns) { const rm = put(s, 'spawn'); assert(rm.role !== 'start' && rm.role !== 'boss', 'spawn nem a startban/bossnál'); }
    assert(meta.chests.length <= prof.chests[1] && meta.elites.length <= prof.elites[1], 'darabszám-plafon');
    for (const q of meta.rooms) { assert(q.danger >= 0 && q.danger <= 1 && q.tier >= 1 && q.tier <= 9, 'veszély/tier'); if (q.role === 'boss') eq(q.danger, 1); else assert(q.danger >= prof.dangerBase - 1e-9 && q.danger <= prof.dangerBase + prof.dangerStep + 1e-9, 'veszély-sáv'); }
  }
});

test('dungeon zárak: a hurok nem kerüli meg a zárat (a régiók között nincs más él), az ajtók mélység szerint láncban, a kulcsok régiónként különbözők', () => {
  let withLocks = 0, withLoops = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const meta = D.generateDungeon(mkDef({ seed })).meta; let edges = 0, cross = 0;
    for (const r of meta.rooms) for (const l of r.links) if (l.to > r.id) { edges++; if (meta.rooms[l.to].region !== r.region) { cross++; assert(l.door, 'régióhatáron csak zárt ajtó'); } }
    eq(cross, meta.doors.length, 'régióhatár = zár'); if (meta.doors.length) withLocks++; if (edges > meta.roomCount - 1) withLoops++;
    eq(new Set(meta.keys.map(k => k.room)).size, meta.keys.length, 'a kulcsok külön szobában'); assert(meta.keys.every(k => k.room !== meta.boss.room), 'nem a bossnál');
    for (let j = 1; j < meta.doors.length; j++) assert(meta.rooms[meta.doors[j].a].depth > meta.rooms[meta.doors[j - 1].a].depth, 'a zárak mélysége nő');
  }
  assert(withLocks > 150 && withLoops > 80, 'a minta változatos: zár ' + withLocks + ', hurok ' + withLoops);
});

test('dungeon járhatóság: A* a belépőtől minden kulcshoz/ládához/elithez/ellenség-ponthoz/bosshoz a nyitott ajtókkal, zárt ajtóval a boss nem elérhető', () => {
  for (const seed of [1, 2, 3, 7901, 99, 12345]) {
    const g = D.generateDungeon(mkDef({ seed })), m = g.map, meta = g.meta, solid = (x, y) => isSolidId(getTile(m, x, y));
    const closed = (x, y) => meta.doors.some(d => x >= d.tx && x < d.tx + d.w && y >= d.ty && y < d.ty + d.h);
    const goals = [meta.boss, ...meta.keys, ...meta.chests, ...meta.elites, ...meta.spawns];
    for (const p of goals) { const r = findPath({ from: g.entry, to: { tx: p.tx, ty: p.ty }, blocked: solid, maxNodes: 80000, maxLen: 6000 }); assert(r.ok && !r.partial, 'út ' + seed + ' ' + p.tx + ',' + p.ty); }
    if (meta.doors.length) { const r = findPath({ from: g.entry, to: { tx: meta.boss.tx, ty: meta.boss.ty }, blocked: (x, y) => solid(x, y) || closed(x, y), maxNodes: 80000, maxLen: 6000 }); assert(!(r.ok && !r.partial), 'zárt ajtókkal nincs út a bosshoz ' + seed); }
    for (const d of meta.doors) assert(d.w * 32 >= 48 || d.h * 32 >= 48, 'a nyílás elég széles a két játékosnak (24 px-es testek)');
  }
});

test('dungeon determinizmus: azonos def azonos dungeon, más seed más, a sorrend nem számít, hibás profil-tár -> alap, profil-felülírás hat', () => {
  const a = D.generateDungeon(mkDef({ seed: 7901 })), b = D.generateDungeon(mkDef({ seed: 7901 })); eq(hashOf(a), hashOf(b));
  D.generateDungeon(mkDef({ seed: 5 })); eq(hashOf(D.generateDungeon(mkDef({ seed: 7901 }))), hashOf(a), 'a sorrend nem számít');
  const seen = new Set(); for (let s = 1; s <= 40; s++) seen.add(hashOf(D.generateDungeon(mkDef({ seed: s })))); assert(seen.size >= 38, 'a seedek szétszórnak: ' + seen.size);
  const n = D.generateDungeon(mkDef({ seed: 4 }), null); assert(n.meta.roomCount >= 9 && n.meta.roomCount <= 13, 'hibás profil-tár -> alap');
  const small = D.generateDungeon(mkDef({ seed: 4 }), { default: { ...D.DUNGEON_PROFILES.default, rooms: [3, 3], keys: [0, 0], loops: [0, 0] } }); eq(small.meta.roomCount, 3); eq(small.meta.doors.length, 0);
  const other = D.generateDungeon(mkDef({ id: 'dungeon_ruin', seed: 4 })); assert(other.meta.roomCount >= 9, 'id szerinti profil');
  eq(JSON.stringify(I.buildInstanceWorld({ ...mkDef({ seed: 7901 }), nameKey: 'k' }).world.meta), JSON.stringify(a.meta), 'a világ meta-ja = a generátoré');
});

test('dungeon szélsőségek: 2×2 cellás minimum, túl kis térkép -> a világ-építés "gen" hiba, 256×256 plafon, nulla elemszám, hiányzó prefab, saját prefab-lista', () => {
  const ok = I.buildInstanceWorld({ ...mkDef({ cols: 26, rows: 18 }), nameKey: 'k' }); assert(ok.ok, 'a 26x18 még elfér: ' + ok.error);
  for (const [c, r] of [[25, 18], [26, 17], [13, 9], [12, 12]]) { const b = I.buildInstanceWorld({ ...mkDef({ cols: c, rows: r }), nameKey: 'k' }); assert(!b.ok && b.error === 'gen', 'túl kicsi ' + c + 'x' + r); }
  let threw = false; try { D.generateDungeon(mkDef({ cols: 25 })); } catch (e) { threw = true; } assert(threw, 'dob');
  const big = D.generateDungeon(mkDef({ cols: 256, rows: 256, seed: 3 }), { default: { ...D.DUNGEON_PROFILES.default, rooms: [40, 40], keys: [6, 6], chests: [12, 12], elites: [8, 8], spawns: [8, 8] } });
  eq(big.meta.roomCount, 40); assert(big.meta.spawns.length <= 40 * 64 && D.dungeonSolve(big.meta).ok, 'nagy dungeon megoldható'); assert(I.buildInstanceWorld({ ...mkDef({ cols: 256, rows: 256 }), nameKey: 'k' }).ok, 'a 256x256 érvényes');
  const zero = { default: { ...D.DUNGEON_PROFILES.default, keys: [0, 0], loops: [0, 0], chests: [0, 0], elites: [0, 0], spawns: [0, 0], spawnsGrow: 0, sandChance: 0 } };
  for (let s = 1; s <= 30; s++) { const g = D.generateDungeon(mkDef({ seed: s }), zero), q = g.meta; assert(!q.doors.length && !q.keys.length && !q.chests.length && !q.elites.length && !q.spawns.length, 'nulla elem'); assert(D.dungeonSolve(q).ok && !g.map.tiles.includes(T.SAND), 'homok nélkül'); }
  const many = D.generateDungeon(mkDef({ seed: 9, cols: 39, rows: 27 }), { default: { ...D.DUNGEON_PROFILES.default, rooms: [3, 3], keys: [6, 6] } }); assert(many.meta.doors.length <= 2 && D.dungeonSolve(many.meta).ok, 'kevés szobában kevés zár');
  const deep = D.generateDungeon(mkDef({ seed: 9 }), { default: { ...D.DUNGEON_PROFILES.default, eliteDepth: 12 } }); eq(deep.meta.elites.length, 0);
  const min = D.DUNGEON_PREFABS.filter(p => ['start_hall', 'hall', 'boss_hall'].includes(p.id)), g1 = D.generateDungeon(mkDef({ seed: 2 }), undefined, min);
  assert(g1.meta.rooms.every(q => ['start_hall', 'hall', 'boss_hall'].includes(q.prefab)) && D.dungeonSolve(g1.meta).ok, 'treasure/arena nélkül a normal-ra esik vissza'); assert(g1.meta.chests.length > 0 && g1.meta.elites.length > 0, 'láda/elit a szabad helyekre');
  for (const bad of [[], null, 'x', D.DUNGEON_PREFABS.filter(p => !p.tags.includes('boss')), D.DUNGEON_PREFABS.filter(p => !p.tags.includes('start')), D.DUNGEON_PREFABS.filter(p => !p.tags.includes('normal'))]) {
    let t = false; try { D.generateDungeon(mkDef(), undefined, bad); } catch (e) { t = true; } assert(t, 'hiányzó prefab-tag -> dob');
  }
  eq(D.dungeonRoomAt(null, 1, 1), null); eq(D.dungeonRoomAt(big.meta, 0, 0), null); eq(D.dungeonRoomAt(big.meta, 1.5, 1), null); assert(D.dungeonRoomAt(big.meta, big.entry.tx, big.entry.ty).role === 'start', 'szoba a csempe szerint');
  const g2 = D.generateDungeon(mkDef({ seed: 3 })); for (const bad of [null, {}, { tx: -1, ty: 0 }, { tx: 1, ty: 1 }, { tx: 9999, ty: 0 }]) eq(D.dungeonReach(g2.map, g2.meta, bad).reduce((s, v) => s + v, 0), 0, 'fal/kívül/hibás start -> üres');
  eq(D.dungeonSolve(null).ok, false); eq(D.dungeonSolve({ rooms: [] }).ok, false);
  const broken = JSON.parse(JSON.stringify(g2.meta)); if (broken.doors.length) { broken.keys[0].room = broken.boss.room; eq(D.dungeonSolve(broken).ok, false, 'a rossz kulcs-hely megoldhatatlan'); }
});

test('dungeon fuzz: 300 véletlen def + profil (hibás mezőkkel) — vagy érvényes, megoldható világ, vagy a kis térkép "gen" hibája; sosem dob a világ-építés', () => {
  const rnd = lcg(77), junk = [null, 'x', NaN, -5, [], [1], [9, 2], {}, 1e9];
  for (let n = 0; n < 300; n++) {
    const cols = 12 + Math.floor(rnd() * 130), rows = 12 + Math.floor(rnd() * 90), def = mkDef({ seed: Math.floor(rnd() * 1e6), cols, rows, id: rnd() < 0.5 ? 'dungeon_ruin' : 'dungeon_x' });
    const prof = { ...D.DUNGEON_PROFILES.default }; for (const k of Object.keys(prof)) if (rnd() < 0.25) prof[k] = junk[Math.floor(rnd() * junk.length)];
    const small = Math.floor(cols / 13) < 2 || Math.floor(rows / 9) < 2;
    const r = I.buildInstanceWorld({ ...def, nameKey: 'k' }, undefined, { dungeon: d => D.generateDungeon(d, { default: prof }) });
    if (small) { eq(r.ok, false, 'kis térkép'); eq(r.error, 'gen'); continue; }
    assert(r.ok, 'érvényes ' + cols + 'x' + rows + ': ' + r.error); assert(D.dungeonSolve(r.world.meta).ok, 'megoldható ' + n);
  }
});

const DT = 1 / 60, EN = { id: 'e', target: 'dungeon_ruin', tx: 10, ty: 10, w: 2, h: 2 };
test('dungeon instance-lánc: valódi belépés, a világ meta-ja a def-ből, csempe ↔ fal, mentés-körút, kilépés; bent a póráz aktív és a falak tisztelve (900 kocka)', () => {
  const ps = [createPlayer(0, 0, 0), createPlayer(1, 0, 0)], ins = I.createInstanceManager();
  assert(I.enterInstance(ins, ps, EN, { force: true }).ok, 'belép');
  const w = I.instanceWorld(ins), def = I.getInstanceDef(ins.reg, 'dungeon_ruin'); eq(w.id, 'dungeon_ruin'); eq(w.kind, 'dungeon'); eq(w.cols, 65); eq(w.rows, 45);
  eq(JSON.stringify(w.meta), JSON.stringify(D.generateDungeon(def).meta), 'a meta a def-ből adódik'); eq(I.instanceWorld(ins), w, 'gyorsítótár');
  const inside = p => p.x >= w.bounds.x && p.x < w.bounds.x + w.bounds.w && p.y >= w.bounds.y && p.y < w.bounds.y + w.bounds.h;
  assert(ps.every(inside) && Math.abs(ps[0].x - ps[1].x) <= 49 && Math.abs(ps[0].x - w.entry.x) <= 25, 'a pár az érkezésnél, egymás mellett');
  const rnd = lcg(5);
  for (let k = 0; k < 400; k++) { const tx = Math.floor(rnd() * w.cols), ty = Math.floor(rnd() * w.rows); eq(I.instanceSolidAt(ins, w.ox + tx * 32 + 16, w.oy + ty * 32 + 16), isSolidId(w.map.tiles[ty * w.cols + tx]), 'csempe ↔ fal'); }
  const st = I.instanceState(ins), ins2 = I.createInstanceManager(); assert(I.restoreInstances(ins2, JSON.parse(JSON.stringify(st))), 'visszatölt'); eq(JSON.stringify(I.instanceWorld(ins2).meta), JSON.stringify(w.meta), 'ugyanaz a dungeon betöltés után');
  const walls = I.instanceColliders(ins), L = { x: 160, y: 128 }, tether = createTetherSystem({ walls, L, k: 0.5 }), dir = [[0, 0], [0, 0]]; let maxS = 0, moved = 0; const x0 = ps[0].x, y0 = ps[0].y;
  for (let f = 0; f < 900; f++) {
    if (f % 45 === 0) for (let i = 0; i < 2; i++) dir[i] = [Math.round(rnd() * 2 - 1), Math.round(rnd() * 2 - 1)];
    stepTetherSystem(tether, ps, dir.map(([x, y]) => ({ x, y })), DT);
    for (const p of ps) { assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN ' + f); assert(!collides(p, walls), 'falban ' + f); assert(inside(p), 'kiesett ' + f); }
    assert(Math.abs(ps[0].x - ps[1].x) <= L.x + 1 && Math.abs(ps[0].y - ps[1].y) <= L.y + 1, 'a távolság <= L_eff ' + f);
    maxS = Math.max(maxS, tether.stretch.x, tether.stretch.y); moved = Math.max(moved, Math.abs(ps[0].x - x0), Math.abs(ps[0].y - y0));
  }
  assert(maxS > 0.9, 'a póráz megfeszült: ' + maxS); assert(moved > 60, 'a játékosok mozogtak');
  assert(I.exitInstance(ins, ps, { force: true }).ok, 'kilép'); eq(I.instanceWhere(ins), null);
});
