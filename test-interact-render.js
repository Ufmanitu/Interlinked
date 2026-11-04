// S016 tesztek: a prompt rajza (fake ctx) és a 600 kockás smoke két mozgó játékossal, véletlen tárgyakkal.
import { test, assert, eq, near } from './test-index.js';
import { INTERACT_CONFIG, createInteractSystem, addObjectSource, onInteract, targetOf, stepInteraction } from './game-interact.js';
import { PROMPT_CONFIG, INTERACT_TEXT, promptText, drawInteractPrompts } from './render-interact.js';
import { OBJECT_DEFS, createObject, objectCollider } from './world-objects.js';

const DT = 1 / 60;
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
function treeAhead(id, gap = 8) {
  const o = createObject('tree', 200, 200, id);
  const r = objectCollider(o);
  const p = player(r.x - 12 - gap, r.y + r.h / 2);
  return { o, r, p };
}
function fakeCtx() {
  const calls = [];
  let saves = 0;
  const ctx = {
    calls, font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, textAlign: 'left', textBaseline: 'alphabetic',
    save() { saves++; calls.push(['save']); }, restore() { saves--; calls.push(['restore']); },
    measureText(t) { return { width: String(t).length * 6 }; },
    fillRect(...a) { calls.push(['fillRect', ...a]); }, strokeRect(...a) { calls.push(['strokeRect', ...a]); },
    fillText(...a) { calls.push(['fillText', ...a]); }, beginPath() { calls.push(['beginPath']); },
    arc(...a) { calls.push(['arc', ...a]); }, stroke() { calls.push(['stroke']); },
    get depth() { return saves; },
  };
  return ctx;
}
function texts(ctx) { return ctx.calls.filter(c => c[0] === 'fillText').map(c => c[1]); }
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

// --- rajz ---
test('interact render: prompt a célpont fölött, gomb-felirat és akció-szöveg; állapot visszaáll', () => {
  const { o, p } = treeAhead('t1');
  const { sys } = mkSys([o]);
  stepInteraction(sys, [p, player(5000, 5000)], [{ x: 1, y: 0 }, IDLE], DT);
  const ctx = fakeCtx();
  const n = drawInteractPrompts(ctx, sys, 100, 50, 960, 540);
  eq(n, 1); eq(ctx.depth, 0, 'save/restore egyensúly');
  const tx = texts(ctx);
  assert(tx.includes('F') && tx.includes('Megnéz'), 'felirat: ' + tx.join('|'));
  const spr = OBJECT_DEFS.tree.sprite, topY = o.y - spr.ay - 50;
  const boxes = ctx.calls.filter(c => c[0] === 'fillRect');
  assert(boxes.length >= 2, 'doboz + gomb');
  assert(boxes[0][2] + boxes[0][4] <= topY, 'a doboz a sprite teteje fölött van (bob nélkül ±1): ' + (boxes[0][2] + boxes[0][4]) + ' <= ' + topY);
  assert(ctx.fillStyle !== undefined);
  const en = fakeCtx(); drawInteractPrompts(en, sys, 100, 50, 960, 540, { lang: 'en' });
  assert(texts(en).includes('Look'), 'EN szöveg');
  eq(promptText('ismeretlen', 'hu'), INTERACT_TEXT.hu['act.default']); eq(promptText('examine', 'xx'), INTERACT_TEXT.hu['act.examine']);
});

test('interact render: két játékos, azonos célpont -> két prompt egymás mellett, saját színnel', () => {
  const a = createObject('tree', 200, 200, 'a'), ra = objectCollider(a);
  const p0 = player(ra.x - 12 - 6, ra.y + ra.h / 2), p1 = player(ra.x + ra.w + 12 + 6, ra.y + ra.h / 2);
  const { sys } = mkSys([a]);
  stepInteraction(sys, [p0, p1], [{ x: 1, y: 0 }, { x: -1, y: 0 }], DT);
  const ctx = fakeCtx();
  const colors = [];
  const orig = Object.getOwnPropertyDescriptor(ctx, 'strokeStyle');
  let cur = ''; Object.defineProperty(ctx, 'strokeStyle', { get() { return cur; }, set(v) { cur = v; colors.push(v); } });
  eq(drawInteractPrompts(ctx, sys, 0, 0, 960, 540), 2);
  assert(orig !== undefined);
  const frames = ctx.calls.filter(c => c[0] === 'strokeRect');
  eq(frames.length, 2);
  assert(frames[0][1] + frames[0][3] <= frames[1][1], 'nem fedik egymást');
  assert(colors.includes(PROMPT_CONFIG.colors[0]) && colors.includes(PROMPT_CONFIG.colors[1]), 'P1 kék, P2 piros');
  const t = texts(ctx); eq(t.filter(s => s === 'Megnéz').length, 2); assert(t.includes('F') && t.includes(','), 'két gomb-felirat');
});

test('interact render: nézeten kívüli/üres -> nincs rajz; gyűrű és zóna-keret', () => {
  const { o, p } = treeAhead('t1');
  const { sys } = mkSys([o]);
  const ctx0 = fakeCtx();
  eq(drawInteractPrompts(ctx0, sys, 0, 0, 960, 540), 0, 'üres rendszer');
  eq(texts(ctx0).length, 0); eq(ctx0.depth, 0);
  stepInteraction(sys, [p, player(5000, 5000)], [{ x: 1, y: 0, interact: true }, IDLE], DT);
  const off = fakeCtx();
  eq(drawInteractPrompts(off, sys, 100000, 100000, 960, 540), 0, 'nézeten kívül nincs prompt');
  assert(!off.calls.some(c => c[0] === 'arc'), 'nézeten kívül nincs gyűrű');
  const ring = fakeCtx();
  eq(drawInteractPrompts(ring, sys, 0, 0, 960, 540, { debug: true }), 1);
  assert(ring.calls.some(c => c[0] === 'arc'), 'gyűrű');
  assert(ring.calls.filter(c => c[0] === 'strokeRect').length >= 2, 'zóna-keret (debug)');
  eq(ring.globalAlpha, 1, 'alpha visszaáll'); eq(ring.depth, 0);
  eq(drawInteractPrompts(null, sys, 0, 0, 1, 1), 0); eq(drawInteractPrompts(ring, null, 0, 0, 1, 1), 0);
});

// --- 600 kocka, két szkriptelt játékos, véletlen tárgyak ---
test('interact smoke: 600 kocka két mozgó játékossal (invariánsok, nincs NaN)', () => {
  const rnd = lcg(16016);
  const objs = [];
  for (let i = 0; i < 220; i++) objs.push(createObject(rnd() < 0.7 ? 'tree' : 'stone', Math.floor(rnd() * 1600), Math.floor(rnd() * 900), 'o' + i));
  const { sys, os } = mkSys(objs);
  const ps = [player(100, 100), player(900, 500)];
  const keys = new Set(objs.map(o => 'obj:' + o.id));
  const last = [-1, -1];
  let events = 0, targeted = 0;
  for (let f = 0; f < 600; f++) {
    const inputs = ps.map((p, i) => {
      const a = (f * (0.03 + i * 0.017) + i * 2) % (Math.PI * 2);
      const inp = { x: Math.cos(a), y: Math.sin(a * 1.3), interact: rnd() < 0.08 };
      p.x += inp.x * 2; p.y += inp.y * 2;
      return inp;
    });
    if (f === 300) os.chunks.get('0,0').list.splice(0, 100);          // chunk-változás menet közben
    const ev = stepInteraction(sys, ps, inputs, DT);
    events += ev.length;
    for (let i = 0; i < 2; i++) {
      const st = sys.players[i], t = st.target, z = st.zone;
      assert(Number.isFinite(z.x) && Number.isFinite(z.y) && Number.isFinite(z.w) && Number.isFinite(z.h), 'zóna véges');
      assert(Math.abs(st.facing.x) + Math.abs(st.facing.y) === 1, 'facing: pontosan egy tengely');
      if (t) {
        targeted++;
        assert(keys.has(t.key), 'ismert kulcs');
        const pad = sys.cfg.pad, r = t.rect;
        assert(z.x < r.x + r.w + pad && r.x - pad < z.x + z.w && z.y < r.y + r.h + pad && r.y - pad < z.y + z.h, 'a célpont érinti a zónát');
      }
    }
    for (const e of ev) {
      assert(e.player === 0 || e.player === 1, 'játékos-index');
      if (last[e.player] >= 0) assert(sys.time - last[e.player] >= sys.cfg.cooldown - 1e-9, 'cooldown betartva');
      last[e.player] = sys.time;
      assert(Number.isFinite(e.x) && Number.isFinite(e.y), 'esemény koordináta véges');
    }
  }
  eq(sys.total, events); eq(sys.players[0].count + sys.players[1].count, events);
  assert(targeted > 0, 'volt célpont');
  assert(sys.feedback.length <= 16);
  const ctx = fakeCtx();
  for (let k = 0; k < 5; k++) drawInteractPrompts(ctx, sys, 0, 0, 960, 540, { debug: k % 2 === 0 });
  eq(ctx.depth, 0);
});
