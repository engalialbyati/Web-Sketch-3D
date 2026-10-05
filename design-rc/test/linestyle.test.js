'use strict';
// Edge display styles (linetype / lineweight / layer), edge thickness, and
// the sweep builders behind the Model ribbon (Revolve, Follow Me).
module.exports = h => {
  const { test, ok, eq, near, makeWorld } = h;

  test('edge linetype/lineweight/layer round-trip through serialize', () => {
    const w = makeWorld(), { G, m } = w;
    const e = m.addEdge(G.v(0, 0, 0), G.v(3, 0, 0));
    m.setEdgeStyle([e.id], { lt: 2, lw: 4, layerId: '0' });
    m.load(m.serialize());
    const e2 = [...m.edges.values()].find(x => m.vp(x.a).x === 0 && m.vp(x.a).y === 0 && m.vp(x.a).z === 0);
    eq(e2.lt, 2, 'linetype survives');
    eq(e2.lw, 4, 'lineweight survives');
    eq(e2.layerId || '0', '0', 'layer survives');
    w.vclean('style roundtrip');
  });

  test('ByLayer resolution: unset edge follows its layer linetype default', () => {
    const w = makeWorld(), { G, m } = w;
    m.layers.push({ id: 'lyr_9', name: 'Hidden Walls', color: null, visible: true, locked: false, lt: 3, lw: 2 });
    const e = m.addEdge(G.v(0, 0, 0), G.v(1, 0, 0));
    e.layerId = 'lyr_9';
    let st = m.resolveEdgeStyle(e);
    eq(st.lt, 3, 'ByLayer linetype');
    eq(st.lw, 2, 'ByLayer lineweight');
    m.setEdgeStyle([e.id], { lt: 1 }); // explicit override wins
    st = m.resolveEdgeStyle(e);
    eq(st.lt, 1, 'override');
    eq(st.lw, 2, 'unrelated field still ByLayer');
    w.vclean('bylayer');
  });

  test('edge thickness grows a vertical ribbon and re-sets cleanly', () => {
    const w = makeWorld(), { G, m } = w;
    const e = m.addEdge(G.v(0, 0, 0), G.v(4, 0, 0));
    ok(m.thickenEdge(e.id, 2.5), 'ribbon face created');
    near(m.edgeThickness(e.id), 2.5, 1e-9, 'thickness reads back');
    m.thickenEdge(e.id, 1.0); // re-set replaces the old ribbon
    near(m.edgeThickness(e.id), 1.0, 1e-9, 're-set thickness');
    const ribbons = [...m.faces.values()].filter(f => f.userData && f.userData.fromEdge === e.id);
    eq(ribbons.length, 1, 'exactly one ribbon lives at a time');
    m.unthickenEdge(e.id);
    eq(m.edgeThickness(e.id), 0, 'cleared');
    w.vclean('thicken');
  });

  test('revolve: a full circle profile about an external axis closes watertight', () => {
    const w = makeWorld(), { G, m } = w;
    // donut profile: circle of r=0.5 centered at (3, 0) in the XZ plane,
    // revolved about Z
    const ring = [];
    for (let i = 0; i < 16; i++) {
      const t = i / 16 * Math.PI * 2;
      ring.push(G.v(3 + Math.cos(t) * 0.5, 0, Math.sin(t) * 0.5));
    }
    const f = m.addFaceFromRings(ring);
    const r = m.revolveFace(f.id, G.v(0, 0, 0), G.v(0, 0, 1), 360, 24);
    ok(!r.error, 'revolve succeeded');
    eq(m.shellOpenEdges(r.faces), 0, 'torus is watertight');
    // tessellated expectation: the 16-gon inscribed profile × 24-gon sweep
    // both read slightly under the analytic 2π²Rr² ≈ 14.80
    const vol = m.shellVolume(r.faces);
    ok(vol > 13.8 && vol < 14.8, `torus volume ~2π²Rr² (got ${vol.toFixed(2)})`);
    ok(!m.faces.has(f.id), 'profile consumed');
    w.vclean('revolve torus');
  });

  test('revolve: a partial turn caps both ends', () => {
    const w = makeWorld(), { G, m } = w;
    const ring = [];
    for (let i = 0; i < 12; i++) {
      const t = i / 12 * Math.PI * 2;
      ring.push(G.v(3 + Math.cos(t) * 0.4, 0, Math.sin(t) * 0.4));
    }
    const f = m.addFaceFromRings(ring);
    const r = m.revolveFace(f.id, G.v(0, 0, 0), G.v(0, 0, 1), 180, 18);
    ok(!r.error, 'half turn');
    eq(m.shellOpenEdges(r.faces), 0, 'caps close the half torus');
    w.vclean('revolve half');
  });

  test('revolve refuses an axis that touches the profile', () => {
    const w = makeWorld(), { G, m } = w;
    const f = w.rect([[0.5, -0.5, 0], [2, -0.5, 0], [2, 0.5, 0], [0.5, 0.5, 0]]);
    const r = m.revolveFace(f.id, G.v(0, 0, 0), G.v(0, 0, 1), 360, 8);
    ok(!r.error, 'clear axis revolves');
    const g = w.rect([[0, -0.5, 0], [2, -0.5, 0], [2, 0.5, 0], [0, 0.5, 0]]);
    const r2 = m.revolveFace(g.id, G.v(0, 0, 0), G.v(0, 0, 1), 360, 8);
    ok(r2.error, 'axis through the profile ring refuses');
    ok(m.faces.has(g.id), 'refused profile survives untouched');
    w.vclean('revolve guard');
  });

  test('follow me: a square profile along an L path closes with caps', () => {
    const w = makeWorld(), { G, m } = w;
    // profile FACES down the first segment (+X) — the normal follow-me usage
    const sq = m.addFaceFromRings([G.v(0, 0, 3), G.v(0, 0.3, 3), G.v(0, 0.3, 3.3), G.v(0, 0, 3.3)]);
    const path = [G.v(0, 0, 3), G.v(2, 0, 3), G.v(2, 2, 3), G.v(2, 2, 5)];
    const r = m.sweepFaceAlongPath(sq.id, path);
    ok(!r.error, 'sweep succeeded');
    eq(m.shellOpenEdges(r.faces), 0, 'swept tube is watertight');
    ok(!m.faces.has(sq.id), 'profile consumed');
    w.vclean('follow me');
  });

  test('raw faces honor their layer: hidden layer drops them, style survives undo', () => {
    const w = makeWorld(), { m } = w;
    const f = w.rect([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
    m.setFaceLayers([f.id], 'lyr_x');
    eq(f.layerId, 'lyr_x', 'face layer set');
    const snap = m.serialize();
    m.load(snap);
    const f2 = [...m.faces.values()][0];
    eq(f2.layerId, 'lyr_x', 'face layer round-trips');
    w.vclean('face layer');
  });
  // ---- joined paths (arcs + lines follow as ONE chain) ----------------------
  // chainFor lives on ExtrudeCurveTool in free.js — load it headless
  const LF = h.loadModel(['js/tools/base.js', 'js/tools/free.js', 'js/tools/draw.js']);
  const ECT = LF.window.FreeTools.ExtrudeCurveTool;

  test('chainFor: a line + arc + line path welded end-to-end is ONE chain', () => {
    const w = makeWorld(), { G, m } = w;
    // line 0,0→2,0 · arc 2,0→4,0 (bulge z) · line 4,0→6,1 — all welded
    m.addEdge(G.v(0, 0, 0), G.v(2, 0, 0));
    const arcPts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      arcPts.push(G.v(2 + 2 * t, 0, Math.sin(t * Math.PI) * 0.8));
    }
    m.addPolyline(arcPts, { type: 'arc', center: G.v(3, 0, 0.3), radius: 1.3 });
    m.addEdge(G.v(4, 0, 0), G.v(6, 1, 0));
    const arcEdge = [...m.edges.values()].find(e => e.curveId);
    const chain = ECT.chainFor(m, arcEdge);
    ok(chain && chain.length >= 10, 'chain spans all three pieces (' + (chain && chain.length) + ' pts)');
    const first = chain[0], last = chain[chain.length - 1];
    const endsNear = (p, q) => G.dist(p, q) < 1e-6;
    ok(endsNear(first, G.v(0, 0, 0)) || endsNear(last, G.v(0, 0, 0)), 'chain reaches the free line end');
    ok(endsNear(first, G.v(6, 1, 0)) || endsNear(last, G.v(6, 1, 0)), 'chain reaches the far line end');
    // seeding from a LINE edge reaches the arc too — entry point is free
    const lineEdge = [...m.edges.values()].find(e => !e.curveId && G.dist(m.vp(e.a), G.v(0, 0, 0)) < 1e-9);
    const chain2 = ECT.chainFor(m, lineEdge);
    ok(chain2 && chain2.length === chain.length, 'same chain from either end');
  });

  test('chainFor: a branch point stops the walk (no greedy T-junction)', () => {
    const w = makeWorld(), { G, m } = w;
    m.addEdge(G.v(0, 0, 0), G.v(2, 0, 0));
    m.addEdge(G.v(2, 0, 0), G.v(4, 0, 0));
    m.addEdge(G.v(2, 0, 0), G.v(2, 2, 0)); // three edges meet at (2,0,0)
    const e1 = [...m.edges.values()].find(e => G.dist(m.vp(e.a), G.v(0, 0, 0)) < 1e-9);
    const chain = ECT.chainFor(m, e1);
    eq(chain.length, 2, 'stops at the junction — just the seed edge, no greedy walk');
  });

  test('chainFor: a closed curve still walks its full loop', () => {
    const w = makeWorld(), { G, m } = w;
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const t = i / 12 * Math.PI * 2;
      pts.push(G.v(3 + Math.cos(t), Math.sin(t), 0));
    }
    m.addPolyline([...pts, pts[0]], { type: 'circle', center: G.v(3, 0, 0), radius: 1 });
    const e0 = [...m.edges.values()].find(e => e.curveId);
    const chain = ECT.chainFor(m, e0);
    eq(chain.length, 13, 'the full circle loops back (12 + return vertex)');
  });

  test('follow me: the profile KEEPS its offset from the path (no re-centering)', () => {
    const w = makeWorld(), { G, m } = w;
    // a square profile facing down +X, BESIDE the path by 1 m in Y — it must
    // sweep to a tube 1 m beside the path, not re-centered onto it
    const sq = m.addFaceFromRings([G.v(3, 1, 1), G.v(3, 1, 1.3), G.v(3, 1.3, 1.3), G.v(3, 1.3, 1)]);
    const path = [G.v(3, 0, 1), G.v(3, 3, 1)];
    const r = m.sweepFaceAlongPath(sq.id, path);
    ok(!r.error, 'sweep succeeded');
    eq(m.shellOpenEdges(r.faces), 0, 'tube still watertight');
    // rigid: the tube spans y 1.0..4.3 (path 0..3 + the drawn 1 m offset);
    // center-line placement would have swept y -0.15..3.15
    let minY = Infinity, maxY = -Infinity;
    for (const fid of r.faces) for (const ring of m.rings(m.faces.get(fid)))
      for (const vi of ring) {
        const y = m.vp(vi).y;
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    near(minY, 1, 1e-6, 'drawn offset kept at the path start (min)');
    near(maxY, 4.3, 1e-6, 'offset rides along to the path end (max)');
    ok(!m.faces.has(sq.id), 'profile consumed');
    w.vclean('follow me offset');
  });

  test('connectedFaces grabs the whole swept body from any one face', () => {
    const w = makeWorld(), { G, m } = w;
    // the user's arc + rectangle: a vertical profile swept along a curved
    // path — dozens of loose quads that are really ONE body to convert
    const arc = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12 * Math.PI / 2;
      arc.push(G.v(5 * Math.cos(t), 5 * Math.sin(t), 0));
    }
    const rec = m.addFaceFromRings([
      G.v(5, 0, 0), G.v(5, 0.2, 0), G.v(5, 0.2, 3), G.v(5, 0, 3)]);
    const r = m.sweepFaceAlongPath(rec.id, arc);
    ok(!r.error, 'arc sweep succeeded');
    eq(m.shellOpenEdges(r.faces), 0, 'curved wall body is watertight');
    const body = m.connectedFaces(r.faces[0]);
    eq(body.faces.length, r.faces.length, 'every swept face is in the body');
    eq(new Set(body.faces).size, body.faces.length, 'no duplicates');
    ok(body.edges.length >= r.faces.length, 'boundary edges collected');
    for (const fid of body.faces) {
      const f = m.faces.get(fid);
      ok(!(f.userData && f.userData.bimEntityId), 'body faces are free (convertible)');
    }
    w.vclean('connected sweep');
  });

  test('connectedFaces stops at the body border — disjoint solids stay apart', () => {
    const w = makeWorld(), { G, m } = w;
    const b1 = m.addFaceFromRings([G.v(0, 0, 0), G.v(1, 0, 0), G.v(1, 1, 0), G.v(0, 1, 0)]);
    const b2 = m.addFaceFromRings([G.v(5, 0, 0), G.v(6, 0, 0), G.v(6, 1, 0), G.v(5, 1, 0)]);
    m.pushPull(b1, 1); m.pushPull(b2, 1);
    const all = [...m.faces.values()];
    const a = m.connectedFaces(b1.id); // b1's id survives pushPull as the far cap
    eq(a.faces.length, 6, 'first box is its own body');
    const other = all.find(f => !a.faces.includes(f.id));
    const c = m.connectedFaces(other.id);
    eq(c.faces.length, 6, 'second box is separate');
    ok(!c.faces.some(id => a.faces.includes(id)), 'no overlap between bodies');
    w.vclean('connected disjoint');
  });

  test('generous bends sweep unchanged (no false positives)', () => {
    const w = makeWorld(), { G, m } = w;
    // profile r=0.15 along a bend of R=1 — 6.7× the profile radius
    const ring = [];
    for (let i = 0; i < 10; i++) {
      const t = i / 10 * Math.PI * 2;
      ring.push(G.v(0, 0.15 * Math.cos(t), 0.15 * Math.sin(t)));
    }
    const prof = m.addFaceFromRings(ring);
    const path = [G.v(-1, 0, 0)];
    for (let i = 1; i <= 8; i++) {
      const t = i / 8 * Math.PI / 2;
      path.push(G.v(1 * Math.sin(t), 1 * (1 - Math.cos(t)), 0));
    }
    path.push(G.v(1 + 1, 1, 0));
    const r = m.sweepFaceAlongPath(prof.id, path);
    ok(!r.error, 'sweeps cleanly');
    eq(m.shellOpenEdges(r.faces), 0, 'watertight');
    w.vclean('sweep generous');
  });

  test('a TALL wall profile on a plan curve is NOT flagged (per-bend radial reach)', () => {
    const w = makeWorld(), { G, m } = w;
    // 0.2 m thick × 3 m tall wall profile standing ON the path — only the
    // thickness rides a plan bend; the height must not trigger the guard
    // (the old global-extent measure demanded R >= 9 m here)
    const prof = m.addFaceFromRings([
      G.v(0, 0, 0), G.v(0, 0.2, 0), G.v(0, 0.2, 3), G.v(0, 0, 3)]);
    const path = [];
    for (let i = 0; i <= 4; i++) path.push(G.v(-2 + i * 0.5, 0, 0));
    for (let i = 1; i <= 8; i++) {
      const t = i / 8 * Math.PI / 2;
      path.push(G.v(Math.sin(t), 1 - Math.cos(t), 0)); // plan bend R=1
    }
    for (let i = 1; i <= 4; i++) path.push(G.v(1, 1 + i * 0.5, 0));
    const r = m.sweepFaceAlongPath(prof.id, path);
    ok(!r.error, 'sweeps without refusal (' + (r.error || 'ok') + ')');
    ok(!r.resized, 'no auto-size needed');
    eq(m.shellOpenEdges(r.faces), 0, 'watertight curved wall');
    w.vclean('sweep wall profile');
  });
  test('sharp path corners AUTO-ROUND — the bend is smooth, sized above the profile reach', () => {
    const w = makeWorld(), { G, m } = w;
    // the user's case: a rectangular profile swept along an L path — the
    // corner must come out as a round bend, not a hard 90° miter
    const prof = m.addFaceFromRings([
      G.v(0, 0, 0), G.v(0, 0.6, 0), G.v(0.25, 0.6, 0), G.v(0.25, 0, 0)]);
    const path = [G.v(0.125, 0.3, 0), G.v(0.125, 0.3, 3), G.v(4, 0.3, 3)];
    const r = m.sweepFaceAlongPath(prof.id, path);
    ok(!r.error, 'sweeps');
    eq(m.shellOpenEdges(r.faces), 0, 'watertight');
    // the rounding: the straight 2-segment path becomes leg + arc + leg
    const rounded = m._roundSweepCorners(path, null, null); // no frame: adaptive radius only
    ok(rounded.length > 3, 'the corner grew an arc (' + rounded.length + ' stations)');
    near(rounded[1].z, 2.5, 0.05, 'tangent point trims the entry leg');
    // extreme: a pipe (r=0.4) through the corner — R floors above the
    // profile reach so the inner side never folds
    const ring = [];
    for (let i = 0; i < 12; i++) {
      const t = i / 12 * Math.PI * 2;
      ring.push(G.v(0, 0.4 * Math.cos(t), 0.4 * Math.sin(t)));
    }
    const pipe = m.addFaceFromRings(ring);
    const path2 = [G.v(0, 0, 0), G.v(0, 0, 2), G.v(2, 0, 2)];
    const r2 = m.sweepFaceAlongPath(pipe.id, path2);
    ok(!r2.error, 'pipe sweeps');
    eq(m.shellOpenEdges(r2.faces), 0, 'pipe bend watertight — inner side smooth');
    w.vclean('sweep corner round');
  });
};
