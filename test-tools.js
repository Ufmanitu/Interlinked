// S060 tesztek: craftolható alap-szerszámok (fáklya, fejsze, csákány, sarló, kötél) mint kasztfüggetlen tag-forrás – adat, összesítés, források, audit, craft -> akadály lánc, fuzz.
import { test, assert, eq } from './test-index.js';
import { createPlayer } from './game-player.js';
import { ITEM_DEFS, ITEM_TEXTS } from './data-items.js';
import { RECIPE_DEFS } from './data-recipes.js';
import { NODE_DEFS } from './data-nodes.js';
import { ABILITY_DEFS, CLASS_DEFS, RACE_DEFS } from './data-character.js';
import { createRecipeRegistry, getRecipe, craft } from './game-crafting.js';
import { createPlayerInventories, createInventory, addItem, removeItem, hasItem } from './game-inventory.js';
import { createObstacleSystem, stepObstacles, obstacleOpen } from './game-obstacle.js';
import { mulberry32 } from './world-noise.js';
import { TOOLKIT, TOOL_TAGS, heldTags, toolTagsOf, playerTagSet, solvesAny, holdsTag, tagSources, handObtainable, classFreeTags, classFreeSolutions, auditToolkit } from './game-tools.js';

const SRC = { items: ITEM_DEFS, recipes: RECIPE_DEFS, nodes: NODE_DEFS, abilities: ABILITY_DEFS, races: RACE_DEFS, classes: CLASS_DEFS };
const clone = v => JSON.parse(JSON.stringify(v));
const recipeOf = (invs, id) => getRecipe(createRecipeRegistry(RECIPE_DEFS, invs[0].reg), id);

test('tools: adat – az alap-szerszámkészlet fagyasztott, minden tárgy/tag/recept megvan, kézzel craftolható, az élő audit hibátlan, HU/EN név', () => {
  eq(TOOLKIT.length, 5); eq(TOOL_TAGS.join(','), 'FÁKLYA,FEJSZE,CSÁKÁNY,SARLÓ,KÖTÉL');
  assert(Object.isFrozen(TOOLKIT) && Object.isFrozen(TOOL_TAGS) && TOOLKIT.every(k => Object.isFrozen(k)), 'fagyasztott');
  eq(JSON.stringify(auditToolkit(SRC)), '[]');
  for (const k of TOOLKIT) {
    const r = RECIPE_DEFS.find(x => x.output.item === k.item);
    assert(r && r.station === null && r.skill === null, k.item + ': kézi recept');
    assert(ITEM_TEXTS.hu[k.item] && ITEM_TEXTS.en[k.item], k.item + ': szöveg');
  }
  const rope = ITEM_DEFS.find(d => d.id === 'rope');
  assert(rope && rope.tags.includes('KÖTÉL') && rope.stack >= 1, 'kötél-tárgy');
});

test('tools: heldTags / toolTagsOf – az inventory tárgyainak tag-jei (a tool.tag is), eldobva eltűnik, hibás bemenet = üres', () => {
  const inv = createInventory(createPlayerInventories()[0].reg);
  eq(heldTags(inv).size, 0); eq(toolTagsOf(inv).size, 0);
  addItem(inv, 'axe', 1); addItem(inv, 'torch', 3); addItem(inv, 'wood', 4);
  const h = heldTags(inv);
  assert(h.has('FEJSZE') && h.has('FÁKLYA') && h.has('ESZKÖZ') && h.has('MATERIAL') && h.has('FUEL'), 'tag-ek');
  eq([...toolTagsOf(inv)].sort().join(','), 'FEJSZE,FÁKLYA'.split(',').sort().join(','));
  addItem(inv, 'rope', 1); assert(toolTagsOf(inv).has('KÖTÉL'), 'kötél');
  removeItem(inv, 'axe', 1); assert(!toolTagsOf(inv).has('FEJSZE') && toolTagsOf(inv).has('FÁKLYA'), 'fejsze elfogyott');
  for (const bad of [null, undefined, 5, 'x', {}, { slots: 'x' }, { slots: [], reg: null }, { slots: [{ id: 'axe' }], reg: {} }]) eq(heldTags(bad).size, 0, 'hibás: ' + JSON.stringify(bad));
  eq(heldTags({ slots: [null, 7, { id: 'nincs' }], reg: inv.reg }).size, 0);
});

test('tools: playerTagSet – inventory + faj/kaszt-tag + extra egyesítve; solvesAny', () => {
  const inv = createPlayerInventories()[0], p = createPlayer(0, 0, 0); p.tags = ['SÖTÉTLÁTÁS', 7];
  addItem(inv, 'rope', 1);
  const set = playerTagSet(inv, p, ['FÉNY', null]);
  assert(set.has('KÖTÉL') && set.has('SÖTÉTLÁTÁS') && set.has('FÉNY') && !set.has(7) && !set.has(null), 'egyesítés');
  assert(playerTagSet(null, null).size === 0 && playerTagSet(inv, {}, 'nem tömb').has('KÖTÉL'), 'hibás bemenet');
  assert(solvesAny({ solves: ['ÉGETÉS', 'FEJSZE'] }, ['FEJSZE']) && solvesAny({ solves: ['FÁKLYA'] }, new Set(['FÁKLYA'])), 'feloldja');
  assert(!solvesAny({ solves: ['ÉGETÉS'] }, ['FEJSZE']) && !solvesAny(null, ['X']) && !solvesAny({}, ['X']), 'nem oldja');
  eq(holdsTag(inv, 'KÖTÉL'), true); eq(holdsTag(inv, 'FEJSZE'), false); eq(holdsTag(null, 'X'), false);
});

test('tools: tagSources – a tag forrásai tárgy / képesség / faj / kaszt (a kötél: tárgy ÉS ranger-képesség; a fáklya: tárgy; a sötétlátás: faj)', () => {
  const kinds = tag => tagSources(SRC, tag).map(s => s.kind + ':' + s.id).sort();
  assert(kinds('KÖTÉL').includes('item:rope') && kinds('KÖTÉL').includes('ability:rope'), 'kötél: ' + kinds('KÖTÉL'));
  assert(kinds('FEJSZE').includes('item:axe') && kinds('FÁKLYA').includes('item:torch') && kinds('CSÁKÁNY').includes('item:pickaxe') && kinds('SARLÓ').includes('item:sickle'), 'tárgy-források');
  assert(kinds('SÖTÉTLÁTÁS').some(s => s.startsWith('race:')), 'faj-forrás');
  eq(tagSources(SRC, 'NINCS_ILYEN').length, 0); eq(tagSources(null, 'X').length, 0); eq(tagSources({ items: 'x', races: [null, 3, {}] }, 'X').length, 0);
});

test('tools: kézi elérhetőség – a node-drop és a kézi receptek zárlata; állomásos recept csak az állomással; skill-es recept nem; a tag-ek kaszt nélkül is megvannak', () => {
  const hand = handObtainable(SRC);
  for (const id of ['wood', 'stone', 'fiber', 'herb', 'torch', 'axe', 'pickaxe', 'sickle', 'rope', 'workbench', 'cookfire']) assert(hand.has(id), id + ' kézzel elérhető');
  assert(!hand.has('furnace') && !hand.has('shard'), 'kemence állomás nélkül / szilánk nem');
  assert(handObtainable(SRC, { stations: ['MUNKAPAD'] }).has('furnace'), 'kemence munkapaddal');
  const sk = handObtainable({ nodes: NODE_DEFS, items: ITEM_DEFS, recipes: [{ id: 'x', inputs: [{ item: 'wood', n: 1 }], output: { item: 'axe', n: 1 }, station: null, skill: { skill: 'mining', level: 5 } }] });
  assert(!sk.has('axe'), 'skill-es recept nem kézi');
  const free = classFreeTags(SRC);
  for (const tg of TOOL_TAGS) assert(free.has(tg), tg + ' kaszt nélkül');
  assert(!free.has('FÉNY') && !free.has('SÖTÉTLÁTÁS') && !free.has('ÉGETÉS'), 'a képesség/faj-tag nem kasztfüggetlen');
  eq(handObtainable(null).size, 0); eq(classFreeTags(undefined).size, 0);
});

test('tools: az akadályok kasztfüggetlen megoldásai – minden élő akadálynak van kézzel elérhető tag-megoldása (a kaszt nem kapu)', () => {
  const os = createObstacleSystem(), sol = classFreeSolutions(os, SRC);
  eq(Object.keys(sol).length, os.items.size);
  for (const [id, tags] of Object.entries(sol)) assert(tags.length >= 1, id + ': nincs kasztfüggetlen megoldás');
  assert(sol.thorn_thicket.includes('FEJSZE') && sol.dark_gate.includes('FÁKLYA'), 'fejsze / fáklya');
  eq(Object.keys(classFreeSolutions(null, SRC)).length, 0);
});

test('tools: audit – hiányzó tárgy / tag / recept, állomásos és skill-es recept, kézzel nem beszerezhető bemenet elbukik; az eredeti adat nem módosul', () => {
  const orig = JSON.stringify(SRC);
  const mut = fn => { const s = clone(SRC); fn(s); return auditToolkit(s); };
  assert(mut(s => { s.items = s.items.filter(d => d.id !== 'rope'); }).includes('rope:noitem'), 'noitem');
  assert(mut(s => { s.items.find(d => d.id === 'rope').tags = ['ESZKÖZ']; }).includes('rope:notag'), 'notag');
  assert(mut(s => { s.recipes = s.recipes.filter(r => r.id !== 'rope'); }).includes('rope:norecipe'), 'norecipe');
  assert(mut(s => { s.recipes.find(r => r.id === 'rope').station = 'MUNKAPAD'; }).includes('rope:station'), 'station');
  assert(mut(s => { s.recipes.find(r => r.id === 'axe').skill = { skill: 'mining', level: 3 }; }).includes('axe:skill'), 'skill');
  assert(mut(s => { s.recipes.find(r => r.id === 'torch').inputs.push({ item: 'shard', n: 1 }); }).includes('torch:inputs'), 'inputs');
  assert(mut(s => { s.nodes = []; }).includes('torch:inputs'), 'node-drop nélkül nincs alapanyag');
  eq(auditToolkit(null).length, TOOLKIT.length); eq(auditToolkit(SRC, []).length, 0);
  eq(JSON.stringify(SRC), orig);
});

test('tools: lánc – alapanyagból kézzel craftolt fáklya, fejsze és kötél kaszt nélkül kinyitja a sötét átjárót, kivágja a bozótot, és a kötél a KÖTÉL-tag-et adja', () => {
  const invs = createPlayerInventories(), os = createObstacleSystem(), pl = [createPlayer(0, -250, -48), createPlayer(1, 300, 0)];
  addItem(invs[0], 'wood', 3); addItem(invs[0], 'fiber', 7); addItem(invs[1], 'wood', 3); addItem(invs[1], 'stone', 2); addItem(invs[1], 'fiber', 2);
  const torch = craft(invs[0], recipeOf(invs, 'torch'), {}, 1), rope = craft(invs[0], recipeOf(invs, 'rope'), {}, 1), axe = craft(invs[1], recipeOf(invs, 'axe'), {}, 1);
  assert(torch.ok && rope.ok && axe.ok, 'craft: ' + [torch.reason, rope.reason, axe.reason]);
  assert(hasItem(invs[0], 'torch', 2) && hasItem(invs[0], 'rope', 1) && hasItem(invs[1], 'axe', 1), 'tárgyak');
  assert(toolTagsOf(invs[0]).has('KÖTÉL') && toolTagsOf(invs[0]).has('FÁKLYA') && toolTagsOf(invs[1]).has('FEJSZE'), 'tag-ek');
  eq(craft(invs[1], recipeOf(invs, 'rope'), {}, 1).ok, false, 'a 2. játékosnak már nincs elég rostja');
  const thicket = os.items.get('thorn_thicket'), inputs = [{}, { interact: true }], targets = [null, { kind: 'obstacle', ref: thicket, action: 'clear' }];
  for (let k = 0; k < 90; k++) stepObstacles(os, 1 / 60, { players: pl, inventories: invs, inputs, targets });
  eq(obstacleOpen(os, 'dark_gate'), true, 'a fáklya kinyitja'); eq(obstacleOpen(os, 'thorn_thicket'), true, 'a fejsze kivágja');
});

test('tools: 4000 lépéses fuzz – a heldTags egyezik a game-inventory hasTag-jével minden tag-re, a tag csak a tárgy megléténél van, determinizmus', () => {
  const run = seed => {
    const rnd = mulberry32(seed), inv = createPlayerInventories()[0], ids = ['wood', 'stone', 'fiber', 'torch', 'axe', 'pickaxe', 'sickle', 'rope', 'herb'];
    let sig = 0;
    for (let k = 0; k < 4000; k++) {
      const id = ids[Math.floor(rnd() * ids.length)], n = 1 + Math.floor(rnd() * 3);
      if (rnd() < 0.55) addItem(inv, id, n); else removeItem(inv, id, n);
      const h = heldTags(inv);
      for (const tg of [...TOOL_TAGS, 'MATERIAL', 'FUEL', 'HERB', 'ESZKÖZ']) eq(h.has(tg), holdsTag(inv, tg), 'k=' + k + ' ' + tg);
      for (const kit of TOOLKIT) eq(toolTagsOf(inv).has(kit.tag), hasItem(inv, kit.item, 1), 'k=' + k + ' ' + kit.item);
      sig = (sig * 31 + h.size + toolTagsOf(inv).size) % 1000003;
    }
    return sig;
  };
  eq(run(60), run(60), 'determinizmus');
});
