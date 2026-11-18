// game-combat.js – TÁMADÁS ÉS HITBOX (S068; tiszta logika, DOM és canvas nélkül; importja: game-health, game-enemy, game-ability, game-warrior).
// Közelharc: ütés-hitbox (késleltetés + aktív ablak, a gazda követi), távolsági: lövedék (falon megáll). Hurtbox = az entitás {x,y,w,h} (x,y = közép).
// Csapat: a játékos támadása az ellenfeleket, az ellenfélé a játékosokat találja (nincs baráti tűz). Egy támadás egy célt egyszer talál.
// Találat -> sebzés (game-health), visszalökés (sebesség-impulzus, exponenciális lecsengés), i-frame (játékos), villanás + szikra (adat; rajz: render-combat).
// A játékos-visszalökés a p.kbx/p.kby additív sebesség (game-player desiredVelocity), így a póráz és a falak ugyanúgy érvényesek rá.
import { applyDamage, setInvulnerable, isHealth } from './game-health.js';
import { damageEnemy, pushEnemy } from './game-enemy.js';
import { setAbilityHandler } from './game-ability.js';
import { segmentHit, strengthMul } from './game-warrior.js';

export const COMBAT_CONFIG = Object.freeze({
  tile: 32, iframes: 0.6, kbDecay: 10, kbStop: 12, kbMax: 700, kbWeightMin: 0.5, kbWeightMax: 2,
  flashTime: 0.18, sparkTime: 0.25, playerSize: 24, maxAttacks: 64, maxShots: 64, maxFx: 64, maxDt: 0.1, shotStep: 6, markedBonus: 0.25,
});
// Képesség -> támadás-alak (px, mp). A reach a gazda SZÉLÉTŐL számít; a sebzés a képesség power-éből jön (az erő szorozza).
export const ATTACK_DEFS = Object.freeze({
  strike: Object.freeze({ kind: 'melee', reach: 40, width: 44, delay: 0.06, active: 0.12, knock: 36, tag: 'melee' }),
  shoot: Object.freeze({ kind: 'shot', speed: 420, radius: 5, pierce: 0, knock: 24, tag: 'ranged' }),
});

const fin = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (fin(v) ? v : d);

// ---- geometria ----
export function hurtbox(e, size = COMBAT_CONFIG.playerSize) {
  if (!e || !fin(e.x) || !fin(e.y)) return null;
  const w = fin(e.w) && e.w > 0 ? e.w : size, h = fin(e.h) && e.h > 0 ? e.h : size;
  return { x: e.x - w / 2, y: e.y - h / 2, w, h };
}
export const rectsOverlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; // érintés nem átfedés
export function circleHitsRect(cx, cy, r, b) {
  const nx = clamp(cx, b.x, b.x + b.w), ny = clamp(cy, b.y, b.y + b.h);
  return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
}
/** 4 irányú egységvektor a domináns tengelyből; hibás/nulla -> le. */
export function facingDir(d) {
  if (!d || !fin(d.x) || !fin(d.y) || (d.x === 0 && d.y === 0)) return { x: 0, y: 1 };
  return Math.abs(d.x) >= Math.abs(d.y) ? { x: Math.sign(d.x), y: 0 } : { x: 0, y: Math.sign(d.y) };
}
/** Ütés-hitbox (AABB): a gazda közepéből startOff távolságra indul (a gazda széle), reach hosszú, width széles. */
export function meleeBox(x, y, dir, reach, width, startOff = 0) {
  const d = facingDir(dir);
  if (d.x !== 0) return { x: d.x > 0 ? x + startOff : x - startOff - reach, y: y - width / 2, w: reach, h: width };
  return { x: x - width / 2, y: d.y > 0 ? y + startOff : y - startOff - reach, w: width, h: reach };
}
const wallBetween = (walls, x0, y0, x1, y1) => { if (Array.isArray(walls)) for (const w of walls) if (segmentHit(x0, y0, x1, y1, w, 0) >= 0) return true; return false; };

// ---- rendszer ----
export function createCombat({ cfg } = {}) {
  const c = { ...COMBAT_CONFIG };
  if (cfg && typeof cfg === 'object') for (const k of Object.keys(c)) if (fin(cfg[k]) && cfg[k] >= 0) c[k] = cfg[k];
  return { cfg: c, attacks: [], shots: [], kb: new Map(), flash: new Map(), fx: [], next: 1, time: 0, events: [], listeners: new Set(),
    stats: { swings: 0, shots: 0, hits: 0, blocked: 0, kills: 0, walls: 0, knocks: 0 }, lastError: null };
}
export function onCombat(cs, fn) {
  if (!cs || typeof fn !== 'function') return () => {};
  cs.listeners.add(fn); return () => cs.listeners.delete(fn);
}
function emit(cs, ev) { cs.events.push(ev); for (const fn of [...cs.listeners]) { try { fn(ev); } catch (err) { cs.lastError = err; } } }

const keyOf = t => (t.kind === 'player' ? 'p' + t.index : 'e' + (t.ref && t.ref.id !== undefined ? t.ref.id : '?'));
const okOwner = o => o && (o.team === 'player' ? Number.isInteger(o.index) && o.index >= 0 : o.team === 'enemy');
function okDamage(d) { return d && typeof d === 'object' && fin(d.amount) && d.amount >= 0 && (d.type === undefined || typeof d.type === 'string'); }
const cleanDamage = (d, ability) => ({ amount: d.amount, type: d.type || 'physical', tag: typeof d.tag === 'string' ? d.tag : null, ability: ability || null });

/** Ütés indítása. spec {owner{team,index?|ref?}, x,y (gazda közép), dir, size, reach, width, delay, active, damage{amount,type,tag}, knock, ability} -> támadás | null. */
export function startMelee(cs, spec) {
  if (!cs || !spec || typeof spec !== 'object' || cs.attacks.length >= cs.cfg.maxAttacks) return null;
  if (!okOwner(spec.owner) || !fin(spec.x) || !fin(spec.y) || !okDamage(spec.damage) || !(spec.reach > 0) || !(spec.width > 0) || !fin(spec.reach) || !fin(spec.width)) return null;
  const a = { id: cs.next++, kind: 'melee', owner: spec.owner, team: spec.owner.team, x: spec.x, y: spec.y, dir: facingDir(spec.dir), size: fin(spec.size) && spec.size > 0 ? spec.size : cs.cfg.playerSize,
    reach: spec.reach, width: spec.width, delay: Math.max(0, num(spec.delay, 0)), active: Math.max(0.01, num(spec.active, 0.1)), t: 0,
    damage: cleanDamage(spec.damage, spec.ability), knock: Math.max(0, num(spec.knock, 0)), ability: spec.ability || null, hit: new Set() };
  cs.attacks.push(a); cs.stats.swings++; emit(cs, { type: 'swing', attack: a.id, team: a.team, ability: a.ability, x: a.x, y: a.y, dir: a.dir });
  return a;
}
/** Lövedék indítása. spec {owner, x,y, dir (tetszőleges nem-nulla), speed, radius, range, pierce, damage, knock, ability} -> lövedék | null. */
export function startShot(cs, spec) {
  if (!cs || !spec || typeof spec !== 'object' || cs.shots.length >= cs.cfg.maxShots) return null;
  const d = spec.dir, len = d && fin(d.x) && fin(d.y) ? Math.hypot(d.x, d.y) : 0;
  if (!okOwner(spec.owner) || !fin(spec.x) || !fin(spec.y) || !okDamage(spec.damage) || !(len > 0) || !(spec.speed > 0) || !fin(spec.speed) || !(spec.range > 0) || !fin(spec.range)) return null;
  const s = { id: cs.next++, kind: 'shot', owner: spec.owner, team: spec.owner.team, x: spec.x, y: spec.y, vx: (d.x / len) * spec.speed, vy: (d.y / len) * spec.speed,
    r: Math.max(1, num(spec.radius, 5)), left: spec.range, pierce: Math.max(0, Math.floor(num(spec.pierce, 0))), damage: cleanDamage(spec.damage, spec.ability),
    knock: Math.max(0, num(spec.knock, 0)), ability: spec.ability || null, hit: new Set() };
  cs.shots.push(s); cs.stats.shots++; emit(cs, { type: 'shot', attack: s.id, team: s.team, ability: s.ability, x: s.x, y: s.y });
  return s;
}

// ---- visszalökés, villanás ----
/** target {kind 'player', index, ref} | {kind 'enemy', ref}; (kx,ky) = a teljes elmozdulás px-ben. A játékosnál a súly csökkenti. -> bool. */
export function startKnockback(cs, target, kx, ky) {
  if (!cs || !target || !fin(kx) || !fin(ky)) return false;
  const mag = Math.hypot(kx, ky); if (!(mag > 0)) return false;
  const w = target.kind === 'player' && target.ref && fin(target.ref.weight) ? target.ref.weight : 1;
  const mul = clamp(1 / Math.max(0.25, w), cs.cfg.kbWeightMin, cs.cfg.kbWeightMax);
  const v0 = Math.min(cs.cfg.kbMax, mag * mul * cs.cfg.kbDecay);
  cs.kb.set(keyOf(target), { kind: target.kind, index: target.index, ref: target.ref, vx: (kx / mag) * v0, vy: (ky / mag) * v0 });
  cs.stats.knocks++; return true;
}
export const flashAlpha = (cs, target) => { const f = cs && cs.flash.get(keyOf(target)); return f ? clamp(f.t / cs.cfg.flashTime, 0, 1) : 0; };
function flashSpark(cs, target, x, y, big) {
  cs.flash.set(keyOf(target), { t: cs.cfg.flashTime, ref: target.ref, kind: target.kind });
  cs.fx.push({ kind: 'spark', x, y, t: 0, max: cs.cfg.sparkTime, big: !!big }); if (cs.fx.length > cs.cfg.maxFx) cs.fx.shift();
}

/** Játékos sebzése (az ellenség-AI env.hurt-ja és a lövedékek közös útja): sebzés + i-frame + visszalökés + villanás. -> applyDamage eredmény | null. */
export function hurtPlayer(cs, ctx, i, dmg) {
  const h = ctx && ctx.healths && ctx.healths[i]; if (!cs || !isHealth(h)) return null;
  const res = applyDamage(h, dmg);
  if (res.ok && res.dealt > 0) {
    if (!h.dead) setInvulnerable(h, cs.cfg.iframes);
    const t = { kind: 'player', index: i, ref: ctx.players && ctx.players[i] }, p = t.ref;
    if (dmg && dmg.knockback) startKnockback(cs, t, dmg.knockback.x, dmg.knockback.y);
    flashSpark(cs, t, p && fin(p.x) ? p.x : 0, p && fin(p.y) ? p.y : 0, h.dead);
  }
  return res;
}
/** A stepEnemies env.hurt-ja: stepEnemies(es, players, dt, { ..., hurt: makeHurt(cs, { players, healths }) }). */
export const makeHurt = (cs, ctx) => (i, dmg) => hurtPlayer(cs, ctx, i, dmg);

// ---- léptetés ----
function targetsOf(team, ctx) {
  const out = [];
  if (team === 'player') {
    const list = Array.isArray(ctx.enemies) ? ctx.enemies : (ctx.enemySys && ctx.enemySys.list) || [];
    for (const e of list) { const b = e && e.state !== 'dead' && !(e.health && e.health.dead) ? hurtbox(e) : null; if (b) out.push({ kind: 'enemy', ref: e, box: b, x: e.x, y: e.y }); }
  } else {
    (Array.isArray(ctx.players) ? ctx.players : []).forEach((p, i) => { const b = p && !p.dead ? hurtbox(p) : null; if (b) out.push({ kind: 'player', index: i, ref: p, box: b, x: p.x, y: p.y }); });
  }
  return out;
}
function applyHit(cs, ctx, at, tg, ux, uy, hx, hy) {
  let amount = at.damage.amount, dealt = 0, killed = false;
  const kb = at.knock > 0 ? { x: ux * at.knock, y: uy * at.knock } : null;
  if (tg.kind === 'enemy') {
    const e = tg.ref;
    if (at.damage.tag === 'ranged' && fin(e.tracked) && e.tracked > 0) amount *= 1 + cs.cfg.markedBonus;
    const before = e.health ? e.health.hp : num(e.hp, 0);
    if (ctx.enemySys && e.health) killed = damageEnemy(ctx.enemySys, e, amount, { player: at.owner.index, type: at.damage.type, ability: at.ability });
    else if (e.health) { applyDamage(e.health, { amount, type: at.damage.type, source: at.owner.index }); e.hp = e.health.hp; killed = e.health.dead; }
    else { e.hp = Math.max(0, before - amount); killed = e.hp <= 0; }
    dealt = Math.max(0, before - (e.health ? e.health.hp : num(e.hp, 0)));
    if (dealt > 0) { if (kb && !killed) startKnockback(cs, tg, kb.x, kb.y); flashSpark(cs, tg, tg.x, tg.y, killed); }
  } else {
    const r = hurtPlayer(cs, ctx, tg.index, { amount, type: at.damage.type, source: at.ability || 'enemy', tag: at.damage.tag, knockback: kb });
    dealt = r && r.ok ? r.dealt : 0; killed = !!(r && r.killed);
  }
  const ev = { type: dealt > 0 ? 'hit' : 'blocked', team: at.team, attack: at.id, ability: at.ability, target: { kind: tg.kind, index: tg.index, ref: tg.ref }, dealt, killed, x: hx, y: hy };
  if (dealt > 0) { cs.stats.hits++; if (killed) cs.stats.kills++; } else cs.stats.blocked++;
  emit(cs, ev);
}
function ownerPos(at, ctx) {
  const o = at.owner;
  if (o.team === 'player') { const p = Array.isArray(ctx.players) ? ctx.players[o.index] : null; return p && !p.dead && fin(p.x) && fin(p.y) ? p : null; }
  const e = o.ref; if (!e) return { x: at.x, y: at.y }; // ref nélküli ellenséges támadás: a kezdő pozíció marad
  return fin(e.x) && fin(e.y) && e.state !== 'dead' && !(e.health && e.health.dead) ? e : null;
}
function stepAttacks(cs, ctx, dt, tg) {
  const walls = Array.isArray(ctx.walls) ? ctx.walls : [], keep = [];
  for (const at of cs.attacks) {
    const o = ownerPos(at, ctx); if (!o) continue; // a gazda elesett/eltűnt: a támadás megszakad
    at.x = o.x; at.y = o.y; at.t += dt;
    if (at.t >= at.delay) {
      const box = meleeBox(at.x, at.y, at.dir, at.reach, at.width, at.size / 2);
      for (const t of tg(at.team === 'player' ? 'player' : 'enemy')) {
        const k = keyOf(t); if (at.hit.has(k) || !rectsOverlap(box, t.box) || wallBetween(walls, at.x, at.y, t.x, t.y)) continue;
        at.hit.add(k); const d = Math.hypot(t.x - at.x, t.y - at.y) || 1; applyHit(cs, ctx, at, t, (t.x - at.x) / d, (t.y - at.y) / d, t.x, t.y);
      }
    }
    if (at.t < at.delay + at.active) keep.push(at);
  }
  cs.attacks = keep;
}
function stepShots(cs, ctx, dt, tg) {
  const walls = Array.isArray(ctx.walls) ? ctx.walls : [], keep = [];
  for (const s of cs.shots) {
    let dist = Math.hypot(s.vx, s.vy) * dt, alive = true;
    const speed = Math.hypot(s.vx, s.vy), ux = s.vx / speed, uy = s.vy / speed;
    while (alive && dist > 1e-9) {
      const st = Math.min(cs.cfg.shotStep, dist, s.left); dist -= st; s.left -= st; s.x += ux * st; s.y += uy * st;
      if (walls.some(w => circleHitsRect(s.x, s.y, s.r, w))) { cs.stats.walls++; emit(cs, { type: 'wall', attack: s.id, team: s.team, x: s.x, y: s.y }); alive = false; break; }
      for (const t of tg(s.team === 'player' ? 'player' : 'enemy')) {
        const k = keyOf(t); if (s.hit.has(k) || !circleHitsRect(s.x, s.y, s.r, t.box)) continue;
        s.hit.add(k); applyHit(cs, ctx, s, t, ux, uy, s.x, s.y);
        if (s.pierce <= 0) { alive = false; break; } s.pierce--;
      }
      if (s.left <= 1e-9) alive = false;
    }
    if (alive) keep.push(s);
  }
  cs.shots = keep;
}
function stepKnockbacks(cs, ctx, dt) {
  const walls = Array.isArray(ctx.walls) ? ctx.walls : [], f = Math.exp(-cs.cfg.kbDecay * dt);
  for (const [key, k] of [...cs.kb]) {
    const r = k.ref, gone = !r || !fin(r.x) || !fin(r.y) || (k.kind === 'player' ? r.dead : (r.state === 'dead' || (r.health && r.health.dead)));
    if (gone) { cs.kb.delete(key); if (k.kind === 'player' && r) r.kbx = r.kby = 0; continue; }
    const sp = Math.hypot(k.vx, k.vy);
    if (k.kind === 'player') { r.kbx = k.vx; r.kby = k.vy; } // a póráz-rendszer a kívánt sebességhez adja (desiredVelocity)
    else if (sp > 0) { const dist = (sp * (1 - f)) / cs.cfg.kbDecay, moved = pushEnemy(r, k.vx, k.vy, dist, walls); if (moved < dist * 0.2) { k.vx *= 0.3; k.vy *= 0.3; } }
    k.vx *= f; k.vy *= f;
    if (Math.hypot(k.vx, k.vy) < cs.cfg.kbStop) { cs.kb.delete(key); if (k.kind === 'player') r.kbx = r.kby = 0; }
  }
}
/** Egy kocka. ctx {players, healths, enemies (tömb) | enemySys, walls[{x,y,w,h}]} -> a kocka eseményei (swing|shot|hit|blocked|wall). */
export function stepCombat(cs, ctx, dt) {
  if (!cs) return [];
  cs.events = [];
  if (!fin(dt) || dt <= 0) return cs.events;
  dt = Math.min(dt, cs.cfg.maxDt); cs.time += dt;
  const c = ctx && typeof ctx === 'object' ? ctx : {}, cache = {}, tg = team => cache[team] || (cache[team] = targetsOf(team, c));
  try { stepAttacks(cs, c, dt, tg); stepShots(cs, c, dt, tg); stepKnockbacks(cs, c, dt); } catch (err) { cs.lastError = err; }
  for (const [k, f] of [...cs.flash]) { f.t -= dt; if (f.t <= 0) cs.flash.delete(k); }
  for (const e of cs.fx) e.t += dt;
  cs.fx = cs.fx.filter(e => e.t < e.max);
  return cs.events;
}
/** Rajzhoz / hibakereséshez: a hitboxok és lövedékek pillanatképe. */
export function combatView(cs) {
  if (!cs) return { attacks: [], shots: [], fx: [] };
  return {
    attacks: cs.attacks.map(a => ({ id: a.id, team: a.team, phase: a.t < a.delay ? 'windup' : 'active', ratio: clamp(a.t / (a.delay + a.active), 0, 1), box: meleeBox(a.x, a.y, a.dir, a.reach, a.width, a.size / 2) })),
    shots: cs.shots.map(s => ({ id: s.id, team: s.team, x: s.x, y: s.y, r: s.r, vx: s.vx, vy: s.vy })), fx: cs.fx.map(e => ({ ...e })),
  };
}

/** A strike (ütés a facing/cél felé) és a shoot (lövedék) képesség bekötése a támadás-rendszerre; a class-modulok (warrior/ranger) UTÁN hívandó,
 *  mert felülírja azok kezelőjét (a hatást a hitbox adja, nem a cél-lista). detach() visszaállítja az előzőt. env {players}. */
export function attachCombat(sys, cs, env) {
  const players = env && Array.isArray(env.players) ? env.players : [], prev = {};
  for (const id of Object.keys(ATTACK_DEFS)) prev[id] = sys && sys.handlers ? sys.handlers.get(id) : undefined;
  const pl = ev => players[ev.player];
  setAbilityHandler(sys, 'strike', (ev, ctx) => {
    const p = pl(ev), t = ev.target; if (!p) return false;
    const dir = t && t.kind === 'enemy' && t.ref ? { x: t.ref.x - p.x, y: t.ref.y - p.y } : ctx && ctx.facing;
    const d = ATTACK_DEFS.strike;
    return startMelee(cs, { owner: { team: 'player', index: ev.player }, x: p.x, y: p.y, dir, size: p.w, reach: d.reach, width: d.width, delay: d.delay, active: d.active, knock: d.knock,
      damage: { amount: ev.power * strengthMul(p), type: 'physical', tag: d.tag }, ability: 'strike' }) ? undefined : false;
  });
  setAbilityHandler(sys, 'shoot', ev => {
    const p = pl(ev), t = ev.target; if (!p || !t || t.kind !== 'direction') return false;
    const d = ATTACK_DEFS.shoot;
    return startShot(cs, { owner: { team: 'player', index: ev.player }, x: p.x, y: p.y, dir: { x: t.dx, y: t.dy }, range: t.range, speed: d.speed, radius: d.radius, pierce: d.pierce, knock: d.knock,
      damage: { amount: ev.power, type: 'physical', tag: d.tag }, ability: 'shoot' }) ? undefined : false;
  });
  return { cs, detach() { for (const id of Object.keys(prev)) setAbilityHandler(sys, id, prev[id] || null); } };
}
