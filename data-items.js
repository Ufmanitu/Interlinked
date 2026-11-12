// data-items.js – tárgyak (S033; adat + validáció, DOM nélkül).
// Új tárgy: egyedi id (kisbetű/szám/_), stack (1..9999), weight (kg, >= 0), value (alap-ár, >= 0), tags (nagybetűs tag-ek:
// a képesség-tag akadályok és receptek ezekre hivatkoznak: pl. FÁKLYA, FEJSZE). A név kulcsa: 'item.<id>' (ITEM_TEXTS, prefix 'item.').
// Szöveg-regisztráció: registerTexts(ITEM_TEXTS, ITEM_TEXT_PREFIX) (a main.js az S035-ben köti be). Az S034 a súlyt (kg) a póráz-teherré alakítja.
export const ITEM_TEXT_PREFIX = 'item.';
export const ITEM_LIMITS = { maxStack: 9999, maxTags: 8, maxItems: 2048, maxWeight: 100000, maxValue: 1e9 };

export const ITEM_DEFS = [
  { id: 'wood',   stack: 99, weight: 2,    value: 2,  tags: ['MATERIAL', 'FUEL'] },
  { id: 'stone',  stack: 99, weight: 3,    value: 1,  tags: ['MATERIAL'] },
  { id: 'fiber',  stack: 99, weight: 0.05, value: 1,  tags: ['MATERIAL'] },
  { id: 'herb',   stack: 50, weight: 0.1,  value: 3,  tags: ['HERB'] },
  { id: 'torch',  stack: 20, weight: 0.5,  value: 6,  tags: ['FÁKLYA', 'FUEL'] },
  { id: 'shard',  stack: 1,  weight: 1,    value: 80, tags: ['SORSSZILÁNK'] },
];

export const ITEM_TEXTS = {
  hu: { wood: 'Fa', stone: 'Kő', fiber: 'Rost', herb: 'Gyógynövény', torch: 'Fáklya', shard: 'Sorsszilánk' },
  en: { wood: 'Wood', stone: 'Stone', fiber: 'Fiber', herb: 'Herb', torch: 'Torch', shard: 'Fate Shard' },
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
  const item = Object.freeze({ id, nameKey: ITEM_TEXT_PREFIX + id, stack, weight, value, tags: Object.freeze(tags) });
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
