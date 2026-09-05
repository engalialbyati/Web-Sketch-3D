'use strict';
// ---------------------------------------------------------------------------
// tools/draw — Revit-style contextual 2D "Draw" primitives, shared by the BIM
// tools. DrawGeom holds the pure geometry (no app/view access, unit-testable
// in Node); DrawPrimitiveEngine is the interaction runner a parent tool embeds
// (clicks, previews, dimension badges, chaining, the VCB, location-line and
// parallel offsets); DrawTool is the standalone palette host that sketches
// datum geometry into the model.
// ---------------------------------------------------------------------------

// ============================================================ pure geometry
class DrawGeom {
  // N-gon ring around `center`. `fit` = 'inscribed' (vertices ON the radius
  // circle) or 'circumscribed' (edges tangent to it — the dragged radius is
  // the apothem). `rot` = angle of the first vertex.
  static polygonRing(G, center, radius, N, rot, fit) {
    const n = Math.max(3, Math.round(N));
    let r = radius, a0 = rot || 0;
    if (fit === 'circumscribed') { r = radius / Math.cos(Math.PI / n); a0 += Math.PI / n; }
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * 2 * Math.PI;
      out.push(G.v(center.x + r * Math.cos(a), center.y + r * Math.sin(a), center.z));
    }
    return out;
  }

  static circleRing(G, center, radius, segs = 48) {
    const out = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * 2 * Math.PI;
      out.push(G.v(center.x + radius * Math.cos(a), center.y + radius * Math.sin(a), center.z));
    }
    return out;
  }

  // Arc from start to end through a third point on the arc (the bulge drag).
  // Returns { pts, center, radius } or null when the three points collide.
  static arcThrough(G, p1, p2, mid) {
    const ax = p1.x, ay = p1.y, bx = p2.x, by = p2.y, cx = mid.x, cy = mid.y;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-12) return null;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const center = G.v(ux, uy, p1.z);
    const radius = G.dist(center, p1);
    const a1 = Math.atan2(p1.y - uy, p1.x - ux);
    const am = Math.atan2(mid.y - uy, mid.x - ux);
    const a2 = Math.atan2(p2.y - uy, p2.x - ux);
    const ccw = ((am - a1) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) < Math.PI;
    return DrawGeom.arcSweep(G, center, radius, a1, a2, ccw ? 1 : -1);
  }

  // Arc around `center` from angle a0 to a1 in direction dir (+1 CCW).
  static arcSweep(G, center, radius, a0, a1, dir) {
    let span = (a1 - a0) * dir;
    while (span <= 1e-9) span += 2 * Math.PI;
    span = Math.min(span, 2 * Math.PI);
    const segs = Math.max(6, Math.min(96, Math.ceil(span / 0.12)));
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const a = a0 + dir * span * (i / segs);
      pts.push(G.v(center.x + radius * Math.cos(a), center.y + radius * Math.sin(a), center.z != null ? center.z : 0));
    }
    return { pts, center: G.v(center.x, center.y, center.z), radius, span };
  }

  // Tangent-arc fillet at a corner: edges corner->pA and corner->pB, radius r.
  // Tangent points sit d = r/tan(theta/2) from the corner; the arc center is
  // on the bisector at h = r/sin(theta/2). Null for near-parallel edges or a
  // radius larger than an edge allows.
  static filletCorner(G, corner, pA, pB, r) {
    const uA = G.norm(G.sub(pA, corner)), uB = G.norm(G.sub(pB, corner));
    if (!uA || !uB) return null;
    const theta = Math.acos(Math.max(-1, Math.min(1, G.dot(uA, uB))));
    if (theta < 0.05 || Math.PI - theta < 0.05) return null;
    const d = r / Math.tan(theta / 2);
    if (G.dist(corner, pA) <= d + 1e-9 || G.dist(corner, pB) <= d + 1e-9) return null;
    const bis = G.norm(G.add(uA, uB));
    const center = G.add(corner, G.mul(bis, r / Math.sin(theta / 2)));
    const t1 = G.add(corner, G.mul(uA, d)), t2 = G.add(corner, G.mul(uB, d));
    const dir = G.cross(uA, uB).z >= 0 ? 1 : -1;
    const arc = DrawGeom.arcSweep(G, center, r,
      Math.atan2(t1.y - center.y, t1.x - center.x),
      Math.atan2(t2.y - center.y, t2.x - center.x), dir);
    return { center, radius: r, t1, t2, d, pts: arc.pts };
  }

  // Location-line offset (Revit): D = p2 - p1 in the draw plane; the in-plane
  // normal N = z x D (left of the draw direction, i.e. (-D_y, D_x, 0)).
  //   centerline 0 | exterior +t/2 . N | interior -t/2 . N
  static locationOffset(G, p1, p2, mode, thickness) {
    const D = G.sub(p2, p1);
    const L = Math.hypot(D.x, D.y);
    if (L < 1e-12) return G.v(0, 0, 0);
    const N = G.v(-D.y / L, D.x / L, 0);
    if (mode === 'exterior') return G.mul(N, thickness / 2);
    if (mode === 'interior') return G.mul(N, -thickness / 2);
    return G.v(0, 0, 0);
  }

  // Uniform parallel offset of a path with mitered corners: each segment is
  // shifted along its left normal and consecutive offset lines are
  // intersected. Open paths: positive off = left of the draw direction.
  // Closed rings: positive off = OUTWARD (winding-normalized).
  static parallelOffset(G, pts, closed, off) {
    if (!pts || pts.length < 2 || Math.abs(off) < 1e-9) return pts ? pts.map(p => G.clone(p)) : pts;
    if (closed) {
      // signed area > 0 = CCW: its left normals point inward — flip so that
      // a positive offset always grows the ring
      let a2 = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        a2 += p.x * q.y - q.x * p.y;
      }
      if (a2 > 0) off = -off;
    }
    const n = pts.length;
    const segCount = closed ? n : n - 1;
    const shifted = [];
    for (let i = 0; i < segCount; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      if (L < 1e-12) { shifted.push(null); continue; }
      const nx = -dy / L * off, ny = dx / L * off;
      shifted.push([G.v(a.x + nx, a.y + ny, a.z), G.v(b.x + nx, b.y + ny, b.z)]);
    }
    if (!closed && shifted.length === 1) return [shifted[0][0], shifted[0][1]];
    const isect = (s1, s2) => {
      if (!s1 || !s2) return null;
      const p = s1[0], r = G.sub(s1[1], s1[0]), q = s2[0], s = G.sub(s2[1], s2[0]);
      const den = r.x * s.y - r.y * s.x;
      if (Math.abs(den) < 1e-9) return null;
      const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / den;
      return G.add(p, G.mul(r, t));
    };
    const out = [];
    for (let i = 0; i < segCount; i++) {
      const prev = shifted[(i - 1 + segCount) % segCount], cur = shifted[i];
      const joint = (closed || i > 0) ? isect(prev, cur) : null;
      out.push(joint || (cur ? cur[0] : pts[i]));
    }
    if (!closed) out.push(shifted[segCount - 1] ? shifted[segCount - 1][1] : pts[n - 1]);
    return out;
  }

  // Angle (deg) between the segment and the nearest in-plane world axis.
  static axisAngleDeg(p1, p2) {
    const a = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
    let d = Math.abs(a) % 90;
    if (d > 45) d = 90 - d;
    return d;
  }

  // In-plane intersection of two 3D segments (projected to xy). Returns the
  // corner point (z from segment A) and each segment's far endpoint as seen
  // from the corner, or null when parallel / non-intersecting rays.
  static cornerFromEdges(G, a1, a2, b1, b2) {
    const r = { x: a2.x - a1.x, y: a2.y - a1.y }, s = { x: b2.x - b1.x, y: b2.y - b1.y };
    const den = r.x * s.y - r.y * s.x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((b1.x - a1.x) * s.y - (b1.y - a1.y) * s.x) / den;
    const u = ((b1.x - a1.x) * r.y - (b1.y - a1.y) * r.x) / den;
    if (t < -0.05 || t > 1.05 || u < -0.05 || u > 1.05) return null; // edges must actually cross
    const corner = G.v(a1.x + r.x * t, a1.y + r.y * t, a1.z + (a2.z - a1.z) * t);
    // far endpoints: the half of each edge away from the corner (ties —
    // a corner mid-edge on the other line — resolve to the second endpoint)
    const far = (p, q) => G.dist(corner, q) >= G.dist(corner, p) ? q : p;
    return { corner, pA: far(a1, a2), pB: far(b1, b2) };
  }
}
window.DrawGeom = DrawGeom;

// =============================================== sketch boundary validation
// Validates a set of sketched boundary paths (open polylines + closed rings)
// on their plane and extracts buildable regions. Pure geometry — no DOM.
//   validate(paths) -> {
//     ok, error: { kind: 'open'|'cross', p, msg } | null,
//     regions: [{ outer: [pts], holes: [[pts]] }]   // holes = stair shafts etc
//   }
class SketchValidator {
  static validate(paths, eps = 1e-3) {
    const segs = [];
    for (const path of paths) {
      const P = path.pts;
      if (!P || P.length < 2) continue;
      if (path.closed) for (let i = 0; i < P.length; i++) segs.push([P[i], P[(i + 1) % P.length]]);
      else for (let i = 0; i < P.length - 1; i++) segs.push([P[i], P[i + 1]]);
    }
    if (!segs.length) return { ok: false, error: { kind: 'open', p: null, msg: 'Sketch is empty' }, regions: [] };
    // weld endpoints on a 1 mm grid
    const vidOf = new Map(); const verts = [];
    const id = p => {
      const k = Math.round(p.x / eps) + ',' + Math.round(p.y / eps) + ',' + Math.round(p.z / eps);
      if (!vidOf.has(k)) { vidOf.set(k, verts.length); verts.push(p); }
      return vidOf.get(k);
    };
    const E = segs.map(([a, b]) => [id(a), id(b)]);
    // 1) watertight: every endpoint meets another (no dangling degree-1)
    const deg = new Array(verts.length).fill(0);
    for (const [a, b] of E) { deg[a]++; deg[b]++; }
    for (let i = 0; i < deg.length; i++)
      if (deg[i] === 1) return { ok: false, error: { kind: 'open', p: verts[i], msg: 'Lines must be in closed loops' }, regions: [] };
    // 2) self-intersection: proper crossings between non-adjacent segments
    const cross = (a, b, c, d) => {
      const d1 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const d2 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
      const d3 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x);
      const d4 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x);
      return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
    };
    for (let i = 0; i < E.length; i++) {
      for (let j = i + 1; j < E.length; j++) {
        const [a1, b1] = E[i], [a2, b2] = E[j];
        if (a1 === a2 || a1 === b2 || b1 === a2 || b1 === b2) continue;
        if (cross(verts[a1], verts[b1], verts[a2], verts[b2]))
          return { ok: false, error: { kind: 'cross', p: verts[a2], msg: 'Lines cannot intersect' }, regions: [] };
      }
    }
    // 3) cycle extraction (degree must be exactly 2 — a junction is a defect)
    for (let i = 0; i < deg.length; i++)
      if (deg[i] !== 2) return { ok: false, error: { kind: 'open', p: verts[i], msg: 'Lines must be in closed loops' }, regions: [] };
    const adj = verts.map(() => []);
    for (const [a, b] of E) { adj[a].push(b); adj[b].push(a); }
    const used = new Set();
    const ek = (a, b) => a < b ? a + '|' + b : b + '|' + a;
    const loops = [];
    for (const [a, b] of E) {
      if (used.has(ek(a, b))) continue;
      const loop = [a]; let prev = a, cur = b;
      used.add(ek(a, b));
      while (cur !== a) {
        loop.push(cur);
        const nx = adj[cur][0] !== prev ? adj[cur][0] : adj[cur][1];
        used.add(ek(cur, nx));
        prev = cur; cur = nx;
      }
      loops.push(loop.map(i => verts[i]));
    }
    // 4) regions: sort by area, containment decides outer vs hole (island)
    const area = L => {
      let s = 0;
      for (let i = 0; i < L.length; i++) {
        const p = L[i], q = L[(i + 1) % L.length];
        s += p.x * q.y - q.x * p.y;
      }
      return Math.abs(s) / 2;
    };
    const contains = (L, p) => {
      let inside = false;
      for (let i = 0, j = L.length - 1; i < L.length; j = i++) {
        if (((L[i].y > p.y) !== (L[j].y > p.y)) &&
          (p.x < (L[j].x - L[i].x) * (p.y - L[i].y) / (L[j].y - L[i].y) + L[i].x)) inside = !inside;
      }
      return inside;
    };
    const sorted = loops.map(L => ({ L, a: area(L) })).sort((x, y) => y.a - x.a);
    const regions = [];
    for (const { L } of sorted) {
      let placed = false;
      for (const r of regions) {
        if (contains(r.outer, L[0])) { r.holes.push(L); placed = true; break; }
      }
      if (!placed) regions.push({ outer: L, holes: [] });
    }
    return { ok: true, error: null, regions };
  }
}
window.SketchValidator = SketchValidator;

// =========================================================== the engine
// Parent contract:
//   new DrawPrimitiveEngine(app, {
//     primitives: ['line','rect','polygon','circle','arc_ser','arc_ce','fillet','pick'],
//     getOptions: () => ({ primitive, polygonSides, polygonFit, chain, offset,
//                          thickness, locationLine, ... }),
//     planePoint: ev => Vector3,       // snapped point on the parent's plane
//     onCommit: result => void,        // { kind, pts, closed, curve, fillet }
//     onModeChange: () => void,        // chain state changed (refresh hints)
//     color, fill, fillAlpha,
//   })
// The parent forwards onMove/onDown/onUp/onKey/onVCB and may call .reset().
// kind: 'line' | 'rect' | 'polygon' | 'circle' | 'arc' | 'pick' | 'fillet'
// pts is the final path (dynamic Offset already applied; `raw` is unshifted).
class DrawPrimitiveEngine {
  constructor(app, cfg) {
    this.app = app;
    this.cfg = Object.assign({ color: 0x7b3fa0, fill: 0x7b3fa0, fillAlpha: 0.18 }, cfg);
    this.reset();
  }
  get options() { return this.cfg.getOptions(); }
  get primitive() {
    const p = this.options.primitive;
    return this.cfg.primitives.includes(p) ? p : this.cfg.primitives[0];
  }
  reset() {
    this.stage = 0;
    this.p1 = null; this.p2 = null;
    this.cur = null;
    this.chainStart = null;   // chained segment B starts at A's endpoint
    this.downPt = null;
    this.pickSeg = null;      // pick_lines hover target
    this.edgeA = null;        // fillet: first picked edge
    this.hoverEdge = null;    // fillet/pick: last hovered model edge
    this.filletRadius = null;
  }
  get busy() { return this.stage > 0 || this.chainStart != null || !!this.edgeA; }

  _emit(kind, pts, closed, curve) {
    const o = this.options;
    const out = o.offset ? DrawGeom.parallelOffset(G, pts, closed, o.offset) : pts;
    this.cfg.onCommit({ kind, pts: out, raw: pts, closed, curve: curve || null, meta: { sides: o.polygonSides, fit: o.polygonFit } });
  }

  // ------------------------------------------------ screen-space dimensions
  _dimFor(a, b) {
    const view = this.app.view;
    const sa = view.toScreen(a), sb = view.toScreen(b);
    if (!sa || !sb) return;
    const dx = sb.x - sa.x, dy = sb.y - sa.y, L = Math.hypot(dx, dy) || 1;
    // sticky: the label persists while the pointer rests, anchored in space
    const mid = G.mul(G.add(a, b), 0.5);
    view.stickyLabel(mid, fmtLen(G.dist(a, b)), '#6a1fb0', -dy / L * 14, dx / L * 14);
    if (this.app.lockAxis) return;
    const ang = DrawGeom.axisAngleDeg(a, b);
    if (ang > 2 && ang < 43)
      view.stickyLabel(a, `\u2220 ${ang.toFixed(1)}\u00B0`, '#0a5f61', -dy / L * 28, dx / L * 28);
  }

  // ------------------------------------------------------------ interaction
  onMove(ev) {
    const view = this.app.view;
    view.showSnapDot(null); // cleared BEFORE planePoint — tools may re-show it for a live snap
    this.cur = this.cfg.planePoint(ev);
    view.clearPreview();
    if (this.primitive === 'pick') { this._pickHover(ev); return; }
    if (this.primitive === 'fillet') { this._filletMove(ev); return; }
    this._preview();
    const s = view.toScreen(this.cur);
    showCursorCoords(view, s, null, this.cur);
  }
  onDown(ev) {
    if (ev.button !== 0) return;
    this.downPt = this.cfg.planePoint(ev);
    if (this.primitive === 'pick') { this._pickHover(ev); this._pickClick(); return; }
    if (this.primitive === 'fillet') { this._filletMove(ev); this._filletClick(); return; }
    this._click(this.downPt);
  }
  onUp(ev) {
    // radius stages also commit from a drag (click-click OR press-drag-release)
    if (['circle', 'polygon'].includes(this.primitive) && this.stage === 1) {
      const up = this.cfg.planePoint(ev);
      if (this.downPt && G.dist(this.downPt, up) > 4e-3) this._click(up);
      this.downPt = null;
    }
  }
  onKey(ev) {
    if (ev.key !== 'Escape') return false;
    if (this.edgeA) {
      this.edgeA = null; this.filletRadius = null;
      this.app.view.clearPreview(); this.app.setStatus('Fillet: first line cleared.');
      return true;
    }
    if (this.stage > 0) {
      this.stage = 0; this.p1 = this.p2 = null;
      this.app.view.clearPreview(); this.app.setStatus('Segment cancelled.');
      return true;
    }
    if (this.chainStart) {
      // one Esc breaks the chain (the tool stays active); a second exits
      this.chainStart = null;
      if (this.cfg.onModeChange) this.cfg.onModeChange();
      this.app.setStatus('Chain broken — click to start fresh.');
      return true;
    }
    return false;
  }
  onVCB(text) {
    const s = String(text).trim();
    if ((this.primitive === 'circle' || this.primitive === 'polygon') && this.stage === 1) {
      const r = parseLen(s);
      if (r != null && r > 1e-4) { this._click(G.add(this.p1, G.v(r, 0, 0))); return true; }
    }
    if (this.primitive === 'line' && this.stage === 1 && this.cur) {
      const L = parseLen(s); // exact length clamp along the current direction
      if (L != null && L > 1e-4) {
        const dir = G.sub(this.cur, this.p1);
        if (G.len(dir) > 1e-9) { this._click(G.add(this.p1, G.mul(G.norm(dir), L))); return true; }
      }
    }
    if (this.primitive === 'rect' && this.stage === 1 && this.cur) {
      const parts = s.split(/\s*[x,]\s*/).map(parseFloat);
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        // typed sizes follow the drag quadrant: the rectangle grows toward
        // the cursor (draw left => built left), and an explicitly negative
        // value flips relative to that quadrant
        const sx = (this.cur.x - this.p1.x) < 0 ? -1 : 1;
        const sy = (this.cur.y - this.p1.y) < 0 ? -1 : 1;
        const fx = parts[0] < 0 ? -1 : 1, fy = parts[1] < 0 ? -1 : 1;
        this._click(G.v(this.p1.x + Math.abs(parts[0]) * sx * fx, this.p1.y + Math.abs(parts[1]) * sy * fy, this.p1.z));
        return true;
      }
    }
    if (this.primitive === 'arc_ce' && this.stage === 2 && this.p1 && this.p2) {
      const ang = parseAngle(s); // typed sweep (deg) goes CCW from the start
      if (ang != null && Math.abs(ang) > 1e-3) {
        const a0 = Math.atan2(this.p2.y - this.p1.y, this.p2.x - this.p1.x);
        const dir = ang >= 0 ? 1 : -1;
        this._click(G.add(this.p1, G.v(Math.cos(a0 + dir * Math.abs(ang)), Math.sin(a0 + dir * Math.abs(ang)), 0)));
        return true;
      }
    }
    if (this.primitive === 'arc_ser' && this.stage === 2 && this.p1 && this.p2) {
      const r = parseLen(s);
      const half = G.dist(this.p1, this.p2) / 2;
      if (r != null && r >= half) {
        const h = r - Math.sqrt(Math.max(0, r * r - half * half)); // sagitta
        const mid = G.mul(G.add(this.p1, this.p2), 0.5);
        const D = G.sub(this.p2, this.p1), L = Math.hypot(D.x, D.y) || 1;
        this._click(G.add(mid, G.v(-D.y / L * h, D.x / L * h, 0)));
        return true;
      }
    }
    if (this.primitive === 'fillet' && this.edgeA) {
      const r = parseLen(s);
      if (r != null && r > 1e-4) {
        this.filletRadius = r;
        this.app.setStatus(`Fillet radius ${fmtLen(r)} — click to place.`);
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------- primitives
  _click(p) {
    const prim = this.primitive;
    if (prim === 'line') {
      if (this.stage === 0) {
        this.p1 = this.chainStart || p;
        this.stage = 1;
        this.app.setStatus('Length: click the end point, drag, or type a length + Enter.');
      } else if (G.dist(this.p1, p) >= 1e-3) {
        this._emit('line', [this.p1, p], false);
        if (this.options.chain) {
          // stay armed at the segment end — one click per vertex, like the
          // free Line tool; Esc cancels the pending segment, a second Esc
          // breaks the chain
          this.chainStart = p;
          this.p1 = p;
        } else { this.chainStart = null; this.stage = 0; this.p1 = null; }
        if (this.cfg.onModeChange) this.cfg.onModeChange();
      }
    } else if (prim === 'rect') {
      if (this.stage === 0) { this.p1 = p; this.stage = 1; }
      else {
        const x1 = Math.min(this.p1.x, p.x), x2 = Math.max(this.p1.x, p.x);
        const y1 = Math.min(this.p1.y, p.y), y2 = Math.max(this.p1.y, p.y);
        if (x2 - x1 < 1e-3 || y2 - y1 < 1e-3) { this.app.toast('Rectangle is flat'); return; }
        const z = this.p1.z;
        this._emit('rect', [G.v(x1, y1, z), G.v(x2, y1, z), G.v(x2, y2, z), G.v(x1, y2, z)], true);
        this.stage = 0; this.p1 = null;
      }
    } else if (prim === 'circle' || prim === 'polygon') {
      if (this.stage === 0) { this.p1 = p; this.stage = 1; }
      else {
        const r = G.dist(this.p1, p);
        if (r < 1e-3) { this.app.toast('Radius is too small'); return; }
        if (prim === 'circle') {
          this._emit('circle', DrawGeom.circleRing(G, this.p1, r), true,
            { type: 'circle', center: G.clone(this.p1), radius: r });
        } else {
          const o = this.options;
          const rot = Math.atan2(p.y - this.p1.y, p.x - this.p1.x);
          this._emit('polygon', DrawGeom.polygonRing(G, this.p1, r, o.polygonSides, rot, o.polygonFit), true);
        }
        this.stage = 0; this.p1 = null;
      }
    } else if (prim === 'arc_ser') {
      if (this.stage === 0) { this.p1 = p; this.stage = 1; this.app.setStatus('Arc: click the end point.'); }
      else if (this.stage === 1) {
        if (G.dist(this.p1, p) < 1e-3) { this.app.toast('Arc endpoints coincide'); return; }
        this.p2 = p; this.stage = 2;
        this.app.setStatus('Arc: drag the bulge, or type a radius + Enter.');
      } else {
        const arc = DrawGeom.arcThrough(G, this.p1, this.p2, p);
        if (!arc) { this.app.toast('Bulge point is collinear'); return; }
        this._emit('arc', arc.pts, false, { type: 'arc', center: arc.center, radius: arc.radius });
        if (this.options.chain) {
          this.chainStart = arc.pts[arc.pts.length - 1]; // stay armed at the arc end
          this.p1 = this.chainStart;
          this.stage = 1;
          this.app.setStatus('Arc: click the end point.');
        } else { this.chainStart = null; this.stage = 0; this.p1 = this.p2 = null; }
        if (this.cfg.onModeChange) this.cfg.onModeChange();
      }
    } else if (prim === 'arc_ce') {
      if (this.stage === 0) { this.p1 = p; this.stage = 1; this.app.setStatus('Arc: click the start point on the radius.'); }
      else if (this.stage === 1) { this.p2 = p; this.stage = 2; this.app.setStatus('Arc: sweep to the end point, or type an angle + Enter.'); }
      else {
        const a0 = Math.atan2(this.p2.y - this.p1.y, this.p2.x - this.p1.x);
        const a1 = Math.atan2(p.y - this.p1.y, p.x - this.p1.x);
        const r = G.dist(this.p1, this.p2);
        // sweep toward the cursor the short way (CCW span <= pi)
        const ccw = ((a1 - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        if (ccw < 0.02 || ccw > 2 * Math.PI - 0.02) { this.app.toast('Arc sweep is too small'); return; }
        const dir = ccw <= Math.PI ? 1 : -1;
        const arc = DrawGeom.arcSweep(G, this.p1, r, a0, a1, dir);
        this._emit('arc', arc.pts, false, { type: 'arc', center: G.clone(this.p1), radius: r });
        this.chainStart = this.options.chain ? arc.pts[arc.pts.length - 1] : null;
        this.stage = 0; this.p1 = this.p2 = null;
        if (this.cfg.onModeChange) this.cfg.onModeChange();
      }
    }
  }

  _preview() {
    const view = this.app.view, p = this.cur;
    if (!p) return;
    const prim = this.primitive;
    const fill = q => view.previewFill([{ outer: q }], this.cfg.fill, this.cfg.fillAlpha);
    // chained line: the next segment already has its start
    if (prim === 'line' && this.stage === 0 && this.chainStart) {
      view.previewLine([this.chainStart, p], this.cfg.color);
      this._dimFor(this.chainStart, p);
      return;
    }
    if (prim === 'line' && this.stage === 1) {
      view.previewLine([this.p1, p], this.cfg.color);
      this._dimFor(this.p1, p);
    } else if (prim === 'rect' && this.stage === 1) {
      const z = this.p1.z;
      const q = [this.p1, G.v(p.x, this.p1.y, z), G.v(p.x, p.y, z), G.v(this.p1.x, p.y, z)];
      view.previewLoop(q, this.cfg.color); fill(q);
      view.stickyLabel(p, `${Math.abs(p.x - this.p1.x).toFixed(2)} x ${Math.abs(p.y - this.p1.y).toFixed(2)} m`, '#6a1fb0', 0, -34);
      this._dimFor(q[0], q[1]); this._dimFor(q[1], q[2]);
    } else if (prim === 'circle' && this.stage === 1) {
      const ring = DrawGeom.circleRing(G, this.p1, G.dist(this.p1, p));
      view.previewLoop(ring, this.cfg.color); fill(ring);
      this._dimFor(this.p1, p);
    } else if (prim === 'polygon' && this.stage === 1) {
      const o = this.options;
      const rot = Math.atan2(p.y - this.p1.y, p.x - this.p1.x);
      const ring = DrawGeom.polygonRing(G, this.p1, G.dist(this.p1, p), o.polygonSides, rot, o.polygonFit);
      view.previewLoop(ring, this.cfg.color); fill(ring);
      this._dimFor(this.p1, ring[0]);
    } else if (prim === 'arc_ser') {
      if (this.stage === 1) { view.previewLine([this.p1, p], this.cfg.color); this._dimFor(this.p1, p); }
      else if (this.stage === 2) {
        const arc = DrawGeom.arcThrough(G, this.p1, this.p2, p);
        if (arc) {
          view.previewLoop(arc.pts, this.cfg.color);
          this._dimFor(arc.pts[0], arc.pts[arc.pts.length - 1]);
        } else view.previewLine([this.p1, this.p2], this.cfg.color);
      }
    } else if (prim === 'arc_ce') {
      if (this.stage === 1) { view.previewLine([this.p1, p], this.cfg.color); this._dimFor(this.p1, p); }
      else if (this.stage === 2) {
        const a0 = Math.atan2(this.p2.y - this.p1.y, this.p2.x - this.p1.x);
        const a1 = Math.atan2(p.y - this.p1.y, p.x - this.p1.x);
        const ccw = ((a1 - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        const dir = ccw <= Math.PI ? 1 : -1;
        const arc = DrawGeom.arcSweep(G, this.p1, G.dist(this.p1, this.p2), a0, a1, dir);
        view.previewLoop(arc.pts, this.cfg.color);
        view.stickyLabel(p, `\u2221 ${(arc.span * 180 / Math.PI).toFixed(1)}\u00B0`, '#0a5f61', 0, -20);
      }
    }
  }

  // -------------------------------------------------------------- pick_lines
  _levelDatumSegments() {
    // the level reference rectangles (same geometry as render.setLevels, S=12)
    const out = [];
    const S = 12;
    for (const lvl of this.app.levelManager.levels || []) {
      const c = [[-S, -S], [S, -S], [S, S], [-S, S]];
      for (let i = 0; i < 4; i++) {
        const a = c[i], b = c[(i + 1) % 4];
        out.push({ datum: lvl.id, name: lvl.name, pts: [G.v(a[0], a[1], lvl.elevation), G.v(b[0], b[1], lvl.elevation)] });
      }
    }
    return out;
  }
  _pickHover(ev) {
    const app = this.app, view = app.view;
    const pe = app.pickEdgeAt(ev, 8);
    if (pe) {
      view.setHoverEdges([pe.edge.id]);
      this.pickSeg = { kind: 'edge', edge: pe.edge, pts: [app.model.vp(pe.edge.a), app.model.vp(pe.edge.b)] };
      return;
    }
    view.setHoverEdges(null);
    const q = view.eventPt(ev);
    let best = null, bd = 18;
    for (const seg of this._levelDatumSegments()) {
      const sa = view.toScreen(seg.pts[0]), sb = view.toScreen(seg.pts[1]);
      const dx = sb.x - sa.x, dy = sb.y - sa.y, L2 = dx * dx + dy * dy;
      if (L2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((q.x - sa.x) * dx + (q.y - sa.y) * dy) / L2));
      const d = Math.hypot(sa.x + dx * t - q.x, sa.y + dy * t - q.y);
      if (d < bd) { bd = d; best = seg; }
    }
    this.pickSeg = best ? { kind: 'datum', datum: best.datum, name: best.name, pts: best.pts } : null;
    if (best) view.previewLine(best.pts, 0x0a5f61, true);
  }
  _pickClick() {
    if (!this.pickSeg) { this.app.toast('Nothing under the cursor to pick'); return; }
    const s = this.pickSeg;
    if (s.kind === 'edge')
      this._emit('pick', [this.app.model.vp(s.edge.a), this.app.model.vp(s.edge.b)], false);
    else
      this._emit('pick', s.pts, true);
    this.pickSeg = null;
  }

  // ------------------------------------------------------------------ fillet
  _filletMove(ev) {
    const app = this.app, view = app.view;
    const pe = app.pickEdgeAt(ev, 8);
    view.setHoverEdges(pe ? [pe.edge.id] : null);
    this.hoverEdge = pe ? pe.edge : null;
    if (!this.edgeA || !pe) return;
    // second line hovered: preview the tangent arc at half the current radius
    const A = app.model.vp(this.edgeA.a), A2 = app.model.vp(this.edgeA.b);
    const B = app.model.vp(pe.edge.a), B2 = app.model.vp(pe.edge.b);
    const c = DrawGeom.cornerFromEdges(G, A, A2, B, B2);
    if (!c) return;
    const r = this.filletRadius || 0.25;
    const f = DrawGeom.filletCorner(G, c.corner, c.pA, c.pB, r);
    if (f) {
      view.previewLoop(f.pts, this.cfg.color);
      view.stickyLabel(c.corner, `R ${fmtLen(f.radius)}`, '#6a1fb0', 0, -20);
    }
  }
  _filletClick() {
    const app = this.app;
    const e = this.hoverEdge;
    if (!e) { if (!this.edgeA) app.toast('Hover a line first'); return; }
    if (!this.edgeA) {
      this.edgeA = e;
      app.setStatus('Fillet: hover the second intersecting line (radius via drag or typed + Enter).');
      return;
    }
    const A = app.model.vp(this.edgeA.a), A2 = app.model.vp(this.edgeA.b);
    const B = app.model.vp(e.a), B2 = app.model.vp(e.b);
    const c = DrawGeom.cornerFromEdges(G, A, A2, B, B2);
    if (!c) { app.toast('Lines do not intersect'); return; }
    const r = this.filletRadius || 0.25;
    const f = DrawGeom.filletCorner(G, c.corner, c.pA, c.pB, r);
    if (!f) { app.toast('No tangent arc at this radius'); return; }
    this.cfg.onCommit({
      kind: 'fillet',
      pts: f.pts, raw: f.pts, closed: false,
      fillet: { edgeA: this.edgeA, edgeB: e, corner: c.corner, t1: f.t1, t2: f.t2, center: f.center, radius: f.radius, pts: f.pts },
    });
    this.edgeA = null; this.filletRadius = null;
  }
}

// Apply a committed fillet in the model: weld the tangent + arc verts, split
// both edges at the tangent points, splice every ring that carries the corner
// (…t1, corner, t2… -> …t1, arc…, t2…), then reap the corner sub-edges.
function applyFilletToModel(model, f) {
  const mk = p => model.vertexAt(p);
  const idC = mk(f.corner);
  for (const P of [f.t1, f.t2]) {
    for (const e of [...model.edges.values()]) {
      if (e.curveId) continue;
      const a = model.vp(e.a), b = model.vp(e.b);
      if (G.distToSeg(P, a, b) < 1e-4 && G.dist(P, a) > 1e-4 && G.dist(P, b) > 1e-4)
        model.splitEdgeAt(e, P);
    }
  }
  const id1 = mk(f.t1), id2 = mk(f.t2);
  model.addPolyline(f.pts, { type: 'arc', center: f.center, radius: f.radius });
  const interior = f.pts.map(mk).slice(1, -1);
  for (const face of [...model.faces.values()]) {
    for (const ring of [face.loop, ...face.holes]) {
      const iC = ring.indexOf(idC);
      if (iC < 0) continue;
      const prev = ring[(iC - 1 + ring.length) % ring.length], next = ring[(iC + 1) % ring.length];
      let ins;
      if ((prev === id1 || prev === id2) && (next === id1 || next === id2) && prev !== next)
        ins = next === id1 ? [...interior].reverse() : interior;
      else continue;
      ring.splice(iC, 1, ...ins);
    }
  }
  for (const [u, v] of [[id1, idC], [idC, id2]]) {
    const e = model.findEdge(u, v);
    if (e) model.edges.delete(e.id);
  }
  model.gc();
}
window.applyFilletToModel = applyFilletToModel;

// ============================================== standalone palette host tool
class DrawTool extends Tool {
  static id = 'draw';
  activate() {
    this.engine = new DrawPrimitiveEngine(this.app, {
      primitives: ['line', 'rect', 'polygon', 'circle', 'arc_ser', 'arc_ce', 'fillet', 'pick'],
      getOptions: () => this.app.bimOptions,
      planePoint: ev => this._pt(ev),
      onCommit: r => this._commit(r),
      onModeChange: () => this.status(),
      color: 0x0a5f61, fill: 0x0e8385, fillAlpha: 0.15,
    });
    this.status();
  }
  get hint() {
    const names = { line: 'Line', rect: 'Rectangle', polygon: 'Polygon', circle: 'Circle', arc_ser: 'Arc (start-end-bulge)', arc_ce: 'Arc (center-ends)', fillet: 'Fillet', pick: 'Pick Lines' };
    return `Draw (${names[this.app.bimOptions.primitive] || '?'}): sketch on the active level or on any face (walls, columns, slabs — lines paint on top). VCB types lengths / radii / angles; Esc breaks a chain, Esc again exits.`;
  }
  _pt(ev) {
    // anchor the axis lock on the first segment too (p1), not just chains
    const anchor = this.engine ? (this.engine.stage === 1 ? this.engine.p1 : this.engine.chainStart) : null;
    const app = this.app;
    const inf = app.inferPoint(ev, anchor);
    // Revit "draw on face": when the cursor hovers a wall / column / slab
    // face, the sketch point projects onto that face's plane (plus a small
    // normal offset so the drawn line paints ON TOP, visible, not buried
    // inside the surface). No face under the cursor: the level plane as usual.
    if (inf.kind === 'face') {
      const fid = app.view.pickFaceAt(app.view.eventPt(ev));
      if (fid != null) {
        const f = app.model.faces.get(fid);
        if (f) {
          const n = G.loopNormal(app.model.pts(f.loop));
          if (!G.isZero(n)) {
            const off = G.mul(G.norm(n), 0.008); // 8 mm lift — reads clearly, no z-fight
            return G.add(inf.p, off);
          }
        }
      }
    }
    const z = app.levelManager.getElevation(app.bimOptions.baseLevel);
    return G.v(inf.p.x, inf.p.y, z);
  }
  _commit(r) {
    const app = this.app;
    if (r.kind === 'fillet') {
      app.transaction.run('fillet', m => applyFilletToModel(m, r.fillet));
      app.toast('Fillet inserted');
      return;
    }
    app.transaction.run('draw ' + r.kind, m => {
      // precise-mode sketch lines deliberately divide faces they cross: the
      // pieces inherit the stamps (splitFacesAt propagates), so walls and
      // hosted elements stay parametric instead of detaching wholesale
      m.bimHold = true;
      try {
        if (r.closed && r.pts.length >= 3) {
          const f = m.addFaceFromRings(r.pts.map(p => G.clone(p)));
          if (f) m.punchOrSplit(f); // a closed sketch on a face splits its host too
        } else {
          // segment-by-segment via addEdge: crossings split BOTH edges and the
          // faces beneath (SketchUp behavior) — addPolyline would skip all that
          for (let i = 0; i + 1 < r.pts.length; i++)
            m.addEdge(G.clone(r.pts[i]), G.clone(r.pts[i + 1]));
        }
      } finally { m.bimHold = false; }
    });
  }
  onMove(ev) { this.engine.onMove(ev); }
  onDown(ev) { this.engine.onDown(ev); }
  onUp(ev) { this.engine.onUp(ev); }
  onKey(ev) { return this.engine.onKey(ev); }
  onVCB(t) { return this.engine.onVCB(t); }
}
window.BimTools = Object.assign(window.BimTools || {}, { DrawTool, DrawPrimitiveEngine, DrawGeom });
