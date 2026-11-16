// data-stations.js – craft-állomások (S041; adat, DOM nélkül). Validáció és logika: game-stations.js, rajz: render-stations.js.
// Állomás: {id (kisbetű/szám/_), tag (nagybetűs állomás-TAG: a receptek `station` mezője erre hivatkozik), item (a felállító tárgy id-ja, data-items.js),
//   collider {w,h} (a lábpont fölé nyúló talp, középen; ütköző), sprite {w,h,ax,ay} (lábpont a spriteon belül), range (px: ennyin belül "közelben" van),
//   palette [színek]}. Az állomás neve: obj.<id> (STATION_TEXTS). Új állomás: tárgy a data-items.js-ben + def ide + szövegek HU/EN + recept.
export const STATION_DEFS = [
  { id: 'workbench', tag: 'MUNKAPAD', item: 'workbench', collider: { w: 40, h: 16 }, sprite: { w: 48, h: 40, ax: 24, ay: 36 }, range: 72,
    palette: ['#5a3b22', '#7a5230', '#9a6b3c', '#b9b1a0', '#6b727c'] },
  { id: 'furnace', tag: 'KEMENCE', item: 'furnace', collider: { w: 32, h: 16 }, sprite: { w: 40, h: 48, ax: 20, ay: 44 }, range: 72,
    palette: ['#4a5059', '#6b727c', '#8d95a0', '#ff8a2a', '#ffd05a'] },
  { id: 'cookfire', tag: 'FŐZŐHELY', item: 'cookfire', collider: { w: 24, h: 12 }, sprite: { w: 32, h: 32, ax: 16, ay: 28 }, range: 72,
    palette: ['#6b727c', '#8d95a0', '#5a3b22', '#ff8a2a', '#ffd05a'] },
];

export const STATION_TEXTS = {
  hu: { 'obj.workbench': 'Munkapad', 'obj.furnace': 'Kemence', 'obj.cookfire': 'Főzőhely', 'act.use': 'Használ' },
  en: { 'obj.workbench': 'Workbench', 'obj.furnace': 'Furnace', 'obj.cookfire': 'Cooking fire', 'act.use': 'Use' },
};
