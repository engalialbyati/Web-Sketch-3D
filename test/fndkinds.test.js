'use strict';
// fndkinds.test.js — MNL-66(20) Phase 7 foundation kinds: FND-109 mat
// (mesh at both faces), FND-161 pile cap (pile dowels + shaft ties through
// the cap), FND-150 drilled pier (circular cap: ring cage + chord-clipped
// mesh).
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const L = loadModel(['js/tools/base.js', 'js/features/rebar.js',
    'js/features/columnrebar.js', 'js/features/elementrebar.js']);
  const { G } = L;
  const Model = L.Model;
  const { ElementRebar: ER } = L.sandbox.window;

  const fnd = (extra, disc) => {
    const m = new Model();
    const before = new Set(m.faces.keys());
    let f;
    if (disc) {
      const ring = [];
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        ring.push(G.v(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a), 0.6));
      }
      f = m.addFaceFromRings(ring);
      m.pushPull(f, -0.6);
    } else {
      f = m.addFaceFromRings([G.v(0, 0, 0.6), G.v(1.8, 0, 0.6), G.v(1.8, 1.8, 0.6), G.v(0, 1.8, 0.6)]);
      m.pushPull(f, -0.6);
    }
    const faces = [...m.faces.keys()].filter(id => !before.has(id));
    for (const fid of faces) {
      const f2 = m.faces.get(fid);
      if (!f2.userData) f2.userData = {};
      f2.userData.bimEntityId = 'f1'; f2.userData.bimType = 'foundation';
    }
    const ent = disc
      ? { id: 'f1', type: 'foundation', faces,
        params: { base: [0.5, 0.5, 0.6], radius: 0.5, thickness: 0.6 } }
      : { id: 'f1', type: 'foundation', faces,
        params: { base: [0.9, 0.9, 0.6], width: 1.8, depth: 1.8, thickness: 0.6 } };
    return { m, ent };
  };
  const baseF = extra => ({ type: 'foundation', foundation: Object.assign({
    bottom: 0.04, side: 0.05, topLayer: 'X',
    xDia: 0.012, xMode: 'spacing', xValue: 0.15,
    yDia: 0.012, yMode: 'spacing', yValue: 0.15,
    stubX: 2, stubY: 2, stubDia: 0.014, lap: 0.5, leg: 0.15, colW: 0.4, colL: 0.4,
  }, extra) });
  const topFaceOf = w => {
    let best = null, bz = -1e9;
    for (const [id, f] of w.m.faces) {
      const n = G.norm(G.loopNormal(w.m.pts(f.loop)));
      if (n.z < 0.999) continue;
      const c = w.m.faceCentroid(f);
      if (c && c.z > bz) { bz = c.z; best = id; }
    }
    return best;
  };

  test('FND-109 mat: the mesh runs at BOTH faces', () => {
    const w = fnd();
    const pv = ER.previewElementRebar(w.m, topFaceOf(w), baseF({ kind: 'mat' }), [w.ent]);
    ok(!pv.error, pv.error || 'no error');
    const xb = pv.paths.filter(q => q.pts.length === 2
      && Math.abs(q.pts[0].z - q.pts[1].z) < 1e-9 && Math.abs(q.pts[0].y - q.pts[1].y) < 1e-9);
    const zs = [...new Set(xb.map(q => +q.pts[0].z.toFixed(3)))].sort((a, b) => a - b);
    // bottom pair (0.012/0.036) + top pair (0.6-0.012 / 0.6-0.036)
    const low = zs.filter(z => z < 0.2), high = zs.filter(z => z > 0.4);
    ok(low.length >= 1 && high.length >= 1,
      `X rows at both faces: bottom ${low} + top ${high}`);
    // X is the upper layer of each face (rests on the Y layer)
    near(Math.max(...high), 0.6 - (0.04 + 0.012 + 0.006), 2e-3, 'top X layer under the top cover');
    near(Math.min(...low), 0.058, 2e-3, 'bottom X layer rests on the bottom Y');
  });

  test('FND-161 pile cap: dowels into 4 piles + ties through the cap depth', () => {
    const w = fnd();
    const res = ER.buildElementRebar(w.m, topFaceOf(w), baseF({
      kind: 'pilecap', piles: 4, pileS: 0.6, pileDia: 0.3, pileLap: 0.6 }), [w.ent]);
    ok(!res.error, res.error || 'no error');
    const rb = [...new Map([...w.m.faces.values()]
      .filter(f => f.userData && f.userData.rebar)
      .map(f => [f.userData.rebar.pid, f.userData.rebar])).values()];
    const dowels = rb.filter(r => r.role === 'pile-dowel');
    const ties2 = rb.filter(r => r.role === 'pile-tie');
    eq(dowels.length, 16, '4 dowels x 4 piles');
    ok(ties2.length >= 12, `${ties2.length} shaft ties through the cap`);
    // dowels drop BELOW the cap bottom (0.0) by the lap and rise to the top
    const dPaths = [...w.m.faces.values()].filter(f => f.userData
      && f.userData.rebar && f.userData.rebar.role === 'pile-dowel');
    const zs = dPaths.flatMap(f => w.m.pts(f.loop).map(q => q.z));
    near(Math.min(...zs), -0.6, 0.03, 'dowels lap 0.6 m into the piles');
    near(Math.max(...zs), 0.54, 0.03, 'dowels reach the cap top cover');
    // pile centers at +-0.3
    const xs = [...new Set(dPaths.map(f => +w.m.faceCentroid(f).x.toFixed(2)))].sort((a, b) => a - b);
    ok(Math.min(...xs) < 0.55 && Math.max(...xs) > 1.25, `dowels spread over the 4 piles (${xs.join(',')})`);
  });

  test('FND-150 drilled pier: circular cap gets the shaft ring cage', () => {
    const w = fnd(null, true);
    const fid = topFaceOf(w); // pick BEFORE committing (rebar pipes pollute the search)
    const res = ER.buildElementRebar(w.m, fid, baseF(), [w.ent]);
    ok(!res.error, res.error || 'no error');
    const rb = [...new Map([...w.m.faces.values()]
      .filter(f => f.userData && f.userData.rebar)
      .map(f => [f.userData.rebar.pid, f.userData.rebar])).values()];
    const verts = rb.filter(r => r.role === 'pier-vertical');
    const ties2 = rb.filter(r => r.role === 'pier-tie');
    const shaftR = 0.5 - 0.05 - 0.007 - 0.012;
    const nv = Math.max(6, Math.round((2 * Math.PI * shaftR) / 0.2));
    eq(verts.length, nv, `${nv} shaft verticals on the ring`);
    ok(ties2.length >= 2, `${ties2.length} circular ties through the cap`);
    // the mesh is CLIPPED to the disc: no straight bar reaches past R-0.05
    const pv = ER.previewElementRebar(w.m, fid, baseF(), [w.ent]);
    const bars = pv.paths.filter(q => q.pts.length === 2);
    for (const q of bars)
      for (const pt of q.pts)
        ok(Math.hypot(pt.x - 0.5, pt.y - 0.5) <= 0.45 + 2e-3,
          `bar endpoint inside the disc (${(Math.hypot(pt.x - 0.5, pt.y - 0.5)).toFixed(3)})`);
    // chord lengths vary: the centre chords are longer than the edge ones
    const lens = [...new Set(bars.filter(q => Math.abs(q.pts[0].z - q.pts[1].z) < 1e-9
      && Math.abs(q.pts[0].y - q.pts[1].y) < 1e-9)
      .map(q => +Math.abs(q.pts[1].x - q.pts[0].x).toFixed(3)))].sort((a, b) => b - a);
    ok(lens[0] > lens[lens.length - 1] + 0.1, `chords vary ${lens[0]} .. ${lens[lens.length - 1]}`);
  });

  test('pad default: unchanged behaviour (regression)', () => {
    const w = fnd();
    const pv = ER.previewElementRebar(w.m, topFaceOf(w), baseF(), [w.ent]);
    ok(!pv.error, pv.error || 'no error');
    const xb = pv.paths.filter(q => q.pts.length === 2
      && Math.abs(q.pts[0].z - q.pts[1].z) < 1e-9 && Math.abs(q.pts[0].y - q.pts[1].y) < 1e-9);
    const zs = [...new Set(xb.map(q => +q.pts[0].z.toFixed(3)))];
    ok(zs.every(z => z < 0.2), 'bottom mesh only on a plain pad');
  });
};
