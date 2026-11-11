// Két nézet rajza (S023): két offscreen canvas (nézetenként egy), a kompozíció a fő vászonra.
// A játék-rajzoló (main.js) a beginView(i) ctx-ére rajzol (0,0 = a nézet bal-felső sarka), a composeSplit rakja össze.

export const SPLIT_STYLE = { divider: '#0a0d14', clear: '#10141c' };

function defaultCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** createSplitRenderer(layout, makeCanvas?) -> {layout, canvases[2], ctxs[2], stats{begun,composed}} */
export function createSplitRenderer(layout, makeCanvas = defaultCanvas) {
  const canvases = [], ctxs = [];
  for (const v of layout.views) {
    const c = makeCanvas(v.w, v.h);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    canvases.push(c); ctxs.push(ctx);
  }
  return { layout, canvases, ctxs, stats: { begun: 0, composed: 0 } };
}

/** Az i. nézet törlése és ctx-ének visszaadása (nézet-koordináták). */
export function beginView(rend, i) {
  const ctx = rend.ctxs[i];
  const v = rend.layout.views[i];
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = SPLIT_STYLE.clear;
  ctx.fillRect(0, 0, v.w, v.h);
  rend.stats.begun++;
  return ctx;
}

/** A két nézet a fő vászonra (egész pixel), majd az osztóvonal. Visszatér a másolt nézetek számával. */
export function composeSplit(ctx, rend) {
  const L = rend.layout;
  let n = 0;
  for (let i = 0; i < 2; i++) {
    const v = L.views[i];
    ctx.drawImage(rend.canvases[i], 0, 0, v.w, v.h, v.x, v.y, v.w, v.h);
    n++;
  }
  if (L.divider.w > 0) {
    ctx.fillStyle = SPLIT_STYLE.divider;
    ctx.fillRect(L.divider.x, L.divider.y, L.divider.w, L.divider.h);
  }
  rend.stats.composed++;
  return n;
}
