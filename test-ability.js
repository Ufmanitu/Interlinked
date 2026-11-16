// S054 tesztek: képesség-végrehajtó (erőforrás, cooldown, cél-típusok, 2 gomb, atomi hibák, determinizmus).
import { test, assert, eq, near } from './test-index.js';
import { createPlayer } from './game-player.js';
import { createCharacterRegistry } from './game-registry.js';
import { createPlayerInventories, addItem } from './game-inventory.js';
import { mulberry32 } from './world-noise.js';
import {
  ABILITY_CONFIG, sanitizeAbilityConfig, createAbilitySystem, ensurePools, poolValue, slotAbilities, setAbilitySlots, setAbilityHandler, onAbility,
  resolveTarget, castAbility, castSlot, stepAbilities, abilityView,
} from './game-ability.js';

const ABILITIES = [
  { id: 'bolt', resource: 'mana', cost: 30, cooldown: 2, target: 'enemy', range: 6, power: 12, tags: ['ÉGETÉS'] },
  { id: 'glow', resource: 'mana', cost: 10, cooldown: 0, target: 'self', tags: ['FÉNY'] },
  { id: 'smash', resource: 'stamina', cost: 40, cooldown: 1, target: 'direction', range: 2, power: 8, tags: ['ROBBANTÁS'] },
  { id: 'heal', resource: 'focus', cost: 25, cooldown: 3, target: 'ally', range: 4, power: 15 },
  { id: 'nova', resource: 'mana', cost: 20, cooldown: 4, target: 'area', range: 3, power: 5 },
  { id: 'cut', resource: null, cost: 0, cooldown: 1, target: 'none', item: 'axe' },
];
const CLASSES = [{ id: 'mage', resource: 'mana', abilities: ['bolt', 'glow', 'nova'] }, { id: 'warrior', resource: 'stamina', abilities: ['smash', 'cut'] }];
const mkReg = () => createCharacterRegistry({ races: [], classes: CLASSES, abilities: ABILITIES });
const mk = (opts = {}) => {
  const reg = mkReg();
  const sys = createAbilitySystem({ reg, ...opts });
  const players = [createPlayer(0, 100, 100), createPlayer(1, 160, 100)];
  players[0].class = 'mage'; players[1].class = 'warrior';
  return { reg, sys, players };
};
const idle = { x: 0, y: 0 };

test('ability: konfig szorítás és alapértékek', () => {
  const c = sanitizeAbilityConfig({ gcd: -5, tile: 'x', pools: { mana: { max: 0, regen: 1e9 } }, maxEvents: 5000 });
  eq(c.gcd, 0); eq(c.tile, ABILITY_CONFIG.tile); eq(c.pools.mana.max, 1); eq(c.pools.mana.regen, 1e4); eq(c.maxEvents, 1024); eq(c.pools.focus.max, ABILITY_CONFIG.pools.focus.max);
  eq(sanitizeAbilityConfig(null).gcd, ABILITY_CONFIG.gcd);
});

test('ability: erőforrás-készletek (hiányzó/hibás -> teli, szorítás; stamina közös)', () => {
  const { sys, players } = mk();
  const p = players[0]; p.mana = NaN; p.focus = 9999; p.focusMax = 50; p.stamina = 30;
  ok(ensurePools(sys, p));
  eq(p.mana, p.manaMax); eq(p.focus, 50); eq(p.stamina, 30);
  eq(poolValue(p, 'stamina').value, 30); near(poolValue(p, 'focus').ratio, 1);
  eq(ensurePools(sys, null), false); eq(poolValue(null, 'mana').max, 0);
});
function ok(v) { assert(v, 'várt igaz'); }

test('ability: slotok = a kaszt első két képessége; felülírás; kaszt nélkül üres', () => {
  const { sys, players } = mk();
  eq(slotAbilities(sys, 0, players[0]).join(), 'bolt,glow'); eq(slotAbilities(sys, 1, players[1]).join(), 'smash,cut');
  eq(slotAbilities(sys, 0, createPlayer(0, 0, 0)).join(), ','); eq(slotAbilities(sys, 5, players[0]).join(), ',');
  setAbilitySlots(sys, 0, ['nova', 'heal', 'x']); eq(slotAbilities(sys, 0, players[0]).join(), 'nova,heal');
  setAbilitySlots(sys, 0, null); eq(slotAbilities(sys, 0, players[0]).join(), 'bolt,glow');
});

test('ability: mana-képesség: költség, cooldown, esemény; hiba esetén atomi', () => {
  const { sys, players } = mk({ hooks: { enemies: () => [{ x: 130, y: 100 }] } });
  const evs = []; onAbility(sys, e => evs.push(e));
  const r = castAbility(sys, players, 0, 'bolt');
  ok(r.ok); eq(players[0].mana, players[0].manaMax - 30); eq(sys.players[0].cd.get('bolt'), 2);
  eq(evs.length, 1); eq(evs[0].type, 'cast'); eq(evs[0].resource, 'mana'); eq(evs[0].power, 12); eq(evs[0].tags[0], 'ÉGETÉS'); eq(evs[0].target.kind, 'enemy');
  // GCD
  eq(castAbility(sys, players, 0, 'glow').reason, 'busy');
  stepAbilities(sys, players, [idle, idle], [], 0.3);
  eq(castAbility(sys, players, 0, 'bolt').reason, 'cooldown');
  // erőforrás hiány: semmi nem változik
  players[0].mana = 5; const cdBefore = sys.players[0].cd.size;
  const f = castAbility(sys, players, 0, 'glow');
  eq(f.reason, 'resource'); eq(players[0].mana, 5); eq(sys.players[0].cd.size, cdBefore); eq(sys.stats.casts, 1);
  eq(evs[evs.length - 1].type, 'fail');
});

test('ability: cooldown lejár a lépésekkel; GCD; az idő nem negatív', () => {
  const { sys, players } = mk({ hooks: { enemies: () => [{ x: 120, y: 100 }] } });
  castAbility(sys, players, 0, 'bolt');
  for (let i = 0; i < 125; i++) stepAbilities(sys, players, [idle, idle], [], 1 / 60); // > 2 mp
  eq(sys.players[0].cd.has('bolt'), false); eq(sys.players[0].gcd, 0);
  players[0].mana = 100;
  ok(castAbility(sys, players, 0, 'bolt').ok);
  stepAbilities(sys, players, [idle, idle], [], -1); stepAbilities(sys, players, [idle, idle], [], NaN);
  near(sys.players[0].cd.get('bolt'), 2);
});

test('ability: mana/focus regeneráció késleltetéssel és plafonnal; a stamina-t nem érinti', () => {
  const { sys, players } = mk({ hooks: { enemies: () => [{ x: 120, y: 100 }] } });
  castAbility(sys, players, 0, 'bolt'); const after = players[0].mana;
  stepAbilities(sys, players, [idle, idle], [], 1.0); near(players[0].mana, after); // delay 1,5 mp
  stepAbilities(sys, players, [idle, idle], [], 1.0); // 0,5 mp regen · 4/mp
  near(players[0].mana, after + 2, 1e-6);
  for (let i = 0; i < 200; i++) stepAbilities(sys, players, [idle, idle], [], 1);
  eq(players[0].mana, players[0].manaMax);
  players[1].stamina = 10; stepAbilities(sys, players, [idle, idle], [], 5); eq(players[1].stamina, 10);
});

test('ability: stamina-képesség a közös p.stamina-t használja; kimerülten tiltott; 0-ra érve kimerül', () => {
  const { sys, players } = mk();
  const p = players[1]; p.stamina = 100; p.staminaMax = 100;
  ok(castAbility(sys, players, 1, 'smash').ok); eq(p.stamina, 60); eq(p.exhausted, false);
  stepAbilities(sys, players, [idle, idle], [], 1.1);
  p.stamina = 40; ok(castAbility(sys, players, 1, 'smash').ok); eq(p.stamina, 0); eq(p.exhausted, true);
  stepAbilities(sys, players, [idle, idle], [], 1.1);
  eq(castAbility(sys, players, 1, 'smash').reason, 'exhausted');
  const v = abilityView(sys, players, 1); eq(v.slots[0].affordable, false); eq(v.pools.stamina.value, 0);
});

test('ability: tárgy-feltétel (nem fogy el): kell inventory és tárgy', () => {
  const { sys, players } = mk(); const inv = createPlayerInventories();
  eq(castAbility(sys, players, 1, 'cut').reason, 'item'); // nincs ctx
  eq(castAbility(sys, players, 1, 'cut', { inventories: inv }).reason, 'item');
  addItem(inv[1], 'axe', 1);
  ok(castAbility(sys, players, 1, 'cut', { inventories: inv }).ok);
  stepAbilities(sys, players, [idle, idle], [], 2);
  ok(castAbility(sys, players, 1, 'cut', { inventories: inv }).ok); // a tárgy megvan, nem fogyott
  stepAbilities(sys, players, [idle, idle], [], 2);
  eq(castAbility(sys, players, 1, 'cut', { inventories: [null, null] }).reason, 'item');
});

test('ability: cél-típusok – self, ally (táv), enemy (legközelebbi, táv), area (találatok), direction (facing)', () => {
  const enemies = [{ x: 190, y: 100, id: 'far' }, { x: 120, y: 100, id: 'near' }, { x: 500, y: 100, id: 'out' }, { x: NaN, y: 0 }];
  const { sys, players } = mk({ hooks: { enemies: (o, r) => enemies } });
  const def = id => sys.reg.abilities.get(id);
  eq(resolveTarget(sys, def('glow'), players, 0).kind, 'self');
  eq(resolveTarget(sys, def('cut'), players, 1).kind, 'none');
  const al = resolveTarget(sys, def('heal'), players, 0); eq(al.kind, 'ally'); eq(al.player, 1);
  players[1].x = 100 + 4 * 32 + 1; eq(resolveTarget(sys, def('heal'), players, 0), null); players[1].x = 160;
  const en = resolveTarget(sys, def('bolt'), players, 0); eq(en.ref.id, 'near'); near(en.dist, 20);
  const ar = resolveTarget(sys, def('nova'), players, 0); eq(ar.kind, 'area'); eq(ar.hits.length, 2); near(ar.r, 96);
  const di = resolveTarget(sys, def('smash'), players, 0, { x: 3, y: 0 }); near(di.dx, 1); near(di.dy, 0); near(di.ex, 164);
  near(resolveTarget(sys, def('smash'), players, 0, null).dy, 1); // alap irány: le
  const none = createAbilitySystem({ reg: sys.reg }); eq(resolveTarget(none, def('bolt'), players, 0), null); eq(resolveTarget(none, def('nova'), players, 0).hits.length, 0);
  const bad = createAbilitySystem({ reg: sys.reg, hooks: { enemies: () => { throw new Error('x'); } } }); eq(resolveTarget(bad, def('bolt'), players, 0), null); ok(bad.lastError);
});

test('ability: nincs érvényes cél -> nincs költség; az area üres találattal is elsül', () => {
  const { sys, players } = mk();
  eq(castAbility(sys, players, 0, 'bolt').reason, 'target'); eq(players[0].mana, players[0].manaMax); eq(sys.players[0].cd.size, 0);
  ok(castAbility(sys, players, 0, 'nova').ok); eq(players[0].mana, players[0].manaMax - 20);
});

test('ability: kezelő – vétó nem költ, hiba nem költ, elfogadás hatást alkalmaz', () => {
  const { sys, players } = mk();
  let seen = null; setAbilityHandler(sys, 'glow', ev => { seen = ev; return false; });
  eq(castAbility(sys, players, 0, 'glow').reason, 'blocked'); eq(players[0].mana, players[0].manaMax); eq(sys.stats.casts, 0); eq(seen.ability, 'glow');
  setAbilityHandler(sys, 'glow', () => { throw new Error('boom'); });
  eq(castAbility(sys, players, 0, 'glow').reason, 'error'); eq(players[0].mana, players[0].manaMax); ok(sys.lastError);
  let hit = 0; setAbilityHandler(sys, 'glow', () => { hit++; });
  ok(castAbility(sys, players, 0, 'glow').ok); eq(hit, 1); eq(players[0].mana, players[0].manaMax - 10);
  setAbilityHandler(sys, 'glow', null); stepAbilities(sys, players, [idle, idle], [], 1); ok(castAbility(sys, players, 0, 'glow').ok); eq(hit, 1);
});

test('ability: ismeretlen/hibás bemenet nem dob és nem változtat', () => {
  const { sys, players } = mk();
  eq(castAbility(sys, players, 0, 'nincs').reason, 'ability'); eq(castAbility(sys, players, 0, null).reason, 'empty');
  eq(castAbility(sys, players, 7, 'glow').reason, 'player'); eq(castAbility(sys, [], 0, 'glow').reason, 'player');
  eq(castAbility(null, players, 0, 'glow').reason, 'error'); eq(castSlot(sys, players, 0, 9).reason, 'empty');
  eq(castAbility(createAbilitySystem(), players, 0, 'glow').reason, 'ability');
  eq(players[0].mana === undefined || players[0].mana === players[0].manaMax, true);
  eq(stepAbilities(null, players, [], [], 1).length, 0); eq(abilityView(null, players, 0).slots.length, 0);
});

test('ability: a 2 gomb – él-vezérelt (tartás nem ismétel), két slot, szűrt bemenet nem sül', () => {
  const { sys, players } = mk({ hooks: { enemies: () => [{ x: 120, y: 100 }] } });
  const evs = []; onAbility(sys, e => evs.push(e));
  const held = { ability1: true };
  let r = stepAbilities(sys, players, [held, idle], [{ x: 1, y: 0 }, { x: 1, y: 0 }], 1 / 60);
  eq(r.length, 1); eq(r[0].ability, 'bolt'); eq(r[0].slot, 0);
  for (let i = 0; i < 30; i++) stepAbilities(sys, players, [held, idle], [], 1 / 60);
  eq(evs.filter(e => e.type === 'cast').length, 1); eq(evs.length, 1);
  stepAbilities(sys, players, [idle, idle], [], 1 / 60); // elengedés
  r = stepAbilities(sys, players, [{ ability2Pressed: true }, { ability1: true }], [{ x: 0, y: 1 }, { x: 0, y: -1 }], 1 / 60);
  eq(r.map(e => e.ability).sort().join(), 'glow,smash'); // P1 2. slot (glow), P2 1. slot (smash)
  eq(r.find(e => e.ability === 'smash').target.dy, -1);
  const before = sys.stats.casts + sys.stats.fails;
  stepAbilities(sys, players, [{ ability1: false, ability2: false }, null], [], 1 / 60);
  eq(sys.stats.casts + sys.stats.fails, before);
  const none = createAbilitySystem({ reg: sys.reg }); const e0 = stepAbilities(none, [createPlayer(0, 0, 0), createPlayer(1, 9, 0)], [{ ability1: true }, idle], [], 1 / 60);
  eq(e0.length, 1); eq(e0[0].reason, 'empty');
});

test('ability: figyelők – a hibázó nem állítja meg a többit; leválasztás', () => {
  const { sys, players } = mk(); let n = 0;
  onAbility(sys, () => { throw new Error('x'); }); const off = onAbility(sys, () => n++);
  ok(castAbility(sys, players, 0, 'glow').ok); eq(n, 1); ok(sys.lastError);
  off(); stepAbilities(sys, players, [idle, idle], [], 1); castAbility(sys, players, 0, 'glow'); eq(n, 1);
  for (let i = 0; i < 100; i++) { stepAbilities(sys, players, [idle, idle], [], 1); castAbility(sys, players, 0, 'glow'); }
  assert(sys.events.length <= sys.cfg.maxEvents, 'eseménylista plafon');
});

test('ability: nézet a HUD-nak – cooldown-arány, kész/megfizethető', () => {
  const { sys, players } = mk();
  let v = abilityView(sys, players, 0); eq(v.slots[0].id, 'bolt'); eq(v.slots[0].ready, true); eq(v.slots[0].nameKey, 'ability.bolt'); eq(v.pools.mana.value, 100);
  players[0].mana = 31; sys.hooks.enemies = () => [{ x: 110, y: 100 }];
  castAbility(sys, players, 0, 'bolt');
  v = abilityView(sys, players, 0); near(v.slots[0].ratio, 1); eq(v.slots[0].ready, false); eq(v.slots[1].affordable, false); // glow 10 > 1 mana
  stepAbilities(sys, players, [idle, idle], [], 1); v = abilityView(sys, players, 0); near(v.slots[0].ratio, 0.5);
});

test('ability: 6000 kockás fuzz – nincs NaN, készletek tartományban, determinizmus', () => {
  const run = seed => {
    const { sys, players } = mk({ hooks: { enemies: (o, r) => [{ x: o.x + 40, y: o.y }, { x: o.x - 400, y: o.y }] } });
    const rnd = mulberry32(seed); const inv = createPlayerInventories(); addItem(inv[1], 'axe', 1); const log = [];
    onAbility(sys, e => log.push(e.type[0] + e.player + (e.ability || '') + (e.reason || '')));
    for (let f = 0; f < 6000; f++) {
      const inputs = [0, 1].map(() => ({ ability1: rnd() < 0.2, ability2: rnd() < 0.2, ability1Pressed: rnd() < 0.05, ability2Pressed: rnd() < 0.05 }));
      if (f % 997 === 0) { players[0].mana = NaN; players[1].stamina = rnd() * 150 - 20; }
      if (f % 211 === 0) setAbilitySlots(sys, rnd() < 0.5 ? 0 : 1, rnd() < 0.5 ? null : ['nova', 'heal']);
      players[0].x += (rnd() - 0.5) * 8; players[1].y += (rnd() - 0.5) * 8;
      stepAbilities(sys, players, inputs, [{ x: rnd() - 0.5, y: rnd() - 0.5 }, null], 1 / 60 * (1 + (f % 7)), { inventories: inv });
      for (const p of players) { for (const k of ['mana', 'focus']) assert(Number.isFinite(p[k]) && p[k] >= 0 && p[k] <= p[k + 'Max'], k + ' tartomány'); }
      for (const st of sys.players) for (const v of st.cd.values()) assert(v > 0 && Number.isFinite(v), 'cooldown');
    }
    return log.join('|') + '#' + sys.stats.casts + '/' + sys.stats.fails;
  };
  const a = run(54), b = run(54);
  eq(a, b); assert(/cast|c0|c1/.test(a) || a.length > 0, 'volt esemény'); assert(a.includes('c0'), 'P1 elsütött valamit');
});
