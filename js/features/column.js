'use strict';
// ---------------------------------------------------------------------------
// Feature: Column (the SDK reference feature).
//
// This whole file is what a new tool costs: one standard Tool class, one
// Engine.features.register() descriptor. The ribbon button, command
// aliases (col / column), options-bar fields, properties entries and undo
// labels all come from the descriptor. The geometry itself lives in
// StructuralManager (pure, unit-tested).
//
// Vertical bounds are LEVEL-DRIVEN (StructuralManager):
//   Z_start = Z(baseLevel) + baseOffset
//   Z_end   = Z(topLevel)  + topOffset      (Revit-style; falls back to the
//                                           unconnected height option)
// The picked point supplies x/y and the base offset relative to the active
// base level (click a slab top at +0.2 m → baseOffset 0.2). The sweep starts
// at the TOP plane and pushes DOWN, so a slab at the top level is punched
// and the column passes through monolithically (Column > Slab precedence).
// ---------------------------------------------------------------------------
(function () {

  // pure geometry — unit-testable, no app dependency. Legacy direct builder
  // (extrudes UP from the picked plane); the level-driven path is
  // StructuralManager.buildColumn, used by the tool below.
  function placeColumn(G, m, p, w, d, h) {
    const f = m.addFaceFromRings([
      G.v(p.x - w / 2, p.y - d / 2, p.z), G.v(p.x + w / 2, p.y - d / 2, p.z),
      G.v(p.x + w / 2, p.y + d / 2, p.z), G.v(p.x - w / 2, p.y + d / 2, p.z),
    ]);
    if (!f) return null;
    if (!m.pushPull(f, h)) return null;
    return [...m.faces.values()].filter(g => {
      const c = m.faceCentroid(g);
      return c.x > p.x - w && c.x < p.x + w && c.y > p.y - d && c.y < p.y + d
        && c.z >= p.z - 1e-6 && c.z <= p.z + h + 1e-6;
    });
  }

  class ColumnTool extends Tool {
    static id = 'column';
    activate() { this.status(); }
    get hint() {
      const s = this.state || {};
      const app = this.app;
      const lvl = app.levelManager.getLevel(app.bimOptions.baseLevel);
      const top = app.bimOptions.topConstraint !== 'unconnected'
        ? (app.levelManager.getLevel(app.bimOptions.topConstraint) || {}).name
        : `+${(s.height || 3).toFixed(1)} m (unconnected)`;
      return `Column: click to place a ${(s.width || 0.3).toFixed(2)} x ${(s.depth || 0.3).toFixed(2)} m column, ${lvl ? lvl.name : 'base level'} → ${top}. Snap a grid intersection (A-1) to bind it to the grids, or click anywhere to place it freely. Size it on the Options Bar.`;
    }
    _boundsAt(p) {
      const app = this.app, s = this.state || {};
      const baseLevel = app.bimOptions.baseLevel;
      const baseZ = app.levelManager.getElevation(baseLevel);
      const params = {
        base: [p.x, p.y, baseZ],
        width: Math.max(0.05, s.width || 0.3),
        depth: Math.max(0.05, s.depth || 0.3),
        baseLevelId: baseLevel,
        topLevelId: app.bimOptions.topConstraint !== 'unconnected' ? app.bimOptions.topConstraint : null,
        baseOffset: (p.z != null ? p.z : baseZ) - baseZ, // picked plane relative to the level
        topOffset: 0,
        height: Math.max(0.1, s.height || 3), // unconnected fallback
      };
      return { params, bounds: app.structural.columnBounds(params) };
    }
    onMove(ev) {
      const view = this.app.view;
      this._lastEv = ev;
      view.clearPreview();
      const p = this.app.inferPoint(ev, null).p;
      const { params, bounds } = this._boundsAt(p);
      const z0 = bounds.zStart, z1 = bounds.zEnd;
      const ring = [
        G.v(p.x - params.width / 2, p.y - params.depth / 2, z1), G.v(p.x + params.width / 2, p.y - params.depth / 2, z1),
        G.v(p.x + params.width / 2, p.y + params.depth / 2, z1), G.v(p.x - params.width / 2, p.y + params.depth / 2, z1),
      ];
      const bottom = ring.map(q => G.v(q.x, q.y, z0));
      view.previewLoop(ring, 0x0e8385);
      view.previewLoop(bottom, 0x0e8385);
      view.previewQuadsBetween(ring, bottom);
      view.stickyLabel(G.v(p.x, p.y, z1), `${params.width.toFixed(2)} x ${params.depth.toFixed(2)} x ${bounds.height.toFixed(1)} m (Z ${z0.toFixed(2)}…${z1.toFixed(2)})`, '#0a5f61', 0, 0);
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const inf = app.inferPoint(ev, null);
      const p = inf.p;
      const { params } = this._boundsAt(p);
      const facesBefore = new Set(app.model.faces.keys());
      const edgesBefore = new Set(app.model.edges.keys());
      let ok = false;
      app.transaction.run('column', m => {
        m.bimHold = true; // punching a slab at the top level keeps its entity
        try {
          const st = app.structural.buildColumn(G, m, params);
          if (!st.length) throw new Error('column placement failed');
          ok = true;
        } finally { m.bimHold = false; }
      });
      if (!ok) return;
      const m = app.model;
      // Claim only UNSTAMPED new faces: pieces of elements the column
      // punched or divided (a slab it passes through) keep their owner's
      // stamp and stay with that entity — the column never steals geometry.
      const newFaces = [...m.faces.keys()].filter(id => !facesBefore.has(id))
        .map(id => m.faces.get(id)).filter(f => f && !f.userData);
      const b = app.structural.columnBounds(params);
      const roles = {};
      for (const f of newFaces) {
        const c = m.faceCentroid(f);
        roles[f.id] = Math.abs(c.z - b.zEnd) < 1e-6 ? 'top'
          : Math.abs(c.z - b.zStart) < 1e-6 ? 'bottom' : 'side';
      }
      const newEdges = [...m.edges.keys()].filter(id => !edgesBefore.has(id))
        .filter(id => !(m.edges.get(id) || {}).userData);
      // GRID BINDING — a column placed on a grid intersection (the "A-1"
      // snap) records its two grids: GridManager.syncAttached re-centers it
      // when either grid moves, and walls drawn between carrying
      // intersections trim against it.
      if (inf.kind === 'gridX' && inf.a && inf.b) params.gridRef = { a: inf.a.id, b: inf.b.id };
      app.bim.create('column', {
        ...params,
        baseLevel: params.baseLevelId, // LevelManager.usage() key
        topConstraint: params.topLevelId || 'unconnected',
        height: b.height,
      }, roles, newEdges);
      app.view.clearPreview();
      app.toast(`Column ${params.width.toFixed(2)} x ${params.depth.toFixed(2)} x ${b.height.toFixed(1)} m placed (Z ${b.zStart.toFixed(2)}…${b.zEnd.toFixed(2)})`
        + (params.gridRef ? ` at grid ${inf.a.name}-${inf.b.name} — moves with the grids` : ''));
    }
    onVCB() { return false; }
  }

  if (window.Engine) {
    Engine.features.register({
      id: 'column',
      kind: 'tool',
      label: 'Column',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="8" y="4" width="8" height="16"/><path d="M5 20h14M6 4h12"/></svg>',
      key: 'K',
      mode: 'bim',
      commands: ['col', 'column'],
      options: [
        { key: 'width', type: 'number', label: 'Width', step: 0.05, default: 0.3 },
        { key: 'depth', type: 'number', label: 'Depth', step: 0.05, default: 0.3 },
        { key: 'height', type: 'number', label: 'Height', step: 0.1, default: 3.0 },
      ],
      tool: ColumnTool,
      state: { width: 0.3, depth: 0.3, height: 3.0 },
      onOption(d) {
        // live preview follows the typed size
        const t = window.app && window.app.tool;
        if (t && t.id === 'column' && t._lastEv) t.onMove(t._lastEv);
      },
    });
  }
  window.ColumnFeature = { ColumnTool, placeColumn };
})();
