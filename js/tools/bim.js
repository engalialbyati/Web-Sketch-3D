'use strict';
// ---------------------------------------------------------------------------
// tools/bim/* — Revit-style "Precise Drawing" (parametric) tools.
// Namespace: BimTools. They mutate the SAME B-Rep model as the free tools,
// always through app.transaction, and obey the identical Tool lifecycle.
// Vertical constraints come from app.levelManager; every created face/edge is
// stamped with userData {bimEntityId, bimType, role} via app.bim.
// Path input goes through the shared DrawPrimitiveEngine (tools/draw.js) so
// every BIM tool offers the same standardized Draw primitives, chaining,
// location-line offsets, and VCB dimensions.
// ---------------------------------------------------------------------------

// Wall: draw an open baseline (Line / Pick Lines / Arcs) or a closed footprint
// (Rectangle / Polygon / Circle) with the shared primitive engine. The
// options bar drives Base Level, Top Constraint / Unconnected Height,
// Thickness, Location Line, and Chain.
class WallTool extends Tool {
  static id = 'wall';
// ---- wall geometry helpers (pure; shared with BimEntityManager edits) ----
// open path -> wall band: the path offset left/right per the location line
// and capped at both ends (a straight path yields exactly the classic quad)
static bandRing(G, pts, thickness, locationLine) {
  let left = thickness / 2, right = -thickness / 2;
  if (locationLine === 'exterior') { left = 0; right = thickness; }
  else if (locationLine === 'interior') { left = -thickness; right = 0; }
  const A = DrawGeom.parallelOffset(G, pts, false, left);
  const B = DrawGeom.parallelOffset(G, pts, false, right).reverse();
  const ring = [...A, ...B];
  if (G.loopNormal(ring).z < 0) ring.reverse();
  return ring;
};
// location-line offset table shared by bandRing / miteredRing / miterCap
static locOffsets(thickness, locationLine) {
  if (locationLine === 'exterior') return { left: 0, right: thickness };
  if (locationLine === 'interior') return { left: -thickness, right: 0 };
  return { left: thickness / 2, right: -thickness / 2 };
}
// Mitered joint cap for two wall bands meeting at baseline point B: d1 points
// INTO the joint along wall 1, d2 OUT of it along wall 2 (horizontal units);
// off* are the bands' left/right offsets from locOffsets. Returns the two
// points where the bands' side edges cross — [leftPt, rightPt] — or null when
// the bands are collinear or the miter runs absurdly far (a near-reversal),
// in which case the flat perpendicular cap is the right answer.
static miterCap(G, B, d1, off1, d2, off2, t1, t2) {
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-6) return null; // collinear bands: flat cap is exact
  const n1 = G.v(-d1.y, d1.x, 0), n2 = G.v(-d2.y, d2.x, 0);
  const isect = (s1, s2) => {
    const o1 = G.v(B.x + n1.x * s1, B.y + n1.y * s1, 0);
    const o2 = G.v(B.x + n2.x * s2, B.y + n2.y * s2, 0);
    const u = cross(G.sub(o2, o1), d2) / den;
    return G.add(o1, G.mul(d1, u));
  };
  const pl = isect(off1.left, off2.left);
  const pr = isect(off1.right, off2.right);
  const reach = (t1 + t2) * 1.5 + 1e-6;
  if (!pl || !pr) return null;
  if (Math.hypot(pl.x - B.x, pl.y - B.y) > reach || Math.hypot(pr.x - B.x, pr.y - B.y) > reach) return null;
  return [pl, pr];
}
// Band ring whose start/end caps may be mitered: capStart/capEnd are
// [leftPt, rightPt] overrides from miterCap (null = flat perpendicular cap).
static miteredRing(G, P1, P2, thickness, locationLine, capStart, capEnd) {
  const off = WallTool.locOffsets(thickness, locationLine);
  const d = G.norm(G.v(P2.x - P1.x, P2.y - P1.y, 0));
  const n = G.v(-d.y, d.x, 0);
  const z = P1.z;
  const at = (p, s) => G.v(p.x + n.x * s, p.y + n.y * s, z);
  let ring = [at(P1, off.left), at(P2, off.left), at(P2, off.right), at(P1, off.right)];
  if (capStart) ring[0] = G.v(capStart[0].x, capStart[0].y, z), ring[3] = G.v(capStart[1].x, capStart[1].y, z);
  if (capEnd) ring[1] = G.v(capEnd[0].x, capEnd[0].y, P2.z), ring[2] = G.v(capEnd[1].x, capEnd[1].y, P2.z);
  if (G.loopNormal(ring).z < 0) ring.reverse();
  return ring;
}
// closed footprint: the location line decides whether the drawn loop is the
// body center or a finish face grown/shrunk by half the thickness
static closedRing(G, ring, thickness, locationLine) {
  if (locationLine === 'exterior') return DrawGeom.parallelOffset(G, ring, true, thickness / 2);
  if (locationLine === 'interior') return DrawGeom.parallelOffset(G, ring, true, -thickness / 2);
  return ring;
};
// classify generated faces against the parametric path: top/bottom by z,
// end caps perpendicular to the run, sides exterior (left of draw dir) /
// interior. Closed footprints have no caps; their sides are all exterior.
static classifyRoles(G, model, faces, path, closed, baseZ, topZ) {
  const roles = {};
  for (const f of faces) {
    const c = model.faceCentroid(f);
    if (Math.abs(c.z - topZ) < 1e-6) { roles[f.id] = 'top'; continue; }
    if (Math.abs(c.z - baseZ) < 1e-6) { roles[f.id] = 'bottom'; continue; }
    const n = G.loopNormal(model.pts(f.loop));
    if (G.isZero(n)) { roles[f.id] = 'exterior'; continue; }
    let best = null;
    const segs = closed ? path.length : path.length - 1;
    for (let i = 0; i < segs; i++) {
      const a = path[i], b = path[(i + 1) % path.length];
      const ab = G.sub(b, a), L2 = Math.max(1e-12, G.dot(ab, ab));
      const t = Math.max(0, Math.min(1, G.dot(G.sub(c, a), ab) / L2));
      const q = G.add(a, G.mul(ab, t));
      const d = G.dist(c, q);
      if (!best || d < best.d) best = { d, q, dir: G.norm(ab) };
    }
    if (!best) { roles[f.id] = 'exterior'; continue; }
    const h = G.v(best.dir.x, best.dir.y, 0);
    if (G.len(h) > 1e-9 && Math.abs(G.dot(n, G.norm(h))) > 0.9) {
      const total = G.dot(G.sub(path[path.length - 1], path[0]), best.dir);
      roles[f.id] = G.dot(G.sub(c, path[0]), best.dir) < total / 2 ? 'start_cap' : 'end_cap';
      continue;
    }
    const left = G.v(-best.dir.y, best.dir.x, 0);
    roles[f.id] = G.dot(G.sub(c, best.q), left) > 0 ? 'exterior' : 'interior';
  }
  return roles;
};
// ---- grid-driven wall trim ------------------------------------------------
// Pure geometry: endpoints A/B retreat along the wall direction to the FACE
// of the column standing on each end. Grids are centerlines and columns are
// centered on the intersections, so each end gives up HALF the column's
// extent along the run (grid distance 3 m with two 0.4 x 0.4 columns ->
// wall length 3 - 0.2 - 0.2 = 2.6 m, face to face). The extent of an
// axis-aligned w x d footprint along unit direction u is |w*ux| + |d*uy|.
// Returns {a2, b2, len0, len1, tA, tB} or {tooShort} or null.
static gridColumnTrim(G, A, B, colA, colB) {
  const dirV = G.sub(G.v(B.x, B.y, 0), G.v(A.x, A.y, 0));
  const len0 = G.len(dirV);
  if (len0 < 1e-6) return null;
  const dir = G.mul(dirV, 1 / len0);
  const extent = (col) => {
    if (!col) return 0;
    const w = (col.params && col.params.width) || 0.3;
    const d = (col.params && col.params.depth) || 0.3;
    return (Math.abs(w * dir.x) + Math.abs(d * dir.y)) / 2; // centerline -> face
  };
  const tA = extent(colA), tB = extent(colB);
  if (tA + tB <= 1e-9) return null;
  // 1 mm REVEAL: the trimmed endpoints pull 1 mm BACK from the column faces.
  // Landing exactly ON the face puts two coplanar planes in kissing contact —
  // the split cascade hits coincident geometry and degenerate rounds grind
  // the app to a freeze (same reason buildBeam and the slabs carry a reveal).
  const REVEAL = 1e-3;
  const len1 = len0 - tA - tB - 2 * REVEAL;
  if (len1 <= 0.05) return { tooShort: true, len0, len1, tA, tB };
  return {
    a2: G.add(A, G.mul(dir, tA + REVEAL)),
    b2: G.sub(B, G.mul(dir, tB + REVEAL)),
    len0, len1, tA, tB,
  };
}
// App-facing lookup: does this committed straight wall run on ONE grid line
// between two grid intersections that carry columns? Returns the trimmed
// endpoints + reporting info, or null. quiet=true (live preview) suppresses
// the refusal toast. pickedGrid: the grid picked via Pick Lines — used
// directly as the host instead of re-deriving it from endpoint positions.
static gridTrimFor(app, pts, quiet = false, pickedGrid = null) {
  const gm = app.gridManager;
  if (!gm || !gm.grids || !gm.grids.length || typeof SnapSystem === 'undefined') return null;
  if (!pts || pts.length < 2) return null;
  const A = pts[0], B = pts[pts.length - 1];
  const g = (pickedGrid && !pickedGrid.isCurved) ? pickedGrid
    : SnapSystem.gridUnder(gm, [A.x, A.y], 0.05);
  if (!g || g.isCurved) return null;               // straight grid lines only
  if (g.distance([B.x, B.y]) > 0.05) return null;  // wall must sit on one grid
  const ixA = SnapSystem.intersectionAt(gm, [A.x, A.y], 0.05);
  const ixB = SnapSystem.intersectionAt(gm, [B.x, B.y], 0.05);
  if (!ixA || !ixB) return null;                   // both ends at intersections
  if (ixA.a === ixB.a && ixA.b === ixB.b) return null;
  const colAt = (ix) => {
    for (const ent of app.bim.entities) {
      if (ent.type !== 'column' || !ent.params || !ent.params.base) continue;
      const p = ent.params;
      const ref = p.gridRef;
      const byRef = ref && ((ref.a === ix.a.id && ref.b === ix.b.id) || (ref.a === ix.b.id && ref.b === ix.a.id));
      const byPos = Math.hypot(p.base[0] - ix.p[0], p.base[1] - ix.p[1]) <= 0.06;
      if (byRef || byPos) return ent;
    }
    return null;
  };
  const cA = colAt(ixA), cB = colAt(ixB);
  if (!cA && !cB) return null;
  const tr = WallTool.gridColumnTrim(G, A, B, cA, cB);
  if (!tr) return null;
  if (tr.tooShort) {
    if (!quiet) app.toast(`Columns leave only ${fmtLen(tr.len1)} of wall — draw between grids further apart`, true);
    return null;
  }
  return { ...tr, cA, cB, grid: g };
};


  activate() {
    this.engine = new DrawPrimitiveEngine(this.app, {
      primitives: ['line', 'rect', 'polygon', 'circle', 'arc_ser', 'arc_ce', 'pick'],
      getOptions: () => this.app.bimOptions,
      planePoint: ev => this._pt(ev),
      onCommit: r => this._commit(r),
      onModeChange: () => this.status(),
      color: 0x6a1fb0, fill: 0x7b3fa0, fillAlpha: 0.25,
    });
    this.status();
  }
  get hint() {
    const o = this.app.bimOptions;
    const h = o.topConstraint === 'unconnected'
      ? `${fmtLen(o.unconnectedHeight)} high`
      : `up to ${this.app.levelManager.getLevel(o.topConstraint)?.name || 'level'}`;
    const loc = { centerline: 'centerline', exterior: 'exterior face', interior: 'interior face' }[o.locationLine];
    const chained = this.engine && this.engine.chainStart ? ' (chained — Esc breaks)' : '';
    const gridHint = this.app.gridManager && this.app.gridManager.grids.length
      ? ' Snap to grid intersections; a wall between two carrying columns runs face-to-face between them (3 m − 0.2 − 0.2).' : '';
    return `Wall: ${fmtLen(o.thickness)} thick, ${h}, baseline on the ${loc}. Draw with the palette primitives${chained}.${gridHint} VCB: "length" / "radius".`;
  }
  _pt(ev) {
    const anchor = this.engine.stage === 1 ? this.engine.p1 : this.engine.chainStart;
    // WALL ENDPOINTS are the join anchors, but they are analytical points
    // (params.base/end) — the band's B-Rep vertices sit half a thickness
    // away, so aiming at a corner snaps to a band EDGE instead and the miter
    // never fires. Feed the endpoints as live snaps (they win within the
    // inference radius), exactly like FloorTool feeds its sketch boundaries.
    const snaps = [];
    for (const e of this.app.bim.entities) {
      if (e.type !== 'wall' || e.params.closed || !e.params.base || !e.params.end) continue;
      snaps.push({ p: G.v(e.params.base[0], e.params.base[1], e.params.base[2]), kind: 'endpoint', label: 'Wall End' });
      snaps.push({ p: G.v(e.params.end[0], e.params.end[1], e.params.end[2]), kind: 'endpoint', label: 'Wall End' });
    }
    if (this.engine.chainStart) snaps.push({ p: this.engine.chainStart, kind: 'endpoint', label: 'Chain Start' });
    this.app._liveSnaps = snaps;
    const p = this.app.inferPoint(ev, anchor).p;
    const z = this.app.levelManager.getElevation(this.app.bimOptions.baseLevel);
    return G.v(p.x, p.y, z);
  }
  deactivate() {
    this.app._liveSnaps = []; // wall-end snaps belong to this tool only
    super.deactivate();
  }
  _height() {
    const o = this.app.bimOptions;
    const baseZ = this.app.levelManager.getElevation(o.baseLevel);
    if (o.topConstraint === 'unconnected') return o.unconnectedHeight;
    const topZ = this.app.levelManager.getElevation(o.topConstraint);
    return Math.max(0.05, topZ - baseZ);
  }
  // Height the wall will actually get between A and B: the nominal story
  // height minus the structural clearance (slab soffits + drop-beam webs
  // crossing this baseline). Preview and commit share it, so what you see
  // is what gets built.
  _clearedHeight(A, B, hNominal) {
    const app = this.app;
    if (!app.structural || app.bimOptions.topConstraint === 'unconnected')
      return { h: hNominal, deductions: [] };
    const baseZ = app.levelManager.getElevation(app.bimOptions.baseLevel);
    const cl = app.structural.wallClearance({
      base: [A.x, A.y, A.z], end: [B.x, B.y, B.z],
      thickness: app.bimOptions.thickness, topConstraint: app.bimOptions.topConstraint,
    }, { model: app.model });
    if (cl.topZ < baseZ + hNominal - 1e-4)
      return { h: Math.max(0.05, cl.topZ - baseZ), deductions: cl.deductions };
    return { h: hNominal, deductions: [] };
  }
  _bandProfile(pts) {
    const o = this.app.bimOptions;
    return WallTool.bandRing(G, pts, o.thickness, o.locationLine);
  }
  _closedProfile(ring) {
    const o = this.app.bimOptions;
    return WallTool.closedRing(G, ring, o.thickness, o.locationLine);
  }
  // an existing open wall whose endpoint sits at P (within weld tolerance)
  // becomes a miter-join neighbor of the wall being committed
  // Wall-to-wall joint detection at point P (the new wall's endpoint):
  //  1. coincident endpoints (<= 2 cm)  -> MITER join (both walls end here)
  //  2. P lands inside another wall's band near one of its ends (<= max
  //     thickness + 0.5 m of slop) -> WRAP-BUTT join: the new wall extends
  //     to the neighbor's FAR face (exterior runs corner-to-corner) and the
  //     neighbor's near end retreats to the new wall's near face (its end
  //     cap hides inside the joint — nothing exposed on the facade)
  //  3. P lands on the neighbor's band FAR from both ends and the new wall
  //     CROSSES the band (myDir supplied, >= ~25° to the run) -> T-JOIN:
  //     only the new wall's cap retreats onto the host's near face — the
  //     host keeps its geometry and join records (a mid-band cap would
  //     corrupt its end caps). Without this, a 90° wall drawn off another
  //     wall's side simply overlaps it with no join at all.
  _jointAt(P, myBaseZ, myThickness, myDir = null) {
    const app = this.app;
    const tF = myThickness || app.bimOptions.thickness;
    let bestMiter = null, bestButt = null, bestT = null;
    for (const ent of app.bim.entities) {
      if (ent.type !== 'wall' || ent.params.closed || !ent.params.base || !ent.params.end) continue;
      const A2 = G.v(...ent.params.base), B2 = G.v(...ent.params.end);
      if (Math.abs(A2.z - myBaseZ) > 1e-3) continue;
      const L = G.dist(A2, B2);
      if (L < 1e-6) continue;
      const dEnd = G.dist(P, B2), dStart = G.dist(P, A2);
      // 1) coincident endpoints -> miter
      const dMin = Math.min(dEnd, dStart);
      if (dMin < 0.02) {
        if (!bestMiter || dMin < bestMiter.d)
          bestMiter = { ent, side: dEnd <= dStart ? 'end' : 'start', mode: 'miter', d: dMin };
        continue;
      }
      // 2) inside the band, near one end -> wrap-butt
      const dir = G.norm(G.sub(B2, A2));
      const n = G.v(-dir.y, dir.x, 0);
      const q = G.sub(P, A2);
      const tProj = G.dot(q, dir);
      const s = Math.abs(G.dot(q, n));
      const reach = Math.max(ent.params.thickness, tF) + 0.5;
      const inBand = s <= ent.params.thickness / 2 + 0.02 && tProj > -0.05 && tProj < L + 0.05;
      if (inBand && dMin <= reach) {
        if (!bestButt || dMin < bestButt.d)
          bestButt = { ent, side: dEnd <= dStart ? 'end' : 'start', mode: 'butt', d: dMin };
        continue;
      }
      // 3) mid-band crossing far from both ends -> T-join (one-sided)
      if (myDir && inBand && tProj > 0.02 && tProj < L - 0.02 && dMin > reach) {
        const cross = Math.abs(-myDir.x * dir.y + myDir.y * dir.x); // |sin| between the runs
        if (cross > 0.42) {
          const d = s; // how deep into the band the endpoint sits
          if (!bestT || d < bestT.d)
            bestT = { ent, side: dEnd <= dStart ? 'end' : 'start', mode: 'buttTrim', midBand: true, d };
        }
      }
    }
    return bestMiter || bestButt || bestT || null;
  }
  _commit(r) {
    const app = this.app;
    const h = this._height();
    // Construction-wire sweep brackets the WHOLE commit: join rebuilds and
    // the extrusion hold separately, so residue born attached in one stage
    // and orphaned in the next would otherwise slip each stage's sweep
    app.model.beginEdgeSweep();
    try {
      this._commitInner(r, h);
    } finally {
      app.model.endEdgeSweep();
    }
  }
  _commitInner(r, h) {
    // a picked GRID line hosts the wall on that grid directly (Pick Lines ➔
    // grid); consumed here so a later commit never hosts on a stale pick
    const pickedGrid = (this.engine && this.engine.lastPickGrid) || null;
    if (this.engine) this.engine.lastPickGrid = null;
    // GRID TRIM — a wall drawn on one grid line between two carrying
    // intersections runs face-to-face with the columns: each endpoint
    // retreats by half the column's extent along the run (3 m grids,
    // 0.4 x 0.4 centered columns at both ends -> 3 - 0.2 - 0.2 = 2.6 m wall).
    // The trimmed endpoints stay ON the grid, so the hostGridId attachment
    // below still binds.
    let gridTrim = null;
    if ((r.kind === 'line' || r.kind === 'pick') && !r.closed && r.pts.length >= 2) {
      gridTrim = WallTool.gridTrimFor(app, r.pts, false, pickedGrid);
      if (gridTrim) {
        r = {
          ...r,
          pts: r.pts.map((p, i) =>
            i === 0 ? gridTrim.a2 : i === r.pts.length - 1 ? gridTrim.b2 : p),
        };
      }
    }
    let footprint;
    if (r.closed) footprint = this._closedProfile(r.pts);
    else if (r.pts.length >= 2) footprint = this._bandProfile(r.pts);
    else return;
    // Wall joins: an open LINE wall that starts/ends on another wall connects
    // to it — coincident endpoints take the MITER cap; an endpoint landing
    // inside another wall's band near its end takes the WRAP-BUTT (this wall
    // extends to the neighbor's far face, the neighbor's end retreats to this
    // wall's near face — the exterior runs corner-to-corner, nothing exposed).
    // Both sides record the join and recompute it dynamically on rebuilds.
    const joins = { start: null, end: null };
    if (!r.closed && r.kind === 'line') {
      const A = r.pts[0], B = r.pts[r.pts.length - 1];
      const run = G.norm(G.sub(G.v(B.x, B.y, 0), G.v(A.x, A.y, 0)));
      joins.start = this._jointAt(A, A.z, app.bimOptions.thickness, run);
      joins.end = this._jointAt(B, A.z, app.bimOptions.thickness, run);
      if (joins.start || joins.end) {
        const jv = j => j ? { id: j.ent.id, mode: j.mode } : 0;
        const previewParams = {
          base: [A.x, A.y, A.z], end: [B.x, B.y, B.z],
          thickness: app.bimOptions.thickness, locationLine: app.bimOptions.locationLine,
          joins: { start: jv(joins.start), end: jv(joins.end) },
        };
        footprint = app.bim.wallRing(previewParams);
      }
    }
    if (G.loopArea(footprint) < 1e-4 || G.ringDegenerate(footprint)) {
      // join caps (miter apex, butt wrap) can extend past a short wall's own
      // body — shorter than its thickness, the band doubles back on itself
      app.toast('Wall is too short for its thickness at this join — nothing built', true);
      return;
    }
    const a = r.pts[0], b = r.pts[r.pts.length - 1];
    const baseZ = app.levelManager.getElevation(app.bimOptions.baseLevel);
    // STRUCTURAL CLEARANCE — a level-bounded infill wall under slabs / drop
    // beams terminates below the lowest underside crossing its baseline:
    // H_wall = story − t_slab − h_beam_web (walls never overlap structure,
    // no duplicate volume, no z-fighting faces where they meet). A ~1 mm
    // reveal below the governing soffit (which itself sits 0.5 mm low when
    // it is a beam) keeps stacked faces from ever coinciding.
    const { h: hEff, deductions } = this._clearedHeight(a, b, h);
    const wallH = deductions.length ? Math.max(0.05, hEff - 1e-3) : hEff;
    const wallParams = {
      base: [a.x, a.y, a.z], end: [b.x, b.y, b.z],
      baseLevel: app.bimOptions.baseLevel, topConstraint: app.bimOptions.topConstraint,
      height: wallH, nominalHeight: h, clearTopZ: deductions.length ? baseZ + hEff : null,
      structuralDeductions: deductions,
      thickness: app.bimOptions.thickness, locationLine: app.bimOptions.locationLine,
      primitive: r.kind, closed: !!r.closed,
      footprint: footprint.map(p => [p.x, p.y, p.z]), // exact regeneration source
      joins: { start: 0, end: 0 },
    };
    // GRID ATTACHMENT — a straight wall whose both endpoints sit on one grid
    // line hosts on it (SnapSystem snapped them there): the baseline is the
    // grid centerline, and GridManager.updateGrid re-projects the wall when
    // the grid is stretched or moved. A PICKED grid hosts unconditionally —
    // the wall was drawn along it by construction.
    if (pickedGrid && !r.closed) {
      wallParams.hostGridId = pickedGrid.id;
    } else if (r.kind === 'line' && !r.closed && app.gridManager && typeof SnapSystem !== 'undefined') {
      const host = SnapSystem.gridUnder(app.gridManager, [a.x, a.y], 0.03);
      if (host && host.distance([b.x, b.y]) <= 0.03) wallParams.hostGridId = host.id;
    }
    // JOINED WALLS — order matters: the entity registers first (params only),
    // each joined neighbor rebuilds its cap against the new wall's params,
    // and only THEN is the new wall extruded. The joined bands tile the
    // corner exactly, so no stale cap ever coexists with the new band —
    // no wedge gap, no overlap, no exposed end caps.
    let ent = null;
    if (joins.start || joins.end) {
      ent = app.bim.create('wall', wallParams, {}, []);
      // the join transaction fires opDone BEFORE this wall is extruded —
      // the empty-faces sweep there would reap the pre-registration
      ent._pending = true;
      // DRY-RUN the join records: every joined neighbor must stay buildable
      // (its rebuilt ring non-degenerate) or the whole commit is refused —
      // rebuildWallWithHosts refuses degenerate rings by NOT rebuilding, so
      // an unvetted join would silently swallow the neighbor's geometry
      const undo = [];
      let refused = false;
      for (const side of ['start', 'end']) {
        const j = joins[side];
        if (!j) continue;
        // T-JOIN (mid-band): ONE-SIDED — only this wall's cap retreats onto
        // the host's near face. The host's joins stay untouched (a mid-band
        // entry would corrupt its end caps) and so does its geometry, so
        // there is nothing to dry-run or rebuild on its side.
        if (j.midBand) {
          const snapMine = JSON.stringify(ent.params.joins || 0);
          ent.params.joins[side] = { id: j.ent.id, mode: 'buttTrim' };
          undo.push(() => { ent.params.joins = JSON.parse(snapMine); });
          continue;
        }
        // butt on the wrapping wall's side, buttTrim on the trimmed one;
        // miter is symmetric
        const myMode = j.mode;
        const theirMode = j.mode === 'butt' ? 'buttTrim' : 'miter';
        const snapMine = JSON.stringify(ent.params.joins || 0);
        const snapTheirs = JSON.stringify(j.ent.params.joins || 0);
        app.bim.joinWalls(ent.id, j.ent.id, side, j.side, myMode, theirMode);
        undo.push(() => {
          ent.params.joins = JSON.parse(snapMine);
          j.ent.params.joins = JSON.parse(snapTheirs);
        });
        let nr = null;
        try { nr = app.bim.wallRing(j.ent.params); } catch (e) { nr = null; }
        if (!nr || G.ringDegenerate(nr)) { refused = true; break; }
      }
      if (refused) {
        for (const u of undo) u(); // restore every wall's join records
        app.bim.detach(ent.id);
        app.toast('Corner too tight for these wall thicknesses — nothing built', true);
        return;
      }
      for (const side of ['start', 'end']) {
        const j = joins[side];
        if (!j || j.midBand) continue;
        app.transaction.run('wall join', () => app.bim.rebuildWallWithHosts(j.ent.id, false));
      }
    }
    const facesBefore = new Set(app.model.faces.keys());
    const edgesBefore = new Set(app.model.edges.keys());
    let ok = false;
    const tx = app.transaction.begin('wall');
    try {
      app.model.bimHold = true; // the new wall deliberately meets its neighbors
      try {
        const f = app.model.addFaceFromRings(footprint.map(p => G.clone(p)));
        if (!f) throw new Error('degenerate wall footprint');
        if (!app.model.pushPull(f, wallH)) throw new Error('wall extrusion failed');
        ok = true;
      } finally { app.model.bimHold = false; }
      tx.commit();
    } catch (e) {
      tx.rollback();
      console.error('[wall] operation failed and was rolled back', e);
      app.toast('wall failed — model restored', true);
    }
    if (tx.rolledBack) ok = false; // tx-guard rejected the geometry: it is gone, nothing was built
    if (!ok) {
      if (ent) { delete ent._pending; app.bim.detach(ent.id); } // nothing built: registration goes too
      return;
    }
    const newFaces = [...app.model.faces.keys()].filter(id => !facesBefore.has(id)).map(id => app.model.faces.get(id));
    const topZ = baseZ + wallH;
    const roles = WallTool.classifyRoles(G, app.model, newFaces, r.pts, !!r.closed, baseZ, topZ);
    const newEdges = [...app.model.edges.keys()].filter(id => !edgesBefore.has(id));
    if (ent) {
      // fill in the pre-registered entity's faces/edges/roles
      delete ent._pending; // fully built — opDone's sweep may reap it again if its geometry ever goes
      ent.faces = newFaces.map(f => f.id);
      ent.edges = newEdges;
      for (const f of newFaces) f.userData = { bimEntityId: ent.id, bimType: 'wall', role: roles[f.id] || 'exterior' };
      for (const eid of newEdges) {
        const ed = app.model.edges.get(eid);
        if (ed) ed.userData = { bimEntityId: ent.id, bimType: 'wall', role: 'profile' };
      }
      app.bim.ensureWallBottom(ent);
    } else {
      const ent2 = app.bim.create('wall', wallParams, roles, newEdges);
      if (ent2) app.bim.ensureWallBottom(ent2); // founded walls get their underside
    }
    // the new wall's extrude repartitions the shared base plane AFTER the
    // join rebuilds ran — a neighbor's freshly claimed underside can be
    // split into new unstamped pieces by it. Re-rescue the joined neighbors
    // LAST so every wall of the corner keeps a live bottom face.
    for (const side of ['start', 'end']) {
      const j = joins[side];
      if (j && j.ent && app.bim.getEntityById(j.ent.id)) app.bim.ensureWallBottom(j.ent);
    }
    if (gridTrim) {
      app.toast(`Wall on grid ${gridTrim.grid.name}: ${fmtLen(gridTrim.len1)} clear — ${fmtLen(gridTrim.len0)} between grids − ${fmtLen(gridTrim.tA)}${gridTrim.tB ? ' − ' + fmtLen(gridTrim.tB) : ''} of column`);
    }
    this.status();
  }
  onMove(ev) {
    this.engine.onMove(ev);
    // solid preview: extrude the live band of a line baseline (at the height
    // it will actually get — clearance included), trimmed to the columns when
    // the run sits on grids between carrying intersections
    const e = this.engine, view = this.app.view;
    const start = e.stage === 1 ? e.p1 : e.chainStart;
    if (e.primitive === 'line' && start && e.cur) {
      let tr = null;
      try { tr = WallTool.gridTrimFor(this.app, [start, e.cur], true); } catch (err) { }
      const pvA = tr ? tr.a2 : start;
      const pvB = tr ? tr.b2 : e.cur;
      const ring = this._bandProfile([pvA, pvB]);
      const { h } = this._clearedHeight(start, e.cur, this._height());
      const top = ring.map(q => G.add(q, G.v(0, 0, h)));
      view.previewFill([{ outer: top }], 0x7b3fa0, 0.25);
      view.previewLoop(top, 0x6a1fb0);
      if (tr) view.stickyLabel(G.mul(G.add(pvA, pvB), 0.5),
        `wall ${fmtLen(tr.len1)} (${fmtLen(tr.len0)} − columns)`, '#5b3fa8', 0, -42);
    }
  }
  onDown(ev) { this.engine.onDown(ev); }
  onUp(ev) { this.engine.onUp(ev); }
  onKey(ev) {
    const handled = this.engine.onKey(ev);
    if (handled) this.status();
    return handled;
  }
  onVCB(t) { return this.engine.onVCB(t); }
}

// Floor: Revit Sketch Mode. Activating the tool isolates the viewport (the
// model ghosts, selection clears) and every Draw primitive accumulates a
// magenta boundary segment on the Base Level plane. The green check commits:
// the sketch is validated (closed loops, no illegal crossings, contained
// loops become openings) and each region extrudes DOWN by the slab
// thickness as a registered slab element. The red cross discards.
class FloorTool extends Tool {
  static id = 'floor';
  static thickness = 0.20; // m
  static SKETCH_COLOR = 0xd946ef;
  activate() {
    this._sketch = [];     // committed boundary paths this interaction
    this._err = null;      // validation error highlight
    this.engine = new DrawPrimitiveEngine(this.app, {
      primitives: ['line', 'rect', 'polygon', 'circle', 'arc_ser', 'arc_ce', 'pick'],
      getOptions: () => this.app.bimOptions,
      planePoint: ev => this._pt(ev),
      onCommit: r => this._addPath(r),
      onModeChange: () => this.status(),
      color: FloorTool.SKETCH_COLOR, fill: 0xd946ef, fillAlpha: 0.12,
    });
    this.app.enterSketchMode('Floor boundary', () => this._commitSketch(), () => this._cancelSketch());
    this.status();
  }
  deactivate() {
    this.app.exitSketchMode();
    super.deactivate();
  }
  get hint() {
    const lvl = this.app.levelManager.getLevel(this.app.bimOptions.baseLevel);
    const acc = this._sketch.length ? ` ${this._sketch.length} boundar${this._sketch.length === 1 ? 'y' : 'ies'} sketched.` : '';
    return `Sketch Mode — Floor: draw closed boundar${'ies'} on ${lvl ? lvl.name : 'the base level'} (chain lines/arcs; contained loops become openings).${acc} ✓ commits, ✗ discards.`;
  }
  _pt(ev) {
    const anchor = this.engine.stage === 1 ? this.engine.p1
      : (this._sketch.length ? this._lastEnd() : this.engine.chainStart);
    // sketched boundaries are preview-only — never model edges — so their
    // endpoints must be fed to the inference explicitly for chains to close
    // cleanly on the first/last boundary point
    const snaps = [];
    for (const path of this._sketch) {
      if (!path.pts.length) continue;
      snaps.push({ p: path.pts[0], kind: 'endpoint', label: 'Boundary End' });
      snaps.push({ p: path.pts[path.pts.length - 1], kind: 'endpoint', label: 'Boundary End' });
    }
    if (this.engine.chainStart) snaps.push({ p: this.engine.chainStart, kind: 'endpoint', label: 'Chain Start' });
    this.app._liveSnaps = snaps;
    const inf = this.app.inferPoint(ev, anchor);
    if (inf.kind === 'endpoint' || inf.kind === 'midpoint' || inf.kind === 'center'
      || inf.kind === 'edge' || inf.kind === 'gridX')
      this.app.view.showSnapDot(inf.p, inf.kind === 'gridX' ? 'endpoint' : inf.kind); // snap feedback while sketching
    const z = this.app.levelManager.getElevation(this.app.bimOptions.baseLevel);
    return G.v(inf.p.x, inf.p.y, z);
  }
  _lastEnd() {
    const last = this._sketch[this._sketch.length - 1];
    return last ? last.pts[last.pts.length - 1] : null;
  }
  _addPath(r) {
    this._sketch.push({ pts: r.pts.map(p => G.clone(p)), closed: !!r.closed });
    this._err = null;
    this.status();
  }
  // ---------------------------------------------------------- validation UI
  _showError(err) {
    this._err = err;
    const view = this.app.view;
    view.clearPreview();
    if (err && err.p) {
      const p = err.p, s = Math.max(0.05, this.app.view.cam.dist * 0.012);
      const ring = [G.v(p.x - s, p.y - s, p.z + 0.01), G.v(p.x + s, p.y - s, p.z + 0.01),
        G.v(p.x + s, p.y + s, p.z + 0.01), G.v(p.x - s, p.y + s, p.z + 0.01)];
      view.previewLoop(ring, 0xf97316);
      view.previewLine([ring[0], ring[2]], 0xf97316);
      view.previewLine([ring[1], ring[3]], 0xf97316);
      const sc = view.toScreen(p);
      if (sc) view.hudLabel(sc.x, sc.y - 22, err.msg, '#ea580c');
    }
    this.app.toast(err ? err.msg : 'Validation failed');
    this.app.setStatus(err ? `Sketch error: ${err.msg}` : 'Validation failed');
  }
  _drawSketch() {
    const view = this.app.view;
    for (const path of this._sketch) {
      const q = path.closed ? [...path.pts, path.pts[0]] : path.pts;
      view.previewLine(q, FloorTool.SKETCH_COLOR);
    }
  }
  // ------------------------------------------------------------ commit flow
  _commitSketch() {
    const app = this.app, m = app.model;
    if (!this._sketch.length) { app.toast('Nothing sketched yet'); return; }
    const v = SketchValidator.validate(this._sketch);
    if (!v.ok) { this._showError(v.error); return; }
    if (!v.regions.length) { this.toast && this.toast('No closed boundary'); return; }
    const th = FloorTool.thickness;
    const z = this.app.levelManager.getElevation(app.bimOptions.baseLevel);
    // STRUCTURAL PRECEDENCE — columns passing through this slab punch their
    // footprints as openings, so the slab never duplicates column volume
    // (Column ≻ Slab) and no coplanar faces z-fight at the shared plane.
    // Walls under the region regenerate below the soffit FIRST, so the slab
    // sweep never lands on untrimmed wall tops.
    const pendingSlab = {
      id: '__pending__',
      type: 'slab',
      params: {
        baseLevel: app.bimOptions.baseLevel, thickness: th,
        regions: v.regions.map(r => ({ outer: r.outer.map(p => [p.x, p.y, p.z]), holes: r.holes.map(h2 => h2.map(p => [p.x, p.y, p.z])) })),
      },
    };
    if (app.preTrimWallsFor) app.preTrimWallsFor(pendingSlab);
    // drop-panel columns under this slab re-hang below its future soffit
    // FIRST — the sweep then never lands on their heads (and they don't punch)
    if (app.syncDropPanels) app.syncDropPanels([pendingSlab]);
    const colHoles = new Map(); // region index -> punch rings
    if (app.structural) {
      v.regions.forEach((region, i) => {
        const holes = app.structural.columnHolesForSlab(m,
          { baseLevel: app.bimOptions.baseLevel, thickness: th, _planeZ: z },
          { outer: region.outer.map(p => [p.x, p.y, p.z]), holes: region.holes.map(h => h.map(p => [p.x, p.y, p.z])) });
        if (holes.length) colHoles.set(i, holes);
      });
    }
    const facesBefore = new Set(m.faces.keys());
    const edgesBefore = new Set(m.edges.keys());
    let ok = false;
    app.transaction.run('sketch slab', mm => {
      mm.bimHold = true; // slabs deliberately interpenetrate walls/windows —
      try {               // stamps propagate to split pieces, entities stay
        v.regions.forEach((region, i) => {
          const punches = (colHoles.get(i) || []).map(h => h.ring.map(p => G.clone(p)));
          const f = mm.addFaceFromRings(region.outer.map(p => G.clone(p)),
            region.holes.map(h => h.map(p => G.clone(p))).concat(punches));
          if (!f) throw new Error('degenerate slab boundary');
          // forceBaseCap: a slab drawn beside another slab must close into a
          // solid — the shared boundary edge alone must not swallow its top
          if (!mm.pushPull(f, -th, true)) throw new Error('slab extrusion failed');
        });
        ok = true;
      } finally { mm.bimHold = false; }
    });
    if (!ok) return;
    const newFaces = [...m.faces.keys()].filter(id => !facesBefore.has(id)).map(id => m.faces.get(id));
    const roles = {};
    for (const f of newFaces) {
      const c = m.faceCentroid(f);
      roles[f.id] = Math.abs(c.z - z) < 1e-6 ? 'top'
        : Math.abs(c.z - (z - th)) < 1e-6 ? 'bottom' : 'edge';
    }
    const newEdges = [...m.edges.keys()].filter(id => !edgesBefore.has(id));
    app.bim.create('slab', {
      baseLevel: app.bimOptions.baseLevel, levelId: app.bimOptions.baseLevel,
      thickness: th, source: 'sketch',
      regions: v.regions.map((r, i) => ({
        outer: r.outer.map(p => [p.x, p.y, p.z]),
        holes: r.holes.map(h => h.map(p => [p.x, p.y, p.z]))
          .concat((colHoles.get(i) || []).map(h => h.ring.map(p => [p.x, p.y, p.z]))),
      })),
    }, roles, newEdges);
    app.setTool('select'); // deactivate() exits sketch mode
    // dynamic infill walls under the new slab trim to their clear height
    const trimmed = app.syncStructuralWalls ? app.syncStructuralWalls() : 0;
    // drop heads under the new slab (pre-fitted above; this catches any the
    // pre-fit skipped — e.g. columns whose shaft only now counts as covered)
    const fitted = app.syncDropPanels ? app.syncDropPanels() : 0;
    // top-face area of the committed regions — the sketch's measured area
    const areaSum = newFaces.reduce((s, f) => s + (roles[f.id] === 'top' ? m.faceArea(f) : 0), 0);
    app.toast(`Slab committed — ${v.regions.length} region${v.regions.length === 1 ? '' : 's'}, ${areaSum.toFixed(2)} m², ${v.regions.reduce((s, r) => s + r.holes.length, 0)} opening(s)`
      + [...colHoles.values()].reduce((s, h) => s + h.length, 0) + ` column cut${[...colHoles.values()].reduce((s, h) => s + h.length, 0) === 1 ? '' : 's'}`
      + (trimmed ? `, ${trimmed} wall${trimmed === 1 ? '' : 's'} trimmed` : ''));
    if (areaSum > 0) {
      const topFace = newFaces.find(f => roles[f.id] === 'top') || newFaces[0];
      if (topFace) {
        const c = m.faceCentroid(topFace);
        app.view.pinLabel(G.v(c.x, c.y, z + 0.002), `${areaSum.toFixed(2)} m²`, '#1d4f9c', topFace.id);
      }
    }
  }
  _cancelSketch() {
    this.app.setTool('select'); // deactivate() exits sketch mode
    this.app.setStatus('Sketch discarded.');
  }
  // ------------------------------------------------------------- delegation
  onMove(ev) {
    this.engine.onMove(ev);
    this._drawSketch();
    if (this._err) this._showError(this._err); // keep the highlight live
  }
  onDown(ev) { this.engine.onDown(ev); }
  onUp(ev) { this.engine.onUp(ev); }
  onKey(ev) {
    if (ev.key === 'Escape') {
      if (this._err) { this._err = null; this.app.view.clearPreview(); return true; }
      const handled = this.engine.onKey(ev);
      if (handled) { this.status(); return true; }
      // Esc with nothing pending keeps what's already sketched — a stray
      // keypress must not discard drawn boundaries; ✗ (or Esc on an empty
      // sketch) is the explicit discard
      if (this._sketch.length) {
        this.app.setStatus(`Sketch kept (${this._sketch.length} boundar${this._sketch.length === 1 ? 'y' : 'ies'}) — Enter/✓ commits, ✗ discards.`);
        return true;
      }
      this._cancelSketch(); // nothing sketched: Esc just leaves the tool
      return true;
    }
    return this.engine.onKey(ev);
  }
  onVCB(text) {
    const m = /^\s*([\d.]+)\s*[x,]\s*([\d.]+)(?:\s*[x,]\s*([\d.]+))?\s*$/.exec(String(text));
    if (m && this.engine.primitive === 'rect' && this.engine.stage === 1 && this.engine.p1) {
      const p1 = this.engine.p1;
      if (m[3] && parseFloat(m[3]) > 0) FloorTool.thickness = parseFloat(m[3]);
      this.engine._click(G.v(p1.x + parseFloat(m[1]), p1.y + parseFloat(m[2]), p1.z));
      return true;
    }
    return this.engine.onVCB(text);
  }
}

// Convert: Free Drawing geometry -> parametric BIM. Click a closed free face:
// 'floor' extrudes it down by the floor thickness (a finish-floor element),
// 'slab' extrudes it down by the slab thickness (the face becomes the slab
// top) and registers a SlabElement; 'wall' extrudes it along its normal up to
// the Top Constraint and registers a wall entity. Already-stamped faces are
// refused — edit those with Push/Pull or the shape handles instead.
class ConvertTool extends Tool {
  static id = 'convert';
  static slabThickness = 0.25;  // m
  static floorThickness = 0.20; // m
  activate() { this.hover = null; this.status(); }
  get hint() {
    const mode = this.app.bimOptions.convertMode;
    const label = mode === 'wall' ? 'wall (extruded along its normal)'
      : `${mode} (extruded down ${fmtLen(mode === 'floor' ? ConvertTool.floorThickness : ConvertTool.slabThickness)})`;
    return `Convert: click a Free Drawing face to turn it into a ${label}. Choose the target on the palette.`;
  }
  _height() {
    const o = this.app.bimOptions;
    const baseZ = this.app.levelManager.getElevation(o.baseLevel);
    if (o.topConstraint === 'unconnected') return o.unconnectedHeight;
    return Math.max(0.05, this.app.levelManager.getElevation(o.topConstraint) - baseZ);
  }
  onMove(ev) {
    const fid = this.app.view.pickFaceAt(this.app.view.eventPt(ev));
    this.hover = fid;
    this.app.view.setHoverFace(fid);
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const app = this.app, m = app.model;
    const fid = app.view.pickFaceAt(this.app.view.eventPt(ev));
    if (fid == null) return;
    ConvertTool.convertFace(app, m.faces.get(fid), app.bimOptions.convertMode);
    this.activate();
  }
  // Shared entry point — the tool's click and the context menu on a selected
  // face both funnel through here. Returns the created entity (or null, after
  // toasting the reason). mode: 'floor' | 'slab' | 'wall' | 'column' |
  // 'beam' | any custom type name (swept along the face normal).
  // opts.height overrides the sweep length (the dialog passes a typed value).
  static convertFace(app, f, mode, opts = {}) {
    if (!f) return null;
    const m = app.model;
    if (f.userData && f.userData.bimEntityId) { app.toast('That face is already a BIM element'); return null; }
    if (m.faceArea(f) < 1e-6 || G.isZero(G.loopNormal(m.pts(f.loop)))) { app.toast('Pick a valid closed face'); return null; }
    const path = m.pts(f.loop).map(p => G.clone(p));
    const n = G.loopNormal(path);
    const facesBefore = new Set(m.faces.keys());
    const edgesBefore = new Set(m.edges.keys());
    let ok = false;
    if (mode === 'slab' || mode === 'floor') {
      const th = mode === 'floor' ? ConvertTool.floorThickness : ConvertTool.slabThickness;
      const zTop = path[0].z;
      app.transaction.run('convert to ' + mode, mm => {
        if (!mm.pushPull(f, -th, true)) throw new Error(mode + ' extrusion failed'); // solid beside neighbors keeps its top
        ok = true;
      });
      if (!ok) return null;
      const newFaces = [...m.faces.keys()].filter(id => !facesBefore.has(id)).map(id => m.faces.get(id));
      const roles = {};
      for (const g of newFaces) {
        const c = m.faceCentroid(g);
        roles[g.id] = Math.abs(c.z - zTop) < 1e-6 ? 'top'
          : Math.abs(c.z - (zTop - th)) < 1e-6 ? 'bottom' : 'edge';
      }
      const newEdges = [...m.edges.keys()].filter(id => !edgesBefore.has(id));
      const ent = app.bim.create(mode, {
        baseLevel: app.bimOptions.baseLevel, levelId: app.bimOptions.baseLevel,
        thickness: th, source: 'convert',
        // the custom shape itself is the regeneration source
        regions: [{ outer: path.map(p => [p.x, p.y, p.z]), holes: (f.holes || []).map(h => m.pts(h).map(p => [p.x, p.y, p.z])) }],
      }, roles, newEdges);
      if (app.syncStructuralWalls) app.syncStructuralWalls(); // walls under it trim
      if (app.syncDropPanels) app.syncDropPanels(); // drop heads hang under it
      app.toast(`Converted to ${mode}`);
      if (app._dbSyncDebounced) app._dbSyncDebounced();
      return ent;
    }
    // extrude along the face normal (up for horizontal faces, outward for
    // vertical profiles) by the wall height
    if (mode !== 'wall') return ConvertTool.convertToElement(app, f, mode, opts);
    const h = ConvertTool.heightFor(app);
    const dir = n.z < -0.9 ? -1 : 1; // keep the sweep on the visible side
    app.transaction.run('convert to wall', mm => {
      if (!mm.pushPull(f, h * dir)) throw new Error('wall extrusion failed');
      ok = true;
    });
    if (!ok) return null;
    const newFaces = [...m.faces.keys()].filter(id => !facesBefore.has(id)).map(id => m.faces.get(id));
    const zs = newFaces.flatMap(g => m.pts(g.loop).map(p => p.z));
    const zLo = Math.min(...zs), zHi = Math.max(...zs);
    const roles = WallTool.classifyRoles(G, m, newFaces, path, true, zLo, zHi);
    const newEdges = [...m.edges.keys()].filter(id => !edgesBefore.has(id));
    const a = path[0], b = path[path.length - 1];
    const ent = app.bim.create('wall', {
      base: [a.x, a.y, a.z], end: [b.x, b.y, b.z], closed: true,
      baseLevel: app.bimOptions.baseLevel, topConstraint: app.bimOptions.topConstraint,
      height: h, thickness: 0, locationLine: 'centerline', primitive: 'convert',
      footprint: path.map(p => [p.x, p.y, p.z]),
    }, roles, newEdges);
    app.toast('Converted to wall');
    if (app._dbSyncDebounced) app._dbSyncDebounced();
    return ent;
  }
  // Generic element conversion — column, beam, or any user-named type: the
  // custom shape is swept along the face normal (the drawn profile IS the
  // element's cross-section) and stamped with type-specific parametric seeds
  // so the catalog, quantities, and edit-in-place all work on it.
  static convertToElement(app, f, mode, opts = {}) {
    const m = app.model;
    const path = m.pts(f.loop).map(p => G.clone(p));
    const n = G.loopNormal(path);
    const h = Math.max(0.05, opts.height != null ? opts.height : ConvertTool.heightFor(app));
    const dir = n.z < -0.9 ? -1 : 1; // keep the sweep on the visible side
    const facesBefore = new Set(m.faces.keys());
    const edgesBefore = new Set(m.edges.keys());
    let ok = false;
    app.transaction.run('convert to ' + mode, mm => {
      if (!mm.pushPull(f, h * dir)) throw new Error(mode + ' extrusion failed');
      ok = true;
    });
    if (!ok) return null;
    const newFaces = [...m.faces.keys()].filter(id => !facesBefore.has(id)).map(id => m.faces.get(id));
    // the swept anchor keeps its id through pushPull — it is the far cap and
    // belongs to the element as much as the freshly created sides
    if (m.faces.has(f.id) && !newFaces.some(g => g.id === f.id)) newFaces.push(m.faces.get(f.id));
    const zs = newFaces.flatMap(g => m.pts(g.loop).map(p => p.z));
    const zLo = Math.min(...zs), zHi = Math.max(...zs);
    // horizontal profiles classify by z (top/bottom/side); vertical ones by
    // the sweep direction (caps at the ends, sides around)
    const horiz = Math.abs(n.z) > 0.5;
    const roles = {};
    for (const g of newFaces) {
      const gn = G.loopNormal(m.pts(g.loop));
      roles[g.id] = horiz
        ? (Math.abs(m.faceCentroid(g).z - zHi) < 1e-6 ? 'top'
          : Math.abs(m.faceCentroid(g).z - zLo) < 1e-6 ? 'bottom' : 'side')
        : (G.dot(gn, n) > 0.9 ? 'end_cap' : G.dot(gn, n) < -0.9 ? 'start_cap' : 'side');
    }
    const newEdges = [...m.edges.keys()].filter(id => !edgesBefore.has(id));
    // parametric seeds from the drawn profile's XY bounds — the exact custom
    // shape stays in `profile` as the regeneration source (like slab regions)
    const xs = path.map(p => p.x), ys = path.map(p => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const width = Math.max(0.05, x1 - x0), depth = Math.max(0.05, y1 - y0);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const alongX = width >= depth;
    const params = {
      source: 'convert',
      height: h,
      profile: path.map(p => [p.x, p.y, p.z]),
      baseLevel: app.bimOptions.baseLevel,
      topConstraint: app.bimOptions.topConstraint,
    };
    if (mode === 'column') {
      params.base = [cx, cy, dir > 0 ? zLo : zHi - h];
      params.width = width; params.depth = depth;
    } else if (mode === 'beam') {
      params.baseline = alongX
        ? [[x0, cy, zLo], [x1, cy, zLo]]
        : [[cx, y0, zLo], [cx, y1, zLo]];
      params.width = alongX ? depth : width;
    }
    const ent = app.bim.create(mode, params, roles, newEdges);
    app.toast(`Converted to ${mode} — ${h.toFixed(2)} m sweep, custom profile kept`);
    if (app._dbSyncDebounced) app._dbSyncDebounced();
    return ent;
  }
  // Claim an existing multi-face body (e.g. a drawn rectangle pushed to a
  // thickness, selected as a set of faces) as ONE element. No geometry is
  // created or changed — the selected faces become the element's B-Rep, with
  // role classification and parametric seeds from the combined bounds. The
  // entity registers through the normal stamping path, so the catalog grows
  // its type and the Element Browser lists it after the db sync.
  static convertFaces(app, faces, mode, opts = {}) {
    const m = app.model;
    const list = [...new Set(faces)].filter(f => f && m.faces.has(f.id)
      && !(f.userData && f.userData.bimEntityId));
    if (!list.length) { app.toast('Nothing to convert — pick unclaimed faces'); return null; }
    const pts = list.flatMap(f => m.pts(f.loop));
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y), zs = pts.map(p => p.z);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const zLo = Math.min(...zs), zHi = Math.max(...zs);
    const width = Math.max(0.05, x1 - x0), depth = Math.max(0.05, y1 - y0);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    // roles from the body's own extents: top/bottom planes by centroid z,
    // everything else is a side (works for slabs, boxes, walls-as-bodies)
    const roles = {};
    for (const f of list) {
      const c = m.faceCentroid(f);
      roles[f.id] = Math.abs(c.z - zHi) < 1e-6 ? 'top'
        : Math.abs(c.z - zLo) < 1e-6 ? 'bottom' : 'side';
    }
    // the profile is the bottom face's loop (largest at zLo), falling back to
    // the largest face overall — the regeneration source, like slab regions
    const byArea = [...list].sort((a, b) => m.faceArea(b) - m.faceArea(a));
    const bottom = byArea.find(f => Math.abs(m.faceCentroid(f).z - zLo) < 1e-6) || byArea[0];
    const profile = m.pts(bottom.loop).map(p => [p.x, p.y, p.z]);
    const profileEdges = [];
    for (let i = 0; i < bottom.loop.length; i++) {
      const e = m.findEdge(bottom.loop[i], bottom.loop[(i + 1) % bottom.loop.length]);
      if (e && !e.userData) profileEdges.push(e.id);
    }
    const alongX = width >= depth;
    const params = {
      source: 'convert',
      primitive: 'convert-multi',
      baseLevel: app.bimOptions.baseLevel,
      topConstraint: app.bimOptions.topConstraint,
      width, depth,
      height: Math.max(1e-4, zHi - zLo),
      profile,
      bbox: { x0, y0, x1, y1, zLo, zHi },
    };
    if (mode === 'column') params.base = [cx, cy, zLo];
    else if (mode === 'beam') {
      params.baseline = alongX
        ? [[x0, cy, zLo], [x1, cy, zLo]]
        : [[cx, y0, zLo], [cx, y1, zLo]];
      params.width = alongX ? depth : width;
    }
    let ent = null;
    app.transaction.run('convert to ' + mode, () => {
      ent = app.bim.create(mode, params, roles, profileEdges);
    });
    if (!ent) return null;
    app.toast(`Converted ${list.length} faces to ${mode} — listed in the Element Browser`);
    if (app._dbSyncDebounced) app._dbSyncDebounced();
    return ent;
  }
  static heightFor(app) {
    const o = app.bimOptions;
    const baseZ = app.levelManager.getElevation(o.baseLevel);
    if (o.topConstraint === 'unconnected') return o.unconnectedHeight;
    return Math.max(0.05, app.levelManager.getElevation(o.topConstraint) - baseZ);
  }
}

// ====================================================== hosted insertions
// Revit-style Hosted Insertion: doors, windows, and wall openings cut their
// host wall parametrically. HostedCut does the geometry (pure model calls,
// unit-testable); HostedInsertionTool is the shared interaction (host
// snapping, oriented preview, end-distance dimensions, VCB sizing).
class HostedCut {
  // wall: { base, end, thickness, locationLine } params-like; spec:
  // { distanceFromStart, width, height, sillHeight }. Punches a rectangular
  // opening through the wall via the exact through-punch sweep: both wall
  // faces holed, reveal walls stitched, no redundant internal faces.
  // shared placement math for cut + frame flips: the opening rect on the
  // host's near plane and the direction into the body. wall: { base, end,
  // thickness, locationLine } params-like — locationLine 'face' marks a
  // free-face host: the baseline lies ON the picked face's plane and the
  // into-direction is supplied precomputed (wall.into = [x, y]).
  static locate(G, wall, spec) {
    const P1 = G.v(wall.base[0], wall.base[1], wall.base[2]);
    const P2 = G.v(wall.end[0], wall.end[1], wall.end[2]);
    const dir = G.norm(G.v(P2.x - P1.x, P2.y - P1.y, 0));
    const L = G.dist(P1, P2);
    const half = spec.width / 2;
    if (L < spec.width + 0.2) return { error: 'host face is shorter than the opening' };
    const t = Math.min(Math.max(spec.distanceFromStart, half + 0.05), L - half - 0.05);
    const c = G.add(P1, G.mul(dir, t));
    let leftOff, into;
    if (wall.locationLine === 'face') {
      leftOff = G.v(0, 0, 0); // baseline is already on the picked face's plane
      into = G.v(wall.into[0], wall.into[1], 0);
    } else {
      const ring = WallTool.bandRing(G, [P1, P2], wall.thickness, wall.locationLine);
      leftOff = G.sub(ring[0], G.v(P1.x, P1.y, ring[0].z)); // left plane offset
      into = G.mul(G.norm(leftOff), -1);                    // toward the far plane
    }
    const z0 = P1.z + spec.sillHeight, z1 = z0 + spec.height;
    const a = G.add(c, G.mul(dir, -half)), b = G.add(c, G.mul(dir, half));
    let rect = [
      G.v(a.x + leftOff.x, a.y + leftOff.y, z0), G.v(b.x + leftOff.x, b.y + leftOff.y, z0),
      G.v(b.x + leftOff.x, b.y + leftOff.y, z1), G.v(a.x + leftOff.x, a.y + leftOff.y, z1),
    ];
    if (G.dot(G.loopNormal(rect), into) < 0) rect.reverse();
    return { t, center: c, into, dir, rect, P1, P2, L };
  }
  static cut(G, model, wall, spec) {
    const loc = HostedCut.locate(G, wall, spec);
    if (loc.error) return loc;
    const rect = loc.rect, into = loc.into;
    // spec.depth (Properties "Depth") overrides the host thickness — a
    // smaller value cuts a pocket instead of going through
    const depth = spec.depth > 0 ? spec.depth : wall.thickness;
    const far = rect.map(p => G.add(p, G.mul(into, depth)));
    let partial = false;
    // 1) cut BOTH host faces: punch when the rect is interior, boundary-split
    //    when it touches an edge (a sill-0 door reaches the bottom). The far
    //    ring only punches when it reaches the exit face — otherwise it stays
    //    as the back cap of a partial-depth pocket.
    for (let i = 0; i < 2; i++) {
      const ring = i === 0 ? rect : [...far].reverse();
      const f = model.addFaceFromRings(ring.map(p => G.clone(p)));
      if (!f) return { error: 'degenerate opening rect' };
      const r = model.punchOrSplit(f);
      if (r !== 'punch' && r !== 'split') {
        if (i === 1) { partial = true; continue; } // pocket back cap — keep the face
        const loop = [...f.loop];
        model.faces.delete(f.id); // the void itself — never a filler face
        model.reapRingEdges(loop); // its border would linger as wire lines
        return { error: 'opening does not sit inside a host face' };
      }
      const loop = [...f.loop];
      model.faces.delete(f.id); // the void itself — never a filler face
      model.reapRingEdges(loop); // its border would linger as wire lines
    }
    // 2) stitch the reveal band between the two openings (sides, head, and
    //    the threshold at the floor) — welded rings, no internal caps
    const mid = G.mul(G.add(rect[0], far[2]), 0.5); // tunnel center
    for (let i = 0; i < rect.length; i++) {
      const a1 = rect[i], b1 = rect[(i + 1) % rect.length];
      const a2 = far[i], b2 = far[(i + 1) % far.length];
      if (G.dist(a1, a2) < 1e-6 && G.dist(b1, b2) < 1e-6) continue; // flush edge
      let q = [G.clone(a1), G.clone(b1), G.clone(b2), G.clone(a2)];
      // orient the reveal into the void so the shell volume stays exact
      const c = G.mul(q.reduce((s, p) => G.add(s, p), G.v(0, 0, 0)), 0.25);
      if (G.dot(G.loopNormal(q), G.sub(mid, c)) < 0) q.reverse();
      model.addFaceFromRings(q);
    }
    model.gc();
    return { t: loc.t, center: loc.center, into: loc.into, dir: loc.dir, rect, depth, partial };
  }

  // frame + leaf faces inside a freshly cut opening. flip: { facing, hand }.
  static frame(G, model, info, spec, kind, flip) {
    const rect = info.rect, into = info.into;
    const a = rect[0], b = rect[1];
    const z0 = Math.min(rect[0].z, rect[3].z), z1 = Math.max(rect[0].z, rect[3].z);
    const dirW = G.norm(G.sub(G.v(b.x, b.y, z0), G.v(a.x, a.y, z0)));
    const jam = Math.min(0.06, spec.width / 8, (z1 - z0) / 8);
    const inner = [
      G.v(a.x + dirW.x * jam, a.y + dirW.y * jam, z0 + jam),
      G.v(b.x - dirW.x * jam, b.y - dirW.y * jam, z0 + jam),
      G.v(b.x - dirW.x * jam, b.y - dirW.y * jam, z1 - jam),
      G.v(a.x + dirW.x * jam, a.y + dirW.y * jam, z1 - jam),
    ];
    const faces = [];
    if (kind === 'door' || kind === 'window') {
      const depth = 0.12;
      const off = p => G.v(p.x + into.x * depth, p.y + into.y * depth, p.z);
      const outer = [G.v(a.x, a.y, z0), G.v(b.x, b.y, z0), G.v(b.x, b.y, z1), G.v(a.x, a.y, z1)];
      for (const [o, i] of [[outer, inner], [outer.map(off), inner.map(off)]]) {
        const f = model.addFaceFromRings(o.map(p => G.clone(p)), [i.map(p => G.clone(p))]);
        if (f) faces.push(f);
      }
    }
    if (kind === 'door') {
      // leaf: a panel hinged at one jamb, swung ~35 deg toward the facing side
      const hand = flip.hand >= 0 ? 1 : -1;
      const facing = flip.facing >= 0 ? 1 : -1;
      const open = 35 * Math.PI / 180 * hand * facing;
      const rx = dirW.x * Math.cos(open) - dirW.y * Math.sin(open);
      const ry = dirW.x * Math.sin(open) + dirW.y * Math.cos(open);
      const swing = G.v(rx, ry, 0);
      const hinge = hand > 0 ? inner[0] : inner[1];
      const len = G.dist(inner[0], inner[1]);
      const out = G.mul(G.norm(G.v(into.x, into.y, 0)), -0.06 * facing);
      const h = (z1 - jam) - (z0 + jam);
      const p0 = G.add(hinge, out);
      const p1 = G.add(G.add(hinge, G.mul(swing, len)), out);
      const leaf = model.addFaceFromRings([p0, p1, G.v(p1.x, p1.y, p0.z + h), G.v(p0.x, p0.y, p0.z + h)]);
      if (leaf) faces.push(leaf);
    }
    if (kind === 'window') {
      // center mullion bar
      const mid = G.mul(G.add(inner[0], inner[1]), 0.5);
      const w = 0.03;
      const f = model.addFaceFromRings([
        G.v(mid.x - dirW.x * w, mid.y - dirW.y * w, z0 + jam),
        G.v(mid.x + dirW.x * w, mid.y + dirW.y * w, z0 + jam),
        G.v(mid.x + dirW.x * w, mid.y + dirW.y * w, z1 - jam),
        G.v(mid.x - dirW.x * w, mid.y - dirW.y * w, z1 - jam),
      ]);
      if (f) faces.push(f);
    }
    return faces;
  }
}

// shared interaction for the three hosted tools
class HostedInsertionTool extends Tool {
  static id = 'hosted';
  static kinds = {
    door: { width: 0.9, height: 2.1, sill: 0.0, label: 'Door' },
    window: { width: 1.2, height: 1.5, sill: 0.9, label: 'Window' },
    opening: { width: 1.0, height: 2.1, sill: 0.0, label: 'Wall Opening' },
  };
  constructor(app, kind) { super(app); this.kind = kind; }
  activate() {
    this.spec = Object.assign({}, HostedInsertionTool.kinds[this.kind]);
    // Properties panel overrides (Revit type + instance properties)
    const hp = this.app.bimOptions.hosted || {};
    if (hp.width > 0) this.spec.width = hp.width;
    if (hp.height > 0) this.spec.height = hp.height;
    if (hp.sill != null && hp.sill >= 0) this.spec.sill = hp.sill;
    if (hp.depth > 0) this.spec.depth = hp.depth;
    this.host = null;          // { kind:'wall'|'face', id, ent?|fid?, wall? }
    this._staged = false;
    this.sillLock = false;     // V: locked sill ignores the cursor's height
    this.fixedT = null; // typed placement: distance from the host's left edge
    this._lastEv = null;
    this._lastPr = null;       // last projection — Enter places at this spot
    this._depthCache = new Map(); // fid -> scanned body depth
    // The preview geometry persists until clearPreview and the listening
    // dimensions are world-anchored sticky labels — both stay on screen while
    // the pointer rests, so no redraw timer is needed (the old 250 ms replay
    // with a stale event was the source of the null[0] error flood).
    this.status();
  }
  deactivate() { super.deactivate(); }
  get hint() {
    const k = HostedInsertionTool.kinds[this.kind];
    return k.label + ': hover a wall or face, type size/sill/count here or on the Options Bar, then Enter places it (or click to pin-drag). V locks the sill — the cursor then only slides it along the host; V again releases.';
  }
  // wall-like params descriptor for the current host: the BIM wall's own
  // params, or the frame synthesized from a picked free face
  _hp() { return this.host ? (this.host.kind === 'wall' ? this.host.ent.params : this.host.wall) : null; }
  _hostAt(ev) {
    const app = this.app;
    const fid = app.view.pickFaceAt(app.view.eventPt(ev));
    if (fid == null) return null;
    const f = app.model.faces.get(fid);
    if (!f) return null;
    const m = app.model;
    const ent = app.bim.getEntityForFace(f);
    if (ent && (ent.type === 'door' || ent.type === 'window' || ent.type === 'opening')) {
      this._refusal = 'that is already a hosted element — pick a plain wall or face';
      return null;
    }
    if (ent && ent.type === 'wall' && !ent.params.closed && ent.params.base && ent.params.end) {
      this._refusal = null;
      return { kind: 'wall', id: ent.id, ent };
    }
    // any other vertical planar face hosts too — free-mode geometry, boxes,
    // closed-footprint walls, slab sides — framed on the face itself
    const n = G.loopNormal(m.pts(f.loop));
    if (G.isZero(n) || Math.abs(n.z) > 0.7) {
      this._refusal = 'pick a vertical face (a wall or any side face) to host this element';
      return null;
    }
    const wall = this._faceHost(fid, f);
    if (!wall) { this._refusal = 'could not frame that face'; return null; }
    this._refusal = null;
    return { kind: 'face', id: fid, fid, wall };
  }
  // synthesize a wall-like descriptor from a picked vertical face: baseline
  // along its bottom edge, into = toward the body, thickness = scanned depth
  _faceHost(fid, f) {
    const m = this.app.model;
    const nUnit = G.norm(G.loopNormal(m.pts(f.loop)));
    const comp = m.componentVerts({ faces: new Set([fid]), edges: new Set() });
    const o = m.vp(f.loop[0]);
    let pos = 0, neg = 0;
    for (const vid of comp) {
      const t = G.dot(nUnit, G.sub(m.vp(vid), o));
      if (t > 1e-4) pos++; else if (t < -1e-4) neg++;
    }
    if (!pos && !neg) return null; // a lone face — nothing to cut into
    // the body sits on the side where the component's verts are: outward is
    // the OPPOSITE side (face winding carries no reliable in/out signal)
    const nOut = pos > neg ? G.mul(nUnit, -1) : nUnit;
    const into = G.mul(G.v(nOut.x, nOut.y, 0), -1);     // unit, horizontal (face is vertical)
    const right = G.norm(G.v(-nOut.y, nOut.x, 0));
    let minU = Infinity, maxU = -Infinity, zmin = Infinity;
    for (const ring of m.rings(f)) for (const vid of ring) {
      const p = m.vp(vid);
      const u = G.dot(G.sub(p, o), right);
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (p.z < zmin) zmin = p.z;
    }
    const P1 = G.add(G.add(o, G.mul(right, minU)), G.v(0, 0, zmin - o.z));
    const P2 = G.add(G.add(o, G.mul(right, maxU)), G.v(0, 0, zmin - o.z));
    // body depth: cast into the body for the opposite face of the same solid
    let depth = this._depthCache.get(fid);
    if (depth == null) {
      const hit = m.findAcross(o, into, fid, comp);
      depth = hit ? hit.t : 0.25;
      this._depthCache.set(fid, depth);
    }
    return { base: [P1.x, P1.y, P1.z], end: [P2.x, P2.y, P2.z], thickness: depth, locationLine: 'face', into: [into.x, into.y, 0] };
  }
  // the staged host, re-resolved: an undo/delete can invalidate it mid-drag
  _liveHost() {
    if (!this.host) return null;
    if (this.host.kind === 'wall') return this.app.bim.getEntityById(this.host.id) ? this.host : null;
    return this.app.model.faces.has(this.host.fid) ? this.host : null;
  }
  _proj(ev) {
    const app = this.app;
    const hp = this._hp();
    const p = app.inferPoint(ev, null).p;
    const P1 = G.v(hp.base[0], hp.base[1], hp.base[2]);
    const P2 = G.v(hp.end[0], hp.end[1], hp.end[2]);
    const dir = G.norm(G.v(P2.x - P1.x, P2.y - P1.y, 0));
    const L = G.dist(P1, P2);
    const q = G.v(p.x, p.y, P1.z);
    const raw = this.fixedT != null ? this.fixedT : G.dot(G.sub(q, P1), dir);
    const t = Math.min(Math.max(raw, this.spec.width / 2 + 0.05), L - this.spec.width / 2 - 0.05);
    return { c: G.add(P1, G.mul(dir, t)), t, L, P1, P2, dir };
  }
  onMove(ev) {
    const app = this.app, view = app.view;
    this._lastEv = ev;
    view.clearPreview();
    // while staged, keep the ORIGINAL host — but re-resolve it: an undo or
    // delete can detach it mid-staging, and a stale reference must not drive
    // the preview (or the commit)
    const live = this._staged ? this._liveHost() : null;
    const host = live || this._hostAt(ev);
    this._staged = !!live && this._staged;
    this.host = host;
    if (!host) {
      const q = view.eventPt(ev);
      view.hudLabel(q.x, q.y - 18, (this._refusal ? '⛔  ' + this._refusal : '⛔  Click on a host wall or face to place element'), '#b91c1c');
      view.setHoverFace(view.pickFaceAt(q));
      return;
    }
    view.setHoverFace(null);
    const hp = this._hp();
    // Depth in Properties auto-follows the host (wall thickness or scanned
    // body depth) until the user types their own — then it is respected
    const hopt = app.bimOptions.hosted || (app.bimOptions.hosted = {});
    if (!hopt.depthManual) hopt.depth = hp.thickness;
    this.spec.depth = hopt.depthManual && hopt.depth > 0 ? hopt.depth : hp.thickness;
    const pr = this._proj(ev);
    this._lastPr = pr;
    if (this._staged && !this.sillLock) {
      // staged drag also steers the sill — UNLESS V locked it: then only the
      // typed sill owns the height and the cursor just slides along the host
      const raw = app.inferPoint(ev, null).p;
      this.spec.sill = Math.max(0, raw.z - pr.P1.z - this.spec.height / 2);
    }
    let leftOff, intoDir;
    if (hp.locationLine === 'face') {
      leftOff = G.v(0, 0, 0); // the baseline lies on the picked face's plane
      intoDir = G.v(hp.into[0], hp.into[1], 0);
    } else {
      const ring = WallTool.bandRing(G, [pr.P1, pr.P2], hp.thickness, hp.locationLine);
      leftOff = G.sub(ring[0], G.v(pr.P1.x, pr.P1.y, ring[0].z));
      intoDir = G.mul(G.norm(leftOff), -1);
    }
    const z0 = pr.P1.z + this.spec.sill, z1 = z0 + this.spec.height;
    const half = this.spec.width / 2;
    const a = G.add(pr.c, G.mul(pr.dir, -half)), b = G.add(pr.c, G.mul(pr.dir, half));
    const near = [
      G.v(a.x + leftOff.x, a.y + leftOff.y, z0), G.v(b.x + leftOff.x, b.y + leftOff.y, z0),
      G.v(b.x + leftOff.x, b.y + leftOff.y, z1), G.v(a.x + leftOff.x, a.y + leftOff.y, z1),
    ];
    const far = near.map(p => G.add(p, G.mul(intoDir, this.spec.depth)));
    view.previewLoop(near, 0x0e8385);
    view.previewLoop(far, 0x0e8385);
    view.previewFill([{ outer: near }], 0x0e8385, 0.3);
    // listening dimensions from the opening center to BOTH host ends
    for (const pair of [[pr.P1, pr.t], [pr.P2, pr.L - pr.t]]) {
      const pEnd = pair[0], len = pair[1];
      view.previewLine([pr.c, G.v(pEnd.x, pEnd.y, pr.c.z)], 0x6a1fb0, true);
      const mid = G.mul(G.add(pr.c, G.v(pEnd.x, pEnd.y, pr.c.z)), 0.5);
      view.stickyLabel(mid, fmtLen(len), '#6a1fb0');
    }
    // sill dimension: host base -> opening bottom, always visible while
    // placing (teal while V locks it, purple while the cursor steers it)
    const sillCol = this.sillLock ? 0x0e8385 : 0x6a1fb0;
    const sillCss = this.sillLock ? '#0a5f61' : '#6a1fb0';
    view.previewLine([G.v(pr.c.x, pr.c.y, pr.P1.z), G.v(pr.c.x, pr.c.y, z0)], sillCol, false);
    view.stickyLabel(G.v(pr.c.x, pr.c.y, (pr.P1.z + z0) / 2),
      `sill ${fmtLen(this.spec.sill)}${this.sillLock ? ' 🔒' : ''}`, sillCss, 0, -12);
    view.stickyLabel(pr.c, `${fmtLen(pr.t)} from start · ${fmtLen(this.spec.depth)} deep${this.sillLock ? ' · sill locked (V)' : ''}`, '#6a1fb0', 0, -26);
  }
  // V toggles the sill lock; Enter places the opening at the current spot
  onKey(ev) {
    const k = (ev.key || '').toLowerCase();
    if (k === 'v') {
      this.sillLock = !this.sillLock;
      this.app.toast(this.sillLock
        ? 'Sill locked — the typed value owns the height (V releases it)'
        : 'Sill free — it follows the cursor (V locks it)');
      this.status();
      this._replayLast();
      return true;
    }
    if (k === 'enter') return this.enterPlace();
    return false;
  }
  // keyboard placement: commit at the last previewed position (hover or
  // pinned) — the flow "type size + sill, Enter" never needs a second click
  enterPlace() {
    const app = this.app, m = app.model;
    const pr = this._lastPr || (this._lastEv && this.host ? this._proj(this._lastEv) : null);
    if (!this.host || !pr) { app.toast('Hover a host wall or face first, then press Enter'); return false; }
    this._staged = false;
    const hp = app.bimOptions.hosted || {};
    const count = Math.max(1, Math.min(12, parseInt(hp.count || 1, 10) || 1));
    const spacing = hp.spacing > 0 ? hp.spacing : this.spec.width + 0.3;
    const placedAny = [];
    for (let i = 0; i < count; i++) {
      const d = pr.t + i * spacing;
      if (count > 1 && d + this.spec.width / 2 > pr.L - 0.05) break;
      if (this._placeOne(m, this.host, d)) placedAny.push(d);
    }
    this.fixedT = null;
    this._lastPr = null;
    app.view.clearPreview();
    if (placedAny.length > 1) app.toast(`${placedAny.length} placed, spaced ${fmtLen(spacing)}`);
    return true;
  }
  // one-shot preview refresh (typed VCB position/size, Properties edits) —
  // unlike the old timer this runs once, and a failing/stale host just clears
  _replayLast() {
    if (!this._lastEv) return;
    try { this.onMove(this._lastEv); }
    catch (e) { this.host = null; this._lastEv = null; this.app.view.clearPreview(); }
  }
  onVCB(text) {
    // placement while hovering a host: "d" = distance from wall start (left),
    // "d,s" = distance + height from bottom (sill) — e.g. "1,0.5"
    if (this.host) {
      const pm = /^\s*([\d.]+)\s*[,;]\s*([\d.]+)\s*$/.exec(String(text));
      if (pm) {
        this.fixedT = parseFloat(pm[1]);
        this.spec.sill = Math.max(0, parseFloat(pm[2]));
        this.app.toast(`Position: ${fmtLen(this.fixedT)} from the wall start, ${fmtLen(this.spec.sill)} from the bottom — click the wall to place`);
        this.status();
        this._replayLast();
        return true;
      }
      const sm = /^\s*([\d.]+)\s*m?\s*$/.exec(String(text));
      if (sm) {
        this.fixedT = parseFloat(sm[1]);
        this.app.toast(`Position: ${fmtLen(this.fixedT)} from the wall start — click the wall to place`);
        this.status();
        this._replayLast();
        return true;
      }
    }
    const m = /^\s*([\d.]+)\s*[x,]\s*([\d.]+)(?:\s*[x,]\s*([\d.]+))?(?:\s*[x,]\s*([\d.]+))?\s*$/.exec(String(text));
    if (!m) return false;
    this.spec.width = Math.max(0.2, parseFloat(m[1]));
    this.spec.height = Math.max(0.2, parseFloat(m[2]));
    if (m[3]) this.spec.sill = Math.max(0, parseFloat(m[3]));
    if (m[4]) {
      this.spec.depth = Math.max(0.05, parseFloat(m[4]));
      const hopt = this.app.bimOptions.hosted || (this.app.bimOptions.hosted = {});
      hopt.depth = this.spec.depth; hopt.depthManual = true;
    }
    this.app.toast(HostedInsertionTool.kinds[this.kind].label + ': ' + fmtLen(this.spec.width) + ' x ' + fmtLen(this.spec.height)
      + (m[3] ? ', sill ' + fmtLen(this.spec.sill) : '') + (m[4] ? ', depth ' + fmtLen(this.spec.depth) : ''));
    this.status();
    this._replayLast();
    return true;
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const app = this.app, m = app.model;
    const host = this._hostAt(ev);
    if (!host) { app.toast(this._refusal || 'Click on a host wall or face to place element'); return; }
    this.host = host;
    // first click only PINS the element: keep dragging to slide it along and
    // up/down the host, then click again to commit (Esc unpins)
    if (!this._staged) {
      this._proj(ev); // warms the projection at the pin point
      this._staged = true;
      this.fixedT = null; // from here the drag steers the position
      app.setStatus('Pinned — drag to slide/raise it, click again to place. Esc cancels.');
      return;
    }
    this._staged = false;
    const pr = this._proj(ev);
    // ARRAY: Properties count/spacing repeats the placement along the host
    const hp = app.bimOptions.hosted || {};
    const count = Math.max(1, Math.min(12, parseInt(hp.count || 1, 10) || 1));
    const spacing = hp.spacing > 0 ? hp.spacing : this.spec.width + 0.3;
    const placedAny = [];
    for (let i = 0; i < count; i++) {
      const d = pr.t + i * spacing;
      if (count > 1 && d + this.spec.width / 2 > pr.L - 0.05) break;
      if (this._placeOne(m, host, d)) placedAny.push(d);
    }
    this.fixedT = null;
    app.view.clearPreview();
    if (placedAny.length > 1) app.toast(`${placedAny.length} placed, spaced ${fmtLen(spacing)}`);
    return;
  }
  _placeOne(m, host, dist) {
    const app = this.app;
    const hp = host.kind === 'wall' ? host.ent.params : host.wall;
    const depth = this.spec.depth > 0 ? this.spec.depth : hp.thickness;
    const spec = { distanceFromStart: dist, width: this.spec.width, height: this.spec.height, sillHeight: this.spec.sill, depth };
    const facesBefore = new Set(m.faces.keys());
    const edgesBefore = new Set(m.edges.keys());
    let info = null, err = null;
    try {
      app.transaction.run('place ' + this.kind, mm => {
        mm.bimHold = true; // the cut edits stamped faces on purpose
        try {
          info = HostedCut.cut(G, mm, hp, spec);
          if (info.error) throw new Error(info.error);
        } finally { mm.bimHold = false; }
      });
    } catch (e) { app.toast(String(e.message || e)); return; }
    let frameFaces = [];
    if (this.kind !== 'opening') {
      app.transaction.run('frame', mm => {
        mm.bimHold = true;
        try {
          const fam = app.families && app.families.families.get(app.bimOptions.family);
          if (fam && fam.kind === this.kind) {
            const ty = fam.types[0];
            // the cut used the tool spec; family geometry fills the same box
            frameFaces = fam.build(G, mm, info, Object.assign({}, spec, { thickness: depth }), { facing: 1, hand: 1 });
          } else {
            frameFaces = HostedCut.frame(G, mm, info, spec, this.kind, { facing: 1, hand: 1 });
          }
        } finally { mm.bimHold = false; }
      });
    }
    const newFaces = [...m.faces.keys()].filter(id => !facesBefore.has(id)).map(id => m.faces.get(id));
    const roles = {};
    for (const f of newFaces) {
      const fi = frameFaces.indexOf(f);
      roles[f.id] = fi >= 0 ? (this.kind === 'door' && fi === frameFaces.length - 1 ? 'leaf' : 'frame') : 'lining';
    }
    const newEdges = [...m.edges.keys()].filter(id => !edgesBefore.has(id));
    // wall hosts keep the parametric link (resize/stretch re-cuts them); a
    // free-face host stores its own wall-like descriptor so flips, dims and
    // later edits still work without a wall entity
    const entParams = host.kind === 'wall'
      ? { hostWallId: host.ent.id, distanceFromStart: info.t, sillHeight: spec.sillHeight,
          width: spec.width, height: spec.height, depth, facing: 1, hand: 1 }
      : { hostKind: 'face', hostFaceId: host.fid,
          base: hp.base, end: hp.end, thickness: depth, into: hp.into, locationLine: 'face',
          distanceFromStart: info.t, sillHeight: spec.sillHeight,
          width: spec.width, height: spec.height, facing: 1, hand: 1 };
    app.bim.create(this.kind, entParams, roles, newEdges);
    app.view.clearPreview();
    app.toast(HostedInsertionTool.kinds[this.kind].label + ' placed at ' + fmtLen(info.t) + ' from the left edge' + (info.partial ? ` — pocket ${fmtLen(depth)} deep` : ''));
    return true;
  }
}
class DoorTool extends HostedInsertionTool { static id = 'door'; constructor(app) { super(app, 'door'); } }
class WindowTool extends HostedInsertionTool { static id = 'window'; constructor(app) { super(app, 'window'); } }
class WallOpeningTool extends HostedInsertionTool { static id = 'opening'; constructor(app) { super(app, 'opening'); } }

// Measure Area (Revit's measure panel, Precise Drawing): hover any face —
// element or free — to read its planar area in m²; click to PIN the
// measurement on the model as a persistent badge (survives tool switches
// and orbiting); Esc clears every pinned measurement. A pure query: nothing
// is selected, edited, or detached.
class MeasureAreaTool extends Tool {
  static id = 'measurearea';
  activate() { this.status(); }
  cleanup() {
    super.cleanup();
    // the transient hover highlight goes away with the tool (pins stay)
    this.app.view.setMeasureHover(null);
  }
  get hint() {
    return 'Measure Area: hover a face to highlight it and read its area — faces with openings report net (gross − openings), exactly like the Entity Info panel. Click to pin the measurement (the face stays highlighted); Esc clears all pinned measurements.';
  }
  _faceAt(ev) {
    const app = this.app;
    const fid = app.view.pickFaceAt(app.view.eventPt(ev));
    if (fid == null) return null;
    const f = app.model.faces.get(fid);
    return f || null;
  }
  _measure(f) {
    const app = this.app, m = app.model;
    // same quantities the Entity Info panel shows: net = outer − holes,
    // gross = outer, openings = Σ holes (a 3x1 wall face with a 1x1 window
    // reads 2 m² net, 3 m² gross, 1 m² of openings)
    const gross = G.loopArea(m.pts(f.loop));
    const openings = (f.holes || []).reduce((s, h) => s + G.loopArea(m.pts(h)), 0);
    const net = Math.max(0, gross - openings);
    const c = m.faceCentroid(f);
    const n = G.loopNormal(m.pts(f.loop));
    const p = G.isZero(n) ? c : G.add(c, G.mul(G.norm(n), 0.002)); // lift off the surface
    const owner = f.userData && f.userData.bimEntityId ? ` — ${f.userData.bimEntityId}` : '';
    const badge = openings > 0.0005
      ? `${net.toFixed(3)} m² net (gross ${gross.toFixed(3)} − ${openings.toFixed(3)} openings)`
      : `${net.toFixed(3)} m²`;
    return { area: net, gross, openings, badge, p, owner };
  }
  onMove(ev) {
    const app = this.app, view = app.view;
    const f = this._faceAt(ev);
    view.setHoverFace(null);
    view.setMeasureHover(f ? f.id : null); // solid blue fill + outline
    view.clearSticky();
    if (!f) { app.setStatus('Measure Area: hover a face (no face under the cursor)'); return; }
    const q = this._measure(f);
    view.stickyLabel(q.p, q.badge, '#1d4f9c', 0, -16);
    app.setStatus(`Area: ${q.badge}${q.owner} — click to pin (Esc clears pins)`);
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    const f = this._faceAt(ev);
    if (!f) return;
    const q = this._measure(f);
    // the faceId links the pin to its face: it stays filled blue with the
    // badge until the pins are cleared
    this.app.view.pinLabel(q.p, q.badge, '#1d4f9c', f.id);
    this.app.toast(`Area pinned: ${q.badge}${q.owner} — Esc clears all measurements`);
  }
  onKey(ev) {
    if (ev.key === 'Escape') {
      const n = this.app.view.hudPins.length;
      this.app.view.clearPins();
      if (n) { this.app.toast('Measurements cleared'); return true; }
    }
    return false;
  }
  onVCB() { return false; }
}

window.BimTools = Object.assign(window.BimTools || {}, { WallTool, FloorTool, ConvertTool, DoorTool, WindowTool, WallOpeningTool, HostedCut, HostedInsertionTool, MeasureAreaTool });
