'use strict';
// ---------------------------------------------------------------------------
// tools/assets.js — placement tools for downloaded (BlenderKit) element types.
//
// Activated from the Element Browser when a type carries defaultParameters
// .assetId (created by "Define as Door / Window / Object" in the BlenderKit
// palette):
//
//   AssetPlaceTool       free object — hover ghost, click to drop on the
//                        ground (grid snap), click again for more copies
//   AssetDoorTool /      hosted on a BIM wall: the full HostedInsertionTool
//   AssetWindowTool      interaction (pin, slide, VCB w×h[×sill], arrays)
//                        with one difference — the "frame" is the downloaded
//                        glTF model, not kernel faces. The kernel still gets
//                        the real opening via HostedCut; no bimEntity is
//                        created (face-less entities would be auto-detached;
//                        app.assets.recutHosted is the bookkeeping instead).
// ---------------------------------------------------------------------------
(function () {

  const G = window.G;

  // ------------------------------------------------------------ free object
  class AssetPlaceTool extends Tool {
    static id = 'assetplace';
    activate() {
      this.app.setStatus('');
      this._tpl = null;
      this._asset = null;
      const o = this.app.bimOptions || {};
      if (!o.assetId) { this.app.toast('No asset armed — define a downloaded model in the BlenderKit palette first', true); return; }
      this._asset = { id: o.assetId, name: o.assetName || 'Asset' };
      this.app.assets.loadTemplate(o.assetId, this._asset.name)
        .then(t => { this._tpl = t; this.status(); })
        .catch(e => this.app.toast(`Asset unavailable: ${e.message}`, true));
      this.status();
    }
    get hint() {
      return 'Place Asset: hover the ground (grid snap on), click to drop the model there. Click again for another copy; Esc or another tool ends placement.';
    }
    onMove(ev) {
      const app = this.app, view = app.view;
      if (!this._asset) return;
      view.clearPreview();
      // surface, not bare ground: over a face (slab/roof/floor) the ghost
      // rides that face's elevation; elsewhere the active level's floor
      const g = view.surfaceAt(view.eventPt(ev));
      if (!g) return;
      const p = { x: g.x, y: g.y, z: g.z };
      if (app.gridSnap) { p.x = Math.round(p.x); p.y = Math.round(p.y); }
      this._last = p;
      // ghost = the footprint fill + corner posts of the model's bbox (the
      // real model only appears on click — cloning per mousemove is wasteful)
      const s = this._tpl ? this._tpl.size : { x: 1, y: 1, z: 1 };
      const k = this._tpl ? Math.min(1, 5 / Math.max(s.x, s.y, s.z)) : 1;
      const w = s.x * k / 2, d = s.y * k / 2, h = s.z * k;
      const q = [[p.x - w, p.y - d], [p.x + w, p.y - d], [p.x + w, p.y + d], [p.x - w, p.y + d]];
      view.previewFill([{ outer: q.map(x => G.v(x[0], x[1], p.z)), holes: [] }], 0x2f6fdb, 0.18);
      for (const [x, y] of q) view.previewLine([G.v(x, y, p.z), G.v(x, y, p.z + h)], 0x1f6fd6);
      app.setStatus(`${this._asset.name} — ${fmtLen(s.x * k)} × ${fmtLen(s.y * k)} × ${fmtLen(h)} — click to place`);
    }
    onDown(ev) {
      if (ev.button !== 0 || !this._tpl || !this._asset) return;
      const app = this.app;
      const p = this._last || app.view.surfaceAt(app.view.eventPt(ev));
      if (!p) return;
      const pt = { x: p.x, y: p.y, z: p.z };
      if (app.gridSnap) { pt.x = Math.round(pt.x); pt.y = Math.round(pt.y); }
      const rec = app.assets.placeFree(this._asset.id, this._asset.name, this._tpl, pt);
      app.view.clearPreview();
      app.toast(`Placed “${rec.name}” at (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}) — M to move, Del to remove`);
      app.selectAsset(rec.id);
    }
    cleanup() { super.cleanup(); this.app.view.clearPreview(); }
  }

  // --------------------------------------------------------- hosted on wall
  // window.BimTools (not bare BimTools): the class body evaluates at load
  // time, and the headless suite loads this file without a browser global
  class AssetHostedTool extends window.BimTools.HostedInsertionTool {
    constructor(app, kind) {
      super(app, kind);
      this.assetId = null;
      this.assetName = 'Asset';
      this._tpl = null;
    }
    activate() {
      super.activate();
      const o = this.app.bimOptions || {};
      this.assetId = o.assetId || null;
      this.assetName = o.assetName || 'Asset';
      this._tpl = null;
      if (!this.assetId) {
        this.app.toast('No asset armed — define a downloaded model in the BlenderKit palette first', true);
        return;
      }
      this.app.assets.loadTemplate(this.assetId, this.assetName)
        .then(t => { this._tpl = t; })
        .catch(e => this.app.toast(`Asset unavailable: ${e.message}`, true));
    }
    get hint() {
      const k = window.BimTools.HostedInsertionTool.kinds[this.kind];
      return k.label + ' (downloaded model): hover a WALL, click to pin, drag to slide, click again to cut the opening and host the model. Type w×h[×sill] to size the opening.';
    }
    // downloaded models host on BIM walls only — free faces have no
    // parametric host to re-cut against when the wall changes
    _hostAt(ev) {
      const h = super._hostAt(ev);
      if (h && h.kind !== 'wall') {
        this._refusal = 'downloaded models host on BIM walls — draw one with the Wall tool (W) first';
        return null;
      }
      return h;
    }
    // Same transaction shape as HostedInsertionTool._placeOne, but the
    // element is a glTF instance in app.assets instead of kernel faces.
    _placeOne(m, host, dist) {
      const app = this.app;
      if (!this._tpl) { app.toast('The model is still loading — one moment', true); return; }
      const hp = host.ent.params;
      const depth = this.spec.depth > 0 ? this.spec.depth : hp.thickness;
      const spec = {
        distanceFromStart: dist, width: this.spec.width,
        height: this.spec.height, sillHeight: this.spec.sill, depth,
      };
      let info = null, pend = null;
      try {
        app.transaction.run('place asset ' + this.kind, mm => {
          // v0.6 owner naming (same as HostedInsertionTool): the cut edits
          // the HOST wall's stamped faces on purpose — an unnamed hold would
          // make element independence refuse the punch ("opening does not
          // sit inside a host face")
          mm.bimHold = host.kind === 'wall' ? host.ent.id : true;
          const facesBefore = new Set(mm.faces.keys());
          try {
            info = window.BimTools.HostedCut.cut(G, mm, hp, spec);
            if (info.error) throw new Error(info.error);
          } finally { mm.bimHold = false; }
          // ELEMENT IDENTITY: the cut's new faces (reveal band + boundary
          // split pieces) become a real door/window ENTITY exactly like the
          // built-in tools' output — the Element Browser lists it, rebuilds
          // re-cut it, deleting it heals the wall, and params link the
          // hosted model instance (assetInstanceId)
          const fresh = [...mm.faces.keys()].filter(id => !facesBefore.has(id))
            .map(id => mm.faces.get(id)).filter(Boolean);
          const roles = {};
          for (const f of fresh) roles[f.id] = 'lining';
          const ownFaceIds = new Set(fresh.map(f => f.id));
          const elementEdges = [];
          for (const f of fresh) for (const r of mm.rings(f)) for (let i = 0; i < r.length; i++) {
            const e = mm.findEdge(r[i], r[(i + 1) % r.length]);
            if (!e || elementEdges.includes(e.id)) continue;
            const adj = mm.facesAdjacentToEdge(e);
            // edges SHARED with the host wall stay the wall's — deleting the
            // element later must not cascade-delete wall faces (same guard
            // as HostedInsertionTool)
            if (adj.length > 0 && adj.every(x => ownFaceIds.has(x.id))) elementEdges.push(e.id);
          }
          pend = {
            kind: this.kind, hostWallId: host.ent.id, distanceFromStart: info.t,
            sillHeight: spec.sillHeight, width: spec.width, height: spec.height,
            depth, facing: 1, hand: 1, name: this.assetName,
            assetId: this.assetId,
            roles, elementEdges,
          };
        });
      } catch (e) { app.toast(String(e.message || e)); return; }
      // _runTx swallows a failed transaction (toast + rollback, returns
      // undefined) — `info` may hold the cut's error object or nothing at
      // all. Nothing was cut: stop here, never host into a wall that healed.
      if (!info || info.error) { if (info && info.error) app.toast(info.error, true); return; }
      const rec = app.assets.placeHosted(this.assetId, this.assetName, this._tpl, {
        wallId: host.ent.id, distance: info.t, sill: spec.sillHeight,
        width: spec.width, height: spec.height, depth, kindHint: this.kind,
      }, info);
      // register the element AFTER the transaction, like the native tools:
      // bim.create fires opDone, and the entity carries the instance link
      if (pend) {
        const { kind, roles, elementEdges, ...entParams } = pend;
        entParams.assetInstanceId = rec.id;
        app.bim.create(kind, entParams, roles, elementEdges);
      }
      app.view.clearPreview();
      app.toast(`${this.assetName} hosted at ${fmtLen(info.t)} from the wall's left edge — click it to select, M to slide along the wall`);
      return true;
    }
  }
  class AssetDoorTool extends AssetHostedTool { static id = 'assetdoor'; constructor(app) { super(app, 'door'); } }
  class AssetWindowTool extends AssetHostedTool { static id = 'assetwindow'; constructor(app) { super(app, 'window'); } }

  window.AssetTools = { AssetPlaceTool, AssetHostedTool, AssetDoorTool, AssetWindowTool };
})();
