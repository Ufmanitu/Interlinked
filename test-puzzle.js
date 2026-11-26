// S080 tesztek: rejtvény-alapelemek (def-ellenőrzés, kapuk, kapcsoló, nyomólap, ajtó, doboz, kulcs, mentés, valódi interakció/póráz/dungeon-lánc, 600 kockás smoke).
import { test, assert, eq, near } from './test-index.js';
import { createPlayer } from './game-player.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { collides } from './game-collision.js';
import { createInteractSystem, addProvider, stepInteraction, targetOf } from './game-interact.js';
import * as I from './game-instance.js';
import { dungeonSolve } from './world-dungeon.js';
import * as P from './game-puzzle.js';
import { PUZZLE_DEFS, PUZZLE_TEXTS, dungeonPuzzleDef } from './data-puzzles.js';

const DT = 1 / 60;
const empty = o => ({ id: 't', switches: [], plates: [], boxes: [], gates: [], doors: [], keys: [], ...o });
const body = (x, y) => ({ x, y, w: 24, h: 24 });
const el = (pz, list, id) => pz[list].find(e => e.id === id);
const use = (pz, role, id, players = []) => P.handlePuzzleEvent(pz, players, { kind: 'puzzle', target: { puzzle: pz.id, role, id } });
const still = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
const lcg = s => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);

test('puzzle def: az éles adat érvényes, a hibás def okkal elutasítva, a szövegek HU/EN párban', () => {
  for (const d of PUZZLE_DEFS) { eq(P.validatePuzzleDef(d).error, null); assert(P.createPuzzle(d, 100, 200), d.id); }
  const s = { id: 's', tx: 1, ty: 1 }, door = o => ({ id: 'd', tx: 3, ty: 3, in: 's', ...o });
  const cases = [
    [null, 'def'], [{ id: '' }, 'def'], [{ id: 'x' }, 'list'], [empty({ switches: [null] }), 'id'], [empty({ switches: [s, s] }), 'dup'],
    [empty({ switches: [{ id: 's', tx: -1, ty: 0 }] }), 'pos'], [empty({ switches: [{ ...s, time: -1 }] }), 'value'], [empty({ plates: [{ ...s, need: 0 }] }), 'value'],
    [empty({ boxes: [{ ...s, heft: NaN }] }), 'value'], [empty({ switches: [s], doors: [door({ w: 0 })] }), 'value'],
    [empty({ switches: [s], gates: [{ id: 'g', op: 'toString', in: ['s'] }] }), 'op'], [empty({ switches: [s], gates: [{ id: 'g', op: 'xor', in: ['s'] }] }), 'inputs'],
    [empty({ gates: [{ id: 'g', op: 'not', in: ['nincs'] }] }), 'ref'], [empty({ gates: [{ id: 'g', op: 'not', in: ['h'] }, { id: 'h', op: 'not', in: ['g'] }] }), 'cycle'],
    [empty({ switches: [s], doors: [door({ in: undefined })] }), 'source'], [empty({ switches: [s], doors: [door({ lock: 'k' })] }), 'source'],
    [empty({ doors: [door({ in: undefined, lock: 'k' })] }), 'lock'], [empty({ switches: [s], doors: [door({ in: 'x' })] }), 'ref'],
  ];
  for (const [d, err] of cases) { eq(P.validatePuzzleDef(d).error, err); eq(P.createPuzzle(d), null); }
  eq(P.createPuzzle(PUZZLE_DEFS[0], NaN, 0), null);
  eq(Object.keys(PUZZLE_TEXTS.hu).join(), Object.keys(PUZZLE_TEXTS.en).join());
});

test('puzzle kapuk: and/or/xor/not teljes igazságtábla, tetszőleges felsorolási sorrendben; a latch megmarad', () => {
  const pz = P.createPuzzle(empty({
    switches: [{ id: 'a', tx: 1, ty: 1 }, { id: 'b', tx: 3, ty: 1 }],
    gates: [{ id: 'nand', op: 'not', in: ['and'] }, { id: 'and', op: 'and', in: ['a', 'b'] }, { id: 'or', op: 'or', in: ['a', 'b'] }, { id: 'xor', op: 'xor', in: ['a', 'b'] }, { id: 'lt', op: 'latch', in: ['and'] }],
  }));
  let a = false, b = false, latched = false;
  for (const flip of ['a', 'b', 'a', 'b', 'a', 'a']) {
    use(pz, 'switch', flip); if (flip === 'a') a = !a; else b = !b; latched ||= a && b;
    const v = id => pz.signals.get(id);
    eq(v('and'), a && b); eq(v('nand'), !(a && b)); eq(v('or'), a || b); eq(v('xor'), a !== b); eq(v('lt'), latched);
  }
});

test('puzzle kapcsoló + ajtó: váltás, időzített kar lejár, az ajtó nem záródik a benne álló játékosra', () => {
  const pz = P.createPuzzle(empty({ switches: [{ id: 's', tx: 1, ty: 1, time: 1 }], doors: [{ id: 'd', tx: 5, ty: 5, in: 's' }] }));
  eq(P.puzzleColliders(pz).length, 1);
  use(pz, 'switch', 's'); eq(el(pz, 'doors', 'd').open, true); eq(P.puzzleColliders(pz).length, 0);
  const inDoor = [body(176, 176)];
  const seen = [];
  for (let i = 0; i < 90; i++) seen.push(...P.stepPuzzle(pz, inDoor, still, DT).map(e => e.type));
  eq(el(pz, 'switches', 's').on, false); eq(el(pz, 'doors', 'd').open, true, 'foglalt ajtó nyitva'); eq(seen.join(), 'expire');
  eq(P.stepPuzzle(pz, [body(40, 40)], still, DT).map(e => e.type).join(), 'close');
  const t = P.createPuzzle(empty({ switches: [{ id: 's', tx: 1, ty: 1 }] })); use(t, 'switch', 's'); use(t, 'switch', 's'); eq(t.switches[0].on, false);
  eq(P.stepPuzzle(pz, inDoor, still, NaN).length, 0);
});

test('puzzle nyomólap: súlyküszöb (egy / két játékos / doboz), a lelépés elenged', () => {
  const pz = P.createPuzzle(empty({ plates: [{ id: 'p', tx: 2, ty: 2, need: 2 }], doors: [{ id: 'd', tx: 8, ty: 8, in: 'p' }] }));
  const on = pl => { P.stepPuzzle(pz, pl, still, DT); return el(pz, 'doors', 'd').open; };
  eq(on([body(80, 80)]), false); eq(on([body(80, 80), body(84, 80)]), true); eq(on([body(80, 80), body(200, 80)]), false);
  eq(on([{ ...body(80, 80), weight: 2 }]), true); eq(on([body(NaN, 80)]), false);
});

test('puzzle doboz: tolás a nyomás irányába, fal és másik doboz megállítja, nehéz dobozhoz két játékos kell, átlós/távoli nyomás nem tol', () => {
  const mk = heft => P.createPuzzle(empty({ boxes: [{ id: 'b', tx: 5, ty: 5, heft }] }));
  const R = [{ x: 1, y: 0 }, { x: 1, y: 0 }], left = b => body(b.x - 27, b.y);
  let pz = mk(1), b = pz.boxes[0]; const p = left(b), wall = [{ x: 240, y: 0, w: 32, h: 400 }];
  for (let i = 0; i < 300; i++) { P.stepPuzzle(pz, [p], R, DT, wall); p.x = b.x - 27; }
  near(b.x + 15, 240, 1e-3, 'a falnál megáll'); near(b.y, 176, 1e-9);
  pz = mk(1); b = pz.boxes[0]; const x0 = b.x;
  for (const [pl, inp] of [[body(x0 - 40, 176), R], [body(x0 - 27, 176), [{ x: 0.2, y: 0 }]], [body(x0 - 27, 176), [{ x: 0.5, y: 0.9 }]], [body(x0 - 27, 176), [{ x: -1, y: 0 }]], [body(x0 - 27, 210), R]]) P.stepPuzzle(pz, [pl], inp, DT);
  eq(b.x, x0);
  pz = mk(2); b = pz.boxes[0]; P.stepPuzzle(pz, [left(b)], R, DT); eq(b.x, x0, 'egyedül nehéz');
  P.stepPuzzle(pz, [left(b), { ...left(b), y: 182 }], R, DT); assert(b.x > x0, 'ketten megy');
  pz = mk(1); b = pz.boxes[0]; const behind = body(b.x + 40, 176), pusher = left(b);
  for (let i = 0; i < 120; i++) { P.stepPuzzle(pz, [pusher, behind], [R[0], still[1]], DT); pusher.x = b.x - 27; }
  near(b.x + 15, behind.x - 12, 1e-3, 'a mögötte álló játékosba nem tolódik bele');
  const two = P.createPuzzle(empty({ boxes: [{ id: 'a', tx: 5, ty: 5 }, { id: 'c', tx: 7, ty: 5 }] }));
  const pa = left(two.boxes[0]);
  for (let i = 0; i < 300; i++) { P.stepPuzzle(two, [pa], R, DT); pa.x = two.boxes[0].x - 27; }
  assert(two.boxes[0].x + 30 <= two.boxes[1].x + 1e-6, 'nincs doboz-átfedés');
});

test('puzzle kulcs + zár a valódi interakció-rendszerrel: zárva, felvétel, nyitás', () => {
  const pz = P.createPuzzle(empty({ keys: [{ id: 'k', tx: 2, ty: 4 }], doors: [{ id: 'd', tx: 6, ty: 2, lock: 'k' }] }));
  const sys = createInteractSystem(); addProvider(sys, P.puzzleProvider(() => pz));
  const players = [body(208, 112), body(80, 112)], got = [];
  const press = (i, x, y) => {
    const mk = on => [0, 1].map(n => (n === i ? { x, y, interact: on } : { x: 0, y: 0, interact: false }));
    stepInteraction(sys, players, mk(false), 0.5);
    for (const ev of stepInteraction(sys, players, mk(true), 0.5)) got.push(P.handlePuzzleEvent(pz, players, ev));
  };
  press(0, 0, -1); eq(targetOf(sys, 0).action, 'locked'); eq(got.at(-1).type, 'locked'); eq(pz.doors[0].open, false);
  press(1, 0, 1); eq(got.at(-1).type, 'key');
  press(0, 0, -1); eq(got.at(-1).type, 'unlock'); eq(pz.doors[0].open, true);
  press(0, 0, -1); eq(got.length, 3, 'a nyitott zár már nem célpont');
  eq(P.handlePuzzleEvent(pz, players, { kind: 'object' }), null);
});

test('puzzle mentés: JSON-körút azonos állapotot ad (eltolt origóval is), hibás adat atomikusan elutasítva', () => {
  const pz = P.createPuzzle(PUZZLE_DEFS[0], 1000, 2000);
  use(pz, 'switch', 's_left'); use(pz, 'switch', 's_right'); use(pz, 'switch', 's_timer'); pz.boxes[0].y -= 64;
  P.stepPuzzle(pz, [], still, DT); eq(pz.boxes[0].y, 2000 + 5.5 * 32);
  use(pz, 'switch', 's_left');
  const bag = {}; assert(P.storePuzzle(pz, bag));
  const json = JSON.parse(JSON.stringify(bag)), q = P.createPuzzle(PUZZLE_DEFS[0], 5000, 6000);
  assert(P.loadPuzzle(q, json)); eq(JSON.stringify(P.puzzleState(q)), JSON.stringify(P.puzzleState(pz)));
  eq(el(q, 'doors', 'dr_main').open, true, 'latch'); eq(el(q, 'plates', 'p_box').on, true);
  const before = JSON.stringify(P.puzzleState(q)), good = P.puzzleState(pz);
  for (const bad of [null, {}, { ...good, v: 2 }, { ...good, boxes: [['b1', NaN, 1]] }, { ...good, switches: [['s_left', -1]] }, { ...good, keys: 'x' }]) eq(P.restorePuzzle(q, bad), false);
  eq(JSON.stringify(P.puzzleState(q)), before);
  eq(P.loadPuzzle(q, {}), false); eq(P.loadPuzzle(q, null), false);
});

test('puzzle + dungeon (S079): a meta ajtói/kulcsai betölthetők, a kulcs-lánc sorrendben minden ajtót nyit, az instance-mentés őrzi', () => {
  const mgr = I.createInstanceManager(), players = [createPlayer(0, 100, 100), createPlayer(1, 140, 100)];
  const r = I.enterInstance(mgr, players, { id: 'e', target: 'dungeon_ruin', tx: 3, ty: 2, w: 2, h: 1 }, { force: true });
  assert(r.ok, r.reason);
  const w = I.instanceWorld(mgr), def = dungeonPuzzleDef(w.id, w.meta), pz = P.createPuzzle(def, w.ox, w.oy);
  assert(pz && pz.doors.length >= 1, P.validatePuzzleDef(def).error);
  eq(P.puzzleColliders(pz).length, pz.doors.length);
  const sol = dungeonSolve(w.meta); assert(sol.ok);
  for (const step of sol.order) {
    eq(use(pz, 'door', step.door).type, 'locked'); eq(use(pz, 'key', step.key).type, 'key'); eq(use(pz, 'door', step.door).type, 'unlock');
  }
  assert(pz.doors.every(d => d.open));
  P.storePuzzle(pz, I.instanceData(mgr, w.id));
  const saved = JSON.parse(JSON.stringify(I.instanceState(mgr))), mgr2 = I.createInstanceManager();
  assert(I.restoreInstances(mgr2, saved));
  const q = P.createPuzzle(def, w.ox, w.oy); assert(P.loadPuzzle(q, I.instanceData(mgr2, w.id))); assert(q.doors.every(d => d.open && d.unlocked));
  eq(dungeonPuzzleDef('x', null), null);
});

test('puzzle smoke: 600 kocka két szkriptelt játékossal, póráz + falak + dobozok; nincs NaN/átfedés, póráz <= L, determinizmus és mentés-körút', () => {
  const L = { x: 200, y: 160 };
  const run = seed => {
    const rnd = lcg(seed), pz = P.createPuzzle(PUZZLE_DEFS[0], 0, 0), sys = createTetherSystem({ L, k: 0.5 });
    const walls = [{ x: -32, y: -32, w: 544, h: 32 }, { x: -32, y: 352, w: 544, h: 32 }, { x: -32, y: 0, w: 32, h: 352 }, { x: 480, y: 0, w: 32, h: 352 }];
    const players = [createPlayer(0, 144, 272), createPlayer(1, 190, 272)];
    let inp = still;
    for (let f = 0; f < 600; f++) {
      if (f < 120) inp = [{ x: 0, y: -1 }, { x: 0, y: -1 }];
      else if (f % 25 === 0) inp = [0, 1].map(() => ({ x: Math.floor(rnd() * 3) - 1, y: Math.floor(rnd() * 3) - 1 }));
      if (f % 90 === 0) use(pz, 'switch', pz.switches[Math.floor(rnd() * 3)].id, players);
      sys.cfg.walls = P.puzzleColliders(pz, walls.slice());
      stepTetherSystem(sys, players, inp, DT);
      P.stepPuzzle(pz, players, inp, DT, walls);
      for (const p of players) assert(Number.isFinite(p.x + p.y) && !collides(p, P.puzzleColliders(pz, walls.slice())), 'játékos átfedés f=' + f);
      for (const b of pz.boxes) assert(Number.isFinite(b.x + b.y) && !collides(b, walls), 'doboz a falban f=' + f);
      assert(Math.abs(players[0].x - players[1].x) <= L.x + 1e-6 && Math.abs(players[0].y - players[1].y) <= L.y + 1e-6, 'póráz f=' + f);
      if (f === 119) assert(pz.boxes[0].y < 7.5 * 32 - 20, 'a doboz eltolódott');
      if (f % 100 === 99) assert(P.restorePuzzle(pz, JSON.parse(JSON.stringify(P.puzzleState(pz)))), 'körút');
    }
    return JSON.stringify([P.puzzleState(pz), players.map(p => [p.x, p.y])]);
  };
  for (let s = 1; s <= 12; s++) eq(run(s), run(s));
});
