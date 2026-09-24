'use strict';
// Line-entity + near-miss heal regressions:
//  1. the Line tool draws every click-to-click segment as its OWN line —
//     no shared polyline chain (selecting one segment must not grab the
//     whole stroke; AutoCAD LINE, not PLINE)
//  2. Create Face fuses free ends under 1 cm, so a closing click that
//     missed its snap point still closes the loop (the "i draw this
//     shape" polygon that refused with the even-degree error)
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

  // ---- extract LineTool._commit (uses only this.app + this.status) -------
  function loadLineCommit() {
    const sandbox = { window: {}, console, Buffer };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/geometry.js'), 'utf8'), ctx, { filename: 'geometry.js' });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/model.js'), 'utf8'), ctx, { filename: 'model.js' });
    const src = fs.readFileSync(path.join(__dirname, '..', 'js/tools/free.js'), 'utf8');
    const i = src.indexOf('class LineTool');
    const k = src.indexOf('_commit(p) {', i);
    if (k < 0) throw new Error('LineTool._commit not found');
    let end = src.indexOf('\n  }', k);
    if (end < 0) end = src.indexOf('\r\n  }', k);
    const body = src.slice(k + '_commit(p) {'.length, end);
    const G = sandbox.window.G;
    const make = new Function('G', 'body', 'return function(app){ const self={app,anchor:null,status(){}}; return { self, fn: function(p){ eval(body); }.bind(self) }; }')(G, body);
    return { G, Model: sandbox.window.Model, make };
  }

  test('Line tool: consecutive segments are independent lines (no chain)', () => {
    const L = loadLineCommit();
    const { G, Model } = L;
    const m = new Model();
    const stubApp = {
      model: m,
      dynHide: null,
      run(label, fn) { return fn(m); },
    };
    const { self, fn } = L.make(stubApp);
    self.anchor = G.v(0, 0, 0);
    fn(G.v(2, 0, 0)); self.anchor = G.v(2, 0, 0);
    fn(G.v(2, 3, 0)); self.anchor = G.v(2, 3, 0);
    fn(G.v(5, 3, 0));
    eq(m.edges.size, 3, 'three segments');
    for (const e of m.edges.values()) eq(e.curveId, 0, 'segment carries no polyline chain');
    eq(m.curves.size, 0, 'no polyline curve registered');
    ok(m.validate().ok, 'model valid');
    // anchor advanced so the next click keeps chaining from the last point
    eq(self.anchor.x, 5, 'drawing continues from the last endpoint');
  });

  test('mergeVertices rewires edges and drops the orphaned vertex', () => {
    const { G, Model } = loadModel();
    const m = new Model();
    m.addEdge(G.v(0, 0, 0), G.v(1, 0, 0));
    m.addEdge(G.v(1.004, 0, 0), G.v(2, 0, 0));
    const near1 = [...m.vertices.entries()].find(([, p]) => Math.abs(p.x - 1.004) < 1e-9)[0];
    const at1 = [...m.vertices.entries()].find(([, p]) => Math.abs(p.x - 1) < 1e-9 && p.z === 0)[0];
    const n = m.mergeVertices(at1, near1);
    eq(n, 1, 'one edge rewired');
    ok(!m.vertices.has(near1), 'orphaned vertex removed');
    ok(m.findEdge(at1, [...m.vertices.entries()].find(([, p]) => Math.abs(p.x - 2) < 1e-9)[0]), 'edge now spans the fuse');
    ok(m.validate().ok, 'model valid');
  });

  // ---- createFaceFromSelectedEdges with the near-miss heal ----------------
  function loadFn() {
    const sandbox = { window: {}, console, Buffer };
    const ctx = vm.createContext(sandbox);
    for (const f of ['js/geometry.js', 'js/model.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
    const src = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
    const i = src.indexOf('createFaceFromSelectedEdges() {');
    const sigLen = 'createFaceFromSelectedEdges() {'.length;
    // brace-matched method end (sentinel searches broke on line-ending mixes)
    let depth = 0, j = -1;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') { depth--; if (depth === 0) { j = k; break; } }
    }
    const body = src.slice(i + sigLen, j); // up to the method's closing brace
    const factorySrc = 'return function make(app, G, Model) {\n' +
      '  const toasts = [];\n' +
      '  const self = { model: app.model, sel: app.sel, run: app.run,\n' +
      '    toast: (m2) => toasts.push(m2), clearSelection: app.clearSelection, G };\n' +
      '  const fn = function() {' + body + '};\n' +
      '  return { self, fn: fn.bind(self), toasts };\n' +
      '};\n';
    const G = sandbox.window.G, Model = sandbox.window.Model;
    const window = { G, Model };
    const make = new Function('G', 'Model', 'window', factorySrc)(G, Model, window);
    return { G, Model, make };
  }

  function stub() {
    const m = new (loadFn().Model)();
    const app = {
      model: m,
      sel: { edges: new Set(), faces: new Set() },
      run(label, fn) { return fn(m); },
      clearSelection() { app.sel = { edges: new Set(), faces: new Set() }; },
    };
    return loadFn().make(app, loadFn().G, loadFn().Model);
  }

  test('near-miss polygon (8 mm gap) heals and creates the face', () => {
    const { self, fn, toasts } = stub();
    const m = self.model, E = self.G;
    // the user's shape: a closed polygon whose last click missed the start
    // point by 8 mm — visually shut, topologically open
    const P = [
      [0, 0], [4, 0], [4, 3], [2.6, 3.4], [2, 2.4], [1.4, 3.4], [0, 3],
    ];
    const back = [0.004, 0.005]; // ~6.4 mm off the start corner (0,0)
    for (let i = 0; i < P.length - 1; i++) m.addEdge(E.v(P[i][0], P[i][1], 0), E.v(P[i + 1][0], P[i + 1][1], 0));
    m.addEdge(E.v(P[P.length - 1][0], P[P.length - 1][1], 0), E.v(back[0], back[1], 0));
    self.sel.edges = new Set([...m.edges.keys()]);
    fn();
    eq(m.faces.size, 1, 'the polygon became a face despite the 8 mm gap');
    ok(m.validate().ok, 'model valid');
    const f = [...m.faces.values()][0];
    ok(m.faceArea(f) > 10, `face area plausible (${m.faceArea(f).toFixed(2)})`);
  });

  test('a real gap (> 1 cm) still refuses with the helpful error', () => {
    const { self, fn, toasts } = stub();
    const m = self.model, E = self.G;
    const P = [[0, 0], [4, 0], [4, 3], [0, 3]];
    for (let i = 0; i < P.length - 1; i++) m.addEdge(E.v(P[i][0], P[i][1], 0), E.v(P[i + 1][0], P[i + 1][1], 0));
    m.addEdge(E.v(0, 3, 0), E.v(0.2, 0.05, 0)); // 20+ cm off — genuinely open
    self.sel.edges = new Set([...m.edges.keys()]);
    fn();
    eq(m.faces.size, 0, 'no face');
    ok(toasts.some(t => /box-select the loop/.test(t)), 'error points at the gap');
  });
};
