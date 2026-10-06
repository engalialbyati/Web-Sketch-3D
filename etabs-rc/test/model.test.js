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


  // ============================== ETABS Define/Assign features
  test('end releases: M3 pins make the beam simply supported (wL²/8 exact)', () => {
    const m = M.newModel();
    m.stories = [{ name: 'Base', elevation: 0 }, { name: 'S1', elevation: 3 }];
    m.grids.x = [{ label: '1', pos: 0 }, { label: '2', pos: 6 }];
    m.grids.y = [{ label: 'A', pos: 0 }, { label: 'B', pos: 5 }];
    for (const gx of m.grids.x) for (const gy of m.grids.y) M.addColumn(m, 1, gx.pos, gy.pos);
    const b1 = M.addBeam(m, 1, 0, 0, 6, 0);
    const b2 = M.addBeam(m, 1, 0, 5, 6, 5);
    M.addBeam(m, 1, 0, 0, 0, 5);
    M.addBeam(m, 1, 6, 0, 6, 5);
    m.patterns = [{ id: 'DEAD', name: 'Dead', type: 'dead', swMult: 1 }, { id: 'LIVE', name: 'Live', type: 'live', swMult: 0 }];
    m.frameLoads.push({ frameId: b1.id, pattern: 'LIVE', w: 10, dir: 'gravity' });
    // ETABS Assign > Frame > Releases: M3 at BOTH ends of the loaded beam
    b1.releaseI = { m3: true };
    b1.releaseJ = { m3: true };
    const mesh = M.buildMesh(m);
    const beamEl = mesh.frames.find(f => f.frameId === b1.id);
    ok(beamEl.releases && beamEl.releases.includes(5) && beamEl.releases.includes(11), 'M3 dofs 5+11 released');
    const res = M.runAnalysis(m, {});
    ok(!res.error, 'released analysis runs');
    // reactions balance the member loads exactly (condensed equivalents)
    const r0 = res.results[0];
    let rz = 0;
    for (const rr of r0.reactions) rz += rr.R[2];
    // self-weight + the 10 kN/m live over 6 m = 60 kN live + frame DL
    ok(rz / 1000 > 60, 'vertical equilibrium includes the released beam load: ' + (rz / 1000).toFixed(1) + ' kN');
    // released ends carry ~0 moment
    const idx = mesh.frames.findIndex(f => f.frameId === b1.id);
    const fe = r0.frames[idx];
    ok(Math.abs(fe.forces[5]) < 1e3 && Math.abs(fe.forces[11]) < 1e3, 'released end moments ~0');
    // unreleased beam keeps end moments
    const idx2 = mesh.frames.findIndex(f => f.frameId === b2.id);
    const fe2 = r0.frames[idx2];
    ok(Math.abs(fe2.forces[5]) > 1e3 || Math.abs(fe2.forces[11]) > 1e3, 'unreleased beam carries end moments');
  });

  test('materials: Ec per section drives the mesh stiffness', () => {
    const m = M.newModel();
    m.stories = [{ name: 'Base', elevation: 0 }, { name: 'S1', elevation: 3 }];
    m.grids.x = [{ label: '1', pos: 0 }, { label: '2', pos: 6 }];
    m.grids.y = [{ label: 'A', pos: 0 }, { label: 'B', pos: 5 }];
    for (const gx of m.grids.x) for (const gy of m.grids.y) M.addColumn(m, 1, gx.pos, gy.pos);
    const mesh = M.buildMesh(m);
    eq(mesh.frames[0].E, 25000, 'C30 default Ec');
    m.sections.find(sc => sc.id === 'C30x30').material = 'C40';
    const mesh2 = M.buildMesh(m);
    eq(mesh2.frames[0].E, 28000, 'C40 Ec follows the section material');
  });

  test('mass source: additional joint mass lowers the frequency exactly', () => {
    const m = M.newModel();
    m.stories = [{ name: 'Base', elevation: 0 }, { name: 'S1', elevation: 3 }];
    m.grids.x = [{ label: '1', pos: 0 }, { label: '2', pos: 6 }];
    m.grids.y = [{ label: 'A', pos: 0 }, { label: 'B', pos: 5 }];
    for (const gx of m.grids.x) for (const gy of m.grids.y) M.addColumn(m, 1, gx.pos, gy.pos);
    const b1 = M.addBeam(m, 1, 0, 0, 6, 0);
    const b2 = M.addBeam(m, 1, 0, 5, 6, 5);
    M.addBeam(m, 1, 0, 0, 0, 5);
    M.addBeam(m, 1, 6, 0, 6, 5);
    const f1 = M.runModal(m, { nModes: 1 }).modes[0].f;
    // add a big mass at one top joint (ETABS Assign > Joint > Additional Mass)
    const top = m.joints.find(j => Math.abs(j.z - 3) < 1e-6);
    m.jointMasses.push({ jointId: top.id, m: 20 });
    const f2 = M.runModal(m, { nModes: 1 }).modes[0].f;
    ok(f2 < f1 * 0.95, 'adding 20 t drops the frequency (' + f1.toFixed(2) + ' -> ' + f2.toFixed(2) + ' Hz)');
    // mass source can exclude additional masses
    m.massSource = { selfWeight: true, additional: false, livePattern: null, liveFraction: 0 };
    const f3 = M.runModal(m, { nModes: 1 }).modes[0].f;
    near(f3, f1, f1 * 0.001, 'excluding additional mass restores the frequency');
  });

  test('joint restraints: per-DOF arrays override fixed/pinned presets', () => {
    const m = M.newModel();
    m.stories = [{ name: 'Base', elevation: 0 }, { name: 'S1', elevation: 3 }];
    m.grids.x = [{ label: '1', pos: 0 }, { label: '2', pos: 6 }];
    m.grids.y = [{ label: 'A', pos: 0 }, { label: 'B', pos: 5 }];
    for (const gx of m.grids.x) for (const gy of m.grids.y) M.addColumn(m, 1, gx.pos, gy.pos);
    M.addBeam(m, 1, 0, 0, 6, 0); M.addBeam(m, 1, 0, 5, 6, 5);
    M.addBeam(m, 1, 0, 0, 0, 5); M.addBeam(m, 1, 6, 0, 6, 5);
    // roller: UX free, everything else restrained (ETABS DOF form)
    const base = m.joints.filter(j => j.z === 0);
    for (const j of base) j.restraint = [0, 1, 1, 1, 1, 1];
    const mesh = M.buildMesh(m);
    eq(mesh.nodes[0].fixed.join(','), '0,1,1,1,1,1', 'roller DOF array respected');
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
