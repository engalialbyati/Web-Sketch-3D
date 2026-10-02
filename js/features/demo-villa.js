'use strict';
// Feature: Villa Demo — three-storey family house styled after the
// SketchUpBox reference: white plaster over a stone base, wide dark-framed
// glass bays, set-back third floor with terraces, wide dark hip roofs with
// overhangs, entrance porch with columns, balconies with glass balustrades,
// white-and-dark-metal fence with a gate, paved courtyard with a pond, road
// with sidewalk. File ▸ Load Villa Demo (courtyard + fence).
(function () {
  const FLOORS = 3, STORY = 3;
  const W = 15, D = 10;         // house footprint
  const L3W = 9;                // third-floor block (set back from x = L3W)
  const PW = 26, PD = 20;       // plot
  const FX0 = -6, FY0 = -5;

  function program(app) {
    const m = app.model, bim = app.bim, G = window.G;
    const BT = window.BimTools;
    m.levels = [
      { id: 'lvl_1', name: 'Level 1', elevation: 0 },
      { id: 'lvl_2', name: 'Level 2', elevation: STORY },
      { id: 'lvl_3', name: 'Level 3', elevation: STORY * 2 },
    ];
    const counts = {};
    m.bimHold = true;
    m.noAutoIntersect = true; // the decor intentionally overlaps (glazed bays
    // proud of walls, balcony bands crossing facades) — auto-slicing it is
    // pure O(n²) waste and was stalling the build // the whole build is one construction bracket: no bimDirty, no reaps
    bim._holdOpDone = true; // ONE settlement at the end — per-create opDone
    // passes were detaching every entity as later stages split its faces
    const stage = fn => fn();
    const paint = (ids, color) => { for (const fid of ids) { const f = m.faces.get(fid); if (f) f.color = color; } };
    const COL = {
      wallUp: '#f4f1ea', roof: '#34383f', frame: '#2c3036',
      glass: '#a9c7da', glassA: 0.45, balus: '#b9d2e2', balusA: 0.4,
      pier: '#efe9dc', bar: '#2c3036', pave: '#b9b3a8', grass: '#6f9553',
      road: '#3d4045', walk: '#c8c4bc', water: '#5f9bb0', stone: '#c9bfae',
    };

    const reg = (type, params, buildGeom, roleOf) => {
      const before = new Set(m.faces.keys());
      buildGeom();
      const nf = [...m.faces.keys()].filter(id => !before.has(id)).map(id => m.faces.get(id))
        .filter(f => f && !f.userData);
      const roles = {};
      for (const f of nf) roles[f.id] = roleOf ? roleOf(f) : 'side';
      return bim.create(type, params, roles, []);
    };
    // axis-aligned cuboid from two corners, painted, flagged as villa decor
    const cuboid = (x0, y0, z0, x1, y1, z1, color, alpha) => {
      const P = (a, b, c) => G.v(a, b, c);
      const quads = [
        [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],
        [P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)],
        [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)],
        [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)],
        [P(x1, y1, z0), P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1)],
        [P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1)],
      ];
      const ids = [];
      for (const ring of quads) {
        const f = m.addFaceFromRings(ring);
        if (f) { f.color = color; if (alpha != null) f.alpha = alpha; f.userData = { deliberate: 1, villa: 1 }; ids.push(f.id); }
      }
      return ids;
    };

    const wall = (A, B, z, h, t, base, color) => {
      const ring = BT.WallTool.bandRing(G, [A, B], t, 'centerline');
      const f = m.addFaceFromRings(ring.map(p => G.v(p.x, p.y, z)));
      if (!m.pushPull(f, h)) throw new Error('wall sweep failed');
      // paint the band faces (born since the ring was drawn)
      const c = color || COL.wallUp;
      for (const q of m.faces.values())
        if (!q.userData && q.color == null && Math.abs(m.faceCentroid(q).z - (z + h / 2)) < h / 2 + 0.25) q.color = c;
    };

    const slab = (x0, y0, x1, y1, z, th, down, type, color) => {
      const before = new Set(m.faces.keys());
      const f = m.addFaceFromRings([G.v(x0, y0, z), G.v(x1, y0, z), G.v(x1, y1, z), G.v(x0, y1, z)]);
      if (!m.pushPull(f, down ? -th : th)) throw new Error('slab extrude failed');
      if (color) for (const [id, q] of m.faces) if (!before.has(id)) { q.color = color; q.matId = null; }
    };
    // hip roof with overhang: 4 slopes to a point/ridge, dark
    const hip = (x0, y0, x1, y1, z, h, o) => {
      const ym = (y0 + y1) / 2;
      const xm = (x0 + x1) / 2;
      const ridgeL = (x1 - x0) > (y1 - y0);
      let rings;
      if (ridgeL) {
        rings = [
          [G.v(x0 - o, y0 - o, z), G.v(x1 + o, y0 - o, z), G.v(xm, ym, z + h)],
          [G.v(x1 + o, y1 + o, z), G.v(x0 - o, y1 + o, z), G.v(xm, ym, z + h)],
          [G.v(x1 + o, y0 - o, z), G.v(x1 + o, y1 + o, z), G.v(xm, ym, z + h)],
          [G.v(x0 - o, y1 + o, z), G.v(x0 - o, y0 - o, z), G.v(xm, ym, z + h)],
        ];
      } else {
        rings = [
          [G.v(x0 - o, y0 - o, z), G.v(x0 - o, y1 + o, z), G.v(xm, ym, z + h)],
          [G.v(x1 + o, y1 + o, z), G.v(x1 + o, y0 - o, z), G.v(xm, ym, z + h)],
          [G.v(x1 + o, y0 - o, z), G.v(x0 - o, y0 - o, z), G.v(xm, ym, z + h)],
          [G.v(x0 - o, y1 + o, z), G.v(x1 + o, y1 + o, z), G.v(xm, ym, z + h)],
        ];
      }
      const ids = [];
      for (const ring of rings) {
        const f = m.addFaceFromRings(ring);
        if (f) { f.color = COL.roof; f.userData = { deliberate: 1, villa: 1 }; ids.push(f.id); }
      }
      return ids;
    };

    // dark-framed glazed bay on a facade plane (frame + glass proud of the wall)
    const glassBay = (plane, a0, a1, sill, h, face) => {
      const t = 0.1, g = 0.05;
      if (plane.axis === 'x') {
        const yF0 = plane.pos - (face > 0 ? t : 0), yF1 = plane.pos + (face > 0 ? 0 : t);
        const yG0 = plane.pos - (face > 0 ? t + g : 0), yG1 = plane.pos + (face > 0 ? g : t + g);
        cuboid(a0, Math.min(yF0, yF1), sill, a1, Math.max(yF0, yF1), sill + h, COL.frame);
        cuboid(a0 + 0.07, Math.min(yG0, yG1), sill + 0.07, a1 - 0.07, Math.max(yG0, yG1), sill + h - 0.07, COL.glass, COL.glassA);
      } else {
        const xF0 = plane.pos - (face > 0 ? t : 0), xF1 = plane.pos + (face > 0 ? 0 : t);
        const xG0 = plane.pos - (face > 0 ? t + g : 0), xG1 = plane.pos + (face > 0 ? g : t + g);
        cuboid(Math.min(xF0, xF1), a0, sill, Math.max(xF0, xF1), a1, sill + h, COL.frame);
        cuboid(Math.min(xG0, xG1), a0 + 0.07, sill + 0.07, Math.max(xG0, xG1), a1 - 0.07, sill + h - 0.07, COL.glass, COL.glassA);
      }
    };


    // ------------------------------------------------------ plot + road
    stage(() => {
      reg('floor', { baseLevel: 'lvl_1', thickness: 0.06, fixed: true,
        regions: [{ outer: [[FX0, FY0, 0.02], [FX0 + PW, FY0, 0.02], [FX0 + PW, FY0 + PD, 0.02], [FX0, FY0 + PD, 0.02]], holes: [] }] },
        () => { const f = m.addFaceFromRings([G.v(FX0, FY0, 0.02), G.v(FX0 + PW, FY0, 0.02), G.v(FX0 + PW, FY0 + PD, 0.02), G.v(FX0, FY0 + PD, 0.02)]); m.pushPull(f, -0.06); },
        () => 'top');
      paint([...m.faces.values()].filter(f => f.userData && f.userData.villa).map(f => f.id), COL.grass);
      cuboid(-9, -9.4, 0.02, 23, -6.2, 0.06, COL.road);
      cuboid(-9, -6.2, 0.02, 23, -5, 0.08, COL.walk);
    });

    // ------------------------------------------ glass bays per facade
    stage(() => {
      for (const [x0, x1] of [[1.2, 3.8], [4.8, 7.4], [10.2, 12.8], [13.2, 14.7]])
        glassBay({ axis: 'x', pos: 0 }, x0, x1, 0.5, 2.2, -1);
      for (const [x0, x1] of [[0.8, 3.4], [4.2, 6.8], [7.4, 8.5]])
        glassBay({ axis: 'x', pos: 0 }, x0, x1, 0.5, 2.2, -1);
      for (const [x0, x1] of [[1.2, 3.6], [4.4, 6.6], [7.2, 8.4]])
        glassBay({ axis: 'x', pos: 0 }, x0, x1, 0.6, 1.8, -1);
      for (const [x0, x1] of [[10, 12.6], [13.2, 14.7]])
        glassBay({ axis: 'x', pos: 0 }, x0, x1, 0.5, 2.2, -1);
      for (const [x0, x1] of [[1.2, 3.8], [4.8, 7.4], [10.2, 12.8], [13.2, 14.7]])
        glassBay({ axis: 'x', pos: D }, x0, x1, 0.7, 1.9, 1);
      for (const [x0, x1] of [[0.8, 3.4], [4.2, 6.8], [7.4, 8.5]])
        glassBay({ axis: 'x', pos: D }, x0, x1, 0.6, 2, 1);
      for (const [x0, x1] of [[1.2, 3.6], [4.4, 6.6]])
        glassBay({ axis: 'x', pos: D }, x0, x1, 0.6, 1.8, 1);
      for (const [y0, y1] of [[1, 3.6], [4.6, 7.2], [7.8, 9]])
        glassBay({ axis: 'y', pos: W }, y0, y1, 0.5, 2.2, 1);
      for (const [y0, y1] of [[1, 3.4], [4.4, 6.6], [7.4, 8.6]])
        glassBay({ axis: 'y', pos: W }, y0, y1, 0.6, 2, 1);
      for (const [y0, y1] of [[1, 3.6], [4.6, 7.2], [7.8, 9]])
        glassBay({ axis: 'y', pos: 0 }, y0, y1, 0.5, 2.2, -1);
      for (const [y0, y1] of [[1, 3.4], [4.4, 6.6], [7.4, 8.6]])
        glassBay({ axis: 'y', pos: 0 }, y0, y1, 0.6, 2, -1);
      counts.bays = 'grid';
    });

    // ------------------------------------------- entrance porch + columns
    stage(() => {
      cuboid(-0.2, -2.9, 0.02, 4.9, 0.05, 0.08, COL.walk);
      cuboid(0.5, -2.5, 0.08, 0.85, -2.15, 3.03, COL.pier);
      cuboid(3.9, -2.5, 0.08, 4.25, -2.15, 3.03, COL.pier);
      hip(-0.4, -3.1, 5.1, 0.25, 3.03, 0.9, 0.15);
      glassBay({ axis: 'x', pos: 0 }, 1.4, 3.4, 0.02, 2.35, -1); // entrance glazing
      counts.porch = 1;
    });

    // ------------------------------------------- fence: piers + dark bars
    stage(() => {
      const H = 1.35, barH = 1.15;
      const run = (x0, y0, x1, y1, gateFrom, gateTo, zb = 0.02) => {
        const dx = x1 - x0, dy = y1 - y0;
        const L = Math.hypot(dx, dy);
        const n = Math.round(L / 3.25);
        for (let i = 0; i <= n; i++) {
          const px = x0 + dx * (i / n), py = y0 + dy * (i / n);
          cuboid(px - 0.16, py - 0.16, 0.04, px + 0.16, py + 0.16, H, COL.pier);
        }
        for (let d2 = 0.4; d2 < L - 0.35; d2 += 0.18) {
          const bx = x0 + dx * (d2 / L), by = y0 + dy * (d2 / L);
          if (gateFrom != null && d2 > gateFrom && d2 < gateTo) continue;
          cuboid(bx - 0.035, by - 0.035, 0.12, bx + 0.035, by + 0.035, 0.12 + barH, COL.bar);
        }
        cuboid(Math.min(x0, x1) - 0.06, Math.min(y0, y1) - 0.06, 0.04,
          Math.max(x0, x1) + 0.06, Math.max(y0, y1) + 0.06, 0.14, COL.pier);
      };
      run(FX0, FY0, FX0 + PW, FY0, 7.2 - FX0, 10.4 - FX0, 0.1);
      run(FX0, FY0, FX0, FY0 + PD, 0.1);
      run(FX0 + PW, FY0, FX0 + PW, FY0 + PD, 0.1);
      run(FX0, FY0 + PD, FX0 + PW, FY0 + PD, 0.1);
      cuboid(7.25, -5.06, 0.14, 8.55, -5, 1.3, COL.bar);
      cuboid(8.85, -5.06, 0.14, 10.35, -5, 1.3, COL.bar);
      counts.fence = 4;
    });

    // ------------------------------------------- courtyard pond + planter
    stage(() => {
      const cx = 4.2, cy = -1.6, r = 1.1;
      const ring = [], water = [];
      for (let i = 0; i < 8; i++) {
        const t = i / 8 * Math.PI * 2 + Math.PI / 8;
        ring.push(G.v(cx + Math.cos(t) * (r + 0.25), cy + Math.sin(t) * (r + 0.25), 0.03));
        water.push(G.v(cx + Math.cos(t) * r, cy + Math.sin(t) * r, 0.1));
      }
      for (let i = 0; i < 8; i++) {
        const a = ring[i], b2 = ring[(i + 1) % 8];
        const f = m.addFaceFromRings([a, b2, G.v(b2.x, b2.y, 0.16), G.v(a.x, a.y, 0.16)]);
        if (f) { f.color = '#8d8578'; f.userData = { deliberate: 1, villa: 1 }; }
      }
      const wf = m.addFaceFromRings(water);
      if (wf) { wf.color = COL.water; wf.alpha = 0.75; wf.userData = { deliberate: 1, villa: 1 }; }
      cuboid(-4.6, 10.6, 0.06, -2.6, 12.6, 0.42, '#8d8578');
      cuboid(-4.45, 10.75, 0.42, -2.75, 12.45, 0.55, COL.grass);
      counts.pond = 1;
    });

    m.bimHold = false;
    bim._holdOpDone = false;
    m.noAutoIntersect = false;
    if (bim._hostsDirty) bim._hostsDirty.clear();
    // bim phase: elements join/derive normally; settlement deferred
    m.bimHold = false;
    // ------------------------------------------------- house floors 1..3
    // L1+L2 full footprint; L3 set back to x 0..L3W (terrace over the wing)
    const zones = [
      { z: 0.1, base: 'lvl_1', x1: W, baseCol: COL.stone },
      { z: STORY + 0.1, base: 'lvl_2', x1: W, baseCol: COL.wallUp },
      { z: STORY * 2 + 0.1, base: 'lvl_3', x1: L3W, baseCol: COL.wallUp },
    ];
    for (const zn of zones) {
      stage(() => {
        const t = 0.2, h = STORY - 0.1; // base lifted +0.1: clears the lawn/paving slabs
        if (zn.z > 0) slab(-0.12, -0.12, zn.x1 + 0.12, D + 0.12, zn.z, 0.15, true, 'floor', COL.frame);
        if (zn.x1 === L3W) slab(L3W, -0.12, W + 0.12, D + 0.12, zn.z, 0.15, true, 'floor', COL.frame);
        const col = zn.baseCol;
        // terrace / balcony base bands at this level — BEFORE the walls, or
        // their boxes would split the walls' stamped faces (bimDirty detach)
        if (zn.z === STORY) {
          cuboid(L3W, -1.7, zn.z + 2.9, W - 0.1, 0.05, zn.z + 3.02, COL.frame);
          cuboid(L3W, -1.75, zn.z + 3.02, W - 0.1, -1.69, zn.z + 4.02, COL.balus, COL.balusA);
        }
        if (zn.z === STORY * 2) {
          cuboid(L3W, 0.1, zn.z + 2.9, W, D - 0.1, zn.z + 3.02, COL.frame);
          cuboid(L3W, D - 0.1, zn.z + 3.02, W, D, zn.z + 4.02, COL.balus, COL.balusA);
          cuboid(W - 0.06, 0.1, zn.z + 3.02, W, D, zn.z + 4.02, COL.balus, COL.balusA);
          cuboid(0.1, -1.7, zn.z + 2.9, L3W - 0.1, 0.05, zn.z + 3.02, COL.frame);
          cuboid(0.1, -1.75, zn.z + 3.02, L3W - 0.1, -1.69, zn.z + 4.02, COL.balus, COL.balusA);
          cuboid(0.1, -1.75, zn.z + 3.02, 0.16, 0.05, zn.z + 4.02, COL.balus, COL.balusA);
        }
        wall(G.v(0, 0, zn.z), G.v(zn.x1, 0, zn.z), zn.z, h, t, zn.base);
        for (const f of m.faces.values()) if (!f.userData && f.color == null && zn.z === 0 && Math.abs(m.faceCentroid(f).x - zn.x1 / 2) < zn.x1) { }
        counts.walls = (counts.walls || 0) + 4;
        // paint the four fresh walls (last-created unstamped before next stage)
      });
      // color the just-built walls: find unstamped wall-band faces at this z
      for (const f of m.faces.values()) {
        if (f.userData) continue;
        const c = m.faceCentroid(f);
        if (Math.abs(c.z - (zn.z + (STORY - 0.05) / 2)) < STORY / 2 + 0.3 && c.x > -1 && c.x < zn.x1 + 1 && c.y > -1 && c.y < D + 1 && f.color == null && Math.abs(m.faceArea(f)) > 0.3)
          f.color = zn.baseCol;
      }
    }

    // ------------------------------------------------------- hip roofs
    stage(() => {
      hip(-0.7, -0.7, L3W + 0.7, D + 0.7, 9.05, 2.1, 0.8);    // main hip over L3
      hip(L3W - 0.2, -0.2, W + 0.7, D + 0.7, 6.12, 1.1, 0.4); // wing hip (low pitch)
      counts.roofs = 2;
    });

    return counts;
  }

  window.VillaDemo = { build: program };
})();
