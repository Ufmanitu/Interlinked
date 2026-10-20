import { test, assert, eq, near } from './test-index.js';
import { createPlayer, desiredVelocity, stepPlayer, PLAYER_SPEED, PLAYER_COLORS } from './game-player.js';
import { Input } from './core-input.js';

function fakeTarget() {
  const h = {};
  return { addEventListener: (t, f) => { h[t] = f; }, fire: (t, e) => h[t] && h[t](e) };
}

test('player: P1 kék, P2 piros', () => {
  eq(createPlayer(0, 0, 0).color, PLAYER_COLORS[0]);
  eq(createPlayer(1, 0, 0).color, PLAYER_COLORS[1]);
  assert(PLAYER_COLORS[0] !== PLAYER_COLORS[1]);
});
test('player: mozgás az inputból', () => {
  const p = createPlayer(0, 10, 10);
  stepPlayer(p, { x: 1, y: 0 }, 0.5);
  near(p.x, 10 + PLAYER_SPEED * 0.5); near(p.y, 10);
  stepPlayer(p, { x: 0, y: -1 }, 0.5);
  near(p.y, 10 - PLAYER_SPEED * 0.5);
});
test('player: nincs input -> áll', () => {
  const p = createPlayer(1, 5, 5);
  stepPlayer(p, { x: 0, y: 0 }, 1);
  eq(p.x, 5); eq(p.y, 5);
});
test('player: átlós sebesség nem nagyobb', () => {
  const v = desiredVelocity(createPlayer(0, 0, 0), { x: Math.SQRT1_2, y: Math.SQRT1_2 });
  near(Math.hypot(v.x, v.y), PLAYER_SPEED, 1e-6);
});
test('player: a két játékos külön mozog (billentyűzet)', () => {
  const t = fakeTarget();
  const input = new Input(t);
  const ps = [createPlayer(0, 100, 100), createPlayer(1, 200, 100)];
  t.fire('keydown', { code: 'KeyD', preventDefault() {} });
  for (let i = 0; i < 60; i++) { input.update(); ps.forEach((p, k) => stepPlayer(p, input.get(k), 1 / 60)); }
  near(ps[0].x, 100 + PLAYER_SPEED, 1e-6); eq(ps[1].x, 200);
  t.fire('keyup', { code: 'KeyD' });
  t.fire('keydown', { code: 'ArrowDown', preventDefault() {} });
  for (let i = 0; i < 60; i++) { input.update(); ps.forEach((p, k) => stepPlayer(p, input.get(k), 1 / 60)); }
  near(ps[1].y, 100 + PLAYER_SPEED, 1e-6); near(ps[0].x, 100 + PLAYER_SPEED, 1e-6);
});
test('player: szimuláció 600 kocka, nincs NaN', () => {
  const ps = [createPlayer(0, 0, 0), createPlayer(1, 50, 50)];
  for (let i = 0; i < 600; i++) {
    const a = { x: Math.cos(i / 20), y: Math.sin(i / 20) };
    ps.forEach(p => stepPlayer(p, a, 1 / 60));
  }
  ps.forEach(p => assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN'));
});
