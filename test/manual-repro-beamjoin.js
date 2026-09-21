'use strict';
// manual-repro-beamjoin.js — beam drawn centerline-to-centerline between two
// columns ends with faces whose loops reference dead vertices (dangling
// ring refs). Bisects the opDone pass that eats the beam's vertices.
module.exports = async h => {
  const { loadModel, test, ok } = h;
  const L = loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/app.js']);
  const sandbox = L.sandbox;
  const { G, Model, BimTools, StructuralManager } = sandbox.window;
  const BimEntityManager = sandbox.window.BimEntityManager;

  const makeWorld = () => {
    const m = new Model();
    m.bimEntities = [];
    m.levels = [{ id: 'lvl1', name: 'L1', elevation: 0 }, { id: 'lvl2', name: 'L2', elevation: 3 }];
    const bim = new BimEntityManager(m);
    const toasts = [];
    const app = {
      model: m, bim, toasts,
      toast(msg, isErr) { toasts.push({ msg: String(msg), isErr: !!isErr }); },
      setStatus() { }, levelManager: { getElevation: () => 0 }, gridManager: null, structural: null,
    };
    app.structural = new StructuralManager(() => m.levels, () => m.bimEntities);
    sandbox.window.app = app;
    return { m, bim, app };
  };

  const buildColumn = (w, x, id) => {
    const ring = [G.v(x - 0.15, 0, 0), G.v(x + 0.15, 0, 0), G.v(x + 0.15, 0.3, 0), G.v(x - 0.15, 0.3, 0)];
    const before = new Set(w.m.faces.keys());
    w.m.bimHold = true;
    const f = w.m.addFaceFromRings(ring);
    w.m.pushPull(f, 3);
    w.m.bimHold = false;
    const faces = [...w.m.faces.keys()].filter(i2 => !before.has(i2));
    const roles = {}; for (const fid of faces) roles[fid] = 'body';
    return w.bim.create('column', { base: [x, 0.15, 0], width: 0.3, depth: 0.3, height: 3,
      baseLevel: 'lvl1', topConstraint: 'unconnected' }, roles, []);
  };

  const beamHealth = w => {
    const beam = w.bim.entities.find(e => e.type === 'beam');
    if (!beam) return { no: true };
    let alive = 0, broken = 0;
    for (const fid of beam.faces) {
      const f = w.m.faces.get(fid);
      if (!f) continue;
      alive++;
      if (f.loop.some(v => !w.m.vertices.has(v))) broken++;
    }
    return { alive, broken };
  };

  test('beam centerline-to-centerline: rings stay intact', () => {
    const w = makeWorld();
    buildColumn(w, 0.15, 'c1');
    buildColumn(w, 3.15, 'c2');
    const params = { baseline: [[0.15, 0.15, 0], [3.15, 0.15, 0]], profile: 'rectangular',
      webWidth: 0.25, height: 0.5, referenceLevelId: 'lvl1', zJustification: 'Top' };
    const before = new Set(w.m.faces.keys());
    w.m.bimHold = true;
    w.app.structural.buildBeam(G, w.m, params);
    w.m.bimHold = false;
    const faces = [...w.m.faces.keys()].filter(i2 => !before.has(i2));
    const roles = {}; for (const fid of faces) roles[fid] = 'body';
    w.bim.create('beam', params, roles, []);
    // opDone-ish passes the app runs after placement
    if (w.app.syncStructuralWalls) w.app.syncStructuralWalls();
    const h1 = beamHealth(w);
    ok(h1.alive > 0 && h1.broken === 0, `after build: ${JSON.stringify(h1)}`);
    // the rebuild cascade: hosts dirty -> column rebuild (syncColumnBearing)
    if (w.app.syncColumnBearing) w.app.syncColumnBearing();
    const h2 = beamHealth(w);
    ok(h2.alive > 0 && h2.broken === 0, `after column sync: ${JSON.stringify(h2)}`);
    const v = w.m.validate();
    ok(v.ok, 'model validates: ' + (v.ok ? '' : JSON.stringify((v.errors || []).slice(0, 2))));
  });
};
