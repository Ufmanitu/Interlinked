// S055 tesztek: Harcos – adat, falbontás, tolás, sebzés, erő-szorzó, vétó (nincs költség), mentés, determinizmus.
import { test, assert, eq, near } from './test-index.js';
import { createPlayer } from './game-player.js';
import { CLASS_DEFS, ABILITY_DEFS, CHARACTER_TEXTS } from './data-character.js';
import { createCharacterRegistry, loadRegistry, collectTexts, auditRegistryTexts } from './game-registry.js';
import { createAbilitySystem, castAbility, castSlot, stepAbilities, slotAbilities, abilityView } from './game-ability.js';
import { applyRace } from './game-race.js';
import { mulberry32 } from './world-noise.js';
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
  eq(CLASS_DEFS.length, 1); eq(ABILITY_DEFS.length, 3);
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
