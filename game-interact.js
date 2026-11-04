// S016 Interakció-rendszer (tiszta logika, DOM/canvas nélkül; Node-ban tesztelhető).
// Játékosonként: facing (4 irány a bemenetből), interakciós zóna a játékos előtt, a legközelebbi célpont,
// egy gomb (interact) -> 'interact' esemény. A két játékos egymástól függetlenül, akár egyszerre is interakcióba léphet.
// A célpontokat "forrás" (provider) függvények adják: az S017 (warp), S037 (node), S041 (állomás), S091 (NPC) a sajátját köti be.
import { OBJECT_DEFS, objectCollider } from './world-objects.js';

export const INTERACT_CONFIG = {
  reach: 28,         // a zóna mélysége a játékos széle előtt (px)
  width: 40,         // a zóna szélessége (px), a játékos közepére középre igazítva
  pad: 4,            // a célpont-téglalap felfújása az átfedés-vizsgálatnál (px)
  deadzone: 0.25,    // ennél kisebb bemenetre a facing nem változik
  cooldown: 0.2,     // mp két interakció között, játékosonként
  stickiness: 0.75,  // az aktuális célpont távolsága ennyiszeresnek számít (villogás ellen); 1 = ki
  promptGap: 6,      // a prompt távolsága a célpont tetejétől (px; a rajz használja)
  feedbackTime: 0.35, // az interakció visszajelző gyűrűjének élettartama (mp)
  prefilter: 96,     // a tárgy-forrás előszűrő margója a zóna körül (px)
  playerSize: 24,    // tartalék játékos-méret, ha p.w/p.h hiányzik
};
const LIMITS = {
  reach: [1, 256], width: [1, 256], pad: [0, 64], deadzone: [0, 0.95], cooldown: [0, 5], stickiness: [0.05, 1],
  promptGap: [0, 64], feedbackTime: [0.05, 5], prefilter: [16, 512], playerSize: [4, 128],
};
// Interaktív tárgy-típusok: típus -> {action, pad?}. Az S037 (node-ok) 'gather'-re, az S041 állomásokra bővíti.
export const INTERACT_DEFS = { tree: { action: 'examine' }, stone: { action: 'examine' } };
const MAX_FEEDBACK = 16;
const NO_INPUT = { x: 0, y: 0, interact: false };

function num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
function half(v, cfg) { return (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : cfg.playerSize) / 2; }

export function sanitizeInteractConfig(src) {
  const out = {};
  for (const k of Object.keys(INTERACT_CONFIG)) {
    const [lo, hi] = LIMITS[k];
    out[k] = Math.min(hi, Math.max(lo, num(src && src[k], INTERACT_CONFIG[k])));
  }
  return out;
}

// A facing a bemenet domináns tengelye (4 irány); holtsáv alatt marad; azonos tengely-erősségnél (átló) a jelenlegi tengely marad.
export function updateFacing(f, inp, deadzone = INTERACT_CONFIG.deadzone) {
  const x = num(inp && inp.x), y = num(inp && inp.y);
  const ax = Math.abs(x), ay = Math.abs(y);
  if ((ax === 0 && ay === 0) || Math.max(ax, ay) < deadzone) return f;
  const horizontal = Math.abs(ax - ay) < 1e-6 ? f.x !== 0 : ax > ay;
  if (horizontal) { f.x = Math.sign(x); f.y = 0; } else { f.x = 0; f.y = Math.sign(y); }
  return f;
}

// Az interakciós zóna: a játékos széle előtt, a facing irányában (bal-felső sarok + méret).
export function interactZone(p, f, cfg = INTERACT_CONFIG, out = {}) {
  const hw = half(p.w, cfg), hh = half(p.h, cfg);
  if (f.x !== 0) {
    out.w = cfg.reach; out.h = cfg.width;
    out.y = p.y - cfg.width / 2;
    out.x = f.x > 0 ? p.x + hw : p.x - hw - cfg.reach;
  } else {
    out.w = cfg.width; out.h = cfg.reach;
    out.x = p.x - cfg.width / 2;
    out.y = f.y > 0 ? p.y + hh : p.y - hh - cfg.reach;
  }
  return out;
}

function createPlayerState() {
  return { facing: { x: 0, y: 1 }, zone: { x: 0, y: 0, w: 0, h: 0 }, target: null, prev: false, cooldown: 0, count: 0 };
}

export function createInteractSystem(opts = {}) {
  return {
    cfg: sanitizeInteractConfig(opts.cfg),
    defs: Object.assign({}, INTERACT_DEFS, opts.defs),
    providers: Array.isArray(opts.providers) ? opts.providers.slice() : [],
    listeners: [],
    players: [createPlayerState(), createPlayerState()],
    events: [],    // az utolsó lépés eseményei (a tömb újrahasznosul: ne tartsd meg)
    feedback: [],  // a rajz visszajelző gyűrűi: {player,x,y,age}
    buf: [],
    time: 0, total: 0, lastError: null,
  };
}

// Forrás: provider(zone, out, cfg) -> a zóna közelében lévő jelölteket tolja az out-ba:
// {key (egyedi), kind, ref, action, rect{x,y,w,h}, ax, ay (a prompt horgonya, világ-px), pad?}
export function addProvider(sys, fn) {
  if (typeof fn !== 'function') return false;
  sys.providers.push(fn);
  return true;
}

// A világ-objektumok (world-objects.js tár) forrása: csak a sys.defs-ben regisztrált típusok interaktívak.
export function objectProvider(os, defs) {
  return function objectsNearZone(zone, out, cfg) {
    if (!os || !os.chunks || typeof os.chunks.values !== 'function') return out;
    const m = cfg && cfg.prefilter > 0 ? cfg.prefilter : INTERACT_CONFIG.prefilter;
    const x0 = zone.x - m, y0 = zone.y - m, x1 = zone.x + zone.w + m, y1 = zone.y + zone.h + m;
    for (const ch of os.chunks.values()) {
      const list = ch && ch.list;
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (!o || !(o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1)) continue; // NaN is kiesik
        if (!Object.prototype.hasOwnProperty.call(defs, o.type)) continue;
        const def = defs[o.type];
        if (!def) continue;
        const r = objectCollider(o);
        if (!r) continue;
        const spr = (OBJECT_DEFS[o.type] || {}).sprite;
        const sx = spr ? o.x - spr.ax + spr.w / 2 : NaN;
        const sy = spr ? o.y - spr.ay : NaN;
        out.push({
          key: 'obj:' + (o.id !== undefined ? o.id : o.type + '@' + o.x + ',' + o.y),
          kind: 'object', ref: o, action: def.action, pad: def.pad, rect: r,
          ax: Number.isFinite(sx) ? sx : r.x + r.w / 2,
          ay: Number.isFinite(sy) ? sy : r.y,
        });
      }
    }
    return out;
  };
}

export function addObjectSource(sys, os) { return addProvider(sys, objectProvider(os, sys.defs)); }

// Interaktív tárgy-típus felvétele/átírása (def = null: törlés).
export function defineInteractable(sys, type, def) {
  if (typeof type !== 'string' || !type) return false;
  if (def === null) { delete sys.defs[type]; return true; }
  if (!def || typeof def.action !== 'string' || !def.action) return false;
  sys.defs[type] = { action: def.action, pad: def.pad };
  return true;
}

// Esemény-feliratkozás; a visszaadott függvény leválaszt. Az S037+ a 'gather', az S017 az 'enter' akcióra köt.
export function onInteract(sys, fn) {
  if (typeof fn !== 'function') return () => {};
  sys.listeners.push(fn);
  return () => { const i = sys.listeners.indexOf(fn); if (i >= 0) sys.listeners.splice(i, 1); };
}

export function targetOf(sys, i) {
  const ps = sys.players[i];
  return ps ? ps.target : null;
}

function distSq(px, py, r) {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return dx * dx + dy * dy;
}

// A zónába érő jelöltek közül a legközelebbi (a játékos elülső élének közepétől); az eddigi célpont "tapad".
function pickTarget(sys, p, ps, zone) {
  const cfg = sys.cfg, buf = sys.buf;
  buf.length = 0;
  for (let i = 0; i < sys.providers.length; i++) sys.providers[i](zone, buf, cfg);
  const ox = p.x + ps.facing.x * half(p.w, cfg), oy = p.y + ps.facing.y * half(p.h, cfg);
  const prevKey = ps.target ? ps.target.key : null;
  const st2 = cfg.stickiness * cfg.stickiness;
  let best = null, bestD = Infinity;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    const r = c && c.rect;
    if (!r) continue;
    const pad = num(c.pad, cfg.pad);
    // érintés/átfedés a felfújt téglalappal (NaN -> hamis -> kiesik)
    if (!(zone.x < r.x + r.w + pad && r.x - pad < zone.x + zone.w && zone.y < r.y + r.h + pad && r.y - pad < zone.y + zone.h)) continue;
    let d = distSq(ox, oy, r);
    if (c.key === prevKey) d *= st2;
    // döntetlennél az eddigi célpont marad, különben a kisebb kulcs (determinisztikus)
    const better = d < bestD || (d === bestD && best && best.key !== prevKey && (c.key === prevKey || String(c.key) < String(best.key)));
    if (better) { best = c; bestD = d; }
  }
  return best;
}

function fire(sys, i, ps) {
  const t = ps.target, r = t.rect;
  const ev = {
    type: 'interact', player: i, action: t.action, key: t.key, kind: t.kind, target: t.ref,
    x: r.x + r.w / 2, y: r.y + r.h / 2, t: sys.time,
  };
  ps.cooldown = sys.cfg.cooldown;
  ps.count++;
  sys.total++;
  sys.events.push(ev);
  if (sys.feedback.length >= MAX_FEEDBACK) sys.feedback.shift();
  sys.feedback.push({ player: i, x: ev.x, y: ev.y, age: 0 });
  const ls = sys.listeners.slice();
  for (let k = 0; k < ls.length; k++) {
    try { ls[k](ev); } catch (e) {
      sys.lastError = e && e.message ? e.message : String(e);
      if (typeof console !== 'undefined') console.error(e);
    }
  }
}

function tickFeedback(sys, dt) {
  const fb = sys.feedback;
  let w = 0;
  for (let i = 0; i < fb.length; i++) {
    const f = fb[i];
    f.age += dt;
    if (f.age < sys.cfg.feedbackTime) fb[w++] = f;
  }
  fb.length = w;
}

// Egy logikai lépés: facing, zóna, célpont, interakció. inputs[i] = {x,y,interact,interactPressed?}.
// Az interakciót az interact lenyomásának éle (vagy az interactPressed) váltja ki, cooldown-nal; visszaadja a lépés eseményeit.
export function stepInteraction(sys, players, inputs, dt) {
  const step = num(dt) > 0 ? dt : 0;
  sys.events.length = 0;
  sys.time += step;
  tickFeedback(sys, step);
  const list = Array.isArray(players) ? players : [];
  for (let i = 0; i < list.length; i++) {
    const ps = sys.players[i] || (sys.players[i] = createPlayerState());
    const p = list[i];
    const inp = (inputs && inputs[i]) || NO_INPUT;
    const down = !!inp.interact;
    const pressed = inp.interactPressed === true || (down && !ps.prev);
    ps.prev = down;
    ps.cooldown = Math.max(0, ps.cooldown - step);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) { ps.target = null; continue; }
    updateFacing(ps.facing, inp, sys.cfg.deadzone);
    interactZone(p, ps.facing, sys.cfg, ps.zone);
    ps.target = pickTarget(sys, p, ps, ps.zone);
    if (pressed && ps.target && ps.cooldown <= 0) fire(sys, i, ps);
  }
  return sys.events;
}
