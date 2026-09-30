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
  app2.assets = {
    registerTemplate() { },
    loadTemplate: async () => ({ scene: null, size }),
    placeHosted: () => ({ id: 'asset_1', name: 'Glass door' }),
    checkOrphans() { return 0; },
  };
  const tool = new AssetTools.AssetDoorTool(app2);
  tool.activate();
  await new Promise(r => setTimeout(r, 0));
  ok(tool._placeOne(m, { kind: 'wall', ent: wallEnt }, 2.5), 'hosted door placed');
  app2.assets = mgr; // back to the real manager for the db flows
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
};
