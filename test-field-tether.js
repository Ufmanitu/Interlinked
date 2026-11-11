// S027: a FieldSystem (Sorskő-mező) bekötése a pórázba: L_eff dinamikusan, a határnál megállás, split-view összhang, smoke.
// A bekötés ugyanaz, mint a main.js-ben: cfg.L = fieldL(field, () => tc.lNormal()); a split-view L_normal-t kap.
import { test, assert } from './test-index.js';
import { createPlayer } from './game-player.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { TetherConfig } from './tether-config.js';
import { sanitizeField, fieldL, fieldEffectiveL, fieldValue } from './game-field.js';
import { createSplitView, snapSplitView, stepSplitView } from './game-splitview.js';

const DT = 1 / 60;
const EPS = 1e-6;
const noStore = null; // TetherConfig mentés nélkül
const mkField = (o = {}) => sanitizeField({ id: 'sorsko', x: 0, y: 0, radius: 640, ...o });

function rig(ax, ay, bx, by, fieldDef = {}) {
  const tc = new TetherConfig(noStore);
  const field = mkField(fieldDef);
  const cfg = tc.systemConfig({ walls: [], field });
  cfg.L = fieldL(field, () => tc.lNormal());
  const sys = createTetherSystem(cfg);
  const players = [createPlayer(0, ax, ay), createPlayer(1, bx, by)];
  return { tc, field, sys, players, ln: tc.lNormal() };
}
const still = { x: 0, y: 0 };
const step = (r, ia, ib, n = 1) => { for (let i = 0; i < n; i++) stepTetherSystem(r.sys, r.players, [ia, ib], DT); };

test('field+tether: L_eff = L_falu, ha mindkét játékos bent van; L_normal, ha az egyik kint', () => {
  const r = rig(-100, 0, 100, 0);
  step(r, still, still);
  assert(Math.abs(r.sys.L.x - 1280) < EPS && Math.abs(r.sys.L.y - 1280) < EPS, 'bent: L_falu (átmérő)');
  r.players[1].x = 900; // B a falun kívül
  step(r, still, still);
  assert(Math.abs(r.sys.L.x - r.ln.x) < EPS && Math.abs(r.sys.L.y - r.ln.y) < EPS, 'kint: L_normal');
  r.players[0].x = 5000; r.players[1].x = 5100; // mindkettő messze kint
  step(r, still, still);
  assert(Math.abs(r.sys.L.x - r.ln.x) < EPS, 'falun kívül végig L_normal');
});

test('field+tether: a határsávban L_eff a min(f) szerint lerp-el (tengelyenként)', () => {
  const r = rig(0, 0, 0, 0);
  for (const d of [300, 400, 500, 600, 639]) {
    r.players[0].x = 0; r.players[0].y = 0; r.players[1].x = d; r.players[1].y = 0;
    step(r, still, still);
    const s = Math.min(fieldValue(r.field, r.players[0]), fieldValue(r.field, r.players[1]));
    const wantX = r.ln.x + (1280 - r.ln.x) * s, wantY = r.ln.y + (1280 - r.ln.y) * s;
    assert(Math.abs(r.sys.L.x - wantX) < 1e-6 && Math.abs(r.sys.L.y - wantY) < 1e-6, `d=${d}: L_eff ${r.sys.L.x}/${wantX}`);
  }
  // a mező-nélküli képlet ugyanazt adja (fieldEffectiveL)
  const e = fieldEffectiveL(r.field, r.players[0], r.players[1], r.ln);
  assert(Math.abs(e.x - r.sys.L.x) < 1e-6, 'fieldEffectiveL egyezik');
});

test('field+tether: kifelé húzó játékos a határnál megáll, ha a társ ellenáll (holtpont L_eff-nél)', () => {
  // A (bent) és B egymással ellentétes irányba húz: a távolság L_eff-nél holtpont; B a határsávban/azon túl áll meg.
  const r = rig(-300, 0, 0, 0);
  const A = r.players[0], B = r.players[1];
  step(r, { x: -1, y: 0 }, { x: 1, y: 0 }, 60 * 40);
  const dx = B.x - A.x;
  assert(dx <= r.sys.L.x + 1e-4, `táv ${dx} <= L_eff ${r.sys.L.x}`);
  assert(r.sys.L.x - dx < 1.5, 'a távolság ~ L_eff (a korlátnál áll): ' + (r.sys.L.x - dx));
  assert(Math.abs(A.vx) < 1e-6 && Math.abs(B.vx) < 1e-6, 'mindketten állnak (holtpont)');
  assert(r.sys.mode.x === 'hold', 'mód: hold, kapott: ' + r.sys.mode.x);
  assert(r.sys.L.x < 1280 - 1, 'a határsáv szűkítette az L_eff-et: ' + r.sys.L.x);
  // a holtpont feloldása: A B felé lép (követ), B tovább húz kifelé -> B halad
  const bx = B.x;
  step(r, { x: 1, y: 0 }, { x: 1, y: 0 }, 120);
  assert(B.x > bx + 10, 'a követő társ oldja a korlátot: ' + (B.x - bx));
});

test('field+tether: ha a társ nem ellenáll, a kifelé húzó elhúzza (a húzó lassul), de a távolság sosem lépi túl L_eff-et', () => {
  const r = rig(-300, 0, 0, 0);
  const A = r.players[0], B = r.players[1];
  let prev = Math.abs(B.x - A.x);
  for (let i = 0; i < 60 * 20; i++) {
    stepTetherSystem(r.sys, r.players, [still, { x: 1, y: 0 }], DT);
    const d = Math.abs(B.x - A.x);
    assert(d <= Math.max(r.sys.L.x, prev) + 1e-4, `táv ${d} <= max(L_eff ${r.sys.L.x}, ${prev}) @${i}`);
    prev = d;
  }
  assert(A.x > -300 + 100, 'A-t elhúzta a társ: ' + A.x);
  assert(r.sys.mode.x === 'pull-b', 'B húz: ' + r.sys.mode.x);
  assert(B.vx > 0 && B.vx < B.speed - 1e-6, 'a húzó lassabb: ' + B.vx);
});

test('field+tether: a mezőben szabad a távolság (L_falu), kint a korlát szoros; belépéskor nem rántja vissza', () => {
  const r = rig(-500, 0, 500, 0); // távolság 1000 > L_normal.x (864), de a falun belül
  const A = r.players[0], B = r.players[1];
  step(r, still, still, 10);
  assert(B.x - A.x === 1000, 'bent nem húz vissza');
  // B kilép és áll: a távolság az L_eff-nél nagyobb lehet (nincs visszahúzás, csak nem mehet kijjebb)
  B.x = 700; step(r, still, still, 5);
  const before = B.x - A.x;
  step(r, still, { x: 1, y: 0 }, 120);
  assert(B.x - A.x <= Math.max(before, r.sys.L.x) + 1e-4, 'nem tágul a korlát fölé');
  step(r, still, { x: -1, y: 0 }, 300); // vissza befelé
  assert(B.x < 700, 'visszafelé szabad');
});

test('field+tether: split-view összhang (r az L_normal-hoz mér): falun belül szétválás, kívül összeolvadás', () => {
  const r = rig(-500, 0, 500, 0);
  const lnv = r.tc.lNormal();
  const sv = createSplitView(r.players);
  snapSplitView(sv, r.players, lnv);
  assert(!sv.merge.on, 'bent, távol: szétválva (távolság 1000 > L_normal)');
  for (let i = 0; i < 90; i++) stepSplitView(sv, r.players, DT, r.tc.cameraConfig(), lnv);
  assert(sv.merge.e === 0, 'a szétválás kész');
  r.players[0].x = 4000; r.players[1].x = 4400; // falun kívül, közel
  snapSplitView(sv, r.players, lnv);
  assert(sv.merge.on, 'kint, közel: összeolvadva');
  // a pórázzal falun kívül a távolság sosem lépi túl az L_normal-t -> sosem válik szét
  const q = rig(4000, 0, 4300, 0);
  const s2 = createSplitView(q.players); snapSplitView(s2, q.players, q.tc.lNormal());
  for (let i = 0; i < 600; i++) {
    stepTetherSystem(q.sys, q.players, [{ x: 1, y: 0 }, { x: i % 200 < 100 ? 1 : -1, y: 0 }], DT);
    stepSplitView(s2, q.players, DT, q.tc.cameraConfig(), q.tc.lNormal());
    assert(s2.merge.on, 'kint végig összeolvadt: ' + i);
  }
});

test('field+tether: nincs mező -> L_normal; hibás mező nem dönt (fuzz)', () => {
  const tc = new TetherConfig(noStore);
  const cfg = tc.systemConfig({ walls: [] });
  cfg.L = fieldL(null, () => tc.lNormal());
  const sys = createTetherSystem(cfg);
  const ps = [createPlayer(0, 0, 0), createPlayer(1, 50, 0)];
  stepTetherSystem(sys, ps, [still, still], DT);
  assert(Math.abs(sys.L.x - tc.lNormal().x) < EPS, 'mező nélkül L_normal');
});

test('field+tether: smoke 900 kocka a falu határán át: nincs NaN, táv <= max(L_eff, előző táv.), mező-érték 0..1', () => {
  const r = rig(-200, 0, 150, 0);
  const A = r.players[0], B = r.players[1];
  let seed = 27;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let ia = { x: 1, y: 0 }, ib = { x: -1, y: 0 };
  let prev = { x: Math.abs(B.x - A.x), y: Math.abs(B.y - A.y) };
  for (let f = 0; f < 900; f++) {
    if (f % 45 === 0) { // időnként új irányok: ki- és bemenet a faluból
      const pick = () => ({ x: Math.round(rnd() * 2 - 1), y: Math.round(rnd() * 2 - 1) });
      ia = pick(); ib = pick();
      if (f % 180 === 0) { ia = { x: 1, y: 0.5 }; ib = { x: 1, y: -0.3 }; }
    }
    stepTetherSystem(r.sys, r.players, [ia, ib], DT);
    for (const p of r.players) {
      assert(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.vx) && Number.isFinite(p.vy), 'NaN pozíció: ' + f);
      const v = fieldValue(r.field, p);
      assert(v >= 0 && v <= 1, 'mező-érték 0..1');
    }
    const L = r.sys.L;
    assert(Number.isFinite(L.x) && Number.isFinite(L.y) && L.x >= r.ln.x - EPS && L.y >= r.ln.y - EPS && L.x <= 1280 + EPS, 'L_eff L_normal és L_falu között: ' + f);
    const d = { x: Math.abs(B.x - A.x), y: Math.abs(B.y - A.y) };
    assert(d.x <= Math.max(L.x, prev.x) + 1e-4 && d.y <= Math.max(L.y, prev.y) + 1e-4, `póráz-invariáns f=${f}: ${d.x}/${L.x}, ${d.y}/${L.y}`);
    prev = d;
  }
});
