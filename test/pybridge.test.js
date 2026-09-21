'use strict';
// features/pybridge.js — the Python engine bridge: offline degradation,
// the mesh→model wrapper, and cache-signature matching. The live HTTP path
// is exercised by the browser E2E (manual-verify-pybridge.js); here the
// service is absent, which is exactly the fallback contract.
module.exports = h => {
  const { test, ok, eq } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

  const sandbox = { window: { addEventListener() { } }, console, Buffer, setTimeout, clearTimeout };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/geometry.js', 'js/tools/base.js', 'js/model.js', 'js/features/pybridge.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  const { G, Model, PyEngine } = sandbox.window;

  test('probe: no engine running degrades to offline (never throws)', async () => {
    const s = await PyEngine.probe(200);
    eq(s.online, false, 'offline');
    eq(s.freecad, false, 'no freecad');
    eq(PyEngine.active, false, 'inactive without the service');
  });

  test('wrapped addRebarPath consumes cached meshes as loose rebar faces', () => {
    const m = new Model();
    const pts = [G.v(0, 0, 0), G.v(1, 0, 0)];
    // fake engine mesh: an octahedron-ish tube of 8 triangles
    const V = [[0, -0.008, -0.008], [0, 0.008, -0.008], [0, 0.008, 0.008], [0, -0.008, 0.008],
      [1, -0.008, -0.008], [1, 0.008, -0.008], [1, 0.008, 0.008], [1, -0.008, 0.008]];
    const F = [[0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
    PyEngine.cache.set(PyEngine._sigForTest(pts, 0.016), { vertices: V, facets: F, engine: 'python-debug' });
    // engine active + wrap
    PyEngine.state = { online: true, freecad: false, version: null };
    PyEngine.debugMeshes = true;
    PyEngine.wrapModel();
    const ids = m.addRebarPath(pts, 0.016, { color: '#a94442', meta: { shape: 'stirrup' } });
    eq(ids.length, 8, '8 loose triangle faces');
    const faces = ids.map(id => m.faces.get(id)).filter(Boolean);
    ok(faces.every(f => f.loose === true), 'faces are loose');
    ok(faces.every(f => f.userData && f.userData.rebar
      && f.userData.rebar.engine === 'python-debug'), 'tagged with the engine');
    eq(faces[0].userData.rebar.shape, 'stirrup', 'host metadata carried over');
    eq(faces[0].color, '#a94442', 'rebar color');
    // seam edges hidden so the mesh reads as a surface
    let hidden = 0, total = 0;
    for (const f of faces)
      for (const ring of m.rings(f))
        for (let i = 0; i < ring.length; i++) {
          const e = m.findEdge(ring[i], ring[(i + 1) % ring.length]);
          if (e) { total++; if (e.hidden) hidden++; }
        }
    eq(hidden, total, 'every seam edge hidden');

    // unwrap restores the JS tube builder exactly
    PyEngine.unwrapModel();
    PyEngine.debugMeshes = false;
    const ids2 = m.addRebarPath([G.v(2, 0, 0), G.v(3, 0, 0)], 0.016);
    ok(ids2.length > 8 && ids2.length < 40, `JS tube rebuilt (${ids2.length} faces)`);
    ok(m.faces.get(ids2[0]).userData.rebar.engine === undefined, 'no engine tag after unwrap');
  });

  test('uncached bars fall through to the JS engine while wrapped', () => {
    const m = new Model();
    PyEngine.state = { online: true, freecad: false, version: null };
    PyEngine.debugMeshes = true;
    PyEngine.wrapModel();
    const ids = m.addRebarPath([G.v(0, 0, 0), G.v(0, 1, 0)], 0.012);
    ok(ids.length >= 10, `JS tube for the cache miss (${ids.length})`);
    ok(m.faces.get(ids[0]).userData.rebar.engine === undefined, 'untagged as JS-built');
    PyEngine.unwrapModel();
    PyEngine.debugMeshes = false;
  });
};
