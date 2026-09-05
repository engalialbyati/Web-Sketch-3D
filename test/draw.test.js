'use strict';
// DrawGeom pure geometry for the DrawPrimitiveEngine (tools/draw.js).
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const { G } = loadModelExtra();
  function loadModelExtra() {
    const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
    const sandbox = { window: {}, console };
    const ctx = vm.createContext(sandbox);
    for (const f of ['js/geometry.js', 'js/tools/base.js', 'js/tools/draw.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
    sandbox.window.SketchValidator = sandbox.window.SketchValidator; return { G: sandbox.window.G, DG: sandbox.window.DrawGeom, SV: sandbox.window.SketchValidator };
  }
  const extra = loadModelExtra(); const DG = extra.DG; const SketchValidator = extra.SV;
  const { G: Gi } = { G };
  const G2 = G;

  test('inscribed polygon vertices sit on the radius circle', () => {
    const c = G2.v(0, 0, 0);
    const ring = DG.polygonRing(G2, c, 2, 6, 0, 'inscribed');
    eq(ring.length, 6, 'six sides');
    for (const p of ring) near(G2.dist(c, p), 2, 1e-9, 'vertex on circle');
    near(G2.dist(ring[0], ring[1]), 2, 1e-9, 'regular hexagon side = radius');
  });

  test('circumscribed polygon edges are tangent to the radius circle', () => {
    const c = G2.v(1, 1, 0);
    const ring = DG.polygonRing(G2, c, 1, 4, 0, 'circumscribed');
    // apothem (center-to-edge distance) must equal the dragged radius
    for (let i = 0; i < 4; i++) {
      const a = ring[i], b = ring[(i + 1) % 4];
      const mid = G2.mul(G2.add(a, b), 0.5);
      near(G2.dist(c, mid), 1, 1e-9, 'edge tangent');
    }
  });

  test('location offset: centerline 0, exterior +t/2 N, interior -t/2 N', () => {
    const p1 = G2.v(0, 0, 0), p2 = G2.v(4, 0, 0); // direction +x -> N = +y
    eq(DG.locationOffset(G2, p1, p2, 'centerline', 0.2).y, 0, 'centerline zero');
    near(DG.locationOffset(G2, p1, p2, 'exterior', 0.2).y, 0.1, 1e-12, 'exterior +t/2');
    near(DG.locationOffset(G2, p1, p2, 'interior', 0.2).y, -0.1, 1e-12, 'interior -t/2');
    // spec normal form: N = (-D_y, D_x, 0) normalized
    const N = DG.locationOffset(G2, p1, p2, 'exterior', 2);
    near(N.x, 0, 1e-12, 'N has no x for a +x segment');
    near(N.y, 1, 1e-12, 'N = +y for a +x segment');
  });

  test('parallel offset miters corners (square grows by the offset)', () => {
    const sq = [G2.v(0, 0, 0), G2.v(1, 0, 0), G2.v(1, 1, 0), G2.v(0, 1, 0)];
    const out = DG.parallelOffset(G2, sq, true, 0.5); // CCW ring -> outward
    const xs = out.map(p => p.x), ys = out.map(p => p.y);
    near(Math.min(...xs), -0.5, 1e-9, 'grew left');
    near(Math.max(...xs), 1.5, 1e-9, 'grew right');
    near(Math.min(...ys), -0.5, 1e-9, 'grew down');
    near(Math.max(...ys), 1.5, 1e-9, 'grew up');
  });

  test('parallel offset shifts an open segment along its normal', () => {
    const seg = [G2.v(0, 0, 0), G2.v(2, 0, 0)];
    const out = DG.parallelOffset(G2, seg, false, 0.25);
    near(out[0].y, 0.25, 1e-12, 'left shift is +y');
    near(out[1].y, 0.25, 1e-12, 'both ends shifted');
  });

  test('arc through three points: endpoints hit, midpoint on the arc', () => {
    const a = G2.v(-1, 0, 0), b = G2.v(1, 0, 0), mid = G2.v(0, 1, 0);
    const arc = DG.arcThrough(G2, a, b, mid);
    ok(arc, 'arc exists');
    near(G2.dist(arc.pts[0], a), 0, 1e-9, 'starts at start');
    near(G2.dist(arc.pts[arc.pts.length - 1], b), 0, 1e-9, 'ends at end');
    const m = arc.pts[Math.floor(arc.pts.length / 2)];
    near(G2.dist(m, G2.v(0, 1, 0)), 0, 0.07, "mid passes through the bulge");
    near(arc.radius, 1, 1e-9, 'unit circle through +-1 and (0,1)');
  });

  test('arc center-ends sweeps the short way with the typed radius', () => {
    const arc = DG.arcSweep(G2, G2.v(0, 0, 0), 2, 0, Math.PI / 2, 1);
    near(arc.pts.length > 2 ? G2.dist(arc.pts[0], G2.v(2, 0, 0)) : -1, 0, 1e-9, 'starts on +x');
    near(G2.dist(arc.pts[arc.pts.length - 1], G2.v(0, 2, 0)), 0, 1e-9, 'ends on +y');
    near(arc.span, Math.PI / 2, 1e-9, 'quarter sweep');
  });

  test('fillet corner: tangent points and center for a right angle', () => {
    const corner = G2.v(0, 0, 0), pA = G2.v(2, 0, 0), pB = G2.v(0, 2, 0);
    const f = DG.filletCorner(G2, corner, pA, pB, 0.5);
    ok(f, 'fillet exists');
    near(f.d, 0.5, 1e-9, 'tangent distance r/tan(45°) = r');
    near(f.t1.x, 0.5, 1e-9, 't1 on the x edge');
    near(f.t2.y, 0.5, 1e-9, 't2 on the y edge');
    near(f.center.x, 0.5, 1e-9, 'center at (r, r)');
    near(f.center.y, 0.5, 1e-9, 'center at (r, r)');
    // arc endpoints coincide with the tangent points
    near(G2.dist(f.pts[0], f.t1), 0, 1e-9, 'arc starts at t1');
    near(G2.dist(f.pts[f.pts.length - 1], f.t2), 0, 1e-9, 'arc ends at t2');
  });

  test('fillet refuses radii larger than the edges allow', () => {
    const f = DG.filletCorner(G2, G2.v(0, 0, 0), G2.v(0.2, 0, 0), G2.v(0, 2, 0), 0.5);
    eq(f, null, 'edge too short for the tangent distance');
  });

  test('corner from two edges: intersection and far endpoints', () => {
    const c = DG.cornerFromEdges(G2,
      G2.v(-1, 0, 0), G2.v(1, 0, 0),   // x-axis edge
      G2.v(0, -1, 0), G2.v(0, 1, 0));  // y-axis edge
    ok(c, 'edges cross');
    near(c.corner.x, 0, 1e-9, 'corner at origin');
    near(c.pA.x, 1, 1e-9, 'far end of edge A');
    near(c.pB.y, 1, 1e-9, 'far end of edge B');
    eq(DG.cornerFromEdges(G2, G2.v(0, 0, 0), G2.v(1, 0, 0), G2.v(0, 1, 0), G2.v(1, 1, 0)), null, 'parallel edges');
  });

  test('sketch validator: open loop fails with the dangling endpoint', () => {
    const v = SketchValidator.validate([
      { pts: [G2.v(0,0,0), G2.v(3,0,0), G2.v(3,3,0), G2.v(0,3,0)], closed: false }, // not closed
    ]);
    eq(v.ok, false, 'rejected');
    eq(v.error.kind, 'open', 'open-loop error');
    eq(v.error.msg, 'Lines must be in closed loops', 'banner text');
    ok(v.error.p, 'error vertex reported');
  });

  test('sketch validator: crossing lines fail', () => {
    const v = SketchValidator.validate([
      { pts: [G2.v(0,0,0), G2.v(4,4,0), G2.v(4,0,0), G2.v(0,4,0)], closed: true }, // bowtie
    ]);
    eq(v.ok, false, 'rejected');
    eq(v.error.msg, 'Lines cannot intersect', 'banner text');
  });

  test('sketch validator: contained loop becomes an opening (stairwell)', () => {
    const v = SketchValidator.validate([
      { pts: [G2.v(0,0,0), G2.v(6,0,0), G2.v(6,4,0), G2.v(0,4,0)], closed: true },
      { pts: [G2.v(2,1,0), G2.v(4,1,0), G2.v(4,3,0), G2.v(2,3,0)], closed: true },
    ]);
    eq(v.ok, true, 'valid');
    eq(v.regions.length, 1, 'one region');
    eq(v.regions[0].holes.length, 1, 'inner loop is an opening');
    ok(v.regions[0].holes[0].every(p => p.x >= 2 && p.x <= 4), 'hole geometry preserved');
  });

  test('sketch validator: disjoint loops form two regions; chained segments weld', () => {
    const v = SketchValidator.validate([
      { pts: [G2.v(0,0,0), G2.v(2,0,0), G2.v(2,2,0), G2.v(0,2,0)], closed: true },
      { pts: [G2.v(5,0,0), G2.v(7,0,0)], closed: false },
      { pts: [G2.v(7,0,0), G2.v(7,2,0), G2.v(5,2,0), G2.v(5,0,0)], closed: false }, // chains onto the previous
    ]);
    eq(v.ok, true, 'welded into closed loops');
    eq(v.regions.length, 2, 'two disjoint slabs');
  });

  test('axis angle readout', () => {
    const d = (a) => DG.axisAngleDeg(G2.v(0, 0, 0), G2.v(Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180), 0));
    near(d(0), 0, 1e-9, 'on-axis');
    near(d(30), 30, 1e-9, '30 degrees off');
    near(d(90), 0, 1e-9, 'on the other axis');
    near(d(100), 10, 1e-9, '10 off the y axis');
  });
};
