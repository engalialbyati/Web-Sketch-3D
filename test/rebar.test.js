'use strict';
// features/rebar.js — single rebar shapes (FreeCAD-Reinforcement port):
// host-face frame extraction, straight / L-shape / stirrup centerlines,
// amount-or-spacing distribution, and the loose tube sweep (addRebarPath).
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

  function loadRebar() {
    const sandbox = { window: { addEventListener() { } }, console, Buffer, setTimeout, clearTimeout };
    const ctx = vm.createContext(sandbox);
    for (const f of ['js/geometry.js', 'js/tools/base.js', 'js/model.js', 'js/features/rebar.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
    if (!sandbox.window.Rebar) throw new Error('Rebar not exported');
    return sandbox.window;
  }
  const W = loadRebar();
  const R = W.Rebar;
  const { G, Model } = W;

  // a column host: 0.30 x 0.30 x 3.00 m box, welded (pushPull output)
  function column() {
    const m = new Model();
    const f = m.addFaceFromRings([G.v(0, 0, 0), G.v(0.3, 0, 0), G.v(0.3, 0.3, 0), G.v(0, 0.3, 0)]);
    m.pushPull(f, 3);
    return m;
  }
  const faceWithNormal = (m, n) => {
    for (const [id, f] of m.faces) {
      const nn = G.loopNormal(m.pts(f.loop));
      if (Math.abs(G.dot(G.norm(nn), n) - 1) < 1e-6) return id;
    }
    return null;
  };

  test('faceFrame: extents, depth, and the outward normal of a column face', () => {
    const m = column();
    const fid = faceWithNormal(m, G.v(0, 1, 0)); // +y side face
    ok(!!fid, 'found the +y face');
    const fr = R.faceFrame(m, fid);
    ok(!!fr, 'frame built');
    near(fr.depth, 0.3, 1e-9, 'material depth behind the side face = 0.3');
    ok(G.dot(fr.n, G.v(0, 1, 0)) > 0.999, 'n points outward (+y)');
    near(fr.u1 - fr.u0, 0.3, 1e-6, 'face length in u');
    near(fr.v1 - fr.v0, 3.0, 1e-6, 'face height in v');
    // mapping round-trips a face point
    const p = fr.map(fr.u0 + 0.1, fr.v0 + 0.5);
    near(G.dot(p, fr.n), G.dot(fr.C, fr.n), 1e-9, 'map stays on the face plane');
  });

  test('faceFrame: top face depth = column height', () => {
    const m = column();
    const fid = faceWithNormal(m, G.v(0, 0, 1));
    const fr = R.faceFrame(m, fid);
    near(fr.depth, 3.0, 1e-9, 'depth from the top face = 3.0');
    near(fr.u1 - fr.u0, 0.3, 1e-6, 'plan u');
    near(fr.v1 - fr.v0, 0.3, 1e-6, 'plan v');
  });

  test('straightPath: vertical corner bar at covers, to the bar surface', () => {
    const m = column();
    const fr = R.faceFrame(m, faceWithNormal(m, G.v(0, 1, 0)));
    const p = { orientation: 'Vertical', side: 'Left', cover: 0.04, lb: 0.05, rt: 0.05, dia: 0.016 };
    const pts = R.straightPath(fr, p);
    eq(pts.length, 2, 'a line');
    const r = 0.008;
    near(pts[0].x, fr.u0 + 0.04 + r, 1e-9, 'x at left cover + r (cover to bar surface)');
    const v0 = G.dot(pts[0], fr.v), v1 = G.dot(pts[1], fr.v);
    near(v0, fr.v0 + 0.05 + r, 1e-9, 'bottom end at bottom cover + r');
    near(v1, fr.v1 - 0.05 - r, 1e-9, 'top end at top cover + r');
  });

  test('lshapePath: Bottom Left corner L with rounded knee', () => {
    const m = column();
    const fr = R.faceFrame(m, faceWithNormal(m, G.v(0, 1, 0)));
    const p = { orientation: 'Bottom Left', l: 0.04, r: 0.04, t: 0.05, b: 0.05, dia: 0.016, rounding: 2 };
    const pts = R.lshapePath(fr, p);
    ok(pts.length > 3, `knee is rounded (${pts.length} points)`);
    const us = pts.map(q => G.dot(q, fr.u)), vs = pts.map(q => G.dot(q, fr.v));
    near(Math.min(...us), fr.u0 + 0.04 + 0.008, 1e-9, 'leg hugs the left cover line');
    near(Math.min(...vs), fr.v0 + 0.05 + 0.008, 1e-9, 'foot hugs the bottom cover line');
    near(Math.max(...us), fr.u1 - 0.04 - 0.008, 1e-9, 'foot reaches the right cover line');
    near(Math.max(...vs), fr.v1 - 0.05 - 0.008, 1e-9, 'leg reaches the top cover line');
  });

  test('stirrupPath: rounded tie inset by covers, both hooks dive into the core', () => {
    const m = column();
    const fr = R.faceFrame(m, faceWithNormal(m, G.v(0, 0, 1))); // top face (plan)
    const p = { l: 0.04, r: 0.04, t: 0.04, b: 0.04, dia: 0.008, rounding: 2, bentAngle: 135, bentFactor: 6 };
    const pts = R.stirrupPath(fr, p);
    ok(pts.length >= 10, `tessellated tie (${pts.length} points)`);
    const us = pts.map(q => G.dot(q, fr.u)), vs = pts.map(q => G.dot(q, fr.v));
    const r = 0.004, Rk = 0.016; // bar radius, corner mandrel 2×dia
    // NOTHING extends past the tie lines: the extreme tie centerline is the
    // hook corner itself — no overshoot, so no tube enters the cover zone
    near(Math.min(...us), fr.u0 + 0.04 + r, 2e-3, 'leftmost point is the hook corner (no overshoot)');
    near(Math.max(...us), fr.u1 - 0.04 - r, 2e-3, 'right leg at cover');
    near(Math.min(...vs), fr.v0 + 0.04 + r, 2e-3, 'bottom leg at cover');
    near(Math.max(...vs), fr.v1 - 0.04 - r, 2e-3, 'top leg at cover');
    // the SHARP hook corner (FreeCAD p1) sits exactly on both cover lines —
    // both hook tails anchor there as one compact seismic hook
    const corner = pts.find(q => Math.abs(G.dot(q, fr.u) - (fr.u0 + 0.04 + r)) < 1e-6
      && Math.abs(G.dot(q, fr.v) - (fr.v1 - 0.04 - r)) < 1e-6);
    ok(corner, 'hook corner A sits on both cover lines');
    // left leg runs straight from that corner down to the bottom-left arc
    const legIdx = pts.indexOf(corner);
    ok(legIdx > 0 && Math.abs(G.dot(pts[legIdx + 1], fr.u) - (fr.u0 + 0.04 + r)) < 1e-6
      && G.dot(pts[legIdx + 1], fr.v) < G.dot(corner, fr.v), 'left leg runs down the cover line');
    // hooks: the two extreme hook ends must sit INSIDE the cover ring (core
    // side), diving from the corner along the SAME inward diagonal (the lap)
    const first = pts[0], last = pts[pts.length - 1];
    ok(G.dot(first, fr.v) < fr.v1 - 0.04, 'start hook dives below the top cover line');
    ok(G.dot(last, fr.v) < fr.v1 - 0.04, 'end hook dives below the top cover line');
    ok(G.dot(first, fr.u) > fr.u0 + 0.04, 'start hook is on the core side of the left cover line');
    ok(G.dot(last, fr.u) > fr.u0 + 0.04, 'end hook is on the core side of the left cover line');
    near(first.x, last.x, 1e-9); near(first.y, last.y, 1e-9);
    near(first.z, last.z, 1e-9, 'the lap closes on the same diagonal tip');
  });

  test('distribute: amount mode solves spacing; spacing mode solves count', () => {
    const fr = { depth: 3.0 };
    const amt = R.distribute(fr, { mode: 'amount', value: 16, front: 0.05, dia: 0.008 });
    eq(amt.count, 16, '16 ties');
    near(amt.off, 0.05 + 0.004, 1e-12, 'first tie at front + r');
    near(amt.spacing, (3.0 - 2 * 0.054) / 15, 1e-9, 'spacing spread between equal end covers');
    // spacing 0.15 over depth 3: n = ceil((3 - 0.008)/0.15) + 1 = 21
    const sp = R.distribute(fr, { mode: 'spacing', value: 0.15, front: 0.05, dia: 0.008 });
    eq(sp.count, Math.ceil((3.0 - 0.008) / 0.15) + 1, 'FreeCAD count formula');
    ok(sp.off + sp.spacing * (sp.count - 1) < 3.0, 'last tie inside the column');
  });

  test('buildRebars: straight bars — count, covers, loose tubes, meta', () => {
    const m = column();
    const fid = faceWithNormal(m, G.v(0, 1, 0));
    const res = R.buildRebars(m, fid, 'straight', {
      orientation: 'Vertical', side: 'Left', cover: 0.04, lb: 0.05, rt: 0.05,
      front: 0.04, dia: 0.016, mode: 'amount', value: 2,
    });
    eq(res.count, 2, 'two bars across the 0.3 depth');
    ok(res.ids.length >= 2, 'faces created');
    const faces = res.ids.map(id => m.faces.get(id)).filter(Boolean);
    ok(faces.every(f => f.loose === true), 'rebar faces are loose');
    ok(faces.every(f => f.userData && f.userData.rebar && f.userData.rebar.shape === 'straight'),
      'userData.rebar tags every face');
    ok(faces.every(f => f.userData.rebar.length > 2.8), 'bar length spans the column');
    // bar axes: ring vertices sit ±0.008 around the axis — the midpoint of a
    // bar's y-extent is its axis. Front bar at 0.048 off the +y face, rear
    // bar at 0.048 off the -y face (front cover + dia/2 at BOTH ends).
    const ys = [];
    for (const f of faces) for (const v of f.loop) ys.push(m.vp(v).y);
    const front = ys.filter(y => y > 0.15), rear = ys.filter(y => y <= 0.15);
    near((Math.max(...front) + Math.min(...front)) / 2, 0.3 - 0.048, 1e-3, 'front bar at front cover');
    near((Math.max(...rear) + Math.min(...rear)) / 2, 0.048, 1e-3, 'rear bar at the far cover');
  });

  test('addRebarPath: closed watertight tube of the right radius', () => {
    const m = new Model();
    const ids = m.addRebarPath([G.v(0, 0, 0), G.v(1, 0, 0)], 0.016);
    ok(ids.length >= 10, `tube faces (${ids.length})`);
    // position-keyed audit over just the tube: every edge used exactly twice
    const pk = q => Math.round(q.x * 1e5) + ',' + Math.round(q.y * 1e5) + ',' + Math.round(q.z * 1e5);
    const cnt = new Map();
    for (const id of ids) {
      const f = m.faces.get(id);
      for (let i = 0; i < f.loop.length; i++) {
        const ka = pk(m.vp(f.loop[i])), kb = pk(m.vp(f.loop[(i + 1) % f.loop.length]));
        const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        cnt.set(k, (cnt.get(k) || 0) + 1);
      }
    }
    ok(![...cnt.values()].some(c => c !== 2), 'tube is watertight');
    // radius: every vertex is 8mm off the axis
    const f0 = m.faces.get(ids[0]);
    const ds = m.pts(f0.loop).map(p => Math.hypot(p.y, p.z));
    ok(ds.every(d => Math.abs(d - 0.008) < 1e-9), 'radius = dia/2');
  });

  test('a full column cage: ties + corner bars coexist without touching the host', () => {
    const m = column();
    const before = new Set([...m.faces.keys()]);
    const ties = R.buildRebars(m, faceWithNormal(m, G.v(0, 0, 1)), 'stirrup', {
      l: 0.04, r: 0.04, t: 0.04, b: 0.04, front: 0.05, dia: 0.008,
      rounding: 2, bentAngle: 135, bentFactor: 6, mode: 'spacing', value: 0.2,
    });
    const bars = R.buildRebars(m, faceWithNormal(m, G.v(0, 1, 0)), 'straight', {
      orientation: 'Vertical', side: 'Left', cover: 0.04, lb: 0.05, rt: 0.05,
      front: 0.04, dia: 0.016, mode: 'amount', value: 2,
    });
    ok(ties.count >= 15, `~0.2 m spacing over 3 m (${ties.count} ties)`);
    ok(bars.count === 2 && bars.ids.length, 'corner bars built');
    // host faces untouched, and no rebar face welded to a host vertex id
    const created = [...m.faces.keys()].filter(id => !before.has(id));
    ok(created.every(id => m.faces.get(id).loose === true), 'every created face is loose');
    const rebarIds = created;
    ok(rebarIds.length === ties.ids.length + bars.ids.length, 'nothing else was created');
    ok(m.validate().ok, 'model stays valid');
  });
};
