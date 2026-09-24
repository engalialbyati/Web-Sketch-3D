'use strict';
// ---------------------------------------------------------------------------
// Geometry helpers. World convention: Z is UP (SketchUp style).
// Axes: X = red, Y = green, Z = blue.
// ---------------------------------------------------------------------------
const G = {
  EPS: 1e-7,
  VEPS: 1e-5,

  v(x = 0, y = 0, z = 0) { return { x, y, z }; },
  clone(p) { return { x: p.x, y: p.y, z: p.z }; },
  add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; },
  sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; },
  mul(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; },
  dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; },
  cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; },
  len(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); },
  dist(a, b) { return G.len(G.sub(a, b)); },
  norm(a) { const l = G.len(a); return l < G.EPS ? { x: 0, y: 0, z: 0 } : G.mul(a, 1 / l); },
  neg(a) { return { x: -a.x, y: -a.y, z: -a.z }; },
  isZero(a) { return G.len(a) < 1e-9; },
  parallel(a, b) { return G.len(G.cross(a, b)) < 1e-6; },

  planeFromPoints(a, b, c) {
    const n = G.norm(G.cross(G.sub(b, a), G.sub(c, a)));
    if (G.isZero(n)) return null;
    return { n, d: G.dot(n, a) };
  },
  planeKey(plane) {
    let n = plane.n, d = plane.d;
    const flip = n.x < -1e-9 || (Math.abs(n.x) <= 1e-9 && n.y < -1e-9) ||
      (Math.abs(n.x) <= 1e-9 && Math.abs(n.y) <= 1e-9 && n.z < 0);
    if (flip) { n = G.neg(n); d = -d; }
    return [n.x, n.y, n.z, d].map(x => Math.round(x * 1e4) / 1e4).join(',');
  },
  planeHas(plane, p, eps = 1e-5) { return Math.abs(G.dot(plane.n, p) - plane.d) <= eps; },

  // Blender-style axis lock: constrain p to the locked axes through anchor.
  // One axis keeps only that component of (p - anchor); two axes keep the
  // plane they span; three (or none) return p unchanged in spirit.
  constrainToAxes(anchor, p, axes) {
    let q = { x: anchor.x, y: anchor.y, z: anchor.z };
    for (const ax of axes) {
      const v = ax === 'x' ? { x: 1, y: 0, z: 0 } : ax === 'y' ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
      const d = (p.x - anchor.x) * v.x + (p.y - anchor.y) * v.y + (p.z - anchor.z) * v.z;
      q = { x: q.x + v.x * d, y: q.y + v.y * d, z: q.z + v.z * d };
    }
    return q;
  },

  // Shared axis-lock projection (SketchUp reference inference): project a
  // reference point Q onto the ray origin + t*u. The line tool uses it to
  // keep a drawn segment ON the locked axis while a hovered vertex supplies
  // only depth; push/pull uses it to align a pulled face to a reference
  // along its normal. Returns { p: the projected point, t: signed distance }.
  axisProject(origin, u, q) {
    const t = (q.x - origin.x) * u.x + (q.y - origin.y) * u.y + (q.z - origin.z) * u.z;
    return { p: { x: origin.x + u.x * t, y: origin.y + u.y * t, z: origin.z + u.z * t }, t };
  },

  rayPlane(ro, rd, plane) {
    const dn = G.dot(rd, plane.n);
    if (Math.abs(dn) < 1e-9) return null;
    const t = (plane.d - G.dot(ro, plane.n)) / dn;
    return t >= 0 ? G.add(ro, G.mul(rd, t)) : null;
  },

  // Orthonormal in-plane basis for a given normal.
  basisForNormal(n) {
    const ax = Math.abs(n.x), ay = Math.abs(n.y);
    const ref = ax < ay ? (ax < Math.abs(n.z) ? G.v(1, 0, 0) : G.v(0, 0, 1))
      : (ay < Math.abs(n.z) ? G.v(0, 1, 0) : G.v(0, 0, 1));
    const u = G.norm(G.cross(ref, n));
    const v = G.cross(n, u);
    return { u, v };
  },
  to2D(p, o, u, v) { const d = G.sub(p, o); return { x: G.dot(d, u), y: G.dot(d, v) }; },
  from2D(x, y, o, u, v) { return G.add(G.add(o, G.mul(u, x)), G.mul(v, y)); },

  newell(pts) {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      x += (a.y - b.y) * (a.z + b.z);
      y += (a.z - b.z) * (a.x + b.x);
      z += (a.x - b.x) * (a.y + b.y);
    }
    return { x, y, z };
  },
  loopNormal(pts) { return G.norm(G.newell(pts)); },
  loopArea(pts) { return G.len(G.newell(pts)) / 2; },

  // True when a closed point ring cannot bound a valid face: consecutive
  // duplicate points, or a proper crossing between non-adjacent edges — e.g.
  // the offset band of a wall shorter than its thickness doubling back on
  // itself at a mitered/butt join. addFaceFromRings welds such rings into
  // self-loop edges and broken faces (validate(): "self-loop", "ring visits
  // a vertex twice"), so callers must refuse them BEFORE any geometry exists.
  ringDegenerate(ring, eps = 1e-6) {
    const n = ring.length;
    if (n < 3) return true;
    const d2 = (a, b) => {
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      return dx * dx + dy * dy + dz * dz;
    };
    for (let i = 0; i < n; i++) if (d2(ring[i], ring[(i + 1) % n]) < eps * eps) return true;
    // proper segment crossing, projected on xy (wall footprints are planar);
    // adjacent edges share a vertex and are skipped
    const segX = (a, b, c, d) => {
      const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
      if (Math.abs(den) < 1e-12) return false;
      const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
      const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
      return t > eps && t < 1 - eps && u > eps && u < 1 - eps;
    };
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // first and last edges touch at the closure
      if (segX(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
    }
    return false;
  },

  closestOnSeg(p, a, b) {
    const ab = G.sub(b, a);
    const denom = G.dot(ab, ab) || 1;
    const t = Math.max(0, Math.min(1, G.dot(G.sub(p, a), ab) / denom));
    return { t, point: G.add(a, G.mul(ab, t)) };
  },
  distToSeg(p, a, b) { return G.dist(p, G.closestOnSeg(p, a, b).point); },

  // Closest-point-on-line-1 intersection of two infinite lines (p1->p2, p3->p4).
  lineLine(p1, p2, p3, p4) {
    const d1 = G.sub(p2, p1), d2 = G.sub(p4, p3), r = G.sub(p3, p1);
    const a = G.dot(d1, d1), b = G.dot(d1, d2), c = G.dot(d2, d2);
    const d = G.dot(d1, r), e = G.dot(d2, r);
    const den = a * c - b * b;
    if (Math.abs(den) < 1e-12) return null;
    return G.add(p1, G.mul(d1, (c * d - b * e) / den));
  },

  // Offset a closed point-loop (wound CCW around n) by dist (positive = widen).
  offsetLoop(pts, n, dist) {
    const N = pts.length, out = [];
    for (let i = 0; i < N; i++) {
      const p0 = pts[(i - 1 + N) % N], p1 = pts[i], p2 = pts[(i + 1) % N];
      const d1 = G.norm(G.sub(p1, p0)), d2 = G.norm(G.sub(p2, p1));
      if (G.isZero(d1) || G.isZero(d2)) { out.push(p1); continue; }
      const n1 = G.cross(d1, n), n2 = G.cross(d2, n); // outward normals for CCW winding around n
      const l1a = G.add(p1, G.mul(n1, dist)), l1b = G.add(l1a, d1);
      const l2a = G.add(p1, G.mul(n2, dist)), l2b = G.add(l2a, d2);
      const ip = G.lineLine(l1a, l1b, l2a, l2b);
      out.push(ip || G.add(p1, G.mul(G.norm(G.add(n1, n2)), dist)));
    }
    return out;
  },

  // Circle through 3 points -> { center, r } or null if collinear.
  circumcenter(a, b, c) {
    const ab = G.sub(b, a), ac = G.sub(c, a);
    const n = G.cross(ab, ac);
    if (G.isZero(G.norm(n))) return null;
    const ab2 = G.dot(ab, ab), ac2 = G.dot(ac, ac);
    // center = a + ((|ab|^2 * ac - |ac|^2 * ab) x n) / (2 |n|^2)
    const s = G.mul(G.cross(G.sub(G.mul(ac, ab2), G.mul(ab, ac2)), n), 1 / (2 * G.dot(n, n)));
    const center = G.add(a, s);
    return { center, r: G.dist(center, a) };
  },

  // Signed angle from vector a to vector b around axis (right-hand rule).
  signedAngle(a, b, axis) {
    return Math.atan2(G.dot(G.cross(a, b), axis), G.dot(a, b));
  },

  // Proper crossing test for two in-plane segments (touching endpoints = no).
  segsIntersect(p1, p2, p3, p4, n) {
    const s1 = G.dot(n, G.cross(G.sub(p2, p1), G.sub(p3, p1)));
    const s2 = G.dot(n, G.cross(G.sub(p2, p1), G.sub(p4, p1)));
    const s3 = G.dot(n, G.cross(G.sub(p4, p3), G.sub(p1, p3)));
    const s4 = G.dot(n, G.cross(G.sub(p4, p3), G.sub(p2, p3)));
    return (s1 * s2 < 0) && (s3 * s4 < 0);
  },

  // Rotate point around axis (unit) through center by angle (Rodrigues).
  rotatePoint(p, center, axis, ang) {
    const v = G.sub(p, center);
    const c = Math.cos(ang), s = Math.sin(ang);
    const t = G.mul(G.cross(axis, v), s);
    const d = G.mul(v, c);
    const w = G.mul(axis, G.dot(axis, v) * (1 - c));
    return G.add(center, G.add(G.add(d, t), w));
  },

  // Solve 3x3 linear system. Handles underdetermined systems by picking the
  // minimum-norm solution (free variables = 0); returns null only if
  // inconsistent (which means the normals genuinely conflict).
  solve3(M, b) {
    const rows = [
      [M[0][0], M[0][1], M[0][2], b[0]],
      [M[1][0], M[1][1], M[1][2], b[1]],
      [M[2][0], M[2][1], M[2][2], b[2]],
    ];
    const pivCol = [-1, -1];
    let r = 0;
    for (let col = 0; col < 3 && r < 3; col++) {
      let piv = r;
      for (let rr = r + 1; rr < 3; rr++) if (Math.abs(rows[rr][col]) > Math.abs(rows[piv][col])) piv = rr;
      if (Math.abs(rows[piv][col]) < 1e-10) continue; // free variable -> 0
      if (piv !== r) { const t = rows[r]; rows[r] = rows[piv]; rows[piv] = t; }
      for (let rr = 0; rr < 3; rr++) {
        if (rr === r) continue;
        const f = rows[rr][col] / rows[r][col];
        if (f === 0) continue;
        for (let c = col; c < 4; c++) rows[rr][c] -= f * rows[r][c];
      }
      pivCol[r] = col;
      r++;
    }
    // rows without a pivot must be all-zero rows, otherwise inconsistent
    for (let rr = r; rr < 3; rr++) {
      let nz = 0;
      for (let c = 0; c < 3; c++) nz = Math.max(nz, Math.abs(rows[rr][c]));
      if (nz < 1e-10 && Math.abs(rows[rr][3]) > 1e-9) return null;
    }
    const x = [0, 0, 0];
    for (let i = 0; i < r; i++) x[pivCol[i]] = rows[i][3] / rows[i][pivCol[i]];
    return x;
  },

  // Mitered offset displacement for a vertex shared by faces with the given
  // unit normals: D satisfies n·D = t for every n (proper miter at corners).
  miterOffset(normals, t) {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const b = [0, 0, 0];
    for (const n of normals) {
      const c = [n.x, n.y, n.z];
      for (let i = 0; i < 3; i++) {
        b[i] += t * c[i];
        for (let j = 0; j < 3; j++) M[i][j] += c[i] * c[j];
      }
    }
    const D = G.solve3(M, b);
    if (D && isFinite(D[0] + D[1] + D[2])) {
      const v = G.v(D[0], D[1], D[2]);
      const cap = Math.abs(t) * 20;
      const L = G.len(v);
      if (L <= cap) return v;
      // razor crease (normals nearly opposing): the exact miter is unbounded.
      // Clamp ALONG the miter ray — shortening to the averaged normal instead
      // would pinch the shell until its facets self-intersect (a see-through
      // notch at the cusp), which is worse than a long-but-sealed corner.
      return G.mul(v, cap / L);
    }
    // coplanar / degenerate: offset along the average normal
    const s = normals.reduce((acc, n) => G.add(acc, n), G.v());
    const len = G.len(s);
    return len < 1e-9 ? G.v() : G.mul(s, t / len);
  },
};
window.G = G;
