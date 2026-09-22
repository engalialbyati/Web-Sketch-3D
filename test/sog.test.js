'use strict';
// sog.test.js — MNL-66(20) Phase 8 slab-on-ground: SOG-102/103/105
// perimeter steel. 2 continuous bottom bars per exterior edge, lapped
// past the corners, clipped to the slab polygon; the mesh itself stays
// continuous (no trimming at the thickening).
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const L = loadModel(['js/tools/base.js', 'js/features/rebar.js',
    'js/features/columnrebar.js', 'js/features/elementrebar.js']);
  const { G } = L;
  const Model = L.Model;
  const { ElementRebar: ER } = L.sandbox.window;

  const slabWorld = () => {
    const m = new Model();
    const before = new Set(m.faces.keys());
    const f = m.addFaceFromRings([G.v(0, 0, 3), G.v(4, 0, 3), G.v(4, 3, 3), G.v(0, 3, 3)]);
    m.pushPull(f, -0.15);
    const faces = [...m.faces.keys()].filter(id => !before.has(id));
    for (const fid of faces) {
      const f2 = m.faces.get(fid);
      if (!f2.userData) f2.userData = {};
      f2.userData.bimEntityId = 's1'; f2.userData.bimType = 'floor';
    }
    const ent = { id: 's1', type: 'floor', faces,
      params: { regions: [{ outer: [], holes: [] }], thickness: 0.15 } };
    return { m, ent };
  };
  const slabP = extra => ({ type: 'slab', slab: Object.assign({
    bottom: 0.025, top: 0.025, side: 0.025,
    xDia: 0.012, xSpacing: 0.15, yDia: 0.012, ySpacing: 0.15,
    topMesh: false, topDia: 0,
  }, extra) });

  test('SOG-102/105: 2 continuous bars per edge, lapped past the corners', () => {
    const w = slabWorld();
    const res = ER.buildElementRebar(w.m, w.ent.faces[0], slabP({ sog: true, sogDia: 0.012 }), [w.ent]);
    ok(!res.error, res.error || 'no error');
    const rb = [...new Map([...w.m.faces.values()]
      .filter(f => f.userData && f.userData.rebar)
      .map(f => [f.userData.rebar.pid, f.userData.rebar])).values()];
    const edges = rb.filter(r => r.role === 'sog-edge');
    eq(edges.length, 8, '2 bars x 4 edges');
    // geometry: read one bottom-edge bar back from the preview
    const pv = ER.previewElementRebar(w.m, w.ent.faces[0], slabP({ sog: true, sogDia: 0.012 }), [w.ent]);
    const eb = pv.paths.filter(q => q.pts.length === 2
      && Math.abs(q.pts[0].z - q.pts[1].z) < 1e-9
      && Math.abs(q.pts[0].y - q.pts[1].y) < 1e-9
      && q.pts[0].y < 0.15
      && Math.abs(q.pts[0].z - (3 - (0.025 + 0.012 + 0.012 + 0.006))) < 2e-3
      && q.pts[1].x - q.pts[0].x >= 3.85); // the sog resting z (corner bars are L/5)
    eq(eb.length, 2, 'two bars along the bottom edge');
    for (const b of eb) {
      // the lap extension: min(0.6, L/4) past each corner, but clipped
      // inside the polygon - the pair from the adjacent edge takes over
      const len = b.pts[1].x - b.pts[0].x;
      ok(len >= 3.85, `edge bar spans the edge (len ${len.toFixed(2)})`);
      ok(b.pts[0].x >= -1e-6 && b.pts[1].x <= 4 + 1e-6, 'clipped inside the slab');
      ok(b.pts[0].y >= 0.025 && b.pts[0].y < 0.12, `bar line at the cover inset (y ${b.pts[0].y.toFixed(3)})`);
    }
    eb.sort((a, b) => a.pts[0].y - b.pts[0].y);
    near(eb[1].pts[0].y, eb[0].pts[0].y + 0.012 + 0.025, 2e-3, 'the pair stacks 25 mm clear');
    // the bars rest ON the mesh (below the top X layer, above the cover)
    ok(eb[0].pts[0].z < 3 - 0.025 - 0.012 - 0.012 && eb[0].pts[0].z > 3 - 0.15 + 0.025,
      `bars sit in the bottom thickening (z ${eb[0].pts[0].z.toFixed(3)})`);
  });

  test('SOG off: no edge bars (regression)', () => {
    const w = slabWorld();
    const pv = ER.previewElementRebar(w.m, w.ent.faces[0], slabP(), [w.ent]);
    ok(!pv.error, pv.error || 'no error');
    const edgeLike = pv.paths.filter(q => q.pts.length === 2
      && Math.abs(q.pts[0].z - q.pts[1].z) < 1e-9
      && Math.abs(q.pts[0].y - q.pts[1].y) < 1e-9
      && Math.abs(q.pts[0].z - (3 - (0.025 + 0.012 + 0.012 + 0.006))) < 2e-3
      && q.pts[1].x - q.pts[0].x >= 3.85);
    ok(edgeLike.length === 0, 'no perimeter steel without the SOG flag');
  });

  test('SOG-103: the mesh stays continuous through the thickening', () => {
    const w = slabWorld();
    const pv = ER.previewElementRebar(w.m, w.ent.faces[0], slabP({ sog: true }), [w.ent]);
    // plain mesh rows: x-running bars spanning the full 4 m at the covers
    const xb = pv.paths.filter(q => q.pts.length === 2
      && Math.abs(q.pts[0].z - q.pts[1].z) < 1e-9
      && Math.abs(q.pts[0].y - q.pts[1].y) < 1e-9 && q.pts[0].y > 0.2);
    ok(xb.some(q => q.pts[1].x - q.pts[0].x > 3.9), 'interior mesh rows span the full slab');
  });
};
