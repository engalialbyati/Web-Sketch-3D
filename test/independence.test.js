'use strict';
// ---------------------------------------------------------------------------
// independence.test.js — the v0.6 ELEMENT INDEPENDENCE contract (the IFC
// model, made kernel law):
//   1. faces of DIFFERENT BIM elements never intersect — elements overlap
//      by ELEMENT_EPS instead of welding/splitting into each other;
//   2. a closed loop of ELEMENT edges (four walls) creates NO face at the
//      ground — face auto-creation belongs to free-drawn lines only;
//   3. BEARING: a column tops out at the capping beam's soffit, a beam
//      hangs from its level, a slab tops at its level — real-life stacking
//      with EPS overlaps, never cuts.
// ---------------------------------------------------------------------------
module.exports = h => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { test, ok, eq, near } = h;

  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const sandbox = { window: {}, console };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/geometry.js', 'js/model.js', 'js/StructuralManager.js',
    'js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const appTx = { run: (n, fn) => fn(null), begin: () => ({ commit() { }, rollback() { }, rolledBack: false }) };
  const appSrc = read('js/app.js');
  const s0 = appSrc.indexOf('class BimEntityManager {');
  const s1 = appSrc.indexOf('\nclass App {');
  vm.runInContext(appSrc.slice(s0, s1), ctx, { filename: 'app.js#BimEntityManager' });
  const { G, Model, BimTools, StructuralManager } = sandbox.window;
  const WallTool = BimTools.WallTool;
  const BimEntityManager = vm.runInContext('BimEntityManager', ctx);
  const v = (x, y, z = 0) => G.v(x, y, z);

  const makeWorld = () => {
    const m = new Model();
    m.bimEntities = [];
    m.levels = [
      { id: 'lvl_1', name: 'L1', elevation: 0 },
      { id: 'lvl_2', name: 'L2', elevation: 3 },
      { id: 'lvl_3', name: 'L3', elevation: 6 },
    ];
    const bim = new BimEntityManager(m);
    const app = { model: m, bim, toast() { }, setStatus() { },
      levelManager: {
        levels: m.levels,
        getElevation: id => { const l = m.levels.find(x => x.id === id); return l ? l.elevation : 0; },
        getLevel: id => m.levels.find(x => x.id === id),
      },
      gridManager: null,
      structural: null };
    app.structural = new StructuralManager(() => m.levels, () => m.bimEntities);
    app.bimOptions = { baseLevel: 'lvl_1', topConstraint: 'unconnected', unconnectedHeight: 3,
      thickness: 0.2, locationLine: 'centerline', hosted: {} };
    app.transaction = appTx;
    app.view = { clearPreview() { } };
    sandbox.window.app = app;
    sandbox.app = app; // bare-global callers inside the tools
    return { m, bim, app };
  };

  const reg = (w, type, params, build) => {
    const before = new Set(w.m.faces.keys());
    w.m.bimHold = true;
    try { build(); } finally { w.m.bimHold = false; }
    const nf = [...w.m.faces.keys()].filter(id => !before.has(id))
      .map(id => w.m.faces.get(id)).filter(f => f && !f.userData);
    const roles = {};
    for (const f of nf) roles[f.id] = 'body';
    const edges = [];
    for (const f of nf) for (const r of w.m.rings(f)) for (let i = 0; i < r.length; i++) {
      const e = w.m.findEdge(r[i], r[(i + 1) % r.length]);
      if (e && !e.userData) edges.push(e.id);
    }
    return w.bim.create(type, JSON.parse(JSON.stringify(params)), roles, [...new Set(edges)]);
  };
  const wall = (w, base, end, height = 3) =>
    reg(w, 'wall', { base, end, height, thickness: 0.2, locationLine: 'centerline', primitive: 'line', closed: false }, () => {
      const ring = WallTool.bandRing(G, [v(...base), v(...end)], 0.2, 'centerline');
      const f = w.m.addFaceFromRings(ring.map(q => G.clone(q)));
      if (!w.m.pushPull(f, height)) throw new Error('wall sweep failed');
    });
  const column = (w, x, y, width = 0.4, depth = 0.4, z0 = 0, height = 3) =>
    reg(w, 'column', { base: [x, y, z0], width, depth, height, baseLevelId: 'lvl_1', topLevelId: 'lvl_2' }, () => {
      const hw = width / 2, hd = depth / 2;
      const f = w.m.addFaceFromRings([v(x - hw, y - hd, z0), v(x + hw, y - hd, z0), v(x + hw, y + hd, z0), v(x - hw, y + hd, z0)]);
      if (!w.m.pushPull(f, height)) throw new Error('column sweep failed');
    });
  const beam = (w, ax, bx, levelId = 'lvl_2', height = 0.4) =>
    reg(w, 'beam', { baseline: [[ax, 0, 3], [bx, 0, 3]], referenceLevelId: levelId, baseLevel: levelId,
      zJustification: 'Top', profile: 'rectangular', webWidth: 0.25, height }, () => {
      w.app.structural.buildBeam(G, w.m, { baseline: [[ax, 0, 3], [bx, 0, 3]],
        referenceLevelId: levelId, baseLevel: levelId, zJustification: 'Top',
        profile: 'rectangular', webWidth: 0.25, height });
    });

  test('kernel independence: two overlapping elements never cut each other', () => {
    const w = makeWorld();
    const wl = wall(w, [0, 0, 0], [6, 0, 0]);
    const col = column(w, 3, 0);            // dead center, through the wall
    eq(w.bim.entities.length, 2, 'two independent elements');
    eq(wl.faces.length, 6, 'wall keeps all 6 clean faces');
    eq(col.faces.length, 6, 'column keeps all 6 clean faces');
    ok(w.m.validate().ok, 'model valid — overlapping islands');
  });

  test('a closed loop of four walls creates NO face at the ground', () => {
    const w = makeWorld();
    const facesBefore = w.m.faces.size;
    wall(w, [0, 0, 0], [4, 0, 0]);
    wall(w, [4, 0, 0], [4, 4, 0]);
    wall(w, [4, 4, 0], [0, 4, 0]);
    wall(w, [0, 4, 0], [0, 0, 0]);
    const walls = w.bim.entities.filter(e => e.type === 'wall');
    eq(walls.length, 4, 'four wall elements');
    // no face appeared beyond the walls' own 6 each — the old kernel welded
    // the coplanar bottom faces at the corners and the arrangement created a
    // filler face inside the loop (the "face at the ground" bug)
    eq(w.m.faces.size, facesBefore + 24, 'exactly 4 x 6 wall faces — no ground filler');
    for (const f of w.m.faces.values()) {
      const c = w.m.faceCentroid(f);
      ok(!(Math.abs(c.x - 2) < 1 && Math.abs(c.y - 2) < 1 && Math.abs(c.z) < 1e-6),
        'no face inside the loop at z=0');
    }
    ok(w.m.validate().ok, 'model valid');
  });

  test('bearing: a beam above shortens the column to its soffit (+EPS)', () => {
    const w = makeWorld();
    beam(w, 0, 6, 'lvl_2', 0.4);           // hangs [3 - 0.4 - eps, 3 - eps]
    const col = column(w, 3, 0, 0.4, 0.4, 0, 3);  // nominal [0, 3]
    const S = w.app.structural;
    const top = S.columnBearingTop(col.params);
    // beamBounds gives the NOMINAL soffit (3 - 0.4); the built beam's own
    // zDrop buries its bottom face EPS lower, so a column topping at
    // soffit + EPS overlaps it by 2*EPS — bearing, never a cut
    near(top, 2.6 + 1e-4, 1e-6, 'column top = nominal soffit + EPS overlap');
    const base = S.columnBearingBase({ base: [3, 0, 3], width: 0.4, depth: 0.4, height: 3,
      baseLevelId: 'lvl_2', topLevelId: 'lvl_3' });
    near(base, 3 - 1e-4, 1e-6, 'a column based on the beam starts EPS into it');
  });

  test('bearing: no beam above — the column runs to its own constraint', () => {
    const w = makeWorld();
    const col = column(w, 3, 0);
    near(w.app.structural.columnBearingTop(col.params), 3, 1e-9, 'full story when nothing caps it');
  });

  test('chained wall pieces keep their bottom faces (v0.6 solid islands)', () => {
    const w = makeWorld();
    // three collinear pieces sharing cap edges exactly — the piece after
    // the first used to count as 'hosted' by the neighbor's faces and
    // extruded open at the bottom
    wall(w, [0, 0, 0], [4, 0, 0]);
    wall(w, [4, 0, 0], [8, 0, 0]);
    wall(w, [8, 0, 0], [12, 0, 0]);
    const walls = w.bim.entities.filter(e => e.type === 'wall');
    eq(walls.length, 3, 'three pieces');
    for (const wl of walls) {
      const hasBottom = wl.faces.some(id => {
        const f = w.m.faces.get(id);
        return f && Math.abs(w.m.faceCentroid(f).z) < 1e-6;
      });
      ok(hasBottom, wl.id + ' owns its bottom face');
    }
    ok(w.m.validate().ok, 'model valid');
  });

  test('FACE-STOP: a wall ending at a column center stops at its face + EPS', () => {
    const w = makeWorld();
    column(w, 6, 0, 0.4, 0.4);                       // column at the wall's end
    const WallTool = BimTools.WallTool;
    const wt = new WallTool(w.app);
    wt._commit({ kind: 'line', pts: [v(3, 0, 0), v(6, 0, 0)], closed: false });
    const wall = w.bim.entities.find(e => e.type === 'wall');
    ok(wall, 'wall built');
    // params keep the DRAWN span (params are truth)…
    eq(wall.params.base[0], 3, 'params keep drawn start');
    eq(wall.params.end[0], 6, 'params keep drawn end (the column center)');
    // …the GEOMETRY retreats to the column face + ELEMENT_EPS
    const xs = [];
    for (const fid of wall.faces) {
      const f = w.m.faces.get(fid);
      if (f) for (const p of w.m.pts(f.loop)) xs.push(p.x);
    }
    xs.sort((a, b) => a - b);
    near(xs[xs.length - 1], 5.8 + 1e-4, 1e-6, 'geometry stops at the column face + EPS');
    ok(xs[xs.length - 1] < 5.95, 'no wall line at the column center');
    ok(w.m.validate().ok, 'model valid');
    // the rebuild path (wallRing) derives the same retreat
    const ring = w.bim.wallRing(wall.params);
    const rxs = ring.map(p => p.x).sort((a, b) => a - b);
    near(rxs[rxs.length - 1], 5.8 + 1e-4, 1e-6, 'wallRing agrees with the draw path');
  });

  test('slab stays solid; the column passes through and overlaps', () => {
    const w = makeWorld();
    const col = column(w, 3, 3, 0.4, 0.4, 0, 3);
    const holes = w.app.structural.columnHolesForSlab(w.m,
      { baseLevel: 'lvl_2', thickness: 0.2, _planeZ: 3 }, { outer: [[0, 0, 3], [6, 0, 3], [6, 6, 3], [0, 6, 3]], holes: [] });
    eq(holes.length, 0, 'v0.6: nobody punches a slab');
    ok(col.faces.length === 6, 'column whole through the slab plane');
  });
};
