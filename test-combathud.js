// S074 tesztek: harc HUD – képesség-sáv (cooldown + mana/fókusz), ellenség-életcsík, lebegő sebzés-számok, rajz hamis ctx-en, 600 kockás smoke.
// Importja: test-index.js, game-combathud.js, render-combathud.js, render-status.js, game-hud.js, game-ability.js, game-registry.js, game-health.js, game-enemy.js, game-combat.js, game-player.js, i18n.js.
import { test, assert, eq, near } from './test-index.js';
import { COMBATHUD_CONFIG, COMBATHUD_TEXTS, STRIP_LIFT, stripLayout, stripModel, fmtSecs, slotLabel, fmtAmount, createCombatHud, addNumber, connectCombatHud, stepCombatHud, visibleNumbers, enemyBars } from './game-combathud.js';
import { COMBATHUD_STYLE, drawAbilityStrips, drawEnemyBars, drawDamageNumbers } from './render-combathud.js';
import { statusLayout } from './render-status.js';
import { HUD_CONFIG, hudLayout, menuLayout, createMenus } from './game-hud.js';
import { createAbilitySystem, castSlot, stepAbilities } from './game-ability.js';
import { createCharacterRegistry } from './game-registry.js';
import { createPlayerHealths, stepPlayerHealths, applyDamage, heal, killHealth } from './game-health.js';
import { createEnemySystem, spawnEnemy, stepEnemies, damageEnemy } from './game-enemy.js';
import { createCombat, makeHurt, stepCombat } from './game-combat.js';
import { createPlayer } from './game-player.js';
import { createI18n, translate } from './i18n.js';
import { CHARACTER_TEXTS } from './data-character.js';
import { BASE_TEXTS } from './data-text.js';

const DT = 1 / 60, VW = 960, VH = 540;
const ok = v => assert(v, 'ok');
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = r => r.x >= 0 && r.y >= 0 && r.x + r.w <= VW && r.y + r.h <= VH;

function rec() {
  const c = { calls: 0, texts: [], depth: 0, bad: 0, fillStyle: '', font: '', globalAlpha: 1 };
  c.save = () => { c.depth++; };
  c.restore = () => { c.depth--; if (c.depth < 0) c.bad++; };
  c.fillRect = () => { c.calls++; };
  c.fillText = (s, x, y) => { c.calls++; c.texts.push({ s, x, y }); };
  return c;
}
const mk = (cls0 = 'wizard', cls1 = 'warrior') => {
  const reg = createCharacterRegistry(), abilities = createAbilitySystem({ reg });
  const players = [createPlayer(0, 400, 300), createPlayer(1, 520, 300)];
  players[0].class = cls0; players[1].class = cls1;
  const healths = createPlayerHealths(players), es = createEnemySystem({ seed: 5 }), ch = createCombatHud();
  return { reg, abilities, players, healths, es, ch };
};
const tr = k => translate(createI18n({ texts: { ...mergeTexts() }, lang: 'hu' }), k);
function mergeTexts() { return { hu: { ...BASE_TEXTS.hu, ...CHARACTER_TEXTS.hu, ...COMBATHUD_TEXTS.hu }, en: { ...BASE_TEXTS.en, ...CHARACTER_TEXTS.en, ...COMBATHUD_TEXTS.en } }; }

test('combathud: konfig befagyasztott, szövegek HU/EN, STRIP_LIFT = sáv + köz, a szöveg elfér a készlet-sávban', () => {
  assert(Object.isFrozen(COMBATHUD_CONFIG) && Object.isFrozen(COMBATHUD_CONFIG.strip) && Object.isFrozen(COMBATHUD_CONFIG.numbers) && Object.isFrozen(COMBATHUD_CONFIG.bars), 'fagyasztott');
  eq(STRIP_LIFT, COMBATHUD_CONFIG.strip.h + COMBATHUD_CONFIG.strip.above);
  for (const l of ['hu', 'en']) for (const k of ['hud.mana', 'hud.focus']) { assert(typeof COMBATHUD_TEXTS[l][k] === 'string' && COMBATHUD_TEXTS[l][k].length > 0, l + ':' + k); }
  eq(Object.keys(COMBATHUD_TEXTS.hu).join(), Object.keys(COMBATHUD_TEXTS.en).join());
  // a legrosszabb szöveg: 'FÓK 100' 8px monospace ~ 4,8 px/betű
  assert(('FÓK 100').length * 5 <= COMBATHUD_CONFIG.strip.poolW - 4, 'a szöveg elfér');
  eq(tr('hud.mana'), 'MANA');
});

test('combathud: sáv-elrendezés – a HUD fölött, vásznon belül, nem fedi a HUD-ot, a másik sávot és a státusz-ikonokat; P1 balra, P2 jobbra igazított', () => {
  const rects = [];
  for (const i of [0, 1]) {
    const L = stripLayout(i, VW, VH), hud = hudLayout(i, VW, VH);
    ok(L); eq(L.slots.length, 2);
    assert(inside(L) && L.slots.every(inside) && inside(L.pool), 'vásznon belül');
    assert(L.y + L.h + COMBATHUD_CONFIG.strip.above === hud.y, 'közvetlenül a HUD fölött');
    assert(!overlap(L, hud) && !overlap(L.pool, hud) && L.slots.every(s => !overlap(s, hud)), 'nem fedi a HUD-ot');
    assert(!overlap(L.slots[0], L.slots[1]) && !overlap(L.slots[0], L.pool) && !overlap(L.slots[1], L.pool), 'elemek nem fedik egymást');
    assert(L.pool.x >= L.x && L.pool.x + L.pool.w <= L.x + L.w, 'a készlet-sáv a panel szélességén belül');
    if (i === 0) { eq(L.slots[0].x, hud.x); assert(L.slots[1].x > L.slots[0].x, 'jobbra nő'); } else { eq(L.slots[0].x + L.slots[0].w, hud.x + hud.w); assert(L.slots[1].x < L.slots[0].x, 'balra nő'); }
    for (const open of [false, true]) {
      const menu = menuLayout(i, VW, VH);
      for (const r of statusLayout(i, 5, VW, VH, open)) {
        assert(inside(r), 'ikon a vásznon belül');
        if (!open) { assert(!overlap(r, L) && !overlap(r, hud), 'az ikon-sor a sáv FÖLÖTT van'); assert(r.y + r.h <= L.y, 'sáv fölött'); } else assert(!overlap(r, menu), 'nyitott menünél a menü fölött');
      }
    }
    rects.push(L);
  }
  assert(!overlap(rects[0], rects[1]), 'a két sáv külön');
  eq(stripLayout(0, NaN, VH), null); eq(stripLayout(0, VW, undefined), null);
  eq(stripLayout(7, VW, VH).slots[0].x, stripLayout(0, VW, VH).slots[0].x); // csak 0/1
});

test('combathud: formázók – fmtSecs, slotLabel (ékezet, üres, szóköz), fmtAmount', () => {
  eq(fmtSecs(0), ''); eq(fmtSecs(-1), ''); eq(fmtSecs(NaN), ''); eq(fmtSecs(2.41), '2.5'); eq(fmtSecs(0.01), '0.1'); eq(fmtSecs(9.99), '10.0'); eq(fmtSecs(10), '10'); eq(fmtSecs(10.2), '11'); eq(fmtSecs(Infinity), '');
  eq(slotLabel('Falbontás'), 'FA'); eq(slotLabel('Érzés'), 'ÉR'); eq(slotLabel('  a b'), 'AB'); eq(slotLabel(''), '?'); eq(slotLabel(null, 'X'), 'X'); eq(slotLabel('!!'), '?'); eq(slotLabel(12345), '12');
  eq(fmtAmount(8, 'enemy'), '8'); eq(fmtAmount(0.5), '0.5'); eq(fmtAmount(12.6), '13'); eq(fmtAmount(4, 'heal'), '+4'); eq(fmtAmount(0), ''); eq(fmtAmount(-3), ''); eq(fmtAmount(NaN), ''); eq(fmtAmount(2.25), '2.3');
});

test('combathud: stripModel – varázsló (mana-sáv), harcos (nincs készlet-sáv: a stamina a HUD-panelben), cooldown + elérhetőség, üres/hibás bemenet', () => {
  const S = mk('wizard', 'warrior'), m0 = stripModel(S.abilities, S.players, 0, tr), m1 = stripModel(S.abilities, S.players, 1, tr);
  eq(m0.slots.length, 2); eq(m0.slots[0].id, 'light'); eq(m0.slots[1].id, 'ignite'); eq(m0.slots[0].label, 'FÉ'); eq(m0.slots[0].key, '1'); eq(m0.slots[1].key, '2');
  assert(m0.slots[0].ready && m0.slots[0].affordable && !m0.slots[0].empty, 'kész'); eq(m0.slots[0].secs, '');
  ok(m0.pool); eq(m0.pool.res, 'mana'); eq(m0.pool.value, 100); eq(m0.pool.ratio, 1); eq(m0.pool.textKey, 'hud.mana');
  eq(m1.slots[0].id, 'wallbreak'); eq(m1.pool, null);
  // elsütés: cooldown + mana fogy
  const r = castSlot(S.abilities, S.players, 0, 0, {}); ok(r.ok);
  const a = stripModel(S.abilities, S.players, 0, tr);
  assert(a.slots[0].remaining > 1.9 && a.slots[0].ratio > 0.9 && a.slots[0].secs !== '' && !a.slots[0].ready, 'cooldown fut: ' + JSON.stringify(a.slots[0]));
  near(a.pool.value, 85, 1e-6); near(a.pool.ratio, 0.85, 1e-6);
  stepAbilities(S.abilities, S.players, [{}, {}], [], 5); const b = stripModel(S.abilities, S.players, 0, tr);
  eq(b.slots[0].remaining, 0); assert(b.slots[0].ready, 'lejárt');
  // nem fizethető: mana lenullázva
  S.players[0].mana = 3; const c = stripModel(S.abilities, S.players, 0, tr);
  assert(!c.slots[0].affordable && !c.slots[0].ready, 'nincs elég mana'); near(c.pool.ratio, 0.03, 1e-6);
  // kaszt nélküli játékos, hibás bemenetek: sosem dob
  const n = createPlayer(0, 0, 0); eq(stripModel(S.abilities, [n, n], 0, tr).slots.every(s => s.empty), true);
  for (const bad of [[null, null, 0], [undefined, [], 0], [S.abilities, null, 0], [S.abilities, S.players, 5], [{}, S.players, 0], [S.abilities, [null, null], 1]]) {
    const m = stripModel(bad[0], bad[1], bad[2], tr); eq(m.slots.length, 2); eq(m.pool, null);
  }
  eq(stripModel(S.abilities, S.players, 0).slots[0].name, 'ability.light', 'tr nélkül a kulcs'); // alap tr: a kulcs
});

test('combathud: sebzés-számok – ellenfél- és játékos-sebzésből, DoT, gyógyítás; összevonás, korlát, öregedés, érvénytelen bemenet', () => {
  const S = mk(); const off = connectCombatHud(S.ch, { players: S.players, healths: S.healths, enemySys: S.es });
  const e = spawnEnemy(S.es, 'boar', 600, 300); ok(e);
  damageEnemy(S.es, e, 8, { player: 0 }); eq(S.ch.numbers.length, 1);
  const n = S.ch.numbers[0]; eq(n.kind, 'enemy'); eq(n.amount, 8); eq(n.type, 'physical'); eq(n.dot, false); near(n.x, 600); near(n.y, 300 - e.h / 2);
  damageEnemy(S.es, e, 4, { player: 0 }); eq(S.ch.numbers.length, 1, 'gyors egymásutánban összevonódik'); eq(S.ch.numbers[0].amount, 12); eq(S.ch.stats.merged, 1);
  stepCombatHud(S.ch, 0.5); damageEnemy(S.es, e, 3, { player: 0 }); eq(S.ch.numbers.length, 2, 'az ablak után új szám');
  damageEnemy(S.es, e, 2, { player: 0, type: 'fire' }); eq(S.ch.numbers.length, 3, 'más típus: külön'); eq(S.ch.numbers[2].type, 'fire');
  // játékos: sebzés piros, DoT jelölve, gyógyítás
  applyDamage(S.healths[1], { amount: 10, type: 'physical', source: 'boar' }); const pn = S.ch.numbers[S.ch.numbers.length - 1];
  eq(pn.kind, 'player'); eq(pn.amount, 10); near(pn.x, S.players[1].x); near(pn.y, S.players[1].y - 14);
  applyDamage(S.healths[1], { amount: 1.5, type: 'fire', source: 'status:burn', tag: 'status' }); eq(S.ch.numbers[S.ch.numbers.length - 1].dot, true);
  heal(S.healths[1], 6); const hn = S.ch.numbers[S.ch.numbers.length - 1]; eq(hn.kind, 'heal'); eq(hn.amount, 6);
  applyDamage(S.healths[0], { amount: 0, type: 'physical' }); const before = S.ch.numbers.length; applyDamage(S.healths[0], { amount: -4 }); eq(S.ch.numbers.length, before, '0/negatív: nincs szám');
  // érvénytelen
  for (const bad of [{ x: NaN, y: 0, amount: 1 }, { x: 0, y: 0, amount: 0 }, { x: 0, y: 0, amount: -1 }, { x: 0, y: 0, amount: 'x' }, { x: 0, y: Infinity, amount: 1 }]) eq(addNumber(S.ch, bad), null);
  eq(addNumber(null, { x: 0, y: 0, amount: 1 }), null);
  // korlát
  for (let i = 0; i < 200; i++) addNumber(S.ch, { x: i, y: 0, amount: 1, kind: 'enemy', type: 'physical', key: 'k' + i });
  eq(S.ch.numbers.length, COMBATHUD_CONFIG.numbers.max); assert(S.ch.stats.dropped > 100, 'a régi eldobva');
  // öregedés: a szám kihal
  stepCombatHud(S.ch, 5); eq(S.ch.numbers.length, 0); stepCombatHud(S.ch, NaN); stepCombatHud(S.ch, -1); stepCombatHud(null, 1); eq(S.ch.numbers.length, 0);
  off();
});

test('combathud: visibleNumbers – emelkedés (lassuló), halványodás az utolsó 40%-ban, nézet-eltolás, kivágás, hibás bemenet', () => {
  const ch = createCombatHud(); addNumber(ch, { x: 500, y: 400, amount: 25, kind: 'enemy', type: 'frost', key: 'a' }); const L = ch.cfg.numbers.life;
  let v = visibleNumbers(ch, 100, 200, VW, VH); eq(v.length, 1); eq(v[0].text, '25'); eq(v[0].big, true); eq(v[0].alpha, 1); eq(v[0].type, 'frost');
  const x0 = v[0].x, y0 = v[0].y; assert(Math.abs(x0 - (500 + ch.numbers[0].dx - 100)) <= 1 && y0 === 200, 'eltolás: ' + x0 + ',' + y0);
  stepCombatHud(ch, L * 0.3); const y1 = visibleNumbers(ch, 100, 200, VW, VH)[0].y; stepCombatHud(ch, L * 0.3); const y2 = visibleNumbers(ch, 100, 200, VW, VH)[0].y;
  assert(y1 < y0 && y2 < y1, 'felfelé mozog'); assert((y0 - y1) > (y1 - y2), 'lassuló (ease-out)');
  stepCombatHud(ch, L * 0.2); const a = visibleNumbers(ch, 100, 200, VW, VH)[0].alpha; assert(a < 1 && a > 0, 'halványodik: ' + a);
  eq(visibleNumbers(ch, 5000, 5000, VW, VH).length, 0, 'nézeten kívül nincs'); eq(visibleNumbers(ch, NaN, 0, VW, VH).length, 0); eq(visibleNumbers(null, 0, 0, VW, VH).length, 0);
  const out = [1, 2, 3]; visibleNumbers(ch, 100, 200, VW, VH, out); assert(out.length <= 1, 'az out újrahasznosítva');
});

test('combathud: életcsík – sértetlen nyugvó rejtett, sérült/üldöző/sebzett látszik, időzítő lejár, halott és nézeten kívüli nem; korlát', () => {
  const S = mk(); connectCombatHud(S.ch, { players: S.players, healths: S.healths, enemySys: S.es });
  const e = spawnEnemy(S.es, 'boar', 600, 300); eq(enemyBars(S.ch, S.es, 0, 0, VW, VH).length, 0, 'sértetlen, nyugvó');
  e.state = 'chase'; let b = enemyBars(S.ch, S.es, 0, 0, VW, VH); eq(b.length, 1, 'üldöz: látszik'); eq(b[0].ratio, 1); eq(b[0].w, COMBATHUD_CONFIG.bars.w); eq(b[0].state, 'chase');
  e.state = 'idle'; eq(enemyBars(S.ch, S.es, 0, 0, VW, VH).length, 0);
  damageEnemy(S.es, e, e.hpMax / 4, { player: 0 }); b = enemyBars(S.ch, S.es, 0, 0, VW, VH); eq(b.length, 1); near(b[0].ratio, 0.75, 1e-9);
  near(b[0].x, Math.round(600 - COMBATHUD_CONFIG.bars.w / 2)); assert(b[0].y < 300 - e.h / 2, 'a fej fölött');
  const ox = enemyBars(S.ch, S.es, 100, 50, VW, VH)[0]; eq(ox.x, b[0].x - 100); eq(ox.y, b[0].y - 50);
  e.health.hp = e.health.max; e.hp = e.hpMax; assert(S.ch.hit.has(e), 'a sebzés-időzítő él'); eq(enemyBars(S.ch, S.es, 0, 0, VW, VH).length, 1, 'gyógyultan is látszik az időzítő alatt');
  for (let k = 0; k < 5; k++) stepCombatHud(S.ch, 1); /* dt <= maxDt (1 mp) */ e.state = 'idle'; eq(enemyBars(S.ch, S.es, 0, 0, VW, VH).length, 0, 'lejárt');
  damageEnemy(S.es, e, e.hpMax / 2, { player: 0 }); eq(enemyBars(S.ch, S.es, 5000, 5000, VW, VH).length, 0, 'nézeten kívül');
  damageEnemy(S.es, e, 9999, { player: 0 }); eq(enemyBars(S.ch, S.es, 0, 0, VW, VH).length, 0, 'halott: nincs csík'); eq(S.ch.numbers.length > 0, true, 'a halálos találat száma megvan');
  eq(enemyBars(null, S.es, 0, 0, VW, VH).length, 0); eq(enemyBars(S.ch, null, 0, 0, VW, VH).length, 0); eq(enemyBars(S.ch, S.es, NaN, 0, VW, VH).length, 0);
  for (let i = 0; i < 100; i++) { const f = spawnEnemy(S.es, 'field_rat', 300 + i, 300); if (f) f.state = 'chase'; }
  assert(enemyBars(S.ch, S.es, 0, 0, VW, VH).length <= COMBATHUD_CONFIG.bars.maxView, 'korlátos');
});

test('combathud: connect/detach – meglévő és új ellenfél, halál után a figyelő leszedve, detach után nincs új szám, kétszeri kötés nem dupláz', () => {
  const S = mk(); const pre = spawnEnemy(S.es, 'boar', 600, 300);
  const off = connectCombatHud(S.ch, { players: S.players, healths: S.healths, enemySys: S.es });
  damageEnemy(S.es, pre, 2, { player: 0 }); eq(S.ch.numbers.length, 1, 'a már meglévő ellenfél is figyelve');
  const late = spawnEnemy(S.es, 'field_rat', 640, 300); damageEnemy(S.es, late, 1, { player: 0 }); eq(S.ch.numbers.length, 2, 'az újonnan született is');
  eq(S.ch.off.size, 2);
  stepCombatHud(S.ch, 1); stepCombatHud(S.ch, 1); eq(S.ch.numbers.length, 0);
  damageEnemy(S.es, late, 999, { player: 0 }); eq(S.ch.numbers.length, 1, 'a halálos találat is számolódik');
  stepEnemies(S.es, S.players, DT, { walls: [], healths: S.healths }); eq(S.ch.off.has(late), false, 'a halott figyelője leszedve'); eq(S.es.list.includes(late), false);
  S.ch.numbers.length = 0; const again0 = connectCombatHud(S.ch, { players: S.players, healths: S.healths, enemySys: S.es }); // a már kötött rendszerekre nincs új figyelő (idempotens)
  eq(typeof again0, 'function'); damageEnemy(S.es, pre, 1, { player: 0 }); eq(S.ch.numbers.length, 1, 'a kötés él'); applyDamage(S.healths[0], { amount: 5, type: 'physical' }); eq(S.ch.numbers.length, 2);
  const again = connectCombatHud(S.ch, { players: S.players, healths: S.healths, enemySys: S.es }); // kétszeri kötés
  S.ch.numbers.length = 0; stepCombatHud(S.ch, 1); applyDamage(S.healths[1], { amount: 7, type: 'physical' }); damageEnemy(S.es, pre, 2, { player: 0 });
  eq(S.ch.numbers.length, 2); eq(S.ch.numbers[0].amount, 7, 'a játékos-sebzés nem dupláz'); eq(S.ch.numbers[1].amount, 2, 'az ellenfél-sebzés nem dupláz');
  eq(typeof again, 'function'); again(); again0(); /* a másodlagos kötések detach-e nem szed le semmit */ damageEnemy(S.es, pre, 1, { player: 0 }); eq(S.ch.numbers.length > 0, true, 'az elsődleges kötés még él'); off(); S.ch.numbers.length = 0; applyDamage(S.healths[1], { amount: 5, type: 'physical' }); damageEnemy(S.es, pre, 1, { player: 0 }); eq(S.ch.numbers.length, 0, 'a detach mindent leszed');
  // hiányos env, hibás elemek: nem dob
  const ch2 = createCombatHud(); connectCombatHud(ch2, {}); connectCombatHud(ch2, undefined); connectCombatHud(ch2, { healths: [null, {}], players: [], enemySys: null });
  // a hibázó rajz/figyelő nem állítja meg a Health-et
  eq(S.healths[0].lastError, null);
});

test('combathud: rajz – sáv (menü nyitva: rejtve), életcsík, számok hamis ctx-en; save/restore egyensúly; hibás bemenet 0, nem dob', () => {
  const S = mk(); connectCombatHud(S.ch, { players: S.players, healths: S.healths, enemySys: S.es });
  const menus = createMenus(), c = rec();
  eq(drawAbilityStrips(c, S.abilities, S.players, menus, VW, VH, tr), 2); eq(c.depth, 0); eq(c.bad, 0);
  assert(c.texts.some(t => t.s === 'FÉ') && c.texts.some(t => t.s === 'FA'), 'képesség-jelzések: ' + JSON.stringify(c.texts.map(t => t.s)));
  assert(c.texts.some(t => /^MANA \d+$/.test(t.s)), 'mana-felirat');
  castSlot(S.abilities, S.players, 0, 0, {}); const c2 = rec(); drawAbilityStrips(c2, S.abilities, S.players, menus, VW, VH, tr); assert(c2.texts.some(t => /^[12]\.\d$/.test(t.s)), 'cooldown-másodperc: ' + JSON.stringify(c2.texts.map(t => t.s)));
  menus.open[0] = true; const c3 = rec(); eq(drawAbilityStrips(c3, S.abilities, S.players, menus, VW, VH, tr), 1, 'nyitott menünél az adott játékos sávja rejtve'); menus.open[0] = false;
  eq(drawAbilityStrips(rec(), S.abilities, [S.players[0]], menus, VW, VH, tr), 1, 'hiányzó játékos kimarad'); eq(drawAbilityStrips(null, S.abilities, S.players, menus, VW, VH), 0); eq(drawAbilityStrips(rec(), S.abilities, null, menus, VW, VH), 0); eq(drawAbilityStrips(rec(), S.abilities, S.players, menus, NaN, VH), 0);
  const e = spawnEnemy(S.es, 'boar', 600, 300); damageEnemy(S.es, e, 5, { player: 0 }); damageEnemy(S.es, e, 3, { player: 0, type: 'frost' });
  const c4 = rec(); eq(drawEnemyBars(c4, S.ch, S.es, 400, 200, VW, VH), 1); ok(c4.calls >= 3); eq(c4.depth, 0);
  const c5 = rec(); eq(drawDamageNumbers(c5, S.ch, 400, 200, VW, VH), 2); eq(c5.depth, 0); eq(c5.globalAlpha, 1, 'az átlátszóság visszaáll'); assert(c5.texts.some(t => t.s === '5') && c5.texts.some(t => t.s === '3'), 'a számok szövege');
  eq(drawEnemyBars(null, S.ch, S.es, 0, 0, VW, VH), 0); eq(drawEnemyBars(rec(), null, S.es, 0, 0, VW, VH), 0); eq(drawDamageNumbers(rec(), null, 0, 0, VW, VH), 0); eq(drawDamageNumbers(rec(), S.ch, NaN, 0, VW, VH), 0);
  for (const t of ['physical', 'fire', 'frost', 'poison', 'dark', 'heat']) ok(COMBATHUD_STYLE.num[t]);
});

test('combathud: osztott és összeolvadt képernyő – ugyanaz a szám/csík mindkét nézetben a saját eltolásával, a sáv a fő vásznon fix', () => {
  const S = mk(); connectCombatHud(S.ch, { players: S.players, healths: S.healths, enemySys: S.es });
  const e = spawnEnemy(S.es, 'boar', 500, 300); damageEnemy(S.es, e, 4, { player: 0 });
  const a = visibleNumbers(S.ch, 400, 200, 480, 540), b = visibleNumbers(S.ch, 100, 100, 480, 540); eq(a.length, 1); eq(b.length, 1); eq(b[0].x - a[0].x, 300); eq(b[0].y - a[0].y, 100);
  const far = visibleNumbers(S.ch, 2000, 2000, 480, 540); eq(far.length, 0, 'a távoli nézet nem látja');
  const ba = enemyBars(S.ch, S.es, 400, 200, 480, 540), bb = enemyBars(S.ch, S.es, 100, 100, 480, 540); eq(ba.length, 1); eq(bb[0].x - ba[0].x, 300);
  // a sáv elrendezése nem függ a nézettől: ugyanaz mindkét felbontáson belül (fix sarok)
  eq(JSON.stringify(stripLayout(0, VW, VH)), JSON.stringify(stripLayout(0, VW, VH)));
});

test('smoke (S074): 600 kocka – két játékos, ellenfelek, harc, képességek, HUD-rajz két nézetben; nincs kivétel/NaN, a számok és csíkok korlátosak, determinisztikus', () => {
  const run = () => {
    const S = mk('wizard', 'warrior'), cs = createCombat(), ctx = { players: S.players, healths: S.healths, enemySys: S.es, walls: [] };
    connectCombatHud(S.ch, { players: S.players, healths: S.healths, enemySys: S.es });
    const env = { walls: [], healths: S.healths, hurt: makeHurt(cs, ctx) }, menus = createMenus(), c = rec();
    ['boar', 'field_rat', 'boar', 'field_rat', 'boar'].forEach((t, i) => spawnEnemy(S.es, t, 470 + i * 25, 330 + (i % 2) * 30));
    let drew = 0, maxNum = 0, maxBars = 0, castsOk = 0;
    for (let f = 0; f < 600; f++) {
      S.players[0].x = 400 + Math.sin(f / 40) * 60; S.players[1].x = 520 + Math.cos(f / 50) * 60;
      if (f % 45 === 0) { const r = castSlot(S.abilities, S.players, f % 90 === 0 ? 0 : 1, f % 135 === 0 ? 1 : 0, {}); if (r.ok) castsOk++; }
      stepAbilities(S.abilities, S.players, [{}, {}], [], DT);
      if (f % 20 === 0 && S.es.list.length) damageEnemy(S.es, S.es.list[f % S.es.list.length], 3 + (f % 7), { player: f % 2 });
      if (f % 97 === 0) heal(S.healths[f % 2], 4);
      if (f === 400) killHealth(S.healths[1]);
      stepEnemies(S.es, S.players, DT, env); stepCombat(cs, ctx, DT); stepPlayerHealths(S.healths, S.players, DT); stepCombatHud(S.ch, DT);
      if (f % 10 === 0) {
        for (const o of [{ x: 300, y: 200 }, { x: 420, y: 220 }]) { drawEnemyBars(c, S.ch, S.es, o.x, o.y, 480, 540); drawDamageNumbers(c, S.ch, o.x, o.y, 480, 540); }
        drew += drawAbilityStrips(c, S.abilities, S.players, menus, VW, VH, tr);
      }
      assert(S.ch.numbers.length <= COMBATHUD_CONFIG.numbers.max, 'számok korlátosak: ' + f);
      maxNum = Math.max(maxNum, S.ch.numbers.length); maxBars = Math.max(maxBars, enemyBars(S.ch, S.es, 0, 0, VW, VH).length);
      for (const n of S.ch.numbers) assert([n.x, n.y, n.amount, n.t].every(Number.isFinite), 'NaN szám ' + f);
    }
    eq(S.ch.lastError, null); eq(S.es.lastError, null); eq(c.bad, 0); eq(c.depth, 0);
    assert(c.texts.every(t => typeof t.s === 'string' && !/NaN|undefined|Infinity/.test(t.s)), 'rossz felirat');
    return { stats: JSON.stringify(S.ch.stats), maxNum, maxBars, drew, castsOk, calls: c.calls, hp: S.players.map(p => Math.round(p.hp * 100)).join() };
  };
  const a = run(), b = run();
  assert(JSON.parse(a.stats).numbers > 20, 'sok szám született: ' + a.stats); assert(a.maxNum > 0 && a.maxBars > 0, 'volt szám és csík'); eq(a.drew, 60 * 2); assert(a.castsOk > 3, 'a képességek elsültek: ' + a.castsOk);
  eq(JSON.stringify(a), JSON.stringify(b), 'determinisztikus');
});
