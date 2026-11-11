// game-hud.js (S029) – játékosonkénti HUD-adat, a real-time menü váza, a nézetek chunk-lefedettsége.
// Tiszta logika (nincs DOM/canvas); a rajz: render-hud.js. A HP most placeholder (p.hp/p.hpMax; az S066 Health köti be).
import { chunkKey } from './world-chunk.js';
import { CHUNK_PX } from './world-stream.js';

export const HUD_CONFIG = {
  panelW: 176, panelH: 46, margin: 8,   // a panel a vászon alsó sarkaiban (P1 bal, P2 jobb)
  barW: 112, barH: 8,
  hpMax: 100, staminaMax: 100,          // alapértékek, ha a játékosnak nincs saját
  menuW: 256, menuH: 96, menuGap: 6,    // a menü-váz panelje a HUD fölött, ugyanabban a sarokban
};

const fin = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pos = (v, d) => (fin(v) && v > 0 ? v : d);

/** A játékos HUD-adata: hp/stamina (hiányzó vagy hibás érték -> teli), arányok 0..1, kimerültség, szín. Sosem dob. */
export function hudModel(p, cfg = HUD_CONFIG) {
  const q = p && typeof p === 'object' ? p : {};
  const hpMax = pos(q.hpMax, cfg.hpMax);
  const hp = fin(q.hp) ? clamp(q.hp, 0, hpMax) : hpMax;
  const staminaMax = pos(q.staminaMax, cfg.staminaMax);
  const stamina = fin(q.stamina) ? clamp(q.stamina, 0, staminaMax) : staminaMax;
  return {
    index: q.index === 1 ? 1 : 0,
    hp, hpMax, hpRatio: hp / hpMax,
    stamina, staminaMax, staminaRatio: stamina / staminaMax,
    exhausted: q.exhausted === true,
    color: typeof q.color === 'string' ? q.color : '#9fb4d0',
  };
}

/** A HUD-panel téglalapja: index 0 bal-alsó, 1 jobb-alsó sarok (a vászon vw x vh). */
export function hudLayout(index, vw, vh, cfg = HUD_CONFIG) {
  const x = index === 1 ? vw - cfg.margin - cfg.panelW : cfg.margin;
  return { x, y: vh - cfg.margin - cfg.panelH, w: cfg.panelW, h: cfg.panelH };
}

/** A menü-váz panelje: a HUD fölött, ugyanabban a sarokban. */
export function menuLayout(index, vw, vh, cfg = HUD_CONFIG) {
  const h = hudLayout(index, vw, vh, cfg);
  const x = index === 1 ? vw - cfg.margin - cfg.menuW : cfg.margin;
  return { x, y: h.y - cfg.menuGap - cfg.menuH, w: cfg.menuW, h: cfg.menuH };
}

// ---- real-time menü váz (S049 építi ki): nincs pause; nyitva a karakter áll (nem mozog, nem használ), de a pórázon húzható ----
export function createMenus() { return { open: [false, false], opened: 0, closed: 0 }; }
export function menuOpen(ms, i) { return !!(ms && ms.open && ms.open[i]); }

const SUPPRESS = ['interact', 'ability1', 'ability2', 'interactPressed', 'ability1Pressed', 'ability2Pressed'];

/**
 * A menü-gomb éle (menuPressed) váltja a játékos menüjét. Nyitva (vagy a nyitó/záró kockában) a visszaadott bemenet MÁSOLAT:
 * nincs mozgás (a póráz a társ húzásakor így is vihet), nincs interakció/képesség. Zárva az eredeti objektum megy tovább. A bemenetet nem módosítja.
 */
export function stepMenus(ms, inputs) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    const inp = inputs && inputs[i] && typeof inputs[i] === 'object' ? inputs[i] : {};
    let toggled = false;
    if (inp.menuPressed === true) {
      ms.open[i] = !ms.open[i];
      ms[ms.open[i] ? 'opened' : 'closed']++;
      toggled = true;
    }
    if (ms.open[i] || toggled) {
      const c = { ...inp, x: 0, y: 0, menuPressed: false };
      for (const k of SUPPRESS) c[k] = false;
      out.push(c);
    } else out.push(inp);
  }
  return out;
}

// ---- chunk-lefedettség a két nézetre ----
/** A két nézettel átfedő chunkok [{cx,cy,key}] (ugyanaz a kerekítés/sáv, mint a drawChunks-ban); hibás offset kimarad. */
export function viewChunks(offs, layout, out = [], chunkPx = CHUNK_PX) {
  out.length = 0;
  const seen = new Set();
  for (let i = 0; i < 2; i++) {
    const v = layout && layout.views && layout.views[i], o = offs && offs[i];
    if (!v || !o || !fin(o.x) || !fin(o.y)) continue;
    const px = Math.round(o.x), py = Math.round(o.y);
    const cx0 = Math.floor(px / chunkPx), cx1 = Math.floor((px + v.w - 1) / chunkPx);
    const cy0 = Math.floor(py / chunkPx), cy1 = Math.floor((py + v.h - 1) / chunkPx);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const key = chunkKey(cx, cy);
      if (!seen.has(key)) { seen.add(key); out.push({ cx, cy, key }); }
    }
  }
  return out;
}

/** Hány, valamelyik nézettel átfedő chunk NINCS betöltve (0 = minden látható chunk megvan). A beltér-zsebben értelmetlen (ott nincs chunk). */
export function missingViewChunks(ws, offs, layout) {
  if (!ws || !ws.chunks) return 0;
  let n = 0;
  for (const c of viewChunks(offs, layout)) if (!ws.chunks.has(c.key)) n++;
  return n;
}
