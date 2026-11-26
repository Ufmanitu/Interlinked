// S076: INSTANCE-KEZELÉS — dungeon/bánya = külön világ-állapot a nyílt világ mellett. Tiszta logika (nincs DOM/canvas függés).
// Az aktív instance csempe-térképe a világ távoli részén (INSTANCE_CONFIG.originX/Y) áll, ugyanabban a koordináta-térben, mint a nyílt világ
// (mint a warp-zsebek): a póráz, a kamerák, az osztott képernyő, az interakció és a falak VÁLTOZATLANUL működnek, bent a póráz mindig aktív
// (a Sorskő-mező messze van: f = 0 -> L_eff = L_normal). Belépés PÁROS: az egyik játékos kezdeményez, a társat a fonal átvonja. Kilépés ugyanoda
// (a bejárat elé). Az instance állapota (hol vagyunk, a visszatérési pont, instance-enként egy JSON-zsák a későbbi lépéseknek) mentett;
// a csempe-térkép a def-ből determinisztikusan újragenerálódik, ezért nem része a mentésnek.
// A generátorok az INSTANCE_GENERATORS-ban vannak: 'mine' (S077, world-mine.js), 'dungeon' (S079, world-dungeon.js); a 'room' helyőrző/teszt.
import { createTileMap, setTile, getTile, mapToWalls, floodReach } from './world-tilemap.js';
import { T, TILE_SIZE, isSolidId } from './world-tiles.js';
import { mulberry32 } from './world-noise.js';
import { generateMine } from './world-mine.js'; // S077
import { generateDungeon, DUNGEON_DEFS, DUNGEON_TEXTS } from './world-dungeon.js'; // S079

const S = TILE_SIZE;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const fin = v => typeof v === 'number' && Number.isFinite(v);
const int = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
const isPoint = p => isObj(p) && fin(p.x) && fin(p.y);
const ID_RE = /^[a-z][a-z0-9_]{1,31}$/, GEN_RE = /^[a-z][a-z0-9_]{0,31}$/;

export const INSTANCE_KINDS = ['mine', 'dungeon', 'cave'];
export const INSTANCE_CONFIG = Object.freeze({
  originX: 4194304, originY: 4194304, // az aktív instance bal-felső sarka (a chunk-világtól és a warp-zsebektől távol)
  pairGap: 48,        // a pár érkezési távolsága (px, középpontok)
  cooldown: 0.6,      // mp: be-/kilépés után ennyi ideig nincs újabb átlépés
  reach: 96,          // px: a kezdeményező legfeljebb ennyire lehet a bejárat/kijárat zónájától
  maxPull: 1600,      // px: a társ legfeljebb ennyire lehet (a fonal L_eff-je ennél kisebb: a társ átvonható)
  retDy: 48,          // px: a visszatérési pont a bejárat alatt
  maxCols: 256, maxRows: 256, minSize: 12,
  maxStateBytes: 65536, // egy instance JSON-zsákjának plafonja a mentésben
  maxDt: 1, maxTime: 1e9,
  freeStep: 16, freeRing: 10, // szabad érkezési pont keresése a kilépésnél
});

export function sanitizeInstanceConfig(src) {
  const c = { ...INSTANCE_CONFIG };
  if (isObj(src)) for (const k of Object.keys(c)) if (fin(src[k]) && src[k] >= 0) c[k] = src[k];
  return Object.freeze(c);
}

// --- Adat (az S077/S079 külön data-instances.js-be viheti) ---
export const INSTANCE_DEFS = [
  // a makrótérkép 'meadow_mine' bejáratának célja (data-macro.js: target 'mine_meadow'); S077: generator 'mine' (world-mine.js), depth = a rétegek száma, a profil a MINE_PROFILES-ban
  { id: 'mine_meadow', kind: 'mine', nameKey: 'instance.mine_meadow', generator: 'mine', seed: 7601, cols: 48, rows: 66, depth: 3 },
  ...DUNGEON_DEFS, // S079: dungeon_ruin (generator 'dungeon'; a makró-bejárat köti: S098/S124)
];
export const INSTANCE_TEXTS = {
  hu: { 'instance.mine_meadow': 'Réti bánya', 'save.err.instance': 'Hibás bánya-/barlang-adat a mentésben', ...DUNGEON_TEXTS.hu },
  en: { 'instance.mine_meadow': 'Meadow mine', 'save.err.instance': 'Invalid mine/dungeon data in the save', ...DUNGEON_TEXTS.en },
};

export function validateInstanceDef(def, cfg = INSTANCE_CONFIG) {
  const bad = error => ({ ok: false, instance: null, error });
  if (!isObj(def)) return bad('def');
  if (typeof def.id !== 'string' || !ID_RE.test(def.id)) return bad('id');
  if (!INSTANCE_KINDS.includes(def.kind)) return bad('kind');
  if (typeof def.generator !== 'string' || !GEN_RE.test(def.generator)) return bad('generator');
  if (!int(def.seed, 0, 2147483647)) return bad('seed');
  if (!int(def.cols, cfg.minSize, cfg.maxCols)) return bad('cols');
  if (!int(def.rows, cfg.minSize, cfg.maxRows)) return bad('rows');
  if (def.depth !== undefined && !int(def.depth, 0, 99)) return bad('depth');
  if (def.nameKey !== undefined && (typeof def.nameKey !== 'string' || !def.nameKey || def.nameKey.length > 64)) return bad('nameKey');
  return { ok: true, error: null, instance: Object.freeze({ id: def.id, kind: def.kind, generator: def.generator, seed: def.seed, cols: def.cols, rows: def.rows, depth: def.depth || 0, nameKey: def.nameKey || 'instance.' + def.id }) };
}

export function createInstanceRegistry(defs = INSTANCE_DEFS, cfg = INSTANCE_CONFIG) {
  const reg = { defs: new Map(), errors: [], dups: [] };
  const list = Array.isArray(defs) ? defs : isObj(defs) ? Object.values(defs) : [];
  for (const d of list) {
    const r = validateInstanceDef(d, cfg);
    if (!r.ok) { reg.errors.push((isObj(d) && typeof d.id === 'string' ? d.id : '?') + ':' + r.error); continue; }
    if (reg.defs.has(r.instance.id)) reg.dups.push(r.instance.id);
    reg.defs.set(r.instance.id, r.instance);
  }
  return reg;
}
export function getInstanceDef(reg, id) { return reg && reg.defs instanceof Map && typeof id === 'string' ? reg.defs.get(id) || null : null; }

// A makrótérkép bejáratainak és a generátoroknak az ellenőrzése -> ['entrance:<id>', 'generator:<instance>'] hiányok (tests.html jelzi)
export function auditInstances(reg, entrances, gens = INSTANCE_GENERATORS) {
  const out = [];
  for (const e of Array.isArray(entrances) ? entrances : []) if (e && e.target && !getInstanceDef(reg, e.target)) out.push('entrance:' + e.id);
  for (const d of reg && reg.defs ? reg.defs.values() : []) if (!gens || typeof gens[d.generator] !== 'function') out.push('generator:' + d.id);
  return out;
}

// --- Generátorok: def -> {map (kerete ütköző), entry {tx,ty}, exit {tx,ty,w,h}} ---
// 'room' (S076 helyőrző): téglalap alakú terem, 2 tile vastag fal-keret, egyedi oszlopok (nincs két oszlop szomszédos: nem zárhatnak el járatot),
// az érkezés a terem alján, a kijárat 3 tile széles a fal előtt, az érkezéstől 3 tile-ra.
function generateRoom(def) {
  const { cols, rows } = def, map = createTileMap(cols, rows, T.WALL), rng = mulberry32(def.seed);
  for (let ty = 2; ty < rows - 2; ty++) for (let tx = 2; tx < cols - 2; tx++) setTile(map, tx, ty, rng() < 0.12 ? T.SAND : T.ROAD);
  const want = Math.floor(cols * rows / 70);
  let placed = 0;
  for (let n = 0; n < want * 6; n++) { // állandó RNG-fogyasztás kísérletenként
    const tx = 4 + Math.floor(rng() * (cols - 8)), ty = 4 + Math.floor(rng() * Math.max(1, rows - 12));
    let free = placed < want;
    for (let dy = -1; dy <= 1 && free; dy++) for (let dx = -1; dx <= 1; dx++) if (isSolidId(getTile(map, tx + dx, ty + dy))) { free = false; break; }
    if (free) { setTile(map, tx, ty, T.STONE); placed++; }
  }
  const cx = cols >> 1;
  return { map, entry: { tx: cx, ty: rows - 6 }, exit: { tx: cx - 1, ty: rows - 3, w: 3, h: 1 } };
}
export const INSTANCE_GENERATORS = { room: generateRoom, mine: generateMine, dungeon: generateDungeon };

// Az instance világ-állapota a def-ből (determinisztikus): {id,kind,seed,cols,rows,map,ox,oy,bounds,entry{x,y},exit{x,y,w,h},walls[{x,y,w,h}]} (világ-pixel)
export function buildInstanceWorld(def, cfg = INSTANCE_CONFIG, gens = INSTANCE_GENERATORS) {
  const fail = error => ({ ok: false, world: null, error });
  if (!isObj(def)) return fail('def');
  const gen = gens && Object.prototype.hasOwnProperty.call(gens, def.generator) ? gens[def.generator] : null;
  if (typeof gen !== 'function') return fail('generator');
  let g; try { g = gen(def); } catch (e) { return fail('gen'); }
  const m = isObj(g) ? g.map : null;
  if (!isObj(m) || !int(m.cols, 1, cfg.maxCols) || !int(m.rows, 1, cfg.maxRows) || !(m.tiles instanceof Uint8Array) || m.tiles.length !== m.cols * m.rows) return fail('map');
  const en = g.entry, ex = g.exit;
  if (!isObj(en) || !int(en.tx, 0, m.cols - 1) || !int(en.ty, 0, m.rows - 1)) return fail('entry');
  if (!isObj(ex) || !int(ex.tx, 0, m.cols - 1) || !int(ex.ty, 0, m.rows - 1) || !int(ex.w, 1, 16) || !int(ex.h, 1, 16) || ex.tx + ex.w > m.cols || ex.ty + ex.h > m.rows) return fail('exit');
  for (let tx = 0; tx < m.cols; tx++) if (!isSolidId(getTile(m, tx, 0)) || !isSolidId(getTile(m, tx, m.rows - 1))) return fail('frame'); // a mapToWalls nem ad automatikus keretet
  for (let ty = 0; ty < m.rows; ty++) if (!isSolidId(getTile(m, 0, ty)) || !isSolidId(getTile(m, m.cols - 1, ty))) return fail('frame');
  if (isSolidId(getTile(m, en.tx, en.ty))) return fail('entry');
  const reach = floodReach(m, en.tx, en.ty);
  for (let ty = ex.ty; ty < ex.ty + ex.h; ty++) for (let tx = ex.tx; tx < ex.tx + ex.w; tx++) {
    if (isSolidId(getTile(m, tx, ty))) return fail('exit');
    if (!reach[ty * m.cols + tx]) return fail('unreachable');
  }
  const ox = cfg.originX, oy = cfg.originY;
  return { ok: true, error: null, world: {
    id: def.id, kind: def.kind, seed: def.seed, cols: m.cols, rows: m.rows, map: m, ox, oy,
    bounds: { x: ox, y: oy, w: m.cols * S, h: m.rows * S },
    entry: { x: ox + (en.tx + 0.5) * S, y: oy + (en.ty + 0.5) * S },
    exit: { x: ox + ex.tx * S, y: oy + ex.ty * S, w: ex.w * S, h: ex.h * S },
    meta: isObj(g.meta) ? g.meta : null, // S077: a generátor extra adata (bánya: rétegek, érc-/ellenség-pontok)
    walls: mapToWalls(m).map(r => ({ x: r.x + ox, y: r.y + oy, w: r.w, h: r.h })),
  } };
}

// --- Kezelő ---
export function createInstanceManager({ reg, gens, cfg } = {}) {
  return { reg: reg || createInstanceRegistry(), gens: gens || INSTANCE_GENERATORS, cfg: sanitizeInstanceConfig(cfg),
    active: null, worlds: new Map(), data: new Map(), cool: 0, version: 0, events: [], listeners: new Set(), last: null,
    stats: { entered: 0, exited: 0, failed: 0 }, lastError: null };
}
export function onInstance(mgr, fn) {
  if (!mgr || typeof fn !== 'function') return () => {};
  mgr.listeners.add(fn); return () => mgr.listeners.delete(fn);
}
function emit(mgr, ev) {
  mgr.events.push(ev); if (mgr.events.length > 64) mgr.events.shift();
  for (const fn of [...mgr.listeners]) { try { fn(ev); } catch (e) { mgr.lastError = e; } }
}
function worldFor(mgr, id) {
  let w = mgr.worlds.get(id);
  if (w) return w;
  const def = getInstanceDef(mgr.reg, id);
  if (!def) return null;
  const r = buildInstanceWorld(def, mgr.cfg, mgr.gens);
  if (!r.ok) { mgr.lastError = r.error; return null; }
  mgr.worlds.set(id, r.world);
  return r.world;
}
export const instanceWhere = mgr => (mgr && mgr.active ? mgr.active.id : null);
export const instanceWorld = mgr => (mgr && mgr.active ? worldFor(mgr, mgr.active.id) : null);

export function entranceRect(e) { // makró-bejárat (tile) -> px téglalap | null
  if (!isObj(e) || !int(e.w, 1, 64) || !int(e.h, 1, 64) || !Number.isInteger(e.tx) || !Number.isInteger(e.ty)) return null;
  return { x: e.tx * S, y: e.ty * S, w: e.w * S, h: e.h * S };
}
const rectDist = (px, py, r) => Math.hypot(Math.max(r.x - px, 0, px - (r.x + r.w)), Math.max(r.y - py, 0, py - (r.y + r.h)));

function placePair(players, x, y, gap) {
  for (let i = 0; i < 2; i++) { const p = players[i]; p.x = x + (i === 0 ? -gap / 2 : gap / 2); p.y = y; p.vx = 0; p.vy = 0; p.kbx = 0; p.kby = 0; }
}

// Szabad érkezési pont a (x,y) körül (a pár két helye is szabad); free(x,y) -> bool. Nincs találat -> az eredeti pont.
export function findFreePair(x, y, gap, free, cfg = INSTANCE_CONFIG) {
  if (typeof free !== 'function') return { x, y };
  const ok = (px, py) => { try { return !!free(px - gap / 2, py) && !!free(px + gap / 2, py); } catch (e) { return false; } };
  if (ok(x, y)) return { x, y };
  for (let r = 1; r <= cfg.freeRing; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const px = x + dx * cfg.freeStep, py = y + dy * cfg.freeStep;
    if (ok(px, py)) return { x: px, y: py };
  }
  return { x, y };
}

/**
 * Páros belépés a makró-bejáraton át. opts {initiator 0|1, blocked(p,i)->bool (pl. zsebben álló játékos), force (cooldown/hatótáv nélkül)}.
 * -> {ok,type:'enter',id,reason null|busy|cooldown|players|entrance|target|reach|far|blocked|gen}. Hibánál semmi nem változik.
 */
export function enterInstance(mgr, players, entrance, opts = {}) {
  const o = isObj(opts) ? opts : {};
  const res = reason => { if (mgr) { mgr.stats.failed++; mgr.last = { ok: false, type: 'enter', id: null, reason }; emit(mgr, { type: 'fail', reason }); return mgr.last; } return { ok: false, type: 'enter', id: null, reason }; };
  if (!mgr || !mgr.cfg) return res('busy');
  if (mgr.active) return res('busy');
  if (mgr.cool > 0 && !o.force) return res('cooldown');
  if (!Array.isArray(players) || players.length < 2 || !isPoint(players[0]) || !isPoint(players[1])) return res('players');
  const rect = entranceRect(entrance);
  if (!rect || typeof entrance.id !== 'string' || typeof entrance.target !== 'string') return res('entrance');
  if (!getInstanceDef(mgr.reg, entrance.target)) return res('target');
  const who = o.initiator === 1 ? 1 : 0, c = mgr.cfg;
  if (!o.force && rectDist(players[who].x, players[who].y, rect) > c.reach) return res('reach');
  if (Math.hypot(players[0].x - players[1].x, players[0].y - players[1].y) > c.maxPull) return res('far');
  if (typeof o.blocked === 'function') { let b = false; try { b = players.slice(0, 2).some((p, i) => o.blocked(p, i)); } catch (e) { b = true; } if (b) return res('blocked'); }
  const w = worldFor(mgr, entrance.target);
  if (!w) return res('gen');
  const ret = { x: rect.x + rect.w / 2, y: rect.y + rect.h + c.retDy };
  mgr.active = { id: w.id, entrance: entrance.id, ret, t: 0 };
  placePair(players, w.entry.x, w.entry.y, c.pairGap);
  mgr.cool = c.cooldown; mgr.version++; mgr.stats.entered++;
  mgr.last = { ok: true, type: 'enter', id: w.id, reason: null };
  emit(mgr, { type: 'enter', id: w.id, entrance: entrance.id, player: who, ret: { x: ret.x, y: ret.y } });
  return mgr.last;
}

/**
 * Kilépés ugyanoda (a bejárat elé). opts {place (alap igaz: a pár a visszatérési pontra kerül), free(x,y)->bool (szabad pont keresése),
 * force (cooldown nélkül), reason 'exit'|'wipe'|..., initiator}. place:false: a hívó már máshová tette a játékosokat (pl. újraélesztés Sorskőnél).
 * -> {ok,type:'exit',id,ret,reason null|none|cooldown|players}
 */
export function exitInstance(mgr, players, opts = {}) {
  const o = isObj(opts) ? opts : {};
  if (!mgr || !mgr.active) return { ok: false, type: 'exit', id: null, ret: null, reason: 'none' };
  if (mgr.cool > 0 && !o.force) return { ok: false, type: 'exit', id: mgr.active.id, ret: null, reason: 'cooldown' };
  const place = o.place !== false;
  if (place && (!Array.isArray(players) || players.length < 2 || !isPoint(players[0]) || !isPoint(players[1]))) return { ok: false, type: 'exit', id: mgr.active.id, ret: null, reason: 'players' };
  const a = mgr.active, c = mgr.cfg;
  const spot = place ? findFreePair(a.ret.x, a.ret.y, c.pairGap, o.free, c) : { x: a.ret.x, y: a.ret.y };
  if (place) placePair(players, spot.x, spot.y, c.pairGap);
  mgr.active = null; mgr.cool = c.cooldown; mgr.version++; mgr.stats.exited++;
  mgr.last = { ok: true, type: 'exit', id: a.id, ret: spot, reason: null };
  emit(mgr, { type: 'exit', id: a.id, entrance: a.entrance, reason: typeof o.reason === 'string' ? o.reason : 'exit', t: a.t, ret: { x: spot.x, y: spot.y } });
  return mgr.last;
}

// Logikai lépés: cooldown fogy, az instance-ben töltött idő nő.
export function stepInstance(mgr, dt) {
  if (!mgr || !(dt > 0) || !fin(dt)) return;
  const d = Math.min(dt, mgr.cfg.maxDt);
  mgr.cool = Math.max(0, mgr.cool - d);
  if (mgr.active) mgr.active.t = Math.min(mgr.cfg.maxTime, mgr.active.t + d);
}

const near = (z, r, m) => z.x < r.x + r.w + m && r.x - m < z.x + z.w && z.y < r.y + r.h + m && r.y - m < z.y + z.h;
/** Interakció-forrás: kint a makró-bejáratok ('enter'), bent a kijárat ('exit'). addProvider(sys, instanceProvider(mgr, mm.entrances)). */
export function instanceProvider(mgr, entrances) {
  return function instanceTargets(zone, out, cfg) {
    if (!mgr || !zone) return out;
    const m = cfg && cfg.prefilter > 0 ? cfg.prefilter : 96;
    if (mgr.active) {
      const w = instanceWorld(mgr);
      if (w && near(zone, w.exit, m)) out.push({ key: 'inst:' + w.id + ':exit', kind: 'instance', ref: { id: w.id, role: 'exit' }, action: 'exit', rect: w.exit, ax: w.exit.x + w.exit.w / 2, ay: w.exit.y });
      return out;
    }
    for (const e of Array.isArray(entrances) ? entrances : []) {
      const r = entranceRect(e);
      if (!r || !getInstanceDef(mgr.reg, e.target) || !near(zone, r, m)) continue;
      out.push({ key: 'inst:' + e.id + ':enter', kind: 'instance', ref: { id: e.id, role: 'enter' }, action: 'enter', rect: r, ax: r.x + r.w / 2, ay: r.y });
    }
    return out;
  };
}

/** Az 'interact' esemény feldolgozása (ev.kind === 'instance'): a pár átlép. opts {entrances, blocked, free}. -> eredmény | null (nem instance-esemény) */
export function handleInstanceEvent(mgr, players, ev, opts = {}) {
  if (!mgr || !isObj(ev) || ev.kind !== 'instance' || !isObj(ev.target)) return null;
  const o = isObj(opts) ? opts : {}, who = ev.player === 1 ? 1 : 0;
  if (ev.target.role === 'enter') return enterInstance(mgr, players, (Array.isArray(o.entrances) ? o.entrances : []).find(e => e && e.id === ev.target.id), { initiator: who, blocked: o.blocked });
  if (ev.target.role === 'exit') return mgr.active && ev.target.id === mgr.active.id ? exitInstance(mgr, players, { free: o.free, initiator: who }) : { ok: false, type: 'exit', id: null, ret: null, reason: 'none' };
  return null;
}

/** Betöltés után (régi mentés, hiányzó 'ins' szekció): ha az instance aktív, de valamelyik játékos kívül áll a térképén, az instance lezárul
 *  (a játékosokat nem mozdítja). -> bool (változott) */
export function reconcileInstance(mgr, players) {
  const w = instanceWorld(mgr);
  if (!w || !Array.isArray(players) || players.length < 2) return false;
  const m = S * 2, b = w.bounds;
  const ok = p => isPoint(p) && p.x > b.x - m && p.x < b.x + b.w + m && p.y > b.y - m && p.y < b.y + b.h + m;
  if (ok(players[0]) && ok(players[1])) return false;
  return exitInstance(mgr, players, { place: false, force: true, reason: 'reconcile' }).ok;
}

// --- Lekérdezések ---
export function instanceColliders(mgr, out = []) { const w = instanceWorld(mgr); if (w) for (const r of w.walls) out.push(r); return out; }
export function instanceTileAt(mgr, wx, wy) { // csempe-azonosító a világ-pixelen | -1 (nincs aktív instance / a térképen kívül)
  const w = instanceWorld(mgr);
  return w ? getTile(w.map, Math.floor((wx - w.ox) / S), Math.floor((wy - w.oy) / S)) : -1;
}
export function instanceSolidAt(mgr, wx, wy) { if (!instanceWorld(mgr)) return false; const id = instanceTileAt(mgr, wx, wy); return id < 0 || isSolidId(id); }
/** A chunk-streaming pontjai: instance-ben a bejárat előtti pont (a kinti világ betöltve marad, a kilépés azonnali); különben a kapott pontok. */
export function instanceStreamPoints(mgr, base, out = []) {
  if (!mgr || !mgr.active) return base;
  out.length = 0;
  for (let i = 0; i < 2; i++) out.push({ x: mgr.active.ret.x, y: mgr.active.ret.y });
  return out;
}
/** Instance-enkénti JSON-zsák a későbbi lépéseknek (kiürített szobák, ládák...; mentett). Ismeretlen id -> null. A hívó ne tárolja el: betöltéskor a zsák cserélődik. */
export function instanceData(mgr, id) {
  if (!mgr || !getInstanceDef(mgr.reg, id)) return null;
  let d = mgr.data.get(id);
  if (!d) { d = {}; mgr.data.set(id, d); }
  return d;
}

// --- Mentés (az S050 szekció-formátumban: INSTANCE_SECTION; a szekciót a main.js regisztrálja a game-save SECTIONS tömbjébe) ---
export function instanceState(mgr) {
  const data = {};
  for (const [id, v] of mgr.data) data[id] = JSON.parse(JSON.stringify(v));
  const a = mgr.active;
  return { v: 1, active: a ? { id: a.id, entrance: a.entrance, ret: { x: a.ret.x, y: a.ret.y }, t: a.t } : null, data };
}
function cloneJson(v, max) {
  if (!isObj(v)) return null;
  try { const s = JSON.stringify(v); return s.length > max ? null : JSON.parse(s); } catch (e) { return null; }
}
/** Visszatöltés: ATOMI (hibánál semmi nem változik), csendes (nincs esemény), a játékosokat nem mozdítja (a pozíciók a mentésben vannak). -> bool */
export function restoreInstances(mgr, st) {
  if (!mgr || !isObj(st) || st.v !== 1) return false;
  let active = null;
  if (st.active !== null && st.active !== undefined) {
    const a = st.active;
    if (!isObj(a) || !getInstanceDef(mgr.reg, a.id) || typeof a.entrance !== 'string' || !a.entrance || a.entrance.length > 64) return false;
    if (!isObj(a.ret) || !fin(a.ret.x) || !fin(a.ret.y) || Math.abs(a.ret.x) > 1e8 || Math.abs(a.ret.y) > 1e8 || !fin(a.t) || a.t < 0) return false;
    if (!worldFor(mgr, a.id)) return false;
    active = { id: a.id, entrance: a.entrance, ret: { x: a.ret.x, y: a.ret.y }, t: Math.min(a.t, mgr.cfg.maxTime) };
  }
  const data = new Map();
  if (st.data !== undefined) {
    if (!isObj(st.data)) return false;
    for (const [id, v] of Object.entries(st.data)) {
      if (!getInstanceDef(mgr.reg, id)) continue; // ismeretlen (régi) instance adata kimarad
      const c = cloneJson(v, mgr.cfg.maxStateBytes);
      if (!c) return false;
      data.set(id, c);
    }
  }
  mgr.active = active; mgr.data = data; mgr.cool = 0; mgr.version++;
  return true;
}
export const INSTANCE_SECTION = {
  key: 'ins', err: 'instance',
  has: c => isObj(c) && isObj(c.instances) && isObj(c.instances.reg) && c.instances.worlds instanceof Map,
  cap: c => instanceState(c.instances), ok: isObj, put: (c, d) => restoreInstances(c.instances, d),
};
/** A szekció felvétele a game-save SECTIONS tömbjébe (idempotens) -> bool (új felvétel volt) */
export function registerInstanceSave(sections) {
  if (!Array.isArray(sections) || sections.some(s => s && s.key === INSTANCE_SECTION.key)) return false;
  sections.push(INSTANCE_SECTION); return true;
}
