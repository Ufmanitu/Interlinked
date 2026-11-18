import { createScreen, VIRTUAL_W, VIRTUAL_H } from './core-screen.js';
import { Input } from './core-input.js';
import { VERSION, VERSION_DATE } from './version.js';
import { initDebug, copyText } from './core-debug.js';
import { createPlayer } from './game-player.js';
import { createPlayerInventories, addItem } from './game-inventory.js';
import { ITEM_TEXTS, ITEM_TEXT_PREFIX } from './data-items.js';
import { INVUI_TEXTS, createInvUi, stepInvUi } from './game-invui.js';
import { drawInventories } from './render-invui.js';
import { syncEncumbrance } from './game-encumbrance.js';
import { WALLET_TEXTS, createPlayerWallets, deposit } from './game-wallet.js';
import { createCamera, stepCamera, cameraOffset } from './game-camera.js';
import { createTetherSystem, stepTetherSystem } from './tether-system.js';
import { TetherConfig, bindTetherConfigKeys, tetherHudLines, HUD_TEXT } from './tether-config.js';
import { i18n, currentLang, changeLang, bindLangKeys, registerTexts, t } from './i18n.js';
import { createTetherVisual, stepTetherVisual, tetherCurve, tetherStyle } from './tether-visual.js';
import { createTileAtlas } from './render-tiles.js';
import { WORLD_SEED, createWorldStream, warmStream, updateStream, streamWalls, findOpenSpot, getStreamTile, solidAtWorldPixel } from './world-stream.js';
import { createChunkRenderer, drawChunks } from './render-chunks.js';
import { createObjectStore, syncObjects, objectColliders, objectCount } from './world-objects.js';
import { createObjectSprites, drawYSorted, drawNodeBars, drawGroundItems } from './render-objects.js';
import { STATION_TEXTS } from './data-stations.js';
import { RECIPE_DEFS } from './data-recipes.js';
import { createRecipeRegistry, getRecipe, craft } from './game-crafting.js';
import { createStationSystem, stationColliders, stationProvider, stepPlaceInput, stationCtx } from './game-stations.js';
import { createStationSprites, visibleStations, drawStation } from './render-stations.js';
import { createGroundItems, stepGround, stepDropInput, dropItem } from './game-grounditems.js';
import { CRAFTUI_TEXTS, createCraftUi, requestCraftOpen, routeCraftInputs, stepCraftUi, invMenus, onCraft, craftTabActive } from './game-craftui.js';
import { drawCraftPanels } from './render-craftui.js';
import { createTrade, stepTrade } from './game-trade.js';
import { TRADEUI_TEXTS, createTradeUi, attachTradeUi, routeTradeInputs, stepTradeUi, tradeMenus, tradeTabActive } from './game-tradeui.js';
import { drawTradeTabs, drawTradeOverlay } from './render-tradeui.js';
import { createInteractSystem, addObjectSource, addProvider, onInteract, stepInteraction, defineInteractable, targetOf } from './game-interact.js';
import { drawInteractPrompts, INTERACT_TEXT } from './render-interact.js';
import { NODE_TEXTS, HERB_CHANCE } from './data-nodes.js';
import { workMul } from './game-stamina.js'; // S048
import { CHARACTER_TEXTS } from './data-character.js'; // S053
import { createCharacterRegistry } from './game-registry.js';
import { applyRace, gatherSpeedMul, raceTerrain, raceOf } from './game-race.js';
import { createAbilitySystem, stepAbilities } from './game-ability.js'; // S054
import { OBSTACLE_TEXTS } from './data-obstacles.js'; // S060
import { createObstacleSystem, obstacleColliders, obstacleProvider, stepObstacles, obstacleView, connectObstacles } from './game-obstacle.js'; // S060: tag-akadályok (eszköz-használat: fejsze kivág, fáklya/sötétlátás nyit)
import { createNodeSystem, stepNodes, nodeInteractables, onNode, gatherView } from './game-nodes.js';
import { SKILL_TEXTS, createSkillSystem, connectSkills, skillsOf, onSkill } from './game-skills.js';
import { PROG_TEXTS, createProgression, connectProgression, onProgress } from './game-curve.js';
import { ACTLOG_TEXTS, createActLog, loadActLog, stepActLog, connectActLog, classifyActivity, bindActLogKeys, exportActLogText, saveActLog } from './game-actlog.js';
import { MENU_TEXTS, createMenuUi, routeMenuInputs, applyMenuClose, stepMenuUi, menuTabActive, maskMenus } from './game-menu.js'; // S049
import { drawMenuPanels } from './render-menu.js'; // S049
import { CHARSELECT_TEXTS, createCharSelect, stepCharSelect, finishCharSelect } from './game-charselect.js'; // S063: karakterválasztó (induláskor)
import { drawCharSelect } from './render-charselect.js'; // S063
import { createAnim, stepAnim } from './game-paperdoll.js'; // S064: paperdoll (irány + séta-animáció)
import { sharedPaperdoll, drawPlayerDoll } from './render-paperdoll.js'; // S064
import { createWarpSystem, warpProvider, warpColliders, handleWarpEvent, stepWarp, streamPoints, warpWhere } from './world-warp.js';
import { visibleHouses, drawHouse, drawPockets } from './render-warp.js';
import { createGameClock, stepClock, clockInfo, bindClockKeys } from './game-clock.js';
import { createDayNight, stepDayNight, drawDayNight, clockLabel, drawClockLabel } from './render-daynight.js';
import { createSplitView, stepSplitView, snapSplitView, splitOffsets, mergeBlend } from './game-splitview.js';
import { createSplitRenderer, beginView, composeSplit } from './render-split.js';
import { sanitizeField, fieldL, fieldValue, fieldShare } from './game-field.js';
import { SORSKO_CONFIG, createSorsko, stepSorsko, sorskoCollider, ringStrength, ringAlpha } from './game-sorsko.js';
import { createSorskoSprites, visibleSorsko, drawSorsko, drawSorskoRing } from './render-sorsko.js';
import { createMenus, stepMenus, missingViewChunks, menuOpen } from './game-hud.js';
import { drawHud } from './render-hud.js';
import { HEALTH_TEXTS, createPlayerHealths, stepPlayerHealths, applyDamage, killHealth, heal as healHealth } from './game-health.js';
import { STATUS_TEXTS, createStatuses, connectStatuses, stepStatuses, applyStatusSpeed, syncStatusesToPlayers, cleanseStatuses, clearStatuses, applyStatus } from './game-status.js'; // S072: státuszhatások (égés, fagy, méreg, lassítás, sötétség)
import { drawStatusIcons, drawDarknessVignette } from './render-status.js';
import { REVIVE_TEXTS, createRevive, onRevive, reviveGate, stepRevive, reviveView } from './game-revive.js'; // S070: elesés, újraélesztés, visszatérés
import { ENEMY_TEXTS, createEnemySystem, spawnEnemy, stepEnemies, enemiesNear, damageEnemy, pushEnemy } from './game-enemy.js'; // S069: ellenfelek + régióhoz kötött spawn + harc
import { createSpawner, stepSpawner, SPAWN_TABLES } from './game-spawn.js';
import { createLoot, connectLoot } from './game-loot.js'; // S071: loot-táblák (ellenség halála -> a földre esik)
import { loadMacroMap } from './world-macro.js';
import { MACRO_MAP } from './data-macro.js';
import { isSolidId } from './world-tiles.js';
import { createCombat, makeHurt, stepCombat, attachCombat } from './game-combat.js';
import { createLash, stepLash } from './game-tetherlash.js'; // S073: póráz mint fegyver (lendítés; opcionális)
import { drawCombat, drawHitFlashes } from './render-combat.js';
import { attachWarrior } from './game-warrior.js';
import { attachWizard, stepWizard, lightSources } from './game-wizard.js';
import { attachRanger, stepRanger, createHiddens, createAnchors } from './game-ranger.js';
import { attachHealer, stepHealer } from './game-healer.js';
import { SAVE_TEXTS, createSaveController, bindSaveKeys, stepSaveToast, runSaveAction } from './game-save.js';

initDebug();
registerTexts(SAVE_TEXTS, 'save.');           // S032: mentés-szövegek (HU/EN)
registerTexts(ITEM_TEXTS, ITEM_TEXT_PREFIX);  // S035: tárgy-nevek (item.<id>)
registerTexts(INVUI_TEXTS, 'inv.');           // S035: inventory UI szövegek (inv.*)
registerTexts(WALLET_TEXTS, 'wallet.');       // S036: pénz-szövegek (wallet.*)
registerTexts(STATION_TEXTS, '');             // S041: obj.<állomás>, act.use
registerTexts(NODE_TEXTS, '');                // S037: obj.herb, act.gather
registerTexts(CRAFTUI_TEXTS, 'craft.');       // S042: craft UI szövegek (craft.*)
registerTexts(SKILL_TEXTS, 'skill.');         // S045: skill-nevek, szintlépés-szöveg (skill.*)
registerTexts(TRADEUI_TEXTS, 'trade.');       // S044: trade UI szövegek (trade.*)
registerTexts(PROG_TEXTS, 'prog.');           // S047: szint-szövegek (prog.*)
registerTexts(ACTLOG_TEXTS, 'actlog.');       // S047: napló-export szövegek (actlog.*)
registerTexts(MENU_TEXTS, 'menu.');           // S049: menü-fülek (térkép, beállítások) szövegei (menu.*)
registerTexts(CHARSELECT_TEXTS, 'charsel.');   // S063: karakterválasztó szövegei (charsel.*)
registerTexts(ENEMY_TEXTS, '');              // S069: enemy.<id>
registerTexts(HEALTH_TEXTS, '');              // S066: health.type.*, health.dead, health.hp
registerTexts(STATUS_TEXTS, '');              // S072: status.<id>
registerTexts(REVIVE_TEXTS, '');              // S070: revive.hold, revive.wipe
registerTexts(OBSTACLE_TEXTS, '');            // S060: obstacle.<id>, obstacle.tag.<TAG>, act.clear
for (const l of ['hu', 'en']) for (const k of Object.keys(OBSTACLE_TEXTS[l])) if (k.startsWith('act.')) INTERACT_TEXT[l][k] = OBSTACLE_TEXTS[l][k]; // S060: a prompt az ideiglenes INTERACT_TEXT-ből olvas
for (const l of ['hu', 'en']) for (const k of Object.keys(STATION_TEXTS[l])) if (k.startsWith('act.')) INTERACT_TEXT[l][k] = STATION_TEXTS[l][k];
for (const l of ['hu', 'en']) for (const k of Object.keys(NODE_TEXTS[l])) if (k.startsWith('act.')) INTERACT_TEXT[l][k] = NODE_TEXTS[l][k]; // a prompt még az ideiglenes INTERACT_TEXT-ből olvas

export const STEP = 1 / 60; // fix 60 Hz logikai lépés
const MAX_FRAME = 0.25;     // spirál-védelem

const canvas = document.getElementById('game');
const screen = createScreen(canvas);
const input = new Input();

// Chunk-világ (S014): a kezdőhely a (0,0) körüli első nyitott terület; a falak a betöltött chunkokból jönnek.
const spot = findOpenSpot(WORLD_SEED, 0, 0) || { x: 16, y: 16 };
const SPAWN = [[spot.x - 70, spot.y], [spot.x + 70, spot.y]];
const players = SPAWN.map(([x, y], i) => createPlayer(i, x, y));
registerTexts(CHARACTER_TEXTS, ''); // S053: faj-nevek és leírások (race.<id>, race.<id>.desc)
const charReg = createCharacterRegistry(); // S053: fajok (törpe, tünde, ork); kasztok S055-től
applyRace(charReg, players[0], 'dwarf'); // S053: alap-fajok arra az esetre, ha a karakterválasztó kimarad; S063: a választó az induláskor felülírja (faj + kaszt)
applyRace(charReg, players[1], 'elf');
let selStore = null;
try { selStore = typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { selStore = null; }
const select = createCharSelect(charReg, { storage: selStore }); // S063: induláskor két játékos: faj + kaszt (a legutóbbi választás előre kijelölve, localStorage 'interlinked.chars'); a faj/kaszt mentés-fájlba kerülése később
const abilities = createAbilitySystem({ reg: charReg }); // S054: képesség-végrehajtó (2 gomb = a kaszt első két képessége; kasztok S055-től; hatás: onAbility/setAbilityHandler)
const wallets = createPlayerWallets(); // S036: játékosonként külön pénz (HUD; S050: mentve)
const inventories = createPlayerInventories(); // S034: játékosonként külön inventory; az összsúly a p.load-ba és a p.speedMul-ba kerül (az UI az S035-ben)
const ground = createGroundItems(); // S039: a földre dobott tárgyak (mágnes-felvétel, stackelés, eltűnés); inventory-eldobás: menü nyitva + 2. képesség fogott tárgy nélkül
const camera = createCamera((players[0].x + players[1].x) / 2, (players[0].y + players[1].y) / 2);
// Két nézet (S023): két kamera (mindkettő a saját játékosán), két offscreen canvas, fix függőleges osztás.
// S025: |Δ| <= 0,85·L_normal -> a két nézet egy közös képet ad (nincs osztóvonal); |Δ| > L_normal -> szétválás (hiszterézis + simított átmenet).
const split = createSplitView(players);
const splitRend = createSplitRenderer(split.layout);
const offs = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
const world = createWorldStream(WORLD_SEED);
warmStream(world, players);
// Objektumok (S015): fa, kő (S037: + gyógynövény); a kezdőhely körül szabad terület marad; az ütközők a falak közé kerülnek.
const objects = createObjectStore(WORLD_SEED, { keepFree: [{ x: spot.x, y: spot.y, r: 224 }], cfg: { herbChance: HERB_CHANCE } });
syncObjects(objects, world);
const objSprites = createObjectSprites();
const interact = createInteractSystem();     // S016: interakciós zóna, célpont, egy gomb; a tárgyak a forrásból jönnek
addObjectSource(interact, objects);
const nodes = createNodeSystem(objects, { seed: WORLD_SEED, hooks: { speed: (p, node) => { const pl = typeof p === 'number' ? players[p] : p; return workMul(pl, tether.cfg.act) * gatherSpeedMul(charReg, pl, node && node.type); }, power: () => 1 } }); // S037: gyűjthető node-ok (fa, kő, gyógynövény): tartott interakció-gomb -> ütések -> drop az inventoryba, újranövés a játékidővel
for (const [type, def] of Object.entries(nodeInteractables(nodes))) defineInteractable(interact, type, def); // akció: 'gather'
const stations = createStationSystem();       // S041: felállítható craft-állomások (munkapad, kemence, főzőhely): ütköző, 'use' célpont, TAG a közelben álló játékosnak (a mentés az S050-ben)
addProvider(interact, stationProvider(stations));
const stationSprites = createStationSprites(stations.reg);
const obstacles = createObstacleSystem(undefined, { anchor: spot }); // S060: IDEIGLENES példa-akadályok a kezdőhely két oldalán (S097/S098 adja a valódi helyet); a mentés még nincs kötve (feloldás: obstacleState/restoreObstacles)
addProvider(interact, obstacleProvider(obstacles));
const tagsOf = i => { const r = raceOf(charReg, players[i]); return r ? r.tags : []; }; // faj-tag-ek (SÖTÉTLÁTÁS...); a tárgy-tag-eket (FÁKLYA, FEJSZE) a stepObstacles az inventoryból olvassa
const recipes = createRecipeRegistry(RECIPE_DEFS, inventories[0].reg); // S041: receptek (a window.__game.craft(i, recept, db) fejlesztői segéd megmaradt)
// S042: craft UI = a játékos menüjének 2. füle (menü gomb: inventory -> craft -> zár); az állomás 'use' interakciója a craft fülön nyitja a menüt.
// Lista: kézzel craftolható + a közeli állomások (stationCtx) receptjei; az állomás neve az 'obj.<id>' szövegből.
const stationTagKeys = new Map();
if (stations.reg && stations.reg.stations) for (const d of stations.reg.stations.values()) stationTagKeys.set(d.tag, 'obj.' + d.id);
const skills = createSkillSystem();           // S045: skillek (használattal nőnek): a gyűjtés és a craft XP-t ad (mentés az S050-ben)
const craftUi = createCraftUi({ recipes, ctxOf: i => stationCtx(stations, players[i], skillsOf(skills, i)), tagKey: tag => stationTagKeys.get(tag) || null });
onInteract(interact, ev => { if (ev.kind === 'station' && ev.action === 'use') requestCraftOpen(craftUi, ev.player); });
connectSkills(skills, { nodes, craftUi, recipes }); // S045: XP-busz (node 'depleted' + craft UI 'craft')
// S047: globális szint (a skill-XP összege) + tevékenység-idő napló (localStorage 'interlinked.actlog'; F6 = mentés + másolás vágólapra)
const prog = createProgression();
connectProgression(prog, fn => onSkill(skills, fn));
let logStore = null;
try { logStore = typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { logStore = null; }
const actlog = createActLog({ storage: logStore });
if (logStore) loadActLog(actlog); // a korábbi ülések naplója folytatódik (törlés: clearActLog)
connectActLog(actlog, { skill: fn => onSkill(skills, fn), node: fn => onNode(nodes, fn), craft: fn => onCraft(craftUi, fn), prog: fn => onProgress(prog, fn), time: () => clock.t });
function activityOf(i) { // a játékos jelenlegi tevékenysége a napló számára
  const open = menuOpen(menus, i);
  const tab = !open || menuTabActive(menuUi, menus, i) ? null : tradeTabActive(tradeUi, trade, menus, i) ? 'trade' : craftTabActive(craftUi, menus, i) ? 'craft' : 'inv';
  const p = game.players[i];
  return classifyActivity({ tab, menuOpen: open, gathering: gatherView(nodes, i) != null, moving: !!p && Math.abs(p.vx || 0) + Math.abs(p.vy || 0) > 1 });
}
// S044: trade UI = a menü 3. füle (menü gomb: inventory -> craft -> trade -> zár); a kérés a társ 2. képességével utasítható el; nyitott trade-ben két kurzor.
const trade = createTrade();
const tradeUi = createTradeUi();
attachTradeUi(tradeUi, trade);
const tradeCtx = { players, inventories, wallets };
const warp = createWarpSystem({ anchor: spot }); // S017: kinti házak + beltér-zsebek (data-warps.js); páros be-/kilépés
addProvider(interact, warpProvider(warp));
onInteract(interact, ev => {
  if (ev.kind !== 'warp' || !handleWarpEvent(warp, players, ev)) return;
  camera.x = (players[0].x + players[1].x) / 2; // a kamera a pár után ugrik (nincs végigsimítás a zsebig)
  camera.y = (players[0].y + players[1].y) / 2;
  snapSplitView(split, players, tc.lNormal()); // a két nézet is a párhoz ugrik (és az összeolvadás állapota újraszámolódik)
});
const menus = createMenus();                   // S029: játékosonkénti real-time menü váz (a karakter áll, a pórázon húzható)
const invUi = createInvUi();                   // S035: inventory UI állapot (játékosonként kurzor + kijelölés)
const clock = createGameClock();               // S018: játékidő (nap/fázis, hookok: onClock); PageUp/PageDown/End: sebesség
bindClockKeys(clock);
const dn = createDayNight();                   // S018: nap/éjszaka színezés (beltérben halványabb)
// S027/S028: a Sorskő mezője a pórázban (L_eff = lerp(L_normal, L_falu, min(f(A), f(B)))); a sugarat a Sorskő szintje adja (SORSKO_CONFIG.levels)
const field = sanitizeField({ id: 'sorsko', x: spot.x, y: spot.y, radius: SORSKO_CONFIG.levels[0] });
const sorsko = createSorsko(field);
const sorskoSprites = createSorskoSprites();
let ringA = 0;                                   // a határ-gyűrű alfája (képkockánként számolva)
const walls = [];                              // helyben frissítjük (a póráz-rendszer ugyanezt a tömböt olvassa)
let wallsKey = '';
function refreshWalls() {
  const key = world.version + '|' + objects.version + '|' + stations.version + '|' + obstacles.version;
  if (key === wallsKey) return;
  wallsKey = key;
  walls.length = 0;
  for (const r of streamWalls(world)) walls.push(r);
  for (const r of objectColliders(objects)) walls.push(r);
  stationColliders(stations, walls); // S041: a lerakott állomások talpa
  obstacleColliders(obstacles, walls); // S060: az el nem hárított akadályok (zárt sötét átjáró, bozót)
  warpColliders(warp, walls); // házak, zseb-falak, ütköző bútorok
  walls.push(sorskoCollider(sorsko)); // a Sorskő talpa
}
refreshWalls();
const atlas = createTileAtlas();
const chunkRend = createChunkRenderer(atlas, { maxCanvases: 8 }); // két nézet: legfeljebb 2x4 chunk
const tc = new TetherConfig();                 // hangolható póráz-értékek (localStorage), billentyűk: 1-9
// S027: a split-view továbbra is L_normal-t kap; a póráz L_eff-je a mezőből jön.
const sysCfg = tc.systemConfig({ walls, field });
sysCfg.L = fieldL(field, () => tc.lNormal());
sysCfg.terrain = raceTerrain(charReg); // S053: erdei mozgás (a terep-fajtát az S120/S151 adja); alap szorzó 1
const tether = createTetherSystem(sysCfg);
const camCfg = tc.cameraConfig();
bindTetherConfigKeys(tc);
snapSplitView(split, players, tc.lNormal()); // induláskor az összeolvadás állapota a játékosok távolságából
bindLangKeys(i18n, window);                    // S019: F8 = nyelvváltás HU/EN (az S107 menü átveszi)
const vis = createTetherVisual();              // a fonal megjelenített állapota; vis.on(fn): szint-események (hanghoz)
// S032/S050: mentés (F2 mentés, F3 betöltés, F4 export vágólapra, F7 import beillesztéssel; a menü beállítások-füle is hívja). A mentett állapot: játékos-pozíciók, seed, GameClock, Sorskő-szint,
// inventory, pénz, skillek, karakter-szint, kitermelt node-ok, lerakott állomások (a földre dobott tárgyak és a gyűjtés közbeni sérülés nem mentett).
function afterLoad() {
  camera.x = (players[0].x + players[1].x) / 2; // a kamera, a nézetek és a chunkok a betöltött helyhez ugranak
  camera.y = (players[0].y + players[1].y) / 2;
  warmStream(world, streamPoints(warp, players));
  syncObjects(objects, world);
  wallsKey = '';
  refreshWalls();
  snapSplitView(split, players, tc.lNormal());
}
const saveCtl = createSaveController({ players, clock, sorsko, seed: WORLD_SEED, inventories, wallets, skills, prog, nodes, stations }, {
  copy: copyText, ask: key => (typeof window !== 'undefined' && window.prompt ? window.prompt(t(key)) : null), onLoaded: afterLoad,
});
bindSaveKeys(saveCtl);
bindActLogKeys(actlog, { copy: copyText, tr: (k, p) => t('actlog.' + k, p) }, window); // S047: F6 napló-export
// S049: egységes menükezelő: a menü gomb körforgása inventory -> craft -> trade -> térkép -> beállítások -> zár; a beállítások-fül gombjai a meglévő F-billentyűs funkciókat hívják
const bg = p => { try { Promise.resolve(p).catch(e => { menuUi.lastError = e; }); } catch (e) { menuUi.lastError = e; } };
const menuUi = createMenuUi({ actions: {
  lang: () => changeLang(currentLang() === 'hu' ? 'en' : 'hu'),
  save: () => bg(runSaveAction(saveCtl, 'save')),
  load: () => bg(runSaveAction(saveCtl, 'load')),
  export: () => bg(runSaveAction(saveCtl, 'export')),
  import: () => bg(runSaveAction(saveCtl, 'import')),
  log: () => { saveActLog(actlog); copyText(exportActLogText(actlog, (k, p) => t('actlog.' + k, p))); },
} });
const anims = [createAnim(), createAnim()]; // S064: játékosonként irány + séta-képkocka
const paperdoll = sharedPaperdoll(); // S064: a karakterválasztó előnézetével közös cache
const healths = createPlayerHealths(players); // S066: játékosonként Health; p.hp/p.hpMax/p.dead a HUD-nak
// S070: az elesett játékos nem game over: a társ a közelben tartott interakció-gombbal élesztheti (a gyógyító 2x gyorsabban); mindketten elesve / lejárt idő -> vissza a Sorskőhöz (kis pénz-büntetés)
const statuses = createStatuses({ healths });  // S072: játékosonkénti státuszok (időzítő, halmozás, DoT a Health-en át); a sebzés-esemény státuszt ad
connectStatuses(statuses);
const revival = createRevive({ checkpoint: { id: 'sorsko', x: spot.x, y: spot.y } });
let wipeToast = 0; // mp: a visszatérés üzenete
onRevive(revival, ev => { if (ev.type === 'down') clearStatuses(statuses, ev.player, 'down'); if (ev.type === 'wipe') { clearStatuses(statuses, undefined, 'wipe'); wipeToast = 3; afterLoad(); } }); // a kamera, a nézetek és a chunkok a ponthoz ugranak
// S069: ellenfelek (rácsos A* AI), régióhoz kötött spawn, harc (hitbox/lövedék/visszalökés) és a kaszt-képességek hatása (a class-modulok UTÁN az attachCombat).
const es = createEnemySystem({ seed: WORLD_SEED });
const combat = createCombat();
const loot = createLoot({ seed: WORLD_SEED });      // S071: súlyozott, szint-függő drop-táblák; a szint a spawn-táblából (levels közepe)
connectLoot(loot, es, { ground, spawnTables: SPAWN_TABLES }); // az ellenség 'died' eseményére: a loot a holttest helyére esik (felvétel: a mágnes)
const spawner = createSpawner({ mm: loadMacroMap(MACRO_MAP), seed: WORLD_SEED });
const solidTile = (tx, ty) => { const id = getStreamTile(world, tx, ty); return id < 0 || isSolidId(id); }; // nem betöltött chunk = ütköző
const hurt = makeHurt(combat, { players, healths });
const spawnSafe = () => [{ x: field.x, y: field.y, r: field.radius + 160 }]; // a Sorskő-mezőben és a határsáv körül nincs spawn
const abEnv = { players, enemies: (o, r) => enemiesNear(es, o, r), damage: (e, a, info) => damageEnemy(es, e, a, info), push: (e, dx, dy, d) => pushEnemy(e, dx, dy, d, walls), solid: (x, y) => solidAtWorldPixel(world, x, y) };
attachWarrior(abilities, { ...abEnv, breakables: obstacles.breakables });
const wizard = attachWizard(abilities, { ...abEnv, flammables: obstacles.flammables });
const ranger = attachRanger(abilities, { ...abEnv, hiddens: createHiddens([]), anchors: createAnchors([]) });
const healer = attachHealer(abilities, { players, heal: (p, n) => healHealth(healths[p.index], n), cleanse: (p, info) => cleanseStatuses(statuses, info.target) }); // S072: a tisztítás a státuszokat oldja
attachCombat(abilities, combat, { players }); // felülírja a strike/shoot kezelőjét
const lash = createLash(); // S073: a feszes, forgó fonal megsebzi az ellenséget (a visszalökés a póráz-rendszerben külön lépés: tether.knock)
connectObstacles(obstacles, abilities); // ÉGETÉS/TÖRÉS/ROBBANTÁS képesség-tag -> akadály
const game = { revival, lash, es, loot, combat, spawner, healths, anims, paperdoll, select, obstacles, abilities, menuUi, prog, actlog, skills, craftUi, tradeUi, trade, stations, time: 0, ticks: 0, fps: 0, players, inventories, wallets, ground, camera, split, tether, walls, world, objects, interact, warp, clock, field, sorsko, menus, invUi, nodes };
const drawList = [];                           // y-sort lista: játékosok + látható házak

function update(dt) {
  input.update();
  if (!select.done) { // S063: a választás alatt a világ áll; ha mindketten készek, a faj + kaszt ráállítódik, és indul a játék
    stepCharSelect(select, [input.get(0), input.get(1)], dt);
    if (select.done) finishCharSelect(select, game.players);
    return;
  }
  stepWarp(warp, dt);
  stepClock(clock, dt);
  stepSorsko(sorsko, dt);
  stepDayNight(dn, warpWhere(warp, game.players) ? 1 : 0, dt);
  updateStream(world, streamPoints(warp, game.players)); // a zsebben lévő játékos helyett a kinti kilépési pont
  syncObjects(objects, world);
  refreshWalls(); // a betöltött chunkok/objektumok változtak -> falak újraépítése (ugyanabban a tömbben)
  const raw = [input.get(0), input.get(1)];
  const mroute = routeMenuInputs(menuUi, tradeUi, craftUi, trade, menus, raw); // S049: a trade fül utáni két fül (térkép, beállítások) és a zárás; az extra fülön a lánc üres bemenetet kap
  const route = applyMenuClose(menuUi, routeCraftInputs(craftUi, menus, routeTradeInputs(tradeUi, trade, craftUi, menus, mroute.raws))); // S042: menü-fül körforgás (inventory -> craft -> zár); a craft fülön az inventory-rendszerek üres bemenetet kapnak
  const inputs0 = stepMenus(menus, route.menu);
  const inputs = reviveGate(revival, inputs0, game.players); // S070: az elesett bemenete üres, az élesztő gombja el van nyelve
  // nyitott menünél a karakter áll (nincs mozgás/interakció), de a pórázon húzható
  stepDropInput(ground, invUi, menus, route.inv, game.inventories, game.players); // S039: eldobás a stepInvUi ELŐTT (a fogás/kijelölés állapota még a régi)
  const placed = stepPlaceInput(stations, invUi, menus, route.inv, game.inventories, game.players, [interact.players[0] && interact.players[0].facing, interact.players[1] && interact.players[1].facing], walls); // S041: felállítás (menü nyitva, 1. képesség a kurzor alatti állomás-tárgyon); a gombnyomást elnyeli
  stepInvUi(invUi, menus, placed.raws, game.inventories, dt); // S035: az inventory UI a NYERS bemenetet kapja (a szűrt nyitva nullázott)
  stepTradeUi(tradeUi, trade, tradeCtx, menus, raw, dt); // S044: trade UI (kérés, két kurzor, elfogad/megerősít); a stepTrade ELŐTT
  stepTrade(trade, tradeCtx, dt); // S044: távolság-ellenőrzés, kérés-időtúllépés, elfogyó tárgy levágása
  stepMenuUi(menuUi, menus, raw, dt); // S049: beállítások-fül (kurzor, akciók); a NYERS bemenettel
  stepCraftUi(craftUi, menus, raw, game.inventories, dt); // S042: craft fül (a stepMenus UTÁN, a teher-szinkron ELŐTT; a NYERS bemenettel)
  stepGround(ground, game.players, game.inventories, dt, walls); // S039: dobás-mozgás, mágnes-felvétel, összevonás, eltűnés (a teher-szinkron ELŐTT)
  syncEncumbrance(game.players, game.inventories); applyStatusSpeed(statuses, game.players); // S072: a státusz-lassítás a teher UTÁN szorzódik (a teher kockánként újraírja a p.speedMul-t)
  // a teher (p.load a k-hookba, p.speedMul a saját sebességbe) a póráz-lépés előtt
  stepTetherSystem(tether, game.players, inputs, dt);
  stepInteraction(interact, game.players, inputs, dt); // a mozgás után: a zóna a végleges pozícióhoz igazodik
  for (let i = 0; i < 2; i++) stepAnim(anims[i], game.players[i], interact.players[i] && interact.players[i].facing, dt); // S064: a tényleges sebesség (póráz után) + facing
  stepAbilities(abilities, game.players, inputs, [interact.players[0] && interact.players[0].facing, interact.players[1] && interact.players[1].facing], dt, { inventories: game.inventories }); // S054: képesség-gombok (a SZŰRT bemenet: nyitott menünél nincs használat)
  stepNodes(nodes, game.players, inputs, [targetOf(interact, 0), targetOf(interact, 1)], game.inventories, clock.t, dt); // S037: gyűjtés (a SZŰRT bemenet: nyitott menünél nincs interakció)
  stepObstacles(obstacles, dt, { players: game.players, inventories: game.inventories, inputs, targets: [targetOf(interact, 0), targetOf(interact, 1)], tagsOf, lights: () => lightSources(wizard) }); // S060 (S069: a varázsló fénye nyitja a sötét átjárót): kivágás (tartott gomb, fejsze) és sötét átjáró (fáklya/sötétlátás); a SZŰRT bemenettel
  game.players.forEach((p, i) => { p.gathering = gatherView(nodes, i) != null; }); // S048: a gyűjtés a következő kockában fogyaszt staminát (tether-system)
  stepWizard(wizard, dt); stepRanger(ranger, dt); stepHealer(healer, dt); // S069: fény/égés/fagy, jelölés/kötél, pajzs lejárat
  stepSpawner(spawner, es, streamPoints(warp, game.players), dt, { tileAt: (tx, ty) => getStreamTile(world, tx, ty), walls, safe: spawnSafe }); // S069: régió-spawn (a játékosoktól 640-1800 px-re)
  stepEnemies(es, game.players, dt, { walls, solidTile, healths, hurt }); // S069: AI -> a támadás a combat.hurt-ön át (i-frame, visszalökés)
  stepLash(lash, { players: game.players, enemySys: es, tether, combat }, dt); // S073: póráz-lendítés (a stepTetherSystem UTÁN: p.vx/vy a tényleges sebesség; a stepCombat ELŐTT: a visszalökést ez a kocka lépi)
  stepCombat(combat, { players: game.players, healths, enemySys: es, walls }, dt); // S068: hitbox/lövedék/visszalökés (a stepEnemies UTÁN)
  stepStatuses(statuses, dt); syncStatusesToPlayers(statuses, game.players); // S072: időzítők, DoT (a Health-en át), p.statuses/p.statusFx; a stepRevive ELŐTT: a DoT-halált még ebben a kockában észleli
  stepRevive(revival, { players: game.players, healths, wallets, inputs: inputs0, speed: j => (game.players[j].class === 'healer' ? 2 : 1) }, dt); // S070: elesés-észlelés, élesztés, visszatérés (a Health-szinkron ELŐTT)
  if (wipeToast > 0) wipeToast -= dt;
  stepPlayerHealths(healths, game.players, dt); // S066: i-frame időzítő + p.hp/p.hpMax/p.dead szinkron (a HUD ezt olvassa)
  stepActLog(actlog, dt, [activityOf(0), activityOf(1)]); // S047: tevékenység-idő napló
  stepTetherVisual(vis, tether, dt);
  stepCamera(game.camera, game.players[0], game.players[1], dt, camCfg);
  stepSplitView(split, game.players, dt, camCfg, tc.lNormal(), fieldShare(field, game.players[0], game.players[1]) <= 0); // L_normal: az összeolvadás küszöbei ehhez mérve; falun kívül (tight) r <= 1-nél már összeolvad (S030)
  stepSaveToast(saveCtl, dt);
  game.time += dt;
  game.ticks++;
}

// A fonal: lazán lógó görbe, a szín és a vastagság a feszülés szerint (laza/feszes/kritikus).
function drawTether(ctx, o) {
  const [a, b] = game.players;
  const pts = tetherCurve(a, b, vis.s);
  const st = tetherStyle(vis.s, vis.level);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const path = () => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = Math.round(p.x) - o.x, y = Math.round(p.y) - o.y;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
  };
  path();
  ctx.strokeStyle = 'rgba(8,12,20,0.55)'; // sötét körvonal az olvashatóságért
  ctx.lineWidth = st.width + 2;
  ctx.stroke();
  path();
  ctx.strokeStyle = st.color;
  ctx.lineWidth = st.width;
  ctx.stroke();
}

// Debug HUD: póráz-értékek (stretch tengelyenként, k, L_eff) és a konfig; a 9-es billentyű ki/be kapcsolja.
function drawTetherHud(ctx, x, y) {
  const lines = tetherHudLines(tether, tc, HUD_TEXT[currentLang()] || HUD_TEXT.hu);
  const [pa, pb] = game.players; // S027: mező-érték játékosonként és a közös s = min(f(A), f(B))
  lines.splice(lines.length - 1, 0, `field    f(a) ${fieldValue(field, pa).toFixed(2)}  f(b) ${fieldValue(field, pb).toFixed(2)}  s ${fieldShare(field, pa, pb).toFixed(2)}`);
  const lh = 14;
  ctx.font = '12px monospace';
  ctx.textBaseline = 'top';
  let w = 0;
  for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  ctx.fillStyle = 'rgba(8,12,20,0.6)';
  ctx.fillRect(x - 4, y - 4, Math.ceil(w) + 8, lines.length * lh + 8);
  ctx.fillStyle = tether.stretch.x >= 0.999 || tether.stretch.y >= 0.999 ? '#ffb45a' : '#9fb4d0'; // a korlátnál borostyán
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
}

function drawEntity(ctx, e, ox, oy) {
  if (e.warp) drawHouse(ctx, e.warp, ox, oy);
  else if (e.station) drawStation(ctx, stationSprites, e, ox, oy);
  else if (e.sorsko) drawSorsko(ctx, sorskoSprites, e.sorsko, ox, oy);
  else if (e.enemy) drawEnemy(ctx, e.enemy, ox, oy); // S069
  else drawPlayer(ctx, e, ox, oy);
}

// Ellenfelek (S069 greybox; az S103 sprite-ra cseréli): típusonként szín, fagyott = világoskék, felütés közben pirosan villan.
const ENEMY_STYLE = { boar: ['#7a4a2a', '#c98a5a'], field_rat: ['#6b6b6b', '#b0a090'], grunt: ['#8a3030', '#d06060'] };
function drawEnemy(ctx, e, ox, oy) {
  const [c1, c2] = ENEMY_STYLE[e.type] || ['#884488', '#cc88cc'];
  const x = Math.round(e.x - e.w / 2) - ox, y = Math.round(e.y - e.h / 2) - oy;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x, y + e.h - 3, e.w, 4);
  ctx.fillStyle = e.frozen > 0 ? '#9fd8ff' : c1; ctx.fillRect(x, y, e.w, e.h);
  ctx.fillStyle = c2; ctx.fillRect(x + 2, y + 2, Math.max(1, e.w - 4), 3);
  if (e.atk && e.atk.phase === 'windup') { ctx.fillStyle = 'rgba(255,60,40,0.55)'; ctx.fillRect(x, y, e.w, e.h); }
}

function drawPlayer(ctx, p, ox, oy) {
  if (p.dead) ctx.globalAlpha = 0.45; // S070: az elesett karakter halvány
  try { drawPlayerBody(ctx, p, ox, oy); } finally { ctx.globalAlpha = 1; }
}

function drawPlayerBody(ctx, p, ox, oy) {
  if (drawPlayerDoll(ctx, paperdoll, p, anims[p.index] || anims[0], ox, oy)) return; // S064: rétegezett karakter; hiba esetén a greybox négyzet
  ctx.fillStyle = p.color;
  ctx.fillRect(Math.round(p.x - p.w / 2) - ox, Math.round(p.y - p.h / 2) - oy, p.w, p.h);
}

// Egy nézet rajza a saját offscreen ctx-re (0,0 = a nézet bal-felső sarka; o = az adott kamera offsetje).
// Akadályok (S060 greybox): zárt bozót = zöldesbarna, zárt sötét átjáró = sötét; a kivágás-sáv a játékosonként (sárga = megy, piros = jobb eszköz kell).
function drawObstacles(ctx, o, vw, vh) {
  for (const r of obstacles.items.values()) {
    if (r.kind === 'blocked' ? r.cleared : r.open) continue;
    const x = Math.round(r.x) - o.x, y = Math.round(r.y) - o.y;
    if (x > vw || y > vh || x + r.w < 0 || y + r.h < 0) continue;
    ctx.fillStyle = r.kind === 'blocked' ? '#3d5a2a' : '#12121c';
    ctx.fillRect(x, y, r.w, r.h);
    ctx.strokeStyle = r.kind === 'blocked' ? '#6f8f45' : '#4a4a7a';
    ctx.strokeRect(x + 0.5, y + 0.5, r.w - 1, r.h - 1);
  }
  for (let i = 0; i < 2; i++) {
    const v = obstacleView(obstacles, i), r = v ? obstacles.items.get(v.id) : null;
    if (!r) continue;
    const bw = Math.max(24, Math.min(64, r.w)), x = Math.round(r.x + r.w / 2 - bw / 2) - o.x, y = Math.round(r.y) - o.y - 8;
    ctx.fillStyle = 'rgba(8,12,20,0.7)'; ctx.fillRect(x - 1, y - 1, bw + 2, 6);
    ctx.fillStyle = v.locked ? '#d85a4a' : '#e8c24a'; ctx.fillRect(x, y, Math.round(bw * (v.locked ? 1 : v.ratio)), 4);
  }
}

// S070 (greybox): az elesett játékos fölött a hátralévő idő, az élesztés-sáv és a súgó
function drawRevive(ctx, o, vw, vh) {
  for (let i = 0; i < 2; i++) {
    const v = reviveView(revival, i), p = game.players[i];
    if (!v.downed || !p) continue;
    const cx = Math.round(p.x) - o.x, y = Math.round(p.y - p.h / 2) - o.y - 30;
    if (cx < -80 || cx > vw + 80 || y < -40 || y > vh + 40) continue;
    ctx.font = '10px monospace'; ctx.textBaseline = 'bottom'; ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff'; ctx.fillText(`${t('health.dead')} ${Math.ceil(v.secs)}`, cx, y - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText(t('revive.hold'), cx, y - 1);
    ctx.fillStyle = 'rgba(8,12,20,0.7)'; ctx.fillRect(cx - 21, y + 1, 42, 6);
    ctx.fillStyle = '#e8c24a'; ctx.fillRect(cx - 20, y + 2, Math.round(40 * v.progress), 4);
    ctx.textAlign = 'left';
  }
}

function renderView(ctx, o, vw, vh, ci) {
  drawChunks(ctx, chunkRend, world, o.x, o.y, vw, vh);
  drawPockets(ctx, warp, o.x, o.y, vw, vh);
  drawSorskoRing(ctx, sorsko, ringA, o.x, o.y, vw, vh); // halvány határ-gyűrű, a határhoz közeledve erősödik
  drawGroundItems(ctx, ground, o.x, o.y, vw, vh); // S039: a földi tárgyak a fonal alatt, a y-sorted objektumok alatt
  drawObstacles(ctx, o, vw, vh); // S060: greybox (S103/S121 cseréli)
  drawTether(ctx, o);
  drawList.length = 0;
  for (const p of game.players) drawList.push(p);
  visibleHouses(warp, o.x, o.y, vw, vh, drawList);
  visibleSorsko(sorsko, o.x, o.y, vw, vh, drawList);
  visibleStations(stations, o.x, o.y, vw, vh, drawList); // S041
  for (const e of es.list) if (e.x + 40 > o.x && e.x - 40 < o.x + vw && e.y + 40 > o.y && e.y - 40 < o.y + vh) drawList.push({ enemy: e, x: e.x, y: e.y, w: 0, h: e.h }); // S069: y-sort a lábpont szerint (y + h/2)
  drawYSorted(ctx, objSprites, objects, drawList, o.x, o.y, vw, vh, drawEntity);
  drawCombat(ctx, combat, o.x, o.y, vw, vh, { debug: tc.hud }); // S068/S069: ütés-ív, lövedék, szikra
  drawHitFlashes(ctx, combat, o.x, o.y, vw, vh);
  drawRevive(ctx, o, vw, vh); // S070
  drawDarknessVignette(ctx, statuses, game.players, o.x, o.y, vw, vh); // S072: sötétség-státusz: a játékos körül szűkül a látótáv
  drawDayNight(ctx, dn, ci.minuteOfDay, vw, vh); // a promptok a színezés fölé kerülnek
  drawInteractPrompts(ctx, interact, o.x, o.y, vw, vh, { debug: tc.hud, lang: currentLang() }); // promptok a tárgyak fölött, zónák a debug HUD-dal
  drawNodeBars(ctx, nodes, o.x, o.y, vw, vh); // S037: gyűjtés-sáv a célpont lába alatt
}

function render() {
  const ctx = screen.ctx;
  if (!select.done) { drawCharSelect(ctx, select, VIRTUAL_W, VIRTUAL_H, t); return; } // S063: karakterválasztó a játék helyett
  const ci = clockInfo(clock);
  ringA = ringAlpha(sorsko, ringStrength(sorsko, game.players));
  splitOffsets(split, offs);
  for (let i = 0; i < 2; i++) {
    const v = split.layout.views[i];
    renderView(beginView(splitRend, i), offs[i], v.w, v.h, ci);
  }
  composeSplit(ctx, splitRend, mergeBlend(split)); // a két nézet + (az összeolvadással halványuló) osztóvonal a fő vászonra; a HUD/számláló fölé kerül
  ctx.font = '12px monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#9fb4d0';
  ctx.fillText(`Interlinked ${VERSION} (${VERSION_DATE})  FPS ${game.fps.toFixed(0)}  chunk ${world.chunks.size}/${chunkRend.cache.size}  obj ${objectCount(objects)}  nod ${nodes.depleted.size}  gnd ${ground.items.length}  en ${es.list.length}  int ${interact.total}  warp ${warpWhere(warp, game.players) || '-'}  mrg ${mergeBlend(split).toFixed(2)}  vch ${warpWhere(warp, game.players) ? 0 : missingViewChunks(world, offs, split.layout)}`, 8, 8);
  drawClockLabel(ctx, clockLabel(ci, currentLang(), clock.speed), VIRTUAL_W);
  const hudMenus = maskMenus(menuUi, tradeMenus(tradeUi, trade, menus)); // S044: a trade fülön / nyitott trade-ben a menü-váz nem látszik
  drawHud(ctx, game.players, hudMenus, VIRTUAL_W, VIRTUAL_H, undefined, undefined, game.wallets); // S036: + pénz; S029: játékosonkénti HUD az alsó sarkokban (a nézetek és a színezés fölött)
  drawStatusIcons(ctx, statuses, game.players, hudMenus, VIRTUAL_W, VIRTUAL_H); // S072: státusz-ikonok a HUD (nyitott menünél a menü) fölött
  drawInventories(ctx, game.players, game.inventories, invUi, maskMenus(menuUi, tradeMenus(tradeUi, trade, invMenus(craftUi, menus))), VIRTUAL_W, VIRTUAL_H); // S035: a nyitott menü inventory-panelje (a menü-vázat eltakarja); S042: a craft fülön lévő játékosnál nem
  drawCraftPanels(ctx, craftUi, hudMenus, game.players, VIRTUAL_W, VIRTUAL_H);
  drawTradeTabs(ctx, tradeUi, trade, tradeCtx, menus, game.players, VIRTUAL_W, VIRTUAL_H); // S044: trade fül (a menü-sarokban)
  drawTradeOverlay(ctx, tradeUi, trade, tradeCtx, VIRTUAL_W, VIRTUAL_H); // S044: kérés-sáv, a két trade-panel, üzenet // S042: craft-panel (a craft fülön)
  drawMenuPanels(ctx, menuUi, menus, game.players, VIRTUAL_W, VIRTUAL_H); // S049: térkép- és beállítások-fül
  if (tc.hud) drawTetherHud(ctx, 8, 28);
  if (saveCtl.toast) drawSaveToast(ctx, saveCtl.toast);
  if (wipeToast > 0) { // S070: visszatérés-üzenet
    ctx.font = '14px monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    const m = t('revive.wipe'), w = Math.ceil(ctx.measureText(m).width) + 20;
    ctx.fillStyle = 'rgba(70,14,14,0.88)'; ctx.fillRect(Math.round(VIRTUAL_W / 2 - w / 2), 52, w, 26);
    ctx.fillStyle = '#ffffff'; ctx.fillText(m, VIRTUAL_W / 2, 65); ctx.textAlign = 'left';
  }
}

// Mentés-értesítés (alul középen, a HUD-panelek között); zöld = siker, piros = hiba.
function drawSaveToast(ctx, toast) {
  const text = t(toast.key);
  ctx.font = '14px monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const w = Math.ceil(ctx.measureText(text).width) + 20;
  const x = VIRTUAL_W / 2, y = VIRTUAL_H - 28;
  ctx.fillStyle = toast.ok ? 'rgba(10,50,24,0.85)' : 'rgba(70,14,14,0.88)';
  ctx.fillRect(Math.round(x - w / 2), y - 13, w, 26);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y);
  ctx.textAlign = 'left';
}

let last = performance.now(), acc = 0, fpsAcc = 0, fpsN = 0;
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > MAX_FRAME) dt = MAX_FRAME;
  acc += dt;
  while (acc >= STEP) { update(STEP); acc -= STEP; }
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) { game.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__game = { lash, statuses, status: (i, id, secs, stacks) => applyStatus(statuses, i, id, { secs, stacks }), revival, kill: i => killHealth(healths[i]), es, loot, combat, spawner, wizard, ranger, healer, foe: (type, dx = 200, dy = 0) => spawnEnemy(es, type, players[0].x + dx, players[0].y + dy), healths, dmg: (i, n, type) => applyDamage(healths[i], { amount: n, type }), anims, paperdoll, select, obstacles, abilities, menuUi, prog, actlog, skills, craftUi, tradeUi, trade, stations, craft: (i, id, n = 1) => craft(inventories[i], getRecipe(recipes, id), stationCtx(stations, players[i], skillsOf(skills, i)), n), game, split, splitRend, input, screen, tether, tc, vis, world, atlas, chunkRend, objects, objSprites, interact, warp, clock, dn, field, sorsko, menus, saveCtl, invUi, inventories, wallets, nodes, ground, drop: (i, id, n = 1) => dropItem(ground, id, n, players[i].x + 48, players[i].y, { toss: true }), give: (i, id, n = 1) => addItem(inventories[i], id, n), pay: (i, n = 1) => deposit(wallets[i], n) }; // give: fejlesztői segéd (a node-ok S037-ben bekötve; a földre dobott tárgy felvétele az S039-ben jön)
