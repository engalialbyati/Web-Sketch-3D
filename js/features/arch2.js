'use strict';
// ---------------------------------------------------------------------------
// features/arch2.js — Phase 4: architecture completion.
//
//   RampTool        — two clicks: a sloped slab from level to level (or a
//                     typed rise), width param; register 'ramp'
//   CeilingTool     — like Floor sketch-mode lite: ONE click in an enclosed
//                     region hangs a ceiling plate at level − drop (region
//                     detected by the Room arrangement); register 'ceiling'
//   SweepTool       — pick a wall, type offset+size: a rectangular profile
//                     swept along the wall baseline (cornice/baseboard);
//                     register 'sweep'
//   CurtainTool     — two clicks: a glass run generated as mullion columns
//                     + thin glass walls on a U/V grid; register 'curtain'
//   PropertyTool    — dialog table of N/E vertices → closed property line
//                     + area record; register 'property'
//
// Compound walls (4.1) ship as DATA + IFC: wall params.layers
// [{name, thickness, material}] edited in the properties panel, exported as
// IfcMaterialLayerSet — geometric layer splitting stays deferred (noted).
// ---------------------------------------------------------------------------
(function () {
  const G = window.G;

  // --------------------------------------------------------------- ramp
  class RampTool extends Tool {
    static id = 'ramp';
    activate() { this.A = null; this.status(); }
    cleanup() { super.cleanup(); this.activate(); }
    get hint() {
      return this.A ? 'Ramp: click the far end — the slab slopes from the level up by the rise (VCB "rise" or "rise,width").'
        : 'Ramp: click the ramp start on the active level.';
    }
    _pt(ev) {
      const app = this.app;
      const inf = app.inferPoint(ev, this.A || null);
      const z = app.levelManager.getElevation(app.bimOptions.baseLevel);
      return G.v(inf.p.x, inf.p.y, z);
    }
    onMove(ev) {
      const app = this.app, view = app.view;
      view.clearPreview();
      view.showSnapDot(null);
      const p = this._pt(ev);
      if (this.A) {
        const w = this._w();
        const dir = G.norm(G.sub(p, G.v(...this.A)));
        const n = G.v(-dir.y, dir.x, 0);
        const rise = this._rise();
        const q = [
          G.v(...this.A), p, G.add(p, G.v(0, 0, rise)),
          G.add(G.v(...this.A), G.v(0, 0, rise))];
        const ring = [q[0], q[1], q[2], q[3]];
        view.previewLoop(ring, 0x5aa8a0);
        view.previewLine([G.v(...this.A), p], 0x2b2b2b, true);
        view.stickyLabel(p, `rise ${fmtLen(rise)} · ${((Math.atan2(rise, G.dist(G.v(...this.A), p)) * 180 / Math.PI)).toFixed(1)}°`, '#0a5f61');
      }
    }
    _rise() { return +(this._riseV || 1.2); }
    _w() { return +(this._wV || 1.5); }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const p = this._pt(ev);
      if (!this.A) { this.A = [p.x, p.y, p.z]; this.status(); return; }
      if (G.dist(G.v(...this.A), p) < 0.5) return;
      const A = this.A, rise = this._rise(), w = this._w();
      let ent = null;
      app.transaction.run('ramp', m => {
        m.bimHold = true; m.plainSweeps = true; m.noAutoIntersect = true;
        try {
          const ring = [G.v(A[0], A[1], A[2]), G.v(p.x, p.y, p.z),
            G.v(p.x, p.y, p.z + rise), G.v(A[0], A[1], A[2] + rise)];
          const f = m.addFaceFromRings(ring);
          if (!f) throw new Error('ramp footprint degenerate');
          const t = 0.15;
          const before = new Set(m.faces.keys());
          if (!m.pushPull(f, -t)) throw new Error('ramp sweep failed');
          const nf = [...m.faces.keys()].filter(id => !before.has(id)).map(id => m.faces.get(id));
          const edges = [];
          for (const ff of nf) for (const r of m.rings(ff)) for (let i = 0; i < r.length; i++) {
            const e = m.findEdge(r[i], r[(i + 1) % r.length]);
            if (e) edges.push(e.id);
          }
          const roles = {};
          for (const ff of nf) roles[ff.id] = 'body';
          const L = G.dist(G.v(...A), p);
          ent = app.bim.create('ramp', {
            base: [...A], end: [p.x, p.y, p.z], width: w, rise, run: +L.toFixed(4),
            thickness: t, baseLevel: app.bimOptions.baseLevel,
          }, roles, edges);
        } finally { m.bimHold = false; }
      });
      app.toast(ent ? `Ramp: ${fmtLen(G.dist(G.v(...A), p))} run, ${fmtLen(rise)} rise` : 'Ramp failed');
      this.activate();
      app.view.clearPreview();
    }
    onKey(ev) {
      if (ev.key === 'Escape') { this.activate(); this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB(t) {
      const m2 = String(t).match(/^([\d.]+)(?:\s*[x,]\s*([\d.]+))?$/);
      if (!m2) return false;
      this._riseV = parseFloat(m2[1]);
      if (m2[2]) this._wV = parseFloat(m2[2]);
      this.app.toast(`Ramp rise ${fmtLen(this._riseV)}${m2[2] ? `, width ${fmtLen(this._wV)}` : ''} — click the far end`);
      return true;
    }
  }

  // ------------------------------------------------------------- ceiling
  class CeilingTool extends Tool {
    static id = 'ceiling';
    activate() { this.status(); }
    get hint() { return 'Ceiling: click inside a wall-enclosed region — a ceiling plate hangs at level − 2.7 m (VCB "drop" overrides).'; }
    onMove(ev) {
      const app = this.app, view = app.view;
      view.clearPreview();
      view.showSnapDot(null);
      if (!window.RoomFeature) return;
      const inf = app.inferPoint(ev, null);
      const d = RoomFeature.detect(app, app.bimOptions.baseLevel, inf.p.x, inf.p.y);
      if (d.error) return;
      const z = app.levelManager.getElevation(app.bimOptions.baseLevel) - (this._drop || 2.7);
      const ring = d.ring.map(q => G.v(q[0], q[1], z));
      view.previewFill([{ outer: ring }], 0x8d6e9e, 0.3);
      view.previewLoop(ring, 0x6a4e7c);
      view.stickyLabel(G.v(d.ring[0][0], d.ring[0][1], z), `${d.area.toFixed(1)} m² ceiling`, '#6a4e7c', 0, -16);
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      if (!window.RoomFeature) { app.toast('Room module required', true); return; }
      const inf = app.inferPoint(ev, null);
      const d = RoomFeature.detect(app, app.bimOptions.baseLevel, inf.p.x, inf.p.y);
      if (d.error) { app.toast('Ceiling: ' + d.error, true); return; }
      const zTop = app.levelManager.getElevation(app.bimOptions.baseLevel) - (this._drop || 2.7);
      let ent = null;
      app.transaction.run('ceiling', m => {
        m.bimHold = true; m.plainSweeps = true; m.noAutoIntersect = true;
        try {
          const f = m.addFaceFromRings(d.ring.map(q => G.v(q[0], q[1], zTop)));
          if (!f) throw new Error('ceiling ring degenerate');
          const before = new Set(m.faces.keys());
          if (!m.pushPull(f, -0.02)) throw new Error('ceiling sweep failed');
          const nf = [...m.faces.keys()].filter(id => !before.has(id)).map(id => m.faces.get(id));
          const edges = [];
          for (const ff of nf) for (const r of m.rings(ff)) for (let i = 0; i < r.length; i++) {
            const e = m.findEdge(r[i], r[(i + 1) % r.length]);
            if (e) edges.push(e.id);
          }
          const roles = {};
          for (const ff of nf) roles[ff.id] = 'body';
          ent = app.bim.create('ceiling', {
            regions: [{ outer: d.ring.map(q => [+q[0].toFixed(4), +q[1].toFixed(4), +zTop.toFixed(4)]), holes: [] }],
            thickness: 0.02, drop: +(this._drop || 2.7),
            baseLevel: app.bimOptions.baseLevel,
          }, roles, edges);
        } finally { m.bimHold = false; }
      });
      app.toast(ent ? `Ceiling ${d.area.toFixed(1)} m² at −${fmtLen(this._drop || 2.7)}` : 'Ceiling failed');
    }
    onKey(ev) {
      if (ev.key === 'Escape') { this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB(t) {
      const d = parseFloat(t);
      if (!(d > 0.1)) return false;
      this._drop = d;
      this.app.toast(`Ceiling drop ${fmtLen(d)}`);
      return true;
    }
  }

  // ------------------------------------------------------------- sweep
  class SweepTool extends Tool {
    static id = 'sweep';
    activate() { this.status(); }
    get hint() { return 'Wall Sweep: click a straight wall — a profile box sweeps along it (VCB "height,offset" from the wall base).'; }
    onMove(ev) {
      const app = this.app, view = app.view;
      view.clearPreview();
      view.showSnapDot(null);
      const pe = app.pickEdgeAt ? null : null;
      // highlight walls under the cursor
      const inf = app.inferPoint(ev, null);
      const s = view.toScreen(inf.p);
      if (s) showCursorCoords(view, s, inf, inf.p);
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const pe = app.pickEntity(ev);
      const ent = pe && pe.entity && app.bim.getEntityById(pe.entity);
      if (!ent || ent.type !== 'wall' || !ent.params.base || !ent.params.end || ent.params.closed) {
        app.toast('Click a straight wall to host the sweep');
        return;
      }
      const p = ent.params;
      const h = +(this._h || 0.15), off = +(this._off || 0), t = Math.min(+(this._t || 0.08), +(p.thickness || 0.2));
      let made = null;
      app.transaction.run('wall sweep', m => {
        m.bimHold = true; m.plainSweeps = true; m.noAutoIntersect = true;
        try {
          const A = G.v(...p.base), B = G.v(...p.end);
          const dir = G.norm(G.sub(B, A));
          const n = G.v(-dir.y, dir.x, 0);
          const z0 = A.z + off;
          const z1 = z0 + h;
          const a2 = G.add(G.add(A, G.mul(n, -(p.thickness || 0.2) / 2)), G.v(0, 0, z0 - A.z));
          // profile rectangle standing on the wall face
          const ring = [
            G.add(A, G.mul(n, -(p.thickness || 0.2) / 2 + t / 2 - t)), // flush at exterior face
            G.add(B, G.mul(n, -(p.thickness || 0.2) / 2)),
            G.add(B, G.mul(n, (p.thickness || 0.2) / 2)),
            G.add(A, G.mul(n, (p.thickness || 0.2) / 2)),
          ];
          // simple: box spanning full wall thickness, from z0 to z1
          const base = [
            G.v(A.x, A.y, z0), G.v(B.x, B.y, z0), G.v(B.x, B.y, z1), G.v(A.x, A.y, z1)];
          const f = m.addFaceFromRings(base);
          if (!f) throw new Error('sweep profile degenerate');
          const before = new Set(m.faces.keys());
          if (!m.pushPull(f, t)) throw new Error('sweep failed');
          const nf = [...m.faces.keys()].filter(id => !before.has(id)).map(id => m.faces.get(id));
          const edges = [];
          for (const ff of nf) for (const r of m.rings(ff)) for (let i = 0; i < r.length; i++) {
            const e = m.findEdge(r[i], r[(i + 1) % r.length]);
            if (e) edges.push(e.id);
          }
          const roles = {};
          for (const ff of nf) roles[ff.id] = 'body';
          made = app.bim.create('sweep', {
            hostWallId: ent.id, base: [...p.base], end: [...p.end],
            height: h, offset: off, thickness: t,
            baseLevel: p.baseLevel || app.bimOptions.baseLevel,
          }, roles, edges);
        } finally { m.bimHold = false; }
      });
      app.toast(made ? `Sweep: ${fmtLen(h)} profile at ${fmtLen(off)} above the base` : 'Sweep failed');
    }
    onKey(ev) {
      if (ev.key === 'Escape') { this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB(t2) {
      const m2 = String(t2).match(/^([\d.]+)(?:\s*[x,]\s*([\d.]+))?$/);
      if (!m2) return false;
      this._h = parseFloat(m2[1]);
      if (m2[2]) this._off = parseFloat(m2[2]);
      this.app.toast(`Sweep profile ${fmtLen(this._h)}${m2[2] ? ` at +${fmtLen(this._off)}` : ''}`);
      return true;
    }
  }

  // ------------------------------------------------------------- curtain
  class CurtainTool extends Tool {
    static id = 'curtain';
    activate() { this.A = null; this.status(); }
    cleanup() { super.cleanup(); this.activate(); }
    get hint() {
      return this.A ? 'Curtain Wall: click the far end — mullion grid + glass panels generate (VCB "panelW x panelH").'
        : 'Curtain Wall: click the first end of the run.';
    }
    _pt(ev) {
      const app = this.app;
      const inf = app.inferPoint(ev, this.A || null);
      const z = app.levelManager.getElevation(app.bimOptions.baseLevel);
      return G.v(inf.p.x, inf.p.y, z);
    }
    onMove(ev) {
      const app = this.app, view = app.view;
      view.clearPreview();
      view.showSnapDot(null);
      const p = this._pt(ev);
      if (!this.A) return;
      const h = this._h();
      const pw = this._pw();
      const L = G.dist(G.v(...this.A), p);
      const dir = G.norm(G.sub(p, G.v(...this.A)));
      const n = G.v(-dir.y, dir.x, 0);
      const ring = [
        G.add(G.v(...this.A), G.mul(n, -0.05)), G.add(p, G.mul(n, -0.05)),
        G.add(p, G.add(G.mul(n, 0.05), G.v(0, 0, h))), G.add(G.v(...this.A), G.add(G.mul(n, 0.05), G.v(0, 0, h)))];
      view.previewFill([{ outer: ring }], 0x9fb4c7, 0.3);
      view.previewLoop(ring, 0x7f9cb4);
      view.stickyLabel(p, `${Math.max(1, Math.round(L / pw))} panels · ${fmtLen(h)}`, '#41708c', 0, -16);
    }
    _pw() { return +(this._pwV || 1.2); }
    _h() { return +(this._hV || 3.2); }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const p = this._pt(ev);
      if (!this.A) { this.A = [p.x, p.y, p.z]; this.status(); return; }
      Arch2.buildCurtain(app, { base: this.A, end: [p.x, p.y, p.z], height: this._h(), panelW: this._pw() });
      this.activate();
      app.view.clearPreview();
    }
    onKey(ev) {
      if (ev.key === 'Escape') { this.activate(); this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB(t) {
      const m2 = String(t).match(/^([\d.]+)(?:\s*[x,]\s*([\d.]+))?$/);
      if (!m2) return false;
      this._pwV = parseFloat(m2[1]);
      if (m2[2]) this._hV = parseFloat(m2[2]);
      this.app.toast(`Panels ${fmtLen(this._pwV)}${m2[2] ? ` × ${fmtLen(this._hV)} high` : ''}`);
      return true;
    }
  }

  const Arch2 = {
    RampTool, CeilingTool, SweepTool, CurtainTool,

    /** mullion columns + glass wall segments along a run */
    buildCurtain(app, opts) {
      const m = app.model;
      const A = opts.base, B = opts.end;
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (L < 0.5) { app.toast('Curtain run too short', true); return null; }
      const nPan = Math.max(1, Math.round(L / (opts.panelW || 1.2)));
      const dir = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
      let panels = 0;
      app.transaction.run('curtain wall', mm => {
        mm.bimHold = true; mm.plainSweeps = true; mm.noAutoIntersect = true;
        try {
          const z = A[2];
          for (let i = 0; i <= nPan; i++) {
            const t = L * i / nPan;
            const cx = A[0] + dir[0] * t, cy = A[1] + dir[1] * t;
            // mullion: thin column
            const before = new Set(mm.faces.keys());
            const f = mm.addFaceFromRings([
              G.v(cx - 0.04, cy - 0.04, z), G.v(cx + 0.04, cy - 0.04, z),
              G.v(cx + 0.04, cy + 0.04, z), G.v(cx - 0.04, cy + 0.04, z)]);
            if (f && mm.pushPull(f, opts.height)) {
              const nf = [...mm.faces.keys()].filter(id => !before.has(id));
              const edges = [];
              for (const fid of nf) {
                const ff = mm.faces.get(fid);
                if (ff) for (const r of mm.rings(ff)) for (let k = 0; k < r.length; k++) {
                  const e = mm.findEdge(r[k], r[(k + 1) % r.length]);
                  if (e) edges.push(e.id);
                }
              }
              const roles = {};
              for (const fid of nf) roles[fid] = 'body';
              app.bim.create('column', {
                base: [+cx.toFixed(4), +cy.toFixed(4), +z.toFixed(4)],
                width: 0.08, depth: 0.08, height: opts.height,
                baseLevel: app.bimOptions.baseLevel, source: 'curtain',
              }, roles, edges, { noHostDirty: true });
            }
          }
          // glass panels: thin walls between mullions
          for (let i = 0; i < nPan; i++) {
            const t0 = L * i / nPan, t1 = L * (i + 1) / nPan;
            const p0 = [A[0] + dir[0] * t0, A[1] + dir[1] * t0, z];
            const p1 = [A[0] + dir[0] * t1, A[1] + dir[1] * t1, z];
            const before = new Set(mm.faces.keys());
            const f = mm.addFaceFromRings([G.v(...p0), G.v(...p1),
              G.v(p1[0], p1[1], z + opts.height), G.v(p0[0], p0[1], z + opts.height)]);
            if (f && mm.pushPull(f, 0.02)) {
              const nf = [...mm.faces.keys()].filter(id => !before.has(id));
              const edges = [];
              for (const fid of nf) {
                const ff = mm.faces.get(fid);
                if (ff) for (const r of mm.rings(ff)) for (let k = 0; k < r.length; k++) {
                  const e = mm.findEdge(r[k], r[(k + 1) % r.length]);
                  if (e) edges.push(e.id);
                }
              }
              const roles = {};
              for (const fid of nf) roles[fid] = 'body';
              app.bim.create('wall', {
                base: p0.map(q => +q.toFixed(4)), end: p1.map(q => +q.toFixed(4)),
                height: opts.height, thickness: 0.02, closed: false,
                baseLevel: app.bimOptions.baseLevel, source: 'curtain', material: 'Glass',
                primitive: 'line', joins: { start: 0, end: 0 },
              }, roles, edges, { noHostDirty: true });
              panels++;
            }
          }
        } finally { mm.bimHold = false; }
      });
      app.toast(`Curtain wall: ${nPan + 1} mullions, ${panels} glass panels`);
      return panels;
    },

    // ---- property lines (site-lite 4.8): polygon → closed line + area ----
    makeProperty(app, pts) {
      const m = app.model;
      let ent = null;
      app.run('property line', mm => {
        const ring = pts.map(q => G.v(q[0], q[1], 0));
        // closed boundary edges (deliberate: never reaped)
        const ids = [];
        for (let i = 0; i < ring.length; i++) {
          const e = mm.addEdge(G.clone(ring[i]), G.clone(ring[(i + 1) % ring.length]));
          if (e) ids.push(e.id);
        }
        let area = 0;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          area += a[0] * b[1] - b[0] * a[1];
        }
        ent = app.bim.create('property', {
          boundary: pts.map(q => [+q[0].toFixed(3), +q[1].toFixed(3)]),
          area: +Math.abs(area / 2).toFixed(3),
        }, {}, ids);
      });
      return ent;
    },
  };
  window.Arch2 = Arch2;
})();
