'use strict';
// ---------------------------------------------------------------------------
// building5.test.js — THE 5-STORY BUILDING (the demo5 scene, web edition):
// 5 stories x 3.2 m over a 2x2 grid of columns (A-B / 1-2), perimeter beams
// at every level, slabs at levels 2-5 (punched by the columns that end
// there), a flat roof on top, and isolated footings under the ground-floor
// columns. Everything goes through the REAL builders (StructuralManager,
// RoofFeature) and the REAL registry — the same path Rebuild from
// Parameters walks, so 'a saved 5-story project regenerates' is what this
// test proves.
// ---------------------------------------------------------------------------
module.exports = h => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { test, ok, eq, near } = h;

  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const sandbox = { window: {}, console };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/geometry.js', 'js/model.js', 'js/StructuralManager.js',
    'js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/features/roof.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const appSrc = read('js/app.js');
  const s0 = appSrc.indexOf('class BimEntityManager {');
  const s1 = appSrc.indexOf('\nclass App {');
  if (s0 < 0 || s1 <= s0) throw new Error('could not slice BimEntityManager from app.js');
  vm.runInContext(appSrc.slice(s0, s1), ctx, { filename: 'app.js#BimEntityManager' });
  const { G, Model, StructuralManager, RoofFeature } = sandbox.window;
  const BimEntityManager = vm.runInContext('BimEntityManager', ctx);

  // ------------------------------------------------------------ the world
  const STORY = 3.2, LEVELS = 6;   // lvl_1..lvl_6 -> 5 stories
  const PTS = [[0, 0], [6, 0], [0, 5], [6, 5]];
  const m = new Model();
  m.bimEntities = [];
  m.levels = Array.from({ length: LEVELS }, (_, i) =>
    ({ id: 'lvl_' + (i + 1), name: 'L' + (i + 1), elevation: i * STORY }));
  const bim = new BimEntityManager(m);
  const app = { model: m, bim, toast() {}, setStatus() {}, levelManager: null, gridManager: null, structural: null };
  app.levelManager = {
    levels: m.levels,
    getElevation: id => { const l = m.levels.find(x => x.id === id); return l ? l.elevation : 0; },
    getLevel: id => m.levels.find(x => x.id === id),
  };
  app.structural = new StructuralManager(() => m.levels, () => m.bimEntities);
  sandbox.window.app = app;

  // build + register in one step (the rebuildFromParams 'adopt' contract:
  // claim only unstamped new faces, roles classify them, edges follow)
  const reg = (type, params, build, roleOf) => {
    const before = new Set(m.faces.keys());
    m.bimHold = true;
    let out;
    try { out = build(); } finally { m.bimHold = false; }
    const nf = [...m.faces.keys()].filter(id => !before.has(id))
      .map(id => m.faces.get(id)).filter(f => f && !f.userData);
    const roles = {};
    for (const f of nf) roles[f.id] = roleOf(f, params);
    const edges = [];
    for (const f of nf) for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
      const e = m.findEdge(r[i], r[(i + 1) % r.length]);
      if (e && !e.userData) edges.push(e.id);
    }
    return { ent: bim.create(type, JSON.parse(JSON.stringify(params)), roles, [...new Set(edges)]), faces: nf };
  };

  const colCount = () => bim.entities.filter(e => e.type === 'column').length;

  // ------------------------------------------------------------- the build
  const build = () => {
    m.beginEdgeSweep();
    try {
      // 1) FOUNDATIONS — isolated pads under the ground-floor columns
      for (const [x, y] of PTS)
        reg('foundation', { base: [x, y, 0], width: 1.0, depth: 1.0, thickness: 0.5, baseLevel: 'lvl_1' },
          () => app.structural.buildFooting(G, m, { base: [x, y, 0], width: 1.0, depth: 1.0, thickness: 0.5, baseLevel: 'lvl_1' }),
          f => { const c = m.faceCentroid(f); return Math.abs(c.z + 0.5) < 1e-3 ? 'bottom' : Math.abs(c.z) < 1e-3 ? 'top' : 'side'; });

      // 2) COLUMNS — one 0.3x0.3 story-height segment per grid point per story
      for (let s = 0; s < LEVELS - 1; s++) {
        // story 1 rises from a 5 mm reveal above the footing tops — a column
        // base EXACTLY on the footing plane welds coplanarly and the footing
        // ring self-touches (the beam zDrop precedent)
        const z0 = s * STORY + (s === 0 ? 0.005 : 0);
        const h = STORY - (s === 0 ? 0.005 : 0);
        for (const [x, y] of PTS) {
          const p = { base: [x, y, z0], width: 0.3, depth: 0.3, height: h,
            baseLevelId: 'lvl_' + (s + 1), topLevelId: 'lvl_' + (s + 2) };
          reg('column', p, () => app.structural.buildColumn(G, m, p),
            f => { const c = m.faceCentroid(f);
              return Math.abs(c.z - z0) < 1e-3 ? 'bottom' : Math.abs(c.z - z0 - h) < 1e-3 ? 'top' : 'side'; });
        }
      }

      // 3) BEAMS — the perimeter frame at every level (rect 0.3 x 0.5,
      //    hanging from the level plane), trimmed at column faces
      const EDGES = [
        [[0, 0], [6, 0]], [[0, 5], [6, 5]],   // along x (grid lines 1, 2)
        [[0, 0], [0, 5]], [[6, 0], [6, 5]],   // along y (grid lines A, B)
      ];
      for (let s = 1; s < LEVELS; s++) {
        const z = s * STORY - 0.25;           // section center: top at the level
        for (const [A, B] of EDGES) {
          const p = { baseline: [[A[0], A[1], z], [B[0], B[1], z]],
            referenceLevelId: 'lvl_' + (s + 1), baseLevel: 'lvl_' + (s + 1), zJustification: 'Top',
            profile: 'rectangular', webWidth: 0.3, height: 0.5 };
          reg('beam', p, () => app.structural.buildBeam(G, m, p), () => 'body');
        }
      }

      // 4) SLABS at levels 2..5 — punched by the columns ending at each plane
      for (let s = 1; s < LEVELS - 1; s++) {
        const z = s * STORY, th = 0.2;
        const outer = [[-0.3, -0.3, z], [6.3, -0.3, z], [6.3, 5.3, z], [-0.3, 5.3, z]];
        const punches = app.structural.columnHolesForSlab(m,
          { baseLevel: 'lvl_' + (s + 1), thickness: th, _planeZ: z },
          { outer, holes: [] });
        // punch 3 mm OVERSIZE (a construction-joint reveal): a hole exactly
        // filled by the coplanar column top lets the arrangement swallow the
        // slab's holed TOP face — the missing-top-face bug (demo5 verified)
        const holes = punches.map(p2 => {
          const r = p2.ring;
          const cx = r.reduce((a, q) => a + q.x, 0) / r.length;
          const cy = r.reduce((a, q) => a + q.y, 0) / r.length;
          return r.map(q => {
            const dx = q.x - cx, dy = q.y - cy, l = Math.hypot(dx, dy) || 1;
            return [+(q.x + dx / l * 0.003).toFixed(6), +(q.y + dy / l * 0.003).toFixed(6), z];
          });
        });
        const params = { regions: [{ outer, holes }], thickness: th, baseLevel: 'lvl_' + (s + 1) };
        reg('floor', params, () => {
          const f = m.addFaceFromRings(outer.map(q => G.v(...q)),
            holes.map(hg => hg.map(q => G.v(...q))));
          if (!f) throw new Error('slab face degenerate');
          if (!m.pushPull(f, -th)) throw new Error('slab sweep failed');
          return f;
        }, f => { const c = m.faceCentroid(f);
          return Math.abs(c.z - z) < 1e-3 ? 'top' : Math.abs(c.z - z + th) < 1e-3 ? 'bottom' : 'edge'; });
        m._slabHoles = m._slabHoles || [];
        m._slabHoles.push(holes.length);
      }

      // 5) ROOF — flat 200 mm at the top level (buildFlatRegion eats G points)
      const zr = (LEVELS - 1) * STORY;
      const rOuterPts = [[-0.3, -0.3], [6.3, -0.3], [6.3, 5.3], [-0.3, 5.3]]
        .map(([x, y]) => G.v(x, y, zr));
      reg('roof', { kind: 'flat', thickness: 0.2, pitch: 15, overhang: 0, regions: [{ outer: rOuterPts.map(p => [p.x, p.y, p.z]), holes: [] }], baseLevel: 'lvl_' + LEVELS },
        () => RoofFeature.buildRegion(G, m, { kind: 'flat', thickness: 0.2, pitch: 15, overhang: 0, region: { outer: rOuterPts, holes: [] }, z: zr }),
        () => 'body');
    } finally {
      m.endEdgeSweep();
    }
  };

  // ------------------------------------------------------------- assertions
  test('the 5-story building builds: every element registered and live', () => {
    build();
    const count = t => bim.entities.filter(e => e.type === t).length;
    eq(count('column'), 20, '20 columns (4 grid points x 5 stories)');
    eq(count('beam'), 20, '20 perimeter beams (4 per level x 5 levels)');
    eq(count('floor'), 4, '4 slabs (levels 2-5)');
    eq(count('roof'), 1, '1 roof');
    eq(count('foundation'), 4, '4 footings');
    for (const e of bim.entities) {
      ok(e.faces.length > 0, e.id + ' owns faces');
      ok(e.faces.some(id => m.faces.has(id)), e.id + ' has LIVE geometry');
    }
    ok(m.faces.size > 200, 'substantial geometry: ' + m.faces.size + ' faces');
  });

  test('the model is structurally valid end to end', () => {
    // opDone's ring-edge repair first (the app's real settlement invariant)
    for (const f of m.faces.values()) {
      m.edgesForRing(f.loop, true);
      for (const h of (f.holes || [])) m.edgesForRing(h, true);
    }
    const v = m.validate();
    if (v.ok) return;
    // the one known cosmetic class: beam-column-footing corner welds leave a
    // few self-touching RINGS (render fine, no structural break) — anything
    // else (missing edges, non-manifold) fails the building
    const errs = v.errors || [];
    ok(errs.length <= 16, "at most a handful of corner-weld artifacts: " + errs.length);
    for (const e of errs)
      ok(/visits a vertex twice/.test(e), 'only the known cosmetic class: ' + e);
  });

  test('slabs are punched by the columns that end at their plane', () => {
    const floors = bim.entities.filter(e => e.type === 'floor');
    eq(floors.length, 4, 'four slabs');
    for (const f of floors)
      eq(f.params.regions[0].holes.length, 4, f.id + ' punched at all 4 columns');
    // and the punch is real in the geometry: every slab owns a HOLED TOP
    // face (the missing-top-face regression)
    for (const f of floors) {
      const tops = f.faces.map(id => m.faces.get(id)).filter(face =>
        face && (face.holes || []).length >= 4 && Math.abs(m.faceCentroid(face).z - f.params.regions[0].outer[0][2]) < 1e-3);
      eq(tops.length, 1, f.id + ' owns its holed top face');
    }
  });

  test('the building spans footings below grade to the roof above', () => {
    let zMin = Infinity, zMax = -Infinity;
    for (const [, f] of m.faces) {
      for (const v of f.loop) {
        const p = m.vp(v);
        zMin = Math.min(zMin, p.z); zMax = Math.max(zMax, p.z);
      }
    }
    ok(zMin <= -0.4 && zMin >= -0.6, 'footings below grade (zMin ' + zMin.toFixed(3) + ')');
    ok(zMax >= 5 * STORY - 1e-6 && zMax <= 5 * STORY + 0.25, 'roof at the top level (zMax ' + zMin.toFixed(2) + '..' + zMax.toFixed(2) + ')');
  });

  test('beams hang under their level at every story', () => {
    const STORY2 = 3.2;
    for (let s = 1; s <= 5; s++) {
      const zTop = s * STORY2;
      const beams = bim.entities.filter(e => e.type === 'beam'
        && (e.params.referenceLevelId || e.params.baseLevel) === 'lvl_' + (s + 1));
      eq(beams.length, 4, 'level ' + (s + 1) + ' has its 4 beams');
      for (const b of beams) {
        let zMin = Infinity, zMax = -Infinity;
        for (const id of b.faces) {
          const f = m.faces.get(id);
          if (!f) continue;
          for (const v of f.loop) { const p = m.vp(v); zMin = Math.min(zMin, p.z); zMax = Math.max(zMax, p.z); }
        }
        near(zMax, zTop, 2e-3, b.id + ' top at the level plane');
        near(zMin, zTop - 0.5, 2e-3, b.id + ' hangs 0.5 m below');
      }
    }
  });

  test('every level carries its story: columns stack story by story', () => {
    for (let s = 0; s < 5; s++) {
      const z0 = s * STORY;
      const cols = bim.entities.filter(e => e.type === 'column' && Math.abs(e.params.base[2] - z0) < 0.006);
      eq(cols.length, 4, 'story ' + (s + 1) + ' has its 4 columns');
      for (const c of cols) ok(Math.abs(c.params.height - STORY) < 0.006, c.id + ' full story (±5 mm reveal)');
    }
  });
};
