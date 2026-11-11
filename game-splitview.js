// Két nézet (S023; tiszta logika, DOM nélkül): két kamera, fix függőleges osztás,
// mindkét kamera a SAJÁT játékosát követi. A dinamikus osztóvonal (S024) és az összeolvadás (S025) erre épül.
import { createCamera, stepCamera, cameraOffset } from './game-camera.js';

export const SPLIT_CONFIG = { w: 960, h: 540, divider: 2 }; // divider: az osztóvonal vastagsága (px), a két nézet fele-fele

function num(v, d) { return Number.isFinite(v) ? v : d; }

/** Elrendezés: két egyforma nézet (bal/jobb), az osztóvonal a középen, a nézetek fölé rajzolva. */
export function splitLayout(cfg = SPLIT_CONFIG) {
  const w = Math.max(2, Math.floor(num(cfg.w, 960)));
  const h = Math.max(1, Math.floor(num(cfg.h, 540)));
  const vw = Math.floor(w / 2);
  const dw = Math.max(0, Math.min(8, Math.floor(num(cfg.divider, 2))));
  return {
    w, h,
    views: [{ x: 0, y: 0, w: vw, h }, { x: vw, y: 0, w: w - vw, h }],
    divider: { x: vw - Math.floor(dw / 2), y: 0, w: dw, h },
  };
}

/** Két kamera a játékosok pozícióján (a kezdő pozíció nem simul végig). */
export function createSplitView(players, layout = splitLayout()) {
  const sv = { layout, cams: [createCamera(0, 0), createCamera(0, 0)], steps: 0 };
  snapSplitView(sv, players);
  return sv;
}

function pos(p) { return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null; }

/** Azonnali ugrás a játékosokhoz (warp, betöltés). Hibás játékos-pozíciónál a kamera érintetlen. */
export function snapSplitView(sv, players) {
  for (let i = 0; i < 2; i++) {
    const p = pos(players && players[i]);
    if (p) { sv.cams[i].x = p.x; sv.cams[i].y = p.y; }
  }
  return sv;
}

/** Egy lépés: az i. kamera az i. játékost követi (fps-független simítás + a játékos a margón belül marad a nézetében). */
export function stepSplitView(sv, players, dt, camCfg) {
  for (let i = 0; i < 2; i++) {
    const p = pos(players && players[i]);
    if (!p) continue;
    const v = sv.layout.views[i];
    stepCamera(sv.cams[i], p, p, dt, camCfg, { w: v.w, h: v.h });
  }
  sv.steps++;
  return sv;
}

/** Egész pixelre kerekített bal-felső sarkok nézetenként (világ -> nézet: p - offset). */
export function splitOffsets(sv, out = [{ x: 0, y: 0 }, { x: 0, y: 0 }]) {
  for (let i = 0; i < 2; i++) {
    const v = sv.layout.views[i];
    const o = cameraOffset(sv.cams[i], { w: v.w, h: v.h });
    out[i].x = o.x; out[i].y = o.y;
  }
  return out;
}

/** A pont a nézetben van-e (margó px-szel beljebb). */
export function viewContains(sv, i, p, margin = 0, offsets) {
  const v = sv.layout.views[i];
  const o = (offsets || splitOffsets(sv))[i];
  const x = p.x - o.x, y = p.y - o.y;
  return x >= margin && y >= margin && x <= v.w - margin && y <= v.h - margin;
}
