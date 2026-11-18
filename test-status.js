// Státuszhatások tesztjei (S072). Importja: test-index.js, game-status.js, render-status.js, game-health.js, game-player.js, game-encumbrance.js, game-healer.js, game-ability.js, game-registry.js, game-revive.js
import { test, assert, eq, near } from './test-index.js';
import {
  STATUS_IDS, STATUS_DEFS, STATUS_ON_DAMAGE, STATUS_CONFIG, STATUS_TEXTS, sanitizeStatusConfig, createStatuses, onStatus, applyStatus, statusOf, hasStatus,
  listStatuses, effectsOf, cleanseStatuses, clearStatuses, stepStatuses, connectStatuses, applyStatusSpeed, syncStatusesToPlayers,
} from './game-status.js';
import { STATUS_STYLE, STATUS_ICONS, statusLayout, drawStatusIcons, drawDarknessVignette } from './render-status.js';
import { createHealth, createPlayerHealths, applyDamage, killHealth, revive } from './game-health.js';
import { createPlayer } from './game-player.js';
import { syncEncumbrance } from './game-encumbrance.js';
import { HEALER_CONFIG, attachHealer } from './game-healer.js';
import { createAbilitySystem, castAbility, stepAbilities } from './game-ability.js';
import { createCharacterRegistry } from './game-registry.js';
import { HUD_CONFIG, hudLayout, menuLayout, createMenus } from './game-hud.js';

const mk = (o = {}) => {
  const healths = [createHealth({ max: 100, resist: o.resist0 }), createHealth({ max: 100 })];
  const ss = createStatuses({ healths, guard: o.guard, cfg: o.cfg });
  return { ss, healths };
};
function run(ss, secs, dt = 1 / 60) { let t = 0; const ev = []; while (t < secs - 1e-9) { const d = Math.min(dt, secs - t); ev.push(...stepStatuses(ss, d)); t += d; } return ev; }
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function rec() {
  const c = { fills: [], texts: [], depth: 0, bad: 0, fillStyle: '', font: '', globalAlpha: 1 };
  c.save = () => { c.depth++; };
  c.restore = () => { c.depth--; if (c.depth < 0) c.bad++; };
  c.fillRect = (x, y, w, h) => c.fills.push({ x, y, w, h, s: c.fillStyle, a: c.globalAlpha });
  c.fillText = (s, x, y) => c.texts.push({ s, x, y });
  return c;
}
const finite = c => c.fills.every(f => [f.x, f.y, f.w, f.h].every(Number.isFinite)) && c.texts.every(f => Number.isFinite(f.x) && Number.isFinite(f.y));
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('status: adat – 5 státusz, érvényes def-ek, a healer káros-listájával egyezik, HU/EN szövegek és ikonok mindenhez', () => {
  eq(STATUS_IDS.join(), 'burn,freeze,poison,slow,darkness');
  eq([...STATUS_IDS].sort().join(), [...HEALER_CONFIG.harmful].sort().join(), 'a healer harmful listája');
  const orders = new Set();
  for (const id of STATUS_IDS) {
    const d = STATUS_DEFS[id];
    assert(d && d.secs > 0 && d.secs <= d.maxSecs && d.maxStacks >= 1 && ['refresh', 'stack', 'extend'].includes(d.stacking), 'def: ' + id);
    assert(d.speedMul > 0 && d.speedMul <= 1 && d.visionMul > 0 && d.visionMul <= 1, 'szorzók: ' + id);
    assert(Object.isFrozen(d) && Object.isFrozen(d.cancels), 'fagyasztott: ' + id);
    assert(!orders.has(d.order), 'egyedi sorrend'); orders.add(d.order);
    for (const c of d.cancels) assert(STATUS_IDS.includes(c) && c !== id, 'cancels: ' + id);
    if (d.dot) assert(d.dot.dps > 0 && ['fire', 'poison', 'frost', 'dark', 'physical', 'heat'].includes(d.dot.type), 'dot: ' + id);
    assert(/^status\./.test('status.' + id) && STATUS_TEXTS.hu['status.' + id] && STATUS_TEXTS.en['status.' + id], 'szöveg: ' + id);
    const m = STATUS_ICONS[id];
    assert(Array.isArray(m) && m.length === 8 && m.every(r => r.length === 8 && /^[#.]+$/.test(r)) && m.some(r => r.includes('#')), 'ikon: ' + id);
  }
  eq(Object.keys(STATUS_TEXTS.hu).join(), Object.keys(STATUS_TEXTS.en).join(), 'azonos kulcsok');
  for (const [k, v] of Object.entries(STATUS_ON_DAMAGE)) assert(STATUS_IDS.includes(v), 'on-damage: ' + k);
  assert(Object.isFrozen(STATUS_CONFIG) && Object.isFrozen(STATUS_STYLE) && Object.isFrozen(STATUS_DEFS));
  const c = sanitizeStatusConfig({ tick: -1, minSpeedMul: 9, maxDt: NaN, maxEvents: 5.4, x: 1 });
  eq(c.tick, 0.05); eq(c.minSpeedMul, 1); eq(c.maxDt, STATUS_CONFIG.maxDt); eq(c.maxEvents, 5); eq(c.x, undefined);
});

test('status: halmozás – refresh (idő vissza, 1 stack), stack (+1, plafon), extend (idő nő, plafon), a rövidebb nem rövidít', () => {
  const { ss } = mk();
  let r = applyStatus(ss, 0, 'burn'); eq(r.ok, true); eq(r.mode, 'new'); eq(r.stacks, 1); near(r.left, 4);
  run(ss, 3);
  near(statusOf(ss, 0, 'burn').left, 1, 1e-6);
  r = applyStatus(ss, 0, 'burn'); eq(r.mode, 'refresh'); eq(r.stacks, 1); near(r.left, 4);
  r = applyStatus(ss, 0, 'burn', { secs: 1 }); near(r.left, 4, 1e-6, 'rövidebb nem rövidít');
  for (let k = 0; k < 9; k++) applyStatus(ss, 1, 'poison');
  eq(statusOf(ss, 1, 'poison').stacks, STATUS_DEFS.poison.maxStacks, 'stack-plafon');
  eq(applyStatus(ss, 0, 'slow', { stacks: 2 }).stacks, 2);
  eq(applyStatus(ss, 0, 'slow', { stacks: 99 }).stacks, STATUS_DEFS.slow.maxStacks);
  applyStatus(ss, 0, 'freeze'); near(statusOf(ss, 0, 'freeze').left, 3);
  r = applyStatus(ss, 0, 'freeze'); eq(r.mode, 'extend'); near(r.left, 6);
  r = applyStatus(ss, 0, 'freeze'); near(r.left, STATUS_DEFS.freeze.maxSecs, 1e-9, 'extend-plafon');
  assert(!hasStatus(ss, 1, 'freeze') && hasStatus(ss, 0, 'freeze'), 'játékosonként külön');
});

test('status: hibás bemenet – ismeretlen/öröklött id, rossz játékos, NaN/negatív opció, halott cél, immunitás; az állapot nem sérül', () => {
  const { ss, healths } = mk({ guard: (i, id) => (id === 'poison' ? 1 : 0) });
  for (const id of ['nincs', 'toString', '__proto__', 'constructor', '', null, undefined, 5, {}, []]) eq(applyStatus(ss, 0, id).reason, 'bad-status', 'id: ' + String(id));
  for (const i of [-1, 2, 0.5, NaN, '0', null, undefined]) eq(applyStatus(ss, i, 'burn').reason, 'bad-player', 'játékos: ' + String(i));
  for (const o of [{ secs: NaN }, { secs: -1 }, { secs: 0 }, { secs: Infinity }, { stacks: 0 }, { stacks: NaN }, { power: -1 }, { power: NaN }]) eq(applyStatus(ss, 0, 'burn', o).reason, 'bad-opts', JSON.stringify(o));
  eq(applyStatus(ss, 0, 'poison').reason, 'immune');
  killHealth(healths[1]);
  eq(applyStatus(ss, 1, 'burn').reason, 'dead');
  eq(listStatuses(ss, 0).length + listStatuses(ss, 1).length, 0, 'semmi nem került be');
  assert(ss.stats.refused > 15);
  for (const bad of [null, undefined, 5, 'x', {}]) {
    eq(applyStatus(bad, 0, 'burn').ok, false); eq(statusOf(bad, 0, 'burn'), null); eq(listStatuses(bad, 0).length, 0); eq(cleanseStatuses(bad, 0), 0);
    eq(clearStatuses(bad, 0), 0); eq(stepStatuses(bad, 0.1).length, 0); eq(effectsOf(bad, 0).speedMul, 1); eq(applyStatusSpeed(bad, []), 0); eq(syncStatusesToPlayers(bad, []), 0);
  }
  eq(stepStatuses(ss, NaN).length, 0); eq(stepStatuses(ss, -1).length, 0);
});

test('status: védelem (guard) – a hatás ideje (1-r)-szeres; a hibás/kivételt dobó guard nem védi a célt', () => {
  const { ss } = mk({ guard: (i, id) => (id === 'burn' ? 0.5 : id === 'slow' ? NaN : id === 'poison' ? 99 : 0) });
  near(applyStatus(ss, 0, 'burn').left, 2);
  near(applyStatus(ss, 0, 'slow').left, 5);
  eq(applyStatus(ss, 0, 'poison').reason, 'immune', 'a >1 érték 1-re szorul');
  const t = mk({ guard: () => { throw new Error('guard hiba'); } });
  eq(applyStatus(t.ss, 0, 'burn').ok, true); assert(/guard hiba/.test(t.ss.lastError));
});

test('status: egymást oltó hatások – az égés olvasztja a fagyást, a fagyás oltja az égést; esemény jelzi', () => {
  const { ss } = mk(); const evs = []; onStatus(ss, e => evs.push(e));
  applyStatus(ss, 0, 'freeze'); applyStatus(ss, 0, 'burn');
  assert(hasStatus(ss, 0, 'burn') && !hasStatus(ss, 0, 'freeze'));
  applyStatus(ss, 0, 'freeze');
  assert(hasStatus(ss, 0, 'freeze') && !hasStatus(ss, 0, 'burn'));
  eq(evs.filter(e => e.type === 'cancel').map(e => e.id + '<' + e.by).join(), 'freeze<burn,burn<freeze');
  applyStatus(ss, 1, 'burn'); assert(hasStatus(ss, 0, 'freeze') && hasStatus(ss, 1, 'burn'), 'a másik játékos érintetlen');
  eq(ss.stats.cancelled, 2);
});

test('status: időzítő – pontos lejárat, esemény egyszer, a nagy dt korlátos, a lista sorrendje a def.order szerint', () => {
  const { ss } = mk(); const evs = []; onStatus(ss, e => evs.push(e.type + ':' + e.id));
  applyStatus(ss, 0, 'darkness'); applyStatus(ss, 0, 'slow'); applyStatus(ss, 0, 'poison', { secs: 1 });
  eq(listStatuses(ss, 0).map(s => s.id).join(), 'poison,slow,darkness');
  run(ss, 0.9); assert(hasStatus(ss, 0, 'poison'));
  run(ss, 0.2); assert(!hasStatus(ss, 0, 'poison'));
  eq(evs.filter(e => e === 'expire:poison').length, 1);
  run(ss, 4.5); assert(!hasStatus(ss, 0, 'slow') && hasStatus(ss, 0, 'darkness'));
  run(ss, 5.6); eq(listStatuses(ss, 0).length, 0);
  eq(ss.stats.expired, 3);
  applyStatus(ss, 0, 'burn', { secs: 5 }); stepStatuses(ss, 100); // dt <= maxDt (1 mp)
  near(statusOf(ss, 0, 'burn').left, 4, 1e-9);
  const r = listStatuses(ss, 0)[0]; assert(r.ratio > 0 && r.ratio <= 1 && /^#/.test(r.color));
});

test('status: DoT – az égés 4 mp alatt pontosan 12 sebzés, a kocka-hossztól függetlenül; i-frame nem véd; forrás/tag', () => {
  for (const dt of [1 / 60, 1 / 30, 0.37, 0.5]) {
    const { ss, healths } = mk(); const dmg = []; healths[0].listeners.add(e => { if (e.type === 'damage') dmg.push(e); });
    applyStatus(ss, 0, 'burn'); healths[0].invuln = 10;
    run(ss, 4.5, dt);
    near(100 - healths[0].hp, 12, 1e-6, 'dt ' + dt);
    assert(dmg.length >= 1 && dmg.every(e => e.tag === 'status' && e.source === 'status:burn' && e.kind === 'fire'), 'esemény-mezők');
    assert(dmg.length <= 12, 'összevont csapások, nem kockánkénti: ' + dmg.length);
    eq(healths[1].hp, 100, 'a másik játékos érintetlen');
  }
});

test('status: DoT – méreg stackenként dps·stack, power szorzó, ellenállás és immunitás érvényes, a halál törli a státuszokat', () => {
  const a = mk(); applyStatus(a.ss, 0, 'poison', { stacks: 3 }); run(a.ss, 8.2);
  near(100 - a.healths[0].hp, 24, 1e-6, '1 dps · 3 stack · 8 mp');
  const b = mk(); applyStatus(b.ss, 0, 'burn', { power: 2 }); run(b.ss, 4.2);
  near(100 - b.healths[0].hp, 24, 1e-6, 'power 2');
  const c = mk({ resist0: { fire: 0.5 } }); applyStatus(c.ss, 0, 'burn'); run(c.ss, 4.2);
  near(100 - c.healths[0].hp, 6, 1e-6, 'tűz-ellenállás .5');
  const d = mk({ resist0: { fire: 1 } }); applyStatus(d.ss, 0, 'burn'); run(d.ss, 4.2);
  eq(d.healths[0].hp, 100, 'immunitás');
  const e = mk(); e.healths[0].hp = 2; applyStatus(e.ss, 0, 'burn'); applyStatus(e.ss, 0, 'slow');
  const evs = run(e.ss, 2);
  assert(e.healths[0].dead && evs.some(x => x.type === 'dot' && x.killed), 'a DoT megölt');
  eq(listStatuses(e.ss, 0).length, 0, 'halál -> státuszok törölve');
  eq(applyStatus(e.ss, 0, 'burn').reason, 'dead');
  revive(e.healths[0], 0.5); eq(applyStatus(e.ss, 0, 'burn').ok, true, 'élesztés után újra kaphat');
});

test('status: kötés – a sebzés-típus/tag státuszt ad, a DoT nem alakul vissza, a halál töröl, a detach leállít', () => {
  const { ss, healths } = mk(); const off = connectStatuses(ss);
  applyDamage(healths[0], { amount: 1, type: 'physical' }); eq(listStatuses(ss, 0).length, 0, 'fizikai: nincs státusz');
  applyDamage(healths[0], { amount: 1, type: 'heat' }); eq(listStatuses(ss, 0).length, 0, 'hőség: a S088 zónáké');
  applyDamage(healths[0], { amount: 1, type: 'fire' }); assert(hasStatus(ss, 0, 'burn'));
  applyDamage(healths[0], { amount: 1, type: 'frost' }); assert(hasStatus(ss, 0, 'slow'));
  applyDamage(healths[1], { amount: 1, type: 'poison' }); applyDamage(healths[1], { amount: 1, type: 'poison', ignoreInvuln: true }); eq(statusOf(ss, 1, 'poison').stacks, 2);
  applyDamage(healths[1], { amount: 1, type: 'dark' }); assert(hasStatus(ss, 1, 'darkness'));
  applyDamage(healths[0], { amount: 1, type: 'physical', tag: 'freeze', ignoreInvuln: true }); assert(hasStatus(ss, 0, 'freeze') && !hasStatus(ss, 0, 'burn'), 'tag = id közvetlenül');
  const applied = ss.stats.applied;
  run(ss, 3); // a méreg-DoT (tag status) nem ad újabb státuszt / stacket
  eq(statusOf(ss, 1, 'poison').stacks, 2); eq(ss.stats.applied, applied);
  applyDamage(healths[0], { amount: 1000, type: 'fire', ignoreInvuln: true });
  eq(listStatuses(ss, 0).length, 0, 'halál töröl (a sebzés-esemény státusza is)');
  eq(listStatuses(ss, 1).length > 0, true);
  off();
  applyDamage(healths[1], { amount: 1, type: 'fire', ignoreInvuln: true }); assert(!hasStatus(ss, 1, 'burn'), 'detach után nincs kötés');
  assert(typeof connectStatuses(null) === 'function' && typeof connectStatuses({}) === 'function');
  const imm = mk({ resist0: { frost: 1 } }); connectStatuses(imm.ss); applyDamage(imm.healths[0], { amount: 5, type: 'frost' });
  eq(listStatuses(imm.ss, 0).length, 0, 'immunis sebzés: nincs esemény, nincs státusz');
});

test('status: hatás – sebesség stackenként szorzódik, alsó korlát, sötétség látótáv; applyStatusSpeed nem halmozódik kockánként', () => {
  const { ss } = mk();
  eq(effectsOf(ss, 0).speedMul, 1); eq(effectsOf(ss, 0).visionMul, 1); eq(effectsOf(ss, 0).dps, 0);
  applyStatus(ss, 0, 'slow', { stacks: 3 }); near(effectsOf(ss, 0).speedMul, 0.8 ** 3);
  applyStatus(ss, 0, 'freeze'); near(effectsOf(ss, 0).speedMul, STATUS_CONFIG.minSpeedMul, 1e-9, 'alsó korlát (0.512 · 0.4 < 0.25)');
  applyStatus(ss, 1, 'darkness'); near(effectsOf(ss, 1).visionMul, 0.5); near(effectsOf(ss, 1).speedMul, 0.85);
  applyStatus(ss, 1, 'burn'); applyStatus(ss, 1, 'poison', { stacks: 2 }); near(effectsOf(ss, 1).dps, 3 + 2);
  const ps = [createPlayer(0, 0, 0), createPlayer(1, 0, 0)];
  for (let k = 0; k < 50; k++) { syncEncumbrance(ps, [null, null]); applyStatusSpeed(ss, ps); }
  near(ps[0].speedMul, STATUS_CONFIG.minSpeedMul, 1e-9, '50 kocka után sem halmozódik'); near(ps[1].speedMul, 0.85);
  const q = createPlayer(0, 0, 0); q.speedMul = 0.5; applyStatusSpeed(createStatuses(), [q]); near(q.speedMul, 0.5, 1e-12, 'státusz nélkül érintetlen');
  const w = createPlayer(0, 0, 0); w.speedMul = NaN; applyStatusSpeed(ss, [w]); near(w.speedMul, STATUS_CONFIG.minSpeedMul, 1e-9, 'hibás alap -> 1');
  const sy = syncStatusesToPlayers(ss, ps); eq(sy, 2);
  eq(ps[0].statuses.map(s => s.id).join(), 'freeze,slow'); eq(ps[0].statuses[1].stacks, 3); near(ps[1].statusFx.visionMul, 0.5);
  const g = JSON.stringify(ps[0].statuses); assert(!/NaN|null|undefined/.test(g), g);
});

test('status: tisztítás – csak a káros (mind az), részleges lista, esemény, a halott/hibás célon 0; a healer cleanse képesség horgon át', () => {
  const { ss } = mk(); const evs = [];
  onStatus(ss, e => { if (e.type === 'cleanse') evs.push(e.id); });
  for (const id of STATUS_IDS) if (id !== 'freeze') applyStatus(ss, 0, id); // az égés és a fagy nem él együtt
  applyStatus(ss, 1, 'slow');
  eq(listStatuses(ss, 0).length, 4);
  eq(cleanseStatuses(ss, 0, ['slow', 'nincs']), 1); eq(hasStatus(ss, 0, 'slow'), false);
  eq(cleanseStatuses(ss, 0), 3); eq(listStatuses(ss, 0).length, 0);
  eq(hasStatus(ss, 1, 'slow'), true, 'a másik játékos érintetlen');
  eq(cleanseStatuses(ss, 0), 0); eq(cleanseStatuses(ss, 7), 0); eq(cleanseStatuses(ss, 1, 'slow'), 1, 'nem tömb-szűrő -> mind');
  eq(evs.length, 5);
  // healer: a hatókörben lévők státuszai a hookon át tisztulnak
  const reg = createCharacterRegistry(), sys = createAbilitySystem({ reg });
  const players = [createPlayer(0, 100, 100), createPlayer(1, 160, 100)];
  players.forEach(p => { p.class = 'healer'; p.hp = 50; p.hpMax = 100; });
  const t = mk(); applyStatus(t.ss, 0, 'burn'); applyStatus(t.ss, 1, 'poison', { stacks: 2 }); applyStatus(t.ss, 1, 'slow');
  attachHealer(sys, { players, cleanse: (p, info) => cleanseStatuses(t.ss, info.target) });
  castAbility(sys, players, 0, 'cleanse', {});
  stepAbilities(sys, players, [{}, {}], [], 5);
  eq(listStatuses(t.ss, 0).length + listStatuses(t.ss, 1).length, 0, 'a healer mindkét játékost megtisztította');
});

test('status: törlés és események – clearStatuses (játékos/mindkettő), listener-hiba nem állít meg, az eseménynapló korlátos', () => {
  const { ss } = mk(); let calls = 0;
  onStatus(ss, () => { calls++; throw new Error('figyelő-hiba'); });
  const off = onStatus(ss, () => { calls += 100; });
  applyStatus(ss, 0, 'burn'); applyStatus(ss, 1, 'slow'); assert(calls >= 101 && /figyelő-hiba/.test(ss.lastError));
  off(); eq(clearStatuses(ss, 0, 'teszt'), 1); eq(listStatuses(ss, 0).length, 0); eq(listStatuses(ss, 1).length, 1);
  eq(clearStatuses(ss, undefined, 'wipe'), 1); eq(clearStatuses(ss), 0); eq(clearStatuses(ss, 9), 0);
  eq(ss.events[ss.events.length - 1].reason, 'wipe');
  for (let k = 0; k < 300; k++) { applyStatus(ss, 0, 'poison'); cleanseStatuses(ss, 0); }
  assert(ss.events.length <= ss.cfg.maxEvents, 'napló korlátos: ' + ss.events.length);
  assert(typeof onStatus(null, () => {}) === 'function' && typeof onStatus(ss, null) === 'function');
});

test('status: elrendezés – az ikon-sor a HUD fölött (nyitott menünél a menü fölött), a vásznon belül, P2 jobbra igazított', () => {
  const VW = 960, VH = 540;
  for (const idx of [0, 1]) {
    for (const open of [false, true]) {
      const rs = statusLayout(idx, 5, VW, VH, open), hud = hudLayout(idx, VW, VH), menu = menuLayout(idx, VW, VH);
      eq(rs.length, 5);
      for (const r of rs) {
        assert(r.x >= 0 && r.y >= 0 && r.x + r.w <= VW && r.y + r.h <= VH, 'vásznon belül');
        assert(!overlap(r, hud), 'nem takarja a HUD-ot');
        if (open) assert(!overlap(r, menu), 'nem takarja a menüt'); else assert(r.y + r.h <= hud.y, 'a HUD fölött');
      }
      for (let k = 0; k < rs.length; k++) for (let m = k + 1; m < rs.length; m++) assert(!overlap(rs[k], rs[m]), 'ikonok nem fedik egymást');
      if (idx === 0) eq(rs[0].x, hud.x); else eq(rs[0].x + rs[0].w, hud.x + hud.w);
    }
  }
  eq(statusLayout(0, 0, VW, VH, false).length, 0); eq(statusLayout(0, -2, VW, VH, false).length, 0); eq(statusLayout(0, 1.5, VW, VH, false).length, 0); eq(statusLayout(0, 2, NaN, VH, false).length, 0);
});

test('status: rajz – ikonok, stack-szám, villogás, menü-váltás; üres/hibás bemenet nem dob; save/restore egyensúly; a vignetta csak sötétségnél', () => {
  const { ss } = mk(); const ps = [createPlayer(0, 400, 300), createPlayer(1, 500, 300)], menus = createMenus();
  eq(drawStatusIcons(rec(), ss, ps, menus, 960, 540), 0);
  applyStatus(ss, 0, 'burn'); applyStatus(ss, 0, 'poison', { stacks: 3 }); applyStatus(ss, 1, 'darkness');
  const c = rec(); eq(drawStatusIcons(c, ss, ps, menus, 960, 540), 3);
  eq(c.depth, 0); eq(c.bad, 0); assert(finite(c));
  eq(c.texts.map(t => t.s).join(), '3', 'csak a >1 stack kap számot');
  assert(c.fills.length > 3 * 4, 'ikon-pontok is rajzolódtak');
  menus.open[0] = true;
  const o = rec(); eq(drawStatusIcons(o, ss, ps, menus, 960, 540), 3);
  assert(Math.min(...o.fills.map(f => f.y)) < Math.min(...c.fills.map(f => f.y)), 'nyitott menünél feljebb kerül');
  run(ss, 3.7); // a burn lejár, a méreg/sötétség még él -> egy ikon villog az utolsó 1,5 mp-ben
  const b = rec(); drawStatusIcons(b, ss, ps, menus, 960, 540); assert(b.fills.every(f => f.a === 1 || f.a === 0.45));
  for (const bad of [[null, ss, ps, menus, 960, 540], [rec(), null, ps, menus, 960, 540], [rec(), ss, null, menus, 960, 540], [rec(), ss, ps, null, NaN, 540], [rec(), ss, [null, null], menus, 960, 540]]) {
    let n; try { n = drawStatusIcons(...bad); } catch (e) { assert(false, 'dobott: ' + e.message); }
    eq(n >= 0, true);
  }
  // vignetta
  const grads = []; const g = rec();
  g.createRadialGradient = (...a) => { const o2 = { a, stops: [], addColorStop(p, col) { this.stops.push([p, col]); } }; grads.push(o2); return o2; };
  eq(drawDarknessVignette(g, ss, ps, 100, 100, 960, 540), 1);
  eq(grads.length, 1); near(grads[0].a[0], 500 - 100); near(grads[0].a[1], 300 - 100); eq(grads[0].a[0], grads[0].a[3]); near(grads[0].a[5], STATUS_STYLE.vignetteRadius * 0.5);
  assert(grads[0].stops.length === 2 && /^rgba\(0,0,12,0\.\d+\)$/.test(grads[0].stops[1][1]), 'sötétedő szél: ' + grads[0].stops[1][1]);
  eq(drawDarknessVignette(rec(), ss, ps, 0, 0, 960, 540), 0, 'gradiens nélküli ctx');
  eq(drawDarknessVignette(g, createStatuses(), ps, 0, 0, 960, 540), 0, 'nincs sötétség');
  eq(drawDarknessVignette(g, ss, ps, NaN, 0, 960, 540), 0);
  eq(drawDarknessVignette(g, ss, [null, { x: NaN, y: 1 }], 0, 0, 960, 540), 0);
});

test('status: 3600 kockás smoke – két játékos, véletlen sebzés/tisztítás/halál/élesztés; nincs NaN, a sebesség a korláton belül, a lista egyedi és rendezett', () => {
  const rnd = lcg(72), healths = createPlayerHealths([createPlayer(0, 0, 0), createPlayer(1, 0, 0)]);
  const ss = createStatuses({ healths }); connectStatuses(ss);
  const ps = [createPlayer(0, 0, 0), createPlayer(1, 0, 0)];
  const types = ['physical', 'fire', 'frost', 'poison', 'dark', 'heat'];
  let deaths = 0, maxSeen = 0;
  for (let f = 0; f < 3600; f++) {
    for (let i = 0; i < 2; i++) {
      const r = rnd();
      if (r < 0.0008) applyDamage(healths[i], { amount: 60 + rnd() * 40, type: types[Math.floor(rnd() * types.length)], ignoreInvuln: true });
      else if (r < 0.012) applyDamage(healths[i], { amount: 1 + rnd() * 6, type: types[Math.floor(rnd() * types.length)], tag: rnd() < 0.1 ? 'freeze' : undefined });
      else if (r < 0.014) applyStatus(ss, i, STATUS_IDS[Math.floor(rnd() * 5)], { secs: 1 + rnd() * 8, stacks: 1 + Math.floor(rnd() * 3) });
      else if (r < 0.0155) cleanseStatuses(ss, i);
      else if (r < 0.0165 && healths[i].dead) revive(healths[i], 0.5);
      else if (r < 0.0170) healths[i].invuln = 0.5;
    }
    healths.forEach(h => { if (h.dead && !h._c) { h._c = 1; deaths++; } if (!h.dead) h._c = 0; });
    stepStatuses(ss, 1 / 60);
    healths.forEach(h => { if (h.invuln > 0) h.invuln = Math.max(0, h.invuln - 1 / 60); });
    syncEncumbrance(ps, [null, null]); applyStatusSpeed(ss, ps); syncStatusesToPlayers(ss, ps);
    for (let i = 0; i < 2; i++) {
      const h = healths[i], l = listStatuses(ss, i), ids = l.map(s => s.id);
      assert(Number.isFinite(h.hp) && h.hp >= 0 && h.hp <= h.max, 'hp: ' + h.hp);
      assert(new Set(ids).size === ids.length, 'egyedi id-k');
      for (let k = 1; k < l.length; k++) assert(STATUS_DEFS[l[k - 1].id].order < STATUS_DEFS[l[k].id].order, 'rendezett');
      for (const s of l) { assert(Number.isFinite(s.left) && s.left > 0 && s.left <= s.max + 1e-9 && s.stacks >= 1 && s.stacks <= STATUS_DEFS[s.id].maxStacks, 'státusz-mezők'); }
      assert(Number.isFinite(ps[i].speedMul) && ps[i].speedMul >= STATUS_CONFIG.minSpeedMul - 1e-9 && ps[i].speedMul <= 1 + 1e-9, 'speedMul: ' + ps[i].speedMul);
      if (h.dead) eq(l.length, 0, 'halott játékosnak nincs státusza');
      maxSeen = Math.max(maxSeen, l.length);
    }
  }
  assert(deaths > 0 && maxSeen >= 2 && ss.stats.ticks > 20, `a smoke lefedte a kimeneteket: halál ${deaths}, max ${maxSeen}, csapás ${ss.stats.ticks}`);
});
