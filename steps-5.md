# Lépések S118–S147 (Tier 2 Erdő · Tier 3 Folyóvölgy · Tier 4 Bánya)

Régió-minta (10 lépés): térkép -> erőforrások/tech -> 3 régió-mechanika -> ellenségek -> dungeon -> boss -> NPC/küldetések -> art/hang/playteszt. Minden régió adata külön data-*.js fájlokban. Formátum: **ID Cím** · Olvasd: (a STATE.md-n felül) · Parancs.

---

## Tier 2 – Erdő (szint 10–20, 8–24 óra)

**S118 Erdő: térkép** · Olvasd: makrótérkép, chunk-streaming · Erdőszél, sűrű erdő, tisztások, rejtett völgy, útvonalak, 1 üreg-bejárat, kapu a faluból (puha: veszélyszint; kemény: I. felvonás kulcsküldetés), mikroréteg (fa-sűrűség, bokor, gomba), ellenség-spawn 10–20. szintre.

**S119 Erdő: erőforrások, tech** · Olvasd: items, recipes · Keményfa, gyógynövények, gombák, vadhús; Tier 2 receptek (jobb eszközök, gyógyital, alap főzés), gear tier 2, szakma-küszöbök.

**S120 Sűrű aljnövényzet** · Olvasd: póráz k-hook, obstacle · Lassít (terep-szorzó a `k`-ban), sarlóval/fejszével/égetéssel kinyitható (tag), újranő.

**S121 Fény és árnyék** · Olvasd: lightmap, obstacle · Lombkorona-árnyékzónák, fény-függő növények és ellenségek, FÉNY-tag, árnyék-rejtvény.

**S122 Rejtett ösvények** · Olvasd: képességek, objektumok · Rejtett átjárók és felfedezés-jutalmak (nyomkövetés, kötél/vágás), rejtett szilánk-hely; mindegyikre legalább két megoldás.

**S123 Erdő: ellenségek** · Olvasd: ellenség-def, loot · Farkas, pók, ent-csemete + 1 elit, saját AI-paraméterek, loot, gyengeségek (tűz, fény).

**S124 Erdő: dungeon** · Olvasd: dungeon-generátor · Üreges fa/barlang-variáns saját szoba-prefabokkal, 3 POI-prefab (romos kunyhó, gomba-kör, erdei oltár).

**S125 Erdőszellem (boss)** · Olvasd: rejtvény, health, póráz-rendszer · 3 fázis, a póráz kulcsszerepben (két gyökércsomót egyszerre kell megérinteni, miközben a szellem elhúzza az egyiket), rövid cutscene, jutalom + szilánk-darab.

**S126 Erdő: NPC-k, küldetések** · Olvasd: küldetések, NPC, gazdaság · Vadász, gyógyító, vándorkereskedő, 8–10 küldetés, régió-árak, a II. felvonás első beatje.

**S127 Erdő: art, hang, playteszt** · Olvasd: sprite-DSL/LPC, audio, szintgörbe · Erdő-art, biom-zene, ambient; a 8–24 óra tempó ellenőrzése, XP-görbe hangolás. Teszt: a felhasználó játszik, a naplót beilleszti.

---

## Tier 3 – Folyóvölgy + vízesés (szint 20–30, 24–42 óra)

**S128 Folyóvölgy: térkép** · Olvasd: makrótérkép · Folyó, mellékágak, szigetek, vízesés, völgy-települések, átkelő-helyek, vízesés mögötti barlang-bejárat, ellenség-spawn 20–30. szintre, kapuk.

**S129 Folyóvölgy: erőforrások, tech** · Olvasd: items, recipes · Halak, agyag, nád, homok, kavics; Tier 3 receptek (tégla, üveg, jobb szerszámok, horgász-felszerelés), gear tier 3.

**S130 Átkelők** · Olvasd: rejtvény, obstacle, póráz-rendszer · Híd (építhető), komp (mozgó platform), gázló, úszás tiltva; póráz-rejtvény a víz két oldalán.

**S131 Horgászat** · Olvasd: skillek, inventory · Szakma-skill, két-játékosos minijáték (egyik horgászik, másik segít/véd), hal-táblák régióra/időre/időjárásra.

**S132 Áramlás és árvíz** · Olvasd: póráz-rendszer, időjárás · Sodró víz (póráz-kölcsönhatás), árvíz-esemény vihar után, figyelmeztetés, biztonságos pontok.

**S133 Folyóvölgy: ellenségek** · Olvasd: ellenség-def · Rák, vízi kígyó, mocsári lény + 1 elit, vízi/parti AI, loot.

**S134 Vízesés mögötti barlang** · Olvasd: dungeon-generátor · Vízszint-rejtvény, áramlás-kapuk, 2–3 POI-prefab, rejtett szilánk-hely.

**S135 Folyami szörny (boss)** · Olvasd: rejtvény, health · A víz szintjét két helyről kell szabályozni, akció-fázis, jutalom + szilánk-darab.

**S136 Folyóvölgy: NPC-k, karaván** · Olvasd: küldetések, NPC · NPC-k, 8–10 küldetés, **karaván-kísérés** küldetés-típus (útvonal, időzítés, támadások, póráz-megoldás), árak, történet-beat.

**S137 Folyóvölgy: art, hang, playteszt** · Olvasd: art, audio, szintgörbe · Art, zene/ambient, a 24–42 óra tempó ellenőrzése, hangolás. Teszt: a felhasználó játszik, a naplót beilleszti.

---

## Tier 4 – Bánya-mélységek + dombvidék (szint 30–40, 42–60 óra)

**S138 Dombvidék: térkép** · Olvasd: makrótérkép · Dombok, bánya-főbejárat, elhagyott törpe-állomások, kapuk, ellenség-spawn 30–40. szintre.

**S139 Bánya: erőforrások, tech** · Olvasd: items, recipes · Vas, szén, ezüst, drágakövek; kohó, Tier 4 receptek (acél, fegyver/páncél, robbanószer), gear tier 4, kovács-szakma szintek.

**S140 Rétegek és ásás** · Olvasd: bánya-generátor, instance · 5–6 mélységi szint, lift/létra/akna, ásás-szerkezet (támasz, beomlás-kockázat), a mélységgel nő az érc-tier.

**S141 Robbantás és csillék** · Olvasd: bánya, rejtvény · Robbanószer-craft és -használat, láncreakció-kontroll, csille-hálózat (sínváltók), csille-rejtvény a pórázzal.

**S142 Sötét és levegő** · Olvasd: veszély-rendszer, lightmap · Sötét mélység, rossz levegő/gáz-zónák, fény-források mint erőforrás-menedzsment (fáklya, lámpa, olaj), védelem (maszk).

**S143 Bánya: ellenségek** · Olvasd: ellenség-def · Denevér, kő-féreg, kobold-bányász + 1 elit, sötétben/szűk helyen viselkedő AI, loot.

**S144 Mély bánya** · Olvasd: dungeon-generátor, bánya · Mélyebb szintek procedurálisan + POI (elhagyott törpe-csarnok, ércér-barlang), rejtett szilánk-hely.

**S145 Kőgólem (boss)** · Olvasd: rejtvény, health, póráz-rendszer · Robbantás/ásás/póráz-mechanika (a gyenge pontot csak felfeszített pórázzal lehet elérni), több fázis, jutalom + szilánk-darab.

**S146 Bánya: NPC-k, kovács-mélység** · Olvasd: küldetések, crafting · Törpe NPC-k, 8–10 küldetés, kovács-szakma teljes mélysége (ötvözetek, javítás), régió-árak, történet-beat.

**S147 Bánya: art, hang, playteszt** · Olvasd: art, audio, szintgörbe · Art, zene/ambient, a 42–60 óra tempó ellenőrzése, hangolás. Teszt: a felhasználó játszik, a naplót beilleszti.
