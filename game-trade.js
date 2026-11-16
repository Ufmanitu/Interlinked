// game-trade.js – WoW-szerű trade állapotgép (S043; tiszta logika, DOM nélkül; importja: game-inventory, game-wallet).
// Fázisok: idle -> request (a kezdeményező kér, a társ válaszol) -> open (két panel: tárgyak + pénz) -> confirm (mindkét fél "Elfogad") -> csere.
// Szabályok: módosítás (tárgy, pénz, visszavonás) mindkét elfogadást törli és a fázis visszaesik open-re; a végső megerősítés mindkét féltől kell;
// ~3 tile távolság (nyitáskor, lépésenként és cserekor); a csere ATOMI: bármi hibázik -> semmi nem változik, a trade open-re esik.
// A trade állapota átmeneti (nem mentett). Nincs soulbound: minden tárgy cserélhető. Nincs felhasználói szöveg (az S044 UI-é a szöveg).
import { countItem, removeItem, addItem } from './game-inventory.js';
import { balance, swapMoney } from './game-wallet.js';

export const TRADE_CONFIG = Object.freeze({ range: 96, maxLines: 6, requestTimeout: 15 }); // 96 px = 3 tile
export const TRADE_PHASES = Object.freeze(['idle', 'request', 'open', 'confirm']);

const isInt = n => typeof n === 'number' && Number.isSafeInteger(n);
const isCount = n => isInt(n) && n > 0;
const isAmount = n => isInt(n) && n >= 0;
const isPlayer = p => p === 0 || p === 1;
const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** Hibás/hiányzó mező -> alap; határokra szorít; sosem dob. */
export function sanitizeTradeConfig(src) {
  const s = src && typeof src === 'object' ? src : {};
  const c = TRADE_CONFIG;
  return Object.freeze({
    range: num(s.range, 1, 4096, c.range),
    maxLines: Math.floor(num(s.maxLines, 1, 24, c.maxLines)),
    requestTimeout: num(s.requestTimeout, 0.1, 3600, c.requestTimeout),
  });
}

const emptyOffer = () => ({ lines: [], money: 0 });

/** Új trade-rendszer (egy időben egy trade, a két játékos között). */
export function createTrade(cfg) {
  return {
    cfg: sanitizeTradeConfig(cfg), phase: 'idle', from: -1, to: -1,
    offers: [emptyOffer(), emptyOffer()], accepted: [false, false], confirmed: [false, false],
    timer: 0, version: 0, stats: { done: 0, cancelled: 0, failed: 0 }, last: null, listeners: [], lastError: null,
  };
}

/** Figyelő: {type open|respond|change|accept|unaccept|confirm-phase|confirm|done|cancel|fail, ...}; hibázó figyelő nem állít meg. -> leiratkozó. */
export function onTrade(t, fn) {
  if (typeof fn !== 'function') return () => {};
  t.listeners.push(fn);
  return () => { const i = t.listeners.indexOf(fn); if (i >= 0) t.listeners.splice(i, 1); };
}
function emit(t, ev) {
  t.version++;
  for (const fn of t.listeners.slice()) { try { fn(ev, t); } catch (e) { t.lastError = e && e.message ? e.message : String(e); } }
}

const posOf = (ctx, p) => (ctx && ctx.players && ctx.players[p]) || null;
function distOf(ctx, a, b) {
  const pa = posOf(ctx, a), pb = posOf(ctx, b);
  if (!pa || !pb || !isFinite(pa.x) || !isFinite(pa.y) || !isFinite(pb.x) || !isFinite(pb.y)) return Infinity;
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}
const invOf = (ctx, p) => (ctx && ctx.inventories && ctx.inventories[p] && ctx.inventories[p].slots ? ctx.inventories[p] : null);
const walletOf = (ctx, p) => (ctx && ctx.wallets && ctx.wallets[p] ? ctx.wallets[p] : null);
const other = (t, p) => (p === t.from ? t.to : t.from);
const inTrade = (t, p) => isPlayer(p) && (p === t.from || p === t.to);

function reset(t) {
  t.phase = 'idle'; t.from = -1; t.to = -1; t.timer = 0;
  t.offers = [emptyOffer(), emptyOffer()]; t.accepted = [false, false]; t.confirmed = [false, false];
}
function snapshot(t) {
  return { from: t.from, to: t.to, offers: t.offers.map(o => ({ lines: o.lines.map(l => ({ id: l.id, n: l.n })), money: o.money })) };
}
function clearAccepts(t) { t.accepted = [false, false]; t.confirmed = [false, false]; if (t.phase === 'confirm') t.phase = 'open'; }

/** Kezdeményezés: from kéri a trade-et to-val. -> {ok, reason: null|busy|player|same|range}. */
export function tradeOpen(t, ctx, from, to) {
  if (t.phase !== 'idle') return { ok: false, reason: 'busy' };
  if (!isPlayer(from) || !isPlayer(to)) return { ok: false, reason: 'player' };
  if (!invOf(ctx, from) || !invOf(ctx, to) || !walletOf(ctx, from) || !walletOf(ctx, to)) return { ok: false, reason: 'player' };
  if (from === to || invOf(ctx, from) === invOf(ctx, to)) return { ok: false, reason: 'same' };
  if (!(distOf(ctx, from, to) <= t.cfg.range)) return { ok: false, reason: 'range' };
  reset(t); t.phase = 'request'; t.from = from; t.to = to;
  emit(t, { type: 'open', from, to });
  return { ok: true, reason: null };
}

/** A megkeresett játékos válasza: igen -> open, nem -> cancel 'declined'. */
export function tradeRespond(t, ctx, p, yes) {
  if (t.phase !== 'request') return { ok: false, reason: 'phase' };
  if (p !== t.to) return { ok: false, reason: 'player' };
  if (!yes) { cancelNow(t, 'declined', p); return { ok: true, reason: null }; }
  if (!(distOf(ctx, t.from, t.to) <= t.cfg.range)) { cancelNow(t, 'range', p); return { ok: false, reason: 'range' }; }
  t.phase = 'open'; t.timer = 0;
  emit(t, { type: 'respond', player: p, yes: true });
  return { ok: true, reason: null };
}

function cancelNow(t, reason, by) {
  const was = t.phase;
  const snap = snapshot(t);
  reset(t); t.stats.cancelled++; t.last = { result: 'cancel', reason, by, was };
  emit(t, { type: 'cancel', reason, by, was, snap });
}

/** Megszakítás bármikor (bármelyik fél). */
export function tradeCancel(t, p, reason = 'cancel') {
  if (t.phase === 'idle') return false;
  if (p !== undefined && p !== null && !inTrade(t, p)) return false;
  cancelNow(t, typeof reason === 'string' ? reason : 'cancel', p);
  return true;
}

function lineIndex(o, id) { return o.lines.findIndex(l => l.id === id); }

/** A p felajánlott id-tárgyának darabszáma pontosan n (0 = törlés). Módosítás: elfogadások törlődnek. -> {ok, reason: null|phase|player|item|count|have|lines}. */
export function tradeSetItem(t, ctx, p, id, n) {
  if (t.phase !== 'open' && t.phase !== 'confirm') return { ok: false, reason: 'phase' };
  if (!inTrade(t, p)) return { ok: false, reason: 'player' };
  if (typeof id !== 'string' || !id) return { ok: false, reason: 'item' };
  if (!isAmount(n)) return { ok: false, reason: 'count' };
  const inv = invOf(ctx, p);
  if (!inv) return { ok: false, reason: 'player' };
  const o = t.offers[p], i = lineIndex(o, id);
  if (n > 0) {
    if (inv.reg && inv.reg.items && !inv.reg.items.has(id)) return { ok: false, reason: 'item' };
    if (countItem(inv, id) < n) return { ok: false, reason: 'have' };
    if (i < 0 && o.lines.length >= t.cfg.maxLines) return { ok: false, reason: 'lines' };
  }
  if (n === 0 && i < 0) return { ok: true, reason: null, changed: false };
  if (n > 0 && i >= 0 && o.lines[i].n === n) return { ok: true, reason: null, changed: false };
  if (n === 0) o.lines.splice(i, 1); else if (i >= 0) o.lines[i].n = n; else o.lines.push({ id, n });
  clearAccepts(t);
  emit(t, { type: 'change', player: p, kind: 'item', id, n });
  return { ok: true, reason: null, changed: true };
}

/** A p felajánlott pénze pontosan n (<= egyenleg). Módosítás: elfogadások törlődnek. */
export function tradeSetMoney(t, ctx, p, n) {
  if (t.phase !== 'open' && t.phase !== 'confirm') return { ok: false, reason: 'phase' };
  if (!inTrade(t, p)) return { ok: false, reason: 'player' };
  if (!isAmount(n)) return { ok: false, reason: 'count' };
  const w = walletOf(ctx, p);
  if (!w) return { ok: false, reason: 'player' };
  if (n > balance(w)) return { ok: false, reason: 'money' };
  if (t.offers[p].money === n) return { ok: true, reason: null, changed: false };
  t.offers[p].money = n;
  clearAccepts(t);
  emit(t, { type: 'change', player: p, kind: 'money', n });
  return { ok: true, reason: null, changed: true };
}

const isEmpty = t => t.offers.every(o => o.lines.length === 0 && o.money === 0);

// Szárazon lefuttatja a cserét másolatokon. -> {ok, reason: null|range|items|money|space, inv:[slots,slots]}
function plan(t, ctx) {
  const { from: a, to: b } = t;
  if (!(distOf(ctx, a, b) <= t.cfg.range)) return { ok: false, reason: 'range' };
  const ia = invOf(ctx, a), ib = invOf(ctx, b), wa = walletOf(ctx, a), wb = walletOf(ctx, b);
  if (!ia || !ib || !wa || !wb || ia === ib || wa === wb) return { ok: false, reason: 'player' };
  const copy = inv => ({ reg: inv.reg, slots: inv.slots.map(s => (s ? { id: s.id, n: s.n } : null)) });
  const ca = copy(ia), cb = copy(ib);
  const oa = t.offers[a], ob = t.offers[b];
  for (const l of oa.lines) if (!removeItem(ca, l.id, l.n)) return { ok: false, reason: 'items' };
  for (const l of ob.lines) if (!removeItem(cb, l.id, l.n)) return { ok: false, reason: 'items' };
  for (const l of oa.lines) if (addItem(cb, l.id, l.n) > 0) return { ok: false, reason: 'space' };
  for (const l of ob.lines) if (addItem(ca, l.id, l.n) > 0) return { ok: false, reason: 'space' };
  if (!swapMoney({ coins: balance(wa), max: wa.max }, { coins: balance(wb), max: wb.max }, oa.money, ob.money)) return { ok: false, reason: 'money' };
  return { ok: true, reason: null, inv: [ca.slots, cb.slots] };
}

/** Megvalósítható-e most a csere (az UI jelzéséhez). Nem módosít. */
export function checkTrade(t, ctx) {
  if (t.phase !== 'open' && t.phase !== 'confirm') return { ok: false, reason: 'phase' };
  const p = plan(t, ctx);
  return { ok: p.ok, reason: p.reason };
}

/** "Elfogad" (1. kör). Üres trade nem fogadható el; nem megvalósítható sem (a reason mondja, miért). Mindkét fél elfogadása -> confirm fázis. */
export function tradeAccept(t, ctx, p) {
  if (t.phase !== 'open') return { ok: false, reason: 'phase' };
  if (!inTrade(t, p)) return { ok: false, reason: 'player' };
  if (isEmpty(t)) return { ok: false, reason: 'empty' };
  const c = plan(t, ctx);
  if (!c.ok) return { ok: false, reason: c.reason };
  if (t.accepted[p]) return { ok: true, reason: null, changed: false };
  t.accepted[p] = true;
  emit(t, { type: 'accept', player: p });
  if (t.accepted[0] && t.accepted[1]) { t.phase = 'confirm'; emit(t, { type: 'confirm-phase' }); }
  return { ok: true, reason: null, changed: true };
}

/** Az elfogadás visszavonása: mindkét elfogadás törlődik, open-re esik vissza. */
export function tradeUnaccept(t, p) {
  if (t.phase !== 'open' && t.phase !== 'confirm') return false;
  if (!inTrade(t, p) || !(t.accepted[p] || t.confirmed[p])) return false;
  clearAccepts(t); t.phase = 'open';
  emit(t, { type: 'unaccept', player: p });
  return true;
}

/** Végső megerősítés (2. kör). Mindkét fél megerősítésekor a csere ATOMIAN lefut. -> {ok, reason, done}. */
export function tradeConfirm(t, ctx, p) {
  if (t.phase !== 'confirm') return { ok: false, reason: 'phase', done: false };
  if (!inTrade(t, p)) return { ok: false, reason: 'player', done: false };
  if (!t.confirmed[p]) { t.confirmed[p] = true; emit(t, { type: 'confirm', player: p }); }
  if (!(t.confirmed[0] && t.confirmed[1])) return { ok: true, reason: null, done: false };
  const c = plan(t, ctx);
  if (!c.ok) {
    if (c.reason === 'range' || c.reason === 'player') { cancelNow(t, c.reason, p); return { ok: false, reason: c.reason, done: false }; }
    const reason = c.reason;
    clearAccepts(t); t.phase = 'open'; t.stats.failed++; t.last = { result: 'fail', reason };
    emit(t, { type: 'fail', reason });
    return { ok: false, reason, done: false };
  }
  const snap = snapshot(t);
  invOf(ctx, t.from).slots = c.inv[0]; invOf(ctx, t.to).slots = c.inv[1];
  swapMoney(walletOf(ctx, t.from), walletOf(ctx, t.to), t.offers[t.from].money, t.offers[t.to].money);
  reset(t); t.stats.done++; t.last = { result: 'done' };
  emit(t, { type: 'done', snap });
  return { ok: true, reason: null, done: true };
}

/** Lépés (minden képkocka): kérés-időtúllépés, távolság (nyitott trade távolságnál megszakad), az elvesztett tárgy/pénz kiesik a felajánlásból (elfogadások törlődnek). */
export function stepTrade(t, ctx, dt = 0) {
  if (t.phase === 'idle') return;
  if (!(distOf(ctx, t.from, t.to) <= t.cfg.range)) { cancelNow(t, 'range'); return; }
  if (t.phase === 'request') {
    t.timer += isFinite(dt) && dt > 0 ? dt : 0;
    if (t.timer >= t.cfg.requestTimeout) cancelNow(t, 'timeout');
    return;
  }
  let changed = false;
  for (const p of [t.from, t.to]) {
    const inv = invOf(ctx, p), w = walletOf(ctx, p), o = t.offers[p];
    if (!inv || !w) { cancelNow(t, 'player'); return; }
    for (let i = o.lines.length - 1; i >= 0; i--) {
      const have = countItem(inv, o.lines[i].id);
      if (have < o.lines[i].n) { changed = true; if (have <= 0) o.lines.splice(i, 1); else o.lines[i].n = have; }
    }
    if (o.money > balance(w)) { o.money = balance(w); changed = true; }
  }
  if (changed) { clearAccepts(t); emit(t, { type: 'change', player: -1, kind: 'trim' }); }
}

/** Az UI nézete a p játékosnak: saját/társ panel, állapotok. */
export function tradeView(t, p) {
  const q = isPlayer(p) && inTrade(t, p) ? other(t, p) : -1;
  const side = i => (i < 0 ? null : { lines: t.offers[i].lines.map(l => ({ id: l.id, n: l.n })), money: t.offers[i].money, accepted: t.accepted[i], confirmed: t.confirmed[i] });
  return { phase: t.phase, mine: side(q < 0 ? -1 : p), theirs: side(q), partner: q, initiator: p === t.from, version: t.version };
}
