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
  test('freeform wall: end + center columns split it into two independent elements', () => {
    const w = makeWorld();
    const wall = buildWall(w, [0, 0, 0], [8, 0, 0]);
    ok(wall && wall.faces.length > 0, 'wall built with geometry');
    const cEnd = buildColumn(w, 0, 0, 0);   // right AT the wall's start
    const cMid = buildColumn(w, 4, 0, 0);   // right at the wall's center
    ok(cEnd && cMid, 'columns built');
    runDirty(w);

    const walls = w.bim.entities.filter(e => e.type === 'wall');
    eq(walls.length, 2, 'split into TWO independent wall elements');
    ok(w.bim.getEntityById(wall.id) === walls[0], 'piece 0 keeps the original identity');
    for (const pw of walls)
      ok(pw.faces.length > 0 && pw.faces.every(id => w.m.faces.has(id)), 'each piece owns live faces');
    // both pieces remember the run they came from
    const mg = walls[0].params.merge, mg2 = walls[1].params.merge;
    ok(mg && mg2 && mg.group === mg2.group, 'pieces share a merge group');
    near(mg.base[0], 0, 1e-9, 'merge record keeps the original start');
    near(mg.end[0], 8, 1e-9, 'merge record keeps the original end');

    const a = walls.find(x => x.params.base[0] < 1), b = walls.find(x => x.params.base[0] > 1);
    const ax = pieceXs(w, a), bx = pieceXs(w, b);
    near(ax[0], 0.151, 5e-3, 'piece A starts at the end column face + reveal');
    near(ax[ax.length - 1], 3.849, 5e-3, 'piece A ends at the center column face');
    near(bx[0], 4.151, 5e-3, 'piece B starts at the center column face');
    near(bx[bx.length - 1], 8, 1e-9, 'piece B still reaches the far end');
    for (const x of allWallXs(w))
      ok((x > 0.149 && x < 3.851) || x > 4.149, `vertex x=${x} inside a column footprint`);
    ok(w.m.validate().ok, 'model valid after the split');
    // no corpses: every live stamped face is in its owner's list
    for (const [fid, f] of w.m.faces)
      if (f.userData && f.userData.bimEntityId)
        ok(w.bim.getEntityById(f.userData.bimEntityId).faces.includes(fid),
          `stamped face ${fid} adopted by ${f.userData.bimEntityId}`);
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

    eq(w.bim.entities.filter(e => e.type === 'wall').length, 1, 'pieces merged back into ONE wall');
    ok(!wall.params.merge, 'merged wall has no merge record (whole again)');
    const xs = allWallXs(w);
    near(xs[0], 0, 1e-9, 'healed wall spans from the original base again');
    near(xs[xs.length - 1], 8, 1e-9, 'healed wall reaches the original end');
    ok(wall.faces.length > 0 && wall.faces.every(id => w.m.faces.has(id)), 'healed geometry is live');
    ok(w.m.validate().ok, 'model valid after the heal');
  });

  // --------------------------------------------------------- the level gate
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
  test('a new wall drawn through a standing column splits at birth', () => {
    const w = makeWorld();
    buildColumn(w, 4, 0, 0); // column already there
    const wall = buildWall(w, [0, 0, 0], [8, 0, 0]); // create() self-marks
    runDirty(w);
    eq(w.bim.entities.filter(e => e.type === 'wall').length, 2, 'two pieces at birth');
    const xs = allWallXs(w);
    near(xs[0], 0, 1e-9, 'start intact (no intruder there)');
    for (const x of xs)
      ok(x < 3.851 || x > 4.149, `vertex x=${x} clear of the column footprint`);
    ok(xs.some(x => Math.abs(x - 4.151) < 5e-3), 'wall resumes past the column face');
    ok(w.m.validate().ok, 'model valid');
  });

  // ------------------------- per-piece independence + the no-resurrect guard
  test('deleting a piece: its territory stays gone when the columns leave', () => {
    const w = makeWorld();
    const wall = buildWall(w, [0, 0, 0], [8, 0, 0]);
    const cEnd = buildColumn(w, 0, 0, 0);
    const cMid = buildColumn(w, 4, 0, 0);
    runDirty(w);
    const walls = w.bim.entities.filter(e => e.type === 'wall');
    eq(walls.length, 2, 'split first');
    const b = walls.find(x => x.params.base[0] > 1);
    w.bim.detach(b.id); // the USER deletes piece B
    eq(w.bim.entities.filter(e => e.type === 'wall').length, 1, 'piece B gone, piece A alive');
    // now the intruders leave too — ONE opDone per deletion, exactly like
    // the live app (a heal pass between deletions must not drop B's slot
    // from the map, or the wall later regrows through B's ground)
    w.bim.detach(cEnd.id);
    runDirty(w);
    w.bim.detach(cMid.id);
    runDirty(w);
    const a = w.bim.entities.filter(e => e.type === 'wall');
    eq(a.length, 1, 'no second piece resurrected');
    const xs = pieceXs(w, a[0]);
    near(xs[0], 0, 5e-3, 'piece A healed leftward into the freed end ground');
    near(xs[xs.length - 1], 4.151, 5e-3, 'piece A stops at B\'s slot — deleted territory never resurrects');
    ok(w.m.validate().ok, 'model valid');
  });

  test('an edited piece stops participating in the merge', () => {
    const w = makeWorld();
    const wall = buildWall(w, [0, 0, 0], [8, 0, 0]);
    const cEnd = buildColumn(w, 0, 0, 0);
    const cMid = buildColumn(w, 4, 0, 0);
    runDirty(w);
    const walls = w.bim.entities.filter(e => e.type === 'wall');
    const b = walls.find(x => x.params.base[0] > 1);
    b.params.end = [6, 0, 0]; // the USER edits piece B: span leaves its slot
    w.bim.detach(cEnd.id);
    w.bim.detach(cMid.id);
    runDirty(w);
    const after = w.bim.entities.filter(e => e.type === 'wall');
    eq(after.length, 2, 'no merge — the edited piece is independent');
    const a = after.find(x => x.params.base[0] < 1);
    const xs = pieceXs(w, a);
    near(xs[0], 0, 5e-3, 'piece A still healed leftward (it honors the plan)');
    near(xs[xs.length - 1], 4.151, 5e-3, 'piece A stops where B\'s slot began');
    ok(w.m.validate().ok, 'model valid');
  });

  test('three pieces: removing ONE column merges only its neighbors', () => {
    const w = makeWorld();
    buildWall(w, [0, 0, 0], [8, 0, 0]);
    const c2 = buildColumn(w, 2, 0, 0);
    const c6 = buildColumn(w, 6, 0, 0);
    runDirty(w);
    eq(w.bim.entities.filter(e => e.type === 'wall').length, 3, 'three pieces');
    w.bim.detach(c2.id); // free the LEFT column only
    runDirty(w);
    const after = w.bim.entities.filter(e => e.type === 'wall');
    eq(after.length, 2, 'left two pieces merged; right piece stays (column 6 blocks)');
    const left = after.find(x => x.params.base[0] < 1);
    const right = after.find(x => x.params.base[0] > 5);
    const lx = pieceXs(w, left), rx = pieceXs(w, right);
    near(lx[0], 0, 1e-9, 'merged piece spans from the original start');
    near(lx[lx.length - 1], 5.849, 5e-3, 'merged piece ends at column 6 face');
    near(rx[0], 6.151, 5e-3, 'right piece still starts at column 6 face');
    near(rx[rx.length - 1], 8, 1e-9, 'right piece keeps the far end');
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
    const xs = allWallXs(w);
    near(xs[0], 0.151, 5e-3, 'split starts at the end column face');
    for (const x of xs)
      ok((x > 0.149 && x < 3.851) || x > 4.149, `vertex x=${x} clear of column footprints`);
    ok(wall.faces.length > 0 && wall.faces.every(id => w.m.faces.has(id)), 'wall owns live faces');
    ok(w.m.validate().ok, 'model valid');
  });

  // ------------------ the user's freeze case: column snapped to the wall FACE
  // (asymmetric, half off the wall line) — pre-split must keep the sweep
  // from ever slicing wall material
  test('pre-split: an off-center column lands between the pieces, model stays valid', () => {
    const w = makeWorld();
    const wall = buildWall(w, [0, 0, 0], [8, 0, 0]);
    // column centered at the wall's FACE midpoint: x=4.075, y=+0.1
    const colParams = { base: [4.075, 0.1, 0], width: 0.3, depth: 0.3, height: 3, baseLevel: 'lvl1' };
    const n = w.bim.preSplitWallsForColumn(colParams);
    ok(n >= 1, 'the wall pre-split for the pending column');
    buildColumn(w, 4.075, 0.1, 0); // the real sweep now travels between pieces
    runDirty(w);
    const walls = w.bim.entities.filter(e => e.type === 'wall');
    eq(walls.length, 2, 'two wall pieces around the column');
    const xs = allWallXs(w);
    for (const x of xs)
      ok(x < 3.9245 + 5e-3 || x > 4.2265 - 5e-3, `vertex x=${x} clear of the column footprint`);
    ok(w.m.validate().ok, 'model valid — no torn rings');
  });

  return summary_if_needed;
  function summary_if_needed() { }
};
