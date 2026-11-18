// S065 – M4 playteszt (automata): minden faj × kaszt kombináció végigvihető-e, és az akadályoknak van-e 2–3 megoldása.
// Valódi modulokkal, két szkriptelt játékossal; a felhasználó nem játszik (S185-ig csak feltölt).
import { test, assert, eq } from './test-index.js';
import { createPlayer, PLAYER_SPEED } from './game-player.js';
import { ITEM_DEFS } from './data-items.js';
import { RECIPE_DEFS } from './data-recipes.js';
import { NODE_DEFS } from './data-nodes.js';
import { ABILITY_DEFS, CLASS_DEFS, RACE_DEFS } from './data-character.js';
import { COMBO_DEFS } from './data-combos.js';
import { createCharacterRegistry, loadRegistry, auditRegistryTexts } from './game-registry.js';
import { applyCharacter, allCombos } from './game-charselect.js';
import { raceOf } from './game-race.js';
import { createAbilitySystem, castAbility, stepAbilities, slotAbilities, abilityView, poolValue, ensurePools } from './game-ability.js';
import { createPlayerInventories, addItem, hasItem, hasTag } from './game-inventory.js';
import { createRecipeRegistry, getRecipe, craft } from './game-crafting.js';
import { syncEncumbrance } from './game-encumbrance.js';
import { attachWizard, stepWizard, lightSources } from './game-wizard.js';
import { attachWarrior } from './game-warrior.js';
import { createObstacleSystem, stepObstacles, obstacleOpen, obstacleColliders, auditObstacles } from './game-obstacle.js';
import { OBSTACLE_PLANNED_TAGS } from './data-obstacles.js';
import { tagSources, classFreeSolutions, handObtainable } from './game-tools.js';
import { createComboRegistry, auditCombos } from './game-combo.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { mulberry32 } from './world-noise.js';

const DT = 1 / 60, THICKET = 'thorn_thicket', GATE = 'dark_gate', right = { x: 1, y: 0 };
const reg = createCharacterRegistry(), COMBOS = allCombos(reg);
const SRC = { items: ITEM_DEFS, recipes: RECIPE_DEFS, nodes: NODE_DEFS, abilities: ABILITY_DEFS, races: RACE_DEFS, classes: CLASS_DEFS };
const itemReg = createPlayerInventories()[0].reg, recipes = createRecipeRegistry(undefined, itemReg);
const label = c => c.race + '/' + c.cls;

// Egy játékos felépítése a választó ugyanazon útján (applyCharacter) + inventory + képesség-rendszer + kaszt-kezelők.
function rig(ca, cb, anchorGate = true) {
  const players = [createPlayer(0, anchorGate ? -250 : 300, anchorGate ? -48 : 0), createPlayer(1, 900, 900)];
  assert(applyCharacter(reg, players[0], ca.race, ca.cls), 'ráállítás ' + label(ca));
  assert(applyCharacter(reg, players[1], cb.race, cb.cls), 'ráállítás ' + label(cb));
  const os = createObstacleSystem(), sys = createAbilitySystem({ reg }), invs = createPlayerInventories();
  const wz = attachWizard(sys, { players, flammables: os.flammables });
  attachWarrior(sys, { players, breakables: os.breakables });
  const tagsOf = i => (raceOf(reg, players[i]) || {}).tags || [];
  return { players, os, sys, invs, wz, tagsOf, ctx: { players, inventories: invs, tagsOf, lights: () => lightSources(wz) } };
}
const tick = (r, n = 1, extra = {}) => { const ev = []; for (let k = 0; k < n; k++) { stepWizard(r.wz, DT); stepAbilities(r.sys, r.players, [{}, {}], [right, right], DT); ev.push(...stepObstacles(r.os, DT, { ...r.ctx, ...extra })); } return ev; };
const cleared = (r, id) => obstacleOpen(r.os, id);
// A kaszt-gombok közül az, amelyik ilyen TAG-et ad (kaszt-képesség a 2 gombon vagy a teljes listán).
const classAbilityWithTag = (cls, tag) => reg.classes.get(cls).abilities.find(id => (reg.abilities.get(id).tags || []).includes(tag)) || null;
const refill = (p) => { p.mana = p.manaMax; p.focus = p.focusMax; p.stamina = p.staminaMax || 100; p.exhausted = false; };

test('M4 playteszt: adat – 3 faj × 4 kaszt = 12 kombináció, az élő regiszter hibátlan, minden szöveg HU/EN, az audit tiszta', () => {
  eq(reg.races.size, 3); eq(reg.classes.size, 4); eq(COMBOS.length, 12);
  const lr = loadRegistry(); assert(lr.ok, 'loadRegistry: ' + JSON.stringify(lr.errors.concat(lr.problems)));
  eq(auditRegistryTexts(lr.character).join(), '', 'hiányzó faj/kaszt/képesség szöveg');
  eq(auditObstacles(createObstacleSystem(), SRC).join(), '', 'akadály-audit');
  for (const c of reg.classes.values()) assert(c.abilities.length >= 2 && c.abilities.every(id => reg.abilities.has(id)), 'kaszt: ' + c.id);
});

test('M4 playteszt: mind a 12 kombináció gombjai működnek – két képesség-gomb, az erőforrás elég a költséghez, teli készletből nincs "resource/cooldown/item" hiba', () => {
  for (const c of COMBOS) {
    const p = createPlayer(0, 0, 0), q = createPlayer(1, 40, 0); applyCharacter(reg, p, c.race, c.cls); applyCharacter(reg, q, 'elf', 'healer');
    const sys = createAbilitySystem({ reg }), players = [p, q], inv = createPlayerInventories(); ensurePools(sys, p); ensurePools(sys, q);
    const [a, b] = slotAbilities(sys, 0, p); assert(a && b && a !== b, 'két gomb ' + label(c));
    for (const id of [a, b]) {
      const def = reg.abilities.get(id), pool = def.resource ? poolValue(p, def.resource) : { max: Infinity };
      assert(def.cost <= pool.max, `${label(c)}: ${id} költsége (${def.cost}) belefér a készletbe (${pool.max})`);
      const r = castAbility(sys, players, 0, id, { facing: right, inventories: inv });
      assert(r.ok || r.reason === 'blocked' || r.reason === 'target', `${label(c)}/${id}: váratlan elutasítás: ${r.reason}`);
      refill(p); stepAbilities(sys, players, [{}, {}], [right, right], 20);
    }
    const v = abilityView(sys, players, 0); eq(v.slots.length, 2); assert(v.slots.every(s => s.id && s.affordable !== undefined), 'nézet ' + label(c));
  }
});

test('M4 playteszt: végigvihető – minden faj × kaszt × (a társ bármelyik kombinációja) = 144 pár: kézzel gyűjtött alapanyagból fáklya + fejsze, a két példa-akadály kinyílik', () => {
  const torch = getRecipe(recipes, 'torch'), axe = getRecipe(recipes, 'axe');
  assert(torch && axe && torch.station === null && axe.station === null, 'kézi receptek');
  let pairs = 0;
  for (const ca of COMBOS) for (const cb of COMBOS) {
    const r = rig(ca, cb);
    for (const i of [0, 1]) { addItem(r.invs[i], 'wood', 8); addItem(r.invs[i], 'fiber', 8); addItem(r.invs[i], 'stone', 4); }
    // P1 fáklyát, P2 fejszét craftol (a két játékos kiegészíti egymást; bármelyik fajjal/kaszttal ugyanúgy megy)
    assert(craft(r.invs[0], torch, {}).ok, 'fáklya ' + label(ca)); assert(craft(r.invs[1], axe, {}).ok, 'fejsze ' + label(cb));
    assert(hasItem(r.invs[0], 'torch', 1) && hasItem(r.invs[1], 'axe', 1), 'a tárgyak megvannak');
    syncEncumbrance(r.players, r.invs); for (const p of r.players) assert(p.speedMul >= 0.4 && p.speedMul <= 1 && Number.isFinite(p.speedMul), 'teher ' + label(ca));
    // sötét átjáró: a fáklyás P1 (vagy a faj/kaszt maga) a közelben nyitja
    tick(r, 2); assert(cleared(r, GATE), `sötét átjáró nyitva (${label(ca)}+${label(cb)})`);
    // elzárt út: a fejszés P2 tartott gombbal kivágja (a P2 a bozót mellett áll)
    r.players[1].x = 330; r.players[1].y = 0;
    const tg = { kind: 'obstacle', ref: r.os.items.get(THICKET), action: 'clear' };
    const ev = tick(r, 140, { inputs: [{}, { interact: true }], targets: [null, tg] });
    assert(ev.some(e => e.type === 'cleared' && e.id === THICKET), `bozót kivágva (${label(ca)}+${label(cb)})`);
    assert(!obstacleColliders(r.os).some(c => c.x === r.os.items.get(THICKET).x), 'a bozót ütközője kikerült');
    pairs++;
  }
  eq(pairs, 144);
});

test('M4 playteszt: az akadályoknak 2–3 megoldása van – minden megoldás-tagnek valódi forrása (tárgy/képesség/faj), legalább egy kasztfüggetlen (kézi) út', () => {
  const os = createObstacleSystem(), free = classFreeSolutions(os, SRC), hand = handObtainable(SRC);
  assert(hand.has('axe') && hand.has('torch'), 'a fejsze és a fáklya kézzel beszerezhető');
  for (const o of os.items.values()) {
    const real = o.solves.filter(t => !OBSTACLE_PLANNED_TAGS.includes(t));
    assert(real.length >= 2 && real.length <= 4, `${o.id}: 2–4 valódi megoldás, van ${real.length}: ${real}`);
    for (const t of real) assert(tagSources(SRC, t).length >= 1, `${o.id}: a(z) ${t} forrás nélküli`);
    assert(free[o.id].length >= 1, `${o.id}: nincs kasztfüggetlen (kézi) megoldás`);
    const kinds = new Set(real.flatMap(t => tagSources(SRC, t).map(s => s.kind)));
    assert(kinds.size >= 2, `${o.id}: legalább két FÉLE forrás (tárgy/képesség/faj): ${[...kinds]}`);
  }
  eq(os.items.get(THICKET).solves.filter(t => !OBSTACLE_PLANNED_TAGS.includes(t)).join(), 'ÉGETÉS,FEJSZE,TÖRÉS');
  eq(os.items.get(GATE).solves.join(), 'FÉNY,FÁKLYA,SÖTÉTLÁTÁS');
});

test('M4 playteszt: minden kombinációnál MINDEN szóba jövő megoldás-út élesben is működik (ÉGETÉS/TÖRÉS/FEJSZE a bozótra, FÉNY/FÁKLYA/SÖTÉTLÁTÁS az átjáróra)', () => {
  const stats = { ÉGETÉS: 0, TÖRÉS: 0, FEJSZE: 0, FÉNY: 0, FÁKLYA: 0, SÖTÉTLÁTÁS: 0 };
  for (const c of COMBOS) {
    const peer = { race: 'orc', cls: 'healer' };
    // --- bozót: ÉGETÉS (varázsló ignite)
    if (classAbilityWithTag(c.cls, 'ÉGETÉS')) {
      const r = rig(c, peer, false); r.os.items.get(THICKET); refill(r.players[0]);
      assert(castAbility(r.sys, r.players, 0, classAbilityWithTag(c.cls, 'ÉGETÉS'), { facing: right }).ok, 'ignite ' + label(c));
      const ev = tick(r, 200); assert(ev.some(e => e.type === 'cleared' && e.via === 'ÉGETÉS') && cleared(r, THICKET), 'égetés ' + label(c)); stats.ÉGETÉS++;
    }
    // --- bozót: TÖRÉS (harcos wallbreak; a gyengébb faj több csapásból)
    if (classAbilityWithTag(c.cls, 'TÖRÉS')) {
      const r = rig(c, peer, false); let done = false;
      for (let k = 0; k < 6 && !done; k++) { refill(r.players[0]); castAbility(r.sys, r.players, 0, classAbilityWithTag(c.cls, 'TÖRÉS'), { facing: right }); done = tick(r, 200).some(e => e.type === 'cleared' && e.via === 'TÖRÉS'); }
      assert(done && cleared(r, THICKET), 'törés ' + label(c)); stats.TÖRÉS++;
    }
    // --- bozót: FEJSZE (mindenkinek)
    { const r = rig(c, peer, false); addItem(r.invs[0], 'axe', 1);
      const tg = { kind: 'obstacle', ref: r.os.items.get(THICKET), action: 'clear' };
      assert(tick(r, 140, { inputs: [{ interact: true }, {}], targets: [tg, null] }).some(e => e.via === 'FEJSZE'), 'fejsze ' + label(c)); stats.FEJSZE++; }
    // --- átjáró: FÉNY (varázsló light)
    if (classAbilityWithTag(c.cls, 'FÉNY')) {
      const r = rig(c, peer); refill(r.players[0]);
      assert(castAbility(r.sys, r.players, 0, classAbilityWithTag(c.cls, 'FÉNY'), {}).ok, 'light ' + label(c));
      assert(tick(r, 2).some(e => e.type === 'opened' && e.by === 'FÉNY'), 'fény ' + label(c)); stats.FÉNY++;
    }
    // --- átjáró: FÁKLYA (mindenkinek)
    { const r = rig(c, peer); addItem(r.invs[0], 'torch', 1); assert(tick(r, 2).some(e => e.type === 'opened'), 'fáklya ' + label(c)); stats.FÁKLYA++; }
    // --- átjáró: SÖTÉTLÁTÁS (törpe)
    if (reg.races.get(c.race).tags.includes('SÖTÉTLÁTÁS')) {
      const r = rig(c, peer); assert(tick(r, 2).some(e => e.by === 'SÖTÉTLÁTÁS'), 'sötétlátás ' + label(c)); stats.SÖTÉTLÁTÁS++;
    } else { const r = rig(c, peer); tick(r, 5); assert(!cleared(r, GATE), `${label(c)}: nincs fény/fáklya/sötétlátás -> zárva marad`); }
  }
  // lefedettség: 12 kombinációból 3 törpe, 3 varázsló, 3 harcos; a fejszét/fáklyát mind a 12
  eq(stats.FEJSZE, 12); eq(stats.FÁKLYA, 12); eq(stats.SÖTÉTLÁTÁS, 4); eq(stats.ÉGETÉS, 3); eq(stats.FÉNY, 3); eq(stats.TÖRÉS, 3);
});

test('M4 playteszt: a kaszt kényelem, nem kapu – a "csupasz" kaszt (gyógyító/vadőr elf) kizárólag craftolt szerszámokkal mindkét akadályon átjut, két harcos vagy két varázsló is végigviszi', () => {
  const torch = getRecipe(recipes, 'torch'), axe = getRecipe(recipes, 'axe');
  for (const [a, b] of [[{ race: 'elf', cls: 'healer' }, { race: 'elf', cls: 'ranger' }], [{ race: 'orc', cls: 'warrior' }, { race: 'orc', cls: 'warrior' }], [{ race: 'dwarf', cls: 'wizard' }, { race: 'elf', cls: 'wizard' }]]) {
    const r = rig(a, b); addItem(r.invs[0], 'wood', 10); addItem(r.invs[0], 'fiber', 10); addItem(r.invs[0], 'stone', 5);
    assert(craft(r.invs[0], torch, {}).ok && craft(r.invs[0], axe, {}).ok, 'craft');
    tick(r, 2); assert(cleared(r, GATE), 'átjáró ' + label(a) + '+' + label(b));
    r.players[0].x = 330; r.players[0].y = 0;
    const tg = { kind: 'obstacle', ref: r.os.items.get(THICKET), action: 'clear' };
    assert(tick(r, 140, { inputs: [{ interact: true }, {}], targets: [tg, null] }).some(e => e.via === 'FEJSZE'), 'bozót ' + label(a) + '+' + label(b));
  }
});

test('M4 playteszt: póráz + faj – minden faj-pár húzása (3 × 3) k 0..1, a távolság <= L_eff, nincs NaN; az ork erősebben húzza a tündét, mint fordítva', () => {
  const kOf = (race, other) => {
    const A = createPlayer(0, 100, 200), B = createPlayer(1, 140, 200); applyCharacter(reg, A, race, 'warrior'); applyCharacter(reg, B, other, 'healer');
    const sys = createTetherSystem({ walls: [], L: { x: 200, y: 200 }, k: 0.5 }); let kmax = 0;
    for (let f = 0; f < 300; f++) {
      stepTetherSystem(sys, [A, B], [{ x: 1, y: 0 }, { x: 0, y: 0 }], DT);
      for (const v of [A.x, A.y, B.x, B.y, sys.k.a, sys.k.b]) assert(Number.isFinite(v), 'NaN ' + race + '/' + other);
      assert(Math.abs(B.x - A.x) <= 200 + 1e-6 + Math.abs(A.vx || 0) * DT * 2, `táv ${race}->${other}: ${B.x - A.x}`); kmax = Math.max(kmax, sys.k.a);
    }
    assert(kmax >= 0 && kmax <= 1, 'k'); return sys.k.a;
  };
  const m = {}; for (const a of ['dwarf', 'elf', 'orc']) for (const b of ['dwarf', 'elf', 'orc']) m[a + '>' + b] = kOf(a, b);
  assert(m['orc>elf'] > m['elf>orc'], `ork húz tündét (${m['orc>elf']}) > tünde húz orkot (${m['elf>orc']})`);
});

test('M4 playteszt: kombó-adat – a két példa-reakció érvényes, minden elemhez van képesség-forrás (tűz: varázsló, szél: vadőr, fagy: varázsló)', () => {
  const cr = createComboRegistry(COMBO_DEFS); eq(cr.errors.filter(e => !/:ok$/.test(e)).length, 0); eq(cr.reactions.size, 2);
  eq(auditCombos(cr, ABILITY_DEFS).join(), '');
  assert(classAbilityWithTag('wizard', 'ÉGETÉS') && classAbilityWithTag('ranger', 'SZÉL') && classAbilityWithTag('wizard', 'FAGYASZTÁS'), 'elem-források');
});

test('M4 playteszt: smoke – 12 kombináció × 900 kocka két szkriptelt játékossal (mozgás, gombok, póráz, akadályok): nincs NaN/kivétel, készletek 0..max, kétszeri futás azonos', () => {
  const run = (seed) => {
    const rnd = mulberry32(seed), out = [];
    COMBOS.forEach((ca, n) => {
      const cb = COMBOS[(n * 5 + 3) % COMBOS.length], r = rig(ca, cb, false); r.players[1].x = 340; r.players[1].y = 40;
      const tether = createTetherSystem({ walls: [], L: { x: 400, y: 300 }, k: 0.5 }); addItem(r.invs[0], 'axe', 1); addItem(r.invs[1], 'torch', 1);
      for (let f = 0; f < 900; f++) {
        const inp = [0, 1].map(() => ({ x: rnd() < 0.2 ? Math.round(rnd() * 2 - 1) : 0, y: rnd() < 0.2 ? Math.round(rnd() * 2 - 1) : 0, ability1Pressed: rnd() < 0.03, ability2Pressed: rnd() < 0.03, interact: rnd() < 0.5 }));
        const fac = inp.map(i => ({ x: i.x || 1, y: i.y }));
        stepTetherSystem(tether, r.players, inp, DT); stepWizard(r.wz, DT);
        stepAbilities(r.sys, r.players, inp, fac, DT, { inventories: r.invs, facing: fac });
        stepObstacles(r.os, DT, { ...r.ctx, inputs: inp, targets: [null, null] }); syncEncumbrance(r.players, r.invs);
        for (const p of r.players) { for (const v of [p.x, p.y, p.vx, p.vy]) assert(Number.isFinite(v), 'NaN ' + label(ca)); for (const res of ['mana', 'focus', 'stamina']) { const pv = poolValue(p, res); assert(pv.value >= -1e-9 && pv.value <= pv.max + 1e-9, `${res} ${pv.value}/${pv.max}`); } }
        assert(Math.abs(r.players[0].x - r.players[1].x) <= 400 + 8 && Math.abs(r.players[0].y - r.players[1].y) <= 300 + 8, 'póráz-táv');
      }
      out.push([label(ca), label(cb), Math.round(r.players[0].x), Math.round(r.players[1].x), r.os.cleared.size, obstacleOpen(r.os, GATE)]);
    });
    return JSON.stringify(out);
  };
  const a = run(65), b = run(65); eq(a, b, 'determinisztikus'); assert(a !== run(66), 'a szkript valóban számít');
});
