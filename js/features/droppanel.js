'use strict';
// ---------------------------------------------------------------------------
// Feature: Drop Panel — a STANDALONE flat-slab drop panel (ETABS
// eCSIObjectTypes.DropPanel parity). The workflow the tool serves:
//   1. draw the column (Column tool), 2. run the punching check,
//   3. where DCR > 1, drop a Drop Panel over that column.
// The panel is its own entity ('droppanel'), NOT part of the column:
//   - the RC mesher THICKENS the covering slab's cells inside the panel
//     footprint (total = slab t + drop depth) — never a second overlapping
//     shell patch (no double stiffness/weight),
//   - punching shear checks BOTH critical sections: at the column face
//     with the total depth, and at the drop edge with the slab depth,
//   - Define auto-detects & syncs it into a droppanel area section by dims
//     (planL × planW × totalT) and stamps params.designSection,
//   - Entity Info edits planL / planW / dropDepth live (rebuilds geometry).
// Place: click (snaps to columns / grid intersections). VCB: a number sets
// the plan size (square); 'd0.2' sets the drop depth.
// ---------------------------------------------------------------------------
(function () {

  const DEFAULTS = { planL: 1.8, planW: 1.8, dropDepth: 0.15 };

  // covering slab at a level: its thickness (slabs extrude DOWN from the
  // level plane) — the drop hangs flush under the soffit
  function coveringSlab(app, x, y, zLvl) {
    let best = null;
    for (const ent of app.bim.entities) {
      if ((ent.type !== 'slab' && ent.type !== 'floor' && ent.type !== 'roof')
        || !Array.isArray(ent.params.regions)) continue;
      const zReg = ent.params.baseLevel
        ? (app.levelManager.getLevel(ent.params.baseLevel) || {}).elevation
        : (ent.params.regions[0].outer || [])[0] != null ? (ent.params.regions[0].outer[0][2] || 0) : 0;
      if (Math.abs(zReg - zLvl) > 0.05) continue;
      for (const reg of ent.params.regions) {
        const o = reg.outer || [];
        let inside = false;
        for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
          const [xi, yi] = o[i], [xj, yj] = o[j];
          if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
        }
        if (inside) { best = ent; break; }
      }
      if (best) break;
    }
    return best;
  }

  class DropPanelTool extends Tool {
    static id = 'droppanel';
    activate() { this.status(); }
    get hint() {
      const app = this.app, o = app.bimOptions || {};
      const st = this.state || {};
      const s = Object.assign({}, DEFAULTS, { planL: st.planL, planW: st.planW, dropDepth: st.dropDepth }, o.dropPanel || {});
      const lvl = app.levelManager.getLevel(app.bimOptions.baseLevel);
      return `Drop Panel: click over a column to place a ${s.planL.toFixed(2)} × ${s.planW.toFixed(2)} m panel, ` +
        `+${s.dropDepth.toFixed(2)} m drop under the ${lvl ? lvl.name : 'level'} slab soffit. ` +
        `VCB: a size sets the plan (square), d0.2 sets the drop depth. Workflow: column → punching check → drop panel where DCR > 1.`;
    }
    status() {
      if (this.app.setStatus) this.app.setStatus(this.hint);
    }
    onMove(ev) {
      const app = this.app, view = app.view;
      const inf = app.inferPoint(ev, null);
      view.clearPreview();
      app.view.showSnapDot(inf.kind === 'axis' || inf.kind === 'free' ? null : inf.p, inf.kind);
      const st = this.state || {};
      const s = Object.assign({}, DEFAULTS, { planL: st.planL, planW: st.planW, dropDepth: st.dropDepth }, (app.bimOptions || {}).dropPanel || {});
      const z = app.levelManager.getElevation(app.bimOptions.baseLevel);
      const slab = coveringSlab(app, inf.p.x, inf.p.y, z);
      const t = slab ? (slab.params.thickness || 0.2) : 0.2;
      const zTop = z - t, zBot = zTop - s.dropDepth;
      const a = G.v(inf.p.x - s.planL / 2, inf.p.y - s.planW / 2, zTop);
      const b = G.v(inf.p.x + s.planL / 2, inf.p.y - s.planW / 2, zTop);
      const c = G.v(inf.p.x + s.planL / 2, inf.p.y + s.planW / 2, zTop);
      const d = G.v(inf.p.x - s.planL / 2, inf.p.y + s.planW / 2, zTop);
      view.previewLoop([a, b, c, d], 0x7c4dff);
      view.previewQuadsBetween([a, b, c, d], [a, b, c, d].map(q => G.v(q.x, q.y, zBot)), 0x7c4dff, 0.35);
      view.stickyLabel(G.v(inf.p.x, inf.p.y, zTop),
        `Drop ${s.planL.toFixed(2)}×${s.planW.toFixed(2)} +${s.dropDepth.toFixed(2)}${slab ? ' — on ' + slab.id : ''}`,
        '#5e35b1', 0, 0);
      this._last = { p: inf.p, z, slab };
    }
    onDown(ev) {
      const app = this.app, m = app.model, G = window.G;
      if (!this._last) this.onMove(ev);
      const lastPick = this._last;
      if (!lastPick) return;
      const st = this.state || {};
      const s = Object.assign({}, DEFAULTS, { planL: st.planL, planW: st.planW, dropDepth: st.dropDepth }, (app.bimOptions || {}).dropPanel || {});
      const zLvl = app.levelManager.getElevation(app.bimOptions.baseLevel);
      const slab = coveringSlab(app, lastPick.p.x, lastPick.p.y, zLvl);
      const slabT = slab ? (slab.params.thickness || 0.2) : 0.2;
      const zTop = zLvl - slabT;                       // flush under the soffit
      const params = {
        base: [st.p.x, st.p.y, zTop],                  // top center of the drop
        planL: s.planL, planW: s.planW, dropDepth: s.dropDepth,
        slabT,
        baseLevel: app.bimOptions.baseLevel,
        hostSlabId: slab ? slab.id : null,
      };
      const before = new Set(m.faces.keys());
      let ok = false;
      app.transaction.run('drop panel', mm => {
        mm.bimHold = true;   // the drop deliberately touches the slab above
        try {
          const ring = [
            G.v(lastPick.p.x - s.planL / 2, lastPick.p.y - s.planW / 2, zTop),
            G.v(lastPick.p.x + s.planL / 2, lastPick.p.y - s.planW / 2, zTop),
            G.v(lastPick.p.x + s.planL / 2, lastPick.p.y + s.planW / 2, zTop),
            G.v(lastPick.p.x - s.planL / 2, lastPick.p.y + s.planW / 2, zTop),
          ];
          const f = m.addFaceFromRings(ring);
          if (!f) throw new Error('drop panel ring degenerate');
          if (!m.pushPull(f, -s.dropDepth)) throw new Error('drop extrusion failed');
          ok = true;
        } finally { mm.bimHold = false; }
        return ok;
      });
      if (!ok) { app.toast('Drop panel placement failed — rolled back', true); return; }
      const newFaces = [...m.faces.keys()].filter(id => !before.has(id))
        .map(id => m.faces.get(id)).filter(f2 => f2 && !f2.userData);
      const roles = {};
      for (const f2 of newFaces) {
        const c = m.faceCentroid(f2);
        roles[f2.id] = Math.abs(c.z - zTop) < 1e-6 ? 'top'
          : Math.abs(c.z - (zTop - s.dropDepth)) < 1e-6 ? 'bottom' : 'side';
      }
      const ent = app.bim.create('droppanel', params, roles, []);
      app.view.clearPreview();
      app.toast(`Drop panel placed — ${(s.planL).toFixed(2)}×${(s.planW).toFixed(2)} +${(s.dropDepth).toFixed(2)} m` +
        (slab ? ` under ${slab.id} (total ${(slabT + s.dropDepth).toFixed(2)} m)` : ' (no covering slab — draw one, or it sits at the level)'));
      this.status();
    }
    onKey(ev) { return false; }
    onVCB(t) {
      const dm = /^d\s*([\d.]+)$/i.exec(t);
      if (dm) {
        const d = Math.max(0.03, Math.min(1.0, parseFloat(dm[1])));
        this.state = Object.assign({}, DEFAULTS, this.state || {}, { dropDepth: d });
        this.app.toast(`Drop depth ${d.toFixed(2)} m`); this.status(); return true;
      }
      const n = parseFloat(t);
      if (isFinite(n) && n > 0.15) {
        const v = Math.min(6, n);
        this.state = Object.assign({}, DEFAULTS, this.state || {}, { planL: v, planW: v });
        this.app.toast(`Drop panel ${v.toFixed(2)} × ${v.toFixed(2)} m`); this.status(); return true;
      }
      return false;
    }
  }

  if (window.Engine) {
    Engine.features.register({
      id: 'droppanel',
      kind: 'tool',
      label: 'Drop Panel',
      tool: DropPanelTool,
      mode: 'bim',
      commands: ['dp', 'droppanel'],
      options: [
        { key: 'planL', type: 'number', label: 'Plan L', step: 0.1, default: 1.8 },
        { key: 'planW', type: 'number', label: 'Plan W', step: 0.1, default: 1.8 },
        { key: 'dropDepth', type: 'number', label: 'Drop', step: 0.05, default: 0.15 },
      ],
      state: { planL: 1.8, planW: 1.8, dropDepth: 0.15 },
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="7" width="14" height="4" rx="1"/><path d="M8 11v5M12 11v5M16 11v5"/><path d="M5 7h14" stroke-dasharray="2 2"/></svg>',
    });
  }
})();
