'use strict';
// Geometry unit tests — pure math, no model involved.
module.exports = h => {
  const { G, test, ok, eq, near, throws } = { ...h, G: h.loadModel().G };

  test('vector basics: add/sub/mul/dot/cross', () => {
    const a = G.v(1, 2, 3), b = G.v(-2, 0, 4);
    eq(G.dot(a, b), -2 + 0 + 12, 'dot');
    eq(G.len(G.v(3, 4, 0)), 5, 'len');
    const c = G.cross(G.v(1, 0, 0), G.v(0, 1, 0));
    eq(c.z, 1, 'cross x×y = z');
    eq(G.parallel(G.v(1, 2, 3), G.v(2, 4, 6)), true, 'parallel');
    eq(G.parallel(G.v(1, 2, 3), G.v(1, 2, 4)), false, 'not parallel');
  });

  test('loopArea: unit square and scaled ring', () => {
    const sq = [G.v(0, 0, 0), G.v(1, 0, 0), G.v(1, 1, 0), G.v(0, 1, 0)];
    near(G.loopArea(sq), 1, 1e-12, 'unit square');
    const big = sq.map(p => G.mul(p, 3.5));
    near(G.loopArea(big), 12.25, 1e-12, 'scaled square');
    near(G.loopArea(sq.slice().reverse()), 1, 1e-12, 'area is winding-independent');
  });

  test('loopNormal: CCW around +z, and reversed', () => {
    const sq = [G.v(0, 0, 0), G.v(1, 0, 0), G.v(1, 1, 0), G.v(0, 1, 0)];
    const n = G.loopNormal(sq);
    near(n.z, 1, 1e-12, 'CCW square faces +z');
    near(G.loopNormal(sq.slice().reverse()).z, -1, 1e-12, 'reversed faces -z');
    // vertical ring in the y=0 plane
    const vert = [G.v(0, 0, 0), G.v(1, 0, 0), G.v(1, 0, 1), G.v(0, 0, 1)];
    const vn = G.loopNormal(vert);
    near(Math.abs(vn.y), 1, 1e-12, 'vertical ring normal is ±y');
  });

  test('basisForNormal + to2D/from2D roundtrip (in-plane points)', () => {
    for (const n of [G.v(0, 0, 1), G.v(0, -1, 0), G.v(1, 0, 0), G.norm(G.v(1, 2, 3))]) {
      const { u, v } = G.basisForNormal(n);
      near(G.dot(u, n), 0, 1e-12, 'u ⊥ n');
      near(G.dot(v, n), 0, 1e-12, 'v ⊥ n');
      near(G.dot(u, v), 0, 1e-12, 'u ⊥ v');
      near(G.len(u), 1, 1e-12, 'u unit');
      near(G.len(v), 1, 1e-12, 'v unit');
      // to2D/from2D is a plane projection: the exact roundtrip is plane -> 2D -> plane
      const o = G.v(0.4, 0.1, -0.3);
      const p = G.from2D(1.3, -0.7, o, u, v);
      const q = G.to2D(p, o, u, v);
      near(q.x, 1.3, 1e-12, 'x roundtrip');
      near(q.y, -0.7, 1e-12, 'y roundtrip');
    }
  });

  test('rayPlane: forward hit, parallel miss, behind miss', () => {
    const pl = { n: G.v(0, 0, 1), d: 0 };
    const hit = G.rayPlane(G.v(1, 1, 5), G.v(0, 0, -1), pl);
    ok(hit, 'should hit');
    near(hit.x, 1, 1e-12); near(hit.z, 0, 1e-12, 'on plane');
    eq(G.rayPlane(G.v(0, 0, 1), G.v(1, 0, 0), pl), null, 'parallel ray misses');
    eq(G.rayPlane(G.v(0, 0, 1), G.v(0, 0, 1), pl), null, 'plane behind origin misses');
    ok(G.planeHas(pl, G.v(99, -5, 0)), 'planeHas');
  });

  test('constrainToAxes: one axis locks the line, two lock the plane', () => {
    const a = G.v(1, 2, 3), p = G.v(4, 6, 0);
    // X only: keep dx, drop dy/dz
    let q = G.constrainToAxes(a, p, ['x']);
    near(q.x, 4, 1e-12, 'x kept'); near(q.y, 2, 1e-12, 'y at anchor'); near(q.z, 3, 1e-12, 'z at anchor');
    // X+Y plane: keep dx/dy, z pinned to the anchor (the plane through it)
    q = G.constrainToAxes(a, p, ['x', 'y']);
    near(q.x, 4, 1e-12); near(q.y, 6, 1e-12); near(q.z, 3, 1e-12, 'plane member');
    // single Z
    q = G.constrainToAxes(a, p, ['z']);
    near(q.x, 1, 1e-12); near(q.y, 2, 1e-12); near(q.z, 0, 1e-12, 'z kept');
    // negative direction stays signed (no clamping)
    q = G.constrainToAxes(G.v(0, 0, 0), G.v(-2, 5, 7), ['y']);
    near(q.y, 5, 1e-12); near(q.x, 0, 1e-12); near(q.z, 0, 1e-12);
  });

  test('distToSeg / closestOnSeg', () => {
    const a = G.v(0, 0, 0), b = G.v(4, 0, 0);
    near(G.distToSeg(G.v(2, 3, 0), a, b), 3, 1e-12, 'perpendicular');
    near(G.distToSeg(G.v(-3, 0, 0), a, b), 3, 1e-12, 'before the segment');
    near(G.closestOnSeg(G.v(9, 0, 0), a, b).t, 1, 1e-12, 'clamped t');
  });

  test('segsIntersect: proper crossing only', () => {
    const n = G.v(0, 0, 1);
    ok(G.segsIntersect(G.v(0, -1, 0), G.v(0, 1, 0), G.v(-1, 0, 0), G.v(1, 0, 0), n), 'cross');
    eq(G.segsIntersect(G.v(0, -1, 0), G.v(0, 1, 0), G.v(0.5, -1, 0), G.v(0.5, 1, 0), n), false, 'parallel');
  });

  test('segsIntersect: touching endpoints do not count as crossing', () => {
    const n = G.v(0, 0, 1);
    eq(G.segsIntersect(G.v(0, 0, 0), G.v(0, 2, 0), G.v(0, 0, 0), G.v(1, 0, 0), n), false, 'shared endpoint');
    eq(G.segsIntersect(G.v(0, 0, 0), G.v(2, 0, 0), G.v(3, 0, 0), G.v(5, 0, 0), n), false, 'collinear');
  });

  test('circumcenter of a right triangle', () => {
    const { center, r } = G.circumcenter(G.v(0, 0, 0), G.v(2, 0, 0), G.v(0, 2, 0));
    near(center.x, 1, 1e-12); near(center.y, 1, 1e-12);
    near(r, Math.SQRT2, 1e-12, 'radius');
    eq(G.circumcenter(G.v(0, 0, 0), G.v(1, 0, 0), G.v(2, 0, 0)), null, 'collinear -> null');
  });

  test('signedAngle and rotatePoint (right-hand rule around +z)', () => {
    near(G.signedAngle(G.v(1, 0, 0), G.v(0, 1, 0), G.v(0, 0, 1)), Math.PI / 2, 1e-12, 'quarter turn');
    near(G.signedAngle(G.v(1, 0, 0), G.v(0, -1, 0), G.v(0, 0, 1)), -Math.PI / 2, 1e-12, 'clockwise');
    const r = G.rotatePoint(G.v(1, 0, 0), G.v(), G.v(0, 0, 1), Math.PI / 2);
    near(r.x, 0, 1e-12); near(r.y, 1, 1e-12);
  });

  test('offsetLoop widens a CCW square', () => {
    const sq = [G.v(0, 0, 0), G.v(1, 0, 0), G.v(1, 1, 0), G.v(0, 1, 0)];
    const out = G.offsetLoop(sq, G.v(0, 0, 1), 0.5);
    near(G.loopArea(out), 4, 1e-9, 'side grows from 1 to 2');
    const c = out.reduce((acc, p) => G.add(acc, p), G.v());
    near(c.x / 4, 0.5, 1e-9, 'same centroid x'); near(c.y / 4, 0.5, 1e-9, 'same centroid y');
  });

  test('solve3 and miterOffset', () => {
    const x = G.solve3([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [3, -2, 5]);
    eq(x[0], 3); eq(x[1], -2); eq(x[2], 5, 'identity system');
    const d = G.miterOffset([G.v(0, 0, 1)], 0.25);
    near(d.z, 0.25, 1e-12, 'single face: offset along its normal');
    const corner = G.miterOffset([G.v(0, 0, 1), G.v(1, 0, 0)], 0.25);
    near(corner.x, corner.z, 1e-9, 'corner miter is symmetric');
    near(Math.hypot(corner.x, corner.z), 0.25 * Math.SQRT2, 1e-9, 'equal offsets on both faces');
  });
};
