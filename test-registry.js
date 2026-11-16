// S052 tesztek: adat-regiszter (fajok, kasztok, képességek, hivatkozás-audit). Az "élő adat" teszt a tests.html jelzője: piros, ha bármely adatfájlban hiányzó hivatkozás/szöveg van.
import { test, assert, eq, near } from './test-index.js';
import { ITEM_DEFS } from './data-items.js';
import { RACE_DEFS, CLASS_DEFS, ABILITY_DEFS } from './data-character.js';
import { mulberry32 } from './world-noise.js';
import { CHARACTER_TEXTS } from './data-character.js';
import { createPlayer, PLAYER_SPEED } from './game-player.js';
import { createTetherSystem, stepTetherSystem, pullFactor } from './tether-system.js';
import { capacityOf } from './game-encumbrance.js';
import { RACE_CONFIG, raceOf, passiveOf, hasRaceTag, applyRace, clearRace, darkvisionTiles, gatherSpeedMul, terrainMulFor, raceTerrain, raceView } from './game-race.js';
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
  eq(createCharacterRegistry().races.size, RACE_DEFS.length); // S053: alapértelmezett = az élő adat
  for (const hostile of [null, 5, 'x', [], {}, { races: 'x', classes: 5, abilities: {} }]) {
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
  eq(miss.sort().join(), ['en:ability.glow', 'en:ability.spark', 'en:class.mage', 'hu:ability.glow', 'hu:ability.spark', 'hu:class.mage'].join()); // S053: a race.dwarf élő szöveg már van
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

// ---- S053: három faj (törpe, tünde, ork) – adat + hatás ----
const CREG = () => loadRegistry().character;
const mk = (i, race, x = 0, y = 0) => { const p = createPlayer(i, x, y); if (race) assert(applyRace(CREG(), p, race), race); return p; };

test('race: adat – törpe/tünde/ork érvényes, HU/EN név + leírás, tag, két passzív, az élő regiszter zöld', () => {
  const reg = CREG();
  eq([...reg.races.keys()].sort().join(), 'dwarf,elf,orc');
  const rep = loadRegistry(); assert(rep.ok, rep.errors.concat(rep.dups, rep.problems).join());
  for (const id of ['dwarf', 'elf', 'orc']) {
    const r = reg.races.get(id);
    eq(r.passives.length, 2, id); eq(r.tags.length, 1, id); assert(Object.isFrozen(r), id);
    for (const l of ['hu', 'en']) {
      assert(typeof CHARACTER_TEXTS[l]['race.' + id] === 'string' && CHARACTER_TEXTS[l]['race.' + id].length > 0, l + id);
      assert(typeof CHARACTER_TEXTS[l]['race.' + id + '.desc'] === 'string' && CHARACTER_TEXTS[l]['race.' + id + '.desc'].length > 10, l + id + 'd');
    }
  }
  assert(hasRaceTag(reg, { race: 'dwarf' }, 'SÖTÉTLÁTÁS') && hasRaceTag(reg, { race: 'elf' }, 'ERDEIMOZGÁS') && hasRaceTag(reg, { race: 'orc' }, 'ERŐHÚZÁS'));
  assert(!hasRaceTag(reg, { race: 'elf' }, 'SÖTÉTLÁTÁS') && !hasRaceTag(reg, {}, 'SÖTÉTLÁTÁS') && !hasRaceTag(null, { race: 'elf' }, 'X'));
  eq(Object.keys(RACE_CONFIG.nodePassives).sort().join(), 'herb,stone,tree');
  const used = new Set(); for (const r of reg.races.values()) for (const x of r.passives) used.add(x.id);
  for (const id of ['darkvision', 'miner_speed', 'forest_move', 'herb_speed', 'pull_power', 'wood_speed']) assert(used.has(id), id);
});

test('race: applyRace – stat-módosítók a játékosra, ATOMI hiba, clearRace', () => {
  const reg = CREG(), p = createPlayer(0, 5, 6);
  assert(applyRace(reg, p, 'dwarf'));
  eq(p.race, 'dwarf'); near(p.strength, 1.1, 1e-9); near(p.weight, 1.2, 1e-9); near(p.speed, PLAYER_SPEED * 0.92, 1e-9);
  const o = mk(1, 'orc'); near(o.strength, 1.35 * 1.2, 1e-9, 'ork erő·(1+pull_power)');
  const before = JSON.stringify(p);
  for (const bad of [null, undefined, 5, '', 'nincs', '__proto__', 'constructor', {}]) { assert(!applyRace(reg, p, bad), String(bad)); eq(JSON.stringify(p), before); }
  for (const badReg of [null, {}, { races: 5 }, { races: {} }]) assert(!applyRace(badReg, p, 'dwarf'));
  for (const badP of [null, 5, 'x']) assert(!applyRace(reg, badP, 'dwarf'));
  assert(clearRace(p)); eq(p.race, undefined); eq(p.strength, 1); eq(p.weight, 1); eq(p.speed, PLAYER_SPEED); assert(!clearRace(null));
  eq(raceOf(reg, p), null); eq(raceOf(reg, mk(0, 'elf')).id, 'elf');
});

test('race: erő -> húzás (k-hook) és teher-kapacitás; súly -> a húzott társ nehézsége', () => {
  const reg = CREG(), D = mk(0, 'dwarf'), E = mk(0, 'elf'), O = mk(0, 'orc'), H = createPlayer(0, 0, 0);
  const pf = (a, b) => pullFactor(a, b, 1, false);
  assert(pf(O, H) > pf(D, H) && pf(D, H) > pf(H, H) && pf(H, H) > pf(E, H), 'ork > törpe > ember > tünde húzás');
  assert(pf(H, E) > pf(H, D) && pf(H, D) > pf(H, O), 'a tündét a legkönnyebb, az orkot a legnehezebb húzni');
  assert(capacityOf(O) > capacityOf(D) && capacityOf(D) > capacityOf(E), 'kapacitás az erővel nő');
  for (const a of [D, E, O]) for (const b of [D, E, O, H]) { const k = pf(a, b); assert(k >= 0 && k <= 4 && Number.isFinite(k)); }
  // rendszer-szinten: az ork húzza a tündét -> a pár közelebb kerül, mint ha a tünde húzná az orkot
  const run = (a, b) => {
    const A = createPlayer(0, 0, 0), B = createPlayer(1, 100, 0);
    applyRace(reg, A, a); applyRace(reg, B, b);
    const sys = createTetherSystem({ L: 100, k: 0.5 });
    for (let i = 0; i < 120; i++) stepTetherSystem(sys, [A, B], [{ x: -1, y: 0 }, { x: 0, y: 0 }], 1 / 60);
    return A.x;
  };
  assert(run('orc', 'elf') < run('elf', 'orc') - 1, 'az ork messzebbre húz');
});

test('race: passzívok – sötétlátás, gyűjtés-sebesség, hibás bemenet semleges', () => {
  const reg = CREG();
  eq(darkvisionTiles(reg, mk(0, 'dwarf')), 5); eq(darkvisionTiles(reg, mk(0, 'elf')), 0); eq(darkvisionTiles(reg, mk(0, 'orc')), 0); eq(darkvisionTiles(reg, null), 0); eq(darkvisionTiles(null, {}), 0);
  near(gatherSpeedMul(reg, mk(0, 'dwarf'), 'stone'), 1.2, 1e-9); eq(gatherSpeedMul(reg, mk(0, 'dwarf'), 'tree'), 1);
  near(gatherSpeedMul(reg, mk(0, 'elf'), 'herb'), 1.25, 1e-9); eq(gatherSpeedMul(reg, mk(0, 'elf'), 'stone'), 1);
  near(gatherSpeedMul(reg, mk(0, 'orc'), 'tree'), 1.15, 1e-9); eq(gatherSpeedMul(reg, mk(0, 'orc'), 'herb'), 1);
  for (const t of ['', 'ore', '__proto__', 'constructor', 'toString', 5, null, undefined]) eq(gatherSpeedMul(reg, mk(0, 'dwarf'), t), 1, String(t));
  eq(gatherSpeedMul(reg, createPlayer(0, 0, 0), 'stone'), 1); eq(gatherSpeedMul(null, null, 'stone'), 1);
  eq(passiveOf(null, 'x'), 0); eq(passiveOf({ passives: [null, { id: 'a', value: 'x' }] }, 'a', 7), 7); eq(passiveOf({ passives: 'x' }, 'a'), 0);
  const v = raceView(reg, mk(0, 'orc')); eq(v.id, 'orc'); eq(v.descKey, 'race.orc.desc'); eq(v.passives.length, 2); eq(raceView(reg, {}), null);
});

test('race: erdei mozgás – csak erdei terepen, csak a lassulásból, 0..1 közt; hibás terep-függvény nem dob', () => {
  const reg = CREG(), E = mk(0, 'elf'), D = mk(0, 'dwarf');
  near(terrainMulFor(reg, E, { mul: 0.5, kind: 'forest' }), 0.5 + 0.5 * 0.6, 1e-9); near(terrainMulFor(reg, E, { mul: 0.5, kind: 'undergrowth' }), 0.8, 1e-9);
  eq(terrainMulFor(reg, E, { mul: 0.5, kind: 'snow' }), 0.5); eq(terrainMulFor(reg, E, 0.5), 0.5); eq(terrainMulFor(reg, D, { mul: 0.5, kind: 'forest' }), 0.5);
  eq(terrainMulFor(reg, E, { mul: 1, kind: 'forest' }), 1); eq(terrainMulFor(reg, E, { mul: 1.5, kind: 'forest' }), 1.5); eq(terrainMulFor(reg, E, undefined), 1);
  for (const bad of [NaN, -3, 'x', null, {}, { mul: 'x' }, () => { throw new Error('boom'); }]) { const m = terrainMulFor(reg, E, bad); assert(Number.isFinite(m) && m >= 0, String(bad)); }
  const f = raceTerrain(reg, p => ({ mul: 0.4, kind: 'forest' })); near(f(E), 0.4 + 0.6 * 0.6, 1e-9); eq(f(D), 0.4); eq(raceTerrain(reg)(E), 1);
  // a póráz cfg.terrain-ként: a tünde erdőben gyorsabban húz, mint a törpe
  const pull = who => { const A = createPlayer(0, 0, 0), B = createPlayer(1, 100, 0); applyRace(reg, A, who); applyRace(reg, B, 'dwarf'); A.strength = 1; A.weight = 1; B.weight = 1;
    const sys = createTetherSystem({ L: 100, k: 0.5, terrain: raceTerrain(reg, () => ({ mul: 0.5, kind: 'forest' })) });
    for (let i = 0; i < 60; i++) stepTetherSystem(sys, [A, B], [{ x: -1, y: 0 }, { x: 0, y: 0 }], 1 / 60); return sys.k.a; };
  assert(pull('elf') > pull('dwarf'), 'erdei mozgás a k-ban');
});

test('race: smoke – 3 faj páronként, 900 kocka szkriptelt mozgással, nincs NaN, táv <= L, determinizmus', () => {
  const reg = CREG(), ids = ['dwarf', 'elf', 'orc'];
  const run = (a, b) => {
    const A = mk(0, a, 0, 0), B = mk(1, b, 60, 0), rnd = mulberry32(53);
    const sys = createTetherSystem({ L: 120, k: 0.5, terrain: raceTerrain(reg, () => ({ mul: 0.7, kind: 'forest' })) });
    let maxD = 0;
    for (let i = 0; i < 900; i++) {
      if (i % 30 === 0) { var ia = { x: Math.round(rnd() * 2 - 1), y: Math.round(rnd() * 2 - 1) }, ib = { x: Math.round(rnd() * 2 - 1), y: Math.round(rnd() * 2 - 1) }; }
      stepTetherSystem(sys, [A, B], [ia, ib], 1 / 60);
      for (const v of [A.x, A.y, B.x, B.y, A.vx, B.vx]) assert(Number.isFinite(v), a + b + i);
      maxD = Math.max(maxD, Math.abs(A.x - B.x), Math.abs(A.y - B.y));
    }
    assert(maxD <= 120 + 1, 'táv ' + maxD);
    return [A.x, A.y, B.x, B.y].map(v => v.toFixed(6)).join();
  };
  for (const a of ids) for (const b of ids) eq(run(a, b), run(a, b), a + b);
});
