// test-paperdoll.js (S064): a paperdoll automata tesztjei (adat, irány/animáció, kinézet, rajz-rács, tükrözés, cache, rajz-hívások, 600 kockás füst-teszt).
import { test, assert, eq } from './test-index.js';
import { DOLL_CONFIG as C, DOLL_RACES, DOLL_CLASSES, DOLL_HAIR_STYLES } from './data-paperdoll.js';
import { RACE_DEFS, CLASS_DEFS } from './data-character.js';
import { dirOf, createAnim, stepAnim, frameAt, appearanceOf, renderDollRows, dollDef, dollId, shade } from './game-paperdoll.js';
import { compileSprite, spritePixel, parseColor } from './world-sprite.js';
import { createPaperdoll, sharedPaperdoll, resetSharedPaperdoll, appearanceFor, ensureDoll, drawDoll, drawPlayerDoll, drawPreviewDoll } from './render-paperdoll.js';
import { drawPreview } from './render-charselect.js';
import { createPlayer } from './game-player.js';

const RACES = Object.keys(DOLL_RACES), CLASSES = Object.keys(DOLL_CLASSES);
const stubCanvas = (w, h) => ({ width: w, height: h, getContext: () => null });
const recCtx = () => { const calls = []; return { calls, imageSmoothingEnabled: true, fillStyle: '', fillRect: (...a) => calls.push(['rect', ...a]), drawImage: (...a) => calls.push(['img', ...a]) }; };
const pdoll = (o = {}) => createPaperdoll({ makeCanvas: stubCanvas, ...o });

test('paperdoll: az adat lefedi az összes fajt és kasztot, érvényes színekkel', () => {
  eq(RACES.slice().sort().join(), RACE_DEFS.map(r => r.id).sort().join(), 'fajok');
  eq(CLASSES.slice().sort().join(), CLASS_DEFS.map(c => c.id).sort().join(), 'kasztok');
  for (const r of RACES) for (const k of ['skin', 'skinDark', 'hairColor']) assert(parseColor(DOLL_RACES[r][k]), `${r}.${k}`);
  for (const c of CLASSES) for (const k of ['cloth', 'dark', 'trim', 'pants', 'boots', 'metal']) assert(parseColor(DOLL_CLASSES[c][k]), `${c}.${k}`);
  for (const r of RACES) { const l = DOLL_RACES[r]; assert(l.hw % 2 === 0 && l.tw % 2 === 0, 'páros szélesség (szimmetria): ' + r); }
  assert(DOLL_HAIR_STYLES.includes('default') && C.seq.every(f => f >= 0 && f < C.frames), 'seq');
});

test('paperdoll: dirOf (4 irány, nulla/hibás -> az előző, alap down)', () => {
  eq(dirOf({ x: 1, y: 0 }), 'right'); eq(dirOf({ x: -1, y: 0 }), 'left'); eq(dirOf({ x: 0, y: -1 }), 'up'); eq(dirOf({ x: 0, y: 1 }), 'down');
  eq(dirOf({ x: 0.3, y: -0.9 }), 'up'); eq(dirOf({ x: -0.9, y: 0.3 }), 'left');
  eq(dirOf({ x: 0, y: 0 }, 'left'), 'left'); eq(dirOf({ x: 1, y: 1 }, 'up'), 'up'); eq(dirOf(null), 'down'); eq(dirOf({ x: NaN, y: 1 }, 'right'), 'right');
  eq(dirOf(undefined, 'ismeretlen'), 'down'); eq(dirOf('x', 'up'), 'up');
});

test('paperdoll: stepAnim (álló = 0, mozgás = ciklus, megállás = 0, hibás bemenet nem dob)', () => {
  const a = createAnim(), p = { vx: 0, vy: 0 };
  stepAnim(a, p, { x: 0, y: 1 }, 1 / 60); eq(a.frame, 0); eq(a.moving, false); eq(a.dir, 'down');
  p.vx = 120; const seen = [];
  for (let i = 0; i < 120; i++) { stepAnim(a, p, { x: 1, y: 0 }, 1 / 60); seen.push(a.frame); }
  eq(a.dir, 'right'); eq(a.moving, true);
  assert(seen.includes(1) && seen.includes(2) && seen.includes(0), 'mindhárom kocka előfordul: ' + [...new Set(seen)]);
  eq(seen[0], 1, 'az első mozgó kocka már lépés');
  for (let i = 1; i < seen.length; i++) assert(seen[i] !== undefined && C.seq.includes(seen[i]));
  p.vx = 0; stepAnim(a, p, { x: 1, y: 0 }, 1 / 60); eq(a.frame, 0); eq(a.moving, false); eq(a.t, 0);
  p.vx = 3; stepAnim(a, p, null, 1 / 60); eq(a.moving, false, 'a minSpeed alatt áll');
  p.vx = NaN; stepAnim(a, p, null, NaN); eq(a.frame, 0);
  const b = stepAnim(null, null, null, 1 / 60); assert(b && b.dir === 'down' && b.frame === 0, 'hibás anim -> új');
});

test('paperdoll: a séta sebességgel arányosan lép (gyorsabb = több kocka-váltás)', () => {
  const run = (v) => { const a = createAnim(), p = { vx: v, vy: 0 }; let ch = 0, last = -1; for (let i = 0; i < 180; i++) { stepAnim(a, p, { x: 1, y: 0 }, 1 / 60); if (a.frame !== last) ch++; last = a.frame; } return ch; };
  assert(run(120) > run(40), 'gyorsabb -> több váltás');
  assert(run(40) > 0);
});

test('paperdoll: frameAt (előnézet-ciklus)', () => {
  eq(frameAt(0), 0); eq(frameAt(C.previewTime * 1.1), C.seq[1]); eq(frameAt(C.previewTime * 3.5), C.seq[3]); eq(frameAt(C.previewTime * 4.2), C.seq[0]);
  eq(frameAt(-5), 0); eq(frameAt(NaN), 0);
});

test('paperdoll: appearanceOf (ismeretlen/prototípus-kulcs -> semleges, opciók szűrve, fagyasztott)', () => {
  const a = appearanceOf('dwarf', 'warrior');
  eq(a.race, 'dwarf'); eq(a.cls, 'warrior'); eq(a.hairStyle, DOLL_RACES.dwarf.hairStyle); assert(Object.isFrozen(a));
  for (const bad of ['constructor', '__proto__', 'toString', 'ismeretlen', '', null, undefined, 5]) { const x = appearanceOf(bad, bad); eq(x.race, 'x'); eq(x.cls, 'x'); assert(x.look && x.c && x.key.startsWith('x.x.'), String(bad)); }
  eq(appearanceOf('elf', 'wizard', { hairStyle: 'bald' }).hairStyle, 'bald');
  eq(appearanceOf('elf', 'wizard', { hairStyle: 'default' }).hairStyle, DOLL_RACES.elf.hairStyle);
  eq(appearanceOf('elf', 'wizard', { hairStyle: 'nincs' }).hairStyle, DOLL_RACES.elf.hairStyle);
  eq(appearanceOf('elf', 'wizard', { hairColor: 'piros' }).hair, DOLL_RACES.elf.hairColor);
  eq(appearanceOf('elf', 'wizard', { hairColor: '#C0392B' }).hair, '#c0392b');
  eq(appearanceOf('elf', 'wizard', { skin: '#336699' }).skin, '#336699');
  const keys = new Set(); for (const r of RACES) for (const k of CLASSES) keys.add(appearanceOf(r, k).key);
  eq(keys.size, RACES.length * CLASSES.length, 'minden kombináció külön kulcs');
  eq(shade('#808080', 0.5), '#404040'); eq(shade('rossz', 0.5), '#808080');
});

test('paperdoll: minden faj x kaszt x irány x kocka érvényes sprite (méret, paletta, margó, pixelek)', () => {
  let n = 0;
  for (const r of RACES) for (const k of CLASSES) {
    const app = appearanceOf(r, k);
    for (const d of C.dirs) for (let f = 0; f < C.frames; f++) {
      const res = renderDollRows(app, d, f), tag = `${r}/${k}/${d}/${f}`;
      eq(res.rows.length, C.h, tag + ' magasság');
      assert(res.rows.every(row => row.length === C.w), tag + ' szélesség');
      assert(Object.keys(res.palette).length <= 62, tag + ' szín-szám');
      for (const row of res.rows) for (const ch of row) assert(ch === '.' || res.palette[ch], tag + ' paletta ' + ch);
      const edgeOk = (ch) => ch === '.' || res.palette[ch] === '#14100c'; // a szélső sorban/oszlopban csak körvonal lehet (a figura nincs levágva)
      assert([...res.rows[0]].every(edgeOk), tag + ' felső margó (levágott figura)');
      assert(res.rows.every(row => edgeOk(row[0]) && edgeOk(row[C.w - 1])), tag + ' oldalsó margó');
      const cs = compileSprite(dollDef(app, d, f)); assert(cs.ok, tag + ' compile: ' + cs.errors.join('; '));
      let solid = 0; for (let y = 0; y < C.h; y++) for (let x = 0; x < C.w; x++) { const c = spritePixel(cs.sprite, x, y); if (c && c.length === 7) solid++; }
      assert(solid > 150, tag + ' elég pixel: ' + solid);
      eq(cs.sprite.ax, C.ax); eq(cs.sprite.ay, C.ay); n++;
    }
  }
  eq(n, RACES.length * CLASSES.length * C.dirs.length * C.frames);
});

test('paperdoll: a lábak a lábpontnál érnek földet (álló kockán a legalsó tömör sor = ay-1)', () => {
  for (const r of RACES) for (const k of CLASSES) for (const d of C.dirs) {
    const cs = compileSprite(dollDef(appearanceOf(r, k), d, 0)).sprite; let low = -1;
    for (let y = 0; y < C.h; y++) for (let x = 0; x < C.w; x++) { const c = spritePixel(cs, x, y); if (c && c.length === 7 && c !== '#14100c') low = Math.max(low, y); }
    eq(low, C.ay - 1, `${r}/${k}/${d}`);
  }
});

test('paperdoll: a right a left pontos tükörképe; az irányok és a képkockák különböznek', () => {
  for (const r of RACES) for (const k of CLASSES) for (let f = 0; f < C.frames; f++) {
    const app = appearanceOf(r, k), L = compileSprite(dollDef(app, 'left', f)).sprite, R = compileSprite(dollDef(app, 'right', f)).sprite;
    for (let y = 0; y < C.h; y++) for (let x = 0; x < C.w; x++) eq(spritePixel(R, x, y), spritePixel(L, C.w - 1 - x, y), `${r}/${k}/${f} (${x},${y})`);
  }
  const app = appearanceOf('orc', 'ranger'), sig = (d, f) => renderDollRows(app, d, f).rows.join('|') + JSON.stringify(renderDollRows(app, d, f).palette);
  const all = new Set(); for (const d of C.dirs) for (let f = 0; f < C.frames; f++) all.add(sig(d, f));
  eq(all.size, C.dirs.length * C.frames, 'mind a 12 kép különböző');
});

test('paperdoll: a faj és a kaszt látszik (más faj/kaszt = más kép), a haj-opció is', () => {
  const sig = (a) => { const r = renderDollRows(a, 'down', 1); return r.rows.join('|') + JSON.stringify(r.palette); };
  const seen = new Set(); for (const r of RACES) for (const k of CLASSES) seen.add(sig(appearanceOf(r, k)));
  eq(seen.size, RACES.length * CLASSES.length);
  assert(sig(appearanceOf('elf', 'healer', { hairStyle: 'bald' })) !== sig(appearanceOf('elf', 'healer')), 'kopasz != alap');
  assert(sig(appearanceOf('elf', 'healer', { hairColor: '#2c4a8a' })) !== sig(appearanceOf('elf', 'healer')), 'hajszín');
  for (const st of DOLL_HAIR_STYLES) for (const d of C.dirs) assert(compileSprite(dollDef(appearanceOf('dwarf', 'wizard', { hairStyle: st }), d, 1)).ok, 'haj: ' + st);
  const x = appearanceOf('ismeretlen', 'ismeretlen'); for (const d of C.dirs) assert(compileSprite(dollDef(x, d, 2)).ok, 'semleges ' + d);
});

test('paperdoll: determinisztikus, dollId normalizál (hibás irány/kocka -> down/0)', () => {
  const app = appearanceOf('dwarf', 'healer');
  eq(JSON.stringify(renderDollRows(app, 'up', 2)), JSON.stringify(renderDollRows(app, 'up', 2)));
  eq(dollId(app, 'ismeretlen', 7), dollId(app, 'down', 0)); eq(dollId(app, 'left', 1.5), dollId(app, 'left', 0));
  assert(dollId(app, 'left', 1).startsWith('doll.dwarf.healer.'));
  eq(JSON.stringify(renderDollRows(app, 'x', -3)), JSON.stringify(renderDollRows(app, 'down', 0)));
});

test('paperdoll: a cache lustán épít, újrahasznál, és az összes kombináció belefér (nincs kiszorítás)', () => {
  const pd = pdoll();
  eq(pd.stats.defs, 0);
  const app = appearanceOf('dwarf', 'warrior');
  const id = ensureDoll(pd, app, 'down', 0); eq(pd.stats.defs, 1); eq(ensureDoll(pd, app, 'down', 0), id); eq(pd.stats.defs, 1);
  const ctx = recCtx(); assert(drawDoll(ctx, pd, app, 'down', 0, 100, 100), 'valódi figura'); eq(pd.cache.stats.built, 1); drawDoll(ctx, pd, app, 'down', 0, 100, 100); eq(pd.cache.stats.built, 1); eq(pd.cache.stats.hits, 1);
  for (const r of RACES) for (const k of CLASSES) for (const d of C.dirs) for (let f = 0; f < C.frames; f++) drawDoll(ctx, pd, appearanceOf(r, k), d, f, 0, 0);
  eq(pd.cache.stats.evicted, 0, 'nincs kiszorítás'); eq(pd.cache.stats.missing, 0, 'nincs hiányzó');
  eq(pd.cache.entries.size, RACES.length * CLASSES.length * C.dirs.length * C.frames);
  eq(pd.cache.reg.errors.size, 0);
});

test('paperdoll: drawPlayerDoll a lábpontra rajzol (p.y + h/2), kamera-offsettel; hibás bemenet nem dob', () => {
  const pd = pdoll(), ctx = recCtx(), p = createPlayer(0, 200, 150); p.race = 'elf'; p.class = 'wizard';
  const an = createAnim();
  assert(drawPlayerDoll(ctx, pd, p, an, 100, 50));
  const img = ctx.calls.find(c => c[0] === 'img');
  eq(img[2], Math.round(200 - 100) - C.ax, 'x'); eq(img[3], Math.round(150 + p.h / 2 - 50) - C.ay, 'y');
  eq(drawPlayerDoll(null, pd, p, an, 0, 0), false); eq(drawPlayerDoll(ctx, pd, null, an, 0, 0), false); eq(drawPlayerDoll(ctx, pd, p, null, 0, 0), false);
  const q = createPlayer(1, 0, 0); // faj/kaszt nélkül is rajzol (semleges alak)
  assert(drawPlayerDoll(ctx, pd, q, createAnim(), 0, 0));
  q.race = 'constructor'; q.class = '__proto__'; assert(drawPlayerDoll(ctx, pd, q, createAnim(), 0, 0));
  assert(drawPlayerDoll(ctx, pd, { x: NaN, y: NaN, race: 'orc' }, createAnim(), 0, 0) !== undefined);
  eq(appearanceFor(pd, p), appearanceFor(pd, p), 'ugyanaz az objektum');
  eq(appearanceFor(pd, { race: 'orc', class: 'ranger', look: { hairStyle: 'bald' } }).hairStyle, 'bald');
});

test('paperdoll: drawPreviewDoll (2x, lefelé néz; kép nélküli vászon -> hamis) és a karakterválasztó előnézete', () => {
  const pd = pdoll(), ctx = recCtx();
  assert(drawPreviewDoll(ctx, pd, 'orc', 'warrior', 10, 20, 0));
  const img = ctx.calls.find(c => c[0] === 'img'); eq(img.slice(2).join(), [10, 20, C.w * 2, C.h * 2].join());
  eq(ctx.imageSmoothingEnabled, true, 'a simítás visszaáll');
  eq(drawPreviewDoll({ fillRect() {} }, pd, 'orc', 'warrior', 0, 0), false); eq(drawPreviewDoll(null, pd, 'orc', 'warrior', 0, 0), false);
  assert(drawPreviewDoll(ctx, pd, 'ismeretlen', 'ismeretlen', 0, 0));
  resetSharedPaperdoll(); const s = sharedPaperdoll(); eq(sharedPaperdoll(), s, 'közös példány');
  const c2 = recCtx(); drawPreview(c2, 0, 0, 'elf', 'ranger'); assert(c2.calls.some(c => c[0] === 'img'), 'paperdoll az előnézetben');
  const c3 = { calls: [], fillStyle: '', fillRect(...a) { this.calls.push(a); } }; drawPreview(c3, 0, 0, 'elf', 'ranger'); assert(c3.calls.length >= 5, 'kép nélkül a helyőrző figura');
  resetSharedPaperdoll();
});

test('paperdoll: smoke — 600 kocka két szkriptelt játékossal, nincs kivétel, érvényes irány/kocka, a cache nem nő végtelenül', () => {
  const pd = pdoll({ maxEntries: 40 }), ctx = recCtx(), ps = [createPlayer(0, 0, 0), createPlayer(1, 50, 0)], an = [createAnim(), createAnim()];
  ps[0].race = 'dwarf'; ps[0].class = 'warrior'; ps[1].race = 'elf'; ps[1].class = 'ranger';
  const dirs = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 0 }];
  const frames = new Set();
  for (let i = 0; i < 600; i++) {
    for (let j = 0; j < 2; j++) {
      const f = dirs[(Math.floor(i / 50) + j) % dirs.length], sp = f.x || f.y ? 100 : 0;
      ps[j].vx = f.x * sp; ps[j].vy = f.y * sp; ps[j].x += ps[j].vx / 60; ps[j].y += ps[j].vy / 60;
      stepAnim(an[j], ps[j], f.x || f.y ? f : null, 1 / 60);
      assert(C.dirs.includes(an[j].dir) && an[j].frame >= 0 && an[j].frame < C.frames && Number.isFinite(an[j].t), 'állapot ' + i);
      assert(drawPlayerDoll(ctx, pd, ps[j], an[j], ps[0].x - 100, ps[0].y - 100), 'rajz ' + i); frames.add(an[j].frame);
    }
  }
  eq(frames.size, 3); assert(pd.cache.entries.size <= 40, 'cache-korlát'); assert(ctx.calls.length >= 1200);
});

test('paperdoll: az új modulok betölthetők (smoke-import)', async () => {
  for (const m of ['./data-paperdoll.js', './game-paperdoll.js', './render-paperdoll.js']) assert(Object.keys(await import(m)).length > 0, m);
});
