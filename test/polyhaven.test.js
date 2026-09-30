'use strict';
// Poly Haven online textures — the pure helpers behind the Materials
// dialog's CC0 section: index filtering/sorting, physical tile sizing from
// scan dimensions, diffuse map selection and the downscale fit.
module.exports = h => {
  const { test, ok, eq, near } = h;
  const L = h.loadModel(['js/features/polyhaven.js']);
  const PH = L.window.PHTextures;

  const INDEX = {
    wood_floor_deck: {
      name: 'Wood Floor Deck', tags: ['wood', 'floor'], categories: ['wood', 'floor'],
      authors: { 'Robyte': 'All' }, download_count: 900, thumbnail_url: 't1', dimensions: [1799.99, 1799.99],
    },
    brick_wall: {
      name: 'Brick Wall', tags: ['brick'], categories: ['brick', 'man made'],
      authors: {}, download_count: 5000, thumbnail_url: 't2', dimensions: [2000, 1500],
    },
    rough_rock: {
      name: 'Rough Rock', tags: ['rock', 'granite'], categories: ['rock'],
      authors: {}, download_count: 100, thumbnail_url: 't3', dimensions: [500, 700],
    },
  };

  test('filterAssets: search, category and stable ordering', () => {
    ok(PH, 'feature exports');
    const all = PH.filterAssets(INDEX, '', '');
    eq(all.length, 3, 'all entries');
    ok(all.every(e => e.id && e.name), 'entries carry their index id');
    eq(all[0].id, 'brick_wall', 'download_count desc first');

    const wood = PH.filterAssets(INDEX, 'wood', '');
    eq(wood.length, 1, 'name+tag search hits Wood Floor Deck');
    eq(wood[0].id, 'wood_floor_deck', 'the right one');

    eq(PH.filterAssets(INDEX, 'ROBYTE', '').length, 1, 'author is searchable, case-insensitive');
    eq(PH.filterAssets(INDEX, '', 'rock').length, 1, 'category filter');
    eq(PH.filterAssets(INDEX, 'wood', 'rock').length, 0, 'search and category AND together');
  });

  test('specFor: scan millimetres → real-world tile metres', () => {
    const s1 = PH.specFor(INDEX.wood_floor_deck);
    near(s1.size, 1.8, 1e-9, '1.8 m deck tile');
    ok(/CC0 · Poly Haven/.test(s1.name), 'license credit in the name');
    near(PH.specFor(INDEX.brick_wall).size, 2, 1e-9, '2 m brick tile');
    near(PH.specFor(INDEX.rough_rock).size, 0.7, 1e-9, '0.7 m rock tile');
    near(PH.specFor({ dimensions: [90000, 90000] }).size, 10, 1e-9, 'clamped at 10 m');
    near(PH.specFor({ dimensions: [10, 10] }).size, 0.1, 1e-9, 'clamped at 0.1 m');
    near(PH.specFor({}).size, 0.1, 1e-9, 'missing dimensions fall back safely');
  });

  test('pickDiffuse: 1k preferred, falls up not down', () => {
    const files = { Diffuse: { '1k': { jpg: { url: 'u1k' } }, '2k': { jpg: { url: 'u2k' } } } };
    eq(PH.pickDiffuse(files), 'u1k', '1k wins');
    eq(PH.pickDiffuse({ Diffuse: { '2k': { jpg: { url: 'u2k' } }, '4k': { jpg: { url: 'u4k' } } } }), 'u2k', '2k when no 1k');
    eq(PH.pickDiffuse({ Diffuse: { '1k': { png: { url: 'p' } }, '2k': { jpg: { url: 'u2k' } } } }), 'u2k', 'skips non-jpg');
    eq(PH.pickDiffuse({}), null, 'no diffuse → null');
    eq(PH.pickDiffuse(null), null, 'null-safe');
  });

  test('fitSize: fit inside the cap, never upscale', () => {
    const a = PH.fitSize(2048, 2048);
    eq(a.w, 1024, 'square downscale w'); eq(a.h, 1024, 'square downscale h');
    const b = PH.fitSize(4096, 2048);
    eq(b.w, 1024, 'wide downscale w'); eq(b.h, 512, 'wide downscale h (aspect kept)');
    const c = PH.fitSize(512, 300);
    eq(c.w, 512, 'small image untouched'); eq(c.h, 300, 'small image height untouched');
    eq(PH.fitSize(0, 0).w >= 1, true, 'degenerate input still positive');
  });
};
