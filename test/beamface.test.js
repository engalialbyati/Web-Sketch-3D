'use strict';
// ---------------------------------------------------------------------------
// beamface.test.js — v0.6 ELEMENT INDEPENDENCE for beams: a column rising
// through a beam's depth NEVER splits it — beam and column coexist and
// simply overlap (connections are relationships, not geometry). The beam's
// OWN framing trim still lands its ends on support columns at its endpoints
// (bearing, not division).
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
    w.m.bimHold = true; // v0.6: BIM builds hold the model (element islands)
    try { w.app.structural.buildBeam(G, w.m, bp); } finally { w.m.bimHold = false; }
    const faces = [...w.m.faces.keys()].filter(id => !before.has(id));
    const roles = {};
    for (const fid of faces) roles[fid] = 'body';
    return w.bim.create('beam', bp, roles, []);
  };
  const buildColumn = (w, x, y, z, height) => {
    const hw = 0.15, hd = 0.15;
    const ring = [v(x - hw, y - hd, z), v(x + hw, y - hd, z), v(x + hw, y + hd, z), v(x - hw, y + hd, z)];
    const before = new Set(w.m.faces.keys());
    w.m.bimHold = true;
    try {
      const f = w.m.addFaceFromRings(ring);
      w.m.pushPull(f, height);
    } finally { w.m.bimHold = false; }
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

  test('a column rising through the beam never splits it (v0.6 independence)', () => {
    const w = makeWorld();
    const beam = buildBeam(w, 0, 8);
    ok(beam && beam.faces.length > 0, 'beam built');
    const facesBefore = beam.faces.length;
    const col = placeColumn(w, 4, 3.5); // z [0, 3.5] — through the beam's depth
    runDirty(w);
    const beams = w.bim.entities.filter(e => e.type === 'beam');
    eq(beams.length, 1, 'the beam stays ONE element');
    ok(w.bim.getEntityById(beam.id) === beams[0], 'identity kept');
    eq(beams[0].params.baseline[0][0], 0, 1e-9 === undefined ? undefined : 0, 'baseline unchanged (start)');
    ok(w.m.validate().ok, 'model valid');
    ok(col.faces.every(id => w.m.faces.has(id)), 'column keeps its own faces');
    ok(beams[0].faces.length > 0 && beams[0].faces.every(id => w.m.faces.has(id)), 'beam owns live faces');
    // the beam body crosses the column band — overlap, no cut faces between
    const xs = beamXs(w, beams[0]);
    ok(xs[0] < 3.9 && xs[xs.length - 1] > 4.1, 'beam geometry runs through the column position');
  });

  test('deleting the column leaves the beam untouched', () => {
    const w = makeWorld();
    buildBeam(w, 0, 8);
    const col = placeColumn(w, 4, 3.5);
    runDirty(w);
    for (const fid of [...col.faces]) w.m.faces.delete(fid);
    w.bim.detach(col.id);
    w.m.gc();
    runDirty(w);
    const beams = w.bim.entities.filter(e => e.type === 'beam');
    eq(beams.length, 1, 'still ONE beam');
    const xs = beamXs(w, beams[0]);
    near(xs[0], -0.125, 5e-3, 'start intact (welded)');
    near(xs[xs.length - 1], 8.125, 5e-3, 'end intact (welded)');
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

  test('two columns through the beam: still one element, no cuts', () => {
    const w = makeWorld();
    buildBeam(w, 0, 8);
    const c1 = placeColumn(w, 4, 3.5);
    const c2 = placeColumn(w, 6, 3.5);
    runDirty(w);
    const beams = w.bim.entities.filter(e => e.type === 'beam');
    eq(beams.length, 1, 'one beam through both columns');
    ok(!beams[0].params.merge, 'no split bookkeeping');
    ok(w.m.validate().ok, 'model valid');
    for (const c of [c1, c2]) { for (const fid of [...c.faces]) w.m.faces.delete(fid); w.bim.detach(c.id); }
    w.m.gc();
    runDirty(w);
    eq(w.bim.entities.filter(e => e.type === 'beam').length, 1, 'beam unchanged after the columns leave');
    ok(w.m.validate().ok, 'model valid after cleanup');
  });

  return summary_stub();
  function summary_stub() { }
};
