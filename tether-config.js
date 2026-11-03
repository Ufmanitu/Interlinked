// Póráz-konfig (TetherConfig): tiszta modul (nincs DOM/canvas függés; a tároló és az eseménycél kívülről adható).
// A hangolható alapértékek egy helyen: margó, L_normal skála, k alap, húzás-stamina kapcsoló.
// Futásidőben billentyűkkel állítható, localStorage-ban megmarad.
// L_normal = (nézet - 2*margó) * lScale (GDD 4.1: 960x540 és 48 px margó -> 864x444). A kamera ugyanezt a margót
// használja a késés-korláthoz, így lScale <= 1 mellett a játékosok mindig a képben maradnak.
// A k alap a húzó lassítás-szorzója; az S010 k-hook ezt szorozza az erő/súly/terep tényezőkkel,
// a pullStamina kapcsolót az S010 húzás-stamina költsége olvassa.
import { CAM_VIEW, CAM_CONFIG } from './game-camera.js';

export const TETHER_DEFAULTS = Object.freeze({ margin: CAM_CONFIG.margin, lScale: 1, k: 0.5, pullStamina: false });
export const TETHER_LIMITS = Object.freeze({
  margin: Object.freeze({ min: 0, max: 160, step: 8 }),     // px a képszéltől
  lScale: Object.freeze({ min: 0.1, max: 1, step: 0.05 }),  // L_normal szorzó
  k: Object.freeze({ min: 0, max: 1, step: 0.05 }),         // húzó lassítás-szorzója (alap)
});
export const TETHER_STORAGE_KEY = 'interlinked.tether';
export const TETHER_STORAGE_VERSION = 1;

// Billentyűk (a felső számsor, kiosztás-független; a játékos-kiosztással nem ütköznek).
export const TETHER_KEYS = Object.freeze({
  Digit1: 'lScale-', Digit2: 'lScale+', Digit3: 'margin-', Digit4: 'margin+',
  Digit5: 'k-', Digit6: 'k+', Digit7: 'stamina', Digit8: 'reset', Digit9: 'hud',
});
const STEPS = { 'lScale-': ['lScale', -1], 'lScale+': ['lScale', 1], 'margin-': ['margin', -1], 'margin+': ['margin', 1], 'k-': ['k', -1], 'k+': ['k', 1] };

// Határok közé szorítás + kerekítés (a lebegőpontos sodródás ellen).
function fit(key, v) {
  const lim = TETHER_LIMITS[key];
  const c = Math.min(lim.max, Math.max(lim.min, v));
  return key === 'margin' ? Math.round(c) : Math.round(c * 100) / 100;
}

// Tetszőleges (pl. tárolóból olvasott) adatból tiszta értékek: hiányzó/rossz típus -> alapérték, tartományon kívül -> szorítás.
export function sanitizeTetherValues(data) {
  const d = data && typeof data === 'object' ? data : {};
  const out = {};
  for (const key of ['margin', 'lScale', 'k']) out[key] = Number.isFinite(d[key]) ? fit(key, d[key]) : TETHER_DEFAULTS[key];
  out.pullStamina = typeof d.pullStamina === 'boolean' ? d.pullStamina : TETHER_DEFAULTS.pullStamina;
  return out;
}

export function lNormalOf(margin, lScale, view = CAM_VIEW) {
  return { x: (view.w - 2 * margin) * lScale, y: (view.h - 2 * margin) * lScale };
}

function defaultStorage() {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage || null; } catch (e) { return null; }
}

export class TetherConfig {
  // storage: {getItem, setItem} (alap: localStorage); null -> nincs mentés.
  constructor(storage = defaultStorage()) {
    this.storage = storage;
    this.hud = true; // debug HUD látszik-e (nem mentett)
    Object.assign(this, TETHER_DEFAULTS);
    this.load();
  }

  values() { return { margin: this.margin, lScale: this.lScale, k: this.k, pullStamina: this.pullStamina }; }

  lNormal(view = CAM_VIEW) { return lNormalOf(this.margin, this.lScale, view); }

  load() {
    if (!this.storage) return false;
    let data;
    try { data = JSON.parse(this.storage.getItem(TETHER_STORAGE_KEY)); } catch (e) { return false; }
    if (!data || typeof data !== 'object' || data.v !== TETHER_STORAGE_VERSION) return false; // verzió-hook a későbbi migrációhoz
    Object.assign(this, sanitizeTetherValues(data));
    return true;
  }

  save() {
    if (!this.storage) return false;
    try {
      this.storage.setItem(TETHER_STORAGE_KEY, JSON.stringify({ v: TETHER_STORAGE_VERSION, ...this.values() }));
      return true;
    } catch (e) { return false; }
  }

  // Egy művelet (lásd TETHER_KEYS értékei). Visszatér: változott-e valami. Az érték-változás mentődik.
  apply(action) {
    if (action === 'hud') { this.hud = !this.hud; return true; }
    const before = JSON.stringify(this.values());
    const step = Object.prototype.hasOwnProperty.call(STEPS, action) ? STEPS[action] : null;
    if (step) this[step[0]] = fit(step[0], this[step[0]] + step[1] * TETHER_LIMITS[step[0]].step);
    else if (action === 'stamina') this.pullStamina = !this.pullStamina;
    else if (action === 'reset') Object.assign(this, TETHER_DEFAULTS);
    else return false;
    const changed = JSON.stringify(this.values()) !== before;
    if (changed) this.save();
    return changed;
  }

  // A póráz-rendszer cfg-je: L és k élő függvény, a konfig változása a következő lépésben él.
  systemConfig(extra = {}) {
    return { ...extra, L: () => this.lNormal(), k: () => this.k };
  }

  // A kamera cfg-je: a margó élő (getter).
  cameraConfig() {
    const tc = this;
    return { k: CAM_CONFIG.k, get margin() { return tc.margin; } };
  }
}

// Billentyű-esemény -> művelet (vagy null). Ctrl/Meta/Alt kombinációt nem érint (böngésző-gyorsbillentyűk).
export function tetherKeyAction(e) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey) return null;
  return Object.prototype.hasOwnProperty.call(TETHER_KEYS, e.code) ? TETHER_KEYS[e.code] : null;
}

// Billentyűk bekötése; visszatér a leválasztó függvénnyel.
export function bindTetherConfigKeys(tc, target = typeof window !== 'undefined' ? window : null) {
  if (!target) return () => {};
  const onKey = e => {
    const action = tetherKeyAction(e);
    if (!action) return;
    if (e.preventDefault) e.preventDefault();
    tc.apply(action);
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}

// Debug HUD szöveg (S019-től i18n.js t('kulcs')).
export const HUD_TEXT = {
  hu: { title: 'PÓRÁZ', leff: 'L_eff', stretch: 'stretch', mode: 'mód', lnorm: 'L_normal', margin: 'margó', stamina: 'húzás-stamina', base: 'alap', on: 'be', off: 'ki',
        keys: '1/2 L  3/4 margó  5/6 k  7 stamina  8 alap  9 HUD' },
  en: { title: 'TETHER', leff: 'L_eff', stretch: 'stretch', mode: 'mode', lnorm: 'L_normal', margin: 'margin', stamina: 'pull stamina', base: 'base', on: 'on', off: 'off',
        keys: '1/2 L  3/4 margin  5/6 k  7 stamina  8 reset  9 HUD' },
};

const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

// Debug HUD sorai: stretch tengelyenként, k, L_eff (a póráz-rendszer utolsó lépéséből) + a konfig értékei.
export function tetherHudLines(sys, tc, S = HUD_TEXT.hu) {
  const k = sys.k, ln = tc.lNormal();
  const kText = Math.abs(k.a - k.b) < 1e-9 ? fmt(k.a, 2) : `a ${fmt(k.a, 2)}  b ${fmt(k.b, 2)}`;
  return [
    S.title,
    `${S.leff}    x ${fmt(sys.L.x)}  y ${fmt(sys.L.y)} px`,
    `${S.stretch}  x ${fmt(sys.stretch.x, 2)}  y ${fmt(sys.stretch.y, 2)}`,
    `${S.mode}      x ${sys.mode.x}  y ${sys.mode.y}`,
    `k        ${kText}  (${S.base} ${fmt(tc.k, 2)})`,
    `${S.lnorm} ${fmt(ln.x)}x${fmt(ln.y)} px (${Math.round(tc.lScale * 100)}%)`,
    `${S.margin}    ${tc.margin} px`,
    `${S.stamina} ${tc.pullStamina ? S.on : S.off}`,
    S.keys,
  ];
}
