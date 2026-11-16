// game-grounditems.js (S039) – a földre dobott / dropolt tárgyak: mágnes-felvétel, stackelés, eltűnési idő.
// Tiszta logika (nincs DOM/canvas); a rajz: render-objects.js (drawGroundItems). Importja: data-items, game-inventory, game-collision, game-hud (menuOpen).
// Egy földi tárgy = {id (egyedi szám), item (tárgy-id), n (1..stack), x, y (közép, px), vx, vy (dobás-sebesség), age (mp), ttl (0 = cfg.ttl), delay (felvétel-késleltetés mp),
// noPick (0|1|-1: a dobó játékos addig nem veszi fel, amíg ki nem lép a mágnes-körből), mv (mágnes-sebesség)}. Az idő VALÓS másodperc (nem játékperc).
import { createItemRegistry, getItemDef } from './data-items.js';
import { addItem, spaceFor } from './game-inventory.js';
import { collides } from './game-collision.js';
import { menuOpen } from './game-hud.js';

export const GROUND_STATE_VERSION = 1;
export const GROUND_DEFAULTS = Object.freeze({
  size: 10,            // a tárgy rajz-/ütköző-mérete (px)
  magnetRadius: 64,    // ennyire húzza a közeli játékos (px)
  pickupRadius: 14,    // ennyire közel kerül a felvétel (px)
  magnetAccel: 700,    // a mágnes-sebesség gyorsulása (px/s²)
  magnetMax: 280,      // a mágnes-sebesség plafonja (px/s)
  pickDelay: 0.6,      // keletkezés után ennyi ideig nem vehető fel (mp)
  ttl: 300,            // eltűnési idő (mp)
  blinkAt: 30,          // az utolsó ennyi mp-ben villog a rajz
  mergeRadius: 24,     // az azonos tárgy ezen belül összevonódik (px)
  mergeEvery: 0.25,    // az összevonás ritmusa (mp)
  maxItems: 256,       // legfeljebb ennyi földi tárgy; túllépésnél a legrégebbi tűnik el
  tossSpeed: 110,      // a dobás kezdősebessége (px/s)
  friction: 5,         // dobás-lassulás (1/s, exponenciális)
  stopSpeed: 6,        // ez alatt megáll (px/s)
  ownerClear: 8,       // a dobó ennyivel a mágnes-sugáron túl "szabadítja fel" a tárgyat (px)
  dropDy: 10,          // a leejtés a játékos közepe alatt ennyivel (px)
});
const LIMITS = {
  size: [4, 32], magnetRadius: [8, 256], pickupRadius: [2, 64], magnetAccel: [10, 5000], magnetMax: [20, 1000], pickDelay: [0, 10], ttl: [5, 86400], blinkAt: [0, 600],
  mergeRadius: [4, 128], mergeEvery: [0.05, 5], maxItems: [1, 2048], tossSpeed: [0, 600], friction: [0.5, 30], stopSpeed: [1, 50], ownerClear: [0, 128], dropDy: [-32, 32],
};
const COORD = 1e8;
const fin = v => typeof v === 'number' && Number.isFinite(v);
const isCount = n => Number.isSafeInteger(n) && n > 0;

/** Konfig: hibás/hiányzó mező -> alap, a számok a határokra szorítva; pickupRadius <= magnetRadius. Befagyasztott, sosem dob. */
export function sanitizeGroundConfig(src) {
  const s = src && typeof src === 'object' ? src : {};
  const c = {};
  for (const k of Object.keys(GROUND_DEFAULTS)) {
    const [lo, hi] = LIMITS[k];
    c[k] = fin(s[k]) ? Math.min(hi, Math.max(lo, s[k])) : GROUND_DEFAULTS[k];
  }
  if (c.pickupRadius > c.magnetRadius) c.pickupRadius = c.magnetRadius;
  c.maxItems = Math.floor(c.maxItems);
  return Object.freeze(c);
}

export function createGroundItems(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  return {
    reg: o.reg && o.reg.items ? o.reg : createItemRegistry(), cfg: sanitizeGroundConfig(o.cfg), items: [], nextId: 1, seq: 0, time: 0, mergeT: 0,
    listeners: new Set(), events: [], stats: { dropped: 0, picked: 0, merged: 0, despawned: 0, lost: 0 }, lastError: null,
  };
}

/** Figyelő: esemény {type 'drop'|'pickup'|'despawn'|'merge', ...}; a hibázó figyelő nem állítja meg a többit. -> leiratkozó. */
export function onGround(gs, fn) {
  if (!gs || !gs.listeners || typeof fn !== 'function') return () => {};
  gs.listeners.add(fn);
  return () => gs.listeners.delete(fn);
}
function emit(gs, ev, collect) {
  if (collect) gs.events.push(ev);
  for (const fn of [...gs.listeners]) { try { fn(ev); } catch (e) { gs.lastError = e; } }
}

const ttlOf = (gs, it) => (it.ttl > 0 ? it.ttl : gs.cfg.ttl);
function validItem(it) {
  return it && fin(it.x) && fin(it.y) && fin(it.vx) && fin(it.vy) && fin(it.age) && isCount(it.n) && Math.abs(it.x) <= COORD && Math.abs(it.y) <= COORD;
}
function removeAt(gs, k, reason, collect) {
  const it = gs.items[k];
  gs.items.splice(k, 1);
  if (it && isCount(it.n)) { gs.stats.despawned += it.n; emit(gs, { type: 'despawn', id: it.item, n: it.n, x: it.x, y: it.y, reason }, collect); }
}
function makeRoom(gs, collect) {
  while (gs.items.length >= gs.cfg.maxItems && gs.items.length > 0) {
    let w = 0, left = Infinity;
    for (let k = 0; k < gs.items.length; k++) { const r = ttlOf(gs, gs.items[k]) - gs.items[k].age; if (r < left) { left = r; w = k; } }
    removeAt(gs, w, 'cap', collect);
  }
}

/**
 * Tárgy a földre: a stack-határ szerint több földi tárgyra bomlik. opts: {toss (szétszórás), angle, owner (0|1: a dobó), delay (mp), ttl (mp)}.
 * -> a NEM lerakott mennyiség (0 = minden leesett; hibás bemenetnél az egész n / 0, semmi nem változik).
 */
export function dropItem(gs, id, n, x, y, opts) {
  const bad = isCount(n) ? n : 0;
  if (!gs || !Array.isArray(gs.items) || !gs.cfg) return bad;
  const d = getItemDef(gs.reg, id);
  if (!d || !isCount(n) || !fin(x) || !fin(y) || Math.abs(x) > COORD || Math.abs(y) > COORD) return bad;
  const o = opts && typeof opts === 'object' ? opts : {};
  const owner = o.owner === 0 || o.owner === 1 ? o.owner : -1;
  const delay = fin(o.delay) ? Math.min(10, Math.max(0, o.delay)) : gs.cfg.pickDelay;
  const ttl = fin(o.ttl) && o.ttl > 0 ? Math.min(86400, o.ttl) : 0;
  let left = n;
  while (left > 0) {
    const k = Math.min(d.stack, left);
    left -= k;
    let vx = 0, vy = 0;
    if (o.toss) {
      const ang = fin(o.angle) ? o.angle : gs.seq * 2.399963229728653; // aranyszög: a rakás szétterül
      const sp = gs.cfg.tossSpeed * (0.6 + 0.4 * ((gs.seq * 0.618033988749895) % 1));
      vx = Math.cos(ang) * sp; vy = Math.sin(ang) * sp;
    }
    gs.seq++;
    makeRoom(gs, false);
    gs.items.push({ id: gs.nextId++, item: id, n: k, x, y, vx, vy, age: 0, ttl, delay, noPick: owner, mv: 0 });
    gs.stats.dropped += k;
    emit(gs, { type: 'drop', id, n: k, x, y, owner }, false);
  }
  return 0;
}

function moveToss(it, step, c, walls) {
  let dx = it.vx * step, dy = it.vy * step;
  if (walls && walls.length) {
    const e = { x: it.x, y: it.y, w: c.size, h: c.size };
    if (dx) { e.x = it.x + dx; if (collides(e, walls)) { e.x = it.x; it.vx = 0; } }
    if (dy) { e.y = it.y + dy; if (collides(e, walls)) { e.y = it.y; it.vy = 0; } }
    it.x = e.x; it.y = e.y;
  } else { it.x += dx; it.y += dy; }
  const f = Math.exp(-c.friction * step);
  it.vx *= f; it.vy *= f;
  if (Math.hypot(it.vx, it.vy) < c.stopSpeed) { it.vx = 0; it.vy = 0; }
}

// A legközelebbi játékos, aki fel tudja venni; közben a dobó "felszabadítása" (kilépett a körből / eltűnt).
function nearestTaker(gs, it, players, inventories) {
  const c = gs.cfg;
  let best = -1, bd = c.magnetRadius;
  for (let i = 0; i < 2; i++) {
    const p = players && players[i];
    const ok = p && fin(p.x) && fin(p.y);
    const dist = ok ? Math.hypot(p.x - it.x, p.y - it.y) : Infinity;
    if (it.noPick === i) { if (dist > c.magnetRadius + c.ownerClear) it.noPick = -1; continue; }
    if (!ok || dist > bd) continue;
    const inv = inventories && inventories[i];
    if (!inv || !Array.isArray(inv.slots) || spaceFor(inv, it.item) <= 0) continue;
    best = i; bd = dist;
  }
  return best < 0 ? null : { i: best, dist: bd };
}

function magnet(gs, it, players, inventories, step) {
  const c = gs.cfg, tk = nearestTaker(gs, it, players, inventories);
  if (!tk || it.age < it.delay) { if (!tk) it.mv = 0; return false; }
  const p = players[tk.i];
  it.vx = 0; it.vy = 0;
  let dist = tk.dist;
  if (dist > c.pickupRadius) {
    it.mv = Math.min(c.magnetMax, it.mv + c.magnetAccel * step);
    const m = Math.min(it.mv * step, dist - c.pickupRadius * 0.5), k = dist > 0 ? m / dist : 0;
    it.x += (p.x - it.x) * k; it.y += (p.y - it.y) * k;
    dist = Math.hypot(p.x - it.x, p.y - it.y);
  }
  if (dist > c.pickupRadius) return false;
  const left = addItem(inventories[tk.i], it.item, it.n), got = it.n - left;
  if (got > 0) { it.n = left; gs.stats.picked += got; emit(gs, { type: 'pickup', player: tk.i, id: it.item, n: got, left, x: it.x, y: it.y }, true); }
  if (it.n <= 0) return true;
  it.mv = 0;
  return false;
}

function mergePass(gs) {
  const items = gs.items, r2 = gs.cfg.mergeRadius * gs.cfg.mergeRadius;
  let any = false;
  for (let a = 0; a < items.length; a++) {
    const A = items[a], d = A.n > 0 ? getItemDef(gs.reg, A.item) : null;
    if (!d || A.vx || A.vy || A.mv) continue;
    for (let b = a + 1; b < items.length && A.n < d.stack; b++) {
      const B = items[b];
      if (B.n <= 0 || B.item !== A.item || B.vx || B.vy || B.mv) continue;
      const dx = B.x - A.x, dy = B.y - A.y;
      if (dx * dx + dy * dy > r2) continue;
      const k = Math.min(d.stack - A.n, B.n);
      A.n += k; B.n -= k; any = true;
      A.age = Math.min(A.age, B.age);              // a rakás frissül: a legfrissebb tárgy ideje számít
      A.ttl = A.ttl > 0 && B.ttl > 0 ? Math.max(A.ttl, B.ttl) : 0;
      if (A.noPick < 0) A.noPick = B.noPick;
      gs.stats.merged += k;
      emit(gs, { type: 'merge', id: A.item, n: k, x: A.x, y: A.y }, true);
    }
  }
  if (any) { let w = 0; for (const it of items) if (it.n > 0) items[w++] = it; items.length = w; }
}

/**
 * Egy logikai lépés: dobás-mozgás (falak: [{x,y,w,h}]), mágnes + felvétel (csak ha fér az inventoryba), összevonás, eltűnés. Sosem dob.
 * players[i] = {x,y} (közép), inventories[i] = a játékos inventoryja. -> a lépés eseményei (pickup|merge|despawn; a tömb újrahasznosul).
 */
export function stepGround(gs, players, inventories, dt, walls) {
  if (!gs || !Array.isArray(gs.items) || !gs.cfg) return [];
  gs.events.length = 0;
  const step = fin(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
  if (step === 0) return gs.events;
  gs.time += step;
  const ws = Array.isArray(walls) ? walls : null;
  for (let k = gs.items.length - 1; k >= 0; k--) {
    const it = gs.items[k];
    if (!validItem(it)) { gs.items.splice(k, 1); gs.stats.lost++; continue; }
    it.age += step;
    if (it.age >= ttlOf(gs, it)) { removeAt(gs, k, 'ttl', true); continue; }
    if (it.vx !== 0 || it.vy !== 0) moveToss(it, step, gs.cfg, ws);
    if (magnet(gs, it, players, inventories, step)) gs.items.splice(k, 1);
  }
  gs.mergeT += step;
  if (gs.mergeT >= gs.cfg.mergeEvery) { gs.mergeT = 0; mergePass(gs); }
  return gs.events;
}

export function groundCount(gs) { return gs && Array.isArray(gs.items) ? gs.items.length : 0; }

/** A nézetben (bal-felső sarok ox,oy; méret vw,vh) lévő földi tárgyak -> out (újrahasznosított tömb). */
export function visibleGround(gs, ox, oy, vw, vh, out = []) {
  out.length = 0;
  if (!gs || !Array.isArray(gs.items)) return out;
  const m = gs.cfg.size;
  for (const it of gs.items) if (it.x > ox - m && it.x < ox + vw + m && it.y > oy - m && it.y < oy + vh + m) out.push(it);
  return out;
}

/** Mentés-alak (az S050 köti be): {v:1, items:[[tárgy-id, n, x, y, age]]}. */
export function groundState(gs) {
  const items = [];
  if (gs && Array.isArray(gs.items)) for (const it of gs.items) if (validItem(it)) items.push([it.item, it.n, Math.round(it.x * 100) / 100, Math.round(it.y * 100) / 100, Math.round(it.age * 100) / 100]);
  return { v: GROUND_STATE_VERSION, items };
}

/** Visszatöltés (ATOMI: hibás állapotnál false és semmi nem változik). A tárgyak nyugvók, a dobó-zár nincs. */
export function restoreGround(gs, st) {
  if (!gs || !Array.isArray(gs.items) || !st || typeof st !== 'object' || st.v !== GROUND_STATE_VERSION || !Array.isArray(st.items) || st.items.length > gs.cfg.maxItems) return false;
  const list = [];
  for (const e of st.items) {
    if (!Array.isArray(e) || e.length !== 5) return false;
    const [item, n, x, y, age] = e, d = getItemDef(gs.reg, item);
    if (!d || !isCount(n) || n > d.stack || !fin(x) || !fin(y) || Math.abs(x) > COORD || Math.abs(y) > COORD || !fin(age) || age < 0 || age >= gs.cfg.ttl) return false;
    list.push({ id: 0, item, n, x, y, vx: 0, vy: 0, age, ttl: 0, delay: 0, noPick: -1, mv: 0 });
  }
  gs.items.length = 0;
  for (const it of list) { it.id = gs.nextId++; gs.items.push(it); }
  return true;
}

/**
 * Inventory-eldobás (a stepInvUi ELŐTT hívandó, a NYERS bemenettel): nyitott menünél, ha a játékosnak nincs fogott tárgya, a 2. képesség (ability2Pressed)
 * a kurzor alatti stack-et a lábához dobja (a dobó csak a mágnes-körből kilépve veheti vissza; a társ azonnal). A megnyitás kockájában nincs hatás.
 * ATOMI: ha a lerakás nem sikerül, a slot visszakerül. -> események [{type 'drop', player, id, n, slot}].
 */
export function stepDropInput(gs, ui, menus, raws, inventories, players) {
  const out = [];
  if (!gs || !gs.cfg || !ui || !Array.isArray(ui.players)) return out;
  for (let i = 0; i < 2; i++) {
    const ps = ui.players[i], raw = raws && raws[i], inv = inventories && inventories[i], p = players && players[i];
    if (!ps || !raw || raw.ability2Pressed !== true || !inv || !Array.isArray(inv.slots) || !p || !fin(p.x) || !fin(p.y)) continue;
    if (!menuOpen(menus, i) || ps.wasOpen !== true || ps.mark >= 0 || !Number.isInteger(ps.cursor)) continue;
    const s = inv.slots[ps.cursor];
    if (!s || !isCount(s.n)) continue;
    inv.slots[ps.cursor] = null;
    if (dropItem(gs, s.id, s.n, p.x, p.y + gs.cfg.dropDy, { toss: true, owner: i }) > 0) { inv.slots[ps.cursor] = s; continue; }
    out.push({ type: 'drop', player: i, id: s.id, n: s.n, slot: ps.cursor });
  }
  return out;
}
