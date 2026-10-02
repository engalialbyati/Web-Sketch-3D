'use strict';
// DrawGeom pure geometry for the DrawPrimitiveEngine (tools/draw.js).
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const { G } = loadModelExtra();
  function loadModelExtra() {
    // single audited loader (harness)
    const L = h.loadModel(['js/tools/base.js', 'js/tools/draw.js']);
    return { G: L.window.G, DG: L.window.DrawGeom, SV: L.window.SketchValidator,
             Model: L.window.Model, applyFillet: L.window.applyFilletToModel };
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
    ok(f && !f.error, 'fillet exists');
    near(f.d, 0.5, 1e-9, 'tangent distance r/tan(45°) = r');
    near(f.t1.x, 0.5, 1e-9, 't1 on the x edge');
    near(f.t2.y, 0.5, 1e-9, 't2 on the y edge');
    near(f.center.x, 0.5, 1e-9, 'center at (r, r)');
    near(f.center.y, 0.5, 1e-9, 'center at (r, r)');
    // arc endpoints coincide with the tangent points
    near(G2.dist(f.pts[0], f.t1), 0, 1e-9, 'arc starts at t1');
    near(G2.dist(f.pts[f.pts.length - 1], f.t2), 0, 1e-9, 'arc ends at t2');
  });

  test('fillet sweeps the MINOR interior angle, bulging toward the corner (regression: inverted notch)', () => {
    // right angle at the origin: the arc must quarter-sweep INSIDE the
    // wedge — the old inverted direction swept the complementary ~270°
    // and notched outside the corner
    const f = DG.filletCorner(G2, G2.v(0, 0, 0), G2.v(2, 0, 0), G2.v(0, 2, 0), 0.5);
    near(f.span, Math.PI / 2, 1e-6, 'sweep = the 90° interior angle, not 270°');
    const mid = f.pts[Math.floor(f.pts.length / 2)];
    near(mid.x, 0.5 - 0.5 * Math.SQRT1_2, 1e-6, 'arc midpoint faces the corner (x)');
    near(mid.y, 0.5 - 0.5 * Math.SQRT1_2, 1e-6, 'arc midpoint faces the corner (y)');
    ok(G2.dist(G2.v(0, 0, 0), mid) < 0.5, 'the arc rounds INTO the wedge, not away');
    // every arc point stays inside the wedge quadrant
    for (const p of f.pts) ok(p.x >= -1e-9 && p.y >= -1e-9, 'arc point in x>=0, y>=0');
  });

  test('fillet orientation mirrors correctly (both winding orders round inward)', () => {
    // mirrored legs: u1 = +y, u2 = +x (cross < 0) — same interior rounding
    const f = DG.filletCorner(G2, G2.v(0, 0, 0), G2.v(0, 2, 0), G2.v(2, 0, 0), 0.5);
    near(f.span, Math.PI / 2, 1e-6, 'mirrored corner also quarter-sweeps');
    const mid = f.pts[Math.floor(f.pts.length / 2)];
    near(mid.x, 0.5 - 0.5 * Math.SQRT1_2, 1e-6, 'midpoint faces the corner (x)');
    near(mid.y, 0.5 - 0.5 * Math.SQRT1_2, 1e-6, 'midpoint faces the corner (y)');
  });

  test('fillet handles acute and obtuse interior angles', () => {
    // obtuse 135°: u2 at 135° from +x — the arc is the shallow exterior
    // turn (π − θ = 45°) hugging the corner
    const ob = DG.filletCorner(G2, G2.v(0, 0, 0), G2.v(3, 0, 0), G2.v(-2, 2, 0), 0.4);
    ok(ob && !ob.error, 'obtuse fillet exists');
    near(ob.span, Math.PI / 4, 1e-6, 'obtuse sweep = π − θ = 45°');
    const obMid = ob.pts[Math.floor(ob.pts.length / 2)];
    ok(G2.dist(G2.v(0, 0, 0), obMid) < 0.1, 'obtuse arc hugs the shallow corner');
    // acute 30°: u2 at 30° from +x — the arc wraps the sharp point (π − θ = 150°)
    const ac = DG.filletCorner(G2, G2.v(0, 0, 0), G2.v(3, 0, 0), G2.v(3 * Math.cos(Math.PI / 6), 3 * Math.sin(Math.PI / 6), 0), 0.2);
    ok(ac && !ac.error, 'acute fillet exists');
    near(ac.span, 5 * Math.PI / 6, 1e-6, 'acute sweep = π − θ = 150°');
    near(ac.d, 0.2 / Math.tan(Math.PI / 12), 1e-9, 'acute tangent distance r/tan(15°)');
    // tangency: each radius has length r and is perpendicular to its leg
    const r1 = G2.sub(ac.t1, ac.center), r2 = G2.sub(ac.t2, ac.center);
    near(G2.len(r1), 0.2, 1e-9, '|radius to t1| = r');
    near(G2.len(r2), 0.2, 1e-9, '|radius to t2| = r');
    near(r1.x, 0, 1e-9, 'radius to t1 ⊥ the +x leg');
    const u2 = G2.norm(G2.v(Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0));
    near(G2.dot(u2, r2), 0, 1e-9, 'radius to t2 ⊥ the 30° leg');
  });

  test('fillet edge cases: parallel legs and oversized radius report WHY', () => {
    const par = DG.filletCorner(G2, G2.v(0, 0, 0), G2.v(2, 0, 0), G2.v(0.5, 0, 0), 0.5);
    ok(par && par.error === 'parallel', 'collinear legs report parallel');
    const big = DG.filletCorner(G2, G2.v(0, 0, 0), G2.v(0.2, 0, 0), G2.v(0, 2, 0), 0.5);
    ok(big && big.error === 'radius', 'short leg reports radius');
    near(big.maxR, 0.2, 1e-9, 'maxR = short leg × tan(theta/2) — the actionable bound');
  });

  test('fillet refuses radii larger than the edges allow', () => {
    const f = DG.filletCorner(G2, G2.v(0, 0, 0), G2.v(0.2, 0, 0), G2.v(0, 2, 0), 0.5);
    ok(f && f.error === 'radius', 'edge too short for the tangent distance');
  });

  test('applyFilletToModel: CROSSING lines trim their inside fragments to the tangents', () => {
    const m = new extra.Model();
    const e1 = m.addEdge(G2.v(-2, 0, 0), G2.v(4, 0, 0));
    const e2 = m.addEdge(G2.v(0, -2, 0), G2.v(0, 4, 0));
    const c = DG.cornerFromEdges(G2, m.vp(e1.a), m.vp(e1.b), m.vp(e2.a), m.vp(e2.b));
    ok(c, 'edges cross');
    const f = DG.filletCorner(G2, c.corner, c.pA, c.pB, 0.6);
    ok(f && !f.error, 'fillet exists');
    extra.applyFillet(m, { ...f, edgeA: e1, edgeB: e2 });
    // the arc curve exists and stays inside the NE quadrant
    const arcs = [...m.edges.values()].filter(e => e.curveId);
    ok(arcs.length >= 6, `arc chains (${arcs.length} edges)`);
    for (const e of arcs) for (const vi of [e.a, e.b]) {
      const p = m.vp(vi);
      ok(p.x >= -1e-6 && p.y >= -1e-6, 'arc vertex inside the filleted quadrant');
    }
    // no straight edge passes THROUGH the corner as an interior point — the
    // inside fragments are reaped, the outer legs may only END there
    for (const e of [...m.edges.values()]) {
      if (e.curveId) continue;
      ok(G2.distToSeg(G2.v(0, 0, 0), m.vp(e.a), m.vp(e.b)) > 1e-6
        || G2.dist(G2.v(0, 0, 0), m.vp(e.a)) < 1e-6 || G2.dist(G2.v(0, 0, 0), m.vp(e.b)) < 1e-6,
        'straight edge does not cross the corner interiorly');
    }
    // the outer legs survive: all four far endpoints are still reachable
    const far = [G2.v(-2, 0, 0), G2.v(4, 0, 0), G2.v(0, -2, 0), G2.v(0, 4, 0)];
    for (const p of far) ok([...m.vertices.values()].some(v => G2.dist(v, p) < 1e-9), 'outer endpoint kept');
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
