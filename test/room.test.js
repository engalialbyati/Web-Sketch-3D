'use strict';
// features/room.js — the planar wall-arrangement detector + room entities
// (roadmap Phase 2). Pure geometry plus a stubbed-app entity flow.
module.exports = h => {
  const { test, ok, eq, near, loadModel } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

  function loadRoom() {
    const sandbox = { window: {}, console, Buffer };
    const ctx = vm.createContext(sandbox);
    for (const f of ['js/geometry.js', 'js/tools/base.js', 'js/model.js',
      'js/columnFamilies.js', 'js/StructuralManager.js', 'js/features/room.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
    if (!sandbox.window.RoomFeature) throw new Error('RoomFeature not exported');
    return sandbox.window;
  }
  const W = loadRoom();
  const RF = W.RoomFeature;
  const { G, Model } = W;

  // a minimal app: model + bim manager (the app.js slice) + level manager
  function stubApp() {
    const m = new Model();
    const app = {
      model: m,
      bim: null,
      levelManager: {
        levels: m.levels,
        getLevel: id => m.levels.find(l => l.id === id) || null,
        getElevation: id => { const l = m.levels.find(x => x.id === id); return l ? l.elevation : 0; },
      },
      bimOptions: { baseLevel: 'lvl_1' },
      toast() { }, setStatus() { },
      transaction: { run(label, fn) { return fn(m); } },
      view: null,
    };
    // BimEntityManager lives in app.js — inline the two behaviors rooms use
    app.bim = {
      entities: m.bimEntities,
      _hwm: {},
      create(type, params, faceRoles, edgeIds = []) {
        const prefix = type + '_';
        let max = 0;
        for (const e of this.entities)
          if (typeof e.id === 'string' && e.id.startsWith(prefix))
            max = Math.max(max, parseInt(e.id.slice(prefix.length), 10) || 0);
        const id = prefix + (max + 1);
        const ent = { id, type, params, faces: Object.keys(faceRoles).map(Number), edges: [...edgeIds], layerId: '0' };
        this.entities.push(ent);
        for (const [fid, role] of Object.entries(faceRoles)) {
          const f = m.faces.get(+fid);
          if (f) f.userData = { bimEntityId: id, bimType: type, role };
        }
        for (const eid of edgeIds) {
          const e = m.edges.get(eid);
          if (e) e.userData = { bimEntityId: id, bimType: type, role: 'profile' };
        }
        return ent;
      },
    };
    return app;
  }
  const wallSeg = (app, x1, y1, x2, y2, lvl = 'lvl_1') =>
    app.bim.entities.push({ id: 'wall_' + (app.bim.entities.length + 1), type: 'wall',
      faces: [], edges: [], params: { base: [x1, y1, 0], end: [x2, y2, 0], height: 3, thickness: 0.2, baseLevel: lvl } });

  test('facesOf: a closed square of walls yields one bounded face', () => {
    const segs = [[[0, 0], [4, 0]], [[4, 0], [4, 4]], [[4, 4], [0, 4]], [[0, 4], [0, 0]]];
    const faces = RF.facesOf(segs);
    eq(faces.length, 1, 'one bounded face');
    near(RF.ringArea(faces[0]), 16, 1e-6, 'square area');
    ok(RF.pointIn(faces[0], 2, 2), 'center inside');
    ok(!RF.pointIn(faces[0], 5, 2), 'outside stays out');
  });

  test('facesOf: a T-junction divider (endpoint ON the facade interior) splits the room', () => {
    const segs = [
      [[0, 0], [4, 0]], [[4, 0], [4, 4]], [[4, 4], [0, 4]], [[0, 4], [0, 0]],
      [[2, 0], [2, 4]], // interior partition, endpoints strictly inside edges
    ];
    const faces = RF.facesOf(segs);
    eq(faces.length, 2, 'two rooms');
    const areas = faces.map(f => RF.ringArea(f)).sort((a, b) => a - b);
    near(areas[0], 8, 1e-6, 'left room 8 m²');
    near(areas[1], 8, 1e-6, 'right room 8 m²');
  });

  test('facesOf: both diagonals split a square into four triangular rooms', () => {
    const segs = [
      [[0, 0], [4, 0]], [[4, 0], [4, 4]], [[4, 4], [0, 4]], [[0, 4], [0, 0]],
      [[0, 0], [4, 4]], [[4, 0], [0, 4]], // crossing diagonals
    ];
    const faces = RF.facesOf(segs);
    eq(faces.length, 4, 'four triangles');
    for (const f of faces) near(RF.ringArea(f), 4, 1e-6, 'each 4 m²');
    ok(faces.some(f => RF.pointIn(f, 1, 1)), 'a point in one triangle');
  });

  test('detect + makeRoom: click inside creates a stamped room entity with the right area', () => {
    const app = stubApp();
    wallSeg(app, 0, 0, 6, 0);
    wallSeg(app, 6, 0, 6, 5);
    wallSeg(app, 6, 5, 0, 5);
    wallSeg(app, 0, 5, 0, 0);
    const d = RF.detect(app, 'lvl_1', 3, 2.5);
    ok(!d.error, 'region detected');
    near(d.area, 30, 1e-3, '30 m² room');
    const r = RF.makeRoom(app, { seed: [3, 2.5, 0], levelId: 'lvl_1', department: 'Office' });
    ok(r && !r.error, 'room created');
    eq(r.type, 'room');
    near(+r.params.area, 30, 1e-3, 'params area');
    eq(r.faces.length, 1, 'one plate face');
    const f = app.model.faces.get(r.faces[0]);
    ok(f.userData && f.userData.bimEntityId === r.id, 'plate stamped to the room');
    ok(f.color, 'color-fill applied');
    ok(f.loop.length >= 4, 'plate ring has vertices');
    // duplicate refusal: the same region again
    const dup = RF.makeRoom(app, { seed: [2, 2, 0], levelId: 'lvl_1' });
    ok(dup && dup.error, 'duplicate region refused');
  });

  test('rebuildRoom: moving a wall re-detects the region from the seed', () => {
    const app = stubApp();
    wallSeg(app, 0, 0, 6, 0);
    wallSeg(app, 6, 0, 6, 5);
    wallSeg(app, 6, 5, 0, 5);
    wallSeg(app, 0, 5, 0, 0);
    const r = RF.makeRoom(app, { seed: [3, 2.5, 0], levelId: 'lvl_1' });
    ok(r && !r.error);
    // stretch the room: right wall to x=8, top AND bottom extend to meet it
    const right = app.bim.entities.find(e => e.type === 'wall' && e.params.base[0] === 6 && e.params.end[0] === 6);
    right.params.base = [8, 0, 0];
    right.params.end = [8, 5, 0];
    const top = app.bim.entities.find(e => e.type === 'wall' && e.params.base[1] === 5 && e.params.end[1] === 5);
    top.params.base = [8, 5, 0];
    const bot = app.bim.entities.find(e => e.type === 'wall' && e.params.base[1] === 0 && e.params.end[1] === 0);
    bot.params.end = [8, 0, 0];
    RF._invalidateCache();
    ok(RF.rebuildRoom(app, r), 'rebuild succeeds');
    near(+r.params.area, 40, 1e-3, 'area grows to 40 m²');
    eq(r.faces.length, 1, 'one plate after rebuild');
    ok(app.model.validate().ok, 'model valid');
  });

  test('model validate stays clean with rooms on a built model', () => {
    const app = stubApp();
    wallSeg(app, 0, 0, 5, 0);
    wallSeg(app, 5, 0, 5, 5);
    wallSeg(app, 5, 5, 0, 5);
    wallSeg(app, 0, 5, 0, 0);
    RF.makeRoom(app, { seed: [2.5, 2.5, 0], levelId: 'lvl_1' });
    ok(app.model.validate().ok, 'valid with the room plate');
  });
};
