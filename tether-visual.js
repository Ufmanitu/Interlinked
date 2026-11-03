// Fonal-vizuál logika: tiszta modul (nincs DOM/canvas). A rajz a main.js-ben van;
// itt a görbe, a stílus (szín/vastagság) és a szint-események (a későbbi hanghoz).

export const VISUAL_CONFIG = {
  segments: 24,                                   // a görbe szakaszainak száma
  maxSag: 60,                                     // px, a laza fonal legnagyobb belógása
  sagDist: 160,                                   // px: ennél rövidebb távolságnál a belógás arányosan kisebb
  smooth: 14,                                     // 1/s, a megjelenített feszülés simítása (fps-független)
  up: { taut: 0.7, critical: 0.98 },              // szint-váltás felfelé (feszes / kritikus)
  down: { taut: 0.6, critical: 0.92 },            // szint-váltás lefelé (hiszterézis, nincs villogás)
  widths: { slack: 2, taut: 3, critical: 4 },     // px
  colors: { slack: [111, 168, 220], taut: [255, 210, 122], critical: [255, 106, 74] },
};

export const LEVELS = ['slack', 'taut', 'critical'];

function clamp01(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// A póráz-rendszer állapotából 0..1 feszülés (a két tengely nagyobbika; nem szabad mód -> 1).
export function tetherTension(sys) {
  const st = sys && sys.stretch ? sys.stretch : { x: 0, y: 0 };
  const mode = sys && sys.mode ? sys.mode : {};
  if ((mode.x !== undefined && mode.x !== 'free') || (mode.y !== undefined && mode.y !== 'free')) return 1;
  return Math.max(clamp01(st.x), clamp01(st.y));
}

// Szint hiszterézissel: felfelé a cfg.up, lefelé a cfg.down küszöbök.
export function nextLevel(prev, s, cfg = VISUAL_CONFIG) {
  let lv = LEVELS.includes(prev) ? prev : 'slack';
  if (lv === 'slack' && s >= cfg.up.taut) lv = 'taut';
  if (lv === 'taut' && s >= cfg.up.critical) lv = 'critical';
  if (lv === 'critical' && s < cfg.down.critical) lv = 'taut';
  if (lv === 'taut' && s < cfg.down.taut) lv = 'slack';
  return lv;
}

// A fonal pontjai a-tól b-ig: lazán lógó parabola, s=1-nél egyenes. a, b: {x,y} (világ-koordináta).
export function tetherCurve(a, b, s, cfg = VISUAL_CONFIG) {
  const n = Math.max(2, Math.floor(cfg.segments));
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const sag = cfg.maxSag * (1 - clamp01(s)) * Math.min(1, dist / cfg.sagDist);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    if (i === 0) { pts.push({ x: a.x, y: a.y }); continue; }
    if (i === n) { pts.push({ x: b.x, y: b.y }); continue; }
    const t = i / n;
    pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + sag * 4 * t * (1 - t) });
  }
  return pts;
}

function lerpColor(c0, c1, t) {
  return c0.map((v, i) => Math.round(v + (c1[i] - v) * t));
}

// Szín (s szerint folytonos: laza -> feszes -> kritikus) és vastagság (a szint szerint).
export function tetherStyle(s, level, cfg = VISUAL_CONFIG) {
  const v = clamp01(s);
  const u = cfg.up.taut;
  const c = v <= u
    ? lerpColor(cfg.colors.slack, cfg.colors.taut, clamp01(v / u))
    : lerpColor(cfg.colors.taut, cfg.colors.critical, clamp01((v - u) / (1 - u)));
  const lv = LEVELS.includes(level) ? level : nextLevel('slack', v, cfg);
  return { level: lv, color: `rgb(${c[0]},${c[1]},${c[2]})`, width: cfg.widths[lv] };
}

// Megjelenített állapot: simított feszülés + szint + események.
export function createTetherVisual(cfg = VISUAL_CONFIG) {
  const listeners = [];
  return {
    cfg,
    s: 0,
    level: 'slack',
    on(fn) {                                       // esemény-hook: {type:'level', from, to, s}
      listeners.push(fn);
      return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },
    emit(ev) { for (const fn of listeners.slice()) fn(ev); },
  };
}

// Egy lépés: simítás, szint-váltás, események (a visszatérési érték a lépés eseményei).
export function stepTetherVisual(vis, sys, dt) {
  const target = tetherTension(sys);
  if (dt > 0) vis.s += (target - vis.s) * (1 - Math.exp(-vis.cfg.smooth * dt));
  vis.s = clamp01(vis.s);
  const events = [];
  const lv = nextLevel(vis.level, vis.s, vis.cfg);
  if (lv !== vis.level) {
    events.push({ type: 'level', from: vis.level, to: lv, s: vis.s });
    vis.level = lv;
  }
  for (const ev of events) vis.emit(ev);
  return events;
}
