// Póráz-logika: tiszta modul (nincs DOM/canvas függés). GDD 4.2, tengelyenként.
// Bemenet: két pozíció, két kívánt sebesség, L_eff, k (+ opcionális dt); kimenet: a két tényleges sebesség.
export const TETHER_EPS = 1e-9; // px: ennyi alatt a korlátnál lévőnek számít

const clamp01 = v => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);

// Szabályok a korlátnál (stretch >= 1), egy tengelyen.
// dir = sign(pb - pa): B kifelé iránya +dir, A kifelé iránya -dir. va/vb: kívánt sebességek.
// ka/kb: lassítás-szorzó, ha A / B húz (0..1). Visszatér: { a, b, mode } (tényleges sebességek).
export function limitRules(dir, va, vb, ka, kb) {
  const oa = -dir * va; // A kifelé-sebessége (>0: kifelé húz)
  const ob = dir * vb;  // B kifelé-sebessége
  if (oa > 0 && ob > 0) return { a: 0, b: 0, mode: 'hold' }; // mindketten kifelé: holtpont
  if (oa > 0 || ob > 0) {
    const aPulls = oa > 0;
    const u = aPulls ? oa : ob;     // a húzó kifelé-sebessége
    const w = aPulls ? -ob : -oa;   // a társ befelé-sebessége (a húzó felé), >= 0
    if (w >= u) return { a: va, b: vb, mode: 'free' }; // a társ követi: nincs büntetés
    const up = w + (u - w) * (aPulls ? ka : kb);        // büntetett sebesség (w=0 -> u*k)
    const v = (aPulls ? -dir : dir) * up;               // a húzó irányában, a társat is viszi
    return { a: v, b: v, mode: aPulls ? 'pull-a' : 'pull-b' };
  }
  return { a: va, b: vb, mode: 'free' }; // egyik sem húz kifelé
}

// Egy tengely. pa/pb: pozíció, va/vb: kívánt sebesség (px/s), L: L_eff erre a tengelyre,
// ka/kb: k a húzó szerint, dt (mp, opcionális): ha adott, a lépés végén sem lépi túl a távolság L-t.
// Visszatér: { a, b, stretch, mode } — mode: 'free' | 'hold' | 'pull-a' | 'pull-b'.
export function tetherAxis(pa, pb, va, vb, L, ka = 1, kb = 1, dt = 0) {
  const l = L > 0 ? L : 0;
  const kA = clamp01(ka), kB = clamp01(kb);
  const d = pb - pa;
  const ad = Math.abs(d);
  const stretch = l > 0 ? ad / l : (ad > 0 ? Infinity : 1);

  if (ad >= l - TETHER_EPS) { // a korlátnál (vagy túl)
    const dir = d !== 0 ? Math.sign(d) : Math.sign(vb - va);
    if (dir === 0) return { a: va, b: vb, stretch, mode: 'free' };
    const r = limitRules(dir, va, vb, kA, kB);
    return { a: r.a, b: r.b, stretch, mode: r.mode };
  }

  if (dt > 0) { // a lépésen belül eléri a korlátot: a maradék időre a szabályok érvényesek
    const w = vb - va;
    const e = d + w * dt;
    if (Math.abs(e) > l) {
      const s = Math.sign(e);
      const f = Math.min(1, Math.max(0, ((s * l - d) / w) / dt)); // szabad időhányad
      const r = limitRules(s, va, vb, kA, kB);
      return { a: f * va + (1 - f) * r.a, b: f * vb + (1 - f) * r.b, stretch, mode: r.mode };
    }
  }
  return { a: va, b: vb, stretch, mode: 'free' };
}

// Két játékos, mindkét tengely. a, b: {x,y} pozíció; va, vb: {x,y} kívánt sebesség (px/s);
// L: szám | {x,y} (L_eff); k: szám | {a,b} (húzó szerinti szorzó); dt: opcionális.
export function computeTether({ a, b, va, vb, L, k = 1, dt = 0 }) {
  const Lx = typeof L === 'number' ? L : L.x;
  const Ly = typeof L === 'number' ? L : L.y;
  const ka = typeof k === 'number' ? k : k.a;
  const kb = typeof k === 'number' ? k : k.b;
  const x = tetherAxis(a.x, b.x, va.x, vb.x, Lx, ka, kb, dt);
  const y = tetherAxis(a.y, b.y, va.y, vb.y, Ly, ka, kb, dt);
  return {
    a: { x: x.a, y: y.a },
    b: { x: x.b, y: y.b },
    stretch: { x: x.stretch, y: y.stretch },
    mode: { x: x.mode, y: y.mode },
  };
}
