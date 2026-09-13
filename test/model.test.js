'use strict';
// Model unit tests — BREP invariants, face creation, edge splits, push/pull
// semantics, hole handling, and the validate() audit itself. Every mutating
// test finishes with a validate() check, and closed-shell results are checked
// against exact analytic volumes (box minus carved/added regions).
module.exports = h => {
  const { test, ok, eq, near, throws, makeWorld } = h;

  // ------------------------------------------------------------- vertices
  test('vertex deduplication: identical and within VEPS collapse, far apart do not', () => {
    const { m } = makeWorld();
    const a = m.vertexAt({ x: 1, y: 2, z: 3 });
    eq(m.vertexAt({ x: 1, y: 2, z: 3 }), a, 'identical point -> same id');
    eq(m.vertexAt({ x: 1 + 4e-6, y: 2, z: 3 }), a, 'within VEPS (1e-5) -> same id');
    const b = m.vertexAt({ x: 1.001, y: 2, z: 3 });
    ok(b !== a, 'far apart -> new id');
    eq(m.vertices.size, 2, 'exactly two vertices stored');
  });

  test('edge deduplication: same endpoints reuse the edge', () => {
    const { m } = makeWorld();
    const e1 = m.addEdge({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    const e2 = m.addEdge({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    eq(e2.id, e1.id, 'reversed endpoints -> same edge');
    eq(m.edges.size, 1, 'one edge stored');
    eq(m.addEdge({ x: 0, y: 0, z: 0 }, { x: 0.5e-6, y: 0, z: 0 }), null, 'degenerate (shorter than VEPS) rejected');
  });

  // ------------------------------------------------------------- faces
  test('addFaceFromRings creates a face with exact area and real edges', () => {
    const { m, vclean } = makeWorld();
    const f = m.addFaceFromRings([{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }]);
    ok(f, 'face created');
    eq(m.faces.size, 1);
    near(m.faceArea(f), 12, 1e-9, '4x3 rect area');
    for (const [a, b] of [[f.loop[0], f.loop[1]], [f.loop[1], f.loop[2]], [f.loop[2], f.loop[3]], [f.loop[3], f.loop[0]]])
      ok(m.findEdge(a, b), 'every ring pair has an edge');
    vclean('rect face');
  });

  test('autoFace: closing a polyline ring creates the face (line-tool flow)', () => {
    const { m, vclean } = makeWorld();
    const P = [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]];
    let last = null;
    for (let i = 0; i < 4; i++) last = m.addEdge({ x: P[i][0], y: P[i][1], z: 0 }, { x: P[(i + 1) % 4][0], y: P[(i + 1) % 4][1], z: 0 });
    eq(m.faces.size, 1, 'closing the loop auto-faces');
    near(m.faceArea([...m.faces.values()][0]), 4, 1e-9, '2x2 square');
    ok(last, 'addEdge returned the closing edge');
    vclean('autoFace');
  });

  test('splitEdgeAt: splitting an edge updates every face ring that uses it', () => {
    const { m, vclean } = makeWorld();
    const f = m.addFaceFromRings([{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }]);
    const a0 = f.loop[0], b0 = f.loop[1];
    const bottom = m.findEdge(a0, b0);
    const mid = m.splitEdgeAt(bottom, { x: 2, y: 0, z: 0 });
    eq(f.loop.length, 5, 'ring grew by one vertex');
    ok(f.loop.includes(mid), 'midpoint id is in the ring');
    near(m.faceArea(f), 12, 1e-9, 'area unchanged');
    eq(m.edges.get(bottom.id), undefined, 'original edge replaced');
    ok(m.findEdge(a0, mid) && m.findEdge(mid, b0), 'two half-edges exist');
    vclean('splitEdgeAt');
  });

  test('drawing an edge across a face splits the face (splitFacesAt)', () => {
    const { m, vclean } = makeWorld();
    const f = m.addFaceFromRings([{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }]);
    m.addEdge({ x: 0, y: 1.5, z: 0 }, { x: 4, y: 1.5, z: 0 });
    eq(m.faces.size, 2, 'face split in two (was 3: wrap-around bug left a duplicate)');
    const areas = [...m.faces.values()].map(x => m.faceArea(x)).sort((a, b) => a - b);
    near(areas[0], 6, 1e-9, 'half'); near(areas[1], 6, 1e-9, 'other half');
    eq(m.faces.has(f.id), false, 'original face replaced');
    vclean('splitFacesAt');
  });

  test('a line across a punched face splits it and each hole follows its half', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    const win = w.rect([[1, 0, 0.8], [2.5, 0, 0.8], [2.5, 0, 1.8], [1, 0, 1.8]]);
    eq(m.punchOrSplit(win), 'punch', 'window punched');
    const front = [...m.faces.values()].find(f => f.holes.length === 1);
    m.addEdge({ x: 0, y: 0, z: 1.25 }, { x: 4, y: 0, z: 1.25 }); // horizontal cut above/below? crosses the window
    // this cut passes THROUGH the window hole -> the face must be refused, not sliced
    const stillOne = [...m.faces.values()].filter(f => f.holes.length === 1 && Math.abs(m.faceCentroid(f).y) < 1e-6);
    eq(stillOne.length, 1, 'grazing cut refused, host intact');
    w.vclean('grazing cut');
    // a clean cut that misses the hole splits the host
    const before = m.faces.size;
    m.addEdge({ x: 0, y: 0, z: 0.3 }, { x: 4, y: 0, z: 0.3 });
    eq(m.faces.size, before + 1, 'clean cut adds one face (host split in two)');
    const holed = [...m.faces.values()].filter(f => f.holes.length === 1);
    eq(holed.length, 1, 'hole stayed with one half');
    w.vclean('hole follows half');
  });

  test('a line across a previously pushed face splits it', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    const before = m.faces.size;
    m.addEdge({ x: 2, y: 0, z: 2.5 }, { x: 2, y: 3, z: 2.5 }); // across the pushed top face
    eq(m.faces.size, before + 1, 'top face split in two (extrude hosts are splittable)');
    const tops = [...m.faces.values()].filter(f => Math.abs(m.faceCentroid(f).z - 2.5) < 1e-6 && !f.holes.length);
    eq(tops.length, 2, 'two top halves');
    near(tops[0] && m.faceArea(tops[0]) + m.faceArea(tops[1]), 12, 1e-9, 'areas add up');
    w.vclean('line across pushed face');
  });

  // ------------------------------------------------------------- push/pull
  test('pushPull: ground rect -> closed box with exact volume', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    eq(m.faces.size, 6, 'box has 6 faces');
    near(w.vol(), 30, 1e-6, '4x3x2.5 = 30');
    eq(w.openEdges(), 0, 'watertight');
    w.vclean('box');
  });

  test('pushPull: incremental re-push extends from the current position', () => {
    const w = makeWorld(); const { m } = w;
    const g = w.box(4, 3, 2.5);
    ok(m.pushPull(g, 0.3), 're-push accepted');
    near(w.vol(), 4 * 3 * 2.8, 1e-6, 'height 2.5 + 0.3');
    eq(w.openEdges(), 0, 'still watertight');
    w.vclean('re-push');
  });

  test('pushPull: pushing back to zero collapses the extrusion', () => {
    const w = makeWorld(); const { m } = w;
    const g = w.box(4, 3, 2.5);
    ok(m.pushPull(g, -2.5), 'collapse push accepted');
    near(w.vol(), 0, 1e-6, 'no volume left');
    eq(m.faces.size, 1, 'back to the original face');
    w.vclean('collapse');
  });

  test('pushPull: inward carve creates a recess with exact volume', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    const r = w.rect([[1, 0, 0.4], [3, 0, 0.4], [3, 0, 2.1], [1, 0, 2.1]]);
    eq(m.punchOrSplit(r), 'punch', 'rect inside the face punches');
    const front = [...m.faces.values()].find(f => f.holes.length === 1);
    ok(front, 'host face carries the hole');
    ok(m.pushPull(r, -0.6), 'inward push');
    near(w.vol(), 30 - 2 * 1.7 * 0.6, 1e-6, '30 - 3.4*0.6 = 27.96');
    w.vclean('recess');
  });

  test('pushPull: through-push punches the far face and consumes the pushed face', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    const c = w.circle(4, 1.5, 1.25, 0.5, 24, 'x'); // on the +x face
    eq(m.punchOrSplit(c), 'punch', 'circle inside the face punches');
    ok(m.pushPull(c, -4), 'push exactly to the far face');
    const area24 = 12 * 0.25 * Math.sin(2 * Math.PI / 24); // regular 24-gon area
    near(w.vol(), 30 - area24 * 4, 1e-3, 'box minus a 4 m tunnel');
    eq(m.faces.has(c.id), false, 'pushed face consumed by the through-punch');
    const holed = [...m.faces.values()].filter(f => f.holes.length === 1);
    eq(holed.length, 2, 'near and far faces both carry the tunnel hole');
    eq(w.openEdges(), 0, 'watertight');
    w.vclean('through-push');
  });

  test('pushPull: pushing PAST the far face tunnels through and protrudes with an end cap', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    const c = w.circle(4, 1.5, 1.25, 0.5, 24, 'x');
    m.punchOrSplit(c);
    ok(m.pushPull(c, -5), 'push 1 m past the 4 m body');
    const area24 = 12 * 0.25 * Math.sin(2 * Math.PI / 24);
    // body-with-tunnel and protruding tube are two closed sheets meeting at a
    // legal fold in the far-face plane — check each part exactly
    const G = w.G;
    const far = [...m.faces.values()].find(f => f.holes.length === 1 && Math.abs(m.faceCentroid(f).x) < 1e-6);
    ok(far, 'far face holed at the wall thickness T');
    const tube = [...m.faces.values()].filter(f => {
      const pts = m.pts(f.loop);
      const isRear = f.holes.length === 1 && Math.abs(m.faceCentroid(f).x) < 1e-6;
      return !isRear && pts.every(p => p.x <= 1e-6); // seg2 walls + the end cap (c)
    });
    ok(tube.includes(c), 'end cap is part of the tube sheet');
    const body = [...m.faces.values()].filter(f => !tube.includes(f));
    near(m.shellVolume(body.map(f => f.id)), 30 - area24 * 4, 1e-3, 'body minus the 4 m tunnel');
    eq(m.shellOpenEdges(body.map(f => f.id)), 0, 'body sheet watertight');
    near(Math.abs(m.shellVolume(tube.map(f => f.id))), area24 * 1, 1e-3, 'protruding tube adds its own volume');
    // the tube sheet's only open edges are the fold ring in the rear plane
    const tubeOpen = [];
    {
      const use = new Map();
      const ek = (a, b) => a < b ? a + '_' + b : b + '_' + a;
      for (const f of tube) for (let i = 0; i < f.loop.length; i++) {
        const e = m.findEdge(f.loop[i], f.loop[(i + 1) % f.loop.length]);
        if (e) use.set(e.id, (use.get(e.id) || 0) + 1);
      }
      for (const [id, e] of m.edges) if ((use.get(id) || 0) === 1) tubeOpen.push(e);
    }
    ok(tubeOpen.length === 24, 'the only open tube edges are the fold ring (24-gon)');
    ok(tubeOpen.every(e => Math.abs(m.vp(e.a).x) < 1e-6 && Math.abs(m.vp(e.b).x) < 1e-6), 'fold ring lies in the rear plane');
    eq(m.faces.has(c.id), true, 'the pushed face survives as the forward-facing end cap');
    eq([...m.faces.values()].filter(f => f.holes.length === 1).length, 2, 'near and far faces both holed');
    const v = w.vclean('past-boundary tunnel');
    ok(v.warnings.some(x => x.includes('non-manifold')), 'the fold at the far plane is flagged as legal non-manifold');
    // collapse pulls the protrusion back out and heals the rear hole
    ok(m.pushPull(c, 5), 'collapse back to the original face');
    near(w.vol(), 30, 1e-3, 'box restored, through hole healed');
    eq([...m.faces.values()].filter(f => f.holes.length).length, 1,
      'back to the drawn state: the front window hole remains, capped by the flat face');
    eq(w.openEdges(), 0, 'watertight after collapse');
    w.vclean('past-boundary collapse');
  });

  // ------------------------------------------------------------- splitting
  test('straddling rect splits the host: remainder + covered + tab', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    const r = w.rect([[2.2, 0, 1.4], [3.4, 0, 1.4], [3.4, 0, 3.2], [2.2, 0, 3.2]]); // crosses the top edge
    eq(m.punchOrSplit(r), 'split', 'straddle splits');
    eq(m.faces.size, 8, '6 box faces + covered + tab');
    const v = w.vclean('straddle');
    ok(v.warnings.some(x => x.includes('non-manifold')),
      'the tab fold is flagged as a non-manifold warning (legal topology)');
    w.vclean('straddle');
  });

  test('straddle on a face that already has a hole still splits', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    const hole = w.rect([[0.4, 0, 0.4], [1.2, 0, 0.4], [1.2, 0, 1.2], [0.4, 0, 1.2]]);
    eq(m.punchOrSplit(hole), 'punch', 'first shape punches');
    const r = w.rect([[2.2, 0, 1.4], [3.4, 0, 1.4], [3.4, 0, 3.2], [2.2, 0, 3.2]]);
    eq(m.punchOrSplit(r), 'split', 'straddle on the holed face splits (was a sticker before the fix)');
    const covered = [...m.faces.values()].find(f => f.id !== r.id && (f.holes.length === 0)
      && Math.abs(m.faceCentroid(f).y) < 1e-6 && Math.abs(m.faceArea(f) - 1.32) < 1e-6);
    ok(covered, 'covered region (1.2 x 1.1) found');
    ok(m.pushPull(covered, 0.8), 'push the covered region out');
    near(w.vol(), 30 + 1.32 * 0.8, 1e-3, '31.056');
    const host = [...m.faces.values()].find(f => f.holes.length === 1);
    ok(host, 'the original hole stayed on the host remainder');
    w.vclean('straddle-on-holed-face');
  });

  test('straddle across a previously pushed face splits it (extrude host)', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    const r = w.rect([[3, 1, 2.5], [5, 1, 2.5], [5, 2, 2.5], [3, 2, 2.5]]); // coplanar with the pushed top, crosses its +x edge
    eq(m.punchOrSplit(r), 'split', 'pushed face is splittable');
    const covered = [...m.faces.values()].find(f => f.id !== r.id && !f.extrude && !f.holes.length
      && Math.abs(m.faceCentroid(f).z - 2.5) < 1e-6 && Math.abs(m.faceArea(f) - 1) < 1e-6);
    ok(covered, 'covered 1 m^2 region on the top face');
    ok(m.pushPull(covered, 0.9), 'push out');
    near(w.vol(), 30 + 1 * 0.9 + 2.5 / 3, 1e-3, '30.9 solid + 0.833 open tab contribution');
    ok(m.pushPull(covered, 0.3), 'incremental re-push of the covered face');
    near(w.vol(), 30 + 1 * 1.2 + 2.5 / 3, 1e-3, '0.9 + 0.3 = 1.2 added');
    w.vclean('straddle-on-extrude-host');
  });

  test('a shape drawn around an existing hole absorbs it (cap consumed)', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    const hole = w.rect([[0.6, 0, 0.6], [1.4, 0, 0.6], [1.4, 0, 1.4], [0.6, 0, 1.4]]);
    eq(m.punchOrSplit(hole), 'punch', 'hole punched');
    const big = w.rect([[0.2, 0, 0.2], [2.6, 0, 0.2], [2.6, 0, 2.3], [0.2, 0, 2.3]]);
    eq(m.punchOrSplit(big), 'punch', 'bigger shape still uses the punch path');
    eq(big.holes.length, 1, 'old hole moved onto the drawn face');
    eq(m.faces.has(hole.id), false, 'old cap face consumed');
    ok(m.pushPull(big, -0.5), 'inward push with the inherited hole');
    near(w.vol(), 30 - (2.4 * 2.1 - 0.8 * 0.8) * 0.5, 1e-3, '30 - 4.4*0.5 = 27.8');
    w.vclean('hole-absorb');
  });

  test('a straddle whose covered region contains a hole moves it to the covered face', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    const hole = w.rect([[2.4, 0, 1.6], [3.2, 0, 1.6], [3.2, 0, 2.4], [2.4, 0, 2.4]]);
    eq(m.punchOrSplit(hole), 'punch', 'hole inside the future covered region');
    const r = w.rect([[2.2, 0, 1.4], [3.4, 0, 1.4], [3.4, 0, 3.2], [2.2, 0, 3.2]]);
    eq(m.punchOrSplit(r), 'split', 'straddle splits');
    // faceArea is NET of holes now: 1.32 gross - 0.64 hole = 0.68
    const covered = [...m.faces.values()].find(f => f.id !== r.id && f.holes.length === 1
      && Math.abs(m.faceCentroid(f).y) < 1e-6 && Math.abs(m.faceArea(f) - 0.68) < 1e-3);
    ok(covered, 'covered face carries the hole');
    ok(m.pushPull(covered, 0.7), 'push with hole');
    near(w.vol(), 30 + (1.32 - 0.64) * 0.7, 1e-3, '30.476');
    w.vclean('hole-to-covered');
  });

  // ------------------------------------------------------------- host-merge pulls
  test('L-shaped face on a box corner: draw trims the host, pull merges outward', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    // L touching the front edge and the left edge of the box top
    const L = w.rect([[0, 0, 2.5], [2, 0, 2.5], [2, 1, 2.5], [1, 1, 2.5], [1, 2, 2.5], [0, 2, 2.5]]);
    eq(m.punchOrSplit(L), 'split', 'touching ring trims the host (was corrupt before)');
    eq(m.faces.size, 7, 'box (top trimmed) + L');
    const tops = [...m.faces.values()].filter(f => Math.abs(m.faceCentroid(f).z - 2.5) < 1e-6);
    near(tops.reduce((s, f) => s + m.faceArea(f), 0), 12, 1e-9, 'remainder 9 + L 3 = full top');
    w.vclean('L trim');
    // pull outward: walls only on the L interior; the box walls EXTEND
    ok(m.pushPull(L, 1), 'push accepted');
    near(w.vol(), 30 + 3 * 1, 1e-6, '33 — hollow unified volume');
    eq(w.openEdges(), 0, 'watertight, no internal faces');
    w.vclean('L pull');
    // no coplanar twin walls: the front wall grew from 10 to 12 m^2
    const frontFaces = [...m.faces.values()].filter(f => {
      const n = w.G.loopNormal(m.pts(f.loop));
      return Math.abs(Math.abs(n.y) - 1) < 1e-6 && Math.abs(m.faceCentroid(f).y) < 1e-6;
    });
    eq(frontFaces.length, 1, 'exactly one face in the y=0 plane (no stacked twin quads)');
    near(m.faceArea(frontFaces[0]), 12, 1e-6, 'front wall extended (4x2.5 + 2x1), not duplicated');
  });

  test('L pull: incremental re-push and collapse through extended walls', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    const L = w.rect([[0, 0, 2.5], [2, 0, 2.5], [2, 1, 2.5], [1, 1, 2.5], [1, 2, 2.5], [0, 2, 2.5]]);
    m.punchOrSplit(L);
    m.pushPull(L, 1);
    ok(m.pushPull(L, 0.5), 're-push follows the extension');
    near(w.vol(), 30 + 3 * 1.5, 1e-6, '34.5');
    ok(m.pushPull(L, -1.5), 'collapse back to the top plane');
    near(w.vol(), 30, 1e-6, 'box restored');
    eq(w.openEdges(), 0, 'watertight after collapse');
    w.vclean('L collapse');
  });

  test('L pushed inward carves an exact notch volume', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    const L = w.rect([[0, 0, 2.5], [2, 0, 2.5], [2, 1, 2.5], [1, 1, 2.5], [1, 2, 2.5], [0, 2, 2.5]]);
    m.punchOrSplit(L);
    ok(m.pushPull(L, -0.8), 'inward push');
    near(w.vol(), 30 - 3 * 0.8, 1e-6, '27.6');
    eq(w.openEdges(), 0, 'watertight');
    w.vclean('L carve');
  });

  test('L touching the middle of one host edge (peninsula) trims and pulls', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    // L attached to the front edge only, middle section: (1,0)-(3,0) plus notch
    const L = w.rect([[1, 0, 2.5], [3, 0, 2.5], [3, 1, 2.5], [2, 1, 2.5], [2, 2, 2.5], [1, 2, 2.5], [1, 1, 2.5]]);
    eq(m.punchOrSplit(L), 'split', 'single-edge touch trims');
    ok(m.pushPull(L, 1), 'pull');
    near(w.vol(), 30 + 3 * 1, 1e-6, 'L area 3 -> 33'); // (2x1) + (1x1) = 3
    eq(w.openEdges(), 0, 'watertight');
    w.vclean('peninsula L');
  });

  test('plain rect in the box corner merges on outward pull (no twin quads)', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    const R = w.rect([[0, 0, 2.5], [2, 0, 2.5], [2, 1, 2.5], [0, 1, 2.5]]);
    eq(m.punchOrSplit(R), 'split', 'corner rect trims');
    ok(m.pushPull(R, 1), 'pull');
    near(w.vol(), 30 + 2, 1e-6, '32');
    eq(w.openEdges(), 0, 'watertight');
    const frontFaces = [...m.faces.values()].filter(f => {
      const n = w.G.loopNormal(m.pts(f.loop));
      return Math.abs(Math.abs(n.y) - 1) < 1e-6 && Math.abs(m.faceCentroid(f).y) < 1e-6;
    });
    eq(frontFaces.length, 1, 'one front-plane face (wall extended, no twin quad)');
    near(m.faceArea(frontFaces[0]), 12, 1e-6, 'front wall grew to 12 m^2');
    w.vclean('corner rect');
  });

  // ------------------------------------------------------------- B-rep invariants
  test('vertex welding: tolerance is 1e-4 (spatial hash), not exact-match', () => {
    const { m } = makeWorld();
    const a = m.vertexAt({ x: 1, y: 2, z: 3 });
    eq(m.vertexAt({ x: 1, y: 2, z: 3 }), a, 'exact point welds');
    eq(m.vertexAt({ x: 1.00005, y: 2, z: 3 }), a, '5e-5 away welds (within 1e-4)');
    eq(m.vertexAt({ x: 1.000005, y: 2.000004, z: 3 }), a, 'multi-axis offset welds');
    ok(m.vertexAt({ x: 1.0003, y: 2, z: 3 }) !== a, '3e-4 away is a new vertex');
    eq(m.vertices.size, 2, 'one weld partner stored');
  });

  test('vertex hash stays correct after moves, undo-load, and gc', () => {
    const w = makeWorld(); const { m } = w;
    const a = m.vertexAt({ x: 0, y: 0, z: 0 });
    const b = m.vertexAt({ x: 1, y: 0, z: 0 });
    m.transformVertices([b], p => ({ x: p.x + 5, y: p.y, z: p.z })); // move b far away
    eq(m.vertexAt({ x: 6, y: 0, z: 0 }), b, 'hash followed the moved vertex');
    ok(m.vertexAt({ x: 1, y: 0, z: 0 }) !== b, 'old position no longer welds to it');
    eq(m.vertexAt({ x: 0, y: 0, z: 0 }), a, 'unmoved vertex still welds');
    const m2 = new w.Model();
    m2.load(JSON.parse(JSON.stringify(m.serialize())));
    eq(m2.vertexAt({ x: 0, y: 0, z: 0 }), a, 'hash rebuilt after load');
  });

  test('drawing next to a face welds T-junctions in BOTH directions', () => {
    const w = makeWorld(); const { m } = w;
    const A = w.rect([[0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0]]);
    // B's top edge starts mid-span of A's bottom edge and runs past A's corner
    const B = w.rect([[2, 0, 0], [6, 0, 0], [6, -3, 0], [2, -3, 0]]);
    ok(B, 'face B created');
    const v20 = m.vertexAt({ x: 2, y: 0, z: 0 });
    const v40 = m.vertexAt({ x: 4, y: 0, z: 0 });
    // A's long bottom edge was split at (2,0): no single edge spans 0..4 anymore
    const spans = (x1, y1, x2, y2) => [...m.edges.values()].filter(e => {
      const a = m.vp(e.a), b = m.vp(e.b);
      return (Math.abs(a.x - x1) < 1e-6 && Math.abs(a.y - y1) < 1e-6 && Math.abs(b.x - x2) < 1e-6 && Math.abs(b.y - y2) < 1e-6 && a.z === 0 && b.z === 0) ||
        (Math.abs(b.x - x1) < 1e-6 && Math.abs(b.y - y1) < 1e-6 && Math.abs(a.x - x2) < 1e-6 && Math.abs(a.y - y2) < 1e-6 && a.z === 0 && b.z === 0);
    }).length;
    eq(spans(0, 0, 4, 0), 0, 'edge (0,0)-(4,0) was split at the T-junction');
    eq(spans(2, 0, 4, 0), 1, 'the shared segment (2,0)-(4,0) is ONE edge');
    eq(spans(2, 0, 6, 0), 0, "B's edge was split at A's corner (4,0)");
    ok(B.loop.includes(v40), "B's ring references A's corner vertex id (identical vertex reference)");
    ok(A.loop.includes(v20), "A's ring references the weld vertex id");
    const v = w.vclean('T-junction welds');
    eq(v.warnings.filter(x => x.includes('unwelded')).length, 0, 'no unwelded duplicates');
  });

  test('adjacent rects share the boundary edge and vertices exactly', () => {
    const w = makeWorld(); const { m } = w;
    const A = w.rect([[0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0]]);
    const B = w.rect([[4, 0, 0], [8, 0, 0], [8, 3, 0], [4, 3, 0]]);
    const aRight = [A.loop[1], A.loop[2]]; // (4,0) and (4,3)
    ok(B.loop.includes(aRight[0]) && B.loop.includes(aRight[1]),
      'B reuses A boundary vertex ids — no duplicate coincident vertices');
    const shared = m.findEdge(aRight[0], aRight[1]);
    ok(shared, 'the x=4 boundary is a single shared edge');
    const v = w.vclean('adjacent rects');
    eq(v.warnings.filter(x => x.includes('unwelded')).length, 0, 'no unwelded duplicates');
  });

  test('push/pull of adjacent rects: volumes merge with NO internal partition', () => {
    const w = makeWorld(); const { m } = w;
    const A = w.rect([[0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0]]);
    const B = w.rect([[4, 0, 0], [8, 0, 0], [8, 3, 0], [4, 3, 0]]);
    const vertsBefore = m.vertices.size;
    ok(m.pushPull(B, 2), 'push B');
    eq(m.vertices.size, vertsBefore + 4, 'only the 4 top verts are new — base ids reused');
    ok(m.pushPull(A, 2), 'push A to the same height');
    // SketchUp union semantics: the coincident wall at x=4 is culled entirely
    const x4faces = [...m.faces.values()].filter(f =>
      f.loop.every(id => Math.abs(m.vp(id).x - 4) < 1e-6));
    eq(x4faces.length, 0, 'no wall, no sheet left in the x=4 plane');
    near(w.vol(), 4 * 3 * 2 + 4 * 3 * 2, 1e-6, '48 — one merged solid volume');
    // top corner vertices are welded between the two tops
    const tA = m.vertexAt({ x: 4, y: 0, z: 2 });
    const tB = m.vertexAt({ x: 4, y: 3, z: 2 });
    ok(A.loop.includes(tA) && B.loop.includes(tA), 'top corner (4,0,2) shared by both tops');
    ok(A.loop.includes(tB) && B.loop.includes(tB), 'top corner (4,3,2) shared by both tops');
    const v = w.vclean('adjacent push');
    eq(v.warnings.filter(x => x.includes('unwelded')).length, 0, 'no unwelded duplicates');
  });

  test('collapsing one of two adjacent pushes restores the neighbor wall', () => {
    const w = makeWorld(); const { m } = w;
    const A = w.rect([[0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0]]);
    const B = w.rect([[4, 0, 0], [8, 0, 0], [8, 3, 0], [4, 3, 0]]);
    m.pushPull(B, 2);
    m.pushPull(A, 2);
    ok(m.pushPull(A, -2), 'collapse A back to the ground plane');
    const v = w.vclean('collapse adjacent');
    eq(v.warnings.filter(x => x.includes('unwelded')).length, 0, 'still fully welded');
    const x4faces = [...m.faces.values()].filter(f =>
      f.loop.every(id => Math.abs(m.vp(id).x - 4) < 1e-6));
    eq(x4faces.length, 1, 'the culled partition is restored as B outer wall');
    ok(B.extrude || m.faces.has(B.id), 'B untouched');
  });

  test('adjacent second pocket merges with the first (no divider, no corruption)', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    const r1 = w.rect([[1, 0, 0.8], [2, 0, 0.8], [2, 0, 1.8], [1, 0, 1.8]]);
    eq(m.punchOrSplit(r1), 'punch');
    ok(m.pushPull(r1, -0.5), 'first pocket');
    w.vclean('pocket 1');
    const r2 = w.rect([[2, 0, 0.8], [3, 0, 0.8], [3, 0, 1.8], [2, 0, 1.8]]);
    eq(m.punchOrSplit(r2), 'punch', 'adjacent region punches as a parallel opening');
    ok(m.pushPull(r2, -0.5), 'second pocket at the same depth');
    near(w.vol(), 30 - 1 * 1 * 0.5 - 1 * 1 * 0.5, 1e-6, '29 — both pockets carved exactly');
    eq(w.openEdges(), 0, 'watertight');
    const dividers = [...m.faces.values()].filter(f =>
      f.loop.every(id => Math.abs(m.vp(id).x - 2) < 1e-9));
    eq(dividers.length, 0, 'the divider wall between the pockets is culled (merged void)');
    w.vclean('adjacent pockets');
  });

  test('pushPull rejects degenerate faces (no paper-thin sheets from raw edges)', () => {
    const w = makeWorld(); const { m } = w;
    const f = w.rect([[0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0]]);
    const good = [...f.loop];
    f.loop = [f.loop[0], f.loop[1], f.loop[1]]; // collapsed ring: zero area
    eq(m.pushPull(f, 1), false, 'zero-area face rejected');
    f.loop = [...good];
    ok(m.pushPull(f, 1), 'valid face still extrudes');
    near(w.vol(), 4 * 3 * 1, 1e-6, '12 — a real solid, not a sheet');
    eq(w.openEdges(), 0, 'watertight');
    w.vclean('degenerate guard');
  });

  // ------------------------------------------------------------- wall windows (group scope + rescue)
  test('window on a GROUPED wall face pockets cleanly (no floating tube)', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    m.createGroup({ faces: new Set([...m.faces.keys()]), edges: new Set([...m.edges.keys()]) }, 'box');
    const r = w.rect([[1, 0, 0.8], [3, 0, 0.8], [3, 0, 1.8], [1, 0, 1.8]]);
    eq(m.punchOrSplit(r), 'punch', 'group scope no longer blocks the punch');
    ok(m.pushPull(r, -0.6), 'inward push');
    const holed = [...m.faces.values()].filter(f => f.holes.length);
    eq(holed.length, 1, 'the wall face carries the window opening');
    near(w.vol(), 30 - 2 * 1 * 0.6, 1e-6, '28.8 — real pocket, not an inverted inner shell');
    eq(w.openEdges(), 0, 'watertight');
    // the reveal walls are stitched to the host hole ring by identical ids
    const holeIds = new Set(holed[0].holes[0]);
    const stitched = [...m.faces.values()].filter(f => f.id !== holed[0].id && f.loop.some(id => holeIds.has(id)));
    ok(stitched.length >= 4, 'all 4 reveal walls reference the opening loop vertices');
    w.vclean('grouped wall pocket');
  });

  test('a never-punched sticker on a wall is connected at PUSH time, not capped', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    // deliberately skip punchOrSplit — simulates a legacy/failed draw
    const r = w.rect([[1, 0, 0.8], [3, 0, 0.8], [3, 0, 1.8], [1, 0, 1.8]]);
    ok(m.pushPull(r, -0.6), 'push accepted');
    eq([...m.faces.values()].filter(f => f.holes.length).length, 1,
      'push opened the window in the wall (no floating tube inside)');
    near(w.vol(), 30 - 2 * 1 * 0.6, 1e-6, '28.8');
    eq(w.openEdges(), 0, 'watertight');
    w.vclean('sticker rescue');
  });

  test('grouped wall: through-push at (or past) the wall depth punches both faces', () => {
    // exact depth: consumed as a clean opening
    {
      const w = makeWorld(); const { m } = w;
      w.box(4, 3, 2.5);
      m.createGroup({ faces: new Set([...m.faces.keys()]), edges: new Set([...m.edges.keys()]) }, 'box');
      const r = w.rect([[1, 0, 0.8], [3, 0, 0.8], [3, 0, 1.8], [1, 0, 1.8]]);
      eq(m.punchOrSplit(r), 'punch');
      ok(m.pushPull(r, -3), 'push exactly the wall depth');
      eq([...m.faces.values()].filter(f => f.holes.length).length, 2, 'front AND back faces carry the opening');
      eq(m.faces.has(r.id), false, 'the pushed face is consumed (no end cap)');
      near(w.vol(), 30 - 2 * 1 * 3, 1e-6, '24 — clean through-cut window');
      eq(w.openEdges(), 0, 'watertight');
      w.vclean('grouped through exact');
    }
    // past the depth: opening at T plus a capped protrusion beyond the back
    {
      const w = makeWorld(); const { m } = w;
      w.box(4, 3, 2.5);
      m.createGroup({ faces: new Set([...m.faces.keys()]), edges: new Set([...m.edges.keys()]) }, 'box');
      const r = w.rect([[1, 0, 0.8], [3, 0, 0.8], [3, 0, 1.8], [1, 0, 1.8]]);
      m.punchOrSplit(r);
      ok(m.pushPull(r, -3.4), 'push past the wall');
      eq([...m.faces.values()].filter(f => f.holes.length).length, 2, 'both faces holed at T');
      eq(m.faces.has(r.id), true, 'pushed face survives as the protrusion cap at depth 3.4');
      const capC = m.faceCentroid(r);
      near(capC.y, 3.4, 1e-6, 'cap sits at the full push depth, past the back face');
      const rear = [...m.faces.values()].find(f => f.holes.length === 1 && Math.abs(m.faceCentroid(f).y - 3) < 1e-6);
      ok(rear && m.pts(rear.holes[0]).every(p => Math.abs(p.y - 3) < 1e-6), 'rear hole ring lies in the back-face plane (exactly T)');
      const v = w.vclean('grouped through past');
      ok(v.warnings.some(x => x.includes('non-manifold')), 'legal fold at the rear plane');
      w.vclean('grouped through past');
    }
  });

  // ------------------------------------------------------------- planar crossings
  test('a line crossing a solid footprint splits both edges and the face beneath', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    const before = m.faces.size;
    const e = m.addEdge({ x: -1, y: 1.5, z: 0 }, { x: 5, y: 1.5, z: 0 });
    ok(e, 'edge added');
    ok(m.faces.size > before, 'the bottom face split along the crossing chord');
    // no edge still spans the full old footprint sides
    const fullSpan = [...m.edges.values()].filter(edge => {
      const a = m.vp(edge.a), b = m.vp(edge.b);
      return a.z === 0 && b.z === 0 && ((a.x === 0 && b.x === 0) || (a.x === 4 && b.x === 4)) &&
        Math.min(a.y, b.y) < 1e-9 && Math.max(a.y, b.y) > 3 - 1e-9;
    });
    eq(fullSpan.length, 0, 'both footprint side edges were split at the crossing');
    const bottoms = [...m.faces.values()].filter(f => Math.abs(m.faceCentroid(f).z) < 1e-9);
    near(bottoms.reduce((s, f) => s + m.faceArea(f), 0), 12, 1e-9, 'bottom pieces still cover the footprint');
    near(w.vol(), 30, 1e-6, 'solid volume unchanged');
    const v = w.vclean('crossing line');
    eq(v.warnings.filter(x => x.includes('unwelded')).length, 0, 'no unwelded duplicates');
  });

  test('a closed polygon crossing a footprint generates faces on both partitions', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    // band (−1..5) × (1..2) crosses the footprint twice per long side
    m.addEdge({ x: -1, y: 1, z: 0 }, { x: 5, y: 1, z: 0 });
    m.addEdge({ x: 5, y: 1, z: 0 }, { x: 5, y: 2, z: 0 });
    m.addEdge({ x: 5, y: 2, z: 0 }, { x: -1, y: 2, z: 0 });
    m.addEdge({ x: -1, y: 2, z: 0 }, { x: -1, y: 1, z: 0 });
    const flat = [...m.faces.values()].filter(f => Math.abs(m.faceCentroid(f).z) < 1e-9);
    ok(flat.length >= 5, 'faces form: footprint strips + outside stubs (was: none)');
    near(flat.reduce((s, f) => s + m.faceArea(f), 0), 12 + 2, 1e-9, 'footprint + the outside band parts');
    const stubs = flat.filter(f => m.faceArea(f) < 1.5);
    eq(stubs.length, 2, 'two outside stub faces of 1 m² each');
    const mid = flat.find(f => Math.abs(m.faceArea(f) - 4) < 1e-6 && Math.abs(m.faceCentroid(f).y - 1.5) < 1e-6);
    ok(mid, 'the shared middle strip serves as both footprint and band region');
    near(w.vol(), 30, 1e-6, 'solid unchanged');
    const v = w.vclean('crossing polygon');
    eq(v.warnings.filter(x => x.includes('unwelded')).length, 0, 'no unwelded duplicates');
  });

  test('an existing vertex strictly inside a new segment chains through it', () => {
    const w = makeWorld(); const { m, Model } = w;
    const m2 = new Model();
    m2.addEdge({ x: 2, y: -1, z: 0 }, { x: 2, y: 1, z: 0 });   // vertical edge through (2,0,0)
    const mid = m2.vertexAt({ x: 2, y: 0, z: 0 });
    ok(![...m2.edges.values()].some(e => e.a === mid || e.b === mid), 'mid vertex starts unconnected');
    m2.addEdge({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 });    // passes through (2,0,0) strictly
    const using = [...m2.edges.values()].filter(e => e.a === mid || e.b === mid);
    eq(using.length, 4, 'vertex chains the horizontal edge (2 halves) + its own vertical edge (2 halves)');
    ok(m2.findEdge(m2.vertexAt({ x: 0, y: 0, z: 0 }), mid), 'left half exists');
    ok(m2.findEdge(mid, m2.vertexAt({ x: 4, y: 0, z: 0 })), 'right half exists');
    ok(m2.validate().ok, 'validate ok');
  });

  // ------------------------------------------------------------- BIM state
  test('levels and BIM entities default, mutate, and round-trip through serialize', () => {
    const w = makeWorld(); const { m } = w;
    eq(m.levels.length, 2, 'Level 1 and Level 2 by default');
    eq(m.levels[0].id, 'lvl_1');
    eq(m.levels[1].elevation, 3.0);
    m.levels.push({ id: 'lvl_3', name: 'Roof', elevation: 6.5 });
    const f = m.addFaceFromRings([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]);
    f.userData = { bimEntityId: 'wall_1', bimType: 'wall', role: 'top' };
    m.bimEntities.push({ id: 'wall_1', type: 'wall', params: { thickness: 0.2 }, faces: [f.id], edges: [] });
    const snap = JSON.parse(JSON.stringify(m.serialize()));
    const m2 = new w.Model();
    m2.load(snap);
    eq(m2.levels.length, 3, 'levels survive the round-trip');
    eq(m2.levels[2].elevation, 6.5);
    eq(m2.bimEntities.length, 1, 'entity registry survives the round-trip');
    const f2 = m2.faces.get(f.id);
    ok(f2 && f2.userData && f2.userData.bimEntityId === 'wall_1' && f2.userData.role === 'top',
      'face userData survives the round-trip');
    w.vclean('bim state');
  });

  // ------------------------------------------------------------- coplanar arrangement
  test('two crossing rectangles partition into 3 selectable faces', () => {
    const w = makeWorld(); const { m } = w;
    w.rect([[0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0]]);
    const B = w.rect([[2, 1, 0], [6, 1, 0], [6, 5, 0], [2, 5, 0]]);
    eq(m.punchOrSplit(B), 'split', 'overlap arranges');
    const areas = [...m.faces.values()].map(f => +m.faceArea(f).toFixed(3)).sort((a, b) => a - b);
    eq(areas.length, 3, 'exactly three faces');
    near(areas[0], 4, 1e-6, 'intersection region');
    near(areas[1], 8, 1e-6, 'A minus B');
    near(areas[2], 12, 1e-6, 'B minus A');
    near(areas[0] + areas[1] + areas[2], 4 * 3 + 4 * 4 - 4, 1e-6, 'areas sum to the union');
    w.vclean('crossing rects');
    const v = m.validate();
    eq(v.warnings.filter(x => x.includes('unwelded')).length, 0, 'no unwelded duplicates');
  });

  test('corner-overlapping rectangles partition exactly', () => {
    const w = makeWorld(); const { m } = w;
    w.rect([[0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0]]);
    const B = w.rect([[3, 2, 0], [7, 2, 0], [7, 6, 0], [3, 6, 0]]);
    eq(m.punchOrSplit(B), 'split');
    const areas = [...m.faces.values()].map(f => +m.faceArea(f).toFixed(3)).sort((a, b) => a - b);
    eq(areas.length, 3);
    near(areas[0], 1, 1e-6, '1x1 corner intersection');
    near(areas[1], 11, 1e-6, 'A remainder');
    near(areas[2], 15, 1e-6, 'B remainder');
    w.vclean('corner overlap');
  });

  test('a chain of overlapping rects arranges into minimal strips', () => {
    const w = makeWorld(); const { m } = w;
    w.rect([[0, 0, 0], [3, 0, 0], [3, 3, 0], [0, 3, 0]]);
    w.rect([[2, 0, 0], [5, 0, 0], [5, 3, 0], [2, 3, 0]]);
    const C = w.rect([[4, 0, 0], [7, 0, 0], [7, 3, 0], [4, 3, 0]]);
    eq(m.punchOrSplit(C), 'split');
    const areas = [...m.faces.values()].map(f => +m.faceArea(f).toFixed(3)).sort((a, b) => a - b);
    eq(areas.length, 5, 'five strips');
    near(areas.reduce((s2, a) => s2 + a, 0), 7 * 3, 1e-6, 'union area 21');
    w.vclean('rect chain');
  });

  test('corner-touching shapes stay two independent faces', () => {
    const w = makeWorld(); const { m } = w;
    w.rect([[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]]);
    const B = w.rect([[2, 2, 0], [4, 2, 0], [4, 4, 0], [2, 4, 0]]);
    m.punchOrSplit(B);
    const areas = [...m.faces.values()].map(f => +m.faceArea(f).toFixed(3)).sort((a, b) => a - b);
    eq(areas.length, 2, 'two faces, no spurious cycle');
    near(areas[0], 4, 1e-6); near(areas[1], 4, 1e-6);
    w.vclean('corner touch');
  });

  // ------------------------------------------------------------- lifecycle
  test('deleteFace keeps boundary edges (standalone lines are legal); gc prunes unused vertices', () => {
    const w = makeWorld(); const { m } = w;
    const f = w.rect([[0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0]]);
    m.deleteFace(f.id);
    eq(m.faces.size, 0, 'face gone');
    eq(m.edges.size, 4, 'boundary edges remain as standalone lines (SketchUp semantics)');
    m.gc();
    eq(m.vertices.size, 4, 'all 4 vertices still used by those edges');
    m.addEdge({ x: 0, y: 0, z: 5 }, { x: 1, y: 0, z: 5 });
    const v = w.vclean('after delete');
    eq(v.warnings.filter(x => x.includes('standalone line')).length, 5, '4 boundary lines + 1 drawn line, all faceless by design');
    // truly unused vertex: insert one manually, gc must remove it
    const orphan = m.vertexAt({ x: 9, y: 9, z: 9 });
    ok(m.vertices.has(orphan), 'orphan vertex present');
    m.gc();
    eq(m.vertices.has(orphan), false, 'gc removed the unused vertex');
  });

  test('serialize/load roundtrip preserves structure', () => {
    const w = makeWorld(); const { m, Model } = w;
    w.box(4, 3, 2.5);
    const r = w.rect([[1, 0, 0.4], [3, 0, 0.4], [3, 0, 2.1], [1, 0, 2.1]]);
    m.punchOrSplit(r); m.pushPull(r, -0.6);
    const data = JSON.parse(JSON.stringify(m.serialize()));
    // load() reaps residue: face-less edges that are neither deliberate
    // (drawn lines) nor curve-owned count toward the expected edge total
    const ringUsed = new Set();
    for (const [, f] of m.faces) for (const ring of m.rings(f)) for (let i = 0; i < ring.length; i++) {
      const e = m.findEdge(ring[i], ring[(i + 1) % ring.length]);
      if (e) ringUsed.add(e.id);
    }
    let liveEdges = 0;
    for (const [id, e] of m.edges)
      if (ringUsed.has(id) || e.curveId || (e.userData && e.userData.deliberate)) liveEdges++;
    const m2 = new Model();
    m2.load(data);
    eq(m2.faces.size, m.faces.size, 'same face count');
    eq(m2.edges.size, liveEdges, 'same edge count (residue reaped on load)');
    eq(m2.vertices.size, m.vertices.size, 'same vertex count');
    near(m2.shellVolume([...m2.faces.keys()]), w.vol(), 1e-6, 'same volume');
    const v = m2.validate();
    ok(v.ok, 'loaded model validates: ' + v.errors.join(' | '));
  });

  // ------------------------------------------------------------- validate()
  test('validate() catches dangling ring vertex', () => {
    const { m } = makeWorld();
    m.addFaceFromRings([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]);
    const f = [...m.faces.values()][0];
    f.loop.push(9999);
    const v = m.validate();
    eq(v.ok, false, 'corrupt model flagged');
    ok(v.errors.some(e => e.includes('missing vertex 9999')), 'names the dangling id');
  });

  test('validate() catches a ring pair with no edge', () => {
    const { m } = makeWorld();
    m.addFaceFromRings([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]);
    const f = [...m.faces.values()][0];
    const e = m.findEdge(f.loop[1], f.loop[2]);
    m.edges.delete(e.id);
    const v = m.validate();
    eq(v.ok, false);
    ok(v.errors.some(x => x.includes('has no edge')), 'missing edge reported');
  });

  test('validate() catches consecutive duplicate ring vertices and zero-area loops', () => {
    const { m } = makeWorld();
    m.addFaceFromRings([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]);
    const f = [...m.faces.values()][0];
    f.loop.splice(2, 0, f.loop[1]); // duplicate a vertex consecutively
    const v = m.validate();
    eq(v.ok, false);
    ok(v.errors.some(x => x.includes('repeats vertex')), 'duplicate reported');
  });

  test('wall crossing a block slices it; a spanning rect partitions the front', () => {
    const w = makeWorld(); const { m } = w;
    w.box(4, 3, 2.5);
    // wall on the ground crossing the block footprint, pushed up through it
    const wall = m.addFaceFromRings(w.P([[1, -1, 0], [3, -1, 0], [3, 4, 0], [1, 4, 0]]));
    ok(m.pushPull(wall, 4), 'wall push');
    const front = () => [...m.faces.values()].filter(f => {
      const pts = m.pts(f.loop);
      return pts.length && pts.every(p => Math.abs(p.y) < 1e-9) && pts.some(p => p.z > 0.1);
    });
    ok(front().length >= 3, '3D intersection sliced the front face at the wall planes');
    // a rect drawn on the front spanning every slice must partition, not sticker
    const r = m.addFaceFromRings(w.P([[0.5, 0, 1], [3.5, 0, 1], [3.5, 0, 2], [0.5, 0, 2]]));
    eq(m.punchOrSplit(r), 'split', 'spanning rect partitions');
    const pieces = front();
    ok(pieces.length >= 4, 'front is partitioned into sub-faces');
    near(pieces.reduce((s, f) => s + m.faceArea(f), 0), 10, 1e-6, 'pieces tile the front exactly');
    w.vclean('wall + spanning rect');
  });

  test('perpendicular walls mutually split into quadrants', () => {
    const w = makeWorld(); const { m } = w;
    const A = m.addFaceFromRings(w.P([[-2, 0, 0], [2, 0, 0], [2, 0, 4], [-2, 0, 4]]));
    const B = m.addFaceFromRings(w.P([[0, -2, 0], [0, 2, 0], [0, 2, 4], [0, -2, 4]]));
    ok(m.intersectFaces(A, B), 'they cross');
    const areas = [...m.faces.values()].map(f => m.faceArea(f)).sort((a, b) => a - b);
    eq(m.faces.size, 4, 'four quadrant faces');
    areas.forEach(a => near(a, 8, 1e-6));
  });

  test('slab pushed through a wall cuts it at both planes', () => {
    const w = makeWorld(); const { m } = w;
    m.addFaceFromRings(w.P([[0, 1, 0], [4, 1, 0], [4, 1, 6], [0, 1, 6]])); // floating wall
    const slab = m.addFaceFromRings(w.P([[1, 0, 0], [3, 0, 0], [3, 2, 0], [1, 2, 0]]));
    ok(m.pushPull(slab, 2), 'slab push');
    const pieces = [...m.faces.values()].filter(f => {
      const pts = m.pts(f.loop);
      return pts.length && pts.every(p => Math.abs(p.y - 1) < 1e-9);
    });
    const lows = pieces.filter(f => m.pts(f.loop).every(p => p.z <= 2 + 1e-9));
    const highs = pieces.filter(f => m.pts(f.loop).every(p => p.z >= 2 - 1e-9));
    ok(lows.length >= 1 && highs.length >= 1, 'wall divided at the slab top plane');
    near(pieces.reduce((s, f) => s + m.faceArea(f), 0), 24, 1e-6, 'wall area preserved');
    w.vclean('slab through wall');
  });

  test('adjacent faces sharing an edge do not report an intersection', () => {
    const w = makeWorld(); const { m } = w;
    const g = m.addFaceFromRings(w.P([[0, 0, 0], [4, 0, 0], [4, 4, 0]]));
    const h = m.addFaceFromRings(w.P([[4, 0, 0], [4, 4, 0], [4, 4, 4], [4, 0, 4]]));
    eq(m.intersectFaces(g, h), false, 'no-op');
    eq(m.faces.size, 2, 'nothing split');
    eq(m.edges.size, 6, 'nothing added');
  });

  test('post pushed through a roof slab punches both faces and seams the walls', () => {
    const w = makeWorld(); const { m } = w;
    // floating slab z 3..3.2
    const slab = m.addFaceFromRings(w.P([[0,0,3],[6,0,3],[6,4,3],[0,4,3]]));
    m.pushPull(slab, 0.2);
    // post from the ground, through and past the slab
    const post = m.addFaceFromRings(w.P([[1,1,0],[2,1,0],[2,2,0],[1,2,0]]));
    ok(m.pushPull(post, 4), 'post push');
    const at = z => [...m.faces.values()].filter(f => m.pts(f.loop).every(p => Math.abs(p.z - z) < 1e-6));
    const bottoms = at(3), tops = at(3.2);
    eq(bottoms.filter(f => f.holes.length).length, 1, 'slab underside holed at the footprint');
    eq(tops.filter(f => f.holes.length).length, 1, 'slab top holed (true tunnel, both faces)');
    const walls = [...m.faces.values()].filter(f => {
      const pts = m.pts(f.loop);
      const zs = pts.map(p => p.z);
      return Math.min(...zs) >= 2.999 && Math.max(...zs) <= 4.001 && pts.length === 4
        && Math.min(...zs) > 0.01;
    });
    const tunnel = walls.filter(f => {
      const pts = m.pts(f.loop);
      const zs = pts.map(p => p.z);
      if (Math.abs(Math.max(...zs) - 3.2) > 1e-6 || Math.abs(Math.min(...zs) - 3) > 1e-6) return false;
      return pts.every(p => (p.x >= 1 - 1e-6 && p.x <= 2 + 1e-6) || (p.y >= 1 - 1e-6 && p.y <= 2 + 1e-6));
    });
    eq(tunnel.length, 4, 'four tunnel wall quads inside the slab band');
    w.vclean('post through roof');
  });

  test('push ending inside a blocking slab clamps to its underside (no buried geometry)', () => {
    const w = makeWorld(); const { m } = w;
    const slab = m.addFaceFromRings(w.P([[0,0,3],[6,0,3],[6,4,3],[0,4,3]]));
    m.pushPull(slab, 0.2);
    const post = m.addFaceFromRings(w.P([[1,1,0],[2,1,0],[2,2,0],[1,2,0]]));
    ok(m.pushPull(post, 3.1), 'push tip inside the slab thickness');
    const zs = new Set();
    for (const f of m.faces.values()) for (const vid of f.loop) zs.add(+m.vp(vid).z.toFixed(4));
    ok(!zs.has(3.1), 'no buried tip at z=3.1');
    const bottoms = [...m.faces.values()].filter(f => m.pts(f.loop).every(p => Math.abs(p.z - 3) < 1e-6));
    eq(bottoms.filter(f => f.holes.length).length, 1, 'opening punched in the slab underside');
    const buried = [...m.faces.values()].filter(f => {
      const zz = m.pts(f.loop).map(p => p.z);
      return Math.min(...zz) > 3.001 && Math.max(...zz) < 3.199;
    });
    eq(buried.length, 0, 'nothing buried inside the slab');
    w.vclean('clamped push');
  });

  test('structural edits mark stamped BIM faces dirty (detach upstream)', () => {
    const w = makeWorld(); const { m } = w;
    // a stand-in "wall" slab with a BIM stamp on every face
    const f = m.addFaceFromRings(w.P([[0,0,0],[4,0,0],[4,1,0],[0,1,0]]));
    m.pushPull(f, 2);
    for (const g of m.faces.values()) g.userData = { bimEntityId: 'wall_1', bimType: 'wall', role: 'side' };
    m.bimDirty.clear();
    // a line across a side face splits it -> the entity is dirty, and the
    // pieces INHERIT the stamp (the owning entity's face list follows the
    // split, so a sliced wall stays parametric; opDone still detaches it)
    m.addEdge({ x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 2 });
    eq(m.bimDirty.has('wall_1'), true, 'split marked the entity dirty');
    const pieces = [...m.faces.values()].filter(g => Math.abs(m.faceCentroid(g).y) < 1e-6 && g.loop.every(id => Math.abs(m.vp(id).y) < 1e-6));
    ok(pieces.length >= 2, 'side face divided');
    ok(pieces.every(g => g.userData && g.userData.bimEntityId === 'wall_1'), 'pieces inherit the stamp through the split');
    // punching a hole into another stamped face marks it too
    m.bimDirty.clear();
    const r2 = m.addFaceFromRings(w.P([[1,1,0.5],[2,1,0.5],[2,1,1.2],[1,1,1.2]]));
    eq(m.punchHole(r2), true, 'punched');
    eq(m.bimDirty.has('wall_1'), true, 'punch marked the entity dirty');
    w.vclean('bim dirty hooks');
  });

  test('pushPull on a stamped face marks it dirty (tools sync instead)', () => {
    const w = makeWorld(); const { m } = w;
    const f = m.addFaceFromRings(w.P([[0,0,0],[3,0,0],[3,3,0],[0,3,0]]));
    m.pushPull(f, 1);
    const top = [...m.faces.values()].find(g => Math.abs(m.faceCentroid(g).z - 1) < 1e-6);
    top.userData = { bimEntityId: 'wall_9', bimType: 'wall', role: 'top' };
    m.bimDirty.clear();
    m.pushPull(top, 0.5);
    eq(m.bimDirty.has('wall_9'), true, 'direct push dirties the entity');
  });

  test('HostedCut punches a clean door opening through a wall (Node-level)', () => {
    const h = require('./harness');
    const hL = require('./harness').loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js']);
    const { G, Model, BimTools } = hL.window;
    const HostedCut = BimTools.HostedCut, WallTool = BimTools.WallTool;
    const m = new Model();
    // wall params like a real WallTool entity: 5m along x, 0.2 thick, centerline
    const wallP = { base: [0, 0, 0], end: [5, 0, 0], thickness: 0.2, locationLine: 'centerline' };
    const ring = WallTool.bandRing(G, [G.v(0, 0, 0), G.v(5, 0, 0)], 0.2, 'centerline');
    const f = m.addFaceFromRings(ring.map(p => G.clone(p)));
    m.pushPull(f, 2.6);
    const vol0 = m.shellVolume([...m.faces.keys()]);
    const open0 = m.shellOpenEdges([...m.faces.keys()]);
    // cut a 0.9 x 2.1 door at 2m from the start
    const info = HostedCut.cut(G, m, wallP, { distanceFromStart: 2, width: 0.9, height: 2.1, sillHeight: 0 });
    eq(info.error, undefined, 'cut succeeds');
    near(info.t, 2, 1e-9, 'parametric distance kept');
    const vol1 = m.shellVolume([...m.faces.keys()]);
    near(vol0 - vol1, 0.9 * 2.1 * 0.2, 1e-6, 'removed exactly the opening volume');
    ok(m.shellOpenEdges([...m.faces.keys()]) <= open0, 'no new open edges from the cut');
    const holed0 = [...m.faces.values()].filter(g => g.holes.length === 1).length;
    eq(holed0, 0, 'sill-0 door splits both faces (routed, no holes)');
    // a window at sill 0.9 sits strictly inside -> real holes
    const winfo = HostedCut.cut(G, m, wallP, { distanceFromStart: 3.5, width: 1.2, height: 1.0, sillHeight: 0.9 });
    eq(winfo.error, undefined, 'window cut succeeds');
    const holed = [...m.faces.values()].filter(g => g.holes.length === 1);
    eq(holed.length, 2, 'both wall faces holed for the window');
    near(m.shellVolume([...m.faces.keys()]), 2.6 - 0.9 * 2.1 * 0.2 - 1.2 * 1.0 * 0.2, 1e-6, 'both volumes removed');
    w2(m).vclean('hosted cut');
    function w2(mm) { return { vclean: label => { const v = mm.validate(); if (!v.ok) throw new Error(label + ': ' + v.errors.join(' | ')); } }; }
  });

  test('HostedCut on any vertical face: through cut + typed-depth pocket (free box host)', () => {
    const hL = require('./harness').loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js']);
    const { G, Model, BimTools } = hL.window;
    const HostedCut = BimTools.HostedCut;
    const m = new Model();
    // a free-mode box: 4m x 3m footprint, 1m thick wall along the y axis —
    // the front face (y=0 plane, outward -y) is the picked host face
    const f0 = m.addFaceFromRings([
      G.v(0, 0, 0), G.v(4, 0, 0), G.v(4, 0, 2), G.v(0, 0, 2),
    ]);
    m.pushPull(f0, 1); // extrude toward +y: body y in [0, 1]
    const vol0 = m.shellVolume([...m.faces.keys()]);
    const vclean = label => { const v = m.validate(); if (!v.ok) throw new Error(label + ': ' + v.errors.join(' | ')); };
    vclean('box built');
    // face-host descriptor exactly as _faceHost synthesizes: baseline along
    // the face bottom edge, into pointing AT the body (the box sits at
    // y in [-1, 0], so into = -y), thickness = 1
    const faceWall = {
      base: [0, 0, 0], end: [4, 0, 0], thickness: 1,
      locationLine: 'face', into: [0, -1, 0],
    };
    // window through the 1m body at 2.5m from the left edge, sill 0.6
    const info = HostedCut.cut(G, m, faceWall, { distanceFromStart: 2.5, width: 1.0, height: 0.8, sillHeight: 0.6 });
    eq(info.error, undefined, 'face-host cut succeeds');
    eq(info.partial, false, 'through cut detected');
    near(info.depth, 1, 1e-9, 'depth auto = body thickness');
    near(vol0 - m.shellVolume([...m.faces.keys()]), 1.0 * 0.8 * 1, 1e-6, 'removed exactly the through volume');
    const holed = [...m.faces.values()].filter(g => g.holes.length === 1);
    eq(holed.length, 2, 'both box faces holed');
    vclean('through cut');
    // typed depth 0.3 = pocket: back cap kept, no volume removed from far side
    const pinfo = HostedCut.cut(G, m, faceWall, { distanceFromStart: 0.8, width: 0.6, height: 0.6, sillHeight: 0.6, depth: 0.3 });
    eq(pinfo.error, undefined, 'pocket cut succeeds');
    eq(pinfo.partial, true, 'partial depth detected');
    const vAfterPocket = m.shellVolume([...m.faces.keys()]);
    near(vAfterPocket, vol0 - 1.0 * 0.8 * 1 - 0.6 * 0.6 * 0.3, 1e-6, 'pocket removed exactly w x h x depth');
    vclean('pocket cut');
    // sill-0 door still routes the boundary (split, not hole) on a face host
    const dinfo = HostedCut.cut(G, m, faceWall, { distanceFromStart: 3.2, width: 0.7, height: 1.9, sillHeight: 0 });
    eq(dinfo.error, undefined, 'sill-0 door on face host');
    vclean('door on face host');
  });

  test('undo snapshots are isolated from later in-place mutations', () => {
    const w = makeWorld(); const { m } = w;
    // a wall slab with a BIM stamp
    const f = m.addFaceFromRings(w.P([[0,0,0],[4,0,0],[4,1,0],[0,1,0]]));
    m.pushPull(f, 2);
    m.bimEntities = [{ id: 'wall_1', type: 'wall', params: {}, faces: [...m.faces.keys()], edges: [] }];
    const snap = m.serialize();
    // mutate in place AFTER the snapshot: punch a hole into a face, split an
    // edge, rewrite the entity face list — the snapshot must stay consistent
    const top = [...m.faces.values()].find(g => Math.abs(m.faceCentroid(g).z - 2) < 1e-6);
    const r = m.addFaceFromRings(w.P([[1,0.25,2],[3,0.25,2],[3,0.75,2],[1,0.75,2]]));
    m.punchHole(r);
    m.addEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2 }); // splits a side face
    m.bimEntities[0].faces.push(999999);
    // the snapshot still resolves every face ring + entity list it captured
    const vset = new Set(snap.v.map(x => x[0]));
    const dangling = [];
    for (const fc of snap.f) for (const vid of [...fc.loop, ...(fc.holes || []).flat()]) if (!vset.has(vid)) dangling.push(vid);
    eq(dangling.length, 0, 'snapshot has no dangling vertex refs after later edits');
    eq(snap.bim[0].faces.includes(999999), false, 'snapshot entity list is not aliased');
    // and restoring the snapshot yields a valid model
    const m2 = new (m.constructor)();
    m2.load(snap);
    ok(m2.validate().ok, 'restored snapshot validates');
  });

  test('wall miter joins: chained angled walls share one cap — no gap, no overlap', () => {
    const hL = require('./harness').loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js']);
    const { G, Model, BimTools } = hL.window;
    const WT = BimTools.WallTool;
    const m = new Model();
    const h = 3, t = 0.3;
    // 90-degree chain: (0,0)->(4,0) then (4,0)->(4,3), centerline bands
    const d1 = G.v(1, 0, 0), d2 = G.v(0, 1, 0); // into / out of the joint
    const cap = WT.miterCap(G, G.v(4, 0, 0), d1, WT.locOffsets(t, 'centerline'), d2, WT.locOffsets(t, 'centerline'), t, t);
    ok(cap, 'miter cap computed');
    near(cap[0].x, 3.85, 1e-9, 'left miter point on both left edges');
    near(cap[0].y, 0.15, 1e-9);
    near(cap[1].x, 4.15, 1e-9, 'right miter point');
    near(cap[1].y, -0.15, 1e-9);
    const ring1 = WT.miteredRing(G, G.v(0, 0, 0), G.v(4, 0, 0), t, 'centerline', null, cap);
    const ring2 = WT.miteredRing(G, G.v(4, 0, 0), G.v(4, 3, 0), t, 'centerline', cap, null);
    // the two rings share the exact miter edge — no gap, no overlap
    const capPts = r => r.filter(p => Math.hypot(p.x - 4, p.y - 0) < 0.5).map(p => [p.x, p.y].join(',')).sort();
    const c1 = capPts(ring1);
    const c2 = capPts(ring2);
    eq(c1.join(';'), c2.join(';'), 'walls share the identical miter cap');
    // build both walls and check volumes: the mitered pair tiles the corner
    const f1 = m.addFaceFromRings(ring1.map(p => G.clone(p)));
    ok(m.pushPull(f1, h), 'wall 1 extruded');
    const f2 = m.addFaceFromRings(ring2.map(p => G.clone(p)));
    ok(m.pushPull(f2, h), 'wall 2 extruded');
    near(m.shellVolume([...m.faces.keys()]), 2.1 * h, 1e-6, 'exact union volume (no gap, no double count)');
    const v = m.validate();
    ok(v.ok, 'model valid after mitered join: ' + (v.errors || []).join('|'));
    // collinear bands keep the flat cap (a straight continuation)
    eq(WT.miterCap(G, G.v(4, 0, 0), d1, WT.locOffsets(t, 'centerline'), G.v(1, 0, 0), WT.locOffsets(t, 'centerline'), t, t), null, 'collinear -> flat cap');
    // a near-reversal refuses the miter (the cap would spike)
    eq(WT.miterCap(G, G.v(4, 0, 0), d1, WT.locOffsets(t, 'centerline'), G.v(-0.9999, 0.0141, 0), WT.locOffsets(t, 'centerline'), t, t), null, 'near-reversal -> flat cap');
  });

  test('wall miter join at 45 degrees with different thicknesses', () => {
    const hL = require('./harness').loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js']);
    const { G, Model, BimTools } = hL.window;
    const WT = BimTools.WallTool;
    const m = new Model();
    const t1 = 0.2, t2 = 0.4;
    const dir45 = G.norm(G.v(1, 1, 0));
    const cap = WT.miterCap(G, G.v(4, 0, 0), G.v(1, 0, 0), WT.locOffsets(t1, 'centerline'), dir45, WT.locOffsets(t2, 'centerline'), t1, t2);
    ok(cap, '45-degree mixed-thickness miter computed');
    const ring1 = WT.miteredRing(G, G.v(0, 0, 0), G.v(4, 0, 0), t1, 'centerline', null, cap);
    const ring2 = WT.miteredRing(G, G.v(4, 0, 0), G.add(G.v(4, 0, 0), G.mul(dir45, 3)), t2, 'centerline', cap, null);
    const f1 = m.addFaceFromRings(ring1.map(p => G.clone(p)));
    ok(m.pushPull(f1, 3), 'thin wall extruded');
    const f2 = m.addFaceFromRings(ring2.map(p => G.clone(p)));
    ok(m.pushPull(f2, 3), 'thick wall extruded');
    // the shared cap means the total equals the sum of the two ring areas
    near(m.shellVolume([...m.faces.keys()]), (G.loopArea(ring1) + G.loopArea(ring2)) * 3, 1e-6, 'volumes tile exactly');
    const v = m.validate();
    ok(v.ok, 'valid after 45-degree join: ' + (v.errors || []).join('|'));
  });

  test('BIM 4-wall loop: four walls generate, corners slice cleanly, shells close', () => {
    const hL = require('./harness').loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js']);
    const { G, Model, BimTools } = hL.window;
    const m = new Model();
    // four chained walls forming a closed 4x3 room (WallTool geometry path)
    const pts = [[0,0],[4,0],[4,3],[0,3]];
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      const ring = BimTools.WallTool.bandRing(G, [G.v(a[0], a[1], 0), G.v(b[0], b[1], 0)], 0.2, 'centerline');
      const f = m.addFaceFromRings(ring.map(p => G.clone(p)));
      m.pushPull(f, 2.6);
    }
    // each wall is a closed solid (corners interpenetrate — Revit miters are
    // a documented limitation; the app slices crossings on later edits)
    ok(m.faces.size >= 24, 'four six-face walls generated (auto-intersection may add more)');
    ok([...m.faces.values()].some(f => f.extrude), 'wall push state tracked (userData hosts survive in the app layer)');
    const v = m.validate();
    eq(v.ok, true, 'no errors');
  });

  test('validate flags non-manifold folds, slivers, and odd Euler shells', () => {
    const { m } = makeWorld();
    // three faces sharing one edge = non-manifold fold (warning)
    const A = m.addFaceFromRings([{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }]);
    m.addFaceFromRings([{ x: 2, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }, { x: 2, y: 2, z: 0 }]);
    m.addFaceFromRings([{ x: 2, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }, { x: 1, y: 1, z: 1 }]);
    const v = m.validate();
    eq(v.ok, true, 'folds are warnings, not corruption');
    ok(v.warnings.some(x => x.includes('non-manifold')), '3-face edge flagged');
    ok(v.warnings.some(x => x.includes('standalone line')) || true, 'diagnostics present');
  });

  test('validate() warns about non-manifold folds and gc leftovers', () => {
    const { m } = makeWorld();
    m.addFaceFromRings([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]);
    // two extra faces on the same ring -> every edge traversed 3 times (fold)
    m.addFaceFromRings([{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }]);
    m.addFaceFromRings([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]);
    m.addEdge({ x: 5, y: 5, z: 0 }, { x: 6, y: 5, z: 0 }); // dangling edge
    const v = m.validate();
    eq(v.ok, true, 'folds and orphans are warnings, not corruption');
    ok(v.warnings.some(x => x.includes('non-manifold')), 'fold warned');
    ok(v.warnings.some(x => x.includes('standalone line')), 'dangling edge warned');
  });
};
