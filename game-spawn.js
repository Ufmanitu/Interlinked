// Ellenség-spawn (S069). Tiszta logika, DOM és canvas nélkül. A spawn-pontok RÉGIÓHOZ kötöttek (makrótérkép régió-id -> spawn-tábla),
// chunkonként determinisztikusak (seed + chunk-koordináta), a pont a régió rect-jén belüli tile-ra esik. A pont egyszerre egy ellenfelet tart:
// meghalás után újraéled (respawn), a játékosoktól távol eső tétlen ellenfél eltűnik (a pont újra kész). Nem mentett (a pontok a seedből adódnak).
import { CHUNK_SIZE, chunkRng, chunkCoord } from './world-chunk.js';
import { regionAt } from './world-macro.js';
import { isSolidId } from './world-tiles.js';
import { spawnEnemy, removeEnemy, getEnemyDef } from './game-enemy.js';
import { collides } from './game-collision.js';

export const SPAWN_CONFIG = Object.freeze({
  tile: 32, edge: 2,          // a pont a chunk szélétől legalább ennyi tile-ra
  minDist: 640, maxDist: 1800, // px: a legközelebbi játékostól ennél közelebb nem születik (nem a képen), ennél messzebb nem
  despawnDist: 2600,           // px: ennél messzebb eltűnik a tétlen ellenfél
  every: 0.5,                  // mp: a spawner döntési üteme
  maxActive: 24,               // egyszerre élő spawn-ellenfél (az enemy-rendszer maxEnemies-e fölött nincs értelme)
  chunkRadius: 1, maxChunks: 48, salt: 0x5a17,
});

// Régió-id -> {density: kísérlet/chunk (a régión kívül eső tile kiesik), respawn: mp, entries: [{type, weight, levels [a,b] (tájékoztató)}]}.
// Új régió: a MACRO_MAP régió-id-ja + bejegyzés ide (S118+: külön adatfájl).
export const SPAWN_TABLES = Object.freeze({
  meadow: Object.freeze({ density: 7, respawn: 150, entries: Object.freeze([
    Object.freeze({ type: 'field_rat', weight: 3, levels: [1, 6] }),
    Object.freeze({ type: 'boar', weight: 1, levels: [4, 10] }),
  ]) }),
});

const fin = v => typeof v === 'number' && Number.isFinite(v);
const keyOf = (cx, cy) => cx + ',' + cy;

/** -> ['régió:típus'] hibák (ismeretlen típus, hibás súly/érték); a tests.html jelzi. */
export function auditSpawnTables(tables, enemyReg, mm) {
  const bad = [];
  for (const [rid, t] of Object.entries(tables || {})) {
    if (mm && mm.byId && mm.byId.regions && !mm.byId.regions[rid]) bad.push(rid + ':region');
    if (!t || !fin(t.density) || t.density < 0 || !fin(t.respawn) || t.respawn < 0 || !Array.isArray(t.entries) || !t.entries.length) { bad.push(rid + ':table'); continue; }
    for (const en of t.entries) { if (!en || !getEnemyDef(enemyReg, en.type)) bad.push(rid + ':' + (en && en.type)); else if (!fin(en.weight) || en.weight <= 0) bad.push(rid + ':weight:' + en.type); }
  }
  return bad;
}

/** Egy chunk spawn-pontjai -> [{id 'cx,cy:s<i>', type, x, y (px, tile-közép), region, respawn}]. Determinisztikus; csak olyan tile-ra, ahol a régiónak van táblája. */
export function spawnPointsInChunk(mm, seed, cx, cy, tables = SPAWN_TABLES, cfg = SPAWN_CONFIG) {
  const out = [];
  if (!mm || !Number.isInteger(cx) || !Number.isInteger(cy)) return out;
  const rng = chunkRng((seed | 0) ^ cfg.salt, cx, cy), span = CHUNK_SIZE - 2 * cfg.edge;
  const maxN = Math.max(0, ...Object.values(tables || {}).map(t => (t && fin(t.density) ? Math.floor(t.density) : 0)));
  for (let i = 0; i < maxN; i++) {
    const tx = cx * CHUNK_SIZE + cfg.edge + Math.floor(rng() * span), ty = cy * CHUNK_SIZE + cfg.edge + Math.floor(rng() * span), roll = rng(); // az RNG-fogyasztás pontonként állandó
    const reg = regionAt(mm, tx, ty), tb = reg && tables[reg.id];
    if (!tb || !Array.isArray(tb.entries) || i >= tb.density) continue;
    let sum = 0; for (const en of tb.entries) sum += en.weight;
    let r = roll * sum, pick = tb.entries[tb.entries.length - 1];
    for (const en of tb.entries) { if ((r -= en.weight) < 0) { pick = en; break; } }
    out.push({ id: `${cx},${cy}:s${i}`, type: pick.type, x: tx * cfg.tile + cfg.tile / 2, y: ty * cfg.tile + cfg.tile / 2, region: reg.id, respawn: tb.respawn });
  }
  return out;
}

export function createSpawner({ mm, seed = 1, tables = SPAWN_TABLES, cfg } = {}) {
  const c = { ...SPAWN_CONFIG };
  if (cfg && typeof cfg === 'object') for (const k of Object.keys(c)) if (fin(cfg[k]) && cfg[k] >= 0) c[k] = cfg[k];
  return { mm: mm || null, seed: Number.isFinite(seed) ? seed : 1, tables: tables || {}, cfg: c, chunks: new Map(), state: new Map(), time: 0, acc: 0,
    stats: { spawned: 0, killed: 0, despawned: 0, bad: 0, deferred: 0 }, lastError: null };
}
const st = (sp, pt) => { let s = sp.state.get(pt.id); if (!s) { s = { phase: 'ready', enemy: null, at: 0 }; sp.state.set(pt.id, s); } return s; };

/** Élő (követett) spawn-ellenfelek száma. */
export function spawnActive(sp) { let n = 0; if (sp) for (const s of sp.state.values()) if (s.phase === 'alive') n++; return n; }

function minDistTo(points, x, y) { let b = Infinity; for (const p of points) { if (p && fin(p.x) && fin(p.y)) b = Math.min(b, Math.hypot(p.x - x, p.y - y)); } return b; }

/** -> 'ok' | 'defer' (nincs betöltve a tile) | 'bad' (ütköző tile/fal/biztonsági zóna). env {tileAt(tx,ty)->id|-1, walls[], safe: tömb|fn -> [{x,y,r}]}. */
function placeCheck(sp, pt, def, env) {
  const T = sp.cfg.tile, tx = Math.floor(pt.x / T), ty = Math.floor(pt.y / T);
  const safe = typeof env.safe === 'function' ? env.safe() : env.safe;
  for (const z of Array.isArray(safe) ? safe : []) if (z && Math.hypot(pt.x - z.x, pt.y - z.y) <= z.r) return 'bad';
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const id = env.tileAt(tx + dx, ty + dy);
    if (id < 0) return 'defer';
    if (isSolidId(id)) return 'bad';
  }
  return Array.isArray(env.walls) && collides({ x: pt.x, y: pt.y, w: def.size, h: def.size }, env.walls) ? 'bad' : 'ok';
}

/** Egy kocka. es = enemy-rendszer, points = [{x,y}] (a játékosok; zsebben a kinti kilépési pont: streamPoints), env {tileAt, walls, safe}.
 *  -> {spawned, despawned, killed}. Sosem dob; hibás bemenet -> nincs hatás. */
export function stepSpawner(sp, es, points, dt, env) {
  const res = { spawned: 0, despawned: 0, killed: 0 };
  if (!sp || !es || !Array.isArray(es.list) || !fin(dt) || dt <= 0 || !env || typeof env.tileAt !== 'function') return res;
  const pts = (Array.isArray(points) ? points : []).filter(p => p && fin(p.x) && fin(p.y)), c = sp.cfg;
  sp.time += Math.min(dt, 0.25);
  try {
    for (const [id, s] of sp.state) { // követés: meghalt -> respawn-várakozás; eltűnt máshonnan -> kész
      if (s.phase !== 'alive') continue;
      const e = s.enemy;
      if (!e || e.state === 'dead' || (e.health && e.health.dead)) { s.phase = 'cool'; s.enemy = null; s.at = sp.time + (s.respawn || 0); sp.stats.killed++; res.killed++; }
      else if (!es.list.includes(e)) { s.phase = 'ready'; s.enemy = null; }
      else if (minDistTo(pts, e.x, e.y) > c.despawnDist && (e.state === 'idle' || e.state === 'patrol')) { removeEnemy(es, e); s.phase = 'ready'; s.enemy = null; sp.stats.despawned++; res.despawned++; }
      void id;
    }
    sp.acc += dt; if (sp.acc < c.every) return res; sp.acc = 0;
    if (!pts.length || !sp.mm) return res;
    const want = new Set();
    for (const p of pts) { const px = chunkCoord(Math.floor(p.x / c.tile)), py = chunkCoord(Math.floor(p.y / c.tile)); for (let dy = -c.chunkRadius; dy <= c.chunkRadius; dy++) for (let dx = -c.chunkRadius; dx <= c.chunkRadius; dx++) want.add(keyOf(px + dx, py + dy)); }
    for (const k of want) if (!sp.chunks.has(k)) { const [cx, cy] = k.split(',').map(Number); sp.chunks.set(k, spawnPointsInChunk(sp.mm, sp.seed, cx, cy, sp.tables, c)); }
    if (sp.chunks.size > c.maxChunks) for (const k of [...sp.chunks.keys()]) { // a távoli, élő pont nélküli chunkok eldobása (a pont-állapot megmarad)
      if (sp.chunks.size <= c.maxChunks) break;
      if (!want.has(k) && !sp.chunks.get(k).some(q => (sp.state.get(q.id) || {}).phase === 'alive')) sp.chunks.delete(k);
    }
    let active = spawnActive(sp);
    for (const k of want) for (const pt of sp.chunks.get(k) || []) {
      const s = st(sp, pt); s.respawn = pt.respawn;
      if (s.phase === 'cool' && sp.time >= s.at) s.phase = 'ready'; // a várakozás lejárta a plafontól függetlenül számít
      if (s.phase !== 'ready') continue;
      if (active >= c.maxActive || es.list.length >= es.cfg.maxEnemies) continue; // teli: nem születik, de a többi pont várakozása tovább frissül
      const d = minDistTo(pts, pt.x, pt.y);
      if (d < c.minDist || d > c.maxDist) continue;
      const def = getEnemyDef(es.reg, pt.type); if (!def) { s.phase = 'bad'; sp.stats.bad++; continue; }
      const chk = placeCheck(sp, pt, def, env);
      if (chk === 'defer') { sp.stats.deferred++; continue; }
      if (chk === 'bad') { s.phase = 'bad'; sp.stats.bad++; continue; }
      const e = spawnEnemy(es, pt.type, pt.x, pt.y); if (!e) continue;
      e.spawnId = pt.id; s.phase = 'alive'; s.enemy = e; sp.stats.spawned++; res.spawned++; active++;
    }
  } catch (err) { sp.lastError = err; }
  return res;
}
