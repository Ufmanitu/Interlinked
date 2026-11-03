// Tile-definíciók és kódból rajzolt tile-pixelek (tiszta logika, DOM-független). S012.
// A pixel-art pipeline (paletta + mátrix DSL) az S021-ben jön; ez a greybox-tileset ideiglenes, de
// már a végleges szerkezetet követi: tile-azonosító -> definíció (paletta, ütköző-e, variánsok).
export const TILE_SIZE = 32;
export const T = Object.freeze({ GRASS: 0, WATER: 1, STONE: 2, WALL: 3, ROAD: 4, SAND: 5 });

const def = (id, key, solid, variants, palette) =>
  Object.freeze({ id, key, nameKey: 'tile.' + key, solid, variants, palette: Object.freeze(palette) });

// palette[0] = alapszín, a többi a rajzoló szerint (világos, sötét, kiemelés)
export const TILE_DEFS = Object.freeze([
  def(T.GRASS, 'grass', false, 3, ['#3f7a3a', '#478a40', '#346a31', '#63a352']),
  def(T.WATER, 'water', true, 2, ['#2f5f9e', '#3d73b4', '#264f86', '#9cc8ee']),
  def(T.STONE, 'stone', true, 2, ['#7d8590', '#9aa2ac', '#5d646e', '#454b54']),
  def(T.WALL, 'wall', true, 1, ['#3a4660', '#4b5a7a', '#2a3348', '#323d55']),
  def(T.ROAD, 'road', false, 2, ['#a8895c', '#b99a6b', '#8f734c', '#d0b888']),
  def(T.SAND, 'sand', false, 2, ['#d8c690', '#e4d4a3', '#c4b078', '#b09a62']),
]);

export const TILE_COUNT = TILE_DEFS.length;

// Egész szám hash két koordinátából és egy magból (determinisztikus, 0..2^32-1).
export function hash2(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

// Ismeretlen azonosító = ütköző (biztonságos irány: nem lehet belesétálni).
export function isSolidId(id) {
  const d = TILE_DEFS[id];
  return d ? d.solid : true;
}

// Egy tile variánsa a tile-koordinátából (a rács ne látsszon egyformának).
export function tileVariant(tx, ty, id) {
  const d = TILE_DEFS[id];
  return d ? hash2(tx, ty, 977) % d.variants : 0;
}

// Rajzolók: (x, y, variáns, mag) -> paletta-index. Csak a tile saját pixele számít, így varrat nélkül csempézik.
const PAINTERS = [
  // fű: foltok + variánsonként másik fűcsomó
  (x, y, v, s) => {
    const tx = 6 + v * 9, ty = 10 + v * 7;
    if ((x === tx && y === ty) || (x === tx && y === ty - 1) || (x === tx + 1 && y === ty - 1)) return 3;
    const r = hash2(x, y, s) % 100;
    return r < 10 ? 1 : r < 18 ? 2 : 0;
  },
  // víz: 8 pixeles periódusú hullámsor (a 32-es tile-ban varratmentes), hab, sötét pöttyök
  (x, y, v, s) => {
    const wy = (y + v * 3) % 8, wx = (x + v * 6) % 16;
    if (wy === 3 && wx === 2) return 3;
    if (wy === 3 && wx < 7) return 1;
    return hash2(x, y, s) % 100 < 5 ? 2 : 0;
  },
  // kő: sötét perem, világos bal-felső és árnyékos jobb-alsó él, repedés a 2. variánsban
  (x, y, v, s) => {
    const e = Math.min(x, y, TILE_SIZE - 1 - x, TILE_SIZE - 1 - y);
    if (e === 0) return 3;
    if (e === 1) return x + y < TILE_SIZE - 1 ? 1 : 2;
    if (v === 1 && x === y && x > 8 && x < 22) return 3;
    const r = hash2(x, y, s) % 100;
    return r < 10 ? 1 : r < 18 ? 2 : 0;
  },
  // fal: téglasorok 8 pixel magasan, soronként eltolt habarcsvonal
  (x, y, v, s) => {
    const bx = (x + ((y >> 3) & 1) * 8) % 16, by = y % 8;
    if (by === 0 || bx === 0) return 2;
    if (by === 1 || bx === 1) return 1;
    return hash2(x, y, s) % 100 < 10 ? 3 : 0;
  },
  // út: tömör föld, kavicsok
  (x, y, v, s) => {
    const r = hash2(x, y, s) % 100;
    return r >= 97 ? 3 : r < 8 ? 1 : r < 14 ? 2 : 0;
  },
  // homok: finom szemcsék
  (x, y, v, s) => {
    const r = hash2(x, y, s) % 100;
    return r === 99 ? 3 : r < 10 ? 1 : r < 16 ? 2 : 0;
  },
];

// Egy tile pixelei paletta-indexekkel (TILE_SIZE*TILE_SIZE, sor-folytonos). Ismeretlen id -> null.
export function paintTile(id, variant = 0) {
  const d = TILE_DEFS[id];
  if (!d) return null;
  let v = Number.isFinite(variant) ? Math.floor(variant) : 0;
  v = ((v % d.variants) + d.variants) % d.variants;
  const seed = id * 131 + v * 17 + 1;
  const paint = PAINTERS[id];
  const px = new Uint8Array(TILE_SIZE * TILE_SIZE);
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) px[y * TILE_SIZE + x] = paint(x, y, v, seed);
  }
  return px;
}
