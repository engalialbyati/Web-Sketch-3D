'use strict';
// ---------------------------------------------------------------------------
// Feature: DemoMNL66 — the MNL-66(20) reinforcement showcase: a FIVE-STORY
// RC building where every floor's reinforcement connects to the next.
// File > Load MNL-66 Reinforcement Demo.
//
//   Foundations: RAFT under the tower (FND-109, mesh both faces), a
//     COMBINED footing under the two annex columns (FND-103), a STRIP
//     footing under the annex wall (FND-102 wall dowels), the drilled
//     PIER (FND-150) and the SOG apron (SOG-102/105)
//   Superstructure x5 stories: columns with COL-200 splices above every
//     slab, T-beams (interior), L-beams (edge), rect beams, slabs punched
//     at columns + stair + elevator hoistway + a circular penetration
//     (SLAB-206 trims, corner steel), the ELEVATOR shaft (ETABS-style
//     shear walls + door + lintel per floor), facade walls with door +
//     window + circular pipe opening (WALL-201), wall starter dowels into
//     every slab (WALL-100A), shear-wall boundary elements (WALL-110)
//
// Rebar displays in LIGHT mode (centerline ribbons) - the cage is
// ~300k faces; View > Rebar toggles pipe solids.
// ---------------------------------------------------------------------------
(function () {

  const STORIES = 5, H = 3;
  const XS = [0, 6, 12], YS = [0, 6];   // 6 columns per story
  const COL = 0.3;
  const ELEV = { x: 2.6, y: 3.2, w: 2.2, d: 2.0, wall: 0.2 };
  const STAIR = { x: 9.2, y: 3.0, w: 1.4, d: 1.4 };
  const ANNEX = { cx: 15.4, c1: [14.4, 0], c2: [16.4, 0], wall: { a: [14.2, 3], b: [14.2, 5.6] } };

  async function buildAsync(app, onProgress) {
    const m = app.model, bim = app.bim, G = window.G, S = app.structural;
    const BT = window.BimTools, ER = window.ElementRebar, EF = window.ElevatorFeature;
    if (!S || !BT || !ER || !EF) throw new Error('structural/bimtools/rebar/elevator features missing');

    m.levels = [{ id: 'l0', name: 'Foundation', elevation: 0 }];
    for (let s = 1; s <= STORIES + 1; s++)
      m.levels.push({ id: 'l' + s, name: 'Floor ' + s, elevation: s * H });

    const heldOp = bim._holdOpDone;
    bim._holdOpDone = true;
    m.beginEdgeSweep();
    const stages = [];
    const stage = (label, fn) => stages.push({ label, fn });
    let rebarFaces = 0;

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

      // ================================================== FOUNDATIONS
      stage('raft + combined + strip footings', () => {
        // RAFT under the tower: 12.6 x 6.6 x 0.6, mesh at both faces
        reg('foundation', { base: [6, 3, 0], width: 12.6, depth: 6.6, thickness: 0.6,
          baseLevel: 'l0', kind: 'mat' },
          () => S.buildFooting(G, m, { base: [6, 3, 0], width: 12.6, depth: 6.6, thickness: 0.6 }));
        // COMBINED footing: one strap pad under both annex columns
        reg('foundation', { base: [ANNEX.cx, 0, 0], width: 2.8, depth: 1.6, thickness: 0.6,
          baseLevel: 'l0', kind: 'combined' },
          () => S.buildFooting(G, m, { base: [ANNEX.cx, 0, 0], width: 2.8, depth: 1.6, thickness: 0.6 }));
        // STRIP footing under the annex wall (wall dowels line it)
        reg('foundation', { base: [ANNEX.wall.a[0], (ANNEX.wall.a[1] + ANNEX.wall.b[1]) / 2, 0],
          width: 1.0, depth: 3.2, thickness: 0.5, baseLevel: 'l0', kind: 'strip' },
          () => S.buildFooting(G, m, {
            base: [ANNEX.wall.a[0], (ANNEX.wall.a[1] + ANNEX.wall.b[1]) / 2, 0],
            width: 1.0, depth: 3.2, thickness: 0.5 }));
        // the drilled pier (its column splices onto the shaft steel)
        reg('foundation', { base: [15.5, 3, 0], radius: 0.6, thickness: 0.7, baseLevel: 'l0',
          _noStarters: true },
          () => {
            const ring = [];
            for (let k = 0; k < 16; k++) {
              const a = (k / 16) * Math.PI * 2;
              ring.push(G.v(15.5 + 0.6 * Math.cos(a), 3 + 0.6 * Math.sin(a), 0));
            }
            const f = m.addFaceFromRings(ring);
            if (!f) throw new Error('pier ring degenerate');
            m.pushPull(f, -0.7);
          });
        // the annex SHEAR WALL on the strip footing (full height - its
 // dowels line the strip footing and its ends carry boundary steel)
        reg('wall', { base: [ANNEX.wall.a[0], ANNEX.wall.a[1], 0.0002],
          end: [ANNEX.wall.b[0], ANNEX.wall.b[1], 0.0002], height: H * STORIES - 0.0004,
          thickness: 0.2, baseLevel: 'l0', locationLine: 'centerline',
          primitive: 'line', closed: false, joins: { start: 0, end: 0 } },
          () => {
            const ring = bim.wallRing({ base: [ANNEX.wall.a[0], ANNEX.wall.a[1], 0.0002],
              end: [ANNEX.wall.b[0], ANNEX.wall.b[1], 0.0002], height: H * STORIES, thickness: 0.2 });
            const f = m.addFaceFromRings(ring.map(q => G.clone(q)));
            if (!f) throw new Error('annex wall ring degenerate');
            m.pushPull(f, H * STORIES);
          });

        // SOG apron
        reg('floor', { thickness: 0.12, baseLevel: 'l0', regions: [{ outer: [
          [13, -3.2, 0.12], [17, -3.2, 0.12], [17, -0.8, 0.12], [13, -0.8, 0.12]], holes: [] }] },
          () => {
            const f = m.addFaceFromRings([
              G.v(13, -3.2, 0.12), G.v(17, -3.2, 0.12),
              G.v(17, -0.8, 0.12), G.v(13, -0.8, 0.12)]);
            if (!f) throw new Error('apron ring degenerate');
            m.pushPull(f, -0.12);
          });
      });

      // ================================================== STORIES
      for (let s = 0; s < STORIES; s++) {
        const z = s * H, lvl = 'l' + (s + 1), lvlUp = 'l' + (s + 2);
        const slabZ = z + H + 0.15; // slab sits on the beam tops

        stage('columns + beams — F' + (s + 1), () => {
          for (const x of XS) for (const y of YS) {
            const p = { base: [x, y, z], width: COL, depth: COL, height: H,
              baseLevelId: lvl, topLevelId: lvlUp };
            reg('column', p, () => S.buildColumn(G, m, p));
          }
          // annex: 2 columns run full height on the combined footing
          for (const [ax, ay] of [ANNEX.c1, ANNEX.c2]) {
            const p = { base: [ax, ay, z], width: COL, depth: COL, height: H * STORIES,
              baseLevelId: 'l0', topLevelId: 'l' + STORIES };
            reg('column', p, () => S.buildColumn(G, m, p));
          }
          // pier column, one story at a time (splices on the shaft steel)
          reg('column', { base: [15.5, 3, z], width: COL, depth: COL, height: H,
            baseLevelId: lvl, topLevelId: lvlUp },
            () => S.buildColumn(G, m, { base: [15.5, 3, z], width: COL, depth: COL, height: H }));

          // beams: T interior (flange both sides), L edges (flange inside)
          const bdir = (a, b2, profile) => {
            const p = { baseline: [a, b2], profile, webWidth: 0.25, height: 0.5,
              referenceLevelId: lvlUp, zJustification: 'Top' };
            reg('beam', p, () => S.buildBeam(G, m, p));
          };
          for (const x of XS) bdir([x, 0, z + H], [x, 6, z + H], x === 6 ? 't' : 'l');
          for (const y of YS) {
            bdir([0, y, z + H], [6, y, z + H], 'rectangular');
            bdir([6, y, z + H], [12, y, z + H], 'rectangular');
          }
        });

        stage('elevator shaft — F' + (s + 1), () => {
          EF.buildOne(app, { x: ELEV.x, y: ELEV.y, w: ELEV.w, d: ELEV.d, wall: ELEV.wall,
            z0: z + 0.0002, h: H - 0.0002, doorW: 1.1, doorH: 2.1, doorSide: '-y',
            lintelH: 0.4, baseLevel: lvl });
        });

        if (s < STORIES - 1) stage('facade wall — F' + (s + 1), () => {
          // one facade bay per floor: door + window + circular pipe opening
          const wallEnt = reg('wall', { base: [6, 6.0002, z + H + 0.1502], end: [12, 6.0002, z + H + 0.1502],
            height: H - 0.15, thickness: 0.2, baseLevel: lvlUp,
            locationLine: 'centerline', primitive: 'line', closed: false, joins: { start: 0, end: 0 } },
            () => {
              const wp = { base: [6, 6.0002, z + H + 0.1502], end: [12, 6.0002, z + H + 0.1502], height: H - 0.15, thickness: 0.2 };
              const ring = bim.wallRing(wp);
              const f = m.addFaceFromRings(ring.map(q => G.clone(q)));
              if (!f) throw new Error('facade ring degenerate');
              if (!m.pushPull(f, H - 0.15)) throw new Error('facade sweep failed');
            });
          const wp = { base: wallEnt.params.base, end: wallEnt.params.end, height: H - 0.15, thickness: 0.2 };
          const cut = (type, t, w2, h2, sill, extra) => {
            const before = new Set(m.faces.keys());
            m.bimHold = wallEnt.id;
            let info = null;
            try { info = BT.HostedCut.cut(G, m, wp,
              { distanceFromStart: t, width: w2, height: h2, sillHeight: sill, depth: 0.2 }); }
            finally { m.bimHold = false; }
            if (!info || info.error) throw new Error('facade cut failed');
            const nf = [...m.faces.keys()].filter(id => !before.has(id));
            const roles = {};
            for (const id of nf) roles[id] = 'lining';
            bim.create(type, Object.assign({ hostWallId: wallEnt.id, distanceFromStart: info.t,
              width: w2, height: h2, sillHeight: sill, depth: 0.2, facing: 1, hand: 1 }, extra || {}), roles, []);
          };
          cut('door', 1.0, 1.2, 2.2, 0);                                  // balcony door
          cut('window', 3.4, 1.5, 1.2, 0.9);                              // window
          cut('opening', 4.9, 0.5, 0.5, 1.2, { shape: 'circle', dia: 0.5 }); // WALL-201 pipe
        });

        if (s < STORIES - 1) stage('slab — F' + (s + 1) + ' ceiling', () => {
          // punches at every column (3mm reveal) + stair + hoistway + circle
          const outer = [[-0.15, -0.15, slabZ], [12.15, -0.15, slabZ], [12.15, 6.15, slabZ], [-0.15, 6.15, slabZ]];
          const punches = S.columnHolesForSlab(m,
            { baseLevel: lvlUp, thickness: 0.15, _planeZ: slabZ },
            { outer: outer.map(q => q.slice()), holes: [] });
          const hw = EF.hoistwayRing({ x: ELEV.x, y: ELEV.y, w: ELEV.w, d: ELEV.d, wall: ELEV.wall })
            .map(q => [q[0], q[1], slabZ]);
          const stair = [[STAIR.x - STAIR.w / 2, STAIR.y - STAIR.d / 2, slabZ],
            [STAIR.x + STAIR.w / 2, STAIR.y - STAIR.d / 2, slabZ],
            [STAIR.x + STAIR.w / 2, STAIR.y + STAIR.d / 2, slabZ],
            [STAIR.x - STAIR.w / 2, STAIR.y + STAIR.d / 2, slabZ]];
          let circle = null;
          if (s === 1) { // one circular penetration (16-gon, r 0.3 at (5,1))
            circle = [];
            for (let k = 0; k < 16; k++) {
              const a = (k / 16) * Math.PI * 2;
              circle.push([+(5 + 0.3 * Math.cos(a)).toFixed(4), +(1 + 0.3 * Math.sin(a)).toFixed(4), slabZ]);
            }
          }
          const holes = [hw, stair, ...punches.map(p2 => {
            const r = p2.ring;
            const cx = r.reduce((a, q) => a + q.x, 0) / r.length;
            const cy = r.reduce((a, q) => a + q.y, 0) / r.length;
            return r.map(q => {
              const dx = q.x - cx, dy = q.y - cy, l = Math.hypot(dx, dy) || 1;
              return [+(q.x + dx / l * 0.003).toFixed(6), +(q.y + dy / l * 0.003).toFixed(6), slabZ];
            });
          })];
          if (circle) holes.push(circle);
          reg('floor', { thickness: 0.15, baseLevel: lvlUp, regions: [{ outer, holes }] },
            () => {
              const f = m.addFaceFromRings(outer.map(q => G.v(...q)),
                holes.map(hg => hg.map(q => G.v(...q))));
              if (!f) throw new Error('slab ring degenerate');
              if (!m.pushPull(f, -0.15)) throw new Error('slab sweep failed');
            });
        });
      }

      // ================================================== REBAR
      // RECORD-ONLY: the 5-story cage would be ~800k pipe faces; the
      // model stores centerline records instead (ribbons + BBS read
      // them) and the whole building builds in seconds
      m.rebarPipes = false;
      stage('reinforcement (every element)', () => {
        const fpad = { type: 'foundation', foundation: {
          bottom: 0.04, side: 0.05, topLayer: 'X',
          xDia: 0.012, xMode: 'spacing', xValue: 0.2,
          yDia: 0.012, yMode: 'spacing', yValue: 0.2,
          stubX: 2, stubY: 2, stubDia: 0.014, lap: 0.5, leg: 0.15, colW: COL, colL: COL } };
        const fmat = { type: 'foundation', foundation: { ...fpad.foundation, kind: 'mat' } };
        const ccol = { type: 'column', column: {
          tie: { l: 0.04, r: 0.04, t: 0.04, b: 0.04, front: 0.05, dia: 0.008,
            bentAngle: 135, bentFactor: 6, mode: 'spacing', value: 0.2 },
          main: { dia: 0.016, tOffset: 0.05, bOffset: 0.05, type: 'straight',
            splice: { mode: 'lap' } } } };
        const bbeam = { type: 'beam', beam: {
          side: 0.03, end: 0.05, tieDia: 0.008, bentAngle: 135, bentFactor: 6,
          mode: 'spacing', value: 0.25,
          topCount: 2, topDia: 0.014, botCount: 3, botDia: 0.016,
          top: 0.03, bot: 0.03, skin: 0, skinDia: 0.012, integrity: true } };
        const sslab = { type: 'slab', slab: {
          bottom: 0.025, top: 0.025, side: 0.025,
          xDia: 0.012, xSpacing: 0.25, yDia: 0.012, ySpacing: 0.25,
          topMesh: false, topDia: 0 } };
        const wwall = { type: 'wall', wall: {
          cover: 0.04, vDia: 0.012, vSpacing: 0.3, hDia: 0.012, hSpacing: 0.3,
          twoCurtains: true, vOff: 0.05, boundary: true } };
        const ssog = { type: 'slab', slab: { ...sslab.slab, sog: true, sogDia: 0.012 } };

        const rebarOne = (ent, params) => {
          const fid = (ent.faces || []).find(id => m.faces.get(id));
          if (!fid) throw new Error('no face on ' + ent.id);
          const res = ER.buildElementRebar(m, fid, params, bim.entities);
          if (res && res.error) throw new Error(ent.type + ' ' + ent.id + ' rebar: ' + res.error);
          return res;
        };
        for (const ent of bim.entities) {
          if (ent.type === 'foundation') {
            const circular = ent.params.radius != null;
            const kind = circular ? null : ent.params.kind;
            rebarOne(ent, circular
              ? { type: 'foundation', foundation: { ...fpad.foundation, stubX: 0, stubY: 0 } }
              : kind === 'mat' ? fmat
                : { type: 'foundation', foundation: { ...fpad.foundation } });
          } else if (ent.type === 'column') rebarOne(ent, ccol);
          else if (ent.type === 'beam') rebarOne(ent, bbeam);
          else if (ent.type === 'wall') rebarOne(ent, wwall);
          else if (ent.type === 'floor') {
            const apron = ent.params.baseLevel === 'l0';
            rebarOne(ent, apron ? ssog : sslab);
          }
        }
      });

      // run the stages with UI paint between them
      for (let i = 0; i < stages.length; i++) {
        if (onProgress) onProgress(stages[i].label, i, stages.length);
        stages[i].fn();
        await new Promise(r => setTimeout(r, 0));
      }

      // count + finish
      for (const f of m.faces.values()) {
        if (f.userData && f.userData.rebar) continue;
        m.edgesForRing(f.loop, true);
        for (const h of (f.holes || [])) m.edgesForRing(h, true);
      }
      m.reapOrphanEdges();
      for (const f of m.faces.values()) if (f.userData && f.userData.rebar) rebarFaces++;
      const counts = {};
      for (const e of bim.entities) counts[e.type] = (counts[e.type] || 0) + 1;
      counts.rebarFaces = rebarFaces;
      return counts;
    } finally {
      m.endEdgeSweep();
      bim._holdOpDone = heldOp;
    }
  }

  window.DemoMNL66 = { buildAsync };
})();
