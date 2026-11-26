// S076 tesztek: instance-kezelés (def/regiszter/szövegek, generátor, világ-geometria, páros belépés/kilépés, interakció, póráz bent, mentés + game-save szekció, fuzz).
import { test, assert, eq } from './test-index.js';
import { T, isSolidId } from './world-tiles.js';
import { createPlayer } from './game-player.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { collides } from './game-collision.js';
import { MACRO_MAP } from './data-macro.js';
import { loadMacroMap } from './world-macro.js';
import { createInteractSystem, addProvider, onInteract, stepInteraction, targetOf } from './game-interact.js';
import { createGameClock } from './game-clock.js';
import { sanitizeField, fieldShare, fieldEffectiveL } from './game-field.js';
import { SORSKO_CONFIG, createSorsko } from './game-sorsko.js';
import { SECTIONS, captureSave, applySave } from './game-save.js';
import * as I from './game-instance.js';
import './test-mine.js'; // S077: a bánya-tesztek innen töltődnek (a lépésenkénti 6 fájl miatt; az S185 a test-index FILES-ébe viheti)
import './test-dungeon.js'; // S079: ugyanígy a dungeon-tesztek

const DT = 1 / 60;
const lcg = s => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const mm = loadMacroMap(MACRO_MAP), EN = mm.entrances[0], RECT = I.entranceRect(EN);
const ID = 'mine_meadow';
const mk = () => ({ ins: I.createInstanceManager(), ps: [createPlayer(0, 0, 0), createPlayer(1, 0, 0)] });
const putAt = (ps, x, y, dx = 0) => { ps[0].x = x - dx; ps[0].y = y; ps[1].x = x + dx; ps[1].y = y; };
const atDoor = (r, dx = 120) => putAt(r.ps, RECT.x + RECT.w / 2, RECT.y + RECT.h / 2, dx);
const enter = (r, o = {}) => I.enterInstance(r.ins, r.ps, EN, o);
const inside = (w, p) => p.x >= w.bounds.x && p.x < w.bounds.x + w.bounds.w && p.y >= w.bounds.y && p.y < w.bounds.y + w.bounds.h;
const base = { id: 'cave_x', kind: 'cave', generator: 'room', seed: 5, cols: 20, rows: 20 };
const room = () => I.INSTANCE_GENERATORS.room(base);
const gens = fn => ({ room: () => fn(room()) });
const build = fn => I.buildInstanceWorld(base, undefined, gens(fn));

test('instance adat: def-ek, regiszter, szövegek (HU/EN), makró-bejáratok és generátorok audit', () => {
  const reg = I.createInstanceRegistry();
  eq(reg.errors.length, 0); eq(reg.dups.length, 0); assert(reg.defs.has(ID), 'mine_meadow');
  eq(I.auditInstances(reg, mm.entrances).length, 0, 'minden makró-bejárat célja létezik');
  eq(I.auditInstances(reg, [{ id: 'x', target: 'nincs' }], {}).join(), 'entrance:x,' + [...reg.defs.keys()].map(k => 'generator:' + k).join(','));
  const hu = Object.keys(I.INSTANCE_TEXTS.hu).sort(), en = Object.keys(I.INSTANCE_TEXTS.en).sort();
  eq(hu.join(), en.join()); assert(hu.includes('save.err.instance') && hu.includes(reg.defs.get(ID).nameKey), 'kulcsok');
  for (const d of reg.defs.values()) assert(d.cols >= 12 && d.kind && Object.isFrozen(d), 'def: ' + d.id);
  assert(I.INSTANCE_SECTION.err === 'instance' && I.INSTANCE_SECTION.key === 'ins', 'szekció');
});

test('instance def: a hibás def-ek elutasítva, a regiszter nem dob, duplikátum felülír', () => {
  const ok = { ...base };
  assert(I.validateInstanceDef(ok).ok, 'jó def');
  const bad = [null, [], 'x', 5, { ...ok, id: 'A' }, { ...ok, id: 'a' }, { ...ok, id: 5 }, { ...ok, id: '' }, { ...ok, kind: 'x' }, { ...ok, generator: 'Bad!' }, { ...ok, generator: 5 },
    { ...ok, seed: -1 }, { ...ok, seed: 1.5 }, { ...ok, seed: 2 ** 31 }, { ...ok, seed: '5' }, { ...ok, cols: 11 }, { ...ok, cols: 257 }, { ...ok, cols: 20.5 }, { ...ok, rows: 'x' }, { ...ok, rows: 1000 },
    { ...ok, depth: -1 }, { ...ok, depth: 100 }, { ...ok, depth: 1.5 }, { ...ok, nameKey: '' }, { ...ok, nameKey: 5 }, { ...ok, nameKey: 'x'.repeat(65) }];
  for (const d of bad) assert(!I.validateInstanceDef(d).ok, 'elutasítandó: ' + JSON.stringify(d));
  const reg = I.createInstanceRegistry([ok, { ...ok, cols: 30 }, { ...ok, id: 'rossz id' }, null]);
  eq(reg.defs.size, 1); eq(reg.dups.join(), 'cave_x'); eq(reg.errors.length, 2); eq(reg.defs.get('cave_x').cols, 30);
  eq(I.createInstanceRegistry({ a: ok }).defs.size, 1); eq(I.createInstanceRegistry(7).defs.size, 0);
});

test('instance generátor: a terem determinisztikus, kerete ütköző, a kijárat elérhető, az oszlopok nem szomszédosak (40 seed)', () => {
  let pillars = 0;
  for (let s = 0; s < 40; s++) {
    const def = { ...base, seed: s, cols: 12 + (s * 7) % 45, rows: 12 + (s * 5) % 35 };
    const a = I.buildInstanceWorld(def), b = I.buildInstanceWorld(def);
    assert(a.ok, 'build ' + s + ': ' + a.error);
    assert(Buffer.from(a.world.map.tiles).equals(Buffer.from(b.world.map.tiles)), 'determinisztikus ' + s);
    const { map, cols, rows } = a.world;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (map.tiles[y * cols + x] !== T.STONE) continue;
      pillars++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && map.tiles[(y + dy) * cols + x + dx] === T.STONE) throw new Error('szomszédos oszlopok: ' + s);
    }
  }
  assert(pillars > 20, 'vannak oszlopok: ' + pillars);
  const x = I.buildInstanceWorld({ ...base, seed: 1, cols: 40, rows: 28 }).world, y = I.buildInstanceWorld({ ...base, seed: 2, cols: 40, rows: 28 }).world;
  assert(!Buffer.from(x.map.tiles).equals(Buffer.from(y.map.tiles)), 'más seed -> más terem');
});

test('instance világ: a hibás generátorok elutasítva (generator/gen/map/entry/exit/frame/unreachable), a teljes lánc nem dob', () => {
  eq(I.buildInstanceWorld(base, undefined, {}).error, 'generator'); eq(I.buildInstanceWorld({ ...base, generator: 'constructor' }, undefined, {}).error, 'generator');
  eq(I.buildInstanceWorld(null).error, 'def');
  eq(I.buildInstanceWorld(base, undefined, { room: () => { throw new Error('x'); } }).error, 'gen');
  eq(build(() => null).error, 'map'); eq(build(g => ({ ...g, map: { ...g.map, tiles: new Uint8Array(3) } })).error, 'map');
  eq(build(g => ({ ...g, map: { ...g.map, cols: 300 } })).error, 'map');
  eq(build(g => ({ ...g, entry: { tx: -1, ty: 3 } })).error, 'entry'); eq(build(g => ({ ...g, entry: { tx: 0, ty: 0 } })).error, 'entry');
  eq(build(g => ({ ...g, exit: { tx: 18, ty: 17, w: 3, h: 1 } })).error, 'exit'); eq(build(g => ({ ...g, exit: { tx: 3, ty: 3, w: 0, h: 1 } })).error, 'exit');
  eq(build(g => { g.map.tiles[5] = T.GRASS; return g; }).error, 'frame');
  eq(build(g => { g.map.tiles[g.map.cols * 5 + g.map.cols - 1] = T.ROAD; return g; }).error, 'frame');
  eq(build(g => { for (let x = 2; x < 18; x++) g.map.tiles[16 * g.map.cols + x] = T.WALL; return g; }).error, 'unreachable');
  eq(build(g => { g.map.tiles[g.exit.ty * g.map.cols + g.exit.tx] = T.STONE; return g; }).error, 'exit');
  assert(build(g => g).ok, 'a módosítatlan helyőrző jó');
});

test('instance világ: geometria (távol a világtól), falak = ütköző csempék, az érkezés nincs a kijárat zónájában', () => {
  const r = mk(); assert(!I.instanceWorld(r.ins) && I.instanceTileAt(r.ins, 5, 5) === -1 && !I.instanceSolidAt(r.ins, 5, 5) && I.instanceColliders(r.ins).length === 0, 'inaktív');
  atDoor(r); enter(r, { force: true });
  const w = I.instanceWorld(r.ins), walls = I.instanceColliders(r.ins), rnd = lcg(7);
  assert(w.ox > 3e6 && w.oy > 3e6, 'távol a chunk-világtól és a warp-zsebektől'); eq(walls.length, w.walls.length);
  for (let n = 0; n < 2500; n++) {
    const tx = Math.floor(rnd() * w.cols), ty = Math.floor(rnd() * w.rows), cx = w.ox + tx * 32 + 16, cy = w.oy + ty * 32 + 16;
    eq(collides({ x: cx, y: cy, w: 2, h: 2 }, walls), isSolidId(w.map.tiles[ty * w.cols + tx]), 'fal ↔ csempe ' + tx + ',' + ty);
    eq(I.instanceSolidAt(r.ins, cx, cy), isSolidId(w.map.tiles[ty * w.cols + tx]));
  }
  assert(I.instanceSolidAt(r.ins, w.ox - 5, w.oy + 100) && I.instanceSolidAt(r.ins, w.ox + w.bounds.w + 5, w.oy) && I.instanceTileAt(r.ins, w.ox - 5, w.oy) === -1, 'a térképen kívül ütköző');
  assert(!collides({ ...w.entry, w: 24, h: 24 }, walls) && inside(w, { x: w.entry.x, y: w.entry.y }), 'az érkezés szabad');
  const zone = { x: w.entry.x - 20, y: w.entry.y - 12, w: 40, h: 12 + 28 + 12 };
  assert(!(zone.x < w.exit.x + w.exit.w + 4 && w.exit.x - 4 < zone.x + zone.w && zone.y < w.exit.y + w.exit.h + 4 && w.exit.y - 4 < zone.y + zone.h), 'a kijárat nincs az érkezésnél');
});

test('instance belépés/kilépés: páros átlépés (a társat átvonja), visszatérés a bejárat elé, cooldown, események', () => {
  const r = mk(), evs = []; I.onInstance(r.ins, e => evs.push(e.type + ':' + (e.reason || e.id || '')));
  atDoor(r, 0); r.ps[0].x -= 500; r.ps[0].vx = 99; r.ps[1].kbx = 50; // a társ 500 px-re áll: a bejáratnál álló P2 kezdeményez, a fonal átvonja
  const res = enter(r, { initiator: 1 }); assert(res.ok && res.type === 'enter' && res.id === ID, 'belép: ' + res.reason);
  const w = I.instanceWorld(r.ins);
  eq(I.instanceWhere(r.ins), ID); eq(r.ps[1].x - r.ps[0].x, 48); eq(r.ps[0].y, w.entry.y); eq(r.ps[0].x + 24, w.entry.x);
  eq(r.ps[0].vx + r.ps[1].kbx, 0); assert(inside(w, r.ps[0]) && inside(w, r.ps[1]), 'mindkettő bent');
  eq(r.ins.active.ret.x, RECT.x + RECT.w / 2); eq(r.ins.active.ret.y, RECT.y + RECT.h + 48);
  eq(enter(r).reason, 'busy'); eq(I.exitInstance(r.ins, r.ps).reason, 'cooldown');
  I.stepInstance(r.ins, 0.7); I.stepInstance(r.ins, 0.5); near2(r.ins.active.t, 1.2);
  const ex = I.exitInstance(r.ins, r.ps); assert(ex.ok && ex.type === 'exit' && ex.id === ID, 'kilép');
  eq(I.instanceWhere(r.ins), null); eq(r.ps[0].x, RECT.x + RECT.w / 2 - 24); eq(r.ps[1].x, RECT.x + RECT.w / 2 + 24); eq(r.ps[0].y, RECT.y + RECT.h + 48);
  eq(enter(r).reason, 'cooldown'); I.stepInstance(r.ins, 1); atDoor(r); assert(enter(r).ok, 'újra belép');
  eq(r.ins.stats.entered, 2); eq(r.ins.stats.exited, 1); eq(r.ins.version, 3);
  eq(evs.join(), 'enter:' + ID + ',fail:busy,exit:exit,fail:cooldown,enter:' + ID);
  eq(I.exitInstance(mk().ins, null).reason, 'none');
});
function near2(a, b) { assert(Math.abs(a - b) < 1e-9, a + ' ≈ ' + b); }

test('instance belépés: az elutasítások okai, hibánál semmi nem változik; az egyik játékos átvonja a másikat', () => {
  const r = mk(), snap = () => JSON.stringify([r.ps.map(p => [p.x, p.y]), r.ins.version, !!r.ins.active]);
  atDoor(r); const s0 = snap();
  const bad = (reason, fn) => { const f0 = r.ins.stats.failed; eq(fn().reason, reason); eq(snap(), s0, reason + ': nem változott'); eq(r.ins.stats.failed, f0 + 1); };
  bad('players', () => I.enterInstance(r.ins, [r.ps[0], { x: NaN, y: 0 }], EN)); bad('players', () => I.enterInstance(r.ins, null, EN));
  bad('entrance', () => I.enterInstance(r.ins, r.ps, null)); bad('entrance', () => I.enterInstance(r.ins, r.ps, { ...EN, w: 0 })); bad('entrance', () => I.enterInstance(r.ins, r.ps, { ...EN, id: 5 }));
  bad('target', () => I.enterInstance(r.ins, r.ps, { ...EN, target: 'nincs' }));
  putAt(r.ps, RECT.x - 700, RECT.y); const s1 = snap(); eq(I.enterInstance(r.ins, r.ps, EN).reason, 'reach'); eq(snap(), s1);
  atDoor(r, 0); r.ps[0].x -= 1700; eq(I.enterInstance(r.ins, r.ps, EN, { initiator: 1 }).reason, 'far');
  atDoor(r); eq(I.enterInstance(r.ins, r.ps, EN, { blocked: (p, i) => i === 1 }).reason, 'blocked'); eq(I.enterInstance(r.ins, r.ps, EN, { blocked: () => { throw new Error('x'); } }).reason, 'blocked');
  r.ps[0].x = RECT.x - 900; r.ps[0].y = RECT.y; r.ps[1].x = RECT.x + 10; r.ps[1].y = RECT.y + 10; // a társ áll a bejáratnál, a másik 900 px-re
  eq(I.enterInstance(r.ins, r.ps, EN, { initiator: 0 }).reason, 'reach');
  assert(I.enterInstance(r.ins, r.ps, EN, { initiator: 1 }).ok, 'a bejáratnál álló kezdeményez, a távoli társat átvonja'); assert(inside(I.instanceWorld(r.ins), r.ps[0]), 'a távoli társ bent');
  const g = I.createInstanceManager({ gens: { room: () => null } }); atDoor(r); r.ps[0].vx = 0; eq(I.enterInstance(g, r.ps, EN, { force: true }).reason, 'gen'); eq(g.active, null);
});

test('instance interakció: a valódi interakció-rendszeren át be- és kilép (kijárat csak bent, bejárat csak kint)', () => {
  const r = mk(), sys = createInteractSystem(); let last = null;
  addProvider(sys, I.instanceProvider(r.ins, mm.entrances));
  onInteract(sys, ev => { last = I.handleInstanceEvent(r.ins, r.ps, ev, { entrances: mm.entrances }); });
  const press = [{ x: 0, y: 0, interactPressed: true }, { x: 0, y: 0 }], idle = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  putAt(r.ps, RECT.x - 900, RECT.y); stepInteraction(sys, r.ps, idle, DT); eq(targetOf(sys, 0), null); stepInteraction(sys, r.ps, press, DT); eq(last, null);
  atDoor(r, 24); stepInteraction(sys, r.ps, idle, DT); const t = targetOf(sys, 0);
  assert(t && t.kind === 'instance' && t.action === 'enter' && t.ref.role === 'enter', 'bejárat célpont'); eq(t.key, 'inst:' + EN.id + ':enter');
  stepInteraction(sys, r.ps, press, DT); assert(last && last.ok && last.type === 'enter', 'belépett: ' + (last && last.reason)); eq(I.instanceWhere(r.ins), ID);
  for (let i = 0; i < 20; i++) stepInteraction(sys, r.ps, idle, DT); eq(targetOf(sys, 0), null); eq(targetOf(sys, 1), null);
  const w = I.instanceWorld(r.ins); I.stepInstance(r.ins, 1);
  putAt(r.ps, w.exit.x + w.exit.w / 2, w.exit.y + 8, 20); stepInteraction(sys, r.ps, idle, DT);
  assert(targetOf(sys, 0).action === 'exit' && targetOf(sys, 0).ref.id === ID, 'kijárat célpont');
  stepInteraction(sys, r.ps, [{ x: 0, y: 0 }, { x: 0, y: 0, interactPressed: true }], DT); assert(last.ok && last.type === 'exit', 'kilépett'); eq(I.instanceWhere(r.ins), null);
  eq(I.handleInstanceEvent(r.ins, r.ps, { kind: 'instance', target: { id: ID, role: 'exit' } }).reason, 'none');
  atDoor(r, 0); I.stepInstance(r.ins, 1); assert(enter(r).ok, 'újra bent'); I.stepInstance(r.ins, 1);
  eq(I.handleInstanceEvent(r.ins, r.ps, { kind: 'instance', player: 0, target: { id: 'masik_bany', role: 'exit' } }).reason, 'none'); eq(I.instanceWhere(r.ins), ID); // idegen kijárat nem zár
  const near = []; I.instanceProvider(r.ins, mm.entrances)({ x: RECT.x, y: RECT.y, w: 40, h: 40 }, near, undefined); eq(near.length, 0); // bent a kinti bejárat nem jelölt
  eq(I.handleInstanceEvent(r.ins, r.ps, { kind: 'warp', target: {} }), null); eq(I.handleInstanceEvent(r.ins, r.ps, { kind: 'instance', target: { id: 'x', role: 'dance' } }), null); eq(I.handleInstanceEvent(null, r.ps, {}), null);
});

test('instance + póráz: bent a póráz aktív (a Sorskő-mező nem hat), falak tisztelve, 900 kocka véletlen bemenettel', () => {
  const r = mk(); atDoor(r); enter(r, { force: true });
  const walls = I.instanceColliders(r.ins), w = I.instanceWorld(r.ins), L = { x: 160, y: 128 }; // S077: a bánya járatai szűkek: kisebb L, hogy a póráz megfeszüljön
  const field = sanitizeField({ id: 's', x: 0, y: 0, radius: SORSKO_CONFIG.levels[0] });
  eq(fieldShare(field, r.ps[0], r.ps[1]), 0); const le = fieldEffectiveL(field, r.ps[0], r.ps[1], L); eq(le.x, L.x); eq(le.y, L.y);
  const tether = createTetherSystem({ walls, L, k: 0.5 }), rnd = lcg(11); const dir = [[0, 0], [0, 0]]; let maxS = 0, moved = 0; const x0 = r.ps[0].x;
  for (let f = 0; f < 900; f++) {
    if (f % 45 === 0) for (let i = 0; i < 2; i++) dir[i] = [Math.round(rnd() * 2 - 1), Math.round(rnd() * 2 - 1)];
    stepTetherSystem(tether, r.ps, dir.map(([x, y]) => ({ x, y })), DT);
    for (const p of r.ps) { assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN ' + f); assert(!collides(p, walls), 'falban ' + f); assert(inside(w, p), 'kiesett az instance-ből ' + f); }
    assert(Math.abs(r.ps[0].x - r.ps[1].x) <= L.x + 1 && Math.abs(r.ps[0].y - r.ps[1].y) <= L.y + 1, 'a távolság <= L_eff ' + f);
    maxS = Math.max(maxS, tether.stretch.x, tether.stretch.y); moved = Math.max(moved, Math.abs(r.ps[0].x - x0));
  }
  assert(maxS > 0.95, 'a póráz megfeszült: ' + maxS); assert(moved > 60, 'a játékosok mozogtak');
});

test('instance kilépés: wipe (place:false, force), szabad pont keresése, hibás free hook, hibás bemenet', () => {
  const r = mk(); atDoor(r); enter(r); putAt(r.ps, 77, 88);
  const ex = I.exitInstance(r.ins, r.ps, { place: false, force: true, reason: 'wipe' }); assert(ex.ok, 'cooldown ellenére kilép');
  eq(r.ps[0].x, 77 - 0); eq(r.ps[1].y, 88); eq(r.ins.events.at(-1).reason, 'wipe'); eq(I.instanceWhere(r.ins), null);
  const ret = { x: RECT.x + RECT.w / 2, y: RECT.y + RECT.h + 48 };
  const go = free => { const q = mk(); atDoor(q); enter(q, { force: true }); return { q, res: I.exitInstance(q.ins, q.ps, { force: true, free }) }; };
  const a = go((x, y) => !(Math.abs(x - ret.x) < 60 && Math.abs(y - ret.y) < 20));
  assert(a.res.ok && Math.hypot(a.res.ret.x - ret.x, a.res.ret.y - ret.y) > 0 && Math.hypot(a.res.ret.x - ret.x, a.res.ret.y - ret.y) <= 11 * 23, 'közeli szabad pont');
  eq(a.q.ps[0].x, a.res.ret.x - 24);
  const b = go(() => false); eq(b.res.ret.x, ret.x); eq(b.res.ret.y, ret.y);
  const c = go(() => { throw new Error('x'); }); eq(c.res.ret.x, ret.x);
  const d = mk(); atDoor(d); enter(d, { force: true }); d.ps[1].x = NaN; eq(I.exitInstance(d.ins, d.ps, { force: true }).reason, 'players'); assert(d.ins.active, 'hibánál bent marad');
  eq(I.findFreePair(1, 2, 48, null).x, 1);
});

test('instance: stream-pontok, lépés (hibás dt), konfig, instance-zsák', () => {
  const r = mk(), base = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
  assert(I.instanceStreamPoints(r.ins, base) === base, 'kint: ugyanaz'); atDoor(r); enter(r, { force: true });
  const sp = I.instanceStreamPoints(r.ins, base, []); eq(sp.length, 2); eq(sp[0].x, r.ins.active.ret.x); eq(sp[1].y, r.ins.active.ret.y);
  const t0 = r.ins.active.t; for (const d of [NaN, -1, 0, Infinity, '1', null]) I.stepInstance(r.ins, d); eq(r.ins.active.t, t0); I.stepInstance(r.ins, 30); eq(r.ins.active.t, t0 + 1); I.stepInstance(null, 1);
  eq(r.ins.cool, 0);
  const c = I.sanitizeInstanceConfig({ pairGap: 10, cooldown: -1, reach: NaN, bogus: 1 }); eq(c.pairGap, 10); eq(c.cooldown, I.INSTANCE_CONFIG.cooldown); eq(c.reach, I.INSTANCE_CONFIG.reach); assert(!('bogus' in c) && Object.isFrozen(c), 'konfig');
  eq(I.instanceData(r.ins, 'nincs'), null); const z = I.instanceData(r.ins, ID); z.n = 1; assert(I.instanceData(r.ins, ID) === z, 'ugyanaz a zsák');
});

test('instance mentés: állapot körút, ATOMI visszatöltés a hibás állapotokra, ismeretlen adat kimarad', () => {
  const r = mk(); atDoor(r); enter(r, { force: true }); I.stepInstance(r.ins, 2.5); I.instanceData(r.ins, ID).cleared = [3, 5];
  const st = JSON.parse(JSON.stringify(I.instanceState(r.ins))), fresh = I.createInstanceManager();
  assert(I.restoreInstances(fresh, st), 'visszatölt'); eq(JSON.stringify(I.instanceState(fresh)), JSON.stringify(st)); eq(I.instanceWhere(fresh), ID); eq(fresh.version, 1);
  const s0 = JSON.stringify(I.instanceState(fresh)), v0 = fresh.version;
  const A = st.active, big = { x: 'x'.repeat(70000) };
  const bad = [null, 5, [], {}, { v: 2 }, { v: 1, active: 5 }, { v: 1, active: { ...A, id: 'nincs' } }, { v: 1, active: { ...A, id: 5 } }, { v: 1, active: { ...A, entrance: '' } }, { v: 1, active: { ...A, entrance: 'x'.repeat(65) } },
    { v: 1, active: { ...A, entrance: 5 } }, { v: 1, active: { ...A, ret: null } }, { v: 1, active: { ...A, ret: { x: NaN, y: 0 } } }, { v: 1, active: { ...A, ret: { x: 0, y: 1e9 } } },
    { v: 1, active: { ...A, t: -1 } }, { v: 1, active: { ...A, t: 'x' } }, { v: 1, active: null, data: [] }, { v: 1, active: null, data: 'x' }, { v: 1, active: null, data: { [ID]: 5 } },
    { v: 1, active: null, data: { [ID]: [] } }, { v: 1, active: null, data: { [ID]: big } }];
  bad.forEach((b, i) => { assert(!I.restoreInstances(fresh, b), 'elutasítandó #' + i); eq(JSON.stringify(I.instanceState(fresh)), s0, 'érintetlen #' + i); eq(fresh.version, v0); });
  assert(!I.restoreInstances(I.createInstanceManager({ gens: { room: () => null } }), st), 'generálási hiba -> hamis'); assert(!I.restoreInstances(null, st), 'nincs kezelő');
  const old = I.createInstanceManager(); assert(I.restoreInstances(old, { v: 1, active: null, data: { regi_bany: { a: 1 }, [ID]: { ok: true } } }), 'ismeretlen id-t kihagyja'); eq(JSON.stringify(I.instanceState(old).data), JSON.stringify({ [ID]: { ok: true } }));
  eq(I.instanceWhere(old), null); eq(I.registerInstanceSave([]), true); const arr = []; I.registerInstanceSave(arr); eq(I.registerInstanceSave(arr), false); eq(arr.length, 1); eq(I.registerInstanceSave(null), false);
});

test('instance mentés: a valódi game-save szekción át (körút, régi mentés + reconcile, atomi rollback, F2 export-szöveg)', () => {
  const added = I.registerInstanceSave(SECTIONS);
  try {
    const ins = I.createInstanceManager(), ps = [createPlayer(0, 100, 200), createPlayer(1, 170, 200)];
    const ctx = { players: ps, clock: createGameClock(), sorsko: createSorsko(sanitizeField({ id: 's', x: 0, y: 0, radius: SORSKO_CONFIG.levels[0] })), seed: 12014, instances: ins };
    const s1 = JSON.parse(JSON.stringify(captureSave(ctx, 0))); eq(s1.ins.active, null);
    atDoor({ ps }); enter({ ins, ps }, { force: true }); I.instanceData(ins, ID).k = 7;
    const s2 = JSON.parse(JSON.stringify(captureSave(ctx, 0))); eq(s2.ins.active.id, ID); assert(s2.players[0].x > 3e6, 'a pozíciók instance-koordináták'); eq(s2.ins.data[ID].k, 7);
    I.exitInstance(ins, ps, { force: true }); eq(I.instanceWhere(ins), null);
    assert(applySave(ctx, s2).ok, 'betölt az instance-be'); eq(I.instanceWhere(ins), ID); eq(ps[0].x, s2.players[0].x); eq(I.instanceData(ins, ID).k, 7);
    assert(applySave(ctx, s1).ok, 'betölt kintre'); eq(I.instanceWhere(ins), null); eq(ps[0].x, 100); eq(ps[1].y, 200);
    applySave(ctx, s2); const noIns = { ...s1 }; delete noIns.ins; // régi (S076 előtti) mentés bent állva: a szekció érintetlen, a reconcile hozza rendbe
    assert(applySave(ctx, noIns).ok, 'régi mentés betölt'); assert(I.instanceWhere(ins), 'a hiányzó szekció érintetlen'); assert(I.reconcileInstance(ins, ps), 'reconcile kilép'); eq(I.instanceWhere(ins), null); eq(I.reconcileInstance(ins, ps), false);
    applySave(ctx, s2); const before = JSON.stringify(captureSave(ctx, 0)), badSave = JSON.parse(JSON.stringify(s1)); badSave.ins = { v: 1, active: { ...s2.ins.active, id: 'nincs' }, data: {} };
    const res = applySave(ctx, badSave); assert(!res.ok && res.error === 'instance', 'hibás szekció: ' + res.error); eq(JSON.stringify(captureSave(ctx, 0)), before, 'atomi rollback');
    badSave.ins = 5; eq(applySave(ctx, badSave).error, 'instance'); eq(JSON.stringify(captureSave(ctx, 0)), before);
  } finally { if (added) SECTIONS.splice(SECTIONS.indexOf(I.INSTANCE_SECTION), 1); }
  assert(!SECTIONS.includes(I.INSTANCE_SECTION), 'a teszt visszaállította a szekció-listát');
});

test('instance reconcile: bent álló pár érintetlen, kintre került pár -> az instance lezárul; kint nincs teendő', () => {
  const r = mk(); eq(I.reconcileInstance(r.ins, r.ps), false); atDoor(r); enter(r, { force: true }); eq(I.reconcileInstance(r.ins, r.ps), false); eq(I.instanceWhere(r.ins), ID);
  r.ps[1].x = 5; r.ps[1].y = 5; assert(I.reconcileInstance(r.ins, r.ps), 'a társ kint van'); eq(I.instanceWhere(r.ins), null); eq(r.ps[1].x, 5);
  eq(I.reconcileInstance(null, r.ps), false); eq(I.reconcileInstance(r.ins, null), false);
});

test('instance fuzz: 4000 véletlen művelet (belép/kilép/lépés/mentés-körút), invariánsok és determinizmus', () => {
  const run = seed => {
    const rnd = lcg(seed), r = mk(), log = []; atDoor(r);
    for (let n = 0; n < 4000; n++) {
      const v0 = r.ins.version, k = rnd(), w = I.instanceWorld(r.ins);
      if (k < 0.2) { atDoor(r, rnd() * 1800); const res = enter(r, { initiator: rnd() < 0.5 ? 1 : 0, force: rnd() < 0.3 }); if (res.ok) assert(inside(I.instanceWorld(r.ins), r.ps[0]) && inside(I.instanceWorld(r.ins), r.ps[1]), 'bent'); }
      else if (k < 0.4) { const res = I.exitInstance(r.ins, r.ps, { force: rnd() < 0.5, place: rnd() < 0.8, free: rnd() < 0.5 ? (x, y) => ((x + y) | 0) % 3 !== 0 : undefined }); if (res.ok && res.ret && r.ps[0].x === res.ret.x - 24) assert(!w || !inside(w, r.ps[0]), 'kint'); }
      else if (k < 0.8) I.stepInstance(r.ins, rnd() * 0.5);
      else if (k < 0.9) { const f = I.createInstanceManager(); assert(I.restoreInstances(f, JSON.parse(JSON.stringify(I.instanceState(r.ins)))), 'körút'); eq(JSON.stringify(I.instanceState(f)), JSON.stringify(I.instanceState(r.ins))); }
      else I.instanceData(r.ins, ID)['k' + (n % 5)] = n;
      assert(r.ins.version >= v0, 'a verzió nem csökken'); if (r.ins.active) assert(I.instanceWorld(r.ins), 'aktív instance-nek van világa');
      for (const p of r.ps) assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN');
      log.push(r.ins.active ? 1 : 0);
    }
    return log.join('') + JSON.stringify(I.instanceState(r.ins)) + r.ins.stats.entered + ':' + r.ins.stats.exited;
  };
  eq(run(3), run(3), 'determinisztikus'); assert(run(3) !== run(4), 'más seed más futás');
});
