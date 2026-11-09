// data-sprites.js – kódból rajzolt sprite-ok a pixel-DSL-ben (S021; adat). Formátum: world-sprite.js compileSprite.
// Új sprite: egyedi id (terület.név), palette {egy karakter: '#rrggbb'}, rows (azonos hosszú sorok; '.' = átlátszó),
// opcionális ax/ay (lábpont; alap: alul középen) és variants {név: {kulcs: szín}} a paletta-cseréhez.
// Az S064 (paperdoll), S098/S103 (tárgyak, ellenségek) ide veszi fel a saját spriteait. Nincs külső asset.
export const SPRITE_DEFS = {
  // Sorsszilánk-ikon (16x16): kék kristály, variánsok: fagy, parázs
  'icon.shard': {
    palette: { o: '#1b2a4a', b: '#4f8fe0', l: '#9ad0ff', w: '#e8f6ff', d: '#2f5fa8' },
    ax: 8, ay: 8,
    rows: [
      '................',
      '.......oo.......',
      '......olwo......',
      '.....olwbbo.....',
      '....olwbbbdo....',
      '...olwbbbbbdo...',
      '...olwbbbbbdo...',
      '...olbbbbbbdo...',
      '...olbbbbbddo...',
      '...obbbbbbddo...',
      '....obbbbbdo....',
      '....obbbbddo....',
      '.....obbbdo.....',
      '......obdo......',
      '.......oo.......',
      '................',
    ],
    variants: {
      frost: { o: '#1b3a52', b: '#7fd6e8', l: '#d4f6ff', d: '#3f9ab8' },
      ember: { o: '#4a1a10', b: '#e86a3a', l: '#ffb07a', w: '#fff0e0', d: '#a8381c' },
    },
  },
  // Pénz-ikon (10x10): arany érme, variáns: ezüst
  'icon.coin': {
    palette: { o: '#6b4a12', y: '#e8b82a', h: '#fff0a0', d: '#b8861a' },
    ax: 5, ay: 5,
    rows: [
      '...oooo...',
      '..oyyhyo..',
      '.oyhhyyyo.',
      'oyhyyyyydo',
      'oyhyyyyydo',
      'oyyyyyyydo',
      'oyyyyyyddo',
      '.oyyyyddo.',
      '..oddddo..',
      '...oooo...',
    ],
    variants: {
      silver: { o: '#4a5360', y: '#c8d0d8', h: '#f4f8ff', d: '#8a95a3' },
    },
  },
};
