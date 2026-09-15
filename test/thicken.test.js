'use strict';
// Give Thickness (thickenGeometry) — the true perpendicular shell for curved
// meshes, incl. meshes of STANDALONE (loose) faces whose vertices are private
// duplicates: smoothed position-keyed vertex normals, flipped inner shell,
// boundary bridging, and miter-capped corners. Result must be a closed,
// positionally watertight solid.
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const { G, Model } = loadModel();

  const pk = p => Math.round(p.x * 1e5) + ',' + Math.round(p.y * 1e5) + ',' + Math.round(p.z * 1e5);
  // position-keyed edge-use audit over a face set: a closed shell has every
  // position edge used exactly twice
  function audit(m, ids) {
    const cnt = new Map();
    for (const fid of ids) {
      const f = m.faces.get(fid); if (!f) continue;
      for (const ring of m.rings(f)) for (let i = 0; i < ring.length; i++) {
        const ka = pk(m.vp(ring[i])), kb = pk(m.vp(ring[(i + 1) % ring.length]));
        const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        cnt.set(k, (cnt.get(k) || 0) + 1);
      }
    }
    let open = 0, paired = 0;
    for (const [, c] of cnt) { if (c === 1) open++; else if (c === 2) paired++; }
    return { open, paired };
  }
  // offset copy for a position: nearest reverse:true face point to p
  function offsetOf(data, p) {
    let best = null, bd = 1e9;
    for (const fd of data) {
      if (!fd.reverse) continue;
      for (const q of fd.outer) { const d = G.dist(p, q); if (d < bd) { bd = d; best = q; } }
    }
    return { p: best, dist: bd };
  }

  // quarter-cylinder wall (a truly curved mesh), welded or loose
  function cylinderWall(standalone, SEG = 8, R = 3, H = 2) {
    const m = new Model();
    const P = (a, z) => G.v(R * Math.cos(a), R * Math.sin(a), z);
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI / 2, a1 = ((i + 1) / SEG) * Math.PI / 2;
      m.addFaceFromRings([P(a0, 0), P(a0, H), P(a1, H), P(a1, 0)], [], standalone ? { standalone: true } : {});
    }
    return m;
  }

  for (const standalone of [false, true]) {
    const label = standalone ? 'loose' : 'welded';
    test(`${label} curved mesh: offsets PERPENDICULAR to the surface, mitered`, () => {
      const m = cylinderWall(standalone);
      const ids = [...m.faces.keys()];
      const t = 0.15;
      const data = m.thickenGeometry(ids, t);
      ok(data.length >= 16, 'geometry produced');
      // a seam vertex mid-strip: offset must be radial (perpendicular to the
      // local curvature), with the exact miter factor 1/cos(Δ/2) — never a
      // global-direction translation
      const seam = G.v(3 * Math.cos(Math.PI / 4), 3 * Math.sin(Math.PI / 4), 0);
      const { p, dist } = offsetOf(data, seam);
      ok(p && dist < 0.2, 'offset copy found near the seam vertex');
      const dir = G.sub(p, seam);
      const radial = G.v(seam.x, seam.y, 0);
      const align = G.dot(dir, radial) / (G.len(dir) * G.len(radial));
      ok(Math.abs(align) > 0.999, `offset is perpendicular to the curve (radial align ${align.toFixed(4)})`);
      const facet = (Math.PI / 2) / 8; // angle between adjacent facet normals
      near(G.len(dir), t / Math.cos(facet / 2), 2e-3, 'uniform thickness with the exact miter factor');
    });

    test(`${label} curved mesh: flipped inner shell + boundary bridging = closed solid`, () => {
      const m = cylinderWall(standalone);
      const ids = [...m.faces.keys()];
      const data = m.thickenGeometry(ids, 0.15);
      ok(data.some(d => d.quad), 'boundary bridge quads generated');
      eq(data.filter(d => d.quad).length, 18, 'walls on the three open rims only (seams never walled)');
      const newIds = m.commitThicken(data);
      const a = audit(m, [...ids, ...newIds]);
      eq(a.open, 0, 'positionally watertight — no open edges');
      ok(a.paired >= 68, `every rim edge paired (${a.paired})`);
      ok(m.validate().ok, 'model valid');
    });
  }

  test('closed mesh (a solid box): hollow shell, no boundary walls', () => {
    const m = new Model();
    const f = m.addFaceFromRings([G.v(0, 0, 0), G.v(4, 0, 0), G.v(4, 3, 0), G.v(0, 3, 0)]);
    m.pushPull(f, 2); // a closed welded solid
    const ids = [...m.faces.keys()];
    const data = m.thickenGeometry(ids, 0.1);
    eq(data.filter(d => d.quad).length, 0, 'no boundary → no walls (hollow double shell)');
    const newIds = m.commitThicken(data);
    const a = audit(m, [...ids, ...newIds]);
    eq(a.open, 0, 'closed');
    ok(m.validate().ok, 'model valid');
  });

  test('miter: a 90° fold offsets along the 45° bisector at t·√2 (no taper)', () => {
    const m = new Model();
    // two quads meeting at 90° along the Y axis through origin
    m.addFaceFromRings([G.v(0, 0, 0), G.v(0, 2, 0), G.v(0, 2, 2), G.v(0, 0, 2)]); // XY→ plane x=0
    m.addFaceFromRings([G.v(0, 0, 0), G.v(0, 0, 2), G.v(2, 0, 2), G.v(2, 0, 0)]); // plane z=0
    const ids = [...m.faces.keys()];
    const t = 0.1;
    const data = m.thickenGeometry(ids, t);
    // a vertex ON the fold (0,0,0): offset = bisector of the two face normals
    const { p, dist } = offsetOf(data, G.v(0, 0, 0));
    ok(p && dist < 0.2, 'offset found');
    const dir = G.sub(p, G.v(0, 0, 0));
    // the two face normals are ±x and ±y → bisector |x|≈|y|, length t·√2
    near(Math.abs(dir.x), Math.abs(dir.y), 1e-6, 'along the 45° bisector');
    near(G.len(dir), t * Math.SQRT2, 1e-6, 'length t·√2 — exact miter, uniform thickness');
  });

  test('miter cap: sharp cusps stay EXACT, only razors clamp on the miter ray', () => {
    // a 160° cusp (scalloped plates): exact miter t/cos(80°) = 5.76·t — must
    // NOT be shortened to the averaged normal, or the shell pinches into a
    // self-intersecting notch at the cusp
    const t = 0.1, a160 = 160 * Math.PI / 180;
    const d = G.miterOffset([G.v(0, 0, 1), G.v(Math.sin(a160), 0, Math.cos(a160))], t);
    near(G.len(d), t / Math.cos(a160 / 2), 1e-9, '160° cusp gets the exact miter (5.76·t)');
    // a razor crease (~179°): unbounded solve clamps at 20·t along the ray
    const a179 = 179 * Math.PI / 180;
    const dr = G.miterOffset([G.v(0, 0, 1), G.v(Math.sin(a179), 0, Math.cos(a179))], t);
    near(G.len(dr), t * 20, 1e-9, 'razor clamps to exactly 20·t');
    ok(Math.abs(dr.z) > 0.9 * t * 20 * Math.cos(a179 / 2), 'clamp stays on the miter ray (bisector)');
    // coplanar fallback stays exactly t
    const d2 = G.miterOffset([G.v(0, 0, 1), G.v(0, 0, 1)], 0.1);
    near(G.len(d2), 0.1, 1e-9, 'coplanar offset is exactly t');
  });

  test('shell at a 160° cusp: no pinch, uniform perpendicular thickness', () => {
    const m = new Model(); // two plates folded 160°, sharing the ridge edge
    const th = 160 * Math.PI / 180, W = 1, L = 2;
    const u1 = G.v(-Math.cos(th / 2), 0, Math.sin(th / 2));
    const u2 = G.v(Math.cos(th / 2), 0, Math.sin(th / 2));
    const e0 = G.v(0, -L / 2, 0), e1 = G.v(0, L / 2, 0);
    m.addFaceFromRings([e0, e1, G.add(e1, G.mul(u2, W)), G.add(e0, G.mul(u2, W))], [], { standalone: true });
    m.addFaceFromRings([G.add(e0, G.mul(u1, W)), G.add(e1, G.mul(u1, W)), e1, e0], [], { standalone: true });
    const ids = [...m.faces.keys()];
    const t = 0.15;
    const data = m.thickenGeometry(ids, t);
    m.commitThicken(data);
    // watertight around the cusp
    const pk = q => Math.round(q.x * 1e5) + ',' + Math.round(q.y * 1e5) + ',' + Math.round(q.z * 1e5);
    const cnt = new Map();
    for (const f of m.faces.values())
      for (const ring of m.rings(f))
        for (let i = 0; i < ring.length; i++) {
          const ka = pk(m.vp(ring[i])), kb = pk(m.vp(ring[(i + 1) % ring.length]));
          const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
          cnt.set(k, (cnt.get(k) || 0) + 1);
        }
    ok(![...cnt.values()].some(c => c !== 2), `cusp shell is watertight (${[...cnt.values()].filter(c => c !== 2).length} bad edges)`);
    // the ridge vertex offsets to the exact miter point, not the averaged pinch:
    // verify the offset ring's ridge point sits exactly t off plate 1's plane
    const { p, dist } = offsetOf(data, G.v(0, -L / 2, 0));
    ok(p && dist < 1, 'ridge offset found');
    const n1 = G.v(Math.sin(th / 2), 0, Math.cos(th / 2)); // plate1 normal (+z-ish)
    // signed distance from ridge offset point to plate1's plane (plane through 0)
    const dp = Math.abs(n1.x * p.x + n1.y * p.y + n1.z * p.z);
    near(dp, t, 1e-6, 'offset ridge sits exactly t off plate 1 (no pinch)');
  });

  test('loose and welded shells offset to the SAME positions', () => {
    const mw = cylinderWall(false), ml = cylinderWall(true);
    const dw = mw.thickenGeometry([...mw.faces.keys()], 0.15);
    const dl = ml.thickenGeometry([...ml.faces.keys()], 0.15);
    const probe = G.v(3 * Math.cos(Math.PI / 4), 3 * Math.sin(Math.PI / 4), 0);
    const ow = offsetOf(dw, probe), ol = offsetOf(dl, probe);
    near(G.dist(ow.p, ol.p), 0, 1e-6, 'seam vertex lands identically');
  });
};
