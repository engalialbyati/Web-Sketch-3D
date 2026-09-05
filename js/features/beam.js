'use strict';
// ---------------------------------------------------------------------------
// Feature: Structural Beam (Rectangular / T-Beam / L-Beam).
//
// Draw a baseline on the reference level (shared Draw primitives); the
// parametric cross-section from StructuralManager.BeamProfiles is swept
// along it through the B-Rep kernel, so beams weld into columns and walls
// exactly like hand-drawn solids. Top justification (default): the beam
// HANGS from the reference floor plane — [Z(level) - h, Z(level)] — with
// the flange top flush to the slab soffit plane and the stem dropping below.
//
// After every placement, level-bounded infill walls crossing the new beam
// re-query their clearance and terminate under the beam's underside.
// ---------------------------------------------------------------------------
(function () {

  class BeamTool extends Tool {
    static id = 'beam';
    activate() {
      this.engine = new DrawPrimitiveEngine(this.app, {
        primitives: ['line', 'pick'],
        getOptions: () => this.app.bimOptions,
        planePoint: ev => this._pt(ev),
        onCommit: r => this._commit(r),
        onModeChange: () => this.status(),
        color: 0x0e7490, fill: 0x0891b2, fillAlpha: 0.2,
      });
      this.status();
    }
    get hint() {
      const s = this.state || {};
      const lvl = this.app.levelManager.getLevel(this.app.bimOptions.baseLevel);
      const prof = { rectangular: 'Rectangular', t: 'T-Beam', l: 'L-Beam' }[s.profile || 'rectangular'];
      const dims = prof === 'Rectangular'
        ? `${(s.webWidth || 0.25).toFixed(2)} x ${(s.height || 0.5).toFixed(2)} m`
        : `h=${(s.height || 0.6).toFixed(2)} b_w=${(s.webWidth || 0.25).toFixed(2)} b_f=${(s.flangeWidth || 0.6).toFixed(2)} h_f=${(s.flangeThickness || 0.15).toFixed(2)} m`;
      return `Beam (${prof}, ${dims}): draw the baseline on ${lvl ? lvl.name : 'the reference level'} — the ${prof === 'Rectangular' ? 'beam' : 'section'} hangs DOWN from that plane. VCB: "length".`;
    }
    _pt(ev) {
      const anchor = this.engine.stage === 1 ? this.engine.p1 : this.engine.chainStart;
      const p = this.app.inferPoint(ev, anchor).p;
      const z = this.app.levelManager.getElevation(this.app.bimOptions.baseLevel);
      return G.v(p.x, p.y, z);
    }
    _params(A, B) {
      const s = this.state || {};
      return {
        referenceLevelId: this.app.bimOptions.baseLevel,
        baseLevel: this.app.bimOptions.baseLevel, // LevelManager.usage() key
        zJustification: 'Top',
        profile: s.profile || 'rectangular',
        height: Math.max(0.05, s.height || 0.5),
        webWidth: Math.max(0.02, s.webWidth || 0.25),
        flangeWidth: Math.max(0.02, s.flangeWidth || 0.6),
        flangeThickness: Math.max(0.02, s.flangeThickness || 0.15),
        flangeSide: s.flangeSide === 'Left' ? 'Left' : 'Right',
        baseline: [[A.x, A.y, A.z], [B.x, B.y, B.z]],
      };
    }
    onMove(ev) {
      this.engine.onMove(ev);
      // solid preview: the swept section between anchor and cursor
      const e = this.engine, view = this.app.view;
      const start = e.stage === 1 ? e.p1 : e.chainStart;
      if (e.primitive === 'line' && start && e.cur) {
        const p = this._params(start, e.cur);
        const a = this.app.structural.profileWorld(G, p, p.baseline[0]);
        const b = this.app.structural.profileWorld(G, p, p.baseline[1]);
        view.previewLoop(a, 0x0e7490);
        view.previewLoop(b, 0x0e7490);
        view.previewQuadsBetween(a, b, 0x0891b2, 0.3);
        const bb = this.app.structural.beamBounds(p);
        view.stickyLabel(G.v((start.x + e.cur.x) / 2, (start.y + e.cur.y) / 2, bb.zBottom),
          `Z: ${bb.zBottom.toFixed(2)}…${bb.zTop.toFixed(2)} m`, '#0e7490', 0, 0);
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
    _commit(r) {
      const app = this.app;
      if (!r.pts || r.pts.length < 2) return;
      const A = r.pts[0], B = r.pts[r.pts.length - 1];
      if (G.dist(G.v(A.x, A.y, 0), G.v(B.x, B.y, 0)) < 0.05) { app.toast('Beam baseline too short'); return; }
      const params = this._params(A, B);
      const m = app.model;
      // walls under this beam regenerate below its soffit FIRST — the sweep
      // then lands in clear air instead of tunneling through wall material
      if (app.preTrimWallsFor) app.preTrimWallsFor({ id: '__pending__', type: 'beam', params });
      const facesBefore = new Set(m.faces.keys());
      const edgesBefore = new Set(m.edges.keys());
      let ok = false;
      app.transaction.run('beam', mm => {
        mm.bimHold = true; // the beam deliberately meets its neighbors
        try {
          const st = app.structural.buildBeam(G, mm, params);
          if (!st.length) throw new Error('beam sweep produced nothing');
          ok = true;
        } finally { mm.bimHold = false; }
      });
      if (!ok) return; // rolled back
      // Claim only UNSTAMPED new faces: splits of pre-existing elements
      // (a wall the beam's section crosses) keep their owner's stamp and
      // stay with that entity — the beam never steals geometry it divided.
      const newFaces = [...m.faces.keys()].filter(id => !facesBefore.has(id))
        .map(id => m.faces.get(id)).filter(f => f && !f.userData);
      const roles = app.structural.classifyBeamRoles(G, m, newFaces, params);
      const newEdges = [...m.edges.keys()].filter(id => !edgesBefore.has(id))
        .filter(id => !(m.edges.get(id) || {}).userData);
      app.bim.create('beam', params, roles, newEdges);
      // dynamic infill walls under the new beam terminate at its underside
      const trimmed = app.syncStructuralWalls ? app.syncStructuralWalls() : 0;
      const prof = { rectangular: 'Rectangular', t: 'T', l: 'L' }[params.profile] || '';
      app.view.clearPreview();
      app.toast(`Beam (${prof}) placed — hangs from ${app.levelManager.getLevel(params.referenceLevelId).name}`
        + (trimmed ? `; ${trimmed} wall${trimmed === 1 ? '' : 's'} trimmed to clear it` : ''));
      this.status();
    }
  }

  if (window.Engine) {
    Engine.features.register({
      id: 'beam',
      kind: 'tool',
      label: 'Beam',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 5h18M3 5v3h18V5M6 8v11h5V8M13 8v11h5V8"/></svg>',
      key: 'B',
      mode: 'bim',
      commands: ['beam', 'bm'],
      options: [
        { key: 'profile', type: 'select', label: 'Profile', choices: [{ value: 'rectangular', label: 'Rectangular' }, { value: 't', label: 'T-Beam' }, { value: 'l', label: 'L-Beam' }] },
        { key: 'height', type: 'number', label: 'h', step: 0.05, default: 0.5 },
        { key: 'webWidth', type: 'number', label: 'b_w', step: 0.05, default: 0.25 },
        { key: 'flangeWidth', type: 'number', label: 'b_f', step: 0.05, default: 0.6 },
        { key: 'flangeThickness', type: 'number', label: 'h_f', step: 0.05, default: 0.15 },
        { key: 'flangeSide', type: 'select', label: 'Flange', choices: [{ value: 'Right', label: 'Right' }, { value: 'Left', label: 'Left' }] },
      ],
      tool: BeamTool,
      state: { profile: 'rectangular', height: 0.5, webWidth: 0.25, flangeWidth: 0.6, flangeThickness: 0.15, flangeSide: 'Right' },
      onOption(d) {
        const t = window.app && window.app.tool;
        if (t && t.id === 'beam') t.status();
      },
    });
  }
  window.BeamFeature = { BeamTool };
})();
