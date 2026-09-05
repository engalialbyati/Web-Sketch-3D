'use strict';
// BlenderKit bridge tests — pure file-picking helpers over the two payload
// shapes the live API serves (verified 2026-09): asset details list
// files[].downloadUrl, search results list files[].url. The conversion
// pipeline prefers a ready-made glTF so most assets import with no Blender;
// hasGltf annotation drives the frontend badges and the GLB-only filter.
module.exports = h => {
  const { test, ok, eq } = h;
  const bridge = require('../server/blenderkitBridge.js');
  const { pickGltfFile, pickBlendFile, hasReadyGlb, annotateResults, uploadKey } = bridge;

  // detail-payload shape: files[].downloadUrl
  const detail = files => ({ name: 'x', files });

  test('pickGltfFile prefers the fileType=gltf entry from asset details', () => {
    const f = pickGltfFile(detail([
      { fileType: 'blend', downloadUrl: 'https://bk/api/v1/downloads/1/' },
      { fileType: 'gltf', downloadUrl: 'https://bk/api/v1/downloads/2/' },
      { fileType: 'gltf_godot', downloadUrl: 'https://bk/api/v1/downloads/3/' },
    ]));
    ok(f, 'finds a gltf file');
    eq(f.downloadUrl, 'https://bk/api/v1/downloads/2/', 'picks gltf, not gltf_godot');
  });

  test('pickGltfFile falls back to a .glb downloadUrl without fileType', () => {
    const f = pickGltfFile(detail([
      { fileType: 'blend', downloadUrl: 'https://bk/dl/1/' },
      { downloadUrl: 'https://bk/files/model.glb?sig=abc' },
    ]));
    ok(f, 'falls back to the .glb entry');
    eq(f.downloadUrl, 'https://bk/files/model.glb?sig=abc', 'query string tolerated');
  });

  test('pickGltfFile returns null for blend-only or fileless assets', () => {
    eq(pickGltfFile(detail([{ fileType: 'blend', downloadUrl: 'https://bk/dl/1/' }])), null);
    eq(pickGltfFile({}), null);
    eq(pickGltfFile(null), null);
  });

  test('pickBlendFile finds the blend entry for the Blender fallback path', () => {
    const f = pickBlendFile(detail([
      { fileType: 'gltf', downloadUrl: 'https://bk/dl/2/' },
      { fileType: 'blend', downloadUrl: 'https://bk/dl/1/' },
    ]));
    ok(f && f.downloadUrl === 'https://bk/dl/1/');
  });

  test('hasReadyGlb works on search-shaped files[].url payloads', () => {
    ok(hasReadyGlb({ files: [
      { fileType: 'blend', url: 'https://bk/api/v1/downloads/1/' },
      { fileType: 'gltf', url: 'https://bk/api/v1/downloads/2/' },
    ] }), 'gltf entry counts');
    ok(!hasReadyGlb({ files: [{ fileType: 'blend', url: 'https://bk/dl/1/' }] }), 'blend-only is not ready');
    ok(!hasReadyGlb({ files: [{ fileType: 'gltf_godot', url: 'https://bk/dl/3/' }] }), 'gltf_godot is not the web gltf');
    ok(!hasReadyGlb({}), 'no files key -> false');
    ok(!hasReadyGlb(null), 'null asset -> false');
  });

  test('annotateResults stamps hasGltf additively and leaves the payload intact', () => {
    const data = {
      count: 8225,
      results: [
        { pk: 1, name: 'Chair', files: [{ fileType: 'blend', url: 'u1' }, { fileType: 'gltf', url: 'u2' }] },
        { pk: 2, name: 'Old Sofa', files: [{ fileType: 'blend', url: 'u3' }] },
        { pk: 3, name: 'NoFiles' },
      ],
    };
    const out = annotateResults(data);
    eq(out, data, 'returns the same payload object');
    eq(data.count, 8225, 'count untouched');
    eq(data.results.length, 3, 'no results added or dropped');
    eq(data.results[0].hasGltf, true, 'gltf asset flagged');
    eq(data.results[0].name, 'Chair', 'existing fields untouched');
    eq(data.results[1].hasGltf, false, 'blend-only asset flagged false');
    eq(data.results[2].hasGltf, false, 'fileless asset flagged false');
  });

  test('annotateResults tolerates payloads without results', () => {
    eq(annotateResults({ count: 0, results: [] }).results.length, 0);
    eq(annotateResults(null), null, 'null passes through');
  });

  test('uploadKey is a stable content hash with the up_ prefix', () => {
    const a = uploadKey(Buffer.from('BLENDER same file'));
    eq(a, uploadKey(Buffer.from('BLENDER same file')), 'same bytes -> same key');
    ok(a !== uploadKey(Buffer.from('BLENDER other file')), 'different bytes -> different key');
    ok(/^up_[0-9a-f]{12}$/.test(a), 'shape: up_ + 12 hex chars');
    ok(!/[^A-Za-z0-9_-]/.test(a), 'safe for cache/ path filenames');
  });
};
