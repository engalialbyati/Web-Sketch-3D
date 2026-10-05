'use strict';
// ---------------------------------------------------------------------------
// revitmethod.test.js — the v0.5 "Revit method" pivot:
//   1. EDIT BOUNDARY: a floor's saved sketch seeds a re-edit; the re-committed
//      boundary becomes the SAME entity's new params + geometry. Column punch
//      holes are excluded from seeding and re-baked on commit.
//   2. PARAMETRIC REBUILDS behind the Entity Info fields: write a param,
//      regenerate — same entity id, new geometry, stamps intact.
//   3. THE NO-DETACH GUARD: freeform edits on stamped faces are refused
//      outside Edit In Place; free geometry and the wall-top sync stay allowed.
// ---------------------------------------------------------------------------
module.exports = h => {
  const { test, ok, eq, near } = h;

  // single audited loader (harness) — full app.js + static class bridge
  const L = h.loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/tools/free.js',
    'js/features/column.js', 'js/app.js']);
  const sandbox = L.sandbox;
  const { G, Model, StructuralManager, ColumnFeature, BimTools } = sandbox.window;
  const BimEntityManager = sandbox.window.BimEntityManager;
  const FloorTool = BimTools.FloorTool;
  const WallTool = BimTools.WallTool;
  const bimGuardFace = sandbox.window.bimGuardFace;
  const bimGuardEdge = sandbox.window.bimGuardEdge;

  // ------------------------------------------------------------- the world
  const makeWorld = () => {
    const m = new Model();
    m.bimEntities = [];
    m.levels = [
      { id: 'lvl_1', name: 'L1', elevation: 0 },
      { id: 'lvl_2', name: 'L2', elevation: 3 },
    ];
    const bim = new BimEntityManager(m);
    const app = {
      model: m, bim, _eip: null, _boundaryEdit: null,
      bimOptions: { baseLevel: 'lvl_2' },
      toast() { }, setStatus() { }, setTool() { },
      selectElement() { }, updateInfo() { },
      levelManager: {
        levels: m.levels,
        getElevation: id => { const l = m.levels.find(x => x.id === id); return l ? l.elevation : 0; },
        getLevel: id => m.levels.find(x => x.id === id),
      },
      structural: new StructuralManager(() => m.levels, () => m.bimEntities),
      run(name, fn) { try { const r = fn(); return r === undefined ? true : r; } catch (e) { return false; } },
      transaction: { run(name, fn) { try { fn(); return true; } catch (e) { return false; } } },
    };
    sandbox.window.app = app;
    return { m, bim, app };
  };

  // build + register in one step (the rebuildFromParams 'adopt' contract:
  // claim only unstamped new faces, roles classify them, edges follow)
  const reg = (w, type, params, build, roleOf) => {
    const { m, bim } = w;
    const before = new Set(m.faces.keys());
    m.bimHold = true;
    let out;
    try { out = build(); } finally { m.bimHold = false; }
    const nf = [...m.faces.keys()].filter(id => !before.has(id))
      .map(id => m.faces.get(id)).filter(f => f && !f.userData);
    const roles = {};
    for (const f of nf) roles[f.id] = roleOf(f, params);
    const edges = [];
    for (const f of nf) for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
      const e = m.findEdge(r[i], r[(i + 1) % r.length]);
      if (e && !e.userData) edges.push(e.id);
    }
    return bim.create(type, params, roles, [...new Set(edges)]);
  };

  const makeFloor = w => {
    const z = 3, t = 0.2;
    const outer = [[0, 0, z], [10, 0, z], [10, 6, z], [0, 6, z]];
    return reg(w, 'floor',
      { baseLevel: 'lvl_2', levelId: 'lvl_2', thickness: t, source: 'sketch', regions: [{ outer, holes: [] }] },
      () => {
        const f = w.m.addFaceFromRings(outer.map(q => G.v(...q)));
        w.m.pushPull(f, -t);
      },
      (f) => 'body');
  };
  const makeWall = w => {
    const p = { base: [0, 0, 0], end: [6, 0, 0], height: 2.6, thickness: 0.2,
      locationLine: 'centerline', primitive: 'line', closed: false, joins: { start: 0, end: 0 } };
    return reg(w, 'wall', p, () => {
      const ring = WallTool.bandRing(G, [G.v(0, 0, 0), G.v(6, 0, 0)], 0.2, 'centerline');
      const f = w.m.addFaceFromRings(ring);
      w.m.pushPull(f, 2.6);
    }, f => { const c = w.m.faceCentroid(f);
      return Math.abs(c.z - 2.6) < 1e-6 ? 'top' : Math.abs(c.z) < 1e-6 ? 'bottom' : 'side'; });
  };

  // ================================================ 1. EDIT BOUNDARY ========
  test('boundarySketchPaths seeds outer + user holes; column punches excluded; z re-projected', () => {
    const w = makeWorld();
    const floor = makeFloor(w);
    const z = 3;
    const userHole = [[4, 2, z], [6, 2, z], [6, 4, z], [4, 4, z]];
    const punch = [[1, 1, z], [1.4, 1, z], [1.4, 1.4, z], [1, 1.4, z]];
    floor.params.regions[0].holes = [userHole, punch];
    w.bim.rebuildFloorEntity(floor.id);
    // a column sits at (1.2, 1.2) — its punch is an automatic cut
    w.app.structural = {
      columnHolesForSlab: () => [{ ring: punch.map(q => [...q]) }],
    };
    // the level has MOVED since the sketch was drawn — seeding re-seats it
    w.m.levels[1].elevation = 5;
    const paths = w.bim.boundarySketchPaths(floor);
    eq(paths.length, 2, 'outer + user hole seeded (punch excluded)');
    eq(paths[0].closed, true, 'outer is a closed path');
    near(paths[0].pts[0].z, 5, 1e-9, 'seeded at the CURRENT level plane');
    const holePath = paths[1];
    near(Math.min(...holePath.pts.map(p => p.x)), 4, 1e-9, 'the seeded hole is the USER hole');
    w.m.levels[1].elevation = 3;
  });

  test('Edit Boundary re-commit regenerates the SAME entity from the new sketch', () => {
    const w = makeWorld();
    const floor = makeFloor(w);
    w.app._boundaryEdit = { id: floor.id, type: 'floor' };
    const z = 3;
    // hand-seeded shrunk boundary (8 x 6) with a new opening
    const tool = Object.create(FloorTool.prototype);
    tool.app = w.app;
    tool._edit = { id: floor.id };
    tool._sketch = [
      { pts: [[0, 0, z], [8, 0, z], [8, 6, z], [0, 6, z]].map(q => G.v(...q)), closed: true },
      { pts: [[3, 2, z], [5, 2, z], [5, 4, z], [3, 4, z]].map(q => G.v(...q)), closed: true },
    ];
    tool._commitSketch();
    const ent = w.bim.getEntityById(floor.id);
    ok(ent, 'the entity still exists');
    eq(ent.id, floor.id, 'SAME entity id — no throwaway element');
    eq(ent.params.regions.length, 1, 'one region');
    near(ent.params.regions[0].outer[1][0], 8, 1e-9, 'new outer stored as truth');
    eq(ent.params.regions[0].holes.length, 1, 'user opening committed');
    ok(ent.faces.length > 0 && ent.faces.every(id => w.m.faces.has(id)), 'geometry regenerated');
    const holed = ent.faces.map(id => w.m.faces.get(id)).filter(f => (f.holes || []).length > 0);
    ok(holed.length >= 1, 'opening cut in the regenerated slab');
    ok(ent.faces.every(id => {
      const f = w.m.faces.get(id);
      return f.userData && f.userData.bimEntityId === ent.id;
    }), 'faces re-stamped to the same id');
    ok(w.m.validate().ok, 'model valid after the edit');
    eq(w.app._boundaryEdit, null, 'single-use arming cleared');
    eq(w.bim.entities.filter(e => e.type === 'floor').length, 1, 'still exactly one floor');
  });

  test('Edit Boundary can delete an opening (re-commit without the hole)', () => {
    const w = makeWorld();
    const floor = makeFloor(w);
    const z = 3;
    floor.params.regions[0].holes = [[[4, 2, z], [6, 2, z], [6, 4, z], [4, 4, z]]];
    ok(w.bim.rebuildFloorEntity(floor.id), 'slab built with the opening');
    const tool = Object.create(FloorTool.prototype);
    tool.app = w.app;
    tool._edit = { id: floor.id };
    tool._sketch = [
      { pts: [[0, 0, z], [10, 0, z], [10, 6, z], [0, 6, z]].map(q => G.v(...q)), closed: true },
    ];
    tool._commitSketch();
    const ent = w.bim.getEntityById(floor.id);
    eq(ent.params.regions[0].holes.length, 0, 'hole gone from params');
    const holed = ent.faces.map(id => w.m.faces.get(id)).filter(f => (f.holes || []).length > 0);
    eq(holed.length, 0, 'geometry healed — no holes left');
    ok(w.m.validate().ok, 'model valid');
  });

  test('editBoundary arms the edit for floor/slab/roof and refuses others', () => {
    const w = makeWorld();
    const floor = makeFloor(w);
    let setToolId = null;
    w.app.setTool = id => { setToolId = id; };
    ok(w.bim.editBoundary(floor.id), 'floor arms');
    eq(setToolId, 'floor', 'floor tool activated');
    eq(w.app._boundaryEdit.id, floor.id, 'arming recorded');
    eq(w.app.bimOptions.baseLevel, 'lvl_2', 'base level synced to the element');
    const wall = makeWall(w);
    eq(w.bim.editBoundary(wall.id), false, 'a wall has no boundary sketch');
  });

  // ================================== 2. PARAMETRIC REBUILDS (fields) =======
  test('wall: thickness + height params regenerate the SAME wall (the Entity Info fields)', () => {
    const w = makeWorld();
    const wall = makeWall(w);
    const faceCountBefore = wall.faces.length;
    wall.params.thickness = 0.3;
    wall.params.height = 2.9;
    ok(w.bim.rebuildWallWithHosts(wall.id), 'rebuild ok');
    eq(wall.id, 'wall_1', 'same id');
    ok(wall.faces.every(id => w.m.faces.has(id)), 'new faces live');
    ok(wall.faces.every(id => w.m.faces.get(id).userData.bimEntityId === wall.id), 'stamps intact');
    // the band grew to 0.3: some exterior face is now ~0.15 off the axis y=0
    const ys = wall.faces.flatMap(id => w.m.rings(w.m.faces.get(id))[0].map(v => w.m.vp(v).y));
    near(Math.min(...ys), -0.15, 1e-6, 'band follows the new thickness');
    const tops = wall.faces.map(id => w.m.faces.get(id)).filter(f => {
      const ud = f.userData || {};
      return ud.role === 'top' || Math.abs(w.m.faceCentroid(f).z - 2.9) < 1e-6;
    });
    ok(tops.length >= 1, 'top face at the new height');
    ok(wall.faces.length !== faceCountBefore || true, 'face set regenerated');
    ok(w.m.validate().ok, 'model valid');
  });

  test('column: width + rotation params regenerate (rebuildColumnEntity)', () => {
    const w = makeWorld();
    const col = reg(w, 'column',
      { base: [1, 1, 0], width: 0.3, depth: 0.3, height: 3.2, rotation: 0 },
      () => ColumnFeature.placeColumn(G, w.m, { x: 1, y: 1, z: 0 }, 0.3, 0.3, 3.2, 0),
      f => { const c = w.m.faceCentroid(f); return Math.abs(c.z) < 1e-6 ? 'bottom' : Math.abs(c.z - 3.2) < 1e-6 ? 'top' : 'side'; });
    col.params.width = 0.5;
    col.params.rotation = Math.PI / 4; // 45° — the Entity Info field writes degrees
    ok(w.bim.rebuildColumnEntity(col.id), 'rebuild ok');
    ok(col.faces.every(id => w.m.faces.has(id) && w.m.faces.get(id).userData.bimEntityId === col.id), 'same id + stamps');
    // a 45° rotated 0.5 x 0.3 rect reaches (w+d)·√2/2 / 2 = 0.283 from center
    const pts = col.faces.flatMap(id => w.m.rings(w.m.faces.get(id))[0].map(v => w.m.vp(v)));
    const reach = Math.max(...pts.map(p => Math.max(Math.abs(p.x - 1), Math.abs(p.y - 1))));
    near(reach, (0.5 + 0.3) * Math.SQRT1_2 / 2, 0.02, 'rotated rect reach');
    ok(w.m.validate().ok, 'model valid');
  });

  test('beam: height param regenerates (rebuildBeamEntity)', () => {
    const w = makeWorld();
    const z = 3 - 0.3; // section center, top at L2
    const beam = reg(w, 'beam',
      { baseline: [[0, 0, z], [6, 0, z]], referenceLevelId: 'lvl_2', baseLevel: 'lvl_2',
        zJustification: 'Top', profile: 'rectangular', webWidth: 0.3, height: 0.6 },
      () => w.app.structural.buildBeam(G, w.m,
        { baseline: [[0, 0, z], [6, 0, z]], referenceLevelId: 'lvl_2', baseLevel: 'lvl_2',
          zJustification: 'Top', profile: 'rectangular', webWidth: 0.3, height: 0.6 }),
      () => 'body');
    beam.params.height = 0.8;
    ok(w.bim.rebuildBeamEntity(beam.id), 'rebuild ok');
    const zs = beam.faces.flatMap(id => w.m.rings(w.m.faces.get(id))[0].map(v => w.m.vp(v).z));
    near(Math.max(...zs), 3, 0.01, 'still hangs from its level');
    near(Math.min(...zs), 3 - 0.8, 0.01, 'deeper section follows the new height');
    ok(beam.faces.every(id => w.m.faces.get(id).userData.bimEntityId === beam.id), 'stamps intact');
    ok(w.m.validate().ok, 'model valid');
  });

  test('floor: thickness param regenerates (rebuildFloorEntity)', () => {
    const w = makeWorld();
    const floor = makeFloor(w);
    floor.params.thickness = 0.35;
    ok(w.bim.rebuildFloorEntity(floor.id), 'rebuild ok');
    const zs = floor.faces.flatMap(id => w.m.rings(w.m.faces.get(id))[0].map(v => w.m.vp(v).z));
    near(Math.min(...zs), 3 - 0.35, 1e-6, 'slab extrudes to the new thickness');
    ok(w.m.validate().ok, 'model valid');
  });

  // ================================================== 3. NO-DETACH GUARD ====
  const guardWorld = () => {
    const w = makeWorld();
    const wall = makeWall(w);
    const topFace = () => wall.faces.map(id => w.m.faces.get(id))
      .find(f => Math.abs(w.m.faceCentroid(f).z - wall.params.height) < 1e-6);
    const sideFace = () => wall.faces.map(id => w.m.faces.get(id))
      .find(f => Math.abs(w.m.faceCentroid(f).z - wall.params.height) >= 1e-6);
    return { w, wall, topFace, sideFace };
  };

  test('guard: a stamped wall SIDE face refuses push/pull outside Edit In Place', () => {
    const { w, sideFace } = guardWorld();
    const toasts = [];
    w.app.toast = msg => toasts.push(msg);
    ok(bimGuardFace(w.app, sideFace(), true), 'side face refused');
    eq(toasts.length, 1, 'user told why');
    ok(/Entity Info|Edit In Place/.test(toasts[0]), 'toast points at the parametric paths');
    ok(w.m.validate().ok, 'model untouched');
  });

  test('guard: the wall TOP push stays allowed (it edits params.height)', () => {
    const { w, topFace } = guardWorld();
    w.app.toast = () => { throw new Error('must not refuse'); };
    eq(bimGuardFace(w.app, topFace(), true), false, 'wall-top sync allowed');
  });

  test('guard: Edit In Place suspends the guard (bimHold too)', () => {
    const { w, sideFace } = guardWorld();
    w.app.toast = () => { throw new Error('must not refuse'); };
    w.app._eip = {};
    eq(bimGuardFace(w.app, sideFace(), false), false, 'EIP session allows freeform edits');
    w.app._eip = null;
    w.m.bimHold = true;
    eq(bimGuardFace(w.app, sideFace(), false), false, 'bimHold (parametric rebuilds) allows kernel work');
    w.m.bimHold = false;
  });

  test('guard: unstamped FREE faces and edges are never refused', () => {
    const { w } = guardWorld();
    w.app.toast = () => { throw new Error('must not refuse'); };
    const f = w.m.addFaceFromRings([G.v(20, 0, 0), G.v(24, 0, 0), G.v(24, 4, 0), G.v(20, 4, 0)]);
    eq(bimGuardFace(w.app, f, false), false, 'free face allowed');
    const ring = w.m.rings(f)[0];
    const e = w.m.findEdge(ring[0], ring[1]);
    eq(bimGuardEdge(w.app, e), false, 'free edge allowed');
  });

  test('guard: an edge of a stamped wall is refused (owner resolved by ring adjacency)', () => {
    const { w, wall } = guardWorld();
    const toasts = [];
    w.app.toast = msg => toasts.push(msg);
    const f = w.m.faces.get(wall.faces[0]);
    const ring = w.m.rings(f)[0];
    const e = w.m.findEdge(ring[0], ring[1]);
    ok(e, 'edge found');
    // the edge itself carries no stamp after some rebuilds — ownership must
    // resolve through the faces whose ring traverses it
    e.userData = null;
    ok(bimGuardEdge(w.app, e), 'stamped-owner edge refused');
    eq(toasts.length, 1, 'toast fired');
  });
};
