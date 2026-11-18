// Halál és újraélesztés (S070). Tiszta logika, DOM és canvas nélkül; importja: game-health, game-wallet.
// Az elesett játékos NEM game over: a társ a közelében tartott interakció-gombbal újraélesztheti a REVIVE_CONFIG.window idő alatt.
// Ha mindketten elesnek (vagy az idő lejár): mindkét játékos a legutóbbi Sorskő/szilánk-ponthoz kerül, kis pénz-büntetéssel.

import { isHealth, revive, setInvulnerable } from './game-health.js';
import { balance, withdraw } from './game-wallet.js';

export const REVIVE_CONFIG = Object.freeze({
  window: 30,       // mp, ennyi ideig élesztheti a társ (élesztés közben a számláló áll)
  reviveTime: 2.5,  // mp tartott gomb a teljes élesztéshez (a speed hook gyorsíthatja)
  decay: 1,         // elengedve a haladás ennyiszeres sebességgel fogy
  range: 56,        // px, a két játékos KÖZÉPPONTJA közti távolság
  ratio: 0.3,       // az újraélesztett HP-aránya
  iframes: 1.5,     // mp védelem élesztés után
  wipeDelay: 2,     // mp a "mindketten elestek" és a visszatérés között
  wipeIframes: 3,   // mp védelem visszatérés után
  spread: 70,       // px, a pár a pont két oldalán áll (mint a kezdőhelyen)
  penaltyCoins: 0.1, // a pénz ekkora része vész el visszatéréskor (0..1)
  maxDt: 0.1,
  maxEvents: 64,
});

export const REVIVE_TEXTS = {
  hu: { 'revive.hold': 'Tartsd az interakciót az élesztéshez', 'revive.wipe': 'Mindketten elestetek – vissza a Sorskőhöz' },
  en: { 'revive.hold': 'Hold interact to revive', 'revive.wipe': 'Both fell – back to the checkpoint' },
};

const fin = v => typeof v === 'number' && Number.isFinite(v);

export function sanitizeReviveConfig(src) {
  const out = { ...REVIVE_CONFIG };
  if (src && typeof src === 'object') {
    const lim = { window: [1, 600], reviveTime: [0.1, 60], decay: [0, 10], range: [8, 400], ratio: [0.05, 1], iframes: [0, 10],
      wipeDelay: [0, 30], wipeIframes: [0, 10], spread: [0, 400], penaltyCoins: [0, 1], maxDt: [0.001, 1] };
    for (const k of Object.keys(lim)) if (fin(src[k])) out[k] = Math.min(lim[k][1], Math.max(lim[k][0], src[k]));
  }
  return Object.freeze(out);
}

const newSlot = () => ({ downed: false, t: 0, progress: 0, by: -1 });

// checkpoint: {id,x,y} (a kezdőhely); setCheckpoint frissíti (a Sorskő/szilánk-mezőbe lépéskor)
export function createRevive(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const cp = o.checkpoint && fin(o.checkpoint.x) && fin(o.checkpoint.y) ? { id: String(o.checkpoint.id || 'start'), x: o.checkpoint.x, y: o.checkpoint.y } : { id: 'start', x: 0, y: 0 };
  return {
    cfg: sanitizeReviveConfig(o.cfg), slots: [newSlot(), newSlot()], checkpoint: cp, wipeIn: null,
    listeners: new Set(), events: [], stats: { downs: 0, revives: 0, wipes: 0, timeouts: 0 }, lastError: null,
  };
}

export function onRevive(rv, fn) {
  if (!rv || !(rv.listeners instanceof Set) || typeof fn !== 'function') return () => {};
  rv.listeners.add(fn);
  return () => { rv.listeners.delete(fn); };
}

export function setCheckpoint(rv, id, x, y) {
  if (!rv || !fin(x) || !fin(y)) return false;
  rv.checkpoint = { id: String(id || 'cp'), x, y };
  return true;
}

export function isDowned(rv, i) { return !!(rv && rv.slots[i] && rv.slots[i].downed); }

function emit(rv, ev, out) {
  out.push(ev);
  rv.events.push(ev);
  if (rv.events.length > rv.cfg.maxEvents) rv.events.splice(0, rv.events.length - rv.cfg.maxEvents);
  for (const fn of [...rv.listeners]) {
    try { fn(ev); } catch (e) { rv.lastError = String(e && e.message ? e.message : e); }
  }
}

function dist(a, b) {
  if (!a || !b || !fin(a.x) || !fin(a.y) || !fin(b.x) || !fin(b.y)) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const holds = inp => !!inp && (inp.interact === true || inp.interactPressed === true);

function blank(inp) {
  const out = {};
  if (inp && typeof inp === 'object') for (const k of Object.keys(inp)) out[k] = typeof inp[k] === 'number' ? 0 : typeof inp[k] === 'boolean' ? false : inp[k];
  return out;
}

// Bemenet-kapu (a stepMenus UTÁN, minden más ELŐTT): az elesett játékos bemenete üres (nem mozog, nem cselekszik, de a pórázon húzható);
// az élesztő interakció-gombja el van nyelve, amíg az elesett társ a hatótávban van (különben közben gyűjtene/élesztene és nyitna).
// Másolatot ad, az eredeti bemenetet nem módosítja.
export function reviveGate(rv, inputs, players) {
  if (!rv || !Array.isArray(inputs)) return inputs;
  const out = inputs.slice();
  for (let i = 0; i < 2; i++) {
    if (isDowned(rv, i)) out[i] = blank(inputs[i]);
  }
  for (let i = 0; i < 2; i++) {
    const j = 1 - i;
    if (isDowned(rv, j) && !isDowned(rv, i) && Array.isArray(players) && dist(players[i], players[j]) <= rv.cfg.range && out[i]) {
      out[i] = { ...out[i], interact: false, interactPressed: false };
    }
  }
  return out;
}

function penalize(wallets, i, ratio) {
  const w = Array.isArray(wallets) ? wallets[i] : null;
  if (!w || ratio <= 0) return 0;
  const n = Math.floor(balance(w) * ratio);
  return n > 0 && withdraw(w, n) ? n : 0;
}

function doWipe(rv, ctx, reason, out) {
  const { players, healths, wallets } = ctx;
  const c = rv.checkpoint, cfg = rv.cfg, lost = [0, 0];
  for (let i = 0; i < 2; i++) {
    const p = players[i], h = healths[i];
    if (p) {
      p.x = c.x + (i === 0 ? -cfg.spread : cfg.spread);
      p.y = c.y;
      p.vx = 0; p.vy = 0; p.kbx = 0; p.kby = 0;
    }
    lost[i] = penalize(wallets, i, cfg.penaltyCoins);
    if (isHealth(h)) {
      if (h.dead) revive(h, cfg.ratio);
      setInvulnerable(h, cfg.wipeIframes);
    }
    rv.slots[i] = newSlot();
  }
  rv.wipeIn = null;
  rv.stats.wipes++;
  if (reason === 'timeout') rv.stats.timeouts++;
  emit(rv, { type: 'wipe', reason, x: c.x, y: c.y, checkpoint: c.id, lost }, out);
}

// ctx = {players[2], healths[2], wallets?[2], inputs[2] (a kapu ELŐTTI, szűrt bemenet: itt az élesztő gombja látszik), speed?(i)->szorzó}
// -> a kocka eseményei: down{player} | revive{player,by} | wipe{reason timeout|all,x,y,checkpoint,lost[2]}; sosem dob
export function stepRevive(rv, ctx, dt) {
  const out = [];
  if (!rv || !ctx || !Array.isArray(ctx.players) || !Array.isArray(ctx.healths) || !fin(dt) || dt <= 0) return out;
  const cfg = rv.cfg, d = Math.min(dt, cfg.maxDt), { players, healths } = ctx;
  const inputs = Array.isArray(ctx.inputs) ? ctx.inputs : [];
  try {
    for (let i = 0; i < 2; i++) {
      const h = healths[i], s = rv.slots[i];
      if (!isHealth(h)) continue;
      if (h.dead && !s.downed) {
        rv.slots[i] = { downed: true, t: cfg.window, progress: 0, by: -1 };
        rv.stats.downs++;
        emit(rv, { type: 'down', player: i }, out);
      } else if (!h.dead && s.downed) { // külső élesztés (pl. fejlesztői segéd): állapot-reset
        rv.slots[i] = newSlot();
        emit(rv, { type: 'revive', player: i, by: -1 }, out);
      }
    }
    for (let i = 0; i < 2; i++) {
      const s = rv.slots[i], h = healths[i], j = 1 - i;
      if (!s.downed) continue;
      const near = isHealth(healths[j]) && !healths[j].dead && !rv.slots[j].downed && dist(players[i], players[j]) <= cfg.range;
      const hold = near && holds(inputs[j]);
      if (hold) {
        let m = 1;
        if (typeof ctx.speed === 'function') { try { const x = ctx.speed(j); if (fin(x) && x > 0) m = Math.min(x, 10); } catch (e) { rv.lastError = String(e && e.message ? e.message : e); } }
        s.progress = Math.min(1, s.progress + d * m / cfg.reviveTime);
        s.by = j;
      } else {
        s.progress = Math.max(0, s.progress - d * cfg.decay / cfg.reviveTime);
        s.by = -1;
        s.t -= d;
      }
      if (s.progress >= 1) {
        revive(h, cfg.ratio);
        setInvulnerable(h, cfg.iframes);
        rv.slots[i] = newSlot();
        rv.stats.revives++;
        emit(rv, { type: 'revive', player: i, by: j }, out);
      }
    }
    const downed = [0, 1].filter(i => rv.slots[i].downed);
    const timeout = downed.some(i => rv.slots[i].t <= 0);
    if (downed.length === 2 || timeout) {
      if (timeout) doWipe(rv, ctx, 'timeout', out);
      else {
        rv.wipeIn = rv.wipeIn === null ? cfg.wipeDelay : rv.wipeIn - d;
        if (rv.wipeIn <= 0) doWipe(rv, ctx, 'all', out);
      }
    } else rv.wipeIn = null;
  } catch (e) { rv.lastError = String(e && e.message ? e.message : e); }
  return out;
}

// Nézet-modell a rajzhoz: {downed, secs (hátralévő mp), progress 0..1, by, wipeIn}
export function reviveView(rv, i) {
  const s = rv && rv.slots ? rv.slots[i] : null;
  if (!s) return { downed: false, secs: 0, progress: 0, by: -1, wipeIn: null };
  return { downed: s.downed, secs: Math.max(0, s.t), progress: s.progress, by: s.by, wipeIn: rv.wipeIn };
}
