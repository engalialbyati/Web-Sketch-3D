'use strict';
// ---------------------------------------------------------------------------
// features/edgeoffset.js — AutoCAD-style OFFSET for lines, arcs, and
// polylines (edge chains).
//
// The AutoCAD flow, exactly:
//   1. arm the tool → "Type the offset distance"
//   2. type a number + Enter (VCB)  → distance is set
//   3. click a line / arc / polyline → it highlights
//   4. move to a side → the offset preview follows
//   5. click → the offset copy commits; the DISTANCE STAYS armed — click
//      the next curve immediately (AutoCAD's repeat)
//   6. Esc cancels; typing a new number re-arms the distance any time
//
// Geometry:
//   line      — perpendicular copy in the run's plane (horizontal runs
//               offset horizontally; vertical runs offset sideways)
//   polyline  — per-segment parallel copies with mitered joins (the draw
//               engine's parallelOffset)
//   arc/circle— CONCENTRIC copy: same center and plane, radius ± d — the
//               defining AutoCAD arc-offset behavior
// ---------------------------------------------------------------------------
(function () {
  const G = window.G;

  class EdgeOffsetTool extends Tool {
    static id = 'edgeoffset';
    activate() {
      this.dist = null;       // the armed offset distance (typed)
      this.pick = null;       // the picked curve: {kind, pts, cid, meta}
      this.status();
    }
    cleanup() { super.cleanup(); this.activate(); }
    get hint() {
      if (this.dist == null) return 'Offset: type the distance + Enter first, then click a line, arc, or polyline.';
      if (!this.pick) return `Offset ${fmtLen(this.dist)}: click a line, arc, or polyline to offset.`;
      return `Offset ${fmtLen(this.dist)}: click on the side to place the copy — or click another curve. Type a new distance any time; Esc resets.`;
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

    _pickAt(ev) {
      const app = this.app;
      const pe = app.pickEdgeAt(ev, 9);
      if (!pe || !pe.edge) return null;
      const model = app.model;
      const meta = pe.edge.curveId ? model.curves.get(pe.edge.curveId) : null;
      const pts = this._chainPts(model, pe.edge);
      if (!pts || pts.length < 2) return null;
      const kind = meta && (meta.type === 'arc' || meta.type === 'circle') ? 'arc'
        : (pe.edge.curveId && pts.length > 2) ? 'poly' : 'line';
      return { kind, pts, cid: pe.edge.curveId || 0, meta, edgeIds: pe.edge.curveId ? model.curveEdges(pe.edge.curveId).map(e => e.id) : [pe.edge.id] };
    }

    // ------------------------------------------------------------ geometry
    // side sign: which side of the source the cursor is on
    _side(cursor) {
      const p = this.pick;
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

    // the offset polyline for the current pick + side sign
    _offsetPts(sign) {
      const d = this.dist * sign;
      const p = this.pick;
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
      view.clearPreview();
      view.showSnapDot(null);
      if (this.dist == null || !this.pick) {
        const inf = app.inferPoint(ev, null);
        const s = view.toScreen(inf.p);
        if (s) showCursorCoords(view, s, inf, inf.p);
        return;
      }
      const inf = app.inferPoint(ev, null);
      const sign = this._side(inf.p);
      const pts = this._offsetPts(sign);
      if (!pts || pts.length < 2) return;
      view.previewLine(pts, 0x2b2b2b);
      view.previewLine(this.pick.pts, 0x9a9a9a, true); // source ghost
      const mid = pts[Math.floor(pts.length / 2)];
      view.stickyLabel(mid, fmtLen(this.dist), '#333', 0, -14);
    }

    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      if (this.dist == null) {
        app.toast('Type the offset distance first (number + Enter)');
        return;
      }
      const pick = this._pickAt(ev);
      if (!pick) {
        if (this.pick) app.toast('Click a line, arc, or polyline — or Esc');
        return;
      }
      if (!this.pick) {
        this.pick = pick;
        app.view.setHoverEdges(pick.edgeIds);
        this.status();
        return;
      }
      // a pick exists: this click is the SIDE — from the RAW ground point
      // (snapping here would drag the cursor onto the source curve itself)
      this._commit(this._side(this._rawPoint(ev)));
    }

    // the un-snapped pointer position on the ground plane (or nearest ray
    // point) — side detection must not snap to the curve being offset
    _rawPoint(ev) {
      const app = this.app;
      const g = app.view.groundAt ? app.view.groundAt(app.view.eventPt(ev)) : null;
      if (g) return g;
      return app.inferPoint(ev, null).p;
    }

    _commit(sign) {
      const app = this.app;
      const pts = this._offsetPts(sign);
      if (!pts || pts.length < 2 || Math.abs(this.dist) < 1e-5) return;
      const p = this.pick;
      app.run('edge offset', m => {
        const meta = p.kind === 'arc' && p.meta
          ? { ...p.meta, radius: Math.max(0.02, (p.meta.radius || G.dist(p.meta.center, p.pts[0])) + this.dist * sign) }
          : null;
        const closed = meta && meta.type === 'circle';
        m.addPolyline(closed ? pts.concat([pts[0]]) : pts, meta);
      });
      app.view.setHoverEdges(null);
      app.view.clearPreview();
      // AutoCAD repeat: distance stays armed, ready for the next curve
      this.pick = null;
      this.status();
    }

    onKey(ev) {
      if (ev.key === 'Escape') { this.activate(); this.app.view.setHoverEdges(null); this.app.view.clearPreview(); return true; }
      return false;
    }

    onVCB(text) {
      const d = parseLen(text);
      if (d == null || d <= 0) return false;
      this.dist = d;
      // typing a new distance while a curve is picked re-arms and clears it
      if (this.pick) { this.pick = null; this.app.view.setHoverEdges(null); this.app.view.clearPreview(); }
      this.status();
      this.app.toast(`Offset distance ${fmtLen(d)} — click a line, arc, or polyline`);
      return true;
    }
  }

  window.EdgeOffset = { EdgeOffsetTool };
})();
