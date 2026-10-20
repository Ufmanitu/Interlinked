// Játékos-entitás: tiszta logika (nincs DOM/canvas). A póráz az S006-ban veszi át a mozgást.
export const PLAYER_SIZE = 24;
export const PLAYER_SPEED = 120; // px/s
export const PLAYER_COLORS = ['#3b82f6', '#ef4444']; // P1 kék, P2 piros

export function createPlayer(index, x, y) {
  return { index, x, y, w: PLAYER_SIZE, h: PLAYER_SIZE, vx: 0, vy: 0, speed: PLAYER_SPEED, color: PLAYER_COLORS[index] };
}

// Kívánt sebesség az inputból (px/s), a póráz-logika bemenete lesz.
export function desiredVelocity(p, inp) {
  return { x: (inp.x || 0) * p.speed, y: (inp.y || 0) * p.speed };
}

// Mozgás a kívánt sebességgel (S006-ig közvetlen).
export function stepPlayer(p, inp, dt) {
  const v = desiredVelocity(p, inp);
  p.vx = v.x; p.vy = v.y;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
}
