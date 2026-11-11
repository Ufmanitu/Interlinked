// Póráz-rendszer: tiszta modul (nincs DOM/canvas). A játékosok mozgását ez dönti el:
// bemenet -> kívánt sebesség -> computeTether (L_eff, k) -> tényleges sebesség -> pozíció.
// S010: k-hook (k = f(húzó ereje, húzott súlya + inventory-terhe, terep)) és opcionális húzás-stamina.
import { CAM_VIEW, CAM_CONFIG } from './game-camera.js';
import { computeTether } from './tether-logic.js';
import { desiredVelocity, applyVelocity } from './game-player.js';
import { moveWithWalls, sweepAxis } from './game-collision.js';

// k-hook tényezők (placeholder, az S011 playteszt hangolja). Egységek: 1 = átlagos erő / átlagos test.
// strengthRef: a referencia-erő; weightRef: a referencia-súly (test + teher); weightMin/Max: a súly-szorzó határai;
// exhaustedMul: kimerült húzó (húzás-stamina bekapcsolva) további lassítása.
export const K_HOOK = Object.freeze({ strengthRef: 1, weightRef: 1, weightMin: 0.25, weightMax: 4, exhaustedMul: 0.5 });
// Húzás-stamina (placeholder; az S048 általános staminája bővíti). cost/regen: egység/mp, resume: a max törtrésze,
// ami fölött a kimerült állapot megszűnik (hiszterézis).
export const PULL_STAMINA = Object.freeze({ max: 100, cost: 20, regen: 15, resume: 0.2 });

// S030: visszahúzás. Ha az L_eff összehúzódik (a falu határsávjában/azon kívül), és a táv tengelyenként nagyobb nála, a póráz
// játékosonként legfeljebb speed px/s-mal összehúzza a párt (a falakat tiszteletben tartva): falun kívül a pár egy képbe fér.
// speed 0 -> ki. minExcess: ennél kisebb túllógást (lebegőpontos zaj) nem korrigál.
export const REEL_CONFIG = Object.freeze({ speed: 90, minExcess: 0.5 });

// L: szám | {x,y} | függvény(players) -> szám|{x,y} (az S027-től a FieldSystem adja az L_eff-et).
// k: szám | {a,b} | függvény(players) -> szám|{a,b}: a BÁZIS k (TetherConfig.k); a k-hook ezt szorozza.
// terrain: szám | függvény(játékos) -> szorzó a húzó helyén (1 = normál; S120 sűrű aljnövényzet, S151 hó stb. köt ide).
// pullStamina: bool | függvény(players) -> bool (a TetherConfig kapcsolója). khook/stamina: lásd K_HOOK / PULL_STAMINA.
// walls: [{x,y,w,h}] falak (S007); üres -> nincs ütközés. Ütközés előbb, póráz utána.
// Játékos-mezők (mind opcionális): strength (alap 1), weight (alap 1), load (inventory-teher, alap 0; az S034 köti be).
export const TETHER_CONFIG = {
  walls: [],
  L: { x: CAM_VIEW.w - 2 * CAM_CONFIG.margin, y: CAM_VIEW.h - 2 * CAM_CONFIG.margin },
  k: 0.5,
  terrain: 1,
  pullStamina: false,
  khook: K_HOOK,
  stamina: PULL_STAMINA,
  reel: REEL_CONFIG,
};

const num = (v, d) => (Number.isFinite(v) ? v : d);
const clamp01 = v => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1); // mint a tether-logic: nem szám -> 1

// A húzó lassítás-szorzójának tényezője: erő · (referencia-súly / húzott súlya+terhe) · terep · (kimerültség).
export function pullFactor(puller, pulled, terrain = 1, exhausted = false, h = K_HOOK) {
  const strength = Math.max(0, num(puller.strength, 1)) / h.strengthRef;
  const mass = Math.max(0.01, Math.max(0, num(pulled.weight, 1)) + Math.max(0, num(pulled.load, 0)));
  const weightMul = Math.min(h.weightMax, Math.max(h.weightMin, h.weightRef / mass));
  return strength * weightMul * Math.max(0, num(terrain, 1)) * (exhausted ? h.exhaustedMul : 1);
}

function terrainOf(cfg, p) {
  return num(typeof cfg.terrain === 'function' ? cfg.terrain(p) : cfg.terrain, 1);
}

// k-hook: a bázis k {a,b} szorzása a tényezőkkel; kimenet {a,b} 0..1 (a: A húzásakor, b: B húzásakor).
export function applyKHook(base, players, cfg = TETHER_CONFIG, staminaOn = false) {
  const [a, b] = players;
  const h = cfg.khook || K_HOOK;
  const f = (p, q) => pullFactor(p, q, terrainOf(cfg, p), staminaOn && !!p.exhausted, h);
  return { a: clamp01(base.a * f(a, b)), b: clamp01(base.b * f(b, a)) };
}

// Stamina-mezők a játékoson (p.stamina, p.staminaMax, p.exhausted), hiányzó/rossz érték -> teli.
export function ensureStamina(p, cfg = PULL_STAMINA) {
  if (!Number.isFinite(p.staminaMax) || p.staminaMax <= 0) p.staminaMax = cfg.max;
  if (!Number.isFinite(p.stamina)) p.stamina = p.staminaMax;
  p.stamina = Math.min(p.staminaMax, Math.max(0, p.stamina));
  p.exhausted = !!p.exhausted;
}

// Egy lépés: a húzó (mode: pull-a/pull-b valamelyik tengelyen) fogyaszt, a többiek regenerálnak.
// enabled=false: nincs költség, mindenki regenerál (a kimerültség is megszűnik).
export function stepPullStamina(players, mode, dt, enabled, cfg = PULL_STAMINA) {
  players.forEach((p, i) => {
    ensureStamina(p, cfg);
    const id = i === 0 ? 'a' : 'b';
    const pulling = !!enabled && (mode.x === 'pull-' + id || mode.y === 'pull-' + id);
    if (dt > 0) p.stamina = pulling ? Math.max(0, p.stamina - cfg.cost * dt) : Math.min(p.staminaMax, p.stamina + cfg.regen * dt);
    if (pulling && p.stamina <= 0) p.exhausted = true;
    else if (p.exhausted && p.stamina >= cfg.resume * p.staminaMax) p.exhausted = false;
  });
}

const snap = p => ({ value: p.stamina, max: p.staminaMax, exhausted: p.exhausted });

export function createTetherSystem(cfg = {}) {
  const c = { ...TETHER_CONFIG, ...cfg };
  const full = () => ({ value: c.stamina.max, max: c.stamina.max, exhausted: false });
  return {
    cfg: c,
    L: { x: 0, y: 0 },                      // az utolsó lépés L_eff-je
    stretch: { x: 0, y: 0 },                // az utolsó lépés stretch-e tengelyenként
    mode: { x: 'free', y: 'free' },         // free | hold | pull-a | pull-b
    k: { a: 0, b: 0 },                      // az utolsó lépés tényleges k-ja (k-hook után; a / b húzásakor)
    stamina: { a: full(), b: full() },      // az utolsó lépés húzás-staminája játékosonként (HUD)
    blocked: { a: { x: false, y: false }, b: { x: false, y: false } }, // az utolsó lépésben a fal levágta-e a mozgást
  };
}

function resolve(v, players) {
  return typeof v === 'function' ? v(players) : v;
}

// k normalizálása {a,b}-re (a computeTether alapértéke: 1).
function normK(k) {
  if (typeof k === 'number') return { a: k, b: k };
  if (k && typeof k === 'object') return { a: k.a, b: k.b };
  return { a: 1, b: 1 };
}

export function resolveL(cfg, players) {
  const L = resolve(cfg.L, players);
  return typeof L === 'number' ? { x: L, y: L } : { x: L.x, y: L.y };
}

// Egy lépés: a két játékos mozgatása a póráz szabályai szerint.
// inputs: [P1 input, P2 input] ({x,y} -1..1). Visszatér a computeTether eredményével.
/** S030: az L_eff alá szorítja a tengelyenkénti távot (csak ha túllóg), játékosonként legfeljebb reel.speed·dt-vel; -> a mozgatott pixelek összege. */
export function reelIn(pa, pb, L, dt, walls, reel = REEL_CONFIG) {
  const sp = reel && Number.isFinite(reel.speed) ? reel.speed : 0;
  if (!(sp > 0) || !(dt > 0) || !Number.isFinite(pa.x + pa.y + pb.x + pb.y)) return 0;
  const lim = typeof L === 'number' ? { x: L, y: L } : L;
  if (!lim || !(lim.x > 0) || !(lim.y > 0)) return 0;
  const minEx = reel && Number.isFinite(reel.minExcess) ? reel.minExcess : 0.5;
  let moved = 0;
  for (const ax of ['x', 'y']) {
    const d = pb[ax] - pa[ax], excess = Math.abs(d) - lim[ax];
    if (!(excess > minEx)) continue;
    const step = Math.min(excess / 2, sp * dt), s = Math.sign(d);
    for (const [p, dir] of [[pa, s], [pb, -s]]) {
      const m = walls && walls.length ? sweepAxis(p, ax, dir * step, walls) : dir * step;
      p[ax] += m; moved += Math.abs(m);
    }
  }
  return moved;
}

export function stepTetherSystem(sys, players, inputs, dt) {
  const [pa, pb] = players;
  const L = resolveL(sys.cfg, players);
  const staminaOn = !!resolve(sys.cfg.pullStamina, players);
  ensureStamina(pa, sys.cfg.stamina); ensureStamina(pb, sys.cfg.stamina);
  const k = applyKHook(normK(resolve(sys.cfg.k, players)), players, sys.cfg, staminaOn);
  const va = desiredVelocity(pa, inputs[0] || {});
  const vb = desiredVelocity(pb, inputs[1] || {});
  const t = computeTether({ a: pa, b: pb, va, vb, L, k, dt });
  const walls = sys.cfg.walls;
  if (walls && walls.length && dt > 0) {
    const ax = pa.x, ay = pa.y, bx = pb.x, by = pb.y;
    sys.blocked = moveWithWalls(pa, pb, t.a, t.b, dt, walls, L);
    pa.vx = (pa.x - ax) / dt; pa.vy = (pa.y - ay) / dt; // tényleges sebesség
    pb.vx = (pb.x - bx) / dt; pb.vy = (pb.y - by) / dt;
  } else {
    applyVelocity(pa, t.a.x, t.a.y, dt);
    applyVelocity(pb, t.b.x, t.b.y, dt);
    sys.blocked = { a: { x: false, y: false }, b: { x: false, y: false } };
  }
  reelIn(pa, pb, L, dt, walls, sys.cfg.reel);
  stepPullStamina(players, t.mode, dt, staminaOn, sys.cfg.stamina);
  sys.L = L;
  sys.k = k;
  sys.stamina = { a: snap(pa), b: snap(pb) };
  sys.stretch = t.stretch;
  sys.mode = t.mode;
  return t;
}
