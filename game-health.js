// Életerő és sebzés (S066). Tiszta logika, DOM és canvas nélkül.
// A HUD (game-hud hudModel) a p.hp / p.hpMax mezőket olvassa: syncHealthToPlayer köti rájuk.

export const DAMAGE_TYPES = Object.freeze(['physical', 'fire', 'frost', 'poison', 'dark', 'heat']);

export const HEALTH_CONFIG = Object.freeze({
  defaultMax: 100,
  maxMax: 99999,
  maxAmount: 1000000,
  resistMin: -1, // -1 = dupla sebzés (gyengeség)
  resistMax: 1, // 1 = immunitás
  invulnMax: 10, // mp
  reviveRatio: 0.3,
});

export const HEALTH_TEXTS = {
  hu: {
    'health.type.physical': 'Fizikai', 'health.type.fire': 'Tűz', 'health.type.frost': 'Fagy',
    'health.type.poison': 'Méreg', 'health.type.dark': 'Sötétség', 'health.type.heat': 'Hőség',
    'health.dead': 'Elesett', 'health.hp': 'Életerő',
  },
  en: {
    'health.type.physical': 'Physical', 'health.type.fire': 'Fire', 'health.type.frost': 'Frost',
    'health.type.poison': 'Poison', 'health.type.dark': 'Darkness', 'health.type.heat': 'Heat',
    'health.dead': 'Down', 'health.hp': 'Health',
  },
};

const fin = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function sanitizeResist(src) {
  const out = {};
  if (src && typeof src === 'object') {
    for (const t of DAMAGE_TYPES) {
      if (fin(src[t])) out[t] = clamp(src[t], HEALTH_CONFIG.resistMin, HEALTH_CONFIG.resistMax);
    }
  }
  return out;
}

function cleanSource(s) {
  if (typeof s === 'string' && s.length <= 64) return s;
  if (fin(s)) return s;
  return null;
}

// DamageInfo: {amount, type, source, tag, ignoreResist, ignoreInvuln, knockback{x,y}|null} vagy null (hibás)
export function sanitizeDamage(src) {
  if (typeof src === 'number') src = { amount: src };
  if (!src || typeof src !== 'object') return null;
  if (!fin(src.amount) || src.amount < 0) return null;
  let kind = 'physical';
  if (src.type !== undefined && src.type !== null) {
    if (!DAMAGE_TYPES.includes(src.type)) return null;
    kind = src.type;
  }
  const kb = src.knockback;
  return Object.freeze({
    amount: Math.min(src.amount, HEALTH_CONFIG.maxAmount),
    type: kind,
    source: cleanSource(src.source),
    tag: typeof src.tag === 'string' && src.tag.length <= 24 ? src.tag : null,
    ignoreResist: src.ignoreResist === true,
    ignoreInvuln: src.ignoreInvuln === true,
    knockback: kb && typeof kb === 'object' && fin(kb.x) && fin(kb.y) ? Object.freeze({ x: kb.x, y: kb.y }) : null,
  });
}

export function makeDamage(amount, type, opts) {
  const extra = opts && typeof opts === 'object' ? opts : {};
  return sanitizeDamage({ ...extra, amount, type });
}

export function isHealth(h) {
  return !!h && typeof h === 'object' && fin(h.hp) && fin(h.max) && h.listeners instanceof Set;
}

// def: {max, hp, resist {típus: -1..1}, resistFn(típus, h) -> további ellenállás (felszerelés, faj)}
export function createHealth(def) {
  const d = def && typeof def === 'object' ? def : {};
  const max = fin(d.max) && d.max > 0 ? Math.min(d.max, HEALTH_CONFIG.maxMax) : HEALTH_CONFIG.defaultMax;
  const hp = fin(d.hp) ? clamp(d.hp, 0, max) : max;
  return {
    max, hp, dead: hp <= 0, invuln: 0,
    resist: sanitizeResist(d.resist),
    resistFn: typeof d.resistFn === 'function' ? d.resistFn : null,
    listeners: new Set(),
    stats: { damage: 0, healed: 0, hits: 0, kills: 0, ignored: 0 },
    lastError: null,
  };
}

export function onHealth(h, fn) {
  if (!isHealth(h) || typeof fn !== 'function') return () => {};
  h.listeners.add(fn);
  return () => { h.listeners.delete(fn); };
}

function emit(h, ev) {
  for (const fn of [...h.listeners]) {
    try { fn(ev); } catch (e) { h.lastError = String(e && e.message ? e.message : e); }
  }
}

export function setResist(h, type, v) {
  if (!isHealth(h) || !DAMAGE_TYPES.includes(type) || !fin(v)) return false;
  h.resist[type] = clamp(v, HEALTH_CONFIG.resistMin, HEALTH_CONFIG.resistMax);
  return true;
}

export function resistOf(h, type) {
  if (!isHealth(h) || !DAMAGE_TYPES.includes(type)) return 0;
  let r = h.resist[type] || 0;
  if (h.resistFn) {
    try {
      const x = h.resistFn(type, h);
      if (fin(x)) r += x;
    } catch (e) { h.lastError = String(e && e.message ? e.message : e); }
  }
  return clamp(r, HEALTH_CONFIG.resistMin, HEALTH_CONFIG.resistMax);
}

const refuse = reason => ({ ok: false, dealt: 0, resisted: 0, overkill: 0, killed: false, reason });

// -> {ok, dealt, resisted, overkill, killed, reason}; reason: bad-target|bad-damage|dead|invuln|null
export function applyDamage(h, src) {
  if (!isHealth(h)) return refuse('bad-target');
  const dmg = sanitizeDamage(src);
  if (!dmg) { h.stats.ignored++; return refuse('bad-damage'); }
  if (h.dead) { h.stats.ignored++; return refuse('dead'); }
  if (h.invuln > 0 && !dmg.ignoreInvuln) { h.stats.ignored++; return refuse('invuln'); }
  const r = dmg.ignoreResist ? 0 : resistOf(h, dmg.type);
  const eff = dmg.amount * (1 - r);
  const dealt = Math.min(eff, h.hp);
  const res = { ok: true, dealt, resisted: dmg.amount - eff, overkill: eff - dealt, killed: false, reason: null };
  if (dealt <= 0) return res; // immunitás / 0 sebzés: nincs esemény
  h.hp -= dealt;
  h.stats.damage += dealt;
  h.stats.hits++;
  emit(h, {
    type: 'damage', amount: dealt, raw: dmg.amount, resisted: res.resisted, kind: dmg.type,
    source: dmg.source, tag: dmg.tag, knockback: dmg.knockback, hp: h.hp, max: h.max,
  });
  if (h.hp <= 0) {
    h.hp = 0;
    h.dead = true;
    h.stats.kills++;
    res.killed = true;
    emit(h, { type: 'death', kind: dmg.type, source: dmg.source, hp: 0, max: h.max });
  }
  return res;
}

export function killHealth(h, source) {
  if (!isHealth(h)) return refuse('bad-target');
  return applyDamage(h, { amount: Math.max(h.hp, 1e-9), type: 'physical', source, ignoreResist: true, ignoreInvuln: true });
}

// -> tényleges gyógyulás (0, ha halott / hibás)
export function heal(h, amount) {
  if (!isHealth(h) || h.dead || !fin(amount) || amount <= 0) return 0;
  const got = Math.min(Math.min(amount, HEALTH_CONFIG.maxAmount), h.max - h.hp);
  if (got <= 0) return 0;
  h.hp += got;
  h.stats.healed += got;
  emit(h, { type: 'heal', amount: got, hp: h.hp, max: h.max });
  return got;
}

// Újraélesztés (S070): csak halottat; ratio 0..1 (hibás -> alap)
export function revive(h, ratio) {
  if (!isHealth(h) || !h.dead) return false;
  const r = fin(ratio) && ratio > 0 ? Math.min(ratio, 1) : HEALTH_CONFIG.reviveRatio;
  h.hp = h.max * r;
  h.dead = false;
  h.invuln = 0;
  emit(h, { type: 'revive', hp: h.hp, max: h.max });
  return true;
}

// i-frame (S068): másodperc, az előzőt FELÜLÍRJA; 0 = vége
export function setInvulnerable(h, sec) {
  if (!isHealth(h) || !fin(sec) || sec < 0) return false;
  h.invuln = Math.min(sec, HEALTH_CONFIG.invulnMax);
  return true;
}

// mode: 'ratio' (alap: az arány marad) | 'fill' (teli) | 'keep' (az érték marad, szorítva); halott marad halott
export function setMaxHealth(h, max, mode) {
  if (!isHealth(h) || !fin(max) || max <= 0) return false;
  const m = Math.min(max, HEALTH_CONFIG.maxMax);
  const ratio = h.max > 0 ? h.hp / h.max : 0;
  h.max = m;
  if (h.dead) h.hp = 0;
  else if (mode === 'fill') h.hp = m;
  else if (mode === 'keep') h.hp = Math.min(h.hp, m);
  else h.hp = clamp(ratio * m, Math.min(1e-9, m), m);
  emit(h, { type: 'max', hp: h.hp, max: h.max });
  return true;
}

export function stepHealth(h, dt) {
  if (!isHealth(h)) return false;
  if (fin(dt) && dt > 0 && h.invuln > 0) h.invuln = Math.max(0, h.invuln - dt);
  return true;
}

// 0..1; hibás -> 1 (mint a HUD: hiányzó = teli)
export function healthRatio(h) {
  if (!isHealth(h)) return 1;
  if (h.dead || h.max <= 0) return 0;
  return clamp(h.hp / h.max, 0, 1);
}

// HUD-kötés: a game-hud hudModel p.hp / p.hpMax mezőit tölti; p.dead az S070-nek
export function syncHealthToPlayer(p, h) {
  if (!p || typeof p !== 'object' || !isHealth(h)) return false;
  p.hp = h.hp;
  p.hpMax = h.max;
  p.dead = h.dead;
  return true;
}

export function createPlayerHealths(players, defs) {
  const ps = Array.isArray(players) ? players : [];
  return ps.map((p, i) => {
    const h = createHealth(Array.isArray(defs) ? defs[i] : defs);
    syncHealthToPlayer(p, h);
    return h;
  });
}

export function stepPlayerHealths(hs, players, dt) {
  if (!Array.isArray(hs) || !Array.isArray(players)) return 0;
  let n = 0;
  for (let i = 0; i < hs.length; i++) {
    if (stepHealth(hs[i], dt) && syncHealthToPlayer(players[i], hs[i])) n++;
  }
  return n;
}

// Mentés (S050/S108 köti): {v:1, hp, max, dead}; az ellenállás/i-frame nem állapot
export function healthState(h) {
  if (!isHealth(h)) return null;
  return { v: 1, hp: h.hp, max: h.max, dead: h.dead };
}

// ATOMI: hibás állapotnál false, és semmi nem változik; csendes (nincs esemény)
export function restoreHealth(h, st) {
  if (!isHealth(h) || !st || typeof st !== 'object' || st.v !== 1) return false;
  if (!fin(st.max) || st.max <= 0 || st.max > HEALTH_CONFIG.maxMax) return false;
  if (!fin(st.hp) || st.hp < 0 || st.hp > st.max) return false;
  if (typeof st.dead !== 'boolean' || st.dead !== (st.hp === 0)) return false;
  h.max = st.max;
  h.hp = st.hp;
  h.dead = st.dead;
  h.invuln = 0;
  return true;
}
