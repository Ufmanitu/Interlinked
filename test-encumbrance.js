// S034 tesztek: teher a pórázban (inventory-súly -> p.load a k-hookba, túlterhelés -> p.speedMul a saját sebességbe).
import { test, assert, eq, near } from './test-index.js';
import { createPlayer, desiredVelocity } from './game-player.js';
import { createItemRegistry } from './data-items.js';
import { createInventory, createPlayerInventories, addItem, removeItem, inventoryState, restoreInventory } from './game-inventory.js';
import { createTetherSystem, stepTetherSystem, K_HOOK } from './tether-system.js';
import { mulberry32 } from './world-noise.js';
import {
  ENCUMBRANCE_CONFIG, sanitizeEncumbrance, loadFromKg, capacityOf, overloadOf, speedMulOf, encumbranceOf, syncEncumbrance,
} from './game-encumbrance.js';

const C = ENCUMBRANCE_CONFIG;
const REG = createItemRegistry();
const DT = 1 / 60;
const EPS = 1e-6;
const stuff = (v, id, n) => { eq(addItem(v, id, n), 0, 'befért ' + id); return v; };
const heavy = v => { for (let i = 0; i < 24; i++) addItem(v, 'stone', 99); return v; }; // 7128 kg

test('encumbrance: alap-konfig, hibás konfig tisztítása', () => {
  assert(Object.isFrozen(C), 'befagyasztott');
  assert(C.kgPerBody > 0 && C.capacityKg >= 0 && C.overKg > 0 && C.minSpeedMul > 0 && C.minSpeedMul <= 1 && C.minStrength > 0, 'alap érvényes');
  const bad = sanitizeEncumbrance({ kgPerBody: 0, capacityKg: -5, overKg: NaN, minSpeedMul: 2, minStrength: 'x' });
  eq(bad.kgPerBody, C.kgPerBody); eq(bad.capacityKg, 0); eq(bad.overKg, C.overKg); eq(bad.minSpeedMul, C.minSpeedMul); eq(bad.minStrength, C.minStrength);
  const ok = sanitizeEncumbrance({ capacityKg: 10, minSpeedMul: 0.5 });
  eq(ok.capacityKg, 10); eq(ok.minSpeedMul, 0.5); eq(ok.kgPerBody, C.kgPerBody);
  eq(sanitizeEncumbrance({ minSpeedMul: 0 }).minSpeedMul, C.minSpeedMul, 'a 0 minimum beragadna');
  for (const b of [undefined, null, 'x', 5]) eq(sanitizeEncumbrance(b).capacityKg, C.capacityKg);
  for (const cfg of [null, 'x', { overKg: 0 }]) assert(Number.isFinite(speedMulOf(100, 40, cfg)), 'hibás konfiggal sem dob');
});

test('encumbrance: kg -> p.load (test-egység)', () => {
  near(loadFromKg(0), 0); near(loadFromKg(C.kgPerBody), 1); near(loadFromKg(C.kgPerBody / 2), 0.5);
  for (const b of [-1, NaN, Infinity, -Infinity, '5', null, undefined]) eq(loadFromKg(b), 0, 'hibás kg: ' + String(b));
  near(loadFromKg(140, { kgPerBody: 140 }), 1);
});

test('encumbrance: kapacitás az erővel nő, hibás erő nem ront', () => {
  near(capacityOf({}), C.capacityKg); near(capacityOf({ strength: 1 }), C.capacityKg);
  near(capacityOf({ strength: 2 }), 2 * C.capacityKg); near(capacityOf({ strength: 0.5 }), C.capacityKg / 2);
  const floor = C.capacityKg * C.minStrength;
  near(capacityOf({ strength: 0 }), floor); near(capacityOf({ strength: -3 }), floor);
  near(capacityOf({ strength: NaN }), C.capacityKg); near(capacityOf(null), C.capacityKg); near(capacityOf(undefined), C.capacityKg);
});

test('encumbrance: túlterhelés és lassulás (kapacitásig nincs, fölötte lineáris, alul korlátos)', () => {
  const cap = 40;
  eq(overloadOf(0, cap), 0); eq(overloadOf(cap, cap), 0); eq(speedMulOf(cap, cap), 1);
  near(overloadOf(cap + C.overKg / 2, cap), 0.5);
  near(speedMulOf(cap + C.overKg / 2, cap), 1 - (1 - C.minSpeedMul) / 2);
  near(speedMulOf(cap + C.overKg, cap), C.minSpeedMul); near(speedMulOf(1e9, cap), C.minSpeedMul);
  near(speedMulOf(cap + 1, cap), 1 - (1 - C.minSpeedMul) / C.overKg, 1e-9, 'egy kg a kapacitás fölött');
  let prev = 2;
  for (let kg = 0; kg <= 400; kg += 5) {
    const m = speedMulOf(kg, cap);
    assert(m <= prev + 1e-12, 'monoton csökken ' + kg); assert(m >= C.minSpeedMul - 1e-12 && m <= 1, 'tartomány ' + kg);
    prev = m;
  }
  for (const b of [NaN, -5, undefined, 'x', Infinity]) eq(speedMulOf(b, cap), 1, 'hibás kg nem lassít: ' + String(b));
  near(overloadOf(10, NaN), 10 / C.overKg); near(overloadOf(10, -5), 10 / C.overKg); // hibás kapacitás = 0
  near(speedMulOf(20, 10, { capacityKg: 99, overKg: 20, minSpeedMul: 0.5 }), 0.75); // a megadott kapacitás számít, nem a konfigé
  const e = encumbranceOf(100, { strength: 1 });
  near(e.kg, 100); near(e.capacity, C.capacityKg); near(e.load, 100 / C.kgPerBody); eq(e.overload, 1); near(e.speedMul, C.minSpeedMul);
});

test('encumbrance: syncEncumbrance – játékosonként a saját inventoryból, az inventory érintetlen', () => {
  const P = [createPlayer(0, 0, 0), createPlayer(1, 100, 0)];
  const I = createPlayerInventories(REG, 2);
  stuff(I[0], 'wood', 10); stuff(I[1], 'stone', 20); // 20 kg, 60 kg
  const snap = () => JSON.stringify(I.map(inventoryState));
  const before = snap();
  const r = syncEncumbrance(P, I);
  eq(r.length, 2);
  near(P[0].carryKg, 20); near(P[0].load, 20 / C.kgPerBody); eq(P[0].speedMul, 1); eq(P[0].overload, 0);
  near(P[1].carryKg, 60); near(P[1].load, 60 / C.kgPerBody); near(P[1].capacityKg, C.capacityKg);
  near(P[1].overload, (60 - C.capacityKg) / C.overKg); near(P[1].speedMul, 1 - (1 - C.minSpeedMul) * P[1].overload);
  eq(snap(), before, 'az inventory változatlan');
  P[1].strength = 2; syncEncumbrance(P, I);
  eq(P[1].overload, 0); eq(P[1].speedMul, 1); near(P[1].capacityKg, 2 * C.capacityKg);
  removeItem(I[1], 'stone', 20); syncEncumbrance(P, I);
  eq(P[1].load, 0); eq(P[1].carryKg, 0);
  syncEncumbrance(P, null); eq(P[0].load, 0); eq(P[0].speedMul, 1);
  syncEncumbrance(P, [null, {}]); eq(P[1].load, 0); eq(P[1].speedMul, 1);
  eq(syncEncumbrance(null, I).length, 0);
  stuff(I[1], 'wood', 5);
  const r2 = syncEncumbrance([null, P[1]], I);
  eq(r2[0], null); assert(r2[1] !== null && r2[1].kg === 10, 'a hibás játékos kimarad, a többi a saját indexű inventoryját kapja');
});

test('encumbrance: desiredVelocity a p.speedMul-lal (hibás -> 1, negatív -> 0)', () => {
  const p = createPlayer(0, 0, 0);
  eq(desiredVelocity(p, { x: 1, y: 0 }).x, p.speed);
  p.speedMul = 0.5;
  const v = desiredVelocity(p, { x: 1, y: -1 });
  near(v.x, p.speed / 2); near(v.y, -p.speed / 2);
  p.speedMul = NaN; eq(desiredVelocity(p, { x: 1, y: 0 }).x, p.speed);
  p.speedMul = undefined; eq(desiredVelocity(p, { x: 1, y: 0 }).x, p.speed);
  p.speedMul = -1; eq(desiredVelocity(p, { x: 1, y: 0 }).x, 0);
});

// A: bal oldalt húz kifelé (x -1), B áll és jobbra van; stretch = 1 -> A húz. 60 kocka = 1 mp.
function pull(kgA, kgB) {
  const P = [createPlayer(0, 500, 300), createPlayer(1, 700, 300)];
  const I = createPlayerInventories(REG, 2);
  if (kgA) stuff(I[0], 'wood', kgA / 2);
  if (kgB) stuff(I[1], 'wood', kgB / 2);
  const sys = createTetherSystem({ L: { x: 200, y: 200 }, k: 0.5 });
  for (let f = 0; f < 60; f++) { syncEncumbrance(P, I); stepTetherSystem(sys, P, [{ x: -1, y: 0 }, { x: 0, y: 0 }], DT); }
  return { dx: 500 - P[0].x, k: sys.k.a, dB: P[1].x - 700 };
}

test('encumbrance: a megrakott társat nehezebb húzni (a teher a k-ba megy)', () => {
  const base = pull(0, 0);
  near(base.k, 0.5, 1e-9); near(base.dx, 60, 1.5, 'üres inventoryk: alap húzás');
  const heavyB = pull(0, C.kgPerBody); // a társ terhe = 1 test-egység -> a súly-szorzó 1/2
  near(heavyB.k, 0.25, 1e-9); near(heavyB.dx, base.dx / 2, 1.5);
  near(heavyB.dB, base.dB / 2, 1.5, 'a megrakott társat a húzó kevesebbet viszi magával'); // dB < 0: a társ a húzó felé mozdul el
  const mid = pull(0, 20);
  assert(mid.k < base.k && mid.k > heavyB.k, 'a k a teherrel folyamatosan csökken: ' + mid.k);
  const loadedPuller = pull(20, 0); // a húzó saját terhe (kapacitáson belül) nem ront a húzáson
  near(loadedPuller.k, base.k, 1e-9); near(loadedPuller.dx, base.dx, 1.5);
});

test('encumbrance: a túlterhelt húzó lassabb (saját sebesség), a k nem változik', () => {
  const base = pull(0, 0), over = pull(C.capacityKg + C.overKg, 0); // teljes lassulás
  near(over.k, base.k, 1e-9);
  near(over.dx, base.dx * C.minSpeedMul, 1.5);
});

test('encumbrance: szabad mozgás (stretch < 1) – a túlterhelt játékos lassabb, a társ nem', () => {
  const run = kg => {
    const P = [createPlayer(0, 500, 300), createPlayer(1, 600, 300)];
    const I = createPlayerInventories(REG, 2);
    if (kg) stuff(I[0], 'wood', kg / 2);
    const sys = createTetherSystem({ L: { x: 2000, y: 2000 }, k: 0.5 });
    for (let f = 0; f < 60; f++) { syncEncumbrance(P, I); stepTetherSystem(sys, P, [{ x: -1, y: 0 }, { x: 1, y: 0 }], DT); }
    return { a: 500 - P[0].x, b: P[1].x - 600 };
  };
  const free = run(0), over = run(100);
  near(free.a, 120, 1.5); near(over.a, 120 * C.minSpeedMul, 1.5); near(over.b, free.b, 1e-9);
});

test('encumbrance: extrém teher sem okoz holtpontot vagy NaN-t', () => {
  const P = [createPlayer(0, 500, 300), createPlayer(1, 700, 300)];
  const I = createPlayerInventories(REG, 2);
  heavy(I[0]); heavy(I[1]);
  const sys = createTetherSystem({ L: { x: 200, y: 200 }, k: 0.5 });
  for (let f = 0; f < 300; f++) {
    syncEncumbrance(P, I);
    stepTetherSystem(sys, P, [{ x: -1, y: 0 }, { x: 0, y: 0 }], DT);
    for (const p of P) assert(Number.isFinite(p.x) && Number.isFinite(p.load) && p.speedMul >= C.minSpeedMul, `NaN/lassulás a ${f}. kockában`);
    assert(sys.k.a > 0 && sys.k.a <= 1 && sys.k.b > 0 && sys.k.b <= 1, 'k tartomány: ' + sys.k.a);
  }
  near(P[0].speedMul, C.minSpeedMul);
  // 5 mp: saját sebesség · minSpeedMul · bázis k · a súly-szorzó alsó határa (a társ terhe a k-hook szerint a minimumra szorít)
  near(500 - P[0].x, P[0].speed * C.minSpeedMul * 0.5 * K_HOOK.weightMin * 5, 1.5, 'a húzó a minimális tempóval így is halad');
});

test('encumbrance: mentés-betöltés után ugyanaz a teher', () => {
  const I = createPlayerInventories(REG, 2);
  stuff(I[0], 'wood', 33); stuff(I[0], 'stone', 15); stuff(I[1], 'torch', 20);
  const mk = () => [createPlayer(0, 0, 0), createPlayer(1, 0, 0)];
  const read = P => JSON.stringify(P.map(p => [p.load, p.speedMul, p.carryKg, p.capacityKg, p.overload]));
  const P = mk(); syncEncumbrance(P, I);
  const J = createPlayerInventories(REG, 2);
  I.forEach((v, i) => assert(restoreInventory(J[i], inventoryState(v)), 'visszatöltés ' + i));
  const Q = mk(); syncEncumbrance(Q, J);
  eq(read(Q), read(P)); assert(P[0].overload > 0, 'a példa tényleg túlterhelt');
});

test('encumbrance: 600 kockás fuzz – véletlen inventory-műveletek + póráz, invariánsok', () => {
  const rnd = mulberry32(34034), ids = ['wood', 'stone', 'fiber', 'herb', 'torch', 'shard'];
  const P = [createPlayer(0, 400, 300), createPlayer(1, 520, 300)];
  const I = [createInventory(REG, 8), createInventory(REG, 8)];
  const L = { x: 300, y: 220 };
  const sys = createTetherSystem({ L, k: 0.5 });
  let sawOver = false, sawFree = false, start = P[0].x;
  for (let f = 0; f < 600; f++) {
    if (f % 5 === 0) {
      const v = I[rnd() < 0.5 ? 0 : 1], id = ids[Math.floor(rnd() * ids.length)], n = 1 + Math.floor(rnd() * 25);
      if (rnd() < 0.55) addItem(v, id, n); else removeItem(v, id, n);
    }
    syncEncumbrance(P, I);
    const prevX = Math.abs(P[0].x - P[1].x), prevY = Math.abs(P[0].y - P[1].y);
    const inp = i => ({ x: Math.sin(f / (40 + 13 * i)) > -0.3 ? 1 : -1, y: Math.cos(f / (60 + 19 * i)) > 0 ? 1 : -1 });
    stepTetherSystem(sys, P, [inp(0), inp(1)], DT);
    for (const p of P) {
      assert(Number.isFinite(p.x) && Number.isFinite(p.y), `NaN pozíció a ${f}. kockában`);
      assert(Number.isFinite(p.load) && p.load >= 0, `p.load a ${f}. kockában: ${p.load}`);
      assert(p.speedMul >= C.minSpeedMul - EPS && p.speedMul <= 1 + EPS, `speedMul a ${f}. kockában: ${p.speedMul}`);
      if (p.overload > 0) sawOver = true; else sawFree = true;
    }
    for (const k of [sys.k.a, sys.k.b]) assert(k >= 0 && k <= 1, `k a ${f}. kockában: ${k}`);
    assert(Math.abs(P[0].x - P[1].x) <= Math.max(L.x, prevX) + EPS, `táv. x > L_eff a ${f}. kockában`);
    assert(Math.abs(P[0].y - P[1].y) <= Math.max(L.y, prevY) + EPS, `táv. y > L_eff a ${f}. kockában`);
  }
  assert(sawOver && sawFree, 'a fuzz túlterhelt és terheletlen állapotot is érintett');
  assert(Math.abs(P[0].x - start) > 20, 'a játékosok mozogtak');
});
