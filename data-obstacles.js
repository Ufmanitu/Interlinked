// data-obstacles.js – tag-akadályok (S059; adat, DOM nélkül). Logika, validáció, audit: game-obstacle.js.
// Akadály: {id (kisbetű/szám/_), kind 'blocked'|'dark', x, y, w, h (px, bal-felső sarok; a horgonyhoz képest, createObstacleSystem opts.anchor),
//   solves [2..6 különböző nagybetűs TAG: bármelyik feloldja; GDD 6: minden akadálynak legalább 2–3 megoldása van],
//   hp (blocked: a ROBBANTÁS/solveByTag sebzés-tűrése, alap 3), burn (mp: ÉGETÉS-nél az égési idő, alap 1,5),
//   tools {TAG: {tier 0..9, time mp}} (blocked: a TAG-hez tartozó ESZKÖZ (item.tool.tag) tartott gombbal kivágja; tier = a legalább ilyen szintű eszköz kell, time = a teljes kivágás mp-ben 1-es sebességnél)}.
// blocked = tömör ütköző, amíg valamelyik tag-megoldás fel nem oldja (tartós, mentett). dark = sötét átjáró: zárt, amíg fény (FÉNY: varázsló fénye), FÁKLYA (tárgy a közelben)
//   vagy más a megoldás-listán szereplő tag (pl. a törpe SÖTÉTLÁTÁS-a) nincs a közelben; bent állva nem zár be.
// Tag-források: FÉNY (varázsló light), ÉGETÉS (ignite), TÖRÉS (wallbreak), FEJSZE (axe tool), FÁKLYA (torch), SÖTÉTLÁTÁS (törpe); a ROBBANTÁS forrása az S139/S141 (OBSTACLE_PLANNED_TAGS: addig az audit nem hiányolja).
// IDEIGLENES példa-akadályok a falu (horgony = kezdőhely) két oldalán; a valódi helyüket az S097 (falu-elrendezés) / S098 (rét) adja. A main.js még nem köti (S060 tool-használat, S063 kaszt-választó után él).
export const OBSTACLE_DEFS = [
  { id: 'thorn_thicket', kind: 'blocked', x: 352, y: -64, w: 32, h: 128, solves: ['ÉGETÉS', 'FEJSZE', 'ROBBANTÁS', 'TÖRÉS'], hp: 3, burn: 1.5, tools: { FEJSZE: { tier: 1, time: 2.5 } } },
  { id: 'dark_gate', kind: 'dark', x: -384, y: -64, w: 96, h: 32, solves: ['FÉNY', 'FÁKLYA', 'SÖTÉTLÁTÁS'] },
];

// Az audit nem hiányolja ezeknek a tag-eknek a forrását (a tartalom még nincs meg).
export const OBSTACLE_PLANNED_TAGS = ['ROBBANTÁS'];

// Szövegek (teljes kulcsok; a main.js registerTexts(OBSTACLE_TEXTS, '') és az INTERACT_TEXT-be is köti az act.* kulcsot).
// obstacle.<id>: az akadály neve (minden OBSTACLE_DEFS elemhez), obstacle.tag.<TAG>: a megoldás-tag neve, obstacle.need {tags}, obstacle.locked {tag, tier}.
export const OBSTACLE_TEXTS = {
  hu: {
    'act.clear': 'Kivág',
    'obstacle.thorn_thicket': 'Tüskebozót', 'obstacle.dark_gate': 'Sötét átjáró',
    'obstacle.tag.ÉGETÉS': 'égetés', 'obstacle.tag.FEJSZE': 'fejsze', 'obstacle.tag.ROBBANTÁS': 'robbantás', 'obstacle.tag.TÖRÉS': 'törés',
    'obstacle.tag.FÉNY': 'fény', 'obstacle.tag.FÁKLYA': 'fáklya', 'obstacle.tag.SÖTÉTLÁTÁS': 'sötétlátás',
    'obstacle.need': 'Megoldás: {tags}', 'obstacle.locked': 'Jobb eszköz kell: {tag} ({tier}. szint)',
  },
  en: {
    'act.clear': 'Clear',
    'obstacle.thorn_thicket': 'Thorn thicket', 'obstacle.dark_gate': 'Dark passage',
    'obstacle.tag.ÉGETÉS': 'fire', 'obstacle.tag.FEJSZE': 'axe', 'obstacle.tag.ROBBANTÁS': 'blast', 'obstacle.tag.TÖRÉS': 'smashing',
    'obstacle.tag.FÉNY': 'light', 'obstacle.tag.FÁKLYA': 'torch', 'obstacle.tag.SÖTÉTLÁTÁS': 'darkvision',
    'obstacle.need': 'Solutions: {tags}', 'obstacle.locked': 'Better tool needed: {tag} (tier {tier})',
  },
};
