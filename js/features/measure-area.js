'use strict';
// ---------------------------------------------------------------------------
// Feature: Measure Area — the area counterpart of the Tape Measure.
// Activate it from the ribbon (or type `area` / `ar`), then click faces:
// each pick stamps a live measurement label on the face (NET area — openings
// deducted, with the gross − openings breakdown when holes exist) and adds
// its highlight to the running total. Click a measured face again to drop
// it; Esc clears the measurement set.
// ---------------------------------------------------------------------------
(function () {

  class MeasureAreaTool extends Tool {
    static id = 'area';
    activate() { this.picked = []; this._total = 0; this.status(); }
    cleanup() { super.cleanup(); this.activate(); }
    get hint() {
      const n = this.picked.length;
      return n
        ? `Area: ${this._total.toFixed(3)} m² across ${n} face${n > 1 ? 's' : ''}. Click more faces to add — click a measured one to drop it — Esc clears.`
        : 'Area: click a face to measure it (net of openings). Areas accumulate across picks.';
    }
    // labels are sticky (cleared by clearPreview on every move) — redraw them
    // each move so the measurements stay on screen while you keep picking
    _drawLabels() {
      const m = this.app.model, view = this.app.view;
      let total = 0;
      for (const p of this.picked) {
        const f = m.faces.get(p.fid);
        if (!f) continue;
        const net = m.faceArea(f); // net: holes already deducted
        total += net;
        let holes = 0;
        for (const h of (f.holes || [])) holes += G.loopArea(m.pts(h));
        const c = m.faceCentroid(f);
        view.stickyLabel(c, `${net.toFixed(3)} m²${holes > 5e-4 ? ' net' : ''}`, '#0a5f61', 0, -16);
        if (holes > 5e-4)
          view.stickyLabel(c, `gross ${(net + holes).toFixed(3)} − openings ${holes.toFixed(3)}`, '#7a838c', 0, 0);
      }
      this._total = total;
    }
    onMove(ev) {
      const app = this.app, view = app.view;
      view.clearPreview();
      const fid = view.pickFaceAt(view.eventPt(ev));
      // hover everything except faces already in the measurement set
      view.setHoverFace(this.picked.some(p => p.fid === fid) ? null : fid);
      this._drawLabels();
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app, view = app.view;
      const fid = view.pickFaceAt(view.eventPt(ev));
      if (fid == null) { app.toast('Click a face to measure its area'); return; }
      const f = app.model.faces.get(fid);
      if (!f) return;
      const i = this.picked.findIndex(p => p.fid === fid);
      if (i >= 0) this.picked.splice(i, 1); // toggle off
      else this.picked.push({ fid });
      // mirror the set into the selection so the measured areas highlight
      app.sel = { edges: new Set(), faces: new Set(this.picked.map(p => p.fid)) };
      app.onSelectionChanged();
      view.clearPreview(); // drop the previous labels before restamping
      this._drawLabels();
      this.status();
    }
    onKey(ev) {
      if (ev.key === 'Escape') {
        this.picked = [];
        this._total = 0;
        this.app.clearSelection();
        this.app.view.clearPreview();
        this.status();
        return true;
      }
      return false;
    }
    onVCB() { return false; }
  }

  if (window.Engine) {
    Engine.features.register({
      id: 'area',
      kind: 'tool',
      label: 'Measure Area',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="6" width="16" height="12" rx="1"/><path d="M4 10h16M8 6v12M12 6v12M16 6v12"/><path d="M10 3v3M14 3v3" stroke-linecap="round"/></svg>',
      key: '',
      mode: 'free',
      commands: ['area', 'ar', 'measure'],
      tool: MeasureAreaTool,
    });
  }
  window.MeasureAreaFeature = { MeasureAreaTool };
})();
