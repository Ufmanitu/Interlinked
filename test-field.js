import { test, assert } from './test-index.js';
import { FIELD_CONFIG, lerp, toL, sanitizeField, setFieldRadius, fieldValue, fieldShare, fieldEffectiveL, fieldL } from './game-field.js';

const close = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const LN = { x: 864, y: 444 };
const mk = (o = {}) => sanitizeField({ id: 'sorsko', x: 1000, y: 500, radius: 600, ...o });
const P = (dx, dy = 0, f = mk()) => ({ x: f.x + dx, y: f.y + dy });

test('field: létrehozás, alapértékek, hibás definíció', () => {
  const f = mk();
  assert(f && f.band === 256 && f.inner === 344 && f.radius === 600, 'sáv 8 tile = 256 px');
  assert(f.L.x === 1200 && f.L.y === 1200 && f.autoL, 'alap L_falu = átmérő');
  assert(FIELD_CONFIG.bandTiles === 8 && FIELD_CONFIG.tile === 32);
  for (const bad of [null, undefined, 5, 'x', {}, { x: 1, y: 1 }, { x: 1, y: 1, radius: 0 }, { x: 1, y: 1, radius: -3 }, { x: NaN, y: 1, radius: 5 }, { x: 1, y: Infinity, radius: 5 }, { x: 1, y: 1, radius: 1e12 }]) {
    assert(sanitizeField(bad) === null, 'hibás -> null');
  }
  const g = mk({ L: { x: 700, y: 500 }, band: 64 });
  assert(g.L.x === 700 && g.L.y === 500 && !g.autoL && g.band === 64 && g.inner === 536);
  assert(mk({ L: -4 }).autoL && mk({ L: NaN }).autoL, 'hibás L -> alap');
  assert(mk({ band: -5 }).band === 256, 'hibás sáv -> alap');
});

test('field: f(p) belül 1, kívül 0, sávban lineáris', () => {
  const f = mk();
  assert(fieldValue(f, P(0, 0)) === 1);
  assert(fieldValue(f, P(344)) === 1, 'a sáv kezdete = 1');
  assert(fieldValue(f, P(600)) === 0, 'a határ = 0');
  assert(fieldValue(f, P(5000)) === 0);
  assert(close(fieldValue(f, P(344 + 128)), 0.5), 'sáv fele = 0,5');
  assert(close(fieldValue(f, P(344 + 64)), 0.75));
  assert(close(fieldValue(f, P(0, 472)), 0.5), 'y irányban ugyanaz (kör)');
  const d = 472 / Math.SQRT2;
  assert(close(fieldValue(f, P(d, d)), 0.5, 1e-9), 'átlósan is kör alakú');
});

test('field: f monoton, folytonos, szimmetrikus', () => {
  const f = mk();
  let prev = 2, maxStep = 0, last = null;
  for (let d = 0; d <= 800; d += 0.5) {
    const v = fieldValue(f, P(d));
    assert(v >= 0 && v <= 1 && v <= prev + 1e-12, 'nem növekvő, 0..1');
    if (last !== null) maxStep = Math.max(maxStep, Math.abs(v - last));
    prev = v; last = v;
  }
  assert(maxStep <= 0.5 / 256 + 1e-9, 'folytonos: lépésenként <= 0,5/sáv');
  for (const a of [0, 0.7, 1.9, 3.3, 5]) {
    assert(close(fieldValue(f, P(450 * Math.cos(a), 450 * Math.sin(a))), fieldValue(f, P(450))), 'körszimmetria');
  }
});

test('field: sáv = 0 (éles határ) és sáv > sugár (szorítás)', () => {
  const h = mk({ band: 0 });
  assert(h.inner === 600 && fieldValue(h, P(600)) === 1 && fieldValue(h, P(600.01)) === 0);
  const w = mk({ band: 99999 });
  assert(w.band === 600 && w.inner === 0);
  assert(fieldValue(w, P(0)) === 1 && close(fieldValue(w, P(300)), 0.5) && fieldValue(w, P(600)) === 0);
});

test('field: hibás pont -> f = 0, nincs kivétel', () => {
  const f = mk();
  for (const p of [null, undefined, {}, { x: NaN, y: 0 }, { x: 0, y: Infinity }, 'a', 7, { x: '1', y: 2 }]) {
    assert(fieldValue(f, p) === 0, 'hibás pont');
  }
  assert(fieldValue(null, { x: 0, y: 0 }) === 0 && fieldValue(undefined, P(0)) === 0);
});

test('field: s = min(f(A), f(B))', () => {
  const f = mk();
  assert(fieldShare(f, P(0), P(100)) === 1, 'mindkettő bent');
  assert(fieldShare(f, P(0), P(700)) === 0, 'az egyik kívül');
  assert(close(fieldShare(f, P(0), P(344 + 128)), 0.5), 'az egyik a sáv felén');
  assert(close(fieldShare(f, P(344 + 64), P(344 + 192)), 0.25), 'a kisebb számít');
  assert(fieldShare(f, P(0), P(344 + 128)) === fieldShare(f, P(344 + 128), P(0)), 'A/B csere');
  assert(fieldShare(f, P(0), null) === 0, 'hibás társ -> 0');
});

test('field: L_eff = lerp(L_normal, L_falu, s) tengelyenként', () => {
  const f = mk({ L: { x: 1200, y: 800 } });
  let L = fieldEffectiveL(f, P(0), P(10), LN);
  assert(L.x === 1200 && L.y === 800, 'bent: L_falu');
  L = fieldEffectiveL(f, P(0), P(900), LN);
  assert(L.x === 864 && L.y === 444, 'kint: L_normal');
  L = fieldEffectiveL(f, P(0), P(344 + 128), LN);
  assert(close(L.x, 864 + (1200 - 864) * 0.5) && close(L.y, 444 + (800 - 444) * 0.5), 'félúton');
  assert(close(lerp(10, 20, 0.25), 12.5));
  L = fieldEffectiveL(f, P(0), P(344 + 128), 700);
  assert(close(L.x, 950) && close(L.y, 750), 'skalár L_normal');
});

test('field: L_normal bemenetek (szám, {x,y}, függvény, hibás)', () => {
  assert(toL(5).x === 5 && toL(5).y === 5);
  assert(toL({ x: 3, y: 4 }).y === 4);
  assert(toL(() => ({ x: 7, y: 8 })).x === 7);
  assert(toL(() => { throw new Error('x'); }) === null);
  for (const bad of [0, -1, NaN, null, undefined, {}, { x: 1 }, { x: 0, y: 1 }, 'a']) assert(toL(bad) === null, 'hibás L');
  const f = mk();
  assert(fieldEffectiveL(f, P(0), P(0), NaN) === null && fieldEffectiveL(f, P(0), P(0), null) === null);
  const L = fieldEffectiveL(null, P(0), P(0), LN);
  assert(L.x === 864 && L.y === 444, 'nincs mező -> L_normal');
  const out = fieldEffectiveL(f, P(0), P(900), LN);
  out.x = 1; assert(LN.x === 864, 'a bemenet érintetlen');
});

test('field: fieldL a cfg.L formátumában (players -> {x,y})', () => {
  const f = mk();
  const fn = fieldL(f, () => LN);
  const A = P(0), B = P(344 + 128);
  const L = fn([A, B]);
  assert(close(L.x, lerp(864, 1200, 0.5)) && close(L.y, lerp(444, 1200, 0.5)));
  const far = fn([A, P(5000)]);
  assert(far.x === 864 && far.y === 444);
  assert(fn(null).x === 864 && fn([]).y === 444 && fn([A]).x === 864, 'hibás players -> L_normal');
  assert(fieldL(f, NaN)([A, B]) === null, 'hibás L_normal -> null (a hívó dönt)');
  const live = { v: LN };
  const g = fieldL(f, () => live.v);
  assert(g([A, P(5000)]).x === 864); live.v = { x: 500, y: 300 };
  assert(g([A, P(5000)]).x === 500, 'élő L_normal követése');
});

test('field: setFieldRadius (fejlesztés)', () => {
  const f = mk();
  assert(setFieldRadius(f, 800) && f.radius === 800 && f.inner === 544 && f.L.x === 1600, 'automatikus L követ');
  const g = mk({ L: { x: 900, y: 900 } });
  assert(setFieldRadius(g, 800) && g.L.x === 900, 'megadott L marad');
  assert(!setFieldRadius(f, 0) && !setFieldRadius(f, NaN) && !setFieldRadius(null, 5) && f.radius === 800);
  assert(setFieldRadius(f, 100) && f.band === 100 && f.inner === 0, 'kis sugár: sáv szorul');
  assert(fieldValue(f, P(0, 0, f)) === 1);
});

test('field: fuzz, L_eff mindig a két L között, nincs NaN', () => {
  let s = 12026;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 3000; i++) {
    const r = 50 + rnd() * 2000, band = rnd() < 0.2 ? 0 : rnd() * 600;
    const f = sanitizeField({ x: rnd() * 1e4 - 5e3, y: rnd() * 1e4 - 5e3, radius: r, band, L: rnd() < 0.5 ? undefined : { x: 100 + rnd() * 3000, y: 100 + rnd() * 3000 } });
    const ln = { x: 100 + rnd() * 2000, y: 100 + rnd() * 2000 };
    const A = { x: f.x + (rnd() - 0.5) * 6000, y: f.y + (rnd() - 0.5) * 6000 };
    const B = { x: f.x + (rnd() - 0.5) * 6000, y: f.y + (rnd() - 0.5) * 6000 };
    const L = fieldEffectiveL(f, A, B, ln);
    const s2 = fieldShare(f, A, B);
    assert(s2 >= 0 && s2 <= 1 && Number.isFinite(L.x) && Number.isFinite(L.y), 'véges');
    assert(L.x >= Math.min(ln.x, f.L.x) - 1e-9 && L.x <= Math.max(ln.x, f.L.x) + 1e-9, 'x a két L között');
    assert(L.y >= Math.min(ln.y, f.L.y) - 1e-9 && L.y <= Math.max(ln.y, f.L.y) + 1e-9, 'y a két L között');
    const L2 = fieldEffectiveL(f, B, A, ln);
    assert(L2.x === L.x && L2.y === L.y, 'A/B szimmetria');
  }
});

test('field: sétáló pár: L_eff folytonos, kint L_normal, bent L_falu', () => {
  const f = mk();
  let prev = null, maxJump = 0;
  for (let i = 0; i <= 2400; i++) {
    const x = f.x - 700 + i * 0.5;
    const L = fieldEffectiveL(f, { x, y: f.y }, { x: x + 40, y: f.y }, LN);
    if (prev) maxJump = Math.max(maxJump, Math.abs(L.x - prev.x));
    prev = L;
    if (i === 0) assert(L.x === 864, 'kint');
    if (Math.abs(x - f.x) < 100) assert(L.x === 1200, 'bent');
  }
  assert(maxJump < 2, 'nincs ugrás az átmenetnél: ' + maxJump);
});
