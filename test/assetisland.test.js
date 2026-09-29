'use strict';
// v0.8 ASSET INDEPENDENCE — placed library assets never connect to other
// elements. The reported bug: a tree built at the origin T-split a host
// element's edge (snapEndpoint welds globally), so an element edge ended
// up shared with the tree — and moving the tree dragged the element's
// vertex with it. isolate() scopes the build's welds to the asset itself,
// and the assetGid island stamp extends the element-independence gates
// (never merge / never intersect) to placed assets.
module.exports = h => {
  const { loadModel, test, ok, eq } = h;
  const { G, Model, window: w } = loadModel(['js/features/assetlib.js']);
  const LIB = w.AssetLib.LIB;

  // a host element face whose boundary edge runs through the origin —
  // exactly where tray assets build before their placement move
  const hostFace = m => m.addFaceFromRings(
    [G.v(-10, 0, 0), G.v(10, 0, 0), G.v(10, 10, 0), G.v(-10, 10, 0)], [], { gid: 0 });

  const treeVids = (m, g) => {
    const s = new Set();
    for (const fid of m.groupEntities(g.id).faces) {
      const f = m.faces.get(fid);
      if (f) for (const r of m.rings(f)) for (const vi of r) s.add(vi);
    }
    return s;
  };
  const stampAsset = (m, g) => {
    for (const fid of m.groupEntities(g.id).faces) {
      const f = m.faces.get(fid);
      if (f) (f.userData || (f.userData = {})).assetGid = 'asset:' + g.id;
    }
  };
  // a wall the tree's crown properly crosses (y=0.5 cuts the r=1.6 crown,
  // z band 2.9..4) — the autoIntersect torture setup
  const wallFace = m => m.addFaceFromRings(
    [G.v(-5, 0.5, 0), G.v(5, 0.5, 0), G.v(5, 0.5, 4), G.v(-5, 0.5, 4)], [], { gid: 0 });

  test('classic build welds a tree into a host element (the reported bug)', () => {
    const m = new Model();
    const host = hostFace(m);
    host.userData = { bimEntityId: 'wall_1' };
    const g = LIB.tree.build(m, 1); // NOT isolated — the old placement path
    ok(host.loop.length > 4, 'host edge T-split by the tree ring (' + host.loop.length + ' ring verts)');
    const shared = [...treeVids(m, g)].filter(v => host.loop.includes(v));
    ok(shared.length > 0, 'element edge shares vertices with the tree');
  });

  test('isolate(): the tree welds to itself, never into the element', () => {
    const m = new Model();
    const host = hostFace(m);
    host.userData = { bimEntityId: 'wall_1' };
    const g = m.isolate(() => LIB.tree.build(m, 1));
    eq(host.loop.length, 4, 'host ring untouched');
    const shared = [...treeVids(m, g)].filter(v => host.loop.includes(v));
    eq(shared.length, 0, 'no shared vertices with the element');
    // internal welds intact — the prisms are still closed shells
    const faces = [...m.groupEntities(g.id).faces].filter(id => m.faces.has(id));
    eq(m.shellOpenEdges(faces), 0, 'tree shell watertight');
    ok(m.validate().ok, 'model valid');
  });

  test('island stamp: a stamped asset never intersects a stamped element', () => {
    const m = new Model();
    const wall = wallFace(m);
    wall.userData = { bimEntityId: 'w1' };
    const g = m.isolate(() => LIB.tree.build(m, 1));
    stampAsset(m, g);
    const before = m.faces.size;
    m.autoIntersect([wall.id]); // editing the element — the asset is a bystander
    ok(m.faces.has(wall.id), 'wall face not sliced by the asset');
    eq(m.faces.size, before, 'no split pieces created on either side');
  });

  test('control: unstamped free geometry still crosses (windows-punch-walls kept)', () => {
    const m = new Model();
    const wall = wallFace(m);
    LIB.tree.build(m, 1); // raw free geometry — no isolation, no stamp
    const before = m.faces.size;
    m.autoIntersect([wall.id]);
    ok(!m.faces.has(wall.id) || m.faces.size !== before,
      'classic behavior: the properly-crossing faces split (wall gone or pieces created)');
  });

  test('assetGid survives save/load (the island persists across sessions)', () => {
    const m = new Model();
    const g = m.isolate(() => LIB.tree.build(m, 1));
    stampAsset(m, g);
    const m2 = new Model();
    m2.load(m.serialize());
    const keys = new Set();
    for (const f of m2.faces.values())
      if (f.userData && f.userData.assetGid) keys.add(f.userData.assetGid);
    eq(keys.size, 1, 'one island key, all tree faces stamped');
    ok([...keys][0].startsWith('asset:'), 'key form asset:<gid>');
    eq(m2.islandOf([...m2.faces.values()].find(f => f.userData && f.userData.assetGid)),
      [...keys][0], 'islandOf reads the restored stamp');
  });
};
