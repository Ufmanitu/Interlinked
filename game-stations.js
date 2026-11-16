// game-stations.js – felállítható craft-állomások (S041; tiszta logika, DOM nélkül; importja: data-items, data-stations, game-inventory, game-collision, game-hud).
// Az állomás az inventoryból állítható fel (a felállító tárgy elfogy), a világban ütköző, interakciós célpont ('use' akció; az S042 craft UI köti), és
// TAG-et ad a közelében álló játékosnak: stationCtx(sys, p, skills) -> a game-crafting ctx-e ({stations: Set, skills}). A craft kézzel is megy (station null).
import { createItemRegistry, getItemDef } from './data-items.js';
import { STATION_DEFS } from './data-stations.js';
import { removeItem, addItem, countItem, spaceFor } from './game-inventory.js';
import { collides } from './game-collision.js';
import { menuOpen } from './game-hud.js';

export const STATION_CONFIG = { placeDist: 40, maxStations: 256, maxRange: 400, action: 'use', stateVersion: 1 };
const ID_RE = /^[a-z][a-z0-9_]*$/;
const TAG_RE = /^[A-Z0-9_ÁÉÍÓÖŐÚÜŰ]+$/;
const fin = n => typeof n === 'number' && Number.isFinite(n);
const dimOk = (o, a, b, hi) => !!o && typeof o === 'object' && fin(o[a]) && fin(o[b]) && o[a] > 0 && o[b] > 0 && o[a] <= hi && o[b] <= hi;

// Egy állomás-def ellenőrzése -> {ok, station (fagyasztott)|null, error}; sosem dob.
export function validateStationDef(def, itemReg) {
  const bad = e => ({ ok: false, station: null, error: e });
  if (!def || typeof def !== 'object') return bad('def');
  const id = def.id;
  if (typeof id !== 'string' || !ID_RE.test(id) || id.length > 48) return bad('id');
  if (typeof def.tag !== 'string' || def.tag.length > 24 || !TAG_RE.test(def.tag)) return bad(id + ':tag');
  if (typeof def.item !== 'string' || !getItemDef(itemReg, def.item)) return bad(id + ':item');
  if (!dimOk(def.collider, 'w', 'h', 256)) return bad(id + ':collider');
  const s = def.sprite;
  if (!dimOk(s, 'w', 'h', 256) || !fin(s.ax) || !fin(s.ay) || s.ax < 0 || s.ay < 0 || s.ax > s.w || s.ay > s.h) return bad(id + ':sprite');
  if (!fin(def.range) || def.range < 8 || def.range > STATION_CONFIG.maxRange) return bad(id + ':range');
  const pal = Array.isArray(def.palette) ? def.palette.filter(c => typeof c === 'string').slice(0, 16) : [];
  const station = Object.freeze({
    id, tag: def.tag, item: def.item, nameKey: 'obj.' + id, range: def.range, palette: Object.freeze(pal),
    collider: Object.freeze({ w: def.collider.w, h: def.collider.h }), sprite: Object.freeze({ w: s.w, h: s.h, ax: s.ax, ay: s.ay }),
  });
  return { ok: true, station, error: null };
}

// Nyilvántartás: hibás def kiesik (errors), duplikált id vagy felállító tárgy kiesik (dups) – egy tárgy egy állomást állít fel.
export function createStationRegistry(defs = STATION_DEFS, itemReg) {
  const items = itemReg && itemReg.items ? itemReg : createItemRegistry();
  const reg = { items, stations: new Map(), byItem: new Map(), errors: [], dups: new Set() };
  for (const d of (Array.isArray(defs) ? defs : []).slice(0, 256)) {
    const r = validateStationDef(d, items);
    if (!r.ok) { reg.errors.push(r.error); continue; }
    if (reg.stations.has(r.station.id) || reg.byItem.has(r.station.item)) { reg.dups.add(r.station.id); continue; }
    reg.stations.set(r.station.id, r.station); reg.byItem.set(r.station.item, r.station);
  }
  return reg;
}
export const getStationDef = (reg, id) => (reg && reg.stations && typeof id === 'string' ? reg.stations.get(id) || null : null);
export const stationForItem = (reg, item) => (reg && reg.byItem && typeof item === 'string' ? reg.byItem.get(item) || null : null);

// Hiányzó hivatkozások: ['állomás:tárgy'] (a tests.html jelezze).
export function auditStations(reg, itemReg) {
  const out = [];
  if (reg && reg.stations) for (const s of reg.stations.values()) if (!getItemDef(itemReg, s.item)) out.push(s.id + ':' + s.item);
  return out;
}

export function createStationSystem(opts = {}) {
  const reg = opts.reg && opts.reg.stations ? opts.reg : createStationRegistry(opts.defs, opts.itemReg);
  return { reg, placed: new Map(), next: 1, version: 0, lastError: null };
}

// A lerakott állomás ütköző téglalapja (bal-felső sarok): a lábpont fölé nyúló talp.
export function stationCollider(sys, st) {
  const d = getStationDef(sys.reg, st.type);
  return d ? { x: st.x - d.collider.w / 2, y: st.y - d.collider.h, w: d.collider.w, h: d.collider.h } : null;
}
export function stationColliders(sys, out = []) {
  for (const st of sys.placed.values()) { const r = stationCollider(sys, st); if (r) out.push(r); }
  return out;
}
export const stationCount = sys => (sys && sys.placed ? sys.placed.size : 0);

// A lerakási pont (lábpont) a játékos előtt: facing {x,y} (4 irány; hibás -> le).
export function placeSpot(p, facing, cfg = STATION_CONFIG) {
  const fx = facing && fin(facing.x) ? Math.sign(facing.x) : 0, fy = facing && fin(facing.y) ? Math.sign(facing.y) : 0;
  const dx = fx === 0 && fy === 0 ? 0 : fx, dy = fx === 0 && fy === 0 ? 1 : fy;
  return { x: p.x + dx * cfg.placeDist, y: p.y + (p.h || 0) / 2 + dy * cfg.placeDist };
}

const asEnt = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h });
// Lerakható-e a (x,y) lábpontra: -> {ok, reason: null|'type'|'pos'|'limit'|'blocked'}. A falak közt a már álló állomások is lehetnek (a main.js falai tartalmazzák).
export function canPlace(sys, type, x, y, walls = [], players = []) {
  const d = getStationDef(sys && sys.reg, type);
  if (!d) return { ok: false, reason: 'type' };
  if (!fin(x) || !fin(y)) return { ok: false, reason: 'pos' };
  if (sys.placed.size >= STATION_CONFIG.maxStations) return { ok: false, reason: 'limit' };
  const e = asEnt({ x: x - d.collider.w / 2, y: y - d.collider.h, w: d.collider.w, h: d.collider.h });
  const solid = [...(Array.isArray(walls) ? walls : []), ...stationColliders(sys)];
  if (collides(e, solid)) return { ok: false, reason: 'blocked' };
  for (const p of players) if (p && fin(p.x) && fin(p.y) && collides(e, [{ x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h }])) return { ok: false, reason: 'blocked' };
  return { ok: true, reason: null };
}

// Felállítás az inventory `itemId` tárgyából a (x,y) lábpontra (ATOMI: hiba esetén az inventory és a rendszer érintetlen)
// -> {ok, reason: null|'item'|'type'|'pos'|'limit'|'blocked', station}.
export function placeStation(sys, inv, itemId, x, y, walls, players) {
  const d = stationForItem(sys && sys.reg, itemId);
  if (!d) return { ok: false, reason: 'type', station: null };
  if (!inv || !Array.isArray(inv.slots) || countItem(inv, itemId) < 1) return { ok: false, reason: 'item', station: null };
  const c = canPlace(sys, d.id, x, y, walls, players);
  if (!c.ok) return { ok: false, reason: c.reason, station: null };
  if (!removeItem(inv, itemId, 1)) return { ok: false, reason: 'item', station: null };
  const st = { id: sys.next++, type: d.id, x, y };
  sys.placed.set(st.id, st); sys.version++;
  return { ok: true, reason: null, station: st };
}

// Felszedés: az állomás vissza az inventoryba (ATOMI: nincs hely -> marad) -> {ok, reason: null|'missing'|'space', item}.
export function pickUpStation(sys, id, inv) {
  const st = sys && sys.placed ? sys.placed.get(id) : null;
  const d = st ? getStationDef(sys.reg, st.type) : null;
  if (!st || !d) return { ok: false, reason: 'missing', item: null };
  if (!inv || !Array.isArray(inv.slots) || spaceFor(inv, d.item) < 1) return { ok: false, reason: 'space', item: null };
  if (addItem(inv, d.item, 1) > 0) return { ok: false, reason: 'space', item: null };
  sys.placed.delete(id); sys.version++;
  return { ok: true, reason: null, item: d.item };
}

function rectDist(px, py, r) {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w)), dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}
// A (x,y) ponthoz a hatótávon belüli állomások, közelebbi elöl -> [{station, def, dist}].
export function stationsNear(sys, x, y) {
  const out = [];
  if (!sys || !sys.placed || !fin(x) || !fin(y)) return out;
  for (const st of sys.placed.values()) {
    const d = getStationDef(sys.reg, st.type), r = d && stationCollider(sys, st);
    if (!r) continue;
    const dist = rectDist(x, y, r);
    if (dist <= d.range) out.push({ station: st, def: d, dist });
  }
  return out.sort((a, b) => a.dist - b.dist || a.station.id - b.station.id);
}
// A játékos közelében álló állomások TAG-jei (Set).
export function stationTags(sys, p) {
  const s = new Set();
  if (p) for (const n of stationsNear(sys, p.x, p.y)) s.add(n.def.tag);
  return s;
}
// craft-ctx egy játékoshoz: {stations: Set, skills} (a skills az S045-ig üres = 0).
export function stationCtx(sys, p, skills = null) { return { stations: stationTags(sys, p), skills }; }

// Interakció-forrás (addProvider): a lerakott állomások 'use' akcióval (kind 'station', ref = az állomás).
export function stationProvider(sys) {
  return function stationsNearZone(zone, out, cfg) {
    if (!sys || !sys.placed) return out;
    const m = cfg && cfg.prefilter > 0 ? cfg.prefilter : 96;
    for (const st of sys.placed.values()) {
      if (!(st.x >= zone.x - m && st.x <= zone.x + zone.w + m && st.y >= zone.y - m && st.y <= zone.y + zone.h + m)) continue;
      const r = stationCollider(sys, st), d = getStationDef(sys.reg, st.type);
      if (!r || !d) continue;
      out.push({ key: 'station:' + st.id, kind: 'station', ref: st, action: STATION_CONFIG.action, rect: r, ax: st.x - d.sprite.ax + d.sprite.w / 2, ay: st.y - d.sprite.ay });
    }
    return out;
  };
}

// Felállítás-bemenet (a stepDropInput/stepInvUi KÖRÜL hívandó, a NYERS bemenettel): nyitott menünél, ha nincs fogott tárgy és a kurzor alatt felállítható tárgy van,
// az 1. képesség (ability1Pressed) lerakja a játékos elé. A kezelt gombnyomást a visszaadott `raws` már nem tartalmazza (az inventory UI ne jelölje ki).
// facings[i] = az interakció-rendszer iránya. -> {events:[{type 'place'|'place-fail', player, item, reason?, station?}], raws}.
export function stepPlaceInput(sys, ui, menus, raws, inventories, players, facings, walls) {
  const res = { events: [], raws };
  if (!sys || !ui || !Array.isArray(ui.players) || !Array.isArray(raws)) return res;
  const out = raws.slice();
  for (let i = 0; i < 2; i++) {
    const ps = ui.players[i], raw = raws[i], inv = inventories && inventories[i], p = players && players[i];
    if (!ps || !raw || raw.ability1Pressed !== true || !inv || !Array.isArray(inv.slots) || !p) continue;
    if (!menuOpen(menus, i) || ps.wasOpen !== true || ps.mark >= 0 || !Number.isInteger(ps.cursor)) continue;
    const s = inv.slots[ps.cursor];
    if (!s || !stationForItem(sys.reg, s.id)) continue;
    out[i] = { ...raw, ability1Pressed: false };
    const sp = placeSpot(p, facings && facings[i]);
    const r = placeStation(sys, inv, s.id, sp.x, sp.y, walls, players);
    res.events.push(r.ok ? { type: 'place', player: i, item: s.id, station: r.station } : { type: 'place-fail', player: i, item: s.id, reason: r.reason });
  }
  res.raws = out;
  return res;
}

// Mentés-alak (az S050 köti be): {v:1, next, list:[[id,típus,x,y]]}; a visszatöltés ATOMI (hibás -> false, érintetlen).
export function stationState(sys) {
  return { v: STATION_CONFIG.stateVersion, next: sys.next, list: [...sys.placed.values()].map(s => [s.id, s.type, s.x, s.y]) };
}
export function restoreStations(sys, st) {
  if (!sys || !st || st.v !== STATION_CONFIG.stateVersion || !Array.isArray(st.list) || st.list.length > STATION_CONFIG.maxStations) return false;
  const m = new Map();
  let maxId = 0;
  for (const e of st.list) {
    if (!Array.isArray(e) || e.length !== 4) return false;
    const [id, type, x, y] = e;
    if (!Number.isInteger(id) || id < 1 || m.has(id) || !getStationDef(sys.reg, type) || !fin(x) || !fin(y)) return false;
    m.set(id, { id, type, x, y }); maxId = Math.max(maxId, id);
  }
  sys.placed = m; sys.next = Math.max(maxId + 1, Number.isInteger(st.next) && st.next > 0 ? st.next : 1); sys.version++;
  return true;
}
