// S033 tesztek: tárgy-adat + inventory (stack, hozzáadás/eltávolítás, mozgatás, súly, tag, állapot, fuzz).
import { test, assert, eq, near } from './test-index.js';
import { createI18n, addTexts, auditTexts } from './i18n.js';
import { BASE_TEXTS } from './data-text.js';
import { ITEM_DEFS, ITEM_TEXTS, ITEM_TEXT_PREFIX, ITEM_LIMITS, validateItemDef, createItemRegistry, getItemDef, registerItemTexts } from './data-items.js';
import {
  INVENTORY_CONFIG, createInventory, createPlayerInventories, countItem, hasItem, countTag, hasTag, spaceFor, canAdd,
  addItem, removeItem, moveSlot, splitStack, totalWeight, usedSlots, inventoryState, restoreInventory,
} from './game-inventory.js';

const REG = createItemRegistry();
const inv = (slots = 6) => createInventory(REG, slots);
const total = v => v.slots.reduce((s, x) => s + (x ? x.n : 0), 0);

test('items: alap-adat érvényes, szövegek HU/EN teljesek', () => {
  eq(REG.errors.length, 0); eq(REG.dups.size, 0); eq(REG.items.size, ITEM_DEFS.length);
  const i = createI18n({ lang: 'hu', texts: BASE_TEXTS, storage: null });
  addTexts(i, ITEM_TEXTS, ITEM_TEXT_PREFIX);
  for (const d of REG.items.values()) {
    assert(d.nameKey === 'item.' + d.id, 'nameKey ' + d.id);
    for (const l of ['hu', 'en']) assert(typeof i.tables[l][d.nameKey] === 'string' && i.tables[l][d.nameKey].length > 0, l + ' ' + d.nameKey);
  }
  const a = auditTexts(i);
  eq(a.missing.hu.length + a.missing.en.length, 0);
  let n = 0; registerItemTexts((tx, p) => { n++; eq(p, 'item.'); return 1; }); eq(n, 1);
  eq(registerItemTexts(null), 0);
});
test('items: hibás definíciók kiesnek, nem dobnak; duplikátum felülír', () => {
  const bad = [null, 5, {}, { id: 'X', stack: 1, weight: 1, value: 1 }, { id: 'a', stack: 0, weight: 1, value: 1 }, { id: 'a', stack: 1.5, weight: 1, value: 1 },
    { id: 'a', stack: 1e9, weight: 1, value: 1 }, { id: 'a', stack: 1, weight: -1, value: 1 }, { id: 'a', stack: 1, weight: NaN, value: 1 },
    { id: 'a', stack: 1, weight: 1, value: Infinity }, { id: 'a', stack: 1, weight: 1, value: 1, tags: 'x' }, { id: 'a', stack: 1, weight: 1, value: 1, tags: ['kicsi'] },
    { id: '__proto__', stack: 1, weight: 1, value: 1 }];
  for (const b of bad) assert(!validateItemDef(b).ok, JSON.stringify(b));
  const r = createItemRegistry([...bad, { id: 'ok', stack: 5, weight: 1, value: 1, tags: ['A', 'A', 'B'] }, { id: 'ok', stack: 7, weight: 2, value: 3 }]);
  eq(r.items.size, 1); eq(r.items.get('ok').stack, 7); assert(r.dups.has('ok')); eq(r.errors.length, bad.length);
  eq(createItemRegistry('szemét').items.size, 0);
  eq(validateItemDef({ id: 'q', stack: 5, weight: 1, value: 1, tags: ['A', 'A'] }).item.tags.length, 1, 'tag-duplikátum');
  assert(Object.isFrozen(getItemDef(REG, 'wood')));
  eq(getItemDef(REG, 'constructor'), null); eq(getItemDef(REG, '__proto__'), null); eq(getItemDef(REG, 5), null); eq(getItemDef(null, 'wood'), null);
  assert(ITEM_LIMITS.maxStack >= 99);
});
test('inventory: létrehozás, slot-szám szorítása, alap-nyilvántartás', () => {
  eq(inv().slots.length, 6); eq(createInventory(REG).slots.length, INVENTORY_CONFIG.slots);
  eq(createInventory(REG, 0).slots.length, INVENTORY_CONFIG.minSlots); eq(createInventory(REG, 9999).slots.length, INVENTORY_CONFIG.maxSlots);
  eq(createInventory(REG, NaN).slots.length, INVENTORY_CONFIG.slots);
  const d = createInventory(); assert(d.reg && d.reg.items.has('wood'), 'alap-nyilvántartás');
  eq(usedSlots(inv()), 0);
});
test('inventory: hozzáadás előbb a meglévő stackbe, aztán új slotba; stack-határ', () => {
  const v = inv(); // wood stack 99
  eq(addItem(v, 'wood', 50), 0); eq(v.slots[0].n, 50);
  eq(addItem(v, 'wood', 60), 0); eq(v.slots[0].n, 99); eq(v.slots[1].n, 11);
  eq(countItem(v, 'wood'), 110); eq(usedSlots(v), 2);
  eq(addItem(v, 'wood', 1), 0); eq(v.slots[1].n, 12);
  eq(addItem(v, 'shard', 3), 0); eq(usedSlots(v), 5); // stack 1 -> 3 külön slot
  v.slots.forEach(s => s && assert(s.n >= 1 && s.n <= getItemDef(REG, s.id).stack));
});
test('inventory: tele inventory -> maradék visszajön, semmi nem vész el', () => {
  const v = inv(2);
  eq(addItem(v, 'wood', 99 * 2 + 40), 40); eq(total(v), 198); eq(spaceFor(v, 'wood'), 0); eq(addItem(v, 'wood', 5), 5);
  eq(addItem(v, 'torch', 1), 1); assert(!canAdd(v, 'torch', 1));
  eq(removeItem(v, 'wood', 10), true); eq(spaceFor(v, 'wood'), 10); assert(canAdd(v, 'wood', 10)); assert(!canAdd(v, 'wood', 11));
  eq(spaceFor(v, 'nincs'), 0);
});
test('inventory: hibás bemenet (id, mennyiség) nem módosít és nem dob', () => {
  const v = inv(); addItem(v, 'stone', 5); const before = JSON.stringify(v.slots);
  for (const n of [0, -3, 1.5, NaN, Infinity, '3', null, {}]) { eq(addItem(v, 'stone', n), 0, 'add ' + n); eq(removeItem(v, 'stone', n), false, 'rem ' + n); }
  eq(addItem(v, 'nincs', 4), 4); eq(addItem(v, '__proto__', 2), 2); eq(addItem(v, 7, 2), 2);
  eq(removeItem(v, 'nincs', 1), false); eq(removeItem(v, 'stone', 6), false);
  eq(JSON.stringify(v.slots), before);
  eq(hasItem(v, 'stone', 0), false); eq(hasItem(v, 'stone', 5), true); eq(hasItem(v, 'stone', 6), false);
});
test('inventory: eltávolítás atomi, az utolsó slotokból vesz', () => {
  const v = inv(); addItem(v, 'wood', 150); // [99, 51]
  eq(removeItem(v, 'wood', 60), true); eq(v.slots[0].n, 90); eq(v.slots[1], null); // 51 -> 0, 9 az elsőből
  eq(removeItem(v, 'wood', 91), false); eq(countItem(v, 'wood'), 90); // nem elég -> érintetlen
  eq(removeItem(v, 'wood', 90), true); eq(usedSlots(v), 0);
});
test('inventory: tag-ek (FÁKLYA, FUEL) összesítése', () => {
  const v = inv(); eq(hasTag(v, 'FÁKLYA'), false);
  addItem(v, 'torch', 2); addItem(v, 'wood', 5); addItem(v, 'stone', 4);
  eq(hasTag(v, 'FÁKLYA'), true); eq(countTag(v, 'FÁKLYA'), 2); eq(countTag(v, 'FUEL'), 7); eq(countTag(v, 'MATERIAL'), 9); eq(hasTag(v, 'ÉGETÉS'), false);
  removeItem(v, 'torch', 2); eq(hasTag(v, 'FÁKLYA'), false);
});
test('inventory: slot-mozgatás (üres cél, összevonás, csere, hibás index)', () => {
  const v = inv(); addItem(v, 'wood', 99); addItem(v, 'wood', 30); addItem(v, 'stone', 5); // [99w, 30w, 5s]
  eq(moveSlot(v, 2, 4), true); eq(v.slots[4].id, 'stone'); eq(v.slots[2], null);
  eq(moveSlot(v, 4, 1), true); eq(v.slots[1].id, 'stone'); eq(v.slots[4].id, 'wood'); eq(v.slots[4].n, 30); // csere
  eq(moveSlot(v, 4, 0), false); // a cél tele -> nincs változás
  v.slots[0].n = 90; eq(moveSlot(v, 4, 0), true); eq(v.slots[0].n, 99); eq(v.slots[4].n, 21); // részleges összevonás
  eq(total(v), 125, 'összeg-tartás (a kézi -9 után)'); eq(countItem(v, 'wood'), 120); eq(countItem(v, 'stone'), 5);
  for (const [a, b] of [[-1, 2], [2, 99], [1.5, 2], [3, 3], [NaN, 1], [3, 1]]) eq(moveSlot(v, a, b), false, `${a}->${b}`);
});
test('inventory: stack kettéosztása', () => {
  const v = inv(); addItem(v, 'herb', 10);
  eq(splitStack(v, 0, 3, 4), true); eq(v.slots[0].n, 6); eq(v.slots[3].n, 4); eq(v.slots[3].id, 'herb');
  eq(splitStack(v, 0, 3, 1), false); // a cél nem üres
  eq(splitStack(v, 0, 1, 6), false); eq(splitStack(v, 0, 1, 0), false); eq(splitStack(v, 0, 1, 2.5), false); eq(splitStack(v, 5, 1, 1), false); eq(splitStack(v, 0, 0, 1), false);
  eq(total(v), 10);
});
test('inventory: összsúly (kg) és hibás slot-azonosító', () => {
  const v = inv(); eq(totalWeight(v), 0);
  addItem(v, 'wood', 3); addItem(v, 'stone', 2); addItem(v, 'herb', 10);
  near(totalWeight(v), 3 * 2 + 2 * 3 + 10 * 0.1, 1e-9);
  v.slots[5] = { id: 'szellem', n: 9 }; near(totalWeight(v), 13, 1e-9, 'ismeretlen id nem számít');
});
test('inventory: állapot körút + hibás állapot atomi', () => {
  const v = inv(8); addItem(v, 'wood', 120); addItem(v, 'torch', 3); addItem(v, 'shard', 2); moveSlot(v, 0, 6);
  const st = JSON.parse(JSON.stringify(inventoryState(v)));
  const w = inv(8); addItem(w, 'stone', 7);
  eq(restoreInventory(w, st), true); eq(JSON.stringify(w.slots), JSON.stringify(v.slots)); eq(totalWeight(w), totalWeight(v));
  const keep = JSON.stringify(w.slots);
  const bads = [null, 5, {}, { v: 2, slots: [] }, { v: 1, slots: 'x' }, { v: 1, slots: new Array(9).fill(null) }, { v: 1, slots: [['wood', 100]] }, { v: 1, slots: [['wood', 0]] },
    { v: 1, slots: [['wood', 1.5]] }, { v: 1, slots: [['nincs', 1]] }, { v: 1, slots: [['wood']] }, { v: 1, slots: [['wood', 5], 7] }, { v: 1, slots: [['wood', 5], ['__proto__', 1]] }];
  for (const b of bads) { eq(restoreInventory(w, b), false, JSON.stringify(b)); eq(JSON.stringify(w.slots), keep, 'érintetlen'); }
  const small = inv(3); eq(restoreInventory(small, st), false);
  eq(restoreInventory(small, { v: 1, slots: [['wood', 5]] }), true); eq(small.slots.length, 3);
});
test('inventory: két játékos külön inventoryja, közös nyilvántartás', () => {
  const [a, b] = createPlayerInventories(REG);
  assert(a !== b && a.slots !== b.slots && a.reg === b.reg);
  addItem(a, 'wood', 5); eq(countItem(a, 'wood'), 5); eq(countItem(b, 'wood'), 0);
  eq(createPlayerInventories(null, 3).length, 3);
});
test('inventory: fuzz 6000 művelet – invariánsok + összeg-tartás', () => {
  let seed = 33033; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const ids = ['wood', 'stone', 'fiber', 'herb', 'torch', 'shard', 'nincs'];
  const v = inv(10); const mirror = new Map(); let wantSlots = 10;
  const bump = (id, d) => mirror.set(id, (mirror.get(id) || 0) + d);
  for (let k = 0; k < 6000; k++) {
    const id = ids[Math.floor(rnd() * ids.length)], n = 1 + Math.floor(rnd() * 130), op = Math.floor(rnd() * 5);
    if (op === 0) { const left = addItem(v, id, n); bump(id, id === 'nincs' ? 0 : n - left); }
    else if (op === 1) { if (removeItem(v, id, n)) bump(id, -n); }
    else if (op === 2) moveSlot(v, Math.floor(rnd() * 12) - 1, Math.floor(rnd() * 12) - 1);
    else if (op === 3) splitStack(v, Math.floor(rnd() * 10), Math.floor(rnd() * 10), 1 + Math.floor(rnd() * 20));
    else { const w = JSON.parse(JSON.stringify(inventoryState(v))); assert(restoreInventory(v, w)); }
    eq(v.slots.length, wantSlots);
    for (const s of v.slots) if (s) { const d = getItemDef(REG, s.id); assert(d && Number.isInteger(s.n) && s.n >= 1 && s.n <= d.stack, 'slot ' + JSON.stringify(s)); }
    if (k % 50 === 0) for (const id2 of ids) eq(countItem(v, id2), mirror.get(id2) || 0, 'összeg ' + id2 + ' @' + k);
    assert(Number.isFinite(totalWeight(v)) && totalWeight(v) >= 0);
  }
  for (const id2 of ids) eq(countItem(v, id2), mirror.get(id2) || 0, 'végösszeg ' + id2);
});
