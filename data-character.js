// data-character.js – fajok, kasztok, képességek (S052; adat, DOM nélkül). Validáció, nyilvántartás, audit: game-registry.js.
// A listák az S052-ben még ÜRESEK: a fajok az S053-ban, a kasztok és képességeik az S055–S058-ban jönnek (a regiszter addig is fut, a tesztek saját mintaadatot használnak).
//
// Képesség (ABILITY_DEFS): {id (kisbetű/szám/_), resource null|'mana'|'stamina'|'focus', cost (>= 0; > 0 -> resource kell), cooldown (mp, >= 0),
//   target 'none'|'self'|'ally'|'enemy'|'area'|'direction', range (tile, 0..64), power (sebzés/gyógyítás/hatás-erő, >= 0),
//   tags [nagybetűs képesség-TAG, pl. 'FÉNY','ÉGETÉS','ROBBANTÁS': az akadályok (S059) ezekre hivatkoznak], item (opcionális: a használathoz kellő tárgy id-ja)}.
// Faj (RACE_DEFS): {id, strength (0.25..4, alap 1: a húzás-erő és a teher-kapacitás), weight (0.25..4, alap 1: a testsúly a k-hookban), speed (0.5..2, alap 1),
//   tags [passzív TAG-ek, pl. 'SÖTÉTLÁTÁS'], passives [{id, value}] (a hatásukat az S053 köti), startItems [{item,n}]}.
// Kaszt (CLASS_DEFS): {id, resource null|'mana'|'stamina'|'focus', abilities [képesség-id, max 8; az első kettő a 2 aktív gomb], tags [kaszt-TAG-ek], startItems [{item,n}]}.
// A nevek kulcsa: 'race.<id>', 'class.<id>', 'ability.<id>' (CHARACTER_TEXTS; HU és EN együtt). Új elem: egyedi id + szöveg HU/EN + a hivatkozott tárgyak/képességek léteznek.
// Egy kombináció sem lehet zsákutca: a kaszt kényelem, nem kapu (GDD 6); az akadályokhoz mindig van tárgy-alapú (craftolható) megoldás is.
export const RACE_DEFS = [];
export const CLASS_DEFS = [];
export const ABILITY_DEFS = [];

// Teljes kulcsokkal (prefix nélkül regisztrálható: registerTexts(CHARACTER_TEXTS, '')).
export const CHARACTER_TEXTS = {
  hu: {},
  en: {},
};
