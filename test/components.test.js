'use strict';
// Imported Components — buildSoup (component JSON → welded triangle soup)
// and the kernel placement path: a component box (quad faces, colors)
// becomes a watertight kernel group via the soup-fuse pipeline.
module.exports = h => {
  const { loadModel, test, ok, eq, near } = h;
  const { Model, window: w } = loadModel(['js/soup-fuse.js', 'js/solids.js', 'js/features/components.js']);
  const CF = w.ComponentsFeature;

  // a 2×3×1.4 box as extracted component JSON (absolute quads + a color)
  function compBox(x0, y0, z0) {
    const X = x0 + 2, Y = y0 + 3, Z = z0 + 1.4;
    const q = (a, b, c, d) => ({ v: [a, b, c, d], c: [0.62, 0.57, 0.45] });
    return {
      name: 'Test bench', credit: 'x', license: 'CC0-1.0',
      faces: [
        q([x0,y0,z0],[x0,Y,z0],[X,Y,z0],[X,y0,z0]),
        q([x0,y0,Z],[X,y0,Z],[X,Y,Z],[x0,Y,Z]),
        q([x0,y0,z0],[X,y0,z0],[X,y0,Z],[x0,y0,Z]),
        q([X,y0,z0],[X,Y,z0],[X,Y,Z],[X,y0,Z]),
        q([X,Y,z0],[x0,Y,z0],[x0,Y,Z],[X,Y,Z]),
        q([x0,Y,z0],[x0,y0,z0],[x0,y0,Z],[x0,Y,Z]),
      ],
    };
  }

  test('buildSoup: component quads → 12 welded triangles with colors', () => {
    const soup = CF.buildSoup(compBox(5, 5, 0));
    eq(soup.triangles.length, 12, '12 triangles');
    eq(soup.positions.length, 8, '8 welded vertices');
    eq(soup.triAttrs[0].color, '#9e9173', 'color carried (0.62,0.57,0.45)');
    near(w.SoupFuse.signedVolume(soup), 2 * 3 * 1.4, 1e-6, 'volume');
  });

  test('manifest carries licenses and credits for every bundled model', () => {
    eq(CF.MANIFEST.length, 6, 'six models');
    for (const c of CF.MANIFEST) {
      ok(c.file.endsWith('.json'), 'json file: ' + c.file);
      ok(/CC BY 4\.0|CC0/.test(c.credit), 'license in credit: ' + c.credit);
    }
  });

  test('place(): kernel path for a light component, offset honored', () => {
    const m = new Model();
    const app = { model: m, run: (l, fn) => fn(m), selectGroup: () => {}, view: { cam: { target: { x: 0, y: 0, z: 0 } } } };
    const res = CF.place(app, compBox(0, 0, 0), 10, 4);
    ok(res.ok, 'placed');
    eq(res.mode, 'kernel', 'light model → kernel geometry');
    eq(res.faces, 6, 'six fused faces');
    const g = m.groups.get(res.gid);
    ok(g, 'group registered');
    const faces = [...m.groupEntities(res.gid).faces];
    eq(m.shellOpenEdges(faces), 0, 'watertight');
    const bb = m.bbox([...new Set(faces.flatMap(f => m.rings(m.faces.get(f)).flat()))]);
    near(bb.min.x, 10, 1e-6, 'moved to x=10');
    near(bb.min.y, 4, 1e-6, 'moved to y=4');
    ok(m.validate().ok, 'valid');
  });

  // a clean welded box soup for the probe tests
  function boxSoup() {
    const P = [], T = [];
    const vid = (x, y, z) => {
      let i = P.findIndex(p => p.x === x && p.y === y && p.z === z);
      if (i < 0) { i = P.length; P.push({ x, y, z }); }
      return i;
    };
    const v = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(p => vid(...p));
    const quads = [[v[0],v[3],v[2],v[1]],[v[4],v[5],v[6],v[7]],[v[0],v[1],v[5],v[4]],[v[1],v[2],v[6],v[5]],[v[2],v[3],v[7],v[6]],[v[3],v[0],v[4],v[7]]];
    for (const q of quads) for (const t of [[q[0],q[1],q[2]],[q[0],q[2],q[3]]]) T.push(t);
    return { positions: P, triangles: T, triAttrs: T.map(() => ({ color: null, alpha: 1 })) };
  }

  test('kernelProbeOk: a fusion that builds an invalid B-rep is refused', () => {
    // clean box fuses into a valid solid → kernel-safe
    ok(CF.kernelProbeOk(boxSoup()), 'clean box is kernel-safe');
    // sabotage the build the way real pinched models do (glass panes sharing
    // an edge, coincident shells): a ring that visits a vertex twice fails
    // validate, and the probe must route such models to the foreign path
    const real = w.SolidOps.facesFromSoup;
    w.SolidOps.facesFromSoup = (m, soup, name) => {
      const g = real(m, soup, name);
      if (g) {
        const fid = [...m.groupEntities(g.gid).faces][0];
        const f = m.faces.get(fid);
        if (f) f.loop.splice(1, 0, f.loop[0]); // pinch: vertex visited twice
      }
      return g;
    };
    eq(CF.kernelProbeOk(boxSoup()), false, 'pinched build → not kernel-safe');
    w.SolidOps.facesFromSoup = real;
    ok(CF.kernelProbeOk(boxSoup()), 'restored → kernel-safe again');
  });
};
