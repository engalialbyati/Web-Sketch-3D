'use strict';
// features/columnrebar.js — the whole-column cage generator (FreeCAD
// ColumnReinforcement port): tie sets, corner main bars, L-hooks, two-ties
// six-bars, x/y direction sets, and the circular helix cage.
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

  function load() {
    const sandbox = { window: { addEventListener() { } }, console, Buffer, setTimeout, clearTimeout };
    const ctx = vm.createContext(sandbox);
    for (const f of ['js/geometry.js', 'js/tools/base.js', 'js/model.js', 'js/features/rebar.js', 'js/features/columnrebar.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
    if (!sandbox.window.ColumnRebar) throw new Error('ColumnRebar not exported');
    return sandbox.window;
  }
  const W = load();
  const CR = W.ColumnRebar;
  const { G, Model } = W;

  function column() {
    const m = new Model();
    const f = m.addFaceFromRings([G.v(0, 0, 0), G.v(0.3, 0, 0), G.v(0.3, 0.3, 0), G.v(0, 0.3, 0)]);
    m.pushPull(f, 3);
    return m;
  }
  const topFace = m => {
    for (const [id, f] of m.faces) {
      const n = G.norm(G.loopNormal(m.pts(f.loop)));
      if (n.z > 0.999) return id;
    }
    return null;
  };
  const baseTie = { l: 0.04, r: 0.04, t: 0.04, b: 0.04, front: 0.05, dia: 0.008,
    bentAngle: 135, bentFactor: 6, rounding: 0, mode: 'amount', value: 6 };
  const baseMain = { dia: 0.016, tOffset: 0.05, bOffset: 0.05, type: 'straight',
    hookAt: 'Top Inside', along: 'u', extension: 0.064, rounding: 1 };
  // straight-bar centerlines from a preview run (exact axis coordinates)
  const straightPaths = pv => pv.paths.filter(p => p.dia === baseMain.dia && p.pts.length === 2);

  test('single tie: tie set + 4 corner bars, loose and tagged', () => {
    const m = column();
    const res = CR.buildColumnCage(m, topFace(m), { type: 'singletie', tie: baseTie, main: baseMain });
    eq(res.ties, 6, '6 ties by amount');
    eq(res.bars, 4, '4 corner bars');
    const faces = res.ids.map(id => m.faces.get(id)).filter(Boolean);
    ok(faces.every(f => f.loose === true), 'cage faces are loose');
    ok(faces.every(f => f.userData && f.userData.rebar && f.userData.rebar.host === 'column'), 'tagged userData.rebar');
    // bar axes from the centerlines: cover + tie dia + r off each face
    const pv = CR.previewCage(m, topFace(m), { type: 'singletie', tie: baseTie, main: baseMain });
    const bars = straightPaths(pv);
    eq(bars.length, 4, '4 straight-bar centerlines');
    const xs = [...new Set(bars.map(b => +b.pts[0].x.toFixed(4)))].sort((a, b2) => a - b2);
    const ys = [...new Set(bars.map(b => +b.pts[0].y.toFixed(4)))].sort((a, b2) => a - b2);
    const c = 0.04 + 0.008 + 0.008;
    eq(xs.length, 2, 'two x cover lines');
    near(xs[0], c, 1e-6, 'left line at tie cover + tie dia + r');
    near(xs[1], 0.3 - c, 1e-6, 'right line');
    eq(ys.length, 2, 'two y cover lines');
    near(ys[0], c, 1e-6, 'bottom line');
    // bar ends at the bottom/top offsets (+r)
    near(bars[0].pts[0].z, 0.05 + 0.008, 1e-6, 'bottom end at offset + r');
    near(bars[0].pts[1].z, 3 - 0.05 - 0.008, 1e-6, 'top end at offset − r');
    ok(m.validate().ok, 'model stays valid');
  });

  test('two ties six bars: two ties per level + 6 bars', () => {
    const m = column();
    const res = CR.buildColumnCage(m, topFace(m), { type: 'twoties', tie: baseTie, main: baseMain });
    eq(res.ties, 12, '6 levels × 2 ties');
    eq(res.bars, 6, '6 main bars (4 corners + 2 middle)');
    const pv = CR.previewCage(m, topFace(m), { type: 'twoties', tie: baseTie, main: baseMain });
    const bars = straightPaths(pv);
    eq(bars.length, 6, '6 bar centerlines');
    const xs = [...new Set(bars.map(b => +b.pts[0].x.toFixed(3)))].sort((a, b2) => a - b2);
    eq(xs.length, 3, 'three x lines (left, middle, right)');
    near(xs[1], 0.15, 1e-6, 'middle pair on the center line');
  });

  test('multiple bars: x-dir sets between the corner lines at solved spacing', () => {
    const m = column();
    const p = { type: 'multiple', tie: baseTie, main: baseMain, xSets: [[1, 0.016], [1, 0.016]], ySets: [] };
    const res = CR.buildColumnCage(m, topFace(m), p);
    eq(res.bars, 8, '4 corner bars + 2 sets × 2 rows');
    const pv = CR.previewCage(m, topFace(m), p);
    const bars = straightPaths(pv);
    eq(bars.length, 8, '8 centerlines');
    const xs = [...new Set(bars.map(b => +b.pts[0].x.toFixed(4)))].sort((a, b2) => a - b2);
    // FreeCAD spacing: gaps = (span − Σ n·dia) / (N + 1) between everything
    const uL = 0.056, uR = 0.244;
    const s = (uR - uL - 0.016 - 2 * 0.016) / 3;
    eq(xs.length, 4, 'four x lines (2 corners + 2 set positions)');
    // gap s from the corner bar SURFACE (uL + mainR) to the set bar surface
    near(xs[1], uL + 0.008 + s + 0.008, 1e-4, 'first set bar at the solved spacing');
    near(xs[2], uR - 0.008 - s - 0.008, 1e-4, 'second set bar mirrored');
  });

  test('L-shaped mains: hooks turn at the top with a foot beyond the knee', () => {
    const m = column();
    const p = { type: 'singletie', tie: baseTie,
      main: { ...baseMain, type: 'lshape', hookAt: 'Top Inside', along: 'u', extension: 0.064, rounding: 1 } };
    const res = CR.buildColumnCage(m, topFace(m), p);
    const mains = res.ids.map(id => m.faces.get(id)).filter(f => f && f.userData.rebar.shape === 'lshape');
    ok(mains.length >= 4 * 10, `L-bar tube faces (${mains.length})`);
    const lens = [...new Set(mains.map(f => +f.userData.rebar.length.toFixed(3)))];
    ok(lens.every(L => L > 2.88), `L-bars longer than the bare leg (${lens})`);
    // centerline geometry: the top-most points must LEAVE the corner line
    // (the foot runs inside along x) — an inside hook points toward center
    const pv = CR.previewCage(m, topFace(m), p);
    const hooks = pv.paths.filter(q => q.dia === 0.016 && q.pts.length > 2);
    eq(hooks.length, 4, '4 hooked centerlines');
    for (const hb of hooks) {
      const end = hb.pts[hb.pts.length - 1];       // the foot's far end
      const baseX = hb.pts[0].x;
      ok(Math.abs(end.x - baseX) > 0.02, `foot extends inward (dx=${(end.x - baseX).toFixed(3)})`);
      ok(end.z > 2.8, 'hook at the top end');
    }
    ok(m.validate().ok, 'model stays valid');
  });

  test('circular: helix length ≈ turns × √((2πR)² + pitch²), bars on the circle', () => {
    const m = column();
    const p = { type: 'circular', tie: baseTie, main: baseMain,
      circ: { sideCover: 0.04, helixDia: 0.008, pitch: 0.1, helixTOffset: 0.05, helixBOffset: 0.05,
        mode: 'number', value: 6 } };
    const res = CR.buildColumnCage(m, topFace(m), p);
    eq(res.bars, 6, '6 vertical bars');
    const faces = res.ids.map(id => m.faces.get(id)).filter(Boolean);
    const helix = faces.find(f => f.userData.rebar.shape === 'helical');
    ok(!!helix, 'helix bar exists');
    const R = 0.15 - 0.04 - 0.004;
    const height = 3 - 2 * (0.05 + 0.004);
    const turns = height / 0.1;
    // true helix arc length includes the pitch's vertical contribution
    near(helix.userData.rebar.length, turns * Math.hypot(2 * Math.PI * R, 0.1), 0.15, 'helix centerline length');
    eq(faces.filter(f => f.userData.rebar.shape === 'straight').length > 0, true, 'main bars exist');
    const rMain = 0.15 - 0.04 - 0.008 - 0.008;
    const pv = CR.previewCage(m, topFace(m), p);
    const bars = pv.paths.filter(q => q.dia === baseMain.dia && q.pts.length === 2);
    eq(bars.length, 6, '6 bar centerlines');
    for (const bar of bars)
      near(Math.hypot(bar.pts[0].x - 0.15, bar.pts[0].y - 0.15), rMain, 1e-6, 'main bar on the circle');
  });

  test('preview sink records paths without touching the model', () => {
    const m = column();
    const before = m.faces.size;
    const pv = CR.previewCage(m, topFace(m), { type: 'singletie', tie: baseTie, main: baseMain });
    eq(m.faces.size, before, 'no faces created');
    ok(pv.paths.length === 10, `10 recorded centerlines (6 ties + 4 bars) — got ${pv.paths.length}`);
    ok(pv.paths.every(p => p.pts.length >= 2 && p.dia > 0), 'paths carry points and diameters');
  });

  test('a side face is refused with the right guidance', () => {
    const m = column();
    let side = null;
    for (const [id, f] of m.faces) {
      const n = G.norm(G.loopNormal(m.pts(f.loop)));
      if (Math.abs(n.y) > 0.999) { side = id; break; }
    }
    const res = CR.buildColumnCage(m, side, { type: 'singletie', tie: baseTie, main: baseMain });
    ok(/TOP or BOTTOM/.test(res.error), 'guidance to pick the top/bottom face');
  });
};
