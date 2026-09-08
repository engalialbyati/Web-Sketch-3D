'use strict';
// ---------------------------------------------------------------------------
// Feature: Demo5 — the 5-story test building, loadable in the app.
// File ▸ Load 5-Story Building (or the 'demo5' / 'building' command):
// a fresh model with 6 levels, a 2x2 column grid (A-B / 1-2), isolated
// footings, story-height columns, the perimeter beam frame, slabs at
// levels 2-5 punched at every column, and a flat roof — the same scene
// test/building5.test.js proves, through the same real builders.
// ---------------------------------------------------------------------------
(function () {
  const num = (v, d) => (v != null && isFinite(+v)) ? +v : d;

  function build(app) {
    const m = app.model, bim = app.bim, G = window.G, S = app.structural;
    if (!S || !window.RoofFeature) throw new Error('structural/roof features missing');
    const STORY = 3.2, LEVELS = 6;
    const PTS = [[0, 0], [6, 0], [0, 5], [6, 5]];

    m.beginEdgeSweep();
    try {
      // levels lvl_1..lvl_6 (the level manager re-reads model.levels)
      m.levels = Array.from({ length: LEVELS }, (_, i) =>
        ({ id: 'lvl_' + (i + 1), name: 'L' + (i + 1), elevation: +(i * STORY).toFixed(3) }));

      // register + build in one step: claim only unstamped new faces
      const reg = (type, params, buildGeom, roleOf) => {
        const before = new Set(m.faces.keys());
        m.bimHold = true;
        let out;
        try { out = buildGeom(); } finally { m.bimHold = false; }
        const nf = [...m.faces.keys()].filter(id => !before.has(id))
          .map(id => m.faces.get(id)).filter(f => f && !f.userData);
        const roles = {};
        for (const f of nf) roles[f.id] = roleOf(f, params);
        const edges = [];
        for (const f of nf) for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
          const e = m.findEdge(r[i], r[(i + 1) % r.length]);
          if (e && !e.userData) edges.push(e.id);
        }
        return bim.create(type, JSON.parse(JSON.stringify(params)), roles, [...new Set(edges)]);
      };

      // 1) footings under the ground-floor columns
      for (const [x, y] of PTS)
        reg('foundation', { base: [x, y, 0], width: 1.0, depth: 1.0, thickness: 0.5, baseLevel: 'lvl_1' },
          () => S.buildFooting(G, m, { base: [x, y, 0], width: 1.0, depth: 1.0, thickness: 0.5, baseLevel: 'lvl_1' }),
          f => { const c = m.faceCentroid(f);
            return Math.abs(c.z + 0.5) < 1e-3 ? 'bottom' : Math.abs(c.z) < 1e-3 ? 'top' : 'side'; });

      // 2) story-height columns (5 mm reveal above the footings)
      for (let s = 0; s < LEVELS - 1; s++) {
        const z0 = s * STORY + (s === 0 ? 0.005 : 0);
        const h = STORY - (s === 0 ? 0.005 : 0);
        for (const [x, y] of PTS) {
          const p = { base: [x, y, z0], width: 0.3, depth: 0.3, height: h,
            baseLevelId: 'lvl_' + (s + 1), topLevelId: 'lvl_' + (s + 2) };
          reg('column', p, () => S.buildColumn(G, m, p),
            f => { const c = m.faceCentroid(f);
              return Math.abs(c.z - z0) < 1e-3 ? 'bottom' : Math.abs(c.z - z0 - h) < 1e-3 ? 'top' : 'side'; });
        }
      }

      // 3) perimeter beams at every level (rect 0.3 x 0.5, hanging)
      const EDGES = [
        [[0, 0], [6, 0]], [[0, 5], [6, 5]],
        [[0, 0], [0, 5]], [[6, 0], [6, 5]],
      ];
      for (let s = 1; s < LEVELS; s++) {
        const z = +(s * STORY - 0.25).toFixed(4);
        for (const [A, B] of EDGES) {
          const p = { baseline: [[A[0], A[1], z], [B[0], B[1], z]],
            profile: 'rectangular', webWidth: 0.3, height: 0.5 };
          reg('beam', p, () => S.buildBeam(G, m, p), () => 'body');
        }
      }

      // 4) slabs at levels 2..5, punched by the columns ending at each plane
      for (let s = 1; s < LEVELS - 1; s++) {
        const z = +(s * STORY).toFixed(4), th = 0.2;
        const outer = [[-0.3, -0.3, z], [6.3, -0.3, z], [6.3, 5.3, z], [-0.3, 5.3, z]];
        const punches = S.columnHolesForSlab(m,
          { baseLevel: 'lvl_' + (s + 1), thickness: th, _planeZ: z }, { outer, holes: [] });
        const holes = punches.map(p2 => p2.ring.map(q => [+q.x.toFixed(6), +q.y.toFixed(6), z]));
        reg('floor', { regions: [{ outer, holes }], thickness: th, baseLevel: 'lvl_' + (s + 1) },
          () => {
            const f = m.addFaceFromRings(outer.map(q => G.v(...q)),
              holes.map(hg => hg.map(q => G.v(...q))));
            if (!f) throw new Error('slab face degenerate');
            if (!m.pushPull(f, -th)) throw new Error('slab sweep failed');
            return f;
          },
          f => { const c = m.faceCentroid(f);
            return Math.abs(c.z - z) < 1e-3 ? 'top' : Math.abs(c.z - z + th) < 1e-3 ? 'bottom' : 'edge'; });
      }

      // 5) flat roof at the top level
      const zr = (LEVELS - 1) * STORY;
      const rPts = [[-0.3, -0.3], [6.3, -0.3], [6.3, 5.3], [-0.3, 5.3]].map(([x, y]) => G.v(x, y, zr));
      reg('roof', { kind: 'flat', thickness: 0.2, pitch: 15, overhang: 0,
          regions: [{ outer: rPts.map(p => [p.x, p.y, p.z]), holes: [] }], baseLevel: 'lvl_' + LEVELS },
        () => window.RoofFeature.buildRegion(G, m,
          { kind: 'flat', thickness: 0.2, pitch: 15, overhang: 0, region: { outer: rPts, holes: [] }, z: zr }),
        () => 'body');

      // settlement: ring edges + orphan reaping (opDone's invariants)
      for (const f of m.faces.values()) {
        m.edgesForRing(f.loop, true);
        for (const h of (f.holes || [])) m.edgesForRing(h, true);
      }
      m.reapOrphanEdges();
    } finally {
      m.endEdgeSweep();
    }
    const counts = {};
    for (const e of bim.entities) counts[e.type] = (counts[e.type] || 0) + 1;
    return counts;
  }

  window.Demo5 = { build };
})();
