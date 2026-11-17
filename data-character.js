// data-character.js – fajok, kasztok, képességek (S052; adat, DOM nélkül). Validáció, nyilvántartás, audit: game-registry.js.
// S053: a három faj (törpe, tünde, ork) kész. S055: a Harcos kaszt kész (a hatásokat a game-warrior.js köti). S056: a Varázsló kész (game-wizard.js); a ranger/gyógyító S057–S058.
// Harcos-képesség TAG-ek: TÖRÉS (falbontás: a S059 akadályai ezt is elfogadják), TOLÁS (S059/S061 használhatja). Az alap-sebzés a 'strike' (3. képesség: nincs gombon, az S066 harc alap-támadása).
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
export const CLASS_DEFS = [
  { id: 'warrior', resource: 'stamina', abilities: ['wallbreak', 'shove', 'strike'], tags: ['HARCOS'] },
  { id: 'wizard', resource: 'mana', abilities: ['light', 'ignite', 'freeze'], tags: ['VARÁZSLÓ'] }, // az első kettő a 2 gomb; a freeze 3. (slot-váltás: setAbilitySlots, S062 talentfa)
];
// Varázsló (S056 kezdőérték, hangolás S188): light: power = fény-időtartam mp, range = fény-sugár tile, TAG FÉNY (S059/S121/S142 akadályok és árnyék-rejtvény);
//   ignite: power = közvetlen sebzés (+ égés-DoT: game-wizard BURN), range = a láng hossza tile, TAG ÉGETÉS (éghető akadály: bozót, S120); freeze: power = fagyás-idő mp, range tile, TAG FAGYASZTÁS (S061 fagy + vízfelszín kombó).
// Harcos (S055 kezdőérték, hangolás S188): wallbreak: power = falsebzés/használat (a fal hp-ja 3 körüli; a hatást az erő szorozza), range tile;
//   shove: power = tolás px-ben (az erő szorozza), range tile (a sáv hossza); strike: power = sebzés (az erő szorozza).
export const ABILITY_DEFS = [
  { id: 'wallbreak', resource: 'stamina', cost: 35, cooldown: 3, target: 'direction', range: 1.5, power: 2, tags: ['TÖRÉS'] },
  { id: 'shove', resource: 'stamina', cost: 20, cooldown: 2, target: 'direction', range: 2, power: 64, tags: ['TOLÁS'] },
  { id: 'strike', resource: 'stamina', cost: 12, cooldown: 0.6, target: 'enemy', range: 1.5, power: 8, tags: [] },
  { id: 'light', resource: 'mana', cost: 15, cooldown: 2, target: 'self', range: 5, power: 90, tags: ['FÉNY'] },
  { id: 'ignite', resource: 'mana', cost: 20, cooldown: 3, target: 'direction', range: 3, power: 4, tags: ['ÉGETÉS'] },
  { id: 'freeze', resource: 'mana', cost: 25, cooldown: 6, target: 'enemy', range: 5, power: 3, tags: ['FAGYASZTÁS'] },
];

// Teljes kulcsokkal (prefix nélkül regisztrálható: registerTexts(CHARACTER_TEXTS, '')).
export const CHARACTER_TEXTS = {
  hu: {
    'race.dwarf': 'Törpe', 'race.dwarf.desc': 'Alacsony, zömök, erős; sötétben is lát, gyorsabban bányászik. Lassabb és nehezebb húzni.',
    'race.elf': 'Tünde', 'race.elf.desc': 'Könnyű és fürge; az erdőben alig lassítja az aljnövényzet, gyorsabban szed gyógynövényt. Gyengébb húzó.',
    'race.orc': 'Ork', 'race.orc.desc': 'Hatalmas erő: erősebben húz és többet bír el; gyorsabban vág fát. Nehéz társ a póráz végén.',
    'class.warrior': 'Harcos', 'class.warrior.desc': 'Nyers erő: falat bont, ellenfelet tol, keményen üt. Az erő a hatását is növeli. Állóképességet használ.',
    'ability.wallbreak': 'Falbontás', 'ability.wallbreak.desc': 'Átüti a repedezett falat előtted.',
    'ability.shove': 'Tolás', 'ability.shove.desc': 'Eltol minden ellenfelet előtted.',
    'ability.strike': 'Csapás', 'ability.strike.desc': 'Alap közelharci ütés a legközelebbi ellenfélre.',
    'class.wizard': 'Varázsló', 'class.wizard.desc': 'Fényt gyújt, lángot vet, megfagyasztja az ellenfelet. Mana-t használ, ami pihenéskor visszatér.',
    'ability.light': 'Fény', 'ability.light.desc': 'Világító gömb kíséri egy ideig; sötétben látni enged.',
    'ability.ignite': 'Gyújtás', 'ability.ignite.desc': 'Lángcsóva előre: felgyújtja az éghető akadályt és megperzseli az ellenfelet.',
    'ability.freeze': 'Fagyasztás', 'ability.freeze.desc': 'Pár másodpercre jégbe zárja a legközelebbi ellenfelet.',
  },
  en: {
    'race.dwarf': 'Dwarf', 'race.dwarf.desc': 'Short, sturdy and strong; sees in the dark and mines faster. Slower, and heavier to drag.',
    'race.elf': 'Elf', 'race.elf.desc': 'Light and nimble; undergrowth barely slows them in the forest, and they gather herbs faster. A weaker puller.',
    'race.orc': 'Orc', 'race.orc.desc': 'Huge strength: pulls harder and carries more; fells trees faster. A heavy partner at the end of the tether.',
    'class.warrior': 'Warrior', 'class.warrior.desc': 'Raw strength: breaks walls, shoves enemies, hits hard. Strength boosts every effect. Uses stamina.',
    'ability.wallbreak': 'Wall Break', 'ability.wallbreak.desc': 'Smashes through the cracked wall in front of you.',
    'ability.shove': 'Shove', 'ability.shove.desc': 'Pushes every enemy in front of you back.',
    'ability.strike': 'Strike', 'ability.strike.desc': 'Basic melee hit on the nearest enemy.',
    'class.wizard': 'Wizard', 'class.wizard.desc': 'Kindles light, hurls flame, freezes foes. Uses mana, which returns with rest.',
    'ability.light': 'Light', 'ability.light.desc': 'A glowing orb follows you for a while; lets you see in the dark.',
    'ability.ignite': 'Ignite', 'ability.ignite.desc': 'A jet of flame ahead: sets flammable obstacles alight and scorches enemies.',
    'ability.freeze': 'Freeze', 'ability.freeze.desc': 'Locks the nearest enemy in ice for a few seconds.',
  },
};
