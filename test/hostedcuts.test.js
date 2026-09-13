'use strict';
// ---------------------------------------------------------------------------
// hostedcuts.test.js — the three hosted-opening regressions:
//  1. "if I draw a door then delete it, the wall is gone" — the element's
//     edge stamps included the SHARED notch borders (edges the wall's own
//     faces reference), so deleting the element cascade-deleted the wall.
//     The delete path now heals the host (detach → drop faces → gc →
//     rebuildWallWithHosts) and _placeOne stamps only EXCLUSIVE edges.
//  2. "the window has no opening on the wall" / "the opening just makes a
//     box" — the display registry's dirty signature was face-IDS only; a
//     hosted cut rewrites the host face's loop in place (same id), so the
//     wall's mesh never regenerated: the cut was invisible while the fresh
//     reveal band rendered like a glued-on box. faceSig covers geometry.
// ---------------------------------------------------------------------------
module.exports = h => {
  const { test, ok, eq, near } = h;

  // single audited loader (harness) — full app.js + static class bridge
  const L = h.loadModel(['js/tools/base.js', 'js/tools/draw.js', 'js/tools/bim.js', 'js/BimElement.js', 'js/app.js']);
  const sandbox = L.sandbox;
  const { G, Model, StructuralManager, BimTools } = sandbox.window;
  const { WallTool, DoorTool, WindowTool, OpeningTool } = BimTools;
  const BimEntityManager = sandbox.window.BimEntityManager;
  const Registry = sandbox.window.BimElementRegistry;

  const STORY = 3;
  const makeWorld = () => {
    const m = new Model();
    m.bimEntities = [];
    m.levels = [{ id: 'lvl_1', name: 'L1', elevation: 0 }];
    const bim = new BimEntityManager(m);
    const app = {
      model: m, bim,
      toast() { }, setStatus() { },
      bimOptions: { hosted: {} },
      families: null, // default HostedCut.frame path
      view: { clearPreview() { } },
      transaction: { run: (name, fn) => fn(m) },
      levelManager: {
        levels: m.levels,
        getElevation: id => { const l = m.levels.find(x => x.id === id); return l ? l.elevation : 0; },
        getLevel: id => m.levels.find(x => x.id === id),
      },
      structural: new StructuralManager(() => m.levels, () => m.bimEntities),
    };
    sandbox.window.app = app;
    const wall = (A2, B2, opts) => {
      const p = Object.assign({
        base: A2, end: B2, height: STORY, thickness: 0.2,
        locationLine: 'centerline', primitive: 'line', closed: false, joins: { start: 0, end: 0 },
      }, opts);
      const before = new Set(m.faces.keys());
      m.bimHold = true;
      try {
        const ring = WallTool.bandRing(G, [G.v(...A2), G.v(...B2)], p.thickness, 'centerline');
        if (!m.pushPull(m.addFaceFromRings(ring), p.height)) throw new Error('wall sweep failed');
      } finally { m.bimHold = false; }
      const nf = [...m.faces.keys()].filter(id => !before.has(id))
        .map(id => m.faces.get(id)).filter(f => f && !f.userData);
      const roles = {}; for (const f of nf) roles[f.id] = 'side';
      const edges = [];
      for (const f of nf) for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
        const e = m.findEdge(r[i], r[(i + 1) % r.length]);
        if (e && !e.userData) edges.push(e.id);
      }
      return bim.create('wall', JSON.parse(JSON.stringify(p)), roles, [...new Set(edges)]);
    };
    const place = (ToolClass, host, dist, specOver) => {
      const tool = new ToolClass(app);
      tool.activate();
      if (specOver) Object.assign(tool.spec, specOver);
      ok(tool._placeOne(m, host, dist), `${ToolClass.name} placement at ${dist}`);
      return bim.entities.find(e => e.type === ToolClass.id);
    };
    // App.deleteSelection's hosted branch, minus the UI
    const deleteHosted = ent => {
      const hostId = ent.params.hostWallId;
      const faces = [...ent.faces];
      bim.detach(ent.id);
      for (const fid of faces) m.faces.delete(fid);
      m.gc();
      ok(bim.rebuildWallWithHosts(hostId), 'host wall rebuilds (heals)');
    };
    return { m, bim, app, wall, place, deleteHosted };
  };

  const sigOf = (ent, w) => Registry.faceSig(w.m, ent);
  const healed = (w, wallEnt) => {
    // every face back to a clean rectangle, areas exactly the sweep's
    const faces = wallEnt.faces.map(id => w.m.faces.get(id)).filter(Boolean);
    eq(faces.length, 6, 'healed wall has its 6 sweep faces');
    for (const f of faces) { eq(f.loop.length, 4, 'healed face is a 4-vertex rect'); eq(f.holes.length, 0, 'no holes'); }
    const areas = faces.map(f => w.m.faceArea(f)).sort((a, b) => a - b);
    near(areas[0], 0.2 * STORY, 1e-6, 'cap area');
    near(areas[1], 0.2 * STORY, 1e-6, 'cap area');
    near(areas[2], 1.2, 1e-6, 'top/bottom area (6 × 0.2)');
    near(areas[3], 1.2, 1e-6, 'top/bottom area (6 × 0.2)');
    near(areas[4], 6 * STORY, 1e-6, 'side area');
    near(areas[5], 6 * STORY, 1e-6, 'side area');
    ok(w.m.validate().ok, 'model validates after heal');
  };

  test('a placed door notches the wall and stamps ONLY exclusive edges', () => {
    const w = makeWorld();
    const wall = w.wall([0, 0, 0], [6, 0, 0]);
    const before = sigOf(wall, w);
    const door = w.place(DoorTool, { kind: 'wall', ent: wall }, 2.0);
    ok(door, 'door entity registered');
    eq(door.params.hostWallId, wall.id, 'parametric host link');
    ok(door.faces.length >= 6, 'frame + leaf + reveal faces');
    // the wall's side faces carry the notch (grew loops or gained holes)
    const wallFaces = wall.faces.map(id => w.m.faces.get(id)).filter(Boolean);
    const notched = wallFaces.filter(f => f.loop.length > 4 || f.holes.length);
    ok(notched.length >= 1, `host face carries the cut (${notched.length} notched)`);
    // CASCADE GUARD: every stamped edge is referenced exclusively by door faces
    const doorFaces = new Set(door.faces);
    for (const eid of door.edges) {
      const e = w.m.edges.get(eid);
      ok(e, `edge ${eid} exists`);
      const adj = w.m.facesAdjacentToEdge(e);
      ok(adj.length > 0 && adj.every(f => doorFaces.has(f.id)),
        `edge ${eid} is exclusive to the door (adjacent: ${adj.map(f => f.userData && f.userData.bimEntityId)})`);
    }
    // and the SHARED notch borders really are shared (they exist, adjacent to
    // both a wall face and a door face) — those must NOT be in door.edges
    const shared = [];
    for (const e of w.m.edges.values()) {
      const adj = w.m.facesAdjacentToEdge(e);
      const ids = new Set(adj.map(f => f.userData && f.userData.bimEntityId));
      if (ids.has(wall.id) && ids.has(door.id)) shared.push(e.id);
    }
    ok(shared.length >= 4, `notch borders are shared geometry (${shared.length} edges)`);
    for (const eid of shared) ok(!door.edges.includes(eid), `shared edge ${eid} not stamped to the door`);
    // DISPLAY SIGNATURE: the wall's sig changed although its face ids didn't
    ok(sigOf(wall, w) !== before, 'faceSig tracks the in-place loop rewrite');
    ok(w.m.validate().ok, 'model validates with the door cut');
  });

  test('deleting a hosted door heals the wall (deleteSelection sequence)', () => {
    const w = makeWorld();
    const wall = w.wall([0, 0, 0], [6, 0, 0]);
    const door = w.place(DoorTool, { kind: 'wall', ent: wall }, 2.0);
    w.deleteHosted(door);
    eq(w.bim.entities.filter(e => e.type === 'door').length, 0, 'door entity gone');
    ok(w.bim.entities.includes(wall), 'wall entity survives');
    healed(w, wall);
    ok(sigOf(wall, w) === sigOf(wall, w), 'sig stable when idle');
  });

  test('deleting ONE door re-cuts the survivors on the same wall', () => {
    const w = makeWorld();
    const wall = w.wall([0, 0, 0], [6, 0, 0]);
    w.place(DoorTool, { kind: 'wall', ent: wall }, 1.5);
    w.place(DoorTool, { kind: 'wall', ent: wall }, 4.5);
    const doors = w.bim.entities.filter(e => e.type === 'door');
    eq(doors.length, 2, 'two doors placed');
    const [a, b] = doors;
    w.deleteHosted(b);
    const aAfter = w.bim.entities.find(e => e.id === a.id);
    ok(aAfter && aAfter.faces.length >= 6, `surviving door re-cut (${aAfter && aAfter.faces.length} faces)`);
    const wallFaces = wall.faces.map(id => w.m.faces.get(id)).filter(Boolean);
    ok(wallFaces.some(f => f.loop.length > 4 || f.holes.length), 'survivor notch re-cut into the rebuilt wall');
    ok(w.m.validate().ok, 'model validates');
  });

  test('window: cut + exclusive stamps + heal', () => {
    const w = makeWorld();
    const wall = w.wall([0, 0, 0], [6, 0, 0]);
    const win = w.place(WindowTool, { kind: 'wall', ent: wall }, 3.0);
    ok(win, 'window entity registered');
    eq(win.params.sillHeight, 0.9, 'window default sill');
    const wallFaces = wall.faces.map(id => w.m.faces.get(id)).filter(Boolean);
    const holed = wallFaces.filter(f => f.holes.length === 1);
    eq(holed.length, 2, 'both wall faces carry the interior window hole');
    near(w.m.faceArea(holed[0]), 6 * STORY - 1.2 * 1.5, 1e-6, 'net area = gross − window');
    const winFaces = new Set(win.faces);
    for (const eid of win.edges) {
      const adj = w.m.facesAdjacentToEdge(w.m.edges.get(eid));
      ok(adj.every(f => winFaces.has(f.id)), 'window edge exclusive');
    }
    w.deleteHosted(win);
    healed(w, wall);
  });

  test('wall opening: pure hole, no frame — and it heals too', () => {
    const w = makeWorld();
    const wall = w.wall([0, 0, 0], [6, 0, 0]);
    const op = w.place(OpeningTool, { kind: 'wall', ent: wall }, 4.5);
    ok(op, 'opening entity registered');
    ok(op.faces.length >= 4, 'reveal band only (no frame faces)');
    const wallFaces = wall.faces.map(id => w.m.faces.get(id)).filter(Boolean);
    ok(wallFaces.some(f => f.loop.length > 4 || f.holes.length), 'wall carries the opening');
    w.deleteHosted(op);
    healed(w, wall);
  });
};
