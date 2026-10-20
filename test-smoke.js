// Füst-teszt: az összes DOM-független modul betöltése + ~600 képkocka két szkriptelt játékossal.
// Új, DOM-független modult vegyél fel a MODULES listába (main.js és a renderelők kimaradnak).
import { test, assert } from './test-index.js';

const MODULES = [
  './version.js', './core-screen.js', './core-input.js', './core-debug.js',
  './game-player.js', './game-camera.js', './tether-logic.js',
];
const FRAMES = 600;
const DT = 1 / 60;
const L = { x: 320, y: 200 }; // szűkített L_eff, hogy a szkript biztosan megfeszítse a pórázt
const EPS = 1e-6;

// Szkriptelt bemenet: [kezdő-kocka, vég-kocka, x, y] szakaszok, utána álló.
const SCRIPT = [
  [[0, 150, 1, 0], [150, 300, 0, 0], [300, 420, 1, 1], [420, 600, -1, 0]], // P1
  [[0, 100, 0, 0], [100, 250, -1, 0], [250, 400, 0, -1], [400, 600, 1, 0]], // P2
];
function scripted(p, frame) {
  for (const [s, e, x, y] of SCRIPT[p]) if (frame >= s && frame < e) return { x, y };
  return { x: 0, y: 0 };
}

test('smoke: az összes modul betölthető', async () => {
  for (const m of MODULES) {
    const mod = await import(m);
    assert(mod && Object.keys(mod).length > 0, 'üres modul: ' + m);
  }
});

test('smoke: 600 kocka két szkriptelt játékossal, póráz-invariánsok', async () => {
  const { createPlayer, desiredVelocity } = await import('./game-player.js');
  const { createCamera, stepCamera } = await import('./game-camera.js');
  const { computeTether } = await import('./tether-logic.js');
  const P = [createPlayer(0, 400, 300), createPlayer(1, 500, 300)];
  const cam = createCamera(450, 300);
  let maxX = 0, maxY = 0, moved = false;
  for (let f = 0; f < FRAMES; f++) {
    const v = P.map((p, i) => desiredVelocity(p, scripted(i, f)));
    const t = computeTether({ a: P[0], b: P[1], va: v[0], vb: v[1], L, k: { a: 0.5, b: 0.5 }, dt: DT });
    P[0].x += t.a.x * DT; P[0].y += t.a.y * DT;
    P[1].x += t.b.x * DT; P[1].y += t.b.y * DT;
    stepCamera(cam, P[0], P[1], DT);
    for (const p of P) assert(Number.isFinite(p.x) && Number.isFinite(p.y), `NaN pozíció a ${f}. kockában`);
    assert(Number.isFinite(cam.x) && Number.isFinite(cam.y), `NaN kamera a ${f}. kockában`);
    const dx = Math.abs(P[1].x - P[0].x), dy = Math.abs(P[1].y - P[0].y);
    maxX = Math.max(maxX, dx); maxY = Math.max(maxY, dy);
    assert(dx <= L.x + EPS, `póráz-távolság x túllépte L_eff-et a ${f}. kockában: ${dx}`);
    assert(dy <= L.y + EPS, `póráz-távolság y túllépte L_eff-et a ${f}. kockában: ${dy}`);
    if (P[0].x !== 400 || P[1].x !== 500) moved = true;
  }
  assert(moved, 'a játékosok nem mozdultak');
  assert(maxX >= L.x - 1e-3 && maxY >= L.y - 1e-3, 'a szkript nem feszítette meg a pórázt');
});

test('smoke: változó L_eff (szűkül/tágul), a távolság sosem nő a korlát fölött, nincs NaN', async () => {
  const { createPlayer, desiredVelocity } = await import('./game-player.js');
  const { createCamera, stepCamera } = await import('./game-camera.js');
  const { computeTether } = await import('./tether-logic.js');
  const S = [ // P1, P2: kifelé, majd befelé, majd újra kifelé (átlósan is)
    [[0, 200, -1, -1], [200, 400, 1, 1], [400, 600, -1, 0]],
    [[0, 200, 1, 1], [200, 400, -1, -1], [400, 600, 1, 0]],
  ];
  const inp = (p, f) => { for (const [s, e, x, y] of S[p]) if (f >= s && f < e) return { x, y }; return { x: 0, y: 0 }; };
  const P = [createPlayer(0, 400, 300), createPlayer(1, 460, 330)];
  const cam = createCamera(430, 315);
  let hold = { x: 0, y: 0 }, minL = Infinity, maxL = 0;
  for (let f = 0; f < FRAMES; f++) {
    const w = 0.5 + 0.5 * Math.cos((f / 300) * 2 * Math.PI); // 1 -> 0 -> 1
    const Lc = { x: 200 + 300 * w, y: 120 + 200 * w };       // L_eff folyamatosan változik
    minL = Math.min(minL, Lc.x); maxL = Math.max(maxL, Lc.x);
    const d0 = { x: Math.abs(P[1].x - P[0].x), y: Math.abs(P[1].y - P[0].y) };
    const v = P.map((p, i) => desiredVelocity(p, inp(i, f)));
    const t = computeTether({ a: P[0], b: P[1], va: v[0], vb: v[1], L: Lc, k: { a: 0.5, b: 0.5 }, dt: DT });
    P[0].x += t.a.x * DT; P[0].y += t.a.y * DT;
    P[1].x += t.b.x * DT; P[1].y += t.b.y * DT;
    stepCamera(cam, P[0], P[1], DT);
    for (const p of P) assert(Number.isFinite(p.x) && Number.isFinite(p.y), `NaN pozíció a ${f}. kockában`);
    assert(Number.isFinite(cam.x) && Number.isFinite(cam.y), `NaN kamera a ${f}. kockában`);
    for (const ax of ['x', 'y']) {
      const d1 = Math.abs(P[1][ax] - P[0][ax]);
      assert(d1 <= Math.max(Lc[ax], d0[ax]) + EPS, `a távolság (${ax}) nőtt a korlát fölött a ${f}. kockában: ${d1}`);
      if (t.mode[ax] === 'hold') hold[ax]++;
    }
  }
  assert(maxL - minL > 100, 'az L_eff nem változott');
  assert(hold.x > 0 && hold.y > 0, 'a holtpont egyik tengelyen sem fordult elő');
});
