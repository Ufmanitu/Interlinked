// game-crafting.js – crafting logika (S040; tiszta logika, DOM nélkül; importja: data-items, data-recipes, game-inventory).
// ctx (opcionális): {stations: tömb|Set|függvény(tag)->bool (a közelben álló állomások TAG-jei), skills: objektum|függvény(id)->szint}; alap: nincs állomás, minden skill 0.
// A craft ATOMI: ha bármi hiányzik vagy a kimenet nem fér el, az inventory érintetlen. Az S041 köti az állomásokat, az S045 a skill-szintet és az XP-t.
import { createItemRegistry, getItemDef } from './data-items.js';
import { RECIPE_DEFS } from './data-recipes.js';
import { countItem, removeItem, addItem, inventoryState, restoreInventory } from './game-inventory.js';

export const CRAFT_LIMITS = { maxInputs: 6, maxCount: 999, maxSkillLevel: 60, maxBatch: 99 };
const ID_RE = /^[a-z][a-z0-9_]*$/;
const TAG_RE = /^[A-Z0-9_ÁÉÍÓÖŐÚÜŰ]+$/;
const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

// Egy recept ellenőrzése -> {ok, recipe (fagyasztott)|null, error}; sosem dob. A tárgy-hivatkozásokat az itemReg-gel veti össze.
export function validateRecipeDef(def, itemReg) {
  const L = CRAFT_LIMITS, bad = e => ({ ok: false, recipe: null, error: e });
  if (!def || typeof def !== 'object') return bad('def');
  const id = def.id;
  if (typeof id !== 'string' || !ID_RE.test(id) || id.length > 48) return bad('id');
  if (!Array.isArray(def.inputs) || def.inputs.length < 1 || def.inputs.length > L.maxInputs) return bad(id + ':inputs');
  const inputs = [], seen = new Set();
  for (const e of def.inputs) {
    if (!e || typeof e !== 'object' || typeof e.item !== 'string' || !isInt(e.n, 1, L.maxCount)) return bad(id + ':input');
    if (seen.has(e.item)) return bad(id + ':dup');
    if (!getItemDef(itemReg, e.item)) return bad(id + ':item:' + e.item);
    seen.add(e.item); inputs.push(Object.freeze({ item: e.item, n: e.n }));
  }
  const o = def.output;
  if (!o || typeof o !== 'object' || typeof o.item !== 'string' || !isInt(o.n, 1, L.maxCount)) return bad(id + ':output');
  if (!getItemDef(itemReg, o.item)) return bad(id + ':item:' + o.item);
  let station = null;
  if (def.station !== undefined && def.station !== null) {
    if (typeof def.station !== 'string' || def.station.length > 24 || !TAG_RE.test(def.station)) return bad(id + ':station');
    station = def.station;
  }
  let skill = null;
  if (def.skill !== undefined && def.skill !== null) {
    const s = def.skill;
    if (typeof s !== 'object' || typeof s.skill !== 'string' || !ID_RE.test(s.skill) || s.skill.length > 32 || !isInt(s.level, 0, L.maxSkillLevel)) return bad(id + ':skill');
    skill = Object.freeze({ skill: s.skill, level: s.level });
  }
  const recipe = Object.freeze({ id, inputs: Object.freeze(inputs), output: Object.freeze({ item: o.item, n: o.n }), station, skill, nameKey: getItemDef(itemReg, o.item).nameKey });
  return { ok: true, recipe, error: null };
}

// Nyilvántartás: hibás recept kiesik (errors), duplikált id felülír (dups). A recept neve = a kimeneti tárgy nameKey-e.
export function createRecipeRegistry(defs = RECIPE_DEFS, itemReg) {
  const items = itemReg && itemReg.items ? itemReg : createItemRegistry();
  const reg = { items, recipes: new Map(), errors: [], dups: new Set() };
  for (const d of (Array.isArray(defs) ? defs : []).slice(0, 2048)) {
    const r = validateRecipeDef(d, items);
    if (!r.ok) { reg.errors.push(r.error); continue; }
    if (reg.recipes.has(r.recipe.id)) reg.dups.add(r.recipe.id);
    reg.recipes.set(r.recipe.id, r.recipe);
  }
  return reg;
}
export function getRecipe(reg, id) { return reg && reg.recipes && typeof id === 'string' ? (reg.recipes.get(id) || null) : null; }

// Hiányzó tárgy-hivatkozások egy (másik) tárgy-nyilvántartásban: ['recept:tárgy'] (a tests.html jelezze).
export function auditRecipes(reg, itemReg) {
  const out = [];
  if (!reg || !reg.recipes) return out;
  for (const r of reg.recipes.values()) {
    for (const e of r.inputs) if (!getItemDef(itemReg, e.item)) out.push(r.id + ':' + e.item);
    if (!getItemDef(itemReg, r.output.item)) out.push(r.id + ':' + r.output.item);
  }
  return out;
}

// Receptek egy állomáson: station null/undefined -> a kézzel craftolhatók; TAG -> az adott állomáséi. Id szerint rendezve.
export function recipesAt(reg, station = null) {
  if (!reg || !reg.recipes) return [];
  const st = station === undefined ? null : station;
  return [...reg.recipes.values()].filter(r => r.station === st).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function hasStation(ctx, tag) {
  const s = ctx && ctx.stations;
  try {
    if (typeof s === 'function') return !!s(tag);
    if (s instanceof Set) return s.has(tag);
    if (Array.isArray(s)) return s.includes(tag);
  } catch (e) { /* hibázó forrás = nincs állomás */ }
  return false;
}
function skillLevel(ctx, id) {
  const s = ctx && ctx.skills;
  let v = 0;
  try {
    if (typeof s === 'function') v = s(id);
    else if (s && typeof s === 'object' && Object.prototype.hasOwnProperty.call(s, id)) v = s[id];
  } catch (e) { v = 0; }
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function cloneInv(inv) { return { reg: inv.reg, slots: inv.slots.map(s => (s ? { id: s.id, n: s.n } : null)) }; }

// Craft-ellenőrzés `times` darab receptre -> {ok, reason: null|'recipe'|'times'|'station'|'skill'|'items'|'space', missing:[{item,have,need}], station, skill}.
// Sorrend: állomás, skill, hozzávalók, hely (a kimenetnek a bemenetek elvétele UTÁN kell elférnie). Nem módosít.
export function craftCheck(inv, recipe, ctx, times = 1) {
  const res = (ok, reason, missing = []) => ({ ok, reason, missing });
  if (!inv || !Array.isArray(inv.slots) || !recipe || !Array.isArray(recipe.inputs) || !recipe.output) return res(false, 'recipe');
  if (!isInt(times, 1, CRAFT_LIMITS.maxBatch)) return res(false, 'times');
  if (recipe.station && !hasStation(ctx, recipe.station)) return res(false, 'station');
  if (recipe.skill && skillLevel(ctx, recipe.skill.skill) < recipe.skill.level) return res(false, 'skill');
  const missing = [];
  for (const e of recipe.inputs) {
    const have = countItem(inv, e.item), need = e.n * times;
    if (have < need) missing.push({ item: e.item, have, need });
  }
  if (missing.length) return res(false, 'items', missing);
  const sim = cloneInv(inv);
  for (const e of recipe.inputs) removeItem(sim, e.item, e.n * times);
  if (addItem(sim, recipe.output.item, recipe.output.n * times) > 0) return res(false, 'space');
  return res(true, null);
}

// Legfeljebb ennyiszer craftolható (0, ha egyszer sem; a maxBatch-re szorítva).
export function maxCraftable(inv, recipe, ctx) {
  let lo = 0, hi = CRAFT_LIMITS.maxBatch;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (craftCheck(inv, recipe, ctx, mid).ok) lo = mid; else hi = mid - 1; }
  return lo;
}

// Craftolás (ATOMI) -> {ok, reason, missing, made:{item,n}|null, used:[{item,n}]}. Hiba esetén az inventory érintetlen.
export function craft(inv, recipe, ctx, times = 1) {
  const chk = craftCheck(inv, recipe, ctx, times);
  const out = { ok: false, reason: chk.reason, missing: chk.missing, made: null, used: [] };
  if (!chk.ok) return out;
  const snap = inventoryState(inv);
  let good = true;
  for (const e of recipe.inputs) if (!removeItem(inv, e.item, e.n * times)) { good = false; break; }
  if (good && addItem(inv, recipe.output.item, recipe.output.n * times) > 0) good = false;
  if (!good) { restoreInventory(inv, snap); out.reason = 'space'; return out; }
  out.ok = true; out.reason = null; out.missing = [];
  out.made = { item: recipe.output.item, n: recipe.output.n * times };
  out.used = recipe.inputs.map(e => ({ item: e.item, n: e.n * times }));
  return out;
}

// Lista a UI-nak (S042): minden recept az állomáson + állapot -> [{recipe, craftable, reason, missing, max}].
export function craftList(reg, inv, ctx, station = null) {
  return recipesAt(reg, station).map(r => {
    const c = craftCheck(inv, r, ctx, 1);
    return { recipe: r, craftable: c.ok, reason: c.reason, missing: c.missing, max: c.ok ? maxCraftable(inv, r, ctx) : 0 };
  });
}
