'use strict';
// wallrebar.test.js — ACI 318-19 Ch.11 wall reinforcement (MNL-66 walls):
// vertical rho >= 0.0012, horizontal rho >= 0.0020, spacing min(3t, 450),
// one vs two curtains.
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const L = loadModel(['js/tools/base.js', 'js/features/rebar.js',
    'js/features/columnrebar.js', 'js/features/elementrebar.js']);
  const { G } = L;
  const Model = L.Model;
  const { ElementRebar: ER } = L.sandbox.window;

  const wallWorld = (thickness, height, len) => {
    const m = new Model();
    const ax = 0, ay = 0, bx = len || 4, by = 0;
    const ux = 1, uy = 0, nx = 0, ny = 1; // wall runs +x, normal is +y
    const hw = thickness / 2;
    const ring = [
      G.v(ax + nx * hw, ay + ny * hw, 0), G.v(bx + nx * hw, by + ny * hw, 0),
      G.v(bx + nx * hw, by + ny * hw, height), G.v(ax + nx * hw, ay + ny * hw, height)];
    const before = new Set(m.faces.keys());
    const f = m.addFaceFromRings(ring);
    m.pushPull(f, -thickness);
    const faces = [...m.faces.keys()].filter(id => !before.has(id));
    const ent = { id: 'w1', type: 'wall',
      params: { base: [ax, ay, 0], end: [bx, by, 0], thickness, height }, faces: [], edges: [] };
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

  test('wall: both curtains built, spacings cap at min(3t, 450)', () => {
    const w = wallWorld(0.2, 3, 4);
    const pv = ER.previewElementRebar(w.m, w.ent.faces[0], wp(), [w.ent]);
    ok(!pv.error, pv.error || 'no error');
    ok(pv.bars > 20, `${pv.bars} bars (2 curtains x vertical + horizontal)`);
    // spacing cap: min(0.6, 0.45) = 0.45 for a 0.2 wall -> tighter by rho
    ok(pv.sv <= 0.45 + 1e-6, `vertical spacing ${pv.sv} <= 0.45`);
    ok(pv.sh <= 0.45 + 1e-6, `horizontal spacing ${pv.sh} <= 0.45`);
    // rho checks (steel per metre / t)
    ok(pv.rhoV >= 0.0012 - 1e-6, `vertical rho ${pv.rhoV} >= 0.0012`);
    ok(pv.rhoH >= 0.0020 - 1e-6, `horizontal rho ${pv.rhoH} >= 0.0020`);
  });

  test('wall: rho auto-tightens to meet the minimum', () => {
    // 0.3 m wall, 12mm bars, ask for 0.4 m spacing (way loose):
    // needV = 0.0012*0.3 = 3.6e-4 m2/m; a12=1.13e-4; s <= 1.13e-4/3.6e-4 = 0.314
    const w = wallWorld(0.3, 3, 4);
    const pv = ER.previewElementRebar(w.m, w.ent.faces[0],
      wp({ vSpacing: 0.4, hSpacing: 0.4 }), [w.ent]);
    ok(!pv.error, pv.error || 'no error');
    ok(pv.sv <= 0.314 + 5e-3, `vertical tightened ${pv.sv} <= 0.314`);
    ok(pv.sh <= 0.314 + 5e-3, `horizontal tightened ${pv.sh} <= 0.314 (0.0020 is stricter)`);
    // the actual horizontal need: 0.0020*0.3 = 6e-4; s <= 1.13e-4/6e-4 = 0.188
    ok(pv.sh <= 0.189 + 5e-3, `horizontal meets 0.0020: ${pv.sh} <= 0.188`);
  });

  test('wall: one curtain halves the bar count', () => {
    const w = wallWorld(0.2, 3, 4);
    const two = ER.previewElementRebar(w.m, w.ent.faces[0], wp({ twoCurtains: true }), [w.ent]);
    const one = ER.previewElementRebar(w.m, w.ent.faces[0], wp({ twoCurtains: false }), [w.ent]);
    near(one.bars, two.bars / 2, 0.51, `1 curtain ${one.bars} ≈ half of 2 curtains ${two.bars}`);
  });

  test('wall: bars tagged for the BBS', () => {
    const w = wallWorld(0.2, 3, 4);
    const res = ER.buildElementRebar(w.m, w.ent.faces[0], wp(), [w.ent]);
    ok(!res.error, res.error || 'no error');
    const rb = res.ids.map(id => w.m.faces.get(id)).filter(Boolean);
    ok(rb.every(f => f.userData && f.userData.rebar && f.userData.rebar.host === 'wall'),
      'tagged wall');
  });
};
