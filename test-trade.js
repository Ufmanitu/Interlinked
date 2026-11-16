// S043 tesztek: trade állapotgép (game-trade); S044: trade UI (game-tradeui + render-tradeui) a végén. Node-ban fut, valódi inventory/pénztárca modulokkal; minden csere atomi és összeg-tartó.
import { test, assert, eq } from './test-index.js';
import { TRADE_CONFIG, sanitizeTradeConfig, createTrade, onTrade, tradeOpen, tradeRespond, tradeCancel, tradeSetItem, tradeSetMoney, tradeAccept, tradeUnaccept, tradeConfirm, stepTrade, checkTrade, tradeView } from './game-trade.js';
import { createPlayerInventories, createInventory, addItem, removeItem, countItem, inventoryState } from './game-inventory.js';
import { createItemRegistry } from './data-items.js';
import { createPlayerWallets, createWallet, balance, deposit } from './game-wallet.js';
import { mulberry32 } from './world-noise.js';
import { createMenus, stepMenus } from './game-hud.js';
import { createCraftUi, routeCraftInputs, stepCraftUi } from './game-craftui.js';
import { TRADEUI_TEXTS, TRADEUI_CONFIG, TRADE_REASONS, TRADE_CANCELS, sanitizeTradeUiConfig, reasonKey, cancelKey, createTradeUi, attachTradeUi, routeTradeInputs, tradeMenus, tradeTabActive, buildTradeRows, stepTradeUi, tradeUiView, tabView } from './game-tradeui.js';
import { drawTradeTabs, drawTradeOverlay, tradePanelLayout } from './render-tradeui.js';
import { createI18n, addTexts, auditTexts } from './i18n.js';

function setup(slots = 24, gap = 40) {
  const reg = createItemRegistry();
  const inventories = createPlayerInventories(reg, 2, slots);
  const wallets = createPlayerWallets(2);
  const players = [{ x: 100, y: 100 }, { x: 100 + gap, y: 100 }];
  return { ctx: { players, inventories, wallets }, t: createTrade(), inventories, wallets, players };
}
function openTrade(S) { tradeOpen(S.t, S.ctx, 0, 1); tradeRespond(S.t, S.ctx, 1, true); }
const snapAll = S => JSON.stringify([inventoryState(S.inventories[0]), inventoryState(S.inventories[1]), balance(S.wallets[0]), balance(S.wallets[1])]);
function finish(S) { tradeAccept(S.t, S.ctx, 0); tradeAccept(S.t, S.ctx, 1); tradeConfirm(S.t, S.ctx, 0); return tradeConfirm(S.t, S.ctx, 1); }

test('trade: konfig – alapértékek, szorítás, hibás mező', () => {
  eq(TRADE_CONFIG.range, 96); eq(TRADE_CONFIG.maxLines, 6);
  assert(Object.isFrozen(TRADE_CONFIG) && Object.isFrozen(sanitizeTradeConfig({})));
  eq(sanitizeTradeConfig(null).range, 96); eq(sanitizeTradeConfig({ range: NaN }).range, 96);
  eq(sanitizeTradeConfig({ range: -5 }).range, 1); eq(sanitizeTradeConfig({ maxLines: 99 }).maxLines, 24);
  eq(sanitizeTradeConfig({ maxLines: 2.9 }).maxLines, 2); eq(sanitizeTradeConfig('x').requestTimeout, 15);
});

test('trade: nyitás – távolság, foglalt, azonos játékos, hibás bemenet', () => {
  const S = setup(24, 200);
  eq(tradeOpen(S.t, S.ctx, 0, 1).reason, 'range'); eq(S.t.phase, 'idle');
  S.players[1].x = 100 + 96; eq(tradeOpen(S.t, S.ctx, 0, 1).ok, true); eq(S.t.phase, 'request');
  eq(tradeOpen(S.t, S.ctx, 1, 0).reason, 'busy');
  const T = createTrade();
  eq(tradeOpen(T, S.ctx, 0, 0).reason, 'same'); eq(tradeOpen(T, S.ctx, 0, 2).reason, 'player');
  eq(tradeOpen(T, S.ctx, '0', 1).reason, 'player'); eq(tradeOpen(T, {}, 0, 1).reason, 'player');
  S.players[1].x = NaN; eq(tradeOpen(T, S.ctx, 0, 1).reason, 'range');
  const same = { players: S.players, inventories: [S.inventories[0], S.inventories[0]], wallets: S.wallets };
  S.players[1].x = 140; eq(tradeOpen(T, same, 0, 1).reason, 'same');
});

test('trade: kérés – válasz igen/nem, rossz játékos, időtúllépés', () => {
  const S = setup();
  tradeOpen(S.t, S.ctx, 0, 1);
  eq(tradeRespond(S.t, S.ctx, 0, true).reason, 'player'); eq(S.t.phase, 'request');
  eq(tradeSetItem(S.t, S.ctx, 0, 'wood', 1).reason, 'phase');
  eq(tradeRespond(S.t, S.ctx, 1, false).ok, true); eq(S.t.phase, 'idle'); eq(S.t.last.reason, 'declined');
  tradeOpen(S.t, S.ctx, 1, 0);
  stepTrade(S.t, S.ctx, 14); eq(S.t.phase, 'request'); stepTrade(S.t, S.ctx, 1.5); eq(S.t.phase, 'idle'); eq(S.t.last.reason, 'timeout');
  eq(tradeRespond(S.t, S.ctx, 1, true).reason, 'phase');
  tradeOpen(S.t, S.ctx, 0, 1); S.players[1].x = 999;
  eq(tradeRespond(S.t, S.ctx, 1, true).reason, 'range'); eq(S.t.phase, 'idle');
});

test('trade: felajánlás – tárgy beállítás/törlés, hiány, ismeretlen, sor-határ, hibás bemenet', () => {
  const S = setup(); addItem(S.inventories[0], 'wood', 10); addItem(S.inventories[0], 'stone', 5); openTrade(S);
  eq(tradeSetItem(S.t, S.ctx, 0, 'wood', 4).ok, true); eq(S.t.offers[0].lines.length, 1);
  eq(tradeSetItem(S.t, S.ctx, 0, 'wood', 4).changed, false);
  eq(tradeSetItem(S.t, S.ctx, 0, 'wood', 10).ok, true); eq(S.t.offers[0].lines[0].n, 10);
  eq(tradeSetItem(S.t, S.ctx, 0, 'wood', 11).reason, 'have');
  eq(tradeSetItem(S.t, S.ctx, 0, 'nincs', 1).reason, 'item'); eq(tradeSetItem(S.t, S.ctx, 0, '', 1).reason, 'item'); eq(tradeSetItem(S.t, S.ctx, 0, 7, 1).reason, 'item');
  for (const n of [-1, 1.5, NaN, Infinity, '2', null, undefined]) eq(tradeSetItem(S.t, S.ctx, 0, 'wood', n).reason, 'count', String(n));
  eq(tradeSetItem(S.t, S.ctx, 2, 'wood', 1).reason, 'player'); eq(tradeSetItem(S.t, S.ctx, 1, 'wood', 1).reason, 'have');
  eq(tradeSetItem(S.t, S.ctx, 0, 'wood', 0).ok, true); eq(S.t.offers[0].lines.length, 0);
  eq(tradeSetItem(S.t, S.ctx, 0, 'wood', 0).changed, false);
  const T = createTrade({ maxLines: 1 }); tradeOpen(T, S.ctx, 0, 1); tradeRespond(T, S.ctx, 1, true);
  eq(tradeSetItem(T, S.ctx, 0, 'wood', 1).ok, true); eq(tradeSetItem(T, S.ctx, 0, 'stone', 1).reason, 'lines');
  eq(tradeSetItem(T, S.ctx, 0, 'wood', 2).ok, true);
});

test('trade: pénz felajánlás – egyenleg, hibás összeg, nincs módosítás ugyanarra', () => {
  const S = setup(); deposit(S.wallets[0], 50); openTrade(S);
  eq(tradeSetMoney(S.t, S.ctx, 0, 50).ok, true); eq(S.t.offers[0].money, 50);
  eq(tradeSetMoney(S.t, S.ctx, 0, 51).reason, 'money'); eq(tradeSetMoney(S.t, S.ctx, 1, 1).reason, 'money');
  for (const n of [-1, 0.5, NaN, '3', null, 2 ** 60]) eq(tradeSetMoney(S.t, S.ctx, 0, n).reason, 'count', String(n));
  eq(tradeSetMoney(S.t, S.ctx, 0, 50).changed, false); eq(tradeSetMoney(S.t, S.ctx, 0, 0).ok, true); eq(S.t.offers[0].money, 0);
  eq(balance(S.wallets[0]), 50);
});

test('trade: teljes menet – tárgyak és pénz cseréje mindkét irányban', () => {
  const S = setup(); addItem(S.inventories[0], 'wood', 12); addItem(S.inventories[1], 'stone', 7); deposit(S.wallets[0], 30); deposit(S.wallets[1], 30);
  const events = []; onTrade(S.t, e => events.push(e.type));
  openTrade(S);
  tradeSetItem(S.t, S.ctx, 0, 'wood', 5); tradeSetItem(S.t, S.ctx, 1, 'stone', 7); tradeSetMoney(S.t, S.ctx, 0, 10); tradeSetMoney(S.t, S.ctx, 1, 25);
  eq(tradeAccept(S.t, S.ctx, 0).ok, true); eq(S.t.phase, 'open'); eq(tradeAccept(S.t, S.ctx, 1).ok, true); eq(S.t.phase, 'confirm');
  eq(tradeConfirm(S.t, S.ctx, 0).done, false); eq(S.t.phase, 'confirm');
  eq(snapAll(S).includes('"wood"'), true); eq(countItem(S.inventories[1], 'wood'), 0);
  const r = tradeConfirm(S.t, S.ctx, 1); eq(r.done, true); eq(S.t.phase, 'idle'); eq(S.t.stats.done, 1);
  eq(countItem(S.inventories[0], 'wood'), 7); eq(countItem(S.inventories[1], 'wood'), 5);
  eq(countItem(S.inventories[0], 'stone'), 7); eq(countItem(S.inventories[1], 'stone'), 0);
  eq(balance(S.wallets[0]), 45); eq(balance(S.wallets[1]), 15);
  eq(events.join(), 'open,respond,change,change,change,change,accept,accept,confirm-phase,confirm,confirm,done');
  eq(tradeConfirm(S.t, S.ctx, 0).reason, 'phase');
});

test('trade: módosítás törli az elfogadásokat és a confirm fázis visszaesik open-re', () => {
  const S = setup(); addItem(S.inventories[0], 'wood', 9); addItem(S.inventories[1], 'stone', 9); openTrade(S);
  tradeSetItem(S.t, S.ctx, 0, 'wood', 3); tradeAccept(S.t, S.ctx, 0); eq(S.t.accepted[0], true);
  tradeSetItem(S.t, S.ctx, 1, 'stone', 1); eq(S.t.accepted[0], false); eq(S.t.accepted[1], false);
  tradeAccept(S.t, S.ctx, 0); tradeAccept(S.t, S.ctx, 1); eq(S.t.phase, 'confirm'); tradeConfirm(S.t, S.ctx, 0); eq(S.t.confirmed[0], true);
  eq(tradeSetItem(S.t, S.ctx, 0, 'wood', 4).ok, true); eq(S.t.phase, 'open'); eq(S.t.accepted.join(), 'false,false'); eq(S.t.confirmed.join(), 'false,false');
  eq(tradeConfirm(S.t, S.ctx, 1).reason, 'phase');
  tradeAccept(S.t, S.ctx, 0); tradeAccept(S.t, S.ctx, 1); tradeSetMoney(S.t, S.ctx, 0, 0); eq(S.t.phase, 'confirm');
  eq(tradeUnaccept(S.t, 1), true); eq(S.t.phase, 'open'); eq(S.t.accepted.join(), 'false,false');
  eq(tradeUnaccept(S.t, 1), false); eq(tradeUnaccept(S.t, 5), false);
  assert(countItem(S.inventories[0], 'wood') === 9 && countItem(S.inventories[1], 'stone') === 9, 'nincs csere');
});

test('trade: üres trade nem fogadható el; egyoldalú ajándék igen; egy fél nem zárja le egyedül', () => {
  const S = setup(); addItem(S.inventories[0], 'wood', 2); openTrade(S);
  eq(tradeAccept(S.t, S.ctx, 0).reason, 'empty'); eq(tradeAccept(S.t, S.ctx, 9).reason, 'player');
  tradeSetItem(S.t, S.ctx, 0, 'wood', 2);
  tradeAccept(S.t, S.ctx, 0); eq(S.t.phase, 'open'); eq(tradeAccept(S.t, S.ctx, 0).changed, false);
  eq(tradeConfirm(S.t, S.ctx, 0).reason, 'phase');
  tradeAccept(S.t, S.ctx, 1); tradeConfirm(S.t, S.ctx, 0); tradeConfirm(S.t, S.ctx, 0); eq(S.t.phase, 'confirm'); eq(countItem(S.inventories[1], 'wood'), 0);
  eq(tradeConfirm(S.t, S.ctx, 1).done, true); eq(countItem(S.inventories[1], 'wood'), 2); eq(countItem(S.inventories[0], 'wood'), 0);
});

test('trade: nincs hely a fogadónál – atomi bukás, semmi nem változik, open-re esik', () => {
  const S = setup(2); addItem(S.inventories[0], 'wood', 3); addItem(S.inventories[1], 'stone', 1); addItem(S.inventories[1], 'fiber', 1); openTrade(S);
  tradeSetItem(S.t, S.ctx, 0, 'wood', 3);
  eq(tradeAccept(S.t, S.ctx, 0).reason, 'space'); eq(checkTrade(S.t, S.ctx).reason, 'space');
  const before = snapAll(S);
  S.t.accepted = [true, true]; S.t.phase = 'confirm'; // kényszerített állapot: a csere-kor ellenőrzés is véd
  tradeConfirm(S.t, S.ctx, 0); const r = tradeConfirm(S.t, S.ctx, 1);
  eq(r.reason, 'space'); eq(r.done, false); eq(S.t.phase, 'open'); eq(snapAll(S), before); eq(S.t.stats.failed, 1); eq(S.t.last.result, 'fail');
  tradeSetItem(S.t, S.ctx, 1, 'stone', 1); eq(checkTrade(S.t, S.ctx).ok, true, 'a fogadó saját felajánlása helyet szabadít');
  eq(finish(S).done, true); eq(countItem(S.inventories[0], 'stone'), 1); eq(countItem(S.inventories[1], 'wood'), 3);
});

test('trade: pénz-plafon és hiányzó pénz a csere pillanatában – atomi bukás', () => {
  const S = setup(); S.wallets[1] = createWallet(0, { max: 100 }); S.ctx.wallets[1] = S.wallets[1]; deposit(S.wallets[0], 500); deposit(S.wallets[1], 90); openTrade(S);
  tradeSetMoney(S.t, S.ctx, 0, 50);
  eq(tradeAccept(S.t, S.ctx, 0).reason, 'money'); eq(balance(S.wallets[0]), 500); eq(balance(S.wallets[1]), 90);
  tradeSetMoney(S.t, S.ctx, 0, 10); tradeAccept(S.t, S.ctx, 0); tradeAccept(S.t, S.ctx, 1); tradeConfirm(S.t, S.ctx, 0);
  S.wallets[0].coins = 3; // a fél közben elköltött
  const before = snapAll(S); const r = tradeConfirm(S.t, S.ctx, 1);
  eq(r.reason, 'money'); eq(snapAll(S), before); eq(S.t.phase, 'open');
});

test('trade: a felajánlott tárgy közben elfogy -> lépés levágja, törli az elfogadásokat; a csere-kori hiány sem enged', () => {
  const S = setup(); addItem(S.inventories[0], 'wood', 6); deposit(S.wallets[0], 20); openTrade(S);
  tradeSetItem(S.t, S.ctx, 0, 'wood', 6); tradeSetMoney(S.t, S.ctx, 0, 20); tradeAccept(S.t, S.ctx, 0);
  removeItem(S.inventories[0], 'wood', 4); S.wallets[0].coins = 8;
  stepTrade(S.t, S.ctx, 1 / 60);
  eq(S.t.offers[0].lines[0].n, 2); eq(S.t.offers[0].money, 8); eq(S.t.accepted[0], false);
  removeItem(S.inventories[0], 'wood', 2); stepTrade(S.t, S.ctx, 1 / 60); eq(S.t.offers[0].lines.length, 0);
  stepTrade(S.t, S.ctx, 1 / 60); eq(S.t.version, S.t.version);
  addItem(S.inventories[0], 'wood', 3); tradeSetItem(S.t, S.ctx, 0, 'wood', 3); tradeAccept(S.t, S.ctx, 0); tradeAccept(S.t, S.ctx, 1); tradeConfirm(S.t, S.ctx, 0);
  removeItem(S.inventories[0], 'wood', 3); const before = snapAll(S);
  eq(tradeConfirm(S.t, S.ctx, 1).reason, 'items'); eq(snapAll(S), before); eq(S.t.phase, 'open');
});

test('trade: távolság – lépés megszakít, csere-kor is; hibás pozíció megszakít', () => {
  const S = setup(); addItem(S.inventories[0], 'wood', 2); openTrade(S); tradeSetItem(S.t, S.ctx, 0, 'wood', 1);
  S.players[1].x = 100 + 96; stepTrade(S.t, S.ctx, 0.1); eq(S.t.phase, 'open');
  S.players[1].x = 100 + 96.5; stepTrade(S.t, S.ctx, 0.1); eq(S.t.phase, 'idle'); eq(S.t.last.reason, 'range'); eq(countItem(S.inventories[0], 'wood'), 2);
  S.players[1].x = 140; openTrade(S); tradeSetItem(S.t, S.ctx, 0, 'wood', 1); tradeAccept(S.t, S.ctx, 0); tradeAccept(S.t, S.ctx, 1); tradeConfirm(S.t, S.ctx, 0);
  S.players[1].x = 400; const r = tradeConfirm(S.t, S.ctx, 1); eq(r.reason, 'range'); eq(S.t.phase, 'idle'); eq(countItem(S.inventories[1], 'wood'), 0);
  S.players[1].x = 140; openTrade(S); S.players[0].y = NaN; stepTrade(S.t, S.ctx, 0.1); eq(S.t.phase, 'idle');
});

test('trade: megszakítás bármikor, események, hibázó figyelő nem állít meg, leiratkozás', () => {
  const S = setup(); addItem(S.inventories[0], 'wood', 2);
  eq(tradeCancel(S.t, 0), false);
  const got = []; onTrade(S.t, () => { throw new Error('rossz figyelő'); }); const off = onTrade(S.t, e => got.push(e.type + (e.reason ? ':' + e.reason : '')));
  onTrade(S.t, 'nem fv')(); tradeOpen(S.t, S.ctx, 1, 0); eq(tradeCancel(S.t, 5), false); eq(tradeCancel(S.t, 0, 'cancel'), true); eq(S.t.phase, 'idle');
  tradeOpen(S.t, S.ctx, 0, 1); tradeRespond(S.t, S.ctx, 1, true); tradeSetItem(S.t, S.ctx, 0, 'wood', 1); tradeAccept(S.t, S.ctx, 0); tradeAccept(S.t, S.ctx, 1);
  eq(tradeCancel(S.t, 1, 'x'), true); eq(S.t.last.was, 'confirm'); eq(countItem(S.inventories[0], 'wood'), 2);
  eq(got.join(), 'open,cancel:cancel,open,respond,change,accept,accept,confirm-phase,cancel:x'); assert(S.t.lastError === 'rossz figyelő');
  off(); tradeOpen(S.t, S.ctx, 0, 1); eq(got.length, 9); eq(S.t.stats.cancelled, 2);
});

test('trade: tradeView – két oldal, állapotok, kívülálló', () => {
  const S = setup(); addItem(S.inventories[0], 'wood', 3); deposit(S.wallets[1], 9); openTrade(S);
  tradeSetItem(S.t, S.ctx, 0, 'wood', 2); tradeSetMoney(S.t, S.ctx, 1, 9); tradeAccept(S.t, S.ctx, 1);
  const v0 = tradeView(S.t, 0), v1 = tradeView(S.t, 1);
  eq(v0.phase, 'open'); eq(v0.initiator, true); eq(v1.initiator, false); eq(v0.partner, 1); eq(v1.partner, 0);
  eq(v0.mine.lines[0].n, 2); eq(v0.theirs.money, 9); eq(v0.theirs.accepted, true); eq(v0.mine.accepted, false); eq(v1.mine.money, 9); eq(v1.theirs.lines[0].id, 'wood');
  v0.mine.lines[0].n = 99; eq(S.t.offers[0].lines[0].n, 2, 'a nézet másolat');
  const x = tradeView(S.t, 7); eq(x.mine, null); eq(x.theirs, null); eq(x.partner, -1);
  eq(tradeView(createTrade(), 0).phase, 'idle');
});

function fuzzRun(seed, steps) {
  const S = setup(8), rnd = mulberry32(seed), IDS = ['wood', 'stone', 'fiber'];
  addItem(S.inventories[0], 'wood', 40); addItem(S.inventories[1], 'stone', 40); addItem(S.inventories[1], 'fiber', 10); deposit(S.wallets[0], 300); deposit(S.wallets[1], 120);
  const total = () => IDS.map(id => countItem(S.inventories[0], id) + countItem(S.inventories[1], id)).join() + '|' + (balance(S.wallets[0]) + balance(S.wallets[1]));
  const start = total(); let done = 0;
  for (let i = 0; i < steps; i++) {
    const p = rnd() < 0.5 ? 0 : 1, r = rnd(), id = IDS[Math.floor(rnd() * 3)];
    if (r < 0.1) tradeOpen(S.t, S.ctx, p, 1 - p);
    else if (r < 0.2) tradeRespond(S.t, S.ctx, p, rnd() < 0.8);
    else if (r < 0.45) tradeSetItem(S.t, S.ctx, p, id, Math.floor(rnd() * 8) - (rnd() < 0.05 ? 3 : 0));
    else if (r < 0.55) tradeSetMoney(S.t, S.ctx, p, Math.floor(rnd() * 200));
    else if (r < 0.72) tradeAccept(S.t, S.ctx, p);
    else if (r < 0.86) { if (tradeConfirm(S.t, S.ctx, p).done) done++; }
    else if (r < 0.87) tradeUnaccept(S.t, p);
    else if (r < 0.885) tradeCancel(S.t, p);
    else if (r < 0.93) { if (removeItem(S.inventories[p], id, 1) && addItem(S.inventories[1 - p], id, 1) > 0) addItem(S.inventories[p], id, 1); }
    else if (r < 0.96) S.players[1].x = 100 + (rnd() < 0.9 ? 40 : 40 + Math.floor(rnd() * 160));
    else stepTrade(S.t, S.ctx, rnd());
    assert(total() === start, 'összeg-tartás megsérült a ' + i + '. lépésben: ' + total() + ' <> ' + start);
    for (const w of S.wallets) assert(Number.isSafeInteger(w.coins) && w.coins >= 0, 'pénztárca');
    for (const inv of S.inventories) for (const s of inv.slots) assert(s === null || (s.n >= 1 && Number.isInteger(s.n)), 'slot');
    if (S.t.phase === 'confirm') assert(S.t.accepted[0] && S.t.accepted[1], 'confirm csak két elfogadással');
    if (S.t.phase === 'idle') assert(S.t.offers.every(o => o.lines.length === 0 && o.money === 0), 'idle: üres felajánlás');
    for (const o of S.t.offers) assert(o.lines.length <= S.t.cfg.maxLines && o.lines.every(l => l.n > 0), 'felajánlás-invariáns');
  }
  return { state: snapAll(S), done, stats: S.t.stats, version: S.t.version };
}

test('trade: 20000 lépéses fuzz – tárgy- és pénz-összeg tartása, fázis-invariánsok, determinizmus', () => {
  const a = fuzzRun(4301, 20000), b = fuzzRun(4301, 20000);
  eq(JSON.stringify(a), JSON.stringify(b)); assert(a.done > 5, 'a fuzz végigvitt cseréket: ' + a.done);
  assert(a.stats.cancelled > 5 && a.stats.failed >= 0, 'megszakítások is voltak');
  assert(JSON.stringify(fuzzRun(4302, 5000)) !== JSON.stringify(a), 'más mag más futás');
});

test('trade: hibás kontextus nem dob (hiányzó inventory/pénztárca/játékos)', () => {
  const T = createTrade(); const S = setup();
  for (const c of [null, undefined, {}, { players: S.players }, { players: S.players, inventories: S.inventories }, { players: S.players, inventories: [createInventory(), null], wallets: S.wallets }]) {
    eq(tradeOpen(T, c, 0, 1).ok, false); stepTrade(T, c, 1); eq(checkTrade(T, c).ok, false);
  }
  tradeOpen(T, S.ctx, 0, 1); tradeRespond(T, S.ctx, 1, true);
  for (const c of [null, {}, { players: S.players }]) { eq(tradeSetItem(T, c, 0, 'wood', 1).ok, false); eq(tradeSetMoney(T, c, 0, 1).ok, false); eq(tradeAccept(T, c, 0).ok, false); }
  stepTrade(T, null, 1); eq(T.phase, 'idle');
});

test('trade: a pénz módosítása is törli az elfogadásokat (és confirm -> open)', () => {
  const S = setup(); addItem(S.inventories[0], 'wood', 2); deposit(S.wallets[1], 40); openTrade(S);
  tradeSetItem(S.t, S.ctx, 0, 'wood', 1); tradeAccept(S.t, S.ctx, 0); eq(S.t.accepted[0], true);
  tradeSetMoney(S.t, S.ctx, 1, 5); eq(S.t.accepted.join(), 'false,false');
  tradeAccept(S.t, S.ctx, 0); tradeAccept(S.t, S.ctx, 1); eq(S.t.phase, 'confirm');
  tradeSetMoney(S.t, S.ctx, 1, 6); eq(S.t.phase, 'open'); eq(S.t.accepted.join(), 'false,false'); eq(S.t.confirmed.join(), 'false,false');
});

// ---- S044: trade UI (a main.js bekötését követő harness) ----
const P = o => ({ x: 0, y: 0, interact: false, ability1: false, ability2: false, menu: false, interactPressed: false, ability1Pressed: false, ability2Pressed: false, menuPressed: false, ...o });
const idle = () => [P(), P()];
function UI(slots = 24, gap = 40) { const S = setup(slots, gap); const U = { S, tu: createTradeUi(), cs: createCraftUi({ recipes: null }), menus: createMenus() }; attachTradeUi(U.tu, S.t); return U; }
function frame(U, raws, dt = 1 / 60) {
  const route = routeCraftInputs(U.cs, U.menus, routeTradeInputs(U.tu, U.S.t, U.cs, U.menus, raws));
  const inputs = stepMenus(U.menus, route.menu);
  stepCraftUi(U.cs, U.menus, raws, U.S.inventories, dt);
  const ev = stepTradeUi(U.tu, U.S.t, U.S.ctx, U.menus, raws, dt); stepTrade(U.S.t, U.S.ctx, dt);
  return { route, inputs, ev };
}
const rawOf = (i, o) => (i === 0 ? [P(o), P()] : [P(), P(o)]);
function press(U, i, o) { const r = frame(U, rawOf(i, o)); frame(U, idle()); frame(U, idle()); return r; }
function hold(U, i, o, sec) { for (let k = 0; k < Math.round(sec * 60); k++) frame(U, rawOf(i, o)); frame(U, idle()); }
const PRESS = { interact: true, interactPressed: true };
function tabTrade(U, i = 0) { for (let k = 0; k < 3; k++) press(U, i, { menuPressed: true }); }
function startTrade(U) { tabTrade(U); press(U, 0, PRESS); press(U, 1, PRESS); frame(U, idle()); }
const offerOf = (U, p) => U.S.t.offers[p].lines.map(l => l.id + l.n).join();

test('tradeui: szövegek HU/EN azonos paraméterekkel, minden ok-kulcs megvan, konfig szorítás', () => {
  const i = createI18n({ lang: 'hu', storage: { getItem() { return null; }, setItem() {} } }); addTexts(i, TRADEUI_TEXTS, 'trade.');
  const a = auditTexts(i); assert(a.ok, 'audit: ' + JSON.stringify(a));
  for (const r of [...TRADE_REASONS, 'other']) assert(TRADEUI_TEXTS.hu['r.' + r] && TRADEUI_TEXTS.en['r.' + r], 'ok: ' + r);
  for (const r of TRADE_CANCELS) assert(TRADEUI_TEXTS.hu['ev.' + r] && TRADEUI_TEXTS.en['ev.' + r], 'cancel: ' + r);
  eq(reasonKey('range'), 'trade.r.range'); eq(reasonKey('???'), 'trade.r.other'); eq(cancelKey('timeout'), 'trade.ev.timeout'); eq(cancelKey(undefined), 'trade.ev.cancel');
  const c = sanitizeTradeUiConfig({ visibleRows: 2.9, deadzone: 5, accel1: 3, accel2: 1, flash: -1, confirmLock: NaN });
  eq(c.visibleRows, 2); eq(c.deadzone, 0.95); eq(c.accel2, 3); eq(c.flash, TRADEUI_CONFIG.flash); eq(c.confirmLock, TRADEUI_CONFIG.confirmLock); assert(Object.isFrozen(c));
});

test('tradeui: menü-körforgás inv -> craft -> trade -> zár; a panelek elrejtése; a kérés előtt nincs trade', () => {
  const U = UI(); const M = U.menus;
  press(U, 0, { menuPressed: true }); assert(M.open[0] && U.tu.players[0].tab === 'inv' && U.cs.players[0].tab === 'inv');
  press(U, 0, { menuPressed: true }); eq(U.cs.players[0].tab, 'craft'); assert(M.open[0]);
  press(U, 0, { menuPressed: true }); assert(M.open[0] && tradeTabActive(U.tu, M, 0), 'trade fül'); eq(U.cs.players[0].tab, 'inv');
  eq(tradeMenus(U.tu, U.S.t, M).open[0], false, 'a trade fülön a menü-váz elrejtve'); assert(!tradeTabActive(U.tu, M, 1));
  const r = frame(U, [P({ x: 1, interact: true }), P({ x: 1 })]); eq(r.inputs[0].x, 0, 'a trade fülön áll'); eq(r.inputs[1].x, 1, 'a társ mozog');
  press(U, 0, { menuPressed: true }); eq(M.open[0], false, 'a 4. nyomás zár'); eq(U.tu.players[0].tab, 'inv'); eq(U.cs.players[0].tab, 'inv'); eq(U.S.t.phase, 'idle');
  press(U, 0, { menuPressed: true }); eq(U.cs.players[0].tab, 'inv'); press(U, 0, { menuPressed: true }); eq(U.cs.players[0].tab, 'craft', 'újrakezdés inventory-ról');
});

test('tradeui: kérés a trade fülről – távolság, zárt menü, foglalt; az elutasítás/visszavonás/időtúllépés üzenete', () => {
  const U = UI(24, 300); tabTrade(U); const ps = U.tu.players[0];
  let v = tabView(U.tu, U.S.t, U.S.ctx, U.menus, 0); eq(v.inRange, false); eq(v.max, 3); assert(v.dist > 9);
  const r = press(U, 0, PRESS); eq(U.S.t.phase, 'idle'); eq(ps.flash.reason, 'range'); eq(r.ev[0].type, 'open-fail'); eq(tabView(U.tu, U.S.t, U.S.ctx, U.menus, 0).flash.reason, 'range');
  eq(tabView(U.tu, U.S.t, U.S.ctx, U.menus, 1), null, 'a társ menüje zárva');
  U.S.players[1].x = 100 + 40; press(U, 0, PRESS); eq(U.S.t.phase, 'request'); eq(U.S.t.from, 0); eq(tabView(U.tu, U.S.t, U.S.ctx, U.menus, 0).busy, true);
  const rt = routeTradeInputs(U.tu, U.S.t, U.cs, U.menus, [P({ interactPressed: true, ability2Pressed: true, x: 1 }), P({ interactPressed: true, interact: true, ability2Pressed: true, menuPressed: true, x: 1 })]);
  for (const k of [0, 1]) { assert(!rt[k].interactPressed && !rt[k].ability2Pressed && !rt[k].menuPressed, 'a kérés gombjait elnyeli'); eq(rt[k].x, 1, 'a mozgás marad'); }
  press(U, 1, { ability2Pressed: true }); eq(U.S.t.phase, 'idle'); eq(U.tu.toast.key, 'trade.ev.declined'); eq(U.S.t.last.reason, 'declined');
  press(U, 0, PRESS); press(U, 0, { ability2Pressed: true }); eq(U.S.t.phase, 'idle'); eq(U.tu.toast.key, 'trade.ev.cancel');
  press(U, 0, PRESS); for (let k = 0; k < 60 * 16; k++) frame(U, idle()); eq(U.S.t.phase, 'idle'); eq(U.tu.toast.key, 'trade.ev.timeout'); for (let k = 0; k < 60 * 3; k++) frame(U, idle()); eq(U.tu.toast, null, 'a villanás lejár'); eq(U.S.t.last.reason, 'timeout');
  press(U, 0, PRESS); frame(U, idle()); eq(tradeUiView(U.tu, U.S.t, U.S.ctx).secs, 15); eq(U.S.t.phase, 'request'); press(U, 1, PRESS); eq(U.S.t.phase, 'open');
});

test('tradeui: két kurzor – tárgy-választás, db (tartva gyorsul), túl sok sor, párhuzamos szerkesztés', () => {
  const U = UI(); const [a, b] = U.S.inventories; addItem(a, 'wood', 10); addItem(a, 'stone', 5); addItem(b, 'fiber', 3); startTrade(U);
  eq(U.S.t.phase, 'open'); eq(buildTradeRows(a, U.S.t.offers[0]).map(r => r.id).join(), 'wood,stone');
  press(U, 0, { x: 1 }); eq(offerOf(U, 0), 'wood1'); press(U, 0, { x: 1 }); eq(offerOf(U, 0), 'wood2');
  press(U, 0, { y: 1 }); press(U, 0, { x: 1 }); eq(offerOf(U, 0), 'wood2,stone1'); eq(U.tu.players[0].cursor, 1);
  press(U, 1, { x: 1 }); eq(offerOf(U, 1), 'fiber1', 'a társ kurzora független');
  hold(U, 0, { y: -1 }, 0.1); hold(U, 0, { x: 1 }, 1.5); eq(offerOf(U, 0), 'wood10,stone1', 'a tartás gyorsul, a db a készletre szorul');
  hold(U, 0, { x: -1 }, 1.5); eq(offerOf(U, 0), 'stone1', 'a 0-ra csökkentett sor kiesik');
  const T = U.S.t; T.cfg = Object.freeze({ ...T.cfg, maxLines: 1 }); press(U, 0, { y: -1 }); press(U, 0, { y: -1 }); press(U, 0, { x: 1 });
  eq(U.tu.players[0].flash.reason, 'lines'); eq(tradeUiView(U.tu, T, U.S.ctx).sides[0].status.key, 'trade.r.lines');
  eq(U.S.t.accepted.join(), 'false,false'); press(U, 0, PRESS); eq(T.accepted[0], true); press(U, 1, { x: 1 }); eq(T.accepted[0], false, 'módosítás törli az elfogadást');
});

test('tradeui: pénz mód – váltás, ±1/±10, tartva gyorsul, plafon az egyenlegnél', () => {
  const U = UI(); deposit(U.S.wallets[0], 500); startTrade(U); const ps = U.tu.players[0];
  press(U, 0, { x: 1 }); eq(U.S.t.offers[0].money, 0, 'tárgy módban nincs pénz-változás');
  press(U, 0, { ability1Pressed: true }); eq(ps.mode, 'money'); press(U, 0, { x: 1 }); eq(U.S.t.offers[0].money, 1);
  press(U, 0, { y: -1 }); eq(U.S.t.offers[0].money, 11); press(U, 0, { y: 1 }); press(U, 0, { x: -1 }); eq(U.S.t.offers[0].money, 0);
  press(U, 0, { x: -1 }); eq(U.S.t.offers[0].money, 0, 'nem megy 0 alá');
  hold(U, 0, { x: 1 }, 6); eq(U.S.t.offers[0].money, 500, 'az egyenleg a plafon'); eq(balance(U.S.wallets[0]), 500, 'a pénz csak a csere után mozdul');
  const side = tradeUiView(U.tu, U.S.t, U.S.ctx).sides[0]; eq(side.mode, 'money'); eq(side.balance, 500);
  press(U, 0, { ability1Pressed: true }); eq(ps.mode, 'item');
});

test('tradeui: teljes menet – elfogad, confirm-zár (nincs véletlen dupla nyomás), végső megerősítés, csere + üzenet', () => {
  const U = UI(); const [a, b] = U.S.inventories; addItem(a, 'wood', 5); addItem(b, 'stone', 4); deposit(U.S.wallets[1], 40); startTrade(U);
  hold(U, 0, { x: 1 }, 1.5); hold(U, 1, { x: 1 }, 1.5); press(U, 1, { ability1Pressed: true }); hold(U, 1, { x: 1 }, 0.5);
  const m = U.S.t.offers[1].money; assert(m > 0 && m <= 40); eq(offerOf(U, 0), 'wood5'); eq(offerOf(U, 1), 'stone4');
  press(U, 0, PRESS); eq(U.S.t.phase, 'open'); eq(tradeUiView(U.tu, U.S.t, U.S.ctx).sides[0].status.key, 'trade.status.accepted'); eq(tradeUiView(U.tu, U.S.t, U.S.ctx).sides[1].status.key, 'trade.status.theirs');
  press(U, 0, PRESS); eq(U.S.t.phase, 'open', 'ugyanazt kétszer elfogadni nem számít a társ elfogadásának');
  press(U, 1, PRESS); eq(U.S.t.phase, 'confirm'); eq(tradeUiView(U.tu, U.S.t, U.S.ctx).sides[0].status.key, 'trade.status.confirm');
  frame(U, [P(PRESS), P(PRESS)]); eq(U.S.t.confirmed.join(), 'false,false', 'a zár alatt a megerősítés nem megy');
  for (let k = 0; k < 40; k++) frame(U, idle());
  press(U, 0, PRESS); eq(U.S.t.confirmed.join(), 'true,false'); eq(tradeUiView(U.tu, U.S.t, U.S.ctx).sides[0].status.key, 'trade.status.confirmed');
  assert(countItem(a, 'wood') === 5, 'a csere még nem futott'); press(U, 1, PRESS);
  eq(U.S.t.phase, 'idle'); eq(countItem(a, 'wood'), 0); eq(countItem(b, 'wood'), 5); eq(countItem(a, 'stone'), 4); eq(countItem(b, 'stone'), 0);
  eq(balance(U.S.wallets[0]), m); eq(balance(U.S.wallets[1]), 40 - m); eq(U.tu.toast.key, 'trade.ev.done'); assert(U.tu.toast.ok);
});

test('tradeui: 2. képesség – elfogadás visszavonása, majd mégse; üres elfogadás hibája; a távolság megszakít; nyitott trade alatt a karakter áll', () => {
  const U = UI(); addItem(U.S.inventories[0], 'wood', 3); startTrade(U);
  press(U, 0, PRESS); eq(U.tu.players[0].flash.reason, 'empty'); eq(tradeUiView(U.tu, U.S.t, U.S.ctx).sides[0].status.key, 'trade.r.empty');
  press(U, 0, { x: 1 }); press(U, 0, PRESS); eq(U.S.t.accepted[0], true); press(U, 0, { ability2Pressed: true }); eq(U.S.t.accepted[0], false); eq(U.S.t.phase, 'open');
  press(U, 0, { ability2Pressed: true }); eq(U.S.t.phase, 'idle'); eq(U.tu.toast.key, 'trade.ev.cancel'); eq(countItem(U.S.inventories[0], 'wood'), 3);
  press(U, 0, PRESS); press(U, 1, PRESS); frame(U, idle()); eq(U.S.t.phase, 'open'); const r = frame(U, [P({ x: 1, y: 1 }), P({ x: -1 })]);
  eq(r.route.menu[0].x, 0); eq(r.route.menu[1].x, 0); eq(r.route.inv[1].x, 0, 'nyitott trade: üres bemenet');
  U.S.players[1].x = 900; frame(U, idle()); eq(U.S.t.phase, 'idle'); eq(U.tu.toast.key, 'trade.ev.range');
});

test('tradeui: a nem megvalósítható csere jelzése mindkét panelen (nincs hely), a megoldás után eltűnik', () => {
  const U = UI(2); const [a, b] = U.S.inventories; addItem(a, 'wood', 3); addItem(b, 'stone', 1); addItem(b, 'fiber', 1); startTrade(U);
  press(U, 0, { x: 1 }); const v = tradeUiView(U.tu, U.S.t, U.S.ctx);
  eq(v.sides[0].status.key, 'trade.r.space'); eq(v.sides[1].status.key, 'trade.r.space'); eq(v.sides[0].status.kind, 'warn');
  press(U, 1, { x: 1 }); eq(tradeUiView(U.tu, U.S.t, U.S.ctx).sides[1].status.key, 'trade.status.open', 'a fogadó saját felajánlása helyet szabadít');
});

test('tradeui: rajz – trade fül, kérés-sáv, két panel, üzenet; a képen belül, nyelvi kulcsokkal', () => {
  const U = UI(); addItem(U.S.inventories[0], 'wood', 3); const players = [{ color: '#58f' }, { color: '#f55' }];
  const tr = (k, p) => k + (p ? JSON.stringify(p) : '');
  const txt = c => c.calls.filter(x => x[0] === 'fillText').map(x => String(x[1])).join('|');
  let c = fakeCtx(); eq(drawTradeTabs(c, U.tu, U.S.t, U.S.ctx, U.menus, players, 960, 540, tr), 0); eq(drawTradeOverlay(fakeCtx(), U.tu, U.S.t, U.S.ctx, 960, 540, tr), 0);
  tabTrade(U); c = fakeCtx(); eq(drawTradeTabs(c, U.tu, U.S.t, U.S.ctx, U.menus, players, 960, 540, tr), 1); assert(txt(c).includes('trade.tab.partner') && txt(c).includes('trade.tab.go'));
  press(U, 0, PRESS); c = fakeCtx(); eq(drawTradeOverlay(c, U.tu, U.S.t, U.S.ctx, 960, 540, tr), 1); assert(txt(c).includes('trade.req') && txt(c).includes('trade.req.to'));
  press(U, 1, PRESS); press(U, 0, { x: 1 }); press(U, 0, PRESS);
  c = fakeCtx(); eq(drawTradeOverlay(c, U.tu, U.S.t, U.S.ctx, 960, 540, tr), 2);
  const s = txt(c); for (const k of ['trade.player', 'item.wood', 'trade.badge.accepted', 'trade.status.accepted', 'trade.hint1', 'trade.hint2']) assert(s.includes(k), k);
  for (const i of [0, 1]) { const L = tradePanelLayout(i, 960, 540); assert(L.x >= 0 && L.y >= 0 && L.x + L.w <= 960 && L.y + L.h <= 540, 'a képen belül'); }
  assert(tradePanelLayout(1, 960, 540).x >= tradePanelLayout(0, 960, 540).x + 300, 'P2 jobbra');
  press(U, 0, { ability1Pressed: true }); assert(txt((c = fakeCtx(), drawTradeOverlay(c, U.tu, U.S.t, U.S.ctx, 960, 540, tr), c)).includes('trade.moneyMode'));
  press(U, 0, { ability2Pressed: true }); press(U, 0, { ability2Pressed: true }); c = fakeCtx(); eq(drawTradeOverlay(c, U.tu, U.S.t, U.S.ctx, 960, 540, tr), 1, 'csak az üzenet'); assert(txt(c).includes('trade.ev.cancel'));
  eq(drawTradeOverlay(fakeCtx(), U.tu, U.S.t, U.S.ctx, 960, 540), 1, 'alap t()-vel sem dob');
});

test('tradeui: hibás bemenet nem dob; 5000 kockás fuzz – tárgy- és pénz-összeg tartása, érvényes fázisok', () => {
  const U = UI(); for (const k of [() => frame(U, null), () => frame(U, [null, undefined]), () => stepTradeUi(U.tu, U.S.t, {}, null, null, NaN), () => tradeUiView(U.tu, U.S.t, {}), () => tabView(U.tu, U.S.t, {}, U.menus, 0), () => buildTradeRows(null, null), () => routeTradeInputs(U.tu, U.S.t, null, null, null)]) k();
  const F = UI(8); const rnd = mulberry32(44); const [a, b] = F.S.inventories; addItem(a, 'wood', 30); addItem(a, 'stone', 12); addItem(b, 'fiber', 20); addItem(b, 'wood', 5); deposit(F.S.wallets[0], 300); deposit(F.S.wallets[1], 120);
  const total = () => ['wood', 'stone', 'fiber'].map(id => countItem(a, id) + countItem(b, id)).join() + '|' + (balance(F.S.wallets[0]) + balance(F.S.wallets[1]));
  const before = total(); let seen = 0;
  for (let f = 0; f < 5000; f++) {
    if (f % 700 === 0) F.S.players[1].x = rnd() < 0.5 ? 140 : 400;
    const mk = () => { const o = { x: Math.floor(rnd() * 3) - 1, y: Math.floor(rnd() * 3) - 1 }; for (const n of ['interact', 'ability1', 'ability2', 'menu']) if (rnd() < 0.08) { o[n] = true; o[n + 'Pressed'] = true; } if (rnd() < 0.5) o.interactPressed = o.interact = rnd() < 0.5; return P(o); };
    frame(F, [mk(), mk()], 1 / 60); assert(['idle', 'request', 'open', 'confirm'].includes(F.S.t.phase)); seen += F.S.t.stats.done;
    for (const p of F.tu.players) assert(p.cursor >= 0 && Number.isFinite(p.cursor) && (p.mode === 'item' || p.mode === 'money'));
    if (f % 250 === 0) eq(total(), before, 'összeg-tartás @' + f);
  }
  eq(total(), before); assert(F.S.t.stats.cancelled + F.S.t.stats.done + F.S.t.stats.failed > 0, 'történt trade');
  const g = fakeCtx(); drawTradeOverlay(g, F.tu, F.S.t, F.S.ctx, 960, 540); drawTradeTabs(g, F.tu, F.S.t, F.S.ctx, F.menus, [{}, {}], 960, 540);
});

function fakeCtx() {
  const calls = [];
  return new Proxy({ calls }, { get(tg, k) { if (k in tg) return tg[k]; if (k === 'measureText') return x => ({ width: String(x).length * 6 }); return (...a) => { calls.push([k, ...a]); }; }, set(tg, k, v) { tg[k] = v; return true; } });
}
