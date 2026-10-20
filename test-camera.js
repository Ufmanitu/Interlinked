import { test, assert } from './test-index.js';
import { createCamera, stepCamera, maxLag, cameraOffset, CAM_CONFIG, CAM_VIEW } from './game-camera.js';

const P = (x, y) => ({ x, y });

test('kamera: a felezőponthoz konvergál', () => {
  const cam = createCamera(0, 0);
  for (let i = 0; i < 600; i++) stepCamera(cam, P(300, 200), P(500, 400), 1 / 60);
  assert(Math.abs(cam.x - 400) < 0.01 && Math.abs(cam.y - 300) < 0.01, 'nem konvergált: ' + cam.x + ',' + cam.y);
});

test('kamera: fps-független simítás', () => {
  const a = createCamera(0, 0), b = createCamera(0, 0);
  const cfg = { k: 6, margin: -1e6 }; // késés-korlát kikapcsolva
  for (let i = 0; i < 60; i++) stepCamera(a, P(400, 0), P(400, 0), 1 / 60, cfg);
  for (let i = 0; i < 30; i++) stepCamera(b, P(400, 0), P(400, 0), 1 / 30, cfg);
  assert(Math.abs(a.x - b.x) < 1e-6, 'eltér: ' + a.x + ' vs ' + b.x);
});

test('kamera: nincs mozgás, ha a cél áll és a kamera ott van', () => {
  const cam = createCamera(400, 300);
  stepCamera(cam, P(400, 300), P(400, 300), 1 / 60);
  assert(cam.x === 400 && cam.y === 300, 'elmozdult');
});

test('kamera: maxLag határok', () => {
  assert(maxLag(0, 960, 48) === 480 - 48, 'delta=0');
  assert(maxLag(10000, 960, 48) === 0, 'nagy delta -> 0');
});

test('kamera: gyors mozgásnál a játékosok a képben maradnak', () => {
  const cam = createCamera(400, 270);
  const a = P(400, 270), b = P(540, 270);
  for (let i = 0; i < 1200; i++) {
    a.x += 6; b.x += 6; // 360 px/s
    stepCamera(cam, a, b, 1 / 60);
    const o = cameraOffset(cam);
    for (const p of [a, b]) {
      const sx = p.x - o.x;
      assert(sx >= 0 && sx <= CAM_VIEW.w, 'kicsúszott a képből: ' + sx);
    }
    assert(Number.isFinite(cam.x) && Number.isFinite(cam.y), 'NaN');
  }
});

test('kamera: cameraOffset egész pixel', () => {
  const o = cameraOffset({ x: 400.4, y: 300.6 });
  assert(Number.isInteger(o.x) && Number.isInteger(o.y), 'nem egész');
  assert(CAM_CONFIG.k > 0, 'k');
});
