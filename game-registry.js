// game-registry.js – központi adat-regiszter (S052; tiszta logika, DOM nélkül; importja: data-*, game-crafting, game-stations, game-nodes).
// Egy hívással betölti és ellenőrzi az összes adatfájlt (tárgy, recept, állomás, node, faj, kaszt, képesség), és minden hiányzó hivatkozást listába gyűjt.
// A tests.html a test-registry.js "élő adat" tesztjén át jelzi (piros, a hibák felsorolásával). Hibás elem kiesik (errors), duplikátum felülír (dups),
// a hiányzó hivatkozás (problems) NEM ejti ki az elemet: így egyszerre látszik az összes hiba. Minden függvény sosem dob.
import { ITEM_DEFS, ITEM_TEXTS, ITEM_TEXT_PREFIX, createItemRegistry, getItemDef } from './data-items.js';
import { RECIPE_DEFS } from './data-recipes.js';
import { NODE_DEFS, NODE_TEXTS } from './data-nodes.js';
import { STATION_DEFS, STATION_TEXTS } from './data-stations.js';
import { BASE_TEXTS } from './data-text.js';
import { RACE_DEFS, CLASS_DEFS, ABILITY_DEFS, CHARACTER_TEXTS } from './data-character.js';
import { createRecipeRegistry, auditRecipes } from './game-crafting.js';
import { createStationRegistry, auditStations } from './game-stations.js';
import { createNodeRegistry, auditNodes } from './game-nodes.js';

export const REGISTRY_LIMITS = { maxEach: 256, maxTags: 8, maxPassives: 8, maxStartItems: 8, maxClassAbilities: 8, maxCost: 1000, maxCooldown: 3600, maxRange: 64, maxPower: 10000, maxCount: 999, minStat: 0.25, maxStat: 4, minSpeed: 0.5, maxSpeed: 2, maxPassive: 1e6 };
export const RESOURCES = Object.freeze(['mana', 'stamina', 'focus']);
export const TARGETS = Object.freeze(['none', 'self', 'ally', 'enemy', 'area', 'direction']);

const ID_RE = /^[a-z][a-z0-9_]*$/;
const TAG_RE = /^[A-Z0-9_ÁÉÍÓÖŐÚÜŰ]+$/;
const isId = v => typeof v === 'string' && v.length <= 48 && ID_RE.test(v);
const isNum = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const dflt = (v, d) => (v === undefined ? d : v);

// Tag-lista -> fagyasztott tömb | null (hibás). Duplikátum összevonva; hiányzó -> üres.
function readTags(src) {
  if (src === undefined) return Object.freeze([]);
  if (!Array.isArray(src) || src.length > REGISTRY_LIMITS.maxTags) return null;
  const out = [];
  for (const tg of src) {
    if (typeof tg !== 'string' || tg.length > 24 || !TAG_RE.test(tg)) return null;
    if (!out.includes(tg)) out.push(tg);
  }
  return Object.freeze(out);
}
// Kezdő-tárgyak [{item,n}] -> fagyasztott tömb | null; az item létezését az audit nézi.
function readStart(src) {
  if (src === undefined) return Object.freeze([]);
  if (!Array.isArray(src) || src.length > REGISTRY_LIMITS.maxStartItems) return null;
  const out = [], seen = new Set();
  for (const e of src) {
    if (!e || typeof e !== 'object' || !isId(e.item) || seen.has(e.item) || !Number.isInteger(e.n) || e.n < 1 || e.n > REGISTRY_LIMITS.maxCount) return null;
    seen.add(e.item); out.push(Object.freeze({ item: e.item, n: e.n }));
  }
  return Object.freeze(out);
}
const readResource = v => (v === undefined || v === null ? null : (RESOURCES.includes(v) ? v : undefined));

// ---- Képesség ----
export function validateAbilityDef(def) {
  if (!def || typeof def !== 'object') return { ok: false, def: null, error: 'def' };
  const id = def.id, L = REGISTRY_LIMITS;
  if (!isId(id)) return { ok: false, def: null, error: 'id' };
  const bad = s => ({ ok: false, def: null, error: id + ':' + s });
  const resource = readResource(def.resource); if (resource === undefined) return bad('resource');
  const cost = dflt(def.cost, 0); if (!isNum(cost, 0, L.maxCost) || (cost > 0 && resource === null)) return bad('cost');
  const cooldown = dflt(def.cooldown, 0); if (!isNum(cooldown, 0, L.maxCooldown)) return bad('cooldown');
  const target = dflt(def.target, 'none'); if (!TARGETS.includes(target)) return bad('target');
  const range = dflt(def.range, 0); if (!isNum(range, 0, L.maxRange)) return bad('range');
  const power = dflt(def.power, 0); if (!isNum(power, 0, L.maxPower)) return bad('power');
  const tags = readTags(def.tags); if (!tags) return bad('tags');
  const item = def.item === undefined || def.item === null ? null : def.item; if (item !== null && !isId(item)) return bad('item');
  return { ok: true, error: null, def: Object.freeze({ id, nameKey: 'ability.' + id, resource, cost, cooldown, target, range, power, tags, item }) };
}

// ---- Faj ----
export function validateRaceDef(def) {
  if (!def || typeof def !== 'object') return { ok: false, def: null, error: 'def' };
  const id = def.id, L = REGISTRY_LIMITS;
  if (!isId(id)) return { ok: false, def: null, error: 'id' };
  const bad = s => ({ ok: false, def: null, error: id + ':' + s });
  const strength = dflt(def.strength, 1); if (!isNum(strength, L.minStat, L.maxStat)) return bad('strength');
  const weight = dflt(def.weight, 1); if (!isNum(weight, L.minStat, L.maxStat)) return bad('weight');
  const speed = dflt(def.speed, 1); if (!isNum(speed, L.minSpeed, L.maxSpeed)) return bad('speed');
  const tags = readTags(def.tags); if (!tags) return bad('tags');
  const startItems = readStart(def.startItems); if (!startItems) return bad('startItems');
  const passives = [];
  if (def.passives !== undefined) {
    if (!Array.isArray(def.passives) || def.passives.length > L.maxPassives) return bad('passives');
    for (const p of def.passives) {
      if (!p || typeof p !== 'object' || !isId(p.id) || passives.some(x => x.id === p.id)) return bad('passives');
      const value = dflt(p.value, 0); if (!isNum(value, -L.maxPassive, L.maxPassive)) return bad('passives');
      passives.push(Object.freeze({ id: p.id, value }));
    }
  }
  return { ok: true, error: null, def: Object.freeze({ id, nameKey: 'race.' + id, strength, weight, speed, tags, passives: Object.freeze(passives), startItems }) };
}

// ---- Kaszt ----
export function validateClassDef(def) {
  if (!def || typeof def !== 'object') return { ok: false, def: null, error: 'def' };
  const id = def.id;
  if (!isId(id)) return { ok: false, def: null, error: 'id' };
  const bad = s => ({ ok: false, def: null, error: id + ':' + s });
  const resource = readResource(def.resource); if (resource === undefined) return bad('resource');
  const abilities = [];
  if (def.abilities !== undefined) {
    if (!Array.isArray(def.abilities) || def.abilities.length > REGISTRY_LIMITS.maxClassAbilities) return bad('abilities');
    for (const a of def.abilities) { if (!isId(a) || abilities.includes(a)) return bad('abilities'); abilities.push(a); }
  }
  const tags = readTags(def.tags); if (!tags) return bad('tags');
  const startItems = readStart(def.startItems); if (!startItems) return bad('startItems');
  return { ok: true, error: null, def: Object.freeze({ id, nameKey: 'class.' + id, resource, abilities: Object.freeze(abilities), tags, startItems }) };
}

// ---- Faj/kaszt/képesség nyilvántartás ----
const KINDS = [['race', 'races', validateRaceDef], ['class', 'classes', validateClassDef], ['ability', 'abilities', validateAbilityDef]];
export function createCharacterRegistry(defs = { races: RACE_DEFS, classes: CLASS_DEFS, abilities: ABILITY_DEFS }) {
  const reg = { races: new Map(), classes: new Map(), abilities: new Map(), errors: [], dups: new Set() };
  const src = defs && typeof defs === 'object' ? defs : {};
  for (const [kind, key, validate] of KINDS) {
    let list; try { list = src[key]; } catch (e) { list = null; }
    if (!Array.isArray(list)) continue;
    for (const d of list.slice(0, REGISTRY_LIMITS.maxEach)) {
      let r; try { r = validate(d); } catch (e) { r = { ok: false, error: kind + ':kivétel' }; }
      if (!r.ok) { reg.errors.push(kind + ':' + r.error); continue; }
      if (reg[key].has(r.def.id)) reg.dups.add(kind + ':' + r.def.id);
      reg[key].set(r.def.id, r.def);
    }
  }
  return reg;
}
export const getRace = (reg, id) => (reg && reg.races && typeof id === 'string' ? reg.races.get(id) || null : null);
export const getClass = (reg, id) => (reg && reg.classes && typeof id === 'string' ? reg.classes.get(id) || null : null);
export const getAbility = (reg, id) => (reg && reg.abilities && typeof id === 'string' ? reg.abilities.get(id) || null : null);

// Hiányzó hivatkozások: ['kind:id>refKind:ref'] (osztály -> képesség, faj/kaszt/képesség -> tárgy).
export function auditCharacter(reg, itemReg) {
  const out = [];
  if (!reg || !reg.races) return out;
  const hasItem = id => !!getItemDef(itemReg, id);
  for (const r of reg.races.values()) for (const e of r.startItems) if (!hasItem(e.item)) out.push('race:' + r.id + '>item:' + e.item);
  for (const c of reg.classes.values()) {
    for (const a of c.abilities) if (!reg.abilities.has(a)) out.push('class:' + c.id + '>ability:' + a);
    for (const e of c.startItems) if (!hasItem(e.item)) out.push('class:' + c.id + '>item:' + e.item);
  }
  for (const a of reg.abilities.values()) if (a.item !== null && !hasItem(a.item)) out.push('ability:' + a.id + '>item:' + a.item);
  return out;
}

// ---- Teljes regiszter ----
// src (opcionális, tesztekhez): {items, recipes, stations, nodes, races, classes, abilities} definíció-listák; ami hiányzik, az éles adat.
// -> {items, recipes, stations, nodes, character, errors[], dups[], problems[], ok}; a hibák 'forrás:...' előtaggal.
export function loadRegistry(src = {}) {
  const s = src && typeof src === 'object' ? src : {};
  const pick = (k, d) => (Array.isArray(s[k]) ? s[k] : d);
  const items = createItemRegistry(pick('items', ITEM_DEFS));
  const recipes = createRecipeRegistry(pick('recipes', RECIPE_DEFS), items);
  const stations = createStationRegistry(pick('stations', STATION_DEFS), items);
  const nodes = createNodeRegistry(pick('nodes', NODE_DEFS));
  const character = createCharacterRegistry({ races: pick('races', RACE_DEFS), classes: pick('classes', CLASS_DEFS), abilities: pick('abilities', ABILITY_DEFS) });
  const errors = [], dups = [], problems = [];
  for (const [name, r] of [['items', items], ['recipes', recipes], ['stations', stations], ['nodes', nodes], ['character', character]]) {
    for (const e of r.errors) errors.push(name + ':' + e);
    for (const d of r.dups) dups.push(name + ':' + d);
  }
  for (const p of auditRecipes(recipes, items)) problems.push('recipe:' + p.replace(':', '>item:'));
  for (const p of auditStations(stations, items)) problems.push('station:' + p.replace(':', '>item:'));
  for (const p of auditNodes(nodes, items)) problems.push('node:' + p.replace(':', '>item:'));
  for (const p of auditCharacter(character, items)) problems.push(p);
  // TAG-hivatkozások: a recept állomás-TAG-je létezik, a node eszköz-TAG-jéhez van eléggé magas tier-ű eszköz.
  const stationTags = new Set(); for (const st of stations.stations.values()) stationTags.add(st.tag);
  for (const r of recipes.recipes.values()) if (r.station !== null && !stationTags.has(r.station)) problems.push('recipe:' + r.id + '>station:' + r.station);
  const toolTier = new Map();
  for (const it of items.items.values()) if (it.tool) toolTier.set(it.tool.tag, Math.max(toolTier.get(it.tool.tag) || 0, it.tool.tier));
  for (const n of nodes.nodes.values()) {
    if (n.tool === null) continue;
    if (!toolTier.has(n.tool)) problems.push('node:' + n.type + '>tool:' + n.tool);
    else if (toolTier.get(n.tool) < n.minTier) problems.push('node:' + n.type + '>tier:' + n.minTier);
  }
  return { items, recipes, stations, nodes, character, errors, dups, problems, ok: errors.length + dups.length + problems.length === 0 };
}

// ---- Szövegek ----
// Az összes adat-szöveg egy sík HU/EN táblában, ugyanazokkal a kulcsokkal, mint a main.js registerTexts-hívásai (tárgy: 'item.<id>', a többi teljes kulcs).
export function collectTexts() {
  const out = { hu: {}, en: {} };
  for (const l of ['hu', 'en']) {
    for (const [k, v] of Object.entries(ITEM_TEXTS[l] || {})) out[l][ITEM_TEXT_PREFIX + k] = v;
    for (const tab of [BASE_TEXTS, NODE_TEXTS, STATION_TEXTS, CHARACTER_TEXTS]) Object.assign(out[l], tab[l] || {});
  }
  return out;
}
export function requiredTextKeys(reg) {
  const keys = [];
  if (!reg) return keys;
  const add = (m, key = 'nameKey') => { if (m && typeof m.values === 'function') for (const v of m.values()) keys.push(v[key]); };
  add(reg.items && reg.items.items); add(reg.stations && reg.stations.stations); add(reg.nodes && reg.nodes.nodes);
  if (reg.character) { add(reg.character.races); add(reg.character.classes); add(reg.character.abilities); }
  return keys;
}
// Hiányzó szöveg-kulcsok: ['hu:kulcs', 'en:kulcs'] (nem szöveg érték is hiánynak számít).
export function auditRegistryTexts(reg, texts = collectTexts()) {
  const out = [], keys = requiredTextKeys(reg);
  for (const l of ['hu', 'en']) for (const k of keys) if (!texts || !texts[l] || typeof texts[l][k] !== 'string' || !texts[l][k]) out.push(l + ':' + k);
  return out;
}

// Olvasható jelentés a képernyőre (core-debug showReport): {ok, title, lines}.
export function reportRegistry(reg, textProblems = []) {
  if (!reg || !reg.items) return { ok: false, title: 'registry: hibás', lines: ['nincs regiszter'] };
  const n = m => (m ? m.size : 0);
  const lines = [`tárgy ${n(reg.items.items)} · recept ${n(reg.recipes.recipes)} · állomás ${n(reg.stations.stations)} · node ${n(reg.nodes.nodes)} · faj ${n(reg.character.races)} · kaszt ${n(reg.character.classes)} · képesség ${n(reg.character.abilities)}`];
  for (const e of reg.errors) lines.push('HIBA ' + e);
  for (const d of reg.dups) lines.push('DUPLIKÁLT ' + d);
  for (const p of reg.problems) lines.push('HIÁNYZÓ ' + p);
  for (const k of textProblems) lines.push('SZÖVEG ' + k);
  const ok = lines.length === 1;
  return { ok, title: ok ? 'registry: zöld' : `registry: ${lines.length - 1} hiba`, lines };
}
