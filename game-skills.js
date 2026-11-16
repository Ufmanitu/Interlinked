// game-skills.js (S045) – tevékenység-alapú skillek: SkillSet, XP-busz, szintlépés-esemény (tiszta logika, DOM/canvas nélkül).
// A skill használattal nő: a gyűjtés (game-nodes 'depleted') és a craft (game-craftui 'craft') XP-t ad a játékosnak (külön skillek játékosonként).
// Szintgörbe: XP(L) = base · L^exp (kumulatív, szigorúan növekvő; szint 0..60). A skill-szint a craft ctx.skills-ébe megy (skillsOf).
// A szakma-korlát (S046), a globális szintgörbe + napló (S047) és a mentés (S050: skillState/restoreSkills) erre épül.
import { onNode } from './game-nodes.js';
import { onCraft } from './game-craftui.js';
import { getRecipe } from './game-crafting.js';

// --- adat (S045): skill-ek, XP-szabályok, szövegek. Új skill: SKILL_DEFS-be egy sor + SKILL_TEXTS mindkét nyelven (+ XP-szabály). A szakmák (S046) és a mélyítésük (S178–S180) ezekre épülnek;
// a recept skill-kapuja a recept `skill: {skill, level}` mezője. (Külön data-skills.js nem készült: a lépésenkénti max. 6 fájl miatt; az S178 szétvághatja.)
export const SKILL_DEFS = [
  { id: 'woodcutting' }, // favágás
  { id: 'mining' },      // bányászat
  { id: 'herbalism' },   // gyógynövényezés
  { id: 'crafting' },    // barkácsolás (alap craft)
];

// XP-szabályok. gather: node-típusonként (a kitermelés befejezője kapja); craft: recept-id szerint, különben `default`
// (a recept skill-kapuja felülírja a skillt: aki skill-kapus receptet készít, annak a skilljét növeli). A craft XP = xp × darabszám (times).
export const XP_RULES = {
  gather: {
    tree:  { skill: 'woodcutting', xp: 6 },
    stone: { skill: 'mining', xp: 8 },
    herb:  { skill: 'herbalism', xp: 4 },
  },
  craft: {
    default: { skill: 'crafting', xp: 4 },
  },
};

// prefix: 'skill.' (registerTexts(SKILL_TEXTS, 'skill.')); a paraméterek HU/EN azonosak
export const SKILL_TEXTS = {
  hu: {
    woodcutting: 'Favágás', mining: 'Bányászat', herbalism: 'Gyógynövényezés', crafting: 'Barkácsolás',
    levelup: '{skill}: {level}. szint',
    xp: '{skill} +{n} XP',
  },
  en: {
    woodcutting: 'Woodcutting', mining: 'Mining', herbalism: 'Herbalism', crafting: 'Crafting',
    levelup: '{skill}: level {level}',
    xp: '{skill} +{n} XP',
  },
};

export const SKILL_LIMITS = { maxLevel: 60, maxSkills: 64, maxGain: 1e6, maxIdLen: 24, maxEvents: 64, maxTimes: 999 };
export const SKILL_CONFIG = { base: 25, exp: 1.6 };
export const SKILL_STATE_VERSION = 1;
const ID_RE = /^[a-z0-9_]+$/;
const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** A görbe-paraméterek szorítása (hibás -> alapérték). */
const clean = new WeakSet([SKILL_CONFIG]); // már szorított konfig-objektumok (a görbe-tábla gyorsítótár kulcsa)
export function sanitizeSkillConfig(c) {
  const s = c && typeof c === 'object' ? c : {};
  const r = { base: num(s.base, 1, 1e6, SKILL_CONFIG.base), exp: num(s.exp, 0.5, 4, SKILL_CONFIG.exp) };
  clean.add(r);
  return r;
}
const curve = c => (c && clean.has(c) ? c : sanitizeSkillConfig(c));

const tables = new WeakMap();
function table(cfg) { // kumulatív XP-küszöbök 0..maxLevel (szigorúan növekvő)
  let t = tables.get(cfg);
  if (t) return t;
  t = [0];
  for (let L = 1; L <= SKILL_LIMITS.maxLevel; L++) t.push(Math.max(t[L - 1] + 1, Math.round(cfg.base * Math.pow(L, cfg.exp))));
  tables.set(cfg, t);
  return t;
}

/** Az L. szint eléréséhez kell kumulatív XP (L szorítva 0..60). */
export function xpForLevel(level, cfg = SKILL_CONFIG) {
  const L = Number.isFinite(level) ? Math.min(SKILL_LIMITS.maxLevel, Math.max(0, Math.floor(level))) : 0;
  return table(curve(cfg))[L];
}
export function maxXp(cfg = SKILL_CONFIG) { return xpForLevel(SKILL_LIMITS.maxLevel, cfg); }

/** A kumulatív XP-hez tartozó szint 0..60 (hibás XP -> 0). */
export function levelForXp(xp, cfg = SKILL_CONFIG) {
  if (!Number.isFinite(xp) || xp <= 0) return 0;
  const t = table(curve(cfg));
  let L = 0;
  while (L < SKILL_LIMITS.maxLevel && xp >= t[L + 1]) L++;
  return L;
}

/** Egy skill-definíció ellenőrzése -> {ok, skill (fagyasztott, nameKey 'skill.<id>')|null, error}; sosem dob. */
export function validateSkillDef(def) {
  const bad = error => ({ ok: false, skill: null, error });
  if (!def || typeof def !== 'object') return bad('def');
  if (typeof def.id !== 'string' || !def.id || def.id.length > SKILL_LIMITS.maxIdLen || !ID_RE.test(def.id)) return bad('id');
  return { ok: true, skill: Object.freeze({ id: def.id, nameKey: 'skill.' + def.id }), error: null };
}

/** -> {skills:Map id->skill (a definíciók sorrendjében), errors:[hiba], dups:[id]} (hibás kiesik, duplikált az első marad). */
export function createSkillRegistry(defs = SKILL_DEFS) {
  const reg = { skills: new Map(), errors: [], dups: [] };
  if (!Array.isArray(defs)) { reg.errors.push('defs'); return reg; }
  for (const d of defs) {
    const v = validateSkillDef(d);
    if (!v.ok) { reg.errors.push(v.error); continue; }
    if (reg.skills.has(v.skill.id)) { reg.dups.push(v.skill.id); continue; }
    if (reg.skills.size >= SKILL_LIMITS.maxSkills) { reg.errors.push('limit'); continue; }
    reg.skills.set(v.skill.id, v.skill);
  }
  return reg;
}

/** Az XP-szabályok hivatkozásainak ellenőrzése -> ['gather:tree:skill', 'craft:default:xp', ...] (üres = rendben). */
export function auditSkillRules(reg, rules = XP_RULES) {
  const out = [];
  const known = reg && reg.skills instanceof Map ? reg.skills : new Map();
  for (const kind of ['gather', 'craft']) {
    const group = rules && rules[kind];
    if (!group || typeof group !== 'object') { out.push(kind); continue; }
    for (const k of Object.keys(group)) {
      const r = group[k];
      if (!r || typeof r.skill !== 'string' || !known.has(r.skill)) out.push(`${kind}:${k}:skill`);
      if (!r || !Number.isInteger(r.xp) || r.xp < 1 || r.xp > SKILL_LIMITS.maxGain) out.push(`${kind}:${k}:xp`);
    }
  }
  if (!rules || !rules.craft || !own(rules.craft, 'default')) out.push('craft:default');
  return out;
}

/** createSkillSystem({reg|defs, rules, cfg}) -> {reg, rules, cfg, sets:[{xp:Map}, {xp:Map}], listeners, events (utolsó <= 64), stats, lastError}. */
export function createSkillSystem(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  return {
    reg: o.reg && o.reg.skills instanceof Map ? o.reg : createSkillRegistry(o.defs || SKILL_DEFS),
    rules: o.rules && typeof o.rules === 'object' ? o.rules : XP_RULES,
    cfg: sanitizeSkillConfig(o.cfg),
    sets: [{ xp: new Map() }, { xp: new Map() }],
    listeners: [], events: [], stats: { xpEvents: 0, levelups: 0, rejected: 0 }, lastError: null,
  };
}

/** Eseményfigyelő (HUD-toast, hang, napló): ev {type 'xp', player, skill, amount, xp, level, source} | {type 'levelup', player, skill, from, level}; -> leiratkozó. */
export function onSkill(sys, fn) {
  if (!sys || !Array.isArray(sys.listeners) || typeof fn !== 'function') return () => {};
  sys.listeners.push(fn);
  return () => { const i = sys.listeners.indexOf(fn); if (i >= 0) sys.listeners.splice(i, 1); };
}

function emit(sys, ev) {
  sys.events.push(ev);
  if (sys.events.length > SKILL_LIMITS.maxEvents) sys.events.splice(0, sys.events.length - SKILL_LIMITS.maxEvents);
  for (const fn of sys.listeners.slice()) {
    try { fn(ev); } catch (e) { sys.lastError = e; }
  }
}

const okPlayer = (sys, p) => !!sys && Array.isArray(sys.sets) && Number.isInteger(p) && p >= 0 && p < sys.sets.length;

export function skillXp(sys, player, skill) {
  if (!okPlayer(sys, player)) return 0;
  return sys.sets[player].xp.get(skill) || 0;
}
export function skillLevel(sys, player, skill) { return levelForXp(skillXp(sys, player, skill), sys && sys.cfg); }

/**
 * XP hozzáadása (ATOMI; sosem dob): -> {ok, reason null|player|skill|amount, gained, xp, level, levels (az újonnan elért szintek száma)}.
 * Az amount egész (törtrész levágva), >= 1, <= maxGain; a 60. szint XP-jénél megáll (gained 0, nincs esemény).
 */
export function addXp(sys, player, skill, amount, source = '') {
  const fail = reason => { if (sys && sys.stats) sys.stats.rejected++; return { ok: false, reason, gained: 0, xp: 0, level: 0, levels: 0 }; };
  if (!okPlayer(sys, player) || !sys.reg || !(sys.reg.skills instanceof Map)) return fail('player');
  if (typeof skill !== 'string' || !sys.reg.skills.has(skill)) return fail('skill');
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 1) return fail('amount');
  const add = Math.min(SKILL_LIMITS.maxGain, Math.floor(amount));
  const set = sys.sets[player].xp;
  const cur = set.get(skill) || 0, cap = maxXp(sys.cfg);
  const next = Math.min(cap, cur + add), gained = next - cur;
  const from = levelForXp(cur, sys.cfg), level = levelForXp(next, sys.cfg);
  if (gained <= 0) return { ok: true, reason: null, gained: 0, xp: cur, level: from, levels: 0 };
  set.set(skill, next);
  sys.stats.xpEvents++;
  emit(sys, { type: 'xp', player, skill, amount: gained, xp: next, level, source: typeof source === 'string' ? source : '' });
  if (level > from) { sys.stats.levelups++; emit(sys, { type: 'levelup', player, skill, from, level }); }
  return { ok: true, reason: null, gained, xp: next, level, levels: level - from };
}

/** Egy skill haladása -> {id, nameKey, xp, level, into (XP a szinten belül), need (XP a következő szintig; max szinten 0), ratio 0..1, max}. */
export function skillProgress(sys, player, skill) {
  const def = sys && sys.reg && sys.reg.skills instanceof Map ? sys.reg.skills.get(skill) : null;
  if (!def) return null;
  const xp = skillXp(sys, player, skill), level = levelForXp(xp, sys.cfg), max = level >= SKILL_LIMITS.maxLevel;
  const lo = xpForLevel(level, sys.cfg), hi = max ? lo : xpForLevel(level + 1, sys.cfg);
  return { id: def.id, nameKey: def.nameKey, xp, level, into: xp - lo, need: max ? 0 : hi - xp, ratio: max ? 1 : (xp - lo) / (hi - lo), max };
}

/** Egy játékos összes skillje a regiszter sorrendjében (az S049 menü / S062 talentfa UI-nak). */
export function skillView(sys, player) {
  if (!okPlayer(sys, player) || !sys.reg || !(sys.reg.skills instanceof Map)) return [];
  return [...sys.reg.skills.keys()].map(id => skillProgress(sys, player, id));
}

/** A craft ctx.skills függvénye: id -> a játékos skill-szintje (ismeretlen skill: 0). A main.js: stationCtx(stations, p, skillsOf(skills, i)). */
export function skillsOf(sys, player) { return id => skillLevel(sys, player, id); }

/** Gyűjtés-esemény -> {skill, xp}|null: csak a 'depleted' (a kitermelés befejezője kapja), a szabály a node-típus szerint. */
export function xpForNodeEvent(rules, ev) {
  if (!ev || ev.type !== 'depleted' || !rules || !own(rules.gather, ev.nodeType)) return null;
  const r = rules.gather[ev.nodeType];
  return r && typeof r.skill === 'string' && Number.isInteger(r.xp) && r.xp > 0 ? { skill: r.skill, xp: r.xp } : null;
}

/** Craft -> {skill, xp}|null: recept-id szerinti szabály, különben `default`; a recept skill-kapuja (ismert skill) felülírja a skillt; xp = szabály · times. */
export function xpForCraft(rules, recipe, times = 1, reg = null) {
  const g = rules && rules.craft;
  if (!g) return null;
  const rule = recipe && own(g, recipe.id) ? g[recipe.id] : g.default;
  if (!rule || typeof rule.skill !== 'string' || !Number.isInteger(rule.xp) || rule.xp < 1) return null;
  const n = Number.isInteger(times) && times >= 1 ? Math.min(times, SKILL_LIMITS.maxTimes) : 1;
  const gate = recipe && recipe.skill && typeof recipe.skill.skill === 'string' ? recipe.skill.skill : null;
  const skill = gate && (!reg || (reg.skills instanceof Map && reg.skills.has(gate))) ? gate : rule.skill;
  return { skill, xp: Math.min(SKILL_LIMITS.maxGain, rule.xp * n) };
}

/**
 * Az XP-buszra kötés: connectSkills(sys, {nodes, craftUi, recipes}) -> leválasztó. A nodes (game-nodes) 'depleted' és a craftUi (game-craftui)
 * 'craft' eseménye XP-t ad az eseményben lévő játékosnak; a hiányzó forrás kimarad; a figyelők hibája a sys.lastError-ba kerül, nem dob.
 */
export function connectSkills(sys, src) {
  const s = src && typeof src === 'object' ? src : {};
  const offs = [];
  const safe = fn => ev => { try { fn(ev); } catch (e) { if (sys) sys.lastError = e; } };
  if (s.nodes) offs.push(onNode(s.nodes, safe(ev => {
    const g = xpForNodeEvent(sys.rules, ev);
    if (g) addXp(sys, ev.player, g.skill, g.xp, 'gather:' + ev.nodeType);
  })));
  if (s.craftUi) offs.push(onCraft(s.craftUi, safe(ev => {
    if (!ev || ev.type !== 'craft') return;
    const rec = getRecipe(s.recipes, ev.recipe);
    const g = xpForCraft(sys.rules, rec || { id: ev.recipe }, ev.times, sys.reg);
    if (g) addXp(sys, ev.player, g.skill, g.xp, 'craft:' + ev.recipe);
  })));
  return () => { for (const off of offs.splice(0)) off(); };
}

/** Mentés-alak (az S050 köti a mentésbe): {v:1, players:[[[skill, xp], ...], [..]]} */
export function skillState(sys) {
  return { v: SKILL_STATE_VERSION, players: sys.sets.map(s => [...s.xp.entries()].filter(([, xp]) => xp > 0)) };
}

/** Visszatöltés (ATOMI: hibánál semmi nem változik) -> bool. Az ismeretlen skill-azonosítót kihagyja, az XP-t a 60. szint küszöbére szorítja; nem küld eseményt. */
export function restoreSkills(sys, st) {
  try {
    if (!sys || !Array.isArray(sys.sets) || !st || st.v !== SKILL_STATE_VERSION || !Array.isArray(st.players) || st.players.length !== sys.sets.length) return false;
    const cap = maxXp(sys.cfg), next = [];
    for (const list of st.players) {
      if (!Array.isArray(list)) return false;
      const m = new Map();
      for (const e of list) {
        if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== 'string' || !Number.isInteger(e[1]) || e[1] < 0 || m.has(e[0])) return false;
        if (sys.reg.skills.has(e[0]) && e[1] > 0) m.set(e[0], Math.min(cap, e[1]));
      }
      next.push(m);
    }
    next.forEach((m, i) => { sys.sets[i].xp = m; });
    return true;
  } catch (e) { return false; }
}

/** i18n: a szintlépés-üzenet kész szövege (t = a fordító függvény) – pl. HUD-toasthoz. */
export function skillToast(ev, t) {
  if (!ev || typeof t !== 'function') return '';
  if (ev.type === 'levelup') return t('skill.levelup', { skill: t('skill.' + ev.skill), level: ev.level });
  if (ev.type === 'xp') return t('skill.xp', { skill: t('skill.' + ev.skill), n: ev.amount });
  return '';
}
