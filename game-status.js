// Státuszhatások (S072): égés, fagyás, méreg, lassítás, sötétség. Tiszta logika, DOM és canvas nélkül; importja: game-health.
// A játékosokra (index 0|1) érvényes; az ellenfelek égése/fagya külön él (game-wizard/game-combo). Az adat a fájl elején van (külön data-status.js nincs: lépés-limit).
// Időzítő: minden státusznak van hátralévő ideje; a halmozás a def.stacking szerint: 'refresh' (az idő visszaáll, 1 stack), 'stack' (+stack, az idő visszaáll),
// 'extend' (az idő nő, a def.maxSecs-ig). def.cancels: az új státusz leveri a felsoroltakat (tűz olvaszt, fagy olt).
// Sebzés (DoT): def.dot {type, dps}: a sebzés a Health-en át megy (ellenállás érvényes, i-frame NEM véd), tag 'status', source 'status:<id>'; ezt a kötés nem alakítja újra státusszá.
// Kötés (connectStatuses): a játékos sebzés-eseménye a def-tábla szerint státuszt ad (tűz->égés, fagy->lassítás, méreg->méreg, sötétség->sötétség; a tag = státusz-id közvetlenül is).
// Tisztítás: cleanseStatuses (a game-healer env.cleanse horga), halál/visszatérés: clearStatuses. A státusz NINCS mentve (rövid életű).
// Hatás: effectsOf -> {speedMul, visionMul, dps}; applyStatusSpeed a p.speedMul-t szorozza (a syncEncumbrance UTÁN, kockánként); syncStatusesToPlayers: p.statuses / p.statusFx (a healer és a HUD olvassa).
import { isHealth, applyDamage, onHealth } from './game-health.js';

export const STATUS_IDS = Object.freeze(['burn', 'freeze', 'poison', 'slow', 'darkness']);

const def = o => Object.freeze({ harmful: true, maxStacks: 1, maxSecs: 600, speedMul: 1, visionMul: 1, cancels: Object.freeze([]), dot: null, ...o,
  cancels: Object.freeze(o.cancels || []), dot: o.dot ? Object.freeze({ ...o.dot }) : null });

// speedMul/visionMul: STACKENKÉNT szorzódik (n stack -> érték^n); dot.dps: stackenként
export const STATUS_DEFS = Object.freeze({
  burn: def({ order: 1, secs: 4, stacking: 'refresh', dot: { type: 'fire', dps: 3 }, cancels: ['freeze'], color: '#ff8a3d' }),
  freeze: def({ order: 2, secs: 3, stacking: 'extend', maxSecs: 6, speedMul: 0.4, cancels: ['burn'], color: '#7fd8ff' }),
  poison: def({ order: 3, secs: 8, stacking: 'stack', maxStacks: 5, dot: { type: 'poison', dps: 1 }, color: '#6fd35a' }),
  slow: def({ order: 4, secs: 5, stacking: 'stack', maxStacks: 3, speedMul: 0.8, color: '#c8a2ff' }),
  darkness: def({ order: 5, secs: 10, stacking: 'refresh', speedMul: 0.85, visionMul: 0.5, color: '#8a7bd6' }),
});

// sebzés-típus -> státusz (a 'physical' és a 'heat' nem; a hőség a S088 zónáké)
export const STATUS_ON_DAMAGE = Object.freeze({ fire: 'burn', frost: 'slow', poison: 'poison', dark: 'darkness' });

export const STATUS_CONFIG = Object.freeze({
  tick: 0.5,          // mp: a DoT ennyi időnként csapódik le (a lejáratkor a maradék is)
  minSpeedMul: 0.25,  // a státuszok együttes sebesség-szorzójának alja
  minVisionMul: 0.25,
  maxDt: 1,
  maxSecs: 600,
  maxPower: 10,
  maxEvents: 64,
});

export const STATUS_TEXTS = {
  hu: { 'status.burn': 'Égés', 'status.freeze': 'Fagyás', 'status.poison': 'Méreg', 'status.slow': 'Lassítás', 'status.darkness': 'Sötétség' },
  en: { 'status.burn': 'Burning', 'status.freeze': 'Frozen', 'status.poison': 'Poisoned', 'status.slow': 'Slowed', 'status.darkness': 'Darkness' },
};

const fin = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const okPlayer = i => i === 0 || i === 1;

export function sanitizeStatusConfig(src) {
  const out = { ...STATUS_CONFIG };
  if (src && typeof src === 'object') {
    const lim = { tick: [0.05, 5], minSpeedMul: [0.05, 1], minVisionMul: [0.05, 1], maxDt: [0.001, 10], maxSecs: [1, 3600], maxPower: [1, 100] };
    for (const k of Object.keys(lim)) if (fin(src[k])) out[k] = clamp(src[k], lim[k][0], lim[k][1]);
    if (fin(src.maxEvents)) out.maxEvents = clamp(Math.round(src.maxEvents), 1, 1024);
  }
  return Object.freeze(out);
}

// opts: {healths [Health, Health] (DoT + halott nem kap), guard(i, id) -> 0..1 védelem (1 = immunis; az idő (1-r)-szeres), cfg}
export function createStatuses(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  return {
    cfg: sanitizeStatusConfig(o.cfg), slots: [new Map(), new Map()], healths: Array.isArray(o.healths) ? o.healths : [],
    guard: typeof o.guard === 'function' ? o.guard : null, listeners: new Set(), events: [],
    stats: { applied: 0, refreshed: 0, stacked: 0, expired: 0, cancelled: 0, cleansed: 0, cleared: 0, ticks: 0, dot: 0, refused: 0 }, lastError: null,
  };
}

export function onStatus(ss, fn) {
  if (!ss || !(ss.listeners instanceof Set) || typeof fn !== 'function') return () => {};
  ss.listeners.add(fn);
  return () => { ss.listeners.delete(fn); };
}

function emit(ss, ev, out) {
  ss.events.push(ev);
  if (ss.events.length > ss.cfg.maxEvents) ss.events.shift();
  if (out) out.push(ev);
  for (const fn of [...ss.listeners]) {
    try { fn(ev); } catch (e) { ss.lastError = String(e && e.message ? e.message : e); }
  }
}

const healthOf = (ss, i) => (ss.healths && isHealth(ss.healths[i]) ? ss.healths[i] : null);
const refuse = reason => ({ ok: false, reason, stacks: 0, left: 0, mode: null });

// -> {ok, reason (bad-status|bad-player|bad-opts|dead|immune|null), stacks, left, mode: 'new'|'refresh'|'stack'|'extend'}
export function applyStatus(ss, i, id, opts) {
  if (!ss || !Array.isArray(ss.slots)) return refuse('bad-status');
  const d = STATUS_DEFS[id];
  if (!d || !Object.prototype.hasOwnProperty.call(STATUS_DEFS, id)) { if (ss.stats) ss.stats.refused++; return refuse('bad-status'); }
  if (!okPlayer(i)) { ss.stats.refused++; return refuse('bad-player'); }
  const q = opts && typeof opts === 'object' ? opts : {};
  if ((q.secs !== undefined && !(fin(q.secs) && q.secs > 0)) || (q.stacks !== undefined && !(fin(q.stacks) && q.stacks >= 1))
    || (q.power !== undefined && !(fin(q.power) && q.power >= 0))) { ss.stats.refused++; return refuse('bad-opts'); }
  const h = healthOf(ss, i);
  if (h && h.dead) { ss.stats.refused++; return refuse('dead'); }
  let r = 0;
  if (ss.guard) { try { const g = ss.guard(i, id); if (fin(g)) r = clamp(g, 0, 1); } catch (e) { ss.lastError = String(e && e.message ? e.message : e); } }
  if (r >= 1) { ss.stats.refused++; return refuse('immune'); }
  const cfg = ss.cfg, map = ss.slots[i];
  const secs = Math.min(cfg.maxSecs, d.maxSecs, (fin(q.secs) ? q.secs : d.secs) * (1 - r));
  const add = Math.min(d.maxStacks, Math.max(1, Math.floor(fin(q.stacks) ? q.stacks : 1)));
  const power = Math.min(cfg.maxPower, fin(q.power) ? q.power : 1);
  const out = [];
  for (const c of d.cancels) {
    if (map.delete(c)) { ss.stats.cancelled++; emit(ss, { type: 'cancel', player: i, id: c, by: id }, out); }
  }
  const cur = map.get(id);
  let mode = 'new';
  if (!cur) {
    map.set(id, { id, left: secs, max: secs, stacks: d.stacking === 'stack' ? add : 1, power, tickT: 0, acc: 0, source: q.source === undefined ? null : q.source });
    ss.stats.applied++;
  } else if (d.stacking === 'stack') {
    cur.stacks = Math.min(d.maxStacks, cur.stacks + add); cur.left = Math.max(cur.left, secs); cur.max = Math.max(cur.max, cur.left); cur.power = Math.max(cur.power, power);
    mode = 'stack'; ss.stats.stacked++;
  } else if (d.stacking === 'extend') {
    cur.left = Math.min(d.maxSecs, cfg.maxSecs, cur.left + secs); cur.max = Math.max(cur.max, cur.left);
    mode = 'extend'; ss.stats.refreshed++;
  } else {
    cur.left = Math.max(cur.left, secs); cur.max = Math.max(cur.max, cur.left); cur.power = Math.max(cur.power, power);
    mode = 'refresh'; ss.stats.refreshed++;
  }
  const s = map.get(id);
  emit(ss, { type: mode === 'new' ? 'apply' : mode, player: i, id, stacks: s.stacks, left: s.left }, out);
  return { ok: true, reason: null, stacks: s.stacks, left: s.left, mode };
}

export function statusOf(ss, i, id) {
  const s = ss && Array.isArray(ss.slots) && okPlayer(i) ? ss.slots[i].get(id) : null;
  return s ? { id: s.id, left: s.left, max: s.max, stacks: s.stacks } : null;
}
export function hasStatus(ss, i, id) { return !!statusOf(ss, i, id); }

// [{id, left, max, stacks, ratio, color}] a def.order szerint
export function listStatuses(ss, i) {
  if (!ss || !Array.isArray(ss.slots) || !okPlayer(i)) return [];
  return [...ss.slots[i].values()].sort((a, b) => STATUS_DEFS[a.id].order - STATUS_DEFS[b.id].order)
    .map(s => ({ id: s.id, left: s.left, max: s.max, stacks: s.stacks, ratio: s.max > 0 ? clamp(s.left / s.max, 0, 1) : 0, color: STATUS_DEFS[s.id].color }));
}

// Együttes hatás: {speedMul, visionMul, dps} (nincs státusz -> 1, 1, 0)
export function effectsOf(ss, i) {
  const fx = { speedMul: 1, visionMul: 1, dps: 0 };
  if (!ss || !Array.isArray(ss.slots) || !okPlayer(i)) return fx;
  for (const s of ss.slots[i].values()) {
    const d = STATUS_DEFS[s.id];
    fx.speedMul *= Math.pow(d.speedMul, s.stacks);
    fx.visionMul *= Math.pow(d.visionMul, s.stacks);
    if (d.dot) fx.dps += d.dot.dps * s.stacks * s.power;
  }
  fx.speedMul = Math.max(ss.cfg.minSpeedMul, fx.speedMul);
  fx.visionMul = Math.max(ss.cfg.minVisionMul, fx.visionMul);
  return fx;
}

// A káros státuszok (vagy a felsorolt id-k közül a károsak) eltávolítása. -> az eltávolítottak száma. A healer env.cleanse horga: (p, info) => cleanseStatuses(ss, info.target)
export function cleanseStatuses(ss, i, ids) {
  if (!ss || !Array.isArray(ss.slots) || !okPlayer(i)) return 0;
  const only = Array.isArray(ids) ? ids : null;
  let n = 0;
  for (const [id] of [...ss.slots[i]]) {
    if (!STATUS_DEFS[id].harmful || (only && !only.includes(id))) continue;
    ss.slots[i].delete(id); n++; ss.stats.cleansed++;
    emit(ss, { type: 'cleanse', player: i, id });
  }
  return n;
}

// Minden státusz törlése (halál, visszatérés). i nélkül mindkét játékos. -> db
export function clearStatuses(ss, i, reason) {
  if (!ss || !Array.isArray(ss.slots)) return 0;
  const who = i === undefined || i === null ? [0, 1] : okPlayer(i) ? [i] : [];
  let n = 0;
  for (const j of who) {
    const k = ss.slots[j].size;
    if (!k) continue;
    ss.slots[j].clear(); n += k; ss.stats.cleared += k;
    emit(ss, { type: 'clear', player: j, count: k, reason: typeof reason === 'string' ? reason : null });
  }
  return n;
}

function flush(ss, i, s, d, out) {
  const amount = s.acc; s.acc = 0; s.tickT = 0;
  const h = healthOf(ss, i);
  if (!h || !(amount > 0)) return;
  const r = applyDamage(h, { amount, type: d.dot.type, source: 'status:' + s.id, tag: 'status', ignoreInvuln: true });
  ss.stats.ticks++;
  if (r.ok) { ss.stats.dot += r.dealt; emit(ss, { type: 'dot', player: i, id: s.id, amount: r.dealt, killed: r.killed }, out); }
}

// Egy kocka: az időzítők fogynak, a DoT lecsap, a lejártak kikerülnek; a halott játékos státuszai törlődnek. -> a kocka eseményei
export function stepStatuses(ss, dt) {
  const out = [];
  if (!ss || !Array.isArray(ss.slots) || !fin(dt) || dt <= 0) return out;
  const t = Math.min(dt, ss.cfg.maxDt);
  for (let i = 0; i < 2; i++) {
    const map = ss.slots[i];
    if (!map.size) continue;
    const h = healthOf(ss, i);
    if (h && h.dead) { clearStatuses(ss, i, 'dead'); continue; }
    for (const [id, s] of [...map]) {
      const d = STATUS_DEFS[id], part = Math.min(t, s.left);
      s.left -= t;
      const over = s.left <= 1e-9;
      if (d.dot && part > 0) { s.acc += d.dot.dps * s.stacks * s.power * part; s.tickT += part; }
      if (d.dot && s.acc > 0 && (s.tickT >= ss.cfg.tick - 1e-9 || over)) flush(ss, i, s, d, out);
      if (healthOf(ss, i) && healthOf(ss, i).dead) { clearStatuses(ss, i, 'dead'); break; }
      if (over) { map.delete(id); ss.stats.expired++; emit(ss, { type: 'expire', player: i, id }, out); }
    }
  }
  return out;
}

// A játékos sebzés-eseményeiből státusz (a Health listenerén át); a DoT (tag 'status') nem alakul vissza. A halál törli a státuszokat. -> detach()
export function connectStatuses(ss) {
  const offs = [];
  if (!ss || !Array.isArray(ss.healths)) return () => {};
  for (let i = 0; i < 2; i++) {
    const h = ss.healths[i];
    if (!isHealth(h)) continue;
    offs.push(onHealth(h, ev => {
      if (!ev) return;
      if (ev.type === 'death') { clearStatuses(ss, i, 'death'); return; }
      if (ev.type !== 'damage' || ev.tag === 'status') return;
      const id = STATUS_IDS.includes(ev.tag) ? ev.tag : STATUS_ON_DAMAGE[ev.kind];
      if (id) applyStatus(ss, i, id, { source: ev.source });
    }));
  }
  return () => { for (const off of offs) off(); };
}

// p.speedMul *= státusz-szorzó (a syncEncumbrance UTÁN hívandó, mert az kockánként újraírja a p.speedMul-t). -> az érintett játékosok száma
export function applyStatusSpeed(ss, players) {
  if (!ss || !Array.isArray(players)) return 0;
  let n = 0;
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    if (!p || typeof p !== 'object') continue;
    const m = effectsOf(ss, i).speedMul;
    if (m === 1) continue;
    p.speedMul = (fin(p.speedMul) ? p.speedMul : 1) * m; n++;
  }
  return n;
}

// p.statuses = [{id,left,max,stacks}] (a game-healer és a HUD olvassa), p.statusFx = effectsOf. -> a szinkronizált játékosok száma
export function syncStatusesToPlayers(ss, players) {
  if (!ss || !Array.isArray(players)) return 0;
  let n = 0;
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    if (!p || typeof p !== 'object') continue;
    p.statuses = listStatuses(ss, i).map(s => ({ id: s.id, left: s.left, max: s.max, stacks: s.stacks }));
    p.statusFx = effectsOf(ss, i);
    n++;
  }
  return n;
}
