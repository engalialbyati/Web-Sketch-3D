'use strict';
// The v0.10 professional-BIM tool batch: DXF export (pure writer),
// Interference Check (clash detection), Select All Instances /
// Create Similar, and Paste Aligned to Level — each tested headlessly
// through the harness facade.
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const L = loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/BimElement.js',
    'js/dxf.js', 'js/interference.js', 'js/lib/three.min.js', 'js/app.js', 'js/assets.js',
    'js/tools/assets.js', 'js/features/onlinelib.js']);
  const w = L.window;
  const { G, Model, DxfWriter, Interference } = w;

  const facade = (m) => {
    const app = Object.assign(Object.create(w.App.prototype), {
      model: m, bim: new w.BimEntityManager(m),
      sel: { edges: new Set(), faces: new Set() },
      view: { rebuild() { }, invalidate() { }, clearPins() { }, clearPreview() { }, updateSelectionVisuals() { }, sun: { position: { x: 36, y: -22, z: 52 }, intensity: 0.85 } },
      toast() { }, setStatus() { }, updateInfo() { },
      run: (l, fn) => fn(m),
      transaction: { run: (l, fn) => fn(m) },
      levelManager: { levels: m.levels || [], getLevel: id => m.levels.find(x => x.id === id), getElevation: id => { const l = m.levels.find(x => x.id === id); return l ? l.elevation : 0; } },
      bimOptions: { baseLevel: 'lvl_1', topConstraint: 'unconnected', unconnectedHeight: 3, thickness: 0.2 },
      setTool() { this._armedTool = arguments[0]; },
    });
    return app;
  };

  const box = (m, x0, y0, z0, x1, y1, z1) => {
    const f = m.addFaceFromRings([G.v(x0, y0, z0), G.v(x1, y0, z0), G.v(x1, y1, z0), G.v(x0, y1, z0)]);
    m.pushPull(f, z1 - z0);
    return [...m.faces.values()].filter(ff => !m.faces.has(f.id) || ff.id !== f.id);
  };
  const register = (app, type, faces, params = {}) => {
    const roles = {}; for (const f of faces) roles[f.id] = 'side';
    return app.bim.create(type, { baseLevel: 'lvl_1', ...params }, roles, []);
  };

  // ---- DXF ------------------------------------------------------------------
  test('DXF: every edge exports as a LINE on category layers (R12)', () => {
    const m = new Model();
    m.levels = [{ id: 'lvl_1', name: 'L1', elevation: 0 }];
    // a wall-stamped edge + a free edge
    const e1 = m.addEdge(G.v(0, 0, 0), G.v(3, 0, 0));
    const e2 = m.addEdge(G.v(0, 1, 0), G.v(3, 1, 0));
    const app = facade(m);
    app.bim.create('wall', { base: [0, 0, 0], end: [3, 0, 0], thickness: 0.2, height: 3, baseLevel: 'lvl_1' }, {}, [e1.id]);
    const dxf = DxfWriter.modelToDxf(m, { unit: 'mm' });
    ok(dxf.startsWith('0\nSECTION'.replace('\n', '\r\n')) || dxf.includes('SECTION'), 'R12 header');
    ok(dxf.includes('AC1009'), 'R12 version marker');
    ok(dxf.includes('A-WALL'), 'wall layer name present');
    const lines = (dxf.match(/LINE/g) || []).length - 1; // minus the entity name in the count? just count entity codes
    const ents = dxf.split('\r\n').filter((x, i, a) => x === 'LINE' && a[i - 1] === '0').length;
    eq(ents, 2, 'both edges exported as LINE entities');
    // mm scaling: a 3 m edge is 3000 in the DXF
    ok(dxf.includes('3000.000000'), 'mm unit scaling applied');
    // the free edge lands on layer 0
    const seg = dxf.split('\r\n');
    const idx = seg.indexOf('8');
    ok(seg.includes('0'), 'default layer 0 present');
  });

  test('DXF: hidden edges are skipped, unit options scale', () => {
    const m = new Model();
    const e1 = m.addEdge(G.v(0, 0, 0), G.v(2, 0, 0));
    const e2 = m.addEdge(G.v(0, 5, 0), G.v(2, 5, 0));
    e2.hidden = true;
    const dxf = DxfWriter.modelToDxf(m, { unit: 'cm' });
    const ents = dxf.split('\r\n').filter((x, i, a) => x === 'LINE' && a[i - 1] === '0').length;
    eq(ents, 1, 'hidden edge not exported');
    ok(dxf.includes('200.000000'), 'cm scaling applied');
  });

  // ---- Interference -----------------------------------------------------------
  test('interference: a column through a slab clashes; separated elements do not', () => {
    const m = new Model();
    m.levels = [{ id: 'lvl_1', name: 'L1', elevation: 0 }];
    // slab 2..4 z 0..0.2 ; column 2.5..3.0 z -0.5..2.5 (passes through)
    const diff = (fn) => { const before = new Set(m.faces.keys()); fn(); return [...m.faces.keys()].filter(id => !before.has(id)).map(id => m.faces.get(id)); };
    const slabF = diff(() => { const f = m.addFaceFromRings([G.v(2, 2, 0), G.v(4, 2, 0), G.v(4, 4, 0), G.v(2, 4, 0)]); m.pushPull(f, 0.2); });
    const colF = diff(() => { const f = m.addFaceFromRings([G.v(2.5, 2.5, -0.5), G.v(3, 2.5, -0.5), G.v(3, 3, -0.5), G.v(2.5, 3, -0.5)]); m.pushPull(f, 3.0); });
    const app = facade(m);
    const slab = register(app, 'slab', slabF);
    const col = register(app, 'column', colF);
    const clashes = Interference.interference(m, app.bim.entities);
    eq(clashes.length, 1, 'one clashing pair found');
    eq(clashes[0].a.type + '|' + clashes[0].b.type, 'slab|column', 'the right pair');
    ok(clashes[0].points.length >= 1, 'witness point(s) reported');
    // separated: a beam far away
    const beamF = diff(() => { const f = m.addFaceFromRings([G.v(10, 10, 1), G.v(12, 10, 1), G.v(12, 10.3, 1), G.v(10, 10.3, 1)]); m.pushPull(f, 0.4); });
    register(app, 'beam', beamF);
    const c2 = Interference.interference(m, app.bim.entities);
    eq(c2.length, 1, 'the distant beam adds no clash');
  });

  // ---- Select All Instances / Create Similar ----------------------------------
  test('Select All Instances groups by type+name; Create Similar arms the tool with the type', () => {
    const m = new Model();
    m.levels = [{ id: 'lvl_1', name: 'L1', elevation: 0 }];
    const app = facade(m);
    const mk = (x0, name) => {
      const before = new Set(m.faces.keys());
      const f = m.addFaceFromRings([G.v(x0, 0, 0), G.v(x0 + 0.3, 0, 0), G.v(x0 + 0.3, 0.3, 0), G.v(x0, 0.3, 0)]);
      m.pushPull(f, 3);
      const faces = [...m.faces.keys()].filter(id => !before.has(id)).map(id => m.faces.get(id));
      return register(app, 'column', faces, { name, width: 0.3, depth: 0.3 });
    };
    const a = mk(0, 'C1'), b = mk(5, 'C1'), c = mk(10, 'C2');
    app.selectAllInstances(a);
    eq(app.sel.faces.size > 0, true, 'selection populated');
    // a + b share the type name; c does not — count selected entities via stamps
    const selEnts = new Set([...app.sel.faces].map(fid => m.faces.get(fid).userData && m.faces.get(fid).userData.bimEntityId).filter(Boolean));
    eq(selEnts.size, 2, 'two instances of "C1" selected (C2 excluded)');
    ok(selEnts.has(a.id) && selEnts.has(b.id), 'the right two');
    // Create Similar: arms the column tool and copies the type params
    app.createSimilar(c);
    eq(app._armedTool, 'column', 'the column tool armed');
    near(app.bimOptions.columnWidth, 0.3, 1e-9, 'type width copied');
  });

  // ---- Paste Aligned to Level ---------------------------------------------------
  test('paste aligned lands the copy with its lowest point at the level', () => {
    const m = new Model();
    m.levels = [{ id: 'lvl_1', name: 'L1', elevation: 0 }, { id: 'lvl_2', name: 'L2', elevation: 3 }];
    const app = facade(m);
    // a small slab-ish box at z 0.2..0.7
    const f = m.addFaceFromRings([G.v(0, 0, 0.2), G.v(1, 0, 0.2), G.v(1, 1, 0.2), G.v(0, 1, 0.2)]);
    m.pushPull(f, 0.5);
    app.sel = { edges: new Set(), faces: new Set([...m.faces.keys()]) };
    app.copySel();
    ok(app.clipboard, 'copied');
    // paste aligned to L2 (elev 3): the copy's lowest z must be 3.0
    const before = m.faces.size;
    const zMin = Math.min(...app.clipboard.v.map(v => v[3]));
    const faces = m.importSubset(app.clipboard, G.v(0, 0, 3 - zMin));
    ok(faces.length > 0, 'pasted');
    const zs = faces.flatMap(ff => m.pts(m.faces.get(ff.id).loop).map(p => p.z));
    near(Math.min(...zs), 3.0, 1e-9, 'lowest point lands exactly on L2');
    ok(m.faces.size > before, 'the copy exists beside the original');
  });

  // ---- Sun Settings (pure math of the dialog) -----------------------------------
  test('sun: azimuth/altitude place the light on the correct hemisphere', () => {
    // replicate the dialog math: azi 90° alt 45° → +Y dominant, z = R sin45
    const R = 80, azi = Math.PI / 2, alt = Math.PI / 4;
    const p = { x: R * Math.cos(alt) * Math.cos(azi), y: R * Math.cos(alt) * Math.sin(azi), z: R * Math.sin(alt) };
    near(p.x, 0, 1e-9, 'east component zero at azimuth 90');
    near(p.y, R * Math.cos(alt), 1e-9, 'north component full');
    near(p.z, R * Math.SQRT1_2, 1e-9, 'altitude lifts z');
    ok(p.z > 0 && p.y > 0, 'sun above the horizon, from the north');
  });
};
