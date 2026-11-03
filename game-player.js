// Játékos-entitás: tiszta logika (nincs DOM/canvas). A mozgást a póráz-rendszer (tether-system.js) dönti el:
// a játékos csak kívánt sebességet ad, a tényleges sebességet kívülről kapja (applyVelocity).
export const PLAYER_SIZE = 24;
export const PLAYER_SPEED = 120; // px/s
export const PLAYER_COLORS = ['#3b82f6', '#ef4444']; // P1 kék, P2 piros

export function createPlayer(index, x, y) {
  return { index, x, y, w: PLAYER_SIZE, h: PLAYER_SIZE, vx: 0, vy: 0, speed: PLAYER_SPEED, color: PLAYER_COLORS[index] };
}

// Kívánt sebesség az inputból (px/s), a póráz-logika bemenete.
export function desiredVelocity(p, inp) {
  return { x: (inp.x || 0) * p.speed, y: (inp.y || 0) * p.speed };
}

// A póráz által megengedett tényleges sebesség alkalmazása (a játékos önállóan nem mozog).
export function applyVelocity(p, vx, vy, dt) {
  p.vx = vx; p.vy = vy;
  p.x += vx * dt;
  p.y += vy * dt;
}
