'use strict';
// plan.js — the ETABS plan view: gridlines with bubbles, joints, members
// at the active story (columns below drawn dashed), click-drawing, and the
// results overlays (deformed shape, force diagrams).
(function () {
  // state lives on the app: { model, story (index), tool, sel, disp, view }
  function Plan(canvas, app) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.app = app;
    this.scale = 60;       // px per metre
    this.pan = { x: 60, y: 40 };
    this.hover = null;     // snapped grid point {x,y}
    this.pending = null;   // first click while drawing a beam
    this.bind();
  }

  Plan.prototype.bind = function () {
    const cv = this.cv;
    cv.addEventListener('mousedown', e => this.down(e));
    cv.addEventListener('mousemove', e => this.move(e));
    cv.addEventListener('mouseup', e => this.up(e));
    cv.addEventListener('dblclick', e => this.dbl(e));
    cv.addEventListener('mouseleave', () => { this.hover = null; this.draw(); });
    cv.addEventListener('contextmenu', e => { e.preventDefault(); this.pending = null; this.draw(); });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.12 : 0.89;
      this.scale = Math.max(12, Math.min(300, this.scale * f));
      this.draw();
    }, { passive: false });
  };

  Plan.prototype.px = function (x, y) { return { x: this.pan.x + x * this.scale, y: this.cv.height - this.pan.y - y * this.scale }; };
  Plan.prototype.unpx = function (px, py) { return { x: (px - this.pan.x) / this.scale, y: (this.cv.height - this.pan.y - py) / this.scale }; };

  Plan.prototype.snap = function (mx, my) {
    // nearest grid intersection, or a joint if closer, or free point
    const m = this.app.model;
    const p = this.unpx(mx, my);
    let best = null, bd = 18 / this.scale; // 18px pick radius
    if (m.grids.x.length && m.grids.y.length) {
      let bx = null, bdx = bd;
      for (const gx of m.grids.x) { const d = Math.abs(gx.pos - p.x); if (d < bdx) { bdx = d; bx = gx.pos; } }
      let by = null, bdy = bd;
      for (const gy of m.grids.y) { const d = Math.abs(gy.pos - p.y); if (d < bdy) { bdy = d; by = gy.pos; } }
      if (bx != null && by != null) best = { x: bx, y: by, snap: 'grid' };
    }
    if (!best) {
      for (const j of m.joints) {
        if (Math.abs(j.z - this.app.elev()) > 1e-6) continue;
        const d = Math.hypot(j.x - p.x, j.y - p.y);
        if (d < bd) { bd = d; best = { x: j.x, y: j.y, snap: 'joint' }; }
      }
    }
    return best || { x: Math.round(p.x * 4) / 4, y: Math.round(p.y * 4) / 4, snap: 'free' };
  };

  Plan.prototype.down = function (e) {
    const r = this.cv.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (e.button !== 0) return;
    const pt = this.snap(mx, my);
    const app = this.app, m = app.model;
    if (app.tool === 'select') {
      const hit = this.hitTest(mx, my);
      app.select(hit);
      return;
    }
    if (app.tool === 'column') {
      RCModel.addColumn(m, app.story, pt.x, pt.y);
      app.dirty();
      return;
    }
    if (app.tool === 'beam') {
      if (!this.pending) { this.pending = pt; this.draw(); return; }
      RCModel.addBeam(m, app.story, this.pending.x, this.pending.y, pt.x, pt.y);
      this.pending = app.chain ? pt : null;
      app.dirty();
      return;
    }
    if (app.tool === 'restraint') {
      // toggle the nearest joint's restraint (base only per ETABS defaults)
      const hit = this.snap(mx, my);
      const j = RCModel.jointAt(m, hit.x, hit.y, app.elev());
      j.restraint = j.restraint === 'fixed' ? 'pinned' : j.restraint === 'pinned' ? null : 'fixed';
      app.dirty();
      return;
    }
  };
  Plan.prototype.move = function (e) {
    const r = this.cv.getBoundingClientRect();
    this.hover = this.snap(e.clientX - r.left, e.clientY - r.top);
    this.mx = e.clientX - r.left; this.my = e.clientY - r.top;
    this.draw();
  };
  Plan.prototype.up = function () { };
  Plan.prototype.dbl = function () { };

  Plan.prototype.hitTest = function (mx, my) {
    const m = this.app.model, z = this.app.elev();
    let best = null, bd = 10;
    for (const f of m.frames) {
      const a = RCModel.jointById(m, f.i), b = RCModel.jointById(m, f.j);
      if (f.kind === 'beam' && Math.abs(a.z - z) > 1e-6) continue;
      if (f.kind === 'column' && Math.abs(b.z - z) > 1e-6) continue;
      const A = this.px(a.x, a.y), B = this.px(b.x, b.y);
      const d = distToSeg(mx, my, A.x, A.y, B.x, B.y);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  };

  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const L2 = dx * dx + dy * dy || 1;
    let t = ((px - x1) * dx + (py - y1) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
  }

  // ------------------------------------------------------------- rendering
  Plan.prototype.draw = function () {
    const g = this.g, cv = this.cv, m = this.app.model, z = this.app.elev();
    const W = cv.width = cv.clientWidth * (window.devicePixelRatio || 1);
    const H = cv.height = cv.clientHeight * (window.devicePixelRatio || 1);
    g.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    g.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
    g.fillStyle = '#1b1e23';
    g.fillRect(0, 0, cv.clientWidth, cv.clientHeight);
    // extents for auto-fit-ish padding
    this.drawGrids(g);
    // members at this story + column stubs
    const sel = this.app.sel;
    for (const f of m.frames) {
      const a = RCModel.jointById(m, f.i), b = RCModel.jointById(m, f.j);
      const atStory = f.kind === 'beam'
        ? Math.abs(a.z - z) < 1e-6
        : Math.abs(b.z - z) < 1e-6; // column whose TOP is this story
      if (!atStory) continue;
      const A = this.px(a.x, a.y), B = this.px(b.x, b.y);
      const isSel = sel === f;
      g.strokeStyle = isSel ? '#ff9f43' : f.kind === 'column' ? '#8fd3ff' : '#e8eef2';
      g.lineWidth = f.kind === 'column' ? 7 : 5;
      g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
      // force overlay color when results displayed
      if (this.app.disp && this.app.disp.kind !== 'model' && m.results) this.drawForceColor(g, f, A, B);
    }
    // joints
    for (const j of m.joints) {
      if (Math.abs(j.z - z) > 1e-6) continue;
      const P = this.px(j.x, j.y);
      g.fillStyle = '#9aa4ad';
      g.fillRect(P.x - 2.5, P.y - 2.5, 5, 5);
      if (j.restraint) {
        g.strokeStyle = j.restraint === 'pinned' ? '#ffd166' : '#06d6a0';
        g.lineWidth = 2;
        g.beginPath();
        if (j.restraint === 'pinned') { g.moveTo(P.x - 6, P.y + 7); g.lineTo(P.x + 6, P.y + 7); g.moveTo(P.x, P.y); g.lineTo(P.x, P.y + 7); }
        else { for (let i = -1; i <= 1; i++) { g.moveTo(P.x + i * 5, P.y + 7); g.lineTo(P.x + i * 5 - 3, P.y + 12); } g.moveTo(P.x - 8, P.y + 7); g.lineTo(P.x + 8, P.y + 7); }
        g.stroke();
      }
    }
    // deformed-shape overlay (plan): displaced joint positions
    if (this.app.disp && this.app.disp.kind === 'deformed' && m.results) {
      const res = m.results.results[this.app.disp.combo || 0];
      if (res) {
        const k = this.app.disp.amp || 200;
        g.strokeStyle = '#06d6a0'; g.lineWidth = 2;
        for (const f of m.frames) {
          const a = RCModel.jointById(m, f.i), b = RCModel.jointById(m, f.j);
          if (Math.abs(a.z - z) > 1e-6 && Math.abs(b.z - z) > 1e-6) continue;
          const ia = m.joints.indexOf(a), ib = m.joints.indexOf(b);
          const A = this.px(a.x + (res.U[ia * 6] || 0) / 1000 * k / 100, a.y + (res.U[ia * 6 + 1] || 0) / 1000 * k / 100);
          const B = this.px(b.x + (res.U[ib * 6] || 0) / 1000 * k / 100, b.y + (res.U[ib * 6 + 1] || 0) / 1000 * k / 100);
          g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
        }
      }
    }
    // hover + pending
    if (this.hover && (this.app.tool === 'beam' || this.app.tool === 'column')) {
      const P = this.px(this.hover.x, this.hover.y);
      g.strokeStyle = '#ff9f43'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(P.x, P.y, 8, 0, Math.PI * 2); g.stroke();
      if (this.pending) {
        const A = this.px(this.pending.x, this.pending.y);
        g.setLineDash([5, 4]);
        g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(P.x, P.y); g.stroke();
        g.setLineDash([]);
        const L = Math.hypot(this.hover.x - this.pending.x, this.hover.y - this.pending.y);
        g.fillStyle = '#ff9f43'; g.font = '11px system-ui';
        g.fillText(L.toFixed(2) + ' m', (A.x + P.x) / 2 + 6, (A.y + P.y) / 2 - 6);
      }
    }
  };

  Plan.prototype.drawGrids = function (g) {
    const m = this.app.model;
    if (!m.grids.x.length && !m.grids.y.length && !m.joints.length) {
      g.fillStyle = '#5c6470'; g.font = '13px system-ui';
      g.fillText('No grids yet — File ▸ New Model (stories + gridlines)', 24, 40);
      return;
    }
    // extents
    let x0 = 0, x1 = 12, y0 = 0, y1 = 8;
    const xs = m.grids.x.map(v => v.pos), ys = m.grids.y.map(v => v.pos);
    for (const j of m.joints) { xs.push(j.x); ys.push(j.y); }
    if (xs.length) { x0 = Math.min(...xs) - 1.5; x1 = Math.max(...xs) + 1.5; }
    if (ys.length) { y0 = Math.min(...ys) - 1.5; y1 = Math.max(...ys) + 1.5; }
    g.font = '12px system-ui';
    for (const gx of m.grids.x) {
      const A = this.px(gx.pos, y0), B = this.px(gx.pos, y1);
      g.strokeStyle = '#3a414b'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
      g.fillStyle = '#262b33'; g.strokeStyle = '#4a5260';
      g.beginPath(); g.arc(A.x, A.y - 12, 10, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#cfd6dd'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(gx.label, A.x, A.y - 12);
    }
    for (const gy of m.grids.y) {
      const A = this.px(x0 - 1, gy.pos), B = this.px(x1 + 1, gy.pos);
      g.strokeStyle = '#3a414b'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
      g.fillStyle = '#262b33'; g.strokeStyle = '#4a5260';
      g.beginPath(); g.arc(A.x - 12, A.y, 10, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#cfd6dd'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(gy.label, A.x - 12, A.y);
    }
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  };

  // member color by the displayed force magnitude (ETABS-style color fill)
  Plan.prototype.drawForceColor = function (g, f, A, B) {
    const m = this.app.model;
    const res = m.results.results[this.app.disp.combo || 0];
    if (!res || !res.frames) return;
    const idx = m.results.mesh.frames.findIndex(fr => fr.frameId === f.id);
    const fe = res.frames[idx2(res, idx)];
    if (!fe) return;
    const v = this.app.disp.kind === 'moment' ? Math.max(Math.abs(fe.forces[4]), Math.abs(fe.forces[5]), Math.abs(fe.forces[10]), Math.abs(fe.forces[11]))
      : this.app.disp.kind === 'shear' ? Math.max(Math.abs(fe.forces[1]), Math.abs(fe.forces[2]), Math.abs(fe.forces[7]), Math.abs(fe.forces[8]))
        : Math.abs(fe.forces[0]);
    const all = m.results.envelope.map(e => this.app.disp.kind === 'moment' ? e.maxM : this.app.disp.kind === 'shear' ? e.maxV : e.maxN);
    const mx = Math.max(...all, 1e-9);
    const t = Math.min(v / mx, 1);
    const hue = 210 - t * 210; // blue → red
    g.strokeStyle = 'hsla(' + hue + ',85%,55%,0.9)';
    g.lineWidth = 11;
    g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
    g.fillStyle = '#fff'; g.font = '10px system-ui';
    const label = (v / (this.app.disp.kind === 'moment' ? 1e6 : 1e3)).toFixed(1);
    g.fillText(label, (A.x + B.x) / 2 - 10, (A.y + B.y) / 2 - 8);
  };

  // mesh.frames[i] maps to sol.frames[i] when no zero-length frames skip —
  // our model never creates zero-length frames, so index is direct
  function idx2(res, i) { return i; }

  window.Plan = Plan;
})();
