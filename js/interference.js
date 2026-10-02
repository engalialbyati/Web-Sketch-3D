'use strict';
// interference.js — clash detection between BIM elements (Revit's
// Interference Check): pairwise AABB broad phase, then triangle-triangle
// narrow phase between the entities' faces (SAT-lite via segment tests —
// any edge of A crossing any face of B or vice versa = interference).
// Pure module: (model, entitiesA, entitiesB) -> [{ a, b, points, depth }]
(function () {
  // Möller–Trumbore edge-triangle intersection
  function segTri(p0, p1, t0, t1, t2) {
    const e1 = sub(t1, t0), e2 = sub(t2, t0);
    const d = sub(p1, p0);
    const p = cross(d, e2);
    const det = dot(e1, p);
    if (Math.abs(det) < 1e-12) return null;
    const inv = 1 / det;
    const s = sub(p0, t0);
    const u = dot(s, p) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) return null;
    const q = cross(s, e1);
    const v = dot(d, q) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) return null;
    const t = dot(e2, q) * inv;
    if (t < -1e-9 || t > 1 + 1e-9) return null;
    return { p: add(p0, mul(d, t)), depth: null };
  }
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
  const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

  function faceTris(model, fid) {
    const f = model.faces.get(fid);
    if (!f) return [];
    const outer = model.pts(f.loop);
    const holes = (f.holes || []).map(h => model.pts(h));
    // fan triangulation is wrong for concave rings; use the same earcut the
    // renderer does when available, else fan (convex-ish BIM faces)
    if (window.DXF_TRIANGULATE) return window.DXF_TRIANGULATE(outer, holes);
    // cheap earcut-free fallback: fan the outer ring (BIM faces are mostly
    // convex quads); holes are rare in clash targets
    const tris = [];
    for (let i = 1; i + 1 < outer.length; i++) tris.push([outer[0], outer[i], outer[i + 1]]);
    return tris;
  }

  function entityGeom(model, ent) {
    const tris = [];
    for (const fid of (ent.faces || [])) tris.push(...faceTris(model, fid));
    // AABB
    let bb = null;
    for (const t of tris) for (const p of t) {
      if (!bb) bb = { x0: p.x, x1: p.x, y0: p.y, y1: p.y, z0: p.z, z1: p.z };
      else {
        bb.x0 = Math.min(bb.x0, p.x); bb.x1 = Math.max(bb.x1, p.x);
        bb.y0 = Math.min(bb.y0, p.y); bb.y1 = Math.max(bb.y1, p.y);
        bb.z0 = Math.min(bb.z0, p.z); bb.z1 = Math.max(bb.z1, p.z);
      }
    }
    return { tris, bb };
  }

  /** Detect interferences between two entity lists (same-list pairs are
   * checked when B is omitted). Returns [{ a, b, points: [{x,y,z}] }] —
   * one entry per clashing pair with up to a few witness points. */
  function interference(model, listA, listB) {
    const B = listB || listA;
    const geoms = new Map();
    const geomOf = e => {
      if (!geoms.has(e.id)) geoms.set(e.id, entityGeom(model, e));
      return geoms.get(e.id);
    };
    const out = [];
    const seen = new Set(); // each unordered pair reported once
    for (const ea of listA) {
      const ga = geomOf(ea);
      if (!ga || !ga.bb) continue;
      for (const eb of B) {
        if (ea === eb) continue;
        const pk = ea.id < eb.id ? ea.id + '|' + eb.id : eb.id + '|' + ea.id;
        if (seen.has(pk)) continue;
        const gb = geomOf(eb);
        if (!gb || !gb.bb) continue;
        const bb1 = ga.bb, bb2 = gb.bb;
        if (bb1.x1 < bb2.x0 - 1e-6 || bb1.x0 > bb2.x1 + 1e-6
          || bb1.y1 < bb2.y0 - 1e-6 || bb1.y0 > bb2.y1 + 1e-6
          || bb1.z1 < bb2.z0 - 1e-6 || bb1.z0 > bb2.z1 + 1e-6) continue;
        // narrow phase: edges of one crossing faces of the other
        const pts = [];
        const push = hit => { if (hit && pts.length < 4) pts.push(hit); };
        const edgesOf = (tris) => {
          const es = [];
          for (const t of tris) { es.push([t[0], t[1]], [t[1], t[2]], [t[2], t[0]]); }
          return es;
        };
        const ea2 = edgesOf(ga.tris);
        if (pts.length < 4) for (const [p0, p1] of ea2) {
          for (const t of gb.tris) { push(segTri(p0, p1, t[0], t[1], t[2])); if (pts.length >= 4) break; }
          if (pts.length >= 4) break;
        }
        const eb2 = edgesOf(gb.tris);
        if (pts.length < 4) for (const [p0, p1] of eb2) {
          for (const t of ga.tris) { push(segTri(p0, p1, t[0], t[1], t[2])); if (pts.length >= 4) break; }
          if (pts.length >= 4) break;
        }
        if (pts.length) { seen.add(pk); out.push({ a: ea, b: eb, points: pts }); }
      }
    }
    return out;
  }

  window.Interference = { interference };
})();
