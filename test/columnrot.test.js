'use strict';
// ---------------------------------------------------------------------------
// columnrot.test.js — COLUMN PLAN ROTATION:
//   "draw an element at a defined angle or parallel to the element drawn on"
// A column aligned with its host wall cuts the wall SQUARE — the wedge
// slivers at the junction of an axis-fixed box and an angled run are gone.
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
  if (s0 < 0 || s1 <= s0) throw new Error('could not slice BimEntityManager from app.js');
  vm.runInContext(appSrc.slice(s0, s1), ctx, { filename: 'app.js#BimEntityManager' });
  const { G, Model, BimTools, StructuralManager, ColumnFeature } = sandbox.window;
  const WallTool = BimTools.WallTool;
  const BimEntityManager = vm.runInContext('BimEntityManager', ctx);
  const v = (x, y, z = 0) => G.v(x, y, z);

  test('placeColumn rotates the footprint about its center', () => {
    const m = new Model();
    const faces = ColumnFeature.placeColumn(G, m, { x: 5, y: 5, z: 0 }, 0.4, 0.2, 3, Math.PI / 4);
    ok(faces && faces.length >= 6, 'column built: ' + (faces ? faces.length : 0));
    // the bottom ring's corner (+w/2,+d/2) rotated 45°: (0.0707, 0.2121)
    const pts = [];
    for (const f of m.faces.values()) {
      const c = m.faceCentroid(f);
      if (Math.abs(c.z) < 1e-6) for (const id of f.loop) pts.push(m.vp(id));
    }
    const k = Math.SQRT1_2;
    const want = [[0.2 * k - 0.1 * k, 0.2 * k + 0.1 * k], [0.2 * k + 0.1 * k, 0.2 * k - 0.1 * k],
      [-0.2 * k + 0.1 * k, -0.2 * k - 0.1 * k], [-0.2 * k - 0.1 * k, -0.2 * k + 0.1 * k]];
    for (const [dx, dy] of want)
      ok(pts.some(p => Math.hypot(p.x - 5 - dx, p.y - 5 - dy) < 1e-4), `rotated corner (${dx.toFixed(3)}, ${dy.toFixed(3)}) present`);
    ok(!pts.some(p => Math.abs(p.x - 5.2) < 1e-9 && Math.abs(p.y - 5.1) < 1e-9), 'axis-aligned corner gone');
  });

  test('wallPlanTrims uses the ROTATED footprint (aligned column bites exactly its width)', () => {
    const m = new Model();
    m.bimEntities = [];
    const bim = new BimEntityManager(m);
    const app = { model: m, bim, toast() {}, setStatus() {},
      levelManager: { getElevation: () => 0 }, gridManager: null, structural: null };
    app.structural = new StructuralManager(() => m.levels, () => m.bimEntities);
    sandbox.window.app = app;
    const ang = 30 * Math.PI / 180;
    const wall = { id: 'wall_1', type: 'wall',
      params: { base: [0, 0, 0], end: [6 * Math.cos(ang), 6 * Math.sin(ang), 0], thickness: 0.2, closed: false } };
    const mkCol = rot => ({ id: 'column_1', type: 'column',
      params: { base: [3 * Math.cos(ang), 3 * Math.sin(ang), 0], width: 0.3, depth: 0.6, height: 3, rotation: rot } });
    m.bimEntities.push(wall);
    m.bimEntities.push(mkCol(ang));           // ALIGNED: width axis along the run
    const tAligned = app.structural.wallPlanTrims(wall.params);
    m.bimEntities.pop();
    m.bimEntities.push(mkCol(0));             // axis-fixed
    const tFixed = app.structural.wallPlanTrims(wall.params);
    ok(tAligned && tFixed, 'both trim');
    const wAligned = tAligned.intervals[0].t1 - tAligned.intervals[0].t0;
    const wFixed = tFixed.intervals[0].t1 - tFixed.intervals[0].t0;
    near(wAligned, 0.3 + 2e-3, 5e-3, 'aligned bite = column width (square cut)');
    ok(wFixed > wAligned + 0.1, 'axis-fixed bites wider (the wedge): ' + wFixed.toFixed(3));
  });

  test('end-to-end: an aligned column splits an angled wall with NO wedge edges', () => {
    const m = new Model();
    m.bimEntities = [];
    const bim = new BimEntityManager(m);
    const app = { model: m, bim, toast() {}, setStatus() {},
      levelManager: { getElevation: () => 0 }, gridManager: null, structural: null };
    app.structural = new StructuralManager(() => m.levels, () => m.bimEntities);
    sandbox.window.app = app;
    const ang = 30 * Math.PI / 180;
    const A = [0, 0, 0], B = [6 * Math.cos(ang), 6 * Math.sin(ang), 0];
    // wall through the real band + registry
    const ring = WallTool.bandRing(G, [v(...A), v(...B)], 0.2, 'centerline');
    const before = new Set(m.faces.keys());
    const f0 = m.addFaceFromRings(ring.map(q => G.clone(q)));
    m.pushPull(f0, 3);
    const faces = [...m.faces.keys()].filter(id => !before.has(id));
    const roles = {};
    for (const fid of faces) {
      const c = m.faceCentroid(m.faces.get(fid));
      roles[fid] = Math.abs(c.z - 3) < 1e-6 ? 'top' : Math.abs(c.z) < 1e-6 ? 'bottom' : 'side';
    }
    bim.create('wall', { base: [...A], end: [...B], height: 3, thickness: 0.2,
      locationLine: 'centerline', primitive: 'line', closed: false, joins: { start: 0, end: 0 } }, roles, []);
    // aligned column mid-span, through the real registry path
    const cx = 3 * Math.cos(ang), cy = 3 * Math.sin(ang);
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const pc = (lx, ly) => v(cx + lx * cs - ly * sn, cy + lx * sn + ly * cs, 0);
    const colRing = [pc(-0.15, -0.15), pc(0.15, -0.15), pc(0.15, 0.15), pc(-0.15, 0.15)];
    const b2 = new Set(m.faces.keys());
    const fc = m.addFaceFromRings(colRing);
    m.pushPull(fc, 3);
    const cf = [...m.faces.keys()].filter(id => !b2.has(id));
    const croles = {};
    for (const fid of cf) {
      const c = m.faceCentroid(m.faces.get(fid));
      croles[fid] = Math.abs(c.z - 3) < 1e-6 ? 'top' : Math.abs(c.z) < 1e-6 ? 'bottom' : 'side';
    }
    bim.create('column', { base: [cx, cy, 0], width: 0.3, depth: 0.3, height: 3, rotation: ang }, croles, []);
    for (const id of [...bim._hostsDirty]) { const e = bim.getEntityById(id); if (e) bim.planTrimWall(id); }
    bim._hostsDirty.clear();

    const walls = bim.entities.filter(e => e.type === 'wall');
    eq(walls.length, 2, 'wall split into two pieces');
    // every bottom-ring edge of the pieces is parallel or perpendicular to
    // the run — the axis-fixed box used to leave diagonal wedges here
    let diagonals = 0;
    for (const w2 of walls) {
      for (const fid of w2.faces) {
        const f2 = m.faces.get(fid);
        if (!f2) continue;
        const c = m.faceCentroid(f2);
        if (Math.abs(c.z) > 1e-6) continue; // ground ring only
        for (let i = 0; i < f2.loop.length; i++) {
          const pa = m.vp(f2.loop[i]), pb = m.vp(f2.loop[(i + 1) % f2.loop.length]);
          const e = Math.atan2(pb.y - pa.y, pb.x - pa.x);
          let rel = Math.abs((e - ang) % (Math.PI / 2));
          rel = Math.min(rel, Math.PI / 2 - rel);
          if (rel > 1e-3) diagonals++;
        }
      }
    }
    eq(diagonals, 0, 'no wedge edges — the junction is square');
    ok(m.validate().ok, 'model valid');
  });
};
