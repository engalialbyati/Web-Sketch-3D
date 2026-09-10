'use strict';
// ---------------------------------------------------------------------------
// Feature: Roof — footprint roofs (flat / mono-pitch / gable), P3 roadmap.
//
// Same SDK shape as Column (the reference feature): one Tool class, one
// Engine.features.register() descriptor — the ribbon button, 'roof' /
// 'roofs' command aliases, options-bar fields and the undo label all come
// from the descriptor.
//
// INPUT is the FloorTool's sketch mode: closed boundaries drawn on the
// active Base Level (chain lines/arcs; contained loops become openings —
// for pitched kinds a region with openings falls back to flat, v1).
//
// GEOMETRY (all solids sit at or above the sketch level, Revit-style):
//   flat  — footprint swept UP by the thickness ([z, z+t], FloorTool
//           precedent via model.pushPull with forceBaseCap).
//   mono  — one planar slab sloped along the footprint's LONG axis. The
//           hinge is the sketched low edge: the underside passes through
//           the sketch level there and rises at `pitch`; ridge height =
//           span * tan(pitch). The slab's thickness is measured
//           VERTICALLY (t), so the perpendicular deck is t * cos(pitch).
//   gable — two mirrored mono slabs meeting at the ridge (parallel to the
//           long axis, at mid-span): each half rises (span/2) * tan(pitch).
//           The ridge-perpendicular ends close with vertical hexagonal
//           caps — the classic gable triangles plus the eaves depth — so
//           every pitched solid is a CLOSED shell by construction (every
//           edge is shared by exactly two faces; verified before commit).
//   Overhang extends the plan rectangle/ring outward on all sides; the
//   eaves then dip below the sketch level only OUTSIDE the footprint.
//   Non-rectangular footprints (or regions with openings) requested as
//   mono/gable fall back to flat with a toast (v1).
//
// PARAMETRIC: the entity stores { kind, thickness, pitch, overhang,
// regions, baseLevel } and RoofFeature.rebuildEntity(app, id, patch)
// regenerates the solid from those params alone (delete + rebuild, the
// script-elements pattern) — thickness/pitch edits are one call:
//   app.run('edit roof', () => RoofFeature.rebuildEntity(app, id, { pitch: 30 }));
//
// OUT OF SCOPE (v1, deliberate): wall trims to sloped soffits, parapets,
// opening cutting through pitched planes. Roofs interpenetrate their
// supporting walls monolithically (bimHold, the slab precedent).
// ---------------------------------------------------------------------------
(function () {

  const ROOF_COLOR = '#6d4c41'; // the Materials palette's Roof swatch
  const KINDS = ['flat', 'mono', 'gable'];

  const clampNum = (v, lo, hi, dflt) => {
    const x = +v;
    return isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
  };
  const pitchLabel = p => `${Math.round(p)}\u00B0`;

  // ---------------------------------------------------------- rectangle fit
  // Drop vertices that lie exactly on the previous segment (a rect drawn
  // with chained lines carries redundant collinear points).
  function simplifyRing(pts) {
    const out = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
      const abx = b.x - a.x, aby = b.y - a.y, bcx = c.x - b.x, bcy = c.y - b.y;
      if (Math.abs(abx * bcy - aby * bcx) < 1e-9) continue; // collinear
      out.push(b);
    }
    return out.length >= 3 ? out : pts.slice();
  }

  // A sketched ring qualifies as a pitched footprint when it is a planar
  // 4-corner rectangle (right angles, equal opposite sides — rotation
  // allowed). Returns the local frame { P0, u, v, dMin, dMax, wMin, wMax }
  // with u = unit long axis (the slope direction), or null.
  function rectFrame(G, pts) {
    if (pts.length !== 4) return null;
    const z = pts[0].z;
    if (!pts.every(p => Math.abs(p.z - z) < 1e-6)) return null; // not planar on the sketch level
    const P = pts.map(p => ({ x: p.x, y: p.y }));
    const e = i => {
      const a = P[i], b = P[(i + 1) % 4];
      return { x: b.x - a.x, y: b.y - a.y };
    };
    const L = [0, 1, 2, 3].map(i => Math.hypot(e(i).x, e(i).y));
    if (L.some(l => l < 1e-4)) return null;
    const dot = (a, b) => a.x * b.x + a.y * b.y;
    // right angles (cosine tolerance ~0.06° per corner)
    for (const i of [0, 1]) {
      if (Math.abs(dot(e(i), e(i + 1))) / (L[i] * L[i + 1]) > 1e-3) return null;
    }
    // equal opposite sides (0.01 % tolerance — sketched rects are exact)
    if (Math.abs(L[0] - L[2]) > 1e-4 * Math.max(L[0], L[2])) return null;
    if (Math.abs(L[1] - L[3]) > 1e-4 * Math.max(L[1], L[3])) return null;
    // long axis first: slope runs along the LONGER side, ridge/hinge lines
    // parallel to it (gable = two mirrored mono halves over half the span)
    const long01 = L[0] >= L[1];
    const d0 = long01 ? e(0) : e(1);
    const du = Math.hypot(d0.x, d0.y);
    const u = { x: d0.x / du, y: d0.y / du };
    const v = { x: -u.y, y: u.x };
    const O = P[0];
    const pr = p => ({ d: (p.x - O.x) * u.x + (p.y - O.y) * u.y, w: (p.x - O.x) * v.x + (p.y - O.y) * v.y });
    const q = P.map(pr);
    const dMin = Math.min(...q.map(p => p.d)), dMax = Math.max(...q.map(p => p.d));
    const wMin = Math.min(...q.map(p => p.w)), wMax = Math.max(...q.map(p => p.w));
    if (dMax - dMin < 1e-3 || wMax - wMin < 1e-3) return null;
    return { P0: G.v(O.x, O.y, z), u, v, dMin, dMax, wMin, wMax };
  }

  // ------------------------------------------------------ watertightness gate
  // GLOBAL openness test: every edge of every face must be traversed by at
  // least two faces of the WHOLE model. A clean build is closed by
  // construction (each ring shares its edges with a neighbor ring through
  // the weld); the gate catches kernel tangles — splices a later edit left
  // on the footprint — BEFORE commit, so the transaction rolls back and an
  // open shell can never land in the model. Three-way welds (a roof edge
  // shared with other elements' geometry) are non-manifold FOLDS, which the
  // kernel tolerates with warnings (the slab interpenetration precedent) —
  // they pass here.
  function shellGloballyClosed(m, faceIds) {
    for (const fid of faceIds) {
      const f = m.faces.get(fid);
      if (!f) return false;
      for (const ring of m.rings(f)) {
        for (let i = 0; i < ring.length; i++) {
          const e = m.findEdge(ring[i], ring[(i + 1) % ring.length]);
          if (!e) return false;
          const adj = m.facesAdjacentToEdge(e);
          if (!adj || adj.length < 2) return false;
        }
      }
    }
    return true;
  }

  // Orient a ring outward w.r.t. the solid's centroid (convex solids: the
  // centroid->face direction is the outward half-space).
  function orientOutward(G, pts, solidCenter) {
    let cx = 0, cy = 0, cz = 0;
    for (const p of pts) { cx += p.x; cy += p.y; cz += p.z; }
    const c = G.v(cx / pts.length, cy / pts.length, cz / pts.length);
    const out = G.sub(c, solidCenter);
    if (G.isZero(out)) return pts;
    return G.dot(G.loopNormal(pts), out) < 0 ? pts.slice().reverse() : pts;
  }

  // ------------------------------------------------------------- flat region
  // Footprint ring swept UP by the thickness (FloorTool's slab path, but
  // upward): pushPull closes the base cap unless a genuine host covers it.
  function buildFlatRegion(G, m, { region, thickness, overhang, z }) {
    let outer = region.outer.map(p => G.v(p.x, p.y, z));
    if (overhang > 1e-6 && typeof DrawGeom !== 'undefined') {
      const grown = DrawGeom.parallelOffset(G, outer, true, overhang);
      if (grown && grown.length >= 3 && !G.ringDegenerate(grown)) outer = grown;
    }
    if (G.loopNormal(outer).z < 0) outer = outer.slice().reverse(); // sweep UP
    const holes = (region.holes || []).map(h => h.map(p => G.v(p.x, p.y, z)));
    const before = new Set(m.faces.keys());
    const f = m.addFaceFromRings(outer.map(p => G.clone(p)),
      holes.map(h => h.map(p => G.clone(p))), { color: ROOF_COLOR });
    if (!f) throw new Error('degenerate roof boundary');
    if (!m.pushPull(f, thickness, true)) throw new Error('roof extrusion failed');
    const roles = {};
    for (const id of m.faces.keys()) {
      if (before.has(id)) continue;
      const c = m.faceCentroid(m.faces.get(id));
      roles[id] = Math.abs(c.z - (z + thickness)) < 1e-6 ? 'top'
        : Math.abs(c.z - z) < 1e-6 ? 'bottom' : 'slope';
    }
    return { roles, pitched: false, zTop: z + thickness, zBottom: z };
  }

  // ---------------------------------------------------------- pitched region
  // Mono / gable solid assembled face-by-face with welded corners (the
  // addFaceFromRings weld gives every shared edge exactly two faces).
  //   zb(d) — underside height: hinge at the sketched low edge (z at dMin),
  //           rising at pitch; gable mirrors about mid-span.
  //   Top surface = zb + thickness (vertical thickness; the perpendicular
  //   deck measures thickness * cos(pitch)).
  function buildPitchedRegion(G, m, { kind, frame, thickness, pitch, overhang, z }) {
    const t = Math.max(0.02, thickness);
    const s = Math.tan(Math.max(0.5, Math.min(75, pitch)) * Math.PI / 180);
    const o = Math.max(0, overhang);
    const { P0, u, v, dMin, dMax, wMin, wMax } = frame;
    const dR = (dMin + dMax) / 2;                    // ridge position (sketch span)
    const d0 = dMin - o, d1 = dMax + o, w0 = wMin - o, w1 = wMax + o;
    const zb = d => z + s * (kind === 'mono' ? (d - dMin) : Math.min(d - dMin, dMax - d));
    const pos = (d, w, zz) => G.v(P0.x + u.x * d + v.x * w, P0.y + u.y * d + v.y * w, zz);
    const pt = (d, w) => pos(d, w, zb(d) + t);
    const pb = (d, w) => pos(d, w, zb(d));

    let rings;
    if (kind === 'mono') {
      rings = [
        { pts: [pt(d0, w0), pt(d1, w0), pt(d1, w1), pt(d0, w1)], role: 'top' },
        { pts: [pb(d0, w0), pb(d1, w0), pb(d1, w1), pb(d0, w1)], role: 'bottom' },
        { pts: [pt(d0, w0), pt(d0, w1), pb(d0, w1), pb(d0, w0)], role: 'slope' }, // eaves fascia
        { pts: [pt(d1, w0), pt(d1, w1), pb(d1, w1), pb(d1, w0)], role: 'gable' }, // high-end wall
        { pts: [pt(d0, w0), pt(d1, w0), pb(d1, w0), pb(d0, w0)], role: 'slope' }, // rake
        { pts: [pt(d0, w1), pt(d1, w1), pb(d1, w1), pb(d0, w1)], role: 'slope' }, // rake
      ];
    } else { // gable — two mirrored mono halves; hexagonal end caps close it
      rings = [
        { pts: [pt(d0, w0), pt(dR, w0), pt(dR, w1), pt(d0, w1)], role: 'top' },
        { pts: [pt(dR, w0), pt(d1, w0), pt(d1, w1), pt(dR, w1)], role: 'top' },
        { pts: [pb(d0, w0), pb(dR, w0), pb(dR, w1), pb(d0, w1)], role: 'bottom' },
        { pts: [pb(dR, w0), pb(d1, w0), pb(d1, w1), pb(dR, w1)], role: 'bottom' },
        { pts: [pt(d0, w0), pt(dR, w0), pt(d1, w0), pb(d1, w0), pb(dR, w0), pb(d0, w0)], role: 'gable' },
        { pts: [pt(d0, w1), pt(dR, w1), pt(d1, w1), pb(d1, w1), pb(dR, w1), pb(d0, w1)], role: 'gable' },
        { pts: [pt(d0, w0), pt(d0, w1), pb(d0, w1), pb(d0, w0)], role: 'slope' }, // eaves fascia
        { pts: [pt(d1, w0), pt(d1, w1), pb(d1, w1), pb(d1, w0)], role: 'slope' }, // eaves fascia
      ];
    }

    // solid centroid (convex): mean of the corner lattice
    const corners = [];
    for (const d of (kind === 'mono' ? [d0, d1] : [d0, dR, d1]))
      for (const w of [w0, w1]) { corners.push(pt(d, w)); corners.push(pb(d, w)); }
    let sx = 0, sy = 0, sz = 0;
    for (const p of corners) { sx += p.x; sy += p.y; sz += p.z; }
    const center = G.v(sx / corners.length, sy / corners.length, sz / corners.length);

    const roles = {};
    const ids = [];
    for (const r of rings) {
      const pts = orientOutward(G, r.pts, center);
      const f = m.addFaceFromRings(pts.map(p => G.clone(p)), [], { color: ROOF_COLOR });
      if (!f) throw new Error('degenerate roof plane');
      roles[f.id] = r.role;
      ids.push(f.id);
    }
    if (!shellGloballyClosed(m, ids)) throw new Error('roof shell is not closed');
    return {
      roles, pitched: true,
      zTop: Math.max(...corners.map(p => p.z)),
      zBottom: Math.min(...corners.map(p => p.z)),
    };
  }

  // Dispatch one region; mono/gable fall back to flat when the footprint is
  // not a plain rectangle (v1 — toast from the caller).
  function buildRegion(G, m, opts) {
    if (opts.kind === 'mono' || opts.kind === 'gable') {
      const holes = (opts.region.holes || []).length;
      const frame = holes ? null : rectFrame(G, simplifyRing(opts.region.outer));
      if (frame) return buildPitchedRegion(G, m, Object.assign({ frame }, opts));
      return Object.assign(buildFlatRegion(G, m, opts), { pitched: false });
    }
    return buildFlatRegion(G, m, opts);
  }

  // ==================================================================== tool
  class RoofTool extends Tool {
    static id = 'roof';
    static SKETCH_COLOR = 0xb3592a;
    activate() {
      this._sketch = [];     // committed boundary paths this interaction
      this._err = null;      // validation error highlight
      this._edit = null;     // Edit Boundary: {id} of the entity being re-sketched
      const ed = this.app._boundaryEdit;
      if (ed && ed.type === 'roof') {
        const ent = this.app.bim.getEntityById(ed.id);
        if (ent && Array.isArray(ent.params.regions) && ent.params.regions.length) {
          this._edit = { id: ent.id };
          this._sketch = this.app.bim.boundarySketchPaths(ent);
          // the options bar reflects the stored roof, so a re-commit keeps shape
          const p2 = ent.params;
          if (this.state) {
            this.state.kind = KINDS.includes(p2.kind) ? p2.kind : 'flat';
            this.state.thickness = clampNum(p2.thickness, 0.05, 2, 0.2);
            this.state.pitch = clampNum(p2.pitch, 0.5, 75, 15);
            this.state.overhang = clampNum(p2.overhang, 0, 5, 0.4);
          }
        }
      }
      this.engine = new DrawPrimitiveEngine(this.app, {
        primitives: ['line', 'rect', 'polygon', 'circle', 'arc_ser', 'arc_ce', 'pick'],
        getOptions: () => this.app.bimOptions,
        planePoint: ev => this._pt(ev),
        onCommit: r => this._addPath(r),
        onModeChange: () => this.status(),
        color: RoofTool.SKETCH_COLOR, fill: 0xb3592a, fillAlpha: 0.12,
      });
      this.app.enterSketchMode(this._edit ? 'Edit Roof Boundary' : 'Roof boundary',
        () => this._commitSketch(), () => this._cancelSketch());
      this.status();
    }
    deactivate() {
      this._edit = null;
      if (this.app._boundaryEdit) this.app._boundaryEdit = null; // single-use arming
      this.app.exitSketchMode();
      super.deactivate();
    }
    get hint() {
      const app = this.app, s = this.state || {};
      const lvl = app.levelManager.getLevel(app.bimOptions.baseLevel);
      const kind = KINDS.includes(s.kind) ? s.kind : 'flat';
      const desc = kind === 'mono' ? `Mono-pitch ${pitchLabel(+s.pitch || 15)}`
        : kind === 'gable' ? `Gable ${pitchLabel(+s.pitch || 15)}` : 'Flat';
      const acc = this._sketch.length ? ` ${this._sketch.length} boundar${this._sketch.length === 1 ? 'y' : 'ies'} sketched.` : '';
      return `Sketch Mode — Roof (${desc}, ${(clampNum(s.thickness, 0.05, 2, 0.2)).toFixed(2)} m slab, `
        + `${(clampNum(s.overhang, 0, 5, 0.4)).toFixed(2)} m overhang): draw closed boundar${'ies'} on ${lvl ? lvl.name : 'the base level'} `
        + `(chain lines/arcs; contained loops become openings).${acc} \u2713 commits, \u2717 discards.`;
    }
    _pt(ev) {
      const anchor = this.engine.stage === 1 ? this.engine.p1
        : (this._sketch.length ? this._lastEnd() : this.engine.chainStart);
      // sketched boundaries are preview-only — never model edges — so their
      // endpoints must be fed to the inference explicitly (FloorTool pattern)
      const snaps = [];
      for (const path of this._sketch) {
        if (!path.pts.length) continue;
        snaps.push({ p: path.pts[0], kind: 'endpoint', label: 'Boundary End' });
        snaps.push({ p: path.pts[path.pts.length - 1], kind: 'endpoint', label: 'Boundary End' });
      }
      if (this.engine.chainStart) snaps.push({ p: this.engine.chainStart, kind: 'endpoint', label: 'Chain Start' });
      this.app._liveSnaps = snaps;
      const inf = this.app.inferPoint(ev, anchor);
      if (inf.kind === 'endpoint' || inf.kind === 'midpoint' || inf.kind === 'center'
        || inf.kind === 'edge' || inf.kind === 'gridX')
        this.app.view.showSnapDot(inf.p, inf.kind === 'gridX' ? 'endpoint' : inf.kind);
      const z = this.app.levelManager.getElevation(this.app.bimOptions.baseLevel);
      return G.v(inf.p.x, inf.p.y, z);
    }
    _lastEnd() {
      const last = this._sketch[this._sketch.length - 1];
      return last ? last.pts[last.pts.length - 1] : null;
    }
    _addPath(r) {
      this._sketch.push({ pts: r.pts.map(p => G.clone(p)), closed: !!r.closed });
      this._err = null;
      this.status();
    }
    // ---------------------------------------------------------- validation UI
    _showError(err) {
      this._err = err;
      const view = this.app.view;
      view.clearPreview();
      if (err && err.p) {
        const p = err.p, s = Math.max(0.05, this.app.view.cam.dist * 0.012);
        const ring = [G.v(p.x - s, p.y - s, p.z + 0.01), G.v(p.x + s, p.y - s, p.z + 0.01),
          G.v(p.x + s, p.y + s, p.z + 0.01), G.v(p.x - s, p.y + s, p.z + 0.01)];
        view.previewLoop(ring, 0xf97316);
        view.previewLine([ring[0], ring[2]], 0xf97316);
        view.previewLine([ring[1], ring[3]], 0xf97316);
        const sc = view.toScreen(p);
        if (sc) view.hudLabel(sc.x, sc.y - 22, err.msg, '#ea580c');
      }
      this.app.toast(err ? err.msg : 'Validation failed');
      this.app.setStatus(err ? `Sketch error: ${err.msg}` : 'Validation failed');
    }
    _drawSketch() {
      const view = this.app.view;
      for (const path of this._sketch) {
        const q = path.closed ? [...path.pts, path.pts[0]] : path.pts;
        view.previewLine(q, RoofTool.SKETCH_COLOR);
      }
    }
    // ------------------------------------------------------------ commit flow
    _commitSketch() {
      const app = this.app, m = app.model;
      if (!this._sketch.length) { app.toast('Nothing sketched yet'); return; }
      const v = SketchValidator.validate(this._sketch);
      if (!v.ok) { this._showError(v.error); return; }
      if (!v.regions.length) { app.toast('No closed boundary'); return; }
      // Edit Boundary: regenerate the SAME entity from the re-sketched boundary
      if (this._edit) return this._commitEdit(v);
      const s = this.state || {};
      const kind = KINDS.includes(s.kind) ? s.kind : 'flat';
      const thickness = clampNum(s.thickness, 0.05, 2, 0.2);
      const pitch = clampNum(s.pitch, 0.5, 75, 15);
      const overhang = clampNum(s.overhang, 0, 5, 0.4);
      const z = app.levelManager.getElevation(app.bimOptions.baseLevel);
      const regions = v.regions.map(r => ({
        outer: r.outer.map(p => G.clone(p)),
        holes: r.holes.map(h => h.map(p => G.clone(p))),
      }));
      const edgesBefore = new Set(m.edges.keys());
      const roles = {};
      let fellBack = 0, zTop = z, zBottom = z, ok = false;
      app.transaction.run('sketch roof', mm => {
        mm.bimHold = true; // roofs deliberately interpenetrate their supporting
        try {               // walls — stamps propagate to split pieces
          for (const region of regions) {
            const built = buildRegion(G, mm, { kind, thickness, pitch, overhang, region, z });
            if (kind !== 'flat' && !built.pitched) fellBack++;
            Object.assign(roles, built.roles);
            zTop = Math.max(zTop, built.zTop);
            zBottom = Math.min(zBottom, built.zBottom);
          }
          ok = Object.keys(roles).length > 0;
        } finally { mm.bimHold = false; }
      });
      if (!ok) return;
      const newEdges = [...m.edges.keys()].filter(id => !edgesBefore.has(id));
      app.bim.create('roof', {
        kind, thickness, pitch, overhang, source: 'sketch',
        baseLevel: app.bimOptions.baseLevel, levelId: app.bimOptions.baseLevel,
        height: Math.max(0.02, zTop - z), // ridge (or flat top) above the level
        regions: regions.map(r => ({
          outer: r.outer.map(p => [p.x, p.y, p.z]),
          holes: r.holes.map(h => h.map(p => [p.x, p.y, p.z])),
        })),
      }, roles, newEdges);
      app.setTool('select'); // deactivate() exits sketch mode
      // weather-surface area (sloped for pitched roofs) — the sketch's measure
      const areaSum = Object.entries(roles).reduce((sum, [fid, role]) =>
        role === 'top' ? sum + m.faceArea(m.faces.get(+fid)) : sum, 0);
      const label = kind === 'mono' ? `Mono-pitch ${pitchLabel(pitch)}`
        : kind === 'gable' ? `Gable ${pitchLabel(pitch)}` : `Flat ${Math.round(thickness * 1000)} mm`;
      app.toast(`Roof committed — ${label}, ${v.regions.length} region${v.regions.length === 1 ? '' : 's'}, `
        + `${areaSum.toFixed(2)} m\u00B2 roof area (Z ${zBottom.toFixed(2)}\u2026${zTop.toFixed(2)})`
        + (fellBack ? ` — ${fellBack} region${fellBack === 1 ? '' : 's'} fell back to Flat (non-rectangular footprint)` : ''));
      if (areaSum > 0) {
        let best = null;
        for (const [fid, role] of Object.entries(roles)) {
          if (role !== 'top') continue;
          const f = m.faces.get(+fid);
          if (f && (!best || m.faceCentroid(f).z > m.faceCentroid(best).z)) best = f;
        }
        if (best) {
          const c = m.faceCentroid(best);
          app.view.pinLabel(G.v(c.x, c.y, c.z + 0.002), `${areaSum.toFixed(2)} m\u00B2`, '#6d4c41', best.id);
        }
      }
    }
    // Edit Boundary commit: the re-sketched boundary becomes the roof's new
    // parametric truth; rebuildEntity regenerates the SAME entity's geometry.
    // It throws on failure — the transaction rolls params + geometry back.
    _commitEdit(v) {
      const app = this.app;
      const id = this._edit.id;
      const ent = app.bim.getEntityById(id);
      if (!ent) { app.toast('The roof was deleted — nothing to update'); this._cancelSketch(); return; }
      const regions = v.regions.map(r => ({
        outer: r.outer.map(p => [p.x, p.y, p.z]),
        holes: r.holes.map(h => h.map(p => [p.x, p.y, p.z])),
      }));
      const ok = app.run('edit roof boundary', () => {
        ent.params.regions = regions; // params are truth — rebuildEntity does the rest
        return RoofFeature.rebuildEntity(app, id); // throws → rollback restores all
      });
      if (!ok) {
        app.toast('Boundary update failed — sketch kept; edit and retry', true);
        return;
      }
      app._boundaryEdit = null;
      app.setTool('select'); // deactivate() exits sketch mode + clears the edit
      app.toast(`Roof boundary updated — ${v.regions.length} region${v.regions.length === 1 ? '' : 's'}`);
      app.selectElement(id);
      app.updateInfo();
    }
    _cancelSketch() {
      this.app.setTool('select'); // deactivate() exits sketch mode
      this.app.setStatus('Sketch discarded.');
    }
    // ------------------------------------------------------------- delegation
    onMove(ev) {
      this.engine.onMove(ev);
      this._drawSketch();
      if (this._err) this._showError(this._err); // keep the highlight live
    }
    onDown(ev) { this.engine.onDown(ev); }
    onUp(ev) { this.engine.onUp(ev); }
    onKey(ev) {
      if (ev.key === 'Escape') {
        if (this._err) { this._err = null; this.app.view.clearPreview(); return true; }
        const handled = this.engine.onKey(ev);
        if (handled) { this.status(); return true; }
        // Esc with nothing pending keeps what's already sketched (FloorTool
        // precedent: a stray keypress must not discard drawn boundaries)
        if (this._sketch.length) {
          this.app.setStatus(`Sketch kept (${this._sketch.length} boundar${this._sketch.length === 1 ? 'y' : 'ies'}) — Enter/\u2713 commits, \u2717 discards.`);
          return true;
        }
        this._cancelSketch();
        return true;
      }
      return this.engine.onKey(ev);
    }
    onVCB(text) {
      const mch = /^\s*([\d.]+)\s*[x,]\s*([\d.]+)(?:\s*[x,]\s*([\d.]+))?\s*$/.exec(String(text));
      if (mch && this.engine.primitive === 'rect' && this.engine.stage === 1 && this.engine.p1) {
        const p1 = this.engine.p1;
        if (mch[3] && parseFloat(mch[3]) > 0) {
          this.state.thickness = clampNum(parseFloat(mch[3]), 0.05, 2, 0.2);
          this.status();
        }
        this.engine._click(G.v(p1.x + parseFloat(mch[1]), p1.y + parseFloat(mch[2]), p1.z));
        return true;
      }
      return this.engine.onVCB(text);
    }
  }

  // ====================================================== parametric rebuild
  // Regenerate an existing roof entity from its params (thickness / pitch /
  // overhang / kind edits). Runs INSIDE the caller's transaction — throw
  // rolls the edit back (the script-elements rebuildEntity pattern):
  //   app.run('edit roof', () => RoofFeature.rebuildEntity(app, id, { pitch: 30 }));
  function rebuildEntity(app, id, patch = {}) {
    const m = app.model;
    const ent = app.bim.getEntityById(id);
    if (!ent || ent.type !== 'roof') throw new Error('not a roof element');
    const p = ent.params || {};
    const params = {
      kind: KINDS.includes(patch.kind != null ? patch.kind : p.kind) ? (patch.kind != null ? patch.kind : p.kind) : 'flat',
      thickness: clampNum(patch.thickness != null ? patch.thickness : p.thickness, 0.05, 2, 0.2),
      pitch: clampNum(patch.pitch != null ? patch.pitch : p.pitch, 0.5, 75, 15),
      overhang: clampNum(patch.overhang != null ? patch.overhang : p.overhang, 0, 5, 0.4),
    };
    const z0 = ent.params.baseLevel != null && app.levelManager
      ? app.levelManager.getElevation(ent.params.baseLevel) : 0;
    m.bimHold = true;
    try {
      for (const fid of [...ent.faces]) m.faces.delete(fid);
      for (const eid of [...ent.edges]) m.edges.delete(eid);
      m.gc();
      // deleting recorded edges can remove edges shared with surviving
      // geometry — recreate ring edges survivors still need (wall precedent)
      for (const f2 of m.faces.values()) {
        m.edgesForRing(f2.loop, true);
        for (const h2 of (f2.holes || [])) m.edgesForRing(h2, true);
      }
      const roles = {};
      const edges = new Set();
      const regions = (p.regions || []).map(r => ({
        outer: (r.outer || []).map(a => G.v(a[0], a[1], a[2])),
        holes: (r.holes || []).map(h => h.map(a => G.v(a[0], a[1], a[2]))),
      }));
      if (!regions.length) throw new Error('roof has no stored footprint');
      let zTop = -Infinity;
      for (const region of regions) {
        // LEVEL-DRIVEN: the base level's CURRENT elevation owns the seat —
        // a moved level regenerates the roof at its new plane
        const built = buildRegion(G, m, Object.assign({ region, z: z0 }, params));
        Object.assign(roles, built.roles);
        zTop = Math.max(zTop, built.zTop);
      }
      ent.params.kind = params.kind;
      ent.params.thickness = params.thickness;
      ent.params.pitch = params.pitch;
      ent.params.overhang = params.overhang;
      ent.params.height = Math.max(0.02, zTop - z0);
      ent.faces = Object.keys(roles).map(Number);
      ent.edges = [];
      for (const fid of ent.faces) {
        const f3 = m.faces.get(fid);
        f3.userData = { bimEntityId: id, bimType: 'roof', role: roles[fid] };
        for (const ring of m.rings(f3)) {
          for (let i = 0; i < ring.length; i++) {
            const e = m.findEdge(ring[i], ring[(i + 1) % ring.length]);
            if (e) { edges.add(e.id); e.userData = { bimEntityId: id, bimType: 'roof', role: 'profile' }; }
          }
        }
      }
      ent.edges = [...edges];
      return true;
    } finally {
      m.bimHold = false;
    }
  }

  if (window.Engine) {
    Engine.features.register({
      id: 'roof',
      kind: 'tool',
      label: 'Roof',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2.5 13.5 12 4l9.5 9.5"/><path d="M5.5 11v9h13v-9"/><path d="M12 4v3.5"/></svg>',
      // V is taken (Blender-style axis-lock arming) — F is free in the BIM
      // ribbon and reads as "Roof by Footprint" (Revit's own tool name)
      key: 'F',
      mode: 'bim',
      commands: ['roof', 'roofs'],
      options: [
        { key: 'kind', type: 'select', label: 'Kind', choices: [{ value: 'flat', label: 'Flat' }, { value: 'mono', label: 'Mono-pitch' }, { value: 'gable', label: 'Gable' }] },
        { key: 'thickness', type: 'number', label: 'Thickness', step: 0.05, default: 0.2 },
        { key: 'pitch', type: 'number', label: 'Pitch \u00B0', step: 1, default: 15 },
        { key: 'overhang', type: 'number', label: 'Overhang', step: 0.05, default: 0.4 },
      ],
      tool: RoofTool,
      state: { kind: 'flat', thickness: 0.2, pitch: 15, overhang: 0.4 },
      onOption() {
        // the sketch status line reflects the new kind / size immediately
        // (there is no cursor ghost to refresh while sketching)
        const t = window.app && window.app.tool;
        if (t && t.id === 'roof') t.status();
      },
    });
  }
  window.RoofFeature = { RoofTool, buildRegion, rebuildEntity, rectFrame, simplifyRing };
})();
