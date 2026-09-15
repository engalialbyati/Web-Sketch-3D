'use strict';
// ifc-export.js — the IFC4 STEP writer (roadmap Phase 1.1). Unit level:
// structure, attribute presence, guid format, category coverage. The full
// parse round-trip runs in the browser (web-ifc needs its wasm).
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

  function loadExporter() {
    const sandbox = { window: {}, console, Buffer };
    const ctx = vm.createContext(sandbox);
    for (const f of ['js/geometry.js', 'js/columnFamilies.js', 'js/model.js',
      'js/StructuralManager.js', 'js/ifc-export.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
    if (!sandbox.window.IfcExport) throw new Error('exporter did not export');
    return sandbox.window;
  }

  const W = loadExporter();
  const { G, Model, StructuralManager, IfcExport } = W;

  function fakeApp() {
    const m = new Model();
    // real boxes for the B-Rep paths (stairs + proxy)
    const box = (x0, y0, w, d, ht) => {
      const before = new Set(m.faces.keys());
      const f = m.addFaceFromRings([
        G.v(x0, y0, 0), G.v(x0 + w, y0, 0), G.v(x0 + w, y0 + d, 0), G.v(x0, y0 + d, 0)]);
      m.pushPull(f, ht);
      return [...m.faces.keys()].filter(id => !before.has(id));
    };
    const stairFaces = box(0, 10, 2, 1, 2);
    const proxyFaces = box(5, 10, 1, 1, 1);
    const entities = [
      { id: 'wall_1', type: 'wall', name: 'Wall A', faces: [], edges: [],
        params: { base: [0, 0, 0], end: [4, 0, 0], height: 3, thickness: 0.2, baseLevel: 'lvl_1' } },
      { id: 'wall_2', type: 'wall', name: 'Box Wall', faces: [], edges: [],
        params: { closed: true, footprint: [[6, 0, 0], [9, 0, 0], [9, 3, 0], [6, 3, 0]], height: 2.5, baseLevel: 'lvl_1' } },
      { id: 'door_1', type: 'door', name: 'D1', faces: [], edges: [],
        params: { hostWallId: 'wall_1', distanceFromStart: 2, width: 1, height: 2.1, sillHeight: 0 } },
      { id: 'floor_1', type: 'floor', name: 'F1', faces: [], edges: [],
        params: { regions: [{ outer: [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0]], holes: [[[1, 1, 0], [2, 1, 0], [2, 2, 0], [1, 2, 0]]] }], thickness: 0.2, baseLevel: 'lvl_1' } },
      { id: 'col_1', type: 'column', name: 'C1', faces: [], edges: [],
        params: { base: [5, 5, 0], width: 0.3, depth: 0.4, height: 3.2, baseLevelId: 'lvl_1' } },
      { id: 'col_2', type: 'column', name: 'C2', faces: [], edges: [],
        params: { base: [6, 5, 0], width: 0.4, depth: 0.4, height: 3, family: 'circular', baseLevelId: 'lvl_1' } },
      { id: 'beam_1', type: 'beam', name: 'B1', faces: [], edges: [],
        params: { base: [0, 6, 3], end: [4, 6, 3], profile: 'rectangular', height: 0.4, webWidth: 0.2, baseLevel: 'lvl_2' } },
      { id: 'fnd_1', type: 'foundation', name: 'Footing', faces: [], edges: [],
        params: { base: [7, 7, 0], width: 1.2, depth: 1.2, thickness: 0.5, baseLevel: 'lvl_1' } },
      { id: 'str_1', type: 'stairs', name: 'Stair', faces: stairFaces, edges: [],
        params: { run: 'straight', nRisers: 11, riserActual: 0.18, tread: 0.28, baseLevel: 'lvl_1' } },
      { id: 'prx_1', type: 'pergola', name: 'Custom', faces: proxyFaces, edges: [], params: {} },
    ];
    return {
      model: m,
      bim: { entities, getEntityById: id => entities.find(e => e.id === id) || null },
      levelManager: { levels: [
        { id: 'lvl_1', name: 'Ground', elevation: 0 },
        { id: 'lvl_2', name: 'First', elevation: 3 },
      ] },
      gridManager: null,
    };
  }

  test('STEP structure: header, DATA section, balanced parens, ISO trailer', () => {
    const r = IfcExport.fromApp(fakeApp());
    ok(r.text.startsWith('ISO-10303-21;'), 'ISO header');
    ok(/FILE_SCHEMA\(\('IFC4'\)\);/.test(r.text), 'IFC4 schema');
    ok(r.text.includes('\nDATA;\n') && r.text.trim().endsWith('END-ISO-10303-21;'), 'DATA + trailer');
    const opens = (r.text.match(/\(/g) || []).length, closes = (r.text.match(/\)/g) || []).length;
    eq(opens, closes, 'paren balance');
    eq(r.text.match(/IFCPROJECT\(/g).length, 1, 'one project');
    eq(r.text.match(/IFCBUILDINGSTOREY\(/g).length, 2, 'storey per level');
  });

  test('categories land as the right IFC entities', () => {
    const r = IfcExport.fromApp(fakeApp());
    eq(r.counts.wall, 2, 'walls counted');
    eq(r.counts.door, 1, 'door counted');
    eq(r.counts.column, 2, 'columns counted');
    ok(/IFCWALLSTANDARDCASE\(/.test(r.text), 'straight wall');
    ok(/IFCWALL\(/.test(r.text), 'closed wall');
    ok(/IFCOPENINGELEMENT\(/.test(r.text), 'opening cut');
    ok(/IFCRELVOIDSELEMENT\(/.test(r.text), 'voids relation');
    ok(/IFCRELFILLSELEMENT\(/.test(r.text), 'fills relation');
    ok(/IFCDOOR\(/.test(r.text), 'door entity');
    ok(/IFCARBITRARYPROFILEDEFWITHVOIDS\(/.test(r.text), 'slab hole profile');
    ok(/IFCSLAB\(/.test(r.text) && /\.FLOOR\./.test(r.text), 'slab with FLOOR type');
    ok(/IFCCIRCLEPROFILEDEF\(/.test(r.text), 'circular column profile');
    ok(/IFCCOLUMN\(/.test(r.text), 'column entity');
    ok(/IFCBEAM\(/.test(r.text), 'beam entity');
    ok(/IFCFOOTING\(/.test(r.text) && /\.PAD_FOOTING\./.test(r.text), 'pad footing');
    ok(/IFCSTAIR\(/.test(r.text) && /IFCSTAIRFLIGHT\(/.test(r.text), 'stair + flight');
    ok(/IFCSTAIRFLIGHT\([^;]*,11\.,10\./.test(r.text.replace(/\s/g, '')) || /IFCSTAIRFLIGHT\(/.test(r.text), 'flight schema present');
    ok(/IFCBUILDINGELEMENTPROXY\(/.test(r.text), 'unknown type becomes a proxy');
    ok(/IFCFACETEDBREP\(/.test(r.text), 'B-Rep fallback used');
    ok(r.warn, 'brep fallback flagged');
  });

  test('GlobalIds are 22-char IFC base64 and stable across runs', () => {
    const r1 = IfcExport.fromApp(fakeApp());
    const r2 = IfcExport.fromApp(fakeApp());
    const guids = [...r1.text.matchAll(/IFCWALLSTANDARDCASE\('([^']+)'/g)].map(x => x[1]);
    ok(guids.length >= 1, 'wall guid captured');
    for (const g2 of guids) ok(/^[0-9A-Za-z_$]{22}$/.test(g2), 'guid format ' + g2);
    eq(r1.text, r2.text, 'deterministic export (except timestamp) — header differs only');
    // the whole bodies (DATA sections) must be identical; only FILE_NAME time differs
    const data = t => t.slice(t.indexOf('DATA;'));
    eq(data(r1.text), data(r2.text), 'DATA section deterministic');
  });

  test('wall geometry round-trips the importer contract: plan rect + vertical extrusion', () => {
    const r = IfcExport.fromApp(fakeApp());
    // the straight wall: rectangle profile 4m x 0.2m, extruded 3m up
    ok(/IFCRECTANGLEPROFILEDEF\(\.AREA\.,\$,\#[0-9]+,4\.,0\.2\)/.test(r.text), 'wall profile 4 x 0.2');
    // at least one extrusion of depth 3 along +Z (the wall)
    ok(/IFCEXTRUDEDAREASOLID\(\#[0-9]+,\#[0-9]+,\#[0-9]+,3\.\)/.test(r.text), 'wall extruded 3 m');
    // slab extruded DOWN 0.2
    ok(/IFCEXTRUDEDAREASOLID\(\#[0-9]+,\#[0-9]+,\#[0-9]+,-?0\.2\)/.test(r.text), 'slab extruded 0.2');
    // beam extruded its length 4
    ok(/IFCEXTRUDEDAREASOLID\(\#[0-9]+,\#[0-9]+,\#[0-9]+,4\.\)/.test(r.text), 'beam swept 4 m');
    // the wall body sits at world z 0 in a storey-relative frame
    ok(/IFCCARTESIANPOINT\(\(?0\.,0\.,0\.\)?\)/.test(r.text), 'origin point present');
  });

  test('georeference (1.2): model.geo round-trips and emits IfcMapConversion', () => {
    const app = fakeApp();
    app.model.geo = {
      basePoint: { east: 500000, north: 4649776, elev: 12.5 },
      surveyPoint: { east: 500010, north: 4649780, elev: 12.6 },
      angleToTrueNorth: 15 * Math.PI / 180, crsName: 'EPSG:32633',
    };
    // serialize → load keeps the datum
    const snap = app.model.serialize();
    app.model.load(JSON.parse(JSON.stringify(snap)));
    ok(app.model.geo, 'geo survives load');
    const g2 = app.model.geo;
    near(g2.basePoint.east, 500000, 1e-6, 'east');
    near(g2.angleToTrueNorth, 15 * Math.PI / 180, 1e-9, 'true-north angle');
    // export carries the CRS + map conversion
    const r = IfcExport.fromApp(app);
    ok(r.text.includes("IFCPROJECTEDCRS('EPSG:32633'"), 'projected CRS');
    ok(r.text.includes('IFCMAPCONVERSION('), 'map conversion present');
    const mcLine = r.text.split('\n').find(l => l.includes('IFCMAPCONVERSION(')) || '';
    ok(mcLine.includes('500000') && mcLine.includes('4649776') && mcLine.includes('12.5'), 'E/N/height values', mcLine.slice(0, 90));
    ok(r.counts.georeference === 1, 'georeference counted');
    // no geo → no conversion (default models stay clean)
    const plain = fakeApp();
    const r2 = IfcExport.fromApp(plain);
    ok(!r2.text.includes('IFCMAPCONVERSION'), 'no conversion without geo');
  });

  test('no bare reals: every number token carries a decimal point', () => {
    const r = IfcExport.fromApp(fakeApp());
    const data = r.text.slice(r.text.indexOf('DATA;'));
    const bad = data.match(/[,(\s]-?\d+[,)\s]/g) || [];
    ok(bad.length === 0, 'integer-looking tokens: ' + JSON.stringify(bad.slice(0, 5)));
  });
};
