// Makrótérkép (S020; adat). Kézzel tervezett régiók, útvonalak, POI-k, bejáratok.
// Koordináták: világ-TILE (nem pixel). A rect fél-nyitott: tx0 <= tx < tx1.
// Új elem: egyedi id + nameKey (MACRO_TEXTS, HU+EN). Az érvényesítés a world-macro.js-ben van.
export const MACRO_VERSION = 1;

export const MACRO_MAP = {
  v: MACRO_VERSION,
  // Régión kívüli (vadon) mikroréteg-sűrűség.
  fallbackMicro: { tree: 0.012, stone: 0.004 },
  regions: [
    {
      id: 'meadow', nameKey: 'macro.region.meadow', tier: 1, levels: [1, 10],
      rect: { tx0: -96, ty0: -96, tx1: 96, ty1: 96 },
      micro: { tree: 0.012, bush: 0.01, stone: 0.004 },
    },
    {
      id: 'forest', nameKey: 'macro.region.forest', tier: 2, levels: [10, 20],
      rect: { tx0: 96, ty0: -96, tx1: 224, ty1: 96 },
      micro: { tree: 0.05, bush: 0.03, stone: 0.004 },
      gate: { soft: 'danger', hard: 'quest.act1' },
    },
  ],
  // width: páratlan tile-szélesség (1, 3, 5, 7); a pontok a tile-ok közepén mennek.
  routes: [
    {
      id: 'village_road', nameKey: 'macro.route.village_road', width: 3,
      points: [{ tx: 0, ty: 4 }, { tx: 40, ty: 10 }, { tx: 90, ty: 12 }],
    },
    {
      id: 'forest_path', nameKey: 'macro.route.forest_path', width: 1,
      points: [{ tx: 90, ty: 12 }, { tx: 130, ty: 20 }, { tx: 180, ty: 8 }],
    },
  ],
  // clear: a sugáron belül nincs akadály (víz/kő -> fű) és nincs mikroréteg-objektum.
  pois: [
    { id: 'village', type: 'village', nameKey: 'macro.poi.village', tx: 0, ty: 0, r: 12, clear: true },
    { id: 'old_well', type: 'landmark', nameKey: 'macro.poi.old_well', tx: 60, ty: -30, r: 3, clear: true },
  ],
  // tx,ty = bal-felső tile; w,h tile; target = a későbbi instance azonosítója (S076).
  entrances: [
    { id: 'meadow_mine', kind: 'mine', nameKey: 'macro.entrance.meadow_mine', tx: -60, ty: -40, w: 3, h: 2, target: 'mine_meadow' },
  ],
};

export const MACRO_TEXTS = {
  hu: {
    'macro.region.meadow': 'Rét',
    'macro.region.forest': 'Erdő',
    'macro.route.village_road': 'Falusi út',
    'macro.route.forest_path': 'Erdei ösvény',
    'macro.poi.village': 'Falu',
    'macro.poi.old_well': 'Öreg kút',
    'macro.entrance.meadow_mine': 'Réti bánya',
  },
  en: {
    'macro.region.meadow': 'Meadow',
    'macro.region.forest': 'Forest',
    'macro.route.village_road': 'Village road',
    'macro.route.forest_path': 'Forest path',
    'macro.poi.village': 'Village',
    'macro.poi.old_well': 'Old well',
    'macro.entrance.meadow_mine': 'Meadow mine',
  },
};
