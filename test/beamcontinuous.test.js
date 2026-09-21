'use strict';
// ---------------------------------------------------------------------------
// beamcontinuous.test.js — v0.8 CONTINUOUS BEAMS (the owner's rule): the beam
// is the continuous element at a joint. It runs its full drawn span (plus the
// weld extension) and is NEVER trimmed or split by columns. The COLUMN gives
// way: its head is capped at the crossing beam's soffit + EPS, and grows back
// when the beam is deleted.
// ---------------------------------------------------------------------------
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const L = loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/app.js']);
  const sandbox = L.sandbox;
  const { G, Model, BimTools, StructuralManager } = sandbox.window;
  const BimEntityManager = sandbox.window.BimEntityManager;
  const v = (x, y, z = 0) => G.v(x, y, z);

  const makeWorld = () => {
    const m = new Model();
    m.bimEntities = [];
    m.levels = [{ id: 'lvl1', name: 'L1', elevation: 0 }, { id: 'lvlB', name: 'LB', elevation: 3 }];
    const bim = new BimEntityManager(m);
    const app = { model: m, bim, toasts: [], toast() { }, setStatus() { },
      levelManager: { getElevation: () => 0 }, gridManager: null, structural: null };
    app.structural = new StructuralManager(() => m.levels, () => m.bimEntities);
    sandbox.window.app = app;
    return { m, bim, app };
  };
  const buildColumn = (w, x, height, baseLevel) => {
    const ring = [v(x - .15, -.15, 0), v(x + .15, -.15, 0), v(x + .15, .15, 0), v(x - .15, .15, 0)];
    const before = new Set(w.m.faces.keys());
    w.m.bimHold = true;
    const f = w.m.addFaceFromRings(ring);
    w.m.pushPull(f, height);
    w.m.bimHold = false;
    const faces = [...w.m.faces.keys()].filter(id => !before.has(id));
    const roles = {}; for (const fid of faces) roles[fid] = 'side';
    return w.bim.create('column', { base: [x, 0, 0], width: .3, depth: .3, height, baseLevel: baseLevel || 'lvl1' }, roles, []);
  };
  // beam hanging DOWN from z=3 (Top justification): z [2.5, 3.0]
  const buildBeam = (w, ax, bx) => {
    const bp = { baseline: [[ax, 0, 3], [bx, 0, 3]], profile: 'rectangular',
      webWidth: 0.25, height: 0.5, referenceLevelId: 'lvlB', zJustification: 'Top' };
    const before = new Set(w.m.faces.keys());
    w.m.bimHold = true;
    try { w.app.structural.buildBeam(G, w.m, bp); } finally { w.m.bimHold = false; }
    const faces = [...w.m.faces.keys()].filter(id => !before.has(id));
    const roles = {}; for (const fid of faces) roles[fid] = 'body';
    return w.bim.create('beam', bp, roles, []);
  };
  // mirrors app.syncColumnBearing + rebuildColumnEntity (box columns only,
  // no ColumnFeature dependency in this harness)
  const refitColumns = w => {
    let n = 0;
    for (const ent of w.bim.entities) {
      if (ent.type !== 'column' || !ent.faces.length) continue;
      const desired = w.app.structural.columnBearingTop(ent.params, w.bim.entities);
      const b = w.app.structural.columnBounds(ent.params);
      const hh = Math.max(0.1, desired - b.zStart);
      if (Math.abs(hh - (ent.params.height || 0)) < 5e-4) continue;
      if (ent.params.heightNominal == null) ent.params.heightNominal = ent.params.height;
      ent.params.height = hh;
      w.m.deleteFaces([...ent.faces]);
      const [cx, cy] = ent.params.base;
      const ring = [v(cx - .15, cy - .15, 0), v(cx + .15, cy - .15, 0), v(cx + .15, cy + .15, 0), v(cx - .15, cy + .15, 0)];
      w.m.bimHold = true;
      const f = w.m.addFaceFromRings(ring);
      w.m.pushPull(f, hh);
      w.m.bimHold = false;
      ent.faces = [];
      for (const [id2, f2] of w.m.faces) {
        if (f2.userData && f2.userData.bimEntityId === ent.id) { ent.faces.push(id2); continue; }
        // fresh sweep faces are unstamped (bimHold owner is generic) - claim them
        if (!f2.userData && id2 > 0) { /* claimed below by bbox test */ }
      }
      // claim unstamped faces inside the column's plan box
      const bb2 = w.app.structural.columnBounds(ent.params);
      for (const [id2, f2] of w.m.faces) {
        if (f2.userData || ent.faces.includes(id2)) continue;
        const c2 = w.m.faceCentroid(f2);
        if (!c2 || !isFinite(c2.x)) continue;
        if (Math.abs(c2.x - cx) <= 0.151 && Math.abs(c2.y - cy) <= 0.151 && c2.z >= -1e-6 && c2.z <= hh + 1e-6) {
          f2.userData = { bimEntityId: ent.id, bimType: 'column' };
          ent.faces.push(id2);
        }
      }
      n++;
    }
    return n;
  };
  const solidTopZ = (w, ent) => {
    let z = -1e9;
    for (const fid of ent.faces) {
      const f = w.m.faces.get(fid);
      if (!f) continue;
      const c = w.m.faceCentroid(f);
      if (c && isFinite(c.z)) z = Math.max(z, c.z);
    }
    return z;
  };
  const spanX = (w, ent) => {
    let x0 = 1e9, x1 = -1e9;
    for (const fid of ent.faces) {
      const f = w.m.faces.get(fid);
      if (!f) { console.log('   spanX: dead face id', fid, 'on', ent.type); continue; }
      if (!f.loop) { console.log('   spanX: face', fid, 'has NO loop:', JSON.stringify(Object.keys(f))); continue; }
      if (f.loop.some(q2 => !w.m.vertices.has(q2))) { console.log('   spanX: face', fid, 'DANGLING ring'); continue; }
      const c = w.m.faceCentroid(f);
      if (c && isFinite(c.x)) { x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); }
    }
    return [x0, x1];
  };

  test('v0.7 restored: the beam ends at column faces - no column-face trim anywhere', () => {
    const w = makeWorld();
    const c1 = buildColumn(w, 0, 3);
    const c2 = buildColumn(w, 8, 3);
    const beam = buildBeam(w, 0, 8);
    eq(w.bim.entities.filter(e => e.type === 'beam').length, 1, 'ONE beam');
    const [x0, x1] = spanX(w, beam);
    near(x0, 0.15, 5e-3, 'beam ends at the column face (framing trim)');
    near(x1, 7.85, 5e-3, 'far end at the column face');
    near(beam.params.baseline[0][0], 0, 1e-9, 'analytical baseline kept');
    ok(w.m.validate().ok, 'model valid');
  });

  test('v0.7 restored: columns run THROUGH the beam zone (no cap)', () => {
    const w = makeWorld();
    const c1 = buildColumn(w, 0, 3);
    const c2 = buildColumn(w, 8, 3);
    const beam = buildBeam(w, 0, 8);
    const n = refitColumns(w);
    eq(n, 0, 'columns run through - no refit needed (v0.7)');
    near(solidTopZ(w, c1), 3.0, 2e-3, 'column 1 runs THROUGH the beam zone (v0.7)');
    near(solidTopZ(w, c2), 3.0, 2e-3, 'column 2 runs THROUGH the beam zone (v0.7)');
    // the beam is untouched by the refit (v0.7: ends at column faces)
    const [x0, x1] = spanX(w, beam);
    near(x0, 0.15, 5e-3, 'beam still at the column face');
    ok(w.m.validate().ok, 'model valid');
    // every face of every element references live vertices
    for (const ent of w.bim.entities)
      for (const fid of ent.faces) {
        const f = w.m.faces.get(fid);
        ok(!f || f.loop.every(q2 => w.m.vertices.has(q2)), 'rings intact (' + ent.type + ')');
      }
  });

  test('columns always at full height (v0.7 continuous)', () => {
    const w = makeWorld();
    const c1 = buildColumn(w, 0, 3);
    buildBeam(w, 0, 8);
    refitColumns(w);
    ok(Math.abs(solidTopZ(w, c1) - 3.0) < 2e-3, 'column runs through (v0.7)');
    const beamEnt = w.bim.entities.find(e => e.type === 'beam');
    const beamFaces = [...beamEnt.faces];
    w.bim.detach(beamEnt.id);
    w.m.deleteFaces(beamFaces);
    refitColumns(w);
    near(solidTopZ(w, c1), 3.0, 2e-3, 'column at full height (always was)');
    ok(w.m.validate().ok, 'model valid');
  });

  test('v0.7 restored: a column through a beam, the beam trims at its face', () => {
    const w = makeWorld();
    const beam = buildBeam(w, 0, 8);
    const col = buildColumn(w, 4, 3.5); // rises through the beam band
    refitColumns(w);
    eq(w.bim.entities.filter(e => e.type === 'beam').length, 1, 'still ONE beam');
    near(solidTopZ(w, col), 3.5, 2e-3, 'the column runs through (v0.7)');
    const [x0, x1] = spanX(w, beam);
    near(x0, -0.125, 5e-3, 'beam continuous');
    ok(w.m.validate().ok, 'model valid');
  });
};
