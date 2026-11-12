// game-inventory.js – játékosonkénti inventory (S033; tiszta logika, DOM nélkül; importja: data-items).
// Slot = null | {id, n} (n: 1..stack). Minden módosítás összeg-tartó: a tárgy nem vész el és nem keletkezik a semmiből.
import { createItemRegistry, getItemDef } from './data-items.js';

export const INVENTORY_CONFIG = { slots: 24, minSlots: 1, maxSlots: 120 };
export const INVENTORY_STATE_VERSION = 1;

let defaultReg = null;
const isCount = n => Number.isSafeInteger(n) && n > 0;
const isIndex = (inv, i) => Number.isInteger(i) && i >= 0 && i < inv.slots.length;

export function createInventory(reg, slots = INVENTORY_CONFIG.slots) {
  if (!reg || !reg.items) reg = defaultReg || (defaultReg = createItemRegistry());
  const c = INVENTORY_CONFIG;
  const n = Number.isInteger(slots) ? Math.min(c.maxSlots, Math.max(c.minSlots, slots)) : c.slots;
  return { reg, slots: new Array(n).fill(null) };
}

// Két játékos, külön inventory (közös nyilvántartás).
export function createPlayerInventories(reg, count = 2, slots) {
  const r = reg && reg.items ? reg : createItemRegistry();
  const out = [];
  for (let i = 0; i < count; i++) out.push(createInventory(r, slots));
  return out;
}

export function countItem(inv, id) {
  let n = 0;
  for (const s of inv.slots) if (s && s.id === id) n += s.n;
  return n;
}
export function hasItem(inv, id, n = 1) { return isCount(n) && countItem(inv, id) >= n; }

export function countTag(inv, tag) {
  let n = 0;
  for (const s of inv.slots) {
    if (!s) continue;
    const d = getItemDef(inv.reg, s.id);
    if (d && d.tags.includes(tag)) n += s.n;
  }
  return n;
}
export function hasTag(inv, tag) { return countTag(inv, tag) > 0; }

// Mennyi fér még be az adott tárgyból (ismeretlen id -> 0).
export function spaceFor(inv, id) {
  const d = getItemDef(inv.reg, id);
  if (!d) return 0;
  let room = 0;
  for (const s of inv.slots) room += s === null ? d.stack : (s.id === id ? d.stack - s.n : 0);
  return room;
}
export function canAdd(inv, id, n = 1) { return isCount(n) && spaceFor(inv, id) >= n; }

// Hozzáadás: előbb a meglévő stackek, aztán az üres slotok. Visszatér: a NEM befért mennyiség (hibás bemenetnél az egész n / 0).
export function addItem(inv, id, n = 1) {
  const d = getItemDef(inv.reg, id);
  if (!d || !isCount(n)) return isCount(n) ? n : 0;
  let left = n;
  for (const s of inv.slots) {
    if (left <= 0) break;
    if (s && s.id === id && s.n < d.stack) { const k = Math.min(d.stack - s.n, left); s.n += k; left -= k; }
  }
  for (let i = 0; i < inv.slots.length && left > 0; i++) {
    if (inv.slots[i] === null) { const k = Math.min(d.stack, left); inv.slots[i] = { id, n: k }; left -= k; }
  }
  return left;
}

// Eltávolítás (atomi): ha nincs elég, semmi nem változik és false. Az utolsó slotokból vesz, így az elülső stackek teltek maradnak.
export function removeItem(inv, id, n = 1) {
  if (!isCount(n) || countItem(inv, id) < n) return false;
  let left = n;
  for (let i = inv.slots.length - 1; i >= 0 && left > 0; i--) {
    const s = inv.slots[i];
    if (!s || s.id !== id) continue;
    const k = Math.min(s.n, left);
    s.n -= k; left -= k;
    if (s.n === 0) inv.slots[i] = null;
  }
  return true;
}

// Slot áthelyezése: üres célra mozgat, azonos tárgynál összevon (a maradék marad), különbözőnél cserél. -> változott-e.
export function moveSlot(inv, from, to) {
  if (!isIndex(inv, from) || !isIndex(inv, to) || from === to) return false;
  const a = inv.slots[from], b = inv.slots[to];
  if (!a) return false;
  if (!b) { inv.slots[to] = a; inv.slots[from] = null; return true; }
  if (a.id === b.id) {
    const d = getItemDef(inv.reg, a.id);
    if (!d) return false;
    const k = Math.min(d.stack - b.n, a.n);
    if (k <= 0) return false;
    b.n += k; a.n -= k;
    if (a.n === 0) inv.slots[from] = null;
    return true;
  }
  inv.slots[from] = b; inv.slots[to] = a;
  return true;
}

// Stack kettéosztása üres célslotra: n darab átkerül (a forrásban marad legalább 1). -> változott-e.
export function splitStack(inv, from, to, n) {
  if (!isIndex(inv, from) || !isIndex(inv, to) || from === to || !isCount(n)) return false;
  const a = inv.slots[from];
  if (!a || inv.slots[to] !== null || n >= a.n) return false;
  a.n -= n; inv.slots[to] = { id: a.id, n };
  return true;
}

// Összsúly (kg); az S034 ezt köti a póráz p.load-jába.
export function totalWeight(inv) {
  let w = 0;
  for (const s of inv.slots) { if (!s) continue; const d = getItemDef(inv.reg, s.id); if (d) w += d.weight * s.n; }
  return w;
}
export function usedSlots(inv) { let c = 0; for (const s of inv.slots) if (s) c++; return c; }

// Mentés-alak (az S050 köti a mentésbe): {v:1, slots:[null|[id,n]]}.
export function inventoryState(inv) {
  return { v: INVENTORY_STATE_VERSION, slots: inv.slots.map(s => (s ? [s.id, s.n] : null)) };
}
// Visszatöltés (atomi): hibás/ismeretlen állapotnál false és az inventory érintetlen.
export function restoreInventory(inv, st) {
  if (!st || typeof st !== 'object' || st.v !== INVENTORY_STATE_VERSION || !Array.isArray(st.slots)) return false;
  if (st.slots.length > inv.slots.length) return false;
  const next = new Array(inv.slots.length).fill(null);
  for (let i = 0; i < st.slots.length; i++) {
    const e = st.slots[i];
    if (e === null) continue;
    if (!Array.isArray(e) || e.length !== 2) return false;
    const d = getItemDef(inv.reg, e[0]);
    if (!d || !Number.isInteger(e[1]) || e[1] < 1 || e[1] > d.stack) return false;
    next[i] = { id: e[0], n: e[1] };
  }
  inv.slots = next;
  return true;
}
