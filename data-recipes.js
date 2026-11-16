// data-recipes.js – receptek (S040; adat, DOM nélkül). Validáció és logika: game-crafting.js.
// Recept: {id (kisbetű/szám/_), inputs [{item,n}] (1..6 különböző tárgy), output {item,n},
//   station (nagybetűs állomás-TAG, pl. MUNKAPAD|KEMENCE|FŐZŐHELY; null = kézzel craftolható),
//   skill (null | {skill:'azonosító', level 0..60}; a skill-rendszer S045, addig a szint 0)}.
// A recept neve = a kimeneti tárgy neve (item.<id>), ezért új felhasználói szöveg nem kell. Új recept: egyedi id + létező tárgyak.
export const RECIPE_DEFS = [
  // S040 alap-recept: kézzel craftolható (S060 a használatot köti rá; az állomások S041-ben jönnek)
  { id: 'torch',   inputs: [{ item: 'wood', n: 1 }, { item: 'fiber', n: 1 }],                       output: { item: 'torch', n: 2 },   station: null, skill: null },
  { id: 'axe',     inputs: [{ item: 'wood', n: 2 }, { item: 'stone', n: 2 }, { item: 'fiber', n: 2 }], output: { item: 'axe', n: 1 },     station: null, skill: null },
  { id: 'pickaxe', inputs: [{ item: 'wood', n: 2 }, { item: 'stone', n: 3 }, { item: 'fiber', n: 2 }], output: { item: 'pickaxe', n: 1 }, station: null, skill: null },
  { id: 'sickle',  inputs: [{ item: 'wood', n: 1 }, { item: 'stone', n: 1 }, { item: 'fiber', n: 3 }], output: { item: 'sickle', n: 1 },  station: null, skill: null },
];
