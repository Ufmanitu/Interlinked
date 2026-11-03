# STATE

Utolsó kész lépés: S011
Verzió: S011 · 2026-11-03

## Fájl-index (API)
- index.html: canvas#game 960x540, modul: main.js
- version.js: VERSION, VERSION_DATE
- core-screen.js: VIRTUAL_W/H, TILE, computeScale(w,h), createScreen(canvas) -> {ctx, scale, resize}
- core-input.js: Input (update(), get(p) -> {x,y,interact,ability1,ability2,menu,*Pressed}), setKeys(p,map), setPadButtons(map), DEFAULT_KEYS, DEFAULT_PAD
- core-debug.js: initDebug() (window error/unhandledrejection -> overlay), logError(msg), showReport(title, lines, ok), copyText(t)
- game-player.js: createPlayer(i,x,y), desiredVelocity(p,inp) -> kívánt sebesség px/s, applyVelocity(p,vx,vy,dt) (a tényleges sebességet kívülről kapja; nincs stepPlayer), PLAYER_SIZE/SPEED/COLORS (tiszta logika)
- tether-system.js (S010: k-hook + húzás-stamina): TETHER_CONFIG {walls:[], L:{x:864,y:444}, k:0.5 (BÁZIS), terrain:1, pullStamina:false, khook:K_HOOK, stamina:PULL_STAMINA}, K_HOOK {strengthRef 1, weightRef 1, weightMin .25, weightMax 4, exhaustedMul .5}, PULL_STAMINA {max 100, cost 20/s, regen 15/s, resume .2}, createTetherSystem(cfg) -> {cfg, L, stretch, mode, blocked, k:{a,b} = a k-hook UTÁNI tényleges k, stamina:{a,b:{value,max,exhausted}}}, stepTetherSystem(sys, players, [inp0, inp1], dt) (bemenet -> desiredVelocity -> bázis k -> applyKHook -> computeTether -> ha cfg.walls nem üres: moveWithWalls, különben applyVelocity -> stepPullStamina; p.vx/vy a tényleges sebesség), resolveL(cfg, players); cfg.L/k/pullStamina: szám|objektum|függvény(players), cfg.terrain: szám|függvény(játékos) -> szorzó a HÚZÓ helyén; pullFactor(puller, pulled, terrain, exhausted, h) = erő/strengthRef · clamp(weightRef/(húzott.weight+húzott.load), weightMin..weightMax) · terep · (kimerült ? exhaustedMul : 1); applyKHook(base{a,b}, players, cfg, staminaOn) -> {a,b} 0..1 (k.a: A húzásakor a B súlya/terhe számít, k.b fordítva); ensureStamina(p, cfg) (p.stamina, p.staminaMax, p.exhausted; hibás -> teli), stepPullStamina(players, mode, dt, enabled, cfg) (pull-a/pull-b valamelyik tengelyen = húz -> fogyaszt; kimerül 0-nál, felépül >= resume·max-nál; kikapcsolva mindenki regenerál). Játékos-mezők (opcionálisak, alap 1/1/0): strength, weight, load (az S034 köti az inventory-súlyt p.load-ba; egység: 1 = átlagos test); S120/S151: cfg.terrain ide köt (tiszta logika)
- game-camera.js: CAM_VIEW, CAM_CONFIG {k:6, margin:48}, createCamera(x,y), midpoint(a,b), maxLag(delta,viewSize,margin), stepCamera(cam,a,b,dt,cfg,view) (fps-független simítás + késés-korlát), cameraOffset(cam,view) -> egész pixel bal-felső sarok (tiszta logika)
- tether-logic.js: computeTether({a,b,va,vb,L,k,dt}) -> {a:{x,y}, b:{x,y}, stretch:{x,y}, mode:{x,y}} (a,b: {x,y} pozíció; va,vb: kívánt sebesség px/s; L: szám|{x,y} L_eff; k: szám|{a,b} húzó szerinti szorzó 0..1; dt opcionális: ha adott, a lépés végén sem lépi túl a távolság L-t; mode: free|hold|pull-a|pull-b), tetherAxis(pa,pb,va,vb,L,ka,kb,dt) -> {a,b,stretch,mode}, limitRules(dir,va,vb,ka,kb), TETHER_EPS (tiszta logika; S006 köti be)
- game-collision.js: COLLISION_EPS, bounds(e), collides(e,walls) (érintés nem átfedés), sweepAxis(e,'x'|'y',delta,walls) -> megtehető elmozdulás, constrainPair(pa,pb,ca,cb,L) (póráz-korlát helyreállítása a levágott mozgás után: a kifelé mozgót fékezi, azaz a húzott falnak ütközésekor a húzó is megáll; limit = max(L, jelenlegi táv.)), moveWithWalls(pa,pb,va,vb,dt,walls,L{x,y}) -> blocked {a,b:{x,y}} (x majd y tengely, falra csúszik) (tiszta logika)
- tether-config.js: TetherConfig (S008; tiszta logika, storage injektálható): mezők margin (px, 0..160, lépés 8), lScale (0.1..1, 0.05), k (0..1, 0.05), pullStamina (bool; a húzás-stamina kapcsolója, tether-system.js olvassa), hud (nem mentett); values(), lNormal() = (nézet-2*margó)*lScale, load()/save() (localStorage 'interlinked.tether', {v:1,...}, rossz adat -> alapérték/szorítás, hibázó tároló nem dob), apply(action) -> változott-e (mentés), systemConfig(extra) -> {...extra, L:()=>lNormal, k:()=>k (bázis), pullStamina:()=>pullStamina}, cameraConfig() -> {k, margin (élő getter)}; TETHER_DEFAULTS/LIMITS/KEYS, sanitizeTetherValues, lNormalOf, tetherKeyAction(e), bindTetherConfigKeys(tc,target) -> leválasztó, HUD_TEXT {hu,en} (S019-től i18n; S010: pool, exh kulcsok), tetherHudLines(sys,tc,S) (bekapcsolt húzás-staminánál +1 sor: 'stamina  a x/max  b x/max [kimerült]')
- game-walls.js (S008-ban újragenerálva, mert a repóból hiányzott): ARENA_TILES {w:50,h:30}, wallRect(tx,ty,tw,th), generateWalls(cols,rows) -> [{x,y,w,h}] (keret, válaszfalak átjárókkal, 2x2 oszlopok; greybox, S012-től tile-ok)
- test-collision.js: söprés, csúszás, constrainPair, rendszer-szintű "húzott fal -> húzó megáll", fuzz az arénában (nincs átfedés/NaN, táv. <= max(L, előző))
- test-camera.js: kamera-tesztek (a FILES listában)
- test-player.js: játékos- és póráz-rendszer tesztek (a FILES listában; helper move(p,inp,dt) póráz nélkül); S010: k-hook (erő, súly+teher, terep, képlet, hibás mezők), húzás-stamina (költség, kimerülés, hiszterézis, kapcsoló), fuzz; helperek: atLimit(cfg,mutA,mutB), run(sys,ps,inp,n), PULL_A/PULL_B/STILL
- test-tether.js: póráz-szabályok és határesetek (stretch=1, EPS-tolerancia, mindkettő áll, ellentétes húzás, követés-határ, k-korlátozás, L<=0, átlós, tengelyenkénti L, x/y-szimmetria, bemenet-érintetlenség), tartós szimulációk (holtpont, húzás, követés, szűkülő/táguló L_eff), fuzz-invariánsok; helper: run(pa,pb,frames,Lf,vaf,vbf,ka,kb) egy tengelyt léptet
- test-smoke.js: modulbetöltés + 600 kocka két szkriptelt játékossal (póráz-invariáns: távolság <= L_eff, nincs NaN) + 600 kocka folyamatosan változó L_eff-fel (távolság <= max(L, előző táv.)) + aréna-falak; S008: config-tesztek (alapértékek, lépések/határok, kapcsolók/reset, localStorage + rossz adat, élő k/L a rendszerben, billentyűk, HUD, fuzz) és 600 kocka futásidejű konfig-váltással (nincs NaN/fal-átfedés, táv. <= max(L_eff, előző), játékosok a képben); S010: k-hook + húzás-stamina 600 kockán (TetherConfig kapcsoló, kimerülés, felépülés, HUD); új DOM-független modult vedd fel a MODULES listába
- main.js: STEP=1/60, fix lépésű loop, TetherConfig (tc) -> createTetherSystem(tc.systemConfig({walls})) + stepCamera(.., tc.cameraConfig()), billentyűk (bindTetherConfigKeys), stepTetherSystem (a mozgást a póráz dönti, falakkal), stepTetherVisual, render (ideiglenes rács + falak + drawTether (fonal-görbe sötét körvonallal) + játékosok kamera-offsettel + verzió + FPS + debug HUD: drawTetherHud), initDebug, window.__game {game(players,camera,tether,walls), input, screen, tether, tc, vis}
- tether-visual.js (S009; tiszta logika): VISUAL_CONFIG {segments 24, maxSag 60, sagDist 160, smooth 14, up/down küszöbök (taut .7/.6, critical .98/.92), widths 2/3/4, colors}, LEVELS, tetherTension(sys) -> 0..1 (max stretch, nem 'free' mód -> 1, NaN->0), nextLevel(prev,s,cfg) (hiszterézis), tetherCurve(a,b,s,cfg) -> [{x,y}] (parabola, s=1 egyenes), tetherStyle(s,level,cfg) -> {level,color 'rgb(..)',width}, createTetherVisual() -> {s,level,on(fn)->leiratkozó,emit}, stepTetherVisual(vis,sys,dt) -> események [{type:'level',from,to,s}] (simított s; a hanghoz: vis.on)
- test-tether-visual.js: S009 tesztek (tension, görbe, stílus, hiszterézis, eseménylánc, 600 kockás integráció a póráz-rendszerrel; FILES-ben)
- test-feel.js (S011, a FILES-ben): a M0 playteszt-checklist automata megfelelője, 8 teszt (szabad mozgás, húzás ~k·sebesség + a társ viszi, holtpont, feloldás, követés büntetés nélkül, húzás-stamina 3-8 mp kimerülés / <2,5 mp felépülés, fuzz: táv. <= L_eff + nincs NaN, játékosok a képben húzás/holtpont közben); helperek: setup, run, atLimit
- test-index.js: test(name,fn), assert, eq, near, runAll(), formatResults(); FILES lista a test-*.js fájloknak; Node: `node test-index.js`
- tests.html: futtatja a teszteket, eredmény a képernyőn + Másolás gomb

## Kiosztás
P1: WASD, F interakció, G/H képesség, Q menü. P2: nyilak, , interakció, . / / képesség, ; menü. Pad: A interakció, X/B képesség, Start menü.
Póráz-hangolás (felső számsor): 1/2 L_normal -/+, 3/4 margó -/+, 5/6 k -/+, 7 húzás-stamina kapcsoló, 8 alapértékek, 9 debug HUD ki/be. Mentés: localStorage.

## Szabályok
- Nincs beégetett felhasználói szöveg (i18n az S019-től; core-debug.js S objektuma ideiglenes).
- Új test-*.js: vedd fel a test-index.js FILES listájába.
- A felhasználó csak S185-től tesztel; addig csak feltölt.
- Tesztek Node-ban futtatva (package.json type=module kell hozzá helyben; a repóban nincs). Állapot S008-nál: 87/87 zöld (node test-index.js; config-mutációk elbuktatják: szorítás, mentés, élő k, sys.k); main.js stub-DOM-mal lefuttatva (billentyű -> konfig -> HUD -> localStorage). S007-nél: 78/78 zöld; mutáció (constrainPair kiiktatva) teszteket elbuktat. S006: 58/58. Előző: S005 49/49 (a póráz-tesztek mutáció-ellenőrzöttek: 6 szándékos logika-hiba mindegyikét elbuktatják).
- Ütközés (S007): fal levág, majd a póráz-korlát helyreáll (constrainPair); nincs játékos-játékos ütközés; a falban lévő entitás kimozoghat. A fali tile-ütközés az S012-től tile-alapú adatból jön (ugyanaz a {x,y,w,h} fal-lista).
- Konfig (S008): a hangolható póráz-értékek egy helyen (TetherConfig); L_normal = (nézet-2*margó)*lScale, a kamera ugyanazt a margót használja (lScale <= 1 -> a játékosok a képben maradnak). A k alap a húzó lassítás-szorzója; az S010 k-hook ezt szorozza, az S027 FieldSystem az L_normal-ból lerp-el.
- Póráz: a távolság-szabály tengelyenként él; k = a húzó lassítás-szorzója (placeholder, a valódi k-hook S010); a hívó a saját pozícióit a visszaadott sebességgel lépteti.

- Fonal (S009): a rajz a main.js drawTether-ében (kamera-offset, egész pixel); a szint-váltás hiszterézises, a szín folytonos (laza kék -> feszes sárga -> kritikus piros). Az S010+ hang a vis.on(...) eseményekre kössön.
- Állapot S009-nél: a tether-visual tesztek (8) Node-ban lefutottak zölden; a test-tether-visual integrációs tesztje és a teljes csomag NEM futott (a játékmodulok nem voltak a gépen) -> átnézve (importok, nevek). main.js: node --check rendben.

- k-hook (S010): k = bázis k · húzó ereje · (referencia-súly / húzott súlya+terhe, 0.25..4) · terep (a húzó helyén) · (kimerült húzó: ·0.5), 0..1-re vágva; az alap (identitás) játékosokkal k = bázis. A fal-levágás is húzásnak számít a stamina szempontjából (a mode a döntő). Az S048 az általános staminát (sprint, gyűjtés, HUD) ugyanezekre a p.stamina/staminaMax/exhausted mezőkre építse.
- Állapot S010-nél: 108/108 zöld (node test-index.js, package.json type=module kell helyben); 7 szándékos hiba (súly-szorzó, kimerültség, költség, terep, erő, hiszterézis, kimerült-flag) mindegyikét elbuktatják a tesztek; main.js node --check rendben, main.js nem változott.

- Állapot S011-nél: a M0 playteszt a szabály szerint automata (test-feel.js), a felhasználótól nem kér semmit. A tesztek Node-ban NEM futottak (a játékmodulok nem voltak a gépen) -> átnézve (importok, nevek, számítások a PULL_STAMINA/K_HOOK értékeivel); node --check rendben. Következő futtatáskor ellenőrizd: node test-index.js.

## Hangolt értékek
- póráz (TetherConfig, S008 kezdőérték): margin=48 px, lScale=1 -> L_normal 864x444 px, k=0.5 (placeholder, S010), pullStamina=ki
- k-hook és húzás-stamina (S010 kezdőérték, S011: az automata feel-tesztek alapján változatlan): K_HOOK és PULL_STAMINA lásd fent (5 mp folyamatos húzás után kimerül, 1,3 mp pihenés után felépül); bázis k továbbra is TetherConfig (0.5)
- fonal (S009): lásd VISUAL_CONFIG fent (kezdőértékek, S011-ben változatlan)
- kamera: k=6 (S003), margin = tc.margin (alap 48 px)

## Ismert hibák
- (javítva S008) game-walls.js nem volt a repóban (az S007 feltöltésből kimaradt): a játék nem indult, a tesztek nem töltődtek be. Újragenerálva a fenti API szerint; feltöltés után ellenőrizd a fájllistát.
