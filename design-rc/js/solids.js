'use strict';
// ---------------------------------------------------------------------------
// solids.js — SketchUp's Solid Tools over the B-Rep.
//
// Six operations — Outer Shell, Union, Subtract, Trim, Intersect, Split —
// on SOLID GROUPS only (SketchUp's contract: a watertight shell, every edge
// bordered by exactly two faces of the set, no nested content). The result
// is a fresh group of FIXED geometry (no parameters), exactly like Convert
// Faces/Edge to Element, so the parametric no-detach story stays coherent.
//
// Layering (the IngeTrazo recipe, rebuilt for this kernel):
//   group faces → indexed triangle soup (per-face triangulation, welded ids)
//   → boolean kernel (injected: Manifold WASM in the app, mock in tests)
//   → SoupFuse (coplanar fusion back to polygon faces with holes)
//   → addFaceFromRings into a new group; inputs leave via deleteFaces.
//
// A watertight shell is topologically self-contained — its edges all border
// faces of the set — so extract-and-replace never touches the shared B-Rep's
// welding invariants, and faces carry `gid` so groups are plain bookkeeping.
//
// Pure module: G + Model only, no DOM, no THREE (triangulation uses
// THREE.ShapeUtils when present, as the viewport does; the fallback is a
// convex fan, so unit tests use boxes).
// ---------------------------------------------------------------------------
(function () {
  const OPS = {
    UNION: 'union', SUBTRACT: 'subtract', TRIM: 'trim',
    INTERSECT: 'intersect', SPLIT: 'split', SHELL: 'shell',
  };
  const RESULT_NAMES = {
    union: 'Union', subtract: 'Difference', trim: 'Trimmed',
    intersect: 'Intersection', split: 'Split', shell: 'Outer Shell',
  };

  function groupFaceIds(model, gid) {
    const out = [];
    for (const f of model.faces.values()) if (f.gid === gid) out.push(f.id);
    return out;
  }

  /** SketchUp's solid rule for a group. {ok, volume, openEdges, reason}. */
  function solidReport(model, gid) {
    const g = model.groups.get(gid);
    if (!g) return { ok: false, reason: 'no such group' };
    const faceIds = groupFaceIds(model, gid);
    if (!faceIds.length) return { ok: false, reason: 'empty group' };
    for (const id of faceIds) {
      const f = model.faces.get(id);
      if (f && f.userData && (f.userData.bimEntityId != null)) {
        return {
          ok: false,
          reason: 'contains a parametric element — edit its values in Entity Info, or use Edit In Place',
        };
      }
    }
    const open = model.shellOpenEdges(faceIds);
    if (open !== 0) return { ok: false, openEdges: open, reason: open + ' open edge' + (open > 1 ? 's' : '') + ' — not a watertight solid' };
    const vol = model.shellVolume(faceIds);
    if (!(vol > 1e-12)) return { ok: false, reason: 'no enclosed volume' };
    return { ok: true, volume: vol };
  }

  function triangulate2D(outer2D, holes2D) {
    if (typeof THREE !== 'undefined' && THREE.ShapeUtils && THREE.ShapeUtils.triangulateShape) {
      try {
        const t = THREE.ShapeUtils.triangulateShape(outer2D, holes2D);
        if (t && t.length) return t;
      } catch (e) { /* fall through to fan */ }
    }
    if (holes2D && holes2D.length) return []; // concave-with-holes needs THREE
    const out = [];
    for (let i = 1; i + 1 < outer2D.length; i++) out.push([0, i, i + 1]);
    return out;
  }

  /** Model faces → { soup, faces: [{n,d, o,u,v, outer2D, holes2D, color, alpha}] }.
   *  Shared B-Rep vertices weld to one soup index (positions are bit-equal),
   *  so the soup is a true indexed mesh — what the kernel requires. */
  function extractSoup(model, faceIds) {
    const positions = [], triangles = [], triAttrs = [];
    const index = new Map();
    const q = v => Math.round(v * 1e7); // 0.1 µm grid
    const vid = p => {
      const k = q(p.x) + ',' + q(p.y) + ',' + q(p.z);
      let i = index.get(k);
      if (i === undefined) { i = positions.length; positions.push({ x: p.x, y: p.y, z: p.z }); index.set(k, i); }
      return i;
    };
    const records = [];
    for (const id of faceIds) {
      const f = model.faces.get(id);
      if (!f || f.hidden) continue;
      const outer = model.pts(f.loop);
      if (outer.length < 3) continue;
      const n = G.loopNormal(outer);
      if (G.isZero(n)) continue;
      const { u, v } = G.basisForNormal(n);
      const o = outer[0];
      const t2 = p => ({
        x: (p.x - o.x) * u.x + (p.y - o.y) * u.y + (p.z - o.z) * u.z,
        y: (p.x - o.x) * v.x + (p.y - o.y) * v.y + (p.z - o.z) * v.z,
      });
      const from2 = p => ({
        x: o.x + p.x * u.x + p.y * v.x,
        y: o.y + p.x * u.y + p.y * v.y,
        z: o.z + p.x * u.z + p.y * v.z,
      });
      const outer2D = outer.map(t2);
      const holes2D = (f.holes || []).map(h => model.pts(h).map(t2));
      const tris = triangulate2D(outer2D, holes2D);
      if (!tris.length) continue;
      const all = outer2D.concat(holes2D.flat());
      const ids3 = all.map(p2 => vid(from2(p2)));
      const attrs = { color: f.color || null, alpha: f.alpha == null ? 1 : f.alpha };
      for (const t of tris) {
        if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue;
        triangles.push([ids3[t[0]], ids3[t[1]], ids3[t[2]]]);
        triAttrs.push(attrs);
      }
      records.push({
        n, d: G.dot(n, o) / G.len(n), o, u, v, outer2D, holes2D,
        color: attrs.color, alpha: attrs.alpha,
      });
    }
    return { soup: SoupFuse.ensureOutward({ positions, triangles, triAttrs }), records };
  }

  function pointIn2D(poly, p) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (((poly[i].y > p.y) !== (poly[j].y > p.y)) &&
        (p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x)) c = !c;
    }
    return c;
  }

  /** Which input face does a result triangle belong to? Plane + point-in-
   *  polygon on the face's own 2D basis. Surviving-target faces win first;
   *  then the cutter's — SketchUp: faces a cut creates take the material of
   *  the solid that cut them. Unmatched triangles keep null (default). */
  function matchRecord(records, centroid) {
    for (const r of records) {
      const dx = centroid.x - r.o.x, dy = centroid.y - r.o.y, dz = centroid.z - r.o.z;
      if (Math.abs(G.dot(r.n, { x: dx, y: dy, z: dz })) / G.len(r.n) > 1e-6) continue;
      const p2 = { x: dx * r.u.x + dy * r.u.y + dz * r.u.z, y: dx * r.v.x + dy * r.v.y + dz * r.v.z };
      if (!pointIn2D(r.outer2D, p2)) continue;
      let inHole = false;
      for (const h of r.holes2D) if (pointIn2D(h, p2)) { inHole = true; break; }
      if (!inHole) return r;
    }
    return null;
  }

  function centroid(P, t) {
    const a = P[t[0]], b = P[t[1]], c = P[t[2]];
    return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 };
  }

  function assignAttrs(soup, recordSets) {
    const flat = recordSets.flat();
    const out = [];
    for (const t of soup.triangles) {
      const r = matchRecord(flat, centroid(soup.positions, t));
      out.push(r ? { color: r.color, alpha: r.alpha } : { color: null, alpha: 1 });
    }
    soup.triAttrs = out;
    return soup;
  }

  /** Create a new group from fused face records. addFaceFromRings welds into
   *  the model (result faces share vertices among themselves through the
   *  kernel's own indexing — positions are already exact). */
  function buildResultGroup(model, name, fused) {
    const made = [];
    for (const rec of fused) {
      const f = model.addFaceFromRings(rec.outer, rec.holes || [], {
        gid: 0, color: rec.attrs ? rec.attrs.color : null,
        alpha: rec.attrs ? rec.attrs.alpha : undefined,
      });
      if (f) made.push(f.id);
    }
    if (!made.length) return null;
    const g = model.createGroup({ faces: new Set(made), edges: new Set() }, name);
    g.solid = true;
    return g;
  }

  /**
   * Run a solid operation.
   * @param op one of OPS
   * @param target the group that receives the cut (kept by Trim)
   * @param cutter the group that cuts it (deleted by Subtract)
   * @param kernel { union(a,b), subtract(a,b), intersect(a,b) } → soup|null
   * @returns {ok, groups?: [{gid,name,volume}], error?, empty?:true}
   */
  function run(model, op, targetGid, cutterGid, kernel) {
    for (const gid of [targetGid, cutterGid]) {
      if (gid == null) return { ok: false, error: 'select two solid groups' };
      const rep = solidReport(model, gid);
      if (!rep.ok) {
        const g = model.groups.get(gid);
        return { ok: false, error: (g && g.name ? g.name : 'group') + ': ' + rep.reason };
      }
    }
    const tEx = extractSoup(model, groupFaceIds(model, targetGid));
    const cEx = extractSoup(model, groupFaceIds(model, cutterGid));
    if (!tEx.soup.triangles.length || !cEx.soup.triangles.length) {
      return { ok: false, error: 'could not triangulate the selection' };
    }

    const a = tEx.soup, b = cEx.soup; // a = target, b = cutter
    let resultSoups = [];
    if (op === OPS.UNION || op === OPS.SHELL) {
      const r = kernel.union(a, b);
      if (r) resultSoups = [r];
    } else if (op === OPS.INTERSECT) {
      const r = kernel.intersect(a, b);
      if (r) resultSoups = [r];
    } else if (op === OPS.SUBTRACT || op === OPS.TRIM) {
      const r = kernel.subtract(a, b); // target minus cutter
      if (r) resultSoups = [r];
    } else if (op === OPS.SPLIT) {
      for (const r of [kernel.subtract(a, b), kernel.subtract(b, a), kernel.intersect(a, b)]) {
        if (r && r.triangles.length) resultSoups.push(r);
      }
    } else {
      return { ok: false, error: 'unknown operation ' + op };
    }
    resultSoups = resultSoups.filter(r => r && r.triangles && r.triangles.length);
    if (!resultSoups.length) return { ok: false, error: 'the solids do not overlap', empty: true };

    // inputs leave first so result faces never weld against their own corpses
    const removeGids = op === OPS.TRIM ? [targetGid] : [targetGid, cutterGid];
    for (const gid of removeGids) model.deleteFaces(groupFaceIds(model, gid));
    for (const gid of removeGids) model.groups.delete(gid);

    const created = [];
    for (let i = 0; i < resultSoups.length; i++) {
      let soup = resultSoups[i];
      if (op === OPS.SHELL) SoupFuse.dropInnerShells(soup);
      assignAttrs(soup, [tEx.records, cEx.records]);
      const fused = SoupFuse.fuse(soup);
      const name = RESULT_NAMES[op] + (resultSoups.length > 1 ? ' ' + (i + 1) : '');
      const g = buildResultGroup(model, name, fused);
      if (g) {
        const vol = model.shellVolume(groupFaceIds(model, g.id));
        created.push({ gid: g.id, name: g.name, volume: vol });
      }
    }
    if (!created.length) return { ok: false, error: 'the operation produced no geometry' };
    model.pruneGroups();
    return { ok: true, groups: created };
  }

  window.SolidOps = {
    OPS, RESULT_NAMES, solidReport, groupFaceIds, extractSoup, run,
    /** Fuse an arbitrary triangle soup — an imported flat-shaded mesh, an
     *  IFC reference triangulation — into clean polygon faces gathered in a
     *  NEW group (the importer payoff of the fuse pass). triAttrs
     *  (per-triangle {color, alpha}) survive as face attributes. */
    facesFromSoup(model, soup, name) {
      const fused = SoupFuse.fuse(soup);
      const g = buildResultGroup(model, name || 'Imported mesh', fused);
      return g ? { gid: g.id, name: g.name, faces: fused.length } : null;
    },
  };
})();
