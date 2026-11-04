// S017 Warp-zsebek (tiszta logika, DOM/canvas nélkül; Node-ban tesztelhető).
// A beltér a térképen kívüli "zsebben" van, ugyanabban a világban: a zseb a világ-koordináták távoli részén áll
// (WARP_CONFIG.origin*), a chunk-streaming oda nem tölt (a zsebben lévő játékos helyett a kinti kilépési pont számít).
// A belépés/kilépés PÁROS: az egyik játékos kezdeményezi (interakció), a pár együtt lép át (a póráz így sosem szakad).
// Az egyik bent / másik kint (osztott képernyő) az S023-S030 után jön. Bent a póráz ugyanúgy él: a zseb falai a
// közös fal-listában vannak (warpColliders). Az adat: data-warps.js.
import { POCKET_TYPES, WARP_LINKS } from './data-warps.js';

export const WARP_CONFIG = {
  originX: 1048576,   // az 0. zseb bal-felső sarka (világ-px); távol a chunk-világtól
  originY: 1048576,
  stride: 1024,       // a zsebek x-távolsága slotonként (>= padló + 2 fal)
  tile: 32,
  wall: 32,           // a zseb körüli fal vastagsága (px)
  cooldown: 0.5,      // mp: két átlépés között (a gomb-pergés ellen)
  pairGap: 48,        // a pár érkezési távolsága (px, középpontok)
  prefilter: 96,      // az interakció-előszűrő margója (px)
};

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const rect = (x, y, w, h) => ({ x, y, w, h });
const okRect = r => !!r && Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h) && r.w > 0 && r.h > 0;
const inside = (o, r) => o.x >= r.x && o.y >= r.y && o.x + o.w <= r.x + r.w && o.y + o.h <= r.y + r.h;
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const isPoint = p => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

function relRect(anchor, r) {
  if (!r) return null;
  const o = rect(anchor.x + num(r.dx, NaN), anchor.y + num(r.dy, NaN), num(r.w, NaN), num(r.h, NaN));
  return okRect(o) ? o : null;
}

/** Egy link feloldása abszolút geometriára; hibás adat -> null. */
export function resolveLink(link, anchor, types = POCKET_TYPES, cfg = WARP_CONFIG) {
  if (!link || typeof link.id !== 'string' || !link.id || !isPoint(anchor)) return null;
  const t = types && Object.prototype.hasOwnProperty.call(types, link.pocket) ? types[link.pocket] : null;
  if (!t || !Number.isInteger(t.w) || !Number.isInteger(t.h) || t.w < 3 || t.h < 3) return null;
  if (!Number.isInteger(link.slot) || link.slot < 0) return null;
  const T = cfg.tile, W = cfg.wall;
  const fw = t.w * T, fh = t.h * T;
  if (fw + 2 * W > cfg.stride) return null;
  const house = relRect(anchor, link.house), door = relRect(anchor, link.door);
  if (!house || !door) return null;
  const ox = cfg.originX + link.slot * cfg.stride, oy = cfg.originY;
  const floor = rect(ox, oy, fw, fh);
  const e = t.exit;
  if (!e || ![e.tx, e.ty, e.tw, e.th].every(Number.isFinite)) return null;
  const exit = rect(ox + e.tx * T, oy + e.ty * T, e.tw * T, e.th * T);
  if (!okRect(exit) || !inside(exit, floor)) return null;
  if (!t.enter || !Number.isFinite(t.enter.x) || !Number.isFinite(t.enter.y)) return null;
  const enter = { x: ox + t.enter.x * T, y: oy + t.enter.y * T };
  const half = cfg.pairGap / 2 + 12;
  if (!inside(rect(enter.x - half, enter.y - 12, 2 * half, 24), floor)) return null;
  const props = [];
  for (const p of t.props || []) {
    if (!p || ![p.tx, p.ty, p.tw, p.th].every(Number.isFinite)) return null;
    const r = rect(ox + p.tx * T, oy + p.ty * T, p.tw * T, p.th * T);
    if (!okRect(r) || !inside(r, floor)) return null;
    props.push({ kind: String(p.kind), solid: !!p.solid, ...r });
  }
  const walls = [
    rect(ox - W, oy - W, fw + 2 * W, W), rect(ox - W, oy + fh, fw + 2 * W, W),
    rect(ox - W, oy, W, fh), rect(ox + fw, oy, W, fh),
  ];
  const out = { x: anchor.x + num(link.out && link.out.dx), y: anchor.y + num(link.out && link.out.dy) };
  return {
    id: link.id, nameKey: link.nameKey || 'warp.' + link.id, pocket: link.pocket, slot: link.slot,
    house, door, floor, bounds: rect(ox - W, oy - W, fw + 2 * W, fh + 2 * W), walls, props, exit, enter, out,
    doorRef: { id: link.id, role: 'door' }, exitRef: { id: link.id, role: 'exit' },
  };
}

/** Warp-rendszer: anchor = a kezdőhely (a kinti pozíciók ehhez képest), links/types adat, cfg felülírható. */
export function createWarpSystem(opts = {}) {
  const cfg = { ...WARP_CONFIG, ...(opts.cfg || {}) };
  const anchor = opts.anchor;
  const ws = { cfg, anchor, links: [], byId: new Map(), rejected: [], cool: 0, count: 0, last: null, version: 1 };
  const slots = new Set();
  for (const l of opts.links || WARP_LINKS) {
    const r = resolveLink(l, anchor, opts.types || POCKET_TYPES, cfg);
    if (!r || ws.byId.has(r.id) || slots.has(r.slot)) { ws.rejected.push(l && l.id); continue; }
    slots.add(r.slot); ws.byId.set(r.id, r); ws.links.push(r);
  }
  return ws;
}

/** Melyik zsebben van a pont (a falakkal együtt)? -> link | null */
export function pocketOf(ws, x, y) {
  if (!ws || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (const L of ws.links) {
    const b = L.bounds;
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return L;
  }
  return null;
}

/** A link azonosítója, ha MINDKÉT játékos ugyanabban a zsebben van; különben null. */
export function warpWhere(ws, players) {
  if (!Array.isArray(players) || players.length < 2) return null;
  const a = pocketOf(ws, players[0].x, players[0].y), b = pocketOf(ws, players[1].x, players[1].y);
  return a && b && a === b ? a.id : null;
}

/** Ütközők: kinti házak, zseb-falak, ütköző tárgyak (a közös fal-listába; statikus). */
export function warpColliders(ws, out = []) {
  if (!ws) return out;
  for (const L of ws.links) {
    out.push(L.house);
    for (const w of L.walls) out.push(w);
    for (const p of L.props) if (p.solid) out.push(rect(p.x, p.y, p.w, p.h));
  }
  return out;
}

function near(z, r, m) { return z.x < r.x + r.w + m && r.x - m < z.x + z.w && z.y < r.y + r.h + m && r.y - m < z.y + z.h; }
function candidate(L, role) {
  const r = role === 'door' ? L.door : L.exit;
  return {
    key: 'warp:' + L.id + ':' + role, kind: 'warp', ref: role === 'door' ? L.doorRef : L.exitRef,
    action: role === 'door' ? 'enter' : 'exit', rect: r, ax: r.x + r.w / 2, ay: r.y,
  };
}

/** Interakció-forrás: a kinti ajtó ('enter') és a bent lévő kijárat ('exit'). addProvider(sys, warpProvider(ws)). */
export function warpProvider(ws) {
  return function warpTargets(zone, out, cfg) {
    if (!ws || !zone) return out;
    const m = cfg && cfg.prefilter > 0 ? cfg.prefilter : ws.cfg.prefilter;
    for (const L of ws.links) {
      if (near(zone, L.door, m)) out.push(candidate(L, 'door'));
      if (near(zone, L.exit, m)) out.push(candidate(L, 'exit'));
    }
    return out;
  };
}

function placePair(players, x, y, gap) {
  const xs = [x - gap / 2, x + gap / 2];
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    if (!p) continue;
    p.x = xs[i]; p.y = y; p.vx = 0; p.vy = 0;
  }
}

/**
 * Az 'interact' esemény feldolgozása (ev.kind === 'warp'): a pár átlép. -> {type:'enter'|'exit', id, player, link} | null
 * (cooldown alatt, hibás/ismeretlen célpontnál, hibás játékos-pozíciónál nincs átlépés).
 */
export function handleWarpEvent(ws, players, ev) {
  if (!ws || !ev || ev.kind !== 'warp' || !ev.target || ws.cool > 0) return null;
  const L = ws.byId.get(ev.target.id);
  if (!L || !Array.isArray(players) || players.length < 2 || !isPoint(players[0]) || !isPoint(players[1])) return null;
  let type;
  if (ev.target.role === 'door') { placePair(players, L.enter.x, L.enter.y, ws.cfg.pairGap); type = 'enter'; }
  else if (ev.target.role === 'exit') { placePair(players, L.out.x, L.out.y, ws.cfg.pairGap); type = 'exit'; }
  else return null;
  ws.cool = ws.cfg.cooldown;
  ws.count++;
  ws.last = { type, id: L.id, player: ev.player, link: L };
  return ws.last;
}

/** Logikai lépés: a cooldown fogy. */
export function stepWarp(ws, dt) {
  if (ws && num(dt) > 0) ws.cool = Math.max(0, ws.cool - dt);
}

/** A chunk-streaming pontjai: a zsebben lévő játékos helyett a kinti kilépési pont (a ház előtti chunkok betöltve maradnak). */
export function streamPoints(ws, players, out = []) {
  out.length = 0;
  for (const p of players || []) {
    const L = ws ? pocketOf(ws, p && p.x, p && p.y) : null;
    out.push(L ? { x: L.out.x, y: L.out.y } : p);
  }
  return out;
}
