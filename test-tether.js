import { test, assert, eq, near } from './test-index.js';
import { tetherAxis, computeTether, limitRules, TETHER_EPS } from './tether-logic.js';

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

// ---- S005: határesetek ----
const DT = 1 / 60;

// Egy tengely léptetése: a két pozíciót a visszaadott sebességgel lépteti, kockánként.
function run(pa, pb, frames, Lf, vaf, vbf, ka = 0.5, kb = 0.5) {
  const out = [];
  for (let f = 0; f < frames; f++) {
    const L = Lf(f), r = ax(pa, pb, vaf(f), vbf(f), L, ka, kb, DT);
    const d0 = Math.abs(pb - pa);
    pa += r.a * DT; pb += r.b * DT;
    out.push({ f, d0, d: Math.abs(pb - pa), L, mode: r.mode, pa, pb });
  }
  return out;
}

test('tether: stretch=1 pontosan -> a szabályok érvényesek', () => {
  const h = ax(0, 200, -100, 100, 200);
  eq(h.mode, 'hold'); near(h.stretch, 1);
  const p = ax(0, 200, -100, 0, 200, 0.5, 0.5);
  eq(p.mode, 'pull-a'); near(p.a, -50);
  const f = ax(0, 200, 100, 0, 200);
  eq(f.mode, 'free'); eq(f.a, 100);
});
test('tether: korlát-tolerancia (TETHER_EPS) és a közvetlenül határ alatti állapot', () => {
  eq(ax(0, 200 - TETHER_EPS / 2, -100, 100, 200).mode, 'hold'); // eps-en belül: a korlátnál
  eq(ax(0, 200 - 1e-6, -100, 100, 200).mode, 'free');           // dt nélkül még szabad
  const r = ax(0, 200 - 1e-6, -100, 100, 200, 1, 1, DT);        // dt-vel a maradék idő a szabályé
  eq(r.mode, 'hold');
  assert(Math.abs(r.a) < 1e-3 && Math.abs(r.b) < 1e-3, 'a határ előtt alig mozoghat');
});
test('tether: mindkettő áll -> 0 sebesség, minden feszülésnél', () => {
  for (const pb of [0, 100, 200, 300]) {
    const r = ax(0, pb, 0, 0, 200, 0.5, 0.5, DT);
    near(r.a, 0); near(r.b, 0); eq(r.mode, 'free');
  }
});
test('tether: ellentétes húzás mindkét irányban és A/B-oldalon', () => {
  eq(ax(0, 200, -100, 100, 200).mode, 'hold');   // A balra, B jobbra
  eq(ax(200, 0, 100, -100, 200).mode, 'hold');   // A a jobb oldalon: A jobbra, B balra
  const r = ax(0, 200, -100, -100, 200, 0.2, 0.2); // A kifelé, B befelé, azonos sebesség
  eq(r.mode, 'free'); eq(r.a, -100); eq(r.b, -100);
  const r2 = ax(0, 200, 100, 100, 200, 0.2, 0.2);  // B kifelé, A befelé
  eq(r2.mode, 'free'); eq(r2.a, 100); eq(r2.b, 100);
  const r3 = ax(200, 0, 100, 0, 200, 0.5, 0.5);    // A a jobb oldalon húz jobbra
  eq(r3.mode, 'pull-a'); near(r3.a, 50); near(r3.b, 50);
});
test('tether: a követés határa (w = u) szabad, w < u büntetett', () => {
  eq(ax(0, 200, -100, -100, 200, 0.1, 0.1).mode, 'free');
  const r = ax(0, 200, -100, -99, 200, 0.1, 0.1); // w=99, u=100 -> 99 + 1*0.1
  near(r.a, -99.1); near(r.b, -99.1); eq(r.mode, 'pull-a');
});
test('tether: k szorzó korlátozása (NaN->1, >1->1, <0->0)', () => {
  near(ax(0, 200, -100, 0, 200, NaN, NaN).a, -100);
  near(ax(0, 200, -100, 0, 200, 5, 5).a, -100);
  near(ax(0, 200, -100, 0, 200, -3, -3).a, 0);
});
test('tether: degenerált: egymáson álló játékosok és L<=0', () => {
  eq(ax(5, 5, -1, 1, 0).mode, 'hold');   // L=0: szétlépni tilos
  eq(ax(5, 5, 1, 1, 0).mode, 'free');    // együtt mozoghatnak
  eq(ax(5, 5, 0, 0, 0).mode, 'free');
  eq(ax(0, 10, 0, 0, 0).stretch, Infinity);
  eq(ax(0, 10, -1, 1, -5).mode, 'hold'); // negatív L = 0
  const r = ax(5, 5, -100, 100, 50, 1, 1, DT); // d=0, L>0: szabad
  eq(r.mode, 'free'); eq(r.stretch, 0);
});
test('tether: átlós, mindkét tengelyen korlátnál', () => {
  const base = { a: { x: 0, y: 0 }, b: { x: 200, y: 200 }, L: 200, k: 0.5 };
  const h = computeTether({ ...base, va: { x: -100, y: -100 }, vb: { x: 100, y: 100 } });
  eq(h.mode.x, 'hold'); eq(h.mode.y, 'hold');
  near(h.a.x, 0); near(h.a.y, 0); near(h.b.x, 0); near(h.b.y, 0);
  const m = computeTether({ ...base, va: { x: -100, y: 0 }, vb: { x: 0, y: 100 } }); // x: A húz, y: B húz
  eq(m.mode.x, 'pull-a'); eq(m.mode.y, 'pull-b');
  near(m.a.x, -50); near(m.b.x, -50); near(m.a.y, 50); near(m.b.y, 50);
});
test('tether: tengelyenként eltérő L_eff', () => {
  const r = computeTether({
    a: { x: 0, y: 0 }, b: { x: 100, y: 100 }, va: { x: -50, y: -50 }, vb: { x: 50, y: 50 },
    L: { x: 100, y: 400 }, k: 0.5,
  });
  eq(r.mode.x, 'hold'); eq(r.mode.y, 'free');
  near(r.stretch.x, 1); near(r.stretch.y, 0.25);
  near(r.a.x, 0); eq(r.a.y, -50); eq(r.b.y, 50);
});
test('tether: x/y tengely-csere szimmetria (computeTether)', () => {
  const rnd = rng(11), R = s => (rnd() - 0.5) * s, sw = v => ({ x: v.y, y: v.x });
  for (let i = 0; i < 1000; i++) {
    const a = { x: R(400), y: R(400) }, b = { x: R(400), y: R(400) };
    const va = { x: R(300), y: R(300) }, vb = { x: R(300), y: R(300) };
    const L = { x: 50 + rnd() * 300, y: 50 + rnd() * 300 }, k = { a: rnd(), b: rnd() };
    const r = computeTether({ a, b, va, vb, L, k, dt: DT });
    const s = computeTether({ a: sw(a), b: sw(b), va: sw(va), vb: sw(vb), L: sw(L), k, dt: DT });
    near(s.a.x, r.a.y, 1e-9); near(s.a.y, r.a.x, 1e-9);
    near(s.b.x, r.b.y, 1e-9); near(s.b.y, r.b.x, 1e-9);
    eq(s.mode.x, r.mode.y); eq(s.mode.y, r.mode.x);
  }
});
test('tether: computeTether nem módosítja a bemenetet', () => {
  const inp = { a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, va: { x: -100, y: 5 }, vb: { x: 0, y: 0 },
    L: { x: 200, y: 100 }, k: { a: 0.5, b: 0.5 }, dt: DT };
  const before = JSON.stringify(inp);
  computeTether(inp);
  eq(JSON.stringify(inp), before);
});
test('tether: kimenet-invariánsok (dt nélkül): free -> kívánt, hold -> 0, pull -> azonos és nem gyorsabb', () => {
  const rnd = rng(99), seen = { free: 0, hold: 0, 'pull-a': 0, 'pull-b': 0 };
  const rv = () => (rnd() < 0.2 ? 0 : (rnd() - 0.5) * 300);
  for (let i = 0; i < 20000; i++) {
    const pa = (rnd() - 0.5) * 600;
    const pb = rnd() < 0.5 ? pa + (rnd() < 0.5 ? 1 : -1) * 200 : (rnd() - 0.5) * 600; // sok pont a korlátnál
    const va = rv(), vb = rv();
    const r = ax(pa, pb, va, vb, 200, rnd(), rnd());
    seen[r.mode]++;
    if (r.mode === 'free') { eq(r.a, va); eq(r.b, vb); }
    else if (r.mode === 'hold') { eq(r.a, 0); eq(r.b, 0); }
    else {
      eq(r.a, r.b);
      const pv = r.mode === 'pull-a' ? va : vb;
      assert(r.a * pv >= 0 && Math.abs(r.a) <= Math.abs(pv) + 1e-9, 'a húzónál gyorsabb #' + i);
    }
  }
  for (const m of Object.keys(seen)) assert(seen[m] > 0, 'nem fordult elő mód: ' + m);
});
test('tether: a húzó sebessége nem csökken, ha a k nő', () => {
  for (let ka = 0; ka <= 1; ka += 0.1) {
    const lo = ax(0, 200, -100, -20, 200, ka, 1), hi = ax(0, 200, -100, -20, 200, ka + 0.1, 1);
    assert(Math.abs(hi.a) >= Math.abs(lo.a) - 1e-9, 'k=' + ka);
  }
});
test('tether: tartós holtpont: mindketten kifelé -> a pár áll', () => {
  const o = run(0, 200, 60, () => 200, () => -100, () => 100);
  for (const s of o) eq(s.mode, 'hold');
  eq(o[59].pa, 0); eq(o[59].pb, 200);
});
test('tether: tartós húzás: B áll, A húz -> a pár k·v sebességgel halad, a távolság állandó', () => {
  const o = run(0, 200, 120, () => 200, () => -100, () => 0, 0.4, 0.9); // 2 mp
  for (const s of o) near(s.d, 200, 1e-6);
  near(o[119].pa, -100 * 0.4 * 120 * DT, 1e-6);
  near(o[119].pb, 200 - 100 * 0.4 * 120 * DT, 1e-6);
});
test('tether: tartós követés (B ugyanolyan gyorsan lép) -> nincs büntetés', () => {
  const o = run(0, 200, 120, () => 200, () => -100, () => -100, 0.2, 0.2);
  for (const s of o) eq(s.mode, 'free');
  near(o[119].pa, -100 * 120 * DT, 1e-9);
});
test('tether: L_eff változás: szűkül (a távolság nem nő, befelé szabad), majd tágul (újra követi)', () => {
  const out = [];
  const phase = (n, Lf, va, vb, ka) => { // a fázis a legutóbbi pozíciókról folytatódik
    const last = out[out.length - 1] || { pa: 0, pb: 300 };
    const o = run(last.pa, last.pb, n, Lf, () => va, () => vb, ka, ka);
    o.forEach(s => out.push(s));
    return o;
  };
  const p1 = phase(200, f => 400 - f, -120, 120, 0.5);  // szűkülő L, mindketten kifelé
  for (const s of p1) assert(s.d <= Math.max(s.L, s.d0) + 1e-7, `p1 túlnyúlt #${s.f}`);
  assert(p1[199].d > p1[199].L, 'az L alá szűkült: túlfeszített marad');
  const p2 = phase(100, () => 200, 60, -60, 0.5);       // mindketten befelé: szabad, szigorúan csökken
  for (const s of p2) { eq(s.mode, 'free'); assert(s.d < s.d0, 'nem csökkent #' + s.f); }
  assert(p2[99].d < 200, 'a befelé lépés újra a korlát alá vitte');
  const p3 = phase(200, f => 200 + f, -120, 120, 0.5);  // táguló L, mindketten kifelé
  for (const s of p3) assert(s.d <= Math.max(s.L, s.d0) + 1e-7, `p3 túlnyúlt #${s.f}`);
  near(p3[199].d, p3[199].L, 1e-6); // a táguló korlátot követi
});
