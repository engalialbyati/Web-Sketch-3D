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
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const sandbox = { window: {}, console, Buffer, self: undefined };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'lib', 'three.min.js'), 'utf8'), ctx, { filename: 'three.min.js' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'assets.js'), 'utf8'), ctx, { filename: 'assets.js' });
  const THREE = sandbox.THREE; // the UMD attaches to the context global
  const AssetManager = sandbox.window.AssetManager;
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
};
