// world-sprite.js (S021; tiszta logika, DOM nélkül): pixel-art sprite-DSL.
// Paletta (egy karakter -> szín) + karakter-mátrix (rows) -> indexelt pixelek (Uint8Array, SPRITE_NONE = átlátszó).
// A tile-pixelek (world-tiles paintTile) ugyanezt a paletta-indexes formát használják.
// A rajzolás és a gyorsítótár: render-sprite.js. A hiányzó sprite helyett placeholder jön (soha nem dob).
export const SPRITE_NONE = 255;                 // átlátszó pixel az indexelt tömbben
export const SPRITE_LIMITS = Object.freeze({ maxSize: 256, maxColors: 64, maxErrors: 8, maxDerived: 2048 });
export const PLACEHOLDER_SIZE = 16;

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const isMap = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

/** '#rgb' | '#rgba' | '#rrggbb' | '#rrggbbaa' -> normalizált kisbetűs '#rrggbb' / '#rrggbbaa'; hibás -> null. */
export function parseColor(str) {
  if (typeof str !== 'string' || !HEX.test(str)) return null;
  let h = str.slice(1).toLowerCase();
  if (h.length <= 4) h = h.split('').map(c => c + c).join('');
  if (h.length === 8 && h.slice(6) === 'ff') h = h.slice(0, 6);
  return '#' + h;
}

/** Normalizált szín -> canvas fillStyle ('#rrggbb' marad, átlátszóságnál rgba()). */
export function colorCss(hex) {
  const h = parseColor(hex);
  if (!h) return '#ff00ff';
  if (h.length === 7) return h;
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return `rgba(${n(1)},${n(3)},${n(5)},${Math.round((n(7) / 255) * 1000) / 1000})`;
}

function checkColors(map, keys, errors, where) {
  const out = {};
  if (!isMap(map)) { errors.push(`${where}: a színtábla nem objektum`); return out; }
  for (const k of Object.keys(map)) {
    const c = parseColor(map[k]);
    if (!c) errors.push(`${where}: hibás szín '${k}': ${String(map[k])}`);
    else if (keys && !keys.includes(k)) errors.push(`${where}: ismeretlen paletta-kulcs '${k}'`);
    else out[k] = c;
  }
  return out;
}

/**
 * def: {id, palette:{c:'#rrggbb'}, rows:[string] | string, ax?, ay? (lábpont, alap: alul középen), variants?:{név:{c:szín}}}
 * Az '.' és a szóköz átlátszó (nem lehet paletta-kulcs). -> {ok, sprite|null, errors[]}; hibás adatra sem dob.
 */
export function compileSprite(def) {
  const errors = [];
  const fail = () => ({ ok: false, sprite: null, errors: errors.slice(0, SPRITE_LIMITS.maxErrors) });
  if (!isMap(def)) { errors.push('a definíció nem objektum'); return fail(); }
  if (typeof def.id !== 'string' || !def.id) errors.push('hiányzó id');
  let rows = def.rows;
  if (typeof rows === 'string') {
    rows = rows.split('\n');
    while (rows.length && rows[0] === '') rows.shift();
    while (rows.length && rows[rows.length - 1] === '') rows.pop();
  }
  if (!Array.isArray(rows) || !rows.length || !rows.every(r => typeof r === 'string')) errors.push('a rows nem sztringek nem üres tömbje');
  if (!isMap(def.palette)) errors.push('hiányzó paletta');
  if (errors.length) return fail();

  const keys = Object.keys(def.palette);
  const palette = [];
  if (keys.length > SPRITE_LIMITS.maxColors) errors.push(`túl sok szín (${keys.length} > ${SPRITE_LIMITS.maxColors})`);
  for (const k of keys) {
    const c = parseColor(def.palette[k]);
    if (k.length !== 1) errors.push(`a paletta-kulcs nem egy karakter: '${k}'`);
    else if (k === '.' || k === ' ') errors.push(`foglalt paletta-kulcs (átlátszó): '${k}'`);
    else if (!c) errors.push(`hibás szín '${k}': ${String(def.palette[k])}`);
    palette.push(c);
  }
  const w = rows[0].length, h = rows.length, M = SPRITE_LIMITS.maxSize;
  if (w < 1 || w > M || h > M) errors.push(`érvénytelen méret: ${w}x${h} (1..${M})`);
  rows.forEach((r, y) => { if (r.length !== w) errors.push(`a ${y}. sor hossza ${r.length}, várt ${w}`); });
  if (errors.length) return fail();

  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') { px[y * w + x] = SPRITE_NONE; continue; }
      const i = keys.indexOf(ch);
      if (i < 0) errors.push(`ismeretlen karakter '${ch}' (${x},${y})`);
      else px[y * w + x] = i;
    }
  }
  const ax = def.ax === undefined ? Math.floor(w / 2) : def.ax;
  const ay = def.ay === undefined ? h : def.ay;
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || ax < 0 || ax > w || ay < 0 || ay > h) errors.push('a lábpont (ax, ay) a spriteon kívül van');
  const variants = {};
  if (def.variants !== undefined) {
    if (!isMap(def.variants)) errors.push('a variants nem objektum');
    else for (const name of Object.keys(def.variants)) variants[name] = checkColors(def.variants[name], keys, errors, `variáns '${name}'`);
  }
  if (errors.length) return fail();
  return { ok: true, errors: [], sprite: { id: def.id, w, h, px, keys, palette, ax, ay, variants } };
}

/** Paletta-csere (recolor): mapping {kulcs: szín}; a pixelek változatlanok. Hibás kulcs/szín -> null. Az eredeti érintetlen. */
export function swapPalette(sprite, mapping, id) {
  if (!sprite || !isMap(mapping)) return null;
  const errors = [];
  const colors = checkColors(mapping, sprite.keys, errors, 'csere');
  if (errors.length) return null;
  const palette = sprite.keys.map((k, i) => colors[k] || sprite.palette[i]);
  return { ...sprite, id: typeof id === 'string' && id ? id : sprite.id, px: sprite.px.slice(), palette, keys: sprite.keys.slice(), variants: {} };
}

/** Vízszintes tükrözés (ax is tükröződik). Az eredeti érintetlen. */
export function mirrorSprite(sprite, id) {
  if (!sprite) return null;
  const { w, h } = sprite, px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = sprite.px[y * w + (w - 1 - x)];
  return { ...sprite, id: typeof id === 'string' && id ? id : sprite.id, px, ax: w - sprite.ax, keys: sprite.keys.slice(), palette: sprite.palette.slice(), variants: {} };
}

/** Hiányzó sprite helyett: magenta/sötét sakktábla (4 px-es mezők). Hibás méret -> 16x16. */
export function placeholderSprite(w = PLACEHOLDER_SIZE, h = PLACEHOLDER_SIZE) {
  const M = SPRITE_LIMITS.maxSize, ok = (v) => Number.isFinite(v) && v >= 1;
  const W = ok(w) ? Math.min(Math.floor(w), M) : PLACEHOLDER_SIZE, H = ok(h) ? Math.min(Math.floor(h), M) : PLACEHOLDER_SIZE;
  const px = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = ((x >> 2) + (y >> 2)) & 1;
  return { id: 'placeholder', w: W, h: H, px, keys: ['a', 'b'], palette: ['#ff00ff', '#1a1a1a'], ax: Math.floor(W / 2), ay: H, variants: {} };
}

/** Szín egy pixelen (teszthez/diagnosztikához): normalizált hex | null (átlátszó / kívül). */
export function spritePixel(sprite, x, y) {
  if (!sprite || x < 0 || y < 0 || x >= sprite.w || y >= sprite.h) return null;
  const i = sprite.px[y * sprite.w + x];
  return i === SPRITE_NONE ? null : sprite.palette[i] || null;
}

// ---- nyilvántartás ----
export function createSpriteRegistry(defs) {
  const reg = { sprites: new Map(), errors: new Map(), derived: new Map(), missing: new Set(), dups: new Set() };
  if (defs) registerSprites(reg, defs);
  return reg;
}

/** Egy definíció felvétele; hibás -> false, az id hibalistát kap (a lekérés placeholdert ad). Duplikátum felülír + reg.dups. */
export function registerSprite(reg, def) {
  const r = compileSprite(def);
  const id = isMap(def) && typeof def.id === 'string' ? def.id : null;
  if (id === null) return false;
  if (reg.sprites.has(id) || reg.errors.has(id)) reg.dups.add(id);
  reg.sprites.delete(id); reg.errors.delete(id);
  for (const k of [...reg.derived.keys()]) if (k.startsWith(id + '|')) reg.derived.delete(k);
  if (r.ok) reg.sprites.set(id, r.sprite); else reg.errors.set(id, r.errors);
  return r.ok;
}

/** Tömb vagy {id: def} objektum (az id a kulcs, ha a def-ben nincs). -> az érvényesen felvettek száma. */
export function registerSprites(reg, defs) {
  let n = 0;
  const list = Array.isArray(defs) ? defs : isMap(defs) ? Object.keys(defs).map(k => (isMap(defs[k]) ? { id: k, ...defs[k] } : defs[k])) : [];
  for (const d of list) if (registerSprite(reg, d)) n++;
  return n;
}

function derive(reg, key, make) {
  let s = reg.derived.get(key);
  if (!s) {
    if (reg.derived.size >= SPRITE_LIMITS.maxDerived) reg.derived.clear();
    s = make();
    reg.derived.set(key, s);
  }
  return s;
}

/**
 * Lekérés: opts {variant, flipX, w, h (a placeholder mérete)} -> {sprite, missing, key}.
 * Ismeretlen/hibás id -> placeholder; ismeretlen variáns -> az alap sprite; mindkettő: missing = true, reg.missing-be kerül.
 * Ugyanarra a kérésre ugyanaz a sprite-objektum jön (a származtatottak gyorsítótárazva).
 */
export function getSpriteData(reg, id, opts = {}) {
  const o = isMap(opts) ? opts : {};
  const base = typeof id === 'string' ? reg.sprites.get(id) : undefined;
  if (!base) {
    reg.missing.add(String(id));
    const ph = derive(reg, `placeholder|${o.w}|${o.h}`, () => placeholderSprite(o.w, o.h));
    return { sprite: ph, missing: true, key: `placeholder|${ph.w}x${ph.h}` };
  }
  let sprite = base, missing = false;
  const vname = typeof o.variant === 'string' ? o.variant : '';
  if (vname) {
    if (Object.prototype.hasOwnProperty.call(base.variants, vname)) {
      sprite = derive(reg, `${id}|${vname}|0`, () => swapPalette(base, base.variants[vname], id));
    } else { missing = true; reg.missing.add(`${id}@${vname}`); }
  }
  const flip = o.flipX === true;
  if (flip) sprite = derive(reg, `${id}|${missing ? '' : vname}|1`, () => mirrorSprite(sprite, id));
  return { sprite, missing, key: `${id}|${missing ? '' : vname}|${flip ? 1 : 0}` };
}

/** Ellenőrzés (a tests.html és az S191/S192 számára): {ok, errors:[{id,msgs}], missing[], dups[]}. */
export function auditSprites(reg) {
  const errors = [...reg.errors].map(([id, msgs]) => ({ id, msgs }));
  return { ok: errors.length === 0 && reg.dups.size === 0, errors, missing: [...reg.missing], dups: [...reg.dups] };
}
