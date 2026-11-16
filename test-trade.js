// S043 tesztek: trade állapotgép (game-trade). Node-ban fut, valódi inventory/pénztárca modulokkal; minden csere atomi és összeg-tartó.
import { test, assert, eq } from './test-index.js';
import { TRADE_CONFIG, sanitizeTradeConfig, createTrade, onTrade, tradeOpen, tradeRespond, tradeCancel, tradeSetItem, tradeSetMoney, tradeAccept, tradeUnaccept, tradeConfirm, stepTrade, checkTrade, tradeView } from './game-trade.js';
import { createPlayerInventories, createInventory, addItem, removeItem, countItem, inventoryState } from './game-inventory.js';
import { createItemRegistry } from './data-items.js';
import { createPlayerWallets, createWallet, balance, deposit } from './game-wallet.js';
import { mulberry32 } from './world-noise.js';

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
