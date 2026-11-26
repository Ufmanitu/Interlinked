// data-puzzles.js (S080) – rejtvény-adat és szövegek + a dungeon-meta (S079) átalakítása rejtvény-definícióvá. Tiszta adat, DOM nélkül.
// Koordináták: TILE a rejtvény origójához képest. Jel-források: switches, plates, gates (közös azonosító-tér); fogyasztó: doors.in.

export const PUZZLE_DEFS = [
  { // mintaterem: a doboz az egyik nyomólapra tolható, a másikon a társ áll; VAGY a két kar együtt
    id: 'demo_gate',
    switches: [{ id: 's_left', tx: 2, ty: 2 }, { id: 's_right', tx: 12, ty: 2 }, { id: 's_timer', tx: 7, ty: 8, time: 5 }],
    plates: [{ id: 'p_box', tx: 4, ty: 5 }, { id: 'p_stand', tx: 10, ty: 5 }],
    boxes: [{ id: 'b1', tx: 4, ty: 7 }],
    gates: [
      { id: 'g_plates', op: 'and', in: ['p_box', 'p_stand'] },
      { id: 'g_levers', op: 'and', in: ['s_left', 's_right'] },
      { id: 'g_any', op: 'or', in: ['g_plates', 'g_levers'] },
      { id: 'g_keep', op: 'latch', in: ['g_any'] },
    ],
    doors: [{ id: 'dr_main', tx: 6, ty: 0, w: 3, h: 1, in: 'g_keep' }, { id: 'dr_timer', tx: 14, ty: 7, w: 1, h: 3, in: 's_timer' }],
    keys: [],
  },
];

// az 'act.use' szöveg már a data-stations.js-ben van
export const PUZZLE_TEXTS = {
  hu: { 'act.take': 'Felvesz', 'act.unlock': 'Kinyit', 'act.locked': 'Zárva' },
  en: { 'act.take': 'Take', 'act.unlock': 'Unlock', 'act.locked': 'Locked' },
};

/** Az S079 dungeon-meta ajtói és kulcsai rejtvény-definícióként (az origó a dungeon térképének bal-felső sarka). Hibás meta -> null. */
export function dungeonPuzzleDef(id, meta) {
  if (!meta || !Array.isArray(meta.doors) || !Array.isArray(meta.keys)) return null;
  return {
    id, switches: [], plates: [], boxes: [], gates: [],
    doors: meta.doors.map(d => ({ id: d.id, tx: d.tx, ty: d.ty, w: d.w, h: d.h, lock: d.key })),
    keys: meta.keys.map(k => ({ id: k.id, tx: k.tx, ty: k.ty })),
  };
}
