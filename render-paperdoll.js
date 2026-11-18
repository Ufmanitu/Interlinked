// render-paperdoll.js (S064; importja: world-sprite, render-sprite, game-paperdoll, data-paperdoll): a paperdoll rajza és gyorsítótára.
// A (faj, kaszt, haj, irány, képkocka) kombinációkból sprite-DSL definíció készül (lustán, első kérésre), a render-sprite LRU-cache-e tárolja.
// Hiba esetén (nincs 2D kontextus, hibás adat) sosem dob: a hívó fallback-et rajzolhat (a drawPlayerDoll hamisat ad).
import { registerSprite } from './world-sprite.js';
import { createSprites, getSprite, drawSprite } from './render-sprite.js';
import { DOLL_CONFIG as C } from './data-paperdoll.js';
import { appearanceOf, dollId, dollDef, frameAt } from './game-paperdoll.js';

export const PAPERDOLL_CACHE = Object.freeze({ maxEntries: 192 }); // ~16 kombináció x 12 kocka

function safeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return { width: w, height: h, getContext: () => null }; // Node: üres vászon (a tesztek a sprite-adatot nézik)
}

/** opts: {makeCanvas, maxEntries}. -> {cache, apps: Map, stats {defs}} */
export function createPaperdoll(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const cache = createSprites({}, { makeCanvas: typeof o.makeCanvas === 'function' ? o.makeCanvas : safeCanvas, maxEntries: o.maxEntries || PAPERDOLL_CACHE.maxEntries });
  return { cache, apps: new Map(), stats: { defs: 0 } };
}

let shared = null;
/** Közös példány (a játék és a karakterválasztó előnézete ugyanazt a cache-t használja). */
export function sharedPaperdoll() { return shared || (shared = createPaperdoll()); }
export function resetSharedPaperdoll() { shared = null; }

/** A játékos kinézete (p.race, p.class; opcionális p.look {hairStyle, hairColor, skin}); játékosonként/kombinációnként gyorsítótárazva. */
export function appearanceFor(pd, p) {
  const race = p && p.race, cls = p && p.class, look = p && p.look && typeof p.look === 'object' ? p.look : null;
  const key = `${String(race)}|${String(cls)}|${look ? `${look.hairStyle}|${look.hairColor}|${look.skin}` : ''}`;
  let a = pd.apps.get(key);
  if (!a) { a = appearanceOf(race, cls, look || undefined); if (pd.apps.size > 64) pd.apps.clear(); pd.apps.set(key, a); }
  return a;
}

/** A sprite felvétele a nyilvántartásba, ha még nincs. -> id. */
export function ensureDoll(pd, app, dir, frame) {
  const id = dollId(app, dir, frame), reg = pd.cache.reg;
  if (!reg.sprites.has(id) && !reg.errors.has(id)) { registerSprite(reg, dollDef(app, dir, frame)); pd.stats.defs++; }
  return id;
}

/** Rajz a lábpontra (x,y) -> igaz, ha valódi figura került ki. */
export function drawDoll(ctx, pd, app, dir, frame, x, y) {
  return drawSprite(ctx, pd.cache, ensureDoll(pd, app, dir, frame), x, y);
}

/** Egy játékos rajza a kamera-offsettel; anim = stepAnim eredménye. A lábpont a játékos-doboz alja közepe. -> igaz, ha a paperdoll rajzolt (különben a hívó greybox-szal pótolhat). */
export function drawPlayerDoll(ctx, pd, p, anim, ox, oy) {
  if (!ctx || !p || !anim) return false;
  const app = appearanceFor(pd, p);
  return drawDoll(ctx, pd, app, anim.dir, anim.frame, p.x - ox, p.y + (Number.isFinite(p.h) ? p.h : 0) / 2 - oy);
}

/** Előnézet a karakterválasztóhoz: (x,y) a doboz bal-felső sarka; a figura kétszeres méretben, lefelé néz, a t időpontban sétálva. Doboz: 64x80. */
export function drawPreviewDoll(ctx, pd, raceId, classId, x, y, t = 0) {
  if (!ctx || typeof ctx.drawImage !== 'function') return false;
  const app = appearanceOf(raceId, classId), id = ensureDoll(pd, app, 'down', frameAt(t)), e = getSprite(pd.cache, id);
  if (e.missing) return false;
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(e.canvas, Math.round(x), Math.round(y), C.w * 2, C.h * 2);
  ctx.imageSmoothingEnabled = prev === undefined ? true : prev;
  return true;
}
