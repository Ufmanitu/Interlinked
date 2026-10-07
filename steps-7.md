# Lépések S178–S196 (csiszolás és kiadás)

Formátum: **ID Cím** · Olvasd: (a STATE.md-n felül) · Parancs · Teszt (csak ha van).

---

**S178 Szakmák I** · Olvasd: skillek, recipes · Bányászat és kovácsolás teljes mélységben: skill-szintek, receptek tier-enként (1–7), mesterségbónuszok, javítás, szakma-edzők.

**S179 Szakmák II** · Olvasd: skillek, recipes · Gyógynövényezés, alkímia, főzés: receptek, hatás-táblák, tartós buffok, szakma-edzők.

**S180 Szakmák III** · Olvasd: skillek, recipes · Mérnök/szerkezet-szakma, horgászat bővítése: felállítható szerkezetek, automaták, szakma-kombinációk (a két játékos kiegészíti egymást).

**S181 Évszakok** · Olvasd: clock, időjárás · 4 évszak (napok száma konfigurálható): hatás a növényzetre, erőforrásokra, időjárásra, veszélyekre, paletta-váltás, mentés.

**S182 Közös láda (opcionális)** · Olvasd: inventory, trade · Közös bázis-láda (a külön pénz és inventory megmarad): hozzáférés, UI, mentés; kapcsolóval kikapcsolható.

**S183 Bemenet** · Olvasd: input, menü · Teljes kontroller-támogatás mindkét játékosra (Gamepad API), két gombkiosztás egy billentyűzeten, key-ghosting teszt-oldal (ghosting.html), bemeneti puffer.

**S184 Teljesítmény** · Olvasd: chunk-streaming, compositor, debug · Profilozás a debug-overlay-ben (frame-idő bontás), chunk-cache, objektum-poolozás, a lightmap költsége; mérési eredmények a képernyőn másolhatók. Teszt: a felhasználó a mérési szöveget beilleszti.

**S185 Hibajavító kör 1** · Olvasd: STATE hibalista · A STATE ismert hibáinak és a felhasználó által beírt hibáknak a javítása súlyosság szerint, a legsúlyosabb 5.

**S186 Hibajavító kör 2: mentés** · Olvasd: mentés · Régi mentések betöltése, instance-ból kilépés, félbeszakadt mentés, verzió-ugrások; automatizált tesztek.

**S187 Balansz: gazdaság és szintgörbe** · Olvasd: gazdaság, szintgörbe · Pénz be/ki, árak, javítási költségek, pénznyelők, szint-tempó; szimulációs oldal (balance.html), ami táblázatot ír a képernyőre. Teszt: a felhasználó az eredményt beilleszti.

**S188 Balansz: harc és póráz** · Olvasd: config, ellenség-def · Harc-nehézség és póráz-hangolás a teljes játékra (L_normal, k, stamina), a frusztrációs pontok csökkentése, a későbbi lazább póráz.

**S189 Hang és zene csiszolás** · Olvasd: AudioManager · A hang-lista hiányai, mixelés (hangerő-arányok), ambient rétegek, a fonal-hang finomítása.

**S190 Menük, UX, hozzáférhetőség** · Olvasd: menü, UI · UI-egységesítés, szövegméret, színvak mód, feliratok, kontraszt, tutorial-emlékeztetők, a HUD áttekinthetősége.

**S191 Lokalizáció ellenőrzés** · Olvasd: i18n · Hiányzó/duplikált kulcsok keresése a tests.html-ben, HU/EN konzisztencia, túl hosszú szövegek, dialógusok és küldetések ellenőrzése.

**S192 Licenc és credits** · Olvasd: ATTRIBUTIONS · Teljes ellenőrzés (minden külső asset: szerző, licenc, attribúció, share-alike hatás), credits-jelenet az adatból, kockázatos elemek.

**S193 Közzététel és offline** · Olvasd: index.html · PWA (manifest + service worker, offline futás, verziózott gyorsítótár), verziószám a főmenüben, README.md a repóba.

**S194 Zártkörű béta** · Olvasd: – · Béta-leírás (a játék URL-je, mit figyeljenek), visszajelzés-sablon (ingyenes űrlap-kérdések), a játékon belüli "hiba/visszajelzés másolása" gomb.

**S195 Béta utáni javítás** · Olvasd: STATE hibalista · A béta-visszajelzések (a felhasználó beilleszti) alapján prioritási lista és a legfontosabb javítások, utolsó csiszolások.

**S196 Kiadás** · Olvasd: GDD.md 1–2, README · Kiadási szöveg (HU/EN: rövid leírás, funkciólista), képernyőkép-lista, trailer-forgatókönyv, 1.0 ellenőrzőlista, patch-terv. Verzió: 1.0.
