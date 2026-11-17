// game-ranger.js – a Vadőr (ranger) képességeinek HATÁSA (S057; tiszta logika, DOM nélkül; importja: game-ability, game-warrior (segmentHit)).
// Képességek (adat: data-character.js): track (NYOMKÖVETÉS-tag: rejtett nyomok feltárása + ellenfelek jelölése), rope (KÖTÉL-tag: kötél a horgonyra), shoot (távolsági lövés, falon nem hatol át).
// Fókusz: a game-ability regenerálja (gyors). HATÁS NÉLKÜL vétó (nincs rejtett nyom/ellenfél, nincs horgony, nincs találat) -> nincs költség, nincs cooldown.
// Rejtett nyomok: createHiddens (az S122 rejtett ösvényei és az S162 nyomai kötik; a feltárás tartós, mentés: huntState). Horgonyok: createAnchors (S130 átkelők, S150 mászás; ropeActive/ropeLinks olvassa).
// Ellenfelek (S066-ig nincsenek): env.enemies(origin, rangePx, p) -> [{x,y,hp?}]; env.damage/env.mark felülírható; az alap: e.hp csökken, e.tracked = hátralévő jelölés-mp.
import { setAbilityHandler } from './game-ability.js';
import { segmentHit } from './game-warrior.js';

export const RANGER_CONFIG = Object.freeze({
  hiddenR: 16,       // px: egy rejtett nyom alap érzékelési sugara
  shootWidth: 14,    // px: a nyílvessző sávja
  shootStep: 8,      // px: a fal-ellenőrzés lépésköze a lövés vonalán (env.solid)
  markedBonus: 0.25, // a jelölt célpont ennyivel több sebzést kap a lövéstől
  ropeWidth: 16,     // px: a kötéldobás sávja (a horgony téglalapja ennyivel szélesedik)
  ropeSlack: 1.5,    // a kötél a dobás hosszának ennyiszeresénél elszakad
  relightBelow: 0.5, // jelölés/kötél csak akkor újítható, ha a hátralévő idő a teljes <= ennyi hányada (különben vétó)
  maxEffects: 64,
});
export const RANGER_IDS = Object.freeze({ track: 'track', rope: 'rope', shoot: 'shoot' });
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const okId = id => typeof id === 'string' || typeof id === 'number';

// ---- rejtett nyomok ----
// defs: [{id,x,y,r?,kind?}] (a pont közepe, px). Hibás elem kiesik; duplikált id felülír. -> {items:Map, found:Set, version}
export function createHiddens(defs, cfg = RANGER_CONFIG) {
  const hs = { items: new Map(), found: new Set(), version: 0, cfg };
  for (const d of Array.isArray(defs) ? defs : []) {
    if (!d || typeof d !== 'object' || !okId(d.id)) continue;
    const x = fin(d.x, NaN), y = fin(d.y, NaN), r = fin(d.r, cfg.hiddenR);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(r > 0)) continue;
    hs.items.set(String(d.id), { id: String(d.id), x, y, r, kind: typeof d.kind === 'string' && d.kind ? d.kind : 'trace' });
  }
  return hs;
}
// A (x,y) körüli r sugarú körben (+ a nyom saját sugara) a még rejtett nyomok feltárása -> az újonnan feltártak [{id,kind,x,y}] (version++).
export function revealHidden(hs, x, y, r) {
  const out = []; if (!hs || !hs.items || ![x, y, r].every(Number.isFinite) || r < 0) return out;
  for (const h of hs.items.values()) if (!hs.found.has(h.id) && Math.hypot(h.x - x, h.y - y) <= r + h.r) { hs.found.add(h.id); out.push({ id: h.id, kind: h.kind, x: h.x, y: h.y }); }
  if (out.length) hs.version++;
  return out;
}
export const hiddenFound = hs => (hs && hs.items ? [...hs.found].map(id => hs.items.get(id)).filter(Boolean) : []);
// Mentés (S050 bővíthető): {v:1, found:[id]} / visszaállítás ATOMI (hibás -> false, semmi nem változik).
export function huntState(hs) { return { v: 1, found: [...hs.found] }; }
export function restoreHiddens(hs, st) {
  if (!hs || !st || st.v !== 1 || !Array.isArray(st.found) || !st.found.every(okId)) return false;
  for (const id of st.found) if (!hs.found.has(String(id))) { hs.found.add(String(id)); hs.version++; }
  return true;
}

// ---- kötél-horgonyok ----
// defs: [{id,x,y,w,h}] (bal-felső sarok, px). -> {items:Map}
export function createAnchors(defs) {
  const as = { items: new Map() };
  for (const d of Array.isArray(defs) ? defs : []) {
    if (!d || typeof d !== 'object' || !okId(d.id)) continue;
    const x = fin(d.x, NaN), y = fin(d.y, NaN), w = fin(d.w, NaN), h = fin(d.h, NaN);
    if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) as.items.set(String(d.id), { id: String(d.id), x, y, w, h });
  }
  return as;
}
// A szakasz mentén a LEGKÖZELEBBI horgony -> {id,x,y (a közepe),t}|null.
export function hitAnchor(as, x, y, ex, ey, width = RANGER_CONFIG.ropeWidth) {
  if (!as || !as.items || ![x, y, ex, ey].every(Number.isFinite)) return null;
  let best = null, bt = Infinity;
  for (const a of as.items.values()) { const t = segmentHit(x, y, ex, ey, a, width); if (t >= 0 && t < bt) { bt = t; best = a; } }
  return best ? { id: best.id, x: best.x + best.w / 2, y: best.y + best.h / 2, t: bt } : null;
}

// ---- hatások ----
function defaultDamage(e, amount) { if (e && Number.isFinite(e.hp)) { e.hp = Math.max(0, e.hp - amount); return e.hp <= 0; } return false; }
export const isTracked = (w, e) => !!w && w.marks.has(e);

// env: {players, hiddens, anchors, enemies, damage(e,amount,info)->halott?, mark(e,secs), solid(x,y)->bool, cfg}
// -> {detach(), effects[] (track|mark|rope|shot naplója), stats{tracks,found,marked,ropes,snapped,shots,hits}, marks Map ref->{left,max}, ropes Map játékos->{id,x,y,left,max,leash}}
export function attachRanger(sys, env) {
  env = env && typeof env === 'object' ? env : {};
  if (sys && sys.hooks && typeof env.enemies === 'function' && typeof sys.hooks.enemies !== 'function') sys.hooks.enemies = env.enemies;
  const cfg = Object.freeze({ ...RANGER_CONFIG, ...(env.cfg && typeof env.cfg === 'object' ? env.cfg : {}) });
  const w = { env, cfg, effects: [], stats: { tracks: 0, found: 0, marked: 0, ropes: 0, snapped: 0, shots: 0, hits: 0 }, marks: new Map(), ropes: new Map(),
    detach() { for (const id of Object.values(RANGER_IDS)) setAbilityHandler(sys, id, null); } };
  const log = e => { w.effects.push(e); if (w.effects.length > cfg.maxEffects) w.effects.shift(); };
  const player = ev => (Array.isArray(env.players) ? env.players[ev.player] : null);
  const dmgFn = env.damage || ((e, a) => defaultDamage(e, a));
  w.dmgFn = dmgFn;
  const enemiesIn = (ev, rangePx) => { try { const f = env.enemies || (sys && sys.hooks && sys.hooks.enemies); const r = f ? f({ x: ev.x, y: ev.y }, rangePx, player(ev)) : []; return Array.isArray(r) ? r.filter(e => e && Number.isFinite(e.x) && Number.isFinite(e.y)) : []; } catch (e) { return []; } };
  const setMark = (e, secs) => { if (typeof env.mark === 'function') { try { env.mark(e, secs); } catch (x) { /* a hook hibája nem állítja meg */ } } else if (e && typeof e === 'object') e.tracked = secs; };

  setAbilityHandler(sys, 'track', ev => {
    const t = ev.target, secs = fin(ev.power, 0); if (!t || t.kind !== 'area' || !(secs > 0)) return false;
    const fresh = enemiesIn(ev, t.r + 1).filter(e => Math.hypot(e.x - t.x, e.y - t.y) <= t.r).filter(e => { const m = w.marks.get(e); return !m || m.left <= m.max * cfg.relightBelow; });
    const found = env.hiddens ? revealHidden(env.hiddens, t.x, t.y, t.r) : []; // csak akkor módosít, ha talál; ha semmi hatás: vétó
    if (!found.length && !fresh.length) return false; // semmi nyom, semmi új jelölés -> nincs költés
    for (const e of fresh) { w.marks.set(e, { left: secs, max: secs }); setMark(e, secs); w.stats.marked++; log({ type: 'mark', player: ev.player, ref: e, secs }); }
    w.stats.tracks++; w.stats.found += found.length; log({ type: 'track', player: ev.player, found: found.map(f => f.id), marked: fresh.length });
  });
  setAbilityHandler(sys, 'rope', ev => {
    const t = ev.target, secs = fin(ev.power, 0), len = fin(ev.range, 0) * fin(sys && sys.cfg && sys.cfg.tile, 32);
    if (!t || t.kind !== 'direction' || !env.anchors || !(secs > 0) || !(len > 0)) return false;
    const a = hitAnchor(env.anchors, t.x, t.y, t.ex, t.ey, cfg.ropeWidth); if (!a) return false;
    const cur = w.ropes.get(ev.player);
    if (cur && cur.id === a.id && cur.left > cur.max * cfg.relightBelow) return false; // ugyanaz a kötél még tart: nincs hatás
    w.ropes.set(ev.player, { id: a.id, x: a.x, y: a.y, left: secs, max: secs, leash: len * cfg.ropeSlack }); // egy játékosnak egy kötele van: az új a régit váltja
    w.stats.ropes++; log({ type: 'rope', player: ev.player, id: a.id });
  });
  setAbilityHandler(sys, 'shoot', ev => {
    const t = ev.target; if (!t || t.kind !== 'direction') return false;
    const len = Math.hypot(t.ex - t.x, t.ey - t.y), hw = cfg.shootWidth / 2;
    let best = null, ba = Infinity;
    for (const e of enemiesIn(ev, len + hw)) {
      const ax = e.x - t.x, ay = e.y - t.y, along = ax * t.dx + ay * t.dy, side = Math.abs(-ax * t.dy + ay * t.dx);
      if (along >= 0 && along <= len && side <= hw && along < ba) { best = e; ba = along; }
    }
    if (!best) return false;
    if (typeof env.solid === 'function') for (let s = cfg.shootStep; s < ba; s += cfg.shootStep) if (env.solid(t.x + t.dx * s, t.y + t.dy * s)) return false; // a fal megállítja
    const bonus = w.marks.has(best), amount = ev.power * (bonus ? 1 + cfg.markedBonus : 1), dead = !!dmgFn(best, amount, { player: ev.player, ability: 'shoot' });
    if (dead) w.marks.delete(best);
    w.stats.shots++; w.stats.hits++; log({ type: 'shot', player: ev.player, ref: best, amount, bonus, dead });
  });
  return w;
}

// A hatások idő-léptetése: jelölés lejár, kötél lejár / elszakad (a játékos > leash-nél a horgonytól). -> {unmarked:[ref], released:[player], snapped:[player]}
export function stepRanger(w, dt) {
  const out = { unmarked: [], released: [], snapped: [] };
  if (!w || !(dt > 0) || !Number.isFinite(dt)) return out;
  for (const [e, m] of [...w.marks]) {
    m.left -= dt;
    if (m.left > 0) { if (typeof w.env.mark !== 'function' && e && typeof e === 'object') e.tracked = m.left; continue; }
    w.marks.delete(e); out.unmarked.push(e); if (typeof w.env.mark !== 'function' && e && typeof e === 'object') e.tracked = 0;
  }
  for (const [i, r] of [...w.ropes]) {
    const p = Array.isArray(w.env.players) ? w.env.players[i] : null;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.hypot(p.x - r.x, p.y - r.y) > r.leash) { w.ropes.delete(i); w.stats.snapped++; out.snapped.push(i); continue; }
    r.left -= dt; if (r.left <= 0) { w.ropes.delete(i); out.released.push(i); }
  }
  return out;
}
// Él-e kötél az adott horgonyon? (az S130 átkelő / S150 mászás kérdezi)
export function ropeActive(w, anchorId) { if (!w || !w.ropes) return false; for (const r of w.ropes.values()) if (r.id === String(anchorId)) return true; return false; }
// Élő kötelek a rajzhoz/rejtvényhez -> [{player,id,ax,ay,px,py,left,max}] (hibás játékos-pozíció kimarad).
export function ropeLinks(w) {
  const out = []; if (!w || !Array.isArray(w.env.players)) return out;
  for (const [i, r] of w.ropes) { const p = w.env.players[i]; if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out.push({ player: i, id: r.id, ax: r.x, ay: r.y, px: p.x, py: p.y, left: r.left, max: r.max }); }
  return out;
}
