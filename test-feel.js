// S011 (M0 playteszt helyett): a póráz-érzet automata ellenőrzése. A checklist pontjai mérhető invariánsok:
// 1 szabad mozgás teljes sebességgel, 2 húzás: a húzó lassul (k) és viszi a társat, 3 holtpont: mindketten megállnak,
// 4 feloldás: a társ befelé lépve szabadít, 5 követés: nincs büntetés, 6 húzás-stamina (kimerülés, felépülés),
// 7 fuzz: a távolság sosem lépi túl az L_eff-et, nincs NaN, 8 a játékosok mindig a képben maradnak.
import { test, assert } from './test-index.js';
import { TetherConfig } from './tether-config.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { createPlayer } from './game-player.js';
import { CAM_VIEW, createCamera, stepCamera, cameraOffset } from './game-camera.js';

const DT = 1 / 60;
const IDLE = { x: 0, y: 0 };
const dir = (x, y = 0) => ({ x, y });

function setup({ ax, ay = 0, bx, by = 0, stamina = false }) {
  const tc = new TetherConfig(null); // nincs mentés
  tc.pullStamina = stamina;
  const sys = createTetherSystem(tc.systemConfig({ walls: [] }));
  const ps = [createPlayer(0, ax, ay), createPlayer(1, bx, by)];
  return { tc, sys, ps, L: tc.lNormal() };
}

// n kocka; visszatér a két játékos összesített elmozdulásával.
function run(env, ia, ib, n) {
  const a0 = { x: env.ps[0].x, y: env.ps[0].y }, b0 = { x: env.ps[1].x, y: env.ps[1].y };
  for (let i = 0; i < n; i++) stepTetherSystem(env.sys, env.ps, [ia, ib], DT);
  return {
    a: { x: env.ps[0].x - a0.x, y: env.ps[0].y - a0.y },
    b: { x: env.ps[1].x - b0.x, y: env.ps[1].y - b0.y },
  };
}

// Szabad sebesség (px/s) x irányban, a póráz korlátja alatt.
function freeSpeed() {
  const env = setup({ ax: 300, bx: 100 });
  const d = run(env, dir(1), dir(1), 30);
  return { sa: d.a.x / (30 * DT), sb: d.b.x / (30 * DT) };
}

// Két játékos a korlát közelében: B az origóban, A (+x) a korlát alatt 1 px-szel.
const atLimit = (extra = {}) => { const L = setup({ ax: 0, bx: 0 }).L; return setup({ ax: L.x - 1, bx: 0, ...extra }); };

test('feel 1: szabad mozgás teljes sebességgel, mindkét játékos azonos', () => {
  const { sa, sb } = freeSpeed();
  assert(sa > 0 && Number.isFinite(sa), 'A sebessége pozitív');
  assert(Math.abs(sa - sb) < 1e-6 * Math.max(1, sa), 'azonos sebesség');
});

test('feel 2: húzás: a húzó a k-szorzóval lassul, és viszi a társat', () => {
  const s0 = freeSpeed().sa;
  const env = atLimit();
  run(env, dir(1), IDLE, 10);
  const d = run(env, dir(1), IDLE, 60);
  const ra = d.a.x / (60 * DT * s0), rb = d.b.x / (60 * DT * s0);
  assert(ra > 0.3 && ra < 0.7, 'a húzó sebessége ~k·szabad: ' + ra.toFixed(2));
  assert(rb > 0, 'a társ vele mozog');
  assert(Math.abs(ra - rb) < 0.15, 'a társ ugyanolyan tempóban követi: ' + ra.toFixed(2) + ' / ' + rb.toFixed(2));
});

test('feel 3: holtpont: ha mindketten kifelé húznak, mindketten megállnak', () => {
  const env = atLimit();
  run(env, dir(1), dir(-1), 30);
  const d = run(env, dir(1), dir(-1), 30);
  assert(Math.abs(d.a.x) < 1 && Math.abs(d.b.x) < 1, 'nincs mozgás holtpontban');
  assert(env.ps[0].x - env.ps[1].x <= env.L.x + 0.5, 'a távolság nem lépi túl L-t');
});

test('feel 4: a holtpont azonnal oldható: a társ befelé lép, a távolság csökken', () => {
  const env = atLimit();
  run(env, dir(1), dir(-1), 60);
  const before = env.ps[0].x - env.ps[1].x;
  run(env, IDLE, dir(1), 10);
  const after = env.ps[0].x - env.ps[1].x;
  assert(after < before - 5, 'a távolság csökkent: ' + before.toFixed(1) + ' -> ' + after.toFixed(1));
});

test('feel 5: követés: ha a társ ugyanarra lép, nincs büntetés', () => {
  const s0 = freeSpeed().sa;
  const env = atLimit();
  run(env, dir(1), dir(1), 10);
  const d = run(env, dir(1), dir(1), 60);
  assert(d.a.x / (60 * DT * s0) >= 0.9, 'A teljes sebességgel megy');
  assert(d.b.x / (60 * DT * s0) >= 0.9, 'B teljes sebességgel megy');
  assert(env.ps[0].x - env.ps[1].x <= env.L.x + 0.5, 'a távolság nem lépi túl L-t');
});

test('feel 6: húzás-stamina: 3-8 mp húzás után kimerül, lassul, 2,5 mp pihenés alatt felépül; kikapcsolva nincs hatás', () => {
  const s0 = freeSpeed().sa;
  const env = atLimit({ stamina: true });
  run(env, dir(1), IDLE, 20);
  let frames = 20;
  const pre = run(env, dir(1), IDLE, 30); frames += 30;
  assert(!env.ps[0].exhausted, 'még nem kimerült');
  while (!env.ps[0].exhausted && frames < 900) { run(env, dir(1), IDLE, 1); frames++; }
  assert(frames >= 180 && frames <= 480, 'kimerülés ideje (kocka): ' + frames);
  const post = run(env, dir(1), IDLE, 30);
  assert(post.a.x < pre.a.x * 0.8, 'kimerülve lassabb a húzás');
  let r = 0;
  while (env.ps[0].exhausted && r < 400) { run(env, IDLE, IDLE, 1); r++; }
  assert(r > 0 && r <= 150, 'felépülés ideje (kocka): ' + r);
  assert(s0 > 0);
  const off = atLimit({ stamina: false });
  run(off, dir(1), IDLE, 900);
  assert(!off.ps[0].exhausted && off.ps[0].stamina === off.ps[0].staminaMax, 'kikapcsolt stamina: nincs költség');
});

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const DIRS = [dir(0, 0), dir(1, 0), dir(-1, 0), dir(0, 1), dir(0, -1), dir(1, 1), dir(-1, 1), dir(1, -1), dir(-1, -1)];

test('feel 7: fuzz: a távolság sosem lépi túl az L_eff-et, nincs NaN (tengelyenként)', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const rand = rng(seed);
    const env = setup({ ax: 200, ay: 100, bx: 100, by: 50, stamina: seed % 2 === 0 });
    let ia = IDLE, ib = IDLE, ta = 0, tb = 0;
    for (let f = 0; f < 2400; f++) {
      if (f >= ta) { ia = DIRS[Math.floor(rand() * DIRS.length)]; ta = f + 20 + Math.floor(rand() * 40); }
      if (f >= tb) { ib = DIRS[Math.floor(rand() * DIRS.length)]; tb = f + 20 + Math.floor(rand() * 40); }
      stepTetherSystem(env.sys, env.ps, [ia, ib], DT);
      const [a, b] = env.ps;
      assert(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(b.x) && Number.isFinite(b.y), 'NaN a ' + f + '. kockán');
      assert(Math.abs(a.x - b.x) <= env.L.x + 0.5, 'x túllépés, seed ' + seed + ', kocka ' + f);
      assert(Math.abs(a.y - b.y) <= env.L.y + 0.5, 'y túllépés, seed ' + seed + ', kocka ' + f);
    }
  }
});

test('feel 8: húzás és holtpont közben is mindkét játékos a képben marad (átlósan is)', () => {
  const SLACK = 32;
  for (const bDir of [IDLE, dir(-1, -1)]) {
    const L = setup({ ax: 0, bx: 0 }).L;
    const env = setup({ ax: L.x - 1, ay: L.y - 1, bx: 0, by: 0 });
    const cam = createCamera((env.ps[0].x + env.ps[1].x) / 2, (env.ps[0].y + env.ps[1].y) / 2);
    for (let f = 0; f < 600; f++) {
      stepTetherSystem(env.sys, env.ps, [dir(1, 1), bDir], DT);
      stepCamera(cam, env.ps[0], env.ps[1], DT, env.tc.cameraConfig(), CAM_VIEW);
      const off = cameraOffset(cam, CAM_VIEW);
      for (const p of env.ps) {
        assert(p.x >= off.x - SLACK && p.x <= off.x + CAM_VIEW.w + SLACK, 'x a képen kívül a ' + f + '. kockán');
        assert(p.y >= off.y - SLACK && p.y <= off.y + CAM_VIEW.h + SLACK, 'y a képen kívül a ' + f + '. kockán');
      }
    }
  }
});
