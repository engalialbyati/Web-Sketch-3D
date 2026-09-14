'use strict';
// ---------------------------------------------------------------------------
// ifc-elements.js — phase 2: IFC as ELEMENTS.
//
// File > Import IFC as Elements…: parses the IFC SCHEMA layer (not the
// tessellation) and drives the app's real parametric pathways, exactly how
// Demo-R5 builds its test building:
//
//   IfcBuildingStorey            → levels (LevelManager.addLevel)
//   IfcWall(StandardCase)        → wall entities (centerline + thickness,
//                                  or a closed-footprint wall for shaped
//                                  plan sections); openings cut through the
//                                  HostedCut pathway
//   IfcColumn                    → column entities (rect prism, or the
//                                  'circular' family for round sections)
//   IfcBeam                      → beam entities (absolute zTop — the file's
//                                  soffit height is not a level datum)
//   IfcSlab / IfcFooting         → floor / foundation entities
//   anything else (stairs, doors, windows, roofs, furniture…), plus any
//   mapped product whose geometry is not a clean extrusion → the phase-1
//   reference meshes, so nothing silently disappears.
//
// Everything goes through the B-Rep kernel + bim.create: the imports are
// selectable, editable, trimmable elements — undo is cleared instead (an
// import is atomic, like loading a demo building).
// ---------------------------------------------------------------------------
(function (root) {

  const fmt = n => +(+n).toFixed(4);

  // web-ifc 0.0.66 GetLine(flatten) wraps simple attributes as
  // {value, type, name:"IFCLABEL"|"IFCLENGTHMEASURE"|…} — unwrap defensively
  const num = x => {
    if (x == null) return 0;
    if (typeof x === 'number') return isFinite(x) ? x : 0;
    if (typeof x === 'object' && x.value != null) { const v = +x.value; return isFinite(v) ? v : 0; }
    const v = +x; return isFinite(v) ? v : 0;
  };
  const str = x => {
    if (x == null) return '';
    if (typeof x === 'string') return x;
    if (typeof x === 'object' && x.value != null) return String(x.value);
    return '';
  };

  // ---------------------------------------------------------- tiny vec math
  const normalize3 = a => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const cross3 = (a, b) => [
    a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const dirRatios = (d, fallback) => {
    const r = d && d.DirectionRatios;
    if (!r || r.length < 2) return fallback;
    const v = [num(r[0]), num(r[1]), num(r[2])];
    return Math.hypot(v[0], v[1], v[2]) < 1e-12 ? fallback : normalize3(v);
  };

  // entity handle {value: expressID} → resolved line (web-ifc's flatten is
  // shallow: deep hops like a mapped item's SweptArea arrive as handles)
  const deref = (x, getline) => {
    if (x && typeof x === 'object' && x.value != null && x.name == null
      && x.expressID == null && getline) {
      try { return getline(x.value) || x; } catch (e) { return x; }
    }
    return x;
  };
  // unflattened relation attributes are plain handles (wrappers carry a
  // `name` like "IFCLABEL" and are values, not handles)
  const handleId = x =>
    (x && typeof x === 'object' && x.value != null && x.name == null) ? x.value : null;

  // IfcAxis2Placement3D/2D → local→parent Matrix4
  function axisMatrix(ap, getline) {
    const THREE_ = root.THREE;
    ap = deref(ap, getline);
    const M = new THREE_.Matrix4();
    if (!ap || !ap.Location) return M;
    const loc = deref(ap.Location, getline);
    const c = ((loc && loc.Coordinates) || [0, 0, 0]).map(num);
    const hasAxis = ap.Axis != null, hasRef = ap.RefDirection != null;
    if (!hasAxis && !hasRef) {
      M.setPosition(c[0], c[1], c[2]);
      return M;
    }
    const z = dirRatios(deref(ap.Axis, getline), [0, 0, 1]);
    let x = dirRatios(deref(ap.RefDirection, getline), [1, 0, 0]);
    const d = dot3(x, z);
    x = [x[0] - d * z[0], x[1] - d * z[1], x[2] - d * z[2]];
    if (Math.hypot(x[0], x[1], x[2]) < 1e-9)
      x = Math.abs(z[0]) < 0.9 ? cross3([1, 0, 0], z) : cross3([0, 1, 0], z);
    x = normalize3(x);
    const y = cross3(z, x);
    M.makeBasis(new THREE_.Vector3(...x), new THREE_.Vector3(...y), new THREE_.Vector3(...z));
    M.setPosition(c[0], c[1], c[2]);
    return M;
  }

  // IfcCartesianTransformationOperator3D (an IfcMappedItem's MappingTarget)
  // → Matrix4: Axis1/2/3 basis (defaults X/Y/Z), LocalOrigin, uniform Scale
  function transformOp(t, getline) {
    const THREE_ = root.THREE;
    t = deref(t, getline);
    const M = new THREE_.Matrix4();
    if (!t) return M;
    let z = t.Axis3 ? dirRatios(deref(t.Axis3, getline), [0, 0, 1]) : [0, 0, 1];
    let x = t.Axis1 ? dirRatios(deref(t.Axis1, getline), [1, 0, 0]) : [1, 0, 0];
    let y = t.Axis2 ? dirRatios(deref(t.Axis2, getline), [0, 1, 0]) : [0, 1, 0];
    let d = dot3(x, z);
    x = [x[0] - d * z[0], x[1] - d * z[1], x[2] - d * z[2]];
    if (Math.hypot(x[0], x[1], x[2]) < 1e-9)
      x = Math.abs(z[0]) < 0.9 ? cross3([1, 0, 0], z) : cross3([0, 1, 0], z);
    x = normalize3(x);
    d = dot3(y, z);
    y = [y[0] - d * z[0], y[1] - d * z[1], y[2] - d * z[2]];
    let dl = Math.hypot(y[0], y[1], y[2]);
    y = dl > 1e-9 ? normalize3(y) : cross3(z, x);
    const s = t.Scale != null ? (num(t.Scale) || 1) : 1;
    const lo = deref(t.LocalOrigin, getline);
    const o = (lo && lo.Coordinates) ? lo.Coordinates.map(num) : [0, 0, 0];
    M.makeBasis(
      new THREE_.Vector3(x[0] * s, x[1] * s, x[2] * s),
      new THREE_.Vector3(y[0] * s, y[1] * s, y[2] * s),
      new THREE_.Vector3(z[0] * s, z[1] * s, z[2] * s));
    M.setPosition(o[0], o[1], o[2]);
    return M;
  }

  // IfcLocalPlacement (flattened, or with .value handles) → world Matrix4
  function placementMatrix(lp, getline) {
    const THREE_ = root.THREE;
    const M = new THREE_.Matrix4();
    const chain = [];
    let cur = lp, guard = 0;
    while (cur && cur.RelativePlacement && guard++ < 32) {
      chain.push(cur.RelativePlacement);
      let parent = cur.PlacementRelTo || null;
      if (parent && !parent.RelativePlacement) {
        const pid = handleId(parent);
        parent = pid != null ? getline(pid) : null;
      }
      cur = parent;
    }
    for (let i = chain.length - 1; i >= 0; i--) M.multiply(axisMatrix(chain[i], getline));
    return M;
  }

  // ------------------------------------------------------- profiles (2D)
  function curvePts(cv, getline) {
    if (!cv) return null;
    cv = deref(cv, getline);
    // IfcCompositeCurve (or a composite-backed IndexedPolyCurve): chain each
    // segment's ParentCurve (arc segments approximate as chords)
    if (cv.Segments && cv.Segments.length && cv.Segments.some(sg => sg && sg.ParentCurve)) {
      const pts = [];
      for (const sg0 of cv.Segments) {
        const sg = deref(sg0, getline);
        const pc = sg && deref(sg.ParentCurve, getline);
        const sub = pc ? curvePts(pc, getline) : null;
        if (!sub) continue;
        const arr = (sg.SameSense === 'F' || sg.SameSense === false) ? [...sub].reverse() : sub;
        for (const p of arr) {
          const last = pts[pts.length - 1];
          if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 1e-9) continue;
          pts.push(p);
        }
      }
      if (pts.length > 1) {
        const a = pts[0], b = pts[pts.length - 1];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) pts.pop();
      }
      return pts.length >= 3 ? pts : null;
    }
    if (cv.Points && cv.Points.CoordList) { // IfcIndexedPolyCurve
      const all = cv.Points.CoordList.map(c => [num(c[0]), num(c[1])]);
      const segs = cv.Segments;
      if (!segs || !segs.length) return all.length >= 3 ? all : null;
      const out = [];
      for (const s of segs) {
        const ids = Array.isArray(s) ? s : (s.value != null && s.name == null ? [s.value] : null);
        if (!ids || !ids.length) continue;
        if (!out.length) out.push(all[ids[0] - 1]);
        out.push(all[ids[ids.length - 1] - 1]); // arcs approximated by chords
      }
      return out.length >= 3 ? out : (all.length >= 3 ? all : null);
    }
    if (cv.Points) { // IfcPolyline (a composite segment may be a single edge)
      const pts = cv.Points.map(p0 => {
        const p = deref(p0, getline);
        const c = (p && p.Coordinates) || [0, 0];
        return [num(c[0]), num(c[1])];
      });
      if (pts.length > 1) {
        const a = pts[0], b = pts[pts.length - 1];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) pts.pop();
      }
      return pts.length >= 2 ? pts : null;
    }
    return null;
  }

  // SweptArea → planar loop {kind, pts CCW-in-profile, r?, w?, h?}
  function profileLoop(sa, getline) {
    if (!sa) return null;
    sa = deref(sa, getline);
    const pos = deref(sa.Position, getline) || null;
    const place2 = pt => {
      if (!pos || !pos.Location) return pt;
      const c = (deref(pos.Location, getline).Coordinates || [0, 0]).map(num);
      const rd = pos.RefDirection && deref(pos.RefDirection, getline).DirectionRatios;
      const ang = rd ? Math.atan2(num(rd[1]), num(rd[0]) || 1) : 0;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      return [pt[0] * cs - pt[1] * sn + num(c[0]), pt[0] * sn + pt[1] * cs + num(c[1])];
    };
    if (sa.Radius != null) { // IfcCircleProfileDef
      const r = num(sa.Radius), n = 24, pts = [];
      if (r < 1e-6) return null;
      for (let i = 0; i < n; i++) {
        const a = -i / n * 2 * Math.PI;
        pts.push(place2([Math.cos(a) * r, Math.sin(a) * r]));
      }
      return { kind: 'circle', r, pts };
    }
    if (sa.XDim != null) { // IfcRectangleProfileDef
      const w = num(sa.XDim), h = num(sa.YDim);
      if (w < 1e-6 || h < 1e-6) return null;
      return {
        kind: 'rect', w, h,
        pts: [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(place2),
      };
    }
    if (sa.OuterCurve) { // IfcArbitraryClosedProfileDef
      const pts = curvePts(deref(sa.OuterCurve, getline), getline);
      return (pts && pts.length >= 3) ? { kind: 'poly', pts: pts.map(place2) } : null;
    }
    // parametric steel/shape profiles (I, C, L, T, Z, U, ellipse…) → the
    // bounding rectangle: the beam stays parametric on its baseline, the
    // exact section is a family matter for a later phase
    const rectFrom = (w, h) => (w > 1e-6 && h > 1e-6)
      ? { kind: 'rect', w, h, pts: [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(place2) }
      : null;
    if (sa.SemiAxis1 != null) // IfcEllipseProfileDef
      return rectFrom(2 * num(sa.SemiAxis1), 2 * num(sa.SemiAxis2));
    const pickNum = keys => {
      for (const k of keys) if (sa[k] != null) return num(sa[k]);
      return 0;
    };
    const W = pickNum(['OverallWidth', 'Girth', 'FlangeWidth', 'Width']);
    const H = pickNum(['OverallDepth', 'Depth']);
    return W && H ? rectFrom(W, H) : null;
  }

  // ------------------------------------------------- product solid parsing
  // Collect the extruded solids of a product as [{solid, preM}]: boolean
  // clipping results unwrap to their FirstOperand (the un-clipped body —
  // the app's own trim engine re-derives the joints), IfcMappedItem unwraps
  // to MappingTarget ∘ MappingOrigin ∘ the mapped representation's items
  // (repeated columns/beams arrive this way), and axis polylines are skipped.
  function extrusions(prod, getline) {
    const out = [];
    const push = (it, preM, depth) => {
      it = deref(it, getline);
      if (!it || typeof it !== 'object' || depth > 8) return;
      if (it.SweptArea && it.ExtrudedDirection && it.Depth != null) { out.push({ solid: it, preM }); return; }
      if (it.FirstOperand) { push(it.FirstOperand, preM, depth + 1); return; }
      if (it.MappingSource) {
        const src = deref(it.MappingSource, getline);
        const tgt = deref(it.MappingTarget, getline);
        const M = preM ? preM.clone() : new (root.THREE.Matrix4)();
        M.multiply(transformOp(tgt, getline))
          .multiply(axisMatrix(deref(src.MappingOrigin, getline), getline));
        const mr = deref(src.MappedRepresentation, getline);
        // MappedRepresentation may BE the IfcShapeRepresentation directly
        // (with .Items) rather than a wrapper with .Representations
        const reps = (mr && mr.Representations) ? mr.Representations : [mr];
        for (const sr0 of reps) {
          const sr = deref(sr0, getline);
          for (const sub of (sr && sr.Items) || []) push(sub, M, depth + 1);
        }
      }
    };
    for (const sr of ((prod.Representation || {}).Representations) || [])
      for (const it of sr.Items || []) push(it, null, 0);
    return out;
  }

  // one extrusion → world space {prof, dir, depth, base[], top[]}; `f` is
  // the model's length-unit factor (Depth is a raw schema value, the profile
  // flows through the already-scaled matrix)
  function swept(ex, worldM, preM, f, getline) {
    const THREE_ = root.THREE;
    ex = deref(ex, getline);
    const prof = profileLoop(ex.SweptArea, getline);
    const depth = num(ex.Depth) * (f || 1);
    if (!prof || !(depth > 1e-6)) return null;
    const M = worldM.clone();
    if (preM) M.multiply(preM);
    M.multiply(axisMatrix(deref(ex.Position, getline), getline));
    const dir = new THREE_.Vector3(...dirRatios(deref(ex.ExtrudedDirection, getline), [0, 0, 1]))
      .transformDirection(M).normalize();
    const base = prof.pts.map(p => new THREE_.Vector3(p[0], p[1], 0).applyMatrix4(M));
    const top = base.map(p => p.clone().addScaledVector(dir, depth));
    return { prof, dir, depth, base, top };
  }

  // ------------------------------------------------- shape classification
  function ringCentroid(r) {
    const THREE_ = root.THREE;
    const c = new THREE_.Vector3();
    for (const p of r) c.add(p);
    return c.multiplyScalar(1 / (r.length || 1));
  }

  // 4-pt ring that is a plan rectangle (edges ⊥ within ~1.7°, opposites
  // equal within 2%) → {L[4], D[4], runIdx, length, thickness}
  function rectLike(ring) {
    if (!ring || ring.length !== 4) return null;
    const L = [], D = [];
    for (let i = 0; i < 4; i++) {
      const a = ring[i], b = ring[(i + 1) % 4];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l = Math.hypot(dx, dy);
      if (l < 1e-6) return null;
      L.push(l); D.push([dx / l, dy / l]);
    }
    for (let i = 0; i < 4; i++)
      if (Math.abs(D[i][0] * D[(i + 1) % 4][0] + D[i][1] * D[(i + 1) % 4][1]) > 0.03) return null;
    if (Math.abs(L[0] - L[2]) / Math.max(L[0], L[2]) > 0.02) return null;
    if (Math.abs(L[1] - L[3]) / Math.max(L[1], L[3]) > 0.02) return null;
    const runIdx = L[0] >= L[1] ? 0 : 1;
    return { L, D, runIdx, length: L[runIdx], thickness: L[(runIdx + 1) % 4] };
  }

  const mid3 = (a, b) => [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];

  // Oriented bounding box of a plan ring via its longest edge (chamfered
  // rects, ellipse-ish sections): {cx, cy, w, h, rot}
  function obbFromRing(ring) {
    if (!ring || ring.length < 3) return null;
    let best = null;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      if (l > 1e-9 && (!best || l > best.l))
        best = { l, u: [(b.x - a.x) / l, (b.y - a.y) / l] };
    }
    if (!best) return null;
    const u = best.u, v = [-u[1], u[0]];
    let lo0 = Infinity, hi0 = -Infinity, lo1 = Infinity, hi1 = -Infinity;
    for (const p of ring) {
      const t0 = p.x * u[0] + p.y * u[1], t1 = p.x * v[0] + p.y * v[1];
      if (t0 < lo0) lo0 = t0; if (t0 > hi0) hi0 = t0;
      if (t1 < lo1) lo1 = t1; if (t1 > hi1) hi1 = t1;
    }
    const w = hi0 - lo0, h = hi1 - lo1;
    if (w < 1e-6 || h < 1e-6) return null;
    return {
      cx: (lo0 + hi0) / 2 * u[0] + (lo1 + hi1) / 2 * v[0],
      cy: (lo0 + hi0) / 2 * u[1] + (lo1 + hi1) / 2 * v[1],
      w, h, rot: Math.atan2(u[1], u[0]),
    };
  }

  // shoelace over [[x,y,z],…] — positive = CCW seen from +Z
  function planArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  // IfcProject ▸ UnitsInContext ▸ Units: the schema layer returns RAW file
  // values — a millimeter file must be scaled to the app's meters (the
  // geometry pipeline of web-ifc does this for meshes; GetLine does not)
  const SI_PREFIX = {
    EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3,
    HECTO: 1e2, DECA: 10, DECI: 0.1, CENTI: 0.01, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9,
  };
  function lengthFactor(WebIFC, ifcApi, modelID, getline) {
    try {
      const pv = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCPROJECT);
      if (!pv.size()) return 1;
      const proj = getline(pv.get(0));
      const units = (proj && proj.UnitsInContext && proj.UnitsInContext.Units) || [];
      for (const u of units) {
        if (!u) continue;
        const t = String(str(u.UnitType)).toUpperCase().replace(/\./g, '');
        if (t !== 'LENGTHUNIT') continue;
        const p = String(str(u.Prefix || '')).toUpperCase().replace(/\./g, '');
        if (SI_PREFIX[p] != null) return SI_PREFIX[p];
        if (u.ConversionFactor) { // IfcConversionBasedUnit (inch, foot…)
          const v = num(u.ConversionFactor.ValueComponent);
          const uc = u.ConversionFactor.UnitComponent || {};
          const up = String(str(uc.Prefix || '')).toUpperCase().replace(/\./g, '');
          if (v > 0) return v * (SI_PREFIX[up] != null ? SI_PREFIX[up] : 1);
        }
        return 1;
      }
    } catch (e) { /* unscaled is the safe default */ }
    return 1;
  }

  // ------------------------------------------------------- schema parsing
  function parseModel(WebIFC, ifcApi, modelID) {
    const getline = id => { try { return ifcApi.GetLine(modelID, id, true); } catch (e) { return null; } };
    const raw = id => { try { return ifcApi.GetLine(modelID, id, false); } catch (e) { return null; } };
    const THREE_ = root.THREE;
    const idsOf = t => {
      const v = ifcApi.GetLineIDsWithType(modelID, t);
      const a = [];
      for (let i = 0; i < v.size(); i++) a.push(v.get(i));
      return a;
    };
    const f = lengthFactor(WebIFC, ifcApi, modelID, getline);
    // placement → world, with the unit scale applied on the outside so every
    // derived point (profile corners, translations, mapping targets) lands
    // in meters
    const worldMatrix = lp => {
      const M = lp ? placementMatrix(lp, getline) : new THREE_.Matrix4();
      if (f !== 1) M.premultiply(new THREE_.Matrix4().makeScale(f, f, f));
      return M;
    };

    // storeys → world z through their placement chain (authoritative for the
    // geometry that hangs below them; IfcBuildingStorey.Elevation duplicates
    // it in most files and would double-count)
    const storeys = idsOf(WebIFC.IFCBUILDINGSTOREY).map(id => {
      const s = getline(id);
      if (!s) return null;
      let z = 0;
      if (s.ObjectPlacement) z = worldMatrix(s.ObjectPlacement).getPosition().z;
      else if (s.Elevation != null) z = num(s.Elevation) * f;
      const name = (str(s.LongName) || str(s.Name) || 'Storey').trim().slice(0, 40) || 'Storey';
      return { id, name, z: fmt(z) };
    }).filter(Boolean).sort((a, b) => a.z - b.z);

    // spatial containment: product expressID → host storey expressID
    const contained = new Map();
    for (const rid of idsOf(WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
      const r = raw(rid);
      if (!r) continue;
      const host = handleId(r.RelatingStructure);
      if (host == null) continue;
      for (const e of (r.RelatedElements || [])) {
        const eid = handleId(e);
        if (eid != null) contained.set(eid, host);
      }
    }

    // voids: host product expressID → [opening expressID]
    const voids = new Map();
    for (const rid of idsOf(WebIFC.IFCRELVOIDSELEMENT)) {
      const r = raw(rid);
      if (!r) continue;
      const host = handleId(r.RelatingBuildingElement);
      const op = handleId(r.RelatedOpeningElement);
      if (host == null || op == null) continue;
      if (!voids.has(host)) voids.set(host, []);
      voids.get(host).push(op);
    }

    const cats = [
      ['wall', [WebIFC.IFCWALL, WebIFC.IFCWALLSTANDARDCASE, WebIFC.IFCWALLELEMENTEDCASE]],
      ['column', [WebIFC.IFCCOLUMN]],
      ['beam', [WebIFC.IFCBEAM]],
      ['slab', [WebIFC.IFCSLAB]],
      ['foundation', [WebIFC.IFCFOOTING]],
    ];
    const products = [];
    const seen = new Set();
    for (const [cat, types] of cats) for (const t of types) for (const id of idsOf(t)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = getline(id);
      if (!p) continue;
      const M = worldMatrix(p.ObjectPlacement);
      // exactly ONE clean extrusion converts; multi-solid bodies keep their
      // tessellated mesh rather than losing half their shape
      const exs = extrusions(p, getline);
      const sw = exs.length === 1 ? swept(exs[0].solid, M, exs[0].preM, f, getline) : null;
      products.push({
        cat, id, name: str(p.Name).slice(0, 60),
        globalId: str(p.GlobalId),
        sw,
        storeyId: contained.get(id) || null,
        openings: voids.get(id) || [],
      });
    }

    // opening geometry, parsed once per referenced opening element
    const openGeoms = new Map();
    for (const list of voids.values()) for (const oid of list) {
      if (openGeoms.has(oid)) continue;
      const o = getline(oid);
      if (!o || !o.Representation) { openGeoms.set(oid, null); continue; }
      const M = worldMatrix(o.ObjectPlacement);
      const sws = extrusions(o, getline)
        .map(x => swept(x.solid, M, x.preM, f, getline)).filter(Boolean);
      openGeoms.set(oid, sws.length ? sws : null);
    }

    return { storeys, products, openGeoms, factor: f };
  }

  // ----------------------------------------------------- element building
  // Mirrors Demo-R5's reg(): build the solid through the real parametric
  // pathway, then claim the fresh faces/edges with bim.create. The bimHold
  // is NOT toggled here — the whole import runs under ONE outer hold (a
  // per-element toggle snapshots/diffs every edge in the model each time,
  // which is quadratic on a multi-thousand-element file).
  function makeBuilders(app, m, bim) {
    const G = window.G, S = app.structural;
    const TR = (root.__ifcTrace = root.__ifcTrace || {});
    const reg = (type, params, buildGeom, roleOf) => {
      TR.s = 'reg-before';
      const before = new Set(m.faces.keys());
      let out;
      try { TR.s = 'reg-geom'; out = buildGeom(); }
      catch (e) {
        // a failed build leaves PARTIAL faces behind, unstamped — they pass
        // autoIntersect's fresh-pair gate and pollute every later build
        // (the multi-thousand-element grind). Roll the build back whole.
        rollbackFaces(m, before);
        throw e;
      }
      TR.s = 'reg-collect';
      const nf = [...m.faces.keys()].filter(id => !before.has(id))
        .map(id => m.faces.get(id)).filter(f => f && !f.userData);
      const roles = {};
      for (const f of nf) roles[f.id] = roleOf(f, params);
      const edges = [];
      for (const f of nf) for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
        const e = m.findEdge(r[i], r[(i + 1) % r.length]);
        if (e && !e.userData) edges.push(e.id);
      }
      TR.s = 'reg-stringify';
      const cp = JSON.parse(JSON.stringify(params));
      TR.s = 'reg-create';
      const ent = bim.create(type, cp, roles, [...new Set(edges)], { noHostDirty: true });
      TR.s = 'reg-post';
      if (ent) ent.name = params.name || ent.name;
      TR.s = 'reg-done';
      return ent;
    };
    const faceAt = (f, z0, h) => {
      const c = m.faceCentroid(f);
      return Math.abs(c.z - z0) < 2e-3 ? 'bottom'
        : Math.abs(c.z - z0 - h) < 2e-3 ? 'top' : 'side';
    };
    return { G, S, reg, faceAt };
  }

  const zOf = pts => {
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { if (p.z < lo) lo = p.z; if (p.z > hi) hi = p.z; }
    return [lo, hi];
  };

  // Delete every face born after a snapshot, unlinking via a one-pass
  // adjacency map over the SURVIVORS — a bare faces.delete leaves edges
  // dangling, and those ghosts pollute every later pass
  function rollbackFaces(m, before) {
    const doomed = [...m.faces.keys()].filter(id => !before.has(id))
      .map(id => m.faces.get(id)).filter(Boolean);
    for (const f of doomed) m.faces.delete(f.id);
    if (!doomed.length) return;
    const adj = new Map();
    for (const f of m.faces.values()) {
      for (const ring of m.rings(f)) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const k = a < b ? a + 'x' + b : b + 'x' + a;
          adj.set(k, (adj.get(k) || 0) + 1);
        }
      }
    }
    for (const f of doomed) {
      const rings = [[...f.loop], ...(f.holes || []).map(h => [...h])];
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const k = a < b ? a + 'x' + b : b + 'x' + a;
          if (!adj.get(k)) {
            const e = m.findEdge(a, b);
            if (e) { try { m._delEdge(e.id); } catch (e2) { } }
          }
        }
      }
    }
    try { m.gc(); } catch (e) { }
  }

  async function load(file, app, onProgress) {
    if (!root.IfcImport || !root.IfcImport.api) throw new Error('ifc-import module missing');
    if (!app || !app.model || !app.bim) throw new Error('no model to import into');
    const { WebIFC, ifcApi } = await root.IfcImport.api();
    const buf = new Uint8Array(await file.arrayBuffer());
    const modelID = ifcApi.OpenModel(buf, { COORDINATE_TO_ORIGIN: true });
    try {
      const parsed = parseModel(WebIFC, ifcApi, modelID);
      const built = await build(app, parsed, onProgress);
      // leftovers (stairs, doors, windows, roofs, furniture, failed parses)
      // normally stay visible as phase-1 reference meshes — capped hard: a
      // file whose leftovers run into the tens of thousands (hospital
      // curtain walls: mullions + plates) would put more meshes than the
      // renderer can hold next to the fresh elements; those are a
      // File ▸ Import IFC job. (Type-query counting can't see subtypes, so
      // the cap lives inside the stream itself.)
      let meshes = 0, skippedMeshes = 0;
      try {
        const rec = await root.IfcImport.addMeshesFromOpenModel(
          modelID, file.name, built.converted, 3000);
        meshes = Object.values(rec.counts || {}).reduce((a, b) => a + b, 0);
        skippedMeshes = rec.skippedProducts || 0;
      } catch (e) { /* mesh pass is best-effort; elements are the product */ }
      return { counts: built.counts, meshes, skippedMeshes, levels: built.levelIds };
    } finally {
      ifcApi.CloseModel(modelID);
    }
  }

  function build(app, parsed, onProgress) {
    const m = app.model, bim = app.bim;
    const { G, S, reg, faceAt } = makeBuilders(app, m, bim);
    const BT = window.BimTools;
    if (!S || !G || !BT) throw new Error('structural/wall features missing');

    // ---- levels from storeys (reuse an existing level within 1 mm) ----
    if (!app.levelManager.levels.length)
      app.levelManager.addLevel('Ground', parsed.storeys.length ? parsed.storeys[0].z : 0);
    const storeyLevel = new Map();
    for (const st of parsed.storeys) {
      let lv = app.levelManager.levels.find(l => Math.abs(l.elevation - st.z) < 1e-3);
      if (!lv) lv = app.levelManager.addLevel(st.name, st.z);
      storeyLevel.set(st.id, lv.id);
    }
    const nearestLevel = z => {
      let best = null;
      for (const l of app.levelManager.levels)
        if (l.elevation <= z + 1e-3 && (!best || l.elevation > best.elevation)) best = l;
      return best || app.levelManager.levels[0];
    };
    const levelIdFor = (prod, z) =>
      (prod.storeyId && storeyLevel.get(prod.storeyId)) || nearestLevel(z).id;

    const counts = {};
    const bump = k => { counts[k] = (counts[k] || 0) + 1; };
    const converted = new Set();  // expressIDs that became elements
    const fallback = new Set();   // mapped-category products kept as meshes
    const wallRecs = [];          // line walls awaiting their opening cuts
    const levelIds = [...storeyLevel.values()];

    const stages = [];
    // Yield via MessageChannel, not setTimeout: port messages are immune to
    // Chromium's background-page timer freezing — a multi-minute import
    // keeps running when the user switches tabs or the pane is occluded
    const tick = (() => {
      const ch = new MessageChannel();
      const q = [];
      ch.port1.onmessage = () => { const fn = q.shift(); if (fn) fn(); };
      return () => new Promise(r => { q.push(r); ch.port2.postMessage(0); });
    })();
    const stage = (label, fn) => stages.push({ label, fn });

    const heldOp = bim._holdOpDone;
    bim._holdOpDone = true;
    m.beginEdgeSweep();
    // ONE hold for the whole import: construction residue is reaped on this
    // single release (and by finish's reapOrphanEdges) instead of a
    // per-element snapshot/diff of every edge in the model
    m.bimHold = true;
    // plain sweeps: the file's geometry is authoritative — pushPull skips
    // host inference and blocking-face detection (both O(all faces) per
    // sweep; the punch path cascades on same-plane footprint overlaps).
    // autoIntersect is off too: imported elements are INDEPENDENT ISLANDS
    // (the kernel's own v0.6 element-independence contract) — they overlap
    // at junctions by design and the renderer hides the seams
    const heldPlain = m.plainSweeps;
    const heldAI = m.noAutoIntersect;
    m.plainSweeps = true;
    m.noAutoIntersect = true;
    let sweepOpen = true;
    const cleanup = () => {
      if (sweepOpen) {
        try { m.bimHold = false; } catch (e2) { }
        try { m.endEdgeSweep(); } catch (e2) { }
        sweepOpen = false;
      }
      m.plainSweeps = heldPlain;
      m.noAutoIntersect = heldAI;
      bim._holdOpDone = heldOp;
    };

    const productsOf = cat => parsed.products.filter(p => p.cat === cat);

    // ---- foundation (pad footing from a plan rectangle). foundationBounds
    // hangs the pad below a LEVEL datum (top = levelZ), so the import only
    // converts when the file's top plane matches one within 1 mm ----
    stage('foundations', async () => {
      let k = 0;
      for (const prod of productsOf('foundation')) {
        if (++k % 40 === 0) await tick();
        const sw = prod.sw;
        const rl = sw && Math.abs(sw.dir.z) > 0.9 && rectLike(sw.base);
        if (!rl) { fallback.add(prod.id); continue; }
        const c = ringCentroid(sw.base);
        const [zb, zt] = zOf(sw.base.concat(sw.top));
        const lvl = levelIdFor(prod, zt);
        if (Math.abs(S.levelZ(lvl) - zt) > 1e-3) { fallback.add(prod.id); continue; }
        const p = {
          name: prod.name, source: 'ifc', ifc: prod.globalId,
          base: [fmt(c.x), fmt(c.y), fmt(zt)],
          width: fmt(rl.L[0]), depth: fmt(rl.L[1]), thickness: fmt(zt - zb), baseLevel: lvl,
        };
        if (bim.existsLike('foundation', p)) { converted.add(prod.id); continue; }
        try {
          reg('foundation', p,
            () => S.buildFooting(G, m, p), f => faceAt(f, zb, zt - zb));
          converted.add(prod.id); bump('foundation');
        } catch (e) { fallback.add(prod.id); }
      }
    });

    // ---- column (rect prism or the circular family) ----
    stage('columns', async () => {
      let k = 0;
      for (const prod of productsOf('column')) {
        if (++k % 40 === 0) await tick();
        const sw = prod.sw;
        if (!sw || Math.abs(sw.dir.z) <= 0.9) { fallback.add(prod.id); continue; }
        const [zb, zt] = zOf(sw.base.concat(sw.top));
        const h = zt - zb;
        if (h < 0.05) { fallback.add(prod.id); continue; }
        const c = ringCentroid(sw.base);
        const lvl = levelIdFor(prod, zb);
        let p;
        if (sw.prof.kind === 'circle') {
          const d = fmt(2 * sw.prof.r);
          p = {
            name: prod.name, source: 'ifc', ifc: prod.globalId,
            base: [fmt(c.x), fmt(c.y), fmt(zb)], width: d, depth: d,
            height: fmt(h), family: 'circular',
          };
        } else {
          // chamfered / shaped sections: the oriented bounding box keeps the
          // element parametric — the exact shape is a family matter later
          const obb = sw.prof.kind === 'rect'
            ? (() => {
              const rl2 = rectLike(sw.base);
              if (!rl2) return null;
              const c = ringCentroid(sw.base);
              return { cx: c.x, cy: c.y, w: rl2.L[0], h: rl2.L[1], rot: Math.atan2(rl2.D[0][1], rl2.D[0][0]) };
            })()
            : obbFromRing(sw.base);
          if (!obb || obb.w < 0.02 || obb.h < 0.02) { fallback.add(prod.id); continue; }
          p = {
            name: prod.name, source: 'ifc', ifc: prod.globalId,
            base: [fmt(obb.cx), fmt(obb.cy), fmt(zb)],
            width: fmt(obb.w), depth: fmt(obb.h), height: fmt(h),
            rotation: fmt(obb.rot),
          };
        }
        // columnBounds derives z from the level datum — carry the exact
        // world base through baseOffset
        p.baseLevelId = lvl;
        p.baseOffset = fmt(zb - S.levelZ(lvl));
        if (bim.existsLike('column', p)) { converted.add(prod.id); continue; }
        try {
          reg('column', p, () => S.buildColumn(G, m, p), f => faceAt(f, zb, h));
          converted.add(prod.id); bump('column');
        } catch (e) { fallback.add(prod.id); }
      }
    });

    // ---- wall (centerline from a plan rectangle; footprint otherwise) ----
    stage('walls', async () => {
      let k = 0;
      const TR = (root.__ifcTrace = root.__ifcTrace || {});
      for (const prod of productsOf('wall')) {
        TR.walls = k; TR.phase = 'loop'; TR.lastId = prod.id;
        if (++k % 40 === 0) await tick();
        TR.phase = 'checks';
        const sw = prod.sw;
        if (!sw || Math.abs(sw.dir.z) <= 0.9) { fallback.add(prod.id); continue; }
        const bottom = sw.dir.z > 0 ? sw.base : sw.top;
        const [zb, zt] = zOf(sw.base.concat(sw.top));
        const h = zt - zb;
        if (h < 0.05) { fallback.add(prod.id); continue; }
        const lvl = levelIdFor(prod, zb);
        const rl = rectLike(bottom);
        if (rl) {
          let A, B;
          if (rl.runIdx === 0) { A = mid3(bottom[3], bottom[0]); B = mid3(bottom[1], bottom[2]); }
          else { A = mid3(bottom[0], bottom[1]); B = mid3(bottom[3], bottom[2]); }
          const p = {
            name: prod.name, source: 'ifc', ifc: prod.globalId,
            base: [fmt(A[0]), fmt(A[1]), fmt(zb)], end: [fmt(B[0]), fmt(B[1]), fmt(zb)],
            height: fmt(h), thickness: fmt(rl.thickness),
            locationLine: 'centerline', primitive: 'line', closed: false,
            joins: { start: 0, end: 0 },
          };
          // existsLike is a no-op for base/end walls (it keys on baselines)
          // and an O(entities) scan — skip it at import scale
          try {
            TR.phase = 'reg';
            const ent = reg('wall', p, () => {
              TR.s = 'w-ring';
              const ring = bim.wallRing(p);
              TR.s = 'w-addface';
              const f = m.addFaceFromRings(ring.map(q => G.clone(q)));
              if (!f) throw new Error('wall ring degenerate');
              TR.s = 'w-push';
              if (!m.pushPull(f, h)) throw new Error('wall sweep failed');
              TR.s = 'w-done';
              return f;
            }, f => faceAt(f, zb, h));
            converted.add(prod.id); bump('wall');
            if (ent && !p.closed) wallRecs.push({ ent, params: p, A: p.base, B: p.end, prodId: prod.id });
          } catch (e) { fallback.add(prod.id); }
        } else if (bottom.length >= 3 && bottom.length <= 64) {
          // shaped plan section (L/Z/C walls): keep the exact footprint
          let fp = bottom.map(p => [fmt(p.x), fmt(p.y), fmt(zb)]);
          if (planArea(fp) < 0) fp.reverse();
          let minDim = Infinity;
          for (let i = 0; i < fp.length; i++) {
            const q = fp[(i + 1) % fp.length];
            minDim = Math.min(minDim, Math.hypot(q[0] - fp[i][0], q[1] - fp[i][1]));
          }
          const p = {
            name: prod.name, source: 'ifc', ifc: prod.globalId,
            closed: true, footprint: fp, height: fmt(h),
            thickness: fmt(Math.min(minDim, 1)),
            locationLine: 'centerline', primitive: 'line',
          };
          try {
            reg('wall', p, () => {
              const f = m.addFaceFromRings(fp.map(q => G.v(...q)));
              if (!f) throw new Error('wall footprint degenerate');
              if (!m.pushPull(f, h)) throw new Error('wall sweep failed');
              return f;
            }, f => faceAt(f, zb, h));
            converted.add(prod.id); bump('wall');
          } catch (e) { fallback.add(prod.id); }
        } else {
          fallback.add(prod.id);
        }
      }
    });

    // ---- wall openings (IfcOpeningElement boxes → HostedCut) ----
    stage('openings', async () => {
      const byId = new Map(parsed.products.map(p => [p.id, p]));
      const TR2 = (root.__ifcTrace = root.__ifcTrace || {});
      TR2.openCut = TR2.openCut || { tried: 0, ok: 0, errInfo: 0, threw: 0, guarded: 0, noGeom: 0, msgs: [] };
      const note = msg => { if (TR2.openCut.msgs.length < 5) TR2.openCut.msgs.push(String(msg).slice(0, 120)); };
      let k = 0;
      for (const rec of wallRecs) {
        if (++k % 40 === 0) await tick();
        const prod = byId.get(rec.prodId);
        if (!prod || !prod.openings.length) continue;
        for (const oid of prod.openings) {
          const sws = parsed.openGeoms.get(oid);
          if (!sws) { TR2.openCut.noGeom++; continue; }
          const sw = sws.reduce((a, b) => (b.depth > (a ? a.depth : -1) ? b : a), null);
          if (!sw) continue;
          const pts = sw.base.concat(sw.top);
          const [minZ, maxZ] = zOf(pts);
          const A = rec.A, B = rec.B;
          const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
          if (L < 0.1) continue;
          const u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
          let lo = Infinity, hi = -Infinity;
          for (const p of pts) {
            const t = (p.x - A[0]) * u[0] + (p.y - A[1]) * u[1];
            if (t < lo) lo = t;
            if (t > hi) hi = t;
          }
          const width = hi - lo, height = maxZ - minZ;
          const sill = minZ - A[2];
          const wallH = rec.params.height;
          TR2.openCut.tried++;
          if (width < 0.05 || height < 0.05) { TR2.openCut.guarded++; continue; }
          if (sill < -0.02 || sill + height > wallH + 0.02) { TR2.openCut.guarded++; continue; }
          if (lo < 0.02 || hi > L - 0.02) { TR2.openCut.guarded++; continue; } // outside the run
          const spec = {
            distanceFromStart: (lo + hi) / 2, width: fmt(width), height: fmt(height),
            sillHeight: fmt(Math.max(0, sill)), depth: rec.params.thickness,
          };
          const before = new Set(m.faces.keys());
          try {
            m.bimHold = rec.ent.id; // nested named hold — the wall owns its cut
            // a nested hold does NOT set _bimOwner (the setter writes it only
            // on depth 0→1) — without this the owner stays '__new__', every
            // host face fails hostCuttableBy, and the punch finds no host
            m._bimOwner = rec.ent.id;
            let info = null;
            try {
              info = BT.HostedCut.cut(G, m, rec.ent.params, spec);
            } finally {
              m.bimHold = false;
              // nested release keeps depth > 0 — restore the anonymous
              // import hold so later builds don't mis-attribute ownership
              m._bimOwner = null;
            }
            if (!info || info.error) { TR2.openCut.errInfo++; note(info && info.error); continue; }
            const nf = [...m.faces.keys()].filter(id => !before.has(id))
              .map(id => m.faces.get(id)).filter(f => f && !f.userData);
            const roles = {};
            for (const f of nf) roles[f.id] = 'lining';
            const cutFaces = new Set(nf.map(f => f.id));
            const edges = [];
            for (const f of nf) for (const r of m.rings(f)) for (let i = 0; i < r.length; i++) {
              const e = m.findEdge(r[i], r[(i + 1) % r.length]);
              if (e && !e.userData) edges.push(e.id);
            }
            const own = edges.filter(id => {
              const e = m.edges.get(id);
              return e && m.facesAdjacentToEdge(e).every(f => cutFaces.has(f.id));
            });
            bim.create('opening', {
              hostWallId: rec.ent.id, distanceFromStart: info.t,
              sillHeight: spec.sillHeight, width: spec.width, height: spec.height,
              depth: spec.depth, source: 'ifc',
            }, roles, [...new Set(own)]);
            bump('opening');
            TR2.openCut.ok++;
          } catch (e) {
            TR2.openCut.threw++; note(e.message || e);
            // failed cut leaves partial faces unstamped — roll back whole;
            // the wall stays solid and the door/window mesh still shows it
            rollbackFaces(m, before);
          }
        }
      }
    });

    // ---- slab (plan outline at the top plane, swept down) ----
    stage('slabs', async () => {
      let k = 0;
      for (const prod of productsOf('slab')) {
        if (++k % 40 === 0) await tick();
        const sw = prod.sw;
        if (!sw || Math.abs(sw.dir.z) <= 0.9) { fallback.add(prod.id); continue; }
        const top = sw.dir.z > 0 ? sw.top : sw.base;
        const T = sw.depth;
        if (T < 0.01 || top.length < 3 || top.length > 256) { fallback.add(prod.id); continue; }
        const zt = top[0].z;
        const lvl = levelIdFor(prod, zt);
        let outer = top.map(p => [fmt(p.x), fmt(p.y), fmt(zt)]);
        if (planArea(outer) < 0) outer.reverse();
        const p = {
          name: prod.name, source: 'ifc', ifc: prod.globalId,
          regions: [{ outer, holes: [] }], thickness: fmt(T), baseLevel: lvl,
        };
        try {
          reg('floor', p, () => {
            const f = m.addFaceFromRings(outer.map(q => G.v(...q)));
            if (!f) throw new Error('slab face degenerate');
            if (!m.pushPull(f, -T)) throw new Error('slab sweep failed');
            return f;
          }, f => faceAt(f, zt - T, T));
          converted.add(prod.id); bump('slab');
        } catch (e) { fallback.add(prod.id); }
      }
    });

    // ---- beam (horizontal run, absolute zTop — a soffit is not a level) ----
    stage('beams', async () => {
      let k = 0;
      for (const prod of productsOf('beam')) {
        if (++k % 40 === 0) await tick();
        const sw = prod.sw;
        if (!sw || Math.abs(sw.dir.z) > 0.1) { fallback.add(prod.id); continue; }
        const zs = sw.base.map(p => p.z);
        const zBot = Math.min(...zs), zTop = Math.max(...zs);
        const height = zTop - zBot;
        if (height < 0.05) { fallback.add(prod.id); continue; }
        const u = [sw.dir.x, sw.dir.y];
        const n = [-u[1], u[0]];
        let lo = Infinity, hi = -Infinity;
        for (const p of sw.base) {
          const t = p.x * n[0] + p.y * n[1];
          if (t < lo) lo = t;
          if (t > hi) hi = t;
        }
        const webWidth = hi - lo;
        if (webWidth < 0.02) { fallback.add(prod.id); continue; }
        const A = ringCentroid(sw.base), B = ringCentroid(sw.top);
        const zc = (zTop + zBot) / 2;
        const lvl = levelIdFor(prod, zTop);
        const p = {
          name: prod.name, source: 'ifc', ifc: prod.globalId,
          baseline: [[fmt(A.x), fmt(A.y), fmt(zc)], [fmt(B.x), fmt(B.y), fmt(zc)]],
          profile: 'rectangular', webWidth: fmt(webWidth), height: fmt(height),
          zJustification: 'Top', zTop: fmt(zTop),
          referenceLevelId: lvl, baseLevel: lvl,
        };
        if (bim.existsLike('beam', p)) { converted.add(prod.id); continue; }
        try {
          reg('beam', p, () => S.buildBeam(G, m, p), () => 'body');
          converted.add(prod.id); bump('beam');
        } catch (e) { fallback.add(prod.id); }
      }
    });

    const finish = () => {
      try {
        try { m.bimHold = false; } catch (e3) { } // single release: reap residue once
        m.plainSweeps = heldPlain;
        m.noAutoIntersect = heldAI;
        for (const f of m.faces.values()) {
          m.edgesForRing(f.loop, true);
          for (const h of (f.holes || [])) m.edgesForRing(h, true);
        }
        m.reapOrphanEdges();
      } finally {
        m.endEdgeSweep();
        sweepOpen = false;
        bim._holdOpDone = heldOp;
      }
      counts.level = parsed.storeys.length;
      if (app.opDone) { try { app.opDone(); } catch (e) { /* non-fatal */ } }
      return { counts, converted, fallback, levelIds };
    };

    return (async () => {
      const TR = (root.__ifcTrace = root.__ifcTrace || {});
      try {
        for (let i = 0; i < stages.length; i++) {
          const st = stages[i];
          TR.stage = st.label; TR.stageIdx = i;
          if (onProgress) onProgress(st.label, i, stages.length);
          await st.fn();
          TR.done = st.label;
        }
      } catch (e) {
        TR.error = e.message || String(e);
        cleanup();
        throw e;
      }
      TR.phase = 'finish';
      return finish();
    })();
  }

  root.IfcElements = { load, _internals: { parseModel, extrusions, profileLoop, rectLike, obbFromRing, axisMatrix } };
})(window);
