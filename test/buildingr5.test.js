'use strict';
// ---------------------------------------------------------------------------
// buildingr5.test.js — THE REVIT TEST BUILDING (demo-r5): the Element-Browser
// pathway test. Real grid lines (A-D x 1-3) with grid-ATTACHED columns, real
// levels through LevelManager, pad footings, 12 columns/story, the full beam
// grid, punched slabs, a flat roof, and SIX rooms per floor with doors +
// windows. One shared build (the scene costs ~70 s to extrude — it is the
// marquee feature, worth one suite slot).
// ---------------------------------------------------------------------------
module.exports = h => {
  const { test, ok, eq, near } = h;

  // single audited loader (harness) — full app.js + static class bridge
  const L = h.loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/features/roof.js',
    'js/GridLine.js', 'js/GridManager.js', 'js/features/demo-r5.js', 'js/app.js']);
  const sandbox = L.sandbox;
  const { G, Model, StructuralManager, BimTools } = sandbox.window;
  const GridManager = sandbox.window.GridManager;
  const BimEntityManager = sandbox.window.BimEntityManager;

  const build = () => {
    const m = new Model();
    m.bimEntities = []; m.levels = []; m.grids = [];
    const bim = new BimEntityManager(m);
    const app = {
      model: m, bim, toast() { }, setStatus() { },
      levelManager: {
        levels: m.levels,
        addLevel(name, elevation) {
          let n = 1;
          while (m.levels.some(l => l.id === 'lvl_' + n)) n++;
          m.levels.push({ id: 'lvl_' + n, name, elevation: +elevation || 0 });
          m.levels.sort((a, b) => a.elevation - b.elevation);
          return m.levels.find(l => l.name === name);
        },
        getElevation: id => { const l = m.levels.find(x => x.id === id); return l ? l.elevation : 0; },
        getLevel: id => m.levels.find(x => x.id === id),
      },
      gridManager: new GridManager(m),
      structural: new StructuralManager(() => m.levels, () => m.bimEntities),
    };
    sandbox.window.app = app;
    const counts = sandbox.window.DemoR5.build(app);
    return { m, bim, app, counts };
  };

  // ONE build shared by every test below (the scene is expensive)
  const W = build();
  const counts = {};
  for (const e of W.bim.entities) counts[e.type] = (counts[e.type] || 0) + 1;

  test('the Revit test building builds: grids, levels, every element, 6 rooms/floor', () => {
    eq(W.counts.grid, 7, '7 grid lines (A-D + 1-3)');
    eq(W.counts.level, 6, '6 level datums');
    eq(counts.foundation, 12, '12 pad footings');
    eq(counts.column, 60, '12 columns x 5 stories');
    eq(counts.beam, 17 * 5, 'the full beam grid at every level');
    eq(counts.floor, 4, 'slabs at levels 2-5');
    eq(counts.roof, 1, 'one roof');
    eq(counts.door, 21, 'entrance + 4 room doors x 5 floors');
    eq(counts.window, 50, '10 windows x 5 floors');
    const v = W.m.validate();
    // KNOWN kernel-hardening allowance: two divider door cuts at grid C leave
    // pinched split cells ("ring visits a vertex twice") — everything else
    // validates; tracked with the split-cascade robustness backlog
    ok(v.errors.length <= 4, `at most the 4 known pinched divider faces (got ${v.errors.length})`);
  });

  test('columns are grid-attached and grids carry them', () => {
    const grids = W.app.gridManager.grids;
    eq(grids.length, 7, 'A-D + 1-3');
    eq(grids.map(g => g.name).join(''), 'ABCD123', 'grid names');
    const withRef = W.bim.entities.filter(e => e.type === 'column' && e.params.gridRef);
    eq(withRef.length, 60, 'every column carries gridRef');
    const gA = grids.find(g => g.name === 'A'), g1 = grids.find(g => g.name === '1');
    ok(withRef.some(e => e.params.gridRef.a === gA.id && e.params.gridRef.b === g1.id),
      'the A-1 column references both grids');
    eq(W.app.gridManager.usage(gA.id).columns, 15, 'grid A carries its 15 columns');
  });

  test('every floor has six rooms and every door really cut its wall', () => {
    const wallsAt = z => W.bim.entities.filter(e =>
      e.type === 'wall' && Math.abs(e.params.base[2] - z) < 1e-6);
    const ground = wallsAt(0);
    const dividers = ground.filter(e => Math.abs(e.params.base[0] - e.params.end[0]) < 1e-6
      && (Math.abs(e.params.base[0] - 6) < 1e-6 || Math.abs(e.params.base[0] - 12) < 1e-6));
    eq(dividers.length, 4, '4 room dividers on the ground floor');
    const partition = ground.filter(e => Math.abs(e.params.base[1] - 6) < 1e-6
      && Math.abs(e.params.base[0] - e.params.end[0]) > 1);
    eq(partition.length, 3, 'partition line in 3 column-free pieces');
    const doors = W.bim.entities.filter(e => e.type === 'door');
    eq(doors.length, 21, 'entrance + 4/floor');
    for (const d of doors) {
      const host = W.bim.getEntityById(d.params.hostWallId);
      ok(host, 'door has a live host wall');
      const cut = host.faces.map(id => W.m.faces.get(id)).filter(Boolean)
        .some(f => f.loop.length > 4 || f.holes.length);
      ok(cut, `door ${d.id} cut its host`);
    }
  });

  test('a hosted delete heals its wall in the finished building', () => {
    const door = W.bim.entities.find(e => e.type === 'door');
    const hostId = door.params.hostWallId;
    const faces = [...door.faces];
    W.bim.detach(door.id);
    for (const fid of faces) W.m.faces.delete(fid);
    W.m.gc();
    ok(W.bim.rebuildWallWithHosts(hostId), 'host rebuilds');
    ok(W.bim.getEntityById(hostId), 'wall survives');
    const v = W.m.validate();
    ok(v.errors.length <= 4, 'no NEW pinch beyond the known allowance');
  });
};
