// S028: a Sorskő objektum: logika (szintek, sugár, ütköző, gyűrű), rajz (mátrix, sprite, gyűrű) és a main.js-szerű lánc.
import { test, assert } from './test-index.js';
import { sanitizeField, fieldL, fieldValue } from './game-field.js';
import { SORSKO_CONFIG, createSorsko, sorskoMaxLevel, setSorskoLevel, upgradeSorsko, sorskoState, restoreSorsko, sorskoFoot, sorskoCollider, ringStrength, ringAlpha, stepSorsko } from './game-sorsko.js';
import { CRYSTAL_ID, CRYSTAL_W, CRYSTAL_H, CRYSTAL_PALETTE, crystalRows, crystalDef, createSorskoSprites, visibleSorsko, drawSorsko, ringVisible, drawSorskoRing } from './render-sorsko.js';
import { compileSprite } from './world-sprite.js';
import { getSprite } from './render-sprite.js';
import { footY, sortByY } from './world-objects.js';
import { collides } from './game-collision.js';
import { createPlayer } from './game-player.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { TetherConfig } from './tether-config.js';

const DT = 1 / 60;
const mk = (o = {}) => {
  const f = sanitizeField({ id: 'sorsko', x: 1000, y: 500, radius: SORSKO_CONFIG.levels[0] });
  return { f, s: createSorsko(f, o) };
};
const at = (s, d, ang = 0) => ({ x: s.field.x + Math.cos(ang) * d, y: s.field.y + Math.sin(ang) * d });
const makeCanvas = (w, h) => ({ width: w, height: h, getContext: () => null });

// hamis ctx: minden hívást számol, a gradiens/szaggatás opcionális
function fakeCtx({ gradient = true, dash = true } = {}) {
  const c = { calls: {}, depth: 0, maxDepth: 0, arcs: [], images: [] };
  const rec = (n) => (...a) => { c.calls[n] = (c.calls[n] || 0) + 1; if (n === 'arc') c.arcs.push(a); if (n === 'drawImage') c.images.push(a); };
  for (const n of ['beginPath', 'stroke', 'fillRect', 'drawImage', 'arc']) c[n] = rec(n);
  c.save = () => { c.depth++; c.maxDepth = Math.max(c.maxDepth, c.depth); };
  c.restore = () => { c.depth--; };
  if (gradient) c.createRadialGradient = () => ({ addColorStop() {} });
  if (dash) c.setLineDash = () => {};
  return c;
}

test('sorskő: adat, szintek, létrehozás', () => {
  const L = SORSKO_CONFIG.levels;
  assert(L.length >= 3 && L[0] === 640, 'a 0. szint az S027 falu-sugara');
  for (let i = 1; i < L.length; i++) assert(L[i] > L[i - 1], 'a sugár szintenként nő');
  const { f, s } = mk();
  assert(s && s.level === 0 && s.t === 0 && f.radius === 640 && sorskoMaxLevel(s) === L.length - 1);
  assert(createSorsko(null) === null && createSorsko({}) === null && createSorsko({ x: 1, y: 1, radius: NaN }) === null);
  assert(createSorsko(f, { level: 99 }) === null && createSorsko(f, { level: 1.5 }) === null, 'hibás szint -> null');
  const g = mk({ level: 2 });
  assert(g.s.level === 2 && g.f.radius === L[2], 'induló szint -> sugár');
});

test('sorskő: szint beállítása, a mező sugara és L_falu követi', () => {
  const { f, s } = mk();
  assert(setSorskoLevel(s, 3) && f.radius === SORSKO_CONFIG.levels[3] && s.level === 3);
  assert(f.L.x === 2 * f.radius && f.L.y === 2 * f.radius, 'az automatikus L_falu = új átmérő');
  assert(f.inner === f.radius - f.band, 'a belső sugár frissül');
  for (const bad of [-1, 1.5, 99, NaN, Infinity, '2', null, undefined, {}]) {
    assert(setSorskoLevel(s, bad) === false && s.level === 3 && f.radius === SORSKO_CONFIG.levels[3], 'hibás szint érintetlen: ' + String(bad));
  }
  assert(setSorskoLevel(null, 1) === false);
  assert(setSorskoLevel(s, 0) && f.radius === 640, 'vissza is lehet');
});

test('sorskő: fejlesztés a legmagasabb szintig', () => {
  const { s } = mk();
  let n = 0;
  while (upgradeSorsko(s)) { n++; assert(n < 50); }
  assert(n === sorskoMaxLevel(s) && s.level === sorskoMaxLevel(s));
  assert(upgradeSorsko(s) === false && upgradeSorsko(null) === false);
});

test('sorskő: mentés-állapot oda-vissza, hibás állapot érintetlen', () => {
  const a = mk(), b = mk();
  setSorskoLevel(a.s, 2);
  const st = JSON.parse(JSON.stringify(sorskoState(a.s)));
  assert(restoreSorsko(b.s, st) && b.s.level === 2 && b.f.radius === a.f.radius, 'azonos állapot');
  for (const bad of [null, undefined, 5, 'x', {}, { v: 2, level: 1 }, { v: 1 }, { v: 1, level: 'a' }, { v: 1, level: 99 }, { v: 1, level: -1 }]) {
    assert(restoreSorsko(b.s, bad) === false && b.s.level === 2, 'hibás -> érintetlen');
  }
  assert(restoreSorsko(null, st) === false);
});

test('sorskő: lábpont és ütköző talp (középen, a lábpont fölött, nem fedi a kezdő-játékosokat)', () => {
  const { f, s } = mk();
  const ft = sorskoFoot(s), c = sorskoCollider(s);
  assert(ft.x === f.x && ft.y === f.y + SORSKO_CONFIG.footDy);
  assert(c.w === 40 && c.h === 20 && c.x + c.w / 2 === ft.x && c.y + c.h === ft.y, 'középen, a lábpont a talp alja');
  for (const dx of [-70, 70]) {
    const p = { x: f.x + dx, y: f.y, w: 24, h: 24 };
    assert(!collides(p, [c]), 'a kezdőhely (±70 px) szabad');
  }
  assert(collides({ x: ft.x, y: ft.y - 10, w: 24, h: 24 }, [c]), 'a talp ütközik');
});

test('sorskő: gyűrű-erősség a határtól mért távolságból (bent és kint szimmetrikus, simított, monoton)', () => {
  const { f, s } = mk();
  const R = f.radius, range = s.cfg.ringRange;
  assert(ringStrength(s, [at(s, 0), at(s, 10)]) === 0, 'középen nincs gyűrű');
  assert(ringStrength(s, [at(s, R - range - 1)]) === 0 && ringStrength(s, [at(s, R + range + 1)]) === 0, 'távol nincs gyűrű');
  assert(Math.abs(ringStrength(s, [at(s, R)]) - 1) < 1e-12, 'a határon 1');
  for (const e of [10, 50, 100, 180]) {
    assert(Math.abs(ringStrength(s, [at(s, R - e)]) - ringStrength(s, [at(s, R + e)])) < 1e-12, 'bent = kint');
  }
  let prev = 0;
  for (let e = range; e >= 0; e -= 8) {
    const v = ringStrength(s, [at(s, R - e)]);
    assert(v >= prev - 1e-12 && v >= 0 && v <= 1, 'közeledve nem csökken');
    prev = v;
  }
  assert(ringStrength(s, [at(s, 0), at(s, R)]) === 1, 'a legközelebbi játékos számít');
  assert(ringStrength(s, [null, { x: NaN, y: 1 }, undefined]) === 0 && ringStrength(s, null) === 0 && ringStrength(null, []) === 0, 'hibás játékos -> 0');
});

test('sorskő: gyűrű-alfa (0 erősségnél 0, <= ringMax, lüktet, monoton az erősséggel)', () => {
  const { s } = mk();
  const M = s.cfg.ringMax;
  assert(ringAlpha(s, 0, 0.7) === 0 && ringAlpha(s, -1) === 0 && ringAlpha(s, NaN) === 0 && ringAlpha(null, 1) === 0);
  let lo = Infinity, hi = 0;
  for (let t = 0; t < 6; t += 0.05) {
    const a = ringAlpha(s, 1, t);
    assert(a > 0 && a <= M + 1e-12, 'a <= ringMax');
    lo = Math.min(lo, a); hi = Math.max(hi, a);
  }
  assert(hi - lo > 0.05 * M, 'lüktet');
  assert(Math.abs(hi - M) < 1e-3, 'a csúcs a ringMax');
  for (let st = 0.1; st <= 1; st += 0.1) assert(ringAlpha(s, st, 0) >= ringAlpha(s, st - 0.1, 0) - 1e-12, 'monoton');
  assert(ringAlpha(s, 0.5, 0) < ringAlpha(s, 1, 0) - 0.01, 'az erősség skálázza az alfát');
  assert(ringAlpha(s, 5, 0) <= M, 'túl nagy erősség levágva');
  assert(ringAlpha(s, 1, NaN) <= M && ringAlpha(s, 1, NaN) > 0, 'hibás t nem dob');
});

test('sorskő: stepSorsko az órát lépteti, hibás dt kimarad', () => {
  const { s } = mk();
  stepSorsko(s, 0.5); stepSorsko(s, DT);
  assert(Math.abs(s.t - (0.5 + DT)) < 1e-12);
  for (const bad of [NaN, -1, 0, Infinity, '1', null, undefined]) stepSorsko(s, bad);
  assert(Math.abs(s.t - (0.5 + DT)) < 1e-12 && s.t < 1e9);
  stepSorsko(null, 1); // nem dob
});

test('sorskő rajz: a kristály-mátrix érvényes, sprite-ként lefordul', () => {
  const rows = crystalRows();
  assert(rows.length === CRYSTAL_H && rows.every((r) => r.length === CRYSTAL_W), 'azonos hosszú sorok');
  const used = new Set(rows.join(''));
  for (const ch of used) assert(ch === '.' || ch in CRYSTAL_PALETTE, 'ismeretlen jel: ' + ch);
  for (const k of ['o', 'd', 'm', 'l', 'h', 'g', 's', 't']) assert(used.has(k), 'hiányzó jel: ' + k);
  const solid = rows.join('').split('').filter((c) => c !== '.').length;
  assert(solid > 500 && solid < CRYSTAL_W * CRYSTAL_H * 0.8, 'ésszerű kitöltés: ' + solid);
  assert(rows[0].replace(/\./g, '').length >= 1 && rows[0].replace(/\./g, '').length <= 2, 'hegyes csúcs');
  assert(rows[CRYSTAL_H - 1].includes('s') === false || rows[CRYSTAL_H - 1].replace(/\./g, '').length < 20, 'a talp nem lóg ki');
  const r = compileSprite(crystalDef());
  assert(r.ok && r.sprite.w === CRYSTAL_W && r.sprite.h === CRYSTAL_H && r.errors.length === 0, 'compileSprite ok: ' + r.errors.join(';'));
  assert(r.sprite.ax === 20 && r.sprite.ay === 60);
  const d = crystalRows(24, 40);
  assert(d.length === 40 && d.every((x) => x.length === 24), 'más méret is érvényes');
});

test('sorskő rajz: sprite-készlet, y-sort elem, láthatóság', () => {
  const { s } = mk();
  const sp = createSorskoSprites(makeCanvas);
  const e = getSprite(sp, CRYSTAL_ID);
  assert(!e.missing && e.w === CRYSTAL_W && e.h === CRYSTAL_H, 'valódi sprite, nem placeholder');
  const ft = sorskoFoot(s);
  const v = visibleSorsko(s, ft.x - 200, ft.y - 200, 400, 400, []);
  assert(v.length === 1 && v[0].sorsko === s && v[0].x === ft.x && v[0].y === ft.y && v[0].w === 0 && v[0].h === 0);
  assert(footY(v[0]) === ft.y, 'a y-sort a lábpont szerint rendez');
  const pAbove = { x: ft.x, y: ft.y - 40, w: 24, h: 24, index: 0 }, pBelow = { x: ft.x, y: ft.y + 40, w: 24, h: 24, index: 1 };
  const list = [pBelow, v[0], pAbove];
  sortByY(list);
  assert(list[0] === pAbove && list[1] === v[0] && list[2] === pBelow, 'a kristály a lejjebb lévő játékost nem takarja, a fentit igen');
  assert(visibleSorsko(s, ft.x + 5000, ft.y, 400, 400, []).length === 0 && visibleSorsko(s, ft.x - 5000, ft.y - 5000, 400, 400, []).length === 0, 'messze nem látszik');
  assert(visibleSorsko(null, 0, 0, 10, 10, []).length === 0);
  const out = [{ x: 1 }];
  visibleSorsko(s, ft.x - 10, ft.y - 10, 20, 20, out);
  assert(out.length === 2 && out[0].x === 1, 'az out-ot nem ürítjük');
});

test('sorskő rajz: drawSorsko (sprite a lábpontra, gradiens nélkül is) és drawSorskoRing', () => {
  const { f, s } = mk();
  const sp = createSorskoSprites(makeCanvas);
  const ft = sorskoFoot(s);
  const c = fakeCtx();
  assert(drawSorsko(c, sp, s, ft.x - 100, ft.y - 100) === true, 'valódi sprite');
  assert(c.images.length === 1 && c.images[0][1] === 100 - 20 && c.images[0][2] === 100 - 60, 'a lábpont (ax,ay) a (100,100)-ra kerül');
  const c2 = fakeCtx({ gradient: false, dash: false });
  assert(drawSorsko(c2, sp, s, 0, 0) === true && c2.images.length === 1, 'gradiens nélkül is');
  // gyűrű
  const view = { ox: f.x - 480, oy: f.y - 270, w: 960, h: 540 };
  const r0 = fakeCtx();
  assert(drawSorskoRing(r0, s, 0, view.ox, view.oy, view.w, view.h) === false && !r0.calls.arc, 'alpha 0 -> nincs rajz');
  const r1 = fakeCtx();
  assert(drawSorskoRing(r1, s, 0.4, f.x - 480 + 400, f.y - 270, 960, 540) === true, 'a határ a nézetben: rajzol');
  assert(r1.arcs.length === 2 && r1.arcs[0][2] === f.radius && r1.arcs[1][2] === f.inner, 'két kör: határ és belső sáv');
  assert(r1.depth === 0 && r1.maxDepth === 1, 'save/restore kiegyensúlyozott');
  const r2 = fakeCtx({ dash: false });
  assert(drawSorskoRing(r2, s, 0.4, f.x + 400, f.y - 100, 100, 100) === true || r2.calls.arc === undefined, 'setLineDash nélkül nem dob');
  const r3 = fakeCtx();
  assert(drawSorskoRing(r3, s, 0.5, f.x - 100, f.y - 100, 200, 200) === false, 'a nézet teljesen a határ belsejében: nincs gyűrű');
  assert(drawSorskoRing(fakeCtx(), s, 0.5, f.x + 3000, f.y, 200, 200) === false, 'messze kint: nincs gyűrű');
  assert(!ringVisible(s, f.x - 100, f.y - 100, 200, 200) && ringVisible(s, f.x + f.radius - 50, f.y - 50, 100, 100));
});

test('sorskő smoke: 600 kocka a main.js-szerű láncban (mező + ütköző + gyűrű), szintváltás menet közben', () => {
  const tc = new TetherConfig(null);
  const f = sanitizeField({ id: 'sorsko', x: 0, y: 0, radius: SORSKO_CONFIG.levels[0] });
  const s = createSorsko(f);
  const walls = [sorskoCollider(s)];
  const cfg = tc.systemConfig({ walls, field: f });
  cfg.L = fieldL(f, () => tc.lNormal());
  const sys = createTetherSystem(cfg);
  const ps = [createPlayer(0, -70, 20), createPlayer(1, 70, 20)];
  let sawGap = false;
  for (let i = 0; i < 600; i++) {
    if (i === 300) assert(setSorskoLevel(s, 2), 'szintváltás');
    // P1 a kristály felé, majd a határ felé; P2 követi
    const phase = i < 150 ? 0 : 1;
    const ia = phase === 0 ? { x: 1, y: -0.2 } : { x: 0.6, y: 0.8 };
    const ib = phase === 0 ? { x: -1, y: -0.2 } : { x: 0.6, y: 0.8 };
    stepTetherSystem(sys, ps, [ia, ib], DT);
    stepSorsko(s, DT);
    const k = ringStrength(s, ps), a = ringAlpha(s, k);
    assert(k >= 0 && k <= 1 && a >= 0 && a <= s.cfg.ringMax + 1e-12, 'erősség/alfa tartományban');
    for (const p of ps) {
      assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'nincs NaN');
      assert(!collides(p, walls), 'a játékos nem megy a kristályba (kocka ' + i + ')');
    }
    assert(Number.isFinite(sys.L.x) && sys.L.x >= tc.lNormal().x - 1e-6 && sys.L.x <= 2 * f.radius + 1e-6, 'L_eff L_normal..L_falu közt');
    if (k > 0 && k < 1) sawGap = true;
  }
  assert(f.radius === SORSKO_CONFIG.levels[2] && Math.abs(f.L.x - 2 * f.radius) < 1e-9, 'a szintváltás után a mező nagyobb');
  assert(fieldValue(f, ps[0]) >= 0 && sawGap, 'a gyűrű fokozatosan erősödött');
});
