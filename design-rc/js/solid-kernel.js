'use strict';
// ---------------------------------------------------------------------------
// solid-kernel.js — the boolean arithmetic, lazily loaded (browser).
//
// Manifold (Apache-2.0): the robust mesh-booleans kernel used by OpenSCAD
// and Blender, compiled to WASM (~530 KB) and vendored under js/lib/manifold.
// Loaded on first use via dynamic import() — the app boots without it.
//
// WASM cannot stream from file:// (browsers block the fetch), so Solid Tools
// need the served app (python http.server / npm run desktop / the installer);
// from a double-clicked file:// the loader reports unavailable and the UI
// explains, the way the BlenderKit palette does without its bridge.
//
// The seam SolidOps consumes (and tests inject):
//   { union(a, b), subtract(a, b), intersect(a, b) }  → soup | null
// ---------------------------------------------------------------------------
(function () {
  let cached = null;        // Promise<kernel | null>
  const FAIL_REASON = 'Solid Tools need the app served over http (or the desktop app) — the geometry kernel cannot load from file://';

  function soupToMesh(M, soup) {
    const P = soup.positions;
    const vertProperties = new Float32Array(P.length * 3);
    for (let i = 0; i < P.length; i++) {
      vertProperties[i * 3] = P[i].x; vertProperties[i * 3 + 1] = P[i].y; vertProperties[i * 3 + 2] = P[i].z;
    }
    const triVerts = new Uint32Array(soup.triangles.length * 3);
    for (let i = 0; i < soup.triangles.length; i++) {
      const t = soup.triangles[i];
      triVerts[i * 3] = t[0]; triVerts[i * 3 + 1] = t[1]; triVerts[i * 3 + 2] = t[2];
    }
    return new M.Mesh({ numProp: 3, vertProperties, triVerts });
  }

  function manifoldToSoup(man) {
    const mesh = man.getMesh();
    const np = mesh.numProp || 3;
    const vp = mesh.vertProperties;
    const positions = [];
    for (let i = 0; i < vp.length / np; i++) {
      positions.push({ x: vp[i * np], y: vp[i * np + 1], z: vp[i * np + 2] });
    }
    const tv = mesh.triVerts;
    const triangles = [];
    for (let i = 0; i < tv.length / 3; i++) {
      triangles.push([tv[i * 3], tv[i * 3 + 1], tv[i * 3 + 2]]);
    }
    return { positions, triangles, triAttrs: null };
  }

  function wrap(M) {
    const toM = soup => new M.Manifold(soupToMesh(M, soup));
    const fromM = man => {
      if (man.status().value !== 0 && man.status().value !== undefined) return null;
      const mesh = man.getMesh();
      if (!mesh.triVerts.length) return null;
      return manifoldToSoup(man);
    };
    return {
      union: (a, b) => fromM(toM(a).add(toM(b))),
      subtract: (a, b) => fromM(toM(a).subtract(toM(b))),
      intersect: (a, b) => fromM(toM(a).intersect(toM(b))),
    };
  }

  window.SolidKernel = {
    /** Promise<kernel|null> — cached; null when unavailable (file://, offline). */
    get() {
      if (cached) return cached;
      cached = import('./lib/manifold/manifold.js')
        .then(mod => mod.default())
        .then(M => { M.setup(); return wrap(M); })
        .catch(err => {
          console.warn('[solid-kernel] unavailable:', err && err.message || err);
          cached = null; // retry next time (e.g. user moves to a served context)
          return null;
        });
      return cached;
    },
    FAIL_REASON,
  };
})();
