// data-combos.js – kétjátékos kombó-képességek reakció-táblája (S061; adat, DOM nélkül). A logika: game-combo.js.
// ELEM = a képesség-TAG-ből származó elem (COMBO_ELEMENTS). Egy 'cast' esemény a képesség TAG-jei szerint elem-lenyomatot hagy a cél helyén.
// Reakció (COMBO_DEFS):
//   kind 'pair':    {id, elements [a,b] (két KÜLÖNBÖZŐ elem), window (mp: ennyi időn belül kell a másodiknak jönnie), range (tile: a két célpont távolsága), cooldown (mp), effect}
//                   -> a KÉT JÁTÉKOS egy-egy képessége, tetszőleges sorrendben (azonos játékos két lenyomata nem párosít).
//   kind 'surface': {id, element, surface (COMBO_SURFACES), partnerRange (tile; 0 = nincs feltétel: a TÁRS ennyin belül legyen a célponttól), cooldown, effect}
//                   -> az egyik játékos képessége olyan felszínen, amelyen a társ is jelen van (a pár együtt dolgozik).
//   effect: {kind 'blast', at (elem: ennek a lenyomatnak a helyén), radius (tile), damage, burn {dps,secs}, ignite (bool: éghető akadályok)}
//         | {kind 'patch', surface (COMBO_PATCHES), radius (tile), secs (a folt tartama), freeze (mp: a körben álló ellenfelek fagyása)}
// Új elem: COMBO_ELEMENTS (TAG -> elem) + legalább egy képesség ezzel a TAG-gel (auditCombos jelzi, ha nincs forrás). Új reakció: egyedi id + COMBO_TEXTS HU/EN.
// A szélnek forrása a Vadőr 'gust' képessége (SZÉL-tag, 4. képesség: a gombra az S062 talentfa teszi). A víz-felszín forrása a terep (env.surface).
export const COMBO_ELEMENTS = Object.freeze({ 'ÉGETÉS': 'fire', 'FAGYASZTÁS': 'frost', 'SZÉL': 'wind' });
export const COMBO_SURFACES = Object.freeze(['water']);   // a kombó által felismert felszínek (env.surface(x,y) -> ezek egyike | null)
export const COMBO_PATCHES = Object.freeze(['ice']);      // a reakció által létrehozott foltok (iceAt: az S130 átkelők használják)

export const COMBO_DEFS = [
  // tűz + szél: a szél szétfújja a lángot -> égő terület (éghető akadályt is meggyújt)
  { id: 'firestorm', kind: 'pair', elements: ['fire', 'wind'], window: 3, range: 5, cooldown: 6,
    effect: { kind: 'blast', at: 'fire', radius: 3, damage: 6, burn: { dps: 3, secs: 4 }, ignite: true } },
  // fagy + vízfelszín: a vízben álló ellenfél jégbe fagy, a környező víz jégtáblává dermed (a társ átkelhet rajta)
  { id: 'ice_sheet', kind: 'surface', element: 'frost', surface: 'water', partnerRange: 6, cooldown: 8,
    effect: { kind: 'patch', surface: 'ice', radius: 2.5, secs: 20, freeze: 4 } },
];

export const COMBO_TEXTS = {
  hu: {
    'combo.firestorm': 'Tűzvihar', 'combo.firestorm.desc': 'Az egyik lángot vet, a másik rálő a szélre: a láng szétterül és égeti, ami a körben áll.',
    'combo.ice_sheet': 'Jégtábla', 'combo.ice_sheet.desc': 'Fagyasztás a vízben: a környező víz jéggé dermed, a vízben álló ellenfelek megfagynak. A társnak közel kell lennie.',
    'combo.toast': 'Kombó: {name}',
  },
  en: {
    'combo.firestorm': 'Firestorm', 'combo.firestorm.desc': 'One casts a flame, the other drives it with the wind: the fire spreads and burns everything around it.',
    'combo.ice_sheet': 'Ice Sheet', 'combo.ice_sheet.desc': 'Freezing in water: the water around turns to ice and enemies standing in it freeze solid. Your partner must be close.',
    'combo.toast': 'Combo: {name}',
  },
};
