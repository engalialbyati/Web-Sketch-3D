'use strict';
// ---------------------------------------------------------------------------
// beamface.test.js — the element rule for beams: a column RISING THROUGH a
// beam's depth splits it into two independent beams ending at its faces
// (piece baselines run center-to-center; buildBeam lands the ends on the
// faces). Touching columns (standing on the beam) don't split. Pieces merge
// back when the column leaves; deleted territory never resurrects.
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
  const s0 = appSrc.indexOf('class BimEntityManager {');
  const s1 = appSrc.indexOf('\nclass App {');
  if (s0 < 0 || s1 < 0) throw new Error('could not slice BimEntityManager');
  vm.runInContext(appSrc.slice(s0, s1), ctx, { filename: 'app.js#BimEntityManager' });

  const { G, Model, BimTools, StructuralManager } = sandbox.window;
  const WallTool = BimTools.WallTool;
  const BimEntityManager = vm.runInContext('BimEntityManager', ctx);
  const v = (x, y, z = 0) => G.v(x, y, z);

  const makeWorld = () => {
    const m = new Model();
    m.bimEntities = [];
    m.levels = [{ id: 'lvl1', name: 'L1', elevation: 0 }, { id: 'lvlB', name: 'LB', elevation: 3 }];
    const bim = new BimEntityManager(m);
    const toasts = [];
    const app = {
      model: m, bim, toasts,
      toast(msg, isErr) { toasts.push({ msg: String(msg), isErr: !!isErr }); },
      setStatus() { },
      levelManager: { getElevation: () => 0 },
      gridManager: null,
      structural: null,
    };
    app.structural = new StructuralManager(() => m.levels, () => m.bimEntities);
    sandbox.window.app = app;
    return { m, bim, app, toasts };
  };

  // a beam hanging at z [3, 3.5] (Bottom justification on the level at 3)
  const buildBeam = (w, ax, bx) => {
    const bp = { baseline: [[ax, 0, 3], [bx, 0, 3]], profile: 'rectangular',
      webWidth: 0.25, height: 0.5, referenceLevelId: 'lvlB', zJustification: 'Bottom' };
    const before = new Set(w.m.faces.keys());
    w.app.structural.buildBeam(G, w.m, bp);
    const faces = [...w.m.faces.keys()].filter(id => !before.has(id));
    const roles = {};
    for (const fid of faces) roles[fid] = 'body';
    return w.bim.create('beam', bp, roles, []);
  };
  const buildColumn = (w, x, y, z, height) => {
    const hw = 0.15, hd = 0.15;
    const ring = [v(x - hw, y - hd, z), v(x + hw, y - hd, z), v(x + hw, y + hd, z), v(x - hw, y + hd, z)];
    const before = new Set(w.m.faces.keys());
    const f = w.m.addFaceFromRings(ring);
    w.m.pushPull(f, height);
    const faces = [...w.m.faces.keys()].filter(id => !before.has(id));
    const roles = {};
    for (const fid of faces) roles[fid] = 'side';
    return w.bim.create('column', { base: [x, y, z], width: 0.3, depth: 0.3, height }, roles, []);
  };
  const runDirty = w => {
    if (!w.bim._hostsDirty || !w.bim._hostsDirty.size) return;
    const dirty = [...w.bim._hostsDirty];
    w.bim._hostsDirty.clear();
    const order = { column: 0, beam: 1, wall: 2 };
    dirty.sort((a, b) => (order[(w.bim.getEntityById(a) || {}).type] ?? 3)
      - (order[(w.bim.getEntityById(b) || {}).type] ?? 3));
    for (const id of dirty) {
      const ent = w.bim.getEntityById(id);
      if (!ent) continue;
      if (ent.type === 'beam') ok(w.bim.planTrimBeam(id), 'planTrimBeam succeeded');
    }
  };
  const beamXs = (w, beam) => {
    const xs = [];
    for (const fid of beam.faces) {
      const f = w.m.faces.get(fid);
      if (f) for (const p of w.m.pts(f.loop)) xs.push(+p.x.toFixed(4));
    }
    return xs.sort((a, b) => a - b);
  };
  const allBeamXs = w => {
    const xs = [];
    for (const b of w.bim.entities.filter(e => e.type === 'beam'))
      for (const fid of b.faces) {
        const f = w.m.faces.get(fid);
        if (f) for (const p of w.m.pts(f.loop)) xs.push(+p.x.toFixed(4));
      }
    return xs.sort((a, b) => a - b);
  };
  // the real column-tool order: pre-split, then the sweep
  const placeColumn = (w, x, height) => {
    const cp = { base: [x, 0, 0], width: 0.3, depth: 0.3, height, baseLevel: 'lvl1' };
    w.bim.preSplitBeamsForColumn(cp);
    return buildColumn(w, x, 0, 0, height);
  };

  test('a column rising through the beam splits it into two beams', () => {
    const w = makeWorld();
    const beam = buildBeam(w, 0, 8);
    ok(beam && beam.faces.length > 0, 'beam built');
    const col = placeColumn(w, 4, 3.5); // z [0, 3.5] — through the beam's depth
    runDirty(w);
    const beams = w.bim.entities.filter(e => e.type === 'beam');
    eq(beams.length, 2, 'TWO independent beams');
    ok(w.bim.getEntityById(beam.id) === beams[0], 'piece 0 keeps the identity');
    const a = beams.find(b => b.params.baseline[0][0] < 1), b2 = beams.find(b => b.params.baseline[0][0] > 1);
    near(a.params.baseline[1][0], 4, 1e-9, 'piece A baseline runs to the column center');
    near(b2.params.baseline[0][0], 4, 1e-9, 'piece B baseline runs from the column center');
    ok(a.params.merge && b2.params.merge && a.params.merge.group === b2.params.merge.group, 'shared merge group');
    const ax = beamXs(w, a), bx = beamXs(w, b2);
    near(ax[ax.length - 1], 3.85, 5e-3, 'piece A geometry ends at the column face');
    near(bx[0], 4.15, 5e-3, 'piece B geometry starts at the column face');
    for (const b of beams)
      ok(b.faces.length > 0 && b.faces.every(id => w.m.faces.has(id)), 'each piece owns live faces');
    ok(w.m.validate().ok, 'model valid');
  });

  test('deleting the column merges the beams back into one', () => {
    const w = makeWorld();
    buildBeam(w, 0, 8);
    const col = placeColumn(w, 4, 3.5);
    runDirty(w);
    eq(w.bim.entities.filter(e => e.type === 'beam').length, 2, 'split first');
    w.bim.detach(col.id);
    runDirty(w);
    const beams = w.bim.entities.filter(e => e.type === 'beam');
    eq(beams.length, 1, 'merged back into ONE beam');
    ok(!beams[0].params.merge, 'merge record cleared');
    const xs = allBeamXs(w);
    // empty-corner weld: a whole beam extends half a web width past each bare end
    near(xs[0], -0.125, 5e-3, 'whole again (welded start)');
    near(xs[xs.length - 1], 8.125, 5e-3, 'whole again (welded end)');
    ok(w.m.validate().ok, 'model valid');
  });

  test('a column at the beam END does not split it (framing trim owns it)', () => {
    const w = makeWorld();
    buildBeam(w, 0, 8);
    placeColumn(w, 0, 3.5); // right at the baseline start
    runDirty(w);
    const beams = w.bim.entities.filter(e => e.type === 'beam');
    eq(beams.length, 1, 'still ONE beam');
    const xs = beamXs(w, beams[0]);
    near(xs[0], 0.15, 5e-3, 'end lands on the column face (framing trim)');
    ok(w.m.validate().ok, 'model valid');
  });

  test('a column merely standing on the beam (touching) never splits it', () => {
    const w = makeWorld();
    buildBeam(w, 0, 8);
    placeColumn(w, 4, 3.0); // z [0, 3] — top exactly at the beam soffit
    runDirty(w);
    const beams = w.bim.entities.filter(e => e.type === 'beam');
    eq(beams.length, 1, 'beam continues over its support');
    const xs = beamXs(w, beams[0]);
    near(xs[0], -0.125, 5e-3, 'start intact (welded)');
    near(xs[xs.length - 1], 8.125, 5e-3, 'end intact (welded)');
  });

  test('a deleted piece\'s territory stays gone when the column leaves', () => {
    const w = makeWorld();
    buildBeam(w, 0, 8);
    const col = placeColumn(w, 4, 3.5);
    runDirty(w);
    const beams = w.bim.entities.filter(e => e.type === 'beam');
    w.bim.detach(beams[1].id); // the USER deletes piece B
    w.bim.detach(col.id);
    runDirty(w);
    const after = w.bim.entities.filter(e => e.type === 'beam');
    eq(after.length, 1, 'piece A alone');
    const xs = beamXs(w, after[0]);
    near(xs[xs.length - 1], 3.85, 5e-3, 'A ends at the old column face — no resurrect');
    ok(w.m.validate().ok, 'model valid');
  });

  // the re-split: a SECOND column lands on an already-split piece. Slots
  // must stay in original-run coordinates and sibling slots must survive
  // the re-split, or the next derive kicks every piece out of the merge
  // group and the beam can never reunite.
  test('a second column re-splitting a piece: the group survives, both leaving restores ONE beam', () => {
    const w = makeWorld();
    buildBeam(w, 0, 8);
    const c1 = placeColumn(w, 4, 3.5);
    runDirty(w);
    eq(w.bim.entities.filter(e => e.type === 'beam').length, 2, 'split at 4 first');
    const c2 = placeColumn(w, 6, 3.5); // lands on piece [4,8]
    runDirty(w);
    const three = w.bim.entities.filter(e => e.type === 'beam');
    eq(three.length, 3, 're-split into three pieces');
    for (const b of three)
      ok(b.params.merge && b.params.merge.group === three[0].params.merge.group,
        'every piece still holds the shared merge group');
    w.bim.detach(c2.id);
    runDirty(w);
    const two = w.bim.entities.filter(e => e.type === 'beam');
    eq(two.length, 2, 'the second column leaving reunites its neighbors only');
    const near45 = two.find(b => Math.abs(b.params.baseline[0][0] - 4) < 1e-6);
    near(near45.params.baseline[1][0], 8, 1e-9, 'the reunited piece spans [4,8]');
    w.bim.detach(c1.id);
    runDirty(w);
    const one = w.bim.entities.filter(e => e.type === 'beam');
    eq(one.length, 1, 'both columns gone: ONE whole beam');
    ok(!one[0].params.merge, 'merge record cleared');
    const xs = allBeamXs(w);
    near(xs[0], -0.125, 5e-3, 'geometry whole again (welded start)');
    near(xs[xs.length - 1], 8.125, 5e-3, 'geometry whole again (welded end)');
    ok(w.m.validate().ok, 'model valid');
  });

  return summary_stub();
  function summary_stub() { }
};
