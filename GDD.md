# Interlinked – Game Design Document

**Verzió:** 0.5 (böngészős) · **Státusz:** tervezési fázis · **Dátum:** 2026-10-20

---

## 1. Rögzített döntések

| Téma | Döntés |
|---|---|
| Műfaj | Helyi (lokális) 2 játékos co-op, felülnézetes pixel-art fantasy kaland/túlélő-RPG, enyhe történettel |
| Platform | Böngésző (HTML5), egy gép, egy képernyő; GitHub Pages-en fut |
| Nézet | Felülnézet (Stardew Valley-szerű), akkor is, ha ez nehezebbé teszi a megvalósítást |
| Tile | 32×32; virtuális felbontás 960×540 (≈ 30×16,9 tile), egész számú skálázás (2× = 1080p, 4× = 4K) |
| Motor | HTML5 Canvas 2D + JavaScript (ES modulok), build és külső könyvtár nélkül |
| Világ | Nyílt világ; külön játékállapot (instance) csak dungeonba/mélybányába lépéskor |
| Karakterek | Faj × kaszt, WoW-szerű; mindkét játékos azt hozza, amit szeretne; a képességek faj és kaszt szerint változnak |
| Póráz | A kamera a két játékos felezőpontján van; a képernyő határa korlátoz; húzásszabályok a 4. fejezetben |
| Falu | A **Sorskő** (nagy kristály/monolit) a falu határán belül kiterjeszti a pórázt; osztott képernyő, találkozáskor összeolvad |
| Kisebb kristályok | **Sorsszilánkok**: a világban felállítható kis póráz nélküli zónák; **Sorsugrás**: gyors, közös teleport a Sorskő és a szilánkok között |
| Gazdaság | Külön pénz és inventory; WoW-szerű trade; nincs soulbound, a cserélgetés szabad |
| Art | LPC-szabványra építve (32 px tile, 64×64 karakterkeret, rétegezett sprite); kezdetben kódból rajzolt pixel-art, később forkolt LPC-repóból futásidőben betöltve |
| Tempó | Lassú fejlődés, sok gyűjtés, craftolás, kereskedés; a harc ritka; a kihívás nem mindig harc |
| Játékidő | Nincs szigorú cél (a játékosok annyit játszanak, amennyit akarnak), de a szintkorlát elérése ≈ **108 óra** |

---

## 2. Koncepció és pillérek

Kétszemélyes, lokális co-op fantasy kaland egy gépen, egy képernyőn. A két karaktert egy póráz köti össze: a kamera mindig a kettejük közti felezőpontot követi, és ha túl messzire távolodnak, a képernyő határa mindkettőjüket megállítja.

**Lore-indoklás (javaslat):** a két főhős sorsát egy ősi varázsfonal, a sors fonala köti össze (innen a cím). A póráz így történetmechanika is: a fonal látható, feszülése vizuális és hangvisszajelzés. A falu **Sorskője** a sors szilárd pontja, ahol a fonal megereszkedik; a **Sorsszilánkok** a világban szétszórt darabjai, a **Sorsugrás** pedig ugrás a sors fonala mentén a szilánkok között.

**Pillérek:**
1. **Kényszerített együttműködés:** mozgás, rejtvények és harc a póráz köré épül.
2. **Felfedezés:** nyílt világ, régiónként új veszélyekkel és erőforrásokkal.
3. **Lassú, mély fejlődés:** gyűjtés, craft, kereskedés, szakmák, karakterépítés.
4. **Érzelmi történetmesélés:** Ori-szerű, kevés szöveggel, környezettel és zenével.

**Referenciák:** Stardew Valley (nézet, hangulat, gazdaság), Terraria (craft, bányászat, tartalom-mélység), Ori and the Blind Forest (érzelmi történetmesélés, akciófolyam), World of Warcraft (faj/kaszt, szakmák, trade), Core Keeper (felülnézetes co-op, Terraria-ihletésű bányászat), Don't Starve Together (túlélő-craftoló ciklus). A shared-screen kényszerekre érdemes megnézni a Trine-t és a Lego-játékok dinamikus osztott képernyőjét.

---

## 3. A játékmenet szerkezete

**Ciklusok:**
- **Percek:** gyűjtés → craft → felfedezés.
- **Egy ülés:** expedíció a bázisról egy régióba és vissza, küldetések, kereskedés.
- **Tíz órás táv:** új régiók, tech-szintek, település- és Sorskő-fejlesztés, a Sorsszilánk-hálózat bővítése, történetfelvonások.

**Kihívások, nem csak harcok:**
- Póráz-rejtvények (hídépítés, kapcsolók két helyen, ellensúly, húzás).
- Logisztika (mit viszünk, mekkora a teher).
- Környezeti veszélyek (hideg, sötét, árvíz, vihar, méreg).
- Karaván kísérése, időzített események, útkeresés.
- Bossok mint rejtvények, időnként akciós harc (elit szörnyek, dungeon-főellenség, sárkány).

---

## 4. Póráz-mechanika

### 4.1 Alapok

- A kamera a felezőponton van: `cam_target = (A + B) / 2`, simítással, fps-független: `cam += (target - cam) * (1 - exp(-k * dt))`.
- A korlát a két játékos **távolságán** alapul, tengelyenként (x, y), nem a képernyőszélen. Így a világ szélén a kamera clampelése nem törheti meg a szabályt.
- A kamera késését korlátozni kell, hogy senki ne csúszhasson ki a képből.
- Fix zoom és felbontás a pixel-art élessége miatt.
- 960×540 virtuális felbontás és 1,5 tile margó mellett `L_normal ≈ 27 × 13,9 tile`. A pórázhosszt a viewporttól függetlenítjük, hogy a zoom ne változtassa meg a játékérzetet.

### 4.2 Szabályok (tengelyenként)

| Helyzet | Eredmény |
|---|---|
| A korlát alatt | Szabad mozgás |
| Mindketten kifelé húznak | **Mindketten megállnak** (holtpont) |
| Csak az egyik húz kifelé (a másik áll) | A húzó **lassul** (movement punishment), és **elhúzza** a másikat, aki vele mozog; mindketten lassabbak |
| A másik a húzó felé lép | A büntetés megszűnik (követi) |

```
stretch = |Δ| / L_eff                 // 0..1 tengelyenként
a = A kifelé húzó szándéka,  b = B kifelé húzó szándéka
if stretch < 1:            szabad
elif a>0 and b>0:          mindkettő = 0 ezen a tengelyen
elif a>0 xor b>0:          puller.speed *= k;  a társat a puller viszi
k = f(húzó ereje, húzott súlya + inventory-terhe, terep)
```

- **Ellenállás:** az ellenirányú gombnyomás. Külön "brace" gomb nem kell.
- **Ütközés előbb, póráz utána:** ha a húzott falnak ütközik, a húzó is megáll (nincs átrántás falon).
- **Nincs útvonal-akadás:** a póráz távolságalapú, nem fizikai kötél, ezért nem akad be sarkokba.
- **Menü:** real-time, megnyitása közben a karakter áll (és a szabályok szerint húzható).
- **Húzás költsége:** opcionálisan stamina. A faj/kaszt ereje és súlya módosítja a `k`-t, így a karakterépítés a pórázzal is összekapcsolódik.
- **Instance-átmenet (dungeon-bejárat):** a pár együtt lép át, az egyik át tudja húzni a másikat.
- **Fejlődés:** a fonal hossza és szilárdsága történet- és felfedezés-alapon fejleszthető. A korai játékban szoros póráz tanít együttműködni, később szabadabb lesz.

---

## 5. A Sorskő, a Sorsszilánkok és az osztott képernyő

### 5.1 Póráz a mezőben

A falu határán belül nincs póráz (a Sorskő kivetíti), a határnál ~8 tile-es sávban fokozatosan visszatér.

```
f(p)  = 1 a mezőn belül, 0 kívül, a határsávban lineárisan 1→0
L_eff = lerp(L_normal, L_falu, min(f(A), f(B)))     // L_falu ≈ a falu átmérője
```

Az egyik játékos csak addig mehet kifelé, amíg `|Δ| ≤ L_eff`. Ha a társ bent marad, a határsávnál megáll (vagy a 4.2 húzásszabályai lépnek életbe). Külön kivételkezelés nem kell.

### 5.2 Összeolvadó / osztott képernyő

- Mindig **két kamera** (két offscreen canvas, közös világ), clip-path-os kompozícióval összeállítva.
- `|Δ| ≤ L_normal` (belefér a képbe): mindkét kamera a **felezőponton** van, a két kép azonos, az osztóvonal nem látszik, az összeolvadás folytonos.
- `|Δ| > L_normal`: mindkét kamera a saját játékosát követi, az osztóvonal a felezőponton megy át, merőlegesen Δ-ra (Lego-stílusú dinamikus osztás).
- A váltás simított, hiszterézissel (szétválás 1,0·L, összeolvadás ~0,85·L), hogy ne villogjon.
- A falun kívül `L_eff = L_normal`, így a kép mindig összeolvadt: a póráz és az osztott képernyő **egyetlen rendszerből** jön.
- MVP-ben elég függőleges/vízszintes osztás a domináns tengely szerint, az átlós később jöhet.
- Chunk-betöltés **mindkét játékos körül**.
- HUD játékosonként a képernyő sarkaiban.

### 5.3 Sorsszilánkok és Sorsugrás

A Sorskő fejleszthető: a faluval nő a mező sugara. A világban kisebb kristályok, **Sorsszilánkok** is felállíthatók, és közöttük **Sorsugrással** lehet gyorsan, közösen utazni. A számértékek hangolandók.

- **Felállítás:** craftolt tárgy (régiós nyersanyagból), érvényes helyre, a többi szilánktól minimum ~80 tile távolságra, régiónként 1–2 darab.
- **Zóna:** kicsi, póráz nélküli kör (~15–20 tile sugarú), ugyanúgy osztott/összeolvadó képernyővel. Checkpoint, mentés és kis craft-állomás tartozik hozzá; fejlesztéssel nő a sugara és a funkciói.
- **Sorsugrás:** csak Sorskő- vagy Sorsszilánk-mezőből másik mezőbe, **mindketten együtt**. Az egyik kezdeményezi, a másik megerősíti, a célnál egymás mellett érkeznek. Nyersanyag- vagy cooldown-költséggel, hogy a póráz ne veszítse el a jelentőségét.
- **Vadonból nem lehet ugrani**, így megmarad a felfedezés kockázata. Későbbi opció: egyszer használatos visszahívó tárgy.
- **Technika:** több mezőnél mezőnként számoljuk az `f`-et, és a legjobb közös mezőt vesszük:

```
s_k   = min(f_k(A), f_k(B))          // a k. mezőben mennyire "benne" van mindkét játékos
k*    = argmax_k s_k                 // a legjobb közös mező
L_eff = lerp(L_normal, d_k*, s_k*)   // d_k = a k. mező átmérője
```

---

## 6. Karakterrendszer: faj × kaszt

Mindkét játékos bármilyen kombinációt választhat, ezért **egyik kombináció sem lehet zsákutca**.

| | Mit ad | Példák |
|---|---|---|
| **Faj** | passzívok, stat-módosítók, kinézet, utility-hajlam | törpe (bányászat, sötétlátás), tünde (erdei mozgás, gyógynövény), ember (kereskedelmi kedvezmény), ork (erő → húzás), kobold/halfling (könnyű, szűk helyen átfér) |
| **Kaszt** | aktív képességek, erőforrás, harci + nem harci utility | harcos (falbontás, tolás), varázsló (fény, fagyasztás, gyújtás), ranger (nyomkövetés, kötélvetés), gyógyító (gyógyítás, tisztítás), tolvaj (zárfeltörés, lopakodás), alkimista/mérnök (craft, szerkezetek) |

**Tervezési szabályok:**
- **Képesség-tagek:** minden akadálynak legalább 2–3 megoldása van (pl. `FÉNY` vagy `ÉGETÉS` vagy `FÁKLYA`-tárgy), és az alapszerszámok (csákány, kötél, fáklya) craftolhatók. A kaszt kényelem, nem kapu. Két harcos vagy két varázsló is végigviheti a játékot.
- Nincs kötelező trinity (tank/healer/dps), mivel a harc ritka.
- Kombó-képességek a két játékos között (pl. tűz + szél, fagy + vízfelszín).
- **Adatvezérelt (data-driven):** faj, kaszt, képesség és tárgy adatfájlokból (data-*.js) jön.
- **MVP:** 3 faj × 3–4 kaszt, a többi utólag adható hozzá.
- **Paperdoll:** test/faj + haj + ruha + fegyver külön rétegekből (LPC), így kevés asset sok kombinációt ad.
- **Fejlődés:** tevékenység-alapú skillek (használattal nőnek), lassú karakterszint, talentek/képességfa, plusz a fonal fejlesztése.

---

## 7. Gazdaság, inventory, trade

- Mindkét játékosnak **saját pénze és inventoryja** van. Közös láda a bázison opcionális (később).
- **WoW-szerű trade-ablak:** két panel egymás mellett (tárgyak + pénz), mindkét fél "Elfogad", módosításkor mindkét elfogadás törlődik, majd végső megerősítés. Közelségi feltétel (~3 tile). Kontrollerrel két külön kurzor.
- **Nincs soulbound:** minden szabadon cserélhető.
- **Szakma-korlát:** karakterenként max. 2 fő szakma (WoW-hoz hasonlóan), ez ad értelmet a kereskedésnek és a specializációnak: az egyik bányászik/kovácsol, a másik gyógynövényez/főz, és cserélnek.
- **NPC-gazdaság:** kereskedők régiónként eltérő árakkal, kereslet-kínálat, megrendelés-/küldetéstábla, karavánok.
- **Pénznyelők:** javítás, képzés, település-, Sorskő- és Sorsszilánk-fejlesztés.
- **Tárgyak:** craftolás állomásokkal és tech-fával, gear-tierek, súly/terhelés, stamina, nap/éjszaka, időjárás, évszakok (később).
- **Falu/bázis:** fejlesztés és NPC-kapcsolatok (Stardew-réteg).

---

## 8. Világ és régiók

### 8.1 Szerkezet

- **Nyílt világ**, chunk-alapú betöltés (pl. 64×64 tile/chunk), régiónként kb. 200–300 tile.
- **Instance csak:** dungeon és mélybánya. Bent a póráz mindig aktív.
- **Falusi beltér** (bolt, ház): ugyanabban a világban, a térképen kívüli "zsebekben", warp-triggerrel. Így az osztott képernyő működik, ha az egyik játékos bent van, a másik kint.
- **Kézi + procedurális hibrid:** kézzel tervezett makró-térkép (régiók, útvonalak, helyszínek, fix seed, saját adatformátum) + procedurális mikroréteg (erőforrás-elhelyezés, dekoráció, spawn, random események) + POI-prefabok + procedurális bánya/dungeon.
- **Kapuzás:** puha kapuk (veszélyszint, hideg/sötét/méreg, erőforrás-tierek, fonalhossz) + kemény kapuk (történet, kulcstárgy).

### 8.2 Régiók és tempó

| Tier | Régió | Szint | Kumul. óra | Jellegzetes mechanika | Boss |
|---|---|---|---|---|---|
| 1 | Rét + falu | 1–10 | 0–8 | oktatás, kereskedés, NPC-k, alap craft, Sorskő | – |
| 2 | Erdő | 10–20 | 8–24 | sűrű aljnövényzet, gyűjtögetés, fény/árnyék, rejtett ösvények | Erdőszellem |
| 3 | Folyóvölgy + vízesés | 20–30 | 24–42 | átkelők (híd, komp), horgászat, áramlás, vízesés mögötti barlang | Folyami szörny |
| 4 | Bánya-mélységek + dombvidék | 30–40 | 42–60 | rétegek, ásás, ércek, robbantás, csillék, sötét | Kőgólem |
| 5 | Hegyek | 40–50 | 60–78 | hágók, hideg, szél, lavina | Jégsárkány-fióka |
| 6 | Romvár / árnyékföld | 50–58 | 78–96 | kapcsolós és póráz-alapú rejtvények, csapdák | Lovag-kísértet |
| 7 | Sárkányvölgy + finálé | 58–60 | 96–108 | láva, a póráz végső próbája | Fősárkány |

A szintkorlát (60) munka-érték, utána sandbox.

### 8.3 A 108 óra megvalósítása

- **Tartalom-költségvetés:** kb. 20% kézzel írt (történet, küldetések, bossok, helyszínek), kb. 80% rendszer (szakma-skillek, craft-tierek, procedurális bánya/dungeon, események, gazdaság). A 108 óra **nem** készülhet kézzel.
- **Szintgörbe:** adatvezérelt táblázat, `XP(L) = alap · L^p`; a `p`-t a tier-határok kumulatív idejéhez hangoljuk. A tevékenység-időt érdemes logolni a playtesthez.
- **Változatosság:** a hosszú játékidő fárasztása ellen párhuzamos skillek, események és póráz-kihívások, nem csak harc.
- **Kiadás tier-enként:** minden tier önálló, kiadható egység, ez csökkenti a kockázatot. Az első szelet az 1. tier első ~2–3 órája teljes minőségben, az 1.0 a teljes 7 tier.

---

## 9. Történet (váz)

- **I. felvonás:** szöveg nélküli prológ (Ori-szerű), a fonal megkötése, a falu.
- **II. felvonás:** a világ bejárása, a bossok, a fonal erejének megértése.
- **III. felvonás:** a sárkány, a fonal sorsa; a bizalom és az elengedés témája.
- Elbeszélés: környezeti, rövid párbeszédek, zenei és fényhangulat. A póráz fejlesztése a történet fordulópontjaihoz kötődik.
- **Sorskő-szál (javaslat):** a Sorsszilánkok egy szétzúzott nagy Sorskő darabjai; megtalálásuk és újraépítésük a főtörténet gerince lehet.

---

## 10. Grafika és hang

- **LPC-szabvány:** 32 px tile, 64×64 karakterkeret, rétegezett faj/ruha/fegyver. A 16 px-es csomagokat nem keverjük bele (eltérő pixelsűrűség).
- A stílust korán rögzítjük (M1); a hiányzó assetet recolorral/szerkesztéssel pótoljuk. **A licencet (attribúció, share-alike) minden csomagnál ellenőrizni kell.**
- **Paletta-csere:** kevés alapspriteból sok faj-, biom- és ellenségvariáns.
- **Szerkesztés:** a pixel-art kódból rajzolt (paletta + mátrix), külső eszköz nélkül.
- **Placeholder (greybox):** az M0–M3 szakaszban színes formák és kóddal generált sprite-ok, az art cseréje később egyszerű, ha az architektúra asset-független.
- **AI-generált pixel-art:** ötletelésre jó, fő pipeline-nak nem javasolt (stílus-/animációkonzisztencia, bizonytalan jogi helyzet).
- **Hang:** WebAudio-szintézis (letöltött hangfájl nélkül): ambient zene biomonként, jó fonal-feszülés hangvisszajelzés.
- Dinamikus fény (lightmap), a világító fonal az Ori-hangulatért.

---

## 11. Technikai architektúra

**Motor:** HTML5 Canvas 2D + JavaScript ES modulok, lapos fájlszerkezet a repo gyökerében, GitHub Pages-en. Saját tile-, Y-sort-, útkereső- és fény-megoldás. Helyi multiplayer, vagyis nincs netcode. A játéklogika rajz- és DOM-független, hogy Node-ban tesztelhető legyen.

**Rendszerek:**
- `TetherSystem` (távolság-korlát, húzásszabályok, `L_eff`, fonal-vizuál)
- `CoopCamera` / `SplitScreenCompositor` (dual-kamera, canvas-összeállítás)
- `FieldSystem` (Sorskő, Sorsszilánkok, `f(p)`)
- `FastTravel` (Sorsugrás: kezdeményezés, megerősítés, páros érkezés)
- `WorldStreaming` (chunk-betöltés mindkét játékos körül)
- `CharacterBuilder` (faj + kaszt, paperdoll)
- `Inventory`, `Crafting`, `Economy`, `TradeWindow`
- `WorldGen` (procedurális bánya/dungeon, események)
- `Quest`, `Dialogue`, `SaveSystem` (verziózott JSON, korán elkezdendő)

**Eszközök:** Git/GitHub (verziókezelés és hosting), Node (automata tesztek).

**Input:** a kontroller (2 db) legyen elsődleges. Egy billentyűzeten két játékosnál **key ghosting/rollover** korlát van, ezért a kiosztás kevés gombra épüljön.

---

## 12. Ütemterv

| # | Mérföldkő | Kész, ha… |
|---|---|---|
| M0 | Póráz-prototípus (greybox) | két mozgó kocka, simított kamera, a 4.2 húzásszabályok, falütközés |
| M1 | Világ-alap | 32 px tilemap, chunk-betöltés, Y-sort, warp-zsebek, art-stílus rögzítve |
| M2 | **Dual-kamera + Sorskő-mező** | összeolvadó/osztott kép, `L_eff` a határsávban (a legnagyobb technikai kockázat) |
| M3 | Alapciklus | gyűjtés, inventory, craft, mentés, trade-ablak |
| M4 | Karakterépítés | 2–3 faj × 2–3 kaszt adatvezérelten, utility-tagek |
| M5 | Könnyű harc | felülnézetes harc, 2 ellenség, halál/újraélesztés |
| M6 | Instance-ok + Sorsszilánkok | procedurális bánya/dungeon, páros belépés; Sorsszilánk-építés és Sorsugrás |
| M7 | Vertikális szelet | falu + az 1. tier eleje valódi arttal, kereskedés |
| M8 | Történet-váz | prológ, fonal-lore, főküldetés |
| M9+ | Tier 2–7 | iteratívan, tier-enként |
| M∞ | Csiszolás | balansz, hang, menük, hibajavítás |

Az M0–M2 dönti el, hogy a mechanika működik-e, ezért ez az elsődleges kockázatcsökkentés.

---

## 13. Scope (MoSCoW)

- **Kell:** póráz, helyi co-op, Sorskő + osztott képernyő, tilemap-világ, gyűjtés/craft/kereskedés/trade, 3 faj × 3 kaszt, 1 régió + 1 bánya, mentés.
- **Kellene:** Sorsszilánkok és Sorsugrás, több régió, bossok, történet, szezonok, szakma-rendszer teljes mélységben.
- **Lehetne:** farm-réteg, közös láda, sárkány-esemény, mod-támogatás.

---

## 14. Kockázatok

| Kockázat | Kezelés |
|---|---|
| A projekt mérete (108 óra egyetlen fejlesztőnek) | tier-enkénti kiadás, 80% rendszer / 20% kézi tartalom, az M7 után scope-felülvizsgálat |
| Dual-kamera és osztott képernyő technikai nehézsége | M2-ben korán prototipizálni |
| Póráz-frusztráció (holtpont, húzás) | M0 playteszt, hangolható `k` és `L` értékek |
| A Sorsugrás gyengíti a póráz-feszültséget | költség/cooldown, minimális szilánk-távolság, vadonból tiltott ugrás |
| Faj×kaszt kombinációk balansza | képesség-tagek, minden akadálynak 2–3 megoldás, craftolható alapszerszámok |
| Art-konzisztencia | egy stílus (LPC), korai rögzítés, recolor/paletta-csere, placeholder-first |
| Licenc-kockázat | minden asset licencének ellenőrzése és attribúció-lista |

---

## 15. Nyitott kérdések

1. **Sorsugrás hangolása:** költség vagy cooldown, szilánkok száma régiónként, vadonból használható visszahívó tárgy (lásd 5.3).
2. **Szintkorlát:** a 60 munka-érték.
3. **Osztóvonal:** egyenes vagy dinamikus átlós az 1.0-ban?
4. **Közös láda és farm-réteg:** kell-e egyáltalán?
5. **Póráz-hangolás:** `L_normal` margó, `k` büntetés, húzás-stamina, ezekre az M0 playteszt ad választ.
