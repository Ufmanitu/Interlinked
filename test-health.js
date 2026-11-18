// Életerő és sebzés tesztjei (S066). Importja: test-index.js, game-health.js, game-hud.js
import { test, assert, eq, near } from './test-index.js';
import {
  DAMAGE_TYPES, HEALTH_CONFIG, HEALTH_TEXTS, sanitizeDamage, makeDamage, createHealth, isHealth, onHealth,
  setResist, resistOf, applyDamage, killHealth, heal, revive, setInvulnerable, setMaxHealth, stepHealth,
  healthRatio, syncHealthToPlayer, createPlayerHealths, stepPlayerHealths, healthState, restoreHealth,
} from './game-health.js';
import { hudModel, HUD_CONFIG } from './game-hud.js';

function rec(h) { const ev = []; onHealth(h, e => ev.push(e)); return ev; }
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

test('health: létrehozás, alapértékek, hibás bemenet', () => {
  let h = createHealth();
  eq(h.max, 100); eq(h.hp, 100); eq(h.dead, false); assert(isHealth(h));
  h = createHealth({ max: 50, hp: 20 }); eq(h.max, 50); eq(h.hp, 20);
  eq(createHealth({ max: 50, hp: 99 }).hp, 50);
  eq(createHealth({ max: -5 }).max, 100);
  eq(createHealth({ max: NaN }).max, 100);
  eq(createHealth({ max: 'x' }).max, 100);
  eq(createHealth({ max: 1e12 }).max, HEALTH_CONFIG.maxMax);
  eq(createHealth({ max: 50, hp: NaN }).hp, 50);
  eq(createHealth(null).max, 100);
  eq(createHealth(7).max, 100);
  h = createHealth({ max: 50, hp: 0 }); eq(h.dead, true); eq(h.hp, 0);
  eq(createHealth({ hp: -3 }).dead, true);
  assert(!isHealth(null) && !isHealth({}) && !isHealth({ hp: 1, max: 2 }));
});

test('health: DamageInfo szűrés', () => {
  let d = sanitizeDamage(12);
  eq(d.amount, 12); eq(d.type, 'physical'); eq(d.source, null); eq(d.ignoreResist, false);
  d = sanitizeDamage({ amount: 5, type: 'fire', source: 'wolf', tag: 'bite', knockback: { x: 1, y: -2 }, ignoreInvuln: true });
  eq(d.type, 'fire'); eq(d.source, 'wolf'); eq(d.tag, 'bite'); eq(d.knockback.y, -2); eq(d.ignoreInvuln, true);
  eq(sanitizeDamage(-1), null); eq(sanitizeDamage(NaN), null); eq(sanitizeDamage(Infinity), null);
  eq(sanitizeDamage(null), null); eq(sanitizeDamage('5'), null); eq(sanitizeDamage({}), null);
  eq(sanitizeDamage({ amount: 5, type: 'laser' }), null);
  eq(sanitizeDamage({ amount: 5, type: 'constructor' }), null);
  eq(sanitizeDamage({ amount: 5, knockback: { x: NaN, y: 0 } }).knockback, null);
  eq(sanitizeDamage({ amount: 5, knockback: 3 }).knockback, null);
  eq(sanitizeDamage({ amount: 5, source: {} }).source, null);
  eq(sanitizeDamage({ amount: 5, tag: 'x'.repeat(30) }).tag, null);
  eq(sanitizeDamage({ amount: 1e12 }).amount, HEALTH_CONFIG.maxAmount);
  assert(Object.isFrozen(d));
  eq(makeDamage(7, 'frost', { source: 3 }).source, 3);
  eq(makeDamage(7, 'nope'), null);
});

test('health: sebzés, esemény, statisztika', () => {
  const h = createHealth(); const ev = rec(h);
  const r = applyDamage(h, { amount: 30, type: 'physical', source: 'wolf', knockback: { x: 1, y: 0 } });
  eq(r.ok, true); eq(r.dealt, 30); eq(r.killed, false); eq(r.reason, null); eq(h.hp, 70);
  eq(ev.length, 1); eq(ev[0].type, 'damage'); eq(ev[0].amount, 30); eq(ev[0].kind, 'physical');
  eq(ev[0].source, 'wolf'); eq(ev[0].hp, 70); eq(ev[0].max, 100); eq(ev[0].knockback.x, 1);
  eq(h.stats.hits, 1); eq(h.stats.damage, 30);
  eq(applyDamage(h, 0).dealt, 0); eq(ev.length, 1);
});

test('health: ellenállás, gyengeség, immunitás, ignoreResist', () => {
  const h = createHealth({ resist: { fire: 0.5, frost: -0.5, poison: 1, physical: 5, bogus: 1 } });
  eq(h.resist.physical, 1); eq(h.resist.bogus, undefined);
  let r = applyDamage(h, { amount: 40, type: 'fire' }); near(r.dealt, 20); near(r.resisted, 20); near(h.hp, 80);
  r = applyDamage(h, { amount: 20, type: 'frost' }); near(r.dealt, 30); near(h.hp, 50);
  const ev = rec(h);
  r = applyDamage(h, { amount: 99, type: 'poison' }); eq(r.ok, true); eq(r.dealt, 0); eq(ev.length, 0); near(h.hp, 50);
  r = applyDamage(h, { amount: 10, type: 'fire', ignoreResist: true }); near(r.dealt, 10); near(h.hp, 40);
  eq(resistOf(h, 'dark'), 0); eq(resistOf(h, 'x'), 0); eq(resistOf(null, 'fire'), 0);
  eq(setResist(h, 'dark', 0.25), true); eq(setResist(h, 'x', 0.1), false); eq(setResist(h, 'dark', NaN), false);
  near(resistOf(h, 'dark'), 0.25);
});

test('health: resistFn (felszerelés/faj), hibás hook nem dob', () => {
  const h = createHealth({ resist: { fire: 0.5 }, resistFn: t => (t === 'fire' ? 0.25 : 0) });
  near(resistOf(h, 'fire'), 0.75);
  near(applyDamage(h, { amount: 100, type: 'fire' }).dealt, 25);
  h.resistFn = () => 0.9; eq(resistOf(h, 'fire'), 1);
  h.resistFn = () => { throw new Error('boom'); };
  near(resistOf(h, 'fire'), 0.5); assert(/boom/.test(h.lastError));
  h.resistFn = () => NaN; near(resistOf(h, 'fire'), 0.5);
});

test('health: halál, túlsebzés, egyszeri esemény', () => {
  const h = createHealth({ max: 40 }); const ev = rec(h);
  applyDamage(h, 30);
  const r = applyDamage(h, { amount: 25, source: 'troll' });
  eq(r.killed, true); eq(r.dealt, 10); eq(r.overkill, 15); eq(h.hp, 0); eq(h.dead, true);
  eq(ev.map(e => e.type).join(','), 'damage,damage,death');
  eq(ev[2].source, 'troll'); eq(h.stats.kills, 1);
  const r2 = applyDamage(h, 5);
  eq(r2.ok, false); eq(r2.reason, 'dead'); eq(ev.length, 3); eq(h.stats.kills, 1);
  const g = createHealth({ max: 40 });
  const r3 = applyDamage(g, 40); eq(r3.killed, true); eq(r3.overkill, 0); eq(g.dead, true);
  eq(createHealth({ max: 40, hp: 1 }).dead, false);
});

test('health: hibás cél/sebzés elutasítva, nincs változás', () => {
  const h = createHealth();
  eq(applyDamage(null, 5).reason, 'bad-target'); eq(applyDamage({}, 5).reason, 'bad-target');
  eq(applyDamage(h, NaN).reason, 'bad-damage'); eq(applyDamage(h, { amount: 5, type: 'x' }).ok, false);
  eq(h.hp, 100); eq(h.stats.ignored, 2);
  eq(killHealth(null).reason, 'bad-target');
});

test('health: i-frame (invulnerability)', () => {
  const h = createHealth();
  eq(setInvulnerable(h, 0.5), true);
  let r = applyDamage(h, 10); eq(r.reason, 'invuln'); eq(h.hp, 100);
  eq(applyDamage(h, { amount: 10, ignoreInvuln: true }).dealt, 10);
  stepHealth(h, 0.3); near(h.invuln, 0.2); eq(applyDamage(h, 10).ok, false);
  stepHealth(h, 0.3); eq(h.invuln, 0); eq(applyDamage(h, 10).dealt, 10);
  eq(setInvulnerable(h, -1), false); eq(setInvulnerable(h, NaN), false); eq(setInvulnerable(null, 1), false);
  setInvulnerable(h, 999); eq(h.invuln, HEALTH_CONFIG.invulnMax);
  stepHealth(h, NaN); stepHealth(h, -5); eq(h.invuln, HEALTH_CONFIG.invulnMax);
  setInvulnerable(h, 0); eq(h.invuln, 0);
  eq(stepHealth(null, 1), false);
});

test('health: gyógyítás', () => {
  const h = createHealth(); const ev = rec(h);
  applyDamage(h, 60);
  eq(heal(h, 25), 25); eq(h.hp, 65);
  eq(heal(h, 500), 35); eq(h.hp, 100); eq(heal(h, 5), 0);
  eq(heal(h, -3), 0); eq(heal(h, NaN), 0); eq(heal(null, 3), 0);
  eq(ev.filter(e => e.type === 'heal').length, 2); eq(h.stats.healed, 60);
  const d = createHealth(); applyDamage(d, 999);
  eq(heal(d, 50), 0); eq(d.hp, 0); eq(d.dead, true);
});

test('health: újraélesztés', () => {
  const h = createHealth(); const ev = rec(h);
  eq(revive(h), false);
  applyDamage(h, 999); setInvulnerable(h, 2);
  eq(revive(h), true); near(h.hp, 30); eq(h.dead, false); eq(h.invuln, 0);
  eq(ev[ev.length - 1].type, 'revive'); eq(revive(h), false);
  applyDamage(h, 999); revive(h, 0.5); near(h.hp, 50);
  applyDamage(h, 999); revive(h, 7); eq(h.hp, 100);
  applyDamage(h, 999); revive(h, NaN); near(h.hp, 30);
  applyDamage(h, 999); revive(h, -1); near(h.hp, 30);
  eq(revive(null), false);
  eq(applyDamage(h, 10).ok, true);
});

test('health: killHealth', () => {
  const h = createHealth({ resist: { physical: 1 } }); setInvulnerable(h, 5);
  const r = killHealth(h, 'pit'); eq(r.killed, true); eq(h.dead, true); eq(h.hp, 0);
  eq(killHealth(h).reason, 'dead');
});

test('health: max HP módosítás', () => {
  const h = createHealth({ max: 100, hp: 50 });
  eq(setMaxHealth(h, 200), true); eq(h.max, 200); near(h.hp, 100);
  setMaxHealth(h, 80, 'keep'); eq(h.max, 80); eq(h.hp, 80);
  setMaxHealth(h, 120, 'keep'); eq(h.hp, 80);
  applyDamage(h, 30); setMaxHealth(h, 150, 'fill'); eq(h.hp, 150);
  eq(setMaxHealth(h, 0), false); eq(setMaxHealth(h, NaN), false); eq(setMaxHealth(h, -4), false);
  eq(setMaxHealth(null, 10), false); eq(h.max, 150);
  setMaxHealth(h, 1e12); eq(h.max, HEALTH_CONFIG.maxMax);
  const d = createHealth(); applyDamage(d, 999);
  setMaxHealth(d, 300, 'fill'); eq(d.hp, 0); eq(d.dead, true);
  const e = createHealth({ max: 100, hp: 1 }); setMaxHealth(e, 10); assert(e.hp > 0 && e.dead === false);
});

test('health: figyelők (leiratkozás, kivétel nem tör)', () => {
  const h = createHealth(); const got = [];
  const off = onHealth(h, e => got.push(e.type));
  onHealth(h, () => { throw new Error('rossz figyelő'); });
  onHealth(h, e => got.push('b:' + e.type));
  applyDamage(h, 10);
  eq(got.join(','), 'damage,b:damage'); assert(/rossz/.test(h.lastError));
  off(); applyDamage(h, 10);
  eq(got.join(','), 'damage,b:damage,b:damage');
  const noop = onHealth(null, () => {}); noop();
  const noop2 = onHealth(h, 5); noop2();
});

test('health: healthRatio', () => {
  const h = createHealth();
  eq(healthRatio(h), 1); applyDamage(h, 25); near(healthRatio(h), 0.75);
  applyDamage(h, 999); eq(healthRatio(h), 0);
  eq(healthRatio(null), 1); eq(healthRatio({}), 1);
});

test('health: játékos-kötés és HUD (hudModel)', () => {
  const players = [{ index: 0 }, { index: 1 }];
  const hs = createPlayerHealths(players, [{ max: 120 }, { max: 80 }]);
  eq(hs.length, 2); eq(players[0].hpMax, 120); eq(players[1].hp, 80); eq(players[0].dead, false);
  applyDamage(hs[0], 60); applyDamage(hs[1], 999);
  eq(stepPlayerHealths(hs, players, 1 / 60), 2);
  eq(players[0].hp, 60); eq(players[1].hp, 0); eq(players[1].dead, true);
  let m = hudModel(players[0], HUD_CONFIG);
  eq(m.hp, 60); near(m.hpRatio, 0.5);
  m = hudModel(players[1], HUD_CONFIG); eq(m.hp, 0); eq(m.hpRatio, 0);
  const same = createPlayerHealths([{}, {}], { max: 40 }); eq(same[1].max, 40);
  eq(createPlayerHealths(null).length, 0);
  eq(stepPlayerHealths(null, players, 1), 0); eq(stepPlayerHealths(hs, null, 1), 0);
  eq(syncHealthToPlayer(null, hs[0]), false); eq(syncHealthToPlayer({}, {}), false);
});

test('health: mentés-alak és atomi visszaállítás', () => {
  const h = createHealth({ max: 90 }); applyDamage(h, 33);
  const st = healthState(h);
  eq(st.v, 1); eq(st.hp, 57); eq(st.max, 90); eq(st.dead, false);
  const g = createHealth(); const ev = rec(g);
  eq(restoreHealth(g, JSON.parse(JSON.stringify(st))), true);
  eq(g.hp, 57); eq(g.max, 90); eq(ev.length, 0);
  const bad = [null, 5, {}, { ...st, v: 2 }, { ...st, hp: -1 }, { ...st, hp: 91 }, { ...st, max: 0 }, { ...st, max: NaN },
    { ...st, hp: NaN }, { ...st, dead: true }, { ...st, hp: 0, dead: false }, { ...st, dead: 'no' }, { ...st, max: 1e9 }];
  for (const b of bad) { eq(restoreHealth(g, b), false, JSON.stringify(b)); eq(g.hp, 57); eq(g.max, 90); }
  applyDamage(h, 999); const dead = healthState(h); eq(dead.dead, true);
  eq(restoreHealth(g, dead), true); eq(g.dead, true); eq(g.hp, 0);
  eq(healthState(null), null); eq(restoreHealth(null, st), false);
});

test('health: szövegek HU/EN egyeznek', () => {
  const hu = Object.keys(HEALTH_TEXTS.hu).sort(); const en = Object.keys(HEALTH_TEXTS.en).sort();
  eq(hu.join('|'), en.join('|'));
  for (const t of DAMAGE_TYPES) assert(HEALTH_TEXTS.hu['health.type.' + t] && HEALTH_TEXTS.en['health.type.' + t], t);
  for (const k of hu) assert(HEALTH_TEXTS.hu[k].length > 0 && HEALTH_TEXTS.en[k].length > 0);
});

function fuzzRun(seed, n) {
  const rnd = lcg(seed); const h = createHealth({ max: 100, resist: { fire: 0.3, frost: -0.4 } });
  const types = [...DAMAGE_TYPES, 'x', undefined];
  const junk = [NaN, -5, Infinity, null, undefined, '7', {}, [], 1e15];
  let deaths = 0; onHealth(h, e => { if (e.type === 'death') deaths++; });
  let revives = 0;
  for (let i = 0; i < n; i++) {
    const op = Math.floor(rnd() * 8);
    const amt = rnd() < 0.1 ? junk[Math.floor(rnd() * junk.length)] : rnd() * 60;
    if (op <= 2) applyDamage(h, { amount: amt, type: types[Math.floor(rnd() * types.length)], ignoreResist: rnd() < 0.1, ignoreInvuln: rnd() < 0.1 });
    else if (op === 3) heal(h, amt);
    else if (op === 4) { if (revive(h, rnd() < 0.5 ? rnd() : undefined)) revives++; }
    else if (op === 5) setInvulnerable(h, rnd() < 0.2 ? amt : rnd());
    else if (op === 6) stepHealth(h, rnd() < 0.1 ? amt : 1 / 60);
    else setMaxHealth(h, rnd() < 0.2 ? amt : 50 + rnd() * 100, ['ratio', 'fill', 'keep', undefined][Math.floor(rnd() * 4)]);
    assert(Number.isFinite(h.hp) && Number.isFinite(h.max) && Number.isFinite(h.invuln), 'NaN ' + i);
    assert(h.hp >= 0 && h.hp <= h.max, `hp ${h.hp}/${h.max} @${i}`);
    assert(h.dead === (h.hp === 0), `dead/hp @${i}`);
    assert(h.invuln >= 0, 'invuln');
  }
  assert(deaths >= 1 && revives >= 1, 'fuzz lefedés');
  return JSON.stringify([h.hp, h.max, h.dead, h.stats, deaths, revives]);
}

test('health: fuzz 6000 művelet – invariánsok és determinizmus', () => {
  eq(fuzzRun(1, 6000), fuzzRun(1, 6000));
  fuzzRun(2, 6000);
});

test('health: smoke 600 kocka két játékossal (sebzés, gyógyítás, újraélesztés, mentés-kör)', () => {
  const run = () => {
    const rnd = lcg(66); const players = [{ index: 0 }, { index: 1 }];
    const hs = createPlayerHealths(players, [{ max: 100 }, { max: 140, resist: { fire: 0.5 } }]);
    let deathAt = [-1, -1];
    hs.forEach((h, i) => onHealth(h, e => { if (e.type === 'death') deathAt[i] = deathAt[i] < 0 ? frame : deathAt[i]; }));
    let frame = 0;
    for (; frame < 600; frame++) {
      const i = rnd() < 0.5 ? 0 : 1;
      if (frame % 15 === 0) { applyDamage(hs[i], { amount: 5 + rnd() * 40, type: DAMAGE_TYPES[Math.floor(rnd() * 6)] }); setInvulnerable(hs[i], 0.3); }
      if (frame % 40 === 0) heal(hs[1 - i], 20);
      if (frame % 90 === 89) for (const h of hs) revive(h, 0.5);
      stepPlayerHealths(hs, players, 1 / 60);
      for (let k = 0; k < 2; k++) {
        assert(players[k].hp >= 0 && players[k].hp <= players[k].hpMax && Number.isFinite(players[k].hp), 'hp @' + frame);
        assert(players[k].dead === (players[k].hp === 0), 'dead');
      }
    }
    const copy = hs.map(h => { const c = createHealth(); restoreHealth(c, JSON.parse(JSON.stringify(healthState(h)))); return healthState(c); });
    eq(JSON.stringify(copy), JSON.stringify(hs.map(healthState)), 'mentés-kör');
    return JSON.stringify([players.map(p => [p.hp, p.hpMax, p.dead]), deathAt, hs.map(h => h.stats)]);
  };
  eq(run(), run(), 'determinizmus');
});
