'use strict';
// features/elementrebar.js — MNL-66(20) Phase 4, beam connections:
// BM-202 far-side development at columns, BM-204 girder ends, the
// BM-203/204 tie cap (8 in) through the connection zone, and ACI
// 9.8.1.2/9.8.1.4 integrity reinforcement.
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

  function box(m, x0, x1, y0, y1, z0, z1) {
    const before = new Set(m.faces.keys());
    const f = m.addFaceFromRings([
      G.v(x0, y0, z1), G.v(x1, y0, z1), G.v(x1, y1, z1), G.v(x0, y1, z1)]);
    m.pushPull(f, -(z1 - z0));
    return [...m.faces.keys()].filter(id => !before.has(id));
  }
  const stamp = (m, faces, id, type, params) => {
    for (const fid of faces) {
      const f = m.faces.get(fid);
      if (!f.userData) f.userData = {};
      f.userData.bimEntityId = id; f.userData.bimType = type;
    }
    return { id, type, params, faces };
  };
  const faceAtZ = (m, z) => {
    for (const [id, f] of m.faces) {
      const c = m.faceCentroid(f);
      if (c && Math.abs(c.z - z) < 1e-6) return id;
    }
    return null;
  };

  // beam SOLID already framing-trimmed at the start column (0.15 in), the
  // baseline keeps the centerline endpoint at the column CENTER (0,0) -
  // exactly what buildBeam's colReach trim leaves behind
  const beamParams = (over = {}) => ({ type: 'beam', beam: Object.assign({
    side: 0.03, end: 0.05, tieDia: 0.008, bentAngle: 135, bentFactor: 6,
    mode: 'spacing', value: 1.0,
    topCount: 2, topDia: 0.014, botCount: 3, botDia: 0.016,
    top: 0.03, bot: 0.03, skin: 0, skinDia: 0.012,
  }, over) });
  // solid x from x0 to 4; baseline endpoint(s) per the test
  const beamWorld = (x0, base) => {
    const m = new Model();
    const ent = stamp(m, box(m, x0, 4, -0.15, 0.15, 3, 3.5), 'b1', 'beam',
      { baseline: base, profile: 'rectangular', webWidth: 0.3, height: 0.5 });
    return { m, ent };
  };
  const colAt = (x, y, w = 0.3, d = 0.3) =>
    ({ id: 'c' + x + '_' + y, type: 'column', faces: [],
      params: { base: [x, y, 3], width: w, depth: d, height: 3 } });

  test('BM-202: beam bars develop to the FAR SIDE of the column ties', () => {
    const { m, ent } = beamWorld(0.15, [[0, 0, 3], [4, 0, 3]]);
    const col = colAt(0, 0);
    const pv = ER.previewElementRebar(m, faceAtZ(m, 3.0), beamParams(), [ent, col]);
    ok(!pv.error, pv.error || 'no error');
    eq(pv.supports.start, 'column', 'column detected at the start end');
    eq(pv.supports.end, 'free', 'far end has no support');
    // bottom rows: tip lands at the far side of the column ties
    //   column far face 0.15 past the solid face; -0.15 + cover 0.04 + tie 0.012
    const bot = pv.paths.filter(q => q.dia === 0.016 && q.pts.length > 2);
    ok(bot.length >= 3, `${bot.length} hooked bottom bars`);
    for (const q of bot) near(Math.min(...q.pts.map(w => w.x)), -0.098, 2e-3,
      'bar tip at the far side of the column ties');
    // the tail rises 12db + mandrel above the bottom row at the far side
    const zRow = 3 + 0.03 + 0.008 + 0.016 / 2;
    for (const q of bot) near(Math.max(...q.pts.map(w => w.z)), zRow + (12 + 3.5) * 0.016, 2e-3,
      'far-side tail 12db up');
    // top rows mirror: tail DOWN at the same far-side station
    const top = pv.paths.filter(q => q.dia === 0.014 && q.pts.length > 2);
    ok(top.length >= 2, `${top.length} hooked top bars`);
    for (const q of top) near(Math.min(...q.pts.map(w => w.x)), -0.098, 2e-3,
      'top bar develops to the far side too');
    // the FREE end hooks back at the solid face (9.8.1.4 integrity)
    const zTopRow = 3.5 - 0.03 - 0.008 - 0.014 / 2;
    for (const q of top) near(Math.max(...q.pts.map(w => w.x)), 4 - 0.05, 2e-3,
      'free end at the end cover');
  });

  test('BM-204: a perpendicular girder receives the end the same way', () => {
    const { m, ent } = beamWorld(0, [[0, 0, 3], [4, 0, 3]]);
    const girder = { id: 'g1', type: 'beam', faces: [],
      params: { baseline: [[4, -2, 3], [4, 2, 3]], profile: 'rectangular', webWidth: 0.4, height: 0.6 } };
    const pv = ER.previewElementRebar(m, faceAtZ(m, 3.0), beamParams(), [ent, girder]);
    ok(!pv.error, pv.error || 'no error');
    eq(pv.supports.end, 'girder', 'girder detected at the far end');
    // far face of the girder ties: 4 + 0.2 - 0.052
    const bot = pv.paths.filter(q => q.dia === 0.016 && q.pts.length > 2);
    for (const q of bot) near(Math.max(...q.pts.map(w => w.x)), 4.148, 2e-3,
      'bars hook at the far side of the girder ties');
  });

  test('a column past the beam side is NOT a support', () => {
    const { m, ent } = beamWorld(0, [[0, 0, 3], [4, 0, 3]]);
    const off = colAt(0, 0.55); // within the 0.75 m probe, but off the beam line
    const pv = ER.previewElementRebar(m, faceAtZ(m, 3.0), beamParams(), [ent, off]);
    ok(!pv.error, pv.error || 'no error');
    eq(pv.supports.start, 'free', 'laterally offset column rejected');
  });

  test('BM-203/204: ties step down to 8 in max through the connection zone', () => {
    const { m, ent } = beamWorld(0.15, [[0, 0, 3], [4, 0, 3]]);
    const col = colAt(0, 0);
    const pv = ER.previewElementRebar(m, faceAtZ(m, 3.0), beamParams(), [ent, col]);
    ok(!pv.error, pv.error || 'no error');
    const ties = pv.paths.filter(q => q.dia === 0.008 && q.pts.length > 2)
      .map(q => q.pts.reduce((s, w) => s + w.x, 0) / q.pts.length).sort((a, b) => a - b);
    // the zone on the supported side: first 0.6 m of the solid
    const solid0 = 0.15;
    const zone = ties.filter(x => x <= solid0 + 0.6 + 1e-6);
    ok(zone.length >= 3, `${zone.length} ties inside the 0.6 m connection zone`);
    for (let i = 1; i < zone.length; i++)
      ok(zone[i] - zone[i - 1] <= 0.203 + 2e-3,
        `zone tie gap ${((zone[i] - zone[i - 1]) * 1000).toFixed(0)} mm <= 8 in`);
    // the zone is covered to its edge: last tie within one capped spacing
    ok(solid0 + 0.6 - zone[zone.length - 1] <= 0.203 + 2e-3,
      'no gap to the zone edge');
    // beyond the zone the user's 1.0 m spacing rules
    const mid = ties.filter(x => x > solid0 + 0.6 && x < 3.4);
    for (let i = 1; i < mid.length; i++)
      ok(mid[i] - mid[i - 1] > 0.203 + 1e-3, 'mid-span ties stay at the user spacing');
  });

  test('ACI 9.8.1.2: integrity steel - 2+2 continuous, hooks at free ends', () => {
    const { m, ent } = beamWorld(0, [[0, 0, 3], [4, 0, 3]]);
    // one bar asked per row: the integrity rule still lays 2+2
    const pv = ER.previewElementRebar(m, faceAtZ(m, 3.0),
      beamParams({ topCount: 1, botCount: 1 }), [ent]);
    ok(!pv.error, pv.error || 'no error');
    const hooked = pv.paths.filter(q => q.pts.length > 2 && (q.dia === 0.014 || q.dia === 0.016));
    eq(hooked.filter(q => q.dia === 0.014).length, 2, '2 continuous top bars');
    eq(hooked.filter(q => q.dia === 0.016).length, 2, '2 continuous bottom bars');
    // discontinuous ends: bottom tails UP, top tails DOWN (9.8.1.4)
    const zBot = 3 + 0.03 + 0.008 + 0.008; // cover + tie + r (16mm bar)
    const zTop = 3.5 - 0.03 - 0.008 - 0.007;
    for (const q of hooked.filter(q => q.dia === 0.016))
      near(Math.max(...q.pts.map(w => w.z)), zBot + (12 + 3.5) * 0.016, 2e-3, 'free-end tail up');
    for (const q of hooked.filter(q => q.dia === 0.014))
      near(Math.min(...q.pts.map(w => w.z)), zTop - (12 + 3.5) * 0.014, 2e-3, 'free-end tail down');
    // opting out restores the raw single bars
    const off = ER.previewElementRebar(m, faceAtZ(m, 3.0),
      beamParams({ topCount: 1, botCount: 1, integrity: false }), [ent]);
    const rows = off.paths.filter(q => q.pts.length === 2);
    eq(rows.filter(q => q.dia === 0.014).length, 1, 'integrity off: 1 top bar');
    eq(rows.filter(q => q.dia === 0.016).length, 1, 'integrity off: 1 bottom bar');
  });

  test('committed cage carries the connection bars (BM-202 end-to-end)', () => {
    const { m, ent } = beamWorld(0.15, [[0, 0, 3], [4, 0, 3]]);
    const col = colAt(0, 0);
    const res = ER.buildElementRebar(m, faceAtZ(m, 3.0), beamParams(), [ent, col]);
    ok(!res.error, res.error || 'no error');
    eq(res.supports.start, 'column', 'build path reports the support too');
    ok(res.ids.length > 0, `${res.ids.length} rebar faces committed`);
    ok(res.ids.every(id => m.faces.has(id)), 'all ids live in the model');
  });
};
