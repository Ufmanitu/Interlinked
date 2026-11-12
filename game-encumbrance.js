// game-encumbrance.js – teher a pórázban (S034; tiszta logika, DOM nélkül; importja: game-inventory).
// Az inventory összsúlya (kg) két helyen hat:
//  1) p.load (test-egység) -> a k-hook (tether-system.pullFactor): a megrakott TÁRSAT nehezebb húzni (a húzó k-ja csökken);
//  2) p.speedMul (0..1) -> a játékos saját kívánt sebessége (game-player.desiredVelocity): a kapacitás fölött lineárisan lassul.
// A kapacitás az erővel nő (p.strength, alap 1). A lassulás alsó határa > 0, így a túlterhelt játékos sem ragad be (nincs holtpont).
import { totalWeight } from './game-inventory.js';

export const ENCUMBRANCE_CONFIG = Object.freeze({
  kgPerBody: 70,     // 1 test-egység (p.weight = 1) = 70 kg: p.load = kg / kgPerBody
  capacityKg: 40,    // kapacitás erő 1-nél: eddig nincs lassulás
  overKg: 60,        // a kapacitás fölötti ennyi kg-nál éri el a lassulás a minimumot
  minSpeedMul: 0.4,  // a legnagyobb lassulás (a saját sebesség ennyi szorzója)
  minStrength: 0.25, // az erő alsó határa a kapacitás számításában
});

const SANE = new WeakSet([ENCUMBRANCE_CONFIG]); // már ellenőrzött konfigok (nincs képkockánkénti másolás)
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const pos = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
const kgOf = kg => (typeof kg === 'number' && Number.isFinite(kg) && kg > 0 ? kg : 0);

// Hibás/hiányos konfig -> alapérték mezőnként; sosem dob. Az eredmény befagyasztott.
export function sanitizeEncumbrance(src) {
  const d = ENCUMBRANCE_CONFIG, s = src && typeof src === 'object' ? src : {};
  const m = num(s.minSpeedMul, d.minSpeedMul);
  const out = Object.freeze({
    kgPerBody: pos(s.kgPerBody, d.kgPerBody),
    capacityKg: Math.max(0, num(s.capacityKg, d.capacityKg)),
    overKg: pos(s.overKg, d.overKg),
    minSpeedMul: m > 0 && m <= 1 ? m : d.minSpeedMul,
    minStrength: pos(s.minStrength, d.minStrength),
  });
  SANE.add(out);
  return out;
}
const norm = cfg => (SANE.has(cfg) ? cfg : sanitizeEncumbrance(cfg));

// kg -> p.load (test-egység; a k-hook ezt adja a húzott súlyához). Hibás/negatív kg -> 0.
export function loadFromKg(kg, cfg = ENCUMBRANCE_CONFIG) {
  return kgOf(kg) / norm(cfg).kgPerBody;
}

// Teherbírás (kg): capacityKg · max(minStrength, erő); hibás erő -> 1.
export function capacityOf(p, cfg = ENCUMBRANCE_CONFIG) {
  const c = norm(cfg);
  return c.capacityKg * Math.max(c.minStrength, num(p && p.strength, 1));
}

// 0 (a kapacitáson belül) .. 1 (kapacitás + overKg vagy több): lineáris.
export function overloadOf(kg, capacity, cfg = ENCUMBRANCE_CONFIG) {
  const over = kgOf(kg) - Math.max(0, num(capacity, 0));
  return over > 0 ? Math.min(1, over / norm(cfg).overKg) : 0;
}

// Saját sebesség szorzója: 1 (nincs túlterhelés) .. minSpeedMul.
export function speedMulOf(kg, capacity, cfg = ENCUMBRANCE_CONFIG) {
  const c = norm(cfg);
  return 1 - (1 - c.minSpeedMul) * overloadOf(kg, capacity, c);
}

// Egy játékos terhelése az összsúlyból: {kg, capacity, load, overload, speedMul}.
export function encumbranceOf(kg, p, cfg = ENCUMBRANCE_CONFIG) {
  const c = norm(cfg), w = kgOf(kg), capacity = capacityOf(p, c), overload = overloadOf(w, capacity, c);
  return { kg: w, capacity, load: w / c.kgPerBody, overload, speedMul: 1 - (1 - c.minSpeedMul) * overload };
}

// Minden lépés előtt hívandó: a játékos p.load / speedMul / carryKg / capacityKg / overload mezőit az inventoryjából írja.
// Hiányzó vagy hibás inventory -> nincs teher (load 0, speedMul 1). Az inventoryt nem módosítja. -> az eredmények tömbje.
export function syncEncumbrance(players, inventories, cfg = ENCUMBRANCE_CONFIG) {
  const c = norm(cfg), out = [];
  if (!Array.isArray(players)) return out;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p || typeof p !== 'object') { out.push(null); continue; }
    const inv = Array.isArray(inventories) ? inventories[i] : null;
    const e = encumbranceOf(inv && Array.isArray(inv.slots) ? totalWeight(inv) : 0, p, c);
    p.load = e.load; p.speedMul = e.speedMul; p.carryKg = e.kg; p.capacityKg = e.capacity; p.overload = e.overload;
    out.push(e);
  }
  return out;
}
