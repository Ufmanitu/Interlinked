// game-tetherlash.js – A PÓRÁZ MINT FEGYVER: LENDÍTÉS (S073; opcionális képesség; tiszta logika, DOM és canvas nélkül).
// Importja: game-enemy (damageEnemy), game-combat (hurtbox, startKnockback, flashSpark), game-warrior (segmentHit), game-health (applyDamage).
// A feszes fonal (a tengelyenkénti stretch >= minStretch) két végpontja a játékos. Ha a két vég a fonalra MERŐLEGESEN eltérően mozog (swing:
// |n·(vB - vA)| >= minSwing: a fonal FOROG, nem csak együtt csúszik), a fonal az útjába kerülő ellenséget megsebzi és oldalra löki.
// A találat-sebesség: a fonal sebessége az ellenség helyén (a két végpont súlyozott átlaga), merőleges összetevő, az ellenség sebességéhez mérve.
// A két játékos együtt futva (azonos sebesség) sosem lendít véletlenül. Nincs baráti tűz, a lendítés a játékosokat nem érinti.
// Ellenségenként cooldown (egy lendítés egyszer talál). Ha bármelyik játékos elesett, nincs lendítés (az elesettet húzzák, nem forgatják).
import { damageEnemy } from './game-enemy.js';
import { hurtbox, startKnockback, flashSpark } from './game-combat.js';
import { segmentHit } from './game-warrior.js';
import { applyDamage } from './game-health.js';

export const LASH_CONFIG = Object.freeze({
  enabled: true, minStretch: 0.85, minSwing: 140, minSpeed: 150, width: 8,
  damage: 6, perSpeed: 0.03, maxDamage: 24, knock: 48, cooldown: 0.8, maxDt: 0.1, maxEvents: 64,
});

const fin = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (fin(v) ? v : d);

/** Hibás/hiányzó mezők -> alapérték; számoknál nem negatív véges; minStretch 0..2; enabled bool. Befagyasztott másolat. */
export function sanitizeLashConfig(src) {
  const c = { ...LASH_CONFIG };
  if (src && typeof src === 'object') {
    for (const k of Object.keys(c)) {
      if (k === 'enabled') { if (typeof src[k] === 'boolean') c[k] = src[k]; } else if (fin(src[k]) && src[k] >= 0) c[k] = src[k];
    }
  }
  c.minStretch = clamp(c.minStretch, 0, 2);
  return Object.freeze(c);
}

export function createLash({ cfg } = {}) {
  return { cfg: sanitizeLashConfig(cfg), cool: new Map(), time: 0, events: [], listeners: new Set(),
    stats: { lashes: 0, blocked: 0, kills: 0 }, lastError: null };
}
export function onLash(ls, fn) {
  if (!ls || typeof fn !== 'function') return () => {};
  ls.listeners.add(fn); return () => ls.listeners.delete(fn);
}
export function setLashEnabled(ls, on) { if (ls && ls.cfg) ls.cfg = sanitizeLashConfig({ ...ls.cfg, enabled: !!on }); return !!(ls && ls.cfg.enabled); }

function emit(ls, ev) {
  if (ls.events.length < ls.cfg.maxEvents) ls.events.push(ev);
  for (const fn of [...ls.listeners]) { try { fn(ev); } catch (err) { ls.lastError = err; } }
}

/** A fonal forgása: a két végpont merőleges sebesség-különbsége (px/s). Hibás bemenet / egybeeső pontok -> null. */
export function lashFrame(pa, pb) {
  if (!pa || !pb || ![pa.x, pa.y, pb.x, pb.y].every(fin)) return null;
  const dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) return null;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const nvA = nx * num(pa.vx, 0) + ny * num(pa.vy, 0), nvB = nx * num(pb.vx, 0) + ny * num(pb.vy, 0);
  return { len, ux, uy, nx, ny, nvA, nvB, swing: Math.abs(nvB - nvA) };
}
/** A fonal sebessége egy ellenség helyén (az ellenséghez mérve): { speed, sx, sy (a mozgás iránya, egységvektor), s (0..1 a fonal mentén) }. */
export function lashContact(frame, pa, e) {
  if (!frame || !e || !fin(e.x) || !fin(e.y)) return null;
  const s = clamp(((e.x - pa.x) * frame.ux + (e.y - pa.y) * frame.uy) / frame.len, 0, 1);
  const vn = (1 - s) * frame.nvA + s * frame.nvB - (frame.nx * num(e.vx, 0) + frame.ny * num(e.vy, 0));
  const sg = vn >= 0 ? 1 : -1;
  return { speed: Math.abs(vn), sx: frame.nx * sg, sy: frame.ny * sg, s };
}
/** A lendítés sebzése a találat-sebességből: damage + perSpeed·(speed - minSpeed), damage..maxDamage közé szorítva. */
export const lashDamage = (cfg, speed) => clamp(cfg.damage + cfg.perSpeed * Math.max(0, speed - cfg.minSpeed), cfg.damage, Math.max(cfg.damage, cfg.maxDamage));

const alive = e => e && e.state !== 'dead' && !(e.health && e.health.dead);

/** Egy kocka. ctx {players[2], enemySys | enemies, tether (a póráz-rendszer: .stretch {x,y}) | stretch (szám), combat (opcionális: visszalökés + villanás)} -> a kocka eseményei
 *  ({type 'lash'|'blocked', enemy, player, dealt, killed, speed, swing, x, y}). Sosem dob. */
export function stepLash(ls, ctx, dt) {
  if (!ls) return [];
  ls.events = [];
  if (!fin(dt) || dt <= 0) return ls.events;
  dt = Math.min(dt, ls.cfg.maxDt); ls.time += dt;
  for (const [id, t] of [...ls.cool]) { if (t - dt <= 0) ls.cool.delete(id); else ls.cool.set(id, t - dt); }
  try {
    const c = ctx && typeof ctx === 'object' ? ctx : {}, cfg = ls.cfg;
    const pl = Array.isArray(c.players) ? c.players : [];
    if (!cfg.enabled || pl.length < 2 || !pl[0] || !pl[1] || pl[0].dead || pl[1].dead) return ls.events;
    const st = c.tether && c.tether.stretch ? Math.max(num(c.tether.stretch.x, 0), num(c.tether.stretch.y, 0)) : num(c.stretch, 0);
    if (st < cfg.minStretch) return ls.events;
    const fr = lashFrame(pl[0], pl[1]);
    if (!fr || fr.swing < cfg.minSwing) return ls.events;
    const list = Array.isArray(c.enemies) ? c.enemies : (c.enemySys && c.enemySys.list) || [];
    const who = Math.hypot(num(pl[0].vx, 0), num(pl[0].vy, 0)) >= Math.hypot(num(pl[1].vx, 0), num(pl[1].vy, 0)) ? 0 : 1; // a gyorsabb játékos a lendítő (jóváírás)
    for (const e of list) {
      if (!alive(e) || ls.cool.has(e.id)) continue;
      const box = hurtbox(e); if (!box || segmentHit(pl[0].x, pl[0].y, pl[1].x, pl[1].y, box, cfg.width) < 0) continue;
      const ct = lashContact(fr, pl[0], e); if (!ct || ct.speed < cfg.minSpeed) continue;
      const amount = lashDamage(cfg, ct.speed), before = e.health ? e.health.hp : num(e.hp, 0);
      let killed = false;
      if (c.enemySys && e.health) killed = damageEnemy(c.enemySys, e, amount, { player: who, type: 'physical', ability: 'lash' });
      else if (e.health) { applyDamage(e.health, { amount, type: 'physical', source: who }); e.hp = e.health.hp; killed = e.health.dead; }
      else continue;
      const dealt = Math.max(0, before - e.health.hp);
      ls.cool.set(e.id, cfg.cooldown); // találat vagy védett (i-frame/immunitás) is: egy lendítés egyszer talál
      if (dealt > 0) {
        ls.stats.lashes++; if (killed) ls.stats.kills++;
        const tg = { kind: 'enemy', ref: e };
        if (c.combat) { if (!killed && cfg.knock > 0) startKnockback(c.combat, tg, ct.sx * cfg.knock, ct.sy * cfg.knock); flashSpark(c.combat, tg, e.x, e.y, killed); }
      } else ls.stats.blocked++;
      emit(ls, { type: dealt > 0 ? 'lash' : 'blocked', enemy: e.id, player: who, dealt, killed, speed: ct.speed, swing: fr.swing, x: e.x, y: e.y });
    }
  } catch (err) { ls.lastError = err; }
  return ls.events;
}
