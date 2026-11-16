// game-race.js – fajok hatása (S053; tiszta logika, DOM nélkül; importja: game-player). A faj ADATA a data-character.js-ben van (RACE_DEFS), az ellenőrzés a game-registry.js-ben.
// Itt a faj a játékos-entitásra és a rendszerek hook-jaira kötődik: stat-módosítók (strength/weight -> a póráz k-hookja és a teher-kapacitás, speed -> mozgás),
// passzívok (sötétlátás, erdei mozgás, gyűjtés-sebesség, erő-húzás). A reg = createCharacterRegistry(...) eredménye. Minden függvény sosem dob; hibás bemenetnél semleges alapérték.
import { PLAYER_SPEED } from './game-player.js';

export const RACE_CONFIG = Object.freeze({
  forestKinds: Object.freeze(['forest', 'undergrowth']), // a terep-fajták, amelyeken a forest_move hat
  nodePassives: Object.freeze({ tree: 'wood_speed', stone: 'miner_speed', herb: 'herb_speed' }), // node-típus -> gyűjtés-sebesség passzív
});

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const raceMap = reg => (reg && reg.races && typeof reg.races.get === 'function' ? reg.races : null);

// A játékos faja (def) | null.
export function raceOf(reg, p) {
  const m = raceMap(reg);
  return m && p && typeof p.race === 'string' ? m.get(p.race) || null : null;
}
// Egy passzív értéke (alap 0): passiveOf(race, 'darkvision').
export function passiveOf(race, id, dflt = 0) {
  if (!race || !Array.isArray(race.passives)) return dflt;
  for (const x of race.passives) if (x && x.id === id) return num(x.value, dflt);
  return dflt;
}
export const hasRaceTag = (reg, p, tag) => { const r = raceOf(reg, p); return !!r && r.tags.includes(tag); };

// Faj ráállítása a játékosra (ATOMI: ismeretlen faj -> false, a játékos érintetlen).
// strength = faj.strength · (1 + pull_power) (a k-hook pullFactor-a és az encumbrance kapacitása ezt olvassa), weight = faj.weight, speed = PLAYER_SPEED · faj.speed.
export function applyRace(reg, p, raceId) {
  const m = raceMap(reg);
  if (!m || !p || typeof p !== 'object' || typeof raceId !== 'string') return false;
  const r = m.get(raceId);
  if (!r) return false;
  p.race = r.id;
  p.strength = r.strength * (1 + Math.max(0, passiveOf(r, 'pull_power')));
  p.weight = r.weight;
  p.speed = PLAYER_SPEED * r.speed;
  return true;
}
// Faj nélküli (átlagos) állapot: strength/weight 1, alap sebesség.
export function clearRace(p) {
  if (!p || typeof p !== 'object') return false;
  delete p.race; p.strength = 1; p.weight = 1; p.speed = PLAYER_SPEED;
  return true;
}

// Sötétlátás sugara tile-ban (0 = nincs): a fény-térkép (S104), az erdei árnyék (S121) és a sötét mélység (S142) olvassa.
export const darkvisionTiles = (reg, p) => Math.max(0, passiveOf(raceOf(reg, p), 'darkvision'));

// Gyűjtés-sebesség szorzó a node-típusra (alap 1): a main.js a node-rendszer hooks.speed-jébe szorozza.
export function gatherSpeedMul(reg, p, nodeType) {
  const id = typeof nodeType === 'string' && Object.hasOwn(RACE_CONFIG.nodePassives, nodeType) ? RACE_CONFIG.nodePassives[nodeType] : null;
  return id ? Math.max(0.05, 1 + passiveOf(raceOf(reg, p), id)) : 1;
}

// Terep-szorzó a faj szerint: a base(p) szám | {mul, kind} (alap 1); erdei terepen (forestKinds) a forest_move a lassulás ennyi részét megszünteti.
// A tether cfg.terrain-je ezt kapja: sysCfg.terrain = raceTerrain(reg[, base]) (a húzó helyén számol; S120/S151 adja a terep-fajtát).
export function terrainMulFor(reg, p, base) {
  let b = 1, kind = null;
  try { const v = typeof base === 'function' ? base(p) : base; if (v && typeof v === 'object') { b = num(v.mul, 1); kind = typeof v.kind === 'string' ? v.kind : null; } else b = num(v, 1); } catch (e) { b = 1; }
  b = Math.max(0, b);
  if (b < 1 && kind !== null && RACE_CONFIG.forestKinds.includes(kind)) {
    const f = Math.min(1, Math.max(0, passiveOf(raceOf(reg, p), 'forest_move')));
    b = b + (1 - b) * f;
  }
  return b;
}
export const raceTerrain = (reg, base = 1) => p => terrainMulFor(reg, p, base);

// A választó UI-nak (S063): {id, nameKey, descKey, strength, weight, speed, tags, passives[{id,value}]} | null.
export function raceView(reg, p) {
  const r = raceOf(reg, p);
  return r ? { id: r.id, nameKey: r.nameKey, descKey: r.nameKey + '.desc', strength: p.strength, weight: p.weight, speed: p.speed, tags: r.tags.slice(), passives: r.passives.map(x => ({ id: x.id, value: x.value })) } : null;
}
