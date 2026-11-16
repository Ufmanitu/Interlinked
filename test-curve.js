// S047 tesztek: globális szintgörbe, haladás, tevékenység-napló. Importja: test-index.js (test, assert), game-curve, game-actlog.
import { test, assert } from './test-index.js';
import {
  CURVE_CONFIG, CURVE_LIMITS, TIER_TARGETS, PROG_TEXTS, sanitizeCurveConfig, createCurve, xpToReach, xpStepAt, levelForXp,
  curveProgress, hoursAt, levelAtHours, tierReport, fitCurve, createProgression, onProgress, addCharXp, charXp, charLevel,
  charProgress, connectProgression, progressionState, restoreProgression,
} from './game-curve.js';
import {
  ACTLOG_CONFIG, ACTLOG_TEXTS, classifyActivity, createActLog, stepActLog, recordEvent, recordXp, recordMilestone, connectActLog,
  actLogState, restoreActLog, saveActLog, loadActLog, clearActLog, fmtDuration, defaultTr, exportActLogText, parseActLogText,
  actLogKeyAction, bindActLogKeys, setActLogTime,
} from './game-actlog.js';

const store = (fail) => { const m = new Map(); return { m, getItem: (k) => { if (fail) throw new Error('x'); return m.has(k) ? m.get(k) : null; }, setItem: (k, v) => { if (fail) throw new Error('x'); m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };
const bus = () => { const l = []; return { sub: (fn) => { l.push(fn); return () => { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; }, emit: (e) => l.slice().forEach((f) => f(e)), n: () => l.length }; };
const rng = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

test('curve: konfig + szorítás + hibás bemenet', () => {
  assert(Object.isFrozen(CURVE_CONFIG) && CURVE_CONFIG.maxLevel === 60, 'alap');
  const c = sanitizeCurveConfig({ base: -5, p: 99, maxLevel: 500, rate: NaN });
  assert(c.base === CURVE_LIMITS.minBase && c.p === CURVE_LIMITS.maxP && c.maxLevel === 60 && c.rate === CURVE_CONFIG.rate, 'szorítás');
  for (const bad of [null, undefined, 5, 'x', [], { base: 'a', p: {} }]) assert(sanitizeCurveConfig(bad).base === CURVE_CONFIG.base, 'hibás -> alap');
  assert(sanitizeCurveConfig({ maxLevel: 12.9 }).maxLevel === 12, 'egész szintkorlát');
});
test('curve: kumulatív XP monoton, lépés = round(alap·L^p), a szintkorlát 60', () => {
  const c = createCurve({ base: 100, p: 0.5 });
  assert(c.cum.length === 61 && c.cum[0] === 0, 'méret');
  for (let L = 1; L <= 60; L++) {
    assert(c.cum[L] > c.cum[L - 1], 'szigorúan monoton ' + L);
    assert(xpStepAt(c, L) === Math.max(1, Math.round(100 * Math.sqrt(L))), 'lépés ' + L);
  }
  assert(xpToReach(c, 0) === 0 && xpToReach(c, -3) === 0 && xpToReach(c, NaN) === 0, 'alsó');
  assert(xpToReach(c, 60) === c.cum[60] && xpToReach(c, 999) === c.cum[60] && xpToReach(c, 10.9) === c.cum[10], 'felső + tört');
  assert(xpStepAt(c, 0) === 0 && xpStepAt(c, 61) === 0 && xpStepAt(c, NaN) === 0, 'lépés határ');
});
test('curve: p=0 lapos, p konfigurálható (nagyobb p -> több XP a magasabb szintekhez)', () => {
  const flat = createCurve({ base: 50, p: 0 });
  assert(xpToReach(flat, 10) === 500 && xpStepAt(flat, 60) === 50, 'p=0');
  const a = createCurve({ base: 100, p: 0.5 }), b = createCurve({ base: 100, p: 1.5 });
  assert(xpStepAt(a, 1) === xpStepAt(b, 1) && xpStepAt(b, 60) > xpStepAt(a, 60) * 10, 'p hatása');
  assert(xpToReach(createCurve({ base: 100, p: 4 }), 60) < 9e15, 'a legnagyobb p is biztonságos egész');
});
test('curve: levelForXp a küszöbökön (±1), bináris keresés == lineáris', () => {
  const c = createCurve();
  for (let L = 1; L <= 60; L++) {
    assert(levelForXp(c, c.cum[L]) === L && levelForXp(c, c.cum[L] - 1) === L - 1, 'küszöb ' + L);
  }
  const r = rng(7);
  for (let i = 0; i < 500; i++) {
    const x = Math.floor(r() * 30000); let lin = 0; while (lin < 60 && c.cum[lin + 1] <= x) lin++;
    assert(levelForXp(c, x) === lin, 'lineáris egyezés ' + x);
  }
  assert(levelForXp(c, -1) === 0 && levelForXp(c, NaN) === 0 && levelForXp(c, 1e30) === 60 && levelForXp(c, Infinity) === 0, 'szélsők');
});
test('curve: curveProgress (into/need/ratio, max)', () => {
  const c = createCurve();
  const p0 = curveProgress(c, 0);
  assert(p0.level === 0 && p0.into === 0 && p0.need === c.cum[1] && p0.ratio === 0 && !p0.max, '0 XP');
  const mid = curveProgress(c, c.cum[5] + 10);
  assert(mid.level === 5 && mid.into === 10 && mid.need === xpStepAt(c, 6) && Math.abs(mid.ratio - 10 / mid.need) < 1e-12, 'közép');
  const top = curveProgress(c, c.cum[60] * 3);
  assert(top.level === 60 && top.max && top.ratio === 1 && top.need === 0 && top.xp === c.cum[60], 'max');
  assert(curveProgress(c, NaN).level === 0 && curveProgress(c, -5).xp === 0, 'hibás');
});
test('curve: óra-modell + tier-jelentés (a görbe a GDD 8.2 tier-határaihoz ±20%)', () => {
  const c = createCurve();
  assert(Math.abs(hoursAt(c, 60) - 108) < 108 * 0.1, '60. szint ~108 óra');
  assert(levelAtHours(c, 108) >= 59 && levelAtHours(c, 0) === 0 && levelAtHours(c, NaN) === 0, 'levelAtHours');
  assert(hoursAt(c, 20, 0) === hoursAt(c, 20) && hoursAt(c, 20, -1) === hoursAt(c, 20), 'hibás bevétel -> alap');
  const rep = tierReport(c);
  assert(rep.length === TIER_TARGETS.length, 'minden tier');
  for (const r of rep) assert(r.ratio > 0.8 && r.ratio < 1.2, 'tier ' + r.level + ' arány ' + r.ratio.toFixed(2));
  assert(tierReport(c, [null, { level: 'x', hours: 1 }, { level: 5, hours: 0 }]).length === 0 && tierReport(c, 5).length === 0, 'hibás cél');
});
test('curve: fitCurve (visszaadja a generált görbét, alapérték-egyezés, hibás cél)', () => {
  const f = fitCurve();
  assert(f && Math.abs(f.p - CURVE_CONFIG.p) < 0.02 && f.rms < 0.07 && Math.abs(f.rate / CURVE_CONFIG.rate - 1) < 0.05, 'alapérték az illesztésből');
  const gen = createCurve({ base: 80, p: 1.2 }), rate = 40;
  const targets = [5, 15, 30, 45, 60].map((L) => ({ level: L, hours: hoursAt(gen, L, rate) }));
  const g = fitCurve({ targets, base: 80 });
  assert(Math.abs(g.p - 1.2) < 0.01 && g.rms < 0.01 && Math.abs(g.rate / rate - 1) < 0.02, 'ismert p visszanyerve');
  assert(fitCurve({ targets: [] }) === null && fitCurve({ targets: [{ level: 5, hours: 1 }] }) === null && fitCurve({ targets: 7 }) !== null, 'kevés/hibás cél');
});
test('progression: addCharXp, szintlépés-események, plafon, hibás bemenet, külön játékosok', () => {
  const pr = createProgression(); const evs = []; onProgress(pr, (e) => evs.push(e));
  const c = pr.curve;
  const r = addCharXp(pr, 0, c.cum[3] + 5, 'test');
  assert(r.ok && r.level === 3 && r.levels === 3 && r.gained === c.cum[3] + 5, 'több szint egyszerre');
  assert(evs.length === 2 && evs[0].type === 'charxp' && evs[0].source === 'test' && evs[1].type === 'charlevel' && evs[1].from === 0 && evs[1].level === 3, 'események');
  assert(charXp(pr, 1) === 0 && charLevel(pr, 1) === 0 && charProgress(pr, 0).level === 3, 'a másik játékos érintetlen');
  const n = evs.length;
  for (const [p, a] of [[2, 5], [-1, 5], [0, 0], [0, -4], [0, NaN], [0, 0.5], [0, 'x'], [0, Infinity]]) {
    const b = addCharXp(pr, p, a); assert(!b.ok && b.gained === 0, 'elutasít ' + p + ',' + a);
  }
  assert(evs.length === n && pr.stats.rejected === 8, 'elutasítottak nem küldenek eseményt');
  const top = addCharXp(pr, 0, 1e12);
  assert(top.ok && top.level === 60 && charXp(pr, 0) === c.cum[60], 'plafon');
  const again = addCharXp(pr, 0, 100); assert(again.ok && again.gained === 0 && evs.at(-1).type === 'charlevel', 'a 60. szint fölött nincs esemény');
  assert(addCharXp(pr, 1, 2.9).gained === 2, 'törtrész levágva');
});
test('progression: hibázó figyelő nem állít meg + leválasztás + connect a skill-eseményekre', () => {
  const pr = createProgression(); const seen = [];
  onProgress(pr, () => { throw new Error('boom'); }); onProgress(pr, (e) => seen.push(e.type));
  addCharXp(pr, 0, 10); assert(seen[0] === 'charxp' && pr.lastError === 'boom', 'figyelő hibája nem dob');
  const b = bus(); const off = connectProgression(pr, b.sub);
  b.emit({ type: 'xp', player: 1, skill: 'mining', amount: 8 }); b.emit({ type: 'levelup', player: 1, skill: 'mining', level: 2 }); b.emit(null);
  assert(charXp(pr, 1) === 8, 'csak az xp esemény számít'); off(); assert(b.n() === 0, 'leválasztva');
  b.emit({ type: 'xp', player: 1, amount: 8 }); assert(charXp(pr, 1) === 8, 'leválasztás után nincs hatás');
  assert(typeof connectProgression(pr, null) === 'function', 'hibás sub');
});
test('progression: állapot/visszaállítás atomi, szövegek HU/EN', () => {
  const pr = createProgression(); addCharXp(pr, 0, 777); addCharXp(pr, 1, 99);
  const st = JSON.parse(JSON.stringify(progressionState(pr))); const pr2 = createProgression();
  assert(restoreProgression(pr2, st) && pr2.xp[0] === 777 && pr2.xp[1] === 99 && pr2.events.length === 0, 'körút, csendes');
  for (const bad of [null, {}, { v: 2, xp: [1, 2] }, { v: 1, xp: [1] }, { v: 1, xp: [1, -2] }, { v: 1, xp: [1.5, 2] }, { v: 1, xp: ['a', 2] }]) {
    assert(!restoreProgression(pr2, bad) && pr2.xp[0] === 777, 'hibás -> érintetlen');
  }
  assert(restoreProgression(pr2, { v: 1, xp: [1e12, 0] }) && pr2.xp[0] === pr2.curve.cum[60], 'plafonra szorít');
  const ks = (o) => Object.keys(o).sort().join(), ps = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  assert(ks(PROG_TEXTS.hu) === ks(PROG_TEXTS.en), 'azonos kulcsok');
  for (const k of Object.keys(PROG_TEXTS.hu)) assert(ps(PROG_TEXTS.hu[k]) === ps(PROG_TEXTS.en[k]), 'azonos paraméterek ' + k);
});
test('actlog: classifyActivity + stepActLog (idő-összeg, hibás dt/kulcs)', () => {
  const k = classifyActivity;
  assert(k({ tab: 'trade' }) === 'trade' && k({ menuOpen: true, tab: 'craft' }) === 'craft' && k({ menuOpen: true, tab: 'inv' }) === 'inventory' && k({ menuOpen: true }) === 'menu', 'menü');
  assert(k({ gathering: true, moving: true }) === 'gather' && k({ moving: true }) === 'move' && k({}) === 'idle' && k(null) === 'idle', 'világ');
  const log = createActLog();
  for (let i = 0; i < 600; i++) stepActLog(log, 1 / 60, ['gather', 'move']);
  assert(Math.abs(log.playSec - 10) < 1e-9 && Math.abs(log.players[0].secs.gather - 10) < 1e-9 && Math.abs(log.players[1].secs.move - 10) < 1e-9, 'összeg');
  for (const dt of [0, -1, NaN, Infinity, 'x', null]) assert(stepActLog(log, dt, ['move', 'move']) === false, 'hibás dt ' + dt);
  stepActLog(log, 5, [null, 'rossz kulcs!']);
  assert(Math.abs(log.playSec - 11) < 1e-9 && Math.abs(log.players[0].secs.idle - 1) < 1e-9 && Math.abs(log.players[1].secs.idle - 1) < 1e-9, 'dt <= maxDt, hibás kulcs -> idle');
  stepActLog(log, 1, undefined); assert(Math.abs(log.players[0].secs.idle - 2) < 1e-9, 'nincs acts');
});
test('actlog: események, XP, mérföldkő, kulcs-plafon, mérföldkő-plafon', () => {
  const log = createActLog();
  assert(recordEvent(log, 0, 'gather:tree') && recordEvent(log, 0, 'gather:tree', 2.7) && log.players[0].events['gather:tree'] === 3, 'esemény összeg');
  assert(!recordEvent(log, 2, 'a') && !recordEvent(log, 0, '1x') && !recordEvent(log, 0, 'a', 0) && !recordEvent(log, 0, 'a', NaN), 'hibás esemény');
  assert(recordXp(log, 1, 'mining', 8.9) && log.players[1].xp.mining === 8 && !recordXp(log, 1, 'mining', 0) && !recordXp(log, 3, 'm', 5), 'XP');
  for (let i = 0; i < 100; i++) recordEvent(log, 1, 'k' + i);
  const keys = Object.keys(log.players[1].events); assert(keys.length === ACTLOG_CONFIG.maxKeys + 1 && keys.includes('other'), 'kulcs-plafon -> other');
  setActLogTime(log, 500); setActLogTime(log, -3); setActLogTime(log, NaN);
  assert(recordMilestone(log, { kind: 'skill', player: 0, id: 'mining', level: 3 }) && log.milestones[0].t === 500, 'mérföldkő idő');
  assert(!recordMilestone(log, null) && !recordMilestone(log, { kind: 'skill', player: 5, id: 'a', level: 1 }) && !recordMilestone(log, { kind: 'skill', player: 0, id: 'a', level: -1 }), 'hibás mérföldkő');
  for (let i = 0; i < 450; i++) recordMilestone(log, { kind: 'char', player: 0, id: 'char', level: i });
  assert(log.milestones.length === 400 && log.milestones.at(-1).level === 449 && log.milestones[0].level === 50, 'a legrégebbi esik ki');
});
test('actlog: connectActLog — skill/node/craft/prog események, leválasztás, hibás esemény', () => {
  const log = createActLog(), pr = createProgression(); let T = 123;
  const B = { skill: bus(), node: bus(), craft: bus(), prog: bus() };
  const off = connectActLog(log, { skill: B.skill.sub, node: B.node.sub, craft: B.craft.sub, prog: (f) => onProgress(pr, f), time: () => T });
  connectProgression(pr, B.skill.sub);
  B.skill.emit({ type: 'xp', player: 0, skill: 'woodcutting', amount: 6 });
  B.skill.emit({ type: 'levelup', player: 0, skill: 'woodcutting', from: 0, level: 1 });
  B.node.emit({ type: 'hit', player: 0, nodeType: 'tree' }); B.node.emit({ type: 'depleted', player: 1, nodeType: 'stone' });
  B.craft.emit({ type: 'craft', player: 0, recipe: 'torch', times: 3 }); B.craft.emit({ type: 'craft-fail', player: 0, recipe: 'torch' });
  B.skill.emit(null); B.node.emit({ type: 'depleted', player: 9, nodeType: 'tree' }); B.craft.emit('x');
  const p0 = log.players[0], p1 = log.players[1];
  assert(p0.xp.woodcutting === 6 && p0.events['craft:torch'] === 3 && p1.events['gather:stone'] === 1 && !('gather:tree' in p0.events), 'számlálók');
  assert(log.milestones.length === 1 && log.milestones[0].kind === 'skill' && log.milestones[0].t === 123, 'skill mérföldkő a játékidővel');
  T = 4000; addCharXpTo(pr, 0, pr.curve.cum[2]);
  const ch = log.milestones.filter((m) => m.kind === 'char'); assert(ch.length === 1 && ch[0].level === 2 && ch[0].t === 4000, 'karakter-szintlépés');
  off(); B.skill.emit({ type: 'xp', player: 0, skill: 'woodcutting', amount: 6 }); assert(p0.xp.woodcutting === 6, 'leválasztás után nincs hatás');
  assert(typeof connectActLog(log, null) === 'function' && typeof connectActLog(log, { skill: () => { throw new Error('x'); } }) !== 'x', 'hibás subs');
});
function addCharXpTo(pr, p, a) { return addCharXp(pr, p, a, 'test'); }
test('actlog: mentés/betöltés körút, hibás tároló, automatikus mentés, törlés', () => {
  const st = store(), log = createActLog({ storage: st, flushEvery: 2 });
  for (let i = 0; i < 119; i++) stepActLog(log, 1 / 60, ['gather', 'idle']);
  assert(st.m.size === 0 && log.dirty, '2 mp előtt nincs mentés');
  stepActLog(log, 1 / 60, ['gather', 'idle']); stepActLog(log, 1 / 60, ['gather', 'idle']);
  assert(st.m.has(ACTLOG_CONFIG.key) && log.stats.saves === 1 && !log.dirty, 'automatikus mentés');
  recordEvent(log, 0, 'craft:axe', 2); recordMilestone(log, { kind: 'skill', player: 1, id: 'mining', level: 4, t: 99 });
  assert(saveActLog(log), 'kézi mentés');
  const log2 = createActLog({ storage: st });
  assert(loadActLog(log2) && JSON.stringify(actLogState(log2)) === JSON.stringify(actLogState(log)), 'azonos állapot');
  const bad = store(true), l3 = createActLog({ storage: bad });
  assert(!saveActLog(l3) && !loadActLog(l3) && l3.stats.failed === 1 && l3.lastError === 'x', 'hibázó tároló nem dob');
  for (let i = 0; i < 900; i++) stepActLog(l3, 1 / 60, ['move', 'move']); assert(l3.playSec > 14, 'a naplózás hibázó tárolónál is megy');
  st.m.set(ACTLOG_CONFIG.key, '{nem json'); assert(!loadActLog(log2) && log2.playSec > 0, 'rossz JSON -> érintetlen');
  st.m.set(ACTLOG_CONFIG.key, 'x'.repeat(ACTLOG_CONFIG.maxText + 1)); assert(!loadActLog(log2), 'túl nagy');
  clearActLog(log, st); assert(!st.m.has(ACTLOG_CONFIG.key) && log.playSec === 0 && log.milestones.length === 0 && Object.keys(log.players[0].secs).length === 0, 'törlés');
});
test('actlog: restoreActLog atomi, hibás alakok', () => {
  const log = createActLog(); stepActLog(log, 1, ['move', 'idle']); const before = JSON.stringify(actLogState(log));
  const ok = () => JSON.parse(before); const mut = (f) => { const s = ok(); f(s); return s; };
  const cases = [null, {}, mut((s) => { s.v = 2; }), mut((s) => { s.playSec = -1; }), mut((s) => { s.players.pop(); }), mut((s) => { s.players[0].secs['1x'] = 1; }),
    mut((s) => { s.players[1].xp.a = -2; }), mut((s) => { s.players[0].events.a = NaN; }), mut((s) => { s.milestones = [['skill', 0, 'a', 1, 1]]; }),
    mut((s) => { s.milestones = [['skill', 7, 'a', 1, 1, 1]]; }), mut((s) => { s.milestones = new Array(401).fill(['skill', 0, 'a', 1, 1, 1]); }), mut((s) => { s.players[0] = null; })];
  cases.forEach((c, i) => assert(!restoreActLog(log, c) && JSON.stringify(actLogState(log)) === before, 'hibás eset ' + i));
  assert(restoreActLog(log, ok()), 'érvényes elfogad');
});
test('actlog: szöveges export (HU/EN), #json körút, parse, hibás', () => {
  const log = createActLog(); setActLogTime(log, 61);
  for (let i = 0; i < 3725; i++) stepActLog(log, 1, ['gather', 'move']);
  recordXp(log, 0, 'woodcutting', 120); recordEvent(log, 0, 'gather:tree', 30); recordMilestone(log, { kind: 'skill', player: 0, id: 'woodcutting', level: 3 });
  const hu = exportActLogText(log);
  assert(hu.split('\n')[0] === '# Interlinked napló (v1)' && hu.includes('1:02:05 (3725 mp)'), 'fejléc + idő');
  assert(hu.includes('tevékenység (mp): gather 3725') && hu.includes('XP: woodcutting 120') && hu.includes('események: gather:tree 30') && hu.includes('1:02:05 · J1 · skill:woodcutting · szint 3 · játékperc 61'), 'tartalom');
  assert(hu.includes('XP: —') && hu.includes('## Játékos 2'), 'üres lista + 2. játékos');
  const en = exportActLogText(log, defaultTr('en')); assert(en.includes('play time:') && en.includes('P1 · skill:woodcutting · level 3'), 'EN');
  const st = parseActLogText(hu); assert(st && JSON.stringify(st) === JSON.stringify(actLogState(log)), '#json körút');
  for (const bad of [null, 5, '', 'nincs json', '#json {nem', '#json {"v":9}', '#json ' + '1'.repeat(10)]) assert(parseActLogText(bad) === null, 'parse hibás');
  assert(fmtDuration(NaN) === '0:00:00' && fmtDuration(-4) === '0:00:00' && fmtDuration(59.9) === '0:00:59' && fmtDuration(36000) === '10:00:00', 'fmtDuration');
  assert(defaultTr('hu')('ismeretlen') === 'ismeretlen' && defaultTr('xx')('none') === '—', 'defaultTr tartalék');
  const ks = (o) => Object.keys(o).sort().join(), ps = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  assert(ks(ACTLOG_TEXTS.hu) === ks(ACTLOG_TEXTS.en), 'azonos kulcsok');
  for (const k of Object.keys(ACTLOG_TEXTS.hu)) assert(ps(ACTLOG_TEXTS.hu[k]) === ps(ACTLOG_TEXTS.en[k]), 'azonos paraméterek ' + k);
});
test('actlog: F6 billentyű másol és ment; módosítóval/ismétléssel nem', () => {
  const st = store(), log = createActLog({ storage: st }); let copied = null, pd = 0; let h = null;
  const target = { addEventListener: (t, f) => { if (t === 'keydown') h = f; }, removeEventListener: (t, f) => { if (f === h) h = null; } };
  const off = bindActLogKeys(log, { copy: (t) => { copied = t; } }, target);
  assert(actLogKeyAction({ code: 'F6' }) === 'export' && actLogKeyAction({ code: 'F6', shiftKey: true }) === null && actLogKeyAction({ code: 'F6', repeat: true }) === null && actLogKeyAction({ code: 'F5' }) === null && actLogKeyAction(null) === null, 'kulcs-akció');
  h({ code: 'F5' }); assert(copied === null, 'más gomb');
  h({ code: 'F6', preventDefault: () => { pd++; } });
  assert(copied && copied.startsWith('# Interlinked napló') && pd === 1 && st.m.has(ACTLOG_CONFIG.key), 'másolás + mentés');
  off(); assert(h === null, 'leválasztva'); assert(typeof bindActLogKeys(log, null, null) === 'function', 'hibás cél');
  const bad = createActLog({ storage: store(true) }); let h2; bindActLogKeys(bad, { copy: () => { throw new Error('c'); } }, { addEventListener: (t, f) => { h2 = f; }, removeEventListener() {} });
  h2({ code: 'F6' }); assert(bad.lastError === 'c' || bad.lastError === 'x', 'másoló hiba nem dob');
});
test('smoke: 3000 kocka két szkriptelt játékossal, valódi-alakú eseményekkel — nincs NaN, a körút azonos, determinisztikus', () => {
  const run = () => {
    const r = rng(42), pr = createProgression(), st = store(), log = createActLog({ storage: st, flushEvery: 5 });
    const B = { skill: bus(), node: bus(), craft: bus() }; let t = 0;
    connectProgression(pr, B.skill.sub);
    connectActLog(log, { skill: B.skill.sub, node: B.node.sub, craft: B.craft.sub, prog: (f) => onProgress(pr, f), time: () => t });
    for (let i = 0; i < 3000; i++) {
      t += 0.5; const acts = [0, 1].map(() => ['move', 'idle', 'gather', 'craft', 'trade', 'inventory', 'menu'][Math.floor(r() * 7)]);
      stepActLog(log, 1 / 60, acts);
      if (r() < 0.05) B.skill.emit({ type: 'xp', player: Math.floor(r() * 2), skill: ['mining', 'woodcutting'][Math.floor(r() * 2)], amount: 1 + Math.floor(r() * 40) });
      if (r() < 0.02) B.node.emit({ type: 'depleted', player: Math.floor(r() * 2), nodeType: 'tree' });
      if (r() < 0.02) B.craft.emit({ type: 'craft', player: Math.floor(r() * 2), recipe: 'torch', times: 1 + Math.floor(r() * 3) });
    }
    return { pr, log, st };
  };
  const a = run(), b = run();
  const flat = JSON.stringify(actLogState(a.log));
  assert(!/NaN|null|Infinity/.test(flat.replace(/"other"/g, '')), 'nincs NaN/null');
  assert(flat === JSON.stringify(actLogState(b.log)) && a.pr.xp.join() === b.pr.xp.join(), 'determinisztikus');
  assert(Math.abs(a.log.playSec - 50) < 1e-6, 'játékidő = 3000/60');
  const sumXp = a.log.players.reduce((s, p) => s + Object.values(p.xp).reduce((x, y) => x + y, 0), 0);
  assert(sumXp === a.pr.xp[0] + a.pr.xp[1], 'a napló XP-összege = a karakter-XP');
  const la = createActLog(); assert(loadActLog(la, a.st) && la.playSec <= a.log.playSec + 1e-9 && la.playSec > 0, 'betöltés');
  assert(parseActLogText(exportActLogText(a.log)) !== null, 'export-parse');
});
