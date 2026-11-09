// test-i18n.js – S019: lokalizáció tesztek
import { test, assert } from './test-index.js';
import {
  LANGS, normalizeLang, createI18n, addTexts, hasKey, translate, setLang, toggleLang,
  loadLang, onLangChange, auditTexts, langKeyAction, bindLangKeys, i18n, t, LANG_STORAGE_KEY,
} from './i18n.js';
import { BASE_TEXTS } from './data-text.js';

const mk = (o = {}) => createI18n({ texts: { hu: { a: 'Szia {n}', b: 'Csak HU' }, en: { a: 'Hi {n}' } }, ...o });
const mem = (init) => { const m = new Map(init ? [[LANG_STORAGE_KEY, init]] : []); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };

test('i18n: normalizeLang', () => {
  assert(normalizeLang('hu') === 'hu' && normalizeLang('EN-us') === 'en', 'felismerés');
  assert(normalizeLang('de') === 'hu' && normalizeLang(5) === 'hu' && normalizeLang(null, null) === null, 'tartalék');
});

test('i18n: fordítás, paraméter, tartalék nyelv, hiányzó kulcs', () => {
  const i = mk();
  assert(translate(i, 'a', { n: 3 }) === 'Szia 3', 'hu + paraméter');
  assert(translate(i, 'a') === 'Szia {n}', 'hiányzó paraméter marad');
  assert(translate(i, 'a', { n: null }) === 'Szia ', 'null -> üres');
  setLang(i, 'en');
  assert(translate(i, 'a', { n: 'X' }) === 'Hi X', 'en');
  assert(translate(i, 'b') === 'Csak HU', 'tartalék: másik nyelv');
  assert(translate(i, 'nincs.ilyen') === 'nincs.ilyen', 'hiányzó kulcs -> a kulcs');
  assert(i.missing.has('en:b') && i.missing.has('en:nincs.ilyen'), 'hiányzók listázva');
  assert(translate(i, 'a', { n: 1 }, 'hu') === 'Szia 1', 'explicit nyelv');
  assert(translate(i, 5) === '' && translate(i, '__proto__') === '__proto__' && translate(i, 'toString') === 'toString', 'hibás/prototípus-kulcs');
});

test('i18n: nyelvváltás, figyelők, tároló', () => {
  const st = mem();
  const i = mk({ storage: st, lang: 'hu' });
  let calls = [];
  const off = onLangChange(i, (to, from) => calls.push(from + '>' + to));
  onLangChange(i, () => { throw new Error('x'); });
  onLangChange(i, (to) => calls.push('3:' + to));
  assert(setLang(i, 'en') === true && i.lang === 'en', 'váltás');
  assert(calls.join() === 'hu>en,3:en', 'a hibázó figyelő nem állítja meg a többit: ' + calls.join());
  assert(st.m.get(LANG_STORAGE_KEY) === 'en', 'mentve');
  assert(setLang(i, 'en') === false && setLang(i, 'xx') === false && i.lang === 'en', 'nincs változás / érvénytelen');
  off(); calls = [];
  assert(toggleLang(i) === 'hu' && calls.length === 1 && calls[0] === '3:hu', 'toggle, leiratkozás');
  const bad = { getItem() { throw new Error('a'); }, setItem() { throw new Error('b'); } };
  const j = mk({ storage: bad });
  assert(loadLang(j) === null && setLang(j, 'en') === true && j.lang === 'en', 'hibázó tároló nem dob');
});

test('i18n: mentett nyelv és böngésző-nyelv indításkor', () => {
  assert(mk({ storage: mem('en') }).lang === 'en', 'mentett');
  assert(mk({ storage: mem('xx'), detect: 'en-GB' }).lang === 'en', 'hibás mentés -> böngésző');
  assert(mk({ detect: 'de-DE' }).lang === 'hu', 'ismeretlen -> hu');
  assert(mk({ lang: 'en', storage: mem('hu') }).lang === 'en', 'explicit lang erősebb');
});

test('i18n: addTexts érvénytelen érték, duplikátum, előtag', () => {
  const i = mk();
  assert(addTexts(i, null) === 0 && addTexts(i, { hu: { x: 5, y: 'ok' } }) === 1, 'csak szöveg kerül be');
  assert(hasKey(i, 'y', 'hu') && !hasKey(i, 'x', 'hu'), 'hasKey');
  addTexts(i, { hu: { y: 'új' } });
  assert(translate(i, 'y') === 'új' && i.dups.includes('hu:y'), 'felülírás + dups');
  addTexts(i, { en: { z: 'Z' } }, 'p.');
  assert(hasKey(i, 'p.z', 'en'), 'előtag');
});

test('i18n: auditTexts', () => {
  const r = auditTexts(mk());
  assert(r.missing.en.includes('b') && r.missing.hu.length === 0 && r.ok === false, 'hiányzó en kulcs');
  const i = createI18n({ texts: { hu: { k: 'a {x}', e: ' ' }, en: { k: 'a {y}', e: 'x' } } });
  const r2 = auditTexts(i);
  assert(r2.params.join() === 'k' && r2.empty.join() === 'hu:e', 'paraméter-eltérés, üres szöveg');
});

test('i18n: az alap szövegek teljesek (HU = EN kulcsok, azonos paraméterek)', () => {
  const r = auditTexts(createI18n({ texts: BASE_TEXTS }));
  assert(r.ok, 'audit: ' + JSON.stringify(r));
  assert(Object.keys(BASE_TEXTS.hu).length >= 25, 'van tartalom');
  for (const l of LANGS) for (const [k, v] of Object.entries(BASE_TEXTS[l])) assert(typeof v === 'string' && v.length > 0, l + ':' + k);
});

test('i18n: globális példány és t()', () => {
  const before = i18n.lang;
  setLang(i18n, 'hu');
  assert(t('act.enter') === 'Belép' && t('clock.day', { n: 3 }) === '3. nap', 'hu');
  setLang(i18n, 'en');
  assert(t('act.enter') === 'Enter' && t('clock.day', { n: 3 }) === 'Day 3', 'en');
  assert(t('clock.phase.dawn') === 'Dawn', 'fázis');
  setLang(i18n, before);
});

test('i18n: billentyű (F8)', () => {
  assert(langKeyAction({ code: 'F8' }) === 'toggle' && langKeyAction({ code: 'F8', ctrlKey: true }) === null && langKeyAction(null) === null, 'action');
  const i = mk({ lang: 'hu' });
  let h = null; const tg = { addEventListener: (n, f) => { h = f; }, removeEventListener: () => { h = null; } };
  const off = bindLangKeys(i, tg);
  h({ code: 'F8' }); assert(i.lang === 'en', 'váltott');
  h({ code: 'KeyA' }); assert(i.lang === 'en', 'más billentyű nem');
  off(); assert(h === null, 'leválasztva');
  assert(typeof bindLangKeys(i, null) === 'function', 'hibás cél nem dob');
});
