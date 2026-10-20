# STATE

Utolsó kész lépés: S001 (részben: core-debug.js, tests.html, test-index.js hátra)
Verzió: S001 · 2026-10-20

## Fájl-index (API)
- index.html: canvas#game 960x540, modul: main.js
- version.js: VERSION, VERSION_DATE
- core-screen.js: VIRTUAL_W/H, TILE, computeScale(w,h), createScreen(canvas) -> {ctx, scale, resize}
- core-input.js: Input (update(), get(p) -> {x,y,interact,ability1,ability2,menu,*Pressed}), setKeys(p,map), setPadButtons(map), DEFAULT_KEYS, DEFAULT_PAD
- main.js: STEP=1/60, fix lépésű loop, render (verzió + FPS), window.__game

## Kiosztás
P1: WASD, F interakció, G/H képesség, Q menü. P2: nyilak, , interakció, . / / képesség, ; menü. Pad: A interakció, X/B képesség, Start menü.

## Szabályok
- Nincs beégetett felhasználói szöveg (i18n az S019-től).

## Hangolt értékek
- (nincs)

## Ismert hibák
- (nincs)

## Hátra S001-ből
- core-debug.js, tests.html, test-index.js
