// game-invui.js (S035) – az inventory UI logikája: kurzor, kijelölés, áthelyezés/összevonás/csere, stack-felezés.
// Tiszta logika (nincs DOM/canvas); a rajz: render-invui.js. Játékosonként külön kurzor és kijelölés; a menü nyitva-állapotát a game-hud adja.
// Bemenet: a NYERS játékos-bemenet (a stepMenus szűrt bemenete nyitva nullázott). Nyitva a karakter áll (stepMenus), a pórázon húzható.
import { menuOpen } from './game-hud.js';
import { moveSlot, splitStack } from './game-inventory.js';
import { getItemDef } from './data-items.js';

export const INVUI_CONFIG = Object.freeze({
  cols: 6,           // slot-oszlopok száma a rácson
  visibleRows: 4,    // egyszerre látható sor (több slotnál görgetés a kurzor körül)
  deadzone: 0.5,     // a tengely-érték, ami fölött irányt jelent
  repeatDelay: 0.3,  // tartott irány: az első ismétlésig (mp)
  repeatRate: 0.1,   // utána ismétlési időköz (mp)
});

export const INVUI_TEXTS = {
  hu: {
    title: 'Hátizsák', weight: '{kg} / {cap} kg', empty: 'Üres', slot: '{name} ×{n} · {kg} kg',
    held: 'Fogva: {name} ×{n}', hint1: 'Fogás/lerakás: interakció', hint2: 'Fél: 1. képesség · Mégse: 2. képesség',
  },
  en: {
    title: 'Backpack', weight: '{kg} / {cap} kg', empty: 'Empty', slot: '{name} ×{n} · {kg} kg',
    held: 'Held: {name} ×{n}', hint1: 'Pick/place: interact', hint2: 'Half: ability 1 · Cancel: ability 2',
  },
};

const fin = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const slotsOf = inv => (inv && Array.isArray(inv.slots) ? inv.slots : null);

/** {cols, rows} az inventory rácsához (hibás inventory -> 0 sor). */
export function gridDims(inv, cfg = INVUI_CONFIG) {
  const s = slotsOf(inv);
  return { cols: cfg.cols, rows: s ? Math.ceil(s.length / cfg.cols) : 0 };
}

/** A látható sávok első sora (állapotmentes): a kurzor sora körül, a rács szélére szorítva. */
export function scrollTop(cursor, rows, cfg = INVUI_CONFIG) {
  if (!Number.isInteger(cursor) || !Number.isInteger(rows) || rows <= cfg.visibleRows) return 0;
  const row = Math.floor(Math.max(0, cursor) / cfg.cols);
  return clamp(row - Math.floor(cfg.visibleRows / 2), 0, rows - cfg.visibleRows);
}

/** Tárgy-szín (placeholder ikon): az id-ból determinisztikus 'hsl(...)'; a valódi ikonok az S103-ban jönnek. */
export function itemColor(id) {
  let h = 2166136261;
  const s = typeof id === 'string' ? id : '';
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `hsl(${h % 360},55%,52%)`;
}

/** Egy slot megjelenítési adata: {index,id,n,nameKey,unitKg,totalKg,value,tags}; üres/hibás slot -> null. */
export function slotView(inv, i) {
  const s = slotsOf(inv);
  if (!s || !Number.isInteger(i) || i < 0 || i >= s.length || !s[i]) return null;
  const e = s[i], d = getItemDef(inv.reg, e.id);
  return {
    index: i, id: e.id, n: e.n, nameKey: d ? d.nameKey : 'item.' + e.id,
    unitKg: d ? d.weight : 0, totalKg: d ? d.weight * e.n : 0, value: d ? d.value : 0, tags: d ? d.tags : [],
  };
}

/** Irány a nyers tengelyekből: {dx,dy} (a nagyobb abszolút értékű tengely számít; holtsáv alatt 0). */
export function dirOf(x, y, deadzone = INVUI_CONFIG.deadzone) {
  const ax = fin(x) ? x : 0, ay = fin(y) ? y : 0;
  if (Math.max(Math.abs(ax), Math.abs(ay)) < deadzone) return { dx: 0, dy: 0 };
  return Math.abs(ax) > Math.abs(ay) ? { dx: Math.sign(ax), dy: 0 } : { dx: 0, dy: Math.sign(ay) };
}

export function createInvUi() {
  const one = () => ({ cursor: 0, mark: -1, wasOpen: false, dx: 0, dy: 0, t: 0, armed: true });
  return { players: [one(), one()], moves: 0, actions: 0 };
}

/** A kurzor mozgatása (nincs körbefordulás; a hiányos utolsó sor üres részére nem lép). -> változott-e. */
export function moveCursor(ps, inv, dx, dy, cfg = INVUI_CONFIG) {
  const s = slotsOf(inv);
  if (!s || s.length === 0) return false;
  const col = (ps.cursor % cfg.cols) + dx, row = Math.floor(ps.cursor / cfg.cols) + dy;
  if (col < 0 || col >= cfg.cols || row < 0) return false;
  const next = row * cfg.cols + col;
  if (next >= s.length) return false;
  ps.cursor = next;
  return true;
}

function direction(ps, raw, inv, dt, cfg, ev, i) {
  const d = dirOf(raw.x, raw.y, cfg.deadzone);
  if (d.dx === 0 && d.dy === 0) { ps.dx = 0; ps.dy = 0; ps.t = 0; ps.armed = true; return false; }
  if (!ps.armed) return false;              // a megnyitáskor tartott irányt addig nem veszi figyelembe, amíg el nem engedik
  let fire = false;
  if (d.dx !== ps.dx || d.dy !== ps.dy) { ps.dx = d.dx; ps.dy = d.dy; ps.t = cfg.repeatDelay; fire = true; }
  else {
    ps.t -= posDt(dt);
    if (ps.t <= 0) { ps.t += cfg.repeatRate; if (ps.t <= 0) ps.t = cfg.repeatRate; fire = true; }
  }
  if (fire && moveCursor(ps, inv, d.dx, d.dy, cfg)) { ev.push({ type: 'cursor', player: i, to: ps.cursor }); return true; }
  return false;
}
const posDt = dt => (fin(dt) && dt > 0 ? dt : 0);

function act(ps, inv, raw, ev, i) {
  const s = slotsOf(inv);
  const at = ps.cursor;
  const markNow = () => {
    if (s[at]) { ps.mark = at; ev.push({ type: 'mark', player: i, from: at }); }
  };
  if (raw.ability2Pressed === true && ps.mark >= 0) { ps.mark = -1; ev.push({ type: 'cancel', player: i }); }
  if (raw.interactPressed === true) {
    if (ps.mark < 0) markNow();
    else if (ps.mark === at) { ps.mark = -1; ev.push({ type: 'unmark', player: i, from: at }); }
    else {
      const from = ps.mark;
      if (moveSlot(inv, from, at)) { ps.mark = -1; ev.push({ type: 'move', player: i, from, to: at }); }
      else ev.push({ type: 'blocked', player: i, from, to: at });
    }
  }
  if (raw.ability1Pressed === true) {
    if (ps.mark < 0) markNow();
    else if (ps.mark !== at && s[at] === null && s[ps.mark] && s[ps.mark].n > 1) {
      const from = ps.mark;
      if (splitStack(inv, from, at, Math.floor(s[from].n / 2))) { ps.mark = -1; ev.push({ type: 'split', player: i, from, to: at }); }
      else ev.push({ type: 'blocked', player: i, from, to: at });
    } else ev.push({ type: 'blocked', player: i, from: ps.mark, to: at });
  }
}

/**
 * Egy lépés mindkét játékosra: a menü nyitva-állapota a `menus`-ból (a stepMenus UTÁN hívandó), a bemenet a NYERS (szűretlen) tömb.
 * Zárt menünél a kurzor megmarad, a kijelölés törlődik. A megnyitás kockájában nincs művelet. Sosem dob. -> az események tömbje.
 */
export function stepInvUi(ui, menus, raws, inventories, dt, cfg = INVUI_CONFIG) {
  const ev = [];
  if (!ui || !Array.isArray(ui.players)) return ev;
  for (let i = 0; i < 2; i++) {
    const ps = ui.players[i];
    if (!ps) continue;
    const open = menuOpen(menus, i);
    const raw = raws && raws[i] && typeof raws[i] === 'object' ? raws[i] : {};
    const inv = Array.isArray(inventories) ? inventories[i] : null;
    const s = slotsOf(inv);
    if (!open) { ps.wasOpen = false; ps.mark = -1; ps.dx = 0; ps.dy = 0; ps.t = 0; continue; }
    if (!s || s.length === 0) { ps.wasOpen = true; continue; }
    ps.cursor = clamp(Number.isInteger(ps.cursor) ? ps.cursor : 0, 0, s.length - 1);
    if (ps.mark >= s.length || (ps.mark >= 0 && !s[ps.mark])) ps.mark = -1; // a kijelölt tárgy eltűnt (betöltés, trade)
    if (!ps.wasOpen) { // megnyitás: a tartott irány nem fut, a gombok ebben a kockában nem hatnak
      ps.wasOpen = true;
      const d = dirOf(raw.x, raw.y, cfg.deadzone);
      ps.dx = 0; ps.dy = 0; ps.t = 0; ps.armed = d.dx === 0 && d.dy === 0;
      continue;
    }
    if (direction(ps, raw, inv, dt, cfg, ev, i)) ui.moves++;
    const before = ev.length;
    act(ps, inv, raw, ev, i);
    ui.actions += ev.length - before;
  }
  return ev;
}
