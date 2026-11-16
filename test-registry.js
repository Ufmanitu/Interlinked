// S052 tesztek: adat-regiszter (fajok, kasztok, képességek, hivatkozás-audit). Az "élő adat" teszt a tests.html jelzője: piros, ha bármely adatfájlban hiányzó hivatkozás/szöveg van.
import { test, assert, eq } from './test-index.js';
import { ITEM_DEFS } from './data-items.js';
import { RACE_DEFS, CLASS_DEFS, ABILITY_DEFS } from './data-character.js';
import { mulberry32 } from './world-noise.js';
import {
  REGISTRY_LIMITS, validateAbilityDef, validateRaceDef, validateClassDef, createCharacterRegistry, getRace, getClass, getAbility,
  auditCharacter, loadRegistry, collectTexts, requiredTextKeys, auditRegistryTexts, reportRegistry,
} from './game-registry.js';

const A = (o = {}) => ({ id: 'spark', resource: 'mana', cost: 5, cooldown: 2, target: 'enemy', range: 6, power: 10, tags: ['ÉGETÉS'], ...o });
const R = (o = {}) => ({ id: 'dwarf', strength: 1.2, weight: 1.1, speed: 0.9, tags: ['SÖTÉTLÁTÁS'], passives: [{ id: 'miner', value: 0.2 }], startItems: [{ item: 'pickaxe', n: 1 }], ...o });
const C = (o = {}) => ({ id: 'mage', resource: 'mana', abilities: ['spark', 'glow'], tags: ['FÉNY'], startItems: [{ item: 'torch', n: 2 }], ...o });
const SET = () => ({ races: [R()], classes: [C()], abilities: [A(), A({ id: 'glow', tags: ['FÉNY'], target: 'self' })] });
const TEXTS_FOR = ids => {
  const t = collectTexts();
  for (const l of ['hu', 'en']) for (const k of ids) t[l][k] = k;
  return t;
};

test('registry: ÉLŐ ADAT – minden adatfájl érvényes, nincs duplikátum, hiányzó hivatkozás és hiányzó HU/EN szöveg', () => {
  const reg = loadRegistry();
  const rep = reportRegistry(reg, auditRegistryTexts(reg));
  assert(rep.ok, rep.title + ': ' + rep.lines.slice(1, 21).join(' | '));
  eq(reg.items.items.size, ITEM_DEFS.length); eq(reg.character.races.size, RACE_DEFS.length);
  eq(reg.character.classes.size, CLASS_DEFS.length); eq(reg.character.abilities.size, ABILITY_DEFS.length);
  assert(reg.recipes.recipes.size > 0 && reg.stations.stations.size > 0 && reg.nodes.nodes.size > 0);
});

test('registry: képesség – alapértékek, fagyasztás, nameKey; hibás mezők kiesnek', () => {
  const r = validateAbilityDef({ id: 'x' });
  assert(r.ok && r.def.resource === null && r.def.cost === 0 && r.def.cooldown === 0 && r.def.target === 'none' && r.def.item === null && r.def.tags.length === 0);
  eq(r.def.nameKey, 'ability.x'); assert(Object.isFrozen(r.def) && Object.isFrozen(r.def.tags));
  const g = validateAbilityDef(A({ tags: ['ÉGETÉS', 'ÉGETÉS', 'FÉNY'], item: 'torch' }));
  assert(g.ok); eq(g.def.tags.length, 2); eq(g.def.item, 'torch');
  const bad = [null, 5, 'x', [], {}, A({ id: 'X' }), A({ id: '__proto__' }), A({ id: 'a'.repeat(49) }), A({ resource: 'rage' }), A({ cost: -1 }), A({ cost: NaN }),
    A({ cost: 5, resource: null }), A({ cost: 1e9 }), A({ cooldown: -1 }), A({ cooldown: 4000 }), A({ target: 'sky' }), A({ range: 65 }), A({ range: '3' }),
    A({ power: Infinity }), A({ tags: 'FÉNY' }), A({ tags: ['kisbetű'] }), A({ tags: Array.from({ length: 9 }, (_, i) => 'T' + i) }), A({ item: 'Nagy' }), A({ item: 7 })];
  for (const b of bad) { const x = validateAbilityDef(b); assert(!x.ok && x.def === null && typeof x.error === 'string', JSON.stringify(b)); }
});

test('registry: faj – alapértékek, passzívok, kezdő-tárgyak, hibás mezők', () => {
  const r = validateRaceDef({ id: 'human' });
  assert(r.ok && r.def.strength === 1 && r.def.weight === 1 && r.def.speed === 1 && r.def.passives.length === 0 && r.def.startItems.length === 0);
  const g = validateRaceDef(R());
  assert(g.ok && g.def.passives[0].id === 'miner' && g.def.startItems[0].n === 1 && Object.isFrozen(g.def.passives[0]) && Object.isFrozen(g.def.startItems));
  eq(g.def.nameKey, 'race.dwarf');
  const bad = [null, {}, R({ id: '1x' }), R({ strength: 0 }), R({ strength: 5 }), R({ weight: -1 }), R({ speed: 0.1 }), R({ speed: 3 }), R({ tags: [1] }),
    R({ passives: 'x' }), R({ passives: [null] }), R({ passives: [{ id: 'P' }] }), R({ passives: [{ id: 'a' }, { id: 'a' }] }), R({ passives: [{ id: 'a', value: 1e9 }] }),
    R({ passives: Array.from({ length: 9 }, (_, i) => ({ id: 'p' + i })) }), R({ startItems: [{ item: 'wood', n: 0 }] }), R({ startItems: [{ item: 'wood', n: 1.5 }] }),
    R({ startItems: [{ item: 'wood', n: 1 }, { item: 'wood', n: 2 }] }), R({ startItems: [{ item: 'Wood', n: 1 }] }), R({ startItems: [{ item: 'wood', n: 1000 }] }), R({ startItems: 'x' })];
  for (const b of bad) assert(!validateRaceDef(b).ok, JSON.stringify(b));
});

test('registry: kaszt – képesség-lista, erőforrás, hibás mezők', () => {
  const r = validateClassDef({ id: 'monk' });
  assert(r.ok && r.def.resource === null && r.def.abilities.length === 0);
  const g = validateClassDef(C()); assert(g.ok); eq(g.def.abilities.join(), 'spark,glow'); eq(g.def.nameKey, 'class.mage'); assert(Object.isFrozen(g.def.abilities));
  const bad = [null, {}, C({ id: 'Mage' }), C({ resource: 'rage' }), C({ abilities: 'x' }), C({ abilities: ['a', 'a'] }), C({ abilities: ['Nagy'] }), C({ abilities: [3] }),
    C({ abilities: Array.from({ length: 9 }, (_, i) => 'a' + i) }), C({ tags: ['x'] }), C({ startItems: [{ item: 'wood' }] })];
  for (const b of bad) assert(!validateClassDef(b).ok, JSON.stringify(b));
});

test('registry: nyilvántartás – hibás kiesik, duplikátum felülír, kártékony bemenet nem dob, getterek', () => {
  const reg = createCharacterRegistry({ races: [R(), R({ strength: 2 }), null, 5, R({ id: 'bad', speed: 9 })], classes: [C(), { id: 'Bad' }], abilities: [A(), A({ power: 77 }), 'x'] });
  eq(reg.races.size, 1); eq(getRace(reg, 'dwarf').strength, 2); eq(reg.classes.size, 1); eq(reg.abilities.size, 1); eq(getAbility(reg, 'spark').power, 77);
  assert(reg.dups.has('race:dwarf') && reg.dups.has('ability:spark')); eq(reg.errors.length, 5);
  assert(reg.errors.includes('race:null') === false && reg.errors.some(e => e.startsWith('race:def')));
  for (const hostile of [undefined, null, 5, 'x', [], {}, { races: 'x', classes: 5, abilities: {} }]) {
    const x = createCharacterRegistry(hostile); eq(x.races.size + x.classes.size + x.abilities.size, 0);
  }
  const trap = { get races() { throw new Error('boom'); }, classes: [C()], abilities: [new Proxy({}, { get() { throw new Error('boom'); } })] };
  const t = createCharacterRegistry(trap); eq(t.classes.size, 1); eq(t.abilities.size, 0); assert(t.errors.some(e => e.includes('kivétel')));
  eq(getRace(reg, '__proto__'), null); eq(getClass(reg, 'constructor'), null); eq(getAbility(null, 'x'), null); eq(getRace(reg, 5), null);
  const many = createCharacterRegistry({ abilities: Array.from({ length: 400 }, (_, i) => A({ id: 'a' + i })) }); eq(many.abilities.size, REGISTRY_LIMITS.maxEach);
});

test('registry: audit – hiányzó képesség- és tárgy-hivatkozások pontosan listázva', () => {
  const ok = createCharacterRegistry(SET());
  eq(auditCharacter(ok, loadRegistry().items).join(), '');
  const reg = createCharacterRegistry({
    races: [R({ startItems: [{ item: 'nincs', n: 1 }] })], classes: [C({ abilities: ['spark', 'hiany'], startItems: [{ item: 'ures', n: 1 }] })],
    abilities: [A(), A({ id: 'glow', item: 'semmi' })],
  });
  const got = auditCharacter(reg, loadRegistry().items).sort();
  eq(got.join(), ['ability:glow>item:semmi', 'class:mage>ability:hiany', 'class:mage>item:ures', 'race:dwarf>item:nincs'].join());
  eq(auditCharacter(null, null).length, 0); eq(auditCharacter(reg, null).length >= 4, true);
});

test('registry: loadRegistry – érvényes minta-adat zöld; hibák és hivatkozások forrás-előtaggal', () => {
  const good = loadRegistry(SET());
  assert(good.ok, good.errors.concat(good.dups, good.problems).join()); eq(good.character.races.size, 1); eq(good.character.classes.get('mage').abilities.length, 2);
  const bad = loadRegistry({ ...SET(), classes: [C({ abilities: ['hiany'] })], races: [R(), R(), R({ id: 'X' })] });
  assert(!bad.ok); assert(bad.problems.includes('class:mage>ability:hiany')); assert(bad.dups.includes('character:race:dwarf')); assert(bad.errors.includes('character:race:def') === false);
  assert(bad.errors.some(e => e.startsWith('character:race:')));
  const items = [{ id: 'wood', stack: 9, weight: 1, value: 1 }];
  const x = loadRegistry({ items, recipes: [{ id: 'r', inputs: [{ item: 'wood', n: 1 }], output: { item: 'wood', n: 1 }, station: null, skill: null }], stations: [], nodes: [], races: [], classes: [], abilities: [] });
  assert(x.ok && x.recipes.recipes.size === 1 && x.stations.stations.size === 0);
  for (const h of [undefined, null, 5, 'x', { items: 'x' }]) assert(loadRegistry(h).ok, 'hostile ' + String(h));
});

test('registry: TAG-hivatkozások – ismeretlen állomás-TAG és elérhetetlen eszköz-TAG/tier jelezve', () => {
  const items = [
    { id: 'wood', stack: 9, weight: 1, value: 1 }, { id: 'bench', stack: 1, weight: 1, value: 1, tags: ['ÁLLOMÁS'] },
    { id: 'axe', stack: 1, weight: 1, value: 1, tool: { tag: 'FEJSZE', tier: 1, speed: 2, power: 1 } },
  ];
  const stations = [{ id: 'bench', tag: 'MUNKAPAD', item: 'bench', collider: { w: 8, h: 8 }, sprite: { w: 8, h: 8, ax: 4, ay: 4 }, range: 64, palette: [] }];
  const rec = (id, station) => ({ id, inputs: [{ item: 'wood', n: 1 }], output: { item: 'axe', n: 1 }, station, skill: null });
  const node = (o = {}) => ({ type: 'tree', tool: 'FEJSZE', minTier: 1, hp: 1, time: 1, regrow: 10, heal: 0, drops: [{ item: 'wood', min: 1, max: 1, chance: 1 }], ...o });
  const run = (recipes, nodes) => loadRegistry({ items, stations, recipes, nodes, races: [], classes: [], abilities: [] });
  eq(run([rec('a', 'MUNKAPAD'), rec('b', null)], [node()]).problems.length, 0);
  eq(run([rec('a', 'KEMENCE')], []).problems.join(), 'recipe:a>station:KEMENCE');
  eq(run([], [node({ tool: 'CSÁKÁNY', minTier: 0 })]).problems.join(), 'node:tree>tool:CSÁKÁNY');
  eq(run([], [node({ minTier: 2 })]).problems.join(), 'node:tree>tier:2');
  eq(run([], [node({ drops: [{ item: 'nincs', min: 1, max: 1, chance: 1 }] })]).problems.join(), 'node:tree>item:nincs');
  assert(loadRegistry().problems.length === 0);
});

test('registry: szövegek – kötelező kulcsok, hiány jelzése HU/EN, élő szöveg-tábla teljes', () => {
  const reg = loadRegistry(SET());
  const keys = requiredTextKeys(reg);
  for (const k of ['item.wood', 'obj.workbench', 'obj.tree', 'obj.herb', 'race.dwarf', 'class.mage', 'ability.spark', 'ability.glow']) assert(keys.includes(k), k);
  const miss = auditRegistryTexts(reg);
  eq(miss.sort().join(), ['en:ability.glow', 'en:ability.spark', 'en:class.mage', 'en:race.dwarf', 'hu:ability.glow', 'hu:ability.spark', 'hu:class.mage', 'hu:race.dwarf'].join());
  eq(auditRegistryTexts(reg, TEXTS_FOR(['race.dwarf', 'class.mage', 'ability.spark', 'ability.glow'])).length, 0);
  const half = TEXTS_FOR(['race.dwarf', 'class.mage', 'ability.spark', 'ability.glow']); delete half.en['class.mage']; half.hu['race.dwarf'] = '';
  eq(auditRegistryTexts(reg, half).sort().join(), 'en:class.mage,hu:race.dwarf');
  eq(auditRegistryTexts(reg, null).length, keys.length * 2); eq(requiredTextKeys(null).length, 0);
  eq(auditRegistryTexts(loadRegistry(), collectTexts()).length, 0);
});

test('registry: jelentés – zöld/piros cím és sorok; hibás regiszter nem dob', () => {
  const g = reportRegistry(loadRegistry(SET()), []);
  assert(g.ok && g.title === 'registry: zöld' && g.lines.length === 1 && g.lines[0].includes('faj 1') && g.lines[0].includes('képesség 2'));
  const b = reportRegistry(loadRegistry({ ...SET(), classes: [C({ abilities: ['hiany'] })] }), ['hu:class.x']);
  assert(!b.ok && b.title === 'registry: 2 hiba'); assert(b.lines.includes('HIÁNYZÓ class:mage>ability:hiany') && b.lines.includes('SZÖVEG hu:class.x'));
  for (const x of [null, undefined, {}, 5]) { const r = reportRegistry(x); assert(!r.ok && r.lines.length === 1); }
});

test('registry: fuzz 3000 kártékony adat – nem dob, minden elem fagyasztott, a hivatkozás-audit sosem dob', () => {
  const rnd = mulberry32(5252);
  const pickv = a => a[Math.floor(rnd() * a.length)];
  const junk = () => pickv([undefined, null, 0, -1, 1e9, NaN, Infinity, '', 'x', 'spark', 'FÉNY', [], {}, [1, 2], ['FÉNY'], [{ item: 'wood', n: 1 }], { item: 'wood', n: 1 }, true]);
  const mk = base => { const o = { ...base }; for (const k of Object.keys(o)) if (rnd() < 0.35) o[k] = junk(); if (rnd() < 0.1) delete o.id; return o; };
  let accepted = 0;
  for (let i = 0; i < 3000; i++) {
    const reg = loadRegistry({ races: [mk(R())], classes: [mk(C()), mk(C({ id: 'c2' }))], abilities: [mk(A()), mk(A({ id: 'glow' }))] });
    for (const m of [reg.character.races, reg.character.classes, reg.character.abilities]) for (const d of m.values()) { assert(Object.isFrozen(d) && typeof d.id === 'string' && d.nameKey.endsWith(d.id)); accepted++; }
    assert(Array.isArray(reg.problems) && Array.isArray(auditRegistryTexts(reg)) && typeof reportRegistry(reg).ok === 'boolean');
  }
  assert(accepted > 300, 'a fuzz elfogadott elemeket is adott: ' + accepted);
});
