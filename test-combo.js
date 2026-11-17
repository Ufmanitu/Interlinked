// S061 tesztek: kombó-képességek – adat/validáció, tűz + szél (két játékos, bármilyen sorrend, ablak, távolság, cooldown), fagy + vízfelszín (társ-feltétel, jégtábla), szél-vétó, hibás hookok, determinizmus.
import { test, assert, eq } from './test-index.js';
import { createPlayer } from './game-player.js';
import { createI18n, addTexts, auditTexts } from './i18n.js';
import { COMBO_DEFS, COMBO_TEXTS, COMBO_ELEMENTS } from './data-combos.js';
import { ABILITY_DEFS, CLASS_DEFS } from './data-character.js';
import { createCharacterRegistry, collectTexts, auditRegistryTexts } from './game-registry.js';
import { createAbilitySystem, castAbility, stepAbilities } from './game-ability.js';
import { attachWizard, stepWizard, createFlammables } from './game-wizard.js';
import { mulberry32 } from './world-noise.js';
import { COMBO_CONFIG, validateComboDef, createComboRegistry, auditCombos, elementsOfTags, igniteFlammablesIn, attachCombo, onCombo, stepCombo, patchAt, iceAt, comboView } from './game-combo.js';

const ok = v => assert(v, 'ok');
const R = { x: 1, y: 0 }, L = { x: -1, y: 0 };
const water = (x, y) => (x >= 150 && x <= 300 && y >= 40 && y <= 160 ? 'water' : null);
// P0 varázsló (100,100), P1 vadőr (300,100); wizard + combo egy rendszeren.
const mk = (o = {}) => {
  const reg = createCharacterRegistry(), sys = createAbilitySystem({ reg });
  const players = [createPlayer(0, 100, 100), createPlayer(1, o.p1 || 300, o.p1y || 100)];
  players[0].class = 'wizard'; players[1].class = 'ranger';
  const enemies = o.enemies || [], flammables = createFlammables(o.fl || []);
  const en = (org, r) => enemies.filter(e => Math.hypot(e.x - org.x, e.y - org.y) <= r);
  const wiz = attachWizard(sys, { players, flammables, enemies: en });
  const combo = attachCombo(sys, { players, flammables, enemies: en, wizard: wiz, surface: water, ...(o.env || {}) });
  const events = []; onCombo(combo, ev => events.push(ev));
  return { reg, sys, players, enemies, flammables, wiz, combo, events };
};
const cast = (U, i, id, f = R) => castAbility(U.sys, U.players, i, id, { facing: f });
const wait = (U, s) => { stepAbilities(U.sys, U.players, [{}, {}], [], s); stepWizard(U.wiz, s); return stepCombo(U.combo, s); };

test('combo: adat – 2 érvényes reakció, a szél forrása a Vadőr gust (SZÉL), élő audit hibátlan, HU/EN szövegek', () => {
  const reg = createComboRegistry(); eq(reg.errors.length, 0); eq(reg.dups.length, 0); eq(reg.reactions.size, 2);
  eq(reg.reactions.get('firestorm').kind, 'pair'); eq(reg.reactions.get('ice_sheet').kind, 'surface');
  assert(Object.isFrozen(reg.reactions.get('firestorm')) && Object.isFrozen(reg.reactions.get('firestorm').effect));
  const chars = createCharacterRegistry(); eq(chars.errors.length, 0);
  const g = chars.abilities.get('gust'); ok(g); eq(g.tags[0], 'SZÉL'); eq(g.target, 'direction'); eq(g.resource, 'focus');
  eq(chars.classes.get('ranger').abilities.join(), 'track,rope,shoot,gust'); assert(COMBO_ELEMENTS['SZÉL'] === 'wind');
  eq(auditCombos(reg, chars.abilities).join(), '');
  assert(auditCombos(reg, ABILITY_DEFS.filter(a => a.id !== 'gust')).includes('firestorm:nosource:wind'), 'forrás nélküli elem jelzett');
  eq(auditRegistryTexts(chars, collectTexts()).length, 0);
  const i = createI18n({ lang: 'hu', texts: {} }); addTexts(i, COMBO_TEXTS, ''); const a = auditTexts(i); ok(a.ok);
  for (const d of COMBO_DEFS) { ok(COMBO_TEXTS.hu['combo.' + d.id] && COMBO_TEXTS.en['combo.' + d.id] && COMBO_TEXTS.hu['combo.' + d.id + '.desc'] && COMBO_TEXTS.en['combo.' + d.id + '.desc']); }
  assert(CLASS_DEFS.length >= 4);
});

test('combo: validáció – hibás definíciók kiesnek, duplikátum felülír, elemek/felszín/hatás ellenőrzött, sosem dob', () => {
  const P = o => ({ id: 'x', kind: 'pair', elements: ['fire', 'wind'], effect: { kind: 'blast', radius: 2, damage: 1 }, ...o });
  ok(validateComboDef(P()).ok); eq(validateComboDef(P()).combo.window, 3); eq(validateComboDef(P()).combo.effect.at, 'fire');
  const bads = [null, 5, {}, P({ id: 'X' }), P({ id: '1a' }), P({ kind: 'trio' }), P({ elements: ['fire', 'fire'] }), P({ elements: ['fire', 'lava'] }), P({ elements: ['fire'] }), P({ window: 0 }), P({ window: 99 }), P({ range: -1 }),
    P({ cooldown: -1 }), P({ effect: null }), P({ effect: { kind: 'blast', radius: 0 } }), P({ effect: { kind: 'blast', radius: 2, damage: -1 } }), P({ effect: { kind: 'blast', radius: 2, burn: { dps: 'x', secs: 1 } } }),
    P({ effect: { kind: 'blast', radius: 2, at: 'frost' } }), P({ effect: { kind: 'patch', radius: 2, surface: 'lava', secs: 5 } }), P({ effect: { kind: 'patch', radius: 2, surface: 'ice', secs: 0 } }),
    { id: 's', kind: 'surface', element: 'frost', surface: 'lava', effect: { kind: 'patch', radius: 2, surface: 'ice', secs: 5 } }, { id: 's', kind: 'surface', element: 'frost', surface: 'water', partnerRange: 99, effect: { kind: 'patch', radius: 2, surface: 'ice', secs: 5 } },
    P({ effect: { kind: 'blast', radius: NaN } })];
  for (const b of bads) assert(!validateComboDef(b).ok, JSON.stringify(b));
  const r = createComboRegistry([P(), P({ id: 'y' }), P({ id: 'x', range: 7 }), { id: 'bad' }, null]);
  eq(r.reactions.size, 2); eq(r.reactions.get('x').range, 7); eq(r.dups.join(), 'x'); eq(r.errors.length, 2);
  eq(createComboRegistry('szemét').reactions.size, 0);
  eq(elementsOfTags(['ÉGETÉS', 'SZÉL', 'ÉGETÉS', 'X', 'constructor']).join(), 'fire,wind'); eq(elementsOfTags(null).length, 0);
});

test('combo: tűz + szél – egy-egy játékos képessége (varázsló gyújtás + vadőr széllöket) tűzvihart ad: sebzés, égés, éghető akadály; mindkét lenyomat elfogy', () => {
  const U = mk({ enemies: [{ x: 190, y: 100, hp: 50 }, { x: 230, y: 100, hp: 50 }, { x: 600, y: 600, hp: 50 }], fl: [{ id: 'bush', x: 200, y: 150, w: 32, h: 32 }, { id: 'far', x: 900, y: 900, w: 32, h: 32 }] });
  const [e0, e1, far] = U.enemies;
  ok(cast(U, 0, 'ignite').ok); eq(U.events.length, 0); eq(U.combo.imprints.length, 1); eq(U.combo.imprints[0].element, 'fire'); eq(e0.hp, 46); // csak a gyújtás sebzése (4)
  eq(U.flammables.items.get('bush').lit, false);
  ok(cast(U, 1, 'gust', L).ok);
  eq(U.events.length, 1); const ev = U.events[0]; eq(ev.id, 'firestorm'); eq(ev.players.join(), '0,1'); eq(U.combo.imprints.length, 0);
  assert(ev.result.hits >= 1 && ev.result.burned >= 1, 'találat + égés'); eq(ev.result.ignited.join(), 'bush'); eq(U.flammables.items.get('bush').lit, true); eq(U.flammables.items.get('far').lit, false);
  assert(e0.hp <= 40, 'kombó-sebzés is érte: ' + e0.hp); eq(far.hp, 50); assert(U.wiz.burning.has(e0), 'a wizard égés-DoT-ja viszi');
  const hp = e0.hp; wait(U, 1); assert(e0.hp < hp, 'ég');
  eq(U.combo.stats.reactions, 1); assert(U.combo.cool.get('firestorm') > 0);
  assert(comboView(U.combo).cooldowns.firestorm > 0);
  assert(e1.x === 230 - 0 || e1.x < 230, 'a szél eltolta (balra)');
});

test('combo: sorrend – előbb a szél (ellenfelet tol), utána a láng is kombót ad; ugyanaz a játékos két képessége NEM; ablak és távolság számít; cooldown blokkol', () => {
  const mkE = () => mk({ enemies: [{ x: 230, y: 100, hp: 60 }] }); // a szél 40 px-szel balra tolja: 190-en a láng sávjában áll
  { const U = mkE(); ok(cast(U, 1, 'gust', L).ok); eq(U.combo.imprints[0].element, 'wind'); ok(cast(U, 0, 'ignite').ok); eq(U.events.length, 1); eq(U.events[0].id, 'firestorm'); eq(U.events[0].players.join(), '0,1'); } // a tűz-lenyomat helyén (az ignite az új cast)
  { const U = mkE(); U.enemies.push({ x: 150, y: 100, hp: 60 }); ok(cast(U, 0, 'ignite').ok); wait(U, 3.5); eq(U.combo.imprints.length, 0, 'lejárt'); ok(cast(U, 1, 'gust', L).ok); eq(U.events.length, 0, 'ablakon kívül nincs kombó'); }
  { const U = mk({ enemies: [{ x: 150, y: 100, hp: 60 }, { x: 600, y: 100, hp: 60 }] }); ok(cast(U, 0, 'ignite').ok); U.players[1].x = 900; U.players[1].y = 100; // a gust vége (900-128) messze a lángtól
    const r = cast(U, 1, 'gust', L); assert(!r.ok && r.reason === 'blocked', 'nincs mit fújnia: vétó'); eq(U.events.length, 0); }
  { const U = mk({ enemies: [{ x: 150, y: 100, hp: 60 }, { x: 850, y: 100, hp: 60 }], p1: 900 }); ok(cast(U, 0, 'ignite').ok); ok(cast(U, 1, 'gust', L).ok, 'a gust a távoli ellenfélre elsül'); eq(U.events.length, 0, 'a két célpont > 5 tile: nincs kombó'); eq(U.combo.imprints.length, 2); }
  { const U = mk({ enemies: [{ x: 150, y: 100, hp: 60 }] }); ok(cast(U, 0, 'ignite').ok); U.players[0].class = 'ranger'; wait(U, 0.3); ok(cast(U, 0, 'gust', R).ok); eq(U.events.length, 0, 'azonos játékos nem párosít'); eq(U.combo.imprints.length, 2); }
  { const U = mk({ enemies: [{ x: 190, y: 100, hp: 400 }], env: { push: () => 0 } }); ok(cast(U, 0, 'ignite').ok); ok(cast(U, 1, 'gust', L).ok); eq(U.events.length, 1); wait(U, 4.1); // a gust cooldownja 4 mp, a reakcióé 6
    ok(cast(U, 0, 'ignite').ok); const r2 = cast(U, 1, 'gust', L); eq(r2.ok, true, 'a gust az ellenfél miatt elsül'); eq(U.events.length, 1, 'cooldown (6 mp) alatt nincs új kombó'); wait(U, 7); ok(cast(U, 0, 'ignite').ok); ok(cast(U, 1, 'gust', L).ok); eq(U.events.length, 2, 'cooldown után újra'); }
  { const U = mk({ enemies: [{ x: 250, y: 100, hp: 60 }] }); U.players[1].focus = 100; const f0 = U.players[1].focus; const r = cast(U, 1, 'gust', R); assert(!r.ok, 'a balra álló ellenfél nincs a sávban és nincs láng'); eq(U.players[1].focus, f0, 'vétó: nincs költség'); }
});

test('combo: fagy + vízfelszín – vízben álló ellenfél + a társ a közelben -> jégtábla (folt, fagy a körben); szárazon / távoli társ / hiányzó felszín nincs kombó', () => {
  const U = mk({ enemies: [{ x: 180, y: 100, hp: 40 }, { x: 215, y: 110, hp: 40 }, { x: 700, y: 100, hp: 40 }] });
  ok(cast(U, 0, 'freeze').ok); eq(U.events.length, 1); const ev = U.events[0]; eq(ev.id, 'ice_sheet'); eq(ev.players.join(), '0,1');
  eq(ev.result.frozen, 2); ok(ev.result.patch); ok(iceAt(U.combo, 180, 100)); ok(iceAt(U.combo, 215, 110)); ok(!iceAt(U.combo, 400, 100)); ok(!patchAt(U.combo, 180, 100, 'lava')); ok(!iceAt(U.combo, NaN, 0));
  assert(U.enemies[0].frozen >= 4 - 1e-9 && U.enemies[1].frozen >= 4 - 1e-9, 'a kombó 4 mp-re fagyaszt (a 3 mp-es fagyást meghosszabbítja)'); eq(U.enemies[2].frozen, undefined);
  assert(comboView(U.combo).patches.length === 1);
  wait(U, 19); ok(iceAt(U.combo, 180, 100)); const out = wait(U, 1.5); ok(!iceAt(U.combo, 180, 100)); eq(out.patches.length, 1);
  { const D = mk({ enemies: [{ x: 120, y: 100, hp: 40 }] }); ok(cast(D, 0, 'freeze').ok); eq(D.events.length, 0, 'szárazon nincs kombó'); eq(D.combo.imprints.length, 1); }
  { const F = mk({ enemies: [{ x: 180, y: 100, hp: 40 }], p1: 900, p1y: 900 }); ok(cast(F, 0, 'freeze').ok); eq(F.events.length, 0, 'a társ messze'); eq(F.combo.stats.blocked, 1); }
  { const N = mk({ enemies: [{ x: 180, y: 100, hp: 40 }], env: { surface: undefined } }); ok(cast(N, 0, 'freeze').ok); eq(N.events.length, 0, 'felszín-forrás nélkül nincs kombó'); }
});

test('combo: a szél önmagában tol, vétó a nincs-hatás esetén, detach leveszi a kezelőt és a figyelőt; hibás hookok nem dobnak', () => {
  { const U = mk({ enemies: [{ x: 250, y: 100, hp: 60 }] }); ok(cast(U, 1, 'gust', L).ok); eq(U.enemies[0].x, 210); eq(U.combo.stats.gusts, 1); }
  { const U = mk({ enemies: [{ x: 250, y: 100, hp: 60 }], env: { push: () => 7 } }); ok(cast(U, 1, 'gust', L).ok); eq(U.enemies[0].x, 250, 'az env.push veszi át'); }
  { const U = mk({ enemies: [] }); const r = cast(U, 1, 'gust', L); assert(!r.ok && r.reason === 'blocked'); }
  { const U = mk({ enemies: [{ x: 190, y: 100, hp: 50 }], fl: [{ id: 'b', x: 200, y: 150, w: 32, h: 32 }], env: { damage: () => { throw new Error('x'); }, burn: () => { throw new Error('y'); }, surface: () => { throw new Error('z'); } } });
    ok(cast(U, 0, 'ignite').ok); ok(cast(U, 1, 'gust', L).ok); eq(U.events.length, 1); eq(U.events[0].result.ignited.join(), 'b'); wait(U, 0.3); ok(cast(U, 0, 'freeze').ok);
    const Q = mk({ enemies: [{ x: 190, y: 100, hp: 50 }], env: { enemies: () => { throw new Error('q'); } } }); ok(cast(Q, 0, 'ignite').ok); ok(cast(Q, 1, 'gust', L).ok); eq(Q.events.length, 1); eq(Q.events[0].result.hits, 0); }
  { const U = mk({ enemies: [{ x: 190, y: 100, hp: 50 }] }); U.combo.detach(); ok(cast(U, 0, 'ignite').ok); ok(cast(U, 1, 'gust', L).ok); eq(U.events.length, 0); eq(U.combo.imprints.length, 0); }
  { const U = mk({}); for (const bad of [null, undefined, {}, { type: 'cast' }, { type: 'cast', player: 5, tags: ['SZÉL'] }, { type: 'fail' }, { type: 'cast', player: 0, tags: 'x' }]) { U.sys.listeners.forEach(f => f(bad)); } eq(U.combo.imprints.length, 0); eq(U.combo.lastError, null); }
  eq(stepCombo(null, 1).expired.length, 0); eq(stepCombo(mk({}).combo, NaN).patches.length, 0); eq(igniteFlammablesIn(null, 0, 0, 1).length, 0);
  const fs = createFlammables([{ id: 'a', x: 0, y: 0, w: 32, h: 32 }, { id: 'b', x: 100, y: 0, w: 32, h: 32 }]); eq(igniteFlammablesIn(fs, 50, 16, 20).join(), 'a'); eq(igniteFlammablesIn(fs, 50, 16, 60).join(), 'b'); eq(igniteFlammablesIn(fs, 50, 16, 60).length, 0);
});

test('combo: saját égés/fagy (wizard nélkül) – a tűzvihar DoT-ja és a jégtábla fagya az stepCombo-ban fut, a halott kiesik', () => {
  const reg = createCharacterRegistry(), sys = createAbilitySystem({ reg }), players = [createPlayer(0, 100, 100), createPlayer(1, 300, 100)];
  players[0].class = 'wizard'; players[1].class = 'ranger';
  const enemies = [{ x: 190, y: 100, hp: 11 }], en = (o, r) => enemies.filter(e => Math.hypot(e.x - o.x, e.y - o.y) <= r);
  const combo = attachCombo(sys, { players, enemies: en, surface: () => null, cfg: { handlers: ['gust'] } }); const evs = []; onCombo(combo, e => evs.push(e));
  // wizard nincs: az ignite kezelő hiányzik -> elfogadott, a cast esemény elég a lenyomathoz
  ok(castAbility(sys, players, 0, 'ignite', { facing: R }).ok); ok(castAbility(sys, players, 1, 'gust', { facing: L }).ok); eq(evs.length, 1);
  assert(combo.burning.has(enemies[0]), 'saját égés'); let dead = 0; for (let k = 0; k < 40; k++) dead += stepCombo(combo, 0.25).dead.length;
  eq(enemies[0].hp, 0); eq(dead, 1); eq(combo.burning.size, 0);
});

test('combo: 6000 kockás fuzz – véletlen képességek/helyek, invariánsok (nincs NaN, korlátos lista), determinizmus', () => {
  const run = seed => {
    const rnd = mulberry32(seed);
    const enemies = Array.from({ length: 8 }, (_, i) => ({ x: 120 + i * 25, y: 80 + (i % 3) * 20, hp: 500 }));
    const U = mk({ enemies, fl: [{ id: 'f1', x: 200, y: 150, w: 32, h: 32 }, { id: 'f2', x: 260, y: 60, w: 32, h: 32 }] });
    const ids = ['ignite', 'gust', 'freeze', 'light', 'track'], dirs = [R, L, { x: 0, y: 1 }, { x: rnd() - .5, y: rnd() - .5 }, null];
    for (let f = 0; f < 6000; f++) {
      U.players[0].x = 90 + rnd() * 60; U.players[0].y = 80 + rnd() * 50; U.players[1].x = 250 + rnd() * 100; U.players[1].y = 60 + rnd() * 80;
      for (const p of U.players) { p.mana = 100; p.focus = 100; }
      const i = rnd() < .5 ? 0 : 1; castAbility(U.sys, U.players, i, ids[Math.floor(rnd() * ids.length)], { facing: dirs[Math.floor(rnd() * dirs.length)] });
      wait(U, 1 / 12);
      for (const e of U.enemies) { assert(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.hp) && e.hp >= 0, 'ellenfél'); e.hp = Math.max(e.hp, 300); }
      assert(U.combo.imprints.length <= COMBO_CONFIG.maxImprints && U.combo.patches.length <= COMBO_CONFIG.maxPatches && U.combo.events.length <= COMBO_CONFIG.maxEvents, 'korlátok');
      for (const im of U.combo.imprints) assert(Number.isFinite(im.x) && Number.isFinite(im.y), 'lenyomat');
    }
    return JSON.stringify([U.combo.stats, U.enemies.map(e => [Math.round(e.x), Math.round(e.hp)]), U.events.length, U.sys.stats]);
  };
  const a = run(61), b = run(61); eq(a, b); const st = JSON.parse(a)[0]; assert(st.reactions > 0 && st.imprints > 0, 'volt kombó: ' + a.slice(0, 120));
});
