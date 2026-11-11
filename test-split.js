// S023: két nézet (game-splitview.js + render-split.js) tesztjei. Node-ban fut, hamis canvas-szal.
import { test, assert, eq, near } from './test-index.js';
import { SPLIT_CONFIG, splitLayout, createSplitView, snapSplitView, stepSplitView, splitOffsets, viewContains } from './game-splitview.js';
import { createSplitRenderer, beginView, composeSplit, SPLIT_STYLE } from './render-split.js';
import { cameraOffset, CAM_CONFIG } from './game-camera.js';
import { createPlayer } from './game-player.js';
import { createTetherSystem, stepTetherSystem, TETHER_CONFIG } from './tether-system.js';

const P = (x, y) => ({ x, y });
const STEP = 1 / 60;

function fakeCanvas(w, h) {
  const calls = [];
  const ctx = {
    calls, imageSmoothingEnabled: true, fillStyle: '',
    fillRect(...a) { calls.push(['fillRect', this.fillStyle, ...a]); },
    drawImage(...a) { calls.push(['drawImage', ...a]); },
  };
  return { width: w, height: h, calls, getContext: () => ctx, ctx };
}

test('split: elrendezés két egyforma fél, osztóvonal középen', () => {
  const L = splitLayout();
  eq(L.views.length, 2);
  eq(L.views[0].x, 0); eq(L.views[0].w, 480); eq(L.views[1].x, 480); eq(L.views[1].w, 480);
  eq(L.views[0].h, 540);
  eq(L.divider.w, SPLIT_CONFIG.divider);
  eq(L.divider.x, 479); // a 480-as határ körül (479..481)
  const odd = splitLayout({ w: 961, h: 540, divider: 2 });
  eq(odd.views[0].w + odd.views[1].w, 961);
  eq(odd.views[1].x, odd.views[0].w);
});

test('split: hibás elrendezés-konfig nem dob, értelmes értékre szorít', () => {
  const L = splitLayout({ w: NaN, h: -5, divider: 1e9 });
  assert(L.w >= 2 && L.h >= 1, 'méret');
  assert(L.divider.w <= 8 && L.divider.w >= 0, 'osztó vastagság');
  const L2 = splitLayout({ w: 960, h: 540, divider: -3 });
  eq(L2.divider.w, 0);
  const L3 = splitLayout({});
  eq(L3.views[0].w, 480);
});

test('split: a kamerák induláskor a saját játékosukon állnak', () => {
  const sv = createSplitView([P(100, 200), P(900, -50)]);
  eq(sv.cams[0].x, 100); eq(sv.cams[0].y, 200);
  eq(sv.cams[1].x, 900); eq(sv.cams[1].y, -50);
  assert(sv.cams[0] !== sv.cams[1], 'külön kamera-objektum');
});

test('split: mindkét kamera a SAJÁT játékosához konvergál (nem a felezőponthoz)', () => {
  const sv = createSplitView([P(0, 0), P(0, 0)]);
  const ps = [P(300, 200), P(5000, -800)];
  for (let i = 0; i < 600; i++) stepSplitView(sv, ps, STEP, CAM_CONFIG);
  near(sv.cams[0].x, 300, 0.01); near(sv.cams[0].y, 200, 0.01);
  near(sv.cams[1].x, 5000, 0.01); near(sv.cams[1].y, -800, 0.01);
});

test('split: fps-független simítás', () => {
  const cfg = { k: 6, margin: -1e6 }; // késés-korlát kikapcsolva
  const a = createSplitView([P(0, 0), P(0, 0)]), b = createSplitView([P(0, 0), P(0, 0)]);
  const ps = [P(400, 100), P(-300, 50)];
  for (let i = 0; i < 60; i++) stepSplitView(a, ps, 1 / 60, cfg);
  for (let i = 0; i < 30; i++) stepSplitView(b, ps, 1 / 30, cfg);
  for (let i = 0; i < 2; i++) {
    near(a.cams[i].x, b.cams[i].x, 1e-6, 'x' + i);
    near(a.cams[i].y, b.cams[i].y, 1e-6, 'y' + i);
  }
});

test('split: a játékos mindig a saját nézetében marad, gyors mozgás közben is', () => {
  const ps = [P(0, 0), P(4000, 0)];
  const sv = createSplitView(ps);
  const offs = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  for (let f = 0; f < 600; f++) {
    ps[0].x += 400 * STEP; ps[0].y += 150 * STEP * Math.sin(f / 20);
    ps[1].x -= 300 * STEP; ps[1].y -= 250 * STEP;
    stepSplitView(sv, ps, STEP, CAM_CONFIG);
    splitOffsets(sv, offs);
    for (let i = 0; i < 2; i++) assert(viewContains(sv, i, ps[i], 0, offs), `kocka ${f}: a ${i}. játékos kilóg a nézetből`);
  }
});

test('split: offset egész pixel, a nézet-méretből számolt, hibás játékos érintetlenül hagyja a kamerát', () => {
  const sv = createSplitView([P(123.4, 77.7), P(-50.5, 10.2)]);
  const o = splitOffsets(sv);
  for (let i = 0; i < 2; i++) {
    assert(Number.isInteger(o[i].x) && Number.isInteger(o[i].y), 'egész');
    const v = sv.layout.views[i];
    const ref = cameraOffset(sv.cams[i], { w: v.w, h: v.h });
    eq(o[i].x, ref.x); eq(o[i].y, ref.y);
  }
  const before = JSON.stringify(sv.cams);
  stepSplitView(sv, [P(NaN, 0), null], STEP, CAM_CONFIG);
  snapSplitView(sv, [P(Infinity, 1), undefined]);
  eq(JSON.stringify(sv.cams), before);
});

test('split: snap (warp) azonnal a játékosokra ugrik', () => {
  const sv = createSplitView([P(0, 0), P(10, 10)]);
  snapSplitView(sv, [P(1048576, 1048576), P(1048600, 1048590)]);
  eq(sv.cams[0].x, 1048576); eq(sv.cams[1].y, 1048590);
});

test('split-render: két offscreen canvas nézetenként, kikapcsolt simítással', () => {
  const made = [];
  const rend = createSplitRenderer(splitLayout(), (w, h) => { const c = fakeCanvas(w, h); made.push(c); return c; });
  eq(made.length, 2);
  eq(made[0].width, 480); eq(made[1].height, 540);
  assert(made[0].ctx.imageSmoothingEnabled === false && made[1].ctx.imageSmoothingEnabled === false, 'imageSmoothing');
  const ctx = beginView(rend, 1);
  assert(ctx === made[1].ctx, 'a 1. nézet ctx-e');
  const c = made[1].calls[0];
  eq(c[0], 'fillRect'); eq(c[1], SPLIT_STYLE.clear); eq(c[4], 480); eq(c[5], 540);
  eq(made[0].calls.length, 0);
  eq(rend.stats.begun, 1);
});

test('split-render: a kompozíció a két nézetet a helyére másolja, majd az osztóvonal', () => {
  const rend = createSplitRenderer(splitLayout(), fakeCanvas);
  const main = fakeCanvas(960, 540);
  const n = composeSplit(main.ctx, rend);
  eq(n, 2);
  const draws = main.calls.filter(c => c[0] === 'drawImage');
  eq(draws.length, 2);
  eq(draws[0][1], rend.canvases[0]); eq(draws[0][6], 0); eq(draws[0][7], 0);
  eq(draws[1][1], rend.canvases[1]); eq(draws[1][6], 480);
  const rects = main.calls.filter(c => c[0] === 'fillRect');
  eq(rects.length, 1);
  eq(rects[0][1], SPLIT_STYLE.divider); eq(rects[0][2], 479); eq(rects[0][4], 2); eq(rects[0][5], 540);
  assert(main.calls.indexOf(rects[0]) > main.calls.indexOf(draws[1]), 'az osztóvonal a nézetek fölé kerül');
  eq(rend.stats.composed, 1);
  // vastagság 0: nincs osztóvonal
  const r0 = createSplitRenderer(splitLayout({ w: 960, h: 540, divider: 0 }), fakeCanvas);
  const m0 = fakeCanvas(960, 540);
  composeSplit(m0.ctx, r0);
  eq(m0.calls.filter(c => c[0] === 'fillRect').length, 0);
});

test('split: 600 kocka a póráz-rendszerrel, két szkriptelt játékos (nincs NaN, mindkettő a saját nézetében)', () => {
  const ps = [createPlayer(0, 0, 0), createPlayer(1, 100, 0)];
  const tether = createTetherSystem({ ...TETHER_CONFIG, walls: [] });
  const sv = createSplitView(ps);
  const offs = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  let apart = 0;
  for (let f = 0; f < 600; f++) {
    const a = f < 300 ? { x: 1, y: 0 } : { x: -1, y: 0.4 };
    const b = f < 150 ? { x: 0, y: 0 } : { x: 1, y: -0.3 };
    stepTetherSystem(tether, ps, [a, b], STEP);
    stepSplitView(sv, ps, STEP, CAM_CONFIG);
    splitOffsets(sv, offs);
    for (let i = 0; i < 2; i++) {
      assert(Number.isFinite(ps[i].x) && Number.isFinite(sv.cams[i].x) && Number.isFinite(sv.cams[i].y), `NaN a ${f}. kockán`);
      assert(viewContains(sv, i, ps[i], 0, offs), `kocka ${f}: a ${i}. játékos kilóg`);
    }
    if (Math.abs(sv.cams[0].x - sv.cams[1].x) > 50) apart++;
  }
  assert(apart > 0, 'a két kamera sosem vált szét (mindkettő ugyanazt követi?)');
});
