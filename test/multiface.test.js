'use strict';
// createFaceFromSelectedEdges — MULTI-LOOP: box-select N closed rings → N
// faces (the offset-arc workflow); touching loops (shared corners) pair by
// the tightest turn; odd-degree selections refuse cleanly.
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

  // load model.js + extract the methods from app.js (they only use
  // this.model, this.sel, this.run, this.toast, this.clearSelection — all
  // stubbable). The Create Face action now delegates to _runFaceBuilder and
  // the auto-face scan shares it, so all three ride on the same stub self.
  function loadFn() {
    const sandbox = { window: {}, console, Buffer };
    const ctx = vm.createContext(sandbox);
    for (const f of ['js/geometry.js', 'js/model.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
    const src = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
    // brace-matched method body extractor (sentinel searches broke on
    // line-ending mixes)
    const bodyOf = (sig) => {
      const i = src.indexOf(sig);
      if (i < 0) throw new Error('method not found: ' + sig);
      // the method's OWN opening brace: the first '{' after the signature's
      // closing ") {" (default-parameter braces like { heal = false } would
      // otherwise end the match early)
      const open = src.indexOf('{', src.indexOf(') {', i));
      if (open < 0) throw new Error('signature brace not found: ' + sig);
      let depth = 0, j = -1;
      for (let k = open; k < src.length; k++) {
        if (src[k] === '{') depth++;
        else if (src[k] === '}') { depth--; if (depth === 0) { j = k; break; } }
      }
      return src.slice(open + 1, j); // inside the method's braces
    };
    const body = bodyOf('createFaceFromSelectedEdges() {');
    const bodyFB = bodyOf('_runFaceBuilder(edgesIn, { heal = false, mark = false } = {}) {');
    const bodyAF = bodyOf('_autoFaceScan() {');
    const factorySrc = 'return function make(app, G, Model) {\n' +
      '  const toasts = [];\n' +
      '  const self = { model: app.model, sel: app.sel, run: app.run,\n' +
      '    setStatus: app.setStatus || (() => { }),\n' +
      '    toast: (m2) => toasts.push(m2), clearSelection: app.clearSelection, G,\n' +
      '    autoFaceOn: app.autoFaceOn !== false, activeGroup: app.activeGroup != null ? app.activeGroup : null, _eip: null };\n' +
      '  self._runFaceBuilder = function(edgesIn, { heal = false, mark = false } = {}) {' + bodyFB + '};\n' +
      '  self._autoFaceScan = function() {' + bodyAF + '};\n' +
      '  const fn = function() {' + body + '};\n' +
      '  return { self, fn: fn.bind(self), toasts };\n' +
      '};\n';
    const G = sandbox.window.G;
    const Model = sandbox.window.Model;
    // `window.G` inside the method must resolve — give the factory its own
    const window = { G, Model };
    const make = new Function('G', 'Model', 'window', factorySrc)(G, Model, window);
    return { G, Model, make };
  }
  let L;
  try { L = loadFn(); } catch (e) { console.error('LOAD FAIL', e.message); process.exit(1); }

  function stub() {
    const m = new L.Model();
    const app = {
      model: m,
      sel: { edges: new Set(), faces: new Set() },
      run(label, fn) { return fn(m); },
      clearSelection() { app.sel = { edges: new Set(), faces: new Set() }; },
    };
    return L.make(app, L.G, L.Model);
  }

  const tri = (m, x0, y0) => {
    // a closed triangle as 3 edges
    const a = m.addEdge(L.G.v(x0, y0, 0), L.G.v(x0 + 2, y0, 0));
    const b = m.addEdge(L.G.v(x0 + 2, y0, 0), L.G.v(x0 + 1, y0 + 1.5, 0));
    const c = m.addEdge(L.G.v(x0 + 1, y0 + 1.5, 0), L.G.v(x0, y0, 0));
    return [a.id, b.id, c.id];
  };

  test('three disjoint loops → three faces in one Create Face', () => {
    const { self, fn, toasts } = stub();
    const m = self.model;
    const ids = [...tri(m, 0, 0), ...tri(m, 5, 0), ...tri(m, 10, 0)];
    for (const fid of [...m.faces.keys()]) m.deleteFace(fid, true); m.gc();
    self.sel.edges = new Set(ids);
    fn();
    eq(m.faces.size, 3, 'one face per loop');
    near(m.faceArea([...m.faces.values()][0]), 1.5, 1e-9, 'correct area');
    ok(!toasts.some(t => /not form/.test(t)), 'no error toast');
  });

  test('the offset-arc workflow: concentric semicircle rings + chords', () => {
    const { self, fn, toasts } = stub();
    const m = self.model;
    const ids = [];
    // three concentric semicircles (r=2,3,4) each closed by its chord line
    // three concentric quarter-arcs in different quadrants, each closed by
    // its chord — the realistic offset workflow (rings neither share
    // vertices nor cross; crossing chords would subdivide the discs)
    const quads = [[0, Math.PI / 2], [Math.PI / 2, Math.PI], [Math.PI, Math.PI * 3 / 2]];
    [2, 3, 4].forEach((r, k) => {
      const [a0, a1] = quads[k];
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const a = a0 + (a1 - a0) * i / 8;
        pts.push(L.G.v(Math.cos(a) * r, Math.sin(a) * r, 0));
      }
      m.addPolyline(pts, { type: 'arc', center: L.G.v(0, 0, 0), radius: r });
      const ch = m.addEdge(L.G.clone(pts[0]), L.G.clone(pts[pts.length - 1]));
      ids.push(ch.id);
    });
    // select EVERYTHING (all arcs + all chords)
    self.sel.edges = new Set([...m.edges.keys()]);
    fn();
    eq(m.faces.size, 3, 'one face per ring');
    const areas = [...m.faces.values()].map(f => m.faceArea(f)).sort((a, b) => a - b);
    near(areas[0], Math.PI - 2, 0.05, 'inner segment ~ πr²/4 − r²/2');
    ok(areas[2] > areas[0], 'rings sized apart');
  });

  test('two loops sharing a corner (degree-4 vertex) split correctly', () => {
    const { self, fn, toasts } = stub();
    const m = self.model;
    // two squares touching at one corner V=(2,2)
    const sq = (x0, y0) => {
      const A = L.G.v(x0, y0, 0), B = L.G.v(x0 + 2, y0, 0), C = L.G.v(x0 + 2, y0 + 2, 0), D = L.G.v(x0, y0 + 2, 0);
      return [m.addEdge(A, B).id, m.addEdge(B, C).id, m.addEdge(C, D).id, m.addEdge(D, A).id];
    };
    const ids = [...sq(0, 0), ...sq(2, 2)]; // share corner (2,2)
    self.sel.edges = new Set(ids);
    fn();
    eq(m.faces.size, 2, 'two faces from touching loops');
    for (const f of m.faces.values()) near(m.faceArea(f), 4, 1e-9, 'each is a full square');
  });

  test('box-selection extra (dangling edge) is ignored, the loop still faces', () => {
    const { self, fn, toasts } = stub();
    const m = self.model;
    const ids = tri(m, 0, 0);
    const dangler = m.addEdge(L.G.v(5, 5, 0), L.G.v(6, 5, 0)); // one loose edge
    self.sel.edges = new Set([...ids, dangler.id]);
    fn();
    eq(m.faces.size, 1, 'the closed loop became a face');
    ok(toasts.some(t => /1 extra edge ignored/.test(t)), 'reports the ignored extra');
  });

  test('single loop still works (backward compatibility)', () => {
    const { self, fn, toasts } = stub();
    const m = self.model;
    self.sel.edges = new Set(tri(m, 1, 1));
    fn();
    eq(m.faces.size, 1, 'one face');
    ok(m.validate().ok, 'model valid');
  });

  // ---- AUTO FACE (Draw ▸ Auto Face Creation) -------------------------------
  test('auto-face: a closed wire loop fills immediately, wires survive', () => {
    const { self } = stub();
    const m = self.model;
    const wireCount0 = m.edges.size;
    tri(m, 0, 0); // 3 closing edges
    const made = self._autoFaceScan();
    eq(made, 1, 'one face auto-created');
    eq(m.faces.size, 1, 'face exists');
    ok(m.validate().ok, 'model valid');
    ok(m.edges.size >= wireCount0 + 3, 'the drawn wires survive (standalone face owns private wires)');
    // idempotent: a second scan finds nothing new
    eq(self._autoFaceScan(), 0, 'no duplicate faces on rescan');
    eq(m.faces.size, 1, 'still one face');
  });

  test('auto-face: an open chain creates nothing until it closes', () => {
    const { self } = stub();
    const m = self.model;
    m.addEdge(L.G.v(0, 0, 0), L.G.v(2, 0, 0));
    m.addEdge(L.G.v(2, 0, 0), L.G.v(3, 1, 0)); // two sides only — still open
    eq(self._autoFaceScan(), 0, 'open chain: no face');
    eq(m.faces.size, 0, 'nothing created');
    m.addEdge(L.G.v(3, 1, 0), L.G.v(0, 0, 0)); // the closing edge
    eq(self._autoFaceScan(), 1, 'closing the loop fills it');
    eq(m.faces.size, 1, 'face exists');
  });

  test('auto-face respects the toggle and skips claimed/grouped wires', () => {
    const { self } = stub();
    const m = self.model;
    tri(m, 0, 0);
    self.autoFaceOn = false;
    eq(self._autoFaceScan(), 0, 'toggle off: no scan');
    eq(m.faces.size, 0, 'no face');
    self.autoFaceOn = true;
    // grouped wires outside the active group are not auto-faced
    const g = m.createGroup({ faces: new Set(), edges: new Set([...m.edges.keys()]) }, 'Wires');
    eq(self._autoFaceScan(), 0, 'grouped wires left alone');
    ok(m.groups.has(g.id), 'group intact');
    self.activeGroup = g.id; // inside the group edit: they face again
    eq(self._autoFaceScan(), 1, 'editing the group faces its loops');
  });
};
