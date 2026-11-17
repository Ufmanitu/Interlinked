// game-combo.js – kétjátékos kombó-képességek (S061; tiszta logika, DOM nélkül; importja: game-ability, data-combos).
// A képesség 'cast' eseménye a TAG-jei szerint ELEM-lenyomatot hagy a cél helyén (COMBO_ELEMENTS). Reakciók (COMBO_DEFS):
//   pair: a másik JÁTÉKOS komplementer elemű lenyomata window mp-en és range tile-on belül -> reakció (mindkét lenyomat elfogy);
//   surface: az elem olyan felszínen (env.surface) sül el, amelynek közelében (partnerRange) a TÁRS is áll -> reakció.
// Hatás: blast (sebzés + égés + éghető akadályok meggyújtása a körben) | patch (felszín-folt, pl. jég + fagyott ellenfelek). Reakciónként cooldown.
// A kombó a képesség HATÁSA UTÁN fut (az eredeti hatás érintetlen); sosem dob, hibás hook/bemenet = nincs hatás. A mana/focus költség a képességé.
// env: {players, enemies(origin,rangePx,p)->[{x,y}], flammables (createFlammables), surface(x,y)->'water'|null, damage(e,amount,info)->halott?,
//       burn(e,dps,secs,player), freeze(e,secs), push(e,dx,dy,dist)->px, wizard (attachWizard eredménye: az égés/fagy ott fut), cfg}
import { onAbility, setAbilityHandler } from './game-ability.js';
import { COMBO_DEFS, COMBO_ELEMENTS, COMBO_SURFACES, COMBO_PATCHES } from './data-combos.js';

export const COMBO_CONFIG = Object.freeze({
  tile: 32, maxImprints: 16, maxEvents: 64, maxPatches: 32,
  gustWidth: 32,        // px: a szélroham sávja (ellenfél-tolás)
  gustMaxTargets: 6,
  handlers: Object.freeze(['gust']),   // a kombó-modul által kezelt (szél) képességek
});
export const COMBO_LIMITS = Object.freeze({ window: [0.2, 15], range: [0.5, 32], partnerRange: [0, 32], cooldown: [0, 120], radius: [0.5, 16], damage: [0, 1000], dps: [0, 100], secs: [0, 300] });
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const inR = (v, [lo, hi]) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const ID_RE = /^[a-z][a-z0-9_]*$/;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ELEMENTS = Object.freeze([...new Set(Object.values(COMBO_ELEMENTS))]);

// Tag-lista -> elemek (duplikátum nélkül).
export function elementsOfTags(tags) {
  const out = []; if (!Array.isArray(tags)) return out;
  for (const t of tags) { const e = Object.hasOwn(COMBO_ELEMENTS, t) ? COMBO_ELEMENTS[t] : null; if (e && !out.includes(e)) out.push(e); }
  return out;
}

// ---- validáció ----
export function validateComboDef(def) {
  const bad = (error) => ({ ok: false, combo: null, error });
  if (!def || typeof def !== 'object') return bad('def');
  if (typeof def.id !== 'string' || def.id.length > 32 || !ID_RE.test(def.id)) return bad('id');
  const L = COMBO_LIMITS, cooldown = def.cooldown === undefined ? 5 : def.cooldown;
  if (!inR(cooldown, L.cooldown)) return bad('cooldown');
  let c;
  if (def.kind === 'pair') {
    const w = def.window === undefined ? 3 : def.window, r = def.range === undefined ? 5 : def.range, el = def.elements;
    if (!Array.isArray(el) || el.length !== 2 || el[0] === el[1] || !el.every(e => ELEMENTS.includes(e))) return bad('elements');
    if (!inR(w, L.window)) return bad('window'); if (!inR(r, L.range)) return bad('range');
    c = { id: def.id, kind: 'pair', elements: Object.freeze([...el]), window: w, range: r, cooldown };
  } else if (def.kind === 'surface') {
    const pr = def.partnerRange === undefined ? 0 : def.partnerRange;
    if (!ELEMENTS.includes(def.element)) return bad('element'); if (!COMBO_SURFACES.includes(def.surface)) return bad('surface');
    if (!inR(pr, L.partnerRange)) return bad('partnerRange');
    c = { id: def.id, kind: 'surface', element: def.element, surface: def.surface, partnerRange: pr, window: 0, cooldown };
  } else return bad('kind');
  const ef = def.effect; if (!ef || typeof ef !== 'object') return bad('effect');
  if (!inR(ef.radius, L.radius)) return bad('radius');
  if (ef.kind === 'blast') {
    const dmg = ef.damage === undefined ? 0 : ef.damage, b = ef.burn === undefined ? { dps: 0, secs: 0 } : ef.burn;
    if (!inR(dmg, L.damage) || !b || typeof b !== 'object' || !inR(b.dps, L.dps) || !inR(b.secs, L.secs)) return bad('blast');
    const at = ef.at === undefined ? (c.kind === 'pair' ? c.elements[0] : c.element) : ef.at;
    if (c.kind === 'pair' ? !c.elements.includes(at) : at !== c.element) return bad('at');
    c.effect = Object.freeze({ kind: 'blast', at, radius: ef.radius, damage: dmg, burn: Object.freeze({ dps: b.dps, secs: b.secs }), ignite: !!ef.ignite });
  } else if (ef.kind === 'patch') {
    const fz = ef.freeze === undefined ? 0 : ef.freeze;
    if (!COMBO_PATCHES.includes(ef.surface) || !inR(ef.secs, L.secs) || !(ef.secs > 0) || !inR(fz, L.secs)) return bad('patch');
    c.effect = Object.freeze({ kind: 'patch', surface: ef.surface, radius: ef.radius, secs: ef.secs, freeze: fz });
  } else return bad('effect');
  return { ok: true, combo: Object.freeze(c), error: null };
}
// -> {reactions:Map id->combo, errors:['id:ok-hiba'], dups:[id]} (hibás kiesik, duplikátum felülír)
export function createComboRegistry(defs = COMBO_DEFS) {
  const reg = { reactions: new Map(), errors: [], dups: [] };
  for (const d of Array.isArray(defs) ? defs : []) {
    const r = validateComboDef(d);
    if (!r.ok) { reg.errors.push(`${d && typeof d === 'object' ? d.id : '?'}:${r.error}`); continue; }
    if (reg.reactions.has(r.combo.id)) reg.dups.push(r.combo.id);
    reg.reactions.set(r.combo.id, r.combo);
  }
  return reg;
}
// Hivatkozás-audit: minden elemnek legyen forrás-képessége (TAG), a reakciónak két oldala. abilities: Map|tömb ({tags}). -> ['id:nosource:elem']
export function auditCombos(reg, abilities) {
  const list = abilities instanceof Map ? [...abilities.values()] : Array.isArray(abilities) ? abilities : [];
  const have = new Set(); for (const a of list) for (const e of elementsOfTags(a && a.tags)) have.add(e);
  const out = [];
  for (const c of reg && reg.reactions ? reg.reactions.values() : []) {
    for (const e of c.kind === 'pair' ? c.elements : [c.element]) if (!have.has(e)) out.push(`${c.id}:nosource:${e}`);
  }
  return out;
}
// Éghető akadályok meggyújtása körben (game-wizard createFlammables szerkezete: items Map, lit, left, burn). -> meggyújtott id-k
export function igniteFlammablesIn(fs, x, y, r) {
  const out = []; if (!fs || !fs.items || ![x, y, r].every(Number.isFinite)) return out;
  for (const f of fs.items.values()) {
    if (f.lit) continue;
    const dx = Math.max(f.x - x, 0, x - (f.x + f.w)), dy = Math.max(f.y - y, 0, y - (f.y + f.h));
    if (Math.hypot(dx, dy) <= r) { f.lit = true; f.left = f.burn; out.push(f.id); }
  }
  return out;
}

// ---- rendszer ----
export function attachCombo(sys, env) {
  env = env && typeof env === 'object' ? env : {};
  const cfg = Object.freeze({ ...COMBO_CONFIG, ...(env.cfg && typeof env.cfg === 'object' ? env.cfg : {}) });
  const registry = env.registry && env.registry.reactions ? env.registry : createComboRegistry(env.defs || COMBO_DEFS);
  const c = { sys, env, cfg, reactions: registry.reactions, errors: registry.errors, time: 0, imprints: [], patches: [], cool: new Map(), burning: new Map(), frozen: new Map(),
    events: [], listeners: [], stats: { imprints: 0, reactions: 0, blocked: 0, gusts: 0 }, lastError: null, detach: null };
  c.maxWindow = Math.max(0, ...[...c.reactions.values()].map(r => r.window));
  const unsub = onAbility(sys, ev => { try { handleCast(c, ev); } catch (e) { c.lastError = e; } });
  for (const id of cfg.handlers) setAbilityHandler(sys, id, ev => { try { return gustHandler(c, ev); } catch (e) { c.lastError = e; return false; } });
  c.detach = () => { unsub(); for (const id of cfg.handlers) setAbilityHandler(sys, id, null); };
  return c;
}
export function onCombo(c, fn) {
  if (!c || typeof fn !== 'function') return () => {};
  c.listeners.push(fn);
  return () => { const k = c.listeners.indexOf(fn); if (k >= 0) c.listeners.splice(k, 1); };
}
const player = (c, i) => { const p = Array.isArray(c.env.players) ? c.env.players[i] : null; return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null; };
// A cast esemény célpontja, a lenyomat helye: irány -> a vég; ellenfél/társ -> a cél; egyéb -> a használó.
function focusOf(ev) {
  const t = ev.target;
  if (t && t.kind === 'direction' && Number.isFinite(t.ex) && Number.isFinite(t.ey)) return { x: t.ex, y: t.ey };
  if (t && (t.kind === 'enemy' || t.kind === 'ally') && Number.isFinite(t.x) && Number.isFinite(t.y)) return { x: t.x, y: t.y };
  return { x: fin(ev.x, 0), y: fin(ev.y, 0) };
}
function enemiesIn(c, origin, r, p) {
  try { const f = c.env.enemies || (c.sys.hooks && c.sys.hooks.enemies); const o = f ? f(origin, r, p) : []; return Array.isArray(o) ? o.filter(e => e && Number.isFinite(e.x) && Number.isFinite(e.y) && dist(e, origin) <= r) : []; } catch (e) { return []; }
}
function dealDamage(c, e, amount, info) {
  if (!(amount > 0)) return false;
  try { if (typeof c.env.damage === 'function') return !!c.env.damage(e, amount, info); } catch (x) { return false; }
  if (Number.isFinite(e.hp)) { e.hp = Math.max(0, e.hp - amount); return e.hp <= 0; }
  return false;
}
function applyBurn(c, e, dps, secs, who) {
  if (!(dps > 0) || !(secs > 0)) return;
  if (typeof c.env.burn === 'function') { try { c.env.burn(e, dps, secs, who); } catch (x) { /* a hook hibája nem állít meg */ } return; }
  const w = c.env.wizard; if (w && w.burning instanceof Map) { w.frozen && w.frozen.delete(e); w.burning.set(e, { left: secs, dps, player: who }); return; }
  c.frozen.delete(e); c.burning.set(e, { left: secs, dps, player: who });
}
function applyFreeze(c, e, secs) {
  if (!(secs > 0)) return false;
  if (typeof c.env.freeze === 'function') { try { c.env.freeze(e, secs); } catch (x) { /* nincs hatás */ } return true; }
  const store = c.env.wizard && c.env.wizard.frozen instanceof Map ? c.env.wizard.frozen : c.frozen; // a már fagyott ellenfél fagya meghosszabbodik (nem rövidül)
  const cur = store.get(e);
  if (cur) { if (cur.left < secs) { cur.left = secs; e.frozen = secs; } return true; }
  store.set(e, { left: secs }); (c.env.wizard && c.env.wizard.burning ? c.env.wizard.burning : c.burning).delete(e); e.frozen = secs; return true;
}

// ---- reakciók ----
function emit(c, ev) { c.events.push(ev); if (c.events.length > c.cfg.maxEvents) c.events.shift(); for (const fn of c.listeners.slice()) { try { fn(ev); } catch (e) { c.lastError = e; } } }
function trigger(c, r, players, at) {
  const ef = r.effect, tile = c.cfg.tile, R = ef.radius * tile, res = { hits: 0, killed: 0, burned: 0, frozen: 0, ignited: [], patch: null };
  const owner = players[0], info = { combo: r.id, players: players.slice(), player: owner };
  if (ef.kind === 'blast') {
    for (const e of enemiesIn(c, at, R, player(c, owner))) {
      res.hits++;
      if (dealDamage(c, e, ef.damage, info)) { res.killed++; continue; }
      if (ef.burn.dps > 0 && ef.burn.secs > 0) { applyBurn(c, e, ef.burn.dps, ef.burn.secs, owner); res.burned++; }
    }
    if (ef.ignite && c.env.flammables) res.ignited = igniteFlammablesIn(c.env.flammables, at.x, at.y, R);
  } else {
    for (const e of enemiesIn(c, at, R, player(c, owner))) { res.hits++; if (applyFreeze(c, e, ef.freeze)) res.frozen++; }
    const patch = { id: r.id, surface: ef.surface, x: at.x, y: at.y, r: R, left: ef.secs, max: ef.secs };
    c.patches.push(patch); if (c.patches.length > c.cfg.maxPatches) c.patches.shift(); res.patch = patch;
  }
  c.cool.set(r.id, r.cooldown); c.stats.reactions++;
  emit(c, { type: 'combo', id: r.id, players: players.slice(), x: at.x, y: at.y, t: c.time, result: res });
  return res;
}
function handleCast(c, ev) {
  if (!ev || ev.type !== 'cast' || (ev.player !== 0 && ev.player !== 1)) return;
  const elems = elementsOfTags(ev.tags); if (!elems.length) return;
  const focus = focusOf(ev), tile = c.cfg.tile;
  let fired = false;
  for (const el of elems) {
    for (const r of c.reactions.values()) {
      if ((c.cool.get(r.id) || 0) > 0) continue;
      if (r.kind === 'pair' && r.elements.includes(el)) {
        const other = r.elements[0] === el ? r.elements[1] : r.elements[0];
        let best = -1;
        for (let k = c.imprints.length - 1; k >= 0; k--) {
          const im = c.imprints[k];
          if (im.player !== ev.player && im.element === other && c.time - im.t <= r.window + 1e-9 && dist(im, focus) <= r.range * tile) { best = k; break; }
        }
        if (best < 0) continue;
        const im = c.imprints[best]; c.imprints.splice(best, 1);
        const at = r.effect.at === el ? focus : { x: im.x, y: im.y };
        trigger(c, r, r.effect.at === el ? [ev.player, im.player] : [im.player, ev.player], at); fired = true;
      } else if (r.kind === 'surface' && r.element === el) {
        let surf = null; try { surf = typeof c.env.surface === 'function' ? c.env.surface(focus.x, focus.y) : null; } catch (e) { surf = null; }
        if (surf !== r.surface) continue;
        const mate = player(c, 1 - ev.player);
        if (!mate || (r.partnerRange > 0 && dist(mate, focus) > r.partnerRange * tile)) { c.stats.blocked++; continue; }
        trigger(c, r, [ev.player, 1 - ev.player], focus); fired = true;
      }
    }
    if (fired) break;
  }
  if (fired) return;
  for (const el of elems) { // nincs reakció: lenyomat (azonos játékos + elem frissül)
    c.imprints = c.imprints.filter(im => !(im.player === ev.player && im.element === el));
    c.imprints.push({ player: ev.player, element: el, x: focus.x, y: focus.y, t: c.time, ability: ev.ability });
    if (c.imprints.length > c.cfg.maxImprints) c.imprints.shift();
    c.stats.imprints++;
  }
}
// Szélroham (gust): eltolja az ellenfeleket a sávban; HATÁS NÉLKÜL (nincs ellenfél, és nincs társ-láng, amit fújhatna) vétó -> nincs költés/cooldown.
function gustHandler(c, ev) {
  const t = ev.target; if (!t || t.kind !== 'direction') return false;
  const len = Math.hypot(t.ex - t.x, t.ey - t.y), hw = c.cfg.gustWidth / 2, hits = [];
  for (const e of enemiesIn(c, { x: t.x, y: t.y }, len + hw, player(c, ev.player))) {
    const ax = e.x - t.x, ay = e.y - t.y, along = ax * t.dx + ay * t.dy, side = Math.abs(-ax * t.dy + ay * t.dx);
    if (along >= 0 && along <= len && side <= hw) hits.push({ e, along });
  }
  hits.sort((a, b) => a.along - b.along);
  const used = hits.slice(0, c.cfg.gustMaxTargets);
  const focus = { x: t.ex, y: t.ey }, elems = elementsOfTags(ev.tags);
  const feeds = [...c.reactions.values()].some(r => r.kind === 'pair' && (c.cool.get(r.id) || 0) <= 0 && elems.some(el => r.elements.includes(el)) && c.imprints.some(im => {
    const other = r.elements[0] === im.element ? r.elements[1] : r.elements[0];
    return im.player !== ev.player && r.elements.includes(im.element) && elems.includes(other) && c.time - im.t <= r.window + 1e-9 && dist(im, focus) <= r.range * c.cfg.tile;
  }));
  if (!used.length && !feeds) return false;
  const dist0 = fin(ev.power, 0);
  for (const { e } of used) {
    try { if (typeof c.env.push === 'function') c.env.push(e, t.dx, t.dy, dist0); else if (dist0 > 0) { e.x += t.dx * dist0; e.y += t.dy * dist0; } } catch (x) { /* nincs hatás */ }
  }
  c.stats.gusts++;
  return undefined;
}

// Idő-léptetés: lenyomatok lejárata, foltok, cooldownok, saját égés/fagy (ha nincs hook/wizard). -> {expired:[lenyomat], patches:[folt], dead:[ref], thawed:[ref]}
export function stepCombo(c, dt) {
  const out = { expired: [], patches: [], dead: [], thawed: [] };
  if (!c || !(dt > 0) || !Number.isFinite(dt)) return out;
  c.time += dt;
  const keep = []; for (const im of c.imprints) (c.time - im.t > c.maxWindow + 1e-9 ? out.expired : keep).push(im); c.imprints = keep;
  for (const [id, v] of [...c.cool]) { if (v - dt > 0) c.cool.set(id, v - dt); else c.cool.delete(id); }
  c.patches = c.patches.filter(p => { p.left -= dt; if (p.left > 0) return true; out.patches.push(p); return false; });
  for (const [e, b] of [...c.burning]) {
    const part = Math.min(dt, b.left); b.left -= dt;
    if (part > 0 && dealDamage(c, e, b.dps * part, { combo: 'burn', player: b.player })) { out.dead.push(e); c.burning.delete(e); c.frozen.delete(e); continue; }
    if (b.left <= 0) c.burning.delete(e);
  }
  for (const [e, f] of [...c.frozen]) { f.left -= dt; if (e && 'frozen' in e) e.frozen = Math.max(0, f.left); if (f.left <= 0) { c.frozen.delete(e); out.thawed.push(e); } }
  return out;
}
// Felszín-folt a ponton (pl. 'ice': az S130 átkelők járhatónak veszik) -> bool
export function patchAt(c, x, y, surface = 'ice') {
  if (!c || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  return c.patches.some(p => p.surface === surface && p.left > 0 && Math.hypot(p.x - x, p.y - y) <= p.r);
}
export const iceAt = (c, x, y) => patchAt(c, x, y, 'ice');
// A HUD/UI-nak (S074): függő lenyomatok + foltok + reakció-cooldownok.
export function comboView(c) {
  if (!c) return { imprints: [], patches: [], cooldowns: {} };
  const cooldowns = {}; for (const [id, v] of c.cool) cooldowns[id] = v;
  return { imprints: c.imprints.map(im => ({ player: im.player, element: im.element, x: im.x, y: im.y, left: Math.max(0, c.maxWindow - (c.time - im.t)) })), patches: c.patches.map(p => ({ ...p })), cooldowns };
}
