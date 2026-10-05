'use strict';
// ---------------------------------------------------------------------------
// soup-fuse.js — triangle soup → clean polygon faces.
//
// The boolean kernel returns raw triangles; the model wants SketchUp-style
// polygon faces (outer ring + holes). This pass merges the coplanar,
// same-attribute triangles back into regions and traces their boundaries:
//
//   · bucket triangles by (plane, attrs) — G.planeKey quantization
//   · union-find regions via shared edges (exact vertex-index pairs: kernel
//     output is indexed, so shared edges share indices bit-exactly)
//   · a region's boundary is its directed edges used exactly once; every
//     boundary vertex has one out + one in edge, so loops trace by following
//     the chain. Anything irregular (non-manifold edge use, a vertex of
//     degree ≠ 2) bails that region to its raw triangles — the pass only
//     ever merges what it can prove clean, and never loses geometry.
//   · loops wound WITH the plane normal are outer candidates (largest wins),
//     loops wound against it are holes
//   · corners every ring passes straight through are dropped (the
//     triangulation left them along edges; SketchUp's results have none)
//
// Also the soup-level shell utilities the solid tools need: signed volume,
// outward winding fix, and inner-void dropping (Outer Shell).
//
// Pure module: G only, no DOM, no THREE — runs in the headless test sandbox.
// ---------------------------------------------------------------------------
(function () {
  const API = {};

  // ------------------------------------------------------------ shell utils

  /** Σ det(a,b,c)/6 over all triangles (m³, signed). */
  API.signedVolume = function (soup) {
    const P = soup.positions;
    let v = 0;
    for (const t of soup.triangles) {
      const a = P[t[0]], b = P[t[1]], c = P[t[2]];
      v += (a.x * (b.y * c.z - b.z * c.y)
        - a.y * (b.x * c.z - b.z * c.x)
        + a.z * (b.x * c.y - b.y * c.x)) / 6;
    }
    return v;
  };

  /** Flip every triangle (2,1,0) when the soup's signed volume is negative —
   *  the boolean kernel expects outward-facing (CCW from outside) input. */
  API.ensureOutward = function (soup) {
    if (API.signedVolume(soup) < 0) {
      for (const t of soup.triangles) { const tmp = t[1]; t[1] = t[2]; t[2] = tmp; }
    }
    return soup;
  };

  /** Union-find triangles into shells via shared undirected edges, then drop
   *  every shell whose signed volume is negative — an inner void is a
   *  connected shell wound the other way (Outer Shell's rule). */
  API.dropInnerShells = function (soup) {
    const tris = soup.triangles;
    const parent = tris.map((_, i) => i);
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const edgeOwner = new Map(); // undirected key -> triangle index
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      for (let e = 0; e < 3; e++) {
        const a = t[e], b = t[(e + 1) % 3];
        const k = a < b ? a + ':' + b : b + ':' + a;
        const other = edgeOwner.get(k);
        if (other === undefined) edgeOwner.set(k, i);
        else parent[find(i)] = find(other);
      }
    }
    const volByRoot = new Map();
    for (let i = 0; i < tris.length; i++) {
      const r = find(i);
      if (!volByRoot.has(r)) volByRoot.set(r, 0);
      const P = soup.positions, t = tris[i];
      const a = P[t[0]], b = P[t[1]], c = P[t[2]];
      volByRoot.set(r, volByRoot.get(r) +
        (a.x * (b.y * c.z - b.z * c.y)
          - a.y * (b.x * c.z - b.z * c.x)
          + a.z * (b.x * c.y - b.y * c.x)) / 6);
    }
    let dropped = false;
    for (const v of volByRoot.values()) if (v < 0) { dropped = true; break; }
    if (!dropped) return soup;
    const keep = tris.map((_, i) => volByRoot.get(find(i)) > 0);
    soup.triangles = tris.filter((_, i) => keep[i]);
    if (soup.triAttrs) soup.triAttrs = soup.triAttrs.filter((_, i) => keep[i]);
    return soup;
  };

  // ------------------------------------------------------------ fuse

  function newellNormal(pts) {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const p = pts[j], q = pts[i];
      nx += (p.y - q.y) * (p.z + q.z);
      ny += (p.z - q.z) * (p.x + q.x);
      nz += (p.x - q.x) * (p.y + q.y);
    }
    return { x: nx, y: ny, z: nz };
  }

  function attrsKey(attrs) {
    if (!attrs) return '';
    return (attrs.color == null ? '-' : attrs.color) + '|' + (attrs.alpha == null ? 1 : attrs.alpha);
  }

  /** Corners every ring passes straight through are not corners. Mutates the
   *  ring in place; keeps at least 3 vertices. */
  function dropCollinear(ring) {
    if (ring.length < 4) return;
    const keep = [];
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const p0 = ring[(i - 1 + n) % n], p1 = ring[i], p2 = ring[(i + 1) % n];
      const d1 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
      const d2 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
      const cx = d1.y * d2.z - d1.z * d2.y, cy = d1.z * d2.x - d1.x * d2.z, cz = d1.x * d2.y - d1.y * d2.x;
      const cross = Math.sqrt(cx * cx + cy * cy + cz * cz);
      const l1 = Math.sqrt(d1.x * d1.x + d1.y * d1.y + d1.z * d1.z);
      const l2 = Math.sqrt(d2.x * d2.x + d2.y * d2.y + d2.z * d2.z);
      const straight = cross <= 1e-9 * Math.max(l1 * l2, 1e-12) * 1e3
        && (d1.x * d2.x + d1.y * d2.y + d1.z * d2.z) > 0;
      if (!straight) keep.push(p1);
    }
    if (keep.length >= 3 && keep.length < n) ring.length = 0, ring.push(...keep);
  }

  /**
   * Fuse a triangle soup into polygon face records.
   * @param {object} soup { positions:[{x,y,z}], triangles:[[i,j,k]],
   *                        triAttrs:[{color,alpha}]? }
   * @returns {Array<{outer:[{x,y,z}], holes:[[{x,y,z}]], attrs}>}
   */
  API.fuse = function (soup) {
    const out = [];
    const P = soup.positions, T = soup.triangles, A = soup.triAttrs || null;

    // bucket by (plane, attrs), skipping degenerate triangles
    const buckets = new Map();
    for (let i = 0; i < T.length; i++) {
      const a = P[T[i][0]], b = P[T[i][1]], c = P[T[i][2]];
      const plane = G.planeFromPoints(a, b, c);
      if (!plane) continue; // degenerate
      const key = G.planeKey(plane) + '/' + attrsKey(A ? A[i] : null);
      let bk = buckets.get(key);
      if (!bk) { bk = { plane, tris: [] }; buckets.set(key, bk); }
      bk.tris.push(i);
    }

    for (const bk of buckets.values()) {
      // undirected edge use within the bucket + union-find over triangles
      const edgeUse = new Map();  // "a:b" -> [{tri, a, b}] one entry per use
      const parent = new Map();
      const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
      for (const ti of bk.tris) parent.set(ti, ti);
      const tainted = new Set();
      for (const ti of bk.tris) {
        const t = T[ti];
        for (let e = 0; e < 3; e++) {
          const va = t[e], vb = t[(e + 1) % 3];
          if (va === vb) { tainted.add(ti); continue; }
          const k = va < vb ? va + ':' + vb : vb + ':' + va;
          let uses = edgeUse.get(k);
          if (!uses) { uses = []; edgeUse.set(k, uses); }
          uses.push({ tri: ti, a: va, b: vb });
        }
      }
      for (const uses of edgeUse.values()) {
        if (uses.length === 2) parent.set(find(uses[0].tri), find(uses[1].tri));
        else if (uses.length > 2) for (const u of uses) tainted.add(u.tri);
      }

      // group triangles into regions
      const regions = new Map();
      for (const ti of bk.tris) {
        if (tainted.has(ti)) continue;
        const r = find(ti);
        let arr = regions.get(r);
        if (!arr) { arr = { tris: [], bail: false }; regions.set(r, arr); }
        arr.tris.push(ti);
      }
      for (const ti of tainted) {
        let arr = regions.get('taint');
        if (!arr) { arr = { tris: [], bail: true }; regions.set('taint', arr); }
        arr.tris.push(ti);
      }

      for (const region of regions.values()) {
        if (region.bail || region.tris.length === 0) {
          emitRaw(region.tris, out, P, T, A);
          continue;
        }
        // boundary = directed edges used exactly once (undirected count 1)
        const undirected = new Map();
        const directed = [];
        for (const ti of region.tris) {
          const t = T[ti];
          for (let e = 0; e < 3; e++) {
            const va = t[e], vb = t[(e + 1) % 3];
            const k = va < vb ? va + ':' + vb : vb + ':' + va;
            undirected.set(k, (undirected.get(k) || 0) + 1);
            directed.push([va, vb]);
          }
        }
        const outEdges = new Map(); // vertex -> [target,...]
        let clean = true;
        for (let i = 0; i < directed.length; i++) {
          const [va, vb] = directed[i];
          const k = va < vb ? va + ':' + vb : vb + ':' + va;
          if (undirected.get(k) !== 1) continue; // interior edge
          if (!outEdges.has(va)) outEdges.set(va, []);
          outEdges.get(va).push(vb);
        }
        for (const targets of outEdges.values()) if (targets.length !== 1) { clean = false; break; }
        if (!clean || outEdges.size === 0) { emitRaw(region.tris, out, P, T, A); continue; }

        // trace closed loops by following the single outgoing edge
        const loops = [];
        const visited = new Set();
        for (const start of outEdges.keys()) {
          if (visited.has(start)) continue;
          const loop = [];
          let v = start;
          do {
            visited.add(v);
            loop.push(v);
            const next = outEdges.get(v)[0];
            if (next === undefined) { clean = false; break; }
            v = next;
          } while (v !== start && !visited.has(v));
          if (!clean || v !== start || loop.length < 3) { clean = false; break; }
          loops.push(loop);
        }
        if (!clean) { emitRaw(region.tris, out, P, T, A); continue; }

        // classify: wound with the plane normal → outer candidate, against → hole
        const n = bk.plane.n;
        const outers = [], holes = [];
        for (const loop of loops) {
          const pts = loop.map(vi => P[vi]);
          const nw = newellNormal(pts);
          const withNormal = nw.x * n.x + nw.y * n.y + nw.z * n.z;
          const ring = pts.slice();
          dropCollinear(ring);
          if (withNormal > 0) outers.push(ring);
          else holes.push(ring);
        }
        if (outers.length === 0) { emitRaw(region.tris, out, P, T, A); continue; }
        // largest positive loop is THE outer; extra positive loops become
        // standalone faces (cannot happen for manifold input — belt & braces)
        outers.sort((r1, r2) => Math.abs(G.loopArea ? G.loopArea(r2) : 0) - Math.abs(G.loopArea ? G.loopArea(r1) : 0));
        const attrs = A ? Object.assign({}, A[region.tris[0]]) : undefined;
        out.push({ outer: outers[0], holes: outers.length === 1 ? holes : holes.slice(), attrs });
        for (let i = 1; i < outers.length; i++) out.push({ outer: outers[i], holes: [], attrs });
      }
    }
    return out;
  };

  function emitRaw(triIdxs, out, P, T, A) {
    for (const ti of triIdxs) {
      const t = T[ti];
      const ring = [P[t[0]], P[t[1]], P[t[2]]];
      if (G.loopArea(ring) < 1e-12) continue;
      out.push({ outer: ring, holes: [], attrs: A ? Object.assign({}, A[ti]) : undefined });
    }
  }

  window.SoupFuse = API;
})();
