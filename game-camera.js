// Közös kamera: tiszta logika (nincs DOM/canvas függés).
export const CAM_VIEW = { w: 960, h: 540 };
export const CAM_CONFIG = { k: 6, margin: 48 }; // k: simítás sebessége (1/s), margin: pixel a képszéltől

export function createCamera(x = 0, y = 0) {
  return { x, y };
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Engedett késés tengelyenként: a két játékos a margón belül maradjon a képben.
export function maxLag(delta, viewSize, margin) {
  return Math.max(0, viewSize / 2 - margin - Math.abs(delta) / 2);
}

// fps-független simítás: cam += (target - cam) * (1 - exp(-k*dt)), majd késés-korlát.
export function stepCamera(cam, a, b, dt, cfg = CAM_CONFIG, view = CAM_VIEW) {
  const t = midpoint(a, b);
  const f = 1 - Math.exp(-cfg.k * dt);
  cam.x += (t.x - cam.x) * f;
  cam.y += (t.y - cam.y) * f;
  const lx = maxLag(a.x - b.x, view.w, cfg.margin);
  const ly = maxLag(a.y - b.y, view.h, cfg.margin);
  cam.x = Math.min(t.x + lx, Math.max(t.x - lx, cam.x));
  cam.y = Math.min(t.y + ly, Math.max(t.y - ly, cam.y));
  return cam;
}

// Egész pixelre kerekített bal-felső sarok (világ -> képernyő: p - offset).
export function cameraOffset(cam, view = CAM_VIEW) {
  return { x: Math.round(cam.x - view.w / 2), y: Math.round(cam.y - view.h / 2) };
}
