// game-paperdoll.js (S064; tiszta logika, DOM nélkül; importja: data-paperdoll, world-sprite): rétegezett karakter (paperdoll).
// Rétegek (hátulról előre): árnyék, [fegyver hátulnézetben], láb, törzs + kaszt-ruha, kar, fegyver, fej/faj, haj, fül/arc, fejdísz; végül automata körvonal.
// A figura kódból rajzolt (rect-ek) 32x40-es rácsra, 4 irányban (down/up/left/right) és 3 séta-képkockával (0 álló, 1/2 lépés).
// Az eredmény sprite-DSL definíció ({id, palette, rows, ax, ay}), így a meglévő sprite-cache (render-sprite.js) kezeli. Az S101/S102 (LPC) ugyanezt az API-t váltja ki.
import { DOLL_CONFIG as C, DOLL_RACES, DOLL_RACE_FALLBACK, DOLL_CLASSES, DOLL_CLASS_FALLBACK, DOLL_HAIR_STYLES, DOLL_COLORS as K } from './data-paperdoll.js';
import { parseColor } from './world-sprite.js';

const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const fin = Number.isFinite;
const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const WOOD = '#6b4a2a', WOOD_D = '#4a3220', STRING = '#e8e0c0';

/** A néző irány a facing-ből (4 irány; nulla/hibás -> a korábbi, alap 'down'). */
export function dirOf(facing, prev = 'down') {
  const keep = C.dirs.includes(prev) ? prev : 'down';
  if (!facing || typeof facing !== 'object' || !fin(facing.x) || !fin(facing.y)) return keep;
  const ax = Math.abs(facing.x), ay = Math.abs(facing.y);
  if (ax > ay) return facing.x < 0 ? 'left' : 'right';
  if (ay > ax) return facing.y < 0 ? 'up' : 'down';
  return keep;
}

export const createAnim = () => ({ t: 0, dir: 'down', frame: 0, moving: false });

/** Animáció-lépés: p.vx/p.vy a TÉNYLEGES sebesség (a póráz utáni), facing a bemenet-irány. -> az anim (érvénytelen bemenetre újat ad). */
export function stepAnim(anim, p, facing, dt) {
  const a = anim && typeof anim === 'object' ? anim : createAnim();
  a.dir = dirOf(facing, a.dir);
  const d = fin(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
  const sp = p && fin(p.vx) && fin(p.vy) ? Math.hypot(p.vx, p.vy) : 0;
  if (sp > C.minSpeed) {
    if (!a.moving) { a.moving = true; a.t = C.stride; } // az első kocka már lépés
    a.t += sp * d;
    a.frame = C.seq[Math.floor(a.t / C.stride) % C.seq.length];
  } else { a.moving = false; a.t = 0; a.frame = 0; }
  return a;
}

/** Séta-képkocka egy időponthoz (előnézet): a ciklus a previewTime-onként lép. */
export function frameAt(t) {
  const n = C.seq.length, k = fin(t) && t > 0 ? Math.floor(t / C.previewTime) : 0;
  return C.seq[k % n];
}

/** Kinézet: faj + kaszt (+ opciók: hairStyle, hairColor, skin). Ismeretlen faj/kaszt -> semleges alak. Fagyasztott; key = a sprite-azonosító alapja. */
export function appearanceOf(raceId, classId, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const look = has(DOLL_RACES, raceId) ? DOLL_RACES[raceId] : DOLL_RACE_FALLBACK;
  const cls = has(DOLL_CLASSES, classId) ? DOLL_CLASSES[classId] : DOLL_CLASS_FALLBACK;
  const hs = DOLL_HAIR_STYLES.includes(o.hairStyle) && o.hairStyle !== 'default' ? o.hairStyle : look.hairStyle;
  const hair = parseColor(o.hairColor) || look.hairColor, skin = parseColor(o.skin) || look.skin;
  const race = has(DOLL_RACES, raceId) ? raceId : 'x', kl = has(DOLL_CLASSES, classId) ? classId : 'x';
  return Object.freeze({ race, cls: kl, look, c: cls, hairStyle: hs, hair, skin, skinDark: parseColor(o.skin) ? shade(skin, 0.8) : look.skinDark, key: `${race}.${kl}.${hs}.${hair.slice(1)}.${skin.slice(1)}` });
}

export function shade(hex, f) {
  const h = parseColor(hex);
  if (!h) return '#808080';
  const n = (i) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * f))).toString(16).padStart(2, '0');
  return '#' + n(1) + n(3) + n(5);
}

const okDir = (d) => (C.dirs.includes(d) ? d : 'down');
const okFrame = (f) => (Number.isInteger(f) && f >= 0 && f < C.frames ? f : 0);
export const dollId = (app, dir, frame) => `doll.${app.key}.${okDir(dir)}.${okFrame(frame)}`;

function grid(mirror) {
  const W = C.w, H = C.h, g = new Array(W * H).fill(null);
  const put = (x, y, c) => { if (mirror) x = W - 1 - x; if (x >= 0 && y >= 0 && x < W && y < H) g[y * W + x] = c; };
  return { g, clear: (x, y) => put(x, y, null), rect(x, y, w, h, c) { if (c) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c); } };
}

function weapon(rect, kind, c, hx, hy) {
  if (kind === 'sword') { rect(hx - 1, hy - 14, 2, 11, c.metal); rect(hx - 3, hy - 3, 6, 2, c.trim); rect(hx - 1, hy - 1, 2, 3, WOOD_D); }
  else if (kind === 'staff') { rect(hx - 1, hy - 20, 2, C.ay - 1 - (hy - 20), WOOD); rect(hx - 2, hy - 24, 4, 4, c.metal); rect(hx - 1, hy - 23, 1, 1, K.white); }
  else if (kind === 'bow') { rect(hx + 1, hy - 9, 1, 12, STRING); rect(hx - 1, hy - 9, 2, 3, WOOD); rect(hx - 2, hy - 6, 2, 6, WOOD); rect(hx - 1, hy, 2, 3, WOOD); }
  else if (kind === 'mace') { rect(hx - 1, hy - 7, 2, 9, WOOD); rect(hx - 1, hy - 15, 3, 8, c.metal); rect(hx - 3, hy - 13, 7, 3, c.metal); }
}

function hairLayer(rect, style, color, view, g) {
  const { hx0, headTop: y0, hw, hh, cx } = g, front = view === 'down', back = view === 'up';
  if (style === 'bald') return;
  if (style === 'mohawk') { if (front || back) rect(cx - 1, y0 - 3, 2, back ? hh : 6, color); else rect(hx0 + 2, y0 - 3, hw - 4, 4, color); return; }
  if (back) { rect(hx0, y0, hw, hh - 1, color); if (style === 'long') rect(hx0 - 1, y0 + 2, hw + 2, hh + 3, color); return; }
  if (front) {
    rect(hx0, y0, hw, 3, color); rect(hx0, y0 + 3, 1, 3, color); rect(hx0 + hw - 1, y0 + 3, 1, 3, color);
    if (style === 'long') { rect(hx0 - 1, y0 - 1, hw + 2, 4, color); rect(hx0 - 1, y0 + 3, 1, hh + 2, color); rect(hx0 + hw, y0 + 3, 1, hh + 2, color); }
    if (style === 'beard') rect(hx0 + 1, y0 + hh - 4, hw - 2, 6, color);
    return;
  }
  rect(hx0, y0, hw, 3, color); rect(hx0 + hw - 4, y0, 4, hh - 3, color); // oldalnézet: tető + tarkó
  if (style === 'long') rect(hx0 + hw - 4, y0, 4, hh + 5, color);
  if (style === 'beard') rect(hx0, y0 + hh - 3, 5, 4, color);
}

function headgear(rect, kind, c, view, g) {
  const { hx0, headTop: y0, hw, hh, cx } = g;
  if (kind === 'helm') {
    rect(hx0 - 1, y0 - 1, hw + 2, 5, c.metal); rect(hx0 - 1, y0 + 3, hw + 2, 1, c.dark);
    if (view === 'down') rect(cx - 1, y0 + 4, 2, 3, c.metal); else if (view === 'up') rect(hx0 - 1, y0 + 4, hw + 2, hh - 5, c.metal); else rect(hx0 + hw - 4, y0 + 4, 5, hh - 6, c.metal);
  } else if (kind === 'hat') {
    rect(hx0 - 3, y0 + 1, hw + 6, 2, c.cloth); rect(hx0 + 1, y0 - 2, hw - 2, 3, c.cloth); rect(hx0 + 3, y0 - 4, hw - 6, 2, c.cloth); rect(cx - 1, y0 - 5, 2, 1, c.dark); rect(hx0 + 1, y0, hw - 2, 1, c.trim);
  } else if (kind === 'hood') {
    rect(hx0 - 1, y0 - 1, hw + 2, 4, c.cloth);
    if (view === 'down') { rect(hx0 - 1, y0 + 3, 2, hh - 3, c.cloth); rect(hx0 + hw - 1, y0 + 3, 2, hh - 3, c.cloth); }
    else if (view === 'up') rect(hx0 - 1, y0 + 3, hw + 2, hh, c.cloth);
    else rect(hx0 + hw - 5, y0 + 3, 6, hh, c.cloth);
  }
}

function paintFigure(app, view, frame, P) {
  const { rect, clear } = P, L = app.look, c = app.c, skin = app.skin, dk = app.skinDark;
  const cx = C.w / 2, feet = C.ay, side = view === 'left', front = view === 'down', back = view === 'up';
  const { hw, hh, tw, th, lh, aw } = L, bob = frame ? 1 : 0, swing = frame === 1 ? 1 : frame === 2 ? -1 : 0;
  const tws = side ? Math.max(6, tw - 4) : tw, torsoBot = feet - lh - bob, torsoTop = torsoBot - th, headTop = torsoTop - hh + 2;
  const x0 = cx - tws / 2, hx0 = cx - hw / 2, ey = headTop + Math.floor(hh / 2), armH = th - 2, ay0 = torsoTop + 1;
  const dyL = swing === 1 ? -1 : swing === -1 ? 1 : 0, g = { hx0, headTop, hw, hh, cx };
  const wk = c.weapon;

  if (back) weapon(rect, wk, c, x0 + tw + Math.floor(aw / 2), ay0 + armH - dyL); // hátulnézet: a fegyver a test mögött
  // láb
  if (!side) {
    const lw = tw / 2 - 1;
    [[x0 + 1, swing === 1 ? 2 : 0], [cx + 1, swing === -1 ? 2 : 0]].forEach(([x, lift]) => {
      const top = torsoBot - 1, boot = feet - lift - 2;
      rect(x, top, lw, boot - top, c.pants); rect(x, boot, lw, 2, c.boots);
    });
  } else {
    const lw = Math.max(3, Math.floor(tws / 2)), bx = Math.floor(cx - lw / 2), off = swing * 3, top = torsoBot - 1;
    rect(bx + off, top, lw, feet - 2 - top, shade(c.pants, 0.78)); rect(bx + off, feet - 2, lw, 2, shade(c.boots, 0.78));
    rect(bx - off, top, lw, feet - 2 - top, c.pants); rect(bx - off - 1, feet - 2, lw + 1, 2, c.boots);
  }
  // törzs + kaszt-ruha
  rect(x0, torsoTop, tws, th, c.cloth); rect(x0 + tws - 2, torsoTop, 2, th, c.dark); rect(x0, torsoBot - 2, tws, 1, c.boots);
  if (front) rect(cx - 2, torsoTop, 4, 1, dk);
  if (app.cls === 'warrior') { if (side) rect(cx - 3, torsoTop - 1, 5, 4, c.metal); else { rect(x0 - 1, torsoTop - 1, 4, 4, c.metal); rect(x0 + tw - 3, torsoTop - 1, 4, 4, c.metal); } }
  if (app.cls === 'healer' && front) { rect(cx - 1, torsoTop + 3, 2, 6, c.trim); rect(cx - 3, torsoTop + 5, 6, 2, c.trim); }
  if (app.cls === 'ranger' && !front) { const qx = side ? x0 + tws - 3 : x0 + tws - 4; rect(qx, torsoTop - 3, 3, 9, WOOD); rect(qx, torsoTop - 5, 3, 2, STRING); }
  if (app.cls === 'wizard') { rect(x0, torsoBot, tws, 3, c.cloth); rect(x0 + tws - 2, torsoBot, 2, 3, c.dark); rect(x0, torsoBot + 2, tws, 1, c.trim); }
  // kar + fegyver
  if (!side) {
    for (const [x, dy] of [[x0 - aw, dyL], [x0 + tw, -dyL]]) { rect(x, ay0 + dy, aw, armH - 2, c.cloth); rect(x, ay0 + dy + armH - 2, aw, 2, skin); }
    if (front) weapon(rect, wk, c, x0 - aw + Math.floor(aw / 2), ay0 + dyL + armH);
  } else {
    const ax = Math.floor(cx - aw / 2) - swing * 2;
    rect(ax, ay0, aw, armH - 2, c.cloth); rect(ax, ay0 + armH - 2, aw, 2, skin);
    weapon(rect, wk, c, ax - 1, ay0 + armH);
  }
  // fej, haj, fül/arc, fejdísz
  rect(hx0, headTop, hw, hh, skin); clear(hx0, headTop); clear(hx0 + hw - 1, headTop); clear(hx0, headTop + hh - 1); clear(hx0 + hw - 1, headTop + hh - 1);
  hairLayer(rect, app.hairStyle, app.hair, view, g);
  if (L.ears === 'point') {
    if (side) { rect(hx0 + hw - 5, ey - 1, 2, 2, skin); rect(hx0 + hw - 3, ey - 2, 2, 1, skin); }
    else { rect(hx0 - 2, ey - 1, 2, 2, skin); rect(hx0 - 3, ey - 2, 1, 1, skin); rect(hx0 + hw, ey - 1, 2, 2, skin); rect(hx0 + hw + 2, ey - 2, 1, 1, skin); }
  }
  if (front) { rect(cx - 3, ey, 1, 2, K.eye); rect(cx + 2, ey, 1, 2, K.eye); if (L.ears === 'tusk') { rect(cx - 3, headTop + hh - 2, 1, 2, K.white); rect(cx + 2, headTop + hh - 2, 1, 2, K.white); } }
  if (side) { rect(hx0 + 2, ey, 1, 2, K.eye); rect(hx0 - 1, ey + 2, 1, 2, skin); if (L.ears === 'tusk') rect(hx0, headTop + hh - 2, 1, 2, K.white); }
  headgear(rect, c.head, c, view, g);
}

/** A figura pixelei: {palette {kar: szín}, rows [32 karakteres sorok]}. dir: down|up|left|right (a right a left tükre), frame 0..2. */
export function renderDollRows(app, dir, frame) {
  const d = okDir(dir), f = okFrame(frame), P = grid(d === 'right');
  paintFigure(app, d === 'right' ? 'left' : d, f, P);
  const W = C.w, H = C.h, g = P.g, out = new Array(W * H).fill(null), tw = app.look.tw;
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? g[y * W + x] : null);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    out[i] = g[i] || (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1) ? K.outline : null);
  }
  [[C.ay - 1, tw + 2], [C.ay, tw], [C.ay + 1, tw - 4]].forEach(([y, w]) => { for (let x = Math.round(C.ax - w / 2); x < Math.round(C.ax + w / 2); x++) if (y < H && !out[y * W + x]) out[y * W + x] = K.shadow; });
  const palette = {}, idx = new Map();
  const rows = [];
  for (let y = 0; y < H; y++) {
    let r = '';
    for (let x = 0; x < W; x++) {
      const col = out[y * W + x];
      if (!col) { r += '.'; continue; }
      if (!idx.has(col)) idx.set(col, idx.size < CHARS.length ? CHARS[idx.size] : CHARS[CHARS.length - 1]);
      palette[idx.get(col)] = col; r += idx.get(col);
    }
    rows.push(r);
  }
  return { palette, rows };
}

/** Sprite-DSL definíció egy (irány, képkocka) párhoz. */
export function dollDef(app, dir, frame) {
  const r = renderDollRows(app, dir, frame);
  return { id: dollId(app, dir, frame), palette: r.palette, rows: r.rows, ax: C.ax, ay: C.ay };
}
