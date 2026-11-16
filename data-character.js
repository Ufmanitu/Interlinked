// data-character.js – fajok, kasztok, képességek (S052; adat, DOM nélkül). Validáció, nyilvántartás, audit: game-registry.js.
// S053: a három faj (törpe, tünde, ork) kész; a kasztok és képességeik az S055–S058-ban jönnek (addig üresek, a tesztek saját mintaadatot használnak).
// Passzív-azonosítók (a hatásukat a game-race.js köti): darkvision (tile-sugár, S104/S121/S142 fény), miner_speed/herb_speed/wood_speed (gyűjtés-sebesség +érték),
//   forest_move (0..1: a terep-lassulás ennyi része megszűnik erdei terepen, S120), pull_power (az erő szorzója: strength·(1+érték), a húzás ereje a k-hookban + a teher-kapacitás).
//
// Képesség (ABILITY_DEFS): {id (kisbetű/szám/_), resource null|'mana'|'stamina'|'focus', cost (>= 0; > 0 -> resource kell), cooldown (mp, >= 0),
//   target 'none'|'self'|'ally'|'enemy'|'area'|'direction', range (tile, 0..64), power (sebzés/gyógyítás/hatás-erő, >= 0),
//   tags [nagybetűs képesség-TAG, pl. 'FÉNY','ÉGETÉS','ROBBANTÁS': az akadályok (S059) ezekre hivatkoznak], item (opcionális: a használathoz kellő tárgy id-ja)}.
// Faj (RACE_DEFS): {id, strength (0.25..4, alap 1: a húzás-erő és a teher-kapacitás), weight (0.25..4, alap 1: a testsúly a k-hookban), speed (0.5..2, alap 1),
//   tags [passzív TAG-ek, pl. 'SÖTÉTLÁTÁS'], passives [{id, value}] (a hatásukat az S053 köti), startItems [{item,n}]}.
// Kaszt (CLASS_DEFS): {id, resource null|'mana'|'stamina'|'focus', abilities [képesség-id, max 8; az első kettő a 2 aktív gomb], tags [kaszt-TAG-ek], startItems [{item,n}]}.
// A nevek kulcsa: 'race.<id>', 'class.<id>', 'ability.<id>' (CHARACTER_TEXTS; HU és EN együtt). Új elem: egyedi id + szöveg HU/EN + a hivatkozott tárgyak/képességek léteznek.
// Egy kombináció sem lehet zsákutca: a kaszt kényelem, nem kapu (GDD 6); az akadályokhoz mindig van tárgy-alapú (craftolható) megoldás is.
export const RACE_DEFS = [
  { id: 'dwarf', strength: 1.1, weight: 1.2, speed: 0.92, tags: ['SÖTÉTLÁTÁS'], passives: [{ id: 'darkvision', value: 5 }, { id: 'miner_speed', value: 0.2 }] },
  { id: 'elf', strength: 0.85, weight: 0.8, speed: 1.08, tags: ['ERDEIMOZGÁS'], passives: [{ id: 'forest_move', value: 0.6 }, { id: 'herb_speed', value: 0.25 }] },
  { id: 'orc', strength: 1.35, weight: 1.3, speed: 0.96, tags: ['ERŐHÚZÁS'], passives: [{ id: 'pull_power', value: 0.2 }, { id: 'wood_speed', value: 0.15 }] },
];
export const CLASS_DEFS = [];
export const ABILITY_DEFS = [];

// Teljes kulcsokkal (prefix nélkül regisztrálható: registerTexts(CHARACTER_TEXTS, '')).
export const CHARACTER_TEXTS = {
  hu: {
    'race.dwarf': 'Törpe', 'race.dwarf.desc': 'Alacsony, zömök, erős; sötétben is lát, gyorsabban bányászik. Lassabb és nehezebb húzni.',
    'race.elf': 'Tünde', 'race.elf.desc': 'Könnyű és fürge; az erdőben alig lassítja az aljnövényzet, gyorsabban szed gyógynövényt. Gyengébb húzó.',
    'race.orc': 'Ork', 'race.orc.desc': 'Hatalmas erő: erősebben húz és többet bír el; gyorsabban vág fát. Nehéz társ a póráz végén.',
  },
  en: {
    'race.dwarf': 'Dwarf', 'race.dwarf.desc': 'Short, sturdy and strong; sees in the dark and mines faster. Slower, and heavier to drag.',
    'race.elf': 'Elf', 'race.elf.desc': 'Light and nimble; undergrowth barely slows them in the forest, and they gather herbs faster. A weaker puller.',
    'race.orc': 'Orc', 'race.orc.desc': 'Huge strength: pulls harder and carries more; fells trees faster. A heavy partner at the end of the tether.',
  },
};
