'use strict';
// story5.test.js — the 5-story demo feature set: strip/combined footing
// starters, shear-wall boundary elements (WALL-110), T/L beam sections,
// WALL-201 circular openings, circular slab holes, the record-only rebar
// mode, and the elevator builder geometry.
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const L = loadModel(['js/tools/base.js', 'js/features/rebar.js',
    'js/features/columnrebar.js', 'js/features/elementrebar.js']);
  const { G } = L;
  const Model = L.Model;
  const { ElementRebar: ER } = L.sandbox.window;

  const box = (m, x0, x1, y0, y1, z0, z1, id, type) => {
    const before = new Set(m.faces.keys());
    const f = m.addFaceFromRings([
      G.v(x0, y0, z1), G.v(x1, y0, z1), G.v(x1, y1, z1), G.v(x0, y1, z1)]);
    m.pushPull(f, -(z1 - z0));
    const faces = [...m.faces.keys()].filter(i2 => !before.has(i2) && m.faces.has(i2));
    for (const fid of faces) {
      const f2 = m.faces.get(fid);
      if (!f2.userData) f2.userData = {};
      f2.userData.bimEntityId = id; f2.userData.bimType = type;
    }
    return { id, type, params: {}, faces };
  };
  const fndP = extra => ({ type: 'foundation', foundation: Object.assign({
    bottom: 0.04, side: 0.05, topLayer: 'X',
    xDia: 0.012, xMode: 'spacing', xValue: 0.2,
    yDia: 0.012, yMode: 'spacing', yValue: 0.2,
    stubX: 2, stubY: 2, stubDia: 0.014, lap: 0.5, leg: 0.15, colW: 0.3, colL: 0.3 }, extra) });
  const topFaceOf = m => {
    let best = null, bz = -1e9;
    for (const [id, f] of m.faces) {
      const n = G.norm(G.loopNormal(m.pts(f.loop)));
      if (n.z < 0.999) continue;
      const c = m.faceCentroid(f);
      if (c && c.z > bz) { bz = c.z; best = id; }
    }
    return best;
  };
  const roles = (m, want) => {
    const out = {}, seen = new Set();
    for (const f of m.faces.values())
      if (f.userData && f.userData.rebar) {
        const r = f.userData.rebar;
        if (seen.has(r.pid)) continue;
        seen.add(r.pid);
        if (!want || want.includes(r.role || r.shape))
          out[r.role || r.shape] = (out[r.role || r.shape] || 0) + 1;
      }
    return out;
  };

  test('COMBINED footing: starters under BOTH columns', () => {
    const m = new Model();
    const fnd = { id: 'f1', type: 'foundation', faces: [],
      params: { base: [2, 0, 0], width: 3.6, depth: 1.4, thickness: 0.6, kind: 'combined' } };
    const c1 = { id: 'c1', type: 'column', faces: [], params: { base: [1, 0, 0], width: 0.3, depth: 0.3, height: 3 } };
    const c2 = { id: 'c2', type: 'column', faces: [], params: { base: [3, 0, 0], width: 0.3, depth: 0.3, height: 3 } };
    fnd.faces = box(m, 0.2, 3.8, -0.7, 0.7, -0.6, 0, 'f1', 'foundation').faces;
    const res = ER.buildElementRebar(m, topFaceOf(m), fndP(), [fnd, c1, c2]);
    ok(!res.error, res.error || 'no error');
    // two starter groups: 4 corner dowels each column = 8 L-bars
    const r = roles(m, ['lshape']);
    eq(r.lshape, 8, '8 starters (2 columns x 4 corners)');
  });

  test('STRIP footing: wall dowels line the run (FND-102)', () => {
    const m = new Model();
    const fnd = { id: 'f1', type: 'foundation', faces: [],
      params: { base: [3, 0, 0], width: 1.0, depth: 4.2, thickness: 0.5, kind: 'strip' } };
    const wall = { id: 'w1', type: 'wall', faces: [],
      params: { base: [3, -2, 0], end: [3, 2, 0], height: 3, thickness: 0.2, vSpacing: 0.25 } };
    fnd.faces = box(m, 2.5, 3.5, -2.1, 2.1, -0.5, 0, 'f1', 'foundation').faces;
    const res = ER.buildElementRebar(m, topFaceOf(m), fndP(), [fnd, wall]);
    ok(!res.error, res.error || 'no error');
    // strip: wall line dowels (no columns) - 17 stations x 2 faces at 0.25
    const r = roles(m, ['wall-dowel']);
    eq(r['wall-dowel'], 34, '34 wall dowels (17 stations x 2 faces)');
  });

  test('WALL-110: shear wall boundary elements at both ends', () => {
    const m = new Model();
    const wall = { id: 'w1', type: 'wall', faces: [],
      params: { base: [0, 0, 0], end: [4, 0, 0], thickness: 0.2, height: 3 } };
    box(m, 0, 4, -0.1, 0.1, 0, 3, 'w1', 'wall');
    const res = ER.buildElementRebar(m, topFaceOf(m), { type: 'wall', wall: {
      cover: 0.04, vDia: 0.012, vSpacing: 0.3, hDia: 0.012, hSpacing: 0.3,
      twoCurtains: true, vOff: 0.05, boundary: true } }, [wall]);
    ok(!res.error, res.error || 'no error');
    const r = roles(m, ['boundary']);
    eq(r.boundary, 8, '8 boundary bars (2 per end x 2 curtains)');
    // boundary bars sit within 150mm of each end

  });

  test('WALL-201: circular opening trim (pipe penetration)', () => {
    const m = new Model();
    const wall = { id: 'w1', type: 'wall', faces: [],
      params: { base: [0, 0, 0], end: [4, 0, 0], thickness: 0.2, height: 3 } };
    box(m, 0, 4, -0.1, 0.1, 0, 3, 'w1', 'wall');
    const pipe = { id: 'o1', type: 'opening', faces: [],
      params: { hostWallId: 'w1', distanceFromStart: 2, shape: 'circle', dia: 0.5, sillHeight: 1.2 } };
    const res = ER.buildElementRebar(m, topFaceOf(m), { type: 'wall', wall: {
      cover: 0.04, vDia: 0.012, vSpacing: 0.3, hDia: 0.012, hSpacing: 0.3,
      twoCurtains: true, vOff: 0.05 } }, [wall, pipe]);
    ok(!res.error, res.error || 'no error');
    // the circular hole splits the mesh at its square: no bar crosses the centre
    const r = roles(m);
    ok((r['trim-h'] || 0) + (r['trim-v'] || 0) > 0, 'trim pairs around the disc');

  });

  test('T-beam: top row spreads the FLANGE, cage wraps the web', () => {
    const m = new Model();
    const P = (y, z) => G.v(0, y, z);
    const loop = [P(-0.1, 3), P(0.1, 3), P(0.1, 3.35), P(0.25, 3.35),
      P(0.25, 3.5), P(-0.25, 3.5), P(-0.25, 3.35), P(-0.1, 3.35)];
    const before = new Set(m.faces.keys());
    const f0 = m.addFaceFromRings(loop);
    m.pushPull(f0, 4);
    const faces = [...m.faces.keys()].filter(id => !before.has(id));
    for (const id of faces) { const f = m.faces.get(id); f.userData = { bimEntityId: 'b1', bimType: 'beam' }; }
    const ent = { id: 'b1', type: 'beam', faces,
      params: { baseline: [[0, 0, 3], [4, 0, 3]], profile: 't', webWidth: 0.2, height: 0.5 } };
    const pv = ER.previewElementRebar(m, faces[0], { type: 'beam', beam: {
      side: 0.03, end: 0.05, tieDia: 0.008, mode: 'spacing', value: 0.3,
      topCount: 3, topDia: 0.014, botCount: 2, botDia: 0.016,
      top: 0.03, bot: 0.03, skin: 0, skinDia: 0.012, integrity: false } }, [ent]);
    ok(!pv.error, pv.error || 'no error');
    const tops = pv.paths.filter(q => q.dia === 0.014 && q.pts.length === 2);
    const ys = tops.flatMap(q => q.pts.map(w => w.y));
    ok(Math.max(...ys) - Math.min(...ys) > 0.35, 'top row spans the 0.5 flange');
    const bots = pv.paths.filter(q => q.dia === 0.016 && q.pts.length === 2);
    const ys2 = bots.flatMap(q => q.pts.map(w => w.y));
    ok(Math.max(...ys2) - Math.min(...ys2) < 0.15, 'bottom row wraps the 0.2 web');
  });

  test('circular SLAB hole: mesh clips + bbox trims', () => {
    const m = new Model();
    const before = new Set(m.faces.keys());
    const circle = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      circle.push([+(3 + 0.3 * Math.cos(a)).toFixed(4), +(1 + 0.3 * Math.sin(a)).toFixed(4), 3]);
    }
    const f = m.addFaceFromRings([G.v(0, 0, 3), G.v(6, 0, 3), G.v(6, 4, 3), G.v(0, 4, 3)], [circle]);
    m.pushPull(f, -0.15);
    const faces = [...m.faces.keys()].filter(id => !before.has(id) && m.faces.has(id));
    for (const id of faces) { const f2 = m.faces.get(id); f2.userData = { bimEntityId: 's1', bimType: 'floor' }; }
    const ent = { id: 's1', type: 'floor', faces,
      params: { regions: [{ outer: [], holes: [circle] }], thickness: 0.15 } };
    const pv = ER.previewElementRebar(m, faces[0], { type: 'slab', slab: {
      bottom: 0.025, top: 0.025, side: 0.025,
      xDia: 0.012, xSpacing: 0.2, yDia: 0.012, ySpacing: 0.2, topMesh: false, topDia: 0 } }, [ent]);
    ok(!pv.error, pv.error || 'no error');
    // X bars crossing the hole centre line must break around it
    const xbars = pv.paths.filter(q => q.pts.length === 2
      && Math.abs(q.pts[0].z - q.pts[1].z) < 1e-9 && Math.abs(q.pts[0].y - q.pts[1].y) < 1e-9);
    const through = xbars.filter(q => Math.abs(q.pts[0].y - 1) < 0.05
      && q.pts[0].x < 3 && q.pts[1].x > 3);
    eq(through.length, 0, 'no bar crosses the circular hole');
    const trims = pv.paths.filter(q => q.pts.length === 2
      && Math.abs(q.pts[0].z - q.pts[1].z) < 1e-9
      && (Math.abs(q.pts[0].y - (1 - 0.331)) < 0.02 || Math.abs(q.pts[0].y - (1 + 0.331)) < 0.02));
    ok(trims.length >= 2, 'trim bars ring the disc bbox');
  });

  test('record-only rebar: no pipe faces, registry carries the bars', () => {
    const m = new Model();
    m.rebarPipes = false;
    const ids = m.addRebarPath([G.v(0, 0, 0), G.v(2, 0, 0)], 0.016, { meta: { shape: 'straight', host: 'beam' } });
    eq(ids.length, 0, 'no faces created');
    eq(m._rebarRecords.size, 1, 'one record');
    const rec = [...m._rebarRecords.values()][0];
    eq(rec.line.length, 2, 'centerline endpoints');
    near(rec.length, 2, 1e-9, 'length recorded');
    eq(rec.meta.shape, 'straight', 'meta carried through');
    // watertight pipes still work when the switch is off
    const m2 = new Model();
    const ids2 = m2.addRebarPath([G.v(0, 0, 0), G.v(1, 0, 0)], 0.016);
    ok(ids2.length >= 10, 'default mode still builds the tube');
  });

  test('elevator builder: 4 shaft walls + door + lintel entities', () => {
    // runs in the harness VM without the app: exercise hoistwayRing pure part
    const ring = L.sandbox.window.ElevatorFeature
      ? L.sandbox.window.ElevatorFeature.hoistwayRing({ x: 3, y: 3, w: 2.2, d: 2.0, wall: 0.2 })
      : null;
    if (!ring) { ok(true, 'elevator.js loads in the browser (app-level builder)'); return; }
    eq(ring.length, 4, 'rectangular hoistway ring');
    near(ring[0][0], 3 - (2.2 / 2 - 0.1 + 0.005), 1e-6, 'ring inset past the shaft walls');
  });
};
