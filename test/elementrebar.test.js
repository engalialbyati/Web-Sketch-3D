'use strict';
// features/elementrebar.js — Whole-Element Reinforcement: one pick on any
// face of a beam / column / foundation / floor generates the full cage.
// Beam ties+rows, column reuse, footing mesh+starters, slab mesh clipping.
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

  function load() {
    const sandbox = { window: { addEventListener() { } }, console, Buffer, setTimeout, clearTimeout };
    const ctx = vm.createContext(sandbox);
    for (const f of ['js/geometry.js', 'js/tools/base.js', 'js/model.js',
      'js/features/rebar.js', 'js/features/columnrebar.js', 'js/features/elementrebar.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
    if (!sandbox.window.ElementRebar) throw new Error('ElementRebar not exported');
    return sandbox.window;
  }
  const W = load();
  const ER = W.ElementRebar;
  const { G, Model } = W;

  // ------------------------------------------------------------ world bits
  function box(m, x0, x1, y0, y1, z0, z1) {
    const before = new Set(m.faces.keys());
    const f = m.addFaceFromRings([
      G.v(x0, y0, z1), G.v(x1, y0, z1), G.v(x1, y1, z1), G.v(x0, y1, z1)]);
    m.pushPull(f, -(z1 - z0));
    const faces = [...m.faces.keys()].filter(id => !before.has(id));
    return faces;
  }
  function stamp(m, faces, id, type, params) {
    for (const fid of faces) {
      const f = m.faces.get(fid);
      if (!f.userData) f.userData = {};
      f.userData.bimEntityId = id;
      f.userData.bimType = type;
    }
    return { id, type, params, faces };
  }
  const faceWithNormal = (m, nz) => {
    for (const [id, f] of m.faces) {
      const n = G.norm(G.loopNormal(m.pts(f.loop)));
      if (Math.abs(n.x - nz[0]) < 1e-6 && Math.abs(n.z - nz[2]) < 1e-6) return id;
    }
    return null;
  };
  // push-pull caps share +z winding in this model — pick faces by centroid
  const faceAtZ = (m, z) => {
    for (const [id, f] of m.faces) {
      const c = m.faceCentroid(f);
      if (c && Math.abs(c.z - z) < 1e-6) return id;
    }
    return null;
  };

  // ------------------------------------------------------------------ beam
  const beamParams = () => ({ type: 'beam', beam: {
    side: 0.03, end: 0.05, tieDia: 0.008, bentAngle: 135, bentFactor: 6,
    mode: 'amount', value: 5,
    topCount: 2, topDia: 0.014, botCount: 3, botDia: 0.016,
    top: 0.03, bot: 0.03, skin: 0, skinDia: 0.012,
  } });
  function beamWorld() {
    const m = new Model();
    const bp = { baseline: [[0, 0, 3], [4, 0, 3]], profile: 'rectangular',
      webWidth: 0.3, height: 0.5, referenceLevelId: 'lvl1', zJustification: 'Bottom' };
    const ent = stamp(m, box(m, 0, 4, -0.15, 0.15, 3, 3.5), 'b1', 'beam', bp);
    return { m, ent };
  }

  test('beam: ties along the span + top/bottom rows at the covers', () => {
    const { m, ent } = beamWorld();
    const pv = ER.previewElementRebar(m, faceAtZ(m, 3.0), beamParams(), [ent]);
    ok(!pv.error, pv.error || 'no error');
    eq(pv.ties, 5, '5 ties by amount');
    eq(pv.bars, 5, '2 top + 3 bottom bars');
    const ties = pv.paths.filter(p => p.dia === 0.008 && p.pts.length > 2);
    eq(ties.length, 5, 'tie centerlines');
    const xs = ties.map(p => p.pts.reduce((s, q) => s + q.x, 0) / p.pts.length).sort((a, b) => a - b);
    near(xs[0], 0.054, 1e-9, 'first tie at end cover + tie r');
    near(xs[4], 4 - 0.054, 1e-9, 'last tie at the far end cover');
    const bars = pv.paths.filter(p => p.pts.length === 2);
    const bot = bars.filter(p => Math.abs(p.pts[0].z - 3.046) < 1e-9);
    const top = bars.filter(p => Math.abs(p.pts[0].z - 3.455) < 1e-9);
    eq(bot.length, 3, 'bottom row 46mm above the soffit (cover+tie+r)');
    eq(top.length, 2, 'top row 45mm below the top');
    const ys = bot.map(p => p.pts[0].y).sort((a, b) => a - b);
    near(ys[0], -0.104, 1e-9, 'bottom row hugs the side');
    near(ys[1], 0, 1e-9, 'even spread across the web');
    for (const b of bars) {
      near(Math.abs(b.pts[1].x - b.pts[0].x), 3.9, 1e-9, 'bars the clear span long');
      near(b.pts[0].z, b.pts[1].z, 1e-9, 'bars level');
    }
  });

  test('beam: skin bars stack between the rows; committed cage is loose + tagged', () => {
    const { m, ent } = beamWorld();
    const p = beamParams();
    p.beam.skin = 1;
    const res = ER.buildElementRebar(m, faceWithNormal(m, [1, 0, 0] /* other end face too */), p, [ent]);
    ok(!res.error && res.ids.length > 40, `${res.ids ? res.ids.length : 0} faces`);
    eq(res.bars, 7, '2 top + 3 bottom + 2 skin');
    const faces = res.ids.map(id => m.faces.get(id)).filter(Boolean);
    ok(faces.every(f => f.loose === true), 'rebar faces are loose');
    ok(faces.every(f => f.userData && f.userData.rebar && f.userData.rebar.host === 'beam'),
      'userData.rebar.host = beam');
  });

  // --------------------------------------------------------------- column
  test('column: whole-element from a SIDE face (auto top face), circular→helix', () => {
    const m = new Model();
    const ent = stamp(m, box(m, 0, 0.3, 0, 0.3, 0, 3), 'c1', 'column',
      { base: [0.15, 0.15, 0], width: 0.3, depth: 0.3, height: 3 });
    const p = { type: 'column', column: {
      type: 'singletie',
      tie: { l: 0.04, r: 0.04, t: 0.04, b: 0.04, front: 0.05, dia: 0.008,
        bentAngle: 135, bentFactor: 6, rounding: 0, mode: 'amount', value: 6 },
      main: { dia: 0.016, tOffset: 0.05, bOffset: 0.05, type: 'straight' },
    } };
    const res = ER.buildElementRebar(m, faceWithNormal(m, [1, 0, 0]), p, [ent]);
    ok(!res.error, res.error || 'no error');
    eq(res.ties, 6, '6 ties');
    eq(res.bars, 4, '4 corner mains');
    ok(res.ids.length > 100 && res.ids.every(id => m.faces.has(id)), 'faces created and live');

    // circular column (octagonal top face) auto-selects the helix cage
    const m2 = new Model();
    const ring = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      ring.push(G.v(0.15 + 0.15 * Math.cos(a), 0.15 + 0.15 * Math.sin(a), 3));
    }
    const before = new Set(m2.faces.keys());
    const f = m2.addFaceFromRings(ring);
    m2.pushPull(f, -3);
    const ent2 = stamp(m2, [...m2.faces.keys()].filter(id => !before.has(id)), 'c2', 'column',
      { base: [0.15, 0.15, 0], width: 0.3, depth: 0.3, height: 3 });
    const res2 = ER.buildElementRebar(m2, ent2.faces[0], { type: 'column', column: p.column }, [ent2]);
    ok(!res2.error, res2.error || 'circular ok');
    const helix = [...m2.faces.values()].filter(ff => ff.userData && ff.userData.rebar
      && ff.userData.rebar.shape === 'helical');
    ok(helix.length > 0, 'circular section got the helix cage automatically');
  });

  // ----------------------------------------------------------- foundation
  const fndParams = () => ({ type: 'foundation', foundation: {
    bottom: 0.04, side: 0.05, topLayer: 'X',
    xDia: 0.012, xMode: 'amount', xValue: 5,
    yDia: 0.012, yMode: 'amount', yValue: 5,
    stubX: 3, stubY: 3, stubDia: 0.014, lap: 0.5, leg: 0.15, colW: 0.4, colL: 0.4,
  } });
  function fndWorld() {
    const m = new Model();
    const ent = stamp(m, box(m, 0, 1.2, 0, 1.2, -0.5, 0), 'f1', 'foundation',
      { base: [0.6, 0.6, 0], width: 1.2, depth: 1.2, thickness: 0.5, baseLevel: 'lvl0' });
    return { m, ent };
  }

  test('foundation: layered two-way mesh + L starter stubs', () => {
    const { m, ent } = fndWorld();
    const pv = ER.previewElementRebar(m, faceWithNormal(m, [0, 0, 1]), fndParams(), [ent]);
    ok(!pv.error, pv.error || 'no error');
    eq(pv.bars, 10, '5 X + 5 Y mesh bars');
    const bars = pv.paths.filter(p => p.pts.length === 2);
    const yLayer = bars.filter(p => Math.abs(p.pts[0].z - -0.454) < 1e-9);
    const xLayer = bars.filter(p => Math.abs(p.pts[0].z - -0.442) < 1e-9);
    eq(yLayer.length, 5, 'Y layer rests on the bottom cover');
    eq(xLayer.length, 5, 'X layer stacks on the Y layer (topLayer X)');
    near(Math.min(...yLayer.map(b => b.pts[0].x)), 0.056, 1e-9, 'Y bar row starts at the side cover');
    for (const b of yLayer) near(Math.abs(b.pts[0].y - b.pts[1].y), 1.088, 1e-9, 'Y bar the clear length');
    const xs = xLayer.map(p => p.pts[0].y).sort((a, b) => a - b);
    near(xs[0], 0.056, 1e-9, 'X bar row at the side cover');
    near(xs[2], 0.6, 1e-9, 'middle row centered');
    // starters: 3/side X + 3/side Y − 4 shared corners = 8
    const stubs = pv.paths.filter(p => p.dia === 0.014 && p.pts.length > 2);
    eq(stubs.length, 8, '8 starter stubs');
    eq(pv.ties, 8, 'starters counted');
    for (const s of stubs) {
      const zs = s.pts.map(q => q.z);
      near(Math.max(...zs), 0.5, 1e-6, 'riser reaches pad top + lap');
      near(Math.min(...zs), -0.429, 1e-6, 'leg sits just above the bottom mesh');
      ok(s.pts[0].z < s.pts[s.pts.length - 1].z, 'leg first, riser up');
    }
    ok(!pv.column, 'no column above');
  });

  test('foundation: column standing on the pad overrides the starter section', () => {
    const { m, ent } = fndWorld();
    const col = { id: 'cx', type: 'column',
      params: { base: [0.6, 0.6, 0], width: 0.3, depth: 0.3, height: 3 } };
    const pv = ER.previewElementRebar(m, faceWithNormal(m, [0, 0, 1]), fndParams(), [ent, col]);
    ok(pv.column === true, 'column detected');
    const stubs = pv.paths.filter(p => p.dia === 0.014 && p.pts.length > 2);
    eq(stubs.length, 8, 'still 8 starters (3/side on a 0.3 section)');
    const xs = [...new Set(stubs.map(p => p.pts[p.pts.length - 1].x).map(v => v.toFixed(4)))].map(Number).sort((a, b) => a - b);
    near(xs[0], 0.45, 1e-9, 'starters on the column face lines');
    near(xs[1], 0.6, 1e-9, 'centered on the column');
  });

  // ----------------------------------------------------------------- slab
  function slabWorld(withHole) {
    const m = new Model();
    const z = 3.2, t = 0.2;
    const outer = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]]
      .map(q => G.v(q[0], q[1], z));
    const holes = withHole
      ? [[[3, 0.5], [4, 0.5], [4, 1.5], [3, 1.5]].map(q => G.v(q[0], q[1], z))] : [];
    const before = new Set(m.faces.keys());
    const f = m.addFaceFromRings(outer, holes);
    m.pushPull(f, -t);
    const ent = stamp(m, [...m.faces.keys()].filter(id => !before.has(id)), 's1', 'floor',
      { regions: [{ outer: withHole ? [[3, 0.5], [4, 0.5], [4, 1.5], [3, 1.5]] : [] }], thickness: t });
    return { m, ent };
  }
  const slabParams = () => ({ type: 'slab', slab: {
    bottom: 0.025, top: 0.025, side: 0.025,
    xDia: 0.012, xSpacing: 0.2, yDia: 0.012, ySpacing: 0.2,
    topMesh: false, topDia: 0,
  } });

  test('slab: mesh clipped to the L-outline', () => {
    const { m, ent } = slabWorld(false);
    const pv = ER.previewElementRebar(m, faceWithNormal(m, [0, 0, 1]), slabParams(), [ent]);
    ok(!pv.error, pv.error || 'no error');
    ok(pv.bars > 40, `${pv.bars} bars`);
    const bars = pv.paths.filter(p => p.pts.length === 2);
    // every Y-bar above the notch (y > 2.05) stays inside the vertical arm
    for (const b of bars) {
      const alongX = Math.abs(b.pts[1].x - b.pts[0].x) > Math.abs(b.pts[1].y - b.pts[0].y);
      if (!alongX && b.pts[0].y > 2.05)
        ok(Math.max(b.pts[0].x, b.pts[1].x) <= 2 + 1e-6, 'Y-bar above the notch stays in the arm');
      if (alongX && b.pts[0].y > 2.05)
        ok(Math.max(b.pts[0].x, b.pts[1].x) <= 6 + 1e-6, 'X-bar geometry sane');
    }
    // layering: Y bars just above the cover, X bars on top of them
    const yz = bars.filter(p => Math.abs(p.pts[0].x - p.pts[1].x) < 1e-9).map(p => p.pts[0].z);
    const xz = bars.filter(p => Math.abs(p.pts[0].y - p.pts[1].y) < 1e-9).map(p => p.pts[0].z);
    near(yz[0], 3.2 - 0.031, 1e-9, 'Y layer at bottom cover + r');
    near(xz[0], 3.2 - 0.043, 1e-9, 'X layer stacked on the Y layer');
  });

  test('slab: openings split the bars; slivers drop; preview never mutates', () => {
    const { m, ent } = slabWorld(true);
    const n0 = m.faces.size;
    const pv = ER.previewElementRebar(m, faceWithNormal(m, [0, 0, 1]), slabParams(), [ent]);
    eq(m.faces.size, n0, 'preview adds nothing');
    const xBars = pv.paths.filter(p => p.pts.length === 2
      && Math.abs(p.pts[0].y - p.pts[1].y) < 1e-9);
    ok(xBars.length > 0, 'X bars present');
    let split = 0;
    for (const b of xBars) {
      const y = b.pts[0].y, a = Math.min(b.pts[0].x, b.pts[1].x), c = Math.max(b.pts[0].x, b.pts[1].x);
      ok(c - a >= 0.25 - 1e-9, 'no sliver bars');
      if (y > 0.5 + 1e-6 && y < 1.5 - 1e-6) {
        ok(!(a < 3 - 1e-6 && c > 4 + 1e-6), 'no bar straddles the opening');
        if (a < 2.9 && c > 4.1) ok(false, 'straddler escaped');
      }
    }
    // a scanline through the hole must yield TWO bars on that row
    const rows = new Map();
    for (const b of xBars) {
      const y = b.pts[0].y.toFixed(4);
      if (!rows.has(y)) rows.set(y, 0);
      rows.set(y, rows.get(y) + 1);
    }
    const throughHole = [...rows.entries()].filter(([y]) => +y > 0.55 && +y < 1.45);
    ok(throughHole.some(([, n]) => n === 2), 'rows through the opening carry 2 bars');
  });

  test('facade: faces without an element are refused; unknown types rejected', () => {
    const m = new Model();
    const faces = box(m, 0, 1, 0, 1, 0, 1); // no entity stamp
    const r = ER.buildElementRebar(m, faces[0], beamParams(), []);
    ok(/no element/.test(r.error), r.error);
    const m2 = new Model();
    const f2 = box(m2, 0, 1, 0, 1, 0, 1);
    const wall = stamp(m2, f2, 'w1', 'wall', {});
    const r2 = ER.buildElementRebar(m2, f2[0], beamParams(), [wall]);
    ok(/not reinforced/.test(r2.error), r2.error);
  });
};
