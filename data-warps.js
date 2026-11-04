// Warp-zsebek adatai (S017). Adat, logika nélkül: a world-warp.js ebből építi a rendszert.
// POCKET_TYPES: a beltér-típusok (méret tile-ban, a járható padló), tárgyak (tile-ban), kijárat-zóna, érkezési pont.
// WARP_LINKS: a kinti "ház" és a zseb összekötése; minden pozíció a kezdőhelyhez (horgony) képest px-ben.
// Új beltér: új típus + új link (egyedi id, egyedi slot). A nameKey az i18n-hez (S019).

export const POCKET_TYPES = {
  house: {
    nameKey: 'pocket.house',
    w: 10, h: 7,                                   // padló tile-ban (320x224 px)
    enter: { x: 5, y: 4 },                         // érkezési pont a padló bal-felső sarkához képest (tile, nem cella)
    exit: { tx: 4, ty: 5, tw: 2, th: 2 },          // kijárat-zóna (ajtószőnyeg) tile-ban
    props: [
      { kind: 'rug',   tx: 2, ty: 1, tw: 4, th: 3, solid: false },
      { kind: 'bed',   tx: 0, ty: 0, tw: 2, th: 2, solid: true },
      { kind: 'table', tx: 7, ty: 0, tw: 2, th: 1, solid: true },
    ],
  },
};

export const WARP_LINKS = [
  {
    id: 'house1', nameKey: 'warp.house1', pocket: 'house', slot: 0,
    house: { dx: -48, dy: -136, w: 96, h: 64 },    // a kinti ház ütköző törzse (a tető ennél 32 px-szel magasabb)
    door: { dx: -24, dy: -80, w: 48, h: 44 },      // a kinti belépő-zóna (nem ütköző, az interakció célpontja)
    out: { dx: 0, dy: -40 },                       // ahová a kilépő pár érkezik (a ház előtt)
  },
];
