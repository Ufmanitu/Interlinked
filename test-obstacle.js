// S059 tesztek: tag-akadályok – adat/validáció, elzárt út (ÉGETÉS, TÖRÉS, eszköz, ROBBANTÁS), sötét átjáró (FÉNY, FÁKLYA, SÖTÉTLÁTÁS), mentés, audit, "a kaszt nem kapu", determinizmus.
import { test, assert, eq } from './test-index.js';
import { createPlayer } from './game-player.js';
import { createI18n, addTexts, auditTexts } from './i18n.js';
import { ITEM_DEFS } from './data-items.js';
import { RECIPE_DEFS } from './data-recipes.js';
import { ABILITY_DEFS, CLASS_DEFS, RACE_DEFS } from './data-character.js';
import { OBSTACLE_DEFS, OBSTACLE_TEXTS, OBSTACLE_PLANNED_TAGS } from './data-obstacles.js';
import { createCharacterRegistry } from './game-registry.js';
import { createAbilitySystem, castAbility, stepAbilities } from './game-ability.js';
import { createPlayerInventories, addItem, removeItem } from './game-inventory.js';
import { createInteractSystem, addProvider, stepInteraction, targetOf } from './game-interact.js';
import { applyRace, raceOf } from './game-race.js';
import { attachWizard, stepWizard, lightSources } from './game-wizard.js';
import { attachWarrior } from './game-warrior.js';
import { mulberry32 } from './world-noise.js';
import {
  OBSTACLE_CONFIG, validateObstacleDef, createObstacleSystem, onObstacle, obstacleColliders, obstacleOpen, solveByTag, connectObstacles, stepObstacles,
  obstacleView, obstacleProvider, describeObstacle, obstacleState, restoreObstacles, auditObstacles,
} from './game-obstacle.js';

const ok = v => assert(v, 'ok');
const right = { x: 1, y: 0 };
const THICKET = 'thorn_thicket', GATE = 'dark_gate';
const mkPlayers = (a = [300, 0], b = [300, 300]) => [createPlayer(0, a[0], a[1]), createPlayer(1, b[0], b[1])];
const run = (os, n, ctx, dt = 1 / 60) => { const ev = []; for (let k = 0; k < n; k++) ev.push(...stepObstacles(os, dt, ctx)); return ev; };
const axeTarget = os => ({ kind: 'obstacle', ref: os.items.get(THICKET), action: 'clear' });
const holdCtx = (os, players, invs, who = 0) => { const inputs = [{}, {}]; inputs[who] = { interact: true }; const targets = [null, null]; targets[who] = axeTarget(os); return { players, inventories: invs, inputs, targets }; };

test('obstacle: adat – két példa-akadály érvényes, 2+ megoldás, HU/EN szövegek, élő audit hibátlan', () => {
  const os = createObstacleSystem();
  eq(os.errors.length, 0); eq(os.dups.length, 0); eq(os.items.size, OBSTACLE_DEFS.length);
  eq(os.items.get(THICKET).kind, 'blocked'); eq(os.items.get(GATE).kind, 'dark');
  eq(os.items.get(THICKET).solves.join(), 'ÉGETÉS,FEJSZE,ROBBANTÁS,TÖRÉS'); eq(os.items.get(GATE).solves.join(), 'FÉNY,FÁKLYA,SÖTÉTLÁTÁS');
  for (const r of os.items.values()) assert(r.solves.length >= 2 && r.solves.length <= 3 + 1, r.id);
  const i = createI18n({ texts: { hu: {}, en: {} } }); addTexts(i, OBSTACLE_TEXTS, '');
  const au = auditTexts(i); assert(au.ok, JSON.stringify(au));
  for (const r of os.items.values()) { ok(OBSTACLE_TEXTS.hu['obstacle.' + r.id]); for (const tg of r.solves) ok(OBSTACLE_TEXTS.hu['obstacle.tag.' + tg] && OBSTACLE_TEXTS.en['obstacle.tag.' + tg]); }
  const src = { items: ITEM_DEFS, recipes: RECIPE_DEFS, abilities: ABILITY_DEFS, races: RACE_DEFS, classes: CLASS_DEFS };
  eq(auditObstacles(os, src).join(), '');
  const d = describeObstacle(os, THICKET, (k, p) => OBSTACLE_TEXTS.hu[k].replace('{tags}', p ? p.tags : ''));
  eq(d.name, 'Tüskebozót'); eq(d.need, 'Megoldás: égetés, fejsze, robbantás, törés'); eq(describeObstacle(os, 'nincs', () => ''), null);
});

test('obstacle: validáció – hibás adat kiesik (nem dob), duplikátum felülír, horgony eltol, tools csak a megoldás-tagre', () => {
  const base = { id: 'a', kind: 'blocked', x: 10, y: 20, w: 32, h: 32, solves: ['FEJSZE', 'ÉGETÉS'] };
  const bad = [null, 7, {}, { ...base, id: 'A' }, { ...base, id: '' }, { ...base, kind: 'x' }, { ...base, w: 0 }, { ...base, x: NaN }, { ...base, h: 9999 }, { ...base, solves: [] }, { ...base, solves: 'x' },
    { ...base, solves: ['fejsze'] }, { ...base, solves: [5] }, { ...base, solves: Array(7).fill('A').map((_, k) => 'T' + k) }, { ...base, hp: 0 }, { ...base, burn: -1 },
    { ...base, tools: { TÖRÉS: { tier: 1, time: 1 } } }, { ...base, tools: { FEJSZE: { tier: 1.5, time: 1 } } }, { ...base, tools: { FEJSZE: { tier: 1, time: 0 } } }, { ...base, tools: [] }];
  for (const b of bad) { const r = validateObstacleDef(b); eq(r.ok, false, JSON.stringify(b)); eq(r.obstacle, null); }
  const os = createObstacleSystem([...bad, base, { ...base, x: 99 }, { ...base, id: 'b', solves: ['FÉNY', 'FÁKLYA', 'FÉNY'], kind: 'dark' }], { anchor: { x: 1000, y: -500 } });
  eq(os.errors.length, bad.length); eq(os.dups.join(), 'a'); eq(os.items.get('a').x, 1099); eq(os.items.get('a').y, -480); eq(os.items.get('b').solves.length, 2);
  eq(createObstacleSystem('x').items.size, 0); eq(createObstacleSystem(null).items.size, 0);
  eq(validateObstacleDef({ ...base, tools: { FEJSZE: { tier: 1, time: 2 } } }).obstacle.tools.FEJSZE.time, 2);
  assert(Object.isFrozen(validateObstacleDef(base).obstacle), 'fagyasztott');
});

test('obstacle: ütközők – blocked áll, amíg fel nem oldják; dark zárva ütköző; version jelzi a változást', () => {
  const os = createObstacleSystem();
  eq(obstacleColliders(os).length, 2); const v0 = os.version;
  eq(obstacleOpen(os, THICKET), false); eq(obstacleOpen(os, GATE), false); eq(obstacleOpen(os, 'nincs'), false);
  solveByTag(os, 'ROBBANTÁS', { x: 352, y: 0, r: 5 });
  eq(obstacleColliders(os).length, 1); assert(os.version > v0, 'version'); eq(obstacleOpen(os, THICKET), true);
  eq(obstacleColliders(os, [{ x: 0, y: 0, w: 1, h: 1 }]).length, 2, 'a kimeneti tömb folytatódik');
  eq(obstacleColliders(null).length, 0);
});

test('obstacle: ÉGETÉS – varázsló ignite a tárra, az égés után az akadály elég (collider, törhető-tár is kikerül); fény nélkül nincs hatás/költség', () => {
  const os = createObstacleSystem(), reg = createCharacterRegistry(), sys = createAbilitySystem({ reg }), players = mkPlayers();
  players[0].class = 'wizard';
  const wz = attachWizard(sys, { players, flammables: os.flammables });
  const evs = []; onObstacle(os, e => evs.push(e));
  const r = castAbility(sys, players, 0, 'ignite', { facing: right }); ok(r.ok);
  stepWizard(wz, 1.0); stepObstacles(os, 1 / 60, { players }); eq(os.cleared.size, 0, 'még ég');
  ok(obstacleColliders(os).some(c => c.x === 352));
  stepWizard(wz, 0.6); const out = stepObstacles(os, 1 / 60, { players });
  eq(out.length, 1); eq(out[0].type, 'cleared'); eq(out[0].id, THICKET); eq(out[0].via, 'ÉGETÉS'); eq(evs.length, 1);
  eq(obstacleOpen(os, THICKET), true); eq(os.breakables.walls.has(THICKET), false); eq(obstacleColliders(os).some(c => c.x === 352), false);
  stepAbilities(sys, players, [{}, {}], [], 5);
  const mana = players[0].mana, again = castAbility(sys, players, 0, 'ignite', { facing: right });
  eq(again.ok, false); eq(again.reason, 'blocked'); eq(players[0].mana, mana, 'hatás nélkül nincs költség');
  eq(stepObstacles(os, 1 / 60, { players }).length, 0, 'az esemény csak egyszer jön');
});

test('obstacle: TÖRÉS – harcos wallbreak (hp 3: két használat), az ork erejével egy; a falat nem érő irány vétó', () => {
  const os = createObstacleSystem(), reg = createCharacterRegistry(), sys = createAbilitySystem({ reg }), players = mkPlayers();
  players[0].class = 'warrior'; attachWarrior(sys, { players, breakables: os.breakables });
  eq(castAbility(sys, players, 0, 'wallbreak', { facing: { x: -1, y: 0 } }).reason, 'blocked', 'rossz irány');
  ok(castAbility(sys, players, 0, 'wallbreak', { facing: right }).ok); stepObstacles(os, 1 / 60, { players }); eq(os.cleared.size, 0);
  stepAbilities(sys, players, [{}, {}], [], 5); players[0].stamina = 100; players[0].exhausted = false;
  ok(castAbility(sys, players, 0, 'wallbreak', { facing: right }).ok);
  const out = stepObstacles(os, 1 / 60, { players }); eq(out[0].via, 'TÖRÉS'); eq(os.flammables.items.has(THICKET), false);
  const os2 = createObstacleSystem(), sys2 = createAbilitySystem({ reg }), pl2 = mkPlayers(); pl2[0].class = 'warrior'; applyRace(reg, pl2[0], 'orc');
  attachWarrior(sys2, { players: pl2, breakables: os2.breakables });
  ok(castAbility(sys2, pl2, 0, 'wallbreak', { facing: right }).ok); eq(stepObstacles(os2, 1 / 60, { players: pl2 })[0].via, 'TÖRÉS', 'ork: egy csapás');
});

test('obstacle: eszköz (FEJSZE) – tartott gomb, ~1 mp fejszével; eszköz nélkül egyszeri "locked"; tier-zár; elengedés nulláz; két játékos független', () => {
  const players = mkPlayers(), invs = createPlayerInventories();
  let os = createObstacleSystem();
  const ev0 = run(os, 40, holdCtx(os, players, invs));
  eq(ev0.length, 1); eq(ev0[0].type, 'locked'); eq(ev0[0].need.tag, 'FEJSZE'); eq(ev0[0].need.tier, 1); eq(ev0[0].have, 0); eq(os.stats.locked, 1);
  ok(obstacleView(os, 0).locked); eq(obstacleView(os, 1), null);
  run(os, 1, { players, inventories: invs, inputs: [{}, {}], targets: [null, null] }); eq(obstacleView(os, 0), null, 'elengedve nincs sáv');
  eq(run(os, 1, holdCtx(os, players, invs)).length, 1, 'újranyomásnál újra jelez');
  addItem(invs[0], 'axe', 1);
  run(os, 30, holdCtx(os, players, invs)); const v = obstacleView(os, 0); ok(v && !v.locked); assert(v.ratio > 0.45 && v.ratio < 0.55, 'fél út: ' + v.ratio);
  run(os, 1, { players, inventories: invs, inputs: [{}, {}], targets: [null, null] }); eq(os.sess[0].progress, 0, 'elengedés nulláz');
  const evs = run(os, 70, holdCtx(os, players, invs)); eq(evs.filter(e => e.type === 'cleared').length, 1); eq(evs.find(e => e.type === 'cleared').via, 'FEJSZE');
  eq(obstacleOpen(os, THICKET), true); eq(obstacleView(os, 0), null);
  os = createObstacleSystem([{ id: 'hard', kind: 'blocked', x: 352, y: -64, w: 32, h: 128, solves: ['FEJSZE', 'ÉGETÉS'], tools: { FEJSZE: { tier: 2, time: 1 } } }]);
  const t = { kind: 'obstacle', ref: os.items.get('hard'), action: 'clear' }, c = { players, inventories: invs, inputs: [{ interact: true }, {}], targets: [t, null] };
  const lk = run(os, 5, c); eq(lk.length, 1); eq(lk[0].have, 1); eq(lk[0].need.tier, 2); eq(os.cleared.size, 0);
  addItem(invs[1], 'axe', 1); const c2 = { players, inventories: invs, inputs: [{ interact: true }, { interact: true }], targets: [t, t] };
  run(os, 5, c2); eq(os.items.get('hard').cleared, false); ok(obstacleView(os, 0).locked); eq(obstacleView(os, 1).locked, true, 'a másiknak is tier-zár');
});

test('obstacle: interakció-forrás – a provider célpontot ad, a valódi stepInteraction + stepObstacles végigviszi (fejsze)', () => {
  const os = createObstacleSystem(), it = createInteractSystem(), players = mkPlayers([330, 0], [330, 400]), invs = createPlayerInventories();
  addProvider(it, obstacleProvider(os)); addItem(invs[0], 'axe', 1);
  const far = [createPlayer(0, 900, 900), createPlayer(1, 900, 900)]; stepInteraction(it, far, [{ x: 1, y: 0 }, {}], 1 / 60); eq(targetOf(it, 0), null, 'messze nincs célpont');
  const inp = [{ x: 1, y: 0, interact: true }, {}];
  stepInteraction(it, players, inp, 1 / 60); const tg = targetOf(it, 0);
  ok(tg); eq(tg.kind, 'obstacle'); eq(tg.action, 'clear'); eq(tg.ref.id, THICKET);
  let done = false;
  for (let k = 0; k < 120 && !done; k++) { stepInteraction(it, players, inp, 1 / 60); done = stepObstacles(os, 1 / 60, { players, inventories: invs, inputs: inp, targets: [targetOf(it, 0), targetOf(it, 1)] }).some(e => e.type === 'cleared'); }
  ok(done); stepInteraction(it, players, inp, 1 / 60); eq(targetOf(it, 0), null, 'feloldás után nincs célpont');
  eq(createObstacleSystem([{ id: 'p', kind: 'blocked', x: 0, y: 0, w: 32, h: 32, solves: ['ÉGETÉS', 'TÖRÉS'] }]).items.get('p').hasTools, false);
  eq(obstacleProvider(null)({ x: 0, y: 0, w: 1, h: 1 }, [], {}).length, 0);
});

test('obstacle: ROBBANTÁS – solveByTag kör (több akadály, hp-sebzés) és szakasz (a legközelebbi); rossz tag/forma nem hat; képesség-esemény (direction/area/self)', () => {
  const defs = [0, 1, 2].map(k => ({ id: 'b' + k, kind: 'blocked', x: 100 + k * 100, y: 0, w: 32, h: 32, solves: ['ROBBANTÁS', 'FEJSZE'], hp: 3 }));
  const os = createObstacleSystem(defs);
  eq(solveByTag(os, 'ROBBANTÁS', { x: 0, y: 16, r: 150 }, 1).length, 1); eq(os.items.get('b0').hp, 2); eq(os.cleared.size, 0);
  const line = solveByTag(os, 'ROBBANTÁS', { x: 0, y: 16, ex: 400, ey: 16 }, 5); eq(line.length, 1); eq(line[0].id, 'b0'); eq(line[0].cleared, true);
  const circ = solveByTag(os, 'ROBBANTÁS', { x: 216, y: 16, r: 120 }); eq(circ.length, 2); ok(circ.every(c => c.cleared)); eq(obstacleColliders(os).length, 0);
  const o2 = createObstacleSystem(defs);
  for (const bad of [null, 5, {}, { x: 0, y: 0 }, { x: NaN, y: 0, r: 5 }, { x: 0, y: 0, r: -1 }, { x: 0, y: 0, ex: NaN, ey: 0 }]) eq(solveByTag(o2, 'ROBBANTÁS', bad, 1).length, 0);
  eq(solveByTag(o2, 'FÉNY', { x: 100, y: 0, r: 99 }, 9).length, 0, 'nem megoldás-tag'); eq(solveByTag(o2, 'ROBBANTÁS', { x: 100, y: 0, r: 9 }, 0).length, 0); eq(solveByTag(o2, 5, { x: 0, y: 0, r: 9 }).length, 0); eq(solveByTag(null, 'X', {}).length, 0);
  const abil = [{ id: 'smash', resource: null, cost: 0, cooldown: 0, target: 'direction', range: 3, power: 2, tags: ['ROBBANTÁS'] }, { id: 'boom', resource: null, cost: 0, cooldown: 0, target: 'area', range: 3, power: 1, tags: ['ROBBANTÁS'] },
    { id: 'pulse', resource: null, cost: 0, cooldown: 0, target: 'self', range: 2, power: 9, tags: ['ROBBANTÁS'] }, { id: 'burn', resource: null, cost: 0, cooldown: 0, target: 'direction', range: 3, power: 9, tags: ['ÉGETÉS'] }];
  const reg = createCharacterRegistry({ races: [], classes: [{ id: 'k', resource: null, abilities: ['smash', 'boom', 'pulse'] }], abilities: abil }), sys = createAbilitySystem({ reg });
  const o3 = createObstacleSystem([{ id: 'z', kind: 'blocked', x: 120, y: -16, w: 32, h: 32, solves: ['ROBBANTÁS', 'ÉGETÉS'], hp: 3 }]), pl = [createPlayer(0, 100, 0), createPlayer(1, 700, 700)];
  const off = connectObstacles(o3, sys), step = () => stepAbilities(sys, pl, [{}, {}], [], 1);
  castAbility(sys, pl, 0, 'burn', { facing: right }); eq(o3.items.get('z').hp, 3, 'az ÉGETÉS-t a tár oldja, a figyelő kihagyja'); step();
  castAbility(sys, pl, 0, 'smash', { facing: right }); eq(o3.items.get('z').hp, 1); step(); castAbility(sys, pl, 0, 'boom', {}); eq(o3.cleared.has('z'), true); eq(o3.events.length, 1);
  const o4 = createObstacleSystem([{ id: 'z', kind: 'blocked', x: 120, y: -16, w: 32, h: 32, solves: ['ROBBANTÁS', 'ÉGETÉS'], hp: 3 }]), off4 = connectObstacles(o4, sys); step();
  castAbility(sys, pl, 0, 'pulse', {}); eq(o4.cleared.has('z'), true, 'self: kör az első körül'); off(); off4();
  const o5 = createObstacleSystem([{ id: 'z', kind: 'blocked', x: 120, y: -16, w: 32, h: 32, solves: ['ROBBANTÁS', 'ÉGETÉS'], hp: 3 }]); connectObstacles(o5, sys); step(); castAbility(sys, pl, 0, 'pulse', {}); eq(o5.cleared.size, 1);
});

test('obstacle: sötét átjáró – FÁKLYA a közelben nyit, távol zár, bent állva nem zár be, a closeDelay után csukódik', () => {
  const os = createObstacleSystem(), invs = createPlayerInventories(), players = mkPlayers([-250, -48], [900, 900]), g = os.items.get(GATE);
  const ctx = { players, inventories: invs }; eq(run(os, 5, ctx).length, 0); eq(g.open, false); eq(obstacleColliders(os).some(c => c.x === g.x), true);
  addItem(invs[0], 'torch', 1); const ev = run(os, 1, ctx); eq(ev[0].type, 'opened'); eq(ev[0].by, 'FÁKLYA'); eq(g.open, true); eq(obstacleColliders(os).some(c => c.x === g.x), false); eq(os.stats.opened, 1);
  players[0].x = -250 + 200; run(os, 60, ctx); eq(g.open, false, 'a fáklyás távol van: bezár'); eq(os.stats.closed, 1);
  players[0].x = -336; players[0].y = -48; run(os, 1, ctx); eq(g.open, true, 'a fáklyás bent áll');
  removeItem(invs[0], 'torch', 1); run(os, 300, ctx); eq(g.open, true, 'bent állva nem zár be');
  players[0].x = 0; players[0].y = 0; run(os, 20, ctx); eq(g.open, true, 'closeDelay (0,6 mp) alatt még nyitva'); run(os, 30, ctx); eq(g.open, false);
  eq(stepObstacles(null, 1, {}).length, 0); stepObstacles(os, NaN, { players: [null, { x: NaN, y: 1 }], inventories: null, lights: () => { throw new Error('x'); }, tagsOf: () => { throw new Error('y'); } });
});

test('obstacle: sötét átjáró – varázsló FÉNY (fogy, utána zár), törpe SÖTÉTLÁTÁS (faj-tag a tagsOf-ból), a távoli fény nem számít', () => {
  const os = createObstacleSystem(), reg = createCharacterRegistry(), sys = createAbilitySystem({ reg }), players = mkPlayers([-250, -48], [900, 900]), g = os.items.get(GATE);
  players[0].class = 'wizard'; const wz = attachWizard(sys, { players });
  const ctx = { players, lights: () => lightSources(wz) };
  run(os, 3, ctx); eq(g.open, false);
  ok(castAbility(sys, players, 0, 'light', {}).ok); const ev = run(os, 1, ctx); eq(ev[0].by, 'FÉNY'); eq(g.open, true);
  players[0].x = -250 + 400; run(os, 1, { players: [players[0], players[1]], lights: [{ x: -250, y: -48, r: 160 }] }); eq(g.open, true, 'a fény (a világ pontja) még lefedi');
  run(os, 60, { players, lights: [{ x: 5000, y: 5000, r: 160 }] }); eq(g.open, false, 'a távoli fény nem számít');
  const pl2 = mkPlayers([-250, -48], [900, 900]); applyRace(reg, pl2[0], 'dwarf'); applyRace(reg, pl2[1], 'elf');
  const c2 = { players: pl2, tagsOf: i => (raceOf(reg, pl2[i]) || {}).tags || [] };
  run(os, 1, c2); eq(g.open, true, 'törpe sötétlátása'); eq(os.events[0].by, 'SÖTÉTLÁTÁS');
  const os3 = createObstacleSystem(), pl3 = mkPlayers([-250, -48], [900, 900]); applyRace(reg, pl3[0], 'elf'); run(os3, 3, { players: pl3, tagsOf: i => (raceOf(reg, pl3[i]) || {}).tags || [] }); eq(os3.items.get(GATE).open, false, 'a tünde nem lát sötétben');
  const os4 = createObstacleSystem(); pl3[0].tags = ['SÖTÉTLÁTÁS']; run(os4, 1, { players: pl3 }); eq(os4.items.get(GATE).open, true, 'alap: p.tags');
});

test('obstacle: mentés – állapot-kör, csendes + atomi visszaállítás, ismeretlen id kihagyva; a betöltött akadály a tárból is eltűnik', () => {
  const os = createObstacleSystem(); solveByTag(os, 'ROBBANTÁS', { x: 352, y: 0, r: 5 }); const st = obstacleState(os); eq(JSON.stringify(st), JSON.stringify({ v: 1, cleared: [THICKET] }));
  const o2 = createObstacleSystem(), evs = []; onObstacle(o2, e => evs.push(e)); const v0 = o2.version;
  ok(restoreObstacles(o2, JSON.parse(JSON.stringify({ v: 1, cleared: [THICKET, 'nincs', GATE] })))); eq(evs.length, 0, 'csendes'); assert(o2.version > v0, 'version');
  eq(obstacleOpen(o2, THICKET), true); eq(o2.items.get(GATE).cleared, false, 'a dark nem feloldható mentéssel'); eq(o2.flammables.items.size, 0); eq(o2.breakables.walls.size, 0); eq(obstacleColliders(o2).length, 1);
  for (const bad of [null, 5, { v: 2, cleared: [] }, { v: 1 }, { v: 1, cleared: 'x' }, { v: 1, cleared: [THICKET, 5] }]) { const o3 = createObstacleSystem(); eq(restoreObstacles(o3, bad), false); eq(o3.cleared.size, 0, 'atomi'); }
  eq(restoreObstacles(null, st), false); ok(restoreObstacles(o2, st), 'újra betölthető');
  const reg = createCharacterRegistry(), sys = createAbilitySystem({ reg }), pl = mkPlayers(); pl[0].class = 'wizard'; attachWizard(sys, { players: pl, flammables: o2.flammables });
  eq(castAbility(sys, pl, 0, 'ignite', { facing: right }).reason, 'blocked', 'betöltés után nincs mit gyújtani');
});

test('obstacle: audit – kevés megoldás, forrás nélküli tag, kézzel nem craftolható megoldás; a planned tag kihagyva', () => {
  const src = { items: ITEM_DEFS, recipes: RECIPE_DEFS, abilities: ABILITY_DEFS, races: RACE_DEFS, classes: CLASS_DEFS };
  const mk = (id, solves) => ({ id, kind: 'blocked', x: 0, y: 0, w: 32, h: 32, solves });
  const os = createObstacleSystem([mk('one', ['FEJSZE']), mk('ghost', ['FEJSZE', 'ZZZ']), mk('noitem', ['ÉGETÉS', 'TÖRÉS']), mk('plan', ['FEJSZE', 'ROBBANTÁS'])]);
  const a = auditObstacles(os, src); eq(a.join(), 'one:few,ghost:nosource:ZZZ,noitem:noitem');
  assert(auditObstacles(os, src, []).includes('plan:nosource:ROBBANTÁS'), 'planned nélkül hiányolva'); eq(OBSTACLE_PLANNED_TAGS.join(), 'ROBBANTÁS');
  const station = auditObstacles(os, { ...src, recipes: RECIPE_DEFS.map(r => (r.id === 'axe' ? { ...r, station: 'MUNKAPAD' } : r)) });
  ok(station.includes('one:noitem') && station.includes('plan:noitem'), 'állomás-recept nem "kézzel craftolható"');
  eq(auditObstacles(os, null).length > 0, true); eq(auditObstacles(os, {}).includes('one:few'), true);
});

test('obstacle: a kaszt nem kapu – tárgyakkal (fejsze + fáklya), varázslóval, harcossal (ork) és törppel mindkét akadály feloldható / nyitható a megfelelő úton', () => {
  const reg = createCharacterRegistry();
  { // csak tárgyak, kaszt nélkül
    const os = createObstacleSystem(), invs = createPlayerInventories(), pl = mkPlayers([-250, -48], [300, 0]); addItem(invs[0], 'torch', 1); addItem(invs[1], 'axe', 1);
    const inputs = [{}, { interact: true }], targets = [null, axeTarget(os)];
    run(os, 90, { players: pl, inventories: invs, inputs, targets }); eq(os.items.get(GATE).open, true); eq(os.items.get(THICKET).cleared, true);
  }
  { // varázsló egyedül (nincs tárgy): ignite + light
    const os = createObstacleSystem(), sys = createAbilitySystem({ reg }), pl = mkPlayers([300, 0], [-250, -48]); pl[0].class = 'wizard'; pl[1].class = 'wizard';
    const wz = attachWizard(sys, { players: pl, flammables: os.flammables }); castAbility(sys, pl, 0, 'ignite', { facing: right }); castAbility(sys, pl, 1, 'light', {});
    stepWizard(wz, 2); stepObstacles(os, 1 / 60, { players: pl, lights: () => lightSources(wz) }); eq(os.items.get(THICKET).cleared, true); eq(os.items.get(GATE).open, true);
  }
  { // harcos-ork + törpe: sötétben a törpe lát, a harcos nem
    const os = createObstacleSystem(), sys = createAbilitySystem({ reg }), pl = mkPlayers([300, 0], [-250, -48]); pl[0].class = 'warrior'; applyRace(reg, pl[0], 'orc'); applyRace(reg, pl[1], 'dwarf');
    attachWarrior(sys, { players: pl, breakables: os.breakables }); castAbility(sys, pl, 0, 'wallbreak', { facing: right });
    stepObstacles(os, 1 / 60, { players: pl, tagsOf: i => (raceOf(reg, pl[i]) || {}).tags || [] }); eq(os.items.get(THICKET).cleared, true); eq(os.items.get(GATE).open, true);
    const os2 = createObstacleSystem(), pl2 = mkPlayers([-250, -48], [300, 0]); applyRace(reg, pl2[0], 'orc'); stepObstacles(os2, 1 / 60, { players: pl2, tagsOf: i => (raceOf(reg, pl2[i]) || {}).tags || [] }); eq(os2.items.get(GATE).open, false, 'az ork egyedül nem lát sötétben (kell fáklya)');
  }
  assert(OBSTACLE_CONFIG.torchReach > 0 && Object.isFrozen(OBSTACLE_CONFIG), 'konfig');
});

test('obstacle: 6000 kockás fuzz – nincs NaN, a feloldás egyirányú, az ütközők az akadályok részhalmaza, determinizmus (két futás azonos)', () => {
  const runFuzz = seed => {
    const rnd = mulberry32(seed), reg = createCharacterRegistry(), sys = createAbilitySystem({ reg }), os = createObstacleSystem(), invs = createPlayerInventories();
    const pl = mkPlayers([300, 0], [-250, -48]); pl[0].class = 'wizard'; pl[1].class = 'warrior'; applyRace(reg, pl[1], 'orc');
    const wz = attachWizard(sys, { players: pl, flammables: os.flammables }); attachWarrior(sys, { players: pl, breakables: os.breakables }); connectObstacles(os, sys);
    let lastCleared = 0, evCount = 0;
    for (let k = 0; k < 6000; k++) {
      for (const p of pl) { p.x += (rnd() - 0.5) * 12; p.y += (rnd() - 0.5) * 12; p.x = Math.max(-500, Math.min(500, p.x)); p.y = Math.max(-300, Math.min(300, p.y)); }
      if (rnd() < 0.01) { const inv = invs[Math.floor(rnd() * 2)], id = rnd() < 0.5 ? 'torch' : 'axe'; if (rnd() < 0.6) addItem(inv, id, 1); else removeItem(inv, id, 1); }
      if (rnd() < 0.03) castAbility(sys, pl, Math.floor(rnd() * 2), ['ignite', 'light', 'wallbreak', 'shove'][Math.floor(rnd() * 4)], { facing: [right, { x: -1, y: 0 }, { x: 0, y: 1 }][Math.floor(rnd() * 3)] });
      if (rnd() < 0.002) solveByTag(os, 'ROBBANTÁS', { x: pl[0].x, y: pl[0].y, r: rnd() * 400 }, rnd() * 3);
      stepAbilities(sys, pl, [{}, {}], [], 1 / 60); stepWizard(wz, 1 / 60);
      const inputs = [{ interact: rnd() < 0.7 }, { interact: rnd() < 0.7 }], targets = [rnd() < 0.5 ? axeTarget(os) : null, rnd() < 0.5 ? axeTarget(os) : null];
      evCount += stepObstacles(os, 1 / 60, { players: pl, inventories: invs, inputs, targets, lights: () => lightSources(wz), tagsOf: i => (raceOf(reg, pl[i]) || {}).tags || [] }).length;
      assert(os.cleared.size >= lastCleared, 'a feloldás egyirányú'); lastCleared = os.cleared.size;
      for (const s of os.sess) assert(Number.isFinite(s.progress) && s.progress >= 0 && s.progress < 1 + 1e-9 && Number.isFinite(s.lock), 'sess');
      for (const r of os.items.values()) assert(Number.isFinite(r.hp) && r.hp >= 0 && Number.isFinite(r.openLeft) && r.openLeft >= 0, 'rec ' + r.id);
      assert(obstacleColliders(os).length <= os.items.size, 'ütközők');
    }
    return JSON.stringify([obstacleState(os), [...os.items.values()].map(r => [r.id, r.hp, r.open]), os.stats, evCount, os.version]);
  };
  eq(runFuzz(5901), runFuzz(5901), 'determinizmus'); assert(runFuzz(5901) !== runFuzz(5902), 'más mag, más út');
});
