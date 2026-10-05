'use strict';
// ---------------------------------------------------------------------------
// Edge Trim / Dissolve with coplanar face healing — model-level tests.
// Covers the three ownership cases behind dissolveEdge():
//   A  two coplanar faces fuse (with collinear junction welding)
//   B  two non-coplanar faces open the shell (or refuse in strict mode)
//   C  wire / single-face edges leave the graph without collateral damage
// ---------------------------------------------------------------------------
module.exports = h => {
  const { test, eq, near, ok, makeWorld } = h;

  const dividerAt = (m, G, x) =>
    m.findEdge(m.vertexAt(G.v(x, 0, 0)), m.vertexAt(G.v(x, 3, 0)));

  test('Case A: dissolving the divider heals two coplanar rects into one face', () => {
    const w = makeWorld(); const { m, G } = w;
    m.addFaceFromRings(w.P([[0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0]]));
    m.addFaceFromRings(w.P([[2, 0, 0], [4, 0, 0], [4, 3, 0], [2, 3, 0]]));
    eq(m.faces.size, 2, 'two faces before');
    const divider = dividerAt(m, G, 2);
    ok(divider, 'divider edge exists');

    const res = m.dissolveEdge(divider);
    m.gc();
    eq(res.ok, true, 'dissolve succeeds');
    eq(res.action, 'healed', 'reported as healed');
    eq(m.faces.size, 1, 'one merged face after');
    const f = [...m.faces.values()][0];
    eq(f.loop.length, 4, 'collinear junctions weld away — plain quad boundary');
    near(m.faceArea(f), 12, 1e-9, 'area preserved through the heal');
    eq(m.vertices.size, 4, 'dangling divider vertices reaped by gc');
    ok(!m.edges.has(divider.id), 'divider edge removed');
    w.vclean('healed rect');
  });

  test('Case A: junction vertices survive when the merged boundary turns there', () => {
    const w = makeWorld(); const { m, G } = w;
    // L-shaped union: the tall rect is drawn first, then the short neighbor's
    // weld splits the tall right edge so both share exactly (2,1)-(2,3)
    m.addFaceFromRings(w.P([[0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0]]));
    m.addFaceFromRings(w.P([[2, 1, 0], [4, 1, 0], [4, 3, 0], [2, 3, 0]]));
    eq(m.faces.size, 2, 'two faces before');
    const divider = m.findEdge(m.vertexAt(G.v(2, 1, 0)), m.vertexAt(G.v(2, 3, 0)));
    ok(divider, 'divider edge exists');

    const res = m.dissolveEdge(divider);
    m.gc();
    eq(res.action, 'healed', 'healed');
    eq(m.faces.size, 1, 'one merged face');
    const f = [...m.faces.values()][0];
    eq(f.loop.length, 6, 'L-shaped hexagonal boundary — turning corners kept');
    near(m.faceArea(f), 6 + 4, 1e-9, 'area preserved');
    w.vclean('healed L');
  });

  test('Case A: a junction shared with a third face is never welded away', () => {
    const w = makeWorld(); const { m, G } = w;
    // two ground rects plus a vertical wall hanging on the bottom segment the
    // weld would cross — the wall's footprint keeps that junction vertex,
    // while the unclaimed top junction welds freely
    m.addFaceFromRings(w.P([[0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0]]));
    m.addFaceFromRings(w.P([[2, 0, 0], [4, 0, 0], [4, 3, 0], [2, 3, 0]]));
    m.addFaceFromRings(w.P([[0, 0, 0], [2, 0, 0], [2, 0, 1], [0, 0, 1]]));
    eq(m.faces.size, 3, 'two rects + one wall before');
    const divider = m.findEdge(m.vertexAt(G.v(2, 0, 0)), m.vertexAt(G.v(2, 3, 0)));

    const res = m.dissolveEdge(divider);
    m.gc();
    eq(res.action, 'healed', 'faces fuse');
    eq(m.faces.size, 2, 'merged ground face + wall survive');
    const f = m.faces.get(res.merged);
    eq(f.loop.length, 5, 'guarded junction stays, free junction welds');
    ok(f.loop.includes(m.vertexAt(G.v(2, 0, 0))), 'shared junction vertex still on the perimeter');
    const wallEdge = m.findEdge(m.vertexAt(G.v(0, 0, 0)), m.vertexAt(G.v(2, 0, 0)));
    ok(wallEdge, 'the wall footprint edge survives');
    eq(m.facesAdjacentToEdge(wallEdge).length, 2, 'footprint shared by wall and merged face');
    w.vclean('guard weld');
  });

  test('Case A: strip of four rects collapses fully when all dividers go', () => {
    const w = makeWorld(); const { m, G } = w;
    for (let i = 0; i < 4; i++)
      m.addFaceFromRings(w.P([[i * 2, 0, 0], [i * 2 + 2, 0, 0], [i * 2 + 2, 3, 0], [i * 2, 3, 0]]));
    eq(m.faces.size, 4, 'four faces before');
    for (let i = 1; i <= 3; i++) {
      const res = m.dissolveEdge(dividerAt(m, G, i * 2));
      eq(res.action, 'healed', `divider ${i} heals`);
    }
    m.gc();
    eq(m.faces.size, 1, 'single face after');
    const f = [...m.faces.values()][0];
    eq(f.loop.length, 4, 'all interior junctions welded — clean quad');
    eq(m.edges.size, 4, 'only the quad boundary edges remain');
    near(m.faceArea(f), 24, 1e-9, 'area preserved');
    w.vclean('full strip collapse');
  });

  test('Case B: dissolving a box corner edge opens the shell (SketchUp behavior)', () => {
    const w = makeWorld(); const { m, G } = w;
    w.box(4, 3, 2.5);
    eq(w.openEdges(), 0, 'closed before');
    const corner = m.findEdge(m.vertexAt(G.v(4, 0, 0)), m.vertexAt(G.v(4, 0, 2.5)));
    ok(corner, 'vertical corner edge exists');

    const res = m.dissolveEdge(corner);
    m.gc();
    eq(res.ok, true, 'dissolve succeeds');
    eq(res.action, 'opened', 'reported as shell-opening');
    eq((res.removedFaces || []).length, 2, 'both non-coplanar owners removed');
    ok(w.openEdges() > 0, 'shell is open after');
    w.vclean('opened box');
  });

  test('Case B: strict mode refuses to open a closed shell', () => {
    const w = makeWorld(); const { m, G } = w;
    w.box(4, 3, 2.5);
    const facesBefore = m.faces.size;
    const corner = m.findEdge(m.vertexAt(G.v(4, 0, 0)), m.vertexAt(G.v(4, 0, 2.5)));
    const res = m.dissolveEdge(corner, { strict: true });
    eq(res.ok, false, 'refused');
    eq(res.reason, 'non-coplanar', 'reason reported');
    eq(m.faces.size, facesBefore, 'model untouched');
    eq(w.openEdges(), 0, 'shell still closed');
    w.vclean('strict refusal');
  });

  test('Case B: strict mode still heals genuinely coplanar owners', () => {
    const w = makeWorld(); const { m, G } = w;
    m.addFaceFromRings(w.P([[0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0]]));
    m.addFaceFromRings(w.P([[2, 0, 0], [4, 0, 0], [4, 3, 0], [2, 3, 0]]));
    const res = m.dissolveEdge(dividerAt(m, G, 2), { strict: true });
    eq(res.action, 'healed', 'coplanar heal is not blocked by strict');
    w.vclean('strict heal');
  });

  test('Case C: wire edge dissolves without touching faces', () => {
    const w = makeWorld(); const { m, G } = w;
    m.addFaceFromRings(w.P([[0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0]]));
    const wire = m.addEdge(G.v(5, 5, 0), G.v(6, 5, 0));
    ok(wire, 'wire edge created');
    const res = m.dissolveEdge(wire);
    m.gc();
    eq(res.action, 'wire', 'reported as wire removal');
    eq(m.faces.size, 1, 'face untouched');
    ok(!m.edges.has(wire.id), 'wire edge gone');
    w.vclean('wire dissolve');
  });

  test('Case C: single-face boundary edge takes its face with it', () => {
    const w = makeWorld(); const { m, G } = w;
    w.box(4, 3, 2.5);
    // remove one side face first, leaving its top edge single-owned
    const side = [...m.faces.values()].find(f =>
      m.pts(f.loop).every(p => Math.abs(p.x) < 1e-9) && f.loop.length === 4);
    ok(side, 'x=0 side face found');
    m.deleteFace(side.id);
    m.gc();
    const topEdge = m.findEdge(m.vertexAt(G.v(0, 0, 2.5)), m.vertexAt(G.v(0, 3, 2.5)));
    ok(topEdge, 'edge of the hole found');
    eq(m.facesAdjacentToEdge(topEdge).length, 1, 'single owner (open shell)');
    const res = m.dissolveEdge(topEdge);
    m.gc();
    eq(res.action, 'opened', 'boundary edge removal reported');
    eq((res.removedFaces || []).length, 1, 'its one owner face removed');
    w.vclean('single-owner removal');
  });

  test('dissolve prunes dead faces from live push/pull state (collapse degrades, not corrupts)', () => {
    const w = makeWorld(); const { m, G } = w;
    w.box(4, 3, 2.5);
    const top = [...m.faces.values()].find(f => m.pts(f.loop).every(p => Math.abs(p.z - 2.5) < 1e-9));
    ok(top && top.extrude, 'top face carries live extrude state');
    const sidesBefore = top.extrude.sides.length;

    const corner = m.findEdge(m.vertexAt(G.v(4, 0, 0)), m.vertexAt(G.v(4, 0, 2.5)));
    const res = m.dissolveEdge(corner); // Case B: the two side owners die
    m.gc();
    eq(res.action, 'opened', 'corner dissolved');
    eq(top.extrude.sides.length, sidesBefore - 2, 'dead side ids pruned from extrude state');
    ok(top.extrude.sides.every(id => m.faces.has(id)), 'no dangling extrude references remain');
    ok(m.pushPull(top, -2.5), 'collapse still runs');
    w.vclean('extrude prune');
  });

  test('a seam between two live push/pull owners refuses instead of eating the top faces', () => {
    const w = makeWorld(); const { m, G } = w;
    const f1 = m.addFaceFromRings(w.P([[0, 0, 0], [2, 0, 0], [2, 0.3, 0], [0, 0.3, 0]]));
    const f2 = m.addFaceFromRings(w.P([[2, 0, 0], [5, 0, 0], [5, 0.3, 0], [2, 0.3, 0]]));
    m.pushPull(f1, 2);
    m.pushPull(f2, 2);
    const facesBefore = m.faces.size;
    const topSeam = m.findEdge(m.vertexAt(G.v(2, 0, 2)), m.vertexAt(G.v(2, 0.3, 2)));
    ok(topSeam, 'top seam edge exists');
    const res = m.dissolveEdge(topSeam);
    eq(res.ok, false, 'refused');
    eq(res.reason, 'live-extrude', 'reason reported');
    eq(m.faces.size, facesBefore, 'top faces untouched');
    // side seams (no extrude of their own) heal even while pushes are live
    const frontSeam = m.findEdge(m.vertexAt(G.v(2, 0, 0)), m.vertexAt(G.v(2, 0, 2)));
    const res2 = m.dissolveEdge(frontSeam);
    eq(res2.action, 'healed', 'front seam heals while pushes are live');
    m.gc();
    w.vclean('live extrude refusal');
  });

  test('eraser path (deleteEdgeIds) heals through the same kernel', () => {
    const w = makeWorld(); const { m, G } = w;
    m.addFaceFromRings(w.P([[0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0]]));
    m.addFaceFromRings(w.P([[2, 0, 0], [4, 0, 0], [4, 3, 0], [2, 3, 0]]));
    m.deleteEdgeIds([dividerAt(m, G, 2).id]);
    eq(m.faces.size, 1, 'eraser merge via shared dissolve kernel');
    eq([...m.faces.values()][0].loop.length, 4, 'welded clean');
    w.vclean('eraser heal');
  });

  test('undo snapshot around a dissolve restores the divided state', () => {
    const w = makeWorld(); const { m, G } = w;
    m.addFaceFromRings(w.P([[0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0]]));
    m.addFaceFromRings(w.P([[2, 0, 0], [4, 0, 0], [4, 3, 0], [2, 3, 0]]));
    const snap = m.serialize();
    m.dissolveEdge(dividerAt(m, G, 2));
    m.gc();
    eq(m.faces.size, 1, 'healed');
    m.load(snap);
    eq(m.faces.size, 2, 'snapshot restores both faces');
    ok(dividerAt(m, G, 2), 'divider restored');
    w.vclean('undo restore');
  });

  test('T-junction divider: trimming the split divider heals the outer rect, spur stays a wire', () => {
    const w = makeWorld(); const { m, G } = w;
    // outer rect, full-height divider, then a dead-end spur off the divider —
    // the spur T-splits the divider into two segments, which used to break
    // the merge walk and destroy BOTH faces (empty wireframe bug)
    m.addFaceFromRings(w.P([[0, 0, 0], [6, 0, 0], [6, 3, 0], [0, 3, 0]]));
    m.addEdge(G.v(2, 0, 0), G.v(2, 3, 0));
    const spur = m.addEdge(G.v(2, 1.5, 0), G.v(4, 1.5, 0));
    eq(m.faces.size, 2, 'divider splits the rect');

    const lower = m.findEdge(m.vertexAt(G.v(2, 0, 0)), m.vertexAt(G.v(2, 1.5, 0)));
    const upper = m.findEdge(m.vertexAt(G.v(2, 1.5, 0)), m.vertexAt(G.v(2, 3, 0)));
    ok(lower && upper, 'divider split into two segments');

    const r1 = m.dissolveEdge(lower);
    eq(r1.action, 'healed', 'lower segment heals instead of destroying faces');
    m.gc();
    let f = [...m.faces.values()][0];
    eq(m.faces.size, 1, 'one face survives');
    eq(f.loop.length, 4, 'outer perimeter is the healed boundary');
    near(m.faceArea(f), 18, 1e-9, 'full rectangle area preserved');
    // the upper divider piece no longer separates anything — it stays as a
    // dangling coplanar wire overlaid on the face, not a face boundary
    ok(m.edges.has(upper.id), 'upper divider piece survives as a wire');
    eq(m.facesAdjacentToEdge(m.edges.get(upper.id)).length, 0, 'wire belongs to no face');
    ok(m.edges.has(spur.id), 'dead-end spur survives as a wire');
    eq(m.facesAdjacentToEdge(m.edges.get(spur.id)).length, 0, 'spur belongs to no face');
    w.vclean('T-junction heal');

    // dissolving the remaining wire pieces cleans them up without damage
    const r2 = m.dissolveEdge(m.edges.get(upper.id));
    const r3 = m.dissolveEdge(m.edges.get(spur.id));
    m.gc();
    eq(r2.action, 'wire', 'upper piece dissolves as a wire');
    eq(r3.action, 'wire', 'spur dissolves as a wire');
    eq(m.faces.size, 1, 'face untouched by wire cleanup');
    near(m.faceArea([...m.faces.values()][0]), 18, 1e-9, 'area still intact');
    w.vclean('wire cleanup');
  });

  test('T-junction divider: dissolving both segments in one sweep heals cleanly', () => {
    const w = makeWorld(); const { m, G } = w;
    m.addFaceFromRings(w.P([[0, 0, 0], [6, 0, 0], [6, 3, 0], [0, 3, 0]]));
    m.addEdge(G.v(2, 0, 0), G.v(2, 3, 0));
    const spur = m.addEdge(G.v(2, 1.5, 0), G.v(4, 1.5, 0));
    const lower = m.findEdge(m.vertexAt(G.v(2, 0, 0)), m.vertexAt(G.v(2, 1.5, 0)));
    const upper = m.findEdge(m.vertexAt(G.v(2, 1.5, 0)), m.vertexAt(G.v(2, 3, 0)));
    const r1 = m.dissolveEdge(lower), r2 = m.dissolveEdge(upper);
    m.gc();
    eq(r1.action, 'healed', 'first segment heals');
    eq(r2.action, 'wire', 'second is already interior after the heal');
    const f = [...m.faces.values()][0];
    eq(m.faces.size, 1, 'single healed face');
    eq(f.loop.length, 4, 'clean quad perimeter');
    near(m.faceArea(f), 18, 1e-9, 'area preserved');
    ok(m.edges.has(spur.id), 'dead-end spur still rendered as overlay wire');
    w.vclean('sweep heal');
  });

  test('dissolving the wall seams after committing pushes fuses one continuous wall', () => {
    const w = makeWorld(); const { m, G } = w;
    // two adjacent footprints; pushing both culls the inner wall but leaves
    // coplanar seam edges (front/back/top) — the divider lines trim removes
    const f1 = m.addFaceFromRings(w.P([[0, 0, 0], [2, 0, 0], [2, 0.3, 0], [0, 0.3, 0]]));
    const f2 = m.addFaceFromRings(w.P([[2, 0, 0], [5, 0, 0], [5, 0.3, 0], [2, 0.3, 0]]));
    m.pushPull(f1, 2);
    m.pushPull(f2, 2);
    m.clearExtrudes(); // commit the pushes — owners may now fuse
    ok(w.openEdges() > 0, 'seams exist before the trim');

    const seams = [
      [G.v(2, 0, 0), G.v(2, 0, 2)],     // front
      [G.v(2, 0.3, 0), G.v(2, 0.3, 2)], // back
      [G.v(2, 0, 2), G.v(2, 0.3, 2)],   // top
    ];
    const openBefore = w.openEdges();
    ok(openBefore > 0, 'seams exist before the trim');
    for (const [a, b] of seams) {
      const e = m.findEdge(m.vertexAt(a), m.vertexAt(b));
      ok(e, 'seam edge exists');
      eq(m.dissolveEdge(e).action, 'healed', 'seam heals');
    }
    m.gc();
    eq(m.faces.size, 5, 'fronts/backs/tops fused — 5 wall faces remain');
    for (const [a, b] of seams)
      ok(!m.findEdge(m.vertexAt(a), m.vertexAt(b)), 'seam edge gone');
    near(w.vol(), 5 * 0.3 * 2, 1e-6, 'volume unchanged');
    // the remaining open edges are the ground rim (adjacent pushes carry no
    // bottom caps — pre-existing engine behavior, not trim collateral)
    eq(w.openEdges(), openBefore - 2, 'only the ground rim stays open');
    w.vclean('wall seam heal');
  });
};
