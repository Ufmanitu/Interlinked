import { test, assert, eq, near } from './test-index.js';
import * as Player from './game-player.js';
import { createPlayer, desiredVelocity, applyVelocity, PLAYER_SPEED, PLAYER_COLORS } from './game-player.js';
import { createTetherSystem, stepTetherSystem, TETHER_CONFIG } from './tether-system.js';
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
