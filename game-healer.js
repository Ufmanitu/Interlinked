// game-healer.js – a Gyógyító (healer) képességeinek HATÁSA (S058; tiszta logika, DOM nélkül; importja: game-ability).
// Képességek (adat: data-character.js): heal (GYÓGYÍTÁS-tag: a körben lévő játékosok HP-ja nő), cleanse (TISZTÍTÁS-tag: a káros státuszok lekerülnek), ward (VÉDELEM-tag: elnyelő pajzs, idővel lejár).
// Mana: a game-ability regenerálja. Mindhárom 'area' (a játékos köré, range tile): a hatókörben a gyógyító maga is benne van, így önmagát is ellátja (a heal csak selfMul-szal).
// HATÁS NÉLKÜL vétó (senki nem sérült / nincs káros státusz / mindenki védett) -> nincs költség, nincs cooldown.
// HP (az S066 Health köti): p.hp / p.hpMax (hiányzó vagy hibás -> a játékos nem gyógyítható); env.heal(p, amount, info) -> a ténylegesen gyógyított HP felülírhatja.
// Státuszok (az S072 köti): p.statuses = [id | {id}] tömb; a káros azonosítók: HEALER_CONFIG.harmful; env.cleanse(p, info) -> az eltávolítottak száma felülírhatja.
// Pajzs: absorbDamage(h, játékos, sebzés) -> {absorbed, rest} (az S066 Health a sebzés előtt hívja); a pajzs nincs mentve (rövid életű).
import { setAbilityHandler } from './game-ability.js';

export const HEALER_CONFIG = Object.freeze({
  selfMul: 0.75,       // a gyógyító saját magára ennyi szorzóval gyógyít (a társ teljes értéket kap)
  wardSecs: 20,        // mp: a pajzs tartama
  relightBelow: 0.5,   // a pajzs csak akkor újítható, ha az idő és az erő hátralévő része a teljesnek <= ennyi hányada (különben védettnek számít)
  harmful: Object.freeze(['burn', 'freeze', 'poison', 'slow', 'darkness']), // az S072 státuszai (égés, fagyás, méreg, lassítás, sötétség)
  maxEffects: 64,
});
export const HEALER_IDS = Object.freeze({ heal: 'heal', cleanse: 'cleanse', ward: 'ward' });
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const statusId = s => (typeof s === 'string' ? s : s && typeof s === 'object' && typeof s.id === 'string' ? s.id : null);

// A játékos HP-ja -> {hp,max}|null (nincs/hibás HP-mező -> nem gyógyítható).
export function hpOf(p) {
  if (!p || typeof p !== 'object') return null;
  const max = fin(p.hpMax, 0), hp = fin(p.hp, NaN);
  return max > 0 && Number.isFinite(hp) ? { hp: Math.min(max, Math.max(0, hp)), max } : null;
}
function defaultHeal(p, amount) {
  const h = hpOf(p); if (!h || !(amount > 0)) return 0;
  const to = Math.min(h.max, h.hp + amount); p.hp = to; return to - h.hp;
}
function defaultCleanse(p, harmful) {
  if (!p || !Array.isArray(p.statuses)) return 0;
  const keep = p.statuses.filter(s => !harmful.includes(statusId(s)));
  const n = p.statuses.length - keep.length; if (n > 0) p.statuses = keep; return n;
}

// env: {players, heal(p,amount,info)->gyógyított HP, cleanse(p,info)->eltávolított db, cfg}
// -> {detach(), effects[] (heal|cleanse|ward naplója), stats{heals,hpHealed,cleanses,removed,wards,absorbed}, wards Map játékos->{amount,left,max}}
export function attachHealer(sys, env) {
  env = env && typeof env === 'object' ? env : {};
  const cfg = Object.freeze({ ...HEALER_CONFIG, ...(env.cfg && typeof env.cfg === 'object' ? env.cfg : {}) });
  const h = { env, cfg, effects: [], stats: { heals: 0, hpHealed: 0, cleanses: 0, removed: 0, wards: 0, absorbed: 0 }, wards: new Map(),
    detach() { for (const id of Object.values(HEALER_IDS)) setAbilityHandler(sys, id, null); } };
  const log = e => { h.effects.push(e); if (h.effects.length > cfg.maxEffects) h.effects.shift(); };
  // a hatókörben lévő játékosok: [{i,p}] (a gyógyító mindig benne van, ha érvényes a pozíciója)
  const inRange = ev => {
    const t = ev.target, out = [];
    if (!t || t.kind !== 'area' || !Array.isArray(env.players)) return out;
    env.players.forEach((p, i) => { if (p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.hypot(p.x - t.x, p.y - t.y) <= t.r + 1e-9) out.push({ i, p }); });
    return out;
  };
  const safe = (fn, ...a) => { try { const r = fn(...a); return Number.isFinite(r) && r > 0 ? r : 0; } catch (e) { return 0; } };

  setAbilityHandler(sys, 'heal', ev => {
    const base = fin(ev.power, 0); if (!(base > 0)) return false;
    let n = 0;
    for (const { i, p } of inRange(ev)) {
      const hp = hpOf(p); if (!hp || hp.hp >= hp.max) continue;
      const amount = base * (i === ev.player ? cfg.selfMul : 1), info = { player: ev.player, target: i, ability: 'heal' };
      const got = typeof env.heal === 'function' ? safe(env.heal, p, amount, info) : defaultHeal(p, amount);
      if (got > 0) { n++; h.stats.hpHealed += got; log({ type: 'heal', player: ev.player, target: i, amount: got }); }
    }
    if (!n) return false;
    h.stats.heals++;
  });
  setAbilityHandler(sys, 'cleanse', ev => {
    let total = 0;
    for (const { i, p } of inRange(ev)) {
      const info = { player: ev.player, target: i, ability: 'cleanse' };
      const got = typeof env.cleanse === 'function' ? safe(env.cleanse, p, info) : defaultCleanse(p, cfg.harmful);
      if (got > 0) { total += got; log({ type: 'cleanse', player: ev.player, target: i, removed: got }); }
    }
    if (!total) return false;
    h.stats.cleanses++; h.stats.removed += total;
  });
  setAbilityHandler(sys, 'ward', ev => {
    const amount = fin(ev.power, 0), secs = fin(cfg.wardSecs, 0); if (!(amount > 0) || !(secs > 0)) return false;
    let n = 0;
    for (const { i } of inRange(ev)) {
      const w = h.wards.get(i);
      if (w && w.left > w.max * cfg.relightBelow && w.amount >= amount * cfg.relightBelow) continue; // még védett
      h.wards.set(i, { amount, left: secs, max: secs }); n++; log({ type: 'ward', player: ev.player, target: i, amount, secs });
    }
    if (!n) return false;
    h.stats.wards++;
  });
  return h;
}

// A pajzs léptetése: lejárt idő -> a pajzs eltűnik. -> {expired:[játékos]}
export function stepHealer(h, dt) {
  const out = { expired: [] };
  if (!h || !h.wards || !(dt > 0) || !Number.isFinite(dt)) return out;
  for (const [i, w] of [...h.wards]) { w.left -= dt; if (w.left <= 0) { h.wards.delete(i); out.expired.push(i); } }
  return out;
}
export function wardOf(h, i) { const w = h && h.wards ? h.wards.get(i) : null; return w ? { amount: w.amount, left: w.left, max: w.max } : null; }
// Sebzés a pajzson át (az S066 Health hívja a HP levonása előtt) -> {absorbed, rest}. Hibás sebzés -> nincs elnyelés, rest >= 0.
export function absorbDamage(h, i, amount) {
  const dmg = fin(amount, 0); if (!(dmg > 0)) return { absorbed: 0, rest: Math.max(0, dmg) };
  const w = h && h.wards ? h.wards.get(i) : null; if (!w || !(w.amount > 0)) return { absorbed: 0, rest: dmg };
  const a = Math.min(w.amount, dmg); w.amount -= a; if (w.amount <= 0) h.wards.delete(i);
  h.stats.absorbed += a; return { absorbed: a, rest: dmg - a };
}
