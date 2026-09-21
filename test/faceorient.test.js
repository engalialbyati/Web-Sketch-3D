'use strict';
// Face orientation from multi-loop Create Face — the scalloped-arc
// thickness bug: the loop walk follows each edge's stored (draw) direction,
// so rings could come out wound either way. A typed Push/Pull distance
// travels along the face NORMAL, so badly-wound rings extruded DOWN into
// the ground (sunken white bands). Create Face now orients every loop with
// the dominant normal axis positive → ground rings face +Z, typed = up.
//
// The user's shape: nested scallops — each offset arc closed by its own
// chord, edge-disjoint rings (the walk uses each edge exactly once, so
// rings sharing arcs cannot both close).
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

  // extract createFaceFromSelectedEdges from app.js (same harness as
  // multiface.test.js — it only touches this.model/sel/run/toast)
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
  // the user's wire: three nested scallops — concentric arcs (r=2,3,4),
  // each closed by its OWN chord. Stored directions deliberately mixed:
  // arcs run right→left over the top, chords run left→right.
  function scallopWire(m) {
    const E = L.G;
    for (const r of [2, 3, 4]) {
      const pts = [];
      for (let i = 0; i <= SEG; i++) {
        const a = -D + (i / SEG) * (Math.PI + 2 * D);
        pts.push(E.v(r * Math.cos(a), r * Math.sin(a), 0));
      }
      m.addPolyline(pts, { type: 'arc', center: E.v(0, 0, 0), radius: r, normal: E.v(0, 0, 1) });
      m.addEdge(E.clone(pts[pts.length - 1]), E.clone(pts[0])); // chord, opposite direction
    }
  }

  test('nested scallops: every created face faces +Z regardless of draw direction', () => {
    const { self, fn } = stub();
    const m = self.model;
    scallopWire(m);
    self.sel.edges = new Set([...m.edges.keys()]);
    fn();
    eq(m.faces.size, 3, 'one face per scallop');
    for (const f of m.faces.values()) {
      const n = L.G.loopNormal(m.pts(f.loop));
      near(n.z, 1, 1e-6, `face ${f.id} normal is +Z (got z=${n.z.toFixed(2)})`);
    }
    ok(m.validate().ok, 'model valid');
  });

  test('typed thickness goes UP and neighbor rings stay on the ground', () => {
    const { self, fn } = stub();
    const m = self.model;
    scallopWire(m);
    self.sel.edges = new Set([...m.edges.keys()]);
    fn();
    const scallops = [...m.faces.values()].sort((a, b) => m.faceArea(a) - m.faceArea(b));
    const target = scallops[1]; // middle scallop
    ok(m.pushPull(target, 0.6), 'push accepted');
    near(Math.max(...m.pts(target.loop).map(p => p.z)), 0.6, 1e-9, 'typed +0.6 extruded UP');
    for (const f of scallops) {
      if (f.id === target.id) continue;
      near(Math.max(...m.pts(f.loop).map(p => p.z)), 0, 1e-9, 'neighbor ring still at z=0');
    }
    ok(m.validate().ok, 'model valid after push');
  });

  test('extruding several scallops in turn keeps every top at its typed height', () => {
    const { self, fn } = stub();
    const m = self.model;
    scallopWire(m);
    self.sel.edges = new Set([...m.edges.keys()]);
    fn();
    // a push can replace a neighbor face wholesale (hole punched via
    // delete+recreate) — re-locate faces by containment, like a click does
    const faceAt = (px, py, pz) => {
      for (const f of m.faces.values()) {
        const pts = m.pts(f.loop);
        if (pts.some(p => Math.abs(p.z - pz) > 1e-9)) continue;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          if (((pts[i].y > py) !== (pts[j].y > py)) &&
            (px < (pts[j].x - pts[i].x) * (py - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x)) inside = !inside;
        }
        if (inside) return f;
      }
      return null;
    };
    ok(m.pushPull(faceAt(0, 1.5, 0), 0.5), 'inner push');
    ok(m.pushPull(faceAt(0, 2.5, 0), 0.5), 'middle push');
    ok(m.pushPull(faceAt(0, 3.5, 0), 0.5), 'outer push');
    for (const [px, py] of [[0, 1.5], [0, 2.5], [0, 3.5]]) {
      const f = faceAt(px, py, 0.5);
      ok(f, `scallop top face exists at (${px},${py},0.5)`);
      if (f) near(Math.max(...m.pts(f.loop).map(p => p.z)), 0.5, 1e-9, 'top at +0.5');
    }
    ok(m.validate().ok, 'model valid');
  });

  test('vertical loop gets a deterministic orientation too (dominant axis +Y)', () => {
    const { self, fn } = stub();
    const m = self.model;
    const E = L.G;
    const P = (x, z) => E.v(x, 0, z);
    m.addEdge(P(0, 0), P(3, 0));
    m.addEdge(P(3, 2), P(3, 0)); // stored downward
    m.addEdge(P(3, 2), P(0, 2));
    m.addEdge(P(0, 0), P(0, 2)); // stored upward
    self.sel.edges = new Set([...m.edges.keys()]);
    fn();
    eq(m.faces.size, 1, 'one face');
    const n = E.loopNormal(m.pts([...m.faces.values()][0].loop));
    ok(Math.abs(n.y) > 0.99 && n.y > 0, `normal is +Y (got y=${n.y.toFixed(2)})`);
  });
};
