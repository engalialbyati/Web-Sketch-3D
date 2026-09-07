'use strict';
// ---------------------------------------------------------------------------
// Feature: Grid Select & Place — the ETABS grid workflow.
//
//   Select:  [Intersections | Grid Lines]   (options bar)
//   Place:   [Columns | Walls]
//
// Hover highlights the nearest grid intersection (or grid line); click
// toggles it; DRAG a rubber-band window to select many at once. ENTER
// places on every selected target in one undoable transaction, ESC clears.
//
//   Intersections + Columns -> one column per selected intersection
//   Lines + Columns         -> columns at every intersection along the lines
//   Lines + Walls           -> wall segments between consecutive
//                              intersections, inset 0.25 m at each end so
//                              columns stay clean (real construction joints)
//
// Columns use the level-driven bounds of the Column tool (base level / top
// constraint from the options bar); walls get the structural clearance
// (they trim under beams and slabs crossing their baseline).
// ---------------------------------------------------------------------------
(function () {

  const IX_KEY = p => p[0].toFixed(3) + '|' + p[1].toFixed(3);

  class GridPlaceTool extends Tool {
    static id = 'gridplace';
    activate() {
      this._selByLevel = {};   // baseLevelId -> { ix:Set, line:Set, cell:Set } — each
                               // working level keeps its OWN selection
      this.hover = null;       // {ix} | {line} | {cell}
      this._down = null;       // rubber-band start {x,y} screen
      this._cur = null;        // current screen pt while dragging
      this._lastEv = null;
      this.status();
    }
    _levelSel() {
      const k = (this.app.bimOptions && this.app.bimOptions.baseLevel) || 'lvl';
      if (!this._selByLevel) this._selByLevel = {};
      if (!this._selByLevel[k]) this._selByLevel[k] = { ix: new Set(), line: new Set(), cell: new Set() };
      return this._selByLevel[k];
    }
    get selIx() { return this._levelSel().ix; }      // "x|y" keys, this level
    get selLine() { return this._levelSel().line; }  // grid ids, this level
    get selCell() { return this._levelSel().cell; }  // composite grid-pair keys
    // level switches refresh the tool hint — repaint markers too, so the
    // viewport immediately shows the new working level's selection
    status() {
      if (super.status) super.status();
      try { this.app.view.clearPreview(); this._draw(); } catch (e) { /* no ev yet */ }
    }
    deactivate() { this.app.view.clearPreview(); super.deactivate(); }
    get hint() {
      const s = this.state || {};
      const what = { lines: 'grid LINES', cells: 'grid CELLS', intersections: 'grid INTERSECTIONS' }[s.selectWhat] || 'grid INTERSECTIONS';
      const withWhat = { walls: 'WALLS', beams: 'BEAMS', floors: 'FLOORS/SLABS', columns: 'COLUMNS', roofs: 'ROOFS' }[s.placeWhat] || 'COLUMNS';
      const n = s.selectWhat === 'lines' ? this.selLine.size : s.selectWhat === 'cells' ? this.selCell.size : this.selIx.size;
      const lvl = (this.app.levelManager.getLevel(this.app.bimOptions.baseLevel) || {}).name || this.app.bimOptions.baseLevel;
      const lm = s.levelMode === 'selected' ? 'SELECTED levels' : s.levelMode === 'all' ? 'ALL levels' : lvl;
      return `Grid Select & Place (${what} -> ${withWhat}) — working level: ${lvl}, placing on: ${lm}. Click or drag a window to select (${n} selected on ${lvl}). Enter = place, Esc = clear this level. Levels: Current / All Selected (select on several levels, Enter does them all) / All.`;
    }

    // ------------------------------------------------------------- targets
    // Crossing points along a grid line with EVERY same-system grid —
    // regardless of hidden state. Placement segmentation defines BAYS, and a
    // bay exists even when its bounding grid is hidden (per-level eye) —
    // using the snap cache here fused whole lines into single long elements.
    _lineBays(g) {
      const gm = this.app.gridManager;
      const pts = [];
      for (const h of gm.grids) {
        if (h === g || (h.system || 'Main') !== (g.system || 'Main')) continue;
        // INFINITE-LINE crossing for straight pairs: a bay is defined by grid
        // POSITIONS, not by the extents someone last dragged the crossing
        // grid to — segX respects drawn extents, so a crossing grid that was
        // stretched short made the selected line collapse to ONE long span
        if (!g.isCurved && !h.isCurved) {
          const x = GridLine.segX([g.start[0], g.start[1]], [g.end[0], g.end[1]],
            [h.start[0], h.start[1]], [h.end[0], h.end[1]]);
          // segX is segment-bounded; recompute unbounded for straight lines
          if (x) { pts.push(x); continue; }
          const d1 = [g.end[0] - g.start[0], g.end[1] - g.start[1]];
          const d2 = [h.end[0] - h.start[0], h.end[1] - h.start[1]];
          const den = d1[0] * d2[1] - d1[1] * d2[0];
          if (Math.abs(den) > 1e-12) { // not parallel: the lines cross somewhere
            const t = ((h.start[0] - g.start[0]) * d2[1] - (h.start[1] - g.start[1]) * d2[0]) / den;
            pts.push([g.start[0] + d1[0] * t, g.start[1] + d1[1] * t]);
          }
          continue;
        }
        const x = GridLine.intersect(g, h);
        if (x) pts.push(x);
      }
      const d = [g.end[0] - g.start[0], g.end[1] - g.start[1]];
      pts.sort((p, q) => ((p[0] - g.start[0]) * d[0] + (p[1] - g.start[1]) * d[1])
        - ((q[0] - g.start[0]) * d[0] + (q[1] - g.start[1]) * d[1]));
      // crossings must lie ON the selected line's drawn extent (infinite
      // crossing grids, bounded selected line) and dedupe near-coincidents.
      // t is the projection PARAMETER: dot(p-s, d)/|d|^2 in [0,1] — dividing
      // by |d| once made every crossing past one meter of start fall outside
      // the (wrong) [0,1] bound and bays collapsed to nothing.
      const d0 = [g.end[0] - g.start[0], g.end[1] - g.start[1]];
      const L02 = d0[0] * d0[0] + d0[1] * d0[1] || 1;
      const out = [];
      for (const p of pts) {
        const t = ((p[0] - g.start[0]) * d0[0] + (p[1] - g.start[1]) * d0[1]) / L02;
        if (t < -0.01 || t > 1.01) continue;
        if (out.length && Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) < 0.05) continue;
        out.push(p);
      }
      return out;
    }
    _ixs() {
      const gm = this.app.gridManager;
      return gm ? gm.intersections() : [];
    }
    _lineExtent(g) {
      // clip a grid line to its first/last intersection with same-system grids
      const gm = this.app.gridManager;
      const ts = [];
      const d = [g.end[0] - g.start[0], g.end[1] - g.start[1]];
      const L = Math.hypot(d[0], d[1]) || 1;
      for (const o of gm.grids) {
        if (o === g || (o.system || 'Main') !== (g.system || 'Main')) continue;
        const p = GridLine.intersect(g, o);
        if (!p) continue;
        ts.push(((p[0] - g.start[0]) * d[0] + (p[1] - g.start[1]) * d[1]) / L);
      }
      if (!ts.length) return { a: g.start, b: g.end };
      ts.sort((x, y) => x - y);
      const at = t => [g.start[0] + d[0] * t, g.start[1] + d[1] * t];
      return { a: at(Math.max(0, ts[0])), b: at(Math.min(L, ts[ts.length - 1])) };
    }
    // Grid CELLS: the rectangle between two adjacent X-running grids and two
    // adjacent Y-running grids of one system — the enclosed bay a floor or
    // slab fills. Corners are true grid intersections, so skewed systems
    // still close cleanly; curved grids are skipped (arcs want a sketch).
    _cells() {
      const gm = this.app.gridManager;
      if (!gm) return [];
      const straight = gm.grids.filter(g => !g.isCurved && !g.hidden);
      if (!straight.length) return [];
      const systems = [...new Set(straight.map(g => g.system || 'Main'))];
      const dirOf = g => Math.abs(g.end[0] - g.start[0]) >= Math.abs(g.end[1] - g.start[1]) ? 'x' : 'y';
      const mid = g => [(g.start[0] + g.end[0]) / 2, (g.start[1] + g.end[1]) / 2];
      const out = [];
      for (const sys of systems) {
        const sg = straight.filter(g => (g.system || 'Main') === sys);
        const xs = sg.filter(g => dirOf(g) === 'x').sort((a, b) => mid(a)[1] - mid(b)[1]); // stack along Y
        const ys = sg.filter(g => dirOf(g) === 'y').sort((a, b) => mid(a)[0] - mid(b)[0]); // stack along X
        for (let i = 0; i + 1 < xs.length; i++) {
          for (let j = 0; j + 1 < ys.length; j++) {
            const x1 = xs[i], x2 = xs[i + 1], y1 = ys[j], y2 = ys[j + 1];
            const c1 = GridLine.intersect(x1, y1), c2 = GridLine.intersect(x1, y2);
            const c3 = GridLine.intersect(x2, y2), c4 = GridLine.intersect(x2, y1);
            if (!c1 || !c2 || !c3 || !c4) continue;
            const ring = [c1, c2, c3, c4]; // CCW by the sort order
            const area2 = Math.abs(
              (ring[1][0] - ring[0][0]) * (ring[2][1] - ring[0][1]) -
              (ring[1][1] - ring[0][1]) * (ring[2][0] - ring[0][0]));
            if (area2 < 1e-6) continue; // degenerate bay
            // edge i (ring[i] -> ring[i+1]) lies ON one boundary grid —
            // recorded so the location-line offsets know which line moves
            const sides = [
              { grid: x1, a: c1, b: c2 },
              { grid: y2, a: c2, b: c3 },
              { grid: x2, a: c3, b: c4 },
              { grid: y1, a: c4, b: c1 },
            ];
            out.push({ key: `${x1.id}|${x2.id}|${y1.id}|${y2.id}`, ring, sides });
          }
        }
      }
      return out;
    }
    // the column (if any) standing at grid intersection p
    _columnAt(p) {
      for (const ent of (this.app.bim ? this.app.bim.entities : [])) {
        if (ent.type !== 'column' || !ent.params || !ent.params.base) continue;
        const b = ent.params.base;
        if (Math.hypot(b[0] - p[0], b[1] - p[1]) < 0.3) return ent;
      }
      return null;
    }
    // axis-aligned footprint corners of one column
    _columnFootprint(ent) {
      const b = ent.params.base, w = (+ent.params.width || 0.3) / 2, d = (+ent.params.depth || 0.3) / 2;
      return [
        { x: b[0] - w, y: b[1] - d }, { x: b[0] + w, y: b[1] - d },
        { x: b[0] + w, y: b[1] + d }, { x: b[0] - w, y: b[1] + d },
      ];
    }
    // Location line: shift one cell side off its grid to the nearby columns'
    // faces — 'exterior' covers the columns, 'interior' stops at their near
    // faces, centered columns make both 0.2 m for a 0.4 column. Returns the
    // shifted infinite line as { p0, dir }.
    _sideLine(side, center, mode) {
      const g = side.grid;
      const dx = g.end[0] - g.start[0], dy = g.end[1] - g.start[1];
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;         // along the grid
      const nx = -uy, ny = ux;                 // unit normal
      const sC = (center[0] - g.start[0]) * nx + (center[1] - g.start[1]) * ny;
      const sgn = sC >= 0 ? 1 : -1;            // interior side of the line
      let fIn = 0, fOut = 0;                   // column faces toward/away from the cell
      for (const p of [side.a, side.b]) {
        const col = this._columnAt(p);
        if (!col) continue;
        for (const q of this._columnFootprint(col)) {
          const sd = sgn * ((q.x - g.start[0]) * nx + (q.y - g.start[1]) * ny);
          if (sd > fIn) fIn = sd;
          if (-sd > fOut) fOut = -sd;
        }
      }
      // INTERIOR is BEAM-FIRST (owner's rule): the slab always connects to
      // the BEAM edging the side — its flank is the inset, whatever the
      // column width. No beam on the side: fall back to the column face.
      // The small corner lap over a wider column is accepted (takeoff's
      // Column > Slab priority absorbs it) and the bay area comes out exact.
      if (mode === 'interior') {
        let beamFace = null;
        for (const b of (this.app.bim ? this.app.bim.entities : [])) {
          if (b.type !== 'beam' || !b.params || !b.params.baseline) continue;
          // beam CENTERLINE lies on this grid (params keep the analytical
          // centerline-to-centerline line even after the trim contract)
          const bl = b.params.baseline;
          let onLine = true, along = 0;
          for (const q of bl) {
            const rx = q[0] - g.start[0], ry = q[1] - g.start[1];
            const u = rx * ux + ry * uy, sd = rx * nx + ry * ny;
            if (Math.abs(sd) > 0.05) { onLine = false; break; }
            along = Math.max(along, Math.abs(u));
          }
          if (!onLine || along > L + 1) continue;
          const prof = b.params;
          const half = (prof.profile && prof.profile !== 'rectangular' && prof.flangeWidth)
            ? prof.flangeWidth / 2 : (prof.webWidth || 0.2) / 2;
          // widest beam face on this side wins (covers the most boundary)
          if (beamFace == null || half > beamFace) beamFace = half;
        }
        if (beamFace != null) fIn = beamFace; // BEAM overrides the column face
      }
      // exterior moves OUT past the columns — 1 mm beyond the face so the
      // punch pass sees the footprint STRICTLY inside (pointIn counts
      // boundary as outside; exactly-on-face would skip the punch and the
      // slab would swallow the column's skin into its own entity)
      const shift = mode === 'interior' ? fIn : (fOut > 0 ? -(fOut + 1e-3) : 0);
      return { p0: [g.start[0] + nx * sgn * shift, g.start[1] + ny * sgn * shift], dir: [ux, uy] };
    }
    // the cell's footprint ring after the location-line mode is applied
    // (centerline = the grid ring unchanged)
    _cellRing(cell, mode) {
      if (mode !== 'exterior' && mode !== 'interior') return cell.ring;
      const c = [
        (cell.ring[0][0] + cell.ring[2][0]) / 2, (cell.ring[0][1] + cell.ring[2][1]) / 2,
      ];
      const lines = cell.sides.map(s => this._sideLine(s, c, mode));
      const lineX2 = (l1, l2) => {
        const den = l1.dir[0] * l2.dir[1] - l1.dir[1] * l2.dir[0];
        if (Math.abs(den) < 1e-9) return null;
        const t = ((l2.p0[0] - l1.p0[0]) * l2.dir[1] - (l2.p0[1] - l1.p0[1]) * l2.dir[0]) / den;
        return [l1.p0[0] + l1.dir[0] * t, l1.p0[1] + l1.dir[1] * t];
      };
      const ring = [];
      for (let i = 0; i < 4; i++) {
        const q = lineX2(lines[(i + 3) % 4], lines[i]); // corner before side i
        if (!q) return cell.ring;                       // degenerate offset — keep centerline
        ring.push(q);
      }
      const a2 = Math.abs((ring[1][0] - ring[0][0]) * (ring[2][1] - ring[0][1]) -
        (ring[1][1] - ring[0][1]) * (ring[2][0] - ring[0][0]));
      if (a2 < 1e-6) return cell.ring;                  // collapsed — keep centerline
      return ring;
    }
    // convex-quad containment (two grid families always cross into convex bays)
    _inCell(w, cell) {
      const r = cell.ring;
      let sign = 0;
      for (let i = 0; i < 4; i++) {
        const a = r[i], b = r[(i + 1) % 4];
        const cr = (b[0] - a[0]) * (w[1] - a[1]) - (b[1] - a[1]) * (w[0] - a[0]);
        if (Math.abs(cr) < 1e-12) continue;
        if (sign === 0) sign = Math.sign(cr);
        else if (Math.sign(cr) !== sign) return false;
      }
      return true;
    }
    // toScreen() returns CANVAS-LOCAL pixels; tool events carry CLIENT
    // coordinates — convert before comparing.
    _clientPt(sp) {
      const r = this.app.view.canvas.getBoundingClientRect();
      return { x: sp.x + r.left, y: sp.y + r.top };
    }
    // Every level's plane the grids cover renders its own dashed copy — the
    // user clicks the copy they SEE (usually the nearest), so hit-testing
    // only the working level's elevation missed by the projection offset.
    // Pick against every covered level; draws stay at the working level.
    // Bay index under a world point on this grid: crossings sorted along
    // the line; the bay whose span contains the projection. -1 = outside.
    // Selected spans on a grid, as [[x,y],[x,y]] endpoint pairs. Keys:
    //   "gridId"     — the whole line
    //   "gridId:i"   — bay i (between crossings i and i+1)
    _selectedGridsAndSpans() {
      const gm = this.app.gridManager;
      const out = [];
      for (const k of this.selLine) {
        const ci = k.indexOf(':');
        const gid = ci < 0 ? k : k.slice(0, ci);
        const g = gm.getGrid ? gm.getGrid(gid) : gm.grids.find(x => x.id === gid);
        if (!g) continue;
        let rec = out.find(r => r.g === g);
        if (!rec) { rec = { g, spans: [] }; out.push(rec); }
        if (ci < 0) { rec.spans = [{ whole: true }]; continue; }
        if (rec.spans.length === 1 && rec.spans[0].whole) continue;
        const i = +k.slice(ci + 1);
        const pts = this._lineBays(g);
        if (i >= 0 && i + 1 < pts.length) rec.spans.push({ a: pts[i], b: pts[i + 1] });
      }
      return out;
    }
    _selectedSpans(g) {
      const out = [];
      if (this.selLine.has(g.id)) {
        const e = this._lineExtent(g);
        out.push([e.a, e.b]);
        return out;
      }
      const pts = this._lineBays(g);
      for (const k of this.selLine) {
        if (!k.startsWith(g.id + ':')) continue;
        const i = +k.slice(g.id.length + 1);
        if (i >= 0 && i + 1 < pts.length) out.push([pts[i], pts[i + 1]]);
      }
      return out;
    }
    _bayUnder(g, w) {
      if (!w) return -1;
      const pts = this._lineBays(g);
      if (pts.length < 2) return -1;
      const dx = g.end[0] - g.start[0], dy = g.end[1] - g.start[1];
      const t = ((w[0] - g.start[0]) * dx + (w[1] - g.start[1]) * dy) / (dx * dx + dy * dy || 1);
      const ts = pts.map(p => ((p[0] - g.start[0]) * dx + (p[1] - g.start[1]) * dy) / (dx * dx + dy * dy || 1)).sort((a, b) => a - b);
      for (let i = 0; i + 1 < ts.length; i++)
        if (t >= ts[i] - 0.02 && t <= ts[i + 1] + 0.02) return i;
      return -1;
    }
    _pickZs() {
      const lv = this.app.levelManager.levels || [];
      const zs = [...new Set(lv.map(l => +(+l.elevation).toFixed(6)))].sort((a, b) => a - b);
      return zs.length ? zs : [this._z()];
    }
    _hoverAt(ev) {
      const view = this.app.view;
      const s = this.state || {};
      if (s.selectWhat === 'cells') {
        const w = this._screenToWorld({ x: ev.clientX, y: ev.clientY });
        if (!w) return null;
        for (const cell of this._cells()) if (this._inCell(w, cell)) return { cell };
        return null;
      }
      if (s.selectWhat === 'lines') {
        const gm = this.app.gridManager;
        if (!gm) return null;
        // closest point of each grid to the cursor's world position on the
        // level plane, ranked in SCREEN pixels (zoom-independent picking)
        const w = this._screenToWorld({ x: ev.clientX, y: ev.clientY });
        if (!w) return null;
        let best = null, bestD = 14;
        for (const g of gm.grids) {
          const c = g.closestPoint(w);
          if (!c || !c.p) continue;
          for (const z of this._pickZs()) {
            if (!g.covers(z)) continue;
            const sp0 = view.toScreen(G.v(c.p[0], c.p[1], z));
            if (!sp0 || sp0.behind) continue;
            const sp = this._clientPt(sp0);
            const d = Math.hypot(sp.x - ev.clientX, sp.y - ev.clientY);
            if (d < bestD) { bestD = d; best = { line: g, at: w }; }
          }
        }
        return best;
      }
      let best = null, bestD = 14;
      for (const ix of this._ixs()) {
        for (const z of this._pickZs()) {
          const sp0 = view.toScreen(G.v(ix.p[0], ix.p[1], z));
          if (!sp0 || sp0.behind) continue;
          const sp = this._clientPt(sp0);
          const d = Math.hypot(sp.x - ev.clientX, sp.y - ev.clientY);
          if (d < bestD) { bestD = d; best = { ix }; }
        }
      }
      return best;
    }
    _worldPt(ev) {
      // intersections live on the level plane
      const p = this.app.inferPoint(ev, null).p;
      return [p.x, p.y];
    }
    _z() { return this.app.levelManager.getElevation(this.app.bimOptions.baseLevel); }

    // ------------------------------------------------------------- preview
    onMove(ev) {
      this._lastEv = ev;
      const view = this.app.view;
      view.clearPreview();
      if (this._down) this._cur = { x: ev.clientX, y: ev.clientY };
      else this.hover = this._hoverAt(ev);
      this._draw();
      if (this._down) this._rubber();
    }
    _draw() {
      const view = this.app.view, z = this._z(), s = this.state || {};
      const sq = 0.16;
      const marker = (p, color, fill) => {
        const ring = [
          G.v(p[0] - sq, p[1] - sq, z), G.v(p[0] + sq, p[1] - sq, z),
          G.v(p[0] + sq, p[1] + sq, z), G.v(p[0] - sq, p[1] + sq, z),
        ];
        if (fill) view.previewFill([{ outer: ring }], color, 0.5);
        else view.previewLoop(ring, color);
      };
      const linesMode = s.selectWhat === 'lines';
      const cellsMode = s.selectWhat === 'cells';
      // faint pass: all selectable targets
      if (cellsMode) {
        for (const cell of this._cells()) {
          const ring = cell.ring.map(p => G.v(p[0], p[1], z));
          if (this.selCell.has(cell.key)) view.previewFill([{ outer: ring }], 0xffd400, 0.45);
          else view.previewLoop(ring, 0x94a3b8);
        }
      } else if (linesMode) {
        const gm = this.app.gridManager;
        const zs = this._pickZs();
        if (gm) for (const g of gm.grids) {
          const e = this._lineExtent(g);
          // selected spans on this grid: whole line, or specific bay keys
          const spans = this._selectedSpans(g);
          const anySel = spans.length > 0;
          for (const zz of zs) {
            if (!g.covers(zz)) continue;
            const zz2 = (Math.abs(zz - z) < 1e-6) ? z : zz + 0.01;
            // unselected full line: faint; then bold-yellow each selected span
            if (!anySel) view.previewLine([G.v(e.a[0], e.a[1], zz2), G.v(e.b[0], e.b[1], zz2)], 0x94a3b8);
            for (const sp of spans) {
              view.previewLine([G.v(sp[0][0], sp[0][1], zz2), G.v(sp[1][0], sp[1][1], zz2)], 0xffd400);
              view.previewLine([G.v(sp[0][0], sp[0][1], zz2 + 0.02), G.v(sp[1][0], sp[1][1], zz2 + 0.02)], 0xffd400);
              view.previewLine([G.v(sp[0][0], sp[0][1], zz2 - 0.02), G.v(sp[1][0], sp[1][1], zz2 - 0.02)], 0xffd400);
            }
          }
        }
      } else {
        for (const ix of this._ixs()) marker(ix.p, this.selIx.has(IX_KEY(ix.p)) ? 0xffd400 : 0x94a3b8, this.selIx.has(IX_KEY(ix.p)));
      }
      // hover
      if (this.hover && this.hover.cell) {
        const ring = this.hover.cell.ring.map(p => G.v(p[0], p[1], z));
        view.previewFill([{ outer: ring }], 0x0ea5e9, 0.25);
        // location line != centerline: show the real footprint the slab
        // will get (offset to the nearby columns' faces)
        const loc = (this.state || {}).slabLoc;
        if (s.placeWhat === 'floors' && (loc === 'exterior' || loc === 'interior')) {
          const off = this._cellRing(this.hover.cell, loc).map(p => G.v(p[0], p[1], z));
          view.previewLoop(off, 0x0ea5e9);
        }
      }
      if (this.hover && this.hover.ix) marker(this.hover.ix.p, 0xffd400, true);
      if (this.hover && this.hover.line) {
        // hovered line: strong yellow single stroke (selection is bold triple)
        const e2 = this._lineExtent(this.hover.line);
        view.previewLine([G.v(e2.a[0], e2.a[1], z), G.v(e2.b[0], e2.b[1], z)], 0xffd400);
      }
      if (this.hover && this.hover.line) {
        const e = this._lineExtent(this.hover.line);
        view.previewLine([G.v(e.a[0], e.a[1], z), G.v(e.b[0], e.b[1], z)], 0x0ea5e9);
      }
      const n = linesMode ? this.selLine.size : this.selIx.size;
      if (n) view.hudLabel && 0; // (count shown in the hint)
    }
    _rubber() {
      const view = this.app.view;
      const a = this._down, b = this._cur;
      if (!a || !b) return;
      const z = this._z();
      const wa = this._screenToWorld(a), wb = this._screenToWorld(b);
      if (!wa || !wb) return;
      const ring = [
        G.v(Math.min(wa[0], wb[0]), Math.min(wa[1], wb[1]), z),
        G.v(Math.max(wa[0], wb[0]), Math.min(wa[1], wb[1]), z),
        G.v(Math.max(wa[0], wb[0]), Math.max(wa[1], wb[1]), z),
        G.v(Math.min(wa[0], wb[0]), Math.max(wa[1], wb[1]), z),
      ];
      view.previewFill([{ outer: ring }], 0x0ea5e9, 0.08);
      view.previewLoop(ring, 0x0ea5e9);
    }
    _screenToWorld(sp) {
      // intersect the view ray with the level plane
      const view = this.app.view;
      try {
        const { ro, rd } = view.clientToWorldRay(sp.x, sp.y);
        const t = (this._z() - ro.z) / (rd.z || 1e-9);
        if (!isFinite(t) || t < 0) return null;
        return [ro.x + rd.x * t, ro.y + rd.y * t];
      } catch (e) { return null; }
    }

    // ----------------------------------------------------------- selection
    onDown(ev) {
      if (ev.button !== 0) return;
      this._down = { x: ev.clientX, y: ev.clientY };
      this._cur = this._down;
    }
    onUp(ev) {
      if (ev.button !== 0 || !this._down) return;
      const a = this._down; this._down = null; this._cur = null;
      const drag = Math.hypot(ev.clientX - a.x, ev.clientY - a.y);
      const s = this.state || {};
      if (drag < 6) {
        const h = this._hoverAt(ev);
        if (!h) return;
        if (h.cell) {
          this.selCell.has(h.cell.key) ? this.selCell.delete(h.cell.key) : this.selCell.add(h.cell.key);
        } else if (h.ix) {
          const k = IX_KEY(h.ix.p);
          this.selIx.has(k) ? this.selIx.delete(k) : this.selIx.add(k);
        } else if (h.line) {
          // BAY selection: clicking a dashed line selects the span between
          // the two crossings nearest the click point — NOT the whole line.
          // (Placing on the whole line is what the rubber-band is for.)
          const bay = this._bayUnder(h.line, h.at || this._screenToWorld({ x: ev.clientX, y: ev.clientY }));
          const key = bay != null ? h.line.id + ':' + bay : h.line.id;
          this.selLine.has(key) ? this.selLine.delete(key) : this.selLine.add(key);
        }
      } else {
        // rubber band: world rect
        const wa = this._screenToWorld(a), wb = this._screenToWorld({ x: ev.clientX, y: ev.clientY });
        if (!wa || !wb) return;
        const lo = [Math.min(wa[0], wb[0]), Math.min(wa[1], wb[1])];
        const hi = [Math.max(wa[0], wb[0]), Math.max(wa[1], wb[1])];
        const inside = p => p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1];
        if (s.selectWhat === 'cells') {
          for (const cell of this._cells()) if (cell.ring.every(p => inside(p))) this.selCell.add(cell.key);
        } else if (s.selectWhat === 'lines') {
          const gm = this.app.gridManager;
          for (const g of (gm ? gm.grids : [])) {
            const has = this._ixs().some(ix => (ix.a === g || ix.b === g) && inside(ix.p));
            if (has) this.selLine.add(g.id);
          }
        } else {
          for (const ix of this._ixs()) if (inside(ix.p)) this.selIx.add(IX_KEY(ix.p));
        }
      }
      this.app.view.clearPreview();
      this._draw();
      this.status();
    }
    onKey(ev) {
      if (ev.key === 'Enter') { this._place(); return true; }
      if (ev.key === 'Escape') {
        if (this.selIx.size || this.selLine.size || this.selCell.size) {
          this.selIx.clear(); this.selLine.clear(); this.selCell.clear();
          this.app.view.clearPreview(); this._draw(); this.status();
          return true;
        }
        return false;
      }
      return false;
    }

    // -------------------------------------------------------------- placing
    _selectedPoints() {
      const s = this.state || {};
      const pts = [];
      if (s.selectWhat === 'lines') {
        for (const id of this.selLine) {
          const g = this.app.gridManager.getGrid(id);
          if (!g) continue;
          for (const p of this._lineBays(g)) pts.push(p);
        }
      } else {
        for (const k of this.selIx) {
          const [x, y] = k.split('|').map(Number);
          pts.push([x, y]);
        }
      }
      const seen = new Set();
      return pts.filter(p => { const k = IX_KEY(p); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    _place() {
      const app = this.app, s = this.state || {};
      const mode = s.levelMode || 'current';
      if (mode === 'current') { this._placeOnLevel(); return; }
      // LEVEL FANNING: place the SAME selection on multiple levels.
      //  'selected' — every level that currently HAS a selection (select on
      //               L1, switch Base Level, select on L3: Enter does both)
      //  'all'      — every level in the project
      const lv = app.levelManager.levels;
      const targets = mode === 'all'
        ? lv.map(l => l.id)
        : Object.keys(this._selByLevel).filter(id => {
            const sel = this._selByLevel[id];
            return sel && (sel.ix.size || sel.line.size || sel.cell.size);
          });
      if (!targets.length) { app.toast('No levels with a selection'); return; }
      const original = app.bimOptions.baseLevel;
      let placed = 0;
      for (const lvlId of targets) {
        if (!app.levelManager.getLevel(lvlId)) continue;
        app.bimOptions.baseLevel = lvlId;
        const before = app.bim.entities.length;
        this._placeOnLevel();          // dedup guard makes repeats no-ops
        placed += app.bim.entities.length - before;
      }
      app.bimOptions.baseLevel = original;
      app.toast(`Placed on ${targets.length} level${targets.length === 1 ? '' : 's'} — ${placed} new element${placed === 1 ? '' : 's'}`);
      this.status();
    }
    _placeOnLevel() {
      const app = this.app, m = app.model;
      const s = this.state || {};
      const zBase = this._z();
      // ------------------------------------------------------------- beams
      // mirror of the walls path: spans run between consecutive
      // Beams run INTERSECTION TO INTERSECTION — centerline to centerline,
      // exactly like the Beam tool: the solid passes through the columns and
      // welds monolithically (cast-in-place behavior; the takeoff credits
      // the embedded overlap to the Column, so nothing is double-counted).
      // Sections come from the options bar and hang from the working level.
      // ------------------------------------------------------------- roofs
      // every selected grid CELL becomes one roof region (multi-select bays
      // merge into one roof only via the Roof tool's sketch mode; Grid Place
      // keeps per-cell roofs so each bay stays independently editable)
      if (s.placeWhat === 'roofs') {
        if (s.selectWhat !== 'cells') { app.toast('Roofs need CELLS selected (option: Select -> Grid Cells)'); return; }
        if (!window.RoofFeature) { app.toast('Roof feature not loaded', true); return; }
        const cells2 = this._cells().filter(c => this.selCell.has(c.key));
        if (!cells2.length) { app.toast('Nothing selected'); return; }
        const kind = s.roofKind || 'flat';
        const thickness = Math.max(0.05, +s.roofThickness || 0.2);
        const pitch = Math.max(0, +s.roofPitch || 15);
        const overhang = Math.max(0, +s.roofOverhang || 0);
        const lvlId = app.bimOptions.baseLevel;
        const z = zBase;
        const facesBefore = new Set(m.faces.keys());
        const edgesBefore = new Set(m.edges.keys());
        let ok = false, fellBack = 0;
        app.transaction.run('grid roofs', mm => {
          mm.bimHold = true;
          try {
            for (const c of cells2) {
              const ring = this._cellRing(c, 'centerline');
              const region = { outer: ring.map(p => [p[0], p[1], z]), holes: [] };
              const built = RoofFeature.buildRegion(G, mm, { kind, thickness, pitch, overhang, region, z });
              if (kind !== 'flat' && built && built.pitched === false) fellBack++;
            }
            ok = true;
          } finally { mm.bimHold = false; }
        });
        if (!ok) { this.status(); return; }
        const newFaces = [...m.faces.keys()].filter(id => !facesBefore.has(id)).map(id => m.faces.get(id)).filter(f => f && !f.userData);
        const roles = {};
        for (const f of newFaces) roles[f.id] = 'body';
        const newEdges = [...m.edges.keys()].filter(id => !edgesBefore.has(id));
        app.bim.create('roof', {
          kind, thickness, pitch, overhang, source: 'grid',
          baseLevel: lvlId, levelId: lvlId, height: Math.max(0.02, thickness),
          regions: cells2.map(c => {
            const ring = this._cellRing(c, 'centerline');
            return { outer: ring.map(p => [p[0], p[1], z]), holes: [] };
          }),
        }, roles, newEdges);
        this.selCell.clear(); app.view.clearPreview(); this.status();
        app.toast(`Roof placed on ${cells2.length} cell${cells2.length === 1 ? '' : 's'} (${kind}${kind !== 'flat' ? ' ' + pitch + '°' : ''})` +
          (fellBack ? ` — ${fellBack} non-rectangular bay${fellBack === 1 ? '' : 's'} fell back to flat` : ''));
        return;
      }
      if (s.placeWhat === 'beams') {
        if (s.selectWhat !== 'lines') { app.toast('Beams need Grid LINES selected (option: Select -> Grid Lines)'); return; }
        // expand selection keys: bay keys ("gridId:i") place ONE beam in the
        // clicked span; whole-line keys (rubber band) place every bay
        const selB = this._selectedGridsAndSpans();
        if (!selB.length) { app.toast('Nothing selected'); return; }
        const segs = [];
        for (const { g, spans } of selB) {
          if (spans.length === 1 && spans[0].whole) {
            const pts2 = this._lineBays(g);
            for (let i = 0; i + 1 < pts2.length; i++) {
              const a = pts2[i], b = pts2[i + 1];
              if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) continue;
              segs.push([a[0], a[1], b[0], b[1]]);
            }
          } else {
            for (const sp of spans) segs.push([sp.a[0], sp.a[1], sp.b[0], sp.b[1]]);
          }
        }
        if (!segs.length) { app.toast('No beam spans (no consecutive intersections)'); return; }
        const BP = window.BeamProfiles;
        const prof = BP ? BP.normalize({
          profile: s.beamProfile, height: s.beamHeight, webWidth: s.beamWidth,
          flangeWidth: s.flangeWidth, flangeThickness: s.flangeThickness,
        }) : { profile: 'rectangular', height: 0.4, webWidth: 0.2, flangeWidth: 0.4, flangeThickness: 0.08, flangeSide: 'Right' };
        const pend = segs.map(([ax, ay, bx, by], i) => ({
          id: '__pend_beam_' + i, type: 'beam',
          params: {
            referenceLevelId: app.bimOptions.baseLevel, baseLevel: app.bimOptions.baseLevel,
            zJustification: 'Top', ...prof,
            baseline: [[ax, ay, zBase], [bx, by, zBase]],
          },
        }));
        // infill walls shrink below the pending beams first, so the sweeps
        // never land on untrimmed wall tops
        if (app.preTrimWallsFor) for (const p of pend) app.preTrimWallsFor(p);
        let n = 0;
        app.transaction.run('grid beams', mm => {
          mm.bimHold = true;
          try {
            for (const p of pend) {
              try {
                const faces = app.structural.buildBeam(G, mm, p.params).filter(f => !f.userData);
                const roles = app.structural.classifyBeamRoles(G, mm, faces, p.params);
                const edges = [];
                for (const f of faces) {
                  for (const r of mm.rings(f)) for (let i = 0; i < r.length; i++) {
                    const e = mm.findEdge(r[i], r[(i + 1) % r.length]);
                    if (e && !e.userData) edges.push(e.id);
                  }
                }
                app.bim.create('beam', p.params, roles, edges);
                n++;
              } catch (e) { /* one degenerate span never kills the batch */ }
            }
          } finally { mm.bimHold = false; }
        });
        app.cleanupWires();
        this.selLine.clear(); app.view.clearPreview(); this.status();
        const trimmed = app.syncStructuralWalls ? app.syncStructuralWalls() : 0;
        app.toast(n
          ? `Placed ${n} beam${n === 1 ? '' : 's'} on grid lines${trimmed ? ` — ${trimmed} wall${trimmed === 1 ? '' : 's'} trimmed under` : ''}`
          : 'No beams placed');
        return;
      }
      // -------------------------------------------------- floors / slabs
      // the closed-area fill: every selected grid CELL becomes a slab region
      // extruded DOWN from the working level — same precedence pipeline as a
      // sketched floor (columns punch through, infill walls trim below)
      if (s.placeWhat === 'floors') {
        if (s.selectWhat !== 'cells') { app.toast('Floors need CELLS selected (option: Select -> Grid Cells)'); return; }
        const cells = this._cells().filter(c => this.selCell.has(c.key));
        if (!cells.length) { app.toast('Nothing selected'); return; }
        const th = Math.max(0.05, +s.slabThickness || 0.2);
        const kind = s.slabKind === 'floor' ? 'floor' : 'slab';
        // the bay plane is where wall UNDERSIDES live: a slab sketched flush
        // on it fuses with the wall bottoms and the extrusion welds away to
        // nothing. The same 0.5 mm reveal buildBeam uses keeps every face
        // off the shared plane — no z-fighting, no zero-area ghosts
        const z = zBase + 5e-4;
        const lvlId = app.bimOptions.baseLevel;
        // LOCATION LINE — centerline keeps the bay grid-to-grid; exterior /
        // interior shift each side to the nearby columns' faces (a centered
        // 0.4 column => 0.2 m per side)
        const rings = cells.map(c => this._cellRing(c, s.slabLoc));
        const regions = rings.map(r => ({ outer: r.map(p => [p[0], p[1], z]), holes: [] }));
        if (kind === 'slab') {
          const pendingSlab = { id: '__pending__', type: 'slab', params: { baseLevel: lvlId, thickness: th, regions } };
          if (app.preTrimWallsFor) app.preTrimWallsFor(pendingSlab);
        }
        // Column ≻ Slab: strictly-inside columns punch their footprints as
        // openings (at the centerline corner columns straddle the boundary —
        // the takeoff absorbs them, exactly like a sketched slab)
        const colHoles = new Map();
        if (app.structural && kind === 'slab') rings.forEach((r, i) => {
          const holes = app.structural.columnHolesForSlab(m,
            { baseLevel: lvlId, thickness: th, _planeZ: z },
            { outer: r.map(p => [p[0], p[1], z]), holes: [] });
          if (holes.length) colHoles.set(i, holes);
        });
        const facesBefore = new Set(m.faces.keys());
        const edgesBefore = new Set(m.edges.keys());
        let ok = false;
        app.transaction.run('grid slabs', mm => {
          mm.bimHold = true; // slabs deliberately interpenetrate walls/columns
          try {
            rings.forEach((r, i) => {
              const punches = (colHoles.get(i) || []).map(h2 => h2.ring.map(p => G.clone(p)));
              const f = mm.addFaceFromRings(r.map(p => G.v(p[0], p[1], z)), punches);
              if (!f) throw new Error('degenerate cell boundary');
              // forceBaseCap: adjacent cells (this batch or an earlier slab)
              // must not swallow each other's tops
              if (!mm.pushPull(f, -th, true)) throw new Error('slab extrusion failed');
            });
            ok = true;
          } finally { mm.bimHold = false; }
        });
        if (!ok) { this.status(); return; }
        const newFaces = [...m.faces.keys()].filter(id => !facesBefore.has(id)).map(id => m.faces.get(id));
        // OWNERSHIP: the welder creates split pieces for everything the slab
        // touches — faces landing inside a COLUMN are that column's skin,
        // never the slab's (otherwise selecting one selects both)
        const cols = app.bim.entities.filter(e => e.type === 'column' && e.params && e.params.base);
        const colAtPt = (x, y, fz) => {
          for (const col of cols) {
            const b2 = col.params.base;
            const w2 = (+col.params.width || 0.3) / 2 + 1e-6, d2 = (+col.params.depth || 0.3) / 2 + 1e-6;
            if (!(x > b2[0] - w2 && x < b2[0] + w2 && y > b2[1] - d2 && y < b2[1] + d2)) continue;
            // plan overlap is not enough — the face must sit INSIDE the
            // column's z band (a slab top under a column stays the slab's)
            const cb = app.structural && app.structural.columnBounds
              ? app.structural.columnBounds(col.params)
              : { zStart: b2[2], zEnd: b2[2] + (+col.params.height || 3) };
            if (fz > cb.zStart + 1e-3 && fz < cb.zEnd - 1e-3) return col;
          }
          return null;
        };
        const roles = {};
        for (const f of newFaces) {
          const c2 = m.faceCentroid(f);
          const owner = colAtPt(c2.x, c2.y, c2.z);
          if (owner) {
            f.userData = { bimEntityId: owner.id, bimType: 'column', role: 'side' };
            owner.faces.push(f.id);
            continue;
          }
          roles[f.id] = Math.abs(c2.z - z) < 1e-6 ? 'top'
            : Math.abs(c2.z - (z - th)) < 1e-6 ? 'bottom' : 'edge';
        }
        const newEdges = [...m.edges.keys()].filter(id => !edgesBefore.has(id));
        app.bim.create(kind, {
          baseLevel: lvlId, levelId: lvlId, thickness: th, source: 'grid',
          locationLine: s.slabLoc || 'centerline',
          regions: rings.map((r, i) => ({
            outer: r.map(p => [p[0], p[1], z]),
            holes: (colHoles.get(i) || []).map(h2 => h2.ring.map(p => [p[0], p[1], p[2]])),
          })),
        }, roles, newEdges);
        this.selCell.clear(); app.view.clearPreview(); this.status();
        const trimmed = app.syncStructuralWalls ? app.syncStructuralWalls() : 0;
        const areaSum = newFaces.reduce((s2, f) => s2 + (roles[f.id] === 'top' ? m.faceArea(f) : 0), 0);
        const locTxt = s.slabLoc === 'exterior' ? ' — exterior: covers the columns'
          : s.slabLoc === 'interior' ? ' — interior: to the column faces' : '';
        app.toast(`${kind === 'floor' ? 'Floor' : 'Slab'} placed — ${cells.length} cell${cells.length === 1 ? '' : 's'}, ${areaSum.toFixed(2)} m²${locTxt}`
          + (trimmed ? `, ${trimmed} wall${trimmed === 1 ? '' : 's'} trimmed` : ''));
        return;
      }
      if (s.placeWhat === 'walls') {
        if (s.selectWhat !== 'lines') { app.toast('Walls need Grid LINES selected (option: Select -> Grid Lines)'); return; }
        const lines = [...this.selLine].map(id => app.gridManager.getGrid(id)).filter(Boolean);
        if (!lines.length) { app.toast('Nothing selected'); return; }
        let n = 0;
        const th = Math.max(0.05, s.wallThickness || 0.2);
        const inset = 0.25;
        // consecutive-intersection segments per line, inset at column joints
        const segs = [];
        for (const { g, spans } of selW) {
          const d = [g.end[0] - g.start[0], g.end[1] - g.start[1]];
          const L = Math.hypot(d[0], d[1]) || 1;
          // spans: whole line -> every bay; bay keys -> just that span
          const pairs = (spans.length === 1 && spans[0].whole)
            ? this._lineBays(g).map((p, i, arr) => i + 1 < arr.length ? [p, arr[i + 1]] : null).filter(Boolean)
            : spans.map(sp => [sp.a, sp.b]);
          for (const [a, b] of pairs) {
            const ax = a[0] + d[0] / L * inset, ay = a[1] + d[1] / L * inset;
            const bx = b[0] - d[0] / L * inset, by = b[1] - d[1] / L * inset;
            if (Math.hypot(bx - ax, by - ay) < 0.05) continue;
            segs.push([ax, ay, bx, by]);
          }
        }
        app.transaction.run('grid walls', mm => {
          mm.bimHold = true;
          mm.beginEdgeSweep();
          try {
            for (const [ax, ay, bx, by] of segs) {
              // structural clearance: level-bounded walls trim under beams/slabs
              let h = app.levelManager.getElevation(app.bimOptions.topConstraint) - zBase;
              if (app.bimOptions.topConstraint === 'unconnected') h = app.bimOptions.unconnectedHeight;
              let ded = [];
              if (app.structural && app.bimOptions.topConstraint !== 'unconnected') {
                const cl = app.structural.wallClearance({ base: [ax, ay, zBase], end: [bx, by, zBase], thickness: th, topConstraint: app.bimOptions.topConstraint }, { model: mm });
                if (cl.topZ < zBase + h - 1e-4) { h = Math.max(0.05, cl.topZ - zBase - 1e-3); ded = cl.deductions; }
              }
              const ring = window.BimTools.WallTool.bandRing(G, [G.v(ax, ay, zBase), G.v(bx, by, zBase)], th, 'centerline');
              const facesBefore = new Set(mm.faces.keys());
              const f = mm.addFaceFromRings(ring.map(q => G.clone(q)));
              if (!f) continue;
              if (!mm.pushPull(f, h)) continue;
              const newFaces = [...mm.faces.keys()].filter(id => !facesBefore.has(id)).map(id => mm.faces.get(id)).filter(f2 => f2 && !f2.userData);
              const roles = {};
              for (const f2 of newFaces) {
                const c = mm.faceCentroid(f2);
                roles[f2.id] = Math.abs(c.z - (zBase + h)) < 1e-6 ? 'top' : Math.abs(c.z - zBase) < 1e-6 ? 'bottom' : 'side';
              }
              const went = app.bim.create('wall', {
                base: [ax, ay, zBase], end: [bx, by, zBase],
                baseLevel: app.bimOptions.baseLevel, topConstraint: app.bimOptions.topConstraint,
                height: h, thickness: th, locationLine: 'centerline', primitive: 'grid', closed: false,
                structuralDeductions: ded,
              }, roles, []);
              if (went) app.bim.ensureWallBottom(went);
              n++;
            }
          } finally { mm.endEdgeSweep(); mm.bimHold = false; }
        });
        app.cleanupWires();
        this.selLine.clear(); this.app.view.clearPreview(); this.status();
        app.toast(n ? `Placed ${n} wall segment${n === 1 ? '' : 's'} on grid lines` : 'No wall segments (no consecutive intersections)');
        return;
      }
      // columns
      const pts = this._selectedPoints();
      if (!pts.length) { app.toast('Nothing selected'); return; }
      const w = Math.max(0.05, s.width || 0.3), d = Math.max(0.05, s.depth || 0.3);
      let n = 0;
      app.transaction.run('grid columns', mm => {
        mm.bimHold = true;
        try {
          for (const p of pts) {
            const params = {
              base: [p[0], p[1], zBase], width: w, depth: d,
              baseLevelId: app.bimOptions.baseLevel,
              topLevelId: app.bimOptions.topConstraint !== 'unconnected' ? app.bimOptions.topConstraint : null,
              baseOffset: 0, topOffset: 0,
              height: Math.max(0.1, app.bimOptions.unconnectedHeight || 3),
            };
            const faces = app.structural.buildColumn(G, mm, params);
            const b = app.structural.columnBounds(params);
            const roles = {};
            const edges = [];
            for (const f of faces) {
              if (f.userData) continue;
              const c = mm.faceCentroid(f);
              roles[f.id] = Math.abs(c.z - b.zEnd) < 1e-6 ? 'top' : Math.abs(c.z - b.zStart) < 1e-6 ? 'bottom' : 'side';
              for (const r of mm.rings(f)) for (let i = 0; i < r.length; i++) {
                const e = mm.findEdge(r[i], r[(i + 1) % r.length]);
                if (e && !e.userData) edges.push(e.id);
              }
            }
            app.bim.create('column', {
              ...params, baseLevel: params.baseLevelId,
              topConstraint: params.topLevelId || 'unconnected', height: b.height,
            }, roles, edges);
            n++;
          }
        } finally { mm.bimHold = false; }
      });
      app.cleanupWires();
      this.selIx.clear(); this.selLine.clear(); this.app.view.clearPreview(); this.status();
      app.toast(n ? `Placed ${n} column${n === 1 ? '' : 's'} on grid ${this.state && this.state.selectWhat === 'lines' ? 'lines' : 'intersections'}` : 'Placement failed');
    }
  }

  if (window.Engine) {
    Engine.features.register({
      id: 'gridplace',
      kind: 'tool',
      label: 'Grid Place',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 3v18M10 3v18M16 3v18M3 6h18M3 12h18M3 18h18"/><circle cx="10" cy="12" r="2.4" fill="currentColor"/></svg>',
      key: 'G',
      mode: 'bim',
      commands: ['gridplace', 'gp'],
      options: [
        { key: 'selectWhat', type: 'select', label: 'Select', choices: [{ value: 'intersections', label: 'Intersections' }, { value: 'lines', label: 'Grid Lines' }, { value: 'cells', label: 'Grid Cells' }] },
        { key: 'levelMode', type: 'select', label: 'Levels', choices: [{ value: 'current', label: 'Current Level' }, { value: 'selected', label: 'All Selected Levels' }, { value: 'all', label: 'All Levels' }] },
        { key: 'placeWhat', type: 'select', label: 'Place', choices: [{ value: 'columns', label: 'Columns' }, { value: 'walls', label: 'Walls' }, { value: 'beams', label: 'Beams' }, { value: 'floors', label: 'Floors/Slabs' }, { value: 'roofs', label: 'Roofs' }] },
        { key: 'width', type: 'number', label: 'Col w', step: 0.05, default: 0.3 },
        { key: 'depth', type: 'number', label: 'Col d', step: 0.05, default: 0.3 },
        { key: 'wallThickness', type: 'number', label: 'Wall t', step: 0.05, default: 0.2 },
        { key: 'beamProfile', type: 'select', label: 'Beam', choices: [{ value: 'rectangular', label: 'Rect' }, { value: 't', label: 'T-Beam' }] },
        { key: 'beamHeight', type: 'number', label: 'Beam h', step: 0.05, default: 0.4 },
        { key: 'beamWidth', type: 'number', label: 'Beam w', step: 0.05, default: 0.2 },
        { key: 'flangeWidth', type: 'number', label: 'Flg w', step: 0.05, default: 0.4 },
        { key: 'flangeThickness', type: 'number', label: 'Flg t', step: 0.05, default: 0.08 },
        { key: 'slabKind', type: 'select', label: 'Kind', choices: [{ value: 'slab', label: 'Slab (structural)' }, { value: 'floor', label: 'Floor (finish)' }] },
        { key: 'slabLoc', type: 'select', label: 'Location', choices: [{ value: 'centerline', label: 'Grid Centerline' }, { value: 'exterior', label: 'Exterior (covers columns)' }, { value: 'interior', label: 'Interior (at column faces)' }] },
        { key: 'slabThickness', type: 'number', label: 'Slab t', step: 0.05, default: 0.2 },
        { key: 'roofKind', type: 'select', label: 'Roof', choices: [{ value: 'flat', label: 'Flat' }, { value: 'mono', label: 'Mono-pitch' }, { value: 'gable', label: 'Gable' }] },
        { key: 'roofPitch', type: 'number', label: 'Pitch °', step: 1, default: 15 },
        { key: 'roofThickness', type: 'number', label: 'Roof t', step: 0.05, default: 0.2 },
        { key: 'roofOverhang', type: 'number', label: 'Overhang', step: 0.05, default: 0.4 },
      ],
      tool: GridPlaceTool,
      state: { selectWhat: 'intersections', placeWhat: 'columns', levelMode: 'current', width: 0.3, depth: 0.3, wallThickness: 0.2, beamProfile: 'rectangular', beamHeight: 0.4, beamWidth: 0.2, flangeWidth: 0.4, flangeThickness: 0.08, slabKind: 'slab', slabLoc: 'centerline', slabThickness: 0.2, roofKind: 'flat', roofPitch: 15, roofThickness: 0.2, roofOverhang: 0.4 },
      onOption(d) {
        const t = window.app && window.app.tool;
        if (t && t.id === 'gridplace') {
          // switching selection mode clears the other mode's picks
          t.selIx && t.selIx.clear();
          t.selLine && t.selLine.clear();
          t.selCell && t.selCell.clear();
          t.app.view.clearPreview();
          t.status();
        }
      },
    });
  }
  window.GridPlaceFeature = { GridPlaceTool };
})();
