// test-objects.js (S015): világ-objektumok, ütközők, y-sort, chunk-szórás, tár-szinkron, rajzolási sorrend.
import { test, assert, eq } from './test-index.js';
import { T, TILE_SIZE } from './world-tiles.js';
import { CHUNK_SIZE, terrainTile } from './world-chunk.js';
import { collides } from './game-collision.js';
import { createPlayer } from './game-player.js';
import {
  WORLD_SEED, createWorldStream, warmStream, updateStream, streamWalls, findOpenSpot,
} from './world-stream.js';
import {
  OBJECT_DEFS, OBJECT_CONFIG, isObject, createObject, objectCollider, objectSpriteRect, footY, sortByY,
  scatterChunkObjects, createObjectStore, syncObjects, objectColliders, objectCount, visibleObjects,
} from './world-objects.js';
import { createObjectSprites, drawYSorted } from './render-objects.js';

const SEED = 12015;

function fakeCanvas(w, h) {
  const calls = [];
  const ctx = { imageSmoothingEnabled: true, fillStyle: '', drawImage: (...a) => calls.push(['img', ...a]), fillRect: (...a) => calls.push(['fill', ...a]) };
  return { width: w, height: h, calls, getContext: () => ctx };
}

test('objektum-definíciók: típusok, ütköző a sprite-on belül, lábpont a spriteon belül', () => {
  const types = Object.keys(OBJECT_DEFS);
  assert(types.includes('tree') && types.includes('stone'), 'fa és kő');
  for (const d of Object.values(OBJECT_DEFS)) {
    assert(d.nameKey === 'obj.' + d.type, 'név-kulcs');
    assert(d.collider.w > 0 && d.collider.h > 0, 'ütköző mérete');
    assert(d.sprite.ax >= 0 && d.sprite.ax <= d.sprite.w && d.sprite.ay >= 0 && d.sprite.ay <= d.sprite.h, 'lábpont a spriteon belül');
    assert(d.collider.w <= d.sprite.w && d.collider.h <= d.sprite.ay, 'az ütköző a sprite alatt marad');
    assert(d.palette.length >= 4, 'paletta');
  }
  assert(Object.isFrozen(OBJECT_DEFS.tree), 'fagyasztott definíció');
});

test('createObject / ütköző / sprite-téglalap / isObject', () => {
  eq(createObject('bokor', 1, 2), null);
  eq(createObject('tree', NaN, 2), null);
  const t = createObject('tree', 100, 200, 'a');
  assert(isObject(t) && !isObject(createPlayer(0, 1, 1)) && !isObject(null), 'isObject');
  const c = objectCollider(t);
  eq(c.x, 100 - 8); eq(c.y, 200 - 10); eq(c.w, 16); eq(c.h, 10);
  const s = objectSpriteRect(t);
  eq(s.x, 100 - 24); eq(s.y, 200 - 60); eq(s.w, 48); eq(s.h, 64);
  eq(objectCollider({ type: 'x', x: 0, y: 0 }), null);
});

test('ütköző: a játékos nem megy át a törzsön, de a lombkorona alatt (a talp fölött) szabad', () => {
  const t = createObject('tree', 100, 200, 't');
  const walls = [objectCollider(t)];
  const below = createPlayer(0, 100, 200 + 6 + 12);  // a talp alatt, éppen érintve (a játékos fele 12)
  assert(!collides(below, walls), 'érintés nem átfedés');
  const inside = createPlayer(0, 100, 200);
  assert(collides(inside, walls), 'a talpban ütközik');
  const crown = createPlayer(0, 100, 200 - 10 - 14);  // a talp fölött, a lombkorona magasságában
  assert(!collides(crown, walls), 'a talp fölött nincs ütközés');
});

test('footY: objektum = y, játékos = y + h/2; hibás -> végtelen', () => {
  eq(footY(createObject('stone', 5, 50)), 50);
  eq(footY(createPlayer(0, 0, 100)), 100 + 12);
  eq(footY({ x: 0, y: NaN, h: 4 }), Infinity);
  eq(footY(null), Infinity);
});

test('sortByY: fentről lefelé, döntetlennél x majd id, stabil és determinisztikus, hibás a végére', () => {
  const a = createObject('tree', 50, 100, 'a'), b = createObject('tree', 10, 100, 'b'), c = createObject('stone', 30, 90, 'c');
  const p = createPlayer(0, 0, 100 - 12);           // lábpont 100, x = 0 -> az x miatt a-b előtt
  const bad = { type: 'tree', x: 1, y: NaN, id: 'z' };
  const l1 = sortByY([a, bad, b, p, c]);
  assert(l1[0] === c && l1[1] === p && l1[2] === b && l1[3] === a && l1[4] === bad, 'sorrend: ' + l1.map(e => e.id ?? 'P').join());
  const l2 = sortByY([bad, c, a, p, b]);
  eq(l2.map(e => e.id ?? 'P').join(), l1.map(e => e.id ?? 'P').join(), 'a bemeneti sorrendtől független');
  const lo = sortByY([createObject('tree', 5, 300, 'q'), createPlayer(1, 5, 100)]);
  assert(isObject(lo[1]), 'a lejjebb lévő objektum takar (utolsónak rajzolódik)');
});

test('szórás: determinisztikus, sorrendfüggetlen, érvényes azonosítók', () => {
  const a = scatterChunkObjects(SEED, 3, -2), b = scatterChunkObjects(SEED, 3, -2);
  eq(JSON.stringify(a), JSON.stringify(b), 'azonos chunk azonos objektumok');
  scatterChunkObjects(SEED, 9, 9);                                  // másik chunk közbeiktatva
  eq(JSON.stringify(scatterChunkObjects(SEED, 3, -2)), JSON.stringify(a), 'sorrendfüggetlen');
  assert(JSON.stringify(scatterChunkObjects(SEED + 1, 3, -2)) !== JSON.stringify(a), 'seedenként más');
  const ids = new Set(a.map(o => o.id));
  eq(ids.size, a.length, 'egyedi id');
  for (const o of a) assert(/^3,-2:\d+$/.test(o.id) && OBJECT_DEFS[o.type], 'id/típus: ' + o.id);
});

test('szórás: csak fűre, szabad 3x3 környezettel, a chunk szélétől beljebb, mennyiség a tartományban', () => {
  let total = 0, trees = 0, stones = 0;
  for (let cy = -2; cy <= 1; cy++) {
    for (let cx = -2; cx <= 1; cx++) {
      const list = scatterChunkObjects(SEED, cx, cy);
      total += list.length;
      for (const o of list) {
        if (o.type === 'tree') trees++; else stones++;
        const wx = Math.floor(o.x / TILE_SIZE), wy = Math.floor(o.y / TILE_SIZE);
        eq(terrainTile(SEED, wx, wy), T.GRASS, 'fűre kerül');
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          assert(terrainTile(SEED, wx + dx, wy + dy) !== T.WATER && terrainTile(SEED, wx + dx, wy + dy) !== T.STONE, 'szabad környezet');
        }
        const lx = wx - cx * CHUNK_SIZE, ly = wy - cy * CHUNK_SIZE;
        assert(lx >= 1 && ly >= 1 && lx <= CHUNK_SIZE - 2 && ly <= CHUNK_SIZE - 2, 'nem a chunk szélén');
        assert(Math.abs(o.x - (wx + 0.5) * TILE_SIZE) <= OBJECT_CONFIG.jitter + 1e-9, 'jitter korlátos');
      }
    }
  }
  assert(total > 100 && total < 4 * 16 * 64 * 64 * 0.03, 'összes objektum: ' + total);
  assert(trees > stones && stones > 0, `fa ${trees} > kő ${stones} > 0`);
});

test('szórás: az ütközők nem fednek víz/kő tile-t és egymást sem, nem zárják el a tile-járatot', () => {
  const ws = createWorldStream(SEED);
  warmStream(ws, [{ x: 0, y: 0 }]);
  const tileWalls = streamWalls(ws);
  const os = createObjectStore(SEED);
  syncObjects(os, ws);
  const cols = objectColliders(os);
  assert(cols.length > 100, 'van elég ütköző: ' + cols.length);
  for (const w of cols) {
    const e = { x: w.x + w.w / 2, y: w.y + w.h / 2, w: w.w - 0.01, h: w.h - 0.01 };
    assert(!collides(e, tileWalls), 'ütköző a víz/kő tile-ban: ' + JSON.stringify(w));
  }
  for (let i = 0; i < cols.length; i++) {
    for (let j = i + 1; j < cols.length; j++) {
      const a = cols[i], b = cols[j];
      assert(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y), 'átfedő objektum-ütközők');
    }
  }
});

test('szórás: keepFree zóna üres, a többi objektum nem tolódik el (RNG-fogyasztás állandó)', () => {
  const base = scatterChunkObjects(SEED, 0, 0);
  assert(base.length > 10, 'van objektum');
  const k = base[Math.floor(base.length / 2)];
  const free = scatterChunkObjects(SEED, 0, 0, { keepFree: [{ x: k.x, y: k.y, r: 150 }] });
  for (const o of free) assert(Math.hypot(o.x - k.x, o.y - k.y) >= 150, 'a zónában nincs objektum');
  assert(free.length < base.length, 'a zóna elvett objektumokat');
  const byId = new Map(base.map(o => [o.id, o]));
  for (const o of free) {
    const same = byId.get(o.id);
    assert(same && same.x === o.x && same.y === o.y && same.type === o.type, 'a megmaradók azonosak: ' + o.id);
  }
});

test('tár: szinkron a streammel (betöltés, eldobás, verzió csak változáskor), ütközők = a szilárd objektumok', () => {
  const ws = createWorldStream(SEED);
  const os = createObjectStore(SEED);
  let r = syncObjects(os, ws);
  eq(r.added.length, 0); eq(os.version, 0, 'üres világ: nincs változás');
  warmStream(ws, [{ x: 0, y: 0 }]);
  r = syncObjects(os, ws);
  eq(r.added.length, ws.chunks.size); eq(os.version, 1);
  r = syncObjects(os, ws);
  eq(r.added.length + r.dropped.length, 0); eq(os.version, 1, 'változatlan -> a verzió nem nő');
  eq(objectColliders(os).length, objectCount(os), 'minden placeholder szilárd');
  const far = [{ x: 40 * CHUNK_SIZE * TILE_SIZE, y: 0 }];
  warmStream(ws, far);
  r = syncObjects(os, ws);
  assert(r.dropped.length > 0 && r.added.length > 0, 'a távoli chunkok cserélődnek');
  eq(os.chunks.size, ws.chunks.size, 'a tár a stream chunkjait követi');
  const before = JSON.stringify([...os.chunks.values()].map(e => e.list));
  const os2 = createObjectStore(SEED); syncObjects(os2, ws);
  eq(JSON.stringify([...os2.chunks.values()].map(e => e.list)), before, 'újraépítés azonos');
});

test('spawn: a kezdőhely körül (keepFree) a játékosok nem kerülnek objektumba', () => {
  const spot = findOpenSpot(WORLD_SEED, 0, 0);
  const P = [createPlayer(0, spot.x - 70, spot.y), createPlayer(1, spot.x + 70, spot.y)];
  const ws = createWorldStream(WORLD_SEED); warmStream(ws, P);
  const os = createObjectStore(WORLD_SEED, { keepFree: [{ x: spot.x, y: spot.y, r: 224 }] });
  syncObjects(os, ws);
  const cols = objectColliders(os);
  for (const p of P) assert(!collides(p, cols), 'a játékos objektumban indul');
  for (const o of [...os.chunks.values()].flatMap(e => e.list)) assert(Math.hypot(o.x - spot.x, o.y - spot.y) >= 224, 'objektum a szabad zónában');
});

test('visibleObjects: csak a nézettel átfedők, hibás nézet -> üres', () => {
  const ws = createWorldStream(SEED); warmStream(ws, [{ x: 0, y: 0 }]);
  const os = createObjectStore(SEED); syncObjects(os, ws);
  const all = [...os.chunks.values()].flatMap(e => e.list);
  const view = visibleObjects(os, 0, 0, 960, 540);
  assert(view.length > 0 && view.length < all.length, `látható ${view.length} / ${all.length}`);
  for (const o of view) {
    const r = objectSpriteRect(o);
    assert(r.x < 960 && r.x + r.w > 0 && r.y < 540 && r.y + r.h > 0, 'a nézeten kívüli objektum bekerült');
  }
  const expect = all.filter(o => { const r = objectSpriteRect(o); return r.x < 960 && r.x + r.w > 0 && r.y < 540 && r.y + r.h > 0; });
  eq(view.length, expect.length, 'nincs kihagyott objektum');
  eq(visibleObjects(os, NaN, 0, 960, 540).length, 0);
});

test('render: a sprite-készlet minden típusra elkészül, rajzol (fillRect), nincs magenta', () => {
  const made = [];
  const rend = createObjectSprites((w, h) => { const c = fakeCanvas(w, h); made.push(c); return c; });
  eq(rend.sprites.size, Object.keys(OBJECT_DEFS).length);
  for (const c of made) assert(c.calls.length > 5, 'a placeholder rajzolt');
  for (const d of Object.values(OBJECT_DEFS)) {
    const s = rend.sprites.get(d.type);
    eq(s.canvas.width, d.sprite.w); eq(s.ax, d.sprite.ax); eq(s.ay, d.sprite.ay);
  }
});

test('render: y-sort a rajzolásban (a játékos a fa mögött/előtt a lábpont szerint), kivágás-szűrés', () => {
  const ws = createWorldStream(SEED); warmStream(ws, [{ x: 0, y: 0 }]);
  const os = createObjectStore(SEED); syncObjects(os, ws);
  const rend = createObjectSprites((w, h) => fakeCanvas(w, h));
  const tree = os.chunks.get('0,0').list.find(o => o.type === 'tree');
  const mk = (dy) => createPlayer(0, tree.x, tree.y + dy - 12); // lábpont = tree.y + dy
  const run = (p) => {
    const view = fakeCanvas(960, 540), ctx = view.getContext('2d');
    const order = [];
    const treeImg = rend.sprites.get('tree').canvas;
    const px = Math.round(tree.x - 480), py = Math.round(tree.y - 270);
    const mine = (x, y) => x === Math.round(tree.x) - px - 24 && y === Math.round(tree.y) - py - 60;
    const spy = { ...ctx, drawImage: (img, x, y) => order.push(img === treeImg && mine(x, y) ? 'tree' : 'other') };
    const res = drawYSorted(spy, rend, os, [p], tree.x - 480, tree.y - 270, 960, 540, () => order.push('player'));
    return { order, res };
  };
  const front = run(mk(+20)), back = run(mk(-20));
  const idx = (o, k) => o.indexOf(k);
  assert(idx(front.order, 'player') > idx(front.order, 'tree'), 'a lejjebb álló játékos a fa után rajzolódik (előtte van)');
  assert(idx(back.order, 'player') < idx(back.order, 'tree'), 'a feljebb álló játékos a fa előtt rajzolódik (mögötte van)');
  eq(front.res.players, 1);
  assert(front.res.objects > 0 && front.res.objects < objectCount(os), 'csak a látható objektumok rajzolódnak');
  const far = run(createPlayer(0, tree.x, tree.y));
  eq(far.res.players, 1, 'a játékos mindig rajzolódik');
});
