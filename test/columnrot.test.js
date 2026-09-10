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

  test('wallPlanTrims is a v0.6 no-op — rotated columns never bite walls', () => {
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
    m.bimEntities.push(wall);
    m.bimEntities.push({ id: 'column_1', type: 'column',
      params: { base: [3 * Math.cos(ang), 3 * Math.sin(ang), 0], width: 0.3, depth: 0.6, height: 3, rotation: ang } });
    eq(app.structural.wallPlanTrims(wall.params), null,
      'v0.6: the wall runs through the rotated column, overlapping — never split');
  });

  test('end-to-end: an aligned column leaves an angled wall WHOLE (v0.6 independence)', () => {
    const m = new Model();
    m.bimEntities = [];
    const bim = new BimEntityManager(m);
    const app = { model: m, bim, toast() {}, setStatus() {},
      levelManager: { getElevation: () => 0 }, gridManager: null, structural: null };
    app.structural = new StructuralManager(() => m.levels, () => m.bimEntities);
    sandbox.window.app = app;
    const ang = 30 * Math.PI / 180;
    const A = [0, 0, 0], B = [6 * Math.cos(ang), 6 * Math.sin(ang), 0];
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
    const wallEnt = bim.create('wall', { base: [...A], end: [...B], height: 3, thickness: 0.2,
      locationLine: 'centerline', primitive: 'line', closed: false, joins: { start: 0, end: 0 } }, roles, []);
    // aligned column mid-span, through the real registry path
    const cx = 3 * Math.cos(ang), cy = 3 * Math.sin(ang);
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const pc = (lx, ly) => v(cx + lx * cs - ly * sn, cy + lx * sn + ly * cs, 0);
    const colRing = [pc(-0.15, -0.15), pc(0.15, -0.15), pc(0.15, 0.15), pc(-0.15, 0.15)];
    const b2 = new Set(m.faces.keys());
    m.bimHold = true;
    try { m.pushPull(m.addFaceFromRings(colRing), 3); } finally { m.bimHold = false; }
    const cf = [...m.faces.keys()].filter(id => !b2.has(id));
    const croles = {};
    for (const fid of cf) croles[fid] = 'side';
    bim.create('column', { base: [cx, cy, 0], width: 0.3, depth: 0.3, height: 3, rotation: ang }, croles, []);
    const walls = bim.entities.filter(e => e.type === 'wall');
    eq(walls.length, 1, 'wall stays ONE element through the column');
    ok(bim.getEntityById(wallEnt.id) === walls[0], 'identity kept');
    ok(wallEnt.faces.every(id => m.faces.has(id)), 'wall geometry untouched');
    ok(m.validate().ok, 'model valid — two independent overlapping solids');
  });
};
