// Ellenség-AI és útkeresés tesztjei (S067). Importja: test-index.js, game-pathfind.js, game-enemy.js, game-health.js, game-player.js, world-*.
import { test, assert, eq, near } from './test-index.js';
import { PATH_CONFIG, findPath, pathPoints, segmentBlocked, hasLineOfSight, smoothPath, createBlocker } from './game-pathfind.js';
import {
  ENEMY_STATES, ENEMY_CONFIG, ENEMY_DEFS, ENEMY_TEXTS, validateEnemyDef, createEnemyRegistry, getEnemyDef, createEnemySystem, onEnemy,
  spawnEnemy, removeEnemy, enemyView, enemiesNear, damageEnemy, pushEnemy, stepEnemies,
} from './game-enemy.js';
import { createPlayerHealths } from './game-health.js';
import { createPlayer } from './game-player.js';
import { collides } from './game-collision.js';
import { createWorldStream, warmStream, streamWalls, getStreamTile, findOpenSpot, WORLD_SEED } from './world-stream.js';
import { isSolidId } from './world-tiles.js';

const T = 32, DT = 1 / 60;
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const R = (x, y, w, h) => ({ x, y, w, h });
const frame = (w, h) => [R(0, 0, w, T), R(0, h - T, w, T), R(0, 0, T, h), R(w - T, 0, T, h)];
const grid = (rows) => (tx, ty) => ty < 0 || ty >= rows.length || tx < 0 || tx >= rows[0].length || rows[ty][tx] === '#';
const mkSys = (defs, seed = 7) => createEnemySystem({ reg: createEnemyRegistry(defs || ENEMY_DEFS), seed });
const pl = (i, x, y) => createPlayer(i, x, y);
function run(sys, players, env, secs, fn) {
  const evs = [];
  for (let i = 0; i < Math.round(secs / DT); i++) { const e = stepEnemies(sys, players, DT, env); evs.push(...e); if (fn && fn(i, e) === false) break; }
  return evs;
}
const types = evs => evs.map(e => e.type);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('pathfind: egyenes, szomszédos lépések, azonos tile, hibás bemenet', () => {
  const r = findPath({ from: { tx: 0, ty: 0 }, to: { tx: 5, ty: 0 }, blocked: () => false });
  assert(r.ok && !r.partial, 'ok'); eq(r.path.length, 6); eq(r.path[0].tx, 0); eq(r.path[5].tx, 5);
  for (let i = 1; i < r.path.length; i++) assert(Math.abs(r.path[i].tx - r.path[i - 1].tx) <= 1 && Math.abs(r.path[i].ty - r.path[i - 1].ty) <= 1, 'szomszéd');
  const d = findPath({ from: { tx: 0, ty: 0 }, to: { tx: 4, ty: 4 }, blocked: () => false });
  eq(d.path.length, 5, 'átló');
  eq(findPath({ from: { tx: 2, ty: 2 }, to: { tx: 2, ty: 2 }, blocked: () => true }).path.length, 1);
  for (const bad of [null, {}, { from: { tx: 0, ty: 0 }, to: { tx: 1, ty: 1 } }, { from: { tx: 0.5, ty: 0 }, to: { tx: 1, ty: 1 }, blocked: () => false },
    { from: { tx: NaN, ty: 0 }, to: { tx: 1, ty: 1 }, blocked: () => false }, { from: { tx: 0, ty: 0 }, to: null, blocked: () => false }]) {
    const x = findPath(bad); assert(!x.ok && x.reason === 'bad-input', 'bad ' + JSON.stringify(bad));
  }
  assert(findPath({ from: { tx: 0, ty: 0 }, to: { tx: 3, ty: 0 }, blocked: () => { throw new Error('x'); } }).reason === 'no-path', 'kivétel = blokkolt');
  eq(pathPoints(r.path, 32)[0].x, 48); eq(pathPoints(null).length, 0);
});

test('pathfind: fal kerülése, nincs sarok-vágás, elérhetetlen cél, csomópont-korlát', () => {
  const b = grid(['.....', '.###.', '.....']);
  const r = findPath({ from: { tx: 0, ty: 1 }, to: { tx: 4, ty: 1 }, blocked: b });
  assert(r.ok && !r.partial); for (const t of r.path) assert(!b(t.tx, t.ty), 'járható');
  // átlós rés két sarokkal: nem lehet átvágni
  const c = grid(['.#', '#.']);
  eq(findPath({ from: { tx: 0, ty: 0 }, to: { tx: 1, ty: 1 }, blocked: c }).reason, 'no-path', 'sarok-vágás tiltva');
  const e = grid(['..#..', '..#..', '..#..']); // elzárt cél: legközelebbi pontig
  const p = findPath({ from: { tx: 0, ty: 1 }, to: { tx: 4, ty: 1 }, blocked: e });
  assert(p.ok && p.partial, 'partial'); eq(p.path[p.path.length - 1].tx, 1);
  const z = grid(['.#.', '###', '...']); // a kezdő tile zárt
  eq(findPath({ from: { tx: 0, ty: 0 }, to: { tx: 2, ty: 2 }, blocked: z }).reason, 'no-path');
  const open = () => false, cap = findPath({ from: { tx: 0, ty: 0 }, to: { tx: 80, ty: 0 }, blocked: open, maxNodes: 20 });
  assert(cap.ok && cap.partial && cap.nodes <= 20, 'korlát'); assert(cap.path.length < 81);
  const lng = findPath({ from: { tx: 0, ty: 0 }, to: { tx: 80, ty: 0 }, blocked: open, maxLen: 10, maxNodes: 5000 });
  eq(lng.path.length, 10); assert(lng.partial);
  const q1 = findPath({ from: { tx: 0, ty: 0 }, to: { tx: 30, ty: 9 }, blocked: open }), q2 = findPath({ from: { tx: 0, ty: 0 }, to: { tx: 30, ty: 9 }, blocked: open });
  eq(JSON.stringify(q1.path), JSON.stringify(q2.path), 'determinisztikus');
});

test('pathfind: szakasz-vágás, rálátás, útvonal-húzás', () => {
  const w = [R(100, 0, 20, 100)];
  assert(segmentBlocked(0, 50, 200, 50, w)); assert(!segmentBlocked(0, 150, 200, 150, w)); assert(!segmentBlocked(0, 50, 90, 50, w));
  assert(segmentBlocked(0, 50, 95, 50, w, 6), 'pad'); assert(segmentBlocked(110, -50, 110, 150, w), 'függőleges');
  assert(!segmentBlocked(NaN, 0, 1, 1, w) && !segmentBlocked(0, 0, 1, 1, null));
  const blk = createBlocker({ rects: w, tile: 32, cx: 100, cy: 50, radius: 8 });
  assert(hasLineOfSight(0, 150, 200, 150, blk.solidPx) && !hasLineOfSight(0, 50, 200, 50, blk.solidPx));
  assert(!hasLineOfSight(0, 0, 1, 1, null));
  const clear = (a, b, c, d) => !segmentBlocked(a, b, c, d, w);
  eq(smoothPath({ x: 0, y: 150 }, [{ x: 50, y: 150 }, { x: 100, y: 150 }, { x: 150, y: 150 }, { x: 200, y: 150 }], clear).length, 1, 'egyenes -> 1 pont');
  const s = smoothPath({ x: 0, y: 50 }, [{ x: 50, y: 130 }, { x: 150, y: 130 }, { x: 200, y: 50 }], clear);
  assert(s.length === 2 && s[0].y === 130 && s[1].x === 200, 'kanyar megmarad'); eq(smoothPath({ x: 0, y: 0 }, [], clear).length, 0);
});

test('pathfind: blokkoló (sugár, téglalap-előszűrő, tile-ütközés, gyorsítótár)', () => {
  const b = createBlocker({ rects: [R(64, 64, 32, 32), R(5000, 5000, 32, 32)], solidTile: (x, y) => x === 10 && y === 10, tile: 32, cx: 0, cy: 0, radius: 5 });
  assert(b(2, 2) && !b(0, 0) && !b(3, 3) && b(10, 10) === true, 'rect + out-of-radius'); assert(b(6, 0), 'sugáron kívül zárt');
  assert(!b(-5, -5) && b(-6, -5)); const n = b.size(); b(2, 2); eq(b.size(), n, 'gyorsítótár');
  assert(createBlocker({ solidTile: () => { throw new Error('x'); }, cx: 0, cy: 0 })(0, 0) === true);
  assert(createBlocker({ rects: [R(0, 0, 32, 32)], cx: 0, cy: 0, radius: 3 })(1, 0) === false, 'érintés nem átfedés');
  assert(createBlocker(undefined)(0, 0) === false); eq(PATH_CONFIG.tile, 32);
});

test('enemy: definíció-validáció, regiszter, szövegek HU/EN', () => {
  const g = validateEnemyDef({ id: 'wolf' }); assert(g.ok); eq(g.enemy.hp, 30); eq(g.enemy.loseSight, g.enemy.sight * 1.6); eq(g.enemy.nameKey, 'enemy.wolf'); assert(Object.isFrozen(g.enemy));
  const bad = [null, 5, {}, { id: 'X' }, { id: 'a' }, { id: 'ok', hp: 0 }, { id: 'ok', hp: NaN }, { id: 'ok', hp: '5' }, { id: 'ok', speed: 5 }, { id: 'ok', size: 31 },
    { id: 'ok', sight: 0 }, { id: 'ok', sight: 6, loseSight: 3 }, { id: 'ok', damage: null }, { id: 'ok', damage: { amount: -1 } }, { id: 'ok', damage: { amount: 1, type: 'laser' } },
    { id: 'ok', damage: { amount: 1, type: 'constructor' } }, { id: 'ok', resist: 3 }, { id: 'ok', resist: { fire: NaN } }, { id: 'ok', leash: 1 }, { id: 'ok', fleeHp: 1 }, { id: 'ok', windup: -1 }];
  for (const d of bad) assert(!validateEnemyDef(d).ok, 'hibás: ' + JSON.stringify(d));
  eq(validateEnemyDef({ id: 'ok', resist: { fire: 5 } }).enemy.resist.fire, 1, 'szorítás');
  const reg = createEnemyRegistry([{ id: 'aa' }, { id: 'aa', hp: 5 }, { id: 'BAD' }, null]);
  eq(reg.enemies.size, 1); eq(reg.dups[0], 'aa'); eq(reg.errors.length, 2); eq(getEnemyDef(reg, 'aa').hp, 5); eq(getEnemyDef(reg, 'constructor'), null); eq(getEnemyDef(null, 'aa'), null);
  const live = createEnemyRegistry(); eq(live.errors.length, 0); assert(live.enemies.size >= 1);
  const hu = Object.keys(ENEMY_TEXTS.hu).sort(), en = Object.keys(ENEMY_TEXTS.en).sort(); eq(hu.join(), en.join());
  for (const d of live.enemies.values()) assert(hu.includes(d.nameKey), 'szöveg: ' + d.nameKey);
  eq(ENEMY_STATES.length, 6); eq(ENEMY_CONFIG.tile, 32);
});

test('enemy: létrehozás, plafon, eltávolítás, nézet, közelség', () => {
  const sys = mkSys();
  eq(spawnEnemy(sys, 'nincs', 0, 0), null); eq(spawnEnemy(sys, 'grunt', NaN, 0), null); eq(spawnEnemy(sys, 'grunt', 0, Infinity), null); eq(spawnEnemy(null, 'grunt', 0, 0), null);
  const a = spawnEnemy(sys, 'grunt', 100, 100), b = spawnEnemy(sys, 'grunt', 400, 100); assert(a && b && a.id !== b.id); eq(a.state, 'idle'); eq(a.hp, 30);
  const v = enemyView(a); eq(v.hpRatio, 1); eq(v.state, 'idle'); eq(v.frozen, false);
  eq(enemiesNear(sys, { x: 100, y: 100 }, 50).length, 1); eq(enemiesNear(sys, { x: 250, y: 100 }, 400).length, 2); eq(enemiesNear(sys, null, 5).length, 0); eq(enemiesNear(sys, { x: 0, y: 0 }, NaN).length, 0);
  assert(removeEnemy(sys, a) && !removeEnemy(sys, a)); eq(sys.list.length, 1);
  const small = createEnemySystem({ reg: sys.reg, cfg: { maxEnemies: 2 } }); spawnEnemy(small, 'grunt', 0, 0); spawnEnemy(small, 'grunt', 0, 0); eq(spawnEnemy(small, 'grunt', 0, 0), null);
  const got = []; const off = onEnemy(sys, ev => got.push(ev.type)); spawnEnemy(sys, 'grunt', 5, 5); off(); spawnEnemy(sys, 'grunt', 6, 6); eq(got.join(), 'spawn');
  onEnemy(sys, () => { throw new Error('x'); }); spawnEnemy(sys, 'grunt', 7, 7); assert(sys.lastError);
});

test('enemy: őrjárat – idle/patrol váltás, a körzetben marad, falba nem megy', () => {
  const walls = [...frame(1200, 900), R(700, 400, 96, 96)], sys = mkSys(); const e = spawnEnemy(sys, 'grunt', 600, 450);
  const seen = new Set(); let maxD = 0, inWall = 0;
  run(sys, [pl(0, 5000, 5000), pl(1, 5000, 5000)], { walls }, 90, () => { seen.add(e.state); maxD = Math.max(maxD, dist(e, e.home)); if (collides(e, walls)) inWall++; });
  assert(seen.has('patrol') && seen.has('idle'), 'állapotok: ' + [...seen]); eq(inWall, 0, 'falban');
  assert(maxD <= e.def.patrol * T + 10, 'körzet ' + maxD); assert(maxD > 20, 'tényleg mozgott'); eq(sys.lastError, null);
  const still = createEnemyRegistry([{ id: 'stay', patrol: 0 }]), s2 = createEnemySystem({ reg: still }), st = spawnEnemy(s2, 'stay', 50, 50);
  run(s2, [], { walls: [] }, 20); eq(st.x, 50); eq(st.state, 'idle');
});

test('enemy: aggro – látótáv, rálátás, halott játékos', () => {
  const sys = mkSys(), e = spawnEnemy(sys, 'grunt', 500, 400), env = { walls: [] };
  run(sys, [pl(0, 650, 400), pl(1, 5000, 5000)], env, 0.6); eq(e.state, 'chase', 'látótávon belül'); eq(e.target, 0);
  const s2 = mkSys(), f = spawnEnemy(s2, 'grunt', 500, 400); run(s2, [pl(0, 500 + 260, 400)], env, 1.0); assert(f.state !== 'chase', 'távolon kívül');
  const s3 = mkSys(), g = spawnEnemy(s3, 'grunt', 500, 400); run(s3, [pl(0, 600, 400)], { walls: [R(540, 300, 20, 200)] }, 1.5); assert(g.state !== 'chase', 'fal takar');
  const s4 = mkSys(), h = spawnEnemy(s4, 'grunt', 500, 400), dead = pl(0, 560, 400); dead.dead = true; run(s4, [dead], env, 1); assert(h.state !== 'chase', 'halottra nem');
  const s5 = mkSys(), k = spawnEnemy(s5, 'grunt', 500, 400); run(s5, [pl(0, NaN, 3), null, undefined], env, 1); assert(k.state !== 'chase'); eq(s5.lastError, null);
});

test('enemy: üldözés akadály körül (A*), eléri a támadási távot', () => {
  const sys = mkSys(), e = spawnEnemy(sys, 'grunt', 200, 150), p = pl(0, 300, 150), walls = [R(240, 120, 32, 64)];
  assert(!segmentBlocked(200, 150, 300, 150, []) && segmentBlocked(200, 150, 300, 150, walls));
  damageEnemy(sys, e, 1, { player: 0 }); eq(e.state, 'chase');
  let attackedAt = -1; const evs = run(sys, [p], { walls }, 10, (i, ev) => { if (ev.some(x => x.type === 'attack')) { attackedAt = i * DT; return false; } });
  assert(attackedAt > 0 && attackedAt < 6, 'elérte: ' + attackedAt + ' ' + e.state); assert(sys.stats.repaths >= 1, 'A* futott'); eq(collides(e, walls), false);
  assert(types(evs).includes('state')); eq(sys.lastError, null);
});

test('enemy: támadás – felütés, sebzés a játékosra, hűtés, mellé', () => {
  const sys = mkSys(), e = spawnEnemy(sys, 'grunt', 500, 400), p = pl(0, 535, 400), q = pl(1, 5000, 5000), hs = createPlayerHealths([p, q]);
  const hits = []; run(sys, [p, q], { walls: [], healths: hs }, 12, (i, ev) => { for (const x of ev) if (x.type === 'hit') hits.push(i * DT); });
  assert(hits.length >= 5 && hits.length <= 8, 'találatok: ' + hits.length); assert(hits[0] >= 0.35 && hits[0] < 1, 'felütés ' + hits[0]);
  for (let i = 1; i < hits.length; i++) assert(hits[i] - hits[i - 1] >= e.def.cooldown - 0.02, 'hűtés');
  near(hs[0].hp, 100 - 6 * hits.length, 1e-6, 'HP'); eq(hs[1].hp, 100); eq(sys.stats.hits, hits.length);
  const s2 = mkSys(), f = spawnEnemy(s2, 'grunt', 500, 400), p2 = pl(0, 535, 400), ev2 = [];
  run(s2, [p2], { walls: [] }, 0.5, (i, ev) => { ev2.push(...ev); if (ev.some(x => x.type === 'attack')) p2.x = 900; });
  run(s2, [p2], { walls: [] }, 0.6, (i, ev) => { ev2.push(...ev); }); assert(types(ev2).includes('miss') && !types(ev2).includes('hit'), 'mellé');
  const s3 = mkSys(), h = spawnEnemy(s3, 'grunt', 500, 400), p3 = pl(0, 535, 400), calls = [];
  run(s3, [p3], { walls: [], hurt: (i, d, en) => { calls.push([i, d.amount, d.tag, d.knockback.x > 0, en === h]); return null; } }, 1); eq(calls[0].join(), '0,6,melee,true,true', 'hurt hook');
  const s4 = mkSys(), k = spawnEnemy(s4, 'grunt', 500, 400), p4 = pl(0, 535, 400); run(s4, [p4], { walls: [], hurt: () => { throw new Error('x'); } }, 1); assert(s4.lastError && k.state !== 'dead');
});

test('enemy: célvesztés, visszahúzódás, zárolás; pórázhossz-szerű hűség (leash)', () => {
  const sys = mkSys(), e = spawnEnemy(sys, 'grunt', 500, 400), p = pl(0, 640, 400), env = { walls: [] };
  run(sys, [p], env, 0.5); eq(e.state, 'chase'); e.x = 580; p.x = 5000; run(sys, [p], env, 0.1); eq(e.state, 'retreat', 'cél elvesztve');
  p.x = 600; p.y = 400; const st = []; run(sys, [p], env, 2.5, () => st.push(e.state)); assert(!st.includes('chase'), 'zárolás alatt nincs aggro');
  p.x = 5000; run(sys, [p], env, 6); assert(e.state === 'idle' || e.state === 'patrol', 'hazaért: ' + e.state); assert(dist(e, e.home) < 40 + e.def.patrol * T, 'otthon');
  const L = createEnemyRegistry([{ id: 'tether', sight: 40, loseSight: 80, leash: 3, speed: 70, patrol: 0 }]), s2 = createEnemySystem({ reg: L }), w = spawnEnemy(s2, 'tether', 300, 300);
  let maxD = 0, went = false; run(s2, [pl(0, 900, 300)], { walls: [] }, 6, (i, ev) => { maxD = Math.max(maxD, dist(w, w.home)); if (w.state === 'retreat') went = true; });
  assert(went, 'visszahúzódott'); assert(maxD <= 3 * T + 8, 'leash ' + maxD);
});

test('enemy: fagyott ellenfél áll és felolvadva folytatja', () => {
  const sys = mkSys(), e = spawnEnemy(sys, 'grunt', 500, 400), p = pl(0, 660, 400), env = { walls: [] };
  e.frozen = 2; run(sys, [p], env, 1.5); eq(e.x, 500); eq(e.state, 'idle'); eq(e.vx, 0);
  e.frozen = 0; run(sys, [p], env, 0.5); eq(e.state, 'chase'); run(sys, [p], env, 1); assert(e.x > 500, 'mozog');
  const f = spawnEnemy(sys, 'grunt', 100, 100); f.frozen = 1; damageEnemy(sys, f, 5, { player: 0 }); run(sys, [pl(0, 5000, 5000)], env, 0.2); eq(f.x, 100);
});

test('enemy: sebzés, halál, gyengeség, aggro sebzésre, eltolás', () => {
  const sys = mkSys(), e = spawnEnemy(sys, 'grunt', 100, 100); eq(damageEnemy(sys, e, 10, { player: 1 }), false); eq(e.hp, 20); eq(e.state, 'chase'); eq(e.target, 1);
  eq(damageEnemy(sys, e, 5, { burn: true }), false); eq(e.hp, 15); eq(damageEnemy(sys, e, 5, 'x'), false); eq(damageEnemy(sys, e, NaN, {}), false); eq(damageEnemy(sys, null, 5, {}), false);
  const evs = []; onEnemy(sys, ev => evs.push(ev)); eq(damageEnemy(sys, e, 99, { player: 0 }), true); stepEnemies(sys, [], DT, {}); eq(sys.list.length, 0);
  const d = evs.find(x => x.type === 'died'); assert(d && d.killer === 0 && d.e === e); eq(sys.stats.killed, 1);
  const reg = createEnemyRegistry([{ id: 'fireproof', resist: { fire: 1, physical: -1 } }]), s2 = createEnemySystem({ reg }), f = spawnEnemy(s2, 'fireproof', 0, 0);
  damageEnemy(s2, f, 10, { burn: true, player: 0 }); eq(f.hp, 30); eq(f.state, 'idle', 'immunitás: nincs aggro'); damageEnemy(s2, f, 5, { player: 0 }); eq(f.hp, 20, 'gyengeség x2');
  const w = [R(200, 0, 32, 400)], g = spawnEnemy(sys, 'grunt', 150, 100);
  near(pushEnemy(g, 1, 0, 100, w), 200 - g.w / 2 - 150, 1e-6, 'falig'); near(g.x + g.w / 2, 200, 1e-6);
  eq(pushEnemy(g, 0, 0, 10, w), 0); eq(pushEnemy(g, 1, 0, NaN, w), 0); eq(pushEnemy(null, 1, 0, 5, w), 0); eq(pushEnemy(g, 1, 0, 5, null), 0);
});

test('enemy: elérhetetlen célpont – feladja, a keresés korlátos', () => {
  const room = [R(600, 300, 200, 32), R(600, 500, 200, 32), R(600, 300, 32, 232), R(768, 300, 32, 232)], walls = [...frame(1400, 900), ...room];
  const sys = mkSys(), e = spawnEnemy(sys, 'grunt', 400, 450), p = pl(0, 700, 420); damageEnemy(sys, e, 1, { player: 0 }); eq(e.state, 'chase');
  const st = new Set(); run(sys, [p], { walls }, 20, () => { st.add(e.state); }); assert(st.has('retreat'), 'feladta: ' + [...st]); assert(sys.stats.repaths <= 25, 'repaths ' + sys.stats.repaths);
  eq(collides(e, walls), false); eq(sys.lastError, null);
});

test('enemy: hibás bemenet – dt, rendszer, játékos-lista, környezet', () => {
  const sys = mkSys(), e = spawnEnemy(sys, 'grunt', 100, 100);
  for (const dt of [NaN, -1, 0, Infinity, 'x', null]) eq(stepEnemies(sys, [], dt, {}).length, 0);
  eq(stepEnemies(null, [], DT, {}).length, 0); eq(stepEnemies({}, [], DT, {}).length, 0);
  stepEnemies(sys, null, DT, null); stepEnemies(sys, [], DT, { walls: 5 }); stepEnemies(sys, 'x', DT, { walls: [] }); eq(sys.lastError, null);
  stepEnemies(sys, [pl(0, 100, 100)], 5, { walls: [] }); assert(Number.isFinite(e.x) && sys.time <= ENEMY_CONFIG.maxDt * 4 + 1e-9, 'nagy dt vágva');
});

function fuzzRun(seed) {
  const rnd = lcg(seed), W = 1600, H = 1200, walls = frame(W, H);
  for (let i = 0; i < 14; i++) walls.push(R(100 + Math.floor(rnd() * 40) * 32, 100 + Math.floor(rnd() * 28) * 32, 32 * (1 + Math.floor(rnd() * 4)), 32 * (1 + Math.floor(rnd() * 3))));
  const sys = mkSys(null, seed), ps = [pl(0, 800, 600), pl(1, 820, 600)], hs = createPlayerHealths(ps);
  for (let i = 0, tries = 0; i < 6 && tries < 200; tries++) { const x = 100 + rnd() * 1400, y = 100 + rnd() * 1000; if (!collides({ x, y, w: 30, h: 30 }, walls) && spawnEnemy(sys, 'grunt', x, y)) i++; }
  const v = [{ x: 0, y: 0 }, { x: 0, y: 0 }], fails = [];
  for (let f = 0; f < 3000; f++) {
    ps.forEach((p, i) => { if (f % 40 === 0) { const a = rnd() * 6.283; v[i] = { x: Math.cos(a) * 100, y: Math.sin(a) * 100 }; } const nx = p.x + v[i].x * DT, ny = p.y + v[i].y * DT; if (!collides({ x: nx, y: ny, w: p.w, h: p.h }, walls)) { p.x = nx; p.y = ny; } else v[i] = { x: -v[i].x, y: -v[i].y }; });
    if (f % 300 === 150) for (const e of sys.list) damageEnemy(sys, e, 4, { player: f % 2 });
    stepEnemies(sys, ps, DT, { walls, healths: hs });
    for (const e of sys.list) { if (![e.x, e.y, e.vx, e.vy, e.hp].every(Number.isFinite)) fails.push('nan'); if (collides(e, walls)) fails.push('fal'); if (!ENEMY_STATES.includes(e.state)) fails.push('állapot'); if (e.hp > e.hpMax + 1e-9 || e.hp < 0) fails.push('hp'); }
  }
  return { fails, sig: sys.list.map(e => `${e.id}:${e.x.toFixed(3)},${e.y.toFixed(3)},${e.state},${e.hp.toFixed(2)}`).join('|') + '#' + JSON.stringify(sys.stats), err: sys.lastError, hp: hs.map(h => h.hp) };
}
test('enemy: fuzz 3000 kocka – invariánsok és determinizmus', () => {
  for (const seed of [11, 12, 13]) {
    const a = fuzzRun(seed), b = fuzzRun(seed); eq(a.fails.length, 0, 'seed ' + seed + ': ' + a.fails.slice(0, 3)); eq(a.err, null); eq(a.sig, b.sig, 'determinisztikus'); eq(a.hp.join(), b.hp.join());
  }
});

test('enemy: smoke 600 kocka a valódi chunk-világon (falak + tile-ütközés)', () => {
  const ws = createWorldStream(WORLD_SEED), spot = findOpenSpot(WORLD_SEED, 0, 0); warmStream(ws, [spot]);
  const walls = streamWalls(ws), solidTile = (tx, ty) => { const id = getStreamTile(ws, tx, ty); return id < 0 || isSolidId(id); };
  const sys = mkSys(null, 5), ps = [pl(0, spot.x, spot.y), pl(1, spot.x + 30, spot.y)], hs = createPlayerHealths(ps), made = [];
  for (let i = 0; i < 40 && made.length < 5; i++) { const a = i * 1.7, x = spot.x + Math.cos(a) * (150 + i * 4), y = spot.y + Math.sin(a) * (150 + i * 4); if (!collides({ x, y, w: 24, h: 24 }, walls) && !solidTile(Math.floor(x / T), Math.floor(y / T))) made.push(spawnEnemy(sys, 'grunt', x, y)); }
  assert(made.length >= 3, 'spawn ' + made.length); let bad = 0;
  for (let f = 0; f < 600; f++) {
    ps.forEach((p, i) => { const nx = p.x + Math.cos(f / 50 + i) * 90 * DT, ny = p.y + Math.sin(f / 70 + i) * 90 * DT; if (!collides({ x: nx, y: ny, w: p.w, h: p.h }, walls)) { p.x = nx; p.y = ny; } });
    stepEnemies(sys, ps, DT, { walls, solidTile, healths: hs });
    for (const e of sys.list) if (![e.x, e.y].every(Number.isFinite) || collides(e, walls)) bad++;
  }
  eq(bad, 0); eq(sys.lastError, null); assert(sys.stats.spawned >= 3);
});

test('enemy: mozgás közben a fal megállítja (x és y), célváltás csak jóval közelebbi játékosra', () => {
  for (const [ex, ey, hx, hy, wall] of [[100, 100, 300, 100, R(150, 0, 32, 300)], [100, 100, 100, 300, R(0, 150, 300, 32)]]) {
    const sys = mkSys(), e = spawnEnemy(sys, 'grunt', ex, ey); e.home = { x: hx, y: hy }; e.state = 'retreat'; e.pts = [{ x: hx, y: hy }]; e.pathGoal = { x: hx, y: hy }; e.repath = 99;
    run(sys, [], { walls: [wall] }, 0.7); assert(!collides(e, [wall]), 'falban');
    assert(hx > hy ? e.x + e.w / 2 <= 150 + 1e-6 : e.y + e.h / 2 <= 150 + 1e-6, 'a fal előtt áll');
  }
  const slow = createEnemyRegistry([{ id: 'slow', speed: 10, sight: 10, loseSight: 20, patrol: 0, leash: 80 }]), sys = createEnemySystem({ reg: slow }), e = spawnEnemy(sys, 'slow', 500, 500);
  const p0 = pl(0, 650, 500), p1 = pl(1, 500, 660), env = { walls: [] };
  run(sys, [p0, p1], env, 0.5); eq(e.state, 'chase'); eq(e.target, 0, 'a közelebbi');
  p1.x = 500; p1.y = 630; run(sys, [p0, p1], env, 0.6); eq(e.target, 0, 'alig közelebbi: nincs váltás');
  p1.y = 580; run(sys, [p0, p1], env, 0.6); eq(e.target, 1, 'jóval közelebbi: váltás');
});

// ---- S068: támadás és hitbox (game-combat, render-combat). A fájl így 300 sor fölött van: S185 körül vágandó (test-combat.js). ----
import { COMBAT_CONFIG, ATTACK_DEFS, hurtbox, rectsOverlap, circleHitsRect, facingDir, meleeBox, createCombat, onCombat, startMelee, startShot, startKnockback, flashAlpha, hurtPlayer, makeHurt, stepCombat, combatView, attachCombat } from './game-combat.js';
import { drawCombat, drawHitFlashes } from './render-combat.js';
import { createAbilitySystem, castAbility, setAbilityHandler, poolValue, ensurePools } from './game-ability.js';
import { createCharacterRegistry } from './game-registry.js';
import { attachWarrior, strengthMul } from './game-warrior.js';
import { stepPlayerHealths, onHealth, applyDamage } from './game-health.js';
import { desiredVelocity } from './game-player.js';

const RIGHT = { x: 1, y: 0 };
const cb = (o = {}) => { const cs = createCombat(), es = mkSys(o.defs), ps = [pl(0, 200, 200), pl(1, 600, 600)], hs = createPlayerHealths(ps); return { cs, es, ps, hs, ctx: { players: ps, healths: hs, enemySys: es, walls: o.walls || [] } }; };
const cstep = (S, secs, fn) => { const evs = []; for (let i = 0; i < Math.round(secs / DT); i++) { const e = stepCombat(S.cs, S.ctx, DT); evs.push(...e); stepPlayerHealths(S.hs, S.ps, DT); if (fn && fn(i, e) === false) break; } return evs; };
const swing = (S, o = {}) => startMelee(S.cs, { owner: { team: 'player', index: 0 }, x: 200, y: 200, dir: RIGHT, size: 24, reach: 40, width: 44, delay: 0.1, active: 0.12, damage: { amount: 8, type: 'physical', tag: 'melee' }, knock: 36, ability: 'strike', ...o });
const hitsOf = evs => evs.filter(e => e.type === 'hit');

test('combat: geometria – hurtbox, átfedés (érintés nem), kör-téglalap, 4 irány, ütés-doboz', () => {
  eq(JSON.stringify(hurtbox({ x: 10, y: 20, w: 8, h: 6 })), JSON.stringify({ x: 6, y: 17, w: 8, h: 6 })); eq(hurtbox({ x: 0, y: 0 }).w, COMBAT_CONFIG.playerSize); eq(hurtbox(null), null); eq(hurtbox({ x: NaN, y: 0 }), null);
  assert(!rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 }), 'érintés'); assert(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 }));
  assert(circleHitsRect(0, 0, 5, { x: 5, y: -1, w: 2, h: 2 })); assert(!circleHitsRect(0, 0, 4.9, { x: 5, y: -1, w: 2, h: 2 })); assert(circleHitsRect(1, 1, 1, { x: 0, y: 0, w: 4, h: 4 }), 'belül');
  for (const [d, x, y] of [[{ x: 3, y: 1 }, 1, 0], [{ x: -1, y: -2 }, 0, -1], [{ x: 0, y: 0 }, 0, 1], [null, 0, 1], [{ x: NaN, y: 1 }, 0, 1], [{ x: -5, y: 5 }, -1, 0]]) { const f = facingDir(d); assert(f.x === x && f.y === y, JSON.stringify(d)); }
  eq(JSON.stringify(meleeBox(100, 100, RIGHT, 40, 44, 12)), JSON.stringify({ x: 112, y: 78, w: 40, h: 44 })); eq(meleeBox(100, 100, { x: -1, y: 0 }, 40, 44, 12).x, 48);
  eq(JSON.stringify(meleeBox(100, 100, { x: 0, y: 1 }, 40, 44, 12)), JSON.stringify({ x: 78, y: 112, w: 44, h: 40 })); eq(meleeBox(100, 100, { x: 0, y: -1 }, 40, 44, 12).y, 48);
});

test('combat: ütés – késleltetés, aktív ablak, egyszeri találat, irány, hatótáv, fal, halál, visszalökés', () => {
  const S = cb(), e = spawnEnemy(S.es, 'grunt', 240, 200), back = spawnEnemy(S.es, 'grunt', 160, 200), far = spawnEnemy(S.es, 'grunt', 290, 200); for (const x of S.es.list) x.state = 'idle';
  swing(S); assert(cstep(S, 0.08).length === 0 || hitsOf(cstep(S, 0)).length === 0, 'késleltetés alatt nincs találat'); eq(e.hp, 30);
  const evs = cstep(S, 0.4); eq(hitsOf(evs).length, 1, 'egyszeri találat'); eq(e.hp, 22); eq(back.hp, 30, 'mögötte nincs'); eq(far.hp, 30, 'hatótávon túl nincs'); eq(S.cs.attacks.length, 0, 'lejárt');
  assert(e.x > 240, 'visszalökés'); assert(flashAlpha(S.cs, { kind: 'enemy', ref: e }) >= 0, 'villanás'); eq(S.cs.stats.hits, 1);
  const W = cb({ walls: [R(215, 150, 10, 100)] }), we = spawnEnemy(W.es, 'grunt', 240, 200); swing(W); cstep(W, 0.4); eq(we.hp, 30, 'fal a gazda és a cél között');
  const K = cb(), ke = spawnEnemy(K.es, 'grunt', 240, 200); ke.health.hp = 5; ke.hp = 5; swing(K); const kev = hitsOf(cstep(K, 0.4)); assert(kev[0].killed && ke.health.dead, 'halál'); eq(K.cs.stats.kills, 1); eq(K.cs.kb.size, 0, 'halottat nem lök');
  const D = cb(), de = spawnEnemy(D.es, 'grunt', 240, 200); swing(D); D.ps[0].dead = true; cstep(D, 0.4); eq(de.hp, 30, 'a gazda elesett: megszakad');
  const U = cb(), ue = spawnEnemy(U.es, 'grunt', 240, 200); swing(U, { dir: { x: 0, y: -1 } }); cstep(U, 0.4); eq(ue.hp, 30, 'rossz irány');
  const E = cb(), ee = spawnEnemy(E.es, 'grunt', 240, 200); ee.state = 'idle'; E.ps[0].x = 255; startMelee(E.cs, { owner: { team: 'enemy' }, x: 220, y: 200, dir: RIGHT, size: 20, reach: 40, width: 44, delay: 0, active: 0.1, damage: { amount: 5, type: 'physical' } }); cstep(E, 0.3); eq(E.hs[0].hp, 95, 'az ellenség ütése a játékost'); eq(ee.hp, 30, 'nincs baráti tűz');
});

test('combat: ellenség-támadás a játékosra – sebzés, i-frame, visszalökés + p.kbx a mozgásba, villanás, halál', () => {
  const S = cb(), e = spawnEnemy(S.es, 'grunt', 240, 200), p = S.ps[0], env = { walls: [], healths: S.hs, hurt: makeHurt(S.cs, S.ctx) }; let got = null;
  for (let i = 0; i < 90 && !got; i++) { const ev = stepEnemies(S.es, S.ps, DT, env); stepCombat(S.cs, S.ctx, DT); stepPlayerHealths(S.hs, S.ps, DT); got = ev.find(x => x.type === 'hit') || null; }
  assert(got, 'az AI támadott'); eq(S.hs[0].hp, 94); assert(S.hs[0].invuln > 0.5, 'i-frame'); assert(flashAlpha(S.cs, { kind: 'player', index: 0 }) > 0.9, 'villanás');
  stepCombat(S.cs, S.ctx, DT); assert(p.kbx < 0 && p.kbx > -401, 'balra lök: ' + p.kbx); eq(desiredVelocity(p, { x: 0, y: 0 }).x, p.kbx); near(desiredVelocity(p, { x: 1, y: 0 }).x, p.speed + p.kbx, 1e-9);
  const r2 = hurtPlayer(S.cs, S.ctx, 0, { amount: 5, type: 'physical' }); eq(r2.reason, 'invuln'); eq(S.hs[0].hp, 94);
  for (let i = 0; i < 40; i++) stepPlayerHealths(S.hs, S.ps, DT); eq(hurtPlayer(S.cs, S.ctx, 0, { amount: 5, type: 'physical' }).dealt, 5, 'lejárt az i-frame');
  const K = cb(); K.hs[0].hp = 1; const kr = hurtPlayer(K.cs, K.ctx, 0, { amount: 9, type: 'physical', knockback: { x: 30, y: 0 } }); assert(kr.killed && K.hs[0].dead && K.hs[0].invuln === 0, 'halál: nincs i-frame');
  K.ps[0].dead = true; stepCombat(K.cs, K.ctx, DT); eq(K.ps[0].kbx, 0, 'halottat nem lök'); eq(hurtPlayer(K.cs, K.ctx, 7, { amount: 1 }), null); eq(hurtPlayer(K.cs, {}, 0, { amount: 1 }), null);
  void e;
});

test('combat: lövedék – repülés, első találat, átható, fal, hatótáv, csapat, jelölés-bónusz, vékony cél', () => {
  const shot = (S, o = {}) => startShot(S.cs, { owner: { team: 'player', index: 0 }, x: 100, y: 100, dir: RIGHT, speed: 420, radius: 5, range: 300, damage: { amount: 6, type: 'physical', tag: 'ranged' }, knock: 24, ability: 'shoot', ...o });
  const A = cb(), a1 = spawnEnemy(A.es, 'grunt', 200, 100), a2 = spawnEnemy(A.es, 'grunt', 260, 100); shot(A); assert(cstep(A, 0.05).length === 0 && a1.hp === 30, 'még úton'); cstep(A, 1); eq(a1.hp, 24); eq(a2.hp, 30, 'az első találat megállítja'); eq(A.cs.shots.length, 0);
  const B = cb(), b1 = spawnEnemy(B.es, 'grunt', 200, 100), b2 = spawnEnemy(B.es, 'grunt', 260, 100); shot(B, { pierce: 1 }); cstep(B, 1); assert(b1.hp === 24 && b2.hp === 24, 'átható: kettő');
  const W = cb({ walls: [R(180, 60, 20, 100)] }), w1 = spawnEnemy(W.es, 'grunt', 260, 100); shot(W); const we = cstep(W, 1); eq(w1.hp, 30, 'a fal megállítja'); eq(we.filter(x => x.type === 'wall').length, 1); eq(W.cs.stats.walls, 1);
  const R1 = cb(), r1 = spawnEnemy(R1.es, 'grunt', 300, 100); shot(R1, { range: 100 }); cstep(R1, 1); eq(r1.hp, 30, 'hatótávon túl'); eq(R1.cs.shots.length, 0);
  const T = cb(), t1 = spawnEnemy(T.es, 'grunt', 200, 100); startShot(T.cs, { owner: { team: 'enemy' }, x: 100, y: 200, dir: RIGHT, speed: 300, range: 400, damage: { amount: 4, type: 'physical' } }); T.ps[0].x = 300; T.ps[0].y = 200; cstep(T, 1); eq(T.hs[0].hp, 96, 'az ellenség lövedéke a játékost'); eq(t1.hp, 30, 'nincs baráti tűz');
  const M = cb(), m1 = spawnEnemy(M.es, 'grunt', 200, 100); m1.tracked = 5; shot(M, { damage: { amount: 10, type: 'physical', tag: 'ranged' } }); cstep(M, 1); near(m1.hp, 30 - 12.5, 1e-9, 'jelölt +25%');
  const N = cb({ defs: [{ id: 'tiny', size: 8, hp: 30, patrol: 0 }] }), n1 = spawnEnemy(N.es, 'tiny', 300, 100); startShot(N.cs, { owner: { team: 'player', index: 0 }, x: 100, y: 100, dir: RIGHT, speed: 2000, radius: 2, range: 400, damage: { amount: 3, type: 'physical' } }); cstep(N, 0.5); eq(n1.hp, 27, 'nincs átbújás a vékony cél mellett');
  const D = cb(), ds = shot(D, { dir: { x: 3, y: 4 } }); near(Math.hypot(ds.vx, ds.vy), 420, 1e-9); near(ds.vx, 252, 1e-9);
  for (const bad of [{ dir: { x: 0, y: 0 } }, { speed: 0 }, { range: -1 }, { x: NaN }, { owner: null }, { damage: { amount: -1 } }, { dir: null }]) eq(shot(D, bad), null, JSON.stringify(bad));
});

test('combat: visszalökés – súly, lecsengés + megállás, fal, csere, hibás bemenet', () => {
  const total = w => { const S = cb(), p = S.ps[0]; p.weight = w; assert(startKnockback(S.cs, { kind: 'player', index: 0, ref: p }, 40, 0)); let sum = 0; for (let i = 0; i < 120; i++) { stepCombat(S.cs, S.ctx, DT); sum += p.kbx * DT; } eq(S.cs.kb.size, 0, 'lecsengett'); eq(p.kbx, 0); return sum; };
  const w1 = total(1), w2 = total(2), wl = total(0.5); assert(Math.abs(w1 - 40) < 6, 'kb ' + w1); assert(Math.abs(w2 - 20) < 4, 'nehéz ' + w2); assert(Math.abs(wl - 80) < 12, 'könnyű ' + wl);
  const S = cb({ walls: [R(140, 0, 32, 300)] }), e = spawnEnemy(S.es, 'grunt', 100, 100); e.state = 'idle'; startKnockback(S.cs, { kind: 'enemy', ref: e }, 100, 0); cstep(S, 1.5); assert(e.x + e.w / 2 <= 140 + 1e-6 && e.x > 100, 'a fal előtt áll: ' + e.x); eq(collides(e, S.ctx.walls), false);
  const p = S.ps[1]; startKnockback(S.cs, { kind: 'player', index: 1, ref: p }, 40, 0); startKnockback(S.cs, { kind: 'player', index: 1, ref: p }, 0, 40); stepCombat(S.cs, S.ctx, DT); eq(S.cs.kb.size, 1, 'csere'); assert(p.kby > 0 && p.kbx === 0 || Math.abs(p.kbx) < 1e-9);
  for (const [t, x, y] of [[null, 1, 1], [{ kind: 'player', index: 0, ref: p }, NaN, 0], [{ kind: 'player', index: 0, ref: p }, 0, 0], [{ kind: 'player', index: 0, ref: p }, 'a', 1]]) eq(startKnockback(S.cs, t, x, y), false);
  eq(startKnockback(null, { kind: 'player' }, 1, 1), false); p.kbx = NaN; eq(desiredVelocity(p, { x: 1, y: 0 }).x, p.speed, 'hibás kbx = 0');
});

test('combat: képesség-bekötés – strike/shoot a hitboxon át, költség, nincs dupla sebzés, detach visszaállít', () => {
  const S = cb(), reg = createCharacterRegistry(), e = spawnEnemy(S.es, 'grunt', 240, 200); e.state = 'idle';
  const sys = createAbilitySystem({ reg, hooks: { enemies: (o, r) => enemiesNear(S.es, o, r) } }), ps = S.ps; ps[0].class = 'warrior'; ps[1].class = 'ranger';
  attachWarrior(sys, { players: ps, enemies: (o, r) => enemiesNear(S.es, o, r), damage: (en, a, i) => damageEnemy(S.es, en, a, i) }); const orig = sys.handlers.get('strike'), origShoot = sys.handlers.get('shoot');
  const ac = attachCombat(sys, S.cs, { players: ps }); assert(sys.handlers.get('strike') !== orig && typeof sys.handlers.get('shoot') === 'function', 'felülírva');
  ensurePools(sys, ps[0]); ensurePools(sys, ps[1]); const st0 = poolValue(ps[0], 'stamina').value, r = castAbility(sys, ps, 0, 'strike', { facing: RIGHT }); assert(r.ok, 'strike ok: ' + r.reason); eq(e.hp, 30, 'azonnal nincs sebzés (a hitbox ad)'); assert(poolValue(ps[0], 'stamina').value < st0, 'költség');
  cstep(S, 0.5); near(e.hp, 30 - 8 * strengthMul(ps[0]), 1e-9, 'egyszeri sebzés'); assert(e.x > 240, 'visszalökés');
  const far = cb(), fsys = createAbilitySystem({ reg, hooks: { enemies: (o, rr) => enemiesNear(far.es, o, rr) } }); far.ps[0].class = 'warrior'; attachCombat(fsys, far.cs, { players: far.ps }); eq(castAbility(fsys, far.ps, 0, 'strike', { facing: RIGHT }).reason, 'target', 'nincs ellenfél: nincs költség');
  const f0 = poolValue(ps[1], 'focus').value, sh = castAbility(sys, ps, 1, 'shoot', { facing: RIGHT }); assert(sh.ok && S.cs.shots.length === 1, 'shoot ok: ' + sh.reason); assert(poolValue(ps[1], 'focus').value < f0, 'fókusz-költség');
  ps[1].x = 100; ps[1].y = 200; e.x = 300; e.y = 200; e.hp = 30; e.health.hp = 30; S.cs.shots[0].x = 100; S.cs.shots[0].y = 200; cstep(S, 1); eq(e.hp, 24, 'a lövedék talált');
  ac.detach(); eq(sys.handlers.get('strike'), orig); eq(sys.handlers.get('shoot'), origShoot); eq(attachCombat(null, S.cs, null).cs, S.cs);
  assert(ATTACK_DEFS.strike.kind === 'melee' && ATTACK_DEFS.shoot.kind === 'shot' && Object.isFrozen(ATTACK_DEFS));
});

test('combat: hibás bemenet – indítás, plafon, dt, szemét-környezet, hibázó figyelő', () => {
  const S = cb(); for (const bad of [null, { owner: { team: 'x' } }, { x: NaN }, { reach: 0 }, { width: -1 }, { damage: { amount: -1 } }, { damage: null }, { reach: Infinity }]) eq(swing(S, bad === null ? { owner: null } : bad), null, JSON.stringify(bad));
  eq(startMelee(null, {}), null); for (let i = 0; i < COMBAT_CONFIG.maxAttacks + 5; i++) swing(S); eq(S.cs.attacks.length, COMBAT_CONFIG.maxAttacks, 'plafon');
  eq(stepCombat(S.cs, S.ctx, NaN).length, 0); eq(stepCombat(S.cs, S.ctx, -1).length, 0); eq(stepCombat(null, {}, DT).length, 0); const t0 = S.cs.time; stepCombat(S.cs, S.ctx, 5); near(S.cs.time - t0, COMBAT_CONFIG.maxDt, 1e-9, 'dt vágva');
  for (const junk of [null, 5, { players: 5, enemies: 'x', walls: 3 }, { players: [null, {}], healths: [null] }]) { stepCombat(S.cs, junk, DT); } eq(S.cs.lastError, null);
  const T = cb(), te = spawnEnemy(T.es, 'grunt', 240, 200); te.state = 'idle'; onCombat(T.cs, () => { throw new Error('x'); }); let n = 0; onCombat(T.cs, () => n++); swing(T); cstep(T, 0.4); assert(n >= 2 && T.cs.lastError, 'a hibázó figyelő nem állít meg'); eq(te.hp, 22);
  eq(combatView(null).attacks.length, 0); const v = combatView(T.cs); assert(Array.isArray(v.shots)); eq(createCombat({ cfg: { iframes: -1, kbDecay: 'x', flashTime: 1 } }).cfg.iframes, 0.6);
});

test('combat render: ütés-ív, lövedék, szikra, villanás – számok, kivágás', () => {
  const calls = { fillRect: 0, strokeRect: 0, stroke: 0 }, ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, fillRect() { calls.fillRect++; }, strokeRect() { calls.strokeRect++; }, stroke() { calls.stroke++; } };
  const S = cb(), e = spawnEnemy(S.es, 'grunt', 240, 200); e.state = 'idle'; swing(S, { delay: 0.05, active: 0.3 }); startShot(S.cs, { owner: { team: 'player', index: 0 }, x: 100, y: 100, dir: RIGHT, speed: 100, range: 300, damage: { amount: 1, type: 'physical' } });
  cstep(S, 0.02); eq(drawCombat(ctx, S.cs, 0, 0, 960, 540, {}), 1, 'csak a lövedék (az ütés még windup)'); eq(drawCombat(ctx, S.cs, 0, 0, 960, 540, { debug: true }), 2, 'debug: + windup keret');
  cstep(S, 0.1); assert(drawCombat(ctx, S.cs, 0, 0, 960, 540, {}) >= 3, 'ív + lövedék + szikra'); eq(drawCombat(ctx, S.cs, 5000, 5000, 960, 540, {}), 0, 'nézeten kívül nincs rajz');
  assert(drawHitFlashes(ctx, S.cs, 0, 0, 960, 540) >= 1, 'villanás'); eq(drawHitFlashes(ctx, S.cs, 5000, 5000, 960, 540), 0); cstep(S, 0.5); eq(drawHitFlashes(ctx, S.cs, 0, 0, 960, 540), 0, 'lecsengett');
  eq(drawCombat(null, S.cs, 0, 0, 1, 1), 0); eq(drawHitFlashes(ctx, null, 0, 0, 1, 1), 0);
});

function combatFuzz(seed) {
  const rnd = lcg(seed), walls = frame(1200, 900); for (let i = 0; i < 8; i++) walls.push(R(100 + Math.floor(rnd() * 30) * 32, 100 + Math.floor(rnd() * 20) * 32, 32 * (1 + Math.floor(rnd() * 3)), 32));
  const S = cb({ walls }); S.ps[0].x = 600; S.ps[0].y = 450; S.ps[1].x = 640; S.ps[1].y = 450; for (const p of S.ps) if (collides(p, walls)) { p.x = 600; p.y = 450; }
  for (let i = 0, t = 0; i < 5 && t < 200; t++) { const x = 60 + rnd() * 1080, y = 60 + rnd() * 780; if (!collides({ x, y, w: 30, h: 30 }, walls) && spawnEnemy(S.es, 'grunt', x, y)) i++; }
  const last = [[-9, -9], [-9, -9]].map(() => -9), bad = []; S.hs.forEach((h, i) => onHealth(h, ev => { if (ev.type === 'damage') { if (S.f * DT - last[i] < COMBAT_CONFIG.iframes - DT * 1.5) bad.push('iframe ' + i); last[i] = S.f * DT; } })); const env = { walls, healths: S.hs, hurt: makeHurt(S.cs, S.ctx) };
  for (S.f = 0; S.f < 3000; S.f++) {
    S.ps.forEach((p, i) => { if (p.dead) return; const a = S.f / 55 + i, nx = p.x + Math.cos(a) * 60 * DT + (p.kbx || 0) * DT, ny = p.y + Math.sin(a * 1.3) * 60 * DT + (p.kby || 0) * DT; if (!collides({ x: nx, y: ny, w: p.w, h: p.h }, walls)) { p.x = nx; p.y = ny; } });
    if (S.f % 45 === 0) { const i = Math.floor(rnd() * 2), p = S.ps[i], d = [RIGHT, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }][Math.floor(rnd() * 4)]; if (!p.dead) { if (rnd() < 0.5) swing(S, { owner: { team: 'player', index: i }, x: p.x, y: p.y, dir: d }); else startShot(S.cs, { owner: { team: 'player', index: i }, x: p.x, y: p.y, dir: d, speed: 420, range: 300, pierce: Math.floor(rnd() * 2), damage: { amount: 3, type: 'physical', tag: 'ranged' }, knock: 20 }); } }
    if (S.f % 700 === 650) for (const p of S.ps) if (p.dead) { S.hs[p.index].dead = false; S.hs[p.index].hp = 50; p.dead = false; }
    stepEnemies(S.es, S.ps, DT, env); stepCombat(S.cs, S.ctx, DT); stepPlayerHealths(S.hs, S.ps, DT);
    for (const p of S.ps) if (![p.x, p.y, p.kbx || 0, p.kby || 0].every(Number.isFinite)) bad.push('nan p');
    for (const e of S.es.list) if (![e.x, e.y, e.hp].every(Number.isFinite) || collides(e, walls)) bad.push('enemy ' + (collides(e, walls) ? 'fal' : 'nan'));
    if (S.cs.attacks.length > COMBAT_CONFIG.maxAttacks || S.cs.shots.length > COMBAT_CONFIG.maxShots || S.cs.fx.length > COMBAT_CONFIG.maxFx) bad.push('plafon');
    if (S.f % 500 === 100) for (const e of S.es.list.slice(0, 2)) damageEnemy(S.es, e, 1, { player: 0 });
  }
  return { bad: bad.slice(0, 4), err: S.cs.lastError || S.es.lastError, sig: JSON.stringify(S.cs.stats) + S.hs.map(h => h.hp.toFixed(2)).join() + S.es.list.map(e => e.hp.toFixed(2)).join() + S.ps.map(p => p.x.toFixed(3)).join() };
}
test('combat: fuzz 3000 kocka – nincs NaN/falban, i-frame tartva, plafonok, determinizmus', () => {
  for (const seed of [21, 22, 23]) { const a = combatFuzz(seed), b = combatFuzz(seed); eq(a.bad.length, 0, 'seed ' + seed + ': ' + a.bad); eq(a.err, null); eq(a.sig, b.sig, 'determinisztikus'); assert(/"hits":[1-9]/.test(a.sig), 'volt találat'); }
});
