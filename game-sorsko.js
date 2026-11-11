// S028: Sorskő objektum logika (a falu kristálya). Tiszta logika, DOM/canvas nélkül.
// A Sorskő a mező (game-field.js) közepén áll; a szintje adja a mező sugarát (adat), a határ-gyűrű
// erőssége a legközelebbi játékos határtól mért távolságából jön. Az S087 költséget/hatást ad a szintekhez.
import { setFieldRadius } from './game-field.js';

export const SORSKO_CONFIG = {
  levels: [640, 800, 960, 1120, 1280], // mező-sugár px-ben szintenként (0. szint = az S027 falu-mező)
  footDy: 12,                          // a kristály lábpontja a mező közepe alatt (px)
  collider: { w: 40, h: 20 },          // az ütköző talp (a lábpont fölé, középen)
  ringRange: 192,                      // a gyűrű ekkora távolságon belül (a határtól, bent és kint) kezd látszani
  ringMax: 0.55,                       // a gyűrű legnagyobb alfája
  pulseAmt: 0.25,                      // a lüktetés mélysége (0 = nincs)
  pulsePeriod: 3,                      // a lüktetés periódusa mp-ben
};

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// s = createSorsko(field, {level, cfg}) -> {field, cfg, level, t} | null (hibás mező / szint)
export function createSorsko(field, opts = {}) {
  if (!field || !num(field.x) || !num(field.y) || !num(field.radius)) return null;
  const o = opts && typeof opts === 'object' ? opts : {};
  const cfg = o.cfg && Array.isArray(o.cfg.levels) && o.cfg.levels.length ? { ...SORSKO_CONFIG, ...o.cfg } : SORSKO_CONFIG;
  const s = { field, cfg, level: 0, t: 0 };
  if (!setSorskoLevel(s, o.level === undefined ? 0 : o.level)) return null;
  return s;
}

export function sorskoMaxLevel(s) { return s ? s.cfg.levels.length - 1 : 0; }

// szint beállítása (egész, 0..max); a mező sugara követi. -> sikerült-e (hibásnál érintetlen)
export function setSorskoLevel(s, level) {
  if (!s || !Number.isInteger(level) || level < 0 || level >= s.cfg.levels.length) return false;
  if (!setFieldRadius(s.field, s.cfg.levels[level])) return false;
  s.level = level;
  return true;
}

// a következő szint (fejlesztés); -> sikerült-e (a legmagasabb szinten hamis)
export function upgradeSorsko(s) { return !!s && setSorskoLevel(s, s.level + 1); }

// mentés (S032/S050): egyetlen érték, a szint; a restore csendes, hibásnál érintetlen
export function sorskoState(s) { return { v: 1, level: s.level }; }
export function restoreSorsko(s, st) {
  if (!s || !st || typeof st !== 'object' || st.v !== 1) return false;
  return setSorskoLevel(s, st.level);
}

// a kristály lábpontja (világ-px)
export function sorskoFoot(s) { return { x: s.field.x, y: s.field.y + s.cfg.footDy }; }

// ütköző talp {x,y,w,h} (bal-felső sarok; a közös fal-listába kerül)
export function sorskoCollider(s) {
  const f = sorskoFoot(s), c = s.cfg.collider;
  return { x: f.x - c.w / 2, y: f.y - c.h, w: c.w, h: c.h };
}

// a határ-gyűrű erőssége 0..1: a legközelebbi játékos távolsága a határtól (bent és kint egyaránt), simítva
export function ringStrength(s, players) {
  if (!s || !players) return 0;
  const range = s.cfg.ringRange;
  let best = 0;
  for (const p of players) {
    if (!p || !num(p.x) || !num(p.y)) continue;
    const e = Math.abs(Math.hypot(p.x - s.field.x, p.y - s.field.y) - s.field.radius);
    const t = clamp01(1 - e / range);
    best = Math.max(best, t * t * (3 - 2 * t));
  }
  return best;
}

// a gyűrű alfája: az erősség skálázza, enyhén lüktet; 0 erősségnél 0; sosem több, mint ringMax
export function ringAlpha(s, strength, t = s ? s.t : 0) {
  if (!s || !num(strength) || strength <= 0) return 0;
  const c = s.cfg;
  const ph = num(t) ? 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / c.pulsePeriod) : 1;
  return Math.min(c.ringMax, c.ringMax * clamp01(strength) * (1 - c.pulseAmt + c.pulseAmt * ph));
}

// a lüktetés/animáció órája (hibás dt kimarad)
export function stepSorsko(s, dt) {
  if (s && num(dt) && dt > 0) s.t += dt;
}
