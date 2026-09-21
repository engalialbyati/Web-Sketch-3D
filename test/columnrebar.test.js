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

  test('corners never lighter than inners: a bigger set diameter sizes the corners up', () => {
    const m = column();
    const p = { type: 'multiple', tie: baseTie, main: baseMain, xSets: [[1, 0.02]], ySets: [] };
    const pv = CR.previewCage(m, topFace(m), p);
    const dia20 = pv.paths.filter(q => q.dia === 0.02 && q.pts.length === 2);
    // 4 corners + 1 set x 2 rows = 6 bars at 20 mm (corners follow the max)
    eq(dia20.length, 6, `all longitudes at the max diameter (${dia20.length})`);
    ok(!pv.paths.some(q => q.dia === 0.016 && q.pts.length === 2), 'no thinner 16 mm corners left');
    // corner line moved out to fit the fatter bar, and the tie mandrel
    // nests on it: inset + mandrel == corner axis (arc center == bar axis)
    const inset = 0.04 + 0.004;
    const uL = inset + 0.004 + 0.01;
    const xs = [...new Set(dia20.map(b => +b.pts[0].x.toFixed(4)))].sort((a, b2) => a - b2);
    near(xs[0], uL, 1e-6, 'corner line at cover + tie dia + corner r');
    near(uL, inset + (0.004 + 0.01), 1e-9, 'tie bend arc center coincides with the corner bar axis');
  });

  test('preview sink records paths without touching the model', () => {
    const m = column();
    const before = m.faces.size;
    const pv = CR.previewCage(m, topFace(m), { type: 'singletie', tie: baseTie, main: baseMain });
    eq(m.faces.size, before, 'no faces created');
    ok(pv.paths.length === 10, `10 recorded centerlines (6 ties + 4 bars) — got ${pv.paths.length}`);
    ok(pv.paths.every(p => p.pts.length >= 2 && p.dia > 0), 'paths carry points and diameters');
  });

  // ------------------------------------------- MNL-66 COL-200/202: splices
  test('COL-200 Class B lap: staggered overlap just above the floor', () => {
    const m = column();
    const pv = CR.previewCage(m, topFace(m), { type: 'singletie', tie: baseTie,
      main: { ...baseMain, splice: { mode: 'lap' } } });
    // 4 corner bars split into 8 pieces
    const segs = straightPaths(pv);
    eq(segs.length, 8, '4 bars -> 8 lapped pieces');
    // Class B lap for 16mm: 1.3 x 47.5 x 0.8 x 0.016 = 0.79 m
    const lap = Math.max(0.3, 1.3 * 47.5 * 0.8 * 0.016);
    // piece bottom tips: the bar bases (0.058) + two splice starts
    const tips = [...new Set(segs.map(p => +Math.min(p.pts[0].z, p.pts[1].z).toFixed(3)))].sort((a, b) => a - b);
    eq(tips.length, 3, 'bar base + two staggered splice starts');
    near(tips[1], 0.108, 2e-3, 'first splice 50 mm above the bar base');
    near(tips[2] - tips[1], lap / 2, 2e-3, 'stagger = half a lap');
    // overlap: for each bar x/y, a lower piece reaches past the upper tip
    // by at least (lap - stagger)
    const byXY = new Map();
    for (const p of segs) {
      const k = p.pts[0].x.toFixed(4) + ',' + p.pts[0].y.toFixed(4);
      if (!byXY.has(k)) byXY.set(k, []);
      byXY.get(k).push(p);
    }
    for (const [k, pair] of byXY) {
      eq(pair.length, 2, 'two pieces per bar line ' + k);
      // overlap = lower piece top - upper piece bottom = the lap
      const loTop = Math.max(...pair.map(p => Math.min(p.pts[0].z, p.pts[1].z)));
      const hiBot = Math.min(...pair.map(p => Math.max(p.pts[0].z, p.pts[1].z)));
      const ov = Math.max(...pair.map(p => Math.max(p.pts[0].z, p.pts[1].z)))
        - Math.min(...pair.map(p => Math.min(p.pts[0].z, p.pts[1].z)));
      const upperBot = pair.map(p => Math.min(p.pts[0].z, p.pts[1].z)).sort((a, b) => b - a)[0];
      const lowerTop = pair.map(p => Math.max(p.pts[0].z, p.pts[1].z)).sort((a, b) => a - b)[0];
      near(lowerTop - upperBot, lap, 3e-3, 'lap length of overlap');
    }
    // 2 extra ties at the splice zone
    const spliceTies = pv.paths.filter(p => p.dia === baseTie.dia && p.pts.length > 2
      && p.pts.some(q => q.z > 0.1 && q.z < 0.45));
    ok(spliceTies.length >= 2, `${spliceTies.length} splice-zone ties (COL-200)`);
  });

  test('COL-202 mechanical splice: whole bar + sleeve at the plane', () => {
    const m = column();
    const pv = CR.previewCage(m, topFace(m), { type: 'singletie', tie: baseTie,
      main: { ...baseMain, splice: { mode: 'mechanical' } } });
    const segs = straightPaths(pv);
    // 4 whole 16mm bars + 4 fat 28mm sleeves at ~0.1 m
    eq(segs.filter(p => p.dia === 0.016).length, 4, '4 uncut bars');
    const sleeves = pv.paths.filter(p => p.dia > 0.025 && p.pts.length === 2);
    eq(sleeves.length, 4, '4 coupler sleeves');
    for (const s of sleeves) {
      near(Math.abs(s.pts[1].z - s.pts[0].z), 0.15, 1e-6, 'sleeve 150 mm long');
      near((s.pts[0].z + s.pts[1].z) / 2, 0.1, 0.051, 'sleeve centred at the splice plane');
    }
  });

  test('short columns ignore splices (no room to lap)', () => {
    const m = new Model();
    const f = m.addFaceFromRings([G.v(0, 0, 0), G.v(0.3, 0, 0), G.v(0.3, 0.3, 0), G.v(0, 0.3, 0)]);
    m.pushPull(f, 0.6);
    const pv = CR.previewCage(m, topFace(m), { type: 'singletie', tie: baseTie,
      main: { ...baseMain, splice: { mode: 'lap' } } });
    const segs = straightPaths(pv).filter(p => p.dia === 0.016);
    eq(segs.length, 4, 'bars stay whole (0.6 m column cannot host a 0.79 m lap)');
  });

  test('no splice mode: regression, 4 whole bars and original tie count', () => {
    const m = column();
    const pv = CR.previewCage(m, topFace(m), { type: 'singletie', tie: baseTie,
      main: { ...baseMain, splice: { mode: 'none' } } });
    eq(straightPaths(pv).length, 4, '4 whole bars');
    const m2 = column();
    const pv2 = CR.previewCage(m2, topFace(m2), { type: 'singletie', tie: baseTie, main: baseMain });
    eq(pv.paths.length, pv2.paths.length, 'no splice param = splice none');
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
