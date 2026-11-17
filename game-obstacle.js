// game-obstacle.js – tag-akadályok (S059; tiszta logika, DOM nélkül; importja: data-obstacles, game-wizard, game-warrior, game-inventory, game-nodes (bestTool), game-ability).
// Az akadály TAG-ekkel oldható fel (adat: data-obstacles.js): blocked (elzárt út: tömör, amíg fel nem oldják) és dark (sötét átjáró: fény/fáklya/sötétlátás nélkül zárt).
// Megoldás-utak a blocked akadályra (mind ugyanazt az akadályt oldja, a kaszt kényelem, nem kapu):
//   ÉGETÉS / TÖRÉS: az os.flammables / os.breakables tár a varázsló ignite / harcos wallbreak kezelőjének env-jébe adandó (attachWizard/attachWarrior), a stepObstacles szinkronizálja;
//   eszköz-TAG (pl. FEJSZE): tartott interakció-gomb az obstacleProvider célpontján (stepObstacles), a tool tier/speed a bestTool-ból;
//   bármi más (ROBBANTÁS...): solveByTag(os, tag, shape, power) / connectObstacles (képesség 'cast' esemény) – az S141 robbantása is ide köt.
// Dark: a stepObstacles minden kockában kiértékeli (fényforrás a ctx.lights-ból, FÁKLYA-tárgy a közelben, ctx.tagsOf extra tag-ek); bent álló játékosnál nem zár be.
import { OBSTACLE_DEFS, OBSTACLE_PLANNED_TAGS } from './data-obstacles.js';
import { createFlammables } from './game-wizard.js';
import { createBreakables, segmentHit } from './game-warrior.js';
import { hasTag } from './game-inventory.js';
import { bestTool } from './game-nodes.js';
import { onAbility } from './game-ability.js';

export const OBSTACLE_CONFIG = Object.freeze({
  action: 'clear', kinds: Object.freeze(['blocked', 'dark']),
  hp: 3, burn: 1.5,
  lightTag: 'FÉNY',
  torchReach: 96,   // px: az akadály széléhez ennyire közel lévő, megoldás-tag-gel (pl. FÁKLYA) bíró játékos kinyitja a sötét átjárót
  closeDelay: 0.6,  // mp: a fény/fáklya elmúlta után ennyi ideig marad nyitva (bent állva nem zár be)
  lineWidth: 24,    // px: a vonal-alakú képesség (direction) sávja a connectObstacles-ben
  lockFlash: 0.8,   // mp: a "jobb eszköz kell" jelzés (obstacleView.locked)
  prefilter: 96, maxObstacles: 256, maxSolves: 6, maxEvents: 64,
});
const ID_RE = /^[a-z][a-z0-9_]*$/, TAG_RE = /^[A-Z0-9_ÁÉÍÓÖŐÚÜŰ]+$/;
const STORE_TAGS = Object.freeze(['ÉGETÉS', 'TÖRÉS']); // ezeket a varázsló/harcos kezelője a tárakon át oldja (a connectObstacles kihagyja)
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ---- adat ----
// -> {ok, obstacle (fagyasztott, a horgonyhoz igazítva)|null, error}; sosem dob.
export function validateObstacleDef(def, cfg = OBSTACLE_CONFIG, anchor = null) {
  const bad = e => ({ ok: false, obstacle: null, error: e });
  if (!def || typeof def !== 'object') return bad('def');
  const id = def.id;
  if (typeof id !== 'string' || !ID_RE.test(id) || id.length > 48) return bad('id');
  if (!cfg.kinds.includes(def.kind)) return bad(id + ':kind');
  const ax = fin(anchor && anchor.x, 0), ay = fin(anchor && anchor.y, 0), x = fin(def.x, NaN), y = fin(def.y, NaN), w = fin(def.w, NaN), h = fin(def.h, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(w > 0) || !(h > 0) || w > 8192 || h > 8192) return bad(id + ':rect');
  if (!Array.isArray(def.solves) || def.solves.length < 1 || def.solves.length > cfg.maxSolves) return bad(id + ':solves');
  const solves = [];
  for (const tg of def.solves) { if (typeof tg !== 'string' || tg.length > 24 || !TAG_RE.test(tg)) return bad(id + ':tag'); if (!solves.includes(tg)) solves.push(tg); }
  const hp = def.hp === undefined ? cfg.hp : fin(def.hp, NaN), burn = def.burn === undefined ? cfg.burn : fin(def.burn, NaN);
  if (!(hp > 0) || hp > 999 || !(burn > 0) || burn > 600) return bad(id + ':hp');
  const tools = {};
  if (def.tools !== undefined) {
    if (!def.tools || typeof def.tools !== 'object' || Array.isArray(def.tools)) return bad(id + ':tools');
    for (const [tg, sp] of Object.entries(def.tools)) {
      if (!solves.includes(tg) || !sp || typeof sp !== 'object' || !Number.isInteger(sp.tier) || sp.tier < 0 || sp.tier > 9 || !(fin(sp.time, 0) > 0) || sp.time > 600) return bad(id + ':tools');
      tools[tg] = Object.freeze({ tier: sp.tier, time: sp.time });
    }
  }
  return { ok: true, error: null, obstacle: Object.freeze({ id, kind: def.kind, x: x + ax, y: y + ay, w, h, solves: Object.freeze(solves), hp, burn, tools: Object.freeze(tools) }) };
}
const rectOf = r => ({ x: r.x, y: r.y, w: r.w, h: r.h });
function distToRect(px, py, r) { return Math.hypot(Math.max(r.x - px, 0, px - (r.x + r.w)), Math.max(r.y - py, 0, py - (r.y + r.h))); }

// opts: {cfg, anchor {x,y}} -> os {cfg, items:Map id->rec, cleared:Set, errors[], dups[], version, events[], stats, flammables, breakables, sess[2], listeners}
export function createObstacleSystem(defs = OBSTACLE_DEFS, opts = {}) {
  const cfg = Object.freeze({ ...OBSTACLE_CONFIG, ...(opts.cfg && typeof opts.cfg === 'object' ? opts.cfg : {}) });
  const os = { cfg, items: new Map(), cleared: new Set(), errors: [], dups: [], version: 0, events: [], listeners: [], stats: { cleared: 0, hits: 0, locked: 0, opened: 0, closed: 0 },
    sess: [{ id: null, progress: 0, blocked: false, lock: 0 }, { id: null, progress: 0, blocked: false, lock: 0 }], flammables: null, breakables: null, _sv: '' };
  for (const d of (Array.isArray(defs) ? defs : []).slice(0, cfg.maxObstacles)) {
    const r = validateObstacleDef(d, cfg, opts.anchor);
    if (!r.ok) { os.errors.push(r.error); continue; }
    const o = r.obstacle;
    if (os.items.has(o.id)) os.dups.push(o.id);
    os.items.set(o.id, { ...o, max: o.hp, cleared: false, open: false, openLeft: 0, hasTools: Object.keys(o.tools).length > 0 });
  }
  const live = tag => [...os.items.values()].filter(o => o.kind === 'blocked' && o.solves.includes(tag));
  os.flammables = createFlammables(live('ÉGETÉS').map(o => ({ id: o.id, x: o.x, y: o.y, w: o.w, h: o.h, burn: o.burn })));
  os.breakables = createBreakables(live('TÖRÉS').map(o => ({ id: o.id, x: o.x, y: o.y, w: o.w, h: o.h, hp: o.hp })));
  return os;
}
export function onObstacle(os, fn) {
  if (!os || typeof fn !== 'function') return () => {};
  os.listeners.push(fn);
  return () => { const k = os.listeners.indexOf(fn); if (k >= 0) os.listeners.splice(k, 1); };
}
function emit(os, ev) {
  os.events.push(ev); if (os.events.length > os.cfg.maxEvents) os.events.shift();
  for (const fn of os.listeners.slice()) { try { fn(ev); } catch (e) { os.lastError = e; } }
}

// Az akadály feloldása (blocked): kikerül a tárakból és az ütközőkből; -> bool.
function clearObstacle(os, id, via, silent) {
  const r = os.items.get(id);
  if (!r || r.cleared || r.kind !== 'blocked') return false;
  r.cleared = true; os.cleared.add(id); os.version++; os.stats.cleared++;
  os.flammables.items.delete(id); os.breakables.walls.delete(id);
  if (!silent) emit(os, { type: 'cleared', id, via });
  return true;
}
// Ütköző-téglalapok a közös fal-listába: nem feloldott blocked + zárt dark ([{x,y,w,h}]); az os.version jelzi a változást.
export function obstacleColliders(os, out = []) {
  if (os && os.items) for (const r of os.items.values()) if (r.kind === 'blocked' ? !r.cleared : !r.open) out.push(rectOf(r));
  return out;
}
// Nyitott-e az akadály: blocked -> feloldva, dark -> épp nyitva.
export function obstacleOpen(os, id) { const r = os && os.items ? os.items.get(id) : null; return !!r && (r.kind === 'blocked' ? r.cleared : r.open); }

// ---- általános megoldás TAG-gel ----
// shape: {x,y,r} (kör: minden érintett akadály) | {x,y,ex,ey,width?} (szakasz: a LEGKÖZELEBBI). power: sebzés (alap: végtelen = azonnali feloldás). -> [{id,hp,max,cleared}]
export function solveByTag(os, tag, shape, power = Infinity) {
  const out = [];
  if (!os || !os.items || typeof tag !== 'string' || !shape || typeof shape !== 'object' || !(power > 0)) return out;
  const hits = [];
  for (const r of os.items.values()) {
    if (r.cleared || r.kind !== 'blocked' || !r.solves.includes(tag)) continue;
    if (Number.isFinite(shape.r)) { if (Number.isFinite(shape.x) && Number.isFinite(shape.y) && shape.r >= 0 && distToRect(shape.x, shape.y, r) <= shape.r) hits.push({ r, t: 0 }); continue; }
    if (![shape.x, shape.y, shape.ex, shape.ey].every(Number.isFinite)) continue;
    const t = segmentHit(shape.x, shape.y, shape.ex, shape.ey, r, fin(shape.width, os.cfg.lineWidth));
    if (t >= 0) hits.push({ r, t });
  }
  if (!Number.isFinite(shape.r)) hits.sort((a, b) => a.t - b.t).splice(1);
  for (const { r } of hits) {
    r.hp = Math.max(0, r.hp - power); os.stats.hits++;
    const done = r.hp <= 0 && clearObstacle(os, r.id, tag, false);
    out.push({ id: r.id, hp: r.hp, max: r.max, cleared: done });
  }
  return out;
}
// Képesség-esemény -> solveByTag (a ÉGETÉS/TÖRÉS tag-et a tárak oldják, a FÉNY a dark-ot nyitja: ezeket kihagyja). -> leiratkozó. players: a ROBBANTÁS-féle self-kör origója.
export function connectObstacles(os, sys) {
  return onAbility(sys, ev => {
    if (!ev || ev.type !== 'cast' || !ev.target || !Array.isArray(ev.tags)) return;
    const t = ev.target, tile = fin(sys && sys.cfg && sys.cfg.tile, 32), rng = fin(ev.range, 0) * tile;
    for (const tag of ev.tags) {
      if (STORE_TAGS.includes(tag) || tag === os.cfg.lightTag) continue;
      if (t.kind === 'direction') solveByTag(os, tag, { x: t.x, y: t.y, ex: t.ex, ey: t.ey }, ev.power);
      else if (t.kind === 'area') solveByTag(os, tag, { x: t.x, y: t.y, r: fin(t.r, rng) }, ev.power);
      else if (t.kind === 'self') solveByTag(os, tag, { x: ev.x, y: ev.y, r: rng }, ev.power);
    }
  });
}

// ---- léptetés ----
// ctx: {players, inventories, targets[2] (targetOf), inputs[2] (SZŰRT, .interact = tartott gomb), lights (tömb|fn -> [{x,y,r}]), tagsOf(i) -> extra tag-ek (pl. faj-tag; alap: p.tags)}
// -> a lépés eseményei (cleared {id,via} | locked {player,id,need,have} | opened {id,by} | closed {id}); a tár-szinkron (égés/törés) után a dark kapuk, majd az eszközös kivágás.
export function stepObstacles(os, dt, ctx = {}) {
  if (!os || !os.items) return [];
  os.events.length = 0;
  const step = fin(dt, 0) > 0 ? dt : 0, cfg = os.cfg, players = Array.isArray(ctx.players) ? ctx.players : [];
  const sv = os.flammables.version + '|' + os.breakables.version;
  if (sv !== os._sv) { os._sv = sv; for (const id of [...os.flammables.burnt]) clearObstacle(os, id, 'ÉGETÉS', false); for (const id of [...os.breakables.broken]) clearObstacle(os, id, 'TÖRÉS', false); }
  const lights = (() => { try { const l = typeof ctx.lights === 'function' ? ctx.lights() : ctx.lights; return Array.isArray(l) ? l.filter(s => s && [s.x, s.y, s.r].every(Number.isFinite)) : []; } catch (e) { return []; } })();
  const near = (r, i) => { const p = players[i]; return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? distToRect(p.x, p.y, r) : Infinity; };
  for (const r of os.items.values()) {
    if (r.kind !== 'dark') continue;
    let by = null;
    if (r.solves.includes(cfg.lightTag) && lights.some(l => distToRect(l.x, l.y, r) <= l.r)) by = cfg.lightTag;
    for (let i = 0; i < players.length && !by; i++) {
      if (near(r, i) > cfg.torchReach) continue;
      const inv = ctx.inventories && ctx.inventories[i];
      let extra = []; try { extra = typeof ctx.tagsOf === 'function' ? ctx.tagsOf(i) : players[i].tags; } catch (e) { extra = []; }
      extra = Array.isArray(extra) ? extra : [];
      for (const tg of r.solves) if (tg !== cfg.lightTag && ((inv && hasTag(inv, tg)) || extra.includes(tg))) { by = tg; break; }
    }
    if (by) { r.openLeft = cfg.closeDelay; if (!r.open) { r.open = true; os.version++; os.stats.opened++; emit(os, { type: 'opened', id: r.id, by }); } }
    else if (r.open) {
      r.openLeft = players.some((p, i) => near(r, i) <= 12) ? cfg.closeDelay : r.openLeft - step; // bent/mellette állva nem zár be
      if (r.openLeft <= 0) { r.open = false; r.openLeft = 0; os.version++; os.stats.closed++; emit(os, { type: 'closed', id: r.id }); }
    }
  }
  for (let i = 0; i < 2; i++) { // eszközös kivágás (tartott gomb az obstacleProvider célpontján)
    const s = os.sess[i], tg = ctx.targets && ctx.targets[i], inp = ctx.inputs && ctx.inputs[i];
    s.lock = Math.max(0, s.lock - step);
    const r = tg && tg.kind === 'obstacle' && tg.action === cfg.action && tg.ref ? os.items.get(tg.ref.id) : null;
    if (!(inp && inp.interact) || !r || r.cleared || !r.hasTools) { s.id = null; s.progress = 0; s.blocked = false; continue; }
    if (s.id !== r.id) { s.id = r.id; s.progress = 0; s.blocked = false; }
    const inv = ctx.inventories && ctx.inventories[i];
    let best = null, need = null, have = 0;
    for (const [tag, sp] of Object.entries(r.tools)) {
      const tool = bestTool(inv, tag);
      if (tool && tool.tier >= sp.tier) { const rate = tool.speed / sp.time; if (!best || rate > best.rate) best = { tag, rate }; }
      else { have = Math.max(have, tool ? tool.tier : 0); if (!need || sp.tier < need.tier) need = { tag, tier: sp.tier }; }
    }
    if (!best) { // nincs elég jó eszköz: zárt, egyszeri jelzés nyomásonként
      if (!s.blocked) { s.blocked = true; os.stats.locked++; emit(os, { type: 'locked', player: i, id: r.id, need, have }); }
      s.lock = cfg.lockFlash; s.progress = 0; continue;
    }
    s.blocked = false; s.lock = 0; s.progress += step * best.rate;
    if (s.progress >= 1) { clearObstacle(os, r.id, best.tag, false); s.id = null; s.progress = 0; }
  }
  return os.events.slice();
}

// A kivágás állapota a sávhoz (S190/S103 rajz): {id, ratio 0..1, locked}|null.
export function obstacleView(os, i) {
  const s = os && os.sess ? os.sess[i] : null;
  return s && s.id ? { id: s.id, ratio: Math.min(1, Math.max(0, s.progress)), locked: s.blocked || s.lock > 0 } : null;
}

// ---- interakció-forrás ----
// addProvider(interact, obstacleProvider(os)): a nem feloldott, eszközzel kivágható blocked akadályok 'clear' akcióval (kind 'obstacle', ref = az akadály).
export function obstacleProvider(os) {
  return function obstaclesNearZone(zone, out, cfg) {
    if (!os || !os.items) return out;
    const m = cfg && cfg.prefilter > 0 ? cfg.prefilter : OBSTACLE_CONFIG.prefilter;
    for (const r of os.items.values()) {
      if (r.cleared || r.kind !== 'blocked' || !r.hasTools) continue;
      if (r.x > zone.x + zone.w + m || r.x + r.w < zone.x - m || r.y > zone.y + zone.h + m || r.y + r.h < zone.y - m) continue;
      out.push({ key: 'obstacle:' + r.id, kind: 'obstacle', ref: r, action: OBSTACLE_CONFIG.action, rect: rectOf(r), ax: r.x + r.w / 2, ay: r.y });
    }
    return out;
  };
}
// Az akadály neve + a megoldás-lista szövege a UI-nak: tr = t(kulcs, params). -> {name, need}
export function describeObstacle(os, id, tr) {
  const r = os && os.items ? os.items.get(id) : null;
  if (!r || typeof tr !== 'function') return null;
  return { name: tr('obstacle.' + r.id), need: tr('obstacle.need', { tags: r.solves.map(tg => tr('obstacle.tag.' + tg)).join(', ') }) };
}

// ---- mentés (S050 bővíthető) ----
// {v:1, cleared:[id]} (a részleges sérülés és a dark nyitottsága nem mentett) / visszaállítás ATOMI és csendes (nincs esemény).
export function obstacleState(os) { return { v: 1, cleared: [...os.cleared] }; }
export function restoreObstacles(os, st) {
  if (!os || !os.items || !st || st.v !== 1 || !Array.isArray(st.cleared) || !st.cleared.every(id => typeof id === 'string')) return false;
  for (const id of st.cleared) clearObstacle(os, id, 'restore', true);
  return true;
}

// ---- audit (S065/S191/S192) ----
// src: {items: ITEM_DEFS, recipes: RECIPE_DEFS, abilities: ABILITY_DEFS, races: RACE_DEFS, classes: CLASS_DEFS} (nyers adat). -> ['id:few' | 'id:nosource:TAG' | 'id:noitem']
// few = kevesebb mint 2 megoldás; nosource = a TAG-nek nincs forrása (képesség/tárgy/eszköz/faj/kaszt; a planned tag-ek kihagyva); noitem = nincs kézzel craftolható tárgy-megoldás (a kaszt nem kapu).
export function auditObstacles(os, src, planned = OBSTACLE_PLANNED_TAGS) {
  const out = [], s = src || {}, arr = v => (Array.isArray(v) ? v : []);
  const itemTags = new Map(); // tag -> [item id]
  for (const it of arr(s.items)) for (const tg of [...arr(it && it.tags), ...(it && it.tool ? [it.tool.tag] : [])]) { if (!itemTags.has(tg)) itemTags.set(tg, []); itemTags.get(tg).push(it.id); }
  const other = new Set([...arr(s.abilities), ...arr(s.races), ...arr(s.classes)].flatMap(d => arr(d && d.tags)));
  const handCrafted = new Set(arr(s.recipes).filter(r => r && r.station === null && r.output).map(r => r.output.item));
  for (const r of os.items.values()) {
    if (r.solves.length < 2) out.push(r.id + ':few');
    for (const tg of r.solves) if (!itemTags.has(tg) && !other.has(tg) && !planned.includes(tg)) out.push(r.id + ':nosource:' + tg);
    if (!r.solves.some(tg => (itemTags.get(tg) || []).some(id => handCrafted.has(id)))) out.push(r.id + ':noitem');
  }
  return out;
}
