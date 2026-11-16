// game-professions.js (S046) – Szakma-korlát: karakterenként max. 2 fő szakma.
// Tiszta logika, DOM és import nélkül. Puha kapu: szakma nélkül a magasabb tier
// receptjei zárva (a skill-szint a kapu alatt marad), a magasabb tier node-jai lassabbak.

export const PROFESSION_DEFS = Object.freeze([
  { id: 'woodcutting', skill: 'woodcutting' },
  { id: 'mining', skill: 'mining' },
  { id: 'herbalism', skill: 'herbalism' },
]);

export const PROFESSION_LIMITS = Object.freeze({ maxProfessions: 8, maxEvents: 64, maxLevel: 60 });
// max: fő szakma / játékos; gateLevel: ennyi skill-szinttől kell szakma a recepthez;
// nodeGateTier: ennyi minTier-től kell szakma a teljes gyűjtési sebességhez; offSpeed: szakma nélküli sebesség-szorzó
export const PROFESSION_CONFIG = Object.freeze({ max: 2, gateLevel: 10, nodeGateTier: 2, offSpeed: 0.5 });
export const NODE_SKILLS = Object.freeze({ tree: 'woodcutting', stone: 'mining', herb: 'herbalism' });

export const PROFESSION_TEXTS = {
  hu: {
    woodcutting: 'Favágó', mining: 'Bányász', herbalism: 'Gyógynövényes',
    title: 'Szakmák', slots: '{used}/{max} szakma', none: 'Nincs szakma',
    full: 'Nincs szabad hely (max. {max})', need: 'Szakma kell: {name}',
    chosen: 'Új szakma: {name}', dropped: 'Szakma elhagyva: {name}', swapped: '{from} -> {to}',
  },
  en: {
    woodcutting: 'Woodcutter', mining: 'Miner', herbalism: 'Herbalist',
    title: 'Professions', slots: '{used}/{max} professions', none: 'No profession',
    full: 'No free slot (max. {max})', need: 'Profession needed: {name}',
    chosen: 'New profession: {name}', dropped: 'Profession dropped: {name}', swapped: '{from} -> {to}',
  },
}; // registerTexts(PROFESSION_TEXTS, 'prof.')

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const ID_RE = /^[a-z][a-z0-9_]{0,31}$/;
const isPlayer = (p) => p === 0 || p === 1;
function clampInt(v, lo, hi, d) {
  if (!num(v)) return d;
  v = Math.floor(v);
  return v < lo ? lo : v > hi ? hi : v;
}

export function sanitizeProfessionConfig(src) {
  const s = src && typeof src === 'object' ? src : {};
  const d = PROFESSION_CONFIG;
  return Object.freeze({
    max: clampInt(s.max, 1, PROFESSION_LIMITS.maxProfessions, d.max),
    gateLevel: clampInt(s.gateLevel, 1, PROFESSION_LIMITS.maxLevel, d.gateLevel),
    nodeGateTier: clampInt(s.nodeGateTier, 1, 9, d.nodeGateTier),
    offSpeed: num(s.offSpeed) ? Math.min(1, Math.max(0.05, s.offSpeed)) : d.offSpeed,
  });
}

export function validateProfessionDef(def) {
  if (!def || typeof def !== 'object') return { ok: false, profession: null, error: 'def' };
  if (typeof def.id !== 'string' || !ID_RE.test(def.id)) return { ok: false, profession: null, error: 'id' };
  if (typeof def.skill !== 'string' || !ID_RE.test(def.skill)) return { ok: false, profession: null, error: 'skill' };
  return { ok: true, profession: Object.freeze({ id: def.id, skill: def.skill, nameKey: 'prof.' + def.id }), error: null };
}

export function createProfessionRegistry(defs = PROFESSION_DEFS) {
  const reg = { professions: new Map(), bySkill: new Map(), errors: [], dups: [] };
  const list = Array.isArray(defs) ? defs : [];
  for (const def of list) {
    const v = validateProfessionDef(def);
    if (!v.ok) { reg.errors.push(v.error); continue; }
    const pr = v.profession;
    if (reg.professions.has(pr.id)) { reg.dups.push(pr.id); continue; }
    if (reg.bySkill.has(pr.skill)) { reg.errors.push('skill-dup:' + pr.skill); continue; }
    if (reg.professions.size >= PROFESSION_LIMITS.maxProfessions) { reg.errors.push('limit'); continue; }
    reg.professions.set(pr.id, pr);
    reg.bySkill.set(pr.skill, pr);
  }
  return reg;
}

export function createProfessionSystem({ reg, defs, cfg } = {}) {
  return {
    reg: reg || createProfessionRegistry(defs),
    cfg: sanitizeProfessionConfig(cfg),
    sets: [[], []],
    listeners: [],
    events: [],
    stats: { chosen: 0, dropped: 0, swapped: 0, rejected: 0 },
    lastError: null,
  };
}

export function onProfession(ps, fn) {
  if (!ps || typeof fn !== 'function') return () => {};
  ps.listeners.push(fn);
  return () => { const i = ps.listeners.indexOf(fn); if (i >= 0) ps.listeners.splice(i, 1); };
}

function emit(ps, ev) {
  ps.events.push(ev);
  if (ps.events.length > PROFESSION_LIMITS.maxEvents) ps.events.shift();
  for (const fn of ps.listeners.slice()) {
    try { fn(ev); } catch (e) { ps.lastError = String(e && e.message || e); }
  }
}

function fail(ps, reason) { ps.stats.rejected++; return { ok: false, reason }; }

export function professionsOf(ps, p) { return isPlayer(p) ? ps.sets[p].slice() : []; }
export function hasProfession(ps, p, id) { return isPlayer(p) && ps.sets[p].includes(id); }
export function freeSlots(ps, p) { return isPlayer(p) ? Math.max(0, ps.cfg.max - ps.sets[p].length) : 0; }

export function chooseProfession(ps, p, id) {
  if (!isPlayer(p)) return fail(ps, 'player');
  if (!ps.reg.professions.has(id)) return fail(ps, 'profession');
  const set = ps.sets[p];
  if (set.includes(id)) return fail(ps, 'have');
  if (set.length >= ps.cfg.max) return fail(ps, 'full');
  set.push(id);
  ps.stats.chosen++;
  emit(ps, { type: 'choose', player: p, id });
  return { ok: true, reason: null };
}

export function dropProfession(ps, p, id) {
  if (!isPlayer(p)) return fail(ps, 'player');
  const i = ps.sets[p].indexOf(id);
  if (i < 0) return fail(ps, 'none');
  ps.sets[p].splice(i, 1);
  ps.stats.dropped++;
  emit(ps, { type: 'drop', player: p, id });
  return { ok: true, reason: null };
}

// Csere: a régi helyére kerül az új (sorrend marad); a skill-XP nem vész el.
export function swapProfession(ps, p, from, to) {
  if (!isPlayer(p)) return fail(ps, 'player');
  if (!ps.reg.professions.has(to)) return fail(ps, 'profession');
  const set = ps.sets[p];
  const i = set.indexOf(from);
  if (i < 0) return fail(ps, 'none');
  if (set.includes(to)) return fail(ps, 'have');
  set[i] = to;
  ps.stats.swapped++;
  emit(ps, { type: 'swap', player: p, id: to, from });
  return { ok: true, reason: null };
}

// Nyitott-e a skill: nem kapuzott skill mindenkinek, kapuzott csak a szakma birtokosának.
export function skillOpen(ps, p, skill) {
  const pr = ps.reg.bySkill.get(skill);
  return !pr || hasProfession(ps, p, pr.id);
}

export function effectiveLevel(ps, p, skill, level) {
  const lv = num(level) ? Math.min(PROFESSION_LIMITS.maxLevel, Math.max(0, Math.floor(level))) : 0;
  return skillOpen(ps, p, skill) ? lv : Math.min(lv, ps.cfg.gateLevel - 1);
}

// A craft ctx.skills-ét (objektum|függvény) burkolja: a recept-kapu így a szakma nélküli szintet látja.
export function cappedSkills(ps, p, source) {
  return (id) => {
    let lv = 0;
    try {
      if (typeof source === 'function') lv = source(id);
      else if (source && typeof source === 'object' && has(source, id)) lv = source[id];
    } catch (e) { lv = 0; }
    return effectiveLevel(ps, p, id, lv);
  };
}

export function recipeAccess(ps, p, recipe) {
  const rs = recipe && recipe.skill;
  if (!rs || typeof rs !== 'object') return { ok: true, reason: null, skill: null };
  if (num(rs.level) && rs.level >= ps.cfg.gateLevel && !skillOpen(ps, p, rs.skill)) {
    return { ok: false, reason: 'profession', skill: rs.skill };
  }
  return { ok: true, reason: null, skill: rs.skill };
}

// Node gyűjtési sebesség-szorzó (puha kapu): magas tier szakma nélkül lassabb.
export function nodeSpeedMul(ps, p, node) {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string' || !has(NODE_SKILLS, node.type)) return 1;
  if (!num(node.minTier) || node.minTier < ps.cfg.nodeGateTier) return 1;
  return skillOpen(ps, p, NODE_SKILLS[node.type]) ? 1 : ps.cfg.offSpeed;
}

// Bekötés a meglévő rendszerekbe (S049/S050-ben a main.js hívja): craftUi.ctxOf és nodes.hooks.speed burkolása.
export function connectProfessions(ps, { nodes, craftUi, players } = {}) {
  const undo = [];
  if (craftUi && typeof craftUi.ctxOf === 'function') {
    const orig = craftUi.ctxOf;
    craftUi.ctxOf = (i) => {
      const c = orig(i) || {};
      return { ...c, skills: cappedSkills(ps, i, c.skills) };
    };
    undo.push(() => { craftUi.ctxOf = orig; });
  }
  if (nodes && nodes.hooks && typeof nodes.hooks === 'object') {
    const orig = nodes.hooks.speed;
    nodes.hooks.speed = (p, node, ref) => {
      let base = 1;
      try { if (typeof orig === 'function') { const v = orig(p, node, ref); if (num(v)) base = v; } } catch (e) { base = 1; }
      const i = typeof p === 'number' ? p : (Array.isArray(players) ? players.indexOf(p) : -1);
      return isPlayer(i) ? base * nodeSpeedMul(ps, i, node) : base;
    };
    undo.push(() => { nodes.hooks.speed = orig; });
  }
  return () => { while (undo.length) undo.pop()(); };
}

export function professionView(ps, p) {
  if (!isPlayer(p)) return null;
  const owned = ps.sets[p].map((id) => ps.reg.professions.get(id)).filter(Boolean);
  const free = freeSlots(ps, p);
  const options = [...ps.reg.professions.values()].map((pr) => {
    const own = ps.sets[p].includes(pr.id);
    return { id: pr.id, skill: pr.skill, nameKey: pr.nameKey, owned: own, canChoose: !own && free > 0 };
  });
  return { player: p, max: ps.cfg.max, used: owned.length, free, owned, options };
}

export function professionState(ps) {
  return { v: 1, players: [ps.sets[0].slice(), ps.sets[1].slice()] };
}

// ATOMI: hibás szerkezet -> false, érintetlen; ismeretlen/duplikált id kimarad, a max-ra vágva; csendes.
export function restoreProfessions(ps, st) {
  if (!st || typeof st !== 'object' || st.v !== 1) return false;
  if (!Array.isArray(st.players) || st.players.length !== 2 || !st.players.every(Array.isArray)) return false;
  const next = st.players.map((arr) => {
    const out = [];
    for (const id of arr) {
      if (ps.reg.professions.has(id) && !out.includes(id)) out.push(id);
      if (out.length >= ps.cfg.max) break;
    }
    return out;
  });
  ps.sets[0] = next[0];
  ps.sets[1] = next[1];
  return true;
}
