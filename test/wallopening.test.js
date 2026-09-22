'use strict';
// wallopening.test.js — MNL-66(20) Phase 5, WALL-206/207/208: reinforcement
// around hosted door/window/opening cuts. The wall mesh splits around the
// hole, trim pairs land at head/sill and jambs (24 in development), and
// 48 in diagonal bars cross the corners.
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const L = loadModel(['js/tools/base.js', 'js/features/rebar.js',
    'js/features/columnrebar.js', 'js/features/elementrebar.js']);
  const { G } = L;
  const Model = L.Model;
  const { ElementRebar: ER } = L.sandbox.window;

  const wallWorld = (thickness, height, len) => {
    const m = new Model();
    const hw = thickness / 2;
    const ring = [
      G.v(0, hw, 0), G.v(len, hw, 0), G.v(len, hw, height), G.v(0, hw, height)];
    const before = new Set(m.faces.keys());
    const f = m.addFaceFromRings(ring);
    m.pushPull(f, -thickness);
    const faces = [...m.faces.keys()].filter(id => !before.has(id));
    const ent = { id: 'w1', type: 'wall',
      params: { base: [0, 0, 0], end: [len, 0, 0], thickness, height }, faces: [], edges: [] };
    for (const fid of faces) {
      const f2 = m.faces.get(fid);
      if (!f2.userData) f2.userData = {};
      f2.userData.bimEntityId = 'w1'; f2.userData.bimType = 'wall';
    }
    ent.faces = faces;
    return { m, ent };
  };
  const wp = extra => ({ type: 'wall', wall: Object.assign({
    cover: 0.04, vDia: 0.012, vSpacing: 0.2, hDia: 0.012, hSpacing: 0.2,
    twoCurtains: true, vOff: 0.05 }, extra) });
  const host = (id, t, w, hgt, sill) => ({ id, type: 'door', faces: [],
    params: { hostWallId: 'w1', distanceFromStart: t, width: w, height: hgt, sillHeight: sill } });

  const straight = pv => pv.paths.filter(q => q.pts.length === 2);
  const crosses = (q, axis, at, lo, hi) => axis === 'x'
    ? q.pts[0].x < at && q.pts[1].x > at && q.pts[0].z > lo && q.pts[0].z < hi
    : q.pts[0].z < at && q.pts[1].z > at && q.pts[0].x > lo && q.pts[0].x < hi;

  test('WALL-206 door: the mesh splits around the hole', () => {
    const w = wallWorld(0.2, 3, 4);
    const door = host('d1', 2, 1.2, 2.2, 0);
    const pv = ER.previewElementRebar(w.m, w.ent.faces[0], wp(), [w.ent, door]);
    ok(!pv.error, pv.error || 'no error');
    eq(pv.openings, 1, 'one opening detected');
    const st = straight(pv);
    // door interior: x in (1.4, 2.6), z in (0, 2.2)
    eq(st.filter(q => crosses(q, 'z', 1.0, 1.41, 2.59)).length, 0,
      'no vertical passes through the door');
    eq(st.filter(q => crosses(q, 'x', 2.0, 0.01, 2.2 - 0.09)).length, 0,
      'no horizontal passes through the door (below the head trim band)');
    // verticals inside the span resume ABOVE the head
    const stubs = st.filter(q => Math.abs(q.pts[0].x - q.pts[1].x) < 1e-9
      && q.pts[0].x > 1.41 && q.pts[0].x < 2.59);
    ok(stubs.length >= 10, `${stubs.length} above-head stubs (2 curtains)`);
    for (const q of stubs) near(Math.min(q.pts[0].z, q.pts[1].z), 2.2, 1e-9,
      'stub resumes at the head');
    // horizontals inside the band split into left + right runs
    const left = st.filter(q => Math.abs(q.pts[0].z - q.pts[1].z) < 1e-9
      && q.pts[0].z < 2.2 - 1e-6 && Math.abs(q.pts[1].x - 1.4) < 1e-6);
    ok(left.length >= 20, `${left.length} left segments end at the jamb (2 curtains)`);
  });

  test('WALL-206 trim pairs: head/sill horizontals + jamb verticals, 24 in dev', () => {
    const w = wallWorld(0.2, 3, 4);
    const win = host('win1', 2, 1.5, 1.2, 0.9);
    const res = ER.buildElementRebar(w.m, w.ent.faces[0], wp(), [w.ent, win]);
    ok(!res.error, res.error || 'no error');
    eq(res.openings, 1);
    const rb = [...new Map([...w.m.faces.values()]
      .filter(f => f.userData && f.userData.rebar)
      .map(f => [f.userData.rebar.pid, f.userData.rebar])).values()];
    const trimH = rb.filter(r => r.role === 'trim-h');
    const trimV = rb.filter(r => r.role === 'trim-v');
    const diag = rb.filter(r => r.role === 'diag');
    // window: head pair + sill pair, 2 curtains -> 4 + 4
    eq(trimH.length, 8, `head+sill pairs on both curtains (${trimH.length})`);
    eq(trimV.length, 8, `jamb pairs on both curtains (${trimV.length})`);
    // trim spans reach 24 in past the opening: 1.25-0.61 .. 2.75+0.61
    const pv2 = ER.previewElementRebar(w.m, w.ent.faces[0], wp(), [w.ent, win]);
    const spans = pv2.paths.filter(q => q.pts.length === 2
      && Math.abs(q.pts[0].z - q.pts[1].z) < 1e-9
      && q.pts[0].x < 0.8 && q.pts[1].x > 3.2);
    ok(spans.length >= 8, `${spans.length} trim bars span 0.79..3.21 (24 in past the jambs)`);
    // WALL-208: 4 corners x 2 curtains of 48 in diagonals
    eq(diag.length, 8, `corner diagonals (${diag.length})`);
    // committed trim bars are real 2-point paths
    ok(trimH.length + trimV.length + diag.length > 0, 'roles tagged for the BBS');
  });

  test('WALL-208: floor-level door drops sill steel and bottom diagonals', () => {
    const w = wallWorld(0.2, 3, 4);
    const door = host('d2', 2, 1.2, 2.2, 0);
    const res = ER.buildElementRebar(w.m, w.ent.faces[0], wp(), [w.ent, door]);
    ok(!res.error, res.error || 'no error');
    const rb = [...new Map([...w.m.faces.values()]
      .filter(f => f.userData && f.userData.rebar)
      .map(f => [f.userData.rebar.pid, f.userData.rebar])).values()];
    // head pair only (no sill at the floor): 2 bars x 2 curtains
    eq(rb.filter(r => r.role === 'trim-h').length, 4, 'head pair only');
    // all 4 corners: the bottom ones clamp to the wall base (MNL-208
    // shortens the 48 in bar where the wall is tight instead of omitting)
    eq(rb.filter(r => r.role === 'diag').length, 8, '4 corners x 2 curtains, clamped to fit');
    // jambs still full: 4 per curtain
    eq(rb.filter(r => r.role === 'trim-v').length, 8, 'jamb pairs');
  });

  test('an opening hard against the wall end keeps one jamb', () => {
    const w = wallWorld(0.2, 3, 4);
    const door = host('d3', 0.6, 1.2, 2.2, 0); // s0 = 0, s1 = 1.2
    const res = ER.buildElementRebar(w.m, w.ent.faces[0], wp(), [w.ent, door]);
    ok(!res.error, res.error || 'no error');
    const rb = [...new Map([...w.m.faces.values()]
      .filter(f => f.userData && f.userData.rebar)
      .map(f => [f.userData.rebar.pid, f.userData.rebar])).values()];
    const jamb = rb.filter(r => r.role === 'trim-v');
    // start jamb is off the wall (s0 = 0): only the s1 jamb survives -> 2 x 2
    eq(jamb.length, 4, `one jamb pair on the far side (${jamb.length})`);
  });

  test('WALL-100A: a wall over a slab gets starter dowels into it', () => {
    const w = wallWorld(0.2, 3, 4);
    // host slab: top at z=0 under the wall base 0
    const host = { id: 's1', type: 'floor', faces: [],
      params: { thickness: 0.15, regions: [{ outer: [[0, -1, 0], [5, -1, 0], [5, 1, 0], [0, 1, 0]], holes: [] }] } };
    const res = ER.buildElementRebar(w.m, w.ent.faces[0], wp(), [w.ent, host]);
    ok(!res.error, res.error || 'no error');
    const rb = [...new Map([...w.m.faces.values()]
      .filter(f => f.userData && f.userData.rebar)
      .map(f => [f.userData.rebar.pid, f.userData.rebar])).values()];
    const dowels = rb.filter(r => r.role === 'wall-dowel');
    // sv stays at the requested 0.2 (rho satisfied) -> 21 stations x 2 curtains
    ok(dowels.length === 42, `${dowels.length} dowels (21 stations x 2 curtains)`);
    // geometry: L-bars cross the joint - leg inside the slab, lap above
    const dPaths = [...w.m.faces.values()].filter(f => f.userData
      && f.userData.rebar && f.userData.rebar.role === 'wall-dowel');
    const zs = dPaths.flatMap(f => w.m.pts(f.loop).map(q => q.z));
    const lap = Math.max(0.3, 1.3 * 47.5 * 0.8 * 0.012);
    near(Math.max(...zs), lap, 0.02, 'dowels rise the Class B lap above the slab');
    ok(Math.min(...zs) < -0.02, 'dowel legs reach into the slab');
    // no host -> no dowels (regression)
    const w2 = wallWorld(0.2, 3, 4);
    ER.buildElementRebar(w2.m, w2.ent.faces[0], wp(), [w2.ent]);
    const none = [...w2.m.faces.values()].filter(f => f.userData
      && f.userData.rebar && f.userData.rebar.role === 'wall-dowel');
    ok(none.length === 0, 'no host below: no dowels');
  });

  test('a wall without openings reports none (regression)', () => {
    const w = wallWorld(0.2, 3, 4);
    const pv = ER.previewElementRebar(w.m, w.ent.faces[0], wp(), [w.ent]);
    ok(!pv.error, pv.error || 'no error');
    ok(!pv.openings, 'no openings reported');
    ok(pv.bars > 20, `${pv.bars} bars as before`);
  });
};
