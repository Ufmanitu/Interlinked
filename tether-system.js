// Póráz-rendszer: tiszta modul (nincs DOM/canvas). A játékosok mozgását ez dönti el:
// bemenet -> kívánt sebesség -> computeTether (L_eff, k) -> tényleges sebesség -> pozíció.
// S010: k-hook (k = f(húzó ereje, húzott súlya + inventory-terhe, terep)) és opcionális húzás-stamina.
import { CAM_VIEW, CAM_CONFIG } from './game-camera.js';
import { computeTether } from './tether-logic.js';
import { desiredVelocity, applyVelocity } from './game-player.js';
import { moveWithWalls, sweepAxis } from './game-collision.js';
import { ensureStamina, stepStamina, canSprint, wantsSprint, STAMINA_ACT } from './game-stamina.js'; // S048: a stamina egyetlen helyen lép (húzás + sprint + gyűjtés)
export { ensureStamina };

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

// S073: harc és póráz. A visszalökés (p.kbx/p.kby, game-combat) NEM szándék: a bemeneti mozgás UTÁN, külön lépésben (második computeTether)
// mozog, a társ pozíciója nulla kívánt sebességgel. Így (1) a feszes póráz visszatartja a kilökött/menekülő játékost, a társat pedig viszi
// (húzás-szorzó = drag · tömeg-arány, a nehezebb társ jobban fékez), (2) a visszalökés sosem költ húzás-staminát, (3) a távolság sosem lépi túl
// az L_eff-et (a lépésen belül sem): az ellenség nem "vágja el" a pórázt. drag 0 = a társ nem mozdul, a kilökött megáll a korlátnál.
// cfg.knock = false/null -> régi viselkedés (a visszalökés a kívánt sebességhez adódik). minSpeed: ennél kisebb visszalökést (px/s) nem lépünk.
export const KNOCK_CONFIG = Object.freeze({ drag: 0.7, massMin: 0.25, massMax: 4, minSpeed: 1 });

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
  act: STAMINA_ACT, // S048: sprint/gyűjtés költség, sprint-szorzó, munka-lassulás (hangolás: S188)
  reel: REEL_CONFIG,
  knock: KNOCK_CONFIG, // S073
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

// S073: a tömeg (test + teher), a visszalökés húzás-szorzója és a játékos visszalökés-sebessége.
const massOf = p => Math.max(0.01, Math.max(0, num(p.weight, 1)) + Math.max(0, num(p.load, 0)));
/** A kilökött játékos húzás-szorzója a társra (0..1): drag · clamp(kilökött tömege / társ tömege). */
export function knockK(knocked, partner, kc = KNOCK_CONFIG) {
  const c = kc || KNOCK_CONFIG, r = Math.min(num(c.massMax, 4), Math.max(num(c.massMin, 0.25), massOf(knocked) / massOf(partner)));
  return clamp01(Math.max(0, num(c.drag, 0.7)) * r);
}
const knockOf = (p, kc) => {
  const x = num(p.kbx, 0), y = num(p.kby, 0);
  return Math.hypot(x, y) >= num(kc.minSpeed, 1) ? { x, y } : { x: 0, y: 0 };
};

// Régi API (S010): csak a húzás-költség; az S048-tól a game-stamina.stepStamina vékony burkolója (azonos viselkedés).
export function stepPullStamina(players, mode, dt, enabled, cfg = PULL_STAMINA) {
  stepStamina(players, mode, null, dt, enabled, cfg, STAMINA_ACT);
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
    sprint: [false, false],                 // az utolsó lépésben sprintelt-e (A, B)
    blocked: { a: { x: false, y: false }, b: { x: false, y: false } }, // az utolsó lépésben a fal levágta-e a mozgást
    knock: { mode: { x: 'free', y: 'free' }, k: { a: 0, b: 0 }, active: false }, // S073: az utolsó lépés visszalökés-lépése (active: volt-e)
  };
}

// Egy póráz-eredmény alkalmazása (fal nélkül egyszerű integrálás; falnál: ütközés előbb, póráz utána). -> blocked.
function advance(pa, pb, t, dt, walls, L) {
  if (walls && walls.length && dt > 0) {
    const ax = pa.x, ay = pa.y, bx = pb.x, by = pb.y;
    const blocked = moveWithWalls(pa, pb, t.a, t.b, dt, walls, L);
    pa.vx = (pa.x - ax) / dt; pa.vy = (pa.y - ay) / dt; // tényleges sebesség
    pb.vx = (pb.x - bx) / dt; pb.vy = (pb.y - by) / dt;
    return blocked;
  }
  applyVelocity(pa, t.a.x, t.a.y, dt);
  applyVelocity(pb, t.b.x, t.b.y, dt);
  return { a: { x: false, y: false }, b: { x: false, y: false } };
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
  // S048: sprint (gomb tartva + mozgás + nem kimerült): a SAJÁT sebesség szorzódik (a speedMul-lal, ideiglenesen).
  const act = sys.cfg.act || STAMINA_ACT;
  const sprint = players.map((p, i) => wantsSprint(inputs[i], act) && canSprint(p));
  const savedMul = players.map(p => p.speedMul);
  players.forEach((p, i) => { if (sprint[i]) p.speedMul = num(p.speedMul, 1) * act.sprintMul; });
  // S073: a visszalökés nem szándék: a bemeneti lépésből kivesszük (a desiredVelocity a p.kbx/kby-t adná hozzá), külön lépésben mozog
  const kc = sys.cfg.knock && typeof sys.cfg.knock === 'object' ? sys.cfg.knock : null;
  const savedKb = players.map(p => [p.kbx, p.kby]);
  if (kc) players.forEach(p => { p.kbx = 0; p.kby = 0; });
  const va = desiredVelocity(pa, inputs[0] || {});
  const vb = desiredVelocity(pb, inputs[1] || {});
  players.forEach((p, i) => { if (savedMul[i] === undefined) delete p.speedMul; else p.speedMul = savedMul[i]; p.sprinting = sprint[i]; });
  if (kc) players.forEach((p, i) => { p.kbx = savedKb[i][0]; p.kby = savedKb[i][1]; if (p.kbx === undefined) delete p.kbx; if (p.kby === undefined) delete p.kby; });
  const x0 = pa.x, y0 = pa.y, x1 = pb.x, y1 = pb.y;
  const t = computeTether({ a: pa, b: pb, va, vb, L, k, dt });
  const walls = sys.cfg.walls;
  sys.blocked = advance(pa, pb, t, dt, walls, L);
  // S073: visszalökés-lépés (a bemeneti mozgás UTÁN; a társ kívánt sebessége 0, így a feszes póráz viszi; nem költ staminát)
  sys.knock = { mode: { x: 'free', y: 'free' }, k: { a: 0, b: 0 }, active: false };
  t.knock = null;
  if (kc && dt > 0) {
    const ka = knockOf(pa, kc), kb = knockOf(pb, kc);
    if (ka.x || ka.y || kb.x || kb.y) {
      const kk = { a: knockK(pa, pb, kc), b: knockK(pb, pa, kc) };
      const t2 = computeTether({ a: pa, b: pb, va: ka, vb: kb, L, k: kk, dt });
      const b2 = advance(pa, pb, t2, dt, walls, L);
      for (const w of ['a', 'b']) for (const ax of ['x', 'y']) sys.blocked[w][ax] = sys.blocked[w][ax] || b2[w][ax];
      pa.vx = (pa.x - x0) / dt; pa.vy = (pa.y - y0) / dt; // a teljes lépés tényleges sebessége (bemenet + visszalökés)
      pb.vx = (pb.x - x1) / dt; pb.vy = (pb.y - y1) / dt;
      sys.knock = { mode: t2.mode, k: kk, active: true };
      t.knock = t2;
    }
  }
  reelIn(pa, pb, L, dt, walls, sys.cfg.reel);
  stepStamina(players, t.mode, { sprint, gather: players.map(p => !!p.gathering) }, dt, staminaOn, sys.cfg.stamina, act); // p.gathering: a main.js állítja a gyűjtés után
  sys.sprint = sprint;
  sys.L = L;
  sys.k = k;
  sys.stamina = { a: snap(pa), b: snap(pb) };
  sys.stretch = t.stretch;
  sys.mode = t.mode;
  return t;
}
