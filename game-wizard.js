// game-wizard.js – a Varázsló képességeinek HATÁSA (S056; tiszta logika, DOM nélkül; importja: game-ability, game-warrior (segmentHit)).
// Képességek (adat: data-character.js): light (FÉNY-tag: a játékost kísérő fény), ignite (ÉGETÉS-tag: éghető akadály + ellenfél-sebzés és égés), freeze (FAGYASZTÁS-tag: az ellenfél lefagy).
// Mana: a game-ability regenerálja (költés után késleltetés). A hatás az S054 kezelőjén át jön; HATÁS NÉLKÜL vétó (nincs fény-szükség / cél / éghető) -> nincs költés, nincs cooldown.
// Fényforrás: lightSources(w)/lightAt(w,x,y) -> az S059 (FÉNY-tag akadály), S121 (árnyék), S142 (sötét bánya) olvassa. Éghető akadály: createFlammables (az S059/S120 köti; flammableColliders a fal-listába).
// Ellenfelek (S066-ig nincsenek): env.enemies(origin, rangePx, p) -> [{x,y,hp?}]; env.damage/env.freeze felülírható; az alap: e.hp csökken, e.frozen = hátralévő mp (az AI skip-eli).
import { setAbilityHandler } from './game-ability.js';
import { segmentHit } from './game-warrior.js';

export const WIZARD_CONFIG = Object.freeze({
  igniteWidth: 24,      // px: a lángcsóva sávja (éghető akadály + ellenfél)
  igniteMaxTargets: 4,  // ennél több ellenfelet egy láng nem perzsel
  burnTime: 1.5,        // mp: az éghető akadály égési ideje, utána elég (kikerül)
  burn: Object.freeze({ dps: 2, secs: 3 }), // ellenfél égése: sebzés/mp, mp (a frissítés nem halmozódik, az újragyújtás nullázza az időt)
  relightBelow: 0.5,    // a fény csak akkor újítható, ha a hátralévő idő a teljes <= ennyi hányada (különben vétó: nincs mana-pazarlás)
  maxEffects: 64,
});
export const WIZARD_IDS = Object.freeze({ light: 'light', ignite: 'ignite', freeze: 'freeze' });
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ---- éghető akadályok ----
// defs: [{id,x,y,w,h,burn?}] (bal-felső sarok, px; burn = égési idő mp). Hibás elem kiesik; duplikált id felülír. -> {items:Map, burnt:Set, version}
export function createFlammables(defs, cfg = WIZARD_CONFIG) {
  const fs = { items: new Map(), burnt: new Set(), version: 0, cfg };
  for (const d of Array.isArray(defs) ? defs : []) {
    if (!d || typeof d !== 'object' || (typeof d.id !== 'string' && typeof d.id !== 'number')) continue;
    const x = fin(d.x, NaN), y = fin(d.y, NaN), w = fin(d.w, NaN), h = fin(d.h, NaN), burn = fin(d.burn, cfg.burnTime);
    if (!(w > 0) || !(h > 0) || !Number.isFinite(x) || !Number.isFinite(y) || !(burn > 0)) continue;
    fs.items.set(String(d.id), { id: String(d.id), x, y, w, h, burn, left: 0, lit: false });
  }
  return fs;
}
// A még álló (nem elégett) éghető akadályok ütköző-téglalapjai (égés közben is állnak).
export function flammableColliders(fs) { const out = []; if (fs && fs.items) for (const f of fs.items.values()) out.push({ x: f.x, y: f.y, w: f.w, h: f.h }); return out; }
// A szakasz mentén a LEGKÖZELEBBI még nem égő éghetőt meggyújtja -> {id}|null.
export function igniteFlammable(fs, x, y, ex, ey, width = WIZARD_CONFIG.igniteWidth) {
  if (!fs || !fs.items || ![x, y, ex, ey].every(Number.isFinite)) return null;
  let best = null, bt = Infinity;
  for (const f of fs.items.values()) { if (f.lit) continue; const t = segmentHit(x, y, ex, ey, f, width); if (t >= 0 && t < bt) { bt = t; best = f; } }
  if (!best) return null;
  best.lit = true; best.left = best.burn; return { id: best.id };
}
// Az égés léptetése: lejárt idő -> az akadály elég (kikerül, version++). -> az elégett id-k.
export function stepFlammables(fs, dt) {
  const done = []; if (!fs || !fs.items || !(dt > 0) || !Number.isFinite(dt)) return done;
  for (const f of [...fs.items.values()]) { if (!f.lit) continue; f.left -= dt; if (f.left <= 0) { fs.items.delete(f.id); fs.burnt.add(f.id); fs.version++; done.push(f.id); } }
  return done;
}
// Mentés (S050 bővíthető): {v:1, burnt:[id]} (a részleges égés nem mentett: betöltéskor az éghető ép) / visszaállítás ATOMI.
export function flammablesState(fs) { return { v: 1, burnt: [...fs.burnt] }; }
export function restoreFlammables(fs, st) {
  if (!fs || !st || st.v !== 1 || !Array.isArray(st.burnt)) return false;
  for (const id of st.burnt) { if (typeof id !== 'string' && typeof id !== 'number') return false; }
  for (const id of st.burnt) { if (fs.items.delete(String(id))) fs.version++; fs.burnt.add(String(id)); }
  return true;
}

// ---- hatások ----
function defaultDamage(e, amount) { if (e && Number.isFinite(e.hp)) { e.hp = Math.max(0, e.hp - amount); return e.hp <= 0; } return false; }

// env: {players, flammables, enemies, damage(e,amount,info)->halott?, freeze(e,secs), cfg}
// -> {detach(), effects[] (light|ignite|burn|freeze naplója), stats{lights,ignited,scorched,frozen,burned}, lights Map játékos->{left,max,r}, burning Map ref->{left,dps,player}, frozen Map ref->{left}}
export function attachWizard(sys, env) {
  env = env && typeof env === 'object' ? env : {};
  if (sys && sys.hooks && typeof env.enemies === 'function' && typeof sys.hooks.enemies !== 'function') sys.hooks.enemies = env.enemies;
  const cfg = Object.freeze({ ...WIZARD_CONFIG, ...(env.cfg && typeof env.cfg === 'object' ? env.cfg : {}) });
  const w = { env, cfg, effects: [], stats: { lights: 0, ignited: 0, scorched: 0, frozen: 0, burned: 0 }, lights: new Map(), burning: new Map(), frozen: new Map(),
    detach() { for (const id of Object.values(WIZARD_IDS)) setAbilityHandler(sys, id, null); } };
  const log = e => { w.effects.push(e); if (w.effects.length > cfg.maxEffects) w.effects.shift(); };
  const player = ev => (Array.isArray(env.players) ? env.players[ev.player] : null);
  const dmgFn = env.damage || ((e, a) => defaultDamage(e, a));
  const enemiesIn = (ev, rangePx) => { try { const f = env.enemies || (sys && sys.hooks && sys.hooks.enemies); const r = f ? f({ x: ev.x, y: ev.y }, rangePx, player(ev)) : []; return Array.isArray(r) ? r.filter(e => e && Number.isFinite(e.x) && Number.isFinite(e.y)) : []; } catch (e) { return []; } };
  w.dmgFn = dmgFn; w.player = player;

  setAbilityHandler(sys, 'light', ev => {
    const secs = fin(ev.power, 0), r = fin(ev.range, 0) * fin(sys && sys.cfg && sys.cfg.tile, 32);
    if (!(secs > 0) || !(r > 0)) return false;
    const cur = w.lights.get(ev.player);
    if (cur && cur.left > cur.max * cfg.relightBelow) return false; // még ég: nincs hatás -> nincs költés
    w.lights.set(ev.player, { left: secs, max: secs, r });
    w.stats.lights++; log({ type: 'light', player: ev.player, secs, r });
  });
  setAbilityHandler(sys, 'ignite', ev => {
    const t = ev.target; if (!t || t.kind !== 'direction') return false;
    const len = Math.hypot(t.ex - t.x, t.ey - t.y), hw = cfg.igniteWidth / 2, did = [];
    if (env.flammables) { const r = igniteFlammable(env.flammables, t.x, t.y, t.ex, t.ey, cfg.igniteWidth); if (r) { w.stats.ignited++; did.push(r.id); log({ type: 'ignite', player: ev.player, id: r.id }); } }
    const hits = [];
    for (const e of enemiesIn(ev, len + hw)) {
      const ax = e.x - t.x, ay = e.y - t.y, along = ax * t.dx + ay * t.dy, side = Math.abs(-ax * t.dy + ay * t.dx);
      if (along >= 0 && along <= len && side <= hw) hits.push({ e, along });
    }
    hits.sort((a, b) => a.along - b.along);
    const used = hits.slice(0, cfg.igniteMaxTargets);
    if (!did.length && !used.length) return false;
    for (const { e } of used) {
      if (w.frozen.delete(e)) { if (!env.freeze && e && 'frozen' in e) e.frozen = 0; } // a láng felolvasztja
      const dead = !!dmgFn(e, ev.power, { player: ev.player, ability: 'ignite' });
      if (!dead) w.burning.set(e, { left: cfg.burn.secs, dps: cfg.burn.dps, player: ev.player });
      w.stats.scorched++; log({ type: 'scorch', player: ev.player, ref: e, amount: ev.power, dead });
    }
  });
  setAbilityHandler(sys, 'freeze', ev => {
    const t = ev.target; if (!t || t.kind !== 'enemy' || !t.ref) return false;
    const secs = fin(ev.power, 0); if (!(secs > 0) || w.frozen.has(t.ref)) return false; // már fagyott: nincs hatás
    w.frozen.set(t.ref, { left: secs }); w.burning.delete(t.ref); // a fagy eloltja az égést
    if (typeof env.freeze === 'function') { try { env.freeze(t.ref, secs); } catch (e) { /* a hook hibája nem állítja meg */ } } else t.ref.frozen = secs;
    w.stats.frozen++; log({ type: 'freeze', player: ev.player, ref: t.ref, secs });
  });
  return w;
}

// A hatások idő-léptetése (fény fogyása, égés DoT, fagy lejárta, éghető akadályok égése). -> {burnt:[id], dead:[ref], thawed:[ref]}
export function stepWizard(w, dt) {
  const out = { burnt: [], dead: [], thawed: [] };
  if (!w || !(dt > 0) || !Number.isFinite(dt)) return out;
  for (const [k, l] of [...w.lights]) { l.left -= dt; if (l.left <= 0) w.lights.delete(k); }
  for (const [e, b] of [...w.burning]) {
    const part = Math.min(dt, b.left); b.left -= dt;
    if (part > 0 && w.dmgFn(e, b.dps * part, { player: b.player, ability: 'ignite', burn: true })) { w.stats.burned++; out.dead.push(e); w.burning.delete(e); w.frozen.delete(e); continue; }
    if (b.left <= 0) w.burning.delete(e);
  }
  for (const [e, f] of [...w.frozen]) {
    f.left -= dt;
    if (!w.env.freeze && e && 'frozen' in e) e.frozen = Math.max(0, f.left);
    if (f.left <= 0) { w.frozen.delete(e); out.thawed.push(e); }
  }
  if (w.env.flammables) out.burnt = stepFlammables(w.env.flammables, dt);
  return out;
}
// Élő fényforrások a játékosok jelenlegi helyén -> [{player,x,y,r,left,max}] (hibás játékos-pozíció kimarad).
export function lightSources(w) {
  const out = []; if (!w || !Array.isArray(w.env.players)) return out;
  for (const [i, l] of w.lights) { const p = w.env.players[i]; if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out.push({ player: i, x: p.x, y: p.y, r: l.r, left: l.left, max: l.max }); }
  return out;
}
// A (x,y) pont megvilágított-e valamelyik fénnyel? (az S059 FÉNY-tag akadály ezt kérdezi)
export function lightAt(w, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return lightSources(w).some(s => Math.hypot(s.x - x, s.y - y) <= s.r);
}
