// game-ability.js – képesség-végrehajtó (S054; tiszta logika, DOM nélkül; importja: game-registry, game-inventory, game-stamina).
// A játékos 2 aktív képesség-gombja (ability1/ability2) a KASZT első két képességét használja (CLASS_DEFS[].abilities[0..1]; a kasztot p.class adja, vagy a sys.players[i].slots felülírja).
// Egy használat: slot -> képesség -> cooldown/GCD -> tárgy-feltétel -> erőforrás (mana | stamina | focus) -> cél-feloldás (none/self/ally/enemy/area/direction) -> (opcionális) kezelő -> költség + cooldown -> 'cast' esemény.
// ATOMI: bármelyik feltétel hibája esetén semmi nem változik (nincs költség, nincs cooldown), csak a 'fail' esemény. Minden függvény sosem dob.
// A HATÁST (sebzés, falbontás, fény...) nem ez a modul alkalmazza: az 'cast' esemény (onAbility) és a képességenkénti kezelő (setAbilityHandler) viszi (S055–S058, S066).
// Erőforrások: a stamina a meglévő p.stamina/p.exhausted (game-stamina; a regenerációját a stepStamina végzi); a mana/focus a p.mana/p.manaMax, p.focus/p.focusMax (ezt a modul regenerálja).
import { getAbility, getClass } from './game-registry.js';
import { ensureStamina } from './game-stamina.js';
import { hasItem } from './game-inventory.js';

export const ABILITY_CONFIG = Object.freeze({
  tile: 32,            // px / tile (a képesség range-e tile-ban van)
  defaultRange: 1.5,   // tile: range 0 esetén ennyi a hatótáv (ally/enemy/area/direction)
  gcd: 0.25,           // mp: bármely használat után ennyi ideig a játékos nem használ másik képességet
  maxEvents: 64,
  pools: Object.freeze({
    mana: Object.freeze({ max: 100, regen: 4, delay: 1.5 }),   // regen/mp; delay: költés után ennyi mp-ig nincs regeneráció
    focus: Object.freeze({ max: 100, regen: 10, delay: 0.5 }),
  }),
});
export const ABILITY_BUTTONS = Object.freeze(['ability1', 'ability2']);
const FAIL = Object.freeze(['player', 'empty', 'ability', 'busy', 'cooldown', 'item', 'exhausted', 'resource', 'target', 'blocked', 'error']);
export const ABILITY_FAIL_REASONS = FAIL;

const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clampN = (v, d, lo, hi) => Math.min(hi, Math.max(lo, fin(v, d)));

// Hibás mező -> alap, határokra szorítva.
export function sanitizeAbilityConfig(src) {
  const s = src && typeof src === 'object' ? src : {}, D = ABILITY_CONFIG;
  const pool = (k) => { const q = s.pools && typeof s.pools === 'object' && s.pools[k] && typeof s.pools[k] === 'object' ? s.pools[k] : {}, d = D.pools[k]; return Object.freeze({ max: clampN(q.max, d.max, 1, 1e6), regen: clampN(q.regen, d.regen, 0, 1e4), delay: clampN(q.delay, d.delay, 0, 60) }); };
  return Object.freeze({
    tile: clampN(s.tile, D.tile, 1, 1024), defaultRange: clampN(s.defaultRange, D.defaultRange, 0, 64), gcd: clampN(s.gcd, D.gcd, 0, 10),
    maxEvents: Math.round(clampN(s.maxEvents, D.maxEvents, 1, 1024)), pools: Object.freeze({ mana: pool('mana'), focus: pool('focus') }),
  });
}

// hooks: {enemies(origin{x,y}, rangePx, player) -> [{x,y,...}]} (az ellenfelek az S066-tól; alapból nincs). reg = createCharacterRegistry() eredménye.
export function createAbilitySystem({ reg = null, cfg, hooks } = {}) {
  const mk = () => ({ slots: null, cd: new Map(), gcd: 0, delay: { mana: 0, focus: 0 }, prev: [false, false] });
  return { reg, cfg: sanitizeAbilityConfig(cfg), hooks: hooks && typeof hooks === 'object' ? hooks : {}, players: [mk(), mk()], handlers: new Map(), listeners: [], events: [], stats: { casts: 0, fails: 0 }, lastError: null };
}

// ---- erőforrások ----
// Mana/focus mező hiányzik/hibás -> teli; a stamina a game-stamina szerint.
export function ensurePools(sys, p) {
  if (!p || typeof p !== 'object') return false;
  for (const k of ['mana', 'focus']) {
    const d = sys.cfg.pools[k];
    if (!(p[k + 'Max'] > 0) || !Number.isFinite(p[k + 'Max'])) p[k + 'Max'] = d.max;
    if (!Number.isFinite(p[k])) p[k] = p[k + 'Max'];
    p[k] = Math.min(p[k + 'Max'], Math.max(0, p[k]));
  }
  ensureStamina(p);
  return true;
}
export function poolValue(p, res) {
  if (!p || typeof p !== 'object') return { value: 0, max: 0, ratio: 0 };
  const key = res === 'stamina' ? 'stamina' : res, mx = fin(p[key + 'Max'], 0), v = fin(p[key], 0);
  return { value: v, max: mx, ratio: mx > 0 ? Math.min(1, Math.max(0, v / mx)) : 0 };
}

// ---- slotok ----
// A két gomb képesség-id-ja: felülírás (sys.players[i].slots) | a kaszt első két képessége | null.
export function slotAbilities(sys, i, p) {
  const st = sys && sys.players && sys.players[i];
  if (!st) return [null, null];
  const ids = Array.isArray(st.slots) ? st.slots : (() => { const c = p && typeof p.class === 'string' ? getClass(sys.reg, p.class) : null; return c && Array.isArray(c.abilities) ? c.abilities : []; })();
  return [0, 1].map(k => (typeof ids[k] === 'string' ? ids[k] : null));
}
export function setAbilitySlots(sys, i, slots) { const st = sys && sys.players && sys.players[i]; if (!st) return false; st.slots = Array.isArray(slots) ? slots.slice(0, 2) : null; return true; }

// Képességenkénti kezelő: fn(ev, ctx) -> false | {ok:false,reason?} (megvétózza: nincs költség) | bármi más = elfogadva. A hatást (pl. falbontás) a kezelő alkalmazza.
export function setAbilityHandler(sys, id, fn) { if (!sys || typeof id !== 'string') return false; if (typeof fn === 'function') sys.handlers.set(id, fn); else sys.handlers.delete(id); return true; }
export function onAbility(sys, fn) {
  if (!sys || typeof fn !== 'function') return () => {};
  sys.listeners.push(fn);
  return () => { const k = sys.listeners.indexOf(fn); if (k >= 0) sys.listeners.splice(k, 1); };
}
function emit(sys, ev) {
  sys.events.push(ev); if (sys.events.length > sys.cfg.maxEvents) sys.events.shift();
  for (const fn of sys.listeners.slice()) { try { fn(ev); } catch (e) { sys.lastError = e; } }
}
function fail(sys, i, slot, ability, reason) {
  sys.stats.fails++;
  const ev = { type: 'fail', player: i, slot, ability, reason };
  emit(sys, ev);
  return { ok: false, reason, event: ev };
}

// ---- cél-feloldás ----
const unit = (f) => { const x = fin(f && f.x, 0), y = fin(f && f.y, 0), l = Math.hypot(x, y); return l > 1e-9 ? { x: x / l, y: y / l } : { x: 0, y: 1 }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function listEnemies(sys, origin, rangePx, p) {
  try { const r = sys.hooks.enemies ? sys.hooks.enemies(origin, rangePx, p) : []; return Array.isArray(r) ? r.filter(e => e && Number.isFinite(e.x) && Number.isFinite(e.y) && dist(e, origin) <= rangePx) : []; } catch (e) { sys.lastError = e; return []; }
}
// -> cél-objektum | null (nincs érvényes cél). Az 'area' és 'direction' mindig feloldódik (lehet 0 találat).
export function resolveTarget(sys, def, players, i, facing) {
  const p = players[i], cfg = sys.cfg, rangePx = (def.range > 0 ? def.range : cfg.defaultRange) * cfg.tile;
  switch (def.target) {
    case 'none': return { kind: 'none' };
    case 'self': return { kind: 'self', player: i };
    case 'ally': { const q = players[1 - i]; return q && Number.isFinite(q.x) && Number.isFinite(q.y) && dist(q, p) <= rangePx ? { kind: 'ally', player: 1 - i, x: q.x, y: q.y } : null; }
    case 'enemy': {
      let best = null, bd = Infinity;
      for (const e of listEnemies(sys, p, rangePx, p)) { const d = dist(e, p); if (d < bd) { bd = d; best = e; } }
      return best ? { kind: 'enemy', ref: best, x: best.x, y: best.y, dist: bd } : null;
    }
    case 'area': return { kind: 'area', x: p.x, y: p.y, r: rangePx, hits: listEnemies(sys, p, rangePx, p) };
    case 'direction': { const d = unit(facing); return { kind: 'direction', x: p.x, y: p.y, dx: d.x, dy: d.y, range: rangePx, ex: p.x + d.x * rangePx, ey: p.y + d.y * rangePx }; }
    default: return null;
  }
}

// ---- használat ----
// Egy képesség használata id alapján (a slot csak az eseménybe kerül; -1 = nem gombról). ctx: {inventories?, facing?}. -> {ok, reason, event}
export function castAbility(sys, players, i, abilityId, ctx = {}, slot = -1) {
  try { return doCast(sys, players, i, abilityId, ctx || {}, slot); } catch (e) { if (sys) sys.lastError = e; return { ok: false, reason: 'error', event: null }; }
}
function doCast(sys, players, i, abilityId, ctx, slot) {
  const p = Array.isArray(players) ? players[i] : null, st = sys && sys.players ? sys.players[i] : null;
  if (!p || typeof p !== 'object' || !st) return fail(sys, i, slot, abilityId || null, 'player');
  if (typeof abilityId !== 'string') return fail(sys, i, slot, null, 'empty');
  const def = getAbility(sys.reg, abilityId);
  if (!def) return fail(sys, i, slot, abilityId, 'ability');
  if (st.gcd > 0) return fail(sys, i, slot, abilityId, 'busy');
  if ((st.cd.get(abilityId) || 0) > 0) return fail(sys, i, slot, abilityId, 'cooldown');
  if (def.item) { const inv = ctx.inventories && ctx.inventories[i]; let ok = false; try { ok = !!inv && hasItem(inv, def.item, 1); } catch (e) { ok = false; } if (!ok) return fail(sys, i, slot, abilityId, 'item'); }
  ensurePools(sys, p);
  const res = def.resource, cost = def.cost || 0;
  if (res === 'stamina' && p.exhausted && cost > 0) return fail(sys, i, slot, abilityId, 'exhausted');
  if (res && cost > 0 && poolValue(p, res).value < cost) return fail(sys, i, slot, abilityId, 'resource');
  const target = resolveTarget(sys, def, players, i, ctx.facing);
  if (!target) return fail(sys, i, slot, abilityId, 'target');
  const ev = { type: 'cast', player: i, slot, ability: abilityId, resource: res || null, cost, cooldown: def.cooldown || 0, target, power: def.power || 0, tags: def.tags || [], range: def.range || 0, x: p.x, y: p.y };
  const h = sys.handlers.get(abilityId);
  if (h) {
    let r;
    try { r = h(ev, ctx); } catch (e) { sys.lastError = e; return fail(sys, i, slot, abilityId, 'error'); }
    if (r === false || (r && typeof r === 'object' && r.ok === false)) return fail(sys, i, slot, abilityId, 'blocked');
  }
  // költség + cooldown (a kezelő elfogadta)
  if (res && cost > 0) {
    const key = res === 'stamina' ? 'stamina' : res;
    p[key] = Math.max(0, p[key] - cost);
    if (res === 'stamina') { if (p.stamina <= 0) p.exhausted = true; } else st.delay[res] = sys.cfg.pools[res].delay;
  }
  if (ev.cooldown > 0) st.cd.set(abilityId, ev.cooldown);
  st.gcd = sys.cfg.gcd;
  sys.stats.casts++;
  emit(sys, ev);
  return { ok: true, reason: null, event: ev };
}

// A gomb (0|1) használata: a slot képessége. -> {ok, reason, event}
export function castSlot(sys, players, i, slot, ctx = {}) {
  const ids = slotAbilities(sys, i, Array.isArray(players) ? players[i] : null);
  return castAbility(sys, players, i, ids[slot] === undefined ? null : ids[slot], ctx, slot);
}

// Egy logikai lépés: cooldown/GCD lefutása, mana/focus regeneráció, gomb-élek -> használat.
// inputs[i] = {ability1, ability2, ability1Pressed?, ability2Pressed?} (a SZŰRT bemenet: nyitott menünél hamis); facings[i] = {x,y}. -> a lépés eseményei.
export function stepAbilities(sys, players, inputs, facings, dt, ctx = {}) {
  const out = [];
  if (!sys || !Array.isArray(players)) return out;
  const n0 = sys.events.length, d = dt > 0 && Number.isFinite(dt) ? dt : 0;
  let total = sys.stats.casts + sys.stats.fails;
  for (let i = 0; i < 2; i++) {
    const p = players[i], st = sys.players[i];
    if (!p || typeof p !== 'object') continue;
    ensurePools(sys, p);
    if (d > 0) {
      st.gcd = Math.max(0, st.gcd - d);
      for (const [id, v] of st.cd) { const r = v - d; if (r > 0) st.cd.set(id, r); else st.cd.delete(id); }
      for (const k of ['mana', 'focus']) {
        const wait = st.delay[k], eff = d - Math.min(wait, d); // csak a késleltetés utáni rész regenerál
        st.delay[k] = Math.max(0, wait - d);
        if (eff > 0 && p[k] < p[k + 'Max']) p[k] = Math.min(p[k + 'Max'], p[k] + sys.cfg.pools[k].regen * eff);
      }
    }
    const inp = inputs && inputs[i] ? inputs[i] : {};
    ABILITY_BUTTONS.forEach((b, slot) => {
      const held = !!inp[b], pressed = !!inp[b + 'Pressed'] || (held && !st.prev[slot]);
      st.prev[slot] = held;
      if (pressed) castSlot(sys, players, i, slot, { ...ctx, facing: facings ? facings[i] : undefined });
    });
  }
  const made = sys.stats.casts + sys.stats.fails - total;
  if (made > 0) out.push(...sys.events.slice(-Math.min(made, sys.events.length)));
  return out;
}

// A HUD/UI-nak (S074): {slots:[{slot,id,nameKey,resource,cost,remaining,ratio,ready,affordable}], pools:{mana,focus,stamina:{value,max,ratio}}}
export function abilityView(sys, players, i) {
  const p = Array.isArray(players) ? players[i] : null, st = sys && sys.players ? sys.players[i] : null;
  if (!p || !st) return { slots: [], pools: {} };
  ensurePools(sys, p);
  const slots = slotAbilities(sys, i, p).map((id, slot) => {
    const def = id ? getAbility(sys.reg, id) : null;
    if (!def) return { slot, id: null, nameKey: null, resource: null, cost: 0, remaining: 0, ratio: 0, ready: false, affordable: false };
    const rem = st.cd.get(id) || 0, cd = def.cooldown || 0, res = def.resource, cost = def.cost || 0;
    const affordable = !res || cost <= 0 || (poolValue(p, res).value >= cost && !(res === 'stamina' && p.exhausted));
    return { slot, id, nameKey: def.nameKey, resource: res || null, cost, remaining: rem, ratio: cd > 0 ? Math.min(1, rem / cd) : 0, ready: rem <= 0 && st.gcd <= 0 && affordable, affordable };
  });
  return { slots, pools: { mana: poolValue(p, 'mana'), focus: poolValue(p, 'focus'), stamina: poolValue(p, 'stamina') } };
}
