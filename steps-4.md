# Lépések S091–S117 (M7 vertikális szelet · M8 történet)

Formátum: **ID Cím** · Olvasd: (a STATE.md-n felül) · Parancs · Teszt (csak ha van).

---

## M7 – Vertikális szelet

**S091 Dialógus** · Olvasd: i18n · Csomópont-alapú párbeszéd adatként, lokalizált, elágazás, feltételek (küldetés-állapot), rövid szövegdobozok; az indító beszél.

**S092 Küldetések** · Olvasd: dialógus, mentés · Adatvezérelt (gyűjts, ölj, vidd el, érj el), állapotgép, jutalmak, küldetés-napló UI, mentés.

**S093 NPC-k** · Olvasd: dialógus, clock · Napirend (időpont -> hely), napszak-reakció, kapcsolat-érték, egyszerű mozgás útvonalon.

**S094 NPC-gazdaság** · Olvasd: inventory, wallet, NPC · Kereskedő: régiónként eltérő árak, kereslet-kínálat (ár mozog, lassan visszaáll), vétel/eladás UI játékosonként, adatvezérelt árlista; tesztek.

**S095 Megrendelés-tábla** · Olvasd: küldetések, gazdaság · Generált megrendelések, lejárat, szakmákhoz igazítva, napi frissítés.

**S096 Falu-fejlesztés** · Olvasd: field, küldetések · Épületek (kovács, alkimista, bolt), költség, NPC-k beköltözése, a Sorskő a falu szintjéhez kötve.

**S097 Falu elrendezése** · Olvasd: makrótérkép · A falu elrendezése adatként: Sorskő, házak, bolt, tábla, kút, útvonalak, warp-zsebek.

**S098 1. régió: Rét** · Olvasd: makrótérkép, chunk-streaming · Makró-térkép (útvonalak, helyszínek, 1 bánya-bejárat) + procedurális mikroréteg (fű, virág, fa, kő, gyógynövény), erőforrás-szabályok, ellenség-spawn 1–10. szintre.

**S099 Tier 1 küldetések** · Olvasd: küldetések, dialógus · 6–8 küldetés (bevezető, gyűjtő, kereskedő, első bánya, első szilánk), HU/EN, az I. felvonáshoz igazítva.

**S100 Póráz-oktatás** · Olvasd: póráz-rendszer, küldetések · Fokozatos tanítás szöveg nélkül/kevés szöveggel: szabad mozgás a faluban, első feszülés, holtpont-feloldás, egyik húz/másik követ, első póráz-rejtvény; a korai póráz szoros, később lazul.

**S101 Valódi art: LPC-fork** · Olvasd: sprite-DSL, ATTRIBUTIONS · Keress egy LPC-spritesheet GitHub-repót (pl. Universal LPC Spritesheet Character Generator), ellenőrizd a fájlstruktúrát és a licencet. A felhasználó feladata: forkolni a megadott repót (Fork gomb), és megadni a fork URL-jét. A játék a fork nyers fájljaiból tölti a képeket futásidőben (CORS: crossOrigin anonymous), hiba esetén marad a kódból rajzolt sprite. ATTRIBUTIONS frissítése.

**S102 Valódi art: karakterek** · Olvasd: paperdoll, LPC-betöltő · LPC rétegek a paperdollba (faj/test, haj, ruha, fegyver), animációk (idle, walk, attack, hurt).

**S103 Valódi art: tárgyak, ellenségek** · Olvasd: LPC-betöltő · Tile-ok, ikonok, ellenség-sprite-ok az 1. régióhoz; paletta-csere a variánsokhoz.

**S104 Világító fonal, hangulat** · Olvasd: póráz-vizuál, clock · A fonal világít (additív rajz, szín a feszüléssel), fény-térkép (lightmap) a falu éjszakai részein, olcsó megoldással.

**S105 Hang-rendszer** · Olvasd: – · AudioManager WebAudio-val (az első gombnyomásra indul), zene-rétegek (biom, harc), keresztátmenet, SFX-csatornák, hangerő-beállítás, hely-alapú hang a felezőponthoz viszonyítva.

**S106 Szintetizált zene és SFX** · Olvasd: AudioManager · Procedurális biom-zene (egyszerű generatív szintetizátor), fonal-feszülés hang (pitch/réteg a stretch szerint), 3 alap SFX (gyűjtés, craft, trade).

**S107 Főmenü, beállítások** · Olvasd: menü, input · Főmenü, beállítások (skála, hang, nyelv, kiosztás-átállítás két játékosnak), billentyűzet-ghosting figyelmeztetés, kontroller-kiosztás.

**S108 Mentés-slotok** · Olvasd: mentés · 3 slot, slot-kártya (idő, szint, hely), automatikus mentés Sorskő/szilánk-mezőben, backup a korrupció ellen, verzió-migráció tesztekkel.

**S109 Szelet playteszt és balansz** · Olvasd: szintgörbe, napló · 2–3 órás playteszt-terv, a napló-adatok (a felhasználó beilleszti) értelmezése, a `p` hangolása a Tier 1 (0–8 óra) célhoz. Teszt: a felhasználó játszik, a naplót másolja be.

**S110 Scope-felülvizsgálat** · Olvasd: GDD.md 13–14 · Frissítsd a GDD.md-t: Kell/Kellene/Lehetne lista, kockázatok, a következő 20 lépés prioritása. Add vissza a teljes GDD.md-t.

---

## M8 – Történet-váz

**S111 Cutscene-rendszer** · Olvasd: dialógus · Időzített parancsok (kamera, mozgás, fény, zene, szöveg), kihagyható, mentés-biztos, a póráz szünetel.

**S112 Szöveg nélküli prológ** · Olvasd: cutscene · Ori-szerű prológ a fonal megkötéséről, szöveg nélkül, kép- és hangvezérelt, a végén a falu.

**S113 Fonal-lore, környezeti narratíva** · Olvasd: dialógus, GDD.md 9 · Lelet-tárgyak, feliratok, falfestmények, rövid szövegek a világban (HU/EN), a Sorsszilánk-szál nyomai; 10 példa.

**S114 I. felvonás főküldetés** · Olvasd: küldetések, cutscene · A prológtól az első szilánk megtalálásáig (5–7 küldetés), cutscene-ek, kapuk a 2. régió felé (puha + kemény).

**S115 Sorsszilánk-szál** · Olvasd: küldetések, field · Szilánk-darabok régiónként, a Sorskő újjáépítésének fázisai a fonal-fejlesztésekhez kötve; adatként, hogy a régiók hivatkozzanak rá.

**S116 II. felvonás váz** · Olvasd: GDD.md 9 · A főküldetés pontjai régiónként (Tier 2–6), kulcs-jelenetek, a póráz-fejlődés fordulópontjai; váz-adatok és placeholder küldetések.

**S117 III. felvonás váz** · Olvasd: GDD.md 9 · A sárkány, a fonal sorsa, a bizalom és elengedés témája; a finálé jelenet-listája; M8 playteszt-checklist (max 6 pont).
