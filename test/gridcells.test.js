'use strict';
// ---------------------------------------------------------------------------
// gridcells.test.js — Grid Place extensions: cell enumeration, grid beams,
// and floor/slab fills over selected cells.
//
// Drives the REAL GridPlaceTool._place() (js/features/gridplace.js) with the
// REAL BimEntityManager (sliced from js/app.js), REAL StructuralManager and
// REAL GridManager/GridLine over the REAL Model — the same production path
// the options bar's Enter triggers.
// ---------------------------------------------------------------------------
module.exports = h => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { test, ok, eq, near } = h;

  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const sandbox = { window: {}, console };
  const ctx = vm.createContext(sandbox);
  for (const f of [
    'js/geometry.js', 'js/model.js', 'js/GridLine.js', 'js/GridManager.js',
    'js/StructuralManager.js', 'js/tools/base.js', 'js/tools/draw.js',
    'js/tools/bim.js', 'js/features/gridplace.js',
  ]) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const appSrc = read('js/app.js');
  const s0 = appSrc.indexOf('class BimEntityManager {');
  const s1 = appSrc.indexOf('\nclass App {');
  vm.runInContext(appSrc.slice(s0, s1), ctx, { filename: 'app.js#BimEntityManager' });

  const { G, Model, GridPlaceFeature } = sandbox.window;
  const BimEntityManager = vm.runInContext('BimEntityManager', ctx);
  const GridManager = vm.runInContext('GridManager', ctx);
  const StructuralManager = sandbox.window.StructuralManager;

  const makeWorld = () => {
    const m = new Model();
    m.bimEntities = [];
    m.levels = [{ id: 'lvl1', name: 'Level 1', elevation: 0 }];
    const bim = new BimEntityManager(m);
    const toasts = [];
    const view = new Proxy({}, { get: () => () => { } }); // preview no-ops
    const app = {
      model: m, bim, toasts, view,
      toast(msg, isErr) { toasts.push({ msg, isErr: !!isErr }); },
      setStatus() { },
      levelManager: { levels: m.levels, getElevation: () => 0, getLevel: id => m.levels.find(l => l.id === id) },
      gridManager: new GridManager(m),
      bimOptions: { baseLevel: 'lvl1', topConstraint: 'unconnected', unconnectedHeight: 3 },
      transaction: {
        begin() { return { commit() { }, rollback() { }, rolledBack: false }; },
        run(label, fn) { return fn(m); },
      },
      cleanupWires() { return 0; },
      syncStructuralWalls() { return 0; },
    };
    app.structural = StructuralManager.attach(app);
    const tool = new GridPlaceFeature.GridPlaceTool(app);
    tool.app = app;
    tool.activate();
    return { m, bim, app, tool, toasts, gm: app.gridManager };
  };
  const setState = (w, state) => { w.tool.state = Object.assign({
    selectWhat: 'intersections', placeWhat: 'columns', width: 0.3, depth: 0.3,
    wallThickness: 0.2, beamProfile: 'rectangular', beamHeight: 0.4, beamWidth: 0.2,
    flangeWidth: 0.4, flangeThickness: 0.08, slabKind: 'slab', slabThickness: 0.2,
  }, state); };

  // ------------------------------------------------------- cell enumeration
  test('cells: a 3x3-spacing system has 4 bays with exact corners', () => {
    const w = makeWorld();
    w.gm.generateOrthogonal({ xSpacings: [3, 3], ySpacings: [3, 3], origin: [0, 0] });
    const cells = w.tool._cells();
    eq(cells.length, 4, '2x2 bays');
    const first = cells.find(c => {
      const xs = c.ring.map(p => p[0]), ys = c.ring.map(p => p[1]);
      return Math.min(...xs) === 0 && Math.min(...ys) === 0;
    });
    ok(first, 'origin bay exists');
    // ring: (A∩1) (A∩2) (B∩2) (B∩1) — the X-family pair wound with the Y pair
    near(first.ring[0][0], 0, 1e-9); near(first.ring[0][1], 0, 1e-9);
    near(first.ring[1][0], 3, 1e-9); near(first.ring[1][1], 0, 1e-9);
    near(first.ring[2][0], 3, 1e-9); near(first.ring[2][1], 3, 1e-9);
    near(first.ring[3][0], 0, 1e-9); near(first.ring[3][1], 3, 1e-9);
    ok(new Set(cells.map(c => c.key)).size === 4, 'keys unique');
  });

  test('cells: curved grids are skipped; containment test works', () => {
    const w = makeWorld();
    w.gm.generateOrthogonal({ xSpacings: [3], ySpacings: [3], origin: [0, 0] });
    eq(w.tool._cells().length, 1, 'one bay');
    const GridLineC = sandbox.window.GridLine || vm.runInContext('GridLine', ctx);
    w.gm.grids.push(new GridLineC({ name: 'X', start: [10, 0], end: [10, 6], isCurved: true, mid: [11, 3] }));
    eq(w.tool._cells().length, 1, 'curved neighbor adds no bay');
    const cell = w.tool._cells()[0];
    ok(w.tool._inCell([1.5, 1.5], cell), 'center inside');
    ok(!w.tool._inCell([3.5, 1.5], cell), 'outside');
    ok(!w.tool._inCell([1.5, -0.5], cell), 'below');
  });

  // ------------------------------------------------------------- grid beams
  test('beams on a selected grid line run center-to-center and weld into columns', () => {
    const w = makeWorld();
    w.gm.generateOrthogonal({ xSpacings: [3, 3], ySpacings: [3, 3], origin: [0, 0] });
    // columns at the three crossings of grid 2 — the beams must pass
    // through and weld (cast-in-place), not stop short of them
    const colAt = (x, y) => {
      const params = { base: [x, y, 0], width: 0.4, depth: 0.4, baseLevelId: 'lvl1', topLevelId: null, height: 3 };
      w.app.structural.buildColumn(G, w.m, params);
      w.app.bim.create('column', { ...params, baseLevel: 'lvl1', topConstraint: 'unconnected' }, {}, []);
    };
    colAt(3, 0); colAt(3, 3); colAt(3, 6);
    setState(w, { selectWhat: 'lines', placeWhat: 'beams', beamHeight: 0.5, beamWidth: 0.25 });
    const g2 = w.gm.grids.find(g => g.name === '2'); // middle vertical, 3 crossings
    w.tool.selLine.add(g2.id);
    w.tool._place();
    const beams = w.bim.entities.filter(e => e.type === 'beam');
    eq(beams.length, 2, 'two spans between three intersections');
    const b1 = beams[0].params, b2 = beams[1].params;
    near(b1.baseline[0][0], 3, 1e-9); near(b1.baseline[0][1], 0, 1e-9);
    near(b1.baseline[1][0], 3, 1e-9); near(b1.baseline[1][1], 3, 1e-9);
    near(b2.baseline[0][1], 3, 1e-9); near(b2.baseline[1][1], 6, 1e-9);
    near(b1.height, 0.5, 1e-9, 'section height from the options');
    near(b1.webWidth, 0.25, 1e-9, 'section width from the options');
    ok(b1.referenceLevelId === 'lvl1' && b1.zJustification === 'Top', 'hangs from the working level');
    ok(w.m.validate().ok, 'model valid with beams through columns');
    for (const b of beams) ok(b.faces.length > 0 && b.faces.some(id => w.m.faces.has(id)), 'live geometry');
    ok(w.toasts.some(t => /2 beams/.test(t.msg)), 'toast: ' + JSON.stringify(w.toasts.map(t => t.msg)));
  });

  // ------------------------------------------------------- floors and slabs
  test('slab over one selected cell: extrudes down, registers regions', () => {
    const w = makeWorld();
    w.gm.generateOrthogonal({ xSpacings: [3], ySpacings: [3], origin: [0, 0] });
    setState(w, { selectWhat: 'cells', placeWhat: 'floors', slabThickness: 0.25, slabKind: 'slab' });
    for (const c of w.tool._cells()) w.tool.selCell.add(c.key);
    w.tool._place();
    const slabs = w.bim.entities.filter(e => e.type === 'slab');
    eq(slabs.length, 1, 'one slab');
    const p = slabs[0].params;
    near(p.thickness, 0.25, 1e-9, 'thickness from the options');
    eq(p.regions.length, 1, 'one region');
    eq(p.regions[0].outer.length, 4, 'rectangular bay');
    ok(p.regions[0].outer.every(q => Math.abs(q[2] - 5e-4) < 1e-9), 'region on the level plane (0.5 mm reveal)');
    ok(w.m.validate().ok, 'model valid');
    // extrusion went DOWN: some face centroid sits at z = -thickness
    const zs = slabs[0].faces.map(id => w.m.faces.get(id)).filter(Boolean).map(f => w.m.faceCentroid(f).z);
    ok(zs.some(z => Math.abs(z + 0.25 - 5e-4) < 1e-6), 'bottom at reveal-t: ' + JSON.stringify(zs));
    eq(w.tool.selCell.size, 0, 'selection consumed');
  });

  test('floor kind creates a non-structural floor entity', () => {
    const w = makeWorld();
    w.gm.generateOrthogonal({ xSpacings: [3], ySpacings: [3], origin: [0, 0] });
    setState(w, { selectWhat: 'cells', placeWhat: 'floors', slabKind: 'floor' });
    for (const c of w.tool._cells()) w.tool.selCell.add(c.key);
    w.tool._place();
    eq(w.bim.entities.filter(e => e.type === 'floor').length, 1, 'floor entity');
    eq(w.bim.entities.filter(e => e.type === 'slab').length, 0, 'no slab');
    ok(w.m.validate().ok, 'model valid');
  });

  test('corner column is not punched; a strictly-inside column is', () => {
    // realistic story: columns run Level 1 -> Level 2, the slab fills at
    // Level 2 and hangs down — pass-through columns punch, corner ones
    // straddle the boundary and stay with the takeoff (Column > Slab)
    const make2 = () => {
      const w = makeWorld();
      w.m.levels = [{ id: 'lvl1', name: 'Level 1', elevation: 0 }, { id: 'lvl2', name: 'Level 2', elevation: 3 }];
      w.app.levelManager = {
        levels: w.m.levels,
        getElevation: id => (w.m.levels.find(l => l.id === id) || {}).elevation || 0,
        getLevel: id => w.m.levels.find(l => l.id === id),
      };
      w.app.bimOptions.baseLevel = 'lvl2';
      w.gm.generateOrthogonal({ xSpacings: [3], ySpacings: [3], origin: [0, 0] });
      setState(w, { selectWhat: 'cells', placeWhat: 'floors' });
      for (const c of w.tool._cells()) w.tool.selCell.add(c.key);
      return w;
    };
    const column = (w, x, y) => {
      const params = { base: [x, y, 0], width: 0.3, depth: 0.3, baseLevelId: 'lvl1', topLevelId: 'lvl2', height: 3 };
      w.app.structural.buildColumn(G, w.m, params);
      w.app.bim.create('column', { ...params, baseLevel: 'lvl1', topConstraint: 'lvl2' }, {}, []);
    };
    const w1 = make2();
    column(w1, 0, 0); // bay corner
    w1.tool._place();
    const slab1 = w1.bim.entities.find(e => e.type === 'slab');
    eq(slab1.params.regions[0].holes.length, 0, 'corner column straddles — no punch');
    ok(w1.m.validate().ok, 'model valid');

    const w2 = make2();
    column(w2, 1.5, 1.5); // bay center, strictly inside
    w2.tool._place();
    const slab2 = w2.bim.entities.find(e => e.type === 'slab');
    eq(slab2.params.regions[0].holes.length, 1, 'inside column punches');
    ok(w2.m.validate().ok, 'model valid');
  });

  // ------------------------------------------- walls in the bay (the crash)
  test('slab over cells with walls on the grid lines lands with real area', () => {
    // the bay plane is where wall undersides live — a flush slab fused with
    // them and produced a 0 m² ghost (or rolled the tx-guard back); the
    // 0.5 mm reveal keeps every face off the shared plane
    const w = makeWorld();
    w.gm.generateOrthogonal({ xSpacings: [6, 6], ySpacings: [6, 6], origin: [0, 0] });
    const WT = sandbox.window.BimTools.WallTool;
    const vv = (x, y, z = 0) => G.v(x, y, z);
    const buildWall = (base, end) => {
      const ring = WT.bandRing(G, [vv(...base), vv(...end)], 0.2, 'centerline');
      const before = new Set(w.m.faces.keys());
      const f = w.m.addFaceFromRings(ring.map(q => G.clone(q)));
      w.m.pushPull(f, 3);
      const faces = [...w.m.faces.keys()].filter(id => !before.has(id));
      const roles = {};
      for (const fid of faces) {
        const c = w.m.faceCentroid(w.m.faces.get(fid));
        roles[fid] = Math.abs(c.z - 3) < 1e-6 ? 'top' : Math.abs(c.z) < 1e-6 ? 'bottom' : 'side';
      }
      return w.bim.create('wall', {
        base: [...base], end: [...end], height: 3, thickness: 0.2,
        baseLevel: 'lvl1', topConstraint: 'lvl2',
        locationLine: 'centerline', primitive: 'line', closed: false, joins: { start: 0, end: 0 },
      }, roles, []);
    };
    // a room: walls on the grid lines around cell (0..6)^2 + one crossing
    buildWall([0, 0, 0], [6, 0, 0]);
    buildWall([6, 0, 0], [6, 6, 0]);
    buildWall([6, 6, 0], [0, 6, 0]);
    buildWall([0, 6, 0], [0, 0, 0]);
    setState(w, { selectWhat: 'cells', placeWhat: 'floors' });
    for (const c of w.tool._cells()) w.tool.selCell.add(c.key);
    let threw = null;
    try { w.tool._place(); } catch (e) { threw = e; }
    ok(!threw, 'no crash: ' + (threw && threw.message));
    ok(w.m.validate().ok, 'model valid');
    const slabs = w.bim.entities.filter(e => e.type === 'slab' || e.type === 'floor');
    ok(slabs.length > 0, 'slab entity exists');
    ok(slabs.every(s => s.faces.some(id => w.m.faces.has(id))), 'slab has live geometry (not a 0 m² ghost)');
    ok(!w.toasts.some(t => t.isErr && /rolled back|failed/i.test(t.msg)), 'no rollback: ' + JSON.stringify(w.toasts.map(t => t.msg)));
  });

  // --------------------------------------------- location line on grid slabs
  test('location line: exterior expands past the columns\' outer faces (+0.2 + 1 mm per side)', () => {
    const w = makeWorld();
    w.gm.generateOrthogonal({ xSpacings: [6], ySpacings: [6], origin: [0, 0] });
    // the user's example: centered 0.4 x 0.4 columns at the bay corners
    for (const [x, y] of [[0, 0], [6, 0], [6, 6], [0, 6]]) {
      w.bim.create('column', { base: [x, y, 0], width: 0.4, depth: 0.4, baseLevel: 'lvl1', topConstraint: 'unconnected', height: 3 }, {}, []);
    }
    const cell = w.tool._cells()[0];
    const ring = w.tool._cellRing(cell, 'exterior');
    // each side moves 0.2 + 1 mm outward (the 1 mm overshoot makes the
    // columns STRICTLY inside so the punch pass cuts them out cleanly)
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    near(Math.min(...xs), -0.201, 1e-9, 'left edge past the column face');
    near(Math.max(...xs), 6.201, 1e-9, 'right edge past the column face');
    near(Math.min(...ys), -0.201, 1e-9);
    near(Math.max(...ys), 6.201, 1e-9);
  });

  test('location line: interior stops at the columns\' near faces (−0.2 per side)', () => {
    const w = makeWorld();
    w.gm.generateOrthogonal({ xSpacings: [6], ySpacings: [6], origin: [0, 0] });
    for (const [x, y] of [[0, 0], [6, 0], [6, 6], [0, 6]]) {
      w.bim.create('column', { base: [x, y, 0], width: 0.4, depth: 0.4, baseLevel: 'lvl1', topConstraint: 'unconnected', height: 3 }, {}, []);
    }
    const cell = w.tool._cells()[0];
    const ring = w.tool._cellRing(cell, 'interior');
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    near(Math.min(...xs), 0.2, 1e-9, 'clear of the column');
    near(Math.max(...xs), 5.8, 1e-9);
    near(Math.min(...ys), 0.2, 1e-9);
    near(Math.max(...ys), 5.8, 1e-9);
  });

  test('location line: no columns -> exterior/interior stay on the grid lines', () => {
    const w = makeWorld();
    w.gm.generateOrthogonal({ xSpacings: [6], ySpacings: [6], origin: [0, 0] });
    const cell = w.tool._cells()[0];
    for (const mode of ['centerline', 'exterior', 'interior']) {
      const ring = w.tool._cellRing(cell, mode);
      eq(JSON.stringify(ring), JSON.stringify(cell.ring), mode + ' with no columns keeps the grid ring');
    }
  });

  test('grid slab with exterior location lands expanded and valid', () => {
    // two-story world: columns L1->L2, slab fills at L2 hanging down — the
    // corner columns PASS THROUGH the band (the user's real scenario)
    const w = makeWorld();
    w.m.levels = [{ id: 'lvl1', name: 'Level 1', elevation: 0 }, { id: 'lvl2', name: 'Level 2', elevation: 3 }];
    w.app.levelManager = {
      levels: w.m.levels,
      getElevation: id => (w.m.levels.find(l => l.id === id) || { elevation: 0 }).elevation,
      getLevel: id => w.m.levels.find(l => l.id === id),
    };
    w.app.bimOptions.baseLevel = 'lvl2';
    w.gm.generateOrthogonal({ xSpacings: [6], ySpacings: [6], origin: [0, 0] });
    for (const [x, y] of [[0, 0], [6, 0], [6, 6], [0, 6]]) {
      w.app.structural.buildColumn(G, w.m, { base: [x, y, 0], width: 0.4, depth: 0.4, baseLevelId: 'lvl1', topLevelId: 'lvl2', height: 3 });
      w.bim.create('column', { base: [x, y, 0], width: 0.4, depth: 0.4, baseLevel: 'lvl1', topConstraint: 'lvl2', height: 3 }, {}, []);
    }
    setState(w, { selectWhat: 'cells', placeWhat: 'floors', slabLoc: 'exterior' });
    for (const c of w.tool._cells()) w.tool.selCell.add(c.key);
    let threw = null;
    try { w.tool._place(); } catch (e) { threw = e; }
    ok(!threw, 'no crash: ' + (threw && threw.message));
    ok(w.m.validate().ok, 'model valid');
    const slab = w.bim.entities.find(e => e.type === 'slab');
    ok(slab, 'slab entity');
    eq(slab.params.locationLine, 'exterior', 'location recorded on the entity');
    const xs = slab.params.regions[0].outer.map(p => p[0]);
    near(Math.min(...xs), -0.201, 1e-9, 'region expanded past the column faces');
    near(Math.max(...xs), 6.201, 1e-9);
    ok(slab.params.regions[0].outer.every(p => Math.abs(p[2] - (3 + 5e-4)) < 1e-9), 'region on the L2 plane with the reveal');
    ok(slab.faces.some(id => w.m.faces.has(id)), 'live geometry');
    ok(w.toasts.some(t => /exterior: covers the columns/.test(t.msg)), 'toast names the location: ' + JSON.stringify(w.toasts.map(t => t.msg)));
    // OWNERSHIP: slab and columns are separate elements — the corner columns
    // punch through, and any welder split inside a column keeps the COLUMN's
    // stamp (never the slab's), so selecting one never selects both
    eq(slab.params.regions[0].holes.length, 4, 'the four corner columns punch through');
    const cols = w.bim.entities.filter(e => e.type === 'column');
    let slabFacesInColumns = 0;
    for (const fid of slab.faces) {
      const f = w.m.faces.get(fid);
      if (!f) continue;
      const c = w.m.faceCentroid(f);
      for (const col of cols) {
        const b = col.params.base, hw = col.params.width / 2 + 1e-6, hd = col.params.depth / 2 + 1e-6;
        if (c.x > b[0] - hw && c.x < b[0] + hw && c.y > b[1] - hd && c.y < b[1] + hd
          && c.z > 0.001 && c.z < 3 - 0.001) slabFacesInColumns++;
      }
    }
    eq(slabFacesInColumns, 0, 'no slab-stamped face inside a column body');
    for (const col of cols) ok(col.faces.length > 0, col.id + ' keeps its own faces');
  });
};
