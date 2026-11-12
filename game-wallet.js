// game-wallet.js (S036) – játékosonkénti pénz (külön pénz, nincs közös kassza). Tiszta logika (nincs DOM/canvas).
// Egész, nemnegatív érme-egyenleg; minden művelet atomi, hibás bemenet nem módosít és nem dob. A trade (S043), bolt (S094), jutalmak (S092) erre épülnek.
export const WALLET_CONFIG = Object.freeze({ max: 999999999, start: 0 });

export const WALLET_TEXTS = {
  hu: { label: 'Érme', amount: '{n} érme' },
  en: { label: 'Coins', amount: '{n} coins' },
};

const isAmount = n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const cap = cfg => (cfg && Number.isSafeInteger(cfg.max) && cfg.max > 0 ? cfg.max : WALLET_CONFIG.max);

/** Új pénztárca. A kezdő összeg 0..max-ra szorítva, hibás -> 0. */
export function createWallet(start = WALLET_CONFIG.start, cfg = WALLET_CONFIG) {
  const max = cap(cfg);
  const s = isAmount(start) ? Math.min(start, max) : 0;
  return { coins: s, max };
}

/** Játékosonként külön pénztárca. */
export function createPlayerWallets(count = 2, start = WALLET_CONFIG.start, cfg = WALLET_CONFIG) {
  const n = Number.isSafeInteger(count) && count > 0 ? count : 2;
  return Array.from({ length: n }, () => createWallet(start, cfg));
}

/** Az egyenleg (hibás pénztárca -> 0). */
export function balance(w) { return w && isAmount(w.coins) ? w.coins : 0; }

/** Elég-e az egyenleg (n egész >= 0). */
export function canAfford(w, n) { return isAmount(n) && balance(w) >= n; }

/** Mennyit tud még fogadni a plafonig. */
export function room(w) { return w && Number.isSafeInteger(w.max) ? Math.max(0, w.max - balance(w)) : 0; }

/** Befér-e n a plafon alatt. */
export function canReceive(w, n) { return isAmount(n) && !!w && room(w) >= n; }

/** Hozzáad; a plafon fölötti RÉSZ nem kerül be: visszaadja a NEM befért maradékot (hibás bemenet: nem módosít, 0). */
export function deposit(w, n) {
  if (!w || !isAmount(n) || !isAmount(w.coins)) return 0;
  const add = Math.min(n, room(w));
  w.coins += add;
  return n - add;
}

/** Levon; ATOMI: nem elég -> nem módosít, false. n = 0 -> true. */
export function withdraw(w, n) {
  if (!w || !canAfford(w, n)) return false;
  w.coins -= n;
  return true;
}

/** Átutal a-ból b-be; ATOMI (a fogadó plafonja és a küldő egyenlege is feltétel), a == b -> false. */
export function transfer(a, b, n) {
  if (!a || !b || a === b || !canAfford(a, n) || !canReceive(b, n)) return false;
  a.coins -= n; b.coins += n;
  return true;
}

/** Két pénztárca atomi cseréje a trade-hez: a ad na-t b-nek, b ad nb-t a-nak; bármelyik hiba -> semmi sem változik. */
export function swapMoney(a, b, na, nb) {
  if (!a || !b || a === b || !isAmount(na) || !isAmount(nb)) return false;
  if (!canAfford(a, na) || !canAfford(b, nb)) return false;
  if (balance(a) - na + nb > a.max || balance(b) - nb + na > b.max) return false;
  a.coins = a.coins - na + nb; b.coins = b.coins - nb + na;
  return true;
}

/** Megjelenítés: csoportosított egész ('1 234 567'); hibás -> '0'. */
export function formatMoney(n, sep = ' ') {
  const v = isAmount(n) ? n : 0;
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Mentési alak (az S050 köti a mentésbe). */
export function walletState(w) { return { v: 1, coins: balance(w) }; }

/** Visszaállítás; ATOMI: hibás/ismeretlen verzió/negatív/tört -> false, érintetlen. A plafon fölötti érték a plafonra szorul. */
export function restoreWallet(w, st) {
  if (!w || !st || typeof st !== 'object' || st.v !== 1 || !isAmount(st.coins)) return false;
  w.coins = Math.min(st.coins, Number.isSafeInteger(w.max) ? w.max : WALLET_CONFIG.max);
  return true;
}
