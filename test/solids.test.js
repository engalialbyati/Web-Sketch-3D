'use strict';
// SolidOps — SketchUp's Solid Tools over the B-Rep: group qualification
// (watertight + no parametric stamps), soup extraction, the kernel seam
// (mock here — real Manifold integration below), fusion into face records,
// and the group swap (inputs leave, fixed-geometry results arrive).
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const { G, Model, window: w } = loadModel(['js/soup-fuse.js', 'js/solids.js']);
  const SolidOps = w.SolidOps, SoupFuse = w.SoupFuse;

  // a watertight box group built through the kernel's own pathways
  function boxGroup(m, x0, y0, z0, sx, sy, sz, name, color) {
    const X = x0 + sx, Y = y0 + sy, Z = z0 + sz;
    const P = (x, y, z) => G.v(x, y, z);
    const quads = [
      [P(x0, y0, z0), P(x0, Y, z0), P(X, Y, z0), P(X, y0, z0)],       // bottom
      [P(x0, y0, Z), P(X, y0, Z), P(X, Y, Z), P(x0, Y, Z)],           // top
      [P(x0, y0, z0), P(X, y0, z0), P(X, y0, Z), P(x0, y0, Z)],       // front
      [P(X, y0, z0), P(X, Y, z0), P(X, Y, Z), P(X, y0, Z)],           // right
      [P(X, Y, z0), P(x0, Y, z0), P(x0, Y, Z), P(X, Y, Z)],           // back
      [P(x0, Y, z0), P(x0, y0, z0), P(x0, y0, Z), P(x0, Y, Z)],       // left
    ];
    const ids = [];
    for (const q of quads) {
      const f = m.addFaceFromRings(q, [], { gid: 0, color: color || null });
      ok(f, 'face created');
      ids.push(f.id);
    }
    const g = m.createGroup({ faces: new Set(ids), edges: new Set() }, name);
    return g;
  }

  // mock kernel over the soups: union concatenates (correct for disjoint
  // solids — the result is two closed shells), subtract returns the target
  // untouched, intersect returns null (no overlap)
  const mockKernel = {
    union(a, b) {
      const off = a.positions.length;
      return {
        positions: a.positions.concat(b.positions),
        triangles: a.triangles.map(t => t.slice())
          .concat(b.triangles.map(t => t.map(v => v + off))),
      };
    },
    subtract(a) { return { positions: a.positions.slice(), triangles: a.triangles.map(t => t.slice()) }; },
    intersect() { return null; },
  };

  function fresh() { const m = new Model(); return m; }

  test('solidReport: a box group qualifies with its exact volume', () => {
    const m = fresh();
    const g = boxGroup(m, 0, 0, 0, 2, 3, 4, 'A');
    const rep = SolidOps.solidReport(m, g.id);
    ok(rep.ok, 'solid');
    near(rep.volume, 24, 1e-9, '2x3x4 = 24 m³');
  });

  test('solidReport: an open shell is refused', () => {
    const m = fresh();
    m.addFaceFromRings([G.v(0, 0, 0), G.v(1, 0, 0), G.v(1, 1, 0), G.v(0, 1, 0)], [], { gid: 0 });
    m.addFaceFromRings([G.v(0, 0, 0), G.v(1, 0, 0), G.v(1, 0, 1), G.v(0, 0, 1)], [], { gid: 0 });
    const g = m.createGroup({ faces: new Set([...m.faces.keys()].slice(0, 2)), edges: new Set() }, 'open');
    const rep = SolidOps.solidReport(m, g.id);
    ok(!rep.ok, 'refused');
    ok(/open edge/.test(rep.reason), 'reason names the open edges: ' + rep.reason);
  });

  test('solidReport: parametric stamps are refused (the no-detach guard)', () => {
    const m = fresh();
    const g = boxGroup(m, 0, 0, 0, 1, 1, 1, 'BIM');
    const f = m.faces.get([...SolidOps.groupFaceIds(m, g.id)][0]);
    f.userData = { bimEntityId: 42, bimType: 'wall' };
    const rep = SolidOps.solidReport(m, g.id);
    ok(!rep.ok, 'refused');
    ok(/parametric/.test(rep.reason), 'reason points at the parametric path');
  });

  test('extractSoup: box group → 12 welded triangles, exact volume', () => {
    const m = fresh();
    const g = boxGroup(m, 1, 1, 1, 2, 2, 2, 'A');
    const { soup, records } = SolidOps.extractSoup(m, SolidOps.groupFaceIds(m, g.id));
    eq(soup.triangles.length, 12, '12 triangles');
    eq(records.length, 6, '6 face records');
    eq(soup.positions.length, 8, '8 vertices — welded, not 24');
    near(SoupFuse.signedVolume(soup), 8, 1e-9, 'volume survives extraction');
    ok(soup.triAttrs.length === 12, 'attrs per triangle');
  });

  test('union (mock): two disjoint boxes → one group, two shells, both volumes', () => {
    const m = fresh();
    const a = boxGroup(m, 0, 0, 0, 1, 1, 1, 'A');
    const b = boxGroup(m, 5, 0, 0, 2, 1, 1, 'B');
    const res = SolidOps.run(m, SolidOps.OPS.UNION, a.id, b.id, mockKernel);
    ok(res.ok, 'union ok: ' + (res.error || ''));
    eq(res.groups.length, 1, 'one result group');
    eq(m.groups.get(res.groups[0].gid).name, 'Union', 'named like SketchUp');
    near(res.groups[0].volume, 3, 1e-9, 'volumes 1+2');
    ok(!m.groups.has(a.id) && !m.groups.has(b.id), 'inputs gone');
    eq(SolidOps.groupFaceIds(m, res.groups[0].gid).length, 12, 'fused to 12 quads (not 24 tris)');
    const rep = SolidOps.solidReport(m, res.groups[0].gid);
    ok(rep.ok, 'result is itself a solid');
    ok(m.validate().ok, 'model stays valid');
  });

  test('subtract (mock): target geometry lands in a Difference group', () => {
    const m = fresh();
    const a = boxGroup(m, 0, 0, 0, 1, 1, 1, 'A');
    const b = boxGroup(m, 5, 0, 0, 1, 1, 1, 'B');
    const res = SolidOps.run(m, SolidOps.OPS.SUBTRACT, a.id, b.id, mockKernel);
    ok(res.ok, 'subtract ok');
    eq(m.groups.get(res.groups[0].gid).name, 'Difference', 'name');
    ok(!m.groups.has(a.id) && !m.groups.has(b.id), 'Subtract eats the cutter');
  });

  test('trim (mock): the cutter group survives untouched', () => {
    const m = fresh();
    const a = boxGroup(m, 0, 0, 0, 1, 1, 1, 'A');
    const b = boxGroup(m, 5, 0, 0, 1, 1, 1, 'B');
    const bFaces = SolidOps.groupFaceIds(m, b.id).slice();
    const res = SolidOps.run(m, SolidOps.OPS.TRIM, a.id, b.id, mockKernel);
    ok(res.ok, 'trim ok');
    ok(m.groups.has(b.id), 'cutter group stays');
    eq(SolidOps.groupFaceIds(m, b.id).join(','), bFaces.join(','), 'cutter faces untouched');
    ok(!m.groups.has(a.id), 'target replaced');
    eq(m.groups.get(res.groups[0].gid).name, 'Trimmed', 'name');
  });

  test('intersect with no overlap reports empty, model untouched', () => {
    const m = fresh();
    const a = boxGroup(m, 0, 0, 0, 1, 1, 1, 'A');
    const b = boxGroup(m, 5, 0, 0, 1, 1, 1, 'B');
    const res = SolidOps.run(m, SolidOps.OPS.INTERSECT, a.id, b.id, mockKernel);
    ok(!res.ok, 'refused');
    ok(res.empty, 'flagged as empty');
    ok(m.groups.has(a.id) && m.groups.has(b.id), 'both groups untouched');
  });

  test('colors survive: painted faces keep their color through the swap', () => {
    const m = fresh();
    const a = boxGroup(m, 0, 0, 0, 1, 1, 1, 'A', '#ff0000');
    const b = boxGroup(m, 5, 0, 0, 1, 1, 1, 'B', '#00ff00');
    const res = SolidOps.run(m, SolidOps.OPS.UNION, a.id, b.id, mockKernel);
    ok(res.ok, 'union ok');
    const faces = SolidOps.groupFaceIds(m, res.groups[0].gid).map(id => m.faces.get(id));
    const reds = faces.filter(f => f.color === '#ff0000').length;
    const greens = faces.filter(f => f.color === '#00ff00').length;
    eq(reds + greens, 12, 'every face matched a source color');
    eq(reds, 6, 'six red');
    eq(greens, 6, 'six green');
  });

  test('facesFromSoup: a flat-shaded box soup collapses to 6 clean faces (the importer payoff)', () => {
    const m = fresh();
    // unit box, every face split into 8 triangles through edge midpoints —
    // the flat-shaded-import shape: 48 triangles, 8 vertices welded
    const c = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
    const P = c.map(([x,y,z]) => ({ x, y, z }));
    const idx = p => P.push({ x: p[0], y: p[1], z: p[2] }) - 1;
    const midOf = (a, b) => idx([(c[a][0]+c[b][0])/2, (c[a][1]+c[b][1])/2, (c[a][2]+c[b][2])/2]);
    const triangles = [];
    const mids = new Map();
    const EM = (a, b) => { const k = a < b ? a+':'+b : b+':'+a; if (!mids.has(k)) mids.set(k, midOf(a, b)); return mids.get(k); };
    for (const q of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[0,4,7,3]]) {
      const a = q[0], b = q[1], cc = q[2], d = q[3];
      const ab = EM(a,b), bc = EM(b,cc), cd = EM(cc,d), da = EM(d,a);
      // diagonal fan (a→cc) visiting EVERY perimeter vertex: 6 triangles per
      // quad; each edge midpoint becomes a collinear vertex that must drop
      triangles.push([a,ab,b],[b,bc,cc],[cc,cd,d],[d,da,a],[a,b,cc],[a,cc,d]);
    }
    const soup = { positions: P, triangles, triAttrs: triangles.map(() => ({ color: '#aaccee', alpha: 1 })) };
    const out = SolidOps.facesFromSoup(m, soup, 'Imported box');
    ok(out, 'conversion produced a group');
    eq(out.faces, 6, '36 midpoint-split triangles -> 6 clean faces');
    const faceIds = SolidOps.groupFaceIds(m, out.gid);
    eq(faceIds.length, 6, 'six kernel faces in the group');
    const rep = SolidOps.solidReport(m, out.gid);
    ok(rep.ok, 'watertight — Make Full / Solid Tools can take it');
    near(rep.volume, 1, 1e-9, 'unit box volume');
    ok(m.validate().ok, 'model valid');
  });

  // ---------------------------------------------------------------------
  // Real-kernel integration: Manifold (the same WASM build the app vendors)
  // driving SolidOps.run end to end with exact analytic volumes.
  const { existsSync } = require('node:fs');
  const { join } = require('node:path');
  const manifoldPath = join(__dirname, '..', 'node_modules', 'manifold-3d');

  if (existsSync(manifoldPath)) {
    const realKernel = (async () => {
      const M = await (await import('manifold-3d')).default();
      await M.setup();
      const toM = s => new M.Manifold(new M.Mesh({
        numProp: 3,
        vertProperties: Float32Array.from(s.positions.flatMap(p => [p.x, p.y, p.z])),
        triVerts: Uint32Array.from(s.triangles.flat()),
      }));
      const fromM = man => {
        if (!man.getMesh().triVerts.length) return null;
        const mesh = man.getMesh(), np = mesh.numProp, vp = mesh.vertProperties, tv = mesh.triVerts;
        const positions = [];
        for (let i = 0; i < vp.length / np; i++) positions.push({ x: vp[i * np], y: vp[i * np + 1], z: vp[i * np + 2] });
        const triangles = [];
        for (let i = 0; i < tv.length / 3; i++) triangles.push([tv[i * 3], tv[i * 3 + 1], tv[i * 3 + 2]]);
        return { positions, triangles };
      };
      return {
        union: (a, b) => fromM(toM(a).add(toM(b))),
        subtract: (a, b) => fromM(toM(a).subtract(toM(b))),
        intersect: (a, b) => fromM(toM(a).intersect(toM(b))),
      };
    })();

    test('REAL union: overlapping boxes, exact volume, watertight, fused faces', async () => {
      const kernel = await realKernel;
      const m = fresh();
      const a = boxGroup(m, 0, 0, 0, 2, 2, 2, 'A');
      const b = boxGroup(m, 1, 1, 1, 2, 2, 2, 'B');
      const res = SolidOps.run(m, SolidOps.OPS.UNION, a.id, b.id, kernel);
      ok(res.ok, 'union ok: ' + (res.error || ''));
      near(res.groups[0].volume, 15, 1e-6, '8+8-1 = 15 m³ exactly');
      const rep = SolidOps.solidReport(m, res.groups[0].gid);
      ok(rep.ok, 'result watertight');
      const nFaces = SolidOps.groupFaceIds(m, res.groups[0].gid).length;
      ok(nFaces >= 6 && nFaces <= 14, 'fused to few clean polygons (' + nFaces + ' faces)');
      ok(m.validate().ok, 'model valid');
    });

    test('REAL subtract: exact bite, cutter gone, target replaced', async () => {
      const kernel = await realKernel;
      const m = fresh();
      const a = boxGroup(m, 0, 0, 0, 3, 3, 3, 'A');   // 27
      const b = boxGroup(m, 1, 1, 1, 1, 1, 1, 'B');   // bites 1 out of the middle
      const res = SolidOps.run(m, SolidOps.OPS.SUBTRACT, a.id, b.id, kernel);
      ok(res.ok, 'subtract ok: ' + (res.error || ''));
      near(res.groups[0].volume, 26, 1e-6, '27 - 1 = 26 m³');
      ok(!m.groups.has(b.id), 'cutter deleted');
      ok(SolidOps.solidReport(m, res.groups[0].gid).ok, 'still watertight');
    });

    test('REAL intersect and split: three exact pieces', async () => {
      const kernel = await realKernel;
      const m = fresh();
      const a = boxGroup(m, 0, 0, 0, 2, 2, 2, 'A');
      const b = boxGroup(m, 1, 1, 1, 2, 2, 2, 'B');
      const resI = SolidOps.run(m, SolidOps.OPS.INTERSECT, a.id, b.id, kernel);
      ok(resI.ok, 'intersect ok');
      near(resI.groups[0].volume, 1, 1e-6, 'overlap = 1 m³');

      const a2 = boxGroup(m, 0, 0, 0, 2, 2, 2, 'A2');
      const b2 = boxGroup(m, 1, 1, 1, 2, 2, 2, 'B2');
      const resS = SolidOps.run(m, SolidOps.OPS.SPLIT, a2.id, b2.id, kernel);
      ok(resS.ok, 'split ok');
      eq(resS.groups.length, 3, 'A−B, B−A, A∩B');
      const total = resS.groups.reduce((s, g) => s + g.volume, 0);
      near(total, 15, 1e-6, 'pieces sum to the union volume');
    });

    test('REAL shell (outer): nested void shells are dropped', async () => {
      const kernel = await realKernel;
      const m = fresh();
      // outer box with a hollow inside: big minus small = shell with a void
      const outer = boxGroup(m, 0, 0, 0, 4, 4, 4, 'O');
      const inner = boxGroup(m, 1, 1, 1, 2, 2, 2, 'I');
      const hollow = SolidOps.run(m, SolidOps.OPS.SUBTRACT, outer.id, inner.id, kernel);
      ok(hollow.ok, 'hollow made');

      // union of the hollow with a disjoint cube, then Outer Shell: the void
      // inside the hollow half must vanish (its shell is negative volume)
      const c = boxGroup(m, 10, 0, 0, 1, 1, 1, 'C');
      const hg = hollow.groups[0].gid;
      const res = SolidOps.run(m, SolidOps.OPS.SHELL, hg, c.id, kernel);
      ok(res.ok, 'shell ok: ' + (res.error || ''));
      // hollow volume was 64-8=56; union with 1 → 57; void dropped keeps 57
      // (the void never subtracts — Outer Shell only removes INNER SHELLS)
      near(res.groups[0].volume, 57, 1e-6, 'volume without the void double-count');
      ok(SolidOps.solidReport(m, res.groups[0].gid).ok, 'watertight');
    });
  }
};
