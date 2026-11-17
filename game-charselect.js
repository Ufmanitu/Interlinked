// game-charselect.js (S063) – karakterválasztó: két játékos, faj + kaszt, bármilyen kombináció, előnézet, leírás.
// Tiszta logika (nincs DOM/canvas; importja: game-registry, game-race, game-menu); a rajz: render-charselect.js, a bekötés: main.js.
// Menet játékosonként: faj (fel/le választ, interakció tovább) -> kaszt (interakció kész, menü gomb vissza) -> kész (menü gomb: módosít).
// Ha mindketten készek: cs.done = true, a main.js a finishCharSelect-tel ráállítja a választást a játékosokra (faj: applyRace, kaszt: p.class).
// A legutóbbi választás a storage-ba kerül (kulcs: CHARSELECT_CONFIG.storageKey), a következő induláskor ez az előre kijelölt érték. Minden függvény sosem dob.
import { getRace, getClass, getAbility } from './game-registry.js';
import { applyRace, passiveOf } from './game-race.js';
import { menuDir } from './game-menu.js';

export const CHARSELECT_CONFIG = Object.freeze({ deadzone: 0.5, repeatDelay: 0.3, repeatRate: 0.12, storageKey: 'interlinked.chars', defaults: Object.freeze([Object.freeze({ race: 0, cls: 0 }), Object.freeze({ race: 1, cls: 1 })]) });
export const STAGES = Object.freeze(['race', 'class', 'ready']);
// A faj-passzívok kiírása: id -> {szorzó (érték·szorzó = kiírt szám)}; ismeretlen passzív nem jelenik meg.
export const PASSIVE_SHOW = Object.freeze({ darkvision: 1, miner_speed: 100, herb_speed: 100, wood_speed: 100, forest_move: 100, pull_power: 100 });

// prefix: 'charsel.' (registerTexts(CHARSELECT_TEXTS, 'charsel.')); a paraméterek HU/EN azonosak
export const CHARSELECT_TEXTS = {
  hu: {
    title: 'Karakterválasztó', player: 'Játékos {n}', 'list.race': 'Faj', 'list.class': 'Kaszt',
    'stage.race': 'Válassz fajt', 'stage.class': 'Válassz kasztot', 'stage.ready': 'Kész',
    'hint.race': 'Fel/le: választ · Interakció: tovább', 'hint.class': 'Fel/le: választ · Interakció: kész · Menü: vissza', 'hint.ready': 'Menü: módosít',
    'stat.strength': 'Erő', 'stat.weight': 'Súly', 'stat.speed': 'Sebesség',
    'res.mana': 'Mana', 'res.stamina': 'Állóképesség', 'res.focus': 'Összpontosítás', 'res.none': 'Nincs',
    resource: 'Erőforrás: {res}', 'ab.slot': 'Gomb {n}', 'ab.later': 'Később', 'ab.cost': '{cost} · {cd} mp', 'ab.free': 'ingyen · {cd} mp', abilities: 'Képességek',
    'passive.darkvision': 'Sötétlátás: {v} tile', 'passive.miner_speed': 'Bányászat: +{v}%', 'passive.herb_speed': 'Gyógynövény-szedés: +{v}%',
    'passive.wood_speed': 'Favágás: +{v}%', 'passive.forest_move': 'Erdei mozgás: +{v}%', 'passive.pull_power': 'Húzóerő: +{v}%',
    wait: 'Várakozás a társra…', start: 'Mindketten készen álltok – indul a kaland', preview: 'Előnézet',
  },
  en: {
    title: 'Character select', player: 'Player {n}', 'list.race': 'Race', 'list.class': 'Class',
    'stage.race': 'Choose a race', 'stage.class': 'Choose a class', 'stage.ready': 'Ready',
    'hint.race': 'Up/down: choose · Interact: next', 'hint.class': 'Up/down: choose · Interact: ready · Menu: back', 'hint.ready': 'Menu: change',
    'stat.strength': 'Strength', 'stat.weight': 'Weight', 'stat.speed': 'Speed',
    'res.mana': 'Mana', 'res.stamina': 'Stamina', 'res.focus': 'Focus', 'res.none': 'None',
    resource: 'Resource: {res}', 'ab.slot': 'Button {n}', 'ab.later': 'Later', 'ab.cost': '{cost} · {cd} s', 'ab.free': 'free · {cd} s', abilities: 'Abilities',
    'passive.darkvision': 'Darkvision: {v} tiles', 'passive.miner_speed': 'Mining: +{v}%', 'passive.herb_speed': 'Herb gathering: +{v}%',
    'passive.wood_speed': 'Woodcutting: +{v}%', 'passive.forest_move': 'Forest movement: +{v}%', 'passive.pull_power': 'Pulling power: +{v}%',
    wait: 'Waiting for your partner…', start: 'You are both ready – the adventure begins', preview: 'Preview',
  },
};

const fin = v => typeof v === 'number' && Number.isFinite(v);
const isObj = v => !!v && typeof v === 'object';
const wrap = (v, n) => (n > 0 ? ((v % n) + n) % n : 0);
const mapKeys = m => (m && typeof m.keys === 'function' ? [...m.keys()] : []);

// ---- Választás ráállítása a játékosra ----
// ATOMI: ismeretlen faj vagy kaszt -> false, a játékos érintetlen. Faj: applyRace (strength/weight/speed), kaszt: p.class (a képesség-gombok ezt olvassák).
export function applyCharacter(reg, p, raceId, classId) {
  if (!isObj(p) || !getRace(reg, raceId) || !getClass(reg, classId)) return false;
  if (!applyRace(reg, p, raceId)) return false;
  p.class = classId;
  return true;
}
// Az összes faj × kaszt kombináció [{race, cls}] (a regiszter sorrendjében).
export function allCombos(reg) {
  const out = [];
  if (!reg) return out;
  for (const r of mapKeys(reg.races)) for (const c of mapKeys(reg.classes)) out.push({ race: r, cls: c });
  return out;
}

// ---- Mentett választás (opcionális storage: getItem/setItem) ----
// -> [{race,cls},{race,cls}] indexek (érvénytelen/hiányzó -> alap); sosem dob.
export function loadChoicePrefs(storage, races, classes, cfg = CHARSELECT_CONFIG) {
  const out = cfg.defaults.map(d => ({ race: wrap(d.race, races.length), cls: wrap(d.cls, classes.length) }));
  try {
    const raw = storage && typeof storage.getItem === 'function' ? storage.getItem(cfg.storageKey) : null;
    const d = typeof raw === 'string' ? JSON.parse(raw) : null;
    if (isObj(d) && d.v === 1 && Array.isArray(d.p)) {
      for (let i = 0; i < 2; i++) {
        const e = d.p[i];
        if (!isObj(e)) continue;
        const r = races.indexOf(e.race), c = classes.indexOf(e.cls);
        if (r >= 0) out[i].race = r;
        if (c >= 0) out[i].cls = c;
      }
    }
  } catch (e) { /* rossz tároló/adat -> alapértékek */ }
  return out;
}
export function saveChoicePrefs(storage, choices, cfg = CHARSELECT_CONFIG) {
  try {
    if (!storage || typeof storage.setItem !== 'function' || !Array.isArray(choices)) return false;
    storage.setItem(cfg.storageKey, JSON.stringify({ v: 1, p: choices.slice(0, 2).map(c => ({ race: c.race, cls: c.cls })) }));
    return true;
  } catch (e) { return false; }
}

// ---- Állapot ----
const mkPlayer = pref => ({ stage: 'race', race: pref.race, cls: pref.cls, dx: 0, dy: 0, t: 0, hold: false });

/** opts: {storage, cfg}. Üres faj-/kaszt-lista -> done = true, lastError (a játék induljon az alap-fajokkal). */
export function createCharSelect(reg, opts) {
  const o = isObj(opts) ? opts : {};
  const races = mapKeys(reg && reg.races), classes = mapKeys(reg && reg.classes);
  const cfg = CHARSELECT_CONFIG;
  const prefs = loadChoicePrefs(o.storage, races, classes, cfg);
  const cs = { reg, cfg, races, classes, storage: o.storage || null, players: [mkPlayer(prefs[0]), mkPlayer(prefs[1])], done: false, events: [], lastError: null };
  if (!races.length || !classes.length) { cs.done = true; cs.lastError = 'registry'; }
  return cs;
}
/** A játékos jelenlegi választása {race, cls} azonosítókkal | null. */
export function selection(cs, i) {
  const ps = cs && cs.players && cs.players[i];
  if (!ps || !cs.races.length || !cs.classes.length) return null;
  return { race: cs.races[wrap(ps.race, cs.races.length)], cls: cs.classes[wrap(ps.cls, cs.classes.length)] };
}

function navStep(ps, dir, d, cfg) {
  if (!dir.dx && !dir.dy) { ps.hold = false; ps.dx = 0; ps.dy = 0; ps.t = 0; return 0; }
  if (ps.hold) return 0;
  if (dir.dx !== ps.dx || dir.dy !== ps.dy) { ps.dx = dir.dx; ps.dy = dir.dy; ps.t = cfg.repeatDelay; return dir.dx + dir.dy; }
  ps.t -= d;
  if (ps.t <= 0) { ps.t = cfg.repeatRate; return dir.dx + dir.dy; }
  return 0;
}
function setStage(ps, stage) { ps.stage = stage; ps.hold = true; ps.dx = 0; ps.dy = 0; ps.t = 0; }

/** raws[i] = a NYERS bemenet ({x,y,interactPressed,menuPressed}); -> a kocka eseményei [{type 'stage'|'done', player, stage}]. */
export function stepCharSelect(cs, raws, dt) {
  const out = [];
  if (!cs || !Array.isArray(cs.players)) return out;
  cs.events = out;
  if (cs.done) return out;
  const d = fin(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
  for (let i = 0; i < 2; i++) {
    const ps = cs.players[i], raw = isObj(raws && raws[i]) ? raws[i] : {};
    const step = navStep(ps, menuDir(raw.x, raw.y, cs.cfg.deadzone), d, cs.cfg);
    if (ps.stage === 'race') ps.race = wrap(ps.race + step, cs.races.length);
    else if (ps.stage === 'class') ps.cls = wrap(ps.cls + step, cs.classes.length);
    if (raw.interactPressed === true && ps.stage !== 'ready') { setStage(ps, ps.stage === 'race' ? 'class' : 'ready'); out.push({ type: 'stage', player: i, stage: ps.stage }); }
    else if (raw.menuPressed === true && ps.stage !== 'race') { setStage(ps, ps.stage === 'ready' ? 'class' : 'race'); out.push({ type: 'stage', player: i, stage: ps.stage }); }
  }
  if (cs.players[0].stage === 'ready' && cs.players[1].stage === 'ready') { cs.done = true; out.push({ type: 'done', player: -1, stage: 'ready' }); }
  return out;
}
/** Kész választás ráállítása mindkét játékosra (ATOMI: ha bármelyik hibás, egyik sem változik) + mentés a storage-ba. -> bool. */
export function finishCharSelect(cs, players) {
  if (!cs || !Array.isArray(players) || players.length < 2 || !isObj(players[0]) || !isObj(players[1])) return false;
  const sel = [selection(cs, 0), selection(cs, 1)];
  if (!sel[0] || !sel[1] || !getRace(cs.reg, sel[0].race) || !getRace(cs.reg, sel[1].race) || !getClass(cs.reg, sel[0].cls) || !getClass(cs.reg, sel[1].cls)) return false;
  for (let i = 0; i < 2; i++) if (!applyCharacter(cs.reg, players[i], sel[i].race, sel[i].cls)) return false;
  saveChoicePrefs(cs.storage, cs.players.map(ps => ({ race: cs.races[wrap(ps.race, cs.races.length)], cls: cs.classes[wrap(ps.cls, cs.classes.length)] })));
  return true;
}

// ---- Nézet-modell a rajzhoz ----
const fmtPassive = (id, v) => String(Math.round(v * PASSIVE_SHOW[id]));
/** A játékos panelje: lista-sorok, a kiválasztott faj/kaszt részletei (leírás-kulcs, tényleges stat-értékek, passzívok, képességek). Sosem dob. */
export function charView(cs, i) {
  const ps = cs && cs.players && cs.players[i], sel = selection(cs, i);
  if (!ps || !sel) return null;
  const race = getRace(cs.reg, sel.race), cls = getClass(cs.reg, sel.cls);
  const name = (g, id) => { const d = g(cs.reg, id); return { id, nameKey: d ? d.nameKey : 'race.' + id }; };
  const pull = Math.max(0, passiveOf(race, 'pull_power'));
  const abilities = cls ? cls.abilities.map((id, k) => {
    const a = getAbility(cs.reg, id);
    return a ? { id, nameKey: a.nameKey, descKey: a.nameKey + '.desc', slot: k < 2 ? k + 1 : 0, resource: a.resource, cost: a.cost, cooldown: a.cooldown, tags: a.tags.slice() } : null;
  }).filter(Boolean) : [];
  return {
    index: i, stage: ps.stage, ready: ps.stage === 'ready',
    raceIndex: wrap(ps.race, cs.races.length), classIndex: wrap(ps.cls, cs.classes.length),
    races: cs.races.map(id => name(getRace, id)), classes: cs.classes.map(id => ({ id, nameKey: 'class.' + id })),
    race: race ? { id: race.id, nameKey: race.nameKey, descKey: race.nameKey + '.desc', strength: race.strength * (1 + pull), weight: race.weight, speed: race.speed, tags: race.tags.slice(),
      passives: race.passives.filter(p => Object.hasOwn(PASSIVE_SHOW, p.id)).map(p => ({ key: 'passive.' + p.id, v: fmtPassive(p.id, p.value) })) } : null,
    cls: cls ? { id: cls.id, nameKey: cls.nameKey, descKey: cls.nameKey + '.desc', resource: cls.resource, abilities } : null,
  };
}
