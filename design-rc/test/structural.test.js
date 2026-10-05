'use strict';
// ---------------------------------------------------------------------------
// Structural elements: elevation datums, parametric beam profiles, infill
// wall clearance, and join-priority quantity takeoff.
// ---------------------------------------------------------------------------
module.exports = h => {
  const { G, Model, StructuralManager: SM, BeamProfiles, GltfExporter } = h.loadModel();
  const { test, ok, eq, near, throws } = h;

  const LEVELS = [
    { id: 'lvl_0', name: 'Level 0', elevation: 0.0 },
    { id: 'lvl_1', name: 'Level 1', elevation: 4.0 },
    { id: 'lvl_2', name: 'Level 2', elevation: 8.0 },
  ];
  const mgr = entities => new SM(() => LEVELS, () => entities || []);

  // ================================================== 1. elevation bounds
  test('column: Zstart/Zend from levels + offsets', () => {
    const b = mgr().columnBounds({ baseLevelId: 'lvl_0', topLevelId: 'lvl_1' });
    near(b.zStart, 0); near(b.zEnd, 4); near(b.height, 4);
    const o = mgr().columnBounds({ baseLevelId: 'lvl_0', topLevelId: 'lvl_1', baseOffset: -0.5, topOffset: 0.2 });
    near(o.zStart, -0.5); near(o.zEnd, 4.2);
    // legacy param names (baseLevel/topConstraint) behave identically
    const l = mgr().columnBounds({ baseLevel: 'lvl_1', topConstraint: 'lvl_2' });
    near(l.zStart, 4); near(l.zEnd, 8);
  });
  test('column: unconnected fallback height', () => {
    const b = mgr().columnBounds({ baseLevelId: 'lvl_1', topLevelId: null, height: 3.2 });
    near(b.zStart, 4); near(b.zEnd, 7.2);
  });
  test('beam: Top justification hangs downward from the reference level', () => {
    const b = mgr().beamBounds({ referenceLevelId: 'lvl_1', height: 0.6 });
    near(b.zTop, 4.0); near(b.zBottom, 3.4);
  });
  test('beam: Bottom / Center justifications', () => {
    const bb = mgr().beamBounds({ referenceLevelId: 'lvl_1', height: 0.6, zJustification: 'Bottom' });
    near(bb.zBottom, 4.0); near(bb.zTop, 4.6);
    const bc = mgr().beamBounds({ referenceLevelId: 'lvl_1', height: 0.6, zJustification: 'Center' });
    near(bc.zBottom, 3.7); near(bc.zTop, 4.3);
  });
  test('slab: extrudes downward from its level', () => {
    const b = mgr().slabBounds({ levelId: 'lvl_1', thickness: 0.2 });
    near(b.zTop, 4.0); near(b.zBottom, 3.8);
  });
  test('foundation: pad hangs below its level', () => {
    const b = mgr().foundationBounds({ baseLevel: 'lvl_0', thickness: 0.8 });
    near(b.zTop, 0.0); near(b.zBottom, -0.8);
  });

  // ================================================== 2. beam profiles
  test('rectangular profile: 4 vertices, area = b_w * h', () => {
    const loop = BeamProfiles.rectangular({ profile: 'rectangular', webWidth: 0.25, height: 0.5 });
    eq(loop.length, 4);
    near(BeamProfiles.area({ profile: 'rectangular', webWidth: 0.25, height: 0.5 }), 0.125);
  });
  test('T profile: 8 vertices, symmetric, area = web + flange', () => {
    const p = { profile: 't', height: 0.6, webWidth: 0.25, flangeWidth: 0.8, flangeThickness: 0.15 };
    const loop = BeamProfiles.tBeam(p);
    eq(loop.length, 8);
    near(BeamProfiles.area(p), 0.25 * (0.6 - 0.15) + 0.8 * 0.15); // web stem + flange
    // symmetry about u = 0
    const us = loop.map(q => q.u).sort((a, b) => a - b);
    near(us[0] + us[us.length - 1], 0, 1e-12);
    near(us[3] + us[4], 0, 1e-12);
    // flange top at v = h; stem bottom at v = 0
    ok(loop.some(q => Math.abs(q.v - 0.6) < 1e-12));
    ok(loop.every(q => q.v >= -1e-12 && q.v <= 0.6 + 1e-12));
  });
  test('L profile: 6 vertices, flange sides mirror each other', () => {
    const p = { profile: 'l', height: 0.5, webWidth: 0.25, flangeWidth: 0.6, flangeThickness: 0.12 };
    const R = BeamProfiles.lBeam({ ...p, flangeSide: 'Right' });
    const L = BeamProfiles.lBeam({ ...p, flangeSide: 'Left' });
    eq(R.length, 6); eq(L.length, 6);
    near(BeamProfiles.area(p), 0.25 * 0.5 + (0.6 - 0.25) * 0.12); // web + one-sided flange
    // mirror: every Right vertex has a Left counterpart at -u (same v)
    for (const q of R)
      ok(L.some(w => Math.abs(w.u + q.u) < 1e-12 && Math.abs(w.v - q.v) < 1e-12));
  });
  test('profile loops are CCW (sweep pushes toward the far endpoint)', () => {
    for (const profile of ['rectangular', 't', 'l']) {
      const loop = BeamProfiles.for({ profile, height: 0.5, webWidth: 0.25, flangeWidth: 0.7, flangeThickness: 0.15 });
      let a = 0;
      for (let i = 0; i < loop.length; i++) {
        const P = loop[i], Q = loop[(i + 1) % loop.length];
        a += P.u * Q.v - Q.u * P.v;
      }
      ok(a > 0, profile + ' profile must wind CCW');
    }
  });
  test('degenerate dimensions are sanitized, never folded', () => {
    const n = BeamProfiles.normalize({ profile: 't', height: 0.1, webWidth: 0.3, flangeWidth: 0.2, flangeThickness: 0.5 });
    ok(n.flangeWidth >= n.webWidth);
    ok(n.flangeThickness < n.height);
    eq(n.profile, 't');
  });

  // ================================================== 3. swept B-Rep solids
  test('rect beam sweeps to an exact closed prism (volume = A * L)', () => {
    const m = new Model();
    const p = {
      referenceLevelId: 'lvl_1', zJustification: 'Top', profile: 'rectangular',
      height: 0.5, webWidth: 0.25,
      baseline: [[0, 0, 4], [4, 0, 4]],
    };
    const M = mgr([]);
    const faces = M.buildBeam(G, m, p);
    ok(faces.length >= 6, 'rect beam needs 4 sides + 2 caps, got ' + faces.length);
    // + join extension: webWidth/2 per end (cast-in-place corner overlap)
    near(m.shellVolume(faces.map(f => f.id)), 0.25 * 0.5 * (4 + 0.25), 1e-9);
    // the sweep hangs from the level plane by ELEMENT_EPS (v0.6: its top
    // face then buries strictly inside any slab at the same level)
    const zs = faces.flatMap(f => m.pts(f.loop).map(q => q.z));
    near(Math.max(...zs), 4.0 - 1e-4, 1e-9);
    near(Math.min(...zs), 3.5 - 1e-4, 1e-9);
    eq(m.validate().ok, true);
  });
  test('T beam sweep: flange at the level, stem projecting below', () => {
    const m = new Model();
    const p = {
      referenceLevelId: 'lvl_1', zJustification: 'Top', profile: 't',
      height: 0.6, webWidth: 0.25, flangeWidth: 0.8, flangeThickness: 0.15,
      baseline: [[0, 0, 4], [3, 0, 4]],
    };
    const faces = mgr([]).buildBeam(G, m, p);
    const expected = (0.25 * 0.45 + 0.8 * 0.15) * (3 + 0.25);
    near(m.shellVolume(faces.map(f => f.id)), expected, 1e-9);
    eq(m.validate().ok, true);
  });
  test('L beam sweep: asymmetric spandrel volume', () => {
    const m = new Model();
    const p = {
      referenceLevelId: 'lvl_1', zJustification: 'Top', profile: 'l', flangeSide: 'Right',
      height: 0.5, webWidth: 0.25, flangeWidth: 0.6, flangeThickness: 0.12,
      baseline: [[0, 0, 4], [2, 0, 4]],
    };
    const faces = mgr([]).buildBeam(G, m, p);
    near(m.shellVolume(faces.map(f => f.id)), (0.25 * 0.5 + 0.35 * 0.12) * (2 + 0.25), 1e-9);
    // flange juts to +u only (left of draw dir = +y side... u maps to left
    // normal (-dy, dx) = (0,1): flange on the +y side, none on -y)
    const ys = faces.flatMap(f => m.pts(f.loop).map(q => q.y));
    near(Math.max(...ys), 0.6 - 0.125, 1e-9);
    near(Math.min(...ys), -0.125, 1e-9);
    eq(m.validate().ok, true);
  });
  test('beam sweeps along arbitrary horizontal directions', () => {
    const m = new Model();
    const p = {
      referenceLevelId: 'lvl_0', profile: 'rectangular', height: 0.4, webWidth: 0.3,
      baseline: [[1, 1, 0], [4, 4, 0]], // 45 degrees, length 3*sqrt(2)
    };
    const faces = mgr([]).buildBeam(G, m, p);
    near(m.shellVolume(faces.map(f => f.id)), 0.3 * 0.4 * (3 * Math.SQRT2 + 0.3), 1e-9);
    eq(m.validate().ok, true);
  });
  test('column solid spans exactly its level bounds', () => {
    const m = new Model();
    const p = { base: [1, 1, 0], width: 0.3, depth: 0.4, baseLevelId: 'lvl_0', topLevelId: 'lvl_1', baseOffset: 0, topOffset: 0 };
    const faces = mgr([]).buildColumn(G, m, p);
    near(m.shellVolume(faces.map(f => f.id)), 0.3 * 0.4 * 4, 1e-9);
    const zs = faces.flatMap(f => m.pts(f.loop).map(q => q.z));
    near(Math.min(...zs), 0, 1e-9); near(Math.max(...zs), 4, 1e-9);
    eq(m.validate().ok, true);
  });
  test('footing pad + pedestal build below the level', () => {
    const m = new Model();
    const p = { base: [0, 0, 0], width: 1.2, depth: 1.2, baseLevel: 'lvl_0', thickness: 0.6, pedestal: { width: 0.4, depth: 0.4, height: 0.3 } };
    const faces = mgr([]).buildFooting(G, m, p);
    near(m.shellVolume(faces.map(f => f.id)), 1.2 * 1.2 * 0.6 + 0.4 * 0.4 * 0.3, 1e-9);
    const zs = faces.flatMap(f => m.pts(f.loop).map(q => q.z));
    near(Math.min(...zs), -0.6, 1e-9); near(Math.max(...zs), 0.3, 1e-9);
  });

  // ================================================== 4. wall clearance
  const WALL = { // infill wall bounded Level 0 -> Level 1 (4 m story)
    id: 'wall_1', base: [0, 0, 0], end: [6, 0, 0], thickness: 0.2,
    baseLevel: 'lvl_0', topConstraint: 'lvl_1', height: 4,
  };
  const slabOverWall = { // 0.2 m slab at Level 1 covering the wall baseline
    id: 'slab_1', type: 'slab',
    params: { baseLevel: 'lvl_1', thickness: 0.2, regions: [{ outer: [[-1, -2, 4], [7, -2, 4], [7, 2, 4], [-1, 2, 4]], holes: [] }] },
  };
  const beamOverWall = { // 0.6 m drop beam along the wall baseline at Level 1
    id: 'beam_1', type: 'beam',
    params: { referenceLevelId: 'lvl_1', zJustification: 'Top', profile: 'rectangular', height: 0.6, webWidth: 0.25, baseline: [[0, 0, 4], [6, 0, 4]] },
  };
  const beamBesideWall = { // parallel beam 2 m away: must not deduct
    id: 'beam_2', type: 'beam',
    params: { referenceLevelId: 'lvl_1', zJustification: 'Top', profile: 'rectangular', height: 0.6, webWidth: 0.25, baseline: [[0, 2, 4], [6, 2, 4]] },
  };
  const slabWithHole = { // slab whose opening fully contains the wall baseline
    id: 'slab_2', type: 'slab',
    params: {
      baseLevel: 'lvl_1', thickness: 0.2,
      regions: [{ outer: [[-1, -2, 4], [7, -2, 4], [7, 2, 4], [-1, 2, 4]], holes: [[[1, -1, 4], [5, -1, 4], [5, 1, 4], [1, 1, 4]]] }],
    },
  };
  const WALL_IN_HOLE = { ...WALL, base: [2, 0, 0], end: [4, 0, 0] };

  test('wall under a slab only: H = story - t_slab', () => {
    const cl = mgr([slabOverWall]).wallClearance(WALL);
    near(cl.clearHeight, 4 - 0.2);
    near(cl.topZ, 3.8);
    near(cl.slabDeduction, 0.2);
    near(cl.beamDeduction, 0);
    near(cl.formulaHeight, 3.8); // H = story - t_slab - h_beam_web (0)
  });
  test('wall under a beam only: top terminates at the beam bottom', () => {
    const cl = mgr([beamOverWall]).wallClearance(WALL);
    near(cl.topZ, 4 - 0.6);          // Z_bottom_of_beam
    near(cl.clearHeight, 3.4);
    near(cl.slabDeduction, 0);
    near(cl.beamDeduction, 0.6);     // h_beam_web measured below the (absent) slab soffit
    near(cl.formulaHeight, 3.4);
  });
  test('wall under slab + drop beam: H = story - t_slab - h_beam_web', () => {
    const cl = mgr([slabOverWall, beamOverWall]).wallClearance(WALL);
    near(cl.topZ, Math.min(3.8, 3.4), 1e-9);
    near(cl.slabDeduction, 0.2);
    near(cl.beamDeduction, 0.4);     // beam web below the slab soffit: 3.8 - 3.4
    near(cl.formulaHeight, 4 - 0.2 - 0.4);
    eq(cl.deductions.length, 2);
  });
  test('structure away from the baseline does not constrain the wall', () => {
    const cl = mgr([beamBesideWall]).wallClearance(WALL);
    near(cl.topZ, 4);
    near(cl.clearHeight, 4);
    eq(cl.deductions.length, 0);
  });
  test('slab opening over the wall means no slab deduction', () => {
    const cl = mgr([slabWithHole]).wallClearance(WALL_IN_HOLE);
    near(cl.topZ, 4);
    eq(cl.deductions.length, 0);
  });
  test('structure at another level is ignored', () => {
    const upperSlab = { id: 'slab_9', type: 'slab', params: { baseLevel: 'lvl_2', thickness: 0.2, regions: [{ outer: [[-1, -2, 8], [7, -2, 8], [7, 2, 8], [-1, 2, 8]], holes: [] }] } };
    const cl = mgr([upperSlab]).wallClearance(WALL);
    near(cl.topZ, 4);
    // a floor slab UNDER the wall's base never deducts either
    const lowerSlab = { id: 'slab_8', type: 'slab', params: { baseLevel: 'lvl_0', thickness: 0.2, regions: [{ outer: [[-1, -2, 0], [7, -2, 0], [7, 2, 0], [-1, 2, 0]], holes: [] }] } };
    near(mgr([lowerSlab]).wallClearance(WALL).topZ, 4);
  });
  test('clearance floors at a minimum height instead of collapsing', () => {
    const deep = { ...beamOverWall, params: { ...beamOverWall.params, height: 3.95 } };
    const cl = mgr([deep]).wallClearance(WALL, { minHeight: 0.05 });
    near(cl.clearHeight, 0.05);
  });

  // ================================================== 5. join priority
  test('priority ordering: column > beam > slab > wall', () => {
    eq(SM.priorityOf('column'), 1);
    eq(SM.priorityOf('beam'), 2);
    eq(SM.priorityOf('slab'), 3);
    eq(SM.priorityOf('wall'), 4);
    ok(SM.priorityOf('foundation') <= SM.priorityOf('column'));
    ok(SM.priorityOf('column') < SM.priorityOf('beam'));
    ok(SM.priorityOf('beam') < SM.priorityOf('slab'));
    ok(SM.priorityOf('slab') < SM.priorityOf('wall'));
  });
  test('quantity takeoff: slab yields its overlap to a passing column', () => {
    const m = new Model();
    const col = { id: 'col_1', type: 'column', params: { base: [2, 0, 0], width: 0.4, depth: 0.4, baseLevelId: 'lvl_0', topLevelId: 'lvl_1' } };
    const slab = { id: 'slab_1', type: 'slab', params: { baseLevel: 'lvl_1', thickness: 0.2, regions: [{ outer: [[0, -2, 4], [6, -2, 4], [6, 2, 4], [0, 2, 4]], holes: [] }] } };
    const rep = mgr([col, slab]).quantityReport(m);
    const c = rep.items.find(x => x.id === 'col_1');
    const s = rep.items.find(x => x.id === 'slab_1');
    near(c.gross, 0.4 * 0.4 * 4);
    near(c.net, c.gross, 1e-9); // column never yields
    near(s.gross, 6 * 4 * 0.2);
    near(s.net, s.gross - 0.4 * 0.4 * 0.2, 1e-9); // column footprint through the slab
    eq(s.lost.length, 1);
    eq(s.lost[0].to, 'col_1');
  });
  test('quantity takeoff: wall terminates under the beam (no duplicate volume)', () => {
    const m = new Model();
    const wall = { id: 'wall_1', type: 'wall', params: { ...WALL } };
    wall.params.height = 3.4; // cleared height from the clearance engine
    const beam = { ...beamOverWall };
    const rep = mgr([wall, beam]).quantityReport(m);
    const w = rep.items.find(x => x.id === 'wall_1');
    near(w.gross, 6 * 0.2 * 3.4, 1e-9);
    near(w.net, w.gross, 1e-6); // wall stops below the beam: nothing overlaps
  });
  test('quantity takeoff: un-cleared wall overlapping a beam loses the overlap', () => {
    const m = new Model();
    const wall = { id: 'wall_1', type: 'wall', params: { ...WALL } }; // height 4 (not cleared)
    const rep = mgr([wall, beamOverWall]).quantityReport(m);
    const w = rep.items.find(x => x.id === 'wall_1');
    // beam web 0.25 wide, z [3.4, 4] crosses the wall band over the full 6 m
    near(w.net, 6 * 0.2 * 4 - 6 * 0.2 * 0.6, 1e-9);
  });
  test('quantity takeoff: T-beam flange/web split stays exact', () => {
    const m = new Model();
    const beam = {
      id: 'beam_1', type: 'beam',
      params: { referenceLevelId: 'lvl_1', profile: 't', height: 0.6, webWidth: 0.25, flangeWidth: 0.8, flangeThickness: 0.15, baseline: [[0, 0, 4], [5, 0, 4]] },
    };
    const rep = mgr([beam]).quantityReport(m);
    near(rep.items[0].gross, (0.25 * 0.45 + 0.8 * 0.15) * 5, 1e-9);
  });

  // ================================================== 6. constructive precedence
  test('slab stays SOLID where columns pass through (v0.6: overlap, no punch)', () => {
    const m = new Model();
    const col = { id: 'col_1', type: 'column', params: { base: [2, 0, 0], width: 0.4, depth: 0.4, baseLevelId: 'lvl_0', topLevelId: 'lvl_1' } };
    const M = mgr([col]);
    const region = { outer: [[0, -2, 4], [6, -2, 4], [6, 2, 4], [0, 2, 4]], holes: [] };
    const holes = M.columnHolesForSlab(m, { baseLevel: 'lvl_1', thickness: 0.2, _planeZ: 4 }, region);
    eq(holes.length, 0, 'v0.6: columnHolesForSlab never punches');
    // the slab extrudes SOLID; the passing column overlaps it by ELEMENT_EPS
    const outer = region.outer.map(q => G.v(q[0], q[1], q[2]));
    const f = m.addFaceFromRings(outer);
    ok(f && f.holes.length === 0, 'slab face is solid');
    ok(m.pushPull(f, -0.2));
    eq(m.validate().ok, true);
    near(m.shellVolume([...m.faces.keys()]), 6 * 4 * 0.2, 1e-9);
  });
  test('columnHolesForSlab is a no-op for every configuration (v0.6)', () => {
    const m = new Model();
    const edge = { id: 'col_e', type: 'column', params: { base: [6, 0, 0], width: 0.4, depth: 0.4, baseLevelId: 'lvl_0', topLevelId: 'lvl_1' } };   // on the region boundary
    const below = { id: 'col_b', type: 'column', params: { base: [2, 0, 0], width: 0.4, depth: 0.4, baseLevelId: 'lvl_0', topLevelId: 'lvl_0', topOffset: 2 } }; // stops below the slab
    const region = { outer: [[0, -2, 4], [6, -2, 4], [6, 2, 4], [0, 2, 4]], holes: [] };
    const holes = mgr([edge, below]).columnHolesForSlab(m, { baseLevel: 'lvl_1', thickness: 0.2, _planeZ: 4 }, region);
    eq(holes.length, 0);
  });
  test('column built through an existing slab welds monolithically', () => {
    const m = new Model();
    // slab first: 5x4 at level 1, pushed down 0.2
    const sf = m.addFaceFromRings([G.v(0, -2, 4), G.v(5, -2, 4), G.v(5, 2, 4), G.v(0, 2, 4)]);
    ok(m.pushPull(sf, -0.2));
    const slabFacesBefore = new Set(m.faces.keys());
    // column through it: base 2 m above Level 0 (baseOffset), top at the
    // slab top plane (Level 1)
    const col = { base: [2, 0, 2], width: 0.3, depth: 0.3, baseLevelId: 'lvl_0', topLevelId: 'lvl_1', baseOffset: 2 };
    const faces = mgr([]).buildColumn(G, m, col);
    eq(m.validate().ok, true, 'column-through-slab model must stay valid');
    // the slab's top face was holed where the column passes
    const topHoled = [...m.faces.keys()].filter(id => slabFacesBefore.has(id))
      .map(id => m.faces.get(id))
      .some(f => f.holes && f.holes.length);
    ok(topHoled, 'slab top face should carry the column opening');
    // union volume = slab + column shaft below the slab soffit (the
    // pass-through band is shared, welded once)
    const total = m.shellVolume([...m.faces.keys()]);
    near(total, 5 * 4 * 0.2 + 0.3 * 0.3 * (3.8 - 2), 1e-6);
  });

  // ================================================== 7. beam role classification
  test('beam faces classify into caps / flange / web', () => {    const m = new Model();
    const p = {
      referenceLevelId: 'lvl_1', profile: 't', height: 0.6, webWidth: 0.25,
      flangeWidth: 0.8, flangeThickness: 0.15, baseline: [[0, 0, 4], [3, 0, 4]],
    };
    const M = mgr([]);
    const faces = M.buildBeam(G, m, p);
    const roles = M.classifyBeamRoles(G, m, faces, p);
    const vals = Object.values(roles);
    eq(new Set(vals).size > 1, true);
    ok(vals.includes('start_cap') && vals.includes('end_cap'));
    ok(vals.includes('flange') && vals.includes('web'));
  });

  // ================================================== 8. clean-up (wire purge)
  test('wireEdges finds orphans; purgeWireEdges removes them and only them', () => {
    const m = new Model();
    const box = m.addFaceFromRings([G.v(0, 0, 0), G.v(2, 0, 0), G.v(2, 2, 0), G.v(0, 2, 0)]);
    ok(m.pushPull(box, 1), 'box built');
    // a free-floating stray (construction residue look-alike)
    const stray = { id: 999001, a: box.loop[0], b: box.loop[2], curveId: 0 };
    m.edges.set(stray.id, stray);
    eq(m.wireEdges().length, 1);
    eq(m.wireEdges()[0].id, stray.id);
    const n = m.purgeWireEdges();
    eq(n, 1);
    eq(m.wireEdges().length, 0);
    ok(m.edges.size >= 12, 'face edges untouched');
    near(m.shellVolume([...m.faces.keys()]), 2 * 2 * 1, 1e-9, 'volume intact');
    eq(m.validate().ok, true);
  });
  test('softened edges: hidden flag survives serialize/load, unhide restores', () => {
    const m = new Model();
    const f = m.addFaceFromRings([G.v(0, 0, 0), G.v(2, 0, 0), G.v(2, 2, 0), G.v(0, 2, 0)]);
    ok(m.pushPull(f, 1));
    const e = m.findEdge(f.loop[0], f.loop[1]);
    ok(e, 'edge exists');
    e.hidden = true;
    const snap = m.serialize();
    const m2 = new Model();
    m2.load(JSON.parse(JSON.stringify(snap)));
    const e2 = m2.findEdge(e.a, e.b);
    eq(e2.hidden, true, 'hidden survives round-trip');
    eq(m2.unhideAllEdges(), 1);
    eq(e2.hidden, false);
    eq(m2.unhideAllEdges(), 0, 'idempotent');
    // hidden is display-only: faces and volume untouched
    eq(m2.faces.size, m.faces.size);
    near(m2.shellVolume([...m2.faces.keys()]), 4, 1e-9);
  });
  test('glTF export: box triangulates with materials and Y-up root', () => {
    const m = new Model();
    const f = m.addFaceFromRings([G.v(0, 0, 0), G.v(2, 0, 0), G.v(2, 2, 0), G.v(0, 2, 0)]);
    ok(m.pushPull(f, 1));
    m.faces.get(f.id).color = '#ff0000';
    const gltf = GltfExporter.fromModel(m);
    eq(gltf.asset.version, '2.0');
    const prim = gltf.meshes[0].primitives;
    eq(prim.length, 2, 'two materials: red top + default sides');
    eq(prim.reduce((s2, p2) => s2 + p2._triCount, 0), 12, 'box = 12 triangles');
    // positions accessor covers 24 verts (4 per face x 6)
    const posAcc = gltf.accessors[prim[0].attributes.POSITION];
    eq(prim.reduce((s2, p2) => s2 + gltf.accessors[p2.attributes.POSITION].count, 0), 24);
    // Y-up conversion on the root node (-90 deg about X)
    near(gltf.nodes[0].rotation[0], -Math.SQRT1_2, 1e-9);
    near(gltf.nodes[0].rotation[3], Math.SQRT1_2, 1e-9);
    // buffer parses back to exactly byteLength
    const b64 = gltf.buffers[0].uri.split(',')[1];
    const buf = Buffer.from(b64, 'base64');
    eq(buf.byteLength, gltf.buffers[0].byteLength, 'embedded buffer length matches');
    ok(buf.byteLength > 0);
    // hidden faces are not exported
    const before = prim.reduce((s2, p2) => s2 + p2._triCount, 0);
    for (const g of m.faces.values()) g.hidden = true;
    const empty = GltfExporter.fromModel(m);
    eq(empty.meshes[0].primitives.length, 0, 'all-hidden model exports no primitives');
  });
  test('clean model purges nothing', () => {
    const m = new Model();
    const f = m.addFaceFromRings([G.v(0, 0, 0), G.v(1, 0, 0), G.v(1, 1, 0), G.v(0, 1, 0)]);
    ok(f);
    eq(m.purgeWireEdges(), 0);
    eq(m.faces.size, 1);
  });
};
