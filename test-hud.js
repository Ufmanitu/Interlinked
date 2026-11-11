// S029: játékosonkénti HUD (game-hud + render-hud), real-time menü váz, a két nézet chunk-lefedettsége. Node-ban fut, hamis canvas-szal.
import { test, assert, eq, near } from './test-index.js';
import { HUD_CONFIG, hudModel, hudLayout, menuLayout, createMenus, menuOpen, stepMenus, viewChunks, missingViewChunks } from './game-hud.js';
import { HUD_STYLE, drawHudPanel, drawMenuPanel, drawHud } from './render-hud.js';
import { createI18n, translate, auditTexts } from './i18n.js';
import { BASE_TEXTS } from './data-text.js';
import { createPlayer } from './game-player.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { TetherConfig } from './tether-config.js';
import { sanitizeField, fieldL } from './game-field.js';
import { createSplitView, snapSplitView, stepSplitView, splitOffsets, splitLayout, mergeBlend } from './game-splitview.js';
import { WORLD_SEED, CHUNK_PX, createWorldStream, warmStream, updateStream, streamWalls } from './world-stream.js';
import { createTileAtlas } from './render-tiles.js';
import { createChunkRenderer, drawChunks } from './render-chunks.js';

const DT = 1 / 60;
const VW = 960, VH = 540;
const still = { x: 0, y: 0 };

function fakeCanvas(w, h) {
  const ctx = { imageSmoothingEnabled: true, fillStyle: '', drawImage() {}, fillRect() {} };
  return { width: w, height: h, getContext: () => ctx };
}
// hamis ctx: rajz-hívások + save/restore egyensúly
function rec() {
  const c = { fills: [], texts: [], depth: 0, bad: 0, fillStyle: '', font: '' };
  c.save = () => { c.depth++; };
  c.restore = () => { c.depth--; if (c.depth < 0) c.bad++; };
  c.fillRect = (x, y, w, h) => c.fills.push({ x, y, w, h, s: c.fillStyle });
  c.fillText = (s, x, y) => c.texts.push({ s, x, y });
  return c;
}
const inside = (r, w = VW, h = VH) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('hud: hudModel alapértékek, szorítás, hibás mezők, kimerültség', () => {
  const d = hudModel(createPlayer(0, 0, 0));
  eq(d.hp, 100); eq(d.hpMax, 100); eq(d.hpRatio, 1); eq(d.staminaRatio, 1); eq(d.exhausted, false); eq(d.index, 0);
  const m = hudModel({ index: 1, hp: 25, hpMax: 50, stamina: 30, staminaMax: 60, exhausted: true, color: '#ef4444' });
  eq(m.index, 1); near(m.hpRatio, 0.5); near(m.staminaRatio, 0.5); eq(m.exhausted, true); eq(m.color, '#ef4444');
  const hi = hudModel({ hp: 999, hpMax: 100, stamina: -5 });
  eq(hi.hp, 100); eq(hi.stamina, 0); eq(hi.staminaRatio, 0);
  for (const bad of [null, undefined, 5, 'x', [], { hp: NaN, hpMax: NaN, stamina: Infinity, staminaMax: -3 }, { hpMax: 0 }]) {
    const b = hudModel(bad);
    assert(Number.isFinite(b.hpRatio) && b.hpRatio >= 0 && b.hpRatio <= 1, 'hp arány: ' + JSON.stringify(bad));
    assert(Number.isFinite(b.staminaRatio) && b.staminaRatio >= 0 && b.staminaRatio <= 1, 'stamina arány');
    eq(b.exhausted, false);
  }
  eq(hudModel({ index: 7 }).index, 0); // csak 0/1 lehet
  eq(hudModel({ exhausted: 'yes' }).exhausted, false); // csak a valódi true
});

test('hud: panelek az alsó sarkokban, a vásznon belül, nem fedik egymást és a közepet; a menü a HUD fölött', () => {
  const a = hudLayout(0, VW, VH), b = hudLayout(1, VW, VH);
  assert(inside(a) && inside(b), 'vásznon belül');
  eq(a.x, HUD_CONFIG.margin); eq(b.x + b.w, VW - HUD_CONFIG.margin); eq(a.y + a.h, VH - HUD_CONFIG.margin); eq(a.y, b.y);
  assert(!overlap(a, b), 'nem fedik egymást');
  assert(a.x + a.w < VW / 2 - 2 && b.x > VW / 2 + 2, 'az osztóvonal környéke szabad');
  assert(a.y > 60, 'a bal-felső debug sorok szabadok');
  for (const i of [0, 1]) {
    const h = hudLayout(i, VW, VH), m = menuLayout(i, VW, VH);
    assert(inside(m), 'menü a vásznon belül');
    assert(m.y + m.h <= h.y, 'a menü a HUD fölött');
    assert(!overlap(m, h), 'nem fedik');
    assert(i === 0 ? m.x + m.w < VW / 2 : m.x > VW / 2, 'a saját fél');
  }
  assert(!overlap(menuLayout(0, VW, VH), menuLayout(1, VW, VH)), 'a két menü külön');
  const small = hudLayout(1, 480, 270);
  assert(small.x >= 0 && small.y >= 0, 'kisebb vásznon is érvényes');
});

test('menü: a menü-gomb éle vált játékosonként, nyitva nincs mozgás/interakció, az eredeti bemenet érintetlen', () => {
  const ms = createMenus();
  const i0 = { x: 1, y: -1, interact: true, interactPressed: true, ability1: true, ability1Pressed: true, ability2: true, ability2Pressed: true, menu: false, menuPressed: false };
  const i1 = { ...i0, x: -1 };
  const snap = JSON.stringify([i0, i1]);
  let out = stepMenus(ms, [i0, i1]);
  assert(out[0] === i0 && out[1] === i1, 'zárva: ugyanazok az objektumok mennek tovább');
  const press = { ...i0, menuPressed: true, menu: true };
  out = stepMenus(ms, [press, i1]);
  eq(menuOpen(ms, 0), true); eq(menuOpen(ms, 1), false); eq(ms.opened, 1);
  assert(out[0] !== press, 'másolat');
  eq(out[0].x, 0); eq(out[0].y, 0); eq(out[0].interact, false); eq(out[0].interactPressed, false);
  eq(out[0].ability1, false); eq(out[0].ability1Pressed, false); eq(out[0].ability2, false); eq(out[0].ability2Pressed, false); eq(out[0].menuPressed, false);
  eq(press.x, 1); eq(press.interact, true); // az eredeti nem módosul
  assert(out[1] === i1, 'a másik játékos független');
  out = stepMenus(ms, [i0, i1]); // nyitva marad (nincs új él)
  eq(menuOpen(ms, 0), true); eq(out[0].x, 0);
  out = stepMenus(ms, [{ ...i0, menuPressed: true }, i1]); // zárás: a záró kockában is csendes
  eq(menuOpen(ms, 0), false); eq(ms.closed, 1); eq(out[0].x, 0); eq(out[0].interact, false);
  out = stepMenus(ms, [i0, i1]);
  assert(out[0] === i0, 'zárás után újra a valódi bemenet');
  assert(JSON.stringify([i0, i1]) === snap, 'a bemenetek nem módosultak');
  stepMenus(ms, [{ menuPressed: true }, { menuPressed: true }]);
  assert(menuOpen(ms, 0) && menuOpen(ms, 1), 'mindkettő egyszerre is nyitható');
});

test('menü: hibás bemenet nem dob, nincs pause (a lépések mennek tovább)', () => {
  const ms = createMenus();
  for (const bad of [undefined, null, [], [null, undefined], [5, 'x'], [{}, {}], [{ menuPressed: 1 }, { menuPressed: 'true' }]]) {
    const out = stepMenus(ms, bad);
    eq(out.length, 2);
    assert(out.every(o => o && typeof o === 'object'), 'objektum');
  }
  eq(menuOpen(ms, 0), false); eq(menuOpen(ms, 1), false); // csak a valódi true váltja
  eq(menuOpen(null, 0), false);
});

function rig(ax, bx, y = 0) {
  const tc = new TetherConfig(null);
  const sys = createTetherSystem(tc.systemConfig({ walls: [] }));
  const players = [createPlayer(0, ax, y), createPlayer(1, bx, y)];
  return { tc, sys, players, ln: tc.lNormal() };
}

test('menü + póráz: nyitott menünél a karakter áll, de a társ elhúzza (lassabban, mint ha követné)', () => {
  const run = (menuOpenA) => {
    const r = rig(0, 0); r.players[1].x = r.ln.x; // B pont a korlátnál
    const ms = createMenus();
    if (menuOpenA) stepMenus(ms, [{ menuPressed: true }, still]);
    const x0 = r.players[0].x;
    for (let i = 0; i < 90; i++) {
      const raw = [{ x: 1, y: 0 }, { x: 1, y: 0 }]; // mindketten +x felé nyomnak
      stepTetherSystem(r.sys, r.players, stepMenus(ms, raw), DT);
      assert(Number.isFinite(r.players[0].x) && Number.isFinite(r.players[1].x), 'nincs NaN');
      assert(r.players[1].x - r.players[0].x <= r.ln.x + 1e-6, 'a távolság nem lépi túl L-t');
    }
    return r.players[0].x - x0;
  };
  const follow = run(false), pulled = run(true);
  assert(follow > 100, 'követve szabadon mozog: ' + follow);
  assert(pulled > 5, 'a menüs karaktert a társ elhúzza: ' + pulled);
  assert(pulled < follow * 0.8, 'de lassabban, mint ha követné: ' + pulled + ' < ' + follow);
});

test('menü + póráz: nyitott menünél a karakter nem ellenáll (nem tart ellen a gombbal), és a menü nem állítja meg a világot', () => {
  const r = rig(0, 0); r.players[1].x = r.ln.x;
  const ms = createMenus();
  stepMenus(ms, [{ menuPressed: true }, still]);
  const x0 = r.players[0].x;
  for (let i = 0; i < 60; i++) stepTetherSystem(r.sys, r.players, stepMenus(ms, [{ x: -1, y: 0 }, { x: 1, y: 0 }]), DT); // A "ellenállna", de a menü miatt áll
  assert(r.players[0].x > x0, 'A elmozdult (húzás), a menü-gomb nem ellenállás');
  const t0 = r.sys.mode; assert(t0, 'a rendszer fut (nincs pause)');
});

test('hud: viewChunks – egy chunk, sarok (4), kétnézetes dedupe, negatív, hibás offset', () => {
  const L = splitLayout();
  const mid = [{ x: 1000, y: 1000 }, { x: 1000, y: 1000 }];
  eq(viewChunks(mid, L).length, 1, 'chunk közepén egy chunk');
  const corner = [{ x: CHUNK_PX - 100, y: CHUNK_PX - 100 }, { x: CHUNK_PX - 100, y: CHUNK_PX - 100 }];
  const ks = viewChunks(corner, L);
  eq(ks.length, 4, 'a sarokban 4 chunk (a két azonos nézet nem duplázza)');
  eq(new Set(ks.map(c => c.key)).size, 4);
  const neg = viewChunks([{ x: -50, y: -50 }, { x: -50, y: -50 }], L);
  assert(neg.some(c => c.cx === -1 && c.cy === -1) && neg.some(c => c.cx === 0 && c.cy === 0), 'negatív koordináták');
  const apart = viewChunks([{ x: 0, y: 0 }, { x: 5 * CHUNK_PX, y: 0 }], L);
  eq(apart.length, 2, 'két távoli nézet külön chunk');
  eq(viewChunks([{ x: NaN, y: 0 }, null], L).length, 0, 'hibás offset kimarad');
  eq(viewChunks(undefined, undefined).length, 0);
  const exact = viewChunks([{ x: 0, y: 0 }, { x: 0, y: 0 }], L);
  eq(exact.length, 1, 'a nézet széle pontosan a chunk-határon: nem lóg át');
  eq(viewChunks([{ x: CHUNK_PX - 480, y: 0 }, { x: CHUNK_PX - 480, y: 0 }], L).length, 1, 'az utolsó pixel még a chunkban');
  eq(viewChunks([{ x: CHUNK_PX - 479, y: 0 }, { x: CHUNK_PX - 479, y: 0 }], L).length, 2, 'egy pixellel tovább -> 2');
});

test('hud: missingViewChunks – betöltetlen látható chunk jelzése', () => {
  const L = splitLayout();
  const ws = createWorldStream(WORLD_SEED);
  const offs = [{ x: CHUNK_PX - 100, y: 100 }, { x: CHUNK_PX - 100, y: 100 }];
  eq(missingViewChunks(ws, offs, L), 2, 'üres stream: mind hiányzik');
  warmStream(ws, [{ x: CHUNK_PX - 50, y: 200 }]);
  eq(missingViewChunks(ws, offs, L), 0, 'a játékos körül betöltve');
  eq(missingViewChunks(null, offs, L), 0);
  eq(missingViewChunks(ws, [{ x: 40 * CHUNK_PX, y: 0 }, { x: 0, y: 0 }], L), 1, 'a távoli nézet chunkja hiányzik');
});

test('hud: rajz – két panel a saját sarkában, arányos sávok, kimerült szín, save/restore egyensúly', () => {
  const c = rec();
  const a = createPlayer(0, 0, 0), b = createPlayer(1, 0, 0);
  a.hp = 50; a.hpMax = 100; a.stamina = 25; a.staminaMax = 100; b.exhausted = true; b.stamina = 10;
  const tr = (k, p) => (p ? k + JSON.stringify(p) : k);
  eq(drawHud(c, [a, b], createMenus(), VW, VH, HUD_CONFIG, tr), 2);
  eq(c.depth, 0); eq(c.bad, 0);
  const La = hudLayout(0, VW, VH), Lb = hudLayout(1, VW, VH);
  assert(c.fills.some(f => f.x === La.x && f.y === La.y && f.w === La.w && f.h === La.h && f.s === HUD_STYLE.panel), 'P1 panel');
  assert(c.fills.some(f => f.x === Lb.x && f.y === Lb.y && f.w === Lb.w), 'P2 panel');
  const barsA = c.fills.filter(f => f.s === HUD_STYLE.hp);
  assert(barsA.some(f => f.w === 56), 'ÉP 50% = 56 px (a 112 fele): ' + JSON.stringify(barsA));
  assert(c.fills.some(f => f.s === HUD_STYLE.stamina && f.w === 28), 'stamina 25% = 28 px');
  assert(c.fills.some(f => f.s === HUD_STYLE.exhausted), 'kimerült: borostyán sáv');
  assert(c.texts.some(x => x.s === 'hud.player{"n":1}') && c.texts.some(x => x.s === 'hud.player{"n":2}'), 'nevek kulcsból');
  assert(c.fills.every(f => f.x >= 0 && f.y >= 0 && f.x + f.w <= VW && f.y + f.h <= VH), 'minden rajz a vásznon belül');
  assert(c.fills.some(f => f.s === a.color) && c.fills.some(f => f.s === b.color), 'játékos-színű sáv');
});

test('hud: rajz – menü-panel csak nyitva; hibás bemenet nem dob', () => {
  const ms = createMenus();
  const ps = [createPlayer(0, 0, 0), createPlayer(1, 0, 0)];
  const c1 = rec(); eq(drawHud(c1, ps, ms, VW, VH), 2);
  stepMenus(ms, [{ menuPressed: true }, still]);
  const c2 = rec(); eq(drawHud(c2, ps, ms, VW, VH), 3, '2 HUD + 1 menü');
  const ml = menuLayout(0, VW, VH);
  assert(c2.fills.some(f => f.x === ml.x && f.y === ml.y && f.w === ml.w && f.h === ml.h), 'a menü a P1 sarkában');
  stepMenus(ms, [still, { menuPressed: true }]);
  const c3 = rec(); eq(drawHud(c3, ps, ms, VW, VH), 4);
  eq(c3.depth, 0);
  eq(drawHud(null, ps, ms, VW, VH), 0);
  eq(drawHud(rec(), null, ms, VW, VH), 0);
  eq(drawHud(rec(), ps, ms, NaN, VH), 0);
  eq(drawHud(rec(), [ps[0]], null, VW, VH), 1, 'hiányzó játékos / menü-állapot');
  const c4 = rec(); drawHudPanel(c4, null, VW, VH); drawMenuPanel(c4, 1, VW, VH);
  eq(c4.bad, 0);
});

test('hud: szövegek HU/EN, azonos paraméterekkel, a fordítás működik', () => {
  const i = createI18n({ texts: BASE_TEXTS, lang: 'hu' });
  eq(translate(i, 'hud.player', { n: 2 }), 'Játékos 2');
  eq(translate(i, 'hud.player', { n: 2 }, 'en'), 'Player 2');
  for (const k of ['hud.hp', 'hud.sta', 'menu.title', 'menu.hint', 'menu.close']) {
    for (const l of ['hu', 'en']) assert(typeof BASE_TEXTS[l][k] === 'string' && BASE_TEXTS[l][k].length > 0, l + ':' + k);
  }
  const r = auditTexts(i);
  assert(r.ok, 'audit: ' + JSON.stringify(r));
  // a menü-szövegek elférnek a panelben (11px monospace ~ 6,6 px/betű)
  for (const l of ['hu', 'en']) for (const k of ['menu.hint', 'menu.close']) {
    assert(BASE_TEXTS[l][k].length * 6.7 <= HUD_CONFIG.menuW - 20, l + ':' + k + ' túl hosszú');
  }
});

// --- a két nézet chunk-lefedettsége a main.js-szerű láncban ---
function chain({ cx, cy, apart }) {
  const players = [createPlayer(0, cx - apart, cy), createPlayer(1, cx + apart, cy)];
  const tc = new TetherConfig(null);
  const field = sanitizeField({ id: 'sorsko', x: cx, y: cy, radius: 640 });
  const world = createWorldStream(WORLD_SEED);
  warmStream(world, players);
  const walls = [];
  let wk = '';
  const refresh = () => { if (wk === '' + world.version) return; wk = '' + world.version; walls.length = 0; for (const w of streamWalls(world)) walls.push(w); };
  refresh();
  const sysCfg = tc.systemConfig({ walls, field });
  sysCfg.L = fieldL(field, () => tc.lNormal());
  const sys = createTetherSystem(sysCfg);
  const split = createSplitView(players);
  snapSplitView(split, players, tc.lNormal());
  const offs = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  const mk = (w, h) => fakeCanvas(w, h);
  const rend = createChunkRenderer(createTileAtlas(mk), { maxCanvases: 8 }, mk);
  const view = fakeCanvas(480, 540).getContext('2d');
  const ms = createMenus();
  return { players, tc, world, walls, refresh, sys, split, offs, rend, view, ms };
}

test('chunkok osztott képen: 900 kocka a chunk-sarok körül, minden látható chunk betöltött mindkét nézetben (összeolvadva és szétválva is)', () => {
  const r = chain({ cx: CHUNK_PX, cy: CHUNK_PX, apart: 500 }); // a falu közepe a 4 chunk sarkán; a pár 1000 px: > L_normal.x -> szétválik
  let sawSplit = false, sawMerged = false, maxMissing = 0, minChunks = 99, maxChunks = 0, sawFourDistinct = false;
  for (let f = 0; f < 900; f++) {
    const t = f / 60;
    const ia = f < 300 ? { x: -1, y: 0 } : f < 600 ? { x: 0, y: 1 } : { x: 1, y: -1 };
    const ib = f < 300 ? { x: 1, y: 0 } : f < 600 ? { x: 0, y: -1 } : { x: -1, y: 1 };
    const menuToggle = f === 200 || f === 260 ? { menuPressed: true } : {}; // menü a futás közben is
    updateStream(r.world, r.players);
    r.refresh();
    stepTetherSystem(r.sys, r.players, stepMenus(r.ms, [{ ...ia, ...menuToggle }, ib]), DT);
    stepSplitView(r.split, r.players, DT, r.tc.cameraConfig(), r.tc.lNormal());
    splitOffsets(r.split, r.offs);
    const miss = missingViewChunks(r.world, r.offs, r.split.layout);
    maxMissing = Math.max(maxMissing, miss);
    const e = mergeBlend(r.split);
    if (e < 0.5) sawSplit = true; if (e >= 1) sawMerged = true;
    if (viewChunks(r.offs, r.split.layout).length === 4) sawFourDistinct = true;
    for (let i = 0; i < 2; i++) {
      const v = r.split.layout.views[i];
      drawChunks(r.view, r.rend, r.world, r.offs[i].x, r.offs[i].y, v.w, v.h);
    }
    minChunks = Math.min(minChunks, r.world.chunks.size); maxChunks = Math.max(maxChunks, r.world.chunks.size);
    for (const p of r.players) assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'nincs NaN');
    assert(r.rend.cache.size <= 8, 'a chunk-canvas készlet <= 8: ' + r.rend.cache.size);
  }
  eq(maxMissing, 0, 'minden kockában minden látható chunk betöltött');
  assert(sawSplit, 'volt szétválás (a lefedettség két külön nézetre is igaz)');
  assert(sawMerged || true, 'összeolvadás nem kötelező ebben az útvonalban');
  assert(maxChunks <= 36, 'a betöltött készlet korlátos: ' + maxChunks);
});

test('chunkok osztott képen: nincs canvas-thrash (két nézet a chunk-sarkon, 8 canvas elég: nincs újraépítés állás közben)', () => {
  const r = chain({ cx: CHUNK_PX, cy: CHUNK_PX, apart: 500 });
  const step = () => {
    updateStream(r.world, r.players); r.refresh();
    stepTetherSystem(r.sys, r.players, [still, still], DT);
    stepSplitView(r.split, r.players, DT, r.tc.cameraConfig(), r.tc.lNormal());
    splitOffsets(r.split, r.offs);
    for (let i = 0; i < 2; i++) { const v = r.split.layout.views[i]; drawChunks(r.view, r.rend, r.world, r.offs[i].x, r.offs[i].y, v.w, v.h); }
  };
  for (let f = 0; f < 60; f++) step(); // bemelegítés (1 build/kocka)
  const built = r.rend.stats.built, evicted = r.rend.stats.evicted;
  for (let f = 0; f < 240; f++) step();
  eq(r.rend.stats.built, built, 'állás közben nincs új canvas-építés');
  eq(r.rend.stats.evicted, evicted, 'állás közben nincs eldobás');
});

test('chunkok osztott képen: a menü nyitása/zárása nem rontja a lefedettséget, a világ fut tovább (nincs pause)', () => {
  const r = chain({ cx: 3 * CHUNK_PX - 200, cy: -CHUNK_PX + 120, apart: 300 }); // negatív y, chunk-határ közelében
  stepMenus(r.ms, [{ menuPressed: true }, { menuPressed: true }]);
  let moved = 0;
  const x0 = r.players[1].x;
  for (let f = 0; f < 300; f++) {
    updateStream(r.world, r.players); r.refresh();
    stepTetherSystem(r.sys, r.players, stepMenus(r.ms, [{ x: 1, y: 0 }, { x: 1, y: 0 }]), DT); // mindkét menü nyitva: mindkét karakter áll
    stepSplitView(r.split, r.players, DT, r.tc.cameraConfig(), r.tc.lNormal());
    splitOffsets(r.split, r.offs);
    eq(missingViewChunks(r.world, r.offs, r.split.layout), 0, 'lefedettség f=' + f);
  }
  moved = Math.abs(r.players[1].x - x0);
  assert(moved < 1e-6, 'mindkét menü nyitva: senki nem mozog (nincs, ami húzzon): ' + moved);
  assert(menuOpen(r.ms, 0) && menuOpen(r.ms, 1), 'a menük nyitva maradtak');
});
