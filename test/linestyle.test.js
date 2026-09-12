'use strict';
// Edge display styles (linetype / lineweight / layer), edge thickness, and
// the sweep builders behind the Model ribbon (Revolve, Follow Me).
module.exports = h => {
  const { test, ok, eq, near, makeWorld } = h;

  test('edge linetype/lineweight/layer round-trip through serialize', () => {
    const w = makeWorld(), { G, m } = w;
    const e = m.addEdge(G.v(0, 0, 0), G.v(3, 0, 0));
    m.setEdgeStyle([e.id], { lt: 2, lw: 4, layerId: '0' });
    m.load(m.serialize());
    const e2 = [...m.edges.values()].find(x => m.vp(x.a).x === 0 && m.vp(x.a).y === 0 && m.vp(x.a).z === 0);
    eq(e2.lt, 2, 'linetype survives');
    eq(e2.lw, 4, 'lineweight survives');
    eq(e2.layerId || '0', '0', 'layer survives');
    w.vclean('style roundtrip');
  });

  test('ByLayer resolution: unset edge follows its layer linetype default', () => {
    const w = makeWorld(), { G, m } = w;
    m.layers.push({ id: 'lyr_9', name: 'Hidden Walls', color: null, visible: true, locked: false, lt: 3, lw: 2 });
    const e = m.addEdge(G.v(0, 0, 0), G.v(1, 0, 0));
    e.layerId = 'lyr_9';
    let st = m.resolveEdgeStyle(e);
    eq(st.lt, 3, 'ByLayer linetype');
    eq(st.lw, 2, 'ByLayer lineweight');
    m.setEdgeStyle([e.id], { lt: 1 }); // explicit override wins
    st = m.resolveEdgeStyle(e);
    eq(st.lt, 1, 'override');
    eq(st.lw, 2, 'unrelated field still ByLayer');
    w.vclean('bylayer');
  });

  test('edge thickness grows a vertical ribbon and re-sets cleanly', () => {
    const w = makeWorld(), { G, m } = w;
    const e = m.addEdge(G.v(0, 0, 0), G.v(4, 0, 0));
    ok(m.thickenEdge(e.id, 2.5), 'ribbon face created');
    near(m.edgeThickness(e.id), 2.5, 1e-9, 'thickness reads back');
    m.thickenEdge(e.id, 1.0); // re-set replaces the old ribbon
    near(m.edgeThickness(e.id), 1.0, 1e-9, 're-set thickness');
    const ribbons = [...m.faces.values()].filter(f => f.userData && f.userData.fromEdge === e.id);
    eq(ribbons.length, 1, 'exactly one ribbon lives at a time');
    m.unthickenEdge(e.id);
    eq(m.edgeThickness(e.id), 0, 'cleared');
    w.vclean('thicken');
  });

  test('revolve: a full circle profile about an external axis closes watertight', () => {
    const w = makeWorld(), { G, m } = w;
    // donut profile: circle of r=0.5 centered at (3, 0) in the XZ plane,
    // revolved about Z
    const ring = [];
    for (let i = 0; i < 16; i++) {
      const t = i / 16 * Math.PI * 2;
      ring.push(G.v(3 + Math.cos(t) * 0.5, 0, Math.sin(t) * 0.5));
    }
    const f = m.addFaceFromRings(ring);
    const r = m.revolveFace(f.id, G.v(0, 0, 0), G.v(0, 0, 1), 360, 24);
    ok(!r.error, 'revolve succeeded');
    eq(m.shellOpenEdges(r.faces), 0, 'torus is watertight');
    // tessellated expectation: the 16-gon inscribed profile × 24-gon sweep
    // both read slightly under the analytic 2π²Rr² ≈ 14.80
    const vol = m.shellVolume(r.faces);
    ok(vol > 13.8 && vol < 14.8, `torus volume ~2π²Rr² (got ${vol.toFixed(2)})`);
    ok(!m.faces.has(f.id), 'profile consumed');
    w.vclean('revolve torus');
  });

  test('revolve: a partial turn caps both ends', () => {
    const w = makeWorld(), { G, m } = w;
    const ring = [];
    for (let i = 0; i < 12; i++) {
      const t = i / 12 * Math.PI * 2;
      ring.push(G.v(3 + Math.cos(t) * 0.4, 0, Math.sin(t) * 0.4));
    }
    const f = m.addFaceFromRings(ring);
    const r = m.revolveFace(f.id, G.v(0, 0, 0), G.v(0, 0, 1), 180, 18);
    ok(!r.error, 'half turn');
    eq(m.shellOpenEdges(r.faces), 0, 'caps close the half torus');
    w.vclean('revolve half');
  });

  test('revolve refuses an axis that touches the profile', () => {
    const w = makeWorld(), { G, m } = w;
    const f = w.rect([[0.5, -0.5, 0], [2, -0.5, 0], [2, 0.5, 0], [0.5, 0.5, 0]]);
    const r = m.revolveFace(f.id, G.v(0, 0, 0), G.v(0, 0, 1), 360, 8);
    ok(!r.error, 'clear axis revolves');
    const g = w.rect([[0, -0.5, 0], [2, -0.5, 0], [2, 0.5, 0], [0, 0.5, 0]]);
    const r2 = m.revolveFace(g.id, G.v(0, 0, 0), G.v(0, 0, 1), 360, 8);
    ok(r2.error, 'axis through the profile ring refuses');
    ok(m.faces.has(g.id), 'refused profile survives untouched');
    w.vclean('revolve guard');
  });

  test('follow me: a square profile along an L path closes with caps', () => {
    const w = makeWorld(), { G, m } = w;
    const sq = m.addFaceFromRings([G.v(0, 0, 3), G.v(0.3, 0, 3), G.v(0.3, 0.3, 3), G.v(0, 0.3, 3)]);
    const path = [G.v(0, 0, 3), G.v(2, 0, 3), G.v(2, 2, 3), G.v(2, 2, 5)];
    const r = m.sweepFaceAlongPath(sq.id, path);
    ok(!r.error, 'sweep succeeded');
    eq(m.shellOpenEdges(r.faces), 0, 'swept tube is watertight');
    ok(!m.faces.has(sq.id), 'profile consumed');
    w.vclean('follow me');
  });

  test('raw faces honor their layer: hidden layer drops them, style survives undo', () => {
    const w = makeWorld(), { m } = w;
    const f = w.rect([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
    m.setFaceLayers([f.id], 'lyr_x');
    eq(f.layerId, 'lyr_x', 'face layer set');
    const snap = m.serialize();
    m.load(snap);
    const f2 = [...m.faces.values()][0];
    eq(f2.layerId, 'lyr_x', 'face layer round-trips');
    w.vclean('face layer');
  });
};
