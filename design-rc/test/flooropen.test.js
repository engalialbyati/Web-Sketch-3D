'use strict';
// ---------------------------------------------------------------------------
// flooropen.test.js — the OPENING tool's floor host: a plan opening cut in
// a slab (stairwell/shaft), recorded parametrically in regions[].holes,
// healed when deleted, and taken with the slab when the slab goes.
// ---------------------------------------------------------------------------
module.exports = h => {
  const { test, ok, eq } = h;

  // single audited loader (harness) — full app.js + static class bridge
  const L = h.loadModel(['js/tools/base.js', 'js/tools/bim.js', 'js/app.js']);
  const sandbox = L.sandbox;
  const { G, Model } = sandbox.window;
  const BimEntityManager = sandbox.window.BimEntityManager;

  const makeWorld = () => {
    const m = new Model();
    m.bimEntities = [];
    const bim = new BimEntityManager(m);
    // a 10 x 6 m slab at level z=3, 200 mm thick — built and registered the
    // way the Floor/Convert tools do it
    const z = 3, t = 0.2;
    const outer = [[0, 0, z], [10, 0, z], [10, 6, z], [0, 6, z]];
    const before = new Set(m.faces.keys());
    const f = m.addFaceFromRings(outer.map(q => G.v(...q)));
    m.pushPull(f, -t);
    const faces = [...m.faces.keys()].filter(id => !before.has(id));
    const roles = {};
    for (const fid of faces) roles[fid] = 'body';
    const floor = bim.create('floor', { regions: [{ outer, holes: [] }], thickness: t }, roles, []);
    return { m, bim, floor };
  };

  test('cutting a floor opening records the hole in params and the geometry', () => {
    const w = makeWorld();
    const facesBefore = w.floor.faces.length;
    const ent = w.bim.placeFloorOpening(w.floor.id, 5, 3, 1.5, 1.0);
    ok(ent && ent.type === 'opening', 'opening entity registered');
    eq(ent.params.hostFloorId, w.floor.id, 'host link recorded');
    eq(w.floor.params.regions[0].holes.length, 1, 'hole ring in params (params are truth)');
    const ring = w.floor.params.regions[0].holes[0];
    ok(Math.abs(ring[0][0] - 4.25) < 1e-9 && Math.abs(ring[0][1] - 2.5) < 1e-9, 'ring geometry at the click');
    // the rebuilt slab carries a holed face
    const holed = w.floor.faces.map(id => w.m.faces.get(id)).filter(f => f && (f.holes || []).length > 0);
    ok(holed.length >= 1, 'slab geometry has the hole');
    ok(w.floor.faces.filter(id => w.m.faces.has(id)).length > 0, 'slab faces live');
    ok(w.m.validate().ok, 'model valid');
  });

  test('a click outside the floor boundary refuses cleanly', () => {
    const w = makeWorld();
    const ent = w.bim.placeFloorOpening(w.floor.id, 20, 20, 1.0, 1.0);
    eq(ent, null, 'refused');
    eq(w.floor.params.regions[0].holes.length, 0, 'params untouched');
    ok(w.m.validate().ok, 'model valid');
  });

  test('deleting the opening heals the slab whole', () => {
    const w = makeWorld();
    const ent = w.bim.placeFloorOpening(w.floor.id, 5, 3, 1.5, 1.0);
    ok(w.bim.detach(ent.id), 'opening detached');
    eq(w.floor.params.regions[0].holes.length, 0, 'hole ring removed from params');
    const holed = w.floor.faces.map(id => w.m.faces.get(id)).filter(f => f && (f.holes || []).length > 0);
    eq(holed.length, 0, 'geometry healed — no holes left');
    ok(w.m.validate().ok, 'model valid');
  });

  test('deleting the FLOOR takes its openings along', () => {
    const w = makeWorld();
    w.bim.placeFloorOpening(w.floor.id, 5, 3, 1.5, 1.0);
    w.bim.placeFloorOpening(w.floor.id, 8, 3, 1.0, 1.0);
    eq(w.bim.entities.filter(e => e.type === 'opening').length, 2, 'two openings');
    w.bim.detach(w.floor.id);
    eq(w.bim.entities.filter(e => e.type === 'opening').length, 0, 'openings gone with the slab');
    eq(w.bim.entities.filter(e => e.type === 'floor').length, 0, 'floor gone');
  });
};
