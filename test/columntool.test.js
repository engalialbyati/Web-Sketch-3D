'use strict';
// ---------------------------------------------------------------------------
// columntool.test.js — the Column tool's LEVEL-DRIVEN placement:
//   1. Base Level 2 + a click on EMPTY GROUND bases the column ON Level 2
//      (a ground pick is x/y only — it must not become a −3 m baseOffset)
//   2. a click on REAL GEOMETRY (a face/endpoint) supplies the offset
//   3. the options strip's Unconnected Height owns the height
// ---------------------------------------------------------------------------
module.exports = h => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { test, ok, eq, near } = h;

  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const sandbox = { window: {}, console };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/geometry.js', 'js/model.js', 'js/StructuralManager.js',
    'js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/features/column.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const appSrc = read('js/app.js');
  const s0 = appSrc.indexOf('class BimEntityManager {');
  const s1 = appSrc.indexOf('\nclass App {');
  vm.runInContext(appSrc.slice(s0, s1), ctx, { filename: 'bem' });

  const { G, Model, ColumnFeature } = sandbox.window;
  const BimEntityManager = vm.runInContext('BimEntityManager', ctx);
  const StructuralManager = sandbox.window.StructuralManager;

  const makeWorld = (baseLevel, unconnectedHeight) => {
    const m = new Model();
    m.bimEntities = [];
    m.levels = [{ id: 'lvl1', name: 'Level 1', elevation: 0 }, { id: 'lvl2', name: 'Level 2', elevation: 3 }];
    const bim = new BimEntityManager(m);
    const toasts = [];
    const app = {
      model: m, bim, toasts,
      toast(msg) { toasts.push(String(msg)); },
      setStatus() { },
      view: new Proxy({}, { get: () => () => { } }),
      levelManager: {
        levels: m.levels,
        getElevation: id => (m.levels.find(l => l.id === id) || { elevation: 0 }).elevation,
        getLevel: id => m.levels.find(l => l.id === id),
      },
      gridManager: null,
      bimOptions: { baseLevel, topConstraint: 'unconnected', unconnectedHeight },
      transaction: {
        begin() { return { commit() { }, rollback() { }, rolledBack: false }; },
        run(label, fn) { return fn(m); },
      },
    };
    app.structural = StructuralManager.attach(app);
    const tool = Object.create(ColumnFeature.ColumnTool.prototype);
    tool.app = app;
    tool.state = { family: 'rect', width: 0.3, depth: 0.3, height: 3.0 };
    // stubbed pointer inference: the tool only consumes p + kind
    let pick = { p: { x: 2, y: 2, z: 0 }, kind: 'ground' };
    app.inferPoint = () => ({ ...pick });
    tool._setPick = (p, kind) => { pick = { p, kind }; };
    return { m, bim, app, tool, toasts, pickOf: () => pick };
  };
  const place = w => w.tool.onDown({ button: 0 });
  const lastCol = w => w.bim.entities.filter(e => e.type === 'column').pop();

  test('base level 2 + empty-ground click bases the column ON Level 2', () => {
    const w = makeWorld('lvl2', 3);
    w.tool._setPick({ x: 2, y: 2, z: 0 }, 'ground'); // ground = z 0
    place(w);
    const col = lastCol(w);
    ok(col, 'column placed');
    eq(col.params.baseLevelId, 'lvl2', 'base level recorded');
    near(col.params.baseOffset, 0, 1e-9, 'ground pick contributes NO offset');
    const cb = w.app.structural.columnBounds(col.params);
    near(cb.zStart, 3, 1e-9, 'column stands on Level 2 (z=3), not Level 1');
    near(cb.zEnd, 6, 1e-9);
    ok(w.m.validate().ok, 'model valid');
  });

  test('a pick on real geometry (slab top) supplies the base offset', () => {
    const w = makeWorld('lvl2', 3);
    w.tool._setPick({ x: 2, y: 2, z: 3.2 }, 'face'); // slab top +0.2 over L2
    place(w);
    const col = lastCol(w);
    near(col.params.baseOffset, 0.2, 1e-9, 'on-face pick becomes +0.2 m');
    const cb = w.app.structural.columnBounds(col.params);
    near(cb.zStart, 3.2, 1e-9);
  });

  test('the options strip Unconnected Height owns the height', () => {
    const w = makeWorld('lvl1', 4.5);
    w.tool._setPick({ x: 1, y: 1, z: 0 }, 'ground');
    place(w);
    const col = lastCol(w);
    const cb = w.app.structural.columnBounds(col.params);
    near(cb.height, 4.5, 1e-9, 'height follows Unconnected Height (not the old feature field)');
    near(cb.zEnd, 4.5, 1e-9);
  });

  test('top constraint to Level 2 wins over the unconnected height', () => {
    const w = makeWorld('lvl1', 9);
    w.app.bimOptions.topConstraint = 'lvl2';
    w.tool._setPick({ x: 1, y: 1, z: 0 }, 'ground');
    place(w);
    const col = lastCol(w);
    const cb = w.app.structural.columnBounds(col.params);
    near(cb.height, 3, 1e-9, 'lvl1 -> lvl2 is 3 m regardless of the 9 m unconnected value');
  });
};
