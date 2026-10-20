# Lépések S032–S065 (M3 alapciklus · M4 karakterépítés)

Formátum: **ID Cím** · Olvasd: (a STATE.md-n felül) · Parancs · Teszt (csak ha van).

---

## M3 – Alapciklus

**S032 Mentés** · Olvasd: játékos, clock · localStorage, verziózott JSON (schema_version, migrációs hook), mentés/betöltés: játékos-pozíciók, világ-seed, GameClock. Menüben: mentés szövegként másolása és beillesztéses betöltés (export/import).

**S033 Tárgyak és Inventory** · Olvasd: – · data-items.js (id, név-kulcs, stack, súly, érték, tagek), Inventory osztály (slotok, hozzáadás/eltávolítás, stack), játékosonként; tiszta logika, test-inventory.js.

**S034 Teher a pórázban** · Olvasd: inventory, póráz k-hook · Az összsúly bekötése a `k`-ba, túlterhelés lassít; tesztek.

**S035 Inventory UI** · Olvasd: inventory, ui, input · Játékosonkénti slot-rács a canvason, kontrollerrel és billentyűzettel vezérelhető, nyitva a karakter áll.

**S036 Pénz** · Olvasd: inventory · Wallet játékosonként (külön pénz), tesztek, HUD-megjelenítés.

**S037 Erőforrás-node-ok** · Olvasd: interakció, objektumok · Fa, kő, gyógynövény: életerő/gyűjtési idő, drop-tábla, újranövés, adatvezérelt.

**S038 Gyűjtő-eszközök** · Olvasd: node-ok, inventory · Fejsze, csákány, sarló: tier, sebesség-szorzó, szükséges eszköz-tag a node-oknál.

**S039 Világ-tárgyak** · Olvasd: inventory, objektumok · A földre dobott/dropolt tárgy: mágnes-felvétel, stackelés, eltűnési idő.

**S040 Recept és crafting** · Olvasd: inventory · data-recipes.js (bemenetek, kimenet, állomás-tag, skill-szint), Crafting logika, test-crafting.js.

**S041 Craft-állomások** · Olvasd: crafting, interakció · Munkapad, kemence, főzőhely: tag-alapú, felállítható; kézzel craftolható alap-szerszámok.

**S042 Craft UI** · Olvasd: crafting, UI · Elérhető receptek, hiányzó összetevők jelzése, mennyiség, kontrollerrel.

**S043 Trade állapotgép** · Olvasd: inventory, wallet, GDD.md 7 · WoW-szerű trade (két panel, mindkét fél "Elfogad", módosítás törli az elfogadásokat, végső megerősítés, ~3 tile távolság, atomi csere), tiszta logika, test-trade.js.

**S044 Trade UI** · Olvasd: trade, UI · Két panel egymás mellett, két kurzor kontrollerrel, állapotjelzés, visszavonás.

**S045 Skill-XP** · Olvasd: – · Tevékenység-alapú skillek: SkillSet, XP-esemény bus (gyűjtés, craft stb. hívja), szintlépés-esemény, tesztek.

**S046 Szakma-korlát** · Olvasd: skillek · Karakterenként max. 2 fő szakma, választás/csere, a szakma határozza meg a magasabb tier-hez tartozó recepteket/node-okat (puha kapu).

**S047 Szintgörbe és napló** · Olvasd: skillek, GDD.md 8.3 · Adatvezérelt `XP(L) = alap · L^p` (p konfigurálható), szintkorlát 60, tevékenység-idő napló localStorage-ba, exportálható szövegként; tesztek.

**S048 Stamina** · Olvasd: játékos, póráz-rendszer · Sprint, húzás-költség, gyűjtés-költség, regeneráció, kimerültség, HUD.

**S049 Menürendszer** · Olvasd: UI, input · Egységes menükezelő, játékosonként saját menü-állapot (inventory, craft, térkép, beállítás), nincs pause, kontroller-fókusz.

**S050 Mentés bővítése** · Olvasd: mentés · Inventory, wallet, skillek, szint, mező-állapot, világ-változások (kitermelt node-ok, lerakott állomások); betöltés után ugyanott folytatódik.

**S051 M3 playteszt** · Olvasd: – · Checklist (max 8 pont): gyűjt, craft, trade, mentés/betöltés, teher. Teszt: a felhasználó játszik, a hibáit beírja, javítsd.

---

## M4 – Karakterépítés

**S052 Adat-regiszter** · Olvasd: items · data-*.js: fajok, kasztok, képességek, tárgyak betöltője, validáció (hiányzó hivatkozások), a tests.html jelezze.

**S053 Három faj** · Olvasd: regiszter, póráz k-hook · Törpe, tünde, ork (adat): passzívok, stat-módosítók (erő/súly -> `k`), sötétlátás/erdei mozgás/erő-húzás.

**S054 Képesség-végrehajtó** · Olvasd: regiszter · Erőforrás (mana/stamina/fókusz), cooldown, cél-típusok, 2 aktív képesség-gomb; tesztek.

**S055 Harcos** · Olvasd: képesség-végrehajtó · Falbontás, tolás, alap sebzés (adat).

**S056 Varázsló** · Olvasd: képesség-végrehajtó · Fény (FÉNY-tag), fagyasztás, gyújtás (ÉGETÉS-tag), mana (adat).

**S057 Ranger** · Olvasd: képesség-végrehajtó · Nyomkövetés, kötélvetés, távolsági támadás (adat).

**S058 Gyógyító** · Olvasd: képesség-végrehajtó · Gyógyítás, tisztítás, támogató képességek (adat).

**S059 Tag-akadályok** · Olvasd: képesség-végrehajtó · Obstacle rendszer: az akadály tag-ekkel oldható fel (sötét: FÉNY|FÁKLYA; elzárt út: ÉGETÉS|FEJSZE|ROBBANTÁS); egy példa-akadály.

**S060 Craftolható alap-szerszámok** · Olvasd: crafting, obstacle · Fáklya, kötél, csákány, fejsze receptek és használat mint kasztfüggetlen tag-forrás.

**S061 Kombó-képességek** · Olvasd: képesség-végrehajtó · Kétjátékos-kombó rendszer (tűz + szél, fagy + vízfelszín): reakció-tábla adatként, két példa.

**S062 Talentfa** · Olvasd: skillek · Adatvezérelt talent/képességfa, szintenként pont, egyszerű UI.

**S063 Karakterválasztó** · Olvasd: regiszter, UI · Két játékos: faj + kaszt, bármilyen kombináció, előnézet, leírás.

**S064 Paperdoll** · Olvasd: sprite-DSL · Kódból rajzolt rétegezett karakter (test/faj, haj, ruha, fegyver), 4 irány, séta-animáció, sprite-cache.

**S065 M4 playteszt** · Olvasd: – · Checklist: minden faj × kaszt kombináció végigvihető-e, az akadályoknak van-e 2–3 megoldása. Teszt: a felhasználó játszik, a hibáit beírja, javítsd.
