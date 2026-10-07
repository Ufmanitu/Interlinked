// Node-ban futtatható füstteszt: node test-smoke.js
import { createLoop } from './main.js';
import { Input } from './core-input.js';
import { createDebug } from './core-debug.js';
import { W, H } from './core-screen.js';
import { VERSION } from './version.js';
import { run } from './test-index.js';

let fail = 0;
const check = (c, m) => { if (!c) { fail++; console.error('SMOKE FAIL: ' + m); } };
check(W === 960 && H === 540 && VERSION.step, 'alapadatok');

const input = new Input({ target: null, nav: { getGamepads: () => [] } });
let steps = 0;
const loop = createLoop({
  step: () => {
    const f = steps;
    input.setKey('KeyD', f % 120 < 60); input.setKey('ArrowLeft', f % 90 < 45); input.setKey('KeyE', f % 30 === 0);
    input.update();
    for (const p of input.players) {
      check(Number.isFinite(p.x) && Number.isFinite(p.y), 'NaN bemenet @' + f);
      check(Math.hypot(p.x, p.y) <= 1 + 1e-9, 'tengely > 1 @' + f);
    }
    steps++;
  },
  render: () => {},
});
for (let i = 0; i < 600; i++) loop.frame(1000 / 60);
check(steps === 600, 'lépésszám ' + steps);

const dbg = createDebug();
dbg.log('x');
check(dbg.lines.length === 1, 'debug DOM nélkül');

const r = run();
console.log(r.lines.join('\n'));
if (!r.ok) fail++;
console.log(fail ? 'SMOKE: HIBA' : 'SMOKE: OK');
process.exit(fail ? 1 : 0);
