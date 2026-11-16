// S040 tesztek: receptek (adat, validáció), craft-ellenőrzés, atomi craft, állomás/skill, hely, fuzz.
import { test, assert, eq } from './test-index.js';
import { createI18n, addTexts, auditTexts } from './i18n.js';
import { BASE_TEXTS } from './data-text.js';
import { ITEM_TEXTS, ITEM_TEXT_PREFIX, createItemRegistry } from './data-items.js';
import { RECIPE_DEFS } from './data-recipes.js';
import { createInventory, addItem, countItem, usedSlots, inventoryState, hasItem } from './game-inventory.js';
import { CRAFT_LIMITS, validateRecipeDef, createRecipeRegistry, getRecipe, auditRecipes, recipesAt, craftCheck, maxCraftable, craft, craftList } from './game-crafting.js';

const IREG = createItemRegistry();
const RREG = createRecipeRegistry(RECIPE_DEFS, IREG);
const inv = (slots = 6) => createInventory(IREG, slots);
const snap = v => JSON.stringify(inventoryState(v));
const R = (o = {}) => ({ id: 'r', inputs: [{ item: 'wood', n: 2 }], output: { item: 'torch', n: 1 }, station: null, skill: null, ...o });

test('recipes: alap-adat érvényes, hivatkozások léteznek, szövegek HU/EN teljesek', () => {
  eq(RREG.errors.length, 0); eq(RREG.dups.size, 0); eq(RREG.recipes.size, RECIPE_DEFS.length);
  eq(auditRecipes(RREG, IREG).length, 0);
  const i = createI18n({ lang: 'hu', texts: BASE_TEXTS, storage: null });
  addTexts(i, ITEM_TEXTS, ITEM_TEXT_PREFIX);
  for (const r of RREG.recipes.values()) for (const l of ['hu', 'en']) assert(typeof i.tables[l][r.nameKey] === 'string', l + ' ' + r.nameKey);
  const a = auditTexts(i); eq(a.missing.hu.length + a.missing.en.length, 0);
  for (const id of ['torch', 'axe', 'pickaxe', 'sickle']) { const r = getRecipe(RREG, id); assert(r && r.station === null && r.skill === null, id); }
  assert(Object.isFrozen(getRecipe(RREG, 'axe')) && Object.isFrozen(getRecipe(RREG, 'axe').inputs));
});
test('recipes: hibás definíciók kiesnek, nem dobnak; duplikátum felülír; hiányzó tárgy-hivatkozás hiba', () => {
  const bad = [null, 5, {}, R({ id: 'X' }), R({ id: '__proto__x' }), R({ inputs: [] }), R({ inputs: 'x' }), R({ inputs: [null] }),
    R({ inputs: [{ item: 'wood', n: 0 }] }), R({ inputs: [{ item: 'wood', n: 1.5 }] }), R({ inputs: [{ item: 'wood', n: 1000 }] }),
    R({ inputs: [{ item: 'wood', n: 1 }, { item: 'wood', n: 2 }] }), R({ inputs: [{ item: 'nincs', n: 1 }] }),
    R({ inputs: Array.from({ length: 7 }, (_, i) => ({ item: 'wood' + i, n: 1 })) }),
    R({ output: null }), R({ output: { item: 'torch', n: 0 } }), R({ output: { item: 'nincs', n: 1 } }),
    R({ station: 'kicsi' }), R({ station: 5 }), R({ skill: { skill: 'Fő', level: 1 } }), R({ skill: { skill: 'x', level: 61 } }), R({ skill: { skill: 'x', level: -1 } }), R({ skill: 'x' })];
  for (const b of bad) assert(!validateRecipeDef(b, IREG).ok, JSON.stringify(b));
  const r = createRecipeRegistry([...bad, R({ id: 'ok' }), R({ id: 'ok', output: { item: 'torch', n: 5 } })], IREG);
  eq(r.recipes.size, 1); eq(r.recipes.get('ok').output.n, 5); assert(r.dups.has('ok')); eq(r.errors.length, bad.length);
  eq(createRecipeRegistry('szemét', IREG).recipes.size, 0);
  eq(getRecipe(RREG, 'constructor'), null); eq(getRecipe(RREG, '__proto__'), null); eq(getRecipe(RREG, 7), null); eq(getRecipe(null, 'axe'), null);
  assert(validateRecipeDef(R({ station: 'MUNKAPAD', skill: { skill: 'smithing', level: 60 } }), IREG).ok);
  eq(auditRecipes(RREG, createItemRegistry([{ id: 'wood', stack: 9, weight: 1, value: 1 }])).length > 0, true, 'audit más nyilvántartással');
});
test('crafting: hozzávalók hiánya -> reason items + missing', () => {
  const v = inv(); addItem(v, 'wood', 2); addItem(v, 'stone', 1);
  const c = craftCheck(v, getRecipe(RREG, 'axe'), null, 1);
  eq(c.ok, false); eq(c.reason, 'items'); eq(c.missing.length, 2);
  const m = Object.fromEntries(c.missing.map(x => [x.item, x])); eq(m.stone.have, 1); eq(m.stone.need, 2); eq(m.fiber.have, 0); eq(m.fiber.need, 2); assert(!m.wood);
  eq(craftCheck(v, getRecipe(RREG, 'axe'), null, 2).missing.find(x => x.item === 'wood').need, 4, 'times szorozza');
});
test('crafting: sikeres craft elvesz + hozzáad, atomi hibánál érintetlen', () => {
  const v = inv(); addItem(v, 'wood', 5); addItem(v, 'stone', 4); addItem(v, 'fiber', 3);
  const r = craft(v, getRecipe(RREG, 'axe'), null, 1);
  eq(r.ok, true); eq(r.made.item, 'axe'); eq(r.made.n, 1); eq(r.used.length, 3);
  eq(countItem(v, 'wood'), 3); eq(countItem(v, 'stone'), 2); eq(countItem(v, 'fiber'), 1); eq(countItem(v, 'axe'), 1);
  const before = snap(v);
  const r2 = craft(v, getRecipe(RREG, 'pickaxe'), null, 1);
  eq(r2.ok, false); eq(r2.reason, 'items'); eq(r2.made, null); eq(snap(v), before);
  const t = craft(v, getRecipe(RREG, 'torch'), null, 1); eq(t.ok, true); eq(countItem(v, 'torch'), 2); eq(countItem(v, 'wood'), 2); eq(countItem(v, 'fiber'), 0);
});
test('crafting: több darab egyszerre (times), kimenet stackelődik', () => {
  const v = inv(); addItem(v, 'wood', 10); addItem(v, 'fiber', 10);
  const r = craft(v, getRecipe(RREG, 'torch'), null, 4);
  eq(r.ok, true); eq(r.made.n, 8); eq(countItem(v, 'torch'), 8); eq(countItem(v, 'wood'), 6); eq(countItem(v, 'fiber'), 6); eq(usedSlots(v), 3);
  for (const t of [0, -1, 1.5, NaN, '2', null, 100, Infinity]) { const b = snap(v); eq(craft(v, getRecipe(RREG, 'torch'), null, t).reason, 'times', 'times ' + t); eq(snap(v), b); }
});
test('crafting: állomás-tag kell (tömb, Set, függvény; hibázó forrás = nincs)', () => {
  const rec = validateRecipeDef(R({ station: 'MUNKAPAD' }), IREG).recipe;
  const v = inv(); addItem(v, 'wood', 4);
  eq(craftCheck(v, rec, null).reason, 'station'); eq(craftCheck(v, rec, {}).reason, 'station'); eq(craftCheck(v, rec, { stations: [] }).reason, 'station');
  eq(craftCheck(v, rec, { stations: ['KEMENCE'] }).reason, 'station');
  eq(craftCheck(v, rec, { stations: ['MUNKAPAD'] }).ok, true); eq(craftCheck(v, rec, { stations: new Set(['MUNKAPAD']) }).ok, true);
  eq(craftCheck(v, rec, { stations: t => t === 'MUNKAPAD' }).ok, true);
  eq(craftCheck(v, rec, { stations: () => { throw new Error('x'); } }).reason, 'station'); eq(craftCheck(v, rec, { stations: 'MUNKAPAD' }).reason, 'station');
  const b = snap(v); eq(craft(v, rec, { stations: [] }).ok, false); eq(snap(v), b);
  eq(craft(v, rec, { stations: ['MUNKAPAD'] }).ok, true); eq(countItem(v, 'wood'), 2); eq(countItem(v, 'torch'), 1);
});
test('crafting: skill-szint kell (objektum, függvény; alap 0; hibás érték = 0)', () => {
  const rec = validateRecipeDef(R({ skill: { skill: 'smithing', level: 5 } }), IREG).recipe;
  const free = validateRecipeDef(R({ skill: { skill: 'smithing', level: 0 } }), IREG).recipe;
  const v = inv(); addItem(v, 'wood', 2);
  eq(craftCheck(v, rec, null).reason, 'skill'); eq(craftCheck(v, rec, { skills: { smithing: 4 } }).reason, 'skill');
  eq(craftCheck(v, rec, { skills: { smithing: 5 } }).ok, true); eq(craftCheck(v, rec, { skills: id => (id === 'smithing' ? 9 : 0) }).ok, true);
  eq(craftCheck(v, rec, { skills: { cooking: 50 } }).reason, 'skill');
  for (const bad of [NaN, '9', null, Infinity * 0, undefined, {}]) eq(craftCheck(v, rec, { skills: { smithing: bad } }).reason, 'skill', 'skill ' + String(bad));
  eq(craftCheck(v, rec, { skills: { __proto__: { smithing: 9 } } }).reason, 'skill', 'prototípus nem számít');
  eq(craftCheck(v, free, null).ok, true, 'level 0 mindig megy');
  eq(craftCheck(v, rec, { skills: () => { throw new Error('x'); } }).reason, 'skill');
});
test('crafting: a kimenetnek a bemenetek elvétele UTÁN kell elférnie (hely)', () => {
  const rec = getRecipe(RREG, 'axe');
  const v = inv(3); addItem(v, 'wood', 2); addItem(v, 'stone', 2); addItem(v, 'fiber', 2); // 3 slot, mind foglalt; a bemenetek elfogynak -> hely lesz
  eq(craftCheck(v, rec, null).ok, true); eq(craft(v, rec, null).ok, true); eq(countItem(v, 'axe'), 1); eq(usedSlots(v), 1);
  const w = inv(3); addItem(w, 'wood', 3); addItem(w, 'stone', 2); addItem(w, 'fiber', 2); // a fa megmarad (1) -> 3 slot: fa, + üres 2 -> a fejsze elfér
  eq(craft(w, rec, null).ok, true);
  const y = inv(4); addItem(y, 'wood', 3); addItem(y, 'stone', 2); addItem(y, 'fiber', 2); addItem(y, 'axe', 1); // axe stack 1: a 2. fejszének üres slot kell (a kő/rost slotja felszabadul)
  eq(craft(y, rec, null).ok, true); eq(countItem(y, 'axe'), 2);
});
test('crafting: tele inventory -> reason space, semmi nem változik', () => {
  const full = createInventory(IREG, 3); addItem(full, 'axe', 1); addItem(full, 'pickaxe', 1); addItem(full, 'wood', 99); // 3 slot tele
  const rr = validateRecipeDef(R({ inputs: [{ item: 'wood', n: 1 }], output: { item: 'axe', n: 1 } }), IREG).recipe;
  const b = snap(full); const c = craftCheck(full, rr, null); eq(c.ok, false); eq(c.reason, 'space');
  const r = craft(full, rr, null); eq(r.ok, false); eq(r.reason, 'space'); eq(snap(full), b);
  const one = createInventory(IREG, 1); addItem(one, 'wood', 1);
  const t = validateRecipeDef(R({ inputs: [{ item: 'wood', n: 1 }], output: { item: 'torch', n: 1 } }), IREG).recipe;
  eq(craft(one, t, null).ok, true, 'a bemenet helye felszabadul'); eq(countItem(one, 'torch'), 1);
});
test('crafting: maxCraftable (hozzávaló és hely korlátoz, maxBatch fölé nem)', () => {
  const v = inv(); const torch = getRecipe(RREG, 'torch');
  eq(maxCraftable(v, torch, null), 0); addItem(v, 'wood', 5); addItem(v, 'fiber', 3); eq(maxCraftable(v, torch, null), 3);
  const big = createInventory(IREG, 120); addItem(big, 'wood', 99); addItem(big, 'fiber', 99); eq(maxCraftable(big, torch, null), CRAFT_LIMITS.maxBatch);
  const st = validateRecipeDef(R({ station: 'KEMENCE' }), IREG).recipe; eq(maxCraftable(big, st, null), 0); eq(maxCraftable(big, st, { stations: ['KEMENCE'] }), 49);
  const tight = createInventory(IREG, 2); addItem(tight, 'wood', 3); // fa slot + 1 üres: a fejsze (stack 1) csak egyszer fér el
  const axeR = validateRecipeDef(R({ inputs: [{ item: 'wood', n: 1 }], output: { item: 'axe', n: 1 } }), IREG).recipe;
  eq(maxCraftable(tight, axeR, null), 1, 'axe stack 1, egy üres slot'); eq(maxCraftable(null, torch, null), 0);
});
test('crafting: recipesAt + craftList (állomás szerint, állapottal)', () => {
  const extra = createRecipeRegistry([...RECIPE_DEFS, R({ id: 'zz', station: 'KEMENCE' }), R({ id: 'aa', station: 'KEMENCE' })], IREG);
  eq(recipesAt(extra, null).length, 4); eq(recipesAt(extra).length, 4); eq(recipesAt(extra, 'KEMENCE').map(r => r.id).join(), 'aa,zz'); eq(recipesAt(extra, 'MUNKAPAD').length, 0); eq(recipesAt(null).length, 0);
  const v = inv(); addItem(v, 'wood', 1); addItem(v, 'fiber', 1);
  const l = craftList(extra, v, null, null); eq(l.length, 4);
  const t = l.find(x => x.recipe.id === 'torch'); eq(t.craftable, true); eq(t.max, 1); const a = l.find(x => x.recipe.id === 'axe'); eq(a.craftable, false); eq(a.reason, 'items'); eq(a.max, 0); assert(a.missing.length > 0);
  eq(craftList(extra, v, null, 'KEMENCE').every(x => x.reason === 'station'), true);
});
test('crafting: hibás bemenet (inventory, recept) nem dob és nem módosít', () => {
  const v = inv(); addItem(v, 'wood', 3); const b = snap(v);
  for (const rc of [null, undefined, {}, { inputs: 5 }, { inputs: [], output: null }, 'axe']) { eq(craftCheck(v, rc, null).reason, 'recipe'); eq(craft(v, rc, null).ok, false); }
  for (const iv of [null, undefined, {}, { slots: 'x' }]) { eq(craftCheck(iv, getRecipe(RREG, 'torch'), null).reason, 'recipe'); eq(craft(iv, getRecipe(RREG, 'torch'), null).ok, false); }
  eq(snap(v), b);
});
test('crafting: két inventory független (két játékos)', () => {
  const a = inv(), c = inv(); addItem(a, 'wood', 1); addItem(a, 'fiber', 1); addItem(c, 'wood', 1);
  eq(craft(a, getRecipe(RREG, 'torch'), null).ok, true); eq(craft(c, getRecipe(RREG, 'torch'), null).ok, false); eq(countItem(c, 'wood'), 1); eq(countItem(c, 'torch'), 0);
});
test('crafting: 4000 véletlen művelet – összeg-tartás a recept szerint, atomi, determinisztikus', () => {
  const run = seed => {
    let s = seed; const rnd = n => { s = (s * 1664525 + 1013904223) >>> 0; return s % n; };
    const v = createInventory(IREG, 8); const ids = ['torch', 'axe', 'pickaxe', 'sickle']; const log = [];
    for (let i = 0; i < 4000; i++) {
      const k = rnd(3);
      if (k === 0) addItem(v, ['wood', 'stone', 'fiber'][rnd(3)], 1 + rnd(30));
      else {
        const r = getRecipe(RREG, ids[rnd(4)]), t = 1 + rnd(5), before = snap(v);
        const cnt = Object.fromEntries(['wood', 'stone', 'fiber', 'torch', 'axe', 'pickaxe', 'sickle'].map(x => [x, countItem(v, x)]));
        const res = craft(v, r, null, t);
        if (res.ok) {
          for (const e of r.inputs) cnt[e.item] -= e.n * t;
          cnt[r.output.item] += r.output.n * t;
          for (const x of Object.keys(cnt)) assert(countItem(v, x) === cnt[x], 'összeg ' + x + ' @' + i);
        } else assert(snap(v) === before, 'hiba után érintetlen @' + i);
      }
      if (k === 2 && rnd(4) === 0) { for (const x of ['axe', 'pickaxe', 'sickle', 'torch']) { const n = countItem(v, x); if (n) { v.slots.forEach(sl => { if (sl && sl.id === x) sl.n = 0; }); v.slots = v.slots.map(sl => (sl && sl.n === 0 ? null : sl)); } } }
      log.push(usedSlots(v));
    }
    return log.join(',') + '|' + snap(v);
  };
  eq(run(7), run(7), 'determinisztikus'); assert(run(7) !== run(8));
});
