// test-nodes.js (S037) – erőforrás-node-ok: adat, drop-gurítás, gyűjtés, tele inventory, újranövés, gyógyulás, két játékos, hookok,
// mentés-alak, objektum-kivétel (world-objects), interakció-integráció, rajz, 600+ kockás smoke. Tiszta logika, Node-ban fut.
import { test, assert, eq } from './test-index.js';
import { createWorldStream, warmStream } from './world-stream.js';
import { createObjectStore, syncObjects, objectColliders, objectCount, removeObject, restoreObject, scatterChunkObjects } from './world-objects.js';
import { createItemRegistry } from './data-items.js';
import { createPlayerInventories, countItem, addItem, removeItem, inventoryState } from './game-inventory.js';
import { createPlayer } from './game-player.js';
import { createInteractSystem, addObjectSource, defineInteractable, stepInteraction, targetOf } from './game-interact.js';
import { NODE_DEFS, NODE_TEXTS, HERB_CHANCE } from './data-nodes.js';
import { drawNodeBars } from './render-objects.js';
import {
  validateNodeDef, createNodeRegistry, auditNodes, rollDrops, createNodeSystem, onNode, stepNodes, nodeInteractables, gatherView, nodeState, restoreNodes,
} from './game-nodes.js';

const SEED = 12014, DT = 1 / 60;
const HOLD = { x: 0, y: 0, interact: true }, IDLE = { x: 0, y: 0, interact: false };
const tgt = o => ({ kind: 'object', ref: o, action: 'gather', key: 'obj:' + o.id });
function world(herb = 0.01) {
  const ws = createWorldStream(SEED); warmStream(ws, [{ x: 0, y: 0 }]);
  const os = createObjectStore(SEED, { cfg: { herbChance: herb } }); syncObjects(os, ws);
  return { ws, os };
}
function all(os, type) { const out = []; for (const ch of os.chunks.values()) for (const o of ch.list) if (!type || o.type === type) out.push(o); return out; }
const find = (os, type) => all(os, type)[0];
const has = (os, id) => all(os).some(o => o.id === id);
function hold(ns, secs, tg0, tg1 = null, o = {}) {
  const { inv = createPlayerInventories(), now = 0, hold1 = false, players } = o;
  for (let f = 0; f < Math.round(secs * 60); f++) stepNodes(ns, players, [tg0 ? HOLD : IDLE, hold1 ? HOLD : IDLE], [tg0, tg1], inv, now, DT);
  return inv;
}
const woodOf = (ns, o, n = 0) => rollDrops(ns.reg.nodes.get(o.type), ns.seed, o.id, n);
const sumDrops = ds => ds.reduce((a, d) => a + d.n, 0);

test('node-adat: alap-definíciók érvényesek, a tárgy-hivatkozások léteznek, a hibás kiesik, szövegek HU/EN', () => {
  const reg = createNodeRegistry();
  eq(reg.errors.length, 0, 'hiba: ' + reg.errors); eq([...reg.nodes.keys()].sort().join(), 'herb,stone,tree');
  eq(auditNodes(reg, createItemRegistry()).length, 0, 'hiányzó tárgy');
  assert(Object.isFrozen(reg.nodes.get('tree')) && Object.isFrozen(reg.nodes.get('tree').drops), 'fagyasztott');
  const base = NODE_DEFS[0];
  const bad = [null, 5, { ...base, type: 'bokor' }, { ...base, hp: 0 }, { ...base, hp: 1.5 }, { ...base, hp: 100 }, { ...base, time: 0 }, { ...base, time: NaN }, { ...base, regrow: 0 },
    { ...base, heal: -1 }, { ...base, drops: 'x' }, { ...base, drops: [{ item: '', min: 1, max: 1 }] }, { ...base, drops: [{ item: 'wood', min: 3, max: 2 }] },
    { ...base, drops: [{ item: 'wood', min: 1, max: 1, chance: 2 }] }, { ...base, drops: [{ item: 'wood', min: -1, max: 1 }] }];
  for (const d of bad) eq(validateNodeDef(d).ok, false, 'elfogadta: ' + JSON.stringify(d));
  const r2 = createNodeRegistry([base, { ...base, hp: 9 }, { ...base, type: 'x' }, { ...base, type: 'stone' }]);
  eq(r2.errors.length, 1); assert(r2.dups.has('tree') && r2.nodes.get('tree').hp === 9, 'duplikátum felülír');
  eq(auditNodes(createNodeRegistry([{ ...base, drops: [{ item: 'unobtainium' }] }]), createItemRegistry()).join(), 'tree:unobtainium');
  eq(Object.keys(NODE_TEXTS.hu).join(), Object.keys(NODE_TEXTS.en).join());
  assert(NODE_TEXTS.hu['act.gather'] && NODE_TEXTS.en['obj.herb'], 'szövegek'); assert(HERB_CHANCE > 0 && HERB_CHANCE < 0.05, 'herb-esély');
});

test('rollDrops: determinisztikus, tartományban, chance 0/1, a count más gurítást ad', () => {
  const reg = createNodeRegistry(), tree = reg.nodes.get('tree');
  eq(JSON.stringify(rollDrops(tree, SEED, '0,0:5', 0)), JSON.stringify(rollDrops(tree, SEED, '0,0:5', 0)));
  let diff = 0, fiber = 0; const N = 600;
  for (let c = 0; c < N; c++) {
    const d = rollDrops(tree, SEED, '1,2:77', c), w = d.find(x => x.item === 'wood'), f = d.find(x => x.item === 'fiber');
    assert(w && w.n >= 2 && w.n <= 4, 'fa 2..4'); if (f) { fiber++; assert(f.n >= 1 && f.n <= 2, 'rost 1..2'); }
    if (JSON.stringify(d) !== JSON.stringify(rollDrops(tree, SEED, '1,2:77', 0))) diff++;
  }
  assert(diff > 100, 'a count változtat: ' + diff); assert(fiber > N * 0.15 && fiber < N * 0.35, 'rost ~25%: ' + fiber);
  const one = createNodeRegistry([{ type: 'tree', hp: 1, time: 1, regrow: 1, drops: [{ item: 'wood', min: 5, max: 5, chance: 1 }, { item: 'stone', min: 1, max: 1, chance: 0 }, { item: 'wood', min: 1, max: 1, chance: 1 }] }]).nodes.get('tree');
  for (let c = 0; c < 50; c++) eq(JSON.stringify(rollDrops(one, SEED, 'a:1', c)), '[{"item":"wood","n":6}]', 'chance 0/1, összevonás');
  eq(rollDrops(createNodeRegistry([{ type: 'tree', hp: 1, time: 1, regrow: 1, drops: [] }]).nodes.get('tree'), SEED, 'a:1').length, 0);
});

test('gyűjtés: tartott gomb -> hp ütés, drop az inventoryba, az objektum és az ütköző eltűnik, a másik játékos inventoryja érintetlen', () => {
  const { os } = world(), ns = createNodeSystem(os, { seed: SEED }), tree = find(os, 'tree'), inv = createPlayerInventories();
  const c0 = objectColliders(os).length, n0 = objectCount(os), v0 = os.version, ev = [];
  onNode(ns, e => ev.push(e.type));
  hold(ns, 2.5, tgt(tree), null, { inv }); eq(ev.join(), 'hit,hit', '2 ütés 2,5 mp alatt'); assert(has(os, tree.id), 'még áll');
  eq(gatherView(ns, 0).ref, tree); assert(gatherView(ns, 0).ratio > 0.6 && gatherView(ns, 0).ratio < 1, 'sáv: ' + gatherView(ns, 0).ratio);
  hold(ns, 1, tgt(tree), null, { inv });
  eq(ev.join(), 'hit,hit,hit,depleted'); const want = woodOf(ns, tree);
  for (const d of want) eq(countItem(inv[0], d.item), d.n, d.item); eq(countItem(inv[1], 'wood'), 0);
  eq(objectCount(os), n0 - 1); eq(objectColliders(os).length, c0 - 1, 'ütköző kiesik'); assert(os.version > v0 && !has(os, tree.id) && ns.depleted.has(tree.id), 'rejtett');
  eq(gatherView(ns, 0), null, 'a gyűjtés vége'); eq(ns.stats.hits, 3); eq(ns.stats.harvested, 1);
  const stone = find(os, 'stone'), inv2 = hold(ns, 6, tgt(stone)); eq(countItem(inv2[0], 'stone') >= 2 && countItem(inv2[0], 'stone') <= 3, true, 'kő 2..3');
  const herb = find(os, 'herb'); assert(herb, 'van gyógynövény'); const inv3 = hold(ns, 0.7, tgt(herb)); assert(countItem(inv3[0], 'herb') >= 1, 'gyógynövény 1 ütésre');
  eq(objectColliders(os).length, c0 - 2, 'a gyógynövény nem ütköző, a kő igen');
});

test('gyűjtés: nincs tartás / rossz akció / hibás célpont / nincs id -> nincs haladás; célváltás és elengedés nulláz', () => {
  const { os } = world(), ns = createNodeSystem(os, { seed: SEED }), [a, b] = all(os, 'tree'), inv = createPlayerInventories();
  hold(ns, 5, null, null, { inv }); eq(ns.stats.hits, 0, 'gomb nélkül');
  for (const t of [{ ...tgt(a), action: 'examine' }, { ...tgt(a), kind: 'warp' }, { kind: 'object', ref: { ...a, id: null }, action: 'gather' }, { kind: 'object', ref: { ...a, type: 'bokor' }, action: 'gather' }, { kind: 'object', ref: null, action: 'gather' }]) {
    for (let f = 0; f < 300; f++) stepNodes(ns, [], [HOLD, IDLE], [t, null], inv, 0, DT);
  }
  eq(ns.stats.hits, 0, 'rossz célpontok'); hold(ns, 0.5, tgt(a), null, { inv }); assert(ns.players[0].progress > 0.4, 'halad'); hold(ns, 0.1, null, null, { inv }); eq(ns.players[0].progress, 0, 'elengedés');
  hold(ns, 0.5, tgt(a), null, { inv }); hold(ns, 0.1, tgt(b), null, { inv }); eq(ns.players[0].id, b.id); assert(ns.players[0].progress < 0.2, 'célváltás nulláz'); eq(ns.stats.hits, 0);
  stepNodes(ns, [], [HOLD, IDLE], [tgt(a), null], inv, 0, NaN); stepNodes(ns, [], [HOLD, IDLE], [tgt(a), null], inv, 0, -1); stepNodes(ns, null, null, null, null, NaN, 1);
  eq(ns.stats.hits, 0, 'hibás dt/bemenet sosem dob és nem üt'); assert(Number.isFinite(ns.players[0].progress), 'véges');
});

test('tele inventory: semmi nem vész el, a node megmarad ("full"), hely felszabadítása után sikerül; a részleges betelés visszagördül', () => {
  const { os } = world(), ns = createNodeSystem(os, { seed: SEED }), tree = find(os, 'tree'), inv = createPlayerInventories(null, 2, 2), ev = [];
  addItem(inv[0], 'shard', 2); const snap = JSON.stringify(inventoryState(inv[0])); onNode(ns, e => ev.push(e.type));
  hold(ns, 4, tgt(tree), null, { inv }); assert(ev.includes('full') && !ev.includes('depleted'), 'full: ' + ev); eq(JSON.stringify(inventoryState(inv[0])), snap, 'az inventory érintetlen');
  assert(has(os, tree.id) && ns.depleted.size === 0 && ns.stats.harvested === 0, 'a node megvan'); assert(gatherView(ns, 0).full || ns.players[0].full >= 0, 'villan');
  removeItem(inv[0], 'shard', 2); hold(ns, 1.2, tgt(tree), null, { inv }); assert(ev.includes('depleted') && countItem(inv[0], 'wood') >= 2, 'felszabadítva sikerül');
  const two = createNodeRegistry([{ type: 'tree', hp: 1, time: 0.1, regrow: 10, drops: [{ item: 'wood', min: 1, max: 1 }, { item: 'fiber', min: 1, max: 1 }] }]);
  const ns2 = createNodeSystem(world().os, { seed: SEED, reg: two }), t2 = find(ns2.os, 'tree'), inv2 = createPlayerInventories(null, 2, 1);
  addItem(inv2[0], 'wood', 5); const s2 = JSON.stringify(inventoryState(inv2[0])); hold(ns2, 1, tgt(t2), null, { inv: inv2 });
  eq(JSON.stringify(inventoryState(inv2[0])), s2, 'a fa befért, a rost nem: visszagördül'); assert(ns2.stats.full > 0 && ns2.stats.harvested === 0);
});

test('újranövés: játékperc után visszatér (objektum + ütköző), előtte/visszafelé/NaN idővel nem; betöltetlen chunkban is', () => {
  const { ws, os } = world(), ns = createNodeSystem(os, { seed: SEED }), tree = find(os, 'tree'), inv = createPlayerInventories(), c0 = objectColliders(os).length, evs = [];
  onNode(ns, e => evs.push(e.type)); hold(ns, 3.2, tgt(tree), null, { inv, now: 100 }); eq(ns.depleted.get(tree.id).regrowAt, 100 + 2880);
  const step = now => stepNodes(ns, [], [IDLE, IDLE], [null, null], inv, now, DT);
  step(100 + 2879.9); step(50); step(NaN); step(Infinity === 1 ? 0 : -5); assert(!has(os, tree.id) && ns.depleted.size === 1, 'még nincs');
  const v = os.version; step(100 + 2880); assert(has(os, tree.id) && ns.depleted.size === 0 && os.version > v, 'visszanőtt'); eq(objectColliders(os).length, c0, 'ütköző is'); eq(evs[evs.length - 1], 'regrown');
  hold(ns, 3.2, tgt(tree), null, { inv, now: 5000 }); assert(ns.harvests.get(tree.id) === 2, 'második kitermelés');
  os.chunks.delete(tree.id.split(':')[0]); syncObjects(os, ws); assert(!has(os, tree.id), 'újratöltéskor kimarad, amíg kitermelt');
  step(5000 + 2880); assert(has(os, tree.id), 'a regrow a betöltött chunkba is visszateszi'); os.chunks.delete(tree.id.split(':')[0]);
  hold(ns, 4.6, tgt(find(os, 'stone')), null, { inv, now: 6000 }); const sid = [...ns.depleted.keys()][0]; os.chunks.delete(sid.split(':')[0]); step(6000 + 2160); eq(ns.depleted.size, 0);
  syncObjects(os, ws); assert(has(os, sid) && has(os, tree.id), 'betöltetlen chunkban regrow -> a következő betöltéskor ott van');
});

test('sérülés: tétlenség után visszagyógyul (heal), heal 0 nem; tartás közben nem gyógyul', () => {
  const { os } = world(), ns = createNodeSystem(os, { seed: SEED }), tree = find(os, 'tree'), inv = createPlayerInventories();
  hold(ns, 1, tgt(tree), null, { inv }); eq(ns.damage.get(tree.id).hp, 2); hold(ns, 19, null, null, { inv }); assert(ns.damage.has(tree.id), '19 mp: még sérült'); hold(ns, 2, null, null, { inv }); assert(!ns.damage.has(tree.id), '21 mp: gyógyult');
  hold(ns, 0.95, tgt(tree), null, { inv }); hold(ns, 0.95, tgt(tree), null, { inv }); eq(ns.damage.get(tree.id).hp, 1, 'újra 3 ütés kell');
  const ns0 = createNodeSystem(os, { seed: SEED, reg: createNodeRegistry([{ ...NODE_DEFS[0], heal: 0 }]) }); hold(ns0, 1, tgt(tree), null, { inv }); hold(ns0, 3000, null, null, { inv }); assert(ns0.damage.has(tree.id), 'heal 0: marad');
  const r = tgt(tree); ns.damage.clear(); hold(ns, 10, r, null, { inv, now: 0 }); assert(ns.stats.harvested === 1, 'tartva végigviszi');
});

test('két játékos: ugyanazon a node-on közösen ütik, a drop egyszer, a befejezőnek; más node-on függetlenek; külön inventory', () => {
  const { os } = world(), ns = createNodeSystem(os, { seed: SEED }), tree = find(os, 'tree'), stone = find(os, 'stone'), inv = createPlayerInventories(), ev = [];
  onNode(ns, e => ev.push(e.type + e.player));
  hold(ns, 4, tgt(tree), tgt(tree), { inv, hold1: true }); eq(ev.filter(e => e.startsWith('depleted')).length, 1, 'egy kitermelés'); eq(ev.filter(e => e.startsWith('hit')).length, 3, 'összesen hp ütés');
  eq(sumDrops(woodOf(ns, tree)) > 0, true); eq(countItem(inv[0], 'wood') + countItem(inv[1], 'wood') >= 2, true); eq(countItem(inv[0], 'wood') > 0 !== countItem(inv[1], 'wood') > 0, true, 'csak az egyik kapja');
  const ns2 = createNodeSystem(os, { seed: SEED }), t2 = all(os, 'tree')[1], inv2 = createPlayerInventories();
  hold(ns2, 7, tgt(t2), tgt(stone), { inv: inv2, hold1: true }); assert(countItem(inv2[0], 'wood') >= 2 && countItem(inv2[1], 'stone') >= 2, 'külön node, külön inventory'); eq(countItem(inv2[0], 'stone'), 0); eq(countItem(inv2[1], 'wood'), 0);
});

test('hookok (S038 előkészítés): gyorsítás, ütés-erő, hibás/dobó hook alapértékre esik', () => {
  const { os } = world(), tree = find(os, 'tree');
  const fast = createNodeSystem(os, { seed: SEED, hooks: { speed: () => 2 } }); hold(fast, 0.5, tgt(tree)); eq(fast.stats.hits, 1, '2x gyorsabb: 0,45 mp/ütés');
  const strong = createNodeSystem(os, { seed: SEED, hooks: { power: () => 3.9 } }); const inv = hold(strong, 1, tgt(tree)); eq(strong.stats.hits, 1); eq(strong.stats.harvested, 1, 'erő 3 -> 1 ütés'); assert(countItem(inv[0], 'wood') >= 2);
  for (const h of [() => { throw new Error('x'); }, () => NaN, () => 'x', () => undefined]) {
    const ns = createNodeSystem(os, { seed: SEED, hooks: { speed: h, power: h } }); hold(ns, 1, tgt(tree)); eq(ns.stats.hits, 1, 'alap 0,9 mp'); eq(ns.damage.get(tree.id).hp, 2, 'alap erő 1');
  }
  const slow = createNodeSystem(os, { seed: SEED, hooks: { speed: () => -5 } }); hold(slow, 10, tgt(tree)); eq(slow.stats.hits, 0, 'min 0,05x: 10 mp alatt nincs ütés'); assert(slow.players[0].progress > 0);
});

test('mentés-alak: kör azonos, a kitermelt objektumok elrejtődnek, az idő a betöltéstől számít; hibás állapot atomi false', () => {
  const { os } = world(), ns = createNodeSystem(os, { seed: SEED }), tree = find(os, 'tree'), inv = createPlayerInventories();
  hold(ns, 3.2, tgt(tree), null, { inv, now: 100 }); const st = JSON.parse(JSON.stringify(nodeState(ns, 150)));
  eq(st.v, 1); eq(st.depleted.length, 1); eq(st.depleted[0][0], tree.id); eq(st.depleted[0][1], 'tree'); eq(st.depleted[0][2], 2830);
  const w2 = world(), ns2 = createNodeSystem(w2.os, { seed: SEED }); eq(restoreNodes(ns2, st, 1000), true); assert(!has(w2.os, tree.id), 'elrejtve'); eq(ns2.depleted.get(tree.id).regrowAt, 3830);
  eq(JSON.stringify(nodeState(ns2, 1000)), JSON.stringify(st), 'a kör azonos'); stepNodes(ns2, [], [IDLE, IDLE], [null, null], inv, 3830, DT); assert(has(w2.os, tree.id), 'visszanő');
  const before = JSON.stringify(nodeState(ns, 150)), ids = ns.depleted.size;
  for (const bad of [null, 5, {}, { v: 2, depleted: [] }, { v: 1, depleted: 'x' }, { v: 1, depleted: [['x']] }, { v: 1, depleted: [['bad', 'tree', 5]] }, { v: 1, depleted: [[tree.id, 'bokor', 5]] }, { v: 1, depleted: [[tree.id, 'tree', -1]] }, { v: 1, depleted: [[tree.id, 'tree', NaN]] }, { v: 1, depleted: [[tree.id, 'tree', 5], 7] }]) {
    eq(restoreNodes(ns, bad, 150), false, 'elfogadta: ' + JSON.stringify(bad)); eq(JSON.stringify(nodeState(ns, 150)), before, 'érintetlen'); eq(ns.depleted.size, ids);
  }
  eq(restoreNodes(ns, { v: 1, depleted: [] }, 0), true); assert(has(os, tree.id) && ns.depleted.size === 0, 'üres állapot mindent visszatesz');
  eq(restoreNodes(ns, { v: 1, depleted: [[tree.id, 'tree', 5], [tree.id, 'tree', 9]] }, 0), true); eq(ns.depleted.size, 1, 'duplikátum egyszer');
  eq(restoreNodes(ns, { v: 1, depleted: [['999,999:1', 'tree', 5]] }, 0), true, 'betöltetlen chunk id-je előre megjelölve'); eq(os.removed.has('999,999:1'), true);
});

test('figyelők: leiratkozás, dobó figyelő nem állítja meg a többit, az események kockánként újrahasznosulnak', () => {
  const { os } = world(), ns = createNodeSystem(os, { seed: SEED }), tree = find(os, 'tree'); let a = 0, b = 0;
  const off = onNode(ns, () => { a++; throw new Error('hiba'); }); onNode(ns, () => b++); eq(onNode(ns, 5)(), undefined);
  const inv = createPlayerInventories(); hold(ns, 0.95, tgt(tree), null, { inv }); eq(a, 1); eq(b, 1); eq(ns.lastError, 'hiba'); off(); hold(ns, 0.95, tgt(tree), null, { inv }); eq(a, 1); eq(b, 2);
  eq(stepNodes(ns, [], [IDLE, IDLE], [null, null], inv, 0, DT).length, 0, 'üres kocka');
});

test('objektum-kivétel (world-objects): kivétel/visszatétel, betöltetlen chunk, ismeretlen id; a gyógynövény szórása nem tolja el a fát/követ', () => {
  const { ws, os } = world(0), o = find(os, 'tree'), n0 = objectCount(os);
  eq(removeObject(os, 'nincs'), false); eq(removeObject(os, '0,0:99999'), false); eq(removeObject(null, o.id), false); eq(restoreObject(os, o.id), false);
  eq(removeObject(os, o.id), true); eq(removeObject(os, o.id), true, 'másodszor is igaz'); eq(objectCount(os), n0 - 1); eq(restoreObject(os, o.id), true); eq(objectCount(os), n0); eq(restoreObject(os, o.id), false);
  eq(removeObject(os, '77,77:5'), true, 'betöltetlen chunk: előre megjelölve'); eq(restoreObject(os, '77,77:5'), true);
  removeObject(os, o.id); os.chunks.delete(o.id.split(':')[0]); eq(restoreObject(os, o.id), true, 'betöltetlen chunk: nem kerül a listába'); syncObjects(os, ws); assert(has(os, o.id), 'újratöltéskor a szórásból');
  for (const [cx, cy] of [[0, 0], [1, 0], [-1, 2]]) {
    const base = scatterChunkObjects(SEED, cx, cy), withH = scatterChunkObjects(SEED, cx, cy, { cfg: { herbChance: 0.02 } });
    eq(JSON.stringify(withH.filter(x => x.type !== 'herb')), JSON.stringify(base), 'fa/kő változatlan'); assert(withH.some(x => x.type === 'herb'), 'van gyógynövény'); eq(base.filter(x => x.type === 'herb').length, 0, 'alapból nincs');
  }
  eq(objectColliders(world(0.02).os).length, objectColliders(world(0).os).length, 'a gyógynövény nem ütköző');
});

test('interakció-integráció: a valódi interakció-rendszer célpontot ad (akció gather), tartott gombbal kitermelhető; promptok akciója', () => {
  const { os } = world(), ns = createNodeSystem(os, { seed: SEED }), inv = createPlayerInventories(), sys = createInteractSystem();
  addObjectSource(sys, os); for (const [t, d] of Object.entries(nodeInteractables(ns))) defineInteractable(sys, t, d); eq(sys.defs.herb.action, 'gather');
  const lonely = (type) => all(os, type).find(o => all(os).every(q => q === o || Math.hypot(q.x - o.x, q.y - o.y) > 90));
  for (const [type, secs, up] of [['tree', 4, 26], ['herb', 1.5, 24]]) {
    const o = lonely(type); assert(o, 'magányos ' + type); const p = createPlayer(0, o.x, o.y - up), pl = [p, createPlayer(1, o.x + 400, o.y + 400)];
    stepInteraction(sys, pl, [{ x: 0, y: 1, interact: false }, IDLE], DT); const t = targetOf(sys, 0); assert(t && t.ref === o && t.action === 'gather', type + ' célpont: ' + (t && t.key));
    for (let f = 0; f < secs * 60; f++) { stepInteraction(sys, pl, [HOLD, IDLE], DT); stepNodes(ns, pl, [HOLD, IDLE], [targetOf(sys, 0), targetOf(sys, 1)], inv, 0, DT); }
    assert(ns.depleted.has(o.id) && !has(os, o.id), type + ' kitermelve'); stepInteraction(sys, pl, [HOLD, IDLE], DT); eq(targetOf(sys, 0), null, 'az eltűnt objektum már nem célpont');
  }
  assert(countItem(inv[0], 'wood') >= 2 && countItem(inv[0], 'herb') >= 1, 'a drop megvan');
});

test('rajz: a gyűjtés-sáv csak aktív gyűjtésnél, játékosonként, kivágással; tele inventorynál borostyán', () => {
  const { os } = world(), ns = createNodeSystem(os, { seed: SEED }), tree = find(os, 'tree'), rects = [];
  const ctx = { fillStyle: '', fillRect(x, y, w, h) { rects.push({ c: this.fillStyle, x, y, w, h }); } };
  eq(drawNodeBars(ctx, ns, 0, 0, 960, 540), 0, 'nincs gyűjtés'); hold(ns, 0.45, tgt(tree), tgt(tree), { hold1: true });
  const ox = tree.x - 480, oy = tree.y - 270; eq(drawNodeBars(ctx, ns, ox, oy, 960, 540), 2, 'két sáv'); eq(rects.length, 4);
  assert(rects[1].c === '#4d8cff' && rects[3].c === '#ff5d5d' && rects[3].y > rects[1].y, 'játékos-színek, egymás alatt'); assert(rects[1].w > 1 && rects[1].w <= 28, 'szélesség a haladás szerint');
  rects.length = 0; eq(drawNodeBars(ctx, ns, ox + 5000, oy, 960, 540), 0, 'nézeten kívül nincs'); eq(rects.length, 0);
  ns.players[0].full = 0.5; rects.length = 0; drawNodeBars(ctx, ns, ox, oy, 960, 540); eq(rects[1].c, '#ffb45a', 'full: borostyán');
});

function runSmoke() {
  const { os } = world(0.02), ns = createNodeSystem(os, { seed: SEED }), inv = createPlayerInventories(), got = new Map(), evs = [];
  const near = [...all(os)].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y)).slice(0, 8);
  onNode(ns, e => { evs.push(e.type); if (e.type === 'depleted') for (const d of e.drops) got.set(d.item, (got.get(d.item) || 0) + d.n); });
  for (let f = 0; f < 6000; f++) {
    const now = f * 0.5, i0 = Math.floor(f / 200) % near.length, i1 = (Math.floor(f / 130) + 3) % near.length;
    const t0 = f % 700 < 600 ? tgt(near[i0]) : null, t1 = tgt(near[i1]);
    stepNodes(ns, [], [{ x: 0, y: 0, interact: f % 400 < 350 }, HOLD], [t0, t1], inv, now, DT);
    for (const s of ns.players) assert(Number.isFinite(s.progress) && s.progress >= 0 && s.progress <= 1.0000001, 'haladás: ' + s.progress);
    for (const [id, e] of ns.depleted) { assert(os.removed.has(id) && Number.isFinite(e.regrowAt), 'kitermelt = elrejtett'); if (f % 500 === 0) assert(!has(os, id), 'elrejtve nincs a listában'); }
    for (const [, d] of ns.damage) assert(d.hp >= -3 && d.hp <= 4 && d.age >= 0, 'sérülés-határok');
  }
  for (const [item, n] of got) eq(countItem(inv[0], item) + countItem(inv[1], item), n, 'megmaradás: ' + item);
  return { st: JSON.stringify(nodeState(ns, 3000)), inv: JSON.stringify(inventoryState(inv[0])) + JSON.stringify(inventoryState(inv[1])), stats: JSON.stringify(ns.stats), evs: evs.length };
}
test('smoke: 6000 kocka két játékossal, 8 node-dal, gyorsított játékidővel – megmaradás (a drop = az inventory), invariánsok, regrow, determinizmus', () => {
  const a = runSmoke(), b = runSmoke(); eq(a.evs > 30, true, 'történt gyűjtés: ' + a.evs); assert(JSON.parse(a.stats).harvested > 2 && JSON.parse(a.stats).regrown > 0, 'volt kitermelés és újranövés: ' + a.stats);
  eq(JSON.stringify(a), JSON.stringify(b), 'ugyanaz a futás ugyanazt adja');
});
