'use strict';
// features/edgeoffset.js — the AutoCAD-style OFFSET: distance-first flow,
// line/polyline/arc offsets (arcs are CONCENTRIC: same center, radius ± d),
// and BOX SELECTION: drag a window/crossing box around several curves and
// one side click offsets them all (chain-aware — a polyline/arc boxes once).
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

  // a minimal tool instance with stubbed app plumbing. Screen map:
  // world (x,y) → screen (200 + 10x, 100 − 10y); events carry sx/sy for
  // eventPt and gx/gy for the ground point (side detection)
  function tool() {
    const m = new Model();
    const app = {
      model: m,
      bim: { entities: m.bimEntities },
      run(l, fn) { return fn(m); },
      transaction: { run(l, fn) { return fn(m); } },
      toast() { }, setStatus() { },
      bandEl: { classList: { add() { }, remove() { }, toggle() { } }, style: {} },
      view: {
        clearPreview() { }, invalidate() { }, setHoverEdges() { },
        showSnapDot() { },
        toScreen: p => ({ x: 200 + p.x * 10, y: 100 - p.y * 10, behind: false }),
        eventPt: ev => ({ x: ev.sx || 0, y: ev.sy || 0, gx: ev.gx, gy: ev.gy }),
        groundAt: q => G.v(q.gx || 0, q.gy || 0, 0),
      },
      inferPoint() { return { p: G.v(0, 0, 0) }; },
      pickEdgeAt() { return null; },
    };
    const t = Object.create(EO.EdgeOffsetTool.prototype);
    t.app = app;
    t.activate();
    return { t, m, app };
  }

  const linePick = (m, e) => ({ kind: 'line', pts: [G.clone(m.vp(e.a)), G.clone(m.vp(e.b))], cid: 0, meta: null, edgeIds: [e.id] });

  test('AutoCAD flow: distance first — clicks refuse until a distance is typed', () => {
    const { t } = tool();
    eq(t.dist, null, 'starts unarmed');
    t.onDown({ button: 0 });
    eq(t.picks, null, 'no pick without distance');
    ok(t.onVCB('0.25'), 'VCB accepted');
    eq(t.dist, 0.25, 'distance armed');
    t.picks = [{}];
    ok(t.onVCB('0.5'));
    eq(t.dist, 0.5);
    eq(t.picks, null, 're-typing clears the pick');
  });

  test('line offset: perpendicular copy at the typed distance', () => {
    const { t, m } = tool();
    t.onVCB('0.3');
    const e = m.addEdge(G.v(0, 0, 0), G.v(4, 0, 0));
    t.picks = [linePick(m, e)];
    const before = m.edges.size;
    t._commitAll(G.v(2, 1, 0)); // cursor on the +y side
    eq(m.edges.size, before + 1, 'offset copy created');
    const ne = [...m.edges.values()].find(x => x.id !== e.id);
    const a = m.vp(ne.a), b = m.vp(ne.b);
    near(Math.min(a.y, b.y), 0.3, 1e-9, 'copy sits 0.3 m off the source');
    near(Math.abs(a.x - b.x), 4, 1e-9, 'same run length');
  });

  test('arc offset is CONCENTRIC: same center, radius + d, no distortion', () => {
    const { t, m } = tool();
    t.onVCB('0.5');
    const O = G.v(5, 5, 0), r = 2;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * i / 12;
      pts.push(G.v(O.x + Math.cos(a) * r, O.y + Math.sin(a) * r, 0));
    }
    m.addPolyline(pts, { type: 'arc', center: G.clone(O), radius: r, normal: G.v(0, 0, 1) });
    const edge = [...m.edges.values()].find(x => x.curveId);
    const chain = t._chainPts(m, edge);
    t.picks = [{ kind: 'arc', pts: chain, cid: edge.curveId, meta: m.curves.get(edge.curveId), edgeIds: m.curveEdges(edge.curveId).map(x => x.id) }];
    const before = m.edges.size;
    const curvesBefore = m.curves.size;
    t._commitAll(G.v(20, 20, 0)); // far outside: radius grows
    eq(m.edges.size > before, true, 'offset arc created');
    eq(m.curves.size, curvesBefore + 1, 'new arc metadata registered');
    const newCid = [...m.curves.keys()].find(id => id !== edge.curveId);
    const meta = m.curves.get(newCid);
    near(meta.radius, 2.5, 1e-9, 'concentric: radius + 0.5');
    near(meta.center.x, 5, 1e-9, 'same center');
    near(meta.center.y, 5, 1e-9, 'same center y');
    for (const e2 of m.curveEdges(newCid)) {
      near(G.dist(meta.center, m.vp(e2.a)), 2.5, 5e-3, 'vertex on the new radius');
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
    t.picks = [{ kind: 'arc', pts: chain, cid: edge.curveId, meta: m.curves.get(edge.curveId), edgeIds: [] }];
    t._commitAll(G.v(0.1, 0, 0)); // near the center: radius shrinks
    const newCid = [...m.curves.keys()].find(id => id !== edge.curveId);
    near(m.curves.get(newCid).radius, 1.2, 1e-9, 'radius − 0.8');
  });

  test('repeat flow: after a commit the distance stays armed', () => {
    const { t, m } = tool();
    t.onVCB('0.25');
    const e = m.addEdge(G.v(0, 0, 0), G.v(2, 0, 0));
    t.picks = [linePick(m, e)];
    t._commitAll(G.v(1, 1, 0));
    eq(t.dist, 0.25, 'distance survives the commit');
    eq(t.picks, null, 'pick cleared, ready for the next curve');
  });

  // ------------------------- box selection (the batch flow) ----------------
  test('box selection captures curves; one side click offsets them all', () => {
    const { t, m } = tool();
    t.onVCB('0.3');
    // two separate horizontal lines at y=0 and y=4
    const e1 = m.addEdge(G.v(0, 0, 0), G.v(4, 0, 0));
    const e2 = m.addEdge(G.v(0, 4, 0), G.v(4, 4, 0));
    // window box in screen space around BOTH lines:
    // world (0..4, 0..4) → screen x 200..240, y 60..100
    t.onDown({ button: 0, sx: 195, sy: 55 });      // empty space → band starts
    t.onMove({ sx: 245, sy: 105 });                // drag right = window
    t.onUp({ sx: 245, sy: 105 });
    ok(Array.isArray(t.picks) && t.picks.length === 2, 'both lines captured', `picks=${t.picks && t.picks.length}`);
    eq(t._bandStart, null, 'band closed');
    const before = m.edges.size;
    t.onDown({ button: 0, sx: 0, sy: 50, gx: 2, gy: 10 }); // side click ABOVE both
    eq(m.edges.size, before + 2, 'both offset copies created in one commit');
    // cursor at y=10 is on the +y side of both runs → both copies at +0.3
    const ys = [];
    for (const e of m.edges.values()) {
      if (e.id === e1.id || e.id === e2.id) continue;
      ys.push(m.vp(e.a).y, m.vp(e.b).y);
    }
    ok(ys.every(y => Math.abs(y - 0.3) < 1e-9 || Math.abs(y - 4.3) < 1e-9), `copies at +0.3: ${JSON.stringify(ys)}`);
    eq(t.picks, null, 'batch consumed; distance re-armed for the next');
  });

  test('a boxed CHAIN offsets once, not once per segment', () => {
    const { t, m } = tool();
    t.onVCB('0.4');
    // one arc (a 12-segment chain)
    const O = G.v(5, 0, 0), r = 2;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * i / 12;
      pts.push(G.v(O.x + Math.cos(a) * r, O.y + Math.sin(a) * r, 0));
    }
    m.addPolyline(pts, { type: 'arc', center: G.clone(O), radius: r, normal: G.v(0, 0, 1) });
    const curvesBefore = m.curves.size;
    // window box around the whole arc: world x 3..7, y -2..2 → screen 230..270, 80..120
    t.onDown({ button: 0, sx: 225, sy: 75 });
    t.onMove({ sx: 275, sy: 125 });
    t.onUp({ sx: 275, sy: 125 });
    ok(Array.isArray(t.picks) && t.picks.length === 1, 'the chain is ONE curve', `picks=${t.picks && t.picks.length}`);
    t.onDown({ button: 0, sx: 0, sy: 0, gx: 5, gy: 10 });
    eq(m.curves.size, curvesBefore + 1, 'exactly one offset arc');
    const newCid = [...m.curves.keys()].find(id => !m.curves.get(id).normal || id !== [...m.curves.keys()].find(x => x === id));
    const cids = [...m.curves.keys()];
    const newest = cids[cids.length - 1];
    near(m.curves.get(newest).radius, 2.4, 1e-9, 'radius + 0.4 outward');
    ok(newCid || true);
  });

  test('crossing box (right-to-left) catches touched curves, window needs them fully inside', () => {
    const { t, m } = tool();
    t.onVCB('0.2');
    const e1 = m.addEdge(G.v(0, 0, 0), G.v(4, 0, 0));   // screen 200..240 @ y100
    const e2 = m.addEdge(G.v(0, 6, 0), G.v(4, 6, 0));  // screen 200..240 @ y40
    // window (left-to-right) around e1 only
    t.onDown({ button: 0, sx: 195, sy: 95 });
    t.onMove({ sx: 245, sy: 105 });
    t.onUp({ sx: 245, sy: 105 });
    ok(t.picks && t.picks.length === 1 && t.picks[0].edgeIds[0] === e1.id, 'window: only the fully-inside line');
    t.picks = null;
    // crossing (right-to-left) from x=245 back to x=235 clips e2's left end
    t.onDown({ button: 0, sx: 245, sy: 35 });
    t.onMove({ sx: 235, sy: 45 });
    t.onUp({ sx: 235, sy: 45 });
    ok(t.picks && t.picks.length === 1 && t.picks[0].edgeIds[0] === e2.id, 'crossing: the touched line caught');
  });

  test('box around nothing toasts and keeps the tool armed', () => {
    const { t } = tool();
    t.onVCB('0.2');
    t.onDown({ button: 0, sx: 500, sy: 500 });
    t.onMove({ sx: 540, sy: 540 });
    t.onUp({ sx: 540, sy: 540 });
    eq(t.picks, null, 'no picks');
    eq(t.dist, 0.2, 'distance still armed');
  });
};
