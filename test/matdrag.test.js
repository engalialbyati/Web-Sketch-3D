'use strict';
// Drag-and-drop material painting — the target-resolution contract:
// dropping on a BIM face paints the WHOLE element (a wall including its
// door/window opening reveals — the faces the hosted cut stamps to the
// wall), a native Door/Window element contributes its LINING faces but
// never frame/leaf, an asset island paints as one unit, and a free face
// paints just itself.
module.exports = async h => {
  const { loadModel, test, ok, eq } = h;
  const L = loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/BimElement.js', 'js/app.js', 'js/tools/assets.js', 'js/features/onlinelib.js', 'js/features/materials.js']);
  const w = L.window;
  const { G, Model, StructuralManager, BimTools, AssetTools, OnlineLib, MaterialsFeature: MD, BimEntityManager } = w;

  const STORY = 3;
  const m = new Model();
  m.bimEntities = [];
  m.levels = [{ id: 'lvl_1', name: 'L1', elevation: 0 }];
  const bim = new BimEntityManager(m);

  // a 5 m wall along x
  const A2 = [0, 0, 0], B2 = [5, 0, 0];
  const p = { base: A2, end: B2, height: STORY, thickness: 0.2, locationLine: 'centerline', primitive: 'line', closed: false, joins: { start: 0, end: 0 } };
  const before = new Set(m.faces.keys());
  m.bimHold = true;
  try {
    const ring = BimTools.WallTool.bandRing(G, [G.v(...A2), G.v(...B2)], 0.2, 'centerline');
    if (!m.pushPull(m.addFaceFromRings(ring), p.height)) throw new Error('wall sweep failed');
  } finally { m.bimHold = false; }
  const nf = [...m.faces.keys()].filter(id => !before.has(id)).map(id => m.faces.get(id)).filter(f => f && !f.userData);
  const roles = {}; for (const f of nf) roles[f.id] = 'side';
  const edges = [];
  for (const f of nf) for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
    const e = m.findEdge(r[i], r[(i + 1) % r.length]);
    if (e && !e.userData) edges.push(e.id);
  }
  const wallEnt = bim.create('wall', JSON.parse(JSON.stringify(p)), roles, [...new Set(edges)]);

  // place a hosted catalogue door through the REAL tool — it cuts the
  // opening AND registers a real door/window entity carrying the instance
  // link (the Element Browser lists it)
  const size = { x: 1.0, y: 0.08, z: 2.1 };
  const spec = OnlineLib.hostedSpec('door', size);
  let removedInstanceId = null;
  const app = {
    model: m, bim,
    toast() { }, setStatus() { },
    bimOptions: { assetId: 'lib:door-drag', assetName: 'Glass door', hosted: { width: spec.width, height: spec.height, sill: spec.sill } },
    families: null,
    view: { clearPreview() { } },
    transaction: { run: (name, fn) => fn(m) },
    assets: {
      registerTemplate() { },
      loadTemplate: async () => ({ scene: null, size }),
      placeHosted: () => ({ id: 'asset_1' }),
      remove: id => { removedInstanceId = id; },
    },
    levelManager: {
      levels: m.levels,
      getElevation: id => { const l = m.levels.find(x => x.id === id); return l ? l.elevation : 0; },
      getLevel: id => m.levels.find(x => x.id === id),
    },
    structural: new StructuralManager(() => m.levels, () => m.bimEntities),
  };
  w.app = app;
  const tool = new AssetTools.AssetDoorTool(app);
  tool.activate();
  await new Promise(r => setTimeout(r, 0));
  ok(tool._placeOne(m, { kind: 'wall', ent: wallEnt }, 2.5), 'hosted door placed through the real tool');
  ok(m.validate().ok, 'wall with opening stays valid');

  const doorEnt = bim.entities.find(e => e.type === 'door');
  ok(doorEnt, 'hosted placement registered a DOOR entity (Element Browser listing)');
  ok(doorEnt.params.assetInstanceId === 'asset_1', 'entity links its model instance');
  ok(doorEnt.params.hostWallId === wallEnt.id, 'entity hosted on the wall');
  eq(doorEnt.params.name, 'Glass door', 'entity carries the model name');

  const revealFaces = [...doorEnt.faces];
  ok(revealFaces.length >= 4, `cut registered ${revealFaces.length} lining faces on the door entity`);
  ok(revealFaces.every(fid => { const f = m.faces.get(fid); return f && f.userData && f.userData.bimEntityId === doorEnt.id && f.userData.role === 'lining'; }),
    'every reveal face is stamped to the door entity with the lining role');

  test('paintTargets: dropping on the wall paints the WALL, never the opening', () => {
    ok(MD && MD.paintTargets, 'feature exports paintTargets');
    const stamped = [...m.faces.keys()].filter(x => {
      const ff = m.faces.get(x);
      return ff.userData && ff.userData.bimEntityId === wallEnt.id;
    });
    ok(stamped.length >= 1, `wall owns ${stamped.length} faces`);
    // the opening belongs to the door entity — nothing reveal-ish is
    // wall-stamped, so an element-wide paint can never reach it
    for (const fid of revealFaces) ok(!stamped.includes(fid), 'reveal ' + fid + ' owned by the door, not the wall');

    const t = MD.paintTargets(m, stamped[0], bim.entities);
    ok(t.length >= 1, 'wall faces resolved');
    ok(t.every(x => stamped.includes(x)), 'targets stay inside the element');
    for (const fid of revealFaces) ok(!t.includes(fid), 'reveal ' + fid + ' NOT painted');

    // even dropping ON a reveal face resolves to just that face — the
    // opening never takes the wall's material
    const t2 = MD.paintTargets(m, revealFaces[0], bim.entities);
    eq(t2.length, 1, 'reveal drop paints itself only');
    eq(t2[0], revealFaces[0], 'the reveal face, not the wall');
  });

  test('deleting the hosted element removes its model instance', () => {
    ok(bim.detach(doorEnt.id), 'element detached');
    eq(removedInstanceId, 'asset_1', 'the linked asset instance went with it');
  });

  test('paintTargets: native door linings are skipped too', () => {
    const wallFid = [...m.faces.keys()].find(x => {
      const ff = m.faces.get(x);
      return ff.userData && ff.userData.bimEntityId === wallEnt.id && ff.userData.role !== 'lining';
    });
    const mk = at => m.addFaceFromRings([G.v(at, at, 0), G.v(at + 0.3, at, 0), G.v(at + 0.3, at + 0.3, 0), G.v(at, at + 0.3, 0)]).id;
    const lining = mk(20), frame = mk(21), leaf = mk(22);
    bim.create('door', { hostWallId: wallEnt.id, width: 1, height: 2.1, sillHeight: 0 }, { [lining]: 'lining', [frame]: 'frame', [leaf]: 'leaf' }, []);
    const t = MD.paintTargets(m, wallFid, bim.entities);
    ok(!t.includes(lining), 'native lining (reveal) NOT painted with the wall');
    ok(!t.includes(frame), 'door frame keeps its own look');
    ok(!t.includes(leaf), 'door leaf keeps its own look');
  });

  test('paintTargets: an asset island paints as one unit, a free face alone', () => {
    const gid = 'asset:g1';
    const probe = m.addFaceFromRings([G.v(9, 9, 0), G.v(9.4, 9, 0), G.v(9.4, 9.4, 0), G.v(9, 9.4, 0)]);
    const probe2 = m.addFaceFromRings([G.v(10, 10, 0), G.v(10.4, 10, 0), G.v(10.4, 10.4, 0), G.v(10, 10.4, 0)]);
    (probe.userData || (probe.userData = {})).assetGid = gid;
    (probe2.userData || (probe2.userData = {})).assetGid = gid;
    const t = MD.paintTargets(m, probe.id, bim.entities);
    eq(t.length, 2, 'island resolved as one unit');
    ok(t.includes(probe2.id), 'both island faces included');

    const probe3 = m.addFaceFromRings([G.v(11, 11, 0), G.v(11.4, 11, 0), G.v(11.4, 11.4, 0), G.v(11, 11.4, 0)]);
    eq(MD.paintTargets(m, probe3.id, bim.entities).length, 1, 'bare face paints alone');
  });

  test('attrJSON: row payloads survive an HTML attribute round-trip', () => {
    const payload = { matId: 'mat_"quoted"' };
    const attr = MD.attrJSON(payload);
    ok(!attr.includes('"'), 'double quotes escaped for the attribute');
    const back = JSON.parse(attr.replace(/&quot;/g, '"'));
    eq(back.matId, 'mat_"quoted"', 'payload round-trips');
    eq(MD.MAT_MIME, 'application/x-websketch-material', 'drag mime stable');
  });
};
