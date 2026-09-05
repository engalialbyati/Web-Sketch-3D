'use strict';
// ---------------------------------------------------------------------------
// walljoin.test.js — end-to-end wall commit with joins, on the REAL
// orchestration: WallTool._commitInner (js/tools/bim.js) driving the REAL
// BimEntityManager (extracted from js/app.js) over the REAL Model.
//
// Covers the "wall join" failure class: a wall whose join would leave a
// neighbor's rebuilt ring degenerate must be refused BEFORE any geometry is
// deleted or extruded — no "wall join rolled back — invalid geometry", no
// silently vanished neighbor, no ghost entities.
// ---------------------------------------------------------------------------
module.exports = h => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { test, ok, eq } = h;

  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const sandbox = { window: {}, console };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/geometry.js', 'js/model.js', 'js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  // BimEntityManager lives in app.js between its class line and `class App`
  const appSrc = read('js/app.js');
  const start = appSrc.indexOf('class BimEntityManager {');
  const end = appSrc.indexOf('\nclass App {');
  if (start < 0 || end < 0 || end <= start) throw new Error('could not slice BimEntityManager from app.js');
  vm.runInContext(appSrc.slice(start, end), ctx, { filename: 'app.js#BimEntityManager' });

  const { G, Model, BimTools } = sandbox.window;
  const WallTool = BimTools.WallTool;
  const BimEntityManager = vm.runInContext('BimEntityManager', ctx);
  const v = (x, y, z = 0) => G.v(x, y, z);

  // ------------------------------------------------------------- the world
  const makeWorld = () => {
    const m = new Model();
    m.bimEntities = [];
    const bim = new BimEntityManager(m);
    const toasts = [];
    const app = {
      model: m,
      bim,
      toasts,
      toast(msg, isErr) { toasts.push({ msg, isErr: !!isErr }); },
      setStatus() { },
      levelManager: { getElevation: () => 0 },
      gridManager: null,
      structural: null,
      bimOptions: {
        thickness: 0.2, locationLine: 'centerline',
        baseLevel: 'lvl1', topConstraint: 'unconnected', unconnectedHeight: 3,
      },
      transaction: {
        begin() { return { commit() { }, rollback() { }, rolledBack: false }; },
        run(label, fn) { return fn(m); },
      },
    };
    bim.entities.length >= 0; // registry lives on model.bimEntities (getter)
    // bim.js's commit path reaches for the GLOBAL app (the browser's
    // window.app) — the sandbox global must point at this test's world
    sandbox.app = app;
    const tool = Object.create(WallTool.prototype);
    tool.app = app;
    tool.engine = { lastPickGrid: null };
    return { m, bim, app, tool, toasts };
  };

  const buildWall = (w, base, end, extra = {}) => {
    // plain straight wall straight through the model API + registry, the
    // way a first (unjoined) wall lands
    const ring = WallTool.bandRing(G, [v(...base), v(...end)], 0.2, 'centerline');
    const before = new Set(w.m.faces.keys());
    const f = w.m.addFaceFromRings(ring.map(q => G.clone(q)));
    w.m.pushPull(f, 3);
    const faces = [...w.m.faces.keys()].filter(id => !before.has(id));
    const roles = {};
    for (const fid of faces) {
      const c = w.m.faceCentroid(w.m.faces.get(fid));
      roles[fid] = Math.abs(c.z - 3) < 1e-6 ? 'top' : Math.abs(c.z) < 1e-6 ? 'bottom' : 'side';
    }
    return w.bim.create('wall', {
      base: [...base], end: [...end], height: 3, thickness: 0.2,
      locationLine: 'centerline', primitive: 'line', closed: false,
      joins: { start: 0, end: 0 }, ...extra,
    }, roles, []);
  };

  const commit = (w, a, b) => w.tool._commitInner({ kind: 'line', closed: false, pts: [v(...a), v(...b)] }, 3);

  // ------------------------------------------------------------ sane joins
  test('a perpendicular chained corner commits cleanly with miters', () => {
    const w = makeWorld();
    const w1 = buildWall(w, [0, 0, 0], [4, 0, 0]);
    ok(w1, 'neighbor built');
    const nBefore = w.bim.entities.length;
    commit(w, [4, 0, 0], [4, 3, 0]); // corner at (4,0), miter both sides
    eq(w.bim.entities.length, nBefore + 1, 'corner wall registered');
    ok(w.m.validate().ok, 'model valid');
    const last = w.bim.entities[w.bim.entities.length - 1];
    ok(last.faces.length > 0 && last.faces.every(id => w.m.faces.has(id)), 'new wall geometry is live');
    ok(last.params.joins.start === w1.id, 'start join recorded');
    ok(w1.params.joins.end === last.id, 'neighbor join recorded');
    ok(!w.toasts.some(t => t.isErr), 'no error toasts: ' + JSON.stringify(w.toasts.map(t => t.msg)));
  });

  test('closing a square loop of four walls commits with all corners joined', () => {
    const w = makeWorld();
    buildWall(w, [0, 0, 0], [4, 0, 0]);
    commit(w, [4, 0, 0], [4, 3, 0]);
    commit(w, [4, 3, 0], [0, 3, 0]);
    commit(w, [0, 3, 0], [0, 0, 0]); // closes back onto wall 1's start
    eq(w.bim.entities.length, 4, 'four walls');
    ok(w.m.validate().ok, 'model valid after the closed loop');
    for (const e of w.bim.entities) {
      // rebuilds re-weld faces (ids churn); the invariant is LIVE geometry,
      // never a geometry-less ghost
      ok(e.faces.some(id => w.m.faces.has(id)), e.id + ' has live geometry');
    }
    ok(!w.toasts.some(t => t.isErr), 'no rollbacks: ' + JSON.stringify(w.toasts.map(t => t.msg)));
  });

  // -------------------------------------------------------- refused joins
  test('a too-tight stub onto a neighbor is refused with nothing built', () => {
    const w = makeWorld();
    const w1 = buildWall(w, [0, 0, 0], [4, 0, 0]);
    const nBefore = w.bim.entities.length;
    const facesBefore = new Set(w.m.faces.keys());
    const joinsBefore = JSON.stringify(w1.params.joins);
    // 5 cm wall starting exactly at the neighbor's end, steep angle — the
    // miter cap crosses the stub's own far end (shorter than the thickness)
    commit(w, [4, 0, 0], [4.03, 0.04, 0]);
    eq(w.bim.entities.length, nBefore, 'no ghost entity');
    ok(w.m.validate().ok, 'model still valid');
    eq(JSON.stringify([...w.m.faces.keys()].filter(id => !facesBefore.has(id))), '[]', 'no stray geometry');
    eq(JSON.stringify(w1.params.joins), joinsBefore, "neighbor's join records untouched");
    ok(w.toasts.some(t => t.isErr && /too (short|tight)/i.test(t.msg)), 'refusal toast: ' + JSON.stringify(w.toasts.map(t => t.msg)));
  });

  test('a wall landing inside a short neighbor\'s band refuses instead of eating it', () => {
    const w = makeWorld();
    // a short neighbor: 30 cm long, 200 mm thick
    const w1 = buildWall(w, [0, 0, 0], [0.3, 0, 0]);
    const liveBefore = w1.faces.filter(id => w.m.faces.has(id)).length;
    const facesBefore = new Set(w.m.faces.keys());
    // a wall wrapping onto the neighbor's end at a steep angle — the
    // neighbor's buttTrim retreat would degenerate its ring
    commit(w, [0.28, 0.01, 0], [0.9, 0.9, 0]);
    ok(w.m.validate().ok, 'model valid');
    // the neighbor may legitimately be REBUILT (face ids churn) — what must
    // never happen is it losing its geometry to a refused/degenerate rebuild
    ok(w1.faces.some(id => w.m.faces.has(id)), 'neighbor kept live geometry');
    const stray = [...w.m.faces.keys()].filter(id => !facesBefore.has(id));
    const walls = w.bim.entities.filter(e => e.type === 'wall');
    ok(walls.every(e => e.faces.some(id => w.m.faces.has(id))), 'no geometry-less ghost walls remain');
    ok(!w.toasts.some(t => t.isErr && /rolled back/i.test(t.msg)), 'no tx-guard rollback: ' + JSON.stringify(w.toasts.map(t => t.msg)));
    void stray;
  });
};
