// test-professions.js (S046) – szakma-korlát tesztek (nincs külső függőség a logikán kívül)
import { test, assert, eq } from './test-index.js';
import {
  PROFESSION_DEFS, PROFESSION_CONFIG, PROFESSION_TEXTS, NODE_SKILLS,
  sanitizeProfessionConfig, validateProfessionDef, createProfessionRegistry, createProfessionSystem,
  onProfession, professionsOf, hasProfession, freeSlots, chooseProfession, dropProfession, swapProfession,
  skillOpen, effectiveLevel, cappedSkills, recipeAccess, nodeSpeedMul, connectProfessions,
  professionView, professionState, restoreProfessions,
} from './game-professions.js';

const params = (s) => (String(s).match(/\{(\w+)\}/g) || []).sort().join();
const mk = (cfg) => createProfessionSystem({ cfg });
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('szakma: adat, regiszter, szövegek HU/EN', () => {
  const reg = createProfessionRegistry();
  eq(reg.errors.length, 0);
  eq(reg.professions.size, PROFESSION_DEFS.length);
  for (const d of PROFESSION_DEFS) {
    const pr = reg.professions.get(d.id);
    eq(pr.nameKey, 'prof.' + d.id);
    assert(PROFESSION_TEXTS.hu[d.id] && PROFESSION_TEXTS.en[d.id], 'név ' + d.id);
  }
  const hk = Object.keys(PROFESSION_TEXTS.hu).sort().join();
  eq(Object.keys(PROFESSION_TEXTS.en).sort().join(), hk);
  for (const k of Object.keys(PROFESSION_TEXTS.hu)) eq(params(PROFESSION_TEXTS.hu[k]), params(PROFESSION_TEXTS.en[k]));
  for (const s of Object.values(NODE_SKILLS)) assert(reg.bySkill.has(s), 'node-skill kapuzott: ' + s);
});

test('szakma: konfig szorítás, hibás bemenet', () => {
  eq(sanitizeProfessionConfig().max, 2);
  eq(sanitizeProfessionConfig(null).gateLevel, 10);
  const c = sanitizeProfessionConfig({ max: 99, gateLevel: -5, nodeGateTier: 'x', offSpeed: 7 });
  eq(c.max, 8); eq(c.gateLevel, 1); eq(c.nodeGateTier, PROFESSION_CONFIG.nodeGateTier); eq(c.offSpeed, 1);
  eq(sanitizeProfessionConfig({ max: NaN }).max, 2);
  assert(Object.isFrozen(c));
});

test('szakma: hibás def/duplikátum nem dob', () => {
  const reg = createProfessionRegistry([null, 5, { id: 'A', skill: 'x' }, { id: 'a', skill: 1 },
    { id: 'm', skill: 's' }, { id: 'm', skill: 't' }, { id: 'n', skill: 's' }, { id: 'ok', skill: 'o' }]);
  eq([...reg.professions.keys()].join(), 'm,ok');
  eq(reg.dups.join(), 'm');
  assert(reg.errors.length >= 5);
  eq(createProfessionRegistry('zz').professions.size, 0);
  assert(!validateProfessionDef({}).ok);
});

test('szakma: választás, max 2, tele, már van, hibás', () => {
  const ps = mk();
  eq(chooseProfession(ps, 0, 'mining').ok, true);
  eq(chooseProfession(ps, 0, 'mining').reason, 'have');
  eq(chooseProfession(ps, 0, 'woodcutting').ok, true);
  eq(freeSlots(ps, 0), 0);
  eq(chooseProfession(ps, 0, 'herbalism').reason, 'full');
  eq(chooseProfession(ps, 0, 'nincs').reason, 'profession');
  eq(chooseProfession(ps, 2, 'mining').reason, 'player');
  eq(chooseProfession(ps, '0', 'mining').reason, 'player');
  eq(chooseProfession(ps, 0, undefined).reason, 'profession');
  eq(professionsOf(ps, 0).join(), 'mining,woodcutting');
  eq(ps.stats.chosen, 2);
});

test('szakma: két játékos független', () => {
  const ps = mk();
  chooseProfession(ps, 0, 'mining');
  chooseProfession(ps, 1, 'mining');
  chooseProfession(ps, 1, 'herbalism');
  assert(hasProfession(ps, 0, 'mining') && !hasProfession(ps, 0, 'herbalism'));
  eq(freeSlots(ps, 0), 1); eq(freeSlots(ps, 1), 0);
  professionsOf(ps, 0).push('x');
  eq(professionsOf(ps, 0).length, 1);
  eq(professionsOf(ps, 5).length, 0);
});

test('szakma: elhagyás után újra választható', () => {
  const ps = mk();
  chooseProfession(ps, 0, 'mining'); chooseProfession(ps, 0, 'herbalism');
  eq(dropProfession(ps, 0, 'woodcutting').reason, 'none');
  eq(dropProfession(ps, 0, 'mining').ok, true);
  eq(freeSlots(ps, 0), 1);
  eq(chooseProfession(ps, 0, 'woodcutting').ok, true);
  eq(dropProfession(ps, 3, 'mining').reason, 'player');
});

test('szakma: csere – sorrend marad, atomi hibák', () => {
  const ps = mk();
  chooseProfession(ps, 0, 'mining'); chooseProfession(ps, 0, 'herbalism');
  eq(swapProfession(ps, 0, 'mining', 'herbalism').reason, 'have');
  eq(swapProfession(ps, 0, 'woodcutting', 'mining').reason, 'none');
  eq(swapProfession(ps, 0, 'mining', 'nincs').reason, 'profession');
  eq(professionsOf(ps, 0).join(), 'mining,herbalism');
  eq(swapProfession(ps, 0, 'mining', 'woodcutting').ok, true);
  eq(professionsOf(ps, 0).join(), 'woodcutting,herbalism');
  eq(swapProfession(ps, 9, 'a', 'b').reason, 'player');
  eq(ps.stats.swapped, 1);
});

test('szakma: effectiveLevel/cappedSkills – kapu a szint alatt', () => {
  const ps = mk();
  eq(effectiveLevel(ps, 0, 'mining', 25), 9);
  eq(effectiveLevel(ps, 0, 'crafting', 25), 25);
  eq(effectiveLevel(ps, 0, 'mining', 5), 5);
  eq(effectiveLevel(ps, 0, 'mining', NaN), 0);
  eq(effectiveLevel(ps, 0, 'crafting', 999), 60);
  const obj = { mining: 30, crafting: 12 };
  const f = cappedSkills(ps, 0, obj);
  eq(f('mining'), 9); eq(f('crafting'), 12); eq(f('herbalism'), 0); eq(f('toString'), 0);
  chooseProfession(ps, 0, 'mining');
  eq(f('mining'), 30);
  eq(cappedSkills(ps, 1, (id) => (id === 'mining' ? 20 : 0))('mining'), 9);
  eq(cappedSkills(ps, 0, () => { throw new Error('x'); })('mining'), 0);
  eq(cappedSkills(ps, 0, undefined)('mining'), 0);
});

test('szakma: recept-kapu', () => {
  const ps = mk();
  const high = { skill: { skill: 'mining', level: 10 } };
  const low = { skill: { skill: 'mining', level: 9 } };
  eq(recipeAccess(ps, 0, high).ok, false);
  eq(recipeAccess(ps, 0, high).reason, 'profession');
  eq(recipeAccess(ps, 0, low).ok, true);
  eq(recipeAccess(ps, 0, { skill: null }).ok, true);
  eq(recipeAccess(ps, 0, null).ok, true);
  eq(recipeAccess(ps, 0, { skill: { skill: 'crafting', level: 40 } }).ok, true);
  chooseProfession(ps, 0, 'mining');
  eq(recipeAccess(ps, 0, high).ok, true);
  eq(recipeAccess(ps, 1, high).ok, false);
});

test('szakma: node sebesség-szorzó (puha kapu)', () => {
  const ps = mk();
  eq(nodeSpeedMul(ps, 0, { type: 'stone', minTier: 0 }), 1);
  eq(nodeSpeedMul(ps, 0, { type: 'stone', minTier: 2 }), 0.5);
  eq(nodeSpeedMul(ps, 0, { type: 'ore', minTier: 5 }), 1);
  eq(nodeSpeedMul(ps, 0, { type: 'toString', minTier: 5 }), 1);
  eq(nodeSpeedMul(ps, 0, null), 1);
  eq(nodeSpeedMul(ps, 0, { type: 'tree' }), 1);
  chooseProfession(ps, 0, 'mining');
  eq(nodeSpeedMul(ps, 0, { type: 'stone', minTier: 2 }), 1);
  eq(nodeSpeedMul(ps, 0, { type: 'tree', minTier: 3 }), 0.5);
  eq(nodeSpeedMul(mk({ offSpeed: 0.25 }), 1, { type: 'herb', minTier: 2 }), 0.25);
});

test('szakma: események, figyelők, hibázó figyelő', () => {
  const ps = mk();
  const got = [];
  const off = onProfession(ps, (e) => got.push(e.type + ':' + e.player + ':' + e.id));
  onProfession(ps, () => { throw new Error('rossz'); });
  chooseProfession(ps, 1, 'herbalism');
  swapProfession(ps, 1, 'herbalism', 'mining');
  dropProfession(ps, 1, 'mining');
  eq(got.join(), 'choose:1:herbalism,swap:1:mining,drop:1:mining');
  assert(ps.lastError === 'rossz');
  off();
  chooseProfession(ps, 1, 'mining');
  eq(got.length, 3);
  for (let i = 0; i < 100; i++) { chooseProfession(ps, 0, 'mining'); dropProfession(ps, 0, 'mining'); }
  assert(ps.events.length <= 64);
  eq(onProfession(ps, null)(), undefined);
});

test('szakma: mentés-alak, visszaállítás atomi és tűrő', () => {
  const ps = mk();
  chooseProfession(ps, 0, 'mining'); chooseProfession(ps, 1, 'herbalism'); chooseProfession(ps, 1, 'woodcutting');
  const st = JSON.parse(JSON.stringify(professionState(ps)));
  const p2 = mk();
  eq(restoreProfessions(p2, st), true);
  eq(JSON.stringify(professionState(p2)), JSON.stringify(st));
  eq(p2.events.length, 0);
  for (const bad of [null, 1, {}, { v: 2, players: [[], []] }, { v: 1 }, { v: 1, players: [[]] }, { v: 1, players: [[], 5] }]) {
    eq(restoreProfessions(p2, bad), false);
  }
  eq(JSON.stringify(professionState(p2)), JSON.stringify(st));
  eq(restoreProfessions(p2, { v: 1, players: [['mining', 'mining', 'x', 'herbalism', 'woodcutting'], [7, null]] }), true);
  eq(professionsOf(p2, 0).join(), 'mining,herbalism');
  eq(professionsOf(p2, 1).length, 0);
});

test('szakma: nézet (UI-nak)', () => {
  const ps = mk();
  chooseProfession(ps, 0, 'mining');
  const v = professionView(ps, 0);
  eq(v.used, 1); eq(v.free, 1); eq(v.max, 2);
  eq(v.options.length, PROFESSION_DEFS.length);
  assert(v.options.find((o) => o.id === 'mining').owned);
  assert(v.options.find((o) => o.id === 'herbalism').canChoose);
  chooseProfession(ps, 0, 'herbalism');
  assert(!professionView(ps, 0).options.find((o) => o.id === 'woodcutting').canChoose);
  eq(professionView(ps, 4), null);
});

test('szakma: bekötés (craft ctx + node hook) és leválasztás', () => {
  const ps = mk();
  const players = [{ n: 'a' }, { n: 'b' }];
  const craftUi = { ctxOf: (i) => ({ stations: new Set(['x']), skills: { mining: 30, crafting: 5 } }) };
  const origCtx = craftUi.ctxOf;
  const nodes = { hooks: { speed: () => 2, power: () => 1 } };
  const origSpeed = nodes.hooks.speed;
  const off = connectProfessions(ps, { nodes, craftUi, players });
  const c = craftUi.ctxOf(0);
  eq(c.skills('mining'), 9); eq(c.skills('crafting'), 5); assert(c.stations.has('x'));
  eq(nodes.hooks.speed(players[0], { type: 'stone', minTier: 2 }, 'r'), 1);
  eq(nodes.hooks.speed(1, { type: 'stone', minTier: 0 }, 'r'), 2);
  eq(nodes.hooks.speed({ n: 'idegen' }, { type: 'stone', minTier: 2 }, 'r'), 2);
  chooseProfession(ps, 0, 'mining');
  eq(craftUi.ctxOf(0).skills('mining'), 30);
  eq(craftUi.ctxOf(1).skills('mining'), 9);
  eq(nodes.hooks.speed(players[0], { type: 'stone', minTier: 2 }, 'r'), 2);
  off();
  assert(craftUi.ctxOf === origCtx && nodes.hooks.speed === origSpeed);
  const empty = connectProfessions(ps, {});
  eq(typeof empty, 'function'); empty();
  const bad = { hooks: { speed: () => { throw new Error('x'); } } };
  connectProfessions(ps, { nodes: bad });
  eq(bad.hooks.speed(0, { type: 'stone', minTier: 2 }), 1);
});

function fuzz(seed) {
  const r = rng(seed);
  const ps = mk();
  const ids = ['mining', 'woodcutting', 'herbalism', 'nincs', null, undefined, 5, 'toString'];
  const pls = [0, 1, 0, 1, 2, -1, '0', null];
  const trace = [];
  for (let i = 0; i < 6000; i++) {
    const op = Math.floor(r() * 4);
    const p = pls[Math.floor(r() * pls.length)];
    const a = ids[Math.floor(r() * ids.length)];
    const b = ids[Math.floor(r() * ids.length)];
    let res;
    if (op === 0) res = chooseProfession(ps, p, a);
    else if (op === 1) res = dropProfession(ps, p, a);
    else if (op === 2) res = swapProfession(ps, p, a, b);
    else res = restoreProfessions(ps, r() < 0.5 ? professionState(ps) : { v: 1, players: [[a, b, a], [b]] });
    trace.push(res.ok === undefined ? res : res.reason || 'ok');
    for (const s of ps.sets) {
      assert(s.length <= ps.cfg.max, 'max túllépve');
      assert(new Set(s).size === s.length, 'duplikált');
      assert(s.every((id) => ps.reg.professions.has(id)), 'ismeretlen id');
    }
    assert(effectiveLevel(ps, 0, 'mining', 50) <= 50);
  }
  return trace.join() + JSON.stringify(professionState(ps));
}

test('szakma: 6000 műveletes fuzz – invariánsok + determinizmus', () => {
  const a = fuzz(46);
  eq(fuzz(46), a);
  assert(fuzz(47) !== a, 'más seed, más út');
});
