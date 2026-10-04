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

  // ------------------------------------------------------------- ceiling (Revit-Style)
  class CeilingTool extends Tool {
    static id = 'ceiling';

    constructor(app) {
      super(app);
      this._mode = 'auto'; // 'auto' | 'sketch'
      this._type = 'grid_600'; // 'grid_600' | 'grid_1200' | 'gwb' | 'wood_slat'
      this._heightOffset = 2.70;
      this._sketchPts = [];
    }

    get mode() { return this._mode; }
    set mode(v) { this._mode = v; }
    get ceilingType() { return this._type; }
    set ceilingType(v) { this._type = v; }
    get heightOffset() { return this._heightOffset; }
    set heightOffset(v) { this._heightOffset = v; }
    get sketchPts() { return this._sketchPts; }
    set sketchPts(v) { this._sketchPts = v; }

    activate() {
      this._mode = this._mode || 'auto';
      this._type = this._type || 'grid_600';
      this._heightOffset = +(this._drop || this._heightOffset || 2.70);
      this._sketchPts = [];
      this.status();
    }

    get hint() {
      const typeNames = {
        grid_600: 'Compound 600×600 ACT Grid',
        grid_1200: 'Compound 600×1200 ACT Grid',
        gwb: 'Basic GWB on Metal Stud (13mm)',
        wood_slat: 'Architectural Wood Slat Baffles'
      };
      const tName = typeNames[this._type] || this._type;
      if (this._mode === 'sketch') {
        const n = this._sketchPts.length;
        return `Ceiling [Sketch Boundary]: click boundary point ${n + 1} (${n} pts) — [Enter/Double-click] Finish sketch · [Tab] Switch to Automatic · [T] Cycle Type · [Esc] Cancel.`;
      }
      return `Ceiling [Automatic Room]: click inside wall-enclosed space — ${tName} at +${fmtLen(this._heightOffset)} · [Tab] Switch to Sketch Mode · [T] Cycle Type · VCB "height".`;
    }

    _pt(ev) {
      const app = this.app;
      const getX = q => Array.isArray(q) ? q[0] : (q.x != null ? q.x : 0);
      const getY = q => Array.isArray(q) ? q[1] : (q.y != null ? q.y : 0);
      const lastP = this._sketchPts.length ? G.v(getX(this._sketchPts[this._sketchPts.length - 1]), getY(this._sketchPts[this._sketchPts.length - 1]), 0) : null;
      const inf = app.inferPoint(ev, lastP);
      const baseElev = app.levelManager ? app.levelManager.getElevation(app.bimOptions.baseLevel) : 0;
      const z = baseElev + this._heightOffset;
      return G.v(inf.p.x, inf.p.y, z);
    }

    onMove(ev) {
      const app = this.app, view = app.view;
      view.clearPreview();
      view.showSnapDot(null);

      if (this._mode === 'sketch') {
        const p = this._pt(ev);
        if (this._sketchPts.length > 0) {
          const getX = q => Array.isArray(q) ? q[0] : (q.x != null ? q.x : 0);
          const getY = q => Array.isArray(q) ? q[1] : (q.y != null ? q.y : 0);
          const getZ = q => Array.isArray(q) ? (q[2] != null ? q[2] : p.z) : (q.z != null ? q.z : p.z);
          const ring = this._sketchPts.map(q => G.v(getX(q), getY(q), getZ(q)));
          view.previewLoop([...ring, p], 0xe11d48); // Revit signature magenta sketch line
          view.previewLine([ring[ring.length - 1], p], 0xe11d48, true);
          view.stickyLabel(p, `Sketch pt ${this._sketchPts.length + 1} · +${fmtLen(this._heightOffset)}`, '#be123c', 0, -16);
        }
        return;
      }

      // Automatic Ceiling Mode (Revit 1-click room detect)
      if (!window.RoomFeature) return;
      const inf = app.inferPoint(ev, null);
      const d = RoomFeature.detect(app, app.bimOptions.baseLevel, inf.p.x, inf.p.y);
      if (d.error) return;
      const baseElev = app.levelManager ? app.levelManager.getElevation(app.bimOptions.baseLevel) : 0;
      const z = baseElev + this._heightOffset;
      const ring = d.ring.map(q => G.v(q[0], q[1], z));
      view.previewFill([{ outer: ring }], 0x8b5cf6, 0.28);
      view.previewLoop(ring, 0x7c3aed);
      const typeLabel = this._type === 'grid_600' ? '600×600 ACT' : this._type === 'grid_1200' ? '600×1200 ACT' : 'GWB';
      view.stickyLabel(G.v(d.ring[0][0], d.ring[0][1], z), `${d.area.toFixed(1)} m² ceiling (${typeLabel}) · +${fmtLen(this._heightOffset)}`, '#6d28d9', 0, -16);
    }

    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;

      if (this._mode === 'sketch') {
        const p = this._pt(ev);
        // Check if clicked near start point to close sketch
        if (this._sketchPts.length >= 3) {
          const getX = q => Array.isArray(q) ? q[0] : (q.x != null ? q.x : 0);
          const getY = q => Array.isArray(q) ? q[1] : (q.y != null ? q.y : 0);
          const p0 = this._sketchPts[0];
          if (Math.hypot(p.x - getX(p0), p.y - getY(p0)) < 0.25) {
            this._commitSketch();
            return;
          }
        }
        this._sketchPts.push([+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)]);
        app.toast(`Ceiling sketch: point ${this._sketchPts.length} added`);
        this.status();
        return;
      }

      // Automatic Mode
      if (!window.RoomFeature) { app.toast('Room module required', true); return; }
      const inf = app.inferPoint(ev, null);
      const d = RoomFeature.detect(app, app.bimOptions.baseLevel, inf.p.x, inf.p.y);
      if (d.error) { app.toast('Ceiling: ' + d.error, true); return; }

      const baseElev = app.levelManager ? app.levelManager.getElevation(app.bimOptions.baseLevel) : 0;
      const zTop = baseElev + this._heightOffset;
      this._createCeilingEntity(d.ring, zTop, d.area);
    }

    _commitSketch() {
      if (this._sketchPts.length < 3) {
        this.app.toast('Ceiling sketch requires at least 3 points', true);
        return;
      }
      const getX = q => Array.isArray(q) ? q[0] : (q.x != null ? q.x : 0);
      const getY = q => Array.isArray(q) ? q[1] : (q.y != null ? q.y : 0);
      const getZ = q => Array.isArray(q) ? (q[2] != null ? q[2] : null) : (q.z != null ? q.z : null);

      const ring = this._sketchPts.map(q => [getX(q), getY(q)]);
      let area = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        area += a[0] * b[1] - b[0] * a[1];
      }
      area = Math.abs(area / 2);
      const baseElev = this.app.levelManager ? this.app.levelManager.getElevation(this.app.bimOptions.baseLevel) : 0;
      const rawZ = getZ(this._sketchPts[0]);
      const zTop = (rawZ != null && rawZ !== 0) ? rawZ : (baseElev + this._heightOffset);
      this._createCeilingEntity(ring, zTop, area);
      this._sketchPts = [];
    }

    _createCeilingEntity(ring2D, zTop, area) {
      const app = this.app;
      let ent = null;
      const thickness = 0.02;

      app.transaction.run('ceiling', m => {
        m.bimHold = true; m.plainSweeps = true; m.noAutoIntersect = true;
        try {
          const f = m.addFaceFromRings(ring2D.map(q => G.v(q[0], q[1], zTop)));
          if (!f) throw new Error('ceiling ring degenerate');
          const before = new Set(m.faces.keys());
          if (!m.pushPull(f, -thickness)) throw new Error('ceiling sweep failed');
          const nf = [...m.faces.keys()].filter(id => !before.has(id)).map(id => m.faces.get(id));
          const edges = [];
          for (const ff of nf) for (const r of m.rings(ff)) for (let i = 0; i < r.length; i++) {
            const e = m.findEdge(r[i], r[(i + 1) % r.length]);
            if (e) edges.push(e.id);
          }
          const roles = {};
          for (const ff of nf) roles[ff.id] = 'body';

          ent = app.bim.create('ceiling', {
            regions: [{ outer: ring2D.map(q => [+q[0].toFixed(4), +q[1].toFixed(4), +zTop.toFixed(4)]), holes: [] }],
            thickness,
            heightOffset: this._heightOffset,
            elevation: +zTop.toFixed(4),
            drop: this._heightOffset, // compatibility alias
            ceilingType: this._type,
            area: +area.toFixed(2),
            baseLevel: app.bimOptions.baseLevel,
          }, roles, edges);
        } finally { m.bimHold = false; }
      });

      const typeLabel = this._type === 'grid_600' ? '600×600 ACT' : this._type === 'grid_1200' ? '600×1200 ACT' : 'GWB';
      app.toast(ent ? `Ceiling (${typeLabel}) ${area.toFixed(1)} m² placed at +${fmtLen(this._heightOffset)}` : 'Ceiling creation failed');
      app.view.clearPreview();
      this.status();
    }

    onKey(ev) {
      if (ev.key === 'Escape' || ev.code === 'Escape') {
        if (this._sketchPts.length > 0) {
          this._sketchPts = [];
          this.app.toast('Ceiling sketch cleared');
        } else {
          this.activate();
        }
        this.app.view.clearPreview();
        this.status();
        return true;
      }
      if (ev.key === 'Tab' || ev.code === 'Tab' || ev.code === 'KeyM' || ev.key === 'm' || ev.key === 'M') {
        this._mode = this._mode === 'auto' ? 'sketch' : 'auto';
        this._sketchPts = [];
        this.app.view.clearPreview();
        this.app.toast(`Ceiling mode: ${this._mode === 'sketch' ? 'Sketch Boundary' : 'Automatic Room'}`);
        this.status();
        return true;
      }
      if (ev.code === 'KeyT' || ev.key === 't' || ev.key === 'T') {
        const types = ['grid_600', 'grid_1200', 'gwb', 'wood_slat'];
        const idx = types.indexOf(this._type);
        this._type = types[(idx + 1) % types.length];
        const names = { grid_600: '600×600 ACT Grid', grid_1200: '600×1200 ACT Grid', gwb: 'GWB Drywall', wood_slat: 'Wood Slat' };
        this.app.toast(`Ceiling Type: ${names[this._type]}`);
        this.status();
        return true;
      }
      if ((ev.key === 'Enter' || ev.code === 'Enter') && this._mode === 'sketch') {
        this._commitSketch();
        return true;
      }
      return false;
    }

    onVCB(t) {
      const d = parseFloat(t);
      if (!(d > 0.1)) return false;
      this._heightOffset = d;
      this._drop = d;
      this.app.toast(`Ceiling height offset +${fmtLen(d)}`);
      this.status();
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
          const ring = [
            G.add(A, G.mul(n, -(p.thickness || 0.2) / 2 + t / 2 - t)),
            G.add(B, G.mul(n, -(p.thickness || 0.2) / 2)),
            G.add(B, G.mul(n, (p.thickness || 0.2) / 2)),
            G.add(A, G.mul(n, (p.thickness || 0.2) / 2)),
          ];
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

  // ------------------------------------------------------------- curtain wall (Revit-Style)
  class CurtainTool extends Tool {
    static id = 'curtain';

    activate() {
      this.A = null;
      this._preset = 'storefront'; // 'storefront' | 'exterior_glazing' | 'seamless'
      this._panelW = +(this._pwV || 1.20);
      this._transomH = +(this._thV || 2.10);
      this._h = +(this._hV || 3.20);
      this._mullionW = 0.05; // 50 mm
      this._mullionD = 0.12; // 120 mm
      this.status();
    }

    cleanup() { super.cleanup(); this.activate(); }

    get hint() {
      const typeLabel = this._preset === 'storefront' ? 'Storefront (50×120 Mullions)' : this._preset === 'exterior_glazing' ? 'Exterior Glazing' : 'Seamless Glass';
      if (this.A) {
        return `Curtain Wall [${typeLabel}]: click end point — aluminum mullions + glass bays generate · [T] Cycle Type · VCB "panelW x transomH" or "height".`;
      }
      return `Curtain Wall [${typeLabel}]: click first end of baseline · [T] Preset (Storefront / Butt-Glazed / Seamless) · VCB "panelW x transomH".`;
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

      const h = this._h;
      const pw = this._panelW;
      const L = G.dist(G.v(...this.A), p);
      if (L < 0.1) return;

      const dir = G.norm(G.sub(p, G.v(...this.A)));
      const n = G.v(-dir.y, dir.x, 0);

      // Glass Plane Preview
      const ring = [
        G.add(G.v(...this.A), G.mul(n, -0.025)),
        G.add(p, G.mul(n, -0.025)),
        G.add(p, G.add(G.mul(n, 0.025), G.v(0, 0, h))),
        G.add(G.v(...this.A), G.add(G.mul(n, 0.025), G.v(0, 0, h)))
      ];
      view.previewFill([{ outer: ring }], 0x0284c7, 0.28); // architectural cyan/blue glass
      view.previewLoop(ring, 0x0369a1);

      // Mullion Grid Lines Preview
      const nBays = Math.max(1, Math.round(L / pw));
      for (let i = 1; i < nBays; i++) {
        const t = L * i / nBays;
        const ptBot = G.add(G.v(...this.A), G.mul(dir, t));
        const ptTop = G.add(ptBot, G.v(0, 0, h));
        view.previewLine([ptBot, ptTop], 0x334155, false);
      }

      // Horizontal Transom Line (Door line at 2.1m)
      if (h > 2.2) {
        const tBot = G.add(G.v(...this.A), G.v(0, 0, Math.min(this._transomH, h - 0.4)));
        const tTop = G.add(p, G.v(0, 0, Math.min(this._transomH, h - 0.4)));
        view.previewLine([tBot, tTop], 0x475569, true);
      }

      const presetName = this._preset === 'storefront' ? 'Storefront' : this._preset === 'exterior_glazing' ? 'Exterior Glazing' : 'Seamless';
      view.stickyLabel(p, `${presetName}: ${nBays} bays · ${fmtLen(h)} high (Transom @ ${fmtLen(this._transomH)})`, '#0369a1', 0, -18);
    }

    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const p = this._pt(ev);
      if (!this.A) { this.A = [p.x, p.y, p.z]; this.status(); return; }

      Arch2.buildCurtain(app, {
        base: this.A,
        end: [p.x, p.y, p.z],
        height: this._h,
        panelW: this._panelW,
        transomH: this._transomH,
        preset: this._preset,
        mullionW: this._mullionW,
        mullionD: this._mullionD,
        embed: true
      });

      this.activate();
      app.view.clearPreview();
    }

    onKey(ev) {
      if (ev.key === 'Escape') { this.activate(); this.app.view.clearPreview(); return true; }
      if (ev.code === 'KeyT') {
        const presets = ['storefront', 'exterior_glazing', 'seamless'];
        const idx = presets.indexOf(this._preset);
        this._preset = presets[(idx + 1) % presets.length];
        const names = { storefront: 'Storefront (Full Mullion Frame)', exterior_glazing: 'Exterior Glazing (Butt-Glazed)', seamless: 'Seamless Glass' };
        this.app.toast(`Curtain Type: ${names[this._preset]}`);
        this.status();
        return true;
      }
      return false;
    }

    onVCB(t) {
      const m2 = String(t).match(/^([\d.]+)(?:\s*[x,]\s*([\d.]+))?$/);
      if (!m2) return false;
      this._panelW = parseFloat(m2[1]);
      this._pwV = this._panelW;
      if (m2[2]) {
        const v2 = parseFloat(m2[2]);
        if (v2 >= 2.0 && v2 <= 4.0) this._transomH = v2;
        else this._h = v2;
      }
      this.app.toast(`Curtain: bay width ${fmtLen(this._panelW)}${m2[2] ? `, transom/height ${fmtLen(parseFloat(m2[2]))}` : ''}`);
      this.status();
      return true;
    }
  }

  const Arch2 = {
    RampTool, CeilingTool, SweepTool, CurtainTool,

    /** Revit-Style Storefront & Curtain Wall Generator */
    buildCurtain(app, opts) {
      const m = app.model;
      const rawA = opts.base || opts.a;
      const rawB = opts.end || opts.b;
      if (!rawA || !rawB) { app.toast('Curtain wall endpoints required', true); return null; }
      const baseElev = app.levelManager ? app.levelManager.getElevation(app.bimOptions ? app.bimOptions.baseLevel : 'lvl_1') : 0;
      const zA = rawA[2] != null ? rawA[2] : (opts.baseZ != null ? opts.baseZ : baseElev);
      const zB = rawB[2] != null ? rawB[2] : zA;
      const A = [rawA[0], rawA[1], zA];
      const B = [rawB[0], rawB[1], zB];
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (L < 0.5) { app.toast('Curtain run too short', true); return null; }

      const height = +(opts.height || 3.20);
      const panelW = +(opts.panelW || opts.gridU || 1.20);
      const transomH = +(opts.transomH || opts.transom || 2.10);
      const preset = opts.preset || 'storefront';
      const mullW = +(opts.mullionW || 0.05);
      const mullD = +(opts.mullionD || 0.12);
      const glassT = 0.025;

      // register a Glass material so the materials dialog can edit it
      if (!m.materials) m.materials = new Map();
      const glassMatId = 'curtain_glass';
      if (!m.materials.has(glassMatId)) m.materials.set(glassMatId, { id: glassMatId, name: 'Curtain Wall Glass', color: '#a9c7da', alpha: 0.45, texture: null });
      const nPan = Math.max(1, Math.round(L / panelW));
      const dir = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
      const norm = [-dir[1], dir[0]];

      let panels = 0;
      let mullionCount = 0;

      app.transaction.run('curtain wall', mm => {
        mm.bimHold = true; mm.plainSweeps = true; mm.noAutoIntersect = true;
        try {
          const z = A[2];

          // 1. VERTICAL & BORDER MULLIONS (Storefront & Exterior Glazing)
          if (preset !== 'seamless') {
            for (let i = 0; i <= nPan; i++) {
              const t = L * i / nPan;
              const cx = A[0] + dir[0] * t, cy = A[1] + dir[1] * t;
              const before = new Set(mm.faces.keys());

              const hw = mullW / 2, hd = mullD / 2;
              const p1 = G.v(cx - dir[0] * hw - norm[0] * hd, cy - dir[1] * hw - norm[1] * hd, z);
              const p2 = G.v(cx + dir[0] * hw - norm[0] * hd, cy + dir[1] * hw - norm[1] * hd, z);
              const p3 = G.v(cx + dir[0] * hw + norm[0] * hd, cy + dir[1] * hw + norm[1] * hd, z);
              const p4 = G.v(cx - dir[0] * hw + norm[0] * hd, cy - dir[1] * hw + norm[1] * hd, z);

              const f = mm.addFaceFromRings([p1, p2, p3, p4]);
              if (f && mm.pushPull(f, height)) {
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
                  width: mullW, depth: mullD, height,
                  baseLevel: app.bimOptions.baseLevel, source: 'curtain',
                  role: i === 0 || i === nPan ? 'jamb_mullion' : 'intermediate_mullion',
                  material: 'Aluminum'
                }, roles, edges, { noHostDirty: true });
                mullionCount++;
              }
            }
          }

          // 2. HORIZONTAL TRANSOM MULLIONS
          const hasTransom = preset === 'storefront' && height > 2.2 && transomH < height - 0.3;
          if (hasTransom) {
            const zTransom = z + transomH;
            const before = new Set(mm.faces.keys());
            const hd = mullD / 2;
            const t0 = G.v(A[0] - norm[0] * hd, A[1] - norm[1] * hd, zTransom);
            const t1 = G.v(B[0] - norm[0] * hd, B[1] - norm[1] * hd, zTransom);
            const t2 = G.v(B[0] + norm[0] * hd, B[1] + norm[1] * hd, zTransom);
            const t3 = G.v(A[0] + norm[0] * hd, A[1] + norm[1] * hd, zTransom);

            const f = mm.addFaceFromRings([t0, t1, t2, t3]);
            if (f && mm.pushPull(f, mullW)) {
              mullionCount++;
            }
          }

          // 3. GLAZED INFILL PANELS
          for (let i = 0; i < nPan; i++) {
            const t0 = L * i / nPan, t1 = L * (i + 1) / nPan;
            const p0 = [A[0] + dir[0] * t0, A[1] + dir[1] * t0, z];
            const p1 = [A[0] + dir[0] * t1, A[1] + dir[1] * t1, z];
            const before = new Set(mm.faces.keys());

            const f = mm.addFaceFromRings([
              G.v(...p0), G.v(...p1),
              G.v(p1[0], p1[1], z + height),
              G.v(p0[0], p0[1], z + height)
            ]);
            if (f) {
              f.matId = glassMatId;
              f.color = '#a9c7da';
              f.alpha = 0.45;
            }
            if (f && mm.pushPull(f, glassT)) {
              const nf = [...mm.faces.keys()].filter(id => !before.has(id));
              const edges = [];
              for (const fid of nf) {
                const ff = mm.faces.get(fid);
                if (ff) {
                  ff.matId = glassMatId;
                  ff.color = '#a9c7da';
                  ff.alpha = 0.45;
                  for (const r of mm.rings(ff)) for (let k = 0; k < r.length; k++) {
                    const e = mm.findEdge(r[k], r[(k + 1) % r.length]);
                    if (e) edges.push(e.id);
                  }
                }
              }
              const roles = {};
              for (const fid of nf) roles[fid] = 'body';
              app.bim.create('wall', {
                base: p0.map(q => +q.toFixed(4)),
                end: p1.map(q => +q.toFixed(4)),
                height,
                thickness: glassT,
                closed: false,
                baseLevel: app.bimOptions.baseLevel,
                source: 'curtain',
                material: 'Glass',
                curtainPreset: preset,
                primitive: 'line',
                joins: { start: 0, end: 0 },
              }, roles, edges, { noHostDirty: true });
              panels++;
            }
          }

          // 4. AUTOMATIC WALL EMBEDDING (Revit Automatically Embed)
          if (opts.embed !== false) {
            for (const ent of app.bim.entities) {
              if (ent.type !== 'wall' || ent.params.source === 'curtain') continue;
              const pBase = ent.params.base || (ent.params.baseline && ent.params.baseline[0]);
              const pEnd = ent.params.end || (ent.params.baseline && ent.params.baseline[1]);
              if (!pBase || !pEnd) continue;
              const toPt = p => Array.isArray(p) ? G.v(p[0], p[1], p[2] || 0) : G.v(p.x, p.y, p.z || 0);
              const wA = toPt(pBase), wB = toPt(pEnd);
              const wDir = G.norm(G.sub(wB, wA));
              const curDir = G.norm(G.v(dir[0], dir[1], 0));
              // Check if nearly collinear and intersecting
              if (Math.abs(Math.abs(G.dot(wDir, curDir)) - 1) < 0.05) {
                const distToWall = Math.abs(G.dot(G.sub(G.v(...A), wA), G.v(-wDir.y, wDir.x, 0)));
                if (distToWall < (ent.params.thickness || 0.2) + 0.1) {
                  // Host wall identified — cut a real opening via HostedCut
                  const centerL = (G.dot(G.sub(G.v(...A), wA), wDir) + G.dot(G.sub(G.v(...B), wA), wDir)) / 2;
                  const cutSpec = { distanceFromStart: centerL, width: L, height, sillHeight: 0, depth: ent.params.thickness || 0.2 };
                  m.bimHold = ent.id;
                  try {
                    const cutInfo = window.BimTools.HostedCut.cut(G, m, ent.params, cutSpec);
                    if (cutInfo && !cutInfo.error) {
                      app.bim.create('opening', {
                        hostWallId: ent.id,
                        hostId: ent.id,
                        distanceFromStart: centerL,
                        width: L,
                        height,
                        sillHeight: 0,
                        source: 'curtain_embed'
                      }, {}, []);
                    }
                  } finally { m.bimHold = false; }
                  break;
                }
              }
            }
          }

          // Register Master Curtain Wall Container
          app.bim.create('curtain_wall', {
            base: [...A],
            end: [...B],
            height,
            length: +L.toFixed(3),
            panelWidth: panelW,
            gridU: panelW,
            transomHeight: transomH,
            transomH,
            preset,
            bays: nPan,
            panelCount: panels,
            baseLevel: app.bimOptions ? app.bimOptions.baseLevel : 'lvl_1'
          }, {}, []);

        } finally { mm.bimHold = false; }
      });

      const presetName = preset === 'storefront' ? 'Storefront' : preset === 'exterior_glazing' ? 'Exterior Glazing' : 'Seamless Glass';
      app.toast(`Curtain Wall (${presetName}): ${nPan} bays, ${panels} glass panels, ${mullionCount} mullions`);
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
