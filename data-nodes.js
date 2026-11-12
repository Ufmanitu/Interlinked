// data-nodes.js – erőforrás-node-ok (S037; adat, DOM nélkül).
// Egy node = egy világ-objektum típus (world-objects.js OBJECT_DEFS) gyűjthető tulajdonságokkal:
//   hp     életerő (egész): ennyi "ütés" kell a kitermeléshez (az S038 eszköz ereje ütésenként többet vehet le)
//   time   gyűjtési idő: másodperc / ütés kézzel (az interakció gombot tartani kell; az S038 eszköz-szorzója gyorsít)
//   regrow újranövés: JÁTÉKPERC a kitermelés után (1440 = 1 játéknap)
//   heal   a részleges sérülés ennyi mp tétlenség után teljesen visszagyógyul (0 = nem gyógyul)
//   drops  drop-tábla: [{item (data-items id), min, max, chance 0..1}] – minden sor külön gurul, determinisztikusan
// Új node: ide egy sor (+ ha új objektum-típus: world-objects OBJECT_DEFS + render-objects PAINT). Az S071 szint-függő loot ezt bővíti.
export const NODE_DEFS = [
  { type: 'tree',  hp: 3, time: 0.9, regrow: 2880, heal: 20, drops: [{ item: 'wood', min: 2, max: 4, chance: 1 }, { item: 'fiber', min: 1, max: 2, chance: 0.25 }] },
  { type: 'stone', hp: 4, time: 1.1, regrow: 2160, heal: 25, drops: [{ item: 'stone', min: 2, max: 3, chance: 1 }] },
  { type: 'herb',  hp: 1, time: 0.6, regrow: 720,  heal: 5,  drops: [{ item: 'herb', min: 1, max: 2, chance: 1 }, { item: 'fiber', min: 1, max: 1, chance: 0.2 }] },
];

// A gyógynövény objektum neve és a 'gather' akció felirata (a main.js registerTexts(NODE_TEXTS) és az INTERACT_TEXT-be is köti).
export const NODE_TEXTS = {
  hu: { 'obj.herb': 'Gyógynövény', 'act.gather': 'Gyűjt' },
  en: { 'obj.herb': 'Herb', 'act.gather': 'Gather' },
};

// A herb szórása: az OBJECT_CONFIG.herbChance alapból 0 (a régi tesztek/szórás változatlan); a main.js ezzel kapcsolja be.
export const HERB_CHANCE = 0.006;
