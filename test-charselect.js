// test-charselect.js (S063): karakterválasztó – ráállítás (minden faj × kaszt), menet, mentett választás, nézet-modell, szövegek, rajz, smoke.
// Importja: test-index, game-charselect, render-charselect, game-registry, game-ability, game-player, i18n. Node-ban fut (DOM nélkül).
import { test, assert, eq as eqStrict } from './test-index.js';
import { CHARSELECT_TEXTS, CHARSELECT_CONFIG, PASSIVE_SHOW, applyCharacter, allCombos, loadChoicePrefs, saveChoicePrefs, createCharSelect, selection, stepCharSelect, finishCharSelect, charView } from './game-charselect.js';
import { drawCharSelect, drawPreview, wrapText, panelRect, CHARSEL_STYLE } from './render-charselect.js';
import { createCharacterRegistry, collectTexts } from './game-registry.js';
import { createAbilitySystem, slotAbilities } from './game-ability.js';
import { createPlayer, PLAYER_SPEED } from './game-player.js';

const eq = (a, b, m = '') => {
  if ((a && typeof a === 'object') || (b && typeof b === 'object')) assert(JSON.stringify(a) === JSON.stringify(b), `${m} várt: ${JSON.stringify(b)}, kapott: ${JSON.stringify(a)}`);
  else eqStrict(a, b, m);
};
const reg = createCharacterRegistry();
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const fakeCtx = () => {
  const c = { calls: 0, texts: [], font: '10px monospace', measureText: s => ({ width: String(s).length * 6 }), fillText: (s) => { c.texts.push(String(s)); c.calls++; } };
  return new Proxy(c, { get: (o, k) => (k in o ? o[k] : (...a) => { o.calls++; }), set: (o, k, v) => { o[k] = v; return true; } });
};
const tr = (k, p) => k + (p ? JSON.stringify(p) : '');
const press = { interactPressed: true }, back = { menuPressed: true }, down = { y: 1 }, up = { y: -1 };
const step = (cs, a = {}, b = {}, dt = 1 / 60) => stepCharSelect(cs, [a, b], dt);
const release = cs => { step(cs); step(cs); }; // semleges kocka: a "tartás" (hold) feloldása
const params = s => (String(s).match(/\{(\w+)\}/g) || []).sort().join();

test('charselect: szövegek HU/EN azonos kulcsokkal és paraméterekkel, minden kulcs létezik', () => {
  eq(Object.keys(CHARSELECT_TEXTS.hu).sort(), Object.keys(CHARSELECT_TEXTS.en).sort());
  for (const k of Object.keys(CHARSELECT_TEXTS.hu)) { assert(CHARSELECT_TEXTS.hu[k] && CHARSELECT_TEXTS.en[k], 'üres ' + k); eq(params(CHARSELECT_TEXTS.hu[k]), params(CHARSELECT_TEXTS.en[k]), k); }
  for (const id of Object.keys(PASSIVE_SHOW)) assert(CHARSELECT_TEXTS.hu['passive.' + id], 'passzív szöveg ' + id);
  for (const r of ['mana', 'stamina', 'focus', 'none']) assert(CHARSELECT_TEXTS.hu['res.' + r], 'erőforrás szöveg ' + r);
  for (const s of ['race', 'class', 'ready']) { assert(CHARSELECT_TEXTS.hu['stage.' + s] && CHARSELECT_TEXTS.hu['hint.' + s], 'szakasz szöveg ' + s); }
});

test('charselect: minden faj × kaszt kombináció ráállítható (3 × 4 = 12), a két gomb kijelölt képességekre mutat', () => {
  const combos = allCombos(reg);
  eq(combos.length, reg.races.size * reg.classes.size);
  eq(combos.length, 12);
  const sys = createAbilitySystem({ reg });
  for (const c of combos) {
    const p = createPlayer(0, 0, 0);
    assert(applyCharacter(reg, p, c.race, c.cls), 'ráállítás ' + c.race + '/' + c.cls);
    eq(p.race, c.race); eq(p.class, c.cls);
    const r = reg.races.get(c.race), k = reg.classes.get(c.cls);
    assert(Math.abs(p.weight - r.weight) < 1e-9 && Math.abs(p.speed - PLAYER_SPEED * r.speed) < 1e-9, 'stat ' + c.race);
    const [a, b] = slotAbilities(sys, 0, p);
    assert(a === k.abilities[0] && b === k.abilities[1] && a && b, 'gombok ' + c.cls);
    for (const id of k.abilities) assert(reg.abilities.has(id), 'képesség létezik ' + id);
  }
});

test('charselect: a kaszt cseréje nem rontja el a fajt és fordítva; ismeretlen faj/kaszt/játékos -> false, érintetlen', () => {
  const p = createPlayer(0, 5, 6);
  assert(applyCharacter(reg, p, 'orc', 'healer'));
  assert(applyCharacter(reg, p, 'orc', 'warrior'));
  eq(p.race, 'orc'); eq(p.class, 'warrior');
  const snap = JSON.stringify(p);
  for (const [r, c] of [['troll', 'warrior'], ['elf', 'bard'], [null, 'warrior'], ['elf', undefined], [{}, []]]) { assert(!applyCharacter(reg, p, r, c), 'elutasítva'); eq(JSON.stringify(p), snap, 'érintetlen'); }
  assert(!applyCharacter(reg, null, 'elf', 'wizard') && !applyCharacter(null, p, 'elf', 'wizard') && !applyCharacter(reg, 7, 'elf', 'wizard'));
  eq(JSON.stringify(p), snap);
});

test('charselect: kiinduló állapot, választás fel/le (körbefordul), tovább, vissza', () => {
  const cs = createCharSelect(reg);
  eq(cs.races.length, 3); eq(cs.classes.length, 4); assert(!cs.done);
  eq(selection(cs, 0), { race: 'dwarf', cls: 'warrior' }); eq(selection(cs, 1), { race: 'elf', cls: 'wizard' });
  step(cs, down); eq(selection(cs, 0).race, 'elf'); eq(selection(cs, 1).race, 'elf', 'a másik játékos nem mozdul');
  release(cs); step(cs, up); eq(selection(cs, 0).race, 'dwarf'); release(cs);
  step(cs, up); eq(selection(cs, 0).race, 'orc', 'körbefordul visszafelé'); release(cs);
  step(cs, down); eq(selection(cs, 0).race, 'dwarf', 'körbefordul előre'); release(cs);
  eq(cs.players[0].stage, 'race');
  const ev = step(cs, press); eq(cs.players[0].stage, 'class'); eq(ev[0].type, 'stage');
  step(cs, down); eq(selection(cs, 0), { race: 'dwarf', cls: 'warrior' }, 'szakaszváltás után a tartás nem léptet'); release(cs);
  step(cs, down); eq(selection(cs, 0), { race: 'dwarf', cls: 'wizard' }, 'a kaszt-lista mozdul, a faj nem'); release(cs);
  step(cs, back); eq(cs.players[0].stage, 'race', 'menü: vissza'); step(cs, back); eq(cs.players[0].stage, 'race', 'fajnál nincs tovább vissza');
});

test('charselect: a tartott irány ismétlődik (késleltetés + ráta), váltás után a tartás nem folytatódik át a következő szakaszba', () => {
  const cs = createCharSelect(reg);
  const dt = 1 / 60; let moves = 0, prev = selection(cs, 0).race;
  for (let k = 0; k < 120; k++) { step(cs, down, {}, dt); const r = selection(cs, 0).race; if (r !== prev) { moves++; prev = r; } }
  assert(moves >= 12 && moves <= 16, 'ismétlődés ~ ~ 2 + (2 - 0.3) / 0.12 = ' + moves);
  const cs2 = createCharSelect(reg);
  step(cs2, { y: 1, interactPressed: true }); eq(cs2.players[0].stage, 'class');
  const before = selection(cs2, 0).cls; step(cs2, down); step(cs2, down); eq(selection(cs2, 0).cls, before, 'tartás alatt nincs léptetés');
});

test('charselect: mindketten készen -> done; amíg a társ nem kész, a módosítás lehetséges', () => {
  const cs = createCharSelect(reg);
  step(cs, press, press); step(cs, press); // P1 kész, P2 kaszt-szakaszban
  eq(cs.players[0].stage, 'ready'); assert(!cs.done, 'a társ még nem kész'); eq(cs.players[1].stage, 'class');
  release(cs); step(cs, back); eq(cs.players[0].stage, 'class', 'módosít'); release(cs);
  step(cs, press); eq(cs.players[0].stage, 'ready'); release(cs);
  const ev = step(cs, {}, press); assert(cs.done, 'mindketten kész'); assert(ev.some(e => e.type === 'done'));
  assert(stepCharSelect(cs, [press, press], 0.1).length === 0 && cs.done, 'kész után nincs több esemény');
});

test('charselect: finish – ráállítja a választást mindkét játékosra és elmenti; hibás állapotnál semmi nem változik', () => {
  const st = mem(), cs = createCharSelect(reg, { storage: st });
  step(cs, down, { y: -1 }); release(cs);
  step(cs, press, press); release(cs); step(cs, down, up); release(cs); step(cs, press, press);
  assert(cs.done);
  const ps = [createPlayer(0, 0, 0), createPlayer(1, 0, 0)];
  assert(finishCharSelect(cs, ps));
  eq(ps[0].race, 'elf'); eq(ps[0].class, 'wizard'); eq(ps[1].race, 'dwarf'); eq(ps[1].class, 'warrior', 'P2: faj: tünde -> fel -> törpe; kaszt: varázsló -> fel -> harcos');
  const saved = JSON.parse(st.getItem(CHARSELECT_CONFIG.storageKey));
  eq(saved.p[0], { race: 'elf', cls: 'wizard' }); eq(saved.p[1], { race: 'dwarf', cls: 'warrior' });
  const cs2 = createCharSelect(reg, { storage: st });
  eq(selection(cs2, 0), { race: 'elf', cls: 'wizard' }, 'a mentett választás az előre kijelölt'); eq(selection(cs2, 1), { race: 'dwarf', cls: 'warrior' });
  const bad = [createPlayer(0, 0, 0), 5], snap = JSON.stringify(bad[0]);
  assert(!finishCharSelect(cs, bad)); eq(JSON.stringify(bad[0]), snap, 'hibás társ -> a másik sem változik');
  const empty = createCharSelect({ races: new Map(), classes: new Map() });
  assert(!finishCharSelect(empty, [createPlayer(0, 0, 0), createPlayer(1, 0, 0)]));
  assert(!finishCharSelect(cs, [ps[0]]) && !finishCharSelect(null, ps) && !finishCharSelect(cs, null));
});

test('charselect: mentett választás – szemét, ismeretlen azonosító, hibázó tároló nem dob és alapértékre esik', () => {
  const R = ['dwarf', 'elf', 'orc'], C = ['warrior', 'wizard', 'ranger', 'healer'];
  const def = [{ race: 0, cls: 0 }, { race: 1, cls: 1 }];
  for (const raw of ['{', 'null', '5', '{"v":2,"p":[]}', '{"v":1,"p":"x"}', '{"v":1,"p":[null,7]}', '{"v":1,"p":[{"race":"troll","cls":"bard"}]}']) {
    const st = { getItem: () => raw };
    eq(loadChoicePrefs(st, R, C), def, raw);
  }
  eq(loadChoicePrefs({ getItem: () => { throw new Error('x'); } }, R, C), def); eq(loadChoicePrefs(null, R, C), def);
  eq(loadChoicePrefs({ getItem: () => '{"v":1,"p":[{"race":"orc","cls":"troll"}]}' }, R, C)[0], { race: 2, cls: 0 }, 'részleges: az érvényes mező érvényesül');
  assert(!saveChoicePrefs({ setItem: () => { throw new Error('tele'); } }, def) && !saveChoicePrefs(null, def) && !saveChoicePrefs(mem(), 'x'));
  const cs = createCharSelect(reg, { storage: { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } } });
  eq(selection(cs, 0), { race: 'dwarf', cls: 'warrior' });
  step(cs, press, press); step(cs, press, press); assert(cs.done);
  assert(finishCharSelect(cs, [createPlayer(0, 0, 0), createPlayer(1, 0, 0)]), 'hibázó tároló nem akadályozza');
});

test('charselect: üres regiszter -> kész (nincs beragadás), hibás bemenetek nem dobnak', () => {
  for (const r of [null, undefined, {}, { races: new Map(), classes: new Map() }]) { const cs = createCharSelect(r); assert(cs.done && cs.lastError === 'registry', 'üres'); eq(selection(cs, 0), null); eq(charView(cs, 0), null); }
  const cs = createCharSelect(reg);
  for (const raws of [undefined, null, [], [null, 5], ['x', []], [{ x: NaN, y: Infinity, interactPressed: 'igen' }, { menuPressed: 1 }]]) for (const dt of [undefined, NaN, -1, 0, 1e9]) stepCharSelect(cs, raws, dt);
  assert(!cs.done); eq(cs.players[0].stage, 'race');
  eq(stepCharSelect(null, [{}, {}], 0.1), []); eq(selection(null, 0), null); eq(charView(cs, 5), null); eq(charView(null, 0), null);
});

test('charselect: nézet-modell – minden faj × kaszt: leírás-kulcsok, tényleges statok, passzívok, képességek szöveggel együtt léteznek', () => {
  const texts = collectTexts();
  for (const c of allCombos(reg)) {
    const cs = createCharSelect(reg);
    cs.players[0].race = cs.races.indexOf(c.race); cs.players[0].cls = cs.classes.indexOf(c.cls);
    const v = charView(cs, 0);
    eq(v.race.id, c.race); eq(v.cls.id, c.cls);
    for (const l of ['hu', 'en']) {
      for (const k of [v.race.nameKey, v.race.descKey, v.cls.nameKey, v.cls.descKey, ...v.races.map(r => r.nameKey), ...v.classes.map(x => x.nameKey), ...v.cls.abilities.flatMap(a => [a.nameKey, a.descKey])]) assert(texts[l][k], l + ' hiányzó szöveg: ' + k);
      for (const p of v.race.passives) assert(CHARSELECT_TEXTS[l][p.key], 'passzív szöveg ' + p.key);
    }
    const r = reg.races.get(c.race), pull = r.passives.find(p => p.id === 'pull_power');
    assert(Math.abs(v.race.strength - r.strength * (1 + (pull ? pull.value : 0))) < 1e-9, 'a kiírt erő = a ráállított erő');
    const p = createPlayer(0, 0, 0); applyCharacter(reg, p, c.race, c.cls);
    assert(Math.abs(p.strength - v.race.strength) < 1e-9 && Math.abs(p.weight - v.race.weight) < 1e-9 && Math.abs(p.speed / PLAYER_SPEED - v.race.speed) < 1e-9, 'előnézet = valóság');
    eq(v.cls.abilities.filter(a => a.slot > 0).map(a => a.slot), [1, 2], 'két gomb-képesség');
    assert(v.cls.abilities.length >= 2 && v.race.passives.length >= 1, 'van leírni való');
  }
});

test('charselect: rajz – minden szakasz és kombináció kivételmentesen, a szöveg-tördelés a szélességen belül marad', () => {
  const cs = createCharSelect(reg);
  for (const c of allCombos(reg)) for (const stage of ['race', 'class', 'ready']) {
    cs.players[0].race = cs.races.indexOf(c.race); cs.players[0].cls = cs.classes.indexOf(c.cls); cs.players[0].stage = stage; cs.players[1].stage = 'class';
    const ctx = fakeCtx(); eq(drawCharSelect(ctx, cs, 960, 540, tr), 2); assert(ctx.calls > 40, 'rajzolt');
    assert(ctx.texts.some(s => s.startsWith('charsel.hint.' + stage)), 'súgó ' + stage);
  }
  eq(drawCharSelect(null, cs, 960, 540), 0); eq(drawCharSelect(fakeCtx(), null, 960, 540), 0);
  const a = panelRect(0), b = panelRect(1);
  assert(a.x >= 0 && b.x + b.w <= 960 && a.x + a.w < b.x && a.y + a.h <= 540, 'a két panel elfér 960x540-ben');
  const ctx = fakeCtx(), w = 120;
  const lines = wrapText(ctx, 'Feltárja a közeli rejtett nyomokat és ösvényeket, és megjelöli az ellenfeleket: a jelölt célpont jobban sérül.', w);
  assert(lines.length >= 3 && lines.every(l => l.length * 6 <= w), 'tördelés: ' + JSON.stringify(lines));
  eq(wrapText(ctx, 'a b c', 1000), ['a b c']); eq(wrapText(ctx, '', 50), []); eq(wrapText(ctx, null, 50), []);
  const cut = wrapText(ctx, 'egy kettő három négy öt hat hét nyolc kilenc tíz', 60, 2);
  eq(cut.length, 2); assert(cut[1].endsWith('…'), 'levágás jelölve: ' + cut[1]);
  assert(wrapText(ctx, 'x'.repeat(100), 60).every(l => l.length * 6 <= 60), 'hosszú szó darabolva');
  for (const r of ['dwarf', 'elf', 'orc', 'ismeretlen']) for (const k of ['warrior', 'wizard', 'ranger', 'healer', 'ismeretlen']) drawPreview(fakeCtx(), 0, 0, r, k);
  assert(CHARSEL_STYLE.panelY + CHARSEL_STYLE.panelH <= 540 - 20, 'hely a figyelmeztető sornak alul');
});

test('charselect: az éles leírások elférnek a kiszabott sorszámban (monospace: 6 px/karakter 10 px-nél, 6,6 px 11 px-nél)', () => {
  const mono = px => ({ measureText: s => ({ width: String(s).length * px }) }), st = CHARSEL_STYLE;
  const abW = st.panelW - 2 * st.pad - st.abIndent, rw = st.panelW - st.pad - (st.pad + st.listW + st.gap + 6);
  for (const l of ['hu', 'en']) for (const [k, v] of Object.entries(collectTexts()[l])) {
    if (!k.endsWith('.desc')) continue;
    if (k.startsWith('ability.')) assert(wrapText(mono(6), v, abW, 99).length <= 2, l + ' ' + k + ' >2 sor');
    else if (k.startsWith('race.') || k.startsWith('class.')) assert(wrapText(mono(6.6), v, rw, 99).length <= 3, l + ' ' + k + ' >3 sor');
  }
});

test('charselect: smoke – 6000 kocka véletlen bemenettel, mindig érvényes állapot, a végén a ráállítás egyezik a választással', () => {
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let run = 0; run < 20; run++) {
    const cs = createCharSelect(reg), ps = [createPlayer(0, 0, 0), createPlayer(1, 0, 0)];
    for (let k = 0; k < 6000 && !cs.done; k++) {
      const raws = [0, 1].map(() => ({ x: rnd() < 0.2 ? rnd() * 2 - 1 : 0, y: rnd() < 0.4 ? rnd() * 2 - 1 : 0, interactPressed: rnd() < 0.03, menuPressed: rnd() < 0.02 }));
      stepCharSelect(cs, raws, 1 / 60);
      for (let i = 0; i < 2; i++) {
        const q = cs.players[i];
        assert(Number.isInteger(q.race) && q.race >= 0 && q.race < 3 && Number.isInteger(q.cls) && q.cls >= 0 && q.cls < 4, 'index tartomány');
        assert(['race', 'class', 'ready'].includes(q.stage), 'szakasz');
      }
      assert(!cs.done || (cs.players[0].stage === 'ready' && cs.players[1].stage === 'ready'), 'done csak ha mindketten készek');
    }
    assert(cs.done, 'a véletlen bemenet végül kész lett');
    const want = [selection(cs, 0), selection(cs, 1)];
    assert(finishCharSelect(cs, ps));
    for (let i = 0; i < 2; i++) { eq(ps[i].race, want[i].race); eq(ps[i].class, want[i].cls); }
    assert(drawCharSelect(fakeCtx(), cs, 960, 540, tr) === 2);
  }
});
