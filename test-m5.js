// S075 – M5 playteszt (automata): a harc ritka, rövid, és a póráz-érzet harc közben megmarad.
// Valódi modulokkal, szkriptelt játékosokkal; a felhasználó nem játszik (S185-ig csak feltölt).
// Importja: test-index.js + a harc-lánc modulai (ugyanaz a sorrend, mint a main.js update-jében).
import { test, assert, eq } from './test-index.js';
import { createPlayer, PLAYER_SPEED } from './game-player.js';
import { createCharacterRegistry } from './game-registry.js';
import { applyCharacter } from './game-charselect.js';
import { createAbilitySystem, castAbility, stepAbilities, ensurePools } from './game-ability.js';
import { createPlayerHealths, stepPlayerHealths, killHealth, healthRatio } from './game-health.js';
import { createEnemySystem, spawnEnemy, stepEnemies, enemiesNear, damageEnemy, pushEnemy } from './game-enemy.js';
import { createCombat, makeHurt, stepCombat, attachCombat } from './game-combat.js';
import { attachWarrior } from './game-warrior.js';
import { attachWizard, stepWizard } from './game-wizard.js';
import { attachRanger, stepRanger } from './game-ranger.js';
import { createRevive, reviveGate, stepRevive } from './game-revive.js';
import { createCombatHud, connectCombatHud, stepCombatHud, visibleNumbers, enemyBars, COMBATHUD_CONFIG } from './game-combathud.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { WORLD_SEED, createWorldStream, warmStream, updateStream, streamWalls, findOpenSpot, getStreamTile } from './world-stream.js';
import { createSpawner, stepSpawner } from './game-spawn.js';
import { loadMacroMap } from './world-macro.js';
import { MACRO_MAP } from './data-macro.js';
import { isSolidId } from './world-tiles.js';

const DT = 1 / 60, EPS = 1e-6, reg = createCharacterRegistry(), MM = loadMacroMap(MACRO_MAP);
const atk = cls => (cls === 'wizard' ? 'ignite' : cls === 'ranger' ? 'shoot' : 'strike'); // az alap-támadás (a harcos/gyógyító a strike-ot használja)
const lcg = seed => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const near2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// A harc-lánc a main.js sorrendjében: póráz -> képességek -> ellenfelek -> harc -> HP -> HUD -> élesztés.
function rig({ cls = ['warrior', 'ranger'], at = [[400, 300], [520, 300]], foes = [], L = { x: 864, y: 444 }, seed = 5, walls = [] } = {}) {
  const ps = at.map(([x, y], i) => createPlayer(i, x, y)); applyCharacter(reg, ps[0], 'dwarf', cls[0]); applyCharacter(reg, ps[1], 'elf', cls[1]);
  const hs = createPlayerHealths(ps), es = createEnemySystem({ seed }), cs = createCombat(), ch = createCombatHud(), rv = createRevive({ checkpoint: { id: 'sorsko', x: 200, y: 200 } });
  const sys = createAbilitySystem({ reg, hooks: { enemies: (o, r) => enemiesNear(es, o, r) } });
  const env = { players: ps, enemies: (o, r) => enemiesNear(es, o, r), damage: (e, a, i) => damageEnemy(es, e, a, i), push: (e, dx, dy, d) => pushEnemy(e, dx, dy, d, walls), solid: () => false, freeze: (e, s) => { e.frozen = s; }, mark: (e, s) => { e.tracked = s; } };
  const wz = attachWizard(sys, env), rg = attachRanger(sys, env); attachWarrior(sys, env); attachCombat(sys, cs, { players: ps });
  const ts = createTetherSystem({ L, k: 0.5, walls }), ctx = { players: ps, healths: hs, enemySys: es, walls };
  connectCombatHud(ch, { players: ps, healths: hs, enemySys: es });
  for (const [t, x, y] of foes) spawnEnemy(es, t, x, y);
  return { ps, hs, es, cs, ch, rv, sys, wz, rg, ts, ctx, L, walls, hurt: makeHurt(cs, ctx), t: 0, f: 0, hold: 0, maxHold: 0, maxD: { x: 0, y: 0 }, inputs: [{ x: 0, y: 0 }, { x: 0, y: 0 }], interact: [false, false] };
}
const nearest = (S, p) => S.es.list.filter(e => e.state !== 'dead').sort((a, b) => near2(a, p) - near2(b, p))[0];
function botInputs(S, mode = 'fight') { // a bot a legközelebbi ellenfél felé megy, 44 px-ről üt; az elesett áll
  return S.ps.map(p => {
    p._f = null; if (S.hs[p.index].dead || mode === 'idle') return { x: 0, y: 0 };
    const e = nearest(S, p); if (!e) return { x: 0, y: 0 };
    const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1; p._f = { x: dx / d, y: dy / d }; return d > 44 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 };
  });
}
function frame(S, inp) {
  S.inputs = inp;
  const gated = reviveGate(S.rv, inp.map((v, i) => ({ ...v, interact: !!S.interact[i], interactPressed: false })), S.ps); // az elesett bemenete üres, de a pórázon húzható
  stepTetherSystem(S.ts, S.ps, gated, DT);
  S.ps.forEach((p, i) => { if (p._f && !S.hs[i].dead) { ensurePools(S.sys, p); castAbility(S.sys, S.ps, i, atk(p.class), { facing: p._f }); } });
  stepAbilities(S.sys, S.ps, [{}, {}], [], DT, {}); stepWizard(S.wz, DT); stepRanger(S.rg, DT);
  stepRevive(S.rv, { players: S.ps, healths: S.hs, inputs: S.interact.map(v => ({ interact: v })) }, DT);
  stepEnemies(S.es, S.ps, DT, { walls: S.walls, solidTile: S.solidTile || (() => false), healths: S.hs, hurt: S.hurt }); stepCombat(S.cs, S.ctx, DT); stepPlayerHealths(S.hs, S.ps, DT); stepCombatHud(S.ch, DT);
  S.f++; S.t += DT; S.hold = S.ts.mode && S.ts.mode.x === 'hold' ? S.hold + 1 : 0; S.maxHold = Math.max(S.maxHold, S.hold);
  const d = { x: Math.abs(S.ps[1].x - S.ps[0].x), y: Math.abs(S.ps[1].y - S.ps[0].y) }; S.maxD.x = Math.max(S.maxD.x, d.x); S.maxD.y = Math.max(S.maxD.y, d.y);
  assert(S.ps.every(p => [p.x, p.y, p.vx, p.vy].every(Number.isFinite)), 'NaN a ' + S.f + '. kockán');
  assert(d.x <= S.L.x + 0.01 && d.y <= S.L.y + 0.01, `a fonal elszakadt (${S.f}): ${d.x.toFixed(1)},${d.y.toFixed(1)}`);
}
function fight(S, maxSecs) { let low = 100; for (let i = 0; i < maxSecs * 60 && S.es.list.length; i++) { frame(S, botInputs(S)); for (const p of S.ps) low = Math.min(low, healthRatio(S.hs[p.index]) * 100); } return { secs: S.t, low, left: S.es.list.length }; }

// ---- 1. A harc ritka ----
function walkRun(seed, frames) { // 3 perc kóborlás a rétben: a bot csak akkor áll meg, ha ellenfél üldözi/támad
  const ws = createWorldStream(seed), spot = findOpenSpot(seed, 0, 0), S = rig({ at: [[spot.x, spot.y], [spot.x + 60, spot.y]], seed: 11 });
  warmStream(ws, S.ps); let walls = streamWalls(ws), ver = ws.version; S.ts.cfg.walls = walls; S.ctx.walls = walls; S.walls = walls;
  const sp = createSpawner({ mm: MM, seed }), safe = [{ x: spot.x, y: spot.y, r: 800 }], r = lcg(seed + 9);
  S.solidTile = (tx, ty) => { const id = getStreamTile(ws, tx, ty); return id < 0 || isSolidId(id); }; let hd = 0, lx = spot.x, ly = spot.y, combat = 0, enc = 0, inEnc = false, encF = 0, longest = 0, low = 100;
  for (let f = 0; f < frames; f++) {
    const eng = S.es.list.filter(e => e.state === 'chase' || e.state === 'attack'); if (eng.length) { combat++; encF++; if (!inEnc) { enc++; inEnc = true; } longest = Math.max(longest, encF); } else { inEnc = false; encF = 0; }
    if (f % 30 === 0) { if (near2(S.ps[0], { x: lx, y: ly }) < 15) hd = r() * 6.283; lx = S.ps[0].x; ly = S.ps[0].y; } if (f % 240 === 0) hd = r() * 6.283;
    const ox = S.ps[0].x - spot.x, oy = S.ps[0].y - spot.y; if (Math.hypot(ox, oy) > 2400) hd = Math.atan2(-oy, -ox);
    const inp = S.ps.map(p => { p._f = null; if (S.hs[p.index].dead) return { x: 0, y: 0 }; const e = eng.slice().sort((a, b) => near2(a, p) - near2(b, p))[0];
      if (e) { const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1; p._f = { x: dx / d, y: dy / d }; return d > 44 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 }; }
      return { x: Math.cos(hd), y: Math.sin(hd) }; });
    updateStream(ws, S.ps); if (ws.version !== ver) { ver = ws.version; walls = streamWalls(ws); S.ts.cfg.walls = walls; S.ctx.walls = walls; S.walls = walls; }
    stepSpawner(sp, S.es, S.ps, DT, { tileAt: (tx, ty) => getStreamTile(ws, tx, ty), walls, safe });
    frame(S, inp); low = Math.min(low, ...S.ps.map(p => healthRatio(S.hs[p.index]) * 100));
  }
  return { combat: combat / frames, enc, longest: longest / 60, low, spawned: sp.stats.spawned, wipes: S.rv.stats.wipes, snap: JSON.stringify([sp.stats, S.es.stats, S.ps.map(p => [Math.round(p.x), Math.round(p.y)])]) };
}
test('m5: a harc ritka – 3 perc kóborlás a rétben 3 seeden: az idő kis része harc, az ütközetek rövidek, a játékosok nem esnek el', () => {
  let tot = 0, encs = 0;
  for (const seed of [WORLD_SEED, 777, 4242]) {
    const a = walkRun(seed, 60 * 180);
    assert(a.combat <= 0.08, `seed ${seed}: túl sok harc: ${(a.combat * 100).toFixed(1)}%`); assert(a.longest <= 8, `seed ${seed}: túl hosszú egyetlen ütközet: ${a.longest.toFixed(1)} mp`);
    assert(a.low >= 60, `seed ${seed}: a bot majdnem elesett: ${a.low.toFixed(0)}%`); eq(a.wipes, 0, 'nincs visszatérés a rétben'); assert(a.spawned > 0, 'születtek ellenfelek'); tot += a.combat; encs += a.enc;
  }
  assert(tot / 3 <= 0.05, 'átlagos harc-arány: ' + ((tot / 3) * 100).toFixed(1) + '%'); assert(encs / 9 <= 1.5, 'ütközet/perc: ' + (encs / 9).toFixed(1));
  const x = walkRun(WORLD_SEED, 60 * 60), y = walkRun(WORLD_SEED, 60 * 60); eq(x.snap, y.snap, 'determinisztikus');
});

// ---- 2. A harc rövid ----
test('m5: a harc rövid – minden kaszt-páros egyetlen vaddisznót ≤ 12 mp, patkányt ≤ 3 mp alatt győz le, a játékosok HP-ja ≥ 60% marad', () => {
  const pairs = [['warrior', 'warrior'], ['warrior', 'ranger'], ['wizard', 'ranger'], ['wizard', 'healer'], ['ranger', 'healer'], ['healer', 'healer']];
  for (const cls of pairs) for (const [type, maxSecs, minHp] of [['boar', 12, 60], ['field_rat', 3, 85]]) {
    const S = rig({ cls, foes: [[type, 580, 300]] }), r = fight(S, 30); eq(r.left, 0, `${cls}: ${type} nem halt meg`);
    assert(r.secs <= maxSecs, `${cls} vs ${type}: ${r.secs.toFixed(1)} mp`); assert(r.low >= minHp, `${cls} vs ${type}: HP ${r.low.toFixed(0)}%`);
  }
});
test('m5: kis csoport (vaddisznó + 2 patkány) sem húzódik el – ≤ 25 mp, senki nem esik el, a fonal végig a korláton belül', () => {
  for (const cls of [['warrior', 'ranger'], ['wizard', 'healer']]) {
    const S = rig({ cls, foes: [['boar', 580, 280], ['field_rat', 600, 330], ['field_rat', 620, 300]] }), r = fight(S, 40);
    eq(r.left, 0, 'mind meghalt'); assert(r.secs <= 25, `${cls}: ${r.secs.toFixed(1)} mp`); assert(S.hs.every(h => !h.dead) && r.low >= 40, 'HP ' + r.low.toFixed(0) + '%'); assert(S.es.stats.killed === 3 || S.es.stats.spawned === 3, 'statisztika');
  }
});

// ---- 3–4. A póráz-érzet harc közben ----
test('m5: póráz harc közben – szűk fonal, a vaddisznó a két játékos között: a táv végig L_eff-en belül, nincs tartós holtpont, a lökés megtörténik, a harc véget ér', () => {
  const L = { x: 300, y: 200 }, S = rig({ L, at: [[400, 300], [600, 300]], foes: [['boar', 500, 300]] }), r = fight(S, 20);
  eq(r.left, 0, 'a harc véget ért'); assert(S.cs.stats.knocks > 0 || S.es.stats.hits === 0, 'a találat lökést ad'); assert(S.maxHold <= 30, 'tartós holtpont: ' + S.maxHold + ' kocka'); assert(S.maxD.x <= L.x + 0.01 && S.maxD.y <= L.y + 0.01, 'korlát');
  const T = rig({ L, at: [[400, 300], [600, 300]], foes: [['boar', 380, 300], ['field_rat', 620, 300]], cls: ['wizard', 'warrior'] }), q = fight(T, 25);
  eq(q.left, 0); assert(T.maxHold <= 30, 'holtpont (két oldali ellenfél): ' + T.maxHold); assert(T.es.stats.hits > 0 && T.cs.stats.knocks > 0, 'volt találat és lökés: ' + JSON.stringify(T.cs.stats));
});
test('m5: menekülés a pórázzal – ha a társ követ, a menekülő elszakad a vaddisznótól; ha a társ áll, a feszes fonal lassítja (nem állítja meg) és a társat viszi', () => {
  const run = follow => {
    const S = rig({ L: { x: 300, y: 200 }, at: [[700, 300], [600, 300]], foes: [['boar', 780, 300]], cls: ['warrior', 'warrior'] }), d0 = near2(S.es.list[0], S.ps[0]), x1 = S.ps[1].x; let minV = Infinity, slow = 0;
    for (let i = 0; i < 6 * 60; i++) { frame(S, [{ x: -1, y: 0 }, { x: follow ? -1 : 0, y: 0 }]); if (S.ts.stretch.x > 0.99 && !follow) { slow++; minV = Math.min(minV, Math.abs(S.ps[0].vx)); } }
    return { gap: near2(S.es.list[0] || { x: 0, y: 0 }, S.ps[0]) - d0, moved: x1 - S.ps[1].x, minV, slow, S };
  };
  const f = run(true); assert(f.gap > 120, 'a menekülő elszakadt: +' + f.gap.toFixed(0)); assert(f.S.hs[0].hp >= 85, 'közben alig sebződött: ' + f.S.hs[0].hp);
  const s = run(false); assert(s.slow > 60, 'a fonal megfeszült: ' + s.slow); assert(s.minV > 5 && s.minV < PLAYER_SPEED * 0.8, 'lassul, de nem áll meg: ' + s.minV.toFixed(1)); assert(s.moved > 40, 'a társat viszi: ' + s.moved.toFixed(0));
});

// ---- 5. Elesés, élesztés, visszatérés ----
test('m5: elesés a harcban – az elesett nem game over; a társ megöli a vaddisznót, majd tartott gombbal élesztheti (30% HP); mindketten elesve a pár a Sorskőhöz tér vissza', () => {
  const S = rig({ foes: [['boar', 580, 300]] }); killHealth(S.hs[0]); const hits0 = S.es.stats.hits;
  for (let i = 0; i < 20 * 60 && S.es.list.length; i++) { frame(S, botInputs(S)); assert(S.hs[0].dead, 'az elesett addig is elesett'); }
  eq(S.es.list.length, 0, 'a társ megölte'); assert(S.es.stats.hits >= hits0, 'sosem negatív'); S.ps[1].x = S.ps[0].x + 30; S.ps[1].y = S.ps[0].y; S.interact[1] = true;
  for (let i = 0; i < 4 * 60 && S.hs[0].dead; i++) frame(S, [{ x: 0, y: 0 }, { x: 0, y: 0 }]);
  eq(S.hs[0].dead, false, 'felélesztve'); assert(Math.abs(healthRatio(S.hs[0]) - 0.3) < 0.05, 'HP 30%: ' + healthRatio(S.hs[0])); eq(S.rv.stats.revives, 1);
  const W = rig({ foes: [['boar', 470, 300], ['boar', 440, 330]], cls: ['wizard', 'healer'] }); for (const h of W.hs) { h.hp = 1; } let wiped = false;
  for (let i = 0; i < 20 * 60 && !wiped; i++) { frame(W, [{ x: 0, y: 0 }, { x: 0, y: 0 }]); wiped = W.rv.stats.wipes > 0; }
  assert(wiped, 'a páros elesés után visszatérés'); assert(W.ps.every(p => near2(p, { x: 200, y: 200 }) < 140), 'a Sorskő mellett: ' + W.ps.map(p => near2(p, { x: 200, y: 200 }).toFixed(0))); assert(W.hs.every(h => !h.dead), 'nincs game over');
});

// ---- 6. A harc-HUD olvasható ----
test('m5: harc-HUD – az ellenség életcsíkja és a sebzés-számok a harc alatt legalább az egyik nézetben látszanak, korlátosak, nem NaN', () => {
  const S = rig({ foes: [['boar', 580, 300], ['field_rat', 600, 330]], cls: ['wizard', 'warrior'] }); let bars = 0, nums = 0, maxN = 0; const view = p => ({ x: p.x - 240, y: p.y - 270 });
  for (let i = 0; i < 20 * 60 && S.es.list.length; i++) {
    frame(S, botInputs(S)); for (const p of S.ps) { const o = view(p); bars += enemyBars(S.ch, S.es, o.x, o.y, 480, 540).length; nums += visibleNumbers(S.ch, o.x, o.y, 480, 540).length; }
    maxN = Math.max(maxN, S.ch.numbers.length); assert(S.ch.numbers.every(n => [n.x, n.y, n.amount].every(Number.isFinite)), 'NaN szám');
  }
  assert(bars > 30 && nums > 5, `látszott: csík ${bars}, szám ${nums}`); assert(maxN <= COMBATHUD_CONFIG.numbers.max, 'számok korlátosak'); eq(S.ch.lastError, null);
});

// ---- 7. Smoke ----
test('smoke (S075): 3 kaszt-páros × 900 kocka – szkriptelt harc (vaddisznó + patkányok), póráz, HUD, élesztés; nincs kivétel/NaN, a táv a korláton belül, determinisztikus', () => {
  const run = () => { const out = []; for (const cls of [['warrior', 'ranger'], ['wizard', 'healer'], ['ranger', 'warrior']]) {
    const S = rig({ cls, L: { x: 400, y: 260 }, foes: [['boar', 560, 280], ['field_rat', 600, 330], ['boar', 640, 300], ['field_rat', 520, 340]], seed: 21 }), r = lcg(5);
    for (let i = 0; i < 900; i++) { const b = botInputs(S); if (i % 90 < 20) b[1] = { x: Math.round(r() * 2 - 1), y: Math.round(r() * 2 - 1) }; frame(S, b); }
    eq(S.es.lastError, null); eq(S.cs.lastError, null); eq(S.ch.lastError, null); assert(S.maxD.x > 60, 'a fonal mozgott');
    out.push([S.es.stats, S.cs.stats, S.hs.map(h => Math.round(h.hp)), S.ps.map(p => [Math.round(p.x), Math.round(p.y)]), S.rv.stats]); } return JSON.stringify(out); };
  eq(run(), run(), 'determinisztikus');
});
