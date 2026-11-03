import { test, assert, eq, near } from './test-index.js';
import * as Player from './game-player.js';
import { createPlayer, desiredVelocity, applyVelocity, PLAYER_SPEED, PLAYER_COLORS } from './game-player.js';
import { createTetherSystem, stepTetherSystem, TETHER_CONFIG, pullFactor, applyKHook, ensureStamina, stepPullStamina, PULL_STAMINA } from './tether-system.js';
import { createCamera, stepCamera } from './game-camera.js';
import { Input } from './core-input.js';

function fakeTarget() {
  const h = {};
  return { addEventListener: (t, f) => { h[t] = f; }, fire: (t, e) => h[t] && h[t](e) };
}
// Egy játékos mozgatása a kívánt sebességgel (póráz nélkül, a játékos-logika tesztjéhez).
function move(p, inp, dt) {
  const v = desiredVelocity(p, inp);
  applyVelocity(p, v.x, v.y, dt);
}
const FREE = { L: 1e9, k: 0.5 };      // gyakorlatilag nincs póráz
const DT = 1 / 60;
const EPS = 1e-6;

test('player: P1 kék, P2 piros', () => {
  eq(createPlayer(0, 0, 0).color, PLAYER_COLORS[0]);
  eq(createPlayer(1, 0, 0).color, PLAYER_COLORS[1]);
  assert(PLAYER_COLORS[0] !== PLAYER_COLORS[1]);
});
test('player: mozgás az inputból', () => {
  const p = createPlayer(0, 10, 10);
  move(p, { x: 1, y: 0 }, 0.5);
  near(p.x, 10 + PLAYER_SPEED * 0.5); near(p.y, 10);
  move(p, { x: 0, y: -1 }, 0.5);
  near(p.y, 10 - PLAYER_SPEED * 0.5);
});
test('player: nincs input -> áll', () => {
  const p = createPlayer(1, 5, 5);
  move(p, { x: 0, y: 0 }, 1);
  eq(p.x, 5); eq(p.y, 5);
});
test('player: átlós sebesség nem nagyobb', () => {
  const v = desiredVelocity(createPlayer(0, 0, 0), { x: Math.SQRT1_2, y: Math.SQRT1_2 });
  near(Math.hypot(v.x, v.y), PLAYER_SPEED, 1e-6);
});
test('player: önállóan nem mozog (nincs stepPlayer, csak a póráz ad sebességet)', () => {
  eq(Player.stepPlayer, undefined);
  const p = createPlayer(0, 7, 7);
  desiredVelocity(p, { x: 1, y: 1 });
  eq(p.x, 7); eq(p.y, 7);
});
test('player: a két játékos külön mozog (billentyűzet, póráz-rendszeren át)', () => {
  const t = fakeTarget();
  const input = new Input(t);
  const ps = [createPlayer(0, 100, 100), createPlayer(1, 200, 100)];
  const sys = createTetherSystem(FREE);
  const run = () => { for (let i = 0; i < 60; i++) { input.update(); stepTetherSystem(sys, ps, [input.get(0), input.get(1)], DT); } };
  t.fire('keydown', { code: 'KeyD', preventDefault() {} });
  run();
  near(ps[0].x, 100 + PLAYER_SPEED, 1e-6); eq(ps[1].x, 200);
  t.fire('keyup', { code: 'KeyD' });
  t.fire('keydown', { code: 'ArrowDown', preventDefault() {} });
  run();
  near(ps[1].y, 100 + PLAYER_SPEED, 1e-6); near(ps[0].x, 100 + PLAYER_SPEED, 1e-6);
});
test('player: szimuláció 600 kocka, nincs NaN', () => {
  const ps = [createPlayer(0, 0, 0), createPlayer(1, 50, 50)];
  const sys = createTetherSystem();
  for (let i = 0; i < 600; i++) {
    const a = { x: Math.cos(i / 20), y: Math.sin(i / 20) };
    stepTetherSystem(sys, ps, [a, a], DT);
  }
  ps.forEach(p => assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN'));
});

// --- póráz-rendszer (S006) ---
test('tether-system: alap L_eff a kamera látómezejéből jön', () => {
  near(TETHER_CONFIG.L.x, 864); near(TETHER_CONFIG.L.y, 444);
});
test('tether-system: korlát alatt szabad mozgás, mindkét játékos a saját sebességével', () => {
  const ps = [createPlayer(0, 400, 270), createPlayer(1, 500, 270)];
  const sys = createTetherSystem();
  stepTetherSystem(sys, ps, [{ x: -1, y: 0 }, { x: 0, y: 1 }], DT);
  near(ps[0].x, 400 - PLAYER_SPEED * DT, EPS); near(ps[0].vx, -PLAYER_SPEED);
  near(ps[1].y, 270 + PLAYER_SPEED * DT, EPS); near(ps[1].x, 500, EPS);
  eq(sys.mode.x, 'free');
});
test('tether-system: az egyik húz, a másik áll -> lassul (k), és elhúzza a társat', () => {
  const ps = [createPlayer(0, 400, 300), createPlayer(1, 500, 300)];
  const sys = createTetherSystem({ L: { x: 200, y: 200 }, k: 0.5 });
  const still = { x: 0, y: 0 };
  let sawPull = false;
  for (let f = 0; f < 200; f++) {
    stepTetherSystem(sys, ps, [{ x: -1, y: 0 }, still], DT);
    assert(Math.abs(ps[1].x - ps[0].x) <= 200 + EPS, 'túllépte L_eff-et: ' + (ps[1].x - ps[0].x));
    if (sys.mode.x === 'pull-a') sawPull = true;
  }
  assert(sawPull, 'nem lépett életbe a húzás');
  near(ps[0].vx, -PLAYER_SPEED * 0.5, 1e-9); near(ps[1].vx, -PLAYER_SPEED * 0.5, 1e-9);
  assert(ps[1].x < 500 - 1, 'a társ nem lett elhúzva');
  near(ps[0].y, 300); near(ps[1].y, 300);
});
test('tether-system: mindketten kifelé húznak -> holtpont, mindketten megállnak', () => {
  const ps = [createPlayer(0, 400, 300), createPlayer(1, 500, 300)];
  const sys = createTetherSystem({ L: { x: 100, y: 100 }, k: 0.5 });
  for (let f = 0; f < 30; f++) stepTetherSystem(sys, ps, [{ x: -1, y: 0 }, { x: 1, y: 0 }], DT);
  eq(sys.mode.x, 'hold');
  near(ps[0].vx, 0); near(ps[1].vx, 0);
  near(ps[1].x - ps[0].x, 100, 1e-6);
});
test('tether-system: a társ követése megszünteti a büntetést', () => {
  const ps = [createPlayer(0, 400, 300), createPlayer(1, 500, 300)];
  const sys = createTetherSystem({ L: { x: 100, y: 100 }, k: 0.5 });
  stepTetherSystem(sys, ps, [{ x: -1, y: 0 }, { x: -1, y: 0 }], DT);
  eq(sys.mode.x, 'free');
  near(ps[0].vx, -PLAYER_SPEED); near(ps[1].vx, -PLAYER_SPEED);
});
test('tether-system: az L_eff függvény futásidőben változtatható', () => {
  const ps = [createPlayer(0, 400, 300), createPlayer(1, 500, 300)];
  let L = 300;
  const sys = createTetherSystem({ L: () => L });
  for (let f = 0; f < 120; f++) stepTetherSystem(sys, ps, [{ x: -1, y: 0 }, { x: 0, y: 0 }], DT);
  assert(Math.abs(ps[1].x - ps[0].x) <= 300 + EPS);
  L = 150; // szűkülés: a távolság nem nőhet
  const d0 = Math.abs(ps[1].x - ps[0].x);
  for (let f = 0; f < 60; f++) {
    stepTetherSystem(sys, ps, [{ x: -1, y: 0 }, { x: 0, y: 0 }], DT);
    assert(Math.abs(ps[1].x - ps[0].x) <= d0 + EPS, 'a távolság nőtt');
  }
  eq(sys.L.x, 150);
});
test('tether-system: az input nem módosul, hiányzó input -> áll', () => {
  const ps = [createPlayer(0, 10, 10), createPlayer(1, 60, 10)];
  const sys = createTetherSystem();
  const a = { x: 1, y: 0 };
  stepTetherSystem(sys, ps, [a, undefined], DT);
  eq(a.x, 1); eq(a.y, 0); eq(ps[1].x, 60);
});
test('tether-system: 600 kocka szkriptelt játékossal, távolság <= L_eff, nincs NaN, a kamera követi', () => {
  const ps = [createPlayer(0, 400, 270), createPlayer(1, 540, 270)];
  const sys = createTetherSystem();
  const cam = createCamera(470, 270);
  const L = sys.cfg.L;
  let stretched = false;
  for (let f = 0; f < 600; f++) {
    const a = f < 400 ? { x: -1, y: -0.3 } : { x: 1, y: 0.3 };
    const b = f < 400 ? { x: 1, y: 0.3 } : { x: -1, y: -0.3 };
    stepTetherSystem(sys, ps, [a, b], DT);
    stepCamera(cam, ps[0], ps[1], DT);
    for (const p of ps) assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN a ' + f + '. kockában');
    assert(Number.isFinite(cam.x) && Number.isFinite(cam.y), 'NaN kamera');
    const dx = Math.abs(ps[1].x - ps[0].x), dy = Math.abs(ps[1].y - ps[0].y);
    assert(dx <= L.x + EPS && dy <= L.y + EPS, `L_eff túllépve a ${f}. kockában: ${dx}, ${dy}`);
    if (sys.mode.x === 'hold') stretched = true;
  }
  assert(stretched, 'a szkript nem feszítette meg a pórázt');
});

// --- k-hook és húzás-stamina (S010) ---
// A (400,300) és B (500,300) a korlátnál (L=100); A balra húz (PULL_A) vagy B jobbra (PULL_B).
const PULL_A = [{ x: -1, y: 0 }, { x: 0, y: 0 }], PULL_B = [{ x: 0, y: 0 }, { x: 1, y: 0 }], STILL = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
function atLimit(cfg = {}, mutA = {}, mutB = {}) {
  const ps = [Object.assign(createPlayer(0, 400, 300), mutA), Object.assign(createPlayer(1, 500, 300), mutB)];
  return { ps, sys: createTetherSystem({ L: 100, k: 0.5, ...cfg }) };
}
function run(sys, ps, inp, n) { for (let i = 0; i < n; i++) stepTetherSystem(sys, ps, inp, DT); }

test('k-hook: alapértelmezett játékosokkal a bázis k-t adja (identitás)', () => {
  const { ps, sys } = atLimit();
  stepTetherSystem(sys, ps, PULL_A, DT);
  eq(sys.k.a, 0.5); eq(sys.k.b, 0.5); near(ps[0].vx, -PLAYER_SPEED * 0.5, 1e-9);
});
test('k-hook: a húzó ereje szorozza a k-t, 1-nél levágva', () => {
  let { ps, sys } = atLimit({}, { strength: 1.5 });
  stepTetherSystem(sys, ps, PULL_A, DT);
  near(sys.k.a, 0.75, 1e-12); near(ps[0].vx, -90, 1e-9); eq(sys.k.b, 0.5);
  ({ ps, sys } = atLimit({}, {}, { strength: 0.5 }));
  stepTetherSystem(sys, ps, PULL_B, DT);
  near(sys.k.b, 0.25, 1e-12); near(ps[1].vx, 30, 1e-9); eq(sys.k.a, 0.5);
  ({ ps, sys } = atLimit({}, { strength: 4 }));
  stepTetherSystem(sys, ps, PULL_A, DT);
  eq(sys.k.a, 1); near(ps[0].vx, -PLAYER_SPEED, 1e-9);
  ({ ps, sys } = atLimit({}, { strength: 0 }));
  stepTetherSystem(sys, ps, PULL_A, DT);
  eq(sys.k.a, 0); near(ps[0].vx, 0, 1e-9); near(ps[1].vx, 0, 1e-9);
});
test('k-hook: a húzott súlya + inventory-terhe lassít (a szorzó határai: 0.25..4)', () => {
  const k = (a, b) => { const { ps, sys } = atLimit({}, a, b); stepTetherSystem(sys, ps, PULL_A, DT); return sys.k; };
  near(k({}, { weight: 2 }).a, 0.25, 1e-12);          // dupla súly: fele sebesség-szorzó
  near(k({}, { load: 1 }).a, 0.25, 1e-12);            // a teher a súllyal azonos módon számít
  near(k({}, { weight: 1, load: 1 }).a, 0.25, 1e-12);
  near(k({}, { load: 99 }).a, 0.125, 1e-12);          // szélsőséges teher: a szorzó alsó határa
  eq(k({}, { weight: 0.5 }).a, 1);                    // könnyű társ: 0.5*2 = 1
  eq(k({}, { weight: 0.01 }).a, 1);                   // felső határ 4 -> 2 -> levágva 1-re
  eq(k({}, { weight: 3 }).b, 0.5);                    // a másik irány nem változik (A súlya a B húzását számítja)
  near(k({ load: 1 }, {}).b, 0.25, 1e-12);
});
test('k-hook: terep a húzó helyén (szám vagy függvény), hibás érték -> 1', () => {
  const k = (terrain, a, b) => { const { ps, sys } = atLimit({ terrain }, a, b); stepTetherSystem(sys, ps, PULL_A, DT); return sys.k; };
  near(k(0.5).a, 0.25, 1e-12); near(k(0.5).b, 0.25, 1e-12);
  const t = k(p => (p.x < 450 ? 0.5 : 1));            // A (x=400) mocsarában, B (x=500) szilárd talajon
  near(t.a, 0.25, 1e-12); eq(t.b, 0.5);
  eq(k(0).a, 0);
  for (const bad of [NaN, undefined, 'x', null, Infinity, () => NaN]) eq(k(bad).a, 0.5, String(bad));
  near(k(-3).a, 0, 1e-12);                            // negatív terep -> 0, nem fordul meg
});
test('k-hook: összetett képlet erő · súly-szorzó · terep, bázis k-val', () => {
  const { ps, sys } = atLimit({ terrain: 0.8 }, { strength: 1.2 }, { weight: 1.5, load: 0.5 });
  stepTetherSystem(sys, ps, PULL_A, DT);
  near(sys.k.a, 0.5 * 1.2 * 0.5 * 0.8, 1e-12);
  const s2 = atLimit({ k: { a: 0.6, b: 0.2 } }); stepTetherSystem(s2.sys, s2.ps, PULL_A, DT);
  near(s2.sys.k.a, 0.6, 1e-12); near(s2.sys.k.b, 0.2, 1e-12);
});
test('k-hook: hibás / szélső mezők mindig véges, nemnegatív k-t adnak', () => {
  const vals = [NaN, undefined, -5, 0, 1, Infinity, 1e9, 'x'];
  for (const s of vals) for (const w of vals) for (const l of vals) for (const t of vals) {
    const f = pullFactor({ strength: s }, { weight: w, load: l }, t, false);
    assert(Number.isFinite(f) && f >= 0, `pullFactor ${s},${w},${l},${t}: ${f}`);
    const k = applyKHook({ a: 0.5, b: 0.5 }, [{ strength: s, weight: w, load: l }, { strength: l, weight: s, load: w }], { terrain: t });
    assert(k.a >= 0 && k.a <= 1 && k.b >= 0 && k.b <= 1, `k tartományon kívül: ${k.a}, ${k.b}`);
  }
});

test('stamina: kikapcsolva nincs költség, a mezők teliek', () => {
  const { ps, sys } = atLimit();
  run(sys, ps, PULL_A, 120);
  eq(ps[0].stamina, PULL_STAMINA.max); eq(ps[0].exhausted, false); eq(sys.stamina.a.value, PULL_STAMINA.max);
});
test('stamina: bekapcsolva csak a húzó fogyaszt (pull-a / pull-b), a társ nem', () => {
  let { ps, sys } = atLimit({ pullStamina: true });
  run(sys, ps, PULL_A, 60);
  eq(sys.mode.x, 'pull-a'); near(ps[0].stamina, 100 - PULL_STAMINA.cost, 1e-6); eq(ps[1].stamina, 100);
  ({ ps, sys } = atLimit({ pullStamina: () => true }));
  run(sys, ps, PULL_B, 30);
  eq(sys.mode.x, 'pull-b'); near(ps[1].stamina, 100 - PULL_STAMINA.cost / 2, 1e-6); eq(ps[0].stamina, 100);
  near(sys.stamina.b.value, ps[1].stamina, 1e-12); eq(sys.stamina.b.max, 100);
});
test('stamina: holtpontban és szabad mozgásban nincs költség, regenerál', () => {
  let { ps, sys } = atLimit({ pullStamina: true }, { stamina: 50 }, { stamina: 50 });
  run(sys, ps, [{ x: -1, y: 0 }, { x: 1, y: 0 }], 60);
  eq(sys.mode.x, 'hold'); near(ps[0].stamina, 50 + PULL_STAMINA.regen, 1e-6); near(ps[1].stamina, 65, 1e-6);
  ({ ps, sys } = atLimit({ pullStamina: true, L: 1000 }, { stamina: 100 }));
  run(sys, ps, PULL_A, 30); eq(sys.mode.x, 'free'); eq(ps[0].stamina, 100); // a teli nem megy a max fölé
});
test('stamina: kimerülés (0), a k felére esik, felépülés hiszterézissel', () => {
  const { ps, sys } = atLimit({ pullStamina: true });
  run(sys, ps, PULL_A, 310);                          // 100 / (20/s) = 5 s = 300 kocka
  eq(ps[0].stamina, 0); eq(ps[0].exhausted, true); eq(sys.stamina.a.exhausted, true);
  stepTetherSystem(sys, ps, PULL_A, DT);
  near(sys.k.a, 0.25, 1e-12); near(ps[0].vx, -PLAYER_SPEED * 0.25, 1e-9); eq(ps[0].stamina, 0);
  run(sys, ps, STILL, 60);                            // 60 kocka: 15 < 20 (resume) -> még kimerült
  near(ps[0].stamina, 15, 1e-6); eq(ps[0].exhausted, true);
  run(sys, ps, STILL, 30);                            // 22.5 >= 20 -> felépült
  eq(ps[0].exhausted, false);
  stepTetherSystem(sys, ps, PULL_A, DT);
  eq(sys.k.a, 0.5);
});
test('stamina: a kapcsoló kikapcsolása azonnal feloldja a kimerültség-büntetést', () => {
  const { ps, sys } = atLimit({ pullStamina: true });
  run(sys, ps, PULL_A, 310);
  eq(ps[0].exhausted, true);
  sys.cfg.pullStamina = false;
  stepTetherSystem(sys, ps, PULL_A, DT);
  eq(sys.k.a, 0.5);                                   // nincs büntetés
  run(sys, ps, PULL_A, 90);
  eq(ps[0].exhausted, false); assert(ps[0].stamina > 0, 'nem regenerált');
});
test('stamina: ensureStamina javítja a hibás mezőket, dt=0 nem változtat', () => {
  const p = { stamina: NaN, staminaMax: 0, exhausted: 'igen' };
  ensureStamina(p);
  eq(p.staminaMax, 100); eq(p.stamina, 100); eq(p.exhausted, true);
  p.stamina = -4; ensureStamina(p); eq(p.stamina, 0);
  p.stamina = 999; ensureStamina(p); eq(p.stamina, 100);
  p.stamina = 30; stepPullStamina([p, { ...p }], { x: 'pull-a', y: 'free' }, 0, true);
  eq(p.stamina, 30);
});
test('k-hook + stamina: fuzz 600 kocka (véletlen mezők, terep, kapcsoló), invariánsok', () => {
  let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const ps = [createPlayer(0, 400, 300), createPlayer(1, 520, 300)];
  const sys = createTetherSystem({ L: { x: 200, y: 150 }, k: () => 0.3 + rnd() * 0.7, pullStamina: () => rnd() < 0.9, terrain: p => 0.2 + ((p.x * 7) % 1000) / 1250 });
  for (let f = 0; f < 600; f++) {
    if (f % 40 === 0) for (const p of ps) { p.strength = rnd() * 3; p.weight = 0.3 + rnd() * 3; p.load = rnd() * 5; }
    const inp = [{ x: Math.round(rnd() * 2 - 1), y: Math.round(rnd() * 2 - 1) }, { x: Math.round(rnd() * 2 - 1), y: Math.round(rnd() * 2 - 1) }];
    stepTetherSystem(sys, ps, inp, DT);
    for (const p of ps) {
      assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN a ' + f + '. kockában');
      assert(p.stamina >= 0 && p.stamina <= p.staminaMax, `stamina tartományon kívül a ${f}. kockában: ${p.stamina}`);
      assert(!p.exhausted || p.stamina < PULL_STAMINA.resume * p.staminaMax + 1e-9, 'kimerült, de a stamina a küszöb fölött');
    }
    assert(sys.k.a >= 0 && sys.k.a <= 1 && sys.k.b >= 0 && sys.k.b <= 1, 'k tartományon kívül');
    assert(Math.abs(ps[1].x - ps[0].x) <= 200 + EPS && Math.abs(ps[1].y - ps[0].y) <= 150 + EPS, `L_eff túllépve a ${f}. kockában`);
  }
});
