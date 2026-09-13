'use strict';
// ---------------------------------------------------------------------------
// gridwall.test.js — grid-driven wall trim (WallTool.gridColumnTrim /
// gridTrimFor in js/tools/bim.js).
//
// The rule under test: grids are CENTERLINES and columns are centered on the
// intersections, so a wall drawn on one grid line between two carrying
// intersections runs FACE TO FACE with the columns —
//   wall length = grid distance − column/2 − column/2
// (3 m between grids with 0.4 x 0.4 columns at both ends -> 2.598 m: face-to-face minus a 2 mm reveal that keeps the wall off the column planes).
// ---------------------------------------------------------------------------
module.exports = h => {
  const { test, ok, eq, near } = h;

  // single audited loader (harness) — static class bridge exposes GridManager
  const L = h.loadModel([
    'js/GridLine.js', 'js/GridManager.js',
    'js/SnapSystem.js', 'js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js',
  ]);
  const sandbox = L.sandbox;
  const { G, Model, BimTools } = sandbox.window;
  const WallTool = BimTools.WallTool;
  const GridManager = sandbox.window.GridManager;

  const col = (x, y, w, d, ref) => ({ type: 'column', params: { base: [x, y, 0], width: w, depth: d, gridRef: ref || null } });

  // --------------------------------............................. pure trim
  test('gridColumnTrim: 3 m between two centered 0.4 x 0.4 columns -> 2.598 m face-to-face (2 mm reveal)', () => {
    const tr = WallTool.gridColumnTrim(G, G.v(0, 0, 0), G.v(3, 0, 0), col(0, 0, 0.4, 0.4), col(3, 0, 0.4, 0.4));
    ok(tr && !tr.tooShort, 'trim applies');
    near(tr.len0, 3, 1e-9, 'grid distance');
    near(tr.len1, 3 - 0.2 - 0.2 - 0.002, 1e-9, 'wall length = spans minus faces minus 2 mm reveal');
    near(tr.a2.x, 0.201, 1e-9, 'start 1 mm off the first column face (reveal)');
    near(tr.b2.x, 2.799, 1e-9, 'end 1 mm off the second column face (reveal)');
    near(tr.a2.y, 0, 1e-9); near(tr.b2.y, 0, 1e-9);
  });

  test('gridColumnTrim: one column only -> half the deduction', () => {
    const tr = WallTool.gridColumnTrim(G, G.v(0, 0, 0), G.v(3, 0, 0), col(0, 0, 0.4, 0.4), null);
    near(tr.len1, 2.798, 1e-9);
    near(tr.a2.x, 0.201, 1e-9);
    near(tr.b2.x, 2.999, 1e-9, 'unblocked end 1 mm off the intersection (reveal)');
  });

  test('gridColumnTrim: rectangular column retreats by half its extent along the wall', () => {
    // wall along +Y past a 0.5 (x) x 0.3 (y) column: extent along y = 0.3 -> face 0.15
    const tr = WallTool.gridColumnTrim(G, G.v(0, 0, 0), G.v(0, 3, 0), col(0, 0, 0.5, 0.3), null);
    near(tr.tA, 0.15, 1e-9, 'half the extent along the run direction');
    // 45-degree run: half of |0.4*cos45| + |0.4*sin45| = 0.2*sqrt(2)
    const t45 = WallTool.gridColumnTrim(G, G.v(0, 0, 0), G.v(3 / Math.SQRT2, 3 / Math.SQRT2, 0), col(0, 0, 0.4, 0.4), null);
    near(t45.tA, 0.2 * Math.SQRT2, 1e-9, 'axis-aligned footprint support, halved');
  });

  test('gridColumnTrim: refuses when the columns consume the span', () => {
    const tr = WallTool.gridColumnTrim(G, G.v(0, 0, 0), G.v(2, 0, 0), col(0, 0, 2, 2), col(2, 0, 2, 2));
    ok(tr && tr.tooShort, 'flagged too short');
    ok(tr.len1 <= 0.05, 'nothing left of the wall');
  });

  // --------------------------------.................... grid-context lookup
  const makeWorld = () => {
    const gm = new GridManager({});
    gm.generateOrthogonal({ xSpacings: [3], ySpacings: [3], origin: [0, 0] });
    const g1 = gm.grids.find(g => g.name === '1');
    const g2 = gm.grids.find(g => g.name === '2');
    const gA = gm.grids.find(g => g.name === 'A');
    const gB = gm.grids.find(g => g.name === 'B');
    return { gm, g1, g2, gA, gB };
  };
  const appWith = (gm, entities) => {
    const app = { gridManager: gm, bim: { entities }, toasts: [], toast(m) { this.toasts.push(m); } };
    return app;
  };

  test('gridTrimFor: v0.6 — walls run intersection-to-intersection THROUGH columns', () => {
    const { gm, g1, gA, gB } = makeWorld();
    const ents = [
      col(0, 0, 0.4, 0.4, { a: g1.id, b: gA.id }),
      col(0, 3, 0.4, 0.4, { a: g1.id, b: gB.id }),
    ];
    // v0.6 ELEMENT INDEPENDENCE: no retreat to column faces — gridTrimFor is
    // a no-op; the wall overlaps the columns (grid snapping lands the ends)
    eq(WallTool.gridTrimFor(appWith(gm, ents), [G.v(0, 0, 0), G.v(0, 3, 0)]), null,
      'no trim: the wall runs through both columns');
  });

  test('gridTrimFor: positional columns are ignored too (v0.6 no-op)', () => {
    const { gm } = makeWorld();
    const ents = [col(0, 0, 0.4, 0.4), col(0, 3, 0.4, 0.4)]; // no gridRef
    eq(WallTool.gridTrimFor(appWith(gm, ents), [G.v(0, 0, 0), G.v(0, 3, 0)]), null);
  });

  test('gridTrimFor: no columns -> null (plain grid wall, no trim)', () => {
    const { gm } = makeWorld();
    eq(WallTool.gridTrimFor(appWith(gm, []), [G.v(0, 0, 0), G.v(0, 3, 0)]), null);
  });

  test('gridTrimFor: endpoint off the intersections -> null', () => {
    const { gm, g1, gA } = makeWorld();
    const ents = [col(0, 0, 0.4, 0.4, { a: g1.id, b: gA.id }), col(0, 3, 0.4, 0.4)];
    // start mid-line at y=1: neither end is an intersection-bearing run
    eq(WallTool.gridTrimFor(appWith(gm, ents), [G.v(0, 1, 0), G.v(0, 3, 0)]), null);
  });

  test('gridTrimFor: wall not on a grid -> null', () => {
    const { gm } = makeWorld();
    const ents = [col(0, 0, 0.4, 0.4), col(3, 0, 0.4, 0.4)];
    eq(WallTool.gridTrimFor(appWith(gm, ents), [G.v(1, 1, 0), G.v(1, 4, 0)]), null);
  });

  test('gridTrimFor: never toasts — the no-op is silent by contract (v0.6)', () => {
    const { gm, g1, gA, gB } = makeWorld();
    const ents = [
      col(0, 0, 3, 3, { a: g1.id, b: gA.id }),
      col(0, 3, 3, 3, { a: g1.id, b: gB.id }),
    ];
    const app = appWith(gm, ents);
    eq(WallTool.gridTrimFor(app, [G.v(0, 0, 0), G.v(0, 3, 0)]), null);
    eq(app.toasts.length, 0, 'no refusal: the wall simply runs through');
  });

  test('grid endpoints are the intersections themselves (v0.6: no retreat)', () => {
    const { gm, g1, gA, gB } = makeWorld();
    const ents = [col(0, 0, 0.4, 0.4, { a: g1.id, b: gA.id }), col(0, 3, 0.4, 0.4, { a: g1.id, b: gB.id })];
    eq(WallTool.gridTrimFor(appWith(gm, ents), [G.v(0, 0, 0), G.v(0, 3, 0)]), null,
      'no trim record — the snapped endpoints already sit on the intersections');
  });
};
