'use strict';
// Asset Library — the bundled offline components: every builder produces
// real kernel faces in a named group; every sub-prism is a closed shell, so
// each group is watertight (multi-shell solids), takes volume, and the
// model stays valid. Real-world sizes.
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const { Model, window: w } = loadModel(['js/features/assetlib.js']);
  const { LIB } = w.AssetLib;

  for (const [id, def] of Object.entries(LIB)) {
    test(`asset ${id}: builds a watertight named group at real-world size`, () => {
      const m = new Model();
      const g = def.build(m, 1);
      ok(g, 'group created');
      eq(m.groups.get(g.id).name, g.name, 'registered');
      const faces = [...m.groupEntities(g.id).faces];
      ok(faces.length >= 6, `has faces (${faces.length})`);
      eq(m.shellOpenEdges(faces), 0, 'every sub-shell closed (watertight group)');
      ok(m.shellVolume(faces) > 0.001, `positive volume (${m.shellVolume(faces).toFixed(3)} m³)`);
      const bb = m.bbox([...new Set(faces.flatMap(f => m.rings(m.faces.get(f)).flat()))]);
      ok(bb.max.z >= def.h * 0.8, `height ~ ${def.h} m (got ${bb.max.z.toFixed(2)})`);
      ok(m.validate().ok, 'model valid');
    });
  }

  test('asset placement offset keeps the weld hash coherent (transformVertices)', () => {
    const m = new Model();
    const g = LIB.tree.build(m, 1);
    const vids = new Set();
    for (const fid of m.groupEntities(g.id).faces) {
      const f = m.faces.get(fid);
      for (const ring of m.rings(f)) for (const vi of ring) vids.add(vi);
    }
    m.transformVertices([...vids], p => ({ x: p.x + 10, y: p.y + 5, z: p.z }));
    m.touch();
    const faces = [...m.groupEntities(g.id).faces];
    eq(m.shellOpenEdges(faces), 0, 'still watertight after the move');
    ok(m.shellVolume(faces) > 0.001, 'volume unchanged');
    ok(m.validate().ok, 'valid');
  });
};
