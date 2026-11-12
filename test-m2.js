// S031: M2 playteszt (dual-kamera + Sorskő-mező) automata megfelelője. Checklist (8 pont):
// 1 osztás (szétválva két nézet, mindkét játékos látszik, a nézetek kitöltik a vásznat)
// 2 összeolvadás (egy közös kép, varratmentes egész pixeles sarkok)
// 3 hiszterézis (szétválás > 1,0·L, összeolvadás <= 0,85·L, a sávban nincs villogás)
// 4 határsáv: L_eff folytonos, monoton L_falu -> L_normal
// 5 határsáv: a pár a határsávon át sem lépi túl L_eff-et, kint összeolvadt kép
// 6 sarkok: HUD a két alsó sarokban mindkét képállapotban, a vásznon belül
// 7 Sorskő: a határ-gyűrű a közeledéssel erősödik, korlátos
// 8 FPS/stabilitás: 1800 kocka véletlen bemenettel, nincs NaN, a látható chunkok mindig betöltöttek, korlátos logika-idő
import { test, assert, eq, near } from './test-index.js';
import { createPlayer } from './game-player.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { TetherConfig } from './tether-config.js';
import { sanitizeField, fieldL, fieldValue, fieldShare, fieldEffectiveL } from './game-field.js';
import { createSplitView, snapSplitView, stepSplitView, splitOffsets, splitLayout, viewContains, mergeBlend, mergeDecide, SPLIT_CONFIG } from './game-splitview.js';
import { createSorsko, ringStrength, ringAlpha, SORSKO_CONFIG } from './game-sorsko.js';
import { HUD_CONFIG, hudLayout, createMenus, stepMenus, missingViewChunks } from './game-hud.js';
import { drawHud } from './render-hud.js';
import { WORLD_SEED, createWorldStream, warmStream, updateStream } from './world-stream.js';

const DT = 1 / 60;
const VW = 960, VH = 540;
const still = { x: 0, y: 0 };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ugyanaz a bekötés, mint a main.js-ben (fieldL, tight = falun kívül, split L_normal-t kap)
function rig(ax, ay, bx, by) {
  const tc = new TetherConfig(null);
  const field = sanitizeField({ id: 'sorsko', x: 0, y: 0, radius: SORSKO_CONFIG.levels[0] });
  const cfg = tc.systemConfig({ walls: [], field });
  cfg.L = fieldL(field, () => tc.lNormal());
  const sys = createTetherSystem(cfg);
  const players = [createPlayer(0, ax, ay), createPlayer(1, bx, by)];
  const split = createSplitView(players, undefined, tc.lNormal());
  snapSplitView(split, players, tc.lNormal());
  const r = { tc, field, sys, players, split, ln: tc.lNormal(), flips: 0, bad: 0 };
  r.step = (ia, ib, n = 1) => {
    for (let i = 0; i < n; i++) {
      stepTetherSystem(sys, players, [ia, ib], DT);
      const before = split.merge.on;
      stepSplitView(split, players, DT, tc.cameraConfig(), tc.lNormal(), fieldShare(field, players[0], players[1]) <= 0);
      if (split.merge.on !== before) r.flips++;
      if (!players.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) r.bad++;
    }
  };
  r.dist = () => ({ x: Math.abs(players[1].x - players[0].x), y: Math.abs(players[1].y - players[0].y) });
  return r;
}
const rnd = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

test('M2 osztás: szétválva két nézet, mindkét játékos látszik, a nézetek+osztóvonal kitöltik a vásznat', () => {
  const r = rig(-500, 0, 500, 0); // a határsávban, Δx = 1000 > L_normal.x (864)
  r.step(still, still, 90);
  eq(r.split.merge.on, false, 'szétválva');
  near(mergeBlend(r.split), 0, 1e-6, 'e = 0');
  const o = splitOffsets(r.split);
  for (let i = 0; i < 2; i++) {
    const owner = r.split.order === 0 ? i : 1 - i;
    assert(viewContains(r.split, owner, r.players[i], 0, o), `a ${i}. játékos látszik a saját nézetében`);
  }
  const L = splitLayout();
  const [v0, v1] = L.views;
  eq(v0.x, 0); eq(v0.y, 0); eq(v0.h, VH); eq(v1.h, VH);
  eq(v0.w + v1.w, VW, 'a két nézet pontosan kitölti a vásznat'); eq(v1.x, v0.x + v0.w, 'nincs rés a nézetek között');
  assert(L.divider.x <= v1.x && L.divider.x + L.divider.w >= v1.x, 'az osztóvonal a varratot fedi');
});

test('M2 összeolvadás: közel egy közös kép, a nézetek egész pixeles, varratmentes sarkokkal', () => {
  const r = rig(-60, 0, 60, 0);
  r.step(still, still, 60);
  eq(r.split.merge.on, true, 'összeolvadva');
  near(mergeBlend(r.split), 1, 1e-3, 'e = 1');
  const o = splitOffsets(r.split);
  for (const p of o) assert(Number.isInteger(p.x) && Number.isInteger(p.y), 'egész pixeles sarok');
  const L = splitLayout();
  eq(o[1].x - o[0].x, L.views[1].x - L.views[0].x, 'a két fél pontosan egymás mellé kerül (nincs 1 px-es varrat)');
  eq(o[1].y, o[0].y, 'azonos magasság');
  for (let i = 0; i < 2; i++) {
    const owner = r.split.order === 0 ? i : 1 - i;
    assert(viewContains(r.split, owner, r.players[i], 0, o) || viewContains(r.split, 1 - owner, r.players[i], 0, o), 'a játékos a képben');
  }
});

test('M2 hiszterézis: a döntés 0,85/1,0 küszöbnél vált, a sávban marad; fel-le söprés: pontosan 2 váltás', () => {
  const c = SPLIT_CONFIG;
  let on = true, flips = 0;
  for (let r = 0.5; r <= 1.3; r += 0.001) { const n = mergeDecide(on, r, c); if (n !== on) { flips++; assert(r > c.splitAt, 'szétválás csak 1,0 felett: ' + r); } on = n; }
  eq(on, false);
  for (let r = 1.3; r >= 0.5; r -= 0.001) { const n = mergeDecide(on, r, c); if (n !== on) { flips++; assert(r <= c.mergeAt + 1e-9, 'összeolvadás csak 0,85 alatt: ' + r); } on = n; }
  eq(on, true); eq(flips, 2, 'egy kör = 2 váltás');
  // a sávban állandó távolság mellett (0,92) nincs váltás, a zajjal sem
  const rg = rnd(7); let s = true, f2 = 0;
  for (let i = 0; i < 2000; i++) { const n = mergeDecide(s, 0.92 + (rg() - 0.5) * 0.01, c); if (n !== s) f2++; s = n; }
  eq(f2, 0, 'a sávban nem villog');
});

test('M2 határsáv: L_eff folytonos és monoton csökken a mező közepétől kifelé (L_falu -> L_normal)', () => {
  const r = rig(0, 0, 0, 0);
  const f = r.field;
  let prev = null, maxStep = 0;
  for (let x = 0; x <= f.radius + 200; x += 1) {
    const p = { x, y: 0 };
    const L = fieldEffectiveL(f, p, p, r.ln);
    assert(L && Number.isFinite(L.x) && Number.isFinite(L.y), 'véges L_eff');
    if (prev) {
      assert(L.x <= prev.x + 1e-9 && L.y <= prev.y + 1e-9, 'nem nő kifelé: x=' + x);
      maxStep = Math.max(maxStep, prev.x - L.x);
    }
    prev = L;
  }
  const inner = fieldEffectiveL(f, { x: 0, y: 0 }, { x: 0, y: 0 }, r.ln);
  near(inner.x, f.L.x, 1e-6, 'bent L_falu'); near(prev.x, r.ln.x, 1e-6, 'kint L_normal'); near(prev.y, r.ln.y, 1e-6);
  const slope = (f.L.x - r.ln.x) / f.band;
  assert(maxStep <= slope + 1e-6, 'nincs ugrás (lépés <= meredekség): ' + maxStep + ' vs ' + slope);
  // a "legrosszabb" játékos dönt: az egyik kint -> L_normal
  const mixed = fieldEffectiveL(f, { x: 0, y: 0 }, { x: f.radius + 50, y: 0 }, r.ln);
  near(mixed.x, r.ln.x, 1e-6, 'az egyik kint: L_normal');
});

test('M2 határsáv + póráz: kifelé húzva a távolság nem lépi túl L_eff-et, kint egy képbe olvad, nincs NaN', () => {
  const r = rig(450, 0, -250, 0);
  let maxOver = 0, sawSplit = false;
  for (let f = 0; f < 900; f++) {
    r.step({ x: 1, y: 0 }, still); // A kifelé húz, B áll
    const L = fieldEffectiveL(r.field, r.players[0], r.players[1], r.ln);
    maxOver = Math.max(maxOver, r.dist().x - L.x, r.dist().y - L.y);
    if (!r.split.merge.on) sawSplit = true;
  }
  eq(r.bad, 0, 'NaN pozíció');
  assert(maxOver <= 2, 'a táv. legfeljebb 2 px-szel lépheti túl a (változó) L_eff-et: ' + maxOver);
  assert(sawSplit, 'a faluban volt szétválás');
  // kint nyugalomban egy kép
  r.players[0].x = 900; r.players[1].x = 900 + 200; r.step(still, still, 90);
  eq(fieldShare(r.field, r.players[0], r.players[1]), 0, 'mindketten kint');
  eq(r.split.merge.on, true, 'kint összeolvadt');
  assert(r.flips <= 6, 'kevés váltás (nem villog): ' + r.flips);
});

test('M2 sarkok: a HUD mindkét képállapotban a két alsó sarokban, a vásznon belül; a nyitott menü is', () => {
  const ctx = (() => {
    const c = { fills: [], depth: 0, bad: 0, fillStyle: '', font: '' };
    c.save = () => { c.depth++; }; c.restore = () => { c.depth--; if (c.depth < 0) c.bad++; };
    c.fillRect = (x, y, w, h) => c.fills.push({ x, y, w, h }); c.fillText = () => {};
    return c;
  })();
  for (const [ax, bx] of [[-500, 500], [-60, 60]]) { // szétválva, összeolvadva
    const r = rig(ax, 0, bx, 0); r.step(still, still, 60);
    const ms = createMenus();
    stepMenus(ms, [{ menuPressed: true }, { menuPressed: true }]);
    ctx.fills.length = 0;
    eq(drawHud(ctx, r.players, ms, VW, VH), 4, 'két HUD-panel + két nyitott menü-panel');
    eq(ctx.depth, 0); eq(ctx.bad, 0);
    assert(ctx.fills.every(f => f.x >= 0 && f.y >= 0 && f.x + f.w <= VW && f.y + f.h <= VH), 'minden rajz a vásznon belül');
    const a = hudLayout(0, VW, VH), b = hudLayout(1, VW, VH);
    eq(a.x, HUD_CONFIG.margin); eq(b.x + b.w, VW - HUD_CONFIG.margin); eq(a.y + a.h, VH - HUD_CONFIG.margin);
    const L = splitLayout();
    assert(a.x + a.w < L.divider.x && b.x > L.divider.x + L.divider.w, 'az osztóvonalat nem fedi');
  }
});

test('M2 Sorskő: a gyűrű a határhoz közeledve (bentről és kintről) erősödik, a határon max, alfa korlátos', () => {
  const field = sanitizeField({ id: 'sorsko', x: 0, y: 0, radius: SORSKO_CONFIG.levels[0] });
  const s = createSorsko(field);
  const R = field.radius, range = s.cfg.ringRange;
  const at = x => ringStrength(s, [{ x, y: 0 }, { x, y: 0 }]);
  eq(at(0), 0, 'a közepén nincs gyűrű'); eq(at(R + range + 10), 0, 'messze kint nincs gyűrű');
  let prev = -1;
  for (let x = R - range - 10; x <= R; x += 2) { const v = at(x); assert(v >= prev - 1e-9, 'bentről monoton nő: ' + x); prev = v; }
  near(at(R), 1, 1e-9, 'a határon max');
  prev = 2;
  for (let x = R; x <= R + range + 10; x += 2) { const v = at(x); assert(v <= prev + 1e-9, 'kintről monoton csökken: ' + x); prev = v; }
  for (let t = 0; t < 10; t += 0.05) {
    const a = ringAlpha(s, 1, t);
    assert(a >= 0 && a <= s.cfg.ringMax + 1e-9, 'alfa korlátos: ' + a);
  }
  eq(ringAlpha(s, 0, 1), 0, '0 erősségnél 0');
  assert(ringStrength(s, [{ x: NaN, y: 0 }, null]) === 0, 'hibás játékos nem dob');
});

test('M2 FPS/stabilitás: 1800 kocka véletlen bemenettel (mező + dual-kamera + streaming + HUD), nincs NaN, látható chunk mindig betöltött', () => {
  const rg = rnd(31);
  const dir = () => { const v = rg(); return v < 0.2 ? -1 : v < 0.4 ? 1 : 0; };
  const r = rig(-150, 0, 150, 0);
  const ws = createWorldStream(WORLD_SEED);
  warmStream(ws, r.players);
  const layout = splitLayout();
  const ms = createMenus();
  const ctx = { fillStyle: '', font: '', save() {}, restore() {}, fillRect() {}, fillText() {} };
  let ia = still, ib = still, worst = 0, sum = 0, miss = 0, maxChunks = 0, maxOver = 0;
  const N = 1800;
  for (let f = 0; f < N; f++) {
    if (f % 40 === 0) { ia = { x: dir(), y: dir() }; ib = { x: dir(), y: dir() }; }
    const t0 = now();
    const inputs = stepMenus(ms, [ia, ib]);
    r.step(inputs[0], inputs[1]);
    updateStream(ws, r.players);
    miss += missingViewChunks(ws, splitOffsets(r.split), layout);
    drawHud(ctx, r.players, ms, VW, VH);
    const dt = now() - t0; worst = Math.max(worst, dt); sum += dt;
    maxChunks = Math.max(maxChunks, ws.chunks.size);
    const L = fieldEffectiveL(r.field, r.players[0], r.players[1], r.ln);
    maxOver = Math.max(maxOver, r.dist().x - L.x, r.dist().y - L.y);
  }
  eq(r.bad, 0, 'NaN pozíció');
  eq(miss, 0, 'hiányzó látható chunk');
  assert(maxChunks <= 40, 'korlátos chunk-készlet: ' + maxChunks);
  assert(maxOver <= 2, 'póráz-távolság <= L_eff (+2 px): ' + maxOver);
  assert(sum / N < 8, 'átlag logika-idő/kocka (ms): ' + (sum / N).toFixed(2));
  assert(r.flips < N / 10, 'a váltások száma korlátos: ' + r.flips);
});
