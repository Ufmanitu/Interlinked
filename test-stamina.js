// S048: stamina (húzás + sprint + gyűjtés) tesztek
import { test, assert, eq, near } from './test-index.js';
import { STAMINA_PULL, STAMINA_ACT, sanitizeAct, ensureStamina, canSprint, wantsSprint, sprintMul, workMul, stepStamina } from './game-stamina.js';
import { createTetherSystem, stepTetherSystem, stepPullStamina } from './tether-system.js';
import { createPlayer } from './game-player.js';
import { Input, ACTIONS, DEFAULT_KEYS } from './core-input.js';

const mk = () => [{}, {}];
const NONE = { x: 'free', y: 'free' };

test('stamina: konfig és hibás bemenet', () => {
  eq(sanitizeAct(null).sprintMul, STAMINA_ACT.sprintMul);
  eq(sanitizeAct({ sprintMul: NaN, sprintCost: -5 }).sprintMul, STAMINA_ACT.sprintMul);
  eq(sanitizeAct({ sprintCost: -5 }).sprintCost, 0);
  eq(sanitizeAct({ sprintMul: 99 }).sprintMul, 4);
  const p = { stamina: NaN, staminaMax: -3, exhausted: 1 };
  ensureStamina(p);
  eq(p.staminaMax, 100); eq(p.stamina, 100); eq(p.exhausted, true);
  eq(sprintMul(true), STAMINA_ACT.sprintMul); eq(sprintMul(false), 1);
  eq(workMul(null), 1); eq(workMul({ exhausted: true }), STAMINA_ACT.workMulExhausted); eq(workMul({}), 1);
});

test('stamina: húzás-költség a régi szabály szerint (burkoló)', () => {
  const ps = mk();
  stepPullStamina(ps, { x: 'pull-a', y: 'free' }, 1, true);
  near(ps[0].stamina, 80); near(ps[1].stamina, 100);
  for (let i = 0; i < 4; i++) stepPullStamina(ps, { x: 'pull-a', y: 'free' }, 1, true);
  eq(ps[0].stamina, 0); eq(ps[0].exhausted, true);
  stepPullStamina(ps, NONE, 1, true); // +15 < 20 -> még kimerült
  eq(ps[0].exhausted, true);
  stepPullStamina(ps, NONE, 1, true); // 30 >= 20
  eq(ps[0].exhausted, false);
  const q = mk(); stepPullStamina(q, { x: 'pull-b', y: 'free' }, 1, false);
  eq(q[1].stamina, 100); // kikapcsolva nincs költség
});

test('stamina: sprint fogyaszt, kimerít, felépül', () => {
  const ps = mk();
  stepStamina(ps, NONE, { sprint: [true, false] }, 1, false);
  near(ps[0].stamina, 100 - STAMINA_ACT.sprintCost); eq(ps[1].stamina, 100);
  for (let i = 0; i < 6; i++) stepStamina(ps, NONE, { sprint: [true, false] }, 1, false);
  eq(ps[0].stamina, 0); eq(ps[0].exhausted, true); eq(canSprint(ps[0]), false);
  for (let i = 0; i < 3; i++) stepStamina(ps, NONE, null, 1, false);
  eq(ps[0].exhausted, false); assert(canSprint(ps[0]));
});

test('stamina: gyűjtés fogyaszt; kimerülten nem (pihen)', () => {
  const ps = mk();
  stepStamina(ps, NONE, { gather: [false, true] }, 2, false);
  near(ps[1].stamina, 100 - 2 * STAMINA_ACT.gatherCost);
  ps[1].stamina = 0; ps[1].exhausted = true;
  stepStamina(ps, NONE, { gather: [false, true] }, 1, false);
  near(ps[1].stamina, 15); // regenerál, nem fogyaszt
});

test('stamina: költségek összeadódnak, dt=0 / hibás játékos nem dob', () => {
  const ps = mk();
  stepStamina(ps, { x: 'pull-a', y: 'free' }, { sprint: [true], gather: [true] }, 1, true);
  near(ps[0].stamina, 100 - 20 - STAMINA_ACT.sprintCost - STAMINA_ACT.gatherCost);
  const before = ps[0].stamina;
  stepStamina(ps, NONE, { sprint: [true] }, 0, true);
  eq(ps[0].stamina, before);
  stepStamina([{ stamina: 'x', staminaMax: null }], null, null, NaN, true);
});

test('stamina: sprint-szándék csak mozgással', () => {
  assert(wantsSprint({ sprint: true, x: 1, y: 0 }));
  assert(!wantsSprint({ sprint: true, x: 0, y: 0 }));
  assert(!wantsSprint({ sprint: false, x: 1, y: 0 }));
  assert(!wantsSprint(null));
});

test('stamina: bemenet sprint kiosztás', () => {
  assert(ACTIONS.includes('sprint'));
  assert(DEFAULT_KEYS[0].sprint && DEFAULT_KEYS[1].sprint && DEFAULT_KEYS[0].sprint !== DEFAULT_KEYS[1].sprint);
  const tgt = { listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } };
  const inp = new Input(tgt);
  tgt.listeners.keydown({ code: DEFAULT_KEYS[0].sprint, preventDefault() {} });
  inp.update();
  eq(inp.get(0).sprint, true); eq(inp.get(0).sprintPressed, true); eq(inp.get(1).sprint, false);
  inp.update(); eq(inp.get(0).sprintPressed, false);
});

function run(inp0, frames, cfg = {}) {
  const sys = createTetherSystem({ L: { x: 1e5, y: 1e5 }, pullStamina: false, ...cfg });
  const ps = [createPlayer(0, 0, 0), createPlayer(1, 40, 0)];
  for (let i = 0; i < frames; i++) stepTetherSystem(sys, ps, [inp0, {}], 1 / 60);
  return { sys, ps };
}

test('stamina: sprint gyorsabb a póráz-rendszerben, és fogyaszt', () => {
  const walk = run({ x: 1, y: 0 }, 30);
  const sprint = run({ x: 1, y: 0, sprint: true }, 30);
  assert(sprint.ps[0].x > walk.ps[0].x * 1.4, 'sprint ' + sprint.ps[0].x + ' vs ' + walk.ps[0].x);
  assert(sprint.ps[0].stamina < 100 && walk.ps[0].stamina === 100);
  eq(sprint.sys.sprint[0], true); eq(sprint.sys.sprint[1], false);
  eq(walk.ps[0].speedMul, undefined); // az ideiglenes szorzó nem szivárog
});

test('stamina: kimerülten nincs sprint; menü-bemenet (x=y=0) nem sprintel', () => {
  const sys = createTetherSystem({ L: { x: 1e5, y: 1e5 } });
  const ps = [createPlayer(0, 0, 0), createPlayer(1, 40, 0)];
  ps[0].stamina = 0; ps[0].exhausted = true;
  stepTetherSystem(sys, ps, [{ x: 1, y: 0, sprint: true }, { x: 0, y: 0, sprint: true }], 1 / 60);
  eq(sys.sprint[0], false); eq(sys.sprint[1], false);
});

test('stamina: speedMul megmarad sprint után (teher-szorzó)', () => {
  const sys = createTetherSystem({ L: { x: 1e5, y: 1e5 } });
  const ps = [createPlayer(0, 0, 0), createPlayer(1, 40, 0)];
  ps[0].speedMul = 0.5;
  stepTetherSystem(sys, ps, [{ x: 1, y: 0, sprint: true }, {}], 1 / 60);
  eq(ps[0].speedMul, 0.5);
});

test('stamina: 3000 kockás smoke, nincs NaN, 0..max', () => {
  const sys = createTetherSystem({ pullStamina: true });
  const ps = [createPlayer(0, 0, 0), createPlayer(1, 40, 0)];
  let s = 7; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 3000; i++) {
    ps.forEach(p => { p.gathering = rnd() < 0.3; });
    const inp = () => ({ x: Math.round(rnd() * 2 - 1), y: Math.round(rnd() * 2 - 1), sprint: rnd() < 0.5 });
    stepTetherSystem(sys, ps, [inp(), inp()], 1 / 60);
    for (const p of ps) assert(Number.isFinite(p.x + p.y + p.stamina) && p.stamina >= 0 && p.stamina <= p.staminaMax, 'invariáns ' + i);
  }
});
