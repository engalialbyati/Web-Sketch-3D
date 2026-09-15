'use strict';
// Create Face with NESTED loops — a rectangle inside a rectangle deducts the
// inner ring as a HOLE of the containing face (no more face-over-face),
// while every loop still becomes its own standalone face.
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

  function loadFn() {
    const sandbox = { window: {}, console, Buffer };
    const ctx = vm.createContext(sandbox);
    for (const f of ['js/geometry.js', 'js/model.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
    const src = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
    const i = src.indexOf('createFaceFromSelectedEdges() {');
    const sigLen = 'createFaceFromSelectedEdges() {'.length;
    const j = src.indexOf('\n  }\n', i) >= 0 ? src.indexOf('\n  }\n', i) + 4 : src.indexOf('\r\n  }\r\n', i) + 6;
    const body = src.slice(i + sigLen, j - 6 >= i + sigLen ? j - 6 : j);
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
  const rect = (m, x0, y0, w, hh) => {
    const E = L.G;
    m.addEdge(E.v(x0, y0, 0), E.v(x0 + w, y0, 0));
    m.addEdge(E.v(x0 + w, y0, 0), E.v(x0 + w, y0 + hh, 0));
    m.addEdge(E.v(x0 + w, y0 + hh, 0), E.v(x0, y0 + hh, 0));
    m.addEdge(E.v(x0, y0 + hh, 0), E.v(x0, y0, 0));
  };
  const run = t => { t.self.sel.edges = new Set([...t.self.model.edges.keys()]); t.fn(); };

  test('rect inside rect: outer face DEDUCTS the inner as a hole', () => {
    const t = stub(); const { self } = t;
    const m = self.model;
    rect(m, 0, 0, 4, 3);    // outer 4×3
    rect(m, 1, 1, 1, 1);    // inner 1×1
    run(t);
    eq(m.faces.size, 2, 'two faces (one per rectangle)');
    const areas = [...m.faces.values()].map(f => m.faceArea(f)).sort((a, b) => a - b);
    near(areas[0], 1, 1e-9, 'inner face keeps its full 1 m² area');
    const outer = [...m.faces.values()].find(f => m.faceArea(f) > 2);
    ok(outer, 'outer face found');
    eq(outer.holes.length, 1, 'the outer face carries the inner ring as a hole');
    near(m.faceArea(outer), 4 * 3 - 1 * 1, 0.05, 'outer area = big − small');
    ok(m.validate().ok, 'model valid');
    ok(outer.loose === true, 'still a standalone loose face');
  });

  test('side-by-side rects: no holes (containment must not fire)', () => {
    const t = stub(); const { self } = t;
    const m = self.model;
    rect(m, 0, 0, 2, 2);
    rect(m, 5, 0, 2, 2);
    run(t);
    eq(m.faces.size, 2, 'two faces');
    for (const f of m.faces.values()) eq(f.holes.length, 0, 'no holes');
    ok(m.validate().ok, 'model valid');
  });

  test('rects touching at a corner are NOT nested (no holes)', () => {
    const t = stub(); const { self } = t;
    const m = self.model;
    rect(m, 0, 0, 2, 2);
    rect(m, 2, 2, 2, 2); // shares the corner (2,2) as separate vertices
    run(t);
    eq(m.faces.size, 2, 'two faces');
    let holed = 0;
    for (const f of m.faces.values()) holed += f.holes.length;
    eq(holed, 0, 'touching rings never deduct');
    ok(m.validate().ok, 'model valid');
  });

  test('three-level nesting: one face per band, hole = direct child only', () => {
    const t = stub(); const { self } = t;
    const m = self.model;
    rect(m, 0, 0, 6, 6);
    rect(m, 1, 1, 4, 4);
    rect(m, 2, 2, 2, 2);
    run(t);
    eq(m.faces.size, 3, 'three faces');
    const faces = [...m.faces.values()].sort((a, b) => m.faceArea(b) - m.faceArea(a));
    eq(faces[0].holes.length, 1, 'outer holed by the middle only');
    eq(faces[1].holes.length, 1, 'middle holed by the inner only');
    eq(faces[2].holes.length, 0, 'inner solid');
    near(m.faceArea(faces[0]), 36 - 16, 0.05, 'outer band area');
    near(m.faceArea(faces[1]), 16 - 4, 0.05, 'middle band area');
    near(m.faceArea(faces[2]), 4, 0.05, 'inner area');
    ok(m.validate().ok, 'model valid');
  });

  test('pushing the holed outer face extrudes a tube; the inner face stays put', () => {
    const t = stub(); const { self } = t;
    const m = self.model;
    rect(m, 0, 0, 4, 3);
    rect(m, 1, 1, 1, 1);
    run(t);
    const outer = [...m.faces.values()].find(f => f.holes.length === 1);
    const inner = [...m.faces.values()].find(f => f.holes.length === 0);
    const innerArea = m.faceArea(inner);
    ok(m.pushPull(outer, 0.5), 'push accepted');
    near(Math.max(...m.pts(outer.loop).map(p => p.z)), 0.5, 1e-9, 'outer top at +0.5');
    near(Math.max(...m.pts(inner.loop).map(p => p.z)), 0, 1e-9, 'inner face untouched at z=0');
    near(m.faceArea(inner), innerArea, 1e-9, 'inner area unchanged');
    ok(m.validate().ok, 'model valid');
  });
};
