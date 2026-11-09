// i18n.js – kulcsalapú lokalizáció HU/EN (S019; tiszta logika, DOM nélkül)
// Használat: t('act.enter'), t('clock.day', {n: 3}), setLang('en'), onLangChange(fn).
// Szabály: nincs beégetett felhasználói szöveg; új szöveg = kulcs a data-text.js-ben (vagy registerTexts).
import { BASE_TEXTS } from './data-text.js';

export const LANGS = ['hu', 'en'];
export const DEFAULT_LANG = 'hu';
export const LANG_STORAGE_KEY = 'interlinked.lang';

export function normalizeLang(v, fallback = DEFAULT_LANG) {
  if (typeof v !== 'string') return fallback;
  const s = v.trim().toLowerCase().slice(0, 2);
  return LANGS.includes(s) ? s : fallback;
}

function emptyTables() {
  const t = Object.create(null);
  for (const l of LANGS) t[l] = Object.create(null);
  return t;
}

// opts: {lang, storage {getItem,setItem}, texts {hu:{},en:{}}, detect: 'hu-HU' (böngésző-nyelv)}
export function createI18n(opts = {}) {
  const i = {
    lang: DEFAULT_LANG, fallback: DEFAULT_LANG, tables: emptyTables(),
    storage: opts.storage || null, listeners: [], missing: new Set(), dups: [], lastError: null,
  };
  if (opts.texts) addTexts(i, opts.texts);
  let start = null;
  if (opts.lang) start = normalizeLang(opts.lang, null);
  if (!start) start = loadLang(i);
  if (!start && opts.detect) start = normalizeLang(opts.detect, null);
  i.lang = start || DEFAULT_LANG;
  return i;
}

// Szövegek felvétele: {hu:{kulcs:'szöveg'}, en:{...}}; nem szöveg értékek kimaradnak.
// Visszatér: a felvett bejegyzések száma. Már létező kulcs felülíródik (i.dups-ba kerül).
export function addTexts(i, texts, prefix = '') {
  let n = 0;
  if (!texts || typeof texts !== 'object') return 0;
  for (const l of LANGS) {
    const src = texts[l];
    if (!src || typeof src !== 'object') continue;
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (typeof v !== 'string') continue;
      const key = prefix + k;
      if (key in i.tables[l]) i.dups.push(l + ':' + key);
      i.tables[l][key] = v;
      n++;
    }
  }
  return n;
}

export function hasKey(i, key, lang) {
  const l = normalizeLang(lang, i.lang);
  return typeof key === 'string' && key in i.tables[l];
}

function fill(str, params) {
  if (!params || typeof params !== 'object') return str;
  return str.replace(/\{([A-Za-z0-9_]+)\}/g, (m, name) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return m;
    const v = params[name];
    return v === null || v === undefined ? '' : String(v);
  });
}

// Fordítás: aktuális nyelv -> másik nyelv -> maga a kulcs (a hiányzó kulcs listázódik).
export function translate(i, key, params, lang) {
  if (typeof key !== 'string') return '';
  const l = normalizeLang(lang, i.lang);
  let s = i.tables[l][key];
  if (s === undefined) {
    i.missing.add(l + ':' + key);
    for (const o of LANGS) { if (o !== l && i.tables[o][key] !== undefined) { s = i.tables[o][key]; break; } }
  }
  if (s === undefined) return key;
  return fill(s, params);
}

export function getLang(i) { return i.lang; }

// Nyelvváltás: igaz, ha változott. Érvénytelen nyelv -> nem változik. A hibázó tároló nem dob.
export function setLang(i, lang) {
  const l = normalizeLang(lang, null);
  if (!l || l === i.lang) return false;
  const from = i.lang;
  i.lang = l;
  if (i.storage) { try { i.storage.setItem(LANG_STORAGE_KEY, l); } catch (e) { i.lastError = e; } }
  for (const fn of i.listeners.slice()) { try { fn(l, from); } catch (e) { i.lastError = e; } }
  return true;
}

export function toggleLang(i) {
  const next = LANGS[(LANGS.indexOf(i.lang) + 1) % LANGS.length];
  setLang(i, next);
  return i.lang;
}

// A mentett nyelv a tárolóból (nem állítja be); nincs/hibás -> null.
export function loadLang(i) {
  if (!i.storage) return null;
  try { return normalizeLang(i.storage.getItem(LANG_STORAGE_KEY), null); } catch (e) { i.lastError = e; return null; }
}

export function onLangChange(i, fn) {
  if (typeof fn !== 'function') return () => {};
  i.listeners.push(fn);
  return () => { const k = i.listeners.indexOf(fn); if (k >= 0) i.listeners.splice(k, 1); };
}

function paramsOf(s) {
  const set = new Set();
  String(s).replace(/\{([A-Za-z0-9_]+)\}/g, (m, n) => { set.add(n); return m; });
  return [...set].sort().join(',');
}

// Ellenőrzés (S191 is ezt használja): hiányzó kulcsok nyelvenként, eltérő paraméterek, üres szövegek, duplikátumok.
export function auditTexts(i) {
  const out = { missing: {}, params: [], empty: [], dups: i.dups.slice() };
  for (const l of LANGS) {
    out.missing[l] = [];
    for (const o of LANGS) {
      if (o === l) continue;
      for (const k of Object.keys(i.tables[o])) if (!(k in i.tables[l])) out.missing[l].push(k);
    }
    out.missing[l].sort();
    for (const k of Object.keys(i.tables[l])) if (i.tables[l][k].trim() === '') out.empty.push(l + ':' + k);
  }
  const a = LANGS[0];
  for (const k of Object.keys(i.tables[a])) {
    for (const o of LANGS.slice(1)) {
      if (k in i.tables[o] && paramsOf(i.tables[a][k]) !== paramsOf(i.tables[o][k])) { out.params.push(k); break; }
    }
  }
  out.params.sort();
  out.ok = out.dups.length === 0 && out.params.length === 0 && out.empty.length === 0 &&
    LANGS.every(l => out.missing[l].length === 0);
  return out;
}

// Nyelvváltó billentyű (fejlesztői; az S107 menü váltja ki): F8.
export function langKeyAction(e) { return e && e.code === 'F8' && !e.ctrlKey && !e.altKey && !e.metaKey ? 'toggle' : null; }
export function bindLangKeys(i, target) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const h = (e) => { if (langKeyAction(e)) { if (e.preventDefault) e.preventDefault(); toggleLang(i); } };
  target.addEventListener('keydown', h);
  return () => target.removeEventListener('keydown', h);
}

// --- Globális példány (a játék ezt használja) ---
function safeStorage() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } }
function navLang() { try { return typeof navigator !== 'undefined' ? navigator.language : null; } catch (e) { return null; } }

export const i18n = createI18n({ texts: BASE_TEXTS, storage: safeStorage(), detect: navLang() });
export const t = (key, params) => translate(i18n, key, params);
export const currentLang = () => i18n.lang;
export const changeLang = (lang) => setLang(i18n, lang);
export const registerTexts = (texts, prefix) => addTexts(i18n, texts, prefix);
export const onLang = (fn) => onLangChange(i18n, fn);
