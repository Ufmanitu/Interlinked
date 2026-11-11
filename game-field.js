// S026: FieldSystem logika (Sorskő-mező). Tiszta logika, DOM/canvas nélkül.
// f(p): 1 a mező belsejében, 0 a határon kívül, a határsávban (a határ BELSŐ oldalán) lineárisan 1 -> 0.
// L_eff = lerp(L_normal, L_falu, min(f(A), f(B)))  (tengelyenként)

export const FIELD_CONFIG = { tile: 32, bandTiles: 8, maxRadius: 1e6 };

const num = (v) => typeof v === 'number' && Number.isFinite(v);

export function lerp(a, b, t) { return a + (b - a) * t; }

// szám | {x,y} | függvény(players) -> {x,y} (mindkét tengely > 0, véges) | null
export function toL(L, players) {
  let v = L;
  if (typeof v === 'function') {
    try { v = v(players); } catch (e) { return null; }
  }
  if (num(v)) return v > 0 ? { x: v, y: v } : null;
  if (v && typeof v === 'object' && num(v.x) && num(v.y) && v.x > 0 && v.y > 0) return { x: v.x, y: v.y };
  return null;
}

// def: {id, x, y (px, a mező közepe), radius (px, a falu határa), band (px, alap bandTiles*tile),
//       L (L_falu: szám|{x,y}; alap: a mező átmérője)} -> mező | null
export function sanitizeField(def, cfg = FIELD_CONFIG) {
  if (!def || typeof def !== 'object') return null;
  if (!num(def.x) || !num(def.y)) return null;
  if (!num(def.radius) || def.radius <= 0 || def.radius > cfg.maxRadius) return null;
  const f = { id: String(def.id ?? 'field'), x: def.x, y: def.y, radius: def.radius, band: 0, inner: 0, L: null, autoL: true, defBand: null };
  f.defBand = num(def.band) && def.band >= 0 ? def.band : cfg.bandTiles * cfg.tile;
  const L = toL(def.L);
  if (L) { f.L = L; f.autoL = false; }
  applyGeometry(f);
  return f;
}

function applyGeometry(f) {
  f.band = Math.min(f.defBand, f.radius);
  f.inner = f.radius - f.band;
  if (f.autoL) f.L = { x: 2 * f.radius, y: 2 * f.radius };
}

// a sugár változtatása (fejlesztés, S028/S087); az automatikus L_falu követi
export function setFieldRadius(f, radius, cfg = FIELD_CONFIG) {
  if (!f || !num(radius) || radius <= 0 || radius > cfg.maxRadius) return false;
  f.radius = radius;
  applyGeometry(f);
  return true;
}

// f(p) 0..1 (hibás mező/pont -> 0 = nincs hatás)
export function fieldValue(field, p) {
  if (!field || !p || !num(p.x) || !num(p.y)) return 0;
  const d = Math.hypot(p.x - field.x, p.y - field.y);
  if (d <= field.inner) return 1;
  if (d >= field.radius) return 0;
  return (field.radius - d) / field.band;
}

// s = min(f(A), f(B)): mennyire "benne" van MINDKÉT játékos
export function fieldShare(field, a, b) {
  return Math.min(fieldValue(field, a), fieldValue(field, b));
}

// L_eff {x,y} | null (hibás L_normal -> null)
export function fieldEffectiveL(field, a, b, lNormal) {
  const ln = toL(lNormal, [a, b]);
  if (!ln) return null;
  if (!field) return ln;
  const s = fieldShare(field, a, b);
  return { x: lerp(ln.x, field.L.x, s), y: lerp(ln.y, field.L.y, s) };
}

// cfg.L-be köthető függvény (players -> L_eff): tether-system resolveL / game-splitview normalL formátum
export function fieldL(field, lNormal) {
  return (players) => fieldEffectiveL(field, players && players[0], players && players[1], lNormal);
}
