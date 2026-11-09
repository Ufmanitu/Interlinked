// test-sprite.js (S021): pixel-art sprite-DSL, nyilvántartás, placeholder, rajzolás, gyorsítótár.
import { test, assert, eq } from './test-index.js';
import {
  SPRITE_NONE, SPRITE_LIMITS, parseColor, colorCss, compileSprite, swapPalette, mirrorSprite, placeholderSprite, spritePixel,
  createSpriteRegistry, registerSprite, registerSprites, getSpriteData, auditSprites,
} from './world-sprite.js';
import { paintIndexed, spriteToCanvas, createSpriteCache, createSprites, getSprite, drawSprite, clearSpriteCache } from './render-sprite.js';
import { SPRITE_DEFS } from './data-sprites.js';
import { TILE_SIZE, TILE_DEFS, paintTile } from './world-tiles.js';

// Pixeleket rögzítő hamis canvas: a fillRect a css-színt írja a pixel-rácsba.
function rasterCanvas(w, h) {
  const pix = new Array(w * h).fill(null), calls = [];
  const ctx = {
    imageSmoothingEnabled: true, fillStyle: '',
    fillRect(x, y, rw, rh) {
      calls.push([x, y, rw, rh, this.fillStyle]);
      for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) if (x + i >= 0 && y + j >= 0 && x + i < w && y + j < h) pix[(y + j) * w + x + i] = this.fillStyle;
    },
    drawImage: (...a) => calls.push(['img', ...a]),
  };
  return { width: w, height: h, pix, calls, getContext: () => ctx };
}
const DEF = { id: 't', palette: { r: '#f00', g: '#00ff00' }, rows: ['r.g', 'gr.'], variants: { blue: { r: '#0000ff' } } };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const expectCss = (s, x, y) => { const c = spritePixel(s, x, y); return c === null ? null : colorCss(c); };

test('sprite: parseColor és colorCss', () => {
  eq(parseColor('#F00'), '#ff0000'); eq(parseColor('#00ff00'), '#00ff00'); eq(parseColor('#f008'), '#ff000088');
  eq(parseColor('#112233ff'), '#112233'); eq(parseColor('#11223344'), '#11223344');
  for (const bad of ['', 'red', '#12', '#12345', '#gggggg', 5, null, undefined, {}, '#ff00ff00ff']) eq(parseColor(bad), null, String(bad));
  eq(colorCss('#abc'), '#aabbcc'); eq(colorCss('#ff000080'), 'rgba(255,0,0,0.502)'); eq(colorCss('nem szín'), '#ff00ff');
});

test('sprite: compileSprite – méret, pixelek, átlátszó, lábpont, kulcsok, determinizmus', () => {
  const r = compileSprite(DEF), s = r.sprite;
  assert(r.ok && r.errors.length === 0, 'érvényes');
  eq(s.w, 3); eq(s.h, 2); eq(s.px.length, 6);
  assert(same(Array.from(s.px), [0, SPRITE_NONE, 1, 1, 0, SPRITE_NONE]), 'pixel-indexek');
  assert(same(s.keys, ['r', 'g']) && same(s.palette, ['#ff0000', '#00ff00']), 'paletta normalizálva');
  eq(s.ax, 1); eq(s.ay, 2); // alap: alul középen
  eq(spritePixel(s, 0, 0), '#ff0000'); eq(spritePixel(s, 1, 0), null); eq(spritePixel(s, 9, 9), null);
  assert(same(Array.from(compileSprite(DEF).sprite.px), Array.from(s.px)), 'determinisztikus');
  const str = compileSprite({ id: 'x', palette: { a: '#fff' }, rows: '\na.\n.a\n', ax: 0, ay: 0 });
  assert(str.ok && str.sprite.w === 2 && str.sprite.h === 2 && str.sprite.ax === 0, 'sztring-sorok, üres szélső sorok nélkül');
});

test('sprite: compileSprite – hibás definíciók (nem dob, hibaüzenet, nincs sprite)', () => {
  const P = { a: '#fff' };
  const big = 'a'.repeat(SPRITE_LIMITS.maxSize + 1);
  const many = {}; for (let i = 0; i < SPRITE_LIMITS.maxColors + 1; i++) many[String.fromCharCode(0x100 + i)] = '#fff';
  const bad = [
    null, 5, 'x', [], {}, { id: 'x' }, { id: '', palette: P, rows: ['a'] }, { id: 'x', palette: P }, { id: 'x', palette: P, rows: [] },
    { id: 'x', palette: P, rows: [1] }, { id: 'x', palette: P, rows: ['aa', 'a'] }, { id: 'x', palette: P, rows: ['a', 'aa'] }, { id: 'x', palette: P, rows: ['ab'] },
    { id: 'x', palette: { a: 'piros' }, rows: ['a'] }, { id: 'x', palette: { '.': '#fff' }, rows: ['.'] }, { id: 'x', palette: { ' ': '#fff' }, rows: ['a'] },
    { id: 'x', palette: { ab: '#fff' }, rows: ['a'] }, { id: 'x', palette: P, rows: [big] }, { id: 'x', palette: many, rows: ['a'] },
    { id: 'x', palette: P, rows: ['a'], ax: 9 }, { id: 'x', palette: P, rows: ['a'], ay: NaN }, { id: 'x', palette: P, rows: ['a'], variants: 5 },
    { id: 'x', palette: P, rows: ['a'], variants: { v: { b: '#fff' } } }, { id: 'x', palette: P, rows: ['a'], variants: { v: { a: 'x' } } },
    { id: 'x', palette: P, rows: Array(SPRITE_LIMITS.maxSize + 1).fill('a') },
  ];
  bad.forEach((d, i) => {
    const r = compileSprite(d);
    assert(!r.ok && r.sprite === null && r.errors.length > 0 && r.errors.length <= SPRITE_LIMITS.maxErrors, `hibás #${i} elutasítva`);
  });
  assert(compileSprite({ id: 'x', palette: P, rows: ['abababababababab'] }).errors.length <= SPRITE_LIMITS.maxErrors, 'hibalista korlátos');
});

test('sprite: compileSprite fuzz – sosem dob, az érvényes méretei helyesek', () => {
  let s = 12021;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const pool = [null, undefined, 0, -1, NaN, 'a', '#fff', '', [], {}, 'ab.', ['a.', '.a'], ['a'], { a: '#fff' }, { a: 5 }, true];
  let okCount = 0;
  for (let i = 0; i < 400; i++) {
    const d = {};
    for (const k of ['id', 'palette', 'rows', 'ax', 'ay', 'variants']) if (rnd() < 0.8) d[k] = pool[Math.floor(rnd() * pool.length)];
    if (rnd() < 0.3) { d.id = 'f'; d.palette = { a: '#fff' }; d.rows = ['a.', '.a']; }
    const r = compileSprite(d);
    if (r.ok) { okCount++; eq(r.sprite.px.length, r.sprite.w * r.sprite.h); }
  }
  assert(okCount > 0, 'volt érvényes eset is');
});

test('sprite: swapPalette – csak a paletta változik, az eredeti érintetlen, hibás csere null', () => {
  const s = compileSprite(DEF).sprite, v = swapPalette(s, { r: '#0000ff' }, 't2');
  eq(v.id, 't2'); eq(v.palette[0], '#0000ff'); eq(v.palette[1], '#00ff00'); assert(same(Array.from(v.px), Array.from(s.px)) && v.px !== s.px, 'pixelek azonosak, másolat');
  eq(s.palette[0], '#ff0000');
  eq(swapPalette(s, { q: '#fff' }, 'x'), null); eq(swapPalette(s, { r: 'nem' }, 'x'), null); eq(swapPalette(s, null, 'x'), null); eq(swapPalette(null, {}, 'x'), null);
});

test('sprite: mirrorSprite – pixelek, lábpont, kétszer = eredeti, az eredeti érintetlen', () => {
  const s = compileSprite(DEF).sprite, m = mirrorSprite(s);
  assert(same(Array.from(m.px), [1, SPRITE_NONE, 0, SPRITE_NONE, 0, 1]), 'tükrözött pixelek');
  eq(m.ax, s.w - s.ax); eq(m.ay, s.ay);
  assert(same(Array.from(mirrorSprite(m).px), Array.from(s.px)) && mirrorSprite(m).ax === s.ax, 'kétszer = eredeti');
  assert(same(Array.from(s.px), [0, SPRITE_NONE, 1, 1, 0, SPRITE_NONE]), 'eredeti érintetlen');
  eq(mirrorSprite(null), null);
});

test('sprite: placeholderSprite – méret, sakktábla, hibás méret -> 16x16', () => {
  const p = placeholderSprite(8, 8);
  eq(p.w, 8); eq(p.h, 8); eq(spritePixel(p, 0, 0), '#ff00ff'); eq(spritePixel(p, 4, 0), '#1a1a1a'); eq(spritePixel(p, 0, 4), '#1a1a1a'); eq(spritePixel(p, 4, 4), '#ff00ff'); eq(spritePixel(p, 0, 8), null);
  for (const bad of [NaN, 0, -3, undefined, 'x', Infinity]) { const q = placeholderSprite(bad, bad); assert(q.w >= 1 && q.h >= 1 && q.w <= SPRITE_LIMITS.maxSize, 'hibás méret: ' + bad); }
  eq(placeholderSprite().w, 16); eq(placeholderSprite(9999, 9999).w, SPRITE_LIMITS.maxSize);
});

test('sprite: nyilvántartás – felvétel, duplikátum, hiba, objektum/tömb forma, újradefiniálás', () => {
  const reg = createSpriteRegistry();
  eq(registerSprite(reg, DEF), true); eq(reg.dups.size, 0);
  eq(registerSprite(reg, { ...DEF, rows: ['rr', 'gg'] }), true); assert(reg.dups.has('t'), 'duplikátum jelezve');
  eq(registerSprite(reg, { id: 'bad', palette: {}, rows: ['x'] }), false); assert(reg.errors.has('bad') && !reg.sprites.has('bad'), 'hiba tárolva');
  eq(registerSprite(reg, 5), false); eq(registerSprite(reg, { rows: ['a'] }), false);
  eq(registerSprites(reg, { b: { palette: { a: '#fff' }, rows: ['a'] }, c: 7 }), 1); assert(reg.sprites.has('b'), 'id a kulcsból');
  eq(registerSprites(reg, [{ id: 'd', palette: { a: '#fff' }, rows: ['a'] }, null]), 1); eq(registerSprites(reg, 'x'), 0);
  eq(registerSprite(reg, { id: '__proto__', palette: { a: '#fff' }, rows: ['a'] }), true);
  assert(getSpriteData(reg, 'toString').missing && getSpriteData(reg, 'constructor').missing, 'prototípus-kulcs nem találat');
  assert(!auditSprites(reg).ok && auditSprites(reg).errors.some(e => e.id === 'bad') && auditSprites(reg).dups.includes('t'), 'audit');
  const r2 = createSpriteRegistry([DEF]), before = getSpriteData(r2, 't', { variant: 'blue' }).sprite;
  registerSprite(r2, { ...DEF, variants: { blue: { r: '#101010' } } });
  assert(getSpriteData(r2, 't', { variant: 'blue' }).sprite !== before && getSpriteData(r2, 't', { variant: 'blue' }).sprite.palette[0] === '#101010', 'újradefiniálás törli a származtatottakat');
});

test('sprite: getSpriteData – alap, variáns, tükrözés, hiányzó id/variáns, gyorsítótár', () => {
  const reg = createSpriteRegistry([DEF]);
  const a = getSpriteData(reg, 't'), b = getSpriteData(reg, 't', { variant: 'blue' }), f = getSpriteData(reg, 't', { flipX: true }), bf = getSpriteData(reg, 't', { variant: 'blue', flipX: true });
  assert(!a.missing && !b.missing && !f.missing, 'nem hiányzó');
  assert(new Set([a.key, b.key, f.key, bf.key]).size === 4, 'külön kulcsok');
  eq(b.sprite.palette[0], '#0000ff'); eq(a.sprite.palette[0], '#ff0000');
  eq(spritePixel(f.sprite, 0, 0), spritePixel(a.sprite, 2, 0)); eq(bf.sprite.palette[0], '#0000ff'); eq(spritePixel(bf.sprite, 2, 0), '#0000ff');
  assert(getSpriteData(reg, 't', { variant: 'blue' }).sprite === b.sprite && getSpriteData(reg, 't').sprite === a.sprite, 'ugyanaz az objektum');
  const nv = getSpriteData(reg, 't', { variant: 'nincs', flipX: true });
  assert(nv.missing && reg.missing.has('t@nincs') && spritePixel(nv.sprite, 0, 0) === spritePixel(f.sprite, 0, 0), 'ismeretlen variáns -> az alap (tükrözve), missing');
  const m = getSpriteData(reg, 'zzz', { w: 24, h: 8 });
  assert(m.missing && m.sprite.w === 24 && m.sprite.h === 8 && reg.missing.has('zzz'), 'ismeretlen id -> placeholder a kért méretben');
  for (const bad of [null, undefined, 5, {}, [], NaN]) assert(getSpriteData(reg, bad).missing, 'hibás id: ' + String(bad));
  for (const bad of [null, 'x', 5, []]) assert(!getSpriteData(reg, 't', bad).missing, 'hibás opts: ' + String(bad));
});

test('sprite: SPRITE_DEFS (data-sprites.js) – minden sprite érvényes, a variánsok is', () => {
  const reg = createSpriteRegistry(SPRITE_DEFS), a = auditSprites(reg);
  assert(a.ok, 'audit: ' + JSON.stringify(a.errors));
  const ids = Object.keys(SPRITE_DEFS); eq(reg.sprites.size, ids.length); assert(ids.length >= 2, 'van példa-adat');
  for (const id of ids) for (const v of Object.keys(SPRITE_DEFS[id].variants || {})) assert(!getSpriteData(reg, id, { variant: v }).missing, `${id}@${v}`);
  eq(reg.missing.size, 0);
});

test('sprite: paintIndexed / spriteToCanvas – azonos színű szakaszok, átlátszó kimarad, pixelpontos', () => {
  const s = compileSprite({ id: 'p', palette: { r: '#f00', g: '#0f0' }, rows: ['rrg', '.gg'] }).sprite;
  const c = rasterCanvas(3, 2), n = paintIndexed(c.getContext('2d'), s.px, s.w, s.h, s.palette.map(colorCss), 0, 0);
  eq(n, 3); eq(c.calls.length, 3);
  assert(c.pix[0] === '#ff0000' && c.pix[1] === '#ff0000' && c.pix[2] === '#00ff00' && c.pix[3] === null && c.pix[4] === '#00ff00', 'pixelek');
  const k = spriteToCanvas(compileSprite(DEF).sprite, rasterCanvas), ctx = k.getContext('2d');
  eq(ctx.imageSmoothingEnabled, false); eq(k.width, 3); eq(k.height, 2);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) eq(k.pix[y * 3 + x], expectCss(compileSprite(DEF).sprite, x, y), `(${x},${y})`);
  const t = rasterCanvas(4, 4); paintIndexed(t.getContext('2d'), s.px, 3, 2, ['#111111', '#222222'], 1, 2);
  assert(t.pix[2 * 4 + 1] === '#111111' && t.pix[0] === null, 'eltolás');
  eq(paintIndexed(t.getContext('2d'), new Uint8Array([7]), 1, 1, ['#000000']), 0); // ismeretlen index: kimarad
});

test('sprite: a tile-pixelek (paintTile) ugyanazzal a rajzolóval pixelre azonosan jelennek meg', () => {
  for (const d of TILE_DEFS) {
    for (let v = 0; v < d.variants; v++) {
      const px = paintTile(d.id, v), c = rasterCanvas(TILE_SIZE + 4, TILE_SIZE + 2);
      paintIndexed(c.getContext('2d'), px, TILE_SIZE, TILE_SIZE, d.palette, 4, 2);
      for (let y = 0; y < TILE_SIZE; y++) for (let x = 0; x < TILE_SIZE; x++) {
        if (c.pix[(y + 2) * (TILE_SIZE + 4) + x + 4] !== d.palette[px[y * TILE_SIZE + x]]) throw new Error(`${d.key} v${v} (${x},${y})`);
      }
    }
  }
});

test('sprite: gyorsítótár – találat, LRU-kiszorítás, placeholder, törlés', () => {
  const reg = createSpriteRegistry([DEF]), cache = createSpriteCache(reg, { maxEntries: 3, makeCanvas: rasterCanvas });
  const e1 = getSprite(cache, 't'); assert(getSprite(cache, 't') === e1 && cache.stats.built === 1 && cache.stats.hits === 1, 'találat ugyanaz az elem');
  getSprite(cache, 't', { variant: 'blue' }); getSprite(cache, 't', { flipX: true });
  getSprite(cache, 't'); // a 't' friss lesz, a 'blue' a legrégebbi
  getSprite(cache, 't', { variant: 'blue', flipX: true });
  eq(cache.entries.size, 3); eq(cache.stats.evicted, 1);
  const built = cache.stats.built; getSprite(cache, 't'); eq(cache.stats.built, built); // a 't' megmaradt
  getSprite(cache, 't', { variant: 'blue' }); eq(cache.stats.built, built + 1); // a kiszorított újraépül
  const ph = getSprite(cache, 'nincs', { w: 12, h: 6 });
  assert(ph.missing && ph.w === 12 && ph.h === 6 && ph.canvas.width === 12 && cache.stats.missing === 1, 'placeholder');
  clearSpriteCache(cache); eq(cache.entries.size, 0);
  eq(createSpriteCache(null, { maxEntries: NaN }).cfg.maxEntries, 256); eq(createSpriteCache(null, { maxEntries: 0 }).cfg.maxEntries, 256);
  eq(createSpriteCache(null, { maxEntries: 5.9 }).cfg.maxEntries, 5);
});

test('sprite: drawSprite – lábpont, kerekítés, hiányzó -> false, hibás koordináta, 2D kontextus nélkül sem dob', () => {
  const cache = createSprites(SPRITE_DEFS, { makeCanvas: rasterCanvas }), out = rasterCanvas(1, 1), ctx = out.getContext('2d');
  eq(drawSprite(ctx, cache, 'icon.coin', 10.4, 20.6), true);
  const call = out.calls.find(c => c[0] === 'img'); eq(call[2], 5); eq(call[3], 16); // 10-5, 21-5
  eq(drawSprite(ctx, cache, 'nincs', 3, 3), false); eq(out.calls.filter(c => c[0] === 'img').length, 2);
  eq(drawSprite(ctx, cache, 'icon.coin', NaN, 1), true); eq(drawSprite(ctx, cache, 'icon.coin', 1, Infinity), true); eq(out.calls.filter(c => c[0] === 'img').length, 2);
  const noCtx = createSpriteCache(createSpriteRegistry([DEF]), { makeCanvas: () => ({ getContext: () => null }) });
  eq(getSprite(noCtx, 't').missing, false); eq(getSprite(noCtx, 'x').missing, true);
});

test('sprite: smoke – 600 kocka véletlen sprite/variáns/tükrözés kéréssel, kis gyorsítótárral', () => {
  const cache = createSprites(SPRITE_DEFS, { makeCanvas: rasterCanvas, maxEntries: 8 }), out = rasterCanvas(1, 1), ctx = out.getContext('2d');
  const ids = ['icon.shard', 'icon.coin', 'nincs', '', 'x.y'], vs = ['', 'frost', 'ember', 'silver', 'nope'];
  let s = 12022, calls = 0, real = 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let f = 0; f < 600; f++) {
    const o = { variant: vs[Math.floor(rnd() * vs.length)], flipX: rnd() < 0.5, w: 1 + Math.floor(rnd() * 40), h: 1 + Math.floor(rnd() * 40) };
    if (drawSprite(ctx, cache, ids[Math.floor(rnd() * ids.length)], rnd() * 960, rnd() * 540, o)) real++;
    calls++;
    assert(cache.entries.size <= 8, 'a gyorsítótár korlátos');
  }
  eq(cache.stats.built + cache.stats.hits, calls); assert(real > 0 && real < calls, 'van valódi és placeholder rajz is');
  for (const e of cache.entries.values()) assert(e.w >= 1 && e.h >= 1 && Number.isFinite(e.ax) && Number.isFinite(e.ay), 'érvényes elemek');
});
