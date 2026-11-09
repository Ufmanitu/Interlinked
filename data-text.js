// data-text.js – alap felhasználói szövegek HU/EN (S019; adat)
// Kulcs-szabály: <terület>.<név>; paraméter: {név}. Új szöveg: MINDKÉT nyelvbe, azonos paraméterekkel.
export const BASE_TEXTS = {
  hu: {
    'tile.grass': 'Fű', 'tile.water': 'Víz', 'tile.stone': 'Kő',
    'tile.wall': 'Fal', 'tile.road': 'Út', 'tile.sand': 'Homok',
    'obj.tree': 'Fa', 'obj.stone': 'Kő',
    'act.default': 'Használ', 'act.examine': 'Megnéz',
    'act.enter': 'Belép', 'act.exit': 'Kilép',
    'clock.day': '{n}. nap', 'clock.paused': 'szünet',
    'clock.phase.dawn': 'Hajnal', 'clock.phase.day': 'Nappal',
    'clock.phase.dusk': 'Alkonyat', 'clock.phase.night': 'Éjszaka',
    'ui.lang': 'Nyelv', 'ui.version': 'Verzió', 'ui.copy': 'Másolás',
    'ui.copied': 'Másolva', 'ui.close': 'Bezár',
    'ui.lang.name': 'Magyar',
    'debug.errors': 'Hibák', 'debug.tests.ok': 'Minden teszt zöld ({n})',
    'debug.tests.fail': '{n} teszt bukott',
  },
  en: {
    'tile.grass': 'Grass', 'tile.water': 'Water', 'tile.stone': 'Stone',
    'tile.wall': 'Wall', 'tile.road': 'Road', 'tile.sand': 'Sand',
    'obj.tree': 'Tree', 'obj.stone': 'Rock',
    'act.default': 'Use', 'act.examine': 'Examine',
    'act.enter': 'Enter', 'act.exit': 'Exit',
    'clock.day': 'Day {n}', 'clock.paused': 'paused',
    'clock.phase.dawn': 'Dawn', 'clock.phase.day': 'Day',
    'clock.phase.dusk': 'Dusk', 'clock.phase.night': 'Night',
    'ui.lang': 'Language', 'ui.version': 'Version', 'ui.copy': 'Copy',
    'ui.copied': 'Copied', 'ui.close': 'Close',
    'ui.lang.name': 'English',
    'debug.errors': 'Errors', 'debug.tests.ok': 'All tests green ({n})',
    'debug.tests.fail': '{n} tests failed',
  },
};
