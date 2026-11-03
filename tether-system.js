// Póráz-rendszer: tiszta modul (nincs DOM/canvas). A játékosok mozgását ez dönti el:
// bemenet -> kívánt sebesség -> computeTether (L_eff, k) -> tényleges sebesség -> pozíció.
import { CAM_VIEW, CAM_CONFIG } from './game-camera.js';
import { computeTether } from './tether-logic.js';
import { desiredVelocity, applyVelocity } from './game-player.js';
import { moveWithWalls } from './game-collision.js';

// L: szám | {x,y} | függvény(players) -> szám|{x,y} (az S027-től a FieldSystem adja az L_eff-et).
// k: szám | {a,b} | függvény(players) -> szám|{a,b} (a valódi k-hook az S010-ben).
// walls: [{x,y,w,h}] falak (S007); üres -> nincs ütközés. Ütközés előbb, póráz utána.
// Alapérték: a kamera látómezeje mínusz a margó (a kamera késés-korlátjával összhangban), k placeholder.
export const TETHER_CONFIG = {
  walls: [],
  L: { x: CAM_VIEW.w - 2 * CAM_CONFIG.margin, y: CAM_VIEW.h - 2 * CAM_CONFIG.margin },
  k: 0.5,
};

export function createTetherSystem(cfg = {}) {
  return {
    cfg: { ...TETHER_CONFIG, ...cfg },
    L: { x: 0, y: 0 },                      // az utolsó lépés L_eff-je
    stretch: { x: 0, y: 0 },                // az utolsó lépés stretch-e tengelyenként
    mode: { x: 'free', y: 'free' },         // free | hold | pull-a | pull-b
    blocked: { a: { x: false, y: false }, b: { x: false, y: false } }, // az utolsó lépésben a fal levágta-e a mozgást
  };
}

function resolve(v, players) {
  return typeof v === 'function' ? v(players) : v;
}

export function resolveL(cfg, players) {
  const L = resolve(cfg.L, players);
  return typeof L === 'number' ? { x: L, y: L } : { x: L.x, y: L.y };
}

// Egy lépés: a két játékos mozgatása a póráz szabályai szerint.
// inputs: [P1 input, P2 input] ({x,y} -1..1). Visszatér a computeTether eredményével.
export function stepTetherSystem(sys, players, inputs, dt) {
  const [pa, pb] = players;
  const L = resolveL(sys.cfg, players);
  const k = resolve(sys.cfg.k, players);
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
  sys.L = L;
  sys.stretch = t.stretch;
  sys.mode = t.mode;
  return t;
}
