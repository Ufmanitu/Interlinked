// S016 tesztek: interakció-logika (facing, zóna, célpont, gomb, két játékos, források, események). A rajz és a smoke: test-interact-render.js.
// A tárgy-adatok a world-objects.js-ből jönnek (a várt értékek az OBJECT_DEFS-ből számolva, nem beégetve).
import { test, assert, eq, near } from './test-index.js';
import {
  INTERACT_CONFIG, INTERACT_DEFS, sanitizeInteractConfig, updateFacing, interactZone,
  createInteractSystem, addProvider, addObjectSource, objectProvider, defineInteractable, onInteract,
  targetOf, stepInteraction,
} from './game-interact.js';
import { OBJECT_DEFS, createObject, objectCollider } from './world-objects.js';

const DT = 1 / 60;
const PRESS = { x: 0, y: 0, interact: true };
const IDLE = { x: 0, y: 0, interact: false };

// --- segédek ---
function store(objs) {
  const m = new Map();
  m.set('0,0', { cx: 0, cy: 0, list: objs.slice(), walls: [] });
  return { chunks: m, version: 1 };
}
function player(x, y) { return { x, y, w: 24, h: 24 }; }
function mkSys(objs, opts) {
  const sys = createInteractSystem(opts);
  const os = store(objs || []);
  addObjectSource(sys, os);
  return { sys, os };
}
// A fa olyan helyre, hogy a (jobbra néző) játékos zónája érje: a játékos a collider bal széle előtt `gap` px-szel áll.
function treeAhead(id, gap = 8) {
  const o = createObject('tree', 200, 200, id);
  const r = objectCollider(o);
  const p = player(r.x - 12 - gap, r.y + r.h / 2); // 12 = a 24 px-es játékos fél szélessége
  return { o, r, p };
}
// --- konfig ---
test('interact: konfig szorítás, hibás érték -> alapérték', () => {
  const c = sanitizeInteractConfig({ reach: 9999, width: -5, cooldown: NaN, stickiness: 'x', deadzone: 5 });
  eq(c.reach, 256); eq(c.width, 1); eq(c.cooldown, INTERACT_CONFIG.cooldown); eq(c.stickiness, INTERACT_CONFIG.stickiness); eq(c.deadzone, 0.95);
  const d = sanitizeInteractConfig();
  for (const k of Object.keys(INTERACT_CONFIG)) eq(d[k], INTERACT_CONFIG[k], k);
  eq(createInteractSystem({ cfg: { reach: 40 } }).cfg.reach, 40);
});

// --- facing és zóna ---
test('interact: facing a domináns tengelyből, holtsáv és nincs bemenet -> marad', () => {
  const f = { x: 0, y: 1 };
  updateFacing(f, { x: 1, y: 0.2 }); eq(f.x, 1); eq(f.y, 0);
  updateFacing(f, { x: 0, y: 0 }); eq(f.x, 1); eq(f.y, 0);          // nincs bemenet
  updateFacing(f, { x: 0.1, y: -0.1 }); eq(f.x, 1); eq(f.y, 0);     // holtsáv alatt
  updateFacing(f, { x: -0.2, y: -0.9 }); eq(f.x, 0); eq(f.y, -1);
  updateFacing(f, { x: 0.7, y: 0.7 }); eq(f.x, 0); eq(f.y, 1);       // átló: a jelenlegi (függőleges) tengely marad
  updateFacing(f, { x: -0.8, y: 0.1 }); eq(f.x, -1); eq(f.y, 0);
  updateFacing(f, { x: 0.6, y: -0.6 }); eq(f.x, 1); eq(f.y, 0);      // átló: a vízszintes tengely marad
  updateFacing(f, { x: NaN, y: undefined }); eq(f.x, 1); eq(f.y, 0); // hibás bemenet nem változtat
  updateFacing(f, { x: 0, y: -0.5 }, 0.6); eq(f.x, 1);               // saját holtsáv-paraméter
});

test('interact: zóna a játékos előtt mind a 4 irányban (méret, elhelyezés)', () => {
  const cfg = INTERACT_CONFIG, p = player(100, 100);
  let z = interactZone(p, { x: 1, y: 0 });
  eq(z.x, 112); eq(z.w, cfg.reach); eq(z.h, cfg.width); near(z.y + z.h / 2, 100);
  z = interactZone(p, { x: -1, y: 0 });
  eq(z.x + z.w, 88); eq(z.w, cfg.reach); near(z.y + z.h / 2, 100);
  z = interactZone(p, { x: 0, y: 1 });
  eq(z.y, 112); eq(z.h, cfg.reach); eq(z.w, cfg.width); near(z.x + z.w / 2, 100);
  z = interactZone(p, { x: 0, y: -1 });
  eq(z.y + z.h, 88); eq(z.h, cfg.reach); near(z.x + z.w / 2, 100);
  const q = interactZone({ x: 0, y: 0 }, { x: 1, y: 0 });      // hiányzó méret -> tartalék
  eq(q.x, cfg.playerSize / 2);
});

// --- célpont ---
test('interact: a célpont csak elöl, a zónában, a tárgy-típus regisztrált', () => {
  const { o, p } = treeAhead('t1');
  const { sys } = mkSys([o]);
  stepInteraction(sys, [p, player(9999, 9999)], [{ x: 1, y: 0, interact: false }, IDLE], DT);
  assert(targetOf(sys, 0) && targetOf(sys, 0).ref === o, 'elöl: célpont');
  eq(targetOf(sys, 0).kind, 'object'); eq(targetOf(sys, 0).action, 'examine');
  assert(targetOf(sys, 1) === null, 'a távoli játékosnak nincs célpontja');
  stepInteraction(sys, [p, player(9999, 9999)], [{ x: -1, y: 0, interact: false }, IDLE], DT); // hátrafordul
  assert(targetOf(sys, 0) === null, 'mögötte nem');
  stepInteraction(sys, [p, player(9999, 9999)], [{ x: 1, y: 0, interact: false }, IDLE], DT);
  p.x -= INTERACT_CONFIG.reach + 20;                                                              // túl messze
  stepInteraction(sys, [p, player(9999, 9999)], [{ x: 1, y: 0, interact: false }, IDLE], DT);
  assert(targetOf(sys, 0) === null, 'túl messze nem');
  p.x += INTERACT_CONFIG.reach + 20; p.y += 200;                                                  // oldalt, a zónán kívül
  stepInteraction(sys, [p, player(9999, 9999)], [{ x: 1, y: 0, interact: false }, IDLE], DT);
  assert(targetOf(sys, 0) === null, 'oldalt nem');
  const odd = createObject('stone', 200, 200, 's1'); odd.type = 'ismeretlen';
  const m = mkSys([odd]);
  const pp = player(odd.x - 20, odd.y - 6);
  stepInteraction(m.sys, [pp, player(9999, 9999)], [{ x: 1, y: 0, interact: false }, IDLE], DT);
  assert(targetOf(m.sys, 0) === null, 'nem regisztrált típus nem interaktív');
});

test('interact: a legközelebbi tárgy a célpont, döntetlennél a kisebb kulcs', () => {
  const a = createObject('tree', 200, 200, 'a'), b = createObject('tree', 200, 232, 'b');
  const ra = objectCollider(a);
  const p = player(ra.x - 12 - 6, 200 - 4);
  const { sys } = mkSys([b, a]);
  stepInteraction(sys, [p, player(9999, 9999)], [{ x: 1, y: 0, interact: false }, IDLE], DT);
  const t = targetOf(sys, 0);
  assert(t !== null, 'van célpont');
  const d = (o) => { const r = objectCollider(o); const oy = p.y; return Math.max(r.y - oy, 0, oy - (r.y + r.h)); };
  eq(t.ref, d(a) <= d(b) ? a : b, 'a közelebbi');
  const c1 = createObject('tree', 200, 200, 'z'), c2 = createObject('tree', 200, 200, 'm'); // azonos hely
  const m = mkSys([c1, c2]);
  const pp = player(objectCollider(c1).x - 12 - 6, 190);
  stepInteraction(m.sys, [pp, player(9999, 9999)], [{ x: 1, y: 0, interact: false }, IDLE], DT);
  eq(targetOf(m.sys, 0).key, 'obj:m', 'döntetlen: kisebb kulcs');
  stepInteraction(m.sys, [pp, player(9999, 9999)], [IDLE, IDLE], DT);
  eq(targetOf(m.sys, 0).key, 'obj:m', 'stabil');
});

test('interact: az eddigi célpont tapad (nincs villogás), nagy különbségnél vált', () => {
  const cfg = INTERACT_CONFIG;
  const fake = (key, x) => ({ key, kind: 'x', ref: key, action: 'use', rect: { x, y: 90, w: 10, h: 20 }, ax: x, ay: 90 });
  const items = [fake('A', 130), fake('B', 128)];
  const sys = createInteractSystem();
  addProvider(sys, (zone, out) => { for (const c of items) out.push(c); return out; });
  const p = player(100, 100);
  items[1].rect.x = 140;                                   // csak A közelebbi
  stepInteraction(sys, [p], [{ x: 1, y: 0 }], DT);
  eq(targetOf(sys, 0).key, 'A');
  items[1].rect.x = 129;                                   // B hajszállal közelebb: A tapad
  stepInteraction(sys, [p], [{ x: 1, y: 0 }], DT);
  eq(targetOf(sys, 0).key, 'A', 'tapad');
  items[0].rect.x = 139; items[1].rect.x = 114;           // B sokkal közelebb: vált
  stepInteraction(sys, [p], [{ x: 1, y: 0 }], DT);
  eq(targetOf(sys, 0).key, 'B', 'vált');
  assert(cfg.stickiness < 1);
});

// --- egy gomb ---
test('interact: a gomb lenyomásának éle váltja ki, az esemény mezői helyesek', () => {
  const { o, r, p } = treeAhead('t1');
  const { sys } = mkSys([o]);
  const seen = [];
  onInteract(sys, (e) => seen.push(e));
  const ps = [p, player(9999, 9999)];
  stepInteraction(sys, ps, [{ x: 1, y: 0, interact: false }, IDLE], DT);
  eq(seen.length, 0, 'gomb nélkül nincs esemény');
  const ev = stepInteraction(sys, ps, [{ x: 1, y: 0, interact: true }, IDLE], DT);
  eq(ev.length, 1); eq(seen.length, 1);
  const e = seen[0];
  eq(e.type, 'interact'); eq(e.player, 0); eq(e.action, 'examine'); eq(e.key, 'obj:t1'); eq(e.target, o);
  near(e.x, r.x + r.w / 2); near(e.y, r.y + r.h / 2); eq(sys.total, 1); eq(sys.players[0].count, 1);
  for (let i = 0; i < 120; i++) stepInteraction(sys, ps, [{ x: 1, y: 0, interact: true }, IDLE], DT); // nyomva tartva
  eq(seen.length, 1, 'nyomva tartva egyszer sül el');
});

test('interact: nincs esemény célpont nélkül; interactPressed is kiváltja; cooldown', () => {
  const { o, p } = treeAhead('t1');
  const { sys } = mkSys([o]);
  const far = player(5000, 5000);
  stepInteraction(sys, [far, far], [PRESS, IDLE], DT);
  eq(sys.total, 0, 'célpont nélkül nincs');
  const c = sys.cfg.cooldown;
  stepInteraction(sys, [p, far], [{ x: 1, y: 0, interact: false, interactPressed: true }, IDLE], DT);
  eq(sys.total, 1, 'interactPressed');
  stepInteraction(sys, [p, far], [{ x: 1, y: 0, interact: false, interactPressed: true }, IDLE], DT);
  eq(sys.total, 1, 'cooldown blokkol');
  for (let i = 0; i < Math.ceil(c / DT) + 1; i++) stepInteraction(sys, [p, far], [IDLE, IDLE], DT);
  stepInteraction(sys, [p, far], [{ x: 1, y: 0, interact: true }, IDLE], DT);
  eq(sys.total, 2, 'cooldown után újra');
  const z = mkSys([o], { cfg: { cooldown: 0 } });
  stepInteraction(z.sys, [p, far], [{ x: 1, y: 0, interact: true }, IDLE], DT);
  stepInteraction(z.sys, [p, far], [IDLE, IDLE], DT);
  stepInteraction(z.sys, [p, far], [{ x: 1, y: 0, interact: true }, IDLE], DT);
  eq(z.sys.total, 2, 'cooldown nélkül minden él');
});

// --- két játékos ---
test('interact: a két játékos egyszerre is interakcióba léphet (azonos és külön célpont)', () => {
  const a = createObject('tree', 200, 200, 'a'), b = createObject('stone', 600, 200, 'b');
  const ra = objectCollider(a), rb = objectCollider(b);
  const p0 = player(ra.x - 12 - 6, ra.y + ra.h / 2);           // jobbra néz az `a`-ra
  const p1 = player(ra.x + ra.w + 12 + 6, ra.y + ra.h / 2);    // balra néz az `a`-ra
  const { sys } = mkSys([a, b]);
  const seen = []; onInteract(sys, (e) => seen.push(e));
  const ev = stepInteraction(sys, [p0, p1], [{ x: 1, y: 0, interact: true }, { x: -1, y: 0, interact: true }], DT);
  eq(ev.length, 2, 'mindkettő sül'); eq(seen[0].player, 0); eq(seen[1].player, 1);
  eq(seen[0].key, 'obj:a'); eq(seen[1].key, 'obj:a');
  assert(sys.feedback.length === 2, 'két visszajelző');
  // külön célpont, külön cooldown
  const q1 = player(rb.x + rb.w / 2, rb.y - 12 - 6);          // lefelé néz a `b`-re
  for (let i = 0; i < 30; i++) stepInteraction(sys, [p0, q1], [IDLE, { x: 0, y: 1, interact: false }], DT);
  seen.length = 0;
  stepInteraction(sys, [p0, q1], [{ x: 1, y: 0, interact: true }, { x: 0, y: 1, interact: true }], DT);
  eq(seen.length, 2); eq(seen[0].key, 'obj:a'); eq(seen[1].key, 'obj:b');
  // csak az egyik nyom
  seen.length = 0;
  for (let i = 0; i < 30; i++) stepInteraction(sys, [p0, q1], [IDLE, IDLE], DT);
  stepInteraction(sys, [p0, q1], [IDLE, { x: 0, y: 1, interact: true }], DT);
  eq(seen.length, 1); eq(seen[0].player, 1);
  eq(sys.players[0].facing.x, 1); eq(sys.players[1].facing.y, 1);
});

// --- változó világ ---
test('interact: eldobott chunk / eltűnt tárgy -> a célpont megszűnik, nem sül el', () => {
  const { o, p } = treeAhead('t1');
  const { sys, os } = mkSys([o]);
  const far = player(5000, 5000);
  stepInteraction(sys, [p, far], [{ x: 1, y: 0, interact: false }, IDLE], DT);
  assert(targetOf(sys, 0) !== null);
  os.chunks.get('0,0').list.length = 0;
  const ev = stepInteraction(sys, [p, far], [{ x: 1, y: 0, interact: true }, IDLE], DT);
  assert(targetOf(sys, 0) === null); eq(ev.length, 0);
  os.chunks.get('0,0').list.push(o);
  stepInteraction(sys, [p, far], [IDLE, IDLE], DT);
  assert(targetOf(sys, 0) !== null, 'visszatér');
  os.chunks.clear();
  stepInteraction(sys, [p, far], [IDLE, IDLE], DT);
  assert(targetOf(sys, 0) === null, 'chunk nélkül nincs');
});

// --- regisztráció és források ---
test('interact: típus-regisztráció (defineInteractable) és a prompt-horgony', () => {
  const o = createObject('tree', 200, 200, 't1');
  const spr = OBJECT_DEFS.tree.sprite;
  const { sys } = mkSys([o]);
  const p = player(objectCollider(o).x - 12 - 6, objectCollider(o).y + 2);
  stepInteraction(sys, [p, player(9999, 9999)], [{ x: 1, y: 0 }, IDLE], DT);
  const t = targetOf(sys, 0);
  near(t.ax, o.x - spr.ax + spr.w / 2); near(t.ay, o.y - spr.ay);                       // a sprite teteje, középen
  assert(defineInteractable(sys, 'tree', { action: 'gather' }));
  stepInteraction(sys, [p, player(9999, 9999)], [{ x: 1, y: 0 }, IDLE], DT);
  eq(targetOf(sys, 0).action, 'gather', 'élő átírás');
  assert(!defineInteractable(sys, 'tree', { action: '' }) && !defineInteractable(sys, '', { action: 'x' }) && !defineInteractable(sys, 'tree', {}), 'hibás def elutasítva');
  assert(defineInteractable(sys, 'tree', null));
  stepInteraction(sys, [p, player(9999, 9999)], [{ x: 1, y: 0 }, IDLE], DT);
  assert(targetOf(sys, 0) === null, 'törölt típus nem interaktív');
  assert(INTERACT_DEFS.tree.action === 'examine', 'az alap-regisztráció nem módosult (másolat)');
  const w = mkSys([Object.assign(createObject('stone', 200, 200, 's'), { type: 'constructor' })]);
  stepInteraction(w.sys, [p, player(9999, 9999)], [{ x: 1, y: 0 }, IDLE], DT);
  assert(targetOf(w.sys, 0) === null, 'prototípus-kulcs nem interaktív');
});

test('interact: egyedi forrás, hibás jelöltek kiesnek, nem-függvény elutasítva', () => {
  const sys = createInteractSystem();
  assert(!addProvider(sys, 5) && !addProvider(sys, null));
  addProvider(sys, (zone, out) => {
    out.push({ key: 'npc:1', kind: 'npc', ref: 1, action: 'talk', rect: { x: 118, y: 90, w: 12, h: 20 }, ax: 124, ay: 80 });
    out.push({ key: 'bad:1', kind: 'x', action: 'use' });                                       // nincs rect
    out.push({ key: 'bad:2', kind: 'x', action: 'use', rect: { x: NaN, y: 0, w: 5, h: 5 } });   // NaN
    out.push(null);
    return out;
  });
  stepInteraction(sys, [player(100, 100)], [{ x: 1, y: 0, interact: true }], DT);
  eq(sys.total, 1); eq(sys.events[0].action, 'talk'); eq(sys.events[0].kind, 'npc');
  assert(!objectProvider(null, {})({ x: 0, y: 0, w: 1, h: 1 }, [], INTERACT_CONFIG).length, 'hibás tár nem dob');
  assert(!objectProvider({ chunks: 5 }, {})({ x: 0, y: 0, w: 1, h: 1 }, [], INTERACT_CONFIG).length, 'hibás chunks nem dob');
});

test('interact: a tárgy-forrás előszűrője (csak a zóna közelében lévők, NaN kiesik)', () => {
  const near1 = createObject('tree', 300, 300, 'n'), far1 = createObject('tree', 300 + 5000, 300, 'f');
  const bad = createObject('tree', 300, 300, 'b'); bad.x = NaN;
  const os = store([near1, far1, bad]);
  const defs = { tree: { action: 'examine' } };
  const out = objectProvider(os, defs)({ x: 280, y: 280, w: 40, h: 28 }, [], INTERACT_CONFIG);
  eq(out.length, 1); eq(out[0].key, 'obj:n'); eq(out[0].kind, 'object'); eq(out[0].ref, near1);
  const wide = objectProvider(os, defs)({ x: 280, y: 280, w: 40, h: 28 }, [], Object.assign({}, INTERACT_CONFIG, { prefilter: 512 }));
  eq(wide.length, 1, 'a távoli továbbra sem');
});

test('interact: feliratkozás/leválasztás; a hibázó figyelő nem állítja meg a többit', () => {
  const { o, p } = treeAhead('t1');
  const { sys } = mkSys([o]);
  let n = 0, m = 0;
  const off = onInteract(sys, () => n++);
  onInteract(sys, () => { throw new Error('szándékos'); });
  onInteract(sys, () => m++);
  const old = console.error; console.error = () => {};
  try { stepInteraction(sys, [p, player(9999, 9999)], [{ x: 1, y: 0, interact: true }, IDLE], DT); } finally { console.error = old; }
  eq(n, 1); eq(m, 1); eq(sys.lastError, 'szándékos');
  off();
  for (let i = 0; i < 30; i++) stepInteraction(sys, [p, player(9999, 9999)], [IDLE, IDLE], DT);
  const old2 = console.error; console.error = () => {};
  try { stepInteraction(sys, [p, player(9999, 9999)], [{ x: 1, y: 0, interact: true }, IDLE], DT); } finally { console.error = old2; }
  eq(n, 1, 'leválasztva'); eq(m, 2);
  assert(typeof onInteract(sys, 5) === 'function', 'hibás figyelő: no-op leválasztó');
});

test('interact: visszajelző gyűrű lejár és korlátozott számú', () => {
  const { o, p } = treeAhead('t1');
  const { sys } = mkSys([o], { cfg: { cooldown: 0 } });
  const far = player(5000, 5000);
  stepInteraction(sys, [p, far], [{ x: 1, y: 0, interact: true }, IDLE], DT);
  eq(sys.feedback.length, 1);
  for (let i = 0; i < Math.ceil(sys.cfg.feedbackTime / DT) + 2; i++) stepInteraction(sys, [p, far], [IDLE, IDLE], DT);
  eq(sys.feedback.length, 0, 'lejárt');
  for (let i = 0; i < 100; i++) { stepInteraction(sys, [p, far], [IDLE, IDLE], DT); stepInteraction(sys, [p, far], [{ x: 1, y: 0, interact: true }, IDLE], 0); }
  assert(sys.feedback.length <= 16, 'korlát: ' + sys.feedback.length);
});

test('interact: hibás bemenet nem dob (hiányzó/NaN játékos, input, dt)', () => {
  const { o, p } = treeAhead('t1');
  const { sys } = mkSys([o]);
  stepInteraction(sys, [], [], DT);
  stepInteraction(sys, null, null, DT);
  stepInteraction(sys, [null, { x: NaN, y: 1 }], [undefined, { x: NaN, y: NaN, interact: true }], NaN);
  stepInteraction(sys, [p], [{ x: 'a', y: null, interact: 1 }], -5);
  stepInteraction(sys, [p, player(0, 0)], undefined, Infinity);
  assert(Number.isFinite(sys.time), 'idő véges: ' + sys.time);
  assert(targetOf(sys, 5) === null, 'ismeretlen játékos');
});
