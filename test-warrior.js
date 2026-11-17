// S055 tesztek: Harcos – adat, falbontás, tolás, sebzés, erő-szorzó, vétó (nincs költség), mentés, determinizmus. S056: a fájl végén a Varázsló tesztjei ('wizard:').
import { test, assert, eq, near } from './test-index.js';
import { createPlayer } from './game-player.js';
import { CLASS_DEFS, ABILITY_DEFS, CHARACTER_TEXTS } from './data-character.js';
import { createCharacterRegistry, loadRegistry, collectTexts, auditRegistryTexts } from './game-registry.js';
import { createAbilitySystem, castAbility, castSlot, stepAbilities, slotAbilities, abilityView } from './game-ability.js';
import { applyRace } from './game-race.js';
import { mulberry32 } from './world-noise.js';
import { WIZARD_CONFIG, createFlammables, flammableColliders, igniteFlammable, stepFlammables, flammablesState, restoreFlammables, attachWizard, stepWizard, lightSources, lightAt } from './game-wizard.js';
import { WARRIOR_CONFIG, strengthMul, createBreakables, breakableColliders, segmentHit, damageBreakable, breakablesState, restoreBreakables, attachWarrior } from './game-warrior.js';

const ok = v => assert(v, 'ok');
const mk = (o = {}) => {
  const reg = createCharacterRegistry();
  const sys = createAbilitySystem({ reg });
  const players = [createPlayer(0, 100, 100), createPlayer(1, 400, 400)];
  players[0].class = 'warrior';
  const breakables = createBreakables(o.walls || [{ id: 'w1', x: 130, y: 90, w: 32, h: 32 }, { id: 'far', x: 300, y: 90, w: 32, h: 32 }]);
  const enemies = o.enemies || [];
  const w = attachWarrior(sys, { players, breakables, enemies: (org, r) => enemies.filter(e => Math.hypot(e.x - org.x, e.y - org.y) <= r), ...(o.env || {}) });
  return { reg, sys, players, breakables, enemies, w };
};
const right = { x: 1, y: 0 };
const wait = (sys, players, s = 5) => stepAbilities(sys, players, [{}, {}], [], s);

test('warrior: adat – kaszt + 3 képesség, 2 gomb = wallbreak/shove, élő regiszter hibátlan, HU/EN szövegek', () => {
  assert(CLASS_DEFS.some(c => c.id === 'warrior') && ABILITY_DEFS.filter(a => ['wallbreak', 'shove', 'strike'].includes(a.id)).length === 3, 'harcos adat');
  const reg = createCharacterRegistry(); const c = reg.classes.get('warrior');
  ok(c); eq(c.resource, 'stamina'); eq(c.abilities.join(), 'wallbreak,shove,strike'); eq(reg.errors.length, 0);
  const sys = createAbilitySystem({ reg }); const p = createPlayer(0, 0, 0); p.class = 'warrior';
  eq(slotAbilities(sys, 0, p).join(), 'wallbreak,shove');
  const live = loadRegistry(); assert(live.ok, live.errors.concat(live.dups, live.problems).join());
  eq(auditRegistryTexts(live, collectTexts()).length, 0);
  for (const id of ['class.warrior', 'class.warrior.desc', 'ability.wallbreak', 'ability.shove', 'ability.strike', 'ability.wallbreak.desc', 'ability.shove.desc', 'ability.strike.desc']) { ok(CHARACTER_TEXTS.hu[id]); ok(CHARACTER_TEXTS.en[id]); }
  eq(reg.abilities.get('wallbreak').tags[0], 'TÖRÉS'); eq(reg.abilities.get('shove').tags[0], 'TOLÁS');
});

test('warrior: törhető falak – létrehozás, hibás elem kiesik, ütköző-lista', () => {
  const bs = createBreakables([{ id: 'a', x: 0, y: 0, w: 32, h: 32 }, { id: 'a', x: 5, y: 5, w: 32, h: 32, hp: 9 }, { id: 'b', x: 0, y: 0, w: 0, h: 5 }, null, 7, { id: 'c', x: NaN, y: 0, w: 1, h: 1 }, { id: 'd', x: 0, y: 0, w: 1, h: 1, hp: 0 }, { id: 5, x: 1, y: 1, w: 2, h: 2 }]);
  eq(bs.walls.size, 2); eq(bs.walls.get('a').hp, 9); eq(bs.walls.get('a').x, 5); ok(bs.walls.get('5'));
  eq(breakableColliders(bs).length, 2); eq(createBreakables('x').walls.size, 0); eq(breakableColliders(null).length, 0);
});

test('warrior: szakasz-metszés – belépési pont, szélesség, kihagyás', () => {
  const r = { x: 100, y: 100, w: 32, h: 32 };
  near(segmentHit(0, 116, 200, 116, r, 0), 0.5); // x=100 -> t=0.5
  eq(segmentHit(0, 140, 200, 140, r, 0), -1); // fölötte/alatta
  ok(segmentHit(0, 140, 200, 140, r, 24) >= 0); // a szélesség miatt érinti
  eq(segmentHit(0, 116, 50, 116, r, 0), -1); // nem éri el
  near(segmentHit(110, 110, 120, 120, r, 0), 0); // a szakasz kezdete bent
  eq(segmentHit(0, 116, 200, 116, { x: 100, y: 100, w: 32, h: 32 }, -5) >= 0, true); // negatív szélesség = 0
});

test('warrior: falbontás – sebez, (3 hp, power 2 × erő) 2 használat tör, költség + cooldown + a fal kikerül', () => {
  const { sys, players, breakables, w } = mk();
  const inp = { ctx: { facing: right } };
  let r = castSlot(sys, players, 0, 0, inp.ctx); ok(r.ok); near(players[0].stamina, 65); near(breakables.walls.get('w1').hp, 1); eq(w.stats.broken, 0);
  eq(castSlot(sys, players, 0, 0, inp.ctx).reason, 'busy'); wait(sys, players, 0.3);
  eq(castSlot(sys, players, 0, 0, inp.ctx).reason, 'cooldown'); wait(sys, players, 3);
  players[0].stamina = 100;
  r = castSlot(sys, players, 0, 0, inp.ctx); ok(r.ok); eq(breakables.walls.has('w1'), false); ok(breakables.broken.has('w1')); eq(w.stats.broken, 1); eq(breakables.version, 1);
  eq(w.effects[w.effects.length - 1].broken, true); eq(breakableColliders(breakables).length, 1);
});

test('warrior: falbontás vétó – nincs fal az irányban/hatótávon belül -> nincs költség, nincs cooldown', () => {
  const { sys, players, w } = mk();
  eq(castSlot(sys, players, 0, 0, { facing: { x: -1, y: 0 } }).reason, 'blocked'); // hátra nincs fal
  eq(castSlot(sys, players, 0, 0, { facing: { x: 0, y: 1 } }).reason, 'blocked');
  players[0].x = 100; // a 'far' fal 200 px-re van, a hatótáv 48 px
  eq(castSlot(sys, players, 0, 0, { facing: right }).ok, true); // w1 közel
  near(players[0].stamina, 65); eq(sys.players[0].cd.get('wallbreak'), 3);
  const free = mk({ walls: [] }); eq(castSlot(free.sys, free.players, 0, 0, { facing: right }).reason, 'blocked');
  near(free.players[0].stamina === undefined ? 100 : free.players[0].stamina, 100); eq(free.sys.players[0].cd.size, 0); eq(free.w.stats.walls, 0);
  const none = createAbilitySystem({ reg: createCharacterRegistry() }); attachWarrior(none, { players: [createPlayer(0, 0, 0), createPlayer(1, 5, 0)] });
  eq(castAbility(none, [createPlayer(0, 0, 0), createPlayer(1, 5, 0)], 0, 'wallbreak', { facing: right }).reason, 'blocked'); // nincs breakables
});

test('warrior: a legközelebbi falat sebzi (nem a távolabbit); az erő szorozza (ork 1 használat)', () => {
  const walls = [{ id: 'near', x: 120, y: 90, w: 32, h: 32 }, { id: 'back', x: 140, y: 90, w: 32, h: 32 }];
  const { sys, players, breakables } = mk({ walls });
  ok(castSlot(sys, players, 0, 0, { facing: right }).ok); near(breakables.walls.get('near').hp, 1); near(breakables.walls.get('back').hp, 3);
  const o = mk(); applyRace(o.reg, o.players[0], 'orc'); near(strengthMul(o.players[0]), 1.35 * 1.2); // ork: 1,62 · 2 = 3,24 >= 3
  ok(castSlot(o.sys, o.players, 0, 0, { facing: right }).ok); eq(o.breakables.walls.has('w1'), false);
  const d = mk(); applyRace(d.reg, d.players[0], 'elf'); ok(castSlot(d.sys, d.players, 0, 0, { facing: right }).ok); near(d.breakables.walls.get('w1').hp, 3 - 2 * 0.85); // tünde gyengébb
});

test('warrior: tolás – a sávban lévő ellenfeleket tolja (távolság az erőtől), a sávon kívüliek maradnak, falba nem tol', () => {
  const enemies = [{ x: 140, y: 100 }, { x: 150, y: 110 }, { x: 140, y: 160 }, { x: 100, y: 140 }, { x: 260, y: 100 }, { x: 80, y: 100 }];
  const { sys, players, w } = mk({ enemies });
  ok(castSlot(sys, players, 0, 1, { facing: right }).ok); near(players[0].stamina, 80);
  near(enemies[0].x, 140 + 64); near(enemies[0].y, 100); near(enemies[1].x, 150 + 64); near(enemies[1].y, 110);
  eq(enemies[2].x, 140); eq(enemies[3].x, 100); eq(enemies[4].x, 260); eq(enemies[5].x, 80); eq(w.stats.pushed, 2); eq(w.effects.filter(e => e.type === 'push').length, 2);
  const walled = mk({ enemies: [{ x: 140, y: 100 }], env: { solid: (x) => x > 160 } });
  ok(castSlot(walled.sys, walled.players, 0, 1, { facing: right }).ok); assert(walled.enemies[0].x <= 160 && walled.enemies[0].x > 140, 'falnál megáll'); near(walled.w.effects[0].moved, walled.enemies[0].x - 140);
  const custom = []; const c = mk({ enemies: [{ x: 140, y: 100 }], env: { push: (e, dx, dy, d) => { custom.push([dx, dy, d]); return 7; } } });
  ok(castSlot(c.sys, c.players, 0, 1, { facing: right }).ok); eq(custom.length, 1); eq(c.w.effects[0].moved, 7);
});

test('warrior: tolás vétó – nincs ellenfél -> nincs költség; max célpont; hibás ellenfél-hook', () => {
  const { sys, players } = mk();
  eq(castSlot(sys, players, 0, 1, { facing: right }).reason, 'blocked'); eq(sys.players[0].cd.size, 0);
  const many = Array.from({ length: 10 }, (_, i) => ({ x: 120 + i * 4, y: 100 }));
  const x0 = many.map(e => e.x); const m = mk({ enemies: many }); ok(castSlot(m.sys, m.players, 0, 1, { facing: right }).ok); eq(m.w.stats.pushed, WARRIOR_CONFIG.shoveMaxTargets);
  eq(many.filter((e, i) => e.x !== x0[i]).length, 6); eq(many[6].x, x0[6]); // a 6 legközelebbi mozdult
  const bad = mk({ env: { enemies: () => { throw new Error('x'); } } }); eq(castSlot(bad.sys, bad.players, 0, 1, { facing: right }).reason, 'blocked');
  const junk = mk({ env: { enemies: () => [null, { x: NaN, y: 1 }, 5, { x: 120, y: 100 }] } }); ok(castSlot(junk.sys, junk.players, 0, 1, { facing: right }).ok); eq(junk.w.stats.pushed, 1);
});

test('warrior: alap sebzés (strike) – a legközelebbi ellenfél, erő-szorzó, halál jelzés, egyedi damage-hook', () => {
  const enemies = [{ x: 140, y: 100, hp: 10, id: 'near' }, { x: 100, y: 145, hp: 10, id: 'far' }];
  const { sys, players, w } = mk({ enemies });
  ok(castAbility(sys, players, 0, 'strike', { facing: right }).ok); near(enemies[0].hp, 2); eq(enemies[1].hp, 10); near(players[0].stamina, 88);
  eq(w.effects[0].type, 'hit'); eq(w.effects[0].dead, false); wait(sys, players, 1);
  ok(castAbility(sys, players, 0, 'strike').ok); eq(enemies[0].hp, 0); eq(w.effects[1].dead, true); eq(w.stats.hits, 2);
  const hp = []; const c = mk({ enemies: [{ x: 120, y: 100 }], env: { damage: (e, a, info) => { hp.push([a, info.ability, info.player]); return true; } } });
  ok(castAbility(c.sys, c.players, 0, 'strike').ok); eq(hp.length, 1); near(hp[0][0], 8); eq(hp[0][1], 'strike'); eq(c.w.effects[0].dead, true);
  const none = mk(); eq(castAbility(none.sys, none.players, 0, 'strike').reason, 'target'); eq(none.sys.players[0].cd.size, 0);
  const ne = mk({ enemies: [{ x: 120, y: 100 }] }); ok(castAbility(ne.sys, ne.players, 0, 'strike').ok); // hp nélküli ellenfél: nem dob
});

test('warrior: stamina – kimerült harcos nem bont/tol; a nézet jelzi, regenerálódik', () => {
  const { sys, players } = mk({ enemies: [{ x: 120, y: 100 }] });
  players[0].stamina = 10; eq(castSlot(sys, players, 0, 0, { facing: right }).reason, 'resource');
  players[0].stamina = 0; players[0].exhausted = true; eq(castSlot(sys, players, 0, 1, { facing: right }).reason, 'exhausted');
  const v = abilityView(sys, players, 0); eq(v.slots[0].id, 'wallbreak'); eq(v.slots[0].affordable, false); eq(v.slots[1].affordable, false);
  players[0].exhausted = false; players[0].stamina = 100; ok(abilityView(sys, players, 0).slots[0].ready);
});

test('warrior: detach, hibás env, állapot (mentés + visszaállítás) atomi', () => {
  const { sys, players, w, breakables } = mk({ enemies: [{ x: 120, y: 100 }] });
  w.detach(); eq(sys.handlers.size, 0);
  const bare = createAbilitySystem({ reg: createCharacterRegistry() }); attachWarrior(bare); attachWarrior(bare, null); eq(bare.handlers.size, 3);
  const P = [createPlayer(0, 100, 100), createPlayer(1, 0, 0)]; P[0].class = 'warrior';
  eq(castSlot(bare, P, 0, 0, { facing: right }).reason, 'blocked'); // players hiányában sem dob
  // állapot
  const bs = createBreakables([{ id: 'a', x: 0, y: 0, w: 32, h: 32 }, { id: 'b', x: 64, y: 0, w: 32, h: 32 }, { id: 'c', x: 128, y: 0, w: 32, h: 32 }]);
  damageBreakable(bs, -10, 16, 20, 16, 1); damageBreakable(bs, 70, 16, 90, 16, 5);
  const st = breakablesState(bs); eq(st.v, 1); eq(st.broken.join(), 'b'); eq(st.hp.length, 1); eq(st.hp[0][0], 'a');
  const fresh = createBreakables([{ id: 'a', x: 0, y: 0, w: 32, h: 32 }, { id: 'b', x: 64, y: 0, w: 32, h: 32 }, { id: 'c', x: 128, y: 0, w: 32, h: 32 }]);
  const snap = breakablesState(fresh); eq(restoreBreakables(fresh, { v: 2, broken: [], hp: [] }), false); eq(restoreBreakables(fresh, { v: 1, broken: ['b', {}], hp: [] }), false); eq(restoreBreakables(fresh, { v: 1, broken: [], hp: [['a', 'x']] }), false);
  eq(JSON.stringify(breakablesState(fresh)), JSON.stringify(snap)); // hibánál érintetlen
  ok(restoreBreakables(fresh, JSON.parse(JSON.stringify(st)))); eq(fresh.walls.has('b'), false); near(fresh.walls.get('a').hp, 2); eq(fresh.walls.size, 2);
  eq(damageBreakable(bs, 0, 0, 1, 1, NaN), null); eq(damageBreakable(null, 0, 0, 1, 1, 1), null); eq(damageBreakable(bs, 0, 0, NaN, 1, 1), null);
});

test('warrior: 6000 kockás fuzz – nincs NaN, az ellenfelek véges helyen, a falak száma csak csökken, determinizmus', () => {
  const run = seed => {
    const rnd = mulberry32(seed);
    const walls = Array.from({ length: 12 }, (_, i) => ({ id: 'w' + i, x: 150 + (i % 4) * 40, y: 60 + Math.floor(i / 4) * 40, w: 32, h: 32 }));
    const enemies = Array.from({ length: 8 }, (_, i) => ({ x: 120 + i * 17, y: 90 + (i % 3) * 20, hp: 20 }));
    const { sys, players, breakables, w } = mk({ walls, enemies });
    const w0 = breakables.walls.size; let prev = w0;
    for (let f = 0; f < 6000; f++) {
      const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: rnd() - .5, y: rnd() - .5 }, null];
      players[0].x = 100 + rnd() * 80; players[0].y = 70 + rnd() * 80; if (f % 400 === 0) players[0].stamina = 100;
      stepAbilities(sys, players, [{ ability1: rnd() < .3, ability2: rnd() < .3 }, {}], [dirs[Math.floor(rnd() * 6)], null], 1 / 20);
      if (f % 50 === 0) castAbility(sys, players, 0, 'strike');
      for (const e of enemies) { assert(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.hp) && e.hp >= 0, 'ellenfél'); }
      assert(breakables.walls.size <= prev, 'a falak száma nem nő'); prev = breakables.walls.size;
      assert(Number.isFinite(players[0].stamina), 'stamina');
    }
    return JSON.stringify([w.stats, breakables.walls.size, enemies.map(e => [Math.round(e.x), Math.round(e.hp)]), sys.stats]);
  };
  const a = run(55), b = run(55); eq(a, b); assert(a.includes('"walls":'), 'volt hatás'); assert(JSON.parse(a)[0].walls + JSON.parse(a)[0].pushed + JSON.parse(a)[0].hits > 0, 'volt hatás');
});

// ---- S056: Varázsló ----
const mkW = (o = {}) => {
  const reg = createCharacterRegistry();
  const sys = createAbilitySystem({ reg });
  const players = [createPlayer(0, 100, 100), createPlayer(1, 400, 400)];
  players[0].class = 'wizard';
  const flammables = createFlammables(o.fl || [{ id: 'f1', x: 130, y: 90, w: 32, h: 32 }, { id: 'far', x: 400, y: 90, w: 32, h: 32 }]);
  const enemies = o.enemies || [];
  const w = attachWizard(sys, { players, flammables, enemies: (org, r) => enemies.filter(e => Math.hypot(e.x - org.x, e.y - org.y) <= r), ...(o.env || {}) });
  return { reg, sys, players, flammables, enemies, w };
};
const cast = (U, slot, facing = right) => castSlot(U.sys, U.players, 0, slot, { facing });

test('wizard: adat – kaszt + 3 képesség (mana), 2 gomb = light/ignite, TAG-ek, élő regiszter hibátlan, HU/EN szövegek', () => {
  const reg = createCharacterRegistry(); const c = reg.classes.get('wizard');
  ok(c); eq(c.resource, 'mana'); eq(c.abilities.join(), 'light,ignite,freeze'); eq(reg.errors.length, 0);
  eq(reg.abilities.get('light').tags[0], 'FÉNY'); eq(reg.abilities.get('ignite').tags[0], 'ÉGETÉS'); eq(reg.abilities.get('freeze').tags[0], 'FAGYASZTÁS');
  for (const id of ['light', 'ignite', 'freeze']) eq(reg.abilities.get(id).resource, 'mana');
  const sys = createAbilitySystem({ reg }); const p = createPlayer(0, 0, 0); p.class = 'wizard';
  eq(slotAbilities(sys, 0, p).join(), 'light,ignite');
  const live = loadRegistry(); assert(live.ok, live.errors.concat(live.dups, live.problems).join());
  eq(auditRegistryTexts(live, collectTexts()).length, 0);
  for (const id of ['class.wizard', 'class.wizard.desc', 'ability.light', 'ability.ignite', 'ability.freeze', 'ability.light.desc', 'ability.ignite.desc', 'ability.freeze.desc']) { ok(CHARACTER_TEXTS.hu[id]); ok(CHARACTER_TEXTS.en[id]); }
  eq(Object.keys(CHARACTER_TEXTS.hu).length, Object.keys(CHARACTER_TEXTS.en).length);
});

test('wizard: fény – mana-költség, a játékost követi, hatótáv, még égő fény újítása vétó (nincs költség), lejár', () => {
  const U = mkW(); const { sys, players, w } = U;
  ok(cast(U, 0).ok); near(players[0].mana, 85); eq(w.lights.get(0).left, 90); eq(w.stats.lights, 1);
  ok(lightAt(w, 100, 100)); ok(lightAt(w, 100 + 159, 100)); eq(lightAt(w, 100 + 170, 100), false); eq(lightAt(w, NaN, 1), false);
  players[0].x = 600; ok(lightAt(w, 650, 100)); eq(lightAt(w, 100, 100), false); // követi a játékost
  const src = lightSources(w); eq(src.length, 1); eq(src[0].player, 0); near(src[0].r, 160); players[0].x = NaN; eq(lightSources(w).length, 0); players[0].x = 100;
  stepAbilities(sys, players, [{}, {}], [], 5); players[0].mana = 50; stepWizard(w, 40); // 50 mp maradt > 45
  eq(cast(U, 0).reason, 'blocked'); near(players[0].mana, 50); eq(sys.players[0].cd.has('light'), false);
  stepWizard(w, 10); ok(cast(U, 0).ok); near(players[0].mana, 35); near(w.lights.get(0).left, 90);
  stepWizard(w, 91); eq(w.lights.size, 0); eq(lightAt(w, 100, 100), false);
});

test('wizard: mana – kevés mana -> resource, költés után késleltetett regeneráció, a stamina érintetlen', () => {
  const U = mkW({ enemies: [{ x: 140, y: 100, hp: 50 }] }); const { sys, players } = U;
  players[0].mana = 14; eq(cast(U, 0).reason, 'resource'); near(players[0].mana, 14); eq(sys.players[0].cd.size, 0);
  players[0].mana = 100; ok(cast(U, 1).ok); near(players[0].mana, 80); near(players[0].stamina === undefined ? 100 : players[0].stamina, 100);
  stepAbilities(sys, players, [{}, {}], [], 1); near(players[0].mana, 80); // delay 1.5
  stepAbilities(sys, players, [{}, {}], [], 1.5); near(players[0].mana, 80 + 4 * 1); // 1 mp regen
  const v = abilityView(sys, players, 0); eq(v.slots[0].id, 'light'); eq(v.slots[1].id, 'ignite'); eq(v.slots[0].resource, 'mana'); near(v.pools.mana.value, 84);
});

test('wizard: gyújtás – éghető akadály: elég (1,5 mp), közben áll, version++, vétó nincs cél / már ég', () => {
  const U = mkW(); const { players, flammables, w } = U;
  eq(cast(U, 1, { x: -1, y: 0 }).reason, 'blocked'); eq(cast(U, 1, { x: 0, y: 1 }).reason, 'blocked'); near(players[0].mana, 100); eq(U.sys.players[0].cd.size, 0);
  ok(cast(U, 1).ok); near(players[0].mana, 80); eq(w.stats.ignited, 1); ok(flammables.items.get('f1').lit); eq(flammableColliders(flammables).length, 2);
  stepAbilities(U.sys, players, [{}, {}], [], 5); players[0].mana = 100;
  eq(cast(U, 1).reason, 'blocked'); near(players[0].mana, 100); // már ég, nincs más cél
  eq(stepWizard(w, 1.0).burnt.length, 0); eq(flammables.items.has('f1'), true);
  const r = stepWizard(w, 0.6); eq(r.burnt.join(), 'f1'); eq(flammables.items.has('f1'), false); ok(flammables.burnt.has('f1')); eq(flammables.version, 1); eq(flammableColliders(flammables).length, 1);
  const none = mkW({ fl: [] }); eq(cast(none, 1).reason, 'blocked'); near(none.players[0].mana === undefined ? 100 : none.players[0].mana, 100);
  const bare = createAbilitySystem({ reg: createCharacterRegistry() }); attachWizard(bare, { players: [createPlayer(0, 100, 100), createPlayer(1, 0, 0)] }); const P = [createPlayer(0, 100, 100), createPlayer(1, 0, 0)]; P[0].class = 'wizard';
  eq(castSlot(bare, P, 0, 1, { facing: right }).reason, 'blocked');
});

test('wizard: gyújtás – a legközelebbit gyújtja; szakasz-függvény; hibás elem kiesik; égési idő per elem', () => {
  const fs = createFlammables([{ id: 'a', x: 120, y: 90, w: 32, h: 32 }, { id: 'b', x: 160, y: 90, w: 32, h: 32, burn: 5 }, { id: 'a', x: 121, y: 90, w: 32, h: 32 }, { id: 'x', x: 0, y: 0, w: 0, h: 5 }, null, 7, { id: 'y', x: NaN, y: 0, w: 1, h: 1 }, { id: 'z', x: 0, y: 0, w: 1, h: 1, burn: 0 }]);
  eq(fs.items.size, 2); eq(fs.items.get('a').x, 121);
  eq(igniteFlammable(fs, 100, 100, 200, 100).id, 'a'); eq(igniteFlammable(fs, 100, 100, 200, 100).id, 'b'); eq(igniteFlammable(fs, 100, 100, 200, 100), null); // a már égőt kihagyja
  eq(igniteFlammable(fs, NaN, 0, 1, 1), null); eq(igniteFlammable(null, 0, 0, 1, 1), null);
  stepFlammables(fs, 1.6); eq(fs.items.has('a'), false); eq(fs.items.has('b'), true); stepFlammables(fs, 3.5); eq(fs.items.size, 0); eq(fs.version, 2);
  eq(stepFlammables(fs, -1).length, 0); eq(stepFlammables(null, 1).length, 0); eq(flammableColliders(null).length, 0); eq(createFlammables('x').items.size, 0);
});

test('wizard: gyújtás – ellenfél: sebzés + égés (DoT, nem halmozódik), sávon kívüli kimarad, max célpont, halál jelzés', () => {
  const enemies = [{ x: 140, y: 100, hp: 20 }, { x: 150, y: 110, hp: 20 }, { x: 140, y: 160, hp: 20 }, { x: 80, y: 100, hp: 20 }, { x: 260, y: 100, hp: 20 }];
  const U = mkW({ enemies, fl: [] }); const { w } = U;
  ok(cast(U, 1).ok); near(U.players[0].mana, 80); near(enemies[0].hp, 16); near(enemies[1].hp, 16); eq(enemies[2].hp, 20); eq(enemies[3].hp, 20); eq(enemies[4].hp, 20);
  eq(w.stats.scorched, 2); eq(w.burning.size, 2);
  stepWizard(w, 1); near(enemies[0].hp, 14); stepWizard(w, 5); near(enemies[0].hp, 10); eq(w.burning.size, 0); stepWizard(w, 5); near(enemies[0].hp, 10); // összesen 3 mp · 2/mp
  const weak = mkW({ enemies: [{ x: 140, y: 100, hp: 5 }], fl: [] }); ok(cast(weak, 1).ok); const r = stepWizard(weak.w, 1); eq(r.dead.length, 1); eq(weak.enemies[0].hp, 0); eq(weak.w.stats.burned, 1);
  const kill = mkW({ enemies: [{ x: 140, y: 100, hp: 3 }], fl: [] }); ok(cast(kill, 1).ok); eq(kill.w.effects[0].dead, true); eq(kill.w.burning.size, 0); // a közvetlen sebzés megöli: nincs égés
  const many = Array.from({ length: 8 }, (_, i) => ({ x: 120 + i * 4, y: 100, hp: 20 })); const m = mkW({ enemies: many, fl: [] }); ok(cast(m, 1).ok); eq(m.w.stats.scorched, WIZARD_CONFIG.igniteMaxTargets); eq(many.filter(e => e.hp < 20).length, 4);
});

test('wizard: fagyasztás – a legközelebbi ellenfél lefagy (e.frozen visszaszámol), felolvad, vétó (nincs cél, már fagyott), költség', () => {
  const enemies = [{ x: 160, y: 100, hp: 10, id: 'near' }, { x: 100, y: 230, hp: 10, id: 'far' }];
  const U = mkW({ enemies, fl: [] }); const { sys, players, w } = U; const f = () => castAbility(sys, players, 0, 'freeze', { facing: right });
  ok(f().ok); near(players[0].mana, 75); eq(enemies[0].frozen, 3); eq(enemies[1].frozen, undefined); eq(w.stats.frozen, 1); eq(sys.players[0].cd.get('freeze'), 6);
  stepWizard(w, 1); near(enemies[0].frozen, 2); stepAbilities(sys, players, [{}, {}], [], 7); players[0].mana = 100;
  eq(f().reason, 'blocked'); near(players[0].mana, 100); // már fagyott
  const t = stepWizard(w, 2.5); eq(enemies[0].frozen, 0); eq(t.thawed.length, 1); eq(w.frozen.size, 0);
  const far = mkW({ enemies: [{ x: 600, y: 600, hp: 5 }], fl: [] }); eq(castAbility(far.sys, far.players, 0, 'freeze').reason, 'target'); eq(far.sys.players[0].cd.size, 0);
  const calls = []; const h = mkW({ enemies: [{ x: 150, y: 100, hp: 5 }], fl: [], env: { freeze: (e, s) => { calls.push(s); } } }); ok(castAbility(h.sys, h.players, 0, 'freeze').ok); eq(calls.join(), '3'); eq(h.enemies[0].frozen, undefined);
  const bad = mkW({ enemies: [{ x: 150, y: 100, hp: 5 }], fl: [], env: { freeze: () => { throw new Error('x'); } } }); ok(castAbility(bad.sys, bad.players, 0, 'freeze').ok);
});

test('wizard: kölcsönhatás – a fagy eloltja az égést; a láng felolvasztja a fagyott ellenfelet', () => {
  const e = { x: 140, y: 100, hp: 40 }; const U = mkW({ enemies: [e], fl: [] }); const { sys, players, w } = U;
  ok(cast(U, 1).ok); eq(w.burning.size, 1); stepAbilities(sys, players, [{}, {}], [], 3);
  ok(castAbility(sys, players, 0, 'freeze').ok); eq(w.burning.size, 0); eq(e.frozen, 3); const hp = e.hp; stepWizard(w, 1); near(e.hp, hp); // nem ég tovább
  stepAbilities(sys, players, [{}, {}], [], 5); ok(cast(U, 1).ok); eq(w.frozen.size, 0); eq(e.frozen, 0); eq(w.burning.size, 1); near(e.hp, hp - 4);
});

test('wizard: állapot (éghető akadályok), detach, hibás env, hibás dt', () => {
  const mkF = () => createFlammables([{ id: 'a', x: 0, y: 0, w: 32, h: 32 }, { id: 'b', x: 64, y: 0, w: 32, h: 32 }, { id: 'c', x: 128, y: 0, w: 32, h: 32 }]);
  const fs = mkF(); igniteFlammable(fs, -10, 16, 20, 16); stepFlammables(fs, 2); const st = flammablesState(fs); eq(st.v, 1); eq(st.burnt.join(), 'a');
  const fresh = mkF(); const snap = JSON.stringify(flammablesState(fresh));
  eq(restoreFlammables(fresh, { v: 2, burnt: [] }), false); eq(restoreFlammables(fresh, { v: 1, burnt: ['b', {}] }), false); eq(restoreFlammables(fresh, null), false); eq(JSON.stringify(flammablesState(fresh)), snap);
  ok(restoreFlammables(fresh, JSON.parse(JSON.stringify(st)))); eq(fresh.items.has('a'), false); eq(fresh.items.size, 2); eq(fresh.version, 1);
  const U = mkW({ enemies: [{ x: 140, y: 100, hp: 9 }] }); U.w.detach(); eq(U.sys.handlers.size, 0);
  const bare = createAbilitySystem({ reg: createCharacterRegistry() }); attachWizard(bare); attachWizard(bare, null); eq(bare.handlers.size, 3);
  const W = attachWizard(createAbilitySystem({ reg: createCharacterRegistry() }), { players: [] });
  eq(stepWizard(W, NaN).burnt.length, 0); eq(stepWizard(W, -1).dead.length, 0); eq(stepWizard(null, 1).thawed.length, 0); eq(lightSources(null).length, 0); eq(lightAt(null, 1, 1), false);
  const own = mkW(); own.sys.cfg.tile; ok(own.w.cfg.relightBelow === 0.5);
});

test('wizard: 6000 kockás fuzz – nincs NaN, hp/mana korlátos, determinizmus, a varázsló és a harcos egymás mellett', () => {
  const run = seed => {
    const rnd = mulberry32(seed);
    const fl = Array.from({ length: 10 }, (_, i) => ({ id: 'f' + i, x: 150 + (i % 5) * 40, y: 60 + Math.floor(i / 5) * 40, w: 32, h: 32 }));
    const enemies = Array.from({ length: 8 }, (_, i) => ({ x: 120 + i * 17, y: 90 + (i % 3) * 20, hp: 30 }));
    const U = mkW({ fl, enemies }); const { sys, players, flammables, w } = U; let prev = flammables.items.size;
    for (let f = 0; f < 6000; f++) {
      const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: rnd() - .5, y: rnd() - .5 }, null];
      players[0].x = 100 + rnd() * 80; players[0].y = 70 + rnd() * 80;
      stepAbilities(sys, players, [{ ability1: rnd() < .2, ability2: rnd() < .3 }, {}], [dirs[Math.floor(rnd() * 6)], null], 1 / 20);
      if (f % 70 === 0) castAbility(sys, players, 0, 'freeze');
      stepWizard(w, 1 / 20);
      if (f % 900 === 0) for (const e of enemies) e.hp = 30;
      for (const e of enemies) assert(Number.isFinite(e.x) && Number.isFinite(e.hp) && e.hp >= 0 && e.frozen !== NaN, 'ellenfél');
      assert(players[0].mana >= 0 && players[0].mana <= players[0].manaMax && Number.isFinite(players[0].mana), 'mana');
      assert(flammables.items.size <= prev, 'az éghetők száma nem nő'); prev = flammables.items.size;
      for (const l of w.lights.values()) assert(l.left > 0 && l.left <= l.max, 'fény');
    }
    return JSON.stringify([w.stats, flammables.items.size, enemies.map(e => [Math.round(e.hp), e.frozen === undefined ? -1 : Math.round(e.frozen * 10)]), sys.stats]);
  };
  const a = run(56), b = run(56); eq(a, b); const s = JSON.parse(a)[0]; assert(s.lights + s.ignited + s.scorched + s.frozen > 0, 'volt hatás');
  // egymás mellett: a harcos kezelői nem ütköznek a varázslóéival
  const reg = createCharacterRegistry(); const sys = createAbilitySystem({ reg }); const players = [createPlayer(0, 100, 100), createPlayer(1, 140, 100)]; players[0].class = 'wizard'; players[1].class = 'warrior';
  const en = [{ x: 190, y: 100, hp: 30 }]; const env = { players, enemies: () => en, breakables: createBreakables([]), flammables: createFlammables([]) };
  attachWarrior(sys, env); attachWizard(sys, env); eq(sys.handlers.size, 6);
  ok(castSlot(sys, players, 0, 1, { facing: right }).ok); ok(castSlot(sys, players, 1, 1, { facing: right }).ok); assert(en[0].hp < 30 && en[0].x > 190, 'mindkettő hatott');
});
