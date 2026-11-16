// test-grounditems.js (S039) – földre dobott tárgyak: konfig, dobás/stack-bontás, mágnes-felvétel, tele inventory, dobó-zár, eltűnés, összevonás, falak, eldobás a menüből,
// mentés-alak, figyelők, rajz, valódi láncú smoke (összeg-tartás + determinizmus). Tiszta logika, Node-ban fut.
import { test, assert, eq } from './test-index.js';
import {
  GROUND_DEFAULTS, sanitizeGroundConfig, createGroundItems, onGround, dropItem, stepGround, groundCount, visibleGround, groundState, restoreGround, stepDropInput,
} from './game-grounditems.js';
import { createPlayerInventories, countItem, addItem, inventoryState } from './game-inventory.js';
import { createMenus, stepMenus } from './game-hud.js';
import { createInvUi, stepInvUi } from './game-invui.js';
import { createPlayer } from './game-player.js';
import { drawGroundItems } from './render-objects.js';
import { createWorldStream, warmStream, streamWalls } from './world-stream.js';
import { mulberry32 } from './world-noise.js';

const DT = 1 / 60;
const BAD_N = [0, -1, 1.5, NaN, Infinity, '3', null, undefined, {}, 2 ** 60];
const BAD_XY = [NaN, Infinity, -Infinity, '5', null, undefined, 1e9];
const players = (ax = 0, ay = 0, bx = 500, by = 0) => [createPlayer(0, ax, ay), createPlayer(1, bx, by)];
const total = (gs, id) => gs.items.filter(i => i.item === id).reduce((a, i) => a + i.n, 0);
const run = (gs, ps, invs, secs, walls) => { for (let k = 0; k < Math.round(secs / DT); k++) stepGround(gs, ps, invs, DT, walls); };
const still = { delay: 0 };

test('ground: konfig – alap, szorítás, hibás mező, pickupRadius <= magnetRadius, befagyasztott', () => {
  const d = sanitizeGroundConfig();
  for (const k of Object.keys(GROUND_DEFAULTS)) eq(d[k], GROUND_DEFAULTS[k], k);
  assert(Object.isFrozen(d) && Object.isFrozen(GROUND_DEFAULTS));
  const c = sanitizeGroundConfig({ ttl: 1, magnetRadius: 20, pickupRadius: 50, maxItems: 5.9, friction: 'x', size: NaN, blinkAt: 1e9 });
  eq(c.ttl, 5); eq(c.pickupRadius, 20); eq(c.maxItems, 5); eq(c.friction, GROUND_DEFAULTS.friction); eq(c.size, GROUND_DEFAULTS.size); eq(c.blinkAt, 600);
  for (const bad of [null, 5, 'x', [], undefined]) eq(sanitizeGroundConfig(bad).ttl, GROUND_DEFAULTS.ttl);
});

test('ground: dropItem – stack-bontás, hibás bemenet nem módosít, a visszatérés a nem lerakott rész', () => {
  const gs = createGroundItems();
  eq(dropItem(gs, 'wood', 250, 10, 20), 0);
  eq(gs.items.map(i => i.n).join(), '99,99,52'); eq(gs.stats.dropped, 250);
  assert(new Set(gs.items.map(i => i.id)).size === 3, 'egyedi id');
  const before = JSON.stringify(gs.items);
  for (const n of BAD_N) eq(dropItem(gs, 'wood', n, 0, 0), Number.isSafeInteger(n) && n > 0 ? n : 0, 'n=' + String(n));
  for (const v of BAD_XY) { eq(dropItem(gs, 'wood', 3, v, 0), 3); eq(dropItem(gs, 'wood', 3, 0, v), 3); }
  eq(dropItem(gs, 'nincs_ilyen', 4, 0, 0), 4); eq(dropItem(gs, 7, 4, 0, 0), 4);
  eq(dropItem(null, 'wood', 4, 0, 0), 4); eq(dropItem({}, 'wood', 4, 0, 0), 4);
  eq(JSON.stringify(gs.items), before, 'semmi nem változott');
  const sh = createGroundItems(); dropItem(sh, 'shard', 3, 0, 0); eq(sh.items.length, 3, 'stack 1 -> három külön');
});

test('ground: dobás (toss) – elmozdul, lassul, megáll; nem toss: nyugvó; a szórás determinisztikus', () => {
  const gs = createGroundItems(); dropItem(gs, 'stone', 1, 0, 0, { toss: true, angle: 0 });
  const it = gs.items[0]; assert(it.vx > 0 && it.vy === 0);
  let prev = it.vx, moved = 0;
  for (let k = 0; k < 300; k++) { stepGround(gs, players(900, 900, 900, 900), createPlayerInventories(), DT); assert(it.vx <= prev + 1e-9); prev = it.vx; if (it.vx === 0) { moved = it.x; break; } }
  assert(moved > 5 && moved < 150, 'megállt, mozgott: ' + moved); eq(it.vx, 0);
  const a = createGroundItems(), b = createGroundItems();
  for (const g of [a, b]) for (let k = 0; k < 5; k++) dropItem(g, 'wood', 1, 0, 0, { toss: true });
  eq(JSON.stringify(a.items), JSON.stringify(b.items));
  assert(new Set(a.items.map(i => Math.round(i.vx))).size > 1, 'szétszóródnak');
  const n = createGroundItems(); dropItem(n, 'wood', 1, 3, 4); eq(n.items[0].vx, 0); eq(n.items[0].vy, 0);
});

test('ground: falak – a dobott tárgy nekiütközve megáll, falban induló nem dob, nincs átcsúszás', () => {
  const gs = createGroundItems({ cfg: { friction: 0.5, stopSpeed: 1 } });
  const wall = [{ x: 40, y: -100, w: 20, h: 200 }];
  dropItem(gs, 'stone', 1, 0, 0, { toss: true, angle: 0 });
  run(gs, players(900, 900, 900, 900), createPlayerInventories(), 6, wall);
  const it = gs.items[0]; assert(it.x <= 40 - gs.cfg.size / 2 + 1e-6, 'a fal előtt áll: ' + it.x); eq(it.vx, 0);
  const g2 = createGroundItems(); dropItem(g2, 'stone', 1, 50, 0, { toss: true, angle: 0 });
  run(g2, players(900, 900, 900, 900), createPlayerInventories(), 2, wall); assert(Number.isFinite(g2.items[0].x));
  const g3 = createGroundItems(); dropItem(g3, 'stone', 1, 0, 0, { toss: true, angle: Math.PI / 2 });
  run(g3, players(900, 900, 900, 900), createPlayerInventories(), 2, [{ x: -50, y: 30, w: 100, h: 10 }]); assert(g3.items[0].y <= 30 - 5 + 1e-6);
});

test('ground: mágnes – a késleltetés után a közeli játékos magához húzza és felveszi; a távoli nem; összeg-tartás', () => {
  const gs = createGroundItems(), invs = createPlayerInventories(), ps = players(0, 0, 900, 0);
  dropItem(gs, 'wood', 5, 50, 0); eq(gs.items[0].delay, GROUND_DEFAULTS.pickDelay);
  run(gs, ps, invs, 0.3); eq(gs.items[0].x, 50, 'késleltetés alatt nem mozdul'); eq(countItem(invs[0], 'wood'), 0);
  const ev = []; for (let k = 0; k < 120 && groundCount(gs); k++) ev.push(...stepGround(gs, ps, invs, DT));
  eq(groundCount(gs), 0); eq(countItem(invs[0], 'wood'), 5); eq(countItem(invs[1], 'wood'), 0);
  const pk = ev.filter(e => e.type === 'pickup'); eq(pk.length, 1); eq(pk[0].n, 5); eq(pk[0].left, 0); eq(pk[0].player, 0); eq(gs.stats.picked, 5);
  const far = createGroundItems(); dropItem(far, 'wood', 5, 200, 0, still); run(far, ps, invs, 3); eq(far.items[0].x, 200, 'a körön kívül nem mozdul');
  const tt = createGroundItems(); dropItem(tt, 'wood', 1, 30, 0, { toss: true, angle: 0, delay: 0 }); stepGround(tt, ps, invs, DT); eq(tt.items[0].vx, 0, 'a mágnes leállítja a dobás-sebességet'); assert(tt.items[0].mv > 0);
  const near = createGroundItems(); dropItem(near, 'wood', 2, 450, 0, still); run(near, players(0, 0, 500, 0), createPlayerInventories(), 1); eq(groundCount(near), 0, 'a közelebbi (P2) veszi fel');
});

test('ground: tele inventory – nem vész el semmi, részleges felvétel, a hely felszabadulásakor felvétel', () => {
  const gs = createGroundItems(), invs = createPlayerInventories(null, 2, 1), ps = players(0, 0, 900, 0);
  addItem(invs[0], 'wood', 90); // 9 hely maradt a stackben
  dropItem(gs, 'wood', 20, 20, 0, still);
  run(gs, ps, invs, 2);
  eq(countItem(invs[0], 'wood'), 99); eq(total(gs, 'wood'), 11, 'a maradék a földön marad'); eq(gs.items[0].mv, 0);
  const x = gs.items[0].x; run(gs, ps, invs, 2); eq(gs.items[0].x, x, 'tele: nem húz');
  invs[0].slots[0].n = 50; run(gs, ps, invs, 2); eq(countItem(invs[0], 'wood'), 61); eq(groundCount(gs), 0);
  const full = createPlayerInventories(null, 2, 1); addItem(full[0], 'stone', 99);
  const g2 = createGroundItems(); dropItem(g2, 'wood', 3, 40, 0, still); run(g2, ps, full, 1); eq(groundCount(g2), 1, 'más tárgyra nincs hely'); eq(total(g2, 'wood'), 3); eq(g2.items[0].x, 40, 'nem húzódik'); eq(g2.items[0].mv, 0);
});

test('ground: dobó-zár – a dobó addig nem veszi fel, amíg ki nem lép a körből; a társ azonnal; kilépés után visszaveheti', () => {
  const gs = createGroundItems(), invs = createPlayerInventories(), ps = players(0, 0, 900, 0);
  dropItem(gs, 'herb', 4, 10, 0, { owner: 0, delay: 0 });
  run(gs, ps, invs, 3); eq(countItem(invs[0], 'herb'), 0); eq(groundCount(gs), 1, 'a dobó nem veszi vissza');
  ps[0].x = 200; run(gs, ps, invs, 0.1); eq(gs.items[0].noPick, -1, 'kilépett: a zár oldva');
  ps[0].x = 10; run(gs, ps, invs, 1); eq(countItem(invs[0], 'herb'), 4);
  const g2 = createGroundItems(), i2 = createPlayerInventories(), p2 = players(0, 0, 40, 0);
  dropItem(g2, 'herb', 4, 10, 0, { owner: 0, delay: 0 }); run(g2, p2, i2, 1); eq(countItem(i2[1], 'herb'), 4, 'a társ felveszi'); eq(countItem(i2[0], 'herb'), 0);
  const g3 = createGroundItems(), i3 = createPlayerInventories(), p3 = players(0, 0, 900, 0);
  dropItem(g3, 'herb', 1, 10, 0, { owner: 1, delay: 0 }); run(g3, p3, i3, 1); eq(countItem(i3[0], 'herb'), 1, 'P2 dobta: P1 felveszi');
});

test('ground: eltűnés – ttl, egyedi ttl, villogási ablak, esemény + statisztika, a felvett nem tűnik el', () => {
  const gs = createGroundItems({ cfg: { ttl: 10 } }), ps = players(900, 900, 900, 900), invs = createPlayerInventories();
  dropItem(gs, 'wood', 3, 0, 0); dropItem(gs, 'stone', 2, 100, 0, { ttl: 5 });
  const ev = []; for (let k = 0; k < 61 * 5; k++) ev.push(...stepGround(gs, ps, invs, DT));
  eq(groundCount(gs), 1); eq(gs.items[0].item, 'wood');
  const d = ev.filter(e => e.type === 'despawn'); eq(d.length, 1); eq(d[0].reason, 'ttl'); eq(d[0].n, 2); eq(gs.stats.despawned, 2);
  run(gs, ps, invs, 6); eq(groundCount(gs), 0); eq(gs.stats.despawned, 5);
  const cap = createGroundItems({ cfg: { maxItems: 3 } });
  for (let k = 0; k < 5; k++) dropItem(cap, 'shard', 1, k * 100, 0);
  eq(groundCount(cap), 3, 'plafon'); eq(cap.items.map(i => i.x).join(), '200,300,400', 'a legrégebbiek tűntek el'); eq(cap.stats.despawned, 2);
  eq(cap.stats.dropped, 5);
});

test('ground: összevonás – azonos tárgy a körön belül stackel (a stack-határig), eltérő tárgy/távoli/mozgó nem; az idő a frissebb', () => {
  const gs = createGroundItems({ cfg: { ttl: 100 } }), ps = players(900, 900, 900, 900), invs = createPlayerInventories();
  dropItem(gs, 'wood', 60, 0, 0); run(gs, ps, invs, 5); dropItem(gs, 'wood', 60, 10, 5); dropItem(gs, 'stone', 5, 5, 5); dropItem(gs, 'wood', 5, 200, 0);
  run(gs, ps, invs, 0.6);
  eq(total(gs, 'wood'), 125); eq(gs.items.filter(i => i.item === 'wood').map(i => i.n).sort((a, b) => a - b).join(), '5,21,99');
  eq(total(gs, 'stone'), 5); assert(gs.items.find(i => i.n === 99).age <= 1.5, 'a frissebb idő számít');
  assert(gs.stats.merged >= 39, 'merged ' + gs.stats.merged);
  const evs = createGroundItems(), p9 = players(900, 900, 900, 900); dropItem(evs, 'wood', 99, 0, 0); dropItem(evs, 'wood', 10, 5, 0); dropItem(evs, 'wood', 10, 8, 0);
  const seen = []; for (let k = 0; k < 90; k++) seen.push(...stepGround(evs, p9, invs, DT).filter(e => e.type === 'merge'));
  assert(seen.length >= 1 && seen.every(e => e.n > 0), 'nincs 0 darabos összevonás-esemény'); eq(total(evs, 'wood'), 119);
  const one = createGroundItems({ cfg: { mergeEvery: 0.05 } }); dropItem(one, 'wood', 1, 0, 0); dropItem(one, 'wood', 1, 1, 0, { toss: true, angle: 0 }); stepGround(one, p9, invs, 0.05); eq(groundCount(one), 2, 'csak a társ mozog: nem vonódik');
  const own = createGroundItems(), pn = players(30, 0, 900, 0), invN = createPlayerInventories(); dropItem(own, 'herb', 2, 0, 0); dropItem(own, 'herb', 2, 4, 0, { owner: 0 }); run(own, pn, invN, 1.5);
  eq(groundCount(own), 1); eq(own.items[0].n, 4); eq(countItem(invN[0], 'herb'), 0); eq(own.items[0].noPick, 0, 'a dobó-zár az összevont rakásra is érvényes');
  const mv = createGroundItems(); dropItem(mv, 'wood', 1, 0, 0, { toss: true, angle: 0 }); dropItem(mv, 'wood', 1, 1, 0, { toss: true, angle: 0 });
  stepGround(mv, ps, invs, 0.3); eq(groundCount(mv), 2, 'mozgó tárgy nem vonódik össze');
  const sh = createGroundItems(); dropItem(sh, 'shard', 2, 0, 0); run(sh, ps, invs, 1); eq(groundCount(sh), 2, 'stack 1 nem vonódik');
});

test('ground: hibás bemenet – NaN játékos/inventory/dt/falak nem dob; sérült földi tárgy kiesik', () => {
  const gs = createGroundItems(); dropItem(gs, 'wood', 3, 0, 0, still);
  for (const dt of [NaN, -1, 0, Infinity, '1', null, undefined]) stepGround(gs, players(), createPlayerInventories(), dt);
  stepGround(gs, [null, { x: NaN, y: 0 }], [null, {}], DT, 'x'); stepGround(gs, null, null, DT, null); stepGround(null, [], [], DT); stepGround({}, [], [], DT);
  eq(groundCount(gs), 1);
  gs.items.push({ id: 99, item: 'wood', n: 1, x: NaN, y: 0, vx: 0, vy: 0, age: 0, ttl: 0, delay: 0, noPick: -1, mv: 0 });
  gs.items.push({ id: 98, item: 'wood', n: 0, x: 0, y: 0, vx: 0, vy: 0, age: 0, ttl: 0, delay: 0, noPick: -1, mv: 0 });
  stepGround(gs, players(900, 900, 900, 900), createPlayerInventories(), DT); eq(groundCount(gs), 1); eq(gs.stats.lost, 2);
  eq(stepGround(gs, players(), createPlayerInventories(), 5).length >= 0, true, 'nagy dt szorítva');
});

test('ground: figyelők – drop/pickup/despawn/merge események, a hibázó figyelő nem állítja meg a többit, leiratkozás', () => {
  const gs = createGroundItems({ cfg: { ttl: 5 } }), got = [];
  onGround(gs, () => { throw new Error('szándékos'); });
  const off = onGround(gs, e => got.push(e.type + ':' + e.n));
  const ps = players(0, 0, 900, 0), invs = createPlayerInventories();
  dropItem(gs, 'wood', 2, 5, 0, still); dropItem(gs, 'stone', 3, 400, 0, still);
  run(gs, ps, invs, 6);
  assert(got.includes('drop:2') && got.includes('pickup:2') && got.includes('despawn:3'), got.join());
  assert(gs.lastError && gs.lastError.message === 'szándékos');
  off(); const n = got.length; dropItem(gs, 'wood', 1, 0, 0); eq(got.length, n);
  onGround(gs, 5); onGround(null, () => {});
});

test('ground: inventory-eldobás – menü nyitva + 2. képesség fogott tárgy nélkül; atomi; zárt/megnyitás/fogott/üres: nincs eldobás', () => {
  const mk = () => ({ gs: createGroundItems(), invs: createPlayerInventories(), ps: players(100, 100, 400, 100), ms: createMenus(), ui: createInvUi() });
  const frame = (r, raws) => { // a main.js sorrendje: stepMenus -> stepDropInput -> stepInvUi
    stepMenus(r.ms, raws.map(x => ({ ...x })));
    const ev = stepDropInput(r.gs, r.ui, r.ms, raws, r.invs, r.ps); stepInvUi(r.ui, r.ms, raws, r.invs, DT); return ev;
  };
  const r = mk(); addItem(r.invs[0], 'wood', 12); addItem(r.invs[0], 'torch', 3);
  eq(frame(r, [{ ability2Pressed: true }, {}]).length, 0, 'zárt menü');
  eq(frame(r, [{ menuPressed: true, ability2Pressed: true }, {}]).length, 0, 'a megnyitás kockájában nincs eldobás');
  eq(countItem(r.invs[0], 'wood'), 12, 'semmi nem dobódott');
  const ev = frame(r, [{ ability2Pressed: true }, {}]);
  eq(ev.length, 1); eq(ev[0].id, 'wood'); eq(ev[0].n, 12); eq(ev[0].player, 0);
  eq(countItem(r.invs[0], 'wood'), 0); eq(total(r.gs, 'wood'), 12); eq(countItem(r.invs[0], 'torch'), 3, 'a másik slot érintetlen');
  eq(r.gs.items[0].noPick, 0); assert(r.gs.items[0].y > 100, 'a láb alá esik');
  eq(frame(r, [{ ability2Pressed: true }, {}]).length, 0, 'üres slot');
  r.ui.players[0].cursor = 1; frame(r, [{ interactPressed: true }, {}]); eq(r.ui.players[0].mark, 1);
  eq(frame(r, [{ ability2Pressed: true }, {}]).length, 0, 'fogott tárgynál a 2. képesség mégse'); eq(r.ui.players[0].mark, -1); eq(countItem(r.invs[0], 'torch'), 3);
  eq(frame(r, [{ ability2Pressed: true }, {}]).length, 1, 'mégse után eldob'); eq(total(r.gs, 'torch'), 3);
  const w = mk(); addItem(w.invs[1], 'herb', 4); frame(w, [{}, { menuPressed: true }]); frame(w, [{}, {}]);
  const e2 = frame(w, [{}, { ability2Pressed: true }]); eq(e2.length, 1); eq(e2[0].player, 1); eq(countItem(w.invs[0], 'herb'), 0);
  const bad = mk(); bad.invs[0].slots[0] = { id: 'ismeretlen', n: 3 }; frame(bad, [{ menuPressed: true }, {}]); frame(bad, [{}, {}]);
  eq(frame(bad, [{ ability2Pressed: true }, {}]).length, 0, 'ismeretlen tárgy: marad'); eq(bad.invs[0].slots[0].n, 3); eq(groundCount(bad.gs), 0);
  eq(stepDropInput(null, r.ui, r.ms, [], r.invs, r.ps).length, 0); eq(stepDropInput(r.gs, null, r.ms, [], r.invs, r.ps).length, 0); eq(stepDropInput(r.gs, r.ui, r.ms, null, null, null).length, 0);
});

test('ground: eldobás + visszavétel – a dobó csak kilépés után kapja vissza, az összeg végig megmarad', () => {
  const gs = createGroundItems(), invs = createPlayerInventories(), ps = players(0, 0, 900, 0);
  addItem(invs[0], 'wood', 30);
  const ms = createMenus(), ui = createInvUi();
  const step = raws => { stepMenus(ms, raws.map(x => ({ ...x }))); stepDropInput(gs, ui, ms, raws, invs, ps); stepInvUi(ui, ms, raws, invs, DT); stepGround(gs, ps, invs, DT); };
  step([{ menuPressed: true }, {}]); step([{}, {}]); step([{ ability2Pressed: true }, {}]);
  for (let k = 0; k < 180; k++) step([{}, {}]);
  eq(countItem(invs[0], 'wood') + total(gs, 'wood'), 30); eq(countItem(invs[0], 'wood'), 0, 'a közelben maradó dobó nem kapja vissza');
  ps[0].x = 200; for (let k = 0; k < 10; k++) step([{}, {}]);
  ps[0].x = 0; for (let k = 0; k < 120; k++) step([{}, {}]);
  eq(countItem(invs[0], 'wood'), 30); eq(groundCount(gs), 0);
});

test('ground: mentés-alak – körút azonos, hibás állapotnál atomi hamis, plafon/stack/ttl ellenőrizve', () => {
  const gs = createGroundItems(); dropItem(gs, 'wood', 40, 12.345, -7.5); dropItem(gs, 'herb', 3, 100, 100);
  run(gs, players(900, 900, 900, 900), createPlayerInventories(), 1);
  const st = groundState(gs); eq(st.v, 1); eq(st.items.length, 2);
  const g2 = createGroundItems(); assert(restoreGround(g2, JSON.parse(JSON.stringify(st))));
  eq(JSON.stringify(groundState(g2)), JSON.stringify(st)); eq(g2.items[0].vx, 0);
  const keep = JSON.stringify(g2.items), mkBad = e => ({ v: 1, items: [e] });
  for (const bad of [null, 5, {}, { v: 2, items: [] }, { v: 1 }, { v: 1, items: 'x' }, mkBad(['wood', 1, 0]), mkBad(['nincs', 1, 0, 0, 0]), mkBad(['wood', 0, 0, 0, 0]), mkBad(['wood', 100, 0, 0, 0]),
    mkBad(['wood', 1.5, 0, 0, 0]), mkBad(['wood', 1, NaN, 0, 0]), mkBad(['wood', 1, 0, 1e9, 0]), mkBad(['wood', 1, 0, 0, -1]), mkBad(['wood', 1, 0, 0, 300]), mkBad('x'),
    { v: 1, items: [['wood', 1, 0, 0, 0], ['wood', 1, 0, 0, NaN]] }]) { eq(restoreGround(g2, bad), false, JSON.stringify(bad)); eq(JSON.stringify(g2.items), keep, 'érintetlen'); }
  const small = createGroundItems({ cfg: { maxItems: 1 } }); eq(restoreGround(small, { v: 1, items: [['wood', 1, 0, 0, 0], ['wood', 1, 5, 5, 0]] }), false);
  eq(restoreGround(g2, { v: 1, items: [] }), true); eq(groundCount(g2), 0);
  eq(groundState(null).items.length, 0);
});

test('ground: visibleGround + drawGroundItems – csak a nézetben lévők, szám/blink/lebegés, hibás bemenet nem dob', () => {
  const gs = createGroundItems({ cfg: { ttl: 100, blinkAt: 20 } });
  dropItem(gs, 'wood', 5, 100, 100); dropItem(gs, 'stone', 1, 5000, 5000); dropItem(gs, 'herb', 2, 1000, 120);
  const out = []; eq(visibleGround(gs, 0, 0, 480, 540, out).length, 1); eq(out[0].item, 'wood'); eq(visibleGround(null, 0, 0, 9, 9, out).length, 0);
  const rec = () => { const c = { fills: [], texts: [] }; c.fillRect = (x, y, w, h) => c.fills.push({ x, y, w, h, s: c.fillStyle }); c.fillText = (s, x, y) => c.texts.push({ s, x, y }); return c; };
  const c1 = rec(); eq(drawGroundItems(c1, gs, 0, 0, 480, 540), 1); eq(c1.fills.length, 3); eq(c1.texts[0].s, '5');
  const c2 = rec(); eq(drawGroundItems(c2, gs, 900, 0, 480, 540), 1, 'másik nézet: a herb'); eq(c2.texts[0].s, '2');
  const c3 = rec(); eq(drawGroundItems(c3, gs, 100000, 0, 480, 540), 0); eq(c3.fills.length, 0);
  gs.items[0].age = 90; let shown = 0, hidden = 0;
  for (let k = 0; k < 40; k++) { gs.time = k * 0.05; const c = rec(); if (drawGroundItems(c, gs, 0, 0, 480, 540)) shown++; else hidden++; }
  assert(shown > 5 && hidden > 5, `villog: ${shown}/${hidden}`);
  eq(drawGroundItems(rec(), null, 0, 0, 1, 1), 0); eq(drawGroundItems(rec(), {}, 0, 0, 1, 1), 0);
  const noText = { fills: [], fillStyle: '', fillRect() {} }; assert(drawGroundItems(noText, gs, 900, 0, 480, 540) >= 0);
});

test('ground: smoke – 3000 kocka valódi világgal, falakkal, két mozgó játékossal, dobásokkal: összeg-tartás, nincs NaN, determinista', () => {
  const ws = createWorldStream(12014); warmStream(ws, [{ x: 0, y: 0 }]);
  const walls = streamWalls(ws);
  const sim = () => {
    const rng = mulberry32(77), gs = createGroundItems({ cfg: { ttl: 20, maxItems: 40 } }), invs = createPlayerInventories(null, 2, 6), ps = players(40, 40, 120, 40);
    let given = 0; const ids = ['wood', 'stone', 'herb', 'torch', 'fiber', 'shard'];
    for (let f = 0; f < 3000; f++) {
      for (const p of ps) { p.x += (rng() - 0.5) * 6; p.y += (rng() - 0.5) * 6; }
      if (f % 7 === 0) { const id = ids[Math.floor(rng() * ids.length)], n = 1 + Math.floor(rng() * 30), left = dropItem(gs, id, n, ps[0].x + (rng() - 0.5) * 80, ps[0].y + (rng() - 0.5) * 80, { toss: rng() < 0.5, owner: rng() < 0.3 ? 0 : -1 }); given += n - left; }
      stepGround(gs, ps, invs, DT, walls);
      if (f % 211 === 0) { for (const inv of invs) { const s = inv.slots[Math.floor(rng() * 6)]; if (s) { dropItem(gs, s.id, s.n, ps[1].x, ps[1].y, { toss: true, owner: 1 }); inv.slots[inv.slots.indexOf(s)] = null; } } }
    }
    const inInv = ids.reduce((a, id) => a + countItem(invs[0], id) + countItem(invs[1], id), 0), onGround = gs.items.reduce((a, i) => a + i.n, 0);
    return { given, inInv, onGround, gs, invs, ps, state: JSON.stringify([groundState(gs), invs.map(inventoryState)]) };
  };
  const a = sim(), b = sim();
  eq(a.state, b.state, 'determinista');
  assert(a.gs.items.length <= 40, 'plafon'); assert(a.gs.stats.picked > 0 && a.gs.stats.despawned > 0 && a.gs.stats.merged > 0, JSON.stringify(a.gs.stats));
  for (const it of a.gs.items) assert(Number.isFinite(it.x) && Number.isFinite(it.y) && it.n >= 1 && it.age >= 0, 'érvényes tárgy');
  eq(a.gs.stats.lost, 0);
  // a visszadobott (inventoryból) tárgyak a given-hez nem tartoznak, ezért az összeg-tartás: dropped = földön + felvett (inventoryba) + eltűnt, felvételek nélkül nem negatív
  const dropped = a.gs.stats.dropped; eq(dropped, a.onGround + a.gs.stats.picked + a.gs.stats.despawned, 'dropped = földön + felvett + eltűnt');
  assert(a.given <= dropped);
});
