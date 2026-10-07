// Virtuális 960x540 felbontás, egész számú (eszközpixeles) skálázás, pixelated.
export const W = 960;
export const H = 540;
export const computeScale = (winW, winH, dpr = 1) =>
  Math.max(1, Math.floor(Math.min((winW * dpr) / W, (winH * dpr) / H)));

export function createScreen(canvas, win = globalThis.window) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
  const screen = { canvas, ctx, scale: 1, resize };
  function resize() {
    const dpr = win.devicePixelRatio || 1;
    const s = computeScale(win.innerWidth, win.innerHeight, dpr);
    canvas.style.width = (W * s) / dpr + 'px';
    canvas.style.height = (H * s) / dpr + 'px';
    screen.scale = s;
  }
  win.addEventListener('resize', resize);
  resize();
  return screen;
}
