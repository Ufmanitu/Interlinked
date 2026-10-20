import { test, assert, eq, near } from './test-index.js';
import { tetherAxis, computeTether, limitRules } from './tether-logic.js';

const ax = (pa, pb, va, vb, L, ka = 1, kb = 1, dt = 0) => tetherAxis(pa, pb, va, vb, L, ka, kb, dt);

function rng(seed) { // mulberry32
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('tether: korlát alatt szabad mozgás', () => {
  const r = ax(0, 100, -100, 100, 200);
  eq(r.a, -100); eq(r.b, 100); eq(r.mode, 'free'); near(r.stretch, 0.5);
});
test('tether: mindketten kifelé -> mindketten megállnak', () => {
  const r = ax(0, 200, -100, 100, 200);
  eq(r.a, 0); eq(r.b, 0); eq(r.mode, 'hold');
});
test('tether: A húz, B áll -> A lassul (k), B-t viszi', () => {
  const r = ax(0, 200, -100, 0, 200, 0.4, 0.9);
  near(r.a, -40); near(r.b, -40); eq(r.mode, 'pull-a');
});
test('tether: B húz, A áll -> tükörszabály, B szorzója (kb)', () => {
  const r = ax(0, 200, 0, 100, 200, 0.9, 0.4);
  near(r.a, 40); near(r.b, 40); eq(r.mode, 'pull-b');
});
test('tether: a társ követi (befelé lép) -> büntetés megszűnik', () => {
  const r = ax(0, 200, -100, -100, 200, 0.2, 0.2);
  eq(r.a, -100); eq(r.b, -100); eq(r.mode, 'free');
  const r2 = ax(0, 200, -100, -150, 200, 0.2, 0.2); // a társ gyorsabban követ
  eq(r2.a, -100); eq(r2.b, -150);
});
test('tether: részleges követés -> arányos büntetés', () => {
  const r = ax(0, 200, -100, -40, 200, 0.5, 0.5); // w=40, u=100 -> 40 + 60*0.5
  near(r.a, -70); near(r.b, -70);
});
test('tether: k=1 nincs büntetés, k=0 a húzó sem mozdul', () => {
  const r1 = ax(0, 200, -100, 0, 200, 1, 1);
  near(r1.a, -100); near(r1.b, -100);
  const r0 = ax(0, 200, -100, 0, 200, 0, 0);
  eq(r0.a, 0); eq(r0.b, 0);
});
test('tether: ha az egyik befelé lép vagy áll, szabad', () => {
  const r = ax(0, 200, 100, 0, 200); // A a társ felé lép
  eq(r.a, 100); eq(r.b, 0); eq(r.mode, 'free');
  const r2 = ax(0, 200, 100, -100, 200); // mindketten befelé
  eq(r2.a, 100); eq(r2.b, -100);
  const r3 = ax(0, 200, 0, 0, 200); // mindkettő áll a korlátnál
  eq(r3.a, 0); eq(r3.b, 0);
});
test('tether: a tengelyek függetlenek (átlós mozgás)', () => {
  const r = computeTether({
    a: { x: 0, y: 0 }, b: { x: 200, y: 10 },
    va: { x: -100, y: -100 }, vb: { x: 0, y: 0 },
    L: { x: 200, y: 200 }, k: 0.5,
  });
  near(r.a.x, -50); near(r.b.x, -50); // x: húzás, lassul
  eq(r.a.y, -100); eq(r.b.y, 0);      // y: szabad
  eq(r.mode.x, 'pull-a'); eq(r.mode.y, 'free');
});
test('tether: L és k lehet szám vagy objektum', () => {
  const base = { a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, va: { x: -100, y: 0 }, vb: { x: 0, y: 0 } };
  const r1 = computeTether({ ...base, L: 200, k: 0.5 });
  const r2 = computeTether({ ...base, L: { x: 200, y: 99 }, k: { a: 0.5, b: 0.1 } });
  near(r1.a.x, -50); near(r2.a.x, -50);
  const r3 = computeTether({ ...base, L: 200, k: { a: 0.25, b: 1 } });
  near(r3.a.x, -25);
});
test('tether: túlfeszített (L_eff csökkent) -> kifelé tilos, befelé szabad', () => {
  const r = ax(0, 250, -100, 100, 200);
  eq(r.a, 0); eq(r.b, 0);
  const r2 = ax(0, 250, 100, -100, 200);
  eq(r2.a, 100); eq(r2.b, -100);
  near(r.stretch, 1.25);
});
test('tether: dt-s lépés a korlátnál megáll (nem lépi túl L-t)', () => {
  const dt = 1 / 60;
  const r = ax(0, 199, -60, 60, 200, 0.5, 0.5, dt);
  near((199 + (r.b - r.a) * dt), 200, 1e-9);
  const r2 = ax(0, 199, -120, 0, 200, 0.5, 0.5, dt);
  assert(199 + (r2.b - r2.a) * dt <= 200 + 1e-9, 'túllépte');
  const r3 = ax(0, 100, -50, 50, 200, 0.5, 0.5, dt); // messze a korláttól: érintetlen
  eq(r3.a, -50); eq(r3.b, 50);
});
test('tether: a koordináta-tükrözés tükrözött eredményt ad (A/B csere)', () => {
  const rnd = rng(7);
  for (let i = 0; i < 2000; i++) {
    const pa = (rnd() - 0.5) * 400, pb = (rnd() - 0.5) * 400;
    const va = (rnd() - 0.5) * 300, vb = (rnd() - 0.5) * 300;
    const L = 20 + rnd() * 300, ka = rnd(), kb = rnd(), dt = rnd() < 0.5 ? 0 : 1 / 60;
    const r = ax(pa, pb, va, vb, L, ka, kb, dt);
    const m = ax(-pb, -pa, -vb, -va, L, kb, ka, dt);
    near(m.a, -r.b, 1e-9, 'a#' + i); near(m.b, -r.a, 1e-9, 'b#' + i);
  }
});
test('tether: fuzz — véges kimenet, a korlátnál a távolság nem nő, dt-vel nem lépi túl L-t', () => {
  const rnd = rng(42);
  for (let i = 0; i < 20000; i++) {
    const pa = (rnd() - 0.5) * 600, pb = (rnd() - 0.5) * 600;
    const va = rnd() < 0.2 ? 0 : (rnd() - 0.5) * 300, vb = rnd() < 0.2 ? 0 : (rnd() - 0.5) * 300;
    const L = 10 + rnd() * 400, ka = rnd(), kb = rnd(), dt = 1 / 60;
    const r = ax(pa, pb, va, vb, L, ka, kb, dt);
    assert(Number.isFinite(r.a) && Number.isFinite(r.b), 'NaN #' + i);
    const d0 = Math.abs(pb - pa), d1 = Math.abs(pb - pa + (r.b - r.a) * dt);
    assert(d1 <= Math.max(L, d0) + 1e-7, `túlnyúlt #${i}: ${d1} > max(${L}, ${d0})`);
    const vmax = Math.abs(va) + Math.abs(vb) + 1e-9;
    assert(Math.abs(r.a) <= vmax && Math.abs(r.b) <= vmax, 'gyorsult #' + i);
  }
});
test('tether: limitRules sosem gyorsít a kívánt sebességnél a húzón', () => {
  for (const dir of [-1, 1]) {
    const r = limitRules(dir, -dir * 100, 0, 0.3, 0.3); // A húz
    assert(Math.abs(r.a) <= 100 && r.a === r.b, 'szabály');
  }
});
