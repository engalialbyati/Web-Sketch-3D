'use strict';
// Mirror / Array / transform-aware importSubset — the OpenCADStudio MIRROR +
// ARRAY tools adapted to the B-Rep kernel. Mirror is a reflection: copied
// rings must be reversed so face normals stay outward, and arc/circle curve
// metadata must transform with the geometry. Array is rotation/translation
// copies (orientation preserved). Ellipse is a new DrawPrimitiveEngine
// primitive emitted as a closed polyline ring.
module.exports = h => {
  const { test, ok, eq, near, makeWorld } = h;

  // reflection through the vertical plane containing A->B (MirrorTool._tf)
  const mirrorTf = (G, A, B) => {
    const d = G.sub(B, A);
    const m = G.norm(G.v(-d.y, d.x, 0));
    const refl = q => G.sub(q, G.mul(m, 2 * G.dot(G.sub(q, A), m)));
    return { p: refl, n: refl, flip: true };
  };

  test('a mirrored face copy keeps its outward normal (ring reversed)', () => {
    const w = makeWorld(), { G, m } = w;
    const f = w.rect([[1, 1, 0], [3, 1, 0], [3, 2.5, 0], [1, 2.5, 0]]);
    const n0 = G.loopNormal(m.pts(f.loop)); // +Z for a CCW ground ring
    const sub = m.serializeSubset({ faces: new Set([f.id]), edges: new Set() });
    const tf = mirrorTf(G, G.v(4, 0, 0), G.v(4, 5, 0)); // mirror across x=4
    const copies = m.importSubset(sub, G.v(), tf);
    eq(copies.length, 1, 'one mirrored face');
    const c = copies[0];
    // mirrored extents: x 5..7 (was 1..3)
    const xs = m.pts(c.loop).map(p => p.x);
    near(Math.min(...xs), 5, 1e-9, 'mirrored min x');
    near(Math.max(...xs), 7, 1e-9, 'mirrored max x');
    const n1 = G.loopNormal(m.pts(c.loop));
    near(n1.z, n0.z, 1e-9, 'copied face keeps +Z normal after the flip');
    w.vclean('mirror copy');
  });

  test('a mirror-move (source deleted) leaves a valid outward-facing face', () => {
    const w = makeWorld(), { G, m } = w;
    const f = w.rect([[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0]]);
    const verts = new Set(m.rings(f).flat());
    const tf = mirrorTf(G, G.v(3, 0, 0), G.v(3, 1, 0));
    m.transformVertices(verts, tf.p);
    m.flipRingOrientation([f.id]);
    const xs = m.pts(f.loop).map(p => p.x);
    near(Math.min(...xs), 4, 1e-9, 'moved min x');
    near(Math.max(...xs), 6, 1e-9, 'moved max x');
    const n = G.loopNormal(m.pts(f.loop));
    near(n.z, 1, 1e-9, 'in-place mirror keeps the normal up');
    w.vclean('mirror move');
  });

  test('a mirrored arc copy transforms its curve metadata center', () => {
    const w = makeWorld(), { G, m } = w;
    // half-circle arc via addPolyline + curve meta (same shape the arc tools use)
    const O = G.v(2, 2, 0), r = 1;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = Math.PI * i / 12;
      pts.push(G.v(O.x + Math.cos(t) * r, O.y + Math.sin(t) * r, 0));
    }
    m.addPolyline(pts, { type: 'arc', center: G.clone(O), radius: r, normal: G.v(0, 0, 1) });
    const arcEdges = [...m.edges.values()].filter(e => e.curveId);
    ok(arcEdges.length > 0, 'arc edges exist');
    const sel = { faces: new Set(), edges: new Set(arcEdges.map(e => e.id)) };
    const sub = m.serializeSubset(sel);
    const tf = mirrorTf(G, G.v(4, 0, 0), G.v(4, 1, 0));
    m.importSubset(sub, G.v(), tf);
    const centers = [...m.curves.values()].map(c => c.center).filter(Boolean);
    eq(centers.length, 2, 'source + copied curve meta');
    const copy = centers.find(c => Math.abs(c.x - 6) < 1e-6);
    ok(copy, 'mirrored center landed at x=6');
    near(copy.y, 2, 1e-9, 'center y unchanged by the vertical mirror plane');
    w.vclean('mirror arc');
  });

  test('a linear array of a face produces N-1 welded copies', () => {
    const w = makeWorld(), { G, m } = w;
    const f = w.rect([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
    const before = m.faces.size;
    const sub = m.serializeSubset({ faces: new Set([f.id]), edges: new Set() });
    const step = G.v(2, 0, 0);
    const count = 4;
    for (let i = 1; i < count; i++) m.importSubset(sub, G.mul(step, i));
    eq(m.faces.size, before + count - 1, '3 copies added');
    // copies land at x offsets 2, 4, 6 (welded vertices keep shared seams)
    const xs = [...m.faces.values()].map(fc => {
      const p = m.pts(fc.loop);
      return Math.min(...p.map(q => q.x));
    }).sort((a, b) => a - b);
    near(xs[1], 2, 1e-9, 'copy 1 at x=2');
    near(xs[2], 4, 1e-9, 'copy 2 at x=4');
    near(xs[3], 6, 1e-9, 'copy 3 at x=6');
    w.vclean('linear array');
  });

  test('a polar array rotates copies about the center (orientation kept)', () => {
    const w = makeWorld(), { G, m } = w;
    const f = w.rect([[3, -0.5, 0], [4.5, -0.5, 0], [4.5, 0.5, 0], [3, 0.5, 0]]);
    const sub = m.serializeSubset({ faces: new Set([f.id]), edges: new Set() });
    const C = G.v(0, 0, 0), axis = G.v(0, 0, 1);
    const n0 = G.loopNormal(m.pts(f.loop));
    for (const ang of [Math.PI / 2, Math.PI]) {
      m.importSubset(sub, G.v(), {
        p: q => G.rotatePoint(q, C, axis, ang),
        n: v => G.rotatePoint(v, G.v(), axis, ang),
      });
    }
    // 90° copy sits along +y, 180° along -x — centroid check
    const centroid = fc => {
      const p = m.pts(fc.loop);
      return G.mul(p.reduce((a, q) => G.add(a, q), G.v()), 1 / p.length);
    };
    const cs = [...m.faces.values()].map(centroid);
    ok(cs.some(c => Math.hypot(c.x - 3.5, c.y) < 0.3), 'source centroid +x');
    ok(cs.some(c => Math.hypot(c.x, c.y - 3.5) < 0.3), '90° copy centroid +y');
    ok(cs.some(c => Math.hypot(c.x + 3.5, c.y) < 0.3), '180° copy centroid -x');
    for (const fc of m.faces.values()) {
      const n = G.loopNormal(m.pts(fc.loop));
      near(n.z, n0.z, 1e-9, 'rotated copy keeps its up normal');
    }
    w.vclean('polar array');
  });

  test('DrawGeom.ellipseRing emits a closed planar ring at the right extents', () => {
    // same load shape as draw.test.js — single audited loader (harness)
    const L = h.loadModel(['js/tools/base.js', 'js/tools/draw.js']);
    const G = L.window.G, DrawGeom = L.window.DrawGeom;
    ok(DrawGeom, 'DrawGeom exported');
    const ring = DrawGeom.ellipseRing(G, G.v(5, 5, 2), 3, 1, Math.PI / 6);
    eq(ring.length, 64, '64-segment ring');
    const xs = ring.map(p => p.x), ys = ring.map(p => p.y);
    // rotated extents: max radial extent along the 30° axis = a = 3, across = b = 1
    const dots = ring.map(p => {
      const dx = p.x - 5, dy = p.y - 5;
      return { u: dx * Math.cos(Math.PI / 6) + dy * Math.sin(Math.PI / 6), v: -dx * Math.sin(Math.PI / 6) + dy * Math.cos(Math.PI / 6) };
    });
    near(Math.max(...dots.map(d => d.u)), 3, 0.02, 'semi-major extent');
    near(Math.max(...dots.map(d => Math.abs(d.v))), 1, 0.02, 'semi-minor extent');
    for (const p of ring) near(p.z, 2, 1e-9, 'ring stays on its plane');
    // the ring forms a valid model face
    const w = makeWorld(), { m } = w;
    const f = m.addFaceFromRings(ring.map(p => G.clone(p)));
    ok(f, 'ellipse ring becomes a face');
    near(G.loopArea(m.pts(f.loop)), Math.PI * 3 * 1, 0.05, 'area ~ πab');
    w.vclean('ellipse face');
  });
};
