// Minimális tesztfutó. A test-*.js fájlok innen importálnak (nincs körkörös import).
const tests = [];
export const test = (name, fn) => tests.push({ name, fn });
export const assert = (c, m = 'assertion') => { if (!c) throw new Error(m); };
export const eq = (a, b, m = '') => { if (a !== b) throw new Error(`${m} várt: ${b}, kapott: ${a}`); };
export const near = (a, b, eps = 1e-6, m = '') => { if (!(Math.abs(a - b) <= eps)) throw new Error(`${m} várt: ${b}, kapott: ${a}`); };
export function run() {
  const lines = [];
  let failed = 0;
  for (const t of tests) {
    try { t.fn(); lines.push('OK   ' + t.name); }
    catch (e) { failed++; lines.push('FAIL ' + t.name + ' — ' + e.message); }
  }
  lines.push(`${tests.length - failed}/${tests.length} OK`);
  return { passed: tests.length - failed, failed, lines, ok: failed === 0 };
}
