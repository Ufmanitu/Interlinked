// Ütközés-tesztek: söprés, póráz-helyreállítás, "húzott falnak ütközik -> a húzó is megáll", fuzz.
import { test, assert, eq, near } from './test-index.js';
import { sweepAxis, constrainPair, moveWithWalls, collides } from './game-collision.js';
import { generateWalls } from './game-walls.js';
import { createPlayer } from './game-player.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';

const DT = 1 / 60;
const W = (x, y, w, h) => ({ x, y, w, h });
const ent = (x, y) => ({ x, y, w: 24, h: 24 });

test('collision: szabad mozgás, ha nincs fal az úton', () => {
  eq(sweepAxis(ent(100, 100), 'x', 5, [W(300, 90, 32, 32)]), 5);
  eq(sweepAxis(ent(100, 100), 'x', 5, []), 5);
});

test('collision: fal előtt pontosan megáll (+x, -x, +y, -y)', () => {
  near(sweepAxis(ent(100, 100), 'x', 50, [W(130, 80, 32, 40)]), 18); // jobb szél 112 -> fal 130
  near(sweepAxis(ent(100, 100), 'x', -50, [W(40, 80, 32, 40)]), -16); // bal szél 88 -> fal jobb széle 72
  near(sweepAxis(ent(100, 100), 'y', 50, [W(80, 130, 40, 32)]), 18);
  near(sweepAxis(ent(100, 100), 'y', -50, [W(80, 40, 40, 32)]), -16);
});

test('collision: a legközelebbi fal számít', () => {
  near(sweepAxis(ent(100, 100), 'x', 200, [W(250, 80, 32, 40), W(130, 80, 32, 40)]), 18);
});

test('collision: falhoz érve a további mozgás 0, a keresztirány szabad (csúszás)', () => {
  const e = ent(118, 100); // jobb szél 130 = a fal bal széle
  eq(sweepAxis(e, 'x', 10, [W(130, 80, 32, 40)]), 0);
  eq(sweepAxis(e, 'y', 10, [W(130, 80, 32, 200)]), 10); // a fal mellett lefelé csúszik
  eq(sweepAxis(e, 'x', -10, [W(130, 80, 32, 40)]), -10); // a faltól el szabad
});

test('collision: a mögöttünk lévő fal nem fékez; nulla/NaN elmozdulás -> 0', () => {
  eq(sweepAxis(ent(100, 100), 'x', 10, [W(20, 80, 32, 40)]), 10);
  eq(sweepAxis(ent(100, 100), 'x', 0, [W(130, 80, 32, 40)]), 0);
  eq(sweepAxis(ent(100, 100), 'x', NaN, [W(130, 80, 32, 40)]), 0);
});

test('collision: a falban lévő entitás kimozoghat, nem ragad be', () => {
  const e = ent(140, 100); // a fal belsejében
  eq(sweepAxis(e, 'x', 5, [W(130, 80, 32, 40)]), 5);
  eq(sweepAxis(e, 'x', -5, [W(130, 80, 32, 40)]), -5);
});

test('collision: collides — érintés nem átfedés', () => {
  assert(!collides(ent(118, 100), [W(130, 80, 32, 40)]), 'érintés');
  assert(collides(ent(119, 100), [W(130, 80, 32, 40)]), 'átfedés');
});

test('constrainPair: a korláton belül változatlan', () => {
  const r = constrainPair(0, 100, 5, -5, 200);
  eq(r.a, 5); eq(r.b, -5);
});

test('constrainPair: a húzott falnak ütközik -> a húzó is megáll', () => {
  // A (0) húz balra, B (100 = L) vonszolódna, de falnál 0-t léphet; A csak 0-t léphet.
  const r = constrainPair(0, 100, -3, 0, 100);
  near(r.a, 0); near(r.b, 0);
  // A húz, B 1 px-t léphet: A is legfeljebb 1 px
  const q = constrainPair(0, 100, -3, -1, 100);
  near(q.a, -1); near(q.b, -1);
});

test('constrainPair: a követő falnak ütközik, a vezető nem távolodhat a korláton túl', () => {
  // B (100) jobbra megy, A (0) követné de falnál megáll
  const r = constrainPair(0, 100, 0, 3, 100);
  near(r.a, 0); near(r.b, 0);
});

test('constrainPair: szűkülő L (d0 > L) — a távolság nem nő, a csökkenés megmarad', () => {
  const r = constrainPair(0, 150, 0, -4, 100); // befelé mozog: engedett
  near(r.b, -4);
  const q = constrainPair(0, 150, 0, 4, 100); // kifelé mozog: tiltott
  near(q.b, 0);
});

test('constrainPair: d0 = 0 nem hibázik', () => {
  const r = constrainPair(50, 50, -2, 2, 100);
  assert(Number.isFinite(r.a) && Number.isFinite(r.b));
});

test('moveWithWalls: átlós mozgás falnál csúszik', () => {
  const a = ent(100, 100), b = ent(110, 100);
  const walls = [W(130, 0, 32, 200)];
  const bl = moveWithWalls(a, b, { x: 3000, y: 600 }, { x: 0, y: 0 }, DT, walls, { x: 500, y: 500 });
  near(a.x, 118); // a falig (jobb szél 130)
  near(a.y, 110); // lefelé szabad
  assert(bl.a.x && !bl.a.y, 'csak x levágva');
});

function lineup(L) {
  // A balra húz; B pontosan L-re van tőle, fal áll B útjába (B y-ján), A y-ján nincs fal
  const a = createPlayer(0, 400 + L.x, 300); // A jobb oldalon: jobbra húz
  const b = createPlayer(1, 400, 100);       // B balra, a korlátnál x-ben
  return [a, b];
}

test('rendszer: a vonszolt játékos falnak ütközik -> a húzó is megáll', () => {
  const L = { x: 300, y: 1000 };
  const [a, b] = lineup(L);
  const sys = createTetherSystem({ L, k: 0.5, walls: [W(430, 60, 32, 80)] }); // B előtt, jobbra
  for (let f = 0; f < 300; f++) stepTetherSystem(sys, [a, b], [{ x: 1, y: 0 }, { x: 0, y: 0 }], DT);
  near(b.x, 430 - 12, 1e-6, 'B a falnál'); // 418
  near(a.x, 418 + L.x, 1e-6, 'A megállt B mögött a korláton');
  assert(sys.blocked.b.x || sys.blocked.a.x, 'blocked jelzés');
});

test('rendszer: a követő falnak ütközik, a vezető nem rántja el', () => {
  const L = { x: 300, y: 1000 };
  const a = createPlayer(0, 400, 300);      // követő, fal áll előtte
  const b = createPlayer(1, 400 + L.x, 100); // vezető, a korlátnál
  const sys = createTetherSystem({ L, k: 0.5, walls: [W(420, 280, 32, 40)] });
  for (let f = 0; f < 300; f++) stepTetherSystem(sys, [a, b], [{ x: 1, y: 0 }, { x: 1, y: 0 }], DT);
  near(a.x, 420 - 12, 1e-6, 'A a falnál');
  near(b.x - a.x, L.x, 1e-6, 'a távolság pontosan L');
});

test('rendszer: fal nélkül azonos a korábbi viselkedéssel', () => {
  const mk = () => [createPlayer(0, 400, 300), createPlayer(1, 500, 300)];
  const s1 = createTetherSystem({ L: { x: 200, y: 200 } }), s2 = createTetherSystem({ L: { x: 200, y: 200 }, walls: [] });
  const p1 = mk(), p2 = mk();
  for (let f = 0; f < 200; f++) {
    const inp = [{ x: f % 90 < 45 ? 1 : -1, y: 0.5 }, { x: -0.3, y: f % 70 < 35 ? 1 : -1 }];
    stepTetherSystem(s1, p1, inp, DT); stepTetherSystem(s2, p2, inp, DT);
  }
  eq(p1[0].x, p2[0].x); eq(p1[1].y, p2[1].y);
});

test('rendszer: tényleges sebesség (vx) falnál 0', () => {
  const a = createPlayer(0, 100, 100), b = createPlayer(1, 140, 100);
  const sys = createTetherSystem({ L: { x: 800, y: 800 }, walls: [W(130, 60, 32, 80)] });
  for (let f = 0; f < 60; f++) stepTetherSystem(sys, [a, b], [{ x: 1, y: 0 }, { x: 0, y: 0 }], DT);
  near(a.vx, 0, 1e-9);
  near(a.x, 130 - 12, 1e-6);
});

// Fuzz: az arénában véletlen bemenettel sosem lesz átfedés, NaN, és a távolság sosem nő a korlát fölé.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

test('fuzz: aréna, véletlen bemenet — nincs fal-átfedés, NaN; távolság <= max(L, előző)', () => {
  const walls = generateWalls();
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = rng(seed);
    const L = { x: 240 + r() * 400, y: 160 + r() * 300 };
    const P = [createPlayer(0, 400, 270), createPlayer(1, 540, 270)];
    const sys = createTetherSystem({ L, k: 0.5, walls });
    let cur = [0, 0];
    for (let f = 0; f < 1500; f++) {
      if (f % 20 === 0) cur = [0, 1].map(() => ({ x: Math.round(r() * 2 - 1), y: Math.round(r() * 2 - 1) }));
      const inp = [cur[0], cur[1]];
      const d0 = { x: Math.abs(P[1].x - P[0].x), y: Math.abs(P[1].y - P[0].y) };
      stepTetherSystem(sys, P, inp, DT);
      for (const p of P) {
        assert(Number.isFinite(p.x) && Number.isFinite(p.y), `NaN (seed ${seed}, kocka ${f})`);
        assert(!collides(p, walls), `fal-átfedés (seed ${seed}, kocka ${f})`);
      }
      for (const ax of ['x', 'y']) {
        const d1 = Math.abs(P[1][ax] - P[0][ax]);
        assert(d1 <= Math.max(L[ax], d0[ax]) + 1e-6, `távolság (${ax}) nőtt (seed ${seed}, kocka ${f}): ${d1}`);
      }
    }
  }
});

test('walls: a generált aréna zárt, a kezdőpozíciók szabadok', () => {
  const walls = generateWalls();
  assert(walls.length > 8, 'kevés fal');
  assert(!collides(createPlayer(0, 400, 270), walls) && !collides(createPlayer(1, 540, 270), walls), 'kezdőpozíció falban');
  for (const w of walls) assert(w.w > 0 && w.h > 0 && w.x >= 0 && w.y >= 0, 'rossz fal');
  // a kerítés bentről nem léphető át
  const e = ent(400, 270);
  let x = e.x; for (let i = 0; i < 100; i++) { const d = sweepAxis({ ...e, x }, 'x', -50, walls); x += d; }
  assert(x >= 32 + 12 - 1e-6, 'átlépte a bal keretet');
});
