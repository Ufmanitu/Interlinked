// S079: PROCEDURÁLIS DUNGEON — a 'dungeon' instance-generátor (game-instance INSTANCE_GENERATORS). Tiszta logika, DOM/canvas nélkül.
// Szoba-alapú: a térkép gw×gh cellás rács, minden cella egy 13×9 csempés szoba-PREFAB (ADAT: DUNGEON_PREFABS, karakter-mátrix), az ELRENDEZÉS procedurális:
// növekvő fa a kezdő cellából (a térkép alsó sorában), a legmélyebb levél a FŐELLENSÉG-terem (placeholder), az oda vezető úton zárt ajtók (KULCS/AJTÓ:
// a k. kulcs mindig a k. ajtó ELŐTTI régióban van, ezért a lánc megoldható), hurkok csak azonos régión belül (nem kerülhető meg zár), elit-termek, ládák.
// Csempék: T.WALL = fal (keret), T.STONE = oszlop (ütköző), T.ROAD/T.SAND = padló. Az ajtók PADLÓN állnak (meta.doors: az S080 ajtó-alapeleme adja az ütközőt),
// így a térkép járhatósága a zárak nélkül mérhető; a zárt ajtókkal a dungeonReach/dungeonSolve számol. A meta NEM mentett (a def-ből újragenerálódik).
// Prefab-jelölők: # fal, . padló, o oszlop, e ellenség-hely, c láda-hely, x kulcs/tárgy-hely, E elit-hely, B boss-hely, S belépő (a kijárat alatta, a fal előtt).
import { createTileMap, setTile, getTile } from './world-tilemap.js';
import { T } from './world-tiles.js';
import { mulberry32 } from './world-noise.js';

export const DUNGEON_LIMITS = Object.freeze({ pw: 13, ph: 9, doorW: 3, maxRooms: 40, maxList: 64, maxTier: 9, tags: ['start', 'normal', 'boss', 'treasure', 'arena'], chars: '#.oecxEBS' });
const P = DUNGEON_LIMITS, CX = 6, CY = 4; // a prefab közepe; az ajtó-nyílás: felül/alul x 5..7, oldalt y 3..5

// ADAT: új szoba = új elem (a falnak, a 4 nyílás-sávnak és az összefüggő padlónak teljesülnie kell: validatePrefab). weight: súly a választáskor.
export const DUNGEON_PREFABS = [
  { id: 'start_hall', tags: ['start'], rows: ['#############', '#...........#', '#...........#', '#...........#', '#...........#', '#.....S.....#', '#...........#', '#...........#', '#############'] },
  { id: 'hall', tags: ['normal'], weight: 2, rows: ['#############', '#.e.......e.#', '#...........#', '#...........#', '#.....x.....#', '#...........#', '#...........#', '#.e.......e.#', '#############'] },
  { id: 'pillars', tags: ['normal'], weight: 2, rows: ['#############', '#.e.......e.#', '#..o.....o..#', '#...........#', '#.....x.....#', '#...........#', '#..o.....o..#', '#.e.......e.#', '#############'] },
  { id: 'block', tags: ['normal'], rows: ['#############', '#.e.......e.#', '#...........#', '#...........#', '#....ooo....#', '#...........#', '#...........#', '#.e.......e.#', '#############'] },
  { id: 'vault', tags: ['treasure'], rows: ['#############', '#.c.......c.#', '#...........#', '#...........#', '#.....x.....#', '#...........#', '#...........#', '#.e.......e.#', '#############'] },
  { id: 'arena', tags: ['arena'], rows: ['#############', '#...........#', '#...e...e...#', '#...........#', '#.....E.....#', '#...........#', '#...e...e...#', '#...........#', '#############'] },
  { id: 'boss_hall', tags: ['boss'], rows: ['#############', '#...........#', '#.o.......o.#', '#...........#', '#.....B.....#', '#...........#', '#.o.......o.#', '#...........#', '#############'] },
];
// ADAT: instance-id szerint, különben 'default'. [min,max] párok egész számok; chain = a legutóbbi cellából növesztés esélye (hosszabb út).
export const DUNGEON_PROFILES = {
  default: { rooms: [9, 13], loops: [0, 2], keys: [1, 2], chests: [2, 3], elites: [1, 2], spawns: [1, 3], spawnsGrow: 0.5, chain: 0.6, eliteDepth: 2, tierBase: 1, tierStep: 1, dangerBase: 0.15, dangerStep: 0.5, sandChance: 0.06 },
  dungeon_ruin: { rooms: [9, 13], loops: [1, 2], keys: [1, 2], chests: [2, 3], elites: [1, 2], spawns: [1, 3], spawnsGrow: 0.5, chain: 0.6, eliteDepth: 2, tierBase: 1, tierStep: 1, dangerBase: 0.15, dangerStep: 0.5, sandChance: 0.06 },
};
export const DUNGEON_DEFS = [{ id: 'dungeon_ruin', kind: 'dungeon', nameKey: 'instance.dungeon_ruin', generator: 'dungeon', seed: 7901, cols: 65, rows: 45 }];
export const DUNGEON_TEXTS = { hu: { 'instance.dungeon_ruin': 'Régi kripta' }, en: { 'instance.dungeon_ruin': 'Old crypt' } };

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d, a, b) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d);
const intn = (v, d, a, b) => Math.round(num(v, d, a, b));
const pair = (v, d, a, b) => { if (!Array.isArray(v) || v.length !== 2) return d; const x = intn(v[0], d[0], a, b), y = intn(v[1], d[1], a, b); return x <= y ? [x, y] : d; };
const DEF = DUNGEON_PROFILES.default;

/** Profil -> fagyasztott, szorított profil (hibás mező -> az alap profil értéke; sosem dob). */
export function sanitizeDungeonProfile(src, base = DEF) {
  const s = isObj(src) ? src : {}, b = isObj(base) ? base : DEF;
  return Object.freeze({
    rooms: pair(s.rooms, b.rooms, 3, P.maxRooms), loops: pair(s.loops, b.loops, 0, 8), keys: pair(s.keys, b.keys, 0, 6), chests: pair(s.chests, b.chests, 0, 12), elites: pair(s.elites, b.elites, 0, 8),
    spawns: pair(s.spawns, b.spawns, 0, 8), spawnsGrow: num(s.spawnsGrow, b.spawnsGrow, 0, 4), chain: num(s.chain, b.chain, 0, 1), eliteDepth: intn(s.eliteDepth, b.eliteDepth, 1, 12),
    tierBase: intn(s.tierBase, b.tierBase, 1, P.maxTier), tierStep: num(s.tierStep, b.tierStep, 0, 4), dangerBase: num(s.dangerBase, b.dangerBase, 0, 1), dangerStep: num(s.dangerStep, b.dangerStep, 0, 1), sandChance: num(s.sandChance, b.sandChance, 0, 0.5),
  });
}
export function dungeonProfileFor(def, profiles = DUNGEON_PROFILES) {
  const p = isObj(profiles) ? profiles : DUNGEON_PROFILES, id = isObj(def) ? def.id : null;
  const own = typeof id === 'string' && Object.prototype.hasOwnProperty.call(p, id) ? p[id] : null;
  return sanitizeDungeonProfile(own, sanitizeDungeonProfile(p.default, DEF));
}

const floorCh = c => c !== '#' && c !== 'o';
/** Prefab-def -> {ok, error, prefab{id,tags,weight,rows,spots{e,c,x,E,B,S},free}}: méret, jelölők, fal-keret, a 4 nyílás-sáv, összefüggő padló, jelölő-darabszám. */
export function parsePrefab(d) {
  const bad = error => ({ ok: false, error, prefab: null });
  if (!isObj(d) || typeof d.id !== 'string' || !/^[a-z][a-z0-9_]{1,31}$/.test(d.id)) return bad('id');
  if (!Array.isArray(d.tags) || !d.tags.length || d.tags.some(t => !P.tags.includes(t))) return bad('tags');
  if (d.weight !== undefined && !(typeof d.weight === 'number' && d.weight > 0 && d.weight <= 10)) return bad('weight');
  if (!Array.isArray(d.rows) || d.rows.length !== P.ph || d.rows.some(r => typeof r !== 'string' || r.length !== P.pw)) return bad('size');
  const spots = { e: [], c: [], x: [], E: [], B: [], S: [] }, free = [];
  for (let y = 0; y < P.ph; y++) for (let x = 0; x < P.pw; x++) {
    const c = d.rows[y][x];
    if (!P.chars.includes(c)) return bad('char');
    const border = x === 0 || y === 0 || x === P.pw - 1 || y === P.ph - 1;
    if (border && c !== '#') return bad('frame');
    if (spots[c]) spots[c].push([x, y]);
    if (floorCh(c) && Math.abs(x - CX) > 1 && Math.abs(y - CY) > 1) free.push([x, y]);
  }
  for (const k of [-1, 0, 1]) for (const [x, y] of [[CX + k, 1], [CX + k, P.ph - 2], [1, CY + k], [P.pw - 2, CY + k]]) if (!floorCh(d.rows[y][x])) return bad('lane');
  const seen = new Set(['6,1']), st = [[CX, 1]]; let n = 0;
  while (st.length) { const [x, y] = st.pop(); n++; for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (floorCh(d.rows[ny][nx]) && !seen.has(nx + ',' + ny)) { seen.add(nx + ',' + ny); st.push([nx, ny]); } }
  let total = 0; for (const r of d.rows) for (const c of r) if (floorCh(c)) total++;
  if (n !== total) return bad('connected');
  if (d.tags.includes('start') && spots.S.length !== 1) return bad('start');
  if (d.tags.includes('boss') && spots.B.length !== 1) return bad('boss');
  if (!d.tags.includes('start') && !d.tags.includes('boss') && !free.length) return bad('free');
  return { ok: true, error: null, prefab: Object.freeze({ id: d.id, tags: [...d.tags], weight: d.weight || 1, rows: [...d.rows], spots, free }) };
}
export function loadPrefabs(list = DUNGEON_PREFABS) {
  const out = { prefabs: [], errors: [] };
  for (const d of Array.isArray(list) ? list : []) { const r = parsePrefab(d); if (r.ok) out.prefabs.push(r.prefab); else out.errors.push((isObj(d) && d.id ? d.id : '?') + ':' + r.error); }
  return out;
}

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
/** def {id,seed,cols,rows} -> {map, entry{tx,ty}, exit{tx,ty,w,h}, meta{grid,rooms,doors,keys,chests,elites,spawns,boss,start,maxDepth}}; dob, ha a térkép < 2×2 cella vagy nincs használható prefab. */
export function generateDungeon(def, profiles = DUNGEON_PROFILES, prefabList = DUNGEON_PREFABS) {
  const { cols, rows } = def, prof = dungeonProfileFor(def, profiles), rng = mulberry32(def.seed);
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1)), rp = p => ri(p[0], p[1]), pickOf = a => a[Math.floor(rng() * a.length)];
  const gw = Math.floor(cols / P.pw), gh = Math.floor(rows / P.ph);
  if (gw < 2 || gh < 2) throw new Error('dungeon: kis térkép');
  const lib = loadPrefabs(prefabList).prefabs, tagged = t => lib.filter(p => p.tags.includes(t));
  if (!tagged('start').length || !tagged('boss').length || !tagged('normal').length) throw new Error('dungeon: hiányzó prefab');
  const x0 = (cols - gw * P.pw) >> 1, y0 = (rows - gh * P.ph) >> 1, map = createTileMap(cols, rows, T.WALL);
  // 1) elrendezés: növekvő fa a kezdő cellából (alsó sor); a cellák indexe a hozzáadás sorrendje
  const n = Math.max(3, Math.min(rp(prof.rooms), gw * gh, P.maxRooms)), cell = new Map(), list = [];
  const add = (gx, gy, parent) => { const r = { id: list.length, gx, gy, parent, depth: parent < 0 ? 0 : list[parent].depth + 1, links: [] }; cell.set(gx + ',' + gy, r); list.push(r); return r; };
  const link = (a, b, door) => { a.links.push({ to: b.id, door }); b.links.push({ to: a.id, door }); };
  add(ri(0, gw - 1), gh - 1, -1);
  while (list.length < n) {
    const cands = r => DIRS.map(([dx, dy]) => [r, r.gx + dx, r.gy + dy]).filter(([, x, y]) => x >= 0 && y >= 0 && x < gw && y < gh && !cell.has(x + ',' + y));
    let pool = rng() < prof.chain ? cands(list[list.length - 1]) : [];
    if (!pool.length) pool = list.flatMap(cands);
    if (!pool.length) break;
    const [par, x, y] = pickOf(pool), r = add(x, y, par.id); link(par, r, null);
  }
  // 2) boss = a legmélyebb levél (első a sorrendben); a start->boss út élei
  let boss = list[0]; for (const r of list) if (r.depth > boss.depth) boss = r;
  const path = []; for (let r = boss; r.parent >= 0; r = list[r.parent]) path.unshift(r);
  const m = path.length, cand = []; for (let i = m >= 2 ? 1 : 0; i < m; i++) cand.push(i);
  const nLocks = Math.min(rp(prof.keys), cand.length), lockAt = [];
  for (let j = 0; j < nLocks; j++) lockAt.push(cand[Math.round((j + 1) * cand.length / nLocks) - 1]); // az utolsó = a boss ajtaja
  // 3) régiók (a zárak nélküli fa összefüggő részei): C0 = start, C_j = a j. zár mögött
  const region = new Array(list.length).fill(-1), locked = new Set(lockAt.map(i => path[i].id));
  const spread = (seed, reg) => { const st = [seed]; region[seed] = reg; while (st.length) { const r = list[st.pop()]; for (const q of list) if (region[q.id] < 0 && !locked.has(q.id) && (q.parent === r.id)) { region[q.id] = reg; st.push(q.id); } if (r.parent >= 0 && region[r.parent] < 0 && !locked.has(r.id)) { region[r.parent] = reg; st.push(r.parent); } } };
  spread(0, 0); lockAt.forEach((i, j) => spread(path[i].id, j + 1));
  const doors = [], keys = [];
  lockAt.forEach((i, j) => { const b = path[i], a = list[b.parent], id = 'd' + (j + 1), l = a.links.find(k => k.to === b.id); l.door = id; b.links.find(k => k.to === a.id).door = id; doors.push({ id, key: 'k' + (j + 1), a: a.id, b: b.id }); });
  // 4) kulcsok: a j. kulcs a (j-1). régió legmélyebb szobájában (a startot csak végszükségben)
  for (let j = 0; j < doors.length; j++) {
    const inReg = list.filter(r => region[r.id] === j && r.id !== boss.id), noStart = inReg.filter(r => r.id !== 0);
    let best = null; for (const r of noStart.length ? noStart : inReg) if (!best || r.depth > best.depth) best = r;
    keys.push({ id: 'k' + (j + 1), door: 'd' + (j + 1), room: best.id });
  }
  // 5) hurkok: csak azonos régión belüli, még nem összekötött szomszédok (a zár nem kerülhető meg)
  const loopC = []; for (const a of list) for (const [dx, dy] of DIRS.slice(0, 2)) { const b = cell.get(a.gx + dx + ',' + (a.gy + dy)); if (b && region[a.id] === region[b.id] && !a.links.some(l => l.to === b.id)) loopC.push([a, b]); }
  for (let k = Math.min(rp(prof.loops), loopC.length); k > 0; k--) { const [a, b] = loopC.splice(Math.floor(rng() * loopC.length), 1)[0]; link(a, b, null); }
  // 6) szerepek: kulcs, elit (mélység >= eliteDepth), láda (zsákutca előnyben)
  const role = new Array(list.length).fill('normal'); role[0] = 'start'; role[boss.id] = 'boss';
  const open = list.filter(r => r.id !== 0 && r.id !== boss.id), chestRooms = [], eliteRooms = [];
  const takeN = (pool, k, out) => { for (let i = Math.min(k, pool.length); i > 0; i--) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]); };
  const dead = open.filter(r => r.links.length === 1), rest = open.filter(r => r.links.length > 1), nCh = rp(prof.chests);
  takeN(dead, nCh, chestRooms); takeN(rest, nCh - chestRooms.length, chestRooms);
  takeN(open.filter(r => r.depth >= prof.eliteDepth), rp(prof.elites), eliteRooms);
  for (const r of chestRooms) role[r.id] = 'chest'; for (const r of eliteRooms) role[r.id] = 'elite'; for (const k of keys) role[k.room] = 'key';
  // 7) prefabok (szerep szerint), rajzolás, nyílások
  const maxDepth = Math.max(1, boss.depth), place = new Map(), wsum = a => a.reduce((s, p) => s + p.weight, 0);
  const choose = tags => { let arr = []; for (const t of tags) { arr = tagged(t); if (arr.length) break; } let w = rng() * wsum(arr); for (const p of arr) { w -= p.weight; if (w < 0) return p; } return arr[arr.length - 1]; };
  for (const r of list) {
    const tags = r.id === 0 ? ['start'] : r.id === boss.id ? ['boss'] : eliteRooms.includes(r) ? ['arena', 'normal'] : chestRooms.includes(r) && !keys.some(k => k.room === r.id) ? ['treasure', 'normal'] : ['normal'];
    const pf = choose(tags), tx = x0 + r.gx * P.pw, ty = y0 + r.gy * P.ph; place.set(r.id, { pf, tx, ty });
    for (let y = 0; y < P.ph; y++) for (let x = 0; x < P.pw; x++) { const c = pf.rows[y][x]; setTile(map, tx + x, ty + y, c === '#' ? T.WALL : c === 'o' ? T.STONE : T.ROAD); }
  }
  const doorRect = (a, b, door) => { // a nyílás 3 széles x 2 mély (a két szoba fala együtt); visszaadja a téglalapot
    const A = place.get(a.id), B = place.get(b.id);
    if (a.gy === b.gy) { const lx = Math.min(A.tx, B.tx) + P.pw - 1; return { id: door, tx: lx, ty: A.ty + CY - 1, w: 2, h: P.doorW }; }
    const ly = Math.min(A.ty, B.ty) + P.ph - 1; return { id: door, tx: A.tx + CX - 1, ty: ly, w: P.doorW, h: 2 };
  };
  const edgeSeen = new Set(), doorList = [];
  for (const a of list) for (const l of a.links) {
    const k = Math.min(a.id, l.to) + ':' + Math.max(a.id, l.to); if (edgeSeen.has(k)) continue; edgeSeen.add(k);
    const rc = doorRect(a, list[l.to], l.door);
    for (let y = rc.ty; y < rc.ty + rc.h; y++) for (let x = rc.tx; x < rc.tx + rc.w; x++) setTile(map, x, y, T.ROAD);
    if (l.door) { const d = doors.find(q => q.id === l.door); doorList.push({ ...d, tx: rc.tx, ty: rc.ty, w: rc.w, h: rc.h, boss: d.b === boss.id }); }
  }
  doorList.sort((p, q) => (p.id < q.id ? -1 : 1));
  // 8) entitások a jelölő-helyekre (hiányzó jelölő -> a prefab szabad helyei); egy hely egyszer
  const usedAt = new Map(), spotOf = (r, ch) => {
    const { pf, tx, ty } = place.get(r.id), used = usedAt.get(r.id) || new Set(); usedAt.set(r.id, used);
    const pool = [...pf.spots[ch], ...pf.free].filter(([x, y]) => !used.has(x + ',' + y)); if (!pool.length) return null;
    const first = pf.spots[ch].find(([x, y]) => !used.has(x + ',' + y)), s = first || pickOf(pool); used.add(s[0] + ',' + s[1]);
    return { tx: tx + s[0], ty: ty + s[1] };
  };
  const frac = r => r.depth / maxDepth, danger = r => (r.id === boss.id ? 1 : Math.round(Math.min(1, prof.dangerBase + prof.dangerStep * frac(r)) * 1000) / 1000);
  const tier = r => Math.min(P.maxTier, prof.tierBase + Math.floor(frac(r) * prof.tierStep));
  const keyList = keys.map(k => ({ ...k, ...spotOf(list[k.room], 'x') })), chests = [], elites = [], spawns = [];
  for (const r of chestRooms) chests.push({ room: r.id, tier: tier(r), ...spotOf(r, 'c') });
  for (const r of eliteRooms) elites.push({ room: r.id, tier: tier(r), ...spotOf(r, 'E') });
  for (const r of list) if (r.id !== 0 && r.id !== boss.id) for (let k = Math.min(P.maxList, rp(prof.spawns) + Math.floor(r.depth * prof.spawnsGrow)); k > 0; k--) { const s = spotOf(r, 'e'); if (s) spawns.push({ room: r.id, ...s }); }
  const bp = place.get(boss.id), bs = spotOf(boss, 'B'), sp = place.get(0), sS = sp.pf.spots.S[0];
  const entry = { tx: sp.tx + sS[0], ty: sp.ty + sS[1] }, exit = { tx: sp.tx + sS[0] - 1, ty: sp.ty + P.ph - 2, w: 3, h: 1 };
  for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) if (getTile(map, x, y) === T.ROAD && rng() < prof.sandChance) setTile(map, x, y, T.SAND); // utolsó: nem tolja el a szerkezetet
  const rooms = list.map(r => { const p = place.get(r.id); return { id: r.id, gx: r.gx, gy: r.gy, tx: p.tx, ty: p.ty, w: P.pw, h: P.ph, prefab: p.pf.id, role: role[r.id], depth: r.depth, region: region[r.id], danger: danger(r), tier: tier(r), links: r.links.map(l => ({ to: l.to, door: l.door })) }; });
  return { map, entry, exit, meta: Object.freeze({ grid: { w: gw, h: gh, pw: P.pw, ph: P.ph, x0, y0 }, roomCount: list.length, rooms, doors: doorList, keys: keyList, chests, elites, spawns,
    boss: { room: boss.id, tx: bs.tx, ty: bs.ty, rect: { tx: bp.tx + 1, ty: bp.ty + 1, w: P.pw - 2, h: P.ph - 2 }, placeholder: true }, start: { room: 0 }, maxDepth }) };
}

/** A meta szobája a csempe szerint | null (keret / ismeretlen meta). */
export function dungeonRoomAt(meta, tx, ty) {
  if (!isObj(meta) || !Array.isArray(meta.rooms) || !Number.isInteger(tx) || !Number.isInteger(ty)) return null;
  return meta.rooms.find(r => tx >= r.tx && tx < r.tx + r.w && ty >= r.ty && ty < r.ty + r.h) || null;
}
/** Elérhető csempék a start-ból, a ZÁRT ajtók csempéi tiltva (opened = a nyitott ajtó-id-k) -> Uint8Array(cols*rows). */
export function dungeonReach(map, meta, start, opened = []) {
  const { cols, rows, tiles } = map, seen = new Uint8Array(cols * rows), block = new Uint8Array(cols * rows), ok = new Set(opened);
  for (const d of isObj(meta) && Array.isArray(meta.doors) ? meta.doors : []) if (!ok.has(d.id)) for (let y = d.ty; y < d.ty + d.h; y++) for (let x = d.tx; x < d.tx + d.w; x++) block[y * cols + x] = 1;
  const solid = i => tiles[i] === T.WALL || tiles[i] === T.STONE;
  if (!isObj(start) || !Number.isInteger(start.tx) || !Number.isInteger(start.ty) || start.tx < 0 || start.ty < 0 || start.tx >= cols || start.ty >= rows || solid(start.ty * cols + start.tx)) return seen;
  const st = [start.ty * cols + start.tx]; seen[st[0]] = 1;
  while (st.length) {
    const i = st.pop(), x = i % cols, y = (i / cols) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue; const j = ny * cols + nx; if (!seen[j] && !solid(j) && !block[j]) { seen[j] = 1; st.push(j); } }
  }
  return seen;
}
/** Zár-lánc megoldhatósága szoba-szinten: a start-ból, a kulcsok felvételével nyíló ajtókkal -> {ok, order [{key,door}], reached}. */
export function dungeonSolve(meta) {
  if (!isObj(meta) || !Array.isArray(meta.rooms) || !meta.rooms.length) return { ok: false, order: [], reached: 0 };
  const have = new Set(), opened = new Set(), reach = new Set([0]), order = [];
  for (let go = true; go;) {
    go = false;
    for (const id of [...reach]) for (const l of meta.rooms[id].links) if (!reach.has(l.to) && (!l.door || opened.has(l.door))) { reach.add(l.to); go = true; }
    for (const k of meta.keys) if (!have.has(k.id) && reach.has(k.room)) { have.add(k.id); go = true; }
    for (const d of meta.doors) if (!opened.has(d.id) && have.has(d.key) && (reach.has(d.a) || reach.has(d.b))) { opened.add(d.id); order.push({ key: d.key, door: d.id }); go = true; }
  }
  return { ok: reach.size === meta.rooms.length, order, reached: reach.size };
}
