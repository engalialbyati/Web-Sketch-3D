'use strict';
// ---------------------------------------------------------------------------
// wallface.test.js — v0.6 ELEMENT INDEPENDENCE for walls:
//   "A wall is NEVER divided by the columns and beams standing in its path."
// Real BimEntityManager + real StructuralManager + real Model. Columns at a
// wall's end and center, walls drawn through standing columns, spandrel
// beams riding the wall — the wall keeps its run and identity; elements
// overlap by ELEMENT_EPS instead of splitting (the IFC contract). The old
// wall-face rule (split + heal) is retired with v0.5.
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
  const appSrc = read('js/app.js');
  const start = appSrc.indexOf('class BimEntityManager {');
  const end = appSrc.indexOf('\nclass App {');
  if (start < 0 || end < 0) throw new Error('could not slice BimEntityManager from app.js');
  vm.runInContext(appSrc.slice(start, end), ctx, { filename: 'app.js#BimEntityManager' });

  const { G, Model, BimTools, StructuralManager } = sandbox.window;
  const WallTool = BimTools.WallTool;
  const BimEntityManager = vm.runInContext('BimEntityManager', ctx);
  const v = (x, y, z = 0) => G.v(x, y, z);

  const makeWorld = () => {
    const m = new Model();
    m.bimEntities = [];
    const bim = new BimEntityManager(m);
    const toasts = [];
    const app = {
      model: m, bim, toasts,
      toast(msg, isErr) { toasts.push({ msg, isErr: !!isErr }); },
      setStatus() { },
      levelManager: { getElevation: () => 0 },
      gridManager: null,
      structural: null,
    };
    app.structural = new StructuralManager(() => m.levels, () => m.bimEntities);
    sandbox.window.app = app; // planTrimWall reaches the app via window.app
    return { m, bim, app, toasts };
  };

  // a plain freeform wall straight through the model API + registry — the
  // exact shape of a wall drawn off-grid in precise drawing mode
  const buildWall = (w, base, end) => {
    const ring = WallTool.bandRing(G, [v(...base), v(...end)], 0.2, 'centerline');
    const before = new Set(w.m.faces.keys());
    let f = null;
    w.m.bimHold = true; // v0.6: BIM builds hold the model (element islands)
    try {
      f = w.m.addFaceFromRings(ring.map(q => G.clone(q)));
      w.m.pushPull(f, 3);
    } finally { w.m.bimHold = false; }
    const faces = [...w.m.faces.keys()].filter(id => !before.has(id));
    const roles = {};
    for (const fid of faces) {
      const c = w.m.faceCentroid(w.m.faces.get(fid));
      roles[fid] = Math.abs(c.z - 3) < 1e-6 ? 'top'
        : Math.abs(c.z - base[2]) < 1e-6 ? 'bottom' : 'side';
    }
    return w.bim.create('wall', {
      base: [...base], end: [...end], height: 3, thickness: 0.2,
      locationLine: 'centerline', primitive: 'line', closed: false,
    }, roles, []);
  };

  // a column standing on z with a real prism body, registered like the
  // Column tool registers it — creating it marks nearby walls dirty
  const buildColumn = (w, x, y, z, width = 0.3, depth = 0.3, height = 3) => {
    const hw = width / 2, hd = depth / 2;
    const ring = [v(x - hw, y - hd, z), v(x + hw, y - hd, z), v(x + hw, y + hd, z), v(x - hw, y + hd, z)];
    const before = new Set(w.m.faces.keys());
    let f = null;
    w.m.bimHold = true;
    try {
      f = w.m.addFaceFromRings(ring);
      w.m.pushPull(f, height);
    } finally { w.m.bimHold = false; }
    const faces = [...w.m.faces.keys()].filter(id => !before.has(id));
    const roles = {};
    for (const fid of faces) {
      const c = w.m.faceCentroid(w.m.faces.get(fid));
      roles[fid] = Math.abs(c.z - (z + height)) < 1e-6 ? 'top'
        : Math.abs(c.z - z) < 1e-6 ? 'bottom' : 'side';
    }
    return w.bim.create('column', { base: [x, y, z], width, depth, height }, roles, []);
  };

  // opDone's dirty-entity regen (dependency order, walls last)
  const runDirty = w => {
    const hadDirty = w.bim._hostsDirty && w.bim._hostsDirty.size;
    const dirty = [...w.bim._hostsDirty];
    w.bim._hostsDirty.clear();
    const order = { column: 0, beam: 1, wall: 2 };
    dirty.sort((a, b) => (order[(w.bim.getEntityById(a) || {}).type] ?? 3)
      - (order[(w.bim.getEntityById(b) || {}).type] ?? 3));
    for (const id of dirty) {
      const ent = w.bim.getEntityById(id);
      if (!ent) continue;
      if (ent.type === 'wall') w.bim.planTrimWall(id); // v0.6: no-op, walls never split
    }
  };

  // every vertex x of every wall-owned face (ALL pieces), sorted — reads
  // the run-axis coverage of the wall body on the ground
  const allWallXs = w => {
    const xs = [];
    for (const wall of w.bim.entities.filter(e => e.type === 'wall'))
      for (const fid of wall.faces) {
        const f = w.m.faces.get(fid);
        if (!f) continue;
        for (const p of w.m.pts(f.loop)) xs.push(p.x);
      }
    return xs.sort((a, b) => a - b);
  };
  const pieceXs = (w, wall) => {
    const xs = [];
    for (const fid of wall.faces) {
      const f = w.m.faces.get(fid);
      if (!f) continue;
      for (const p of w.m.pts(f.loop)) xs.push(p.x);
    }
    return xs.sort((a, b) => a - b);
  };

  // ------------------------------------------------- the owner's reported case
  test('freeform wall: end + center columns leave it WHOLE (v0.6 independence)', () => {
    const w = makeWorld();
    const wall = buildWall(w, [0, 0, 0], [6, 0, 0]);
    ok(wall && wall.faces.length === 6, 'wall built (6 clean faces)');
    const facesBefore = [...wall.faces];
    buildColumn(w, 0, 0, 0);    // at the END
    buildColumn(w, 3, 0, 0);    // at the CENTER
    runDirty(w);
    const walls = w.bim.entities.filter(e => e.type === 'wall');
    eq(walls.length, 1, 'the wall stays ONE element');
    ok(w.bim.getEntityById(wall.id) === walls[0], 'identity kept');
    eq(walls[0].faces.length, facesBefore.length, 'face set untouched');
    ok(walls[0].faces.every(id => w.m.faces.has(id)), 'geometry live');
    eq(walls[0].params.base[0], 0, 'params are truth: base unchanged');
    eq(walls[0].params.end[0], 6, 'params are truth: end unchanged');
    const xs = allWallXs(w);
    near(xs[0], 0, 1e-9, 'run keeps its original start');
    near(xs[xs.length - 1], 6, 1e-9, 'run keeps its original end — through both columns');
    ok(w.m.validate().ok, 'model valid: independent overlapping solids');
  });

  test('deleting the columns changes nothing (there is nothing to heal)', () => {
    const w = makeWorld();
    const wall = buildWall(w, [0, 0, 0], [6, 0, 0]);
    const c1 = buildColumn(w, 0, 0, 0), c2 = buildColumn(w, 3, 0, 0);
    runDirty(w);
    for (const c of [c1, c2]) {
      for (const fid of [...c.faces]) w.m.faces.delete(fid);
      w.bim.detach(c.id);
    }
    w.m.gc();
    runDirty(w);
    const walls = w.bim.entities.filter(e => e.type === 'wall');
    eq(walls.length, 1, 'still one whole wall');
    const xs = allWallXs(w);
    near(xs[0], 0, 1e-9, 'start unchanged');
    near(xs[xs.length - 1], 6, 1e-9, 'end unchanged');
    ok(w.m.validate().ok, 'model valid');
  });

  test('a column directly ABOVE on the next level does not trim this wall', () => {
    const w = makeWorld();
    const wall = buildWall(w, [0, 0, 0], [8, 0, 0]);
    const xs0 = allWallXs(w);
    buildColumn(w, 4, 0, 3.2); // same plan position, one story up
    runDirty(w);
    const xs = allWallXs(w);
    near(xs[0], xs0[0], 1e-9, 'wall start untouched');
    near(xs[xs.length - 1], 8, 1e-9, 'wall end untouched');
    ok(wall.faces.length > 0, 'wall kept its geometry');
  });

  // --------------------------------------- wall drawn THROUGH a standing column
  test('element ids are NEVER recycled after a delete', () => {
    const w = makeWorld();
    const a = buildWall(w, [0, 0, 0], [4, 0, 0]);
    const b = buildWall(w, [10, 0, 0], [14, 0, 0]);
    eq(a.id, 'wall_1', 'first wall');
    eq(b.id, 'wall_2', 'second wall');
    w.bim.detach(b.id);
    const c = buildWall(w, [20, 0, 0], [24, 0, 0]);
    eq(c.id, 'wall_3', 'the deleted wall_2\'s id is never handed out again '
      + '(a recycled id would let a new element inherit a dead lineage\'s split pieces)');
  });

  test('two touching collinear walls stay two independent elements (v0.6)', () => {
    const w = makeWorld();
    buildWall(w, [0, 0, 0], [4, 0, 0]);
    buildWall(w, [4, 0, 0], [8, 0, 0]);
    runDirty(w);
    const walls = w.bim.entities.filter(e => e.type === 'wall');
    eq(walls.length, 2, 'no cross-merging: each wall keeps its own lineage');
    // exactly-coincident cap rings dedupe to shared faces (the registry
    // prunes dead ids, exactly like elements.rebuild); each wall keeps an
    // independent live body and the model validates
    for (const wl of walls) {
      const live = wl.faces.filter(id => w.m.faces.has(id));
      ok(live.length >= 4, 'keeps its own body faces (' + live.length + ' live)');
    }
    ok(w.m.validate().ok, 'model valid');
  });

  test('full pipeline: wall through two columns — one element, params intact', () => {
    const w = makeWorld();
    const wall = buildWall(w, [0, 0, 0], [6, 0, 0]);
    buildColumn(w, 1.5, 0, 0, 0.3, 0.3);
    buildColumn(w, 4.5, 0, 0, 0.3, 0.3);
    runDirty(w);
    const walls = w.bim.entities.filter(e => e.type === 'wall');
    eq(walls.length, 1, 'the wall runs THROUGH both columns');
    const xs = allWallXs(w);
    near(xs[0], 0, 1e-9, 'start intact');
    near(xs[xs.length - 1], 6, 1e-9, 'end intact');
    eq(w.bim.entities.filter(e => e.type === 'column').length, 2, 'columns keep their own elements');
    ok(w.m.validate().ok, 'model valid');
  });

  test('a second column lands, then both leave — the wall never changed', () => {
    const w = makeWorld();
    const wall = buildWall(w, [0, 0, 0], [6, 0, 0]);
    const c1 = buildColumn(w, 2, 0, 0);
    runDirty(w);
    const c2 = buildColumn(w, 4, 0, 0);
    runDirty(w);
    eq(w.bim.entities.filter(e => e.type === 'wall').length, 1, 'one wall throughout');
    for (const c of [c1, c2]) {
      for (const fid of [...c.faces]) w.m.faces.delete(fid);
      w.bim.detach(c.id);
    }
    w.m.gc();
    runDirty(w);
    const after = w.bim.entities.filter(e => e.type === 'wall');
    eq(after.length, 1, 'still one wall');
    ok(after[0].id === wall.id, 'same identity, same geometry — nothing to restore');
    ok(w.m.validate().ok, 'model valid');
  });

  // a beam swept via the real structural builder and registered
  const buildBeamOn = (w, bp) => {
    const before = new Set(w.m.faces.keys());
    w.m.bimHold = true;
    let out;
    try { out = w.app.structural.buildBeam(G, w.m, bp); } finally { w.m.bimHold = false; }
    const faces = [...w.m.faces.keys()].filter(id => !before.has(id));
    const roles = {};
    for (const fid of faces) roles[fid] = 'body';
    return w.bim.create('beam', JSON.parse(JSON.stringify(bp)), roles, []);
  };

  test('beam resting ON the wall top RIDES it — the wall stays whole', () => {
    const w = makeWorld();
    const wall = buildWall(w, [0, 0, 0], [8, 0, 0]);
    runDirty(w);
    const beam = buildBeamOn(w, { baseline: [[4, -3, 3], [4, 3, 3]],
      profile: 'rectangular', width: 0.2, height: 0.5,
      referenceLevelId: 'lvl3', zJustification: 'Bottom' }); // z 3..3.5, touching the top
    ok(beam, 'beam built');
    runDirty(w);
    // BEARING, NOT INTRUDING: a beam whose soffit sits at/above the wall's
    // top rides ON the wall (the old rule split the wall around it — the
    // "beam over wall deletes/mangles the wall" bug). The wall keeps its run.
    const walls = w.bim.entities.filter(e => e.type === 'wall');
    eq(walls.length, 1, 'wall NOT split around the resting beam');
    const xs = allWallXs(w);
    near(xs[0], 0, 1e-9, 'wall keeps its original start');
    near(xs[xs.length - 1], 8, 1e-9, 'wall keeps its original end');
    ok(w.m.validate().ok, 'model valid');
    // delete the beam -> still one whole wall
    w.bim.detach(beam.id);
    runDirty(w);
    eq(w.bim.entities.filter(e => e.type === 'wall').length, 1, 'still one wall');
    const hx = allWallXs(w);
    near(hx[0], 0, 1e-9, 'start unchanged');
    near(hx[hx.length - 1], 8, 1e-9, 'end unchanged');
  });

  test('a parallel beam riding the wall keeps the wall under it (spandrel)', () => {
    const w = makeWorld();
    const wall = buildWall(w, [0, 0, 0], [8, 0, 0]);
    runDirty(w);
    const beam = buildBeamOn(w, { baseline: [[5, 0, 3], [8, 0, 3]],
      profile: 'rectangular', width: 0.2, height: 0.5,
      referenceLevelId: 'lvl3', zJustification: 'Bottom' });
    ok(beam, 'spandrel built');
    runDirty(w);
    // the spandrel RIDES the wall's end portion — the wall continues under
    // it (the old rule bit the wall back to the beam's near face)
    const walls = w.bim.entities.filter(e => e.type === 'wall');
    eq(walls.length, 1, 'one wall piece remains');
    const xs = allWallXs(w);
    near(xs[xs.length - 1], 8, 5e-3, 'wall runs under the spandrel to its end');
    ok(w.m.validate().ok, 'model valid');
  });

  test('beams clear of the wall never trim it', () => {
    const w = makeWorld();
    const wall = buildWall(w, [0, 0, 0], [8, 0, 0]);
    runDirty(w);
    // parallel but 1.5 m off the wall line — and high above with a gap
    buildBeamOn(w, { baseline: [[0, 1.5, 3], [8, 1.5, 3]], profile: 'rectangular',
      width: 0.2, height: 0.5, referenceLevelId: 'lvl3', zJustification: 'Bottom' });
    runDirty(w);
    const walls = w.bim.entities.filter(e => e.type === 'wall');
    eq(walls.length, 1, 'wall untouched');
    const xs = allWallXs(w);
    near(xs[0], 0, 1e-9, 'start intact');
    near(xs[xs.length - 1], 8, 1e-9, 'end intact');
  });

};
