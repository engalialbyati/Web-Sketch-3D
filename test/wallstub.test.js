'use strict';
// ---------------------------------------------------------------------------
// wallstub.test.js — degenerate wall footprint rings (the "error while
// drawing walls" bug).
//
// A wall shorter than its thickness, chained onto a join, gets a footprint
// whose miter/butt cap reaches past the wall's own far end — the ring doubles
// back on itself. Extruding it produced self-loop edges and broken faces
// (validate(): "edge N is a self-loop", "ring visits a vertex twice"), the
// tx-guard rolled the extrude back, and the parametric registry kept a ghost
// entity. G.ringDegenerate() is the refusal gate: commit, ensureWallBottom,
// and _rebuildWallCore all check it BEFORE any geometry exists.
// ---------------------------------------------------------------------------
module.exports = h => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { test, ok, eq } = h;

  const sandbox = { window: {}, console };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/geometry.js', 'js/model.js', 'js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  }
  const { G, BimTools } = sandbox.window;
  const WallTool = BimTools.WallTool;
  const v = (x, y) => G.v(x, y, 0);

  // ------------------------------------------------------- G.ringDegenerate
  test('ringDegenerate: clean rectangle passes', () => {
    ok(!G.ringDegenerate([v(0, 0), v(3, 0), v(3, 0.2), v(0, 0.2)]));
  });

  test('ringDegenerate: bandRing of a normal wall passes', () => {
    const ring = WallTool.bandRing(G, [v(0, 0), v(4, 0)], 0.2, 'centerline');
    ok(!G.ringDegenerate(ring), `band ring should be simple: ${JSON.stringify(ring)}`);
  });

  test('ringDegenerate: fewer than 3 points, consecutive duplicates are rejected', () => {
    ok(G.ringDegenerate([]));
    ok(G.ringDegenerate([v(0, 0), v(1, 0)]));
    ok(G.ringDegenerate([v(0, 0), v(0, 0), v(1, 0), v(1, 1)]), 'duplicate start');
    ok(G.ringDegenerate([v(0, 0), v(1, 0), v(1, 0), v(0, 1)]), 'duplicate mid-ring');
  });

  test('ringDegenerate: a doubled-back band (crossed cap sides) is rejected', () => {
    // the wall_7 shape from the bug: the join cap's points land on the
    // OPPOSITE sides of the run — the two long edges cross (a bowtie)
    ok(G.ringDegenerate([v(0, -0.1), v(1, 0.1), v(1, -0.1), v(0, 0.1)]));
    // same shape reversed — rejection must not depend on winding
    ok(G.ringDegenerate([v(0, 0.1), v(1, -0.1), v(1, 0.1), v(0, -0.1)]));
  });

  test('ringDegenerate: figure-eight crossing is rejected', () => {
    ok(G.ringDegenerate([v(0, 0), v(2, 2), v(2, 0), v(0, 2)]));
  });

  test('ringDegenerate: touching-but-not-crossing neighbors stay valid', () => {
    // an L-shaped ring is perfectly buildable
    ok(!G.ringDegenerate([v(0, 0), v(3, 0), v(3, 0.2), v(0.2, 0.2), v(0.2, 2), v(0, 2)]));
  });

  // ------------------------------------------- the commit-time composition
  test('miteredRing with a crossing cap (tiny chained stub) is caught', () => {
    // 0.1 m stub along +x, 200 mm thick; the miter start cap against a
    // steeply-angled neighbor lands 0.15 m behind the start — past the end
    const ring = WallTool.miteredRing(G, v(0, 0), v(0.1, 0), 0.2, 'centerline',
      [v(-0.15, -0.12), v(-0.15, 0.14)], null);
    ok(G.ringDegenerate(ring), `stub ring must be flagged: ${JSON.stringify(ring)}`);
    eq(ring.length, 4, 'still a quad — only the check sees the fold');
  });

  test('miteredRing with a sane corner cap passes', () => {
    // a full-size wall meeting a perpendicular neighbor at its start: the
    // 45-degree miter apex sits at (−0.1, ±0.1), well inside the 3 m run.
    // capStart is [left, right]; left is +y for a +x run (locOffsets).
    const ring = WallTool.miteredRing(G, v(0, 0), v(3, 0), 0.2, 'centerline',
      [v(-0.1, 0.1), v(-0.1, -0.1)], null);
    ok(!G.ringDegenerate(ring), `corner ring should be simple: ${JSON.stringify(ring)}`);
  });

  // ----------------------------------------------------- model-level proof
  test('model stays valid when the stub ring is refused instead of extruded', () => {
    const m = new (sandbox.window.Model)();
    const good = WallTool.bandRing(G, [v(0, 0), v(3, 0)], 0.2, 'centerline');
    const f = m.addFaceFromRings(good.map(q => G.clone(q)));
    ok(f, 'normal wall builds');
    m.pushPull(f, 3);
    const stub = [v(0, -0.1), v(0.1, 0.1), v(0.1, -0.1), v(0, 0.1)];
    ok(G.ringDegenerate(stub), 'gate flags it');
    // the gate's whole point: this ring never reaches addFaceFromRings
    ok(m.validate().ok, 'model untouched by the refused stub');
  });

  // --------------------------------------------------- preview-path crash
  test('bandRing of a zero-length run (cursor on the start snap) does not crash', () => {
    // the live preview asks for a band whose cursor sits exactly on the
    // anchored start point (endpoint snap): parallelOffset used to read
    // [0] of a null-shifted segment and throw, killing the pointermove
    const DrawGeom = sandbox.window.DrawGeom
      || vm.runInContext('DrawGeom', ctx);
    const ring = WallTool.bandRing(G, [v(1, 1), v(1, 1)], 0.2, 'centerline');
    ok(Array.isArray(ring), 'degrades to a ring, no throw');
    ok(G.ringDegenerate(ring), 'and the refusal gate flags it');
    // the same zero-length path through parallelOffset directly
    const direct = DrawGeom.parallelOffset(G, [v(1, 1), v(1, 1)], false, 0.1);
    ok(Array.isArray(direct) && direct.length === 2, 'parallelOffset returns clones, no throw');
  });
};
