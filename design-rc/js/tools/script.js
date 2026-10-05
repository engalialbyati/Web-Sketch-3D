'use strict';
// ---------------------------------------------------------------------------
// tools/script.js — ScriptPlaceTool: places a Scripted Element type.
//
// Activated from the Element Browser (Scripted category). The script decides
// the interaction: placement 'point' = one click; 'direction' = click the
// start, drag along the run, click the end (the wall gesture). The ghost
// preview is the REAL geometry: the script builds into the model under
// bimHold, its faces render as a preview fill, then the build is deleted —
// the commit rebuilds it permanently. One code path, honest previews.
// ---------------------------------------------------------------------------
(function () {
  const G = window.G;

  class ScriptPlaceTool extends Tool {
    static id = 'scriptplace';
    activate() {
      this.app.setStatus('');
      this.script = null;
      this.values = null;
      this.p1 = null;
      this._ghostKey = null; this._ghostWant = null; this._ghostTimer = null;
      const o = this.app.bimOptions || {};
      if (o.scriptId && this.app.scriptElements) {
        this.script = this.app.scriptElements.get(o.scriptId);
        if (this.script) {
          this.values = {};
          for (const p of this.script.params)
            this.values[p.id] = (o.scriptValues && o.scriptValues[p.id] != null)
              ? this.app.scriptElements.coerceValue(p, o.scriptValues[p.id])
              : p.def;
          this.status();
          return;
        }
      }
      this.app.toast('No scripted element armed — pick one from the Element Browser (Scripted category), or type “script” to create one', true);
    }
    get hint() {
      if (!this.script) return 'Scripted Element: pick a type from the Element Browser first.';
      return this.script.placement === 'direction'
        ? `${this.script.name}: click the start point, drag along the run, click again to place.`
        : `${this.script.name}: click to place (params are editable afterwards in Entity Info).`;
    }
    status() { this.app.setStatus(this.hint); }

    _ground(ev, anchor) {
      const inf = this.app.inferPoint(ev, anchor || null);
      return inf.p;
    }

    // Real-geometry ghost: build into the model, preview the faces, delete.
    // Rebuilding a full script per mousemove is janky even for tiny geometry
    // (kernel build + whole-model gc + script toasts, 60×/s), so ghosts are
    // throttled to ~14 builds/s and skipped entirely while the snapped
    // inputs are unchanged — the last preview simply stays on screen.
    _ghost(base, end) {
      const app = this.app, m = app.model, view = app.view;
      view.clearPreview();
      if (!this.script) return;
      m.bimHold = true;
      m.noAutoIntersect = true; // ghost geometry is disposable — never intersect it with the model
      let built = null;
      try {
        built = app.scriptElements.buildInto(m, this.script, this.values,
          { base: [base.x, base.y, base.z], end: end ? [end.x, end.y, end.z] : null },
          { preview: true });
        for (const f of built.faces)
          view.previewFill([{ outer: m.pts(f.loop), holes: (f.holes || []).map(h => m.pts(h)) }], 0x2f6fdb, 0.25);
      } catch (e) {
        // a bad param combination: show the error once, keep the tool alive
        if (!this._ghostErr) { this._ghostErr = true; app.toast(e.message, true); }
      } finally {
        if (built) {
          for (const f of built.faces) m.faces.delete(f.id);
          for (const eid of built.edges) m.edges.delete(eid);
        }
        m.bimHold = false;
        m.noAutoIntersect = false;
        // no m.gc() per preview — ghost orphans accumulate harmlessly during
        // the drag and are swept once, in cleanup() / after a placement
      }
    }
    _scheduleGhost(base, end) {
      if (!this.script) return;
      const k = this._ghostKeyOf(base, end);
      if (k === this._ghostKey) return; // snapped point unchanged — keep the shown preview
      this._ghostWant = { base, end };
      if (this._ghostTimer != null) return; // a build is scheduled; it takes the latest inputs
      this._ghostTimer = setTimeout(() => { this._ghostTimer = null; this._ghostTick(); }, 70);
    }
    _ghostKeyOf(base, end) {
      const k = b => b.x.toFixed(3) + ',' + b.y.toFixed(3) + ',' + b.z.toFixed(3);
      return k(base) + '|' + (end ? k(end) : '');
    }
    // the scheduled build: takes the LATEST inputs, skipping unchanged ones.
    // Split out of the setTimeout so tests can drive it synchronously.
    _ghostTick() {
      const w = this._ghostWant;
      if (!w || !this.script) return;
      const k = this._ghostKeyOf(w.base, w.end);
      if (k === this._ghostKey) return;
      this._ghostKey = k;
      this._ghost(w.base, w.end);
    }
    _sweep() { // one gc for the whole drag, not one per preview
      if (this._ghostTimer != null) { clearTimeout(this._ghostTimer); this._ghostTimer = null; }
      this._ghostWant = null;
      this._ghostKey = null;
      try { this.app.model.gc(); } catch (e) { }
    }

    onMove(ev) {
      if (!this.script) return;
      if (this.script.placement === 'direction') {
        if (this.p1) this._scheduleGhost(this.p1, this._ground(ev, this.p1));
      } else {
        this._scheduleGhost(this._ground(ev), null);
      }
    }

    onDown(ev) {
      if (ev.button !== 0 || !this.script) return;
      const app = this.app;
      const z = app.bimOptions.baseLevel ? app.levelManager.getElevation(app.bimOptions.baseLevel) : null;
      if (this.script.placement === 'direction') {
        const p = this._ground(ev, this.p1);
        const q = G.v(p.x, p.y, z != null ? z : p.z);
        if (!this.p1) {
          this.p1 = q;
          this._ghostErr = false;
          app.setStatus(`${this.script.name}: drag along the run, click again to place (Esc cancels)`);
          return;
        }
        const p2 = this._ground(ev, this.p1);
        if (Math.hypot(p2.x - this.p1.x, p2.y - this.p1.y) < 0.1) return;
        app.view.clearPreview();
        const end = G.v(p2.x, p2.y, this.p1.z);
        const ent = app.scriptElements.place(this.script.id, this.values,
          { base: [this.p1.x, this.p1.y, this.p1.z], end: [end.x, end.y, end.z] });
        if (ent) {
          app.selectElement(ent.id);
          app.toast(`“${this.script.name}” placed — its parameters are editable in Entity Info`);
        }
        this._sweep();
        this.p1 = null; // stay armed for another placement
        return;
      }
      // 'point' placement
      const p = this._ground(ev);
      const q = G.v(p.x, p.y, z != null ? z : p.z);
      app.view.clearPreview();
      const ent = app.scriptElements.place(this.script.id, this.values, { base: [q.x, q.y, q.z], end: null });
      if (ent) {
        app.selectElement(ent.id);
        app.toast(`“${this.script.name}” placed — its parameters are editable in Entity Info`);
      }
      this._sweep();
    }

    onKey(ev) {
      if (ev.key === 'Escape') {
        this.p1 = null;
        this.app.view.clearPreview();
        this._sweep();
        this.status();
        return true;
      }
      return false;
    }
    cleanup() { super.cleanup(); this.p1 = null; this.app.view.clearPreview(); this._sweep(); }
    onVCB() { return false; }
  }

  window.ScriptTools = { ScriptPlaceTool };
})();
