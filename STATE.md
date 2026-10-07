# STATE
Utolsó kész lépés: S001
## Fájlok (név – cél – publikus API)
- index.html – canvas#game + main.js betöltés (pixelated, középre)
- main.js – fix 60 Hz loop; `createLoop({step,render,hz,maxSteps}) -> {dt, frame(elapsedMs)->lépésszám}`; boot csak böngészőben (Node-ban importálható)
- core-screen.js – `W=960, H=540, computeScale(winW,winH,dpr), createScreen(canvas) -> {canvas,ctx,scale,resize}`
- core-input.js – `Input({target,nav,bindings})`: `update()` tickenként; `players[0|1] = {x,y,held{},pressed{}}`; akciók: interact, ability1, ability2, menu; `setBinding(p,action,codes)`, `setKey(code,down)`; `DEFAULT_BINDINGS`, `PAD_BUTTONS`
- core-debug.js – `createDebug() -> {log, report(text), setFps(n), copy, text, lines}`; window error/unhandledrejection a képernyőre, Copy gomb
- version.js – `VERSION{step,date}, versionString()`; minden lépésben frissítendő
- tests.html – böngészős tesztoldal (zöld/piros), Copy gomb
- test-lib.js – futó + `test, assert, eq, near, run`; új test-*.js innen importál, és fel kell venni a test-index.js-be
- test-index.js – importálja a test-*.js fájlokat, exportálja a `run`-t
- test-core.js – S001 tesztek (skála, loop, input)
- test-smoke.js – Node füstteszt (`node test-smoke.js`, 600 tick, két szkriptelt játékos); lépésenként bővítendő
## Döntések / hangolt értékek
- P1: WASD, E interakció, Q/R képesség, Tab menü. P2: nyilak, / interakció, . és , képesség, Backspace menü
- Pad: bal gomb/D-pad mozgás, A=interakció, X/Y=képességek, Start=menü; holtzóna 0,25; pad i = játékos i
- Skála: egész számú eszközpixeles (DPR-t figyelembe veszi)
- Loop: max 5 lépés/képkocka (spirál-védelem)
- Node-teszthez ideiglenesen {"type":"module"} package.json kell (nem része a repónak)
## Ismert hibák / TODO
- Böngészőben nem futott (csak Node-teszt); a vászon/FPS/hibapanel kirajzolása nem ellenőrzött
- Beégetett szöveg: a debug "Copy" gomb és a verzió-felirat (S019-ben lokalizálandó)
