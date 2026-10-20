// Virtuális felbontás + egész számú skálázás (pixelated)
export const VIRTUAL_W = 960;
export const VIRTUAL_H = 540;
export const TILE = 32;

export function computeScale(winW, winH) {
  const s = Math.floor(Math.min(winW / VIRTUAL_W, winH / VIRTUAL_H));
  return Math.max(1, s);
}

export function createScreen(canvas) {
  canvas.width = VIRTUAL_W;
  canvas.height = VIRTUAL_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const screen = { canvas, ctx, scale: 1, width: VIRTUAL_W, height: VIRTUAL_H };

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    let s = computeScale(w, h);
    // 1x alatt (kis ablak) törtszámos méretre esünk vissza, hogy ne lógjon ki
    let cw = VIRTUAL_W * s, ch = VIRTUAL_H * s;
    if (cw > w || ch > h) {
      const f = Math.min(w / VIRTUAL_W, h / VIRTUAL_H);
      cw = Math.floor(VIRTUAL_W * f);
      ch = Math.floor(VIRTUAL_H * f);
    }
    screen.scale = s;
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    ctx.imageSmoothingEnabled = false;
  }

  window.addEventListener('resize', resize);
  resize();
  screen.resize = resize;
  return screen;
}
