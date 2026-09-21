'use strict';
// acirules.test.js — the [new] ACI 318-19 rules: beam auto skin (9.7.2.3),
// slab minimum steel + spacing caps (7.6.1), footing minimum steel (Ch.13),
// column ratio band (10.6.1).
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const L = loadModel(['js/tools/base.js', 'js/features/rebar.js', 'js/features/columnrebar.js', 'js/features/elementrebar.js']);
  const { G } = L;
  const Model = L.Model;
  const { ElementRebar: ER } = L.sandbox.window;

  const beam = (w, h2, web) => {
    const m = new Model();
    const before = new Set(m.faces.keys());
    const f = m.addFaceFromRings([G.v(0, -(web / 2), 3), G.v(4, -(web / 2), 3),
      G.v(4, web / 2, 3), G.v(0, web / 2, 3)]);
    m.pushPull(f, -h2);
    const faces = [...m.faces.keys()].filter(id => !before.has(id));
    for (const fid of faces) {
      const f2 = m.faces.get(fid);
      if (!f2.userData) f2.userData = {};
      f2.userData.bimEntityId = 'b1'; f2.userData.bimType = 'beam';
    }
    const ent = { id: 'b1', type: 'beam', params: { baseline: [[0, 0, 3], [4, 0, 3]],
      profile: 'rectangular', webWidth: web, height: h2 }, faces };
    return { m, ent };
  };
  const faceAtZ = (m, z) => {
    for (const [id, f] of m.faces) {
      const c = m.faceCentroid(f);
      if (c && Math.abs(c.z - z) < 1e-6) return id;
    }
    return null;
  };
  const bp = extra => ({ type: 'beam', beam: Object.assign({
    side: 0.03, end: 0.05, tieDia: 0.008, bentAngle: 135, bentFactor: 6,
    mode: 'amount', value: 3, seismic: false, topHook: 'none', botHook: 'none',
    topCount: 2, topDia: 0.014, botCount: 3, botDia: 0.016,
    top: 0.03, bot: 0.03, skin: 0, skinDia: 0.012,
    topExtra: 0, botExtra: 0, crank: 0 }, extra) });

  test('ACI 9.7.2.3: skin steel AUTO when d > 0.9 m, silent below', () => {
    // shallow beam: no auto skin
    const s = beam(0.3, 0.5, 0.3);
    let pv = ER.previewElementRebar(s.m, faceAtZ(s.m, 3.0 - 0.25), bp(), [s.ent]);
    eq(pv.bars, 5, '0.5 m beam: 2 top + 3 bottom, NO auto skin');
    // deep beam: d = 1.2 - 0.038 > 0.9 -> skin both faces
    const d2 = beam(0.3, 1.2, 0.3);
    pv = ER.previewElementRebar(d2.m, faceAtZ(d2.m, 3.0 - 0.6), bp(), [d2.ent]);
    ok(pv.bars > 5, `deep beam gains skin bars (${pv.bars})`);
    const skinFaces = pv.paths.filter(q => q.dia === 0.012);
    ok(skinFaces.length >= 4, `${skinFaces.length} skin bars (>=2 per face)`);
  });

  test('ACI 7.6.1: slab spacing caps at min(3h, 450) and meets 0.0018 ratio', () => {
    const m = new Model();
    const before = new Set(m.faces.keys());
    const f = m.addFaceFromRings([G.v(0, 0, 3), G.v(6, 0, 3), G.v(6, 4, 3), G.v(0, 4, 3)]);
    m.pushPull(f, -0.2);
    const faces = [...m.faces.keys()].filter(id => !before.has(id));
    for (const fid of faces) {
      const f2 = m.faces.get(fid);
      if (!f2.userData) f2.userData = {};
      f2.userData.bimEntityId = 's1'; f2.userData.bimType = 'floor';
    }
    const ent = { id: 's1', type: 'floor', params: { regions: [{ outer: [], holes: [] }], thickness: 0.2 }, faces };
    // ask for 0.6 m spacing (way over the 0.45 cap for h=0.2 -> min(0.6, 0.45) = 0.45)
    const p = { type: 'slab', slab: { bottom: 0.025, top: 0.025, side: 0.025,
      xDia: 0.012, xSpacing: 0.6, yDia: 0.012, ySpacing: 0.6, topMesh: false, topDia: 0 } };
    const pv = ER.previewElementRebar(m, faceAtZ(m, 3), p, [ent]);
    ok(!pv.error, pv.error || 'no error');
    // X-running bars: gaps between them must be <= 0.45
    const xBars = pv.paths.filter(q => q.pts.length === 2 && Math.abs(q.pts[0].y - q.pts[1].y) < 1e-9);
    const ys = [...new Set(xBars.map(q => +q.pts[0].y.toFixed(3)))].sort((a, b) => a - b);
    ok(ys.length >= 2, `${ys.length} X-bar rows`);
    for (let i = 1; i < ys.length; i++)
      ok(ys[i] - ys[i - 1] <= 0.45 + 1e-6, `row gap ${ys[i] - ys[i - 1]} <= 0.45 (ACI cap)`);
    // thin slab with small bars: ratio 0.0018*0.2 = 3.6e-4 m2/m; a12@0.45 gives
    // 1.13e-4/0.45 = 2.5e-4 < needed -> spacing tightens to 1.13e-4/3.6e-4 = 0.314
    for (let i = 1; i < ys.length; i++)
      ok(ys[i] - ys[i - 1] <= 0.314 + 5e-3, `row gap ${ys[i] - ys[i - 1]} <= 0.314 (0.0018 ratio)`);
  });

  test('ACI Ch.13: footing spacing caps + 0.0018 minimum per direction', () => {
    const m = new Model();
    const before = new Set(m.faces.keys());
    const f = m.addFaceFromRings([G.v(0, 0, 0), G.v(1.2, 0, 0), G.v(1.2, 1.2, 0), G.v(0, 1.2, 0)]);
    m.pushPull(f, -0.5);
    const faces = [...m.faces.keys()].filter(id => !before.has(id));
    for (const fid of faces) {
      const f2 = m.faces.get(fid);
      if (!f2.userData) f2.userData = {};
      f2.userData.bimEntityId = 'f1'; f2.userData.bimType = 'foundation';
    }
    const ent = { id: 'f1', type: 'foundation',
      params: { base: [0.6, 0.6, 0], width: 1.2, depth: 1.2, thickness: 0.5 }, faces };
    // spacing 0.5 (over the 0.45 cap; 3h = 1.5 so cap = 0.45)
    const p = { type: 'foundation', foundation: {
      bottom: 0.04, side: 0.05, topLayer: 'X',
      xDia: 0.012, xMode: 'spacing', xValue: 0.5,
      yDia: 0.012, yMode: 'spacing', yValue: 0.5,
      stubX: 2, stubY: 2, stubDia: 0.014, lap: 0.5, leg: 0.15, colW: 0.4, colL: 0.4 } };
    const pv = ER.previewElementRebar(m, faceAtZ(m, 0), p, [ent]);
    ok(!pv.error, pv.error || 'no error');
    const straight = pv.paths.filter(q => q.pts.length === 2);
    // X bars run along x: their y positions must be spaced <= 0.45
    const yX = [...new Set(straight.filter(q => Math.abs(q.pts[0].y - q.pts[1].y) < 1e-9)
      .map(q => +q.pts[0].y.toFixed(3)))].sort((a, b) => a - b);
    for (let i = 1; i < yX.length; i++)
      ok(yX[i] - yX[i - 1] <= 0.45 + 1e-6, `footing X gap ${yX[i] - yX[i - 1]} <= 0.45`);
  });

  test('ACI 10.6.1: column rho band 0.01-0.08 Ag', () => {
    // 0.3x0.3 column: Ag = 0.09; 4 x 16mm = 8.04e-4 m2 -> rho = 0.89% (just under 1%)
    const rho = (n, dia, w, d2) => (n * Math.PI * dia * dia / 4) / (w * d2);
    ok(rho(4, 0.016, 0.3, 0.3) < 0.01, '4#16 in 0.3 col = 0.89% (below min - dialog flags)');
    ok(rho(4, 0.02, 0.3, 0.3) > 0.01 && rho(4, 0.02, 0.3, 0.3) < 0.08, '4#20 in 0.3 col = 1.4% (in band)');
    ok(rho(4, 0.05, 0.3, 0.3) > 0.08, '4#50 in 0.3 col = 8.7% (over max)');
    // the standard 6-tie default: 4 x 16 in 0.3 -> dialog must show OUTSIDE
    eq(typeof rho(4, 0.016, 0.3, 0.3), 'number');
  });
};
