// S051 – M3 playteszt (automata): az alapciklus egyben, két szkriptelt játékossal:
// gyűjt -> craft (állomás-feltétellel) -> trade -> teher (lassulás) -> mentés/betöltés (állapot-azonosság), 600 kockás invariánsokkal.
import { test, assert, eq } from './test-index.js';
import { createPlayer, desiredVelocity } from './game-player.js';
import { createGameClock } from './game-clock.js';
import { sanitizeField } from './game-field.js';
import { SORSKO_CONFIG, createSorsko } from './game-sorsko.js';
import { createItemRegistry } from './data-items.js';
import { createPlayerInventories, addItem, countItem, inventoryState, totalWeight } from './game-inventory.js';
import { createPlayerWallets, deposit, balance } from './game-wallet.js';
import { createSkillSystem, skillState } from './game-skills.js';
import { createProgression, charXp } from './game-curve.js';
import { createWorldStream, warmStream } from './world-stream.js';
import { createObjectStore, syncObjects } from './world-objects.js';
import { createNodeSystem, stepNodes, nodeState } from './game-nodes.js';
import { createRecipeRegistry, getRecipe, craft, craftCheck } from './game-crafting.js';
import { createStationSystem, placeStation, stationCtx, stationState } from './game-stations.js';
import { createProfessionSystem, professionState } from './game-professions.js';
import { syncEncumbrance, ENCUMBRANCE_CONFIG } from './game-encumbrance.js';
import { createTrade, tradeOpen, tradeRespond, tradeSetItem, tradeSetMoney, tradeAccept, tradeConfirm } from './game-trade.js';
import { captureSave, applySave, exportText, importSave, writeSave, loadSave } from './game-save.js';

const SEED = 12014, DT = 1 / 60;
const HOLD = { x: 0, y: 0, interact: true }, IDLE = { x: 0, y: 0, interact: false };
const clone = o => JSON.parse(JSON.stringify(o));
function storage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; }

function rig() {
  const reg = createItemRegistry();
  const ws = createWorldStream(SEED); warmStream(ws, [{ x: 0, y: 0 }]);
  const objects = createObjectStore(SEED, { cfg: { herbChance: 0.01 } }); syncObjects(objects, ws);
  return {
    reg, recipes: createRecipeRegistry(undefined, reg), ws, objects, nodes: createNodeSystem(objects, { seed: SEED }),
    players: [createPlayer(0, 100, 200), createPlayer(1, 140, 200)], clock: createGameClock(),
    sorsko: createSorsko(sanitizeField({ id: 'sorsko', x: 0, y: 0, radius: SORSKO_CONFIG.levels[0] })), seed: SEED,
    inventories: createPlayerInventories(reg), wallets: createPlayerWallets(), skills: createSkillSystem(), prog: createProgression(),
    stations: createStationSystem(), professions: createProfessionSystem(),
  };
}
function nodesOf(c, type) { const out = []; for (const ch of c.objects.chunks.values()) for (const o of ch.list) if (o.type === type) out.push(o); return out; }
// Egy node teljes kitermelése kézzel (a játékos tartja az interakciót) -> a kitermelés után eltelt kockák száma.
function harvest(c, i, o, maxFrames = 1200) {
  const tg = { kind: 'object', ref: o, action: 'gather', key: 'obj:' + o.id };
  for (let f = 0; f < maxFrames; f++) {
    const ev = stepNodes(c.nodes, c.players, [i === 0 ? HOLD : IDLE, i === 1 ? HOLD : IDLE], [i === 0 ? tg : null, i === 1 ? tg : null], c.inventories, c.clock.t, DT);
    if (ev.some(e => e.type === 'depleted' && e.id === o.id)) return f + 1;
  }
  return -1;
}
const total = (c, id) => c.inventories.reduce((a, inv) => a + countItem(inv, id), 0);
const snap = c => JSON.stringify({
  p: c.players.map(p => [p.x, p.y]), t: c.clock.t, inv: c.inventories.map(inventoryState), w: c.wallets.map(balance), s: skillState(c.skills),
  pr: [charXp(c.prog, 0), charXp(c.prog, 1)], n: nodeState(c.nodes, c.clock.t), st: stationState(c.stations), pf: professionState(c.professions),
});
function trade(c, fn) {
  const t = createTrade();
  assert(tradeOpen(t, c, 0, 1).ok, 'trade nyitás'); assert(tradeRespond(t, c, 1, true).ok, 'trade elfogadás');
  fn(t);
  tradeAccept(t, c, 0); tradeAccept(t, c, 1); tradeConfirm(t, c, 0);
  return { t, res: tradeConfirm(t, c, 1) };
}

test('M3 playteszt: gyűjtés – két játékos, kézzel, a drop az inventoryba kerül, a node kimerül és újranő', () => {
  const c = rig();
  const trees = nodesOf(c, 'tree'), stones = nodesOf(c, 'stone');
  assert(trees.length >= 3 && stones.length >= 3, 'van elég node a kezdő chunkokban');
  let woodHits = 0;
  for (let k = 0; k < 3; k++) { assert(harvest(c, 0, trees[k]) > 0, 'fa kitermelve'); woodHits++; }
  for (let k = 0; k < 3; k++) assert(harvest(c, 1, stones[k]) > 0, 'kő kitermelve');
  assert(countItem(c.inventories[0], 'wood') >= 3 * 2, 'P1 fát gyűjtött: ' + countItem(c.inventories[0], 'wood'));
  assert(countItem(c.inventories[1], 'stone') >= 3, 'P2 követ gyűjtött');
  eq(countItem(c.inventories[0], 'stone'), 0, 'a drop a gyűjtő inventoryjába megy'); eq(countItem(c.inventories[1], 'wood'), 0);
  eq(c.nodes.depleted.size, 6, 'mind a hat node kimerült'); eq(woodHits, 3);
  // újranövés a játékóra szerint
  const maxRegrow = Math.max(...[...c.nodes.depleted.values()].map(e => e.regrowAt));
  stepNodes(c.nodes, c.players, [IDLE, IDLE], [null, null], c.inventories, maxRegrow + 1, DT);
  eq(c.nodes.depleted.size, 0, 'a node-ok újranőttek');
});

test('M3 playteszt: craft – alap-szerszám kézzel, a kemencéhez munkapad kell a közelben; atomi, az anyag megmarad/fogy pontosan', () => {
  const c = rig(), inv = c.inventories[0];
  addItem(inv, 'wood', 30); addItem(inv, 'stone', 30); addItem(inv, 'fiber', 20);
  const w0 = countItem(inv, 'wood'), s0 = countItem(inv, 'stone'), f0 = countItem(inv, 'fiber');
  const axe = craft(inv, getRecipe(c.recipes, 'axe'), stationCtx(c.stations, c.players[0], null));
  assert(axe.ok, 'fejsze kézzel'); eq(countItem(inv, 'axe'), 1);
  eq(countItem(inv, 'wood'), w0 - 2); eq(countItem(inv, 'stone'), s0 - 2); eq(countItem(inv, 'fiber'), f0 - 2);
  // kemence: munkapad nélkül 'station', hiányzó anyagnál 'items', az inventory érintetlen
  const furnace = getRecipe(c.recipes, 'furnace'), before = JSON.stringify(inventoryState(inv));
  eq(craftCheck(inv, furnace, stationCtx(c.stations, c.players[0], null)).reason, 'station');
  eq(JSON.stringify(inventoryState(inv)), before, 'a sikertelen craft nem módosít');
  assert(craft(inv, getRecipe(c.recipes, 'workbench'), stationCtx(c.stations, c.players[0], null)).ok, 'munkapad kézzel');
  assert(placeStation(c.stations, inv, 'workbench', 120, 220, [], []).ok, 'munkapad lerakva');
  assert(craft(inv, furnace, stationCtx(c.stations, c.players[0], null)).ok, 'kemence a munkapad mellett');
  eq(countItem(inv, 'furnace'), 1);
  c.players[0].x = 2000; // messze: a munkapad-tag eltűnik
  eq(craftCheck(inv, getRecipe(c.recipes, 'furnace'), stationCtx(c.stations, c.players[0], null)).reason, 'station', 'távolról nem megy');
});

test('M3 playteszt: trade – tárgy + pénz atomi cseréje, az összeg megmarad, távolról és hibás ajánlatnál nincs csere', () => {
  const c = rig();
  addItem(c.inventories[0], 'axe', 1); addItem(c.inventories[0], 'wood', 10); addItem(c.inventories[1], 'stone', 20);
  deposit(c.wallets[0], 100); deposit(c.wallets[1], 50);
  const items0 = { wood: total(c, 'wood'), stone: total(c, 'stone'), axe: total(c, 'axe') }, money0 = balance(c.wallets[0]) + balance(c.wallets[1]);
  const { res } = trade(c, t => {
    assert(tradeSetItem(t, c, 0, 'axe', 1).ok, 'P1 fejszét ad'); assert(tradeSetItem(t, c, 1, 'stone', 12).ok, 'P2 követ ad');
    assert(tradeSetMoney(t, c, 1, 30).ok, 'P2 pénzt ad');
  });
  assert(res.ok, 'a csere lezárult: ' + JSON.stringify(res));
  eq(countItem(c.inventories[1], 'axe'), 1); eq(countItem(c.inventories[0], 'axe'), 0);
  eq(countItem(c.inventories[0], 'stone'), 12); eq(countItem(c.inventories[1], 'stone'), 8);
  eq(balance(c.wallets[0]), 130); eq(balance(c.wallets[1]), 20);
  for (const k of Object.keys(items0)) eq(total(c, k), items0[k], 'megmaradó mennyiség: ' + k);
  eq(balance(c.wallets[0]) + balance(c.wallets[1]), money0, 'a pénz összege megmarad');
  // túl messze: nem nyílik; hiányzó tárgy: nem kerül az ajánlatba
  c.players[1].x = c.players[0].x + 500;
  eq(tradeOpen(createTrade(), c, 0, 1).ok, false, 'távolról nincs trade');
  c.players[1].x = c.players[0].x + 40;
  const t = createTrade(); tradeOpen(t, c, 0, 1); tradeRespond(t, c, 1, true);
  eq(tradeSetItem(t, c, 0, 'wood', 999).ok, false, 'több nincs, mint amennyi van');
});

test('M3 playteszt: teher – a súly lassít, a leadás visszaadja a sebességet, a társ húzása nehezebb (p.load)', () => {
  const c = rig(), A = c.players[0];
  syncEncumbrance(c.players, c.inventories);
  const free = desiredVelocity(A, { x: 1, y: 0 }).x, load0 = A.load;
  addItem(c.inventories[0], 'stone', 99); addItem(c.inventories[0], 'stone', 99); addItem(c.inventories[0], 'stone', 99);
  assert(totalWeight(c.inventories[0]) > ENCUMBRANCE_CONFIG.capacityKg, 'a teher a kapacitás fölött');
  syncEncumbrance(c.players, c.inventories);
  const slow = desiredVelocity(A, { x: 1, y: 0 }).x;
  assert(slow < free && slow >= free * ENCUMBRANCE_CONFIG.minSpeedMul - 1e-9, `lassul, de nem áll meg: ${slow} / ${free}`);
  assert(A.load > load0, 'a megrakott társat nehezebb húzni');
  c.inventories[0].slots.fill(null); syncEncumbrance(c.players, c.inventories);
  eq(desiredVelocity(A, { x: 1, y: 0 }).x, free, 'leadás után a régi sebesség');
});

test('M3 playteszt: mentés/betöltés – szöveg-körút, localStorage-körút és hibás szöveg után is azonos állapot', () => {
  const a = rig();
  const trees = nodesOf(a, 'tree'); assert(harvest(a, 0, trees[0]) > 0); assert(harvest(a, 0, trees[1]) > 0);
  addItem(a.inventories[1], 'workbench', 1); deposit(a.wallets[0], 77); deposit(a.wallets[1], 8800);
  placeStation(a.stations, a.inventories[1], 'workbench', 300, 300, [], []);
  a.players[0].x = -123.5; a.players[1].y = 456; a.clock.t = 1440 + 333;
  const want = snap(a), text = exportText(a, 5);
  const b = rig(); // friss rendszer: üres állapot -> import után azonos
  assert(snap(b) !== want, 'a friss rendszer más');
  const r = importSave(b, text); assert(r.ok, 'import: ' + JSON.stringify(r));
  eq(snap(b), want, 'szöveg-körút azonos állapot');
  const st = storage(); writeSave(a, st, 6);
  const d = rig(); assert(loadSave(d, st).ok, 'localStorage-betöltés'); eq(snap(d), want, 'tároló-körút azonos állapot');
  // hibás szöveg: hibakód, az állapot érintetlen
  const before = snap(b);
  eq(importSave(b, text.slice(0, text.length >> 1)).ok, false, 'csonka szöveg hiba'); eq(snap(b), before, 'hiba után érintetlen');
  eq(applySave(b, { ...clone(captureSave(a, 1)), v: 99 }).ok, false, 'ismeretlen verzió hiba'); eq(snap(b), before);
});

test('M3 playteszt: 600 kocka – gyűjtés + craft + trade + mentés a közepén, invariánsok, a betöltött állapot ugyanoda jut', () => {
  const c = rig(), trees = nodesOf(c, 'tree'), stones = nodesOf(c, 'stone');
  let saved = null, ti = 0, si = 0, savedText = null;
  for (let f = 0; f < 600; f++) {
    const gather = f < 400;
    const tg0 = gather ? { kind: 'object', ref: trees[ti % trees.length], action: 'gather' } : null;
    const tg1 = gather ? { kind: 'object', ref: stones[si % stones.length], action: 'gather' } : null;
    const ev = stepNodes(c.nodes, c.players, [gather ? HOLD : IDLE, gather ? HOLD : IDLE], [tg0, tg1], c.inventories, c.clock.t, DT);
    for (const e of ev) if (e.type === 'depleted') { if (e.player === 0) ti++; else si++; }
    c.clock.t += DT; syncEncumbrance(c.players, c.inventories);
    if (f === 200) { const r = craft(c.inventories[0], getRecipe(c.recipes, 'torch'), stationCtx(c.stations, c.players[0], null)); assert(r.ok || r.reason === 'items', 'craft nem dob'); }
    if (f === 450) { deposit(c.wallets[0], 40); trade(c, t => { tradeSetMoney(t, c, 0, 25); }); }
    if (f === 300) { saved = snap(c); savedText = exportText(c, f); }
    for (const p of c.players) assert(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.speedMul), 'NaN a ' + f + '. kockában');
    for (const inv of c.inventories) for (const s of inv.slots) assert(!s || (Number.isInteger(s.n) && s.n > 0), 'sérült slot a ' + f + '. kockában');
    assert(balance(c.wallets[0]) >= 0 && balance(c.wallets[1]) >= 0, 'negatív pénz');
  }
  assert(ti + si > 0, 'a szkript kitermelt valamit');
  assert(countItem(c.inventories[0], 'wood') + countItem(c.inventories[0], 'torch') > 0, 'P1-nél van fa/fáklya');
  assert(total(c, 'stone') > 0, 'van kő');
  eq(balance(c.wallets[0]) + balance(c.wallets[1]), 40, 'a pénz összege a trade után is megmarad');
  // a 300. kockai mentés visszatölthető, és pontosan azt az állapotot adja
  const r = rig(); assert(importSave(r, savedText).ok, 'a közbülső mentés betölthető'); eq(snap(r), saved, 'a közbülső mentés azonos állapotot ad');
});
