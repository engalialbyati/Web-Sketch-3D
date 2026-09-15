'use strict';
// LOOSE (standalone) faces from Create Face — the independence contract:
// each face gets fresh vertices and its own edge set (a duplicate of the
// boundary curve), the source wire survives for the next Create Face, and
// pushing / editing / deleting one face never affects the neighbor lying
// on the same curve.
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

  const D = 0.15, SEG = 12;
  // the user's wire: two adjacent arc bands sharing the middle arc (r=2.5)
  // + the private closers — band A = (2, 2.5), band B = (2.5, 3)
  function wire(m) {
    const E = L.G;
    for (const r of [2, 2.5, 3]) {
      const pts = [];
      for (let i = 0; i <= SEG; i++) {
        const a = -D + (i / SEG) * (Math.PI + 2 * D);
        pts.push(E.v(r * Math.cos(a), r * Math.sin(a), 0));
      }
      m.addPolyline(pts, { type: 'arc', center: E.v(0, 0, 0), radius: r, normal: E.v(0, 0, 1) });
    }
    const t = (r, s) => E.v(r * Math.cos(D) * s, -r * Math.sin(D), 0);
    m.addEdge(E.clone(t(2, 1)), E.clone(t(2.5, 1)));
    m.addEdge(E.clone(t(2.5, -1)), E.clone(t(2, -1)));
    m.addEdge(E.clone(t(2.5, 1)), E.clone(t(3, 1)));
    m.addEdge(E.clone(t(3, -1)), E.clone(t(2.5, -1)));
    return m;
  }
  // select ONE band's four boundary curves (by radius + closers)
  function selBand(self, m, ri, ro) {
    const E = L.G;
    const ids = [];
    for (const e of m.edges.values()) {
      const a = m.vp(e.a), b = m.vp(e.b);
      const rA = Math.hypot(a.x, a.y), rB = Math.hypot(b.x, b.y);
      const onArc = r => Math.abs(rA - r) < 1e-6 && Math.abs(rB - r) < 1e-6 && Math.abs(a.z) < 1e-9 && Math.abs(b.z) < 1e-9;
      if (onArc(ri) || onArc(ro)) ids.push(e.id);
    }
    // closers: radial segments between ri and ro
    for (const e of m.edges.values()) {
      const a = m.vp(e.a), b = m.vp(e.b);
      if (e.curveId) continue;
      const rA = Math.hypot(a.x, a.y), rB = Math.hypot(b.x, b.y);
      if (Math.min(rA, rB) > ri - 1e-6 && Math.min(rA, rB) < ri + 1e-6 &&
        Math.max(rA, rB) > ro - 1e-6 && Math.max(rA, rB) < ro + 1e-6) ids.push(e.id);
    }
    self.sel.edges = new Set(ids);
    return ids.length;
  }

  test('two faces from the same arcs: each standalone, wire survives', () => {
    const { self, fn } = stub();
    const m = wire(self.model);
    const wireEdgesBefore = m.edges.size;
    ok(selBand(self, m, 2, 2.5) >= 14, 'band A selection built');
    fn();
    eq(m.faces.size, 1, 'face A created');
    ok(m.faces.values().next().value.loose === true, 'flagged loose');
    eq(m.edges.size, wireEdgesBefore + 26, 'face A added its OWN edges (wire untouched)');
    // face 2 from the SAME middle arc — the original must still be there
    ok(selBand(self, m, 2.5, 3) >= 14, 'band B selection built (originals still selectable)');
    fn();
    eq(m.faces.size, 2, 'face B created');
    // the two faces share NO edge and NO vertex
    const eids = [...m.faces.values()].map(f => new Set(m.rings(f).flat()));
    let shared = 0;
    eids[0].forEach(v => { if (eids[1].has(v)) shared++; });
    eq(shared, 0, 'no shared vertices between the two faces');
    ok(m.validate().ok, 'model valid');
  });

  test('pushing face A never touches face B (no punch, no trim, no moves)', () => {
    const { self, fn } = stub();
    const m = wire(self.model);
    selBand(self, m, 2, 2.5); fn();
    selBand(self, m, 2.5, 3); fn();
    const [fa, fb] = [...m.faces.values()];
    const bArea = m.faceArea(fb);
    const bVerts = m.rings(fb).flat().map(v => L.G.clone(m.vp(v)));
    ok(m.pushPull(fa, 0.7), 'push A up 0.7');
    near(Math.max(...m.pts(fa.loop).map(p => p.z)), 0.7, 1e-9, 'A extruded up');
    near(m.faceArea(fb), bArea, 1e-9, "B's area unchanged (no hole punched)");
    eq(fb.holes.length, 0, 'B has no holes');
    const bVertsAfter = m.rings(fb).flat().map(v => m.vp(v));
    ok(bVerts.every((p, i) => L.G.dist(p, bVertsAfter[i]) < 1e-9), "B's vertices did not move");
    ok(m.validate().ok, 'model valid');
  });

  test('deleting the original arc edge touches neither face', () => {
    const { self, fn } = stub();
    const m = wire(self.model);
    selBand(self, m, 2, 2.5); fn();
    selBand(self, m, 2.5, 3); fn();
    const [fa, fb] = [...m.faces.values()];
    const aArea = m.faceArea(fa), bArea = m.faceArea(fb);
    // one ORIGINAL wire edge on the shared middle arc — before loose faces
    // it bound BOTH faces; now it binds none and deletes freely
    const orig = [...m.edges.values()].find(e => {
      const a = m.vp(e.a), b = m.vp(e.b);
      return e.curveId && Math.abs(Math.hypot(a.x, a.y) - 2.5) < 1e-6 && Math.abs(Math.hypot(b.x, b.y) - 2.5) < 1e-6;
    });
    ok(!!orig, 'found an original middle-arc edge');
    eq(m.facesAdjacentToEdge(orig).length, 0, 'no face depends on the wire edge anymore');
    m.deleteEdgeIds([orig.id]);
    ok(!m.edges.has(orig.id), 'wire edge deleted');
    near(m.faceArea(fa), aArea, 1e-9, 'face A untouched');
    near(m.faceArea(fb), bArea, 1e-9, 'face B untouched');
    ok(m.validate().ok, 'model valid');
  });

  test('loose round-trips through save/load', () => {
    const { self, fn } = stub();
    const m = wire(self.model);
    selBand(self, m, 2, 2.5); fn();
    const data = m.serialize();
    ok(!!data, 'serialize() produced data');
    const m2 = new L.Model();
    m2.load(data);
    eq(m2.faces.size, 1, 'face loaded');
    ok(m2.faces.values().next().value.loose === true, 'loose flag persisted');
    const f2 = m2.faces.values().next().value;
    ok(m2.pushPull(f2, 0.5), 'push after reload');
    near(Math.max(...m2.pts(f2.loop).map(p => p.z)), 0.5, 1e-9, 'still independent after reload');
  });

  test('selection overlapping wire + face copies dedupes to one loop', () => {
    const { self, fn } = stub();
    const m = wire(self.model);
    selBand(self, m, 2, 2.5); fn(); // face A exists (duplicate arcs on r=2.5)
    // box-style selection for band B: EVERYTHING geometrically on arcs r=2.5
    // and r=3 (originals AND face A's copies) + band B's closers
    const ids = [];
    for (const e of m.edges.values()) {
      const a = m.vp(e.a), b = m.vp(e.b);
      const rA = Math.hypot(a.x, a.y), rB = Math.hypot(b.x, b.y);
      if (e.curveId && (Math.abs(rA - 2.5) < 1e-6 || Math.abs(rA - 3) < 1e-6) && Math.abs(rA - rB) < 1e-6) ids.push(e.id);
      if (!e.curveId && Math.min(rA, rB) > 2.4 && Math.min(rA, rB) < 2.6 && Math.max(rA, rB) > 2.9) ids.push(e.id);
    }
    self.sel.edges = new Set(ids);
    fn();
    eq(m.faces.size, 2, 'face B created from the deduped loop');
    ok(m.validate().ok, 'model valid');
  });
};
