// S057 tesztek: Vadőr – adat, rejtett nyomok, nyomkövetés + jelölés, kötél (horgony, elszakadás), lövés (fal, jelölés-bónusz), fókusz, vétók, mentés, determinizmus.
import { test, assert, eq } from './test-index.js';
import { createPlayer } from './game-player.js';
import { CLASS_DEFS, ABILITY_DEFS, CHARACTER_TEXTS } from './data-character.js';
import { createCharacterRegistry, loadRegistry, collectTexts, auditRegistryTexts } from './game-registry.js';
import { createAbilitySystem, castAbility, castSlot, stepAbilities, slotAbilities, setAbilitySlots } from './game-ability.js';
import { mulberry32 } from './world-noise.js';
import { RANGER_CONFIG, createHiddens, revealHidden, hiddenFound, huntState, restoreHiddens, createAnchors, hitAnchor, attachRanger, stepRanger, ropeActive, ropeLinks, isTracked } from './game-ranger.js';
import { attachWarrior, createBreakables } from './game-warrior.js';
import { attachWizard } from './game-wizard.js';

const ok = v => assert(v, 'ok');
const right = { x: 1, y: 0 };
const mk = (o = {}) => {
  const reg = createCharacterRegistry(), sys = createAbilitySystem({ reg });
  const players = [createPlayer(0, 100, 100), createPlayer(1, 400, 400)];
  players[0].class = 'ranger'; players[1].class = 'ranger';
  const hiddens = createHiddens(o.hidden || [{ id: 'h1', x: 200, y: 100 }, { id: 'h2', x: 700, y: 100 }]);
  const anchors = createAnchors(o.anchors || [{ id: 'a1', x: 160, y: 84, w: 32, h: 32 }, { id: 'a2', x: 224, y: 84, w: 32, h: 32 }]);
  const enemies = o.enemies || [];
  const w = attachRanger(sys, { players, hiddens, anchors, enemies: (org, r) => enemies.filter(e => Math.hypot(e.x - org.x, e.y - org.y) <= r), ...(o.env || {}) });
  return { reg, sys, players, hiddens, anchors, enemies, w };
};
const wait = (sys, players, s = 5) => stepAbilities(sys, players, [{}, {}], [], s);
const cast = (m, id, i = 0, facing = right) => castAbility(m.sys, m.players, i, id, { facing });

test('ranger: adat – kaszt + 3 képesség (fókusz), 2 gomb = track/rope, TAG-ek, élő regiszter hibátlan, HU/EN szövegek', () => {
  assert(CLASS_DEFS.some(c => c.id === 'ranger') && ABILITY_DEFS.filter(a => ['track', 'rope', 'shoot'].includes(a.id)).length === 3, 'vadőr adat');
  const reg = createCharacterRegistry(), c = reg.classes.get('ranger');
  ok(c); eq(c.resource, 'focus'); eq(c.abilities.join(), 'track,rope,shoot'); eq(reg.errors.length, 0);
  const sys = createAbilitySystem({ reg }), p = createPlayer(0, 0, 0); p.class = 'ranger';
  eq(slotAbilities(sys, 0, p).join(), 'track,rope');
  const live = loadRegistry(); assert(live.ok, live.errors.concat(live.dups, live.problems).join());
  eq(auditRegistryTexts(live, collectTexts()).length, 0);
  for (const id of ['class.ranger', 'class.ranger.desc', 'ability.track', 'ability.rope', 'ability.shoot', 'ability.track.desc', 'ability.rope.desc', 'ability.shoot.desc']) { ok(CHARACTER_TEXTS.hu[id]); ok(CHARACTER_TEXTS.en[id]); }
  eq(reg.abilities.get('track').tags[0], 'NYOMKÖVETÉS'); eq(reg.abilities.get('rope').tags[0], 'KÖTÉL'); eq(reg.abilities.get('shoot').resource, 'focus');
});

test('ranger: rejtett nyomok – létrehozás, hibás elem kiesik, feltárás sugárral, tartós, version', () => {
  const hs = createHiddens([{ id: 'a', x: 100, y: 100 }, { id: 'a', x: 110, y: 100, r: 4, kind: 'path' }, { id: 'b', x: NaN, y: 0 }, null, 7, { id: 'c', x: 0, y: 0, r: 0 }, { id: 5, x: 500, y: 0 }]);
  eq(hs.items.size, 2); eq(hs.items.get('a').x, 110); eq(hs.items.get('a').kind, 'path'); ok(hs.items.get('5'));
  eq(revealHidden(hs, 300, 300, 50).length, 0); eq(hs.version, 0);
  eq(revealHidden(hs, 110, 125, 25).length, 1); eq(hs.version, 1); eq(revealHidden(hs, 110, 125, 25).length, 0); eq(hs.version, 1);
  eq(hiddenFound(hs).map(h => h.id).join(), 'a'); eq(revealHidden(hs, 480, 0, 5).length, 1); // a nyom saját sugara (16) is számít
  eq(revealHidden(hs, NaN, 0, 5).length + revealHidden(hs, 0, 0, -1).length + revealHidden(null, 0, 0, 1).length, 0);
});

test('ranger: nyomkövetés – feltárja a hatókörben lévő nyomot (tartós), költség + cooldown, a távoli kimarad', () => {
  const m = mk(); const r = castSlot(m.sys, m.players, 0, 0, { facing: right });
  ok(r.ok); eq(m.players[0].focus, 85); eq(r.event.tags[0], 'NYOMKÖVETÉS');
  ok(m.hiddens.found.has('h1')); ok(!m.hiddens.found.has('h2')); eq(m.w.stats.found, 1);
  eq(castSlot(m.sys, m.players, 0, 0).reason, 'busy'); wait(m.sys, m.players, 0.3); eq(castSlot(m.sys, m.players, 0, 0).reason, 'cooldown');
  wait(m.sys, m.players, 5); m.players[0].x = 650; // már másik helyen: a h2 is előkerül
  ok(castSlot(m.sys, m.players, 0, 0).ok); ok(m.hiddens.found.has('h2')); eq(hiddenFound(m.hiddens).length, 2);
});

test('ranger: nyomkövetés – nincs nyom/ellenfél (vagy már mind feltárt/jelölt) -> vétó: nincs költség, nincs cooldown', () => {
  const m = mk({ hidden: [{ id: 'far', x: 900, y: 900 }] });
  const r = castSlot(m.sys, m.players, 0, 0, { facing: right }); eq(r.reason, 'blocked'); eq(m.players[0].focus, 100); wait(m.sys, m.players, 0.3);
  ok(!m.sys.players[0].cd.has('track'));
  const m2 = mk({ hidden: [{ id: 'h', x: 120, y: 100 }], enemies: [{ x: 160, y: 100, hp: 10 }] });
  ok(castSlot(m2.sys, m2.players, 0, 0, { facing: right }).ok); wait(m2.sys, m2.players, 5);
  eq(castSlot(m2.sys, m2.players, 0, 0, { facing: right }).reason, 'blocked'); // a nyom feltárt, az ellenfél frissen jelölt
});

test('ranger: jelölés – az ellenfél e.tracked = 20 mp, fogy, lejár; csak a sugáron belüli; újítás csak 50% alatt', () => {
  const near = { x: 180, y: 100, hp: 10 }, far = { x: 600, y: 100, hp: 10 }, m = mk({ enemies: [near, far] });
  ok(cast(m, 'track').ok); eq(near.tracked, 20); eq(far.tracked, undefined); ok(isTracked(m.w, near)); eq(m.w.stats.marked, 1);
  eq(stepRanger(m.w, 5).unmarked.length, 0); eq(near.tracked, 15);
  wait(m.sys, m.players, 5); m.hiddens.found.add('h1'); eq(cast(m, 'track').reason, 'blocked'); eq(near.tracked, 15); // 15 > 10: még tart
  stepRanger(m.w, 6); eq(near.tracked, 9); wait(m.sys, m.players, 5);
  ok(cast(m, 'track').ok); eq(near.tracked, 20); // 9 <= 10: újítható
  eq(stepRanger(m.w, 25).unmarked[0], near); eq(near.tracked, 0); ok(!isTracked(m.w, near));
});

test('ranger: kötél – a legközelebbi horgonyra vet, költség, ropeActive/ropeLinks, vétó (nincs horgony / ugyanaz még tart)', () => {
  const m = mk(); const r = castSlot(m.sys, m.players, 0, 1, { facing: right });
  ok(r.ok); eq(m.players[0].focus, 90); eq(r.event.tags[0], 'KÖTÉL'); ok(ropeActive(m.w, 'a1')); ok(!ropeActive(m.w, 'a2'));
  const l = ropeLinks(m.w); eq(l.length, 1); eq(l[0].id, 'a1'); eq(l[0].ax, 176); eq(l[0].ay, 100); eq(l[0].left, 45);
  wait(m.sys, m.players, 5); eq(cast(m, 'rope').reason, 'blocked'); eq(m.players[0].focus, 100); // ugyanaz még tart
  eq(cast(m, 'rope', 0, { x: 0, y: -1 }).reason, 'blocked'); // nincs horgony arra
  eq(hitAnchor(m.anchors, 100, 100, 100, 100 + 192, 16), null); eq(hitAnchor(m.anchors, NaN, 0, 1, 1), null); eq(hitAnchor(null, 0, 0, 1, 1), null);
});

test('ranger: kötél – az új dobás a régit váltja, két játékos külön kötele, lejár, elszakad ha túl messzire húzzák', () => {
  const m = mk({ anchors: [{ id: 'a1', x: 160, y: 84, w: 32, h: 32 }, { id: 'a2', x: 84, y: 160, w: 32, h: 32 }] });
  ok(cast(m, 'rope').ok); wait(m.sys, m.players, 5); ok(cast(m, 'rope', 0, { x: 0, y: 1 }).ok);
  ok(!ropeActive(m.w, 'a1')); ok(ropeActive(m.w, 'a2')); eq(m.w.ropes.size, 1);
  m.players[1].x = 100; m.players[1].y = 100; ok(cast(m, 'rope', 1, { x: 0, y: 1 }).ok); eq(m.w.ropes.size, 2); // a 2. játékosnak saját kötele van
  eq(stepRanger(m.w, 46).released.join(), '0,1'); ok(!ropeActive(m.w, 'a2'));
  wait(m.sys, m.players, 5); ok(cast(m, 'rope').ok); m.players[0].x = 100 + 6 * 32 * 1.5 - 60; eq(stepRanger(m.w, 0.1).snapped.length, 0); // 228 px a horgonytól: még bírja
  m.players[0].x = 100 + 400; eq(stepRanger(m.w, 0.1).snapped.join(), '0'); ok(!ropeActive(m.w, 'a1')); eq(m.w.stats.snapped, 1);
});

test('ranger: lövés – az első ellenfelet találja a vonalban, sebzés, költség, nem a sávon kívülit / hatótávon túlit / mögöttit', () => {
  const e1 = { x: 200, y: 104, hp: 20 }, e2 = { x: 260, y: 100, hp: 20 }, off = { x: 150, y: 140, hp: 20 }, back = { x: 40, y: 100, hp: 20 }, far = { x: 400, y: 100, hp: 20 };
  const m = mk({ enemies: [e2, e1, off, back, far] }); const r = cast(m, 'shoot');
  ok(r.ok); eq(e1.hp, 14); eq(e2.hp, 20); eq(off.hp, 20); eq(back.hp, 20); eq(far.hp, 20); eq(m.players[0].focus, 92); eq(m.w.stats.hits, 1);
  const n1 = { x: 200, y: 100, hp: 20 }, n2 = { x: 260, y: 100, hp: 20 }, mo = mk({ enemies: [n1, n2] }); ok(cast(mo, 'shoot').ok); eq(n1.hp, 14); eq(n2.hp, 20); // sorrendtől független: a legközelebbi
  const m2 = mk({ enemies: [{ x: 400, y: 100, hp: 5 }, { x: 150, y: 140, hp: 5 }] }); eq(cast(m2, 'shoot').reason, 'blocked'); eq(m2.players[0].focus, 100);
  const dead = { x: 150, y: 100, hp: 5 }, m3 = mk({ enemies: [dead] }); ok(cast(m3, 'shoot').ok); eq(dead.hp, 0); eq(m3.w.effects.at(-1).dead, true);
});

test('ranger: lövés – a fal megállítja (env.solid), a jelölt célpont +25%-ot kap, a halott jelölése törlődik', () => {
  const e = { x: 260, y: 100, hp: 100 }, m = mk({ enemies: [e], env: { solid: (x, y) => x >= 180 && x < 212 } });
  eq(cast(m, 'shoot').reason, 'blocked'); eq(e.hp, 100); eq(m.players[0].focus, 100);
  const m2 = mk({ enemies: [e], env: { solid: (x, y) => x >= 400 } }); ok(cast(m2, 'shoot').ok); eq(e.hp, 94); wait(m2.sys, m2.players, 5);
  ok(cast(m2, 'track').ok); eq(e.tracked, 20); wait(m2.sys, m2.players, 5); ok(cast(m2, 'shoot').ok); eq(e.hp, 86.5); eq(m2.w.effects.at(-1).bonus, true);
  const k = { x: 150, y: 100, hp: 5 }, m3 = mk({ enemies: [k] }); ok(cast(m3, 'track').ok); wait(m3.sys, m3.players, 5); ok(cast(m3, 'shoot').ok); ok(!isTracked(m3.w, k));
});

test('ranger: fókusz – kevés fókusz -> resource, költés után késleltetett gyors regeneráció, a mana/stamina érintetlen', () => {
  const m = mk({ enemies: [{ x: 160, y: 100, hp: 1e6 }] }); const p = m.players[0]; p.focus = 9; p.mana = 50; p.stamina = 60;
  ok(cast(m, 'shoot').ok); eq(p.focus, 1); wait(m.sys, m.players, 1); eq(cast(m, 'shoot').reason, 'resource');
  p.focus = 100; ok(cast(m, 'shoot').ok); eq(p.focus, 92); stepAbilities(m.sys, m.players, [{}, {}], [], 0.5); eq(p.focus, 92); // késleltetés
  stepAbilities(m.sys, m.players, [{}, {}], [], 0.5); eq(p.focus, 97); eq(p.mana, 58); eq(p.stamina, 60); // a mana a saját szabályai szerint regenerál (4/mp), a stamina nem változik
});

test('ranger: a három kaszt egymás mellett – külön kezelők, detach csak a vadőrét veszi le, hibás env / dt nem dob', () => {
  const m = mk(); const wr = attachWarrior(m.sys, { players: m.players, breakables: createBreakables([]) }), wz = attachWizard(m.sys, { players: m.players });
  for (const id of ['track', 'rope', 'shoot', 'wallbreak', 'shove', 'strike', 'light', 'ignite', 'freeze']) ok(m.sys.handlers.has(id), id);
  m.w.detach(); for (const id of ['track', 'rope', 'shoot']) ok(!m.sys.handlers.has(id)); ok(m.sys.handlers.has('light') && m.sys.handlers.has('wallbreak')); void wr; void wz;
  const sys2 = createAbilitySystem({ reg: createCharacterRegistry() });
  for (const env of [null, undefined, 5, 'x', { enemies: 7, players: 3, hiddens: 1, anchors: 'x', solid: 4, mark: 2 }]) { const w = attachRanger(sys2, env); ok(w); eq(stepRanger(w, 1).snapped.length, 0); eq(ropeLinks(w).length, 0); }
  for (const dt of [NaN, -1, 0, Infinity, 'x', null]) eq(stepRanger(m.w, dt).unmarked.length, 0);
  eq(stepRanger(null, 1).released.length, 0); eq(ropeActive(null, 'a'), false); eq(isTracked(null, {}), false);
  const q = mk({ env: { enemies: () => { throw new Error('rossz'); } } }); eq(cast(q, 'shoot').reason, 'blocked'); eq(cast(q, 'track').ok, true); // a nyom feltárul, a hook hibája nem dob
});

test('ranger: állapot (rejtett nyomok) – mentés-alak, atomi visszaállítás, hibás bemenet', () => {
  const m = mk(); ok(cast(m, 'track').ok); const st = huntState(m.hiddens); eq(st.v, 1); eq(st.found.join(), 'h1');
  const f = createHiddens([{ id: 'h1', x: 200, y: 100 }, { id: 'h2', x: 700, y: 100 }]); ok(restoreHiddens(f, st)); eq(f.version, 1); ok(f.found.has('h1') && !f.found.has('h2')); ok(restoreHiddens(f, st)); eq(f.version, 1);
  const g = createHiddens([{ id: 'x', x: 0, y: 0 }]);
  for (const bad of [null, {}, { v: 2, found: [] }, { v: 1, found: 'x' }, { v: 1, found: ['a', {}] }, { v: 1, found: [null] }]) { eq(restoreHiddens(g, bad), false); eq(g.found.size, 0); }
  eq(restoreHiddens(null, st), false);
});

test('ranger: 6000 kockás fuzz – nincs NaN, fókusz/hp korlátos, determinizmus, a kötél sosem él a hatókör 1,5x-én túl', () => {
  const run = () => {
    const rnd = mulberry32(5757), en = Array.from({ length: 8 }, (_, i) => ({ x: 60 + rnd() * 700, y: 60 + rnd() * 400, hp: 40 }));
    const m = mk({ enemies: en, hidden: Array.from({ length: 6 }, (_, i) => ({ id: 'n' + i, x: 50 + rnd() * 800, y: 50 + rnd() * 500 })), anchors: [{ id: 'a1', x: 300, y: 200, w: 32, h: 32 }, { id: 'a2', x: 500, y: 300, w: 32, h: 32 }], env: { solid: (x, y) => ((x / 64) | 0) % 5 === 3 } });
    setAbilitySlots(m.sys, 1, ['shoot', 'track']);
    const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
    let sum = 0;
    for (let f = 0; f < 6000; f++) {
      for (const p of m.players) { p.x = Math.max(0, Math.min(900, p.x + (rnd() - 0.5) * 12)); p.y = Math.max(0, Math.min(540, p.y + (rnd() - 0.5) * 12)); }
      const inp = [0, 1].map(() => ({ ability1: rnd() < 0.15, ability2: rnd() < 0.15 }));
      stepAbilities(m.sys, m.players, inp, [dirs[(rnd() * 4) | 0], dirs[(rnd() * 4) | 0]], 1 / 60);
      stepRanger(m.w, 1 / 60);
      for (const p of m.players) { assert(Number.isFinite(p.focus) && p.focus >= 0 && p.focus <= p.focusMax, 'fókusz'); }
      for (const e of en) { assert(Number.isFinite(e.hp) && e.hp >= 0 && e.hp <= 40, 'hp'); assert(e.tracked === undefined || (Number.isFinite(e.tracked) && e.tracked >= 0 && e.tracked <= 20), 'jelölés'); }
      for (const l of ropeLinks(m.w)) assert(Math.hypot(l.px - l.ax, l.py - l.ay) <= 6 * 32 * RANGER_CONFIG.ropeSlack + 1e-6, 'kötél-hossz');
    }
    sum = en.reduce((a, e) => a + e.hp, 0) + m.hiddens.found.size * 1000 + m.w.stats.hits * 7 + m.w.stats.ropes * 13 + m.w.stats.snapped * 17 + m.w.stats.marked * 19 + m.players[0].focus + m.players[1].focus;
    assert(m.w.stats.tracks + m.w.stats.ropes + m.w.stats.shots > 0, 'volt hatás');
    return sum;
  };
  const a = run(), b = run(); assert(Number.isFinite(a), 'NaN'); eq(a, b, 'determinizmus');
});
