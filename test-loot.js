// Loot-táblák tesztjei (S071). Importja: test-index.js, game-loot.js, data-items.js, game-grounditems.js, game-enemy.js, game-spawn.js, game-inventory.js, game-player.js
import { test, assert, eq } from './test-index.js';
import {
  LOOT_DEFS, LOOT_ENEMY, LOOT_LIMITS, validateLootTable, createLootRegistry, getLootTable, auditLoot, rollTable, createLoot, onLoot, rollLoot, dropLoot,
  spawnLevel, enemyLoot, connectLoot, createContainers, containersNear, openContainer, containerOpened, containersState, restoreContainers,
} from './game-loot.js';
import { ITEM_DEFS, createItemRegistry } from './data-items.js';
import { createGroundItems, stepGround, groundCount } from './game-grounditems.js';
import { ENEMY_DEFS, createEnemyRegistry, createEnemySystem, spawnEnemy, damageEnemy, stepEnemies } from './game-enemy.js';
import { createPlayerHealths } from './game-health.js';
import { SPAWN_TABLES } from './game-spawn.js';
import { createInventory, countItem } from './game-inventory.js';
import { createPlayer } from './game-player.js';

const ITEMS = createItemRegistry(ITEM_DEFS);
const REG = createLootRegistry();
const mk = (o = {}) => validateLootTable({ id: 'tt', rolls: [1, 1], entries: [{ item: 'wood', min: 1, max: 1, weight: 1 }], ...o });
const tbl = o => { const r = mk(o); assert(r.ok, 'tábla: ' + r.error); return r.table; };
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
// halál: a 'died' esemény a következő stepEnemies-ben jön (az S067 szerint)
const ENV = { walls: [], solidTile: () => false };
function kill(es, e, player = 0) { damageEnemy(es, e, 99999, { player }); stepEnemies(es, [createPlayer(0, 1e5, 1e5), createPlayer(1, 1e5, 1e5)], 1 / 60, ENV); }
const total = drops => drops.reduce((a, d) => a + d.n, 0);

test('loot: az élő adat érvényes, nincs hiányzó tárgy/ellenség-tábla, minden spawn-típusnak van táblája', () => {
  eq(REG.errors.length, 0, REG.errors.join()); eq(REG.dups.size, 0); eq(REG.tables.size, LOOT_DEFS.length);
  eq(auditLoot(REG, ITEMS, createEnemyRegistry(ENEMY_DEFS)).length, 0, auditLoot(REG, ITEMS, createEnemyRegistry(ENEMY_DEFS)).join());
  for (const r of Object.values(SPAWN_TABLES)) for (const e of r.entries) assert(LOOT_ENEMY[e.type] && getLootTable(REG, LOOT_ENEMY[e.type]), 'nincs loot: ' + e.type);
  assert(getLootTable(REG, 'meadow_crate') && getLootTable(REG, 'meadow_chest'), 'konténer-táblák');
  eq(getLootTable(REG, 'nincs'), null); eq(getLootTable(null, 'boar'), null);
  assert(auditLoot(createLootRegistry([{ id: 'xx', entries: [{ item: 'nincs_ilyen', min: 1, max: 1, weight: 1 }] }]), ITEMS).includes('xx:nincs_ilyen'), 'audit: hiányzó tárgy');
  assert(auditLoot(createLootRegistry([]), ITEMS, createEnemyRegistry(ENEMY_DEFS)).includes('boar:table'), 'audit: nincs tábla');
  assert(auditLoot(REG, ITEMS, createEnemyRegistry(ENEMY_DEFS), {}).includes('boar:notable'), 'audit: nincs leképezés');
});

test('loot: validáció – alapok, hibás mezők, fagyasztott, sosem dob', () => {
  const t = tbl({}); eq(t.level, 1); eq(t.scale, 0); eq(t.nothing, 0); assert(Object.isFrozen(t) && Object.isFrozen(t.entries) && Object.isFrozen(t.entries[0]));
  const bad = [mk({ rolls: [2, 1] }).ok, mk({ rolls: [0, 99] }).ok, mk({ nothing: -1 }).ok, mk({ nothing: NaN }).ok, mk({ scale: 2 }).ok,
    mk({ level: 0 }).ok, mk({ level: 61 }).ok, mk({ level: 1.5 }).ok, mk({ entries: [{ item: 'Wood', min: 1, max: 1, weight: 1 }] }).ok, mk({ entries: [{ item: 'wood', min: 0, max: 1, weight: 1 }] }).ok,
    mk({ entries: [{ item: 'wood', min: 3, max: 2, weight: 1 }] }).ok, mk({ entries: [{ item: 'wood', min: 1, max: 1, weight: 0 }] }).ok, mk({ entries: [{ item: 'wood', min: 1, max: 1, weight: Infinity }] }).ok,
    mk({ entries: [{ item: 'wood', min: 1, max: 1, weight: 1, levels: [5, 2] }] }).ok, mk({ entries: [{ item: 'wood', min: 1, max: 1, weight: 1, levels: [0, 5] }] }).ok,
    mk({ entries: [{ item: 'wood', min: 1, max: 1, weight: 1.5 }, null] }).ok, mk({ always: [{ item: 'wood', min: 1, max: 1, chance: 2 }] }).ok, mk({ entries: [] }).ok,
    mk({ entries: Array.from({ length: 70 }, () => ({ item: 'wood', min: 1, max: 1, weight: 1 })) }).ok];
  eq(bad.length, 19); for (let i = 0; i < bad.length; i++) eq(bad[i], false, 'hibásat fogadott el: #' + i);
  for (const d of [null, 'x', 7, {}, { id: 'A' }, { id: 'ok' }]) eq(validateLootTable(d).ok, false);
  eq(mk({ rolls: [0, 0], entries: [] }).ok, true, '0 húzás üres készlettel rendben');
  const reg = createLootRegistry([{ id: 'aa', entries: [{ item: 'wood', min: 1, max: 1, weight: 1 }] }, { id: 'aa', entries: [{ item: 'stone', min: 1, max: 1, weight: 1 }] }, { id: 'B' }, null]);
  eq(reg.tables.size, 1); assert(reg.dups.has('aa')); eq(reg.errors.length, 2); eq(reg.tables.get('aa').entries[0].item, 'stone');
  eq(createLootRegistry({ aa: { entries: [{ item: 'wood', min: 1, max: 1, weight: 1 }] } }).tables.size, 1, 'objektum-forma');
  eq(createLootRegistry('szemét').tables.size, 0);
});

test('loot: rollTable determinisztikus; kulcs / számláló / seed változtatja; hibás bemenet -> üres', () => {
  const t = getLootTable(REG, 'meadow_crate'), a = JSON.stringify(rollTable(t, { seed: 5, key: 'k', n: 2, level: 3 }));
  eq(JSON.stringify(rollTable(t, { seed: 5, key: 'k', n: 2, level: 3 })), a);
  const seen = new Set(); for (let n = 0; n < 40; n++) seen.add(JSON.stringify(rollTable(t, { seed: 5, key: 'k', n })));
  assert(seen.size > 5, 'a számláló változatossá tesz: ' + seen.size);
  const ks = new Set(); for (let k = 0; k < 40; k++) ks.add(JSON.stringify(rollTable(t, { seed: 5, key: 'k' + k })));
  assert(ks.size > 5, 'a kulcs változtat'); const ss = new Set(); for (let s = 0; s < 40; s++) ss.add(JSON.stringify(rollTable(t, { seed: s, key: 'k' })));
  assert(ss.size > 5, 'a seed változtat');
  for (const bad of [null, undefined, {}, 'x', { entries: 1, always: [] }]) eq(rollTable(bad).length, 0);
  for (const o of [undefined, null, 5, { level: NaN, n: 'x', key: {}, seed: 'y' }]) for (const d of rollTable(t, o)) assert(Number.isInteger(d.n) && d.n >= 1 && ITEMS.items.has(d.item));
});

test('loot: a súlyok és az "üres" húzás aránya a sorsolásban', () => {
  const t = tbl({ nothing: 4, entries: [{ item: 'wood', min: 1, max: 1, weight: 3 }, { item: 'stone', min: 1, max: 1, weight: 1 }] }), c = { wood: 0, stone: 0, none: 0 }, N = 40000;
  for (let n = 0; n < N; n++) { const d = rollTable(t, { seed: 9, key: 'w', n }); if (!d.length) c.none++; else c[d[0].item]++; }
  const near = (got, want) => assert(Math.abs(got / N - want) < 0.015, `arány ${got / N} ~ ${want}`);
  near(c.none, 4 / 8); near(c.wood, 3 / 8); near(c.stone, 1 / 8);
  const only = tbl({ nothing: 0, entries: [{ item: 'wood', min: 1, max: 1, weight: 1 }] }); for (let n = 0; n < 200; n++) eq(rollTable(only, { n }).length, 1, 'nothing 0 -> mindig van');
  const empty = tbl({ rolls: [0, 0], entries: [] }); eq(rollTable(empty, { n: 1 }).length, 0);
});

test('loot: a szint-ablak (zárt intervallum) kiszűri a tételt; az RNG-fogyasztás az ablaktól független', () => {
  const t = tbl({ entries: [{ item: 'wood', min: 1, max: 1, weight: 1 }, { item: 'stone', min: 1, max: 1, weight: 1, levels: [4, 6] }], rolls: [3, 3] });
  const has = (lv, item) => { for (let n = 0; n < 300; n++) if (rollTable(t, { seed: 1, key: 'a', n, level: lv }).some(d => d.item === item)) return true; return false; };
  for (const lv of [1, 3, 7, 60]) eq(has(lv, 'stone'), false, 'ablakon kívül: ' + lv);
  for (const lv of [4, 5, 6]) eq(has(lv, 'stone'), true, 'ablakon belül: ' + lv);
  const x = tbl({ rolls: [2, 2], always: [{ item: 'rope', min: 1, max: 1, chance: 0.5, levels: [9, 9] }], entries: [{ item: 'wood', min: 1, max: 1, weight: 1 }] });
  for (let n = 0; n < 50; n++) eq(rollTable(x, { n, level: 1 }).find(d => d.item === 'wood').n, 2, 'a kiesett always nem tolja el a húzásokat');
  const rg = tbl({ rolls: [1, 3], always: [{ item: 'rope', min: 1, max: 1, chance: 0, levels: [9, 9] }], entries: [{ item: 'wood', min: 1, max: 4, weight: 2 }, { item: 'stone', min: 1, max: 4, weight: 1 }] });
  for (let n = 0; n < 200; n++) eq(JSON.stringify(rollTable(rg, { seed: 2, key: 'g', n, level: 1 })), JSON.stringify(rollTable(rg, { seed: 2, key: 'g', n, level: 9 })), 'az ablakon kívüli always is fogyasztja az RNG-t (n=' + n + ')');
  const boar = getLootTable(REG, 'boar'); let torch1 = 0, torch8 = 0;
  for (let n = 0; n < 2000; n++) { if (rollTable(boar, { seed: 3, key: 'b', n, level: 2 }).some(d => d.item === 'torch')) torch1++; if (rollTable(boar, { seed: 3, key: 'b', n, level: 8 }).some(d => d.item === 'torch')) torch8++; }
  eq(torch1, 0, 'alacsony szinten nincs fáklya'); assert(torch8 > 50, 'magas szinten van: ' + torch8);
});

test('loot: szint-skála (mennyiség), alap-szint, always esély, húzás-szám tartomány', () => {
  const t = tbl({ scale: 0.5, entries: [{ item: 'wood', min: 2, max: 2, weight: 1 }] });
  eq(rollTable(t, { level: 1 })[0].n, 2); eq(rollTable(t, { level: 5 })[0].n, 6); eq(rollTable(t, { level: 999 })[0].n, rollTable(t, { level: 60 })[0].n, 'a szint 60-ra szorul'); eq(rollTable(t, { level: 60 })[0].n, Math.floor(2 * (1 + 0.5 * 59) + 0.5), 'plafon-szint');
  const big = tbl({ scale: 1, entries: [{ item: 'wood', min: 999, max: 999, weight: 1 }] }); eq(rollTable(big, { level: 60 })[0].n, LOOT_LIMITS.maxAmount, 'mennyiség-plafon');
  const dflt = tbl({ level: 5, scale: 1, entries: [{ item: 'wood', min: 1, max: 1, weight: 1 }] }); eq(rollTable(dflt, {})[0].n, 5, 'alap-szint a táblából'); eq(rollTable(dflt, { level: NaN })[0].n, 5);
  const a = tbl({ always: [{ item: 'rope', min: 1, max: 1, chance: 0.25 }], rolls: [0, 0], entries: [] }); let hit = 0; for (let n = 0; n < 8000; n++) hit += rollTable(a, { n, key: 'q' }).length;
  assert(Math.abs(hit / 8000 - 0.25) < 0.03, 'always esély: ' + hit / 8000);
  const never = tbl({ always: [{ item: 'rope', min: 1, max: 1, chance: 0 }], rolls: [0, 0], entries: [] }), sure = tbl({ always: [{ item: 'rope', min: 1, max: 1 }], rolls: [0, 0], entries: [] });
  for (let n = 0; n < 100; n++) { eq(rollTable(never, { n }).length, 0); eq(rollTable(sure, { n }).length, 1); }
  const r = tbl({ rolls: [2, 4], entries: [{ item: 'wood', min: 1, max: 1, weight: 1 }] }), cnt = new Set(); for (let n = 0; n < 400; n++) cnt.add(rollTable(r, { n, key: 'r' })[0].n);
  eq([...cnt].sort().join(), '2,3,4', 'húzás-szám 2..4');
  const m = tbl({ rolls: [3, 3], entries: [{ item: 'wood', min: 1, max: 1, weight: 1 }, { item: 'stone', min: 1, max: 1, weight: 1 }] });
  for (let n = 0; n < 100; n++) { const d = rollTable(m, { n }); eq(new Set(d.map(x => x.item)).size, d.length, 'összevont'); eq(total(d), 3); }
});

test('loot: rendszer – rollLoot, számláló, statisztika, figyelők, ismeretlen tábla', () => {
  const ls = createLoot({ seed: 77 }), ev = []; const off = onLoot(ls, e => ev.push(e)); onLoot(ls, () => { throw new Error('hibás figyelő'); });
  const r1 = rollLoot(ls, 'meadow_crate', { key: 'a', level: 2, x: 5, y: 6 }), r2 = rollLoot(ls, 'meadow_crate', { key: 'a', level: 2 });
  assert(r1.ok && r2.ok); eq(ls.counter, 2); eq(ev.length, 2); eq(ev[0].type, 'loot'); eq(ev[0].table, 'meadow_crate'); eq(ev[0].level, 2); eq(ev[0].x, 5); eq(ev[1].x, null); eq(ev[0].source, 'roll');
  assert(ls.lastError instanceof Error, 'a hibázó figyelő nem állít meg'); eq(ls.stats.rolls, 2); eq(ls.stats.units, total(r1.drops) + total(r2.drops));
  ev[0].drops.length = 0; eq(ev.length, 2); // az esemény másolat
  const fixed = [rollLoot(ls, 'meadow_crate', { key: 'a', n: 4 }).drops, rollLoot(ls, 'meadow_crate', { key: 'a', n: 4 }).drops]; eq(JSON.stringify(fixed[0]), JSON.stringify(fixed[1]), 'rögzített n -> azonos'); eq(ls.counter, 2, 'a rögzített n nem lépteti a számlálót');
  for (const b of ['nincs', undefined, null, 5]) { const r = rollLoot(ls, b); eq(r.ok, false); eq(r.reason, 'table'); }
  eq(rollLoot(null, 'boar').ok, false); eq(rollLoot(ls, 'boar', null).ok, true); eq(rollLoot(ls, 'boar', { level: 'x' }).level, getLootTable(REG, 'boar').level);
  off(); const n = ev.length; rollLoot(ls, 'boar'); eq(ev.length, n, 'leiratkozás');
  eq(createLoot({ reg: 'szemét' }).reg.tables.size, LOOT_DEFS.length); eq(createLoot().seed, 1);
});

test('loot: dropLoot – a földre esik, a darabszám egyezik, a játékos felveszi', () => {
  const gs = createGroundItems(), ls = createLoot({ seed: 3 }), drops = [{ item: 'wood', n: 130 }, { item: 'fiber', n: 4 }, { item: 'rope', n: 2 }];
  eq(dropLoot(ls, gs, drops, 400, 300), 0); eq(gs.stats.dropped, 136); assert(groundCount(gs) >= 4, 'stack-határ szerint bomlik: ' + groundCount(gs));
  for (const it of gs.items) { eq(it.x, 400); eq(it.y, 300); eq(it.noPick, -1, 'bárki felveheti'); assert(it.delay > 0 && it.delay < 1, 'rövid késleltetés'); assert(it.vx !== 0 || it.vy !== 0, 'szétszórva'); }
  eq(dropLoot(ls, gs, drops, NaN, 3), 0); eq(dropLoot(ls, null, drops, 1, 1), 136, 'nincs föld -> minden elvész, jelzi'); eq(dropLoot(ls, gs, 'x', 1, 1), 0); eq(dropLoot(ls, gs, [null, { item: 'wood', n: 0 }, { item: 'wood', n: 1.5 }, { item: 'nincs', n: 2 }], 1, 1), 2, 'ismeretlen tárgy elvész');
  eq(ls.stats.lost, 136 + 2);
  const p = createPlayer(0, 400, 300), inv = createInventory(); const walls = [];
  for (let i = 0; i < 600; i++) stepGround(gs, [p, createPlayer(1, 9000, 9000)], [inv, createInventory()], 1 / 60, walls);
  eq(countItem(inv, 'wood'), 130); eq(countItem(inv, 'fiber'), 4); eq(countItem(inv, 'rope'), 2); eq(groundCount(gs), 0);
});

test('loot: spawnLevel, enemyLoot és connectLoot – a holttest helyére esik, a szint a spawn-táblából jön', () => {
  eq(spawnLevel(SPAWN_TABLES, 'boar'), 7); eq(spawnLevel(SPAWN_TABLES, 'field_rat'), 4); eq(spawnLevel(SPAWN_TABLES, 'grunt'), null); eq(spawnLevel(null, 'boar'), null); eq(spawnLevel({ a: null, b: { entries: 5 } }, 'x'), null);
  const gs = createGroundItems(), ls = createLoot({ seed: 11 }), es = createEnemySystem({ seed: 1 }), evs = []; onLoot(ls, e => evs.push(e));
  const off = connectLoot(ls, es, { ground: gs, spawnTables: SPAWN_TABLES });
  let units = 0;
  for (let i = 0; i < 60; i++) { const b = spawnEnemy(es, 'boar', 1000 + i, 2000 + i * 2); assert(b); kill(es, b, 0); }
  for (const e of evs) { eq(e.source, 'enemy'); eq(e.level, 7); eq(e.table, 'boar'); units += total(e.drops); }
  eq(evs.length, 60); assert(units > 20, 'a vaddisznók néha dobnak: ' + units); eq(gs.stats.dropped, units); for (const it of gs.items) assert(it.x >= 1000 && it.x < 1060 && it.y >= 2000, 'a holttest helyén');
  const before = evs.length; off(); kill(es, spawnEnemy(es, 'boar', 0, 0), 1); eq(evs.length, before, 'leiratkozás után nincs loot');
  const ls2 = createLoot({ seed: 2 }), es2 = createEnemySystem({ seed: 1 }), gs2 = createGroundItems(), seen = []; onLoot(ls2, e => seen.push(e));
  connectLoot(ls2, es2, { ground: gs2, map: {}, levelOf: () => 3 }); kill(es2, spawnEnemy(es2, 'grunt', 5, 5)); eq(seen.length, 0, 'leképezés nélkül nincs loot');
  const ls3 = createLoot({ seed: 2 }), es3 = createEnemySystem({ seed: 1 }), seen3 = []; onLoot(ls3, e => seen3.push(e));
  connectLoot(ls3, es3, { ground: createGroundItems(), levelOf: e => (e.type === 'grunt' ? 9 : 1) }); kill(es3, spawnEnemy(es3, 'grunt', 5, 5)); eq(seen3[0].level, 9, 'levelOf felülír');
  const ls4 = createLoot({ seed: 2 }), es4 = createEnemySystem({ seed: 1 }), seen4 = []; onLoot(ls4, e => seen4.push(e));
  connectLoot(ls4, es4, { ground: createGroundItems(), levelOf: () => { throw new Error('rossz'); } }); kill(es4, spawnEnemy(es4, 'boar', 5, 5)); eq(seen4.length, 1, 'hibás levelOf nem dob'); eq(seen4[0].level, getLootTable(REG, 'boar').level);
  for (const bad of [null, undefined, {}, { x: 1 }, { x: NaN, y: 1, type: 'boar' }, { x: 1, y: 1, type: '__proto__' }]) eq(enemyLoot(ls, gs, bad).ok, false);
  eq(typeof connectLoot(null, es), 'function'); eq(typeof connectLoot(ls, null), 'function');
});

test('loot: konténer – egyszer nyitható, a tartalom a (seed, id)-ből adódik, nem a sorrendtől', () => {
  const list = [{ id: 'c1', table: 'meadow_chest', x: 100, y: 100, level: 5 }, { id: 'c2', table: 'meadow_crate', x: 200, y: 100 }, { id: 'c3', table: 'meadow_crate', x: 300, y: 100 },
    { id: 'c1', table: 'meadow_crate', x: 1, y: 1 }, { id: 'x', table: 'boar', x: NaN, y: 0 }, { id: '', table: 'boar', x: 0, y: 0 }, null, { id: 'z', table: 'nincs', x: 0, y: 0 }];
  const cs = createContainers(list, REG); eq(cs.items.size, 3); eq(cs.errors.length, 4); eq(cs.items.get('c1').table, 'meadow_crate', 'a duplikált id felülír');
  const mkRig = order => { const c = createContainers(list.slice(0, 3), REG), ls = createLoot({ seed: 21 }), gs = createGroundItems(), out = {}; for (const id of order) { ls.counter += 3; out[id] = JSON.stringify(openContainer(ls, c, gs, id).drops); } return { c, ls, gs, out: ['c1', 'c2', 'c3'].map(id => out[id]).join('|') }; };
  const a = mkRig(['c1', 'c2', 'c3']), b = mkRig(['c3', 'c1', 'c2']); eq(a.out, b.out, 'sorrend-/számláló-független');
  const ls = createLoot({ seed: 21 }), gs = createGroundItems(), c = createContainers(list.slice(0, 3), REG);
  eq(containersNear(c, 110, 100, 50).map(x => x.id).join(), 'c1'); eq(containersNear(c, 250, 100, 100).map(x => x.id).join(), 'c2,c3'); eq(containersNear(c, 0, 0, NaN).length, 0);
  const r = openContainer(ls, c, gs, 'c1'); assert(r.ok && r.drops.length > 0, 'a láda nem üres'); eq(containerOpened(c, 'c1'), true); eq(ls.stats.containers, 1);
  for (const it of gs.items) { eq(it.x, 100); eq(it.y, 100); } eq(gs.stats.dropped, total(r.drops));
  const again = openContainer(ls, c, gs, 'c1'); eq(again.ok, false); eq(again.reason, 'opened'); eq(gs.stats.dropped, total(r.drops), 'nincs dupla loot');
  eq(openContainer(ls, c, gs, 'nincs').reason, 'unknown'); eq(openContainer(ls, null, gs, 'c1').ok, false); eq(containersNear(c, 110, 100, 50).length, 0, 'a nyitott nem szerepel');
  const lo = openContainer(createLoot({ seed: 21 }), createContainers([{ id: 'q', table: 'meadow_chest', x: 0, y: 0 }], REG), createGroundItems(), 'q', { level: 1 }), hi = openContainer(createLoot({ seed: 21 }), createContainers([{ id: 'q', table: 'meadow_chest', x: 0, y: 0 }], REG), createGroundItems(), 'q', { level: 10 });
  assert(lo.ok && hi.ok); assert(total(hi.drops) >= total(lo.drops), 'a szint nem csökkenti');
  const st = containersState(c); eq(JSON.stringify(st), '{"v":1,"opened":["c1"]}');
  const c2 = createContainers(list.slice(0, 3), REG); eq(restoreContainers(c2, st), true); eq(containerOpened(c2, 'c1'), true); eq(containerOpened(c2, 'c2'), false);
  eq(openContainer(createLoot({ seed: 21 }), c2, createGroundItems(), 'c1').reason, 'opened', 'betöltés után sem nyílik újra');
  for (const bad of [null, {}, { v: 2, opened: [] }, { v: 1, opened: 'x' }, { v: 1, opened: [1] }]) { eq(restoreContainers(c2, bad), false); eq(containerOpened(c2, 'c1'), true, 'atomi: érintetlen'); }
  eq(restoreContainers(c2, { v: 1, opened: ['c3', 'ismeretlen'] }), true); eq(containersState(c2).opened.join(), 'c3'); eq(restoreContainers(null, st), false);
});

test('loot: 6000 műveletes fuzz – érvényes tételek, nincs NaN, determinizmus', () => {
  const run = () => {
    const rnd = lcg(4242), ls = createLoot({ seed: 8 }), gs = createGroundItems(), ids = [...REG.tables.keys()], log = []; let units = 0;
    for (let i = 0; i < 6000; i++) {
      const tid = rnd() < 0.05 ? 'nincs' : ids[Math.floor(rnd() * ids.length)], lv = rnd() < 0.1 ? NaN : Math.floor(rnd() * 80) - 5;
      const r = rollLoot(ls, tid, { key: 'k' + Math.floor(rnd() * 50), level: lv });
      if (!r.ok) { eq(r.drops.length, 0); continue; }
      for (const d of r.drops) { assert(ITEMS.items.has(d.item), 'tárgy'); assert(Number.isInteger(d.n) && d.n >= 1 && d.n <= LOOT_LIMITS.maxAmount, 'mennyiség ' + d.n); units += d.n; }
      assert(r.level >= 1 && r.level <= 60, 'szint'); log.push(r.drops.map(d => d.item + d.n).join('+'));
      if (i % 7 === 0) { dropLoot(ls, gs, r.drops, rnd() * 3000, rnd() * 3000); stepGround(gs, [], [], 1 / 60, []); }
    }
    eq(ls.stats.units, units); for (const it of gs.items) assert(Number.isFinite(it.x) && Number.isFinite(it.y), 'nincs NaN a földön');
    return log.join('|');
  };
  eq(run(), run(), 'determinisztikus');
});

test('loot: 1800 kockás smoke – ellenfelek halnak, a loot a földre esik, a játékosok felveszik, a darabszám megmarad', () => {
  const rnd = lcg(99), es = createEnemySystem({ seed: 3 }), ls = createLoot({ seed: 5 }), gs = createGroundItems(), players = [createPlayer(0, 2000, 2000), createPlayer(1, 2060, 2000)], invs = [createInventory(), createInventory()], healths = createPlayerHealths(players);
  connectLoot(ls, es, { ground: gs, spawnTables: SPAWN_TABLES });
  for (let f = 0; f < 1800; f++) {
    if (f % 15 === 0) { const e = spawnEnemy(es, rnd() < 0.5 ? 'boar' : 'field_rat', players[0].x + (rnd() - 0.5) * 120, players[0].y + (rnd() - 0.5) * 120); if (e) damageEnemy(es, e, 99999, { player: Math.floor(rnd() * 2) }); }
    stepEnemies(es, players, 1 / 60, { ...ENV, healths });
    players[0].x += Math.sin(f / 40) * 0.8; players[1].x = players[0].x + 60;
    stepGround(gs, players, invs, 1 / 60, []);
    for (const p of players) assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN pozíció');
  }
  let held = 0; for (const inv of invs) for (const s of inv.slots) if (s) held += s.n;
  let onGround = 0; for (const it of gs.items) onGround += it.n;
  eq(gs.stats.dropped, ls.stats.units - ls.stats.lost, 'amit a loot gurított, az leesett'); eq(held, gs.stats.picked, 'a felvett = az inventoryban');
  eq(gs.stats.dropped, gs.stats.picked + gs.stats.despawned + onGround, 'megmaradás: leesett = felvett + eltűnt + a földön');
  assert(ls.stats.rolls === 120 && ls.stats.units > 40 && held > 20, `loot ${ls.stats.units}, felvéve ${held}`);
});
