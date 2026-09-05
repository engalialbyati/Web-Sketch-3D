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
      this._selByLevel = {};   // baseLevelId -> { ix:Set, line:Set } — each
                               // working level keeps its OWN selection
      this.hover = null;       // {ix} | {line}
      this._down = null;       // rubber-band start {x,y} screen
      this._cur = null;        // current screen pt while dragging
      this._lastEv = null;
      this.status();
    }
    _levelSel() {
      const k = (this.app.bimOptions && this.app.bimOptions.baseLevel) || 'lvl';
      if (!this._selByLevel) this._selByLevel = {};
      if (!this._selByLevel[k]) this._selByLevel[k] = { ix: new Set(), line: new Set() };
      return this._selByLevel[k];
    }
    get selIx() { return this._levelSel().ix; }      // "x|y" keys, this level
    get selLine() { return this._levelSel().line; }  // grid ids, this level
    // level switches refresh the tool hint — repaint markers too, so the
    // viewport immediately shows the new working level's selection
    status() {
      if (super.status) super.status();
      try { this.app.view.clearPreview(); this._draw(); } catch (e) { /* no ev yet */ }
    }
    deactivate() { this.app.view.clearPreview(); super.deactivate(); }
    get hint() {
      const s = this.state || {};
      const what = s.selectWhat === 'lines' ? 'grid LINES' : 'grid INTERSECTIONS';
      const withWhat = s.placeWhat === 'walls' ? 'WALLS' : 'COLUMNS';
      const n = s.selectWhat === 'lines' ? this.selLine.size : this.selIx.size;
      const lvl = (this.app.levelManager.getLevel(this.app.bimOptions.baseLevel) || {}).name || this.app.bimOptions.baseLevel;
      return `Grid Select & Place (${what} -> ${withWhat}) — working level: ${lvl}. Click or drag a window to select (${n} selected on ${lvl}). Enter = place on ${lvl}, Esc = clear this level. Switch Base Level for an independent selection per level.`;
    }

    // ------------------------------------------------------------- targets
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
    // toScreen() returns CANVAS-LOCAL pixels; tool events carry CLIENT
    // coordinates — convert before comparing.
    _clientPt(sp) {
      const r = this.app.view.canvas.getBoundingClientRect();
      return { x: sp.x + r.left, y: sp.y + r.top };
    }
    _hoverAt(ev) {
      const view = this.app.view;
      const s = this.state || {};
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
          const sp0 = view.toScreen(G.v(c.p[0], c.p[1], this._z()));
          if (!sp0 || sp0.behind) continue;
          const sp = this._clientPt(sp0);
          const d = Math.hypot(sp.x - ev.clientX, sp.y - ev.clientY);
          if (d < bestD) { bestD = d; best = { line: g }; }
        }
        return best;
      }
      let best = null, bestD = 14;
      for (const ix of this._ixs()) {
        const sp0 = view.toScreen(G.v(ix.p[0], ix.p[1], this._z()));
        if (!sp0 || sp0.behind) continue;
        const sp = this._clientPt(sp0);
        const d = Math.hypot(sp.x - ev.clientX, sp.y - ev.clientY);
        if (d < bestD) { bestD = d; best = { ix }; }
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
      // faint pass: all selectable targets
      if (linesMode) {
        const gm = this.app.gridManager;
        if (gm) for (const g of gm.grids) {
          const e = this._lineExtent(g);
          view.previewLine([G.v(e.a[0], e.a[1], z), G.v(e.b[0], e.b[1], z)], this.selLine.has(g.id) ? 0xf59e0b : 0x94a3b8);
        }
      } else {
        for (const ix of this._ixs()) marker(ix.p, this.selIx.has(IX_KEY(ix.p)) ? 0xf59e0b : 0x94a3b8, this.selIx.has(IX_KEY(ix.p)));
      }
      // hover
      if (this.hover && this.hover.ix) marker(this.hover.ix.p, 0x0ea5e9, true);
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
        if (h.ix) {
          const k = IX_KEY(h.ix.p);
          this.selIx.has(k) ? this.selIx.delete(k) : this.selIx.add(k);
        } else if (h.line) {
          this.selLine.has(h.line.id) ? this.selLine.delete(h.line.id) : this.selLine.add(h.line.id);
        }
      } else {
        // rubber band: world rect
        const wa = this._screenToWorld(a), wb = this._screenToWorld({ x: ev.clientX, y: ev.clientY });
        if (!wa || !wb) return;
        const lo = [Math.min(wa[0], wb[0]), Math.min(wa[1], wb[1])];
        const hi = [Math.max(wa[0], wb[0]), Math.max(wa[1], wb[1])];
        const inside = p => p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1];
        if (s.selectWhat === 'lines') {
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
        if (this.selIx.size || this.selLine.size) {
          this.selIx.clear(); this.selLine.clear();
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
          for (const ix of this._ixs()) if (ix.a === g || ix.b === g) pts.push(ix.p);
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
      const app = this.app, m = app.model;
      const s = this.state || {};
      const zBase = this._z();
      if (s.placeWhat === 'walls') {
        if (s.selectWhat !== 'lines') { app.toast('Walls need Grid LINES selected (option: Select -> Grid Lines)'); return; }
        const lines = [...this.selLine].map(id => app.gridManager.getGrid(id)).filter(Boolean);
        if (!lines.length) { app.toast('Nothing selected'); return; }
        let n = 0;
        const th = Math.max(0.05, s.wallThickness || 0.2);
        const inset = 0.25;
        // consecutive-intersection segments per line, inset at column joints
        const segs = [];
        for (const g of lines) {
          const pts2 = this._ixs().filter(ix => ix.a === g || ix.b === g).map(ix => ix.p);
          const d = [g.end[0] - g.start[0], g.end[1] - g.start[1]];
          const L = Math.hypot(d[0], d[1]) || 1;
          pts2.sort((p, q) => ((p[0] - g.start[0]) * d[0] + (p[1] - g.start[1]) * d[1]) - ((q[0] - g.start[0]) * d[0] + (q[1] - g.start[1]) * d[1]));
          for (let i = 0; i + 1 < pts2.length; i++) {
            const a = pts2[i], b = pts2[i + 1];
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
              app.bim.create('wall', {
                base: [ax, ay, zBase], end: [bx, by, zBase],
                baseLevel: app.bimOptions.baseLevel, topConstraint: app.bimOptions.topConstraint,
                height: h, thickness: th, locationLine: 'centerline', primitive: 'grid', closed: false,
                structuralDeductions: ded,
              }, roles, []);
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
        { key: 'selectWhat', type: 'select', label: 'Select', choices: [{ value: 'intersections', label: 'Intersections' }, { value: 'lines', label: 'Grid Lines' }] },
        { key: 'placeWhat', type: 'select', label: 'Place', choices: [{ value: 'columns', label: 'Columns' }, { value: 'walls', label: 'Walls' }] },
        { key: 'width', type: 'number', label: 'Col w', step: 0.05, default: 0.3 },
        { key: 'depth', type: 'number', label: 'Col d', step: 0.05, default: 0.3 },
        { key: 'wallThickness', type: 'number', label: 'Wall t', step: 0.05, default: 0.2 },
      ],
      tool: GridPlaceTool,
      state: { selectWhat: 'intersections', placeWhat: 'columns', width: 0.3, depth: 0.3, wallThickness: 0.2 },
      onOption(d) {
        const t = window.app && window.app.tool;
        if (t && t.id === 'gridplace') {
          // switching selection mode clears the other mode's picks
          t.selIx && t.selIx.clear();
          t.selLine && t.selLine.clear();
          t.app.view.clearPreview();
          t.status();
        }
      },
    });
  }
  window.GridPlaceFeature = { GridPlaceTool };
})();
