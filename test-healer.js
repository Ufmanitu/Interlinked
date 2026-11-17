// S058 tesztek: Gyógyító – adat, gyógyítás (társ + önmaga), tisztítás, oltalom (pajzs), mana, vétók, együttélés a többi kaszttal, determinizmus.
import { test, assert, eq } from './test-index.js';
import { createPlayer } from './game-player.js';
import { CLASS_DEFS, ABILITY_DEFS, CHARACTER_TEXTS } from './data-character.js';
import { createCharacterRegistry, loadRegistry, collectTexts, auditRegistryTexts } from './game-registry.js';
import { createAbilitySystem, castAbility, castSlot, stepAbilities, slotAbilities, setAbilitySlots } from './game-ability.js';
import { mulberry32 } from './world-noise.js';
import { HEALER_CONFIG, hpOf, attachHealer, stepHealer, wardOf, absorbDamage } from './game-healer.js';
import { attachWarrior, createBreakables } from './game-warrior.js';
import { attachWizard } from './game-wizard.js';
import { attachRanger } from './game-ranger.js';

const ok = v => assert(v, 'ok');
const mk = (o = {}) => {
  const reg = createCharacterRegistry(), sys = createAbilitySystem({ reg });
  const players = [createPlayer(0, 100, 100), createPlayer(1, o.far ? 600 : 160, 100)];
  players.forEach((p, i) => { p.class = 'healer'; p.hp = (o.hp || [50, 50])[i]; p.hpMax = 100; });
  if (o.statuses) players.forEach((p, i) => { p.statuses = o.statuses[i]; });
  const h = attachHealer(sys, { players, ...(o.env || {}) });
  return { reg, sys, players, h };
};
const wait = (m, s = 5) => stepAbilities(m.sys, m.players, [{}, {}], [], s);
const cast = (m, id, i = 0) => castAbility(m.sys, m.players, i, id, {});

test('healer: adat – kaszt + 3 képesség (mana), 2 gomb = heal/cleanse, TAG-ek, élő regiszter hibátlan, HU/EN szövegek', () => {
  assert(CLASS_DEFS.some(c => c.id === 'healer') && ABILITY_DEFS.filter(a => ['heal', 'cleanse', 'ward'].includes(a.id)).length === 3, 'gyógyító adat');
  const reg = createCharacterRegistry(), c = reg.classes.get('healer');
  ok(c); eq(c.resource, 'mana'); eq(c.abilities.join(), 'heal,cleanse,ward'); eq(reg.errors.length, 0);
  const sys = createAbilitySystem({ reg }), p = createPlayer(0, 0, 0); p.class = 'healer';
  eq(slotAbilities(sys, 0, p).join(), 'heal,cleanse');
  const live = loadRegistry(); assert(live.ok, live.errors.concat(live.dups, live.problems).join());
  eq(auditRegistryTexts(live, collectTexts()).length, 0);
  for (const id of ['class.healer', 'class.healer.desc', 'ability.heal', 'ability.cleanse', 'ability.ward', 'ability.heal.desc', 'ability.cleanse.desc', 'ability.ward.desc']) { ok(CHARACTER_TEXTS.hu[id]); ok(CHARACTER_TEXTS.en[id]); }
  eq(reg.abilities.get('heal').tags[0], 'GYÓGYÍTÁS'); eq(reg.abilities.get('cleanse').tags[0], 'TISZTÍTÁS'); eq(reg.abilities.get('ward').tags[0], 'VÉDELEM');
  for (const id of ['heal', 'cleanse', 'ward']) { eq(reg.abilities.get(id).resource, 'mana'); eq(reg.abilities.get(id).target, 'area'); }
});

test('healer: hpOf – hibás / hiányzó HP-mező nem gyógyítható, a határokra szorít', () => {
  eq(hpOf(null), null); eq(hpOf({}), null); eq(hpOf({ hp: NaN, hpMax: 10 }), null); eq(hpOf({ hp: 5, hpMax: 0 }), null); eq(hpOf({ hp: 5 }), null);
  eq(hpOf({ hp: 50, hpMax: 10 }).hp, 10); eq(hpOf({ hp: -3, hpMax: 10 }).hp, 0); eq(hpOf({ hp: 4, hpMax: 10 }).max, 10);
});

test('healer: gyógyítás – a társ teljes értéket, a gyógyító selfMul-t kap; költség + cooldown + esemény-TAG', () => {
  const m = mk(); const r = castSlot(m.sys, m.players, 0, 0, {});
  ok(r.ok); eq(r.event.tags[0], 'GYÓGYÍTÁS'); eq(m.players[1].hp, 80); eq(m.players[0].hp, 72.5); eq(m.players[0].mana, 75);
  eq(m.h.stats.heals, 1); eq(m.h.stats.hpHealed, 52.5); eq(m.h.effects.length, 2);
  eq(cast(m, 'heal').reason, 'busy'); wait(m, 0.3); eq(cast(m, 'heal').reason, 'cooldown');
  wait(m, 5); ok(cast(m, 'heal').ok); eq(m.players[1].hp, 100); eq(m.players[0].hp, 95); // a plafon: nem lépi túl a hpMax-ot
});

test('healer: gyógyítás – a távoli társ kimarad, a nem sérült / HP nélküli játékos nem számít, senki -> vétó (nincs költség, nincs cooldown)', () => {
  const m = mk({ far: true }); ok(cast(m, 'heal').ok); eq(m.players[1].hp, 50); eq(m.players[0].hp, 72.5);
  const full = mk({ hp: [100, 100] }); eq(cast(full, 'heal').reason, 'blocked'); eq(full.players[0].mana, 100); ok(!full.sys.players[0].cd.has('heal'));
  const none = mk(); delete none.players[0].hp; delete none.players[1].hp; eq(cast(none, 'heal').reason, 'blocked'); eq(none.players[0].mana, 100);
  const one = mk({ hp: [100, 40] }); ok(cast(one, 'heal').ok); eq(one.players[1].hp, 70); eq(one.players[0].hp, 100); eq(one.h.effects.length, 1);
});

test('healer: gyógyítás – env.heal felülírja (a hook hibája / hibás érték nem dob, nincs hatás -> vétó)', () => {
  const seen = []; const m = mk({ env: { heal: (p, a, info) => { seen.push([info.target, a]); p.hp += a; return a; } } });
  ok(cast(m, 'heal').ok); eq(seen.length, 2); eq(m.players[1].hp, 80);
  for (const bad of [() => { throw new Error('rossz'); }, () => NaN, () => -5, () => 'x', () => 0]) { const q = mk({ env: { heal: bad } }); eq(cast(q, 'heal').reason, 'blocked'); eq(q.players[0].mana, 100); }
});

test('healer: tisztítás – a káros státuszok (string és {id}) lekerülnek mindkét játékosról, a többi marad; nincs káros -> vétó', () => {
  const m = mk({ statuses: [['burn', { id: 'slow', t: 3 }, 'haste'], [{ id: 'poison' }, 'regen', 'unknown']] });
  const r = castSlot(m.sys, m.players, 0, 1, {}); ok(r.ok); eq(r.event.tags[0], 'TISZTÍTÁS'); eq(m.players[0].mana, 85);
  eq(m.players[0].statuses.join(), 'haste'); eq(m.players[1].statuses.map(s => (typeof s === 'string' ? s : s.id)).join(), 'regen,unknown');
  eq(m.h.stats.cleanses, 1); eq(m.h.stats.removed, 3);
  wait(m, 5); const mana = m.players[0].mana; eq(cast(m, 'cleanse').reason, 'blocked'); eq(m.players[0].mana, mana); ok(!m.sys.players[0].cd.has('cleanse'));
  const far = mk({ far: true, statuses: [[], ['freeze']] }); eq(cast(far, 'cleanse').reason, 'blocked'); eq(far.players[1].statuses.length, 1);
  const bad = mk({ statuses: [null, 'x'] }); eq(cast(bad, 'cleanse').reason, 'blocked');
});

test('healer: tisztítás – env.cleanse felülírja, a hibás hook nem dob', () => {
  const m = mk({ env: { cleanse: (p, info) => (info.target === 1 ? 2 : 0) } }); ok(cast(m, 'cleanse').ok); eq(m.h.stats.removed, 2);
  const q = mk({ env: { cleanse: () => { throw new Error('rossz'); } } }); eq(cast(q, 'cleanse').reason, 'blocked');
});

test('healer: oltalom – pajzs mindenkire, nem halmozódik, védettre vétó, újítható lejárat előtt (küszöb alatt)', () => {
  const m = mk(); const r = castSlot(m.sys, m.players, 0, 0, {}); ok(r.ok);
  setAbilitySlots(m.sys, 0, ['ward', 'heal']); wait(m, 0.3);
  const w = castSlot(m.sys, m.players, 0, 0, {}); ok(w.ok); eq(w.event.tags[0], 'VÉDELEM'); eq(m.players[0].mana, 45);
  eq(wardOf(m.h, 0).amount, 20); eq(wardOf(m.h, 1).amount, 20); eq(wardOf(m.h, 0).left, HEALER_CONFIG.wardSecs); eq(m.h.stats.wards, 1);
  wait(m, 13); const mana = m.players[0].mana; eq(cast(m, 'ward').reason, 'blocked'); eq(m.players[0].mana, mana); eq(wardOf(m.h, 0).amount, 20); // még védett
  stepHealer(m.h, 11); // 20 mp -> 9 mp maradt (45% < 50%): újítható
  ok(cast(m, 'ward').ok); eq(wardOf(m.h, 0).left, HEALER_CONFIG.wardSecs); eq(wardOf(m.h, 0).amount, 20); // csere, nem összeadás
  eq(wardOf(m.h, 5), null); eq(wardOf(null, 0), null);
});

test('healer: pajzs – absorbDamage részleges / teljes elnyelés, lejáratkor eltűnik, hibás bemenet nem dob', () => {
  const m = mk(); setAbilitySlots(m.sys, 0, ['ward', 'heal']); ok(castSlot(m.sys, m.players, 0, 0, {}).ok);
  let a = absorbDamage(m.h, 0, 8); eq(a.absorbed, 8); eq(a.rest, 0); eq(wardOf(m.h, 0).amount, 12);
  a = absorbDamage(m.h, 0, 30); eq(a.absorbed, 12); eq(a.rest, 18); eq(wardOf(m.h, 0), null); eq(m.h.stats.absorbed, 20);
  a = absorbDamage(m.h, 0, 5); eq(a.absorbed, 0); eq(a.rest, 5); // nincs pajzs
  eq(absorbDamage(m.h, 1, 3).rest, 0); eq(wardOf(m.h, 1).amount, 17); // a társé külön áll
  for (const bad of [NaN, -4, 0, 'x', null, Infinity]) { const r = absorbDamage(m.h, 1, bad); eq(r.absorbed, 0); assert(Number.isFinite(r.rest) && r.rest >= 0, 'rest'); }
  eq(wardOf(m.h, 1).amount, 17); eq(absorbDamage(null, 0, 5).rest, 5);
  eq(stepHealer(m.h, 19).expired.length, 0); eq(stepHealer(m.h, 2).expired.join(), '1'); eq(wardOf(m.h, 1), null);
});

test('healer: mana – kevés mana -> resource, költés után késleltetett regeneráció, a focus/stamina érintetlen', () => {
  const m = mk(); const p = m.players[0]; p.mana = 24; p.focus = 40; p.stamina = 60;
  eq(cast(m, 'heal').reason, 'resource'); eq(p.mana, 24); p.mana = 100; ok(cast(m, 'heal').ok); eq(p.mana, 75);
  stepAbilities(m.sys, m.players, [{}, {}], [], 1); eq(p.mana, 75); // késleltetés (1,5 mp)
  stepAbilities(m.sys, m.players, [{}, {}], [], 1); eq(p.mana, 77); eq(p.focus, 60); eq(p.stamina, 60); // 0,5 mp · 4/mp; a focus a saját szabályai szerint (10/mp), a stamina nem változik
});

test('healer: a négy kaszt egymás mellett – külön kezelők, detach csak a gyógyítóét veszi le, hibás env / dt nem dob', () => {
  const m = mk(); attachWarrior(m.sys, { players: m.players, breakables: createBreakables([]) }); attachWizard(m.sys, { players: m.players }); attachRanger(m.sys, { players: m.players });
  for (const id of ['heal', 'cleanse', 'ward', 'wallbreak', 'light', 'track']) ok(m.sys.handlers.has(id), id);
  m.h.detach(); for (const id of ['heal', 'cleanse', 'ward']) ok(!m.sys.handlers.has(id)); ok(m.sys.handlers.has('light') && m.sys.handlers.has('wallbreak') && m.sys.handlers.has('track'));
  const sys2 = createAbilitySystem({ reg: createCharacterRegistry() });
  for (const env of [null, undefined, 5, 'x', { players: 3, heal: 4, cleanse: 'y', cfg: 7 }, { players: [null, 7] }]) { const h = attachHealer(sys2, env); ok(h); eq(stepHealer(h, 1).expired.length, 0); }
  for (const dt of [NaN, -1, 0, Infinity, 'x', null]) eq(stepHealer(m.h, dt).expired.length, 0);
  eq(stepHealer(null, 1).expired.length, 0);
  const q = mk({ env: { players: [null, null] } }); eq(cast(q, 'heal').reason, 'blocked');
});

test('healer: 6000 kockás fuzz – nincs NaN, hp/mana/pajzs korlátos, determinizmus', () => {
  const run = () => {
    const rnd = mulberry32(5858), m = mk({ statuses: [[], []] }); setAbilitySlots(m.sys, 1, ['ward', 'cleanse']);
    const names = ['burn', 'slow', 'haste', 'poison', 'regen'];
    let sum = 0;
    for (let f = 0; f < 6000; f++) {
      for (const p of m.players) { p.x = Math.max(0, Math.min(400, p.x + (rnd() - 0.5) * 20)); p.y = Math.max(0, Math.min(300, p.y + (rnd() - 0.5) * 20)); }
      if (rnd() < 0.05) for (const p of m.players) { if (rnd() < 0.5) { const hit = rnd() * 40, r = absorbDamage(m.h, m.players.indexOf(p), hit); p.hp = Math.max(0, p.hp - r.rest); } if (rnd() < 0.4 && p.statuses.length < 6) p.statuses.push(names[(rnd() * 5) | 0]); }
      stepAbilities(m.sys, m.players, [0, 1].map(() => ({ ability1: rnd() < 0.2, ability2: rnd() < 0.2 })), [], 1 / 60);
      stepHealer(m.h, 1 / 60);
      for (const p of m.players) { assert(Number.isFinite(p.mana) && p.mana >= 0 && p.mana <= p.manaMax, 'mana'); assert(Number.isFinite(p.hp) && p.hp >= 0 && p.hp <= p.hpMax, 'hp'); }
      for (const w of m.h.wards.values()) assert(Number.isFinite(w.amount) && w.amount > 0 && w.amount <= 20 && w.left > 0 && w.left <= HEALER_CONFIG.wardSecs, 'pajzs');
    }
    sum = m.players[0].hp + m.players[1].hp + m.h.stats.heals * 7 + m.h.stats.hpHealed + m.h.stats.cleanses * 11 + m.h.stats.removed * 13 + m.h.stats.wards * 17 + m.h.stats.absorbed * 19 + m.players[0].statuses.length + m.players[1].statuses.length;
    assert(m.h.stats.heals + m.h.stats.cleanses + m.h.stats.wards > 0, 'volt hatás');
    return sum;
  };
  const a = run(), b = run(); assert(Number.isFinite(a), 'NaN'); eq(a, b, 'determinizmus');
});
