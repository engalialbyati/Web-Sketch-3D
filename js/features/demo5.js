'use strict';
// ---------------------------------------------------------------------------
// Feature: Demo5 — a REAL 5-story building, loadable in the app.
// File > Load 5-Story Building: a classic 3-bay RC apartment block —
// grid A-D x 1-3 (18 x 12 m, 6 m bays), 5 stories x 3.2 m:
//   - 12 columns per story (0.4 x 0.4), isolated footings below grade
//   - the full beam grid at every level (0.3 x 0.6)
//   - exterior infill walls in every bay, corridor + stair-shaft walls
//   - windows in every bay of every facade, entrance + shaft doors
//   - 150 mm slabs at levels 2-5 (punched at every column, 3 mm reveal)
//   - a dog-leg stair with glass handrail rising L1 -> L5 in its shaft
//   - flat roof with overhang
// Walls are pre-trimmed analytically to the column faces (grid-to-face +
// 5 mm), so no wall ever crosses a column — the wall-face rule by hand.
// ---------------------------------------------------------------------------
(function () {

  const STORY = 3.2, LEVELS = 6;         // lvl_1..lvl_6 -> 5 stories
  const XS = [0, 6, 12, 18];             // grids A..D
  const YS = [0, 6, 12];                 // grids 1..3
  const COL = 0.4, BEAM_W = 0.3, BEAM_H = 0.6, SLAB_T = 0.15;
  const GAP = 0.005;                     // wall reveal off each column face
  const RISER_T = 0.161, TREAD = 0.28;   // 20 risers x 160 mm per story

  function program(app) {
    const m = app.model, bim = app.bim, G = window.G, S = app.structural;
    const BT = window.BimTools, SF = window.StairsFeature, RF = window.RoofFeature;
    if (!S || !BT || !SF || !RF) throw new Error('structural/wall/stairs/roof features missing');
    const lvl = i => 'lvl_' + i;

    m.levels = Array.from({ length: LEVELS }, (_, i) =>
      ({ id: lvl(i + 1), name: 'L' + (i + 1), elevation: +(i * STORY).toFixed(3) }));

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
      const counts = {};
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

      stage('footings + columns', () => {
        // ---------------------------------------------------------- footings
        for (const x of XS) for (const y of YS)
          reg('foundation', { base: [x, y, 0], width: 1.8, depth: 1.8, thickness: 0.6, baseLevel: lvl(1) },
            () => S.buildFooting(G, m, { base: [x, y, 0], width: 1.8, depth: 1.8, thickness: 0.6, baseLevel: lvl(1) }),
            f => faceAt(f, -0.6, 0.6));

        // ---------------------------------------------------------- columns
        for (let s = 0; s < LEVELS - 1; s++) {
          const z0 = +(s * STORY + (s === 0 ? 0.005 : 0)).toFixed(4);   // reveal above footings
          const h = +(STORY - (s === 0 ? 0.005 : 0)).toFixed(4);
          for (const x of XS) for (const y of YS) {
            const p = { base: [x, y, z0], width: COL, depth: COL, height: h,
              baseLevelId: lvl(s + 1), topLevelId: lvl(s + 2) };
            reg('column', p, () => S.buildColumn(G, m, p), f => faceAt(f, z0, h));
          }
        }
      });

      const walls = { south: [], north: [], west: [], east: [], shaftX: [] };
      stage('walls', () => {
        // ---------------------------------------------------------- walls
        // spans between column FACES (+5 mm) — pieces never cross a column
        const spans = (stations, half) => {
          const out = [];
          for (let i = 0; i < stations.length - 1; i++)
            out.push([stations[i] + half + GAP, stations[i + 1] - half - GAP]);
          return out;
        };
        const xSpans = spans(XS, COL / 2), ySpans = spans(YS, COL / 2);
        const wall = (x1, y1, x2, y2, z, h, thick) => {
          const A = [x1, y1, z], B = [x2, y2, z];
          const params = { base: A, end: B, height: h, thickness: thick, locationLine: 'centerline',
            primitive: 'line', closed: false, joins: { start: 0, end: 0 }, source: 'demo' };
          return reg('wall', params, () => {
            const ring = BT.WallTool.bandRing(G, [G.v(...A), G.v(...B)], thick, 'centerline');
            const f = m.addFaceFromRings(ring.map(q => G.clone(q)));
            if (!f) throw new Error('wall ring degenerate');
            if (!m.pushPull(f, h)) throw new Error('wall sweep failed');
            return f;
          }, f => faceAt(f, z, h));
        };
        // exterior: south/north (along x), west/east (along y); interior:
        // corridor wall on grid 2 (x 0..12) + the stair shaft (bay D/2-3)
        for (let s = 0; s < LEVELS - 1; s++) {
          const z = +(s * STORY).toFixed(4);
          // wall runs floor -> the SOFFIT of the beam above (the beam hangs
          // below its level, slab above it): story - beam depth - 5 mm reveal
          const h = +(STORY - BEAM_H - 0.005).toFixed(3);
          const wz = s === 0 ? 0.005 : z;   // ground walls: 5 mm above the footing tops
          for (const [a, b] of xSpans) {
            walls.south.push(wall(a, 0, b, 0, wz, h, 0.2));
            walls.north.push(wall(a, 12, b, 12, wz, h, 0.2));
          }
          for (const [a, b] of ySpans) {
            walls.west.push(wall(0, a, 0, b, wz, h, 0.2));
            walls.east.push(wall(18, a, 18, b, wz, h, 0.2));
          }
          // corridor wall on grid 2 (x 0..12)
          wall(xSpans[0][0], 6, xSpans[0][1], 6, wz, h, 0.15);
          wall(xSpans[1][0], 6, xSpans[1][1], 6, wz, h, 0.15);
          // the stair shaft: wall along grid C (x=12) carrying the door
          walls.shaftX.push(wall(12, ySpans[1][0], 12, ySpans[1][1], wz, h, 0.2));
          // shaft wall closing the bay on grid 2 (x 12..18)
          wall(xSpans[2][0], 6, xSpans[2][1], 6, wz, h, 0.2);
        }
      });

      stage('doors + windows', () => {
        // ------------------------------------------------- doors and windows
        // HostedCut on the built wall piece; distance measured from ITS base
        const opening = (type, wallEnt, at, w, hgt, sill) => {
          const A = wallEnt.params.base, B = wallEnt.params.end;
          const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
          const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
          const dist = (at[0] - A[0]) * ux + (at[1] - A[1]) * uy;
          const spec = { distanceFromStart: dist, width: w, height: hgt, sillHeight: sill,
            depth: wallEnt.params.thickness };
          const before = new Set(m.faces.keys());
          m.bimHold = true;
          let info = null, frameFaces = [];
          try {
            info = BT.HostedCut.cut(G, m, wallEnt.params, spec);
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
          const edges = [];
          for (const f of nf) for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
            const e = m.findEdge(r[i], r[(i + 1) % r.length]);
            if (e && !e.userData) edges.push(e.id);
          }
          return bim.create(type, { hostWallId: wallEnt.id, distanceFromStart: info.t,
            sillHeight: sill, width: w, height: hgt, depth: spec.depth, facing: 1, hand: 1 },
            roles, [...new Set(edges)]);
        };
        // entrance (ground, south facade, bay A-B) + a shaft door every floor
        opening('door', walls.south[0], [3, 0], 1.2, 2.2, 0);
        for (let s = 0; s < LEVELS - 1; s++)
          opening('door', walls.shaftX[s], [12, 7.5], 1.0, 2.1, 0);
        // windows: every bay of every facade, every floor (sill 0.9)
        for (let s = 0; s < LEVELS - 1; s++) {
          const f3 = s * 3;   // 3 x-pieces per south/north line per floor
          const f2 = s * 2;   // 2 y-pieces per west/east line per floor
          const bay = cx => Math.floor(cx / 6);   // bay index 0..2
          for (const cx of [3, 9, 15]) {
            opening('window', walls.south[f3 + bay(cx)], [cx, 0], 1.8, 1.5, 0.9);
            opening('window', walls.north[f3 + bay(cx)], [cx, 12], 1.8, 1.5, 0.9);
          }
          for (const cy of [3, 9]) {
            opening('window', walls.west[f2 + Math.floor(cy / 6)], [0, cy], 1.5, 1.5, 0.9);
            opening('window', walls.east[f2 + Math.floor(cy / 6)], [18, cy], 1.5, 1.5, 0.9);
          }
        }
      });

      // ---------------------------------------------------------- stairs
      // dog-leg U with the glass handrail, stacked L1->L5 in the shaft bay.
      // Runs INTERLEAVED with the slabs (see below): each stair is built
      // right after its host slab, while the model is still small — the
      // rail sweeps against 6k faces cost 33 s each at the end.
      const stairFor = (s, host) => {
        const zBase = +(s * STORY).toFixed(4), zTop = +((s + 1) * STORY).toFixed(4);
        const params = { run: 'u', width: 1.2, riser: RISER_T, tread: TREAD, uGap: 0.1,
          // rails OFF in the demo (30+ s each at this model size) — tick
          // Handrail in Entity Info to add the glass rail to any stair
          landingDepth: 1.2, handrail: false, railHeight: 0.9, storyH: zTop - zBase,
          base: [13.5, 7.6, zBase], dir: [1, 0], baseLevel: lvl(s + 1), topLevel: lvl(s + 2) };
        m.beginEdgeSweep();
        m.bimHold = true;
        try {
          const plan = SF.planStair(params);
          const ring = plan.footprint.map(p => G.v(p.x, p.y, zTop));
          SF.addHostHole(app, host, ring);
          SF.rebuildFloorWithHoles(app, host.id);
          const built = SF.buildStair(G, m, params);
          if (built.error || !built.faces.length) throw new Error(built.error || 'stair build failed');
          const full = { ...params, hostFloorId: host.id,
            nRisers: built.info.nRisers, riserActual: built.info.riser,
            opening: { hostId: host.id, ring: ring.map(p => [p.x, p.y, p.z]) }, source: 'tool' };
          bim.create('stairs', full, built.roles, built.edges);
        } finally {
          m.bimHold = false;
          m.endEdgeSweep();
        }
      };

      // ---------------------------------------------------------- slabs
      const floors = [];
      for (let s = 1; s < LEVELS - 1; s++) stage('slab + stair — L' + (s + 1), () => {
        const z = +(s * STORY).toFixed(4);
        const outer = [[0, 0, z], [18, 0, z], [18, 12, z], [0, 12, z]];
        const punches = S.columnHolesForSlab(m,
          { baseLevel: lvl(s + 1), thickness: SLAB_T, _planeZ: z }, { outer, holes: [] });
        // 3 mm oversize punches (the construction-joint reveal that keeps
        // the slab's holed TOP face alive — the missing-top-face bug)
        const holes = punches.map(p2 => {
          const r = p2.ring;
          const cx = r.reduce((a, q) => a + q.x, 0) / r.length;
          const cy = r.reduce((a, q) => a + q.y, 0) / r.length;
          return r.map(q => {
            const dx = q.x - cx, dy = q.y - cy, l = Math.hypot(dx, dy) || 1;
            return [+(q.x + dx / l * 0.003).toFixed(6), +(q.y + dy / l * 0.003).toFixed(6), z];
          });
        });
        floors.push(reg('floor', { regions: [{ outer, holes }], thickness: SLAB_T, baseLevel: lvl(s + 1) },
          () => {
            const f = m.addFaceFromRings(outer.map(q => G.v(...q)),
              holes.map(hg => hg.map(q => G.v(...q))));
            if (!f) throw new Error('slab face degenerate');
            if (!m.pushPull(f, -SLAB_T)) throw new Error('slab sweep failed');
            return f;
          },
          f => { const c = m.faceCentroid(f);
            return Math.abs(c.z - z) < 2e-3 ? 'top' : Math.abs(c.z - z + SLAB_T) < 2e-3 ? 'bottom' : 'edge'; }));
        stairFor(s - 1, floors[floors.length - 1]);
      });

      // ---------------------------------------------------------- beams
      for (let s = 1; s < LEVELS; s++) stage('beams — L' + (s + 1), () => {
        const z = +(s * STORY - BEAM_H / 2).toFixed(4);
        const mk = (A, B) => {
          const p = { baseline: [[A[0], A[1], z], [B[0], B[1], z]],
            profile: 'rectangular', webWidth: BEAM_W, height: BEAM_H };
          reg('beam', p, () => S.buildBeam(G, m, p), () => 'body');
        };
        for (const y of YS) for (let i = 0; i < XS.length - 1; i++) mk([XS[i], y], [XS[i + 1], y]);
        for (const x of XS) for (let j = 0; j < YS.length - 1; j++) mk([x, YS[j]], [x, YS[j + 1]]);
      });

      stage('roof', () => {
        // ---------------------------------------------------------- roof
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

  // synchronous build (tests / sandbox)
  function build(app) {
    const p = program(app);
    for (const st of p.stages) st.fn();
    return p.finish();
  }

  // staged build for the app: yields to the browser between stages so the
  // UI paints progress instead of freezing for the whole build
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

  window.Demo5 = { build, buildAsync };
})();