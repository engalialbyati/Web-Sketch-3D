'use strict';
// ---------------------------------------------------------------------------
// wallbottom.test.js — a closed triangle of joined walls keeps every wall's
// bottom cap. Closing the loop draws the last wall's underside over the
// plane the neighbors' caps already tile: punchOrSplit's planar arrangement
// replaces those stamped caps with fresh cells, and the walls used to lose
// their underside (dead face ids in ent.faces, orphan cells on the plane —
// open bottoms, half-selectable/half-hidable walls).
// ---------------------------------------------------------------------------
module.exports = h => {
  const { test, ok, eq } = h;

  // single audited loader (harness) — full app.js + static class bridge
  const L = h.loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/app.js']);
  const sandbox = L.sandbox;

  const { G, Model, BimTools } = sandbox.window;
  const WallTool = BimTools.WallTool;
  const BimEntityManager = sandbox.window.BimEntityManager;
  const v = (x, y, z = 0) => G.v(x, y, z);

  // ------------------------------------------------------------- the world
  const makeWorld = () => {
    const m = new Model();
    m.bimEntities = [];
    const bim = new BimEntityManager(m);
    const toasts = [];
    const app = {
      model: m, bim, toasts,
      toast(msg, isErr) { toasts.push({ msg, isErr: !!isErr }); },
      setStatus() { },
      levelManager: { getElevation: () => 0 },
      gridManager: null, structural: null,
      bimOptions: {
        thickness: 0.2, locationLine: 'centerline',
        baseLevel: 'lvl1', topConstraint: 'unconnected', unconnectedHeight: 3,
      },
      transaction: {
        begin() { return { commit() { }, rollback() { }, rolledBack: false }; },
        run(label, fn) { return fn(m); },
      },
    };
    sandbox.app = app; // bim.js's commit path reaches for the global app
    const tool = Object.create(WallTool.prototype);
    tool.app = app;
    tool.engine = { lastPickGrid: null };
    return { m, bim, app, tool, toasts };
  };

  const commit = (w, a, b) => w.tool._commit({ kind: 'line', closed: false, pts: [v(...a), v(...b)] }, 3);
  const commitClosed = (w, pts) => w.tool._commit({ kind: 'poly', closed: true, pts: pts.map(p => v(...p)) }, 3);

  // bottom faces STAMPED to one entity, with their total area
  const bottomArea = (w, ent) => {
    let area = 0, n = 0;
    for (const fid of ent.faces) {
      const f = w.m.faces.get(fid);
      if (f && f.userData && f.userData.role === 'bottom' && f.userData.bimEntityId === ent.id) {
        area += Math.abs(G.loopArea(w.m.pts(f.loop)));
        n++;
      }
    }
    return { n, area };
  };

  test('closing a triangle of joined walls: every wall keeps its bottom cap', () => {
    const w = makeWorld();
    commit(w, [0, 0, 0], [4, 0, 0]);   // wall 1
    commit(w, [4, 0, 0], [2, 3, 0]);   // wall 2 (miter at 4,0)
    commit(w, [2, 3, 0], [0, 0, 0]);   // wall 3 closes the triangle
    eq(w.bim.entities.length, 3, 'three walls');
    ok(w.m.validate().ok, 'model valid');
    ok(!w.toasts.some(t => t.isErr), 'no error toasts');
    for (const ent of w.bim.entities) {
      const p = ent.params;
      const L = Math.hypot(p.end[0] - p.base[0], p.end[1] - p.base[1]);
      const { n, area } = bottomArea(w, ent);
      ok(n >= 1, ent.id + ' has a stamped bottom face');
      // mitered caps can add corner area; the band itself must be covered
      ok(Math.abs(area - L * p.thickness) < 1e-3 || area > L * p.thickness,
        ent.id + ' bottom area ' + area.toFixed(4) + ' covers its band ' + (L * p.thickness).toFixed(4));
      // ownership is live: the wall's BOTTOM ids never go stale (stale
      // side-cap ids from miter welds self-heal at element rebuild)
      const bottomIds = ent.faces.filter(id => {
        const f = w.m.faces.get(id);
        return !f || (f.userData && f.userData.role === 'bottom');
      });
      ok(bottomIds.every(id => w.m.faces.has(id)), ent.id + ' bottom face ids are live');
    }
    // nothing anonymous left on the founding plane inside a wall's band
    for (const f of w.m.faces.values()) {
      if (f.userData) continue;
      const pts = w.m.pts(f.loop);
      if (!pts.length || !pts.every(q => Math.abs(q.z) < 1e-6)) continue;
      const c = w.m.faceCentroid(f);
      for (const ent of w.bim.entities) {
        const p = ent.params;
        const dx = c.x - p.base[0], dy = c.y - p.base[1];
        const ex = p.end[0] - p.base[0], ey = p.end[1] - p.base[1];
        const L = Math.hypot(ex, ey) || 1;
        const t = (dx * ex + dy * ey) / L;
        const s = Math.abs(dx * -ey / L + dy * ex / L);
        ok(!(t > 0.05 && t < L - 0.05 && s < p.thickness / 2),
          'no anonymous cell mid-band of ' + ent.id);
      }
    }
  });

  test('right triangle with a sharp hypotenuse corner keeps all bottoms', () => {
    const w = makeWorld();
    commit(w, [0, 0, 0], [4, 0, 0]);
    commit(w, [4, 0, 0], [4, 3, 0]);
    commit(w, [4, 3, 0], [0, 0, 0]); // closes back onto wall 1's start (~37°)
    eq(w.bim.entities.length, 3, 'three walls');
    ok(w.m.validate().ok, 'model valid');
    for (const ent of w.bim.entities) {
      const { n } = bottomArea(w, ent);
      ok(n >= 1, ent.id + ' has a stamped bottom face');
      const bottomIds = ent.faces.filter(id => {
        const f = w.m.faces.get(id);
        return !f || (f.userData && f.userData.role === 'bottom');
      });
      ok(bottomIds.every(id => w.m.faces.has(id)), ent.id + ' bottom face ids are live');
    }
  });

  test('a closed-polyline wall (one gesture) still gets its solid bottom', () => {
    const w = makeWorld();
    commitClosed(w, [[0, 0, 0], [4, 0, 0], [2, 3, 0]]);
    eq(w.bim.entities.length, 1, 'one wall entity');
    ok(w.m.validate().ok, 'model valid');
    const ent = w.bim.entities[0];
    const { n, area } = bottomArea(w, ent);
    ok(n >= 1, 'closed wall has a bottom face');
    ok(area > 5.9, 'closed triangle footprint is capped (area ' + area.toFixed(3) + ' m²)');
  });
};
