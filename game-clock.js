// S018: GameClock — játékidő, nap/fázis, esemény-hookok, mentésbarát állapot.
// Tiszta logika (nincs DOM/canvas); a színezés és a felirat a render-daynight.js-ben van.
export const DAY_MIN = 1440;                       // játékperc / játéknap
export const CLOCK_STATE_V = 1;                    // a mentett állapot verziója (S032 migrációs hook)
export const CLOCK_DEFAULTS = { dayLength: 1200, startHour: 8, speed: 1 }; // dayLength: valós mp / játéknap
export const CLOCK_LIMITS = { dayLength: [30, 86400], startHour: [0, 23.99], speed: [0, 1024] };
export const CLOCK_SPEEDS = [0, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128]; // futásidejű létra (0 = áll)
export const MAX_ADVANCE = DAY_MIN * 14;           // egy lépésben legfeljebb ennyi játékperc (esemény-korlát)
export const PHASES = [{ id: 'dawn', hour: 5 }, { id: 'day', hour: 8 }, { id: 'dusk', hour: 18 }, { id: 'night', hour: 21 }];

export function wrapMinutes(m) { return ((m % DAY_MIN) + DAY_MIN) % DAY_MIN; }

// Fázis a nap perce szerint: éjszaka 21:00-5:00, hajnal 5-8, nappal 8-18, alkonyat 18-21. Hibás -> 'day'.
export function phaseAt(minuteOfDay) {
  const m = Number(minuteOfDay);
  if (typeof minuteOfDay !== 'number' || !isFinite(m)) return 'day';
  const h = wrapMinutes(m) / 60;
  let id = 'night';
  for (const p of PHASES) if (h >= p.hour) id = p.id;
  return id;
}

function num(v, def, lim) {
  if (typeof v !== 'number' || !isFinite(v)) return def;
  return Math.min(lim[1], Math.max(lim[0], v));
}

export function sanitizeClockConfig(src) {
  const s = src && typeof src === 'object' ? src : {};
  return {
    dayLength: num(s.dayLength, CLOCK_DEFAULTS.dayLength, CLOCK_LIMITS.dayLength),
    startHour: num(s.startHour, CLOCK_DEFAULTS.startHour, CLOCK_LIMITS.startHour),
    speed: num(s.speed, CLOCK_DEFAULTS.speed, CLOCK_LIMITS.speed),
  };
}

// A t = az 1. nap 0:00-tól eltelt játékperc (ez az egyetlen mentett érték). speed: futásidejű szorzó.
export function createGameClock(src) {
  const cfg = sanitizeClockConfig(src);
  const t = cfg.startHour * 60;
  return { cfg, t, speed: cfg.speed, phase: phaseAt(t), listeners: Object.create(null), lastError: null };
}

export function clockInfo(clock) {
  const t = clock.t, mod = wrapMinutes(t);
  return {
    t, day: Math.floor(t / DAY_MIN) + 1, minuteOfDay: mod,
    hour: Math.min(23, Math.floor(mod / 60)), minute: Math.min(59, Math.floor(mod % 60)),
    phase: phaseAt(mod), speed: clock.speed,
  };
}

// Játékperc / valós mp.
export function clockRate(clock) { return clock.speed * DAY_MIN / clock.cfg.dayLength; }

// Figyelő: type 'hour' {day,hour,t} | 'day' {day,t} | 'phase' {from,to,day,hour,t} | '*' (mind). Visszatér a leiratkozóval.
export function onClock(clock, type, fn) {
  if (typeof fn !== 'function') return () => {};
  const list = clock.listeners[type] || (clock.listeners[type] = []);
  list.push(fn);
  return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
}

function emit(clock, ev) {
  for (const key of [ev.type, '*']) {
    const list = clock.listeners[key];
    if (!list) continue;
    for (const fn of list.slice()) { // másolat: a figyelő menet közben leiratkozhat
      try { fn(ev, clock); } catch (e) { clock.lastError = e && e.message ? e.message : String(e); }
    }
  }
}

// Előreléptet; a határokat időrendben adja vissza (éjfélkor: day, hour, [phase]). Hibás/negatív dt, szünet -> nincs változás.
export function stepClock(clock, dt) {
  const out = [];
  if (!clock || typeof dt !== 'number' || !(dt > 0) || !isFinite(dt) || !(clock.speed > 0)) return out;
  const dm = Math.min(dt * clockRate(clock), MAX_ADVANCE);
  const t0 = clock.t;
  clock.t = t0 + dm;
  const h0 = Math.floor(t0 / 60), h1 = Math.floor(clock.t / 60);
  for (let h = h0 + 1; h <= h1; h++) {
    const hod = h % 24, day = Math.floor(h / 24) + 1, tb = h * 60;
    if (hod === 0) out.push({ type: 'day', day, t: tb });
    out.push({ type: 'hour', day, hour: hod, t: tb });
    const ph = phaseAt(hod * 60);
    if (ph !== clock.phase) { out.push({ type: 'phase', from: clock.phase, to: ph, day, hour: hod, t: tb }); clock.phase = ph; }
  }
  for (const ev of out) emit(clock, ev);
  return out;
}

export function setClockSpeed(clock, v) {
  if (typeof v === 'number' && isFinite(v)) clock.speed = Math.min(CLOCK_LIMITS.speed[1], Math.max(CLOCK_LIMITS.speed[0], v));
  return clock.speed;
}

// dir > 0: a következő nagyobb létra-érték, dir < 0: az előző kisebb (létrán kívüli sebességnél is).
export function stepClockSpeed(clock, dir) {
  const s = clock.speed;
  if (dir > 0) { const n = CLOCK_SPEEDS.find(v => v > s); if (n !== undefined) clock.speed = n; }
  else if (dir < 0) { for (let i = CLOCK_SPEEDS.length - 1; i >= 0; i--) if (CLOCK_SPEEDS[i] < s) { clock.speed = CLOCK_SPEEDS[i]; break; } }
  return clock.speed;
}

// Idő beállítása (csendes: nem küld eseményt). {day >= 1 egész, hour 0..23 egész, minute 0..<60} -> sikerült-e.
export function setClockTime(clock, tm) {
  if (!tm || typeof tm !== 'object') return false;
  const minute = tm.minute === undefined ? 0 : tm.minute;
  if (!Number.isInteger(tm.day) || tm.day < 1 || tm.day > 1e6) return false;
  if (!Number.isInteger(tm.hour) || tm.hour < 0 || tm.hour > 23) return false;
  if (typeof minute !== 'number' || !(minute >= 0 && minute < 60)) return false;
  clock.t = (tm.day - 1) * DAY_MIN + tm.hour * 60 + minute;
  clock.phase = phaseAt(clock.t);
  return true;
}

// Mentés (S032): csak az idő; a konfig (dayLength, speed) nem állapot.
export function clockState(clock) { return { v: CLOCK_STATE_V, t: clock.t }; }

// Betöltés (csendes). Hibás/ismeretlen verziójú állapot -> false, a óra érintetlen.
export function restoreClock(clock, st) {
  if (!st || typeof st !== 'object' || st.v !== CLOCK_STATE_V) return false;
  if (typeof st.t !== 'number' || !isFinite(st.t) || st.t < 0 || st.t > 1e9) return false;
  clock.t = st.t;
  clock.phase = phaseAt(st.t);
  return true;
}

// Fejlesztői sebesség-billentyűk (fizikai kód, kiosztás-független): PageUp/Num+ gyorsít, PageDown/Num- lassít, End = alap.
const KEYS = new Map([['PageUp', 'faster'], ['NumpadAdd', 'faster'], ['PageDown', 'slower'], ['NumpadSubtract', 'slower'], ['End', 'reset']]);

export function clockKeyAction(e) {
  if (!e || e.ctrlKey || e.altKey || e.metaKey) return null;
  return KEYS.get(e.code) || null;
}

export function applyClockAction(clock, action) {
  if (action === 'faster') return stepClockSpeed(clock, 1);
  if (action === 'slower') return stepClockSpeed(clock, -1);
  if (action === 'reset') clock.speed = clock.cfg.speed;
  return clock.speed;
}

export function bindClockKeys(clock, target = typeof window !== 'undefined' ? window : null) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const h = e => { const a = clockKeyAction(e); if (a) applyClockAction(clock, a); };
  target.addEventListener('keydown', h);
  return () => target.removeEventListener('keydown', h);
}
