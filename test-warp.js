// S017 tesztek: warp-zsebek (adat, geometria, ütközők, forrás, átlépés, streaming-pontok, rajz) és a teljes lánc
// (világ -> falak -> póráz -> interakció -> warp) szkriptelt játékosokkal, mint a main.js.
import { test, assert, eq, near } from './test-index.js';
import { POCKET_TYPES, WARP_LINKS } from './data-warps.js';
import { WARP_CONFIG, resolveLink, createWarpSystem, pocketOf, warpWhere, warpColliders, warpProvider, handleWarpEvent, stepWarp, streamPoints } from './world-warp.js';
import { visibleHouses, drawHouse, drawPockets, ROOF_H } from './render-warp.js';
import { promptText } from './render-interact.js';
import { createPlayer } from './game-player.js';
import { createCamera, stepCamera } from './game-camera.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { collides } from './game-collision.js';
import { WORLD_SEED, createWorldStream, warmStream, updateStream, streamWalls, findOpenSpot } from './world-stream.js';
import { createObjectStore, syncObjects, objectColliders, footY, sortByY } from './world-objects.js';
import { createInteractSystem, addObjectSource, addProvider, onInteract, stepInteraction } from './game-interact.js';

const DT = 1 / 60;
const A = { x: 1000, y: 800 };
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const box = (x, y) => ({ x: x - 12, y: y - 12, w: 24, h: 24 });
const lcg = s => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
function ws1() { return createWarpSystem({ anchor: A }); }
function fakeCtx() {
  const calls = [];
  return { calls, fillStyle: '', fillRect(...a) { calls.push(a); } };
}

test('warp adat: a link feloldása (geometria, falak, kijárat, érkezés, ház/ajtó)', () => {
  const ws = ws1(), L = ws.links[0];
  eq(ws.links.length, 1); eq(ws.rejected.length, 0);
  eq(L.floor.w, 320); eq(L.floor.h, 224); eq(L.walls.length, 4);
  eq(L.house.x, A.x - 48); eq(L.house.y, A.y - 136);
  assert(hit(L.door, L.house), 'az ajtó-zóna érinti a ház alját');
  assert(L.door.y + L.door.h > L.house.y + L.house.h, 'az ajtó-zóna a ház alatt is kinyúlik');
  assert(L.exit.x >= L.floor.x && L.exit.y + L.exit.h <= L.floor.y + L.floor.h, 'a kijárat a padlón belül van');
  assert(L.floor.x > 100000 && !pocketOf(ws, A.x, A.y), 'a zseb távol a világtól');
  assert(L.floor.w + 2 * WARP_CONFIG.wall <= WARP_CONFIG.stride, 'slot-szélesség');
});

test('warp adat: hibás link/horgony/duplikált id és slot elutasítva', () => {
  const ok = WARP_LINKS[0];
  const bad = [null, {}, { ...ok, id: '' }, { ...ok, pocket: 'nincs' }, { ...ok, pocket: '__proto__' }, { ...ok, slot: -1 }, { ...ok, slot: 1.5 },
    { ...ok, house: { dx: NaN, dy: 0, w: 10, h: 10 } }, { ...ok, door: { dx: 0, dy: 0, w: 0, h: 10 } }];
  for (const l of bad) eq(resolveLink(l, A), null, JSON.stringify(l));
  eq(resolveLink(ok, { x: NaN, y: 0 }), null);
  const ws = createWarpSystem({ anchor: A, links: [ok, { ...ok }, { ...ok, id: 'x', slot: 0 }, { ...ok, id: 'y', slot: 1 }] });
  eq(ws.links.length, 2, 'azonos id és azonos slot kiesik'); eq(ws.rejected.length, 2);
  assert(!hit(ws.links[0].bounds, ws.links[1].bounds), 'a zsebek nem fedik egymást');
  eq(createWarpSystem({ anchor: { x: NaN, y: 0 } }).links.length, 0);
  const big = { big: { ...POCKET_TYPES.house, w: 40 } };
  eq(resolveLink({ ...ok, pocket: 'big' }, A, big), null, 'túl széles zseb');
  const out = { o: { ...POCKET_TYPES.house, exit: { tx: 9, ty: 5, tw: 3, th: 2 } } };
  eq(resolveLink({ ...ok, pocket: 'o' }, A, out), null, 'a kijárat kilóg a padlóról');
});

test('warp ütközők: ház, 4 fal, ütköző tárgyak; érkezési pontok és kijárat szabadok', () => {
  const ws = ws1(), L = ws.links[0], cs = warpColliders(ws);
  eq(cs.length, 1 + 4 + 2, 'ház + falak + ágy + asztal (a szőnyeg nem ütköző)');
  for (const c of cs) assert([c.x, c.y, c.w, c.h].every(Number.isFinite) && c.w > 0 && c.h > 0, 'véges téglalap');
  const gap = WARP_CONFIG.pairGap / 2;
  for (const c of cs) {
    for (const sx of [-gap, gap]) {
      assert(!hit(box(L.enter.x + sx, L.enter.y), c), 'belső érkezés szabad');
      assert(!hit(box(L.out.x + sx, L.out.y), c), 'külső érkezés szabad');
    }
    assert(!hit(L.exit, c) || c === L.walls[1], 'a kijárat-zónát csak az alsó fal érintheti');
  }
  eq(warpColliders(null).length, 0);
});

test('warp: pocketOf/warpWhere (padló, fal, kint, hibás)', () => {
  const ws = ws1(), L = ws.links[0];
  eq(pocketOf(ws, L.enter.x, L.enter.y), L); eq(pocketOf(ws, L.floor.x - 10, L.floor.y + 5), L, 'a fal is a zseb');
  eq(pocketOf(ws, L.floor.x - 40, L.floor.y), null); eq(pocketOf(ws, A.x, A.y), null);
  eq(pocketOf(ws, NaN, 0), null); eq(pocketOf(null, 0, 0), null);
  const p = [createPlayer(0, L.enter.x, L.enter.y), createPlayer(1, A.x, A.y)];
  eq(warpWhere(ws, p), null, 'az egyik kint'); p[1].x = L.enter.x + 30; p[1].y = L.enter.y;
  eq(warpWhere(ws, p), 'house1'); eq(warpWhere(ws, [p[0]]), null);
});

test('warp forrás: ajtó (enter) és kijárat (exit) a zóna közelében; távol/hibás -> semmi', () => {
  const ws = ws1(), L = ws.links[0], prov = warpProvider(ws);
  const at = r => ({ x: r.x, y: r.y, w: 40, h: 28 });
  let out = prov(at(L.door), [], { prefilter: 96 });
  eq(out.length, 1); eq(out[0].action, 'enter'); eq(out[0].key, 'warp:house1:door'); eq(out[0].kind, 'warp'); eq(out[0].ref, L.doorRef);
  eq(out[0].ax, L.door.x + L.door.w / 2); eq(out[0].ay, L.door.y);
  out = prov(at(L.exit), [], undefined); eq(out.length, 1); eq(out[0].action, 'exit'); eq(out[0].ref.role, 'exit');
  eq(prov({ x: A.x + 5000, y: A.y, w: 40, h: 28 }, [], { prefilter: 96 }).length, 0, 'távol');
  eq(prov({ x: NaN, y: 0, w: 40, h: 28 }, [], {}).length, 0, 'NaN zóna'); eq(prov(null, [], {}).length, 0);
  eq(warpProvider(null)({ x: 0, y: 0, w: 1, h: 1 }, [], {}).length, 0);
});

test('warp átlépés: páros enter/exit, cooldown, hibás esemény/játékos nem dob és nem mozdít', () => {
  const ws = ws1(), L = ws.links[0];
  const ps = [createPlayer(0, A.x - 20, A.y - 40), createPlayer(1, A.x + 90, A.y)];
  ps[0].vx = 50;
  const ev = (role, extra) => ({ kind: 'warp', player: 0, target: role === 'door' ? L.doorRef : L.exitRef, ...extra });
  let r = handleWarpEvent(ws, ps, ev('door'));
  eq(r.type, 'enter'); eq(warpWhere(ws, ps), 'house1');
  near(ps[0].x, L.enter.x - 24); near(ps[1].x, L.enter.x + 24); eq(ps[0].y, L.enter.y); eq(ps[0].vx, 0);
  eq(handleWarpEvent(ws, ps, ev('exit')), null, 'cooldown');
  stepWarp(ws, 0.6); stepWarp(ws, NaN); stepWarp(null, 1);
  r = handleWarpEvent(ws, ps, ev('exit'));
  eq(r.type, 'exit'); eq(warpWhere(ws, ps), null); near(ps[0].x, L.out.x - 24); near(ps[1].y, L.out.y); eq(ws.count, 2);
  stepWarp(ws, 1);
  const before = JSON.stringify(ps);
  for (const e of [null, {}, { kind: 'interact', target: L.doorRef }, { kind: 'warp' }, { kind: 'warp', target: { id: 'nincs', role: 'door' } },
    { kind: 'warp', target: { id: 'house1', role: 'x' } }]) eq(handleWarpEvent(ws, ps, e), null);
  eq(handleWarpEvent(ws, [ps[0]], ev('door')), null); eq(handleWarpEvent(null, ps, ev('door')), null);
  const nan = [createPlayer(0, NaN, 0), ps[1]];
  eq(handleWarpEvent(ws, nan, ev('door')), null);
  eq(JSON.stringify(ps), before, 'hibás hívás nem mozdít');
});

test('warp streaming-pontok: a zsebben lévő játékos helyett a kinti kilépési pont', () => {
  const ws = ws1(), L = ws.links[0];
  const ps = [createPlayer(0, L.enter.x, L.enter.y), createPlayer(1, A.x, A.y)];
  const pts = streamPoints(ws, ps, []);
  eq(pts.length, 2); eq(pts[0].x, L.out.x); eq(pts[0].y, L.out.y); eq(pts[1], ps[1]);
  eq(streamPoints(null, ps, []).length, 2); eq(streamPoints(ws, null, []).length, 0);
});

test('warp szövegek: act.enter / act.exit HU+EN', () => {
  eq(promptText('enter', 'hu'), 'Belép'); eq(promptText('exit', 'hu'), 'Kilép');
  eq(promptText('enter', 'en'), 'Enter'); eq(promptText('exit', 'en'), 'Exit');
});

test('warp rajz: házak y-sorrendje, ház és zseb rajza, kivágás', () => {
  const ws = ws1(), L = ws.links[0], h = L.house, base = h.y + h.h;
  const view = (ox, oy) => visibleHouses(ws, ox, oy, 960, 540, []);
  eq(view(h.x - 100, h.y - 100).length, 1); eq(view(h.x + 5000, h.y).length, 0);
  eq(view(h.x - 100, h.y - ROOF_H - 540 + 10).length, 1, 'a tető is látszik felülről'); eq(visibleHouses(null, 0, 0, 1, 1, []).length, 0);
  const e = view(h.x - 100, h.y - 100)[0];
  eq(footY(e), base);
  const north = createPlayer(0, h.x + 10, base - 40), south = createPlayer(1, h.x + 10, base + 10);
  const sorted = sortByY([south, e, north]);
  eq(sorted[0], north); eq(sorted[1], e); eq(sorted[2], south);
  const c = fakeCtx(); drawHouse(c, L, h.x - 100, h.y - 100);
  assert(c.calls.length > 20 && c.calls.every(a => a.every(Number.isFinite)), 'véges rajz-hívások');
  const c2 = fakeCtx();
  eq(drawPockets(c2, ws, L.floor.x - 300, L.floor.y - 150, 960, 540), 1);
  assert(c2.calls.some(a => a[2] === L.floor.w && a[3] === L.floor.h), 'padló'); assert(c2.calls.every(a => a.every(Number.isFinite)));
  eq(drawPockets(fakeCtx(), ws, 0, 0, 960, 540), 0, 'nézeten kívül'); eq(drawPockets(null, ws, 0, 0, 1, 1), 0);
});

// --- a teljes lánc, mint a main.js ---
function rig(startNear) {
  const spot = findOpenSpot(WORLD_SEED, 0, 0);
  const players = startNear ? [createPlayer(0, spot.x - 40, spot.y - 20), createPlayer(1, spot.x + 40, spot.y - 20)]
    : [createPlayer(0, spot.x - 70, spot.y), createPlayer(1, spot.x + 70, spot.y)];
  const world = createWorldStream(WORLD_SEED); warmStream(world, players);
  const objects = createObjectStore(WORLD_SEED, { keepFree: [{ x: spot.x, y: spot.y, r: 224 }] }); syncObjects(objects, world);
  const warp = createWarpSystem({ anchor: spot });
  const interact = createInteractSystem(); addObjectSource(interact, objects); addProvider(interact, warpProvider(warp));
  const walls = []; let key = '';
  const refresh = () => {
    const k = world.version + '|' + objects.version; if (k === key) return; key = k; walls.length = 0;
    for (const r of streamWalls(world)) walls.push(r); for (const r of objectColliders(objects)) walls.push(r); for (const r of warpColliders(warp)) walls.push(r);
  };
  refresh();
  const L = { x: 864, y: 444 };
  const tether = createTetherSystem({ walls, L, k: 0.5 });
  const camera = createCamera((players[0].x + players[1].x) / 2, (players[0].y + players[1].y) / 2);
  const rg = { spot, players, world, warp, interact, walls, tether, camera, log: [], L, frame: 0 };
  onInteract(interact, ev => {
    if (ev.kind !== 'warp') return;
    const r = handleWarpEvent(warp, players, ev);
    if (r) { rg.log.push(r.type); camera.x = (players[0].x + players[1].x) / 2; camera.y = (players[0].y + players[1].y) / 2; }
  });
  rg.step = inps => {
    stepWarp(warp, DT); updateStream(world, streamPoints(warp, players)); syncObjects(objects, world); refresh();
    stepTetherSystem(tether, players, inps, DT); stepInteraction(interact, players, inps, DT); stepCamera(camera, players[0], players[1], DT);
    rg.frame++;
    for (const p of players) {
      assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN pozíció');
      assert(!collides(p, walls), 'falban: ' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ' @' + rg.frame);
    }
    assert(Math.abs(players[0].x - players[1].x) <= L.x + 1 && Math.abs(players[0].y - players[1].y) <= L.y + 1, 'póráz-távolság');
  };
  return rg;
}
const IDLE = { x: 0, y: 0, interact: false };
function steer(p, tx, ty) { const dx = tx - p.x, dy = ty - p.y; return { x: Math.abs(dx) > 3 ? Math.sign(dx) : 0, y: Math.abs(dy) > 3 ? Math.sign(dy) : 0 }; }
// P0 a cél felé megy és 6 kockánként megnyomja az interakciót, amíg a megadott számú átlépés meg nem történik.
function walkAndUse(rg, tx, ty, want, max = 900) {
  for (let i = 0; i < max && rg.log.length < want; i++) {
    const s = steer(rg.players[0], tx, ty);
    rg.step([{ ...s, interact: i % 6 === 0 }, IDLE]);
  }
  eq(rg.log.length, want, 'az átlépés megtörtént: ' + rg.log.join());
}

test('warp lánc: be- és kilépés szkriptelt játékossal, falak a zsebben, streaming a kinti pontokra', () => {
  const rg = rig(), L = rg.warp.links[0];
  for (let cycle = 0; cycle < 2; cycle++) {
    walkAndUse(rg, rg.spot.x, rg.spot.y - 40, cycle * 2 + 1);
    eq(rg.log[cycle * 2], 'enter'); eq(warpWhere(rg.warp, rg.players), 'house1');
    near(rg.camera.x, (rg.players[0].x + rg.players[1].x) / 2, 1e-6, 'kamera-ugrás');
    for (const dir of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {            // minden irányba nyomják a falat
      for (let i = 0; i < 120; i++) rg.step([{ x: dir[0], y: dir[1], interact: false }, { x: dir[0], y: dir[1], interact: false }]);
      for (const p of rg.players) assert(p.x >= L.floor.x - 1e-6 && p.x <= L.floor.x + L.floor.w + 1e-6 && p.y >= L.floor.y - 1e-6 && p.y <= L.floor.y + L.floor.h + 1e-6, 'a pár a padlón marad');
    }
    for (let i = 0; i < 80; i++) rg.step([IDLE, IDLE]);               // cooldown lejár
    walkAndUse(rg, L.exit.x + L.exit.w / 2, L.floor.y + L.floor.h, cycle * 2 + 2);
    eq(rg.log[cycle * 2 + 1], 'exit'); eq(warpWhere(rg.warp, rg.players), null);
    assert(Math.hypot(rg.players[0].x - L.out.x, rg.players[0].y - L.out.y) < 60, 'a ház előtt érkeznek');
    for (let i = 0; i < 40; i++) rg.step([IDLE, IDLE]);
  }
  for (const k of rg.world.chunks.keys()) { const [cx, cy] = k.split(',').map(Number); assert(Math.abs(cx) < 8 && Math.abs(cy) < 8, 'a zsebnél nem töltődik chunk: ' + k); }
  assert(rg.world.chunks.size <= 25);
});

test('warp smoke: 900 kocka véletlen mozgással és interakcióval a ház körül (invariánsok, nincs NaN)', () => {
  const rnd = lcg(17017), rg = rig(true);
  let dirs = [{ x: 0, y: -1 }, { x: 0, y: -1 }];
  for (let f = 0; f < 900; f++) {
    if (f % 25 === 0) dirs = [0, 1].map(() => { const r = rnd(); return r < 0.45 ? { x: 0, y: -1 } : r < 0.6 ? { x: 0, y: 1 } : r < 0.8 ? { x: 1, y: 0 } : { x: -1, y: 0 }; });
    rg.step(dirs.map(d => ({ ...d, interact: rnd() < 0.12 })));
  }
  assert(rg.log.length >= 2, 'volt átlépés: ' + rg.log.join());
  rg.log.forEach((t, i) => eq(t, i % 2 ? 'exit' : 'enter', 'belépés és kilépés váltakozik'));
  assert(rg.warp.count === rg.log.length);
});
