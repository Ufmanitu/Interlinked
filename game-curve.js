// S047: globális (karakter-)szintgörbe és haladás. Tiszta logika, DOM és import nélkül.
// XP(L) = alap · L^p lépésenként; a szint 0..maxLevel (mint a skilleknél), a 0. szint = friss karakter.
// A p-t a GDD 8.2 tier-határainak kumulatív idejéhez illesztjük (fitCurve); S109/S187 hangolja.
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, lo, hi, d) => (fin(v) ? Math.min(hi, Math.max(lo, v)) : d);

export const CURVE_LIMITS = Object.freeze({
  maxLevel: 60, minBase: 1, maxBase: 1e5, minP: 0, maxP: 4, minRate: 1e-6, maxRate: 1e9,
  maxGain: 1e9, maxEvents: 64,
});
// A GDD 8.2 tábla: {szint a tier végén, kumulatív óra}.
export const TIER_TARGETS = Object.freeze([
  [10, 8], [20, 24], [30, 42], [40, 60], [50, 78], [58, 96], [60, 108],
].map(([level, hours]) => Object.freeze({ level, hours })));
// Illesztett kezdőérték (base 100): p 0.43, referencia-bevétel ~233 XP/óra (RMS hiba ~5%).
export const CURVE_CONFIG = Object.freeze({ base: 100, p: 0.43, maxLevel: 60, rate: 233.5 });

export function sanitizeCurveConfig(src) {
  const s = src && typeof src === 'object' ? src : {};
  const L = CURVE_LIMITS;
  return Object.freeze({
    base: num(s.base, L.minBase, L.maxBase, CURVE_CONFIG.base),
    p: num(s.p, L.minP, L.maxP, CURVE_CONFIG.p),
    maxLevel: Math.floor(num(s.maxLevel, 1, L.maxLevel, CURVE_CONFIG.maxLevel)),
    rate: num(s.rate, L.minRate, L.maxRate, CURVE_CONFIG.rate),
  });
}

// cum[L] = az L. szint eléréséhez kellő összes XP; a lépés: max(1, round(alap · L^p)).
export function createCurve(src) {
  const cfg = sanitizeCurveConfig(src);
  const cum = new Float64Array(cfg.maxLevel + 1);
  for (let i = 1; i <= cfg.maxLevel; i++) cum[i] = cum[i - 1] + Math.max(1, Math.round(cfg.base * Math.pow(i, cfg.p)));
  return { cfg, cum };
}
export function xpToReach(curve, L) {
  const max = curve.cfg.maxLevel;
  if (!fin(L) || L <= 0) return 0;
  return curve.cum[Math.min(max, Math.floor(L))];
}
export function xpStepAt(curve, L) {
  if (!fin(L) || L < 1 || L > curve.cfg.maxLevel) return 0;
  const l = Math.floor(L);
  return curve.cum[l] - curve.cum[l - 1];
}
export function levelForXp(curve, xp) {
  if (!fin(xp) || xp <= 0) return 0;
  let lo = 0, hi = curve.cfg.maxLevel;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (curve.cum[mid] <= xp) lo = mid; else hi = mid - 1;
  }
  return lo;
}
export function curveProgress(curve, xp) {
  const x = fin(xp) && xp > 0 ? Math.min(xp, curve.cum[curve.cfg.maxLevel]) : 0;
  const level = levelForXp(curve, x);
  const max = level >= curve.cfg.maxLevel;
  const need = max ? 0 : curve.cum[level + 1] - curve.cum[level];
  const into = max ? 0 : x - curve.cum[level];
  return { xp: x, level, into, need, ratio: max ? 1 : into / need, max };
}
export function hoursAt(curve, L, rate) {
  const r = fin(rate) && rate > 0 ? rate : curve.cfg.rate;
  return xpToReach(curve, L) / r;
}
export function levelAtHours(curve, hours, rate) {
  const r = fin(rate) && rate > 0 ? rate : curve.cfg.rate;
  return fin(hours) && hours > 0 ? levelForXp(curve, hours * r) : 0;
}
// A tier-határok: cél-óra vs a görbe órája (a referencia-bevétellel).
export function tierReport(curve, targets = TIER_TARGETS, rate) {
  const out = [];
  for (const t of Array.isArray(targets) ? targets : []) {
    if (!t || !fin(t.level) || !fin(t.hours) || t.hours <= 0 || t.level < 1) continue;
    const model = hoursAt(curve, t.level, rate);
    out.push({ level: t.level, target: t.hours, model, ratio: model / t.hours });
  }
  return out;
}
// p és bevétel illesztése (log-hiba legkisebb szórása); null, ha < 2 érvényes cél.
export function fitCurve(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const ts = (Array.isArray(o.targets) ? o.targets : TIER_TARGETS)
    .filter((t) => t && fin(t.level) && fin(t.hours) && t.level >= 1 && t.level <= CURVE_LIMITS.maxLevel && t.hours > 0);
  if (ts.length < 2) return null;
  const base = sanitizeCurveConfig({ base: o.base }).base;
  const at = (p) => {
    const c = createCurve({ base, p });
    const lr = ts.map((t) => Math.log(xpToReach(c, t.level)) - Math.log(t.hours));
    const m = lr.reduce((a, b) => a + b, 0) / lr.length;
    return { p, rate: Math.exp(m), rms: Math.sqrt(lr.reduce((a, b) => a + (b - m) ** 2, 0) / lr.length) };
  };
  let best = null;
  for (let p = 0; p <= CURVE_LIMITS.maxP + 1e-9; p += 0.01) { const r = at(+p.toFixed(2)); if (!best || r.rms < best.rms) best = r; }
  const c0 = best.p;
  for (let p = Math.max(0, c0 - 0.01); p <= Math.min(CURVE_LIMITS.maxP, c0 + 0.01) + 1e-9; p += 0.001) {
    const r = at(+p.toFixed(3)); if (r.rms < best.rms) best = r;
  }
  return { base, p: best.p, rate: best.rate, rms: best.rms };
}

export const PROG_TEXTS = {
  hu: { level: 'Szint {n}', max: 'Max. szint', xp: '{into} / {need} XP', levelup: 'Szintlépés: {n}' },
  en: { level: 'Level {n}', max: 'Max level', xp: '{into} / {need} XP', levelup: 'Level up: {n}' },
};

// --- Haladás: játékosonként összes XP -> szint ---
export function createProgression(src) {
  const curve = src && src.cum && src.cfg ? src : createCurve(src);
  return { curve, xp: [0, 0], listeners: [], events: [], stats: { gains: 0, levelups: 0, rejected: 0 }, lastError: null };
}
export function onProgress(pr, fn) {
  if (typeof fn !== 'function') return () => {};
  pr.listeners.push(fn);
  return () => { const i = pr.listeners.indexOf(fn); if (i >= 0) pr.listeners.splice(i, 1); };
}
function emit(pr, ev) {
  pr.events.push(ev);
  if (pr.events.length > CURVE_LIMITS.maxEvents) pr.events.shift();
  for (const fn of pr.listeners.slice()) { try { fn(ev); } catch (e) { pr.lastError = String(e && e.message || e); } }
}
const okPlayer = (p) => p === 0 || p === 1;
export function charXp(pr, p) { return okPlayer(p) ? pr.xp[p] : 0; }
export function charLevel(pr, p) { return levelForXp(pr.curve, charXp(pr, p)); }
export function charProgress(pr, p) { return curveProgress(pr.curve, charXp(pr, p)); }
export function addCharXp(pr, p, amount, source) {
  const bad = (reason) => { pr.stats.rejected++; return { ok: false, reason, gained: 0, xp: charXp(pr, p), level: charLevel(pr, p), levels: 0 }; };
  if (!okPlayer(p)) return bad('player');
  if (!fin(amount) || amount < 1) return bad('amount');
  const cap = pr.curve.cum[pr.curve.cfg.maxLevel];
  const before = pr.xp[p], from = levelForXp(pr.curve, before);
  const gained = Math.max(0, Math.min(Math.floor(Math.min(amount, CURVE_LIMITS.maxGain)), cap - before));
  pr.xp[p] = before + gained;
  const level = levelForXp(pr.curve, pr.xp[p]);
  if (gained > 0) {
    pr.stats.gains++;
    emit(pr, { type: 'charxp', player: p, amount: gained, xp: pr.xp[p], level, source: source == null ? null : String(source) });
    if (level > from) { pr.stats.levelups++; emit(pr, { type: 'charlevel', player: p, from, level }); }
  }
  return { ok: true, reason: null, gained, xp: pr.xp[p], level, levels: level - from };
}
// sub = (fn) => leválasztó (pl. fn => onSkill(skills, fn)); a skill 'xp' eseménye a karakter-XP-t is növeli.
export function connectProgression(pr, sub) {
  if (typeof sub !== 'function') return () => {};
  return sub((ev) => { if (ev && ev.type === 'xp') addCharXp(pr, ev.player, ev.amount, ev.skill); });
}
export function progressionState(pr) { return { v: 1, xp: [pr.xp[0], pr.xp[1]] }; }
export function restoreProgression(pr, st) {
  const cap = pr.curve.cum[pr.curve.cfg.maxLevel];
  if (!st || st.v !== 1 || !Array.isArray(st.xp) || st.xp.length !== 2) return false;
  if (!st.xp.every((x) => Number.isSafeInteger(x) && x >= 0)) return false;
  pr.xp = [Math.min(cap, st.xp[0]), Math.min(cap, st.xp[1])];
  return true;
}
