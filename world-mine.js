// S077: PROCEDURÁLIS BÁNYA — az 'mine' instance-generátor (game-instance INSTANCE_GENERATORS). Tiszta logika, DOM/canvas nélkül.
// Egy bánya = EGY csempe-térkép, vízszintes sávokba (RÉTEGEK) rakva egymás alá; a rétegeket függőleges akna köti össze (2 tile vastag kő-osztón át).
// A mélységgel nő: az érc-tier (tierBase + floor(réteg·tierStep)), a veszély (dangerBase + dangerStep·réteg), az érc- és ellenség-pontok száma;
// a sötétség a darkFrom. rétegtől. Minden paraméter ADAT (MINE_PROFILES: instance-id szerint, különben 'default'); fix seed -> azonos bánya.
// Csempék: T.WALL = alapkő (keret, NEM ásható), T.STONE = ásható kő (az S078 ásása ezt bontja), T.ROAD/T.SAND = járat. A fal-lista a game-instance-é (mapToWalls).
// A generátor a {map, entry, exit} mellett `meta`-t ad (a game-instance a világba másolja: instanceWorld(mgr).meta): rétegenként tier, veszély, sötét,
// érc-pontok (kő-csempe a járat mellett: ásás után kapható), ellenség-pontok (járat-csempék). A konkrét tárgy/ellenség típusa az S078/S143 dolga.
import { createTileMap, setTile, getTile } from './world-tilemap.js';
import { T } from './world-tiles.js';
import { mulberry32 } from './world-noise.js';

export const MINE_LIMITS = Object.freeze({ maxLayers: 8, minLayerRows: 9, minW: 2, maxW: 5, maxTier: 9, maxList: 64, sandChance: 0.12, spawnMinDist: 8, entryRows: 7 });
export const MINE_ORE_KINDS = Object.freeze(['copper', 'coal', 'iron', 'silver', 'gem']); // tier -> érc-fajta (tájékoztató; az S078/S139 köti a tárgyakhoz), 5 fölött az utolsó

// ADAT: [min,max] párok egész számok. Új bánya: INSTANCE_DEFS (generator 'mine', depth = rétegek száma) + opcionálisan profil az id alatt.
export const MINE_PROFILES = {
  default: { layers: 3, tunnelW: 3, bends: [1, 2], branches: [2, 4], branchLen: [4, 9], chambers: [1, 2], ores: [4, 6], oresGrow: 1, spawns: [3, 5], spawnsGrow: 1, tierBase: 1, tierStep: 1, dangerBase: 0.15, dangerStep: 0.25, darkFrom: 1 },
  mine_meadow: { layers: 3, tunnelW: 3, bends: [1, 2], branches: [2, 3], branchLen: [4, 8], chambers: [1, 2], ores: [4, 6], oresGrow: 1, spawns: [2, 4], spawnsGrow: 1, tierBase: 1, tierStep: 0.5, dangerBase: 0.1, dangerStep: 0.2, darkFrom: 1 },
};

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d, a, b) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d);
const intn = (v, d, a, b) => Math.round(num(v, d, a, b));
const pair = (v, d, a, b) => {
  if (!Array.isArray(v) || v.length !== 2) return d;
  const x = intn(v[0], d[0], a, b), y = intn(v[1], d[1], a, b);
  return x <= y ? [x, y] : d;
};
const DEF = MINE_PROFILES.default;

/** Profil -> fagyasztott, szorított profil (hibás mező -> az alap profil értéke; sosem dob). */
export function sanitizeMineProfile(src, base = DEF) {
  const s = isObj(src) ? src : {}, b = isObj(base) ? base : DEF, L = MINE_LIMITS;
  return Object.freeze({
    layers: intn(s.layers, b.layers, 1, L.maxLayers), tunnelW: intn(s.tunnelW, b.tunnelW, L.minW, L.maxW),
    bends: pair(s.bends, b.bends, 0, 4), branches: pair(s.branches, b.branches, 0, 12), branchLen: pair(s.branchLen, b.branchLen, 1, 30), chambers: pair(s.chambers, b.chambers, 0, 6),
    ores: pair(s.ores, b.ores, 0, L.maxList), oresGrow: intn(s.oresGrow, b.oresGrow, 0, 16), spawns: pair(s.spawns, b.spawns, 0, L.maxList), spawnsGrow: intn(s.spawnsGrow, b.spawnsGrow, 0, 16),
    tierBase: intn(s.tierBase, b.tierBase, 1, L.maxTier), tierStep: num(s.tierStep, b.tierStep, 0, 4), dangerBase: num(s.dangerBase, b.dangerBase, 0, 1), dangerStep: num(s.dangerStep, b.dangerStep, 0, 1), darkFrom: intn(s.darkFrom, b.darkFrom, 0, L.maxLayers),
  });
}
export function mineProfileFor(def, profiles = MINE_PROFILES) {
  const p = isObj(profiles) ? profiles : MINE_PROFILES, id = isObj(def) ? def.id : null;
  const own = typeof id === 'string' && Object.prototype.hasOwnProperty.call(p, id) ? p[id] : null;
  return sanitizeMineProfile(own, sanitizeMineProfile(p.default, DEF));
}
export const oreKind = tier => MINE_ORE_KINDS[Math.max(1, Math.min(MINE_ORE_KINDS.length, tier | 0)) - 1];

const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];

/** def {id,seed,cols,rows,depth (rétegek száma; 0 = profil)} -> {map, entry{tx,ty}, exit{tx,ty,w,h}, meta{layerCount,tunnelW,layers[],bottom}} */
export function generateMine(def, profiles = MINE_PROFILES) {
  const { cols, rows } = def, prof = mineProfileFor(def, profiles), rng = mulberry32(def.seed), M = MINE_LIMITS;
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1)), rp = p => ri(p[0], p[1]);
  const map = createTileMap(cols, rows, T.STONE);
  for (let x = 0; x < cols; x++) { setTile(map, x, 0, T.WALL); setTile(map, x, rows - 1, T.WALL); }
  for (let y = 0; y < rows; y++) { setTile(map, 0, y, T.WALL); setTile(map, cols - 1, y, T.WALL); }
  const w = prof.tunnelW, lo = (w - 1) >> 1, hi = w - 1 - lo, bx0 = 2 + lo, bx1 = cols - 3 - hi;
  const L = Math.max(1, Math.min(def.depth > 0 ? def.depth : prof.layers, M.maxLayers, Math.floor((rows - 2) / M.minLayerRows)));
  const bh = Math.floor((rows - 2) / L), cx = cols >> 1;
  const bands = [];
  for (let i = 0; i < L; i++) {
    const r0 = 1 + i * bh, r1 = i === L - 1 ? rows - 1 : r0 + bh, bot = r1 - 2 - (i < L - 1 ? 2 : 0), top = r0 + 1;
    bands.push({ i, r0, r1, top, bot, ymin: top + lo, ymax: bot - hi });
  }
  const cxs = x => Math.max(bx0, Math.min(bx1, x)), cys = (b, y) => Math.max(b.ymin, Math.min(b.ymax, y));
  const carve = (x, y) => { for (let dy = -lo; dy <= hi; dy++) for (let dx = -lo; dx <= hi; dx++) setTile(map, x + dx, y + dy, T.ROAD); };
  const rect = (b, x0, y0, x1, y1) => { // téglalap-terem a járat-sáv határaira vágva
    for (let y = Math.max(b.top, y0); y <= Math.min(b.bot, y1); y++) for (let x = Math.max(2, x0); x <= Math.min(cols - 3, x1); x++) setTile(map, x, y, T.ROAD);
  };
  for (let y = 1; y <= 6; y++) for (let x = cx - 3; x <= cx + 3; x++) setTile(map, x, y, T.ROAD); // belépő terem
  const entry = { tx: cx, ty: 4 }, exit = { tx: cx - 1, ty: 1, w: 3, h: 1 };
  const starts = [], descents = [];
  let sx = cxs(cx), sy = cys(bands[0], 5), bottom = null;
  for (const b of bands) {
    const last = b.i === L - 1, trail = [];
    starts.push({ tx: sx, ty: sy });
    const dot = (x, y) => { carve(x, y); trail.push([x, y]); };
    const walk = (x, y, x1, y1) => {
      const hFirst = rng() < 0.5;
      const mx = () => { while (x !== x1) { x += x < x1 ? 1 : -1; dot(x, y); } }, my = () => { while (y !== y1) { y += y < y1 ? 1 : -1; dot(x, y); } };
      if (hFirst) { mx(); my(); } else { my(); mx(); }
    };
    dot(sx, sy);
    const pts = [[sx, sy]];
    for (let k = rp(prof.bends); k > 0; k--) pts.push([ri(bx0, bx1), ri(b.ymin, b.ymax)]);
    const dx = ri(bx0, bx1), end = last ? [ri(bx0, bx1), ri(b.ymin, b.ymax)] : [dx, b.ymax];
    pts.push(end);
    for (let k = 1; k < pts.length; k++) walk(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
    for (let n = rp(prof.branches); n > 0; n--) { // zsákutcás mellékjáratok
      let [x, y] = trail[Math.floor(rng() * trail.length)]; const d = ri(0, 3), len = rp(prof.branchLen);
      for (let s = 0; s < len; s++) { x = cxs(x + DX[d]); y = cys(b, y + DY[d]); carve(x, y); }
    }
    for (let n = rp(prof.chambers); n > 0; n--) { // termek a főjárat mentén
      const [x, y] = trail[Math.floor(rng() * trail.length)], cw = 5 + 2 * ri(0, 1), ch = 4 + ri(0, 1);
      rect(b, x - (cw >> 1), y - (ch >> 1), x + (cw >> 1), y + (ch >> 1));
    }
    if (last) { rect(b, end[0] - 4, end[1] - 2, end[0] + 4, end[1] + 2); bottom = { tx: end[0], ty: end[1] }; descents.push(null); continue; }
    const nb = bands[b.i + 1]; descents.push({ tx: dx, ty: b.ymax });
    for (let y = b.ymax; y <= nb.ymin; y++) carve(dx, y); // akna a következő rétegbe
    sx = dx; sy = nb.ymin;
  }
  const isFloor = (x, y) => getTile(map, x, y) === T.ROAD;
  const layers = bands.map(b => {
    const ore = [], spawn = [], tier = Math.min(M.maxTier, prof.tierBase + Math.floor(b.i * prof.tierStep)), st = starts[b.i];
    const oc = [], sc = [];
    for (let y = b.r0; y < b.r1; y++) for (let x = 1; x < cols - 1; x++) {
      if (b.i === 0 && y <= M.entryRows) continue; // a belépő terem környéke szabad
      if (getTile(map, x, y) === T.STONE && (isFloor(x + 1, y) || isFloor(x - 1, y) || isFloor(x, y + 1) || isFloor(x, y - 1))) oc.push([x, y]);
      else if (isFloor(x, y) && Math.abs(x - st.tx) + Math.abs(y - st.ty) >= M.spawnMinDist) sc.push([x, y]);
    }
    const pick = (c, n, out) => { for (let k = 0; k < n && c.length; k++) { const j = Math.floor(rng() * c.length), v = c[j]; c[j] = c[c.length - 1]; c.pop(); out.push(v); } };
    pick(oc, Math.min(M.maxList, rp(prof.ores) + prof.oresGrow * b.i), ore); pick(sc, Math.min(M.maxList, rp(prof.spawns) + prof.spawnsGrow * b.i), spawn);
    const srt = (a, c) => a[1] - c[1] || a[0] - c[0];
    return { index: b.i, depth: b.i + 1, y0: b.r0, y1: b.r1, start: st, descent: descents[b.i], tier, kind: oreKind(tier),
      danger: Math.round(Math.min(1, prof.dangerBase + prof.dangerStep * b.i) * 1000) / 1000, dark: b.i >= prof.darkFrom,
      ores: ore.sort(srt).map(([tx, ty]) => ({ tx, ty, tier, kind: oreKind(tier) })), spawns: spawn.sort(srt).map(([tx, ty]) => ({ tx, ty })) };
  });
  for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) if (isFloor(x, y) && rng() < M.sandChance) setTile(map, x, y, T.SAND); // utolsó: nem tolja el a szerkezetet
  return { map, entry, exit, meta: Object.freeze({ layerCount: L, tunnelW: w, layers, bottom }) };
}

/** A meta rétege a csempe-sor (ty) szerint | null (keret / ismeretlen meta). */
export function mineLayerAt(meta, ty) {
  if (!isObj(meta) || !Array.isArray(meta.layers) || !Number.isInteger(ty)) return null;
  return meta.layers.find(l => ty >= l.y0 && ty < l.y1) || null;
}
