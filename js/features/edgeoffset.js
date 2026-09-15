'use strict';
// ---------------------------------------------------------------------------
// features/edgeoffset.js — AutoCAD-style OFFSET for lines, arcs, and
// polylines (edge chains), single-pick OR box-selected in bulk.
//
// The AutoCAD flow, exactly:
//   1. arm the tool → "Type the offset distance"
//   2. type a number + Enter (VCB)  → distance is set
//   3. click a line / arc / polyline → it highlights
//      OR drag a box around several curves (window = blue, fully inside;
//      crossing right-to-left = green, touched) → they all highlight
//   4. move to a side → the offset preview(s) follow
//   5. click → the offset copy (or ALL boxed copies) commit; the DISTANCE
//      STAYS armed — pick or box the next curves immediately (repeat)
//   6. Esc cancels; typing a new number re-arms the distance any time
//
// Geometry:
//   line      — perpendicular copy in the run's plane (horizontal runs
//               offset horizontally; vertical runs offset sideways)
//   polyline  — per-segment parallel copies with mitered joins (the draw
//               engine's parallelOffset)
//   arc/circle— CONCENTRIC copy: same center and plane, radius ± d — the
//               defining AutoCAD arc-offset behavior
//
// Boxed batches take each curve's side from the SAME side-click point:
// box a rectangle, click outside → every line offsets outward; click
// inside → they all close inward. Arcs follow the radial rule per curve.
// ---------------------------------------------------------------------------
(function () {
  const G = window.G;

  class EdgeOffsetTool extends Tool {
    static id = 'edgeoffset';
    activate() {
      this.dist = null;       // the armed offset distance (typed)
      this.picks = null;      // picked curves: [{kind, pts, cid, meta, edgeIds}]
      this._bandStart = null; // screen pt where a box drag began
      this._band = false;
      this.status();
    }
    cleanup() { this._endBand(); super.cleanup(); this.activate(); }
    get hint() {
      if (this.dist == null) return 'Offset: type the distance + Enter first — then click a curve, or drag a box around several.';
      if (!this.picks) return `Offset ${fmtLen(this.dist)}: click a line, arc, or polyline — or DRAG A BOX around several — then click the side.`;
      const n = this.picks.length;
      return `Offset ${fmtLen(this.dist)}: click on the side to place ${n > 1 ? `all ${n} copies` : 'the copy'}. Esc resets; type a new distance any time.`;
    }

    // ------------------------------------------------------------- picking
    _chainPts(model, edge) {
      // ordered points along the picked curve (single line → its endpoints)
      const cid = edge.curveId || 0;
      if (!cid) {
        const a = model.vp(edge.a), b = model.vp(edge.b);
        return [G.clone(a), G.clone(b)];
      }
      const chain = model.curveEdges(cid);
      if (!chain.length) return null;
      // walk the chain (shared-degree-2 vertices)
      const deg = new Map();
      for (const e of chain) for (const v of [e.a, e.b]) deg.set(v, (deg.get(v) || 0) + 1);
      const used = new Set();
      const walk = (v0, e0) => {
        const path = [v0];
        used.add(e0.id);
        let cur = e0.a === v0 ? e0.b : e0.a;
        path.push(cur);
        while (true) {
          const nxt = chain.find(e => !used.has(e.id) && (e.a === cur || e.b === cur));
          if (!nxt) break;
          used.add(nxt.id);
          cur = nxt.a === cur ? nxt.b : nxt.a;
          path.push(cur);
        }
        return path;
      };
      const ends = [...deg.entries()].filter(([, n]) => n === 1).map(([v]) => v);
      const e0 = ends.length
        ? chain.find(e => e.a === ends[0] || e.b === ends[0])
        : chain[0];
      const path = ends.length ? walk(ends[0], e0) : walk(chain[0].a, chain[0]);
      return path.map(v => G.clone(model.vp(v)));
    }

    // a pick record from an edge (chain-aware: a polyline/arc chain is ONE
    // curve — its edgeIds highlight together and it offsets as a unit)
    _pickFromEdge(edge) {
      const model = this.app.model;
      const meta = edge.curveId ? model.curves.get(edge.curveId) : null;
      const pts = this._chainPts(model, edge);
      if (!pts || pts.length < 2) return null;
      const kind = meta && (meta.type === 'arc' || meta.type === 'circle') ? 'arc'
        : (edge.curveId && pts.length > 2) ? 'poly' : 'line';
      return { kind, pts, cid: edge.curveId || 0, meta, edgeIds: edge.curveId ? model.curveEdges(edge.curveId).map(e => e.id) : [edge.id] };
    }

    _pickAt(ev) {
      const pe = this.app.pickEdgeAt(ev, 9);
      if (!pe || !pe.edge) return null;
      return this._pickFromEdge(pe.edge);
    }

    // every edge whose screen segment falls in the box — window mode needs
    // the whole segment inside, crossing (right-to-left) just touches it.
    // Chain members expand implicitly: one caught segment selects the curve.
    _edgesInBox(x0, y0, x1, y1, crossing) {
      const app = this.app, model = app.model;
      const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
      const out = [];
      for (const e of model.edges.values()) {
        const a = model.vp(e.a), b = model.vp(e.b);
        if (!a || !b) continue;
        const sa = app.view.toScreen(a), sb = app.view.toScreen(b);
        if (sa.behind && sb.behind) continue;
        const hit = crossing ? (inside(sa.x, sa.y) || inside(sb.x, sb.y)) : (inside(sa.x, sa.y) && inside(sb.x, sb.y));
        if (hit) out.push(e.id);
      }
      return out;
    }

    // ------------------------------------------------------------ geometry
    // side sign: which side of the source curve the cursor is on
    _side(cursor, p) {
      if (p.kind === 'arc') {
        // toward center (radius shrinks) or away
        const c = p.meta.center;
        const rRef = G.dist(c, p.pts[0]) || 1;
        const toCur = G.sub(cursor, c);
        const horiz = G.v(toCur.x, toCur.y, 0);
        const L = G.len(horiz);
        return L > 1e-6 && L < rRef + this.dist ? -1 : 1;
      }
      const a = p.pts[0], b = p.pts[p.pts.length - 1];
      const d = G.sub(b, a);
      const horiz = G.v(d.x, d.y, 0);
      const L = G.len(horiz);
      const n = L > 1e-6
        ? G.v(-horiz.y / L, horiz.x / L, 0)
        : G.v(1, 0, 0); // vertical run: offset in +X
      return Math.sign(G.dot(G.sub(cursor, a), n)) || 1;
    }

    // the offset polyline for a pick + side sign
    _offsetPts(sign, p) {
      const d = this.dist * sign;
      if (p.kind === 'arc') {
        // CONCENTRIC offset: same center/plane/span, radius ± d
        const c = p.meta.center;
        const r0 = p.meta.radius || G.dist(c, p.pts[0]);
        const r = Math.max(0.02, r0 + d);
        if (p.meta.type === 'circle') {
          const { u, v } = G.basisForNormal(p.meta.normal || G.v(0, 0, 1));
          const out = [];
          const n = Math.max(12, Math.round(p.pts.length));
          for (let i = 0; i < n; i++) {
            const t = i / n * Math.PI * 2;
            out.push(G.add(G.add(c, G.mul(u, Math.cos(t) * r)), G.mul(v, Math.sin(t) * r)));
          }
          return out;
        }
        // arc: scale each tessellation point radially to the new radius
        return p.pts.map(q => {
          const w = G.sub(q, c);
          const wl = G.len(w) || 1;
          return G.add(c, G.mul(w, r / wl));
        });
      }
      if (p.kind === 'poly' && window.DrawGeom) {
        // mitered parallel offset in the chain's plane (plan polylines)
        return DrawGeom.parallelOffset(G, p.pts, false, d);
      }
      // single line: perpendicular copy
      const a = p.pts[0], b = p.pts[p.pts.length - 1];
      const dd = G.sub(b, a);
      const horiz = G.v(dd.x, dd.y, 0);
      const L = G.len(horiz);
      const n = L > 1e-6
        ? G.v(-horiz.y / L, horiz.x / L, 0)
        : G.v(1, 0, 0);
      const off = G.mul(n, d);
      return [G.add(a, off), G.add(b, off)];
    }

    // -------------------------------------------------------------- events
    onMove(ev) {
      const app = this.app, view = app.view;
      if (this._bandStart) {
        const q = view.eventPt(ev);
        const dx = q.x - this._bandStart.x, dy = q.y - this._bandStart.y;
        if (!this._band && Math.hypot(dx, dy) > 4) {
          this._band = true;
          app.bandEl.classList.add('active');
        }
        if (this._band) {
          const el = app.bandEl; // lives in the viewport = ScreenPt frame
          el.style.left = Math.min(this._bandStart.x, q.x) + 'px';
          el.style.top = Math.min(this._bandStart.y, q.y) + 'px';
          el.style.width = Math.abs(dx) + 'px'; el.style.height = Math.abs(dy) + 'px';
          el.classList.toggle('window', q.x >= this._bandStart.x);   // blue solid
          el.classList.toggle('crossing', q.x < this._bandStart.x);  // green dashed
        }
        return;
      }
      view.clearPreview();
      view.showSnapDot(null);
      if (this.dist == null || !this.picks) {
        const inf = app.inferPoint(ev, null);
        const s = view.toScreen(inf.p);
        if (s) showCursorCoords(view, s, inf, inf.p);
        return;
      }
      const inf = app.inferPoint(ev, null);
      let shown = 0, lastMid = null;
      for (const p of this.picks) {
        const sign = this._side(inf.p, p);
        const pts = this._offsetPts(sign, p);
        if (!pts || pts.length < 2) continue;
        view.previewLine(pts, 0x2b2b2b);
        view.previewLine(p.pts, 0x9a9a9a, true); // source ghost
        lastMid = pts[Math.floor(pts.length / 2)];
        shown++;
      }
      if (shown) {
        const n = this.picks.length;
        view.stickyLabel(lastMid, fmtLen(this.dist) + (n > 1 ? ` × ${n}` : ''), '#333', 0, -14);
      }
    }

    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      if (this.dist == null) {
        app.toast('Type the offset distance first (number + Enter)');
        return;
      }
      if (this.picks) {
        // the SIDE click — from the RAW ground point (snapping here would
        // drag the cursor onto a source curve being offset)
        this._commitAll(this._rawPoint(ev));
        return;
      }
      const pick = this._pickAt(ev);
      if (pick) {
        this.picks = [pick];
        app.view.setHoverEdges(pick.edgeIds);
        this.status();
        return;
      }
      // empty space: start a BOX selection (window/crossing, like Select)
      this._bandStart = app.view.eventPt(ev);
      this._band = false;
    }

    onUp(ev) {
      if (!this._bandStart) return;
      const app = this.app;
      const q = app.view.eventPt(ev);
      const wasBand = this._band;
      const start = this._bandStart;
      this._endBand();
      if (!wasBand) return; // a plain click on empty space — nothing to do
      const x0 = Math.min(start.x, q.x), x1 = Math.max(start.x, q.x);
      const y0 = Math.min(start.y, q.y), y1 = Math.max(start.y, q.y);
      const crossing = q.x < start.x;
      const ids = this._edgesInBox(x0, y0, x1, y1, crossing);
      // group into curve records (a chain boxes as ONE curve, never N copies)
      const model = app.model;
      const seen = new Set();
      const picks = [];
      for (const id of ids) {
        if (seen.has(id)) continue;
        const e = model.edges.get(id);
        if (!e) continue;
        const rec = this._pickFromEdge(e);
        if (!rec) continue;
        for (const eid of rec.edgeIds) seen.add(eid);
        picks.push(rec);
      }
      if (!picks.length) { app.toast('No lines or arcs in that box'); return; }
      this.picks = picks;
      app.view.setHoverEdges(picks.flatMap(p => p.edgeIds));
      this.status();
      app.toast(`Offset ${fmtLen(this.dist)}: ${picks.length} curve${picks.length > 1 ? 's' : ''} — click the side to place ${picks.length > 1 ? 'all copies' : 'the copy'}`);
    }

    _endBand() {
      if (this.app && this.app.bandEl) this.app.bandEl.classList.remove('active', 'window', 'crossing');
      this._bandStart = null;
      this._band = false;
    }

    // the un-snapped pointer position on the ground plane (or nearest ray
    // point) — side detection must not snap to the curve being offset
    _rawPoint(ev) {
      const app = this.app;
      const g = app.view.groundAt ? app.view.groundAt(app.view.eventPt(ev)) : null;
      if (g) return g;
      return app.inferPoint(ev, null).p;
    }

    _commitAll(cursor) {
      const app = this.app;
      if (Math.abs(this.dist) < 1e-5) return;
      const batch = this.picks;
      app.run(batch.length > 1 ? `offset ×${batch.length}` : 'edge offset', m => {
        for (const p of batch) {
          const sign = this._side(cursor, p);
          const pts = this._offsetPts(sign, p);
          if (!pts || pts.length < 2) continue;
          const meta = p.kind === 'arc' && p.meta
            ? { ...p.meta, radius: Math.max(0.02, (p.meta.radius || G.dist(p.meta.center, p.pts[0])) + this.dist * sign) }
            : null;
          const closed = meta && meta.type === 'circle';
          m.addPolyline(closed ? pts.concat([pts[0]]) : pts, meta);
        }
      });
      app.view.setHoverEdges(null);
      app.view.clearPreview();
      // AutoCAD repeat: distance stays armed, ready for the next curve(s)
      this.picks = null;
      this.status();
    }

    onKey(ev) {
      if (ev.key === 'Escape') {
        this._endBand();
        this.activate();
        this.app.view.setHoverEdges(null);
        this.app.view.clearPreview();
        return true;
      }
      return false;
    }

    onVCB(text) {
      const d = parseLen(text);
      if (d == null || d <= 0) return false;
      this.dist = d;
      // typing a new distance while curve(s) are picked re-arms and clears
      this._endBand();
      if (this.picks) { this.picks = null; this.app.view.setHoverEdges(null); this.app.view.clearPreview(); }
      this.status();
      this.app.toast(`Offset distance ${fmtLen(d)} — click a curve, or drag a box around several`);
      return true;
    }
  }

  window.EdgeOffset = { EdgeOffsetTool };
})();
