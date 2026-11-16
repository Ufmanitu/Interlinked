// S041 tesztek: állomás-adat, validáció, felállítás/felszedés (atomi), hatótáv + TAG-ok a craftba kötve, interakció-forrás, felállítás-bemenet,
// mentés-alak, rajz/y-sort, ütközés a pórázzal, 1200 kockás smoke tárgy-megmaradással.
import { test, assert, eq } from './test-index.js';
import { createI18n, addTexts, auditTexts } from './i18n.js';
import { BASE_TEXTS } from './data-text.js';
import { ITEM_TEXTS, ITEM_TEXT_PREFIX, createItemRegistry } from './data-items.js';
import { STATION_DEFS, STATION_TEXTS } from './data-stations.js';
import { RECIPE_DEFS } from './data-recipes.js';
import { createInventory, addItem, countItem, inventoryState } from './game-inventory.js';
import { createRecipeRegistry, getRecipe, craft, craftList } from './game-crafting.js';
import { createPlayer } from './game-player.js';
import { collides } from './game-collision.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { createInteractSystem, addProvider, stepInteraction, targetOf } from './game-interact.js';
import { sortByY } from './world-objects.js';
import {
  STATION_CONFIG, validateStationDef, createStationRegistry, getStationDef, stationForItem, auditStations, createStationSystem, stationCollider, stationColliders,
  stationCount, placeSpot, canPlace, placeStation, pickUpStation, stationsNear, stationTags, stationCtx, stationProvider, stepPlaceInput, stationState, restoreStations,
} from './game-stations.js';
import { createStationSprites, visibleStations, drawStation } from './render-stations.js';

const IREG = createItemRegistry();
const RREG = createRecipeRegistry(RECIPE_DEFS, IREG);
const SREG = createStationRegistry(STATION_DEFS, IREG);
const inv = (slots = 12) => createInventory(IREG, slots);
const sys = () => createStationSystem({ reg: SREG });
const snap = v => JSON.stringify(inventoryState(v));
const D = (o = {}) => ({ id: 'bench', tag: 'MUNKAPAD', item: 'workbench', collider: { w: 20, h: 10 }, sprite: { w: 30, h: 30, ax: 15, ay: 25 }, range: 50, palette: ['#fff'], ...o });
const pl = (x = 0, y = 0) => createPlayer(0, x, y);
function fakeCtx() {
  const calls = [];
  return { calls, imageSmoothingEnabled: true, set fillStyle(v) {}, fillRect(...a) { calls.push(['r', ...a]); }, drawImage(...a) { calls.push(['i', ...a]); } };
}
const fakeCanvas = (w, h) => ({ width: w, height: h, getContext: () => fakeCtx() });

test('stations: alap-adat érvényes, tárgyak/szövegek HU/EN teljesek, minden recept-állomás létezik', () => {
  eq(SREG.errors.length, 0); eq(SREG.dups.size, 0); eq(SREG.stations.size, STATION_DEFS.length);
  eq(auditStations(SREG, IREG).length, 0);
  const i = createI18n({ lang: 'hu', texts: BASE_TEXTS, storage: null });
  addTexts(i, ITEM_TEXTS, ITEM_TEXT_PREFIX); addTexts(i, STATION_TEXTS, '');
  for (const s of SREG.stations.values()) for (const l of ['hu', 'en']) { assert(typeof i.tables[l][s.nameKey] === 'string', l + ' ' + s.nameKey); assert(typeof i.tables[l]['item.' + s.item] === 'string', l + ' item.' + s.item); }
  for (const l of ['hu', 'en']) assert(typeof i.tables[l]['act.use'] === 'string', 'act.use ' + l);
  const a = auditTexts(i); eq(a.missing.hu.length + a.missing.en.length, 0);
  const tags = new Set([...SREG.stations.values()].map(s => s.tag));
  for (const r of RREG.recipes.values()) if (r.station) assert(tags.has(r.station), 'ismeretlen állomás-TAG: ' + r.station);
  for (const s of SREG.stations.values()) { assert(IREG.items.get(s.item).tags.includes('ÁLLOMÁS'), s.item); assert(Object.isFrozen(s) && Object.isFrozen(s.collider)); assert(getRecipe(RREG, s.item), 'nincs recept: ' + s.item); }
  eq(getRecipe(RREG, 'furnace').station, 'MUNKAPAD'); eq(getRecipe(RREG, 'workbench').station, null);
});
test('stations: hibás definíciók kiesnek, nem dobnak; duplikált id/tárgy kiesik; prototípus-kulcs nem találat', () => {
  const bad = [null, 5, {}, D({ id: 'X' }), D({ id: '__proto__x' }), D({ tag: 'kicsi' }), D({ tag: 5 }), D({ tag: 'A'.repeat(25) }), D({ item: 'nincs' }), D({ item: 5 }),
    D({ collider: null }), D({ collider: { w: 0, h: 5 } }), D({ collider: { w: 5, h: NaN } }), D({ collider: { w: 999, h: 5 } }), D({ sprite: { w: 30, h: 30, ax: 40, ay: 5 } }),
    D({ sprite: { w: 30, h: 30, ax: -1, ay: 5 } }), D({ sprite: 'x' }), D({ range: 1 }), D({ range: 9999 }), D({ range: NaN })];
  for (const b of bad) assert(!validateStationDef(b, IREG).ok, JSON.stringify(b));
  const r = createStationRegistry([...bad, D({ id: 'ok' }), D({ id: 'ok', item: 'furnace' }), D({ id: 'two' })], IREG);
  eq(r.stations.size, 1); assert(r.dups.has('ok') && r.dups.has('two')); eq(r.errors.length, bad.length);
  eq(createStationRegistry('szemét', IREG).stations.size, 0);
  eq(getStationDef(SREG, 'constructor'), null); eq(getStationDef(SREG, '__proto__'), null); eq(getStationDef(null, 'furnace'), null);
  eq(stationForItem(SREG, 'toString'), null); eq(stationForItem(SREG, 'wood'), null); eq(stationForItem(SREG, 'workbench').id, 'workbench');
  assert(validateStationDef(D({ palette: 'x' }), IREG).ok, 'rossz paletta nem hiba');
});
test('stations: felállítás – a tárgy elfogy, atomi hiba (nincs tárgy / ütköző fal / másik állomás / játékos / hibás pont)', () => {
  const s = sys(), v = inv(); addItem(v, 'workbench', 2);
  eq(placeStation(s, v, 'wood', 0, 0, [], []).reason, 'type'); eq(placeStation(s, inv(), 'workbench', 0, 0, [], []).reason, 'item'); eq(placeStation(null, v, 'workbench', 0, 0).reason, 'type');
  const b = snap(v);
  eq(placeStation(s, v, 'workbench', NaN, 0, [], []).reason, 'pos'); eq(placeStation(s, v, 'workbench', 100, 100, [{ x: 90, y: 90, w: 20, h: 20 }], []).reason, 'blocked');
  eq(placeStation(s, v, 'workbench', 100, 100, [], [pl(100, 90)]).reason, 'blocked');
  eq(snap(v), b); eq(stationCount(s), 0); eq(s.version, 0);
  const r = placeStation(s, v, 'workbench', 100, 100, [], [pl(300, 300)]);
  assert(r.ok && r.station.type === 'workbench' && r.station.id === 1); eq(countItem(v, 'workbench'), 1); eq(stationCount(s), 1); eq(s.version, 1);
  eq(placeStation(s, v, 'workbench', 110, 100, [], []).reason, 'blocked'); eq(countItem(v, 'workbench'), 1);
  assert(placeStation(s, v, 'workbench', 200, 100, [], []).ok); eq(placeStation(s, v, 'workbench', 300, 100, [], []).reason, 'item');
  const c = stationColliders(s); eq(c.length, 2); eq(c[0].w, 40); eq(c[0].y, 100 - 16);
  assert(canPlace(s, 'furnace', 400, 400, [], []).ok); eq(canPlace(s, 'nincs', 0, 0).reason, 'type');
});
test('stations: maxStations korlát; érintés nem ütközés (szomszédos állomás)', () => {
  const s = sys();
  for (let i = 0; i < STATION_CONFIG.maxStations; i++) s.placed.set(i + 1, { id: i + 1, type: 'cookfire', x: i * 100, y: 0 });
  eq(canPlace(s, 'cookfire', 99999, 99999, [], []).reason, 'limit');
  const t = sys(); const v = inv(); addItem(v, 'cookfire', 2);
  assert(placeStation(t, v, 'cookfire', 100, 100, [], []).ok); assert(placeStation(t, v, 'cookfire', 124, 100, [], []).ok, 'érintő állomás lerakható');
});
test('stations: felszedés – vissza az inventoryba, nincs hely -> marad, ismeretlen id', () => {
  const s = sys(), v = inv(); addItem(v, 'furnace', 1);
  const r = placeStation(s, v, 'furnace', 50, 50, [], []); eq(countItem(v, 'furnace'), 0);
  const full = createInventory(IREG, 1); addItem(full, 'stone', 1);
  const f = pickUpStation(s, r.station.id, full); eq(f.ok, false); eq(f.reason, 'space'); eq(stationCount(s), 1); eq(s.version, 1);
  const p = pickUpStation(s, r.station.id, v); assert(p.ok); eq(p.item, 'furnace'); eq(countItem(v, 'furnace'), 1); eq(stationCount(s), 0); eq(s.version, 2);
  eq(pickUpStation(s, r.station.id, v).reason, 'missing'); eq(pickUpStation(s, 99, v).reason, 'missing'); eq(pickUpStation(null, 1, v).reason, 'missing'); eq(pickUpStation(s, 1, null).reason, 'missing');
});
test('stations: lerakási pont a játékos előtt (4 irány, hibás/nincs irány -> le)', () => {
  const p = pl(100, 100), h = p.h / 2, d = STATION_CONFIG.placeDist;
  const at = f => placeSpot(p, f);
  eq(at({ x: 1, y: 0 }).x, 100 + d); eq(at({ x: 1, y: 0 }).y, 100 + h); eq(at({ x: -1, y: 0 }).x, 100 - d); eq(at({ x: 0, y: -1 }).y, 100 + h - d); eq(at({ x: 0, y: 1 }).y, 100 + h + d);
  for (const f of [null, undefined, {}, { x: 0, y: 0 }, { x: NaN, y: NaN }]) { eq(at(f).x, 100); eq(at(f).y, 100 + h + d); }
});
test('stations: hatótáv és TAG-ok – a legközelebbi elöl, hatótávon kívül nincs TAG, hibás pont nem dob', () => {
  const s = sys(), v = inv(); addItem(v, 'workbench', 1); addItem(v, 'cookfire', 1);
  placeStation(s, v, 'workbench', 100, 100, [], []); placeStation(s, v, 'cookfire', 400, 100, [], []);
  const n = stationsNear(s, 100, 100); eq(n.length, 1); eq(n[0].def.tag, 'MUNKAPAD'); eq(n[0].dist, 0);
  eq(stationsNear(s, 100, 100 + 72).length, 1, 'a hatótáv a talp széléig számít'); eq(stationsNear(s, 100, 100 + 73).length, 0);
  eq([...stationTags(s, pl(100, 140))].join(), 'MUNKAPAD'); eq(stationTags(s, pl(250, 100)).size, 0); eq(stationTags(s, pl(330, 100)).size, 1);
  eq(stationsNear(s, NaN, 0).length, 0); eq(stationTags(s, null).size, 0); eq(stationsNear(null, 0, 0).length, 0);
  const both = sys(); const w = inv(); addItem(w, 'workbench', 1); addItem(w, 'furnace', 1);
  placeStation(both, w, 'workbench', 100, 100, [], []); placeStation(both, w, 'furnace', 150, 100, [], []);
  eq(stationTags(both, pl(125, 120)).size, 2);
});
test('stations: craft állomással – a kemence csak munkapad mellett, kézzel készülő alapok mindig; a munkapad-recept a közelében sem kell állomás', () => {
  const s = sys(), v = inv(); addItem(v, 'stone', 30); addItem(v, 'wood', 30); addItem(v, 'fiber', 10);
  const p = pl(0, 0), furnace = getRecipe(RREG, 'furnace');
  eq(craft(v, furnace, stationCtx(s, p)).reason, 'station');
  const b = craft(v, getRecipe(RREG, 'workbench'), stationCtx(s, p)); assert(b.ok && b.made.item === 'workbench');
  assert(placeStation(s, v, 'workbench', 0, 60, [], [p]).ok); eq(countItem(v, 'workbench'), 0);
  const near = craft(v, furnace, stationCtx(s, p)); assert(near.ok, near.reason); eq(countItem(v, 'furnace'), 1);
  const far = pl(500, 0); eq(craft(v, furnace, stationCtx(s, far)).reason, 'station');
  const l = craftList(RREG, v, stationCtx(s, p), 'MUNKAPAD'); eq(l.length, 1); eq(l[0].craftable, true);
  eq(craftList(RREG, v, stationCtx(s, far), 'MUNKAPAD')[0].reason, 'station');
  eq(craft(v, getRecipe(RREG, 'axe'), stationCtx(s, far)).ok, true, 'alap-szerszám kézzel');
  eq(stationCtx(null, p).stations.size, 0);
});
test('stations: interakció-forrás – a célpont az állomás, "use" akció, esemény; a prompt-horgony a sprite teteje', () => {
  const s = sys(), v = inv(); addItem(v, 'workbench', 1); placeStation(s, v, 'workbench', 100, 100, [], []);
  const it = createInteractSystem(); addProvider(it, stationProvider(s));
  const p = pl(100, 100 + 16 + 14); const ev = [];
  const idle = { x: 0, y: -1, interact: false };
  stepInteraction(it, [p, pl(900, 900)], [idle, idle], 1 / 60);
  const tg = targetOf(it, 0); assert(tg && tg.kind === 'station' && tg.action === 'use' && tg.ref.type === 'workbench', JSON.stringify(tg && tg.key));
  eq(tg.ay, 100 - 36); eq(tg.ax, 100); eq(targetOf(it, 1), null);
  const out = stepInteraction(it, [p, pl(900, 900)], [{ x: 0, y: -1, interact: true }, idle], 1 / 60); ev.push(...out);
  eq(ev.length, 1); eq(ev[0].action, 'use'); eq(ev[0].kind, 'station'); eq(ev[0].player, 0);
  const none = []; stationProvider(s)({ x: 5000, y: 5000, w: 10, h: 10 }, none, undefined); eq(none.length, 0);
  eq(stationProvider(null)({ x: 0, y: 0, w: 1, h: 1 }, none), none);
});
test('stations: felállítás-bemenet (menü nyitva, kurzor a tárgyon) – lerak, a gombnyomást elnyeli; zárt menü/fogott tárgy/más tárgy nem', () => {
  const s = sys(), v0 = inv(), v1 = inv(); addItem(v0, 'wood', 3); addItem(v0, 'cookfire', 1); addItem(v1, 'workbench', 1);
  const ui = { players: [{ wasOpen: true, mark: -1, cursor: 1 }, { wasOpen: true, mark: -1, cursor: 0 }] };
  const menus = { open: [true, true] };
  const raws = [{ ability1Pressed: true, x: 0, y: 0 }, { ability1Pressed: true, x: 0, y: 0 }];
  const players = [pl(100, 100), pl(400, 100)], facings = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  const r = stepPlaceInput(s, ui, menus, raws, [v0, v1], players, facings, []);
  eq(r.events.length, 2); eq(r.events[0].type, 'place'); eq(r.events[1].type, 'place'); eq(stationCount(s), 2); eq(countItem(v0, 'cookfire'), 0); eq(countItem(v1, 'workbench'), 0);
  eq(r.raws[0].ability1Pressed, false); eq(r.raws[1].ability1Pressed, false); eq(raws[0].ability1Pressed, true, 'az eredeti nyers bemenet érintetlen');
  const st0 = s.placed.get(1); eq(st0.x, 100 + STATION_CONFIG.placeDist); eq(st0.type, 'cookfire');
  // nem kezelt esetek: a gomb marad
  const w = inv(); addItem(w, 'wood', 1); addItem(w, 'furnace', 1);
  const U = (o = {}) => ({ players: [{ wasOpen: true, mark: -1, cursor: 1, ...o }, { wasOpen: true, mark: -1, cursor: 0 }] });
  const tryIt = (uiX, menuX, inv0 = w) => stepPlaceInput(sys(), uiX, menuX, [{ ability1Pressed: true }, {}], [inv0, inv()], players, facings, []);
  eq(tryIt(U(), { open: [false, false] }).events.length, 0); eq(tryIt(U({ mark: 0 }), menus).events.length, 0); eq(tryIt(U({ wasOpen: false }), menus).events.length, 0);
  eq(tryIt(U({ cursor: 0 }), menus).events.length, 0, 'fa nem állomás'); eq(tryIt(U({ cursor: 5 }), menus).events.length, 0, 'üres slot'); eq(tryIt(U({ cursor: 0.5 }), menus).events.length, 0);
  eq(tryIt(U(), menus).raws[0].ability1Pressed, false); eq(tryIt(U({ cursor: 0 }), menus).raws[0].ability1Pressed, true);
  // sikertelen lerakás: esemény + a gomb elnyelve, a tárgy megmarad
  const w2 = inv(); addItem(w2, 'wood', 1); addItem(w2, 'furnace', 1);
  const blocked = stepPlaceInput(sys(), U(), menus, [{ ability1Pressed: true }, {}], [w2, inv()], players, facings, [{ x: 0, y: 0, w: 9999, h: 9999 }]);
  eq(blocked.events[0].type, 'place-fail'); eq(blocked.events[0].reason, 'blocked'); eq(countItem(w2, 'furnace'), 1); eq(blocked.raws[0].ability1Pressed, false);
  for (const bad of [null, {}, { players: 5 }]) eq(stepPlaceInput(sys(), bad, menus, raws, [v0, v1], players, facings, []).events.length, 0);
  eq(stepPlaceInput(null, ui, menus, raws, [v0, v1], players, facings, []).raws, raws); eq(stepPlaceInput(sys(), ui, menus, 'x', [], [], [], []).events.length, 0);
});
test('stations: mentés-alak – körút azonos, hibás állapot atomian elutasítva, a következő id nem ütközik', () => {
  const s = sys(), v = inv(); addItem(v, 'workbench', 1); addItem(v, 'cookfire', 2);
  placeStation(s, v, 'workbench', 10, 20, [], []); placeStation(s, v, 'cookfire', 200, 20, [], []); placeStation(s, v, 'cookfire', 400, 20, [], []);
  pickUpStation(s, 2, v);
  const st = JSON.parse(JSON.stringify(stationState(s))); eq(st.list.length, 2); eq(st.v, 1);
  const t = sys(); assert(restoreStations(t, st)); eq(JSON.stringify(stationState(t)), JSON.stringify(st)); eq(t.next, 4);
  const v2 = inv(); addItem(v2, 'cookfire', 1); eq(placeStation(t, v2, 'cookfire', 600, 20, [], []).station.id, 4);
  const keep = JSON.stringify(stationState(t));
  for (const bad of [null, {}, { v: 2, list: [] }, { v: 1, list: 'x' }, { v: 1, list: [[1, 'nincs', 0, 0]] }, { v: 1, list: [[1, 'workbench', NaN, 0]] }, { v: 1, list: [[1, 'workbench', 0, 0], [1, 'workbench', 9, 9]] },
    { v: 1, list: [[0, 'workbench', 0, 0]] }, { v: 1, list: [[1, 'workbench', 0]] }, { v: 1, list: [[1.5, 'workbench', 0, 0]] }, { v: 1, list: new Array(STATION_CONFIG.maxStations + 1).fill([1, 'workbench', 0, 0]) }]) {
    eq(restoreStations(t, bad), false); eq(JSON.stringify(stationState(t)), keep);
  }
  eq(restoreStations(null, st), false);
});
test('stations: rajz – sprite-készlet, látható szűrés, y-sorrend a játékossal, hibás típus nem dob', () => {
  const rend = createStationSprites(SREG, fakeCanvas); eq(rend.sprites.size, SREG.stations.size);
  const bad = createStationSprites(createStationRegistry([D({ id: 'zzz' })], IREG), fakeCanvas); eq(bad.sprites.size, 1);
  const s = sys(), v = inv(); addItem(v, 'workbench', 1); addItem(v, 'furnace', 1);
  placeStation(s, v, 'workbench', 100, 100, [], []); placeStation(s, v, 'furnace', 3000, 100, [], []);
  const list = visibleStations(s, 0, 0, 960, 540, []); eq(list.length, 1); eq(list[0].station.type, 'workbench'); eq(list[0].y, 100);
  eq(visibleStations(s, 2900, 0, 960, 540, []).length, 1); eq(visibleStations(s, 1000, 1000, 100, 100, []).length, 0); eq(visibleStations(null, 0, 0, 1, 1, []).length, 0);
  const front = pl(100, 120), back = pl(100, 60); const all = [...list, front, back]; sortByY(all);
  eq(all[0], back); eq(all[1].station.type, 'workbench'); eq(all[2], front);
  const c = fakeCtx(); eq(drawStation(c, rend, list[0], 50, 30), true); eq(c.calls[0][0], 'i'); eq(c.calls[0][2], 50 - 24); eq(c.calls[0][3], 70 - 36);
  const c2 = fakeCtx(); eq(drawStation(c2, { sprites: new Map() }, list[0], 0, 0), false); eq(c2.calls[0][0], 'r'); eq(drawStation(fakeCtx(), null, list[0], 0, 0), false);
});
test('stations: a póráz-rendszerben a lerakott állomás fal – a játékos nem megy át rajta', () => {
  const s = sys(), v = inv(); addItem(v, 'furnace', 1); placeStation(s, v, 'furnace', 300, 100, [], []);
  const walls = stationColliders(s), a = createPlayer(0, 200, 90), b = createPlayer(1, 230, 90);
  const tether = createTetherSystem({ walls });
  const go = { x: 1, y: 0 };
  for (let f = 0; f < 300; f++) { stepTetherSystem(tether, [a, b], [go, go], 1 / 60); assert(!collides(a, walls) && !collides(b, walls), 'átfedés a ' + f + '. kockán'); }
  assert(a.x < 300 && b.x < 300, 'a fal megállítja: ' + a.x + ',' + b.x);
});
test('stations: 1200 kockás smoke – véletlen felállítás/felszedés/craft, tárgy-megmaradás, nincs átfedés, determinisztikus', () => {
  const run = () => {
    let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const s = sys(), v = inv(24); addItem(v, 'wood', 99); addItem(v, 'stone', 99); addItem(v, 'fiber', 60);
    const p = pl(0, 0), made = {}; let crafted = 0;
    for (let f = 0; f < 1200; f++) {
      const k = Math.floor(rnd() * 5);
      p.x = Math.round(rnd() * 300 - 150); p.y = Math.round(rnd() * 300 - 150);
      if (k === 0) { const r = craft(v, getRecipe(RREG, ['workbench', 'cookfire', 'furnace', 'torch'][Math.floor(rnd() * 4)]), stationCtx(s, p)); if (r.ok) { crafted++; made[r.made.item] = (made[r.made.item] || 0) + r.made.n; } }
      else if (k <= 2) { const it = ['workbench', 'cookfire', 'furnace'][Math.floor(rnd() * 3)]; const sp = placeSpot(p, { x: Math.floor(rnd() * 3) - 1, y: Math.floor(rnd() * 3) - 1 }); placeStation(s, v, it, sp.x, sp.y, [], [p]); }
      else if (k === 3 && s.placed.size) { const ids = [...s.placed.keys()]; pickUpStation(s, ids[Math.floor(rnd() * ids.length)], v); }
      else { stationTags(s, p); stationsNear(s, p.x, p.y); }
      if (v.slots.length !== 24) throw new Error('slot-szám');
      for (const sl of v.slots) if (sl && !(sl.n >= 1)) throw new Error('hibás slot');
    }
    const cs = stationColliders(s);
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      if (a.x < b.x + b.w - 1e-6 && a.x + a.w > b.x + 1e-6 && a.y < b.y + b.h - 1e-6 && a.y + a.h > b.y + 1e-6) throw new Error('átfedő állomások');
    }
    const onGround = id => [...s.placed.values()].filter(x => x.type === id).length;
    for (const id of ['workbench', 'cookfire', 'furnace']) eq(countItem(v, id) + onGround(id), made[id] || 0, 'megmaradás: ' + id);
    return JSON.stringify({ inv: snap(v), st: stationState(s), made, crafted });
  };
  const a = run(); eq(run(), a); assert(JSON.parse(a).crafted > 0, 'a smoke craftolt');
});
