'use strict';
// features/edgeoffset.js — the AutoCAD-style OFFSET: distance-first flow,
// line/polyline/arc offsets (arcs are CONCENTRIC: same center, radius ± d).
module.exports = h => {
  const { test, ok, eq, near } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

  function loadEO() {
    const sandbox = { window: {}, console, Buffer };
    const ctx = vm.createContext(sandbox);
    for (const f of ['js/geometry.js', 'js/tools/base.js', 'js/model.js',
      'js/tools/draw.js', 'js/features/edgeoffset.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
    if (!sandbox.window.EdgeOffset) throw new Error('EdgeOffset not exported');
    return sandbox.window;
  }
  const W = loadEO();
  const EO = W.EdgeOffset;
  const { G, Model } = W;

  // a minimal tool instance with stubbed app plumbing
  function tool() {
    const m = new Model();
    const app = {
      model: m,
      bim: { entities: m.bimEntities },
      run(l, fn) { return fn(m); },
      transaction: { run(l, fn) { return fn(m); } },
      toast() { }, setStatus() { },
      view: { clearPreview() { }, invalidate() { }, setHoverEdges() { } },
      inferPoint() { return { p: G.v(0, 0, 0) }; },
      pickEdgeAt() { return null; },
    };
    const t = Object.create(EO.EdgeOffsetTool.prototype);
    t.app = app;
    t.activate();
    return { t, m, app };
  }

  test('AutoCAD flow: distance first — clicks refuse until a distance is typed', () => {
    const { t } = tool();
    eq(t.dist, null, 'starts unarmed');
    // a click before typing toasts and does nothing
    t.onDown({ button: 0 });
    eq(t.pick, null, 'no pick without distance');
    // typing arms it
    ok(t.onVCB('0.25'), 'VCB accepted');
    eq(t.dist, 0.25, 'distance armed');
    // a new typed distance re-arms (pick cleared)
    t.pick = {};
    ok(t.onVCB('0.5'));
    eq(t.dist, 0.5);
    eq(t.pick, null, 're-typing clears the pick');
  });

  test('line offset: perpendicular copy at the typed distance', () => {
    const { t, m } = tool();
    t.onVCB('0.3');
    const e = m.addEdge(G.v(0, 0, 0), G.v(4, 0, 0));
    t.pick = t._pickAt({ }); // null — set manually from the edge
    // build the pick the way _pickAt does
    t.pick = null;
    const pts = t._chainPts(m, e);
    t.pick = { kind: 'line', pts, cid: 0, meta: null, edgeIds: [e.id] };
    const before = m.edges.size;
    t._commit(1); // +side (cursor left of +x run = +y here by convention)
    eq(m.edges.size, before + 1, 'offset copy created');
    const ne = [...m.edges.values()].find(x => x.id !== e.id);
    const a = m.vp(ne.a), b = m.vp(ne.b);
    near(Math.min(a.y, b.y), 0.3, 1e-9, 'copy sits 0.3 m off the source');
    near(Math.abs(a.x - b.x), 4, 1e-9, 'same run length');
  });

  test('arc offset is CONCENTRIC: same center, radius + d, no distortion', () => {
    const { t, m } = tool();
    t.onVCB('0.5');
    // a half-circle arc via addPolyline + curve meta (the arc tool's shape)
    const O = G.v(5, 5, 0), r = 2;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * i / 12;
      pts.push(G.v(O.x + Math.cos(a) * r, O.y + Math.sin(a) * r, 0));
    }
    m.addPolyline(pts, { type: 'arc', center: G.clone(O), radius: r, normal: G.v(0, 0, 1) });
    const edge = [...m.edges.values()].find(x => x.curveId);
    const chain = t._chainPts(m, edge);
    t.pick = { kind: 'arc', pts: chain, cid: edge.curveId, meta: m.curves.get(edge.curveId), edgeIds: m.curveEdges(edge.curveId).map(x => x.id) };
    const before = m.edges.size;
    const curvesBefore = m.curves.size;
    t._commit(1); // away from center: radius grows
    eq(m.edges.size > before, true, 'offset arc created');
    eq(m.curves.size, curvesBefore + 1, 'new arc metadata registered');
    const newCid = [...m.curves.keys()].find(id => id !== edge.curveId);
    const meta = m.curves.get(newCid);
    near(meta.radius, 2.5, 1e-9, 'concentric: radius + 0.5');
    near(meta.center.x, 5, 1e-9, 'same center');
    near(meta.center.y, 5, 1e-9, 'same center y');
    // every vertex of the copy is equidistant from the center
    const ce = m.curveEdges(newCid);
    for (const e2 of ce) {
      const d1 = G.dist(meta.center, m.vp(e2.a));
      near(d1, 2.5, 5e-3, 'vertex on the new radius');
    }
  });

  test('arc offset toward the center shrinks the radius (min clamp)', () => {
    const { t, m } = tool();
    t.onVCB('0.8');
    const O = G.v(0, 0, 0), r = 2;
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + Math.PI * i / 10;
      pts.push(G.v(O.x + Math.cos(a) * r, O.y + Math.sin(a) * r, 0));
    }
    m.addPolyline(pts, { type: 'arc', center: G.clone(O), radius: r });
    const edge = [...m.edges.values()].find(x => x.curveId);
    const chain = t._chainPts(m, edge);
    t.pick = { kind: 'arc', pts: chain, cid: edge.curveId, meta: m.curves.get(edge.curveId), edgeIds: [] };
    t._commit(-1); // toward center
    const newCid = [...m.curves.keys()].find(id => id !== edge.curveId);
    near(m.curves.get(newCid).radius, 1.2, 1e-9, 'radius − 0.8');
  });

  test('repeat flow: after a commit the distance stays armed', () => {
    const { t, m } = tool();
    t.onVCB('0.25');
    const e = m.addEdge(G.v(0, 0, 0), G.v(2, 0, 0));
    t.pick = { kind: 'line', pts: [G.v(0, 0, 0), G.v(2, 0, 0)], cid: 0, meta: null, edgeIds: [e.id] };
    t._commit(1);
    eq(t.dist, 0.25, 'distance survives the commit');
    eq(t.pick, null, 'pick cleared, ready for the next curve');
  });
};
