// Rács-alapú útkeresés (S067). Tiszta logika, DOM és canvas nélkül.
// A*: 8 irány, sarok-vágás nélkül, csomópont-korláttal; ha a cél nem érhető el, a legközelebbi elért pontig megy (partial).
// A "blocked(tx,ty)" függvényt a hívó adja (createBlocker: fal-téglalapok + tile-ütközés, korlátos körzetben).

export const PATH_CONFIG = Object.freeze({ tile: 32, maxNodes: 700, maxLen: 120, radius: 22, losStep: 8 });

const fin = v => typeof v === 'number' && Number.isFinite(v);
const SQ = Math.SQRT2;
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQ], [1, -1, SQ], [-1, 1, SQ], [-1, -1, SQ]];
const OFF = 1 << 24, MUL = 1 << 26;
const keyOf = (tx, ty) => (ty + OFF) * MUL + (tx + OFF);
const octile = (ax, ay, bx, by) => { const dx = Math.abs(ax - bx), dy = Math.abs(ay - by); return dx + dy + (SQ - 2) * Math.min(dx, dy); };

// bináris kupac (f, majd id szerint: determinisztikus)
function heapPush(h, n) {
  h.push(n); let i = h.length - 1;
  while (i > 0) { const p = (i - 1) >> 1; if (less(h[p], h[i])) break; [h[p], h[i]] = [h[i], h[p]]; i = p; }
}
function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last; let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < h.length && less(h[l], h[m])) m = l;
      if (r < h.length && less(h[r], h[m])) m = r;
      if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m;
    }
  }
  return top;
}
const less = (a, b) => (a.f !== b.f ? a.f < b.f : a.id < b.id);

const okTile = t => t && Number.isInteger(t.tx) && Number.isInteger(t.ty) && Math.abs(t.tx) < OFF / 2 && Math.abs(t.ty) < OFF / 2;

/**
 * findPath({from:{tx,ty}, to:{tx,ty}, blocked(tx,ty), maxNodes, maxLen}) ->
 * {ok, path:[{tx,ty}] (a kezdő tile-lal), partial, nodes, reason}. A kezdő tile mindig járható.
 * reason: bad-input | no-path. Zárt/elérhetetlen cél -> a legközelebbi elért tile-ig (partial), ha az nem a kezdő.
 */
export function findPath(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  if (!okTile(o.from) || !okTile(o.to) || typeof o.blocked !== 'function') return { ok: false, path: [], partial: false, nodes: 0, reason: 'bad-input' };
  const maxNodes = fin(o.maxNodes) && o.maxNodes >= 1 ? Math.floor(o.maxNodes) : PATH_CONFIG.maxNodes;
  const maxLen = fin(o.maxLen) && o.maxLen >= 1 ? Math.floor(o.maxLen) : PATH_CONFIG.maxLen;
  const { from, to } = o;
  if (from.tx === to.tx && from.ty === to.ty) return { ok: true, path: [{ tx: from.tx, ty: from.ty }], partial: false, nodes: 0, reason: null };
  const blk = (x, y) => { try { return !!o.blocked(x, y); } catch (e) { return true; } };
  const nodes = new Map(); const open = []; let seq = 0;
  const start = { tx: from.tx, ty: from.ty, g: 0, h: octile(from.tx, from.ty, to.tx, to.ty), f: 0, parent: null, closed: false, id: seq++ };
  start.f = start.h; nodes.set(keyOf(start.tx, start.ty), start); heapPush(open, start);
  let best = start, expanded = 0, found = null;
  while (open.length) {
    const cur = heapPop(open);
    if (cur.closed) continue;
    cur.closed = true;
    if (cur.tx === to.tx && cur.ty === to.ty) { found = cur; break; }
    if (cur.h < best.h || (cur.h === best.h && cur.g < best.g)) best = cur;
    if (++expanded >= maxNodes) break;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cur.tx + dx, ny = cur.ty + dy;
      if (dx && dy && (blk(cur.tx + dx, cur.ty) || blk(cur.tx, cur.ty + dy))) continue; // nincs sarok-vágás
      const k = keyOf(nx, ny); let n = nodes.get(k);
      if (n && n.closed) continue;
      if (!n && blk(nx, ny)) continue;
      const g = cur.g + cost;
      if (!n) { n = { tx: nx, ty: ny, g, h: octile(nx, ny, to.tx, to.ty), f: 0, parent: cur, closed: false, id: seq++ }; n.f = g + n.h; nodes.set(k, n); heapPush(open, n); }
      else if (g < n.g) { n.g = g; n.f = g + n.h; n.parent = cur; n.id = seq++; heapPush(open, n); }
    }
  }
  const end = found || best;
  if (!found && end === start) return { ok: false, path: [], partial: false, nodes: expanded, reason: 'no-path' };
  let path = []; for (let n = end; n; n = n.parent) path.push({ tx: n.tx, ty: n.ty });
  path.reverse();
  let partial = !found;
  if (path.length > maxLen) { path = path.slice(0, maxLen); partial = true; }
  return { ok: true, path, partial, nodes: expanded, reason: null };
}

/** A tile-útvonal tile-közepei pixelben, a kezdő tile nélkül. */
export function pathPoints(path, tile = PATH_CONFIG.tile) {
  if (!Array.isArray(path)) return [];
  return path.slice(1).map(t => ({ x: (t.tx + 0.5) * tile, y: (t.ty + 0.5) * tile }));
}

/** Szakasz-vágás (Liang–Barsky): metszi-e a szakasz valamelyik (pad-del tágított) téglalapot. rect: {x,y,w,h} bal-felső sarok. */
export function segmentBlocked(x0, y0, x1, y1, rects, pad = 0) {
  if (![x0, y0, x1, y1].every(fin) || !Array.isArray(rects)) return false;
  const dx = x1 - x0, dy = y1 - y0;
  const minX = Math.min(x0, x1) - pad, maxX = Math.max(x0, x1) + pad, minY = Math.min(y0, y1) - pad, maxY = Math.max(y0, y1) + pad;
  for (const r of rects) {
    if (r.x >= maxX || r.x + r.w <= minX || r.y >= maxY || r.y + r.h <= minY) continue; // gyors előszűrő
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy], q = [x0 - (r.x - pad), (r.x + r.w + pad) - x0, y0 - (r.y - pad), (r.y + r.h + pad) - y0];
    let hit = true;
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] <= 0) { hit = false; break; } continue; }
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) { hit = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { hit = false; break; } if (t < t1) t1 = t; }
    }
    if (hit && t0 < t1) return true;
  }
  return false;
}

/** Rálátás tile-blokkolóval: mintavételezés lépésenként (px); blockedPx(px,py) -> bool. */
export function hasLineOfSight(x0, y0, x1, y1, blockedPx, step = PATH_CONFIG.losStep) {
  if (![x0, y0, x1, y1].every(fin) || typeof blockedPx !== 'function') return false;
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / Math.max(1, step)));
  for (let i = 0; i <= n; i++) { const t = i / n; if (blockedPx(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false; }
  return true;
}

/** Mohó útvonal-húzás: a kezdőpontból mindig a legtávolabbi, még szabad rálátású pontra megy. */
export function smoothPath(start, points, clear) {
  if (!Array.isArray(points) || !points.length || typeof clear !== 'function') return Array.isArray(points) ? points.slice() : [];
  const out = []; let cur = start, i = 0;
  while (i < points.length) {
    let j = points.length - 1;
    while (j > i && !clear(cur.x, cur.y, points[j].x, points[j].y)) j--;
    out.push(points[j]); cur = points[j]; i = j + 1;
  }
  return out;
}

/**
 * createBlocker({rects, solidTile(tx,ty)->bool, tile, cx, cy (px), radius (tile)}) -> blocked(tx,ty) (+ .solidPx(px,py), .size).
 * A (cx,cy) körüli radius tile-on kívüli tile blokkolt (így a keresés korlátos); a téglalapok egyszer, előre szűrve;
 * a tile blokkolt, ha egy téglalap a belsejét átfedi, vagy solidTile igaz.
 */
export function createBlocker(o = {}) {
  const tile = fin(o.tile) && o.tile > 0 ? o.tile : PATH_CONFIG.tile;
  const R = fin(o.radius) && o.radius > 0 ? o.radius : PATH_CONFIG.radius;
  const cx = fin(o.cx) ? Math.floor(o.cx / tile) : 0, cy = fin(o.cy) ? Math.floor(o.cy / tile) : 0;
  const x0 = (cx - R - 1) * tile, x1 = (cx + R + 2) * tile, y0 = (cy - R - 1) * tile, y1 = (cy + R + 2) * tile;
  const near = (Array.isArray(o.rects) ? o.rects : []).filter(r => r && r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0);
  const solid = typeof o.solidTile === 'function' ? o.solidTile : null;
  const cache = new Map();
  const blocked = (tx, ty) => {
    if (Math.abs(tx - cx) > R || Math.abs(ty - cy) > R) return true;
    const k = keyOf(tx, ty); let v = cache.get(k);
    if (v === undefined) {
      const ax = tx * tile, ay = ty * tile;
      v = false;
      if (solid) { try { v = !!solid(tx, ty); } catch (e) { v = true; } }
      if (!v) for (const r of near) if (r.x < ax + tile - 1e-6 && r.x + r.w > ax + 1e-6 && r.y < ay + tile - 1e-6 && r.y + r.h > ay + 1e-6) { v = true; break; }
      cache.set(k, v);
    }
    return v;
  };
  blocked.solidPx = (px, py) => blocked(Math.floor(px / tile), Math.floor(py / tile));
  blocked.size = () => cache.size;
  return blocked;
}
