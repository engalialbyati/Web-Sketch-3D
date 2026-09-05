'use strict';
// ---------------------------------------------------------------------------
// edit-inplace.js — the in-place "Edit Mode" sandbox (the Free Drawing bridge).
//
// Double-clicking an element (or Edit ▸ Edit In Place / the properties-panel
// button) isolates it: everything else is hidden (the B-Rep kernel already
// skips hidden faces in every operation, so edits can only reach the isolated
// mesh) and the session switches to Free Drawing, where Push/Pull, automatic
// face intersections, and Edge Trim work directly on the element's B-Rep.
//
// A top-bar banner offers [✓ Finish] [✕ Cancel] (Esc cancels).
//
//   Finish — validates the geometry, adopts every touched/new face back into
//            the element (re-stamping roles), regenerates the mesh, updates
//            the bounding box + quantities, commits the updated B-Rep to the
//            database, pushes ONE undo step (the pre-edit snapshot), and
//            returns to Precise Drawing.
//   Cancel — restores the pre-edit snapshot and returns.
//
// `model.bimHold` stays true for the whole session so structural edits
// (splits, punches, trims) keep the element's parametric stamps instead of
// detaching it — the dirty-drain in app.opDone() never fires mid-edit.
// ---------------------------------------------------------------------------
(function (root) {

  class EditInPlace {
    /**
     * app.enterEditInPlace() constructs this. snapshot/before state must be
     * captured BEFORE any face was hidden.
     */
    constructor(app, ent, snapshot, hiddenFaces, hiddenEdges, preHiddenF, preHiddenE) {
      this.app = app;
      this.ent = ent;
      this.snapshot = snapshot;        // model.serialize() at entry
      this.hiddenFaces = hiddenFaces;  // ids this session hid (restore on exit)
      this.hiddenEdges = hiddenEdges;
      this.preHiddenF = preHiddenF;    // faces already hidden at entry
      this.preHiddenE = preHiddenE;
      this._enterFaceIds = null;       // every face id live at entry
      this._undoLen = 0;
      this._switching = false;         // allows setMode during the session
      this.prevMode = app.mode;
    }

    enter() {
      const app = this.app, m = app.model;
      this._enterFaceIds = new Set(m.faces.keys());
      this._undoLen = app.undoStack.length;
      m.bimHold = true; // keep the parametric stamps alive through edits
      this._switching = true;
      try {
        if (app.mode !== 'free') app.setMode('free');
        app.setTool('select');
      } finally { this._switching = false; }
      app.clearSelection();
      this._showBanner();
      app.setStatus(`Edit In Place — "${entLabel(this.ent)}": modify it with the Free tools (P push/pull, X trim…), then ✓ Finish.`);
      app.toast('Edit In Place — the rest of the model is isolated. ✓ Finish or ✕ Cancel (Esc).');
      if (root.Engine) Engine.events.emit('editinplace:entered', { elementId: this.ent.id });
    }

    // ---------------------------------------------------------------- UI
    _showBanner() {
      const app = this.app;
      let b = document.getElementById('eipbanner');
      if (!b) return;
      document.getElementById('eip-title').textContent = `Edit In Place — ${entLabel(this.ent)}`;
      b.classList.remove('hidden');
      const f = document.getElementById('eip-finish'), c = document.getElementById('eip-cancel');
      f.onclick = () => app.finishEditInPlace();
      c.onclick = () => app.cancelEditInPlace();
    }
    _hideBanner() {
      const b = document.getElementById('eipbanner');
      if (b) b.classList.add('hidden');
    }

    // ------------------------------------------------------------- finish
    finish() {
      const app = this.app, m = app.model;
      const bail = () => {
        for (const fid of this.hiddenFaces) { const f = m.faces.get(fid); if (f) f.hidden = true; }
        for (const eid of this.hiddenEdges) { const e = m.edges.get(eid); if (e) e.hidden = true; }
        return false;
      };
      // 1) restore visibility exactly as it was at entry
      for (const fid of this.hiddenFaces) { const f = m.faces.get(fid); if (f) f.hidden = false; }
      for (const eid of this.hiddenEdges) { const e = m.edges.get(eid); if (e) e.hidden = false; }

      // 2) validate the edited geometry — errors keep the session open
      const v = m.validate();
      if (!v.ok) {
        bail();
        app.toast(`Cannot finish: invalid geometry — ${v.errors[0]}`, true);
        console.error('[edit-in-place] validate:', v.errors);
        return false;
      }

      // 3) adopt faces: every face carrying the element's stamp (stamps
      //    propagate through splits/merges) plus every face CREATED during
      //    the session (all other geometry was hidden, so new faces can only
      //    belong to this element's edit)
      const keep = [];
      for (const [fid, f] of m.faces) {
        const stamped = f.userData && f.userData.bimEntityId === this.ent.id;
        if (stamped || !this._enterFaceIds.has(fid)) keep.push(fid);
      }
      if (!keep.length) {
        bail();
        app.toast('Cannot finish: the element has no geometry left — ✕ Cancel instead', true);
        return false;
      }
      const oldRole = {};
      for (const fid of this.ent.faces) { const f = m.faces.get(fid); if (f) oldRole[fid] = f.userData && f.userData.role; }
      this.ent.faces = keep;
      const edgeIds = new Set();
      for (const fid of keep) {
        const f = m.faces.get(fid);
        f.userData = { bimEntityId: this.ent.id, bimType: this.ent.type, role: oldRole[fid] || 'edited' };
        for (const ring of m.rings(f)) {
          for (let i = 0; i < ring.length; i++) {
            const e = m.findEdge(ring[i], ring[(i + 1) % ring.length]);
            if (e) edgeIds.add(e.id);
          }
        }
      }
      this.ent.edges = [...edgeIds];

      // 4) regenerate the mesh + refresh quantities (bbox, area, volume)
      m.bimHold = false;
      const q = app.elementQuantities(this.ent);
      this.ent.params = this.ent.params || {};
      this.ent.params.quantities = q;
      if (q.bbox && this.ent.params.height != null) {
        this.ent.params.height = Math.max(0.05, q.bbox.size.z); // keep derived height in step
      }

      // 5) one undo step: drop the session's intermediate snapshots, push the
      //    pre-edit state (exactly what Transaction.commit would have done)
      app.undoStack.length = this._undoLen;
      app.redoStack.length = 0;
      app.undoStack.push(this.snapshot);
      if (app.undoStack.length > 100) app.undoStack.shift();

      app._eip = null;
      this._hideBanner();
      this._switching = true;
      try { app.setMode('bim'); } finally { this._switching = false; } // back to Precise
      app.setTool('select');
      app.selectElement(this.ent.id);
      app.opDone(); // rebuild, sync UI, schedule the DB commit
      if (root.Engine) Engine.events.emit('editinplace:finished', { elementId: this.ent.id, quantities: q });
      app.toast(`Edit In Place finished — ${q.faces} faces, ${q.area.toFixed(2)} m²${q.volume != null ? ', ' + q.volume.toFixed(3) + ' m³' : ''}`);
      return true;
    }

    // ------------------------------------------------------------- cancel
    cancel() {
      const app = this.app, m = app.model;
      m.bimHold = false;
      m.load(this.snapshot); // restores geometry AND visibility flags
      // serialize() carries no `hidden` flag: re-apply the pre-hidden state
      for (const fid of this.preHiddenF) { const f = m.faces.get(fid); if (f) f.hidden = true; }
      for (const eid of this.preHiddenE) { const e = m.edges.get(eid); if (e) e.hidden = true; }
      // drop every undo snapshot the session pushed (nothing happened)
      app.undoStack.length = this._undoLen;
      app.redoStack.length = 0;
      app._eip = null;
      this._hideBanner();
      this._switching = true;
      try { app.setMode('bim'); } finally { this._switching = false; }
      app.setTool('select');
      app.clearSelection();
      app.opDone();
      if (root.Engine) Engine.events.emit('editinplace:cancelled', { elementId: this.ent.id });
      app.toast('Edit In Place cancelled — element restored');
    }

    /**
     * Undo/redo inside the session restore a snapshot that carries no
     * `hidden` flags — re-derive the isolation from live state using the
     * same ownership rule as finish(): stamped faces + faces created since
     * entry belong to the element, everything else hides again.
     */
    reisolate() {
      const m = this.app.model;
      if (!this._enterFaceIds) return;
      const keep = new Set();
      for (const [fid, f] of m.faces) {
        const stamped = f.userData && f.userData.bimEntityId === this.ent.id;
        if (stamped || !this._enterFaceIds.has(fid)) keep.add(fid);
      }
      const keepEdges = new Set();
      for (const fid of keep) {
        const f = m.faces.get(fid);
        if (!f) continue;
        for (const ring of m.rings(f)) {
          for (let i = 0; i < ring.length; i++) {
            const e = m.findEdge(ring[i], ring[(i + 1) % ring.length]);
            if (e) keepEdges.add(e.id);
          }
        }
      }
      this.hiddenFaces = [];
      this.hiddenEdges = [];
      for (const [fid, f] of m.faces) if (!keep.has(fid) && !f.hidden) { f.hidden = true; this.hiddenFaces.push(fid); }
      for (const [eid, e] of m.edges) if (!keepEdges.has(eid) && !e.hidden) { e.hidden = true; this.hiddenEdges.push(eid); }
    }
  }

  function entLabel(ent) {
    const names = { wall: 'Wall', slab: 'Slab', door: 'Door', window: 'Window', opening: 'Wall Opening', column: 'Column' };
    return (names[ent.type] || ent.type) + ' ' + String(ent.id).replace(/^[a-z]+_/, '');
  }

  root.EditInPlace = EditInPlace;
  root.editInPlaceLabel = entLabel;
})(typeof window !== 'undefined' ? window : globalThis);
