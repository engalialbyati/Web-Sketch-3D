'use strict';
// model.deleteFaces — the batch deleter. deleteFace gc's per face
// (O(model) each), so a Ctrl+A over a rebar cage was O(n^2) and froze the
// app; the batch must land in the same end state, gc exactly once, and
// leave no orphans or dangling group members.
module.exports = h => {
  const { test, ok, eq } = h;
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

  const sandbox = { window: { addEventListener() { } }, console, Buffer, setTimeout, clearTimeout };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/geometry.js', 'js/tools/base.js', 'js/model.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  const { G, Model } = sandbox.window;

  const tube = m => m.addRebarPath([G.v(0, 0, 0), G.v(0, 1, 0)], 0.016);

  test('deleteFaces: same end state as per-face deleteFace, one gc', () => {
    const A = new Model(), B = new Model();
    for (let i = 0; i < 40; i++) { tube(A); tube(B); }
    eq(A.faces.size, B.faces.size, 'same start');
    ok(A.faces.size > 400, `plenty of faces (${A.faces.size})`);
    let aGcs = 0, bGcs = 0;
    const aGc = A.gc.bind(A); A.gc = () => { aGcs++; return aGc(); };
    const bGc = B.gc.bind(B); B.gc = () => { bGcs++; return bGc(); };
    A.deleteFaces([...A.faces.keys()].slice(0, A.faces.size / 2));
    // ids are globally numbered, so B trims its OWN first half (same fraction)
    for (const id of [...B.faces.keys()].slice(0, B.faces.size / 2)) B.deleteFace(id);
    A.gc = aGc; B.gc = bGc;
    eq(aGcs, 1, 'batch gc exactly once');
    ok(bGcs > 50, `per-face path gc'd ${bGcs} times (the O(n^2) the batch fixes)`);
    eq(A.faces.size, B.faces.size, 'face counts match');
    ok(A.edges.size < B.edges.size, `batch reaps the dead tube edges (${A.edges.size} vs ${B.edges.size} left by per-face)`);
    ok(A.vertices.size < B.vertices.size, 'batch reaps orphan vertices too (%d vs %d held by leaked edges)'.replace('%d', A.vertices.size).replace('%d', B.vertices.size));
  });

  test('deleteFaces: empty and unknown ids are no-ops (no gc, no version bump)', () => {
    const m = new Model();
    tube(m);
    const v0 = m.version;
    let gcs = 0;
    const g = m.gc.bind(m); m.gc = () => { gcs++; return g(); };
    eq(m.deleteFaces([]), 0, 'empty set deletes nothing');
    eq(m.deleteFaces([999999]), 0, 'unknown id deletes nothing');
    eq(gcs, 0, 'no gc ran');
    eq(m.version, v0, 'version untouched');
    m.gc = g;
  });

  test('deleteFaces: rebar group members prune with the faces', () => {
    const m = new Model();
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(...tube(m));
    const grp = m.createGroup({ faces: new Set(ids), edges: new Set() }, 'Rebar · test');
    m.deleteFaces(ids.slice(0, Math.floor(ids.length / 2)));
    ok(m.groups.has(grp.id), 'group survives with members');
    const live = m.groupEntities(grp.id);
    ok(live.faces.size > 0, 'live members remain');
    for (const fid of live.faces) ok(m.faces.has(fid), 'every live member exists');
    // the batch also reaps the dead tube's curve-owned edges, so the
    // emptied group prunes on its own (the per-face path leaks them)
    m.deleteFaces([...live.faces]);
    ok(m.edges.size === 0, `tube edges died with the faces (${m.edges.size} left)`);
    ok(!m.groups.has(grp.id), 'empty group pruned');
  });
};
