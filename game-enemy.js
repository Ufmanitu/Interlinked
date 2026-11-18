// Ellenség-AI (S067). Tiszta logika, DOM és canvas nélkül. Adat + állapotgép + rendszer egy fájlban (a 6 fájl/lépés miatt;
// az S188 szétvághatja: data-enemies.js). Állapotok: idle, patrol, chase, attack, retreat (+ dead).
// Mozgás: rács-alapú A* (game-pathfind), falak ellen tengelyenkénti söprés (game-collision). Fagyott ellenfél (e.frozen > 0) áll.
import { DAMAGE_TYPES, createHealth, applyDamage } from './game-health.js';
import { sweepAxis, collides } from './game-collision.js';
import { findPath, createBlocker, pathPoints, smoothPath, hasLineOfSight, segmentBlocked } from './game-pathfind.js';
import { mulberry32 } from './world-noise.js';

export const ENEMY_STATES = Object.freeze(['idle', 'patrol', 'chase', 'attack', 'retreat', 'dead']);
export const ENEMY_CONFIG = Object.freeze({
  tile: 32, senseEvery: 0.2, repathEvery: 0.6, repathMove: 48, arrive: 6, waitMin: 1, waitMax: 3, patrolMul: 0.5, retreatMul: 1.2,
  retreatLock: 3, recover: 0.25, hitSlack: 1.4, losGrace: 5, stuckTime: 0.8, stuckGiveUp: 3, noPathGiveUp: 3,
  pathRadius: 22, maxNodes: 700, maxEnemies: 128, maxDt: 0.1, switchRatio: 0.75,
});

// Definíciók (S069). Mértékegység: px, mp, tile (sight, attackRange, patrol, leash). A két valódi típus az 1. régióhoz (Rét, 1-10. szint):
// boar = lassú-erős (lassú, hosszú felütés, nagy sebzés + visszalökés, sok HP), field_rat = gyors-gyenge (gyors, rövid felütés, kis sebzés, kevés HP, megfutamodik).
// A spawn-táblák (régió -> típus) a game-spawn.js-ben vannak. A grunt FEJLESZTŐI/TESZT-báb (nincs spawn-táblában).
export const ENEMY_DEFS = [
  { id: 'boar', hp: 60, speed: 58, size: 26, sight: 5, loseSight: 9, attackRange: 1, windup: 0.7, cooldown: 2, damage: { amount: 12, type: 'physical' },
    knock: 110, patrol: 3, leash: 12, fleeHp: 0, regen: 1, resist: {} },
  { id: 'field_rat', hp: 12, speed: 130, size: 14, sight: 7, loseSight: 11, attackRange: 0.8, windup: 0.15, cooldown: 0.7, damage: { amount: 3, type: 'physical' },
    knock: 18, patrol: 5, leash: 16, fleeHp: 0.25, regen: 2, resist: {} },
  { id: 'grunt', hp: 30, speed: 70, size: 20, sight: 6, loseSight: 10, attackRange: 1, windup: 0.4, cooldown: 1.2,
    damage: { amount: 6, type: 'physical' }, knock: 40, patrol: 4, leash: 14, fleeHp: 0, regen: 2, resist: {} },
];
export const ENEMY_TEXTS = {
  hu: { 'enemy.boar': 'Vaddisznó', 'enemy.field_rat': 'Mezei patkány', 'enemy.grunt': 'Zsoldos' },
  en: { 'enemy.boar': 'Wild boar', 'enemy.field_rat': 'Field rat', 'enemy.grunt': 'Grunt' },
};

const fin = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const FIELDS = [ // [kulcs, min, max, alap]
  ['hp', 1, 99999, 30], ['speed', 10, 400, 70], ['size', 8, 30, 20], ['sight', 1, 40, 6], ['attackRange', 0.5, 12, 1], ['windup', 0, 3, 0.4],
  ['cooldown', 0.2, 10, 1], ['knock', 0, 400, 40], ['patrol', 0, 30, 4], ['leash', 3, 80, 14], ['fleeHp', 0, 0.9, 0], ['regen', 0, 100, 0],
];

/** -> {ok, enemy (fagyasztott), error}. Hiányzó mező -> alap; rossz típus/tartomány -> hiba. Sosem dob. */
export function validateEnemyDef(def) {
  if (!def || typeof def !== 'object') return { ok: false, enemy: null, error: 'def' };
  if (typeof def.id !== 'string' || !/^[a-z][a-z0-9_]{1,31}$/.test(def.id)) return { ok: false, enemy: null, error: 'id' };
  const e = { id: def.id, nameKey: 'enemy.' + def.id };
  for (const [k, a, b, d] of FIELDS) {
    const v = def[k];
    if (v === undefined) { e[k] = d; continue; }
    if (!fin(v) || v < a || v > b) return { ok: false, enemy: null, error: k };
    e[k] = v;
  }
  if (def.loseSight === undefined) e.loseSight = Math.min(80, e.sight * 1.6);
  else if (!fin(def.loseSight) || def.loseSight < e.sight || def.loseSight > 80) return { ok: false, enemy: null, error: 'loseSight' };
  else e.loseSight = def.loseSight;
  const dm = def.damage === undefined ? { amount: 5, type: 'physical' } : def.damage;
  if (!dm || typeof dm !== 'object' || !fin(dm.amount) || dm.amount < 0 || dm.amount > 9999) return { ok: false, enemy: null, error: 'damage' };
  const type = dm.type === undefined ? 'physical' : dm.type;
  if (!DAMAGE_TYPES.includes(type)) return { ok: false, enemy: null, error: 'damage.type' };
  e.damage = Object.freeze({ amount: dm.amount, type });
  const res = {};
  if (def.resist !== undefined) {
    if (!def.resist || typeof def.resist !== 'object') return { ok: false, enemy: null, error: 'resist' };
    for (const t of DAMAGE_TYPES) if (def.resist[t] !== undefined) { if (!fin(def.resist[t])) return { ok: false, enemy: null, error: 'resist' }; res[t] = clamp(def.resist[t], -1, 1); }
  }
  e.resist = Object.freeze(res);
  return { ok: true, enemy: Object.freeze(e), error: null };
}

export function createEnemyRegistry(defs = ENEMY_DEFS) {
  const reg = { enemies: new Map(), errors: [], dups: [] };
  for (const d of Array.isArray(defs) ? defs : []) {
    const r = validateEnemyDef(d);
    if (!r.ok) { reg.errors.push(`${d && d.id}:${r.error}`); continue; }
    if (reg.enemies.has(r.enemy.id)) reg.dups.push(r.enemy.id);
    reg.enemies.set(r.enemy.id, r.enemy);
  }
  return reg;
}
export const getEnemyDef = (reg, id) => (reg && reg.enemies instanceof Map && reg.enemies.get(id)) || null;

export function createEnemySystem({ reg, seed = 1, cfg } = {}) {
  const c = { ...ENEMY_CONFIG };
  if (cfg && typeof cfg === 'object') for (const k of Object.keys(c)) if (fin(cfg[k]) && cfg[k] >= 0) c[k] = cfg[k];
  return { reg: reg || createEnemyRegistry(), cfg: c, list: [], next: 1, rng: mulberry32(seed), time: 0, events: [], listeners: new Set(),
    stats: { spawned: 0, killed: 0, repaths: 0, pathFails: 0, hits: 0, misses: 0 }, lastError: null };
}
export function onEnemy(sys, fn) {
  if (!sys || typeof fn !== 'function') return () => {};
  sys.listeners.add(fn); return () => sys.listeners.delete(fn);
}
function emit(sys, ev) {
  sys.events.push(ev);
  for (const fn of [...sys.listeners]) { try { fn(ev); } catch (err) { sys.lastError = err; } }
}

/** -> ellenség | null (ismeretlen típus, hibás pozíció, plafon). */
export function spawnEnemy(sys, type, x, y) {
  const def = getEnemyDef(sys && sys.reg, type);
  if (!def || !fin(x) || !fin(y) || sys.list.length >= sys.cfg.maxEnemies) return null;
  const e = { id: sys.next++, type: def.id, def, x, y, w: def.size, h: def.size, vx: 0, vy: 0, home: { x, y }, state: 'idle', facing: 'down',
    health: createHealth({ max: def.hp, resist: def.resist }), hp: def.hp, hpMax: def.hp, target: -1, t: 0, wait: 0.5, lock: 0, cool: 0, sense: 0, vis: false,
    lostT: 0, pts: null, pi: 0, pathGoal: null, repath: 0, stuck: 0, stuckN: 0, noPath: 0, atk: null, fled: false, frozen: 0, tracked: 0, killer: null };
  sys.list.push(e); sys.stats.spawned++;
  emit(sys, { type: 'spawn', e }); return e;
}
export function removeEnemy(sys, e) {
  const i = sys && sys.list ? sys.list.indexOf(e) : -1;
  if (i < 0) return false; sys.list.splice(i, 1); return true;
}
export const enemyView = e => ({ id: e.id, type: e.type, x: e.x, y: e.y, w: e.w, h: e.h, state: e.state, facing: e.facing,
  hpRatio: e.health.max > 0 ? e.health.hp / e.health.max : 0, windup: e.atk && e.atk.phase === 'windup' && e.def.windup > 0 ? e.atk.t / e.def.windup : 0, frozen: e.frozen > 0 });

/** Élő ellenfelek a körben (a képesség-hookoknak: env.enemies). */
export function enemiesNear(sys, origin, rangePx) {
  if (!sys || !origin || !fin(origin.x) || !fin(origin.y) || !fin(rangePx)) return [];
  return sys.list.filter(e => e.state !== 'dead' && !e.health.dead && Math.hypot(e.x - origin.x, e.y - origin.y) <= rangePx + e.w / 2);
}
/** Sebzés az ellenfélre (a képesség-hookoknak: env.damage) -> halott-e. A sebző játékosra átáll (ha nincs zárolva). */
export function damageEnemy(sys, e, amount, info) {
  if (!e || !e.health) return false;
  const i = info && typeof info === 'object' ? info : {};
  const type = DAMAGE_TYPES.includes(i.type) ? i.type : (i.burn || i.ability === 'ignite' ? 'fire' : 'physical');
  const r = applyDamage(e.health, { amount, type, source: fin(i.player) ? i.player : null, ignoreInvuln: !!i.ignoreInvuln });
  e.hp = e.health.hp;
  if (r.ok && r.dealt > 0) {
    if (fin(i.player)) e.killer = i.player;
    if (!e.health.dead && fin(i.player) && e.lock <= 0 && (e.state === 'idle' || e.state === 'patrol')) { e.target = i.player; e.lostT = 0; setState(sys, e, 'chase'); }
  }
  return e.health.dead;
}
/** Eltolás falakat tisztelve (env.push) -> megtett px. */
export function pushEnemy(e, dx, dy, dist, walls) {
  const d = Math.hypot(dx, dy);
  if (!e || !(d > 0) || !fin(dist) || dist <= 0 || !Array.isArray(walls)) return 0;
  const mx = sweepAxis(e, 'x', (dx / d) * dist, walls); e.x += mx;
  const my = sweepAxis(e, 'y', (dy / d) * dist, walls); e.y += my;
  e.pts = null; return Math.hypot(mx, my);
}

function setState(sys, e, to) {
  if (e.state === to || e.state === 'dead') return;
  const from = e.state; e.state = to; e.atk = null; e.pts = null; e.pi = 0; e.stuck = 0; e.stuckN = 0; e.noPath = 0; e.vx = e.vy = 0;
  if (to === 'idle') e.wait = sys.cfg.waitMin + sys.rng() * (sys.cfg.waitMax - sys.cfg.waitMin);
  emit(sys, { type: 'state', e, from, to });
}
const alive = p => p && fin(p.x) && fin(p.y) && !p.dead;
function nearest(players, e, maxPx) {
  let b = null;
  (players || []).forEach((p, i) => { if (!alive(p)) return; const d = Math.hypot(p.x - e.x, p.y - e.y); if (d <= maxPx && (!b || d < b.d)) b = { i, p, d }; });
  return b;
}
const faceTo = (e, dx, dy) => { if (dx || dy) e.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'); };
function retreat(sys, e, lock) { e.lock = lock; e.target = -1; setState(sys, e, 'retreat'); }

function requestPath(sys, e, goal, walls, env) {
  const c = sys.cfg, T = c.tile;
  e.repath = c.repathEvery; e.pathGoal = { x: goal.x, y: goal.y };
  if (!segmentBlocked(e.x, e.y, goal.x, goal.y, walls, e.w / 2)) { e.pts = [{ x: goal.x, y: goal.y }]; e.pi = 0; return true; }
  const blocked = createBlocker({ rects: walls, solidTile: env.solidTile, tile: T, cx: e.x, cy: e.y, radius: c.pathRadius });
  sys.stats.repaths++;
  const r = findPath({ from: { tx: Math.floor(e.x / T), ty: Math.floor(e.y / T) }, to: { tx: Math.floor(goal.x / T), ty: Math.floor(goal.y / T) }, blocked, maxNodes: c.maxNodes });
  if (!r.ok) { sys.stats.pathFails++; e.pts = null; e.pi = 0; return false; }
  let pts = smoothPath({ x: e.x, y: e.y }, pathPoints(r.path, T), (a, b, x, y) => hasLineOfSight(a, b, x, y, blocked.solidPx, T / 4));
  if (!r.partial || !pts.length) { if (pts.length) pts[pts.length - 1] = { x: goal.x, y: goal.y }; else pts = [{ x: goal.x, y: goal.y }]; }
  e.pts = pts; e.pi = 0; return true;
}
function moveAlong(sys, e, speed, dt, walls) {
  while (e.pts && e.pi < e.pts.length) {
    const wp = e.pts[e.pi], dx = wp.x - e.x, dy = wp.y - e.y, d = Math.hypot(dx, dy);
    if (d <= sys.cfg.arrive) { e.pi++; continue; }
    const step = Math.min(speed * dt, d), ux = dx / d, uy = dy / d;
    const mx = sweepAxis(e, 'x', ux * step, walls); e.x += mx;
    const my = sweepAxis(e, 'y', uy * step, walls); e.y += my;
    e.vx = mx / dt; e.vy = my / dt; faceTo(e, ux, uy);
    if (Math.hypot(mx, my) < step * 0.25) e.stuck += dt; else { e.stuck = 0; e.stuckN = 0; }
    return true;
  }
  e.vx = e.vy = 0; return false;
}
/** -> 'moving' | 'arrived' | 'nopath' | 'stuck' */
function follow(sys, e, goal, mul, dt, walls, env) {
  const c = sys.cfg; e.repath -= dt;
  if (!e.pts || (e.repath <= 0 && (!e.pathGoal || Math.hypot(goal.x - e.pathGoal.x, goal.y - e.pathGoal.y) > c.repathMove))) {
    if (!requestPath(sys, e, goal, walls, env)) return 'nopath';
  } else if (e.repath <= 0) e.repath = c.repathEvery;
  const moving = moveAlong(sys, e, e.def.speed * mul, dt, walls);
  if (e.stuck > c.stuckTime) { e.stuck = 0; e.pts = null; if (++e.stuckN >= c.stuckGiveUp) { e.stuckN = 0; return 'stuck'; } }
  return moving ? 'moving' : 'arrived';
}

function die(sys, e) {
  e.state = 'dead'; e.vx = e.vy = 0; e.atk = null; e.hp = 0; sys.stats.killed++;
  emit(sys, { type: 'died', e, killer: e.killer, x: e.x, y: e.y });
}
function hurtPlayer(sys, e, i, players, env) {
  const def = e.def, p = players[i], d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
  const dmg = { amount: def.damage.amount, type: def.damage.type, source: def.id, tag: 'melee',
    knockback: def.knock > 0 ? { x: ((p.x - e.x) / d) * def.knock, y: ((p.y - e.y) / d) * def.knock } : null };
  let res = null;
  if (typeof env.hurt === 'function') { try { res = env.hurt(i, dmg, e); } catch (err) { sys.lastError = err; } }
  else if (env.healths && env.healths[i]) res = applyDamage(env.healths[i], dmg);
  sys.stats.hits++; emit(sys, { type: 'hit', e, player: i, damage: dmg, result: res });
}

function stepOne(sys, e, players, dt, walls, env) {
  const c = sys.cfg, def = e.def;
  if (e.state === 'dead') return;
  if (e.health.dead) { die(sys, e); return; }
  if (e.frozen > 0) { e.vx = e.vy = 0; return; }
  e.t += dt; e.lock = Math.max(0, e.lock - dt); e.cool = Math.max(0, e.cool - dt); e.sense -= dt;
  if (def.regen > 0 && (e.state === 'idle' || e.state === 'retreat') && e.health.hp < e.health.max) { e.health.hp = Math.min(e.health.max, e.health.hp + def.regen * dt); e.hp = e.health.hp; }
  if (e.fled && e.health.hp >= e.health.max * Math.min(1, def.fleeHp + 0.3)) e.fled = false;
  if (def.fleeHp > 0 && !e.fled && e.state !== 'retreat' && e.health.hp <= e.health.max * def.fleeHp) { e.fled = true; retreat(sys, e, c.retreatLock * 2); return; }
  const sensing = e.sense <= 0; if (sensing) e.sense = c.senseEvery + (e.id % 5) * 0.01;
  const sightPx = def.sight * c.tile;
  if (e.state === 'idle' || e.state === 'patrol') {
    if (sensing && e.lock <= 0) { const n = nearest(players, e, sightPx); if (n && !segmentBlocked(e.x, e.y, n.p.x, n.p.y, walls)) { e.target = n.i; e.lostT = 0; e.vis = true; setState(sys, e, 'chase'); return; } }
    if (e.state === 'idle') {
      e.vx = e.vy = 0; e.wait -= dt;
      if (e.wait <= 0) {
        if (def.patrol <= 0) { e.wait = c.waitMax; return; }
        for (let k = 0; k < 6; k++) {
          const a = sys.rng() * Math.PI * 2, r = (0.3 + sys.rng() * 0.7) * def.patrol * c.tile, gx = e.home.x + Math.cos(a) * r, gy = e.home.y + Math.sin(a) * r;
          if (collides({ x: gx, y: gy, w: e.w, h: e.h }, walls)) continue;
          setState(sys, e, 'patrol'); e.pathGoal = null; if (!requestPath(sys, e, { x: gx, y: gy }, walls, env)) setState(sys, e, 'idle'); return;
        }
        e.wait = c.waitMin;
      }
    } else {
      const r = e.pathGoal ? follow(sys, e, e.pathGoal, c.patrolMul, dt, walls, env) : 'arrived';
      if (r !== 'moving') setState(sys, e, 'idle');
    }
    return;
  }
  if (e.state === 'chase') { stepChase(sys, e, players, dt, walls, env, sensing); return; }
  if (e.state === 'attack') { stepAttack(sys, e, players, dt, env); return; }
  if (e.state === 'retreat') {
    const r = follow(sys, e, e.home, c.retreatMul, dt, walls, env);
    if (r !== 'moving' || Math.hypot(e.home.x - e.x, e.home.y - e.y) <= c.arrive * 2) setState(sys, e, 'idle');
  }
}
function stepChase(sys, e, players, dt, walls, env, sensing) {
  const c = sys.cfg, def = e.def;
  let tp = players[e.target];
  if (sensing) { // látótér + célváltás csak az érzékelés ütemében
    const cur = alive(tp) ? Math.hypot(tp.x - e.x, tp.y - e.y) : Infinity, n = nearest(players, e, def.loseSight * c.tile);
    if (n && n.i !== e.target && n.d < cur * c.switchRatio) { e.target = n.i; tp = n.p; }
    e.vis = alive(tp) && !segmentBlocked(e.x, e.y, tp.x, tp.y, walls);
  }
  if (!alive(tp)) { const n = nearest(players, e, def.loseSight * c.tile); if (n) { e.target = n.i; tp = n.p; } else { retreat(sys, e, c.retreatLock); return; } }
  const d = Math.hypot(tp.x - e.x, tp.y - e.y);
  if (d > def.loseSight * c.tile || Math.hypot(e.x - e.home.x, e.y - e.home.y) > def.leash * c.tile) { retreat(sys, e, c.retreatLock); return; }
  if (e.vis) e.lostT = 0; else if ((e.lostT += dt) > c.losGrace) { retreat(sys, e, c.retreatLock); return; }
  faceTo(e, tp.x - e.x, tp.y - e.y);
  const reach = def.attackRange * c.tile + (e.w + (tp.w || 24)) / 2;
  if (d <= reach) {
    e.vx = e.vy = 0;
    if (e.cool <= 0 && e.vis) { e.atk = { phase: 'windup', t: 0 }; e.state = 'attack'; e.pts = null; emit(sys, { type: 'state', e, from: 'chase', to: 'attack' }); emit(sys, { type: 'attack', e, player: e.target }); }
    return;
  }
  const r = follow(sys, e, { x: tp.x, y: tp.y }, 1, dt, walls, env);
  if (r === 'nopath') { if (++e.noPath >= c.noPathGiveUp) retreat(sys, e, c.retreatLock); } else if (r !== 'stuck') e.noPath = 0;
  if (r === 'stuck') retreat(sys, e, c.retreatLock);
}
function stepAttack(sys, e, players, dt, env) {
  const c = sys.cfg, def = e.def, tp = players[e.target];
  e.vx = e.vy = 0; e.atk.t += dt;
  if (alive(tp)) faceTo(e, tp.x - e.x, tp.y - e.y);
  if (e.atk.phase === 'windup' && e.atk.t >= def.windup) {
    const reach = (def.attackRange * c.tile + (e.w + ((tp && tp.w) || 24)) / 2) * c.hitSlack;
    if (alive(tp) && Math.hypot(tp.x - e.x, tp.y - e.y) <= reach) hurtPlayer(sys, e, e.target, players, env);
    else { sys.stats.misses++; emit(sys, { type: 'miss', e, player: e.target }); }
    e.cool = def.cooldown; e.atk = { phase: 'recover', t: 0 };
  } else if (e.atk.phase === 'recover' && e.atk.t >= c.recover) { e.lostT = 0; setState(sys, e, 'chase'); }
}

/** Egy kocka: env = {walls[{x,y,w,h}], solidTile(tx,ty)->bool, healths[Health], hurt(i,DamageInfo,e)}; -> a kocka eseményei. */
export function stepEnemies(sys, players, dt, env) {
  if (!sys || !Array.isArray(sys.list)) return [];
  sys.events = [];
  if (!fin(dt) || dt <= 0) return sys.events;
  dt = Math.min(dt, sys.cfg.maxDt); sys.time += dt;
  const en = env && typeof env === 'object' ? env : {}, walls = Array.isArray(en.walls) ? en.walls : [];
  for (const e of sys.list.slice()) { try { stepOne(sys, e, players, dt, walls, en); } catch (err) { sys.lastError = err; } }
  sys.list = sys.list.filter(e => e.state !== 'dead');
  return sys.events;
}
