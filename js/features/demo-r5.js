'use strict';
// ---------------------------------------------------------------------------
// Feature: Demo-R5 — the Revit-method engine test building.
// File > Load Revit Test Building (5-Story): everything the Element Browser
// lists, driven through its REAL parametric pathways:
//   - GRID LINES  A-D x 1-3 via GridManager (columns carry gridRef — drag a
//     grid in plan and its columns re-center on the moved intersection)
//   - LEVELS      L1..L6 via LevelManager.addLevel (Revit-style datums)
//   - FOUNDATIONS isolated pad footings under every ground column
//   - COLUMNS     12 per story at every grid intersection, grid-attached
//   - BEAMS       the full grid at every level, hung under the slab
//   - SLABS       150 mm per floor, punched at every column (3 mm reveal)
//   - ROOF        flat with 250 mm overhang
//   - ROOMS       SIX per floor: corridor on grid 2 + dividers on B and C,
//     a door from every room into the corridor, windows in every bay
// Same B-Rep substrate as demo5 but built grid-first: the datums own the
// geometry, exactly how the Revit method is meant to be tested.
// ---------------------------------------------------------------------------
(function () {

  const STORY = 3.2, LEVELS = 6;         // lvl entries L1..L6 -> 5 stories
  const XS = [0, 6, 12, 18];             // grids A..D (vertical lines)
  const YS = [0, 6, 12];                 // grids 1..3 (horizontal lines)
  const COL = 0.4, BEAM_W = 0.3, BEAM_H = 0.6, SLAB_T = 0.15;
  const GAP = 0.005;                     // wall reveal off each column face

  function program(app) {
    const m = app.model, bim = app.bim, G = window.G, S = app.structural;
    const BT = window.BimTools, RF = window.RoofFeature;
    if (!S || !BT || !RF) throw new Error('structural/wall/roof features missing');
    const lvl = i => 'lvl_' + i;

    // ---- LEVELS: real datums through the manager (not raw array writes) ----
    m.levels.length = 0;
    for (let i = 0; i < LEVELS; i++) {
      if (app.levelManager && app.levelManager.addLevel)
        app.levelManager.addLevel('L' + (i + 1), +(i * STORY).toFixed(3));
      else
        m.levels.push({ id: lvl(i + 1), name: 'L' + (i + 1), elevation: +(i * STORY).toFixed(3) });
    }
    // addLevel autonumbers ids/names — align them to our lvl() helper
    for (let i = 0; i < LEVELS; i++) {
      const L = m.levels[i];
      L.id = lvl(i + 1); L.name = 'L' + (i + 1); L.elevation = +(i * STORY).toFixed(3);
    }
    m.levels.sort((a, b) => a.elevation - b.elevation);

    // ---- GRIDS: A-D verticals, 1-3 horizontals, via GridManager ----
    const gxA = [], gyA = [];
    if (app.gridManager) {
      app.gridManager.grids.length = 0;
      'ABCD'.split('').forEach((nm, i) => {
        const g = app.gridManager.addGrid({ name: nm, start: [XS[i], -2.5], end: [XS[i], 14.5] });
        gxA.push(g);
      });
      '123'.split('').forEach((nm, i) => {
        const g = app.gridManager.addGrid({ name: nm, start: [-2.5, YS[i]], end: [20.5, YS[i]] });
        gyA.push(g);
      });
    }

    // one opDone for the whole scene (batch placements suspend per-create)
    const heldOp = bim._holdOpDone;
    bim._holdOpDone = true;
    const stages = [];
    const stage = (label, fn) => stages.push({ label, fn });
    m.beginEdgeSweep();
    const _finish = () => {
      try {
        for (const f of m.faces.values()) {
          m.edgesForRing(f.loop, true);
          for (const h of (f.holes || [])) m.edgesForRing(h, true);
        }
        m.reapOrphanEdges();
      } finally {
        m.endEdgeSweep();
        bim._holdOpDone = heldOp;
      }
      const counts = { grid: app.gridManager ? app.gridManager.grids.length : 0, level: m.levels.length };
      for (const e of bim.entities) counts[e.type] = (counts[e.type] || 0) + 1;
      return counts;
    };
    try {
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
      const faceAt = (f, z0, h) => { const c = m.faceCentroid(f);
        return Math.abs(c.z - z0) < 2e-3 ? 'bottom' : Math.abs(c.z - z0 - h) < 2e-3 ? 'top' : 'side'; };

      stage('pad footings', () => {
        for (const x of XS) for (const y of YS)
          reg('foundation', { base: [x, y, 0], width: 1.8, depth: 1.8, thickness: 0.6, baseLevel: lvl(1) },
            () => S.buildFooting(G, m, { base: [x, y, 0], width: 1.8, depth: 1.8, thickness: 0.6, baseLevel: lvl(1) }),
            f => faceAt(f, -0.6, 0.6));
      });

      stage('columns on grid intersections', () => {
        for (let s = 0; s < LEVELS - 1; s++) {
          // v0.7 continuous columns: the full story height — the column
          // fills the grid-intersection cube and the beams stop at its
          // faces (the framing trim owns the joint)
          const z0 = +(s * STORY).toFixed(4);
          const h = +STORY.toFixed(4);
          for (let i = 0; i < XS.length; i++) for (let j = 0; j < YS.length; j++) {
            const p = { base: [XS[i], YS[j], z0], width: COL, depth: COL, height: h,
              baseLevelId: lvl(s + 1), topLevelId: lvl(s + 2) };
            // grid-attached: the Element Browser shows A-1 style references,
            // and dragging a grid re-centers the column on the intersection
            if (gxA[i] && gyA[j]) p.gridRef = { a: gxA[i].id, b: gyA[j].id };
            reg('column', p, () => S.buildColumn(G, m, p), f => faceAt(f, z0, h));
          }
        }
      });

      // walls between column FACES (+5 mm) — pieces never cross a column
      // v0.6 ELEMENT INDEPENDENCE: walls run grid-to-grid THROUGH the
      // columns — no retreat, no split; they overlap at the columns
      const spans = (stations) => {
        const out = [];
        for (let i = 0; i < stations.length - 1; i++)
          out.push([stations[i], stations[i + 1]]);
        return out;
      };
      const xSpans = spans(XS), ySpans = spans(YS);
      const wallRecs = [];
      const wall = (x1, y1, x2, y2, z, h, thick) => {
        const A = [x1, y1, z], B = [x2, y2, z];
        const params = { base: A, end: B, height: h, thickness: thick, locationLine: 'centerline',
          primitive: 'line', closed: false, joins: { start: 0, end: 0 }, source: 'demo-r5' };
        const ent = reg('wall', params, () => {
          // v0.6 FACE-STOP via wallRing: ends retreat to column faces + EPS
          const ring = bim.wallRing(params);
          const f = m.addFaceFromRings(ring.map(q => G.clone(q)));
          if (!f) throw new Error('wall ring degenerate');
          if (!m.pushPull(f, h)) throw new Error('wall sweep failed');
          return f;
        }, f => faceAt(f, z, h));
        wallRecs.push({ ent, A, B, thick });
        return ent;
      };

      stage('walls — exterior', () => {
        for (let s = 0; s < LEVELS - 1; s++) {
          const z = +(s * STORY).toFixed(4);
          const h = +(STORY - BEAM_H + 1e-4).toFixed(3); // v0.6: EPS overlap into the beam soffit   // floor -> beam soffit
          const wz = z;                   // ground: above footing tops
          for (const [a, b] of xSpans) { wall(a, 0, b, 0, wz, h, 0.2); wall(a, 12, b, 12, wz, h, 0.2); }
          for (const [a, b] of ySpans) { wall(0, a, 0, b, wz, h, 0.2); wall(18, a, 18, b, wz, h, 0.2); }
        }
      });

      stage('walls — SIX rooms per floor', () => {
        // one partition line on grid 2 (y=6) + room dividers on grids B/C
        // (x=6, 12) on each side -> rooms A1 B1 C1 / A2 B2 C2 per floor.
        // Divider endpoints stop at the COLUMN faces (0.2 + reveal) — a
        // divider crossing into a column footprint fragments both and the
        // later door cut loses its host boundary.
        for (let s = 0; s < LEVELS - 1; s++) {
          const z = +(s * STORY).toFixed(4);
          const h = +(STORY - BEAM_H + 1e-4).toFixed(3); // v0.6: EPS overlap into the beam soffit
          const wz = z;
          for (const [a, b] of xSpans) wall(a, 6, b, 6, wz, h, 0.15);   // partition
          const cy0 = 0.2 - 1e-4, cy1 = 6 - 0.2 + 1e-4, cy2 = 6 + 0.2 - 1e-4, cy3 = 12 - 0.2 + 1e-4; // v0.6: EPS overlap into the column faces
          for (const x of [6, 12]) {
            wall(x, cy0, x, cy1, wz, h, 0.15);   // south divider
            wall(x, cy2, x, cy3, wz, h, 0.15);   // north divider
          }
        }
      });

      const opening = (type, rec, at, w, hgt, sill) => {
        const A = rec.A, B = rec.B;
        const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
        const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
        const dist = (at[0] - A[0]) * ux + (at[1] - A[1]) * uy;
        const spec = { distanceFromStart: dist, width: w, height: hgt, sillHeight: sill,
          depth: rec.thick };
        const before = new Set(m.faces.keys());
        m.bimHold = rec.ent.id; // v0.6: the host owns its own cut
        let info = null, frameFaces = [];
        try {
          info = BT.HostedCut.cut(G, m, rec.ent.params, spec);
          if (!info || info.error) throw new Error((info && info.error) || 'cut failed');
          if (type !== 'opening')
            frameFaces = BT.HostedCut.frame(G, m, info, spec, type, { facing: 1, hand: 1 }) || [];
        } finally { m.bimHold = false; }
        const nf = [...m.faces.keys()].filter(id => !before.has(id))
          .map(id => m.faces.get(id)).filter(f => f && !f.userData);
        const roles = {};
        for (const f of nf) {
          const fi = frameFaces.indexOf(f);
          roles[f.id] = fi >= 0 ? (type === 'door' && fi === frameFaces.length - 1 ? 'leaf' : 'frame') : 'lining';
        }
        const doorFaces = new Set(nf.map(f => f.id));
        const edges = [];
        for (const f of nf) for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
          const e = m.findEdge(r[i], r[(i + 1) % r.length]);
          if (e && !e.userData) edges.push(e.id);
        }
        // shared notch borders stay with the wall (exclusive-edge contract)
        const own = edges.filter(id => {
          const e = m.edges.get(id);
          return e && m.facesAdjacentToEdge(e).every(f => doorFaces.has(f.id));
        });
        return bim.create(type, { hostWallId: rec.ent.id, distanceFromStart: info.t,
          sillHeight: sill, width: w, height: hgt, depth: spec.depth, facing: 1, hand: 1 },
          roles, [...new Set(own)]);
      };
      const wallX = (x, y, z) => wallRecs.find(r =>
        Math.abs(r.A[0] - r.B[0]) < 1e-6 && Math.abs(r.A[0] - x) < 1e-6 &&
        r.A[2] === z && y > r.A[1] && y < r.B[1]);
      const wallY = (y, x, z) => wallRecs.find(r =>
        Math.abs(r.A[1] - r.B[1]) < 1e-6 && Math.abs(r.A[1] - y) < 1e-6 &&
        r.A[2] === z && x > r.A[0] && x < r.B[0]);

      stage('doors + windows', () => {
        for (let s = 0; s < LEVELS - 1; s++) {
          const z = +(s * STORY).toFixed(4);
          // entrance (ground, bay A-B) then a door in every room divider —
          // each pair of rooms connects through its divider (4/floor)
          if (s === 0) {
            const ent = wallY(0, 3, z);
            if (ent) opening('door', ent, [3, 0], 1.2, 2.2, 0);
          }
          for (const dx of [6, 12]) for (const dy of [3, 9]) {
            const dv = wallX(dx, dy, z);
            if (dv) opening('door', dv, [dx, dy], 0.9, 2.1, 0);
          }
          // windows: every bay of every facade (sill 0.9)
          for (const cx of [3, 9, 15]) {
            const ws = wallY(0, cx, z), wn = wallY(12, cx, z);
            if (ws) opening('window', ws, [cx, 0], 1.8, 1.5, 0.9);
            if (wn) opening('window', wn, [cx, 12], 1.8, 1.5, 0.9);
          }
          for (const cy of [3, 9]) {
            const ww = wallX(0, cy, z), we = wallX(18, cy, z);
            if (ww) opening('window', ww, [0, cy], 1.5, 1.5, 0.9);
            if (we) opening('window', we, [18, cy], 1.5, 1.5, 0.9);
          }
        }
      });

      stage('slabs — punched at every column', () => {
        for (let s = 1; s < LEVELS - 1; s++) {
          const z = +(s * STORY).toFixed(4);
          const outer = [[0, 0, z], [18, 0, z], [18, 12, z], [0, 12, z]];
          const punches = S.columnHolesForSlab(m,
            { baseLevel: lvl(s + 1), thickness: SLAB_T, _planeZ: z }, { outer, holes: [] });
          const holes = punches.map(p2 => {
            const r = p2.ring;
            const cx = r.reduce((a, q) => a + q.x, 0) / r.length;
            const cy = r.reduce((a, q) => a + q.y, 0) / r.length;
            return r.map(q => {
              const dx = q.x - cx, dy = q.y - cy, l = Math.hypot(dx, dy) || 1;
              return [+(q.x + dx / l * 0.003).toFixed(6), +(q.y + dy / l * 0.003).toFixed(6), z];
            });
          });
          reg('floor', { regions: [{ outer, holes }], thickness: SLAB_T, baseLevel: lvl(s + 1) },
            () => {
              const f = m.addFaceFromRings(outer.map(q => G.v(...q)),
                holes.map(hg => hg.map(q => G.v(...q))));
              if (!f) throw new Error('slab face degenerate');
              if (!m.pushPull(f, -SLAB_T)) throw new Error('slab sweep failed');
              return f;
            },
            f => { const c = m.faceCentroid(f);
              return Math.abs(c.z - z) < 2e-3 ? 'top' : Math.abs(c.z - z + SLAB_T) < 2e-3 ? 'bottom' : 'edge'; });
        }
      });

      stage('beams — the full grid', () => {
        for (let s = 1; s < LEVELS; s++) {
          const z = +(s * STORY - BEAM_H / 2).toFixed(4);
          const mk = (A, B) => {
            const p = { baseline: [[A[0], A[1], z], [B[0], B[1], z]],
              referenceLevelId: lvl(s + 1), baseLevel: lvl(s + 1), zJustification: 'Top',
              profile: 'rectangular', webWidth: BEAM_W, height: BEAM_H };
            reg('beam', p, () => S.buildBeam(G, m, p), () => 'body');
          };
          for (const y of YS) for (let i = 0; i < XS.length - 1; i++) mk([XS[i], y], [XS[i + 1], y]);
          for (const x of XS) for (let j = 0; j < YS.length - 1; j++) mk([x, YS[j]], [x, YS[j + 1]]);
        }
      });

      stage('roof', () => {
        const zr = (LEVELS - 1) * STORY;
        const rPts = [[-0.25, -0.25], [18.25, -0.25], [18.25, 12.25], [-0.25, 12.25]]
          .map(([x, y]) => G.v(x, y, zr));
        reg('roof', { kind: 'flat', thickness: 0.2, pitch: 10, overhang: 0.25,
            regions: [{ outer: rPts.map(p => [p.x, p.y, p.z]), holes: [] }], baseLevel: lvl(LEVELS) },
          () => RF.buildRegion(G, m,
            { kind: 'flat', thickness: 0.2, pitch: 10, overhang: 0.25, region: { outer: rPts, holes: [] }, z: zr }),
          () => 'body');
      });
    } catch (e) {
      m.endEdgeSweep();
      bim._holdOpDone = heldOp;
      throw e;
    }
    return { stages, finish: _finish };
  }

  function build(app) {
    const p = program(app);
    for (const st of p.stages) st.fn();
    return p.finish();
  }

  // staged build for the app: yields to the browser between stages
  function buildAsync(app, onProgress) {
    const p = program(app);
    return new Promise((resolve, reject) => {
      let i = 0;
      const run = () => {
        if (i >= p.stages.length) {
          try { resolve(p.finish()); } catch (e) { reject(e); }
          return;
        }
        const st = p.stages[i];
        try {
          if (onProgress) onProgress(st.label, i, p.stages.length);
          st.fn();
        } catch (e) { reject(e); return; }
        i++;
        setTimeout(run, 0);
      };
      run();
    });
  }

  window.DemoR5 = { build, buildAsync };
})();
