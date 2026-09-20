'use strict';
// ---------------------------------------------------------------------------
// features/rebar.js — single rebar shapes (the FreeCAD-Reinforcement model,
// ported): Straight Rebar, L-Shape Rebar, and Stirrup.
//
// The interaction, exactly like the source workbench:
//   1. activate a tool → click a FACE of the host
//      · straight / L-shape bars on a column → a SIDE face (bars run up the
//        column, copies step INTO the concrete along the face normal)
//      · stirrup (tie) → the TOP or BOTTOM face (the tie lies in that plane,
//        copies climb the column)
//   2. a dialog opens: covers, diameter, amount-or-spacing → live preview of
//      every bar centerline
//   3. Create commits solid loose tubes (never welded into the host B-Rep,
//      so editing the concrete never touches the bars)
//
// Placement model (per FreeCAD's makeStraightRebar / makeLShapeRebar /
// makeStirrup):
//   · every cover is measured to the BAR SURFACE, so each cover gains
//     diameter/2 before it positions the centerline
//   · the first bar sits FrontCover + dia/2 off the picked face, the last
//     the same off the far side; spacing between them is solved from the
//     count (amount mode) or the count is solved from the spacing:
//     n = ceil((depth - dia) / spacing) + 1
//   · stirrup corners are rounded with a mandrel of `rounding` bar
//     diameters; both bar ends hook into the core at `bentAngle` with a
//     tail of `bentFactor` bar diameters
// ---------------------------------------------------------------------------
(function () {
  const G = window.G;

  const REBAR_COLOR = '#a94442';      // steel red — face colors are '#rrggbb'
  const REBAR_PREVIEW = 0xa94442;     // previewLoop takes numeric colors

  // ----------------------------------------------------------------- frame
  /** Local coordinates of a host face: outward normal n, in-plane axes
   *  (u, v) — u = n×z (x when n ∥ z), v = n×u — rectangle extents in that
   *  frame, a map(a, b) → 3D point on the face plane, and the material
   *  DEPTH behind the face (extent of the face's connected component along
   *  the inward normal). Everything the path builders need. */
  function faceFrame(m, fid) {
    const f = m.faces.get(fid);
    if (!f) return null;
    const pts = m.pts(f.loop);
    if (pts.length < 3) return null;
    let n = G.loopNormal(pts);
    if (G.isZero(n)) return null;
    n = G.norm(n);
    // faces adjacent through shared edges → the host component's vertices
    const edgeFaces = new Map(); // "a>b" (sorted vids) -> [fid]
    for (const [id2, g] of m.faces)
      for (const ring of m.rings(g))
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const k = a < b ? a + '>' + b : b + '>' + a;
          if (!edgeFaces.has(k)) edgeFaces.set(k, []);
          edgeFaces.get(k).push(id2);
        }
    const seen = new Set([fid]);
    const q = [fid];
    const verts = new Set();
    while (q.length) {
      const cur = m.faces.get(q.pop());
      if (!cur) continue;
      for (const ring of m.rings(cur))
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          verts.add(a); verts.add(b);
          const k = a < b ? a + '>' + b : b + '>' + a;
          for (const id2 of edgeFaces.get(k) || [])
            if (!seen.has(id2)) { seen.add(id2); q.push(id2); }
        }
    }
    let C = G.v(0, 0, 0);
    for (const p of pts) C = G.add(C, p);
    C = G.mul(C, 1 / pts.length);
    const ext = dir => {
      let e = 0;
      for (const vid of verts) e = Math.max(e, G.dot(G.sub(m.vp(vid), C), dir));
      return e;
    };
    // the material lies behind the picked face: orient n so the component
    // extends deeper along -n than +n (an outer face of a solid)
    if (ext(G.mul(n, -1)) < ext(n) - 1e-6) n = G.mul(n, -1);
    const depth = ext(G.mul(n, -1));
    let u = G.cross(n, G.v(0, 0, 1));
    if (G.len(u) < 1e-6) u = G.v(1, 0, 0);
    u = G.norm(u);
    const v = G.norm(G.cross(n, u));
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const p of pts) {
      const a = G.dot(p, u), b = G.dot(p, v);
      u0 = Math.min(u0, a); u1 = Math.max(u1, a);
      v0 = Math.min(v0, b); v1 = Math.max(v1, b);
    }
    const ca = G.dot(C, u), cb = G.dot(C, v);
    const map = (a, b) => G.add(C, G.add(G.mul(u, a - ca), G.mul(v, b - cb)));
    return { n, u, v, u0, u1, v0, v1, C, depth, map };
  }

  // ------------------------------------------------------------- 2D helpers
  const rot2 = (x, y, deg) => {
    const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    return [x * c - y * s, x * s + y * c];
  };

  /** Replace every interior corner of a polyline with a tessellated arc of
   *  `radius` (clamped so it never eats half of an incident leg). Points are
   *  {a, b} in face coordinates. */
  function roundedPath(pts, radius, segs = 3) {
    if (!(radius > 1e-9) || pts.length < 3) return pts.map(p => ({ ...p }));
    const P = pts.map(p => ({ ...p }));
    const out = [P[0]];
    for (let i = 1; i < P.length - 1; i++) {
      const a = P[i - 1], b = P[i], c = P[i + 1];
      const d1 = [b.a - a.a, b.b - a.b], d2 = [c.a - b.a, c.b - b.b];
      const l1 = Math.hypot(d1[0], d1[1]), l2 = Math.hypot(d2[0], d2[1]);
      if (l1 < 1e-9 || l2 < 1e-9) { out.push({ ...b }); continue; }
      const t1 = [d1[0] / l1, d1[1] / l1], t2 = [d2[0] / l2, d2[1] / l2];
      const cosT = Math.max(-1, Math.min(1, t1[0] * t2[0] + t1[1] * t2[1]));
      const turn = Math.acos(cosT);
      if (turn < 1e-4 || Math.abs(turn - Math.PI) < 1e-4) { out.push({ ...b }); continue; }
      const half = turn / 2;
      // tangent length tt = r/tan(half); clamp r so both tangents fit
      const r = Math.min(radius, (l1 / 2 - 1e-9) * Math.tan(half), (l2 / 2 - 1e-9) * Math.tan(half));
      if (!(r > 1e-9)) { out.push({ ...b }); continue; }
      const tt = r / Math.tan(half);
      const s = { a: b.a - t1[0] * tt, b: b.b - t1[1] * tt };
      const e = { a: b.a + t2[0] * tt, b: b.b + t2[1] * tt };
      // center: on the bisector between the two legs (interior of the turn)
      const bis = [t2[0] - t1[0], t2[1] - t1[1]];
      const bl = Math.hypot(bis[0], bis[1]) || 1;
      const ctr = { a: b.a + bis[0] / bl * r / Math.cos(half), b: b.b + bis[1] / bl * r / Math.cos(half) };
      const a0 = Math.atan2(s.b - ctr.b, s.a - ctr.a);
      const a1 = Math.atan2(e.b - ctr.b, e.a - ctr.a);
      let sweep = a1 - a0;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      for (let s2 = 1; s2 < segs; s2++) {
        const ang = a0 + sweep * s2 / segs;
        out.push({ a: ctr.a + Math.cos(ang) * r, b: ctr.b + Math.sin(ang) * r });
      }
      out.push(e);
    }
    out.push(P[P.length - 1]);
    return out;
  }

  // ------------------------------------------------------------- path shapes
  /** Straight bar: one line across the picked face. orientation 'Vertical'
   *  (runs along v; side = Left|Right in u) or 'Horizontal' (runs along u;
   *  side = Bottom|Top in v). lb/rt = covers at the two bar ENDS. */
  function straightPath(fr, p) {
    const r = p.dia / 2;
    if (p.orientation === 'Vertical') {
      const a = p.side === 'Left' ? fr.u0 + p.cover + r : fr.u1 - p.cover - r;
      return [fr.map(a, fr.v0 + p.lb + r), fr.map(a, fr.v1 - p.rt - r)];
    }
    const b = p.side === 'Bottom' ? fr.v0 + p.cover + r : fr.v1 - p.cover - r;
    return [fr.map(fr.u0 + p.lb + r, b), fr.map(fr.u1 - p.rt - r, b)];
  }

  /** L-shape: the long leg spans the face, the foot runs along the bottom
   *  (Bottom Left/Right) or top (Top Left/Right) edge to the opposite cover
   *  — FreeCAD's four orientations. A short hook foot is expressed with a
   *  large far-side cover. Corner rounded by rounding×dia. */
  function lshapePath(fr, p) {
    const r = p.dia / 2;
    const L = fr.u0 + p.l + r, R = fr.u1 - p.r - r;
    const B = fr.v0 + p.b + r, T = fr.v1 - p.t - r;
    const P2 = {
      'Bottom Left': [[L, T], [L, B], [R, B]],
      'Bottom Right': [[R, T], [R, B], [L, B]],
      'Top Left': [[L, B], [L, T], [R, T]],
      'Top Right': [[R, B], [R, T], [L, T]],
    }[p.orientation] || [[L, T], [L, B], [R, B]];
    const rounded = roundedPath(P2.map(([a, b]) => ({ a, b })), (p.rounding || 0) * p.dia);
    return rounded.map(q => fr.map(q.a, q.b));
  }

  /** Stirrup (tie): a rectangle inset by the four covers with rounded
   *  corners at the three closed bends, OPEN at the top-left hook corner:
   *  both bar ends anchor at that same corner and hook INTO the core at
   *  bentAngle with a tail of bentFactor bar diameters — FreeCAD's classic
   *  seismic tie (open path p0..p6). The lap stays entirely INSIDE the tie
   *  outline: no tangent overshoot, so no tube ever enters the cover. */
  function stirrupPath(fr, p) {
    const r = p.dia / 2;
    const A = [fr.u0 + p.l + r, fr.v1 - p.t - r]; // top-left (the hook corner)
    const B = [fr.u0 + p.l + r, fr.v0 + p.b + r]; // bottom-left
    const C = [fr.u1 - p.r - r, fr.v0 + p.b + r]; // bottom-right
    const D = [fr.u1 - p.r - r, fr.v1 - p.t - r]; // top-right
    const R = Math.max(0, Math.min((p.rounding || 0) * p.dia,
      (C[0] - B[0]) / 2 - 1e-9, (A[1] - B[1]) / 2 - 1e-9));
    // 90° corner arc: K between incoming dir dIn and outgoing dir dOut.
    // Tangent points K∓dir·R, center K + (dOut - dIn)·R (inside the turn).
    const arc90 = (K, dIn, dOut) => {
      if (R < 1e-9) return [K.slice()];
      const s = [K[0] - dIn[0] * R, K[1] - dIn[1] * R];
      const e = [K[0] + dOut[0] * R, K[1] + dOut[1] * R];
      const ctr = [K[0] + (dOut[0] - dIn[0]) * R, K[1] + (dOut[1] - dIn[1]) * R];
      const a0 = Math.atan2(s[1] - ctr[1], s[0] - ctr[0]);
      const a1 = Math.atan2(e[1] - ctr[1], e[0] - ctr[0]);
      let sweep = a1 - a0;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      const out = [s];
      for (let i = 1; i <= 3; i++) {
        const ang = a0 + sweep * i / 3;
        out.push([ctr[0] + Math.cos(ang) * R, ctr[1] + Math.sin(ang) * R]);
      }
      out.push(e);
      return out;
    };
    // FreeCAD's open path p0..p6 with the closing lap anchored AT the hook
    // corner (no tangent overshoot): the tube never leaves the tie outline,
    // so nothing penetrates the outer cover. Both 135° tails leave the
    // corner itself and dive into the core, hugging the corner bar; the
    // other three corners keep their bar-nesting arcs.
    const walk = [
      A,                               // p1: the hook corner (sharp miter)
      ...arc90(B, [0, -1], [1, 0]),    // p2 zone: bottom-left
      ...arc90(C, [1, 0], [0, 1]),     // p3 zone: bottom-right
      ...arc90(D, [0, 1], [-1, 0]),    // p4 zone: ends on the top edge heading -u
      [A[0], A[1]],                    // p5: the top leg closes back ON the corner
    ];
    // hook tails (FreeCAD p0/p6): (sin θ, -cos θ) with θ = 180 - bentAngle,
    // from the corner into the core
    const th = (180 - (p.bentAngle || 135)) * Math.PI / 180;
    const tail = [Math.sin(th), -Math.cos(th)];
    const L = (p.bentFactor || 4) * p.dia;
    const tip = [A[0] + tail[0] * L, A[1] + tail[1] * L];
    const uv = [
      tip,                       // p0: start hook from the corner
      ...walk,
      tip.slice(),               // p6: the lap closes on the same diagonal
    ];
    return uv.map(([a, b]) => fr.map(a, b));
  }

  // ----------------------------------------------------------- distribution
  /** Copies along -n: first at front+dia/2, last the same off the far side
   *  (FreeCAD's OffsetStart = OffsetEnd), spacing solved in between. */
  function distribute(fr, p) {
    const off = p.front + p.dia / 2;
    const count = p.mode === 'amount'
      ? Math.max(1, Math.round(p.value))
      : Math.max(1, Math.ceil((fr.depth - p.dia) / Math.max(p.value, 1e-6)) + 1);
    const step = count > 1 ? (fr.depth - 2 * off) / (count - 1) : 0;
    return { count, step, off, spacing: Math.max(step, 0) };
  }

  /** Build every copy of one rebar shape on a host face. Pure model-level
   *  call — the tools wrap it in app.run(). Returns { ids, count, spacing,
   *  length } (length = ONE bar's centerline length). */
  function buildRebars(m, fid, shape, p) {
    const fr = faceFrame(m, fid);
    if (!fr) return { ids: [], count: 0 };
    const path = shape === 'stirrup' ? stirrupPath(fr, p)
      : shape === 'lshape' ? lshapePath(fr, p)
        : straightPath(fr, p);
    if (!path || path.length < 2) return { ids: [], count: 0 };
    const dist = distribute(fr, p);
    const ids = [];
    for (let i = 0; i < dist.count; i++) {
      const d = G.mul(fr.n, dist.off + i * dist.step);
      const pts = path.map(q => G.sub(q, d));
      ids.push(...m.addRebarPath(pts, p.dia, {
        color: REBAR_COLOR,
        meta: { shape, count: dist.count, spacing: +dist.spacing.toFixed(6) },
      }));
    }
    let length = 0;
    for (let i = 1; i < path.length; i++) length += G.dist(path[i - 1], path[i]);
    return { ids, count: dist.count, spacing: dist.spacing, length, frame: fr };
  }

  // ------------------------------------------------------------------ tools
  const num = id => parseFloat(document.getElementById(id).value) || 0;
  const el = id => document.getElementById(id);
  const fmt = v => (v * 1000).toFixed(0);

  class RebarTool extends Tool {
    static shape = 'straight';
    static title = 'Rebar';
    activate() {
      this.fid = null;
      if (this.app.sel && this.app.sel.faces.size === 1)
        this.fid = [...this.app.sel.faces][0];
      if (this.fid) this._open(); else this.status();
    }
    get hint() {
      return `${this.constructor.title}: click a face of the host — a column SIDE face for bars, its TOP or BOTTOM face for stirrups.`;
    }
    onMove(ev) {
      if (this.fid) return;
      this.app.view.setHoverFace(this.app.view.pickFaceAt(this.app.view.eventPt(ev)));
    }
    onDown(ev) { this._downAt = this.app.view.eventPt(ev); }
    onUp(ev) {
      if (this.fid) return;
      const q = this.app.view.eventPt(ev);
      const d0 = this._downAt;
      if (d0 && (Math.abs(q.x - d0.x) > 4 || Math.abs(q.y - d0.y) > 4)) return; // drag, not a pick
      const fid = this.app.view.pickFaceAt(q);
      if (fid) { this.fid = fid; this._open(); }
    }
    cleanup() {
      this.app.view.setHoverFace(null);
      this.app.view.clearPreview();
    }
    // ---- shape plumbing: subclasses supply fields + params ----
    fields() { return []; }
    customFields() { return ''; }
    wireCustom() { }
    readParams() { return {}; }
    info(p, d) { return `${d.count} bars ⌀${fmt(p.dia)} mm @ ${(d.spacing * 1000).toFixed(0)} mm`; }
    _open() {
      const app = this.app, shape = this.constructor.shape;
      app.view.setHoverFace(this.fid);
      const html = this.fields().map(([id, label, val]) =>
        `<div class="form-row"><label>${label}</label><input id="${id}" type="number" step="0.005" value="${val}" style="width:90px"> m</div>`).join('');
      app.dialog(this.constructor.title, html + this.customFields() +
        `<p class="dim" id="rebar-info"></p>
         <p class="dim">Covers are measured to the bar surface. Bars are independent solids — editing the host never touches them.</p>`,
        [['Cancel', null], ['Create', () => {
          const p = this.readParams();
          const res = app.run(`rebar ${shape}`, m => {
            const r = buildRebars(m, this.fid, shape, p);
            if (r && r.ids.length) m.createGroup({ faces: new Set(r.ids), edges: new Set() }, 'Rebar · ' + shape);
            return r;
          });
          app.view.clearPreview();
          if (!res || !res.ids.length) { app.toast('Could not build the rebar — check the covers', true); return; }
          app.toast(`${res.count} × ${shape === 'stirrup' ? 'stirrup' : 'bar'} created (⌀${fmt(p.dia)} mm, @ ${(res.spacing * 1000).toFixed(0)} mm)`);
          this.fid = null;
          this.status();
        }]]);
      const update = () => {
        const p = this.readParams();
        const fr = faceFrame(app.model, this.fid);
        app.view.clearPreview();
        if (!fr) return;
        const path = shape === 'stirrup' ? stirrupPath(fr, p)
          : shape === 'lshape' ? lshapePath(fr, p) : straightPath(fr, p);
        const dist = distribute(fr, p);
        for (let i = 0; i < Math.min(dist.count, 200); i++) {
          const d = G.mul(fr.n, dist.off + i * dist.step);
          app.view.previewLoop(path.map(q => G.sub(q, d)), REBAR_PREVIEW);
        }
        const info = el('rebar-info');
        if (info) info.textContent = this.info(p, dist);
      };
      app._onDialogClose = () => {
        app.view.clearPreview(); app.view.setHoverFace(null);
        this.fid = null; this.status();
      };
      for (const [id] of this.fields()) {
        const inp = el(id);
        if (inp) inp.addEventListener('input', update);
      }
      this.wireCustom(update);
      update();
    }
  }

  const amountSpacingCustom = () => `
    <div class="form-row"><label>Distribution</label>
      <label class="chk"><input type="radio" name="rebar-mode" value="amount" checked> Amount</label>
      <label class="chk"><input type="radio" name="rebar-mode" value="spacing"> Spacing</label>
    </div>
    <div class="form-row"><label>Amount / Spacing</label>
      <input id="rb-amt" type="number" step="1" min="1" value="4" style="width:90px">
      <input id="rb-spc" type="number" step="0.01" value="0.15" disabled style="width:90px"> m</div>`;
  const readAmountSpacing = () => {
    const mode = document.querySelector('input[name="rebar-mode"]:checked').value;
    return { mode, value: mode === 'amount' ? num('rb-amt') : num('rb-spc') };
  };
  const wireAmountSpacing = update => {
    document.querySelectorAll('input[name="rebar-mode"]').forEach(r => r.addEventListener('change', () => {
      el('rb-amt').disabled = !(r.value === 'amount' && r.checked);
      el('rb-spc').disabled = !(r.value === 'spacing' && r.checked);
      update();
    }));
    el('rb-amt').addEventListener('input', update);
    el('rb-spc').addEventListener('input', update);
  };

  class StraightRebarTool extends RebarTool {
    static id = 'rebar-straight';
    static shape = 'straight';
    static title = 'Straight Rebar';
    fields() {
      return [['sr-cover', 'Side Cover', 0.04], ['sr-lb', 'Bottom/Left Cover', 0.05],
        ['sr-rt', 'Top/Right Cover', 0.05], ['sr-front', 'Front Cover', 0.04],
        ['sr-dia', 'Diameter', 0.016]];
    }
    customFields() {
      return `<div class="form-row"><label>Orientation</label>
          <select id="sr-ori" style="width:120px"><option>Vertical</option><option>Horizontal</option></select></div>
        <div class="form-row"><label>Bar Position</label>
          <select id="sr-side" style="width:120px"><option>Left Side</option><option>Right Side</option></select></div>` +
        amountSpacingCustom();
    }
    wireCustom(update) {
      el('sr-ori').addEventListener('change', () => {
        el('sr-side').innerHTML = el('sr-ori').value === 'Vertical'
          ? '<option>Left Side</option><option>Right Side</option>'
          : '<option>Bottom Side</option><option>Top Side</option>';
        update();
      });
      el('sr-side').addEventListener('change', update);
      wireAmountSpacing(update);
    }
    readParams() {
      return {
        orientation: el('sr-ori').value, side: el('sr-side').value.replace(' Side', ''),
        cover: num('sr-cover'), lb: num('sr-lb'), rt: num('sr-rt'),
        front: num('sr-front'), dia: num('sr-dia'), ...readAmountSpacing(),
      };
    }
  }

  class LShapeRebarTool extends RebarTool {
    static id = 'rebar-lshape';
    static shape = 'lshape';
    static title = 'L-Shape Rebar';
    fields() {
      return [['lr-l', 'Left Cover', 0.04], ['lr-r', 'Right Cover', 0.04],
        ['lr-t', 'Top Cover', 0.05], ['lr-b', 'Bottom Cover', 0.05],
        ['lr-front', 'Front Cover', 0.04], ['lr-dia', 'Diameter', 0.016]];
    }
    customFields() {
      return `<div class="form-row"><label>Orientation</label>
          <select id="lr-ori" style="width:120px">
            <option>Bottom Left</option><option>Bottom Right</option>
            <option>Top Left</option><option>Top Right</option></select></div>
        <div class="form-row"><label>Rounding (× dia)</label>
          <input id="lr-rnd" type="number" step="0.5" min="0" value="2" style="width:90px"></div>` +
        amountSpacingCustom();
    }
    wireCustom(update) {
      el('lr-ori').addEventListener('change', update);
      el('lr-rnd').addEventListener('input', update);
      wireAmountSpacing(update);
    }
    readParams() {
      return {
        orientation: el('lr-ori').value, rounding: num('lr-rnd'),
        l: num('lr-l'), r: num('lr-r'), t: num('lr-t'), b: num('lr-b'),
        front: num('lr-front'), dia: num('lr-dia'), ...readAmountSpacing(),
      };
    }
  }

  class StirrupRebarTool extends RebarTool {
    static id = 'rebar-stirrup';
    static shape = 'stirrup';
    static title = 'Stirrup';
    fields() {
      return [['st-l', 'Left Cover', 0.04], ['st-r', 'Right Cover', 0.04],
        ['st-t', 'Top Cover', 0.04], ['st-b', 'Bottom Cover', 0.04],
        ['st-front', 'Front Cover', 0.05], ['st-dia', 'Diameter', 0.008]];
    }
    customFields() {
      return `<div class="form-row"><label>Rounding (× dia)</label>
          <input id="st-rnd" type="number" step="0.5" min="0" value="2" style="width:90px"></div>
        <div class="form-row"><label>Bent Angle</label>
          <select id="st-bent" style="width:120px"><option>135</option><option>90</option></select></div>
        <div class="form-row"><label>Bent Factor (× dia)</label>
          <input id="st-bf" type="number" step="1" min="0" value="6" style="width:90px"></div>` +
        amountSpacingCustom();
    }
    wireCustom(update) {
      el('st-rnd').addEventListener('input', update);
      el('st-bent').addEventListener('change', update);
      el('st-bf').addEventListener('input', update);
      wireAmountSpacing(update);
    }
    readParams() {
      return {
        l: num('st-l'), r: num('st-r'), t: num('st-t'), b: num('st-b'),
        front: num('st-front'), dia: num('st-dia'),
        rounding: num('st-rnd'), bentAngle: parseInt(el('st-bent').value, 10) || 135,
        bentFactor: num('st-bf') || 4, ...readAmountSpacing(),
      };
    }
    info(p, d) { return `${d.count} stirrups ⌀${fmt(p.dia)} mm @ ${(d.spacing * 1000).toFixed(0)} mm`; }
  }

  window.Rebar = {
    StraightRebarTool, LShapeRebarTool, StirrupRebarTool,
    faceFrame, straightPath, lshapePath, stirrupPath, distribute, buildRebars,
    roundedPath, REBAR_COLOR,
  };
})();
