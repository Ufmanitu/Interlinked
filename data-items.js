// data-items.js – tárgyak (S033; adat + validáció, DOM nélkül).
// Új tárgy: egyedi id (kisbetű/szám/_), stack (1..9999), weight (kg, >= 0), value (alap-ár, >= 0), tags (nagybetűs tag-ek:
// a képesség-tag akadályok és receptek ezekre hivatkoznak: pl. FÁKLYA, FEJSZE). A név kulcsa: 'item.<id>' (ITEM_TEXTS, prefix 'item.').
// Szöveg-regisztráció: registerTexts(ITEM_TEXTS, ITEM_TEXT_PREFIX) (a main.js az S035-ben köti be). Az S034 a súlyt (kg) a póráz-teherré alakítja.
// Eszköz (S038): opcionális tool {tag (pl. FEJSZE), tier (egész 1..9), speed (gyűjtési sebesség-szorzó, 0.05..20), power (ütésenkénti hp-levonás, egész 1..99)};
// a tool.tag automatikusan a tárgy tag-jei közé kerül. Az eszköz az inventoryban LEVÉVE is hat (a legjobb számít); kézzel: tier 0, speed 1, power 1.
export const ITEM_TEXT_PREFIX = 'item.';
export const ITEM_LIMITS = { maxStack: 9999, maxTags: 8, maxItems: 2048, maxWeight: 100000, maxValue: 1e9, maxTier: 9, minToolSpeed: 0.05, maxToolSpeed: 20, maxToolPower: 99 };

export const ITEM_DEFS = [
  { id: 'wood',   stack: 99, weight: 2,    value: 2,  tags: ['MATERIAL', 'FUEL'] },
  { id: 'stone',  stack: 99, weight: 3,    value: 1,  tags: ['MATERIAL'] },
  { id: 'fiber',  stack: 99, weight: 0.05, value: 1,  tags: ['MATERIAL'] },
  { id: 'herb',   stack: 50, weight: 0.1,  value: 3,  tags: ['HERB'] },
  { id: 'torch',  stack: 20, weight: 0.5,  value: 6,  tags: ['FÁKLYA', 'FUEL'] },
  { id: 'shard',  stack: 1,  weight: 1,    value: 80, tags: ['SORSSZILÁNK'] },
  // S038 alap-eszközök (tier 1; a magasabb tier-ek a régiókkal jönnek: S119, S129, S139...). Kézzel egy fa 2,7 mp, fejszével ~1,1 mp.
  { id: 'axe',     stack: 1, weight: 2.5, value: 12, tags: ['ESZKÖZ'], tool: { tag: 'FEJSZE',  tier: 1, speed: 2.5, power: 1 } },
  { id: 'pickaxe', stack: 1, weight: 3,   value: 14, tags: ['ESZKÖZ'], tool: { tag: 'CSÁKÁNY', tier: 1, speed: 2.5, power: 1 } },
  { id: 'sickle',  stack: 1, weight: 0.8, value: 8,  tags: ['ESZKÖZ'], tool: { tag: 'SARLÓ',   tier: 1, speed: 2.5, power: 1 } },
  // S060 kötél: kasztfüggetlen KÖTÉL-tag forrás (a ranger kötélvetése ugyanezt a tag-et adja); az átkelők (S130) és a mászás (S150) használják
  { id: 'rope',    stack: 5, weight: 1.2, value: 9,  tags: ['ESZKÖZ', 'KÖTÉL'] },
  // S041 felállítható craft-állomások (a data-stations.js STATION_DEFS hivatkozik rájuk; a súly a hordásnál számít)
  { id: 'workbench', stack: 1, weight: 20, value: 20, tags: ['ÁLLOMÁS'] },
  { id: 'furnace',   stack: 1, weight: 30, value: 24, tags: ['ÁLLOMÁS'] },
  { id: 'cookfire',  stack: 1, weight: 6,  value: 10, tags: ['ÁLLOMÁS'] },
];

export const ITEM_TEXTS = {
  hu: { wood: 'Fa', stone: 'Kő', fiber: 'Rost', herb: 'Gyógynövény', torch: 'Fáklya', shard: 'Sorsszilánk', axe: 'Fejsze', pickaxe: 'Csákány', sickle: 'Sarló', rope: 'Kötél', workbench: 'Munkapad', furnace: 'Kemence', cookfire: 'Főzőhely' },
  en: { wood: 'Wood', stone: 'Stone', fiber: 'Fiber', herb: 'Herb', torch: 'Torch', shard: 'Fate Shard', axe: 'Axe', pickaxe: 'Pickaxe', sickle: 'Sickle', rope: 'Rope', workbench: 'Workbench', furnace: 'Furnace', cookfire: 'Cooking fire' },
};

const ID_RE = /^[a-z][a-z0-9_]*$/;
const TAG_RE = /^[A-Z0-9_ÁÉÍÓÖŐÚÜŰ]+$/;

// Egy tárgy-definíció ellenőrzése -> {ok, item|null, error}; sosem dob. Az item befagyasztott, nameKey 'item.<id>'.
export function validateItemDef(def) {
  if (!def || typeof def !== 'object') return { ok: false, item: null, error: 'def' };
  const id = def.id;
  if (typeof id !== 'string' || !ID_RE.test(id) || id.length > 48) return { ok: false, item: null, error: 'id' };
  const stack = def.stack;
  if (!Number.isInteger(stack) || stack < 1 || stack > ITEM_LIMITS.maxStack) return { ok: false, item: null, error: id + ':stack' };
  const weight = def.weight;
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > ITEM_LIMITS.maxWeight) return { ok: false, item: null, error: id + ':weight' };
  const value = def.value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > ITEM_LIMITS.maxValue) return { ok: false, item: null, error: id + ':value' };
  const tags = [];
  if (def.tags !== undefined) {
    if (!Array.isArray(def.tags) || def.tags.length > ITEM_LIMITS.maxTags) return { ok: false, item: null, error: id + ':tags' };
    for (const tg of def.tags) {
      if (typeof tg !== 'string' || !TAG_RE.test(tg)) return { ok: false, item: null, error: id + ':tag' };
      if (!tags.includes(tg)) tags.push(tg);
    }
  }
  let tool = null;
  if (def.tool !== undefined && def.tool !== null) {
    const t = def.tool, L = ITEM_LIMITS;
    if (typeof t !== 'object' || typeof t.tag !== 'string' || t.tag.length > 24 || !TAG_RE.test(t.tag)) return { ok: false, item: null, error: id + ':tool' };
    if (!Number.isInteger(t.tier) || t.tier < 1 || t.tier > L.maxTier) return { ok: false, item: null, error: id + ':tool' };
    if (typeof t.speed !== 'number' || !Number.isFinite(t.speed) || t.speed < L.minToolSpeed || t.speed > L.maxToolSpeed) return { ok: false, item: null, error: id + ':tool' };
    if (!Number.isInteger(t.power) || t.power < 1 || t.power > L.maxToolPower) return { ok: false, item: null, error: id + ':tool' };
    tool = Object.freeze({ tag: t.tag, tier: t.tier, speed: t.speed, power: t.power });
    if (!tags.includes(t.tag)) tags.push(t.tag);
    if (tags.length > ITEM_LIMITS.maxTags) return { ok: false, item: null, error: id + ':tags' };
  }
  const item = Object.freeze({ id, nameKey: ITEM_TEXT_PREFIX + id, stack, weight, value, tags: Object.freeze(tags), tool });
  return { ok: true, item, error: null };
}

// Nyilvántartás (Map-alapú: prototípus-kulcs nem találat). Hibás elem kiesik (errors), duplikátum felülír (dups).
export function createItemRegistry(defs = ITEM_DEFS) {
  const reg = { items: new Map(), errors: [], dups: new Set() };
  const list = Array.isArray(defs) ? defs : [];
  for (const d of list.slice(0, ITEM_LIMITS.maxItems)) {
    const r = validateItemDef(d);
    if (!r.ok) { reg.errors.push(r.error); continue; }
    if (reg.items.has(r.item.id)) reg.dups.add(r.item.id);
    reg.items.set(r.item.id, r.item);
  }
  return reg;
}

export function getItemDef(reg, id) {
  return reg && reg.items && typeof id === 'string' ? (reg.items.get(id) || null) : null;
}

export function registerItemTexts(register) {
  return typeof register === 'function' ? register(ITEM_TEXTS, ITEM_TEXT_PREFIX) : 0;
}
