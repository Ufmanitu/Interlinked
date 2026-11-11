// S023: két nézet (game-splitview.js + render-split.js) tesztjei; S025: összeolvadás (hiszterézis, átmenet, közös kép). Node-ban fut, hamis canvas-szal.
import { test, assert, eq, near } from './test-index.js';
import { SPLIT_CONFIG, splitLayout, createSplitView, snapSplitView, stepSplitView, splitOffsets, viewContains, mergeRatio, mergeDecide, mergeBlend, normalL, viewOwner } from './game-splitview.js';
import { createSplitRenderer, beginView, composeSplit, dividerAlpha, SPLIT_STYLE } from './render-split.js';
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

// ---- S025: összeolvadás ----
const LN = { x: 864, y: 444 }; // L_normal (TETHER_CONFIG.L)
const OFFS = () => [{ x: 0, y: 0 }, { x: 0, y: 0 }];
function settle(sv, ps, n = 90, L = LN) { for (let i = 0; i < n; i++) stepSplitView(sv, ps, STEP, CAM_CONFIG, L); }
const ownerVisible = (sv, ps, offs) => (splitOffsets(sv, offs), [0, 1].every(i => viewContains(sv, i, ps[viewOwner(sv, i)], 0, offs))); // mindkét játékos a SAJÁT nézetében (szétválva)
const anyVisible = (sv, ps, offs) => (splitOffsets(sv, offs), ps.every(p => [0, 1].some(i => viewContains(sv, i, p, 0, offs)))); // legalább az egyik nézetben (összeolvadva a határ a felezőpontnál van)

test('merge: r = max(|Δx|/Lx, |Δy|/Ly), L-változatok, hibás bemenet', () => {
  near(mergeRatio(P(0, 0), P(432, 0), LN), 0.5); near(mergeRatio(P(0, 0), P(0, 444), LN), 1);
  near(mergeRatio(P(0, 0), P(864, 222), LN), 1); near(mergeRatio(P(0, 0), P(432, 0), 864), 0.5); // a nagyobb tengely dönt; szám-L
  assert(Number.isNaN(mergeRatio(P(NaN, 0), P(1, 1), LN)), 'hibás pozíció');
  assert(Number.isNaN(mergeRatio(P(0, 0), P(1, 1), { x: 0, y: 5 })), 'nulla L');
  assert(Number.isNaN(mergeRatio(P(0, 0), P(1, 1))), 'nincs L');
  eq(normalL(() => 100).y, 100); eq(normalL(ps => ps.length, [1, 2]).x, 2); eq(normalL(-3), null); eq(normalL({ x: 1 }), null);
});

test('merge: hiszterézis (0,85 összeolvad, 1,0 felett szétválik, közte marad), zajtűrés a korlátnál', () => {
  eq(mergeDecide(false, 0.85), true); eq(mergeDecide(false, 0.86), false);
  eq(mergeDecide(true, 1.0), true); eq(mergeDecide(true, 1.0 + 1e-9), true); eq(mergeDecide(true, 1.004), true);
  eq(mergeDecide(true, 1.01), false); eq(mergeDecide(false, 0.99), false); eq(mergeDecide(true, 0.9), true);
  eq(mergeDecide(true, NaN), true); eq(mergeDecide(false, NaN), false);
  const sv = createSplitView([P(0, 0), P(1000, 0)], undefined, LN);
  eq(sv.merge.on, false);
  const ps = [P(0, 0), P(1000, 0)];
  const at = dx => { ps[1].x = dx; settle(sv, ps, 40); return sv.merge.on; };
  eq(at(800), false, 'r=0,93 szétválva marad'); eq(at(730), true, 'r=0,845 összeolvad');
  eq(at(850), true, 'r=0,98 összeolvadva marad'); eq(at(864 + 1e-7), true, 'a korlátnál zaj nem választ szét');
  eq(at(880), false, 'r=1,02 szétválik'); eq(at(850), false, 'r=0,98 szétválva marad'); eq(at(0), true);
  ps[1].x = 0; ps[1].y = 450; settle(sv, ps, 40); eq(sv.merge.on, false, 'az y tengely is szétválaszt (450 > 444)');
});

test('merge: a hiszterézis-sávban rezgő távolság nem villog (nincs állapotváltás)', () => {
  const ps = [P(0, 0), P(500, 0)];
  const sv = createSplitView(ps, undefined, LN);
  eq(sv.merge.on, true);
  let changes = 0, prev = sv.merge.on;
  for (let f = 0; f < 600; f++) {
    ps[1].x = 0.9 * 864 + 0.09 * 864 * (0.5 + 0.5 * Math.sin(f / 3)); // 0,90..0,99 L
    stepSplitView(sv, ps, STEP, CAM_CONFIG, LN);
    if (sv.merge.on !== prev) { changes++; prev = sv.merge.on; }
    eq(mergeBlend(sv), 1, 'a kép végig összeolvadt');
  }
  eq(changes, 0);
});

test('merge: összeolvadva egyetlen közös kép (nézetek egymás mellé, felezőpont, nincs osztóvonal)', () => {
  const ps = [P(1000, 700), P(1400, 720)];
  const sv = createSplitView(ps, undefined, LN);
  settle(sv, ps, 120);
  eq(mergeBlend(sv), 1);
  const o = splitOffsets(sv), ref = cameraOffset(sv.common, { w: 960, h: 540 });
  eq(o[1].x - o[0].x, 480); eq(o[0].y, o[1].y); eq(o[0].x, ref.x); eq(o[0].y, ref.y);
  near(o[0].x + 480, 1200, 1); near(o[0].y + 270, 710, 1); // a felezőpont a kép közepén
  assert(anyVisible(sv, ps, OFFS()), 'mindkét játékos a közös képben');
  for (let k = 0; k < 400; k++) { // a félpixel alatti legközelebbi lebegőpontos érték (nagy koordinátán): nincs 1 px-es varrat
    sv.common.x = (k % 2 ? 1048000 : 5000) + k + 0.5 - (k % 2 ? 2 ** -33 : 2 ** -43); sv.common.y = 300000 + k + 0.5 - 2 ** -35; splitOffsets(sv, o);
    eq(o[1].x - o[0].x, 480, 'varrat x ' + sv.common.x); eq(o[0].y, o[1].y, 'varrat y');
  }
});

test('merge: az osztóvonal halványul, összeolvadva nem rajzolódik', () => {
  eq(dividerAlpha(0), 1); eq(dividerAlpha(1), 0); near(dividerAlpha(0.25), 0.75); eq(dividerAlpha(NaN), 1); eq(dividerAlpha(-2), 1); eq(dividerAlpha(7), 0);
  const rend = createSplitRenderer(splitLayout(), fakeCanvas), rec = [];
  const ctx = { globalAlpha: 1, fillStyle: '', drawImage() {}, fillRect(...a) { rec.push([this.globalAlpha, this.fillStyle, ...a]); } };
  composeSplit(ctx, rend, 0.5);
  eq(rec.length, 1); near(rec[0][0], 0.5); eq(rec[0][1], SPLIT_STYLE.divider); eq(ctx.globalAlpha, 1, 'az alpha visszaáll');
  rec.length = 0; composeSplit(ctx, rend, 1); eq(rec.length, 0);
  rec.length = 0; composeSplit(ctx, rend); eq(rec.length, 1); near(rec[0][0], 1);
});

test('merge: szétválás és összeolvadás simított, monoton átmenet, a játékosok végig a saját nézetükben', () => {
  const e0 = createSplitView([P(0, 0), P(2000, 0)], undefined, LN), q = [P(0, 0), P(300, 0)];
  for (let i = 0; i < 6; i++) stepSplitView(e0, q, STEP, CAM_CONFIG, LN); // 0,1 mp az 0,4 mp-ből: s = 0,25
  near(mergeBlend(e0), 0.15625, 1e-6, 'smoothstep (nem lineáris)');
  const ps = [P(0, 0), P(300, 0)];
  const sv = createSplitView(ps, undefined, LN);
  const offs = OFFS(), prev = OFFS(); splitOffsets(sv, prev);
  let transitions = 0, last = sv.merge.on, maxJump = 0, lastE = mergeBlend(sv), sawMid = false;
  for (let f = 0; f < 700; f++) {
    ps[1].x += (f < 350 ? 1 : -1) * 220 * STEP; // szét, majd vissza (kb. 1,8x játékos-sebesség: szigorúbb a valóságosnál)
    stepSplitView(sv, ps, STEP, CAM_CONFIG, LN);
    const e = mergeBlend(sv);
    assert(Number.isFinite(e) && e >= 0 && e <= 1, 'e tartomány');
    if (sv.merge.on !== last) { transitions++; last = sv.merge.on; }
    assert(sv.merge.on ? e >= lastE - 1e-12 : e <= lastE + 1e-12, `kocka ${f}: az átmenet nem monoton`);
    sawMid = sawMid || (e > 0.05 && e < 0.95); lastE = e;
    assert(anyVisible(sv, ps, offs), `kocka ${f}: egy játékos egyik nézetben sem látszik (e=${e.toFixed(2)})`);
    if (e < 0.5) assert(ownerVisible(sv, ps, offs), `kocka ${f}: egy játékos kilóg a saját nézetéből (e=${e.toFixed(2)})`);
    for (let i = 0; i < 2; i++) { maxJump = Math.max(maxJump, Math.abs(offs[i].x - prev[i].x), Math.abs(offs[i].y - prev[i].y)); prev[i].x = offs[i].x; prev[i].y = offs[i].y; }
  }
  eq(transitions, 2, 'pontosan egy szétválás és egy összeolvadás'); eq(mergeBlend(sv), 1);
  assert(sawMid, 'volt köztes (simított) állapot'); assert(maxJump <= 20, 'a nézet kocka-ugrása túl nagy: ' + maxJump);
});

test('merge: a bal/jobb nézet a bal/jobb játékost követi (a csere összeolvadva, láthatatlanul)', () => {
  const ps = [P(0, 0), P(-300, 0)]; // a P1 a jobb oldalon
  const sv = createSplitView(ps, undefined, LN);
  eq(sv.order, 1); eq(viewOwner(sv, 0), 1); eq(viewOwner(sv, 1), 0);
  const offs = OFFS();
  for (let f = 0; f < 500; f++) {
    ps[0].x += 220 * STEP; // a P1 jobbra távolodik
    stepSplitView(sv, ps, STEP, CAM_CONFIG, LN);
    assert(anyVisible(sv, ps, offs), `kocka ${f}: kilóg`);
    if (mergeBlend(sv) < 0.5) assert(ownerVisible(sv, ps, offs), `kocka ${f}: kilóg a saját nézetéből`);
  }
  eq(sv.merge.on, false); eq(sv.order, 1);
  near(sv.cams[0].x, ps[1].x, 200); near(sv.cams[1].x, ps[0].x, 200); // a bal nézet a bal játékosnál
  // átlépnek egymáson összeolvadva: a sorrend megfordul, a kép nem ugrik
  const ps2 = [P(-100, 0), P(100, 0)];
  const s2 = createSplitView(ps2, undefined, LN);
  eq(s2.order, 0); settle(s2, ps2, 90);
  const before = splitOffsets(s2).map(o => ({ ...o }));
  ps2[0].x = 150; ps2[1].x = -150; settle(s2, ps2, 1);
  eq(s2.order, 1);
  const after = splitOffsets(s2); // kamera-simítás miatt kis elmozdulás lehet, de nem ugrás
  for (let i = 0; i < 2; i++) assert(Math.abs(after[i].x - before[i].x) <= 8, 'a csere ugrást okozott');
});

test('merge: L nélkül/hibás L-lel nincs összeolvadás; snap és létrehozás az állapotot is beállítja', () => {
  const ps = [P(0, 0), P(50, 0)];
  const sv = createSplitView(ps);
  for (const L of [undefined, NaN, 0, null, { x: 5 }]) {
    for (let i = 0; i < 60; i++) stepSplitView(sv, ps, STEP, CAM_CONFIG, L); // (settle: az undefined L-t LN-re cserélné)
    eq(mergeBlend(sv), 0, 'L=' + JSON.stringify(L));
  }
  const m = createSplitView(ps, undefined, LN);
  eq(m.merge.on, true); eq(mergeBlend(m), 1);
  for (let i = 0; i < 60; i++) stepSplitView(m, ps, STEP, CAM_CONFIG); // az L kiesése: szétválva (nem ragad összeolvadva)
  eq(mergeBlend(m), 0); snapSplitView(m, ps, LN);
  snapSplitView(m, [P(0, 0), P(2000, 0)], LN);
  eq(m.merge.on, false); eq(mergeBlend(m), 0);
  snapSplitView(m, [P(1048576, 1048576), P(1048600, 1048590)], LN);
  eq(m.merge.on, true); eq(mergeBlend(m), 1); near(m.common.x, 1048588, 1e-6);
  const before = JSON.stringify([m.cams, m.common, m.merge]);
  snapSplitView(m, [P(NaN, 0), undefined], LN); stepSplitView(m, [null, P(NaN, 1)], STEP, CAM_CONFIG, LN);
  eq(JSON.stringify([m.cams, m.common, m.merge]), before, 'hibás játékos nem rontja el az állapotot');
});

test('merge: 600 kocka a póráz-rendszerrel falun kívül: végig összeolvadt kép, a korlátnál sem választ szét', () => {
  const ps = [createPlayer(0, 0, 0), createPlayer(1, 100, 0)];
  const tether = createTetherSystem({ ...TETHER_CONFIG, walls: [] });
  const sv = createSplitView(ps, undefined, TETHER_CONFIG.L);
  const offs = OFFS();
  let atLimit = 0;
  for (let f = 0; f < 600; f++) {
    const a = f < 400 ? { x: 1, y: 0.3 } : { x: -1, y: -0.2 }, b = f < 100 ? { x: 0, y: 0 } : f < 450 ? { x: -1, y: 0 } : { x: 1, y: 1 };
    stepTetherSystem(tether, ps, [a, b], STEP);
    stepSplitView(sv, ps, STEP, CAM_CONFIG, TETHER_CONFIG.L);
    eq(mergeBlend(sv), 1, `kocka ${f}: szétvált a kép a pórázon belül`);
    assert(Number.isFinite(sv.common.x) && Number.isFinite(ps[0].x), 'NaN');
    assert(anyVisible(sv, ps, offs), `kocka ${f}: kilóg`);
    if (tether.stretch.x >= 0.999 || tether.stretch.y >= 0.999) atLimit++;
  }
  assert(atLimit > 20, 'a szkript sosem feszítette meg a pórázt (' + atLimit + ')');
});
