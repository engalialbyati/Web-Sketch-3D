'use strict';
// ---------------------------------------------------------------------------
// Test harness for WebSketch 3D.
//
// js/geometry.js and js/model.js are browser-global scripts (no modules), so
// we load them into a fresh V8 context with `vm` and a stubbed `window`, then
// hand the resulting classes to the tests. No DOM, no THREE, no WebGL — the
// model layer is pure and must stay that way (render.js/app.js own the DOM).
//
// Usage in a test file:
//   module.exports = h => {
//     h.test('name', () => { h.eq(1, 1); });
//   };
// ---------------------------------------------------------------------------
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// Load geometry.js + model.js (+ pure model-layer companions) into an
// isolated context; returns { G, Model, StructuralManager }.
function loadModel() {
  // Buffer: export-gltf's base64 fallback needs it in Node's vm sandbox
  const sandbox = { window: {}, console, Buffer };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/geometry.js', 'js/model.js', 'js/StructuralManager.js', 'js/export-gltf.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  if (!sandbox.window.G || !sandbox.window.Model) throw new Error('sandbox did not export G/Model');
  return { G: sandbox.window.G, Model: sandbox.window.Model, StructuralManager: sandbox.window.StructuralManager, BeamProfiles: sandbox.window.BeamProfiles, GltfExporter: sandbox.window.GltfExporter };
}

// ------------------------------- assertions
function ok(cond, msg = 'expected truthy') {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, msg) {
  if (typeof actual === 'number' && typeof expected === 'number') return near(actual, expected, 1e-9, msg);
  if (actual !== expected) throw new Error(`${msg || 'eq'}: expected ${fmt(expected)}, got ${fmt(actual)}`);
}
function near(actual, expected, eps = 1e-6, msg) {
  if (!(Math.abs(actual - expected) <= eps)) {
    throw new Error(`${msg || 'near'}: expected ${fmt(expected)} ±${eps}, got ${fmt(actual)}`);
  }
}
function throws(fn, msg = 'expected function to throw') {
  try { fn(); } catch { return; }
  throw new Error(msg);
}
const fmt = v => typeof v === 'number' ? v.toPrecision(12) : JSON.stringify(v);

// ------------------------------- runner
const _stats = { pass: 0, fail: 0 };
function test(name, fn) {
  try {
    fn();
    _stats.pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    _stats.fail++;
    console.log(`  FAIL ${name}\n         ${e.message}`);
  }
}
function summary(suite) {
  console.log(`${suite}: ${_pass} passed, ${_fail} failed`);
  return _fail === 0;
}

// ------------------------------- model builders (world: Z up)
// Fresh model + a few helpers shared by all model tests. Every builder goes
// through the same public Model API the tools use.
function makeWorld() {
  const { G, Model } = loadModel();
  const m = new Model();
  const P = arr => arr.map(a => G.v(a[0], a[1], a[2]));
  return {
    G, Model, m, P,
    rect: pts => m.addFaceFromRings(P(pts)),                 // face from a point ring
    circle: (cx, cy, cz, r, seg = 24, axis = 'x') => {        // regular polygon ring
      const ring = [];
      for (let i = 0; i < seg; i++) {
        const t = (i / seg) * 2 * Math.PI;
        const [a, b] = axis === 'x' ? [Math.cos(t), Math.sin(t)] : axis === 'y' ? [Math.cos(t), Math.sin(t)] : [Math.cos(t), Math.sin(t)];
        ring.push(axis === 'x' ? [cx, cy + r * a, cz + r * b]
          : axis === 'y' ? [cx + r * a, cy, cz + r * b]
            : [cx + r * a, cy + r * b, cz]);
      }
      return m.addFaceFromRings(P(ring));
    },
    box: (w = 4, d = 3, h = 2.5, x0 = 0, y0 = 0) => {         // ground rect pushed up
      const f = m.addFaceFromRings(P([[x0, y0, 0], [x0 + w, y0, 0], [x0 + w, y0 + d, 0], [x0, y0 + d, 0]]));
      m.pushPull(f, h);
      return f;
    },
    ids: () => [...m.faces.keys()],
    vol: () => m.shellVolume([...m.faces.keys()]),
    openEdges: () => m.shellOpenEdges([...m.faces.keys()]),
    // validate() must report zero errors; `warnOk` when a test *expects* warnings
    vclean: (label = 'model') => {
      const v = m.validate();
      if (!v.ok) throw new Error(`${label}: validate errors: ${v.errors.join(' | ')}`);
      return v;
    },
  };
}

module.exports = { loadModel, test, summary, ok, eq, near, throws, fmt, makeWorld, _stats };
