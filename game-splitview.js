// Két nézet (S023) + összeolvadás (S025); tiszta logika, DOM nélkül.
// Két kamera, fix függőleges osztás. Szétválva a két nézet a SAJÁT játékosát követi; ha |Δ| <= 0,85·L_normal, a két nézet
// EGY közös, a felezőpont körüli 960x540-es képet ad (bal/jobb fél), nincs osztóvonal; |Δ| > 1,0·L_normal: szétválás.
// A váltás hiszterézises (nincs villogás), az átmenet idő-alapú és simított. A dinamikus osztóvonal az S024.
import { createCamera, stepCamera, cameraOffset } from './game-camera.js';

export const SPLIT_CONFIG = {
  w: 960, h: 540, divider: 2, // divider: az osztóvonal vastagsága (px), a két nézet fele-fele
  mergeAt: 0.85,  // összeolvadás: r <= mergeAt  (r = max(|Δx|/Lx, |Δy|/Ly), L = L_normal)
  splitAt: 1.0,   // szétválás: r > splitAt + eps
  eps: 0.005,     // tolerancia a póráz lebegőpontos zajára (a korlátnál r = 1 ± zaj ne váltson)
  time: 0.4,      // az átmenet hossza (mp)
  swapDead: 16,   // a bal/jobb nézet cseréjéhez kell |Δx| (px), csak teljesen összeolvadva
};

function num(v, d) { return Number.isFinite(v) ? v : d; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

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

function pos(p) { return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null; }

/** L_normal -> {x,y} (szám | {x,y} | függvény(players)); hibás/nem pozitív -> null (az összeolvadás ilyenkor ki van kapcsolva). */
export function normalL(L, players) {
  const v = typeof L === 'function' ? L(players) : L;
  if (typeof v === 'number') return v > 0 && Number.isFinite(v) ? { x: v, y: v } : null;
  if (v && v.x > 0 && v.y > 0 && Number.isFinite(v.x) && Number.isFinite(v.y)) return { x: v.x, y: v.y };
  return null;
}

/** r = max(|Δx|/Lx, |Δy|/Ly): a távolság L_normal-hoz mérve (hibás pozíció/L -> NaN). */
export function mergeRatio(a, b, L) {
  const l = normalL(L);
  if (!l || !pos(a) || !pos(b)) return NaN;
  return Math.max(Math.abs(a.x - b.x) / l.x, Math.abs(a.y - b.y) / l.y);
}

/** Hiszterézis: az új "összeolvadt" állapot (on). Hibás r -> az állapot marad.
 *  tight (S030): falun kívül (L_eff = L_normal) a póráz r <= 1-en tart, ott nincs mit hiszterézissel védeni -> az összeolvadás már r <= splitAt-nál is megtörténik
 *  (a visszahúzott pár nem ragad szétválva 0,85 és 1,0 között). */
export function mergeDecide(on, r, cfg = SPLIT_CONFIG, tight = false) {
  if (!Number.isFinite(r)) return on;
  if (on) return !(r > cfg.splitAt + cfg.eps);
  return r <= (tight ? cfg.splitAt : cfg.mergeAt);
}

function easeIn(s) { const t = clamp01(s); return t * t * (3 - 2 * t); } // smoothstep

/** Két kamera a játékosok pozícióján (a kezdő pozíció nem simul végig); L megadva és közel -> összeolvadva indul. */
export function createSplitView(players, layout = splitLayout(), L, cfg = SPLIT_CONFIG) {
  const sv = {
    layout, cfg, cams: [createCamera(0, 0), createCamera(0, 0)], common: createCamera(0, 0), steps: 0,
    order: 0, // a bal (0.) nézet melyik játékost követi: 0 -> P1, 1 -> P2 (összeolvadva a x-sorrendhez igazodik)
    merge: { on: false, s: 0, e: 0 }, // on: hiszterézises állapot, s: lineáris 0..1 (0 szétválva), e: simított 0..1
  };
  snapSplitView(sv, players, L);
  return sv;
}

/** Melyik játékos (0|1) tartozik az i. nézethez. */
export function viewOwner(sv, i) { return (i ^ sv.order) & 1; }

/** Az összeolvadás simított mértéke 0 (két külön nézet) .. 1 (egy kép, nincs osztóvonal). */
export function mergeBlend(sv) { return sv.merge.e; }

/** Azonnali ugrás a játékosokhoz (warp, betöltés). Hibás játékos-pozíciónál a kamera érintetlen. L: az összeolvadás állapotát is beállítja. */
export function snapSplitView(sv, players, L) {
  const a = pos(players && players[0]), b = pos(players && players[1]);
  for (let i = 0; i < 2; i++) {
    const p = pos(players && players[viewOwner(sv, i)]);
    if (p) { sv.cams[i].x = p.x; sv.cams[i].y = p.y; }
  }
  if (a && b) { sv.common.x = (a.x + b.x) / 2; sv.common.y = (a.y + b.y) / 2; }
  const r = mergeRatio(a, b, normalL(L, players) || null);
  if (Number.isFinite(r)) {
    const on = r <= sv.cfg.mergeAt;
    sv.merge.on = on; sv.merge.s = on ? 1 : 0; sv.merge.e = sv.merge.s;
    if (on) {
      const want = a.x > b.x + sv.cfg.swapDead ? 1 : b.x > a.x + sv.cfg.swapDead ? 0 : sv.order;
      if (want !== sv.order) swapOrder(sv, players, want);
    }
  }
  return sv;
}

function swapOrder(sv, players, order) {
  sv.order = order;
  for (let i = 0; i < 2; i++) {
    const p = pos(players && players[viewOwner(sv, i)]);
    if (p) { sv.cams[i].x = p.x; sv.cams[i].y = p.y; }
  }
}

/** Egy lépés: nézetenként a saját játékos követése, a közös (felezőpont) kamera, az összeolvadás állapota és átmenete. L: L_normal (szám|{x,y}|függvény); nélküle nincs összeolvadás. tight: falun kívül (S030, lásd mergeDecide). */
export function stepSplitView(sv, players, dt, camCfg, L, tight = false) {
  const a = pos(players && players[0]), b = pos(players && players[1]);
  for (let i = 0; i < 2; i++) {
    const p = pos(players && players[viewOwner(sv, i)]);
    if (!p) continue;
    const v = sv.layout.views[i];
    stepCamera(sv.cams[i], p, p, dt, camCfg, { w: v.w, h: v.h });
  }
  if (a && b) stepCamera(sv.common, a, b, dt, camCfg, { w: sv.layout.w, h: sv.layout.h });
  const l = normalL(L, players);
  const m = sv.merge;
  m.on = l ? mergeDecide(m.on, mergeRatio(a, b, l), sv.cfg, !!tight) : false;
  if (dt > 0 && Number.isFinite(dt)) {
    const rate = dt / Math.max(1e-3, sv.cfg.time);
    m.s = clamp01(m.s + (m.on ? rate : -rate));
  }
  m.e = easeIn(m.s);
  // teljesen összeolvadva a bal/jobb nézet a bal/jobb oldali játékoshoz igazodik (a csere láthatatlan: egy kép)
  if (m.s >= 1 && a && b && Math.abs(a.x - b.x) > sv.cfg.swapDead) {
    const want = a.x <= b.x ? 0 : 1;
    if (want !== sv.order) swapOrder(sv, players, want);
  }
  sv.steps++;
  return sv;
}

/** Az i. nézet tényleges kamera-középpontja: a saját kamera és az összeolvadt (közös kép adott fele) között simítva. */
export function viewCenter(sv, i, out = { x: 0, y: 0 }) {
  const v = sv.layout.views[i], L = sv.layout, e = sv.merge.e;
  const mx = sv.common.x + (v.x + v.w / 2 - L.w / 2), my = sv.common.y + (v.y + v.h / 2 - L.h / 2);
  out.x = e >= 1 ? mx : sv.cams[i].x + (mx - sv.cams[i].x) * e; // e = 1: pontosan a közös kép (nincs lebegőpontos eltérés)
  out.y = e >= 1 ? my : sv.cams[i].y + (my - sv.cams[i].y) * e;
  return out;
}

/** Egész pixelre kerekített bal-felső sarkok nézetenként (világ -> nézet: p - offset). Összeolvadva a két nézet pontosan egymás mellé illeszkedik. */
export function splitOffsets(sv, out = [{ x: 0, y: 0 }, { x: 0, y: 0 }]) {
  const c = { x: 0, y: 0 }, L = sv.layout;
  for (let i = 0; i < 2; i++) {
    const v = L.views[i];
    if (sv.merge.e >= 1) { // egy közös kép: a nézetek offsetje ugyanabból az egész pixeles sarokból, a nézet helyével eltolva
      out[i].x = Math.round(sv.common.x - L.w / 2) + v.x; out[i].y = Math.round(sv.common.y - L.h / 2) + v.y;
      continue;
    }
    const o = cameraOffset(viewCenter(sv, i, c), { w: v.w, h: v.h });
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
