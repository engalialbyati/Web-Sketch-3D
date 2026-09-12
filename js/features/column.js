'use strict';
// ---------------------------------------------------------------------------
// Feature: Column (the SDK reference feature).
//
// This whole file is what a new tool costs: one standard Tool class, one
// Engine.features.register() descriptor. The ribbon button, command
// aliases (col / column), options-bar fields, properties entries and undo
// labels all come from the descriptor. The geometry itself lives in
// StructuralManager (pure, unit-tested).
//
// Vertical bounds are LEVEL-DRIVEN (StructuralManager):
//   Z_start = Z(baseLevel) + baseOffset
//   Z_end   = Z(topLevel)  + topOffset      (Revit-style; falls back to the
//                                           unconnected height option)
// The picked point supplies x/y and the base offset relative to the active
// base level (click a slab top at +0.2 m → baseOffset 0.2). The sweep starts
// at the TOP plane and pushes DOWN, so a slab at the top level is punched
// and the column passes through monolithically (Column > Slab precedence).
// ---------------------------------------------------------------------------
(function () {

  // pure geometry — unit-testable, no app dependency. Legacy direct builder
  // (extrudes UP from the picked plane); the level-driven path is
  // StructuralManager.buildColumn, used by the tool below.
  function placeColumn(G, m, p, w, d, h, rot = 0, stamp = null) {
    // plan rotation about the column center — aligned columns cut walls square
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const pc = (lx, ly) => G.v(p.x + lx * cs - ly * sn, p.y + lx * sn + ly * cs, p.z);
    const f = m.addFaceFromRings([pc(-w / 2, -d / 2), pc(w / 2, -d / 2), pc(w / 2, d / 2), pc(-w / 2, d / 2)]);
    if (!f) return null;
    // stamp BEFORE the sweep: pushPull children inherit it, so indepSkip
    // shields the whole rebuild — unstamped children once sliced each other
    // at corner junctions (the load-grid-model-then-draw-a-wall freeze)
    if (stamp) f.userData = { ...stamp };
    if (!m.pushPull(f, h)) return null;
    const R = Math.hypot(w, d); // circumscribed half-extent (rotation-proof filter)
    return [...m.faces.values()].filter(g => {
      const c = m.faceCentroid(g);
      return c.x > p.x - R && c.x < p.x + R && c.y > p.y - R && c.y < p.y + R
        && c.z >= p.z - 1e-6 && c.z <= p.z + h + 1e-6;
    });
  }

  class ColumnTool extends Tool {
    static id = 'column';
    activate() { this.status(); }
    get hint() {
      const s = this.state || {};
      const app = this.app;
      const fam = (window.ColumnFamilies && ColumnFamilies.get(s.family)) || null;
      const lvl = app.levelManager.getLevel(app.bimOptions.baseLevel);
      const top = app.bimOptions.topConstraint !== 'unconnected'
        ? (app.levelManager.getLevel(app.bimOptions.topConstraint) || {}).name
        : `+${(app.bimOptions.unconnectedHeight || s.height || 3).toFixed(1)} m (unconnected)`;
      return `Column${fam ? ' (' + fam.name + ')' : ''}: click to place a ${(s.width || 0.3).toFixed(2)} x ${(s.depth || 0.3).toFixed(2)} m column, ${lvl ? lvl.name : 'base level'} → ${top}. Snap a grid intersection (A-1) to bind it to the grids, or click anywhere freely. ANGLE on the options bar sets an explicit rotation; PARALLEL (checked) aligns a snapped column with its host wall/beam. Family + size on the Options Bar, more designs in the Families panel.`;
    }
    /** Family params (normalized) carried in feature state; the Options Bar
     *  edits width/depth/height, the Families panel fills the extras. */
    _familyParams(s) {
      if (!window.ColumnFamilies) return {};
      return ColumnFamilies.normalize((s || this.state || {}).family || 'rect', s || this.state) || {};
    }
    _boundsAt(p, kind) {
      const app = this.app, s = this.state || {};
      const baseLevel = app.bimOptions.baseLevel;
      const baseZ = app.levelManager.getElevation(baseLevel);
      const fp = this._familyParams(s);
      // the picked plane becomes a baseOffset ONLY when the cursor hit real
      // geometry (a slab top at +0.2 m over the level). A GROUND/FREE pick
      // is just x/y — clicking empty space with Base Level 2 is not a
      // request for a −3 m offset, it bases the column ON the level plane
      const onGeometry = kind === 'endpoint' || kind === 'midpoint' || kind === 'center'
        || kind === 'edge' || kind === 'face';
      // stand-on-surface: only a slab/roof/free top under the cursor bases
      // the column on it. A pick on a WALL bases at the level — the column
      // lands on the floor and the wall-face rule splits it. (The old rule
      // took ANY geometry pick's z: clicking a wall floated the column at
      // the click height, half-embedded, and no split ever happened.)
      const stand = onGeometry ? app.pointStandingZ(p, kind) : null;
      const params = {
        base: [p.x, p.y, baseZ],
        family: s.family || 'rect',
        ...fp,
        baseLevelId: baseLevel,
        topLevelId: app.bimOptions.topConstraint !== 'unconnected' ? app.bimOptions.topConstraint : null,
        baseOffset: stand != null ? stand - baseZ : 0,
        topOffset: 0,
        // the options strip's Unconnected Height owns the height (walls,
        // grid columns, beams all read it) — the feature's legacy state is
        // only a fallback
        height: Math.max(0.1, (app.bimOptions && app.bimOptions.unconnectedHeight) || s.height || 3),
      };
      const bounds = app.structural.columnBounds(params);
      // v0.7 CONTINUOUS COLUMNS: the column runs through beams to its top
      // constraint — no beam cap. A beam directly under the base still
      // embeds the column by ELEMENT_EPS (no coplanar gap at the bottom).
      {
        const bBase = app.structural.columnBearingBase(params);
        if (bBase < bounds.zStart - 1e-6) params.baseOffset = (params.baseOffset || 0) - (bounds.zStart - bBase);
        bounds.zEnd = Math.min(bounds.zEnd, app.structural.columnBounds(params).zEnd);
      }
      // solid top: a drop-panel head hangs UNDER a covering slab's soffit
      bounds.solidTop = app.structural.columnSolidTop(app.model, params);
      return { params, bounds };
    }
    onMove(ev) {
      const view = this.app.view;
      this._lastEv = ev;
      view.clearPreview();
      const inf = this.app.inferPoint(ev, null);
      const pl = this._placementRot(inf, inf.p, ev);
      const p = pl.p;
      const { params, bounds } = this._boundsAt(p, inf.kind);
      const z0 = bounds.zStart, z1 = bounds.solidTop != null ? bounds.solidTop : bounds.zEnd;
      const CF = window.ColumnFamilies;
      const spec = CF && CF.get(params.family) ? CF.parts(params.family, params, z1 - z0) : null;
      if (spec && spec.segments.length) {
        // family ghost: every tier's plan ring at its true height, walls on
        // matching rings (taper slices and prisms line up point-for-point) —
        // rotated by the resolved placement rotation like the real build
        const rcs = Math.cos(pl.rot), rsn = Math.sin(pl.rot);
        const rp = q => ({ x: q.x * rcs - q.y * rsn, y: q.x * rsn + q.y * rcs });
        for (const s of spec.segments) {
          const up = s.ring.map(q => { const w = rp(q); return G.v(p.x + w.x, p.y + w.y, z0 + s.z1); });
          const dn = s.ring.map(q => { const w = rp(q); return G.v(p.x + w.x, p.y + w.y, z0 + s.z0); });
          view.previewLoop(up, 0x0e8385);
          view.previewLoop(dn, 0x0e8385);
          if (s.z1 - s.z0 > 0.05) view.previewQuadsBetween(up, dn);
        }
      } else {
        const rot = pl.rot;
        const cs = Math.cos(rot), sn = Math.sin(rot);
        const pc = (lx, ly, z) => G.v(p.x + lx * cs - ly * sn, p.y + lx * sn + ly * cs, z);
        const ring = [
          pc(-params.width / 2, -params.depth / 2, z1), pc(params.width / 2, -params.depth / 2, z1),
          pc(params.width / 2, params.depth / 2, z1), pc(-params.width / 2, params.depth / 2, z1),
        ];
        const bottom = ring.map(q => G.v(q.x, q.y, z0));
        view.previewLoop(ring, 0x0e8385);
        view.previewLoop(bottom, 0x0e8385);
        view.previewQuadsBetween(ring, bottom);
      }
      const fam = CF && CF.get(params.family);
      const under = bounds.solidTop != null && bounds.solidTop < bounds.zEnd - 1e-3;
      const rotDeg = (pl.rot * 180 / Math.PI);
      view.stickyLabel(G.v(p.x, p.y, z1),
        `${fam ? fam.name + ' ' : ''}${(params.width || 0.3).toFixed(2)} x ${(params.depth || 0.3).toFixed(2)} x ${(z1 - z0).toFixed(1)} m${rotDeg ? ` · ${rotDeg.toFixed(0)}°` : ''} (Z ${z0.toFixed(2)}…${z1.toFixed(2)})${under ? ' — head under slab' : ''}`, '#0a5f61', 0, 0);
    }
    // PLAN ROTATION — the Options Bar is the source of truth:
    //   Angle box  : an explicit rotation for every placement (empty = auto)
    //   Parallel ✓ : the column aligns with the element it is drawn ON —
    //                a click on the wall's BODY (face/edge pick) resolves
    //                the owning wall/beam just like a centerline snap, and
    //                the column centers itself on that axis
    // Returns { rot, p }: the rotation and the (possibly axis-centered) point.
    _placementRot(inf, p, ev) {
      const app = this.app, o = app.bimOptions || {};
      if (o.rotationDeg != null && isFinite(o.rotationDeg))
        return { rot: o.rotationDeg * Math.PI / 180, p };
      if (o.parallel === false) return { rot: 0, p };
      let ax = null;
      if (inf.kind === 'centerline' && inf.dir) {
        ax = { x: inf.p.x, y: inf.p.y, dir: inf.dir };  // already on the axis
      } else if (inf.kind === 'face' && inf.face != null) {
        ax = this._axisOfFace(inf.face);
      } else if (inf.kind === 'edge' && inf.edge != null) {
        const e = app.model.edges.get(inf.edge);
        const ent = e && (e.userData && e.userData.bimEntityId)
          ? app.bim.getEntityById(e.userData.bimEntityId) : null;
        if (ent && ent.type === 'wall' && ent.params.base && ent.params.end) {
          const A = ent.params.base, B = ent.params.end;
          const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
          ax = { x: A[0], y: A[1], dir: { x: dx / L, y: dy / L }, len: L };
        }
      }
      // FALLBACK 1: a grid snap (or ground pick) can steal the click while the
      // cursor is visually ON a wall — probe the face under the cursor and
      // resolve its owning element anyway
      if (!ax && ev && app.view && app.view.pickFaceAt && app.view.eventPt) {
        try {
          const q = app.view.eventPt(ev);
          const fid = app.view.pickFaceAt(q);
          if (fid != null) ax = this._axisOfFace(fid);
        } catch (e) { /* view not ready — stay unrotated */ }
      }
      // FALLBACK 2: endpoint/midpoint snaps on the wall's own ring (its top
      // corners etc.) leave no face id and miss the face raycast — resolve
      // by PLAN PROXIMITY: the click's position against every wall/beam
      // axis; the nearest one inside its band owns the alignment
      if (!ax) {
        let best = null;
        for (const e of app.bim.entities) {
          let A = null, B = null;
          if (e.type === 'wall' && !e.params.closed && e.params.base && e.params.end) { A = e.params.base; B = e.params.end; }
          else if (e.type === 'beam' && Array.isArray(e.params.baseline) && e.params.baseline.length >= 2) {
            A = e.params.baseline[0]; B = e.params.baseline[e.params.baseline.length - 1];
          }
          if (!A) continue;
          const dx = B[0] - A[0], dy = B[1] - A[1];
          const L = Math.hypot(dx, dy);
          if (L < 1e-6) continue;
          const ux = dx / L, uy = dy / L;
          const rx = p.x - A[0], ry = p.y - A[1];
          Math.max(0, Math.min(L, rx * ux + ry * uy));
          const d = Math.abs(-rx * uy + ry * ux);
          const reach = ((e.params.thickness || e.params.width || 0.3) / 2) + 0.08;
          if (d <= reach && (!best || d < best.d))
            best = { d, ax: { x: A[0], y: A[1], dir: { x: ux, y: uy }, len: L } };
        }
        if (best) ax = best.ax;
      }
      if (!ax) return { rot: 0, p };
      const rot = Math.atan2(ax.dir.y, ax.dir.x);
      if (ax.len == null) return { rot, p };  // centerline snap: already centered
      // center the element ON the host axis (plan projection, span-clamped)
      const t = Math.max(0, Math.min(ax.len,
        (p.x - ax.x) * ax.dir.x + (p.y - ax.y) * ax.dir.y));
      return { rot, p: G.v(ax.x + ax.dir.x * t, ax.y + ax.dir.y * t, p.z) };
    }
    _axisOfFace(fid) {
      const app = this.app;
      const f = app.model.faces.get(fid);
      const ent = f && app.bim.getEntityForFace(f);
      if (!ent) return null;
      let A = null, B = null;
      if (ent.type === 'wall' && ent.params.base && ent.params.end) { A = ent.params.base; B = ent.params.end; }
      else if (ent.type === 'beam' && Array.isArray(ent.params.baseline) && ent.params.baseline.length >= 2) {
        A = ent.params.baseline[0]; B = ent.params.baseline[ent.params.baseline.length - 1];
      }
      if (!A) return null;
      const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
      return { x: A[0], y: A[1], dir: { x: dx / L, y: dy / L }, len: L };
    }
    onDown(ev) {
      if (ev.button !== 0) return;
      const app = this.app;
      const inf = app.inferPoint(ev, null);
      // parallel resolution: rotation from the host element (clicks on its
      // body resolve the owner), and the point slides onto the host axis
      const pl = this._placementRot(inf, inf.p, ev);
      const p = pl.p;
      const { params } = this._boundsAt(p, inf.kind);
      params.rotation = pl.rot;
      const facesBefore = new Set(app.model.faces.keys());
      const edgesBefore = new Set(app.model.edges.keys());
      let ok = false;
      // the tx returns true only when the fn ran AND the commit survived the
      // guard — a rolled-back build must not register a ghost entity over
      // the restored model
      ok = app.transaction.run('column', m => {
        // PRE-SPLIT: walls crossing the footprint retreat to its face FIRST
        // (with the column as a pending intruder) — the sweep then travels
        // between the pieces instead of slicing wall material
        app.bim.preSplitWallsForColumn(params);
        app.bim.preSplitBeamsForColumn(params);
        m.bimHold = true; // punching a slab at the top level keeps its entity
        try {
          const st = app.structural.buildColumn(G, m, params);
          if (!st.length) throw new Error('column placement failed');
          return true;
        } finally { m.bimHold = false; }
      }) === true;
      if (!ok) return;
      const m = app.model;
      // Claim only UNSTAMPED new faces: pieces of elements the column
      // punched or divided (a slab it passes through) keep their owner's
      // stamp and stay with that entity — the column never steals geometry.
      const newFaces = [...m.faces.keys()].filter(id => !facesBefore.has(id))
        .map(id => m.faces.get(id)).filter(f => f && !f.userData);
      // roles from the built solid's own z extents — a drop-panel head that
      // hangs under a slab never reaches the level plane, so columnBounds
      // alone would mislabel its top face
      let zMax = -Infinity, zMin = Infinity;
      for (const f of newFaces) {
        const c = m.faceCentroid(f);
        zMax = Math.max(zMax, c.z); zMin = Math.min(zMin, c.z);
      }
      const b = app.structural.columnBounds(params);
      const roles = {};
      for (const f of newFaces) {
        const c = m.faceCentroid(f);
        roles[f.id] = Math.abs(c.z - zMax) < 1e-6 ? 'top'
          : Math.abs(c.z - zMin) < 1e-6 ? 'bottom' : 'side';
      }
      const newEdges = [...m.edges.keys()].filter(id => !edgesBefore.has(id))
        .filter(id => !(m.edges.get(id) || {}).userData);
      // GRID BINDING — a column placed on a grid intersection (the "A-1"
      // snap) records its two grids: GridManager.syncAttached re-centers it
      // when either grid moves, and walls drawn between carrying
      // intersections trim against it.
      if (inf.kind === 'gridX' && inf.a && inf.b) params.gridRef = { a: inf.a.id, b: inf.b.id };
      app.bim.create('column', {
        ...params,
        baseLevel: params.baseLevelId, // LevelManager.usage() key
        topConstraint: params.topLevelId || 'unconnected',
        height: b.height,
      }, roles, newEdges);
      app.view.clearPreview();
      const fam = window.ColumnFamilies && ColumnFamilies.get(params.family);
      const solidTop = app.structural.columnSolidTop(m, params);
      const under = solidTop < b.zEnd - 1e-3;
      app.toast(`${fam ? fam.name : 'Column'} ${(params.width || 0.3).toFixed(2)} x ${(params.depth || 0.3).toFixed(2)} x ${b.height.toFixed(1)} m placed (Z ${b.zStart.toFixed(2)}…${b.zEnd.toFixed(2)})`
        + (under ? ' — head hangs under the slab' : '')
        + (params.gridRef ? ` at grid ${inf.a.name}-${inf.b.name} — moves with the grids` : ''));
    }
    onVCB(text) {
      // typing an angle arms the Options Bar's Angle box (single source)
      const aRad = (typeof parseAngle === 'function') ? parseAngle(text) : parseFloat(text) * Math.PI / 180;
      if (aRad == null || !isFinite(aRad)) return false;
      let d = ((aRad * 180 / Math.PI) % 360 + 360) % 360;
      if (d > 180) d -= 360;
      const box = document.getElementById('opt-rotation');
      if (box) { box.value = d; }
      this.app.bimOptions.rotationDeg = d;
      this.app.setStatus(`Column rotation ${d.toFixed(0)}° — click to place. Esc = back to automatic`);
      return true;
    }
    onKey(ev) {
      if (ev.key === 'Escape' && this.app.bimOptions && this.app.bimOptions.rotationDeg != null) {
        this.app.bimOptions.rotationDeg = null;
        const box = document.getElementById('opt-rotation');
        if (box) box.value = '';
        this.app.setStatus('Column rotation: automatic — Parallel snaps align with the host element');
        return true;
      }
      return false;
    }
  }

  if (window.Engine) {
    Engine.features.register({
      id: 'column',
      kind: 'tool',
      label: 'Column',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="8" y="4" width="8" height="16"/><path d="M5 20h14M6 4h12"/></svg>',
      key: 'K',
      mode: 'bim',
      commands: ['col', 'column'],
      options: [
        { key: 'family', type: 'select', label: 'Family',
          choices: (window.ColumnFamilies ? ColumnFamilies.selectChoices() : [{ value: 'rect', label: 'Rectangular RC' }]) },
        { key: 'width', type: 'number', label: 'Width', step: 0.05, default: 0.3 },
        { key: 'depth', type: 'number', label: 'Depth', step: 0.05, default: 0.3 },
        // height comes from the options strip's Unconnected Height (shared
        // with walls / grid columns) — one field, one truth
      ],
      tool: ColumnTool,
      state: { family: 'rect', width: 0.3, depth: 0.3, height: 3.0 },
      onOption(d, key) {
        // switching family re-bases the sizes on that family's defaults
        // (extras like drop-panel dims ride along in the state)
        if (key === 'family' && window.ColumnFamilies) {
          const fresh = ColumnFamilies.defaults(d.state.family);
          if (fresh) {
            for (const k of Object.keys(d.state)) {
              if (k === 'family' || k === 'height' || !(k in fresh)) continue;
              delete d.state[k];
            }
            Object.assign(d.state, fresh);
          }
        }
        // live preview follows the typed size / family
        const t = window.app && window.app.tool;
        if (t && t.id === 'column' && t._lastEv) t.onMove(t._lastEv);
      },
    });
  }
  window.ColumnFeature = { ColumnTool, placeColumn };
})();
