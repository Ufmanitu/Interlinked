# Lépések S066–S090 (M5 harc · M6 instance-ok és Sorsszilánkok)

Formátum: **ID Cím** · Olvasd: (a STATE.md-n felül) · Parancs · Teszt (csak ha van).

---

## M5 – Könnyű harc

**S066 Életerő és sebzés** · Olvasd: – · Health komponens (HP, sebzés-típusok, ellenállások), DamageInfo, halál-esemény, tiszta logika + tesztek, HUD.

**S067 Ellenség-AI** · Olvasd: health · Állapotgép (idle, őrjárat, üldözés, támadás, visszahúzódás), látótávolság, rács-alapú útkeresés (A*, tile-ok), adatvezérelt ellenség-definíció.

**S068 Támadás és hitbox** · Olvasd: health, képesség-végrehajtó · Közelharc/távolsági támadás, hitbox/hurtbox, visszalökés, i-frame, a kaszt-képességekhez kötve, vizuális villanás.

**S069 Két ellenségtípus** · Olvasd: ellenség-AI · Egy lassú-erős és egy gyors-gyenge (adat), spawn-pontok régióhoz kötve.

**S070 Halál és újraélesztés** · Olvasd: health · A játékos elesik (nem game over), a társ újraélesztheti időn belül; ha mindketten elesnek: visszatérés a legutóbbi Sorskő/szilánk-pontra, kis büntetéssel; tesztek.

**S071 Loot-táblák** · Olvasd: világ-tárgyak, ellenség-def · Súlyozott, szint-függő drop-táblák ellenséghez és konténerhez; a loot a földre esik.

**S072 Státuszhatások** · Olvasd: health · Égés, fagyás, méreg, lassítás, sötétség-büntetés; időzítők, stackelés, ikon a HUD-on; a tisztítás feloldja.

**S073 Harc és póráz** · Olvasd: póráz-rendszer, health · Visszalökés húzza a társat, a feszes póráz visszatartja a menekülőt; ellenség nem "vágja el" a pórázt; opcionális képesség: a póráz mint fegyver (lendítés).

**S074 Harc HUD** · Olvasd: HUD · HP, erőforrás, cooldown-ok, státusz-ikonok, ellenség-életcsík, sebzés-számok; olvasható osztott és összeolvadt képernyőn.

**S075 M5 playteszt** · Olvasd: – · Checklist: a harc ritka, rövid, a póráz-érzet harc közben. Teszt: a felhasználó játszik, a hibáit beírja, javítsd.

---

## M6 – Instance-ok és Sorsszilánkok

**S076 Instance-kezelés** · Olvasd: póráz-rendszer, világ, GDD.md 8.1 · Dungeon/bánya külön "instance" (külön világ-állapot), páros belépés (az egyik át tudja húzni a másikat), kilépés ugyanoda, bent a póráz mindig aktív, a mentés kezeli.

**S077 Procedurális bánya** · Olvasd: instance · Rétegek (mélység), járatok, fix seed, bejárat/kijárat, a mélységgel nő a veszély és az érc-tier, adatvezérelt paraméterek.

**S078 Bánya-tartalom** · Olvasd: bánya · Ásás (csákány), ércek, robbantás (kráter, láncreakció), csille (síneken), sötétség (FÉNY-tag).

**S079 Procedurális dungeon** · Olvasd: instance · Szoba-alapú generátor (szoba-prefabok adatként, elrendezés procedurális), kulcs/ajtó, elit/ládák, főellenség-terem placeholder.

**S080 Rejtvény-alapelemek** · Olvasd: interakció · Kapcsoló, nyomólap, ajtó, mozgatható doboz, jel-hálózat (bemenet -> logikai kapu -> kimenet), mentés-kompatibilis állapot; tesztek.

**S081 Póráz-rejtvények** · Olvasd: rejtvény, póráz-rendszer · Két helyen álló kapcsolók, ellensúly (egyik nyomólapon áll, másik a pórázon át húz), híd-építés; adatvezérelten létrehozhatók.

**S082 Sorsszilánk tárgy és felállítás** · Olvasd: field, GDD.md 5.3 · Craftolható szilánk, felállítás érvényes helyre (min. ~80 tile a többi szilánktól, régiónként 1–2, nem instance-ban), előnézet (zöld/piros), mentés.

**S083 Szilánk-mező** · Olvasd: field, szilánk · Kis póráz nélküli kör (~15–20 tile), ugyanazzal a FieldSystem-mel és osztott/összeolvadó képernyővel; checkpoint, mentés, kis craft-állomás.

**S084 Több mező kezelése** · Olvasd: field, GDD.md 5.3 · `s_k = min(f_k(A), f_k(B))`, `k* = argmax s_k`, `L_eff = lerp(L_normal, d_k*, s_k*)`; tesztek (átfedő mezők, két játékos különböző mezőben).

**S085 Sorsugrás: kezdeményezés** · Olvasd: field, menü · Csak mezőből mezőbe, mindketten a mezőben; az egyik kezdeményez, a másik megerősít; cél-választó UI; vadonból nem lehet.

**S086 Sorsugrás: érkezés és költség** · Olvasd: fast-travel · Páros érkezés egymás mellett, átmenet-animáció, nyersanyag- vagy cooldown-költség (konfigurálható), a mentés kezeli a megnyitott mezőket.

**S087 Fejlesztések** · Olvasd: field, config · Sorskő-sugár, szilánk-sugár és funkciók, fonal hossza/szilárdsága: adatvezérelt szintek, költség (pénz + nyersanyag), hatás a FieldSystem/TetherConfig értékeiben.

**S088 Környezeti veszélyek** · Olvasd: státuszhatások · Hideg, sötét, méreg, hőség: zónák/időjárás hatására, védelem tárgyakkal/képességgel.

**S089 Időjárás** · Olvasd: clock · Tiszta, eső, vihar, köd, hóesés: régió-függő valószínűségek, rajzolt effektek, hatás a veszélyekre és mozgásra, mentés.

**S090 M6 playteszt** · Olvasd: – · Checklist: instance-belépés/kilépés, rejtvények, szilánk-építés, Sorsugrás, a póráz-feszültség megmarad-e. Teszt: a felhasználó játszik, a hibáit beírja, javítsd.
