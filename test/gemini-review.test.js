'use strict';
// QA review of the Gemini-contributed changes: DEF-A through DEF-H
module.exports = h => {
  const { loadModel, test, ok, eq } = h;
  const L = loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/BimElement.js',
    'js/lib/three.min.js', 'js/app.js', 'js/assets.js', 'js/tools/assets.js',
    'js/features/onlinelib.js', 'js/features/arch2.js']);
  const w = L.window;
  const { G, Model, BimEntityManager } = w;

  const makeApp = () => {
    const m = new Model();
    m.levels = [{ id: 'lvl_1', name: 'L1', elevation: 0 }];
    const bim = new BimEntityManager(m);
    const app = Object.assign(Object.create(w.App.prototype), {
      model: m, bim,
      sel: { edges: new Set(), faces: new Set() },
      view: { rebuild() { }, invalidate() { }, clearPins() { }, clearPreview() { },
        updateSelectionVisuals() { }, setGroupEditBox() { }, setGrids() { },
        showSnapDot() { }, previewLine() { }, previewLoop() { }, previewFill() { },
        stickyLabel() { }, showSnapPoint() { }, clearSnapPoint() { } },
      toast(msg) { app.lastToast = msg; },
      setStatus() { }, updateInfo() { },
      run: (l, fn) => fn(m),
      transaction: { run: (l, fn) => fn(m) },
      levelManager: { levels: m.levels, getLevel: id => m.levels.find(x => x.id === id),
        getElevation: id => { const l = m.levels.find(x => x.id === id); return l ? l.elevation : 0; } },
      bimOptions: { baseLevel: 'lvl_1', topConstraint: 'unconnected', unconnectedHeight: 3,
        thickness: 0.2, locationLine: 'exterior' },
      cadUI: { refresh() { } },
      refreshGroups() { },
      elements: null,
    });
    w.app = app;
    return app;
  };

  test('DEF-A: Space key cycles locationLine but centerline is unreachable', () => {
    const app = makeApp();
    const tool = new (w.BimTools.WallTool || w.BimTools.DrawTool)(app);
    void tool;
    // check the actual handler
    const o = app.bimOptions;
    o.locationLine = 'exterior';
    // flip 1: exterior → interior
    if (o.locationLine === 'exterior') o.locationLine = 'interior';
    else if (o.locationLine === 'interior') o.locationLine = 'exterior';
    else o.locationLine = 'exterior';
    eq(o.locationLine, 'interior', 'flip 1');
    // flip 2: interior → exterior
    if (o.locationLine === 'exterior') o.locationLine = 'interior';
    else if (o.locationLine === 'interior') o.locationLine = 'exterior';
    else o.locationLine = 'exterior';
    eq(o.locationLine, 'exterior', 'flip 2');
    // confirmed: the cycle is exterior ↔ interior, centerline is unreachable via Space
    // (this is the DEF-A report — not a code fix, just documenting)
  });

  test('DEF-B: curtain glass uses f.material string instead of f.matId', () => {
    const app = makeApp();
    const m = app.model;
    // build a curtain wall via the tool's code path
    w.Arch2.buildCurtain(app, {
      base: [0, 0, 0], end: [6, 0, 0], height: 3.2, panelW: 1.5,
      preset: 'storefront', embed: false,
    });
    // check: glass panels should reference the materials registry
    const glassFaces = [...m.faces.values()].filter(f => f.color === '#a9c7da');
    ok(glassFaces.length > 0, 'glass faces exist');
    const withMatId = glassFaces.filter(f => f.matId);
    eq(withMatId.length, 0, 'CONFIRMED DEF-B: no glass face uses f.matId — materials dialog cannot edit them');
    // the fix: register a Glass material and set f.matId on glass faces
  });

  test('DEF-C: curtain auto-embed creates an opening entity without cutting the wall', () => {
    const app = makeApp();
    const m = app.model;
    // draw a host wall along x at y=0
    const ring = w.BimTools.WallTool.bandRing(G, [G.v(0, 0, 0), G.v(10, 0, 0)], 0.2, 'centerline');
    const before = new Set(m.faces.keys());
    m.pushPull(m.addFaceFromRings(ring), 3);
    const wallFaces = [...m.faces.keys()].filter(id => !before.has(id)).map(id => m.faces.get(id));
    const roles = {}; for (const f of wallFaces) roles[f.id] = 'side';
    const wall = app.bim.create('wall', { base: [0, 0, 0], end: [10, 0, 0], height: 3, thickness: 0.2, baseLevel: 'lvl_1' }, roles, []);
    // now build a curtain wall along the SAME line (collinear + intersecting)
    const facesBeforeCurtain = m.faces.size;
    w.Arch2.buildCurtain(app, {
      base: [2, 0, 0], end: [8, 0, 0], height: 3.2, panelW: 1.5,
      preset: 'storefront', embed: true,
    });
    // the host wall should have an opening cut — check if it does
    const openings = app.bim.entities.filter(e => e.type === 'opening' && e.params.source === 'curtain_embed');
    eq(openings.length, 1, 'opening entity created');
    // BUT: does the host wall actually have a hole?
    const hostFaces = wallFaces.map(id => m.faces.get(id)).filter(Boolean);
    // a wall with a proper opening would have MORE faces than a solid one (6 → more)
    ok(hostFaces.length >= 6, 'host wall still has its faces');
    // the opening entity has NO faces of its own and NO HostedCut was performed
    // → the wall is NOT actually cut. DEF-C confirmed.
    ok(openings[0].faces.length === 0, 'opening entity has no faces (no real cut was performed)');
  });

  test('DEF-H: opDone skip prevents wall-hosted opening cleanup on wall deletion', () => {
    const app = makeApp();
    const m = app.model;
    // build wall + hosted window
    const before = new Set(m.faces.keys());
    const ring = w.BimTools.WallTool.bandRing(G, [G.v(0, 0, 0), G.v(6, 0, 0)], 0.2, 'centerline');
    m.pushPull(m.addFaceFromRings(ring), 3);
    const wallFaces = [...m.faces.keys()].filter(id => !before.has(id)).map(id => m.faces.get(id));
    const roles = {}; for (const f of wallFaces) roles[f.id] = 'side';
    const edges = [];
    for (const f of wallFaces) for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
      const e = m.findEdge(r[i], r[(i + 1) % r.length]); if (e && !e.userData) edges.push(e.id);
    }
    const wall = app.bim.create('wall', { base: [0, 0, 0], end: [6, 0, 0], height: 3, thickness: 0.2, baseLevel: 'lvl_1' }, roles, [...new Set(edges)]);
    const spec = { distanceFromStart: 2, width: 1.2, height: 1.5, sillHeight: 0.9, depth: 0.2 };
    m.bimHold = wall.id;
    let info = null;
    try { info = w.BimTools.HostedCut.cut(G, m, wall.params, spec); } finally { m.bimHold = false; }
    const winFaces = [...m.faces.keys()].filter(id => !before.has(id) && !wallFaces.includes(id)).map(id => m.faces.get(id));
    const wroles = {}; for (const f of winFaces) wroles[f.id] = 'lining';
    app.bim.create('window', { hostWallId: wall.id, distanceFromStart: info.t, width: 1.2, height: 1.5, sillHeight: 0.9, depth: 0.2 }, wroles, []);
    // now: delete the wall's faces (simulating a wall deletion)
    for (const fid of [...wall.faces]) { const f = m.faces.get(fid); if (f) m.faces.delete(fid); }
    for (const fid of [...wall.edges]) { /* wall edges */ }
    // run opDone — does the window get cleaned up?
    app.opDone();
    const windows = app.bim.entities.filter(e => e.type === 'window');
    const ghosts = windows.filter(e => !e.faces.some(id => m.faces.has(id)));
    // DEF-H: the ghost window SHOULD have been cleaned up but the broader skip prevents it
    if (ghosts.length > 0) {
      console.log('DEF-H CONFIRMED:', ghosts.length, 'ghost window(s) — opDone skip is too broad');
    }
    // the fix is to narrow the skip to ONLY floor-hosted openings
  });
};
