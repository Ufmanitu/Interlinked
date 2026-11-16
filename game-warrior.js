// game-warrior.js – a Harcos képességeinek HATÁSA (S055; tiszta logika, DOM nélkül; importja: game-ability).
// Képességek (adat: data-character.js): wallbreak (irányban a legközelebbi törhető falat sebzi), shove (a sávban lévő ellenfeleket eltolja), strike (a célpont sebzése).
// A hatás az S054 kezelőjén át jön: ha nincs hatás (nincs fal / ellenfél), a kezelő vétózza -> nincs költség, nincs cooldown. Az erő (p.strength, S053) szorozza a hatást.
// Törhető falak: createBreakables (az S059 akadály-rendszer és a világ-térkép köti; breakableColliders a póráz/ütközés fal-listájába fűzendő).
// Ellenfelek (S066-ig nincsenek): env.enemies(origin, rangePx, p) -> [{x,y,hp?}]; env.damage / env.push felülírható; az alap: e.hp csökken, e.x/e.y mozdul.
import { setAbilityHandler } from './game-ability.js';

export const WARRIOR_CONFIG = Object.freeze({
  wallWidth: 24,      // px: a falbontó sáv szélessége az irány körül
  shoveWidth: 48,     // px: a tolás sávjának szélessége
  shoveMaxTargets: 6, // ennél több ellenfelet egy tolás nem mozdít
  pushStep: 4,        // px: a tolás lépésköze (solid(x,y) ellenőrzéssel: falba nem tol)
  strengthMin: 0.25, strengthMax: 4,
  wallHp: 3,          // alap fal-életerő
  maxEffects: 64,
});
export const WARRIOR_IDS = Object.freeze({ wallbreak: 'wallbreak', shove: 'shove', strike: 'strike' });

const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const strengthMul = (p, cfg = WARRIOR_CONFIG) => Math.min(cfg.strengthMax, Math.max(cfg.strengthMin, fin(p && p.strength, 1)));

// ---- törhető falak ----
// defs: [{id,x,y,w,h,hp?}] (bal-felső sarok, px). Hibás elem kiesik; duplikált id felülír. -> {walls:Map, broken:Set, version}
export function createBreakables(defs, cfg = WARRIOR_CONFIG) {
  const bs = { walls: new Map(), broken: new Set(), version: 0, cfg };
  for (const d of Array.isArray(defs) ? defs : []) {
    if (!d || typeof d !== 'object' || (typeof d.id !== 'string' && typeof d.id !== 'number')) continue;
    const x = fin(d.x, NaN), y = fin(d.y, NaN), w = fin(d.w, NaN), h = fin(d.h, NaN), hp = fin(d.hp, cfg.wallHp);
    if (!(w > 0) || !(h > 0) || !Number.isFinite(x) || !Number.isFinite(y) || !(hp > 0)) continue;
    bs.walls.set(String(d.id), { id: String(d.id), x, y, w, h, hp, max: hp });
  }
  return bs;
}
// A még álló falak ütköző-téglalapjai ([{x,y,w,h}]).
export function breakableColliders(bs) { const out = []; if (bs && bs.walls) for (const w of bs.walls.values()) out.push({ x: w.x, y: w.y, w: w.w, h: w.h }); return out; }
// Szakasz (x,y)->(ex,ey) metszi-e a téglalapot (szélességgel kiterjesztve) -> belépési paraméter t 0..1 | -1 (nincs). Liang–Barsky.
export function segmentHit(x, y, ex, ey, rect, width = 0) {
  const hw = Math.max(0, width) / 2, x0 = rect.x - hw, y0 = rect.y - hw, x1 = rect.x + rect.w + hw, y1 = rect.y + rect.h + hw;
  const dx = ex - x, dy = ey - y; let t0 = 0, t1 = 1;
  for (const [pp, qq] of [[-dx, x - x0], [dx, x1 - x], [-dy, y - y0], [dy, y1 - y]]) {
    if (pp === 0) { if (qq < 0) return -1; } else { const r = qq / pp; if (pp < 0) { if (r > t1) return -1; if (r > t0) t0 = r; } else { if (r < t0) return -1; if (r < t1) t1 = r; } }
  }
  return t0;
}
// A szakasz mentén a LEGKÖZELEBBI fal sebzése -> {id,hp,broken,dmg}|null (nincs fal a szakaszon / hibás bemenet). Törés: a fal kikerül (broken, version++).
export function damageBreakable(bs, x, y, ex, ey, dmg, width = WARRIOR_CONFIG.wallWidth) {
  if (!bs || !bs.walls || ![x, y, ex, ey].every(Number.isFinite) || !(dmg > 0)) return null;
  let best = null, bt = Infinity;
  for (const w of bs.walls.values()) { const t = segmentHit(x, y, ex, ey, w, width); if (t >= 0 && t < bt) { bt = t; best = w; } }
  if (!best) return null;
  best.hp = Math.max(0, best.hp - dmg);
  const broken = best.hp <= 0;
  if (broken) { bs.walls.delete(best.id); bs.broken.add(best.id); bs.version++; }
  return { id: best.id, hp: best.hp, max: best.max, broken, dmg };
}
// Mentés (S050 bővíthető): {v:1, broken:[id], hp:[[id,hp]]} / visszaállítás (ATOMI; ismeretlen verzió -> false). A defs-ből épített tárra.
export function breakablesState(bs) { return { v: 1, broken: [...bs.broken], hp: [...bs.walls.values()].filter(w => w.hp < w.max).map(w => [w.id, w.hp]) }; }
export function restoreBreakables(bs, st) {
  if (!bs || !st || st.v !== 1 || !Array.isArray(st.broken) || !Array.isArray(st.hp)) return false;
  for (const id of st.broken) { if (typeof id !== 'string' && typeof id !== 'number') return false; }
  for (const e of st.hp) { if (!Array.isArray(e) || !Number.isFinite(e[1]) || e[1] <= 0) return false; }
  for (const id of st.broken) { if (bs.walls.delete(String(id))) bs.version++; bs.broken.add(String(id)); }
  for (const [id, hp] of st.hp) { const w = bs.walls.get(String(id)); if (w) w.hp = Math.min(w.max, hp); }
  return true;
}

// ---- hatások ----
function defaultDamage(e, amount) { if (e && Number.isFinite(e.hp)) { e.hp = Math.max(0, e.hp - amount); return e.hp <= 0; } return false; }
function defaultPush(e, dx, dy, dist, env, cfg) {
  let moved = 0;
  while (moved < dist - 1e-9) {
    const s = Math.min(cfg.pushStep, dist - moved), nx = e.x + dx * s, ny = e.y + dy * s;
    if (typeof env.solid === 'function' && env.solid(nx, ny)) break;
    e.x = nx; e.y = ny; moved += s;
  }
  return moved;
}

// A kezelők bekötése a képesség-rendszerre. env: {players (tömb), breakables, enemies, damage(e,amount,info)->bool, push(e,dx,dy,dist)->px, solid(x,y)->bool, cfg}
// -> {detach(), effects[] (a hatások naplója: {type 'wall'|'push'|'hit', player, ...}), stats{walls,broken,pushed,hits}, env}
export function attachWarrior(sys, env) {
  env = env && typeof env === 'object' ? env : {};
  if (sys && sys.hooks && typeof env.enemies === 'function' && typeof sys.hooks.enemies !== 'function') sys.hooks.enemies = env.enemies; // a strike célpontját (resolveTarget) is ez adja
  const cfg = Object.freeze({ ...WARRIOR_CONFIG, ...(env.cfg && typeof env.cfg === 'object' ? env.cfg : {}) });
  const w = { env, cfg, effects: [], stats: { walls: 0, broken: 0, pushed: 0, hits: 0 }, detach() { for (const id of Object.values(WARRIOR_IDS)) setAbilityHandler(sys, id, null); } };
  const log = e => { w.effects.push(e); if (w.effects.length > cfg.maxEffects) w.effects.shift(); };
  const player = ev => (Array.isArray(env.players) ? env.players[ev.player] : null);
  const enemiesIn = (ev, rangePx) => { try { const f = env.enemies || (sys && sys.hooks && sys.hooks.enemies); const r = f ? f({ x: ev.x, y: ev.y }, rangePx, player(ev)) : []; return Array.isArray(r) ? r.filter(e => e && Number.isFinite(e.x) && Number.isFinite(e.y)) : []; } catch (e) { return []; } };
  const dmgFn = env.damage || ((e, a) => defaultDamage(e, a));

  setAbilityHandler(sys, 'wallbreak', ev => {
    const t = ev.target; if (!t || t.kind !== 'direction' || !env.breakables) return false;
    const r = damageBreakable(env.breakables, t.x, t.y, t.ex, t.ey, ev.power * strengthMul(player(ev), cfg), cfg.wallWidth);
    if (!r) return false;
    w.stats.walls++; if (r.broken) w.stats.broken++;
    log({ type: 'wall', player: ev.player, id: r.id, hp: r.hp, broken: r.broken });
  });
  setAbilityHandler(sys, 'shove', ev => {
    const t = ev.target; if (!t || t.kind !== 'direction') return false;
    const len = Math.hypot(t.ex - t.x, t.ey - t.y), hw = cfg.shoveWidth / 2, dist = ev.power * strengthMul(player(ev), cfg);
    const hits = [];
    for (const e of enemiesIn(ev, len + hw)) {
      const ax = e.x - t.x, ay = e.y - t.y, along = ax * t.dx + ay * t.dy, side = Math.abs(-ax * t.dy + ay * t.dx);
      if (along >= 0 && along <= len && side <= hw) hits.push({ e, along });
    }
    hits.sort((a, b) => a.along - b.along);
    const used = hits.slice(0, cfg.shoveMaxTargets);
    if (!used.length) return false;
    for (const { e } of used) {
      const moved = env.push ? fin(env.push(e, t.dx, t.dy, dist), 0) : defaultPush(e, t.dx, t.dy, dist, env, cfg);
      w.stats.pushed++; log({ type: 'push', player: ev.player, ref: e, moved });
    }
  });
  setAbilityHandler(sys, 'strike', ev => {
    const t = ev.target; if (!t || t.kind !== 'enemy' || !t.ref) return false;
    const amount = ev.power * strengthMul(player(ev), cfg), dead = !!dmgFn(t.ref, amount, { player: ev.player, ability: 'strike' });
    w.stats.hits++; log({ type: 'hit', player: ev.player, ref: t.ref, amount, dead });
  });
  return w;
}
