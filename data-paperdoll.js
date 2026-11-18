// data-paperdoll.js (S064; adat): a rétegezett karakter (paperdoll) kinézet-adatai. Nincs külső asset: a figura kódból rajzolt (game-paperdoll.js).
// Rétegek: test/faj (bőr, testalkat, fül/agyar), haj, ruha (kaszt), fegyver (kaszt). Új faj/kaszt: ide egy bejegyzés (a rajz-kód nem változik).
// Keret: 32x40 px, a lábpont (ax, ay) alul középen; az LPC-s 64x64 keret az S101/S102-ben jön, ugyanabba a cache-be.
export const DOLL_CONFIG = Object.freeze({
  w: 32, h: 40, ax: 16, ay: 38,           // keret és lábpont
  stride: 12,                             // egy séta-képkocka hossza megtett pixelben
  minSpeed: 6,                            // px/s: ennél lassabban "áll"
  seq: Object.freeze([0, 1, 0, 2]),       // séta-ciklus: 0 = álló, 1/2 = bal/jobb lépés
  dirs: Object.freeze(['down', 'up', 'left', 'right']),
  frames: 3,
  previewTime: 0.25,                      // az előnézet képkocka-ideje (mp)
});

// Faj: testalkat (hw/hh fej, tw/th törzs, lh láb, aw kar, px), bőr, alap haj-stílus/szín, fül-típus.
export const DOLL_RACES = Object.freeze({
  dwarf: Object.freeze({ hw: 12, hh: 11, tw: 14, th: 11, lh: 7, aw: 4, skin: '#d9a066', skinDark: '#b57c45', hairStyle: 'beard', hairColor: '#a8501f', ears: 'none' }),
  elf: Object.freeze({ hw: 10, hh: 11, tw: 10, th: 12, lh: 10, aw: 3, skin: '#ecd9b2', skinDark: '#c9b388', hairStyle: 'long', hairColor: '#e8d28a', ears: 'point' }),
  orc: Object.freeze({ hw: 12, hh: 11, tw: 16, th: 13, lh: 9, aw: 5, skin: '#7ea35a', skinDark: '#5c8040', hairStyle: 'mohawk', hairColor: '#222a1c', ears: 'tusk' }),
});
export const DOLL_RACE_FALLBACK = Object.freeze({ hw: 10, hh: 11, tw: 12, th: 12, lh: 9, aw: 4, skin: '#cfa27a', skinDark: '#a98060', hairStyle: 'short', hairColor: '#4a3a2a', ears: 'none' });

// Kaszt: ruha-színek, fejdísz (helm|hat|hood|none), fegyver (sword|staff|bow|mace).
export const DOLL_CLASSES = Object.freeze({
  warrior: Object.freeze({ cloth: '#a64b3c', dark: '#7a3328', trim: '#d4b860', pants: '#4a3a2e', boots: '#2e2420', metal: '#aab4c2', head: 'helm', weapon: 'sword' }),
  wizard: Object.freeze({ cloth: '#5a4fb0', dark: '#3f3680', trim: '#e8d870', pants: '#3a3260', boots: '#241e3c', metal: '#9ad0ff', head: 'hat', weapon: 'staff' }),
  ranger: Object.freeze({ cloth: '#3f7d4a', dark: '#2c5a35', trim: '#c8a860', pants: '#5a4a32', boots: '#33261a', metal: '#8a6a3a', head: 'hood', weapon: 'bow' }),
  healer: Object.freeze({ cloth: '#d8d2c0', dark: '#b0aa98', trim: '#e04a4a', pants: '#9a8e74', boots: '#4a3e30', metal: '#f0d890', head: 'none', weapon: 'mace' }),
});
export const DOLL_CLASS_FALLBACK = Object.freeze({ cloth: '#7f8fa8', dark: '#5e6c82', trim: '#c8d0dc', pants: '#4a4f5c', boots: '#2a2e38', metal: '#aab4c2', head: 'none', weapon: 'none' });

export const DOLL_HAIR_STYLES = Object.freeze(['default', 'bald', 'short', 'long', 'beard', 'mohawk']); // 'default' = a faj alap stílusa
export const DOLL_HAIR_COLORS = Object.freeze(['#a8501f', '#e8d28a', '#222a1c', '#4a3a2a', '#d8d8d8', '#c0392b', '#2c4a8a']);
export const DOLL_COLORS = Object.freeze({ outline: '#14100c', shadow: '#00000046', eye: '#1a1410', white: '#f4f0e0', skinShade: 0 });
