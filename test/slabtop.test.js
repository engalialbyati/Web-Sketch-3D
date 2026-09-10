'use strict';
// ---------------------------------------------------------------------------
// slabtop.test.js — two adjacent slabs: the second slab's TOP face must not
// be suppressed. pushPull's merge semantics refuse to cap the base when the
// footprint touches ANY external face — including a merely edge-adjacent,
// COPLANAR neighbor top — so a slab drawn next to another slab extrudes with
// an open top.
// ---------------------------------------------------------------------------
module.exports = h => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { test, ok, eq } = h;

  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const sandbox = { window: {}, console };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/geometry.js', 'js/model.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const appSrc = read('js/app.js');
  const s0 = appSrc.indexOf('class BimEntityManager {'), e0 = appSrc.indexOf('\nclass App {');
  vm.runInContext(appSrc.slice(s0, e0), ctx, { filename: 'app.js#BimEntityManager' });

  const { G, Model } = sandbox.window;
  const BimEntityManager = vm.runInContext('BimEntityManager', ctx);

  const TH = 0.2, Z = 0;
  const makeWorld = () => {
    const m = new Model();
    m.bimEntities = [];
    const bim = new BimEntityManager(m);
    return { m, bim };
  };
  // the FloorTool commit shape: top ring at level Z, pushPull DOWN by th
  // (forceBaseCap — solid-creating tools close beside neighbors), roles by
  // centroid, registered slab entity
  const slab = (w, x0, y0, x1, y1) => {
    const ring = [
      G.v(x0, y0, Z), G.v(x1, y0, Z), G.v(x1, y1, Z), G.v(x0, y1, Z),
    ];
    const before = new Set(w.m.faces.keys());
    let f;
    w.m.bimHold = true;
    try {
      f = w.m.addFaceFromRings(ring.map(p => G.clone(p)));
      if (!f) throw new Error('degenerate slab boundary');
      if (!w.m.pushPull(f, -TH, true)) throw new Error('slab extrusion failed');
    } finally { w.m.bimHold = false; }
    const newFaces = [...w.m.faces.keys()].filter(id => !before.has(id)).map(id => w.m.faces.get(id));
    const roles = {};
    for (const nf of newFaces) {
      const c = w.m.faceCentroid(nf);
      roles[nf.id] = Math.abs(c.z - Z) < 1e-6 ? 'top'
        : Math.abs(c.z - (Z - TH)) < 1e-6 ? 'bottom' : 'edge';
    }
    return w.bim.create('slab', {
      baseLevel: 'lvl1', thickness: TH, source: 'sketch',
      regions: [{ outer: ring.map(p => [p.x, p.y, p.z]), holes: [] }],
    }, roles, []);
  };

  const audit = (w, ent, label) => {
    const out = { top: 0, bottom: 0, edge: 0, topArea: 0 };
    for (const fid of ent.faces) {
      const f = w.m.faces.get(fid);
      if (!f || !f.userData) continue;
      out[f.userData.role]++;
      if (f.userData.role === 'top') out.topArea += Math.abs(G.loopArea(w.m.pts(f.loop)));
    }
    console.log(`   ${label} ${ent.id}: top=${out.top} (${out.topArea.toFixed(2)} m²) bottom=${out.bottom} edge=${out.edge}`);
    return out;
  };

  test('a slab drawn next to another slab keeps its top face', () => {
    const w = makeWorld();
    const s1 = slab(w, 0, 0, 5, 5);
    const a1 = audit(w, s1, 'slab 1 (first)');
    eq(a1.top, 1, 'first slab has a top');
    ok(Math.abs(a1.topArea - 25) < 1e-6, 'first slab top is 25 m²');

    const s2 = slab(w, 5, 0, 10, 5); // shares the x=5 edge with slab 1
    const a2 = audit(w, s2, 'slab 2 (adjacent)');
    eq(a2.top, 1, 'adjacent slab has a top face (not swallowed by merge semantics)');
    ok(Math.abs(a2.topArea - 25) < 1e-6, 'adjacent slab top is 25 m²');
    eq(a2.bottom, 1, 'adjacent slab has a bottom face');
    ok(a2.edge >= 3, 'adjacent slab has its side faces');
    // the coincident side at the shared boundary heals AWAY — the two slabs
    // form one merged solid with no internal partition (and no z-fighting)
    let sharedSides = 0;
    for (const f of w.m.faces.values()) {
      const pts = w.m.pts(f.loop);
      if (pts.length && pts.every(p => Math.abs(p.x - 5) < 1e-6)) sharedSides++;
    }
    eq(sharedSides, 0, 'no internal partition on the shared boundary plane');
    ok(w.m.validate().ok, 'model valid');
  });

  test('v0.6: a foreign build never pockets another slab; its OWNER still can', () => {
    // UNNAMED hold (a different element being built): the pocket passes
    // through the host as an island — the host's top stays whole
    {
      const w = makeWorld();
      const s1 = slab(w, 0, 0, 5, 5);
      const ring = [G.v(1, 1, Z), G.v(4, 1, Z), G.v(4, 4, Z), G.v(1, 4, Z)];
      w.m.bimHold = true;
      try {
        const f = w.m.addFaceFromRings(ring.map(p => G.clone(p)));
        w.m.pushPull(f, -0.1);
      } finally { w.m.bimHold = false; }
      const s1Top = w.m.faces.get(s1.faces.find(id => {
        const q = w.m.faces.get(id);
        return q && q.userData && q.userData.role === 'top';
      }));
      ok(s1Top, 'slab 1 top still live');
      eq(s1Top.holes.length, 0, 'independence: a foreign build never punches the host');
    }
    // NAMED hold (Edit In Place on the slab itself): classic pocket — the
    // host top gets the hole at the ring
    {
      const w = makeWorld();
      const s1 = slab(w, 0, 0, 5, 5);
      const ring = [G.v(1, 1, Z), G.v(4, 1, Z), G.v(4, 4, Z), G.v(1, 4, Z)];
      w.m.bimHold = s1.id; // the owner edits itself (EIP semantics)
      try {
        const f = w.m.addFaceFromRings(ring.map(p => G.clone(p)));
        w.m.pushPull(f, -0.1);
      } finally { w.m.bimHold = false; }
      const s1Top = w.m.faces.get(s1.faces.find(id => {
        const q = w.m.faces.get(id);
        return q && q.userData && q.userData.role === 'top';
      }));
      ok(s1Top, 'slab 1 top still live');
      ok(s1Top.holes.length >= 1, "the OWNER interior push pockets its own top (EIP preserved)");
    }
  });

  test('two adjacent regions in ONE sketch both keep their tops', () => {
    const w = makeWorld();
    // the FloorTool commits all sketched regions inside one bimHold span:
    // region 2 is drawn after region 1 is already extruded, sharing its edge
    const r1 = [G.v(0, 0, Z), G.v(5, 0, Z), G.v(5, 5, Z), G.v(0, 5, Z)];
    const r2 = [G.v(5, 0, Z), G.v(10, 0, Z), G.v(10, 5, Z), G.v(5, 5, Z)];
    const before = new Set(w.m.faces.keys());
    w.m.bimHold = true;
    try {
      const f1 = w.m.addFaceFromRings(r1.map(p => G.clone(p)));
      w.m.pushPull(f1, -TH, true);
      const f2 = w.m.addFaceFromRings(r2.map(p => G.clone(p)));
      w.m.pushPull(f2, -TH, true);
    } finally { w.m.bimHold = false; }
    const tops = [...w.m.faces.values()].filter(f => {
      const pts = w.m.pts(f.loop);
      return pts.length && pts.every(p => Math.abs(p.z - Z) < 1e-6);
    });
    eq(tops.length, 2, 'both regions have top faces, got ' + tops.length);
    const area = tops.reduce((s, f) => s + Math.abs(G.loopArea(w.m.pts(f.loop))), 0);
    ok(Math.abs(area - 50) < 1e-6, 'tops cover 50 m², got ' + area.toFixed(2));
    ok(w.m.validate().ok, 'model valid');
  });

  test('free-mode pushes keep SketchUp merge semantics (no forced cap)', () => {
    const w = makeWorld();
    // two adjacent faces pushed WITHOUT forceBaseCap behave exactly as
    // before: the second push merges with the first (trim.test.js guards
    // the dissolve flow) — the flag must not leak into the default path
    const f1 = w.m.addFaceFromRings([G.v(0, 0, Z), G.v(2, 0, Z), G.v(2, 0.3, Z), G.v(0, 0.3, Z)]);
    const f2 = w.m.addFaceFromRings([G.v(2, 0, Z), G.v(5, 0, Z), G.v(5, 0.3, Z), G.v(2, 0.3, Z)]);
    ok(w.m.pushPull(f1, 2), 'first push');
    ok(w.m.pushPull(f2, 2), 'second push');
    // legacy (HEAD) behavior: adjacent pre-drawn faces merge on push —
    // NEITHER push caps its base; the flag must not leak into this path
    const base = [...w.m.faces.values()].filter(f => {
      const pts = w.m.pts(f.loop);
      return pts.length && pts.every(p => Math.abs(p.z) < 1e-6);
    });
    eq(base.length, 0, 'legacy behavior: adjacent pushes stay uncapped');
  });
};
