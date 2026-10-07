import { test, eq, near, assert } from './test-lib.js';
import { computeScale, W, H } from './core-screen.js';
import { Input } from './core-input.js';
import { createLoop } from './main.js';
import { versionString } from './version.js';

const pad = (axes, pressed = []) => ({ connected: true, axes, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })) });

test('screen: egész számú skála', () => {
  eq(W, 960); eq(H, 540);
  eq(computeScale(1920, 1080), 2);
  eq(computeScale(2000, 1200), 2);
  eq(computeScale(500, 300), 1, 'minimum 1');
  eq(computeScale(1920, 1080, 2), 4, 'dpr 2');
});
test('loop: 600 képkocka = 600 fix lépés', () => {
  let n = 0;
  const l = createLoop({ step: () => n++, render: () => {} });
  for (let i = 0; i < 600; i++) l.frame(1000 / 60);
  eq(n, 600);
});
test('loop: lassú képkocka korlátozva, gyors képkocka felgyűlik', () => {
  let n = 0;
  const l = createLoop({ step: () => n++, render: () => {} });
  eq(l.frame(1000), 5, 'max 5 lépés');
  n = 0;
  eq(l.frame(8), 0); eq(l.frame(9), 1);
});
test('input: két játékos külön billentyűkön', () => {
  const i = new Input({ target: null, nav: { getGamepads: () => [] } });
  i.setKey('KeyD', true); i.setKey('ArrowUp', true); i.setKey('KeyE', true);
  i.update();
  eq(i.players[0].x, 1); eq(i.players[0].y, 0);
  eq(i.players[1].x, 0); eq(i.players[1].y, -1);
  assert(i.players[0].pressed.interact && !i.players[1].pressed.interact, 'interact csak P1');
  i.update();
  assert(!i.players[0].pressed.interact && i.players[0].held.interact, 'pressed csak egy tickig');
});
test('input: átlós mozgás normalizált', () => {
  const i = new Input({ target: null, nav: { getGamepads: () => [] } });
  i.setKey('KeyD', true); i.setKey('KeyS', true); i.update();
  near(Math.hypot(i.players[0].x, i.players[0].y), 1);
});
test('input: gamepad holtzóna, tengely, gomb, átkötés', () => {
  let pads = [pad([0.1, 0])];
  const i = new Input({ target: null, nav: { getGamepads: () => pads } });
  i.update(); eq(i.players[0].x, 0, 'holtzóna');
  pads = [pad([1, 0], [0])]; i.update();
  eq(i.players[0].x, 1); assert(i.players[0].held.interact, 'A gomb');
  i.setBinding(0, 'interact', ['KeyG']); i.setKey('KeyG', true); i.update();
  assert(i.players[0].held.interact, 'átkötött billentyű');
});
test('version: lépés-azonosító látszik', () => assert(/S\d{3}/.test(versionString())));
