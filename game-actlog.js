// S047: tevékenység-idő napló (playteszt/balansz adat). Tiszta logika, DOM és import nélkül.
// localStorage-ba ment (injektálható tároló), szövegként exportálható; az S109/S187 ezt értelmezi.
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const KEY_RE = /^[a-z][a-z0-9:_.-]{0,39}$/i;

export const ACTLOG_CONFIG = Object.freeze({
  key: 'interlinked.actlog', flushEvery: 10, maxDt: 1, maxMilestones: 400, maxKeys: 64,
  maxText: 200000, maxSeconds: 1e9, maxCount: 1e9,
});
export const ACTIVITIES = Object.freeze(['move', 'idle', 'gather', 'craft', 'trade', 'inventory', 'menu']);

export const ACTLOG_TEXTS = {
  hu: {
    title: '# Interlinked napló (v{v})', play: 'játékidő: {time} ({sec} mp)', player: '## Játékos {n}',
    acts: 'tevékenység (mp)', xp: 'XP', events: 'események', miles: '## mérföldkövek',
    ms: '{time} · J{n} · {kind}:{id} · szint {level} · játékperc {t}', none: '—',
  },
  en: {
    title: '# Interlinked log (v{v})', play: 'play time: {time} ({sec} s)', player: '## Player {n}',
    acts: 'activity (s)', xp: 'XP', events: 'events', miles: '## milestones',
    ms: '{time} · P{n} · {kind}:{id} · level {level} · game minute {t}', none: '—',
  },
};

// A tevékenység osztályozása a játékos állapotából: probe {tab 'inv'|'craft'|'trade'|null, menuOpen, gathering, moving}.
export function classifyActivity(probe) {
  const q = probe && typeof probe === 'object' ? probe : {};
  if (q.tab === 'trade') return 'trade';
  if (q.menuOpen) return q.tab === 'craft' ? 'craft' : q.tab === 'inv' ? 'inventory' : 'menu';
  if (q.gathering) return 'gather';
  return q.moving ? 'move' : 'idle';
}

const blank = () => ({ secs: {}, xp: {}, events: {} });
export function createActLog(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const cfg = Object.freeze({ ...ACTLOG_CONFIG, ...(fin(o.flushEvery) && o.flushEvery > 0 ? { flushEvery: o.flushEvery } : {}) });
  return { cfg, storage: o.storage || null, v: 1, playSec: 0, players: [blank(), blank()], milestones: [], now: 0, dirty: false, sinceFlush: 0, stats: { saves: 0, failed: 0 }, lastError: null };
}
function bucket(map, key, cfg) {
  if (!KEY_RE.test(String(key))) return null;
  const k = String(key);
  if (k in map) return k;
  return Object.keys(map).length >= cfg.maxKeys ? 'other' : k;
}
function add(map, key, amount, cfg) {
  const k = bucket(map, key, cfg);
  if (k == null) return false;
  map[k] = Math.min(cfg.maxSeconds, (map[k] || 0) + amount);
  return true;
}
const okP = (p) => p === 0 || p === 1;

// acts[i] = a tevékenység kulcsa (pl. classifyActivity); hibás -> 'idle'. Hibás/negatív dt nem számít.
export function stepActLog(log, dt, acts) {
  if (!fin(dt) || dt <= 0) return false;
  const d = Math.min(dt, log.cfg.maxDt);
  log.playSec = Math.min(log.cfg.maxSeconds, log.playSec + d);
  for (let i = 0; i < 2; i++) {
    const a = acts && typeof acts[i] === 'string' && KEY_RE.test(acts[i]) ? acts[i] : 'idle';
    add(log.players[i].secs, a, d, log.cfg);
  }
  log.dirty = true;
  log.sinceFlush += d;
  if (log.storage && log.sinceFlush >= log.cfg.flushEvery) saveActLog(log);
  return true;
}
export function setActLogTime(log, t) { if (fin(t) && t >= 0) log.now = t; }
export function recordEvent(log, p, key, n = 1) {
  if (!okP(p) || !fin(n) || n < 1) return false;
  const ok = add(log.players[p].events, key, Math.floor(n), log.cfg);
  if (ok) log.dirty = true;
  return ok;
}
export function recordXp(log, p, skill, amount) {
  if (!okP(p) || !fin(amount) || amount < 1) return false;
  const ok = add(log.players[p].xp, skill, Math.floor(amount), log.cfg);
  if (ok) log.dirty = true;
  return ok;
}
export function recordMilestone(log, ev) {
  if (!ev || !okP(ev.player) || !KEY_RE.test(String(ev.kind)) || !KEY_RE.test(String(ev.id)) || !fin(ev.level) || ev.level < 0) return false;
  log.milestones.push({ kind: String(ev.kind), player: ev.player, id: String(ev.id), level: Math.floor(ev.level), playSec: log.playSec, t: fin(ev.t) && ev.t >= 0 ? ev.t : log.now });
  if (log.milestones.length > log.cfg.maxMilestones) log.milestones.shift();
  log.dirty = true;
  return true;
}
// subs: {skill, node, craft, prog: fn => leválasztó, time: () => játékperc (opcionális)}; a hívó (main.js) adja a rendszerek on* függvényeit.
export function connectActLog(log, subs) {
  const s = subs && typeof subs === 'object' ? subs : {};
  const off = [];
  const t = () => { try { return typeof s.time === 'function' ? s.time() : log.now; } catch (e) { return log.now; } };
  const hook = (sub, h) => { try { if (typeof sub === 'function') off.push(sub(h)); } catch (e) { log.lastError = String(e && e.message || e); } };
  const guard = (fn) => (ev) => { try { if (ev && typeof ev === 'object') { setActLogTime(log, t()); fn(ev); } } catch (e) { log.lastError = String(e && e.message || e); } };
  hook(s.skill, guard((ev) => {
    if (ev.type === 'xp') recordXp(log, ev.player, ev.skill, ev.amount);
    else if (ev.type === 'levelup') recordMilestone(log, { kind: 'skill', player: ev.player, id: ev.skill, level: ev.level, t: log.now });
  }));
  hook(s.node, guard((ev) => { if (ev.type === 'depleted') recordEvent(log, ev.player, 'gather:' + ev.nodeType); }));
  hook(s.craft, guard((ev) => { if (ev.type === 'craft') recordEvent(log, ev.player, 'craft:' + ev.recipe, ev.times || 1); }));
  hook(s.prog, guard((ev) => { if (ev.type === 'charlevel') recordMilestone(log, { kind: 'char', player: ev.player, id: 'char', level: ev.level, t: log.now }); }));
  return () => { for (const f of off) { try { if (typeof f === 'function') f(); } catch (e) { /* nincs teendő */ } } off.length = 0; };
}

// --- Mentés / betöltés ---
export function actLogState(log) {
  return {
    v: 1, playSec: log.playSec,
    players: log.players.map((p) => ({ secs: { ...p.secs }, xp: { ...p.xp }, events: { ...p.events } })),
    milestones: log.milestones.map((m) => [m.kind, m.player, m.id, m.level, m.playSec, m.t]),
  };
}
function cleanMap(m, cfg) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const out = {};
  const keys = Object.keys(m);
  if (keys.length > cfg.maxKeys + 1) return null;
  for (const k of keys) { if (!KEY_RE.test(k) || !fin(m[k]) || m[k] < 0 || m[k] > cfg.maxSeconds) return null; out[k] = m[k]; }
  return out;
}
export function restoreActLog(log, st) {
  const c = log.cfg;
  if (!st || st.v !== 1 || !fin(st.playSec) || st.playSec < 0 || st.playSec > c.maxSeconds) return false;
  if (!Array.isArray(st.players) || st.players.length !== 2 || !Array.isArray(st.milestones) || st.milestones.length > c.maxMilestones) return false;
  const players = [];
  for (const p of st.players) {
    const secs = p && cleanMap(p.secs, c), xp = p && cleanMap(p.xp, c), events = p && cleanMap(p.events, c);
    if (!secs || !xp || !events) return false;
    players.push({ secs, xp, events });
  }
  const ms = [];
  for (const m of st.milestones) {
    if (!Array.isArray(m) || m.length !== 6) return false;
    const [kind, player, id, level, playSec, t] = m;
    if (!KEY_RE.test(String(kind)) || !KEY_RE.test(String(id)) || !okP(player) || !fin(level) || level < 0 || !fin(playSec) || playSec < 0 || !fin(t) || t < 0) return false;
    ms.push({ kind: String(kind), player, id: String(id), level, playSec, t });
  }
  log.playSec = st.playSec; log.players = players; log.milestones = ms; log.dirty = false; log.sinceFlush = 0;
  return true;
}
export function saveActLog(log, storage) {
  const st = storage || log.storage;
  try {
    st.setItem(log.cfg.key, JSON.stringify(actLogState(log)));
    log.dirty = false; log.sinceFlush = 0; log.stats.saves++;
    return true;
  } catch (e) { log.stats.failed++; log.sinceFlush = 0; log.lastError = String(e && e.message || e); return false; }
}
export function loadActLog(log, storage) {
  const st = storage || log.storage;
  try {
    const raw = st.getItem(log.cfg.key);
    if (typeof raw !== 'string' || raw.length > ACTLOG_CONFIG.maxText) return false;
    return restoreActLog(log, JSON.parse(raw));
  } catch (e) { log.lastError = String(e && e.message || e); return false; }
}
export function clearActLog(log, storage) {
  log.playSec = 0; log.players = [blank(), blank()]; log.milestones = []; log.dirty = false; log.sinceFlush = 0;
  try { (storage || log.storage).removeItem(log.cfg.key); } catch (e) { log.lastError = String(e && e.message || e); }
}

// --- Szöveges export ---
export function fmtDuration(sec) {
  const s = fin(sec) && sec > 0 ? Math.floor(sec) : 0;
  const p = (n) => String(n).padStart(2, '0');
  return Math.floor(s / 3600) + ':' + p(Math.floor((s % 3600) / 60)) + ':' + p(s % 60);
}
export function defaultTr(lang) {
  const tab = ACTLOG_TEXTS[lang] || ACTLOG_TEXTS.hu;
  return (key, params) => String((tab[key] != null ? tab[key] : key)).replace(/\{(\w+)\}/g, (m, k) => (params && k in params ? params[k] : m));
}
const listOf = (map, round, none) => {
  const e = Object.entries(map).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return e.length ? e.map(([k, v]) => k + ' ' + (round ? Math.round(v) : v)).join(' · ') : none;
};
// tr = (kulcs, paraméterek) => szöveg (pl. kulcs => t('actlog.' + kulcs)); nélküle a magyar alaptáblát használja.
export function exportActLogText(log, tr) {
  const T = typeof tr === 'function' ? tr : defaultTr('hu');
  const none = T('none');
  const out = [T('title', { v: log.v }), T('play', { time: fmtDuration(log.playSec), sec: Math.round(log.playSec) })];
  log.players.forEach((p, i) => {
    out.push(T('player', { n: i + 1 }));
    out.push(T('acts') + ': ' + listOf(p.secs, true, none));
    out.push(T('xp') + ': ' + listOf(p.xp, false, none));
    out.push(T('events') + ': ' + listOf(p.events, false, none));
  });
  out.push(T('miles'));
  if (!log.milestones.length) out.push(none);
  for (const m of log.milestones) out.push(T('ms', { time: fmtDuration(m.playSec), n: m.player + 1, kind: m.kind, id: m.id, level: m.level, t: Math.round(m.t) }));
  let text = out.join('\n') + '\n#json ' + JSON.stringify(actLogState(log));
  if (text.length > log.cfg.maxText) text = out.join('\n');
  return text;
}
// A kiexportált szövegből visszaadja az állapotot (balansz-eszköz S187); hibás -> null.
export function parseActLogText(text) {
  if (typeof text !== 'string' || text.length > ACTLOG_CONFIG.maxText * 2) return null;
  const line = text.split('\n').find((l) => l.startsWith('#json '));
  if (!line) return null;
  try {
    const st = JSON.parse(line.slice(6));
    const probe = createActLog();
    return restoreActLog(probe, st) ? st : null;
  } catch (e) { return null; }
}

// F6 = napló másolása vágólapra (fejlesztői; S049 menü-gomb veheti át).
export function actLogKeyAction(e) {
  if (!e || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null;
  return e.code === 'F6' ? 'export' : null;
}
export function bindActLogKeys(log, ctl, target) {
  const c = ctl && typeof ctl === 'object' ? ctl : {};
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const h = (e) => {
    if (actLogKeyAction(e) !== 'export') return;
    if (typeof e.preventDefault === 'function') e.preventDefault();
    try { if (log.storage) saveActLog(log); if (typeof c.copy === 'function') c.copy(exportActLogText(log, c.tr)); } catch (err) { log.lastError = String(err && err.message || err); }
  };
  target.addEventListener('keydown', h);
  return () => target.removeEventListener('keydown', h);
}
