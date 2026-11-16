// S044 – Trade UI logika (tiszta, DOM nélkül; a trade állapotgép: game-trade.js, S043).
// Kezdeményezés: menü gomb: inventory -> craft -> TRADE fül -> zár; a trade fülön az interakció kérést küld a társnak (~3 tile).
// Kérés: a címzett interakcióval elfogad, 2. képességgel elutasít (a kérő 2. képességgel visszavon). Közben a kérés gombjait a trade nyeli el.
// Nyitott trade: mindkét játékos áll (üres bemenet, a pórázon húzható), KÉT KURZOR egyszerre: fel/le tárgy, bal/jobb db (tartva gyorsul),
// 1. képesség: tárgy <-> pénz mód, interakció: elfogad / végső megerősítés (a confirm-fázis után rövid zár: nincs véletlen dupla nyomás), 2. képesség: visszavon / mégse.
import { tradeOpen, tradeRespond, tradeCancel, tradeSetItem, tradeSetMoney, tradeAccept, tradeUnaccept, tradeConfirm, checkTrade, onTrade } from './game-trade.js';
import { countItem } from './game-inventory.js';
import { balance } from './game-wallet.js';
import { blankRaw, craftDir, scrollFirst } from './game-craftui.js';

export const TRADEUI_CONFIG = Object.freeze({ visibleRows: 5, deadzone: 0.5, repeatDelay: 0.3, repeatRate: 0.1, accel1: 0.8, accel2: 2, flash: 2.2, toast: 2.5, confirmLock: 0.6, tile: 32 });
export const TRADE_REASONS = Object.freeze(['range', 'busy', 'player', 'same', 'empty', 'items', 'space', 'money', 'have', 'lines', 'count', 'item', 'phase']);
export const TRADE_CANCELS = Object.freeze(['declined', 'range', 'timeout', 'cancel', 'player']);

// prefix: 'trade.' (registerTexts(TRADEUI_TEXTS, 'trade.')); a paraméterek HU/EN azonosak
export const TRADEUI_TEXTS = {
  hu: {
    title: 'Kereskedés', player: 'Játékos {n}', offer: 'Ajánlat', money: 'Pénz: {n}', moneyOf: 'Pénz: {n} / {max}',
    empty: 'Nincs felajánlva semmi', items: 'Tárgyaid', moneyMode: 'Pénz felajánlása', none: 'Nincs tárgyod',
    'badge.accepted': 'ELFOGADVA', 'badge.confirmed': 'MEGERŐSÍTVE',
    'status.open': 'Állítsd össze az ajánlatot', 'status.accepted': 'Elfogadtad – várakozás a társra', 'status.theirs': 'A társ már elfogadta',
    'status.confirm': 'Végső megerősítés kell', 'status.confirmed': 'Megerősítve – várakozás a társra',
    req: 'Játékos {from} kereskedni szeretne Játékos {to} játékossal ({s} mp)',
    'req.to': 'Játékos {n}: interakció elfogad · 2. képesség elutasít', 'req.from': 'Játékos {n}: 2. képesség visszavon',
    'tab.partner': 'Társ távolsága: {d} tile (max {max})', 'tab.go': 'Interakció: kérés küldése', 'tab.far': 'Túl messze vagy a társtól', 'tab.busy': 'Kereskedés folyamatban', 'tab.close': 'Menü: bezár',
    hint1: 'Fel/le tárgy · Bal/jobb db (tartva gyorsul)', hint2: 'Interakció elfogad · 1.kép pénz · 2.kép mégse',
    hintm1: 'Bal/jobb ±1 · Fel/le ±10 (tartva gyorsul)', 'ev.done': 'Sikeres csere', 'ev.declined': 'A kérést elutasították', 'ev.range': 'Túl messze kerültetek egymástól',
    'ev.timeout': 'Nem érkezett válasz', 'ev.cancel': 'A kereskedés megszakadt', 'ev.player': 'A kereskedés hibára futott',
    'r.range': 'Túl messze vagytok', 'r.busy': 'Már folyik egy kereskedés', 'r.player': 'Hibás játékos', 'r.same': 'Nem kereskedhetsz magaddal', 'r.empty': 'Üres ajánlat nem fogadható el',
    'r.items': 'Hiányzik egy felajánlott tárgy', 'r.space': 'Nincs elég hely az inventoryban', 'r.money': 'Nincs elég pénz vagy tele a pénztárca', 'r.have': 'Nincs ennyi belőle',
    'r.lines': 'Legfeljebb {max} tárgy-sor', 'r.count': 'Hibás mennyiség', 'r.item': 'Ismeretlen tárgy', 'r.phase': 'Most nem lehet', 'r.other': 'Nem sikerült',
  },
  en: {
    title: 'Trade', player: 'Player {n}', offer: 'Offer', money: 'Money: {n}', moneyOf: 'Money: {n} / {max}',
    empty: 'Nothing offered', items: 'Your items', moneyMode: 'Offer money', none: 'You have no items',
    'badge.accepted': 'ACCEPTED', 'badge.confirmed': 'CONFIRMED',
    'status.open': 'Put together your offer', 'status.accepted': 'You accepted – waiting for your partner', 'status.theirs': 'Your partner already accepted',
    'status.confirm': 'Final confirmation needed', 'status.confirmed': 'Confirmed – waiting for your partner',
    req: 'Player {from} wants to trade with Player {to} ({s} s)',
    'req.to': 'Player {n}: interact accepts · ability 2 declines', 'req.from': 'Player {n}: ability 2 withdraws',
    'tab.partner': 'Partner distance: {d} tiles (max {max})', 'tab.go': 'Interact: send request', 'tab.far': 'You are too far from your partner', 'tab.busy': 'A trade is in progress', 'tab.close': 'Menu: close',
    hint1: 'Up/down item · Left/right qty (hold = faster)', hint2: 'Interact accept · Abil.1 money · Abil.2 cancel',
    hintm1: 'Left/right ±1 · Up/down ±10 (hold = faster)', 'ev.done': 'Trade complete', 'ev.declined': 'The request was declined', 'ev.range': 'You moved too far apart',
    'ev.timeout': 'No answer', 'ev.cancel': 'The trade was cancelled', 'ev.player': 'The trade ran into an error',
    'r.range': 'You are too far apart', 'r.busy': 'A trade is already in progress', 'r.player': 'Invalid player', 'r.same': 'You cannot trade with yourself', 'r.empty': 'An empty offer cannot be accepted',
    'r.items': 'An offered item is missing', 'r.space': 'Not enough inventory space', 'r.money': 'Not enough money or wallet full', 'r.have': 'You do not have that many',
    'r.lines': 'At most {max} item lines', 'r.count': 'Invalid amount', 'r.item': 'Unknown item', 'r.phase': 'Not possible right now', 'r.other': 'Failed',
  },
};

export function sanitizeTradeUiConfig(src) {
  const o = { ...TRADEUI_CONFIG };
  if (src && typeof src === 'object') for (const k of Object.keys(o)) { const v = src[k]; if (typeof v === 'number' && Number.isFinite(v) && v > 0) o[k] = v; }
  o.visibleRows = Math.max(1, Math.floor(o.visibleRows));
  o.deadzone = Math.min(o.deadzone, 0.95);
  o.accel2 = Math.max(o.accel2, o.accel1);
  return Object.freeze(o);
}
export const reasonKey = r => 'trade.r.' + (TRADE_REASONS.includes(r) ? r : 'other');
export const cancelKey = r => 'trade.ev.' + (TRADE_CANCELS.includes(r) ? r : 'cancel');

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const menuIsOpen = (menus, i) => !!(menus && menus.open && menus.open[i]);
const mkPlayer = () => ({ tab: 'inv', mode: 'item', cursor: 0, id: null, rows: [], dx: 0, dy: 0, t: 0, held: 0, hold: false, flash: null, fresh: false });

export function createTradeUi(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  return { cfg: sanitizeTradeUiConfig(o.cfg), players: [mkPlayer(), mkPlayer()], toast: null, lastPhase: 'idle', lock: 0, off: null };
}

// a trade eseményeiből a közös üzenet (siker / megszakadás / sikertelen csere); -> leiratkozó
export function attachTradeUi(tu, trade) {
  if (tu.off) tu.off();
  tu.off = onTrade(trade, ev => {
    const T = tu.cfg.toast;
    if (ev.type === 'done') tu.toast = { key: 'trade.ev.done', ok: true, t: T };
    else if (ev.type === 'cancel') tu.toast = { key: cancelKey(ev.reason), ok: false, t: T };
    else if (ev.type === 'fail') tu.toast = { key: reasonKey(ev.reason), ok: false, t: T };
  });
  return tu.off;
}

export const tradeTabActive = (tu, menus, i) => !!(tu && tu.players[i] && tu.players[i].tab === 'trade' && menuIsOpen(menus, i));

function involved(trade, i) { return trade.phase !== 'idle' && (i === trade.from || i === trade.to); }

// A routeCraftInputs ELŐTT hívandó: -> a craft-útválasztó bemenetei. A menü-körforgás (inv -> craft -> trade -> zár) és a trade alatti bemenet-szűrés.
export function routeTradeInputs(tu, trade, cs, menus, raws) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    const raw = raws && raws[i] && typeof raws[i] === 'object' ? raws[i] : {};
    const ps = tu.players[i], cp = cs && cs.players && cs.players[i];
    let r = raw;
    ps.fresh = false;
    if (involved(trade, i)) {
      if (trade.phase === 'request') r = { ...raw, interact: false, interactPressed: false, ability2: false, ability2Pressed: false, menuPressed: false }; // a kérés gombjait a trade nyeli el, a mozgás marad
      else r = blankRaw(raw); // nyitott trade: a karakter áll (a pórázon húzható)
    } else if (menuIsOpen(menus, i)) {
      if (ps.tab === 'trade') {
        if (raw.menuPressed) { ps.tab = 'inv'; if (cp) cp.tab = 'craft'; } // a craft-útválasztó a craft fül + menü gomb párt zárja
        else { r = blankRaw(raw); if (cp) cp.tab = 'inv'; }
      } else if (cp && cp.tab === 'craft' && raw.menuPressed) { // craft -> trade (a menü nyitva marad)
        ps.tab = 'trade'; ps.fresh = true; cp.tab = 'inv'; r = blankRaw(raw);
      }
    } else ps.tab = 'inv';
    out.push(r);
  }
  return out;
}

// A rajzhoz: a trade fülön / nyitott trade-ben lévő játékosnál a menü-panelek nem rajzolódnak (másolat)
export function tradeMenus(tu, trade, menus) {
  const open = [0, 1].map(i => menuIsOpen(menus, i) && !tradeTabActive(tu, menus, i) && !(involved(trade, i) && trade.phase !== 'request'));
  return Object.assign({}, menus, { open });
}

// a játékos tárgyai (egyedi id-k, slot-sorrendben) + mennyi van, mennyit ajánlott fel
export function buildTradeRows(inv, offer) {
  if (!inv || !Array.isArray(inv.slots)) return [];
  const seen = new Set(), rows = [];
  for (const s of inv.slots) {
    if (!s || !s.id || seen.has(s.id)) continue;
    seen.add(s.id);
    const l = offer && offer.lines ? offer.lines.find(x => x.id === s.id) : null;
    rows.push({ id: s.id, have: countItem(inv, s.id), offered: l ? l.n : 0 });
  }
  return rows;
}

function navStep(ps, dir, d, cfg) {
  if (!dir.dx && !dir.dy) { ps.hold = false; ps.dx = 0; ps.dy = 0; ps.t = 0; ps.held = 0; return null; }
  if (ps.hold) return null;
  if (dir.dx !== ps.dx || dir.dy !== ps.dy) { ps.dx = dir.dx; ps.dy = dir.dy; ps.t = cfg.repeatDelay; ps.held = 0; return dir; }
  ps.held += d; ps.t -= d;
  if (ps.t <= 0) { ps.t = cfg.repeatRate; return dir; }
  return null;
}
const stepOf = (ps, cfg) => (ps.held >= cfg.accel2 ? 100 : ps.held >= cfg.accel1 ? 10 : 1);

function syncPhase(tu, trade) {
  if (trade.phase === tu.lastPhase) return;
  if (trade.phase === 'confirm') tu.lock = tu.cfg.confirmLock;
  if (trade.phase === 'open' && tu.lastPhase !== 'confirm') for (const ps of tu.players) { ps.hold = true; ps.dx = 0; ps.dy = 0; ps.t = 0; ps.held = 0; ps.mode = 'item'; ps.cursor = 0; ps.id = null; }
  tu.lastPhase = trade.phase;
}

function fail(ps, cfg, r, ev, i, what) { ps.flash = { reason: r.reason, t: cfg.flash }; ev.push({ type: what + '-fail', player: i, reason: r.reason }); }

// Minden kockában (a stepMenus UTÁN, a NYERS bemenettel, a stepTrade ELŐTT); -> a kocka UI-eseményei
export function stepTradeUi(tu, trade, tctx, menus, raws, dt) {
  const ev = [], cfg = tu.cfg;
  const d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
  syncPhase(tu, trade);
  tu.lock = Math.max(0, tu.lock - d);
  if (tu.toast) { tu.toast.t -= d; if (tu.toast.t <= 0) tu.toast = null; }
  const phase0 = trade.phase;
  for (let i = 0; i < 2; i++) {
    const ps = tu.players[i];
    const raw = raws && raws[i] && typeof raws[i] === 'object' ? raws[i] : {};
    if (ps.flash) { ps.flash.t -= d; if (ps.flash.t <= 0) ps.flash = null; }
    if (phase0 === 'idle') {
      ps.rows = [];
      if (tradeTabActive(tu, menus, i) && !ps.fresh && raw.interactPressed) {
        const r = tradeOpen(trade, tctx, i, 1 - i);
        if (r.ok) ev.push({ type: 'open', player: i }); else fail(ps, cfg, r, ev, i, 'open');
      }
      continue;
    }
    if (phase0 === 'request') {
      ps.rows = [];
      if (i === trade.to) {
        if (raw.interactPressed && tradeRespond(trade, tctx, i, true).ok) ev.push({ type: 'respond', player: i, yes: true });
        else if (raw.ability2Pressed && tradeRespond(trade, tctx, i, false).ok) ev.push({ type: 'respond', player: i, yes: false });
      } else if (i === trade.from && raw.ability2Pressed && tradeCancel(trade, i, 'cancel')) ev.push({ type: 'cancel', player: i });
      continue;
    }
    if (phase0 !== 'open' && phase0 !== 'confirm') continue;
    if (trade.phase === 'idle') continue; // egy korábbi játékos művelete lezárta
    const inv = tctx && tctx.inventories && tctx.inventories[i], w = tctx && tctx.wallets && tctx.wallets[i];
    ps.rows = buildTradeRows(inv, trade.offers[i]);
    let idx = ps.id != null ? ps.rows.findIndex(r => r.id === ps.id) : -1;
    if (idx < 0) idx = clamp(Math.floor(num(ps.cursor)), 0, Math.max(0, ps.rows.length - 1));
    ps.cursor = idx; ps.id = ps.rows.length ? ps.rows[idx].id : null;
    const mv = navStep(ps, craftDir(raw.x, raw.y, cfg.deadzone), d, cfg);
    if (mv && ps.mode === 'item' && ps.rows.length) {
      if (mv.dy) { const c = clamp(ps.cursor + mv.dy, 0, ps.rows.length - 1); ps.cursor = c; ps.id = ps.rows[c].id; }
      if (mv.dx) {
        const row = ps.rows[ps.cursor];
        const r = tradeSetItem(trade, tctx, i, row.id, clamp(row.offered + mv.dx * stepOf(ps, cfg), 0, row.have));
        if (!r.ok) fail(ps, cfg, r, ev, i, 'item'); else if (r.changed) ev.push({ type: 'item', player: i, id: row.id });
        ps.rows = buildTradeRows(inv, trade.offers[i]);
      }
    } else if (mv && ps.mode === 'money' && w) {
      const s = stepOf(ps, cfg), delta = mv.dx * s - mv.dy * s * 10;
      const r = tradeSetMoney(trade, tctx, i, clamp(trade.offers[i].money + delta, 0, balance(w)));
      if (!r.ok) fail(ps, cfg, r, ev, i, 'money'); else if (r.changed) ev.push({ type: 'money', player: i });
    }
    if (raw.ability1Pressed) { ps.mode = ps.mode === 'item' ? 'money' : 'item'; ev.push({ type: 'mode', player: i, mode: ps.mode }); }
    if (raw.interactPressed) {
      if (phase0 === 'open') {
        const r = tradeAccept(trade, tctx, i);
        if (!r.ok) fail(ps, cfg, r, ev, i, 'accept'); else if (r.changed) ev.push({ type: 'accept', player: i });
      } else if (tu.lock <= 0) {
        const r = tradeConfirm(trade, tctx, i);
        if (!r.ok) fail(ps, cfg, r, ev, i, 'confirm'); else ev.push({ type: r.done ? 'done' : 'confirm', player: i });
      }
    } else if (raw.ability2Pressed) {
      if (trade.accepted[i] || trade.confirmed[i]) { if (tradeUnaccept(trade, i)) ev.push({ type: 'unaccept', player: i }); }
      else if (tradeCancel(trade, i, 'cancel')) ev.push({ type: 'cancel', player: i });
    }
  }
  syncPhase(tu, trade);
  return ev;
}

function statusOf(tu, trade, p, check) {
  const ps = tu.players[p], q = 1 - p;
  if (ps.flash) return { key: reasonKey(ps.flash.reason), kind: 'bad', params: { max: trade.cfg.maxLines } };
  if (trade.phase === 'confirm') return trade.confirmed[p] ? { key: 'trade.status.confirmed', kind: 'ok' } : { key: 'trade.status.confirm', kind: 'warn' };
  if (check && !check.ok) return { key: reasonKey(check.reason), kind: 'warn', params: { max: trade.cfg.maxLines } };
  if (trade.accepted[p]) return { key: 'trade.status.accepted', kind: 'ok' };
  return trade.accepted[q] ? { key: 'trade.status.theirs', kind: 'warn' } : { key: 'trade.status.open', kind: 'dim' };
}

// nézet-modell a rajzhoz (két panel, kérés-sáv, üzenet)
export function tradeUiView(tu, trade, tctx) {
  const open = trade.phase === 'open' || trade.phase === 'confirm';
  const check = open ? checkTrade(trade, tctx) : null;
  const sides = [0, 1].map(p => {
    const ps = tu.players[p], o = trade.offers[p], w = tctx && tctx.wallets && tctx.wallets[p];
    return {
      player: p, lines: o.lines.map(l => ({ id: l.id, n: l.n })), money: o.money, accepted: trade.accepted[p], confirmed: trade.confirmed[p],
      rows: ps.rows, total: ps.rows.length, cursor: ps.cursor, visible: tu.cfg.visibleRows, first: scrollFirst(ps.cursor, ps.rows.length, tu.cfg.visibleRows),
      mode: ps.mode, balance: w ? balance(w) : 0, status: statusOf(tu, trade, p, check),
    };
  });
  return { phase: trade.phase, from: trade.from, to: trade.to, secs: Math.max(0, Math.ceil(trade.cfg.requestTimeout - trade.timer)), sides, toast: tu.toast, maxLines: trade.cfg.maxLines };
}

// a trade fül nézete (a menü-sarokban): távolság a társtól, kérés küldhető-e
export function tabView(tu, trade, tctx, menus, i) {
  if (!tradeTabActive(tu, menus, i)) return null;
  const a = tctx && tctx.players && tctx.players[i], b = tctx && tctx.players && tctx.players[1 - i];
  const px = a && b ? Math.hypot(num(a.x) - num(b.x), num(a.y) - num(b.y)) : Infinity;
  const ok = a && b && Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(b.x) && Number.isFinite(b.y);
  return {
    dist: ok ? Math.round(px / tu.cfg.tile * 10) / 10 : null, max: Math.round(trade.cfg.range / tu.cfg.tile * 10) / 10,
    inRange: !!ok && px <= trade.cfg.range, busy: trade.phase !== 'idle', flash: tu.players[i].flash,
  };
}
