// S030: falun belül/kívül. Belül működő osztott képernyő (a pár messze lehet), kívül összeolvadt kép, a határsáv átmenete villogásmentes.
// A bekötés ugyanaz, mint a main.js-ben: cfg.L = fieldL(field, () => tc.lNormal()); a split-view L_normal-t kap; a póráz visszahúzása (reelIn).
import { test, assert, eq } from './test-index.js';
import { createPlayer } from './game-player.js';
import { createTetherSystem, stepTetherSystem, reelIn, REEL_CONFIG } from './tether-system.js';
import { TetherConfig } from './tether-config.js';
import { sanitizeField, fieldL, fieldValue, fieldShare } from './game-field.js';
import { createSplitView, snapSplitView, stepSplitView, splitOffsets, viewContains, mergeBlend } from './game-splitview.js';
import { moveWithWalls } from './game-collision.js';

const DT = 1 / 60;
const still = { x: 0, y: 0 };

function rig(ax, ay, bx, by, { walls = [], reel } = {}) {
  const tc = new TetherConfig(null);
  const field = sanitizeField({ id: 'sorsko', x: 0, y: 0, radius: 640 });
  const cfg = tc.systemConfig({ walls, field });
  cfg.L = fieldL(field, () => tc.lNormal());
  if (reel !== undefined) cfg.reel = reel;
  const sys = createTetherSystem(cfg);
  const players = [createPlayer(0, ax, ay), createPlayer(1, bx, by)];
  const split = createSplitView(players, undefined, tc.lNormal());
  const r = { tc, field, sys, players, split, ln: tc.lNormal(), flips: 0, frames: 0, bad: 0, maxOver: 0 };
  r.step = (ia, ib, n = 1) => {
    for (let i = 0; i < n; i++) {
      stepTetherSystem(sys, players, [ia, ib], DT);
      const before = split.merge.on;
      stepSplitView(split, players, DT, tc.cameraConfig(), tc.lNormal(), fieldShare(field, players[0], players[1]) <= 0);
      if (split.merge.on !== before) r.flips++;
      r.frames++;
      if (!players.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) r.bad++;
    }
  };
  r.dist = () => ({ x: Math.abs(players[1].x - players[0].x), y: Math.abs(players[1].y - players[0].y) });
  r.outside = () => players.every(p => fieldValue(field, p) === 0);
  return r;
}
const inViews = r => { const o = splitOffsets(r.split); return [0, 1].every(i => viewContains(r.split, r.split.order === 0 ? i : 1 - i, r.players[i], 0, o)) ; };
const rnd = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

test('falu: belül a pár messze lehet, az osztott képernyő működik (két nézet, mindkét játékos a sajátjában)', () => {
  const r = rig(-500, -100, 500, 100); // Δx 1000 > L_normal.x (864)
  r.step(still, still, 60);
  assert(!r.split.merge.on && mergeBlend(r.split) === 0, 'szétválva, nincs osztóvonal-elhalványulás');
  const o = splitOffsets(r.split);
  assert(o[0].x !== o[1].x, 'a két nézet külön kamera');
  for (const p of r.players) assert(fieldValue(r.field, p) > 0, 'mindketten a mezőben');
  assert(r.sys.L.x > r.ln.x + 100, 'bent L_eff nagyobb L_normal-nál: ' + r.sys.L.x);
  // a nézet-tulajdonos a saját nézetében látszik
  for (let i = 0; i < 2; i++) assert(viewContains(r.split, i, r.players[r.split.order === 0 ? i : 1 - i], 0, o), 'a ' + i + '. nézet a saját játékosát mutatja');
  // közel hozva összeolvad (egy kép)
  r.players[1].x = -400; r.players[1].y = -100;
  r.step(still, still, 60);
  assert(r.split.merge.on && mergeBlend(r.split) === 1, 'közel -> összeolvad');
});

test('falu: belül kifelé húzva a pár L_falu-nál megáll, a nézetek szétválva maradnak és mindkét játékos látszik', () => {
  const r = rig(-150, 0, 150, 0);
  r.step({ x: -1, y: 0 }, { x: 1, y: 0 }, 60 * 20);
  const d = r.dist();
  assert(d.x > r.ln.x + 50 && d.x <= 1280 + 1e-3, 'a táv nagyobb L_normal-nál, de <= L_falu: ' + d.x);
  assert(!r.split.merge.on, 'szétválva');
  assert(inViews(r), 'mindkét játékos a saját nézetében');
  eq(r.bad, 0);
});

test('falu: a határsávon át kilépve (Δy > L_normal) a pár visszahúzódik és falun kívül egy képbe olvad, egyszer vált', () => {
  const r = rig(-300, -300, -300, 300); // Δy 600 > 444: szétválva indul
  r.step(still, still, 30);
  assert(!r.split.merge.on, 'induláskor szétválva');
  const right = { x: 1, y: 0 };
  r.step(right, right, 60 * 12); // kisétálnak a falun
  assert(r.outside(), 'mindketten falun kívül vannak');
  r.step(still, still, 60 * 2);
  const d = r.dist();
  assert(d.x <= r.ln.x + 1 && d.y <= r.ln.y + 1, `falun kívül a táv L_normal-on belül: ${d.x}/${d.y}`);
  assert(r.split.merge.on && mergeBlend(r.split) === 1, 'falun kívül összeolvadt kép');
  assert(r.flips <= 1, 'egyetlen váltás, nincs villogás: ' + r.flips);
  eq(r.bad, 0);
});

test('falu: a határsáv átmenete villogásmentes (a hiszterézis sávjában állandó táv mellett nincs váltás)', () => {
  for (const frac of [0.88, 0.95, 0.99]) { // 0.85 és 1.0 között: összeolvadva marad a határsávon át
    const dx = r0(frac), d0 = r0(0.8);
    const r = rig(-200 - d0 / 2, 0, -200 + d0 / 2, 0);
    r.step(still, still, 60);
    assert(r.split.merge.on, 'összeolvadva indul (frac ' + frac + ')');
    r.players[0].x = -200 - dx / 2; r.players[1].x = -200 + dx / 2; // a hiszterézis sávjába tágul (0,85..1,0)
    r.step(still, still, 30);
    assert(r.split.merge.on, 'a sávban összeolvadva marad');
    const right = { x: 1, y: 0 };
    r.flips = 0;
    r.step(right, right, 60 * 12);
    assert(r.outside(), 'kint');
    eq(r.flips, 0, 'frac ' + frac + ': nincs váltás a sávon át');
    assert(r.split.merge.on, 'összeolvadva marad');
  }
  function r0(frac) { return new TetherConfig(null).lNormal().x * frac; }
});

test('falu: falun kívül sosem szétválva (véletlen bemenet, 3000 kocka, kint indulva)', () => {
  const R = rnd(30030);
  const r = rig(5000, 5000, 5300, 5100);
  r.step(still, still, 60);
  let split = 0, over = 0;
  for (let f = 0; f < 3000; f++) {
    const dir = () => (R() < 0.5 ? { x: Math.round(R() * 2 - 1), y: Math.round(R() * 2 - 1) } : still);
    if (f % 30 === 0) { r.ia = dir(); r.ib = dir(); }
    r.step(r.ia, r.ib);
    const d = r.dist();
    if (d.x > r.ln.x + 1 || d.y > r.ln.y + 1) over++;
    if (!r.split.merge.on) split++;
  }
  eq(over, 0, 'a táv sosem lépi túl az L_normal-t');
  eq(split, 0, 'sosem szétválva');
  eq(r.bad, 0);
});

test('falu: be- és kilépés ismételten (fuzz 4 irányból): nincs NaN, kint összeolvadt, belül táv <= L_falu', () => {
  const R = rnd(7);
  for (const [sx, sy] of [[-900, 0], [900, 0], [0, -900], [0, 900]]) {
    const r = rig(sx, sy, sx + 60, sy + 40);
    for (let f = 0; f < 2400; f++) {
      if (f % 90 === 0) { const t = R() < 0.3; r.ia = t ? still : { x: Math.round(R() * 2 - 1), y: Math.round(R() * 2 - 1) }; r.ib = R() < 0.5 ? r.ia : { x: Math.round(R() * 2 - 1), y: Math.round(R() * 2 - 1) }; }
      r.step(r.ia, r.ib);
      const d = r.dist();
      assert(d.x <= 1280 + 1e-3 && d.y <= 1280 + 1e-3, 'táv <= L_falu');
      if (r.outside() && f > 1) { const e = r.sys.L; assert(d.x <= Math.max(e.x, 0) + 60 && d.y <= e.y + 60, 'kint a táv nem nő L_normal fölé'); }
    }
    eq(r.bad, 0);
  }
});

test('póráz: reelIn csak túllógáskor, korlátozott sebességgel, falat tisztel, a táv nem nő, hibás bemenet nem dob', () => {
  const a = createPlayer(0, 0, 0), b = createPlayer(1, 300, 0);
  eq(reelIn(a, b, { x: 400, y: 400 }, DT, [], REEL_CONFIG), 0); eq(a.x, 0); eq(b.x, 300); // belül: semmi
  const m = reelIn(a, b, { x: 100, y: 100 }, DT, [], REEL_CONFIG); // 200 px túllóg
  assert(Math.abs(m - 2 * REEL_CONFIG.speed * DT) < 1e-9, 'játékosonként speed·dt: ' + m);
  assert(a.x > 0 && b.x < 300 && a.y === 0 && b.y === 0, 'egymás felé');
  for (let i = 0; i < 600; i++) reelIn(a, b, { x: 100, y: 100 }, DT, [], REEL_CONFIG);
  assert(Math.abs(b.x - a.x - 100) < 1e-6, 'pontosan L-ig húz: ' + (b.x - a.x)); // nem lő túl
  const c = createPlayer(0, 0, 0), d = createPlayer(1, 300, 0);
  const wall = [{ x: 60, y: -50, w: 20, h: 100 }];
  for (let i = 0; i < 600; i++) reelIn(c, d, { x: 100, y: 100 }, DT, wall, REEL_CONFIG);
  assert(c.x + c.w / 2 <= 60 + 1e-6, 'a fal megállítja a húzottat: ' + c.x);
  const e = createPlayer(0, 0, 0), g = createPlayer(1, 300, 0);
  eq(reelIn(e, g, { x: 100, y: 100 }, DT, [], { speed: 0 }), 0, 'speed 0: ki');
  for (const bad of [[null, 0], [{ x: NaN, y: 1 }, DT], [{ x: 0, y: 0 }, DT], [{ x: 10, y: 10 }, -1], [{ x: 10, y: 10 }, NaN]]) eq(reelIn(e, g, bad[0], bad[1], [], REEL_CONFIG), 0);
  const n = createPlayer(0, NaN, 0); eq(reelIn(n, g, { x: 10, y: 10 }, DT, [], REEL_CONFIG), 0);
});

test('póráz: a visszahúzás a falak közt sem ejti a játékost falba, és a távolság sosem nő (900 kocka)', () => {
  const walls = [{ x: 700, y: -200, w: 32, h: 400 }, { x: 1500, y: -300, w: 32, h: 200 }];
  const r = rig(-300, -300, -300, 300, { walls });
  let prev = Infinity;
  for (let f = 0; f < 900; f++) {
    r.step({ x: 1, y: 0 }, { x: 1, y: 0 });
    const d = r.dist();
    if (r.outside()) { assert(d.y <= prev + 1e-6, 'a függőleges táv nem nő kint'); prev = d.y; }
  }
  const hit = r.players.some(p => walls.some(w => p.x + p.w / 2 > w.x + 0.01 && p.x - p.w / 2 < w.x + w.w - 0.01 && p.y + p.h / 2 > w.y + 0.01 && p.y - p.h / 2 < w.y + w.h - 0.01));
  assert(!hit, 'nincs falba ágyazva');
  eq(r.bad, 0);
});
