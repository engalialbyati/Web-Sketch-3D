'use strict';
// ---------------------------------------------------------------------------
// offsets.test.js — insertion offsets / justification (cardinal points):
// the analytical axis stays, the solid shifts. Beam lateral offset is
// angle-proof (perpendicular to the run); column offsets are global X/Y.
// Flush math: delta = (hostReach - targetReach) / 2.
// ---------------------------------------------------------------------------
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  // harness loads geometry/model/StructuralManager by default; one sandbox
  const L = loadModel();
  const { G } = L;
  const Model = L.Model;
  const { StructuralManager } = L.sandbox.window;
  const S = new StructuralManager(() => [], () => []);

  test('flushDelta: (host - target) / 2, column/beam reaches', () => {
    // 200 column vs 100 beam along the beam's lateral: (0.1 - 0.05)/2
    const col = { type: 'column', params: { width: 0.2, depth: 0.2 } };
    const beam = { type: 'beam', params: { webWidth: 0.1 } };
    near(S.flushDelta(beam, col, 0, 1), (0.1 - 0.05) / 2, 1e-12, 'beam flush to column: +25 mm');
    near(S.flushDelta(col, beam, 0, 1), (0.05 - 0.1) / 2, 1e-12, 'column flush to beam: -25 mm');
    // rotated column reach = support function of the box
    near(S.columnPlanReach({ width: 0.2, depth: 0.2, rotation: 0 }, 1, 0), 0.1, 1e-9, 'axis-aligned reach');
    near(S.columnPlanReach({ width: 0.2, depth: 0.2, rotation: Math.PI / 4 }, 1, 0),
      0.1 * Math.SQRT2, 1e-9, '45-degree reach = half-diagonal');
    near(S.columnPlanReach({ width: 0.3, depth: 0.2, rotation: Math.PI / 2 }, 1, 0), 0.1, 1e-9, 'swapped axes');
  });

  test('beam lateral offset: solid shifts, analytical baseline intact', () => {
    const m = new Model();
    const S2 = new StructuralManager(() => [{ id: 'l1', elevation: 3 }], () => m.bimEntities = []);
    const base = { baseline: [[0, 0, 3], [2, 0, 3]], profile: 'rectangular',
      webWidth: 0.25, height: 0.5, referenceLevelId: 'l1', zJustification: 'Top' };
    const build = p => {
      const before = new Set(m.faces.keys());
      m.bimHold = true;
      S2.buildBeam(G, m, p);
      m.bimHold = false;
      return [...m.faces.keys()].filter(id => !before.has(id)).map(id => m.faces.get(id));
    };
    const centerFaces = build({ ...base });
    let y0 = 1e9, y1 = -1e9;
    for (const f of centerFaces) { const c = m.faceCentroid(f); if (c) { y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y); } }
    near((y0 + y1) / 2, 0, 1e-9, 'centered on the baseline');
    const offFaces = build({ ...base, baseline: [[0, 5, 3], [2, 5, 3]], offsetLateral: 0.05 });
    let oy0 = 1e9, oy1 = -1e9;
    for (const f of offFaces) { const c = m.faceCentroid(f); if (c) { oy0 = Math.min(oy0, c.y); oy1 = Math.max(oy1, c.y); } }
    near((oy0 + oy1) / 2, 5.05, 1e-9, 'solid shifted +50 mm laterally (y for an x-run)');
  });

  test('column offsets: solid shifts, params.base is the analytical position', () => {
    const m = new Model();
    const S2 = new StructuralManager(() => [{ id: 'l1', elevation: 0 }], () => []);
    const build = p => {
      const before = new Set(m.faces.keys());
      m.bimHold = true;
      S2.buildColumn(G, m, p);
      m.bimHold = false;
      return [...m.faces.keys()].filter(id => !before.has(id)).map(id => m.faces.get(id));
    };
    const base = { base: [1, 1, 0], width: 0.3, depth: 0.3, height: 3, baseLevel: 'l1' };
    const f1 = build({ ...base });
    let x1 = -1e9, y1 = -1e9;
    for (const f of f1) { const c = m.faceCentroid(f); if (c) { x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); } }
    near(x1, 1.15, 1e-9, 'face at +width/2');
    near(y1, 1.15, 1e-9, 'face at +depth/2');
    const f2 = build({ ...base, base: [5, 5, 0], offsetX: 0.02, offsetY: -0.01 });
    let x2 = -1e9, y2 = 1e9;
    for (const f of f2) { const c = m.faceCentroid(f); if (c) { x2 = Math.max(x2, c.x); y2 = Math.min(y2, c.y); } }
    near(x2, 5.17, 1e-9, '+20 mm X shift');
    near(y2, 4.84, 1e-9, '-10 mm Y shift');
  });

  test('flush host finders: column at beam end, beam crossing column', () => {
    const ents = [
      { id: 'c1', type: 'column', params: { base: [0, 0, 0], width: 0.2, depth: 0.2, height: 3 } },
      { id: 'b1', type: 'beam', params: { baseline: [[0, 0, 3], [0, 4, 3]], webWidth: 0.1 } }, // runs +Y at x=0
    ];
    const hostCol = S.columnAtBeamEnd({ baseline: [[0, 0, 3], [3, 0, 3]] }, ents);
    eq(hostCol && hostCol.id, 'c1', 'column at the beam start found');
    // column at (0,2): the +Y beam crosses it; flush along X (beam runs perpendicular)
    const hostBeam = S.beamCrossingColumn({ base: [0, 2, 0] }, 1, 0, ents);
    eq(hostBeam && hostBeam.id, 'b1', 'crossing beam found for an X flush');
    const none = S.beamCrossingColumn({ base: [0, 2, 0] }, 0, 1, ents);
    eq(none, null, 'no host when the beam runs ALONG the axis');
  });
};
