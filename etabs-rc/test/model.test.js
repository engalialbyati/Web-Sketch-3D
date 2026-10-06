'use strict';
// model.test.js — RC Studio model + analysis pipeline (ETABS-style app).
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const L = loadModel(['js/g.js', 'js/fea.js', 'js/model.js']);
  const M = L.window.RCModel;

  test('new model → template: stories, grids, columns, beams', () => {
    const m = M.newModel();
    m.stories = [{ name: 'Base', elevation: 0 }, { name: 'S1', elevation: 3 }];
    m.grids.x = [{ label: '1', pos: 0 }, { label: '2', pos: 6 }];
    m.grids.y = [{ label: 'A', pos: 0 }, { label: 'B', pos: 5 }];
    for (const gx of m.grids.x) for (const gy of m.grids.y) M.addColumn(m, 1, gx.pos, gy.pos);
    for (const gy of m.grids.y) M.addBeam(m, 1, 0, gy.pos, 6, gy.pos);
    eq(m.frames.length, 6, '4 columns + 2 beams');
    eq(m.joints.length, 8, 'grid intersections merge joints');
    // duplicate placement is idempotent (ETABS behavior)
    M.addColumn(m, 1, 0, 0);
    eq(m.frames.length, 6, 're-drawing the same column does not duplicate');
  });

  test('supports: base fixed by default, pinned releases moments', () => {
    const m = M.newModel();
    m.stories = [{ name: 'Base', elevation: 0 }, { name: 'S1', elevation: 3 }];
    m.grids.x = [{ label: '1', pos: 0 }, { label: '2', pos: 6 }];
    m.grids.y = [{ label: 'A', pos: 0 }, { label: 'B', pos: 5 }];
    for (const gx of m.grids.x) for (const gy of m.grids.y) M.addColumn(m, 1, gx.pos, gy.pos);
    M.addBeam(m, 1, 0, 0, 6, 0);
    M.addBeam(m, 1, 0, 5, 6, 5);
    M.addBeam(m, 1, 0, 0, 0, 5);
    M.addBeam(m, 1, 6, 0, 6, 5);
    const mesh = M.buildMesh(m);
    eq(mesh.nodes[0].fixed.join(','), '1,1,1,1,1,1', 'base joints fixed');
    m.joints[0].restraint = 'pinned';
    const mesh2 = M.buildMesh(m);
    eq(mesh2.nodes[0].fixed.join(','), '1,1,1,0,0,0', 'pinned base releases rotations');
  });

  test('portal analysis: beam moment ~ wL²/8 with fixed supports', () => {
    const m = M.newModel();
    m.stories = [{ name: 'Base', elevation: 0 }, { name: 'S1', elevation: 3 }];
    m.grids.x = [{ label: '1', pos: 0 }, { label: '2', pos: 6 }];
    m.grids.y = [{ label: 'A', pos: 0 }, { label: 'B', pos: 5 }];
    for (const gx of m.grids.x) for (const gy of m.grids.y) M.addColumn(m, 1, gx.pos, gy.pos);
    const b1 = M.addBeam(m, 1, 0, 0, 6, 0);
    M.addBeam(m, 1, 0, 5, 6, 5);
    M.addBeam(m, 1, 0, 0, 0, 5);
    M.addBeam(m, 1, 6, 0, 6, 5);
    m.patterns = [{ id: 'DEAD', name: 'Dead', type: 'dead', swMult: 1 }, { id: 'LIVE', name: 'Live', type: 'live', swMult: 0 }];
    m.frameLoads.push({ frameId: b1.id, pattern: 'LIVE', w: 10, dir: 'gravity' });
    const res = M.runAnalysis(m, {});
    ok(!res.error, 'analysis runs');
    const beamEnv = res.envelope.filter(e => e.frameId === b1.id)[0];
    // 1.6·10 kN/m over 6 m simply-supported midspan = 72 kN·m (the envelope
    // catches the span hump + the self-weight contribution)
    const Mtot = beamEnv.maxM / 1e6;
    ok(Mtot > 50 && Mtot < 110, 'beam moment in range, got ' + Mtot.toFixed(1) + ' kN·m');
    ok(res.envelope.some(e => e.kind === 'column' && e.maxN > 0), 'columns carry axial');
  });

  test('auto seismic: Cs caps + combos + base shear reported', () => {
    const m = M.newModel();
    m.stories = [{ name: 'Base', elevation: 0 }, { name: 'S1', elevation: 3 }];
    m.grids.x = [{ label: '1', pos: 0 }, { label: '2', pos: 6 }];
    m.grids.y = [{ label: 'A', pos: 0 }, { label: 'B', pos: 5 }];
    for (const gx of m.grids.x) for (const gy of m.grids.y) M.addColumn(m, 1, gx.pos, gy.pos);
    M.addBeam(m, 1, 0, 0, 6, 0); M.addBeam(m, 1, 0, 5, 6, 5);
    M.addBeam(m, 1, 0, 0, 0, 5); M.addBeam(m, 1, 6, 0, 6, 5);
    m.autoSeismic = { enabled: true, mode: 'asce', sds: 1.0, sd1: 0.6, R: 8, Ie: 1, dir: '+x' };
    const res = M.runAnalysis(m, {});
    ok(res.auto.seismic.V > 0, 'base shear reported: ' + res.auto.seismic.V.toFixed(1) + ' kN');
    near(res.auto.seismic.cs, 0.125, 0.001, 'Cs = SDS/(R/Ie) = 0.125');
    ok(res.combos.some(c => /Ev\+Eh/.test(c)), 'ASCE 7 §12.4.2 combos present');
    // user Cs mode
    m.autoSeismic.mode = 'cs'; m.autoSeismic.cs = 0.09;
    const res2 = M.runAnalysis(m, {});
    near(res2.auto.seismic.cs, 0.09, 1e-9, 'user coefficient respected');
  });

  test('modal: Ritz frequencies on the portal, no mechanisms', () => {
    const m = M.newModel();
    m.stories = [{ name: 'Base', elevation: 0 }, { name: 'S1', elevation: 3 }];
    m.grids.x = [{ label: '1', pos: 0 }, { label: '2', pos: 6 }];
    m.grids.y = [{ label: 'A', pos: 0 }, { label: 'B', pos: 5 }];
    for (const gx of m.grids.x) for (const gy of m.grids.y) M.addColumn(m, 1, gx.pos, gy.pos);
    M.addBeam(m, 1, 0, 0, 6, 0); M.addBeam(m, 1, 0, 5, 6, 5);
    M.addBeam(m, 1, 0, 0, 0, 5); M.addBeam(m, 1, 6, 0, 6, 5);
    const r = M.runModal(m, { nModes: 3 });
    ok(r.modes.length >= 2, 'modes returned');
    ok(r.modes[0].f > 0.1 && r.modes[0].f < 20, 'first mode physical (' + r.modes[0].f.toFixed(2) + ' Hz)');
    eq(r.mechanisms, 0, 'fixed-base portal has no mechanisms');
  });
};
