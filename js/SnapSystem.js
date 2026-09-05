'use strict';
// ---------------------------------------------------------------------------
// SnapSystem — grid-aware snapping for the inference engine.
//
// Two candidate kinds, both projected onto the ACTIVE drawing elevation
// (bim mode: the current Base Level; free mode: the ground plane):
//   'gridX'     grid intersection — ETABS/Revit point target "A - 1".
//               Highest soft priority: only real geometry points (endpoints,
//               midpoints, centers) outrank it.
//   'gridline'  closest point along a grid segment ("Grid A").
//
// All distances are SCREEN pixels against the cursor, ε = 15 px. Straight
// grids use exact two-point screen projection; arcs sample their polyline.
// ---------------------------------------------------------------------------
const SnapSystem = (() => {
  const EPS_PX = 15;

  const activeZ = app =>
    app.mode === 'bim' && app.levelManager
      ? app.levelManager.getElevation(app.bimOptions.baseLevel)
      : 0;

  // screen-space distance from q to segment ab, plus the interpolated world pt
  function segScreenDist(view, q, A, B, z) {
    const sa = view.worldToScreenPixels({ x: A[0], y: A[1], z });
    const sb = view.worldToScreenPixels({ x: B[0], y: B[1], z });
    if (!sa.visible && !sb.visible) return null;
    const dx = sb.x - sa.x, dy = sb.y - sa.y;
    const L2 = dx * dx + dy * dy;
    let t = L2 < 1e-6 ? 0 : ((q.x - sa.x) * dx + (q.y - sa.y) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(sa.x + dx * t - q.x, sa.y + dy * t - q.y);
    return { d, t };
  }

  /**
   * Snap the cursor to the grid system.
   * @returns null | { kind:'gridX', p:{x,y,z}, label:'Grid Intersection: A-1',
   *                    a, b }              — a,b are GridLine instances
   *                | { kind:'gridline', p:{x,y,z}, label:'Grid A', grid }
   */
  function snap(app, ev) {
    if (!app.gridManager || !app.view) return null;
    const gm = app.gridManager;
    gm._hydrate();
    if (!gm.grids.length) return null;
    const z = activeZ(app);
    const q = app.view.clientToCanvasPixels(ev.clientX, ev.clientY);

    // 1) grid intersections — the high-priority point targets
    let best = null, bestD = EPS_PX;
    for (const ix of gm.intersections()) {
      if (!ix.a.covers(z) && !ix.b.covers(z)) continue;
      const s = app.view.worldToScreenPixels({ x: ix.p[0], y: ix.p[1], z });
      if (!s.visible) continue;
      const d = Math.hypot(s.x - q.x, s.y - q.y);
      if (d < bestD) {
        bestD = d;
        best = {
          kind: 'gridX',
          p: { x: ix.p[0], y: ix.p[1], z },
          label: `Grid Intersection: ${ix.a.name} - ${ix.b.name}`,
          a: ix.a, b: ix.b,
        };
      }
    }
    if (best) return best;

    // 2) grid lines — closest point along the (sampled) segment
    best = null; bestD = EPS_PX;
    for (const g of gm.grids) {
      if (!g.covers(z)) continue;
      const poly = g.polyline();
      let hit = null;
      for (let i = 0; i < poly.length - 1; i++) {
        const r = segScreenDist(app.view, q, poly[i], poly[i + 1], z);
        if (r && r.d < bestD) {
          bestD = r.d;
          const f = (i + r.t) / (poly.length - 1);
          hit = {
            kind: 'gridline',
            p: { x: poly[i][0] + (poly[i + 1][0] - poly[i][0]) * r.t, y: poly[i][1] + (poly[i + 1][1] - poly[i][1]) * r.t, z },
            label: `Grid ${g.name}`,
            grid: g,
          };
        }
      }
      if (hit) best = hit;
    }
    return best;
  }

  // Which grid does a planar point lie on (within tol meters)? Used when tools
  // commit: a wall whose both endpoints sit on one grid records hostGridId;
  // a column landing on an intersection records gridRef {a,b}.
  function gridUnder(gm, pt, tol = 0.03) {
    let best = null, bestD = tol;
    for (const g of gm.grids) {
      const d = g.distance(pt);
      if (d < bestD) { bestD = d; best = g; }
    }
    return best;
  }

  function intersectionAt(gm, pt, tol = 0.03) {
    for (const ix of gm.intersections()) {
      if (Math.hypot(ix.p[0] - pt[0], ix.p[1] - pt[1]) <= tol) return ix;
    }
    return null;
  }

  return { snap, gridUnder, intersectionAt, EPS_PX, activeZ };
})();

if (typeof module !== 'undefined') module.exports = { SnapSystem };
