'use strict';
// SoupFuse — triangle soup → polygon faces: coplanar fusion, hole tracing,
// collinear cleanup, raw fallbacks, and the shell utilities (signed volume,
// outward winding, inner-void dropping for Outer Shell).
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const { G, window: w } = loadModel(['js/soup-fuse.js']);
  const SoupFuse = w.SoupFuse;

  // ---- helpers -----------------------------------------------------------

  test('signedVolume: unit cube = 1, inward winding = -1', () => {
    const c = cubeSoup(0, 0, 0, 1);
    near(SoupFuse.signedVolume(c), 1, 1e-9, 'outward cube volume');
    for (const t of c.triangles) { const x = t[1]; t[1] = t[2]; t[2] = x; }
    near(SoupFuse.signedVolume(c), -1, 1e-9, 'flipped winding negative');
  });

  test('ensureOutward flips an inward soup', () => {
    const c = cubeSoup(2, 0, 0, 1);
    for (const t of c.triangles) { const x = t[1]; t[1] = t[2]; t[2] = x; }
    SoupFuse.ensureOutward(c);
    near(SoupFuse.signedVolume(c), 1, 1e-9, 'fixed winding');
  });

  test('dropInnerShells removes a nested void shell', () => {
    const outer = cubeSoup(0, 0, 0, 2);            // vol +8
    const inner = cubeSoup(0.5, 0.5, 0.5, 1);      // flip → -1 (a void)
    for (const t of inner.triangles) { const x = t[1]; t[1] = t[2]; t[2] = x; }
    const soup = {
      positions: outer.positions.concat(inner.positions),
      triangles: outer.triangles.map(t => t.slice())
        .concat(inner.triangles.map(t => t.map(v => v + outer.positions.length))),
      triAttrs: null,
    };
    const out = SoupFuse.dropInnerShells(soup);
    eq(out.triangles.length, outer.triangles.length, 'only the outer shell survives');
    near(SoupFuse.signedVolume(out), 8, 1e-9, 'outer volume kept');
  });

  test('fuse: a box side triangulated with midpoints merges to ONE quad', () => {
    // square 1x1 in z=0, split into 8 triangles through midpoints of edges
    const pts = [
      { x: 0, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
      { x: 0, y: 0.5, z: 0 }, { x: 0.5, y: 0.5, z: 0 }, { x: 1, y: 0.5, z: 0 },
      { x: 0, y: 1, z: 0 }, { x: 0.5, y: 1, z: 0 }, { x: 1, y: 1, z: 0 },
    ];
    const tris = [
      [0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4],
      [3, 4, 7], [3, 7, 6], [4, 5, 8], [4, 8, 7],
    ];
    const faces = SoupFuse.fuse({ positions: pts, triangles: tris, triAttrs: null });
    eq(faces.length, 1, 'one fused face');
    eq(faces[0].outer.length, 4, 'collinear midpoints dropped (corners only)');
    near(G.loopArea(faces[0].outer), 1, 1e-9, 'area preserved');
    eq(faces[0].holes.length, 0, 'no holes');
  });

  test('fuse: separate colors stay separate faces', () => {
    const pts = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }];
    const soup = {
      positions: pts,
      triangles: [[0, 1, 2], [0, 2, 3]],
      triAttrs: [{ color: '#ff0000', alpha: 1 }, { color: '#00ff00', alpha: 1 }],
    };
    const faces = SoupFuse.fuse(soup);
    eq(faces.length, 2, 'coplanar but different materials do not merge');
  });

  test('fuse: an annulus region traces the hole', () => {
    // outer square 0..2, inner square 0.5..1.5, both wound the same way in
    // ONE triangle set that forms a connected region with a hole
    const O = [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }];
    const I = [{ x: 0.5, y: 0.5, z: 0 }, { x: 1.5, y: 0.5, z: 0 }, { x: 1.5, y: 1.5, z: 0 }, { x: 0.5, y: 1.5, z: 0 }];
    const positions = O.concat(I);
    const o = i => i, inn = i => i + 4;
    // 8 trapezoid quads bridging outer to inner ring (two triangles each)
    const tris = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      tris.push([o(i), o(j), inn(j)], [o(i), inn(j), inn(i)]);
    }
    const faces = SoupFuse.fuse({ positions, triangles: tris, triAttrs: null });
    eq(faces.length, 1, 'one region');
    eq(faces[0].holes.length, 1, 'inner loop became a hole');
    eq(faces[0].holes[0].length, 4, 'hole has 4 corners');
    near(G.loopArea(faces[0].outer), 4, 1e-9, 'outer area');
    near(G.loopArea(faces[0].holes[0]), 1, 1e-9, 'hole area');
  });

  test('fuse: non-manifold edge taint falls back to raw triangles', () => {
    // three triangles sharing one edge — edge used 3x
    const pts = [
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
    ];
    const faces = SoupFuse.fuse({
      positions: pts,
      triangles: [[0, 1, 2], [1, 0, 3], [0, 1, 2].slice()],
      triAttrs: null,
    });
    // degenerate duplicate [0,1,2] is dropped; the two around the shared
    // edge are tainted → each emitted raw
    ok(faces.length >= 2, 'no silent merge across a non-manifold edge');
    for (const f of faces) eq(f.outer.length, 3, 'raw triangles');
  });

  // ---------------------------------------------------------------------
  function cubeSoup(x0, y0, z0, s) {
    const pos = [
      { x: x0, y: y0, z: z0 }, { x: x0 + s, y: y0, z: z0 }, { x: x0 + s, y: y0 + s, z: z0 }, { x: x0, y: y0 + s, z: z0 },
      { x: x0, y: y0, z: z0 + s }, { x: x0 + s, y: y0, z: z0 + s }, { x: x0 + s, y: y0 + s, z: z0 + s }, { x: x0, y: y0 + s, z: z0 + s },
    ];
    const tris = [];
    for (const q of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]]) {
      tris.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
    }
    return { positions: pos, triangles: tris, triAttrs: null };
  }

  test('fuse: a whole cube soup fuses back to six quads', () => {
    const faces = SoupFuse.fuse(cubeSoup(0, 0, 0, 1));
    eq(faces.length, 6, 'six faces');
    let area = 0;
    for (const f of faces) area += G.loopArea(f.outer) - (f.holes || []).reduce((s, hp) => s + G.loopArea(hp), 0);
    near(area, 6, 1e-9, 'total surface 6 m²');
  });
};
