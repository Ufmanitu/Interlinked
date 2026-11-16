// Stamina (S048): tiszta logika, nincs import/DOM. A p.stamina / p.staminaMax / p.exhausted mezőket (HUD olvassa) EGY helyen léptetjük.
// Költségek (egység/mp): húzás (a póráz mode-ja, ha a kapcsoló be van), sprint, gyűjtés; különben regeneráció. Kimerülés: 0-nál; felépülés: resume·max-nál (hiszterézis).
export const STAMINA_PULL = Object.freeze({ max: 100, cost: 20, regen: 15, resume: 0.2 });
export const STAMINA_ACT = Object.freeze({ sprintCost: 18, gatherCost: 6, sprintMul: 1.6, sprintMinInput: 0.1, workMulExhausted: 0.5 });

const fin = (v, d) => (Number.isFinite(v) ? v : d);

// Hibás mező -> alap, határokra szorítva (sosem dob).
export function sanitizeAct(src) {
  const s = src && typeof src === 'object' ? src : {};
  const c = (v, d, lo, hi) => Math.min(hi, Math.max(lo, fin(v, d)));
  return Object.freeze({
    sprintCost: c(s.sprintCost, STAMINA_ACT.sprintCost, 0, 1000),
    gatherCost: c(s.gatherCost, STAMINA_ACT.gatherCost, 0, 1000),
    sprintMul: c(s.sprintMul, STAMINA_ACT.sprintMul, 1, 4),
    sprintMinInput: c(s.sprintMinInput, STAMINA_ACT.sprintMinInput, 0, 1),
    workMulExhausted: c(s.workMulExhausted, STAMINA_ACT.workMulExhausted, 0.05, 1),
  });
}

// Hiányzó/rossz érték -> teli.
export function ensureStamina(p, cfg = STAMINA_PULL) {
  if (!Number.isFinite(p.staminaMax) || p.staminaMax <= 0) p.staminaMax = fin(cfg.max, 100);
  if (!Number.isFinite(p.stamina)) p.stamina = p.staminaMax;
  p.stamina = Math.min(p.staminaMax, Math.max(0, p.stamina));
  p.exhausted = !!p.exhausted;
}

export function canSprint(p) { return !!p && !p.exhausted && !(p.stamina <= 0); }

// Sprint-szándék: a gomb tartva + tényleges mozgás-bemenet (nyitott menünél x=y=0 -> nincs sprint).
export function wantsSprint(inp, act = STAMINA_ACT) {
  return !!inp && !!inp.sprint && Math.hypot(fin(inp.x, 0), fin(inp.y, 0)) > act.sprintMinInput;
}

// A saját sebesség szorzója sprintkor (1 = nincs).
export function sprintMul(on, act = STAMINA_ACT) { return on ? act.sprintMul : 1; }

// Munka-sebesség szorzó (gyűjtés): kimerülten lassabb.
export function workMul(p, act = STAMINA_ACT) { return p && typeof p === 'object' && p.exhausted ? act.workMulExhausted : 1; }

// Egy lépés. mode: {x,y} a póráz mode-ja (pull-a/pull-b), flags: {sprint:[bool,bool], gather:[bool,bool]} (opcionális), enabled: a húzás-költség kapcsolója.
export function stepStamina(players, mode, flags, dt, enabled, cfg = STAMINA_PULL, act = STAMINA_ACT) {
  const m = mode || {}, f = flags || {};
  players.forEach((p, i) => {
    ensureStamina(p, cfg);
    const id = i === 0 ? 'a' : 'b';
    const pulling = !!enabled && (m.x === 'pull-' + id || m.y === 'pull-' + id);
    const sprinting = !!(f.sprint && f.sprint[i]);
    const gathering = !!(f.gather && f.gather[i]) && !p.exhausted; // kimerülten a gyűjtés nem fogyaszt: a játékos pihen (nincs ördögi kör)
    const drain = (pulling ? fin(cfg.cost, 0) : 0) + (sprinting ? act.sprintCost : 0) + (gathering ? act.gatherCost : 0);
    if (dt > 0) p.stamina = drain > 0 ? Math.max(0, p.stamina - drain * dt) : Math.min(p.staminaMax, p.stamina + fin(cfg.regen, 0) * dt);
    if (drain > 0 && p.stamina <= 0) p.exhausted = true;
    else if (p.exhausted && p.stamina >= fin(cfg.resume, 0.2) * p.staminaMax) p.exhausted = false;
  });
}
