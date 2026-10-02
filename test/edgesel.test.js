'use strict';
// tools/free.js EdgeSelectTool — the EDGES-ONLY selection mode: clicks and
// box drags pick edges (chain-aware), never faces/elements/annotations.
module.exports = h => {
  const { test, ok, eq } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

  function loadES() {
    const sandbox = { window: {}, console, Buffer };
    const ctx = vm.createContext(sandbox);
    for (const f of ['js/geometry.js', 'js/tools/base.js', 'js/model.js', 'js/tools/draw.js', 'js/tools/free.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
    const FT = sandbox.window.FreeTools;
    if (!FT || !FT.EdgeSelectTool) throw new Error('EdgeSelectTool not exported');
    return { FT, G: sandbox.window.G, Model: sandbox.window.Model };
  }
  const { FT, G, Model } = loadES();

  // stub app: screen map world (x,y) → (200 + 10x, 100 − 10y); events carry sx/sy
  function tool(pickEdge) {
    const m = new Model();
    const app = {
      model: m,
      sel: { edges: new Set(), faces: new Set() },
      run(l, fn) { return fn(m); },
      toast() { }, setStatus() { },
      clearSelection() { app.sel = { edges: new Set(), faces: new Set() }; },
      toggleEntities(pick) {
        for (const id of pick.edges || []) {
          if (app.sel.edges.has(id)) app.sel.edges.delete(id);
          else app.sel.edges.add(id);
        }
      },
      onSelectionChanged() { },
      bandEl: { classList: { add() { }, remove() { }, toggle() { } }, style: {} },
      view: {
        clearPreview() { }, invalidate() { }, setHoverEdges() { }, setHoverFace() { },
        toScreen: p => ({ x: 200 + p.x * 10, y: 100 - p.y * 10, behind: false }),
        eventPt: ev => ({ x: ev.sx || 0, y: ev.sy || 0 }),
      },
      pickEdgeAt: pickEdge || (() => null),
    };
    const t = Object.create(FT.EdgeSelectTool.prototype);
    t.app = app;
    return { t, m, app };
  }

  test('click picks ONLY the edge — a face under the cursor never enters the selection', () => {
    let clicked = null;
    const { t, m, app } = tool(ev => clicked); // the stub returns whatever we set
    const e = m.addEdge(G.v(0, 0, 0), G.v(4, 0, 0));
    m.addFaceFromRings([G.v(-1, -1, 0), G.v(5, -1, 0), G.v(5, 1, 0), G.v(-1, 1, 0)]); // a face right there
    clicked = { edge: e };
    t.onDown({ button: 0, sx: 220, sy: 100 });
    t.onUp({ sx: 220, sy: 100 });
    eq(app.sel.edges.size, 1, 'exactly one edge selected');
    ok(app.sel.edges.has(e.id), 'the clicked edge');
    eq(app.sel.faces.size, 0, 'no faces in the selection');
  });

  test('click empty space clears; a face-only area selects nothing', () => {
    const { t, app } = tool();
    app.sel.edges = new Set([999]);
    t.onDown({ button: 0, sx: 300, sy: 300 });
    t.onUp({ sx: 300, sy: 300 });
    eq(app.sel.edges.size, 0, 'cleared — pickEdgeAt found no edge');
  });

  test('clicking a chain segment selects the whole curve', () => {
    let clicked = null;
    const { t, m, app } = tool(ev => clicked);
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push(G.v(Math.cos(Math.PI * i / 8) * 2, Math.sin(Math.PI * i / 8) * 2, 0));
    m.addPolyline(pts, { type: 'arc', center: G.v(0, 0, 0), radius: 2, normal: G.v(0, 0, 1) });
    const seg = [...m.edges.values()].find(e => e.curveId);
    clicked = { edge: seg };
    t.onDown({ button: 0, sx: 220, sy: 80 });
    t.onUp({ sx: 220, sy: 80 });
    eq(app.sel.edges.size, 8, 'all 8 segments of the arc chain');
  });

  test('window box selects edges only (no faces), crossing catches touched', () => {
    const { t, m, app } = tool();
    const e1 = m.addEdge(G.v(0, 0, 0), G.v(4, 0, 0));   // screen 200..240 @ y100
    const e2 = m.addEdge(G.v(0, 6, 0), G.v(4, 6, 0));  // screen 200..240 @ y40
    m.addFaceFromRings([G.v(-1, -1, 0), G.v(5, -1, 0), G.v(5, 1, 0), G.v(-1, 1, 0)]);
    // window around e1 only (left→right)
    t.onDown({ button: 0, sx: 195, sy: 95 });
    t.onMove({ sx: 245, sy: 105 });
    t.onUp({ sx: 245, sy: 105 });
    eq(app.sel.edges.size, 1, 'one edge');
    ok(app.sel.edges.has(e1.id), 'the fully-inside line');
    eq(app.sel.faces.size, 0, 'the face spanning the box was NOT selected');
    // crossing (right→left) clipping e2's end
    t.onDown({ button: 0, sx: 245, sy: 35 });
    t.onMove({ sx: 235, sy: 45 });
    t.onUp({ sx: 235, sy: 45 });
    eq(app.sel.edges.size, 1, 'replaced with one edge');
    ok(app.sel.edges.has(e2.id), 'the touched line');
  });

  test('Shift adds to the current selection instead of replacing', () => {
    const { t, m, app } = tool();
    const e1 = m.addEdge(G.v(0, 0, 0), G.v(4, 0, 0));
    const e2 = m.addEdge(G.v(0, 2, 0), G.v(4, 2, 0));
    t.onDown({ button: 0, shiftKey: true, sx: 195, sy: 95 });
    t.onMove({ sx: 245, sy: 105 });
    t.onUp({ sx: 245, sy: 105 });
    const first = app.sel.edges.size;
    eq(first, 1, 'first box: one line');
    // second box below with shift — should ADD
    t.onDown({ button: 0, shiftKey: true, sx: 195, sy: 70 });
    t.onMove({ sx: 245, sy: 85 });
    t.onUp({ sx: 245, sy: 85 });
    eq(app.sel.edges.size, 2, 'both lines now selected');
    ok(app.sel.edges.has(e1.id) && app.sel.edges.has(e2.id));
  });

  test('Esc clears the selection and the band', () => {
    const { t, app } = tool();
    app.sel.edges = new Set([1, 2]);
    t._bandStart = { x: 0, y: 0 }; t._band = true;
    ok(t.onKey({ key: 'Escape' }), 'Esc handled');
    eq(app.sel.edges.size, 0, 'selection cleared');
    eq(t._bandStart, null, 'band closed');
  });

  // ---- Shift+'+' / '−' edge run growth (app.growEdgeRun) ----
  const { loadModel } = h;
  const L = loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/BimElement.js', 'js/db.js', 'js/lib/three.min.js', 'js/app.js', 'js/assets.js', 'js/tools/assets.js', 'js/features/onlinelib.js']);
  const w2 = L.window;
  const runApp = () => {
    const m2 = new w2.Model();
    const app2 = Object.assign(Object.create(w2.App.prototype), {
      model: m2, sel: { edges: new Set(), faces: new Set() },
      view: { rebuild() { }, invalidate() { }, clearPins() { }, clearPreview() { }, updateSelectionVisuals() { } },
      toast() { }, setStatus() { }, updateInfo() { },
      run: (l, fn) => fn(m2),
      transaction: { run: (l, fn) => fn(m2) },
    });
    return { app2, m2, G: w2.G };
  };

  test('Shift++ grows IN LINE — the perpendicular branch never joins the run', () => {
    const { app2, m2, G } = runApp();
    const a = m2.addEdge(G.v(0, 0, 0), G.v(3, 0, 0));   // seed
    const b = m2.addEdge(G.v(3, 0, 0), G.v(6, 0, 0));   // collinear continuation
    const c = m2.addEdge(G.v(3, 0, 0), G.v(3, 3, 0));   // perpendicular at the joint
    app2.sel.edges = new Set([a.id]);
    ok(app2.growEdgeRun(1), 'grow succeeded');
    ok(app2.sel.edges.has(b.id), 'the collinear edge joined');
    ok(!app2.sel.edges.has(c.id), 'the perpendicular edge stayed out');
    eq(app2.growEdgeRun(1), false, 'free end: run is blocked');
    eq(app2.sel.edges.size, 2, 'nothing added when blocked');
  });

  test('a corner CONTINUES the run — connected angled lines chain; Shift+− steps back', () => {
    const { app2, m2, G } = runApp();
    const a = m2.addEdge(G.v(0, 0, 0), G.v(3, 0, 0));
    const b = m2.addEdge(G.v(3, 0, 0), G.v(6, 0, 0));
    const c = m2.addEdge(G.v(6, 0, 0), G.v(6, 3, 0));   // 90° corner
    const d = m2.addEdge(G.v(6, 3, 0), G.v(3, 3, 0));   // another corner
    app2.sel.edges = new Set([a.id]);
    ok(app2.growEdgeRun(1), 'first grow');
    ok(app2.sel.edges.has(b.id), 'in-line edge taken first');
    ok(app2.growEdgeRun(1), 'grow through the corner');
    ok(app2.sel.edges.has(c.id), 'the angled edge joined the run');
    ok(app2.growEdgeRun(1), 'grow through the second corner');
    ok(app2.sel.edges.has(d.id), 'the run walks the whole polyline');
    eq(app2.growEdgeRun(1), false, 'free end: run is blocked');
    ok(app2.growEdgeRun(-1), 'shrink works');
    eq(app2.sel.edges.size, 3, 'one edge stepped back');
    ok(app2.growEdgeRun(-1), 'shrink again');
    ok(app2.growEdgeRun(-1), 'shrink to the seed');
    eq(app2.sel.edges.size, 1, 'back to the seed');
    eq(app2.growEdgeRun(-1), false, 'cannot shrink past the seed');
  });

  test('at a junction the STRAIGHTEST branch wins — even when all are angled', () => {
    const { app2, m2, G } = runApp();
    const seed = m2.addEdge(G.v(0, 0, 0), G.v(3, 0, 0));
    const near = m2.addEdge(G.v(3, 0, 0), G.v(6, 2.5, 0));   // ~40° deflection
    const wide = m2.addEdge(G.v(3, 0, 0), G.v(1.5, 3, 0));   // ~117° deflection
    app2.sel.edges = new Set([seed.id]);
    ok(app2.growEdgeRun(1), 'grow');
    ok(app2.sel.edges.has(near.id), 'the least-turning edge joined');
    ok(!app2.sel.edges.has(wide.id), 'the wide turn stayed out');
  });

  test('a closed rectangle loops around and never double-selects', () => {
    const { app2, m2, G } = runApp();
    const a = m2.addEdge(G.v(0, 0, 0), G.v(3, 0, 0));
    const b = m2.addEdge(G.v(3, 0, 0), G.v(3, 3, 0));
    const c = m2.addEdge(G.v(3, 3, 0), G.v(0, 3, 0));
    const d = m2.addEdge(G.v(0, 3, 0), G.v(0, 0, 0));
    app2.sel.edges = new Set([a.id]);
    let grew = 0;
    for (let i = 0; i < 8 && app2.growEdgeRun(1); i++) grew++;
    eq(grew, 3, 'the run closed the rectangle (3 more edges)');
    eq(app2.sel.edges.size, 4, 'all four sides selected, loop stops');
  });

  test('tangent arc segments chain — the run walks a curved edge', () => {
    const { app2, m2, G } = runApp();
    // an 8-segment quarter arc: consecutive segments deflect 11.25° (< 30°)
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8 * Math.PI / 2;
      pts.push(G.v(5 * Math.cos(t), 5 * Math.sin(t), 0));
    }
    for (let i = 0; i < 8; i++) m2.addEdge(pts[i], pts[i + 1]);
    const seed = m2.findEdge(m2.vertexAt(pts[0]), m2.vertexAt(pts[1]));
    app2.sel.edges = new Set([seed.id]);
    let grew = 0;
    for (let i = 0; i < 20 && app2.growEdgeRun(1); i++) grew++;
    eq(grew, 7, 'the whole arc chained (7 more segments)');
    eq(app2.sel.edges.size, 8, 'all 8 arc segments selected');
  });

  test('the run grows from the selection order — the last picked edge is the head', () => {
    const { app2, m2, G } = runApp();
    const a = m2.addEdge(G.v(0, 0, 0), G.v(1, 0, 0));
    const b = m2.addEdge(G.v(1, 0, 0), G.v(2, 0, 0));
    const c = m2.addEdge(G.v(2, 0, 0), G.v(3, 0, 0));
    // pick a THEN b (toggle order = run order): growth continues past b
    app2.sel.edges = new Set([a.id]);
    app2._edgeRunLogPush(a.id);
    app2.sel.edges.add(b.id); app2._edgeRunLogPush(b.id);
    ok(app2.growEdgeRun(1), 'grow');
    ok(app2.sel.edges.has(c.id), 'continued from the HEAD (b), not the tail');
    ok(app2.growEdgeRun(-1), 'shrink removes the head');
    ok(!app2.sel.edges.has(c.id) && app2.sel.edges.has(b.id), 'c dropped, a+b remain');
  });
};
