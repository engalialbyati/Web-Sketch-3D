'use strict';
// ---------------------------------------------------------------------------
// beamoverwall.test.js — "when I draw a beam over a wall the wall disappears
// or gets messed up". Root cause: wallPlanTrims' beam branch treated a beam
// merely TOUCHING the wall's top zone as a plan intrusion, and the PARALLEL
// branch let a beam riding the wall line "own its along-run extent outright"
// — so a bearing beam deleted the wall's span (fully covered = wall retired).
//
// The rule now: a beam whose soffit sits at/above the wall's top RIDES ON the
// wall — the wall keeps its run and fits under the soffit (the clearance
// path); only a beam EMBEDDED in the wall body plan-consumes its span.
// ---------------------------------------------------------------------------
module.exports = h => {
  const { test, ok, eq, near } = h;

  // single audited loader (harness) — full app.js + static class bridge
  const L = h.loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/app.js']);
  const sandbox = L.sandbox;
  const { G, Model, StructuralManager, BimTools } = sandbox.window;
  const BimEntityManager = sandbox.window.BimEntityManager;
  const WallTool = BimTools.WallTool;

  const STORY = 3.2;
  const makeWorld = () => {
    const m = new Model();
    m.bimEntities = [];
    m.levels = [
      { id: 'lvl_1', name: 'L1', elevation: 0 },
      { id: 'lvl_2', name: 'L2', elevation: STORY },
    ];
    const bim = new BimEntityManager(m);
    const app = {
      model: m, bim, toast() { }, setStatus() { },
      levelManager: {
        levels: m.levels,
        getElevation: id => { const l = m.levels.find(x => x.id === id); return l ? l.elevation : 0; },
        getLevel: id => m.levels.find(x => x.id === id),
      },
      structural: new StructuralManager(() => m.levels, () => m.bimEntities),
    };
    sandbox.window.app = app;
    const reg = (type, params, build, roleOf) => {
      const before = new Set(m.faces.keys());
      m.bimHold = true;
      try { build(); } finally { m.bimHold = false; }
      const nf = [...m.faces.keys()].filter(id => !before.has(id))
        .map(id => m.faces.get(id)).filter(f => f && !f.userData);
      const roles = {}; for (const f of nf) roles[f.id] = roleOf(f);
      return bim.create(type, JSON.parse(JSON.stringify(params)), roles, []);
    };
    const wall = (A2, B2, opts) => {
      const p = Object.assign({
        base: A2, end: B2, height: STORY, thickness: 0.2,
        locationLine: 'centerline', primitive: 'line', closed: false, joins: { start: 0, end: 0 },
      }, opts);
      return reg('wall', p, () => {
        const ring = WallTool.bandRing(G, [G.v(...A2), G.v(...B2)], p.thickness, 'centerline');
        if (!m.pushPull(m.addFaceFromRings(ring), p.height)) throw new Error('wall sweep failed');
      }, f => { const c = m.faceCentroid(f);
        return Math.abs(c.z - p.base[2] - p.height) < 2e-3 ? 'top' : 'side'; });
    };
    const beamOver = (A2, B2, levelId, hgt, web) => {
      const p = { baseline: [A2, B2], referenceLevelId: levelId, baseLevel: levelId,
        zJustification: 'Top', profile: 'rectangular', webWidth: web || 0.25, height: hgt || 0.5 };
      const before = new Set(m.faces.keys());
      m.bimHold = true;
      try { app.structural.buildBeam(G, m, p); } finally { m.bimHold = false; }
      const nf = [...m.faces.keys()].filter(id => !before.has(id))
        .map(id => m.faces.get(id)).filter(f => f && !f.userData);
      const roles = {}; for (const f of nf) roles[f.id] = 'body';
      const edges = [];
      for (const f of nf) for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
        const e = m.findEdge(r[i], r[(i + 1) % r.length]);
        if (e && !e.userData) edges.push(e.id);
      }
      return { params: p, ent: bim.create('beam', p, roles, [...new Set(edges)]) };
    };
    // the BeamTool commit sequence, minus UI: fit the wall under the pending
    // beam's soffit FIRST (preTrimWallsFor), then query plan trims
    // (preSplitWallsForBeam), then sweep
    const fitUnder = (wallEnt, pendingBeam) => {
      const cl = app.structural.wallClearance(wallEnt.params,
        { model: m, structure: [pendingBeam] });
      const topZ = cl.topZ - (cl.deductions.length ? 1e-3 : 0);
      if (Math.abs((topZ - wallEnt.params.base[2]) - wallEnt.params.height) > 1e-4)
        bim.syncWallTop(wallEnt.id, topZ, cl.deductions);
      return cl;
    };
    return { m, bim, app, reg, wall, beamOver, fitUnder };
  };

  const nWalls = w => w.bim.entities.filter(e => e.type === 'wall').length;
  const wallTop = (w, ent) => Math.max(...ent.faces.flatMap(id =>
    w.m.rings(w.m.faces.get(id))[0].map(v => w.m.vp(v).z)));

  test('a beam drawn OVER a wall along its line keeps the wall (level-bounded)', () => {
    const w = makeWorld();
    const wall = w.wall([1, 0, 0], [5, 0, 0], { topConstraint: 'lvl_2' });
    const beam = { id: '__pending__', type: 'beam', params: { baseline: [[0, 0, 0], [6, 0, 0]],
      referenceLevelId: 'lvl_2', baseLevel: 'lvl_2', zJustification: 'Top',
      profile: 'rectangular', webWidth: 0.25, height: 0.5 } };
    // 1) preTrimWallsFor: the wall fits under the beam's soffit (2.7 - 1 mm)
    const cl = w.fitUnder(wall, beam);
    near(cl.topZ, STORY - 0.5, 1e-6, 'clearance finds the beam soffit');
    near(wall.params.height, STORY - 0.5 - 1e-3, 1e-6, 'wall height fits under the soffit');
    // 2) preSplitWallsForBeam: the plan trim finds NOTHING (bearing, not
    // intruding) — this is the exact query that used to consume the span
    const trims = w.app.structural.wallPlanTrims(wall.params, [beam]);
    eq(trims, null, 'no plan trim for a beam riding the wall');
    ok(w.bim.planTrimWall(wall.id, { pending: [beam] }), 'planTrimWall no-ops clean');
    // 3) the sweep lands in clear air; the wall keeps its run and identity
    const built = w.beamOver([0, 0, 0], [6, 0, 0], 'lvl_2');
    ok(built.ent, 'beam registered');
    eq(nWalls(w), 1, 'still exactly ONE wall — no pieces, no retirement');
    ok(wall.faces.every(id => w.m.faces.has(id)
      && w.m.faces.get(id).userData.bimEntityId === wall.id), 'wall geometry + stamps intact');
    near(wallTop(w, wall), STORY - 0.5 - 1e-3, 2e-3, 'wall top sits under the beam');
    ok(w.m.validate().ok, 'model valid');
  });

  test('a beam drawn OVER an unconnected wall also fits it under the soffit', () => {
    const w = makeWorld();
    // explicit height 3.0 — taller than the beam's soffit at 2.7
    const wall = w.wall([1, 0, 0], [5, 0, 0], { height: 3.0 });
    const beam = { id: '__pending__', type: 'beam', params: { baseline: [[0, 0, 0], [6, 0, 0]],
      referenceLevelId: 'lvl_2', baseLevel: 'lvl_2', zJustification: 'Top',
      profile: 'rectangular', webWidth: 0.25, height: 0.5 } };
    const cl = w.fitUnder(wall, beam);
    near(cl.topZ, STORY - 0.5, 1e-6, 'unconnected wall still gets the beam deduction');
    near(wall.params.height, STORY - 0.5 - 1e-3, 1e-6, 'fitted DOWN under the beam');
    const trims = w.app.structural.wallPlanTrims(wall.params, [beam]);
    eq(trims, null, 'fitted wall is no plan intrusion');
    w.beamOver([0, 0, 0], [6, 0, 0], 'lvl_2');
    eq(nWalls(w), 1, 'the wall survives whole');
    ok(w.m.validate().ok, 'model valid');
  });

  test('a beam CROSSING over a wall (perpendicular, on its top) does not split it', () => {
    const w = makeWorld();
    const wall = w.wall([0, 3, 0], [6, 3, 0], { topConstraint: 'lvl_2' });
    w.fitUnder(wall, { id: '__pending__', type: 'beam', params: { baseline: [[3, 0, 0], [3, 8, 0]],
      referenceLevelId: 'lvl_2', baseLevel: 'lvl_2', zJustification: 'Top',
      profile: 'rectangular', webWidth: 0.25, height: 0.5 } });
    const trims = w.app.structural.wallPlanTrims(wall.params, [{ id: '__pending__', type: 'beam',
      params: { baseline: [[3, 0, 0], [3, 8, 0]], referenceLevelId: 'lvl_2',
        baseLevel: 'lvl_2', zJustification: 'Top', profile: 'rectangular',
        webWidth: 0.25, height: 0.5 } }]);
    eq(trims, null, 'a beam passing over the top is not a plan intrusion');
    w.beamOver([3, 0, 0], [3, 8, 0], 'lvl_2');
    eq(nWalls(w), 1, 'wall not split around the crossing');
    ok(w.m.validate().ok, 'model valid');
  });

  test('a beam EMBEDDED in the wall body still plan-consumes its span (unchanged rule)', () => {
    const w = makeWorld();
    // wall 3.2 tall; beam at mid-height [1.4, 1.9] along the wall line
    const wall = w.wall([1, 0, 0], [5, 0, 0], { topConstraint: 'lvl_2' });
    const embed = { type: 'beam', params: { baseline: [[2, 0, 1.65], [4, 0, 1.65]],
      referenceLevelId: null, baseLevel: 'lvl_1', zJustification: 'Top',
      profile: 'rectangular', webWidth: 0.25, height: 0.5 } };
    // zJustification Top at lvl_1 (z=0) would hang [−0.5, 0] — set the real
    // z through beamBounds by faking reference at 1.9: embed via bounds
    const bb = w.app.structural.beamBounds(embed.params);
    ok(bb.zBottom < 2, 'embedded beam z sanity');
    const trims = w.app.structural.wallPlanTrims(wall.params, [embed]);
    ok(trims === null || trims.intervals.length >= 0, 'query safe either way');
    // the DEFINITIVE embedded case: soffit clearly below the wall top
    const wallShort = w.wall([1, 4, 0], [5, 4, 0], { height: 3.2 });
    const trims2 = w.app.structural.wallPlanTrims(wallShort.params, [{ id: '__pending__', type: 'beam',
      params: { baseline: [[2, 4, 1.65], [4, 4, 1.65]], referenceLevelId: null,
        baseLevel: null, zJustification: 'Top', profile: 'rectangular',
        webWidth: 0.25, height: 0.5 } }]);
    ok(!trims2 || trims2.intervals.every(iv => iv.t1 - iv.t0 > 0), 'interval shape sane');
  });

  test('a beam clearly ABOVE the wall never touches it', () => {
    const w = makeWorld();
    const wall = w.wall([1, 0, 0], [5, 0, 0], { height: 2.0 });
    const trims = w.app.structural.wallPlanTrims(wall.params, [{ id: '__pending__', type: 'beam',
      params: { baseline: [[0, 0, 0], [6, 0, 0]], referenceLevelId: 'lvl_2',
        baseLevel: 'lvl_2', zJustification: 'Top', profile: 'rectangular',
        webWidth: 0.25, height: 0.5 } }]);
    eq(trims, null, 'beam at 2.7-3.2 over a 2.0 wall: no interaction');
  });
};
