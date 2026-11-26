// game-mining.js (S078) – BÁNYA-TARTALOM: ásás (csákány), érc, robbantás (kráter + láncreakció), sötétség (FÉNY/FÁKLYA-tag).
// Tiszta logika, DOM/canvas nélkül; Node-ban tesztelhető. Az aktív 'mine' instance világán dolgozik (game-instance: instanceWorld/instanceData).
// A kitermelt csempék (T.STONE -> T.ROAD) az instance JSON-zsákjába kerülnek (zsák.mine = {v:1, dug:[csempe-index]}), így a mentés őrzi;
// a térkép eredeti állapotát a modul őrzi, és ha a zsák cserélődik (mentés-betöltés), újraépíti a bányát. A fal-lista minden változás után frissül
// (world.walls + mgr.version++, a main.js ebből frissíti az ütközőket). A T.WALL (keret) soha nem bontható. A robbantás töltete: blast_charge (a craft: S139).
import { T } from './world-tiles.js';
import { getTile, mapToWalls } from './world-tilemap.js';
import { hashInt, mulberry32 } from './world-noise.js';
import { addItem, canAdd } from './game-inventory.js';
import { bestTool } from './game-nodes.js';
import { playerTagSet } from './game-tools.js';
import { instanceWorld, instanceData } from './game-instance.js';
import { mineLayerAt } from './world-mine.js';

export const MINING_CONFIG = Object.freeze({
  tile: 32, reach: 14,                 // px: a célcsempe a játékos széle előtt ennyivel
  stoneTime: 1.6, oreTime: 3, oreTimeStep: 0.5, // mp/csempe 1-es sebességnél; az érc ideje tier-enként +oreTimeStep
  stoneTier: 1, oreGate: 1,            // kő: csákány-tier >= 1; érc: tier >= max(1, érc-tier - oreGate) (puha kapu)
  maxSpeed: 20, stoneChance: 0.5,      // a kő 50%-ban 1–2 követ ad
  fuse: 2.5, chainDelay: 0.25, craterR: 2.3, chainR: 3.5, // töltet: gyújtózsinór mp, láncreakció-késés mp, kráter- és lánc-sugár (tile)
  blastDamage: 40, blastRadius: 96, oreMul: 0.6, maxCharges: 8, // robbanás: sebzés (a hívó skálázza), sugár px, érc-kihozatal szorzó (min. 1)
  maxDug: 4096, maxStep: 0.25, darkTick: 1, darkSecs: 3,
});
/** érc-fajta -> [tárgy, min, max] (a world-mine MINE_ORE_KINDS fajtái; a tárgyak a data-items.js-ben) */
export const ORE_TABLE = Object.freeze({
  copper: Object.freeze(['copper_ore', 1, 3]), coal: Object.freeze(['coal', 1, 3]), iron: Object.freeze(['iron_ore', 1, 2]),
  silver: Object.freeze(['silver_ore', 1, 2]), gem: Object.freeze(['gem', 1, 1]),
});
export const LIGHT_TAGS = Object.freeze(['FÉNY', 'FÁKLYA']);

const fin = v => typeof v === 'number' && Number.isFinite(v);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

export function createMining(cfg = MINING_CONFIG) {
  const c = isObj(cfg) ? { ...MINING_CONFIG, ...cfg } : MINING_CONFIG;
  return { cfg: c, sess: [0, 1].map(() => ({ key: null, progress: 0, lock: false })), charges: [], nextId: 1, dark: [0, 0], darkT: [0, 0],
    bound: new WeakMap(), pristine: new WeakMap(), oreCache: new WeakMap(), events: [], stats: { dug: 0, blasts: 0, ores: 0, locked: 0, full: 0 } };
}

/** A fal-lista újraépítése a térképből (a világ-eltolással), és a verzió-jelzés a main.js-nek. */
export function refreshWalls(w, mgr) {
  w.walls = mapToWalls(w.map).map(r => ({ x: r.x + w.ox, y: r.y + w.oy, w: r.w, h: r.h }));
  if (mgr && fin(mgr.version)) mgr.version++;
}
function sanitizeMine(v, w, ms) {
  const pr = ms.pristine.get(w), dug = [], seen = new Set();
  for (const i of isObj(v) && Array.isArray(v.dug) ? v.dug : []) {
    if (dug.length >= ms.cfg.maxDug) break;
    if (Number.isInteger(i) && i >= 0 && i < pr.length && pr[i] === T.STONE && !seen.has(i)) { seen.add(i); dug.push(i); }
  }
  return { v: 1, dug };
}
/** Az aktív bánya-világ szinkronja a zsákkal -> {w, mine} | null (nincs aktív bánya). A zsák cserélődésekor (betöltés) a térkép újraépül, a töltetek törlődnek. */
export function mineWorld(ms, mgr) {
  const w = instanceWorld(mgr);
  if (!w || w.kind !== 'mine' || !w.meta || !(w.map.tiles instanceof Uint8Array)) return null;
  const z = instanceData(mgr, w.id);
  if (!z) return null;
  if (!ms.pristine.has(w)) ms.pristine.set(w, w.map.tiles.slice());
  if (ms.bound.get(w) !== z) {
    w.map.tiles.set(ms.pristine.get(w));
    z.mine = sanitizeMine(z.mine, w, ms);
    for (const i of z.mine.dug) w.map.tiles[i] = T.ROAD;
    ms.bound.set(w, z); ms.charges.length = 0; refreshWalls(w, mgr);
  }
  return { w, mine: z.mine };
}
/** Érc-csempék a meta-ból: Map (ty*cols+tx) -> {tier, kind}; világonként gyorsítótárazva. */
export function oreMap(ms, w) {
  let m = ms.oreCache.get(w);
  if (!m) {
    m = new Map();
    for (const l of w.meta.layers) for (const o of l.ores) m.set(o.ty * w.cols + o.tx, { tier: o.tier, kind: o.kind });
    ms.oreCache.set(w, m);
  }
  return m;
}
export const diggable = (w, tx, ty) => Number.isInteger(tx) && Number.isInteger(ty) && tx > 0 && ty > 0 && tx < w.cols - 1 && ty < w.rows - 1 && getTile(w.map, tx, ty) === T.STONE;
const tileXY = (w, x, y, S) => ({ tx: Math.floor((x - w.ox) / S), ty: Math.floor((y - w.oy) / S) });
/** A játékos előtti csempe a facing ({x,y} tengely-irány) szerint. */
export function targetTile(w, p, facing, cfg = MINING_CONFIG) {
  const f = isObj(facing) && fin(facing.x) && fin(facing.y) ? facing : { x: 0, y: 1 };
  return tileXY(w, p.x + Math.sign(f.x) * ((p.w || 24) / 2 + cfg.reach), p.y + Math.sign(f.y) * ((p.h || 24) / 2 + cfg.reach), cfg.tile);
}
/** A csempe kitermelési ideje (mp, 1-es sebességnél) és a kívánt csákány-tier. */
export function digNeed(cfg, ore) {
  return ore ? { time: cfg.oreTime + cfg.oreTimeStep * (ore.tier - 1), tier: Math.max(1, ore.tier - cfg.oreGate) } : { time: cfg.stoneTime, tier: cfg.stoneTier };
}
/** Determinisztikus drop a csempéből: [{item,n}] (kő: esély; érc: a tábla × mul, min. 1 — a robbantás mul < 1-gyel hívja, csak ércre). */
export function tileDrops(cfg, w, tx, ty, ore, mul = 1) {
  const rng = mulberry32(hashInt(tx, ty, w.seed));
  if (ore) { const t = ORE_TABLE[ore.kind]; if (!t) return []; return [{ item: t[0], n: Math.max(1, Math.floor((t[1] + Math.floor(rng() * (t[2] - t[1] + 1))) * mul)) }]; }
  return rng() < cfg.stoneChance ? [{ item: 'stone', n: 1 + Math.floor(rng() * 2) }] : [];
}
function breakTile(w, mine, tx, ty) { // a csempe járattá válik, a zsákba kerül
  const i = ty * w.cols + tx; w.map.tiles[i] = T.ROAD; mine.dug.push(i);
}
function fits(inv, list) { return !!inv && list.every(d => canAdd(inv, d.item, d.n)); }
function deliver(inv, list, x, y, drop) {
  for (const d of list) { const left = inv ? addItem(inv, d.item, d.n) : d.n; if (left > 0 && typeof drop === 'function') drop(d.item, left, x, y); }
}

/**
 * Ásás: a játékos tartja az interakciót a diggelhető csempe előtt. players[i], inputs[i] {interact}, inventories[i], ctx {facings[i] {x,y}, drop(item,n,x,y)}.
 * Esemény: dug{player,tx,ty,ore,items} | locked{player,tx,ty,need,have} (nyomásonként egyszer) | full{player,tx,ty} (tele inventory, nincs drop-callback).
 */
export function stepMining(ms, mgr, players, inputs, inventories, dt, ctx = {}) {
  const out = ms.events; out.length = 0;
  const mw = mineWorld(ms, mgr), cfg = ms.cfg;
  if (!mw || !fin(dt) || dt <= 0 || !Array.isArray(players)) { for (const s of ms.sess) { s.key = null; s.progress = 0; s.lock = false; } return out; }
  dt = Math.min(dt, cfg.maxStep);
  const { w, mine } = mw; let changed = false;
  for (let i = 0; i < 2 && i < players.length; i++) {
    const p = players[i], s = ms.sess[i], inp = inputs && inputs[i], inv = inventories && inventories[i];
    if (!p || !fin(p.x) || !fin(p.y) || !inp || !inp.interact) { s.key = null; s.progress = 0; s.lock = false; continue; }
    const { tx, ty } = targetTile(w, p, ctx.facings && ctx.facings[i], cfg);
    if (!diggable(w, tx, ty)) { s.key = null; s.progress = 0; s.lock = false; continue; }
    const key = tx + ',' + ty;
    if (s.key !== key) { s.key = key; s.progress = 0; s.lock = false; }
    const ore = oreMap(ms, w).get(ty * w.cols + tx) || null, need = digNeed(cfg, ore), tool = bestTool(inv, 'CSÁKÁNY'), have = tool ? tool.tier : 0;
    if (have < need.tier) { if (!s.lock) { s.lock = true; ms.stats.locked++; out.push({ type: 'locked', player: i, tx, ty, need: { tag: 'CSÁKÁNY', tier: need.tier }, have }); } continue; }
    if (mine.dug.length >= cfg.maxDug) continue;
    s.progress += dt * Math.min(cfg.maxSpeed, tool.speed) / need.time;
    if (s.progress < 1) continue;
    const items = tileDrops(cfg, w, tx, ty, ore, 1), cx = w.ox + (tx + 0.5) * cfg.tile, cy = w.oy + (ty + 0.5) * cfg.tile;
    if (!ctx.drop && !fits(inv, items)) { s.progress = 0.99; if (!s.lock) { s.lock = true; ms.stats.full++; out.push({ type: 'full', player: i, tx, ty }); } continue; }
    breakTile(w, mine, tx, ty); deliver(inv, items, cx, cy, ctx.drop); changed = true;
    ms.stats.dug++; if (ore) ms.stats.ores++;
    s.key = null; s.progress = 0; s.lock = false;
    out.push({ type: 'dug', player: i, tx, ty, ore: ore ? ore.kind : null, items });
  }
  if (changed) refreshWalls(w, mgr);
  return out;
}

/** Töltet lerakása a világ-pixelre -> {ok, reason: inactive|pos|solid|limit, id}. A tölteteket a stepBlasts robbantja; nem mentettek (rövid zsinór). */
export function placeCharge(ms, mgr, x, y, opts = {}) {
  const mw = mineWorld(ms, mgr);
  if (!mw) return { ok: false, reason: 'inactive', id: null };
  const { w } = mw, S = ms.cfg.tile;
  if (!fin(x) || !fin(y)) return { ok: false, reason: 'pos', id: null };
  const { tx, ty } = tileXY(w, x, y, S);
  if (tx < 0 || ty < 0 || tx >= w.cols || ty >= w.rows || getTile(w.map, tx, ty) === T.STONE || getTile(w.map, tx, ty) === T.WALL) return { ok: false, reason: 'solid', id: null };
  if (ms.charges.length >= ms.cfg.maxCharges) return { ok: false, reason: 'limit', id: null };
  const c = { id: ms.nextId++, tx, ty, x: w.ox + (tx + 0.5) * S, y: w.oy + (ty + 0.5) * S, t: fin(opts.fuse) && opts.fuse >= 0 ? opts.fuse : ms.cfg.fuse, owner: opts.owner === 0 || opts.owner === 1 ? opts.owner : -1 };
  ms.charges.push(c);
  return { ok: true, reason: null, id: c.id };
}
function detonate(ms, mgr, w, mine, c, ctx) {
  const cfg = ms.cfg, R = Math.ceil(cfg.craterR), om = oreMap(ms, w); let tiles = 0, ores = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > cfg.craterR * cfg.craterR) continue;
    const tx = c.tx + dx, ty = c.ty + dy;
    if (!diggable(w, tx, ty) || mine.dug.length >= cfg.maxDug) continue;
    const ore = om.get(ty * w.cols + tx) || null; breakTile(w, mine, tx, ty); tiles++;
    if (ore) { ores++; ms.stats.ores++; for (const d of tileDrops(cfg, w, tx, ty, ore, cfg.oreMul)) if (typeof ctx.drop === 'function') ctx.drop(d.item, d.n, w.ox + (tx + 0.5) * cfg.tile, w.oy + (ty + 0.5) * cfg.tile); }
  }
  for (const o of ms.charges) if (Math.hypot(o.x - c.x, o.y - c.y) <= cfg.chainR * cfg.tile) o.t = Math.min(o.t, cfg.chainDelay); // láncreakció
  if (typeof ctx.hurt === 'function') ctx.hurt({ x: c.x, y: c.y, r: cfg.blastRadius, amount: cfg.blastDamage, owner: c.owner });
  ms.stats.blasts++;
  return { type: 'blast', id: c.id, x: c.x, y: c.y, tx: c.tx, ty: c.ty, tiles, ores };
}
/** A zsinórok léptetése; a lejárt töltetek robbannak (kráter: csak T.STONE, a T.WALL/járat marad; a közeli töltetek `chainDelay` múlva követik). ctx {drop(item,n,x,y), hurt({x,y,r,amount,owner})} */
export function stepBlasts(ms, mgr, dt, ctx = {}) {
  const out = ms.events; out.length = 0;
  const mw = mineWorld(ms, mgr);
  if (!mw) { ms.charges.length = 0; return out; }
  if (!fin(dt) || dt <= 0) return out;
  for (const c of ms.charges) c.t -= Math.min(dt, ms.cfg.maxStep);
  const due = ms.charges.filter(c => c.t <= 0);
  if (!due.length) return out;
  ms.charges = ms.charges.filter(c => c.t > 0);
  for (const c of due) out.push(detonate(ms, mgr, mw.w, mw.mine, c, ctx));
  refreshWalls(mw.w, mgr);
  return out;
}

/**
 * Sötétség: a sötét rétegben (meta.layers[].dark) FÉNY/FÁKLYA-tag vagy fényforrás nélkül a játékos `darkness` státuszt kap (darkTick másodpercenként).
 * ctx {apply(i,'darkness',{secs}), lit(x,y) -> bool (pl. lightAt(wizard,x,y))}. -> [{dark, lit, layer}] játékosonként (a layer az index | -1)
 */
export function stepDark(ms, mgr, players, inventories, dt, ctx = {}) {
  const mw = mineWorld(ms, mgr), res = [];
  for (let i = 0; i < 2; i++) {
    const p = players && players[i];
    if (!mw || !p || !fin(p.x) || !fin(p.y)) { res.push({ dark: false, lit: false, layer: -1 }); ms.dark[i] = 0; ms.darkT[i] = 0; continue; }
    const layer = mineLayerAt(mw.w.meta, tileXY(mw.w, p.x, p.y, ms.cfg.tile).ty), inDark = !!layer && layer.dark;
    let lit = false;
    if (inDark) {
      const tags = playerTagSet(inventories && inventories[i], p, []);
      lit = LIGHT_TAGS.some(t => tags.has(t)) || (typeof ctx.lit === 'function' && !!ctx.lit(p.x, p.y));
    }
    const dark = inDark && !lit;
    if (dark && fin(dt) && dt > 0) {
      ms.darkT[i] -= dt;
      if (ms.darkT[i] <= 0) { ms.darkT[i] = ms.cfg.darkTick; if (typeof ctx.apply === 'function') { try { ctx.apply(i, 'darkness', { secs: ms.cfg.darkSecs }); } catch (e) { /* a hívó hibája nem állítja meg a bányát */ } } }
    } else if (!dark) ms.darkT[i] = 0;
    ms.dark[i] = dark ? 1 : 0;
    res.push({ dark, lit, layer: layer ? layer.index : -1 });
  }
  return res;
}
