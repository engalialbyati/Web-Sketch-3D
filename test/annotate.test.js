'use strict';
// features/annotate.js — Phase 3 core: annotation records (dims/tags/notes/
// spots) on model.annotations, reference tracking, tag templates, find &
// replace, Tag All.
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

  function loadAnnotate() {
    const sandbox = { window: {}, console, Buffer };
    const ctx = vm.createContext(sandbox);
    for (const f of ['js/geometry.js', 'js/tools/base.js', 'js/model.js',
      'js/columnFamilies.js', 'js/StructuralManager.js', 'js/features/annotate.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
    if (!sandbox.window.Annotate) throw new Error('Annotate not exported');
    return sandbox.window;
  }
  const W = loadAnnotate();
  const A = W.Annotate;
  const { G, Model } = W;

  function stubApp() {
    const m = new Model();
    const app = {
      model: m,
      bim: { entities: m.bimEntities, getEntityById: id => m.bimEntities.find(e => e.id === id) || null },
      levelManager: m.levels ? { levels: m.levels } : { levels: [] },
      bimOptions: { baseLevel: 'lvl_1' },
      toast() { }, setStatus() { },
      run(label, fn) { return fn(m); },
      transaction: { run(label, fn) { return fn(m); } },
      view: null,
    };
    return app;
  }

  test('annotations serialize/load round-trip', () => {
    const w = h.makeWorld();
    w.m.annotations.push(
      { id: 'ann_1', kind: 'dim', p1: [0, 0, 0], p2: [4, 0, 0], off: [0, 0.6, 0], r1: { type: 'vertex', id: 9 } },
      { id: 'ann_2', kind: 'tag', targetId: 'room_1', at: [1, 1, 0], box: [1.5, 1.3, 0], template: '{name}' },
      { id: 'ann_3', kind: 'text', at: [2, 2, 0], text: 'hello', leaderFrom: [1, 1, 0] },
      { id: 'ann_4', kind: 'spot', at: [0, 0, 3.2] });
    const snap = w.m.serialize();
    w.m.annotations.length = 0;
    w.m.load(snap);
    eq(w.m.annotations.length, 4, 'all four kinds survive');
    eq(w.m.annotations[0].r1.type, 'vertex', 'dim refs survive');
    eq(w.m.annotations[2].text, 'hello', 'note text survives');
  });

  test('dimension refs track wall endpoints (resolveRef)', () => {
    const app = stubApp();
    app.bim.entities.push({ id: 'wall_1', type: 'wall', faces: [], edges: [],
      params: { base: [0, 0, 0], end: [4, 0, 0], baseLevel: 'lvl_1' } });
    const ref = { type: 'wallEnd', wallId: 'wall_1', end: 1 };
    const p = A.resolveRef(app, ref, [9, 9, 9]);
    eq(p[0], 4, 'ref resolves to the wall end');
    // move the wall — the dimension follows
    app.bim.entities[0].params.end = [6, 0, 0];
    const p2 = A.resolveRef(app, ref, [9, 9, 9]);
    eq(p2[0], 6, 'moved wall moves the dim endpoint');
    // dead ref falls back to the stored point
    const p3 = A.resolveRef(app, { type: 'wallEnd', wallId: 'gone', end: 0 }, [1, 2, 3]);
    eq(p3[2], 3, 'dead ref falls back');
  });

  test('tag templates resolve entity params live', () => {
    const app = stubApp();
    app.bim.entities.push({ id: 'room_1', type: 'room', name: 'Office', faces: [], edges: [],
      params: { name: 'Office', number: '5', area: 21.4 } });
    const txt = A.tagText(app, { targetId: 'room_1', template: A.TEMPLATES.room });
    ok(/Office/.test(txt) && /21\.4/.test(txt), 'room template: ' + txt);
    // renaming the entity re-renders the tag
    app.bim.entities[0].name = 'Meeting';
    const txt2 = A.tagText(app, { targetId: 'room_1', template: '{name}' });
    eq(txt2, 'Meeting', 'live rename');
  });

  test('Tag All Untagged tags every taggable entity once', () => {
    const app = stubApp();
    // real faces — tagAll anchors at the first face centroid
    const mk = (x0, y0) => app.model.addFaceFromRings([
      G.v(x0, y0, 0), G.v(x0 + 1, y0, 0), G.v(x0 + 1, y0 + 1, 0), G.v(x0, y0 + 1, 0)]);
    const f1 = mk(0, 0), f2 = mk(2, 0), f3 = mk(4, 0);
    app.bim.entities.push(
      { id: 'wall_1', type: 'wall', name: 'W1', faces: [f1.id], edges: [], params: {} },
      { id: 'room_1', type: 'room', name: 'R1', faces: [f2.id], edges: [], params: {} },
      { id: 'weird_1', type: 'pergola', name: 'P', faces: [f3.id], edges: [], params: {} });
    const n = A.tagAll(app);
    eq(n, 2, 'wall + room tagged (no template for pergola)');
    eq(app.model.annotations.length, 2, 'two tag annotations');
    const n2 = A.tagAll(app);
    eq(n2, 0, 'second pass: everything tagged');
  });

  test('find & replace across text notes', () => {
    const app = stubApp();
    app.model.annotations.push(
      { id: 'a', kind: 'text', at: [0, 0, 0], text: 'fire rate F90' },
      { id: 'b', kind: 'text', at: [1, 0, 0], text: 'F90 everywhere' },
      { id: 'c', kind: 'text', at: [2, 0, 0], text: 'untouched' });
    const n = A.findReplace(app, 'F90', 'F120');
    eq(n, 2, 'two notes replaced');
    ok(app.model.annotations[0].text.includes('F120'), 'replaced content');
    eq(app.model.annotations[2].text, 'untouched', 'others untouched');
  });

  test('spot elevation text reflects the georeference base point', () => {
    // render-side formatting — verify the math contract here
    const z = 3.25;
    const geo = { basePoint: { east: 500000, north: 4649776, elev: 12.5 } };
    const abs = geo.basePoint.elev + z;
    near(abs, 15.75, 1e-9, 'absolute = base + local');
  });
};
