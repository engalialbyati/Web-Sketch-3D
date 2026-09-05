'use strict';
// ---------------------------------------------------------------------------
// GridLine — the data model for one parametric grid line (Revit/ETABS style).
//
// Pure data + pure geometry: no app, no DOM, no three.js. Everything here is
// unit-testable in Node. Grids live on the model (model.grids) exactly like
// levels do, so they survive undo, autosave, and file round-trips; the schema
// gate in db.js validates records on load.
//
//   id              UUID-ish unique string
//   name            axis label: "1","2","3" (numeric) or "A","B","C" (alpha)
//   start / end     planar points [x, y] at Z=0 (Z comes from level projection)
//   mid             [x, y] | null — the through-point when isCurved (3-pt arc)
//   isCurved        straight line vs 3-point arc
//   bubbleEnd       'start' | 'end' | 'both' | 'none' — where the head renders
//   verticalExtent  { min, max } elevations gating which levels show the grid
//   system          named grid line SYSTEM ("Structural", "Architecture"…):
//                   grids only intersect/attach within their own system, and
//                   levels can be assigned to one system
// ---------------------------------------------------------------------------
class GridLine {
  constructor(def) {
    def = def || {};
    this.id = def.id || GridLine.uuid();
    this.name = def.name || '?';
    this.system = (def.system != null && String(def.system).trim()) ? String(def.system).trim() : 'Main';
    this.start = def.start || [0, 0];
    this.end = def.end || [1, 0];
    this.isCurved = !!def.isCurved;
    this.mid = this.isCurved ? (def.mid || null) : null;
    this.bubbleEnd = def.bubbleEnd || 'both';
    this.verticalExtent = Object.assign({ min: 0, max: 100 },
      def.verticalExtent || {});
    this.locked = !!def.locked; // grips refuse dragging, deletion refused
    this.hidden = !!def.hidden; // leaves render, snapping and grips
  }

  static uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'gl_' + crypto.randomUUID();
    GridLine._n = (GridLine._n || 0) + 1;
    return 'gl_' + Date.now().toString(36) + '_' + GridLine._n;
  }

  // ---- planar geometry ----------------------------------------------------
  // Sampled polyline for distance/intersection math. Straight grids return
  // [start, end]; arcs sample ARC_SAMPLES points through the 3-point circle.
  static ARC_SAMPLES = 28;
  polyline(samples) {
    const n = samples || GridLine.ARC_SAMPLES;
    const S = this.start, E = this.end;
    if (!this.isCurved || !this.mid) return [S, E];
    const c = GridLine.circle3(S, this.mid, E);
    if (!c) return [S, E];
    const { cx, cy, r } = c;
    const a0 = Math.atan2(S[1] - cy, S[0] - cx);
    const aM = Math.atan2(this.mid[1] - cy, this.mid[0] - cx);
    const a1 = Math.atan2(E[1] - cy, E[0] - cx);
    // pick the sweep direction that passes through the mid point: going
    // counter-clockwise from a0, the end sits sCCW away and the mid sits
    // throughMid away — if the mid is beyond the end, sweep clockwise instead
    const norm = a => { let x = a; while (x < 0) x += Math.PI * 2; while (x >= Math.PI * 2) x -= Math.PI * 2; return x; };
    const sCCW = norm(a1 - a0);
    const throughMid = norm(aM - a0);
    const sweep = throughMid <= sCCW ? sCCW : sCCW - Math.PI * 2;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + sweep * (i / n);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  // circle through three 2D points (null when collinear)
  static circle3(A, B, C) {
    const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
    if (Math.abs(d) < 1e-9) return null;
    const a2 = A[0] * A[0] + A[1] * A[1], b2 = B[0] * B[0] + B[1] * B[1], c2 = C[0] * C[0] + C[1] * C[1];
    const cx = (a2 * (B[1] - C[1]) + b2 * (C[1] - A[1]) + c2 * (A[1] - B[1])) / d;
    const cy = (a2 * (C[0] - B[0]) + b2 * (A[0] - C[0]) + c2 * (B[0] - A[0])) / d;
    return { cx, cy, r: Math.hypot(A[0] - cx, A[1] - cy) };
  }

  // closest planar point on this grid to P, as { p, t } (t = fraction along
  // the sampled polyline). Straight grids are exact; arcs are sampled.
  closestPoint(P) {
    const poly = this.polyline();
    let best = null, bestD = Infinity;
    for (let i = 0; i < poly.length - 1; i++) {
      const A = poly[i], B = poly[i + 1];
      const ax = B[0] - A[0], ay = B[1] - A[1];
      const L2 = ax * ax + ay * ay;
      let t = L2 < 1e-12 ? 0 : ((P[0] - A[0]) * ax + (P[1] - A[1]) * ay) / L2;
      t = Math.max(0, Math.min(1, t));
      const qx = A[0] + ax * t, qy = A[1] + ay * t;
      const d = Math.hypot(qx - P[0], qy - P[1]);
      if (d < bestD) { bestD = d; best = { p: [qx, qy], t: (i + t) / (poly.length - 1) }; }
    }
    return best;
  }

  // planar distance from P to this grid
  distance(P) {
    const c = this.closestPoint(P);
    return c ? Math.hypot(c.p[0] - P[0], c.p[1] - P[1]) : Infinity;
  }

  // intersection of two grids (planar). Returns [x, y] or null. Segment-segment
  // for straight pairs; sampled polyline otherwise.
  static intersect(g1, g2) {
    const p1 = g1.polyline(), p2 = g2.polyline();
    for (let i = 0; i < p1.length - 1; i++) {
      for (let j = 0; j < p2.length - 1; j++) {
        const x = GridLine.segX(p1[i], p1[i + 1], p2[j], p2[j + 1]);
        if (x) return x;
      }
    }
    return null;
  }

  static segX(A, B, C, D) {
    const d1x = B[0] - A[0], d1y = B[1] - A[1], d2x = D[0] - C[0], d2y = D[1] - C[1];
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((C[0] - A[0]) * d2y - (C[1] - A[1]) * d2x) / den;
    const u = ((C[0] - A[0]) * d1y - (C[1] - A[1]) * d1x) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return [A[0] + d1x * t, A[1] + d1y * t];
  }

  // axis label sequences: numeric ("1" -> "2") and alpha ("A" -> "B" -> "Z" -> "AA")
  static nextLabel(label, step = 1) {
    label = String(label == null ? '' : label).trim();
    if (/^\d+$/.test(label)) return String(parseInt(label, 10) + step);
    if (/^[A-Za-z]$/.test(label)) {
      const code = label.charCodeAt(0) + step;
      const base = label === label.toUpperCase() ? 65 : 97;
      const span = 26;
      return String.fromCharCode(base + ((code - base + span * 10) % span));
    }
    return label + '*'; // custom labels just get suffixed
  }

  covers(z) {
    return z >= this.verticalExtent.min - 1e-6 && z <= this.verticalExtent.max + 1e-6;
  }

  length() {
    const poly = this.polyline();
    let L = 0;
    for (let i = 0; i < poly.length - 1; i++) L += Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
    return L;
  }

  // ---- persistence (compact records; the schema gate for load) -----------
  // Record: { id, name, s:[x,y], e:[x,y], m:[x,y]|0, curved:0|1, bbl, ve:[min,max] }
  toRecord() {
    const r = { id: this.id, name: this.name, s: [this.start[0], this.start[1]], e: [this.end[0], this.end[1]] };
    if (this.system && this.system !== 'Main') r.sys = this.system;
    if (this.isCurved && this.mid) { r.m = [this.mid[0], this.mid[1]]; r.curved = 1; }
    if (this.bubbleEnd !== 'both') r.bbl = this.bubbleEnd;
    if (this.verticalExtent.min !== 0 || this.verticalExtent.max !== 100)
      r.ve = [this.verticalExtent.min, this.verticalExtent.max];
    if (this.locked) r.lk = 1;
    if (this.hidden) r.hd = 1;
    return r;
  }

  // Validate a record (file / autosave / db row) -> GridLine, or null when the
  // shape is wrong. Bad records are dropped loudly by callers, never kept.
  static fromRecord(rec) {
    if (!rec || typeof rec !== 'object') return null;
    const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : null;
    if (!name) return null;
    const start = rec.s || rec.start, end = rec.e || rec.end;
    const mid = rec.m || rec.mid || null;
    const pt2 = v => Array.isArray(v) && v.length >= 2 && isFinite(v[0]) && isFinite(v[1]);
    if (!pt2(start) || !pt2(end)) return null;
    const isCurved = !!(rec.curved || rec.isCurved);
    if (isCurved && !pt2(mid)) return null;
    if (!isCurved && Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-6) return null;
    let ve = rec.ve || rec.verticalExtent || [0, 100];
    if (!Array.isArray(ve) || ve.length < 2 || !isFinite(ve[0]) || !isFinite(ve[1])) ve = [0, 100];
    if (ve[1] < ve[0]) ve = [ve[1], ve[0]];
    const bubbleEnd = ['start', 'end', 'both', 'none'].includes(rec.bbl || rec.bubbleEnd)
      ? (rec.bbl || rec.bubbleEnd) : 'both';
    return new GridLine({
      id: typeof rec.id === 'string' && rec.id ? rec.id : GridLine.uuid(),
      name,
      system: (typeof rec.sys === 'string' && rec.sys.trim()) || (typeof rec.system === 'string' && rec.system.trim()) || 'Main',
      start: [start[0], start[1]], end: [end[0], end[1]],
      mid: isCurved ? [mid[0], mid[1]] : null,
      isCurved, bubbleEnd,
      verticalExtent: { min: ve[0], max: ve[1] },
      locked: !!(rec.lk || rec.locked),
      hidden: !!(rec.hd || rec.hidden),
    });
  }
}

if (typeof module !== 'undefined') module.exports = { GridLine };
