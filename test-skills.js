// test-skills.js (S045) – skillek: adat/szövegek, szintgörbe, addXp (atomi), két játékos, események, XP-szabályok, a valódi node- és craft-rendszerre kötés,
// skill-kapus recept, mentés-alak, fuzz + smoke. Tiszta logika, Node-ban fut.
import { test, assert, eq } from './test-index.js';
import {
  SKILL_DEFS, XP_RULES, SKILL_TEXTS, SKILL_LIMITS, SKILL_CONFIG, sanitizeSkillConfig, xpForLevel, maxXp, levelForXp, validateSkillDef, createSkillRegistry, auditSkillRules,
  createSkillSystem, onSkill, skillXp, skillLevel, addXp, skillProgress, skillView, skillsOf, xpForNodeEvent, xpForCraft, connectSkills,
  skillState, restoreSkills, skillToast,
} from './game-skills.js';
import { createI18n, addTexts, auditTexts, translate } from './i18n.js';
import { BASE_TEXTS } from './data-text.js';
import { createWorldStream, warmStream } from './world-stream.js';
import { createObjectStore, syncObjects } from './world-objects.js';
import { createNodeSystem, stepNodes } from './game-nodes.js';
import { createItemRegistry, ITEM_DEFS } from './data-items.js';
import { createPlayerInventories, createInventory, addItem, countItem } from './game-inventory.js';
import { createRecipeRegistry, getRecipe, craftCheck } from './game-crafting.js';
import { createCraftUi, routeCraftInputs, stepCraftUi, craftTabActive } from './game-craftui.js';
import { mulberry32 } from './world-noise.js';

const MAXL = SKILL_LIMITS.maxLevel;
const sys0 = () => createSkillSystem();
const BAD = [0, -5, 0.5, NaN, Infinity, -Infinity, '5', null, undefined, {}, [], true];

test('skills: adat – regiszter, szövegek HU/EN azonos paraméterekkel, XP-szabályok hivatkozásai', () => {
  const reg = createSkillRegistry();
  eq(reg.errors.length, 0); eq(reg.dups.length, 0); eq(reg.skills.size, SKILL_DEFS.length);
  eq([...reg.skills.keys()].join(), 'woodcutting,mining,herbalism,crafting');
  eq(reg.skills.get('mining').nameKey, 'skill.mining'); assert(Object.isFrozen(reg.skills.get('mining')));
  eq(auditSkillRules(reg, XP_RULES).length, 0, 'a szabályok érvényesek');
  const i = createI18n({ texts: BASE_TEXTS }); addTexts(i, SKILL_TEXTS, 'skill.');
  const a = auditTexts(i); assert(a.ok, 'szöveg-audit: ' + JSON.stringify(a));
  for (const id of reg.skills.keys()) for (const l of ['hu', 'en']) assert(translate(i, 'skill.' + id, undefined, l) !== 'skill.' + id, 'hiányzó név: ' + id + ' ' + l);
});

test('skills: hibás definíció és szabály – kiesik / jelzi, nem dob', () => {
  for (const d of [null, 5, {}, { id: '' }, { id: 'Nagy' }, { id: 'a b' }, { id: 'x'.repeat(25) }, { id: 7 }]) eq(validateSkillDef(d).ok, false, JSON.stringify(d));
  const r = createSkillRegistry([{ id: 'a' }, { id: 'a' }, { id: 'B' }, null, { id: 'b' }]);
  eq([...r.skills.keys()].join(), 'a,b'); eq(r.dups.join(), 'a'); eq(r.errors.length, 2);
  eq(createSkillRegistry('x').errors[0], 'defs');
  const many = createSkillRegistry(Array.from({ length: 70 }, (_, k) => ({ id: 's' + k }))); eq(many.skills.size, SKILL_LIMITS.maxSkills);
  const reg = createSkillRegistry();
  const bad = auditSkillRules(reg, { gather: { tree: { skill: 'nincs', xp: 3 }, stone: { skill: 'mining', xp: 0 } }, craft: { x: { skill: 'crafting', xp: 2 } } });
  assert(bad.includes('gather:tree:skill') && bad.includes('gather:stone:xp') && bad.includes('craft:default'), bad.join());
  assert(auditSkillRules(reg, null).length >= 2);
});

test('skills: szintgörbe – 0 = 0 XP, szigorúan növekvő, 60 a plafon, levelForXp az inverze, hibás bemenet', () => {
  eq(xpForLevel(0), 0); eq(xpForLevel(1), SKILL_CONFIG.base);
  for (let L = 1; L <= MAXL; L++) assert(xpForLevel(L) > xpForLevel(L - 1), 'nem növekvő: ' + L);
  eq(xpForLevel(99), xpForLevel(MAXL)); eq(xpForLevel(-3), 0); eq(xpForLevel(NaN), 0); eq(xpForLevel(2.9), xpForLevel(2));
  eq(maxXp(), xpForLevel(MAXL));
  for (let L = 0; L <= MAXL; L++) {
    eq(levelForXp(xpForLevel(L)), L, 'küszöb ' + L);
    if (L > 0) eq(levelForXp(xpForLevel(L) - 1), L - 1, 'küszöb-1 ' + L);
  }
  eq(levelForXp(1e12), MAXL); for (const b of [-1, NaN, Infinity, '5', null, undefined]) eq(levelForXp(b), b === Infinity ? 0 : 0, String(b));
  const flat = { base: 1, exp: 0.5 }; for (let L = 1; L <= MAXL; L++) assert(xpForLevel(L, flat) > xpForLevel(L - 1, flat), 'lapos görbén is szigorú: ' + L);
  const s = sanitizeSkillConfig({ base: -4, exp: 99 }); eq(s.base, 1); eq(s.exp, 4);
  const d = sanitizeSkillConfig('x'); eq(d.base, SKILL_CONFIG.base); eq(d.exp, SKILL_CONFIG.exp);
  assert(xpForLevel(30, { base: 50, exp: 1.6 }) > xpForLevel(30), 'a konfig hat a görbére');
});

test('skills: addXp – szintlépés-események, több szint egy lépésben, a 60. szint plafonja', () => {
  const s = sys0(), seen = []; onSkill(s, ev => seen.push(ev));
  let r = addXp(s, 0, 'mining', 10, 'teszt');
  assert(r.ok && r.gained === 10 && r.level === 0 && r.levels === 0, JSON.stringify(r)); eq(seen.length, 1); eq(seen[0].type, 'xp'); eq(seen[0].source, 'teszt'); eq(seen[0].xp, 10);
  r = addXp(s, 0, 'mining', xpForLevel(1) - 10); eq(r.level, 1); eq(r.levels, 1);
  eq(seen.map(e => e.type).join(), 'xp,xp,levelup'); eq(seen[2].from, 0); eq(seen[2].level, 1);
  r = addXp(s, 0, 'mining', xpForLevel(5) - skillXp(s, 0, 'mining')); eq(r.levels, 4); eq(seen.filter(e => e.type === 'levelup').pop().from, 1);
  eq(s.stats.levelups, 2); eq(skillLevel(s, 0, 'mining'), 5);
  r = addXp(s, 0, 'mining', 5.9); eq(r.gained, 5, 'a törtrész levágva');
  addXp(s, 0, 'mining', 1e6); addXp(s, 0, 'mining', 1e6); eq(skillLevel(s, 0, 'mining'), MAXL); eq(skillXp(s, 0, 'mining'), maxXp());
  const n = seen.length; r = addXp(s, 0, 'mining', 50); assert(r.ok && r.gained === 0 && r.levels === 0); eq(seen.length, n, 'a plafonon nincs esemény');
  const big = sys0(); eq(addXp(big, 0, 'mining', 1e15).gained, Math.min(SKILL_LIMITS.maxGain, maxXp()));
});

test('skills: addXp – hibás bemenet atomi (semmi nem változik, nem dob), a hibakód jelzi az okot', () => {
  const s = sys0(); addXp(s, 0, 'mining', 30); const before = JSON.stringify(skillState(s)), ev = s.events.length;
  for (const p of [-1, 2, 0.5, NaN, null, undefined, '0']) eq(addXp(s, p, 'mining', 5).reason, 'player', 'játékos ' + p);
  for (const k of ['nincs', '', null, 7, undefined, '__proto__', 'constructor']) eq(addXp(s, 0, k, 5).reason, 'skill', String(k));
  for (const a of BAD) eq(addXp(s, 0, 'mining', a).reason, 'amount', String(a));
  eq(addXp(null, 0, 'mining', 5).ok, false); eq(addXp({}, 0, 'mining', 5).ok, false);
  eq(JSON.stringify(skillState(s)), before); eq(s.events.length, ev); assert(s.stats.rejected > 20);
  eq(skillXp(s, 5, 'mining'), 0); eq(skillLevel(null, 0, 'mining'), 0); eq(skillXp(s, 0, 'nincs'), 0);
});

test('skills: két játékos külön skillekkel; haladás-nézet és skillsOf', () => {
  const s = sys0(); addXp(s, 0, 'woodcutting', xpForLevel(3) + 7); addXp(s, 1, 'woodcutting', 5);
  eq(skillLevel(s, 0, 'woodcutting'), 3); eq(skillLevel(s, 1, 'woodcutting'), 0); eq(skillXp(s, 1, 'mining'), 0);
  const p = skillProgress(s, 0, 'woodcutting');
  eq(p.level, 3); eq(p.into, 7); eq(p.need, xpForLevel(4) - xpForLevel(3) - 7); assert(p.ratio > 0 && p.ratio < 1 && !p.max);
  eq(skillProgress(s, 0, 'nincs'), null); eq(skillProgress(null, 0, 'mining'), null);
  const v = skillView(s, 0); eq(v.map(x => x.id).join(), [...s.reg.skills.keys()].join()); eq(v[0].level, 3); eq(skillView(s, 9).length, 0);
  addXp(s, 1, 'mining', 1e7); const m = skillProgress(s, 1, 'mining'); assert(m.max && m.ratio === 1 && m.need === 0);
  const f0 = skillsOf(s, 0), f1 = skillsOf(s, 1); eq(f0('woodcutting'), 3); eq(f1('woodcutting'), 0); eq(f1('mining'), MAXL); eq(f0('nincs'), 0); eq(f0(undefined), 0);
});

test('skills: figyelők – leiratkozás, hibázó figyelő nem állítja meg a többit, esemény-puffer korlátos', () => {
  const s = sys0(), a = [], off = onSkill(s, e => a.push(e)); let got = 0;
  onSkill(s, () => { throw new Error('x'); }); onSkill(s, () => { got++; });
  addXp(s, 0, 'crafting', 3); eq(a.length, 1); eq(got, 1); assert(s.lastError);
  off(); addXp(s, 0, 'crafting', 3); eq(a.length, 1, 'leiratkozás után nincs értesítés');
  for (const bad of [null, 5, 'x', undefined]) eq(typeof onSkill(s, bad), 'function'); eq(typeof onSkill(null, () => {}), 'function');
  for (let k = 0; k < 300; k++) addXp(s, 1, 'crafting', 1); assert(s.events.length <= SKILL_LIMITS.maxEvents, 'puffer: ' + s.events.length);
});

test('skills: XP-szabályok – xpForNodeEvent / xpForCraft (alapszabály, recept-felülírás, skill-kapu, times, hibás bemenet)', () => {
  const reg = createSkillRegistry();
  eq(JSON.stringify(xpForNodeEvent(XP_RULES, { type: 'depleted', nodeType: 'tree' })), JSON.stringify({ skill: 'woodcutting', xp: 6 }));
  eq(xpForNodeEvent(XP_RULES, { type: 'hit', nodeType: 'tree' }), null); eq(xpForNodeEvent(XP_RULES, { type: 'depleted', nodeType: 'nincs' }), null);
  eq(xpForNodeEvent(XP_RULES, { type: 'depleted', nodeType: 'constructor' }), null); eq(xpForNodeEvent(XP_RULES, { type: 'depleted', nodeType: '__proto__' }), null);
  eq(xpForNodeEvent(null, { type: 'depleted', nodeType: 'tree' }), null); eq(xpForNodeEvent(XP_RULES, null), null);
  eq(xpForNodeEvent({ gather: { tree: { skill: 'x', xp: 1.5 } } }, { type: 'depleted', nodeType: 'tree' }), null);
  eq(JSON.stringify(xpForCraft(XP_RULES, { id: 'torch' }, 1, reg)), JSON.stringify({ skill: 'crafting', xp: 4 }));
  eq(xpForCraft(XP_RULES, { id: 'torch' }, 3, reg).xp, 12, 'xp × times');
  for (const t of [0, -2, 1.5, NaN, undefined, '3']) eq(xpForCraft(XP_RULES, { id: 'torch' }, t, reg).xp, 4, 'hibás times: ' + t);
  eq(xpForCraft(XP_RULES, { id: 'torch' }, 99999, reg).xp, 4 * SKILL_LIMITS.maxTimes);
  eq(xpForCraft(XP_RULES, { id: 'sword', skill: { skill: 'mining', level: 2 } }, 1, reg).skill, 'mining', 'a skill-kapu felülírja');
  eq(xpForCraft(XP_RULES, { id: 'sword', skill: { skill: 'ismeretlen', level: 2 } }, 1, reg).skill, 'crafting', 'ismeretlen kapu-skill -> alap');
  const own = { craft: { default: { skill: 'crafting', xp: 4 }, special: { skill: 'mining', xp: 20 } } };
  eq(xpForCraft(own, { id: 'special' }, 2, reg).xp, 40); eq(xpForCraft(own, { id: 'constructor' }, 1, reg).skill, 'crafting');
  eq(xpForCraft({}, { id: 'x' }, 1, reg), null); eq(xpForCraft(null, null, 1, reg), null); eq(xpForCraft({ craft: {} }, { id: 'x' }, 1, reg), null);
});

// --- integráció a valódi node-rendszerrel
const SEED = 12014, DT = 1 / 60, HOLD = { x: 0, y: 0, interact: true }, IDLE = { x: 0, y: 0, interact: false };
const tgt = o => ({ kind: 'object', ref: o, action: 'gather', key: 'obj:' + o.id });
function nodeWorld() {
  const ws = createWorldStream(SEED); warmStream(ws, [{ x: 0, y: 0 }]);
  const os = createObjectStore(SEED, { cfg: { herbChance: 0.01 } }); syncObjects(os, ws);
  const first = type => { for (const ch of os.chunks.values()) for (const o of ch.list) if (o.type === type) return o; return null; };
  return { os, first, ns: createNodeSystem(os, { seed: SEED }) };
}
function gather(ns, p, o, inv, secs = 10) {
  const tg = [null, null]; tg[p] = tgt(o); const ins = [IDLE, IDLE]; ins[p] = HOLD;
  for (let f = 0; f < secs * 60 && !ns.depleted.has(o.id); f++) stepNodes(ns, [], ins, tg, inv, 0, DT);
}

test('skills + node-ok: a kitermelés XP-t ad a befejezőnek (fa -> favágás, kő -> bányászat, gyógynövény -> gyógynövényezés), a hit nem', () => {
  const { first, ns } = nodeWorld(), s = sys0(), inv = createPlayerInventories(), seen = [];
  onSkill(s, e => seen.push(e)); const off = connectSkills(s, { nodes: ns });
  const tree = first('tree'), stone = first('stone'), herb = first('herb'); assert(tree && stone && herb, 'van fa, kő és gyógynövény');
  gather(ns, 0, tree, inv); assert(ns.depleted.has(tree.id), 'kitermelve');
  eq(skillXp(s, 0, 'woodcutting'), 6); eq(skillXp(s, 1, 'woodcutting'), 0, 'a másik játékos nem kap'); eq(seen.length, 1, 'ütésenként nincs XP');
  assert(seen[0].source === 'gather:tree' && seen[0].player === 0);
  gather(ns, 1, stone, inv, 15); eq(skillXp(s, 1, 'mining'), 8); eq(skillXp(s, 0, 'mining'), 0);
  gather(ns, 0, herb, inv); eq(skillXp(s, 0, 'herbalism'), 4);
  off(); const tree2 = [...ns.os.chunks.values()].flatMap(c => c.list).find(o => o.type === 'tree'); gather(ns, 0, tree2, inv); eq(skillXp(s, 0, 'woodcutting'), 6, 'leválasztás után nincs XP');
});

// --- integráció a valódi craft UI-val + skill-kapus recept
const ITEMS = ['wood', 'plank', 'beam'].map(id => ({ id, stack: 99, weight: 0.5, value: 1, tags: ['MATERIAL'] }));
const RECIPES = [
  { id: 'plank', inputs: [{ item: 'wood', n: 1 }], output: { item: 'plank', n: 1 }, station: null, skill: null },
  { id: 'beam', inputs: [{ item: 'plank', n: 1 }], output: { item: 'beam', n: 1 }, station: null, skill: { skill: 'crafting', level: 1 } },
];
const P = o => ({ x: 0, y: 0, interact: false, ability1: false, ability2: false, menu: false, interactPressed: false, ability1Pressed: false, ability2Pressed: false, menuPressed: false, ...o });
function craftWorld(s) {
  const itemReg = createItemRegistry(ITEMS), recipes = createRecipeRegistry(RECIPES, itemReg);
  const inv = [createInventory(itemReg, 24), createInventory(itemReg, 24)];
  const cs = createCraftUi({ recipes, ctxOf: i => ({ stations: new Set(), skills: skillsOf(s, i) }) });
  const w = { recipes, inv, cs, menus: { open: [false, false] } };
  w.frame = raws => { const r = routeCraftInputs(cs, w.menus, raws); for (let i = 0; i < 2; i++) if (r.menu[i] && r.menu[i].menuPressed) w.menus.open[i] = !w.menus.open[i]; return stepCraftUi(cs, w.menus, raws, inv, DT); };
  w.idle = () => w.frame([P(), P()]);
  w.open = i => { const a = [P(), P()]; a[i] = P({ menuPressed: true }); w.frame(a); w.frame(a.map((_, k) => (k === i ? P({ menuPressed: true }) : P()))); w.idle(); w.idle(); };
  w.make = (i, o) => { const a = [P(), P()]; a[i] = P(o); const ev = w.frame(a); w.idle(); return ev; };
  return w;
}

test('skills + craft UI: a craft XP-t ad (xp × darab), a recept skill-kapuja a skill-szintre zár, a szint megnyitja', () => {
  const s = sys0(), w = craftWorld(s), seen = []; onSkill(s, e => seen.push(e));
  connectSkills(s, { craftUi: w.cs, recipes: w.recipes });
  addItem(w.inv[0], 'wood', 20); w.open(0); assert(craftTabActive(w.cs, w.menus, 0), 'craft fül nyitva');
  eq(w.cs.players[0].rows.map(r => r.recipe.id).sort().join(), 'beam,plank'); w.cs.players[0].id = 'plank'; // a sorrend id szerinti: a kiválasztás id-vel
  const ev = w.make(0, { interactPressed: true }); eq(ev[0].type, 'craft'); eq(countItem(w.inv[0], 'plank'), 1);
  eq(skillXp(s, 0, 'crafting'), 4, '1 db = 4 XP'); eq(skillXp(s, 1, 'crafting'), 0);
  w.make(0, { ability1Pressed: true }); eq(skillXp(s, 0, 'crafting'), 4 + 4 * 19, 'a max darabszám × 4 XP (ability1 = max)'); eq(countItem(w.inv[0], 'wood'), 0);
  assert(skillLevel(s, 0, 'crafting') >= 1, 'a szint nőtt: ' + skillLevel(s, 0, 'crafting')); assert(seen.some(e => e.type === 'levelup'));
  const beam = getRecipe(w.recipes, 'beam');
  eq(craftCheck(w.inv[0], beam, { skills: skillsOf(s, 0) }).reason, null, 'a skill-kapu a szinttel megnyílik');
  eq(craftCheck(w.inv[0], beam, { skills: skillsOf(s, 1) }).reason, 'skill', 'a másik játékosnak még zárt');
  const before = skillXp(s, 0, 'crafting'); const fail = w.make(0, { interactPressed: true }); assert(fail.length > 0);
  assert(skillXp(s, 0, 'crafting') >= before, 'nem csökken');
});

test('skills + craft UI: a sikertelen craft nem ad XP; skill-kapus recept a kapu skilljét növeli; hibás recept-hivatkozás nem dob', () => {
  const s = sys0(), w = craftWorld(s); connectSkills(s, { craftUi: w.cs, recipes: w.recipes });
  w.open(1); w.cs.players[1].id = 'plank'; w.make(1, { interactPressed: true }); eq(skillXp(s, 1, 'crafting'), 0, 'nincs hozzávaló -> nincs XP');
  addXp(s, 1, 'crafting', xpForLevel(1)); addItem(w.inv[1], 'plank', 3); w.cs.players[1].id = 'beam';
  const x0 = skillXp(s, 1, 'crafting'); w.make(1, { interactPressed: true }); assert(countItem(w.inv[1], 'beam') >= 1, 'a kapus recept elkészült'); eq(skillXp(s, 1, 'crafting'), x0 + 4);
  const s2 = sys0(); const off = connectSkills(s2, { craftUi: w.cs, recipes: null }); w.cs.listeners.forEach(fn => fn({ type: 'craft', player: 0, recipe: 'ismeretlen', times: 2 })); eq(skillXp(s2, 0, 'crafting'), 8, 'ismeretlen recept -> alapszabály');
  w.cs.listeners.forEach(fn => { fn(null); fn({ type: 'craft-fail', player: 0, recipe: 'plank' }); fn({ type: 'craft', player: 7, recipe: 'plank', times: 1 }); });
  eq(skillXp(s2, 0, 'crafting'), 8); off();
});

test('skills: connectSkills – hiányzó forrás kimarad, a leválasztó többször hívható, hibás rendszer nem dob', () => {
  const s = sys0(); const off = connectSkills(s, {}); eq(typeof off, 'function'); off(); off();
  const { ns } = nodeWorld(), c0 = ns.listeners.length; const off2 = connectSkills(s, { nodes: ns }); eq(ns.listeners.length, c0 + 1); off2(); off2(); eq(ns.listeners.length, c0);
  const off3 = connectSkills(null, { nodes: ns }); ns.listeners.forEach(fn => fn({ type: 'depleted', player: 0, nodeType: 'tree' })); off3(); eq(ns.listeners.length, c0);
  eq(typeof connectSkills(s, null), 'function');
});

test('skills: mentés-alak – körút, ATOMI hibás visszatöltés, ismeretlen skill kihagyva, plafon, nincs esemény', () => {
  const s = sys0(); addXp(s, 0, 'mining', 777); addXp(s, 1, 'herbalism', 31); addXp(s, 1, 'crafting', 1e7);
  const st = skillState(s); eq(st.v, 1); eq(st.players.length, 2); eq(JSON.stringify(JSON.parse(JSON.stringify(st))), JSON.stringify(st), 'JSON-barát');
  const t = sys0(), ev = []; onSkill(t, e => ev.push(e)); eq(restoreSkills(t, JSON.parse(JSON.stringify(st))), true);
  eq(skillXp(t, 0, 'mining'), 777); eq(skillXp(t, 1, 'herbalism'), 31); eq(skillLevel(t, 1, 'crafting'), MAXL); eq(ev.length, 0, 'a betöltés nem küld eseményt');
  eq(JSON.stringify(skillState(t)), JSON.stringify(st), 'a kör azonos');
  const snap = JSON.stringify(skillState(t));
  for (const bad of [null, 5, {}, { v: 2, players: [[], []] }, { v: 1 }, { v: 1, players: [[]] }, { v: 1, players: [[], [], []] }, { v: 1, players: [5, []] },
    { v: 1, players: [[['mining', 5], ['mining', 6]], []] }, { v: 1, players: [[['mining', -1]], []] }, { v: 1, players: [[['mining', 1.5]], []] }, { v: 1, players: [[['mining']], []] },
    { v: 1, players: [[[7, 5]], []] }, { v: 1, players: [[], [['mining', 5], 'x']] }, { v: 1, players: [[['mining', 5]], [['mining', NaN]]] }]) {
    eq(restoreSkills(t, bad), false, JSON.stringify(bad)); eq(JSON.stringify(skillState(t)), snap, 'atomi: ' + JSON.stringify(bad));
  }
  eq(restoreSkills(null, st), false); eq(restoreSkills({}, st), false);
  const u = sys0(); eq(restoreSkills(u, { v: 1, players: [[['jovobeli', 50], ['mining', 9e9]], []] }), true);
  eq(skillXp(u, 0, 'jovobeli'), 0, 'ismeretlen skill kihagyva'); eq(skillXp(u, 0, 'mining'), maxXp(), 'plafonra szorítva');
  eq(skillState(sys0()).players.map(p => p.length).join(), '0,0', 'az üres skill nincs a mentésben');
});

test('skills: szöveg-toast – szintlépés és XP, nyelvenként, hibás bemenet üres', () => {
  const i = createI18n({ texts: BASE_TEXTS }); addTexts(i, SKILL_TEXTS, 'skill.');
  const hu = (k, p) => translate(i, k, p, 'hu'), en = (k, p) => translate(i, k, p, 'en');
  eq(skillToast({ type: 'levelup', skill: 'mining', level: 4 }, hu), 'Bányászat: 4. szint'); eq(skillToast({ type: 'levelup', skill: 'mining', level: 4 }, en), 'Mining: level 4');
  eq(skillToast({ type: 'xp', skill: 'crafting', amount: 8 }, en), 'Crafting +8 XP');
  eq(skillToast(null, hu), ''); eq(skillToast({ type: 'x' }, hu), ''); eq(skillToast({ type: 'xp', skill: 'mining', amount: 1 }, null), '');
});

test('skills: 8000 véletlen művelet – invariánsok (XP-összeg tartása, szint-monotonitás, plafon, determinizmus, nincs NaN)', () => {
  const run = seed => {
    const r = mulberry32(seed), s = sys0(), ids = [...s.reg.skills.keys()], sum = [{}, {}], lvl = new Map(); let from = 0;
    onSkill(s, e => { if (e.type === 'levelup') { assert(e.level > e.from && e.level <= MAXL, 'szintlépés'); from++; } });
    for (let k = 0; k < 8000; k++) {
      const p = r() < 0.5 ? 0 : 1, id = ids[Math.floor(r() * ids.length)], amt = r() < 0.05 ? BAD[Math.floor(r() * BAD.length)] : Math.floor(r() * 400) + 1;
      const before = skillXp(s, p, id), res = addXp(s, p, id, amt);
      if (res.ok) { assert(res.gained >= 0 && skillXp(s, p, id) === before + res.gained, 'összeg'); sum[p][id] = (sum[p][id] || 0) + res.gained; }
      else eq(skillXp(s, p, id), before, 'elutasított nem módosít');
      const key = p + id, l = skillLevel(s, p, id); assert(l >= (lvl.get(key) || 0) && l <= MAXL && Number.isInteger(l), 'szint-monotonitás'); lvl.set(key, l);
      assert(skillXp(s, p, id) <= maxXp() && Number.isFinite(skillXp(s, p, id)), 'plafon');
      if (k % 2000 === 1999) { const t = sys0(); eq(restoreSkills(t, JSON.parse(JSON.stringify(skillState(s)))), true); eq(JSON.stringify(skillState(t)), JSON.stringify(skillState(s)), 'mentés-kör'); }
    }
    for (let p = 0; p < 2; p++) for (const id of ids) eq(skillXp(s, p, id), sum[p][id] || 0, 'XP-összeg');
    return JSON.stringify(skillState(s)) + from;
  };
  eq(run(45), run(45), 'determinisztikus'); assert(run(45) !== run(46), 'a seed számít');
});
