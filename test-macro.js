// S020: makrótérkép-formátum, betöltő és mikroréteg tesztjei.
import { test, assert } from './test-index.js';
import { T } from './world-tiles.js';
import { MACRO_MAP, MACRO_TEXTS, MACRO_VERSION } from './data-macro.js';
import {
  sanitizeMacro, loadMacroMap, regionAt, routeAt, poiAt, entranceAt, macroTile,
  featuresInChunk, microChunk, registerMacroTexts, MICRO_TYPES, MACRO_CHUNK,
} from './world-macro.js';

const SEED = 12014;
const clone = (o) => JSON.parse(JSON.stringify(o));
const mm = loadMacroMap(MACRO_MAP);
const count = (list, type) => list.filter((o) => o.type === type).length;

test('macro: az alapadat hibátlanul betöltődik', () => {
  assert(mm.errors.length === 0, 'hibák: ' + mm.errors.join('; '));
  assert(mm.regions.length === 2 && mm.routes.length === 2 && mm.pois.length === 2 && mm.entrances.length === 1, 'darabszámok');
  assert(mm.byId.regions.meadow && mm.byId.entrances.meadow_mine, 'byId');
});

test('macro: minden nameKey le van fordítva HU és EN nyelven, azonos kulcsokkal', () => {
  const hu = Object.keys(MACRO_TEXTS.hu).sort(), en = Object.keys(MACRO_TEXTS.en).sort();
  assert(hu.join() === en.join(), 'HU/EN kulcsok eltérnek');
  for (const k of ['regions', 'routes', 'pois', 'entrances']) for (const it of mm[k]) assert(MACRO_TEXTS.hu[it.nameKey] && MACRO_TEXTS.en[it.nameKey], 'hiányzó szöveg: ' + it.nameKey);
  let got = null;
  assert(registerMacroTexts((t) => { got = t; }) === MACRO_TEXTS && got === MACRO_TEXTS, 'registerMacroTexts');
});

test('macro: a hibás adat kiesik hibajelzéssel, nem dob', () => {
  const d = clone(MACRO_MAP);
  d.regions.push({ id: 'meadow', nameKey: 'x', rect: { tx0: 0, ty0: 0, tx1: 1, ty1: 1 } });
  d.regions.push({ id: 'badrect', nameKey: 'x', rect: { tx0: 5, ty0: 0, tx1: 5, ty1: 1 } });
  d.regions.push({ id: 'badmicro', nameKey: 'x', rect: { tx0: 0, ty0: 0, tx1: 9, ty1: 9 }, micro: { tree: 0.6 } });
  d.routes.push({ id: 'r1', nameKey: 'x', width: 2, points: [{ tx: 0, ty: 0 }, { tx: 1, ty: 1 }] });
  d.routes.push({ id: 'r2', nameKey: 'x', width: 1, points: [{ tx: 0, ty: 0 }] });
  d.routes.push({ id: 'r3', nameKey: 'x', width: 1, points: [{ tx: 0, ty: 0 }, { tx: NaN, ty: 1 }] });
  d.pois.push({ id: 'p1', nameKey: 'x', type: 'a', tx: 0, ty: 0, r: 0, clear: true });
  d.pois.push({ id: 'p2', nameKey: 'x', type: 'a', tx: 'x', ty: 0 });
  d.entrances.push({ id: 'e1', nameKey: 'x', kind: 'castle', tx: 0, ty: 0, target: 't' });
  d.entrances.push({ id: 'e2', nameKey: 'x', kind: 'mine', tx: 0, ty: 0, target: '' });
  d.entrances.push({ id: 'e3', nameKey: 'x', kind: 'mine', tx: 0, ty: 0, target: 't', w: 99 });
  d.entrances.push({ nameKey: 'x', kind: 'mine', tx: 0, ty: 0, target: 't' });
  const m = loadMacroMap(d);
  assert(m.regions.length === 3, 'régiók: ' + m.regions.length);
  assert(Object.keys(m.regions.find((r) => r.id === 'badmicro').micro).length === 0, 'rossz mikro nem marad');
  assert(m.routes.length === 2 && m.pois.length === 2 && m.entrances.length === 1, 'többi kiesik');
  assert(m.errors.length >= 10, 'hibalista: ' + m.errors.length);
});

test('macro: szemét-bemenet és ismeretlen verzió nem dob, üres térképet ad', () => {
  for (const bad of [null, undefined, 5, 'x', [], {}, { v: 99 }, { v: MACRO_VERSION, regions: 'x', routes: 3 }]) {
    const m = loadMacroMap(bad === undefined ? null : bad);
    assert(m.regions.length === 0 || bad && bad.v === MACRO_VERSION, 'üres/kezelt');
    assert(sanitizeMacro(bad).errors.length >= 0, 'sanitize');
  }
  assert(regionAt(null, 0, 0) === null && routeAt(null, 0, 0) === null && macroTile(null, 0, 0, 7) === 7, 'null térkép');
  assert(microChunk(null, 1, 0, 0).length === 0 && microChunk(mm, 1, NaN, 0).length === 0, 'null/NaN chunk');
});

test('macro: regionAt fél-nyitott határ, vadon = null', () => {
  assert(regionAt(mm, 0, 0).id === 'meadow', 'rét');
  assert(regionAt(mm, -96, -96).id === 'meadow', 'alsó határ benne');
  assert(regionAt(mm, 95, 95).id === 'meadow', 'felső-1 benne');
  assert(regionAt(mm, 96, 0).id === 'forest', 'határ az erdőé');
  assert(regionAt(mm, 224, 0) === null && regionAt(mm, 0, 96) === null && regionAt(mm, -97, 0) === null, 'kint');
  assert(regionAt(mm, NaN, 0) === null, 'NaN');
});

test('macro: út = ROAD (vízen is), szélesség és margó', () => {
  assert(routeAt(mm, 40, 10).id === 'village_road', 'középpont');
  assert(macroTile(mm, 40, 10, T.GRASS) === T.ROAD && macroTile(mm, 40, 10, T.WATER) === T.ROAD, 'ROAD fű/víz fölött');
  assert(routeAt(mm, 40, 11) && routeAt(mm, 40, 9), '3 széles út: ±1 tile');
  assert(!routeAt(mm, 40, 13), 'kívül');
  assert(routeAt(mm, 40, 13, 2) !== null, 'margóval benne');
  assert(macroTile(mm, 40, 13, T.GRASS) === T.GRASS, 'az alap érintetlen');
  assert(macroTile(mm, 130, 20, T.GRASS) === T.ROAD && !routeAt(mm, 130, 22), '1 széles ösvény');
  // összefüggőség: az út mentén 4-szomszédosan folytonos
  let prev = null, gaps = 0;
  for (let x = 0; x <= 40; x++) {
    const y = Math.round(4 + (6 * x) / 40);
    const on = routeAt(mm, x, y) !== null;
    if (!on) gaps++;
    prev = on;
  }
  assert(gaps === 0 && prev, 'az út folytonos');
});

test('macro: tiszta POI és bejárat felülírja az akadályt', () => {
  assert(poiAt(mm, 0, 0).id === 'village' && poiAt(mm, 12, 0).id === 'village' && poiAt(mm, 13, 0) === null, 'POI sugár');
  assert(macroTile(mm, -5, 5, T.WATER) === T.GRASS && macroTile(mm, -5, 5, T.STONE) === T.GRASS, 'víz/kő -> fű');
  assert(macroTile(mm, -5, 5, T.SAND) === T.SAND, 'a homok marad');
  assert(macroTile(mm, 20, -20, T.WATER) === T.WATER, 'a sugáron kívül marad');
  assert(entranceAt(mm, -60, -40).id === 'meadow_mine' && entranceAt(mm, -58, -39) && !entranceAt(mm, -57, -40), 'bejárat-téglalap');
  assert(entranceAt(mm, -57, -40, 1) && !entranceAt(mm, -56, -40, 1), 'távolság');
  assert(macroTile(mm, -59, -39, T.STONE) === T.ROAD, 'bejárat járható');
});

test('macro: featuresInChunk chunk-határon át és negatív koordinátákkal', () => {
  const f0 = featuresInChunk(mm, 0, 0);
  assert(f0.pois.some((p) => p.id === 'village') && f0.routes.some((r) => r.id === 'village_road'), '(0,0)');
  const fm = featuresInChunk(mm, -1, -1);
  assert(fm.pois.some((p) => p.id === 'village'), 'a falu pad-je átnyúlik (-1,-1)-be');
  assert(fm.entrances.some((e) => e.id === 'meadow_mine'), 'bejárat (-1,-1)');
  assert(featuresInChunk(mm, 50, 50).routes.length === 0 && featuresInChunk(mm, NaN, 0).pois.length === 0, 'üres');
  const ids = featuresInChunk(mm, 1, 0).routes.map((r) => r.id);
  assert(new Set(ids).size === ids.length, 'nincs duplikált út');
});

test('micro: determinisztikus, sorrendfüggetlen, érvényes mezők', () => {
  const a = microChunk(mm, SEED, 0, 0), b = microChunk(mm, SEED, 0, 0);
  assert(a.length > 0 && JSON.stringify(a) === JSON.stringify(b), 'azonos');
  microChunk(mm, SEED, 3, 3); microChunk(mm, SEED, -1, 0);
  assert(JSON.stringify(microChunk(mm, SEED, 0, 0)) === JSON.stringify(a), 'sorrendfüggetlen');
  assert(JSON.stringify(microChunk(mm, SEED + 1, 0, 0)) !== JSON.stringify(a), 'más seed, más kép');
  const ids = new Set(a.map((o) => o.id));
  assert(ids.size === a.length, 'egyedi id');
  for (const o of a) assert(MICRO_TYPES.includes(o.type) && Number.isFinite(o.x) && Number.isFinite(o.y), 'mezők');
});

test('micro: csak fűre, úton/bejáraton/tiszta POI-n kívül, chunk-szélen belül', () => {
  assert(microChunk(mm, SEED, 0, 0, { terrain: () => T.WATER }).length === 0, 'víz fölött nincs');
  assert(microChunk(mm, SEED, 0, 0, { terrain: () => T.SAND }).length === 0, 'homok fölött nincs');
  for (const [cx, cy] of [[0, 0], [-1, -1], [1, 0], [2, 0]]) {
    for (const o of microChunk(mm, SEED, cx, cy)) {
      const tx = Math.floor(o.x / 32), ty = Math.floor((o.y - 0.0) / 32);
      assert(!routeAt(mm, tx, ty, 0) && !poiAt(mm, tx, ty, true) && !entranceAt(mm, tx, ty, 0), 'tiltott helyen: ' + o.id);
      const lx = tx - cx * MACRO_CHUNK, ly = ty - cy * MACRO_CHUNK;
      assert(lx >= 0 && lx < MACRO_CHUNK && ly >= 0 && ly < MACRO_CHUNK, 'chunken kívül: ' + o.id);
    }
  }
  const village = microChunk(mm, SEED, 0, 0).filter((o) => Math.hypot(o.x / 32, o.y / 32) < 11);
  assert(village.length === 0, 'a falu tiszta');
});

test('micro: a régió sűrűsége számít (erdő >> rét), a vadon a fallback', () => {
  let meadow = [];
  for (const [cx, cy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) meadow = meadow.concat(microChunk(mm, SEED, cx, cy));
  const forest = microChunk(mm, SEED, 2, 0);
  const mTrees = count(meadow, 'tree') / 4, fTrees = count(forest, 'tree');
  assert(mTrees > 25 && mTrees < 70, 'rét fa/chunk: ' + mTrees);
  assert(fTrees > mTrees * 2, 'erdő fa: ' + fTrees + ' vs ' + mTrees);
  assert(count(meadow, 'bush') > 0 && count(forest, 'bush') > count(meadow, 'bush') / 4, 'bokor');
  const wild = microChunk(mm, SEED, 10, 10);
  assert(wild.length > 0 && count(wild, 'bush') === 0, 'vadon: fallback (nincs bokor)');
});

test('micro: fuzz + smoke (5x5 chunk kétszer azonos, nincs NaN/kivétel)', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 300; i++) {
    const tx = Math.floor((rnd() - 0.5) * 800), ty = Math.floor((rnd() - 0.5) * 800);
    const base = Math.floor(rnd() * 6);
    const v = macroTile(mm, tx, ty, base);
    assert(Number.isInteger(v) && v >= 0 && v <= 5, 'tile id');
    regionAt(mm, tx + 0.5, ty); routeAt(mm, tx, ty, 2); poiAt(mm, tx, ty); entranceAt(mm, tx, ty, 3);
  }
  const run = () => {
    const all = [];
    for (let cy = -2; cy <= 2; cy++) for (let cx = -2; cx <= 2; cx++) for (const o of microChunk(mm, SEED, cx, cy)) {
      assert(Number.isFinite(o.x) && Number.isFinite(o.y), 'NaN');
      all.push(o.id + o.type + o.x + o.y);
    }
    return all.join('|');
  };
  const r1 = run();
  assert(r1.length > 1000 && r1 === run(), 'smoke');
});
