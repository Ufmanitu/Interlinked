# Lépések S001–S031 (M0 póráz · M1 világ · M2 osztott képernyő)

Formátum: **ID Cím** · Olvasd: (a STATE.md-n felül) · Parancs · Teszt (a felhasználónak szóló, rövid utasítás; csak ha van).

---

## M0 – Póráz-prototípus

**S001 Projektváz** · Olvasd: – · Hozd létre: index.html (canvas, modulbetöltés), main.js (fix 60 Hz lépésű game loop + render), core-screen.js (960x540 virtuális felbontás, egész számú skálázás, pixelated), core-input.js (billentyűzet + Gamepad API, két játékos, konfigurálható kiosztás), core-debug.js (hibák a képernyőn, másolás gomb, FPS), version.js, tests.html + test-index.js (minimális tesztfutó), STATE.md. Teszt: nyissa meg a játék URL-jét: látszik a verzió és a vászon; /tests.html: zöld.

**S002 Két játékos** · Olvasd: input, screen · Játékos-entitás: P1 kék, P2 piros négyzet, top-down mozgás, input-ból. Teszt: mindkettő külön mozog.

**S003 Közös kamera** · Olvasd: játékos · Kamera a felezőponton, fps-független simítás `cam += (target - cam) * (1 - exp(-k*dt))`, késés-korlát, egész pixelre kerekítés.

**S004 Póráz-logika** · Olvasd: GDD.md 4.2 · Tiszta modul (nincs DOM/canvas függés): bemenet két pozíció, két kívánt sebesség, L_eff, k, tengelyenként; kimenet a két tényleges sebesség. Szabályok a GDD 4.2 szerint.

**S005 Póráz-tesztek** · Olvasd: póráz-logika · test-tether.js: minden szabály és határeset (stretch=1, mindkettő áll, ellentétes húzás, átlós mozgás, L_eff változás), felvétel a test-index.js-be. Teszt: /tests.html zöld.

**S006 Póráz bekötése** · Olvasd: póráz-logika, játékos, kamera · A mozgást a póráz-rendszer dönti el (tether-system.js), a játékos nem mozog önállóan.

**S007 Falak és ütközés** · Olvasd: póráz-rendszer, játékos · Tengelyenkénti AABB-ütközés kódból generált falakkal; "ütközés előbb, póráz utána": ha a húzott falnak ütközik, a húzó is megáll.

**S008 Póráz-konfig és debug HUD** · Olvasd: póráz-rendszer · TetherConfig (L_normal, margó, k alap, húzás-stamina kapcsoló), futásidőben állítható billentyűkkel, localStorage-ban megmarad. Debug HUD: stretch tengelyenként, k, L_eff.

**S009 Fonal-vizuál** · Olvasd: póráz-rendszer · A fonal rajza a két játékos között: lazán lógó görbe, a szín és vastagság a stretch szerint (laza/feszes/kritikus). Esemény a későbbi hanghoz.

**S010 k-hook és stamina** · Olvasd: póráz-rendszer, config · `k = f(erő, súly + teher, terep)`: interfész az erő/súly/teher/terep szorzóhoz (most placeholder értékek), opcionális stamina-költség húzáskor.

**S011 M0 playteszt** · Olvasd: config · Adj max 8 pontos checklistát a póráz-érzet teszteléséhez, a felhasználó válasza alapján hangold a konfig alapértékeit. Teszt: a felhasználó 5 percet játszik, és válaszol a checklistára.

---

## M1 – Világ-alap

**S012 Tile-rendszer** · Olvasd: screen, kamera · 32 px tile; kódból rajzolt tileset-atlasz (fű, víz, kő, fal, út, homok); ütköző tile-ok; tile-rajzolás a kamera kivágásában.

**S013 Chunk-adat és terep** · Olvasd: tile-rendszer · 64x64-es chunk, fix seed (mulberry32), saját zajfüggvény (value noise), determinisztikus generálás a chunk-koordinátából.

**S014 Chunk-render és streaming** · Olvasd: chunk-adat, kamera · Chunk lerakása offscreen canvasra (cache), betöltés/eldobás mindkét játékos körül (sugár konfigurálható), csak a látható chunkok rajzolása, stabil 60 FPS. Teszt: induljon el egy irányba sokáig, az FPS a HUD-on stabil.

**S015 Objektumok és Y-sort** · Olvasd: tile-rendszer, játékos · world-object (fa, kő placeholder), y szerinti rajzolási sorrend, ütközők.

**S016 Interakció-rendszer** · Olvasd: játékos, objektumok · Interakciós zóna a játékos előtt, prompt a tárgy fölött, egy gombbal; a két játékos egyszerre is interakcióba léphet.

**S017 Warp-zsebek** · Olvasd: interakció, világ · Beltér a térképen kívüli "zsebben" ugyanabban a világban, warp-trigger oda és vissza, bent a póráz aktív. Példa: egy ház.

**S018 Nap/éjszaka** · Olvasd: screen · GameClock (sebesség konfigurálható), nappal/éjszaka színezés, esemény-hook órára/napra, mentésbarát állapot.

**S019 Lokalizáció HU/EN** · Olvasd: – · i18n.js: kulcsalapú szövegek, t('kulcs'), nyelvváltás; a STATE-be szabály: nincs beégetett felhasználói szöveg.

**S020 Makrótérkép-formátum** · Olvasd: világ, chunk-adat · A kézzel tervezett makrótérkép saját adatformátuma (data-*.js: régiók, POI-k, útvonalak, bejáratok) + betöltő; a procedurális mikroréteg (fa, bokor, kő) erre épül.

**S021 Pixel-art pipeline** · Olvasd: tile-rendszer · Sprite-DSL: paletta + karakter-mátrix -> canvas, sprite-cache, hiányzó sprite helyett placeholder; ATTRIBUTIONS.md sablon.

**S022 M1 playteszt** · Olvasd: – · Checklist (max 6 pont): chunk-átmenet, Y-sort, warp, FPS. Teszt: a felhasználó játszik, és válaszol.

---

## M2 – Dual-kamera + Sorskő-mező

**S023 Két nézet** · Olvasd: kamera, render · Két kamera és két offscreen canvas, kompozíció fix függőleges osztással, mindkét kamera a saját játékosát követi.

**S024 Dinamikus osztás** · Olvasd: compositor, GDD.md 5.2 · Az osztóvonal a felezőponton megy át, merőlegesen Δ-ra; kompozíció clip-path-tal; MVP: vízszintes/függőleges a domináns tengely szerint, vékony osztóvonal.

**S025 Összeolvadás** · Olvasd: compositor · |Δ| <= 0,85·L_normal: mindkét kamera a felezőponton, nincs osztóvonal; |Δ| > 1,0·L_normal: szétválás. Simított, villogásmentes átmenet.

**S026 FieldSystem logika** · Olvasd: GDD.md 5.1 · Tiszta modul: kör alakú mező f(p) a határsávval (8 tile), `L_eff = lerp(L_normal, L_falu, min(f(A), f(B)))`; tesztek (test-field.js).

**S027 FieldSystem a pórázban** · Olvasd: field, póráz-rendszer · L_eff dinamikusan változik, debug HUD mutatja; az egyik játékos a határnál megáll, ha a társ bent marad.

**S028 Sorskő objektum** · Olvasd: field · Nagy kristály (kódból rajzolt), konfigurálható sugár, halvány határ-gyűrű közeledve erősödik, fejleszthető sugár (adat).

**S029 HUD és chunkok osztott képen** · Olvasd: compositor, chunk-streaming · Játékosonkénti HUD a sarkokban (placeholder: név, HP, stamina), chunk-betöltés mindkét nézetre, real-time menü váz (a karakter áll, húzható).

**S030 Falun belül/kívül** · Olvasd: field, compositor · Falun belül működő osztott képernyő (a két játékos messze lehet), falun kívül mindig összeolvadt kép; a határsáv átmenete villogásmentes.

**S031 M2 playteszt** · Olvasd: – · Checklist (max 8 pont): osztás, összeolvadás, határsáv, sarkok, FPS. Teszt: a felhasználó játszik, a hibáit beírja, javítsd.
