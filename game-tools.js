// game-tools.js – craftolható alap-szerszámok mint kasztfüggetlen tag-forrás (S060; tiszta logika, DOM nélkül; importja: game-inventory).
// Az alap-szerszám (fáklya, fejsze, csákány, sarló, kötél) kézzel craftolható, és az inventoryban a tárgy tag-jét adja (FÁKLYA, FEJSZE, CSÁKÁNY, SARLÓ, KÖTÉL):
// ugyanazt a tag-et, amit a kaszt-képesség (pl. FÉNY/ÉGETÉS/KÖTÉL) vagy a faj (SÖTÉTLÁTÁS) ad, ezért a kaszt kényelem, nem kapu (GDD 6).
// Az akadály-rendszer (game-obstacle) a tárgy-tag-eket már magától olvassa (hasTag, bestTool); ez a modul az összesítést, a forrás-keresést és az auditot adja.
// src (nyers adat, mint az auditObstacles-nél): {items: ITEM_DEFS, recipes: RECIPE_DEFS, nodes: NODE_DEFS (opcionális), abilities, races, classes}.
import { hasTag } from './game-inventory.js';

// Az alap-szerszámkészlet: item = tárgy-id, tag = a tőle kapott tag, use = a használat módja (UI/hang/oktatás kulcs).
export const TOOLKIT = Object.freeze([
  Object.freeze({ item: 'torch', tag: 'FÁKLYA', use: 'light' }),
  Object.freeze({ item: 'axe', tag: 'FEJSZE', use: 'cut' }),
  Object.freeze({ item: 'pickaxe', tag: 'CSÁKÁNY', use: 'mine' }),
  Object.freeze({ item: 'sickle', tag: 'SARLÓ', use: 'harvest' }),
  Object.freeze({ item: 'rope', tag: 'KÖTÉL', use: 'anchor' }),
]);
export const TOOL_TAGS = Object.freeze(TOOLKIT.map(k => k.tag));

const arr = v => (Array.isArray(v) ? v : []);
const tagsOfDef = d => (d && typeof d === 'object' ? [...arr(d.tags), ...(d.tool && typeof d.tool.tag === 'string' ? [d.tool.tag] : [])].filter(x => typeof x === 'string') : []);

// ---- a játékosnál lévő tag-ek ----
// Az inventory minden tárgyának tag-je (az eszköz tool.tag-je is benne van a tárgy tag-jei közt). -> Set; hibás inventory = üres.
export function heldTags(inv) {
  const out = new Set();
  if (!inv || !Array.isArray(inv.slots) || !inv.reg || !inv.reg.items || typeof inv.reg.items.get !== 'function') return out;
  for (const s of inv.slots) {
    const d = s && typeof s === 'object' ? inv.reg.items.get(s.id) : null;
    if (d) for (const tg of arr(d.tags)) out.add(tg);
  }
  return out;
}
// Csak az alap-szerszám tag-ek (TOOL_TAGS), amiket a játékos épp birtokol. -> Set
export function toolTagsOf(inv) {
  const held = heldTags(inv), out = new Set();
  for (const tg of TOOL_TAGS) if (held.has(tg)) out.add(tg);
  return out;
}
// Minden forrás egyesítve: inventory-tag-ek + a játékos tag-jei (faj/kaszt: p.tags) + extra (pl. a képességek épp aktív tag-jei). -> Set
export function playerTagSet(inv, player, extra = []) {
  const out = heldTags(inv);
  for (const tg of arr(player && player.tags)) if (typeof tg === 'string') out.add(tg);
  for (const tg of arr(extra)) if (typeof tg === 'string') out.add(tg);
  return out;
}
// Igaz, ha a tag-készlet (Set|tömb) feloldja az akadályt (a solves valamelyik tag-jét tartalmazza). o: {solves:[...]}
export function solvesAny(o, tags) {
  const set = tags instanceof Set ? tags : new Set(arr(tags));
  return !!o && arr(o.solves).some(tg => set.has(tg));
}
// Az inventory tag-ellenőrzése a game-inventory-n át (a heldTags-szal azonos eredményt ad; teszt-keresztellenőrzéshez).
export const holdsTag = (inv, tag) => { try { return hasTag(inv, tag); } catch (e) { return false; } };

// ---- források és kézi elérhetőség (adat) ----
// Egy tag forrásai: [{kind: 'item'|'ability'|'race'|'class', id}] (a tárgy tool.tag-je is számít).
export function tagSources(src, tag) {
  const s = src || {}, out = [];
  for (const [kind, list] of [['item', s.items], ['ability', s.abilities], ['race', s.races], ['class', s.classes]]) {
    for (const d of arr(list)) if (d && typeof d.id === 'string' && tagsOfDef(d).includes(tag)) out.push({ kind, id: d.id });
  }
  return out;
}
// A kézzel beszerezhető tárgyak: a node-ok drop-jai + minden recept, ami állomás és skill nélkül (kézzel) készül, és a bemenetei mind kézzel beszerezhetők.
// opts.stations: állomás-TAG-ek, amik elérhetőnek számítanak (alap: nincs). -> Set (tárgy-id)
export function handObtainable(src, opts = {}) {
  const s = src || {}, have = new Set(), stations = new Set(arr(opts.stations));
  for (const n of arr(s.nodes)) for (const d of arr(n && n.drops)) if (d && typeof d.item === 'string') have.add(d.item);
  const recs = arr(s.recipes).filter(r => r && r.output && typeof r.output.item === 'string' && (r.station === null || r.station === undefined || stations.has(r.station)) && (!r.skill || !(r.skill.level > 0)));
  for (let changed = true, guard = 0; changed && guard < 64; guard++) {
    changed = false;
    for (const r of recs) if (!have.has(r.output.item) && arr(r.inputs).every(i => i && have.has(i.item))) { have.add(r.output.item); changed = true; }
  }
  return have;
}
// Azok a tag-ek, amiket kaszt és faj nélkül, kézzel beszerzett tárgyakkal meg lehet szerezni. -> Set
export function classFreeTags(src, opts = {}) {
  const out = new Set(), items = new Map(arr(src && src.items).filter(d => d && typeof d.id === 'string').map(d => [d.id, d]));
  for (const id of handObtainable(src, opts)) { const d = items.get(id); if (d) for (const tg of tagsOfDef(d)) out.add(tg); }
  return out;
}
// Az akadály kasztfüggetlen megoldásai: a solves azon tag-jei, amik kézzel beszerezhetők. os: createObstacleSystem eredménye. -> {id: [tag]}
export function classFreeSolutions(os, src, opts = {}) {
  const free = classFreeTags(src, opts), out = {};
  if (os && os.items && typeof os.items.values === 'function') for (const r of os.items.values()) out[r.id] = arr(r.solves).filter(tg => free.has(tg));
  return out;
}

// ---- audit (S065/S191/S192) ----
// -> ['item:noitem' | 'item:notag' | 'item:norecipe' | 'item:station' | 'item:skill' | 'item:inputs'] (üres = rendben)
//   noitem: nincs ilyen tárgy; notag: a tárgy nem adja a tag-et; norecipe: nincs rá recept; station/skill: a recept állomást/skillt kér (nem kézi alap-szerszám);
//   inputs: a recept bemenete nem szerezhető be kézzel (node-drop vagy kézi recept).
export function auditToolkit(src, kit = TOOLKIT) {
  const s = src || {}, out = [], items = new Map(arr(s.items).filter(d => d && typeof d.id === 'string').map(d => [d.id, d]));
  const hand = handObtainable(s);
  for (const k of arr(kit)) {
    const d = items.get(k.item);
    if (!d) { out.push(k.item + ':noitem'); continue; }
    if (!tagsOfDef(d).includes(k.tag)) out.push(k.item + ':notag');
    const rec = arr(s.recipes).find(r => r && r.output && r.output.item === k.item);
    if (!rec) { out.push(k.item + ':norecipe'); continue; }
    if (rec.station !== null && rec.station !== undefined) out.push(k.item + ':station');
    if (rec.skill && rec.skill.level > 0) out.push(k.item + ':skill');
    if (!arr(rec.inputs).every(i => i && hand.has(i.item))) out.push(k.item + ':inputs');
  }
  return out;
}
