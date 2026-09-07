'use strict';
// ---------------------------------------------------------------------------
// Feature: Foundation — the isolated pad footing (plus optional pedestal).
//
// Same SDK shape as Column (the reference feature): one Tool class, one
// Engine.features.register() descriptor — the ribbon button, 'fnd' /
// 'foundation' command aliases, options-bar fields and the undo label all
// come from the descriptor. The geometry itself lives in
// StructuralManager.buildFooting (pure, unit-tested).
//
// Vertical placement is LEVEL-DRIVEN: the pad HANGS BELOW the active Base
// Level ([Z − t, Z], foundationBounds), exactly like a slab — the picked
// point supplies x/y only, never an offset, so a footing always sits flush
// under its level. The optional pedestal sweeps UP from the level plane
// (buildFooting pushes it positive) to meet the column basing there; the
// overlap is monolithic cast-in-place behavior and the takeoff's join
// priority absorbs it, never double-counting.
//
// GRID BINDING — a click within 0.3 m of a grid intersection snaps exactly
// onto it (a plain distance test on GridManager.intersections(); the
// SnapSystem stays out of it — this tool owns its own datum) and records
// gridRef {a, b} like Column does, so the footing carries its grids.
// ---------------------------------------------------------------------------
(function () {

  const IX_RADIUS = 0.3;  // m — plan distance that still counts as "on" an intersection
  const PED_HEIGHT = 0.3; // m — pier stub above the level; StructuralManager's own default
  const PREVIEW = 0x0e8385;

  class FoundationTool extends Tool {
    static id = 'foundation';
    activate() { this.status(); }
    get hint() {
      const s = this.state || {};
      const app = this.app;
      const lvl = app.levelManager.getLevel(app.bimOptions.baseLevel);
      const ped = Math.max(0, +s.pedestal || 0);
      return `Foundation: click to place a ${(+s.width || 1.2).toFixed(2)} x ${(+s.depth || 1.2).toFixed(2)} x ${(+s.height || 0.5).toFixed(2)} m pad footing hanging below ${lvl ? lvl.name : 'the base level'}`
        + (ped >= 0.05 ? ` with a ${ped.toFixed(2)} x ${PED_HEIGHT.toFixed(2)} m pedestal above` : '')
        + `. Snap a grid intersection (A-1) to bind it to the grids, or click anywhere to place it freely. Sizes on the Options Bar.`;
    }
    /** Grid intersection within IX_RADIUS of the plan point, else null. */
    _snapIx(x, y) {
      const gm = this.app.gridManager;
      if (!gm) return null;
      let best = null, bestD = IX_RADIUS;
      for (const ix of gm.intersections()) {
        const d = Math.hypot(ix.p[0] - x, ix.p[1] - y);
        if (d < bestD) { bestD = d; best = ix; }
      }
      return best;
    }
    /** Entity params for a plan position: the level datum supplies every z —
     *  the footing is always flush with its Base Level (no picked offsets,
     *  unlike a column which measures baseOffset off real geometry). */
    _paramsAt(x, y) {
      const app = this.app, s = this.state || {};
      const baseLevel = app.bimOptions.baseLevel;
      const params = {
        base: [x, y, app.levelManager.getElevation(baseLevel)],
        baseLevel,
        width: Math.max(0.05, +s.width || 1.2),
        depth: Math.max(0.05, +s.depth || 1.2),
        // the option names the pad's depth BELOW the level; foundationBounds
        // (and the takeoff) call that dimension thickness
        thickness: Math.max(0.05, +s.height || 0.5),
      };
      const ped = +s.pedestal || 0;
      if (ped >= 0.05) params.pedestal = { width: ped, depth: ped, height: PED_HEIGHT };
      return params;
    }
    _ringAt(x, y, hw, hd, z) {
      return [
        G.v(x - hw, y - hd, z), G.v(x + hw, y - hd, z),
        G.v(x + hw, y + hd, z), G.v(x - hw, y + hd, z),
      ];
    }
    /** Plan position for an event: the inferred point, replaced EXACTLY by a
     *  nearby grid intersection when one is in range. Never mutates the
     *  inferred point — on an endpoint snap it IS the model vertex. */
    _pos(ev) {
      const p = this.app.inferPoint(ev, null).p;
      const ix = this._snapIx(p.x, p.y);
      return ix ? { x: ix.p[0], y: ix.p[1], ix } : { x: p.x, y: p.y, ix: null };
    }
    onMove(ev) {
      this._lastEv = ev;
      const app = this.app, view = app.view;
      view.clearPreview();
      const { x, y, ix } = this._pos(ev);
      const params = this._paramsAt(x, y);
      const b = app.structural.foundationBounds(params);
      // pad ghost: plan ring at both extremes, walls between
      const top = this._ringAt(x, y, params.width / 2, params.depth / 2, b.zTop);
      const bot = this._ringAt(x, y, params.width / 2, params.depth / 2, b.zBottom);
      view.previewLoop(top, PREVIEW);
      view.previewLoop(bot, PREVIEW);
      view.previewQuadsBetween(top, bot);
      let zLabel = b.zTop;
      if (params.pedestal) {
        const pw = params.pedestal.width / 2, pd = params.pedestal.depth / 2;
        const foot = this._ringAt(x, y, pw, pd, b.zTop);
        const head = this._ringAt(x, y, pw, pd, b.zTop + params.pedestal.height);
        view.previewLoop(foot, PREVIEW);
        view.previewLoop(head, PREVIEW);
        view.previewQuadsBetween(head, foot);
        zLabel = b.zTop + params.pedestal.height;
      }
      view.stickyLabel(G.v(x, y, zLabel),
        `Pad ${params.width.toFixed(2)} x ${params.depth.toFixed(2)} x ${b.thickness.toFixed(2)} m (Z ${b.zBottom.toFixed(2)}…${b.zTop.toFixed(2)})`
        + (params.pedestal ? ` + pedestal ${params.pedestal.width.toFixed(2)} x ${params.pedestal.height.toFixed(2)} m above` : '')
        + (ix ? ` — grid ${ix.a.name}-${ix.b.name}` : ''),
        '#0a5f61', 0, 0);
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const { x, y, ix } = this._pos(ev);
      const params = this._paramsAt(x, y);
      const facesBefore = new Set(app.model.faces.keys());
      const edgesBefore = new Set(app.model.edges.keys());
      let ok = false;
      app.transaction.run('foundation', m => {
        m.bimHold = true; // the pedestal deliberately interpenetrates a based column
        try {
          const faces = app.structural.buildFooting(G, m, params);
          if (!faces.length) throw new Error('foundation placement failed');
          ok = true;
        } finally { m.bimHold = false; }
      });
      if (!ok) return;
      const m = app.model;
      // Claim only UNSTAMPED new faces (the column.js contract): pieces of
      // elements the footing's sweep divided keep their owner's stamp
      const newFaces = [...m.faces.keys()].filter(id => !facesBefore.has(id))
        .map(id => m.faces.get(id)).filter(f => f && !f.userData);
      // roles from the solid's own z extents: the pad spans [zBottom, zTop]
      // and everything the pedestal swept sits ABOVE zTop — a single-range
      // test would mislabel the pier's side faces
      const b = app.structural.foundationBounds(params);
      const roles = {};
      for (const f of newFaces) {
        const c = m.faceCentroid(f);
        roles[f.id] = Math.abs(c.z - b.zBottom) < 1e-6 ? 'bottom'
          : c.z > b.zTop + 1e-6 ? 'pedestal'
          : Math.abs(c.z - b.zTop) < 1e-6 ? 'top'
          : 'side';
      }
      const newEdges = [...m.edges.keys()].filter(id => !edgesBefore.has(id))
        .filter(id => !(m.edges.get(id) || {}).userData);
      // GRID BINDING — the footing records its two grids exactly like a
      // column placed on the "A-1" snap
      if (ix) params.gridRef = { a: ix.a.id, b: ix.b.id };
      app.bim.create('foundation', { ...params }, roles, newEdges);
      app.view.clearPreview();
      const lvl = app.levelManager.getLevel(app.bimOptions.baseLevel);
      app.toast(`Pad footing ${params.width.toFixed(2)} x ${params.depth.toFixed(2)} x ${b.thickness.toFixed(2)} m placed below ${lvl ? lvl.name : 'the base level'} (Z ${b.zBottom.toFixed(2)}…${b.zTop.toFixed(2)})`
        + (params.pedestal ? ` — pedestal ${params.pedestal.width.toFixed(2)} x ${params.pedestal.height.toFixed(2)} m above` : '')
        + (ix ? ` at grid ${ix.a.name}-${ix.b.name}` : ''));
    }
    onVCB() { return false; }
  }

  if (window.Engine) {
    Engine.features.register({
      id: 'foundation',
      kind: 'tool',
      label: 'Foundation',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 19h16l-2.5-4h-11z"/><path d="M10 15V9h4v6"/><path d="M9 6h6"/></svg>',
      mode: 'bim',
      commands: ['fnd', 'foundation'],
      options: [
        { key: 'width', type: 'number', label: 'Width', step: 0.05, default: 1.2 },
        { key: 'depth', type: 'number', label: 'Depth', step: 0.05, default: 1.2 },
        // the pad's depth below the level — the footing's "height" in Revit
        // terms; pedestal 0 = pad only, otherwise the square pier's plan size
        { key: 'height', type: 'number', label: 'Depth below', step: 0.05, default: 0.5 },
        { key: 'pedestal', type: 'number', label: 'Pedestal', step: 0.05, default: 0 },
      ],
      tool: FoundationTool,
      state: { width: 1.2, depth: 1.2, height: 0.5, pedestal: 0 },
      onOption() {
        // live preview follows the typed size / pedestal
        const t = window.app && window.app.tool;
        if (t && t.id === 'foundation' && t._lastEv) t.onMove(t._lastEv);
      },
    });
  }
  window.FoundationFeature = { FoundationTool };
})();
