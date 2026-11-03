// world-noise.js (S013) – tiszta logika: mulberry32 RNG + value noise + fbm. Nincs DOM/canvas.

/** mulberry32: determinisztikus RNG, a visszaadott függvény [0,1) számokat ad. */
export function mulberry32(seed) {
  let a = (Number.isFinite(seed) ? seed : 0) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Egész rácspont hash-e -> u32 (a sorrendtől független, ezért chunk-biztos). */
export function hashInt(x, y, seed) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul((seed | 0) + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** Rácspont-érték 0..1. */
export function lattice(x, y, seed) {
  return hashInt(x, y, seed) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Value noise 0..1 (smoothstep-interpoláció a rácspontok között). Hibás bemenet -> 0. */
export function valueNoise(x, y, seed = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const a = lattice(x0, y0, seed), b = lattice(x0 + 1, y0, seed);
  const c = lattice(x0, y0 + 1, seed), d = lattice(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

/** Fraktál zaj (több oktáv), normalizálva 0..1-re. */
export function fbm(x, y, seed = 0, octaves = 4, lacunarity = 2, gain = 0.5) {
  const n = Math.max(1, Math.min(8, octaves | 0));
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < n; i++) {
    sum += amp * valueNoise(x * freq, y * freq, (seed + i * 101) | 0);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  const v = sum / norm;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
