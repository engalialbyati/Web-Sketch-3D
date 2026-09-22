'use strict';
// ---------------------------------------------------------------------------
// Feature: DemoMNL66 — the MNL-66(20) REINFORCEMENT SHOWCASE, loadable in
// the app. File > Load MNL-66 Reinforcement Demo: a one-story RC frame
// where every reinforcement phase of the detailing manual is live:
//
//   FND-161 pile caps (4 piles, dowels + shaft ties through the cap)
//   FND-109 mat under the middle grid line (mesh at both faces)
//   FND-150 drilled pier (circular cap: shaft ring cage, chord mesh)
//   COL-200 column splices (Class B laps, staggered, splice-zone ties)
//   BM-202 beam connections (bars develop to the FAR SIDE of the column
//          ties) + ACI 9.8 integrity steel + 8in connection-zone ties
//   SLAB-206 slab opening trim bars + SLAB-200 corner reinforcement
//   WALL-206/208 wall opening trim pairs + 48in corner diagonals
//   SOG-102/105 slab-on-ground apron: continuous edge bars, unbroken mesh
//
// Geometry follows the v0.7 framing rules: columns run grid-to-grid, the
// beams' solids are framing-trimmed at the column faces, and the rebar
// completes the joints exactly the way MNL-66 draws them.
// ---------------------------------------------------------------------------
(function () {

  const XS = [0, 6, 12];              // grids A..C
  const YS = [0, 6];                  // grids 1..2
  const COL = 0.3, BEAM_W = 0.25, BEAM_H = 0.5, SLAB_T = 0.15;
  const PIER = { x: 15.5, y: 3, R: 0.6 };   // freestanding drilled pier

  function build(app) {
    const m = app.model, bim = app.bim, G = window.G, S = app.structural;
    const BT = window.BimTools, ER = window.ElementRebar;
    if (!S || !BT || !ER) throw new Error('structural/bimtools/rebar features missing');

    m.levels = [
      { id: 'l0', name: 'Foundation', elevation: 0 },
      { id: 'l1', name: 'Floor 1', elevation: 3 },
    ];

    const heldOp = bim._holdOpDone;
    bim._holdOpDone = true;
    m.beginEdgeSweep();
    try {
      const reg = (type, params, buildGeom) => {
        const before = new Set(m.faces.keys());
        m.bimHold = true;
        try { buildGeom(); } finally { m.bimHold = false; }
        const nf = [...m.faces.keys()].filter(id => !before.has(id))
          .map(id => m.faces.get(id)).filter(f => f && !f.userData);
        const roles = {};
        for (const f of nf) roles[f.id] = 'body';
        const edges = [];
        for (const f of nf) for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
          const e = m.findEdge(r[i], r[(i + 1) % r.length]);
          if (e && !e.userData) edges.push(e.id);
        }
        return bim.create(type, JSON.parse(JSON.stringify(params)), roles, [...new Set(edges)]);
      };

      // ------------------------------------------------------- foundations
      // 4 corner columns on 1.6 m pile caps (2x2 piles each);
      // both middle columns share one mat along grid B
      for (const x of XS) for (const y of YS) {
        if (x === 6) continue;                       // the mat owns grid B
        const p = { base: [x, y, 0], width: 1.6, depth: 1.6, thickness: 0.6, baseLevel: 'l0', kind: 'pilecap' };
        reg('foundation', p, () => S.buildFooting(G, m, p));
      }
      {
        const p = { base: [6, 3, 0], width: 1.8, depth: 7.4, thickness: 0.6, baseLevel: 'l0', kind: 'mat' };
        reg('foundation', p, () => S.buildFooting(G, m, p));
      }
      // freestanding drilled pier: a 16-gon cap — the rebar tool reads the
      // circular loop and swaps in the FND-150 shaft cage by itself
      reg('foundation', { base: [PIER.x, PIER.y, 0], radius: PIER.R, thickness: 0.7, baseLevel: 'l0' },
        () => {
          const ring = [];
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            ring.push(G.v(PIER.x + PIER.R * Math.cos(a), PIER.y + PIER.R * Math.sin(a), 0));
          }
          const f = m.addFaceFromRings(ring);
          if (!f) throw new Error('pier ring degenerate');
          m.pushPull(f, -0.7);
        });

      // ---------------------------------------------------------- columns
      for (const x of XS) for (const y of YS) {
        const p = { base: [x, y, 0], width: COL, depth: COL, height: 3,
          baseLevelId: 'l0', topLevelId: 'l1' };
        reg('column', p, () => S.buildColumn(G, m, p));
      }
      reg('column', { base: [PIER.x, PIER.y, 0], width: COL, depth: COL, height: 3,
        baseLevelId: 'l0', topLevelId: 'l1' },
        () => S.buildColumn(G, m, { base: [PIER.x, PIER.y, 0], width: COL, depth: COL, height: 3 }));

      // ------------------------------------------------------------ beams
      // centerline baselines AT the column centers: buildBeam's framing
      // trim cuts every solid back to the column faces (v0.7 rule)
      const baselines = [];
      for (const y of YS) for (let i = 0; i < XS.length - 1; i++)
        baselines.push([[XS[i], y, 3], [XS[i + 1], y, 3]]);
      for (const x of XS) for (let j = 0; j < YS.length - 1; j++)
        baselines.push([[x, YS[j], 3], [x, YS[j + 1], 3]]);
      for (const bl of baselines) {
        const p = { baseline: bl, profile: 'rectangular', webWidth: BEAM_W, height: BEAM_H,
          referenceLevelId: 'l1', zJustification: 'Top' };
        reg('beam', p, () => S.buildBeam(G, m, p));
      }

      // --------------------------------------------- slab + stair opening
      // slab sits ON the beam tops (3.0 .. 3.15); the 1.4 m stair hole
      // punches the geometry — SLAB-206 reads it and trims the bars
      {
        // demo5's construction-joint recipe: punch at every column with a
        // 3 mm oversize reveal so the holed TOP face stays alive (the
        // missing-top-face bug) and the columns run through the slab
        const outer = [[-0.15, -0.15, 3.15], [12.15, -0.15, 3.15], [12.15, 6.15, 3.15], [-0.15, 6.15, 3.15]];
        const punches = S.columnHolesForSlab(m,
          { baseLevel: 'l1', thickness: SLAB_T, _planeZ: 3.15 }, { outer: outer.map(q => q.slice()), holes: [] });
        const stair = [[8.2, 2.3, 3.15], [9.6, 2.3, 3.15], [9.6, 3.7, 3.15], [8.2, 3.7, 3.15]];
        const holes = [stair, ...punches.map(p2 => {
          const r = p2.ring;
          const cx = r.reduce((a, q) => a + q.x, 0) / r.length;
          const cy = r.reduce((a, q) => a + q.y, 0) / r.length;
          return r.map(q => {
            const dx = q.x - cx, dy = q.y - cy, l = Math.hypot(dx, dy) || 1;
            return [+(q.x + dx / l * 0.003).toFixed(6), +(q.y + dy / l * 0.003).toFixed(6), 3.15];
          });
        })];
        reg('floor', { thickness: SLAB_T, baseLevel: 'l1', regions: [{ outer, holes }] },
          () => {
            const f = m.addFaceFromRings(outer.map(q => G.v(...q)),
              holes.map(hg => hg.map(q => G.v(...q))));
            if (!f) throw new Error('slab ring degenerate');
            if (!m.pushPull(f, -SLAB_T)) throw new Error('slab sweep failed');
          });
      }

      // --------------------------------------- wall with door + window cut
      // along grid 1 on the slab top; HostedCut punches both holes so the
      // WALL-206/208 trim steel has real openings to work around
      reg('wall', { base: [0, 0, 3.1501], end: [6, 0, 3.1501], height: 2.7, thickness: 0.2,
          baseLevel: 'l1', locationLine: 'centerline', primitive: 'line', closed: false,
          joins: { start: 0, end: 0 } },
        () => {
          const wp = { base: [0, 0, 3.1501], end: [6, 0, 3.1501], height: 2.7, thickness: 0.2 };
          const ring = bim.wallRing(wp);
          const f = m.addFaceFromRings(ring.map(q => G.clone(q)));
          if (!f) throw new Error('wall ring degenerate');
          if (!m.pushPull(f, 2.7)) throw new Error('wall sweep failed');
          const wallEnt = bim.entities[bim.entities.length - 1];
          const cut = (t, w, h, sill) => {
            m.bimHold = wallEnt.id;
            try {
              const info = BT.HostedCut.cut(G, m, wp,
                { distanceFromStart: t, width: w, height: h, sillHeight: sill, depth: 0.2 });
              if (!info || info.error) throw new Error('opening cut failed');
              wallEnt.params._openings = (wallEnt.params._openings || []).concat(
                [{ hostWallId: wallEnt.id, distanceFromStart: info.t, width: w, height: h, sillHeight: sill }]);
            } finally { m.bimHold = false; }
          };
          cut(1.6, 1.2, 2.2, 0);     // entrance door
          cut(4.4, 1.5, 1.2, 0.9);   // window
          // register the openings as hosted entities the rebar reads
          for (const o of wallEnt.params._openings) {
            const before = new Set(m.faces.keys());
            bim.create('door', { ...o, depth: 0.2, facing: 1, hand: 1 }, {}, []);
            void before;
          }
          delete wallEnt.params._openings;
        });

      // -------------------------------------------- slab-on-ground apron
      // freestanding SOG pad west of the pier: SOG-102/105 edge steel
      reg('floor', { thickness: 0.12, baseLevel: 'l0', regions: [{ outer: [
            [13, -3.2, 0.12], [17, -3.2, 0.12], [17, -0.8, 0.12], [13, -0.8, 0.12]], holes: [] }] },
        () => {
          const f = m.addFaceFromRings([
            G.v(13, -3.2, 0.12), G.v(17, -3.2, 0.12),
            G.v(17, -0.8, 0.12), G.v(13, -0.8, 0.12)]);
          if (!f) throw new Error('apron ring degenerate');
          m.pushPull(f, -0.12);
        });

      // ------------------------------------------------------------ rebar
      // one pass per element; entities are all registered so the beam
      // generator sees its columns (BM-202 far-side development)
      const fpad = { type: 'foundation', foundation: {
        bottom: 0.04, side: 0.05, topLayer: 'X',
        xDia: 0.012, xMode: 'spacing', xValue: 0.15,
        yDia: 0.012, yMode: 'spacing', yValue: 0.15,
        stubX: 2, stubY: 2, stubDia: 0.014, lap: 0.5, leg: 0.15, colW: COL, colL: COL } };
      const fmat = { type: 'foundation', foundation: { ...fpad.foundation, kind: 'mat' } };
      const fpile = { type: 'foundation', foundation: { ...fpad.foundation,
        kind: 'pilecap', piles: 4, pileS: 0.4, pileDia: 0.3, pileLap: 0.5 } };
      const ccol = { type: 'column', column: {
        tie: { l: 0.04, r: 0.04, t: 0.04, b: 0.04, front: 0.05, dia: 0.008,
          bentAngle: 135, bentFactor: 6, mode: 'spacing', value: 0.18 },
        main: { dia: 0.016, tOffset: 0.05, bOffset: 0.05, type: 'straight',
          splice: { mode: 'lap' } } } };
      const bbeam = { type: 'beam', beam: {
        side: 0.03, end: 0.05, tieDia: 0.008, bentAngle: 135, bentFactor: 6,
        mode: 'spacing', value: 0.2,
        topCount: 2, topDia: 0.014, botCount: 3, botDia: 0.016,
        top: 0.03, bot: 0.03, skin: 0, skinDia: 0.012, integrity: true } };
      const sslab = { type: 'slab', slab: {
        bottom: 0.025, top: 0.025, side: 0.025,
        xDia: 0.012, xSpacing: 0.2, yDia: 0.012, ySpacing: 0.2,
        topMesh: false, topDia: 0 } };
      const wwall = { type: 'wall', wall: {
        cover: 0.04, vDia: 0.012, vSpacing: 0.2, hDia: 0.012, hSpacing: 0.2,
        twoCurtains: true, vOff: 0.05 } };
      const ssog = { type: 'slab', slab: { ...sslab.slab, sog: true, sogDia: 0.012 } };

      const rebarOne = (ent, params) => {
        const fid = (ent.faces || []).find(id => m.faces.get(id));
        if (!fid) throw new Error('no face on ' + ent.id);
        const res = ER.buildElementRebar(m, fid, params, bim.entities);
        if (res && res.error) throw new Error(ent.type + ' ' + ent.id + ' rebar (' + (ent.faces || []).length + ' faces): ' + res.error);
        return res;
      };
      let rebarFaces = 0;
      const track = res => { if (res && res.ids) rebarFaces += res.ids.length; };
      for (const ent of bim.entities) {
        if (ent.type === 'foundation') {
          const circular = ent.params.radius != null;
          const kind = circular ? undefined : (ent.params.kind || 'pad');
          track(rebarOne(ent, kind === 'mat' ? fmat : kind === 'pilecap' ? fpile : fpad));
        } else if (ent.type === 'column') track(rebarOne(ent, ccol));
        else if (ent.type === 'beam') track(rebarOne(ent, bbeam));
        else if (ent.type === 'wall') track(rebarOne(ent, wwall));
        else if (ent.type === 'floor') {
          const apron = ent.params.baseLevel === 'l0';
          track(rebarOne(ent, apron ? ssog : sslab));
        }
      }

      // finish: register every edge once, release the batch. REBAR faces
      // are skipped - addRebarPath already stamps their edges, and a bulk
      // sweep over 100k pipe quads floods the edge pass into a grey wall
      // that buries the cages under the x-ray view
      for (const f of m.faces.values()) {
        if (f.userData && f.userData.rebar) continue;
        m.edgesForRing(f.loop, true);
        for (const h of (f.holes || [])) m.edgesForRing(h, true);
      }
      m.reapOrphanEdges();

      const counts = {};
      for (const e of bim.entities) counts[e.type] = (counts[e.type] || 0) + 1;
      counts.rebarFaces = rebarFaces;
      return counts;
    } finally {
      m.endEdgeSweep();
      bim._holdOpDone = heldOp;
    }
  }

  window.DemoMNL66 = { build };
})();
