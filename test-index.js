// Minimális tesztfutó (böngésző és Node). A test-*.js fájlok a FILES listában vannak.
import { computeScale, VIRTUAL_W, VIRTUAL_H } from './core-screen.js';

const FILES = ['./test-player.js', './test-camera.js', './test-tether.js', './test-smoke.js']; // további test-*.js fájlok ide
const tests = [];

export function test(name, fn) { tests.push({ name, fn }); }

export function assert(cond, msg = 'assert') {
  if (!cond) throw new Error(msg);
}
export function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} várt: ${b}, kapott: ${a}`.trim());
}
export function near(a, b, eps = 1e-6, msg = '') {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${msg} várt: ${b}±${eps}, kapott: ${a}`.trim());
}

// beépített alap-tesztek
test('screen: virtuális felbontás', () => {
  eq(VIRTUAL_W, 960); eq(VIRTUAL_H, 540);
});
test('screen: egész számú skála', () => {
  eq(computeScale(1920, 1080), 2);
  eq(computeScale(3840, 2160), 4);
  eq(computeScale(1000, 1000), 1);
  eq(computeScale(300, 200), 1);
});

export async function runAll() {
  for (const f of FILES) await import(f);
  const results = [];
  for (const t of tests) {
    try { await t.fn(); results.push({ name: t.name, ok: true }); }
    catch (e) { results.push({ name: t.name, ok: false, err: e && e.message ? e.message : String(e) }); }
  }
  return results;
}

export function formatResults(results) {
  const fail = results.filter(r => !r.ok).length;
  const lines = results.map(r => (r.ok ? 'OK   ' : 'FAIL ') + r.name + (r.ok ? '' : ' -> ' + r.err));
  return { ok: fail === 0, title: `${results.length - fail}/${results.length}`, lines };
}

// Node: `node test-index.js`
if (typeof process !== 'undefined' && process.argv && /test-index\.js$/.test(process.argv[1] || '')) {
  runAll().then(r => {
    const f = formatResults(r);
    console.log(f.lines.join('\n'));
    console.log(f.title);
    process.exit(f.ok ? 0 : 1);
  });
}
