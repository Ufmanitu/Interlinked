// Makrótérkép betöltő + mikroréteg (S020; tiszta logika, DOM nélkül).
// Koordináták: világ-TILE. A mikroréteg a macroTile/regionAt-ra épül; a terep-alapot
// (terrainTile) a hívó adja callbackként, így nincs kötés a chunk-generátorhoz.
import { T, isSolidId } from './world-tiles.js';
import { hashInt } from './world-noise.js';
import { MACRO_MAP, MACRO_TEXTS, MACRO_VERSION } from './data-macro.js';

export const MACRO_CHUNK = 64;
export const TILE_PX = 32;
export const MICRO_TYPES = ['tree', 'bush', 'stone'];
export const ENTRANCE_KINDS = ['mine', 'dungeon', 'cave'];
export const MACRO_LIMITS = { maxDensity: 0.5, maxMicroSum: 0.9, maxRadius: 64, maxEntrance: 8, maxWidth: 7, pad: 4 };
export const MICRO_CONFIG = { jitter: 6, edge: 1, salt: 20020, entranceClear: 3, routeMargin: 1 };

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => typeof v === 'string' && v.length > 0;
const ckey = (cx, cy) => cx + ',' + cy;
const cof = (t) => Math.floor(t / MACRO_CHUNK);

function cleanMicro(src, where, errors) {
  const out = {};
  if (src === undefined) return out;
  if (!src || typeof src !== 'object' || Array.isArray(src)) { errors.push(where + ': micro nem objektum'); return out; }
  let sum = 0;
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (!MICRO_TYPES.includes(k)) { errors.push(where + ': ismeretlen mikro-típus ' + k); continue; }
    if (!num(v) || v < 0 || v > MACRO_LIMITS.maxDensity) { errors.push(where + ': hibás sűrűség ' + k); continue; }
    out[k] = v; sum += v;
  }
  if (sum > MACRO_LIMITS.maxMicroSum) { errors.push(where + ': a sűrűségek összege túl nagy'); return {}; }
  return out;
}

function eachItem(list, name, errors, fn) {
  const seen = new Set();
  const out = [];
  if (list === undefined) return out;
  if (!Array.isArray(list)) { errors.push(name + ': nem tömb'); return out; }
  list.forEach((it, i) => {
    const w = name + '[' + i + ']';
    if (!it || typeof it !== 'object') { errors.push(w + ': nem objektum'); return; }
    if (!str(it.id)) { errors.push(w + ': hiányzó id'); return; }
    if (seen.has(it.id)) { errors.push(w + ': duplikált id ' + it.id); return; }
    if (!str(it.nameKey)) { errors.push(w + ' ' + it.id + ': hiányzó nameKey'); return; }
    const c = fn(it, name + ' ' + it.id);
    if (!c) return;
    seen.add(it.id);
    out.push(c);
  });
  return out;
}

// Tisztítás: a hibás elem kiesik (errors-ba kerül), a játék nem áll le.
export function sanitizeMacro(data) {
  const errors = [];
  const out = { v: MACRO_VERSION, fallbackMicro: {}, regions: [], routes: [], pois: [], entrances: [] };
  if (!data || typeof data !== 'object' || Array.isArray(data)) { errors.push('macro: nem objektum'); return { clean: out, errors }; }
  if (data.v !== MACRO_VERSION) { errors.push('macro: ismeretlen verzió ' + String(data.v)); return { clean: out, errors }; }
  out.fallbackMicro = cleanMicro(data.fallbackMicro, 'fallbackMicro', errors);

  out.regions = eachItem(data.regions, 'region', errors, (r, w) => {
    const q = r.rect;
    if (!q || ![q.tx0, q.ty0, q.tx1, q.ty1].every(num) || q.tx1 <= q.tx0 || q.ty1 <= q.ty0) { errors.push(w + ': hibás rect'); return null; }
    if (r.tier !== undefined && !(Number.isInteger(r.tier) && r.tier >= 1)) { errors.push(w + ': hibás tier'); return null; }
    let levels = null;
    if (r.levels !== undefined) {
      if (!Array.isArray(r.levels) || r.levels.length !== 2 || !r.levels.every(num) || r.levels[0] > r.levels[1]) { errors.push(w + ': hibás levels'); return null; }
      levels = [r.levels[0], r.levels[1]];
    }
    const gate = r.gate && typeof r.gate === 'object' ? { soft: str(r.gate.soft) ? r.gate.soft : null, hard: str(r.gate.hard) ? r.gate.hard : null } : null;
    return { id: r.id, nameKey: r.nameKey, tier: r.tier || 1, levels, rect: { tx0: Math.floor(q.tx0), ty0: Math.floor(q.ty0), tx1: Math.floor(q.tx1), ty1: Math.floor(q.ty1) }, micro: cleanMicro(r.micro, w, errors), gate };
  });

  out.routes = eachItem(data.routes, 'route', errors, (r, w) => {
    const width = r.width === undefined ? 1 : r.width;
    if (!Number.isInteger(width) || width < 1 || width > MACRO_LIMITS.maxWidth || width % 2 === 0) { errors.push(w + ': a szélesség páratlan egész (1..7)'); return null; }
    if (!Array.isArray(r.points) || r.points.length < 2 || !r.points.every((p) => p && num(p.tx) && num(p.ty))) { errors.push(w + ': legalább 2 érvényes pont kell'); return null; }
    return { id: r.id, nameKey: r.nameKey, width, points: r.points.map((p) => ({ tx: p.tx, ty: p.ty })) };
  });

  out.pois = eachItem(data.pois, 'poi', errors, (p, w) => {
    const r = p.r === undefined ? 0 : p.r;
    if (!str(p.type) || !num(p.tx) || !num(p.ty)) { errors.push(w + ': hibás type/pozíció'); return null; }
    if (!num(r) || r < 0 || r > MACRO_LIMITS.maxRadius) { errors.push(w + ': hibás sugár'); return null; }
    if (p.clear && r <= 0) { errors.push(w + ': clear csak r > 0 mellett'); return null; }
    return { id: p.id, nameKey: p.nameKey, type: p.type, tx: Math.floor(p.tx), ty: Math.floor(p.ty), r, clear: !!p.clear };
  });

  out.entrances = eachItem(data.entrances, 'entrance', errors, (e, w) => {
    const ww = e.w === undefined ? 2 : e.w, hh = e.h === undefined ? 2 : e.h;
    if (!ENTRANCE_KINDS.includes(e.kind) || !str(e.target) || !num(e.tx) || !num(e.ty)) { errors.push(w + ': hibás kind/target/pozíció'); return null; }
    const ok = (v) => Number.isInteger(v) && v >= 1 && v <= MACRO_LIMITS.maxEntrance;
    if (!ok(ww) || !ok(hh)) { errors.push(w + ': hibás méret'); return null; }
    return { id: e.id, nameKey: e.nameKey, kind: e.kind, target: e.target, tx: Math.floor(e.tx), ty: Math.floor(e.ty), w: ww, h: hh };
  });
  return { clean: out, errors };
}

function addCell(map, cx, cy, item) {
  const k = ckey(cx, cy);
  let l = map.get(k);
  if (!l) { l = []; map.set(k, l); }
  l.push(item);
}
function addBox(map, x0, y0, x1, y1, item) {
  for (let cy = cof(y0); cy <= cof(y1); cy++) for (let cx = cof(x0); cx <= cof(x1); cx++) addCell(map, cx, cy, item);
}

export function loadMacroMap(data = MACRO_MAP) {
  const { clean, errors } = sanitizeMacro(data);
  const mm = { ...clean, errors, byId: { regions: {}, routes: {}, pois: {}, entrances: {} }, cells: new Map(), segCells: new Map() };
  for (const k of ['regions', 'routes', 'pois', 'entrances']) for (const it of clean[k]) mm.byId[k][it.id] = it;
  const pad = MACRO_LIMITS.pad;
  for (const p of clean.pois) addBox(mm.cells, p.tx - p.r - pad, p.ty - p.r - pad, p.tx + p.r + pad, p.ty + p.r + pad, { kind: 'poi', it: p });
  for (const e of clean.entrances) addBox(mm.cells, e.tx - pad, e.ty - pad, e.tx + e.w + pad, e.ty + e.h + pad, { kind: 'entrance', it: e });
  for (const r of clean.routes) {
    const m = Math.ceil(r.width / 2) + pad;
    for (let i = 0; i + 1 < r.points.length; i++) {
      const a = r.points[i], b = r.points[i + 1];
      const s = { route: r, ax: a.tx + 0.5, ay: a.ty + 0.5, bx: b.tx + 0.5, by: b.ty + 0.5 };
      addBox(mm.segCells, Math.min(a.tx, b.tx) - m, Math.min(a.ty, b.ty) - m, Math.max(a.tx, b.tx) + m, Math.max(a.ty, b.ty) + m, s);
    }
  }
  return mm;
}

export function registerMacroTexts(register, texts = MACRO_TEXTS) {
  if (typeof register === 'function') register(texts);
  return texts;
}

export function regionAt(mm, tx, ty) {
  if (!mm || !num(tx) || !num(ty)) return null;
  for (const r of mm.regions) {
    const q = r.rect;
    if (tx >= q.tx0 && tx < q.tx1 && ty >= q.ty0 && ty < q.ty1) return r;
  }
  return null;
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Az út szélessége: w tile (páratlan); margin: extra sáv tile-ban.
export function routeAt(mm, tx, ty, margin = 0) {
  if (!mm || !num(tx) || !num(ty)) return null;
  tx = Math.floor(tx); ty = Math.floor(ty);
  const list = mm.segCells.get(ckey(cof(tx), cof(ty)));
  if (!list) return null;
  let best = null, bd = Infinity;
  for (const s of list) {
    const d = segDist(tx + 0.5, ty + 0.5, s.ax, s.ay, s.bx, s.by);
    if (d <= (s.route.width - 1) / 2 + 0.75 + margin && d < bd) { bd = d; best = s.route; }
  }
  return best;
}

export function poiAt(mm, tx, ty, clearOnly = false) {
  if (!mm || !num(tx) || !num(ty)) return null;
  tx = Math.floor(tx); ty = Math.floor(ty);
  const list = mm.cells.get(ckey(cof(tx), cof(ty)));
  if (!list) return null;
  let best = null, bd = Infinity;
  for (const c of list) {
    if (c.kind !== 'poi' || (clearOnly && !c.it.clear)) continue;
    const d = Math.hypot(tx - c.it.tx, ty - c.it.ty);
    if (d <= c.it.r && d < bd) { bd = d; best = c.it; }
  }
  return best;
}

// dist: a téglalaptól mért max. tile-távolság (0 = benne).
export function entranceAt(mm, tx, ty, dist = 0) {
  if (!mm || !num(tx) || !num(ty)) return null;
  tx = Math.floor(tx); ty = Math.floor(ty);
  const list = mm.cells.get(ckey(cof(tx), cof(ty)));
  if (!list) return null;
  for (const c of list) {
    if (c.kind !== 'entrance') continue;
    const e = c.it;
    const dx = Math.max(e.tx - tx, 0, tx - (e.tx + e.w - 1));
    const dy = Math.max(e.ty - ty, 0, ty - (e.ty + e.h - 1));
    if (Math.max(dx, dy) <= dist) return e;
  }
  return null;
}

// Terep-felülírás: bejárat és út = ROAD (a víz fölött gázló), tiszta POI: ütköző -> fű.
export function macroTile(mm, tx, ty, base) {
  if (!mm || !num(tx) || !num(ty)) return base;
  if (entranceAt(mm, tx, ty, 0) || routeAt(mm, tx, ty, 0)) return T.ROAD;
  if (poiAt(mm, tx, ty, true) && isSolidId(base)) return T.GRASS;
  return base;
}

export function featuresInChunk(mm, cx, cy) {
  const out = { pois: [], entrances: [], routes: [] };
  if (!mm || !num(cx) || !num(cy)) return out;
  for (const c of mm.cells.get(ckey(cx, cy)) || []) (c.kind === 'poi' ? out.pois : out.entrances).push(c.it);
  const seen = new Set();
  for (const s of mm.segCells.get(ckey(cx, cy)) || []) if (!seen.has(s.route.id)) { seen.add(s.route.id); out.routes.push(s.route); }
  return out;
}

// Mikroréteg: determinisztikus (seed + tile-koordináta), sorrendfüggetlen.
// Visszaad: [{id,type,x,y}] (x,y = lábpont, px). Csak fűre, úton/bejáraton/tiszta POI-n kívül.
export function microChunk(mm, seed, cx, cy, opts = {}) {
  const out = [];
  if (!mm || !num(cx) || !num(cy)) return out;
  const terrain = typeof opts.terrain === 'function' ? opts.terrain : () => T.GRASS;
  const cfg = { ...MICRO_CONFIG, ...(opts.cfg || {}) };
  const s = ((num(seed) ? Math.floor(seed) : 0) >>> 0);
  const tx0 = cx * MACRO_CHUNK, ty0 = cy * MACRO_CHUNK, lo = cfg.edge, hi = MACRO_CHUNK - 1 - cfg.edge;
  for (let ly = lo; ly <= hi; ly++) {
    for (let lx = lo; lx <= hi; lx++) {
      const tx = tx0 + lx, ty = ty0 + ly;
      const reg = regionAt(mm, tx, ty);
      const micro = reg ? reg.micro : mm.fallbackMicro;
      const roll = hashInt(tx, ty, (s + cfg.salt) >>> 0) / 4294967296;
      let acc = 0, pick = null;
      for (const type of MICRO_TYPES) { acc += micro[type] || 0; if (roll < acc) { pick = type; break; } }
      if (!pick) continue;
      if (macroTile(mm, tx, ty, terrain(tx, ty)) !== T.GRASS) continue;
      if (routeAt(mm, tx, ty, cfg.routeMargin) || entranceAt(mm, tx, ty, cfg.entranceClear) || poiAt(mm, tx, ty, true)) continue;
      const j = hashInt(tx, ty, (s + cfg.salt + 1) >>> 0);
      out.push({
        id: cx + ',' + cy + ':m' + (ly * MACRO_CHUNK + lx), type: pick,
        x: (tx + 0.5) * TILE_PX + (((j & 255) / 255) - 0.5) * 2 * cfg.jitter,
        y: (ty + 0.8) * TILE_PX + ((((j >>> 8) & 255) / 255) - 0.5) * 2 * cfg.jitter,
      });
    }
  }
  return out;
}
