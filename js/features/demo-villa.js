'use strict';
// Feature: Villa Demo — a three-storey family house on a fenced plot with a
// paved courtyard, balconies with glass balustrades, hip roofs and windows
// in every facade bay (the SketchUpBox reference image). Built through the
// SAME tool code paths as interactive drawing: WallTool.bandRing + pushPull
// + bim.create, HostedCut for openings, slab push/pulls for plates.
// File ▸ Load Villa Demo (courtyard + fence).
(function () {
  const FLOORS = 3, STORY = 3;
  const HX = 10, HY = 8;        // house half-extents footprint: 20 x 16 m? — no:
  // house footprint 12 x 9 m starting at (0,0); plot 24 x 18 m
  const W = 12, D = 9;
  const PW = 26, PD = 20;       // plot
  const FX0 = -6, FY0 = -5;     // plot origin offset

  function program(app) {
    const m = app.model, bim = app.bim, G = window.G;
    const BT = window.BimTools;
    m.levels = [
      { id: 'lvl_1', name: 'Level 1', elevation: 0 },
      { id: 'lvl_2', name: 'Level 2', elevation: STORY },
      { id: 'lvl_3', name: 'Level 3', elevation: STORY * 2 },
    ];
    const counts = {};

    const stage = fn => fn();

    const reg = (type, params, buildGeom, roleOf) => {
      const before = new Set(m.faces.keys());
      const edgesBefore = new Set(m.edges.keys());
      const extra = buildGeom() || [];
      const nf = [...m.faces.keys()].filter(id => !before.has(id)).map(id => m.faces.get(id))
        .filter(f => f && !f.userData);
      const roles = {};
      for (const f of nf) roles[f.id] = roleOf ? roleOf(f) : 'side';
      const edges = [...m.edges.keys()].filter(id => !edgesBefore.has(id) && !m.edges.get(id).userData);
      return bim.create(type, params, roles, [...new Set([...extra, ...edges])]);
    };

    const wall = (A, B, z, h, t, base) => reg('wall', {
      base: [A.x, A.y, z], end: [B.x, B.y, z], height: h, thickness: t,
      locationLine: 'centerline', baseLevel: base || 'lvl_1',
      topConstraint: 'unconnected', closed: false, joins: { start: 0, end: 0 },
    }, () => {
      const ring = BT.WallTool.bandRing(G, [A, B], t, 'centerline');
      const f = m.addFaceFromRings(ring.map(p => G.v(p.x, p.y, z)));
      if (!m.pushPull(f, h)) throw new Error('wall sweep failed');
    });

    const slab = (x0, y0, x1, y1, z, th, down = true, type = 'slab') => reg(type, {
      baseLevel: 'lvl_1', thickness: th, regions: [{
        outer: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], holes: [],
      }], fixed: true,
    }, () => {
      const f = m.addFaceFromRings([G.v(x0, y0, z), G.v(x1, y0, z), G.v(x1, y1, z), G.v(x0, y1, z)]);
      if (!m.pushPull(f, down ? -th : th)) throw new Error('slab extrude failed');
    }, f => {
      const c = m.faceCentroid(f);
      return Math.abs(c.z - z) < 1e-6 ? 'top' : 'bottom';
    });

    // ---------------------------------------------------------- plot + fence
    stage(() => {
      // grass plot
      slab(FX0, FY0, FX0 + PW, FY0 + PD, 0.02, 0.06, true, 'floor');
      // paved courtyard in front of the house
      slab(2, -3.4, W + 4, 0.4, 0.08, 0.08, true, 'floor');
      // fence: low walls around the plot with a 3 m gate gap on the south
      const h = 1.2, t = 0.1;
      const seg = (A, B) => wall(A, B, 0.02, h, t, 'lvl_1');
      seg(G.v(FX0, FY0), G.v(3, FY0));                    // west-front
      seg(G.v(6, FY0), G.v(FX0 + PW, FY0));               // east-front (gate gap 3..6)
      seg(G.v(FX0, FY0), G.v(FX0, FY0 + PD));             // west side
      seg(G.v(FX0 + PW, FY0), G.v(FX0 + PW, FY0 + PD));   // east side
      seg(G.v(FX0, FY0 + PD), G.v(FX0 + PW, FY0 + PD));   // back
      counts.fence = 5;
    });

    // ------------------------------------------------- house floors 1..3
    const winBays = [];
    for (let f = 0; f < FLOORS; f++) {
      const z = f * STORY;
      const base = f === 0 ? 'lvl_1' : f === 1 ? 'lvl_2' : 'lvl_3';
      stage(() => {
        const t = 0.2, h = STORY - 0.05;
        const south = wall(G.v(0, 0, z), G.v(W, 0, z), z, h, t, base);
        const east = wall(G.v(W, 0, z), G.v(W, D, z), z, h, t, base);
        const north = wall(G.v(W, D, z), G.v(0, D, z), z, h, t, base);
        const west = wall(G.v(0, D, z), G.v(0, 0, z), z, h, t, base);
        // plate FIRST (construction order): walls land on it, face healing
        // never attributes wall faces to the floor entity
        if (f > 0) slab(-0.1, -0.1, W + 0.1, D + 0.1, z, 0.15, true, 'floor');
        counts.walls = (counts.walls || 0) + 4;
        winBays.push({ z, south, east, north, west });
      });
    }
    // ground slab under the house
    stage(() => slab(-0.1, -0.1, W + 0.1, D + 0.1, 0, 0.15, true, 'floor'));

    // ------------------------------------------------------------- windows
    stage(() => {
      const opening = (type, wallEnt, at, w, hgt, sill) => {
        const A = wallEnt.params.base, B = wallEnt.params.end;
        const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
        const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
        const dist = (at[0] - A[0]) * ux + (at[1] - A[1]) * uy;
        const spec = { distanceFromStart: dist, width: w, height: hgt, sillHeight: sill, depth: wallEnt.params.thickness };
        const before = new Set(m.faces.keys());
        m.bimHold = wallEnt.id;
        let info = null, frameFaces = [];
        try {
          info = BT.HostedCut.cut(G, m, wallEnt.params, spec);
          if (!info || info.error) throw new Error((info && info.error) || 'cut failed');
          if (type !== 'opening') frameFaces = BT.HostedCut.frame(G, m, info, spec, type, { facing: 1, hand: 1 }) || [];
        } finally { m.bimHold = false; }
        const nf = [...m.faces.keys()].filter(id => !before.has(id)).map(id => m.faces.get(id)).filter(f2 => f2 && !f2.userData);
        const roles = {};
        for (const f2 of nf) {
          const fi = frameFaces.indexOf(f2);
          roles[f2.id] = fi >= 0 ? (type === 'door' && fi === frameFaces.length - 1 ? 'leaf' : 'frame') : 'lining';
        }
        const edges = [];
        for (const f2 of nf) for (const r of m.rings(f2)) for (let i = 0; i < r.length; i++) {
          const e = m.findEdge(r[i], r[(i + 1) % r.length]);
          if (e && !e.userData) edges.push(e.id);
        }
        bim.create(type, { hostWallId: wallEnt.id, distanceFromStart: info.t,
          sillHeight: sill, width: w, height: hgt, depth: spec.depth, facing: 1, hand: 1,
          baseLevel: wallEnt.params.baseLevel },
          roles, [...new Set(edges)]);
        counts[type] = (counts[type] || 0) + 1;
      };
      for (const bay of winBays) {
        // two windows per facade per floor + entrance door on the south
        for (const wx of [3, 9]) opening('window', bay.south, [wx, 0], 1.8, 1.5, 0.9);
        for (const wx of [4, 8]) opening('window', bay.north, [wx, D], 1.8, 1.5, 0.9);
        for (const wy of [3, 6]) opening('window', bay.east, [W, wy], 1.5, 1.5, 0.9);
        for (const wy of [3, 6]) opening('window', bay.west, [0, wy], 1.5, 1.5, 0.9);
      }
      opening('door', winBays[0].south, [6, 0], 1.4, 2.2, 0);
    });

    // ------------------------------------------------- balconies (levels 2-3)
    stage(() => {
      for (let f = 1; f < FLOORS; f++) {
        const z = f * STORY + 0.02;
        // balcony slab along the south facade
        slab(1, -1.8, W - 1, 0.15, z, 0.12, false, 'floor');
        // glass balustrade: thin transparent walls on the slab edge
        const g = 0.06, h = 1.05;
        wall(G.v(1, -1.8, z + 0.14), G.v(W - 1, -1.8, z + 0.14), z + 0.14, h, g, 'lvl_2');
        wall(G.v(1, -1.8, z + 0.14), G.v(1, 0.15, z + 0.14), z + 0.14, h, g, 'lvl_2');
        wall(G.v(W - 1, -1.8, z + 0.14), G.v(W - 1, 0.15, z + 0.14), z + 0.14, h, g, 'lvl_2');
        counts.balustrades = (counts.balustrades || 0) + 3;
      }
    });

    // ------------------------------------------------- hip roofs per level top
    stage(() => {
      // a simple hip: ridge along the long axis; built as two trapezoid faces
      // + two triangular end faces (roof-feature-grade geometry, registered
      // as fixed 'roof' elements)
      const hip = (x0, y0, x1, y1, z, h, ridgeIn) => {
        const rm = ridgeIn; // ridge inset from each long side
        const ym = (y0 + y1) / 2;
        const reg2 = (params, rings) => {
          const before = new Set(m.faces.keys());
          for (const ring of rings) {
            const f = m.addFaceFromRings(ring);
            if (f) f.color = '#3a3f46';
          }
          const nf = [...m.faces.keys()].filter(id => !before.has(id)).map(id => m.faces.get(id)).filter(f2 => f2 && !f2.userData);
          const roles = {}; for (const f2 of nf) roles[f2.id] = 'top';
          return bim.create('roof', params, roles, []);
        };
        reg2({ baseLevel: 'lvl_1', pitch: 30, fixed: true, roofKind: 'hip' }, [
          // south slope
          [G.v(x0, y0, z), G.v(x1, y0, z), G.v(x1 - rm, ym, z + h), G.v(x0 + rm, ym, z + h)],
          // north slope
          [G.v(x1, y1, z), G.v(x0, y1, z), G.v(x0 + rm, ym, z + h), G.v(x1 - rm, ym, z + h)],
          // east end triangle
          [G.v(x1, y0, z), G.v(x1, y1, z), G.v(x1 - rm, ym, z + h)],
          // west end triangle
          [G.v(x0, y1, z), G.v(x0, y0, z), G.v(x0 + rm, ym, z + h)],
        ]);
        counts.roofs = (counts.roofs || 0) + 1;
      };
      hip(-0.6, -0.6, W + 0.6, D + 0.6, FLOORS * STORY + 0.1, 2.2, 2.0);   // main hip
      hip(1.0, -2.2, W - 1.0, 0.3, STORY + 0.12, 0.9, 0.9);                // entrance canopy hip
    });

    return counts;
  }

  window.VillaDemo = { build: program };
})();
