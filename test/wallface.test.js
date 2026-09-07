'use strict';
// ---------------------------------------------------------------------------
// wallface.test.js — THE WALL-FACE RULE (dynamic, universal):
//   "A wall ends at the FACE of any column or beam in its path."
// Real BimEntityManager + real StructuralManager + real Model, driven the
// way opDone drives them. The owner's reported case: a FREEFORM wall (no
// grid at all), then columns placed at its END and at its CENTER —
//   · the end column bites that end back to its face,
//   · the center column SPLITS the wall into two segments,
//   · params.base/end NEVER change (params are truth — delete the columns
//     and the wall heals back to one whole span),
//   · an intruder on another LEVEL (directly above) must not trim at all.
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
    const f = w.m.addFaceFromRings(ring.map(q => G.clone(q)));
    w.m.pushPull(f, 3);
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
    const f = w.m.addFaceFromRings(ring);
    w.m.pushPull(f, height);
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
    ok(w.bim._hostsDirty && w.bim._hostsDirty.size, 'something marked dirty');
    const dirty = [...w.bim._hostsDirty];
    w.bim._hostsDirty.clear();
    const order = { column: 0, beam: 1, wall: 2 };
    dirty.sort((a, b) => (order[(w.bim.getEntityById(a) || {}).type] ?? 3)
      - (order[(w.bim.getEntityById(b) || {}).type] ?? 3));
    for (const id of dirty) {
      const ent = w.bim.getEntityById(id);
      if (!ent) continue;
      if (ent.type === 'wall') ok(w.bim.planTrimWall(id), 'planTrimWall succeeded');
    }
  };

  // every vertex x of every wall-owned face, sorted — reads the run-axis
  // coverage of the wall body (which spans exist on the ground)
  const wallXs = (w, wall) => {
    const xs = [];
    for (const fid of wall.faces) {
      const f = w.m.faces.get(fid);
      if (!f) continue;
      for (const p of w.m.pts(f.loop)) xs.push(p.x);
    }
    return xs.sort((a, b) => a - b);
  };

  // ------------------------------------------------- the owner's reported case
  test('freeform wall: end + center columns split it face-to-face, params untouched', () => {
    const w = makeWorld();
    const wall = buildWall(w, [0, 0, 0], [8, 0, 0]);
    ok(wall && wall.faces.length > 0, 'wall built with geometry');
    const cEnd = buildColumn(w, 0, 0, 0);   // right AT the wall's start
    const cMid = buildColumn(w, 4, 0, 0);   // right at the wall's center
    ok(cEnd && cMid, 'columns built');
    runDirty(w);

    ok(w.bim.getEntityById(wall.id) === wall, 'still ONE wall entity (split, not duplicated)');
    ok(wall.faces.length > 0 && wall.faces.every(id => w.m.faces.has(id)), 'wall geometry is live');
    eq(wall.params.base[0], 0, 'params.base untouched (truth)');
    eq(wall.params.end[0], 8, 'params.end untouched (truth)');

    const xs = wallXs(w, wall);
    near(xs[0], 0.151, 5e-3, 'first span starts at the end column face + reveal');
    near(xs[xs.length - 1], 8, 1e-9, 'wall still reaches its far end');
    // two spans around the center column: vertices must NOT exist inside
    // either blocked interval [−0.15, 0.149] or [3.851, 4.149]
    for (const x of xs)
      ok((x > 0.149 && x < 3.851) || x > 4.149, `vertex x=${x} inside a column footprint`);
    // and both sides of the center column are genuinely present
    ok(xs.some(x => Math.abs(x - 3.849) < 5e-3), 'span A ends at the center column face');
    ok(xs.some(x => Math.abs(x - 4.151) < 5e-3), 'span B starts at the center column face');
    ok(w.m.validate().ok, 'model valid after the split');
    // no corpses: every live face stamped to this wall is in its list
    for (const [fid, f] of w.m.faces)
      if (f.userData && f.userData.bimEntityId === wall.id)
        ok(wall.faces.includes(fid), `stamped face ${fid} adopted by the wall`);
  });

  // ------------------------------------------------------------ the heal
  test('deleting both columns heals the wall back to one whole span', () => {
    const w = makeWorld();
    const wall = buildWall(w, [0, 0, 0], [8, 0, 0]);
    const cEnd = buildColumn(w, 0, 0, 0);
    const cMid = buildColumn(w, 4, 0, 0);
    runDirty(w);
    // remove the intruders the way the app does (detach unregisters + marks hosts)
    w.bim.detach(cEnd.id);
    w.bim.detach(cMid.id);
    runDirty(w);

    const xs = wallXs(w, wall);
    near(xs[0], 0, 1e-9, 'healed wall spans from the original base again');
    near(xs[xs.length - 1], 8, 1e-9, 'healed wall reaches the original end');
    ok(wall.faces.length > 0 && wall.faces.every(id => w.m.faces.has(id)), 'healed geometry is live');
    ok(w.m.validate().ok, 'model valid after the heal');
  });

  // --------------------------------------------------------- the level gate
  test('a column directly ABOVE on the next level does not trim this wall', () => {
    const w = makeWorld();
    const wall = buildWall(w, [0, 0, 0], [8, 0, 0]);
    const xs0 = wallXs(w, wall);
    buildColumn(w, 4, 0, 3.2); // same plan position, one story up
    runDirty(w);
    const xs = wallXs(w, wall);
    near(xs[0], xs0[0], 1e-9, 'wall start untouched');
    near(xs[xs.length - 1], 8, 1e-9, 'wall end untouched');
    ok(wall.faces.length > 0, 'wall kept its geometry');
  });

  // --------------------------------------- wall drawn THROUGH a standing column
  test('a new wall drawn through a standing column splits at birth', () => {
    const w = makeWorld();
    buildColumn(w, 4, 0, 0); // column already there
    const wall = buildWall(w, [0, 0, 0], [8, 0, 0]); // create() self-marks
    runDirty(w);
    const xs = wallXs(w, wall);
    near(xs[0], 0, 1e-9, 'start intact (no intruder there)');
    for (const x of xs)
      ok(x < 3.851 || x > 4.149, `vertex x=${x} clear of the column footprint`);
    ok(xs.some(x => Math.abs(x - 4.151) < 5e-3), 'wall resumes past the column face');
    ok(w.m.validate().ok, 'model valid');
  });

  // ---------------------------------------- the FULL opDone pipeline, faithfully
  // (detach loop -> syncEntityLists -> ring repair -> dirty regen with the
  // rebuildFromParams fallback) — the live app killed the wall here while
  // the plain runDirty above passed; this pins the real orchestration
  const miniOpDone = w => {
    for (const ent of [...w.bim.entities])
      if (!ent.faces.some(id => w.m.faces.has(id)))
        w.bim.detach(ent.id);
    w.bim.syncEntityLists();
    for (const f of w.m.faces.values()) {
      w.m.edgesForRing(f.loop, true);
      for (const h of (f.holes || [])) w.m.edgesForRing(h, true);
    }
    if (w.bim._hostsDirty && w.bim._hostsDirty.size) {
      const dirty = [...w.bim._hostsDirty];
      w.bim._hostsDirty.clear();
      let failed = 0;
      for (const wid of dirty) {
        const ent = w.bim.getEntityById(wid);
        if (!ent) continue;
        let ok = true;
        if (ent.type === 'wall') ok = w.bim.planTrimWall(wid);
        if (!ok) failed++;
      }
      if (failed) w.__rebuildFallback = true;
    }
  };

  test('full pipeline: wall survives two columns and stays split', () => {
    const w = makeWorld();
    const wall = buildWall(w, [0, 0, 0], [8, 0, 0]);
    miniOpDone(w); // wall self-mark -> immediate (no-op) re-trim, like the live app
    buildColumn(w, 0, 0, 0);
    miniOpDone(w);
    ok(w.bim.getEntityById(wall.id), 'wall alive after the end column');
    buildColumn(w, 4, 0, 0);
    miniOpDone(w);
    ok(w.bim.getEntityById(wall.id), 'wall alive after the center column');
    ok(!w.__rebuildFallback, 'no regeneration failure (fallback would have fired)');
    const xs = wallXs(w, wall);
    near(xs[0], 0.151, 5e-3, 'split starts at the end column face');
    for (const x of xs)
      ok((x > 0.149 && x < 3.851) || x > 4.149, `vertex x=${x} clear of column footprints`);
    ok(wall.faces.length > 0 && wall.faces.every(id => w.m.faces.has(id)), 'wall owns live faces');
    ok(w.m.validate().ok, 'model valid');
  });

  return summary_if_needed;
  function summary_if_needed() { }
};
