'use strict';
// ---------------------------------------------------------------------------
// columnfamilies.test.js — the parametric Column family catalog.
//
// columnFamilies.js is pure data + plan-ring geometry; StructuralManager
// consumes it (buildColumn dispatch, slab punch ring, per-segment takeoff).
// These tests pin the whole chain:
//
//   1. the registry itself — 26+ designs, unique ids, sane groups/params
//   2. parts() at MANY dimension sets — tiers ordered, spanning [0, H],
//      simple (non-self-crossing) rings, all positive area
//   3. family-specific contracts — drop-panel dims honored + shaft punch
//   4. the B-Rep path — every family extrudes through the real kernel and
//      leaves a valid model (validate() clean)
//   5. quantity takeoff — rect is exact w·d·H; families stay positive;
//      the drop panel adds its own volume tier
// ---------------------------------------------------------------------------
module.exports = h => {
  const { G, Model, StructuralManager: SM, ColumnFamilies: CF, StructuralManager } = h.loadModel();
  const { test, ok, eq, near } = h;
  const Geo2D = StructuralManager.Geo2D;

  const LEVELS = [
    { id: 'lvl_0', name: 'Level 0', elevation: 0.0 },
    { id: 'lvl_1', name: 'Level 1', elevation: 3.5 },
  ];
  const mgr = entities => new SM(() => LEVELS, () => entities || []);

  // dimension stress sets (meters): default-ish, wide/flat, deep/thin, chunky
  const DIM_SETS = [
    { width: 0.3, depth: 0.3 },
    { width: 0.8, depth: 0.25 },
    { width: 0.2, depth: 0.9 },
    { width: 1.2, depth: 1.0 },
  ];
  const HS = [3.5, 2.4, 6.0, 0.6]; // story heights incl. one stubby

  // ======================================================== 1. the registry
  test('registry: 26+ designs, unique ids, valid groups', () => {
    ok(CF.list.length >= 26, `only ${CF.list.length} families`);
    const ids = new Set(CF.list.map(f => f.id));
    eq(ids.size, CF.list.length, 'family ids must be unique');
    const groups = new Set(CF.groups.map(g => g.id));
    for (const f of CF.list) ok(groups.has(f.group), `${f.id}: unknown group ${f.group}`);
  });
  test('registry: every family exposes width + depth and a description', () => {
    for (const f of CF.list) {
      const keys = f.params.map(p => p.key);
      ok(keys.includes('width') && keys.includes('depth'), `${f.id}: missing width/depth`);
      ok(f.name && f.desc, `${f.id}: missing name/desc`);
      ok(typeof f.build === 'function', `${f.id}: missing build()`);
    }
  });

  // ===================================================== 2. parts() sanity
  test('parts(): tiers ordered, tile the story exactly, rings simple', () => {
    for (const f of CF.list) {
      for (const dims of DIM_SETS) {
        for (const H of HS) {
          const spec = CF.parts(f.id, dims, H);
          ok(spec && spec.segments.length >= 1, `${f.id}: no segments`);
          let z = 0;
          for (const s of spec.segments) {
            ok(s.z0 >= -1e-9 && s.z1 <= H + 1e-9, `${f.id}: tier escapes [0,H]`);
            ok(s.z1 > s.z0, `${f.id}: tier with zero/negative height at z=${s.z0}`);
            near(s.z0, z, 1e-9, `${f.id}: gap/overlap between tiers`);
            z = s.z1;
            ok(s.ring.length >= 3, `${f.id}: ring below 3 points`);
            ok(!G.ringDegenerate(s.ring), `${f.id}: degenerate/self-crossing ring`);
            ok(Geo2D.absArea(s.ring) > 0, `${f.id}: zero-area ring`);
          }
          near(z, H, 1e-6, `${f.id}: tiers do not sum to the story height`);
        }
      }
    }
  });
  test('parts(): everything scales from width/depth — bigger in, bigger out', () => {
    const area = (id, p, H) => {
      const spec = CF.parts(id, p, H);
      const byRole = {};
      for (const s of spec.segments)
        byRole[s.role] = (byRole[s.role] || 0) + Geo2D.absArea(s.ring) * (s.z1 - s.z0);
      return byRole;
    };
    const a1 = area('tuscan', { width: 0.3, depth: 0.3 }, 3.5);
    const a2 = area('tuscan', { width: 0.6, depth: 0.6 }, 3.5);
    ok(a2.shaft > a1.shaft * 3, 'double dims must grow the shaft (squared)');
    ok(a2.capital > a1.capital, 'capital follows the section');
  });

  // ============================================= 3. family-specific deals
  test('drop panel: real drop dims, panel wider+thicker than the shaft', () => {
    const p = { width: 0.3, depth: 0.4, dropWidth: 1.1, dropDepth: 0.95, dropThickness: 0.2 };
    const spec = CF.parts('drop_panel', p, 3.5);
    const panel = spec.segments.find(s => s.role === 'panel');
    const shaft = spec.segments.find(s => s.role === 'shaft');
    ok(panel && shaft, 'drop panel needs a panel tier and a shaft tier');
    near(panel.z1 - panel.z0, 0.2, 1e-6, 'panel thickness must be the typed value');
    const pb = CF.Ring.bounds(panel.ring), sb = CF.Ring.bounds(shaft.ring);
    near(pb.w, 1.1, 1e-6); near(pb.d, 0.95, 1e-6);
    ok(pb.w > sb.w && pb.d > sb.d, 'the drop head must surround the shaft');
    near(panel.z1, 3.5, 1e-6, 'without a slab the head reaches the story top');
  });

  // ---------------------------------------- drop panel × slab interaction
  // The head must hang UNDER a covering slab: draw order must not matter.
  const SLAB = {
    id: 'slab_1', type: 'slab',
    params: {
      baseLevel: 'lvl_1', levelId: 'lvl_1', thickness: 0.25,
      regions: [{ outer: [[-5, -5, 3.5], [5, -5, 3.5], [5, 5, 3.5], [-5, 5, 3.5]], holes: [] }],
    },
  };
  const DPP = { family: 'drop_panel', base: [0, 0, 0], width: 0.3, depth: 0.3, dropWidth: 0.9, dropDepth: 0.9, dropThickness: 0.15, baseLevelId: 'lvl_0', topLevelId: 'lvl_1', height: 3.5 };

  test('dropPanelSoffit: lowest covering slab at the top level wins', () => {
    near(mgr([SLAB]).dropPanelSoffit(null, DPP), 3.25, 1e-9, 'covering slab soffit = 3.5 − 0.25');
    eq(mgr([]).dropPanelSoffit(null, DPP), null, 'no slab → null');
    eq(mgr([SLAB]).dropPanelSoffit(null, { ...DPP, family: 'tuscan' }), null, 'non-drop families never hang');
    const miss = { ...SLAB, params: { ...SLAB.params, regions: [{ outer: [[2, 2, 3.5], [6, 2, 3.5], [6, 6, 3.5], [2, 6, 3.5]], holes: [] }] } };
    eq(mgr([miss]).dropPanelSoffit(null, DPP), null, 'slab not covering the shaft → null');
    const deeper = { ...SLAB, params: { ...SLAB.params, thickness: 0.4 } };
    near(mgr([SLAB, deeper]).dropPanelSoffit(null, DPP), 3.1, 1e-9, 'lowest soffit of two slabs wins');
    // a PENDING slab (not yet in the registry) counts via the pool
    near(mgr([]).dropPanelSoffit(null, DPP, [SLAB]), 3.25, 1e-9);
  });
  test('columnSolidTop: head hangs 0.5 mm under the soffit; override honored', () => {
    near(mgr([SLAB]).columnSolidTop(null, DPP), 3.25 - 5e-4, 1e-9);
    near(mgr([]).columnSolidTop(null, DPP), 3.5, 1e-9, 'no slab → level plane');
    near(mgr([SLAB]).columnSolidTop(null, { ...DPP, panelTopZ: 3.0 }), 3.0, 1e-9, 'explicit panelTopZ wins (re-fit path)');
    // a soffit absurdly low (no room left) falls back to the level plane
    const huge = { ...SLAB, params: { ...SLAB.params, thickness: 3.4 } };
    near(mgr([huge]).columnSolidTop(null, DPP), 3.5, 1e-9);
  });
  test('buildColumn: drop head lands under an existing slab (order 1 — slab first)', () => {
    const m = new Model();
    const faces = mgr([SLAB]).buildColumn(G, m, DPP);
    ok(faces.length >= 2);
    ok(m.validate().ok);
    let zMax = -Infinity;
    for (const f of faces) zMax = Math.max(zMax, m.faceCentroid(f).z);
    near(zMax, 3.25 - 5e-4, 1e-6, 'panel top = soffit − stagger');
    // and nothing reaches into the slab band
    for (const f of faces) ok(m.faceCentroid(f).z <= 3.25 - 5e-4 + 1e-6, 'no geometry inside the slab');
  });
  test('buildColumn: re-fit moves an already-built head down (order 2 — column first)', () => {
    const m = new Model();
    const before = mgr([]).buildColumn(G, m, DPP);
    let zMax = -Infinity;
    for (const f of before) zMax = Math.max(zMax, m.faceCentroid(f).z);
    near(zMax, 3.5, 1e-6, 'without a slab the head tops out at the level plane');
    // what app.bim.refitDropPanelColumn does: delete + rebuild at panelTopZ
    for (const f of [...before]) m.faces.delete(f.id);
    m.gc();
    const after = mgr([SLAB]).buildColumn(G, m, { ...DPP, panelTopZ: 3.25 - 5e-4 });
    let zMax2 = -Infinity;
    for (const f of after) zMax2 = Math.max(zMax2, m.faceCentroid(f).z);
    near(zMax2, 3.25 - 5e-4, 1e-6, 'rebuilt head now hangs under the slab');
    ok(m.validate().ok);
  });
  test('takeoff: drop head under a slab follows the shifted band', () => {
    const vol = structure => {
      const ent = { id: 'c1', type: 'column', params: DPP };
      const parts = mgr(structure).prismParts(null, ent);
      return parts.map(p => ({ z: [p.zBot, p.zTop], a: Geo2D.absArea(p.outer) }));
    };
    const under = vol([SLAB]);
    eq(under.length, 2, 'shaft + panel prisms');
    near(under[1].z[1], 3.25 - 5e-4, 1e-6, 'panel prism tops at the soffit');
    near(under[0].z[1], 3.25 - 5e-4 - 0.15, 1e-6, 'shaft stops under the panel');
  });
  test('columnHolesForSlab: drop panels never punch (they re-fit under); rect columns do', () => {
    const region = { outer: SLAB.params.regions[0].outer.map(q => ({ x: q[0], y: q[1] })), holes: [] };
    const slabP = { baseLevel: 'lvl_1', levelId: 'lvl_1', thickness: 0.25, _planeZ: 3.5 };
    const dpCol = { id: 'c1', type: 'column', params: DPP };
    eq(mgr([dpCol, SLAB]).columnHolesForSlab(null, slabP, region).length, 0,
      'drop-panel columns re-fit under the slab instead of punching it');
    const rectCol = { id: 'c2', type: 'column', params: { base: [0, 0, 0], width: 0.3, depth: 0.3, baseLevelId: 'lvl_0', topLevelId: 'lvl_1', height: 3.5 } };
    eq(mgr([rectCol]).columnHolesForSlab(null, slabP, region).length, 1,
      'plain columns still punch through');
  });

  test('normalize: couplings — drop surrounds the shaft, plans stay buildable', () => {
    const dp = CF.normalize('drop_panel', { width: 0.5, depth: 0.5, dropWidth: 0.3, dropDepth: 0.6, dropThickness: 0.05 });
    ok(dp.dropWidth >= dp.width + 0.1, 'drop width clamps above the shaft');
    ok(dp.dropDepth >= dp.depth + 0.1, 'drop depth clamps above the shaft');
    const tw = CF.normalize('twin_coupled', { width: 0.3, depth: 0.4 });
    ok(tw.width > tw.depth, 'twin coupled needs width > depth');
    const cr = CF.normalize('cross', { width: 0.3, depth: 0.3, webThick: 0.9 });
    ok(cr.webThick <= 0.27 + 1e-9, 'arm thickness clamps inside the plan');
    // idempotent
    eq(JSON.stringify(CF.normalize('corinthian', CF.normalize('corinthian', {}))),
      JSON.stringify(CF.normalize('corinthian', {})), 'normalize is idempotent');
    ok(!CF.get('nope'), 'unknown family is null');
  });
  test('classical orders: capitals flare wider than their shafts', () => {
    for (const id of ['tuscan', 'greek_doric', 'roman_doric', 'roman_ionic', 'corinthian', 'composite']) {
      const spec = CF.parts(id, { width: 0.4, depth: 0.4 }, 3.5);
      const caps = spec.segments.filter(s => s.role === 'capital');
      const shaft = spec.segments.filter(s => s.role === 'shaft');
      ok(caps.length >= 1 && shaft.length >= 1, `${id}: needs capital and shaft tiers`);
      const capW = Math.max(...caps.map(s => CF.Ring.bounds(s.ring).w));
      const shaftW = Math.max(...shaft.map(s => CF.Ring.bounds(s.ring).w));
      ok(capW > shaftW, `${id}: capital (${capW}) must flare past the shaft (${shaftW})`);
    }
  });

  // ==================================================== 4. the B-Rep path
  test('buildColumn: every family extrudes through the kernel, model validates', () => {
    for (const f of CF.list) {
      const m = new Model();
      const mgr0 = mgr([]);
      const params = Object.assign(
        { base: [0, 0, 0], width: 0.4, depth: 0.4, baseLevelId: 'lvl_0', topLevelId: 'lvl_1', height: 3.5 },
        CF.defaults(f.id));
      const faces = mgr0.buildColumn(G, m, params);
      ok(faces.length >= 2, `${f.id}: expected side+cap faces, got ${faces.length}`);
      const v = m.validate();
      ok(v.ok, `${f.id}: validate: ${(v.errors || []).slice(0, 3).join(' | ')}`);
      // every tier face lives inside the column's z band
      const b = mgr0.columnBounds(params);
      for (const fc of faces) {
        const c = m.faceCentroid(fc);
        ok(c.z >= b.zStart - 1e-6 && c.z <= b.zEnd + 1e-6, `${f.id}: face outside the column band`);
      }
    }
  });
  test('buildColumn: legacy no-family params still build the plain prism', () => {
    const m = new Model();
    const faces = mgr([]).buildColumn(G, m, { base: [1, 1, 0], width: 0.3, depth: 0.3, baseLevelId: 'lvl_0', topLevelId: 'lvl_1', height: 3.5 });
    ok(faces.length >= 2);
    ok(m.validate().ok);
  });

  // ================================================ 5. takeoff + punching
  test('prismParts: rect is exactly w·d·H; families positive; drop adds a tier', () => {
    const vol = (family, p) => {
      const ent = { type: 'column', params: Object.assign({ family, baseLevelId: 'lvl_0', topLevelId: 'lvl_1' }, p) };
      const parts = mgr([]).prismParts(null, ent);
      return parts.reduce((s, q) => s + Geo2D.absArea(q.outer) * (q.zTop - q.zBot), 0);
    };
    near(vol('rect', { width: 0.3, depth: 0.4 }), 0.3 * 0.4 * 3.5, 1e-9);
    for (const f of CF.list) ok(vol(f.id, CF.defaults(f.id)) > 0, `${f.id}: takeoff volume must be positive`);
    // the drop panel contributes its own extra volume over the bare shaft
    const bare = vol('drop_panel', { width: 0.3, depth: 0.3, dropWidth: 0.9, dropDepth: 0.9, dropThickness: 0.15 });
    const ref = 0.3 * 0.3 * (3.5 - 0.15) + 0.9 * 0.9 * 0.15;
    near(bare, ref, 1e-6, 'shaft × (H − t) plus the drop tier');
  });
  test('columnPunch: classical punches with the top tier; legacy = footprint', () => {
    const cor = mgr([]).columnPunch({ family: 'corinthian', base: [0, 0, 0], width: 0.3, depth: 0.3, baseLevelId: 'lvl_0', topLevelId: 'lvl_1', height: 3.5 });
    const cx = cor.map(q => q.x);
    near(Math.max(...cx) - Math.min(...cx), 1.35 * 0.3, 1e-6, 'corinthian punch = abacus (top tier)');
    // no family → the plain footprint
    const leg = mgr([]).columnPunch({ base: [0, 0, 0], width: 0.5, depth: 0.25 });
    const lx = leg.map(q => q.x);
    near(Math.max(...lx) - Math.min(...lx), 0.5, 1e-9);
  });
};
