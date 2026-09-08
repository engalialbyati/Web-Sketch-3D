'use strict';
// ---------------------------------------------------------------------------
// centerline.test.js — HIDDEN CENTERLINES: the parametric axis of every
// wall / beam / column is a snap target (pure inference, never drawn).
// The owner's case: a 200 mm wall with NO grid line — a column clicked
// near it lands at exactly the 100 mm center.
// Drives the real BimEntityManager._centerlineSnap with a stubbed view.
// ---------------------------------------------------------------------------
module.exports = h => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { test, ok, eq, near } = h;

  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const sandbox = { window: {}, console };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/geometry.js', 'js/model.js']) vm.runInContext(read(f), ctx, { filename: f });
  const appSrc = read('js/app.js');
  const s0 = appSrc.indexOf('class BimEntityManager {');
  const s1 = appSrc.indexOf('\nclass App {');
  if (s0 < 0 || s1 <= s0) throw new Error('could not slice BimEntityManager from app.js');
  vm.runInContext(appSrc.slice(s0, s1), ctx, { filename: 'app.js#BimEntityManager' });
  const { G, Model } = sandbox.window;
  const BimEntityManager = vm.runInContext('BimEntityManager', ctx);

  const makeWorld = () => {
    const m = new Model();
    m.bimEntities = [];
    return { m, bim: new BimEntityManager(m) };
  };
  // a straight-down cursor ray at world (cx, cy) + a flat screen projection
  const ray = (cx, cy) => ({
    q: { x: cx * 100, y: 500 - cy * 100 },
    ro: G.v(cx, cy, 50), rd: G.v(0, 0, -1),
  });
  const view = { worldToScreenPixels: p => ({ x: p.x * 100, y: 500 - p.y * 100, visible: true }) };

  test('a 200 mm wall: a column clicked 50 mm off-center snaps to the 100 mm centerline', () => {
    const w = makeWorld();
    w.bim.entities.push({ id: 'wall_1', type: 'wall',
      params: { base: [0, 0, 0], end: [6, 0, 0], thickness: 0.2, closed: false } });
    const { q, ro, rd } = ray(3, 0.05); // 50 mm off the axis, mid-span
    const snap = w.bim._centerlineSnap(q, ro, rd, view);
    ok(snap, 'snap engaged');
    eq(snap.kind, 'centerline', 'kind');
    ok(/Wall wall_1 centerline/.test(snap.label), 'label names the wall: ' + snap.label);
    near(snap.p.x, 3, 1e-9, 'x stays at the cursor station');
    near(snap.p.y, 0, 1e-9, 'y snapped to the centerline (100 mm from either face)');
  });

  test('a cursor far off the wall does not snap', () => {
    const w = makeWorld();
    w.bim.entities.push({ id: 'wall_1', type: 'wall',
      params: { base: [0, 0, 0], end: [6, 0, 0], thickness: 0.2, closed: false } });
    const { q, ro, rd } = ray(3, 1.0); // a meter away in plan
    eq(w.bim._centerlineSnap(q, ro, rd, view), null, 'out of the pixel reach');
  });

  test('column centers and beam baselines snap the same way', () => {
    const w = makeWorld();
    w.bim.entities.push({ id: 'column_1', type: 'column', params: { base: [2, 2, 0] } });
    w.bim.entities.push({ id: 'beam_1', type: 'beam',
      params: { baseline: [[1, 4, 3], [5, 4, 3]] } });
    let { q, ro, rd } = ray(2.03, 2.01);
    let s = w.bim._centerlineSnap(q, ro, rd, view);
    ok(s && /Column column_1/.test(s.label), 'column center label');
    near(s.p.x, 2, 1e-9); near(s.p.y, 2, 1e-9);
    ({ q, ro, rd } = ray(3, 4.04));
    s = w.bim._centerlineSnap(q, ro, rd, view);
    ok(s && /Beam beam_1/.test(s.label), 'beam centerline label');
    near(s.p.x, 3, 1e-9); near(s.p.y, 4, 1e-9); near(s.p.z, 3, 1e-9, 'beam z carried');
  });

  test('the snap clamps to the wall ends — never past the axis', () => {
    const w = makeWorld();
    w.bim.entities.push({ id: 'wall_1', type: 'wall',
      params: { base: [0, 0, 0], end: [6, 0, 0], thickness: 0.2, closed: false } });
    const { q, ro, rd } = ray(6.05, 0.03); // just past the end, still in reach
    const s = w.bim._centerlineSnap(q, ro, rd, view);
    ok(s, 'snap engaged');
    near(s.p.x, 6, 1e-9, 'clamped at the wall end — the axis never extends past it');
  });
};
