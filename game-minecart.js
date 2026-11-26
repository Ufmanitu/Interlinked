// game-minecart.js (S078) – CSILLE SÍNEKEN a bányában. Tiszta logika, DOM/canvas nélkül; Node-ban tesztelhető.
// A sínek logikai csempe-halmaz (a járat-csempéken: T.ROAD/T.SAND), a csille a sínen halad csempéről csempére; egyenesen megy tovább, kanyarban a
// egyetlen másik sín felé fordul, elágazásnál/zsákutca végén megáll (a sínváltók és a csille-rejtvény az S141 dolga). Teher: nyersanyag, kapacitás-korlátos.
// Állapot az instance zsákjában (zsák.cart = {v:1, rails:[csempe-index], carts:[{x,y,l:{tárgy:n}}]}), így a mentés őrzi (a mozgó csille a megállt csempén ment).
// Első találkozáskor minden rétegre automatikus sín-vonal (a réteg startjától az aknáig, az utolsón a mélyponti teremig) és egy csille a startnál.
import { T } from './world-tiles.js';
import { getTile } from './world-tilemap.js';
import { addItem } from './game-inventory.js';
import { instanceWorld, instanceData } from './game-instance.js';

export const CART_CONFIG = Object.freeze({ tile: 32, speed: 3, cap: 40, maxRails: 2048, maxCarts: 16, reach: 56, maxStep: 0.25 }); // speed: csempe/mp; cap: a teher max. darabszáma
export const CART_DIRS = Object.freeze([[1, 0], [0, 1], [-1, 0], [0, -1]]); // 0 kelet, 1 dél, 2 nyugat, 3 észak

const fin = v => typeof v === 'number' && Number.isFinite(v);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isFloor = id => id === T.ROAD || id === T.SAND;
const total = load => { let n = 0; for (const k of Object.keys(load)) n += load[k]; return n; };

export function createCarts(cfg = CART_CONFIG) {
  const c = isObj(cfg) ? { ...CART_CONFIG, ...cfg } : CART_CONFIG;
  return { cfg: c, bound: new WeakMap(), rails: new Set(), carts: [], nextId: 1, events: [], stats: { moved: 0, stopped: 0 } };
}
function flush(cm, z) {
  z.cart = { v: 1, rails: [...cm.rails].sort((a, b) => a - b), carts: cm.carts.map(c => ({ x: c.tx, y: c.ty, l: { ...c.load } })) };
}
/** Legrövidebb járat-út (4 szomszéd) a két csempe között -> csempe-indexek a kettőt is beleértve | null. */
export function routeTiles(map, a, b) {
  const { cols, rows } = map, n = cols * rows, s = a.ty * cols + a.tx, e = b.ty * cols + b.tx;
  if (!isFloor(getTile(map, a.tx, a.ty)) || !isFloor(getTile(map, b.tx, b.ty))) return null;
  const prev = new Int32Array(n).fill(-2); prev[s] = -1;
  const q = [s];
  for (let h = 0; h < q.length && prev[e] === -2; h++) {
    const i = q[h], x = i % cols, y = (i - x) / cols;
    for (const [dx, dy] of CART_DIRS) {
      const nx = x + dx, ny = y + dy, j = ny * cols + nx;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || prev[j] !== -2 || !isFloor(map.tiles[j])) continue;
      prev[j] = i; q.push(j);
    }
  }
  if (prev[e] === -2) return null;
  const path = []; for (let i = e; i !== -1; i = prev[i]) path.push(i);
  return path.reverse();
}
function newCart(cm, tx, ty, load = {}) { const c = { id: cm.nextId++, tx, ty, dir: -1, prog: 0, load }; cm.carts.push(c); return c; }
function autoLay(cm, w) {
  for (const l of w.meta.layers) {
    const to = l.descent || w.meta.bottom, r = to ? routeTiles(w.map, l.start, to) : null;
    if (!r || r.length < 2 || cm.rails.size + r.length > cm.cfg.maxRails || cm.carts.length >= cm.cfg.maxCarts) continue;
    for (const i of r) cm.rails.add(i);
    newCart(cm, l.start.tx, l.start.ty);
  }
}
function load(cm, w, z) {
  cm.rails = new Set(); cm.carts = []; cm.nextId = 1;
  const s = z.cart;
  if (!isObj(s) || s.v !== 1) { autoLay(cm, w); flush(cm, z); return; }
  for (const i of Array.isArray(s.rails) ? s.rails : []) if (cm.rails.size < cm.cfg.maxRails && Number.isInteger(i) && i >= 0 && i < w.cols * w.rows && isFloor(w.map.tiles[i])) cm.rails.add(i);
  for (const c of Array.isArray(s.carts) ? s.carts : []) {
    if (cm.carts.length >= cm.cfg.maxCarts || !isObj(c) || !Number.isInteger(c.x) || !Number.isInteger(c.y) || !cm.rails.has(c.y * w.cols + c.x)) continue;
    const ld = {}; let sum = 0;
    if (isObj(c.l)) for (const k of Object.keys(c.l)) { const n = c.l[k]; if (k.length <= 48 && Number.isInteger(n) && n > 0 && sum + n <= cm.cfg.cap) { ld[k] = n; sum += n; } }
    newCart(cm, c.x, c.y, ld);
  }
  flush(cm, z); // a szemét-adat tisztán íródik vissza
}
/** Az aktív bánya-világ szinkronja a zsákkal -> {w, z} | null. */
export function cartWorld(cm, mgr) {
  const w = instanceWorld(mgr);
  if (!w || w.kind !== 'mine' || !w.meta) return null;
  const z = instanceData(mgr, w.id);
  if (!z) return null;
  if (cm.bound.get(w) !== z) { cm.bound.set(w, z); load(cm, w, z); }
  return { w, z };
}
export const cartById = (cm, id) => cm.carts.find(c => c.id === id) || null;
export const railAt = (cm, w, tx, ty) => cm.rails.has(ty * w.cols + tx);
/** Sín lerakása járat-csempére -> {ok, reason: inactive|tile|limit|have}. */
export function placeRail(cm, mgr, tx, ty) {
  const cw = cartWorld(cm, mgr);
  if (!cw) return { ok: false, reason: 'inactive' };
  const { w, z } = cw;
  if (!Number.isInteger(tx) || !Number.isInteger(ty) || !isFloor(getTile(w.map, tx, ty))) return { ok: false, reason: 'tile' };
  if (railAt(cm, w, tx, ty)) return { ok: false, reason: 'have' };
  if (cm.rails.size >= cm.cfg.maxRails) return { ok: false, reason: 'limit' };
  cm.rails.add(ty * w.cols + tx); flush(cm, z);
  return { ok: true, reason: null };
}
/** A csille pixel-pozíciója (a haladás-interpolációval; a világ-pixel). */
export function cartPos(cm, w, c) {
  const S = cm.cfg.tile, d = c.dir >= 0 ? CART_DIRS[c.dir] : [0, 0];
  return { x: w.ox + (c.tx + 0.5 + d[0] * c.prog) * S, y: w.oy + (c.ty + 0.5 + d[1] * c.prog) * S };
}
/** A legközelebbi csille a pontból a `reach` távolságon belül | null. */
export function nearCart(cm, mgr, x, y, reach = cm.cfg.reach) {
  const cw = cartWorld(cm, mgr);
  if (!cw || !fin(x) || !fin(y)) return null;
  let best = null, bd = Infinity;
  for (const c of cm.carts) { const p = cartPos(cm, cw.w, c), d = Math.hypot(p.x - x, p.y - y); if (d <= reach && d < bd) { bd = d; best = c; } }
  return best;
}
/** Meglökés az irányba (0..3): csak ha arra sín van -> {ok, reason: inactive|cart|dir|norail}. */
export function pushCart(cm, mgr, id, dir) {
  const cw = cartWorld(cm, mgr), c = cw ? cartById(cm, id) : null;
  if (!cw) return { ok: false, reason: 'inactive' };
  if (!c) return { ok: false, reason: 'cart' };
  if (!Number.isInteger(dir) || dir < 0 || dir > 3) return { ok: false, reason: 'dir' };
  if (c.dir >= 0 && c.prog > 0) return { ok: false, reason: 'moving' };
  if (!railAt(cm, cw.w, c.tx + CART_DIRS[dir][0], c.ty + CART_DIRS[dir][1])) return { ok: false, reason: 'norail' };
  c.dir = dir; c.prog = 0;
  return { ok: true, reason: null };
}
/** Csille-léptetés. Esemény: moved{id,tx,ty} | stopped{id,tx,ty}. */
export function stepCarts(cm, mgr, dt) {
  const out = cm.events; out.length = 0;
  const cw = cartWorld(cm, mgr);
  if (!cw || !fin(dt) || dt <= 0) return out;
  dt = Math.min(dt, cm.cfg.maxStep); let dirty = false;
  for (const c of cm.carts) {
    if (c.dir < 0) continue;
    c.prog += cm.cfg.speed * dt;
    for (let guard = 4; c.prog >= 1 && c.dir >= 0 && guard > 0; guard--) {
      c.tx += CART_DIRS[c.dir][0]; c.ty += CART_DIRS[c.dir][1]; c.prog -= 1; dirty = true; cm.stats.moved++;
      out.push({ type: 'moved', id: c.id, tx: c.tx, ty: c.ty });
      const has = d => railAt(cm, cw.w, c.tx + CART_DIRS[d][0], c.ty + CART_DIRS[d][1]);
      if (has(c.dir)) continue;
      const cand = [0, 1, 2, 3].filter(d => d !== (c.dir + 2) % 4 && has(d));
      if (cand.length === 1) c.dir = cand[0];
      else { c.dir = -1; c.prog = 0; cm.stats.stopped++; out.push({ type: 'stopped', id: c.id, tx: c.tx, ty: c.ty }); }
    }
  }
  if (dirty) flush(cm, cw.z);
  return out;
}
/** Felrakás a csillére: a kapacitásig -> a felrakott darabszám. */
export function loadCart(cm, mgr, id, item, n) {
  const cw = cartWorld(cm, mgr), c = cw ? cartById(cm, id) : null;
  if (!c || typeof item !== 'string' || !item || item.length > 48 || !Number.isInteger(n) || n < 1) return 0;
  const k = Math.min(n, cm.cfg.cap - total(c.load));
  if (k <= 0) return 0;
  c.load[item] = (c.load[item] || 0) + k; flush(cm, cw.z);
  return k;
}
/** Lerakodás az inventoryba (a maradék a drop(item,n,x,y)-ra, ha van; különben a csillén marad) -> az áthelyezett darabszám. */
export function unloadCart(cm, mgr, id, inv, drop) {
  const cw = cartWorld(cm, mgr), c = cw ? cartById(cm, id) : null;
  if (!c) return 0;
  const p = cartPos(cm, cw.w, c); let moved = 0;
  for (const k of Object.keys(c.load)) {
    let left = inv ? addItem(inv, k, c.load[k]) : c.load[k];
    if (left > 0 && typeof drop === 'function') { drop(k, left, p.x, p.y); left = 0; }
    moved += c.load[k] - left;
    if (left > 0) c.load[k] = left; else delete c.load[k];
  }
  if (moved) flush(cm, cw.z);
  return moved;
}
