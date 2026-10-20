# STATE

Utolsó kész lépés: S002
Verzió: S002 · 2026-10-20

## Fájl-index (API)
- index.html: canvas#game 960x540, modul: main.js
- version.js: VERSION, VERSION_DATE
- core-screen.js: VIRTUAL_W/H, TILE, computeScale(w,h), createScreen(canvas) -> {ctx, scale, resize}
- core-input.js: Input (update(), get(p) -> {x,y,interact,ability1,ability2,menu,*Pressed}), setKeys(p,map), setPadButtons(map), DEFAULT_KEYS, DEFAULT_PAD
- core-debug.js: initDebug() (window error/unhandledrejection -> overlay), logError(msg), showReport(title, lines, ok), copyText(t)
- game-player.js: createPlayer(i,x,y), desiredVelocity(p,inp), stepPlayer(p,inp,dt), PLAYER_SIZE/SPEED/COLORS (tiszta logika; S006-tól a póráz dönt)
- test-player.js: játékos-tesztek (a FILES listában)
- main.js: STEP=1/60, fix lépésű loop, render (játékosok + verzió + FPS), initDebug, window.__game {game(players), input, screen}
- test-index.js: test(name,fn), assert, eq, near, runAll(), formatResults(); FILES lista a test-*.js fájloknak; Node: `node test-index.js`
- tests.html: futtatja a teszteket, eredmény a képernyőn + Másolás gomb

## Kiosztás
P1: WASD, F interakció, G/H képesség, Q menü. P2: nyilak, , interakció, . / / képesség, ; menü. Pad: A interakció, X/B képesség, Start menü.

## Szabályok
- Nincs beégetett felhasználói szöveg (i18n az S019-től; core-debug.js S objektuma ideiglenes).
- Új test-*.js: vedd fel a test-index.js FILES listájába.
- A felhasználó csak S185-től tesztel; addig csak feltölt.
- Tesztek Node-ban futtatva (package.json type=module kell hozzá helyben; a repóban nincs).

## Hangolt értékek
- (nincs)

## Ismert hibák
- (nincs)
