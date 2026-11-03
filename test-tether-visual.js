// Fonal-vizuál tesztek (S009): feszülés, görbe, stílus, szint-hiszterézis, események + integráció a póráz-rendszerrel.
import { test, assert, eq, near } from './test-index.js';

const DT = 1 / 60;
const free = { x: 'free', y: 'free' };

test('visual: a modul betölthető', async () => {
  const m = await import('./tether-visual.js');
  for (const k of ['tetherTension', 'tetherCurve', 'tetherStyle', 'nextLevel', 'createTetherVisual', 'stepTetherVisual']) {
    eq(typeof m[k], 'function', k);
  }
});

test('visual: feszülés — szorítás, NaN/Infinity, nem szabad mód', async () => {
  const { tetherTension } = await import('./tether-visual.js');
  near(tetherTension({ stretch: { x: 0.3, y: 0.5 }, mode: free }), 0.5);
  eq(tetherTension({ stretch: { x: Infinity, y: 0 }, mode: free }), 1);
  eq(tetherTension({ stretch: { x: NaN, y: NaN }, mode: free }), 0);
  near(tetherTension({ stretch: { x: -1, y: 0.2 }, mode: free }), 0.2);
  eq(tetherTension({ stretch: { x: 0, y: 0 }, mode: { x: 'hold', y: 'free' } }), 1);
  eq(tetherTension({ stretch: { x: 0, y: 0 }, mode: { x: 'free', y: 'pull-a' } }), 1);
  near(tetherTension({ stretch: { x: 0.2, y: 0.1 } }), 0.2);
  eq(tetherTension(null), 0);
});

test('visual: görbe — végpontok, egyenes feszesen, belógás laza, monoton, szimmetria', async () => {
  const { tetherCurve, VISUAL_CONFIG: C } = await import('./tether-visual.js');
  const a = { x: 100, y: 100 }, b = { x: 400, y: 250 };
  const n = C.segments;
  const taut = tetherCurve(a, b, 1);
  eq(taut.length, n + 1);
  eq(taut[0].x, a.x); eq(taut[0].y, a.y); eq(taut[n].x, b.x); eq(taut[n].y, b.y);
  for (const p of taut) near((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x), 0, 1e-6, 'nem egyenes');
  const slack = tetherCurve(a, b, 0);
  const mid = (pts) => pts[n / 2].y - (a.y + b.y) / 2;
  near(mid(slack), C.maxSag, 1e-9);
  let prev = Infinity;
  for (let s = 0; s <= 1.0001; s += 0.05) {
    const m = mid(tetherCurve(a, b, s));
    assert(m <= prev + 1e-9, 'a belógás nő a feszüléssel: ' + s);
    prev = m;
  }
  near(tetherCurve({ x: 0, y: 0 }, { x: 40, y: 0 }, 0)[n / 2].y, C.maxSag * (40 / C.sagDist), 1e-9); // rövid táv -> kisebb belógás
  const rev = tetherCurve(b, a, 0.3), fwd = tetherCurve(a, b, 0.3);
  for (let i = 0; i <= n; i++) { near(rev[i].x, fwd[n - i].x, 1e-9); near(rev[i].y, fwd[n - i].y, 1e-9); }
  for (const p of tetherCurve(a, a, 0)) assert(Number.isFinite(p.x) && Number.isFinite(p.y) && p.x === a.x && p.y === a.y, 'a==b hibás');
  for (const s of [NaN, -5, 5, Infinity]) for (const p of tetherCurve(a, b, s)) assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'rossz s: ' + s);
});

test('visual: stílus — szín-állomások, vastagság szint szerint, formátum', async () => {
  const { tetherStyle, VISUAL_CONFIG: C } = await import('./tether-visual.js');
  eq(tetherStyle(0, 'slack').color, 'rgb(111,168,220)');
  eq(tetherStyle(0.7, 'taut').color, 'rgb(255,210,122)');
  eq(tetherStyle(1, 'critical').color, 'rgb(255,106,74)');
  eq(tetherStyle(0, 'slack').width, C.widths.slack);
  eq(tetherStyle(0.8, 'taut').width, C.widths.taut);
  eq(tetherStyle(1, 'critical').width, C.widths.critical);
  assert(C.widths.slack < C.widths.taut && C.widths.taut < C.widths.critical, 'a vastagság nem nő');
  for (const s of [NaN, -1, 0.123, 0.5, 0.71, 0.999, 2, Infinity]) {
    assert(/^rgb\(\d+,\d+,\d+\)$/.test(tetherStyle(s, 'slack').color), 'szín-formátum: ' + s);
  }
  eq(tetherStyle(1, 'ismeretlen').level, 'critical'); // ismeretlen szint -> s-ből számolt
});

test('visual: szint-hiszterézis — sorrend, nincs villogás, ugrás', async () => {
  const { nextLevel } = await import('./tether-visual.js');
  const seq = []; let lv = 'slack';
  const sweep = (s) => { const n = nextLevel(lv, s); if (n !== lv) { seq.push(n); lv = n; } };
  for (let s = 0; s <= 1.0001; s += 0.01) sweep(s);
  for (let s = 1; s >= -0.0001; s -= 0.01) sweep(s);
  eq(seq.join(), 'taut,critical,taut,slack');
  let flick = 0; lv = 'slack';
  for (let i = 0; i < 200; i++) { const n = nextLevel(lv, 0.7 + (i % 2 ? 0.02 : -0.02)); if (n !== lv) { flick++; lv = n; } }
  eq(flick, 1);
  eq(nextLevel('slack', 1), 'critical');
  eq(nextLevel('critical', 0), 'slack');
  eq(nextLevel('nincs', 0), 'slack');
});

test('visual: lépés — simítás, események láncolata, leiratkozás, dt=0, NaN-védelem', async () => {
  const { createTetherVisual, stepTetherVisual } = await import('./tether-visual.js');
  const sys = { stretch: { x: 0, y: 0 }, mode: { x: 'free', y: 'free' } };
  const vis = createTetherVisual();
  const got = [];
  const off = vis.on(ev => got.push(ev));
  const ret = [];
  sys.stretch = { x: 1, y: 0 }; sys.mode = { x: 'hold', y: 'free' };
  const s0 = vis.s;
  ret.push(...stepTetherVisual(vis, sys, 0)); eq(vis.s, s0); // dt=0: nincs változás
  for (let i = 0; i < 180; i++) ret.push(...stepTetherVisual(vis, sys, DT));
  assert(vis.s > 0.99 && vis.s <= 1, 's nem közelíti az 1-et: ' + vis.s);
  eq(vis.level, 'critical');
  sys.stretch = { x: 0, y: 0 }; sys.mode = free;
  for (let i = 0; i < 300; i++) ret.push(...stepTetherVisual(vis, sys, DT));
  assert(vis.s < 0.01, 's nem tér vissza 0-ra: ' + vis.s);
  eq(vis.level, 'slack');
  eq(got.length, ret.length); // minden visszaadott esemény a hook-hoz is eljutott
  eq(got[0].from, 'slack');
  for (let i = 1; i < got.length; i++) eq(got[i].from, got[i - 1].to, 'megszakadt az eseménylánc');
  eq(got[got.length - 1].to, 'slack');
  assert(got.every(e => e.type === 'level' && e.from !== e.to && e.s >= 0 && e.s <= 1), 'hibás esemény');
  off();
  sys.stretch = { x: 1, y: 1 };
  for (let i = 0; i < 60; i++) stepTetherVisual(vis, sys, DT);
  eq(got.length, ret.length); // leiratkozás után nincs hívás
  sys.stretch = { x: NaN, y: NaN };
  for (let i = 0; i < 60; i++) stepTetherVisual(vis, sys, DT);
  assert(Number.isFinite(vis.s) && vis.s >= 0 && vis.s <= 1, 'NaN-védelem');
});

test('visual: integráció — 600 kocka a póráz-rendszerrel (görbe véges, s 0..1, eseménylánc, a feszülés eléri a korlátot)', async () => {
  const { createPlayer } = await import('./game-player.js');
  const { createTetherSystem, stepTetherSystem } = await import('./tether-system.js');
  const { createTetherVisual, stepTetherVisual, tetherTension, tetherCurve, tetherStyle } = await import('./tether-visual.js');
  const SCRIPT = [
    [[0, 150, 1, 0], [150, 300, 0, 0], [300, 420, 1, 1], [420, 600, -1, 0]],
    [[0, 100, 0, 0], [100, 250, -1, 0], [250, 400, 0, -1], [400, 600, 1, 0]],
  ];
  const inp = (p, f) => { for (const [s, e, x, y] of SCRIPT[p]) if (f >= s && f < e) return { x, y }; return { x: 0, y: 0 }; };
  const P = [createPlayer(0, 400, 300), createPlayer(1, 500, 300)];
  const sys = createTetherSystem({ L: { x: 320, y: 200 }, k: 0.5, walls: [] });
  const vis = createTetherVisual();
  const events = [];
  vis.on(e => events.push(e));
  let maxTarget = 0;
  for (let f = 0; f < 600; f++) {
    stepTetherSystem(sys, P, [inp(0, f), inp(1, f)], DT);
    stepTetherVisual(vis, sys, DT);
    maxTarget = Math.max(maxTarget, tetherTension(sys));
    assert(vis.s >= 0 && vis.s <= 1 && Number.isFinite(vis.s), `s hibás a ${f}. kockában`);
    for (const p of tetherCurve(P[0], P[1], vis.s)) assert(Number.isFinite(p.x) && Number.isFinite(p.y), `NaN görbe a ${f}. kockában`);
    assert(/^rgb\(/.test(tetherStyle(vis.s, vis.level).color), 'stílus hibás');
  }
  assert(maxTarget >= 0.99, 'a szkript nem feszítette meg a pórázt: ' + maxTarget);
  let lv = 'slack';
  for (const e of events) { eq(e.from, lv, 'megszakadt az eseménylánc'); lv = e.to; }
  eq(lv, vis.level);
});
