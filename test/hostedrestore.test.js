'use strict';
// Hosted catalogue models must survive reloads and parametric wall
// rebuilds: loadTemplate rebuilds "lib:" templates from the bridge's
// disk-cached catalogue zip, restore() re-anchors hosted records on the
// wall's MID-plane (locate() carries no depth), and recutHosted cuts
// under a NAMED hold so element independence lets the rebuilt wall open.
module.exports = async h => {
  const { loadModel, test, ok, eq, near } = h;
  const L = loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/BimElement.js', 'js/lib/three.min.js', 'js/app.js', 'js/assets.js', 'js/features/onlinelib.js']);
  const w = L.window;
  const { G, Model, BimTools, AssetManager, BimEntityManager } = w;
  const THREE = w.THREE;

  test('loadTemplate: "lib:" ids rebuild from the cached catalogue, not the GLB bridge', async () => {
    let asked = null;
    w.OnlineLib = {
      fetchIndex: async () => ({ doorx: { id: 'doorx', nombre: 'X' } }),
      fetchModelSoup: async entry => { asked = entry; return { positions: [], triangles: [], triAttrs: [] }; },
    };
    w.ComponentsFeature = {
      foreignObject: () => {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.175, 2)));
        return g;
      },
    };
    const mgr = new AssetManager({ view: { scene: new THREE.Scene(), renderer: null } });
    const tpl = await mgr.loadTemplate('lib:doorx', 'Glass door');
    ok(tpl && tpl.scene, 'template resolved');
    near(tpl.size.x, 1, 1e-6, 'size measured from the rebuilt scene');
    near(tpl.size.y, 0.175, 1e-6, 'depth');
    near(tpl.size.z, 2, 1e-6, 'height');
    ok(asked && asked.id === 'doorx' && asked.nombre === 'X', 'index entry (declared size/rot) forwarded');
  });

  // ---- wall fixture (centerline, like every other hosted test) ----------
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

  const appStub = {
    model: m,
    bim: { entities: bim.entities, getEntityById: id => bim.entities.find(e => e.id === id) || null },
    view: { scene: new THREE.Scene(), invalidate() { } },
    assetsChanged() { },
  };
  const tpl = (() => {
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(1, 0.175, 2);
    geo.translate(0, 0, 1); // grounded like the importer's soups
    g.add(new THREE.Mesh(geo));
    return { scene: g, size: { x: 1, y: 0.175, z: 2 } };
  })();

  test('restore(): a hosted record re-anchors on the wall MID-plane', async () => {
    const mgr = new AssetManager(appStub);
    mgr.templates.set('lib:doorx', Promise.resolve(tpl));
    await mgr.restore([{
      i: 'asset_1', a: 'lib:doorx', n: 'Glass door', k: 'door',
      h: { w: wallEnt.id, d: 2.5, si: 0, W: 1, H: 2, D: 0 },
      p: [0, 0, 0], r: 0, s: 1,
    }]);
    const rec = mgr.get('asset_1');
    ok(rec && rec.host && rec.host.wallId === wallEnt.id, 'instance restored with its host');
    const box = new THREE.Box3().setFromObject(rec.object);
    near((box.min.z + box.max.z) / 2, 1, 1e-6, 'height centered in the opening');
    near((box.min.y + box.max.y) / 2, 0, 1e-6, 'depth centered on the wall mid-plane (locate has no depth — supplied)');
    ok(box.min.y >= -0.1 - 1e-6 && box.max.y <= 0.1 + 1e-6, 'inside the 0.2 m wall');
  });

  test('recutHosted(): NAMED hold re-opens a rebuilt SOLID wall and owns the reveals', () => {
    const mgr = new AssetManager(appStub);
    mgr.templates.set('lib:doorx', Promise.resolve(tpl));
    // the post-rebuild state: the wall was re-extruded and re-stamped SOLID;
    // the hosted instance still carries its parametric position
    const loc = BimTools.HostedCut.locate(G, p, { distanceFromStart: 2.5, width: 1, height: 2, sillHeight: 0 });
    ok(!loc.error, 'locate ok');
    loc.depth = 0.2;
    const rec = mgr.placeHosted('lib:doorx', 'Glass door', tpl, {
      wallId: wallEnt.id, distance: 2.5, sill: 0, width: 1, height: 2, depth: 0.2, kindHint: 'door',
    }, loc);
    ok(rec.host.wallId === wallEnt.id, 'hosted');

    const facesBefore = m.faces.size;
    const listBefore = wallEnt.faces.length;
    mgr.recutHosted(wallEnt.id, m);
    ok(m.faces.size > facesBefore, `opening re-cut (+${m.faces.size - facesBefore} faces) — unnamed hold would have been refused`);
    const reveals = [...m.faces.keys()].filter(id => {
      const f = m.faces.get(id);
      return f && f.userData && f.userData.bimEntityId === wallEnt.id && f.userData.role === 'lining';
    });
    ok(reveals.length >= 4, `${reveals.length} reveals stamped to the wall with the lining role`);
    ok(wallEnt.faces.length > listBefore, 'entity face list extended — the next rebuild sweeps them');
    const box = new THREE.Box3().setFromObject(rec.object);
    near((box.min.y + box.max.y) / 2, 0, 1e-6, 'model re-centered mid-wall');
    near(box.min.z, 0, 1e-6, 'door still bottoms at the floor');
    ok(m.validate().ok, 'model valid after the re-cut');
  });

  test('rebuildFromParams(): hosted openings re-cut, models keep their place', () => {
    const mgr = new AssetManager(appStub);
    mgr.templates.set('lib:doorx', Promise.resolve(tpl));
    const loc = BimTools.HostedCut.locate(G, p, { distanceFromStart: 2.5, width: 1, height: 2, sillHeight: 0 });
    loc.depth = 0.2;
    const rec = mgr.placeHosted('lib:doorx', 'Glass door', tpl, {
      wallId: wallEnt.id, distance: 2.5, sill: 0, width: 1, height: 2, depth: 0.2, kindHint: 'door',
    }, loc);
    mgr.recutHosted(wallEnt.id, m); // initial opening (the placement-time cut)
    const revealsBefore = [...m.faces.keys()].filter(id => {
      const f = m.faces.get(id);
      return f && f.userData && f.userData.bimEntityId === wallEnt.id && f.userData.role === 'lining';
    });
    ok(revealsBefore.length >= 4, 'opening exists before the rebuild');

    // the app facade rebuildFromParams needs (App methods via the prototype —
    // the class is exported for exactly this headless use)
    const app2 = Object.assign(Object.create(w.App.prototype), {
      model: m, bim, assets: mgr,
      view: { rebuild() { }, invalidate() { }, zoomExtents() { }, clearPins() { } },
      toast() { }, setStatus() { }, updateInfo() { },
      run: (label, fn) => fn(m),
      levelManager: { levels: m.levels, getElevation: () => 0, getLevel: () => m.levels[0] },
      structural: new (w.StructuralManager)(() => m.levels, () => m.bimEntities),
    });
    mgr.app = app2;
    const out = app2.rebuildFromParams();
    ok(out && out.counts && out.counts.wall === 1, 'wall rebuilt from parameters');
    ok(m.validate().ok, 'model valid after the wholesale rebuild');

    const revealsAfter = [...m.faces.keys()].filter(id => {
      const f = m.faces.get(id);
      return f && f.userData && f.userData.bimEntityId === wallEnt.id && f.userData.role === 'lining';
    });
    ok(revealsAfter.length >= 4,
      `opening re-cut (${revealsAfter.length} reveals) — walls must not heal solid over a hosted asset`);
    ok(wallEnt.faces.some(fid => revealsAfter.includes(fid)), 'fresh reveals recorded in the entity face list');
    const box = new THREE.Box3().setFromObject(rec.object);
    near((box.min.y + box.max.y) / 2, 0, 1e-6, 'model still centered mid-wall');
    near(box.min.z, 0, 1e-6, 'door still bottoms at the floor');
    eq(mgr.instances.size, 1, 'hosted instance survived the rebuild');
  });
};
