// S018 tesztek: GameClock (idő, fázis, események, mentés, billentyűk) és a nap/éjszaka színezés (fake ctx) + smoke.
import { test, assert, eq, near } from './test-index.js';
import {
  DAY_MIN, MAX_ADVANCE, CLOCK_DEFAULTS, CLOCK_SPEEDS, PHASES, phaseAt, sanitizeClockConfig, createGameClock, clockInfo, clockRate,
  onClock, stepClock, setClockSpeed, stepClockSpeed, setClockTime, clockState, restoreClock, clockKeyAction, applyClockAction, bindClockKeys,
} from './game-clock.js';
import {
  DAYNIGHT_CONFIG, CLOCK_TEXT, tintAt, tintMix, createDayNight, stepDayNight, dayNightTint, drawDayNight, clockLabel, drawClockLabel,
} from './render-daynight.js';

const DT = 1 / 60;
function fakeCtx() {
  const calls = [];
  let depth = 0;
  const ctx = {
    calls, globalCompositeOperation: 'source-over', fillStyle: '', font: '', textAlign: 'left', textBaseline: 'alphabetic',
    save() { depth++; calls.push(['save']); }, restore() { depth--; calls.push(['restore']); },
    fillRect(...a) { calls.push(['fillRect', ...a, this.globalCompositeOperation, this.fillStyle]); },
    fillText(...a) { calls.push(['fillText', ...a, this.textAlign, this.fillStyle]); },
    get depth() { return depth; },
  };
  return ctx;
}
function run(clock, seconds, dt = 1) { // seconds valós másodperc, dt-s lépésekkel
  const evs = [];
  for (let s = 0; s < seconds; s += dt) for (const e of stepClock(clock, dt)) evs.push(e);
  return evs;
}
const lum = c => c[0] + c[1] + c[2];

test('clock konfig: alap, szorítás, hibás mezők', () => {
  eq(JSON.stringify(sanitizeClockConfig()), JSON.stringify(CLOCK_DEFAULTS));
  eq(JSON.stringify(sanitizeClockConfig(null)), JSON.stringify(CLOCK_DEFAULTS));
  const c = sanitizeClockConfig({ dayLength: 1, startHour: 99, speed: -3 });
  eq(c.dayLength, 30); eq(c.startHour, 23.99); eq(c.speed, 0);
  const d = sanitizeClockConfig({ dayLength: NaN, startHour: '8', speed: Infinity });
  eq(d.dayLength, CLOCK_DEFAULTS.dayLength); eq(d.startHour, CLOCK_DEFAULTS.startHour); eq(d.speed, CLOCK_DEFAULTS.speed);
  eq(sanitizeClockConfig({ dayLength: 1e9 }).dayLength, 86400);
});

test('clock kezdőidő és fázis-határok', () => {
  const c = createGameClock();
  const i = clockInfo(c);
  eq(i.day, 1); eq(i.hour, 8); eq(i.minute, 0); eq(i.phase, 'day'); eq(c.phase, 'day');
  const at = (h, m = 0) => phaseAt(h * 60 + m);
  eq(at(0), 'night'); eq(at(4, 59), 'night'); eq(at(5), 'dawn'); eq(at(7, 59), 'dawn'); eq(at(8), 'day');
  eq(at(17, 59), 'day'); eq(at(18), 'dusk'); eq(at(20, 59), 'dusk'); eq(at(21), 'night'); eq(at(23, 59), 'night');
  eq(phaseAt(DAY_MIN + 6 * 60), 'dawn'); eq(phaseAt(-60), 'night'); eq(phaseAt(NaN), 'day'); eq(phaseAt('x'), 'day'); eq(phaseAt(undefined), 'day');
  eq(PHASES.length, 4);
  eq(clockInfo(createGameClock({ startHour: 23.99 })).hour, 23);
  eq(clockInfo(createGameClock({ startHour: 0 })).hour, 0);
});

test('clock sebesség: 1 mp = 1,2 játékperc, egy nap = dayLength, szorzó, szünet', () => {
  const c = createGameClock();
  near(clockRate(c), 1.2, 1e-9);
  stepClock(c, 1);
  near(c.t, 480 + 1.2, 1e-9);
  const a = createGameClock();
  for (let i = 0; i < 72000; i++) stepClock(a, DT); // 1200 mp 60 fps-sel
  near(a.t, 480 + DAY_MIN, 1e-5, 'nap 60 fps-sel');
  const b = createGameClock();
  stepClock(b, 1200);
  near(b.t, 480 + DAY_MIN, 1e-9, 'nap egy lépésben');
  const f = createGameClock({ dayLength: 60, speed: 2 });
  stepClock(f, 30);
  near(f.t, 480 + DAY_MIN, 1e-9, 'rövid nap x2: 30 mp = 1 nap');
  const p = createGameClock({ speed: 0 });
  eq(stepClock(p, 100).length, 0); eq(p.t, 480);
  setClockSpeed(p, 4); near(clockRate(p), 4.8, 1e-9);
  eq(setClockSpeed(p, 99999), 1024); eq(setClockSpeed(p, -5), 0); eq(setClockSpeed(p, NaN), 0); eq(setClockSpeed(p, '3'), 0);
});

test('clock sebesség-létra és billentyűk', () => {
  const c = createGameClock();
  eq(stepClockSpeed(c, 1), 2); eq(stepClockSpeed(c, 1), 4); eq(stepClockSpeed(c, -1), 2);
  for (let i = 0; i < 30; i++) stepClockSpeed(c, 1);
  eq(c.speed, CLOCK_SPEEDS[CLOCK_SPEEDS.length - 1]);
  for (let i = 0; i < 30; i++) stepClockSpeed(c, -1);
  eq(c.speed, 0);
  c.speed = 3; eq(stepClockSpeed(c, 1), 4); c.speed = 3; eq(stepClockSpeed(c, -1), 2);
  eq(clockKeyAction({ code: 'PageUp' }), 'faster'); eq(clockKeyAction({ code: 'NumpadSubtract' }), 'slower'); eq(clockKeyAction({ code: 'End' }), 'reset');
  eq(clockKeyAction({ code: 'PageUp', ctrlKey: true }), null); eq(clockKeyAction({ code: 'KeyF' }), null); eq(clockKeyAction({ code: 'constructor' }), null); eq(clockKeyAction(null), null);
  const d = createGameClock({ speed: 2 });
  const handlers = [];
  const target = { addEventListener(t, h) { handlers.push([t, h]); }, removeEventListener(t, h) { const i = handlers.findIndex(x => x[1] === h); if (i >= 0) handlers.splice(i, 1); } };
  const unbind = bindClockKeys(d, target);
  eq(handlers.length, 1); eq(handlers[0][0], 'keydown');
  handlers[0][1]({ code: 'PageUp' }); eq(d.speed, 4);
  handlers[0][1]({ code: 'PageDown' }); handlers[0][1]({ code: 'PageDown' }); eq(d.speed, 1);
  handlers[0][1]({ code: 'KeyA' }); eq(d.speed, 1);
  handlers[0][1]({ code: 'End' }); eq(d.speed, 2, 'alap = cfg.speed');
  unbind(); eq(handlers.length, 0);
  eq(typeof bindClockKeys(d, null), 'function'); eq(applyClockAction(d, 'ismeretlen'), 2);
});

test('clock események: óra/nap/fázis sorrend és tartalom', () => {
  const c = createGameClock({ dayLength: 1440, startHour: 4 }); // 1 mp = 1 játékperc
  const evs = run(c, 17 * 60, 1); // 4:00 -> 21:00
  const hours = evs.filter(e => e.type === 'hour').map(e => e.hour);
  eq(hours.join(','), '5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21');
  eq(evs.filter(e => e.type === 'day').length, 0);
  const ph = evs.filter(e => e.type === 'phase');
  eq(ph.map(e => e.from + '>' + e.to + '@' + e.hour).join(' '), 'night>dawn@5 dawn>day@8 day>dusk@18 dusk>night@21');
  eq(c.phase, 'night');
  const i5 = evs.findIndex(e => e.type === 'hour' && e.hour === 5);
  eq(evs[i5 + 1].type, 'phase', 'ugyanazon a határon: óra, majd fázis');
  eq(evs[i5].t, 300);
  const mid = run(c, 3 * 60, 1); // 21:00 -> 24:00
  eq(mid.map(e => e.type + (e.hour !== undefined ? e.hour : '')).join(','), 'hour22,hour23,day,hour0');
  const dayEv = mid.find(e => e.type === 'day');
  eq(dayEv.day, 2); eq(dayEv.t, DAY_MIN);
  eq(clockInfo(c).day, 2); eq(clockInfo(c).hour, 0);
  eq(mid.filter(e => e.type === 'phase').length, 0, 'éjszaka -> éjszaka: nincs fázis-esemény');
});

test('clock események: nagy lépés, korlát, hibás dt', () => {
  const c = createGameClock();
  const evs = stepClock(c, 3 * 1200); // 3 nap egy lépésben
  eq(evs.filter(e => e.type === 'day').length, 3);
  eq(evs.filter(e => e.type === 'hour').length, 72);
  eq(evs.filter(e => e.type === 'phase').length, 12);
  for (let i = 1; i < evs.length; i++) assert(evs[i].t >= evs[i - 1].t, 'időrend');
  const big = createGameClock(), t0 = big.t;
  const e2 = stepClock(big, 1e9);
  eq(big.t, t0 + MAX_ADVANCE, 'lépésenkénti korlát');
  eq(e2.filter(e => e.type === 'hour').length, 336);
  eq(e2.filter(e => e.type === 'day').length, 14);
  const d = createGameClock();
  for (const bad of [NaN, -1, 0, Infinity, '5', null, undefined, {}]) { eq(stepClock(d, bad).length, 0); eq(d.t, 480); }
  eq(stepClock(null, 1).length, 0);
});

test('clock figyelők: leiratkozás, "*", hibázó figyelő', () => {
  const c = createGameClock({ dayLength: 1440, startHour: 7.5 }); // 1 mp = 1 játékperc
  const seen = [], all = [];
  const off = onClock(c, 'hour', e => seen.push(e.hour));
  onClock(c, '*', e => all.push(e.type));
  onClock(c, 'hour', () => { throw new Error('rossz figyelő'); });
  onClock(c, 'hour', e => seen.push('b' + e.hour));
  run(c, 60, 1); // 7:30 -> 8:30
  eq(seen.join(','), '8,b8', 'a hibázó figyelő nem állítja meg a többit');
  eq(all.join(','), 'hour,phase', '* mindent kap, időrendben');
  eq(c.lastError, 'rossz figyelő');
  off(); run(c, 60, 1); // -> 9:30
  eq(seen.join(','), '8,b8,b9', 'leiratkozás után nincs hívás');
  eq(typeof onClock(c, 'hour', 5), 'function'); onClock(c, '__proto__', () => {}); onClock(c, 'constructor', () => {});
  run(c, 60, 1);
  const self = createGameClock({ dayLength: 1440, startHour: 6.5 });
  let n = 0; const off2 = onClock(self, 'hour', () => { n++; off2(); });
  onClock(self, 'hour', () => { n += 10; });
  run(self, 180, 1); // 6:30 -> 9:30: 7, 8, 9
  eq(n, 1 + 30, 'menet közbeni leiratkozás: az első 1x, a második 3x');
});

test('clock mentés: állapot körbe, hibás állapot, azonos folytatás', () => {
  const a = createGameClock({ dayLength: 900 });
  run(a, 2000, 0.37);
  const st = JSON.parse(JSON.stringify(clockState(a)));
  eq(st.v, 1);
  const b = createGameClock({ dayLength: 900, startHour: 15 });
  eq(restoreClock(b, st), true);
  eq(b.t, a.t); eq(b.phase, a.phase);
  const ea = run(a, 3000, 0.41), eb = run(b, 3000, 0.41);
  eq(b.t, a.t, 'azonos folytatás'); eq(JSON.stringify(ea), JSON.stringify(eb));
  const keep = createGameClock(), before = clockState(keep);
  for (const bad of [null, undefined, 'x', 5, {}, { v: 2, t: 1 }, { v: 1, t: NaN }, { v: 1, t: -5 }, { v: 1, t: '5' }, { v: 1, t: Infinity }, { v: 1, t: 1e12 }, { t: 5 }]) {
    eq(restoreClock(keep, bad), false); eq(JSON.stringify(clockState(keep)), JSON.stringify(before));
  }
  const quiet = createGameClock(); let calls = 0; onClock(quiet, '*', () => calls++);
  restoreClock(quiet, { v: 1, t: 4 * 60 + 59.5 }); eq(calls, 0, 'betöltés csendes'); eq(quiet.phase, 'night');
  const evs = stepClock(quiet, 1); // 1,2 játékperc: átlépi az 5:00-t
  eq(evs.map(e => e.type + ':' + (e.from || e.hour)).join(','), 'hour:5,phase:night');
});

test('clock setClockTime: érvényes és hibás', () => {
  const c = createGameClock();
  eq(setClockTime(c, { day: 3, hour: 22, minute: 30 }), true);
  const i = clockInfo(c); eq(i.day, 3); eq(i.hour, 22); eq(i.minute, 30); eq(i.phase, 'night'); eq(c.phase, 'night');
  eq(setClockTime(c, { day: 1, hour: 6 }), true); eq(clockInfo(c).phase, 'dawn');
  const t = c.t;
  for (const bad of [null, 5, {}, { day: 0, hour: 1 }, { day: 1.5, hour: 1 }, { day: 1, hour: 24 }, { day: 1, hour: -1 }, { day: 1, hour: 1, minute: 60 }, { day: 1, hour: 1, minute: NaN }, { day: 1, hour: 1, minute: null }, { day: '2', hour: 1 }]) {
    eq(setClockTime(c, bad), false); eq(c.t, t);
  }
});

test('nap/éjszaka tintAt: folytonos, fényerő-sorrend, körbeér, hibás bemenet', () => {
  let prev = tintAt(0);
  for (let m = 1; m <= DAY_MIN; m++) {
    const c = tintAt(m);
    for (let k = 0; k < 3; k++) {
      assert(isFinite(c[k]) && c[k] >= 0 && c[k] <= 255, 'tartomány ' + m);
      assert(Math.abs(c[k] - prev[k]) < 6, `ugrás ${m}. perc, csatorna ${k}`);
    }
    prev = c;
  }
  eq(tintAt(1440).join(), tintAt(0).join()); eq(tintAt(DAY_MIN + 300).join(), tintAt(300).join()); eq(tintAt(-60).join(), tintAt(1380).join());
  for (let m = 600; m <= 960; m += 30) eq(tintAt(m).join(), '255,255,255', 'dél: nincs színezés');
  assert(lum(tintAt(720)) > lum(tintAt(19.5 * 60)), 'dél > alkonyat');
  assert(lum(tintAt(19.5 * 60)) > lum(tintAt(0)), 'alkonyat > éjfél');
  assert(lum(tintAt(7 * 60)) > lum(tintAt(5 * 60)), 'napfelkelte > hajnal előtt');
  const sun = tintAt(7 * 60), dusk = tintAt(19.5 * 60), night = tintAt(0);
  assert(sun[0] > sun[1] && sun[1] > sun[2], 'napfelkelte narancs'); assert(dusk[0] > dusk[1] && dusk[1] > dusk[2], 'alkonyat vörös');
  assert(night[2] > night[0], 'éjszaka kékes');
  for (const bad of [NaN, Infinity, 'x', undefined, null]) eq(tintAt(bad).join(), '255,255,255');
  eq(tintAt(100, { keys: [] }).join(), '255,255,255'); eq(tintAt(100, null).join(), '255,255,255');
  const w = tintAt(720); w[0] = 0; eq(tintAt(720)[0], 255, 'másolatot ad');
});

test('nap/éjszaka beltér: keverés és simított átmenet', () => {
  eq(tintMix([60, 74, 128], 1).join(), '60,74,128'); eq(tintMix([60, 74, 128], 0).join(), '255,255,255');
  eq(tintMix([60, 74, 128], 0.5).join(), '158,165,192'); eq(tintMix([60, 74, 128], NaN).join(), '60,74,128'); eq(tintMix([60, 74, 128], 9).join(), '60,74,128');
  const dn = createDayNight(); eq(dn.indoor, 0);
  const out = dayNightTint(dn, 0);
  dn.indoor = 1;
  const inn = dayNightTint(dn, 0);
  for (let k = 0; k < 3; k++) assert(inn[k] > out[k], 'bent világosabb, csatorna ' + k);
  eq(inn.join(), tintMix(tintAt(0), DAYNIGHT_CONFIG.indoorKeep).join());
  dn.indoor = 0;
  const v1 = stepDayNight(dn, 1, DT);
  assert(v1 > 0 && v1 < 1, 'simított');
  for (let i = 0; i < 300; i++) stepDayNight(dn, 1, DT);
  eq(dn.indoor, 1);
  for (let i = 0; i < 300; i++) stepDayNight(dn, 0, DT);
  eq(dn.indoor, 0);
  const x = createDayNight(), y = createDayNight();
  for (let i = 0; i < 60; i++) stepDayNight(x, 1, DT);
  for (let i = 0; i < 30; i++) stepDayNight(y, 1, 2 * DT);
  near(x.indoor, y.indoor, 1e-9, 'fps-független');
  dn.indoor = 0.5; for (const bad of [NaN, -1, 0, Infinity, '1', undefined]) eq(stepDayNight(dn, 1, bad), 0.5);
  dn.indoor = NaN; eq(dayNightTint(dn, 0).join(), out.join(), 'hibás beltéri érték -> kint');
  eq(dayNightTint(null, 0).join(), out.join());
});

test('nap/éjszaka rajz: multiply-réteg, nappal nincs rajz, save/restore', () => {
  const dn = createDayNight(), ctx = fakeCtx();
  eq(drawDayNight(ctx, dn, 0, 960, 540), true);
  const fr = ctx.calls.find(c => c[0] === 'fillRect');
  eq(fr.slice(1, 5).join(), '0,0,960,540'); eq(fr[5], 'multiply'); assert(/^rgb\(\d+,\d+,\d+\)$/.test(fr[6]), 'szín: ' + fr[6]);
  eq(dn.css, fr[6]); eq(ctx.depth, 0); eq(ctx.calls[0][0], 'save'); eq(ctx.calls[ctx.calls.length - 1][0], 'restore');
  const day = fakeCtx();
  eq(drawDayNight(day, dn, 720, 960, 540), false); eq(day.calls.length, 0); eq(dn.css, null);
  const dusk = fakeCtx(); eq(drawDayNight(dusk, dn, 19.5 * 60, 960, 540), true);
  const inn = createDayNight(); inn.indoor = 1;
  const a = fakeCtx(), b = fakeCtx(); drawDayNight(a, createDayNight(), 0, 960, 540); drawDayNight(b, inn, 0, 960, 540);
  assert(a.calls[1][6] !== b.calls[1][6], 'beltérben más szín');
  eq(drawDayNight(null, dn, 0, 960, 540), false); eq(drawDayNight(fakeCtx(), null, 0, 960, 540), false);
  eq(drawDayNight(fakeCtx(), dn, NaN, 960, 540), false, 'hibás idő -> nincs színezés');
});

test('nap/éjszaka szövegek: felirat HU/EN, sebesség, rajz', () => {
  const info = { day: 3, hour: 7, minute: 5, phase: 'dawn' };
  eq(clockLabel(info, 'hu'), '3. nap 07:05 · Hajnal'); eq(clockLabel(info, 'en'), 'Day 3 07:05 · Dawn'); eq(clockLabel(info, 'xx'), '3. nap 07:05 · Hajnal');
  eq(clockLabel(info, 'hu', 4), '3. nap 07:05 · Hajnal · ×4'); eq(clockLabel(info, 'en', 0.25), 'Day 3 07:05 · Dawn · ×0.25');
  eq(clockLabel(info, 'hu', 0), '3. nap 07:05 · Hajnal · szünet'); eq(clockLabel(info, 'en', 0), 'Day 3 07:05 · Dawn · paused');
  eq(clockLabel({ day: 1, hour: 0, minute: 0, phase: 'zzz' }, 'hu'), '1. nap 00:00 · ?');
  eq(clockLabel(null), ''); eq(clockLabel({ day: NaN, hour: 1, minute: 1 }), '');
  eq(Object.keys(CLOCK_TEXT.hu).sort().join(), Object.keys(CLOCK_TEXT.en).sort().join(), 'HU/EN kulcsok azonosak');
  for (const p of PHASES) assert(CLOCK_TEXT.hu['clock.phase.' + p.id] && CLOCK_TEXT.en['clock.phase.' + p.id], 'fázis-szöveg ' + p.id);
  const ctx = fakeCtx();
  eq(drawClockLabel(ctx, 'x', 960), true); eq(ctx.depth, 0);
  const ft = ctx.calls.filter(c => c[0] === 'fillText'); eq(ft.length, 2); eq(ft[1][2], 952); eq(ft[1][4], 'right');
  eq(drawClockLabel(ctx, '', 960), false); eq(drawClockLabel(null, 'x', 960), false);
});

test('clock smoke: 600 kocka valós időben + egy hét 128x, main-szerű lánc, invariánsok', () => {
  const c = createGameClock(), dn = createDayNight(), ctx = fakeCtx();
  const t0 = c.t;
  for (let i = 0; i < 600; i++) { stepClock(c, DT); stepDayNight(dn, i > 300 ? 1 : 0, DT); drawDayNight(ctx, dn, clockInfo(c).minuteOfDay, 960, 540); }
  near(c.t - t0, 12, 1e-6, '600 kocka = 10 mp = 12 játékperc');
  const k = createGameClock(), n0 = k.t, evs = [];
  setClockSpeed(k, 128);
  let snap = null, clone = null;
  for (let i = 0; i < 4000; i++) {
    for (const e of stepClock(k, DT)) evs.push(e);
    stepDayNight(dn, (i % 300) < 100 ? 1 : 0, DT);
    if (i % 7 === 0) drawDayNight(ctx, dn, clockInfo(k).minuteOfDay, 960, 540);
    const f = clockInfo(k);
    assert(isFinite(k.t) && f.hour >= 0 && f.hour <= 23 && f.minute >= 0 && f.minute <= 59 && f.day >= 1, 'info érvénytelen ' + i);
    assert(ctx.depth === 0, 'save/restore egyensúly');
    if (i === 2000) { snap = JSON.parse(JSON.stringify(clockState(k))); clone = createGameClock(); restoreClock(clone, snap); setClockSpeed(clone, 128); }
    if (i > 2000) stepClock(clone, DT);
  }
  eq(clone.t, k.t, 'mentés-betöltés kör azonos állapotot ad');
  eq(clone.phase, k.phase);
  const h1 = Math.floor(k.t / 60), h0 = Math.floor(n0 / 60);
  eq(evs.filter(e => e.type === 'hour').length, h1 - h0, 'minden óra-határ pontosan egyszer');
  eq(evs.filter(e => e.type === 'day').length, Math.floor(k.t / DAY_MIN) - Math.floor(n0 / DAY_MIN));
  const ph = evs.filter(e => e.type === 'phase');
  for (let i = 1; i < ph.length; i++) eq(ph[i].from, ph[i - 1].to, 'fázis-lánc folytonos');
  eq(ph[ph.length - 1].to, k.phase); eq(k.phase, phaseAt(clockInfo(k).minuteOfDay));
  assert(clockInfo(k).day >= 7, 'legalább egy hét telt el');
  assert(!ctx.calls.some(c => c[0] === 'fillRect' && /NaN/.test(String(c[6]))), 'nincs NaN szín');
});
