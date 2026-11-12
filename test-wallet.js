// S036 tesztek: játékosonkénti pénz (game-wallet) + HUD-megjelenítés (render-hud). Node-ban fut, hamis canvas-szal; a műveletek összeg-tartók és atomiak.
import { test, assert, eq } from './test-index.js';
import { WALLET_CONFIG, WALLET_TEXTS, createWallet, createPlayerWallets, balance, canAfford, room, canReceive, deposit, withdraw, transfer, swapMoney, formatMoney, walletState, restoreWallet } from './game-wallet.js';
import { drawHud, drawHudPanel } from './render-hud.js';
import { hudLayout, createMenus } from './game-hud.js';
import { createI18n, addTexts, translate, auditTexts } from './i18n.js';
import { BASE_TEXTS } from './data-text.js';
import { createPlayer } from './game-player.js';
import { mulberry32 } from './world-noise.js';

const MAX = WALLET_CONFIG.max;
const BAD = [-1, 1.5, NaN, Infinity, -Infinity, '5', null, undefined, {}, [], true, 2 ** 60];
function rec() {
  const c = { fills: [], texts: [], depth: 0, bad: 0, fillStyle: '', font: '', textAlign: 'left' };
  c.save = () => { c.depth++; };
  c.restore = () => { c.depth--; if (c.depth < 0) c.bad++; };
  c.fillRect = (x, y, w, h) => c.fills.push({ x, y, w, h, s: c.fillStyle });
  c.fillText = (s, x, y) => c.texts.push({ s, x, y, align: c.textAlign });
  return c;
}

test('wallet: létrehozás, kezdő összeg, szorítás, hibás kezdőérték', () => {
  eq(balance(createWallet()), 0);
  eq(balance(createWallet(50)), 50);
  eq(balance(createWallet(MAX + 5)), MAX);
  for (const b of BAD) eq(balance(createWallet(b)), b === undefined ? 0 : 0, 'hibás kezdő: ' + String(b));
  const ws = createPlayerWallets();
  eq(ws.length, 2); assert(ws[0] !== ws[1], 'külön objektumok');
  eq(createPlayerWallets(3, 7).map(balance).join(), '7,7,7');
  eq(createPlayerWallets(0).length, 2); eq(createPlayerWallets(-4).length, 2);
  for (const b of BAD) eq(balance(b), 0, 'balance(hibás)');
  eq(balance({ coins: -3 }), 0); eq(balance({ coins: 2.5 }), 0);
});

test('wallet: deposit – hozzáad, plafon fölött a maradékot adja vissza, hibás bemenet nem módosít', () => {
  const w = createWallet(10);
  eq(deposit(w, 5), 0); eq(balance(w), 15);
  eq(deposit(w, 0), 0); eq(balance(w), 15);
  const f = createWallet(MAX - 3);
  eq(deposit(f, 10), 7); eq(balance(f), MAX);
  eq(deposit(f, 1), 1); eq(balance(f), MAX);
  for (const b of BAD) { eq(deposit(w, b), 0); eq(balance(w), 15, 'nem módosít: ' + String(b)); }
  eq(deposit(null, 5), 0); eq(deposit({ coins: 'x', max: 9 }, 5), 0);
  eq(room(createWallet(MAX - 3)), 3); eq(room(null), 0);
});

test('wallet: withdraw és canAfford – atomi, pontosan 0-ig, nem lehet negatív', () => {
  const w = createWallet(10);
  eq(withdraw(w, 4), true); eq(balance(w), 6);
  eq(withdraw(w, 7), false); eq(balance(w), 6);
  eq(withdraw(w, 6), true); eq(balance(w), 0);
  eq(withdraw(w, 1), false); eq(balance(w), 0);
  eq(withdraw(w, 0), true);
  eq(canAfford(createWallet(5), 5), true); eq(canAfford(createWallet(5), 6), false);
  const v = createWallet(9);
  for (const b of BAD) { eq(withdraw(v, b), false, 'withdraw(' + String(b) + ')'); eq(canAfford(v, b), false); eq(balance(v), 9); }
  eq(withdraw(null, 1), false);
});

test('wallet: két játékos pénze külön – az egyik költése a másikét nem érinti', () => {
  const [a, b] = createPlayerWallets();
  deposit(a, 100); deposit(b, 30);
  withdraw(a, 40);
  eq(balance(a), 60); eq(balance(b), 30);
  eq(withdraw(b, 31), false); eq(balance(a), 60);
});

test('wallet: transfer – összeg-tartó, atomi; elégtelen egyenleg / telt fogadó / ugyanaz / hibás -> semmi sem változik', () => {
  const a = createWallet(100), b = createWallet(5);
  eq(transfer(a, b, 30), true); eq(balance(a), 70); eq(balance(b), 35);
  eq(transfer(a, b, 71), false); eq(balance(a), 70); eq(balance(b), 35);
  eq(transfer(a, a, 10), false); eq(balance(a), 70);
  const full = createWallet(MAX - 2);
  eq(canReceive(full, 3), false); eq(canReceive(full, 2), true);
  eq(transfer(a, full, 3), false); eq(balance(a), 70); eq(balance(full), MAX - 2);
  eq(transfer(a, full, 2), true); eq(balance(full), MAX); eq(balance(a), 68);
  for (const x of BAD) { eq(transfer(a, b, x), false); }
  eq(transfer(null, b, 1), false); eq(transfer(a, null, 1), false);
  eq(balance(a) + balance(b), 68 + 35);
});

test('wallet: swapMoney (trade) – kétirányú csere egy lépésben, bármelyik fél hibája mindent visszatart', () => {
  const a = createWallet(100), b = createWallet(50);
  eq(swapMoney(a, b, 30, 10), true); eq(balance(a), 80); eq(balance(b), 70);
  eq(swapMoney(a, b, 81, 0), false); eq(balance(a), 80); eq(balance(b), 70);
  eq(swapMoney(a, b, 0, 71), false); eq(balance(a), 80); eq(balance(b), 70);
  eq(swapMoney(a, b, 0, 0), true); eq(balance(a), 80);
  const hi = createWallet(MAX - 5);
  eq(swapMoney(a, hi, 10, 0), false); eq(balance(a), 80); eq(balance(hi), MAX - 5); // a fogadó plafonja
  eq(swapMoney(hi, a, 5, 0), true); eq(balance(hi), MAX - 10); eq(balance(a), 85);
  eq(swapMoney(a, a, 1, 1), false);
  for (const x of BAD) { eq(swapMoney(a, b, x, 1), false); eq(swapMoney(a, b, 1, x), false); }
  eq(balance(a) + balance(b), 85 + 70);
});

test('wallet: formatMoney – csoportosítás, szél-esetek, hibás bemenet', () => {
  eq(formatMoney(0), '0'); eq(formatMoney(999), '999'); eq(formatMoney(1000), '1 000');
  eq(formatMoney(1234567), '1 234 567'); eq(formatMoney(MAX), '999 999 999'); eq(formatMoney(1234, ','), '1,234');
  for (const b of BAD) eq(formatMoney(b), '0', 'format(' + String(b) + ')');
});

test('wallet: állapot és visszaállítás – körút, atomi, hibás/ismeretlen állapot érintetlen', () => {
  const w = createWallet(321);
  const st = walletState(w);
  eq(JSON.stringify(st), JSON.stringify({ v: 1, coins: 321 }));
  const r = createWallet(9);
  eq(restoreWallet(r, JSON.parse(JSON.stringify(st))), true); eq(balance(r), 321);
  for (const bad of [null, undefined, 5, 'x', [], {}, { v: 2, coins: 5 }, { v: 1 }, { v: 1, coins: -1 }, { v: 1, coins: 1.5 }, { v: 1, coins: '5' }, { v: 1, coins: NaN }, { v: 1, coins: 2 ** 60 }]) {
    eq(restoreWallet(r, bad), false, JSON.stringify(bad)); eq(balance(r), 321, 'érintetlen');
  }
  eq(restoreWallet(r, { v: 1, coins: MAX + 100 }), true); eq(balance(r), MAX);
  eq(restoreWallet(null, st), false);
  eq(balance(createWallet()) + walletState(null).coins, 0);
});

test('wallet: szövegek HU/EN, azonos paraméterekkel, nincs hiányzó kulcs', () => {
  const i = createI18n({ lang: 'hu', texts: {}, detect: () => 'hu' });
  addTexts(i, BASE_TEXTS); addTexts(i, WALLET_TEXTS, 'wallet.');
  const a = auditTexts(i);
  assert(a.ok, 'audit: ' + JSON.stringify(a));
  eq(translate(i, 'wallet.amount', { n: '1 000' }, 'hu'), '1 000 érme');
  eq(translate(i, 'wallet.amount', { n: '1 000' }, 'en'), '1 000 coins');
  eq(translate(i, 'wallet.label', {}, 'en'), 'Coins');
});

test('wallet HUD: a pénz a panelen belül, jobbra igazítva, ikonnal; pénztárca nélkül nincs pénz-sor', () => {
  const p = { ...createPlayer(0, 0, 0), index: 0 };
  const w = createWallet(1234567);
  const c = rec(); const L = drawHudPanel(c, p, 960, 540, undefined, undefined, w);
  const money = c.texts.find(x => x.s === '1 234 567');
  assert(money, 'összeg kiírva');
  eq(money.align, 'right'); eq(money.x, L.x + L.w - 8);
  assert(money.y >= L.y && money.y < L.y + 20, 'a felső sorban');
  const coin = c.fills.filter(f => f.s === '#f2c94c');
  eq(coin.length, 1); assert(coin[0].x > L.x + 60 && coin[0].x + coin[0].w < money.x, 'az ikon az összeg előtt, a név után');
  assert(c.fills.every(f => f.x >= L.x && f.x + f.w <= L.x + L.w && f.y >= L.y && f.y + f.h <= L.y + L.h), 'minden rajz a panelen belül');
  const c2 = rec(); drawHudPanel(c2, p, 960, 540);
  assert(!c2.texts.some(x => /^\d/.test(x.s)), 'nincs pénz-sor pénztárca nélkül');
  assert(!c2.fills.some(f => f.s === '#f2c94c'), 'nincs érme-ikon');
  const c3 = rec(); drawHudPanel(c3, p, 960, 540, undefined, undefined, createWallet(MAX));
  assert(c3.texts.some(x => x.s === '999 999 999'), 'a plafon is kifér');
  const big = c3.fills.filter(f => f.s === '#f2c94c')[0];
  assert(big.x > L.x + 60, 'a plafon-összeg ikonja sem ér a névre');
});

test('wallet HUD: drawHud mindkét játékos saját pénzét rajzolja a saját sarkában; változás követése; save/restore egyensúly', () => {
  const players = [createPlayer(0, 0, 0), createPlayer(1, 0, 0)];
  const ws = createPlayerWallets(); deposit(ws[0], 50); deposit(ws[1], 7);
  const c = rec(); eq(drawHud(c, players, createMenus(), 960, 540, undefined, undefined, ws), 2);
  const t50 = c.texts.find(x => x.s === '50'), t7 = c.texts.find(x => x.s === '7');
  assert(t50 && t7, 'mindkét összeg');
  assert(t50.x < 480 && t7.x > 480, 'P1 bal, P2 jobb sarok'); eq(c.depth, 0); eq(c.bad, 0);
  withdraw(ws[0], 20);
  const c2 = rec(); drawHud(c2, players, createMenus(), 960, 540, undefined, undefined, ws);
  assert(c2.texts.some(x => x.s === '30') && !c2.texts.some(x => x.s === '50'), 'a változás megjelenik');
  const c3 = rec(); eq(drawHud(c3, players, createMenus(), 960, 540), 2); // a régi hívás (pénztárca nélkül) érintetlen
  const c4 = rec(); eq(drawHud(c4, players, createMenus(), 960, 540, undefined, undefined, [null, createWallet(3)]), 2);
  assert(c4.texts.some(x => x.s === '3') && !c4.texts.some(x => x.s === '50'), 'hiányzó pénztárca -> nincs sor, a másik él');
  const hl = hudLayout(0, 960, 540); assert(hl.w === 176, 'a HUD mérete változatlan');
});

test('wallet: 6000 véletlen művelet két pénztárcán – az összeg tartása, 0..max, hibás bemenet sosem dob', () => {
  const rnd = mulberry32(36036);
  const ws = createPlayerWallets(2, 500);
  let total = 1000;
  for (let k = 0; k < 6000; k++) {
    const op = Math.floor(rnd() * 6), n = Math.floor(rnd() * 400), i = rnd() < 0.5 ? 0 : 1;
    const a = ws[i], b = ws[1 - i];
    if (op === 0) total += n - deposit(a, n); // a bevétel a külső forrásból jön: a total követi
    if (op === 1) total -= withdraw(a, n) ? n : 0;
    if (op === 2) transfer(a, b, n);
    if (op === 3) swapMoney(a, b, n, Math.floor(rnd() * 400));
    if (op === 4) { try { deposit(a, rnd() < 0.5 ? NaN : -n); withdraw(b, 1.5); transfer(a, b, Infinity); } catch (e) { throw new Error('dobott: ' + e.message); } }
    if (op === 5) restoreWallet(a, rnd() < 0.5 ? { v: 1, coins: n } : { v: 9, coins: n });
    if (op === 5) total = balance(ws[0]) + balance(ws[1]); // a visszaállítás újraalapozza a számlálót
    for (const w of ws) assert(Number.isSafeInteger(w.coins) && w.coins >= 0 && w.coins <= MAX, 'tartomány: ' + k);
    eq(balance(ws[0]) + balance(ws[1]), total, 'összeg-tartás: ' + k);
  }
});

test('wallet: összeg-tartás – transfer/swap sorozat nem teremt és nem nyel el pénzt; ugyanaz a futás ugyanazt adja', () => {
  const run = () => {
    const rnd = mulberry32(5036);
    const ws = createPlayerWallets(2, 1000);
    for (let k = 0; k < 4000; k++) {
      const i = rnd() < 0.5 ? 0 : 1, n = Math.floor(rnd() * 700);
      if (rnd() < 0.5) transfer(ws[i], ws[1 - i], n); else swapMoney(ws[i], ws[1 - i], n, Math.floor(rnd() * 700));
      eq(balance(ws[0]) + balance(ws[1]), 2000, 'összeg ' + k);
    }
    return balance(ws[0]) + ':' + balance(ws[1]);
  };
  eq(run(), run());
});
