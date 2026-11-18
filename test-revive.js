// Halál és újraélesztés tesztjei (S070). Importja: test-index.js, game-revive.js, game-health.js, game-wallet.js
import { test, assert, eq, near } from './test-index.js';
import {
  REVIVE_CONFIG, REVIVE_TEXTS, sanitizeReviveConfig, createRevive, onRevive, setCheckpoint, isDowned,
  reviveGate, stepRevive, reviveView,
} from './game-revive.js';
import { createPlayerHealths, stepPlayerHealths, applyDamage, killHealth, heal, revive as healthRevive } from './game-health.js';
import { createPlayerWallets, deposit, balance } from './game-wallet.js';
import { createPlayer } from './game-player.js';

function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const IDLE = () => ({ x: 0, y: 0, interact: false, ability1: false, ability2: false, menu: false, interactPressed: false, ability1Pressed: false, ability2Pressed: false, menuPressed: false });
const HOLD = () => ({ ...IDLE(), interact: true });

function rig(opts = {}) {
  const players = [createPlayer(0, 1000, 1000), createPlayer(1, 1000 + (opts.gap ?? 30), 1000)];
  const healths = createPlayerHealths(players);
  const wallets = createPlayerWallets();
  const rv = createRevive({ checkpoint: { id: 'cp', x: 5000, y: 6000 }, cfg: opts.cfg });
  const events = [];
  onRevive(rv, e => events.push(e));
  const ctx = { players, healths, wallets, inputs: [IDLE(), IDLE()] };
  const tick = (n = 1, dt = 1 / 60) => { for (let k = 0; k < n; k++) { stepRevive(rv, ctx, dt); stepPlayerHealths(healths, players, dt); } };
  return { players, healths, wallets, rv, events, ctx, tick };
}

test('revive: konfig, szövegek, hibás bemenet', () => {
  const c = sanitizeReviveConfig({ window: 9999, reviveTime: -1, range: NaN, ratio: 'x', penaltyCoins: 5 });
  eq(c.window, 600); eq(c.reviveTime, 0.1); eq(c.range, REVIVE_CONFIG.range); eq(c.ratio, REVIVE_CONFIG.ratio); eq(c.penaltyCoins, 1);
  assert(Object.isFrozen(c));
  eq(sanitizeReviveConfig(null).window, 30);
  for (const l of ['hu', 'en']) for (const k of ['revive.hold', 'revive.wipe']) assert(typeof REVIVE_TEXTS[l][k] === 'string' && REVIVE_TEXTS[l][k].length > 0, k);
  eq(Object.keys(REVIVE_TEXTS.hu).join(), Object.keys(REVIVE_TEXTS.en).join());
  const rv = createRevive({ checkpoint: { x: NaN, y: 1 } });
  eq(rv.checkpoint.x, 0);
  eq(setCheckpoint(rv, 'a', NaN, 1), false); eq(setCheckpoint(rv, 'a', 3, 4), true); eq(rv.checkpoint.y, 4);
  eq(setCheckpoint(null, 'a', 1, 1), false);
  eq(stepRevive(null, {}, 0.1).length, 0);
  eq(stepRevive(rv, null, 0.1).length, 0);
  eq(stepRevive(rv, { players: [], healths: [] }, NaN).length, 0);
  eq(isDowned(null, 0), false);
  eq(reviveView(null, 0).downed, false);
});

test('revive: az elesés nem game over; a társ él, az elesett állapot jelzett', () => {
  const r = rig();
  r.tick(5);
  eq(isDowned(r.rv, 0), false);
  killHealth(r.healths[0]);
  r.tick();
  eq(isDowned(r.rv, 0), true); eq(isDowned(r.rv, 1), false);
  eq(r.events.filter(e => e.type === 'down').length, 1);
  eq(r.events[0].player, 0);
  near(reviveView(r.rv, 0).secs, REVIVE_CONFIG.window, 0.1);
  eq(r.rv.stats.downs, 1);
  r.tick(30);
  eq(r.events.filter(e => e.type === 'down').length, 1, 'nincs dupla esemény');
  eq(r.healths[1].dead, false);
});

test('revive: a társ tartott gombbal újraéleszti (idő, HP, i-frame)', () => {
  const r = rig();
  killHealth(r.healths[0]); r.tick();
  r.ctx.inputs = [IDLE(), HOLD()];
  r.tick(60);
  near(reviveView(r.rv, 0).progress, 1 / REVIVE_CONFIG.reviveTime, 0.02);
  eq(reviveView(r.rv, 0).by, 1);
  eq(isDowned(r.rv, 0), true);
  r.tick(120);
  eq(isDowned(r.rv, 0), false);
  eq(r.healths[0].dead, false);
  near(r.healths[0].hp, r.healths[0].max * REVIVE_CONFIG.ratio, 1e-6);
  assert(r.healths[0].invuln > 0);
  eq(applyDamage(r.healths[0], 50).reason, 'invuln');
  assert(r.events.some(e => e.type === 'revive' && e.player === 0 && e.by === 1));
  eq(r.players[0].dead, false);
  eq(r.rv.stats.revives, 1);
});

test('revive: hatótávon kívül / gomb nélkül nincs haladás, elengedve fogy', () => {
  let r = rig({ gap: 300 });
  killHealth(r.healths[0]); r.tick();
  r.ctx.inputs = [IDLE(), HOLD()];
  r.tick(120);
  eq(reviveView(r.rv, 0).progress, 0);
  r = rig();
  killHealth(r.healths[0]); r.tick();
  r.ctx.inputs = [IDLE(), IDLE()];
  r.tick(120);
  eq(reviveView(r.rv, 0).progress, 0);
  r.ctx.inputs = [IDLE(), HOLD()]; r.tick(90);
  const p1 = reviveView(r.rv, 0).progress;
  assert(p1 > 0.3);
  r.ctx.inputs = [IDLE(), IDLE()]; r.tick(30);
  assert(reviveView(r.rv, 0).progress < p1);
  r.tick(600);
  eq(reviveView(r.rv, 0).progress, 0);
  // a halott nem élesztheti a halottat, az elesett saját gombja semmit nem ad
  r = rig();
  killHealth(r.healths[0]); r.tick();
  r.ctx.inputs = [HOLD(), IDLE()]; r.tick(300);
  eq(isDowned(r.rv, 0), true);
});

test('revive: élesztés közben a számláló áll; gombbal nem megy el az idő', () => {
  const r = rig({ cfg: { window: 5, reviveTime: 4 } });
  killHealth(r.healths[0]); r.tick();
  r.tick(120);
  near(reviveView(r.rv, 0).secs, 3, 0.05);
  r.ctx.inputs = [IDLE(), HOLD()];
  r.tick(120);
  near(reviveView(r.rv, 0).secs, 3, 0.05);
  r.ctx.inputs = [IDLE(), IDLE()];
  r.tick(60 * 10);
  eq(r.rv.stats.wipes, 1, 'az idő lejárt');
});

test('revive: lejárt idő -> visszatérés a ponthoz, büntetés, mindkét játékos', () => {
  const r = rig({ gap: 400, cfg: { window: 3 } });
  deposit(r.wallets[0], 100); deposit(r.wallets[1], 55);
  r.players[1].vx = 90; r.players[1].kbx = 50;
  killHealth(r.healths[0]); r.tick();
  r.tick(60 * 3 + 5);
  const w = r.events.find(e => e.type === 'wipe');
  assert(w, 'wipe esemény'); eq(w.reason, 'timeout'); eq(w.checkpoint, 'cp');
  eq(r.players[0].x, 5000 - REVIVE_CONFIG.spread); eq(r.players[1].x, 5000 + REVIVE_CONFIG.spread);
  eq(r.players[0].y, 6000); eq(r.players[1].y, 6000);
  eq(r.players[1].vx, 0); eq(r.players[1].kbx, 0);
  eq(balance(r.wallets[0]), 90); eq(balance(r.wallets[1]), 50);
  eq(w.lost[0], 10); eq(w.lost[1], 5);
  eq(r.healths[0].dead, false);
  near(r.healths[0].hp, r.healths[0].max * REVIVE_CONFIG.ratio, 1e-6);
  eq(r.healths[1].hp, r.healths[1].max, 'az élő társ HP-ja érintetlen');
  assert(r.healths[0].invuln > 0 && r.healths[1].invuln > 0);
  eq(isDowned(r.rv, 0), false);
  eq(r.rv.stats.timeouts, 1);
});

test('revive: mindketten elesnek -> késleltetve visszatérés; közben nincs élesztés', () => {
  const r = rig();
  deposit(r.wallets[0], 1000);
  killHealth(r.healths[0]); killHealth(r.healths[1]);
  r.ctx.inputs = [HOLD(), HOLD()];
  r.tick(60);
  eq(r.rv.stats.wipes, 0, 'a késleltetés alatt még nincs');
  eq(reviveView(r.rv, 0).wipeIn !== null, true);
  r.tick(70);
  const w = r.events.find(e => e.type === 'wipe');
  assert(w); eq(w.reason, 'all');
  eq(balance(r.wallets[0]), 900);
  eq(r.healths[0].dead, false); eq(r.healths[1].dead, false);
  eq(r.players[0].x, 5000 - REVIVE_CONFIG.spread);
  eq(reviveView(r.rv, 0).wipeIn, null);
  // a pénz sosem megy negatívba, a nulla pénz nem hiba
  eq(balance(r.wallets[1]), 0);
  eq(w.lost[1], 0);
});

test('revive: a bemenet-kapu (elesett üres, élesztő gombja elnyelve, másolat)', () => {
  const r = rig();
  killHealth(r.healths[0]); r.tick();
  const raw = [{ ...HOLD(), x: 1, y: -1, ability1: true }, { ...HOLD(), x: 0.5 }];
  const g = reviveGate(r.rv, raw, r.players);
  eq(g[0].x, 0); eq(g[0].y, 0); eq(g[0].interact, false); eq(g[0].ability1, false);
  eq(g[1].interact, false); eq(g[1].interactPressed, false); eq(g[1].x, 0.5, 'a mozgás megmarad');
  eq(raw[0].x, 1); eq(raw[1].interact, true, 'az eredeti érintetlen');
  r.players[1].x = 3000; // távol: az élő társ gombja nincs elnyelve
  const g2 = reviveGate(r.rv, raw, r.players);
  eq(g2[1].interact, true);
  // senki nem elesett: ugyanaz az értékű bemenet
  const r2 = rig();
  const g3 = reviveGate(r2.rv, raw, r2.players);
  eq(g3[0].x, 1); eq(g3[1].interact, true);
  eq(reviveGate(null, raw, r.players), raw);
  eq(reviveGate(r.rv, null, r.players), null);
});

test('revive: speed hook gyorsít, hibás hook nem dob; külső élesztés reseteli', () => {
  let r = rig();
  killHealth(r.healths[0]); r.tick();
  r.ctx.inputs = [IDLE(), HOLD()]; r.ctx.speed = j => (j === 1 ? 2 : 1);
  r.tick(80);
  eq(isDowned(r.rv, 0), false, '2x gyorsan 1,25 mp alatt kész');
  r = rig();
  killHealth(r.healths[0]); r.tick();
  r.ctx.inputs = [IDLE(), HOLD()]; r.ctx.speed = () => { throw new Error('x'); };
  r.tick(200);
  eq(isDowned(r.rv, 0), false); assert(r.rv.lastError);
  r = rig();
  killHealth(r.healths[0]); r.tick();
  healthRevive(r.healths[0], 0.5); r.tick();
  eq(isDowned(r.rv, 0), false);
  assert(r.events.some(e => e.type === 'revive' && e.by === -1));
});

test('revive: figyelők, hibás healths/players, halott gyógyítása nem él', () => {
  const r = rig();
  const bad = onRevive(r.rv, () => { throw new Error('boom'); });
  killHealth(r.healths[0]);
  r.tick();
  assert(r.rv.lastError); eq(isDowned(r.rv, 0), true);
  bad();
  eq(heal(r.healths[0], 50), 0);
  r.ctx.healths = [null, undefined];
  eq(stepRevive(r.rv, r.ctx, 0.016).length, 0);
  r.ctx.healths = r.healths; r.ctx.players = [null, { x: NaN, y: 0 }];
  r.ctx.inputs = [IDLE(), HOLD()];
  stepRevive(r.rv, r.ctx, 0.016);
  eq(reviveView(r.rv, 0).progress, 0, 'hibás pozíció: nincs élesztés');
  eq(onRevive(null, () => {}).constructor, Function);
});

function run(seed, frames) {
  const rnd = lcg(seed), r = rig({ gap: 40, cfg: { window: 6, wipeDelay: 1 } });
  deposit(r.wallets[0], 500); deposit(r.wallets[1], 500);
  const log = [];
  for (let f = 0; f < frames; f++) {
    if (rnd() < 0.02) { const i = rnd() < 0.5 ? 0 : 1; applyDamage(r.healths[i], { amount: rnd() * 120 }); }
    if (rnd() < 0.01) r.players[1].x += (rnd() - 0.5) * 300;
    if (rnd() < 0.01) { r.players[1].x = r.players[0].x + 20; }
    r.ctx.inputs = [rnd() < 0.5 ? HOLD() : IDLE(), rnd() < 0.7 ? HOLD() : IDLE()];
    const g = reviveGate(r.rv, r.ctx.inputs, r.players);
    for (let i = 0; i < 2; i++) if (isDowned(r.rv, i)) { assert(g[i].interact === false && g[i].x === 0); }
    r.tick();
    for (let i = 0; i < 2; i++) {
      const s = r.rv.slots[i];
      assert(Number.isFinite(s.t) && Number.isFinite(s.progress) && s.progress >= 0 && s.progress <= 1, 'slot');
      assert(Number.isFinite(r.players[i].x) && Number.isFinite(r.players[i].y), 'NaN pozíció');
      assert(r.healths[i].hp >= 0 && r.healths[i].hp <= r.healths[i].max, 'hp');
      assert(balance(r.wallets[i]) >= 0, 'pénz');
      eq(isDowned(r.rv, i), r.healths[i].dead, 'a down állapot = a Health.dead (kocka-vég)');
    }
    log.push(r.healths[0].hp.toFixed(3) + '|' + r.healths[1].hp.toFixed(3) + '|' + r.players[0].x.toFixed(2));
  }
  return { log: log.join(';'), stats: { ...r.rv.stats } };
}

test('revive: 6000 kockás fuzz, invariánsok + determinizmus', () => {
  const a = run(70, 6000), b = run(70, 6000);
  eq(a.log, b.log); eq(JSON.stringify(a.stats), JSON.stringify(b.stats));
  assert(a.stats.downs > 5, 'volt elesés'); assert(a.stats.revives > 0 || a.stats.wipes > 0, 'volt élesztés vagy visszatérés');
  eq(run(71, 3000).stats.downs > 0, true);
});
