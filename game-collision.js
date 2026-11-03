// Ütközés: tiszta modul (nincs DOM/canvas). AABB, tengelyenkénti söprés a falak ellen.
// "Ütközés előbb, póráz utána": a fal levágja a mozgást, majd a póráz-korlát visszaállítja a távolságot
// (ha a húzott falnak ütközik, a húzó is megáll). Entitás: {x,y,w,h} (x,y = közép); fal: {x,y,w,h} (x,y = bal-felső sarok).
export const COLLISION_EPS = 1e-6;

export function bounds(e) {
  return { x0: e.x - e.w / 2, y0: e.y - e.h / 2, x1: e.x + e.w / 2, y1: e.y + e.h / 2 };
}

// Átfedés (érintés nem átfedés).
export function collides(e, walls) {
  const b = bounds(e);
  for (const w of walls) {
    if (b.x0 < w.x + w.w - COLLISION_EPS && b.x1 > w.x + COLLISION_EPS &&
        b.y0 < w.y + w.h - COLLISION_EPS && b.y1 > w.y + COLLISION_EPS) return true;
  }
  return false;
}

// Egy tengelyen megtehető elmozdulás (előjel megőrzve, |eredmény| <= |delta|). Falra csúszva a másik tengely szabad.
export function sweepAxis(e, axis, delta, walls) {
  if (!Number.isFinite(delta) || delta === 0) return 0;
  const b = bounds(e);
  const hx = axis === 'x';
  const a0 = hx ? b.x0 : b.y0, a1 = hx ? b.x1 : b.y1; // a mozgás tengelye
  const c0 = hx ? b.y0 : b.x0, c1 = hx ? b.y1 : b.x1; // a keresztirány
  let allowed = delta;
  for (const w of walls) {
    const w0 = hx ? w.x : w.y, w1 = w0 + (hx ? w.w : w.h);
    const v0 = hx ? w.y : w.x, v1 = v0 + (hx ? w.h : w.w);
    if (!(c0 < v1 - COLLISION_EPS && c1 > v0 + COLLISION_EPS)) continue; // keresztirányban nem fedi
    if (delta > 0) {
      if (w0 >= a1 - COLLISION_EPS) allowed = Math.min(allowed, Math.max(0, w0 - a1));
    } else if (w1 <= a0 + COLLISION_EPS) {
      allowed = Math.max(allowed, Math.min(0, w1 - a0));
    }
    // a falban már bent lévő entitás szabadon kimozoghat
  }
  return allowed;
}

// Egy tengelyen a pár levágott elmozdulásai (ca, cb) után a póráz-korlát helyreállítása:
// a távolság nem lépheti túl max(L, jelenlegi távolság)-ot; a kifelé mozgót (húzót) fékezzük.
export function constrainPair(pa, pb, ca, cb, L) {
  const d0 = pb - pa;
  const limit = Math.max(L > 0 ? L : 0, Math.abs(d0));
  const dist = Math.abs(d0 + cb - ca);
  if (!(dist > limit + COLLISION_EPS)) return { a: ca, b: cb };
  const dir = d0 !== 0 ? Math.sign(d0) : (Math.sign(cb - ca) || 1); // B kifelé iránya +dir, A-é -dir
  let over = dist - limit;
  const res = { a: ca, b: cb };
  const out = [{ k: 'a', o: -dir * ca }, { k: 'b', o: dir * cb }].sort((p, q) => q.o - p.o);
  for (const it of out) {
    if (over <= 0 || it.o <= 0) continue;
    const r = Math.min(over, it.o);
    if (it.k === 'a') res.a = ca + dir * r; else res.b = cb - dir * r;
    over -= r;
  }
  return res;
}

// A pár mozgatása: tengelyenként (x, majd y) fal-levágás, póráz-helyreállítás, léptetés.
// va, vb: a póráz által megengedett sebesség (px/s); L: {x,y} L_eff. Visszatér: { a:{x,y}, b:{x,y} } (levágott-e).
export function moveWithWalls(pa, pb, va, vb, dt, walls, L) {
  const blocked = { a: { x: false, y: false }, b: { x: false, y: false } };
  for (const ax of ['x', 'y']) {
    const wa = va[ax] * dt, wb = vb[ax] * dt;
    const ca = sweepAxis(pa, ax, wa, walls), cb = sweepAxis(pb, ax, wb, walls);
    const r = constrainPair(pa[ax], pb[ax], ca, cb, L[ax]);
    blocked.a[ax] = Math.abs(r.a - wa) > 1e-9;
    blocked.b[ax] = Math.abs(r.b - wb) > 1e-9;
    pa[ax] += r.a;
    pb[ax] += r.b;
  }
  return blocked;
}
