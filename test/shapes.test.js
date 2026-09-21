'use strict';
// shapes.test.js — the remaining FreeCAD single-bar shapes: U-shape,
// bent-shape (zigzag), helical; and the BBS aggregation math.
module.exports = h => {
  const { test, ok, eq, near } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const sandbox = { window: { addEventListener() { } }, console, Buffer, setTimeout, clearTimeout };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/geometry.js', 'js/tools/base.js', 'js/model.js', 'js/features/rebar.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  const { G, Model, Rebar } = sandbox.window;

  const fr = { n: G.v(0, 0, 1), u: G.v(1, 0, 0), v: G.v(0, 1, 0),
    u0: -0.15, u1: 0.15, v0: -0.15, v1: 0.15, depth: 0.3, map: (a, b) => G.v(a, b, 0) };
  const us = q => q.map(p => p.x);
  const vs = q => q.map(p => p.y);

  test('ushapePath: three legs inset by covers, orientation flips the opening', () => {
    const p = { l: 0.03, r: 0.03, t: 0.03, b: 0.03, dia: 0.012, rounding: 2, orientation: 'Bottom' };
    const q = Rebar.ushapePath(fr, p);
    ok(q.length >= 4, 'tessellated');
    const L = -0.15 + 0.03 + 0.006, R = 0.15 - 0.03 - 0.006;
    const B = -0.15 + 0.03 + 0.006, T = 0.15 - 0.03 - 0.006;
    near(Math.min(...us(q)), L, 1e-9, 'left leg at the cover');
    near(Math.max(...us(q)), R, 1e-9, 'right leg at the cover');
    near(Math.min(...vs(q)), B, 1e-9, 'bottom leg at the cover');
    const topsX = q.filter(s => s.y > T - 1e-6).map(s => +s.x.toFixed(4));
    ok(topsX.length >= 2 && topsX.every(x2 => Math.abs(x2 - L) < 1e-3 || Math.abs(x2 - R) < 1e-3),
      'BOTTOM orientation: the top holds only the two leg ends (open)');
    const q2 = Rebar.ushapePath(fr, { ...p, orientation: 'Top' });
    near(Math.min(...vs(q2)), B, 1e-9, 'TOP orientation: legs reach the bottom cover');
    ok(Math.max(...vs(q2)) <= T + 1e-9, 'TOP orientation: nothing above the top cover');
    near(Math.max(...vs(q2)), T, 1e-9, 'top legs at the cover');
  });

  test('bentPath: zigzag - end legs, ramps across the middle', () => {
    const p = { l: 0.03, r: 0.03, t: 0.03, b: 0.03, dia: 0.012, rounding: 2,
      bentLength: 0.05, bentAngle: 135, orientation: 'Bottom' };
    const q = Rebar.bentPath(fr, p);
    ok(q.length >= 6, 'six corners tessellated');
    const ys = vs(q);
    near(Math.max(...ys), 0.15 - 0.03 - 0.006, 1e-9, 'end legs at the top cover');
    near(Math.min(...ys), -0.15 + 0.03 + 0.006, 1e-9, 'ramp feet at the bottom cover');
    // middle must dip below the ends (a real zigzag)
    const mid = q[Math.floor(q.length / 2)];
    ok(mid.y < Math.max(...ys) - 0.05, 'diagonal ramp crosses the section');
  });

  test('helicalPath: constant-radius screw at the pitch into the host', () => {
    const p = { side: 0.03, t: 0.05, b: 0.05, dia: 0.008, pitch: 0.1 };
    const q = Rebar.helicalPath(fr, p);
    ok(q.length >= 48, `tessellated (${q.length} pts = 2 turns x 24)`);
    const Rc = 0.15 - 0.03 - 0.004; // min(0.3)/2 - side - r
    for (const s of q) {
      near(Math.hypot(s.x, s.y), Rc, 1e-9, 'constant radius');
      ok(s.z <= -0.05 + 1e-9 && s.z >= -(0.254 + 1e-6), 'screws INTO the host');
    }
    near(q[0].z, -(0.05 + 0.004), 1e-9, 'starts at the top offset');
    const size = 0.3 - 0.1;
    near(q[q.length - 1].z, -(0.05 + 0.004 + size), 1e-9, 'ends at the bottom offset');
    // one full turn advances exactly one pitch
    const n = q.length - 1, i = Math.round(n / (size / 0.1));
    near(q[i].z - q[0].z, -0.1, 2e-3, 'one turn = one pitch');
  });

  test('buildRebars creates loose tagged tubes for the new shapes', () => {
    const m = new Model();
    const f = m.addFaceFromRings([G.v(0, 0, 0), G.v(0.3, 0, 0), G.v(0.3, 0.3, 0), G.v(0, 0.3, 0)]);
    m.pushPull(f, 3);
    let top = null;
    for (const [id, ff] of m.faces) {
      const n = G.norm(G.loopNormal(m.pts(ff.loop)));
      if (!top && n.z > 0.999) top = id;
    }
    const res = Rebar.buildRebars(m, top, 'ushape', {
      orientation: 'Bottom', l: 0.04, r: 0.04, t: 0.04, b: 0.04, dia: 0.012, rounding: 2,
      front: 0.05, mode: 'amount', value: 3 });
    eq(res.count, 3, '3 U-bars');
    const faces = res.ids.map(id => m.faces.get(id));
    ok(faces.every(x => x.userData && x.userData.rebar && x.userData.rebar.shape === 'ushape'),
      'tagged ushape');
  });

  test('BBS aggregation math: weight 0.006165 d^2 kg/m', () => {
    // 8 mm bar, 1.5 m, 20 bars
    const kgM = 0.006165 * 8 * 8;
    near(kgM, 0.3946, 1e-3, '8 mm = 0.395 kg/m');
    near(kgM * 1.5 * 20, 11.837, 1e-2, 'total kg for the row');
    const kgM16 = 0.006165 * 16 * 16;
    near(kgM16, 1.578, 1e-2, '16 mm = 1.578 kg/m');
  });
};
