'use strict';
// Hosted catalogue models — the Doors & Windows insert-as-element path:
// a model armed from the Asset Library (bimOptions + pre-registered soup
// template) goes through AssetDoorTool, which cuts a REAL opening in the
// wall via HostedCut and hosts the model in it. The asset manager is
// stubbed (its visuals need THREE); the cut, the spec wiring and the host
// bookkeeping are the real thing.
module.exports = async h => {
  const { test, ok, eq, near } = h;
  const L = h.loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/BimElement.js', 'js/app.js', 'js/tools/assets.js', 'js/features/onlinelib.js']);
  const w = L.window;
  const { G, Model, StructuralManager, BimTools, AssetTools, OnlineLib } = w;
  const BimEntityManager = w.BimEntityManager;

  const STORY = 3;
  const m = new Model();
  m.bimEntities = [];
  m.levels = [{ id: 'lvl_1', name: 'L1', elevation: 0 }];
  const bim = new BimEntityManager(m);

  // the model's declared border (a 0.95 × 2.05 m door)
  const size = { x: 0.95, y: 0.08, z: 2.05 };
  const spec = OnlineLib.hostedSpec('door', size);

  let hosted = null; // placeHosted capture
  const app = {
    model: m, bim,
    toast() { }, setStatus() { },
    bimOptions: {
      assetId: 'lib:door-test', assetName: 'Glass door',
      hosted: { width: spec.width, height: spec.height, sill: spec.sill },
    },
    families: null,
    view: { clearPreview() { } },
    transaction: { run: (name, fn) => fn(m) },
    assets: {
      registerTemplate() { },
      loadTemplate: async () => ({ scene: null, size }),
      placeHosted: (aid, name, tpl, host, info) => {
        hosted = { aid, name, host, info };
        return { id: 'asset_1', name };
      },
    },
    levelManager: {
      levels: m.levels,
      getElevation: id => { const l = m.levels.find(x => x.id === id); return l ? l.elevation : 0; },
      getLevel: id => m.levels.find(x => x.id === id),
    },
    structural: new StructuralManager(() => m.levels, () => m.bimEntities),
  };
  w.app = app;

  // a 5 m wall along x, like the hostedcuts world
  const A2 = [0, 0, 0], B2 = [5, 0, 0];
  const p = {
    base: A2, end: B2, height: STORY, thickness: 0.2,
    locationLine: 'centerline', primitive: 'line', closed: false, joins: { start: 0, end: 0 },
  };
  const before = new Set(m.faces.keys());
  m.bimHold = true;
  try {
    const ring = BimTools.WallTool.bandRing(G, [G.v(...A2), G.v(...B2)], p.thickness, 'centerline');
    if (!m.pushPull(m.addFaceFromRings(ring), p.height)) throw new Error('wall sweep failed');
  } finally { m.bimHold = false; }
  const nf = [...m.faces.keys()].filter(id => !before.has(id))
    .map(id => m.faces.get(id)).filter(f => f && !f.userData);
  const roles = {}; for (const f of nf) roles[f.id] = 'side';
  const edges = [];
  for (const f of nf) for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
    const e = m.findEdge(r[i], r[(i + 1) % r.length]);
    if (e && !e.userData) edges.push(e.id);
  }
  const wallEnt = bim.create('wall', JSON.parse(JSON.stringify(p)), roles, [...new Set(edges)]);
  ok(wallEnt, 'wall entity created');

  const faceAreaSum = () => {
    let s = 0;
    for (const fid of wallEnt.faces) {
      const f = m.faces.get(fid);
      if (f) for (const r of m.rings(f)) s += Math.abs(G.loopArea(m.pts(r)));
    }
    return s;
  };
  const areaBefore = faceAreaSum();

  test('AssetDoorTool: a catalogue model cuts a real opening and hosts in it', async () => {
    const tool = new AssetTools.AssetDoorTool(app);
    tool.activate(); // reads bimOptions (spec from hostedSpec) + loads the template
    await new Promise(r => setTimeout(r, 0)); // loadTemplate promise resolves
    ok(tool._tpl, 'template loaded from the registered cache stub');
    eq(tool.spec.width, spec.width, 'opening width from the model border');
    eq(tool.spec.height, spec.height, 'opening height from the model border');
    eq(tool.spec.sill, 0, 'door sill 0');

    const okPlace = tool._placeOne(m, { kind: 'wall', ent: wallEnt }, 2.0);
    ok(okPlace, 'placement succeeded');

    // the wall really lost the opening's area (cut through both faces)
    const areaAfter = faceAreaSum();
    ok(areaBefore - areaAfter > spec.width * spec.height,
      `wall face area dropped by ${ (areaBefore - areaAfter).toFixed(3) } m² (opening ${spec.width}×${spec.height})`);
    ok(m.validate().ok, 'model still valid with the cut');

    // the asset manager got the host bookkeeping
    ok(hosted, 'placeHosted called');
    eq(hosted.aid, 'lib:door-test', 'asset id passed through');
    eq(hosted.host.wallId, wallEnt.id, 'host wall id');
    eq(hosted.host.width, spec.width, 'host width');
    eq(hosted.host.height, spec.height, 'host height');
    near(hosted.host.sill, 0, 1e-9, 'host sill');
    ok(hosted.info && !hosted.info.error && hosted.info.rect, 'cut info returned');
  });

  test('free-object mode is untouched: hostedSpec only sizes hosted inserts', () => {
    // the mode select defaults to door for the DW category; other categories
    // never reach hostedSpec — their cards arm plain click-to-place
    eq(OnlineLib.DW_CATEGORY, 'Puertas y Ventanas', 'category key matches the index');
    ok(OnlineLib.hostedSpec('door', size).sill === 0, 'door stays floor-sitting');
  });
};
