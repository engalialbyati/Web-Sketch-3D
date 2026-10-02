'use strict';
// Downloaded-asset instance tests — the persistence contract (model
// serialize/load carries the instance list via the provider hook) and the
// hosted-placement transform math (pure geometry: a model of known size
// lands centered in its wall opening, uniformly scaled to fit).
module.exports = h => {
  const { test, ok, eq, near } = h;

  test('serialize carries the asset instance list through the provider hook', () => {
    const { Model } = h.makeWorld();
    const m = new Model();
    m.assetListProvider = () => [{
      i: 'asset_1', a: 'uuid-1', n: 'Chair', k: 'door',
      p: [1.5, 2, 0], r: 0.25, s: 0.5,
      h: { w: 'wall_1', d: 1.2, si: 0, W: 0.9, H: 2.1, D: 0 },
    }];
    const snap = m.serialize();
    ok(Array.isArray(snap.assets) && snap.assets.length === 1, 'snapshot has the instance');
    eq(snap.assets[0].a, 'uuid-1');
    eq(snap.assets[0].h.w, 'wall_1');

    const m2 = new Model();
    m2.load(snap);
    ok(Array.isArray(m2.assetListData), 'load stashes the list');
    eq(m2.assetListData[0].n, 'Chair');
    eq(m2.assetListData[0].p[0], 1.5);
    eq(m2.assetListData[0].h.W, 0.9, 'host spec survives');
    // the restored list is a copy — mutating it cannot corrupt the snapshot
    m2.assetListData[0].n = 'Changed';
    eq(snap.assets[0].n, 'Chair', 'restored list is detached from the snapshot');
  });

  test('legacy files without assets round-trip cleanly', () => {
    const { Model } = h.makeWorld();
    const m = new Model();
    const snap = m.serialize();
    eq(snap.assets.length, 0, 'no provider -> empty list');
    const m2 = new Model();
    m2.load(snap);
    eq(m2.assetListData.length, 0, 'present-but-empty key -> empty list (no-op sync)');
    // a pre-assets snapshot (hand-stripped, like files from older versions)
    // hydrates to null — the app then leaves the live registry untouched
    const legacy = { ...snap };
    delete legacy.assets;
    const m3 = new Model();
    m3.load(legacy);
    eq(m3.assetListData, null, 'missing key -> null');
  });

  // THREE loads headless into the vm sandbox (no DOM needed at class level);
  // AssetManager's transform math is testable against real Vector3/Box3.
  // single audited loader (harness); the bridge promotes the UMD global
  const L3 = h.loadModel(['js/lib/three.min.js', 'js/assets.js']);
  const THREE = L3.window.THREE;
  const AssetManager = L3.window.AssetManager;
  ok(THREE && AssetManager, 'THREE + AssetManager load headless');

  test('applyHostedTransform centers a uniform-fit model in the opening', () => {
    const mgr = new AssetManager({ view: { scene: new THREE.Scene(), renderer: null } });
    // a 1 x 0.2 x 2 m slab centered at the origin stands in for the model
    const object = new THREE.Group();
    object.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 2)));
    const rec = {
      id: 'asset_t', assetId: 'x', name: 'T', kind: 'door', object,
      scale: 1, size: { x: 1, y: 0.2, z: 2 },
      host: { wallId: 'wall_1', distance: 5, sill: 0, width: 1, height: 2, depth: 0.2 },
    };
    // wall along +X at the origin, thickness 0.2 into +Y, opening centered 5 m out
    mgr.applyHostedTransform(rec, {
      center: { x: 5, y: 0, z: 0 },
      into: { x: 0, y: 1, z: 0 },
      dir: { x: 1, y: 0, z: 0 },
      rect: [
        { x: 4.5, y: 0, z: 0 }, { x: 5.5, y: 0, z: 0 },
        { x: 5.5, y: 0, z: 2 }, { x: 4.5, y: 0, z: 2 },
      ],
      depth: 0.2,
    });
    near(rec.scale, 1, 1e-9, '1x2 model already fits a 1x2 opening');
    const box = new THREE.Box3().setFromObject(rec.object);
    const c = box.getCenter(new THREE.Vector3());
    near(c.x, 5, 1e-6, 'centered across the opening');
    near(c.y, 0.1, 1e-6, 'depth centered on the wall mid-plane');
    near(c.z, 1, 1e-6, 'height centered in the opening');
  });

  test('applyHostedTransform scales DOWN uniformly for a smaller opening', () => {
    const mgr = new AssetManager({ view: { scene: new THREE.Scene(), renderer: null } });
    const object = new THREE.Group();
    object.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 4)));
    const rec = {
      id: 'asset_t2', assetId: 'x', name: 'T', kind: 'window', object,
      scale: 1, size: { x: 2, y: 0.2, z: 4 },
      host: { wallId: 'wall_1', distance: 0, sill: 0.9, width: 1, height: 2, depth: 0 },
    };
    mgr.applyHostedTransform(rec, {
      center: { x: 0, y: 0, z: 0 },
      into: { x: 0, y: 1, z: 0 },
      dir: { x: 1, y: 0, z: 0 },
      rect: [
        { x: -0.5, y: 0, z: 0.9 }, { x: 0.5, y: 0, z: 0.9 },
        { x: 0.5, y: 0, z: 2.9 }, { x: -0.5, y: 0, z: 2.9 },
      ],
      depth: 0.2,
    });
    near(rec.scale, 0.5, 1e-9, 'uniform fit = min(1/2, 2/4)');
    const box = new THREE.Box3().setFromObject(rec.object);
    const c = box.getCenter(new THREE.Vector3());
    near(c.z, 0.9 + 1, 1e-6, 'height center at sill + opening/2');
    near(box.max.x - box.min.x, 1, 1e-6, 'width fits the opening exactly');
  });

  // A CENTERLINE wall is the default and the case the old math got wrong:
  // info.center lies on the wall's mid-plane (the location line), so
  // center + into·depth/2 landed on the far FACE — models hung half
  // outside the wall (frames proud of the face).
  test('applyHostedTransform centers on the MID-plane for centerline walls', () => {
    const mgr = new AssetManager({ view: { scene: new THREE.Scene(), renderer: null } });
    const object = new THREE.Group();
    object.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.175, 2)));
    const rec = {
      id: 'asset_t3', assetId: 'x', name: 'T', kind: 'door', object,
      scale: 1, size: { x: 1, y: 0.175, z: 2 },
      host: { wallId: 'wall_1', distance: 2.5, sill: 0, width: 1, height: 2, depth: 0.2 },
    };
    // wall along +X on the y=0 CENTERLINE, faces at y = ±0.1, rect on the
    // NEAR plane y = +0.1, into pointing toward the far face (−Y)
    mgr.applyHostedTransform(rec, {
      center: { x: 2.5, y: 0, z: 0 }, // on the location line, like locate()
      into: { x: 0, y: -1, z: 0 },
      dir: { x: 1, y: 0, z: 0 },
      rect: [
        { x: 2, y: 0.1, z: 0 }, { x: 3, y: 0.1, z: 0 },
        { x: 3, y: 0.1, z: 2 }, { x: 2, y: 0.1, z: 2 },
      ],
      depth: 0.2,
    });
    const box = new THREE.Box3().setFromObject(rec.object);
    const c = box.getCenter(new THREE.Vector3());
    near(c.y, 0, 1e-6, 'depth centered on the wall mid-plane, not the far face');
    ok(box.min.y >= -0.1 - 1e-6 && box.max.y <= 0.1 + 1e-6, 'shallow model stays inside the 0.2 m wall');
    near(box.min.z, 0, 1e-6, 'door bottoms at the sill (floor)');
  });

  test('applyHostedTransform squashes a deeper frame into the wall depth', () => {
    const mgr = new AssetManager({ view: { scene: new THREE.Scene(), renderer: null } });
    // an ornate window: 1.2 wide, 0.45 deep, 1.5 high — deeper than the wall
    const object = new THREE.Group();
    object.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.45, 1.5)));
    const rec = {
      id: 'asset_t4', assetId: 'x', name: 'T', kind: 'window', object,
      scale: 1, size: { x: 1.2, y: 0.45, z: 1.5 },
      host: { wallId: 'wall_1', distance: 2.5, sill: 0.9, width: 1.2, height: 1.5, depth: 0.2 },
    };
    mgr.applyHostedTransform(rec, {
      center: { x: 2.5, y: 0, z: 0 },
      into: { x: 0, y: -1, z: 0 },
      dir: { x: 1, y: 0, z: 0 },
      rect: [
        { x: 1.9, y: 0.1, z: 0.9 }, { x: 3.1, y: 0.1, z: 0.9 },
        { x: 3.1, y: 0.1, z: 2.4 }, { x: 1.9, y: 0.1, z: 2.4 },
      ],
      depth: 0.2,
    });
    const box = new THREE.Box3().setFromObject(rec.object);
    ok(box.min.y >= -0.1 - 1e-6 && box.max.y <= 0.1 + 1e-6,
      `frame depth ${ (box.max.y - box.min.y).toFixed(3) } m squashed into the 0.2 m wall`);
    near(box.max.y - box.min.y, 0.2, 1e-6, 'depth axis scaled to the cut');
    near(rec.object.scale.x, 1, 1e-9, 'width/height scale untouched');
    near(box.max.x - box.min.x, 1.2, 1e-6, 'width still fits the opening');
    near(box.max.z - box.min.z, 1.5, 1e-6, 'height still fits the opening');
  });

  test('applyHostedTransform survives a REVERSED opening rect', () => {
    const mgr = new AssetManager({ view: { scene: new THREE.Scene(), renderer: null } });
    const object = new THREE.Group();
    object.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 2)));
    const rec = {
      id: 'asset_t5', assetId: 'x', name: 'T', kind: 'door', object,
      scale: 1, size: { x: 1, y: 0.2, z: 2 },
      host: { wallId: 'wall_1', distance: 0, sill: 0, width: 1, height: 2, depth: 0.2 },
    };
    // locate() flips the ring when its normal faces away from into —
    // rect[0] is then a TOP corner; the centroid and sill must not care
    mgr.applyHostedTransform(rec, {
      center: { x: 0, y: 0, z: 0 },
      into: { x: 0, y: 1, z: 0 },
      dir: { x: 1, y: 0, z: 0 },
      rect: [
        { x: -0.5, y: 0, z: 2 }, { x: 0.5, y: 0, z: 2 },
        { x: 0.5, y: 0, z: 0 }, { x: -0.5, y: 0, z: 0 },
      ],
      depth: 0.2,
    });
    const box = new THREE.Box3().setFromObject(rec.object);
    near(box.min.z, 0, 1e-6, 'sill taken from the low jamb corner');
    near(box.min.y, 0, 1e-6, 'near plane anchor');
    near(box.max.y, 0.2, 1e-6, 'mid-plane centered');
  });

  // ---- paint tint: foreign models take SOLID colors -----------------------
  // Catalogue/BlenderKit instances have no kernel faces — painting TINTS
  // their materials. Clones share materials with the template, so the tint
  // must clone PER INSTANCE or one painted window recolors every copy.
  const tintTemplate = () => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xf0f0f0 })));
    return { scene, size: { x: 1, y: 1, z: 1 } };
  };
  const firstColor = rec => {
    let c = null;
    rec.object.traverse(o => { if (o.isMesh && !c && o.material && o.material.color) c = o.material.color.getHexString(); });
    return c;
  };

  test('tint is per-instance - painting one window never recolors its siblings', () => {
    const mgr = new AssetManager({ view: { scene: new THREE.Scene(), renderer: null } });
    const tpl = tintTemplate();
    const a = mgr._instantiate('uuid-t', 'Window A', 'window', tpl);
    const b = mgr._instantiate('uuid-t', 'Window B', 'window', tpl);
    ok(mgr.tint(a.id, '#123456'), 'tint applied');
    eq(firstColor(a), '123456', 'instance A tinted');
    eq(firstColor(b), 'f0f0f0', 'sibling B untouched (materials cloned per instance)');
    ok(mgr.tint(a.id, '#abcdef'), 'repaint accepted');
    eq(firstColor(a), 'abcdef', 'repaint replaces the color (no stacking)');
    eq(mgr.tint('nope', '#ffffff'), false, 'unknown id refused');
  });

  test('tint survives serialize -> restore (reload keeps the painted frame)', async () => {
    const mgr = new AssetManager({ view: { scene: new THREE.Scene(), renderer: null } });
    const tpl = tintTemplate();
    mgr.templates.set('uuid-t', Promise.resolve(tpl)); // offline: cache hit, no fetch
    mgr._instantiate('uuid-t', 'Window', 'window', tpl);
    mgr.tint('asset_1', '#24425c');
    const snap = mgr.serialize();
    eq(snap[0].t, '#24425c', 'tint rides the instance list');
    const mgr2 = new AssetManager({ view: { scene: new THREE.Scene(), renderer: null } });
    mgr2.templates.set('uuid-t', Promise.resolve(tpl));
    await mgr2.restore(snap);
    const rec = mgr2.instances.get('asset_1');
    ok(rec, 'instance restored');
    eq(firstColor(rec), '24425c', 'paint color reapplied after reload');
  });
};