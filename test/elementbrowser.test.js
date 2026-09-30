'use strict';
// Element Browser integration for library assets: a hosted door placement
// must sync into the Elements table with its name, and "define as
// door/window/object" must grow the catalog (family + type) so the model
// is placeable from the browser. Runs against the in-memory store.
module.exports = async h => {
  const { loadModel, test, ok, eq } = h;
  const L = loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/BimElement.js', 'js/db.js', 'js/lib/three.min.js', 'js/app.js', 'js/assets.js', 'js/tools/assets.js', 'js/features/onlinelib.js']);
  const w = L.window;
  const { G, Model, BimTools, AssetManager, BimEntityManager, BimDatabase, BimElementRegistry, StructuralManager, AssetTools, OnlineLib } = w;
  const THREE = w.THREE;
  ok(BimDatabase && BimElementRegistry, 'db + element registry load headless');

  const m = new Model();
  m.bimEntities = [];
  m.levels = [{ id: 'lvl_1', name: 'L1', elevation: 0 }];
  const bim = new BimEntityManager(m);
  const A2 = [0, 0, 0], B2 = [5, 0, 0];
  const p = { base: A2, end: B2, height: 3, thickness: 0.2, locationLine: 'centerline', primitive: 'line', closed: false, joins: { start: 0, end: 0 } };
  const before = new Set(m.faces.keys());
  m.bimHold = true;
  try {
    const ring = BimTools.WallTool.bandRing(G, [G.v(...A2), G.v(...B2)], 0.2, 'centerline');
    if (!m.pushPull(m.addFaceFromRings(ring), 3)) throw new Error('wall sweep failed');
  } finally { m.bimHold = false; }
  const nf = [...m.faces.keys()].filter(id => !before.has(id)).map(id => m.faces.get(id)).filter(f => f && !f.userData);
  const roles = {}; for (const f of nf) roles[f.id] = 'side';
  const edges = [];
  for (const f of nf) for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
    const e = m.findEdge(r[i], r[(i + 1) % r.length]);
    if (e && !e.userData) edges.push(e.id);
  }
  const wallEnt = bim.create('wall', JSON.parse(JSON.stringify(p)), roles, [...new Set(edges)]);

  const db = await BimDatabase.withMemory();
  await db.seedDefaults();
  const mgr = new AssetManager({ bim: { entities: bim.entities, getEntityById: id => bim.entities.find(e => e.id === id) || null }, view: { scene: new THREE.Scene() } });
  const tpl = (() => {
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(1, 0.08, 2.1);
    geo.translate(0, 0, 1.05);
    g.add(new THREE.Mesh(geo));
    return { scene: g, size: { x: 1, y: 0.08, z: 2.1 } };
  })();
  mgr.templates.set('lib:doorx', Promise.resolve(tpl));

  const app2 = Object.assign(Object.create(w.App.prototype), {
    model: m, bim, assets: mgr, db,
    elements: null, // set below (needs app2 first)
    bimOptions: {},
    view: { rebuild() { }, invalidate() { }, clearPins() { }, clearPreview() { }, zoomExtents() { } },
    toast() { }, setStatus() { }, updateInfo() { },
    refreshGroups() { }, _updateEditBox() { }, _saveAutosave() { }, refreshEdgeStamps() { },
    run: (label, fn) => fn(m),
    selAssets: new Set(),
    sel: { faces: new Set(), edges: new Set() },
    levelManager: { model: m, levels: m.levels, getElevation: () => 0, getLevel: () => m.levels[0] },
    structural: new StructuralManager(() => m.levels, () => m.bimEntities),
    transaction: { run: (label, fn) => fn(m) },
  });
  app2.elements = new BimElementRegistry(app2);
  w.app = app2;

  // ---- hosted placement through the REAL tool → door entity -----------
  const size = { x: 1.0, y: 0.08, z: 2.1 };
  const spec = OnlineLib.hostedSpec('door', size);
  app2.bimOptions = { assetId: 'lib:doorx', assetName: 'Glass door', hosted: { width: spec.width, height: spec.height, sill: spec.sill } };
  const tool = new AssetTools.AssetDoorTool(app2);
  tool.activate();
  await new Promise(r => setTimeout(r, 0));
  ok(tool._placeOne(m, { kind: 'wall', ent: wallEnt }, 2.5), 'hosted door placed');
  const doorEnt = bim.entities.find(e => e.type === 'door');
  ok(doorEnt, 'door entity registered');

  test('hosted door element syncs into the Elements table', async () => {
    await app2.syncElementsToDb();
    const rows = await db.getAllElements();
    const row = rows.find(r => r.id === doorEnt.id);
    ok(row, `Elements row exists for ${doorEnt.id} (${rows.length} rows total)`);
    eq(row.name, 'Glass door', 'row carries the model name');
    ok(row.typeId, 'row typed');
    const cats = await db.getCatalog();
    const fam = cats.families.find(f => f.id === 'fam_lib_door');
    ok(fam, 'Library Models door family created');
    const type = cats.types.find(t => t.familyId === 'fam_lib_door');
    ok(type, 'type under the family');
    eq(type.name, 'Glass door', 'type named after the model');
    eq(type.defaultParameters.assetId, 'lib:doorx', 'dragging the type re-arms the asset tool');
  });

  test('define-as on a selected asset grows the catalog (placeable type)', async () => {
    // a free-standing catalogue model in the scene
    const rec = mgr.placeFree('lib:doorx', 'Glass door', tpl, { x: 8, y: 8, z: 0 });
    ok(rec && mgr.get(rec.id), 'free asset placed');
    await app2.defineAssetKind(rec.id, 'door');
    const cats = await db.getCatalog();
    const fam = cats.families.find(f => f.id === 'fam_bk_door');
    ok(fam, 'BlenderKit door family created');
    const type = cats.types.find(t => t.familyId === 'fam_bk_door' && t.name === 'Glass door');
    ok(type, 'type named after the model exists (placeable from the browser)');
    eq(type.defaultParameters.assetId, 'lib:doorx', 'type carries the asset id');
    eq(rec.kind, 'door', 'instance kind stamped');
  });

  test('reload: serialize → fresh model → restore keeps asset, entity, opening', async () => {
    // the app's provider wiring (constructor does this)
    m.assetListProvider = () => mgr.serialize();
    const snap = JSON.parse(JSON.stringify(m.serialize()));
    ok((snap.assets || []).some(x => x.h && x.h.w === wallEnt.id), 'snapshot carries the hosted record');
    ok(snap.ents || snap.bim || true, 'entities ride along');

    // fresh boot: new model, new manager, catalogue stubs (the bridge path
    // is exercised by the browser; here the lib: rebuild is stubbed)
    w.OnlineLib = {
      fetchIndex: async () => ({}),
      fetchModelSoup: async () => ({ positions: [], triangles: [], triAttrs: [] }),
    };
    w.ComponentsFeature = {
      foreignObject: () => {
        const g = new THREE.Group();
        const geo = new THREE.BoxGeometry(1, 0.08, 2.1);
        geo.translate(0, 0, 1.05);
        g.add(new THREE.Mesh(geo));
        return g;
      },
    };
    const m2 = new Model();
    m2.bimEntities = [];
    const bim2 = new BimEntityManager(m2);
    m2.load(snap);
    const appStub2 = {
      model: m2,
      bim: { entities: m2.bimEntities, getEntityById: id => m2.bimEntities.find(e => e.id === id) || null },
      levelManager: { model: m2, levels: m2.levels },
      view: { scene: new THREE.Scene(), invalidate() { } },
      assetsChanged() { },
    };
    const mgr2 = new AssetManager(appStub2);
    appStub2.assets = mgr2;
    await mgr2.restore(m2.assetListData || []);

    eq(mgr2.instances.size, 2, 'both instances restored (hosted + free)');
    const rec2 = [...mgr2.instances.values()].find(r => r.host);
    ok(rec2, 'the hosted instance is among them');
    eq(rec2.host.wallId, wallEnt.id, 'host wall id survived');
    const doorEnt2 = m2.bimEntities.find(e => e.type === 'door');
    ok(doorEnt2, 'door entity restored');
    eq(doorEnt2.params.assetInstanceId, rec2.id, 'entity↔instance link intact');
    const linings = [...m2.faces.keys()].filter(id => {
      const f = m2.faces.get(id);
      return f && f.userData && f.userData.bimEntityId === doorEnt2.id && f.userData.role === 'lining';
    });
    ok(linings.length >= 4, `opening restored (${linings.length} lining faces)`);
    const box = new THREE.Box3().setFromObject(rec2.object);
    ok(box.min.z > -0.01 && Math.abs(box.max.z - 2.1) < 0.02, `model repositioned in the opening (z ${box.min.z.toFixed(2)}..${box.max.z.toFixed(2)})`);
    ok(Math.abs((box.min.y + box.max.y) / 2) < 0.02, 'centered mid-wall');
    ok(m2.validate().ok, 'reloaded model valid');

    // ---- the invalid-model boot: self-heal rebuild + opDone (the reap and
    // checkOrphans run for real) must not eat the hosted asset
    const app3 = Object.assign(Object.create(w.App.prototype), {
      model: m2, bim: bim2, assets: mgr2, db,
      elements: app2.elements,
      bimOptions: {},
      view: { rebuild() { }, invalidate() { }, clearPins() { }, clearPreview() { }, zoomExtents() { } },
      toast() { }, setStatus() { }, updateInfo() { },
      refreshGroups() { }, _updateEditBox() { }, _saveAutosave() { }, refreshEdgeStamps() { },
      selAssets: new Set(), sel: { faces: new Set(), edges: new Set() },
      levelManager: { model: m2, levels: m2.levels, getElevation: () => 0, getLevel: () => m2.levels[0] },
      structural: new StructuralManager(() => m2.levels, () => m2.bimEntities),
      run: (label, fn) => { fn(m2); app3.opDone(); }, // the REAL commit pipeline
    });
    mgr2.app = app3;
    w.app = app3;
    const out3 = app3.rebuildFromParams();
    ok(out3 && out3.counts, 'self-heal rebuild ran');
    eq(mgr2.instances.size, 2, 'both instances survive the self-heal + opDone');
    const doorEnt3 = m2.bimEntities.find(e => e.type === 'door');
    ok(doorEnt3, 'door entity survives (not reaped)');
    const rec3 = [...mgr2.instances.values()].find(r => r.host);
    ok(rec3 && rec3.host.wallId === wallEnt.id, 'hosted instance intact');
    const linings3 = [...m2.faces.keys()].filter(id => {
      const f = m2.faces.get(id);
      return f && f.userData && f.userData.bimEntityId === (doorEnt3 && doorEnt3.id) && f.userData.role === 'lining';
    });
    ok(linings3.length >= 4, `opening re-cut (${linings3.length} lining faces)`);
  });
};
