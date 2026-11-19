// game-combathud.js (S074) – HARC HUD logika: képesség-sáv (2 gomb: cooldown + erőforrás), ellenség-életcsík, lebegő sebzés-számok.
// Tiszta logika (nincs DOM/canvas); a rajz: render-combathud.js. Importja: game-hud (hudLayout), game-health (onHealth, healthRatio),
// game-enemy (onEnemy), game-ability (abilityView), game-registry (getClass).
// A sáv a játékos HUD-panelje FÖLÖTT van (a fő vásznon, fix sarokban: osztott és összeolvadt képernyőn is ugyanott olvasható);
// az életcsík és a számok VILÁG-koordinátájúak (nézetenként a nézet eltolásával rajzolódnak). A HP/állóképesség a meglévő HUD-panelben marad (S029).
import { hudLayout, HUD_CONFIG } from './game-hud.js';
import { onHealth, healthRatio } from './game-health.js';
import { onEnemy } from './game-enemy.js';
import { abilityView } from './game-ability.js';
import { getClass } from './game-registry.js';

export const COMBATHUD_CONFIG = Object.freeze({
  strip: Object.freeze({ h: 20, slot: 20, gap: 2, above: 2, poolW: 72, poolH: 10, poolGap: 4 }), // sáv: a HUD fölött `above` px-szel
  numbers: Object.freeze({ life: 0.9, rise: 26, max: 48, merge: 0.12, spread: 8, big: 20 }),     // lebegő számok: élettartam mp, emelkedés px, korlát, összevonás ablaka mp
  bars: Object.freeze({ w: 28, h: 4, dy: 5, show: 4, maxView: 64 }),                              // ellenség-életcsík: méret, a fej fölötti távolság, sebzés után ennyi mp-ig látszik
  maxDt: 1,
});
/** A státusz-ikon sor ennyivel kerül feljebb (sáv magassága + köz): a render-status használja. */
export const STRIP_LIFT = COMBATHUD_CONFIG.strip.h + COMBATHUD_CONFIG.strip.above;

export const COMBATHUD_TEXTS = {
  hu: { 'hud.mana': 'MANA', 'hud.focus': 'FÓK' },
  en: { 'hud.mana': 'MANA', 'hud.focus': 'FOC' },
};

const fin = v => typeof v === 'number' && Number.isFinite(v);

// ---- képesség-sáv ----
/** A sáv téglalapjai az i. játékosnál: {x,y,w,h, slots[2], pool}. P1 balra igazított (jobbra nő), P2 jobbra igazított (balra nő). Hibás bemenet -> null. */
export function stripLayout(index, vw, vh, cfg = HUD_CONFIG, cc = COMBATHUD_CONFIG) {
  if (![vw, vh].every(fin)) return null;
  const idx = index === 1 ? 1 : 0, h = hudLayout(idx, vw, vh, cfg), s = cc.strip, y = h.y - s.above - s.h, step = s.slot + s.gap;
  const slots = [0, 1].map(k => ({ x: idx === 1 ? h.x + h.w - s.slot - k * step : h.x + k * step, y, w: s.slot, h: s.slot }));
  const edge = idx === 1 ? slots[1].x - s.poolGap - s.poolW : slots[1].x + s.slot + s.poolGap;
  return { x: h.x, y, w: h.w, h: s.h, slots, pool: { x: edge, y: y + Math.round((s.h - s.poolH) / 2), w: s.poolW, h: s.poolH } };
}

/** Másodperc-felirat a cooldownhoz: 0 -> '', >= 10 egész (felfelé), alatta egy tizedes. */
export function fmtSecs(s) {
  if (!fin(s) || s <= 0) return '';
  return s >= 10 ? String(Math.ceil(s)) : (Math.ceil(s * 10) / 10).toFixed(1);
}
/** A képesség 2 betűs jelzése a nevéből (nincs ikon: S103); üres -> a tartalék. */
export function slotLabel(name, fallback = '?') {
  const s = String(name == null ? '' : name).replace(/[^\p{L}\p{N}]/gu, '');
  return s ? s.slice(0, 2).toUpperCase() : fallback;
}

/**
 * Az i. játékos sávjának adata az abilityView-ból: slots[{slot,key,id,empty,label,name,remaining,secs,ratio,ready,affordable,resource,cost}],
 * pool = a kaszt mana/fókusz készlete {res,value,max,ratio,textKey} | null (a stamina a HUD-panelben van). tr(kulcs) -> szöveg (alap: a kulcs). Sosem dob.
 */
export function stripModel(abilitySys, players, i, tr = k => k) {
  const out = { index: i === 1 ? 1 : 0, slots: [], pool: null };
  let v = null;
  try { v = abilitySys && Array.isArray(players) && players[i] ? abilityView(abilitySys, players, i) : null; } catch (e) { v = null; }
  const slots = v && Array.isArray(v.slots) ? v.slots : [];
  for (let k = 0; k < 2; k++) {
    const s = slots[k];
    if (!s || !s.id) { out.slots.push({ slot: k, key: String(k + 1), id: null, empty: true, label: '', name: '', remaining: 0, secs: '', ratio: 0, ready: false, affordable: false, resource: null, cost: 0 }); continue; }
    const name = String(tr(s.nameKey) || s.id), rem = fin(s.remaining) && s.remaining > 0 ? s.remaining : 0;
    out.slots.push({
      slot: k, key: String(k + 1), id: s.id, empty: false, label: slotLabel(name, s.id.slice(0, 2).toUpperCase()), name, remaining: rem, secs: fmtSecs(rem),
      ratio: fin(s.ratio) ? Math.min(1, Math.max(0, s.ratio)) : 0, ready: s.ready === true, affordable: s.affordable === true, resource: s.resource || null, cost: fin(s.cost) ? s.cost : 0,
    });
  }
  const p = players && players[i];
  let res = null;
  try { const c = p && p.class ? getClass(abilitySys.reg, p.class) : null; res = c && c.resource; } catch (e) { res = null; }
  if (res !== 'mana' && res !== 'focus') res = (out.slots.find(s => s.resource === 'mana' || s.resource === 'focus') || {}).resource || null;
  const pv = res && v && v.pools ? v.pools[res] : null;
  if (pv && fin(pv.max) && pv.max > 0) {
    const value = fin(pv.value) ? Math.min(pv.max, Math.max(0, pv.value)) : 0;
    out.pool = { res, value, max: pv.max, ratio: value / pv.max, textKey: 'hud.' + res };
  }
  return out;
}

// ---- lebegő számok + életcsík-időzítők ----
export function createCombatHud(opts) {
  const cc = (opts && opts.cfg) || COMBATHUD_CONFIG;
  return { cfg: cc, numbers: [], hit: new Map(), off: new Map(), pl: new Map(), sys: new Map(), detach: [], time: 0, seq: 0, stats: { numbers: 0, merged: 0, dropped: 0, hits: 0 }, lastError: null };
}

/** Szám hozzáadása. kind: 'enemy' (az ellenfél sebződött) | 'player' | 'heal'; key = a cél azonosítója (az azonos kind+type+key gyors egymásutánja összevonódik). -> a szám | null. */
export function addNumber(ch, { x, y, amount, kind, type, key, dot }) {
  if (!ch || !fin(x) || !fin(y) || !fin(amount) || !(amount > 0)) return null;
  const k = kind === 'player' || kind === 'heal' ? kind : 'enemy', nc = ch.cfg.numbers;
  for (let i = ch.numbers.length - 1; i >= 0; i--) {
    const n = ch.numbers[i];
    if (n.kind === k && n.type === type && n.key === key && n.dot === !!dot && n.t < nc.merge) { n.amount += amount; n.t = 0; n.big = n.amount >= nc.big; ch.stats.merged++; return n; }
  }
  const n = { x, y, amount, kind: k, type: type || 'physical', key, dot: !!dot, t: 0, life: nc.life, big: amount >= nc.big, dx: ((ch.seq * 37) % 17 - 8) * (nc.spread / 8) };
  ch.seq++;
  ch.numbers.push(n); ch.stats.numbers++;
  while (ch.numbers.length > nc.max) { ch.numbers.shift(); ch.stats.dropped++; }
  return n;
}

/** Szám-felirat: >= 10 egész, alatta egy tizedes (a .0 elmarad); heal '+' előtaggal. */
export function fmtAmount(a, kind) {
  if (!fin(a) || a <= 0) return '';
  const s = a >= 10 ? String(Math.round(a)) : String(Math.round(a * 10) / 10);
  return (kind === 'heal' ? '+' : '') + s;
}

function hookEnemy(ch, e) {
  if (!e || !e.health || ch.off.has(e)) return;
  const off = onHealth(e.health, ev => {
    if (ev.type !== 'damage' || !(ev.amount > 0)) return;
    ch.hit.set(e, ch.cfg.bars.show); ch.stats.hits++;
    addNumber(ch, { x: e.x, y: e.y - (e.h || 16) / 2, amount: ev.amount, kind: 'enemy', type: ev.kind, key: 'e' + e.id, dot: ev.tag === 'status' });
  });
  ch.off.set(e, off);
}

/**
 * Összeköti a HUD-ot a játékos-Health-ekkel és az ellenség-rendszerrel (a meglévő és az újonnan született ellenfelekre is).
 * env {players, healths, enemySys}; bármelyik hiányozhat. -> detach() (minden figyelőt leszed).
 */
export function connectCombatHud(ch, env) {
  const e = env || {}, offs = [];
  if (Array.isArray(e.healths)) e.healths.forEach((h, i) => {
    if (!h || !h.listeners || ch.pl.has(h)) return; // egy Health-et egyszer figyelünk (a kétszeri kötés nem dupláz)
    const off = onHealth(h, ev => {
      const p = e.players && e.players[i]; if (!p || !fin(p.x) || !fin(p.y)) return;
      if (ev.type === 'damage' && ev.amount > 0) addNumber(ch, { x: p.x, y: p.y - 14, amount: ev.amount, kind: 'player', type: ev.kind, key: 'p' + i, dot: ev.tag === 'status' });
      else if (ev.type === 'heal' && ev.amount > 0) addNumber(ch, { x: p.x, y: p.y - 14, amount: ev.amount, kind: 'heal', type: 'heal', key: 'p' + i });
    });
    ch.pl.set(h, off); offs.push(() => { off(); ch.pl.delete(h); });
  });
  if (e.enemySys) {
    for (const en of e.enemySys.list) hookEnemy(ch, en);
    if (!ch.sys.has(e.enemySys)) {
      const off = onEnemy(e.enemySys, ev => {
        if (ev.type === 'spawn') hookEnemy(ch, ev.e);
        else if (ev.type === 'died' && ev.e) { const o = ch.off.get(ev.e); if (o) o(); ch.off.delete(ev.e); ch.hit.delete(ev.e); }
      });
      ch.sys.set(e.enemySys, off); offs.push(() => { off(); ch.sys.delete(e.enemySys); });
    }
  }
  const detach = () => { for (const o of offs) o(); for (const o of ch.off.values()) o(); ch.off.clear(); };
  ch.detach.push(detach);
  return detach;
}

/** Egy lépés: a számok öregednek, az életcsík-időzítők fogynak. dt szorítva (0..maxDt). */
export function stepCombatHud(ch, dt) {
  if (!ch) return;
  const d = fin(dt) && dt > 0 ? Math.min(dt, ch.cfg.maxDt) : 0;
  ch.time += d;
  for (const n of ch.numbers) n.t += d;
  ch.numbers = ch.numbers.filter(n => n.t < n.life);
  for (const [e, left] of ch.hit) { const r = left - d; if (r > 0 && e.health && !e.health.dead) ch.hit.set(e, r); else ch.hit.delete(e); }
}

/**
 * A nézetben látható számok: [{text,x,y,alpha,kind,type,big,dot}] képernyő-koordinátában (ox,oy = a nézet bal-felső sarka a világban). Az `out` újrahasznosítható.
 * Az emelkedés lassuló (ease-out); az utolsó 40% alatt halványul.
 */
export function visibleNumbers(ch, ox, oy, vw, vh, out = []) {
  out.length = 0;
  if (!ch || ![ox, oy, vw, vh].every(fin)) return out;
  const rise = ch.cfg.numbers.rise;
  for (const n of ch.numbers) {
    const k = Math.min(1, n.t / n.life), e = 1 - (1 - k) * (1 - k);
    const x = Math.round(n.x + n.dx - ox), y = Math.round(n.y - rise * e - oy);
    if (x < -30 || y < -20 || x > vw + 30 || y > vh + 20) continue;
    out.push({ text: fmtAmount(n.amount, n.kind), x, y, alpha: k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.4), kind: n.kind, type: n.type, big: n.big, dot: n.dot });
  }
  return out;
}

/**
 * A nézetben látható ellenség-életcsíkok: [{x,y,w,h,ratio,state,frozen}] képernyő-koordinátában (x,y = a csík bal-felső sarka).
 * Látszik: él, és (sérült VAGY a sebzés óta nem telt le a `bars.show` mp VAGY üldöz/támad/visszahúzódik). Teljes életű nyugvó ellenfélnek nincs csík.
 */
export function enemyBars(ch, enemySys, ox, oy, vw, vh, out = []) {
  out.length = 0;
  if (!ch || !enemySys || !Array.isArray(enemySys.list) || ![ox, oy, vw, vh].every(fin)) return out;
  const b = ch.cfg.bars;
  for (const e of enemySys.list) {
    if (out.length >= b.maxView) break;
    if (!e || !e.health || e.health.dead || !fin(e.x) || !fin(e.y)) continue;
    const ratio = healthRatio(e.health), engaged = e.state === 'chase' || e.state === 'attack' || e.state === 'retreat';
    if (!(ratio < 1 || engaged || ch.hit.has(e))) continue;
    const x = Math.round(e.x - b.w / 2 - ox), y = Math.round(e.y - (e.h || 16) / 2 - b.dy - b.h - oy);
    if (x + b.w < 0 || y + b.h < 0 || x > vw || y > vh) continue;
    out.push({ x, y, w: b.w, h: b.h, ratio: Math.min(1, Math.max(0, ratio)), state: e.state, frozen: fin(e.frozen) && e.frozen > 0 });
  }
  return out;
}
