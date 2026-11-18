// Harc és póráz tesztjei (S073): a visszalökés külön lépése a póráz-rendszerben (tether-system.js: KNOCK_CONFIG, knockK, sys.knock) és a póráz-lendítés (game-tetherlash.js).
// Importja: test-index.js, tether-system.js, game-player.js, game-collision.js, game-enemy.js, game-combat.js, game-health.js, game-tetherlash.js.
import { test, assert, eq, near } from './test-index.js';
import { createTetherSystem, stepTetherSystem, knockK, KNOCK_CONFIG } from './tether-system.js';
import { createPlayer } from './game-player.js';
import { collides } from './game-collision.js';
import { createEnemySystem, spawnEnemy, stepEnemies } from './game-enemy.js';
import { createCombat, makeHurt, stepCombat, flashAlpha } from './game-combat.js';
import { createPlayerHealths, stepPlayerHealths, setInvulnerable } from './game-health.js';
import { LASH_CONFIG, sanitizeLashConfig, createLash, onLash, setLashEnabled, lashFrame, lashContact, lashDamage, stepLash } from './game-tetherlash.js';

const DT = 1 / 60, EPS = 1e-6, L = { x: 320, y: 200 }, NONE = { x: 0, y: 0 };
const mk = (o = {}) => ({ ps: [createPlayer(0, 400, 300), createPlayer(1, 400 + (o.gap === undefined ? 320 : o.gap), 300)], sys: createTetherSystem({ L, k: 0.5, walls: o.walls || [], ...(o.cfg || {}) }) });
const step = (S, inp = [NONE, NONE]) => stepTetherSystem(S.sys, S.ps, inp, DT);
const dist = S => ({ x: Math.abs(S.ps[1].x - S.ps[0].x), y: Math.abs(S.ps[1].y - S.ps[0].y) });
const stepEnemies2 = (es, ps, env) => stepEnemies(es, ps, DT, env);
const lcg = seed => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };

// ---- a visszalökés a pórázban ----
test('knock: feszes póráz – a kilökött játékos a társat is viszi (drag · tömeg-arány), a táv nem változik', () => {
  const S = mk(); S.ps[0].kbx = -400; step(S);
  near(S.ps[0].vx, -280, EPS); near(S.ps[1].vx, -280, EPS); near(dist(S).x, 320, 1e-9); eq(S.ps[0].vy, 0);
  eq(S.sys.knock.active, true); eq(S.sys.knock.mode.x, 'pull-a'); near(S.sys.knock.k.a, 0.7, EPS);
  assert(S.ps[1].x < 720, 'a társ elmozdult'); eq(S.ps[0].kbx, -400, 'a p.kbx érintetlen (a game-combat az ura)');
  const T = mk(); T.ps[1].kbx = 400; step(T); near(T.ps[0].vx, 280, EPS); eq(T.sys.knock.mode.x, 'pull-b');
});
test('knock: nehéz társ jobban fékez, drag 0 -> a társ nem mozdul; knockK határai és hibás bemenet', () => {
  const H = mk(); H.ps[1].weight = 4; H.ps[0].kbx = -400; step(H); near(H.ps[0].vx, -70, EPS); near(H.sys.knock.k.a, 0.175, EPS);
  const Z = mk({ cfg: { knock: { ...KNOCK_CONFIG, drag: 0 } } }); Z.ps[0].kbx = -400; step(Z); eq(Z.ps[0].vx, 0); eq(Z.ps[1].vx, 0);
  const a = createPlayer(0, 0, 0), b = createPlayer(1, 0, 0); eq(knockK(a, b), 0.7);
  a.weight = 100; b.weight = 0.001; near(knockK(a, b), 1, EPS, 'felső határ'); a.weight = 0.001; b.weight = 100; near(knockK(a, b), 0.7 * 0.25, EPS, 'massMin');
  a.weight = NaN; a.load = 'x'; b.weight = undefined; const k = knockK(a, b); assert(Number.isFinite(k) && k >= 0 && k <= 1, 'hibás tömeg: ' + k);
  const g = knockK(a, b, { drag: NaN, massMin: NaN, massMax: NaN }); assert(Number.isFinite(g) && g >= 0 && g <= 1, 'hibás konfig');
  eq(knockK(a, b, null) >= 0, true);
});
test('knock: a korláton belül szabadon mozog, a korlátnál húzza a társat; sosem nő a táv', () => {
  const S = mk({ gap: 300 }); const x0 = S.ps[0].x, bx0 = S.ps[1].x; let drag = false;
  for (let i = 0; i < 12; i++) { S.ps[0].kbx = -400; step(S); assert(dist(S).x <= 320 + EPS, 'táv ' + dist(S).x); if (S.ps[1].x < bx0 - 1e-9) drag = true; if (i === 0) near(S.ps[0].vx, -400, EPS, 'szabadon'); }
  assert(drag, 'a korlátnál a társ is mozdult'); assert(S.ps[0].x < x0 - 20, 'A elmozdult');
});
test('knock: mindketten kifelé -> holtpont; befelé -> szabad; kis (minSpeed alatti) visszalökés nem lép', () => {
  const H = mk(); H.ps[0].kbx = -300; H.ps[1].kbx = 300; step(H); eq(H.ps[0].vx, 0); eq(H.ps[1].vx, 0); eq(H.sys.knock.mode.x, 'hold');
  const I = mk(); I.ps[0].kbx = 300; I.ps[1].kbx = -300; step(I); near(I.ps[0].vx, 300, EPS); near(I.ps[1].vx, -300, EPS); eq(I.sys.knock.mode.x, 'free');
  const T = mk(); T.ps[0].kbx = -0.5; T.ps[0].kby = 0.2; step(T); eq(T.sys.knock.active, false); eq(T.ps[0].vx, 0);
  const N = mk(); N.ps[0].kbx = NaN; N.ps[0].kby = Infinity; step(N); eq(N.sys.knock.active, false); assert(Number.isFinite(N.ps[0].x), 'NaN kbx nem rontja');
});
test('knock: nem költ húzás-staminát (régi mód, knock:false: igen); bemenet + visszalökés együtt is a korláton belül', () => {
  const S = mk({ cfg: { pullStamina: true } });
  for (let i = 0; i < 60; i++) { S.ps[0].kbx = -300; step(S); }
  near(S.sys.stamina.a.value, S.sys.stamina.a.max, 1e-9, 'A nem fáradt'); near(S.sys.stamina.b.value, S.sys.stamina.b.max, 1e-9, 'B nem fáradt');
  const O = mk({ cfg: { pullStamina: true, knock: false } });
  for (let i = 0; i < 60; i++) { O.ps[0].kbx = -300; step(O); }
  assert(O.sys.stamina.a.value < O.sys.stamina.a.max - 1, 'régi mód: a visszalökés húzásnak számít'); eq(O.sys.knock.active, false);
  const M = mk(); for (let i = 0; i < 60; i++) { M.ps[0].kbx = -500; const t = step(M, [{ x: -1, y: 0 }, NONE]); assert(dist(M).x <= 320 + EPS, 'bemenet+kb táv'); if (i === 0) assert(t.knock, 't.knock'); }
});
test('knock: falnak ütközve a társ is megáll, nincs átfedés, a táv a korláton belül', () => {
  const walls = [{ x: 340, y: 250, w: 20, h: 100 }], S = mk({ walls }); let blocked = false;
  for (let i = 0; i < 40; i++) { S.ps[0].kbx = -400; step(S); if (S.sys.blocked.a.x) blocked = true; assert(!collides(S.ps[0], walls) && !collides(S.ps[1], walls), 'fal-átfedés'); assert(dist(S).x <= 320 + EPS, 'táv'); }
  assert(blocked, 'a fal levágta A mozgását'); assert(S.ps[0].x - 12 >= 360 - EPS, 'A a falnál áll: ' + S.ps[0].x);
  const x = S.ps[1].x; for (let i = 0; i < 10; i++) { S.ps[0].kbx = -400; step(S); } near(S.ps[1].x, x, 1e-6, 'a társ nem húzódik tovább a falnál megállt A után');
});
test('knock: fuzz – 3000 kocka véletlen bemenettel és ellenség-lökésekkel, falakkal: a táv sosem lépi túl az L_eff-et (az ellenség nem vágja el a pórázt), nincs NaN/fal-átfedés', () => {
  const walls = [{ x: 200, y: 200, w: 40, h: 120 }, { x: 800, y: 380, w: 120, h: 30 }, { x: 560, y: 120, w: 30, h: 70 }];
  for (const seed of [7, 99, 2024]) {
    const S = mk({ gap: 120, walls }), r = lcg(seed); let maxX = 0, maxY = 0, impulses = 0;
    for (let f = 0; f < 3000; f++) {
      if (f % 25 === 0) { const p = S.ps[r() < 0.5 ? 0 : 1], a = r() * Math.PI * 2, v = 200 + r() * 500; p.kbx = Math.cos(a) * v; p.kby = Math.sin(a) * v; impulses++; }
      for (const p of S.ps) { p.kbx *= 0.85; p.kby *= 0.85; if (Math.hypot(p.kbx, p.kby) < 12) { p.kbx = 0; p.kby = 0; } }
      step(S, S.ps.map(() => ({ x: Math.round(r() * 2 - 1), y: Math.round(r() * 2 - 1) })));
      for (const p of S.ps) { assert([p.x, p.y, p.vx, p.vy].every(Number.isFinite), 'NaN ' + f); assert(!collides(p, walls), `fal-átfedés ${seed}/${f}`); }
      const d = dist(S); maxX = Math.max(maxX, d.x); maxY = Math.max(maxY, d.y);
      assert(d.x <= L.x + EPS && d.y <= L.y + EPS, `táv ${seed}/${f}: ${d.x.toFixed(2)},${d.y.toFixed(2)}`);
    }
    assert(impulses > 100 && maxX > 0.7 * L.x && maxY > 0.95 * L.y, 'a póráz tényleg megfeszült: ' + maxX + ',' + maxY);
  }
});
test('integráció: valódi ellenség + harc + póráz – a vaddisznó a két játékos között támad, a lökés a társat húzza, a táv a korláton belül marad', () => {
  const S = mk(), es = createEnemySystem({ seed: 5 }), cs = createCombat(), hs = createPlayerHealths(S.ps), ctx = { players: S.ps, healths: hs, enemySys: es, walls: [] };
  const e = spawnEnemy(es, 'boar', 440, 300), env = { walls: [], healths: hs, hurt: makeHurt(cs, ctx) }; const bx0 = S.ps[1].x; let between = 0;
  for (let f = 0; f < 900; f++) {
    stepEnemies2(es, S.ps, env); stepCombat(cs, ctx, DT); stepPlayerHealths(hs, S.ps, DT);
    const t = step(S, [{ x: f % 200 < 120 ? -1 : 0, y: 0 }, NONE]);
    assert(dist(S).x <= L.x + EPS && dist(S).y <= L.y + EPS, 'táv ' + f); assert(S.ps.every(p => Number.isFinite(p.x) && Number.isFinite(p.kbx || 0)), 'NaN ' + f);
    if (e.x > S.ps[0].x && e.x < S.ps[1].x) between++; if (t.knock) assert(S.sys.knock.active);
  }
  assert(cs.stats.knocks > 0, 'az ellenség lökött: ' + JSON.stringify(cs.stats)); assert(between > 30, 'az ellenség a játékosok között járt: ' + between);
  assert(S.ps[1].x < bx0 - 20, 'a társat húzta a menekülő/lökött játékos: ' + S.ps[1].x);
});

// ---- póráz-lendítés ----
const lp = (x, y, vx = 0, vy = 0) => ({ ...createPlayer(0, x, y), vx, vy });
const lashWorld = (o = {}) => {
  const es = createEnemySystem({ seed: 3 }), cs = createCombat(), ps = [lp(0, 0), { ...lp(200, 0, 0, 300), index: 1 }], e = spawnEnemy(es, o.type || 'grunt', o.ex === undefined ? 150 : o.ex, 0);
  return { es, cs, ps, e, ls: createLash({ cfg: o.cfg }), ctx: { players: ps, enemySys: es, combat: cs, stretch: o.stretch === undefined ? 1 : o.stretch } };
};
test('lash: geometria – swing = a merőleges sebesség-különbség, a fonal sebessége az ellenség helyén (az ellenséghez mérve)', () => {
  const A = lp(0, 0), B = lp(200, 0, 0, 300), fr = lashFrame(A, B);
  near(fr.len, 200, EPS); near(fr.swing, 300, EPS); near(fr.nx, 0, EPS); near(fr.ny, 1, EPS);
  const c1 = lashContact(fr, A, { x: 200, y: 0 }), c2 = lashContact(fr, A, { x: 100, y: 0 }), c3 = lashContact(fr, A, { x: 100, y: 0, vy: 100 });
  near(c1.speed, 300, EPS); near(c1.sy, 1, EPS); near(c2.speed, 150, EPS); near(c3.speed, 50, EPS); near(c2.s, 0.5, EPS);
  near(lashContact(lashFrame(A, lp(200, 0, 0, -300)), A, { x: 200, y: 0 }).sy, -1, EPS, 'irány');
  near(lashFrame(lp(0, 0, 0, 200), lp(200, 0, 0, 200)).swing, 0, EPS, 'együtt csúszás nem forgás');
  eq(lashFrame(lp(5, 5), lp(5, 5)), null); eq(lashFrame(null, A), null); eq(lashFrame(lp(NaN, 0), B), null); eq(lashContact(null, A, {}), null); eq(lashContact(fr, A, { x: NaN, y: 0 }), null);
});
test('lash: találat – sebzés a sebességből, villanás + oldalra lökés, egy lendítés egyszer talál (cooldown), lejárat után újra', () => {
  const W = lashWorld(), got = []; onLash(W.ls, ev => got.push(ev)); const hp0 = W.e.health.hp;
  const evs = stepLash(W.ls, W.ctx, DT); eq(evs.length, 1); eq(evs[0].type, 'lash'); eq(evs[0].enemy, W.e.id); eq(evs[0].player, 1, 'a gyorsabb a lendítő'); near(evs[0].speed, 225, 1e-9);
  near(W.e.health.hp, hp0 - 8.25, 1e-9, 'sebzés = 6 + 0,03·(225-150)'); assert(flashAlpha(W.cs, { kind: 'enemy', ref: W.e }) > 0.9, 'villanás'); const kb = W.cs.kb.get('e' + W.e.id); assert(kb && kb.vy > 0 && Math.abs(kb.vx) < 1e-9, 'oldalra (a fonal mozgása felé) lök');
  eq(got.length, 1); eq(W.ls.stats.lashes, 1); eq(stepLash(W.ls, W.ctx, DT).length, 0, 'cooldown');
  for (let i = 0; i < 60; i++) stepLash(W.ls, W.ctx, DT); assert(W.e.health.hp < hp0 - 8.25 - 1, 'a cooldown után újra talál: ' + W.e.health.hp);
});
test('lash: kapuk – nem feszes fonal, kis swing, kis sebesség, elesett játékos, kikapcsolva, mellé, halott ellenség: nincs találat', () => {
  const none = (mut, label) => { const W = lashWorld(); mut(W); const hp = W.e.health.hp; eq(stepLash(W.ls, W.ctx, DT).length, 0, label); eq(W.e.health.hp, hp, label); };
  none(W => { W.ctx.stretch = 0.5; }, 'laza'); none(W => { W.ps[1].vy = 100; }, 'kis swing'); none(W => { W.e.x = 10; }, 'a forgáspont közelében lassú');
  none(W => { W.ps[0].dead = true; }, 'elesett'); none(W => setLashEnabled(W.ls, false), 'kikapcsolva'); none(W => { W.e.y = 90; }, 'mellé'); none(W => { W.e.state = 'dead'; }, 'halott');
  none(W => { W.ps[0].vy = 300; }, 'együtt csúszás'); none(W => { W.ctx.stretch = undefined; W.ctx.tether = { stretch: { x: 0.2, y: 0.3 } }; }, 'tether.stretch laza');
  const W = lashWorld(); W.ctx.stretch = undefined; W.ctx.tether = { stretch: { x: 0.2, y: 0.9 } }; eq(stepLash(W.ls, W.ctx, DT).length, 1, 'tether.stretch a nagyobbik tengely');
  const V = lashWorld(); eq(setLashEnabled(V.ls, false), false); eq(setLashEnabled(V.ls, true), true); eq(stepLash(V.ls, V.ctx, DT).length, 1);
});
test('lash: halál, védett (i-frame) ellenség, jóváírás, sebzés-határok, több ellenség egy lendítéssel', () => {
  const K = lashWorld(); K.e.health.hp = 3; K.e.hp = 3; const ev = stepLash(K.ls, K.ctx, DT)[0]; eq(ev.killed, true); eq(K.ls.stats.kills, 1); eq(K.cs.kb.size, 0, 'halottat nem lök');
  const B = lashWorld(); setInvulnerable(B.e.health, 1); const eb = stepLash(B.ls, B.ctx, DT); eq(eb[0].type, 'blocked'); eq(eb[0].dealt, 0); eq(B.ls.stats.blocked, 1); eq(stepLash(B.ls, B.ctx, DT).length, 0, 'a védett is cooldownra kerül');
  const c = LASH_CONFIG; eq(lashDamage(c, 0), c.damage); eq(lashDamage(c, 1e9), c.maxDamage); near(lashDamage(c, 250), 9, 1e-9); eq(lashDamage({ damage: 10, perSpeed: 1, minSpeed: 0, maxDamage: 5 }, 100), 10, 'maxDamage >= damage');
  const M = lashWorld(); const e2 = spawnEnemy(M.es, 'boar', 120, 0); const evs = stepLash(M.ls, M.ctx, DT); eq(evs.length, 2); assert(evs.every(x => x.type === 'lash'), 'mindkettő talált'); assert(e2.health.hp < 60);
  const F = lashWorld({ ex: 190 }); F.ps[0].vy = -400; F.ps[1].vy = 300; eq(stepLash(F.ls, F.ctx, DT)[0].player, 0, 'A gyorsabb (400 > 300)');
});
test('lash: konfig-tisztítás, hibás bemenet nem dob, a figyelő hibája nem töri a lépést', () => {
  eq(sanitizeLashConfig(null).damage, LASH_CONFIG.damage); eq(Object.isFrozen(sanitizeLashConfig({})), true);
  const c = sanitizeLashConfig({ damage: -5, minSpeed: NaN, cooldown: 'x', enabled: 'yes', minStretch: 9, perSpeed: 0.5, knock: 10 });
  eq(c.damage, LASH_CONFIG.damage); eq(c.minSpeed, LASH_CONFIG.minSpeed); eq(c.cooldown, LASH_CONFIG.cooldown); eq(c.enabled, true); eq(c.minStretch, 2); eq(c.perSpeed, 0.5); eq(c.knock, 10);
  eq(sanitizeLashConfig({ enabled: false }).enabled, false);
  const ls = createLash(); eq(stepLash(null, {}, DT).length, 0); for (const dt of [NaN, -1, 0, Infinity, 'x', null]) eq(stepLash(ls, {}, dt).length, 0);
  for (const ctx of [null, undefined, 5, {}, { players: [] }, { players: [null, null] }, { players: [lp(0, 0), lp(0, 0)], stretch: 1, enemies: [null, {}, { x: 1, y: 1, health: null }, { x: NaN, y: 0, health: { hp: 1 } }] }]) eq(stepLash(ls, ctx, DT).length, 0);
  eq(ls.lastError, null); eq(onLash(null, () => {})(), undefined); eq(onLash(ls, 5)(), undefined);
  const W = lashWorld(); onLash(W.ls, () => { throw new Error('figyelő'); }); eq(stepLash(W.ls, W.ctx, DT).length, 1); assert(W.ls.lastError, 'a hiba rögzítve'); assert(W.e.health.hp < 30);
  const D = lashWorld(); D.ctx.combat = null; eq(stepLash(D.ls, D.ctx, DT).length, 1, 'combat nélkül is sebez');
  const H = lashWorld(); H.ctx.enemySys = null; H.ctx.enemies = H.es.list; eq(stepLash(H.ls, H.ctx, DT).length, 1, 'enemySys nélkül (lista + Health)');
});
test('lash + póráz: a forgó, feszes fonal tényleg megsebzi az ellenséget a valódi póráz-rendszerrel (B sprintel kör-szerűen, A áll); együtt futva nincs találat', () => {
  const S = mk(), es = createEnemySystem({ seed: 4 }), cs = createCombat(), ls = createLash(), e = spawnEnemy(es, 'boar', 690, 300);
  S.ps[1].speedMul = 2; step(S, [NONE, { x: 0, y: 1 }]); // B 240 px/s-mal oldalra, A áll, a fonal vízszintesen feszes
  const evs = stepLash(ls, { players: S.ps, enemySys: es, tether: S.sys, combat: cs }, DT); eq(evs.length, 1, 'a fonal a vége közelében találta'); eq(evs[0].player, 1); assert(e.health.hp < 60, 'sebződött');
  const T = mk(), es2 = createEnemySystem({ seed: 4 }), ls2 = createLash(); spawnEnemy(es2, 'boar', 560, 300); T.ps[0].speedMul = 2; T.ps[1].speedMul = 2;
  for (let i = 0; i < 40; i++) { step(T, [{ x: 0, y: 1 }, { x: 0, y: 1 }]); eq(stepLash(ls2, { players: T.ps, enemySys: es2, tether: T.sys }, DT).length, 0, 'együtt futva nincs lendítés'); }
});
test('smoke (S073): 600 kocka két szkriptelt játékossal, ellenségekkel, harccal és lendítéssel – nincs kivétel/NaN, a táv a korláton belül, a lendítés és a lökés is előfordul', () => {
  const S = mk({ gap: 200 }), es = createEnemySystem({ seed: 11 }), cs = createCombat(), hs = createPlayerHealths(S.ps), ls = createLash(), ctx = { players: S.ps, healths: hs, enemySys: es, walls: [] };
  const env = { walls: [], healths: hs, hurt: makeHurt(cs, ctx) }; ['boar', 'grunt', 'field_rat', 'grunt'].forEach((t, i) => spawnEnemy(es, t, 520 + i * 40, 280 + (i % 2) * 40));
  S.ps[0].speedMul = 2; S.ps[1].speedMul = 2; const plan = [[1, 0], [0, 1], [-1, 0], [0, -1]]; let lashes = 0, maxX = 0, knockFrames = 0;
  for (let f = 0; f < 600; f++) {
    stepEnemies2(es, S.ps, env); const a = plan[Math.floor(f / 40) % 4], b = plan[Math.floor(f / 55 + 1) % 4];
    step(S, [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }]); if (S.sys.knock.active) knockFrames++; lashes += stepLash(ls, { players: S.ps, enemySys: es, tether: S.sys, combat: cs }, DT).length; stepCombat(cs, ctx, DT); stepPlayerHealths(hs, S.ps, DT);
    for (const p of S.ps) assert([p.x, p.y, p.vx, p.vy].every(Number.isFinite), 'NaN ' + f); const d = dist(S); maxX = Math.max(maxX, d.x); assert(d.x <= L.x + EPS && d.y <= L.y + EPS, 'táv ' + f);
  }
  eq(es.lastError, null); eq(cs.lastError, null); eq(ls.lastError, null); assert(maxX > 100, 'a póráz mozgott'); assert(knockFrames > 20, 'a játékosok visszalökést kaptak: ' + knockFrames); assert(lashes > 0 && ls.stats.lashes === lashes, 'a fonal lendített: ' + lashes);
});
