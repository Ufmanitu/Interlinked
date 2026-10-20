# STATE

Utolsó kész lépés: S005
Verzió: S005 · 2026-10-20

## Fájl-index (API)
- index.html: canvas#game 960x540, modul: main.js
- version.js: VERSION, VERSION_DATE
- core-screen.js: VIRTUAL_W/H, TILE, computeScale(w,h), createScreen(canvas) -> {ctx, scale, resize}
- core-input.js: Input (update(), get(p) -> {x,y,interact,ability1,ability2,menu,*Pressed}), setKeys(p,map), setPadButtons(map), DEFAULT_KEYS, DEFAULT_PAD
- core-debug.js: initDebug() (window error/unhandledrejection -> overlay), logError(msg), showReport(title, lines, ok), copyText(t)
- game-player.js: createPlayer(i,x,y), desiredVelocity(p,inp), stepPlayer(p,inp,dt), PLAYER_SIZE/SPEED/COLORS (tiszta logika; S006-tól a póráz dönt)
- game-camera.js: CAM_VIEW, CAM_CONFIG {k:6, margin:48}, createCamera(x,y), midpoint(a,b), maxLag(delta,viewSize,margin), stepCamera(cam,a,b,dt,cfg,view) (fps-független simítás + késés-korlát), cameraOffset(cam,view) -> egész pixel bal-felső sarok (tiszta logika)
- tether-logic.js: computeTether({a,b,va,vb,L,k,dt}) -> {a:{x,y}, b:{x,y}, stretch:{x,y}, mode:{x,y}} (a,b: {x,y} pozíció; va,vb: kívánt sebesség px/s; L: szám|{x,y} L_eff; k: szám|{a,b} húzó szerinti szorzó 0..1; dt opcionális: ha adott, a lépés végén sem lépi túl a távolság L-t; mode: free|hold|pull-a|pull-b), tetherAxis(pa,pb,va,vb,L,ka,kb,dt) -> {a,b,stretch,mode}, limitRules(dir,va,vb,ka,kb), TETHER_EPS (tiszta logika; S006 köti be)
- test-camera.js: kamera-tesztek (a FILES listában)
- test-player.js: játékos-tesztek (a FILES listában)
- test-tether.js: póráz-szabályok és határesetek (stretch=1, EPS-tolerancia, mindkettő áll, ellentétes húzás, követés-határ, k-korlátozás, L<=0, átlós, tengelyenkénti L, x/y-szimmetria, bemenet-érintetlenség), tartós szimulációk (holtpont, húzás, követés, szűkülő/táguló L_eff), fuzz-invariánsok; helper: run(pa,pb,frames,Lf,vaf,vbf,ka,kb) egy tengelyt léptet
- test-smoke.js: modulbetöltés + 600 kocka két szkriptelt játékossal (póráz-invariáns: távolság <= L_eff, nincs NaN) + 600 kocka folyamatosan változó L_eff-fel (távolság <= max(L, előző táv.)); új DOM-független modult vedd fel a MODULES listába
- main.js: STEP=1/60, fix lépésű loop, kamera-követés, render (ideiglenes rács + játékosok kamera-offsettel + verzió + FPS), initDebug, window.__game {game(players,camera), input, screen}
- test-index.js: test(name,fn), assert, eq, near, runAll(), formatResults(); FILES lista a test-*.js fájloknak; Node: `node test-index.js`
- tests.html: futtatja a teszteket, eredmény a képernyőn + Másolás gomb

## Kiosztás
P1: WASD, F interakció, G/H képesség, Q menü. P2: nyilak, , interakció, . / / képesség, ; menü. Pad: A interakció, X/B képesség, Start menü.

## Szabályok
- Nincs beégetett felhasználói szöveg (i18n az S019-től; core-debug.js S objektuma ideiglenes).
- Új test-*.js: vedd fel a test-index.js FILES listájába.
- A felhasználó csak S185-től tesztel; addig csak feltölt.
- Tesztek Node-ban futtatva (package.json type=module kell hozzá helyben; a repóban nincs). Állapot S005-nél: 49/49 zöld (a póráz-tesztek mutáció-ellenőrzöttek: 6 szándékos logika-hiba mindegyikét elbuktatják).
- Póráz: a távolság-szabály tengelyenként él; k = a húzó lassítás-szorzója (placeholder, a valódi k-hook S010); a hívó a saját pozícióit a visszaadott sebességgel lépteti.

## Hangolt értékek
- kamera: k=6, margin=48 px (S003, kezdőérték)

## Ismert hibák
- (nincs)
