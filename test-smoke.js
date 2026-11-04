// Füst-teszt: az összes DOM-független modul betöltése + ~600 képkocka két szkriptelt játékossal.
// S008: a TetherConfig (póráz-konfig) egység- és futásidejű tesztjei a fájl végén.
// Új, DOM-független modult vegyél fel a MODULES listába (main.js és a renderelők kimaradnak).
import { test, assert, eq, near } from './test-index.js';

const MODULES = [
  './version.js', './core-screen.js', './core-input.js', './core-debug.js',
  './game-player.js', './game-camera.js', './tether-logic.js', './game-collision.js', './game-walls.js', './tether-system.js', './tether-config.js',
  './world-tiles.js', './world-tilemap.js', './world-arena.js', './render-tiles.js', './world-noise.js', './world-chunk.js',
  './world-stream.js', './render-chunks.js', './world-objects.js', './render-objects.js',
  './game-interact.js', './render-interact.js', './data-warps.js', './world-warp.js', './render-warp.js', './game-clock.js', './render-daynight.js',
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

test('smoke: aréna-falakkal 600 kocka két szkriptelt játékossal (nincs fal-átfedés, póráz-invariáns, nincs NaN)', async () => {
  const { createPlayer } = await import('./game-player.js');
  const { createCamera, stepCamera } = await import('./game-camera.js');
  const { createTetherSystem, stepTetherSystem } = await import('./tether-system.js');
  const { generateWalls } = await import('./game-walls.js');
  const { collides } = await import('./game-collision.js');
  const walls = generateWalls();
  const P = [createPlayer(0, 400, 270), createPlayer(1, 540, 270)];
  const sys = createTetherSystem({ L, k: 0.5, walls });
  const cam = createCamera(470, 270);
  const S = [ // a bal szoba falainak (keret, válaszfal) irányába is mennek
    [[0, 200, -1, 0], [200, 300, 0, 1], [300, 450, 1, 0], [450, 600, 0, -1]],
    [[0, 150, 0, -1], [150, 350, 1, 0], [350, 500, 0, 1], [500, 600, -1, 0]],
  ];
  const inp = (p, f) => { for (const [s, e, x, y] of S[p]) if (f >= s && f < e) return { x, y }; return { x: 0, y: 0 }; };
  let blocked = false;
  for (let f = 0; f < FRAMES; f++) {
    const d0 = { x: Math.abs(P[1].x - P[0].x), y: Math.abs(P[1].y - P[0].y) };
    stepTetherSystem(sys, P, [inp(0, f), inp(1, f)], DT);
    stepCamera(cam, P[0], P[1], DT);
    for (const p of P) {
      assert(Number.isFinite(p.x) && Number.isFinite(p.y), `NaN pozíció a ${f}. kockában`);
      assert(!collides(p, walls), `fal-átfedés a ${f}. kockában`);
    }
    assert(Number.isFinite(cam.x) && Number.isFinite(cam.y), `NaN kamera a ${f}. kockában`);
    for (const ax of ['x', 'y']) {
      const d1 = Math.abs(P[1][ax] - P[0][ax]);
      assert(d1 <= Math.max(L[ax], d0[ax]) + EPS, `távolság (${ax}) nőtt a ${f}. kockában: ${d1}`);
    }
    if (sys.blocked.a.x || sys.blocked.a.y || sys.blocked.b.x || sys.blocked.b.y) blocked = true;
  }
  assert(blocked, 'a szkript egyszer sem ütközött falnak');
});

// ---- S008: TetherConfig ----
function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}
async function mkConfig(storage = null) {
  const { TetherConfig } = await import('./tether-config.js');
  return new TetherConfig(storage);
}
const dump = o => JSON.stringify(o);

test('config: alapértékek = TETHER_CONFIG, L_normal képlet', async () => {
  const { TETHER_CONFIG } = await import('./tether-system.js');
  const { CAM_CONFIG } = await import('./game-camera.js');
  const tc = await mkConfig();
  eq(tc.k, TETHER_CONFIG.k); eq(tc.margin, CAM_CONFIG.margin);
  eq(tc.lNormal().x, TETHER_CONFIG.L.x); eq(tc.lNormal().y, TETHER_CONFIG.L.y);
  tc.margin = 100; tc.lScale = 0.5;
  eq(tc.lNormal().x, 380); eq(tc.lNormal().y, 170);
});

test('config: lépések, határok, kerekítés, ismeretlen művelet', async () => {
  const tc = await mkConfig();
  eq(tc.apply('k+'), true); eq(tc.k, 0.55);
  for (let i = 0; i < 30; i++) tc.apply('k+');
  eq(tc.k, 1); eq(tc.apply('k+'), false);
  for (let i = 0; i < 30; i++) tc.apply('k-');
  eq(tc.k, 0); eq(tc.apply('k-'), false);
  for (let i = 0; i < 40; i++) tc.apply('lScale-');
  eq(tc.lScale, 0.1);
  for (let i = 0; i < 40; i++) tc.apply('lScale+');
  eq(tc.lScale, 1);
  for (let i = 0; i < 40; i++) tc.apply('margin+');
  eq(tc.margin, 160);
  for (let i = 0; i < 40; i++) tc.apply('margin-');
  eq(tc.margin, 0);
  eq(tc.apply('nincs-ilyen'), false); eq(tc.apply('constructor'), false); eq(tc.apply(undefined), false);
});

test('config: stamina-kapcsoló, reset, HUD (nem mentett)', async () => {
  const { TETHER_STORAGE_KEY } = await import('./tether-config.js');
  const st = memStorage();
  const tc = await mkConfig(st);
  eq(tc.apply('stamina'), true); eq(tc.pullStamina, true);
  tc.apply('k+'); tc.apply('margin+'); tc.apply('lScale-');
  eq(tc.apply('hud'), true); eq(tc.hud, false);
  assert(!('hud' in JSON.parse(st.getItem(TETHER_STORAGE_KEY))), 'a HUD-állapot nem menthető');
  eq(tc.apply('reset'), true);
  eq(tc.k, 0.5); eq(tc.margin, 48); eq(tc.lScale, 1); eq(tc.pullStamina, false);
  eq(tc.apply('reset'), false); eq(tc.hud, false);
});

test('config: localStorage mentés/betöltés, rossz adatok, hibázó tároló', async () => {
  const { TETHER_STORAGE_KEY: K } = await import('./tether-config.js');
  const st = memStorage();
  const a = await mkConfig(st);
  a.apply('k-'); a.apply('margin+'); a.apply('lScale-'); a.apply('stamina');
  eq(dump((await mkConfig(st)).values()), dump(a.values()));
  eq(JSON.parse(st.getItem(K)).v, 1);
  const D = dump((await mkConfig()).values());
  for (const raw of ['{', 'null', '[]', '"x"', dump({ v: 2, k: 0.9 }), dump({ k: 0.9 })]) {
    eq(dump((await mkConfig(memStorage({ [K]: raw }))).values()), D, raw);
  }
  const c = (await mkConfig(memStorage({ [K]: dump({ v: 1, margin: 999, lScale: -3, k: '0.9', pullStamina: 'igen' }) }))).values();
  eq(c.margin, 160); eq(c.lScale, 0.1); eq(c.k, 0.5); eq(c.pullStamina, false);
  const boom = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  const t = await mkConfig(boom);
  eq(t.k, 0.5); t.apply('k+'); eq(t.k, 0.55);
});

test('config: élő k és L_normal a póráz-rendszerben (sys.k, sys.L)', async () => {
  const { createPlayer } = await import('./game-player.js');
  const { createTetherSystem, stepTetherSystem } = await import('./tether-system.js');
  const tc = await mkConfig();
  const sys = createTetherSystem(tc.systemConfig({ walls: [] }));
  const Lx = tc.lNormal().x;
  const P = [createPlayer(0, 1000, 300), createPlayer(1, 1000 + Lx, 300)]; // a korlátnál
  const pull = [{ x: -1, y: 0 }, { x: 0, y: 0 }];                           // A kifelé húz, B áll
  stepTetherSystem(sys, P, pull, DT);
  near(P[0].vx, -P[0].speed * 0.5, 1e-9); eq(sys.k.a, 0.5); eq(sys.k.b, 0.5); eq(sys.L.x, Lx);
  tc.k = 0; stepTetherSystem(sys, P, pull, DT);
  near(P[0].vx, 0, 1e-9); eq(sys.k.a, 0);
  tc.lScale = 0.5; stepTetherSystem(sys, P, [{ x: 0, y: 0 }, { x: 0, y: 0 }], DT);
  near(sys.L.x, 432, 1e-9); near(sys.L.y, 222, 1e-9);
  const s2 = createTetherSystem({ k: { a: 0.3, b: 0.7 } }); stepTetherSystem(s2, P, [{ x: 0, y: 0 }, { x: 0, y: 0 }], DT);
  eq(s2.k.a, 0.3); eq(s2.k.b, 0.7);
});

test('config: billentyű-leképezés, kötés, nincs ütközés a játékos-kiosztással', async () => {
  const { TETHER_KEYS, tetherKeyAction, bindTetherConfigKeys } = await import('./tether-config.js');
  const { DEFAULT_KEYS } = await import('./core-input.js');
  eq(tetherKeyAction({ code: 'Digit1' }), 'lScale-'); eq(tetherKeyAction({ code: 'Digit6' }), 'k+');
  eq(tetherKeyAction({ code: 'Digit1', ctrlKey: true }), null); eq(tetherKeyAction({ code: 'KeyW' }), null);
  eq(tetherKeyAction({ code: 'constructor' }), null); eq(tetherKeyAction(null), null);
  const used = new Set(DEFAULT_KEYS.flatMap(k => Object.values(k)));
  for (const code of Object.keys(TETHER_KEYS)) assert(!used.has(code), 'kiosztás-ütközés: ' + code);
  const all = await mkConfig();
  for (const a of Object.values(TETHER_KEYS)) all.apply(a); // minden művelet kezelt
  const tc = await mkConfig();
  let handler = null, removed = false, prevented = 0;
  const target = {
    addEventListener: (t, h) => { eq(t, 'keydown'); handler = h; },
    removeEventListener: (t, h) => { removed = h === handler; },
  };
  const off = bindTetherConfigKeys(tc, target);
  handler({ code: 'Digit6', preventDefault() { prevented++; } });
  eq(tc.k, 0.55); eq(prevented, 1);
  handler({ code: 'KeyW', preventDefault() { prevented++; } });
  eq(tc.k, 0.55); eq(prevented, 1);
  off(); assert(removed, 'a leválasztás nem működik');
  eq(typeof bindTetherConfigKeys(tc, null), 'function');
});

test('config: HUD sorok (stretch, k, L_eff), HU/EN kulcsok azonosak, nincs NaN/undefined', async () => {
  const { tetherHudLines, HUD_TEXT } = await import('./tether-config.js');
  const { createTetherSystem } = await import('./tether-system.js');
  eq(Object.keys(HUD_TEXT.en).join(), Object.keys(HUD_TEXT.hu).join());
  const tc = await mkConfig();
  const sys = createTetherSystem(tc.systemConfig());
  for (const S of [HUD_TEXT.hu, HUD_TEXT.en]) assert(!/NaN|undefined/.test(tetherHudLines(sys, tc, S).join('\n')), 'alap HUD hibás');
  sys.L = { x: 864, y: 444 }; sys.stretch = { x: 0.5, y: Infinity }; sys.mode = { x: 'free', y: 'hold' }; sys.k = { a: 0.5, b: 0.25 };
  const txt = tetherHudLines(sys, tc).join('\n');
  for (const part of ['864', '444', '0.50', 'Infinity', 'hold', 'a 0.50  b 0.25', '100%', '48 px']) assert(txt.includes(part), 'hiányzik a HUD-ból: ' + part);
});

test('config: fuzz — határok, 0 < L <= nézet-2*margó, mentés-betöltés azonos', async () => {
  const { TETHER_LIMITS, TETHER_KEYS } = await import('./tether-config.js');
  const acts = Object.values(TETHER_KEYS);
  const st = memStorage();
  const tc = await mkConfig(st);
  let seed = 12345;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 3000; i++) {
    tc.apply(acts[Math.floor(r() * acts.length)]);
    for (const key of ['margin', 'lScale', 'k']) {
      assert(tc[key] >= TETHER_LIMITS[key].min && tc[key] <= TETHER_LIMITS[key].max, `${key} tartományon kívül: ${tc[key]}`);
    }
    const L = tc.lNormal();
    assert(L.x > 0 && L.y > 0 && L.x <= 960 - 2 * tc.margin + 1e-9 && L.y <= 540 - 2 * tc.margin + 1e-9, 'L_normal hibás');
  }
  eq(dump((await mkConfig(st)).values()), dump(tc.values()));
});

test('smoke: futásidejű konfig-váltás 600 kockán (nincs NaN/fal-átfedés, távolság <= max(L_eff, előző), játékosok a képben)', async () => {
  const { createPlayer } = await import('./game-player.js');
  const { createCamera, stepCamera, CAM_VIEW } = await import('./game-camera.js');
  const { createTetherSystem, stepTetherSystem } = await import('./tether-system.js');
  const { generateWalls } = await import('./game-walls.js');
  const { collides } = await import('./game-collision.js');
  const walls = generateWalls();
  const tc = await mkConfig();
  const sys = createTetherSystem(tc.systemConfig({ walls }));
  const camCfg = tc.cameraConfig();
  const P = [createPlayer(0, 400, 270), createPlayer(1, 540, 270)];
  const cam = createCamera(470, 270);
  const ACTS = ['lScale-', 'k-', 'margin+', 'lScale-', 'k+', 'margin+', 'stamina', 'margin-', 'lScale+', 'reset'];
  let minL = Infinity, maxL = 0;
  for (let f = 0; f < FRAMES; f++) {
    if (f > 0 && f % 30 === 0) tc.apply(ACTS[(f / 30) % ACTS.length]);
    const d0 = { x: Math.abs(P[1].x - P[0].x), y: Math.abs(P[1].y - P[0].y) };
    stepTetherSystem(sys, P, [scripted(0, f), scripted(1, f)], DT);
    stepCamera(cam, P[0], P[1], DT, camCfg);
    eq(camCfg.margin, tc.margin);
    minL = Math.min(minL, sys.L.x); maxL = Math.max(maxL, sys.L.x);
    assert(Number.isFinite(cam.x) && Number.isFinite(cam.y), `NaN kamera a ${f}. kockában`);
    for (const p of P) {
      assert(Number.isFinite(p.x) && Number.isFinite(p.y), `NaN pozíció a ${f}. kockában`);
      assert(!collides(p, walls), `fal-átfedés a ${f}. kockában`);
      assert(Math.abs(p.x - cam.x) <= CAM_VIEW.w / 2 + EPS && Math.abs(p.y - cam.y) <= CAM_VIEW.h / 2 + EPS, `játékos a képen kívül a ${f}. kockában`);
    }
    for (const ax of ['x', 'y']) {
      const d1 = Math.abs(P[1][ax] - P[0][ax]);
      assert(d1 <= Math.max(sys.L[ax], d0[ax]) + EPS, `távolság (${ax}) nőtt a ${f}. kockában: ${d1}`);
    }
  }
  assert(maxL - minL > 80, 'a konfig nem változtatta az L_eff-et');
});

test('smoke: k-hook + húzás-stamina 600 kockán (TetherConfig kapcsoló, kimerülés, felépülés, HUD, nincs NaN)', async () => {
  const { createPlayer } = await import('./game-player.js');
  const { createTetherSystem, stepTetherSystem } = await import('./tether-system.js');
  const { tetherHudLines } = await import('./tether-config.js');
  const tc = await mkConfig();
  const sys = createTetherSystem({ ...tc.systemConfig(), L: { x: 200, y: 200 } });
  const P = [Object.assign(createPlayer(0, 400, 300), { strength: 1.2 }), Object.assign(createPlayer(1, 500, 300), { load: 0.5 })];
  const hud = () => tetherHudLines(sys, tc).filter(l => l.startsWith('stamina  a '));
  let sawEx = false, hudEx = '';
  stepTetherSystem(sys, P, [{ x: 0, y: 0 }, { x: 0, y: 0 }], DT);
  eq(hud().length, 0); // kapcsoló nélkül nincs stamina-sor
  eq(tc.apply('stamina'), true);
  for (let f = 0; f < FRAMES; f++) {
    const ex = P[0].exhausted;
    stepTetherSystem(sys, P, [f < 450 ? { x: -1, y: 0 } : { x: 1, y: 0 }, { x: 0, y: 0 }], DT);
    for (const p of P) {
      assert(Number.isFinite(p.x) && Number.isFinite(p.y), `NaN pozíció a ${f}. kockában`);
      assert(p.stamina >= 0 && p.stamina <= p.staminaMax, `stamina tartományon kívül a ${f}. kockában`);
    }
    assert(Math.abs(P[1].x - P[0].x) <= 200 + EPS, `L_eff túllépve a ${f}. kockában`);
    if (ex && sys.mode.x === 'pull-a') { // kimerült húzó: 0.5 · 1.2 · (1/1.5) · 0.5 = 0.2
      sawEx = true; near(sys.k.a, 0.2, 1e-12); near(P[0].vx, -P[0].speed * 0.2, 1e-9); hudEx = hud()[0] || '';
    }
  }
  assert(sawEx, 'a húzó nem merült ki');
  assert(/kimerült/.test(hudEx) && /0\/100/.test(hudEx), 'a HUD nem mutatja a kimerültséget: ' + hudEx);
  eq(P[0].exhausted, false); assert(P[0].stamina > 20, 'nem épült fel');
  near(sys.k.a, 0.2 * 2, 1e-12);
  eq(tc.apply('stamina'), true); eq(hud().length, 0);
});

// ---- S013: chunk-streaming szimuláció (csak világ-modulok; nincs DOM) ----
test('smoke: 600 kocka chunk-betöltés két mozgó pozíció körül (nincs kivétel, érvényes id-k, újragenerálás azonos)', async () => {
  const { generateChunk, chunkCoord, chunkKey, CHUNK_SIZE } = await import('./world-chunk.js');
  const { TILE_COUNT } = await import('./world-tiles.js');
  const SEED = 12013, R = 1; // betöltési sugár chunkban
  const cache = new Map();
  const P = [{ x: 0, y: 0 }, { x: 40, y: 20 }];
  for (let f = 0; f < FRAMES; f++) {
    P[0].x += 7.3; P[0].y -= 2.9;        // az egyik játékos folyamatosan távolodik
    P[1].x -= 3.1; P[1].y += 5.7;        // a másik az ellenkező irányba
    for (const p of P) {
      assert(Number.isFinite(p.x) && Number.isFinite(p.y), `NaN pozíció a ${f}. kockában`);
      const cx = chunkCoord(p.x / 32), cy = chunkCoord(p.y / 32);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const k = chunkKey(cx + dx, cy + dy);
        if (!cache.has(k)) cache.set(k, generateChunk(SEED, cx + dx, cy + dy));
      }
    }
  }
  assert(cache.size > 20, 'kevés chunk töltődött be: ' + cache.size);
  for (const c of cache.values()) {
    eq(c.tiles.length, CHUNK_SIZE * CHUNK_SIZE);
    for (let i = 0; i < c.tiles.length; i += 17) assert(c.tiles[i] < TILE_COUNT, 'érvénytelen tile-id');
    const again = generateChunk(SEED, c.cx, c.cy);
    eq(again.tiles.join(), c.tiles.join(), 'újragenerálás eltér: ' + c.cx + ',' + c.cy);
  }
});

// ---- S015: a teljes lánc objektumokkal (streaming -> objektumok -> falak -> póráz), mint a main.js ----
test('smoke (S015): 600 kocka objektumokkal: ütköző fák/kövek, y-sort, élő szinkron (nincs NaN, nincs fal-átfedés, táv. <= L_eff)', async () => {
  const { createPlayer } = await import('./game-player.js');
  const { createTetherSystem, stepTetherSystem } = await import('./tether-system.js');
  const { collides } = await import('./game-collision.js');
  const { WORLD_SEED, createWorldStream, warmStream, updateStream, streamWalls, findOpenSpot } = await import('./world-stream.js');
  const { createObjectStore, syncObjects, objectColliders, visibleObjects, sortByY, footY } = await import('./world-objects.js');
  const spot = findOpenSpot(WORLD_SEED, 0, 0);
  const P = [createPlayer(0, spot.x - 70, spot.y), createPlayer(1, spot.x + 70, spot.y)];
  const ws = createWorldStream(WORLD_SEED);
  warmStream(ws, P);
  const os = createObjectStore(WORLD_SEED, { keepFree: [{ x: spot.x, y: spot.y, r: 224 }] });
  syncObjects(os, ws);
  const walls = [];
  let key = '';
  const refresh = () => {
    const k = ws.version + '|' + os.version;
    if (k === key) return false;
    key = k; walls.length = 0;
    for (const r of streamWalls(ws)) walls.push(r);
    for (const r of objectColliders(os)) walls.push(r);
    return true;
  };
  refresh();
  const L = { x: 400, y: 260 };
  const sys = createTetherSystem({ walls, L, k: 0.5 });
  const inp = (f, p) => ({ x: Math.sin(f / (50 + 17 * p)) > -0.2 ? 1 : -1, y: Math.cos(f / (70 + 23 * p)) > 0 ? 1 : -1, interact: false, ability1: false, ability2: false, menu: false });
  let refreshes = 0, maxVisible = 0;
  const start = [P[0].x, P[0].y];
  for (let f = 0; f < FRAMES; f++) {
    updateStream(ws, P);
    syncObjects(os, ws);
    if (refresh()) refreshes++;
    const prev = Math.abs(P[0].x - P[1].x);
    stepTetherSystem(sys, P, [inp(f, 0), inp(f, 1)], DT);
    for (const p of P) {
      assert(Number.isFinite(p.x) && Number.isFinite(p.y), `NaN pozíció a ${f}. kockában`);
      assert(!collides(p, walls), `fal-/objektum-átfedés a ${f}. kockában`);
    }
    assert(Math.abs(P[0].x - P[1].x) <= Math.max(L.x, prev) + EPS, `táv. > L_eff a ${f}. kockában`);
    if (f % 20 === 0) {
      const o = { x: Math.round((P[0].x + P[1].x) / 2 - 480), y: Math.round((P[0].y + P[1].y) / 2 - 270) };
      const list = visibleObjects(os, o.x, o.y, 960, 540);
      maxVisible = Math.max(maxVisible, list.length);
      for (const p of P) list.push(p);
      sortByY(list);
      for (let i = 1; i < list.length; i++) assert(footY(list[i - 1]) <= footY(list[i]), 'y-sort sorrend sérült');
    }
  }
  assert(Math.hypot(P[0].x - start[0], P[0].y - start[1]) > 100, 'a játékosok elmozdultak');
  assert(refreshes >= 1 && maxVisible > 0, 'objektumok láthatók voltak: ' + maxVisible);
  assert(os.chunks.size === ws.chunks.size && os.chunks.size <= 18, 'a tár a streamet követi, korlátos');
});
