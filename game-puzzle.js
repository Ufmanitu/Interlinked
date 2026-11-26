// game-puzzle.js (S080) – REJTVÉNY-ALAPELEMEK: kapcsoló, nyomólap, ajtó, tolható doboz, kulcs, jel-hálózat (bemenet -> kapu -> ajtó).
// Tiszta logika, DOM/canvas nélkül. A hívó: a puzzleColliders() téglalapjait a falakhoz adja, a mozgás UTÁN hívja a stepPuzzle-t.
import { collides, sweepAxis } from './game-collision.js';

export const PUZZLE_CONFIG = Object.freeze({
  tile: 32, boxSize: 30, plateSize: 28, switchSize: 20, pushSpeed: 60, pushGap: 1.5, deadzone: 0.3,
  bodySize: 24, maxStep: 0.25, maxElements: 128, maxTime: 600,
});
/** kapu -> [min, max bemenet]; latch: ha egyszer igaz, az marad (mentett) */
export const GATE_OPS = Object.freeze({ and: [1, 8], or: [1, 8], xor: [2, 8], not: [1, 1], latch: [1, 1] });
const KINDS = ['switches', 'plates', 'boxes', 'gates', 'doors', 'keys'];

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const fin = v => typeof v === 'number' && Number.isFinite(v);
const pos = (v, d) => (fin(v) && v > 0 ? v : d);
const coord = v => Number.isInteger(v) && v >= 0 && v < 1024;
const body = (p, S) => ({ x: p.x, y: p.y, w: pos(p.w, S), h: pos(p.h, S) });
const rectOf = e => ({ x: e.x - e.w / 2, y: e.y - e.h / 2, w: e.w, h: e.h });

/** Def-ellenőrzés -> {ok, error: def|list|id|dup|pos|value|op|inputs|ref|cycle|source|lock, order (kapuk kiértékelési sorrendje)} */
export function validatePuzzleDef(def, cfg = PUZZLE_CONFIG) {
  const bad = error => ({ ok: false, error, order: null });
  if (!isObj(def) || typeof def.id !== 'string' || !def.id) return bad('def');
  const ids = new Set(); let total = 0;
  for (const k of KINDS) {
    if (!Array.isArray(def[k])) return bad('list');
    for (const e of def[k]) {
      if (!isObj(e) || typeof e.id !== 'string' || !e.id || e.id === '__proto__') return bad('id');
      if (ids.has(e.id)) return bad('dup');
      ids.add(e.id); total++;
      if (k !== 'gates' && !(coord(e.tx) && coord(e.ty))) return bad('pos');
    }
  }
  if (total > cfg.maxElements) return bad('list');
  for (const s of def.switches) if (s.time !== undefined && !(fin(s.time) && s.time > 0 && s.time <= cfg.maxTime)) return bad('value');
  for (const p of def.plates) if (p.need !== undefined && !(fin(p.need) && p.need > 0 && p.need <= 16)) return bad('value');
  for (const b of def.boxes) for (const k of ['weight', 'heft']) if (b[k] !== undefined && !(fin(b[k]) && b[k] > 0 && b[k] <= 16)) return bad('value');
  for (const d of def.doors) if (!(Number.isInteger(d.w ?? 1) && (d.w ?? 1) >= 1 && (d.w ?? 1) <= 8 && Number.isInteger(d.h ?? 1) && (d.h ?? 1) >= 1 && (d.h ?? 1) <= 8)) return bad('value');
  const signals = new Set([...def.switches, ...def.plates, ...def.gates].map(e => e.id));
  for (const g of def.gates) {
    if (!Object.prototype.hasOwnProperty.call(GATE_OPS, g.op)) return bad('op');
    const [lo, hi] = GATE_OPS[g.op];
    if (!Array.isArray(g.in) || g.in.length < lo || g.in.length > hi) return bad('inputs');
    if (!g.in.every(r => signals.has(r))) return bad('ref');
  }
  const keys = new Set(def.keys.map(k => k.id));
  for (const d of def.doors) {
    if ((d.in === undefined) === (d.lock === undefined)) return bad('source'); // pontosan az egyik: jel VAGY zár
    if (d.in !== undefined && !signals.has(d.in)) return bad('ref');
    if (d.lock !== undefined && !keys.has(d.lock)) return bad('lock');
  }
  const done = new Set([...def.switches, ...def.plates].map(e => e.id)), order = [];
  let rest = def.gates.slice();
  while (rest.length) {
    const ready = rest.filter(g => g.in.every(r => done.has(r)));
    if (!ready.length) return bad('cycle');
    for (const g of ready) { done.add(g.id); order.push(g); }
    rest = rest.filter(g => !done.has(g.id));
  }
  return { ok: true, error: null, order };
}

/** Futásidejű rejtvény; (ox,oy) az origó világ-pixelben. Hibás def -> null. */
export function createPuzzle(def, ox = 0, oy = 0, cfg = PUZZLE_CONFIG) {
  const v = validatePuzzleDef(def, cfg);
  if (!v.ok || !fin(ox) || !fin(oy)) return null;
  const S = cfg.tile;
  const at = (e, size) => ({ x: ox + (e.tx + 0.5) * S, y: oy + (e.ty + 0.5) * S, w: size, h: size });
  const pz = {
    id: def.id, cfg, ox, oy, order: v.order, version: 0, events: [], signals: new Map(),
    switches: def.switches.map(e => ({ id: e.id, ...at(e, cfg.switchSize), time: e.time || 0, on: false, left: 0 })),
    plates: def.plates.map(e => ({ id: e.id, ...at(e, cfg.plateSize), need: e.need || 1, on: false })),
    boxes: def.boxes.map(e => ({ id: e.id, ...at(e, cfg.boxSize), weight: e.weight || 1, heft: e.heft || 1 })),
    keys: def.keys.map(e => ({ id: e.id, ...at(e, cfg.switchSize), taken: false })),
    doors: def.doors.map(e => ({ id: e.id, in: e.in ?? null, lock: e.lock ?? null, unlocked: false, open: false,
      rect: { x: ox + e.tx * S, y: oy + e.ty * S, w: (e.w || 1) * S, h: (e.h || 1) * S } })),
    latched: new Set(),
  };
  pz.home = pz.boxes.map(b => [b.x, b.y]);
  evaluate(pz, []);
  pz.events.length = 0;
  return pz;
}

/** Ütköző téglalapok: zárt ajtók + dobozok (except: a kihagyandó doboz). */
export function puzzleColliders(pz, out = [], except = null) {
  for (const d of pz.doors) if (!d.open) out.push(d.rect);
  for (const b of pz.boxes) if (b !== except) out.push(rectOf(b));
  return out;
}

// Jel-hálózat és ajtók. Nyílt ajtó csak akkor záródik, ha senki és semmi nem áll benne (nem zár be / nem présel össze).
function evaluate(pz, players) {
  const sig = pz.signals;
  for (const s of pz.switches) sig.set(s.id, s.on);
  for (const p of pz.plates) sig.set(p.id, p.on);
  for (const g of pz.order) {
    const inp = g.in.map(r => sig.get(r) === true);
    let on;
    if (g.op === 'and') on = inp.every(Boolean);
    else if (g.op === 'or') on = inp.some(Boolean);
    else if (g.op === 'xor') on = inp.filter(Boolean).length % 2 === 1;
    else if (g.op === 'not') on = !inp[0];
    else { if (inp[0]) pz.latched.add(g.id); on = pz.latched.has(g.id); }
    sig.set(g.id, on);
  }
  for (const d of pz.doors) {
    const want = d.lock !== null ? d.unlocked : sig.get(d.in) === true;
    if (want === d.open) continue;
    if (!want) {
      const inside = e => collides(e, [d.rect]);
      if (pz.boxes.some(inside) || players.some(p => p && inside(body(p, pz.cfg.bodySize)))) continue;
    }
    d.open = want; pz.version++;
    pz.events.push({ type: want ? 'open' : 'close', id: d.id });
  }
}

// Tolás: a doboz oldalához érő, felé nyomó játékosok ereje összeadódik; heft alatt a doboz nem mozdul.
function pushBoxes(pz, players, inputs, dt, walls) {
  const c = pz.cfg;
  for (const b of pz.boxes) {
    for (const ax of ['x', 'y']) {
      const cross = ax === 'x' ? 'y' : 'x';
      let force = 0;
      for (let i = 0; i < players.length; i++) {
        const p = players[i], inp = inputs && inputs[i];
        if (!p || !inp) continue;
        const v = fin(inp[ax]) ? inp[ax] : 0, o = fin(inp[cross]) ? inp[cross] : 0;
        if (Math.abs(v) < c.deadzone || Math.abs(v) < Math.abs(o)) continue;
        const e = body(p, c.bodySize), dir = Math.sign(v);
        const size = ax === 'x' ? 'w' : 'h', side = ax === 'x' ? 'h' : 'w';
        const gap = (b[ax] - e[ax]) * dir - (b[size] + e[size]) / 2;
        if (gap < -0.01 || gap > c.pushGap) continue;
        if (Math.abs(b[cross] - e[cross]) >= (b[side] + e[side]) / 2 - 2) continue;
        force += dir * pos(p.strength, 1);
      }
      if (Math.abs(force) + 1e-9 < b.heft) continue;
      const obstacles = puzzleColliders(pz, walls.slice(), b);
      for (const p of players) if (p) obstacles.push(rectOf(body(p, c.bodySize)));
      const move = sweepAxis(b, ax, Math.sign(force) * c.pushSpeed * dt, obstacles);
      if (move !== 0) { b[ax] += move; pz.version++; }
    }
  }
}

function pressPlates(pz, players) {
  for (const pl of pz.plates) {
    const over = e => fin(e.x) && fin(e.y) && Math.abs(e.x - pl.x) < pl.w / 2 && Math.abs(e.y - pl.y) < pl.h / 2; // a középpont a lapon
    let w = 0;
    for (const p of players) if (p && over(p)) w += pos(p.weight, 1);
    for (const b of pz.boxes) if (over(b)) w += b.weight;
    const on = w + 1e-9 >= pl.need;
    if (on !== pl.on) { pl.on = on; pz.version++; pz.events.push({ type: on ? 'press' : 'release', id: pl.id }); }
  }
}

/** Egy logikai lépés -> az események: press|release|expire|open|close {type,id} (újrahasznált tömb). walls: a rögzített falak. */
export function stepPuzzle(pz, players, inputs, dt, walls = []) {
  pz.events.length = 0;
  if (!fin(dt) || dt <= 0 || !Array.isArray(players)) return pz.events;
  const step = Math.min(dt, pz.cfg.maxStep);
  pushBoxes(pz, players, inputs, step, walls);
  for (const s of pz.switches) {
    if (!s.on || !s.time) continue;
    s.left = Math.max(0, s.left - step);
    if (s.left === 0) { s.on = false; pz.version++; pz.events.push({ type: 'expire', id: s.id }); }
  }
  pressPlates(pz, players);
  evaluate(pz, players);
  return pz.events;
}

/** Interakció-forrás: kar ('use'), fel nem vett kulcs ('take'), zárt zár ('unlock', kulcs nélkül 'locked'). addProvider(sys, puzzleProvider(() => pz)) */
export function puzzleProvider(get) {
  return function puzzleTargets(zone, out) {
    const pz = get();
    if (!pz) return out;
    const add = (role, id, action, rect) => out.push({ key: 'pz:' + pz.id + ':' + id, kind: 'puzzle', ref: { puzzle: pz.id, role, id }, action, rect, ax: rect.x + rect.w / 2, ay: rect.y });
    for (const s of pz.switches) add('switch', s.id, 'use', rectOf(s));
    for (const k of pz.keys) if (!k.taken) add('key', k.id, 'take', rectOf(k));
    for (const d of pz.doors) if (d.lock !== null && !d.unlocked) add('door', d.id, pz.keys.some(k => k.id === d.lock && k.taken) ? 'unlock' : 'locked', d.rect);
    return out;
  };
}

/** Az 'interact' esemény (ev.kind === 'puzzle') -> {type: 'switch'|'key'|'unlock'|'locked', id, on?} | null. A kulcs a páros közös. */
export function handlePuzzleEvent(pz, players, ev) {
  if (!pz || !isObj(ev) || ev.kind !== 'puzzle' || !isObj(ev.target) || ev.target.puzzle !== pz.id) return null;
  const { role, id } = ev.target;
  let res = null;
  if (role === 'switch') {
    const s = pz.switches.find(e => e.id === id);
    if (s) { s.on = s.time ? true : !s.on; s.left = s.on ? s.time : 0; res = { type: 'switch', id, on: s.on }; }
  } else if (role === 'key') {
    const k = pz.keys.find(e => e.id === id);
    if (k && !k.taken) { k.taken = true; res = { type: 'key', id }; }
  } else if (role === 'door') {
    const d = pz.doors.find(e => e.id === id);
    if (d && d.lock !== null && !d.unlocked) {
      if (!pz.keys.some(k => k.id === d.lock && k.taken)) return { type: 'locked', id };
      d.unlocked = true; res = { type: 'unlock', id };
    }
  }
  if (res) { pz.version++; evaluate(pz, Array.isArray(players) ? players : []); }
  return res;
}

/** Mentés-kompatibilis, tiszta JSON állapot; a dobozok az origóhoz képest. A nyomólapok a pozíciókból újraszámolódnak. */
export function puzzleState(pz) {
  return {
    v: 1,
    switches: pz.switches.filter(s => s.on).map(s => [s.id, s.left]),
    boxes: pz.boxes.map(b => [b.id, b.x - pz.ox, b.y - pz.oy]),
    keys: pz.keys.filter(k => k.taken).map(k => k.id),
    unlocked: pz.doors.filter(d => d.unlocked).map(d => d.id),
    latched: [...pz.latched],
    open: pz.doors.filter(d => d.open).map(d => d.id), // a "nem záródhat rá" miatt nyitva maradt ajtó is megmarad
  };
}

/** ATOMI visszatöltés (hibás adat -> false, semmi nem változik); ismeretlen azonosító kimarad, hiányzó doboz a kezdőhelyére kerül. */
export function restorePuzzle(pz, st) {
  if (!pz || !isObj(st) || st.v !== 1) return false;
  if (!['switches', 'boxes', 'keys', 'unlocked', 'latched', 'open'].every(k => Array.isArray(st[k]))) return false;
  if (!st.switches.every(e => Array.isArray(e) && fin(e[1]) && e[1] >= 0 && e[1] <= pz.cfg.maxTime)) return false;
  if (!st.boxes.every(e => Array.isArray(e) && fin(e[1]) && fin(e[2]) && Math.abs(e[1]) <= 1e5 && Math.abs(e[2]) <= 1e5)) return false;
  const sw = new Map(st.switches.map(e => [e[0], e[1]])), bx = new Map(st.boxes.map(e => [e[0], e]));
  for (const s of pz.switches) {
    s.on = sw.has(s.id) && (!s.time || sw.get(s.id) > 0);
    s.left = s.on && s.time ? Math.min(s.time, sw.get(s.id)) : 0;
  }
  pz.boxes.forEach((b, i) => {
    const e = bx.get(b.id);
    b.x = e ? pz.ox + e[1] : pz.home[i][0]; b.y = e ? pz.oy + e[2] : pz.home[i][1];
  });
  for (const k of pz.keys) k.taken = st.keys.includes(k.id);
  for (const d of pz.doors) { d.unlocked = d.lock !== null && st.unlocked.includes(d.id); d.open = st.open.includes(d.id); }
  pz.latched = new Set(pz.order.filter(g => g.op === 'latch' && st.latched.includes(g.id)).map(g => g.id));
  for (const p of pz.plates) p.on = false;
  pressPlates(pz, []);
  // a játékosok helye itt nem ismert: a nyitva mentett ajtót az első stepPuzzle zárja be, ha már nem kell nyitva lennie
  const keep = new Set(st.open);
  evaluate(pz, []);
  for (const d of pz.doors) if (keep.has(d.id)) d.open = true;
  pz.events.length = 0; pz.version++;
  return true;
}

/** Az állapot egy JSON-zsákba (instanceData(mgr,id)) a zsák.puzzle kulcs alá, illetve onnan vissza. */
export function storePuzzle(pz, bag) {
  if (!pz || !isObj(bag)) return false;
  if (!isObj(bag.puzzle)) bag.puzzle = {};
  bag.puzzle[pz.id] = puzzleState(pz);
  return true;
}
export function loadPuzzle(pz, bag) {
  const m = isObj(bag) && isObj(bag.puzzle) ? bag.puzzle : null;
  return !!pz && !!m && Object.prototype.hasOwnProperty.call(m, pz.id) && restorePuzzle(pz, m[pz.id]);
}
