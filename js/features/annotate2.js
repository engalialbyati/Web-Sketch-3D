'use strict';
// ---------------------------------------------------------------------------
// features/annotate2.js — Phase 3 completion (3.6-3.9):
//
//   AngularDimTool   — vertex + two rays → the arc-swept angle dimension
//   RadialDimTool    — pick a circle/arc → R dimension from center to rim
//   CloudTool        — click a ring of points → revision cloud (scalloped)
//   RegionTool       — click a ring of points → filled/hatched region
//   SectionTool      — draw a cut line on a level → a SAVED SECTION VIEW:
//                      camera placed perpendicular to the line + a clipping
//                      plane at the cut (the model opens like a section)
//   ElevationTool    — one click looking horizontally → saved elevation view
//   printSheet()     — File ▸ Print Sheet…: current view + title block in a
//                      print-ready window (browser Print → PDF)
//
// Saved views live on model.views: [{id, kind:'section'|'elevation', name,
// eye, target, clip:{n,d}, fov?}] — serialized with the model; the Sections
// dialog lists them and activates one on click.
// ---------------------------------------------------------------------------
(function () {
  const G = window.G;

  const nextId = app => {
    let max = 0;
    for (const a of app.model.annotations || [])
      if (typeof a.id === 'string' && a.id.startsWith('ann_'))
        max = Math.max(max, parseInt(a.id.slice(4), 10) || 0);
    return 'ann_' + (max + 1);
  };
  const nextViewId = app => {
    let max = 0;
    for (const v of app.model.views || [])
      if (typeof v.id === 'string' && v.id.startsWith('view_'))
        max = Math.max(max, parseInt(v.id.slice(5), 10) || 0);
    return 'view_' + (max + 1);
  };

  // ------------------------------------------------------ angular dimension
  class AngularDimTool extends Tool {
    static id = 'dimang';
    activate() { this.V = null; this.p1 = null; this.p2 = null; this.status(); }
    cleanup() { super.cleanup(); this.activate(); }
    get hint() {
      if (!this.V) return 'Angular Dimension: click the VERTEX of the angle.';
      if (!this.p1) return 'Angular: click the first ray endpoint.';
      if (!this.p2) return 'Angular: click the second ray endpoint, then click to place the arc.';
      return 'Angular: click to place the dimension arc. Esc restarts.';
    }
    _pt(ev) {
      const inf = this.app.inferPoint(ev, this.V || null);
      this.app.view.showSnapDot(inf.kind === 'axis' || inf.kind === 'free' ? null : inf.p, inf.kind);
      return { p: G.v(inf.p.x, inf.p.y, inf.p.z), inf };
    }
    onMove(ev) {
      const app = this.app, view = app.view;
      view.clearPreview();
      view.showSnapDot(null);
      const { p } = this._pt(ev);
      if (!this.V) return;
      if (!this.p1) { view.previewLine([G.v(...this.V), p], 0x9a9a9a, true); return; }
      if (!this.p2) { view.previewLine([G.v(...this.V), p], 0x9a9a9a, true); return; }
      // place stage: preview arc
      const r = Math.min(0.6 * G.dist(G.v(...this.V), p) + 0.3, 3);
      const arc = Annotate2.arcPts(G.v(...this.V), G.v(...this.p1), G.v(...this.p2), r);
      if (arc) {
        view.previewLine(arc, 0x2b2b2b);
        const a = Annotate2.angleDeg(G.v(...this.V), G.v(...this.p1), G.v(...this.p2));
        view.stickyLabel(p, a.toFixed(1) + '\u00B0', '#333');
      }
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const { p } = this._pt(ev);
      if (!this.V) { this.V = [p.x, p.y, p.z]; this.status(); return; }
      if (!this.p1) { this.p1 = [p.x, p.y, p.z]; this.status(); return; }
      if (!this.p2) { this.p2 = [p.x, p.y, p.z]; this.status(); return; }
      const r = Math.min(0.6 * G.dist(G.v(...this.V), p) + 0.3, 3);
      const ang = Annotate2.angleDeg(G.v(...this.V), G.v(...this.p1), G.v(...this.p2));
      app.run('angular dimension', m => {
        m.annotations.push({ id: nextId(app), kind: 'dimang', V: [...this.V], p1: [...this.p1], p2: [...this.p2], r });
        m.touch();
      });
      app.toast(`Angle ${ang.toFixed(1)}°`);
      this.activate();
    }
    onKey(ev) {
      if (ev.key === 'Escape') { this.activate(); this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB(t) {
      const r = parseFloat(t);
      if (!this.p2 || !(r > 0.05)) return false;
      const app = this.app;
      const ang = Annotate2.angleDeg(G.v(...this.V), G.v(...this.p1), G.v(...this.p2));
      app.run('angular dimension', m => {
        m.annotations.push({ id: nextId(app), kind: 'dimang', V: [...this.V], p1: [...this.p1], p2: [...this.p2], r });
        m.touch();
      });
      app.toast(`Angle ${ang.toFixed(1)}°`);
      this.activate();
      return true;
    }
  }

  // ------------------------------------------------------- radial dimension
  class RadialDimTool extends Tool {
    static id = 'dimrad';
    activate() { this.status(); }
    get hint() { return 'Radial Dimension: hover a circle/arc — the R dimension follows — click to place.'; }
    _pick(ev) {
      const app = this.app;
      const pe = app.pickEdgeAt(ev, 9);
      if (!pe || !pe.edge.curveId) return null;
      const meta = app.model.curves.get(pe.edge.curveId);
      if (!meta || !meta.center || !meta.radius) return null;
      // rim point: nearest endpoint of the chain to the cursor
      const a = app.model.vp(pe.edge.a);
      const b = app.model.vp(pe.edge.b);
      const c = app.inferPoint(ev, null).p;
      const rim = G.dist(c, a) < G.dist(c, b) ? a : b;
      return { meta, rim };
    }
    onMove(ev) {
      const app = this.app, view = app.view;
      view.clearPreview();
      view.showSnapDot(null);
      const hit = this._pick(ev);
      if (!hit) return;
      view.previewLine([G.clone(hit.meta.center), G.clone(hit.rim)], 0x2b2b2b);
      view.stickyLabel(hit.rim, `R ${fmtLen(hit.meta.radius)}`, '#333');
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const hit = this._pick(ev);
      if (!hit) { app.toast('Hover a circle or arc'); return; }
      const c = hit.meta.center, r = hit.meta.radius;
      app.run('radial dimension', m => {
        m.annotations.push({
          id: nextId(app), kind: 'dimrad',
          c: [c.x, c.y, c.z], r,
          rim: [hit.rim.x, hit.rim.y, hit.rim.z],
        });
        m.touch();
      });
      app.toast(`R ${fmtLen(r)} placed`);
    }
    onKey(ev) {
      if (ev.key === 'Escape') { this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB() { return false; }
  }

  // ------------------------------------------- revision cloud / filled region
  // shared click-a-ring interaction
  class RingTool extends Tool {
    constructor(app, kind) { super(app); this.kind = kind; }
    activate() { this.pts = []; this.status(); }
    cleanup() { super.cleanup(); this.activate(); }
    get hint() {
      return this.kind === 'cloud'
        ? 'Revision Cloud: click points around the changed region — it closes automatically when you return to the start (or press Enter).'
        : 'Filled Region: click points around the area — closes at the start point (Enter finishes).';
    }
    onMove(ev) {
      const app = this.app, view = app.view;
      view.clearPreview();
      view.showSnapDot(null);
      const inf = app.inferPoint(ev, this.pts.length ? this.pts[this.pts.length - 1] : null);
      const p = G.v(inf.p.x, inf.p.y, inf.p.z);
      view.showSnapDot(inf.kind === 'axis' || inf.kind === 'free' ? null : inf.p, inf.kind);
      if (this.pts.length) view.previewLine([...this.pts, p], 0x2b2b2b, true);
      else view.previewLine([p, G.add(p, G.v(0.01, 0, 0))], 0x2b2b2b, true);
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const inf = app.inferPoint(ev, this.pts.length ? this.pts[this.pts.length - 1] : null);
      const p = [inf.p.x, inf.p.y, inf.p.z];
      if (this.pts.length >= 3 && G.dist(G.v(...p), G.v(...this.pts[0])) < 0.15) {
        this._commit();
        return;
      }
      this.pts.push(p);
    }
    onKey(ev) {
      if (ev.key === 'Enter' && this.pts.length >= 3) { this._commit(); return true; }
      if (ev.key === 'Escape') { this.activate(); this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB() { return false; }
    _commit() {
      const app = this.app;
      const pts = this.pts.map(p => [+p[0].toFixed(4), +p[1].toFixed(4), +p[2].toFixed(4)]);
      app.run(this.kind === 'cloud' ? 'revision cloud' : 'filled region', m => {
        m.annotations.push({ id: nextId(app), kind: this.kind, pts });
        m.touch();
      });
      app.toast(this.kind === 'cloud' ? 'Revision cloud placed' : 'Filled region placed');
      this.activate();
    }
  }
  class CloudTool extends RingTool { static id = 'cloud'; constructor(app) { super(app, 'cloud'); } }
  class RegionTool extends RingTool { static id = 'region'; constructor(app) { super(app, 'region'); } }

  // ------------------------------------------------------ section / elevation
  class SectionTool extends Tool {
    static id = 'section';
    activate() { this.A = null; this.status(); }
    cleanup() { super.cleanup(); this.activate(); }
    get hint() {
      return this.A
        ? 'Section: click the second end of the cut line — the view saves and opens (camera perpendicular to the line, model clipped at the cut).'
        : 'Section: click the first end of the cut line on a level (draw THROUGH the building).';
    }
    onMove(ev) {
      const app = this.app, view = app.view;
      view.clearPreview();
      view.showSnapDot(null);
      const inf = app.inferPoint(ev, this.A || null);
      const p = G.v(inf.p.x, inf.p.y, inf.p.z);
      view.showSnapDot(inf.kind === 'axis' || inf.kind === 'free' ? null : inf.p, inf.kind);
      if (this.A) view.previewLine([G.v(...this.A), p], 0xd23c2e, true);
      else view.previewLine([p, G.add(p, G.v(0.5, 0.5, 0))], 0xd23c2e, true);
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const inf = app.inferPoint(ev, this.A || null);
      const p = [inf.p.x, inf.p.y, inf.p.z];
      if (!this.A) { this.A = p; this.status(); return; }
      if (Math.hypot(p[0] - this.A[0], p[1] - this.A[1]) < 0.5) return;
      Annotate2.makeSectionView(app, this.A, p);
      this.activate();
    }
    onKey(ev) {
      if (ev.key === 'Escape') { this.activate(); this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB() { return false; }
  }

  class ElevationTool extends Tool {
    static id = 'elevmark';
    activate() { this.status(); }
    get hint() { return 'Elevation: click the point you want to look FROM — the view saves and opens looking horizontally toward the model.'; }
    onMove(ev) {
      const app = this.app;
      app.view.clearPreview();
      app.view.showSnapDot(null);
      const inf = app.inferPoint(ev, null);
      const p = G.v(inf.p.x, inf.p.y, inf.p.z);
      app.view.showSnapDot(inf.kind === 'axis' || inf.kind === 'free' ? null : inf.p, inf.kind);
      app.view.previewLine([p, G.add(p, G.v(-1, -1, 0))], 0xd23c2e, true);
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const inf = app.inferPoint(ev, null);
      Annotate2.makeElevationView(app, [inf.p.x, inf.p.y, inf.p.z]);
    }
    onKey(ev) {
      if (ev.key === 'Escape') { this.app.view.clearPreview(); return true; }
      return false;
    }
    onVCB() { return false; }
  }

  // ------------------------------------------------------------- the module
  const Annotate2 = {
    AngularDimTool, RadialDimTool, CloudTool, RegionTool, SectionTool, ElevationTool,

    // angle at V between rays V→p1, V→p2 (degrees, always the smaller angle)
    angleDeg(V, p1, p2) {
      const a1 = Math.atan2(p1.y - V.y, p1.x - V.x);
      const a2 = Math.atan2(p2.y - V.y, p2.x - V.x);
      let d = Math.abs(a1 - a2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      return d * 180 / Math.PI;
    },
    // arc points from ray V→p1 sweeping the SHORT way to ray V→p2 at radius r
    arcPts(V, p1, p2, r) {
      let a1 = Math.atan2(p1.y - V.y, p1.x - V.x);
      let a2 = Math.atan2(p2.y - V.y, p2.x - V.x);
      let d = a2 - a1;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const n = Math.max(8, Math.ceil(Math.abs(d) / (Math.PI / 24)));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = a1 + d * i / n;
        pts.push(G.v(V.x + Math.cos(t) * r, V.y + Math.sin(t) * r, V.z));
      }
      return pts;
    },

    // ---- saved views -----------------------------------------------------
    makeSectionView(app, A, B) {
      const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
      // look direction: perpendicular of the cut line, toward where the user
      // drew FROM (A side) — standard section convention
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const L = Math.hypot(dx, dy) || 1;
      const n = [dy / L, -dx / L]; // perpendicular
      const dist = Math.max(12, L * 1.6);
      const eye = [mx + n[0] * dist, my + n[1] * dist, 2];
      const view = {
        id: nextViewId(app), kind: 'section',
        name: 'Section ' + ((app.model.views || []).filter(v => v.kind === 'section').length + 1),
        eye, target: [mx, my, 1.5],
        clip: { n: [-n[0], -n[1], 0], d: -(n[0] * mx + n[1] * my) },
        cut: [A, B],
      };
      app.run('section view', m => {
        (m.views = m.views || []).push(view);
        m.touch();
      });
      Annotate2.activateView(app, view);
      app.toast(`${view.name} saved — Views ▸ Sections… to return; the marker sits on the cut`);
      return view;
    },
    makeElevationView(app, from) {
      // look toward the model centroid, horizontally
      const ents = app.bim.entities.filter(e => e.params && (e.params.base || e.params.baseline));
      let cx = 0, cy = 0, n = 0;
      for (const e of ents.slice(0, 60)) {
        const p = e.params.base || (e.params.baseline && e.params.baseline[0]);
        if (p) { cx += p[0]; cy += p[1]; n++; }
      }
      if (!n) { cx = 0; cy = 0; }
      cx /= n || 1; cy /= n || 1;
      const dx = cx - from[0], dy = cy - from[1];
      const L = Math.hypot(dx, dy) || 1;
      const view = {
        id: nextViewId(app), kind: 'elevation',
        name: 'Elevation ' + ((app.model.views || []).filter(v => v.kind === 'elevation').length + 1),
        eye: [from[0] - dx / L * 0.5, from[1] - dy / L * 0.5, 2],
        target: [cx, cy, 1.5],
      };
      app.run('elevation view', m => {
        (m.views = m.views || []).push(view);
        m.touch();
      });
      Annotate2.activateView(app, view);
      app.toast(`${view.name} saved`);
      return view;
    },
    activateView(app, view) {
      const view_ = app.view;
      view_.cam.target = { x: view.target[0], y: view.target[1], z: view.target[2] };
      const ex = view.eye[0] - view.target[0], ey = view.eye[1] - view.target[1];
      const dist = Math.max(10, Math.hypot(ex, ey));
      view_.cam.dist = dist;
      view_.cam.el = Math.asin(Math.max(-1, Math.min(1, (view.eye[2] - view.target[2]) / dist))) || 0.001;
      view_.cam.az = Math.atan2(ey, ex) + Math.PI; // camera sits opposite the eye vector
      view_.cam.ortho = true;
      view_._activeSection = view.clip ? view : null;
      view_.applyCamera();
      view_.invalidate();
    },
    clearSection(app) {
      app.view._activeSection = null;
      app.view.cam.ortho = false;
      app.view.applyCamera();
      app.view.invalidate();
    },

    // ---- print sheet (3.9) ------------------------------------------------
    printSheet(app) {
      const glCanvas = app.view.renderer.domElement;
      const img = glCanvas.toDataURL('image/png');
      const geo = app.model.geo || {};
      const today = new Date().toISOString().slice(0, 10);
      const w = window.open('', '_blank');
      if (!w) { app.toast('Allow pop-ups to print the sheet', true); return; }
      w.document.write(`<!DOCTYPE html><html><head><title>WebSketch 3D — Sheet</title>
<style>
  @page { size: A3 landscape; margin: 10mm; }
  body { margin: 0; font: 12px/1.4 system-ui, sans-serif; }
  .sheet { display: flex; flex-direction: column; height: 96vh; }
  .view { flex: 1; display: flex; align-items: center; justify-content: center; border: 1px solid #333; }
  .view img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .title { border: 1px solid #333; border-top: none; display: flex; }
  .title div { padding: 6px 14px; border-right: 1px solid #333; flex: none; }
  .title .grow { flex: 1; border-right: none; }
</style></head><body>
<div class="sheet">
  <div class="view"><img src="${img}" alt="model view"></div>
  <div class="title">
    <div><b>WebSketch 3D</b></div>
    <div>Date<br>${today}</div>
    <div>Scale<br>—</div>
    ${geo && geo.basePoint ? `<div>Base point<br>E ${geo.basePoint.east.toFixed(1)} N ${geo.basePoint.north.toFixed(1)}</div>` : ''}
    <div class="grow">Project<br>—</div>
    <div>Sheet<br>A-01</div>
  </div>
</div>
<script>window.onload = () => setTimeout(() => window.print(), 300);</' + 'script>
</body></html>`);
      w.document.close();
      app.toast('Print sheet opened — use the browser Print dialog (Save as PDF)');
    },
  };
  window.Annotate2 = Annotate2;
})();
