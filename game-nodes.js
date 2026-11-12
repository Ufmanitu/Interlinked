// game-nodes.js (S037) – erőforrás-node-ok: gyűjtés, drop-tábla, újranövés (tiszta logika, DOM/canvas nélkül; Node-ban tesztelhető).
// A node egy világ-objektum (fa, kő, gyógynövény) gyűjthető tulajdonságokkal (data-nodes.js). A gyűjtés: az interakció gombot TARTANI kell a
// célpont előtt; minden `time` mp egy ütés (hp csökken), hp 0-nál a drop-tábla gurul, a tárgyak az inventoryba kerülnek, az objektum eltűnik
// (world-objects removeObject), és `regrow` játékperc múlva visszanő. Tele inventorynál semmi nem vész el: a node megmarad, 'full' esemény.
import { mulberry32 } from './world-noise.js';
import { addItem, inventoryState, restoreInventory } from './game-inventory.js';
import { OBJECT_DEFS, removeObject, restoreObject } from './world-objects.js';
import { NODE_DEFS } from './data-nodes.js';

export const NODE_LIMITS = { maxHp: 99, minTime: 0.05, maxTime: 60, maxRegrow: 1e6, maxHeal: 3600, maxDrops: 8, maxCount: 999, maxDepleted: 100000 };
export const NODE_CONFIG = { maxHitsPerStep: 8, fullFlash: 0.8, maxSpeed: 20, maxPower: 99, action: 'gather' };
export const NODE_STATE_VERSION = 1;

const ID_RE = /^-?\d+,-?\d+:\d+$/;
const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** Egy node-definíció ellenőrzése -> {ok, node (fagyasztott)|null, error}; sosem dob. A típus létező objektum-típus kell legyen. */
export function validateNodeDef(def) {
  const bad = error => ({ ok: false, node: null, error });
  if (!def || typeof def !== 'object') return bad('def');
  const type = def.type, L = NODE_LIMITS;
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(OBJECT_DEFS, type)) return bad('type');
  if (!Number.isInteger(def.hp) || def.hp < 1 || def.hp > L.maxHp) return bad(type + ':hp');
  if (!isNum(def.time) || def.time < L.minTime || def.time > L.maxTime) return bad(type + ':time');
  if (!isNum(def.regrow) || def.regrow <= 0 || def.regrow > L.maxRegrow) return bad(type + ':regrow');
  const heal = def.heal === undefined ? 0 : def.heal;
  if (!isNum(heal) || heal < 0 || heal > L.maxHeal) return bad(type + ':heal');
  if (!Array.isArray(def.drops) || def.drops.length > L.maxDrops) return bad(type + ':drops');
  const drops = [];
  for (const d of def.drops) {
    if (!d || typeof d.item !== 'string' || !d.item) return bad(type + ':drop.item');
    const min = d.min === undefined ? 1 : d.min, max = d.max === undefined ? min : d.max, chance = d.chance === undefined ? 1 : d.chance;
    if (!Number.isInteger(min) || min < 0 || !Number.isInteger(max) || max < min || max > L.maxCount) return bad(type + ':drop.count');
    if (!isNum(chance) || chance < 0 || chance > 1) return bad(type + ':drop.chance');
    drops.push(Object.freeze({ item: d.item, min, max, chance }));
  }
  return { ok: true, error: null, node: Object.freeze({ type, hp: def.hp, time: def.time, regrow: def.regrow, heal, drops: Object.freeze(drops), nameKey: OBJECT_DEFS[type].nameKey }) };
}

/** Nyilvántartás: típus -> node. Hibás kiesik (errors), duplikátum felülír (dups). */
export function createNodeRegistry(defs = NODE_DEFS) {
  const reg = { nodes: new Map(), errors: [], dups: new Set() };
  for (const d of Array.isArray(defs) ? defs : []) {
    const r = validateNodeDef(d);
    if (!r.ok) { reg.errors.push(r.error); continue; }
    if (reg.nodes.has(r.node.type)) reg.dups.add(r.node.type);
    reg.nodes.set(r.node.type, r.node);
  }
  return reg;
}

/** Hiányzó tárgy-hivatkozások a drop-táblákban (az itemReg: createItemRegistry) -> ['típus:tárgy'] (a tests.html / S052 jelzi). */
export function auditNodes(reg, itemReg) {
  const out = [];
  for (const n of reg.nodes.values()) for (const d of n.drops) if (!itemReg || !itemReg.items.has(d.item)) out.push(n.type + ':' + d.item);
  return out;
}

export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Drop-tábla gurítás: determinisztikus a (seed, id, count) hármasból; soronként két RNG-hívás. -> [{item, n}] */
export function rollDrops(node, seed, id, count = 0) {
  const rng = mulberry32((hashString(String(id)) ^ Math.imul((count | 0) + 1, 0x9e3779b1) ^ (Number(seed) | 0)) >>> 0);
  const sum = new Map();
  for (const d of node.drops) {
    const r1 = rng(), r2 = rng();
    if (!(r1 < d.chance)) continue;
    const n = d.min + Math.floor(r2 * (d.max - d.min + 1));
    if (n > 0) sum.set(d.item, (sum.get(d.item) || 0) + n);
  }
  return [...sum].map(([item, n]) => ({ item, n }));
}

const newSession = () => ({ id: null, ref: null, progress: 0, full: 0 });

/**
 * Node-rendszer az objektum-tárhoz. opts: {defs|reg, seed, hooks:{speed(p,node,ref)->szorzó, power(p,node,ref)->ütés-erő}} (az S038 eszközei ide kötnek).
 */
export function createNodeSystem(os, opts = {}) {
  return {
    os, reg: opts.reg || createNodeRegistry(opts.defs || NODE_DEFS), seed: opts.seed !== undefined ? opts.seed : (os && os.seed) || 0,
    hooks: Object.assign({ speed: null, power: null }, opts.hooks),
    depleted: new Map(),  // id -> {type, regrowAt (játékperc)}
    damage: new Map(),    // id -> {type, hp (hátralévő), age (mp az utolsó ütés óta)} – nem mentett
    harvests: new Map(),  // id -> eddigi kitermelések (a drop-RNG-hez; nem mentett)
    players: [newSession(), newSession()], events: [], listeners: [],
    stats: { hits: 0, harvested: 0, regrown: 0, full: 0 }, lastError: null,
  };
}

/** Eseményfigyelő (hang, XP, UI): ev {type 'hit'|'depleted'|'full'|'regrown', player?, id, nodeType, ...}; visszaad egy leiratkozót. */
export function onNode(ns, fn) {
  if (typeof fn !== 'function') return () => {};
  ns.listeners.push(fn);
  return () => { const i = ns.listeners.indexOf(fn); if (i >= 0) ns.listeners.splice(i, 1); };
}

function emit(ns, ev) {
  ns.events.push(ev);
  for (const fn of ns.listeners.slice()) {
    try { fn(ev); } catch (e) { ns.lastError = e && e.message ? e.message : String(e); }
  }
}

/** Az interaktív típusok: {típus: {action:'gather'}} – a main.js defineInteractable-lel köti az interakció-rendszerbe. */
export function nodeInteractables(ns) {
  const out = {};
  for (const type of ns.reg.nodes.keys()) out[type] = { action: NODE_CONFIG.action };
  return out;
}

function hook(fn, p, node, ref, lo, hi, dflt, whole) {
  if (typeof fn !== 'function') return dflt;
  let v;
  try { v = fn(p, node, ref); } catch (e) { return dflt; }
  if (!isNum(v)) return dflt;
  v = Math.min(hi, Math.max(lo, v));
  return whole ? Math.max(lo, Math.floor(v)) : v;
}

function harvest(ns, i, node, ref, inv, now) {
  const count = ns.harvests.get(ref.id) || 0;
  const drops = rollDrops(node, ns.seed, ref.id, count);
  if (inv) {
    const snap = inventoryState(inv);
    let fail = false;
    for (const d of drops) if (addItem(inv, d.item, d.n) > 0) { fail = true; break; }
    if (fail) { restoreInventory(inv, snap); return false; } // atomi: semmi nem vész el
  }
  removeObject(ns.os, ref.id);
  ns.depleted.set(ref.id, { type: node.type, regrowAt: now + node.regrow });
  ns.damage.delete(ref.id);
  ns.harvests.set(ref.id, count + 1);
  ns.stats.harvested++;
  emit(ns, { type: 'depleted', player: i, id: ref.id, nodeType: node.type, x: ref.x, y: ref.y, drops });
  return true;
}

/**
 * Egy logikai lépés. targets[i] = az interakció-rendszer célpontja ({kind:'object', ref, action}) | null; inputs[i].interact = a TARTOTT gomb
 * (nyitott menünél a szűrt bemenet hamis); inventories[i] = a játékos inventoryja (hiányában a drop csak az eseményben van); now = játékperc (clock.t).
 * -> a lépés eseményei (a tömb újrahasznosul).
 */
export function stepNodes(ns, players, inputs, targets, inventories, now, dt) {
  const step = isNum(dt) && dt > 0 ? dt : 0;
  ns.events.length = 0;
  if (isNum(now)) {
    for (const [id, e] of ns.depleted) {
      if (now < e.regrowAt) continue;
      ns.depleted.delete(id);
      restoreObject(ns.os, id);
      ns.stats.regrown++;
      emit(ns, { type: 'regrown', id, nodeType: e.type });
    }
  }
  for (const [id, e] of ns.damage) {
    e.age += step;
    const n = ns.reg.nodes.get(e.type);
    if (n && n.heal > 0 && e.age >= n.heal) ns.damage.delete(id);
  }
  for (let i = 0; i < 2; i++) {
    const sess = ns.players[i];
    sess.full = Math.max(0, sess.full - step);
    const p = players && players[i], inp = inputs && inputs[i], tg = targets && targets[i];
    const ref = tg && tg.kind === 'object' && tg.action === NODE_CONFIG.action ? tg.ref : null;
    const node = ref && ref.id != null ? ns.reg.nodes.get(ref.type) : null;
    if (!(inp && inp.interact) || !node || ns.depleted.has(ref.id)) { sess.id = null; sess.ref = null; sess.progress = 0; continue; }
    if (sess.id !== ref.id) { sess.id = ref.id; sess.ref = ref; sess.progress = 0; }
    const dm = ns.damage.get(ref.id);
    if (dm) dm.age = 0;
    sess.progress += step * hook(ns.hooks.speed, p, node, ref, 0.05, NODE_CONFIG.maxSpeed, 1, false) / node.time;
    for (let g = 0; sess.progress >= 1 && g < NODE_CONFIG.maxHitsPerStep; g++) {
      sess.progress -= 1;
      const cur = ns.damage.get(ref.id) || { type: node.type, hp: node.hp, age: 0 };
      ns.damage.set(ref.id, cur);
      cur.hp -= hook(ns.hooks.power, p, node, ref, 1, NODE_CONFIG.maxPower, 1, true);
      cur.age = 0;
      ns.stats.hits++;
      emit(ns, { type: 'hit', player: i, id: ref.id, nodeType: node.type, hp: Math.max(0, cur.hp), max: node.hp });
      if (cur.hp > 0) continue;
      if (harvest(ns, i, node, ref, inventories && inventories[i], isNum(now) ? now : 0)) { sess.id = null; sess.ref = null; sess.progress = 0; break; }
      cur.hp = 1; sess.progress = 0; sess.full = NODE_CONFIG.fullFlash; ns.stats.full++; // nincs hely: az utolsó ütés vár
      emit(ns, { type: 'full', player: i, id: ref.id, nodeType: node.type });
      break;
    }
    if (sess.progress > 1) sess.progress = 1; // a határ-védelem után sem lóghat túl
  }
  return ns.events;
}

/** A rajzhoz: a játékos aktív gyűjtése -> {ref, ratio 0..1 (a teljes kitermelés felé), full (az inventory tele villan)} | null. */
export function gatherView(ns, i) {
  const s = ns.players[i];
  if (!s || !s.ref) return null;
  const node = ns.reg.nodes.get(s.ref.type);
  if (!node) return null;
  const dm = ns.damage.get(s.ref.id);
  const done = node.hp - (dm ? Math.max(0, dm.hp) : node.hp);
  return { ref: s.ref, ratio: Math.min(1, Math.max(0, (done + Math.min(1, s.progress)) / node.hp)), full: s.full > 0 };
}

/** Mentés-alak (az S050 köti be): {v:1, depleted:[[id, típus, hátralévő játékperc]]}; a részleges sérülés nem mentett. */
export function nodeState(ns, now) {
  const t = isNum(now) ? now : 0;
  return { v: NODE_STATE_VERSION, depleted: [...ns.depleted].map(([id, e]) => [id, e.type, Math.max(0, e.regrowAt - t)]) };
}

/** Visszatöltés (atomi: hibás állapotnál false és semmi nem változik). A kitermelt objektumok elrejtődnek, a hátralévő idő a `now`-tól számít. */
export function restoreNodes(ns, st, now = 0) {
  if (!st || typeof st !== 'object' || st.v !== NODE_STATE_VERSION || !Array.isArray(st.depleted) || st.depleted.length > NODE_LIMITS.maxDepleted) return false;
  const items = [];
  for (const e of st.depleted) {
    if (!Array.isArray(e) || e.length !== 3) return false;
    const [id, type, left] = e;
    if (typeof id !== 'string' || !ID_RE.test(id) || !ns.reg.nodes.has(type) || !isNum(left) || left < 0 || left > NODE_LIMITS.maxRegrow) return false;
    items.push(e);
  }
  const base = isNum(now) ? now : 0;
  for (const id of [...ns.depleted.keys()]) restoreObject(ns.os, id);
  ns.depleted.clear(); ns.damage.clear(); ns.harvests.clear();
  ns.players[0] = newSession(); ns.players[1] = newSession();
  for (const [id, type, left] of items) if (removeObject(ns.os, id)) ns.depleted.set(id, { type, regrowAt: base + left });
  return true;
}
