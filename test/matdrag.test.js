'use strict';
// Drag-and-drop material painting — the target-resolution contract:
// dropping on a BIM face paints the WHOLE element (a wall including its
// door/window opening reveals — the faces the hosted cut stamps to the
// wall), a native Door/Window element contributes its LINING faces but
// never frame/leaf, an asset island paints as one unit, and a free face
// paints just itself.
module.exports = async h => {
  const { loadModel, test, ok, eq } = h;
  const L = loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/BimElement.js', 'js/lib/three.min.js', 'js/app.js', 'js/tools/assets.js', 'js/features/onlinelib.js', 'js/features/materials.js']);
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

    // even dropping ON a reveal face paints nothing — the opening never
    // takes the wall's material
    const t2 = MD.paintTargets(m, revealFaces[0], bim.entities);
    eq(t2.length, 0, 'reveal drop resolves to NOTHING');
  });

  test('paintTargets: wall drops never reach the door; door drops paint the door', () => {
    const mk = at => m.addFaceFromRings([G.v(at, at, 0), G.v(at + 0.3, at, 0), G.v(at + 0.3, at + 0.3, 0), G.v(at, at + 0.3, 0)]).id;
    const lining = mk(20), frame = mk(21), leaf = mk(22);
    bim.create('door', { hostWallId: wallEnt.id, width: 1, height: 2.1, sillHeight: 0 }, { [lining]: 'lining', [frame]: 'frame', [leaf]: 'leaf' }, []);
    // the wall paints — and never reaches ANY door face
    const wallFid = [...m.faces.keys()].find(x => {
      const ff = m.faces.get(x);
      return ff.userData && ff.userData.bimEntityId === wallEnt.id && ff.userData.role !== 'lining';
    });
    const t = MD.paintTargets(m, wallFid, bim.entities);
    ok(t.length >= 1, 'wall paints');
    ok(!t.includes(lining) && !t.includes(frame) && !t.includes(leaf), 'wall drop never reaches the door');
    // a deliberate drop ON the door (its frame or leaf) paints the DOOR:
    // its own faces, minus the neutral reveal lining
    for (const fid of [frame, leaf]) {
      const d = MD.paintTargets(m, fid, bim.entities);
      ok(d.includes(frame) && d.includes(leaf), 'door drop paints frame + leaf');
      ok(!d.includes(lining), 'door drop leaves the reveal neutral');
      ok(!d.some(x => { const ff = m.faces.get(x); return ff.userData && ff.userData.bimEntityId === wallEnt.id; }), 'door drop never reaches the wall');
    }
    // dropping on the OPENING itself (the reveal) paints nothing
    eq(MD.paintTargets(m, lining, bim.entities).length, 0, 'reveal takes no material');
  });

  test('deleting the hosted element removes its model instance', () => {
    ok(bim.detach(doorEnt.id), 'element detached');
    eq(removedInstanceId, 'asset_1', 'the linked asset instance went with it');
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

  test('serialize→load keeps the named-material identity on faces', () => {
    // reload/file round-trips must carry matId + the registry — textured
    // materials render through it (colors alone are not enough)
    const m2 = new Model();
    const f = m2.addFaceFromRings([G.v(0, 0, 0), G.v(1, 0, 0), G.v(1, 1, 0), G.v(0, 1, 0)]);
    m2.materials.set('mat_rt', { id: 'mat_rt', name: 'Brick', color: '#a44a3a', alpha: 1, texture: { kind: 'brick', size: 0.22 } });
    f.matId = 'mat_rt'; f.color = '#a44a3a';
    const m3 = new Model();
    m3.load(JSON.parse(JSON.stringify(m2.serialize())));
    const back = [...m3.faces.values()].find(x => true);
    ok(back, 'face restored');
    eq(back.matId, 'mat_rt', 'matId survives the round-trip');
    ok(m3.materials.has('mat_rt') && m3.materials.get('mat_rt').texture.kind === 'brick', 'registry + texture restored');
  });

  test('attrJSON: row payloads survive an HTML attribute round-trip', () => {
    const payload = { matId: 'mat_"quoted"' };
    const attr = MD.attrJSON(payload);
    ok(!attr.includes('"'), 'double quotes escaped for the attribute');
    const back = JSON.parse(attr.replace(/&quot;/g, '"'));
    eq(back.matId, 'mat_"quoted"', 'payload round-trips');
    eq(MD.MAT_MIME, 'application/x-websketch-material', 'drag mime stable');
  });

  test('paintTargets: a GROUPED face paints the whole group', () => {
    const m2 = new Model();
    const fa = m2.addFaceFromRings([G.v(0, 0, 3), G.v(1, 0, 3), G.v(1, 1, 3), G.v(0, 1, 3)]);
    const fb = m2.addFaceFromRings([G.v(5, 0, 3), G.v(6, 0, 3), G.v(6, 1, 3), G.v(5, 1, 3)]);
    const g = m2.createGroup({ faces: new Set([fa.id, fb.id]), edges: new Set() }, 'Body');
    const t = MD.paintTargets(m2, fa.id, []);
    eq(t.length, 2, 'the whole group resolves');
    ok(t.includes(fa.id) && t.includes(fb.id), 'both member faces are targets');
    const g2 = m2.groups.get(g.id);
    eq(g2.name, 'Body', 'group exists');
  });

  test('paintDropAt: 2+ selected faces → the drop paints the SELECTION', () => {
    const m2 = new Model();
    const fa = m2.addFaceFromRings([G.v(0, 0, 0), G.v(1, 0, 0), G.v(1, 1, 0), G.v(0, 1, 0)]);
    const fb = m2.addFaceFromRings([G.v(3, 0, 0), G.v(4, 0, 0), G.v(4, 1, 0), G.v(3, 1, 0)]);
    const fc = m2.addFaceFromRings([G.v(6, 0, 0), G.v(7, 0, 0), G.v(7, 1, 0), G.v(6, 1, 0)]);
    m2.materials.set('mat_sel', { id: 'mat_sel', name: 'Selection Wood', color: '#8a5a2a', alpha: 1, texture: { kind: 'wood', size: 1 } });
    let ran = null;
    const app2 = {
      model: m2, bim: { entities: [] },
      sel: { faces: new Set([fa.id, fb.id]), edges: new Set() },
      run: (l, fn) => { ran = l; fn(m2); },
      toast() { }, setStatus() { },
      view: { pickFaceAt: () => fc.id, eventPt: () => ({ x: 0, y: 0 }), scene: null, invalidate() { } },
    };
    ok(MD.paintDropAt(app2, m2.materials.get('mat_sel'), {}), 'drop handled');
    eq(ran, 'paint selection', 'one transaction for the whole selection');
    eq(m2.faces.get(fa.id).matId, 'mat_sel', 'first selected face painted');
    eq(m2.faces.get(fb.id).matId, 'mat_sel', 'second selected face painted');
    ok(!m2.faces.get(fc.id).matId, 'the UNSELECTED face under the cursor stays untouched');
  });

  test('texture pass: ONE world texture space — adjacent faces pattern continuously', () => {
    const THREE2 = w.THREE;
    ok(THREE2, 'THREE available in the harness');
    // canvas stub for the procedural texture painter (no DOM in the vm)
    const stubCanvas = () => {
      const c = { width: 0, height: 0 };
      c.getContext = () => new Proxy({}, { get: (t, k) => k === 'canvas' ? c : () => { }, set: () => true });
      return c;
    };
    L.sandbox.document = { createElement: () => stubCanvas() };
    const m2 = new Model();
    m2.materials.set('mat_w', { id: 'mat_w', name: 'Wood', color: null, alpha: 1, texture: { kind: 'wood', size: 1 } });
    // two coplanar slabs side by side, sharing the x=2 edge
    const fa = m2.addFaceFromRings([G.v(0, 0, 0), G.v(2, 0, 0), G.v(2, 2, 0), G.v(0, 2, 0)]);
    const fb = m2.addFaceFromRings([G.v(2, 0, 0), G.v(4, 0, 0), G.v(4, 2, 0), G.v(2, 2, 0)]);
    fa.matId = fb.matId = 'mat_w';
    const scene = new THREE2.Scene();
    const app2 = { model: m2, sel: { faces: new Set(), edges: new Set() }, view: { scene, invalidate() { } } };
    MD.rebuildPass(app2);
    eq(app2._texturePass.children.length, 2, 'one overlay mesh per face');
    const uvAt = mesh => {
      const pos = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
      const map = new Map();
      for (let i = 0; i < pos.count; i++) {
        const k = [pos.getX(i).toFixed(6), pos.getY(i).toFixed(6), pos.getZ(i).toFixed(6)].join(',');
        map.set(k, [uv.getX(i), uv.getY(i)]);
      }
      return map;
    };
    const A = uvAt(app2._texturePass.children[0]), B = uvAt(app2._texturePass.children[1]);
    let shared = 0, agree = 0;
    for (const [k, u] of A) if (B.has(k)) {
      shared++;
      const b = B.get(k);
      if (Math.abs(b[0] - u[0]) < 1e-6 && Math.abs(b[1] - u[1]) < 1e-6) agree++;
    }
    ok(shared >= 2, `the meshes share the seam vertices (${shared})`);
    eq(agree, shared, 'every shared vertex carries the IDENTICAL uv — no pattern restart at the seam');
    // world mapping: a +Z face projects XY, so u tracks world x exactly
    const u0 = A.get('0.000000,0.000000,0.000000'), u2 = A.get('2.000000,0.000000,0.000000');
    ok(u0 && u2, 'corner vertices present');
    ok(Math.abs(u0[0]) < 1e-6 && Math.abs(u2[0] - 2) < 1e-6, 'u = world x / tile size (no per-face origin)');
  });
};
